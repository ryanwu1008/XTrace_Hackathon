import type { CompanyAnalysis } from "../contracts/domain";
import type { UnderwritingBatchSummary } from "../underwriting/read-model";

/**
 * A current report is authoritative only when its persisted underwriting queue
 * contains every and only its admitted belief revisions. Historical pinned
 * reports use their explicit legacy adapter instead and never enter here.
 */
export function assertCurrentReportUnderwritingIntegrity(input: {
  companyAnalyses: readonly CompanyAnalysis[];
  underwritingBatch: UnderwritingBatchSummary | null;
}): void {
  const beliefRevisionDealIds = input.companyAnalyses
    .filter(({ outcome }) => outcome === "belief_revised")
    .map(({ dealId }) => dealId)
    .sort();
  const underwritingDealIds = (input.underwritingBatch?.queue ?? [])
    .map(({ dealId }) => dealId)
    .sort();
  if (
    beliefRevisionDealIds.length !== underwritingDealIds.length
    || beliefRevisionDealIds.some(
      (dealId, index) => dealId !== underwritingDealIds[index],
    )
  ) {
    throw new Error(
      "Every and only current belief revision must have one underwriting job.",
    );
  }
}
