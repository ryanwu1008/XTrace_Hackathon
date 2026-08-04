import assert from "node:assert/strict";
import test from "node:test";

import {
  createMemoryDealRegistry,
  createSupabaseDealRegistry,
  eligibleDealSnapshotFingerprint,
  sourceRevisionFingerprint,
  type ConfirmSourceAssignmentInput,
  type RegisteredDeal,
} from "../../db/repositories/deal-registry";
import {
  createMemorySourceRegistry,
  type CreateSourceRevisionInput,
  type SourceRegistry,
} from "../../db/repositories/source-registry";
import type {
  DealMemoryBundle,
  DealStatus,
} from "../../lib/contracts/domain";
import { backfillPreloadedSourceRegistry } from "../../scripts/backfill-source-registry";

function revisionInput(
  workspaceId: string,
  sourceId: string,
  id: string,
  contentHash: string,
): CreateSourceRevisionInput {
  return {
    id,
    workspaceId,
    sourceId,
    contentHash,
    objectKey: `private/${workspaceId}/${sourceId}`,
    objectVersion: contentHash,
    contentType: "application/pdf",
    extractorId: "pdf-text",
    extractorVersion: "1.0.0",
    extractedAt: "2026-07-28T10:00:00.000Z",
    createdAt: "2026-07-28T10:00:01.000Z",
  };
}

function bundle(
  dealId: string,
  companyName: string,
  status: DealStatus = "screening",
): DealMemoryBundle {
  return {
    dealId,
    companyName,
    status,
    facts: [],
    interactions: [],
  };
}

async function assignment(
  sourceRegistry: SourceRegistry,
  overrides: Partial<ConfirmSourceAssignmentInput> & {
    workspaceId: string;
    dealId: string;
    sourceId: string;
  },
): Promise<ConfirmSourceAssignmentInput> {
  const sourceRevision = await sourceRegistry.createInitialRevision(
    revisionInput(
      overrides.workspaceId,
      overrides.sourceId,
      `${overrides.workspaceId}:${overrides.sourceId}:revision:1`,
      `hash_${overrides.sourceId}`,
    ),
  );
  const companyName = overrides.companyName ?? `Company ${overrides.dealId}`;
  return {
    requestId: overrides.requestId ?? `request:${overrides.dealId}`,
    workspaceId: overrides.workspaceId,
    dealId: overrides.dealId,
    companyId: overrides.companyId ?? `company:${overrides.dealId}`,
    companyName,
    status: overrides.status ?? "screening",
    sourceRevisionId: sourceRevision.id,
    assignedByUserId: overrides.assignedByUserId ?? "user_one",
    reason: overrides.reason ?? "Confirmed source ownership.",
    confirmedAt: overrides.confirmedAt ?? "2026-07-28T11:00:00.000Z",
    memoryBundle: overrides.memoryBundle ??
      bundle(overrides.dealId, companyName, overrides.status),
  };
}

test("seed and confirmed upload share one analysis-eligible query", async () => {
  const sources = createMemorySourceRegistry();
  const registry = createMemoryDealRegistry({ sourceRegistry: sources });
  await registry.confirmSourceAssignment(await assignment(sources, {
    workspaceId: "workspace_demo",
    dealId: "deal_seed_7bridges",
    sourceId: "doc_7bridges",
  }));
  await registry.confirmSourceAssignment(await assignment(sources, {
    workspaceId: "workspace_demo",
    dealId: "deal_uploaded",
    sourceId: "upload_one",
  }));

  const ids = (await registry.listAnalysisEligibleBundles("workspace_demo"))
    .map((item) => item.dealId)
    .sort();
  assert.deepEqual(ids, ["deal_seed_7bridges", "deal_uploaded"]);
});

test("an exact confirmed assignment remains verifiable without quote-backed memory facts", async () => {
  const sources = createMemorySourceRegistry();
  const registry = createMemoryDealRegistry({ sourceRegistry: sources });
  const input = await assignment(sources, {
    workspaceId: "workspace_image",
    dealId: "deal_image",
    sourceId: "source_image",
    companyName: "Image Co",
  });
  await registry.confirmSourceAssignment(input);
  const revision = await sources.getRevision({
    workspaceId: input.workspaceId,
    revisionId: input.sourceRevisionId,
  });
  assert.ok(revision);

  assert.deepEqual(await registry.getExactSourceBundle({
    workspaceId: input.workspaceId,
    dealId: input.dealId,
    sourceId: revision.sourceId,
    sourceRevisionId: revision.id,
  }), {
    workspaceId: input.workspaceId,
    dealId: input.dealId,
    sourceId: revision.sourceId,
    sourceRevisionId: revision.id,
    bundle: {
      dealId: input.dealId,
      companyName: input.companyName,
      status: input.status,
      facts: [],
      interactions: [],
    },
  });
});

test("the registry captures one canonical eligible Deal snapshot token", async () => {
  const sources = createMemorySourceRegistry();
  const registry = createMemoryDealRegistry({ sourceRegistry: sources });
  await registry.confirmSourceAssignment(await assignment(sources, {
    workspaceId: "workspace_demo",
    dealId: "deal_one",
    sourceId: "source_one",
  }));
  const snapshotRegistry = registry as typeof registry & {
    getAnalysisEligibleSnapshot?: (
      workspaceId: string,
    ) => Promise<{
      count: number;
      dealIds: string[];
      fingerprint: string;
    }>;
  };
  assert.equal(typeof snapshotRegistry.getAnalysisEligibleSnapshot, "function");
  const snapshot = await snapshotRegistry.getAnalysisEligibleSnapshot!(
    "workspace_demo",
  );
  assert.deepEqual(snapshot.dealIds, ["deal_one"]);
  assert.equal(snapshot.count, 1);
  assert.match(snapshot.fingerprint, /^sha256:[0-9a-f]{64}$/);
});

test("a claimed run reuses one immutable 30-Deal universe after the mutable registry changes", async () => {
  const sources = createMemorySourceRegistry();
  const registry = createMemoryDealRegistry({ sourceRegistry: sources });
  for (let index = 1; index <= 30; index += 1) {
    await registry.confirmSourceAssignment(await assignment(sources, {
      workspaceId: "workspace_30",
      dealId: `deal_${index}`,
      companyId: `company_${index}`,
      sourceId: `source_${index}`,
      status: index > 23 ? "screening" : "watchlist",
      confirmedAt: "2026-08-03T12:00:00.000Z",
    }));
  }
  const deals = await registry.listForWorkspace("workspace_30");
  const input = {
    workspaceId: "workspace_30",
    runId: "00000000-0000-4000-8000-000000000030",
    universeId: "belief_reversal_deal_universe_2026_08_03_v1",
    mode: "live" as const,
    anchorAt: "2026-08-03T13:34:43.000Z",
    evidenceSnapshotId: null,
    evidenceSnapshotFingerprint: null,
    members: deals.map((deal, ordinal) => ({
      ordinal,
      dealId: deal.id,
      companyId: deal.companyId,
      dealStatus: deal.status,
      analysisEligibleAt: deal.analysisEligibleAt!,
    })),
  };

  const first = await registry.bindRunDealUniverse(input);
  const replay = await registry.bindRunDealUniverse(structuredClone(input));

  assert.equal(first.dealCount, 30);
  assert.equal(first.universeFingerprint, replay.universeFingerprint);
  assert.deepEqual(await registry.getRunDealUniverse({
    workspaceId: input.workspaceId,
    runId: input.runId,
  }), first);
  await assert.rejects(
    registry.bindRunDealUniverse({
      ...input,
      members: input.members.slice(0, 29),
    }),
    /immutable|different|collision/i,
  );
});

test("Supabase binds then exactly reloads the final 0024 Deal-universe RPC authority", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fingerprint = `sha256:${"9".repeat(64)}`;
  const input = {
    workspaceId: "workspace_one",
    runId: "00000000-0000-4000-8000-000000000030",
    universeId: "deal_universe_current_30",
    mode: "live" as const,
    anchorAt: "2026-08-03T13:34:43.000Z",
    evidenceSnapshotId: null,
    evidenceSnapshotFingerprint: null,
    members: [{
      ordinal: 0,
      dealId: "deal_one",
      companyId: "company_one",
      dealStatus: "screening" as const,
      analysisEligibleAt: "2026-08-03T12:00:00.000Z",
    }],
  };
  const repository = createSupabaseDealRegistry({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    async fetchImpl(rawUrl, init = {}) {
      const url = String(rawUrl);
      requests.push({ url, init });
      if (url.endsWith("/rpc/save_deal_universe_snapshot_v1")) {
        return Response.json({
          created: true,
          universeId: input.universeId,
          dealCount: 1,
          universeFingerprint: fingerprint,
        });
      }
      if (url.endsWith("/rpc/bind_run_deal_universe_v1")) {
        return Response.json({
          runId: input.runId,
          universeId: input.universeId,
          universeFingerprint: fingerprint,
          dealCount: 1,
        });
      }
      if (url.includes("/run_deal_universe_bindings_v1?")) {
        return Response.json([{
          workspace_id: input.workspaceId,
          run_id: input.runId,
          schema_version: "run-deal-universe-binding-v1",
          universe_id: input.universeId,
          universe_fingerprint: fingerprint,
          deal_count: 1,
        }]);
      }
      if (url.includes("/deal_universe_snapshots_v1?")) {
        return Response.json([{
          workspace_id: input.workspaceId,
          universe_id: input.universeId,
          schema_version: "deal-universe-snapshot-v1",
          mode: input.mode,
          anchor_at: input.anchorAt,
          evidence_snapshot_id: null,
          evidence_snapshot_fingerprint: null,
          deal_count: 1,
          universe_fingerprint: fingerprint,
        }]);
      }
      if (url.includes("/deal_universe_snapshot_members_v1?")) {
        return Response.json(input.members.map((member) => ({
          ordinal: member.ordinal,
          deal_id: member.dealId,
          company_id: member.companyId,
          deal_status: member.dealStatus,
          analysis_eligible_at: member.analysisEligibleAt,
        })));
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const binding = await repository.bindRunDealUniverse(input);

  assert.deepEqual(binding, {
    ...input,
    schemaVersion: "run-deal-universe-binding-v1",
    universeFingerprint: fingerprint,
    dealCount: 1,
  });
  assert.deepEqual(
    JSON.parse(String(requests[0]!.init.body)),
    {
      p_payload: {
        schemaVersion: "deal-universe-snapshot-v1",
        workspaceId: input.workspaceId,
        universeId: input.universeId,
        mode: input.mode,
        anchorAt: input.anchorAt,
        evidenceSnapshotId: input.evidenceSnapshotId,
        evidenceSnapshotFingerprint: input.evidenceSnapshotFingerprint,
        members: input.members,
      },
    },
  );
  assert.deepEqual(
    JSON.parse(String(requests[1]!.init.body)),
    {
      p_payload: {
        schemaVersion: "run-deal-universe-binding-v1",
        workspaceId: input.workspaceId,
        runId: input.runId,
        universeId: input.universeId,
        universeFingerprint: fingerprint,
      },
    },
  );
});

test("current Deal status overlays stored memory and invalidates the eligible snapshot", async () => {
  const sources = createMemorySourceRegistry();
  const registry = createMemoryDealRegistry({ sourceRegistry: sources });
  const input = await assignment(sources, {
    workspaceId: "workspace_one",
    dealId: "deal_one",
    sourceId: "source_one",
    status: "screening",
  });
  await registry.confirmSourceAssignment(input);
  const before = await registry.getAnalysisEligibleSnapshot("workspace_one");

  await registry.confirmSourceAssignment({
    ...input,
    requestId: "request:deal_one:invested",
    status: "invested",
    memoryBundle: undefined,
  });
  const deal = await registry.findForWorkspace({
    workspaceId: "workspace_one",
    dealId: "deal_one",
  });
  const [currentBundle] = await registry.listAnalysisEligibleBundles(
    "workspace_one",
  );
  const after = await registry.getAnalysisEligibleSnapshot("workspace_one");

  assert.deepEqual(
    {
      dealStatus: deal?.status,
      bundleStatus: currentBundle.status,
      beforeFingerprint: before.fingerprint,
      afterFingerprint: after.fingerprint,
      fingerprintChanged: before.fingerprint !== after.fingerprint,
    },
    {
      dealStatus: "invested",
      bundleStatus: "invested",
      beforeFingerprint:
        "sha256:c1f6acc223c51045fa1fc4eeab89f235d964cfb069cbaa95b60bba189384c1ee",
      afterFingerprint:
        "sha256:9c0439820138d64ebd017797de60545d93764dc0b9f5625714dae8b6939a907e",
      fingerprintChanged: true,
    },
  );
});

test("eligible snapshot v2 matches the live PostgreSQL three-Deal vector", () => {
  const revisionFingerprints = [
    "sha256:2764a94f88e772e7887311a8d4eeb121a5bf3a65f5af597897320cf90262094b",
    "sha256:db9db68e550e099f02d262f7ed6bf789146278834f986131f3df55044d9a4721",
    "sha256:873709984032de9cef0c7cbb6ca63326d375dde9c72201c5e194ad1a921815ce",
  ];
  const deals: RegisteredDeal[] = revisionFingerprints.map(
    (fingerprint, index) => ({
      id: `snapshot_deal_${index + 1}`,
      workspaceId: "workspace_snapshot",
      companyId: `snapshot_company_${index + 1}`,
      companyName: `Company ${index + 1}`,
      status: "screening",
      analysisEligibleAt: "2026-07-28T13:45:00.000Z",
      activeSourceRevisionFingerprint: fingerprint,
      activeSourceRevisionIds: [`snapshot_revision_${index + 1}`],
    }),
  );

  assert.equal(
    eligibleDealSnapshotFingerprint(deals),
    "sha256:4d138886426eb83652d4e19dbb999869952b235025a84043bfc0b91897913ea2",
  );
});

test("confirmation is retry-idempotent and does not change upload or XTrace state", async () => {
  const sources = createMemorySourceRegistry();
  const registry = createMemoryDealRegistry({ sourceRegistry: sources });
  const input = await assignment(sources, {
    workspaceId: "workspace_one",
    dealId: "deal_uploaded",
    sourceId: "upload_one",
  });

  const first = await registry.confirmSourceAssignment(input);
  const retry = await registry.confirmSourceAssignment(input);

  assert.equal(first.newlyEligible, true);
  assert.equal(retry.newlyEligible, false);
  assert.deepEqual(retry.deal, first.deal);
  assert.equal(registry.inspect().assignments.length, 1);
  assert.deepEqual(registry.inspect().externalEffects, []);
});

test("the Deal lock awaits a started internal confirmation even when its caller does not", async () => {
  const storedSources = createMemorySourceRegistry();
  const firstInput = await assignment(storedSources, {
    workspaceId: "workspace_one",
    dealId: "deal_one",
    sourceId: "source_one",
    requestId: "request_one",
  });
  const secondInput = await assignment(storedSources, {
    workspaceId: "workspace_one",
    dealId: "deal_one",
    sourceId: "source_two",
    requestId: "request_two",
  });
  let reachedPausedRead!: () => void;
  const pausedReadReached = new Promise<void>((resolve) => {
    reachedPausedRead = resolve;
  });
  let releasePausedRead!: () => void;
  const pausedReadReleased = new Promise<void>((resolve) => {
    releasePausedRead = resolve;
  });
  const pausableSources: SourceRegistry = {
    ...storedSources,
    async getRevision(input) {
      if (input.revisionId === firstInput.sourceRevisionId) {
        reachedPausedRead();
        await pausedReadReleased;
      }
      return storedSources.getRevision(input);
    },
  };
  const registry = createMemoryDealRegistry({
    sourceRegistry: pausableSources,
  });
  let startedConfirmation!:
    ReturnType<typeof registry.confirmSourceAssignment>;
  const lockedOperation = registry.withPromotionLock({
    workspaceId: "workspace_one",
    dealId: "deal_one",
  }, async (confirmWithinLock) => {
    startedConfirmation = confirmWithinLock(firstInput);
  });
  await pausedReadReached;

  let ordinaryAssignmentSettled = false;
  const ordinaryAssignment = registry.confirmSourceAssignment(secondInput);
  void ordinaryAssignment.then(
    () => {
      ordinaryAssignmentSettled = true;
    },
    () => {
      ordinaryAssignmentSettled = true;
    },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  const settledBeforeRelease = ordinaryAssignmentSettled;
  releasePausedRead();

  await Promise.race([
    Promise.all([
      lockedOperation,
      startedConfirmation,
      ordinaryAssignment,
    ]),
    new Promise<never>((_resolve, reject) => {
      setTimeout(
        () => reject(new Error("unawaited Deal confirmation deadlocked")),
        1_000,
      );
    }),
  ]);
  assert.equal(settledBeforeRelease, false);
  assert.deepEqual(
    (await registry.findForWorkspace({
      workspaceId: "workspace_one",
      dealId: "deal_one",
    }))?.activeSourceRevisionIds,
    [firstInput.sourceRevisionId, secondInput.sourceRevisionId].sort(),
  );
});

test("confirmation request ids bind every immutable semantic field", async () => {
  const changes: Array<[string, (input: ConfirmSourceAssignmentInput) => ConfirmSourceAssignmentInput]> = [
    ["actor", (input) => ({ ...input, assignedByUserId: "user_other" })],
    ["reason", (input) => ({ ...input, reason: "A different reason." })],
    ["time", (input) => ({ ...input, confirmedAt: "2026-07-28T11:01:00.000Z" })],
    ["company id", (input) => ({ ...input, companyId: "company_other" })],
    ["company name", (input) => ({ ...input, companyName: "Company other", memoryBundle: undefined })],
    ["status", (input) => ({ ...input, status: "passed", memoryBundle: undefined })],
    ["deal", (input) => ({ ...input, dealId: "deal_other", memoryBundle: undefined })],
  ];
  for (const [label, change] of changes) {
    const sources = createMemorySourceRegistry();
    const registry = createMemoryDealRegistry({ sourceRegistry: sources });
    const input = await assignment(sources, {
      workspaceId: "workspace_one",
      dealId: "deal_one",
      sourceId: "source_one",
      requestId: `request_${label}`,
    });
    await registry.confirmSourceAssignment(input);
    await assert.rejects(
      registry.confirmSourceAssignment(change(input)),
      /request.*different|fingerprint/i,
      label,
    );
  }
});

test("source revision fingerprints are SHA-256 over canonical UTF-8 ordering", () => {
  const ids = ["a,b", "a", "B", "é", "e\u0301", "中"];
  assert.equal(
    sourceRevisionFingerprint(ids),
    "sha256:0385ed119273e8847094485994e6df1d410c8909df4306cd9b77ee092e7d7cb3",
  );
});

test("active assignment supersession updates the fingerprint deterministically", async () => {
  const sources = createMemorySourceRegistry();
  const registry = createMemoryDealRegistry({ sourceRegistry: sources });
  const initialInput = await assignment(sources, {
    workspaceId: "workspace_one",
    dealId: "deal_one",
    sourceId: "source_one",
  });
  const first = await registry.confirmSourceAssignment(initialInput);
  const secondRevision = await sources.appendRevision({
    ...revisionInput(
      "workspace_one",
      "source_one",
      "revision_two",
      "hash_two",
    ),
    supersedesRevisionId: first.sourceRevision.id,
  });

  const confirmed = await registry.confirmSourceAssignment({
    ...initialInput,
    requestId: "request:deal_one:revision:2",
    sourceRevisionId: secondRevision.id,
    confirmedAt: "2026-07-28T12:00:00.000Z",
  });

  assert.deepEqual(confirmed.deal.activeSourceRevisionIds, [secondRevision.id]);
  assert.equal(
    confirmed.deal.activeSourceRevisionFingerprint,
    sourceRevisionFingerprint([secondRevision.id]),
  );
  assert.equal(
    registry.inspect().assignments.filter((item) => item.supersededAt === null)
      .length,
    1,
  );
});

test("assignment supersession accepts equal/later instants and rejects backdating atomically", async () => {
  const sources = createMemorySourceRegistry();
  const registry = createMemoryDealRegistry({ sourceRegistry: sources });
  const initialInput = await assignment(sources, {
    workspaceId: "workspace_one",
    dealId: "deal_chronology",
    sourceId: "source_chronology",
    confirmedAt: "2026-07-28T11:00:00.000Z",
  });
  const first = await registry.confirmSourceAssignment(initialInput);
  const secondRevision = await sources.appendRevision({
    ...revisionInput(
      "workspace_one",
      "source_chronology",
      "revision_chronology_2",
      "hash_chronology_2",
    ),
    supersedesRevisionId: first.sourceRevision.id,
  });
  await registry.confirmSourceAssignment({
    ...initialInput,
    requestId: "request:chronology:2",
    sourceRevisionId: secondRevision.id,
  });
  const thirdRevision = await sources.appendRevision({
    ...revisionInput(
      "workspace_one",
      "source_chronology",
      "revision_chronology_3",
      "hash_chronology_3",
    ),
    supersedesRevisionId: secondRevision.id,
  });
  await registry.confirmSourceAssignment({
    ...initialInput,
    requestId: "request:chronology:3",
    sourceRevisionId: thirdRevision.id,
    confirmedAt: "2026-07-28T12:00:00.000Z",
  });
  const fourthRevision = await sources.appendRevision({
    ...revisionInput(
      "workspace_one",
      "source_chronology",
      "revision_chronology_4",
      "hash_chronology_4",
    ),
    supersedesRevisionId: thirdRevision.id,
  });
  const before = registry.inspect();

  await assert.rejects(
    registry.confirmSourceAssignment({
      ...initialInput,
      requestId: "request:chronology:4",
      sourceRevisionId: fourthRevision.id,
      confirmedAt: "2026-07-28T10:59:59.999Z",
    }),
    /chronology|backdated|confirmation time/i,
  );
  assert.deepEqual(registry.inspect(), before);
});

test("workspace identity is mandatory and colliding Deal ids remain isolated", async () => {
  const sources = createMemorySourceRegistry();
  const registry = createMemoryDealRegistry({ sourceRegistry: sources });
  for (const workspaceId of ["workspace:a", "workspace"]) {
    await registry.confirmSourceAssignment(await assignment(sources, {
      workspaceId,
      dealId: workspaceId === "workspace:a" ? "external" : "a:external",
      sourceId: `source_${workspaceId}`,
    }));
  }

  assert.ok(
    await registry.findForWorkspace({
      workspaceId: "workspace:a",
      dealId: "external",
    }),
  );
  assert.ok(
    await registry.findForWorkspace({
      workspaceId: "workspace",
      dealId: "a:external",
    }),
  );
  assert.equal(
    await registry.findForWorkspace({
      workspaceId: "workspace_other",
      dealId: "external",
    }),
    null,
  );
  await assert.rejects(
    registry.listAnalysisEligibleBundles("  "),
    /workspace.*required/i,
  );
});

test("memory ownership rejects foreign workspace, Deal, source, and stale revision lineage", async () => {
  const sources = createMemorySourceRegistry();
  const registry = createMemoryDealRegistry({ sourceRegistry: sources });
  const input = await assignment(sources, {
    workspaceId: "workspace_one",
    dealId: "deal_one",
    sourceId: "source_one",
    memoryBundle: {
      dealId: "deal_one",
      companyName: "Company deal_one",
      status: "screening",
      facts: [{
        text: "A verified fact.",
        sources: [{
          id: "evidence_one",
          provenance: "source_document",
          title: "Source one",
          documentId: "source_one",
          page: 1,
          excerpt: "A verified fact.",
        }],
      }],
      interactions: [],
    },
  });
  const owner = {
    workspaceId: input.workspaceId,
    dealId: input.dealId,
    sourceId: "source_one",
    sourceRevisionId: input.sourceRevisionId,
  };
  await registry.confirmSourceAssignment({
    ...input,
    memoryLineage: { evidence: { evidence_one: owner }, interactions: {} },
  });
  assert.equal(
    (await registry.listAnalysisEligibleBundles("workspace_one"))[0]
      ?.facts.length,
    1,
  );

  for (const changedOwner of [
    { ...owner, workspaceId: "workspace_other" },
    { ...owner, dealId: "deal_other" },
    { ...owner, sourceId: "source_other" },
    { ...owner, sourceRevisionId: "revision_stale" },
  ]) {
    const isolated = createMemoryDealRegistry({ sourceRegistry: sources });
    await assert.rejects(
      isolated.confirmSourceAssignment({
        ...input,
        requestId: `request_${JSON.stringify(changedOwner)}`,
        memoryLineage: {
          evidence: { evidence_one: changedOwner },
          interactions: {},
        },
      }),
      /lineage|foreign|source|revision/i,
    );
  }
});

test("confirmation rejects cross-workspace revisions and conflicting retry identities", async () => {
  const sources = createMemorySourceRegistry();
  const registry = createMemoryDealRegistry({ sourceRegistry: sources });
  const input = await assignment(sources, {
    workspaceId: "workspace_one",
    dealId: "deal_one",
    sourceId: "source_one",
    requestId: "request_shared",
  });
  await registry.confirmSourceAssignment(input);

  await assert.rejects(
    registry.confirmSourceAssignment({
      ...input,
      workspaceId: "workspace_two",
      dealId: "deal_two",
      companyId: "company_two",
      companyName: "Company two",
      memoryBundle: undefined,
    }),
    /revision|workspace/i,
  );
  const otherRevision = await sources.createInitialRevision(
    revisionInput(
      "workspace_one",
      "source_two",
      "revision_other",
      "hash_other",
    ),
  );
  await assert.rejects(
    registry.confirmSourceAssignment({
      ...input,
      dealId: "deal_two",
      companyId: "company_two",
      companyName: "Company two",
      sourceRevisionId: otherRevision.id,
      memoryBundle: undefined,
    }),
    /request|different/i,
  );
});

test("preloaded registry backfill is idempotent and keeps nineteen as fixture data only", async () => {
  const sources = createMemorySourceRegistry();
  const deals = createMemoryDealRegistry({ sourceRegistry: sources });

  const first = await backfillPreloadedSourceRegistry({
    workspaceId: "workspace_demo",
    assignedByUserId: "user_demo",
    sourceRegistry: sources,
    dealRegistry: deals,
  });
  const second = await backfillPreloadedSourceRegistry({
    workspaceId: "workspace_demo",
    assignedByUserId: "user_demo",
    sourceRegistry: sources,
    dealRegistry: deals,
  });

  assert.equal(first.sourceRevisionCount, 14);
  assert.equal(first.eligibleDealCount, 19);
  assert.equal(second.sourceRevisionCount, 14);
  assert.equal(second.eligibleDealCount, 19);
  assert.equal(
    (await deals.listAnalysisEligibleBundles("workspace_demo")).length,
    19,
  );
  assert.equal(sources.inspect().revisions.length, 14);
  assert.equal(deals.inspect().assignments.length, 19);
});

test("backfill tolerates migration timestamps but rejects extractor provenance drift", async () => {
  const sources = createMemorySourceRegistry();
  const deals = createMemoryDealRegistry({ sourceRegistry: sources });
  await sources.createInitialRevision({
    ...revisionInput(
      "workspace_demo",
      "doc_7bridges",
      "source_revision_doc_7bridges_1",
      "698a582d94484808c419aab4602a72aa36612fdafebba56a690be3bea848d47a",
    ),
    objectKey:
      "private/demo-corpus/698a582d94484808c419aab4602a72aa36612fdafebba56a690be3bea848d47a/7bridges-Pitch-Deck.pdf",
    objectVersion:
      "698a582d94484808c419aab4602a72aa36612fdafebba56a690be3bea848d47a",
    extractorId: "preloaded-pdf",
    extractorVersion: "1",
    extractedAt: "2026-07-01T00:00:00.000Z",
    createdAt: "2026-07-01T00:00:00.000Z",
  });

  const result = await backfillPreloadedSourceRegistry({
    workspaceId: "workspace_demo",
    assignedByUserId: "user_demo",
    sourceRegistry: sources,
    dealRegistry: deals,
  });

  assert.equal(result.sourceRevisionCount, 14);
  assert.equal(
    (
      await sources.getRevision({
        workspaceId: "workspace_demo",
        revisionId: "source_revision_doc_7bridges_1",
      })
    )?.extractedAt,
    "2026-07-01T00:00:00.000Z",
  );

  const mismatchedSources = createMemorySourceRegistry();
  await mismatchedSources.createInitialRevision({
    ...revisionInput(
      "workspace_demo",
      "doc_7bridges",
      "source_revision_doc_7bridges_1",
      "698a582d94484808c419aab4602a72aa36612fdafebba56a690be3bea848d47a",
    ),
    objectKey:
      "private/demo-corpus/698a582d94484808c419aab4602a72aa36612fdafebba56a690be3bea848d47a/7bridges-Pitch-Deck.pdf",
    objectVersion:
      "698a582d94484808c419aab4602a72aa36612fdafebba56a690be3bea848d47a",
    extractorId: "wrong-extractor",
  });
  await assert.rejects(
    backfillPreloadedSourceRegistry({
      workspaceId: "workspace_demo",
      assignedByUserId: "user_demo",
      sourceRegistry: mismatchedSources,
      dealRegistry: createMemoryDealRegistry({ sourceRegistry: mismatchedSources }),
    }),
    /different immutable source data/i,
  );
});

test("Supabase confirmation and reads capture mandatory workspace scope", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const repository = createSupabaseDealRegistry({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async (input, init = {}) => {
      requests.push({ url: String(input), init });
      if (String(input).includes("/rpc/confirm_source_assignment")) {
        return Response.json({
          deal: {
            id: "deal_one",
            workspaceId: "workspace_one",
            companyId: "company_one",
            companyName: "Company one",
            status: "screening",
            analysisEligibleAt: "2026-07-28T11:00:00.000Z",
            activeSourceRevisionFingerprint:
              sourceRevisionFingerprint(["revision_one"]),
            activeSourceRevisionIds: ["revision_one"],
          },
          sourceRevision: {
            id: "revision_one",
            workspaceId: "workspace_one",
            sourceId: "source_one",
            revision: 1,
            contentHash: "hash_one",
            objectKey: "private/workspace_one/source_one",
            objectVersion: "hash_one",
            contentType: "application/pdf",
            extractorId: "pdf-text",
            extractorVersion: "1.0.0",
            extractedAt: "2026-07-28T10:00:00.000Z",
            supersedesRevisionId: null,
            createdAt: "2026-07-28T10:00:01.000Z",
          },
          newlyEligible: true,
        });
      }
      return Response.json([]);
    },
  });

  await repository.confirmSourceAssignment({
    requestId: "request_one",
    workspaceId: "workspace_one",
    dealId: "deal_one",
    companyId: "company_one",
    companyName: "Company one",
    status: "screening",
    sourceRevisionId: "revision_one",
    assignedByUserId: "user_one",
    reason: "Confirmed ownership.",
    confirmedAt: "2026-07-28T11:00:00.000Z",
  });
  await repository.findForWorkspace({
    workspaceId: "workspace_one",
    dealId: "deal_one",
  });

  assert.equal(
    requests[0].url,
    "https://example.supabase.co/rest/v1/rpc/confirm_source_assignment",
  );
  assert.equal(
    JSON.parse(String(requests[0].init.body)).p_assignment.workspaceId,
    "workspace_one",
  );
  assert.doesNotMatch(
    requests.map((request) => request.url).join("\n"),
    /xtrace|uploaded_documents/i,
  );
  const findUrl = new URL(requests[1].url);
  assert.equal(findUrl.searchParams.get("workspace_id"), "eq.workspace_one");
  assert.equal(findUrl.searchParams.get("id"), "eq.deal_one");
});

test("Supabase captures the eligible snapshot in one RPC", async () => {
  const requests: string[] = [];
  const repository = createSupabaseDealRegistry({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async (input) => {
      requests.push(String(input));
      return Response.json({
        count: 2,
        dealIds: ["deal_a", "deal_b"],
        fingerprint:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      });
    },
  });
  const snapshotRepository = repository as typeof repository & {
    getAnalysisEligibleSnapshot?: (
      workspaceId: string,
    ) => Promise<{
      count: number;
      dealIds: string[];
      fingerprint: string;
    }>;
  };
  assert.equal(
    typeof snapshotRepository.getAnalysisEligibleSnapshot,
    "function",
  );
  assert.deepEqual(
    await snapshotRepository.getAnalysisEligibleSnapshot!("workspace_one"),
    {
      count: 2,
      dealIds: ["deal_a", "deal_b"],
      fingerprint:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  );
  assert.deepEqual(requests, [
    "https://example.supabase.co/rest/v1/rpc/get_analysis_eligible_snapshot",
  ]);
});

test("Supabase bundles emit the current status from the authoritative Deal row", async () => {
  const repository = createSupabaseDealRegistry({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes("/deals?")) {
        return Response.json([{
          id: "deal_one",
          workspace_id: "workspace_one",
          company_id: "company_one",
          company_name: "Company one",
          status: "invested",
          analysis_eligible_at: "2026-07-28T11:00:00.000Z",
          active_source_revision_fingerprint:
            sourceRevisionFingerprint(["revision_one"]),
        }]);
      }
      if (url.includes("/deal_source_assignments?")) {
        return Response.json([{
          deal_id: "deal_one",
          source_id: "source_one",
          source_revision_id: "revision_one",
        }]);
      }
      return Response.json([]);
    },
  });

  assert.deepEqual(
    await repository.listAnalysisEligibleBundles("workspace_one"),
    [{
      dealId: "deal_one",
      companyName: "Company one",
      status: "invested",
      facts: [],
      interactions: [],
    }],
  );
});

test("Supabase eligible bundles normalize PostgREST offset interaction timestamps", async () => {
  const repository = createSupabaseDealRegistry({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes("/deals?")) {
        return Response.json([{
          id: "deal_one",
          workspace_id: "workspace_one",
          company_id: "company_one",
          company_name: "Company one",
          status: "invested",
          analysis_eligible_at: "2026-07-28T11:00:00+00:00",
          active_source_revision_fingerprint:
            sourceRevisionFingerprint(["revision_one"]),
        }]);
      }
      if (url.includes("/deal_source_assignments?")) {
        return Response.json([{
          deal_id: "deal_one",
          source_id: "source_one",
          source_revision_id: "revision_one",
        }]);
      }
      if (url.includes("/deal_interactions?")) {
        return Response.json([{
          id: "interaction_one",
          workspace_id: "workspace_one",
          deal_id: "deal_one",
          document_id: "source_one",
          source_revision_id: "revision_one",
          occurred_at: "2026-07-28T10:00:00+00:00",
          meeting_summary: "Founder meeting.",
          decision_reason: "Market timing was early.",
          concerns: ["Adoption"],
          revisit_conditions: ["Enterprise traction"],
          provenance: "demo_fixture",
          label: "Sample decision record",
          status: "invested",
          prior_actions: ["continue_monitoring"],
          action_policy_version: "belief-action-policy-v1",
          interaction_schema_version: "sample-decision-interaction-v1",
        }]);
      }
      if (url.includes("/source_revisions?")) {
        return Response.json([{
          workspace_id: "workspace_one",
          id: "revision_one",
          source_id: "source_one",
          content_hash:
            "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          extracted_at: "2026-07-28T11:00:00.000Z",
        }]);
      }
      if (url.includes("/source_documents?")) {
        return Response.json([{
          id: "source_one",
          title: "Sample decision record",
          role: "sample_decision_record",
        }]);
      }
      return Response.json([]);
    },
  });

  const bundles = await repository.listAnalysisEligibleBundles("workspace_one");
  assert.equal(
    bundles[0]?.interactions[0]?.occurredAt,
    "2026-07-28T10:00:00.000Z",
  );
  assert.equal(
    bundles[0]?.interactions[0]?.actionPolicyVersion,
    "belief-action-policy-v1",
  );
  assert.equal(
    bundles[0]?.interactions[0]?.interactionSchemaVersion,
    "sample-decision-interaction-v1",
  );
  assert.deepEqual(bundles[0]?.interactions[0]?.source, {
    schemaVersion: "source-ref-v2",
    adaptation: "canonical",
    id: "interaction_one",
    provenance: "demo_fixture",
    title: "Sample decision record",
    canonicalUrl: null,
    documentId: "source_one",
    publisher: "Internal Deal Registry",
    providerId: "deal-registry",
    eventAt: "2026-07-28T10:00:00.000Z",
    eventAtPrecision: "timestamp",
    publishedAt: null,
    publishedAtPrecision: null,
    retrievedAt: "2026-07-28T11:00:00.000Z",
    retrievedAtPrecision: "timestamp",
    updatedAt: null,
    updatedAtPrecision: null,
    entityKeys: [],
    sourceClass: "internal_decision_record",
    sourceAuthority: "primary",
    evidenceRole: "context",
    sourceRevisionId: "revision_one",
    locator: { kind: "json_pointer", pointer: "/priorDecision" },
    contentFingerprint:
      "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    text: {
      status: "normalized_only",
      normalizedStatement:
        "Sample decision record. Founder meeting. Decision reason: Market timing was early. Concerns: Adoption. Revisit conditions: Enterprise traction.",
    },
  });
  assert.deepEqual(
    (await repository.getExactSourceBundle({
      workspaceId: "workspace_one",
      dealId: "deal_one",
      sourceId: "source_one",
      sourceRevisionId: "revision_one",
    }))?.bundle.interactions,
    bundles[0]?.interactions,
  );
});

test("Supabase exact-source reads bind every ownership dimension", async () => {
  const requests: string[] = [];
  const repository = createSupabaseDealRegistry({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("/deals?")) {
        return Response.json([{
          id: "deal_one",
          workspace_id: "workspace_one",
          company_id: "company_one",
          company_name: "Company one",
          status: "evaluating",
          analysis_eligible_at: "2026-07-28T11:00:00.000Z",
          active_source_revision_fingerprint:
            sourceRevisionFingerprint(["revision_two"]),
        }]);
      }
      if (
        url.includes("/deal_source_assignments?")
        && new URL(url).searchParams.get("select")
          === "deal_id,source_id,source_revision_id"
      ) {
        return Response.json([{
          deal_id: "deal_one",
          source_id: "source_one",
          source_revision_id: "revision_two",
        }]);
      }
      if (url.includes("/deal_source_assignments?")) {
        return Response.json([{ source_revision_id: "revision_one" }]);
      }
      if (url.includes("/source_evidence?")) {
        return Response.json([{
          id: "evidence_revision_one",
          workspace_id: "workspace_one",
          deal_id: "deal_one",
          document_id: "source_one",
          source_revision_id: "revision_one",
          provenance: "source_document",
          page: 1,
          fact: "Fact from revision one.",
          excerpt: "Fact from revision one.",
        }]);
      }
      if (url.includes("/source_documents?")) {
        return Response.json([{
          id: "source_one",
          title: "source-one.txt",
        }]);
      }
      return Response.json([]);
    },
  });

  const exact = await repository.getExactSourceBundle({
    workspaceId: "workspace_one",
    dealId: "deal_one",
    sourceId: "source_one",
    sourceRevisionId: "revision_one",
  });
  assert.deepEqual(exact, {
    workspaceId: "workspace_one",
    dealId: "deal_one",
    sourceId: "source_one",
    sourceRevisionId: "revision_one",
    bundle: {
      dealId: "deal_one",
      companyName: "Company one",
      status: "evaluating",
      facts: [{
        text: "Fact from revision one.",
        sources: [{
          id: "evidence_revision_one",
          provenance: "source_document",
          title: "source-one.txt",
          documentId: "source_one",
          page: 1,
          excerpt: "Fact from revision one.",
        }],
      }],
      interactions: [],
    },
  });
  for (
    const url of requests.filter((requestUrl) =>
      requestUrl.includes("/source_evidence?")
      || (
        requestUrl.includes("/deal_source_assignments?")
        && new URL(requestUrl).searchParams.get("select")
          === "source_revision_id"
      )
    )
  ) {
    const query = new URL(url).searchParams;
    assert.equal(query.get("workspace_id"), "eq.workspace_one");
    assert.equal(query.get("deal_id"), "eq.deal_one");
    assert.equal(
      query.get(url.includes("/source_evidence?")
        ? "document_id"
        : "source_id"),
      "eq.source_one",
    );
    assert.equal(query.get("source_revision_id"), "eq.revision_one");
    if (url.includes("/source_evidence?")) {
      assert.equal(
        query.get("analysis_quarantine_reason"),
        "is.null",
      );
    }
  }
});

test("Supabase Deal memory excludes quarantined legacy image summaries", async () => {
  const evidenceRequests: string[] = [];
  const canonicalRequests: string[] = [];
  const repository = createSupabaseDealRegistry({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async (input) => {
      const url = String(input);
      const query = new URL(url).searchParams;
      if (url.includes("/deals?")) {
        return Response.json([{
          id: "deal_image",
          workspace_id: "workspace_one",
          company_id: "company_image",
          company_name: "Image Co",
          status: "screening",
          analysis_eligible_at: "2026-07-28T11:00:00.000Z",
          active_source_revision_fingerprint:
            sourceRevisionFingerprint(["revision_image"]),
        }]);
      }
      if (url.includes("/deal_source_assignments?")) {
        if (query.get("select") === "source_revision_id") {
          return Response.json([{
            source_revision_id: "revision_image",
          }]);
        }
        return Response.json([{
          deal_id: "deal_image",
          source_id: "source_image",
          source_revision_id: "revision_image",
        }]);
      }
      if (url.includes("/source_evidence?")) {
        evidenceRequests.push(url);
        if (query.get("analysis_quarantine_reason") === "is.null") {
          return Response.json([]);
        }
        return Response.json([{
          id: "evidence_legacy_image",
          workspace_id: "workspace_one",
          deal_id: "deal_image",
          document_id: "source_image",
          source_revision_id: "revision_image",
          provenance: "source_document",
          page: 1,
          fact: "The vision model inferred $8M ARR.",
          excerpt: "The vision model inferred $8M ARR.",
          analysis_quarantine_reason:
            "legacy_model_derived_image_summary",
        }]);
      }
      if (url.includes("/source_evidence_items?")) {
        canonicalRequests.push(url);
        return Response.json([{
          workspace_id: "workspace_one",
          evidence_id: "evidence_image_arr",
          deal_id: "deal_image",
          source_id: "source_image",
          source_revision_id: "revision_image",
          payload: {
            id: "evidence_image_arr",
            workspaceId: "workspace_one",
            dealId: "deal_image",
            sourceId: "source_image",
            sourceRevisionId: "revision_image",
            provenanceOrigin: "uploaded_document",
            field: "ARR",
            value: "8000000",
            unit: "currency",
            currency: "USD",
            periodStart: null,
            periodEnd: "2026-06-30",
            publishedAt: null,
            eventAt: null,
            retrievedAt: "2026-07-28T11:00:00.000Z",
            locator: {
              kind: "image",
              imageIndex: 0,
              region: null,
            },
            sourceRole: "management",
            assertionStatus: "reported",
            verificationMethod: null,
            freshness: "current",
            acceptedForGate: true,
          },
        }]);
      }
      if (url.includes("/source_documents?")) {
        return Response.json([{
          id: "source_image",
          title: "legacy.png",
        }]);
      }
      return Response.json([]);
    },
  });

  const [bundle] = await repository.listAnalysisEligibleBundles(
    "workspace_one",
  );
  const structuredImageFact = {
    text:
      "Structured image evidence (not a quotation): ARR = 8000000 USD.",
    sources: [{
      id: "evidence_image_arr",
      provenance: "model_inference",
      title: "legacy.png",
      documentId: "source_image",
      sourceRevisionId: "revision_image",
      excerpt:
        "Structured image evidence (not a quotation): ARR = 8000000 USD.",
    }],
  };
  assert.deepEqual(bundle?.facts, [structuredImageFact]);
  assert.deepEqual(await repository.getExactSourceBundle({
    workspaceId: "workspace_one",
    dealId: "deal_image",
    sourceId: "source_image",
    sourceRevisionId: "revision_image",
  }), {
    workspaceId: "workspace_one",
    dealId: "deal_image",
    sourceId: "source_image",
    sourceRevisionId: "revision_image",
    bundle: {
      dealId: "deal_image",
      companyName: "Image Co",
      status: "screening",
      facts: [structuredImageFact],
      interactions: [],
    },
  });
  assert.equal(evidenceRequests.length, 2);
  assert.equal(canonicalRequests.length, 2);
  for (const request of evidenceRequests) {
    assert.equal(
      new URL(request).searchParams.get("analysis_quarantine_reason"),
      "is.null",
    );
  }
});

test("Supabase Deal memory projects canonical public web text with exact revision and quote boundaries", async () => {
  const canonicalRows = [
    {
      workspace_id: "workspace_one",
      evidence_id: "claim_exact",
      deal_id: "deal_public",
      source_id: "source_public",
      source_revision_id: "revision_public",
      payload: {
        id: "claim_exact",
        workspaceId: "workspace_one",
        dealId: "deal_public",
        sourceId: "source_public",
        sourceRevisionId: "revision_public",
        provenanceOrigin: "public_source",
        field: "public_claim",
        value: "Henry AI reports that deployments reduced document work by 95%.",
        unit: null,
        currency: null,
        periodStart: null,
        periodEnd: null,
        publishedAt: "2026-07-29T00:00:00.000Z",
        eventAt: "2026-07-29T00:00:00.000Z",
        retrievedAt: "2026-08-01T00:00:00.000Z",
        locator: {
          kind: "web_snapshot",
          url: "https://example.com/henry",
          excerpt: "deployments reduced document work by 95%",
        },
        sourceRole: "independent_third_party",
        assertionStatus: "reported",
        verificationMethod: "reviewed_public_snapshot_v1",
        freshness: "current",
        acceptedForGate: true,
        sourceRef: {
          schemaVersion: "source-ref-v2",
          adaptation: "canonical",
          id: "claim_exact",
          provenance: "public_web",
          title: "Henry AI customer result",
          canonicalUrl: "https://example.com/henry",
          documentId: "source_public",
          publisher: "Example Publisher",
          providerId: "belief_reversal_snapshot_v1",
          eventAt: "2026-07-29",
          eventAtPrecision: "date",
          publishedAt: "2026-07-29",
          publishedAtPrecision: "date",
          retrievedAt: "2026-08-01",
          retrievedAtPrecision: "date",
          updatedAt: null,
          updatedAtPrecision: null,
          entityKeys: ["henry_ai"],
          sourceClass: "company_official",
          sourceAuthority: "primary",
          evidenceRole: "trigger",
          sourceRevisionId: "revision_public",
          locator: { kind: "web_text", selector: "reviewed excerpt" },
          contentFingerprint:
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          text: {
            status: "verified_exact",
            verbatimExcerpt: "deployments reduced document work by 95%",
            normalizedStatement:
              "Henry AI reports that deployments reduced document work by 95%.",
          },
        },
      },
    },
    {
      workspace_id: "workspace_one",
      evidence_id: "claim_normalized",
      deal_id: "deal_public",
      source_id: "source_public",
      source_revision_id: "revision_public",
      payload: {
        id: "claim_normalized",
        workspaceId: "workspace_one",
        dealId: "deal_public",
        sourceId: "source_public",
        sourceRevisionId: "revision_public",
        provenanceOrigin: "public_source",
        field: "public_claim",
        value: "Henry AI sells enterprise legal workflow software.",
        unit: null,
        currency: null,
        periodStart: null,
        periodEnd: null,
        publishedAt: "2026-07-29T00:00:00.000Z",
        eventAt: "2026-07-29T00:00:00.000Z",
        retrievedAt: "2026-08-01T00:00:00.000Z",
        locator: {
          kind: "web_snapshot",
          url: "https://example.com/henry",
          excerpt: "enterprise legal workflow software",
        },
        sourceRole: "independent_third_party",
        assertionStatus: "reported",
        verificationMethod: "reviewed_public_snapshot_v1",
        freshness: "current",
        acceptedForGate: true,
        sourceRef: {
          schemaVersion: "source-ref-v2",
          adaptation: "canonical",
          id: "claim_normalized",
          provenance: "public_web",
          title: "Henry AI customer result",
          canonicalUrl: "https://example.com/henry",
          documentId: "source_public",
          publisher: "Example Publisher",
          providerId: "belief_reversal_snapshot_v1",
          eventAt: "2026-07-29",
          eventAtPrecision: "date",
          publishedAt: "2026-07-29",
          publishedAtPrecision: "date",
          retrievedAt: "2026-08-01",
          retrievedAtPrecision: "date",
          updatedAt: null,
          updatedAtPrecision: null,
          entityKeys: ["henry_ai"],
          sourceClass: "company_official",
          sourceAuthority: "primary",
          evidenceRole: "trigger",
          sourceRevisionId: "revision_public",
          locator: { kind: "web_text", selector: "reviewed statement" },
          contentFingerprint:
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          text: {
            status: "normalized_only",
            normalizedStatement:
              "Henry AI sells enterprise legal workflow software.",
          },
        },
      },
    },
  ];
  const repository = createSupabaseDealRegistry({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async (input) => {
      const url = String(input);
      const query = new URL(url).searchParams;
      if (url.includes("/deals?")) {
        return Response.json([{
          id: "deal_public",
          workspace_id: "workspace_one",
          company_id: "company_public",
          company_name: "Henry AI",
          status: "passed",
          analysis_eligible_at: "2026-08-01T00:00:00.000Z",
          active_source_revision_fingerprint:
            sourceRevisionFingerprint(["revision_public"]),
        }]);
      }
      if (url.includes("/deal_source_assignments?")) {
        if (query.get("select") === "source_revision_id") {
          return Response.json([{ source_revision_id: "revision_public" }]);
        }
        return Response.json([{
          deal_id: "deal_public",
          source_id: "source_public",
          source_revision_id: "revision_public",
        }]);
      }
      if (url.includes("/source_revisions?")) {
        return Response.json([{
          workspace_id: "workspace_one",
          id: "revision_public",
          source_id: "source_public",
          content_hash:
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          extracted_at: "2026-08-01T00:00:00.000Z",
        }]);
      }
      if (url.includes("/source_evidence_items?")) {
        return Response.json(canonicalRows);
      }
      if (url.includes("/source_documents?")) {
        return Response.json([{
          id: "source_public",
          title: "Henry AI customer result",
          role: "public_web_snapshot",
        }]);
      }
      return Response.json([]);
    },
  });

  const expectedFacts = canonicalRows.map((row) => ({
    text: row.payload.value,
    sources: [row.payload.sourceRef],
  }));
  const [bundle] = await repository.listAnalysisEligibleBundles(
    "workspace_one",
  );
  assert.deepEqual(bundle?.facts, expectedFacts);
  assert.equal(
    "verbatimExcerpt" in expectedFacts[1]!.sources[0]!.text,
    false,
    "normalized-only evidence must never become quote-eligible",
  );
  assert.deepEqual(
    (await repository.getExactSourceBundle({
      workspaceId: "workspace_one",
      dealId: "deal_public",
      sourceId: "source_public",
      sourceRevisionId: "revision_public",
    }))?.bundle.facts,
    expectedFacts,
  );
});

test("Supabase Deal memory projects a permanently labelled non-gating research screening fact without inventing an interaction", async () => {
  const contentFingerprint =
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const value = [
    "Sample research screening record.",
    "Synthetic research-only context; no meeting or VC interaction occurred.",
    "Disposition: qualified_not_selected.",
    "Qualification: Recent public evidence qualifies the company for monitoring.",
    "Not selected reason: Evidence does not yet establish a changed action.",
    "Reconsideration conditions: Verify independent customer adoption.",
  ].join(" ");
  const sourceRef = {
    schemaVersion: "source-ref-v2" as const,
    adaptation: "canonical" as const,
    id: "sample_research_screening_centralize_v1",
    provenance: "source_document" as const,
    title: "Sample research screening record",
    canonicalUrl: null,
    documentId: "source_sample_research_screening_centralize_v1",
    publisher: "Internal Research Registry",
    providerId: "belief-reversal-research-seed-v1",
    eventAt: "2026-08-03T13:34:43.000Z",
    eventAtPrecision: "timestamp" as const,
    publishedAt: null,
    publishedAtPrecision: null,
    retrievedAt: "2026-08-03T13:34:43.000Z",
    retrievedAtPrecision: "timestamp" as const,
    updatedAt: null,
    updatedAtPrecision: null,
    entityKeys: ["centralize"],
    sourceClass: "internal_decision_record" as const,
    sourceAuthority: "primary" as const,
    evidenceRole: "context" as const,
    sourceRevisionId: "revision_sample_research_centralize_v1",
    locator: { kind: "json_pointer" as const, pointer: "/record" },
    contentFingerprint,
    text: {
      status: "normalized_only" as const,
      normalizedStatement: value,
    },
  };
  const canonicalRow = {
    workspace_id: "workspace_one",
    evidence_id: sourceRef.id,
    deal_id: "deal_centralize_v1",
    source_id: sourceRef.documentId,
    source_revision_id: sourceRef.sourceRevisionId,
    payload: {
      id: sourceRef.id,
      workspaceId: "workspace_one",
      dealId: "deal_centralize_v1",
      sourceId: sourceRef.documentId,
      sourceRevisionId: sourceRef.sourceRevisionId,
      provenanceOrigin: "uploaded_document",
      field: "research_disposition_context",
      value,
      unit: null,
      currency: null,
      periodStart: null,
      periodEnd: null,
      publishedAt: null,
      eventAt: null,
      retrievedAt: "2026-08-03T13:34:43.000Z",
      locator: {
        kind: "text_range",
        start: 0,
        end: value.length,
        excerpt: value,
      },
      sourceRole: "management",
      assertionStatus: "reported",
      verificationMethod: "synthetic_research_screening_record_v1",
      freshness: "current",
      acceptedForGate: false,
      sourceRef,
    },
  };
  const repositoryFor = (
    evidenceRow: typeof canonicalRow,
  ) => createSupabaseDealRegistry({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes("/deals?")) {
        return Response.json([{
          id: "deal_centralize_v1",
          workspace_id: "workspace_one",
          company_id: "company_centralize_v1",
          company_name: "Centralize",
          status: "screening",
          analysis_eligible_at: "2026-08-03T13:34:43.000Z",
          active_source_revision_fingerprint: sourceRevisionFingerprint([
            sourceRef.sourceRevisionId,
          ]),
        }]);
      }
      if (url.includes("/deal_source_assignments?")) {
        return Response.json([{
          deal_id: "deal_centralize_v1",
          source_id: sourceRef.documentId,
          source_revision_id: sourceRef.sourceRevisionId,
        }]);
      }
      if (url.includes("/source_evidence_items?")) {
        return Response.json([evidenceRow]);
      }
      if (url.includes("/source_documents?")) {
        return Response.json([{
          id: sourceRef.documentId,
          title: "Sample research screening record",
          role: "sample_research_screening_record",
        }]);
      }
      if (url.includes("/source_revisions?")) {
        return Response.json([{
          workspace_id: "workspace_one",
          id: sourceRef.sourceRevisionId,
          source_id: sourceRef.documentId,
          content_hash: contentFingerprint,
          extracted_at: "2026-08-03T13:34:43.000Z",
        }]);
      }
      return Response.json([]);
    },
  });
  const repository = repositoryFor(canonicalRow);

  const [bundle] = await repository.listAnalysisEligibleBundles(
    "workspace_one",
  );
  assert.deepEqual(bundle?.facts, [{ text: value, sources: [sourceRef] }]);
  assert.deepEqual(bundle?.interactions, []);
  await assert.rejects(
    repositoryFor({
      ...canonicalRow,
      payload: { ...canonicalRow.payload, acceptedForGate: true },
    }).listAnalysisEligibleBundles("workspace_one"),
    /permanent non-interaction and non-gating identity/iu,
  );
});

test("Supabase Deal memory rejects canonical image evidence with foreign exact source identity", async () => {
  const repository = createSupabaseDealRegistry({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async (input) => {
      const url = String(input);
      const query = new URL(url).searchParams;
      if (url.includes("/deals?")) {
        return Response.json([{
          id: "deal_image",
          workspace_id: "workspace_one",
          company_id: "company_image",
          company_name: "Image Co",
          status: "screening",
          analysis_eligible_at: "2026-07-28T11:00:00.000Z",
          active_source_revision_fingerprint:
            sourceRevisionFingerprint(["revision_image"]),
        }]);
      }
      if (url.includes("/deal_source_assignments?")) {
        if (query.get("select") === "source_revision_id") {
          return Response.json([{
            source_revision_id: "revision_image",
          }]);
        }
        return Response.json([{
          deal_id: "deal_image",
          source_id: "source_image",
          source_revision_id: "revision_image",
        }]);
      }
      if (url.includes("/source_evidence_items?")) {
        return Response.json([{
          workspace_id: "workspace_one",
          evidence_id: "evidence_image_arr",
          deal_id: "deal_image",
          source_id: "source_image",
          source_revision_id: "revision_image",
          payload: {
            id: "evidence_image_arr",
            workspaceId: "workspace_one",
            dealId: "deal_image",
            sourceId: "source_foreign",
            sourceRevisionId: "revision_image",
            provenanceOrigin: "uploaded_document",
            field: "ARR",
            value: "8000000",
            unit: "currency",
            currency: "USD",
            periodStart: null,
            periodEnd: null,
            publishedAt: null,
            eventAt: null,
            retrievedAt: "2026-07-28T11:00:00.000Z",
            locator: {
              kind: "image",
              imageIndex: 0,
              region: null,
            },
            sourceRole: "management",
            assertionStatus: "reported",
            verificationMethod: null,
            freshness: "current",
            acceptedForGate: true,
          },
        }]);
      }
      if (url.includes("/source_evidence?")) return Response.json([]);
      if (url.includes("/deal_interactions?")) return Response.json([]);
      if (url.includes("/source_documents?")) {
        return Response.json([{
          id: "source_image",
          title: "image.png",
        }]);
      }
      return Response.json([]);
    },
  });

  await assert.rejects(
    repository.listAnalysisEligibleBundles("workspace_one"),
    /canonical image evidence.*identity/i,
  );
});

test("Supabase eligible reads reject a stale active-revision fingerprint", async () => {
  const repository = createSupabaseDealRegistry({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes("/deals?")) {
        return Response.json([{
          id: "deal_one",
          workspace_id: "workspace_one",
          company_id: "company_one",
          company_name: "Company one",
          status: "screening",
          analysis_eligible_at: "2026-07-28T11:00:00.000Z",
          active_source_revision_fingerprint: "stale",
        }]);
      }
      if (url.includes("/deal_source_assignments?")) {
        return Response.json([{
          deal_id: "deal_one",
          source_id: "source_one",
          source_revision_id: "revision_one",
        }]);
      }
      return Response.json([]);
    },
  });

  await assert.rejects(
    repository.listAnalysisEligibleBundles("workspace_one"),
    /fingerprint|active source/i,
  );
});

test("Supabase eligible reads reject stale evidence and interaction revision ownership", async () => {
  for (const table of ["source_evidence", "deal_interactions"]) {
    const repository = createSupabaseDealRegistry({
      url: "https://example.supabase.co",
      serviceRoleKey: "test-service-role-key",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/deals?")) {
          return Response.json([{
            id: "deal_one",
            workspace_id: "workspace_one",
            company_id: "company_one",
            company_name: "Company one",
            status: "screening",
            analysis_eligible_at: "2026-07-28T11:00:00.000Z",
            active_source_revision_fingerprint:
              sourceRevisionFingerprint(["revision_one"]),
          }]);
        }
        if (url.includes("/deal_source_assignments?")) {
          return Response.json([{
            deal_id: "deal_one",
            source_id: "source_one",
            source_revision_id: "revision_one",
          }]);
        }
        if (url.includes(`/${table}?`)) {
          return Response.json([{
            id: `${table}_one`,
            workspace_id: "workspace_one",
            deal_id: "deal_one",
            document_id: "source_one",
            source_revision_id: "revision_stale",
            provenance: table === "source_evidence"
              ? "source_document"
              : "demo_fixture",
            page: 1,
            fact: "Fact",
            excerpt: "Excerpt",
            occurred_at: "2026-07-28T10:00:00.000Z",
            meeting_summary: "Summary",
            decision_reason: "Reason",
            concerns: [],
            revisit_conditions: [],
            label: "Sample decision record",
          }]);
        }
        return Response.json([]);
      },
    });
    await assert.rejects(
      repository.listAnalysisEligibleBundles("workspace_one"),
      /inactive|stale|foreign|revision/i,
      table,
    );
  }
});
