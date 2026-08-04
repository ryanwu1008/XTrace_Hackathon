import assert from "node:assert/strict";
import test from "node:test";

import { buildUnderwritingArticleViewModel } from "../../app/underwriting-article-view-model";
import type { CandidateUnderwritingDetail } from "../../lib/underwriting/read-model";

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

