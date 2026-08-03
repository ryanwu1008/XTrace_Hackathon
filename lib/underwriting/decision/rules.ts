import type {
  EvidenceCoverageResult,
  EvidencePack,
} from "../../contracts/evidence";
import type {
  DecisionResult,
  FrameworkJudgment,
  FundPolicySnapshot,
  ResolvedUnderwritingContext,
  ValuationEvaluation,
} from "../../contracts/underwriting";
import {
  addDecimalStrings,
  multiplyDecimalStrings,
  requireNonNegativeDecimalString,
  requirePositiveDecimalString,
  subtractDecimalStrings,
} from "../numbers";

export type DimensionResult = "pass" | "mixed" | "fail" | "unavailable";
export type DecisionLabel = NonNullable<DecisionResult["decision"]>;
export type FiredRule = DecisionResult["firedRules"][number];

export interface DecisionPolicy {
  readonly id: string;
  readonly version: string;
  readonly matrixVersion: "1";
  readonly mandatoryFrameworkCardIds: {
    readonly marketSizeWhyNow: string;
    readonly founderUniqueInsight: string;
    readonly productMarketFit: string;
  };
  readonly specialistCriticalFrameworkCardIds: readonly string[];
  readonly seedPmfEvidenceFields: readonly string[];
  readonly seriesAPmfCustomerFields: readonly string[];
  readonly seriesAPmfPerformanceFields: readonly string[];
  readonly unsupportedPayoutBlockerCodes: readonly string[];
  readonly explicitHardVetoPolicyKey: string;
}

export interface DecisionEngineInput {
  pack: EvidencePack;
  coverage: EvidenceCoverageResult;
  judgments: FrameworkJudgment[];
  valuation: ValuationEvaluation;
  fundPolicy: FundPolicySnapshot;
  context: ResolvedUnderwritingContext;
  decisionPolicy: DecisionPolicy;
}

export interface DecisionRuleEvaluation {
  companyQuality: DimensionResult;
  priceAttractiveness: DimensionResult;
  fundFit: DimensionResult;
  mandateMismatch: boolean;
  hardVeto: boolean;
  actionablePositiveSignal: boolean;
  decisionCeiling: DecisionLabel | null;
  firedRules: FiredRule[];
}

export const DECISION_POLICY_V1: DecisionPolicy = Object.freeze({
  id: "decision_policy_seed_b2b_saas_v1",
  version: "1",
  matrixVersion: "1",
  mandatoryFrameworkCardIds: Object.freeze({
    marketSizeWhyNow: "framework_card_synthetic_1_v1",
    founderUniqueInsight: "framework_card_synthetic_2_v1",
    productMarketFit: "framework_card_synthetic_3_v1",
  }),
  specialistCriticalFrameworkCardIds: Object.freeze([
    "framework_card_synthetic_4_v1",
    "framework_card_synthetic_5_v1",
    "framework_card_synthetic_6_v1",
    "framework_card_synthetic_7_v1",
  ]),
  seedPmfEvidenceFields: Object.freeze([
    "customer_evidence",
    "paying_customer",
    "paying_customers",
    "production_customer",
    "production_customers",
    "design_partner",
    "design_partners",
  ]),
  seriesAPmfCustomerFields: Object.freeze([
    "customer_evidence",
    "paying_customer",
    "paying_customers",
    "production_customer",
    "production_customers",
    "customer_count",
  ]),
  seriesAPmfPerformanceFields: Object.freeze([
    "arr",
    "revenue",
    "recurring_revenue",
    "retention",
    "gross_retention",
    "net_revenue_retention",
  ]),
  unsupportedPayoutBlockerCodes: Object.freeze([
    "unsupported_financing_terms",
  ]),
  explicitHardVetoPolicyKey: "explicitHardVeto",
});

const RULE_IDS = {
  minimumInput: "decision.minimum_model_input.v1",
  criticalEvidence: "decision.critical_evidence_ceiling.v1",
  mandate: "decision.mandate_match.v1",
  explicitVeto: "decision.explicit_hard_veto.v1",
  unsupportedPayout: "decision.unsupported_payout_terms.v1",
  companyQuality: "decision.company_quality.v1",
  priceBasis: "decision.price_basis.v1",
  priceReturns: "decision.price_return_thresholds.v1",
  fundCheck: "decision.fund_check_range.v1",
  fundOwnership: "decision.fund_ownership.v1",
  fundConcentration: "decision.fund_concentration.v1",
  matrix: "decision.matrix.v1",
} as const;

export function evaluateDecisionRules(
  input: DecisionEngineInput,
): DecisionRuleEvaluation {
  const rules: FiredRule[] = [];
  const minimumComplete = input.coverage.minimumModelInputsComplete
    && input.coverage.underwritingStatus === "available";
  rules.push(rule({
    ruleId: RULE_IDS.minimumInput,
    inputRefs: [
      typedRef("evidence_pack", input.pack.id),
      ...input.coverage.missingFieldIds.map((id) => typedRef("field", id)),
    ],
    result: minimumComplete ? "pass" : "fail",
    appliedCeiling: minimumComplete ? null : null,
  }));

  if (!minimumComplete) {
    return {
      companyQuality: "unavailable",
      priceAttractiveness: "unavailable",
      fundFit: "unavailable",
      mandateMismatch: false,
      hardVeto: false,
      actionablePositiveSignal: false,
      decisionCeiling: null,
      firedRules: rules,
    };
  }

  if (
    input.context.analysisMode === "core_only"
    && input.context.geography === "unavailable"
  ) {
    rules.push(rule({
      ruleId: RULE_IDS.mandate,
      inputRefs: [
        typedRef("policy_ref", `${input.fundPolicy.id}#mandates`),
        typedRef("underwriting_context", input.context.id),
      ],
      result: "not_applicable",
    }));
    return {
      companyQuality: "unavailable",
      priceAttractiveness: "unavailable",
      fundFit: "unavailable",
      mandateMismatch: false,
      hardVeto: false,
      actionablePositiveSignal: false,
      decisionCeiling: null,
      firedRules: rules,
    };
  }

  const decisionCeiling = input.context.analysisMode === "core_only"
    ? "Advance"
    : resolveDecisionCeiling(input.coverage);
  rules.push(rule({
    ruleId: RULE_IDS.criticalEvidence,
    inputRefs: [
      typedRef("evidence_pack", input.pack.id),
      ...input.coverage.missingFieldIds.map((id) => typedRef("field", id)),
      ...input.coverage.blockingConflictIds.map((id) =>
        typedRef("evidence_conflict", id)
      ),
    ],
    result: input.coverage.criticalEvidenceComplete ? "pass" : "fail",
    appliedCeiling: decisionCeiling,
  }));

  const mandateMismatch = !matchesMandate(
    input.fundPolicy,
    input.context,
  );
  rules.push(rule({
    ruleId: RULE_IDS.mandate,
    inputRefs: [
      typedRef("policy_ref", `${input.fundPolicy.id}#mandates`),
      typedRef("underwriting_context", input.context.id),
    ],
    result: mandateMismatch ? "fail" : "pass",
  }));

  const explicitVeto =
    input.fundPolicy.values[
      input.decisionPolicy.explicitHardVetoPolicyKey
    ] === true;
  rules.push(rule({
    ruleId: RULE_IDS.explicitVeto,
    inputRefs: [
      typedRef(
        "policy_ref",
        `${input.fundPolicy.id}#${input.decisionPolicy.explicitHardVetoPolicyKey}`,
      ),
    ],
    result: explicitVeto ? "fail" : "pass",
    veto: explicitVeto,
  }));

  const unsupportedPayout =
    input.decisionPolicy.unsupportedPayoutBlockerCodes.some(
      (code) => input.valuation.blockerCodes.includes(code),
    );
  rules.push(rule({
    ruleId: RULE_IDS.unsupportedPayout,
    inputRefs: [
      typedRef("valuation", input.valuation.id),
      ...input.valuation.blockerCodes.map((code) =>
        typedRef("blocker_code", code)
      ),
    ],
    result: unsupportedPayout ? "fail" : "pass",
    veto: unsupportedPayout,
  }));

  const company = evaluateCompanyQuality(input);
  rules.push(rule({
    ruleId: RULE_IDS.companyQuality,
    inputRefs: uniqueSorted([
      ...company.judgmentIds.map((id) =>
        typedRef("framework_judgment", id)
      ),
      ...company.evidenceIds.map((id) => typedRef("fact", id)),
    ]),
    result: dimensionRuleResult(company.result),
  }));

  const price = evaluatePriceAttractiveness(input);
  rules.push(rule({
    ruleId: RULE_IDS.priceBasis,
    inputRefs: uniqueSorted([
      typedRef("valuation", input.valuation.id),
      typedRef("underwriting_context", input.context.id),
      ...(input.context.benchmarkPackId
        ? [typedRef("benchmark_ref", input.context.benchmarkPackId)]
        : []),
      ...input.valuation.blockerCodes.map((code) =>
        typedRef("blocker_code", code)
      ),
    ]),
    result: price.basisSupported ? "pass" : "fail",
  }));
  rules.push(rule({
    ruleId: RULE_IDS.priceReturns,
    inputRefs: uniqueSorted([
      typedRef("valuation", input.valuation.id),
      ...input.valuation.calculationIds.map((id) =>
        typedRef("calculation", id)
      ),
      typedRef(
        "policy_ref",
        `${input.fundPolicy.id}#returnTargets.${input.context.stage}`,
      ),
      typedRef(
        "policy_ref",
        `${input.fundPolicy.id}#valuationPremiumReviewThreshold`,
      ),
      typedRef(
        "policy_ref",
        `${input.fundPolicy.id}#valuationPremiumBlockerThreshold`,
      ),
    ]),
    result: dimensionRuleResult(price.result),
  }));

  const fund = evaluateFundFit(input, {
    mandateMismatch,
    explicitVeto,
    unsupportedPayout,
  });
  const selectedCheckPolicyField =
    policyString(input.fundPolicy, "selectedInitialCheck") === null
      ? "initialCheckMax"
      : "selectedInitialCheck";
  rules.push(rule({
    ruleId: RULE_IDS.fundCheck,
    inputRefs: [
      typedRef(
        "policy_ref",
        `${input.fundPolicy.id}#${selectedCheckPolicyField}`,
      ),
      typedRef("policy_ref", `${input.fundPolicy.id}#initialCheckMin`),
      typedRef("policy_ref", `${input.fundPolicy.id}#initialCheckMax`),
    ],
    result: optionalBooleanResult(fund.checkWithinRange),
  }));
  rules.push(rule({
    ruleId: RULE_IDS.fundOwnership,
    inputRefs: [
      typedRef("valuation", input.valuation.id),
      typedRef("policy_ref", `${input.fundPolicy.id}#targetOwnershipMin`),
      typedRef("policy_ref", `${input.fundPolicy.id}#targetOwnershipMax`),
      typedRef("policy_ref", `${input.fundPolicy.id}#hardMinimumOwnership`),
    ],
    result: optionalBooleanResult(fund.ownershipWithinTarget),
    veto: fund.hardMinimumOwnershipVeto,
  }));
  rules.push(rule({
    ruleId: RULE_IDS.fundConcentration,
    inputRefs: [
      typedRef(
        "policy_ref",
        `${input.fundPolicy.id}#${selectedCheckPolicyField}`,
      ),
      typedRef(
        "policy_ref",
        `${input.fundPolicy.id}#reserveMultipleOfInitialCheck`,
      ),
      typedRef("policy_ref", `${input.fundPolicy.id}#committedFundSize`),
      typedRef(
        "policy_ref",
        `${input.fundPolicy.id}#portfolioConcentrationLimit`,
      ),
    ],
    result: optionalBooleanResult(fund.withinConcentration),
    veto: fund.concentrationVeto,
  }));

  return {
    companyQuality: company.result,
    priceAttractiveness: price.result,
    fundFit: fund.result,
    mandateMismatch,
    hardVeto: explicitVeto
      || unsupportedPayout
      || fund.hardMinimumOwnershipVeto
      || fund.concentrationVeto,
    actionablePositiveSignal: company.actionablePositiveSignal,
    decisionCeiling,
    firedRules: rules,
  };
}

export function decisionFromMatrix(input: {
  companyQuality: DimensionResult;
  priceAttractiveness: DimensionResult;
  fundFit: DimensionResult;
  criticalEvidenceComplete: boolean;
  mandateMismatch: boolean;
  hardVeto: boolean;
  actionablePositiveSignal: boolean;
}): DecisionLabel {
  if (input.hardVeto || input.mandateMismatch) return "Pass";
  if (input.companyQuality === "fail") return "Pass";
  if (
    input.companyQuality === "pass"
    && input.priceAttractiveness === "fail"
  ) {
    return "Watch";
  }
  if (
    input.companyQuality === "mixed"
    && !input.actionablePositiveSignal
  ) {
    return "Watch";
  }
  if (
    input.companyQuality === "pass"
    && input.priceAttractiveness === "pass"
    && input.fundFit === "pass"
    && input.criticalEvidenceComplete
  ) {
    return "Invest Candidate";
  }
  return "Advance";
}

export function applyDecisionCeiling(
  decision: DecisionLabel,
  ceiling: DecisionLabel | null,
): DecisionLabel {
  if (ceiling === null) return decision;
  const order: Record<DecisionLabel, number> = {
    Pass: 0,
    Watch: 1,
    Advance: 2,
    "Invest Candidate": 3,
  };
  return order[decision] <= order[ceiling] ? decision : ceiling;
}

export function matrixRule(input: {
  policy: DecisionPolicy;
  dimensions: Pick<
    DecisionRuleEvaluation,
    | "companyQuality"
    | "priceAttractiveness"
    | "fundFit"
    | "decisionCeiling"
  >;
  decision: DecisionLabel;
  hardVeto: boolean;
}): FiredRule {
  return rule({
    ruleId: RULE_IDS.matrix,
    inputRefs: [
      typedRef(
        "decision_dimension",
        `company_quality=${input.dimensions.companyQuality}`,
      ),
      typedRef(
        "decision_dimension",
        `price_attractiveness=${input.dimensions.priceAttractiveness}`,
      ),
      typedRef(
        "decision_dimension",
        `fund_fit=${input.dimensions.fundFit}`,
      ),
      typedRef("decision_policy", input.policy.id),
    ],
    result: "pass",
    appliedCeiling: input.dimensions.decisionCeiling,
    veto: input.hardVeto,
  });
}

function evaluateCompanyQuality(input: DecisionEngineInput): {
  result: DimensionResult;
  actionablePositiveSignal: boolean;
  evidenceIds: string[];
  judgmentIds: string[];
} {
  const ids = input.decisionPolicy.mandatoryFrameworkCardIds;
  const market = uniqueJudgment(input.judgments, ids.marketSizeWhyNow);
  const founder = uniqueJudgment(input.judgments, ids.founderUniqueInsight);
  const pmf = uniqueJudgment(input.judgments, ids.productMarketFit);
  const mandatory = [market, founder, pmf];
  const specialist = input.judgments.filter((candidate) =>
    input.decisionPolicy.specialistCriticalFrameworkCardIds.includes(
      candidate.frameworkCardId,
    )
  );
  const applicableSpecialist = specialist.filter(
    ({ applicability }) => applicability === "applicable",
  );
  const judgmentIds = uniqueSorted([
    ...mandatory.flatMap((candidate) => candidate ? [candidate.id] : []),
    ...applicableSpecialist.map(({ id }) => id),
  ]);
  const evidenceIds = stagePmfEvidenceIds(input);
  const actionablePositiveSignal = mandatory.some(
    (candidate) =>
      candidate?.applicability === "applicable"
      && candidate.conclusion === "supportive",
  );

  if (mandatory.some((candidate) => !isAvailableJudgment(candidate))) {
    return {
      result: "unavailable",
      actionablePositiveSignal,
      evidenceIds,
      judgmentIds,
    };
  }
  const available = mandatory as FrameworkJudgment[];
  const specialistNegative = applicableSpecialist.some((candidate) =>
    candidate.conclusion === "negative"
    && candidate.confidence.judgment === "high"
  );
  if (
    available.some(({ conclusion }) => conclusion === "negative")
    || specialistNegative
  ) {
    return {
      result: "fail",
      actionablePositiveSignal,
      evidenceIds,
      judgmentIds,
    };
  }

  const marketAccepted = conclusionIsSupportiveOrMixed(market!);
  const founderAccepted = conclusionIsSupportiveOrMixed(founder!);
  const pmfAccepted = pmf!.conclusion === "supportive"
    && evidenceIds.length > 0;
  const supportiveCount = available.filter(
    ({ conclusion }) => conclusion === "supportive",
  ).length;
  return {
    result:
      marketAccepted
        && founderAccepted
        && pmfAccepted
        && supportiveCount >= 2
        ? "pass"
        : "mixed",
    actionablePositiveSignal,
    evidenceIds,
    judgmentIds,
  };
}

function evaluatePriceAttractiveness(input: DecisionEngineInput): {
  result: DimensionResult;
  basisSupported: boolean;
} {
  const valuation = input.valuation;
  const benchmarkBlocked = [
    "benchmark_stale",
    "benchmark_incompatible",
    "benchmark_freshness_missing",
    "benchmark_input_missing",
    "benchmark_pair_invalid",
    "valuation_basis_missing",
    "valuation_basis_unknown",
  ].some((code) => valuation.blockerCodes.includes(code));
  const basisSupported =
    input.context.benchmarkPackId !== null
    && ["exact", "broad_compatible"].includes(
      input.context.benchmarkCompatibility,
    )
    && !benchmarkBlocked;

  if (valuation.status === "unavailable") {
    return { result: "unavailable", basisSupported };
  }
  const target = stageReturnTarget(input.fundPolicy, input.context.stage);
  const reviewThreshold = policyString(
    input.fundPolicy,
    "valuationPremiumReviewThreshold",
  );
  const blockerThreshold = policyString(
    input.fundPolicy,
    "valuationPremiumBlockerThreshold",
  );
  const values = [
    valuation.currentAsk,
    valuation.maximumAcceptablePreMoney,
    valuation.grossMoic,
    valuation.grossIrr,
    valuation.pricingPremium,
    target?.grossMoic ?? null,
    target?.grossIrr ?? null,
    reviewThreshold,
    blockerThreshold,
  ];
  if (values.some((value) => value === null)) {
    return {
      result: valuation.status === "partial" ? "mixed" : "unavailable",
      basisSupported,
    };
  }
  try {
    const premiumBlocks = decimalGreaterThan(
      valuation.pricingPremium!,
      blockerThreshold!,
    );
    const allScenariosMiss = valuation.blockerCodes.some((code) =>
      code === "all_scenarios_miss_return_target"
      || code === "all_scenarios_below_return_target"
    );
    if (premiumBlocks || allScenariosMiss) {
      return { result: "fail", basisSupported };
    }
    const pass =
      basisSupported
      && decimalLessThanOrEqual(
        valuation.currentAsk!,
        valuation.maximumAcceptablePreMoney!,
      )
      && decimalGreaterThanOrEqual(
        valuation.grossMoic!,
        target!.grossMoic,
      )
      && decimalGreaterThanOrEqual(
        valuation.grossIrr!,
        target!.grossIrr,
      )
      && decimalLessThanOrEqual(
        valuation.pricingPremium!,
        reviewThreshold!,
      );
    return { result: pass ? "pass" : "mixed", basisSupported };
  } catch {
    return { result: "unavailable", basisSupported: false };
  }
}

function evaluateFundFit(
  input: DecisionEngineInput,
  gates: {
    mandateMismatch: boolean;
    explicitVeto: boolean;
    unsupportedPayout: boolean;
  },
): {
  result: DimensionResult;
  checkWithinRange: boolean | null;
  ownershipWithinTarget: boolean | null;
  withinConcentration: boolean | null;
  hardMinimumOwnershipVeto: boolean;
  concentrationVeto: boolean;
} {
  const selectedCheck = policyString(input.fundPolicy, "selectedInitialCheck")
    ?? policyString(input.fundPolicy, "initialCheckMax");
  const minimumCheck = policyString(input.fundPolicy, "initialCheckMin");
  const maximumCheck = policyString(input.fundPolicy, "initialCheckMax");
  const ownershipMinimum = policyString(
    input.fundPolicy,
    "targetOwnershipMin",
  );
  const ownershipMaximum = policyString(
    input.fundPolicy,
    "targetOwnershipMax",
  );
  const hardMinimumOwnership = policyNullableString(
    input.fundPolicy,
    "hardMinimumOwnership",
  );
  const reserveMultiple = policyString(
    input.fundPolicy,
    "reserveMultipleOfInitialCheck",
  );
  const committedFund = policyString(input.fundPolicy, "committedFundSize");
  const concentrationLimit = policyString(
    input.fundPolicy,
    "portfolioConcentrationLimit",
  );
  let checkWithinRange: boolean | null = null;
  let ownershipWithinTarget: boolean | null = null;
  let withinConcentration: boolean | null = null;
  let hardMinimumOwnershipVeto = false;
  let concentrationVeto = false;

  try {
    if (selectedCheck && minimumCheck && maximumCheck) {
      checkWithinRange =
        decimalGreaterThanOrEqual(selectedCheck, minimumCheck)
        && decimalLessThanOrEqual(selectedCheck, maximumCheck);
    }
    if (
      input.valuation.initialOwnership
      && ownershipMinimum
      && ownershipMaximum
    ) {
      ownershipWithinTarget =
        decimalGreaterThanOrEqual(
          input.valuation.initialOwnership,
          ownershipMinimum,
        )
        && decimalLessThanOrEqual(
          input.valuation.initialOwnership,
          ownershipMaximum,
        );
      hardMinimumOwnershipVeto = hardMinimumOwnership !== null
        && decimalLessThan(
          input.valuation.initialOwnership,
          hardMinimumOwnership,
        );
    }
    if (
      selectedCheck
      && reserveMultiple
      && committedFund
      && concentrationLimit
    ) {
      const deployedWithReserve = addDecimalStrings(
        selectedCheck,
        multiplyDecimalStrings(selectedCheck, reserveMultiple),
      );
      const concentrationCap = multiplyDecimalStrings(
        committedFund,
        concentrationLimit,
      );
      withinConcentration = decimalLessThanOrEqual(
        deployedWithReserve,
        concentrationCap,
      );
      concentrationVeto = !withinConcentration;
    }
  } catch {
    return {
      result: "unavailable",
      checkWithinRange: null,
      ownershipWithinTarget: null,
      withinConcentration: null,
      hardMinimumOwnershipVeto: false,
      concentrationVeto: false,
    };
  }

  if (
    gates.mandateMismatch
    || gates.explicitVeto
    || gates.unsupportedPayout
    || hardMinimumOwnershipVeto
    || concentrationVeto
    || checkWithinRange === false
  ) {
    return {
      result: "fail",
      checkWithinRange,
      ownershipWithinTarget,
      withinConcentration,
      hardMinimumOwnershipVeto,
      concentrationVeto,
    };
  }
  if (
    checkWithinRange === null
    || ownershipWithinTarget === null
    || withinConcentration === null
  ) {
    return {
      result: "unavailable",
      checkWithinRange,
      ownershipWithinTarget,
      withinConcentration,
      hardMinimumOwnershipVeto,
      concentrationVeto,
    };
  }
  return {
    result: ownershipWithinTarget ? "pass" : "mixed",
    checkWithinRange,
    ownershipWithinTarget,
    withinConcentration,
    hardMinimumOwnershipVeto,
    concentrationVeto,
  };
}

function stagePmfEvidenceIds(input: DecisionEngineInput): string[] {
  const acceptedFacts = input.pack.facts.filter(
    ({ acceptedForGate }) => acceptedForGate,
  );
  if (input.context.stage === "seed") {
    return acceptedFacts.filter((fact) =>
      input.decisionPolicy.seedPmfEvidenceFields.includes(fact.field)
        && positiveCustomerEvidence(fact)
    ).map(({ id }) => id);
  }
  const customerFacts = acceptedFacts.filter((fact) =>
    input.decisionPolicy.seriesAPmfCustomerFields.includes(fact.field)
    && positiveCustomerEvidence(fact)
  );
  const performanceFacts = acceptedFacts.filter((fact) =>
    input.decisionPolicy.seriesAPmfPerformanceFields.includes(fact.field)
    && positivePerformanceEvidence(fact)
  );
  return customerFacts.length > 0 && performanceFacts.length > 0
    ? uniqueSorted([
      ...customerFacts.map(({ id }) => id),
      ...performanceFacts.map(({ id }) => id),
    ])
    : [];
}

const CUSTOMER_COUNT_FIELDS = new Set([
  "paying_customers",
  "production_customers",
  "design_partners",
  "customer_count",
]);

const CUSTOMER_STATUS_FIELDS = new Set([
  "paying_customer",
  "production_customer",
  "design_partner",
]);

const POSITIVE_CUSTOMER_STATUSES = new Set([
  "active",
  "confirmed",
  "live",
  "paying",
  "production",
  "signed",
  "true",
  "yes",
]);

const MONEY_PERFORMANCE_FIELDS = new Set([
  "arr",
  "revenue",
  "recurring_revenue",
]);

const RETENTION_PERFORMANCE_FIELDS = new Set([
  "retention",
  "gross_retention",
  "net_revenue_retention",
]);

function positiveCustomerEvidence(fact: EvidencePack["facts"][number]): boolean {
  if (CUSTOMER_COUNT_FIELDS.has(fact.field)) {
    return isPositiveDecimal(fact.value);
  }
  if (CUSTOMER_STATUS_FIELDS.has(fact.field)) {
    return POSITIVE_CUSTOMER_STATUSES.has(normalizeStatus(fact.value));
  }
  return fact.field === "customer_evidence"
    && hasExplicitPositiveCustomerText(fact.value);
}

function positivePerformanceEvidence(
  fact: EvidencePack["facts"][number],
): boolean {
  if (MONEY_PERFORMANCE_FIELDS.has(fact.field)) {
    return isPositiveDecimal(fact.value);
  }
  if (!RETENTION_PERFORMANCE_FIELDS.has(fact.field)) return false;
  const unit = fact.unit?.trim().toLowerCase() ?? "";
  if (["decimal", "rate", "ratio"].includes(unit)) {
    return isPositiveDecimalAtMost(fact.value, "1");
  }
  if (["%", "pct", "percent", "percentage"].includes(unit)) {
    return isPositiveDecimalAtMost(fact.value, "100");
  }
  return false;
}

function normalizeStatus(value: string): string {
  return value.trim().toLowerCase().replace(/[- ]+/g, "_");
}

function isPositiveDecimal(value: string): boolean {
  try {
    requirePositiveDecimalString(value);
    return true;
  } catch {
    return false;
  }
}

function isPositiveDecimalAtMost(value: string, maximum: string): boolean {
  try {
    requirePositiveDecimalString(value);
    requireNonNegativeDecimalString(subtractDecimalStrings(maximum, value));
    return true;
  } catch {
    return false;
  }
}

type CustomerEvidenceKind =
  | "paying_customer"
  | "production_customer"
  | "design_partner";

const CUSTOMER_QUANTITY_PATTERN =
  String.raw`(?:[1-9]\d*(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|several|multiple)`;
const CUSTOMER_SUBJECT_PATTERN =
  String.raw`(?:we|the company|company|the startup|startup|the business|business|it|they)`;
const CUSTOMER_SIGNAL_PATTERN =
  String.raw`(?:(?:paying(?:\s+production)?|production)\s+customers?|(?:signed\s+|confirmed\s+|active\s+)?design[- ]?partners?)`;
const CURRENT_CUSTOMER_STATUS_PATTERN =
  String.raw`(?:active|live in production|live|signed|confirmed|in production)`;
const CURRENT_CUSTOMER_CLAUSE_PATTERNS = [
  new RegExp(
    String.raw`^(?:currently,?\s+)?${CUSTOMER_QUANTITY_PATTERN}\s+${CUSTOMER_SIGNAL_PATTERN}(?:\s+(?:are\s+)?${CURRENT_CUSTOMER_STATUS_PATTERN})?$`,
  ),
  new RegExp(
    String.raw`^(?:currently,?\s+)?${CUSTOMER_SUBJECT_PATTERN}\s+(?:currently\s+)?(?:has|have|serve|serves|is serving|are serving|secured|signed|onboarded)\s+(?:${CUSTOMER_QUANTITY_PATTERN}\s+)?${CUSTOMER_SIGNAL_PATTERN}(?:\s+(?:that|who)\s+are\s+${CURRENT_CUSTOMER_STATUS_PATTERN})?$`,
  ),
  new RegExp(
    String.raw`^(?:currently,?\s+)?there\s+(?:is|are)\s+${CUSTOMER_QUANTITY_PATTERN}\s+${CUSTOMER_SIGNAL_PATTERN}(?:\s+(?:that|who)\s+are\s+${CURRENT_CUSTOMER_STATUS_PATTERN})?$`,
  ),
  new RegExp(
    String.raw`^(?:currently,?\s+)?${CUSTOMER_SIGNAL_PATTERN}\s+(?:are|remain)\s+${CURRENT_CUSTOMER_STATUS_PATTERN}$`,
  ),
];
const NEGATIVE_CUSTOMER_CLAUSE_PATTERN = new RegExp(
  String.raw`^(?:currently,?\s+)?(?:(?:${CUSTOMER_SUBJECT_PATTERN}\s+(?:currently\s+)?(?:has|have)|there\s+(?:is|are))\s+)?no\s+(?:(?:paying|production)\s+customers?|design[- ]?partners?)(?:\s+yet)?$`,
);
const GENERIC_CUSTOMER_ASSERTION_BLOCKER =
  /\b(?:can|could|may|might|would|should|will|perhaps|possibly|possible|conditional|conditionally|contingent|assuming|if|unless|expect|expects|expected|expecting|plan|plans|planned|planning|target|targets|targeted|targeting|forecast|forecasts|forecasted|forecasting|projected|projection|projections|intend|intends|intended|intending|hope|hopes|hoped|hoping|anticipate|anticipates|anticipated|anticipating|potential|prospective|future|upcoming|previously|formerly|historically|prior|once|had|used to|no longer|not anymore|churn|churns|churned|churning|lost|lose|cancel|cancels|cancelled|canceled|terminated|lapsed|departed|inactive|gone|ceased|stopped)\b|\b(?:next|last)\s+(?:week|month|quarter|year)\b/;
const CUSTOMER_CLAUSE_SEPARATOR =
  /\s*(?:;|,\s*(?:but|however|although|though|while|whereas|except|despite)\s+|\s+(?:but|however|although|though|while|whereas|except|despite)\s+)\s*/;

function hasExplicitPositiveCustomerText(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "");
  if (
    normalized === ""
    || GENERIC_CUSTOMER_ASSERTION_BLOCKER.test(normalized)
  ) {
    return false;
  }
  const clauses = normalized.split(CUSTOMER_CLAUSE_SEPARATOR)
    .map((clause) => clause.trim())
    .filter(Boolean);
  const positiveKinds = new Set<CustomerEvidenceKind>();
  const negativeKinds = new Set<CustomerEvidenceKind>();
  for (const clause of clauses) {
    const currentKinds = currentCustomerClauseKinds(clause);
    if (currentKinds.length > 0) {
      currentKinds.forEach((kind) => positiveKinds.add(kind));
      continue;
    }
    const negative = negativeCustomerClauseKinds(clause);
    if (negative.length === 0) return false;
    negative.forEach((kind) => negativeKinds.add(kind));
  }
  return positiveKinds.size > 0
    && [...positiveKinds].every((kind) => !negativeKinds.has(kind));
}

function currentCustomerClauseKinds(clause: string): CustomerEvidenceKind[] {
  if (!CURRENT_CUSTOMER_CLAUSE_PATTERNS.some((pattern) => pattern.test(clause))) {
    return [];
  }
  return customerKindsInSignal(clause);
}

function negativeCustomerClauseKinds(clause: string): CustomerEvidenceKind[] {
  if (!NEGATIVE_CUSTOMER_CLAUSE_PATTERN.test(clause)) return [];
  return customerKindsInSignal(clause);
}

function customerKindsInSignal(value: string): CustomerEvidenceKind[] {
  if (/\bdesign[- ]?partners?\b/.test(value)) return ["design_partner"];
  if (/\bpaying\s+production\s+customers?\b/.test(value)) {
    return ["paying_customer", "production_customer"];
  }
  if (/\bpaying\s+customers?\b/.test(value)) {
    return /\b(?:live\s+)?in production\b/.test(value)
      ? ["paying_customer", "production_customer"]
      : ["paying_customer"];
  }
  if (/\bproduction\s+customers?\b/.test(value)) {
    return ["production_customer"];
  }
  return [];
}

function matchesMandate(
  policy: FundPolicySnapshot,
  context: ResolvedUnderwritingContext,
): boolean {
  const stages = policyStrings(policy, "stageMandate");
  const businessModels = policyStrings(policy, "businessModelMandate");
  const geographies = policyStrings(policy, "geographyMandate");
  return stages.includes(context.stage)
    && businessModels.includes(context.businessModel)
    && (
      geographies.includes(context.geography)
      || geographies.includes("global")
    );
}

function stageReturnTarget(
  policy: FundPolicySnapshot,
  stage: ResolvedUnderwritingContext["stage"],
): { grossMoic: string; grossIrr: string } | null {
  const targets = policy.values.returnTargets;
  if (
    targets === null
    || typeof targets !== "object"
    || Array.isArray(targets)
  ) {
    return null;
  }
  const selected = targets[stage];
  if (
    selected === null
    || typeof selected !== "object"
    || Array.isArray(selected)
  ) {
    return null;
  }
  const selectedTarget = selected as Record<string, unknown>;
  const grossMoic = selectedTarget.grossMoic;
  const grossIrr = selectedTarget.grossIrr;
  return typeof grossMoic === "string" && typeof grossIrr === "string"
    ? { grossMoic, grossIrr }
    : null;
}

function resolveDecisionCeiling(
  coverage: EvidenceCoverageResult,
): DecisionLabel {
  if (!coverage.criticalEvidenceComplete) return "Advance";
  return coverage.decisionCeiling ?? "Advance";
}

function uniqueJudgment(
  judgments: FrameworkJudgment[],
  frameworkCardId: string,
): FrameworkJudgment | null {
  const matches = judgments.filter(
    (candidate) => candidate.frameworkCardId === frameworkCardId,
  );
  if (matches.length > 1) {
    throw new Error(
      `Decision input contains duplicate judgments for ${frameworkCardId}.`,
    );
  }
  return matches[0] ?? null;
}

function isAvailableJudgment(
  judgment: FrameworkJudgment | null,
): judgment is FrameworkJudgment {
  return judgment !== null
    && judgment.applicability === "applicable"
    && judgment.conclusion !== "abstain";
}

function conclusionIsSupportiveOrMixed(
  judgment: FrameworkJudgment,
): boolean {
  return judgment.conclusion === "supportive"
    || judgment.conclusion === "mixed";
}

function policyString(
  policy: FundPolicySnapshot,
  key: string,
): string | null {
  const value = policy.values[key];
  return typeof value === "string" ? value : null;
}

function policyNullableString(
  policy: FundPolicySnapshot,
  key: string,
): string | null {
  const value = policy.values[key];
  return typeof value === "string" ? value : null;
}

function policyStrings(
  policy: FundPolicySnapshot,
  key: string,
): string[] {
  const value = policy.values[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function decimalGreaterThan(left: string, right: string): boolean {
  const difference = subtractDecimalStrings(left, right);
  return difference !== "0" && !difference.startsWith("-");
}

function decimalLessThan(left: string, right: string): boolean {
  return subtractDecimalStrings(left, right).startsWith("-");
}

function decimalGreaterThanOrEqual(left: string, right: string): boolean {
  return !decimalLessThan(left, right);
}

function decimalLessThanOrEqual(left: string, right: string): boolean {
  return !decimalGreaterThan(left, right);
}

function dimensionRuleResult(
  result: DimensionResult,
): FiredRule["result"] {
  if (result === "unavailable") return "not_applicable";
  return result === "pass" ? "pass" : "fail";
}

function optionalBooleanResult(
  result: boolean | null,
): FiredRule["result"] {
  return result === null ? "not_applicable" : result ? "pass" : "fail";
}

function typedRef(type: string, id: string): string {
  return `${type}:${id}`;
}

function rule(input: {
  ruleId: string;
  inputRefs: string[];
  result: FiredRule["result"];
  appliedCeiling?: string | null;
  veto?: boolean;
}): FiredRule {
  return {
    ruleId: input.ruleId,
    inputRefs: uniqueSorted(input.inputRefs),
    result: input.result,
    appliedCeiling: input.appliedCeiling ?? null,
    veto: input.veto ?? false,
  };
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf8);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
