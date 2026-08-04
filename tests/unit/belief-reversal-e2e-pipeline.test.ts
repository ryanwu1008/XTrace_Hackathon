import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { ClaudeCompleteInput } from "../../lib/claude/client";

import {
  assertBeliefReversalReplayEvidenceIdentity,
  assertBeliefReversalReplayPersistence,
  assertCurrentBeliefReversalColdPass,
  createBeliefReversalDeterministicProviders,
  readBeliefReversalIsolationPersistentCounts,
  readBeliefReversalReplayPersistentCounts,
} from "../helpers/belief-reversal-e2e-pipeline";

const SHA_A = `sha256:${"a".repeat(64)}`;

function exactParentPayload(input: {
  dealId: string;
  companyName: string;
  sourceRevisionId: string;
}) {
  return {
    schemaVersion: "xtrace-parent-v2",
    workspaceId: "workspace_e2e",
    dealId: input.dealId,
    parent: {
      kind: "canonical_source_revision",
      sourceId: `source_${input.dealId}`,
      sourceRevisionId: input.sourceRevisionId,
      fingerprint: SHA_A,
    },
    retrievalPayload: {
      dealId: input.dealId,
      companyName: input.companyName,
      status: "passed",
      facts: [],
      interactions: [],
    },
  };
}

test("deterministic E2E XTrace fake records exact parents and recalls only the queried Deal", async () => {
  const providers = createBeliefReversalDeterministicProviders();
  const henry = await providers.xtraceClient.ingest({
    messages: [{
      role: "user",
      content: JSON.stringify(exactParentPayload({
        dealId: "deal_henry_ai_v1",
        companyName: "Henry AI",
        sourceRevisionId: "revision_henry_v1",
      })),
    }],
    user_id: "workspace:workspace_e2e",
    conv_id: "deal:deal_henry_ai_v1:parent:revision_henry_v1",
  });
  await providers.xtraceClient.ingest({
    messages: [{
      role: "user",
      content: JSON.stringify(exactParentPayload({
        dealId: "deal_irregular_v1",
        companyName: "Irregular",
        sourceRevisionId: "revision_irregular_v1",
      })),
    }],
    user_id: "workspace:workspace_e2e",
    conv_id: "deal:deal_irregular_v1:parent:revision_irregular_v1",
  });

  assert.equal(henry.status, "succeeded");
  assert.equal(henry.result?.memories_created?.length, 1);
  const recalled = await providers.xtraceClient.search({
    query:
      "Henry AI · investment decision · workflow compression · Irregular is mentioned only as context",
    user_id: "workspace:workspace_e2e",
    mode: "retrieve",
    limit: 20,
  });
  assert.equal(recalled.success, true);
  assert.equal(recalled.data.length, 1);
  assert.match(recalled.data[0]!.text, /Henry AI/u);
  assert.deepEqual(providers.inspect().xtrace, {
    ingestCalls: 2,
    searchCalls: 1,
    deleteCalls: 0,
    exactParentCount: 2,
    memoryCount: 2,
  });
});

test("deterministic E2E XTrace fake can prime already-persisted exact parents for a fresh Worker process", async () => {
  const providers = createBeliefReversalDeterministicProviders();
  providers.primeExactParents([{
    workspaceId: "workspace_e2e",
    dealId: "deal_henry_ai_v1",
    sourceId: "source_henry_v1",
    sourceRevisionId: "revision_henry_v1",
    bundle: {
      dealId: "deal_henry_ai_v1",
      companyName: "Henry AI",
      status: "passed",
      facts: [{
        text: "Henry public evidence.",
        sources: [{
          id: "source_henry_v1",
          title: "Henry source",
          provenance: "source_document",
          documentId: "source_henry_v1",
          excerpt: "Henry public evidence.",
        }],
      }],
      interactions: [],
    },
    parentKind: "legacy_source_revision",
    parentFingerprint: SHA_A,
    payloadFingerprint: SHA_A,
  }]);

  const recalled = await providers.xtraceClient.search({
    query: "Henry AI · investment decision",
    user_id: "workspace:workspace_e2e",
    mode: "retrieve",
    limit: 20,
  });

  assert.equal(recalled.data.length, 1);
  assert.match(recalled.data[0]!.text, /xtrace-parent-v2/u);
  assert.deepEqual(providers.inspect().xtrace, {
    ingestCalls: 0,
    searchCalls: 1,
    deleteCalls: 0,
    exactParentCount: 1,
    memoryCount: 1,
  });
});

test("deterministic matching fake returns observations and primitive scores but no downstream decision fields", async () => {
  const providers = createBeliefReversalDeterministicProviders();
  const response = JSON.parse(await providers.claudeClient.complete({
    system: "You are an evidence-constrained venture-capital research analyst.",
    messages: [{
      role: "user",
      content: JSON.stringify({
        task: "Rank credible Deal/event overlaps for human follow-up.",
        deals: [{
          id: "deal_henry_ai_v1",
          companyName: "Henry AI",
          status: "passed",
        }],
        marketEvents: [{
          id: "event_henry_series_a_v1",
          triggerSourceId: "claim_henry_series_a_v1",
          sources: [
            {
              id: "claim_henry_series_a_v1",
              sourceRevisionId: "source_revision_source_henry_series_a_v1_1",
              evidenceRole: "trigger",
              factEligible: true,
              normalizedStatement:
                "Henry announced a $16.5 million Series A led by FirstMark Capital.",
              verbatimExcerpt: null,
            },
            {
              id: "claim_henry_workflow_v1",
              evidenceRole: "corroborating",
              factEligible: true,
              normalizedStatement:
                "Henry reports that work estimated at 15 hours per deliverable now takes about 30 minutes of human review.",
              verbatimExcerpt: null,
            },
            {
              id: "claim_henry_terms_v1",
              evidenceRole: "counterevidence",
              factEligible: true,
              normalizedStatement:
                "Henry's terms warn that outputs may not always be accurate or complete.",
              verbatimExcerpt: null,
            },
          ],
        }],
        memoryContexts: [{
          dealId: "deal_henry_ai_v1",
          interactionCandidates: [{
            id: "fixture_henry_passed_v1",
            occurredAt: "2026-06-10T10:00:00-07:00",
            sourceIds: ["fixture_henry_passed_v1"],
            revisitConditions: [
              "A source-backed deployment result shows a substantial reduction in human work.",
            ],
            provenance: "demo_fixture",
            label: "Sample decision record",
          }],
        }],
        sources: [{
          id: "fixture_henry_passed_v1",
          evidenceRole: "context",
          factEligible: true,
          normalizedStatement:
            "Sample decision record. The sample decision required workflow compression.",
          verbatimExcerpt: null,
        }],
      }),
    }],
    maxTokens: 6_000,
  })) as Array<Record<string, unknown>>;

  assert.equal(response.length, 1);
  assert.equal(response[0]?.dealId, "deal_henry_ai_v1");
  assert.deepEqual(Object.keys(response[0] ?? {}).filter((key) =>
    ["direction", "rank", "actions", "decision", "confidence", "finalScore"]
      .includes(key)
  ), []);
  assert.deepEqual(response[0]?.scoreInputs, {
    eventRelevance: 0.9,
    dealRelevance: 0.9,
    priorContextStrength: 0.92,
    evidenceQuality: 0.94,
  });
});

test("deterministic matching fake follows the collected live event and trigger identities", async () => {
  const providers = createBeliefReversalDeterministicProviders();
  const request = {
    system: "You are an evidence-constrained venture-capital research analyst.",
    messages: [{
      role: "user",
      content: JSON.stringify({
        task: "Rank credible Deal/event overlaps for human follow-up.",
        deals: [{
          id: "deal_henry_ai_v1",
          companyName: "Henry AI",
          status: "passed",
        }],
        marketEvents: [{
          id: "event_live_collected_henry_v1",
          title: "Henry reports a $16.5 million Series A",
          triggerSourceId: "claim_henry_series_a_v1",
          entityKeys: ["henry_ai"],
          sources: [{
            id: "claim_henry_series_a_v1",
            sourceRevisionId: "source_revision_source_henry_series_a_v1_1",
            evidenceRole: "trigger",
            factEligible: true,
            normalizedStatement:
              "Henry announced a $16.5 million Series A led by FirstMark Capital.",
            verbatimExcerpt: null,
          }],
        }],
        memoryContexts: [{
          dealId: "deal_henry_ai_v1",
          interactionCandidates: [{
            id: "fixture_henry_passed_v1",
            occurredAt: "2026-06-10T10:00:00-07:00",
            sourceIds: ["fixture_henry_passed_v1"],
            revisitConditions: [
              "A source-backed deployment result shows a substantial reduction in human work.",
            ],
            provenance: "demo_fixture",
            label: "Sample decision record",
          }],
        }],
        sources: [{
          id: "fixture_henry_passed_v1",
          evidenceRole: "context",
          factEligible: true,
          normalizedStatement:
            "Sample decision record. The sample decision required workflow compression.",
          verbatimExcerpt: null,
        }, {
          id: "claim_henry_workflow_v1",
          evidenceRole: "corroborating",
          factEligible: true,
          normalizedStatement:
            "Henry reports that work estimated at 15 hours per deliverable now takes about 30 minutes of human review.",
          verbatimExcerpt: null,
        }, {
          id: "claim_henry_terms_v1",
          evidenceRole: "counterevidence",
          factEligible: true,
          normalizedStatement:
            "Henry's terms warn that outputs may not always be accurate or complete.",
          verbatimExcerpt: null,
        }],
      }),
    }],
    maxTokens: 6_000,
  } satisfies ClaudeCompleteInput;
  const response = JSON.parse(
    await providers.claudeClient.complete(request),
  ) as Array<Record<string, unknown>>;

  assert.equal(response.length, 1);
  assert.equal(response[0]?.selectedTriggerEventId, "event_live_collected_henry_v1");
  assert.deepEqual(
    response[0]?.revisitCitedSourceIds,
    ["claim_henry_series_a_v1"],
  );
  assert.ok(
    (response[0]?.citedSourceIds as string[])
      .includes("claim_henry_series_a_v1"),
  );

  const wrongLineage = JSON.parse(request.messages[0]!.content) as {
    marketEvents: Array<{ sources: Array<{ sourceRevisionId: string }> }>;
  };
  wrongLineage.marketEvents[0]!.sources[0]!.sourceRevisionId =
    "source_revision_wrong_henry_v1";
  await assert.rejects(
    providers.claudeClient.complete({
      ...request,
      messages: [{ role: "user", content: JSON.stringify(wrongLineage) }],
    }),
    /matching authority is missing for deal_henry_ai_v1/u,
  );
});

test("deterministic framework fake partitions immutable inputs and never emits a formal decision", async () => {
  const providers = createBeliefReversalDeterministicProviders();
  const response = JSON.parse(await providers.claudeClient.complete({
    system: "You are one independent, evidence-grounded venture framework lens.",
    messages: [{
      role: "user",
      content: JSON.stringify({
        card: {
          id: "framework_gtm_unit_economics_v1",
          title: "GTM & Unit Economics",
        },
        evidencePack: {
          facts: [{ id: "fact_1" }, { id: "fact_2" }],
          assumptions: [{ id: "assumption_1" }],
        },
      }),
    }],
    maxTokens: 4_000,
  })) as Record<string, unknown>;

  assert.equal(response.applicability, "applicable");
  assert.equal(response.conclusion, "supportive");
  assert.deepEqual([
    ...(response.supportEvidenceItemIds as string[]),
    ...(response.counterEvidenceItemIds as string[]),
    ...(response.unusedEvidenceItemIds as string[]),
  ].sort(), ["assumption_1", "fact_1", "fact_2"]);
  assert.equal("decision" in response, false);
  assert.equal("action" in response, false);
  assert.equal("rank" in response, false);
});

test("persistent replay count snapshot reads exact durable PostgREST row counts", async () => {
  const requested: Array<{ url: string; init: RequestInit }> = [];
  const counts = await readBeliefReversalReplayPersistentCounts({
    target: {
      databaseName: "vsee_e2e_task12_unit_0123456789abcdef",
      postgresVersion: "17.6",
      postgrestUrl: "http://127.0.0.1:43123/",
      postgrestVersion: "12.2.3",
      serviceRoleKey: "unit-service-role-key",
    },
    workspaceId: "workspace_e2e",
    fetchImpl: async (url, init = {}) => {
      requested.push({ url: String(url), init });
      const path = new URL(String(url)).pathname;
      const total = path.endsWith("/reasoner_judgments")
        ? 1
        : path.endsWith("/xtrace_ingest_intents_v2")
        ? 85
        : path.endsWith("/xtrace_memory_links_v2")
        ? 85
        : -1;
      return new Response("[]", {
        status: 206,
        headers: { "content-range": `0-0/${total}` },
      });
    },
  });

  assert.deepEqual(counts, {
    reasonerJudgments: 1,
    xtraceIngestIntents: 85,
    xtraceMemoryLinks: 85,
  });
  assert.equal(requested.length, 3);
  assert.ok(requested.every(({ init }) => init.method === "GET"));
  assert.ok(requested.every(({ init }) =>
    new Headers(init.headers).get("prefer") === "count=exact"
  ));
  assert.ok(requested.slice(1).every(({ url }) =>
    new URL(url).searchParams.get("workspace_id") === "eq.workspace_e2e"
  ));
});

test("persistent replay count snapshot fails closed without an exact PostgREST count", async () => {
  await assert.rejects(
    readBeliefReversalReplayPersistentCounts({
      target: {
        databaseName: "vsee_e2e_task12_unit_0123456789abcdef",
        postgresVersion: "17.6",
        postgrestUrl: "http://127.0.0.1:43123/",
        postgrestVersion: "12.2.3",
        serviceRoleKey: "unit-service-role-key",
      },
      workspaceId: "workspace_e2e",
      fetchImpl: async () => Response.json([]),
    }),
    /exact durable row count/u,
  );
});

test("live isolation probe re-reads run, step, lineage, source, sample, and rate-limit state", async () => {
  const totals = new Map([
    ["scan_runs", 2],
    ["scan_run_steps", 14],
    ["source_revisions", 80],
    ["deal_interactions", 23],
    ["reasoner_judgments", 1],
    ["xtrace_ingest_intents_v2", 85],
    ["xtrace_memory_links_v2", 85],
  ]);
  const counts = await readBeliefReversalIsolationPersistentCounts({
    target: {
      databaseName: "vsee_e2e_task12_unit_0123456789abcdef",
      postgresVersion: "17.6",
      postgrestUrl: "http://127.0.0.1:43123/",
      postgrestVersion: "12.2.3",
      serviceRoleKey: "unit-service-role-key",
    },
    workspaceId: "workspace_e2e",
    fetchImpl: async (request) => {
      const table = new URL(String(request)).pathname.split("/").at(-1)!;
      if (table === "public_request_limits") {
        return Response.json([{ request_count: 4 }, { request_count: 5 }]);
      }
      const total = totals.get(table);
      assert.notEqual(total, undefined);
      return new Response("[]", {
        status: 206,
        headers: { "content-range": `0-0/${total}` },
      });
    },
  });

  assert.deepEqual(counts, {
    scanRuns: 2,
    scanRunSteps: 14,
    sourceRevisions: 80,
    sampleInteractions: 23,
    reasonerJudgments: 1,
    xtraceIngestIntents: 85,
    xtraceMemoryLinks: 85,
    rateLimitRequests: 9,
  });
});

test("persistent replay delta rejects any new reasoner or exact-lineage row", () => {
  const first = {
    reasonerJudgments: 1,
    xtraceIngestIntents: 85,
    xtraceMemoryLinks: 85,
  };
  assert.deepEqual(assertBeliefReversalReplayPersistence(first, first), {
    before: first,
    after: first,
    delta: {
      reasonerJudgments: 0,
      xtraceIngestIntents: 0,
      xtraceMemoryLinks: 0,
    },
  });
  assert.throws(
    () => assertBeliefReversalReplayPersistence(first, {
      ...first,
      reasonerJudgments: 2,
    }),
    /reuse durable reasoner judgments/u,
  );
  assert.throws(
    () => assertBeliefReversalReplayPersistence(first, {
      ...first,
      xtraceMemoryLinks: 86,
    }),
    /reuse durable reasoner judgments/u,
  );
});

test("pinned replay requires shared evidence identity and authentic run-scoped bindings", () => {
  const workspaceId = "workspace_e2e";
  const firstRunId = "11111111-1111-4111-8111-111111111111";
  const replayRunId = "22222222-2222-4222-8222-222222222222";
  const bindingFingerprint = (runId: string) => {
    const hash = createHash("sha256");
    for (const frame of [
      "run-evidence-binding-v1",
      workspaceId,
      runId,
      `sha256:${"2".repeat(64)}`,
      `sha256:${"3".repeat(64)}`,
      "4",
    ]) {
      const bytes = Buffer.from(frame, "utf8");
      hash.update(`${bytes.length}:`);
      hash.update(bytes);
    }
    return `sha256:${hash.digest("hex")}`;
  };
  const reportEvidenceContext = {
    state: "current" as const,
    schemaVersion: "run-evidence-context-v1" as const,
    evidenceMode: "pinned" as const,
    windowDays: 14 as const,
    anchorAt: "2026-08-01T23:59:59.999Z",
    windowStartAt: "2026-07-19T00:00:00.000Z",
    windowEndAt: "2026-08-01T23:59:59.999Z",
    windowTimezone: "America/Los_Angeles",
    snapshotId: "belief_reversal_2026_08_01",
    snapshotFingerprint: `sha256:${"1".repeat(64)}`,
    contextFingerprint: `sha256:${"2".repeat(64)}`,
    displayLabel: "Demo evidence snapshot as of 2026-08-01",
    eventCount: 4,
    eventSetFingerprint: `sha256:${"3".repeat(64)}`,
    bindingFingerprint: bindingFingerprint(firstRunId),
  };
  const runEvidenceContext = {
    state: reportEvidenceContext.state,
    schemaVersion: reportEvidenceContext.schemaVersion,
    evidenceMode: reportEvidenceContext.evidenceMode,
    windowDays: reportEvidenceContext.windowDays,
    anchorAt: reportEvidenceContext.anchorAt,
    windowStartAt: reportEvidenceContext.windowStartAt,
    windowEndAt: reportEvidenceContext.windowEndAt,
    windowTimezone: reportEvidenceContext.windowTimezone,
    snapshotId: reportEvidenceContext.snapshotId,
    snapshotFingerprint: reportEvidenceContext.snapshotFingerprint,
    contextFingerprint: reportEvidenceContext.contextFingerprint,
  };
  const first = {
    run: { id: firstRunId, workspaceId, evidenceContext: runEvidenceContext },
    report: { evidenceContext: reportEvidenceContext },
  };
  const replay = structuredClone(first);
  replay.run.id = replayRunId;
  replay.report.evidenceContext.bindingFingerprint = bindingFingerprint(replayRunId);

  assert.doesNotThrow(() => assertBeliefReversalReplayEvidenceIdentity(
    first,
    replay,
  ));
  const changed = structuredClone(replay);
  changed.report.evidenceContext.bindingFingerprint =
    `sha256:${"5".repeat(64)}`;
  assert.throws(
    () => assertBeliefReversalReplayEvidenceIdentity(first, changed),
    /replay evidence identity/u,
  );

  const reportWindowChanged = structuredClone(replay);
  reportWindowChanged.report.evidenceContext.anchorAt =
    "2026-08-02T23:59:59.999Z";
  assert.throws(
    () => assertBeliefReversalReplayEvidenceIdentity(
      first,
      reportWindowChanged,
    ),
    /replay evidence identity/u,
  );
});

const CURRENT_SCREENING_DEALS = [
  "deal_centralize_v1",
  "deal_chipagents_v1",
  "deal_sent_v1",
  "deal_cascade_v1",
  "deal_cordant_v1",
  "deal_empirical_security_v1",
  "deal_freight_hero_v1",
] as const;

function currentColdPassFixture() {
  const workspaceId = "workspace_current_30";
  const runId = "33333333-3333-4333-8333-333333333333";
  const reportId = `report_${runId}`;
  const batchId = `batch_${runId}`;
  const beliefRevisedDeals = [
    "deal_henry_ai_v1",
    "deal_smallest_ai_v1",
    "deal_hush_security_v1",
    "deal_irregular_v1",
  ];
  const noChangeDeals = Array.from(
    { length: 19 },
    (_, index) => `deal_original_${index + 1}`,
  );
  const analysis = (
    dealId: string,
    outcome: "belief_revised" | "monitor" | "no_material_change",
    index: number,
  ) => ({
    id: `${reportId}:${dealId}`,
    reportId,
    runId,
    dealId,
    companyName: dealId,
    dealStatus: CURRENT_SCREENING_DEALS.includes(
        dealId as typeof CURRENT_SCREENING_DEALS[number]
      )
      ? "screening"
      : "watchlist",
    outcome,
    confidence: outcome === "belief_revised" ? "high" : "low",
    score: outcome === "belief_revised" ? 0.95 - index * 0.01 : 0.2,
    currentRunAudit: {
      schemaVersion: "company-analysis-current-run-audit-v1",
      workspaceId,
      companyId: `company_${dealId}`,
      stableDealId: dealId,
      priorDealStatus: CURRENT_SCREENING_DEALS.includes(
          dealId as typeof CURRENT_SCREENING_DEALS[number]
        )
        ? "screening"
        : "watchlist",
      analysisEligibleAt: "2026-08-03T12:00:00.000Z",
      dealUniverseId: `deal_universe_${runId}`,
      dealUniverseFingerprint: `sha256:${"a".repeat(64)}`,
      evidenceContextFingerprint: `sha256:${"b".repeat(64)}`,
      evidenceBindingFingerprint: `sha256:${"c".repeat(64)}`,
      priorMemory: {
        kind: CURRENT_SCREENING_DEALS.includes(
            dealId as typeof CURRENT_SCREENING_DEALS[number]
          )
          ? "screening"
          : "investment",
      },
      outcome,
    },
  });
  const companyAnalyses = [
    ...beliefRevisedDeals.map((dealId, index) =>
      analysis(dealId, "belief_revised", index)
    ),
    ...CURRENT_SCREENING_DEALS.map((dealId, index) =>
      analysis(dealId, "monitor", index)
    ),
    ...noChangeDeals.map((dealId, index) =>
      analysis(dealId, "no_material_change", index)
    ),
  ];
  const selections = beliefRevisedDeals.map((dealId, index) => ({
    batchId,
    dealId,
    status: "selected",
    rank: index + 1,
    reason: "Belief revision admitted to Deep Underwriting.",
  }));
  const candidates = beliefRevisedDeals.map((dealId) => ({
    id: `candidate_${dealId}`,
    workspaceId,
    batchId,
    dealId,
    status: "completed",
  }));
  return {
    report: {
      id: reportId,
      workspaceId,
      runId,
      counts: {
        companyCount: 30,
        beliefRevised: 4,
        monitor: 7,
        noMaterialChange: 19,
        analysisUnavailable: 0,
      },
      companyAnalyses,
      evidenceContext: {
        state: "current",
        evidenceMode: "live",
        contextFingerprint: `sha256:${"b".repeat(64)}`,
        bindingFingerprint: `sha256:${"c".repeat(64)}`,
      },
    },
    batch: { id: batchId, workspaceId, scanRunId: runId, status: "completed" },
    selections,
    candidates,
    artifacts: candidates.map((candidate) => ({
      candidateRunId: candidate.id,
      workspaceId,
      dealId: candidate.dealId,
    })),
  };
}

test("current cold pass proves 30 audited Deals, 4/7/19/0 outcomes, and every belief revision enters Deep Underwriting", () => {
  const fixture = currentColdPassFixture();

  assert.doesNotThrow(() => assertCurrentBeliefReversalColdPass(fixture, {
    beliefRevised: 4,
    monitor: 7,
    noMaterialChange: 19,
    analysisUnavailable: 0,
    screeningOutcomeByDeal: Object.fromEntries(
      fixture.report.companyAnalyses
        .filter(({ dealStatus }) => dealStatus === "screening")
        .map(({ dealId }) => [dealId, "monitor"]),
    ),
  }));
});

test("current cold pass rejects a pre-generated 23-analysis report or rank-based underwriting truncation", () => {
  const fixture = currentColdPassFixture();
  fixture.report.companyAnalyses = fixture.report.companyAnalyses.slice(0, 23);
  assert.throws(
    () => assertCurrentBeliefReversalColdPass(fixture),
    /exactly 30 CompanyAnalyses/u,
  );

  const truncated = currentColdPassFixture();
  truncated.candidates = truncated.candidates.slice(0, 3);
  truncated.artifacts = truncated.artifacts.slice(0, 3);
  assert.throws(
    () => assertCurrentBeliefReversalColdPass(truncated),
    /every and only belief-revised Deal/u,
  );
});
