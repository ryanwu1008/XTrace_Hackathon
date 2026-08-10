import assert from "node:assert/strict";
import test from "node:test";

import {
  createMemoryDataClient,
  type RunRecord,
} from "../../db/client";
import {
  createMemoryIntelligenceRepository,
  type IntelligenceReportRecord,
} from "../../db/repositories/intelligence";
import {
  createMemoryDealRegistry,
  sourceRevisionFingerprint,
  type RegisteredDeal,
} from "../../db/repositories/deal-registry";
import {
  createMemoryEvidencePacksRepository,
} from "../../db/repositories/evidence-packs";
import {
  createMemorySourceRegistry,
} from "../../db/repositories/source-registry";
import { createRunsRepository } from "../../db/repositories/runs";
import {
  createMemoryUnderwritingArtifactsRepository,
} from "../../db/repositories/underwriting-artifacts";
import { createMemoryNamedLensArtifactsRepository } from
  "../../db/repositories/named-lens-artifacts";
import type { NamedLensArtifactsRepository } from
  "../../db/repositories/named-lens-artifacts";
import {
  createMemoryUnderwritingCandidateLeaseAuthority,
  createMemoryUnderwritingRunsRepository,
  type CandidateFinalization,
} from "../../db/repositories/underwriting-runs";
import {
  BeliefChangeAssessmentV1Schema,
  CompanyAnalysisSchema,
  type CompanyAnalysis,
  type DealSemanticField,
  type DealInteraction,
} from "../../lib/contracts/domain";
import { sourceTextForRetrieval } from "../../lib/contracts/source-evidence";
import { interactionSourceV2 } from "../../lib/matching/context";
import { buildOpportunityScoreBreakdown } from "../../lib/matching/scoring";
import { evaluateBeliefRevisionHardGates } from "../../lib/matching/hard-gates";
import {
  BELIEF_ACTION_POLICY_VERSION,
  actionsForDealStatusAndDirection,
  renderRecommendedNextMove,
} from "../../lib/reports/action-policy";
import {
  ACTION_DRAFT_POLICY_VERSION,
  ScenarioInputFieldSchema,
  type CandidateRun,
  type FundPolicySnapshot,
} from "../../lib/contracts/underwriting";
import {
  createSourceGroundedCandidateExecutor,
  createUnderwritingOrchestrator,
} from "../../lib/underwriting/orchestrator";
import {
  type CandidateGroundingPort,
  createEvidencePackCandidateGrounding,
} from "../../lib/underwriting/candidate-grounding";
import {
  createEvidencePackBuilder,
} from "../../lib/underwriting/evidence/builder";
import {
  SEMANTIC_CONTEXT_ASSUMPTION_POLICY_VERSION,
  SEMANTIC_CONTEXT_MAPPING_VERSION,
} from "../../lib/underwriting/evidence/semantic-projector";
import { createActionDraftGenerator } from "../../lib/underwriting/action-drafts";
import {
  buildCandidateMissingEvidence,
} from "../../lib/underwriting/missing-evidence";
import { IntegrationTransportError } from "../../lib/api/errors";
import {
  CONTEXT_ROUTER_VERSION,
  createContextRouter,
  type CriticalEvidenceProfile,
} from "../../lib/underwriting/router";
import {
  createBatchInputFingerprint,
  createCanonicalFingerprint,
  createReferenceCatalogSnapshot,
} from "../../lib/underwriting/fingerprints";
import {
  createContextAwareFrameworkLensResolver,
} from "../../lib/underwriting/frameworks/service";
import type {
  FrameworkLensService,
} from "../../lib/underwriting/frameworks/service";
import { createNamedLensProviderTimeoutPolicy } from
  "../../lib/underwriting/frameworks/timeout-policy";
import { withEmptyCurrentNamedLensArtifacts } from
  "../helpers/current-named-lens-finalization";
import { withWithheldCurrentNamedLensArtifacts } from
  "../helpers/current-named-lens-finalization";
import {
  CURRENT_FRAMEWORK_LENS_PASSAGE_CONTRACT,
} from "../../lib/underwriting/frameworks/passage-contract";
import {
  buildFrameworkAbstention,
} from "../../lib/underwriting/frameworks/grounding";
import type {
  FrameworkCard,
} from "../../lib/underwriting/frameworks/schemas";
import type {
  ClaudeClient,
  ClaudeCompleteInput,
} from "../../lib/claude/client";
import { BALANCED_POLICY_VALUES } from "../../seed/underwriting/balanced-policy-v1";
import { SYNTHETIC_FRAMEWORK_PACK } from "../../seed/underwriting/framework-pack-v1";
import {
  processClaimedRun,
  projectRecommendedOpportunities,
} from "../../worker/process-run";
import {
  createWorkerCandidateExecutionContract,
  createWorkerCandidateExecutionFingerprint,
} from "../../worker/runner";
import { rankBeliefRevisionCandidates } from "../../lib/matching/ranking";
import { buildInternalReportDraft } from "../../lib/reports/draft";
import type { NormalizedMarketEvent } from "../../lib/market/types";
import {
  exactSourceV2,
  marketEventV2,
  normalizedSourceV2,
} from "../helpers/source-evidence-v2";
import { buildSampleDecisionSourceRef } from
  "../../lib/belief-reversal/sample-decision-source";

const NOW = new Date("2026-07-29T12:00:00.000Z");
const TEST_STATIC_FRAMEWORK_CATALOG = {
  catalogVersion: "deterministic-test-framework-catalog-v1",
  catalogFingerprint: `sha256:${"7".repeat(64)}`,
  corpusDigest: `sha256:${"8".repeat(64)}`,
};

type TestCandidateStageRuntime = Parameters<
  NonNullable<
    Parameters<typeof createUnderwritingOrchestrator>[0]["candidateExecutor"]
  >
>[0]["stages"];

async function persistFinalizationFrameworkCatalogCheckpoint(
  stages: TestCandidateStageRuntime,
  payload: CandidateFinalization,
): Promise<void> {
  const output = {
    catalogVersion: payload.versionSnapshot.frameworkCatalogVersion!,
    catalogFingerprint:
      payload.versionSnapshot.frameworkCatalogFingerprint!,
    corpusDigest: payload.versionSnapshot.frameworkCorpusDigest!,
  };
  await stages.run({
    stage: "framework_catalog",
    inputFingerprint: createCanonicalFingerprint({
      stage: "framework_catalog",
      fixture: "current-finalization-authority-v1",
      output,
    }),
    parseOutput(value) {
      assert.deepEqual(value, output);
      return value as typeof output;
    },
    operation: () => output,
  });
}

function canonicalFrameworkAbstentions(
  request: Parameters<FrameworkLensService["runAll"]>[0],
): Awaited<ReturnType<FrameworkLensService["runAll"]>> {
  return {
    judgments: canonicalFrameworkAbstentionJudgments(request),
    disagreements: [],
    passageCandidates: [],
    passageResults: [],
    taxonomyByFrameworkId: {},
    passageContract: CURRENT_FRAMEWORK_LENS_PASSAGE_CONTRACT,
  };
}

function canonicalFrameworkAbstentionJudgments(
  request: Pick<
    Parameters<FrameworkLensService["runAll"]>[0],
    "candidate" | "pack" | "calculations"
  >,
): Awaited<ReturnType<FrameworkLensService["runAll"]>>["judgments"] {
  assert.equal(SYNTHETIC_FRAMEWORK_PACK.cards.length, 8);
  return SYNTHETIC_FRAMEWORK_PACK.cards.map((card) =>
    buildFrameworkAbstention({
      candidate: request.candidate,
      pack: request.pack,
      card,
      calculations: request.calculations,
      fingerprint: createCanonicalFingerprint({
        fixture: "canonical-framework-abstention-v1",
        candidateRunId: request.candidate.id,
        frameworkCardId: card.id,
        frameworkVersion: card.version,
      }),
      applicability: "unavailable",
      reason:
        "Framework execution is unavailable in this deterministic test fixture.",
    })
  );
}

test("a static Framework service cannot skip immutable catalog authority", () => {
  assert.throws(() => createSourceGroundedCandidateExecutor({
    grounding: {} as CandidateGroundingPort,
    frameworkLenses: {
      async runAll(request) {
        return canonicalFrameworkAbstentions(request);
      },
    },
    execution: {
      providerModel: "synthetic-test-lens",
      promptVersion: "framework-lens-v1",
      schemaVersion: "framework-judgment-v1",
      settingsFingerprint: `sha256:${"b".repeat(64)}`,
      applicationCommit: "task7-test",
    },
  }), /explicit immutable catalog binding/);
});

const IMAGE_INTERACTION = {
  id: "fixture_image",
  occurredAt: "2026-06-01T12:00:00.000Z",
  summary:
    "Image Acme was previously passed while enterprise deployment evidence was missing.",
  decisionReason:
    "The synthetic team required enterprise deployment evidence before reopening diligence.",
  concerns: ["Enterprise adoption was not yet verified."],
  revisitConditions: [
    "Revisit after a verified enterprise deployment.",
  ],
  priorActions: actionsForDealStatusAndDirection("passed", "none"),
  provenance: "demo_fixture",
  label: "Sample decision record",
} satisfies DealInteraction;

const IMAGE_DECISION_EVIDENCE = sourceTextForRetrieval(
  interactionSourceV2(IMAGE_INTERACTION),
);

function underwritingMarketEvent(input: {
  id: string;
  sourceId: string;
  title: string;
  statement: string;
  canonicalUrl: string;
  eventType: string;
  sectors: string[];
  themes: string[];
  positiveImplications?: string[];
  entityKeys: string[];
}): NormalizedMarketEvent {
  const source = normalizedSourceV2(input.sourceId, {
    title: input.title,
    canonicalUrl: input.canonicalUrl,
    publisher: "Official source",
    providerId: "official",
    eventAt: "2026-07-28T00:00:00.000Z",
    eventAtPrecision: "timestamp",
    publishedAt: "2026-07-28T00:00:00.000Z",
    publishedAtPrecision: "timestamp",
    retrievedAt: NOW.toISOString(),
    retrievedAtPrecision: "timestamp",
    updatedAt: null,
    updatedAtPrecision: null,
    entityKeys: input.entityKeys,
    text: {
      status: "normalized_only",
      normalizedStatement: input.statement,
    },
  });
  const counter = normalizedSourceV2(`${input.sourceId}_counter`, {
    title: `${input.title} counterevidence`,
    canonicalUrl: `${input.canonicalUrl}/counterevidence`,
    publisher: "Official source",
    providerId: "official",
    eventAt: "2026-07-28T00:00:00.000Z",
    eventAtPrecision: "timestamp",
    publishedAt: "2026-07-28T00:00:00.000Z",
    publishedAtPrecision: "timestamp",
    retrievedAt: NOW.toISOString(),
    retrievedAtPrecision: "timestamp",
    updatedAt: null,
    updatedAtPrecision: null,
    entityKeys: input.entityKeys,
    evidenceRole: "counterevidence",
    text: {
      status: "normalized_only",
      normalizedStatement:
        `The public evidence does not establish durable customer retention for ${input.title}.`,
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
    negativeImplications: [],
    confidence: "high",
    entityKeys: input.entityKeys,
    sources: [source, counter],
  }) as NormalizedMarketEvent;
}

const policy: FundPolicySnapshot = {
  id: "fund_policy:workspace_1:v1",
  workspaceId: "workspace_1",
  version: 1,
  source: "recommended_policy",
  values: structuredClone(
    BALANCED_POLICY_VALUES,
  ) as unknown as FundPolicySnapshot["values"],
  createdByUserId: null,
  createdAt: NOW.toISOString(),
};
const TEST_REFERENCE_CATALOG = createReferenceCatalogSnapshot([
  {
    kind: "critical_evidence_profile",
    id: "critical_evidence_seed_b2b_saas_v1",
    version: "1",
    definitionFingerprint: `sha256:${"c".repeat(64)}`,
  },
  {
    kind: "benchmark_definition",
    id: "benchmark_entry_synthetic_seed_valuation_v1",
    parentId: "benchmark_pack_synthetic_us_software_v1",
    version: "1",
    definitionFingerprint: `sha256:${"b".repeat(64)}`,
  },
  {
    kind: "valuation_method_policy",
    id: "valuation_method_seed_b2b_saas_v1",
    version: "1",
    definitionFingerprint: `sha256:${"6".repeat(64)}`,
  },
  {
    kind: "decision_policy",
    id: "decision_policy_seed_b2b_saas_v1",
    version: "1",
    definitionFingerprint: `sha256:${"d".repeat(64)}`,
  },
  {
    kind: "framework_pack",
    id: "framework_pack_synthetic_universal_saas_ai_v1",
    version: "1",
    definitionFingerprint: `sha256:${"f".repeat(64)}`,
  },
]);

const scanRun: RunRecord = {
  id: "00000000-0000-4000-8000-000000000001",
  workspaceId: "workspace_1",
  mode: "structured",
  windowDays: 14,
  status: "running",
  currentStage: "report",
  warningCount: 0,
  warnings: [],
  workerId: "worker_1",
  createdAt: "2026-07-29T11:00:00.000Z",
  startedAt: "2026-07-29T11:00:01.000Z",
  completedAt: null,
  leaseExpiresAt: "2026-07-29T12:05:00.000Z",
  evidenceContext: { state: "legacy_unbound" },
};

function analysis(
  dealId: string,
  score: number,
  input: Partial<Pick<
    CompanyAnalysis,
    "outcome" | "confidence"
  >> = {},
): CompanyAnalysis {
  const priorInteraction = {
    id: `fixture_${dealId}`,
    occurredAt: "2026-01-01T00:00:00.000Z",
    summary: "Prior meeting",
    decisionReason: "The market was too early.",
    concerns: [],
    revisitConditions: ["Revisit after a market change."],
    priorActions: actionsForDealStatusAndDirection("passed", "none"),
    provenance: "demo_fixture" as const,
    label: "Sample decision record" as const,
  };
  const priorSource = interactionSourceV2(priorInteraction);
  const triggerSource = exactSourceV2(`trigger_${dealId}`, {
    eventAt: "2026-07-28",
    eventAtPrecision: "date",
    publishedAt: "2026-07-28",
    publishedAtPrecision: "date",
    retrievedAt: "2026-07-29T12:00:00.000Z",
    retrievedAtPrecision: "timestamp",
    evidenceRole: "trigger",
    text: {
      status: "verified_exact",
      verbatimExcerpt: "A source-grounded market change was detected.",
    },
  });
  const counterSource = exactSourceV2(`counter_${dealId}`, {
    canonicalUrl: `https://example.com/${encodeURIComponent(dealId)}/counterevidence`,
    eventAt: "2026-07-28",
    eventAtPrecision: "date",
    publishedAt: "2026-07-28",
    publishedAtPrecision: "date",
    retrievedAt: "2026-07-29T12:00:00.000Z",
    retrievedAtPrecision: "timestamp",
    evidenceRole: "counterevidence",
    text: {
      status: "verified_exact",
      verbatimExcerpt:
        "The public evidence does not establish durable customer retention.",
    },
  });
  const scoreBreakdown = buildOpportunityScoreBreakdown({
    eventRelevance: score,
    dealRelevance: score,
    priorContextStrength: score,
    evidenceQuality: score,
  });
  const actions = actionsForDealStatusAndDirection("passed", "positive");
  const gateContext = {
    priorInteraction: {
      id: priorInteraction.id,
      occurredAt: priorInteraction.occurredAt,
      sourceIds: [priorInteraction.id],
      revisitConditions: priorInteraction.revisitConditions,
      priorActions: priorInteraction.priorActions,
      provenance: priorInteraction.provenance,
      label: priorInteraction.label,
    },
    triggerEvent: {
      id: `event_${dealId}`,
      eventAt: "2026-07-28",
      sourceIds: [triggerSource.id, counterSource.id],
    },
    sources: [triggerSource, counterSource, priorSource],
  };
  const gates = evaluateBeliefRevisionHardGates({
    priorInteraction: gateContext.priorInteraction,
    triggerEvent: gateContext.triggerEvent,
    revisitMapping: {
      priorInteractionId: priorInteraction.id,
      revisitConditionIndex: 0,
      revisitConditionText: priorInteraction.revisitConditions[0],
      triggerEventId: gateContext.triggerEvent.id,
      citedSourceIds: [triggerSource.id],
    },
    counterevidence: {
      statement:
        "The public evidence does not establish durable customer retention.",
      citedSourceIds: [counterSource.id],
    },
    sources: gateContext.sources,
    dealStatus: "passed",
    direction: "positive",
    proposedActions: actions,
  });
  const beliefAssessment = BeliefChangeAssessmentV1Schema.parse({
    schemaVersion: "belief-change-assessment-v1",
    dealStatus: "passed",
    direction: "positive",
    scoreBreakdown,
    gateContext,
    gates,
    actions,
  });
  const event = marketEventV2(triggerSource, {
    id: gateContext.triggerEvent.id,
    eventAt: gateContext.triggerEvent.eventAt,
    eventAtPrecision: "date",
    sources: [triggerSource, counterSource],
  });
  return CompanyAnalysisSchema.parse({
    id: `analysis_${dealId}`,
    reportId: "report_1",
    runId: scanRun.id,
    dealId,
    companyName: `Company ${dealId}`,
    dealStatus: "passed",
    outcome: input.outcome ?? "belief_revised",
    confidence: input.confidence ?? scoreBreakdown.confidence,
    score,
    verifiedSourceCount: 3,
    investmentMemory: {
      previousMeetingSummary: "Prior meeting",
      decisionReason: "The market was too early.",
      concerns: [],
      revisitConditions: ["Revisit after a market change."],
      lastEvaluatedAt: "2026-01-01T00:00:00.000Z",
      memoryIds: [],
      sourceIds: [priorSource.id],
      fixtureIds: [priorSource.id],
      priorActions: priorInteraction.priorActions,
    },
    marketEvidence: {
      relationship: "satisfies",
      explanation: "The saved market evidence changes the prior timing belief.",
      eventIds: [event.id],
      events: [event],
      sourceIds: event.sources.map((source) => source.id),
    },
    implications: {
      positive: ["The market may now support adoption."],
      negative: [],
    },
    beliefAssessment,
    recommendedNextMove: renderRecommendedNextMove(actions),
    companyBrief: {
      icSnapshot: [],
      traction: [],
      dealTerms: [],
      risks: [],
      decisionHistory: [{
        occurredAt: "2026-01-01T00:00:00.000Z",
        title: "Passed",
        summary: "The market was too early.",
        sourceIds: [priorSource.id],
      }],
      sourceLineage: [triggerSource, counterSource, priorSource],
    },
    sources: [triggerSource, counterSource, priorSource],
    createdAt: NOW.toISOString(),
  });
}

function projectionSafeAnalysis(
  dealId: string,
  score: number,
): CompanyAnalysis {
  const value = analysis(dealId, score);
  const priorSourceId = value.investmentMemory.sourceIds[0]!;
  const priorSource = buildSampleDecisionSourceRef({
    id: priorSourceId,
    documentId: `document_${priorSourceId}`,
    sourceRevisionId: `revision_${priorSourceId}`,
    contentFingerprint: createCanonicalFingerprint({ priorSourceId }),
    occurredAt: "2026-01-01T00:00:00.000Z",
    retrievedAt: "2026-07-29T12:00:00.000Z",
    summary: "Prior meeting",
    decisionReason: "The market was too early.",
    concerns: [],
    revisitConditions: ["Revisit after a market change."],
  });
  value.sources = value.sources.map((source) =>
    source.id === priorSourceId ? priorSource : source
  );
  value.companyBrief.sourceLineage =
    value.companyBrief.sourceLineage.map((source) =>
      source.id === priorSourceId ? priorSource : source
    );
  value.beliefAssessment!.gateContext.sources =
    value.beliefAssessment!.gateContext.sources.map((source) =>
      source.id === priorSourceId ? priorSource : source
    );
  return CompanyAnalysisSchema.parse(value);
}

function dealForAnalysisSources(value: CompanyAnalysis): RegisteredDeal {
  const activeSourceRevisionIds = value.sources.flatMap((source) =>
    "adaptation" in source
      && source.adaptation === "canonical"
      && source.sourceRevisionId
      ? [source.sourceRevisionId]
      : []
  ).sort();
  return {
    ...deal(value.dealId),
    activeSourceRevisionIds,
    activeSourceRevisionFingerprint:
      sourceRevisionFingerprint(activeSourceRevisionIds),
  };
}

function deal(id: string): RegisteredDeal {
  const activeSourceRevisionIds = [`revision_${id}`];
  return {
    id,
    workspaceId: "workspace_1",
    companyId: `company_${id}`,
    companyName: `Company ${id}`,
    status: "passed",
    analysisEligibleAt: "2026-07-01T00:00:00.000Z",
    activeSourceRevisionFingerprint:
      sourceRevisionFingerprint(activeSourceRevisionIds),
    activeSourceRevisionIds,
  };
}

async function candidateGroundingFor(
  dealId: string,
  options: {
    includeContext: boolean;
    includeValuation?: boolean;
    now?: () => Date;
    repository?: ReturnType<typeof createMemoryEvidencePacksRepository>;
    registeredDeal?: RegisteredDeal;
    sourceLineage?: CompanyAnalysis["sources"];
  },
) {
  const sourceRegistry = createMemorySourceRegistry();
  const repository =
    options.repository ?? createMemoryEvidencePacksRepository();
  const registeredDeal = options.registeredDeal ?? deal(dealId);
  const sourceIdByRevisionId = new Map(
    (options.sourceLineage ?? []).flatMap((source) =>
      "adaptation" in source
        && source.adaptation === "canonical"
        && source.sourceRevisionId
        ? [[source.sourceRevisionId, source.id] as const]
        : []
    ),
  );
  for (const [index, revisionId] of
    registeredDeal.activeSourceRevisionIds.entries()) {
    const sourceId = sourceIdByRevisionId.get(revisionId)
      ?? `source_revision_${dealId}`;
    await sourceRegistry.createInitialRevision({
      id: revisionId,
      workspaceId: registeredDeal.workspaceId,
      sourceId,
      contentHash: createCanonicalFingerprint({ dealId, revisionId }),
      objectKey: `private/${dealId}/${index}.md`,
      objectVersion: `object:${dealId}:${index}:v1`,
      contentType: "text/markdown",
      extractorId: "plain_text_v1",
      extractorVersion: "1",
      extractedAt: "2026-07-29T10:00:00.000Z",
      createdAt: "2026-07-29T10:00:01.000Z",
    });
  }
  const firstRevisionId = registeredDeal.activeSourceRevisionIds[0]!;
  const firstSourceId = sourceIdByRevisionId.get(firstRevisionId)
    ?? `source_revision_${dealId}`;
  const common = {
    workspaceId: registeredDeal.workspaceId,
    dealId,
    sourceId: firstSourceId,
    sourceRevisionId: firstRevisionId,
    provenanceOrigin: "uploaded_document" as const,
    unit: null,
    currency: null,
    periodStart: null,
    periodEnd: null,
    publishedAt: null,
    eventAt: null,
    retrievedAt: "2026-07-29T10:01:00.000Z",
    sourceRole: "management" as const,
    assertionStatus: "reported" as const,
    verificationMethod: null,
    freshness: "current" as const,
    acceptedForGate: true,
  };
  if (options.includeContext) {
    await repository.putSourceEvidence([
      ...(options.sourceLineage ?? []).flatMap((source, index) =>
        "adaptation" in source
          && source.adaptation === "canonical"
          && source.sourceRevisionId
          ? [{
              ...common,
              id: `fact_${dealId}_lineage_${index}`,
              sourceId: source.id,
              sourceRevisionId: source.sourceRevisionId,
              field: `lineage_source_${index}`,
              value: source.title,
              locator: {
                kind: "text_range" as const,
                start: 100 + index * 10,
                end: 109 + index * 10,
                excerpt: source.title,
              },
            }]
          : []
      ),
      {
        ...common,
        id: `fact_${dealId}_company`,
        field: "Company identity",
        value: registeredDeal.companyId,
        locator: {
          kind: "text_range" as const,
          start: 0,
          end: 10,
          excerpt: registeredDeal.companyName,
        },
      },
      ...[
        ["stage", "seed"],
        ["business model", "b2b_saas"],
        ["geography", "us"],
        ["security type", "preferred"],
        ["valuation basis", "pre-money"],
      ].map(([field, value], index) => ({
        ...common,
        id: `fact_${dealId}_context_${index}`,
        field: field!,
        value: value!,
        locator: {
          kind: "text_range" as const,
          start: 11 + index * 10,
          end: 20 + index * 10,
          excerpt: `${field}: ${value}`,
        },
      })),
      ...(options.includeValuation === false ? [] : [{
        ...common,
        id: `fact_${dealId}_valuation`,
        field: "Pre-money valuation",
        value: "18000000",
        unit: "currency",
        currency: "USD",
        locator: {
          kind: "text_range" as const,
          start: 70,
          end: 80,
          excerpt: "Pre-money $18m",
        },
      }]),
    ]);
  }
  const criticalEvidenceProfile: CriticalEvidenceProfile = {
    id: "critical_evidence_seed_b2b_saas_v1",
    version: "1",
    publicationStatus: "published",
    definitionFingerprint: `sha256:${"c".repeat(64)}`,
    fields: [
      {
        fieldId: "company_identity",
        critical: true,
        minimumModelInput: true,
        acceptedAssertionStatuses: ["reported", "verified"],
        acceptedFreshness: ["current"],
      },
      {
        fieldId: "reported_valuation",
        critical: true,
        minimumModelInput: true,
        acceptedAssertionStatuses: ["reported", "verified"],
        acceptedFreshness: ["current"],
      },
      {
        fieldId: "reported_valuation_basis",
        critical: true,
        minimumModelInput: true,
        acceptedAssertionStatuses: ["reported", "verified"],
        acceptedFreshness: ["current"],
      },
      {
        fieldId: "arr",
        critical: true,
        minimumModelInput: false,
        acceptedAssertionStatuses: ["reported", "verified"],
        acceptedFreshness: ["current"],
      },
    ],
  };
  const router = createContextRouter();
  return createEvidencePackCandidateGrounding({
    repository,
    sourceRegistry,
    criticalEvidenceProfiles: [criticalEvidenceProfile],
    builder: createEvidencePackBuilder({
      repository,
      sourceRegistry,
      router,
      criticalEvidenceProfiles: [criticalEvidenceProfile],
      now: () => NOW,
    }),
    resolveBenchmark: async (context) => context.benchmarkPackId
      ? {
          packId: context.benchmarkPackId,
          entryId: "benchmark_entry_synthetic_seed_valuation_v1",
          version: "1",
          value: "24000000",
          currency: "USD",
          effectiveAt: "2026-07-29",
          staleAfter: "2027-01-25",
          definitionFingerprint: `sha256:${"b".repeat(64)}`,
        }
      : null,
  });
}

function report(analyses: CompanyAnalysis[]): IntelligenceReportRecord {
  return {
    id: "report_1",
    workspaceId: "workspace_1",
    runId: scanRun.id,
    createdAt: NOW.toISOString(),
    marketSummary: "A source-grounded market change was detected.",
    opportunities: [],
    analysisStatus: "completed",
    evidenceCoverage: {
      acceptedPublicEvents: 1,
      excludedPublicItems: 0,
      truncatedPublicEvents: 0,
      recalledDealCount: analyses.length,
      unavailableDealCount: 0,
    },
    counts: {
      companyCount: analyses.length,
      beliefRevised: analyses.filter(
        ({ outcome }) => outcome === "belief_revised",
      ).length,
      monitor: 0,
      noMaterialChange: 0,
      analysisUnavailable: 0,
    },
    priorityDealId: analyses[0]?.dealId ?? null,
    companyAnalyses: analyses,
  };
}

test("current underwriting rejects a report from another evidence frame before batch creation", async () => {
  const baseRuns = createMemoryUnderwritingRunsRepository({ now: () => NOW });
  let createCalls = 0;
  const runs = {
    ...baseRuns,
    async createOrReuseBatch(input: Parameters<typeof baseRuns.createOrReuseBatch>[0]) {
      createCalls += 1;
      return baseRuns.createOrReuseBatch(input);
    },
  };
  const currentRun: RunRecord = {
    ...scanRun,
    evidenceContext: {
      state: "current",
      schemaVersion: "run-evidence-context-v1",
      evidenceMode: "live",
      windowDays: 14,
      anchorAt: "2026-07-29T12:00:00.000Z",
      windowStartAt: "2026-07-15T12:00:00.000Z",
      windowEndAt: "2026-07-29T12:00:00.000Z",
      windowTimezone: "America/Los_Angeles",
      snapshotId: null,
      snapshotFingerprint: null,
      contextFingerprint: `sha256:${"1".repeat(64)}`,
    },
  };
  if (currentRun.evidenceContext.state !== "current") {
    throw new Error("Expected current evidence context.");
  }
  const currentContext = currentRun.evidenceContext;
  const mismatchedReport: IntelligenceReportRecord = {
    ...report([]),
    evidenceContext: {
      ...currentContext,
      contextFingerprint: `sha256:${"2".repeat(64)}`,
      displayLabel: "Live evidence window ending 2026-07-29T12:00:00.000Z",
      eventCount: 0,
      eventSetFingerprint: `sha256:${"3".repeat(64)}`,
      bindingFingerprint: `sha256:${"4".repeat(64)}`,
    },
  };
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    autoProcessCandidates: false,
  });

  await assert.rejects(
    orchestrator.createBatchAndSelections({
      scanRun: currentRun,
      report: mismatchedReport,
      analyses: [],
      eligibleDeals: [],
      forceRefresh: false,
      evidenceFrame: {
        schemaVersion: "underwriting-evidence-frame-v1",
        evidenceMode: "live",
        contextFingerprint: `sha256:${"1".repeat(64)}`,
        eventSetFingerprint: `sha256:${"3".repeat(64)}`,
        bindingFingerprint: `sha256:${"4".repeat(64)}`,
        snapshotFingerprint: null,
      },
    }),
    /evidence frame/i,
  );
  assert.equal(createCalls, 0);
});

function finalization(input: {
  candidate: CandidateRun;
  candidateRunId: string;
  dealId: string;
  workerId: string;
  leaseToken: string;
}): CandidateFinalization {
  const evidencePack: CandidateFinalization["evidencePack"] = {
    id: `evidence_pack_${input.dealId}`,
    version: 1,
    workspaceId: "workspace_1",
    dealId: input.dealId,
    asOfDate: "2026-07-29",
    sourceRevisionIds: [`revision_${input.dealId}`],
    facts: [],
    assumptions: [],
    conflicts: [],
    coverage: {
      minimumModelInputsComplete: false,
      criticalEvidenceComplete: false,
      missingFieldIds: ["company_identity"],
      blockingConflictIds: [],
      decisionCeiling: null,
      underwritingStatus: "unavailable",
      reasonCodes: ["MISSING_MINIMUM_MODEL_INPUTS"],
    },
    createdAt: NOW.toISOString(),
  };
  const judgments = canonicalFrameworkAbstentionJudgments({
    candidate: input.candidate,
    pack: evidencePack,
    calculations: [],
  });
  const decision: CandidateFinalization["decision"] = {
    id: `decision_${input.dealId}`,
    analysisType: "final_synthesis",
    companyQuality: "unavailable",
    priceAttractiveness: "unavailable",
    fundFit: "unavailable",
    decision: null,
    decisionCeiling: null,
    hardVeto: false,
    firedRules: [],
    blockingEvidenceItemIds: [],
    claimEdges: [],
    confidence: "low",
  };
  const actions = actionsForDealStatusAndDirection("passed", "positive");
  const missingEvidence = evidencePack.coverage.missingFieldIds.map(
    (fieldId) => ({
      fieldId,
      label: fieldId.replaceAll("_", " "),
      externalLabel: fieldId.replaceAll("_", " "),
      reasonCode: "MISSING_CRITICAL_EVIDENCE",
      mostLikelyDecisionImpact:
        "Providing accepted evidence may raise or lower the formal decision ceiling.",
    }),
  );
  return withEmptyCurrentNamedLensArtifacts({
    workerId: input.workerId,
    leaseToken: input.leaseToken,
    candidateRunId: input.candidateRunId,
    candidateAnalysisFingerprint:
      `sha256:${input.dealId.padEnd(64, "a").slice(0, 64)}`,
    evidencePackBuildInputFingerprint: `sha256:${"e".repeat(64)}`,
    evidencePack,
    context: {
      id: "underwriting_context_seed_b2b_saas_v1",
      contextVersion: "1",
      analysisMode: "full",
      stage: "seed",
      businessModel: "b2b_saas",
      geography: "us",
      securityType: "preferred",
      asOfDate: "2026-07-29",
      criticalEvidenceProfileId: "critical_evidence_seed_b2b_saas_v1",
      benchmarkPackId: "benchmark_pack_synthetic_us_software_v1",
      benchmarkCompatibility: "exact",
      valuationMethodPolicyId: "valuation_method_seed_b2b_saas_v1",
      decisionPolicyId: "decision_policy_seed_b2b_saas_v1",
      frameworkPackId:
        "framework_pack_synthetic_universal_saas_ai_v1",
    },
    scenarioModel: {
      id: `scenario_model_${input.dealId}`,
      candidateRunId: input.candidateRunId,
      formulaPolicyVersion: "valuation_method_seed_b2b_saas_v1",
      scenarios: (["bear", "base", "bull"] as const).map((name) => ({
        name,
        inputs: ScenarioInputFieldSchema.options.map((field) => ({
          id: `${input.dealId}:${name}:${field}`,
          scenario: name,
          field,
          value: null,
          unit: null,
          evidenceItemId: null,
          assumptionItemId: null,
          unavailableReason: `${field} is unavailable.`,
        })),
      })),
      probabilityWeighted: false,
    },
    calculations: [],
    calculationClaimEdges: [],
    judgments,
    disagreements: [],
    valuation: {
      id: `valuation_${input.dealId}`,
      status: "unavailable",
      scenarios: (["bear", "base", "bull"] as const).map((name) => ({
        name,
        valuation: null,
        calculationIds: [],
      })),
      currentAsk: null,
      maximumAcceptablePreMoney: null,
      initialOwnership: null,
      postDilutionOwnership: null,
      grossMoic: null,
      grossIrr: null,
      pricingPremium: null,
      calculationIds: [],
      blockerCodes: ["MISSING_MINIMUM_MODEL_INPUTS"],
    },
    decision,
    narrative: "Underwriting unavailable because minimum evidence is missing.",
    actionDrafts: createActionDraftGenerator({
      workspaceId: input.candidate.workspaceId,
      now: () => NOW,
    }).generate({
      candidateRunId: input.candidateRunId,
      decision,
      missingEvidence,
      dealStatus: "passed",
      beliefDirection: "positive",
      actions,
      judgments,
      disagreements: [],
    }),
    versionSnapshot: {
      fundPolicyId: policy.id,
      dealStatus: "passed",
      beliefDirection: "positive",
      canonicalActions: actions,
      actionPolicyVersion: BELIEF_ACTION_POLICY_VERSION,
      draftPolicyVersion: ACTION_DRAFT_POLICY_VERSION,
      semanticContextAssumptionPolicyVersion:
        SEMANTIC_CONTEXT_ASSUMPTION_POLICY_VERSION,
      semanticContextMappingVersion: SEMANTIC_CONTEXT_MAPPING_VERSION,
      analysisMode: "full",
      contextVersion: "1",
      geography: "us",
      benchmarkCompatibility: "exact",
      benchmarkPackId: "benchmark_pack_synthetic_us_software_v1",
      benchmarkEntryId: "benchmark_entry_synthetic_seed_valuation_v1",
      benchmarkDefinitionFingerprint: `sha256:${"1".repeat(64)}`,
      frameworkPackId:
        "framework_pack_synthetic_universal_saas_ai_v1",
      frameworkPackDefinitionFingerprint: `sha256:${"2".repeat(64)}`,
      routerVersion: CONTEXT_ROUTER_VERSION,
      criticalEvidenceProfileId: "critical_evidence_seed_b2b_saas_v1",
      criticalEvidenceProfileDefinitionFingerprint:
        `sha256:${"3".repeat(64)}`,
      valuationMethodPolicyId: "valuation_method_seed_b2b_saas_v1",
      valuationMethodPolicyDefinitionFingerprint:
        `sha256:${"4".repeat(64)}`,
      decisionPolicyId: "decision_policy_seed_b2b_saas_v1",
      decisionPolicyDefinitionFingerprint: `sha256:${"5".repeat(64)}`,
      referenceCatalogFingerprint: `sha256:${"6".repeat(64)}`,
      formulaVersions: [],
      providerModel: "synthetic-test-lens",
      promptVersion: "framework-lens-v1",
      schemaVersion: "framework-judgment-v1",
      settingsFingerprint: `sha256:${"b".repeat(64)}`,
      applicationCommit: "task13-test",
      companyAnalysisUnknowns: [],
    },
  });
}

async function saveFinalizationBuild(
  evidencePacks: ReturnType<typeof createMemoryEvidencePacksRepository>,
  payload: CandidateFinalization,
): Promise<void> {
  const revisionId = payload.evidencePack.sourceRevisionIds[0]!;
  await evidencePacks.saveExact({
    pack: payload.evidencePack,
    inputFingerprint: payload.evidencePackBuildInputFingerprint,
    sourceRevisionSnapshots: [{
      id: revisionId,
      workspaceId: payload.evidencePack.workspaceId,
      sourceId: `source_${payload.evidencePack.dealId}`,
      revision: 1,
      contentHash: `sha256:${"d".repeat(64)}`,
      objectKey: `private/${payload.evidencePack.dealId}.md`,
      objectVersion: "object:v1",
      contentType: "text/markdown",
      extractorId: "plain_text_v1",
      extractorVersion: "1",
      extractedAt: "2026-07-29T10:00:00.000Z",
      supersedesRevisionId: null,
      createdAt: "2026-07-29T10:05:00.000Z",
    }],
  });
}

function createCurrentFixtureSourceGroundedCandidateExecutor(
  options: Parameters<typeof createSourceGroundedCandidateExecutor>[0],
  namedLensArtifacts?: NamedLensArtifactsRepository,
): ReturnType<typeof createSourceGroundedCandidateExecutor> {
  const execute = createSourceGroundedCandidateExecutor(options);
  return async (request) => {
    const executionResult = await execute(request);
    if ("kind" in executionResult) return executionResult;
    const finalization = {
      ...executionResult,
      workerId: request.workerId,
      leaseToken: request.leaseToken,
      candidateRunId: request.candidate.id,
    } satisfies CandidateFinalization;
    if (!finalization.judgments.some(({ frameworkMetadata }) =>
      frameworkMetadata !== undefined
    )) {
      return withEmptyCurrentNamedLensArtifacts(finalization);
    }
    if (!namedLensArtifacts) {
      throw new Error(
        "Advisory fixture execution requires its shared Named Lens repository.",
      );
    }
    return withWithheldCurrentNamedLensArtifacts(
      finalization,
      await namedLensArtifacts.listAttempts(
        request.candidate.workspaceId,
        request.candidate.id,
      ),
    );
  };
}

async function uploadedDealRegistry() {
  const sources = createMemorySourceRegistry();
  await sources.createInitialRevision({
    id: "revision_uploaded",
    workspaceId: "workspace_1",
    sourceId: "document_uploaded",
    contentHash: `sha256:${"c".repeat(64)}`,
    objectKey: "private/uploads/uploaded-acme.md",
    objectVersion: "object:uploaded-acme:v1",
    contentType: "text/markdown",
    extractorId: "plain_text_v1",
    extractorVersion: "1",
    extractedAt: "2026-07-29T10:00:00.000Z",
    createdAt: "2026-07-29T10:00:01.000Z",
  });
  const registry = createMemoryDealRegistry({ sourceRegistry: sources });
  await registry.confirmSourceAssignment({
    requestId: "confirm_uploaded",
    workspaceId: "workspace_1",
    dealId: "deal_uploaded",
    companyId: "company_uploaded",
    companyName: "Uploaded Acme",
    status: "passed",
    sourceRevisionId: "revision_uploaded",
    assignedByUserId: "user_1",
    reason: "User confirmed the extracted upload and Deal assignment.",
    confirmedAt: "2026-07-29T10:01:00.000Z",
    memoryBundle: {
      dealId: "deal_uploaded",
      companyName: "Uploaded Acme",
      status: "passed",
      facts: [{
        text:
          "Uploaded Acme provides clinical workflow automation for health systems.",
        sources: [exactSourceV2("source_uploaded", {
          provenance: "source_document",
          title: "Uploaded Acme founder memo",
          canonicalUrl: null,
          documentId: "document_uploaded",
          publisher: "Uploaded Acme",
          providerId: "source-registry",
          eventAt: null,
          eventAtPrecision: null,
          publishedAt: null,
          publishedAtPrecision: null,
          retrievedAt: "2026-07-29T10:00:00.000Z",
          retrievedAtPrecision: "timestamp",
          updatedAt: null,
          updatedAtPrecision: null,
          entityKeys: ["uploaded-acme"],
          sourceClass: "company_official",
          sourceAuthority: "primary",
          evidenceRole: "context",
          sourceRevisionId: "revision_uploaded",
          locator: { kind: "line_range", startLine: 1, endLine: 1 },
          contentFingerprint: `sha256:${"c".repeat(64)}`,
          text: {
            status: "verified_exact",
            verbatimExcerpt:
              "Uploaded Acme provides clinical workflow automation for health systems.",
          },
        })],
      }],
      interactions: [],
    },
    memoryLineage: {
      evidence: {
        source_uploaded: {
          workspaceId: "workspace_1",
          dealId: "deal_uploaded",
          sourceId: "document_uploaded",
          sourceRevisionId: "revision_uploaded",
        },
      },
      interactions: {},
    },
  });
  return { registry, sources };
}

async function imageOnlyDealRegistry(options: {
  includeNonImageFact?: boolean;
} = {}) {
  const sources = createMemorySourceRegistry();
  await sources.createInitialRevision({
    id: "revision_image",
    workspaceId: "workspace_1",
    sourceId: "document_image",
    contentHash: `sha256:${"9".repeat(64)}`,
    objectKey: "private/uploads/image-acme.png",
    objectVersion: "object:image-acme:v1",
    contentType: "image/png",
    extractorId: "claude_vision_v1",
    extractorVersion: "1",
    extractedAt: "2026-07-29T10:00:00.000Z",
    createdAt: "2026-07-29T10:00:01.000Z",
  });
  if (options.includeNonImageFact) {
    await sources.createInitialRevision({
      id: "revision_image_registry_note",
      workspaceId: "workspace_1",
      sourceId: "document_image_registry_note",
      contentHash: `sha256:${"7".repeat(64)}`,
      objectKey: "private/uploads/image-acme-registry-note.txt",
      objectVersion: "object:image-acme-registry-note:v1",
      contentType: "text/plain",
      extractorId: "plain_text_v1",
      extractorVersion: "1",
      extractedAt: "2026-07-29T10:00:02.000Z",
      createdAt: "2026-07-29T10:00:03.000Z",
    });
  }
  const registry = createMemoryDealRegistry({ sourceRegistry: sources });
  const structuredText =
    "Structured image evidence (not a quotation): ARR = 8000000 USD.";
  await registry.confirmSourceAssignment({
    requestId: "confirm_image",
    workspaceId: "workspace_1",
    dealId: "deal_image",
    companyId: "company_image",
    companyName: "Image Acme",
    status: "passed",
    sourceRevisionId: "revision_image",
    assignedByUserId: "user_1",
    reason: "User confirmed the image upload and Deal assignment.",
    confirmedAt: "2026-07-29T10:01:00.000Z",
    memoryBundle: {
      dealId: "deal_image",
      companyName: "Image Acme",
      status: "passed",
      facts: [{
        text: structuredText,
        sources: [normalizedSourceV2("evidence_image_arr", {
          provenance: "model_inference",
          title: "image-acme.png",
          canonicalUrl: null,
          documentId: "document_image",
          publisher: null,
          providerId: "anthropic",
          eventAt: null,
          eventAtPrecision: null,
          publishedAt: null,
          publishedAtPrecision: null,
          retrievedAt: "2026-07-29T10:00:00.000Z",
          retrievedAtPrecision: "timestamp",
          updatedAt: null,
          updatedAtPrecision: null,
          entityKeys: ["image-acme"],
          sourceClass: "model_output",
          sourceAuthority: "not_applicable",
          evidenceRole: "context",
          sourceRevisionId: "revision_image",
          locator: null,
          contentFingerprint: `sha256:${"9".repeat(64)}`,
          text: {
            status: "model_inference",
            normalizedStatement: structuredText,
            model: {
              provider: "anthropic",
              model: "claude-vision-test",
              generatedAt: "2026-07-29T10:00:00.000Z",
              inputFingerprint: `sha256:${"8".repeat(64)}`,
            },
          },
        })],
      }, ...(options.includeNonImageFact
        ? [{
          text: "Image Acme has a source-backed registry note.",
          sources: [normalizedSourceV2("source_image_registry_note", {
            provenance: "source_document",
            title: "Image Acme registry note",
            canonicalUrl: null,
            documentId: "document_image_registry_note",
            publisher: "Image Acme",
            providerId: "source-registry",
            eventAt: null,
            eventAtPrecision: null,
            publishedAt: null,
            publishedAtPrecision: null,
            retrievedAt: "2026-07-29T10:00:00.000Z",
            retrievedAtPrecision: "timestamp",
            updatedAt: null,
            updatedAtPrecision: null,
            entityKeys: ["image-acme"],
            sourceClass: "company_official",
            sourceAuthority: "primary",
            evidenceRole: "context",
            sourceRevisionId: "revision_image_registry_note",
            locator: null,
            contentFingerprint: `sha256:${"7".repeat(64)}`,
            text: {
              status: "normalized_only",
              normalizedStatement:
                "Image Acme has a source-backed registry note.",
            },
          })],
        }]
        : [])],
      interactions: [IMAGE_INTERACTION],
    },
    memoryLineage: {
      evidence: {
        evidence_image_arr: {
          workspaceId: "workspace_1",
          dealId: "deal_image",
          sourceId: "document_image",
          sourceRevisionId: "revision_image",
        },
        ...(options.includeNonImageFact
          ? {
            source_image_registry_note: {
              workspaceId: "workspace_1",
              dealId: "deal_image",
              sourceId: "document_image_registry_note",
              sourceRevisionId: "revision_image_registry_note",
            },
          }
          : {}),
      },
      interactions: {
        fixture_image: {
          workspaceId: "workspace_1",
          dealId: "deal_image",
          sourceId: "document_image",
          sourceRevisionId: "revision_image",
        },
      },
    },
  });
  if (options.includeNonImageFact) {
    await registry.confirmSourceAssignment({
      requestId: "confirm_image_registry_note",
      workspaceId: "workspace_1",
      dealId: "deal_image",
      companyId: "company_image",
      companyName: "Image Acme",
      status: "passed",
      sourceRevisionId: "revision_image_registry_note",
      assignedByUserId: "user_1",
      reason: "User confirmed the separate registry note source.",
      confirmedAt: "2026-07-29T10:02:00.000Z",
    });
  }
  return { registry, sources, structuredText };
}

function imageMarketScan() {
  return {
    status: "completed" as const,
    window: {
      from: "2026-07-15T12:00:00.000Z",
      to: NOW.toISOString(),
      days: 14 as const,
    },
    providers: [{
      providerId: "official",
      providerName: "Official source",
      fetchedCount: 1,
      acceptedCount: 1,
      rejectedCount: 0,
      lastSuccessAt: NOW.toISOString(),
    }],
    events: [underwritingMarketEvent({
      id: "market_image",
      sourceId: "market_source_image",
      title: "Image Acme wins enterprise deployment",
      statement: "Image Acme won a new enterprise deployment.",
      canonicalUrl: "https://example.com/image-acme-deployment",
      eventType: "customer",
      sectors: ["enterprise software"],
      themes: ["revenue", "adoption"],
      positiveImplications: [
        "The deployment supports continued commercial adoption.",
      ],
      entityKeys: ["image-acme"],
    })],
  };
}

function imageReasonedMatch(eventId = "market_image") {
  return {
    dealId: "deal_image",
    whyNow: "Image Acme won a new enterprise deployment.",
    previousContext: IMAGE_DECISION_EVIDENCE,
    positiveImplications: [
      "Image Acme won a new enterprise deployment.",
    ],
    negativeImplications: [],
    selectedTriggerEventId: eventId,
    selectedPriorInteractionId: "fixture_image",
    revisitConditionIndex: 0,
    revisitConditionText: "Revisit after a verified enterprise deployment.",
    revisitCitedSourceIds: ["market_source_image"],
    counterevidence: {
      statement:
        "The public evidence does not establish durable customer retention for Image Acme wins enterprise deployment.",
      citedSourceIds: ["market_source_image_counter"],
    },
    citedSourceIds: [
      "market_source_image",
      "market_source_image_counter",
      "fixture_image",
    ],
    scoreInputs: {
      eventRelevance: 0.9,
      dealRelevance: 0.9,
      priorContextStrength: 0.8,
      evidenceQuality: 0.9,
    },
    claimSourceIds: {
      "Image Acme won a new enterprise deployment.": [
        "market_source_image",
      ],
      [IMAGE_DECISION_EVIDENCE]: [
        "fixture_image",
      ],
    },
  };
}

test("admits every medium/high belief revision and uses score only for priority order", async () => {
  let sequence = 0;
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
  });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    autoProcessCandidates: false,
  });
  const analyses = [
    analysis("deal_a", 0.99),
    analysis("deal_b", 0.95),
    analysis("deal_c", 0.90),
    analysis("deal_d", 0.85),
    analysis("deal_e", 0.80),
    analysis("deal_f", 0.75),
    analysis("deal_g", 0.70, {
      outcome: "monitor",
      confidence: "medium",
    }),
  ];
  const eligibleDeals = analyses.map(({ dealId }) => deal(dealId));

  const batch = await orchestrator.createBatchAndSelections({
    scanRun,
    report: report(analyses),
    analyses,
    eligibleDeals,
    forceRefresh: false,
  });

  const state = runs.inspect();
  assert.equal(batch.workspaceId, "workspace_1");
  assert.equal(state.selections.length, 7);
  assert.deepEqual(
    state.selections.filter(({ status }) => status === "selected")
      .map(({ dealId, rank }) => [dealId, rank]),
    [
      ["deal_a", 1],
      ["deal_b", 2],
      ["deal_c", 3],
      ["deal_d", 4],
      ["deal_e", 5],
      ["deal_f", 6],
    ],
  );
  assert.deepEqual(
    state.selections.filter(({ status }) => status === "not_selected")
      .map(({ dealId }) => dealId)
      .sort(),
    ["deal_g"],
  );
  assert.equal(state.candidates.length, 6);
  assert.equal(
    state.candidates.some(({ dealId }) => dealId === "deal_f"),
    true,
    "priority six remains an admitted underwriting candidate",
  );
});

test("underwriting rejects a legacy belief_revised label without a current hard-gate assessment", async () => {
  let sequence = 0;
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
  });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    autoProcessCandidates: false,
  });
  const legacy = analysis("deal_legacy_label", 1);
  legacy.beliefAssessment = undefined;

  await orchestrator.createBatchAndSelections({
    scanRun,
    report: report([legacy]),
    analyses: [legacy],
    eligibleDeals: [deal(legacy.dealId)],
    forceRefresh: false,
  });

  assert.deepEqual(runs.inspect().candidates, []);
  assert.equal(runs.inspect().selections[0]?.status, "not_selected");
});

test("matching policy, Worker report, internal draft, and underwriting share one untruncated UTF-8 priority order", async () => {
  const analyses = ["deal_é", "deal_z", "deal_a", "deal_β", "deal_b", "deal_Ä"]
    .map((dealId) => analysis(dealId, 0.8));
  const expected = ["deal_a", "deal_b", "deal_z", "deal_Ä", "deal_é", "deal_β"];

  assert.deepEqual(
    rankBeliefRevisionCandidates(analyses).map(({ dealId }) => dealId),
    expected,
  );
  assert.deepEqual(
    projectRecommendedOpportunities([...analyses].reverse())
      .map(({ dealId }) => dealId),
    expected,
  );
  const draft = buildInternalReportDraft({
    report: {
      id: "report_tie_order",
      createdAt: NOW.toISOString(),
      marketSummary: "Tie-order regression.",
      opportunities: [],
      companyAnalyses: [analyses[2]!, analyses[5]!, analyses[0]!, analyses[3]!, analyses[1]!, analyses[4]!],
    },
    companyNames: {},
    appOrigin: "https://app.example.com",
  });
  assert.deepEqual(
    [...draft.bodyText.matchAll(/^#\d+ · COMPANY (\S+)/gmu)]
      .map((match) => match[1]!),
    expected.map((dealId) => dealId.toLocaleUpperCase()),
  );

  let sequence = 0;
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
  });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    autoProcessCandidates: false,
  });
  await orchestrator.createBatchAndSelections({
    scanRun,
    report: report(analyses),
    analyses: [analyses[3]!, analyses[1]!, analyses[5]!, analyses[0]!, analyses[4]!, analyses[2]!],
    eligibleDeals: [...analyses].reverse().map(({ dealId }) => deal(dealId)),
    forceRefresh: false,
  });
  assert.deepEqual(
    runs.inspect().selections
      .filter(({ status }) => status === "selected")
      .sort((left, right) => left.rank! - right.rank!)
      .map(({ dealId }) => dealId),
    expected,
  );
});

test("outer, assessment, and registry status mismatches cannot enter underwriting", async () => {
  const outerMismatch = analysis("deal_outer_mismatch", 0.9);
  outerMismatch.dealStatus = "invested";
  const registryMismatch = analysis("deal_registry_mismatch", 0.9);
  const runs = createMemoryUnderwritingRunsRepository({ now: () => NOW });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    autoProcessCandidates: false,
  });
  await orchestrator.createBatchAndSelections({
    scanRun,
    report: report([outerMismatch, registryMismatch]),
    analyses: [outerMismatch, registryMismatch],
    eligibleDeals: [
      { ...deal(outerMismatch.dealId), status: "invested" },
      { ...deal(registryMismatch.dealId), status: "invested" },
    ],
    forceRefresh: false,
  });

  assert.deepEqual(runs.inspect().candidates, []);
});

test("complete CompanyAnalysis lineage is required before ranking or underwriting", async () => {
  const invalid = analysis("deal_invalid_outer_lineage", 0.8);
  invalid.marketEvidence = {
    ...invalid.marketEvidence,
    eventIds: ["event_unrelated"],
    events: invalid.marketEvidence.events.map((event) => ({
      ...event,
      id: "event_unrelated",
    })),
  };

  assert.deepEqual(rankBeliefRevisionCandidates([invalid]), []);

  const runs = createMemoryUnderwritingRunsRepository({ now: () => NOW });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    autoProcessCandidates: false,
  });
  await orchestrator.createBatchAndSelections({
    scanRun,
    report: report([invalid]),
    analyses: [invalid],
    eligibleDeals: [deal(invalid.dealId)],
    forceRefresh: false,
  });

  assert.deepEqual(runs.inspect().candidates, []);
});

test("spoofed GroundedMatch fields cannot bypass complete CompanyAnalysis validation", () => {
  const spoofed = analysis("deal_spoofed_outer_lineage", 0.8);
  const validEvent = spoofed.marketEvidence.events[0]!;
  spoofed.marketEvidence = {
    ...spoofed.marketEvidence,
    eventIds: ["event_unrelated"],
    events: [{ ...validEvent, id: "event_unrelated" }],
  };
  const candidate = Object.assign(spoofed, {
    events: [validEvent],
    sources: [...spoofed.sources],
    demoFixtureIds: [
      spoofed.beliefAssessment!.gateContext.priorInteraction.id,
    ],
  });

  assert.deepEqual(rankBeliefRevisionCandidates([candidate]), []);
});

test("reuses the same immutable batch input without creating duplicate candidates", async () => {
  let sequence = 0;
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
  });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    autoProcessCandidates: false,
  });
  const analyses = [analysis("deal_a", 0.99)];
  const input = {
    scanRun,
    report: report(analyses),
    analyses,
    eligibleDeals: [deal("deal_a")],
    forceRefresh: false,
  };

  const first = await orchestrator.createBatchAndSelections(input);
  const replay = await orchestrator.createBatchAndSelections(input);

  assert.equal(replay.id, first.id);
  assert.equal(runs.inspect().batches.length, 1);
  assert.equal(runs.inspect().candidates.length, 1);
});

test("persists the fingerprint produced by the authoritative batch input path", async () => {
  let sequence = 0;
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
  });
  const candidateExecutionFingerprint = "candidate-executor-runtime-test-v1";
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    autoProcessCandidates: false,
    candidateExecutionFingerprint,
    referenceCatalog: TEST_REFERENCE_CATALOG,
  });
  const analyses = [analysis("deal_a", 0.99)];
  const eligibleDeals = [deal("deal_a")];
  const immutableReport = report(analyses);

  const batch = await orchestrator.createBatchAndSelections({
    scanRun,
    report: immutableReport,
    analyses,
    eligibleDeals,
    forceRefresh: false,
  });

  assert.equal(batch.batchInputFingerprint, createBatchInputFingerprint({
    scanRun,
    report: immutableReport,
    analyses,
    eligibleDeals,
    policy,
    executionBudget: {
      maxCostUnits: 28,
      maxTokenUnits: 112_000,
      maxConcurrency: 1,
      stages: {
        context_router: {
          timeoutMs: 30_000,
          maxAttempts: 1,
          costUnits: 0,
          tokenUnits: 0,
        },
        evidence_pack: {
          timeoutMs: 30_000,
          maxAttempts: 2,
          costUnits: 0,
          tokenUnits: 0,
        },
        valuation: {
          timeoutMs: 30_000,
          maxAttempts: 1,
          costUnits: 0,
          tokenUnits: 0,
        },
        framework_catalog: {
          timeoutMs: 30_000,
          maxAttempts: 2,
          costUnits: 0,
          tokenUnits: 0,
        },
        framework_lenses: {
          timeoutMs: 30_000,
          maxAttempts: 1,
          costUnits: 0,
          tokenUnits: 0,
        },
        decision: {
          timeoutMs: 30_000,
          maxAttempts: 1,
          costUnits: 0,
          tokenUnits: 0,
        },
        named_lens_presentation: {
          timeoutMs: 30_000,
          maxAttempts: 1,
          costUnits: 0,
          tokenUnits: 0,
        },
        narrative_drafts: {
          timeoutMs: 30_000,
          maxAttempts: 1,
          costUnits: 0,
          tokenUnits: 0,
        },
      },
    },
    candidateExecutionFingerprint,
    referenceCatalog: TEST_REFERENCE_CATALOG,
    evidenceFrame: undefined,
    selectionPolicyVersion: "all-belief-revisions-v1",
    routerVersion: "context-router-v2",
    beliefPolicies: {
      actionPolicyVersion: "belief-action-policy-v1",
      draftPolicyVersion: "status-safe-action-draft-v2",
      semanticContextAssumptionPolicyVersion:
        "belief-reversal-demo-context-v1",
      semanticContextMappingVersion:
        "belief-reversal-reviewed-context-mapping-v1",
    },
    evidencePackBuilderVersion: "evidence_pack_builder_v2",
    decisionPolicyVersion: "1",
  }));
});

test("changes the batch fingerprint when exact XTrace source lineage changes", async () => {
  let sequence = 0;
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
  });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    autoProcessCandidates: false,
  });
  const firstAnalysis = analysis("deal_a", 0.99);
  const revisedAnalysis = structuredClone(firstAnalysis);
  revisedAnalysis.investmentMemory.sourceIds.push("source_xtrace_new");

  const first = await orchestrator.createBatchAndSelections({
    scanRun,
    report: report([firstAnalysis]),
    analyses: [firstAnalysis],
    eligibleDeals: [deal("deal_a")],
    forceRefresh: false,
  });
  const changed = await orchestrator.createBatchAndSelections({
    scanRun,
    report: report([revisedAnalysis]),
    analyses: [revisedAnalysis],
    eligibleDeals: [deal("deal_a")],
    forceRefresh: false,
  });

  assert.notEqual(changed.id, first.id);
});

test("changes the batch fingerprint when the immutable analysis as-of timestamp changes", async () => {
  let sequence = 0;
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
  });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    autoProcessCandidates: false,
  });
  const firstAnalysis = analysis("deal_a", 0.99);
  const revisedAnalysis = structuredClone(firstAnalysis);
  revisedAnalysis.createdAt = "2026-07-30T12:00:00.000Z";

  const first = await orchestrator.createBatchAndSelections({
    scanRun,
    report: report([firstAnalysis]),
    analyses: [firstAnalysis],
    eligibleDeals: [deal("deal_a")],
    forceRefresh: false,
  });
  const revisedReport = report([revisedAnalysis]);
  revisedReport.createdAt = "2026-07-30T12:00:00.000Z";
  const changed = await orchestrator.createBatchAndSelections({
    scanRun,
    report: revisedReport,
    analyses: [revisedAnalysis],
    eligibleDeals: [deal("deal_a")],
    forceRefresh: false,
  });

  assert.notEqual(changed.id, first.id);
});

test("changes the batch fingerprint when candidate source metadata changes under the same source ID", async () => {
  let sequence = 0;
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
  });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    autoProcessCandidates: false,
  });
  const firstAnalysis = analysis("deal_a", 0.99);
  const revisedAnalysis = structuredClone(firstAnalysis);
  const originalSource = revisedAnalysis.sources[0]!;
  assert.ok("schemaVersion" in originalSource);
  const revisedSource = {
    ...originalSource,
    publisher: "Corrected immutable publisher metadata",
  };
  revisedAnalysis.sources = revisedAnalysis.sources.map((source) =>
    source.id === revisedSource.id ? revisedSource : source
  );
  revisedAnalysis.companyBrief.sourceLineage =
    revisedAnalysis.companyBrief.sourceLineage.map((source) =>
      source.id === revisedSource.id ? revisedSource : source
    );
  revisedAnalysis.beliefAssessment!.gateContext.sources =
    revisedAnalysis.beliefAssessment!.gateContext.sources.map((source) =>
      source.id === revisedSource.id ? revisedSource : source
    );
  const originalEvent = revisedAnalysis.marketEvidence.events[0]!;
  assert.ok("schemaVersion" in originalEvent);
  revisedAnalysis.marketEvidence.events = [marketEventV2(revisedSource, {
    ...originalEvent,
    sources: originalEvent.sources.map((source) =>
      source.id === revisedSource.id ? revisedSource : source
    ),
  })];
  const changedAnalysis = CompanyAnalysisSchema.parse(revisedAnalysis);

  const first = await orchestrator.createBatchAndSelections({
    scanRun,
    report: report([firstAnalysis]),
    analyses: [firstAnalysis],
    eligibleDeals: [deal("deal_a")],
    forceRefresh: false,
  });
  const changed = await orchestrator.createBatchAndSelections({
    scanRun,
    report: report([changedAnalysis]),
    analyses: [changedAnalysis],
    eligibleDeals: [deal("deal_a")],
    forceRefresh: false,
  });

  assert.notEqual(changed.id, first.id);
});

test("force refresh creates a linked batch and linked CandidateRun", async () => {
  let sequence = 0;
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
  });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    autoProcessCandidates: false,
    refreshNonce: () => `refresh_${++sequence}`,
  });
  const analyses = [analysis("deal_a", 0.99)];
  const baseInput = {
    scanRun,
    report: report(analyses),
    analyses,
    eligibleDeals: [deal("deal_a")],
  };

  const first = await orchestrator.createBatchAndSelections({
    ...baseInput,
    forceRefresh: false,
  });
  const refreshed = await orchestrator.createBatchAndSelections({
    ...baseInput,
    forceRefresh: true,
  });

  assert.notEqual(refreshed.id, first.id);
  assert.equal(refreshed.rerunOfId, first.id);
  const candidates = runs.inspect().candidates;
  assert.equal(candidates.length, 2);
  assert.equal(
    candidates.find(({ batchId }) => batchId === refreshed.id)?.rerunOfId,
    candidates.find(({ batchId }) => batchId === first.id)?.id,
  );
});

test("batch identity changes when an effective reference definition changes", async () => {
  let sequence = 0;
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
  });
  const changedCatalog = createReferenceCatalogSnapshot(
    TEST_REFERENCE_CATALOG.definitions.map((definition, index) =>
      index === 0
        ? {
            ...definition,
            definitionFingerprint: `sha256:${"e".repeat(64)}`,
          }
        : definition
    ),
  );
  const original = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    autoProcessCandidates: false,
    referenceCatalog: TEST_REFERENCE_CATALOG,
  });
  const changed = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    autoProcessCandidates: false,
    referenceCatalog: changedCatalog,
  });
  const analyses = [analysis("deal_a", 0.99)];
  const input = {
    scanRun,
    report: report(analyses),
    analyses,
    eligibleDeals: [deal("deal_a")],
    forceRefresh: false,
  };

  const first = await original.createBatchAndSelections(input);
  const second = await changed.createBatchAndSelections(input);

  assert.notEqual(second.id, first.id);
  assert.notEqual(
    second.batchInputFingerprint,
    first.batchInputFingerprint,
  );
});

test("a current Worker contract cannot cold-resume a batch created under legacy refresh semantics", async () => {
  let sequence = 0;
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
  });
  const configuration = {
    providerModel: "claude-test",
    promptVersion: "framework-lens-v1",
    schemaVersion: "framework-judgment-v1",
    settingsFingerprint: "balanced-underwriting-v1",
    applicationCommit: "commit-a",
  };
  const currentContract = createWorkerCandidateExecutionContract(
    configuration,
  );
  const legacyFingerprint = createCanonicalFingerprint({
    ...currentContract,
    refreshSemanticsVersion: "refresh-alias-legacy-v0",
  });
  const currentFingerprint = createWorkerCandidateExecutionFingerprint(
    configuration,
  );
  const legacy = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    autoProcessCandidates: false,
    candidateExecutionFingerprint: legacyFingerprint,
  });
  const current = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    autoProcessCandidates: false,
    candidateExecutionFingerprint: currentFingerprint,
  });
  const analyses = [analysis("deal_a", 0.99)];
  const input = {
    scanRun,
    report: report(analyses),
    analyses,
    eligibleDeals: [deal("deal_a")],
    forceRefresh: false,
  };

  const legacyBatch = await legacy.createBatchAndSelections(input);
  const currentBatch = await current.createBatchAndSelections(input);

  assert.notEqual(currentFingerprint, legacyFingerprint);
  assert.notEqual(currentBatch.id, legacyBatch.id);
  assert.notEqual(
    currentBatch.batchInputFingerprint,
    legacyBatch.batchInputFingerprint,
  );
  assert.equal(runs.inspect().batches.length, 2);
  assert.equal(runs.inspect().candidates.length, 2);
});

for (const mutation of [{
  name: "version",
  apply(payload: CandidateFinalization) {
    payload.versionSnapshot.frameworkCatalogVersion =
      "research-framework-catalog-tampered";
  },
}, {
  name: "fingerprint",
  apply(payload: CandidateFinalization) {
    payload.versionSnapshot.frameworkCatalogFingerprint =
      `sha256:${"d".repeat(64)}`;
  },
}, {
  name: "corpus digest",
  apply(payload: CandidateFinalization) {
    payload.versionSnapshot.frameworkCorpusDigest =
      `sha256:${"e".repeat(64)}`;
  },
}]) {
  test(`orchestrator rejects a finalization whose catalog ${mutation.name} differs from its completed checkpoint`, async () => {
    let sequence = 0;
    const artifacts = createMemoryUnderwritingArtifactsRepository();
    const evidencePacks = createMemoryEvidencePacksRepository();
    const runs = createMemoryUnderwritingRunsRepository({
      now: () => NOW,
      idGenerator: (kind) => `${kind}_${++sequence}`,
      leaseTokenGenerator: () => `lease_${++sequence}`,
      artifacts,
      evidencePacks,
    });
    const orchestrator = createUnderwritingOrchestrator({
      runs,
      activeFundPolicy: async () => policy,
      candidateExecutor: async ({
        candidate,
        workerId,
        leaseToken,
        stages,
      }) => {
        const payload = finalization({
          candidate,
          candidateRunId: candidate.id,
          dealId: candidate.dealId,
          workerId,
          leaseToken,
        });
        await persistFinalizationFrameworkCatalogCheckpoint(stages, payload);
        mutation.apply(payload);
        await saveFinalizationBuild(evidencePacks, payload);
        return payload;
      },
      now: () => NOW,
    });
    const analyses = [analysis("deal_a", 0.99)];

    const batch = await orchestrator.createBatchAndSelections({
      scanRun,
      report: report(analyses),
      analyses,
      eligibleDeals: [deal("deal_a")],
      forceRefresh: false,
    });

    assert.equal(batch.status, "failed");
    assert.equal(runs.inspect().candidates[0]?.status, "failed");
    assert.equal(
      runs.inspect().checkpoints.some(({ stage }) =>
        stage === "finalization"
      ),
      false,
      "catalog mismatch must fail before writing an authoritative finalization checkpoint",
    );
  });
}

test("processing a named candidate cannot lease an older queued candidate", async () => {
  let sequence = 0;
  const evidencePacks = createMemoryEvidencePacksRepository();
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
    leaseTokenGenerator: () => `lease_${++sequence}`,
    evidencePacks,
  });
  const olderOrchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    autoProcessCandidates: false,
  });
  const targetOrchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    autoProcessCandidates: false,
    candidateExecutor: async ({
      candidate,
      workerId,
      leaseToken,
      stages,
    }) => {
      const payload = finalization({
        candidate,
        candidateRunId: candidate.id,
        dealId: candidate.dealId,
        workerId,
        leaseToken,
      });
      await persistFinalizationFrameworkCatalogCheckpoint(stages, payload);
      await saveFinalizationBuild(evidencePacks, payload);
      return payload;
    },
  });
  const olderAnalysis = analysis("deal_older", 0.99);
  const targetAnalysis = analysis("deal_target", 0.98);
  await olderOrchestrator.createBatchAndSelections({
    scanRun,
    report: report([olderAnalysis]),
    analyses: [olderAnalysis],
    eligibleDeals: [deal(olderAnalysis.dealId)],
    forceRefresh: false,
  });
  const targetBatch = await targetOrchestrator.createBatchAndSelections({
    scanRun,
    report: report([targetAnalysis]),
    analyses: [targetAnalysis],
    eligibleDeals: [deal(targetAnalysis.dealId)],
    forceRefresh: false,
  });
  const targetCandidate = runs.inspect().candidates.find(
    ({ batchId }) => batchId === targetBatch.id,
  );
  assert.ok(targetCandidate);

  const completed = await targetOrchestrator.processCandidate(
    targetCandidate.id,
  );

  assert.equal(completed.id, targetCandidate.id);
  assert.deepEqual(
    runs.inspect().candidates.map(({ dealId, status }) => [dealId, status]),
    [
      ["deal_older", "queued"],
      ["deal_target", "completed"],
    ],
  );
});

test("a persisted partial candidate is terminal on replay and mixes with completed work into a partial batch", async () => {
  let sequence = 0;
  const memoryRuns = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
    leaseTokenGenerator: () => `lease_${++sequence}`,
  });
  let claimCount = 0;
  let executorCount = 0;
  const runs = {
    ...memoryRuns,
    async createSelectedCandidates(input: { batchId: string; dealIds: string[] }) {
      const candidates = await memoryRuns.createSelectedCandidates(input);
      return candidates.map((candidate, index) => ({
        ...candidate,
        status: index === 0 ? "completed" as const : "partial" as const,
        finalizedAt: NOW.toISOString(),
      }));
    },
    async claimCandidate(input: Parameters<typeof memoryRuns.claimCandidate>[0]) {
      claimCount += 1;
      return memoryRuns.claimCandidate(input);
    },
  };
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    candidateExecutor: async () => {
      executorCount += 1;
      throw new Error("terminal candidates must not execute again");
    },
  });
  const analyses = [analysis("deal_complete", 0.99), analysis("deal_partial", 0.98)];
  const batch = await orchestrator.createBatchAndSelections({
    scanRun,
    report: report(analyses),
    analyses,
    eligibleDeals: analyses.map(({ dealId }) => deal(dealId)),
    forceRefresh: false,
  });
  const partialId = memoryRuns.inspect().candidates.find(
    ({ dealId }) => dealId === "deal_partial",
  )!.id;

  const replay = await orchestrator.processCandidate(partialId);

  assert.equal(batch.status, "partial");
  assert.equal(replay.status, "partial");
  assert.equal(claimCount, 0);
  assert.equal(executorCount, 0);
});

test("a persistence failure during finalization terminates the candidate and batch", async () => {
  let sequence = 0;
  const storage = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
    leaseTokenGenerator: () => `lease_${++sequence}`,
  });
  const runs = {
    ...storage,
    async finalizeCandidate() {
      throw new Error("private database diagnostic");
    },
  };
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    candidateExecutor: async ({
      candidate,
      workerId,
      leaseToken,
      stages,
    }) => {
      const payload = finalization({
        candidate,
        candidateRunId: candidate.id,
        dealId: candidate.dealId,
        workerId,
        leaseToken,
      });
      await persistFinalizationFrameworkCatalogCheckpoint(stages, payload);
      return payload;
    },
    now: () => NOW,
  });
  const analyses = [analysis("deal_a", 0.99)];

  const batch = await orchestrator.createBatchAndSelections({
    scanRun,
    report: report(analyses),
    analyses,
    eligibleDeals: [deal("deal_a")],
    forceRefresh: false,
  });

  assert.equal(storage.inspect().candidates[0]?.status, "failed");
  assert.equal(batch.status, "failed");
  assert.deepEqual(
    Object.values(storage.inspect().failureReasons),
    ["Candidate underwriting could not be atomically finalized."],
  );
});

test("a candidate failure preserves a completed predecessor and leaves the batch partial", async () => {
  let sequence = 0;
  const evidencePacks = createMemoryEvidencePacksRepository();
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
    leaseTokenGenerator: () => `lease_${++sequence}`,
    evidencePacks,
  });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    candidateExecutor: async ({
      candidate,
      workerId,
      leaseToken,
      stages,
    }) => {
      if (candidate.dealId === "deal_b") {
        throw new Error("provider returned private diagnostic detail");
      }
      const payload = finalization({
        candidate,
        candidateRunId: candidate.id,
        dealId: candidate.dealId,
        workerId,
        leaseToken,
      });
      await persistFinalizationFrameworkCatalogCheckpoint(stages, payload);
      await saveFinalizationBuild(evidencePacks, payload);
      return payload;
    },
    candidateMaxAttempts: 1,
  });
  const analyses = [
    analysis("deal_a", 0.99),
    analysis("deal_b", 0.95),
  ];

  const batch = await orchestrator.createBatchAndSelections({
    scanRun,
    report: report(analyses),
    analyses,
    eligibleDeals: analyses.map(({ dealId }) => deal(dealId)),
    forceRefresh: false,
  });

  const state = runs.inspect();
  assert.deepEqual(
    state.candidates.map(({ dealId, status }) => [dealId, status]),
    [
      ["deal_a", "completed"],
      ["deal_b", "failed"],
    ],
  );
  assert.equal(
    state.batches.find(({ id }) => id === batch.id)?.status,
    "partial",
  );
  assert.equal(batch.status, "partial");
  assert.equal(
    Object.values(state.failureReasons)[0],
    "Candidate underwriting failed after bounded retries.",
    "private provider diagnostics must not be persisted",
  );
});

test("identity-only evidence requires context confirmation before resolving a framework catalog", async () => {
  let sequence = 0;
  let frameworkResolutions = 0;
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
    leaseTokenGenerator: () => `lease_${++sequence}`,
  });
  const grounding = await candidateGroundingFor("deal_a", {
    includeContext: false,
  });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    referenceCatalog: TEST_REFERENCE_CATALOG,
    candidateExecutor: createSourceGroundedCandidateExecutor({
      grounding,
      resolveFrameworkLenses: async () => {
        frameworkResolutions += 1;
        throw new Error(
          "A Framework catalog cannot be selected before context resolves.",
        );
      },
      now: () => NOW,
      execution: {
        providerModel: "synthetic-test-lens",
        promptVersion: "framework-lens-v1",
        schemaVersion: "framework-judgment-v1",
        settingsFingerprint: `sha256:${"b".repeat(64)}`,
        applicationCommit: "task13-test",
      },
    }),
    now: () => NOW,
  });
  const analyses = [analysis("deal_a", 0.99)];

  const batch = await orchestrator.createBatchAndSelections({
    scanRun,
    report: report(analyses),
    analyses,
    eligibleDeals: [deal("deal_a")],
    forceRefresh: false,
  });

  assert.equal(frameworkResolutions, 0);
  assert.equal(runs.inspect().candidates[0]?.status, "unavailable");
  assert.deepEqual(
    Object.values(runs.inspect().unavailableReasons),
    [[
      "CONTEXT_CONFIRMATION_REQUIRED_BUSINESS_MODEL",
      "CONTEXT_CONFIRMATION_REQUIRED_GEOGRAPHY",
      "CONTEXT_CONFIRMATION_REQUIRED_SECURITY_TYPE",
      "CONTEXT_CONFIRMATION_REQUIRED_STAGE",
    ]],
  );
  assert.equal(batch.status, "failed");
});

test("missing valuation inputs continue through every stage and finalize a terminal unavailable result", async () => {
  let sequence = 0;
  const warnings: string[] = [];
  const artifacts = createMemoryUnderwritingArtifactsRepository();
  const evidencePacks = createMemoryEvidencePacksRepository();
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
    leaseTokenGenerator: () => `lease_${++sequence}`,
    artifacts,
    evidencePacks,
  });
  const grounding = await candidateGroundingFor("deal_a", {
    includeContext: true,
    includeValuation: false,
    repository: evidencePacks,
  });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    referenceCatalog: TEST_REFERENCE_CATALOG,
    onWarning: (warning) => warnings.push(warning),
    candidateExecutor: createSourceGroundedCandidateExecutor({
      grounding,
      resolveFrameworkLenses: async () => ({
        catalogVersion: "research-framework-catalog-v1",
        catalogFingerprint: `sha256:${"7".repeat(64)}`,
        corpusDigest: `sha256:${"8".repeat(64)}`,
        service: {
          async runAll(request) {
            return canonicalFrameworkAbstentions(request);
          },
        },
      }),
      now: () => NOW,
      execution: {
        providerModel: "synthetic-test-lens",
        promptVersion: "framework-lens-v1",
        schemaVersion: "framework-judgment-v1",
        settingsFingerprint: `sha256:${"b".repeat(64)}`,
        applicationCommit: "task9-test",
      },
    }),
    now: () => NOW,
  });
  const analyses = [analysis("deal_a", 0.99)];

  const batch = await orchestrator.createBatchAndSelections({
    scanRun,
    report: report(analyses),
    analyses,
    eligibleDeals: [deal("deal_a")],
    forceRefresh: false,
  });

  assert.equal(batch.status, "partial", JSON.stringify({
    candidates: runs.inspect().candidates,
    failures: runs.inspect().failureReasons,
    unavailable: runs.inspect().unavailableReasons,
    warnings,
  }));
  assert.equal(runs.inspect().candidates[0]?.status, "partial");
  assert.deepEqual(
    runs.inspect().candidates[0]?.terminalReasonCodes,
    ["decision_critical_evidence_projection_unavailable"],
  );
  assert.deepEqual(runs.inspect().unavailableReasons, {});
  assert.deepEqual(
    runs.inspect().checkpoints.map(({ stage, status }) => [stage, status]),
    [
      ["context_router", "completed"],
      ["evidence_pack", "completed"],
      ["valuation", "completed"],
      ["framework_catalog", "completed"],
      ["framework_lenses", "completed"],
      ["decision", "completed"],
      ["named_lens_presentation", "completed"],
      ["narrative_drafts", "completed"],
      ["finalization", "completed"],
    ],
  );
  const saved = artifacts.inspect().bundles[0];
  assert.ok(saved);
  assert.equal(saved.scenarioModel.scenarios.length, 3);
  assert.equal(
    saved.scenarioModel.scenarios.every(({ inputs }) => inputs.length === 17),
    true,
  );
  assert.equal(saved.valuation.status, "unavailable");
  assert.deepEqual({
    currentAsk: saved.valuation.currentAsk,
    maximumAcceptablePreMoney:
      saved.valuation.maximumAcceptablePreMoney,
    initialOwnership: saved.valuation.initialOwnership,
    postDilutionOwnership: saved.valuation.postDilutionOwnership,
    grossMoic: saved.valuation.grossMoic,
    grossIrr: saved.valuation.grossIrr,
    pricingPremium: saved.valuation.pricingPremium,
    decision: saved.decision.decision,
    decisionCeiling: saved.decision.decisionCeiling,
    confidence: saved.decision.confidence,
  }, {
    currentAsk: null,
    maximumAcceptablePreMoney: null,
    initialOwnership: null,
    postDilutionOwnership: null,
    grossMoic: null,
    grossIrr: null,
    pricingPremium: null,
    decision: null,
    decisionCeiling: null,
    confidence: "low",
  });
  assert.match(saved.narrative, /unavailable/i);
  assert.ok(saved.actionDrafts.length > 0);
});

test("runs the source-grounded candidate chain once and persists communication channels as drafts", async () => {
  let sequence = 0;
  const warnings: string[] = [];
  let lensExecutions = 0;
  let frameworkResolutions = 0;
  let frameworkInput:
    | Parameters<FrameworkLensService["runAll"]>[0]
    | undefined;
  const artifacts = createMemoryUnderwritingArtifactsRepository();
  const evidencePacks = createMemoryEvidencePacksRepository();
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
    leaseTokenGenerator: () => `lease_${++sequence}`,
    artifacts,
    evidencePacks,
  });
  const grounding = await candidateGroundingFor("deal_a", {
    includeContext: true,
    repository: evidencePacks,
  });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    referenceCatalog: TEST_REFERENCE_CATALOG,
    onWarning: (warning) => warnings.push(warning),
    candidateExecutor: createSourceGroundedCandidateExecutor({
      grounding,
      resolveFrameworkLenses: async (context) => {
        frameworkResolutions += 1;
        assert.equal(context.stage, "seed");
        return {
          catalogVersion: "research-framework-catalog-v1",
          catalogFingerprint: `sha256:${"7".repeat(64)}`,
          corpusDigest: `sha256:${"8".repeat(64)}`,
          service: {
            async runAll(request) {
              lensExecutions += 1;
              frameworkInput = request;
              return canonicalFrameworkAbstentions(request);
            },
          },
        };
      },
      now: () => NOW,
      execution: {
        providerModel: "synthetic-test-lens",
        promptVersion: "framework-lens-v1",
        schemaVersion: "framework-judgment-v1",
        settingsFingerprint: `sha256:${"b".repeat(64)}`,
        applicationCommit: "task13-test",
      },
    }),
    now: () => NOW,
  });
  const companySpecificUnknown = {
    id: `semantic-field-${"a".repeat(24)}`,
    schemaVersion: "deal-semantic-field-v1",
    fieldId: "unknowns",
    classification: "unknown",
    reason:
      "Akamai and Kyndryl channel bookings, margins, and sell-through remain unavailable.",
    externalLabel: "Current partner bookings, margins, and sell-through",
  } satisfies DealSemanticField;
  const analysisWithUnknown = analysis("deal_a", 0.99);
  analysisWithUnknown.companyBrief.structuredFields = [
    companySpecificUnknown,
  ];
  const analyses = [analysisWithUnknown];
  const input = {
    scanRun,
    report: report(analyses),
    analyses,
    eligibleDeals: [deal("deal_a")],
    forceRefresh: false,
  };

  const first = await orchestrator.createBatchAndSelections(input);
  const replay = await orchestrator.createBatchAndSelections(input);

  assert.equal(replay.id, first.id);
  assert.equal(first.status, "partial", JSON.stringify({
    candidates: runs.inspect().candidates,
    failures: runs.inspect().failureReasons,
    unavailable: runs.inspect().unavailableReasons,
    warnings,
  }));
  assert.equal(replay.status, "partial");
  assert.equal(frameworkResolutions, 1);
  assert.equal(lensExecutions, 1);
  assert.equal(runs.inspect().candidates[0]?.status, "partial");
  assert.deepEqual(
    runs.inspect().candidates[0]?.terminalReasonCodes,
    ["decision_critical_evidence_projection_unavailable"],
  );
  assert.ok(frameworkInput);
  const frameworkCheckpointFingerprint = runs.inspect().checkpoints.find(
    ({ stage }) => stage === "framework_lenses",
  )?.inputFingerprint;
  const frameworkStageFingerprintInput = {
      stage: "framework_lenses",
      candidate: frameworkInput.candidate,
      pack: frameworkInput.pack,
      context: frameworkInput.context,
      calculations: frameworkInput.calculations,
      execution: {
        providerModel: "synthetic-test-lens",
        promptVersion: "framework-lens-v1",
        schemaVersion: "framework-judgment-v1",
        settingsFingerprint: `sha256:${"b".repeat(64)}`,
        applicationCommit: "task13-test",
      },
      frameworkCatalog: {
        version: "research-framework-catalog-v1",
        fingerprint: `sha256:${"7".repeat(64)}`,
        corpusDigest: `sha256:${"8".repeat(64)}`,
      },
      passageContract: CURRENT_FRAMEWORK_LENS_PASSAGE_CONTRACT,
      advisoryProviderTimeoutPolicy:
        createNamedLensProviderTimeoutPolicy(),
  };
  assert.equal(
    frameworkCheckpointFingerprint,
    createCanonicalFingerprint(frameworkStageFingerprintInput),
  );
  for (const [field, staleValue] of [
    ["passageSchemaVersion", "named-lens-passage-stale"],
    ["generatorVersion", "named-lens-generator-stale"],
    ["decisionTaxonomyVersion", "named-lens-taxonomy-stale"],
    ["decisionTaxonomyDigest", `sha256:${"0".repeat(64)}`],
  ] as const) {
    assert.notEqual(
      frameworkCheckpointFingerprint,
      createCanonicalFingerprint({
        ...frameworkStageFingerprintInput,
        passageContract: {
          ...CURRENT_FRAMEWORK_LENS_PASSAGE_CONTRACT,
          [field]: staleValue,
        },
      }),
      field,
    );
  }
  assert.notEqual(
    frameworkCheckpointFingerprint,
    createCanonicalFingerprint({
      ...frameworkStageFingerprintInput,
      advisoryProviderTimeoutPolicy: {
        ...frameworkStageFingerprintInput.advisoryProviderTimeoutPolicy,
        timeoutMs:
          frameworkStageFingerprintInput
            .advisoryProviderTimeoutPolicy.timeoutMs + 1,
      },
    }),
    "advisory provider timeout",
  );
  assert.deepEqual(
    runs.inspect().checkpoints.map(({ stage, status }) => [stage, status]),
    [
      ["context_router", "completed"],
      ["evidence_pack", "completed"],
      ["valuation", "completed"],
      ["framework_catalog", "completed"],
      ["framework_lenses", "completed"],
      ["decision", "completed"],
      ["named_lens_presentation", "completed"],
      ["narrative_drafts", "completed"],
      ["finalization", "completed"],
    ],
  );
  const saved = artifacts.inspect();
  assert.equal(saved.bundles.length, 1);
  const savedBundle = saved.bundles[0]!;
  const savedCandidate = runs.inspect().candidates[0]!;
  const finalizationCheckpoint = runs.inspect().checkpoints.find(
    ({ stage }) => stage === "finalization",
  )!;
  const finalizationOutput = finalizationCheckpoint.outputPayload as {
    evidencePackBuildInputFingerprint: string;
  };
  assert.equal(
    finalizationCheckpoint.inputFingerprint,
    createCanonicalFingerprint({
      stage: "finalization",
      candidateRunId: savedCandidate.id,
      batchInputFingerprint: first.batchInputFingerprint,
      candidateAnalysisFingerprint:
        savedBundle.candidateAnalysisFingerprint,
      evidencePackBuildInputFingerprint:
        finalizationOutput.evidencePackBuildInputFingerprint,
      currentContractIdentity: {
        reportId: savedBundle.underwritingPresentationReportId,
        frameworkCatalog: {
          catalogVersion:
            savedBundle.versionSnapshot.frameworkCatalogVersion,
          catalogFingerprint:
            savedBundle.versionSnapshot.frameworkCatalogFingerprint,
          corpusDigest:
            savedBundle.versionSnapshot.frameworkCorpusDigest,
        },
        versionSnapshot: savedBundle.versionSnapshot,
        projectionFingerprint:
          savedBundle.decisionCriticalEvidenceProjection!.fingerprint,
        finalDispositionsFingerprint:
          savedBundle.versionSnapshot.finalDispositionsFingerprint,
        presentationFingerprint:
          savedBundle.namedLensPresentation!.fingerprint,
        terminalStatus: savedBundle.terminalStatus,
        terminalReasonCodes: savedBundle.terminalReasonCodes,
      },
    }),
  );
  const missingEvidence = buildCandidateMissingEvidence({
    criticalFieldIds: savedBundle.evidencePack.coverage.missingFieldIds,
    structuredFields: analysisWithUnknown.companyBrief.structuredFields,
  });
  assert.equal(
    runs.inspect().checkpoints.filter(
      ({ stage }) => stage === "narrative_drafts",
    ).length,
    1,
    "an identical replay must reuse the persisted narrative draft stage",
  );
  assert.equal(
    runs.inspect().checkpoints.find(
      ({ stage }) => stage === "narrative_drafts",
    )?.inputFingerprint,
    createCanonicalFingerprint({
      stage: "narrative_drafts",
      pack: savedBundle.evidencePack,
      calculations: savedBundle.calculations,
      judgments: savedBundle.judgments,
      disagreements: savedBundle.disagreements,
      decision: savedBundle.decision,
      missingEvidence,
    }),
  );
  assert.equal(
    savedBundle.actionDrafts.every((draft) =>
      "missingEvidence" in draft
      && draft.missingEvidence.some(
        ({ fieldId, label }) =>
          fieldId === companySpecificUnknown.id
          && label === companySpecificUnknown.reason,
      )
    ),
    true,
  );
  assert.equal(
    savedBundle.versionSnapshot.referenceCatalogFingerprint,
    TEST_REFERENCE_CATALOG.definitionFingerprint,
  );
  assert.equal(
    saved.bundles[0]?.versionSnapshot.frameworkCatalogVersion,
    "research-framework-catalog-v1",
  );
  assert.equal(
    saved.bundles[0]?.versionSnapshot.frameworkCatalogFingerprint,
    `sha256:${"7".repeat(64)}`,
  );
  assert.equal(
    saved.bundles[0]?.versionSnapshot.frameworkCorpusDigest,
    `sha256:${"8".repeat(64)}`,
  );
  assert.equal(
    saved.bundles[0]?.versionSnapshot
      .criticalEvidenceProfileDefinitionFingerprint,
    `sha256:${"c".repeat(64)}`,
  );
  assert.equal(
    saved.bundles[0]?.versionSnapshot.benchmarkEntryId,
    "benchmark_entry_synthetic_seed_valuation_v1",
  );
  assert.deepEqual(
    saved.bundles[0]?.actionDrafts.map((draft) =>
      "format" in draft ? draft.format : draft.channel
    ).sort(),
    [
      "diligence_request",
      "founder_email",
      "founder_linkedin",
      "founder_sms",
      "internal_memo",
    ],
  );
  assert.equal(
    saved.bundles[0]?.actionDrafts.every((draft) =>
      !("sentAt" in draft) && !("deliveryId" in draft)
    ),
    true,
  );
});

test("real authorized eight-core and twenty-advisory execution settles a truthful partial graph within budget", async () => {
  let sequence = 0;
  const warnings: string[] = [];
  const candidateLeaseAuthority =
    createMemoryUnderwritingCandidateLeaseAuthority({ now: () => NOW });
  const namedLensArtifacts = createMemoryNamedLensArtifactsRepository({
    candidateLeaseAuthority,
  });
  const artifacts = createMemoryUnderwritingArtifactsRepository({
    namedLensArtifacts,
  });
  const evidencePacks = createMemoryEvidencePacksRepository();
  const analysisValue = projectionSafeAnalysis("deal_a", 0.99);
  const registeredDeal = dealForAnalysisSources(analysisValue);
  let activeProviderCalls = 0;
  let maximumProviderCalls = 0;
  let providerCalls = 0;
  let advisoryProviderOutputs = 0;
  let retriedAdvisoryCardId: string | undefined;
  let repairedCoreCardId: string | undefined;
  const callsByCard = new Map<string, number>();
  const client: ClaudeClient = {
    async complete(request) {
      const card = frameworkPromptCard(request);
      const cardCalls = (callsByCard.get(card.id) ?? 0) + 1;
      callsByCard.set(card.id, cardCalls);
      providerCalls += 1;
      activeProviderCalls += 1;
      maximumProviderCalls = Math.max(
        maximumProviderCalls,
        activeProviderCalls,
      );
      await new Promise((resolve) => setTimeout(resolve, 2));
      activeProviderCalls -= 1;
      if (!("experimentalAdvisory" in card) && !repairedCoreCardId) {
        repairedCoreCardId = card.id;
        return "{}";
      }
      if ("experimentalAdvisory" in card) {
        if (!retriedAdvisoryCardId) {
          retriedAdvisoryCardId = card.id;
          throw new IntegrationTransportError({ retryable: true });
        }
        advisoryProviderOutputs += 1;
        return JSON.stringify(advisoryProviderOutputs <= 4
          ? frameworkPromptOutputWithPassage(request)
          : frameworkPromptAbstentionOutput(request));
      }
      return JSON.stringify(frameworkPromptOutput(request));
    },
  };
  const frameworkResolver = createContextAwareFrameworkLensResolver({
    client,
    execution: {
      provider: "anthropic",
      model: "synthetic-test-lens",
      promptVersion: "framework-lens-v1",
      schemaVersion: "framework-judgment-v1",
      settingsFingerprint: `sha256:${"b".repeat(64)}`,
      applicationCommit: "task13-test",
    },
  });
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
    leaseTokenGenerator: () => `lease_${++sequence}`,
    artifacts,
    namedLensArtifacts,
    candidateLeaseAuthority,
    evidencePacks,
  });
  const grounding = await candidateGroundingFor("deal_a", {
    includeContext: true,
    repository: evidencePacks,
    registeredDeal,
    sourceLineage: analysisValue.sources,
  });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    namedLensArtifacts,
    activeFundPolicy: async () => policy,
    referenceCatalog: TEST_REFERENCE_CATALOG,
    onWarning: (warning) => warnings.push(warning),
    candidateExecutor: createSourceGroundedCandidateExecutor({
      grounding,
      resolveFrameworkLenses: (context, signal) =>
        frameworkResolver.resolve(context, signal),
      now: () => NOW,
      execution: {
        providerModel: "synthetic-test-lens",
        promptVersion: "framework-lens-v1",
        schemaVersion: "framework-judgment-v1",
        settingsFingerprint: `sha256:${"b".repeat(64)}`,
        applicationCommit: "task13-test",
      },
    }),
    now: () => NOW,
  });
  const analyses = [analysisValue];
  const request = {
    scanRun,
    report: report(analyses),
    analyses,
    eligibleDeals: [registeredDeal],
    forceRefresh: false,
  };
  const batch = await orchestrator.createBatchAndSelections(request);
  const frameworkCheckpoint = runs.inspect().checkpoints.find(
    ({ stage }) => stage === "framework_lenses",
  );
  assert.ok(frameworkCheckpoint);
  const reservedTokenUnits = frameworkCheckpoint.providerAttempts.reduce(
    (total, attempt) => total + attempt.reservedTokenUnits,
    0,
  );
  const bundle = artifacts.inspect().bundles[0];
  assert.ok(bundle, warnings.join("\n"));
  const advisoryJudgments = bundle.judgments.filter(
    ({ frameworkMetadata }) => frameworkMetadata !== undefined,
  );
  const coreJudgments = bundle.judgments.filter(
    ({ frameworkMetadata }) => frameworkMetadata === undefined,
  );

  assert.equal(batch.status, "partial");
  assert.equal(bundle.terminalStatus, "partial");
  assert.deepEqual(bundle.terminalReasonCodes,
    ["PROVIDER_BUDGET_EXHAUSTED"]);
  assert.ok(
    (bundle.decisionCriticalEvidenceProjection?.evidenceRefs.length ?? 0) > 0,
  );
  assert.equal(bundle.namedLensCatalogConsiderations?.length, 20);
  assert.equal(bundle.namedLensDispositions?.length, 20);
  assert.equal(bundle.namedLensAttemptRefs?.length, 20);
  assert.equal(namedLensArtifacts.inspect().rawAttemptEvents.length, 40);
  assert.equal(coreJudgments.length, 8);
  assert.equal(advisoryJudgments.length, 19);
  assert.equal(
    advisoryJudgments.every(
      ({ frameworkMetadata }) =>
        frameworkMetadata?.formalDecisionWeight === "0",
    ),
    true,
  );
  assert.equal(providerCalls <= 28, true);
  assert.equal(maximumProviderCalls, 4);
  assert.ok(repairedCoreCardId);
  assert.ok(retriedAdvisoryCardId);
  assert.equal(callsByCard.get(repairedCoreCardId), 2);
  assert.equal(callsByCard.get(retriedAdvisoryCardId), 2);
  assert.equal(frameworkCheckpoint.providerAttempts.length, 29);
  assert.equal(frameworkCheckpoint.costUnits, 28);
  assert.equal(reservedTokenUnits, 112_000);
  const budgetDisposition = bundle.namedLensDispositions?.find(
    ({ reasonCodes }) => reasonCodes.includes("PROVIDER_BUDGET_EXHAUSTED"),
  );
  assert.ok(budgetDisposition);
  assert.equal(budgetDisposition.disposition, "unavailable");
  assert.equal(
    bundle.namedLensPassages?.some(({ judgmentId }) =>
      judgmentId === budgetDisposition.judgmentId
    ),
    false,
  );
  const settledAttempts = await namedLensArtifacts.listAttempts(
    bundle.evidencePack.workspaceId,
    bundle.candidateRunId,
  );
  const budgetAttempt = settledAttempts.find(({ failureReason }) =>
    failureReason?.code === "budget_exhausted"
  );
  assert.ok(budgetAttempt);
  assert.equal(budgetAttempt.status, "aborted");
  assert.ok(bundle.valuation);
  assert.ok(bundle.decision);
  assert.ok(bundle.actionDrafts.length > 0);
});

function frameworkPromptPayload(
  request: ClaudeCompleteInput,
): {
  card: FrameworkCard;
  evidencePack: {
    facts: Array<{ id: string }>;
    assumptions: Array<{ id: string }>;
  };
  valuationInputs?: {
    calculations: Array<{ id: string }>;
  };
} {
  const content = request.messages[0]?.content;
  if (typeof content !== "string") {
    throw new Error("Framework prompt must be text-only.");
  }
  const parsed = JSON.parse(content) as {
    card?: FrameworkCard;
    evidencePack?: {
      facts: Array<{ id: string }>;
      assumptions: Array<{ id: string }>;
    };
    valuationInputs?: {
      calculations: Array<{ id: string }>;
    };
    originalRequest?: ReturnType<typeof frameworkPromptPayload>;
  };
  const payload = parsed.originalRequest ?? parsed;
  if (!payload.card || !payload.evidencePack) {
    throw new Error("Framework prompt is missing its immutable inputs.");
  }
  return {
    card: payload.card,
    evidencePack: payload.evidencePack,
    ...(payload.valuationInputs
      ? { valuationInputs: payload.valuationInputs }
      : {}),
  };
}

function frameworkPromptCard(request: ClaudeCompleteInput): FrameworkCard {
  return frameworkPromptPayload(request).card;
}

function frameworkPromptOutput(request: ClaudeCompleteInput) {
  const payload = frameworkPromptPayload(request);
  const evidenceIds = [
    ...payload.evidencePack.facts.map(({ id }) => id),
    ...payload.evidencePack.assumptions.map(({ id }) => id),
    ...(payload.valuationInputs?.calculations.map(({ id }) => id) ?? []),
  ].toSorted((left, right) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))
  );
  assert.ok(evidenceIds.length >= 2);
  return {
    applicability: "applicable",
    conclusion: "supportive",
    supportEvidenceItemIds: [evidenceIds[0]],
    counterEvidenceItemIds: [evidenceIds[1]],
    unusedEvidenceItemIds: evidenceIds.slice(2),
    strongestSupport:
      "The retained source evidence supports this bounded framework view.",
    strongestCounterargument:
      "The retained counterevidence limits confidence in this framework view.",
    unknowns: ["Independent confirmation remains outstanding."],
    limitations: [
      "This framework output cannot create a formal investment decision.",
    ],
    confidence: {
      sourceReliability: "medium",
      evidenceStrength: "medium",
      evidenceCoverage: "medium",
      applicability: "high",
      judgment: "medium",
    },
    frameworkRuleRefs: [payload.card.id],
    ...("experimentalAdvisory" in payload.card
      ? {
        counterevidenceBoundary: {
          kind: "grounded_counterevidence" as const,
          evidenceRequestRefs: [],
        },
      }
      : {}),
  };
}

function frameworkPromptOutputWithPassage(
  request: ClaudeCompleteInput,
  failure?: "lineage" | "grounding" | "required_passage",
  variant: "baseline" | "mutated" = "baseline",
) {
  const payload = frameworkPromptPayload(request);
  const output = frameworkPromptOutput(request);
  if (!("experimentalAdvisory" in payload.card)) return output;
  if (failure === "required_passage") return output;
  const acceptanceQuestionByPackId: Readonly<Record<string, string>> = {
    april_dunford_obviously_awesome_2e_public_frameworks_v0_1:
      "customer_adoption",
    aswath_damodaran_dark_side_valuation_public_frameworks_v0_1:
      "financing_valuation",
    aswath_damodaran_narrative_and_numbers_public_frameworks_v0_1:
      "operating_model",
    bill_gurley_public_frameworks_v0_1: "unit_economics",
  };
  const mutatedQuestionByPackId: Readonly<Record<string, string>> = {
    april_dunford_obviously_awesome_2e_public_frameworks_v0_1:
      "customer_adoption",
    aswath_damodaran_dark_side_valuation_public_frameworks_v0_1:
      "financing_valuation",
    aswath_damodaran_narrative_and_numbers_public_frameworks_v0_1:
      "operating_model",
    bill_gurley_public_frameworks_v0_1: "customer_adoption",
  };
  const preferredQuestion = (variant === "mutated"
    ? mutatedQuestionByPackId
    : acceptanceQuestionByPackId)[
    payload.card.experimentalAdvisory.packId
  ];
  const binding = payload.card.experimentalAdvisory
    .decisionTaxonomyBindings.find(({ decisionQuestionCode }) =>
      decisionQuestionCode === preferredQuestion
    ) ?? payload.card.experimentalAdvisory.decisionTaxonomyBindings[0]!;
  const component = payload.card.experimentalAdvisory.components.find(
    ({ frameworkId }) => frameworkId === binding.frameworkId,
  );
  if (!component) {
    throw new Error("Expected an authorized advisory component binding.");
  }
  const sourceRef = component.sourceRefs[0];
  if (!sourceRef) {
    throw new Error("Expected an authorized advisory public source.");
  }
  const evidenceIds = [
    ...payload.evidencePack.facts.map(({ id }) => id),
    ...payload.evidencePack.assumptions.map(({ id }) => id),
  ].toSorted((left, right) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))
  );
  assert.ok(evidenceIds.length >= 2);
  const supportId = evidenceIds[0]!;
  const counterId = evidenceIds[1]!;
  const questionLabel = binding.decisionQuestionCode.replaceAll("_", " ");
  const changedPosture = variant === "mutated"
    && payload.card.experimentalAdvisory.packId
      === "april_dunford_obviously_awesome_2e_public_frameworks_v0_1";
  const proseLead = variant === "mutated"
    ? "The alternate advisory wording"
    : "The retained public premise";
  return {
    ...output,
    conclusion: changedPosture ? "negative" as const : output.conclusion,
    strongestSupport: changedPosture
      ? "The retained evidence supports a bounded cautionary framework view."
      : output.strongestSupport,
    strongestCounterargument: changedPosture
      ? "The retained counterevidence limits the cautionary framework view."
      : output.strongestCounterargument,
    supportEvidenceItemIds: [supportId],
    counterEvidenceItemIds: [counterId],
    unusedEvidenceItemIds: evidenceIds.slice(2),
    passage: {
      focus: {
        componentFrameworkId: component.frameworkId,
        componentVersion: component.version,
        cardFieldRef: binding.cardFieldRef,
        decisionQuestionCode: binding.decisionQuestionCode,
        evidenceDomainCodes: [...binding.evidenceDomainCodes].sort(),
      },
      premise: {
        text: `${proseLead} frames ${questionLabel} as the auditable company question.`,
        componentFrameworkId: component.frameworkId,
        componentVersion: component.version,
        cardFieldRef: binding.cardFieldRef,
        publicSourceIds: failure === "lineage"
          ? ["foreign_public_source"]
          : [sourceRef.sourceId],
        claimIds: [...sourceRef.claimIds].sort(),
        locator: sourceRef.locator,
        attributionScope: sourceRef.attributionScope,
      },
      caseApplication: {
        text: `${variant === "mutated" ? "Under the alternate presentation" : "For the saved case"}, ${questionLabel} uses retained company evidence without creating a new fact.`,
        evidenceItemIds: failure === "grounding"
          ? [supportId, "foreign_evidence_item"].sort()
          : [supportId],
      },
      countercase: {
        text: `The retained counterevidence ${variant === "mutated" ? "still bounds" : "limits"} the ${questionLabel} conclusion.`,
        boundaryKind: "grounded_counterevidence" as const,
        evidenceItemIds: [counterId],
        evidenceRequestRefs: [],
      },
      unknownBoundary: {
        text: `Independent confirmation remains the explicit ${variant === "mutated" ? "decision boundary" : "boundary"} on the ${questionLabel} reading.`,
        judgmentUnknownRefs: [
          "Independent confirmation remains outstanding.",
        ],
        judgmentLimitationRefs: [],
        evidenceRequestRefs: [],
      },
      conditionalConclusion: {
        text: changedPosture
          ? `The ${questionLabel} framework urges caution until the retained unknown is resolved.`
          : `The ${questionLabel} framework supports further diligence only if the retained unknown is resolved.`,
        stance: changedPosture ? "negative" as const : "supportive" as const,
        advisoryPosture: changedPosture
          ? "urges_caution" as const
          : "supports_further_diligence" as const,
      },
      advisoryContract: {
        formalDecisionWeight: "0" as const,
        noEndorsement: true,
        namedPersonImpersonation: false,
        hiddenChainOfThought: false,
      },
    },
  };
}

function frameworkPromptAbstentionOutput(request: ClaudeCompleteInput) {
  const payload = frameworkPromptPayload(request);
  if (!("experimentalAdvisory" in payload.card)) {
    throw new Error("Provider abstention fixture requires an advisory Card.");
  }
  const evidenceIds = [
    ...payload.evidencePack.facts.map(({ id }) => id),
    ...payload.evidencePack.assumptions.map(({ id }) => id),
  ].toSorted((left, right) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))
  );
  return {
    applicability: "applicable" as const,
    conclusion: "abstain" as const,
    supportEvidenceItemIds: [],
    counterEvidenceItemIds: [],
    unusedEvidenceItemIds: evidenceIds,
    strongestSupport: null,
    strongestCounterargument: null,
    unknowns: [
      "The retained evidence is insufficient for this applicable lens to take a position.",
    ],
    limitations: [
      "The lens abstains without creating a formal investment decision.",
    ],
    confidence: {
      sourceReliability: "low" as const,
      evidenceStrength: "low" as const,
      evidenceCoverage: "low" as const,
      applicability: "low" as const,
      judgment: "low" as const,
    },
    frameworkRuleRefs: [payload.card.id],
    counterevidenceBoundary: {
      kind: "no_candidate_local_counterevidence" as const,
      evidenceRequestRefs: ["request_provider_abstention_counterevidence"],
    },
  };
}

async function runProductionNamedLensAcceptanceCase(input: {
  applicableLensCount: number;
  failure?:
    | "provider"
    | "timeout"
    | "lineage"
    | "grounding"
    | "required_passage";
  providerAbstains?: boolean;
  providerAbstentionConfidence?: "low" | "medium";
  advisoryVariant?: "baseline" | "mutated";
}) {
  let sequence = 0;
  let advisoryApplicabilityChecks = 0;
  let advisoryProviderCalls = 0;
  const candidateLeaseAuthority =
    createMemoryUnderwritingCandidateLeaseAuthority({ now: () => NOW });
  const namedLensArtifacts = createMemoryNamedLensArtifactsRepository({
    candidateLeaseAuthority,
  });
  const artifacts = createMemoryUnderwritingArtifactsRepository({
    namedLensArtifacts,
  });
  const evidencePacks = createMemoryEvidencePacksRepository();
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
    leaseTokenGenerator: () => `lease_${++sequence}`,
    artifacts,
    namedLensArtifacts,
    candidateLeaseAuthority,
    evidencePacks,
  });
  const analysisValue = projectionSafeAnalysis("deal_a", 0.99);
  const registeredDeal = dealForAnalysisSources(analysisValue);
  const grounding = await candidateGroundingFor("deal_a", {
    includeContext: true,
    repository: evidencePacks,
    registeredDeal,
    sourceLineage: analysisValue.sources,
  });
  const client: ClaudeClient = {
    async complete(request) {
      const card = frameworkPromptCard(request);
      if (!("experimentalAdvisory" in card)) {
        return JSON.stringify(frameworkPromptOutput(request));
      }
      advisoryProviderCalls += 1;
      if (advisoryProviderCalls === 1 && input.providerAbstains) {
        const abstention = frameworkPromptAbstentionOutput(request);
        return JSON.stringify({
          ...abstention,
          confidence: {
            ...abstention.confidence,
            judgment: input.providerAbstentionConfidence ?? "low",
          },
        });
      }
      if (advisoryProviderCalls === 1 && input.failure === "provider") {
        throw new IntegrationTransportError({ retryable: false });
      }
      if (advisoryProviderCalls === 1 && input.failure === "timeout") {
        return await new Promise<string>((resolve) => {
          setTimeout(
            () => resolve(JSON.stringify(frameworkPromptOutputWithPassage(
              request,
            ))),
            100,
          );
        });
      }
      const passageFailure = advisoryProviderCalls === 1
        && input.failure !== "provider"
        && input.failure !== "timeout"
        ? input.failure
        : undefined;
      return JSON.stringify(
        frameworkPromptOutputWithPassage(
          request,
          passageFailure,
          input.advisoryVariant,
        ),
      );
    },
  };
  const advisoryProviderTimeoutMs = input.failure === "timeout"
    ? 5
    : 20_000;
  const frameworkResolver = createContextAwareFrameworkLensResolver({
    client,
    execution: {
      provider: "anthropic",
      model: "synthetic-test-lens",
      promptVersion: "framework-lens-v1",
      schemaVersion: "framework-judgment-v1",
      settingsFingerprint: `sha256:${"b".repeat(64)}`,
      applicationCommit: "task7-production-acceptance",
    },
    advisoryProviderTimeoutMs,
    isApplicable(card) {
      if (!("experimentalAdvisory" in card)) return true;
      const applicable =
        advisoryApplicabilityChecks < input.applicableLensCount;
      advisoryApplicabilityChecks += 1;
      return applicable;
    },
  });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    namedLensArtifacts,
    activeFundPolicy: async () => policy,
    referenceCatalog: TEST_REFERENCE_CATALOG,
    candidateExecutor: createSourceGroundedCandidateExecutor({
      grounding,
      resolveFrameworkLenses: (context, signal) =>
        frameworkResolver.resolve(context, signal),
      now: () => NOW,
      execution: {
        providerModel: "synthetic-test-lens",
        promptVersion: "framework-lens-v1",
        schemaVersion: "framework-judgment-v1",
        settingsFingerprint: `sha256:${"b".repeat(64)}`,
        applicationCommit: "task7-production-acceptance",
      },
      advisoryProviderTimeoutPolicy:
        createNamedLensProviderTimeoutPolicy(advisoryProviderTimeoutMs),
    }),
    now: () => NOW,
  });
  const analyses = [analysisValue];
  const request = {
    scanRun,
    report: report(analyses),
    analyses,
    eligibleDeals: [registeredDeal],
    forceRefresh: false,
  };
  const batch = await orchestrator.createBatchAndSelections(request);
  const bundle = artifacts.inspect().bundles[0];
  assert.ok(bundle, JSON.stringify({
    candidates: runs.inspect().candidates,
    checkpoints: runs.inspect().checkpoints,
    failureReasons: runs.inspect().failureReasons,
    unavailableReasons: runs.inspect().unavailableReasons,
  }));
  return {
    batch,
    bundle,
    runs,
    namedLensArtifacts,
    advisoryProviderCalls: () => advisoryProviderCalls,
    replay: () => orchestrator.createBatchAndSelections(request),
  };
}

for (const applicableLensCount of [0, 1, 2, 3, 4]) {
  test(`production executor completes ${applicableLensCount} valid Named Lenses with truthful coverage`, async () => {
    const result = await runProductionNamedLensAcceptanceCase({
      applicableLensCount,
    });
    assert.equal(
      result.batch.status,
      "completed",
      JSON.stringify(result.bundle.terminalReasonCodes),
    );
    assert.equal(
      result.bundle.terminalStatus,
      "completed",
      String(applicableLensCount),
    );
    assert.equal(
      result.bundle.namedLensPassages?.length,
      applicableLensCount,
      String(applicableLensCount),
    );
    assert.equal(
      result.bundle.namedLensDispositions?.filter(({ disposition }) =>
        disposition === "selected_main"
      ).length,
      applicableLensCount,
      JSON.stringify(result.bundle.namedLensDispositions?.map((item) => ({
        frameworkCardId: item.frameworkCardId,
        disposition: item.disposition,
        reasonCodes: item.reasonCodes,
        decisionQuestionCode: item.decisionQuestionCode,
        selectionBasisEvidenceIds: item.selectionBasisEvidenceIds,
        advisoryPosture: item.advisoryPosture,
      }))),
    );
    assert.equal(
      (result.bundle.terminalReasonCodes ?? []).includes(
        "limited_framework_coverage",
      ),
      applicableLensCount < 4,
      String(applicableLensCount),
    );
    assert.equal(
      result.bundle.judgments.filter(({ frameworkMetadata }) =>
        frameworkMetadata === undefined
      ).length,
      8,
      String(applicableLensCount),
    );
    assert.equal(
      result.bundle.namedLensCatalogConsiderations?.length,
      20,
      String(applicableLensCount),
    );
    assert.ok(
      (result.bundle.decisionCriticalEvidenceProjection?.evidenceRefs.length
        ?? 0) > 0,
      `candidate-level critical evidence must persist for ${applicableLensCount} applicable lenses`,
    );
  });
}

test("production executor persists a provider-executed applicable abstention as completed limited coverage", async () => {
  const result = await runProductionNamedLensAcceptanceCase({
    applicableLensCount: 1,
    providerAbstains: true,
  });
  assert.equal(result.batch.status, "completed");
  assert.equal(result.bundle.terminalStatus, "completed");
  assert.deepEqual(
    result.bundle.terminalReasonCodes,
    ["limited_framework_coverage"],
  );
  assert.equal(result.bundle.namedLensPassages?.length, 0);
  assert.equal(
    result.bundle.namedLensDispositions?.filter(({ disposition }) =>
      disposition === "abstained"
    ).length,
    1,
  );
  assert.ok(
    (result.bundle.decisionCriticalEvidenceProjection?.evidenceRefs.length
      ?? 0) > 0,
  );
  const candidate = result.runs.inspect().candidates[0]!;
  const attempts = await result.namedLensArtifacts.listAttempts(
    candidate.workspaceId,
    candidate.id,
  );
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0]?.status, "completed");
  assert.equal(attempts[0]?.failureReason, null);
});

test("production executor degrades a non-low-confidence provider abstention without losing formal artifacts", async () => {
  const result = await runProductionNamedLensAcceptanceCase({
    applicableLensCount: 1,
    providerAbstains: true,
    providerAbstentionConfidence: "medium",
  });

  assert.equal(result.batch.status, "partial");
  assert.equal(result.bundle.terminalStatus, "partial");
  assert.deepEqual(result.bundle.terminalReasonCodes, ["UNAVAILABLE"]);
  const candidate = result.runs.inspect().candidates[0]!;
  assert.equal(candidate.status, "partial");
  const providerJudgment = result.bundle.judgments.find(
    ({ applicability, frameworkMetadata }) =>
      frameworkMetadata !== undefined && applicability === "unavailable",
  );
  assert.ok(providerJudgment);
  assert.deepEqual(
    {
      applicability: providerJudgment.applicability,
      conclusion: providerJudgment.conclusion,
      confidence: providerJudgment.confidence,
    },
    {
      applicability: "unavailable",
      conclusion: "abstain",
      confidence: {
        sourceReliability: "low",
        evidenceStrength: "low",
        evidenceCoverage: "low",
        applicability: "low",
        judgment: "low",
      },
    },
  );
  assert.equal(result.bundle.namedLensPassages?.length, 0);
  assert.equal(result.bundle.scenarioModel.scenarios.length, 3);
  assert.ok(result.bundle.valuation);
  assert.equal(
    result.bundle.judgments.filter(({ frameworkMetadata }) =>
      frameworkMetadata === undefined
    ).length,
    8,
  );
  assert.ok(result.bundle.decision);
  assert.ok(result.bundle.actionDrafts.length > 0);
  assert.ok(result.bundle.narrative.length > 0);

  const callsBeforeReplay = result.advisoryProviderCalls();
  const attemptsBeforeReplay = await result.namedLensArtifacts.listAttempts(
    candidate.workspaceId,
    candidate.id,
  );
  const replayedBatch = await result.replay();
  assert.equal(replayedBatch.id, result.batch.id);
  assert.equal(result.advisoryProviderCalls(), callsBeforeReplay);
  assert.deepEqual(
    await result.namedLensArtifacts.listAttempts(
      candidate.workspaceId,
      candidate.id,
    ),
    attemptsBeforeReplay,
  );
});

test("advisory prose, priority, and posture cannot change formal decision artifacts", async () => {
  const baseline = await runProductionNamedLensAcceptanceCase({
    applicableLensCount: 4,
    advisoryVariant: "baseline",
  });
  const mutated = await runProductionNamedLensAcceptanceCase({
    applicableLensCount: 4,
    advisoryVariant: "mutated",
  });
  assert.deepEqual(mutated.bundle.valuation, baseline.bundle.valuation);
  assert.deepEqual(mutated.bundle.decision, baseline.bundle.decision);
  assert.deepEqual(
    mutated.bundle.versionSnapshot.canonicalActions,
    baseline.bundle.versionSnapshot.canonicalActions,
  );
  assert.deepEqual(
    mutated.bundle.actionDrafts.map((draft) =>
      "actions" in draft ? draft.actions : null
    ),
    baseline.bundle.actionDrafts.map((draft) =>
      "actions" in draft ? draft.actions : null
    ),
  );
  for (const stage of ["valuation", "decision"] as const) {
    const baselineCheckpoint = baseline.runs.inspect().checkpoints.find(
      (checkpoint) => checkpoint.stage === stage,
    );
    const mutatedCheckpoint = mutated.runs.inspect().checkpoints.find(
      (checkpoint) => checkpoint.stage === stage,
    );
    assert.ok(baselineCheckpoint);
    assert.ok(mutatedCheckpoint);
    assert.equal(
      mutatedCheckpoint.inputFingerprint,
      baselineCheckpoint.inputFingerprint,
      stage,
    );
    assert.equal(
      mutatedCheckpoint.outputFingerprint,
      baselineCheckpoint.outputFingerprint,
      stage,
    );
  }
  const selectedOrder = (bundle: typeof baseline.bundle) =>
    bundle.namedLensDispositions
      ?.filter(({ disposition }) => disposition === "selected_main")
      .toSorted((left, right) =>
        left.selectedPosition! - right.selectedPosition!
      )
      .map(({ frameworkCardId }) => frameworkCardId);
  assert.notDeepEqual(
    selectedOrder(mutated.bundle),
    selectedOrder(baseline.bundle),
  );
  assert.notEqual(
    mutated.bundle.namedLensPresentation?.fingerprint,
    baseline.bundle.namedLensPresentation?.fingerprint,
  );
  assert.notEqual(
    mutated.bundle.versionSnapshot.finalDispositionsFingerprint,
    baseline.bundle.versionSnapshot.finalDispositionsFingerprint,
  );
});

for (const failure of [
  "provider",
  "timeout",
  "lineage",
  "grounding",
  "required_passage",
] as const) {
  test(`production executor isolates ${failure} lens failure and preserves formal artifacts`, async () => {
    const result = await runProductionNamedLensAcceptanceCase({
      applicableLensCount: 1,
      failure,
    });
    assert.equal(result.batch.status, "partial", failure);
    assert.equal(result.bundle.terminalStatus, "partial", failure);
    const expectedReason = {
      provider: "PROVIDER_TRANSPORT_FAILURE",
      timeout: "PROVIDER_TIMEOUT",
      lineage: "FOREIGN_PASSAGE_SOURCE",
      grounding: "FOREIGN_PASSAGE_EVIDENCE",
      required_passage: "FOREIGN_PASSAGE_FOCUS",
    }[failure];
    assert.deepEqual(
      result.bundle.terminalReasonCodes,
      [expectedReason],
      failure,
    );
    assert.ok(
      (result.bundle.decisionCriticalEvidenceProjection?.evidenceRefs.length
        ?? 0) > 0,
      failure,
    );
    assert.equal(result.bundle.scenarioModel.scenarios.length, 3, failure);
    assert.equal(
      result.bundle.scenarioModel.scenarios.every(
        ({ inputs }) => inputs.length === 17,
      ),
      true,
      failure,
    );
    assert.ok(result.bundle.valuation, failure);
    assert.equal(
      result.bundle.judgments.filter(({ frameworkMetadata }) =>
        frameworkMetadata === undefined
      ).length,
      8,
      failure,
    );
    assert.ok(result.bundle.decision, failure);
    assert.ok(result.bundle.actionDrafts.length > 0, failure);
    assert.ok(result.bundle.narrative.length > 0, failure);
    assert.equal(
      result.runs.inspect().candidates[0]?.status,
      "partial",
      failure,
    );
    const settledAttempts = await result.namedLensArtifacts.listAttempts(
      result.runs.inspect().candidates[0]!.workspaceId,
      result.runs.inspect().candidates[0]!.id,
    );
    assert.equal(settledAttempts.length >= 1, true, failure);
    assert.equal(
      settledAttempts.every(({ artifactSourceCandidateRunId }) =>
        artifactSourceCandidateRunId
          === result.runs.inspect().candidates[0]!.id
      ),
      true,
      failure,
    );
    if (failure === "timeout") {
      const timedOutAttempt = settledAttempts.find(
        ({ failureReason }) => failureReason?.code === "timeout",
      );
      assert.equal(timedOutAttempt?.status, "aborted");
      assert.match(timedOutAttempt?.failureReason?.detail ?? "", /bounded.*timeout/i);
      assert.equal(
        result.runs.inspect().checkpoints.find(
          ({ stage }) => stage === "framework_lenses",
        )?.status,
        "completed",
      );
      const callsBeforeReplay = result.advisoryProviderCalls();
      const replayedBatch = await result.replay();
      assert.equal(replayedBatch.id, result.batch.id);
      assert.equal(result.advisoryProviderCalls(), callsBeforeReplay);
      assert.equal(
        (await result.namedLensArtifacts.listAttempts(
          result.runs.inspect().candidates[0]!.workspaceId,
          result.runs.inspect().candidates[0]!.id,
        )).length,
        settledAttempts.length,
      );
    }
  });
}

test("a force refresh nonce creates one new canonical artifact and deterministically reuses it on retry", async () => {
  let sequence = 0;
  const warnings: string[] = [];
  let lensExecutions = 0;
  let groundingNow = new Date("2026-07-29T12:00:00.000Z");
  const artifacts = createMemoryUnderwritingArtifactsRepository();
  const evidencePacks = createMemoryEvidencePacksRepository();
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
    leaseTokenGenerator: () => `lease_${++sequence}`,
    artifacts,
    evidencePacks,
  });
  const grounding = await candidateGroundingFor("deal_a", {
    includeContext: true,
    repository: evidencePacks,
  });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    referenceCatalog: TEST_REFERENCE_CATALOG,
    onWarning: (warning) => warnings.push(warning),
    refreshNonce: () => `refresh_${++sequence}`,
    candidateExecutor: createSourceGroundedCandidateExecutor({
      grounding,
      frameworkCatalog: TEST_STATIC_FRAMEWORK_CATALOG,
      frameworkLenses: {
        async runAll(request) {
          lensExecutions += 1;
          return canonicalFrameworkAbstentions(request);
        },
      },
      now: () => groundingNow,
      execution: {
        providerModel: "synthetic-test-lens",
        promptVersion: "framework-lens-v1",
        schemaVersion: "framework-judgment-v1",
        settingsFingerprint: `sha256:${"b".repeat(64)}`,
        applicationCommit: "task13-test",
      },
    }),
    now: () => NOW,
  });
  const analyses = [analysis("deal_a", 0.99)];
  const input = {
    scanRun,
    report: report(analyses),
    analyses,
    eligibleDeals: [deal("deal_a")],
  };

  const original = await orchestrator.createBatchAndSelections({
    ...input,
    forceRefresh: false,
  });
  groundingNow = new Date("2026-07-29T12:00:01.000Z");
  const refreshed = await orchestrator.createBatchAndSelections({
    ...input,
    forceRefresh: true,
    refreshNonce: "refresh_retry_1",
  });
  const refreshedRetry = await orchestrator.createBatchAndSelections({
    ...input,
    forceRefresh: true,
    refreshNonce: "refresh_retry_1",
  });

  const candidates = runs.inspect().candidates;
  const originalCandidate = candidates.find(
    ({ batchId }) => batchId === original.id,
  );
  const refreshedCandidate = candidates.find(
    ({ batchId }) => batchId === refreshed.id,
  );
  assert.ok(originalCandidate);
  assert.ok(refreshedCandidate);
  assert.equal(refreshedRetry.id, refreshed.id);
  assert.equal(refreshedCandidate.status, "partial", JSON.stringify({
    candidates,
    failures: runs.inspect().failureReasons,
    unavailable: runs.inspect().unavailableReasons,
    warnings,
  }));
  assert.notEqual(
    refreshedCandidate.candidateAnalysisFingerprint,
    originalCandidate.candidateAnalysisFingerprint,
  );
  assert.equal(lensExecutions, 2);
  assert.equal(artifacts.inspect().bundles.length, 2);
  const refreshedBundle = await artifacts.getByCandidateRunId({
    workspaceId: refreshedCandidate.workspaceId,
    candidateRunId: refreshedCandidate.id,
  });
  assert.equal(
    refreshedBundle?.sourceCandidateRunId,
    refreshedCandidate.id,
  );
  assert.equal(
    refreshedBundle?.versionSnapshot.refreshNonce,
    "refresh_retry_1",
  );
  assert.deepEqual(
    refreshedBundle?.terminalReasonCodes,
    ["decision_critical_evidence_projection_unavailable"],
  );
});

test("a refresh rejects a stale executor nonce before aliasing attempt-owning work", async () => {
  let sequence = 0;
  const candidateLeaseAuthority =
    createMemoryUnderwritingCandidateLeaseAuthority({ now: () => NOW });
  const namedLensArtifacts = createMemoryNamedLensArtifactsRepository({
    candidateLeaseAuthority,
  });
  const artifacts = createMemoryUnderwritingArtifactsRepository({
    namedLensArtifacts,
  });
  const evidencePacks = createMemoryEvidencePacksRepository();
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
    leaseTokenGenerator: () => `lease_${++sequence}`,
    artifacts,
    namedLensArtifacts,
    candidateLeaseAuthority,
    evidencePacks,
  });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    namedLensArtifacts,
    activeFundPolicy: async () => policy,
    referenceCatalog: TEST_REFERENCE_CATALOG,
    candidateExecutor: async (request) => {
      if (request.refreshNonce !== null) {
        const judgmentId = `judgment_${request.candidate.id}`;
        const frameworkInputFingerprint = createCanonicalFingerprint({
          stage: "framework_lenses",
          candidateRunId: request.candidate.id,
        });
        await request.stages.run({
          stage: "framework_lenses",
          inputFingerprint: frameworkInputFingerprint,
          parseOutput: (value) => value as { attempted: true },
          operation: async () => {
            await request.stages.runProviderAttempt({
              stage: "framework_lenses",
              inputFingerprint: frameworkInputFingerprint,
              attemptFingerprint: createCanonicalFingerprint({
                attempt: request.candidate.id,
              }),
              costUnits: 1,
              tokenUnits: 4_000,
              namedLensAttempt: {
                judgmentOrCatalogCandidateId: judgmentId,
                logicalPassageId:
                  `${judgmentId}@named-lens-passage-v1@named-lens-generator-v1`,
                attemptNumber: 1,
              },
              operation: async () => ({
                text: "{}",
                stopReason: "end_turn",
                usage: {
                  inputTokens: 10,
                  outputTokens: 2,
                  cacheCreationInputTokens: 0,
                  cacheReadInputTokens: 0,
                },
              }),
            });
            return { attempted: true as const };
          },
        });
      }
      const result = finalization({
        candidate: request.candidate,
        candidateRunId: request.candidate.id,
        dealId: request.deal.id,
        workerId: request.workerId,
        leaseToken: request.leaseToken,
      });
      await persistFinalizationFrameworkCatalogCheckpoint(
        request.stages,
        result,
      );
      // Deliberately emulate a stale/custom executor that ignores the refresh
      // nonce and returns the ordinary-run identity after doing provider work.
      result.versionSnapshot.refreshNonce = null;
      await saveFinalizationBuild(evidencePacks, result);
      return result;
    },
    now: () => NOW,
  });
  const analyses = [analysis("deal_a", 0.99)];
  const input = {
    scanRun,
    report: report(analyses),
    analyses,
    eligibleDeals: [deal("deal_a")],
  };

  const original = await orchestrator.createBatchAndSelections({
    ...input,
    forceRefresh: false,
  });
  const refreshed = await orchestrator.createBatchAndSelections({
    ...input,
    forceRefresh: true,
    refreshNonce: "refresh_stale_executor_1",
  });
  const candidates = runs.inspect().candidates;
  const originalCandidate = candidates.find(
    ({ batchId }) => batchId === original.id,
  );
  const refreshedCandidate = candidates.find(
    ({ batchId }) => batchId === refreshed.id,
  );
  assert.ok(originalCandidate);
  assert.ok(refreshedCandidate);
  assert.equal(originalCandidate.status, "completed");
  assert.equal(refreshedCandidate.status, "failed");
  assert.equal(refreshedCandidate.artifactSourceCandidateRunId, null);
  assert.equal(await artifacts.getByCandidateRunId({
    workspaceId: refreshedCandidate.workspaceId,
    candidateRunId: refreshedCandidate.id,
  }), null);
  const refreshAttempts = await namedLensArtifacts.listAttempts(
    refreshedCandidate.workspaceId,
    refreshedCandidate.id,
  );
  assert.equal(refreshAttempts.length, 1);
  assert.equal(
    refreshAttempts[0]?.artifactSourceCandidateRunId,
    refreshedCandidate.id,
  );
  assert.equal(
    (await namedLensArtifacts.listAttempts(
      originalCandidate.workspaceId,
      originalCandidate.id,
    )).length,
    0,
  );
});

test("exhausted provider capacity is a visible truncation without starting the provider call", async () => {
  let sequence = 0;
  let lensExecutions = 0;
  const warnings: string[] = [];
  const artifacts = createMemoryUnderwritingArtifactsRepository();
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
    leaseTokenGenerator: () => `lease_${++sequence}`,
    artifacts,
  });
  const grounding = await candidateGroundingFor("deal_a", {
    includeContext: true,
  });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    referenceCatalog: TEST_REFERENCE_CATALOG,
    candidateTokenUnits: 3_999,
    onWarning: (warning) => warnings.push(warning),
    candidateExecutor: createSourceGroundedCandidateExecutor({
      grounding,
      frameworkCatalog: TEST_STATIC_FRAMEWORK_CATALOG,
      frameworkLenses: {
        async runAll(request) {
          assert.ok(request.providerAttempt);
          await request.providerAttempt.execute({
            attemptFingerprint: `sha256:${"9".repeat(64)}`,
            outputTokenUnits: 4_000,
            operation: async () => {
              lensExecutions += 1;
              return {
                text: "{}",
                stopReason: "end_turn",
                usage: {
                  inputTokens: 10,
                  outputTokens: 2,
                  cacheCreationInputTokens: 0,
                  cacheReadInputTokens: 0,
                },
              };
            },
          });
          return {
            judgments: [],
            disagreements: [],
            passageCandidates: [],
            passageResults: [],
            taxonomyByFrameworkId: {},
            passageContract: CURRENT_FRAMEWORK_LENS_PASSAGE_CONTRACT,
          };
        },
      },
      now: () => NOW,
      execution: {
        providerModel: "synthetic-test-lens",
        promptVersion: "framework-lens-v1",
        schemaVersion: "framework-judgment-v1",
        settingsFingerprint: `sha256:${"b".repeat(64)}`,
        applicationCommit: "task13-test",
      },
    }),
    now: () => NOW,
  });
  const analyses = [analysis("deal_a", 0.99)];

  const batch = await orchestrator.createBatchAndSelections({
    scanRun,
    report: report(analyses),
    analyses,
    eligibleDeals: [deal("deal_a")],
    forceRefresh: false,
  });

  assert.equal(batch.status, "failed");
  assert.equal(lensExecutions, 0);
  assert.equal(runs.inspect().candidates[0]?.status, "unavailable");
  assert.deepEqual(
    Object.values(runs.inspect().unavailableReasons),
    [["CANDIDATE_BUDGET_EXHAUSTED_FRAMEWORK_LENSES"]],
  );
  assert.deepEqual(
    runs.inspect().checkpoints.map(({ stage, status }) => [stage, status]),
    [
      ["context_router", "completed"],
      ["evidence_pack", "completed"],
      ["valuation", "completed"],
      ["framework_catalog", "completed"],
      ["framework_lenses", "failed"],
    ],
  );
  assert.match(
    runs.inspect().checkpoints.at(-1)?.publicReason ?? "",
    /truncation warning.*budget.*no negative/i,
  );
  assert.ok(warnings.some((warning) => /truncation warning/i.test(warning)));
  assert.equal(artifacts.inspect().bundles.length, 0);
});

test("settled provider overage blocks the next physical request before dispatch", async () => {
  let sequence = 0;
  let providerExecutions = 0;
  const evidencePacks = createMemoryEvidencePacksRepository();
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
    leaseTokenGenerator: () => `lease_${++sequence}`,
    evidencePacks,
  });
  const grounding = await candidateGroundingFor("deal_a", {
    includeContext: true,
    repository: evidencePacks,
  });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    referenceCatalog: TEST_REFERENCE_CATALOG,
    candidateTokenUnits: 8_000,
    candidateExecutor: createSourceGroundedCandidateExecutor({
      grounding,
      frameworkCatalog: TEST_STATIC_FRAMEWORK_CATALOG,
      frameworkLenses: {
        async runAll(request) {
          assert.ok(request.providerAttempt);
          await request.providerAttempt.execute({
            attemptFingerprint: `sha256:${"7".repeat(64)}`,
            outputTokenUnits: 4_000,
            operation: async () => {
              providerExecutions += 1;
              return {
                text: "{\"first\":true}",
                stopReason: "end_turn",
                usage: {
                  inputTokens: 4_001,
                  outputTokens: 2_000,
                  cacheCreationInputTokens: 0,
                  cacheReadInputTokens: 0,
                },
              };
            },
          });
          await request.providerAttempt.execute({
            attemptFingerprint: `sha256:${"8".repeat(64)}`,
            outputTokenUnits: 4_000,
            operation: async () => {
              providerExecutions += 1;
              return {
                text: "{\"second\":true}",
                stopReason: "end_turn",
                usage: {
                  inputTokens: 1,
                  outputTokens: 1,
                  cacheCreationInputTokens: 0,
                  cacheReadInputTokens: 0,
                },
              };
            },
          });
          return {
            judgments: [],
            disagreements: [],
            passageCandidates: [],
            passageResults: [],
            taxonomyByFrameworkId: {},
            passageContract: CURRENT_FRAMEWORK_LENS_PASSAGE_CONTRACT,
          };
        },
      },
      now: () => NOW,
      execution: {
        providerModel: "synthetic-test-lens",
        promptVersion: "framework-lens-v1",
        schemaVersion: "framework-judgment-v1",
        settingsFingerprint: `sha256:${"b".repeat(64)}`,
        applicationCommit: "task13-test",
      },
    }),
    now: () => NOW,
  });
  const analyses = [analysis("deal_a", 0.99)];

  await orchestrator.createBatchAndSelections({
    scanRun,
    report: report(analyses),
    analyses,
    eligibleDeals: [deal("deal_a")],
    forceRefresh: false,
  });

  assert.equal(providerExecutions, 1);
  assert.equal(runs.inspect().candidates[0]?.status, "unavailable");
  const checkpoint = runs.inspect().checkpoints.find(
    ({ stage }) => stage === "framework_lenses",
  );
  assert.equal(checkpoint?.tokenUnits, 6_001);
  assert.equal(checkpoint?.actualTokenUnits, 6_001);
  assert.equal(checkpoint?.providerAttempts.length, 1);
});

test("unknown provider usage conservatively retains the full reservation", async () => {
  let sequence = 0;
  const candidateLeaseAuthority =
    createMemoryUnderwritingCandidateLeaseAuthority({ now: () => NOW });
  const namedLensArtifacts = createMemoryNamedLensArtifactsRepository({
    candidateLeaseAuthority,
  });
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
    leaseTokenGenerator: () => `lease_${++sequence}`,
    namedLensArtifacts,
    candidateLeaseAuthority,
  });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    namedLensArtifacts,
    activeFundPolicy: async () => policy,
    referenceCatalog: TEST_REFERENCE_CATALOG,
    candidateExecutor: async ({ stages }) => {
      const inputFingerprint = `sha256:${"1".repeat(64)}`;
      await stages.run({
        stage: "framework_lenses",
        inputFingerprint,
        parseOutput(value) {
          return value;
        },
        operation: async () => {
          await stages.runProviderAttempt({
            stage: "framework_lenses",
            inputFingerprint,
            attemptFingerprint: `sha256:${"2".repeat(64)}`,
            costUnits: 3,
            tokenUnits: 4_000,
            namedLensAttempt: {
              judgmentOrCatalogCandidateId: "judgment_provider_failure",
              logicalPassageId:
                "judgment_provider_failure@named-lens-passage-v1@named-lens-generator-v1",
              attemptNumber: 1,
            },
            operation: async () => {
              throw new IntegrationTransportError({ retryable: true });
            },
          });
          return {};
        },
      });
      throw new Error("The provider failure must escape candidate execution.");
    },
    now: () => NOW,
  });
  const analyses = [analysis("deal_a", 0.99)];

  await orchestrator.createBatchAndSelections({
    scanRun,
    report: report(analyses),
    analyses,
    eligibleDeals: [deal("deal_a")],
    forceRefresh: false,
  });

  const checkpoint = runs.inspect().checkpoints.find(
    ({ stage }) => stage === "framework_lenses",
  );
  assert.equal(checkpoint?.status, "failed");
  assert.equal(checkpoint?.costUnits, 3);
  assert.equal(checkpoint?.tokenUnits, 4_000);
  assert.equal(checkpoint?.actualTokenUnits, 0);
  assert.deepEqual(checkpoint?.providerAttempts, [{
    attemptFingerprint: `sha256:${"2".repeat(64)}`,
    status: "failed",
    reservedCostUnits: 3,
    reservedTokenUnits: 4_000,
    actualCostUnits: 0,
    actualTokenUnits: 0,
    usageKnown: false,
  }]);
  assert.equal(namedLensArtifacts.inspect().rawAttemptEvents.length, 2);
  assert.equal(
    (await namedLensArtifacts.listAttempts(
      "workspace_1",
      runs.inspect().candidates[0]!.id,
    ))[0]?.status,
    "failed",
  );
});

test("concurrent provider settlements preserve every ledger entry without serializing provider work", async () => {
  let sequence = 0;
  let activeProviders = 0;
  let maximumProviderConcurrency = 0;
  let releaseProviders!: () => void;
  const allProvidersStarted = new Promise<void>((resolve) => {
    releaseProviders = resolve;
  });
  const storage = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
    leaseTokenGenerator: () => `lease_${++sequence}`,
  });
  const runs: typeof storage = {
    ...storage,
    async saveCheckpoint(input) {
      if (
        input.stage === "framework_lenses"
        && input.providerAttempts.length > 0
      ) {
        await Promise.resolve();
      }
      await storage.saveCheckpoint(input);
    },
  };
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    referenceCatalog: TEST_REFERENCE_CATALOG,
    candidateExecutor: async ({ stages }) => {
      const inputFingerprint = `sha256:${"1".repeat(64)}`;
      await stages.run({
        stage: "framework_lenses",
        inputFingerprint,
        parseOutput(value) {
          assert.deepEqual(value, { completed: 4 });
          return value as { completed: number };
        },
        operation: async () => {
          await Promise.all(
            Array.from({ length: 4 }, async (_, index) =>
              stages.runProviderAttempt({
                stage: "framework_lenses",
                inputFingerprint,
                attemptFingerprint:
                  `sha256:${String(index + 2).repeat(64)}`,
                costUnits: 1,
                tokenUnits: 4_000,
                operation: async () => {
                  activeProviders += 1;
                  maximumProviderConcurrency = Math.max(
                    maximumProviderConcurrency,
                    activeProviders,
                  );
                  if (activeProviders === 4) releaseProviders();
                  await allProvidersStarted;
                  activeProviders -= 1;
                  return {
                    text: `provider-${index}`,
                    stopReason: "end_turn",
                    usage: {
                      inputTokens: 6,
                      outputTokens: 4,
                      cacheCreationInputTokens: 0,
                      cacheReadInputTokens: 0,
                    },
                  };
                },
              })
            ),
          );
          return { completed: 4 };
        },
      });
      return {
        kind: "unavailable",
        reasonCodes: ["TEST_EXECUTION_COMPLETE"],
      };
    },
    now: () => NOW,
  });
  const analyses = [analysis("deal_a", 0.99)];

  await orchestrator.createBatchAndSelections({
    scanRun,
    report: report(analyses),
    analyses,
    eligibleDeals: [deal("deal_a")],
    forceRefresh: false,
  });

  assert.equal(maximumProviderConcurrency, 4);
  const checkpoint = storage.inspect().checkpoints.find(
    ({ stage }) => stage === "framework_lenses",
  );
  assert.equal(checkpoint?.status, "completed");
  assert.equal(checkpoint?.providerAttempts.length, 4);
  assert.equal(checkpoint?.costUnits, 4);
  assert.equal(checkpoint?.tokenUnits, 40);
  assert.equal(checkpoint?.actualTokenUnits, 40);
});

test("a reclaimed lease replays completed stages and restores provider usage without repeated work", async () => {
  let sequence = 0;
  let currentTime = NOW;
  let rejectFirstTermination = true;
  let executorRuns = 0;
  let groundingExecutions = 0;
  let providerExecutions = 0;
  const evidencePacks = createMemoryEvidencePacksRepository();
  const usages: Array<ReturnType<
    Parameters<
      NonNullable<
        Parameters<typeof createUnderwritingOrchestrator>[0][
          "candidateExecutor"
        ]
      >
    >[0]["stages"]["usage"]
  >> = [];
  const storage = createMemoryUnderwritingRunsRepository({
    now: () => currentTime,
    idGenerator: (kind) => `${kind}_${++sequence}`,
    leaseTokenGenerator: () => `lease_${++sequence}`,
    evidencePacks,
  });
  const runs = {
    ...storage,
    async markCandidateFailed(input: {
      candidateRunId: string;
      publicReason: string;
    }) {
      if (rejectFirstTermination) {
        rejectFirstTermination = false;
        throw new Error("simulated worker loss before terminal write");
      }
      return storage.markCandidateFailed(input);
    },
  };
  const candidateExecutor: NonNullable<
    Parameters<typeof createUnderwritingOrchestrator>[0][
      "candidateExecutor"
    ]
  > = async ({ candidate, workerId, leaseToken, stages }) => {
    executorRuns += 1;
    const grounding = await stages.run({
      stage: "context_router",
      inputFingerprint: `sha256:${"1".repeat(64)}`,
      parseOutput(value) {
        assert.deepEqual(value, { identity: "grounded" });
        return value as { identity: string };
      },
      operation: async () => {
        groundingExecutions += 1;
        return { identity: "grounded" };
      },
    });
    assert.equal(grounding.identity, "grounded");
    const lens = await stages.run({
      stage: "framework_lenses",
      inputFingerprint: `sha256:${"2".repeat(64)}`,
      parseOutput(value) {
        assert.deepEqual(value, { providerText: "grounded judgment" });
        return value as { providerText: string };
      },
      operation: async () => {
        const completion = await stages.runProviderAttempt({
          stage: "framework_lenses",
          inputFingerprint: `sha256:${"2".repeat(64)}`,
          attemptFingerprint: `sha256:${"3".repeat(64)}`,
          costUnits: 1,
          tokenUnits: 4_000,
          operation: async () => {
            providerExecutions += 1;
            return {
              text: "grounded judgment",
              stopReason: "end_turn",
              usage: {
                inputTokens: 11,
                outputTokens: 7,
                cacheCreationInputTokens: 3,
                cacheReadInputTokens: 5,
              },
            };
          },
        });
        return { providerText: completion.text };
      },
    });
    assert.equal(lens.providerText, "grounded judgment");
    usages.push(stages.usage());
    if (executorRuns === 1) {
      throw new Error("simulated worker loss after durable stage completion");
    }
    const payload = finalization({
      candidate,
      candidateRunId: candidate.id,
      dealId: candidate.dealId,
      workerId,
      leaseToken,
    });
    await persistFinalizationFrameworkCatalogCheckpoint(stages, payload);
    await saveFinalizationBuild(evidencePacks, payload);
    return payload;
  };
  const createOrchestrator = () => createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    referenceCatalog: TEST_REFERENCE_CATALOG,
    candidateExecutor,
    candidateLeaseSeconds: 1,
    now: () => currentTime,
  });
  const analyses = [analysis("deal_a", 0.99)];
  const input = {
    scanRun,
    report: report(analyses),
    analyses,
    eligibleDeals: [deal("deal_a")],
    forceRefresh: false,
  };

  await assert.rejects(
    createOrchestrator().createBatchAndSelections(input),
    /simulated worker loss before terminal write/,
  );
  assert.equal(storage.inspect().candidates[0]?.status, "running");
  currentTime = new Date(NOW.getTime() + 2_000);

  const resumed = await createOrchestrator().createBatchAndSelections(input);

  assert.equal(resumed.status, "completed");
  assert.equal(executorRuns, 2);
  assert.equal(groundingExecutions, 1);
  assert.equal(providerExecutions, 1);
  assert.deepEqual(usages, [
    {
      costUnits: 1,
      tokenUnits: 26,
      actualTokenUnits: 26,
      remainingCostUnits: 27,
      remainingTokenUnits: 111_974,
    },
    {
      costUnits: 1,
      tokenUnits: 26,
      actualTokenUnits: 26,
      remainingCostUnits: 27,
      remainingTokenUnits: 111_974,
    },
  ]);
});

test("a reclaimed lease recovers from a persisted catalog failure without changing the framework checkpoint input", async () => {
  let sequence = 0;
  let currentTime = NOW;
  let rejectFirstTermination = true;
  let frameworkResolutions = 0;
  let lensExecutions = 0;
  const artifacts = createMemoryUnderwritingArtifactsRepository();
  const evidencePacks = createMemoryEvidencePacksRepository();
  const storage = createMemoryUnderwritingRunsRepository({
    now: () => currentTime,
    idGenerator: (kind) => `${kind}_${++sequence}`,
    leaseTokenGenerator: () => `lease_${++sequence}`,
    artifacts,
    evidencePacks,
  });
  const runs: typeof storage = {
    ...storage,
    async markCandidateUnavailable() {
      throw new Error("simulated worker loss before unavailable write");
    },
    async markCandidateFailed(input) {
      if (rejectFirstTermination) {
        rejectFirstTermination = false;
        throw new Error("simulated worker loss before terminal write");
      }
      return storage.markCandidateFailed(input);
    },
  };
  const grounding = await candidateGroundingFor("deal_a", {
    includeContext: true,
    repository: evidencePacks,
  });
  const createOrchestrator = () => createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    referenceCatalog: TEST_REFERENCE_CATALOG,
    candidateLeaseSeconds: 1,
    candidateExecutor: createCurrentFixtureSourceGroundedCandidateExecutor({
      grounding,
      resolveFrameworkLenses: async () => {
        frameworkResolutions += 1;
        if (frameworkResolutions <= 2) {
          throw new IntegrationTransportError({ retryable: true });
        }
        return {
          catalogVersion: "research-framework-catalog-v1",
          catalogFingerprint: `sha256:${"7".repeat(64)}`,
          corpusDigest: `sha256:${"8".repeat(64)}`,
          service: {
            async runAll(request) {
              lensExecutions += 1;
              return canonicalFrameworkAbstentions(request);
            },
          },
        };
      },
      now: () => currentTime,
      execution: {
        providerModel: "synthetic-test-lens",
        promptVersion: "framework-lens-v1",
        schemaVersion: "framework-judgment-v1",
        settingsFingerprint: `sha256:${"b".repeat(64)}`,
        applicationCommit: "task13-test",
      },
    }),
    now: () => currentTime,
  });
  const analyses = [analysis("deal_a", 0.99)];
  const input = {
    scanRun,
    report: report(analyses),
    analyses,
    eligibleDeals: [deal("deal_a")],
    forceRefresh: false,
  };

  await assert.rejects(
    createOrchestrator().createBatchAndSelections(input),
    /simulated worker loss before terminal write/,
  );
  assert.equal(storage.inspect().candidates[0]?.status, "running");
  assert.equal(
    storage.inspect().checkpoints.find(
      ({ stage }) => stage === "framework_catalog",
    )?.status,
    "failed",
  );

  currentTime = new Date(NOW.getTime() + 2_000);
  const resumed = await createOrchestrator().createBatchAndSelections(input);

  assert.equal(resumed.status, "completed");
  assert.equal(frameworkResolutions, 3);
  assert.equal(lensExecutions, 1);
  const catalogCheckpoint = storage.inspect().checkpoints.find(
    ({ stage }) => stage === "framework_catalog",
  );
  const frameworkCheckpoint = storage.inspect().checkpoints.find(
    ({ stage }) => stage === "framework_lenses",
  );
  assert.equal(catalogCheckpoint?.status, "completed");
  assert.equal(catalogCheckpoint?.attemptCount, 3);
  assert.equal(frameworkCheckpoint?.status, "completed");
  assert.notEqual(
    catalogCheckpoint?.inputFingerprint,
    frameworkCheckpoint?.inputFingerprint,
  );
});

test("framework timeout is visible unavailability and never generic failure or negative evidence", async () => {
  let sequence = 0;
  let providerSignal: AbortSignal | undefined;
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
    leaseTokenGenerator: () => `lease_${++sequence}`,
  });
  const grounding = await candidateGroundingFor("deal_a", {
    includeContext: true,
  });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    referenceCatalog: TEST_REFERENCE_CATALOG,
    candidateStagePolicies: {
      framework_lenses: { timeoutMs: 5 },
    },
    candidateExecutor: createSourceGroundedCandidateExecutor({
      grounding,
      frameworkCatalog: TEST_STATIC_FRAMEWORK_CATALOG,
      frameworkLenses: {
        async runAll(request) {
          providerSignal = request.signal;
          return await new Promise((_, reject) => {
            request.signal?.addEventListener(
              "abort",
              () => reject(request.signal?.reason),
              { once: true },
            );
          });
        },
      },
      now: () => NOW,
      execution: {
        providerModel: "synthetic-test-lens",
        promptVersion: "framework-lens-v1",
        schemaVersion: "framework-judgment-v1",
        settingsFingerprint: `sha256:${"b".repeat(64)}`,
        applicationCommit: "task13-test",
      },
    }),
    now: () => NOW,
  });
  const analyses = [analysis("deal_a", 0.99)];

  await orchestrator.createBatchAndSelections({
    scanRun,
    report: report(analyses),
    analyses,
    eligibleDeals: [deal("deal_a")],
    forceRefresh: false,
  });

  assert.equal(providerSignal?.aborted, true);
  assert.equal(runs.inspect().candidates[0]?.status, "unavailable");
  assert.deepEqual(
    Object.values(runs.inspect().unavailableReasons),
    [["CANDIDATE_STAGE_TIMEOUT_FRAMEWORK_LENSES"]],
  );
  assert.equal(Object.keys(runs.inspect().failureReasons).length, 0);
  assert.match(
    runs.inspect().checkpoints.at(-1)?.publicReason ?? "",
    /truncation warning.*timed out.*no negative/i,
  );
});

test("retries a transient framework catalog transport failure before exposing unavailability", async () => {
  let sequence = 0;
  let frameworkResolutions = 0;
  const artifacts = createMemoryUnderwritingArtifactsRepository();
  const evidencePacks = createMemoryEvidencePacksRepository();
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
    leaseTokenGenerator: () => `lease_${++sequence}`,
    artifacts,
    evidencePacks,
  });
  const grounding = await candidateGroundingFor("deal_a", {
    includeContext: true,
    repository: evidencePacks,
  });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    referenceCatalog: TEST_REFERENCE_CATALOG,
    candidateExecutor: createCurrentFixtureSourceGroundedCandidateExecutor({
      grounding,
      resolveFrameworkLenses: async () => {
        frameworkResolutions += 1;
        if (frameworkResolutions === 1) {
          throw new IntegrationTransportError({ retryable: true });
        }
        return {
          catalogVersion: "research-framework-catalog-v1",
          catalogFingerprint: `sha256:${"7".repeat(64)}`,
          corpusDigest: `sha256:${"8".repeat(64)}`,
          service: {
            async runAll(request) {
              return canonicalFrameworkAbstentions(request);
            },
          },
        };
      },
      now: () => NOW,
      execution: {
        providerModel: "synthetic-test-lens",
        promptVersion: "framework-lens-v1",
        schemaVersion: "framework-judgment-v1",
        settingsFingerprint: `sha256:${"b".repeat(64)}`,
        applicationCommit: "task13-test",
      },
    }),
    now: () => NOW,
  });
  const analyses = [analysis("deal_a", 0.99)];

  const batch = await orchestrator.createBatchAndSelections({
    scanRun,
    report: report(analyses),
    analyses,
    eligibleDeals: [deal("deal_a")],
    forceRefresh: false,
  });

  assert.equal(batch.status, "completed");
  assert.equal(frameworkResolutions, 2);
  assert.equal(runs.inspect().candidates[0]?.status, "completed");
  assert.deepEqual(runs.inspect().unavailableReasons, {});
  assert.deepEqual(
    runs.inspect().checkpoints
      .filter(({ stage }) => stage === "framework_catalog")
      .map(({ status, attemptCount, reasonCode }) => ({
        status,
        attemptCount,
        reasonCode,
      })),
    [{
      status: "completed",
      attemptCount: 2,
      reasonCode: null,
    }],
  );
});

test("framework catalog resolution is aborted by the bounded framework stage timeout", async () => {
  let sequence = 0;
  let resolutionSignal: AbortSignal | undefined;
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
    leaseTokenGenerator: () => `lease_${++sequence}`,
  });
  const grounding = await candidateGroundingFor("deal_a", {
    includeContext: true,
  });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    referenceCatalog: TEST_REFERENCE_CATALOG,
    candidateStagePolicies: {
      framework_catalog: { timeoutMs: 5 },
    },
    candidateExecutor: createSourceGroundedCandidateExecutor({
      grounding,
      resolveFrameworkLenses: async (_context, signal?: AbortSignal) => {
        resolutionSignal = signal;
        return await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve({
              catalogVersion: "research-framework-catalog-v1",
              catalogFingerprint: `sha256:${"7".repeat(64)}`,
              corpusDigest: `sha256:${"8".repeat(64)}`,
              service: {
                async runAll() {
                  return {
                    judgments: [],
                    disagreements: [],
                    passageCandidates: [],
                    passageResults: [],
                    taxonomyByFrameworkId: {},
                    passageContract:
                      CURRENT_FRAMEWORK_LENS_PASSAGE_CONTRACT,
                  };
                },
              },
            });
          }, 50);
          signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(signal.reason);
          }, { once: true });
        });
      },
      now: () => NOW,
      execution: {
        providerModel: "synthetic-test-lens",
        promptVersion: "framework-lens-v1",
        schemaVersion: "framework-judgment-v1",
        settingsFingerprint: `sha256:${"b".repeat(64)}`,
        applicationCommit: "task13-test",
      },
    }),
    now: () => NOW,
  });
  const analyses = [analysis("deal_a", 0.99)];

  await orchestrator.createBatchAndSelections({
    scanRun,
    report: report(analyses),
    analyses,
    eligibleDeals: [deal("deal_a")],
    forceRefresh: false,
  });

  assert.equal(resolutionSignal?.aborted, true);
  assert.equal(runs.inspect().candidates[0]?.status, "unavailable");
  assert.deepEqual(
    Object.values(runs.inspect().unavailableReasons),
    [["CANDIDATE_STAGE_TIMEOUT_FRAMEWORK_CATALOG"]],
  );
  assert.deepEqual(
    runs.inspect().checkpoints
      .filter(({ stage }) => stage === "framework_catalog")
      .map(({ status, reasonCode, attemptCount, providerAttempts }) => ({
        status,
        reasonCode,
        attemptCount,
        providerAttemptCount: providerAttempts.length,
      })),
    [{
      status: "failed",
      reasonCode: "CANDIDATE_STAGE_TIMEOUT_FRAMEWORK_CATALOG",
      attemptCount: 1,
      providerAttemptCount: 0,
    }],
  );
});

test("rejected framework catalog resolution is visible unavailability with a failed stage checkpoint", async () => {
  let sequence = 0;
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
    leaseTokenGenerator: () => `lease_${++sequence}`,
  });
  const grounding = await candidateGroundingFor("deal_a", {
    includeContext: true,
  });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    referenceCatalog: TEST_REFERENCE_CATALOG,
    candidateExecutor: createSourceGroundedCandidateExecutor({
      grounding,
      resolveFrameworkLenses: async () => {
        throw new Error("audited catalog is temporarily unavailable");
      },
      now: () => NOW,
      execution: {
        providerModel: "synthetic-test-lens",
        promptVersion: "framework-lens-v1",
        schemaVersion: "framework-judgment-v1",
        settingsFingerprint: `sha256:${"b".repeat(64)}`,
        applicationCommit: "task13-test",
      },
    }),
    now: () => NOW,
  });
  const analyses = [analysis("deal_a", 0.99)];

  await orchestrator.createBatchAndSelections({
    scanRun,
    report: report(analyses),
    analyses,
    eligibleDeals: [deal("deal_a")],
    forceRefresh: false,
  });

  assert.equal(runs.inspect().candidates[0]?.status, "unavailable");
  assert.deepEqual(
    Object.values(runs.inspect().unavailableReasons),
    [["FRAMEWORK_CATALOG_UNAVAILABLE"]],
  );
  assert.deepEqual(
    runs.inspect().checkpoints
      .filter(({ stage }) => stage === "framework_catalog")
      .map(({ status, reasonCode, attemptCount }) => ({
        status,
        reasonCode,
        attemptCount,
      })),
    [{
      status: "failed",
      reasonCode: "CANDIDATE_STAGE_EXECUTION_FRAMEWORK_CATALOG",
      attemptCount: 1,
    }],
  );
});

test("processes a confirmed uploaded Deal from the authoritative registry before underwriting", async () => {
  const { registry } = await uploadedDealRegistry();
  const runs = createRunsRepository(createMemoryDataClient({
    now: () => NOW,
  }));
  await runs.create({
    workspaceId: "workspace_1",
    mode: "structured",
    windowDays: 14,
  });
  const claimed = await runs.claimNext("worker_1");
  assert.ok(claimed);
  let underwritingInput:
    | Parameters<
      ReturnType<
        typeof createUnderwritingOrchestrator
      >["createBatchAndSelections"]
    >[0]
    | undefined;

  const result = await processClaimedRun(claimed, {
    runs,
    intelligence: createMemoryIntelligenceRepository({
      now: () => NOW,
      dealRegistry: registry,
    }),
    dealRegistry: registry,
    importGate: { async assertReady() {} },
    market: {
      async scanMarketWindow() {
        return {
          status: "completed" as const,
          window: {
            from: "2026-07-15T12:00:00.000Z",
            to: NOW.toISOString(),
            days: 14 as const,
          },
          providers: [{
            providerId: "official",
            providerName: "Official source",
            fetchedCount: 1,
            acceptedCount: 1,
            rejectedCount: 0,
            lastSuccessAt: NOW.toISOString(),
          }],
          events: [underwritingMarketEvent({
            id: "market_uploaded",
            sourceId: "market_source_uploaded",
            title:
              "Uploaded Acme raises Series B for clinical workflow automation",
            statement:
              "Uploaded Acme raised funding to expand clinical workflow automation for health systems.",
            canonicalUrl:
              "https://example.com/uploaded-acme-expansion",
            eventType: "funding",
            sectors: ["healthcare"],
            themes: ["clinical", "workflow", "automation"],
            positiveImplications: [
              "The expansion may satisfy the saved revisit condition.",
            ],
            entityKeys: ["uploaded-acme"],
          })],
        };
      },
    },
    reasoner: {
      async reason() {
        return [];
      },
    },
    underwriting: {
      async createBatchAndSelections(input) {
        underwritingInput = input;
        return {
          id: "batch_uploaded",
          workspaceId: "workspace_1",
          scanRunId: claimed.id,
          status: "completed",
          batchInputFingerprint: `sha256:${"d".repeat(64)}`,
          fundPolicySnapshotId: policy.id,
          rerunOfId: null,
          createdAt: NOW.toISOString(),
        };
      },
      async processCandidate() {
        throw new Error("The process-run seam owns automatic processing.");
      },
    },
    now: () => NOW,
  });

  assert.equal(result.report.companyAnalyses.length, 1);
  assert.equal(result.report.companyAnalyses[0]?.dealId, "deal_uploaded");
  assert.equal(
    result.report.companyAnalyses[0]?.outcome,
    "no_material_change",
  );
  const universe = await registry.getRunDealUniverse({
    workspaceId: claimed.workspaceId,
    runId: claimed.id,
  });
  assert.ok(universe);
  assert.equal(universe.dealCount, 1);
  assert.deepEqual(universe.members.map(({ dealId, companyId, dealStatus }) => ({
    dealId,
    companyId,
    dealStatus,
  })), [{
    dealId: "deal_uploaded",
    companyId: "company_uploaded",
    dealStatus: "passed",
  }]);
  const audit = result.report.companyAnalyses[0]?.currentRunAudit;
  assert.ok(audit);
  assert.equal(audit.workspaceId, claimed.workspaceId);
  assert.equal(audit.companyId, "company_uploaded");
  assert.equal(audit.dealUniverseId, universe.universeId);
  assert.equal(audit.dealUniverseFingerprint, universe.universeFingerprint);
  assert.equal(
    audit.evidenceContextFingerprint,
    claimed.evidenceContext.state === "current"
      ? claimed.evidenceContext.contextFingerprint
      : null,
  );
  const evidenceBinding = await runs.getEvidenceBinding(
    claimed.workspaceId,
    claimed.id,
  );
  assert.ok(evidenceBinding);
  assert.deepEqual(
    audit.consideredMarketEventIds,
    evidenceBinding.events.map(({ id }) => id),
  );
  assert.deepEqual(audit.matchedMarketEventIds, []);
  assert.equal(audit.outcome, "no_material_change");
  assert.match(audit.whyNotUnderwriting ?? "", /no material belief change/i);
  assert.deepEqual(audit.recall, {
    attempted: false,
    succeeded: false,
    failureReason: null,
  });
  assert.deepEqual(
    underwritingInput?.eligibleDeals.map(({ id }) => id),
    ["deal_uploaded"],
  );
  assert.equal(
    underwritingInput?.analyses[0]?.dealId,
    "deal_uploaded",
  );
});

test("Worker parent run never reports completed over a partial or failed underwriting batch", async () => {
  for (const underwritingStatus of ["partial", "failed"] as const) {
    const { registry } = await uploadedDealRegistry();
    const dataClient = createMemoryDataClient({ now: () => NOW });
    const runs = createRunsRepository(dataClient);
    await runs.create({
      workspaceId: "workspace_1",
      mode: "structured",
      windowDays: 14,
    });
    const claimed = await runs.claimNext("worker_1");
    assert.ok(claimed);
    const result = await processClaimedRun(claimed, {
      runs,
      intelligence: createMemoryIntelligenceRepository({
        now: () => NOW,
        dealRegistry: registry,
      }),
      dealRegistry: registry,
      importGate: { async assertReady() {} },
      market: {
        async scanMarketWindow() {
          return {
            status: "completed" as const,
            window: {
              from: "2026-07-15T12:00:00.000Z",
              to: NOW.toISOString(),
              days: 14 as const,
            },
            providers: [],
            events: [],
          };
        },
      },
      reasoner: { async reason() { return []; } },
      underwriting: {
        async createBatchAndSelections() {
          return {
            id: `batch_${underwritingStatus}`,
            workspaceId: "workspace_1",
            scanRunId: claimed.id,
            status: underwritingStatus,
            batchInputFingerprint: `sha256:${"d".repeat(64)}`,
            fundPolicySnapshotId: policy.id,
            rerunOfId: null,
            createdAt: NOW.toISOString(),
          };
        },
        async processCandidate() {
          throw new Error("The process-run seam owns automatic processing.");
        },
      },
      now: () => NOW,
    });

    assert.equal(result.run.status, "partial", underwritingStatus);
    assert.ok(
      result.run.warnings.some((warning) =>
        underwritingStatus === "partial"
          ? /underwriting completed only partially/i.test(warning)
          : /underwriting failed for every admitted candidate/i.test(warning)
      ),
      underwritingStatus,
    );
  }
});

test("structured mode matches an image-only Deal into the ranked opportunity report", async () => {
  const { registry, structuredText } = await imageOnlyDealRegistry();
  const runs = createRunsRepository(createMemoryDataClient({
    now: () => NOW,
  }));
  await runs.create({
    workspaceId: "workspace_1",
    mode: "structured",
    windowDays: 14,
  });
  const claimed = await runs.claimNext("worker_1");
  assert.ok(claimed);

  const result = await processClaimedRun(claimed, {
    runs,
    intelligence: createMemoryIntelligenceRepository({
      now: () => NOW,
      dealRegistry: registry,
    }),
    dealRegistry: registry,
    importGate: { async assertReady() {} },
    market: {
      async scanMarketWindow() {
        return imageMarketScan();
      },
    },
    reasoner: {
      async reason(input) {
        assert.deepEqual(input.deals.map(({ id }) => id), ["deal_image"]);
        assert.equal(input.memoryContexts[0]?.text.includes(structuredText), true);
        const imageSource = input.sources.find(
          ({ id }) => id === "evidence_image_arr",
        );
        assert.equal(imageSource?.schemaVersion, "source-ref-v2");
        assert.equal(imageSource?.adaptation, "canonical");
        assert.equal(imageSource?.text.status, "model_inference");
        assert.equal(
          imageSource && "normalizedStatement" in imageSource.text
            ? imageSource.text.normalizedStatement
            : null,
          structuredText,
        );
        return [imageReasonedMatch(input.events[0]!.id)];
      },
    },
    underwriting: {
      async createBatchAndSelections() {
        return {
          id: "batch_image_structured",
          workspaceId: "workspace_1",
          scanRunId: claimed.id,
          status: "completed",
          batchInputFingerprint: `sha256:${"1".repeat(64)}`,
          fundPolicySnapshotId: policy.id,
          rerunOfId: null,
          createdAt: NOW.toISOString(),
        };
      },
      async processCandidate() {
        throw new Error("The process-run seam owns automatic processing.");
      },
    },
    now: () => NOW,
  });

  assert.equal(result.report.companyAnalyses[0]?.outcome, "belief_revised");
  assert.equal(result.report.opportunities[0]?.dealId, "deal_image");
  assert.equal(
    result.report.companyAnalyses[0]?.sources.some(
      (source) => source.provenance === "model_inference",
    ),
    true,
  );
});

test("XTrace mode uses a partial structured fallback only for an image-only Deal", async () => {
  const { registry, structuredText } = await imageOnlyDealRegistry();
  const runs = createRunsRepository(createMemoryDataClient({
    now: () => NOW,
  }));
  await runs.create({
    workspaceId: "workspace_1",
    mode: "xtrace",
    windowDays: 14,
  });
  const claimed = await runs.claimNext("worker_1");
  assert.ok(claimed);

  const result = await processClaimedRun(claimed, {
    runs,
    intelligence: createMemoryIntelligenceRepository({
      now: () => NOW,
      dealRegistry: registry,
    }),
    dealRegistry: registry,
    importGate: { async assertReady() {} },
    market: {
      async scanMarketWindow() {
        return imageMarketScan();
      },
    },
    reasoner: {
      async reason(input) {
        assert.deepEqual(input.deals.map(({ id }) => id), ["deal_image"]);
        assert.equal(input.memoryContexts[0]?.text.includes(structuredText), true);
        return [imageReasonedMatch(input.events[0]!.id)];
      },
    },
    xtrace: {
      async listOpenIngestJobs() {
        return [];
      },
      async pollIngestJob() {
        throw new Error("No pending jobs expected.");
      },
      async recallDealContext() {
        assert.fail(
          "Canonical image-only Deals must bypass XTrace recall.",
        );
      },
    },
    underwriting: {
      async createBatchAndSelections() {
        return {
          id: "batch_image_xtrace_fallback",
          workspaceId: "workspace_1",
          scanRunId: claimed.id,
          status: "completed",
          batchInputFingerprint: `sha256:${"2".repeat(64)}`,
          fundPolicySnapshotId: policy.id,
          rerunOfId: null,
          createdAt: NOW.toISOString(),
        };
      },
      async processCandidate() {
        throw new Error("The process-run seam owns automatic processing.");
      },
    },
    now: () => NOW,
  });

  const imageAnalysis = result.report.companyAnalyses[0];
  assert.equal(result.run.status, "partial");
  assert.equal(result.report.analysisStatus, "incomplete");
  assert.equal(imageAnalysis?.outcome, "belief_revised");
  assert.equal(result.report.opportunities[0]?.dealId, "deal_image");
  assert.deepEqual(imageAnalysis?.investmentMemory.memoryIds, []);
  assert.equal(result.report.evidenceCoverage.recalledDealCount, 0);
  assert.equal(result.report.evidenceCoverage.unavailableDealCount, 0);
  assert.equal(
    result.report.evidenceCoverage.structuredImageFallbackDealCount,
    1,
  );
  assert.ok(result.run.warnings.some((warning) =>
    /structured image evidence.*partial fallback/i.test(warning)
    && /intentionally bypassed/i.test(warning)
    && /not counted as XTrace recall/i.test(warning)
  ));
});

test("XTrace mode does not use structured-image fallback when a Deal has a non-image factual source", async () => {
  const { registry } = await imageOnlyDealRegistry({
    includeNonImageFact: true,
  });
  const runs = createRunsRepository(createMemoryDataClient({ now: () => NOW }));
  await runs.create({
    workspaceId: "workspace_1",
    mode: "xtrace",
    windowDays: 14,
  });
  const claimed = await runs.claimNext("worker_1");
  assert.ok(claimed);
  let recallCalls = 0;

  const result = await processClaimedRun(claimed, {
    runs,
    intelligence: createMemoryIntelligenceRepository({
      now: () => NOW,
      dealRegistry: registry,
    }),
    dealRegistry: registry,
    importGate: { async assertReady() {} },
    market: {
      async scanMarketWindow() {
        return imageMarketScan();
      },
    },
    reasoner: {
      async reason(input) {
        assert.deepEqual(input.deals.map(({ id }) => id), ["deal_image"]);
        assert.deepEqual(input.memoryContexts[0]?.sourceIds, [
          "source_image_registry_note",
        ]);
        return [];
      },
    },
    xtrace: {
      async listOpenIngestJobs() {
        return [];
      },
      async pollIngestJob() {
        throw new Error("No pending jobs expected.");
      },
      async recallDealContext(input) {
        recallCalls += 1;
        assert.deepEqual(input.candidateDealIds, ["deal_image"]);
        return [{
          dealId: "deal_image",
          memoryId: "memory_mixed_image",
          memoryType: "semantic",
          text: "Image Acme has a source-backed registry note.",
          score: 0.9,
          provenance: "source_document" as const,
          sourceIds: ["source_image_registry_note"],
          fixtureIds: [],
        }];
      },
    },
    underwriting: {
      async createBatchAndSelections() {
        return {
          id: "batch_mixed_image_xtrace",
          workspaceId: "workspace_1",
          scanRunId: claimed.id,
          status: "completed",
          batchInputFingerprint: `sha256:${"3".repeat(64)}`,
          fundPolicySnapshotId: policy.id,
          rerunOfId: null,
          createdAt: NOW.toISOString(),
        };
      },
      async processCandidate() {
        throw new Error("No candidate processing is expected.");
      },
    },
    now: () => NOW,
  });

  assert.equal(recallCalls, 1);
  assert.equal(result.run.status, "completed");
  assert.equal(result.report.evidenceCoverage.recalledDealCount, 1);
  assert.equal(
    result.report.evidenceCoverage.structuredImageFallbackDealCount,
    0,
  );
  assert.deepEqual(
    result.report.companyAnalyses[0]?.investmentMemory.memoryIds,
    ["memory_mixed_image"],
  );
  assert.ok(result.run.warnings.every((warning) =>
    !/structured image evidence.*partial fallback/i.test(warning)
  ));
});

test("keeps XTrace partial recall visible while underwriting receives every eligible Deal analysis", async () => {
  const { registry, sources } = await uploadedDealRegistry();
  await sources.createInitialRevision({
    id: "revision_seeded",
    workspaceId: "workspace_1",
    sourceId: "document_seeded",
    contentHash: `sha256:${"e".repeat(64)}`,
    objectKey: "private/seed/seeded-beta.md",
    objectVersion: "object:seeded-beta:v1",
    contentType: "text/markdown",
    extractorId: "plain_text_v1",
    extractorVersion: "1",
    extractedAt: "2026-07-29T10:02:00.000Z",
    createdAt: "2026-07-29T10:02:01.000Z",
  });
  await registry.confirmSourceAssignment({
    requestId: "confirm_seeded",
    workspaceId: "workspace_1",
    dealId: "deal_seeded",
    companyId: "company_seeded",
    companyName: "Seeded Beta",
    status: "watchlist",
    sourceRevisionId: "revision_seeded",
    assignedByUserId: "user_1",
    reason: "Seed fixture backfill confirmation.",
    confirmedAt: "2026-07-29T10:03:00.000Z",
    memoryBundle: {
      dealId: "deal_seeded",
      companyName: "Seeded Beta",
      status: "watchlist",
      facts: [{
        text: "Seeded Beta supports clinical operations.",
        sources: [{
          id: "source_seeded",
          provenance: "source_document",
          title: "Seeded Beta memo",
          documentId: "document_seeded",
          excerpt: "Seeded Beta supports clinical operations.",
        }],
      }],
      interactions: [],
    },
    memoryLineage: {
      evidence: {
        source_seeded: {
          workspaceId: "workspace_1",
          dealId: "deal_seeded",
          sourceId: "document_seeded",
          sourceRevisionId: "revision_seeded",
        },
      },
      interactions: {},
    },
  });
  const runs = createRunsRepository(createMemoryDataClient({
    now: () => NOW,
  }));
  await runs.create({
    workspaceId: "workspace_1",
    mode: "xtrace",
    windowDays: 14,
  });
  const claimed = await runs.claimNext("worker_1");
  assert.ok(claimed);
  let underwritingAnalyses: CompanyAnalysis[] = [];

  const result = await processClaimedRun(claimed, {
    runs,
    intelligence: createMemoryIntelligenceRepository({
      now: () => NOW,
      dealRegistry: registry,
    }),
    dealRegistry: registry,
    importGate: { async assertReady() {} },
    market: {
      async scanMarketWindow() {
        return {
          status: "completed" as const,
          window: {
            from: "2026-07-15T12:00:00.000Z",
            to: NOW.toISOString(),
            days: 14 as const,
          },
          providers: [],
          events: [],
        };
      },
    },
    reasoner: {
      async reason(input) {
        assert.deepEqual(
          input.deals.map(({ id }) => id),
          ["deal_uploaded"],
        );
        return [];
      },
    },
    xtrace: {
      async listOpenIngestJobs() {
        return [];
      },
      async pollIngestJob() {
        throw new Error("No pending jobs expected.");
      },
      async recallDealContext(input) {
        const dealId = input.candidateDealIds[0];
        if (dealId === "deal_seeded") {
          throw new Error("XTrace recall unavailable");
        }
        return [{
          dealId: "deal_uploaded",
          memoryId: "memory_uploaded",
          memoryType: "semantic" as const,
          text: "Uploaded Acme historical source context.",
          score: 0.9,
          provenance: "source_document" as const,
          sourceIds: ["source_uploaded"],
          fixtureIds: [],
        }];
      },
    },
    underwriting: {
      async createBatchAndSelections(input) {
        underwritingAnalyses = input.analyses;
        return {
          id: "batch_xtrace_partial",
          workspaceId: "workspace_1",
          scanRunId: claimed.id,
          status: "completed",
          batchInputFingerprint: `sha256:${"f".repeat(64)}`,
          fundPolicySnapshotId: policy.id,
          rerunOfId: null,
          createdAt: NOW.toISOString(),
        };
      },
      async processCandidate() {
        throw new Error("No candidates are selected in this fixture.");
      },
    },
    now: () => NOW,
  });

  assert.equal(result.run.status, "partial");
  assert.equal(result.report.companyAnalyses.length, 2);
  assert.equal(result.report.counts.analysisUnavailable, 1);
  assert.equal(
    result.report.evidenceCoverage.structuredImageFallbackDealCount,
    0,
  );
  assert.equal(underwritingAnalyses.length, 2);
  assert.equal(
    underwritingAnalyses.find(({ dealId }) => dealId === "deal_seeded")
      ?.outcome,
    "analysis_unavailable",
  );
  assert.ok(result.run.warnings.some((warning) =>
    /XTrace recall was unavailable for 1 Deal/i.test(warning)
  ));
});
