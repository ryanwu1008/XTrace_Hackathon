export interface OpportunityScoreInputs {
  eventRelevance: number;
  dealRelevance: number;
  priorContextStrength: number;
  evidenceQuality: number;
}

export type OpportunityConfidence = "low" | "medium" | "high";

export interface OpportunityScoreBreakdown extends OpportunityScoreInputs {
  finalScore: number;
  confidence: OpportunityConfidence;
}

function bounded(value: number) {
  return Math.max(0, Math.min(1, value));
}

function finiteBounded(value: number, dimension: string): number {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${dimension} must be finite`);
  }
  return bounded(value);
}

export function weightedOpportunityScore(input: OpportunityScoreInputs) {
  const score =
    0.35 * bounded(input.eventRelevance)
    + 0.30 * bounded(input.dealRelevance)
    + 0.20 * bounded(input.priorContextStrength)
    + 0.15 * bounded(input.evidenceQuality);
  return Number(score.toFixed(4));
}

export function confidenceForScore(score: number): OpportunityConfidence {
  if (score >= 0.78) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

export function buildOpportunityScoreBreakdown(
  input: OpportunityScoreInputs,
): OpportunityScoreBreakdown {
  const boundedInput = {
    eventRelevance: finiteBounded(input.eventRelevance, "eventRelevance"),
    dealRelevance: finiteBounded(input.dealRelevance, "dealRelevance"),
    priorContextStrength: finiteBounded(
      input.priorContextStrength,
      "priorContextStrength",
    ),
    evidenceQuality: finiteBounded(input.evidenceQuality, "evidenceQuality"),
  };
  const finalScore = weightedOpportunityScore(boundedInput);
  return {
    ...boundedInput,
    finalScore,
    confidence: confidenceForScore(finalScore),
  };
}

export function rankQualifiedMatches<T extends { score: number }>(matches: T[]) {
  return matches
    .map((match) => ({
      ...match,
      confidence: confidenceForScore(match.score),
    }))
    .filter((match) => match.confidence !== "low")
    .sort((a, b) => b.score - a.score)
    .slice(0, 5) as Array<T & { confidence: Exclude<OpportunityConfidence, "low"> }>;
}
