import {
  ClaudeCompletionTruncatedError,
  type ClaudeTokenUsage,
  type MeasuredClaudeCompletion,
} from "../claude/client";
import { IntegrationTransportError } from "../api/errors";
import {
  CandidateCheckpointSchema,
  type CandidateCheckpoint,
  type CandidateRun,
} from "../contracts/underwriting";
import type {
  UnderwritingRunsRepository,
} from "../../db/repositories/underwriting-runs";
import type {
  NamedLensArtifactsRepository,
  NamedLensProviderAttemptReservation,
} from "../../db/repositories/named-lens-artifacts";
import { createCanonicalFingerprint } from "./fingerprints";

export type CandidateExecutionStage = Exclude<
  CandidateCheckpoint["stage"],
  "finalization"
>;

export interface CandidateStagePolicy {
  timeoutMs: number;
  maxAttempts: number;
  costUnits: number;
  tokenUnits: number;
}

export interface CandidateExecutionBudget {
  maxCostUnits: number;
  maxTokenUnits: number;
  maxConcurrency: 1;
  stages: Record<CandidateExecutionStage, CandidateStagePolicy>;
}

export interface CandidateStageRuntime {
  run<T>(input: {
    stage: CandidateExecutionStage;
    inputFingerprint: string;
    parseOutput(value: unknown): T;
    operation(signal: AbortSignal): Promise<T> | T;
  }): Promise<T>;
  runProviderAttempt(input: {
    stage: "framework_lenses";
    inputFingerprint: string;
    attemptFingerprint: string;
    costUnits: number;
    tokenUnits: number;
    namedLensAttempt?: {
      judgmentOrCatalogCandidateId: string;
      logicalPassageId: string;
      attemptNumber: number;
    };
    operation(): Promise<MeasuredClaudeCompletion>;
  }): Promise<MeasuredClaudeCompletion>;
  usage(): {
    costUnits: number;
    tokenUnits: number;
    actualTokenUnits: number;
    remainingCostUnits: number;
    remainingTokenUnits: number;
  };
}

export class CandidateBudgetExhaustedError extends Error {
  readonly stage: CandidateExecutionStage;

  constructor(stage: CandidateExecutionStage) {
    super(`Candidate budget was exhausted before ${stage}.`);
    this.name = "CandidateBudgetExhaustedError";
    this.stage = stage;
  }
}

export class CandidateStageTimeoutError extends Error {
  readonly stage: CandidateExecutionStage;

  constructor(stage: CandidateExecutionStage) {
    super(`Candidate stage ${stage} exceeded its bounded timeout.`);
    this.name = "CandidateStageTimeoutError";
    this.stage = stage;
  }
}

export class CandidateCheckpointReplayError extends Error {
  readonly stage: CandidateExecutionStage;

  constructor(stage: CandidateExecutionStage, message: string) {
    super(message);
    this.name = "CandidateCheckpointReplayError";
    this.stage = stage;
  }
}

export class CandidateProviderAttemptReplayError extends Error {
  readonly stage = "framework_lenses" as const;
  readonly attemptFingerprint: string;

  constructor(attemptFingerprint: string) {
    super(
      `Provider attempt ${attemptFingerprint} was already durably recorded and cannot be repeated.`,
    );
    this.name = "CandidateProviderAttemptReplayError";
    this.attemptFingerprint = attemptFingerprint;
  }
}

export function createCandidateStagePolicies(input: {
  timeoutMs: number;
  retryableAttempts: number;
  overrides?: Partial<
    Record<CandidateExecutionStage, Partial<CandidateStagePolicy>>
  >;
}): Record<CandidateExecutionStage, CandidateStagePolicy> {
  const retryable = (costUnits: number, tokenUnits: number) => ({
    timeoutMs: input.timeoutMs,
    maxAttempts: input.retryableAttempts,
    costUnits,
    tokenUnits,
  });
  const deterministic = {
    timeoutMs: input.timeoutMs,
    maxAttempts: 1,
    costUnits: 0,
    tokenUnits: 0,
  };
  const defaults: Record<CandidateExecutionStage, CandidateStagePolicy> = {
    context_router: { ...deterministic },
    evidence_pack: retryable(0, 0),
    valuation: { ...deterministic },
    framework_catalog: retryable(0, 0),
    framework_lenses: { ...deterministic },
    decision: { ...deterministic },
    narrative_drafts: { ...deterministic },
  };
  return Object.fromEntries(
    Object.entries(defaults).map(([stage, policy]) => {
      const candidate = {
        ...policy,
        ...(input.overrides?.[stage as CandidateExecutionStage] ?? {}),
      };
      return [
        stage,
        {
          timeoutMs: positiveInteger(
            candidate.timeoutMs,
            `${stage} timeout`,
          ),
          maxAttempts: positiveInteger(
            candidate.maxAttempts,
            `${stage} attempts`,
          ),
          costUnits: nonNegativeInteger(
            candidate.costUnits,
            `${stage} cost units`,
          ),
          tokenUnits: nonNegativeInteger(
            candidate.tokenUnits,
            `${stage} token units`,
          ),
        },
      ];
    }),
  ) as Record<CandidateExecutionStage, CandidateStagePolicy>;
}

export async function createCandidateStageRuntime(input: {
  runs: UnderwritingRunsRepository;
  namedLensArtifacts?: NamedLensArtifactsRepository;
  candidate: CandidateRun;
  workerId: string;
  leaseToken: string;
  budget: CandidateExecutionBudget;
  onWarning?: (warning: string) => void;
  now: () => Date;
}): Promise<CandidateStageRuntime> {
  let consumedCostUnits = 0;
  let consumedTokenUnits = 0;
  let consumedActualTokenUnits = 0;
  const checkpoints = new Map<
    CandidateCheckpoint["stage"],
    CandidateCheckpoint
  >();
  let initialization: Promise<void> | undefined;
  let ledgerMutationTail = Promise.resolve();
  const activeNamedLensAttempts = new Map<
    string,
    NamedLensProviderAttemptReservation & { inputFingerprint: string }
  >();

  const mutateProviderLedger = async <T>(
    mutation: () => Promise<T>,
  ): Promise<T> => {
    const prior = ledgerMutationTail;
    let release!: () => void;
    ledgerMutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;
    try {
      return await mutation();
    } finally {
      release();
    }
  };

  const initialize = async (): Promise<void> => {
    initialization ??= (async () => {
      const persisted = await input.runs.listCheckpoints({
        workspaceId: input.candidate.workspaceId,
        candidateRunId: input.candidate.id,
      });
      for (const checkpoint of persisted) {
        checkpoints.set(checkpoint.stage, structuredClone(checkpoint));
        consumedCostUnits += checkpoint.costUnits;
        consumedTokenUnits += checkpoint.tokenUnits;
        consumedActualTokenUnits += checkpoint.actualTokenUnits;
      }
    })();
    await initialization;
  };

  const usage = () => ({
    costUnits: consumedCostUnits,
    tokenUnits: consumedTokenUnits,
    actualTokenUnits: consumedActualTokenUnits,
    remainingCostUnits: Math.max(
      0,
      input.budget.maxCostUnits - consumedCostUnits,
    ),
    remainingTokenUnits: Math.max(
      0,
      input.budget.maxTokenUnits - consumedTokenUnits,
    ),
  });

  const save = async (
    checkpoint: CandidateCheckpoint,
  ): Promise<CandidateCheckpoint> => {
    const parsed = CandidateCheckpointSchema.parse(checkpoint);
    await input.runs.saveCheckpoint({
      ...parsed,
      workerId: input.workerId,
      leaseToken: input.leaseToken,
    });
    checkpoints.set(parsed.stage, structuredClone(parsed));
    return parsed;
  };

  const stateFor = (
    stage: CandidateExecutionStage,
    inputFingerprint: string,
  ): CandidateCheckpoint => {
    const persisted = checkpoints.get(stage);
    if (
      persisted
      && persisted.inputFingerprint !== inputFingerprint
    ) {
      throw new CandidateCheckpointReplayError(
        stage,
        `Checkpoint input for ${stage} does not match the immutable stage input.`,
      );
    }
    return persisted ?? CandidateCheckpointSchema.parse({
      candidateRunId: input.candidate.id,
      stage,
      status: "running",
      inputFingerprint,
      outputFingerprint: null,
      outputPayload: null,
      attemptCount: 0,
      costUnits: 0,
      tokenUnits: 0,
      actualTokenUnits: 0,
      providerAttempts: [],
      reasonCode: null,
      publicReason: null,
      savedAt: input.now().toISOString(),
    });
  };

  const failure = (
    stage: CandidateExecutionStage,
    kind: "budget" | "timeout" | "execution",
  ): { reasonCode: string; publicReason: string } => {
    if (kind === "budget" && stage === "framework_lenses") {
      return {
        reasonCode: "CANDIDATE_PROVIDER_BUDGET_EXHAUSTED_FRAMEWORK_LENSES",
        publicReason:
          "Truncation warning: framework lenses exhausted their execution budget; no negative judgment was inferred.",
      };
    }
    if (kind === "timeout" && stage === "framework_lenses") {
      return {
        reasonCode: "CANDIDATE_STAGE_TIMEOUT_FRAMEWORK_LENSES",
        publicReason:
          "Truncation warning: framework lenses timed out; no negative judgment was inferred.",
      };
    }
    return {
      reasonCode:
        `CANDIDATE_STAGE_${kind.toUpperCase()}_${stage.toUpperCase()}`,
      publicReason: kind === "budget"
        ? `Truncation warning: ${stage} exhausted its execution budget.`
        : kind === "timeout"
        ? `Truncation warning: ${stage} timed out.`
        : `${stage} failed after bounded execution.`,
    };
  };

  await initialize();

  return {
    usage,
    async run<T>(request: {
      stage: CandidateExecutionStage;
      inputFingerprint: string;
      parseOutput(value: unknown): T;
      operation(signal: AbortSignal): Promise<T> | T;
    }): Promise<T> {
      await initialize();
      const policy = input.budget.stages[request.stage];
      let stageState = stateFor(
        request.stage,
        request.inputFingerprint,
      );
      if (stageState.status === "completed") {
        const replayFingerprint = createCanonicalFingerprint({
          stage: request.stage,
          inputFingerprint: request.inputFingerprint,
          result: stageState.outputPayload,
        });
        if (stageState.outputFingerprint !== replayFingerprint) {
          throw new CandidateCheckpointReplayError(
            request.stage,
            `Completed ${request.stage} checkpoint output fingerprint does not match its payload.`,
          );
        }
        let replayed: T;
        try {
          replayed = request.parseOutput(stageState.outputPayload);
        } catch (error) {
          throw new CandidateCheckpointReplayError(
            request.stage,
            `Completed ${request.stage} checkpoint output failed contract validation: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        return replayed;
      }

      // Catalog loading has no provider cost. A reclaimed lease receives a
      // fresh bounded retry window without erasing the durable attempt audit.
      const attemptCeiling = request.stage === "framework_catalog"
        ? stageState.attemptCount + policy.maxAttempts
        : policy.maxAttempts;
      while (stageState.attemptCount < attemptCeiling) {
        if (
          consumedCostUnits + policy.costUnits
            > input.budget.maxCostUnits
          || consumedTokenUnits + policy.tokenUnits
            > input.budget.maxTokenUnits
        ) {
          const details = failure(request.stage, "budget");
          stageState = await save({
            ...stageState,
            status: "failed",
            reasonCode: details.reasonCode,
            publicReason: details.publicReason,
            savedAt: input.now().toISOString(),
          });
          input.onWarning?.(
            `Candidate ${input.candidate.dealId}: ${details.publicReason}`,
          );
          throw new CandidateBudgetExhaustedError(request.stage);
        }
        consumedCostUnits += policy.costUnits;
        consumedTokenUnits += policy.tokenUnits;
        stageState = await save({
          ...stageState,
          status: "running",
          outputFingerprint: null,
          outputPayload: null,
          attemptCount: stageState.attemptCount + 1,
          costUnits: stageState.costUnits + policy.costUnits,
          tokenUnits: stageState.tokenUnits + policy.tokenUnits,
          reasonCode: null,
          publicReason: null,
          savedAt: input.now().toISOString(),
        });
        const controller = new AbortController();
        let result: T;
        try {
          const rawResult = await withTimeout(
            Promise.resolve().then(() =>
              request.operation(controller.signal)
            ),
            policy.timeoutMs,
            controller,
            request.stage,
          );
          result = request.parseOutput(rawResult);
        } catch (error) {
          const retryable = error instanceof IntegrationTransportError
            && error.retryable
            && stageState.attemptCount < attemptCeiling;
          if (retryable) {
            stageState = stateFor(
              request.stage,
              request.inputFingerprint,
            );
            continue;
          }
          let current = stateFor(
            request.stage,
            request.inputFingerprint,
          );
          const kind = error instanceof CandidateStageTimeoutError
            ? "timeout"
            : error instanceof CandidateBudgetExhaustedError
            ? "budget"
            : "execution";
          if (kind === "timeout" && request.stage === "framework_lenses") {
            for (const [attemptFingerprint, reservation] of
              activeNamedLensAttempts) {
              if (reservation.inputFingerprint !== request.inputFingerprint) {
                continue;
              }
              await input.namedLensArtifacts!.settleAttempt({
                ...reservation,
                status: "aborted",
                telemetry: null,
                failureReason: {
                  code: "timeout",
                  detail: "The framework stage timed out before provider completion.",
                  retryable: false,
                },
              });
              activeNamedLensAttempts.delete(attemptFingerprint);
              current = updateProviderAttempt({
                checkpoint: current,
                attemptFingerprint,
                status: "aborted",
                actualCostUnits: 0,
                actualTokenUnits: 0,
                usageKnown: false,
                savedAt: input.now().toISOString(),
              });
            }
          }
          const details = failure(request.stage, kind);
          stageState = await save({
            ...current,
            status: "failed",
            outputFingerprint: null,
            outputPayload: null,
            reasonCode: details.reasonCode,
            publicReason: details.publicReason,
            savedAt: input.now().toISOString(),
          });
          if (kind === "budget" || kind === "timeout") {
            input.onWarning?.(
              `Candidate ${input.candidate.dealId}: ${details.publicReason}`,
            );
          }
          throw error;
        }
        const current = stateFor(
          request.stage,
          request.inputFingerprint,
        );
        stageState = await save({
          ...current,
          status: "completed",
          outputFingerprint: createCanonicalFingerprint({
            stage: request.stage,
            inputFingerprint: request.inputFingerprint,
            result,
          }),
          outputPayload: structuredClone(result),
          reasonCode: null,
          publicReason: null,
          savedAt: input.now().toISOString(),
        });
        return result;
      }
      const details = failure(request.stage, "execution");
      if (stageState.status !== "failed") {
        await save({
          ...stageState,
          status: "failed",
          reasonCode: details.reasonCode,
          publicReason: details.publicReason,
          savedAt: input.now().toISOString(),
        });
      }
      throw new Error(`${request.stage} exhausted its bounded attempts.`);
    },
    async runProviderAttempt(request): Promise<MeasuredClaudeCompletion> {
      await initialize();
      const requestedCostUnits = nonNegativeInteger(
        request.costUnits,
        "Provider attempt cost units",
      );
      const requestedTokenUnits = nonNegativeInteger(
        request.tokenUnits,
        "Provider attempt token units",
      );
      const namedLensIdentity = request.namedLensAttempt
        ? {
          workspaceId: input.candidate.workspaceId,
          artifactSourceCandidateRunId: input.candidate.id,
          judgmentOrCatalogCandidateId:
            request.namedLensAttempt.judgmentOrCatalogCandidateId,
          logicalPassageId: request.namedLensAttempt.logicalPassageId,
          attemptNumber: request.namedLensAttempt.attemptNumber,
          attemptFingerprint: request.attemptFingerprint,
          workerId: input.workerId,
          leaseToken: input.leaseToken,
        }
        : null;
      if (namedLensIdentity && !input.namedLensArtifacts) {
        throw new Error(
          "Named Lens provider execution requires its shared artifact repository.",
        );
      }
      await mutateProviderLedger(async () => {
        const stageState = stateFor(
          request.stage,
          request.inputFingerprint,
        );
        if (stageState.status !== "running") {
          throw new CandidateCheckpointReplayError(
            request.stage,
            "A provider attempt requires an active framework stage checkpoint.",
          );
        }
        if (
          stageState.providerAttempts.some(
            ({ attemptFingerprint }) =>
              attemptFingerprint === request.attemptFingerprint,
          )
        ) {
          throw new CandidateProviderAttemptReplayError(
            request.attemptFingerprint,
          );
        }
        if (
          consumedCostUnits + requestedCostUnits
            > input.budget.maxCostUnits
          || consumedTokenUnits + requestedTokenUnits
            > input.budget.maxTokenUnits
        ) {
          const details = failure(request.stage, "budget");
          await save({
            ...stageState,
            status: "failed",
            reasonCode: details.reasonCode,
            publicReason: details.publicReason,
            savedAt: input.now().toISOString(),
          });
          input.onWarning?.(
            `Candidate ${input.candidate.dealId}: ${details.publicReason}`,
          );
          throw new CandidateBudgetExhaustedError(request.stage);
        }
        if (namedLensIdentity) {
          await input.namedLensArtifacts!.reserveAttempt(namedLensIdentity);
          activeNamedLensAttempts.set(request.attemptFingerprint, {
            ...namedLensIdentity,
            inputFingerprint: request.inputFingerprint,
          });
        }
        try {
          await save({
            ...stageState,
            costUnits: stageState.costUnits + requestedCostUnits,
            tokenUnits: stageState.tokenUnits + requestedTokenUnits,
            providerAttempts: [
              ...stageState.providerAttempts,
              {
                attemptFingerprint: request.attemptFingerprint,
                status: "reserved",
                reservedCostUnits: requestedCostUnits,
                reservedTokenUnits: requestedTokenUnits,
                actualCostUnits: 0,
                actualTokenUnits: 0,
                usageKnown: false,
              },
            ],
            savedAt: input.now().toISOString(),
          });
        } catch (error) {
          if (namedLensIdentity) {
            await input.namedLensArtifacts!.settleAttempt({
              ...namedLensIdentity,
              status: "aborted",
              telemetry: null,
              failureReason: {
                code: "aborted",
                detail:
                  "Checkpoint reservation failed after durable attempt reservation.",
                retryable: false,
              },
            });
            activeNamedLensAttempts.delete(request.attemptFingerprint);
          }
          throw error;
        }
        consumedCostUnits += requestedCostUnits;
        consumedTokenUnits += requestedTokenUnits;
      });

      let completion: MeasuredClaudeCompletion;
      const providerStartedAt = input.now().getTime();
      try {
        completion = await request.operation();
      } catch (error) {
        if (
          namedLensIdentity
          && !activeNamedLensAttempts.has(request.attemptFingerprint)
        ) {
          throw new CandidateProviderAttemptReplayError(
            request.attemptFingerprint,
          );
        }
        const actualTokenUnits = error instanceof ClaudeCompletionTruncatedError
          ? measuredTokenUnits(error.usage)
          : 0;
        const usageKnown = error instanceof ClaudeCompletionTruncatedError;
        if (
          namedLensIdentity
          && activeNamedLensAttempts.has(request.attemptFingerprint)
        ) {
          const aborted = error instanceof CandidateStageTimeoutError;
          await input.namedLensArtifacts!.settleAttempt({
            ...namedLensIdentity,
            status: aborted ? "aborted" : "failed",
            telemetry: null,
            failureReason: {
              code: aborted
                ? "timeout"
                : error instanceof IntegrationTransportError
                ? "transport_error"
                : "provider_error",
              detail: error instanceof Error
                ? error.message
                : "Named Lens provider execution failed.",
              retryable: error instanceof IntegrationTransportError
                && error.retryable,
            },
          });
          activeNamedLensAttempts.delete(request.attemptFingerprint);
        }
        await mutateProviderLedger(async () => {
          const current = stateFor(
            request.stage,
            request.inputFingerprint,
          );
          const timedOut = error instanceof CandidateStageTimeoutError;
          const details = timedOut
            ? failure(request.stage, "timeout")
            : null;
          const settled = updateProviderAttempt({
            checkpoint: {
              ...current,
              status: timedOut ? "failed" : current.status,
              reasonCode: details?.reasonCode ?? current.reasonCode,
              publicReason: details?.publicReason ?? current.publicReason,
            },
            attemptFingerprint: request.attemptFingerprint,
            status: timedOut ? "aborted" : "failed",
            actualCostUnits: usageKnown ? requestedCostUnits : 0,
            actualTokenUnits,
            usageKnown,
            savedAt: input.now().toISOString(),
          });
          await save(settled);
          consumedCostUnits += settled.costUnits - current.costUnits;
          consumedTokenUnits += settled.tokenUnits - current.tokenUnits;
          consumedActualTokenUnits +=
            settled.actualTokenUnits - current.actualTokenUnits;
        });
        throw error;
      }

      const actualTokenUnits = measuredTokenUnits(completion.usage);
      if (namedLensIdentity) {
        if (!activeNamedLensAttempts.has(request.attemptFingerprint)) {
          throw new CandidateProviderAttemptReplayError(
            request.attemptFingerprint,
          );
        }
        await input.namedLensArtifacts!.settleAttempt({
          ...namedLensIdentity,
          status: "completed",
          telemetry: {
            inputTokens: completion.usage.inputTokens,
            outputTokens: completion.usage.outputTokens,
            costUsd: completion.costUsd?.amount ?? null,
            costUsdPricingVersion:
              completion.costUsd?.pricingVersion ?? null,
            costUsdUnavailableReason: completion.costUsd
              ? null
              : "provider_cost_unavailable",
            latencyMs: Math.max(0, input.now().getTime() - providerStartedAt),
          },
          failureReason: null,
        });
        activeNamedLensAttempts.delete(request.attemptFingerprint);
      }
      await mutateProviderLedger(async () => {
        const current = stateFor(
          request.stage,
          request.inputFingerprint,
        );
        const settled = updateProviderAttempt({
          checkpoint: current,
          attemptFingerprint: request.attemptFingerprint,
          status: "completed",
          actualCostUnits: requestedCostUnits,
          actualTokenUnits,
          usageKnown: true,
          savedAt: input.now().toISOString(),
        });
        await save(settled);
        consumedCostUnits += settled.costUnits - current.costUnits;
        consumedTokenUnits += settled.tokenUnits - current.tokenUnits;
        consumedActualTokenUnits +=
          settled.actualTokenUnits - current.actualTokenUnits;
      });
      return completion;
    },
  };
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  controller: AbortController,
  stage: CandidateExecutionStage,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      const error = new CandidateStageTimeoutError(stage);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
    timeout.unref?.();
  });
  try {
    return await Promise.race([operation, expired]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function updateProviderAttempt(input: {
  checkpoint: CandidateCheckpoint;
  attemptFingerprint: string;
  status: "completed" | "failed" | "aborted";
  actualCostUnits: number;
  actualTokenUnits: number;
  usageKnown: boolean;
  savedAt: string;
}): CandidateCheckpoint {
  let found = false;
  let costUnits = input.checkpoint.costUnits;
  let tokenUnits = input.checkpoint.tokenUnits;
  const providerAttempts = input.checkpoint.providerAttempts.map(
    (attempt) => {
      if (attempt.attemptFingerprint !== input.attemptFingerprint) {
        return attempt;
      }
      found = true;
      const settledAttempt = {
        ...attempt,
        status: input.status,
        actualCostUnits: input.actualCostUnits,
        actualTokenUnits: input.actualTokenUnits,
        usageKnown: input.usageKnown,
      };
      costUnits += enforcedCostUnits(settledAttempt)
        - enforcedCostUnits(attempt);
      tokenUnits += enforcedTokenUnits(settledAttempt)
        - enforcedTokenUnits(attempt);
      return settledAttempt;
    },
  );
  if (!found) {
    throw new Error("The provider reservation disappeared before settlement.");
  }
  return CandidateCheckpointSchema.parse({
    ...input.checkpoint,
    providerAttempts,
    costUnits,
    tokenUnits,
    actualTokenUnits:
      input.checkpoint.actualTokenUnits + input.actualTokenUnits,
    savedAt: input.savedAt,
  });
}

function enforcedCostUnits(
  attempt: CandidateCheckpoint["providerAttempts"][number],
): number {
  return attempt.usageKnown
    ? attempt.actualCostUnits
    : attempt.reservedCostUnits;
}

function enforcedTokenUnits(
  attempt: CandidateCheckpoint["providerAttempts"][number],
): number {
  return attempt.usageKnown
    ? attempt.actualTokenUnits
    : attempt.reservedTokenUnits;
}

function measuredTokenUnits(usage: ClaudeTokenUsage): number {
  return [
    ["input", usage.inputTokens],
    ["output", usage.outputTokens],
    ["cache creation input", usage.cacheCreationInputTokens],
    ["cache read input", usage.cacheReadInputTokens],
  ].reduce(
    (sum, [label, value]) =>
      sum + nonNegativeInteger(
        value as number,
        `Provider ${label} tokens`,
      ),
    0,
  );
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}
