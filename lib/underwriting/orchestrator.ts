import { createHash, randomUUID } from "node:crypto";

import type {
  CandidateFinalization,
  UnderwritingRunsRepository,
} from "../../db/repositories/underwriting-runs";
import type { NamedLensArtifactsRepository } from
  "../../db/repositories/named-lens-artifacts";
import type {
  RegisteredDeal,
} from "../../db/repositories/deal-registry";
import type { RunRecord } from "../../db/client";
import type {
  IntelligenceReportRecord,
} from "../../db/repositories/intelligence";
import type { CompanyAnalysis } from "../contracts/domain";
import { compareUtf8 } from "../format/canonical-order";
import { rankBeliefRevisionCandidates } from "../matching/ranking";
import type { EvidencePack } from "../contracts/evidence";
import {
  NAMED_LENS_GENERATOR_VERSION,
  NAMED_LENS_PASSAGE_SCHEMA_VERSION,
  NAMED_LENS_SELECTION_POLICY_VERSION,
  UNDERWRITING_PRESENTATION_SCHEMA_VERSION,
} from "../contracts/named-lens";
import type {
  CandidateCheckpoint,
  CandidateRun,
  FundPolicySnapshot,
  ResolvedUnderwritingContext,
  UnderwritingBatch,
} from "../contracts/underwriting";
import { ACTION_DRAFT_POLICY_VERSION } from "../contracts/underwriting";
import { BELIEF_ACTION_POLICY_VERSION } from "../reports/action-policy";
import {
  canonicalJson,
  createBatchInputFingerprint,
  createReferenceCatalogSnapshot,
  createCandidateAnalysisFingerprint,
  type ReferenceDefinitionRef,
  type UnderwritingEvidenceFrameV1,
  type UnderwritingReferenceCatalogSnapshot,
} from "./fingerprints";
import {
  CONTEXT_ROUTER_VERSION,
  createContextRouter,
  type ContextRouter,
  type RouterResolution,
} from "./router";
import {
  SEMANTIC_CONTEXT_ASSUMPTION_POLICY_VERSION,
  SEMANTIC_CONTEXT_MAPPING_VERSION,
} from "./evidence/semantic-projector";
import { createValuationEngine } from "./valuation/service";
import type { ValuationEngine } from "./valuation/contracts";
import type { FrameworkLensService } from "./frameworks/service";
import {
  DECISION_TAXONOMY_DIGEST,
  DECISION_TAXONOMY_VERSION,
} from
  "./frameworks/decision-taxonomy";
import { IntegrationTransportError } from "../api/errors";
import {
  createDecisionEngine,
  selectFormalDecisionJudgments,
  type DecisionEngine,
} from "./decision/engine";
import { DECISION_POLICY_V1 } from "./decision/rules";
import { buildUnderwritingNarrative } from "./narrative";
import { createActionDraftGenerator } from "./action-drafts";
import { buildCandidateMissingEvidence } from "./missing-evidence";
import {
  CandidateGroundingUnavailableError,
  type CandidateGroundingSnapshot,
  type CandidateGroundingPort,
} from "./candidate-grounding";
import {
  parseCandidateGroundingSnapshot,
  parseDecisionResult,
  parseFrameworkCatalogBinding,
  parseFrameworkLensResult,
  parseGroundedEvidencePack,
  parseNamedLensPresentationArtifacts,
  parseNarrativeArtifacts,
  parseValuationArtifactSet,
} from "./stage-replay";
import {
  CURRENT_FRAMEWORK_LENS_PASSAGE_CONTRACT,
  createFrameworkLensStageInputFingerprint,
} from "./frameworks/passage-contract";
import {
  CURRENT_NAMED_LENS_PROVIDER_TIMEOUT_POLICY,
  NamedLensProviderTimeoutPolicySchema,
  type NamedLensProviderTimeoutPolicy,
} from "./frameworks/timeout-policy";
import {
  CandidateBudgetExhaustedError,
  CandidateStageTimeoutError,
  createCandidateStagePolicies,
  createCandidateStageRuntime,
  type CandidateExecutionBudget,
  type CandidateExecutionStage,
  type CandidateStagePolicy,
  type CandidateStageRuntime,
} from "./candidate-stage-runtime";
import { buildNamedLensPresentationArtifacts } from
  "./named-lens-presentation";

export {
  CandidateBudgetExhaustedError,
  CandidateStageTimeoutError,
  type CandidateExecutionBudget,
  type CandidateExecutionStage,
  type CandidateStagePolicy,
  type CandidateStageRuntime,
};
export {
  CandidateCheckpointReplayError,
  CandidateProviderAttemptReplayError,
} from "./candidate-stage-runtime";

export const UNDERWRITING_ADMISSION_POLICY_VERSION =
  "all-belief-revisions-v1";
export const UNDERWRITING_REFRESH_SEMANTICS_VERSION =
  "refresh-new-canonical-never-alias-v1" as const;
const DEFAULT_CANDIDATE_TIMEOUT_MS = 30_000;
const DEFAULT_CANDIDATE_MAX_ATTEMPTS = 2;
const DEFAULT_CANDIDATE_LEASE_SECONDS = 120;
const DEFAULT_CANDIDATE_COST_UNITS = 28;
const DEFAULT_CANDIDATE_TOKEN_UNITS = 112_000;
const ORCHESTRATOR_WORKER_ID = "underwriting-orchestrator-v1";

export type CandidateFinalizationPayload = Omit<
  CandidateFinalization,
  "workerId" | "leaseToken" | "candidateRunId"
>;

export interface CandidateUnavailableExecution {
  kind: "unavailable";
  reasonCodes: string[];
}

export type CandidateExecutionResult =
  | CandidateFinalization
  | CandidateFinalizationPayload
  | CandidateUnavailableExecution;

export interface CandidateExecutorInput {
  candidate: CandidateRun;
  analysis: CompanyAnalysis;
  deal: RegisteredDeal;
  fundPolicy: FundPolicySnapshot;
  batchInputFingerprint: string;
  reportId: string;
  refreshNonce: string | null;
  referenceCatalog: UnderwritingReferenceCatalogSnapshot;
  workerId: string;
  leaseToken: string;
  budget: CandidateExecutionBudget;
  stages: CandidateStageRuntime;
  signal: AbortSignal;
}

interface PlannedCandidate {
  candidate: CandidateRun;
  analysis: CompanyAnalysis;
  deal: RegisteredDeal;
  fundPolicy: FundPolicySnapshot;
  batchInputFingerprint: string;
  reportId: string;
  refreshNonce: string | null;
}

export interface SourceGroundedCandidateExecutionSettings {
  providerModel: string;
  promptVersion: string;
  schemaVersion: string;
  settingsFingerprint: string;
  applicationCommit: string;
}

export interface FrameworkLensExecutionSelection {
  catalogVersion: string;
  catalogFingerprint: string;
  corpusDigest: string;
  service: FrameworkLensService;
}

export interface FrameworkCatalogBinding {
  catalogVersion: string;
  catalogFingerprint: string;
  corpusDigest: string;
}

class FrameworkCatalogResolutionError extends IntegrationTransportError {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super({
      retryable:
        cause instanceof IntegrationTransportError && cause.retryable,
    });
    this.name = "FrameworkCatalogResolutionError";
    this.message = "The audited Framework catalog could not be resolved.";
    this.cause = cause;
  }
}

export interface UnderwritingOrchestrator {
  createBatchAndSelections(input: {
    scanRun: RunRecord;
    report: IntelligenceReportRecord;
    analyses: CompanyAnalysis[];
    eligibleDeals: RegisteredDeal[];
    forceRefresh: boolean;
    refreshNonce?: string;
    evidenceFrame?: UnderwritingEvidenceFrameV1;
  }): Promise<UnderwritingBatch>;
  processCandidate(candidateRunId: string): Promise<CandidateRun>;
}

export function createUnderwritingOrchestrator(options: {
  runs: UnderwritingRunsRepository;
  namedLensArtifacts?: NamedLensArtifactsRepository;
  activeFundPolicy(
    workspaceId: string,
  ): Promise<FundPolicySnapshot>;
  autoProcessCandidates?: boolean;
  refreshNonce?: () => string;
  candidateExecutor?: (
    input: CandidateExecutorInput,
  ) => Promise<CandidateExecutionResult>;
  candidateTimeoutMs?: number;
  candidateMaxAttempts?: number;
  candidateLeaseSeconds?: number;
  candidateCostUnits?: number;
  candidateTokenUnits?: number;
  candidateStagePolicies?: Partial<
    Record<CandidateExecutionStage, Partial<CandidateStagePolicy>>
  >;
  candidateExecutionFingerprint?: string;
  referenceCatalog?: UnderwritingReferenceCatalogSnapshot;
  onWarning?: (warning: string) => void;
  now?: () => Date;
}): UnderwritingOrchestrator {
  const refreshNonce = options.refreshNonce ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const stageTimeoutMs = positiveInteger(
    options.candidateTimeoutMs ?? DEFAULT_CANDIDATE_TIMEOUT_MS,
    "Candidate stage timeout",
  );
  const retryableStageAttempts = positiveInteger(
    options.candidateMaxAttempts ?? DEFAULT_CANDIDATE_MAX_ATTEMPTS,
    "Candidate stage attempts",
  );
  const budget: CandidateExecutionBudget = {
    maxCostUnits: positiveInteger(
      options.candidateCostUnits ?? DEFAULT_CANDIDATE_COST_UNITS,
      "Candidate cost budget",
    ),
    maxTokenUnits: positiveInteger(
      options.candidateTokenUnits ?? DEFAULT_CANDIDATE_TOKEN_UNITS,
      "Candidate token budget",
    ),
    maxConcurrency: 1,
    stages: createCandidateStagePolicies({
      timeoutMs: stageTimeoutMs,
      retryableAttempts: retryableStageAttempts,
      overrides: options.candidateStagePolicies,
    }),
  };
  const leaseSeconds = positiveInteger(
    options.candidateLeaseSeconds ?? DEFAULT_CANDIDATE_LEASE_SECONDS,
    "Candidate lease",
  );
  const candidateExecutionFingerprint = requiredText(
    options.candidateExecutionFingerprint
      ?? "candidate-executor-contract-v2",
    "A candidate execution fingerprint",
  );
  const referenceCatalog = options.referenceCatalog
    ?? createReferenceCatalogSnapshot([]);
  const plannedCandidates = new Map<string, PlannedCandidate>();

  const processCandidate = async (
    candidateRunId: string,
  ): Promise<CandidateRun> => {
    const planned = plannedCandidates.get(candidateRunId);
    if (!planned) {
      throw new Error(
        `Candidate ${candidateRunId} is outside this immutable orchestration snapshot.`,
      );
    }
    if (
      ["completed", "partial", "unavailable", "failed"].includes(
        planned.candidate.status,
      )
    ) {
      return planned.candidate;
    }
    const claimed = await options.runs.claimCandidate({
      workspaceId: planned.candidate.workspaceId,
      candidateRunId,
      workerId: ORCHESTRATOR_WORKER_ID,
      leaseSeconds,
    });
    if (!claimed) {
      throw new Error(
        `Candidate ${candidateRunId} could not be claimed in its workspace.`,
      );
    }
    if (!options.candidateExecutor) {
      await options.runs.markCandidateFailed({
        candidateRunId,
        publicReason:
          "Candidate underwriting is unavailable because no executor is configured.",
      });
      return terminalCandidate(claimed.candidate, "failed", now());
    }

    const controller = new AbortController();
    const stages = await createCandidateStageRuntime({
      runs: options.runs,
      namedLensArtifacts: options.namedLensArtifacts,
      candidate: claimed.candidate,
      workerId: ORCHESTRATOR_WORKER_ID,
      leaseToken: claimed.leaseToken,
      budget,
      onWarning: options.onWarning,
      now,
    });
    let finalization: CandidateExecutionResult | undefined;
    let executionError: unknown;
    try {
      finalization = await options.candidateExecutor({
        candidate: claimed.candidate,
        analysis: planned.analysis,
        deal: planned.deal,
        fundPolicy: planned.fundPolicy,
        batchInputFingerprint: planned.batchInputFingerprint,
        reportId: planned.reportId,
        refreshNonce: planned.refreshNonce,
        referenceCatalog,
        workerId: ORCHESTRATOR_WORKER_ID,
        leaseToken: claimed.leaseToken,
        budget,
        stages,
        signal: controller.signal,
      });
    } catch (error) {
      executionError = error;
    }
    if (!finalization) {
      // A current finalization checkpoint is identity-bearing only after the
      // complete persisted graph and all semantic pins exist. Recording an
      // unpinned failed placeholder here would either weaken replay authority
      // or block a lease-recovered execution from saving the exact graph.
      await options.runs.markCandidateFailed({
        candidateRunId,
        publicReason: "Candidate underwriting failed after bounded retries.",
      });
      options.onWarning?.(
        `Candidate ${planned.deal.id} underwriting failed during bounded stage execution; completed candidates remain available. Internal stage reason: ${boundedErrorDetail(executionError)}`,
      );
      const failed = terminalCandidate(claimed.candidate, "failed", now());
      planned.candidate = failed;
      return failed;
    }
    if (isUnavailableExecution(finalization)) {
      try {
        await options.runs.markCandidateUnavailable({
          candidateRunId,
          reasonCodes: finalization.reasonCodes,
        });
      } catch {
        await options.runs.markCandidateFailed({
          candidateRunId,
          publicReason:
            "Candidate unavailable state could not be durably persisted.",
        });
        const failed = terminalCandidate(claimed.candidate, "failed", now());
        planned.candidate = failed;
        return failed;
      }
      const unavailable = terminalCandidate(
        claimed.candidate,
        "unavailable",
        now(),
      );
      planned.candidate = unavailable;
      return unavailable;
    }
    const payload = {
      ...finalization,
      workerId: ORCHESTRATOR_WORKER_ID,
      leaseToken: claimed.leaseToken,
      candidateRunId,
    };
    const durableFinalizationPayload = Object.fromEntries(
      Object.entries(payload).filter(([key]) =>
        key !== "workerId"
        && key !== "leaseToken"
        && key !== "candidateRunId"
      ),
    ) as CandidateFinalizationPayload;
    let currentFinalizationIdentity: ReturnType<
      typeof requireCurrentFinalizationCheckpointIdentity
    >;
    try {
      const frameworkCatalog = requireCompletedFrameworkCatalogCheckpoint(
        await options.runs.listCheckpoints({
          workspaceId: claimed.candidate.workspaceId,
          candidateRunId,
        }),
      );
      currentFinalizationIdentity =
        requireCurrentFinalizationCheckpointIdentity(
          payload,
          planned.refreshNonce,
          frameworkCatalog,
        );
    } catch (error) {
      const publicReason =
        "Candidate underwriting returned an invalid immutable finalization identity.";
      await options.runs.markCandidateFailed({
        candidateRunId,
        publicReason,
      });
      options.onWarning?.(
        `Candidate ${planned.deal.id} finalization identity was rejected; previously completed candidates remain available. Internal stage reason: ${boundedErrorDetail(error)}`,
      );
      const failed = terminalCandidate(claimed.candidate, "failed", now());
      planned.candidate = failed;
      return failed;
    }
    const finalizationInputFingerprint = fingerprint({
      stage: "finalization",
      candidateRunId,
      batchInputFingerprint: planned.batchInputFingerprint,
      candidateAnalysisFingerprint: payload.candidateAnalysisFingerprint,
      evidencePackBuildInputFingerprint:
        payload.evidencePackBuildInputFingerprint,
      currentContractIdentity: currentFinalizationIdentity,
    });
    try {
      await options.runs.saveCheckpoint({
        candidateRunId,
        stage: "finalization",
        status: "completed",
        inputFingerprint: finalizationInputFingerprint,
        outputFingerprint: fingerprint({
          stage: "finalization",
          inputFingerprint: finalizationInputFingerprint,
          result: durableFinalizationPayload,
        }),
        outputPayload: durableFinalizationPayload,
        attemptCount: 1,
        costUnits: 0,
        tokenUnits: 0,
        actualTokenUnits: 0,
        providerAttempts: [],
        reasonCode: null,
        publicReason: null,
        savedAt: now().toISOString(),
        workerId: ORCHESTRATOR_WORKER_ID,
        leaseToken: claimed.leaseToken,
      });
      const completed = await options.runs.finalizeCandidate(payload);
      planned.candidate = completed;
      return completed;
    } catch (error) {
      const publicReason =
        "Candidate underwriting could not be atomically finalized.";
      await options.runs.markCandidateFailed({
        candidateRunId,
        publicReason,
      });
      options.onWarning?.(
        `Candidate ${planned.deal.id} finalization failed; previously completed candidates remain available. Internal stage reason: ${boundedErrorDetail(error)}`,
      );
      const failed = terminalCandidate(claimed.candidate, "failed", now());
      planned.candidate = failed;
      return failed;
    }
  };

  return {
    async createBatchAndSelections(input) {
      if (!input.forceRefresh && input.refreshNonce !== undefined) {
        throw new Error(
          "A refresh nonce is valid only for an explicit force refresh.",
        );
      }
      const policy = await options.activeFundPolicy(
        input.scanRun.workspaceId,
      );
      assertAlignedInput(input, policy);
      const batchInputFingerprint = createBatchInputFingerprint({
        scanRun: input.scanRun,
        report: input.report,
        analyses: input.analyses,
        eligibleDeals: input.eligibleDeals,
        policy,
        executionBudget: budget,
        candidateExecutionFingerprint,
        referenceCatalog,
        evidenceFrame: input.evidenceFrame,
        selectionPolicyVersion: UNDERWRITING_ADMISSION_POLICY_VERSION,
        routerVersion: CONTEXT_ROUTER_VERSION,
        beliefPolicies: {
          actionPolicyVersion: BELIEF_ACTION_POLICY_VERSION,
          draftPolicyVersion: ACTION_DRAFT_POLICY_VERSION,
          semanticContextAssumptionPolicyVersion:
            SEMANTIC_CONTEXT_ASSUMPTION_POLICY_VERSION,
          semanticContextMappingVersion: SEMANTIC_CONTEXT_MAPPING_VERSION,
        },
        evidencePackBuilderVersion: "evidence_pack_builder_v2",
        decisionPolicyVersion: DECISION_POLICY_V1.version,
      });
      const ordinaryBatch = await options.runs.createOrReuseBatch({
        workspaceId: input.scanRun.workspaceId,
        scanRunId: input.scanRun.id,
        batchInputFingerprint,
        fundPolicySnapshotId: policy.id,
        fundPolicyValues: policy.values,
        forceRefresh: false,
        refreshNonce: null,
        rerunOfId: null,
      });
      const selectedRefreshNonce = input.forceRefresh
        ? requiredText(
          input.refreshNonce ?? refreshNonce(),
          "A refresh nonce",
        )
        : null;
      const batch = input.forceRefresh
        ? await options.runs.createOrReuseBatch({
            workspaceId: input.scanRun.workspaceId,
            scanRunId: input.scanRun.id,
            batchInputFingerprint,
            fundPolicySnapshotId: policy.id,
            fundPolicyValues: policy.values,
            forceRefresh: true,
            refreshNonce: selectedRefreshNonce,
            rerunOfId: ordinaryBatch.id,
          })
        : ordinaryBatch;
      const qualified = qualifiedCandidates(
        input.analyses,
        new Map(input.eligibleDeals.map((deal) => [deal.id, deal.status])),
      );
      const ranks = new Map(
        qualified.map((analysis, index) => [
          analysis.dealId,
          index + 1,
        ]),
      );
      await options.runs.saveSelections({
        batchId: batch.id,
        selections: input.eligibleDeals.map((deal) => {
          const rank = ranks.get(deal.id) ?? null;
          return rank === null
            ? {
                dealId: deal.id,
                status: "not_selected" as const,
                rank: null,
                reason:
                  "Not admitted because this CompanyAnalysis is not an eligible belief revision; this is not a Pass decision.",
              }
            : {
                dealId: deal.id,
                status: "selected" as const,
                rank,
                reason:
                  `Admitted at priority ${rank} by ${UNDERWRITING_ADMISSION_POLICY_VERSION}; priority does not affect eligibility.`,
              };
        }),
      });
      const candidates = await options.runs.createSelectedCandidates({
        batchId: batch.id,
        dealIds: qualified.map(({ dealId }) => dealId),
      });
      const analysesByDeal = new Map(
        input.analyses.map((analysis) => [analysis.dealId, analysis]),
      );
      const dealsById = new Map(
        input.eligibleDeals.map((deal) => [deal.id, deal]),
      );
      for (const candidate of candidates) {
        plannedCandidates.set(candidate.id, {
          candidate,
          analysis: analysesByDeal.get(candidate.dealId)!,
          deal: dealsById.get(candidate.dealId)!,
          fundPolicy: policy,
          batchInputFingerprint,
          reportId: input.report.id,
          refreshNonce: selectedRefreshNonce,
        });
      }
      if (options.autoProcessCandidates !== false) {
        const processed: CandidateRun[] = [];
        for (const candidate of candidates) {
          processed.push(await processCandidate(candidate.id));
        }
        return {
          ...batch,
          status: statusForCandidates(processed),
        };
      }
      return batch;
    },

    processCandidate,
  };
}

function boundedErrorDetail(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600) || "Unknown finalization error";
}

export function createSourceGroundedCandidateExecutor(options: {
  grounding: CandidateGroundingPort;
  frameworkLenses?: FrameworkLensService;
  frameworkCatalog?: FrameworkCatalogBinding;
  resolveFrameworkLenses?: (
    context: ResolvedUnderwritingContext,
    signal?: AbortSignal,
  ) => Promise<FrameworkLensExecutionSelection>;
  router?: ContextRouter;
  valuation?: ValuationEngine;
  decision?: DecisionEngine;
  execution: SourceGroundedCandidateExecutionSettings;
  advisoryProviderTimeoutPolicy?: NamedLensProviderTimeoutPolicy;
  now?: () => Date;
}): (
  input: CandidateExecutorInput,
) => Promise<CandidateFinalizationPayload | CandidateUnavailableExecution> {
  if (
    (options.frameworkLenses === undefined)
      === (options.resolveFrameworkLenses === undefined)
  ) {
    throw new Error(
      "Candidate execution requires exactly one static or context-aware Framework lens service.",
    );
  }
  if (options.frameworkLenses && !options.frameworkCatalog) {
    throw new Error(
      "A static Framework lens service requires an explicit immutable catalog binding.",
    );
  }
  if (options.resolveFrameworkLenses && options.frameworkCatalog) {
    throw new Error(
      "A context-aware Framework resolver cannot also accept a static catalog binding.",
    );
  }
  const router = options.router ?? createContextRouter();
  const valuation = options.valuation ?? createValuationEngine({
    now: options.now,
  });
  const decision = options.decision ?? createDecisionEngine();
  const now = options.now ?? (() => new Date());
  const execution = normalizedExecution(options.execution);
  const advisoryProviderTimeoutPolicy =
    NamedLensProviderTimeoutPolicySchema.parse(
      options.advisoryProviderTimeoutPolicy
        ?? CURRENT_NAMED_LENS_PROVIDER_TIMEOUT_POLICY,
    );

  return async (input) => {
    if (input.signal.aborted) {
      throw new Error("Candidate execution was cancelled before it started.");
    }
    const dealFingerprint = input.deal.activeSourceRevisionFingerprint;
    if (!dealFingerprint) {
      throw new Error(
        "Candidate execution requires an immutable active Deal revision.",
      );
    }
    const beliefAssessment = input.analysis.beliefAssessment;
    if (!beliefAssessment) {
      return unavailableExecution([
        "AUTHORITATIVE_BELIEF_ASSESSMENT_UNAVAILABLE",
      ]);
    }
    let snapshot: CandidateGroundingSnapshot;
    let resolution: RouterResolution;
    try {
      snapshot = await input.stages.run({
        stage: "context_router",
        inputFingerprint: fingerprint({
          stage: "context_router",
          routerVersion: CONTEXT_ROUTER_VERSION,
          semanticContextAssumptionPolicyVersion:
            SEMANTIC_CONTEXT_ASSUMPTION_POLICY_VERSION,
          semanticContextMappingVersion:
            SEMANTIC_CONTEXT_MAPPING_VERSION,
          candidate: input.candidate,
          analysis: input.analysis,
          deal: input.deal,
        }),
        parseOutput: parseCandidateGroundingSnapshot,
        operation: (signal) =>
          options.grounding.load({
            candidate: input.candidate,
            analysis: input.analysis,
            deal: input.deal,
            signal,
          }),
      });
      resolution = router.resolve(snapshot.identityEvidence);
    } catch (error) {
      if (error instanceof CandidateGroundingUnavailableError) {
        return unavailableExecution(error.reasonCodes);
      }
      if (error instanceof CandidateBudgetExhaustedError) {
        return budgetUnavailableExecution(error.stage);
      }
      throw error;
    }
    if (resolution.kind === "needs_confirmation") {
      return unavailableExecution(resolution.fields.map((field) =>
        `CONTEXT_CONFIRMATION_REQUIRED_${snakeCase(field).toUpperCase()}`
      ));
    }
    if (resolution.kind === "unavailable") {
      return unavailableExecution(resolution.reasonCodes);
    }
    if (!resolution.context) {
      return unavailableExecution([
        "CORE_ONLY_CONTEXT_NOT_SUPPORTED_BY_SLICE_ONE_ARTIFACT_CONTRACT",
      ]);
    }
    const context = resolution.context;
    let pack: EvidencePack;
    let evidencePackBuildInputFingerprint: string;
    let criticalEvidenceProfile: ReferenceDefinitionRef;
    let benchmark: ReferenceDefinitionRef | null;
    let valuationMethodPolicy: ReferenceDefinitionRef;
    let frameworkPack: ReferenceDefinitionRef;
    let decisionPolicy: ReferenceDefinitionRef;
    try {
      const grounded = await input.stages.run({
        stage: "evidence_pack",
        inputFingerprint: fingerprint({
          stage: "evidence_pack",
          candidate: input.candidate,
          deal: input.deal,
          context,
          fundPolicy: input.fundPolicy,
          snapshot,
        }),
        parseOutput: parseGroundedEvidencePack,
        operation: (signal) => options.grounding.buildEvidencePack({
          candidate: input.candidate,
          analysis: input.analysis,
          deal: input.deal,
          context,
          fundPolicy: input.fundPolicy,
          snapshot,
          signal,
        }),
      });
      pack = grounded.pack;
      evidencePackBuildInputFingerprint = grounded.buildInputFingerprint;
      criticalEvidenceProfile = requireReferenceDefinition({
        catalog: input.referenceCatalog,
        expected: grounded.criticalEvidenceProfile,
      });
      benchmark = grounded.benchmark
        ? requireReferenceDefinition({
            catalog: input.referenceCatalog,
            expected: {
              kind: "benchmark_definition",
              id: grounded.benchmark.entryId,
              parentId: grounded.benchmark.packId,
              version: grounded.benchmark.version,
              definitionFingerprint:
                grounded.benchmark.definitionFingerprint,
            },
          })
        : null;
      valuationMethodPolicy = requireReferenceDefinition({
        catalog: input.referenceCatalog,
        kind: "valuation_method_policy",
        id: context.valuationMethodPolicyId,
      });
      frameworkPack = requireReferenceDefinition({
        catalog: input.referenceCatalog,
        kind: "framework_pack",
        id: context.frameworkPackId,
      });
      decisionPolicy = requireReferenceDefinition({
        catalog: input.referenceCatalog,
        kind: "decision_policy",
        id: context.decisionPolicyId,
      });
    } catch (error) {
      if (error instanceof CandidateGroundingUnavailableError) {
        return unavailableExecution(error.reasonCodes);
      }
      if (error instanceof CandidateBudgetExhaustedError) {
        return budgetUnavailableExecution(error.stage);
      }
      throw error;
    }
    const evidenceFingerprint = fingerprint({
      pack,
      sourceRevisionSnapshots: snapshot.sourceRevisionSnapshots,
      xtraceLineage: snapshot.xtraceLineage,
      fundPolicy: input.fundPolicy,
    });
    const valuationArtifacts = await input.stages.run({
      stage: "valuation",
      inputFingerprint: fingerprint({
        stage: "valuation",
        pack,
        context,
        fundPolicy: input.fundPolicy,
      }),
      parseOutput: parseValuationArtifactSet,
      operation: () => {
        const artifacts = valuation.evaluateDetailed({
          pack,
          context,
          fundPolicy: input.fundPolicy,
        });
        if (
          pack.coverage.minimumModelInputsComplete
          && pack.coverage.underwritingStatus !== "unavailable"
        ) {
          return artifacts;
        }
        return {
          evaluation: {
            id: `valuation:${pack.id}`,
            status: "unavailable" as const,
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
            blockerCodes: pack.coverage.reasonCodes.length > 0
              ? [...pack.coverage.reasonCodes]
              : ["MISSING_MINIMUM_MODEL_INPUTS"],
          },
          scenarioModel: artifacts.scenarioModel,
          calculations: [],
          calculationClaimEdges: [],
        };
      },
    });
    const scenarioModel = {
      ...valuationArtifacts.scenarioModel,
      id: `scenario-model:${input.candidate.id}`,
      candidateRunId: input.candidate.id,
    };
    let resolvedFrameworkSelection:
      | FrameworkLensExecutionSelection
      | undefined;
    let frameworkCatalog: FrameworkCatalogBinding | null;
    try {
      frameworkCatalog = await input.stages.run({
          stage: "framework_catalog",
          inputFingerprint: fingerprint({
            stage: "framework_catalog",
            candidateId: input.candidate.id,
            context,
            execution,
            staticCatalog: options.frameworkCatalog ?? null,
          }),
          parseOutput: parseFrameworkCatalogBinding,
          operation: async (signal) => {
            if (options.frameworkCatalog) {
              return validateFrameworkCatalogBinding(
                options.frameworkCatalog,
              );
            }
            try {
              resolvedFrameworkSelection = validateFrameworkLensSelection(
                await options.resolveFrameworkLenses!(context, signal),
              );
              return frameworkCatalogBinding(resolvedFrameworkSelection);
            } catch (error) {
              throw classifyFrameworkCatalogError(error, signal);
            }
          },
        });
    } catch (error) {
      if (error instanceof CandidateStageTimeoutError) {
        return timeoutUnavailableExecution(error.stage);
      }
      if (error instanceof FrameworkCatalogResolutionError) {
        return unavailableExecution(["FRAMEWORK_CATALOG_UNAVAILABLE"]);
      }
      throw error;
    }
    let lensResult;
    try {
      const frameworkInputFingerprint =
        createFrameworkLensStageInputFingerprint({
          candidate: input.candidate,
          pack,
          context,
          calculations: valuationArtifacts.calculations,
          execution,
          frameworkCatalog: {
            version: frameworkCatalog.catalogVersion,
            fingerprint: frameworkCatalog.catalogFingerprint,
            corpusDigest: frameworkCatalog.corpusDigest,
          },
          passageContract: CURRENT_FRAMEWORK_LENS_PASSAGE_CONTRACT,
          advisoryProviderTimeoutPolicy,
        });
      lensResult = await input.stages.run({
        stage: "framework_lenses",
        inputFingerprint: frameworkInputFingerprint,
        parseOutput: (value) => parseFrameworkLensResult(
          value,
          CURRENT_FRAMEWORK_LENS_PASSAGE_CONTRACT,
        ),
        operation: async (signal) => {
          let service = options.frameworkLenses;
          if (options.resolveFrameworkLenses) {
            try {
              resolvedFrameworkSelection ??=
                validateFrameworkLensSelection(
                  await options.resolveFrameworkLenses(context, signal),
                );
              assertFrameworkCatalogBinding(
                resolvedFrameworkSelection,
              frameworkCatalog,
              );
              service = resolvedFrameworkSelection.service;
            } catch (error) {
              throw classifyFrameworkCatalogError(error, signal);
            }
          }
          assertFrameworkLensTimeoutPolicy(
            service!,
            advisoryProviderTimeoutPolicy,
          );
          return service!.runAll({
            candidate: input.candidate,
            pack,
            context,
            calculations: valuationArtifacts.calculations,
            signal,
            providerAttempt: {
              execute: (request) => input.stages.runProviderAttempt({
                stage: "framework_lenses",
                inputFingerprint: frameworkInputFingerprint,
                attemptFingerprint: request.attemptFingerprint,
                costUnits: 1,
                tokenUnits: request.outputTokenUnits,
                ...(request.namedLensAttempt
                  ? { namedLensAttempt: request.namedLensAttempt }
                  : {}),
                operation: request.operation,
              }),
            },
          });
        },
      });
    } catch (error) {
      if (error instanceof CandidateBudgetExhaustedError) {
        return budgetUnavailableExecution(error.stage);
      }
      if (error instanceof CandidateStageTimeoutError) {
        return timeoutUnavailableExecution(error.stage);
      }
      if (error instanceof FrameworkCatalogResolutionError) {
        return unavailableExecution(["FRAMEWORK_CATALOG_UNAVAILABLE"]);
      }
      throw error;
    }
    if (input.signal.aborted) {
      throw new Error("Candidate execution exceeded its stage budget.");
    }
    const selectedDecisionPolicy = {
      ...DECISION_POLICY_V1,
      id: context.decisionPolicyId,
    };
    const formalDecisionJudgments = selectFormalDecisionJudgments(
      lensResult.judgments,
    );
    const formalDecision = await input.stages.run({
      stage: "decision",
      inputFingerprint: fingerprint({
        stage: "decision",
        pack,
        judgments: formalDecisionJudgments,
        valuation: valuationArtifacts.evaluation,
        fundPolicy: input.fundPolicy,
        context,
        decisionPolicy: selectedDecisionPolicy,
      }),
      parseOutput: parseDecisionResult,
      operation: () => decision.decide({
        pack,
        coverage: pack.coverage,
        judgments: formalDecisionJudgments,
        valuation: valuationArtifacts.evaluation,
        fundPolicy: input.fundPolicy,
        context,
        decisionPolicy: selectedDecisionPolicy,
      }),
    });
    const namedLensAttempts = await input.stages.listNamedLensAttempts();
    const namedLensPresentationArtifacts = await input.stages.run({
      stage: "named_lens_presentation",
      inputFingerprint: fingerprint({
        stage: "named_lens_presentation",
        reportId: input.reportId,
        analysis: input.analysis,
        pack,
        grounding: snapshot,
        calculations: valuationArtifacts.calculations,
        calculationClaimEdges: valuationArtifacts.calculationClaimEdges,
        decision: formalDecision,
        judgments: lensResult.judgments,
        taxonomyByFrameworkId: lensResult.taxonomyByFrameworkId,
        passageResults: lensResult.passageResults,
        advisoryFailures: lensResult.advisoryFailures ?? [],
        attempts: namedLensAttempts,
        authorityBindings: {
          valuation: valuationArtifacts.evaluation,
          fundPolicy: input.fundPolicy,
          context,
          decisionPolicyId: selectedDecisionPolicy.id,
        },
        passageContract: CURRENT_FRAMEWORK_LENS_PASSAGE_CONTRACT,
        selectionPolicyVersion: NAMED_LENS_SELECTION_POLICY_VERSION,
        presentationSchemaVersion:
          UNDERWRITING_PRESENTATION_SCHEMA_VERSION,
      }),
      parseOutput: parseNamedLensPresentationArtifacts,
      operation: () => buildNamedLensPresentationArtifacts({
        workspaceId: input.candidate.workspaceId,
        candidateRunId: input.candidate.id,
        reportId: input.reportId,
        analysis: input.analysis,
        pack,
        grounding: snapshot,
        calculations: valuationArtifacts.calculations,
        calculationClaimEdges: valuationArtifacts.calculationClaimEdges,
        decision: formalDecision,
        judgments: lensResult.judgments,
        taxonomyByFrameworkId: lensResult.taxonomyByFrameworkId,
        passageResults: lensResult.passageResults,
        advisoryFailures: lensResult.advisoryFailures ?? [],
        attempts: namedLensAttempts,
        authorityBindings: {
          valuation: valuationArtifacts.evaluation,
          fundPolicy: input.fundPolicy,
          context,
          decisionPolicyId: selectedDecisionPolicy.id,
        },
      }),
    });
    const missingEvidence = buildCandidateMissingEvidence({
      criticalFieldIds: pack.coverage.missingFieldIds,
      structuredFields: input.analysis.companyBrief.structuredFields,
    });
    const companyAnalysisUnknowns = missingEvidence.flatMap((item) =>
      item.reasonCode === "UNRESOLVED_COMPANY_OR_EVENT_UNKNOWN"
        ? [{
          fieldId: item.fieldId,
          label: item.label,
          externalLabel: item.externalLabel,
        }]
        : []
    );
    const narrativeArtifacts = await input.stages.run({
      stage: "narrative_drafts",
      inputFingerprint: fingerprint({
        stage: "narrative_drafts",
        pack,
        calculations: valuationArtifacts.calculations,
        judgments: lensResult.judgments,
        disagreements: lensResult.disagreements,
        decision: formalDecision,
        missingEvidence,
      }),
      parseOutput: parseNarrativeArtifacts,
      operation: () => {
        const narrative = buildUnderwritingNarrative({
          facts: pack.facts,
          assumptions: pack.assumptions,
          calculations: valuationArtifacts.calculations,
          judgments: lensResult.judgments,
          disagreements: lensResult.disagreements,
          decision: formalDecision,
        });
        const actionDrafts = createActionDraftGenerator({
          workspaceId: input.candidate.workspaceId,
          now,
        }).generate({
          candidateRunId: input.candidate.id,
          decision: formalDecision,
          missingEvidence,
          judgments: lensResult.judgments,
          disagreements: lensResult.disagreements,
          dealStatus: beliefAssessment.dealStatus,
          beliefDirection: beliefAssessment.direction,
          actions: beliefAssessment.actions,
        });
        return { narrative, actionDrafts };
      },
    });
    const formulaVersions = [
      ...new Set(
        valuationArtifacts.calculations.map(
          ({ formulaId, formulaVersion }) =>
            `${formulaId}@${formulaVersion}`,
        ),
      ),
    ].sort(compareUtf8);
    const namedLensVersions = {
      selectionPolicyVersion: NAMED_LENS_SELECTION_POLICY_VERSION,
      passageSchemaVersion: NAMED_LENS_PASSAGE_SCHEMA_VERSION,
      generatorVersion: NAMED_LENS_GENERATOR_VERSION,
      presentationSchemaVersion:
        UNDERWRITING_PRESENTATION_SCHEMA_VERSION,
      decisionTaxonomyVersion: DECISION_TAXONOMY_VERSION,
      decisionTaxonomyDigest: DECISION_TAXONOMY_DIGEST,
      criticalEvidenceProjectionFingerprint:
        namedLensPresentationArtifacts
          .decisionCriticalEvidenceProjection.fingerprint,
      finalDispositionsFingerprint:
        namedLensPresentationArtifacts.finalDispositionsFingerprint,
      presentationFingerprint:
        namedLensPresentationArtifacts.presentation.fingerprint,
    };
    const candidateAnalysisFingerprint = createCandidateAnalysisFingerprint({
      workspaceId: input.candidate.workspaceId,
      batchInputFingerprint: input.batchInputFingerprint,
      dealRevision: {
        dealId: input.deal.id,
        status: input.deal.status,
        sourceRevisionIds: input.deal.activeSourceRevisionIds,
        fingerprint: dealFingerprint,
      },
      beliefState: {
        dealStatus: beliefAssessment.dealStatus,
        direction: beliefAssessment.direction,
        canonicalActions: beliefAssessment.actions,
        actionPolicyVersion: BELIEF_ACTION_POLICY_VERSION,
        draftPolicyVersion: ACTION_DRAFT_POLICY_VERSION,
        semanticContextAssumptionPolicyVersion:
          SEMANTIC_CONTEXT_ASSUMPTION_POLICY_VERSION,
        semanticContextMappingVersion: SEMANTIC_CONTEXT_MAPPING_VERSION,
      },
      evidencePack: {
        id: pack.id,
        version: pack.version,
        sourceRevisionIds: pack.sourceRevisionIds,
        fingerprint: evidenceFingerprint,
      },
      evidenceSourceIds: input.analysis.sources.map(({ id }) => id),
      context: {
        id: context.id,
        contextVersion: context.contextVersion,
        criticalEvidenceProfileId: context.criticalEvidenceProfileId,
        benchmarkPackId: context.benchmarkPackId,
        valuationMethodPolicyId: context.valuationMethodPolicyId,
        frameworkPackId: context.frameworkPackId,
        decisionPolicyId: context.decisionPolicyId,
        analysisMode: context.analysisMode ?? resolution.analysisMode,
        geography: context.geography,
        securityType: context.securityType,
        benchmarkCompatibility: context.benchmarkCompatibility,
      },
      routerVersion: CONTEXT_ROUTER_VERSION,
      criticalEvidenceProfile,
      benchmark,
      valuationMethodPolicy,
      frameworkPack,
      decisionPolicy,
      referenceCatalogFingerprint:
        input.referenceCatalog.definitionFingerprint,
      frameworkCatalog: {
          version: frameworkCatalog.catalogVersion,
          fingerprint: frameworkCatalog.catalogFingerprint,
          corpusDigest: frameworkCatalog.corpusDigest,
        },
      formulaVersions,
      providerModel: execution.providerModel,
      promptVersion: execution.promptVersion,
      schemaVersion: execution.schemaVersion,
      settingsFingerprint: execution.settingsFingerprint,
      applicationCommit: execution.applicationCommit,
      namedLensVersions,
      refreshNonce: input.refreshNonce,
    });

    return {
      candidateAnalysisFingerprint,
      evidencePackBuildInputFingerprint,
      evidencePack: pack,
      context,
      scenarioModel,
      calculations: valuationArtifacts.calculations,
      calculationClaimEdges:
        valuationArtifacts.calculationClaimEdges,
      judgments: lensResult.judgments,
      disagreements: lensResult.disagreements,
      valuation: valuationArtifacts.evaluation,
      decision: formalDecision,
      narrative: narrativeArtifacts.narrative,
      actionDrafts: narrativeArtifacts.actionDrafts,
      namedLensCatalogConsiderations:
        namedLensPresentationArtifacts.catalogConsiderations,
      decisionCriticalEvidenceProjection:
        namedLensPresentationArtifacts.decisionCriticalEvidenceProjection,
      namedLensAttemptRefs: namedLensPresentationArtifacts.attemptRefs,
      namedLensDispositions: namedLensPresentationArtifacts.dispositions,
      namedLensPassages: namedLensPresentationArtifacts.passages,
      underwritingPresentationReportId:
        namedLensPresentationArtifacts.presentationReportId,
      namedLensPresentation: namedLensPresentationArtifacts.presentation,
      terminalStatus: namedLensPresentationArtifacts.terminalStatus,
      terminalReasonCodes:
        namedLensPresentationArtifacts.terminalReasonCodes,
      versionSnapshot: {
        fundPolicyId: input.fundPolicy.id,
        dealStatus: beliefAssessment.dealStatus,
        beliefDirection: beliefAssessment.direction,
        canonicalActions: beliefAssessment.actions,
        actionPolicyVersion: BELIEF_ACTION_POLICY_VERSION,
        draftPolicyVersion: ACTION_DRAFT_POLICY_VERSION,
        semanticContextAssumptionPolicyVersion:
          SEMANTIC_CONTEXT_ASSUMPTION_POLICY_VERSION,
        semanticContextMappingVersion: SEMANTIC_CONTEXT_MAPPING_VERSION,
        analysisMode: context.analysisMode ?? resolution.analysisMode,
        contextVersion: context.contextVersion,
        geography: context.geography,
        benchmarkCompatibility: context.benchmarkCompatibility,
        benchmarkPackId: context.benchmarkPackId,
        benchmarkEntryId: benchmark?.id ?? null,
        benchmarkDefinitionFingerprint:
          benchmark?.definitionFingerprint ?? null,
        frameworkPackId: context.frameworkPackId,
        frameworkPackDefinitionFingerprint:
          frameworkPack.definitionFingerprint,
        routerVersion: CONTEXT_ROUTER_VERSION,
        criticalEvidenceProfileId: context.criticalEvidenceProfileId,
        criticalEvidenceProfileDefinitionFingerprint:
          criticalEvidenceProfile.definitionFingerprint,
        valuationMethodPolicyId: context.valuationMethodPolicyId,
        valuationMethodPolicyDefinitionFingerprint:
          valuationMethodPolicy.definitionFingerprint,
        decisionPolicyId: context.decisionPolicyId,
        decisionPolicyDefinitionFingerprint:
          decisionPolicy.definitionFingerprint,
        referenceCatalogFingerprint:
          input.referenceCatalog.definitionFingerprint,
        frameworkCatalogVersion: frameworkCatalog.catalogVersion,
        frameworkCatalogFingerprint:
          frameworkCatalog.catalogFingerprint,
        frameworkCorpusDigest: frameworkCatalog.corpusDigest,
        formulaVersions,
        providerModel: execution.providerModel,
        promptVersion: execution.promptVersion,
        schemaVersion: execution.schemaVersion,
        settingsFingerprint: execution.settingsFingerprint,
        applicationCommit: execution.applicationCommit,
        namedLensSelectionPolicyVersion:
          namedLensVersions.selectionPolicyVersion,
        namedLensPassageSchemaVersion:
          namedLensVersions.passageSchemaVersion,
        namedLensGeneratorVersion: namedLensVersions.generatorVersion,
        underwritingPresentationSchemaVersion:
          namedLensVersions.presentationSchemaVersion,
        decisionTaxonomyVersion:
          namedLensVersions.decisionTaxonomyVersion,
        decisionTaxonomyDigest:
          namedLensVersions.decisionTaxonomyDigest,
        criticalEvidenceProjectionFingerprint:
          namedLensVersions.criticalEvidenceProjectionFingerprint,
        finalDispositionsFingerprint:
          namedLensVersions.finalDispositionsFingerprint,
        presentationFingerprint:
          namedLensVersions.presentationFingerprint,
        refreshNonce: input.refreshNonce,
        companyAnalysisUnknowns,
      },
    };
  };
}

function requireCurrentFinalizationCheckpointIdentity(
  payload: CandidateFinalizationPayload,
  expectedRefreshNonce: string | null,
  expectedFrameworkCatalog: FrameworkCatalogBinding,
) {
  const versionSnapshot = payload.versionSnapshot;
  const projection = payload.decisionCriticalEvidenceProjection;
  const presentation = payload.namedLensPresentation;
  const reportId = payload.underwritingPresentationReportId;
  const terminalStatus = payload.terminalStatus;
  const terminalReasonCodes = payload.terminalReasonCodes;
  const currentPins = [
    versionSnapshot.frameworkCatalogVersion,
    versionSnapshot.frameworkCatalogFingerprint,
    versionSnapshot.frameworkCorpusDigest,
    versionSnapshot.namedLensSelectionPolicyVersion,
    versionSnapshot.namedLensPassageSchemaVersion,
    versionSnapshot.namedLensGeneratorVersion,
    versionSnapshot.underwritingPresentationSchemaVersion,
    versionSnapshot.decisionTaxonomyVersion,
    versionSnapshot.decisionTaxonomyDigest,
    versionSnapshot.criticalEvidenceProjectionFingerprint,
    versionSnapshot.finalDispositionsFingerprint,
    versionSnapshot.presentationFingerprint,
    versionSnapshot.refreshNonce,
  ];
  if (
    projection === undefined
    || presentation === undefined
    || reportId === undefined
    || terminalStatus === undefined
    || terminalReasonCodes === undefined
    || currentPins.some((value) => value === undefined)
  ) {
    throw new Error(
      "Current Candidate finalization cannot checkpoint without the complete Named Lens graph and immutable identity pins.",
    );
  }
  if (
    projection.fingerprint
      !== versionSnapshot.criticalEvidenceProjectionFingerprint
    || presentation.fingerprint !== versionSnapshot.presentationFingerprint
    || versionSnapshot.refreshNonce !== expectedRefreshNonce
    || versionSnapshot.frameworkCatalogVersion
      !== expectedFrameworkCatalog.catalogVersion
    || versionSnapshot.frameworkCatalogFingerprint
      !== expectedFrameworkCatalog.catalogFingerprint
    || versionSnapshot.frameworkCorpusDigest
      !== expectedFrameworkCatalog.corpusDigest
  ) {
    throw new Error(
      "Current Candidate finalization checkpoint identities do not match the persisted Named Lens graph.",
    );
  }
  return {
    reportId: requiredText(reportId, "An Underwriting presentation report ID"),
    frameworkCatalog: expectedFrameworkCatalog,
    versionSnapshot,
    projectionFingerprint: projection.fingerprint,
    finalDispositionsFingerprint:
      versionSnapshot.finalDispositionsFingerprint,
    presentationFingerprint: presentation.fingerprint,
    terminalStatus,
    terminalReasonCodes,
  };
}

function requireCompletedFrameworkCatalogCheckpoint(
  checkpoints: readonly CandidateCheckpoint[],
): FrameworkCatalogBinding {
  const matching = checkpoints.filter(({ stage }) =>
    stage === "framework_catalog"
  );
  if (matching.length !== 1) {
    throw new Error(
      "Current Candidate finalization requires exactly one Framework catalog checkpoint.",
    );
  }
  const checkpoint = matching[0]!;
  if (
    checkpoint.status !== "completed"
    || checkpoint.outputPayload === null
    || checkpoint.outputFingerprint !== fingerprint({
      stage: "framework_catalog",
      inputFingerprint: checkpoint.inputFingerprint,
      result: checkpoint.outputPayload,
    })
  ) {
    throw new Error(
      "Current Candidate finalization requires a valid completed Framework catalog checkpoint.",
    );
  }
  return parseFrameworkCatalogBinding(checkpoint.outputPayload);
}

function validateFrameworkLensSelection(
  input: FrameworkLensExecutionSelection,
): FrameworkLensExecutionSelection {
  const catalogVersion = requiredText(
    input.catalogVersion,
    "A Framework catalog version",
  );
  const catalogFingerprint = requiredText(
    input.catalogFingerprint,
    "A Framework catalog fingerprint",
  );
  const corpusDigest = requiredText(
    input.corpusDigest,
    "A Framework corpus digest",
  );
  if (
    !/^sha256:[0-9a-f]{64}$/.test(catalogFingerprint)
    || !/^sha256:[0-9a-f]{64}$/.test(corpusDigest)
  ) {
    throw new Error(
      "Framework catalog and corpus fingerprints must be canonical SHA-256 digests.",
    );
  }
  return {
    catalogVersion,
    catalogFingerprint,
    corpusDigest,
    service: input.service,
  };
}

function frameworkCatalogBinding(
  selection: FrameworkLensExecutionSelection,
): FrameworkCatalogBinding {
  return {
    catalogVersion: selection.catalogVersion,
    catalogFingerprint: selection.catalogFingerprint,
    corpusDigest: selection.corpusDigest,
  };
}

function validateFrameworkCatalogBinding(
  input: FrameworkCatalogBinding,
): FrameworkCatalogBinding {
  const catalogVersion = requiredText(
    input.catalogVersion,
    "A Framework catalog version",
  );
  const catalogFingerprint = requiredText(
    input.catalogFingerprint,
    "A Framework catalog fingerprint",
  );
  const corpusDigest = requiredText(
    input.corpusDigest,
    "A Framework corpus digest",
  );
  if (
    !/^sha256:[0-9a-f]{64}$/.test(catalogFingerprint)
    || !/^sha256:[0-9a-f]{64}$/.test(corpusDigest)
  ) {
    throw new Error(
      "Framework catalog and corpus fingerprints must be canonical SHA-256 digests.",
    );
  }
  return { catalogVersion, catalogFingerprint, corpusDigest };
}

function assertFrameworkLensTimeoutPolicy(
  service: FrameworkLensService,
  expected: NamedLensProviderTimeoutPolicy,
): void {
  const actual = NamedLensProviderTimeoutPolicySchema.parse(
    service.advisoryProviderTimeoutPolicy
      ?? CURRENT_NAMED_LENS_PROVIDER_TIMEOUT_POLICY,
  );
  if (
    actual.version !== expected.version
    || actual.timeoutMs !== expected.timeoutMs
  ) {
    throw new Error(
      "Framework lens service timeout policy does not match the Candidate execution identity.",
    );
  }
}

function assertFrameworkCatalogBinding(
  selection: FrameworkLensExecutionSelection,
  binding: FrameworkCatalogBinding,
): void {
  if (
    selection.catalogVersion !== binding.catalogVersion
    || selection.catalogFingerprint !== binding.catalogFingerprint
    || selection.corpusDigest !== binding.corpusDigest
  ) {
    throw new Error(
      "The resolved Framework catalog changed after its durable selection checkpoint.",
    );
  }
}

function classifyFrameworkCatalogError(
  error: unknown,
  signal: AbortSignal,
): Error {
  if (
    signal.aborted
    && signal.reason instanceof CandidateStageTimeoutError
  ) {
    return signal.reason;
  }
  return error instanceof FrameworkCatalogResolutionError
    ? error
    : new FrameworkCatalogResolutionError(error);
}

function qualifiedCandidates(
  analyses: CompanyAnalysis[],
  historicalStatusByDeal: ReadonlyMap<string, RegisteredDeal["status"]>,
): CompanyAnalysis[] {
  return rankBeliefRevisionCandidates(analyses, {
    historicalStatusByDeal,
    limit: Number.MAX_SAFE_INTEGER,
  });
}

function assertAlignedInput(
  input: {
    scanRun: RunRecord;
    report: IntelligenceReportRecord;
    analyses: CompanyAnalysis[];
    eligibleDeals: RegisteredDeal[];
    evidenceFrame?: UnderwritingEvidenceFrameV1;
  },
  policy: FundPolicySnapshot,
): void {
  const workspaceId = input.scanRun.workspaceId;
  if (
    input.report.workspaceId !== workspaceId
    || input.report.runId !== input.scanRun.id
    || policy.workspaceId !== workspaceId
    || input.eligibleDeals.some((deal) => deal.workspaceId !== workspaceId)
  ) {
    throw new Error(
      "Underwriting batch inputs must share one workspace and scan run.",
    );
  }
  assertAlignedEvidenceFrame(input);
  const analysisIds = input.analyses.map(({ dealId }) => dealId);
  const eligibleIds = input.eligibleDeals.map(({ id }) => id);
  if (
    new Set(analysisIds).size !== analysisIds.length
    || new Set(eligibleIds).size !== eligibleIds.length
    || analysisIds.length !== eligibleIds.length
    || eligibleIds.some((dealId) => !analysisIds.includes(dealId))
  ) {
    throw new Error(
      "Every eligible Deal must retain exactly one CompanyAnalysis before underwriting selection.",
    );
  }
}

function assertAlignedEvidenceFrame(input: {
  scanRun: RunRecord;
  report: IntelligenceReportRecord;
  evidenceFrame?: UnderwritingEvidenceFrameV1;
}): void {
  const run = input.scanRun.evidenceContext;
  const report = input.report.evidenceContext ?? { state: "legacy_unbound" as const };
  if (run.state === "legacy_unbound" && report.state === "legacy_unbound") {
    if (input.evidenceFrame !== undefined) {
      throw new Error("A legacy underwriting batch cannot declare a current evidence frame.");
    }
    return;
  }
  const frame = input.evidenceFrame;
  if (
    run.state !== "current"
    || report.state !== "current"
    || frame === undefined
    || frame.schemaVersion !== "underwriting-evidence-frame-v1"
    || frame.evidenceMode !== run.evidenceMode
    || frame.evidenceMode !== report.evidenceMode
    || frame.contextFingerprint !== run.contextFingerprint
    || frame.contextFingerprint !== report.contextFingerprint
    || frame.eventSetFingerprint !== report.eventSetFingerprint
    || frame.bindingFingerprint !== report.bindingFingerprint
    || frame.snapshotFingerprint !== run.snapshotFingerprint
    || frame.snapshotFingerprint !== report.snapshotFingerprint
    || run.anchorAt !== report.anchorAt
    || run.windowStartAt !== report.windowStartAt
    || run.windowEndAt !== report.windowEndAt
    || run.windowTimezone !== report.windowTimezone
  ) {
    throw new Error("Underwriting report, run, and exact evidence frame do not align.");
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function requiredText(value: string, label: string): string {
  if (!value || value.trim() !== value) {
    throw new Error(`${label} is required without surrounding whitespace.`);
  }
  return value;
}

function terminalCandidate(
  candidate: CandidateRun,
  status: "failed" | "unavailable",
  now: Date,
): CandidateRun {
  return {
    ...candidate,
    status,
    finalizedAt: now.toISOString(),
  };
}

function statusForCandidates(
  candidates: CandidateRun[],
): UnderwritingBatch["status"] {
  if (candidates.length === 0) return "completed";
  if (candidates.every(({ status }) => status === "completed")) {
    return "completed";
  }
  if (
    candidates.every(({ status }) =>
      status === "failed" || status === "unavailable"
    )
  ) {
    return "failed";
  }
  if (
    candidates.every(({ status }) =>
      ["completed", "partial", "failed", "unavailable"].includes(status)
    )
  ) {
    return "partial";
  }
  return "running";
}

function normalizedExecution(
  input: SourceGroundedCandidateExecutionSettings,
): SourceGroundedCandidateExecutionSettings {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => {
      if (!value || value.trim() !== value) {
        throw new Error(
          `Source-grounded candidate execution ${key} must be normalized.`,
        );
      }
      return [key, value];
    }),
  ) as unknown as SourceGroundedCandidateExecutionSettings;
}

function requireReferenceDefinition(input: {
  catalog: UnderwritingReferenceCatalogSnapshot;
  expected?: ReferenceDefinitionRef;
  kind?: ReferenceDefinitionRef["kind"];
  id?: string;
}): ReferenceDefinitionRef {
  const kind = input.expected?.kind ?? input.kind;
  const id = input.expected?.id ?? input.id;
  const definition = input.catalog.definitions.find((candidate) =>
    candidate.kind === kind
    && candidate.id === id
    && (
      input.expected?.parentId === undefined
      || candidate.parentId === input.expected.parentId
    )
  );
  if (
    !definition
    || (
      input.expected !== undefined
      && (
        definition.version !== input.expected.version
        || definition.definitionFingerprint
          !== input.expected.definitionFingerprint
      )
    )
  ) {
    throw new CandidateGroundingUnavailableError([
      "REFERENCE_DEFINITION_UNAVAILABLE",
    ]);
  }
  return definition;
}

function unavailableExecution(
  reasonCodes: string[],
): CandidateUnavailableExecution {
  return {
    kind: "unavailable",
    reasonCodes: [...new Set(reasonCodes)].sort(compareUtf8),
  };
}

function budgetUnavailableExecution(
  stage: CandidateExecutionStage,
): CandidateUnavailableExecution {
  return unavailableExecution([
    `CANDIDATE_BUDGET_EXHAUSTED_${stage.toUpperCase()}`,
  ]);
}

function timeoutUnavailableExecution(
  stage: CandidateExecutionStage,
): CandidateUnavailableExecution {
  return unavailableExecution([
    `CANDIDATE_STAGE_TIMEOUT_${stage.toUpperCase()}`,
  ]);
}

function isUnavailableExecution(
  value: CandidateExecutionResult,
): value is CandidateUnavailableExecution {
  return "kind" in value && value.kind === "unavailable";
}

function snakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
}

function fingerprint(value: unknown): string {
  return `sha256:${
    createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")
  }`;
}
