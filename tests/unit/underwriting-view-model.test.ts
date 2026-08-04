import assert from "node:assert/strict";
import test from "node:test";

import {
  describeUploadState,
  financialCalculationLineage,
  lineageForClaim,
  orderUnderwritingQueue,
  versionRows,
} from "../../app/underwriting-view-model";
import {
  toProductSearchMessage,
} from "../../app/product-search-view-model";
import {
  adaptCurrentUnderwritingQueueEntries,
  adaptLegacyPinnedUnderwritingSelections,
} from "../../lib/underwriting/read-model";

test("underwriting queue priority orders every candidate without using rank as eligibility", () => {
  const ordered = orderUnderwritingQueue([
    {
      batchId: "batch_1",
      dealId: "deal_priority_six",
      priorityRank: 6,
      status: "completed",
      candidateRunId: "candidate_priority_six",
      decision: null,
    },
    {
      batchId: "batch_1",
      dealId: "deal_partial",
      priorityRank: 2,
      status: "partial",
      candidateRunId: "candidate_partial",
      reason: "A persisted stage completed only partially.",
      decision: "Watch",
    },
    {
      batchId: "batch_1",
      dealId: "deal_queued",
      priorityRank: 1,
      status: "queued",
      candidateRunId: "candidate_queued",
      decision: null,
    },
  ]);

  assert.deepEqual(
    ordered.map(({ dealId, status }) => [
      dealId,
      status,
    ]),
    [
      ["deal_queued", "queued"],
      ["deal_partial", "partial"],
      ["deal_priority_six", "completed"],
    ],
  );
});

test("current read adapter queues every persisted admitted candidate including priority six and hides non-candidates", () => {
  const selections = Array.from({ length: 7 }, (_, index) => ({
    batchId: "batch_current",
    dealId: `deal_${index + 1}`,
    status: index < 6 ? "selected" as const : "not_selected" as const,
    rank: index < 6 ? index + 1 : null,
    reason: index < 6
      ? `Admitted at priority ${index + 1}; priority does not affect eligibility.`
      : "The analysis outcome was monitor.",
  }));
  const candidates = [
    ["queued", null],
    ["running", null],
    ["completed", "2026-08-03T10:00:00.000Z"],
    ["partial", "2026-08-03T10:00:00.000Z"],
    ["failed", "2026-08-03T10:00:00.000Z"],
    ["unavailable", "2026-08-03T10:00:00.000Z"],
  ].map(([status, finalizedAt], index) => ({
    id: `candidate_${index + 1}`,
    batchId: "batch_current",
    workspaceId: "workspace_1",
    dealId: `deal_${index + 1}`,
    status: status as "queued" | "running" | "completed" | "partial" | "failed" | "unavailable",
    candidateAnalysisFingerprint: `sha256:candidate-${index + 1}`,
    rerunOfId: null,
    createdAt: "2026-08-03T09:00:00.000Z",
    finalizedAt,
  }));

  const entries = adaptCurrentUnderwritingQueueEntries({
    batchId: "batch_current",
    selections,
    candidates,
  });

  assert.equal(entries.length, 6);
  assert.deepEqual(
    entries.map(({ dealId, priorityRank, status }) => ({
      dealId,
      priorityRank,
      status,
    })),
    [
      { dealId: "deal_1", priorityRank: 1, status: "queued" },
      { dealId: "deal_2", priorityRank: 2, status: "running" },
      { dealId: "deal_3", priorityRank: 3, status: "completed" },
      { dealId: "deal_4", priorityRank: 4, status: "partial" },
      { dealId: "deal_5", priorityRank: 5, status: "failed" },
      { dealId: "deal_6", priorityRank: 6, status: "failed" },
    ],
  );
  assert.equal(entries.some(({ dealId }) => dealId === "deal_7"), false);
  assert.equal(entries.every(({ candidateRunId }) => candidateRunId !== null), true);
});

test("explicit pinned legacy adapter maps rank to read-only historical priority without mutating persisted identity", () => {
  const selections = Object.freeze([Object.freeze({
    batchId: "batch_pinned",
    dealId: "deal_historical_admitted",
    status: "selected" as const,
    rank: 3,
    reason: "Historical admitted row.",
  }), Object.freeze({
    batchId: "batch_pinned",
    dealId: "deal_historical_not_admitted",
    status: "not_selected" as const,
    rank: null,
    reason: "Historical non-admission.",
  })]);
  const before = structuredClone(selections);

  const adapted = adaptLegacyPinnedUnderwritingSelections({
    snapshotId: "belief_reversal_2026_08_01",
    selections,
  });

  assert.deepEqual(adapted, {
    adapter: "legacy-pinned-priority-order-v1",
    snapshotId: "belief_reversal_2026_08_01",
    entries: [{
      batchId: "batch_pinned",
      dealId: "deal_historical_admitted",
      historicalPriorityOrder: 3,
      historicalAdmissionStatus: "historically_admitted",
      historicalReason: "Historical admitted row.",
    }, {
      batchId: "batch_pinned",
      dealId: "deal_historical_not_admitted",
      historicalPriorityOrder: null,
      historicalAdmissionStatus: "historically_not_admitted",
      historicalReason: "Historical non-admission.",
    }],
  });
  assert.deepEqual(selections, before);
  assert.throws(() => adaptLegacyPinnedUnderwritingSelections({
    snapshotId: "current_live_run",
    selections,
  }), /pinned/i);
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
