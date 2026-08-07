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

export interface NamedLensReading {
  judgmentId: string;
  frameworkCardId: string;
  frameworkVersion: string;
  displayName: string;
  stance: "supportive" | "mixed" | "negative";
  support: string | null;
  counterargument: string | null;
  unknowns: string[];
  limitations: string[];
  evidenceItemIds: string[];
  inPrioritizedDisagreement: boolean;
}

export interface NamedLensReadingsPresentation {
  readings: NamedLensReading[];
  passagesDiscriminate: boolean;
  withheldCount: number;
  panel: {
    activeCount: number;
    abstainedCount: number;
    unavailableCount: number;
    supportiveCount: number;
    negativeCount: number;
  };
}

export interface DiligenceItem {
  fieldId: string;
  label: string;
  settlesDisagreement: string | null;
  unblocks: string | null;
  priority: "critical" | "high" | null;
}

export interface DiligencePresentation {
  orderingBasis: "prioritized_disagreement" | "calculation_unblock";
  items: DiligenceItem[];
}

export interface UnderwritingArticleViewModel {
  decisionAsk: IcDecisionAskPresentation;
  namedLensReadings: NamedLensReadingsPresentation;
  diligence: DiligencePresentation;
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

  const namedLensReadings = buildNamedLensReadings(input.detail);
  const requiredBeforeValuation = valuationDiligenceCatalog.filter((
    { fieldIds },
  ) => fieldIds.some((fieldId) => missingScenarioFields.has(fieldId)));
  const diligence = buildDiligenceOrder(input.detail, requiredBeforeValuation);

  return {
    namedLensReadings,
    diligence,
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
      requiredBeforeValuation,
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

const MAXIMUM_NAMED_LENS_READINGS = 6;

// Ordering is derived, and the rule is conditional. When the disagreeing lenses
// all report the same unknowns there is nothing to discriminate on, so the memo
// falls back to calculation order rather than manufacturing a priority the data
// cannot support.
function buildDiligenceOrder(
  detail: CandidateUnderwritingDetail,
  requiredBeforeValuation: Array<{
    priority: "critical" | "high";
    requiredEvidence: string;
    decisionUse: string;
    fieldIds: readonly string[];
  }>,
): DiligencePresentation {
  const judgmentsById = new Map(
    detail.judgments.map((judgment) => [judgment.id, judgment]),
  );
  const disagreeingJudgmentIds = new Set<string>();
  for (const disagreement of detail.disagreements) {
    disagreeingJudgmentIds.add(disagreement.leftJudgmentId);
    disagreeingJudgmentIds.add(disagreement.rightJudgmentId);
  }
  const unknownSignatures = new Set(
    [...disagreeingJudgmentIds].flatMap((id) => {
      const judgment = judgmentsById.get(id);
      return judgment ? [JSON.stringify([...judgment.unknowns].sort())] : [];
    }),
  );
  const discriminates = unknownSignatures.size > 1;

  const settledBy = new Map<string, string>();
  if (discriminates) {
    for (const disagreement of detail.disagreements) {
      for (const judgmentId of [disagreement.leftJudgmentId, disagreement.rightJudgmentId]) {
        const judgment = judgmentsById.get(judgmentId);
        if (!judgment) continue;
        const text = judgment.unknowns.join(" ").toLowerCase();
        for (const fieldId of detail.evidencePack.coverage.missingFieldIds) {
          if (!settledBy.has(fieldId) && text.includes(fieldId.toLowerCase())) {
            settledBy.set(fieldId, disagreement.id);
          }
        }
      }
    }
  }

  const requirementByField = new Map<
    string,
    { priority: "critical" | "high"; decisionUse: string }
  >();
  for (const requirement of requiredBeforeValuation) {
    for (const fieldId of requirement.fieldIds) {
      if (!requirementByField.has(fieldId)) {
        requirementByField.set(fieldId, {
          priority: requirement.priority,
          decisionUse: requirement.decisionUse,
        });
      }
    }
  }

  const items: DiligenceItem[] = detail.evidencePack.coverage.missingFieldIds.map(
    (fieldId) => {
      const requirement = requirementByField.get(fieldId);
      return {
        fieldId,
        label: titleCase(fieldId),
        settlesDisagreement: settledBy.get(fieldId) ?? null,
        unblocks: requirement?.decisionUse ?? null,
        priority: requirement?.priority ?? null,
      };
    },
  );

  const priorityRank = (item: DiligenceItem): number => {
    if (item.settlesDisagreement) return 0;
    if (item.priority === "critical") return 1;
    if (item.priority === "high") return 2;
    return 3;
  };
  const ordered = [...items].sort((left, right) =>
    priorityRank(left) - priorityRank(right)
  );

  return {
    orderingBasis: discriminates
      ? "prioritized_disagreement"
      : "calculation_unblock",
    items: ordered,
  };
}

// A passage may only reach the reader when it resolves both to a card the pack
// actually contains and to evidence this candidate actually holds. Anything else
// is withheld; the renderer must never substitute generic prose for it.
function buildNamedLensReadings(
  detail: CandidateUnderwritingDetail,
): NamedLensReadingsPresentation {
  const evidenceItemIds = new Set<string>([
    ...detail.evidencePack.facts.map(({ id }) => id),
    ...detail.evidencePack.assumptions.map(({ id }) => id),
  ]);
  const prioritized = new Set<string>();
  for (const disagreement of detail.disagreements) {
    prioritized.add(disagreement.leftJudgmentId);
    prioritized.add(disagreement.rightJudgmentId);
  }

  const panel = {
    activeCount: 0,
    abstainedCount: 0,
    unavailableCount: 0,
    supportiveCount: 0,
    negativeCount: 0,
  };
  const eligible: NamedLensReading[] = [];
  let withheldCount = 0;

  for (const judgment of detail.judgments) {
    if (judgment.applicability === "unavailable") {
      panel.unavailableCount += 1;
      continue;
    }
    if (judgment.applicability !== "applicable" || judgment.conclusion === "abstain") {
      panel.abstainedCount += 1;
      continue;
    }
    panel.activeCount += 1;
    if (judgment.conclusion === "supportive") panel.supportiveCount += 1;
    if (judgment.conclusion === "negative") panel.negativeCount += 1;

    // Named lens readings cover the public-source advisory packs only; a core
    // framework judgment carries no pack catalog to resolve the card against.
    // A composite advisory card ID is `framework_advisory:<packId>:<hash>`, so
    // the declared pack must be the one the card ID itself claims. This stops a
    // judgment being presented under a pack it did not come from.
    const metadata = judgment.frameworkMetadata;
    const cardIdParts = judgment.frameworkCardId.split(":");
    const cardResolves = metadata !== undefined
      && cardIdParts.length === 3
      && cardIdParts[0] === "framework_advisory"
      && cardIdParts[1] === metadata.packId;
    const usedEvidenceItemIds = [
      ...judgment.supportEvidenceItemIds,
      ...judgment.counterEvidenceItemIds,
    ].filter((id) => evidenceItemIds.has(id));
    if (!cardResolves || usedEvidenceItemIds.length === 0) {
      withheldCount += 1;
      continue;
    }

    eligible.push({
      judgmentId: judgment.id,
      frameworkCardId: judgment.frameworkCardId,
      frameworkVersion: judgment.frameworkVersion,
      displayName: metadata?.packName ?? judgment.frameworkCardId,
      stance: judgment.conclusion,
      support: judgment.strongestSupport,
      counterargument: judgment.strongestCounterargument,
      unknowns: [...judgment.unknowns],
      limitations: [...judgment.limitations],
      evidenceItemIds: unique(usedEvidenceItemIds),
      inPrioritizedDisagreement: prioritized.has(judgment.id),
    });
  }

  // A shared template emits the same argument for every lens, varying only the
  // pack name. Those judgments still pass traceability, so uniformity is tested
  // separately: strip the pack name and see whether anything remains different.
  const argumentSignatures = new Set(
    eligible.map(({ displayName, support, counterargument }) =>
      [support ?? "", counterargument ?? ""]
        .join(" ")
        .split(displayName)
        .join("")
        .replace(/\s+/gu, " ")
        .trim()
        .toLowerCase()
    ),
  );
  // Uniformity needs at least two passages to compare; a single lens cannot
  // repeat anyone.
  const uniform = eligible.length > 1 && argumentSignatures.size === 1;
  const passagesDiscriminate = !uniform;

  const readings = passagesDiscriminate
    ? [
      ...eligible.filter(({ inPrioritizedDisagreement }) =>
        inPrioritizedDisagreement
      ),
      ...eligible.filter(({ inPrioritizedDisagreement }) =>
        !inPrioritizedDisagreement
      ),
    ].slice(0, MAXIMUM_NAMED_LENS_READINGS)
    : [];

  return { readings, passagesDiscriminate, withheldCount, panel };
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
