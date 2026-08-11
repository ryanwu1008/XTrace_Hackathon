import assert from "node:assert/strict";
import test from "node:test";

import { buildUnderwritingArticleViewModel } from "../../app/underwriting-article-view-model";
import { isCurrentUnderwritingDetail } from "../../app/underwriting-passage-detail";
import {
  toVersionedCandidateUnderwritingDetail,
  type CandidateUnderwritingDetail,
} from "../../lib/underwriting/read-model";
import { createCurrentNamedLensFinalizationFixture } from
  "../helpers/current-named-lens-finalization";

const scenarioFields = [
  "revenue_path",
  "arr_path",
  "growth",
  "gross_margin",
  "contribution_margin",
  "operating_expenses",
  "burn",
  "cash",
  "runway",
  "future_financing",
  "future_dilution",
  "exit_timing",
  "exit_method",
  "exit_multiple",
  "success_conditions",
  "failure_conditions",
  "probability",
] as const;

test("current article view model reads the saved named-lens passage order without reselecting judgments", () => {
  const finalization = createCurrentNamedLensFinalizationFixture().finalization;
  const detail = toVersionedCandidateUnderwritingDetail({
    bundle: {
      ...finalization,
      sourceCandidateRunId: finalization.candidateRunId,
      workspaceId: finalization.evidencePack.workspaceId,
      dealId: finalization.evidencePack.dealId,
      claimEdges: [],
    },
    adapter: {
      kind: "current",
      schemaVersion: "decision-first-named-lens-v1",
    },
  });
  if (!isCurrentUnderwritingDetail(detail)) {
    throw new Error("Expected the current presentation adapter fixture.");
  }
  const firstSavedPassage = detail.namedLensPresentation.selectedPassages[0]!;
  const secondSavedPassage = structuredClone(firstSavedPassage);
  secondSavedPassage.selectedPosition = 2;
  secondSavedPassage.passage.fingerprint = `sha256:${"f".repeat(64)}`;
  secondSavedPassage.passage.premise.text =
    "Second persisted passage must remain first in the saved order.";
  detail.namedLensPresentation.selectedPassages = [
    secondSavedPassage,
    firstSavedPassage,
  ];

  const article = buildUnderwritingArticleViewModel({
    analysis: null,
    detail,
  });
  assert.ok(article.persistedNamedLens);

  assert.deepEqual(
    article.persistedNamedLens.selectedPassages.map(({ selectedPosition }) =>
      selectedPosition
    ),
    [2, 1],
  );
  assert.equal(
    article.persistedNamedLens.selectedPassages[0]?.passage.premise.text,
    "Second persisted passage must remain first in the saved order.",
  );
});

test("consolidates a 51-cell unavailable scenario matrix into decision-use diligence rows", () => {
  const detail = {
    evidencePack: {
      facts: [{
        id: "fact_valuation",
        field: "reported_valuation",
        value: "$450 million historical valuation",
        unit: null,
        assertionStatus: "reported",
        acceptedForGate: true,
      }],
      assumptions: [],
      conflicts: [],
      coverage: {
        missingFieldIds: ["arr", "burn", "cash", "runway"],
      },
    },
    judgments: [],
    disagreements: [],
    scenarioModel: {
      id: "scenario_model_1",
      candidateRunId: "candidate_1",
      formulaPolicyVersion: "valuation_policy_1",
      probabilityWeighted: false,
      scenarios: (["bear", "base", "bull"] as const).map((scenario) => ({
        name: scenario,
        inputs: scenarioFields.map((field) => ({
          id: `${scenario}:${field}`,
          scenario,
          field,
          value: null,
          unit: null,
          evidenceItemId: null,
          assumptionItemId: null,
          unavailableReason: `No accepted Fact or explicit Assumption is available for ${field}`,
        })),
      })),
    },
    decision: {
      decision: null,
      decisionCeiling: null,
      confidence: "low",
    },
  } as unknown as CandidateUnderwritingDetail;

  const article = buildUnderwritingArticleViewModel({
    analysis: null,
    detail,
  });

  assert.equal(article.financialCase.status, "not_supportable");
  assert.equal(article.financialCase.totalInputCount, 51);
  assert.equal(article.financialCase.unavailableInputCount, 51);
  assert.equal(article.financialCase.availableEvidence[0],
    "Reported Valuation — $450 million historical valuation · reported");
  assert.deepEqual(
    article.financialCase.requiredBeforeValuation.map(({ requiredEvidence }) =>
      requiredEvidence
    ),
    [
      "Current ARR and growth",
      "Gross and contribution margin",
      "Cash, burn, and runway",
      "Operating expense plan",
      "Cap table and financing plan",
      "Exit assumptions and comparable set",
      "Scenario probabilities and operating milestones",
    ],
  );
  assert.deepEqual(
    article.financialCase.requiredBeforeValuation.map(({ readerState }) =>
      readerState
    ),
    [
      "not_publicly_disclosed",
      "not_publicly_disclosed",
      "not_publicly_disclosed",
      "not_publicly_disclosed",
      "cannot_calculate",
      "cannot_calculate",
      "cannot_calculate",
    ],
  );
});

function lensDetail(input: {
  judgments: unknown[];
  disagreements?: unknown[];
}): CandidateUnderwritingDetail {
  return {
    evidencePack: {
      facts: [
        {
          id: "fact_customer",
          field: "customer_evidence",
          value: "Partner to the UK government on frontier-model cyber vetting.",
          unit: null,
          assertionStatus: "reported",
          acceptedForGate: true,
        },
        {
          id: "fact_revenue",
          field: "revenue",
          value: "Millions in annual revenue; exact amount unavailable",
          unit: null,
          assertionStatus: "reported",
          acceptedForGate: true,
        },
      ],
      assumptions: [],
      conflicts: [],
      coverage: { missingFieldIds: [] },
    },
    judgments: input.judgments,
    disagreements: input.disagreements ?? [],
    scenarioModel: {
      id: "scenario_model_1",
      candidateRunId: "candidate_1",
      formulaPolicyVersion: "valuation_policy_1",
      probabilityWeighted: false,
      scenarios: [],
    },
    decision: { decision: null, decisionCeiling: null, confidence: "low" },
  } as unknown as CandidateUnderwritingDetail;
}

function lensJudgment(input: {
  id: string;
  packName: string;
  conclusion: string;
  supportIds?: string[];
  counterIds?: string[];
  cardId?: string;
  packId?: string;
}) {
  const packId = input.packId ?? `pack_${input.id}`;
  const cardId = input.cardId ?? `framework_advisory:${packId}:abc123`;
  return {
    id: input.id,
    analysisType: "framework_judgment",
    frameworkCardId: cardId,
    frameworkVersion: "0.1.0",
    applicability: "applicable",
    conclusion: input.conclusion,
    supportEvidenceItemIds: input.supportIds ?? ["fact_customer"],
    counterEvidenceItemIds: input.counterIds ?? ["fact_revenue"],
    unusedEvidenceItemIds: [],
    // Distinct per judgment so these fixtures exercise traceability and
    // selection rather than the uniformity rule, which has its own tests.
    strongestSupport: `${input.packName} support reasoning for ${input.id}.`,
    strongestCounterargument: `${input.packName} counter reasoning for ${input.id}.`,
    unknowns: [],
    limitations: ["Public-source synthesis only."],
    confidence: {},
    claimEdges: [],
    frameworkMetadata: {
      packId,
      packName: input.packName,
    },
    fingerprint: `fp_${input.id}`,
  };
}

test("named lens readings withhold passages that fail card or evidence traceability", () => {
  const article = buildUnderwritingArticleViewModel({
    analysis: null,
    detail: lensDetail({
      judgments: [
        lensJudgment({
          id: "j_ok",
          packName: "Damodaran Public Frameworks",
          conclusion: "supportive",
        }),
        // No evidence binding at all: must be withheld.
        lensJudgment({
          id: "j_no_evidence",
          packName: "Unbound Public Frameworks",
          conclusion: "negative",
          supportIds: [],
          counterIds: [],
        }),
        // Cites an evidence ID absent from this candidate's Evidence Pack.
        lensJudgment({
          id: "j_foreign_evidence",
          packName: "Foreign Evidence Public Frameworks",
          conclusion: "negative",
          supportIds: ["fact_from_another_deal"],
          counterIds: [],
        }),
        // Composite card ID claims a different pack than the one declared.
        lensJudgment({
          id: "j_pack_mismatch",
          packName: "Mismatched Public Frameworks",
          conclusion: "negative",
          packId: "pack_declared",
          cardId: "framework_advisory:pack_claimed_by_card:abc123",
        }),
      ],
    }),
  });

  assert.deepEqual(
    article.namedLensReadings.readings.map(({ judgmentId }) => judgmentId),
    ["j_ok"],
  );
  assert.equal(article.namedLensReadings.withheldCount, 3);
});

test("lens passages are withheld when every lens argues the same thing", () => {
  const shared = {
    support: "Uses the customer evidence as the strongest concrete input.",
    counter: "Revenue is the strongest persisted counterargument.",
  };
  const article = buildUnderwritingArticleViewModel({
    analysis: null,
    detail: lensDetail({
      judgments: ["Alpha", "Beta", "Gamma"].map((packName, index) => ({
        ...lensJudgment({
          id: `j_${index}`,
          packName,
          conclusion: index === 0 ? "negative" : "supportive",
        }),
        // Only the pack name differs, exactly as a shared template would emit.
        strongestSupport: `${packName} Public Frameworks ${shared.support}`,
        strongestCounterargument: `${packName} Public Frameworks ${shared.counter}`,
      })),
    }),
  });

  assert.equal(article.namedLensReadings.passagesDiscriminate, false);
  assert.deepEqual(article.namedLensReadings.readings, []);
  assert.equal(article.namedLensReadings.panel.activeCount, 3);
});

test("lens passages render when the arguments genuinely differ", () => {
  const article = buildUnderwritingArticleViewModel({
    analysis: null,
    detail: lensDetail({
      judgments: [
        {
          ...lensJudgment({ id: "j_a", packName: "Alpha", conclusion: "supportive" }),
          strongestSupport: "Failure is a discrete event to be modelled separately.",
          strongestCounterargument: "Runway is unknown, so the prior has no anchor.",
        },
        {
          ...lensJudgment({ id: "j_b", packName: "Beta", conclusion: "negative" }),
          strongestSupport: "Prior ownership is not a reason to invest again.",
          strongestCounterargument: "Current price cannot be re-underwritten.",
        },
      ],
    }),
  });

  assert.equal(article.namedLensReadings.passagesDiscriminate, true);
  assert.deepEqual(
    article.namedLensReadings.readings.map(({ judgmentId }) => judgmentId),
    ["j_a", "j_b"],
  );
});

test("diligence falls back to calculation order when unknowns cannot discriminate", () => {
  const sharedUnknown = "Critical missing evidence remains: arr, burn, cash, runway.";
  const detail = lensDetail({
    judgments: [
      { ...lensJudgment({ id: "j_left", packName: "Left", conclusion: "supportive" }), unknowns: [sharedUnknown] },
      { ...lensJudgment({ id: "j_right", packName: "Right", conclusion: "negative" }), unknowns: [sharedUnknown] },
    ],
    disagreements: [{
      id: "disagreement_1",
      leftJudgmentId: "j_left",
      rightJudgmentId: "j_right",
      topic: "independent_framework_conflict",
      explanation: "Split on the evidence gap.",
      evidenceItemIds: ["fact_revenue"],
    }],
  });
  detail.evidencePack.coverage.missingFieldIds = ["arr", "burn", "cash", "runway"];

  const article = buildUnderwritingArticleViewModel({ analysis: null, detail });

  assert.equal(article.diligence.orderingBasis, "calculation_unblock");
  assert.equal(
    article.diligence.items.every(({ settlesDisagreement }) =>
      settlesDisagreement === null
    ),
    true,
  );
});

test("diligence leads with evidence that settles a disagreement when unknowns discriminate", () => {
  const detail = lensDetail({
    judgments: [
      {
        ...lensJudgment({ id: "j_left", packName: "Left", conclusion: "supportive" }),
        unknowns: ["Runway remains unknown."],
      },
      {
        ...lensJudgment({ id: "j_right", packName: "Right", conclusion: "negative" }),
        unknowns: ["Remediation durability remains unknown."],
      },
    ],
    disagreements: [{
      id: "disagreement_1",
      leftJudgmentId: "j_left",
      rightJudgmentId: "j_right",
      topic: "independent_framework_conflict",
      explanation: "Structure versus execution.",
      evidenceItemIds: ["fact_revenue"],
    }],
  });
  detail.evidencePack.coverage.missingFieldIds = ["arr", "runway"];

  const article = buildUnderwritingArticleViewModel({ analysis: null, detail });

  assert.equal(article.diligence.orderingBasis, "prioritized_disagreement");
  assert.equal(article.diligence.items[0]?.fieldId, "runway");
  assert.equal(
    article.diligence.items[0]?.settlesDisagreement,
    "disagreement_1",
  );
});

test("named lens readings always include every lens in a prioritized disagreement", () => {
  const article = buildUnderwritingArticleViewModel({
    analysis: null,
    detail: lensDetail({
      judgments: [
        lensJudgment({ id: "j_left", packName: "Left", conclusion: "supportive" }),
        lensJudgment({ id: "j_right", packName: "Right", conclusion: "negative" }),
        lensJudgment({ id: "j_other", packName: "Other", conclusion: "supportive" }),
      ],
      disagreements: [{
        id: "disagreement_1",
        leftJudgmentId: "j_left",
        rightJudgmentId: "j_right",
        topic: "independent_framework_conflict",
        explanation: "They split on how to treat the evidence gap.",
        evidenceItemIds: ["fact_revenue"],
      }],
    }),
  });

  const selected = article.namedLensReadings.readings.map(({ judgmentId }) =>
    judgmentId
  );
  assert.ok(selected.includes("j_left"));
  assert.ok(selected.includes("j_right"));
  assert.deepEqual(
    article.namedLensReadings.readings
      .filter(({ inPrioritizedDisagreement }) => inPrioritizedDisagreement)
      .map(({ judgmentId }) => judgmentId),
    ["j_left", "j_right"],
  );
});
