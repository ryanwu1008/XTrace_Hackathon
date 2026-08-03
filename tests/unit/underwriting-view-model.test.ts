import assert from "node:assert/strict";
import test from "node:test";

import {
  describeUploadState,
  financialCalculationLineage,
  lineageForClaim,
  orderUnderwritingSelections,
  versionRows,
} from "../../app/underwriting-view-model";
import {
  toProductSearchMessage,
} from "../../app/product-search-view-model";

test("underwriting selections retain every explicit state while ranking selected Deals first", () => {
  const ordered = orderUnderwritingSelections([
    {
      dealId: "deal_not_selected",
      underwritingStatus: "not_selected",
      rank: null,
      candidateRunId: null,
      decision: null,
    },
    {
      dealId: "deal_partial",
      underwritingStatus: "partial",
      rank: 2,
      candidateRunId: "candidate_partial",
      decision: "Watch",
    },
    {
      dealId: "deal_queued",
      underwritingStatus: "queued",
      rank: 1,
      candidateRunId: "candidate_queued",
      decision: null,
    },
  ]);

  assert.deepEqual(
    ordered.map(({ dealId, underwritingStatus }) => [
      dealId,
      underwritingStatus,
    ]),
    [
      ["deal_queued", "queued"],
      ["deal_partial", "partial"],
      ["deal_not_selected", "not_selected"],
    ],
  );
});

test("upload presentation distinguishes retryable memory failure from terminal extraction failure", () => {
  assert.deepEqual(describeUploadState({
    status: "confirmed",
    failure: "Memory ingestion failed. Retry is available.",
  }), {
    label: "Retryable memory failure",
    tone: "warning",
    description: "Memory ingestion failed. Retry is available.",
    retryable: true,
  });
  assert.deepEqual(describeUploadState({
    status: "failed",
    failure: "Document processing failed.",
  }), {
    label: "Terminal extraction failure",
    tone: "error",
    description: "Document processing failed.",
    retryable: false,
  });
});

test("upload presentation labels quarantined legacy image evidence as non-analysis-ready", () => {
  const notice =
    "Legacy image evidence is quarantined because its prior model summary "
    + "was not an exact quotation. Upload the image again before analysis.";
  assert.deepEqual(describeUploadState({
    status: "failed",
    failure: notice,
  }), {
    label: "Legacy image quarantined",
    tone: "warning",
    description: notice,
    retryable: false,
  });
});

test("ready image evidence discloses that no XTrace memory was created", () => {
  const stateInput = {
    status: "ready" as const,
    failure: null,
    memoryNotice:
      "Ready for underwriting from canonical image evidence. No XTrace memory was created because no exact quotation was available.",
  };
  assert.deepEqual(describeUploadState(stateInput), {
    label: "Ready · structured evidence only",
    tone: "warning",
    description: stateInput.memoryNotice,
    retryable: false,
  });
});

test("formal-claim lineage resolves the upstream calculation chain to exact source revisions", () => {
  const result = lineageForClaim({
    claimItemId: "decision_1",
    facts: [{
      id: "fact_1",
      sourceRevisionId: "revision_1",
    }],
    claimEdges: [
      {
        claimItemId: "decision_1",
        dependencyItemId: "judgment_1",
        dependencyType: "framework_judgment",
      },
      {
        claimItemId: "judgment_1",
        dependencyItemId: "calculation_1",
        dependencyType: "calculation",
      },
      {
        claimItemId: "calculation_1",
        dependencyItemId: "fact_1",
        dependencyType: "fact",
      },
    ],
  });

  assert.deepEqual(result, {
    dependencyItemIds: ["judgment_1", "calculation_1", "fact_1"],
    sourceRevisionIds: ["revision_1"],
  });
});

test("financial fields resolve only to their exact valuation calculation identities", () => {
  type FinancialField =
    | "maximumAcceptablePreMoney"
    | "initialOwnership"
    | "postDilutionOwnership"
    | "grossMoic"
    | "grossIrr";
  const calculations = [
    {
      id: "calculation:candidate_1:venture_return_method_v1:maximum_acceptable_pre_money",
      formulaId: "venture_return_method_v1",
      output: "24000000",
    },
    {
      id: "calculation:candidate_1:simple_pre_post_ownership_v1:initial_ownership",
      formulaId: "simple_pre_post_ownership_v1",
      output: "0.10",
    },
    {
      id: "calculation:candidate_1:future_dilution_v1:post_dilution_ownership",
      formulaId: "future_dilution_v1",
      output: "0.075",
    },
    {
      id: "calculation:candidate_1:gross_deal_moic_v1:gross_moic",
      formulaId: "gross_deal_moic_v1",
      output: "4",
    },
    {
      id: "calculation:candidate_1:annualized_gross_irr_v1:gross_irr",
      formulaId: "annualized_gross_irr_v1",
      output: "0.219",
    },
  ];
  const valuationCalculationIds = calculations.map(({ id }) => id);
  const cases: Array<[FinancialField, string, string]> = [
    [
      "maximumAcceptablePreMoney",
      "24000000",
      "calculation:candidate_1:venture_return_method_v1:maximum_acceptable_pre_money",
    ],
    [
      "initialOwnership",
      "0.10",
      "calculation:candidate_1:simple_pre_post_ownership_v1:initial_ownership",
    ],
    [
      "postDilutionOwnership",
      "0.075",
      "calculation:candidate_1:future_dilution_v1:post_dilution_ownership",
    ],
    [
      "grossMoic",
      "4",
      "calculation:candidate_1:gross_deal_moic_v1:gross_moic",
    ],
    [
      "grossIrr",
      "0.219",
      "calculation:candidate_1:annualized_gross_irr_v1:gross_irr",
    ],
  ];

  for (const [field, value, itemId] of cases) {
    assert.deepEqual(financialCalculationLineage({
      field,
      value,
      calculations,
      valuationCalculationIds,
    }), { kind: "Calculation", itemId });
  }
});

test("financial fields render unsupported when exact calculation identity is absent or ambiguous", () => {
  const exact = {
    id: "calculation:candidate_1:annualized_gross_irr_v1:gross_irr",
    formulaId: "annualized_gross_irr_v1",
    output: "0.219",
  };
  const base = {
    field: "grossIrr" as const,
    value: "0.219",
    calculations: [exact],
    valuationCalculationIds: [exact.id],
  };
  assert.equal(financialCalculationLineage({
    ...base,
    value: null,
  }), null);
  assert.equal(financialCalculationLineage({
    ...base,
    calculations: [{ ...exact, output: "0.220" }],
  }), null);
  assert.equal(financialCalculationLineage({
    ...base,
    valuationCalculationIds: [],
  }), null);
  assert.equal(financialCalculationLineage({
    ...base,
    calculations: [],
  }), null);
  assert.equal(financialCalculationLineage({
    ...base,
    calculations: [
      exact,
      {
        ...exact,
        id: "calculation:candidate_retry:annualized_gross_irr_v1:gross_irr",
      },
    ],
    valuationCalculationIds: [
      exact.id,
      "calculation:candidate_retry:annualized_gross_irr_v1:gross_irr",
    ],
  }), null);
});

test("version rows expose every persisted replay pin exactly", () => {
  const rows = versionRows({
    fundPolicyId: "policy_v3",
    benchmarkPackId: null,
    benchmarkEntryId: null,
    benchmarkDefinitionFingerprint: null,
    frameworkPackId: "framework_v1",
    frameworkPackDefinitionFingerprint: "sha256:framework",
    routerVersion: "router-v2",
    criticalEvidenceProfileId: "critical_v1",
    criticalEvidenceProfileDefinitionFingerprint: "sha256:critical",
    valuationMethodPolicyId: "valuation_v1",
    valuationMethodPolicyDefinitionFingerprint: "sha256:valuation",
    decisionPolicyId: "decision_v1",
    decisionPolicyDefinitionFingerprint: "sha256:decision",
    referenceCatalogFingerprint: "sha256:catalog",
    frameworkCatalogVersion: "framework-catalog-v7",
    frameworkCatalogFingerprint: "sha256:framework-catalog",
    frameworkCorpusDigest: "sha256:framework-corpus",
    formulaVersions: ["returns@1", "ownership@2"],
    providerModel: "claude-opus-4-8",
    promptVersion: "underwriting-v3",
    schemaVersion: "schema-v4",
    settingsFingerprint: "sha256:settings",
    applicationCommit: "commit-123",
  });

  assert.deepEqual(
    rows.map(({ label }) => label),
    [
      "Policy",
      "Benchmark",
      "Framework",
      "Underwriting reference catalog",
      "Framework catalog version",
      "Framework catalog fingerprint",
      "Framework corpus digest",
      "Router",
      "Critical Evidence",
      "Valuation Method",
      "Decision",
      "Formula",
      "Model",
      "Prompt",
      "Schema",
      "Settings",
      "Application commit",
    ],
  );
  assert.equal(
    rows.find(({ label }) => label === "Benchmark")?.value,
    "Unavailable — no compatible benchmark was pinned",
  );
  assert.equal(
    rows.find(({ label }) => label === "Framework")?.value,
    "framework_v1 · sha256:framework",
  );
  assert.equal(
    rows.find(({ label }) => label === "Decision")?.value,
    "decision_v1 · sha256:decision",
  );
  assert.equal(
    rows.find(({ label }) => label === "Framework catalog version")?.value,
    "framework-catalog-v7",
  );
  assert.equal(
    rows.find(({ label }) => label === "Framework catalog fingerprint")?.value,
    "sha256:framework-catalog",
  );
  assert.equal(
    rows.find(({ label }) => label === "Framework corpus digest")?.value,
    "sha256:framework-corpus",
  );
  assert.equal(
    rows.find(({ label }) => label === "Model")?.value,
    "claude-opus-4-8",
  );
  assert.equal(
    rows.find(({ label }) => label === "Prompt")?.value,
    "underwriting-v3",
  );
  assert.equal(
    rows.find(({ label }) => label === "Settings")?.value,
    "sha256:settings",
  );
  assert.equal(
    rows.find(({ label }) => label === "Application commit")?.value,
    "commit-123",
  );
});

test("product search presents only finalized artifact results with exact Source Revision citations", () => {
  const message = toProductSearchMessage([
    {
      itemId: "fact_1",
      candidateRunId: "candidate_1",
      dealId: "deal_1",
      analysisType: "fact",
      text: "arr: 2400000 USD",
      inputRefIds: [],
      sourceRevisionIds: ["revision_1"],
      claimEdges: [],
    },
    {
      itemId: "calculation_1",
      candidateRunId: "candidate_1",
      dealId: "deal_1",
      analysisType: "calculation",
      text: "venture_method: 19200000 money",
      inputRefIds: [],
      sourceRevisionIds: ["revision_1", "revision_2"],
      claimEdges: [{
        claimItemId: "calculation_1",
        dependencyItemId: "fact_1",
        dependencyType: "fact",
      }],
    },
  ]);

  assert.equal(
    message.text,
    "fact: arr: 2400000 USD\n\n"
      + "calculation: venture_method: 19200000 money",
  );
  assert.deepEqual(
    message.citations.map(({ id, sourceRevisionId, url }) => [
      id,
      sourceRevisionId,
      url,
    ]),
    [
      ["revision_1", "revision_1", "/api/source-revisions/revision_1/access"],
      ["revision_2", "revision_2", "/api/source-revisions/revision_2/access"],
    ],
  );
});

test("product search visibly cites assumption policy, benchmark, and untyped persisted references without fabricated URLs", () => {
  const message = toProductSearchMessage([
    {
      itemId: "assumption_1",
      candidateRunId: "candidate_1",
      dealId: "deal_1",
      analysisType: "assumption",
      text: "exit_multiple: 8. Pinned assumptions.",
      inputRefIds: [
        "policy_v3",
        "benchmark_pack_v2",
        "reference_record_9",
      ],
      sourceRevisionIds: [],
      claimEdges: [
        {
          claimItemId: "assumption_1",
          dependencyItemId: "policy_v3",
          dependencyType: "policy_ref",
        },
        {
          claimItemId: "assumption_1",
          dependencyItemId: "benchmark_pack_v2",
          dependencyType: "benchmark_ref",
        },
      ],
    },
  ]);

  assert.deepEqual(
    message.citations.map(({ id, provenance, title, url }) => ({
      id,
      provenance,
      title,
      url,
    })),
    [
      {
        id: "benchmark_pack_v2",
        provenance: "underwriting_reference",
        title: "Benchmark reference · benchmark_pack_v2",
        url: undefined,
      },
      {
        id: "policy_v3",
        provenance: "underwriting_reference",
        title: "Policy reference · policy_v3",
        url: undefined,
      },
      {
        id: "reference_record_9",
        provenance: "underwriting_reference",
        title: "Persisted reference · reference_record_9",
        url: undefined,
      },
    ],
  );
});
