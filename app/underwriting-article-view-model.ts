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
  financialCase: {
    status: "complete" | "partial" | "not_supportable";
    totalInputCount: number;
    unavailableInputCount: number;
    availableEvidence: string[];
    requiredBeforeValuation: Array<{
      id: string;
      priority: "critical" | "high";
      requiredEvidence: string;
      decisionUse: string;
      readerState:
        | "not_publicly_disclosed"
        | "not_independently_verified"
        | "cannot_calculate"
        | "not_applicable"
        | "provider_or_lineage_unavailable";
      fieldIds: string[];
    }>;
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
  const scenarioInputs = input.detail.scenarioModel.scenarios.flatMap(
    ({ inputs }) => inputs,
  );
  const unavailableScenarioInputs = scenarioInputs.filter(
    ({ value }) => value === null,
  );
  const missingScenarioFields = new Set(
    unavailableScenarioInputs.map(({ field }) => field),
  );

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
    financialCase: {
      status: unavailableScenarioInputs.length === 0
        ? "complete"
        : unavailableScenarioInputs.length === scenarioInputs.length
        ? "not_supportable"
        : "partial",
      totalInputCount: scenarioInputs.length,
      unavailableInputCount: unavailableScenarioInputs.length,
      availableEvidence: input.detail.evidencePack.facts
        .filter(({ acceptedForGate, field }) =>
          acceptedForGate && financialEvidenceFields.has(field)
        )
        .map(displayFact),
      requiredBeforeValuation: valuationDiligenceCatalog.filter(({ fieldIds }) =>
        fieldIds.some((fieldId) => missingScenarioFields.has(fieldId))
      ),
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

const financialEvidenceFields = new Set([
  "arr",
  "arr_path",
  "cash",
  "financing",
  "growth",
  "gross_margin",
  "reported_valuation",
  "revenue",
  "runway",
  "stage",
]);

const valuationDiligenceCatalog: UnderwritingArticleViewModel["financialCase"]["requiredBeforeValuation"] = [
  {
    id: "arr_and_growth",
    priority: "critical",
    requiredEvidence: "Current ARR and growth",
    decisionUse: "Establish operating scale and revenue trajectory.",
    readerState: "not_publicly_disclosed",
    fieldIds: ["revenue_path", "arr_path", "growth"],
  },
  {
    id: "margin_profile",
    priority: "critical",
    requiredEvidence: "Gross and contribution margin",
    decisionUse: "Determine underlying unit economics and operating leverage.",
    readerState: "not_publicly_disclosed",
    fieldIds: ["gross_margin", "contribution_margin"],
  },
  {
    id: "liquidity",
    priority: "critical",
    requiredEvidence: "Cash, burn, and runway",
    decisionUse: "Assess financing risk and time available for remediation.",
    readerState: "not_publicly_disclosed",
    fieldIds: ["burn", "cash", "runway"],
  },
  {
    id: "operating_plan",
    priority: "high",
    requiredEvidence: "Operating expense plan",
    decisionUse: "Test whether the operating plan is consistent with available liquidity.",
    readerState: "not_publicly_disclosed",
    fieldIds: ["operating_expenses"],
  },
  {
    id: "financing_plan",
    priority: "critical",
    requiredEvidence: "Cap table and financing plan",
    decisionUse: "Calculate ownership, reserve exposure, and future dilution.",
    readerState: "cannot_calculate",
    fieldIds: ["future_financing", "future_dilution"],
  },
  {
    id: "exit_assumptions",
    priority: "high",
    requiredEvidence: "Exit assumptions and comparable set",
    decisionUse: "Build a defensible valuation range and return model.",
    readerState: "cannot_calculate",
    fieldIds: ["exit_timing", "exit_method", "exit_multiple"],
  },
  {
    id: "scenario_milestones",
    priority: "high",
    requiredEvidence: "Scenario probabilities and operating milestones",
    decisionUse: "Weight Bear, Base, and Bull cases without inventing probabilities.",
    readerState: "cannot_calculate",
    fieldIds: ["success_conditions", "failure_conditions", "probability"],
  },
];
