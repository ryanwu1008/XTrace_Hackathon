import type {
  Assumption,
  Calculation,
  ClaimEdge,
  EvidencePack,
  Fact,
} from "../../contracts/evidence";
import type {
  FundPolicySnapshot,
  ResolvedUnderwritingContext,
  ScenarioModel,
  ValuationEvaluation,
} from "../../contracts/underwriting";
import { z } from "zod";
import { multiplyDecimalStrings } from "../numbers";
import {
  calculationId,
  completedCalculation,
  type CalculationOptions,
  type FormulaValueRef,
  type ValuationArtifactSet,
  type ValuationEngine,
} from "./contracts";
import { evaluateMarketComps } from "./market-comps";
import { evaluateOwnership } from "./ownership";
import { evaluateGrossReturns } from "./returns";
import { buildScenarioModel, validateProbabilityWeights } from "./scenarios";
import { evaluateVentureMethod } from "./venture-method";

const IsoCalendarDateSchema = z.iso.date();

export function createValuationEngine(
  options: CalculationOptions = {},
): ValuationEngine {
  const evaluateDetailed = (input: Parameters<ValuationEngine["evaluate"]>[0]) =>
    evaluateValuationArtifacts(input, options);
  return {
    evaluate(input) {
      return evaluateDetailed(input).evaluation;
    },
    evaluateDetailed,
  };
}

export function evaluateValuationArtifacts(input: {
  pack: EvidencePack;
  context: ResolvedUnderwritingContext;
  fundPolicy: FundPolicySnapshot;
}, options: CalculationOptions = {}): ValuationArtifactSet {
  const calculationScope = `valuation:${input.pack.id}`;
  const formulaOptions = { ...options, calculationScope };
  const scenarioModel = buildScenarioModel({
    pack: input.pack,
    candidateRunId: `valuation:${input.pack.id}`,
    formulaPolicyVersion: input.context.valuationMethodPolicyId,
    probabilityWeighted:
      input.fundPolicy.values.probabilityWeighted === true,
  });
  if (
    input.context.analysisMode === "core_only"
    && input.context.geography === "unavailable"
  ) {
    return coreOnlyUnavailableArtifacts(input.pack.id, scenarioModel);
  }
  const currentAskFact = acceptedFact(
    input.pack,
    "reported_valuation",
  );
  const valuationBasis = acceptedFact(
    input.pack,
    "reported_valuation_basis",
  )?.value ?? null;
  const benchmarkPair = resolveBenchmarkPair(
    input.pack,
    input.context.benchmarkPackId,
  );
  const benchmark = benchmarkPair?.value ?? null;
  const benchmarkStaleAfter = benchmarkPair?.staleAfter ?? null;
  const benchmarkStale = benchmarkStaleAfter
    ? benchmarkIsStale(
      input.pack.asOfDate,
      benchmarkStaleAfter.value,
    )
    : null;
  const multiplierBear = recommendedPolicyAssumption(
    input.pack,
    "scenario_price_multiplier",
    "bear",
  );
  const multiplierBase = recommendedPolicyAssumption(
    input.pack,
    "scenario_price_multiplier",
    "base",
  );
  const multiplierBull = recommendedPolicyAssumption(
    input.pack,
    "scenario_price_multiplier",
    "bull",
  );
  const market = evaluateMarketComps({
    benchmarkValue: benchmark ? assumptionRef(benchmark) : null,
    benchmarkFreshness: benchmarkStaleAfter
      ? assumptionRef(benchmarkStaleAfter)
      : null,
    currentReportedValuation: currentAskFact ? factRef(currentAskFact) : null,
    compatibility: input.context.benchmarkCompatibility,
    stale: benchmarkStale,
    multipliers: {
      bear: multiplierBear ? assumptionRef(multiplierBear) : null,
      base: multiplierBase ? assumptionRef(multiplierBase) : null,
      bull: multiplierBull ? assumptionRef(multiplierBull) : null,
    },
  }, formulaOptions);

  const probabilityStatus = validateProbabilityWeights(scenarioModel);
  const baseInputs = scenarioModel.scenarios.find(
    ({ name }) => name === "base",
  )!.inputs;
  const baseExitArr = scenarioRef(baseInputs, "arr_path");
  const baseExitMultiple = scenarioRef(baseInputs, "exit_multiple");
  const returnTarget = stageReturnTarget(
    input.fundPolicy,
    input.context.stage,
  );
  const baseCurrency = policyString(input.fundPolicy, "baseCurrency");
  const venture = evaluateVentureMethod({
    terms: input.context.securityType === "preferred"
      ? "simple_pre_money_preferred"
      : "preferred_waterfall",
    investment: policyRef(
      "initialCheckMax",
      policyString(input.fundPolicy, "initialCheckMax"),
      { unit: "currency", currency: baseCurrency },
    ),
    targetGrossMoic: policyRef(
      `returnTargets.${input.context.stage}.grossMoic`,
      stringValue(returnTarget, "grossMoic"),
      { unit: "multiple" },
    ),
    exitArr: baseExitArr,
    exitArrMultiple: baseExitMultiple,
    futureDilutionRate: policyRef(
      "acceptableFutureDilution",
      policyString(input.fundPolicy, "acceptableFutureDilution"),
      { unit: "decimal" },
    ),
  }, formulaOptions);

  let initialOwnership: string | null = null;
  let postDilutionOwnership: string | null = null;
  let grossMoic: string | null = null;
  let grossIrr: string | null = null;
  let ownershipCalculations: Calculation[] = [];
  let ownershipClaimEdges: ClaimEdge[] = [];
  let returnCalculations: Calculation[] = [];
  let returnClaimEdges: ClaimEdge[] = [];
  const blockerCodes = [
    ...market.blockerCodes,
    ...venture.blockerCodes,
    ...(benchmarkPair === null ? ["benchmark_pair_invalid"] : []),
  ];

  const investment = policyString(input.fundPolicy, "initialCheckMax");
  const dilution = policyString(
    input.fundPolicy,
    "acceptableFutureDilution",
  );
  if (
    currentAskFact
    && investment
    && valuationBasis === "pre_money"
  ) {
    const ownership = evaluateOwnership({
      investment: policyRef("initialCheckMax", investment, {
        unit: "currency",
        currency: baseCurrency,
      }),
      preMoney: factRef(currentAskFact),
      futureDilutionRate: policyRef(
        "acceptableFutureDilution",
        dilution,
        { unit: "decimal" },
      ),
    }, formulaOptions);
    blockerCodes.push(...ownership.blockerCodes);
    ownershipCalculations = ownership.calculations;
    ownershipClaimEdges = ownership.claimEdges;
    initialOwnership = ownership.value?.initialOwnership ?? null;
    postDilutionOwnership =
      ownership.value?.postDilutionOwnership ?? null;
    if (ownership.status === "completed") {
      const exitEquityValue = venture.value?.exitEquityValue;
      const holdingYears = stringValue(returnTarget, "horizonYears");
      if (postDilutionOwnership && exitEquityValue && holdingYears) {
        const proceeds = multiplyDecimalStrings(
          exitEquityValue,
          postDilutionOwnership,
        );
        const exitProceedsCalculation = completedCalculation({
          formulaId: "gross_deal_moic_v1",
          outputField: "exit_proceeds",
          inputRefs: [],
          output: proceeds,
          unit: "currency",
          currency: baseCurrency,
          computedAt: (options.now ?? (() => new Date()))().toISOString(),
          calculationScope,
        });
        const returns = evaluateGrossReturns({
          invested: policyRef("initialCheckMax", investment, {
            unit: "currency",
            currency: baseCurrency,
          }),
          proceeds: {
            itemId: exitProceedsCalculation.id,
            value: proceeds,
            type: "calculation",
            unit: "currency",
            currency: baseCurrency,
            period: null,
          },
          holdingYears: policyRef(
            `returnTargets.${input.context.stage}.horizonYears`,
            holdingYears,
            { unit: "years", period: holdingYears },
          ),
        }, formulaOptions);
        blockerCodes.push(...returns.blockerCodes);
        returnCalculations = [
          exitProceedsCalculation,
          ...returns.calculations,
        ];
        returnClaimEdges = [
          {
            claimItemId: exitProceedsCalculation.id,
            dependencyItemId: calculationId(
              calculationScope,
              "venture_return_method_v1",
              "exit_equity_value",
            ),
            dependencyType: "calculation",
          },
          {
            claimItemId: exitProceedsCalculation.id,
            dependencyItemId: calculationId(
              calculationScope,
              "future_dilution_v1",
              "post_dilution_ownership",
            ),
            dependencyType: "calculation",
          },
          ...returns.claimEdges,
        ];
        grossMoic = returns.value?.moic ?? null;
        grossIrr = returns.value?.irr ?? null;
      }
    }
  } else if (currentAskFact) {
    blockerCodes.push(
      valuationBasis === null
        ? "valuation_basis_missing"
        : "valuation_basis_unknown",
    );
  }

  if (
    probabilityStatus.status !== "completed"
    && probabilityStatus.status !== "not_applicable"
  ) {
    blockerCodes.push("probability_weights_invalid");
  }
  const calculations = [
    ...market.calculations,
    ...venture.calculations,
    ...ownershipCalculations,
    ...returnCalculations,
  ];
  const calculationClaimEdges = [
    ...market.claimEdges,
    ...venture.claimEdges,
    ...ownershipClaimEdges,
    ...returnClaimEdges,
  ];
  const calculationIds = calculations.map(({ id }) => id);
  const completedSections = [
    market.status === "completed",
    venture.status === "completed",
    initialOwnership !== null,
    grossMoic !== null,
  ].filter(Boolean).length;

  const evaluation: ValuationEvaluation = {
    id: `valuation:${input.pack.id}`,
    status: completedSections === 0
      ? "unavailable"
      : completedSections === 4
        ? "completed"
        : "partial",
    scenarios: (["bear", "base", "bull"] as const).map((name) => ({
      name,
      valuation: market.scenarios[name],
      calculationIds: market.scenarioCalculationIds[name]
        ? [market.scenarioCalculationIds[name]]
        : [],
    })),
    currentAsk: currentAskFact?.value ?? null,
    maximumAcceptablePreMoney:
      venture.value?.maximumAcceptablePreMoney ?? null,
    initialOwnership,
    postDilutionOwnership,
    grossMoic,
    grossIrr,
    pricingPremium: market.pricingPremium,
    calculationIds,
    blockerCodes: [...new Set(blockerCodes)],
  };
  return {
    evaluation,
    scenarioModel,
    calculations,
    calculationClaimEdges,
  };
}

function coreOnlyUnavailableArtifacts(
  packId: string,
  scenarioModel: ScenarioModel,
): ValuationArtifactSet {
  return {
    evaluation: {
      id: `valuation:${packId}`,
      status: "unavailable",
      scenarios: (["bear", "base", "bull"] as const).map((name) => ({
        name,
        valuation: null,
        calculationIds: [],
      })),
      currentAsk: null,
      maximumAcceptablePreMoney: null,
      initialOwnership: null,
      postDilutionOwnership: null,
      grossMoic: null,
      grossIrr: null,
      pricingPremium: null,
      calculationIds: [],
      blockerCodes: ["CORE_ONLY_GEOGRAPHY_UNAVAILABLE"],
    },
    scenarioModel,
    calculations: [],
    calculationClaimEdges: [],
  };
}

function acceptedFact(pack: EvidencePack, field: string): Fact | null {
  return pack.facts.find(
    (candidate) =>
      candidate.field === field
      && candidate.acceptedForGate,
  ) ?? null;
}

function resolveBenchmarkPair(
  pack: EvidencePack,
  benchmarkPackId: string | null,
): {
  value: Assumption;
  staleAfter: Assumption;
} | null {
  if (benchmarkPackId === null) return null;
  const values = pack.assumptions.filter(
    ({ field }) => field === "compatible_benchmark_value",
  );
  const staleAfterValues = pack.assumptions.filter(
    ({ field }) => field === "compatible_benchmark_stale_after",
  );
  if (values.length !== 1 || staleAfterValues.length !== 1) return null;
  const value = values[0];
  const staleAfter = staleAfterValues[0];
  if (
    !isExactBenchmarkPackAssumption(value, benchmarkPackId)
    || !isExactBenchmarkPackAssumption(staleAfter, benchmarkPackId)
  ) {
    return null;
  }
  return { value, staleAfter };
}

function isExactBenchmarkPackAssumption(
  candidate: Assumption,
  benchmarkPackId: string,
): boolean {
  return candidate.scenario === "all"
    && candidate.provenanceOrigin === "benchmark"
    && candidate.inputRefIds.length === 1
    && candidate.inputRefIds[0] === benchmarkPackId;
}

function recommendedPolicyAssumption(
  pack: EvidencePack,
  field: string,
  scenario: "bear" | "base" | "bull",
): Assumption | null {
  return pack.assumptions.find(
    (candidate) =>
      candidate.field === field
      && candidate.scenario === scenario
      && candidate.provenanceOrigin === "recommended_policy",
  ) ?? null;
}

function factRef(fact: Fact): FormulaValueRef {
  return {
    itemId: fact.id,
    value: fact.value,
    type: "fact",
    unit: fact.unit,
    currency: fact.currency,
    period: evidencePeriod(fact.periodStart, fact.periodEnd),
  };
}

function assumptionRef(value: Assumption): FormulaValueRef {
  const currency = /^[A-Z]{3}$/.test(value.unit ?? "")
    ? value.unit
    : null;
  return {
    itemId: value.id,
    value: value.value,
    type: value.provenanceOrigin === "benchmark"
      ? "benchmark"
      : "assumption",
    unit: currency ? "currency" : value.unit,
    currency,
    period: null,
  };
}

function policyRef(
  itemId: string,
  value: string | null,
  metadata: {
    unit?: string | null;
    currency?: string | null;
    period?: string | null;
  } = {},
): FormulaValueRef | null {
  return value === null
    ? null
    : {
      itemId: `policy:${itemId}`,
      value,
      type: "policy",
      unit: metadata.unit ?? null,
      currency: metadata.currency ?? null,
      period: metadata.period ?? null,
    };
}

function scenarioRef(
  inputs: ReturnType<typeof buildScenarioModel>["scenarios"][number]["inputs"],
  field: "arr_path" | "exit_multiple",
): FormulaValueRef | null {
  const input = inputs.find((candidate) => candidate.field === field);
  if (!input?.value) return null;
  return {
    itemId: input.evidenceItemId ?? input.assumptionItemId!,
    value: input.value,
    type: input.evidenceItemId ? "fact" : "assumption",
    unit: /^[A-Z]{3}$/.test(input.unit ?? "") ? "currency" : input.unit,
    currency: /^[A-Z]{3}$/.test(input.unit ?? "") ? input.unit : null,
    period: null,
  };
}

function policyString(
  policy: FundPolicySnapshot,
  key: string,
): string | null {
  const value = policy.values[key];
  return typeof value === "string" ? value : null;
}

function policyRecord(
  policy: FundPolicySnapshot,
  key: string,
): Record<string, unknown> | null {
  const value = policy.values[key];
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function stageReturnTarget(
  policy: FundPolicySnapshot,
  stage: ResolvedUnderwritingContext["stage"],
): Record<string, unknown> | null {
  const targets = policyRecord(policy, "returnTargets");
  const value = targets?.[stage];
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(
  record: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

function benchmarkIsStale(
  asOfDate: string,
  staleAfter: string,
): boolean | null {
  if (!IsoCalendarDateSchema.safeParse(asOfDate).success
    || !IsoCalendarDateSchema.safeParse(staleAfter).success) {
    return null;
  }
  return asOfDate > staleAfter;
}

function evidencePeriod(
  periodStart: string | null,
  periodEnd: string | null,
): string | null {
  if (periodStart && periodEnd) return `${periodStart}/${periodEnd}`;
  return periodStart ?? periodEnd;
}
