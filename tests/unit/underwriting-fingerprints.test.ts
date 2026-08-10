import assert from "node:assert/strict";
import test from "node:test";

import {
  createBatchInputFingerprint,
  createCandidateAnalysisFingerprint,
  createReferenceCatalogSnapshot,
  type BatchFingerprintInput,
  type CandidateFingerprintInput,
} from "../../lib/underwriting/fingerprints";
import {
  createDecisionCriticalEvidenceProjectionFingerprint,
  createNamedLensSemanticFingerprints,
} from
  "../../lib/underwriting/named-lens-presentation";
import { createCurrentNamedLensFinalizationFixture } from
  "../helpers/current-named-lens-finalization";

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
        named_lens_presentation: stagePolicy(1),
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
    selectionPolicyVersion: "all-belief-revisions-v1",
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
      decisionTaxonomyDigest: `sha256:${"d".repeat(64)}`,
      criticalEvidenceProjectionFingerprint: `sha256:${"e".repeat(64)}`,
      finalDispositionsFingerprint: `sha256:${"f".repeat(64)}`,
      presentationFingerprint: `sha256:${"0".repeat(64)}`,
    },
    refreshNonce: null,
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
      input.namedLensVersions.decisionTaxonomyDigest =
        `sha256:${"1".repeat(64)}`;
    },
    (input) => {
      input.namedLensVersions.criticalEvidenceProjectionFingerprint =
        `sha256:${"2".repeat(64)}`;
    },
    (input) => {
      input.namedLensVersions.finalDispositionsFingerprint =
        `sha256:${"3".repeat(64)}`;
    },
    (input) => {
      input.namedLensVersions.presentationFingerprint =
        `sha256:${"4".repeat(64)}`;
    },
    (input) => {
      input.refreshNonce = "refresh_1";
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

test("Named Lens aggregate fingerprints ignore candidate-local ownership identities", () => {
  const finalization = createCurrentNamedLensFinalizationFixture().finalization;
  assert.ok(finalization.decisionCriticalEvidenceProjection);
  assert.ok(finalization.namedLensDispositions);
  assert.ok(finalization.namedLensPassages);
  assert.ok(finalization.namedLensPresentation);
  const firstPassage = finalization.namedLensPassages[0]!;
  const firstDisposition = finalization.namedLensDispositions[0]!;
  const secondJudgmentId = `${firstPassage.judgmentId}_second`;
  const secondPassage = {
    ...structuredClone(firstPassage),
    judgmentId: secondJudgmentId,
    frameworkCardId: `${firstPassage.frameworkCardId}_second`,
    premise: {
      ...firstPassage.premise,
      text: "A second distinct public framework tests pricing durability.",
    },
    fingerprint: `sha256:${"b".repeat(64)}`,
  };
  const secondDisposition = {
    ...structuredClone(firstDisposition),
    judgmentOrCatalogCandidateId: secondJudgmentId,
    judgmentId: secondJudgmentId,
    frameworkCardId: secondPassage.frameworkCardId,
    selectedPosition: 2,
    passageFingerprint: secondPassage.fingerprint,
    fingerprint: `sha256:${"c".repeat(64)}`,
  };
  const passages = [firstPassage, secondPassage];
  const dispositions = [firstDisposition, secondDisposition];
  const { fingerprint: _fingerprint, ...originalPresentation } =
    finalization.namedLensPresentation;
  const presentation = {
    ...originalPresentation,
    synthesis: {
      ...originalPresentation.synthesis,
      branch: "bounded_alignment" as const,
      judgmentIds: [firstPassage.judgmentId, secondJudgmentId],
    },
    segmentCitations: [
      ...originalPresentation.segmentCitations,
      {
        ...structuredClone(originalPresentation.segmentCitations[0]!),
        judgmentId: secondJudgmentId,
      },
    ],
    firstScreenProjectionRefs: {
      ...originalPresentation.firstScreenProjectionRefs,
      selectedJudgmentIds: [firstPassage.judgmentId, secondJudgmentId],
    },
  };
  const baseline = createNamedLensSemanticFingerprints({
    evidenceRefs: finalization.decisionCriticalEvidenceProjection.evidenceRefs,
    dispositions,
    passages,
    presentation,
  });
  const judgmentIds = new Map(
    passages.map(({ judgmentId }, index) => [
      judgmentId,
      `local_judgment_${passages.length - index}`,
    ]),
  );
  const changedPassages = passages.map((passage) => ({
    ...passage,
    workspaceId: "workspace_other",
    artifactSourceCandidateRunId: "candidate_other",
    judgmentId: judgmentIds.get(passage.judgmentId)!,
    fingerprint: `sha256:${"d".repeat(64)}`,
  })).reverse();
  const changedDispositions = dispositions.map(
    (disposition, index) => ({
      ...disposition,
      workspaceId: "workspace_other",
      artifactSourceCandidateRunId: "candidate_other",
      judgmentOrCatalogCandidateId: `catalog_candidate_${index + 1}`,
      judgmentId: disposition.judgmentId === null
        ? null
        : judgmentIds.get(disposition.judgmentId)!,
      decisionCriticalEvidenceProjectionId: "projection_other",
      decisionCriticalEvidenceProjectionFingerprint:
        `sha256:${"e".repeat(64)}`,
      passageFingerprint: disposition.passageFingerprint === null
        ? null
        : `sha256:${"f".repeat(64)}`,
      fingerprint: `sha256:${String(index + 1).repeat(64)}`,
    }),
  ).reverse();
  const changedPresentation = {
    ...presentation,
    workspaceId: "workspace_other",
    artifactSourceCandidateRunId: "candidate_other",
    synthesis: {
      ...presentation.synthesis,
      judgmentIds: presentation.synthesis.judgmentIds.map((id) =>
        judgmentIds.get(id)!
      ),
    },
    segmentCitations: presentation.segmentCitations.map((citation) => ({
      ...citation,
      judgmentId: judgmentIds.get(citation.judgmentId)!,
    })).reverse(),
    firstScreenProjectionRefs: {
      ...presentation.firstScreenProjectionRefs,
      decisionId: "decision_other",
      selectedJudgmentIds:
        presentation.firstScreenProjectionRefs.selectedJudgmentIds.map(
          (id) => judgmentIds.get(id)!,
        ),
    },
  };
  assert.deepEqual(
    createNamedLensSemanticFingerprints({
      evidenceRefs:
        finalization.decisionCriticalEvidenceProjection.evidenceRefs,
      dispositions: changedDispositions,
      passages: changedPassages,
      presentation: changedPresentation,
    }),
    baseline,
  );

  const semanticMutations = [
    () => ({
      evidenceRefs: finalization.decisionCriticalEvidenceProjection!
        .evidenceRefs.map((reference, index) => index === 0
          ? { ...reference, evidencePackItemId: "fact_semantically_changed" }
          : reference),
      dispositions,
      passages,
      presentation,
    }),
    () => ({
      evidenceRefs: finalization.decisionCriticalEvidenceProjection!
        .evidenceRefs.map((reference, index) => index === 0
          ? {
              ...reference,
              originRefs: reference.originRefs.map((origin, originIndex) =>
                originIndex === 0
                  ? { ...origin, id: "rule_semantically_changed" }
                  : origin
              ),
            }
          : reference),
      dispositions,
      passages,
      presentation,
    }),
    () => ({
      evidenceRefs:
        finalization.decisionCriticalEvidenceProjection!.evidenceRefs,
      dispositions: dispositions.map((disposition, index) => index === 0
        ? { ...disposition, stance: "negative" as const }
        : disposition),
      passages,
      presentation,
    }),
    () => ({
      evidenceRefs:
        finalization.decisionCriticalEvidenceProjection!.evidenceRefs,
      dispositions,
      passages: passages.map((passage, index) => index === 0
        ? {
            ...passage,
            caseApplication: {
              ...passage.caseApplication,
              text: "The company-specific application changed materially.",
            },
          }
        : passage),
      presentation,
    }),
  ];
  for (const mutate of semanticMutations) {
    assert.notDeepEqual(
      createNamedLensSemanticFingerprints(mutate()),
      baseline,
    );
  }
});

test("Named Lens semantic fingerprints ignore only candidate-local formal judgment IDs in projection paths", () => {
  const finalization = createCurrentNamedLensFinalizationFixture().finalization;
  const projection = finalization.decisionCriticalEvidenceProjection!;
  const dispositions = finalization.namedLensDispositions!;
  const passages = finalization.namedLensPassages!;
  const { fingerprint: _fingerprint, ...presentation } =
    finalization.namedLensPresentation!;
  const formalJudgments = finalization.judgments.filter(
    ({ frameworkMetadata }) => frameworkMetadata === undefined,
  );
  const firstFormal = structuredClone(formalJudgments[0]!);
  const secondFormal = structuredClone(formalJudgments[1]!);
  const baselineRefs = projection.evidenceRefs.map((reference, index) =>
    index === 0
      ? {
        ...reference,
        resolutionPath: [...reference.resolutionPath, firstFormal.id],
      }
      : reference
  );
  const changedFormal = {
    ...structuredClone(firstFormal),
    id: `${firstFormal.id}_other_candidate`,
    claimEdges: firstFormal.claimEdges.map((edge) => ({
      ...edge,
      claimItemId: `${firstFormal.id}_other_candidate`,
    })),
  };
  const changedRefs = baselineRefs.map((reference, index) => index === 0
    ? {
      ...reference,
      resolutionPath: reference.resolutionPath.map((part) =>
        part === firstFormal.id ? changedFormal.id : part
      ),
    }
    : reference);
  const withCriticalEvidence = (
    values: typeof dispositions,
    evidenceRefs: typeof baselineRefs,
  ) => values.map((disposition) => ({
    ...disposition,
    criticalEvidence: evidenceRefs,
  }));
  const baseline = createNamedLensSemanticFingerprints({
    evidenceRefs: baselineRefs,
    dispositions: withCriticalEvidence(dispositions, baselineRefs),
    passages,
    presentation,
    formalJudgments: [firstFormal],
  });
  const changedOwner = createNamedLensSemanticFingerprints({
    evidenceRefs: changedRefs,
    dispositions: withCriticalEvidence(dispositions, changedRefs),
    passages,
    presentation,
    formalJudgments: [changedFormal],
  });
  assert.deepEqual(changedOwner, baseline);
  assert.equal(
    createDecisionCriticalEvidenceProjectionFingerprint(
      baselineRefs,
      [firstFormal],
    ),
    createDecisionCriticalEvidenceProjectionFingerprint(
      changedRefs,
      [changedFormal],
    ),
  );

  const changedSemanticRefs = changedRefs.map((reference, index) =>
    index === 0
      ? {
        ...reference,
        resolutionPath: reference.resolutionPath.map((part) =>
          part === changedFormal.id ? secondFormal.id : part
        ),
      }
      : reference
  );
  assert.notEqual(
    createDecisionCriticalEvidenceProjectionFingerprint(
      baselineRefs,
      [firstFormal],
    ),
    createDecisionCriticalEvidenceProjectionFingerprint(
      changedSemanticRefs,
      [secondFormal],
    ),
  );
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
