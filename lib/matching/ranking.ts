import {
  BELIEF_CHANGE_ASSESSMENT_SCHEMA_VERSION,
  BeliefChangeAssessmentV1Schema,
  CompanyAnalysisSchema,
  type BeliefChangeAssessmentV1,
  type CompanyAnalysis,
  type CompanyAnalysisConfidence,
  type CompanyAnalysisOutcome,
  type DealStatus,
} from "../contracts/domain";
import {
  canonicalEvidenceJson,
  MarketEventV2Schema,
  SourceRefV2Schema,
  type MarketEventV2,
  type SourceRefV2,
} from "../contracts/source-evidence";
import { compareUtf8 } from "../format/canonical-order";

export interface BeliefRevisionRankingCandidate {
  dealId: string;
  dealStatus: DealStatus;
  outcome: CompanyAnalysisOutcome;
  confidence: CompanyAnalysisConfidence;
  score: number;
  beliefAssessment?: BeliefChangeAssessmentV1;
}

export type GroundedBeliefRevisionRankingCandidate =
  BeliefRevisionRankingCandidate & {
    events: MarketEventV2[];
    sources: SourceRefV2[];
    demoFixtureIds: string[];
  };

interface RankingOptions {
  historicalStatusByDeal?: ReadonlyMap<string, DealStatus>;
  limit?: number;
}

export function isEligibleBeliefRevision(
  candidate: CompanyAnalysis,
  historicalStatus?: DealStatus,
): boolean {
  const analysis = CompanyAnalysisSchema.safeParse(candidate);
  if (!analysis.success) return false;
  return hasEligibleAssessment(analysis.data, historicalStatus);
}

function isEligibleGroundedBeliefRevision(
  candidate: GroundedBeliefRevisionRankingCandidate,
  historicalStatus?: DealStatus,
): boolean {
  const assessment = BeliefChangeAssessmentV1Schema.safeParse(
    candidate.beliefAssessment,
  );
  if (!assessment.success) return false;
  const value = assessment.data;
  return hasCompleteGroundedRankingLineage(candidate, value)
    && hasEligibleAssessment(candidate, historicalStatus, value);
}

function hasEligibleAssessment(
  candidate: BeliefRevisionRankingCandidate,
  historicalStatus?: DealStatus,
  parsedAssessment?: BeliefChangeAssessmentV1,
): boolean {
  const assessment = parsedAssessment
    ? { success: true as const, data: parsedAssessment }
    : BeliefChangeAssessmentV1Schema.safeParse(candidate.beliefAssessment);
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

function hasCompleteGroundedRankingLineage(
  candidate: GroundedBeliefRevisionRankingCandidate,
  assessment: BeliefChangeAssessmentV1,
): boolean {
  const sources = SourceRefV2Schema.array().safeParse(candidate.sources);
  const events = MarketEventV2Schema.array().safeParse(candidate.events);
  const fixtureIds = Array.isArray(candidate.demoFixtureIds)
    && candidate.demoFixtureIds.every((id) => typeof id === "string")
    ? candidate.demoFixtureIds
    : null;
  if (!sources.success || !events.success || fixtureIds === null) return false;

  const sourceById = new Map(sources.data.map((source) => [source.id, source]));
  if (sourceById.size !== sources.data.length) return false;
  const contextSourcesResolve = assessment.gateContext.sources.every(
    (source) => {
      const outer = sourceById.get(source.id);
      return outer !== undefined
        && canonicalEvidenceJson(outer) === canonicalEvidenceJson(source);
    },
  );
  const trigger = assessment.gateContext.triggerEvent;
  const outerEvent = events.data.find((event) => event.id === trigger.id);
  const triggerIds = outerEvent?.sources.map((source) => source.id) ?? [];
  const eventSourcesResolve = outerEvent?.sources.every((source) => {
    const outer = sourceById.get(source.id);
    return outer !== undefined
      && canonicalEvidenceJson(outer) === canonicalEvidenceJson(source);
  }) ?? false;
  const prior = assessment.gateContext.priorInteraction;
  const fixtureLineageMatches = prior.provenance === "demo_fixture"
    ? fixtureIds.length === 1 && fixtureIds[0] === prior.id
    : fixtureIds.length === 0
      && prior.label === "Sample research screening record"
      && prior.meetingOccurred === false
      && prior.vcInteraction === false;
  return contextSourcesResolve
    && outerEvent?.adaptation === "canonical"
    && outerEvent.eventAt === trigger.eventAt
    && sameStringSet(trigger.sourceIds, triggerIds)
    && eventSourcesResolve
    && fixtureLineageMatches
    && prior.sourceIds.length === 1
    && prior.sourceIds[0] === prior.id
    && sourceById.has(prior.id);
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  return left.length === right.length
    && new Set(left).size === left.length
    && left.every((id) => right.includes(id));
}

export function rankBeliefRevisionCandidates<
  T extends CompanyAnalysis,
>(
  candidates: readonly T[],
  options: RankingOptions = {},
): T[] {
  return rankCandidates(candidates, isEligibleBeliefRevision, options);
}

export function rankGroundedBeliefRevisionCandidates<
  T extends GroundedBeliefRevisionRankingCandidate,
>(
  candidates: readonly T[],
  options: RankingOptions = {},
): T[] {
  return rankCandidates(candidates, isEligibleGroundedBeliefRevision, options);
}

function rankCandidates<T extends BeliefRevisionRankingCandidate>(
  candidates: readonly T[],
  isEligible: (candidate: T, historicalStatus?: DealStatus) => boolean,
  options: RankingOptions,
): T[] {
  const limit = options.limit ?? Number.MAX_SAFE_INTEGER;
  return candidates
    .filter((candidate) => isEligible(
      candidate,
      options.historicalStatusByDeal?.get(candidate.dealId),
    ))
    .sort((left, right) =>
      right.score - left.score || compareUtf8(left.dealId, right.dealId)
    )
    .slice(0, limit);
}
