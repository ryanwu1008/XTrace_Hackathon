import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { DEMO_FIXTURE_LABEL } from "../../lib/contracts/domain";
import {
  createXTraceClient,
  getXTraceClient,
  isXTraceConfigured,
  XTraceHttpError,
} from "../../lib/xtrace/client";
import {
  createPersistentXTraceRateLimiter,
  createXTraceRateLimiter,
  createXTraceService,
  XTracePollingTimeoutError,
  XTraceUnavailableError,
} from "../../lib/xtrace/service";
import {
  createMemoryXTraceLineageRepository,
  createSupabaseXTraceLineageRepository,
} from "../../db/repositories/xtrace-lineage";
import { ingestMemoryStage } from "../../worker/stages/ingest-memory";
import { recallAllDealContexts } from "../../worker/recall-deal-contexts";
import type { ExactXTraceParentUnit } from "../../lib/xtrace/exact-parent-planner";

const bundle = {
  dealId: "deal_1",
  companyName: "Asteria Bio",
  status: "passed" as const,
  facts: [{
    text: "Asteria is awaiting an FDA accelerated-review decision.",
    sources: [{
      id: "source_1",
      provenance: "source_document" as const,
      title: "Asteria deck",
      excerpt: "The team is awaiting FDA review.",
    }],
  }],
  interactions: [{
    id: "fixture_1",
    occurredAt: "2026-07-01T00:00:00.000Z",
    summary: "Passed until the regulatory path changes.",
    decisionReason: "The synthetic team passed pending a clearer regulatory path.",
    concerns: ["FDA uncertainty"],
    revisitConditions: ["Accelerated review pilot"],
    provenance: "demo_fixture" as const,
    label: DEMO_FIXTURE_LABEL,
  }],
};

const exactParent: ExactXTraceParentUnit = {
  workspaceId: "workspace_demo",
  dealId: "deal_1",
  sourceId: "source_1",
  sourceRevisionId: "revision_1",
  parentKind: "legacy_source_revision",
  parentFingerprint: `sha256:${"a".repeat(64)}`,
  payloadFingerprint: `sha256:${"b".repeat(64)}`,
  bundle,
};

test("XTrace HTTP client keeps wait out of the memory request body", async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const client = createXTraceClient({
    apiKey: "test-key",
    orgId: "org_test",
    fetch: async (url, init) => {
      request = { url: String(url), init };
      return new Response(JSON.stringify({ id: "job_1", status: "pending" }), { status: 202 });
    },
  });

  await client.ingest({
    messages: [{ role: "user", content: "Remember this." }],
    user_id: "workspace:demo",
    conv_id: "deal:deal_1",
    app_id: "xtrace-vc-deal-intelligence",
  }, { wait: false });

  assert.equal(request?.url, "https://api.production.xtrace.ai/v1/memories");
  assert.equal((request?.init?.headers as Record<string, string>).Authorization, "Bearer test-key");
  assert.equal((request?.init?.headers as Record<string, string>)["X-Org-Id"], "org_test");
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    messages: [{ role: "user", content: "Remember this." }],
    user_id: "workspace:demo",
    conv_id: "deal:deal_1",
    app_id: "xtrace-vc-deal-intelligence",
  });
});

test("mmk XTrace requests use x-api-key and omit legacy auth headers", async () => {
  let headers = new Headers();
  const client = createXTraceClient({
    apiKey: "mmk_test",
    orgId: "stale_org",
    fetch: async (_url, init) => {
      headers = new Headers(init?.headers);
      return Response.json({ success: true, data: [] });
    },
  });

  await client.search({
    query: "health",
    user_id: "workspace:demo",
    mode: "retrieve",
    limit: 1,
  });

  assert.equal(headers.get("x-api-key"), "mmk_test");
  assert.equal(headers.get("authorization"), null);
  assert.equal(headers.get("x-org-id"), null);
  assert.equal(headers.get("user-agent"), "VSee-VC-Deal-Intelligence/0.1");
});

test("XTrace search rejects a successful HTTP response with a malformed provider envelope", async () => {
  const client = createXTraceClient({
    apiKey: "mmk_test",
    fetch: async () => new Response("not JSON", { status: 200 }),
  });

  await assert.rejects(
    client.search({
      query: "health",
      user_id: "workspace:demo",
      mode: "retrieve",
      limit: 1,
    }),
    XTraceHttpError,
  );
});

test("XTrace search rejects a successful HTTP response that reports success false", async () => {
  const client = createXTraceClient({
    apiKey: "mmk_test",
    fetch: async () => Response.json({ success: false, data: [] }),
  });

  await assert.rejects(
    client.search({
      query: "health",
      user_id: "workspace:demo",
      mode: "retrieve",
      limit: 1,
    }),
    XTraceHttpError,
  );
});

test("XTrace search rejects success false even when the remaining fields resemble the documented envelope", async () => {
  const client = createXTraceClient({
    apiKey: "mmk_test",
    fetch: async () => Response.json({
      success: false,
      object: "search",
      mode: "retrieve",
      data: [],
      context: null,
      stage_timings: {},
      context_selection_applied: false,
    }),
  });

  await assert.rejects(
    client.search({
      query: "health",
      user_id: "workspace:demo",
      mode: "retrieve",
      limit: 1,
    }),
    XTraceHttpError,
  );
});

test("XTrace search accepts the documented search envelope without a success field", async () => {
  const client = createXTraceClient({
    apiKey: "mmk_test",
    fetch: async () => Response.json({
      object: "search",
      mode: "retrieve",
      data: [],
      context: null,
      stage_timings: {},
      context_selection_applied: false,
    }),
  });

  const result = await client.search({
    query: "health",
    user_id: "workspace:demo",
    mode: "retrieve",
    limit: 1,
  });

  assert.deepEqual(result.data, []);
});

test("XTrace search rejects a malformed memory row instead of silently dropping it", async () => {
  const client = createXTraceClient({
    apiKey: "mmk_test",
    fetch: async () => Response.json({
      success: true,
      data: [{ id: "memory_1", score: 0.9 }],
    }),
  });

  await assert.rejects(
    client.search({
      query: "health",
      user_id: "workspace:demo",
      mode: "retrieve",
      limit: 1,
    }),
    XTraceHttpError,
  );
});

test("XTrace ingest rejects a successful HTTP response without a strict provider job", async () => {
  const client = createXTraceClient({
    apiKey: "mmk_test",
    fetch: async () => Response.json({ status: "pending" }),
  });

  await assert.rejects(
    client.ingest({
      messages: [{ role: "user", content: "Remember this." }],
      user_id: "workspace:demo",
      conv_id: "deal:deal_1",
    }),
    XTraceHttpError,
  );
});

test("XTrace configuration accepts mmk without an organization ID", () => {
  assert.equal(isXTraceConfigured({ XTRACE_API_KEY: "mmk_test" }), true);
  assert.equal(isXTraceConfigured({
    XTRACE_API_KEY: "legacy_test",
    XTRACE_ORG_ID: "org_test",
  }), true);
  assert.equal(isXTraceConfigured({ XTRACE_API_KEY: "legacy_test" }), false);
  assert.equal(isXTraceConfigured({}), false);
});

test("ordinary and dry-run paths cannot construct the live XTrace client", () => {
  assert.throws(
    () => getXTraceClient(undefined, { XTRACE_API_KEY: "mmk_test" }),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "XTRACE_LIVE_EXECUTION_NOT_AUTHORIZED",
  );
  assert.throws(
    () => getXTraceClient(
      { stage: "explicit_recall", allowLive: true },
      { XTRACE_API_KEY: "mmk_test", XTRACE_DRY_RUN: "1" },
    ),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "XTRACE_LIVE_EXECUTION_NOT_AUTHORIZED",
  );
});

test("distributed XTrace limiter coordinates through PostgreSQL before proceeding", async () => {
  const waits: number[] = [];
  let requests = 0;
  const limiter = createPersistentXTraceRateLimiter({
    url: "https://database.example",
    serviceRoleKey: "server-only",
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
    },
    fetchImpl: async (_url, init) => {
      requests += 1;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.p_scope, "xtrace-api");
      assert.equal(body.p_limit, 25);
      return Response.json([requests === 1
        ? { allowed: false, retry_after_seconds: 2 }
        : { allowed: true, retry_after_seconds: 0 }]);
    },
  });

  await limiter.acquire();
  assert.deepEqual(waits, [2_000]);
  assert.equal(requests, 2);
});

test("resolves recalled memory to local Deal and evidence IDs", async () => {
  const client = {
    search: async () => ({
      success: true,
      data: [{ id: "mem_1", text: "Passed until regulation changes", score: 0.91 }],
    }),
  };
  const service = createXTraceService(client as never, {
    workspaceId: "demo",
    resolveMemory: async () => ({
      dealId: "deal_1",
      sourceIds: ["source_1"],
      provenance: "demo_fixture",
    }),
  });

  const result = await service.recallDealContext({
    workspaceId: "demo",
    query: "Which deals were blocked by regulation?",
    candidateDealIds: ["deal_1"],
    limit: 5,
  });

  assert.deepEqual(result[0], {
    dealId: "deal_1",
    memoryId: "mem_1",
    memoryType: undefined,
    text: "Passed until regulation changes",
    score: 0.91,
    provenance: "demo_fixture",
    sourceRevisionIds: [],
    sourceIds: ["source_1"],
    fixtureIds: [],
  });
});

test("fails closed when a search client reports an unsuccessful provider envelope", async () => {
  const service = createXTraceService({
    search: async () => ({ success: false, data: [] }),
  } as never, {
    workspaceId: "demo",
    resolveMemory: async () => null,
  });

  await assert.rejects(
    service.recallDealContext({
      workspaceId: "demo",
      query: "Which deals were blocked by regulation?",
      candidateDealIds: ["deal_1"],
      limit: 5,
    }),
    XTraceUnavailableError,
  );
});

test("fails closed when a search client omits both accepted envelope discriminants", async () => {
  const service = createXTraceService({
    search: async () => ({ data: [] }),
  } as never, {
    workspaceId: "demo",
    resolveMemory: async () => null,
  });

  await assert.rejects(
    service.recallDealContext({
      workspaceId: "demo",
      query: "Which deals were blocked by regulation?",
      candidateDealIds: ["deal_1"],
      limit: 5,
    }),
    XTraceUnavailableError,
  );
});

test("preserves a sanitized XTrace HTTP failure reason for durable run diagnostics", async () => {
  const service = createXTraceService({
    search: async () => {
      throw new XTraceHttpError(422, false, "Request failed validation");
    },
  } as never, {
    workspaceId: "demo",
    resolveMemory: async () => null,
  });

  await assert.rejects(
    service.recallDealContext({
      workspaceId: "demo",
      query: "Which deals were blocked by regulation?",
      candidateDealIds: ["deal_1"],
      limit: 5,
    }),
    (error: unknown) => {
      assert.ok(error instanceof XTraceUnavailableError);
      assert.equal(error.message, "Request failed validation");
      assert.equal(error.retryable, false);
      return true;
    },
  );
});

test("serializes provenance before persisting an async ingest job", async () => {
  let received: unknown;
  const persisted: unknown[] = [];
  const service = createXTraceService({
    ingest: async (input: unknown) => {
      received = input;
      return { id: "job_1", status: "pending" };
    },
  } as never, {
    workspaceId: "workspace_demo",
    persistIngest: (record) => { persisted.push(record); },
  });

  await service.ingestDealMemory(bundle);

  const request = received as {
    messages: Array<{ role: string; content: string }>;
    user_id: string;
    conv_id: string;
    app_id: string;
  };
  assert.deepEqual(Object.keys(request).sort(), ["app_id", "conv_id", "messages", "user_id"]);
  assert.equal(request.user_id, "workspace:workspace_demo");
  assert.equal(request.conv_id, "deal:deal_1");
  assert.equal(request.app_id, "xtrace-vc-deal-intelligence");
  const message = request.messages[0].content;
  assert.match(message, /\[source_document\]/);
  assert.match(message, /\[demo_fixture\]/);
  assert.match(message, /label=Sample decision record/);
  assert.match(message, /decision_reason=The synthetic team passed pending a clearer regulatory path/);
  assert.deepEqual(persisted, [{ dealId: "deal_1", jobId: "job_1", status: "pending", memoryIds: [] }]);
});

test("records demo-only bundle memory lineage as demo fixture provenance", async () => {
  const lineage = createMemoryXTraceLineageRepository();
  const service = createXTraceService({
    ingest: async () => ({
      id: "job_demo",
      status: "succeeded",
      result: {
        memories_created: [{
          id: "mem_demo",
          type: "fact",
          text: "Synthetic workflow adoption context.",
        }],
      },
    }),
  } as never, {
    workspaceId: "workspace_demo",
    lineageRepository: lineage,
  });

  await service.ingestDealMemory({
    dealId: "deal_demo",
    companyName: "Synthetic Workflow Co",
    status: "passed",
    facts: [{
      text: "Synthetic Workflow Co builds enterprise workflow software.",
      sources: [{
        id: "source_demo",
        provenance: "demo_fixture",
        title: "Synthetic workflow fixture",
        excerpt: "Synthetic Workflow Co builds enterprise workflow software.",
      }],
    }],
    interactions: [{
      id: "fixture_demo",
      occurredAt: "2026-07-01T00:00:00.000Z",
      summary: "Passed because adoption was early.",
      decisionReason: "The synthetic team passed pending stronger adoption evidence.",
      concerns: [],
      revisitConditions: ["Enterprise workflow adoption increases."],
      provenance: "demo_fixture",
      label: DEMO_FIXTURE_LABEL,
    }],
  });

  const resolved = await lineage.resolve({
    memoryId: "mem_demo",
    workspaceId: "workspace_demo",
  });
  assert.equal(resolved?.provenance, "demo_fixture");
});

test("reuses an equivalent non-failed XTrace ingest instead of creating a duplicate", async () => {
  let ingestCalls = 0;
  let sentMessage = "";
  const lineage = createMemoryXTraceLineageRepository();
  const service = createXTraceService({
    ingest: async (input: { messages: Array<{ content: string }> }) => {
      ingestCalls += 1;
      sentMessage = input.messages[0].content;
      return { id: `job_${ingestCalls}`, status: "pending" };
    },
  } as never, {
    workspaceId: "workspace_demo",
    lineageRepository: lineage,
  });

  const first = await service.ingestDealMemory(bundle);
  const second = await service.ingestDealMemory(bundle);

  assert.equal(ingestCalls, 1);
  assert.deepEqual(second, first);
  const [storedJob] = await lineage.listOpenJobs("workspace_demo");
  assert.equal(
    storedJob.bundleFingerprint,
    createHash("sha256").update(sentMessage, "utf8").digest("hex"),
  );
  assert.equal(storedJob.serializerVersion, "deal-memory-v1");
});

test("does not reuse a succeeded ingest that produced no memories", async () => {
  let ingestCalls = 0;
  const lineage = createMemoryXTraceLineageRepository();
  const service = createXTraceService({
    ingest: async () => {
      ingestCalls += 1;
      return { id: `job_${ingestCalls}`, status: "pending" };
    },
  } as never, {
    workspaceId: "workspace_demo",
    lineageRepository: lineage,
  });

  const first = await service.ingestDealMemory(bundle);
  await lineage.recordCompletion({
    workspaceId: "workspace_demo",
    jobId: first.jobId,
    status: "succeeded",
    memoryIds: [],
  });

  const second = await service.ingestDealMemory(bundle);

  assert.equal(
    ingestCalls,
    2,
    "an empty succeeded ingest must not satisfy fingerprint reuse, otherwise "
    + "a Deal whose extraction produced zero memories can never be recalled",
  );
  assert.notEqual(second.jobId, first.jobId);
});

test("does not reuse an XTrace ingest when serialized decision content changes", async () => {
  let ingestCalls = 0;
  const lineage = createMemoryXTraceLineageRepository();
  const service = createXTraceService({
    ingest: async () => {
      ingestCalls += 1;
      return { id: `job_${ingestCalls}`, status: "pending" };
    },
  } as never, {
    workspaceId: "workspace_demo",
    lineageRepository: lineage,
  });
  const revisedBundle = structuredClone(bundle);
  revisedBundle.interactions[0].decisionReason =
    "The synthetic team now passed because the regulatory pathway materially changed.";

  await service.ingestDealMemory(bundle);
  await service.ingestDealMemory(revisedBundle);

  assert.equal(ingestCalls, 2);
});

test("does not reuse an XTrace ingest across serializer versions", async () => {
  let ingestCalls = 0;
  const lineage = createMemoryXTraceLineageRepository();
  const client = {
    ingest: async () => {
      ingestCalls += 1;
      return { id: `job_${ingestCalls}`, status: "pending" };
    },
  };
  const versionOne = createXTraceService(client as never, {
    workspaceId: "workspace_demo",
    lineageRepository: lineage,
    serializerVersion: "deal-memory-v1",
  });
  const versionTwo = createXTraceService(client as never, {
    workspaceId: "workspace_demo",
    lineageRepository: lineage,
    serializerVersion: "deal-memory-v2",
  });

  await versionOne.ingestDealMemory(bundle);
  await versionTwo.ingestDealMemory(bundle);

  assert.equal(ingestCalls, 2);
});

test("Supabase lineage persists and queries fingerprint plus serializer version", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const repository = createSupabaseXTraceLineageRepository({
    url: "https://database.example.test",
    serviceRoleKey: "test-service-role",
    fetchImpl: async (input, init) => {
      requests.push({ url: String(input), init });
      if (init?.method === "POST") return new Response(null, { status: 204 });
      return Response.json([{
        job_id: "job_1",
        workspace_id: "workspace_demo",
        deal_id: "deal_1",
        source_ids: ["source_1"],
        fixture_ids: ["fixture_1"],
        bundle_fingerprint: "a".repeat(64),
        serializer_version: "deal-memory-v1",
        provenance: "source_document",
        status: "succeeded",
        memory_ids: ["mem_1"],
      }]);
    },
  });
  const reuseContract = {
    workspaceId: "workspace_demo",
    dealId: "deal_1",
    sourceIds: ["source_1"],
    fixtureIds: ["fixture_1"],
    bundleFingerprint: "a".repeat(64),
    serializerVersion: "deal-memory-v1",
  };

  await repository.recordSubmission({
    jobId: "job_1",
    ...reuseContract,
    provenance: "source_document",
    status: "pending",
  });
  const reusable = await repository.findReusableIngest(reuseContract);

  const submission = JSON.parse(String(requests[0].init?.body)) as Record<string, unknown>;
  assert.equal(submission.bundle_fingerprint, "a".repeat(64));
  assert.equal(submission.serializer_version, "deal-memory-v1");
  const reuseUrl = new URL(requests[1].url);
  assert.equal(reuseUrl.searchParams.get("bundle_fingerprint"), `eq.${"a".repeat(64)}`);
  assert.equal(reuseUrl.searchParams.get("serializer_version"), "eq.deal-memory-v1");
  assert.equal(reusable?.bundleFingerprint, "a".repeat(64));
  assert.equal(reusable?.serializerVersion, "deal-memory-v1");
});

test("polls pending jobs with exponential backoff and persists created memory IDs", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const persisted: unknown[] = [];
  const lineage = createMemoryXTraceLineageRepository();
  await lineage.recordSubmission({
    jobId: "job_1",
    workspaceId: "workspace_demo",
    dealId: "deal_1",
    sourceIds: ["source_1"],
    fixtureIds: ["fixture_1"],
    bundleFingerprint: "existing-test-fingerprint",
    serializerVersion: "deal-memory-v1",
    provenance: "source_document",
    status: "pending",
  });
  const service = createXTraceService({
    getJob: async () => {
      calls += 1;
      return calls === 1
        ? { id: "job_1", status: "pending" }
        : { id: "job_1", status: "succeeded", result: { memories_created: [{ id: "mem_1", type: "fact", text: "Created" }] } };
    },
  } as never, {
    workspaceId: "workspace_demo",
    persistIngest: (record) => { persisted.push(record); },
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
    lineageRepository: lineage,
  });

  const result = await service.pollIngestJob("job_1", { dealId: "deal_1" });

  assert.deepEqual(result, { dealId: "deal_1", jobId: "job_1", status: "succeeded", memoryIds: ["mem_1"] });
  assert.deepEqual(sleeps, [500]);
  assert.deepEqual(persisted.at(-1), result);
});

test("lists only non-terminal XTrace ingest jobs for the requested workspace", async () => {
  const lineage = createMemoryXTraceLineageRepository();
  for (const job of [
    { jobId: "pending", workspaceId: "workspace_demo", dealId: "deal_1", status: "pending" as const },
    { jobId: "running", workspaceId: "workspace_demo", dealId: "deal_2", status: "running" as const },
    { jobId: "done", workspaceId: "workspace_demo", dealId: "deal_3", status: "succeeded" as const },
    { jobId: "other", workspaceId: "workspace_other", dealId: "deal_4", status: "pending" as const },
  ]) {
    await lineage.recordSubmission({
      ...job,
      sourceIds: ["source_1"],
      fixtureIds: [],
      bundleFingerprint: `fingerprint-${job.jobId}`,
      serializerVersion: "deal-memory-v1",
      provenance: "source_document",
    });
  }

  const jobs = await lineage.listOpenJobs("workspace_demo");

  assert.deepEqual(jobs.map((job) => [job.jobId, job.dealId, job.status]), [
    ["pending", "deal_1", "pending"],
    ["running", "deal_2", "running"],
  ]);
});

test("identical XTrace job and memory ids remain isolated by workspace", async () => {
  const lineage = createMemoryXTraceLineageRepository();
  for (const workspaceId of ["workspace_one", "workspace_two"]) {
    await lineage.recordSubmission({
      jobId: "job_shared",
      workspaceId,
      dealId: "deal_shared",
      sourceIds: [`source_${workspaceId}`],
      fixtureIds: [],
      bundleFingerprint: `fingerprint-${workspaceId}`,
      serializerVersion: "deal-memory-v1",
      provenance: "source_document",
      status: "pending",
    });
  }

  await lineage.recordCompletion({
    workspaceId: "workspace_one",
    jobId: "job_shared",
    status: "succeeded",
    memoryIds: ["memory_shared"],
  });

  assert.deepEqual(
    (await lineage.listOpenJobs("workspace_two")).map((job) => job.jobId),
    ["job_shared"],
  );
  assert.equal(
    (await lineage.resolve({
      workspaceId: "workspace_one",
      memoryId: "memory_shared",
    }))?.sourceIds[0],
    "source_workspace_one",
  );
  assert.equal(
    await lineage.resolve({
      workspaceId: "workspace_two",
      memoryId: "memory_shared",
    }),
    null,
  );
});

test("memory lineage rejects a residual provider memory that is absent from exact local memory ids", async () => {
  const lineage = createMemoryXTraceLineageRepository();
  await lineage.recordSubmission({
    jobId: "job_clean_text",
    workspaceId: "workspace_demo",
    dealId: "deal_1",
    sourceRevisionIds: ["revision_clean_text"],
    sourceIds: ["source_clean_text"],
    fixtureIds: [],
    bundleFingerprint: "clean-text-fingerprint",
    serializerVersion: "deal-memory-v1",
    provenance: "source_document",
    status: "pending",
  });
  await lineage.recordCompletion({
    workspaceId: "workspace_demo",
    jobId: "job_clean_text",
    status: "succeeded",
    memoryIds: ["memory_clean_text"],
  });

  assert.equal(
    await lineage.resolve({
      workspaceId: "workspace_demo",
      memoryId: "memory_quarantined_image_residual",
      convId: "deal:deal_1",
    }),
    null,
  );
  assert.equal(
    (await lineage.resolve({
      workspaceId: "workspace_demo",
      memoryId: "memory_clean_text",
      convId: "deal:deal_1",
    }))?.sourceRevisionIds[0],
    "revision_clean_text",
  );
});

test("Supabase v2 lineage never recovers a missing direct child link from conv-id", async () => {
  const requests: string[] = [];
  const repository = createSupabaseXTraceLineageRepository({
    url: "https://database.example.test",
    serviceRoleKey: "test-service-role",
    fetchImpl: async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("/xtrace_memory_links?")) return Response.json([]);
      return Response.json([{
        job_id: "job_clean_text",
        workspace_id: "workspace_demo",
        deal_id: "deal_1",
        source_revision_ids: ["revision_clean_text"],
        source_ids: ["source_clean_text"],
        fixture_ids: [],
        bundle_fingerprint: "clean-text-fingerprint",
        serializer_version: "deal-memory-v1",
        provenance: "source_document",
        status: "succeeded",
        memory_ids: ["memory_clean_text"],
      }]);
    },
  });

  assert.equal(
    await repository.resolve({
      workspaceId: "workspace_demo",
      memoryId: "memory_quarantined_image_residual",
      convId: "deal:deal_1",
    }),
    null,
  );
  assert.equal(
    await repository.resolve({
      workspaceId: "workspace_demo",
      memoryId: "memory_clean_text",
      convId: "deal:deal_1",
    }),
    null,
  );
  assert.equal(requests.length, 2);
});

test("keeps polling through running and throws when the polling budget is exhausted", async () => {
  let calls = 0;
  const lineage = createMemoryXTraceLineageRepository();
  await lineage.recordSubmission({
    jobId: "job_running",
    workspaceId: "workspace_demo",
    dealId: "deal_1",
    sourceIds: ["source_1"],
    fixtureIds: [],
    bundleFingerprint: "running-test-fingerprint",
    serializerVersion: "deal-memory-v1",
    provenance: "source_document",
    status: "running",
  });
  const service = createXTraceService({
    getJob: async () => {
      calls += 1;
      return { id: "job_running", status: "running" };
    },
  } as never, {
    workspaceId: "workspace_demo",
    lineageRepository: lineage,
    sleep: async () => undefined,
  });

  await assert.rejects(
    service.pollIngestJob("job_running", {
      dealId: "deal_1",
      maxAttempts: 2,
      initialDelayMs: 1,
    }),
    XTracePollingTimeoutError,
  );
  assert.equal(calls, 2);
  assert.deepEqual(
    (await lineage.listOpenJobs("workspace_demo")).map((job) => [
      job.jobId,
      job.status,
    ]),
    [["job_running", "running"]],
  );
});

test("persists memory lineage and resolves it without parsing extracted text", async () => {
  const lineage = createMemoryXTraceLineageRepository();
  let searches = 0;
  const service = createXTraceService({
    ingest: async () => ({ id: "job_1", status: "pending" }),
    getJob: async () => ({
      id: "job_1",
      status: "succeeded",
      result: {
        memories_created: [{
          id: "mem_1",
          type: "fact",
          text: "XTrace rewrote this fact and omitted every client token.",
        }],
      },
    }),
    search: async () => {
      searches += 1;
      return {
        success: true,
        data: [{
          id: "mem_1",
          text: "XTrace rewrote this fact and omitted every client token.",
          score: 0.9,
          conv_id: "deal:deal_1",
        }],
      };
    },
  } as never, {
    workspaceId: "workspace_demo",
    lineageRepository: lineage,
    sleep: async () => undefined,
  });

  const submitted = await service.ingestDealMemory(bundle);
  await service.pollIngestJob(submitted.jobId, { dealId: bundle.dealId });
  const result = await service.recallDealContext({
    workspaceId: "workspace_demo",
    query: "regulatory path",
    candidateDealIds: ["deal_1"],
    limit: 5,
  });

  assert.equal(searches, 1);
  assert.equal(result[0].dealId, "deal_1");
  assert.equal(result[0].provenance, "source_document");
  assert.deepEqual(result[0].sourceIds, ["source_1"]);
  assert.deepEqual(result[0].fixtureIds, ["fixture_1"]);
});

test("uses one workspace namespace for default ingest and recall", async () => {
  let ingestUser = "";
  let searchUser = "";
  const service = createXTraceService({
    ingest: async (input: { user_id: string }) => {
      ingestUser = input.user_id;
      return { id: "job_1", status: "succeeded", result: { memories_created: [] } };
    },
    search: async (input: { user_id: string }) => {
      searchUser = input.user_id;
      return { success: true, data: [] };
    },
  } as never, {
    workspaceId: "workspace_demo",
    lineageRepository: createMemoryXTraceLineageRepository(),
  });

  await service.ingestDealMemory(bundle);
  await service.recallDealContext({
    workspaceId: "workspace_demo",
    query: "test",
    candidateDealIds: ["deal_1"],
    limit: 1,
  });
  assert.equal(ingestUser, "workspace:workspace_demo");
  assert.equal(searchUser, ingestUser);
});

test("normalizes the scoped workspace before XTrace recall and caching", async () => {
  const searchUsers: string[] = [];
  const service = createXTraceService({
    search: async (input: { user_id: string }) => {
      searchUsers.push(input.user_id);
      return { success: true, data: [] };
    },
  } as never, {
    workspaceId: "workspace_demo",
  });
  const input = {
    query: "test",
    candidateDealIds: ["deal_1"],
    limit: 1,
  };

  await service.recallDealContext({
    ...input,
    workspaceId: " workspace_demo ",
  });
  await service.recallDealContext({
    ...input,
    workspaceId: "workspace_demo",
  });

  assert.deepEqual(searchUsers, ["workspace:workspace_demo"]);
});

test("a shared limiter throttles calls across multiple service instances", async () => {
  let now = 0;
  const sleeps: number[] = [];
  const limiter = createXTraceRateLimiter(
    () => now,
    async (milliseconds) => {
      sleeps.push(milliseconds);
      now += milliseconds;
    },
    2,
    60_000,
  );
  const client = { search: async () => ({ success: true as const, data: [] }) };
  const first = createXTraceService(client as never, {
    workspaceId: "workspace_demo",
    limiter,
  });
  const second = createXTraceService(client as never, {
    workspaceId: "workspace_demo",
    limiter,
  });
  const input = {
    workspaceId: "workspace_demo",
    query: "query",
    candidateDealIds: ["deal_1"],
    limit: 1,
  };

  await first.recallDealContext({ ...input, runId: "one" });
  await second.recallDealContext({ ...input, runId: "two" });
  await first.recallDealContext({ ...input, runId: "three" });

  assert.deepEqual(sleeps, [60_000]);
});

test("caches recalls by query fingerprint and excludes memories outside the candidate set", async () => {
  let searchCalls = 0;
  let resolveCalls = 0;
  const service = createXTraceService({
    search: async () => {
      searchCalls += 1;
      return {
        success: true,
        data: [
          { id: "mem_1", text: "Relevant", score: 0.91 },
          { id: "mem_2", text: "Not a candidate", score: 0.8 },
        ],
      };
    },
  } as never, {
    workspaceId: "demo",
    resolveMemory: async () => {
      resolveCalls += 1;
      return resolveCalls === 1
        ? { dealId: "deal_1", sourceIds: ["source_1"], provenance: "demo_fixture" }
        : { dealId: "deal_2", sourceIds: ["source_2"], provenance: "demo_fixture" };
    },
  });
  const input = { workspaceId: "demo", query: "What changed?", candidateDealIds: ["deal_1"], limit: 5 };

  assert.equal((await service.recallDealContext(input)).length, 1);
  assert.equal((await service.recallDealContext(input)).length, 1);
  assert.equal(searchCalls, 1);
});

test("recall cache identity binds evidence context and active-parent fingerprints", async () => {
  let searchCalls = 0;
  const service = createXTraceService({
    search: async () => {
      searchCalls += 1;
      return { success: true, data: [] };
    },
  } as never, {
    workspaceId: "demo",
    limiter: { async acquire() {} },
  });
  const base = {
    workspaceId: "demo",
    query: "What changed?",
    candidateDealIds: ["deal_1"],
    limit: 5,
    evidenceContextFingerprint: `sha256:${"a".repeat(64)}`,
    activeParentFingerprint: `sha256:${"b".repeat(64)}`,
  };

  await service.recallDealContext(base);
  await service.recallDealContext({
    ...base,
    activeParentFingerprint: `sha256:${"c".repeat(64)}`,
  });
  await service.recallDealContext({
    ...base,
    evidenceContextFingerprint: `sha256:${"d".repeat(64)}`,
  });

  assert.equal(searchCalls, 3);
});

test("concurrent exact-parent reserves permit exactly one provider POST", async () => {
  let posts = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const lineage = createMemoryXTraceLineageRepository();
  const service = createXTraceService({
    ingest: async () => {
      posts += 1;
      await pending;
      return { id: "job_exact_1", status: "pending" };
    },
  } as never, {
    workspaceId: "workspace_demo",
    lineageRepository: lineage,
    limiter: { async acquire() {} },
  });

  const first = service.ingestExactParent(exactParent);
  const second = service.ingestExactParent(exactParent);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(posts, 1);
  release();
  const results = await Promise.all([first, second]);
  assert.equal(results.filter((result) => result.state === "submitted").length, 2);
});

test("an expired submitter lease becomes submission_unknown and cannot attach", async () => {
  let now = Date.parse("2026-08-03T00:00:00.000Z");
  const lineage = createMemoryXTraceLineageRepository({
    now: () => now,
  } as never);
  const first = await lineage.reserveExactIntent({
    parent: exactParent,
    serializerVersion: "xtrace-parent-v2",
  });
  assert.equal(first.action, "submit");
  now += 5 * 60_000 + 1;

  const expired = await lineage.reserveExactIntent({
    parent: exactParent,
    serializerVersion: "xtrace-parent-v2",
  });
  assert.equal(expired.action, "blocked");
  assert.equal(expired.intent.state, "submission_unknown");
  await assert.rejects(lineage.attachExactJob({
    intentId: first.intent.intentId,
    leaseToken: first.intent.leaseToken!,
    providerJobId: "late_job",
  }), /lease is not active/i);
});

test("waiting for another exact submitter is bounded", async () => {
  const lineage = createMemoryXTraceLineageRepository({
    waitTimeoutMs: 5,
  } as never);
  const first = await lineage.reserveExactIntent({
    parent: exactParent,
    serializerVersion: "xtrace-parent-v2",
  });
  const outcome = await Promise.race([
    lineage.waitForExactIntent(first.intent.intentId).then(
      () => "resolved",
      () => "rejected",
    ),
    new Promise<string>((resolve) => setTimeout(() => resolve("still_pending"), 25)),
  ]);
  assert.equal(outcome, "rejected");
});

test("Supabase exact-intent waiting polls a bounded number of times", async () => {
  let requests = 0;
  const repository = createSupabaseXTraceLineageRepository({
    url: "https://example.invalid",
    serviceRoleKey: "test-key",
    waitAttempts: 3,
    sleep: async () => undefined,
    fetchImpl: async () => {
      requests += 1;
      return new Response(JSON.stringify([{
        intent_id: "intent_wait",
        workspace_id: "workspace_demo",
        deal_id: "deal_1",
        parent_kind: "legacy_source_revision",
        source_id: "source_1",
        source_revision_id: "revision_1",
        parent_fingerprint: `sha256:${"a".repeat(64)}`,
        payload_fingerprint: `sha256:${"b".repeat(64)}`,
        serializer_version: "xtrace-parent-v2",
        state: "submitting",
        state_history: ["reserved", "submitting"],
        lease_token: "lease_1",
        lease_expires_at: "2026-08-03T00:05:00.000Z",
        provider_job_id: null,
        memory_ids: [],
      }]), { status: 200 });
    },
  });

  await assert.rejects(
    repository.waitForExactIntent("intent_wait"),
    /wait timed out/i,
  );
  assert.equal(requests, 3);
});

test("an ambiguous exact-parent POST becomes submission_unknown and is never resent", async () => {
  let posts = 0;
  const lineage = createMemoryXTraceLineageRepository();
  const service = createXTraceService({
    ingest: async () => {
      posts += 1;
      throw new XTraceHttpError(0, true, "private query must not persist");
    },
  } as never, {
    workspaceId: "workspace_demo",
    lineageRepository: lineage,
    limiter: { async acquire() {} },
  });

  await assert.rejects(service.ingestExactParent(exactParent), (error: unknown) =>
    error instanceof Error
    && "code" in error
    && error.code === "XTRACE_SUBMISSION_UNKNOWN"
    && !error.message.includes("private query")
  );
  const retry = await service.ingestExactParent(exactParent);

  assert.equal(posts, 1);
  assert.equal(retry.state, "submission_unknown");
  assert.equal(retry.providerJobId, null);
});

test("exact-parent polling finalizes a submitted job and creates direct child lineage", async () => {
  let polls = 0;
  const lineage = createMemoryXTraceLineageRepository({
    isParentActive: () => true,
  });
  const service = createXTraceService({
    ingest: async () => ({ id: "job_exact_poll", status: "pending" }),
    getJob: async () => {
      polls += 1;
      return polls === 1
        ? { id: "job_exact_poll", status: "running" }
        : {
            id: "job_exact_poll",
            status: "succeeded",
            result: {
              memories_created: [{ id: "memory_exact_poll", type: "fact", text: "Created" }],
            },
          };
    },
  } as never, {
    workspaceId: "workspace_demo",
    lineageRepository: lineage,
    limiter: { async acquire() {} },
    sleep: async () => undefined,
  });

  const submitted = await service.ingestExactParent(exactParent);
  const completed = await service.pollExactIntent({
    intentId: submitted.intentId,
    providerJobId: submitted.providerJobId!,
    maxAttempts: 3,
    initialDelayMs: 1,
  });

  assert.equal(completed.state, "succeeded");
  assert.deepEqual(completed.memoryIds, ["memory_exact_poll"]);
  assert.equal(polls, 2);
  assert.deepEqual(await lineage.resolveExact({
    workspaceId: "workspace_demo",
    memoryId: "memory_exact_poll",
    dealId: "deal_1",
    activeParentFingerprint: `sha256:${"f".repeat(64)}`,
  }), {
    memoryId: "memory_exact_poll",
    workspaceId: "workspace_demo",
    dealId: "deal_1",
    sourceRevisionIds: ["revision_1"],
    sourceIds: ["source_1"],
    fixtureIds: [],
    provenance: "source_document",
  });
});

test("exact succeeded intent reuses while payload, job, and child collisions fail closed", async () => {
  let posts = 0;
  const lineage = createMemoryXTraceLineageRepository();
  const service = createXTraceService({
    ingest: async () => {
      posts += 1;
      return {
        id: "job_collision",
        status: "succeeded",
        result: {
          memories_created: [{ id: "memory_collision", type: "fact", text: "Created" }],
        },
      };
    },
  } as never, {
    workspaceId: "workspace_demo",
    lineageRepository: lineage,
    limiter: { async acquire() {} },
  });

  const first = await service.ingestExactParent(exactParent);
  const reused = await service.ingestExactParent(exactParent);
  assert.equal(first.state, "succeeded");
  assert.equal(reused.reused, true);
  assert.equal(posts, 1);

  await assert.rejects(
    service.ingestExactParent({
      ...exactParent,
      payloadFingerprint: `sha256:${"c".repeat(64)}`,
    }),
    /different immutable payload/i,
  );
  await assert.rejects(
    service.ingestExactParent({
      ...exactParent,
      dealId: "deal_2",
      sourceId: "source_2",
      sourceRevisionId: "revision_2",
      parentFingerprint: `sha256:${"d".repeat(64)}`,
      payloadFingerprint: `sha256:${"e".repeat(64)}`,
      bundle: { ...bundle, dealId: "deal_2" },
    }),
    /provider job|memory child/i,
  );
});

test("recall audit persistence failure blocks matching for only that Deal", async () => {
  const lineage = createMemoryXTraceLineageRepository({
    persistRecallAudit: async (audit) => {
      if (audit.dealId === "deal_1") throw new Error("database unavailable");
    },
  });
  const service = createXTraceService({
    search: async () => ({ success: true, data: [] }),
  } as never, {
    workspaceId: "workspace_demo",
    lineageRepository: lineage,
    limiter: { async acquire() {} },
  });

  await assert.rejects(
    service.recallDealContext({
      workspaceId: "workspace_demo",
      runId: "00000000-0000-4000-8000-000000000001",
      query: "What changed?",
      candidateDealIds: ["deal_1"],
      limit: 5,
      evidenceContextFingerprint: `sha256:${"1".repeat(64)}`,
      activeParentFingerprint: `sha256:${"2".repeat(64)}`,
    }),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "XTRACE_RECALL_AUDIT_FAILED",
  );
});

test("a stale exact parent fails only its Deal while another active parent recalls", async () => {
  const inactive = new Set(["source_1"]);
  const lineage = createMemoryXTraceLineageRepository({
    isParentActive: ({ sourceId }) => !inactive.has(sourceId),
  });
  const secondBundle = {
    ...structuredClone(bundle),
    dealId: "deal_2",
    companyName: "Beacon Systems",
  };
  const secondParent: ExactXTraceParentUnit = {
    ...exactParent,
    dealId: "deal_2",
    sourceId: "source_2",
    sourceRevisionId: "revision_2",
    parentFingerprint: `sha256:${"c".repeat(64)}`,
    payloadFingerprint: `sha256:${"d".repeat(64)}`,
    bundle: secondBundle,
  };
  const service = createXTraceService({
    ingest: async (input: { conv_id: string }) => {
      const isSecond = input.conv_id.includes("deal_2");
      return {
        id: isSecond ? "job_2" : "job_1",
        status: "succeeded",
        result: {
          memories_created: [{
            id: isSecond ? "memory_2" : "memory_1",
            type: "fact",
            text: isSecond ? "Beacon context" : "Asteria context",
          }],
        },
      };
    },
    search: async (input: { query: string }) => ({
      success: true,
      data: input.query.includes("Beacon Systems")
        ? [{ id: "memory_2", text: "Beacon context", score: 0.9 }]
        : [{ id: "memory_1", text: "Asteria context", score: 0.9 }],
    }),
  } as never, {
    workspaceId: "workspace_demo",
    lineageRepository: lineage,
    limiter: { async acquire() {} },
  });
  await service.ingestExactParent(exactParent);
  await service.ingestExactParent(secondParent);

  const recalled = await recallAllDealContexts({
    workspaceId: "workspace_demo",
    runId: "run_1",
    bundles: [bundle, secondBundle],
    service,
    evidenceContextFingerprint: `sha256:${"e".repeat(64)}`,
    activeParentFingerprints: new Map([
      ["deal_1", `sha256:${"f".repeat(64)}`],
      ["deal_2", `sha256:${"0".repeat(64)}`],
    ]),
  });

  assert.deepEqual(recalled.failures.map((failure) => failure.dealId), ["deal_1"]);
  assert.equal(recalled.failures[0].message, "XTRACE_RECALL_LINEAGE_FAILED");
  assert.deepEqual(recalled.contextsByDeal.get("deal_2")?.map((context) => ({
    dealId: context.dealId,
    sourceRevisionIds: context.sourceRevisionIds,
    sourceIds: context.sourceIds,
  })), [{
    dealId: "deal_2",
    sourceRevisionIds: ["revision_2"],
    sourceIds: ["source_2"],
  }]);
});

test("surfaces provider failures as typed unavailable errors", async () => {
  const service = createXTraceService({
    search: async () => { throw new Error("provider unavailable"); },
  } as never, { workspaceId: "demo" });

  await assert.rejects(
    service.recallDealContext({ workspaceId: "demo", query: "What changed?", candidateDealIds: ["deal_1"], limit: 5 }),
    XTraceUnavailableError,
  );
});

test("uses the bridge to persist and complete a worker ingest stage", async () => {
  const calls: Array<[string, unknown]> = [];
  const result = await ingestMemoryStage(bundle, {
    workspaceId: "workspace_demo",
    service: {
      ingestDealMemory: async () => ({ dealId: "deal_1", jobId: "job_1", status: "pending", memoryIds: [] }),
      pollIngestJob: async (jobId, options) => {
        calls.push([jobId, options]);
        return { dealId: "deal_1", jobId, status: "succeeded", memoryIds: ["mem_1"] };
      },
    },
  });

  assert.deepEqual(calls, [["job_1", { dealId: "deal_1" }]]);
  assert.deepEqual(result, { dealId: "deal_1", jobId: "job_1", status: "succeeded", memoryIds: ["mem_1"] });
});

if (false) {
  // @ts-expect-error lower-level XTrace services must select a trusted workspace
  createXTraceService({} as never);
  // @ts-expect-error worker ingest stages must receive the claimed workspace
  void ingestMemoryStage({} as never);
}
