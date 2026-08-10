import assert from "node:assert/strict";
import test from "node:test";

import {
  createBatchInputFingerprint,
  createCandidateAnalysisFingerprint,
  createReferenceCatalogSnapshot,
  type BatchFingerprintInput,
  type CandidateFingerprintInput,
} from "../../lib/underwriting/fingerprints";

function canonicalAction(
  kind: string,
  overrides: Partial<{
    scope: string;
    priority: string;
    visibility: string;
  }> = {},
) {
  return {
    kind,
    scope: "deal",
    priority: "standard",
    visibility: "internal_only",
    ...overrides,
  };
}

function batchInput(): BatchFingerprintInput {
  const analyses = [
    {
      dealId: "deal_b",
      dealStatus: "screening",
      beliefAssessment: {
        dealStatus: "screening",
        direction: "positive",
        actions: [canonicalAction("advance_diligence")],
      },
      investmentMemory: {
        memoryIds: ["memory_2", "memory_1"],
        sourceIds: ["source_2", "source_1"],
        fixtureIds: ["fixture_1"],
      },
      marketEvidence: {
        eventIds: ["event_b", "event_a"],
      },
      createdAt: "2026-07-29T00:00:00.000Z",
    },
    {
      dealId: "deal_a",
      dealStatus: "passed",
      beliefAssessment: {
        dealStatus: "passed",
        direction: "positive",
        actions: [canonicalAction("reopen_diligence")],
      },
      investmentMemory: {
        memoryIds: ["memory_3"],
        sourceIds: ["source_3"],
        fixtureIds: ["fixture_2"],
      },
      marketEvidence: {
        eventIds: ["event_c"],
      },
      createdAt: "2026-07-29T00:00:00.000Z",
    },
  ] as unknown as BatchFingerprintInput["analyses"];
  return {
    scanRun: {
      id: "00000000-0000-4000-8000-000000000001",
      workspaceId: "workspace_1",
      mode: "structured",
      windowDays: 14,
      status: "running",
      currentStage: "underwriting",
      warningCount: 0,
      warnings: [],
      workerId: "worker_1",
      createdAt: "2026-07-29T00:00:00.000Z",
      startedAt: "2026-07-29T00:00:01.000Z",
      completedAt: null,
      leaseExpiresAt: "2026-07-29T00:05:00.000Z",
      evidenceContext: { state: "legacy_unbound" },
    },
    report: {
      id: "report_1",
      workspaceId: "workspace_1",
      runId: "00000000-0000-4000-8000-000000000001",
      createdAt: "2026-07-29T00:00:00.000Z",
      marketSummary: "Immutable market report",
      opportunities: [],
      analysisStatus: "completed",
      evidenceCoverage: {
        acceptedPublicEvents: 3,
        excludedPublicItems: 0,
        truncatedPublicEvents: 0,
        recalledDealCount: 2,
        unavailableDealCount: 0,
      },
      counts: {
        companyCount: 2,
        beliefRevised: 2,
        monitor: 0,
        noMaterialChange: 0,
        analysisUnavailable: 0,
      },
      priorityDealId: "deal_b",
      companyAnalyses: analyses,
    },
    analyses,
    eligibleDeals: [
      {
        id: "deal_b",
        workspaceId: "workspace_1",
        companyId: "company_b",
        companyName: "Company B",
        status: "screening",
        analysisEligibleAt: "2026-07-01T00:00:00.000Z",
        activeSourceRevisionFingerprint: `sha256:${"2".repeat(64)}`,
        activeSourceRevisionIds: ["revision_2", "revision_1"],
      },
      {
        id: "deal_a",
        workspaceId: "workspace_1",
        companyId: "company_a",
        companyName: "Company A",
        status: "passed",
        analysisEligibleAt: "2026-07-01T00:00:00.000Z",
        activeSourceRevisionFingerprint: `sha256:${"3".repeat(64)}`,
        activeSourceRevisionIds: ["revision_3"],
      },
    ],
    policy: {
      id: "fund_policy_1",
      workspaceId: "workspace_1",
      version: 1,
      source: "recommended_policy",
      values: {},
      createdByUserId: null,
      createdAt: "2026-07-29T00:00:00.000Z",
    },
    executionBudget: {
      maxCostUnits: 28,
      maxTokenUnits: 112_000,
      maxConcurrency: 1,
      stages: {
        context_router: stagePolicy(1),
        evidence_pack: stagePolicy(2),
        valuation: stagePolicy(1),
        framework_catalog: stagePolicy(2),
        framework_lenses: stagePolicy(1),
        decision: stagePolicy(1),
        narrative_drafts: stagePolicy(1),
      },
    },
    candidateExecutionFingerprint: "candidate-executor-contract-v2",
    referenceCatalog: createReferenceCatalogSnapshot([
      reference("critical_evidence_profile", "critical_1", "1"),
      reference("benchmark_definition", "benchmark_entry_1", "2", {
        parentId: "benchmark_1",
      }),
      reference("valuation_method_policy", "valuation_policy_1", "3"),
      reference("framework_pack", "framework_pack_1", "4"),
      reference("decision_policy", "decision_policy_1", "5"),
    ]),
    evidenceFrame: {
      schemaVersion: "underwriting-evidence-frame-v1",
      evidenceMode: "pinned",
      contextFingerprint: `sha256:${"a".repeat(64)}`,
      eventSetFingerprint: `sha256:${"b".repeat(64)}`,
      bindingFingerprint: `sha256:${"c".repeat(64)}`,
      snapshotFingerprint: `sha256:${"d".repeat(64)}`,
    },
    selectionPolicyVersion: "top-five-belief-revised-v1",
    routerVersion: "router-v1",
    beliefPolicies: {
      actionPolicyVersion: "belief-action-policy-v1",
      draftPolicyVersion: "status-safe-action-draft-v2",
      semanticContextAssumptionPolicyVersion:
        "belief-reversal-demo-context-v1",
      semanticContextMappingVersion:
        "belief-reversal-reviewed-context-mapping-v1",
    },
    evidencePackBuilderVersion: "evidence_pack_builder_v2",
    decisionPolicyVersion: "1",
  };
}

function stagePolicy(maxAttempts: number) {
  return {
    timeoutMs: 30_000,
    maxAttempts,
    costUnits: 0,
    tokenUnits: 0,
  };
}

function candidateInput(): CandidateFingerprintInput {
  return {
    workspaceId: "workspace_1",
    batchInputFingerprint: createBatchInputFingerprint(batchInput()),
    dealRevision: {
      dealId: "deal_a",
      status: "passed",
      sourceRevisionIds: ["revision_3", "revision_1"],
      fingerprint: `sha256:${"8".repeat(64)}`,
    },
    beliefState: {
      dealStatus: "passed",
      direction: "positive",
      canonicalActions: [canonicalAction("reopen_diligence")],
      actionPolicyVersion: "belief-action-policy-v1",
      draftPolicyVersion: "status-safe-action-draft-v2",
      semanticContextAssumptionPolicyVersion:
        "belief-reversal-demo-context-v1",
      semanticContextMappingVersion:
        "belief-reversal-reviewed-context-mapping-v1",
    },
    evidencePack: {
      id: "evidence_pack_1",
      version: 1,
      sourceRevisionIds: ["revision_3", "revision_1"],
      fingerprint: `sha256:${"9".repeat(64)}`,
    },
    evidenceSourceIds: ["source_2", "source_1"],
    context: {
      id: "context_1",
      contextVersion: "1",
      criticalEvidenceProfileId: "critical_1",
      benchmarkPackId: "benchmark_1",
      valuationMethodPolicyId: "valuation_policy_1",
      frameworkPackId: "framework_pack_1",
      decisionPolicyId: "decision_policy_1",
      analysisMode: "full",
      geography: "us",
      securityType: "preferred",
      benchmarkCompatibility: "exact",
    },
    routerVersion: "context-router-v2",
    criticalEvidenceProfile:
      reference("critical_evidence_profile", "critical_1", "1"),
    benchmark: reference(
      "benchmark_definition",
      "benchmark_entry_1",
      "2",
      { parentId: "benchmark_1" },
    ),
    valuationMethodPolicy:
      reference("valuation_method_policy", "valuation_policy_1", "3"),
    frameworkPack: reference("framework_pack", "framework_pack_1", "4"),
    decisionPolicy: reference("decision_policy", "decision_policy_1", "5"),
    referenceCatalogFingerprint:
      batchInput().referenceCatalog.definitionFingerprint,
    frameworkCatalog: {
      version: "research-framework-catalog-v1",
      fingerprint: `sha256:${"b".repeat(64)}`,
      corpusDigest: `sha256:${"c".repeat(64)}`,
    },
    formulaVersions: [
      "venture_return_method_v1@1",
      "market_comps_v1@1",
    ],
    providerModel: "claude-sonnet-4-5",
    promptVersion: "underwriting-prompt-v1",
    schemaVersion: "underwriting-schema-v1",
    settingsFingerprint: `sha256:${"a".repeat(64)}`,
    applicationCommit: "0002f6b",
    namedLensVersions: {
      selectionPolicyVersion: "named-lens-selection-v1",
      passageSchemaVersion: "named-lens-passage-v1",
      generatorVersion: "named-lens-generator-v1",
      presentationSchemaVersion: "decision-first-named-lens-v1",
      decisionTaxonomyVersion: "named-lens-decision-taxonomy-v1",
    },
  };
}

test("batch fingerprint is canonical over unordered Deal and analysis inputs", () => {
  const left = batchInput();
  const right = batchInput();
  right.eligibleDeals.reverse();
  right.analyses = [...right.analyses].reverse();

  const fingerprint = createBatchInputFingerprint(left);
  assert.match(fingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.equal(createBatchInputFingerprint(right), fingerprint);
});

test("batch fingerprint changes for every required execution dimension", () => {
  const baseline = createBatchInputFingerprint(batchInput());
  const mutations: Array<(input: BatchFingerprintInput) => void> = [
    (input) => {
      input.scanRun.workspaceId = "workspace_2";
    },
    (input) => {
      input.scanRun.createdAt = "2026-07-28T00:00:00.000Z";
    },
    (input) => {
      input.report.marketSummary = "Revised immutable market report";
    },
    (input) => {
      input.eligibleDeals[0]!.activeSourceRevisionFingerprint =
        `sha256:${"c".repeat(64)}`;
    },
    (input) => {
      input.eligibleDeals[0]!.status = "passed";
    },
    (input) => {
      input.analyses[0]!.investmentMemory.sourceIds.push("source_3");
    },
    (input) => {
      input.analyses[0]!.marketEvidence.eventIds.push("event_c");
    },
    (input) => {
      input.analyses[0]!.createdAt = "2026-07-30T00:00:00.000Z";
    },
    (input) => {
      input.policy.version = 2;
    },
    (input) => {
      input.selectionPolicyVersion = "top-five-belief-revised-v2";
    },
    (input) => {
      input.executionBudget.maxCostUnits = 29;
    },
    (input) => {
      input.candidateExecutionFingerprint = "candidate-executor-contract-v3";
    },
    (input) => {
      input.routerVersion = "router-v2";
    },
    (input) => {
      input.evidencePackBuilderVersion = "evidence_pack_builder_v3";
    },
    (input) => {
      input.decisionPolicyVersion = "2";
    },
    (input) => {
      input.analyses[0]!.dealStatus = "passed";
    },
    (input) => {
      input.analyses[0]!.beliefAssessment!.direction = "negative";
    },
    (input) => {
      input.analyses[0]!.beliefAssessment!.actions = [
        {
          kind: "deprioritize",
          scope: "deal",
          priority: "standard",
          visibility: "internal_only",
        },
      ];
    },
    (input) => {
      input.beliefPolicies.actionPolicyVersion = "belief-action-policy-v2";
    },
    (input) => {
      input.beliefPolicies.draftPolicyVersion = "status-safe-action-draft-v3";
    },
    (input) => {
      input.beliefPolicies.semanticContextAssumptionPolicyVersion =
        "belief-reversal-demo-context-v2";
    },
    (input) => {
      input.beliefPolicies.semanticContextMappingVersion =
        "belief-reversal-reviewed-context-mapping-v2";
    },
  ];

  for (const mutate of mutations) {
    const input = batchInput();
    mutate(input);
    assert.notEqual(createBatchInputFingerprint(input), baseline);
  }
});

test("batch fingerprint binds every field of the exact evidence frame", () => {
  const baseline = createBatchInputFingerprint(batchInput());
  const mutations: Array<(input: BatchFingerprintInput) => void> = [
    (input) => {
      input.evidenceFrame!.evidenceMode = "live";
      input.evidenceFrame!.snapshotFingerprint = null;
    },
    (input) => {
      input.evidenceFrame!.contextFingerprint = `sha256:${"1".repeat(64)}`;
    },
    (input) => {
      input.evidenceFrame!.eventSetFingerprint = `sha256:${"2".repeat(64)}`;
    },
    (input) => {
      input.evidenceFrame!.bindingFingerprint = `sha256:${"3".repeat(64)}`;
    },
    (input) => {
      input.evidenceFrame!.snapshotFingerprint = `sha256:${"4".repeat(64)}`;
    },
  ];
  for (const mutate of mutations) {
    const input = batchInput();
    mutate(input);
    assert.notEqual(createBatchInputFingerprint(input), baseline);
  }
});

test("candidate fingerprint is canonical and binds all candidate-specific versions", () => {
  const baselineInput = candidateInput();
  const reordered = candidateInput();
  reordered.dealRevision.sourceRevisionIds.reverse();
  reordered.evidencePack.sourceRevisionIds.reverse();
  reordered.evidenceSourceIds.reverse();
  reordered.formulaVersions.reverse();

  const baseline = createCandidateAnalysisFingerprint(baselineInput);
  assert.match(baseline, /^sha256:[0-9a-f]{64}$/);
  assert.equal(createCandidateAnalysisFingerprint(reordered), baseline);

  const mutations: Array<(input: CandidateFingerprintInput) => void> = [
    (input) => {
      input.batchInputFingerprint = `sha256:${"b".repeat(64)}`;
    },
    (input) => {
      input.dealRevision.fingerprint = `sha256:${"c".repeat(64)}`;
    },
    (input) => {
      input.evidencePack.fingerprint = `sha256:${"d".repeat(64)}`;
    },
    (input) => {
      input.evidenceSourceIds.push("source_3");
    },
    (input) => {
      input.context.contextVersion = "2";
    },
    (input) => {
      input.criticalEvidenceProfile.version = "2";
    },
    (input) => {
      input.benchmark = null;
    },
    (input) => {
      input.valuationMethodPolicy.version = "2";
    },
    (input) => {
      input.formulaVersions.push("future_dilution_v1@2");
    },
    (input) => {
      input.providerModel = "claude-opus-4-1";
    },
    (input) => {
      input.promptVersion = "underwriting-prompt-v2";
    },
    (input) => {
      input.schemaVersion = "underwriting-schema-v2";
    },
    (input) => {
      input.settingsFingerprint = `sha256:${"e".repeat(64)}`;
    },
    (input) => {
      input.applicationCommit = "different";
    },
    (input) => {
      input.namedLensVersions.selectionPolicyVersion =
        "named-lens-selection-v2";
    },
    (input) => {
      input.namedLensVersions.passageSchemaVersion =
        "named-lens-passage-v2";
    },
    (input) => {
      input.namedLensVersions.generatorVersion = "named-lens-generator-v2";
    },
    (input) => {
      input.namedLensVersions.presentationSchemaVersion =
        "decision-first-named-lens-v2";
    },
    (input) => {
      input.namedLensVersions.decisionTaxonomyVersion =
        "named-lens-decision-taxonomy-v2";
    },
    (input) => {
      input.beliefState.dealStatus = "invested";
    },
    (input) => {
      input.beliefState.direction = "negative";
    },
    (input) => {
      input.beliefState.canonicalActions = [canonicalAction(
        "pause_follow_on",
        { scope: "portfolio", priority: "high" },
      )];
    },
    (input) => {
      input.beliefState.actionPolicyVersion = "belief-action-policy-v2";
    },
    (input) => {
      input.beliefState.draftPolicyVersion = "status-safe-action-draft-v3";
    },
    (input) => {
      input.beliefState.semanticContextAssumptionPolicyVersion =
        "belief-reversal-demo-context-v2";
    },
    (input) => {
      input.context.analysisMode = "core_only";
    },
    (input) => {
      input.context.geography = "unavailable";
    },
    (input) => {
      input.context.benchmarkCompatibility = "unavailable";
    },
    (input) => {
      input.routerVersion = "context-router-v3";
    },
  ];
  for (const mutate of mutations) {
    const input = candidateInput();
    mutate(input);
    assert.notEqual(createCandidateAnalysisFingerprint(input), baseline);
  }
});

test("batch and candidate fingerprints bind every effective reference definition digest", () => {
  const batch = batchInput();
  const changedBatch = structuredClone(batch);
  changedBatch.referenceCatalog =
    createReferenceCatalogSnapshot(changedBatch.referenceCatalog.definitions
      .map((definition, index) => index === 0
        ? {
            ...definition,
            definitionFingerprint: `sha256:${"f".repeat(64)}`,
          }
        : definition));
  assert.notEqual(
    createBatchInputFingerprint(batch),
    createBatchInputFingerprint(changedBatch),
  );

  const candidate = candidateInput();
  candidate.referenceCatalogFingerprint = `sha256:${"0".repeat(64)}`;
  candidate.criticalEvidenceProfile.definitionFingerprint =
    `sha256:${"1".repeat(64)}`;
  candidate.benchmark!.definitionFingerprint =
    `sha256:${"2".repeat(64)}`;
  candidate.valuationMethodPolicy.definitionFingerprint =
    `sha256:${"3".repeat(64)}`;
  candidate.frameworkPack =
    reference("framework_pack", "framework_pack_1", "4");
  candidate.decisionPolicy =
    reference("decision_policy", "decision_policy_1", "5");
  const baseline = createCandidateAnalysisFingerprint(candidate);
  for (
    const field of [
      "criticalEvidenceProfile",
      "benchmark",
      "valuationMethodPolicy",
      "frameworkPack",
      "decisionPolicy",
    ] as const
  ) {
    const changed = structuredClone(candidate);
    changed[field]!.definitionFingerprint = `sha256:${"f".repeat(64)}`;
    assert.notEqual(
      createCandidateAnalysisFingerprint(changed),
      baseline,
      `${field} digest must be identity-bearing`,
    );
  }
  const changedCatalog = structuredClone(candidate);
  changedCatalog.referenceCatalogFingerprint =
    `sha256:${"e".repeat(64)}`;
  assert.notEqual(
    createCandidateAnalysisFingerprint(changedCatalog),
    baseline,
  );
});

test("candidate fingerprints bind the selected research catalog and audited corpus", () => {
  const baseline = createCandidateAnalysisFingerprint(candidateInput());
  const changedVersion = candidateInput();
  changedVersion.frameworkCatalog!.version =
    "research-framework-catalog-v2";
  const changedCatalog = candidateInput();
  changedCatalog.frameworkCatalog!.fingerprint =
    `sha256:${"d".repeat(64)}`;
  const changedCorpus = candidateInput();
  changedCorpus.frameworkCatalog!.corpusDigest =
    `sha256:${"e".repeat(64)}`;

  assert.notEqual(
    createCandidateAnalysisFingerprint(changedVersion),
    baseline,
  );
  assert.notEqual(
    createCandidateAnalysisFingerprint(changedCatalog),
    baseline,
  );
  assert.notEqual(
    createCandidateAnalysisFingerprint(changedCorpus),
    baseline,
  );
});

function reference(
  kind:
    | "critical_evidence_profile"
    | "benchmark_definition"
    | "valuation_method_policy"
    | "decision_policy"
    | "framework_pack",
  id: string,
  digit: string,
  options: { parentId?: string } = {},
) {
  return {
    kind,
    id,
    version: "1",
    ...(options.parentId ? { parentId: options.parentId } : {}),
    definitionFingerprint: `sha256:${digit.repeat(64)}`,
  };
}
