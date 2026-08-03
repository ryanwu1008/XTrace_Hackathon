import assert from "node:assert/strict";
import test from "node:test";

import {
  CalculationSchema,
  ClaimEdgeSchema,
  type EvidencePack,
} from "../../../lib/contracts/evidence";
import type {
  FundPolicySnapshot,
  ResolvedUnderwritingContext,
} from "../../../lib/contracts/underwriting";
import { ScenarioModelSchema } from "../../../lib/contracts/underwriting";
import {
  buildScenarioModel,
  validateProbabilityWeights,
} from "../../../lib/underwriting/valuation/scenarios";
import { createValuationEngine } from "../../../lib/underwriting/valuation/service";

const requiredScenarioFields = [
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

test("persists every required field in exactly Bear, Base, and Bull", () => {
  const model = buildScenarioModel({
    pack: evidencePack(),
    candidateRunId: "candidate_1",
    formulaPolicyVersion: "1",
    probabilityWeighted: false,
  });

  assert.deepEqual(model.scenarios.map(({ name }) => name), [
    "bear",
    "base",
    "bull",
  ]);
  for (const scenario of model.scenarios) {
    assert.deepEqual(
      scenario.inputs.map(({ field }) => field),
      requiredScenarioFields,
    );
    for (const input of scenario.inputs) {
      if (input.value === null) {
        assert.equal(input.evidenceItemId, null);
        assert.equal(input.assumptionItemId, null);
        assert.ok(input.unavailableReason && input.unavailableReason.length > 0);
      }
    }
  }

  const growth = model.scenarios[0].inputs.find(
    (input) => input.field === "growth",
  );
  assert.deepEqual(growth, {
    id: "scenario:candidate_1:bear:growth",
    scenario: "bear",
    field: "growth",
    value: "0.8",
    unit: "decimal",
    evidenceItemId: "fact_growth",
    assumptionItemId: null,
    unavailableReason: null,
  });
});

test("refuses probability weighting unless weights total exactly one", () => {
  const invalid = buildScenarioModel({
    pack: evidencePack({
      assumptions: [
        ...evidencePack().assumptions,
        assumption("prob_bear", "bear", "probability", "0.2"),
        assumption("prob_base", "base", "probability", "0.5"),
        assumption("prob_bull", "bull", "probability", "0.2"),
      ],
    }),
    candidateRunId: "candidate_invalid_probability",
    formulaPolicyVersion: "1",
    probabilityWeighted: true,
  });
  assert.deepEqual(validateProbabilityWeights(invalid), {
    status: "invalid_domain",
    total: "0.9",
  });

  const valid = buildScenarioModel({
    pack: evidencePack({
      assumptions: [
        ...evidencePack().assumptions,
        assumption("prob_bear", "bear", "probability", "0.2"),
        assumption("prob_base", "base", "probability", "0.5"),
        assumption("prob_bull", "bull", "probability", "0.3"),
      ],
    }),
    candidateRunId: "candidate_valid_probability",
    formulaPolicyVersion: "1",
    probabilityWeighted: true,
  });
  assert.deepEqual(validateProbabilityWeights(valid), {
    status: "completed",
    total: "1",
  });

  for (const weights of [
    ["-1", "1", "1"],
    ["1.1", "-0.1", "0"],
  ] as const) {
    assert.equal(
      validateProbabilityWeights(weightedScenario(weights)).status,
      "invalid_domain",
    );
  }
  assert.deepEqual(validateProbabilityWeights(
    weightedScenario(["0", "0", "1"]),
  ), {
    status: "completed",
    total: "1",
  });
  assert.deepEqual(validateProbabilityWeights(
    weightedScenario(["-0", "0", "1"]),
  ), {
    status: "completed",
    total: "1",
  });
});

test("evaluates pricing while refusing ownership when valuation basis is unknown", () => {
  const engine = createValuationEngine({
    now: () => new Date("2026-07-29T12:00:00.000Z"),
  });
  const result = engine.evaluate({
    pack: evidencePack(),
    context: context(),
    fundPolicy: policy(),
  });

  assert.equal(result.status, "partial");
  assert.deepEqual(result.scenarios.map(({ name, valuation }) => ({
    name,
    valuation,
  })), [
    { name: "bear", valuation: "15000000" },
    { name: "base", valuation: "20000000" },
    { name: "bull", valuation: "25000000" },
  ]);
  assert.equal(result.currentAsk, "25000000");
  assert.equal(result.pricingPremium, "0.25");
  assert.equal(result.initialOwnership, null);
  assert.equal(result.postDilutionOwnership, null);
  assert.ok(result.blockerCodes.includes("valuation_basis_unknown"));
  assert.ok(!("netFundMoic" in result));
  assert.ok(!("netFundIrr" in result));
});

test("core-only unavailable geography never turns qualitative valuation prose into numeric outputs", () => {
  const candidatePack = evidencePack();
  candidatePack.coverage = {
    minimumModelInputsComplete: true,
    criticalEvidenceComplete: true,
    missingFieldIds: [],
    blockingConflictIds: [],
    decisionCeiling: "Advance",
    underwritingStatus: "available",
    reasonCodes: [],
  };
  candidatePack.facts = candidatePack.facts.map((fact) =>
    fact.field === "reported_valuation"
      ? {
          ...fact,
          value:
            "$450 million historical anonymous-source valuation reporting",
        }
      : fact
  );
  const detailed = createValuationEngine().evaluateDetailed({
    pack: candidatePack,
    context: {
      ...context(),
      analysisMode: "core_only",
      geography: "unavailable",
      benchmarkPackId: null,
      benchmarkCompatibility: "unavailable",
    },
    fundPolicy: policy(),
  });

  assert.equal(detailed.scenarioModel.scenarios.length, 3);
  assert.equal(detailed.scenarioModel.scenarios.every(({ inputs }) =>
    inputs.length === 17
  ), true);
  assert.deepEqual(detailed.evaluation, {
    id: `valuation:${candidatePack.id}`,
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
  });
  assert.deepEqual(detailed.calculations, []);
  assert.deepEqual(detailed.calculationClaimEdges, []);
});

test("wires all six formula versions for a supported pre-money preferred round", () => {
  const pack = evidencePack();
  pack.facts = pack.facts.map((fact) =>
    fact.field === "reported_valuation"
      ? { ...fact, value: "18000000" }
      : fact.field === "reported_valuation_basis"
        ? { ...fact, value: "pre_money" }
        : fact
  );
  const result = createValuationEngine({
    now: () => new Date("2026-07-29T12:00:00.000Z"),
  }).evaluate({
    pack,
    context: context(),
    fundPolicy: policy(),
  });

  assert.equal(result.status, "completed");
  assert.equal(result.initialOwnership, "0.1");
  assert.equal(result.postDilutionOwnership, "0.05");
  assert.equal(result.grossMoic, "2.5");
  assert.ok(result.grossIrr);
  for (const formulaId of [
    "market_comps_v1",
    "venture_return_method_v1",
    "simple_pre_post_ownership_v1",
    "future_dilution_v1",
    "gross_deal_moic_v1",
    "annualized_gross_irr_v1",
  ]) {
    assert.ok(
      result.calculationIds.some((id) => id.includes(formulaId)),
      `${formulaId} calculation must be included`,
    );
  }
});

test("returns one persistable ScenarioModel and strict Calculation artifact set", () => {
  const detailed = createValuationEngine({
    now: () => new Date("2026-07-29T12:00:00.000Z"),
  }).evaluateDetailed({
    pack: evidencePack(),
    context: context(),
    fundPolicy: policy(),
  });

  assert.doesNotThrow(() => ScenarioModelSchema.parse(detailed.scenarioModel));
  for (const calculation of detailed.calculations) {
    assert.doesNotThrow(() => CalculationSchema.parse(calculation));
  }
  assert.equal(
    new Set(detailed.calculations.map(({ id }) => id)).size,
    detailed.calculations.length,
  );
  for (const calculationId of detailed.evaluation.calculationIds) {
    assert.equal(
      detailed.calculations.filter(({ id }) => id === calculationId).length,
      1,
      `${calculationId} must resolve exactly once`,
    );
  }
  for (const edge of detailed.calculationClaimEdges) {
    assert.doesNotThrow(() => ClaimEdgeSchema.parse(edge));
    for (const calculationId of [edge.claimItemId, edge.dependencyItemId]) {
      assert.equal(
        detailed.calculations.filter(({ id }) => id === calculationId).length,
        1,
        `${calculationId} lineage endpoint must resolve exactly once`,
      );
    }
  }
});

test("derives benchmark staleness from its immutable EvidencePack expiry", () => {
  const pack = evidencePack();
  pack.assumptions = pack.assumptions.map((item) =>
    item.field === "compatible_benchmark_stale_after"
      ? { ...item, value: "2026-07-28" }
      : item
  );
  const result = createValuationEngine().evaluate({
    pack,
    context: context(),
    fundPolicy: policy(),
  });

  assert.deepEqual(
    result.scenarios.map(({ valuation }) => valuation),
    [null, null, null],
  );
  assert.equal(result.pricingPremium, null);
  assert.ok(result.blockerCodes.includes("benchmark_stale"));
});

test("rejects benchmark freshness that is not benchmark-origin", () => {
  const pack = evidencePack();
  pack.assumptions = pack.assumptions.map((item) =>
    item.field === "compatible_benchmark_stale_after"
      ? { ...item, provenanceOrigin: "recommended_policy" }
      : item
  );
  const result = createValuationEngine().evaluate({
    pack,
    context: context(),
    fundPolicy: policy(),
  });

  assert.deepEqual(
    result.scenarios.map(({ valuation }) => valuation),
    [null, null, null],
  );
  assert.equal(result.pricingPremium, null);
  assert.ok(result.blockerCodes.includes("benchmark_freshness_missing"));
  assert.ok(result.blockerCodes.includes("benchmark_pair_invalid"));
});

test("fails closed unless benchmark value and expiry form one exact immutable-pack pair", () => {
  const invalidCases: {
    name: string;
    configure: (
      pack: EvidencePack,
      resolvedContext: ResolvedUnderwritingContext,
    ) => void;
  }[] = [
    {
      name: "missing resolved benchmark pack",
      configure: (_pack, resolvedContext) => {
        resolvedContext.benchmarkPackId = null;
      },
    },
    {
      name: "missing benchmark value",
      configure: (pack) => {
        pack.assumptions = pack.assumptions.filter(
          ({ field }) => field !== "compatible_benchmark_value",
        );
      },
    },
    {
      name: "missing benchmark expiry",
      configure: (pack) => {
        pack.assumptions = pack.assumptions.filter(
          ({ field }) => field !== "compatible_benchmark_stale_after",
        );
      },
    },
    {
      name: "duplicate benchmark value",
      configure: (pack) => {
        const value = pack.assumptions.find(
          ({ field }) => field === "compatible_benchmark_value",
        )!;
        pack.assumptions.push({ ...value, id: "benchmark_seed_duplicate" });
      },
    },
    {
      name: "duplicate benchmark expiry",
      configure: (pack) => {
        const expiry = pack.assumptions.find(
          ({ field }) => field === "compatible_benchmark_stale_after",
        )!;
        pack.assumptions.push({
          ...expiry,
          id: "benchmark_stale_after_duplicate",
        });
      },
    },
    {
      name: "benchmark value has policy provenance",
      configure: (pack) => {
        pack.assumptions = pack.assumptions.map((item) =>
          item.field === "compatible_benchmark_value"
            ? { ...item, provenanceOrigin: "recommended_policy" }
            : item
        );
      },
    },
    {
      name: "benchmark value references a different pack",
      configure: (pack) => {
        pack.assumptions = pack.assumptions.map((item) =>
          item.field === "compatible_benchmark_value"
            ? { ...item, inputRefIds: ["other_benchmark_pack"] }
            : item
        );
      },
    },
    {
      name: "benchmark expiry references a different pack",
      configure: (pack) => {
        pack.assumptions = pack.assumptions.map((item) =>
          item.field === "compatible_benchmark_stale_after"
            ? { ...item, inputRefIds: ["other_benchmark_pack"] }
            : item
        );
      },
    },
    {
      name: "benchmark value has an ambiguous pack binding",
      configure: (pack) => {
        pack.assumptions = pack.assumptions.map((item) =>
          item.field === "compatible_benchmark_value"
            ? {
              ...item,
              inputRefIds: [
                "benchmark_pack_seed",
                "other_benchmark_pack",
              ],
            }
            : item
        );
      },
    },
  ];

  for (const invalidCase of invalidCases) {
    const pack = evidencePack();
    const resolvedContext = context();
    invalidCase.configure(pack, resolvedContext);

    const result = createValuationEngine().evaluate({
      pack,
      context: resolvedContext,
      fundPolicy: policy(),
    });

    assert.deepEqual(
      result.scenarios.map(({ valuation }) => valuation),
      [null, null, null],
      invalidCase.name,
    );
    assert.equal(result.pricingPremium, null, invalidCase.name);
    assert.ok(
      result.blockerCodes.includes("benchmark_pair_invalid"),
      invalidCase.name,
    );
  }
});

test("rejects calendar-invalid benchmark freshness dates", () => {
  for (const staleAfter of ["2026-02-30", "2026-99-99"]) {
    const pack = evidencePack();
    pack.assumptions = pack.assumptions.map((item) =>
      item.field === "compatible_benchmark_stale_after"
        ? { ...item, value: staleAfter }
        : item
    );
    const result = createValuationEngine().evaluate({
      pack,
      context: context(),
      fundPolicy: policy(),
    });

    assert.deepEqual(
      result.scenarios.map(({ valuation }) => valuation),
      [null, null, null],
    );
    assert.equal(result.pricingPremium, null);
    assert.ok(result.blockerCodes.includes("benchmark_freshness_missing"));
  }
});

test("fails closed for EUR, missing, and mixed valuation currencies", () => {
  for (const currency of ["EUR", null] as const) {
    const pack = evidencePack();
    pack.facts = pack.facts.map((fact) =>
      fact.field === "reported_valuation"
        ? { ...fact, currency }
        : fact
    );
    const result = createValuationEngine().evaluate({
      pack,
      context: context(),
      fundPolicy: policy(),
    });
    assert.deepEqual(
      result.scenarios.map(({ valuation }) => valuation),
      [null, null, null],
    );
    assert.equal(result.pricingPremium, null);
    assert.equal(result.initialOwnership, null);
    assert.ok(result.blockerCodes.some((code) => code.includes("currency")));
  }

  const mixed = evidencePack();
  mixed.assumptions = mixed.assumptions.map((item) =>
    item.field === "compatible_benchmark_value"
      ? { ...item, unit: "EUR" }
      : item
  );
  const result = createValuationEngine().evaluate({
    pack: mixed,
    context: context(),
    fundPolicy: policy(),
  });
  assert.deepEqual(
    result.scenarios.map(({ valuation }) => valuation),
    [null, null, null],
  );
  assert.equal(result.pricingPremium, null);
  assert.ok(result.blockerCodes.includes("currency_unsupported"));
});

test("uses persisted recommended-policy Assumptions for scenario multipliers", () => {
  const detailed = createValuationEngine().evaluateDetailed({
    pack: evidencePack(),
    context: context(),
    fundPolicy: policy(),
  });

  for (const [scenario, assumptionId] of [
    ["bear", "multiplier_bear"],
    ["base", "multiplier_base"],
    ["bull", "multiplier_bull"],
  ] as const) {
    const calculationId = detailed.evaluation.scenarios.find(
      ({ name }) => name === scenario,
    )?.calculationIds[0];
    const calculation = detailed.calculations.find(
      ({ id }) => id === calculationId,
    );
    assert.deepEqual(
      calculation?.inputRefs.find(({ itemId }) => itemId === assumptionId),
      { itemId: assumptionId, value: calculation?.inputRefs.find(
        ({ itemId }) => itemId === assumptionId,
      )?.value, type: "assumption" },
    );
    assert.ok(!calculation?.inputRefs.some(
      ({ itemId, type }) =>
        itemId.startsWith("policy:scenarioPriceMultipliers")
        || type === "fact" && itemId === assumptionId,
    ));
    assert.ok(calculation?.inputRefs.some(
      ({ itemId, type }) =>
        itemId === "benchmark_stale_after" && type === "benchmark",
    ));
  }
});

test("persists exit proceeds and exact direct return calculation dependencies", () => {
  const pack = evidencePack();
  pack.facts = pack.facts.map((fact) =>
    fact.field === "reported_valuation"
      ? { ...fact, value: "18000000" }
      : fact.field === "reported_valuation_basis"
        ? { ...fact, value: "pre_money" }
        : fact
  );
  const detailed = createValuationEngine({
    now: () => new Date("2026-07-29T12:00:00.000Z"),
  }).evaluateDetailed({
    pack,
    context: context(),
    fundPolicy: policy(),
  });
  const scope = "calculation:valuation:pack_1";
  const ids = {
    exitEquity:
      `${scope}:venture_return_method_v1:exit_equity_value`,
    postDilution:
      `${scope}:future_dilution_v1:post_dilution_ownership`,
    exitProceeds:
      `${scope}:gross_deal_moic_v1:exit_proceeds`,
    grossMoic:
      `${scope}:gross_deal_moic_v1:gross_moic`,
    grossIrr:
      `${scope}:annualized_gross_irr_v1:gross_irr`,
  };
  const calculation = (id: string) => {
    const match = detailed.calculations.find((item) => item.id === id);
    assert.ok(match, `${id} must be persisted`);
    return match;
  };
  const dependencies = (id: string) =>
    detailed.calculationClaimEdges
      .filter(({ claimItemId }) => claimItemId === id)
      .map(({ dependencyItemId }) => dependencyItemId)
      .sort();

  assert.equal(calculation(ids.exitProceeds).output, "5000000");
  assert.deepEqual(calculation(ids.exitProceeds).inputRefs, []);
  assert.deepEqual(dependencies(ids.exitProceeds), [
    ids.postDilution,
    ids.exitEquity,
  ].sort());
  assert.deepEqual(calculation(ids.grossMoic).inputRefs, [{
    itemId: "policy:initialCheckMax",
    value: "2000000",
    type: "policy",
  }]);
  assert.equal(calculation(ids.grossMoic).output, "2.5");
  assert.deepEqual(dependencies(ids.grossMoic), [ids.exitProceeds]);
  assert.deepEqual(calculation(ids.grossIrr).inputRefs, [{
    itemId: "policy:returnTargets.seed.horizonYears",
    value: "8",
    type: "policy",
  }]);
  assert.deepEqual(dependencies(ids.grossIrr), [ids.grossMoic]);
});

function evidencePack(
  overrides: Partial<EvidencePack> = {},
): EvidencePack {
  return {
    id: "pack_1",
    version: 1,
    workspaceId: "workspace_1",
    dealId: "deal_1",
    asOfDate: "2026-07-29",
    sourceRevisionIds: ["revision_1"],
    facts: [
      {
        id: "fact_current_ask",
        analysisType: "fact",
        provenanceOrigin: "management",
        field: "reported_valuation",
        value: "25000000",
        unit: "currency",
        currency: "USD",
        periodStart: null,
        periodEnd: null,
        publishedAt: null,
        eventAt: null,
        retrievedAt: "2026-07-29T10:00:00.000Z",
        sourceRevisionId: "revision_1",
        locator: {
          kind: "text_range",
          start: 0,
          end: 10,
          excerpt: "$25m valuation",
        },
        sourceRole: "management",
        assertionStatus: "reported",
        verificationMethod: null,
        freshness: "current",
        acceptedForGate: true,
      },
      {
        id: "fact_valuation_basis",
        analysisType: "fact",
        provenanceOrigin: "management",
        field: "reported_valuation_basis",
        value: "reported_unspecified",
        unit: null,
        currency: null,
        periodStart: null,
        periodEnd: null,
        publishedAt: null,
        eventAt: null,
        retrievedAt: "2026-07-29T10:00:00.000Z",
        sourceRevisionId: "revision_1",
        locator: {
          kind: "text_range",
          start: 0,
          end: 10,
          excerpt: "$25m valuation",
        },
        sourceRole: "management",
        assertionStatus: "reported",
        verificationMethod: null,
        freshness: "current",
        acceptedForGate: true,
      },
      {
        id: "fact_growth",
        analysisType: "fact",
        provenanceOrigin: "uploaded_document",
        field: "growth",
        value: "0.8",
        unit: "decimal",
        currency: null,
        periodStart: "2025-01-01",
        periodEnd: "2025-12-31",
        publishedAt: null,
        eventAt: null,
        retrievedAt: "2026-07-29T10:00:00.000Z",
        sourceRevisionId: "revision_1",
        locator: {
          kind: "text_range",
          start: 10,
          end: 20,
          excerpt: "80% growth",
        },
        sourceRole: "management",
        assertionStatus: "reported",
        verificationMethod: null,
        freshness: "current",
        acceptedForGate: true,
      },
    ],
    assumptions: [
      assumption(
        "benchmark_seed",
        "all",
        "compatible_benchmark_value",
        "20000000",
      ),
      assumption(
        "benchmark_stale_after",
        "all",
        "compatible_benchmark_stale_after",
        "2026-12-31",
      ),
      assumption(
        "multiplier_bear",
        "bear",
        "scenario_price_multiplier",
        "0.75",
      ),
      assumption(
        "multiplier_base",
        "base",
        "scenario_price_multiplier",
        "1",
      ),
      assumption(
        "multiplier_bull",
        "bull",
        "scenario_price_multiplier",
        "1.25",
      ),
      assumption("exit_arr_base", "base", "arr_path", "20000000"),
      assumption("exit_multiple_base", "base", "exit_multiple", "5"),
    ],
    conflicts: [],
    coverage: {
      minimumModelInputsComplete: false,
      criticalEvidenceComplete: false,
      missingFieldIds: [],
      blockingConflictIds: [],
      decisionCeiling: "Advance",
      underwritingStatus: "available",
      reasonCodes: [],
    },
    createdAt: "2026-07-29T10:05:00.000Z",
    ...overrides,
  };
}

function assumption(
  id: string,
  scenario: "bear" | "base" | "bull" | "all",
  field: string,
  value: string,
): EvidencePack["assumptions"][number] {
  return {
    id,
    analysisType: "assumption",
    provenanceOrigin: field.startsWith("compatible_benchmark_")
      ? "benchmark"
      : "recommended_policy",
    scenario,
    field,
    value,
    unit: field === "compatible_benchmark_value" || field === "arr_path"
      ? "USD"
      : field === "compatible_benchmark_stale_after"
        ? "date"
        : field === "probability" || field === "scenario_price_multiplier"
          ? "decimal"
          : null,
    rationale: `Explicit ${field} input`,
    inputRefIds: field.startsWith("compatible_benchmark_")
      ? ["benchmark_pack_seed"]
      : [],
    sensitivity: "medium",
    requiresConfirmation: false,
  };
}

function context(): ResolvedUnderwritingContext {
  return {
    id: "context_seed_saas_us",
    contextVersion: "1",
    stage: "seed",
    businessModel: "b2b_saas",
    geography: "us",
    securityType: "preferred",
    asOfDate: "2026-07-29",
    criticalEvidenceProfileId: "critical_seed",
    benchmarkPackId: "benchmark_pack_seed",
    benchmarkCompatibility: "exact",
    valuationMethodPolicyId: "valuation_policy_1",
    decisionPolicyId: "decision_policy_1",
    frameworkPackId: "framework_pack_1",
  };
}

function policy(): FundPolicySnapshot {
  return {
    id: "policy_1",
    workspaceId: "workspace_1",
    version: 1,
    source: "recommended_policy",
    values: {
      baseCurrency: "USD",
      initialCheckMax: "2000000",
      acceptableFutureDilution: "0.5",
      scenarioPriceMultipliers: {
        bear: "0.75",
        base: "1",
        bull: "1.25",
      },
      returnTargets: {
        seed: {
          grossMoic: "5",
          grossIrr: "0.2228445449938519",
          horizonYears: "8",
        },
      },
      probabilityWeighted: false,
    },
    createdByUserId: null,
    createdAt: "2026-07-29T09:00:00.000Z",
  };
}

function weightedScenario(
  weights: readonly [string, string, string],
) {
  return buildScenarioModel({
    pack: evidencePack({
      assumptions: [
        ...evidencePack().assumptions.filter(
          (item) => item.field !== "probability",
        ),
        assumption("prob_bear", "bear", "probability", weights[0]),
        assumption("prob_base", "base", "probability", weights[1]),
        assumption("prob_bull", "bull", "probability", weights[2]),
      ],
    }),
    candidateRunId: `weighted_${weights.join("_")}`,
    formulaPolicyVersion: "1",
    probabilityWeighted: true,
  });
}
