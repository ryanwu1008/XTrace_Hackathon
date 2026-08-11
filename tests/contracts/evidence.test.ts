import assert from "node:assert/strict";
import test from "node:test";

import {
  AnalysisTypeSchema,
  AssumptionSchema,
  CalculationSchema,
  EvidenceConflictSchema,
  EvidenceLocatorSchema,
  EvidencePackSchema,
  FactSchema,
  MoneyValueSchema,
  MultipleValueSchema,
  ProvenanceOriginSchema,
  RateValueSchema,
  SourceRevisionSchema,
} from "../../lib/contracts/evidence";

function sourceRevisionFixture(): Record<string, unknown> {
  return {
    id: "revision_1",
    workspaceId: "workspace_1",
    sourceId: "source_1",
    revision: 1,
    contentHash: "sha256:abc",
    objectKey: "uploads/source_1.pdf",
    objectVersion: "version_1",
    contentType: "application/pdf",
    extractorId: "pdf-text",
    extractorVersion: "1.0.0",
    extractedAt: "2026-07-28T10:00:00.000Z",
    supersedesRevisionId: null,
    createdAt: "2026-07-28T10:00:01.000Z",
  };
}

function factFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "fact_arr",
    analysisType: "fact",
    provenanceOrigin: "uploaded_document",
    field: "arr",
    value: "2400000",
    unit: "currency",
    currency: "USD",
    periodStart: "2025-01-01",
    periodEnd: "2025-12-31",
    publishedAt: null,
    eventAt: "2025-12-31T23:59:59.000Z",
    retrievedAt: "2026-07-28T10:00:00.000Z",
    sourceRevisionId: "revision_1",
    locator: {
      kind: "pdf_page",
      page: 4,
      excerpt: "ARR reached $2.4 million.",
    },
    sourceRole: "management",
    assertionStatus: "reported",
    verificationMethod: null,
    freshness: "current",
    acceptedForGate: true,
    ...overrides,
  };
}

function assumptionFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "assumption_growth",
    analysisType: "assumption",
    provenanceOrigin: "recommended_policy",
    scenario: "base",
    field: "growth",
    value: "0.4",
    unit: "rate",
    rationale: "Base policy growth case.",
    inputRefIds: ["fact_arr"],
    sensitivity: "high",
    requiresConfirmation: false,
    ...overrides,
  };
}

function conflictFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "conflict_arr",
    field: "arr",
    leftFactId: "fact_arr",
    rightFactId: "fact_arr_alt",
    materialityRuleId: "arr_materiality_v1",
    material: true,
    status: "open",
    resolutionFactId: null,
    resolutionReason: null,
    ...overrides,
  };
}

function evidencePackFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "pack_1",
    version: 1,
    workspaceId: "workspace_1",
    dealId: "deal_1",
    asOfDate: "2026-07-28",
    sourceRevisionIds: ["revision_1"],
    facts: [
      factFixture(),
      factFixture({
        id: "fact_arr_alt",
        provenanceOrigin: "public_source",
        sourceRole: "independent_third_party",
      }),
    ],
    assumptions: [assumptionFixture()],
    conflicts: [conflictFixture()],
    coverage: {
      minimumModelInputsComplete: false,
      criticalEvidenceComplete: false,
      missingFieldIds: ["gross_margin"],
      blockingConflictIds: ["conflict_arr"],
      decisionCeiling: "Watch",
      underwritingStatus: "unavailable",
      reasonCodes: ["MATERIAL_CONFLICT"],
    },
    createdAt: "2026-07-28T10:01:00.000Z",
    ...overrides,
  };
}

test("keeps analysis type and provenance origin orthogonal", () => {
  assert.deepEqual(AnalysisTypeSchema.options, [
    "fact",
    "assumption",
    "calculation",
    "framework_judgment",
    "final_synthesis",
  ]);
  assert.deepEqual(ProvenanceOriginSchema.options, [
    "management",
    "uploaded_document",
    "public_source",
    "demo_fixture",
    "benchmark",
    "recommended_policy",
    "user_custom",
  ]);
  assert.throws(() => FactSchema.parse(factFixture({
    provenanceOrigin: "benchmark",
  })));
  assert.throws(() => AssumptionSchema.parse(assumptionFixture({
    provenanceOrigin: "uploaded_document",
  })));
});

test("a Sample decision Fact is permanently synthetic and never gate eligible", () => {
  const sample = factFixture({
    provenanceOrigin: "demo_fixture",
    field: "sample_decision_context",
    value: "Sample decision record. Synthetic context only.",
    unit: null,
    currency: null,
    periodStart: null,
    periodEnd: null,
    publishedAt: null,
    sourceRole: "management",
    assertionStatus: "reported",
    verificationMethod: "synthetic_sample_decision_record_v1",
    acceptedForGate: false,
  });
  assert.equal(FactSchema.parse(sample).provenanceOrigin, "demo_fixture");
  for (const invalid of [{
    ...sample,
    acceptedForGate: true,
  }, {
    ...sample,
    field: "public_claim",
  }, {
    ...sample,
    verificationMethod: null,
  }]) {
    assert.throws(() => FactSchema.parse(invalid), /synthetic|sample|gate/i);
  }
});

test("accepts every exact evidence locator shape, including an image without excerpt", () => {
  const locators = [
    { kind: "text_range", start: 0, end: 1, excerpt: "A" },
    { kind: "pdf_page", page: 1, excerpt: "A" },
    { kind: "image", imageIndex: 0, region: null },
    { kind: "image", imageIndex: 1, region: [0, 1.5, 20, 30] },
    { kind: "web_snapshot", url: "https://example.com/source", excerpt: "A" },
  ];

  for (const locator of locators) {
    assert.deepEqual(EvidenceLocatorSchema.parse(locator), locator);
  }
});

test("rejects invalid locator ranges, URLs, and extra persisted keys", () => {
  const invalid = [
    { kind: "text_range", start: 3, end: 3, excerpt: "A" },
    { kind: "text_range", start: -1, end: 3, excerpt: "A" },
    { kind: "pdf_page", page: 0, excerpt: "A" },
    { kind: "image", imageIndex: -1, region: null },
    { kind: "image", imageIndex: 0, region: [0, 1, 2] },
    { kind: "web_snapshot", url: "not-a-url", excerpt: "A" },
    { kind: "image", imageIndex: 0, region: null, excerpt: "invented" },
  ];

  for (const locator of invalid) {
    assert.throws(() => EvidenceLocatorSchema.parse(locator));
  }
});

test("requires immutable source revision lineage and valid source metadata", () => {
  assert.equal(SourceRevisionSchema.parse(sourceRevisionFixture()).revision, 1);
  assert.throws(() => SourceRevisionSchema.parse({
    ...sourceRevisionFixture(),
    mutableContent: true,
  }));
  assert.throws(() => SourceRevisionSchema.parse({
    ...sourceRevisionFixture(),
    revision: 0,
  }));
  assert.throws(() => SourceRevisionSchema.parse({
    ...sourceRevisionFixture(),
    extractedAt: "yesterday",
  }));
  assert.throws(() => SourceRevisionSchema.parse({
    ...sourceRevisionFixture(),
    workspaceId: "",
  }));
});

test("rejects a Fact without immutable source revision lineage or locator", () => {
  assert.throws(() => FactSchema.parse(factFixture({
    sourceRevisionId: null,
  })));
  const withoutLocator = factFixture();
  delete withoutLocator.locator;
  assert.throws(() => FactSchema.parse(withoutLocator));
});

test("validates Fact dates and period ordering without changing its exact shape", () => {
  assert.equal(FactSchema.parse(factFixture()).field, "arr");
  assert.throws(() => FactSchema.parse(factFixture({
    periodStart: "2025-13-01",
  })));
  assert.throws(() => FactSchema.parse(factFixture({
    periodStart: "2026-01-01",
    periodEnd: "2025-12-31",
  })));
  assert.throws(() => FactSchema.parse(factFixture({
    retrievedAt: "2026-07-28",
  })));
  assert.throws(() => FactSchema.parse(factFixture({
    inventedField: true,
  })));
});

test("round-trips exact Money, Rate, and Multiple persisted values", () => {
  const money = {
    amount: "001.2300",
    currency: "USD",
    scale: 4,
    asOfDate: "2026-07-28",
  };
  const rate = { value: "0.125", basis: "decimal" };
  const multiple = { value: "12.5", basis: "multiple" };

  assert.deepEqual(MoneyValueSchema.parse(money), money);
  assert.deepEqual(RateValueSchema.parse(rate), rate);
  assert.deepEqual(MultipleValueSchema.parse(multiple), multiple);
  assert.throws(() => MoneyValueSchema.parse({ ...money, amount: 1.23 }));
  assert.throws(() => MoneyValueSchema.parse({ ...money, currency: "EUR" }));
  assert.throws(() => RateValueSchema.parse({ value: "NaN", basis: "decimal" }));
  assert.throws(() => MultipleValueSchema.parse({
    value: "-1",
    basis: "multiple",
  }));
});

test("accepts exact Assumption and Calculation records and rejects schema drift", () => {
  assert.equal(AssumptionSchema.parse(assumptionFixture()).scenario, "base");
  assert.throws(() => AssumptionSchema.parse(assumptionFixture({
    analysisType: "fact",
  })));

  const calculation = {
    id: "calculation_1",
    analysisType: "calculation",
    formulaId: "market_comps_v1",
    formulaVersion: "1",
    inputRefs: [{
      itemId: "fact_arr",
      value: "2400000",
      type: "fact",
    }],
    output: "30000000",
    unit: "currency",
    currency: "USD",
    period: null,
    roundingPolicy: "half_even_display_only",
    computedAt: "2026-07-28T10:02:00.000Z",
    status: "completed",
  };
  assert.deepEqual(CalculationSchema.parse(calculation), calculation);
  assert.throws(() => CalculationSchema.parse({
    ...calculation,
    roundingPolicy: "half_up",
  }));
});

test("enforces conflict resolution consistency", () => {
  assert.deepEqual(
    EvidenceConflictSchema.parse(conflictFixture()),
    conflictFixture(),
  );
  assert.deepEqual(
    EvidenceConflictSchema.parse(conflictFixture({
      status: "resolved",
      resolutionFactId: "fact_arr",
      resolutionReason: "Board report is authoritative.",
    })),
    conflictFixture({
      status: "resolved",
      resolutionFactId: "fact_arr",
      resolutionReason: "Board report is authoritative.",
    }),
  );
  assert.deepEqual(
    EvidenceConflictSchema.parse(conflictFixture({
      material: false,
      status: "immaterial",
      resolutionReason: "Difference is below the materiality threshold.",
    })),
    conflictFixture({
      material: false,
      status: "immaterial",
      resolutionReason: "Difference is below the materiality threshold.",
    }),
  );
  assert.throws(() => EvidenceConflictSchema.parse(conflictFixture({
    status: "resolved",
    resolutionFactId: null,
    resolutionReason: null,
  })));
  assert.throws(() => EvidenceConflictSchema.parse(conflictFixture({
    status: "open",
    resolutionFactId: "fact_arr",
    resolutionReason: "Premature resolution.",
  })));
});

test("round-trips an EvidencePack whose references resolve", () => {
  const fixture = evidencePackFixture();
  assert.deepEqual(EvidencePackSchema.parse(fixture), fixture);
});

test("preserves external benchmark and policy references inside EvidencePacks", () => {
  const benchmarkAssumption = assumptionFixture({
    id: "assumption_benchmark_growth",
    provenanceOrigin: "benchmark",
    inputRefIds: ["benchmark_pack_1"],
  });
  const policyAssumption = assumptionFixture({
    id: "assumption_policy_growth",
    inputRefIds: ["fund_policy_snapshot_1"],
  });

  assert.deepEqual(
    AssumptionSchema.parse(benchmarkAssumption),
    benchmarkAssumption,
  );
  assert.deepEqual(AssumptionSchema.parse(policyAssumption), policyAssumption);

  const pack = evidencePackFixture({
    assumptions: [benchmarkAssumption, policyAssumption],
  });
  assert.deepEqual(EvidencePackSchema.parse(pack), pack);
});

test("rejects EvidencePack references outside its immutable contents", () => {
  const cases = [
    evidencePackFixture({ sourceRevisionIds: [] }),
    evidencePackFixture({
      conflicts: [conflictFixture({ rightFactId: "unknown_fact" })],
    }),
    evidencePackFixture({
      coverage: {
        minimumModelInputsComplete: false,
        criticalEvidenceComplete: false,
        missingFieldIds: [],
        blockingConflictIds: ["unknown_conflict"],
        decisionCeiling: "Watch",
        underwritingStatus: "unavailable",
        reasonCodes: ["MATERIAL_CONFLICT"],
      },
    }),
  ];

  for (const fixture of cases) {
    assert.throws(() => EvidencePackSchema.parse(fixture));
  }
});

test("requires unique source revisions, evidence item IDs, and conflict IDs", () => {
  const cases = [
    evidencePackFixture({
      sourceRevisionIds: ["revision_1", "revision_1"],
    }),
    evidencePackFixture({
      facts: [
        factFixture(),
        factFixture(),
        factFixture({
          id: "fact_arr_alt",
          provenanceOrigin: "public_source",
          sourceRole: "independent_third_party",
        }),
      ],
    }),
    evidencePackFixture({
      assumptions: [assumptionFixture(), assumptionFixture()],
    }),
    evidencePackFixture({
      assumptions: [assumptionFixture({ id: "fact_arr" })],
    }),
    evidencePackFixture({
      conflicts: [conflictFixture(), conflictFixture()],
    }),
  ];

  for (const fixture of cases) {
    assert.throws(() => EvidencePackSchema.parse(fixture));
  }
});

test("requires a conflict to compare distinct Facts with consistent materiality", () => {
  assert.throws(() => EvidenceConflictSchema.parse(conflictFixture({
    rightFactId: "fact_arr",
  })));
  assert.throws(() => EvidenceConflictSchema.parse(conflictFixture({
    material: false,
  })));
  assert.throws(() => EvidenceConflictSchema.parse(conflictFixture({
    material: true,
    status: "immaterial",
    resolutionReason: "Below the threshold.",
  })));
  assert.doesNotThrow(() => EvidenceConflictSchema.parse(conflictFixture({
    material: false,
    status: "immaterial",
    resolutionReason: "Below the threshold.",
  })));
});

test("requires every blocking conflict ID exactly once and only while material and open", () => {
  assert.doesNotThrow(() => EvidencePackSchema.parse(evidencePackFixture()));

  const cases = [
    evidencePackFixture({
      coverage: {
        ...(
          evidencePackFixture().coverage as Record<string, unknown>
        ),
        blockingConflictIds: ["conflict_arr", "conflict_arr"],
      },
    }),
    evidencePackFixture({
      conflicts: [conflictFixture({
        status: "resolved",
        resolutionFactId: "fact_arr",
        resolutionReason: "Board report is authoritative.",
      })],
    }),
    evidencePackFixture({
      conflicts: [conflictFixture({
        material: false,
        status: "immaterial",
        resolutionReason: "Below the threshold.",
      })],
    }),
  ];

  for (const fixture of cases) {
    assert.throws(() => EvidencePackSchema.parse(fixture));
  }
});
