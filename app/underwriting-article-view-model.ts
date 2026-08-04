import type { CandidateUnderwritingDetail } from "../lib/underwriting/read-model";
import type { ScenarioInputField } from "../lib/contracts/underwriting";
import type { BeliefAction } from "../lib/contracts/domain";
import { renderRecommendedNextMove } from "../lib/reports/action-policy";

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
    actions: BeliefAction[];
  };
};

type EvidencePackAssumption = CandidateUnderwritingDetail["evidencePack"]["assumptions"][number];

export interface IcDecisionAskPresentation {
  summary: string;
  actionLines: string[];
  scopes: string[];
  priorities: string[];
  visibility: string[];
}

export interface ModelingAssumptionsPresentation {
  scenarioPricing: Array<{
    scenario: "bear" | "base" | "bull";
    displayValue: string;
  }>;
  remaining: EvidencePackAssumption[];
}

export interface UnderwritingArticleViewModel {
  decisionAsk: IcDecisionAskPresentation;
  modelingAssumptions: ModelingAssumptionsPresentation;
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
      fieldIds: ScenarioInputField[];
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
  const actions = input.analysis?.beliefAssessment?.actions ?? [];
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
  const scenarioOrder = ["bear", "base", "bull"] as const;
  const scenarioPricing = scenarioOrder.flatMap((scenario) => {
    const assumption = input.detail.evidencePack.assumptions.find(
      (candidate) =>
        candidate.field === "scenario_price_multiplier"
        && candidate.scenario === scenario,
    );
    return assumption
      ? [{ scenario, displayValue: displayScenarioMultiplier(assumption.value) }]
      : [];
  });

  return {
    decisionAsk: {
      summary: actions.length
        ? actions.length === 1
          ? "Approve the following internal action."
          : `Approve ${actions.length} coordinated internal actions.`
        : "Unavailable — no status-aware action was persisted.",
      actionLines: actions.map((action) =>
        renderRecommendedNextMove([action])
      ),
      scopes: unique(actions.map(({ scope }) =>
        `${titleCase(scope)} scope`
      )),
      priorities: unique(actions.map(({ priority }) =>
        `${titleCase(priority)} priority`
      )),
      visibility: unique(actions.map(({ visibility }) =>
        visibility === "internal_only" ? "Internal only" : titleCase(visibility)
      )),
    },
    modelingAssumptions: {
      scenarioPricing,
      remaining: input.detail.evidencePack.assumptions.filter(
        ({ field }) => field !== "scenario_price_multiplier",
      ),
    },
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

function displayScenarioMultiplier(value: string): string {
  const multiplier = Number(value);
  if (!Number.isFinite(multiplier)) return `${value}×`;
  if (multiplier === 1) return `${multiplier.toFixed(2)}× (Base)`;
  const percentage = Number(((multiplier - 1) * 100).toFixed(2));
  const sign = percentage < 0 ? "−" : "+";
  return `${multiplier.toFixed(2)}× (${sign}${Math.abs(percentage)}%)`;
}

function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/gu, (character) => character.toUpperCase());
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
