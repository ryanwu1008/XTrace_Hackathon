import { createHash, randomUUID } from "node:crypto";

import type {
  CandidateFinalization,
  UnderwritingRunsRepository,
} from "../../db/repositories/underwriting-runs";
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
import type {
  CandidateRun,
  FundPolicySnapshot,
  MissingEvidenceItem,
  ResolvedUnderwritingContext,
  UnderwritingBatch,
} from "../contracts/underwriting";
import {
  canonicalJson,
  createReferenceCatalogSnapshot,
  createCandidateAnalysisFingerprint,
  type ReferenceDefinitionRef,
  type UnderwritingReferenceCatalogSnapshot,
} from "./fingerprints";
import {
  createContextRouter,
  type ContextRouter,
  type RouterResolution,
} from "./router";
import { createValuationEngine } from "./valuation/service";
import type { ValuationEngine } from "./valuation/contracts";
import type { FrameworkLensService } from "./frameworks/service";
import { IntegrationTransportError } from "../api/errors";
import {
  createDecisionEngine,
  type DecisionEngine,
} from "./decision/engine";
import { DECISION_POLICY_V1 } from "./decision/rules";
import { buildUnderwritingNarrative } from "./narrative";
import { createActionDraftGenerator } from "./action-drafts";
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
  parseNarrativeArtifacts,
  parseValuationArtifactSet,
} from "./stage-replay";
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

const MAX_AUTOMATIC_CANDIDATES = 5;
const SELECTION_POLICY_VERSION = "top-five-belief-revised-v1";
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

interface FrameworkCatalogBinding {
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
  }): Promise<UnderwritingBatch>;
  processCandidate(candidateRunId: string): Promise<CandidateRun>;
}

export function createUnderwritingOrchestrator(options: {
  runs: UnderwritingRunsRepository;
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
      ["completed", "unavailable", "failed"].includes(
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
      candidate: claimed.candidate,
      workerId: ORCHESTRATOR_WORKER_ID,
      leaseToken: claimed.leaseToken,
      budget,
      onWarning: options.onWarning,
      now,
    });
    let finalization: CandidateExecutionResult | undefined;
    try {
      finalization = await options.candidateExecutor({
        candidate: claimed.candidate,
        analysis: planned.analysis,
        deal: planned.deal,
        fundPolicy: planned.fundPolicy,
        batchInputFingerprint: planned.batchInputFingerprint,
        referenceCatalog,
        workerId: ORCHESTRATOR_WORKER_ID,
        leaseToken: claimed.leaseToken,
        budget,
        stages,
        signal: controller.signal,
      });
    } catch {}
    if (!finalization) {
      const finalizationInputFingerprint = fingerprint({
        stage: "finalization",
        candidateRunId,
        batchInputFingerprint: planned.batchInputFingerprint,
      });
      try {
        await options.runs.saveCheckpoint({
          candidateRunId,
          stage: "finalization",
          status: "failed",
          inputFingerprint: finalizationInputFingerprint,
          outputFingerprint: null,
          outputPayload: null,
          attemptCount: 1,
          costUnits: 0,
          tokenUnits: 0,
          actualTokenUnits: 0,
          providerAttempts: [],
          reasonCode: "CANDIDATE_BOUNDED_EXECUTION_FAILED",
          publicReason:
            "Candidate underwriting failed during bounded stage execution.",
          savedAt: now().toISOString(),
          workerId: ORCHESTRATOR_WORKER_ID,
          leaseToken: claimed.leaseToken,
        });
      } catch {}
      await options.runs.markCandidateFailed({
        candidateRunId,
        publicReason: "Candidate underwriting failed after bounded retries.",
      });
      options.onWarning?.(
        `Candidate ${planned.deal.id} underwriting failed during bounded stage execution; completed candidates remain available.`,
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
    const {
      workerId: _checkpointWorkerId,
      leaseToken: _checkpointLeaseToken,
      candidateRunId: _checkpointCandidateRunId,
      ...durableFinalizationPayload
    } = payload;
    const finalizationInputFingerprint = fingerprint({
      stage: "finalization",
      candidateRunId,
      batchInputFingerprint: planned.batchInputFingerprint,
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
    } catch {
      const publicReason =
        "Candidate underwriting could not be atomically finalized.";
      await options.runs.markCandidateFailed({
        candidateRunId,
        publicReason,
      });
      options.onWarning?.(
        `Candidate ${planned.deal.id} finalization failed; previously completed candidates remain available.`,
      );
      const failed = terminalCandidate(claimed.candidate, "failed", now());
      planned.candidate = failed;
      return failed;
    }
  };

  return {
    async createBatchAndSelections(input) {
      const policy = await options.activeFundPolicy(
        input.scanRun.workspaceId,
      );
      assertAlignedInput(input, policy);
      const batchInputFingerprint = createOrchestrationFingerprint({
        ...input,
        policy,
        executionBudget: budget,
        candidateExecutionFingerprint,
        referenceCatalog,
      });
      const ordinaryBatch = await options.runs.createOrReuseBatch({
        workspaceId: input.scanRun.workspaceId,
        scanRunId: input.scanRun.id,
        batchInputFingerprint,
        fundPolicySnapshotId: policy.id,
        forceRefresh: false,
        refreshNonce: null,
        rerunOfId: null,
      });
      const batch = input.forceRefresh
        ? await options.runs.createOrReuseBatch({
            workspaceId: input.scanRun.workspaceId,
            scanRunId: input.scanRun.id,
            batchInputFingerprint,
            fundPolicySnapshotId: policy.id,
            forceRefresh: true,
            refreshNonce: refreshNonce(),
            rerunOfId: ordinaryBatch.id,
          })
        : ordinaryBatch;
      const qualified = qualifiedCandidates(
        input.analyses,
        new Map(input.eligibleDeals.map((deal) => [deal.id, deal.status])),
      );
      const ranked = qualified.slice(0, MAX_AUTOMATIC_CANDIDATES);
      const truncatedDealIds = new Set(
        qualified.slice(MAX_AUTOMATIC_CANDIDATES)
          .map(({ dealId }) => dealId),
      );
      const ranks = new Map(
        ranked.map((analysis, index) => [
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
                reason: truncatedDealIds.has(deal.id)
                  ? "Truncation warning: candidate exceeded the automatic Top-5 budget; this is not negative evidence or a Pass decision."
                  : "Not selected by the medium/high belief-revised eligibility policy; this is not a Pass decision.",
              }
            : {
                dealId: deal.id,
                status: "selected" as const,
                rank,
                reason:
                  `Selected at rank ${rank} by ${SELECTION_POLICY_VERSION}.`,
              };
        }),
      });
      const candidates = await options.runs.createSelectedCandidates({
        batchId: batch.id,
        dealIds: ranked.map(({ dealId }) => dealId),
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

export function createSourceGroundedCandidateExecutor(options: {
  grounding: CandidateGroundingPort;
  frameworkLenses?: FrameworkLensService;
  resolveFrameworkLenses?: (
    context: ResolvedUnderwritingContext,
    signal?: AbortSignal,
  ) => Promise<FrameworkLensExecutionSelection>;
  router?: ContextRouter;
  valuation?: ValuationEngine;
  decision?: DecisionEngine;
  execution: SourceGroundedCandidateExecutionSettings;
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
  const router = options.router ?? createContextRouter();
  const valuation = options.valuation ?? createValuationEngine({
    now: options.now,
  });
  const decision = options.decision ?? createDecisionEngine();
  const now = options.now ?? (() => new Date());
  const execution = normalizedExecution(options.execution);

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
    let snapshot: CandidateGroundingSnapshot;
    let resolution: RouterResolution;
    try {
      snapshot = await input.stages.run({
        stage: "context_router",
        inputFingerprint: fingerprint({
          stage: "context_router",
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
    if (
      pack.coverage.underwritingStatus === "unavailable"
      || !pack.coverage.minimumModelInputsComplete
    ) {
      return unavailableExecution(
        pack.coverage.reasonCodes.length > 0
          ? pack.coverage.reasonCodes
          : ["MISSING_MINIMUM_MODEL_INPUTS"],
      );
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
      operation: () => valuation.evaluateDetailed({
        pack,
        context,
        fundPolicy: input.fundPolicy,
      }),
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
      frameworkCatalog = options.resolveFrameworkLenses
        ? await input.stages.run({
          stage: "framework_catalog",
          inputFingerprint: fingerprint({
            stage: "framework_catalog",
            candidateId: input.candidate.id,
            context,
            execution,
          }),
          parseOutput: parseFrameworkCatalogBinding,
          operation: async (signal) => {
            try {
              resolvedFrameworkSelection = validateFrameworkLensSelection(
                await options.resolveFrameworkLenses!(context, signal),
              );
              return frameworkCatalogBinding(resolvedFrameworkSelection);
            } catch (error) {
              throw classifyFrameworkCatalogError(error, signal);
            }
          },
        })
        : null;
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
      const frameworkInputFingerprint = fingerprint({
        stage: "framework_lenses",
        candidate: input.candidate,
        pack,
        context,
        calculations: valuationArtifacts.calculations,
        execution,
        frameworkCatalog: {
          version: frameworkCatalog?.catalogVersion ?? null,
          fingerprint: frameworkCatalog?.catalogFingerprint ?? null,
          corpusDigest: frameworkCatalog?.corpusDigest ?? null,
        },
      });
      lensResult = await input.stages.run({
        stage: "framework_lenses",
        inputFingerprint: frameworkInputFingerprint,
        parseOutput: parseFrameworkLensResult,
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
                frameworkCatalog!,
              );
              service = resolvedFrameworkSelection.service;
            } catch (error) {
              throw classifyFrameworkCatalogError(error, signal);
            }
          }
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
    const formalDecision = await input.stages.run({
      stage: "decision",
      inputFingerprint: fingerprint({
        stage: "decision",
        pack,
        judgments: lensResult.judgments,
        valuation: valuationArtifacts.evaluation,
        fundPolicy: input.fundPolicy,
        context,
        decisionPolicy: DECISION_POLICY_V1,
      }),
      parseOutput: parseDecisionResult,
      operation: () => decision.decide({
        pack,
        coverage: pack.coverage,
        judgments: lensResult.judgments,
        valuation: valuationArtifacts.evaluation,
        fundPolicy: input.fundPolicy,
        context,
        decisionPolicy: DECISION_POLICY_V1,
      }),
    });
    const narrativeArtifacts = await input.stages.run({
      stage: "narrative_drafts",
      inputFingerprint: fingerprint({
        stage: "narrative_drafts",
        pack,
        calculations: valuationArtifacts.calculations,
        judgments: lensResult.judgments,
        disagreements: lensResult.disagreements,
        decision: formalDecision,
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
        const missingEvidence =
          pack.coverage.missingFieldIds.map<MissingEvidenceItem>(
            (fieldId) => ({
              fieldId,
              label: fieldId.replaceAll("_", " "),
              reasonCode: "MISSING_CRITICAL_EVIDENCE",
              mostLikelyDecisionImpact:
                "Providing accepted evidence may raise or lower the formal decision ceiling.",
            }),
          );
        const actionDrafts = createActionDraftGenerator({
          workspaceId: input.candidate.workspaceId,
          now,
        }).generate({
          candidateRunId: input.candidate.id,
          decision: formalDecision,
          missingEvidence,
          judgments: lensResult.judgments,
          disagreements: lensResult.disagreements,
          recommendedNextSteps: [
            "Review source-backed missing evidence with the investment team.",
            "Request exact round terms and operating metrics from the founder.",
          ],
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
    const candidateAnalysisFingerprint = createCandidateAnalysisFingerprint({
      workspaceId: input.candidate.workspaceId,
      batchInputFingerprint: input.batchInputFingerprint,
      dealRevision: {
        dealId: input.deal.id,
        status: input.deal.status,
        sourceRevisionIds: input.deal.activeSourceRevisionIds,
        fingerprint: dealFingerprint,
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
      },
      criticalEvidenceProfile,
      benchmark,
      valuationMethodPolicy,
      frameworkPack,
      decisionPolicy,
      referenceCatalogFingerprint:
        input.referenceCatalog.definitionFingerprint,
      frameworkCatalog: frameworkCatalog
        ? {
          version: frameworkCatalog.catalogVersion,
          fingerprint: frameworkCatalog.catalogFingerprint,
          corpusDigest: frameworkCatalog.corpusDigest,
        }
        : null,
      formulaVersions,
      providerModel: execution.providerModel,
      promptVersion: execution.promptVersion,
      schemaVersion: execution.schemaVersion,
      settingsFingerprint: execution.settingsFingerprint,
      applicationCommit: execution.applicationCommit,
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
      versionSnapshot: {
        fundPolicyId: input.fundPolicy.id,
        benchmarkPackId: context.benchmarkPackId,
        benchmarkEntryId: benchmark?.id ?? null,
        benchmarkDefinitionFingerprint:
          benchmark?.definitionFingerprint ?? null,
        frameworkPackId: context.frameworkPackId,
        frameworkPackDefinitionFingerprint:
          frameworkPack.definitionFingerprint,
        routerVersion: "context-router-v1",
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
        ...(frameworkCatalog
          ? {
            frameworkCatalogVersion: frameworkCatalog.catalogVersion,
            frameworkCatalogFingerprint:
              frameworkCatalog.catalogFingerprint,
            frameworkCorpusDigest: frameworkCatalog.corpusDigest,
          }
          : {}),
        formulaVersions,
        providerModel: execution.providerModel,
        promptVersion: execution.promptVersion,
        schemaVersion: execution.schemaVersion,
        settingsFingerprint: execution.settingsFingerprint,
        applicationCommit: execution.applicationCommit,
      },
    };
  };
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

function createOrchestrationFingerprint(
  input: {
    scanRun: RunRecord;
    report: IntelligenceReportRecord;
    analyses: CompanyAnalysis[];
    eligibleDeals: RegisteredDeal[];
    policy: FundPolicySnapshot;
    executionBudget: CandidateExecutionBudget;
    candidateExecutionFingerprint: string;
    referenceCatalog: UnderwritingReferenceCatalogSnapshot;
  },
): string {
  const value = canonicalJson({
    kind: "underwriting-orchestration-v2",
    scan: {
      id: input.scanRun.id,
      workspaceId: input.scanRun.workspaceId,
      mode: input.scanRun.mode,
      windowDays: input.scanRun.windowDays,
      createdAt: input.scanRun.createdAt,
    },
    immutableReport: input.report,
    eligibleDeals: [...input.eligibleDeals]
      .sort((left, right) => compareUtf8(left.id, right.id)),
    companyAnalyses: [...input.analyses]
      .sort((left, right) => compareUtf8(left.dealId, right.dealId)),
    fundPolicy: input.policy,
    selectionPolicyVersion: SELECTION_POLICY_VERSION,
    executionBudget: input.executionBudget,
    candidateExecutionFingerprint: input.candidateExecutionFingerprint,
    referenceCatalog: input.referenceCatalog,
    routerVersion: "context-router-v1",
    evidencePackBuilderVersion: "evidence_pack_builder_v2",
    decisionPolicyVersion: DECISION_POLICY_V1.version,
  });
  return `sha256:${
    createHash("sha256").update(value, "utf8").digest("hex")
  }`;
}

function assertAlignedInput(
  input: {
    scanRun: RunRecord;
    report: IntelligenceReportRecord;
    analyses: CompanyAnalysis[];
    eligibleDeals: RegisteredDeal[];
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
      ["completed", "failed", "unavailable"].includes(status)
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
