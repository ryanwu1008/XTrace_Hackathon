import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryDataClient } from "../../db/client";
import {
  eligibleDealSnapshotFingerprint,
  sourceRevisionFingerprint,
  type DealRegistry,
  type RegisteredDeal,
} from "../../db/repositories/deal-registry";
import { createMemoryIntelligenceRepository } from "../../db/repositories/intelligence";
import { createMemoryMarketEvidenceSnapshotsRepository } from "../../db/repositories/market-evidence-snapshots";
import { createRunsRepository } from "../../db/repositories/runs";
import type { DealMemoryBundle } from "../../lib/contracts/domain";
import type { RunEvidenceBindingV1 } from "../../lib/contracts/evidence-context";
import { WritableMarketEventV2Schema } from "../../lib/contracts/source-evidence";
import { buildPreloadedDealMemoryBundles } from "../../lib/corpus/service";
import { refingerprintMarketEvent } from "../../lib/market/identity";
import type { NormalizedMarketEvent } from "../../lib/market/types";
import { MatchingFailure } from "../../lib/matching/failure";
import { processClaimedRun } from "../../worker/process-run";
import { toPublicReport } from "../../lib/reports/public";
import {
  exactSourceV2,
  marketEventV2,
  normalizedSourceV2,
  TEST_SHA256_A,
} from "../helpers/source-evidence-v2";

const READY_IMPORT_GATE = {
  async assertReady() {},
};

function currentThirtyDealBundles(): DealMemoryBundle[] {
  const original = buildPreloadedDealMemoryBundles();
  const legacyAdditions = Array.from({ length: 4 }, (_, index) => {
    const ordinal = index + 1;
    const source = normalizedSourceV2(`legacy_addition_${ordinal}`, {
      title: `Legacy addition ${ordinal}`,
      canonicalUrl: `https://example.com/legacy-addition-${ordinal}`,
      entityKeys: [`legacy-addition-${ordinal}`],
      sourceRevisionId: `revision_legacy_addition_${ordinal}`,
      contentFingerprint: TEST_SHA256_A,
      text: {
        status: "normalized_only",
        normalizedStatement:
          `Legacy addition ${ordinal} has verified company context.`,
      },
    });
    return {
      dealId: `deal_legacy_addition_${ordinal}`,
      companyName: `Legacy Addition ${ordinal}`,
      status: "screening" as const,
      facts: [{
        text: source.text.status === "normalized_only"
          ? source.text.normalizedStatement
          : "",
        sources: [source],
      }],
      interactions: [],
    };
  });
  const researchScreening = Array.from({ length: 7 }, (_, index) => {
    const ordinal = index + 1;
    const source = normalizedSourceV2(`sample_research_${ordinal}`, {
      provenance: "source_document",
      title: "Sample research screening record",
      canonicalUrl: null,
      documentId: `document_sample_research_${ordinal}`,
      publisher: "Internal Research Registry",
      providerId: "belief-reversal-research-seed-v1",
      eventAt: "2026-08-01T12:00:00.000Z",
      eventAtPrecision: "timestamp",
      publishedAt: null,
      publishedAtPrecision: null,
      retrievedAt: "2026-08-01T12:00:00.000Z",
      retrievedAtPrecision: "timestamp",
      entityKeys: [`research-screening-${ordinal}`],
      sourceClass: "internal_decision_record",
      sourceAuthority: "primary",
      evidenceRole: "context",
      sourceRevisionId: `revision_sample_research_${ordinal}`,
      locator: { kind: "json_pointer", pointer: "/record" },
      contentFingerprint: TEST_SHA256_A,
      text: {
        status: "normalized_only",
        normalizedStatement: [
          "Sample research screening record.",
          "Synthetic research-only context; no meeting or VC interaction occurred.",
          "Disposition: qualified_not_selected.",
          "Qualification: The company identity and evidence are verified.",
          "Not selected reason: Evidence does not yet change a formal action.",
          "Reconsideration conditions: Reconsider after stronger independent evidence.",
        ].join(" "),
      },
    });
    return {
      dealId: `deal_research_screening_${ordinal}`,
      companyName: `Research Screening ${ordinal}`,
      status: "screening" as const,
      facts: [{
        text: source.text.status === "normalized_only"
          ? source.text.normalizedStatement
          : "",
        sources: [source],
      }],
      interactions: [],
    };
  });
  return [...original, ...legacyAdditions, ...researchScreening];
}

function authoritativeDeals(bundles: DealMemoryBundle[]) {
  const deals = new Map<string, RegisteredDeal>(
    bundles.map((bundle) => {
      const revisionIds = [`revision_${bundle.dealId}`];
      return [bundle.dealId, {
        id: bundle.dealId,
        workspaceId: "workspace_demo",
        companyId: `company_${bundle.dealId}`,
        companyName: bundle.companyName,
        status: bundle.status,
        analysisEligibleAt: "2026-07-01T00:00:00.000Z",
        activeSourceRevisionFingerprint:
          sourceRevisionFingerprint(revisionIds),
        activeSourceRevisionIds: revisionIds,
      }];
    }),
  );
  const universes = new Map<string, Awaited<
    ReturnType<DealRegistry["bindRunDealUniverse"]>
  >>();
  return {
    dealRegistry: {
      async bindRunDealUniverse(input: Parameters<
        DealRegistry["bindRunDealUniverse"]
      >[0]) {
        const existing = universes.get(input.runId);
        if (existing) return structuredClone(existing);
        const binding = {
          ...structuredClone(input),
          schemaVersion: "run-deal-universe-binding-v1" as const,
          universeFingerprint: eligibleDealSnapshotFingerprint(
            input.members.map((member) => {
              const deal = deals.get(member.dealId);
              assert.ok(deal, `Missing registered Deal ${member.dealId}`);
              return deal;
            }),
          ),
          dealCount: input.members.length,
        };
        universes.set(input.runId, binding);
        return structuredClone(binding);
      },
      async getRunDealUniverse(input: {
        workspaceId: string;
        runId: string;
      }) {
        assert.equal(input.workspaceId, "workspace_demo");
        return structuredClone(universes.get(input.runId) ?? null);
      },
      async listForWorkspace(workspaceId: string) {
        assert.equal(workspaceId, "workspace_demo");
        return structuredClone([...deals.values()]);
      },
      async listAnalysisEligibleBundles(workspaceId: string) {
        assert.equal(workspaceId, "workspace_demo");
        return structuredClone(bundles);
      },
      async findForWorkspace(input: {
        workspaceId: string;
        dealId: string;
      }) {
        assert.equal(input.workspaceId, "workspace_demo");
        return structuredClone(deals.get(input.dealId) ?? null);
      },
      async getAnalysisEligibleSnapshot(workspaceId: string) {
        assert.equal(workspaceId, "workspace_demo");
        const values = [...deals.values()];
        return {
          count: values.length,
          dealIds: values.map(({ id }) => id).sort(),
          fingerprint: eligibleDealSnapshotFingerprint(values),
        };
      },
    },
    underwriting: {
      async createBatchAndSelections(input: {
        scanRun: { id: string; workspaceId: string };
        analyses: DealMemoryBundle[] | unknown[];
      }) {
        return {
          id: `batch_${input.scanRun.id}`,
          workspaceId: input.scanRun.workspaceId,
          scanRunId: input.scanRun.id,
          status: "completed" as const,
          batchInputFingerprint:
            `sha256:${"a".repeat(64)}`,
          fundPolicySnapshotId: "fund_policy_test",
          rerunOfId: null,
          createdAt: "2026-07-24T12:00:00.000Z",
        };
      },
      async processCandidate() {
        throw new Error(
          "The process-run seam owns automatic candidate processing.",
        );
      },
    },
  };
}

function createTestIntelligenceRepository(
  dealRegistry: DealRegistry = authoritativeDeals(
    buildPreloadedDealMemoryBundles(),
  ).dealRegistry as DealRegistry,
) {
  return createMemoryIntelligenceRepository({
    now: () => new Date("2026-07-24T12:00:00.000Z"),
    dealRegistry,
  });
}

function observeCurrentEvidenceSeams(
  baseRuns: ReturnType<typeof createRunsRepository>,
  baseIntelligence: ReturnType<typeof createTestIntelligenceRepository>,
) {
  let binding: RunEvidenceBindingV1 | null = null;
  let submittedBindingFingerprint: string | undefined;
  const runs = {
    ...baseRuns,
    async bindLiveMarketEvents(
      workspaceId: string,
      runId: string,
      events: readonly unknown[],
    ) {
      binding = await baseRuns.bindLiveMarketEvents(
        workspaceId,
        runId,
        structuredClone(events) as RunEvidenceBindingV1["events"],
      );
      return structuredClone(binding);
    },
    async getEvidenceBinding(workspaceId: string, runId: string) {
      assert.equal(binding?.workspaceId, workspaceId);
      assert.equal(binding?.runId, runId);
      return binding === null ? null : structuredClone(binding);
    },
  };
  const intelligence = {
    ...baseIntelligence,
    async saveReport(
      report: Parameters<typeof baseIntelligence.saveReport>[0],
    ) {
      submittedBindingFingerprint = report.evidenceBindingFingerprint;
      return baseIntelligence.saveReport(report);
    },
  };
  return {
    runs,
    intelligence,
    binding: () => binding,
    submittedBindingFingerprint: () => submittedBindingFingerprint,
  };
}

function marketEventFixture(input: {
  id: string;
  sourceId: string;
  title: string;
  statement: string;
  canonicalUrl: string;
  publishedAt: string;
  retrievedAt?: string;
  providerId?: string;
  eventType: string;
  sectors: string[];
  themes: string[];
  positiveImplications?: string[];
  negativeImplications?: string[];
  confidence: "low" | "medium" | "high";
  entityKeys?: string[];
  publisher?: string;
}): NormalizedMarketEvent {
  const entityKeys = (input.entityKeys ?? []).map((key) =>
    key.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
  ).filter(Boolean);
  const source = normalizedSourceV2(input.sourceId, {
    title: input.title,
    canonicalUrl: input.canonicalUrl,
    publisher: input.publisher ?? "Official source",
    providerId: input.providerId ?? "official",
    eventAt: null,
    eventAtPrecision: null,
    publishedAt: input.publishedAt,
    publishedAtPrecision: "timestamp",
    retrievedAt: input.retrievedAt ?? "2026-07-24T12:00:00.000Z",
    retrievedAtPrecision: "timestamp",
    updatedAt: null,
    updatedAtPrecision: null,
    entityKeys,
    text: {
      status: "normalized_only",
      normalizedStatement: input.statement,
    },
  });
  return marketEventV2(source, {
    id: input.id,
    title: input.title,
    eventType: input.eventType,
    sectors: input.sectors,
    themes: input.themes,
    summary: input.statement,
    positiveImplications: input.positiveImplications ?? [],
    negativeImplications: input.negativeImplications ?? [],
    confidence: input.confidence,
    entityKeys,
  }) as NormalizedMarketEvent;
}

function marketEvent(index: number): NormalizedMarketEvent {
  const hour = String(index).padStart(2, "0");
  return marketEventFixture({
    id: `market_${index}`,
    sourceId: `market_source_${index}`,
    title: `AI infrastructure startup ${index} closes a Series B funding round`,
    statement: `AI infrastructure startup ${index} raised venture funding.`,
    canonicalUrl: `https://example.com/event-${index}`,
    publishedAt: `2026-07-23T${hour}:00:00.000Z`,
    eventType: "funding",
    sectors: ["infrastructure"],
    themes: ["venture-capital"],
    confidence: "high",
    entityKeys: [`entity-${index}`],
  });
}

test("a claimed run fails before market work when durable product-input confirmation is incomplete", async () => {
  const runs = createRunsRepository(createMemoryDataClient());
  await runs.create({
    workspaceId: "workspace_demo",
    mode: "structured",
    windowDays: 14,
  });
  const run = await runs.claimNext("test-worker");
  assert.ok(run);
  let marketCalled = false;

  await assert.rejects(
    processClaimedRun(run, {
      runs,
      intelligence: createTestIntelligenceRepository(),
      ...authoritativeDeals(buildPreloadedDealMemoryBundles()),
      importGate: {
        async assertReady(workspaceId) {
          assert.equal(workspaceId, "workspace_demo");
          throw new Error(
            "The fixed MVP corpus is not confirmed: 12 of 13 product inputs are durable.",
          );
        },
      },
      market: {
        async scanMarketWindow() {
          marketCalled = true;
          throw new Error("Market scanning must not start before import confirmation.");
        },
      },
      reasoner: {
        async reason() {
          throw new Error("Matching must not start before import confirmation.");
        },
      },
    }),
    /12 of 13 product inputs/i,
  );

  assert.equal(marketCalled, false);
  assert.equal((await runs.get(run.workspaceId, run.id))?.status, "failed");
});

test("a failed stage persists its exact error in the durable run warnings", async () => {
  const runs = createRunsRepository(createMemoryDataClient());
  await runs.create({
    workspaceId: "workspace_demo",
    mode: "structured",
    windowDays: 14,
  });
  const run = await runs.claimNext("test-worker");
  assert.ok(run);

  await assert.rejects(
    processClaimedRun(run, {
      runs,
      intelligence: createTestIntelligenceRepository(),
      ...authoritativeDeals(buildPreloadedDealMemoryBundles()),
      importGate: READY_IMPORT_GATE,
      market: {
        async scanMarketWindow() {
          throw new Error("FTC feed returned HTML");
        },
      },
      reasoner: {
        async reason() {
          throw new Error("Matching must not start after a market failure.");
        },
      },
    }),
    /FTC feed returned HTML/,
  );

  const failed = await runs.get(run.workspaceId, run.id);
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.currentStage, "market_scan");
  assert.deepEqual(
    failed?.warnings,
    ["market_scan failed: FTC feed returned HTML"],
  );
});

test("a matching failure persists only its safe code and phase", async () => {
  const baseRuns = createRunsRepository(createMemoryDataClient());
  const stageUpdates: Array<Parameters<typeof baseRuns.updateStage>[0]> = [];
  const runs = {
    ...baseRuns,
    async updateStage(input: Parameters<typeof baseRuns.updateStage>[0]) {
      stageUpdates.push(structuredClone(input));
      return baseRuns.updateStage(input);
    },
  };
  const authoritative = authoritativeDeals(buildPreloadedDealMemoryBundles());
  await runs.create({
    workspaceId: "workspace_demo",
    mode: "structured",
    windowDays: 14,
  });
  const run = await runs.claimNext("test-worker");
  assert.ok(run);
  const sensitiveProviderDetail = "SENSITIVE_PROVIDER_DETAIL_MUST_NOT_PERSIST";

  const result = await processClaimedRun(run, {
    runs,
    intelligence: createTestIntelligenceRepository(
      authoritative.dealRegistry as DealRegistry,
    ),
    ...authoritative,
    importGate: READY_IMPORT_GATE,
    market: {
      async scanMarketWindow() {
        return {
          status: "completed",
          window: {
            from: "2026-07-10T12:00:00.000Z",
            to: "2026-07-24T12:00:00.000Z",
            days: 14,
          },
          providers: [{
            providerId: "official",
            providerName: "Official source",
            fetchedCount: 1,
            acceptedCount: 1,
            rejectedCount: 0,
            lastSuccessAt: "2026-07-24T12:00:00.000Z",
          }],
          events: [marketEventFixture({
            id: "market_matching_failure",
            sourceId: "market_matching_failure_source",
            title: "Realtime infrastructure announcement",
            statement: "A source-backed realtime infrastructure event occurred.",
            canonicalUrl: "https://example.com/matching-failure",
            publishedAt: "2026-07-23T00:00:00.000Z",
            eventType: "technology",
            sectors: ["infrastructure"],
            themes: ["realtime"],
            confidence: "high",
            entityKeys: ["ably"],
          })],
        };
      },
    },
    reasoner: {
      async reason() {
        const failure = new MatchingFailure({
          code: "MATCHING_PROVIDER_AUTH_FAILED",
          phase: "provider_request",
        });
        failure.message = sensitiveProviderDetail;
        throw failure;
      },
    },
    now: () => new Date("2026-07-24T12:00:00.000Z"),
  });

  const expectedWarning = [
    "Company matching was unavailable; affected analyses are marked unavailable.",
    "Diagnostic: code=MATCHING_PROVIDER_AUTH_FAILED phase=provider_request.",
  ].join(" ");
  const failedStage = stageUpdates.find((update) =>
    update.stage === "opportunity_matching" && update.status === "failed"
  );
  assert.equal(failedStage?.warning, expectedWarning);
  assert.ok(result.run.warnings.includes(expectedWarning));
  assert.doesNotMatch(result.run.warnings.join(" "), new RegExp(sensitiveProviderDetail, "u"));
  assert.equal(result.run.status, "partial");
  assert.ok(result.report.companyAnalyses.every((analysis) =>
    analysis.outcome === "analysis_unavailable"
  ));
});

test("a new analysis run rejects registry bundles without immutable Deal revisions", async () => {
  const runs = createRunsRepository(createMemoryDataClient());
  await runs.create({
    workspaceId: "workspace_demo",
    mode: "structured",
    windowDays: 14,
  });
  const run = await runs.claimNext("test-worker");
  assert.ok(run);
  let marketCalled = false;
  const authoritative = authoritativeDeals(
    buildPreloadedDealMemoryBundles(),
  );

  await assert.rejects(
    processClaimedRun(run, {
      runs,
      intelligence: createTestIntelligenceRepository(),
      ...authoritative,
      dealRegistry: {
        ...authoritative.dealRegistry,
        async findForWorkspace() {
          return null;
        },
      },
      importGate: READY_IMPORT_GATE,
      market: {
        async scanMarketWindow() {
          marketCalled = true;
          throw new Error(
            "Market work must not run without an immutable registry snapshot.",
          );
        },
      },
      reasoner: {
        async reason() {
          throw new Error("Reasoning must not run without a snapshot token.");
        },
      },
    }),
    /missing its immutable registry revision snapshot/i,
  );
  assert.equal(marketCalled, false);
});

test("a new analysis run rejects a Deal registry snapshot that changes during startup", async () => {
  const runs = createRunsRepository(createMemoryDataClient());
  await runs.create({
    workspaceId: "workspace_demo",
    mode: "structured",
    windowDays: 14,
  });
  const run = await runs.claimNext("test-worker");
  assert.ok(run);
  const authoritative = authoritativeDeals(
    buildPreloadedDealMemoryBundles(),
  );
  let snapshotReads = 0;
  let marketCalled = false;

  await assert.rejects(
    processClaimedRun(run, {
      runs,
      intelligence: createTestIntelligenceRepository(),
      ...authoritative,
      dealRegistry: {
        ...authoritative.dealRegistry,
        async getAnalysisEligibleSnapshot(workspaceId) {
          const snapshot = await authoritative.dealRegistry
            .getAnalysisEligibleSnapshot(workspaceId);
          snapshotReads += 1;
          return snapshotReads === 1
            ? snapshot
            : {
                ...snapshot,
                fingerprint: `sha256:${"f".repeat(64)}`,
              };
        },
      },
      importGate: READY_IMPORT_GATE,
      market: {
        async scanMarketWindow() {
          marketCalled = true;
          throw new Error(
            "Market work must not run against a torn registry snapshot.",
          );
        },
      },
      reasoner: {
        async reason() {
          throw new Error("Reasoning must not run against a torn snapshot.");
        },
      },
    }),
    /eligible Deal snapshot changed while the scan was starting/i,
  );
  assert.equal(snapshotReads, 2);
  assert.equal(marketCalled, false);
});

test("a delayed current-live claim scans the persisted anchor while recording actual retrieval time", async () => {
  let clock = new Date("2026-07-24T12:00:00.000Z");
  const runs = createRunsRepository(createMemoryDataClient({
    now: () => clock,
  }));
  const queued = await runs.create({
    workspaceId: "workspace_demo",
    mode: "structured",
    windowDays: 14,
  });
  assert.equal(queued.evidenceContext.state, "current");
  if (queued.evidenceContext.state !== "current") {
    throw new Error("The delayed-claim test requires a current run.");
  }
  const persistedAnchorAt = queued.evidenceContext.anchorAt;
  clock = new Date("2026-08-02T12:00:00.000Z");
  const run = await runs.claimNext("test-worker");
  assert.ok(run);
  let scanNow: Date | undefined;
  let scanRetrievedAt: Date | undefined;

  await assert.rejects(
    processClaimedRun(run, {
      runs,
      intelligence: createTestIntelligenceRepository(),
      ...authoritativeDeals(buildPreloadedDealMemoryBundles()),
      importGate: READY_IMPORT_GATE,
      market: {
        async scanMarketWindow(options) {
          scanNow = options?.now;
          scanRetrievedAt = options?.retrievedAt;
          throw new Error("stop after observing the scan clock");
        },
      },
      reasoner: {
        async reason() {
          throw new Error("reasoning must not run after the scan probe");
        },
      },
      now: () => clock,
    }),
    /stop after observing the scan clock/i,
  );

  assert.equal(scanNow?.toISOString(), persistedAnchorAt);
  assert.equal(scanRetrievedAt?.toISOString(), clock.toISOString());
});

test("a current live Worker seals the exact selected events before saving its report", async () => {
  const baseRuns = createRunsRepository(createMemoryDataClient({
    now: () => new Date("2026-07-23T12:00:00.000Z"),
  }));
  const bundles = buildPreloadedDealMemoryBundles();
  const ably = bundles.find(({ dealId }) => dealId === "deal_ably");
  assert.ok(ably);
  for (const fact of ably.facts) {
    fact.sources = fact.sources.map((source) =>
      source.id === "evidence_ably_page_5"
        ? exactSourceV2(source.id, {
          provenance: "source_document",
          title: source.title,
          canonicalUrl: null,
          documentId: "document_ably",
          publisher: null,
          providerId: "source-registry",
          eventAt: null,
          eventAtPrecision: null,
          publishedAt: null,
          publishedAtPrecision: null,
          retrievedAt: "2026-07-01T00:00:00.000Z",
          retrievedAtPrecision: "timestamp",
          updatedAt: null,
          updatedAtPrecision: null,
          entityKeys: ["ably"],
          sourceClass: "company_official",
          sourceAuthority: "primary",
          evidenceRole: "context",
          sourceRevisionId: "revision_evidence_ably_page_5",
          locator: { kind: "document_page", page: 5 },
          text: {
            status: "verified_exact",
            verbatimExcerpt:
              "Ably is architected around four pillars of dependability, for realtime communication at the edge, delivered as a cloud-native pub/sub platform.",
          },
        })
        : source
    );
  }
  const authoritative = authoritativeDeals(bundles);
  const intelligenceBase = createTestIntelligenceRepository(
    authoritative.dealRegistry as DealRegistry,
  );
  const observed = observeCurrentEvidenceSeams(baseRuns, intelligenceBase);
  const { runs, intelligence } = observed;
  const queued = await runs.create({
    workspaceId: "workspace_demo",
    mode: "structured",
    windowDays: 14,
  });
  const run = await runs.claimNext("test-worker");
  assert.equal(run?.id, queued.id);
  let downstreamEvents: NormalizedMarketEvent[] = [];

  const result = await processClaimedRun(run!, {
    runs,
    intelligence,
    ...authoritative,
    importGate: READY_IMPORT_GATE,
    market: {
      async scanMarketWindow() {
        return {
          status: "completed",
          window: {
            from: "2026-07-09T12:00:00.000Z",
            to: "2026-07-23T12:00:00.000Z",
            days: 14,
          },
          providers: [{
            providerId: "official",
            providerName: "Official source",
            fetchedCount: 1,
            acceptedCount: 1,
            rejectedCount: 0,
            lastSuccessAt: "2026-07-23T12:00:00.000Z",
          }],
          events: [marketEventFixture({
            id: "market_1",
            sourceId: "market_source",
            title: "Realtime infrastructure company launches a cloud software platform",
            statement: "The announcement concerns realtime infrastructure and launches a cloud software platform.",
            canonicalUrl: "https://example.com/announcement",
            publishedAt: "2026-07-20T00:00:00.000Z",
            retrievedAt: "2026-07-23T12:00:00.000Z",
            eventType: "technology",
            sectors: ["infrastructure"],
            themes: ["realtime"],
            confidence: "medium",
            entityKeys: ["realtime infrastructure"],
          })],
        };
      },
    },
    reasoner: {
      async reason(input) {
        downstreamEvents = structuredClone(input.events) as NormalizedMarketEvent[];
        return [{
          dealId: "deal_ably",
          whyNow: "The announcement concerns realtime infrastructure and launches a cloud software platform.",
          previousContext: "Ably is architected around four pillars of dependability, for realtime communication at the edge, delivered as a cloud-native pub/sub platform.",
          positiveImplications: ["Relevant market activity may justify another review."],
          negativeImplications: [],
          nextStep: "Review the cited announcement and decide whether to contact the founder.",
          citedSourceIds: ["market_source", "evidence_ably_page_5"],
          demoFixtureIds: [],
          scoreInputs: {
            eventRelevance: 0.85,
            dealRelevance: 0.85,
            priorContextStrength: 0.6,
            evidenceQuality: 0.9,
          },
          claimSourceIds: {
            "The announcement concerns realtime infrastructure and launches a cloud software platform.": ["market_source"],
            "Ably is architected around four pillars of dependability, for realtime communication at the edge, delivered as a cloud-native pub/sub platform.": ["evidence_ably_page_5"],
            "Relevant market activity may justify another review.": [
              "market_source",
              "evidence_ably_page_5",
            ],
          },
        }];
      },
    },
    now: () => new Date("2026-07-23T12:00:00.000Z"),
  });

  assert.equal(result.run.status, "completed", JSON.stringify(result.run.warnings));
  assert.match(result.report.marketSummary, /1 source-backed market event/i);
  assert.equal(result.report.opportunities.length, 0);
  assert.equal(result.report.companyAnalyses.length, 19);
  assert.equal(result.report.counts.companyCount, 19);
  assert.equal(result.report.counts.beliefRevised, 0);
  assert.equal(result.report.priorityDealId, null);
  const persistedEvents = await intelligence.listMarketEvents("workspace_demo");
  assert.equal(persistedEvents.length, 1);
  assert.deepEqual(
    downstreamEvents,
    persistedEvents,
    "the Worker must give matching the exact canonical payload it persisted",
  );
  assert.deepEqual(
    observed.binding()?.events,
    downstreamEvents,
    "the Worker must seal the exact selected canonical payload before report persistence",
  );
  assert.equal(
    observed.submittedBindingFingerprint(),
    observed.binding()?.bindingFingerprint,
  );
  const reportEvent = result.report.companyAnalyses.find(
    (analysis) => analysis.dealId === "deal_ably",
  )?.marketEvidence.events[0];
  assert.equal(
    reportEvent,
    undefined,
    "an untyped legacy match must not promote event evidence into a ranked company analysis",
  );
  assert.notEqual(
    persistedEvents[0].id,
    "market_1",
    "classification changes require a reidentified canonical event",
  );
});

test("a current live Worker persists an explicit empty binding when no event is analysis-eligible", async () => {
  const baseRuns = createRunsRepository(createMemoryDataClient());
  const authoritative = authoritativeDeals(currentThirtyDealBundles());
  const intelligenceBase = createTestIntelligenceRepository(
    authoritative.dealRegistry as DealRegistry,
  );
  const observed = observeCurrentEvidenceSeams(baseRuns, intelligenceBase);
  const { runs, intelligence } = observed;
  await runs.create({
    workspaceId: "workspace_demo",
    mode: "structured",
    windowDays: 14,
  });
  const run = await runs.claimNext("test-worker");
  assert.ok(run);
  let downstreamEventCount = -1;

  const result = await processClaimedRun(run, {
    runs,
    intelligence,
    ...authoritative,
    importGate: READY_IMPORT_GATE,
    market: {
      async scanMarketWindow() {
        return {
          status: "completed",
          window: {
            from: "2026-07-10T12:00:00.000Z",
            to: "2026-07-24T12:00:00.000Z",
            days: 14,
          },
          providers: [{
            providerId: "fda-news",
            providerName: "FDA press releases",
            fetchedCount: 1,
            acceptedCount: 1,
            rejectedCount: 0,
            lastSuccessAt: "2026-07-24T12:00:00.000Z",
          }],
          events: [marketEventFixture({
            id: "generic-fda-release",
            sourceId: "generic-fda-source",
            title: "FDA names a new deputy commissioner",
            statement: "The agency announced a leadership appointment.",
            canonicalUrl: "https://www.fda.gov/news-events/leadership-appointment",
            publishedAt: "2026-07-24T11:30:00.000Z",
            retrievedAt: "2026-07-24T12:00:00.000Z",
            providerId: "fda-news",
            publisher: "U.S. Food and Drug Administration",
            eventType: "regulatory",
            sectors: ["healthcare"],
            themes: ["regulation"],
            confidence: "high",
          })],
        };
      },
    },
    reasoner: {
      async reason(input) {
        downstreamEventCount = input.events.length;
        return [];
      },
    },
    now: () => new Date("2026-07-24T12:00:00.000Z"),
  });

  assert.equal(
    (await intelligence.listMarketEvents("workspace_demo")).length,
    1,
  );
  assert.equal(downstreamEventCount, 0);
  assert.deepEqual(observed.binding()?.events, []);
  assert.equal(
    observed.submittedBindingFingerprint(),
    observed.binding()?.bindingFingerprint,
  );
  assert.equal(result.run.status, "completed");
  assert.equal(result.report.companyAnalyses.length, 30);
  const dealUniverse = await authoritative.dealRegistry.getRunDealUniverse({
    workspaceId: "workspace_demo",
    runId: run.id,
  });
  assert.equal(dealUniverse?.dealCount, 30);
  assert.equal(result.report.counts.noMaterialChange, 30);
  assert.equal(result.report.priorityDealId, null);
  assert.match(result.report.marketSummary, /1 item lacked a bounded market-change signal/i);
});

test("a pinned Worker binds and reloads the exact snapshot without live provider or catalog work", async () => {
  const snapshots = createMemoryMarketEvidenceSnapshotsRepository({
    now: () => new Date("2026-08-01T12:00:00.000Z"),
  });
  const pinnedEvent = WritableMarketEventV2Schema.parse(marketEventV2(exactSourceV2("source_pinned_event", {
    title: "Reviewed pinned evidence",
    canonicalUrl: "https://example.com/pinned-evidence",
    publishedAt: "2026-07-29T15:00:00.000Z",
    retrievedAt: "2026-08-01T12:00:00.000Z",
    sourceRevisionId: "revision_source_pinned_event",
  }), {
    id: "event_pinned_reviewed",
    title: "Reviewed pinned event",
  }));
  const snapshot = await snapshots.create({
    schemaVersion: "market-evidence-snapshot-v1",
    workspaceId: "workspace_demo",
    id: "belief_reversal_2026_08_01",
    snapshotAsOfDate: "2026-08-01",
    windowDays: 14,
    anchorAt: "2026-08-01T23:59:59.999Z",
    windowStartAt: "2026-07-18T00:00:00.000Z",
    windowEndAt: "2026-08-01T23:59:59.999Z",
    windowTimezone: "America/Los_Angeles",
    events: [pinnedEvent],
  });
  const baseRuns = createRunsRepository(createMemoryDataClient({
    now: () => new Date("2026-08-03T12:00:00.000Z"),
    getEvidenceSnapshot: (workspaceId, snapshotId) =>
      snapshots.get(workspaceId, snapshotId),
  }));
  await baseRuns.create({
    workspaceId: "workspace_demo",
    mode: "structured",
    windowDays: 14,
    evidenceRequest: {
      schemaVersion: "run-evidence-request-v1",
      evidenceMode: "pinned",
      snapshotId: snapshot.id,
    },
  });
  const run = await baseRuns.claimNext("test-worker");
  assert.ok(run);
  const authoritative = authoritativeDeals(currentThirtyDealBundles());
  const intelligenceBase = createTestIntelligenceRepository(
    authoritative.dealRegistry as DealRegistry,
  );
  let marketProviderCalls = 0;
  let liveCatalogWrites = 0;
  let matchingEvents: unknown[] = [];

  const result = await processClaimedRun(run, {
    runs: baseRuns,
    intelligence: {
      ...intelligenceBase,
      async saveMarketEvents() {
        liveCatalogWrites += 1;
        throw new Error("Pinned execution must not write the live Market catalog.");
      },
    },
    ...authoritative,
    importGate: READY_IMPORT_GATE,
    market: {
      async scanMarketWindow() {
        marketProviderCalls += 1;
        throw new Error("Pinned execution must not call a Market provider.");
      },
    },
    reasoner: {
      async reason(input) {
        matchingEvents = structuredClone(input.events);
        return [];
      },
    },
    now: () => new Date("2026-08-03T12:00:00.000Z"),
  });

  assert.equal(result.run.status, "completed");
  assert.equal(result.report.companyAnalyses.length, 23);
  const dealUniverse = await authoritative.dealRegistry.getRunDealUniverse({
    workspaceId: "workspace_demo",
    runId: run.id,
  });
  assert.equal(dealUniverse?.dealCount, 23);
  assert.ok(dealUniverse?.members.every(({ dealId }) =>
    !dealId.startsWith("deal_research_screening_")
  ));
  assert.equal(marketProviderCalls, 0);
  assert.equal(liveCatalogWrites, 0);
  assert.deepEqual(matchingEvents, snapshot.events);
  assert.deepEqual(
    (await baseRuns.getEvidenceBinding("workspace_demo", run.id))?.events,
    snapshot.events,
  );
  const binding = await baseRuns.getEvidenceBinding("workspace_demo", run.id);
  assert.ok(binding);
  assert.deepEqual(result.report.evidenceContext, {
    state: "current",
    schemaVersion: "run-evidence-context-v1",
    evidenceMode: "pinned",
    windowDays: 14,
    anchorAt: snapshot.anchorAt,
    windowStartAt: snapshot.windowStartAt,
    windowEndAt: snapshot.windowEndAt,
    windowTimezone: snapshot.windowTimezone,
    snapshotId: snapshot.id,
    snapshotFingerprint: snapshot.snapshotFingerprint,
    contextFingerprint: binding.contextFingerprint,
    displayLabel: "Demo evidence snapshot as of 2026-08-01",
    eventCount: 1,
    eventSetFingerprint: binding.eventSetFingerprint,
    bindingFingerprint: binding.bindingFingerprint,
  });
  assert.deepEqual(
    toPublicReport(result.report).evidenceContext,
    result.report.evidenceContext,
  );
});

test("XTrace recall failure never falls back to structured memory and marks the run partial", async () => {
  const runs = createRunsRepository(createMemoryDataClient({
    now: () => new Date("2026-07-23T12:00:00.000Z"),
  }));
  await runs.create({
    workspaceId: "workspace_demo",
    mode: "xtrace",
    windowDays: 14,
  });
  const run = await runs.claimNext("test-worker");
  assert.ok(run);
  const authoritative = authoritativeDeals(buildPreloadedDealMemoryBundles());

  const result = await processClaimedRun(run, {
    runs,
    intelligence: createTestIntelligenceRepository(
      authoritative.dealRegistry as DealRegistry,
    ),
    ...authoritative,
    importGate: READY_IMPORT_GATE,
    market: {
      async scanMarketWindow() {
        return {
          status: "completed",
          window: {
            from: "2026-07-09T12:00:00.000Z",
            to: "2026-07-23T12:00:00.000Z",
            days: 14,
          },
          providers: [{
            providerId: "official",
            providerName: "Official",
            fetchedCount: 1,
            acceptedCount: 1,
            rejectedCount: 0,
            lastSuccessAt: "2026-07-23T12:00:00.000Z",
          }],
          events: [marketEventFixture({
            id: "market_2",
            sourceId: "market_source_2",
            title: "SEC adopts final cybersecurity disclosure rule",
            statement: "The final rule changes cybersecurity disclosure requirements for public companies.",
            canonicalUrl: "https://example.com/event",
            publishedAt: "2026-07-20T00:00:00.000Z",
            retrievedAt: "2026-07-23T12:00:00.000Z",
            eventType: "regulatory",
            sectors: [],
            themes: [],
            confidence: "medium",
          })],
        };
      },
    },
    reasoner: {
      async reason(input) {
        assert.equal(input.deals.length, 0);
        assert.equal(input.memoryContexts.length, 0);
        return [];
      },
    },
    xtrace: {
      async listOpenIngestJobs() {
        return [];
      },
      async pollIngestJob() {
        throw new Error("No jobs expected");
      },
      async recallDealContext() {
        throw new Error("Request failed validation (422)");
      },
    },
    now: () => new Date("2026-07-23T12:00:00.000Z"),
  });

  assert.equal(result.run.status, "partial");
  assert.equal(result.report.opportunities.length, 0);
  assert.equal(result.report.companyAnalyses.length, 19);
  assert.equal(result.report.counts.analysisUnavailable, 19);
  assert.equal(result.report.analysisStatus, "incomplete");
  assert.match(result.report.marketSummary, /1 source-backed market event/i);
  assert.ok(result.run.warnings.some((warning) =>
    /XTrace recall was unavailable for 19 Deals/i.test(warning)
  ));
  assert.ok(result.run.warnings.every((warning) => !/structured fallback/i.test(warning)));
});

test("normal process-run recall performs zero XTrace ingest-job polling", async () => {
  const runs = createRunsRepository(createMemoryDataClient({
    now: () => new Date("2026-07-24T12:00:00.000Z"),
  }));
  await runs.create({
    workspaceId: "workspace_demo",
    mode: "xtrace",
    windowDays: 14,
  });
  const run = await runs.claimNext("test-worker");
  assert.ok(run);
  const calls: string[] = [];
  const authoritative = authoritativeDeals(buildPreloadedDealMemoryBundles());

  const result = await processClaimedRun(run, {
    runs,
    intelligence: createTestIntelligenceRepository(
      authoritative.dealRegistry as DealRegistry,
    ),
    ...authoritative,
    importGate: READY_IMPORT_GATE,
    market: {
      async scanMarketWindow() {
        return {
          status: "completed",
          window: {
            from: "2026-07-10T12:00:00.000Z",
            to: "2026-07-24T12:00:00.000Z",
            days: 14,
          },
          providers: [{
            providerId: "official",
            providerName: "Official",
            fetchedCount: 1,
            acceptedCount: 1,
            rejectedCount: 0,
            lastSuccessAt: "2026-07-24T12:00:00.000Z",
          }],
          events: [marketEventFixture({
            id: "market_3",
            sourceId: "market_source_3",
            title: "SEC adopts final cybersecurity disclosure rule",
            statement: "The final rule changes cybersecurity disclosure requirements for public companies.",
            canonicalUrl: "https://example.com/event-3",
            publishedAt: "2026-07-22T00:00:00.000Z",
            retrievedAt: "2026-07-24T12:00:00.000Z",
            eventType: "regulatory",
            sectors: [],
            themes: [],
            confidence: "medium",
          })],
        };
      },
    },
    reasoner: { async reason() { return []; } },
    xtrace: {
      async listOpenIngestJobs(workspaceId) {
        assert.equal(workspaceId, "workspace_demo");
        calls.push("list-open-jobs");
        return [{ jobId: "job_1", dealId: "deal_ably" }];
      },
      async pollIngestJob(jobId, options) {
        calls.push(`poll:${jobId}:${options.dealId}`);
        return {
          dealId: options.dealId,
          jobId,
          status: "succeeded",
          memoryIds: ["memory_1"],
        };
      },
      async recallDealContext(input) {
        calls.push("recall");
        assert.equal(input.candidateDealIds.length, 1);
        return [{
          dealId: input.candidateDealIds[0],
          memoryId: `memory_${input.candidateDealIds[0]}`,
          memoryType: "fact",
          text: "Exact active-parent context.",
          score: 0.9,
          provenance: "source_document",
          sourceRevisionIds: [`revision_${input.candidateDealIds[0]}`],
          sourceIds: [`source_${input.candidateDealIds[0]}`],
          fixtureIds: [],
        }];
      },
    },
    now: () => new Date("2026-07-24T12:00:00.000Z"),
  });

  assert.equal(calls.filter((call) => call === "list-open-jobs").length, 0);
  assert.equal(calls.filter((call) => call.startsWith("poll:")).length, 0);
  assert.equal(calls.filter((call) => call === "recall").length, 19);
  assert.equal(result.report.counts.analysisUnavailable, 0);
});

test("bounds market evidence before XTrace and Claude while preserving all events", async () => {
  const runs = createRunsRepository(createMemoryDataClient({
    now: () => new Date("2026-07-24T12:00:00.000Z"),
  }));
  await runs.create({
    workspaceId: "workspace_demo",
    mode: "xtrace",
    windowDays: 14,
  });
  const run = await runs.claimNext("test-worker");
  assert.ok(run);
  const bundles = buildPreloadedDealMemoryBundles();
  const authoritative = authoritativeDeals(bundles);
  const intelligence = createTestIntelligenceRepository(
    authoritative.dealRegistry as DealRegistry,
  );
  const fetchedEvents = Array.from({ length: 23 }, (_, index) =>
    marketEvent(index)
  ).map((event) => refingerprintMarketEvent({
    ...event,
    summary: `${event.summary} ${"market evidence ".repeat(100)}`,
  }));
  const recallQueries: string[] = [];
  let reasonerEventIds: string[] = [];

  const result = await processClaimedRun(run, {
    runs,
    intelligence,
    ...authoritative,
    importGate: READY_IMPORT_GATE,
    market: {
      async scanMarketWindow() {
        return {
          status: "completed",
          window: {
            from: "2026-07-10T12:00:00.000Z",
            to: "2026-07-24T12:00:00.000Z",
            days: 14,
          },
          providers: [{
            providerId: "official",
            providerName: "Official",
            fetchedCount: fetchedEvents.length,
            acceptedCount: fetchedEvents.length,
            rejectedCount: 0,
            lastSuccessAt: "2026-07-24T12:00:00.000Z",
          }],
          events: fetchedEvents,
        };
      },
    },
    xtrace: {
      async listOpenIngestJobs() {
        return [];
      },
      async pollIngestJob() {
        throw new Error("No jobs expected");
      },
      async recallDealContext(input) {
        recallQueries.push(input.query);
        const dealId = input.candidateDealIds[0];
        const bundle = bundles.find((candidate) =>
          candidate.dealId === dealId
        )!;
        return [{
          dealId,
          memoryId: `memory_${dealId}`,
          memoryType: "semantic",
          text: `${bundle.companyName} is described in the supplied deck.`,
          score: 0.9,
          provenance: "source_document",
          sourceIds: bundle.facts.flatMap((fact) =>
            fact.sources.map((source) => source.id)
          ),
          fixtureIds: bundle.interactions.map((interaction) => interaction.id),
        }];
      },
    },
    reasoner: {
      async reason(input) {
        reasonerEventIds = input.events.map((event) => event.id);
        return [];
      },
    },
    now: () => new Date("2026-07-24T12:00:00.000Z"),
  });

  assert.deepEqual(
    reasonerEventIds,
    (await runs.getEvidenceBinding("workspace_demo", run.id))?.events.map(
      (event) => event.id,
    ),
  );
  assert.equal(recallQueries.length, 19);
  assert.ok(
    recallQueries.every((query) => query.length <= 4_000),
    "Every Deal recall query must stay within the XTrace limit",
  );
  assert.ok(recallQueries.some((query) => /Ably/i.test(query)));
  assert.equal(
    (await intelligence.listMarketEvents("workspace_demo")).length,
    fetchedEvents.length,
  );
  assert.equal(result.run.status, "completed", JSON.stringify(result.run.warnings));
  assert.ok(result.run.warnings.every((warning) =>
    !/lower-ranked market events were excluded/i.test(warning)
  ));
  assert.match(result.report.marketSummary, /selected 20 of 23/i);
});
