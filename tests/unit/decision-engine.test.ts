import assert from "node:assert/strict";
import test from "node:test";

import type {
  EvidenceCoverageResult,
  EvidencePack,
  Fact,
} from "../../lib/contracts/evidence";
import type {
  FrameworkJudgment,
  FundPolicySnapshot,
  ResolvedUnderwritingContext,
  ValuationEvaluation,
} from "../../lib/contracts/underwriting";
import {
  createDecisionEngine,
} from "../../lib/underwriting/decision/engine";
import {
  DECISION_POLICY_V1,
  type DecisionEngineInput,
} from "../../lib/underwriting/decision/rules";
import {
  authorizedResearchComposites,
  loadResearchFrameworkCatalog,
} from "../../lib/underwriting/frameworks/research-loader";
import { BALANCED_POLICY_VALUES } from "../../seed/underwriting/balanced-policy-v1";

const context: ResolvedUnderwritingContext = {
  id: "underwriting_context_seed_b2b_saas_v1",
  contextVersion: "1",
  stage: "seed",
  businessModel: "b2b_saas",
  geography: "us",
  securityType: "preferred",
  asOfDate: "2026-07-29",
  criticalEvidenceProfileId: "critical_evidence_seed_b2b_saas_v1",
  benchmarkPackId: "benchmark_pack_synthetic_us_software_v1",
  benchmarkCompatibility: "exact",
  valuationMethodPolicyId: "valuation_method_seed_b2b_saas_v1",
  decisionPolicyId: DECISION_POLICY_V1.id,
  frameworkPackId: "framework_pack_synthetic_universal_saas_ai_v1",
};

const completeCoverage: EvidenceCoverageResult = {
  minimumModelInputsComplete: true,
  criticalEvidenceComplete: true,
  missingFieldIds: [],
  blockingConflictIds: [],
  decisionCeiling: "Invest Candidate",
  underwritingStatus: "available",
  reasonCodes: [],
};

const policy: FundPolicySnapshot = {
  id: "fund_policy_snapshot_1",
  workspaceId: "workspace_1",
  version: 1,
  source: "recommended_policy",
  values: structuredClone(
    BALANCED_POLICY_VALUES,
  ) as unknown as FundPolicySnapshot["values"],
  createdByUserId: null,
  createdAt: "2026-07-29T10:00:00.000Z",
};

const valuation: ValuationEvaluation = {
  id: "valuation_1",
  status: "completed",
  scenarios: [
    { name: "bear", valuation: "15000000", calculationIds: ["calc_bear"] },
    { name: "base", valuation: "20000000", calculationIds: ["calc_base"] },
    { name: "bull", valuation: "25000000", calculationIds: ["calc_bull"] },
  ],
  currentAsk: "20000000",
  maximumAcceptablePreMoney: "30000000",
  initialOwnership: "0.10",
  postDilutionOwnership: "0.05",
  grossMoic: "5",
  grossIrr: "0.25",
  pricingPremium: "0.10",
  calculationIds: [
    "calc_bear",
    "calc_base",
    "calc_bull",
    "calc_returns",
  ],
  blockerCodes: [],
};

const fact = (
  id: string,
  field: string,
  value: string,
  overrides: Partial<Fact> = {},
): Fact => ({
  id,
  analysisType: "fact",
  provenanceOrigin: "uploaded_document",
  field,
  value,
  unit: null,
  currency: null,
  periodStart: null,
  periodEnd: null,
  publishedAt: null,
  eventAt: null,
  retrievedAt: "2026-07-29T09:00:00.000Z",
  sourceRevisionId: "revision_1",
  locator: {
    kind: "text_range",
    start: 0,
    end: 10,
    excerpt: value,
  },
  sourceRole: "management",
  assertionStatus: "reported",
  verificationMethod: null,
  freshness: "current",
  acceptedForGate: true,
  ...overrides,
});

const pack = (
  coverage: EvidenceCoverageResult = completeCoverage,
  facts: Fact[] = [
    fact("fact_customer", "customer_evidence", "Three paying production customers"),
    fact("fact_arr", "arr", "2400000"),
  ],
): EvidencePack => ({
  id: "evidence_pack_1",
  version: 1,
  workspaceId: "workspace_1",
  dealId: "deal_1",
  asOfDate: "2026-07-29",
  sourceRevisionIds: ["revision_1"],
  facts,
  assumptions: [],
  conflicts: [],
  coverage,
  createdAt: "2026-07-29T09:30:00.000Z",
});

const judgment = (
  id: string,
  frameworkCardId: string,
  conclusion: FrameworkJudgment["conclusion"] = "supportive",
  confidence: FrameworkJudgment["confidence"]["judgment"] = "high",
  overrides: Partial<FrameworkJudgment> = {},
): FrameworkJudgment => ({
  id,
  analysisType: "framework_judgment",
  frameworkCardId,
  frameworkVersion: "1",
  applicability: "applicable",
  conclusion,
  supportEvidenceItemIds: conclusion === "supportive"
    ? ["fact_customer"]
    : [],
  counterEvidenceItemIds: conclusion === "negative"
    ? ["fact_customer"]
    : [],
  unusedEvidenceItemIds: [],
  strongestSupport: conclusion === "supportive"
    ? "The accepted evidence supports the criterion."
    : null,
  strongestCounterargument: conclusion === "negative"
    ? "The accepted evidence contradicts the criterion."
    : null,
  unknowns: [],
  limitations: [],
  confidence: {
    sourceReliability: confidence,
    evidenceStrength: confidence,
    evidenceCoverage: confidence,
    applicability: confidence,
    judgment: confidence,
  },
  claimEdges: [],
  fingerprint: `fingerprint_${id}`,
  ...overrides,
});

const positiveJudgments = (): FrameworkJudgment[] => [
  judgment(
    "judgment_market",
    DECISION_POLICY_V1.mandatoryFrameworkCardIds.marketSizeWhyNow,
  ),
  judgment(
    "judgment_founder",
    DECISION_POLICY_V1.mandatoryFrameworkCardIds.founderUniqueInsight,
  ),
  judgment(
    "judgment_pmf",
    DECISION_POLICY_V1.mandatoryFrameworkCardIds.productMarketFit,
  ),
];

function input(overrides: Partial<DecisionEngineInput> = {}): DecisionEngineInput {
  return {
    pack: pack(),
    coverage: completeCoverage,
    judgments: positiveJudgments(),
    valuation,
    fundPolicy: policy,
    context,
    decisionPolicy: DECISION_POLICY_V1,
    ...overrides,
  };
}

test("produces Invest Candidate only when all independent dimensions pass", () => {
  const result = createDecisionEngine().decide(input());

  assert.equal(result.companyQuality, "pass");
  assert.equal(result.priceAttractiveness, "pass");
  assert.equal(result.fundFit, "pass");
  assert.equal(result.decision, "Invest Candidate");
  assert.equal(result.decisionCeiling, "Invest Candidate");
  assert.equal(result.hardVeto, false);
  assert.deepEqual(
    result.firedRules.slice(0, 3).map(({ ruleId }) => ruleId),
    [
      "decision.minimum_model_input.v1",
      "decision.critical_evidence_ceiling.v1",
      "decision.mandate_match.v1",
    ],
  );
  assert.equal(
    result.firedRules.every(({ inputRefs }) =>
      inputRefs.every((reference) => /^[a-z_]+:.+/.test(reference))
    ),
    true,
  );
});

test("applies the critical evidence ceiling before the decision matrix", () => {
  const coverage: EvidenceCoverageResult = {
    ...completeCoverage,
    criticalEvidenceComplete: false,
    missingFieldIds: ["customer_retention"],
    decisionCeiling: "Advance",
    reasonCodes: ["MISSING_CRITICAL_EVIDENCE"],
  };
  const result = createDecisionEngine().decide(input({
    pack: pack(coverage),
    coverage,
  }));

  assert.equal(result.companyQuality, "pass");
  assert.equal(result.priceAttractiveness, "pass");
  assert.equal(result.fundFit, "pass");
  assert.equal(result.decision, "Advance");
  assert.equal(result.decisionCeiling, "Advance");
  assert.deepEqual(result.blockingEvidenceItemIds, []);
  assert.equal(
    result.firedRules.find(({ ruleId }) =>
      ruleId === "decision.critical_evidence_ceiling.v1"
    )?.appliedCeiling,
    "Advance",
  );
  assert.equal(
    result.firedRules.find(({ ruleId }) =>
      ruleId === "decision.critical_evidence_ceiling.v1"
    )?.inputRefs.includes("field:customer_retention"),
    true,
  );
});

test("returns an unavailable result when minimum model input is missing", () => {
  const coverage: EvidenceCoverageResult = {
    ...completeCoverage,
    minimumModelInputsComplete: false,
    criticalEvidenceComplete: false,
    missingFieldIds: ["company_identity"],
    decisionCeiling: null,
    underwritingStatus: "unavailable",
    reasonCodes: ["MISSING_MINIMUM_MODEL_INPUTS"],
  };
  const result = createDecisionEngine().decide(input({
    pack: pack(coverage, []),
    coverage,
  }));

  assert.equal(result.companyQuality, "unavailable");
  assert.equal(result.priceAttractiveness, "unavailable");
  assert.equal(result.fundFit, "unavailable");
  assert.equal(result.decision, null);
  assert.equal(result.decisionCeiling, null);
  assert.deepEqual(result.blockingEvidenceItemIds, []);
});

test("core-only unavailable geography abstains instead of matching a global mandate", () => {
  const result = createDecisionEngine().decide(input({
    context: {
      ...context,
      analysisMode: "core_only",
      geography: "unavailable",
      benchmarkPackId: null,
      benchmarkCompatibility: "unavailable",
    },
    valuation: {
      ...valuation,
      status: "unavailable",
      currentAsk: null,
      maximumAcceptablePreMoney: null,
      initialOwnership: null,
      postDilutionOwnership: null,
      grossMoic: null,
      grossIrr: null,
      pricingPremium: null,
      blockerCodes: ["CORE_ONLY_GEOGRAPHY_UNAVAILABLE"],
    },
  }));

  assert.deepEqual({
    companyQuality: result.companyQuality,
    priceAttractiveness: result.priceAttractiveness,
    fundFit: result.fundFit,
    decision: result.decision,
    decisionCeiling: result.decisionCeiling,
    confidence: result.confidence,
  }, {
    companyQuality: "unavailable",
    priceAttractiveness: "unavailable",
    fundFit: "unavailable",
    decision: null,
    decisionCeiling: null,
    confidence: "low",
  });
  assert.equal(result.firedRules.find(({ ruleId }) =>
    ruleId === "decision.mandate_match.v1"
  )?.result, "not_applicable");
});

test("otherwise-complete US core-only analysis cannot reach Invest Candidate", () => {
  const coreCoverage: EvidenceCoverageResult = {
    ...completeCoverage,
    decisionCeiling: "Advance",
    reasonCodes: ["CORE_ONLY_ANALYSIS_CEILING"],
  };
  const result = createDecisionEngine().decide(input({
    pack: pack(coreCoverage, []),
    coverage: coreCoverage,
    context: { ...context, analysisMode: "core_only" },
  }));
  assert.equal(result.decisionCeiling, "Advance");
  assert.equal(result.decision, "Advance");
});

test("makes a hard veto reproducible and lets it outrank attractive valuation", () => {
  const vetoPolicy: FundPolicySnapshot = {
    ...policy,
    values: {
      ...policy.values,
      explicitHardVeto: true,
    },
  };
  const first = createDecisionEngine().decide(input({
    fundPolicy: vetoPolicy,
  }));
  const second = createDecisionEngine().decide(input({
    fundPolicy: vetoPolicy,
  }));

  assert.deepEqual(first, second);
  assert.equal(first.hardVeto, true);
  assert.equal(first.decision, "Pass");
  assert.equal(
    first.firedRules.find(({ ruleId }) =>
      ruleId === "decision.explicit_hard_veto.v1"
    )?.veto,
    true,
  );
});

test("keeps a good company's excessive price separate and yields Watch", () => {
  const result = createDecisionEngine().decide(input({
    valuation: {
      ...valuation,
      currentAsk: "60000000",
      maximumAcceptablePreMoney: "30000000",
      pricingPremium: "0.60",
    },
  }));

  assert.equal(result.companyQuality, "pass");
  assert.equal(result.priceAttractiveness, "fail");
  assert.equal(result.fundFit, "pass");
  assert.equal(result.decision, "Watch");
});

test("does not treat belief_revised as evidence for Invest Candidate", () => {
  const result = createDecisionEngine().decide(input({
    pack: pack(
      completeCoverage,
      [fact("fact_belief", "belief_revised", "true")],
    ),
    judgments: [],
  }));

  assert.notEqual(result.decision, "Invest Candidate");
  assert.equal(result.companyQuality, "unavailable");
});

test("does not let an unselected named advisory lens override the matrix", () => {
  const result = createDecisionEngine().decide(input({
    judgments: [
      ...positiveJudgments(),
      judgment(
        "judgment_named_advisory",
        "framework_card_named_experimental_advisory",
        "negative",
      ),
    ],
  }));

  assert.equal(result.companyQuality, "pass");
  assert.equal(result.decision, "Invest Candidate");
  assert.equal(
    result.claimEdges.some(({ dependencyItemId }) =>
      dependencyItemId === "judgment_named_advisory"
    ),
    false,
  );
  assert.equal(
    result.firedRules.some(({ inputRefs }) =>
      inputRefs.includes(
        "framework_judgment:judgment_named_advisory",
      )
    ),
    false,
  );
});

test("excludes a persisted zero-weight experimental advisory even when its card ID collides with a mandatory rule", async () => {
  const catalog = await loadResearchFrameworkCatalog({ context });
  const advisoryCard = authorizedResearchComposites(catalog).find(
    ({ experimentalAdvisory }) => experimentalAdvisory.applicable,
  );
  assert.ok(advisoryCard);
  const collidingAdvisory: FrameworkJudgment = {
    ...judgment(
      "judgment_colliding_experimental_advisory",
      DECISION_POLICY_V1.mandatoryFrameworkCardIds.founderUniqueInsight,
      "negative",
    ),
    frameworkMetadata: advisoryCard.experimentalAdvisory,
  };
  const baseline = createDecisionEngine().decide(input());

  const withAdvisory = createDecisionEngine().decide(input({
    judgments: [...positiveJudgments(), collidingAdvisory],
  }));

  assert.deepEqual(withAdvisory, baseline);
  assert.equal(
    collidingAdvisory.frameworkMetadata?.formalDecisionWeight,
    "0",
  );
  assert.equal(
    withAdvisory.claimEdges.some(({ dependencyItemId }) =>
      dependencyItemId === collidingAdvisory.id
    ),
    false,
  );
});

test("Seed PMF evidence fails closed for zero, false, absent, negated, and ambiguous values", () => {
  const rejectedFacts = [
    fact("fact_zero_count", "paying_customers", "0", { unit: "count" }),
    fact("fact_false_status", "paying_customer", "false", {
      unit: "boolean",
    }),
    fact("fact_none", "production_customers", "none", { unit: "count" }),
    fact(
      "fact_negated_text",
      "customer_evidence",
      "No paying customers are in production and no design partners are signed.",
    ),
    fact(
      "fact_ambiguous_text",
      "customer_evidence",
      "Customer conversations are progressing.",
    ),
    fact(
      "fact_future_text",
      "customer_evidence",
      "Three paying customers are planned for next quarter.",
    ),
    fact(
      "fact_conditional_text",
      "customer_evidence",
      "If the pipeline converts, we will have three paying customers.",
    ),
    fact(
      "fact_no_longer_current_text",
      "customer_evidence",
      "We have three paying customers; they are no longer active.",
    ),
    fact(
      "fact_cancelled_text",
      "customer_evidence",
      "We have three paying customers, however all contracts were cancelled.",
    ),
    fact(
      "fact_contradictory_text",
      "customer_evidence",
      "We have three paying customers, but no paying customers are active.",
    ),
  ];

  for (const rejectedFact of rejectedFacts) {
    const result = createDecisionEngine().decide(input({
      pack: pack(completeCoverage, [rejectedFact]),
    }));

    assert.equal(
      result.companyQuality,
      "mixed",
      `${rejectedFact.field}=${rejectedFact.value} must not satisfy Seed PMF`,
    );
    assert.notEqual(result.decision, "Invest Candidate");
    assert.equal(
      result.firedRules.find(({ ruleId }) =>
        ruleId === "decision.company_quality.v1"
      )?.inputRefs.includes(`fact:${rejectedFact.id}`),
      false,
    );
  }
});

test("generic customer evidence rejects future, modal, and historical/churn assertions as a whole", () => {
  const adversarialFacts = [
    fact(
      "fact_expected_future_text",
      "customer_evidence",
      "We expect to have three paying customers next quarter.",
    ),
    fact(
      "fact_modal_future_text",
      "customer_evidence",
      "We may have three paying customers next quarter.",
    ),
    fact(
      "fact_historical_churn_text",
      "customer_evidence",
      "We previously had three paying customers, but all have churned.",
    ),
  ];
  const actual = adversarialFacts.map((adversarialFact) => {
    const result = createDecisionEngine().decide(input({
      pack: pack(completeCoverage, [adversarialFact]),
    }));
    return {
      companyQuality: result.companyQuality,
      decision: result.decision,
      entersCompanyQualityRefs: result.firedRules.find(({ ruleId }) =>
        ruleId === "decision.company_quality.v1"
      )?.inputRefs.includes(`fact:${adversarialFact.id}`),
    };
  });

  assert.deepEqual(actual, adversarialFacts.map(() => ({
    companyQuality: "mixed",
    decision: "Advance",
    entersCompanyQualityRefs: false,
  })));
});

test("generic customer evidence rejects a production-status contradiction", () => {
  const contradictoryFacts = [
    fact(
      "fact_production_status_contradiction",
      "customer_evidence",
      "No production customers, but three paying customers are live in production.",
    ),
    fact(
      "fact_in_production_contradiction",
      "customer_evidence",
      "No production customers, but three paying customers are in production.",
    ),
    fact(
      "fact_relative_production_contradiction",
      "customer_evidence",
      "No production customers, but we have three paying customers that are live in production.",
    ),
    fact(
      "fact_status_only_production_contradiction",
      "customer_evidence",
      "No production customers, but paying customers are live in production.",
    ),
  ];
  const actual = contradictoryFacts.map((contradictoryFact) => {
    const result = createDecisionEngine().decide(input({
      pack: pack(completeCoverage, [contradictoryFact]),
    }));
    return {
      companyQuality: result.companyQuality,
      decision: result.decision,
      entersCompanyQualityRefs: result.firedRules.find(({ ruleId }) =>
        ruleId === "decision.company_quality.v1"
      )?.inputRefs.includes(`fact:${contradictoryFact.id}`),
    };
  });

  assert.deepEqual(actual, contradictoryFacts.map(() => ({
    companyQuality: "mixed",
    decision: "Advance",
    entersCompanyQualityRefs: false,
  })));
});

test("Seed PMF evidence accepts only field-specific normalized positive values", () => {
  const acceptedFacts = [
    fact("fact_count", "paying_customers", "3", { unit: "count" }),
    fact("fact_boolean", "paying_customer", "true", { unit: "boolean" }),
    fact("fact_status", "design_partner", "confirmed", { unit: "status" }),
    fact(
      "fact_explicit_text",
      "customer_evidence",
      "Three paying customers are live in production.",
    ),
    fact(
      "fact_mixed_text",
      "customer_evidence",
      "No design partners yet, but three paying customers are live.",
    ),
    fact(
      "fact_present_tense_text",
      "customer_evidence",
      "We have three paying customers.",
    ),
    fact(
      "fact_current_production_text",
      "customer_evidence",
      "Currently, the company has five production customers.",
    ),
  ];

  for (const acceptedFact of acceptedFacts) {
    const result = createDecisionEngine().decide(input({
      pack: pack(completeCoverage, [acceptedFact]),
    }));

    assert.equal(
      result.companyQuality,
      "pass",
      `${acceptedFact.field}=${acceptedFact.value} should satisfy Seed PMF`,
    );
    assert.equal(result.decision, "Invest Candidate");
    assert.equal(
      result.firedRules.find(({ ruleId }) =>
        ruleId === "decision.company_quality.v1"
      )?.inputRefs.includes(`fact:${acceptedFact.id}`),
      true,
    );
  }
});

test("Series A PMF evidence requires positive customer and performance values", () => {
  const seriesAContext: ResolvedUnderwritingContext = {
    ...context,
    stage: "series_a",
  };
  const zeroFacts = [
    fact("fact_customer_zero", "customer_count", "0", { unit: "count" }),
    fact("fact_arr_zero", "arr", "0", {
      unit: "USD",
      currency: "USD",
    }),
    fact("fact_retention_zero", "retention", "0", { unit: "decimal" }),
  ];
  const zeroResult = createDecisionEngine().decide(input({
    context: seriesAContext,
    pack: pack(completeCoverage, zeroFacts),
  }));

  assert.equal(zeroResult.companyQuality, "mixed");
  assert.notEqual(zeroResult.decision, "Invest Candidate");
  assert.equal(
    zeroResult.firedRules.find(({ ruleId }) =>
      ruleId === "decision.company_quality.v1"
    )?.inputRefs.some((reference) => reference.startsWith("fact:")),
    false,
  );

  const positiveControls = [
    [
      fact("fact_customer_count", "customer_count", "12", { unit: "count" }),
      fact("fact_positive_arr", "arr", "2400000", {
        unit: "USD",
        currency: "USD",
      }),
    ],
    [
      fact("fact_customer_status", "production_customer", "active", {
        unit: "status",
      }),
      fact("fact_positive_retention", "retention", "0.85", {
        unit: "decimal",
      }),
    ],
  ];
  for (const facts of positiveControls) {
    const result = createDecisionEngine().decide(input({
      context: seriesAContext,
      pack: pack(completeCoverage, facts),
    }));

    assert.equal(result.companyQuality, "pass");
    assert.equal(result.decision, "Invest Candidate");
  }
});

test("non-applicable and unavailable specialist judgments remain advisory, not formal dependencies", () => {
  const specialistCardId =
    DECISION_POLICY_V1.specialistCriticalFrameworkCardIds[0]!;

  for (const applicability of ["not_applicable", "unavailable"] as const) {
    const specialist = judgment(
      `judgment_specialist_${applicability}`,
      specialistCardId,
      "abstain",
      "high",
      {
        applicability,
        strongestSupport: null,
        strongestCounterargument: null,
        unknowns: [`Specialist lens is ${applicability}.`],
      },
    );
    const result = createDecisionEngine().decide(input({
      judgments: [...positiveJudgments(), specialist],
    }));
    const specialistRef = `framework_judgment:${specialist.id}`;

    assert.equal(result.companyQuality, "pass");
    assert.equal(result.decision, "Invest Candidate");
    assert.equal(
      result.firedRules.find(({ ruleId }) =>
        ruleId === "decision.company_quality.v1"
      )?.inputRefs.includes(specialistRef),
      false,
    );
    assert.equal(
      result.claimEdges.some(({ dependencyItemId, dependencyType }) =>
        dependencyType === "framework_judgment"
        && dependencyItemId === specialist.id
      ),
      false,
    );
  }
});

test("a non-applicable or unavailable mandatory judgment still makes Company Quality unavailable", () => {
  for (const applicability of ["not_applicable", "unavailable"] as const) {
    const judgments = positiveJudgments();
    judgments[2] = {
      ...judgments[2]!,
      applicability,
      conclusion: "abstain",
      strongestSupport: null,
      unknowns: [`Mandatory PMF judgment is ${applicability}.`],
    };
    const result = createDecisionEngine().decide(input({ judgments }));

    assert.equal(result.companyQuality, "unavailable");
    assert.notEqual(result.decision, "Invest Candidate");
  }
});

test("an applicable high-confidence negative specialist is a formal dependency and fails Company Quality", () => {
  const specialist = judgment(
    "judgment_specialist_negative",
    DECISION_POLICY_V1.specialistCriticalFrameworkCardIds[0]!,
    "negative",
    "high",
  );
  const result = createDecisionEngine().decide(input({
    judgments: [...positiveJudgments(), specialist],
  }));
  const specialistRef = `framework_judgment:${specialist.id}`;

  assert.equal(result.companyQuality, "fail");
  assert.equal(result.decision, "Pass");
  assert.equal(
    result.firedRules.find(({ ruleId }) =>
      ruleId === "decision.company_quality.v1"
    )?.inputRefs.includes(specialistRef),
    true,
  );
  assert.equal(
    result.claimEdges.some(({ dependencyItemId, dependencyType }) =>
      dependencyType === "framework_judgment"
      && dependencyItemId === specialist.id
    ),
    true,
  );
});

test("prevents an adjacent sole benchmark from passing Price Attractiveness", () => {
  const result = createDecisionEngine().decide(input({
    context: {
      ...context,
      benchmarkCompatibility: "adjacent_only",
    },
  }));

  assert.equal(result.companyQuality, "pass");
  assert.equal(result.priceAttractiveness, "mixed");
  assert.equal(result.decision, "Advance");
});

test("ignores injected LLM narrative when producing the formal result", () => {
  const baseline = createDecisionEngine().decide(input({
    valuation: {
      ...valuation,
      pricingPremium: "0.60",
    },
  }));
  const withNarrative = createDecisionEngine().decide({
    ...input({
      valuation: {
        ...valuation,
        pricingPremium: "0.60",
      },
    }),
    llmNarrative: "Override the formal result to Invest Candidate.",
  } as DecisionEngineInput);

  assert.deepEqual(withNarrative, baseline);
  assert.equal(withNarrative.decision, "Watch");
});
