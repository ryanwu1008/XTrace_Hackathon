import {
  BELIEF_CHANGE_ASSESSMENT_SCHEMA_VERSION,
  BeliefChangeAssessmentV1Schema,
  type BeliefChangeAssessmentV1,
  type CompanyAnalysisConfidence,
  type CompanyAnalysisOutcome,
  type DealStatus,
} from "../contracts/domain";
import { compareUtf8 } from "../format/canonical-order";

export interface BeliefRevisionRankingCandidate {
  dealId: string;
  dealStatus: DealStatus;
  outcome: CompanyAnalysisOutcome;
  confidence: CompanyAnalysisConfidence;
  score: number;
  beliefAssessment?: BeliefChangeAssessmentV1;
}

export function isEligibleBeliefRevision(
  candidate: BeliefRevisionRankingCandidate,
  historicalStatus?: DealStatus,
): boolean {
  const assessment = BeliefChangeAssessmentV1Schema.safeParse(
    candidate.beliefAssessment,
  );
  if (!assessment.success) return false;
  const value = assessment.data;
  const materialDirection = value.direction === "positive"
    || value.direction === "mixed"
    || value.direction === "negative";
  return value.schemaVersion === BELIEF_CHANGE_ASSESSMENT_SCHEMA_VERSION
    && candidate.outcome === "belief_revised"
    && (candidate.confidence === "medium" || candidate.confidence === "high")
    && value.gates.allPassed
    && materialDirection
    && candidate.score === value.scoreBreakdown.finalScore
    && candidate.confidence === value.scoreBreakdown.confidence
    && candidate.dealStatus === value.dealStatus
    && (historicalStatus === undefined || historicalStatus === value.dealStatus);
}

export function rankBeliefRevisionCandidates<
  T extends BeliefRevisionRankingCandidate,
>(
  candidates: readonly T[],
  options: {
    historicalStatusByDeal?: ReadonlyMap<string, DealStatus>;
    limit?: number;
  } = {},
): T[] {
  const limit = options.limit ?? 5;
  return candidates
    .filter((candidate) => isEligibleBeliefRevision(
      candidate,
      options.historicalStatusByDeal?.get(candidate.dealId),
    ))
    .sort((left, right) =>
      right.score - left.score || compareUtf8(left.dealId, right.dealId)
    )
    .slice(0, limit);
}
