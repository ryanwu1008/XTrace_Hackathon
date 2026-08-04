import type { CandidateUnderwritingDetail } from "../lib/underwriting/read-model";

type ArticleAnalysisContext = {
  dealStatus: string;
  marketEvidence: { explanation: string };
  implications: { positive: string[]; negative: string[] };
  investmentMemory: {
    previousMeetingSummary: string;
    decisionReason: string;
  };
  beliefAssessment?: {
    direction: string;
    actions: Array<{
      kind: string;
      scope: string;
      priority: string;
    }>;
  };
};

export interface UnderwritingArticleViewModel {
  decisionAsk: string;
  thenNow: {
    then: string;
    now: string;
    mechanism: string;
  };
  companySnapshot: {
    verifiedFacts: string[];
    unverifiedFacts: string[];
    unknownFieldIds: string[];
  };
  debate: {
    bull: string[];
    bear: string[];
    trueDisagreement: string[];
  };
  evidenceClassification: {
    factCount: number;
    assumptionCount: number;
    unknownCount: number;
    conflictCount: number;
  };
  finalPosition: {
    decision: string;
    ceiling: string;
    confidence: string;
    nextAction: string;
  };
}

export function buildUnderwritingArticleViewModel(input: {
  analysis: ArticleAnalysisContext | null;
  detail: CandidateUnderwritingDetail;
}): UnderwritingArticleViewModel {
  const activeJudgments = input.detail.judgments.filter((judgment) =>
    judgment.applicability === "applicable"
    && judgment.conclusion !== "abstain"
  );
  const primaryAction = input.analysis?.beliefAssessment?.actions[0];
  const nextAction = primaryAction
    ? [primaryAction.kind, primaryAction.scope, primaryAction.priority].join(" · ")
    : "Unavailable";
  const then = input.analysis?.investmentMemory.decisionReason
    || input.analysis?.investmentMemory.previousMeetingSummary
    || "Unavailable";
  const now = input.analysis?.marketEvidence.explanation || "Unavailable";

  return {
    decisionAsk: primaryAction
      ? `Authorize ${primaryAction.kind.replaceAll("_", " ")} as a ${primaryAction.priority} priority ${primaryAction.scope} action.`
      : "Unavailable — no status-aware action was persisted.",
    thenNow: {
      then,
      now,
      mechanism: then === "Unavailable" || now === "Unavailable"
        ? "Unavailable — the persisted prior belief or current evidence mechanism is incomplete."
        : `${then} → ${now}`,
    },
    companySnapshot: {
      verifiedFacts: input.detail.evidencePack.facts
        .filter(({ acceptedForGate }) => acceptedForGate)
        .map(displayFact),
      unverifiedFacts: input.detail.evidencePack.facts
        .filter(({ acceptedForGate }) => !acceptedForGate)
        .map(displayFact),
      unknownFieldIds: [...input.detail.evidencePack.coverage.missingFieldIds],
    },
    debate: {
      bull: unique([
        ...(input.analysis?.implications.positive ?? []),
        ...activeJudgments.flatMap(({ strongestSupport }) =>
          useful(strongestSupport) ? [strongestSupport] : []
        ),
      ]).slice(0, 4),
      bear: unique([
        ...(input.analysis?.implications.negative ?? []),
        ...activeJudgments.flatMap(({ strongestCounterargument }) =>
          useful(strongestCounterargument)
            ? [strongestCounterargument]
            : []
        ),
      ]).slice(0, 4),
      trueDisagreement: unique(
        input.detail.disagreements.map(({ explanation }) => explanation),
      ).slice(0, 3),
    },
    evidenceClassification: {
      factCount: input.detail.evidencePack.facts.length,
      assumptionCount: input.detail.evidencePack.assumptions.length,
      unknownCount: input.detail.evidencePack.coverage.missingFieldIds.length,
      conflictCount: input.detail.evidencePack.conflicts.length,
    },
    finalPosition: {
      decision: input.detail.decision.decision ?? "Unavailable",
      ceiling: input.detail.decision.decisionCeiling ?? "Unavailable",
      confidence: input.detail.decision.confidence,
      nextAction,
    },
  };
}

function displayFact(
  fact: CandidateUnderwritingDetail["evidencePack"]["facts"][number],
): string {
  const field = fact.field
    .replaceAll("_", " ")
    .replace(/\b\w/gu, (character) => character.toUpperCase());
  const value = `${fact.value}${fact.unit ? ` ${fact.unit}` : ""}`;
  return `${field} — ${value} · ${fact.assertionStatus.replaceAll("_", " ")}`;
}

function useful(value: string | null): value is string {
  return Boolean(value && value.trim() && !/^unavailable\b/i.test(value));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
