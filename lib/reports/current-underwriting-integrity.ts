import type { RunRecord } from "../../db/client";
import type { CompanyAnalysis } from "../contracts/domain";
import type { UnderwritingBatchSummary } from "../underwriting/read-model";

export type CurrentUnderwritingExecutionState =
  | "in_progress"
  | "complete"
  | "partial"
  | "failed"
  | "integrity_error";

export interface CurrentUnderwritingExecution {
  runId: string;
  runStatus: RunRecord["status"] | "unavailable";
  currentStage: string | null;
  state: CurrentUnderwritingExecutionState;
  message: string | null;
  expectedCandidateCount: number;
  persistedCandidateCount: number;
}

function underwritingIdentitySets(input: {
  companyAnalyses: readonly CompanyAnalysis[];
  underwritingBatch: UnderwritingBatchSummary | null;
}) {
  return {
    beliefRevisionDealIds: input.companyAnalyses
      .filter(({ outcome }) => outcome === "belief_revised")
      .map(({ dealId }) => dealId)
      .sort(),
    underwritingDealIds: (input.underwritingBatch?.queue ?? [])
      .map(({ dealId }) => dealId)
      .sort(),
  };
}

function underwritingIdentitiesMatch(input: {
  companyAnalyses: readonly CompanyAnalysis[];
  underwritingBatch: UnderwritingBatchSummary | null;
}): boolean {
  const { beliefRevisionDealIds, underwritingDealIds } =
    underwritingIdentitySets(input);
  return beliefRevisionDealIds.length === underwritingDealIds.length
    && beliefRevisionDealIds.every(
      (dealId, index) => dealId === underwritingDealIds[index],
    );
}

export function buildCurrentUnderwritingExecution(input: {
  reportRunId: string;
  run: Pick<RunRecord, "id" | "status" | "currentStage"> | null;
  companyAnalyses: readonly CompanyAnalysis[];
  underwritingBatch: UnderwritingBatchSummary | null;
}): CurrentUnderwritingExecution {
  const expectedCandidateCount = input.companyAnalyses.filter(
    ({ outcome }) => outcome === "belief_revised",
  ).length;
  const persistedCandidateCount = input.underwritingBatch?.queue.length ?? 0;
  const base = {
    runId: input.reportRunId,
    currentStage: input.run?.currentStage ?? null,
    expectedCandidateCount,
    persistedCandidateCount,
  };

  if (!input.run || input.run.id !== input.reportRunId) {
    return {
      ...base,
      runStatus: "unavailable",
      state: "integrity_error",
      message:
        "Deep Underwriting integrity error: the owning scan record is unavailable.",
    };
  }
  if (input.run.status === "queued" || input.run.status === "running") {
    return {
      ...base,
      runStatus: input.run.status,
      state: "in_progress",
      message: null,
    };
  }
  if (!underwritingIdentitiesMatch(input)) {
    return {
      ...base,
      runStatus: input.run.status,
      state: "integrity_error",
      message: expectedCandidateCount !== persistedCandidateCount
        ? `Deep Underwriting integrity error: the terminal scan persisted ${expectedCandidateCount} belief revisions but ${persistedCandidateCount} underwriting jobs.`
        : "Deep Underwriting integrity error: persisted underwriting jobs do not match the report's belief revisions.",
    };
  }
  const activeJobCount = input.underwritingBatch?.queue.filter(
    ({ status }) => status === "queued" || status === "running",
  ).length ?? 0;
  if (activeJobCount > 0) {
    return {
      ...base,
      runStatus: input.run.status,
      state: "integrity_error",
      message:
        `Deep Underwriting integrity error: the terminal scan still has ${activeJobCount} non-terminal underwriting jobs.`,
    };
  }
  if (input.run.status === "partial") {
    return {
      ...base,
      runStatus: input.run.status,
      state: "partial",
      message:
        "The scan ended Partial. Persisted terminal results remain available, but one or more scan stages did not complete.",
    };
  }
  if (input.run.status === "failed") {
    return {
      ...base,
      runStatus: input.run.status,
      state: "failed",
      message:
        "The scan ended Failed. Only persisted terminal underwriting results are available.",
    };
  }
  return {
    ...base,
    runStatus: input.run.status,
    state: "complete",
    message: null,
  };
}

/**
 * A current report is authoritative only when its persisted underwriting queue
 * contains every and only its admitted belief revisions. Historical pinned
 * reports use their explicit legacy adapter instead and never enter here.
 */
export function assertCurrentReportUnderwritingIntegrity(input: {
  companyAnalyses: readonly CompanyAnalysis[];
  underwritingBatch: UnderwritingBatchSummary | null;
}): void {
  if (!underwritingIdentitiesMatch(input)) {
    throw new Error(
      "Every and only current belief revision must have one underwriting job.",
    );
  }
}
