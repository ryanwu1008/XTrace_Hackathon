import { createHash } from "node:crypto";

import {
  createSupabaseDataClient,
  type RunRecord,
} from "../../db/client";
import {
  createSupabaseDealRegistry,
} from "../../db/repositories/deal-registry";
import {
  createSupabaseEvidencePacksRepository,
} from "../../db/repositories/evidence-packs";
import {
  createSupabaseIntelligenceRepository,
  type IntelligenceReportRecord,
} from "../../db/repositories/intelligence";
import {
  createSupabaseReasonerJudgmentsRepository,
} from "../../db/repositories/reasoner-judgments";
import { createRunsRepository } from "../../db/repositories/runs";
import {
  createSupabaseSourceRegistry,
} from "../../db/repositories/source-registry";
import {
  createSupabaseUnderwritingArtifactsRepository,
  type CandidateArtifactBundle,
} from "../../db/repositories/underwriting-artifacts";
import {
  createSupabaseUnderwritingReferencesRepository,
  type UnderwritingReferencesRepository,
} from "../../db/repositories/underwriting-references";
import {
  createSupabaseUnderwritingRunsRepository,
  type UnderwritingRunsRepository,
} from "../../db/repositories/underwriting-runs";
import {
  createSupabaseXTraceLineageRepository,
} from "../../db/repositories/xtrace-lineage";
import type { ClaudeClient, ClaudeCompleteInput } from "../../lib/claude/client";
import type { CompanyAnalysis } from "../../lib/contracts/domain";
import {
  APPROVED_PINNED_DEMO_SNAPSHOT_ID,
  CurrentReportEvidenceContextV1Schema,
  CurrentRunEvidenceContextV1Schema,
} from "../../lib/contracts/evidence-context";
import { canonicalEvidenceJson } from "../../lib/contracts/source-evidence";
import type {
  CandidateRun,
  UnderwritingBatch,
  UnderwritingSelection,
} from "../../lib/contracts/underwriting";
import {
  createProductInputGate,
} from "../../lib/corpus/import-readiness";
import type { DemoDataStore } from "../../lib/storage/service";
import { createClaudeMatchingReasoner } from "../../lib/matching/claude-reasoner";
import { createEvidencePackCandidateGrounding } from "../../lib/underwriting/candidate-grounding";
import { createEvidencePackBuilder } from "../../lib/underwriting/evidence/builder";
import {
  createCanonicalFingerprint,
  createReferenceCatalogSnapshot,
} from "../../lib/underwriting/fingerprints";
import {
  createContextAwareFrameworkLensResolver,
} from "../../lib/underwriting/frameworks/service";
import {
  createSourceGroundedCandidateExecutor,
  createUnderwritingOrchestrator,
} from "../../lib/underwriting/orchestrator";
import { createContextRouter } from "../../lib/underwriting/router";
import type {
  ExactXTraceParentUnit,
} from "../../lib/xtrace/exact-parent-planner";
import { createExactParentPlanner } from "../../lib/xtrace/exact-parent-planner";
import type {
  XTraceClient,
  XTraceIngestRequest,
  XTraceJob,
  XTraceSearchResponse,
} from "../../lib/xtrace/client";
import { createXTraceService } from "../../lib/xtrace/service";
import { DECISION_POLICY_V1 } from "../../lib/underwriting/decision/rules";
import { SYNTHETIC_FRAMEWORK_PACK } from "../../seed/underwriting/framework-pack-v1";
import {
  SLICE_ONE_CONTEXTS,
  SYNTHETIC_US_SOFTWARE_BENCHMARK_PACK_ID,
} from "../../seed/underwriting/slice-one-contexts-v1";
import {
  runExactXTraceIngestStage,
  type ExactParentIngestResult,
} from "../../worker/ingest-exact-xtrace-parents";
import { processClaimedRun } from "../../worker/process-run";
import { assertDisposableDatabaseName } from "./require-loopback-postgres";

type Sha256 = `sha256:${string}`;

const EXPECTED_CASES = [
  {
    dealId: "deal_henry_ai_v1",
    companyName: "Henry AI",
    status: "passed",
    direction: "positive",
    eventId: "event_henry_series_a_v1",
    triggerSourceId: "claim_henry_series_a_v1",
    triggerSourceRevisionId: "source_revision_source_henry_series_a_v1_1",
    implicationSourceId: "claim_henry_workflow_v1",
    counterSourceId: "claim_henry_terms_v1",
    actions: ["reopen_diligence"],
    scoreInputs: {
      eventRelevance: 0.9,
      dealRelevance: 0.9,
      priorContextStrength: 0.92,
      evidenceQuality: 0.94,
    },
  },
  {
    dealId: "deal_smallest_ai_v1",
    companyName: "Smallest.ai",
    status: "watchlist",
    direction: "positive",
    eventId: "event_smallest_series_a_v1",
    triggerSourceId: "claim_smallest_series_a_v1",
    triggerSourceRevisionId:
      "source_revision_source_smallest_official_series_a_v1_1",
    implicationSourceId: "claim_smallest_customers_v1",
    counterSourceId: "claim_smallest_founded_2023_v1",
    actions: ["advance_diligence"],
    scoreInputs: {
      eventRelevance: 0.86,
      dealRelevance: 0.84,
      priorContextStrength: 0.88,
      evidenceQuality: 0.82,
    },
  },
  {
    dealId: "deal_hush_security_v1",
    companyName: "Hush Security",
    status: "invested",
    direction: "positive",
    eventId: "event_hush_series_a_v1",
    triggerSourceId: "claim_hush_series_a_v1",
    triggerSourceRevisionId: "source_revision_source_hush_series_a_v1_1",
    implicationSourceId: "claim_hush_kyndryl_v1",
    counterSourceId: "claim_hush_controls_limit_v1",
    actions: ["evaluate_follow_on"],
    scoreInputs: {
      eventRelevance: 0.91,
      dealRelevance: 0.9,
      priorContextStrength: 0.94,
      evidenceQuality: 0.9,
    },
  },
  {
    dealId: "deal_irregular_v1",
    companyName: "Irregular",
    status: "invested",
    direction: "negative",
    eventId: "event_irregular_incidents_v1",
    triggerSourceId: "claim_irregular_real_systems_v1",
    triggerSourceRevisionId:
      "source_revision_source_irregular_anthropic_incident_v1_1",
    implicationSourceId: "claim_irregular_real_systems_v1",
    counterSourceId: "claim_irregular_harness_v1",
    actions: ["pause_follow_on", "portfolio_risk_review"],
    scoreInputs: {
      eventRelevance: 1,
      dealRelevance: 1,
      priorContextStrength: 0.98,
      evidenceQuality: 0.98,
    },
  },
] as const;

type ExpectedCase = typeof EXPECTED_CASES[number];

type SerializedSource = {
  id?: unknown;
  evidenceRole?: unknown;
  factEligible?: unknown;
  normalizedStatement?: unknown;
  verbatimExcerpt?: unknown;
};

type ExactProviderParent = {
  dealId: string;
  companyName: string;
  sourceRevisionId: string;
  jobId: string;
  memoryId: string;
  text: string;
};

export interface BeliefReversalProviderInspection {
  xtrace: {
    ingestCalls: number;
    searchCalls: number;
    deleteCalls: number;
    exactParentCount: number;
    memoryCount: number;
  };
  claude: {
    matchingCalls: number;
    frameworkCalls: number;
    unexpectedCalls: number;
  };
}

export interface BeliefReversalDeterministicProviders {
  xtraceClient: XTraceClient;
  claudeClient: ClaudeClient;
  primeExactParents(parents: readonly ExactXTraceParentUnit[]): void;
  inspect(): BeliefReversalProviderInspection;
}

/**
 * A deterministic local provider boundary. It performs no I/O and returns only
 * provider-level observations: exact XTrace memory children, matching claims
 * plus primitive scores, and independent framework-lens judgments. Production
 * code remains responsible for scoring, confidence, gates, actions, ranking,
 * valuation, decisions, and persistence.
 */
export function createBeliefReversalDeterministicProviders():
  BeliefReversalDeterministicProviders {
  const parentsByMemoryId = new Map<string, ExactProviderParent>();
  const parentsByJobId = new Map<string, ExactProviderParent>();
  let ingestCalls = 0;
  let searchCalls = 0;
  let deleteCalls = 0;
  let matchingCalls = 0;
  let frameworkCalls = 0;
  let unexpectedCalls = 0;

  const rememberParent = (input: {
    dealId: string;
    companyName: string;
    sourceRevisionId: string;
    text: string;
  }): ExactProviderParent => {
    const digest = createHash("sha256")
      .update(
        canonicalEvidenceJson({
          dealId: input.dealId,
          sourceRevisionId: input.sourceRevisionId,
        }),
        "utf8",
      )
      .digest("hex");
    const parent = {
      ...input,
      jobId: `e2e_xtrace_job_${digest}`,
      memoryId: `e2e_xtrace_memory_${digest}`,
    };
    const existing = parentsByMemoryId.get(parent.memoryId);
    if (existing && canonicalEvidenceJson(existing) !== canonicalEvidenceJson(parent)) {
      throw new Error("Deterministic XTrace parent identity collision.");
    }
    parentsByMemoryId.set(parent.memoryId, parent);
    parentsByJobId.set(parent.jobId, parent);
    return parent;
  };

  const terminalJob = (parent: ExactProviderParent): XTraceJob => ({
    id: parent.jobId,
    status: "succeeded",
    result: {
      memories_created: [{
        id: parent.memoryId,
        type: "fact",
        text: parent.text,
      }],
    },
  });

  const xtraceClient: XTraceClient = {
    async ingest(input: XTraceIngestRequest): Promise<XTraceJob> {
      ingestCalls += 1;
      const content = input.messages.length === 1
        ? input.messages[0]?.content
        : undefined;
      if (typeof content !== "string") {
        throw new Error("E2E XTrace accepts one exact-parent payload only.");
      }
      const payload = parseRecord(content, "E2E XTrace exact-parent payload");
      const retrieval = requireRecord(
        payload.retrievalPayload,
        "E2E XTrace retrieval payload",
      );
      const parentIdentity = requireRecord(
        payload.parent,
        "E2E XTrace parent identity",
      );
      if (
        payload.schemaVersion !== "xtrace-parent-v2"
        || typeof payload.dealId !== "string"
        || retrieval.dealId !== payload.dealId
        || typeof retrieval.companyName !== "string"
        || typeof parentIdentity.sourceRevisionId !== "string"
      ) {
        throw new Error("E2E XTrace rejected a non-exact parent payload.");
      }
      return terminalJob(rememberParent({
        dealId: payload.dealId,
        companyName: retrieval.companyName,
        sourceRevisionId: parentIdentity.sourceRevisionId,
        text: content,
      }));
    },
    async getJob(jobId): Promise<XTraceJob> {
      const parent = parentsByJobId.get(jobId);
      if (!parent) throw new Error("E2E XTrace cannot poll an unknown job.");
      return terminalJob(parent);
    },
    async search(input): Promise<XTraceSearchResponse> {
      searchCalls += 1;
      const normalizedQuery = input.query.toLocaleLowerCase();
      const matchingDealIds = new Set(
        [...parentsByMemoryId.values()]
          .filter(({ companyName }) =>
            normalizedQuery === companyName.toLocaleLowerCase()
            || normalizedQuery.startsWith(
              `${companyName.toLocaleLowerCase()} · `,
            )
          )
          .map(({ dealId }) => dealId),
      );
      if (matchingDealIds.size !== 1) {
        throw new Error("E2E XTrace recall must resolve exactly one Deal query.");
      }
      const [dealId] = matchingDealIds;
      const data = [...parentsByMemoryId.values()]
        .filter((parent) => parent.dealId === dealId)
        .sort((left, right) => compareUtf8(left.memoryId, right.memoryId))
        .slice(0, input.limit)
        .map((parent, index) => ({
          id: parent.memoryId,
          type: "fact",
          text: parent.text,
          score: Number((0.99 - index * 0.001).toFixed(4)),
        }));
      return {
        success: true,
        data,
        count: data.length,
      };
    },
    async deleteMemory(): Promise<void> {
      deleteCalls += 1;
      throw new Error("E2E XTrace memory deletion is forbidden.");
    },
  };

  const claudeClient: ClaudeClient = {
    async complete(input: ClaudeCompleteInput): Promise<string> {
      if (input.system.includes("venture-capital research analyst")) {
        matchingCalls += 1;
        try {
          return JSON.stringify(buildMatchingObservations(input));
        } catch (error) {
          if (process.env.REQUIRE_BELIEF_REVERSAL_E2E === "1") {
            console.error(
              `[task12-matching] ${error instanceof Error ? error.message : "unknown deterministic fixture failure"}`,
            );
          }
          throw error;
        }
      }
      if (input.system.includes("framework lens")) {
        frameworkCalls += 1;
        return JSON.stringify(buildFrameworkObservation(input));
      }
      unexpectedCalls += 1;
      throw new Error("E2E Claude rejected an unexpected task.");
    },
  };

  return {
    xtraceClient,
    claudeClient,
    primeExactParents(parents) {
      for (const parent of parents) {
        rememberParent({
          dealId: parent.dealId,
          companyName: parent.bundle.companyName,
          sourceRevisionId: parent.sourceRevisionId,
          text: JSON.stringify({
            schemaVersion: "xtrace-parent-v2",
            workspaceId: parent.workspaceId,
            dealId: parent.dealId,
            parent: {
              kind: parent.parentKind,
              sourceId: parent.sourceId,
              sourceRevisionId: parent.sourceRevisionId,
              fingerprint: parent.parentFingerprint,
            },
            retrievalPayload: parent.bundle,
          }),
        });
      }
    },
    inspect() {
      return {
        xtrace: {
          ingestCalls,
          searchCalls,
          deleteCalls,
          exactParentCount: parentsByMemoryId.size,
          memoryCount: parentsByMemoryId.size,
        },
        claude: {
          matchingCalls,
          frameworkCalls,
          unexpectedCalls,
        },
      };
    },
  };
}

export interface BeliefReversalPinnedPipelineTarget {
  databaseName: string;
  postgresVersion: "17.6";
  postgrestUrl: string;
  postgrestVersion: "12.2.3";
  serviceRoleKey: string;
}

export interface BeliefReversalReplayPersistentCounts {
  reasonerJudgments: number;
  xtraceIngestIntents: number;
  xtraceMemoryLinks: number;
}

export interface BeliefReversalReplayDeltas {
  before: BeliefReversalReplayPersistentCounts;
  after: BeliefReversalReplayPersistentCounts;
  delta: BeliefReversalReplayPersistentCounts;
}

export interface BeliefReversalPipelineCaseResult {
  priorityRank: number;
  /** @deprecated Pinned QA compatibility only. */
  rank: number;
  dealId: string;
  companyName: string;
  dealStatus: CompanyAnalysis["dealStatus"];
  outcome: CompanyAnalysis["outcome"];
  confidence: CompanyAnalysis["confidence"];
  score: number;
  direction: NonNullable<CompanyAnalysis["beliefAssessment"]>["direction"];
  actions: string[];
  gates: {
    chronology: boolean;
    revisitConditionMapping: boolean;
    counterevidence: boolean;
    actionDelta: boolean;
    allPassed: boolean;
  };
  candidateRunId: string;
  candidateStatus: CandidateRun["status"];
  artifactCandidateRunId: string;
  valuationStatus: CandidateArtifactBundle["valuation"]["status"];
  formalDecision: CandidateArtifactBundle["decision"]["decision"];
}

export interface BeliefReversalPipelinePass {
  run: RunRecord;
  report: IntelligenceReportRecord;
  batch: UnderwritingBatch;
  selections: UnderwritingSelection[];
  candidates: CandidateRun[];
  artifacts: CandidateArtifactBundle[];
  cases: BeliefReversalPipelineCaseResult[];
  semanticFingerprint: Sha256;
}

export interface CurrentBeliefReversalColdPassLike {
  report: {
    id: string;
    workspaceId: string;
    runId: string;
    counts: {
      companyCount: number;
      beliefRevised: number;
      monitor: number;
      noMaterialChange: number;
      analysisUnavailable: number;
    };
    companyAnalyses: Array<{
      dealId: string;
      dealStatus: string;
      outcome: string;
      score: number;
      currentRunAudit?: {
        schemaVersion: string;
        workspaceId: string;
        stableDealId: string;
        priorDealStatus: string;
        dealUniverseId: string;
        dealUniverseFingerprint: string;
        evidenceContextFingerprint: string;
        evidenceBindingFingerprint: string;
        priorMemory: { kind: string };
        outcome: string;
      };
    }>;
    evidenceContext: unknown;
  };
  batch: {
    id: string;
    workspaceId: string;
    scanRunId: string;
    status: string;
  };
  selections: Array<{
    batchId: string;
    dealId: string;
    status: string;
    rank: number | null;
  }>;
  candidates: Array<{
    id: string;
    workspaceId: string;
    batchId: string;
    dealId: string;
    status: string;
  }>;
  artifacts: Array<{
    candidateRunId: string;
    workspaceId: string;
    dealId: string;
  }>;
}

/**
 * Outcome distributions depend on the run's evidence window, so they are
 * derived rather than pinned. A fixed distribution rots the moment a fixture
 * event ages past the window. What stays true on any date is which Deals are
 * even capable of a belief revision, and that no screening Deal is.
 */
export interface CurrentColdExpectedOutcomes {
  beliefRevisionCapableDealIds: readonly string[];
}

const CURRENT_SCREENING_DEAL_IDS = new Set([
  "deal_centralize_v1",
  "deal_chipagents_v1",
  "deal_sent_v1",
  "deal_cascade_v1",
  "deal_cordant_v1",
  "deal_empirical_security_v1",
  "deal_freight_hero_v1",
]);

/**
 * Fail-closed acceptance invariant for the current cold Scan. This validates
 * product cardinality and persisted authority only; the semantic-quality
 * helper separately validates the complete Deep Underwriting contents.
 */
export function assertCurrentBeliefReversalColdPass(
  input: CurrentBeliefReversalColdPassLike,
  expected?: CurrentColdExpectedOutcomes,
): void {
  const { report, batch } = input;
  const evidenceContext = requireRecord(
    report.evidenceContext,
    "current cold report evidence context",
  );
  if (
    evidenceContext.state !== "current"
    || evidenceContext.evidenceMode !== "live"
  ) {
    throw new Error("Current cold acceptance requires a live evidence context.");
  }
  if (report.companyAnalyses.length !== 30) {
    throw new Error("Current cold acceptance requires exactly 30 CompanyAnalyses.");
  }
  const analysesByDeal = new Map(
    report.companyAnalyses.map((analysis) => [analysis.dealId, analysis]),
  );
  if (analysesByDeal.size !== 30) {
    throw new Error("Current cold acceptance requires 30 unique Deal analyses.");
  }
  const derivedCounts = {
    companyCount: report.companyAnalyses.length,
    beliefRevised: report.companyAnalyses.filter(
      ({ outcome }) => outcome === "belief_revised",
    ).length,
    monitor: report.companyAnalyses.filter(({ outcome }) => outcome === "monitor")
      .length,
    noMaterialChange: report.companyAnalyses.filter(
      ({ outcome }) => outcome === "no_material_change",
    ).length,
    analysisUnavailable: report.companyAnalyses.filter(
      ({ outcome }) => outcome === "analysis_unavailable",
    ).length,
  };
  if (
    derivedCounts.beliefRevised
      + derivedCounts.monitor
      + derivedCounts.noMaterialChange
      + derivedCounts.analysisUnavailable !== 30
    || report.counts.companyCount !== derivedCounts.companyCount
    || report.counts.beliefRevised !== derivedCounts.beliefRevised
    || report.counts.monitor !== derivedCounts.monitor
    || report.counts.noMaterialChange !== derivedCounts.noMaterialChange
    || report.counts.analysisUnavailable !== derivedCounts.analysisUnavailable
  ) {
    throw new Error(
      "Current cold acceptance requires report counts derived from exactly 30 CompanyAnalysis outcomes.",
    );
  }
  const revisedDealIds = report.companyAnalyses
    .filter(({ outcome }) => outcome === "belief_revised")
    .map(({ dealId }) => dealId)
    .sort();
  const screeningRevised = revisedDealIds.filter((dealId) =>
    CURRENT_SCREENING_DEAL_IDS.has(dealId)
  );
  if (screeningRevised.length > 0) {
    throw new Error(
      `Current cold acceptance found screening Deals admitted as belief_revised: ${screeningRevised.join(",")}.`,
    );
  }
  if (expected) {
    const capable = new Set(expected.beliefRevisionCapableDealIds);
    const unexpected = revisedDealIds.filter((dealId) => !capable.has(dealId));
    if (unexpected.length > 0) {
      throw new Error(
        `Current cold acceptance admitted belief revisions outside the reviewed case set: ${unexpected.join(",")}.`,
      );
    }
  }
  const sharedUniverse = new Set<string>();
  for (const analysis of report.companyAnalyses) {
    const audit = analysis.currentRunAudit;
    if (
      !audit
      || audit.schemaVersion !== "company-analysis-current-run-audit-v1"
      || audit.workspaceId !== report.workspaceId
      || audit.stableDealId !== analysis.dealId
      || audit.priorDealStatus !== analysis.dealStatus
      || audit.outcome !== analysis.outcome
      || audit.evidenceContextFingerprint !== evidenceContext.contextFingerprint
      || audit.evidenceBindingFingerprint !== evidenceContext.bindingFingerprint
    ) {
      throw new Error(
        `Current cold CompanyAnalysis authority is incomplete for ${analysis.dealId}.`,
      );
    }
    sharedUniverse.add(
      canonicalEvidenceJson({
        id: audit.dealUniverseId,
        fingerprint: audit.dealUniverseFingerprint,
      }),
    );
  }
  if (sharedUniverse.size !== 1) {
    throw new Error("Current cold analyses do not share one immutable Deal universe.");
  }
  const screening = report.companyAnalyses.filter(({ dealId }) =>
    CURRENT_SCREENING_DEAL_IDS.has(dealId)
  );
  if (
    screening.length !== CURRENT_SCREENING_DEAL_IDS.size
    || screening.some((analysis) =>
      analysis.dealStatus !== "screening"
      || analysis.currentRunAudit?.priorMemory.kind !== "screening"
    )
  ) {
    throw new Error(
      "Current cold acceptance requires seven screening prior-context analyses.",
    );
  }
  const beliefRevised = report.companyAnalyses
    .filter(({ outcome }) => outcome === "belief_revised")
    .sort((left, right) =>
      right.score - left.score || compareUtf8(left.dealId, right.dealId)
    );
  const candidateDeals = input.candidates.map(({ dealId }) => dealId).sort(compareUtf8);
  const expectedDeals = beliefRevised.map(({ dealId }) => dealId).sort(compareUtf8);
  const selected = input.selections
    .filter(({ status }) => status === "selected")
    .sort((left, right) => (left.rank ?? 0) - (right.rank ?? 0));
  if (
    canonicalEvidenceJson(candidateDeals) !== canonicalEvidenceJson(expectedDeals)
    || canonicalEvidenceJson(selected.map(({ dealId }) => dealId).sort(compareUtf8))
      !== canonicalEvidenceJson(expectedDeals)
    || selected.some((selection, index) =>
      selection.batchId !== batch.id
      || selection.rank !== index + 1
      || selection.dealId !== beliefRevised[index]?.dealId
    )
  ) {
    throw new Error(
      "Current cold acceptance requires every and only belief-revised Deal in Deep Underwriting.",
    );
  }
  if (
    batch.workspaceId !== report.workspaceId
    || batch.scanRunId !== report.runId
    || batch.status !== "completed"
    || new Set(input.candidates.map(({ id }) => id)).size !== input.candidates.length
    || input.candidates.some((candidate) =>
      candidate.workspaceId !== report.workspaceId
      || candidate.batchId !== batch.id
      || !["completed", "partial", "failed"].includes(candidate.status)
    )
  ) {
    throw new Error("Current cold Deep Underwriting jobs are not terminal and scoped.");
  }
  const artifactByCandidate = new Map(
    input.artifacts.map((artifact) => [artifact.candidateRunId, artifact]),
  );
  if (
    artifactByCandidate.size !== input.candidates.length
    || input.candidates.some((candidate) => {
      const artifact = artifactByCandidate.get(candidate.id);
      return !artifact
        || artifact.workspaceId !== report.workspaceId
        || artifact.dealId !== candidate.dealId;
    })
  ) {
    throw new Error("Current cold terminal jobs are missing exact artifacts.");
  }
}

export interface BeliefReversalPinnedPipelineResult {
  exactIngest: {
    parentCount: 85;
    first: ExactParentIngestResult[];
    replay: ExactParentIngestResult[];
  };
  first: BeliefReversalPipelinePass;
  replay: BeliefReversalPipelinePass;
  providersAfterFirst: BeliefReversalProviderInspection;
  providersAfterReplay: BeliefReversalProviderInspection;
  replayDeltas: BeliefReversalReplayDeltas;
  liveMarketCalls: 0;
  readProviderInspection(): BeliefReversalProviderInspection;
  readLiveMarketCalls(): number;
}

export interface BeliefReversalIsolationPersistentCounts {
  scanRuns: number;
  scanRunSteps: number;
  sourceRevisions: number;
  sampleInteractions: number;
  reasonerJudgments: number;
  xtraceIngestIntents: number;
  xtraceMemoryLinks: number;
  rateLimitRequests: number;
}

export interface BeliefReversalProcessRuntime {
  parents: ExactXTraceParentUnit[];
  providers: BeliefReversalDeterministicProviders;
  runs: ReturnType<typeof createRunsRepository>;
  underwritingRuns: UnderwritingRunsRepository;
  underwritingArtifacts: ReturnType<
    typeof createSupabaseUnderwritingArtifactsRepository
  >;
  processDependencies: Parameters<typeof processClaimedRun>[1];
}

/**
 * Builds the same production repository/orchestrator boundary used by the
 * pinned proof without creating or claiming a scan. A separate fixture Worker
 * process uses this runtime so the browser must enqueue the acceptance run.
 */
export async function createBeliefReversalProcessRuntime(input: {
  target: BeliefReversalPinnedPipelineTarget;
  workspaceId: string;
  dataStore: Pick<DemoDataStore, "listWorkspaceDocumentIds">;
  market: Parameters<typeof processClaimedRun>[1]["market"];
  fetchImpl?: typeof fetch;
  now?: () => Date;
}): Promise<BeliefReversalProcessRuntime> {
  assertPipelineTarget(input.target);
  const workspaceId = requiredText(input.workspaceId, "E2E workspace");
  const common = {
    url: input.target.postgrestUrl,
    serviceRoleKey: input.target.serviceRoleKey,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  };
  const now = input.now ?? (() => new Date());
  const sourceRegistry = createSupabaseSourceRegistry(common);
  const dealRegistry = createSupabaseDealRegistry(common);
  const evidencePacks = createSupabaseEvidencePacksRepository(common);
  const intelligence = createSupabaseIntelligenceRepository({
    ...common,
    now,
    dealRegistry,
  });
  const runs = createRunsRepository(createSupabaseDataClient(common));
  const references = createSupabaseUnderwritingReferencesRepository(common);
  const underwritingRuns = createSupabaseUnderwritingRunsRepository(common);
  const underwritingArtifacts =
    createSupabaseUnderwritingArtifactsRepository(common);
  const judgments = createSupabaseReasonerJudgmentsRepository(common);
  const lineage = createSupabaseXTraceLineageRepository({
    ...common,
    sleep: async () => {},
    waitAttempts: 1,
  });
  const providers = createBeliefReversalDeterministicProviders();
  const planner = createExactParentPlanner({ dealRegistry, sourceRegistry });

  await createProductInputGate(input.dataStore).assertReady(workspaceId);
  const parents = await planner.plan(workspaceId);
  assertExactParentMatrix(parents);
  // Provider state is process-local while exact lineage is durable. Priming
  // reconstructs the deterministic provider view for a fresh fixture Worker;
  // it does not create, mutate, or delete any PostgreSQL/XTrace lineage row.
  providers.primeExactParents(parents);
  const xtraceService = createXTraceService(providers.xtraceClient, {
    workspaceId,
    lineageRepository: lineage,
    limiter: { async acquire(): Promise<void> {} },
  });

  const referenceCatalog = await buildReferenceCatalog({
    references,
    asOfDate: now().toISOString().slice(0, 10),
  });
  const criticalEvidenceProfiles = (
    await Promise.all(SLICE_ONE_CONTEXTS.map(({ criticalEvidenceProfileId }) =>
      references.getCriticalEvidenceProfile(criticalEvidenceProfileId)
    ))
  ).filter((profile) => profile !== null);
  const router = createContextRouter();
  const grounding = createEvidencePackCandidateGrounding({
    repository: evidencePacks,
    sourceRegistry,
    criticalEvidenceProfiles,
    builder: createEvidencePackBuilder({
      repository: evidencePacks,
      sourceRegistry,
      router,
      criticalEvidenceProfiles,
      now,
    }),
    xtraceLineage: lineage,
    resolveBenchmark: (context) => context.benchmarkPackId
      ? references.getSelectedBenchmark({
          packId: context.benchmarkPackId,
          stage: context.stage,
          asOfDate: context.asOfDate,
        })
      : Promise.resolve(null),
  });
  const frameworkLenses = createContextAwareFrameworkLensResolver({
    client: providers.claudeClient,
    execution: {
      provider: "deterministic-e2e-observer",
      model: "deterministic-e2e-observer-v1",
      promptVersion: "framework-lens-v1",
      schemaVersion: "framework-judgment-v1",
      settingsFingerprint: "belief-reversal-task12-v1",
      applicationCommit: "task12-local-e2e",
    },
  });
  const underwriting = createUnderwritingOrchestrator({
    runs: underwritingRuns,
    activeFundPolicy: (requestedWorkspaceId) =>
      references.activeFundPolicy(requestedWorkspaceId),
    candidateExecutionFingerprint:
      "source-grounded-v3:context-router-v2:semantic-context-v1:deterministic-e2e-observer-v1",
    referenceCatalog,
    candidateExecutor: createSourceGroundedCandidateExecutor({
      grounding,
      resolveFrameworkLenses: (context, signal) =>
        frameworkLenses.resolve(context, signal),
      router,
      now,
      execution: {
        providerModel: "deterministic-e2e-observer-v1",
        promptVersion: "framework-lens-v1",
        schemaVersion: "framework-judgment-v1",
        settingsFingerprint: "belief-reversal-task12-v1",
        applicationCommit: "task12-local-e2e",
      },
    }),
    now,
  });

  return {
    parents,
    providers,
    runs,
    underwritingRuns,
    underwritingArtifacts,
    processDependencies: {
      runs,
      intelligence,
      dealRegistry,
      underwriting,
      importGate: createProductInputGate(input.dataStore),
      market: input.market,
      reasoner: createClaudeMatchingReasoner(providers.claudeClient, {
        judgments,
      }),
      xtrace: {
        listOpenIngestJobs: (requestedWorkspaceId: string) =>
          lineage.listOpenJobs(requestedWorkspaceId),
        pollIngestJob: (jobId: string, options: { dealId: string }) =>
          xtraceService.pollIngestJob(jobId, options),
        recallDealContext: xtraceService.recallDealContext,
      },
      now,
    },
  };
}

export async function readBeliefReversalPipelinePass(input: {
  target: BeliefReversalPinnedPipelineTarget;
  workspaceId: string;
  runId: string;
  fetchImpl?: typeof fetch;
  expectedCurrentOutcomes?: CurrentColdExpectedOutcomes;
}): Promise<BeliefReversalPipelinePass> {
  assertPipelineTarget(input.target);
  const workspaceId = requiredText(input.workspaceId, "E2E workspace");
  const runId = requiredText(input.runId, "E2E run");
  const common = {
    url: input.target.postgrestUrl,
    serviceRoleKey: input.target.serviceRoleKey,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  };
  const runs = createRunsRepository(createSupabaseDataClient(common));
  const intelligence = createSupabaseIntelligenceRepository({
    ...common,
    dealRegistry: createSupabaseDealRegistry(common),
  });
  const underwritingRuns = createSupabaseUnderwritingRunsRepository(common);
  const underwritingArtifacts =
    createSupabaseUnderwritingArtifactsRepository(common);
  const [run, report, batch] = await Promise.all([
    runs.get(workspaceId, runId),
    intelligence.getReport(workspaceId, `report_${runId}`),
    underwritingRuns.getBatchByScanRunId({
      workspaceId,
      scanRunId: runId,
    }),
  ]);
  if (!run || !report || !batch) {
    throw new Error("Cold Scan did not persist a complete run/report/batch identity.");
  }
  if (run.status !== "completed") {
    throw new Error(`Cold Scan ended ${run.status} instead of completed.`);
  }
  const [selections, candidates] = await Promise.all([
    underwritingRuns.listSelectionsForBatch({ workspaceId, batchId: batch.id }),
    underwritingRuns.listCandidatesForBatch({ workspaceId, batchId: batch.id }),
  ]);
  const artifacts = await Promise.all(candidates.map(async (candidate) => {
    const artifact = await underwritingArtifacts.getByCandidateRunId({
      workspaceId,
      candidateRunId: candidate.id,
    });
    if (!artifact) {
      throw new Error(
        `Cold Scan candidate ${candidate.dealId} has no finalized artifact.`,
      );
    }
    return artifact;
  }));
  const cases = validateQualifiedCases({
    report,
    batch,
    selections,
    candidates,
    artifacts,
  });
  const reportEvidenceContext = CurrentReportEvidenceContextV1Schema.parse(
    report.evidenceContext,
  );
  if (reportEvidenceContext.evidenceMode === "live") {
    assertCurrentBeliefReversalColdPass({
      report: {
        ...report,
        evidenceContext: reportEvidenceContext,
      },
      batch,
      selections,
      candidates,
      artifacts,
    }, input.expectedCurrentOutcomes);
  } else if (report.companyAnalyses.length !== 23) {
    throw new Error(
      "The approved pinned replay must preserve exactly 23 CompanyAnalyses.",
    );
  }
  return {
    run,
    report,
    batch,
    selections,
    candidates,
    artifacts,
    cases,
    semanticFingerprint: semanticFingerprint(cases),
  };
}

export async function runBeliefReversalCurrentColdPass(input: {
  target: BeliefReversalPinnedPipelineTarget;
  workspaceId: string;
  runtime: BeliefReversalProcessRuntime;
  workerId?: string;
  fetchImpl?: typeof fetch;
  expectedCurrentOutcomes?: CurrentColdExpectedOutcomes;
}): Promise<BeliefReversalPipelinePass> {
  const workspaceId = requiredText(input.workspaceId, "current cold workspace");
  const queued = await input.runtime.runs.create({
    workspaceId,
    mode: "xtrace",
    windowDays: 14,
    evidenceRequest: {
      schemaVersion: "run-evidence-request-v1",
      evidenceMode: "live",
    },
  });
  const before = await input.runtime.processDependencies.intelligence.getReport(
    workspaceId,
    `report_${queued.id}`,
  );
  if (before !== null) {
    throw new Error("Current cold acceptance found a pre-generated report before claim.");
  }
  const claimed = await input.runtime.runs.claimNext(
    input.workerId ?? "belief-reversal-current-cold-e2e",
  );
  if (!claimed || claimed.id !== queued.id) {
    throw new Error("Current cold acceptance did not claim the exact queued run.");
  }
  const processed = await processClaimedRun(
    claimed,
    input.runtime.processDependencies,
  );
  if (processed.run.status !== "completed") {
    throw new Error(
      `Current cold Scan ended ${processed.run.status}: ${processed.run.warnings.join(" | ")}`,
    );
  }
  return readBeliefReversalPipelinePass({
    target: input.target,
    workspaceId,
    runId: processed.run.id,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    ...(input.expectedCurrentOutcomes
      ? { expectedCurrentOutcomes: input.expectedCurrentOutcomes }
      : {}),
  });
}

export function assertBeliefReversalReplayEvidenceIdentity(
  first: {
    run: { id: string; workspaceId: string; evidenceContext: unknown };
    report: { evidenceContext?: unknown };
  },
  replay: {
    run: { id: string; workspaceId: string; evidenceContext: unknown };
    report: { evidenceContext?: unknown };
  },
): void {
  const firstRun = CurrentRunEvidenceContextV1Schema.parse(
    first.run.evidenceContext,
  );
  const replayRun = CurrentRunEvidenceContextV1Schema.parse(
    replay.run.evidenceContext,
  );
  const firstReport = CurrentReportEvidenceContextV1Schema.parse(
    first.report.evidenceContext,
  );
  const replayReport = CurrentReportEvidenceContextV1Schema.parse(
    replay.report.evidenceContext,
  );
  const contextIdentity = (
    context: typeof firstRun | typeof firstReport,
  ) => ({
    state: context.state,
    schemaVersion: context.schemaVersion,
    evidenceMode: context.evidenceMode,
    windowDays: context.windowDays,
    anchorAt: context.anchorAt,
    windowStartAt: context.windowStartAt,
    windowEndAt: context.windowEndAt,
    windowTimezone: context.windowTimezone,
    snapshotId: context.snapshotId,
    snapshotFingerprint: context.snapshotFingerprint,
    contextFingerprint: context.contextFingerprint,
  });
  const sharedIdentity = (
    run: typeof firstRun,
    report: typeof firstReport,
  ) => ({
    evidenceMode: run.evidenceMode,
    windowDays: run.windowDays,
    anchorAt: run.anchorAt,
    windowStartAt: run.windowStartAt,
    windowEndAt: run.windowEndAt,
    windowTimezone: run.windowTimezone,
    snapshotId: run.snapshotId,
    snapshotFingerprint: run.snapshotFingerprint,
    contextFingerprint: run.contextFingerprint,
    reportSnapshotId: report.snapshotId,
    reportSnapshotFingerprint: report.snapshotFingerprint,
    reportContextFingerprint: report.contextFingerprint,
    displayLabel: report.displayLabel,
    eventCount: report.eventCount,
    eventSetFingerprint: report.eventSetFingerprint,
  });
  const firstIdentity = sharedIdentity(firstRun, firstReport);
  const replayIdentity = sharedIdentity(replayRun, replayReport);
  const expectedBindingFingerprint = (input: {
    workspaceId: string;
    runId: string;
    contextFingerprint: string;
    eventSetFingerprint: string;
    eventCount: number;
  }) => {
    const hash = createHash("sha256");
    for (const frame of [
      "run-evidence-binding-v1",
      input.workspaceId,
      input.runId,
      input.contextFingerprint,
      input.eventSetFingerprint,
      String(input.eventCount),
    ]) {
      const bytes = Buffer.from(frame, "utf8");
      hash.update(`${bytes.length}:`);
      hash.update(bytes);
    }
    return `sha256:${hash.digest("hex")}`;
  };
  if (
    firstRun.evidenceMode !== "pinned"
    || replayRun.evidenceMode !== "pinned"
    || firstReport.evidenceMode !== "pinned"
    || replayReport.evidenceMode !== "pinned"
    || canonicalEvidenceJson(contextIdentity(firstRun))
      !== canonicalEvidenceJson(contextIdentity(firstReport))
    || canonicalEvidenceJson(contextIdentity(replayRun))
      !== canonicalEvidenceJson(contextIdentity(replayReport))
    || firstIdentity.snapshotId !== firstIdentity.reportSnapshotId
    || firstIdentity.snapshotFingerprint
      !== firstIdentity.reportSnapshotFingerprint
    || firstIdentity.contextFingerprint !== firstIdentity.reportContextFingerprint
    || replayIdentity.snapshotId !== replayIdentity.reportSnapshotId
    || replayIdentity.snapshotFingerprint
      !== replayIdentity.reportSnapshotFingerprint
    || replayIdentity.contextFingerprint
      !== replayIdentity.reportContextFingerprint
    || first.report.evidenceContext === undefined
    || replay.report.evidenceContext === undefined
    || first.run.workspaceId !== replay.run.workspaceId
    || first.run.id === replay.run.id
    || firstReport.bindingFingerprint !== expectedBindingFingerprint({
      workspaceId: first.run.workspaceId,
      runId: first.run.id,
      contextFingerprint: firstRun.contextFingerprint,
      eventSetFingerprint: firstReport.eventSetFingerprint,
      eventCount: firstReport.eventCount,
    })
    || replayReport.bindingFingerprint !== expectedBindingFingerprint({
      workspaceId: replay.run.workspaceId,
      runId: replay.run.id,
      contextFingerprint: replayRun.contextFingerprint,
      eventSetFingerprint: replayReport.eventSetFingerprint,
      eventCount: replayReport.eventCount,
    })
    || firstReport.bindingFingerprint === replayReport.bindingFingerprint
    || canonicalEvidenceJson(firstIdentity)
      !== canonicalEvidenceJson(replayIdentity)
  ) {
    throw new Error(
      "Pinned replay evidence identity changed across run/report snapshots.",
    );
  }
}

/**
 * Reads exact row counts through the same loopback PostgREST boundary as the
 * production repositories. The Task-12 database is disposable and isolated,
 * so the unscoped reasoner-judgment count belongs solely to this E2E runtime.
 */
export async function readBeliefReversalReplayPersistentCounts(input: {
  target: BeliefReversalPinnedPipelineTarget;
  workspaceId: string;
  fetchImpl?: typeof fetch;
}): Promise<BeliefReversalReplayPersistentCounts> {
  assertPipelineTarget(input.target);
  const workspaceId = requiredText(input.workspaceId, "E2E workspace");
  const fetchImpl = input.fetchImpl ?? fetch;
  const countRows = async (table: string, primaryKey: string, scoped: boolean) => {
    const query = new URLSearchParams({ select: primaryKey });
    if (scoped) query.set("workspace_id", `eq.${workspaceId}`);
    const base = input.target.postgrestUrl.replace(/\/$/u, "");
    const response = await fetchImpl(
      `${base}/rest/v1/${table}?${query.toString()}`,
      {
        method: "GET",
        headers: {
          apikey: input.target.serviceRoleKey,
          authorization: `Bearer ${input.target.serviceRoleKey}`,
          prefer: "count=exact",
          range: "0-0",
        },
        cache: "no-store",
      },
    );
    if (!response.ok) {
      throw new Error(
        `Pinned E2E could not count durable ${table} rows (HTTP ${response.status}).`,
      );
    }
    const match = response.headers.get("content-range")?.match(/\/(\d+)$/u);
    if (!match) {
      throw new Error(`Pinned E2E requires an exact durable row count for ${table}.`);
    }
    return Number(match[1]);
  };

  const [reasonerJudgments, xtraceIngestIntents, xtraceMemoryLinks] =
    await Promise.all([
      countRows("reasoner_judgments", "fingerprint", false),
      countRows("xtrace_ingest_intents_v2", "intent_id", true),
      countRows("xtrace_memory_links_v2", "memory_id", true),
    ]);
  return { reasonerJudgments, xtraceIngestIntents, xtraceMemoryLinks };
}

/**
 * Re-reads the disposable PostgreSQL state at verification time. These are
 * live route-time probes, not snapshots captured by the pipeline runner.
 */
export async function readBeliefReversalIsolationPersistentCounts(input: {
  target: BeliefReversalPinnedPipelineTarget;
  workspaceId: string;
  fetchImpl?: typeof fetch;
}): Promise<BeliefReversalIsolationPersistentCounts> {
  assertPipelineTarget(input.target);
  const workspaceId = requiredText(input.workspaceId, "E2E workspace");
  const fetchImpl = input.fetchImpl ?? fetch;
  const base = input.target.postgrestUrl.replace(/\/$/u, "");
  const headers = {
    apikey: input.target.serviceRoleKey,
    authorization: `Bearer ${input.target.serviceRoleKey}`,
    prefer: "count=exact",
    range: "0-0",
  };
  const countRows = async (
    table: string,
    primaryKey: string,
    workspaceScoped: boolean,
  ): Promise<number> => {
    const query = new URLSearchParams({ select: primaryKey });
    if (workspaceScoped) query.set("workspace_id", `eq.${workspaceId}`);
    const response = await fetchImpl(
      `${base}/rest/v1/${table}?${query.toString()}`,
      { method: "GET", headers, cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error(
        `Pinned E2E could not count isolation table ${table} (HTTP ${response.status}).`,
      );
    }
    const match = response.headers.get("content-range")?.match(/\/(\d+)$/u);
    if (!match) {
      throw new Error(
        `Pinned E2E requires an exact isolation row count for ${table}.`,
      );
    }
    return Number(match[1]);
  };
  const rateQuery = new URLSearchParams({ select: "request_count" });
  const rateResponse = await fetchImpl(
    `${base}/rest/v1/public_request_limits?${rateQuery.toString()}`,
    {
      method: "GET",
      headers: {
        apikey: input.target.serviceRoleKey,
        authorization: `Bearer ${input.target.serviceRoleKey}`,
      },
      cache: "no-store",
    },
  );
  if (!rateResponse.ok) {
    throw new Error(
      `Pinned E2E could not inspect the loopback rate limiter (HTTP ${rateResponse.status}).`,
    );
  }
  const rateRows = await rateResponse.json() as Array<{
    request_count?: unknown;
  }>;
  const rateLimitRequests = rateRows.reduce((sum, row) => {
    if (!Number.isInteger(row.request_count) || Number(row.request_count) < 0) {
      throw new Error("Pinned E2E received an invalid loopback rate-limit count.");
    }
    return sum + Number(row.request_count);
  }, 0);
  const [
    scanRuns,
    scanRunSteps,
    sourceRevisions,
    sampleInteractions,
    reasonerJudgments,
    xtraceIngestIntents,
    xtraceMemoryLinks,
  ] = await Promise.all([
    countRows("scan_runs", "id", true),
    countRows("scan_run_steps", "id", false),
    countRows("source_revisions", "id", true),
    countRows("deal_interactions", "id", true),
    countRows("reasoner_judgments", "fingerprint", false),
    countRows("xtrace_ingest_intents_v2", "intent_id", true),
    countRows("xtrace_memory_links_v2", "memory_id", true),
  ]);
  return {
    scanRuns,
    scanRunSteps,
    sourceRevisions,
    sampleInteractions,
    reasonerJudgments,
    xtraceIngestIntents,
    xtraceMemoryLinks,
    rateLimitRequests,
  };
}

/**
 * Faithful Task-12 mainline entry point for the opt-in local E2E. Every durable
 * adapter is a real PostgREST repository scoped to the disposable target.
 */
export async function runBeliefReversalPinnedPipeline(input: {
  target: BeliefReversalPinnedPipelineTarget;
  workspaceId: string;
  dataStore: Pick<DemoDataStore, "listWorkspaceDocumentIds">;
  snapshotId?: typeof APPROVED_PINNED_DEMO_SNAPSHOT_ID;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}): Promise<BeliefReversalPinnedPipelineResult> {
  assertPipelineTarget(input.target);
  const workspaceId = requiredText(input.workspaceId, "E2E workspace");
  const snapshotId = input.snapshotId ?? APPROVED_PINNED_DEMO_SNAPSHOT_ID;
  const common = {
    url: input.target.postgrestUrl,
    serviceRoleKey: input.target.serviceRoleKey,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  };
  const now = input.now ?? (() => new Date());
  const sourceRegistry = createSupabaseSourceRegistry(common);
  const dealRegistry = createSupabaseDealRegistry(common);
  const evidencePacks = createSupabaseEvidencePacksRepository(common);
  const intelligence = createSupabaseIntelligenceRepository({
    ...common,
    now,
    dealRegistry,
  });
  const runs = createRunsRepository(createSupabaseDataClient({
    ...common,
  }));
  const references = createSupabaseUnderwritingReferencesRepository(common);
  const underwritingRuns = createSupabaseUnderwritingRunsRepository(common);
  const underwritingArtifacts =
    createSupabaseUnderwritingArtifactsRepository(common);
  const judgments = createSupabaseReasonerJudgmentsRepository(common);
  const lineage = createSupabaseXTraceLineageRepository({
    ...common,
    sleep: async () => {},
    waitAttempts: 1,
  });
  const providers = createBeliefReversalDeterministicProviders();
  const noQuotaLimiter = { async acquire(): Promise<void> {} };
  const planner = createExactParentPlanner({
    dealRegistry,
    sourceRegistry,
  });

  await createProductInputGate(input.dataStore).assertReady(workspaceId);
  const firstParents = await planner.plan(workspaceId);
  assertExactParentMatrix(firstParents);
  const xtraceService = createXTraceService(providers.xtraceClient, {
    workspaceId,
    lineageRepository: lineage,
    limiter: noQuotaLimiter,
  });
  const firstIngest = await runExactXTraceIngestStage({
    workspaceId,
    planner: { async plan() { return firstParents; } },
    service: xtraceService,
  });
  assertFirstExactIngest(firstIngest.results);

  const referenceCatalog = await buildReferenceCatalog({
    references,
    asOfDate: now().toISOString().slice(0, 10),
  });
  const criticalEvidenceProfiles = (
    await Promise.all(SLICE_ONE_CONTEXTS.map(({ criticalEvidenceProfileId }) =>
      references.getCriticalEvidenceProfile(criticalEvidenceProfileId)
    ))
  ).filter((profile) => profile !== null);
  const router = createContextRouter();
  const grounding = createEvidencePackCandidateGrounding({
    repository: evidencePacks,
    sourceRegistry,
    criticalEvidenceProfiles,
    builder: createEvidencePackBuilder({
      repository: evidencePacks,
      sourceRegistry,
      router,
      criticalEvidenceProfiles,
      now,
    }),
    // This is deliberately the production interface. If Task-7 exact lineage
    // and Task-9 grounding disagree, the E2E fails rather than substituting a
    // test-only lineage projection.
    xtraceLineage: lineage,
    resolveBenchmark: (context) => context.benchmarkPackId
      ? references.getSelectedBenchmark({
          packId: context.benchmarkPackId,
          stage: context.stage,
          asOfDate: context.asOfDate,
        })
      : Promise.resolve(null),
  });
  const frameworkLenses = createContextAwareFrameworkLensResolver({
    client: providers.claudeClient,
    execution: {
      provider: "deterministic-e2e-observer",
      model: "deterministic-e2e-observer-v1",
      promptVersion: "framework-lens-v1",
      schemaVersion: "framework-judgment-v1",
      settingsFingerprint: "belief-reversal-task12-v1",
      applicationCommit: "task12-local-e2e",
    },
  });
  const underwriting = createUnderwritingOrchestrator({
    runs: underwritingRuns,
    activeFundPolicy: (requestedWorkspaceId) =>
      references.activeFundPolicy(requestedWorkspaceId),
    candidateExecutionFingerprint:
      "source-grounded-v3:context-router-v2:semantic-context-v1:deterministic-e2e-observer-v1",
    referenceCatalog,
    candidateExecutor: createSourceGroundedCandidateExecutor({
      grounding,
      resolveFrameworkLenses: (context, signal) =>
        frameworkLenses.resolve(context, signal),
      router,
      now,
      execution: {
        providerModel: "deterministic-e2e-observer-v1",
        promptVersion: "framework-lens-v1",
        schemaVersion: "framework-judgment-v1",
        settingsFingerprint: "belief-reversal-task12-v1",
        applicationCommit: "task12-local-e2e",
      },
    }),
    now,
  });
  let liveMarketCalls = 0;
  const processDependencies = {
    runs,
    intelligence,
    dealRegistry,
    underwriting,
    importGate: createProductInputGate(input.dataStore),
    market: {
      async scanMarketWindow(): Promise<never> {
        liveMarketCalls += 1;
        throw new Error("Pinned E2E must never call a live Market provider.");
      },
    },
    reasoner: createClaudeMatchingReasoner(providers.claudeClient, {
      judgments,
    }),
    xtrace: {
      listOpenIngestJobs: (requestedWorkspaceId: string) =>
        lineage.listOpenJobs(requestedWorkspaceId),
      pollIngestJob: (jobId: string, options: { dealId: string }) =>
        xtraceService.pollIngestJob(jobId, options),
      recallDealContext: xtraceService.recallDealContext,
    },
    now,
  };

  const first = await runPinnedPass({
    workspaceId,
    snapshotId,
    workerId: "belief-reversal-task12-first",
    runs,
    processDependencies,
    underwritingRuns,
    underwritingArtifacts,
  });
  const providersAfterFirst = providers.inspect();
  const persistentCountsAfterFirst =
    await readBeliefReversalReplayPersistentCounts({
      target: input.target,
      workspaceId,
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    });

  const replayParents = await planner.plan(workspaceId);
  assertExactParentMatrix(replayParents);
  const replayIngest = await runExactXTraceIngestStage({
    workspaceId,
    planner: { async plan() { return replayParents; } },
    service: xtraceService,
  });
  assertReplayExactIngest(replayIngest.results);
  const replay = await runPinnedPass({
    workspaceId,
    snapshotId,
    workerId: "belief-reversal-task12-replay",
    runs,
    processDependencies,
    underwritingRuns,
    underwritingArtifacts,
  });
  const providersAfterReplay = providers.inspect();
  const persistentCountsAfterReplay =
    await readBeliefReversalReplayPersistentCounts({
      target: input.target,
      workspaceId,
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    });
  const replayDeltas = assertBeliefReversalReplayPersistence(
    persistentCountsAfterFirst,
    persistentCountsAfterReplay,
  );

  assertBeliefReversalReplayEvidenceIdentity(first, replay);
  if (first.semanticFingerprint !== replay.semanticFingerprint) {
    throw new Error("Pinned replay changed derived matching/decision semantics.");
  }
  if (
    providersAfterFirst.claude.matchingCalls !== 1
    || providersAfterReplay.claude.matchingCalls !== 1
  ) {
    throw new Error("Pinned replay did not reuse the exact reasoner judgment.");
  }
  if (
    providersAfterFirst.xtrace.ingestCalls !== 85
    || providersAfterReplay.xtrace.ingestCalls !== 85
    || providersAfterReplay.xtrace.exactParentCount !== 85
    || providersAfterReplay.xtrace.memoryCount !== 85
  ) {
    throw new Error("Pinned replay changed exact XTrace provider submissions or children.");
  }
  if (
    liveMarketCalls !== 0
    || providersAfterReplay.xtrace.deleteCalls !== 0
    || providersAfterReplay.claude.unexpectedCalls !== 0
  ) {
    throw new Error("Pinned replay crossed a forbidden live or destructive provider path.");
  }

  return {
    exactIngest: {
      parentCount: 85,
      first: firstIngest.results,
      replay: replayIngest.results,
    },
    first,
    replay,
    providersAfterFirst,
    providersAfterReplay,
    replayDeltas,
    liveMarketCalls: 0,
    readProviderInspection: () => providers.inspect(),
    readLiveMarketCalls: () => liveMarketCalls,
  };
}

export function assertBeliefReversalReplayPersistence(
  before: BeliefReversalReplayPersistentCounts,
  after: BeliefReversalReplayPersistentCounts,
): BeliefReversalReplayDeltas {
  const delta = {
    reasonerJudgments: after.reasonerJudgments - before.reasonerJudgments,
    xtraceIngestIntents:
      after.xtraceIngestIntents - before.xtraceIngestIntents,
    xtraceMemoryLinks: after.xtraceMemoryLinks - before.xtraceMemoryLinks,
  };
  if (
    before.reasonerJudgments < 1
    || before.xtraceIngestIntents !== 85
    || before.xtraceMemoryLinks !== 85
    || Object.values(delta).some((value) => value !== 0)
  ) {
    throw new Error(
      "Pinned replay must reuse durable reasoner judgments and exact XTrace lineage.",
    );
  }
  return { before, after, delta };
}

function buildMatchingObservations(input: ClaudeCompleteInput): unknown[] {
  const request = parseClaudeRequest(input);
  const deals = requireArray(request.deals, "matching Deals");
  const events = requireArray(request.marketEvents, "matching events");
  const memoryContexts = requireArray(
    request.memoryContexts,
    "matching memory contexts",
  );
  const globalSources = requireArray(request.sources, "matching sources");
  const dealIds = new Set(deals.flatMap((value) => {
    const record = asRecord(value);
    return typeof record?.id === "string" ? [record.id] : [];
  }));

  return EXPECTED_CASES.flatMap((expected) => {
    if (!dealIds.has(expected.dealId)) return [];
    const event = events.map(asRecord).find((candidate) => {
      if (candidate?.triggerSourceId !== expected.triggerSourceId) return false;
      return optionalArray(candidate.sources).some((value) => {
        const source = asRecord(value);
        return source?.id === expected.triggerSourceId
          && source.sourceRevisionId === expected.triggerSourceRevisionId;
      });
    });
    const memory = memoryContexts.map(asRecord).find((candidate) =>
      candidate?.dealId === expected.dealId
    );
    if (!event || !memory) {
      const triggerLineages = events.map(asRecord).flatMap((candidate) =>
        optionalArray(candidate?.sources).flatMap((value) => {
          const source = asRecord(value);
          return source?.evidenceRole === "trigger"
            ? [`${String(source.id)}@${String(source.sourceRevisionId)}`]
            : [];
        })
      );
      throw new Error(
        `E2E matching authority is missing for ${expected.dealId}`
          + ` (event=${event ? "present" : "missing"}, memory=${memory ? "present" : "missing"}, triggers=${triggerLineages.join(",")}).`,
      );
    }
    const eventSources = requireArray(
      event.sources,
      `${expected.dealId} event sources`,
    ).map((source) => requireRecord(source, "event source"));
    const interactions = requireArray(
      memory.interactionCandidates,
      `${expected.dealId} interaction candidates`,
    ).map((candidate) => requireRecord(candidate, "interaction candidate"));
    if (interactions.length !== 1) {
      throw new Error(`${expected.dealId} requires one Sample decision record.`);
    }
    const interaction = interactions[0]!;
    const sourceCatalog = [
      ...eventSources,
      ...globalSources.map((source) => requireRecord(source, "source catalog item")),
    ];
    const trigger = requireSource(
      sourceCatalog,
      String(event.triggerSourceId),
      "trigger",
    );
    const prior = requireSource(
      sourceCatalog,
      String(interaction.id),
      "prior Sample",
    );
    const implication = requireSource(
      sourceCatalog,
      expected.implicationSourceId,
      "implication",
    );
    const counter = requireSource(
      sourceCatalog,
      expected.counterSourceId,
      "counterevidence",
    );
    const whyNow = sourceObservationText(trigger);
    const previousContext = sourceObservationText(prior);
    const implicationText = sourceObservationText(implication);
    const counterText = sourceObservationText(counter);
    const triggerSourceId = String(trigger.id);
    const priorSourceId = String(prior.id);
    const implicationSourceId = String(implication.id);
    const counterSourceId = String(counter.id);
    const claimSourceIds: Record<string, string[]> = {
      [whyNow]: [triggerSourceId],
      [previousContext]: [priorSourceId],
      [implicationText]: [implicationSourceId],
      [counterText]: [counterSourceId],
    };
    return [{
      dealId: expected.dealId,
      whyNow,
      previousContext,
      positiveImplications:
        expected.direction === "positive" ? [implicationText] : [],
      negativeImplications:
        expected.direction === "negative" ? [implicationText] : [],
      selectedTriggerEventId: String(event.id),
      selectedPriorInteractionId: String(interaction.id),
      revisitConditionIndex: 0,
      revisitConditionText: requireArray(
        interaction.revisitConditions,
        "revisit conditions",
      )[0],
      revisitCitedSourceIds: [triggerSourceId],
      counterevidence: {
        statement: counterText,
        citedSourceIds: [counterSourceId],
      },
      citedSourceIds: uniqueStrings([
        triggerSourceId,
        priorSourceId,
        implicationSourceId,
        counterSourceId,
      ]),
      scoreInputs: expected.scoreInputs,
      claimSourceIds,
    }];
  });
}

function buildFrameworkObservation(input: ClaudeCompleteInput): unknown {
  let request = parseClaudeRequest(input);
  if (request.originalRequest !== undefined) {
    request = requireRecord(request.originalRequest, "framework repair request");
  }
  const card = requireRecord(request.card, "framework Card");
  const pack = requireRecord(request.evidencePack, "framework Evidence Pack");
  const factRecords = requireArray(pack.facts, "Evidence Pack Facts")
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => item !== null);
  const assumptionRecords = requireArray(
    pack.assumptions,
    "Evidence Pack Assumptions",
  ).map(asRecord).filter(
    (item): item is Record<string, unknown> => item !== null,
  );
  const calculationRecords = optionalArray(
    asRecord(request.valuationInputs)?.calculations,
  ).map(asRecord).filter(
    (item): item is Record<string, unknown> => item !== null,
  );
  const evidenceRecords = [
    ...factRecords,
    ...assumptionRecords,
    ...calculationRecords,
  ];
  const ids = uniqueStrings([
    ...evidenceRecords.flatMap((item) =>
      typeof item.id === "string" ? [item.id] : []
    ),
  ]).sort(compareUtf8);
  const cardId = requiredText(String(card.id ?? ""), "framework Card id");
  if (ids.length < 2) {
    return {
      applicability: "not_applicable",
      conclusion: "abstain",
      supportEvidenceItemIds: [],
      counterEvidenceItemIds: [],
      unusedEvidenceItemIds: ids,
      strongestSupport: null,
      strongestCounterargument: null,
      unknowns: ["The immutable Evidence Pack is too sparse for this lens."],
      limitations: [],
      confidence: lowConfidence(),
      frameworkRuleRefs: [cardId],
    };
  }
  const title = typeof card.title === "string" ? card.title : cardId;
  const conclusion = frameworkConclusion(title, cardId);
  const prioritizedIds = prioritizeFrameworkEvidenceIds(
    factRecords,
    assumptionRecords,
    calculationRecords,
  );
  const supportId = prioritizedIds[0] ?? ids[0]!;
  const counterId = prioritizedIds[1] ?? ids[1]!;
  const supportEvidence = describeFrameworkEvidence(evidenceRecords, supportId);
  const counterEvidence = describeFrameworkEvidence(evidenceRecords, counterId);
  const coverage = asRecord(pack.coverage);
  const missingFields = optionalArray(coverage?.missingFieldIds)
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.replaceAll("_", " "));
  return {
    applicability: "applicable",
    conclusion,
    supportEvidenceItemIds: [supportId],
    counterEvidenceItemIds: [counterId],
    unusedEvidenceItemIds: ids.filter((id) =>
      id !== supportId && id !== counterId
    ),
    strongestSupport: conclusion === "supportive"
      ? `${title} uses ${supportEvidence} as the strongest concrete input for a bounded supportive reading.`
      : `${title} uses ${supportEvidence} as the strongest concrete input for a bounded cautious reading.`,
    strongestCounterargument:
      `${counterEvidence} is the strongest persisted counterargument and limits how far this conclusion can be carried.`,
    unknowns: missingFields.length
      ? [`Critical missing evidence remains: ${missingFields.join(", ")}.`]
      : [
        "The immutable Evidence Pack does not establish every operating outcome required by this lens.",
      ],
    limitations: [
      "This local deterministic report uses only the supplied immutable Evidence Pack and does not claim endorsement or private reasoning.",
    ],
    confidence: {
      sourceReliability: "medium",
      evidenceStrength: "medium",
      evidenceCoverage: "medium",
      applicability: "medium",
      judgment: "medium",
    },
    frameworkRuleRefs: [cardId],
  };
}

function prioritizeFrameworkEvidenceIds(
  facts: readonly Record<string, unknown>[],
  assumptions: readonly Record<string, unknown>[],
  calculations: readonly Record<string, unknown>[],
): string[] {
  const fieldPriority = new Map([
    ["customer_evidence", 0],
    ["revenue", 1],
    ["business_model", 2],
    ["reported_valuation_basis", 3],
    ["reported_valuation", 4],
    ["stage", 5],
    ["company_identity", 6],
    ["official_domain", 7],
  ]);
  const orderedFacts = [...facts].sort((left, right) => {
    const leftField = typeof left.field === "string" ? left.field : "";
    const rightField = typeof right.field === "string" ? right.field : "";
    return (fieldPriority.get(leftField) ?? 50)
      - (fieldPriority.get(rightField) ?? 50)
      || compareUtf8(String(left.id ?? ""), String(right.id ?? ""));
  });
  return uniqueStrings([
    ...orderedFacts,
    ...assumptions,
    ...calculations,
  ].flatMap((item) => typeof item.id === "string" ? [item.id] : []));
}

function describeFrameworkEvidence(
  records: readonly Record<string, unknown>[],
  id: string,
): string {
  const item = records.find((record) => record.id === id);
  if (!item) return `the immutable evidence item ${id}`;
  const field = typeof item.field === "string"
    ? item.field.replaceAll("_", " ")
    : "evidence";
  const value = typeof item.value === "string"
    ? item.value
    : typeof item.output === "string"
    ? item.output
    : null;
  const unit = typeof item.unit === "string" ? item.unit : null;
  return value
    ? `${field} (${value}${unit ? ` ${unit}` : ""})`
    : `${field} evidence (${id})`;
}

function frameworkConclusion(
  title: string,
  cardId: string,
): "supportive" | "negative" {
  const byTitle: Record<string, "supportive" | "negative"> = {
    "GTM & Unit Economics": "supportive",
    "Revenue Quality & Retention": "negative",
    "Durable Competitive Power": "negative",
    "Market Size & Why Now": "supportive",
    "Product-Market Fit & Customer Evidence": "negative",
    "Valuation & Fund Return": "negative",
    "Contrarian Market Structure": "supportive",
  };
  if (byTitle[title]) return byTitle[title];
  const digest = createHash("sha256").update(cardId, "utf8").digest();
  return (digest[0] ?? 0) % 2 === 0 ? "supportive" : "negative";
}

async function buildReferenceCatalog(input: {
  references: UnderwritingReferencesRepository;
  asOfDate: string;
}) {
  const criticalEvidenceProfiles = (
    await Promise.all(SLICE_ONE_CONTEXTS.map((context) =>
      input.references.getCriticalEvidenceProfile(
        context.criticalEvidenceProfileId,
      )
    ))
  ).filter((profile) => profile !== null);
  const benchmarks = (
    await Promise.all((['seed', 'series_a'] as const).map((stage) =>
      input.references.getSelectedBenchmark({
        packId: SYNTHETIC_US_SOFTWARE_BENCHMARK_PACK_ID,
        stage,
        asOfDate: input.asOfDate,
      })
    ))
  ).filter((benchmark) => benchmark !== null);
  return createReferenceCatalogSnapshot([
    ...criticalEvidenceProfiles.map((profile) => ({
      kind: "critical_evidence_profile" as const,
      id: profile.id,
      version: profile.version,
      definitionFingerprint: profile.definitionFingerprint,
    })),
    ...benchmarks.map((benchmark) => ({
      kind: "benchmark_definition" as const,
      id: benchmark.entryId,
      parentId: benchmark.packId,
      version: benchmark.version,
      definitionFingerprint: benchmark.definitionFingerprint,
    })),
    ...SLICE_ONE_CONTEXTS.map((context) => ({
      kind: "valuation_method_policy" as const,
      id: context.valuationMethodPolicyId,
      version: "1",
      definitionFingerprint: createCanonicalFingerprint({
        id: context.valuationMethodPolicyId,
        version: "1",
        stage: context.stage,
        businessModel: context.businessModel,
        methods: ["venture_method", "market_comps", "ownership_return"],
      }),
    })),
    ...SLICE_ONE_CONTEXTS.map((context) => ({
      kind: "decision_policy" as const,
      id: context.decisionPolicyId,
      version: "1",
      definitionFingerprint: createCanonicalFingerprint({
        ...DECISION_POLICY_V1,
        id: context.decisionPolicyId,
      }),
    })),
    {
      kind: "framework_pack",
      id: SYNTHETIC_FRAMEWORK_PACK.id,
      version: SYNTHETIC_FRAMEWORK_PACK.version,
      definitionFingerprint: createCanonicalFingerprint(
        SYNTHETIC_FRAMEWORK_PACK,
      ),
    },
  ]);
}

async function runPinnedPass(input: {
  workspaceId: string;
  snapshotId: typeof APPROVED_PINNED_DEMO_SNAPSHOT_ID;
  workerId: string;
  runs: ReturnType<typeof createRunsRepository>;
  processDependencies: Parameters<typeof processClaimedRun>[1];
  underwritingRuns: UnderwritingRunsRepository;
  underwritingArtifacts: ReturnType<
    typeof createSupabaseUnderwritingArtifactsRepository
  >;
}): Promise<BeliefReversalPipelinePass> {
  const queued = await input.runs.create({
    workspaceId: input.workspaceId,
    mode: "xtrace",
    windowDays: 14,
    evidenceRequest: {
      schemaVersion: "run-evidence-request-v1",
      evidenceMode: "pinned",
      snapshotId: input.snapshotId,
    },
  });
  const claimed = await input.runs.claimNext(input.workerId);
  if (!claimed || claimed.id !== queued.id) {
    throw new Error("Pinned E2E did not claim the exact queued scan run.");
  }
  const processed = await processClaimedRun(claimed, input.processDependencies);
  if (processed.run.status !== "completed") {
    throw new Error(
      `Pinned E2E scan ${processed.run.id} ended ${processed.run.status}: ${processed.run.warnings.join(" | ")}`,
    );
  }
  const batch = await input.underwritingRuns.getBatchByScanRunId({
    workspaceId: input.workspaceId,
    scanRunId: processed.run.id,
  });
  if (!batch) throw new Error("Pinned E2E produced no underwriting batch.");
  const [selections, candidates] = await Promise.all([
    input.underwritingRuns.listSelectionsForBatch({
      workspaceId: input.workspaceId,
      batchId: batch.id,
    }),
    input.underwritingRuns.listCandidatesForBatch({
      workspaceId: input.workspaceId,
      batchId: batch.id,
    }),
  ]);
  const artifacts = await Promise.all(candidates.map(async (candidate) => {
    const artifact = await input.underwritingArtifacts.getByCandidateRunId({
      workspaceId: input.workspaceId,
      candidateRunId: candidate.id,
    });
    if (!artifact) {
      throw new Error(
        `Pinned E2E candidate ${candidate.dealId} ended ${candidate.status} without a terminal artifact.`,
      );
    }
    return artifact;
  }));
  const cases = validateQualifiedCases({
    report: processed.report,
    batch,
    selections,
    candidates,
    artifacts,
  });
  return {
    run: processed.run,
    report: processed.report,
    batch,
    selections,
    candidates,
    artifacts,
    cases,
    semanticFingerprint: semanticFingerprint(cases),
  };
}

function validateQualifiedCases(input: {
  report: IntelligenceReportRecord;
  batch: UnderwritingBatch;
  selections: UnderwritingSelection[];
  candidates: CandidateRun[];
  artifacts: CandidateArtifactBundle[];
}): BeliefReversalPipelineCaseResult[] {
  if (
    input.report.opportunities.length !== 4
    || input.selections.filter(({ status }) => status === "selected").length !== 4
    || input.candidates.length !== 4
    || input.artifacts.length !== 4
    || input.batch.status !== "completed"
  ) {
    throw new Error(
      "E2E must derive exactly four terminal belief-revision priorities.",
    );
  }
  const expectedByDeal = new Map<string, ExpectedCase>(
    EXPECTED_CASES.map((item) => [item.dealId, item]),
  );
  const analysisByDeal = new Map(
    input.report.companyAnalyses.map((analysis) => [analysis.dealId, analysis]),
  );
  const candidateByDeal = new Map(
    input.candidates.map((candidate) => [candidate.dealId, candidate]),
  );
  const artifactByDeal = new Map(
    input.artifacts.map((artifact) => [artifact.dealId, artifact]),
  );
  const selectedRankByDeal = new Map(
    input.selections.flatMap((selection) =>
      selection.status === "selected" && selection.rank !== null
        ? [[selection.dealId, selection.rank] as const]
        : []
    ),
  );

  return input.report.opportunities.map((opportunity, index) => {
    const expected = expectedByDeal.get(opportunity.dealId);
    const analysis = analysisByDeal.get(opportunity.dealId);
    const candidate = candidateByDeal.get(opportunity.dealId);
    const artifact = artifactByDeal.get(opportunity.dealId);
    const assessment = analysis?.beliefAssessment;
    if (!expected || !analysis || !candidate || !artifact || !assessment) {
      throw new Error(`Pinned E2E selected unknown or incomplete Deal ${opportunity.dealId}.`);
    }
    const actionKinds = assessment.actions.map(({ kind }) => kind);
    if (
      opportunity.rank !== index + 1
      || selectedRankByDeal.get(opportunity.dealId) !== opportunity.rank
      || analysis.companyName !== expected.companyName
      || analysis.dealStatus !== expected.status
      || analysis.outcome !== "belief_revised"
      || !["medium", "high"].includes(analysis.confidence)
      || assessment.direction !== expected.direction
      || canonicalEvidenceJson(actionKinds)
        !== canonicalEvidenceJson(expected.actions)
      || !assessment.gates.allPassed
      || candidate.status !== "completed"
      || artifact.scenarioModel.scenarios.length !== 3
      || artifact.scenarioModel.scenarios.some(({ inputs }) => inputs.length !== 17)
      || artifact.judgments.length === 0
      || artifact.actionDrafts.length === 0
      || artifact.evidencePack.dealId !== opportunity.dealId
    ) {
      throw new Error(
        `Pinned E2E derived an invalid qualified result for ${opportunity.dealId}.`,
      );
    }
    return {
      priorityRank: opportunity.rank,
      rank: opportunity.rank,
      dealId: opportunity.dealId,
      companyName: analysis.companyName,
      dealStatus: analysis.dealStatus,
      outcome: analysis.outcome,
      confidence: analysis.confidence,
      score: analysis.score,
      direction: assessment.direction,
      actions: actionKinds,
      gates: {
        chronology: assessment.gates.chronology.passed,
        revisitConditionMapping:
          assessment.gates.revisitConditionMapping.passed,
        counterevidence: assessment.gates.counterevidence.passed,
        actionDelta: assessment.gates.actionDelta.passed,
        allPassed: assessment.gates.allPassed,
      },
      candidateRunId: candidate.id,
      candidateStatus: candidate.status,
      artifactCandidateRunId: artifact.candidateRunId,
      valuationStatus: artifact.valuation.status,
      formalDecision: artifact.decision.decision,
    };
  });
}

function semanticFingerprint(cases: BeliefReversalPipelineCaseResult[]): Sha256 {
  const payload = cases.map((item) => ({
    rank: item.rank,
    dealId: item.dealId,
    companyName: item.companyName,
    dealStatus: item.dealStatus,
    outcome: item.outcome,
    confidence: item.confidence,
    score: item.score,
    direction: item.direction,
    actions: item.actions,
    gates: item.gates,
    candidateStatus: item.candidateStatus,
    valuationStatus: item.valuationStatus,
    formalDecision: item.formalDecision,
  }));
  return `sha256:${createHash("sha256")
    .update(canonicalEvidenceJson(payload), "utf8")
    .digest("hex")}`;
}

function assertExactParentMatrix(parents: readonly ExactXTraceParentUnit[]): void {
  const counts = Map.groupBy(parents, ({ parentKind }) => parentKind);
  if (
    parents.length !== 85
    || (counts.get("legacy_source_revision")?.length ?? 0) !== 19
    || (counts.get("canonical_source_revision")?.length ?? 0) !== 55
    || (counts.get("sample_decision_record")?.length ?? 0) !== 4
    || (counts.get("sample_research_screening_record")?.length ?? 0) !== 7
    || new Set(parents.map(({ dealId }) => dealId)).size !== 30
  ) {
    throw new Error(
      "E2E exact-parent plan must remain 30 Deals / 19+55+4+7 parents.",
    );
  }
}

function assertFirstExactIngest(results: readonly ExactParentIngestResult[]): void {
  if (
    results.length !== 85
    || results.some((result) =>
      result.outcome !== "recorded"
      || result.ingest.state !== "succeeded"
      || result.ingest.reused
      || result.ingest.memoryIds.length !== 1
    )
  ) {
    throw new Error("E2E first exact XTrace pass must create 85 succeeded children.");
  }
}

function assertReplayExactIngest(results: readonly ExactParentIngestResult[]): void {
  if (
    results.length !== 85
    || results.some((result) =>
      result.outcome !== "recorded"
      || result.ingest.state !== "succeeded"
      || !result.ingest.reused
      || result.ingest.memoryIds.length !== 1
    )
  ) {
    throw new Error("E2E exact XTrace replay must reuse all 85 succeeded children.");
  }
}

function assertPipelineTarget(target: BeliefReversalPinnedPipelineTarget): void {
  assertDisposableDatabaseName(target.databaseName);
  if (
    target.postgresVersion !== "17.6"
    || target.postgrestVersion !== "12.2.3"
    || !target.serviceRoleKey.trim()
  ) {
    throw new Error("Belief-reversal pipeline requires the pinned disposable runtime.");
  }
  let url: URL;
  try {
    url = new URL(target.postgrestUrl);
  } catch {
    throw new Error("Belief-reversal pipeline requires a valid loopback PostgREST URL.");
  }
  if (
    url.protocol !== "http:"
    || url.hostname !== "127.0.0.1"
    || !url.port
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    throw new Error("Belief-reversal pipeline refuses non-loopback PostgREST.");
  }
}

function parseClaudeRequest(input: ClaudeCompleteInput): Record<string, unknown> {
  const content = input.messages.length === 1
    ? input.messages[0]?.content
    : undefined;
  if (typeof content !== "string") {
    throw new Error("E2E Claude accepts one JSON observation request only.");
  }
  return parseRecord(content, "E2E Claude request");
}

function requireSource(
  sources: readonly Record<string, unknown>[],
  sourceId: string,
  label: string,
): Record<string, unknown> {
  const matches = sources.filter(({ id }) => id === sourceId);
  if (matches.length === 0) {
    throw new Error(`E2E matching ${label} source ${sourceId} is missing.`);
  }
  const canonical = new Set(matches.map(canonicalEvidenceJson));
  if (canonical.size !== 1) {
    throw new Error(`E2E matching ${label} source ${sourceId} conflicts.`);
  }
  return matches[0]!;
}

function sourceObservationText(source: SerializedSource): string {
  if (source.factEligible !== true) {
    throw new Error(`E2E matching source ${String(source.id)} is not fact eligible.`);
  }
  const value = typeof source.normalizedStatement === "string"
    ? source.normalizedStatement
    : typeof source.verbatimExcerpt === "string"
    ? source.verbatimExcerpt
    : "";
  return requiredText(value, `source ${String(source.id)} observation`);
}

function lowConfidence() {
  return {
    sourceReliability: "low",
    evidenceStrength: "low",
    evidenceCoverage: "low",
    applicability: "low",
    judgment: "low",
  } as const;
}

function parseRecord(value: string, label: string): Record<string, unknown> {
  try {
    return requireRecord(JSON.parse(value), label);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label} is not JSON.`);
    throw error;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  const record = asRecord(value);
  if (!record) throw new Error(`${label} must be an object.`);
  return record;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function optionalArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
