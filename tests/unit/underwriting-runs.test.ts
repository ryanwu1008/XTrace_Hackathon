import assert from "node:assert/strict";
import test from "node:test";

import {
  createMemoryUnderwritingArtifactsRepository,
  createSupabaseUnderwritingArtifactsRepository,
  type CandidateArtifactBundle,
  type CandidateFinalization,
} from "../../db/repositories/underwriting-artifacts";
import {
  createMemoryUnderwritingCandidateLeaseAuthority,
  createMemoryUnderwritingRunsRepository,
  createSupabaseUnderwritingRunsRepository,
  statusForCandidateBatch,
} from "../../db/repositories/underwriting-runs";
import { createMemoryNamedLensArtifactsRepository } from
  "../../db/repositories/named-lens-artifacts";
import { createMemoryEvidencePacksRepository } from
  "../../db/repositories/evidence-packs";
import { ScenarioInputFieldSchema } from "../../lib/contracts/underwriting";
import { actionsForDealStatusAndDirection } from "../../lib/reports/action-policy";
import { createCanonicalFingerprint } from
  "../../lib/underwriting/fingerprints";
import { toCandidateUnderwritingDetail } from "../../lib/underwriting/read-model";
import { SYNTHETIC_FRAMEWORK_PACK } from "../../seed/underwriting/framework-pack-v1";
import {
  createCurrentNamedLensFinalizationFixture,
  withEmptyCurrentNamedLensArtifacts,
} from
  "../helpers/current-named-lens-finalization";

const sha = (digit: string) => `sha256:${digit.repeat(64)}`;

function frameworkCatalogCheckpointRow(
  finalization: CandidateFinalization,
  overrides: Record<string, unknown> = {},
) {
  const inputFingerprint = sha("a");
  const outputPayload = {
    catalogVersion: finalization.versionSnapshot.frameworkCatalogVersion,
    catalogFingerprint:
      finalization.versionSnapshot.frameworkCatalogFingerprint,
    corpusDigest: finalization.versionSnapshot.frameworkCorpusDigest,
  };
  return {
    candidate_run_id: finalization.candidateRunId,
    stage: "framework_catalog",
    status: "completed",
    input_fingerprint: inputFingerprint,
    output_fingerprint: createCanonicalFingerprint({
      stage: "framework_catalog",
      inputFingerprint,
      result: outputPayload,
    }),
    output_payload: outputPayload,
    attempt_count: 1,
    cost_units: 0,
    token_units: 0,
    actual_token_units: 0,
    provider_attempts: [],
    reason_code: null,
    public_reason: null,
    saved_at: "2026-08-10T11:30:00.000Z",
    ...overrides,
  };
}

function deterministicOptions() {
  let sequence = 0;
  return {
    now: () => new Date("2026-07-29T12:00:00.000Z"),
    idGenerator: (kind: "batch" | "candidate") =>
      `${kind}_${++sequence}`,
    leaseTokenGenerator: () => `lease_${++sequence}`,
  };
}

function statusSafeFinalization(): CandidateFinalization {
  const candidateRunId = "candidate_target";
  const missingEvidence = [{
    fieldId: "arr",
    label: "arr",
    externalLabel: "arr",
    reasonCode: "MISSING_CRITICAL_EVIDENCE",
    mostLikelyDecisionImpact:
      "Providing accepted evidence may raise or lower the formal decision ceiling.",
  }];
  const actions = actionsForDealStatusAndDirection("invested", "negative");
  const judgments: CandidateFinalization["judgments"] =
    SYNTHETIC_FRAMEWORK_PACK.cards.map((card, index) => {
      const id = `judgment_unavailable_${index + 1}`;
      return {
      id,
      analysisType: "framework_judgment",
      frameworkCardId: card.id,
      frameworkVersion: card.version,
      applicability: "unavailable",
      conclusion: "abstain",
      supportEvidenceItemIds: [],
      counterEvidenceItemIds: [],
      unusedEvidenceItemIds: [],
      strongestSupport: null,
      strongestCounterargument: null,
      unknowns: ["Geography is unavailable."],
      limitations: ["Core-only analysis cannot run this framework."],
      confidence: {
        sourceReliability: "low",
        evidenceStrength: "low",
        evidenceCoverage: "low",
        applicability: "low",
        judgment: "low",
      },
      claimEdges: [{
        claimItemId: id,
        dependencyItemId: card.id,
        dependencyType: "framework_ref",
      }],
      fingerprint: `unavailable-framework-${index + 1}`,
    };
    });
  const scenarioInputs = (scenario: "bear" | "base" | "bull") =>
    ScenarioInputFieldSchema.options.map((field) => ({
      id: `${scenario}_${field}`,
      scenario,
      field,
      value: null,
      unit: null,
      evidenceItemId: null,
      assumptionItemId: null,
      unavailableReason: `${field} is unavailable.`,
    }));
  return withEmptyCurrentNamedLensArtifacts({
    workerId: "worker_target",
    leaseToken: "lease_target",
    candidateRunId,
    candidateAnalysisFingerprint: `sha256:${"9".repeat(64)}`,
    evidencePackBuildInputFingerprint: `sha256:${"e".repeat(64)}`,
    evidencePack: {
      id: "pack_target",
      version: 1,
      workspaceId: "workspace_target",
      dealId: "deal_target",
      asOfDate: "2026-07-29",
      sourceRevisionIds: ["revision_target"],
      facts: [],
      assumptions: [],
      conflicts: [],
      coverage: {
        minimumModelInputsComplete: false,
        criticalEvidenceComplete: false,
        missingFieldIds: ["arr"],
        blockingConflictIds: [],
        decisionCeiling: null,
        underwritingStatus: "unavailable",
        reasonCodes: ["MISSING_MINIMUM_MODEL_INPUTS"],
      },
      createdAt: "2026-07-29T12:00:00.000Z",
    },
    context: {
      id: "context_target",
      contextVersion: "1",
      analysisMode: "core_only",
      stage: "series_a",
      businessModel: "enterprise_ai",
      geography: "unavailable",
      securityType: "preferred",
      asOfDate: "2026-07-29",
      criticalEvidenceProfileId:
        "critical_evidence_series_a_enterprise_ai_v1",
      benchmarkPackId: null,
      benchmarkCompatibility: "unavailable",
      valuationMethodPolicyId:
        "valuation_method_series_a_enterprise_ai_v1",
      decisionPolicyId: "decision_policy_series_a_enterprise_ai_v1",
      frameworkPackId:
        "framework_pack_synthetic_universal_saas_ai_v1",
    },
    scenarioModel: {
      id: "scenario_target",
      candidateRunId,
      formulaPolicyVersion:
        "valuation_method_series_a_enterprise_ai_v1",
      scenarios: (['bear', 'base', 'bull'] as const).map((name) => ({
        name,
        inputs: scenarioInputs(name),
      })),
      probabilityWeighted: false,
    },
    calculations: [],
    calculationClaimEdges: [],
    judgments,
    disagreements: [],
    valuation: {
      id: "valuation_target",
      status: "unavailable",
      scenarios: (['bear', 'base', 'bull'] as const).map((name) => ({
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
    decision: {
      id: "decision_target",
      analysisType: "final_synthesis",
      companyQuality: "unavailable",
      priceAttractiveness: "unavailable",
      fundFit: "unavailable",
      decision: null,
      decisionCeiling: null,
      hardVeto: false,
      firedRules: [],
      blockingEvidenceItemIds: [],
      claimEdges: [],
      confidence: "low",
    },
    narrative: "Formal values are unavailable.",
    actionDrafts: [{
      schemaVersion: "action-draft-v2",
      safety: "status_safe",
      deliveryMode: "draft_only",
      draftPolicyVersion: "status-safe-action-draft-v2",
      actionPolicyVersion: "belief-action-policy-v1",
      id: "draft_target",
      workspaceId: "workspace_target",
      candidateRunId,
      dealStatus: "invested",
      beliefDirection: "negative",
      actions,
      missingEvidence,
      format: "internal_memo",
      channel: "internal",
      audienceType: "internal",
      body: [
        "INTERNAL UNDERWRITING ACTION MEMO — DRAFT ONLY",
        "Formal values are unavailable.",
      ].join("\n"),
      createdAt: "2026-07-29T12:00:00.000Z",
      updatedAt: "2026-07-29T12:00:00.000Z",
    }],
    versionSnapshot: {
      fundPolicyId: "fund_policy_target",
      dealStatus: "invested",
      beliefDirection: "negative",
      canonicalActions: actions,
      actionPolicyVersion: "belief-action-policy-v1",
      draftPolicyVersion: "status-safe-action-draft-v2",
      semanticContextAssumptionPolicyVersion:
        "belief-reversal-demo-context-v1",
      semanticContextMappingVersion:
        "belief-reversal-reviewed-context-mapping-v1",
      analysisMode: "core_only",
      contextVersion: "1",
      geography: "unavailable",
      benchmarkCompatibility: "unavailable",
      benchmarkPackId: null,
      benchmarkEntryId: null,
      benchmarkDefinitionFingerprint: null,
      frameworkPackId:
        "framework_pack_synthetic_universal_saas_ai_v1",
      frameworkPackDefinitionFingerprint: `sha256:${"2".repeat(64)}`,
      routerVersion: "context-router-v2",
      criticalEvidenceProfileId:
        "critical_evidence_series_a_enterprise_ai_v1",
      criticalEvidenceProfileDefinitionFingerprint:
        `sha256:${"3".repeat(64)}`,
      valuationMethodPolicyId:
        "valuation_method_series_a_enterprise_ai_v1",
      valuationMethodPolicyDefinitionFingerprint:
        `sha256:${"4".repeat(64)}`,
      decisionPolicyId: "decision_policy_series_a_enterprise_ai_v1",
      decisionPolicyDefinitionFingerprint: `sha256:${"5".repeat(64)}`,
      referenceCatalogFingerprint: `sha256:${"6".repeat(64)}`,
      formulaVersions: [],
      providerModel: "synthetic-test",
      promptVersion: "framework-lens-v1",
      schemaVersion: "framework-judgment-v1",
      settingsFingerprint: `sha256:${"7".repeat(64)}`,
      applicationCommit: "task-9-test",
      companyAnalysisUnknowns: [],
    },
  });
}

test("public underwriting detail exposes only safe source actions from persisted Fact locators", () => {
  const finalization = statusSafeFinalization();
  const bundle: CandidateArtifactBundle = {
    ...finalization,
    workspaceId: "workspace_1",
    dealId: "deal_1",
    sourceCandidateRunId: finalization.candidateRunId,
    claimEdges: finalization.calculationClaimEdges,
  };
  const publicFact: CandidateFinalization["evidencePack"]["facts"][number] = {
    id: "fact_public_source",
    analysisType: "fact",
    provenanceOrigin: "public_source",
    field: "company_identity",
    value: "Source Link Co",
    unit: null,
    currency: null,
    periodStart: null,
    periodEnd: null,
    publishedAt: "2026-07-29T12:00:00.000Z",
    eventAt: null,
    retrievedAt: "2026-08-01T12:00:00.000Z",
    sourceRevisionId: "revision_public_source",
    locator: {
      kind: "web_snapshot",
      url: "https://public.example.test/source-link-co",
      excerpt: "Source Link Co published a material company update.",
    },
    sourceRole: "independent_third_party",
    assertionStatus: "reported",
    verificationMethod: null,
    freshness: "current",
    acceptedForGate: false,
  };
  bundle.evidencePack.facts = [
    publicFact,
    {
      ...publicFact,
      id: "fact_management_web",
      provenanceOrigin: "management",
      sourceRevisionId: "revision_management_web",
      sourceRole: "management",
    },
    {
      ...publicFact,
      id: "fact_uploaded_pdf",
      provenanceOrigin: "uploaded_document",
      sourceRevisionId: "revision_uploaded_pdf",
      locator: {
        kind: "pdf_page",
        page: 7,
        excerpt: "A private uploaded document excerpt.",
      },
      sourceRole: "management",
    },
    {
      ...publicFact,
      id: "fact_unsafe_public_url",
      sourceRevisionId: "revision_unsafe_public_url",
      locator: {
        kind: "web_snapshot",
        url: "javascript:alert(1)",
        excerpt: "An unsafe URL must not become an active source action.",
      },
    },
  ];
  bundle.evidencePack.sourceRevisionIds = [
    "revision_public_source",
    "revision_management_web",
    "revision_uploaded_pdf",
    "revision_unsafe_public_url",
  ];

  const detail = toCandidateUnderwritingDetail(bundle);

  assert.deepEqual(detail.evidencePack.facts[0]?.sourceAction, {
    kind: "original_public_source",
    url: "https://public.example.test/source-link-co",
  });
  assert.deepEqual(detail.evidencePack.facts[1]?.sourceAction, {
    kind: "stored_source_revision",
    page: null,
  });
  assert.deepEqual(detail.evidencePack.facts[2]?.sourceAction, {
    kind: "stored_source_revision",
    page: 7,
  });
  assert.deepEqual(detail.evidencePack.facts[3]?.sourceAction, {
    kind: "stored_source_revision",
    page: null,
  });
  assert.equal("locator" in detail.evidencePack.facts[0]!, false);
});

function forgedCoreOnlyUsFinalization(): CandidateFinalization {
  const value = structuredClone(statusSafeFinalization());
  value.context = {
    ...value.context,
    geography: "us",
    benchmarkPackId: "benchmark_pack_synthetic_us_software_v1",
    benchmarkCompatibility: "broad_compatible",
  };
  value.evidencePack.coverage = {
    minimumModelInputsComplete: true,
    criticalEvidenceComplete: true,
    missingFieldIds: [],
    blockingConflictIds: [],
    decisionCeiling: "Invest Candidate",
    underwritingStatus: "available",
    reasonCodes: ["CORE_ONLY_ANALYSIS_CEILING"],
  };
  if ("missingEvidence" in value.actionDrafts[0]!) {
    value.actionDrafts[0].missingEvidence = [];
  }
  value.decision = {
    ...value.decision,
    companyQuality: "pass",
    priceAttractiveness: "pass",
    fundFit: "pass",
    decision: "Invest Candidate",
    decisionCeiling: "Invest Candidate",
    confidence: "high",
  };
  value.versionSnapshot = {
    ...value.versionSnapshot,
    geography: "us",
    benchmarkCompatibility: "broad_compatible",
    benchmarkPackId: "benchmark_pack_synthetic_us_software_v1",
    benchmarkEntryId: "benchmark_entry_synthetic_seed_valuation_v1",
    benchmarkDefinitionFingerprint: `sha256:${"1".repeat(64)}`,
  };
  return value;
}

function forgedUnavailableGeographyDecision(): CandidateFinalization {
  const value = structuredClone(statusSafeFinalization());
  value.decision = {
    ...value.decision,
    companyQuality: "pass",
    priceAttractiveness: "pass",
    fundFit: "pass",
    decision: "Invest Candidate",
    decisionCeiling: "Invest Candidate",
    confidence: "high",
  };
  return value;
}

function forgedFullUnavailableDecision(): CandidateFinalization {
  const value = forgedUnavailableGeographyDecision();
  value.context = {
    ...value.context,
    analysisMode: "full",
    geography: "us",
    benchmarkPackId: "benchmark_pack_synthetic_us_software_v1",
    benchmarkCompatibility: "broad_compatible",
  };
  value.versionSnapshot = {
    ...value.versionSnapshot,
    analysisMode: "full",
    geography: "us",
    benchmarkCompatibility: "broad_compatible",
    benchmarkPackId: "benchmark_pack_synthetic_us_software_v1",
    benchmarkEntryId: "benchmark_entry_synthetic_seed_valuation_v1",
    benchmarkDefinitionFingerprint: `sha256:${"1".repeat(64)}`,
  };
  return value;
}

function forgedFullUnavailableValuation(): CandidateFinalization {
  const value = structuredClone(statusSafeFinalization());
  value.context = {
    ...value.context,
    analysisMode: "full",
    geography: "us",
    benchmarkPackId: "benchmark_pack_synthetic_us_software_v1",
    benchmarkCompatibility: "broad_compatible",
  };
  value.versionSnapshot = {
    ...value.versionSnapshot,
    analysisMode: "full",
    geography: "us",
    benchmarkCompatibility: "broad_compatible",
    benchmarkPackId: "benchmark_pack_synthetic_us_software_v1",
    benchmarkEntryId: "benchmark_entry_synthetic_seed_valuation_v1",
    benchmarkDefinitionFingerprint: `sha256:${"1".repeat(64)}`,
  };
  value.valuation = {
    ...value.valuation,
    status: "completed",
    scenarios: value.valuation.scenarios.map((scenario) => ({
      ...scenario,
      valuation: "999999999",
    })),
    maximumAcceptablePreMoney: "999999999",
    initialOwnership: "0.1",
    postDilutionOwnership: "0.05",
    grossMoic: "10",
    grossIrr: "0.5",
    pricingPremium: "1",
  };
  return value;
}

function evidenceCompleteUnavailableGeographyFinalization(): CandidateFinalization {
  const value = structuredClone(statusSafeFinalization());
  value.evidencePack.coverage = {
    minimumModelInputsComplete: true,
    criticalEvidenceComplete: true,
    missingFieldIds: [],
    blockingConflictIds: [],
    decisionCeiling: "Advance",
    underwritingStatus: "available",
    reasonCodes: ["CORE_ONLY_ANALYSIS_CEILING"],
  };
  value.scenarioModel.probabilityWeighted = true;
  if ("missingEvidence" in value.actionDrafts[0]!) {
    value.actionDrafts[0].missingEvidence = [];
  }
  return value;
}

test("pure finalization authority rejects forged core-only and unavailable-geography terminal artifacts", () => {
  const artifacts = createMemoryUnderwritingArtifactsRepository();
  const candidate = {
    id: "candidate_target",
    workspaceId: "workspace_target",
    dealId: "deal_target",
    fundPolicySnapshotId: "fund_policy_target",
  };
  assert.doesNotThrow(() => artifacts.prepareFinalization({
    candidate,
    finalization: statusSafeFinalization(),
  }));
  assert.doesNotThrow(() => artifacts.prepareFinalization({
    candidate,
    finalization: evidenceCompleteUnavailableGeographyFinalization(),
  }));
  for (const forged of [
    forgedCoreOnlyUsFinalization(),
    forgedUnavailableGeographyDecision(),
    forgedFullUnavailableDecision(),
    forgedFullUnavailableValuation(),
    (() => {
      const value = structuredClone(statusSafeFinalization());
      value.context.asOfDate = "2026-07-28";
      return value;
    })(),
    (() => {
      const value = structuredClone(statusSafeFinalization());
      value.scenarioModel.formulaPolicyVersion = "forged-policy";
      return value;
    })(),
    (() => {
      const value = structuredClone(statusSafeFinalization());
      const scenarioInput = value.scenarioModel.scenarios[0]!.inputs[0]!;
      scenarioInput.value = "1";
      scenarioInput.assumptionItemId = "missing_assumption";
      scenarioInput.unavailableReason = null;
      return value;
    })(),
    (() => {
      const value = structuredClone(statusSafeFinalization());
      value.valuation.currentAsk = "1";
      return value;
    })(),
    (() => {
      const value = structuredClone(statusSafeFinalization());
      value.judgments.push({
        id: "judgment_forged",
        analysisType: "framework_judgment",
        frameworkCardId: "framework_card_synthetic_1_v1",
        frameworkVersion: "1",
        applicability: "applicable",
        conclusion: "supportive",
        supportEvidenceItemIds: [],
        counterEvidenceItemIds: [],
        unusedEvidenceItemIds: [],
        strongestSupport: "Forged provider-style support.",
        strongestCounterargument: null,
        unknowns: [],
        limitations: [],
        confidence: {
          sourceReliability: "high",
          evidenceStrength: "high",
          evidenceCoverage: "high",
          applicability: "high",
          judgment: "high",
        },
        claimEdges: [],
        fingerprint: "forged-framework-fingerprint",
      });
      return value;
    })(),
  ]) {
    assert.throws(() => artifacts.prepareFinalization({
      candidate,
      finalization: forged,
    }), /core-only|geography|terminal|unavailable|identity|lineage|framework|valuation|persisted evidence/i);
  }
});

test("same batch fingerprint reuses one batch and force refresh creates a linked rerun", async () => {
  const repository = createMemoryUnderwritingRunsRepository(
    deterministicOptions(),
  );
  const input = {
    workspaceId: "workspace_1",
    scanRunId: "scan_1",
    batchInputFingerprint: `sha256:${"1".repeat(64)}`,
    fundPolicySnapshotId: "fund_policy_1",
    forceRefresh: false,
    refreshNonce: null,
    rerunOfId: null,
  };

  const first = await repository.createOrReuseBatch(input);
  const reused = await repository.createOrReuseBatch({
    ...input,
    scanRunId: "scan_2",
  });
  const refreshed = await repository.createOrReuseBatch({
    ...input,
    scanRunId: "scan_3",
    forceRefresh: true,
    refreshNonce: "refresh_1",
    rerunOfId: first.id,
  });

  assert.equal(reused.id, first.id);
  assert.notEqual(refreshed.id, first.id);
  assert.equal(refreshed.rerunOfId, first.id);
  assert.equal(repository.inspect().batches.length, 2);
});

test("a correct-nonce refresh with a stale parent fingerprint and settled attempt cannot become an artifact alias", async () => {
  const now = () => new Date("2026-08-10T12:00:00.000Z");
  const candidateLeaseAuthority =
    createMemoryUnderwritingCandidateLeaseAuthority({ now });
  const namedLensArtifacts = createMemoryNamedLensArtifactsRepository({
    candidateLeaseAuthority,
  });
  const artifacts = createMemoryUnderwritingArtifactsRepository({
    namedLensArtifacts,
  });
  const evidencePacks = createMemoryEvidencePacksRepository();
  const ids = [
    "batch_parent",
    "candidate_parent",
    "batch_refresh",
    "candidate_refresh",
  ];
  const runs = createMemoryUnderwritingRunsRepository({
    now,
    idGenerator: () => ids.shift()!,
    leaseTokenGenerator: () => "lease_refresh",
    artifacts,
    namedLensArtifacts,
    candidateLeaseAuthority,
    evidencePacks,
  });
  const staleFingerprint = sha("a");
  const parentBatch = await runs.createOrReuseBatch({
    workspaceId: "workspace_refresh",
    scanRunId: "scan_parent",
    batchInputFingerprint: sha("b"),
    fundPolicySnapshotId: "fund_policy_refresh",
    forceRefresh: false,
    refreshNonce: null,
    rerunOfId: null,
  });
  await runs.saveSelections({
    batchId: parentBatch.id,
    selections: [{
      dealId: "deal_refresh",
      status: "selected",
      rank: 1,
      reason: "Original underwriting.",
    }],
  });
  const [parentCandidate] = await runs.createSelectedCandidates({
    batchId: parentBatch.id,
    dealIds: ["deal_refresh"],
  });
  assert.equal(parentCandidate?.id, "candidate_parent");
  candidateLeaseAuthority.saveCandidate({
    ...parentCandidate!,
    status: "completed",
    candidateAnalysisFingerprint: staleFingerprint,
    finalizedAt: "2026-08-10T11:55:00.000Z",
  });
  artifacts.commitPrepared({
    candidateRunId: "candidate_parent",
    sourceCandidateRunId: "candidate_parent",
    workspaceId: "workspace_refresh",
    dealId: "deal_refresh",
    candidateAnalysisFingerprint: staleFingerprint,
    terminalStatus: "completed",
    terminalReasonCodes: ["limited_framework_coverage"],
    calculations: [],
    judgments: [],
    disagreements: [],
    actionDrafts: [],
    claimEdges: [],
  } as unknown as CandidateArtifactBundle);

  const refreshBatch = await runs.createOrReuseBatch({
    workspaceId: "workspace_refresh",
    scanRunId: "scan_refresh",
    batchInputFingerprint: sha("b"),
    fundPolicySnapshotId: "fund_policy_refresh",
    forceRefresh: true,
    refreshNonce: "refresh_correct_1",
    rerunOfId: parentBatch.id,
  });
  await runs.saveSelections({
    batchId: refreshBatch.id,
    selections: [{
      dealId: "deal_refresh",
      status: "selected",
      rank: 1,
      reason: "Refresh underwriting.",
    }],
  });
  const [refreshCandidate] = await runs.createSelectedCandidates({
    batchId: refreshBatch.id,
    dealIds: ["deal_refresh"],
  });
  assert.equal(refreshCandidate?.id, "candidate_refresh");
  const claimed = await runs.claimCandidate({
    workspaceId: "workspace_refresh",
    candidateRunId: refreshCandidate!.id,
    workerId: "worker_refresh",
    leaseSeconds: 120,
  });
  assert.ok(claimed);
  const currentFixture = createCurrentNamedLensFinalizationFixture();
  const fixtureAttempt = currentFixture.persistedAttempts[0]!;
  const attempt = {
    ...fixtureAttempt,
    workspaceId: "workspace_refresh",
    artifactSourceCandidateRunId: refreshCandidate!.id,
  };
  namedLensArtifacts.recordAttemptEvent({
    ...attempt,
    status: "reserved",
    telemetry: null,
    failureReason: null,
  });
  namedLensArtifacts.recordAttemptEvent(attempt);
  const pack = {
    id: "pack_refresh",
    version: 1,
    workspaceId: "workspace_refresh",
    dealId: "deal_refresh",
    asOfDate: "2026-08-10",
    sourceRevisionIds: [],
    facts: [],
    assumptions: [],
    conflicts: [],
    coverage: {
      minimumModelInputsComplete: false,
      criticalEvidenceComplete: false,
      missingFieldIds: ["arr"],
      blockingConflictIds: [],
      decisionCeiling: null,
      underwritingStatus: "unavailable" as const,
      reasonCodes: ["MISSING_MINIMUM_MODEL_INPUTS"],
    },
    createdAt: "2026-08-10T12:00:00.000Z",
  };
  await evidencePacks.saveExact({
    pack,
    inputFingerprint: sha("e"),
    sourceRevisionSnapshots: [],
  });
  const catalogIdentity = {
    catalogVersion:
      currentFixture.finalization.versionSnapshot.frameworkCatalogVersion!,
    catalogFingerprint:
      currentFixture.finalization.versionSnapshot
        .frameworkCatalogFingerprint!,
    corpusDigest:
      currentFixture.finalization.versionSnapshot.frameworkCorpusDigest!,
  };
  const catalogInputFingerprint = sha("a");
  await runs.saveCheckpoint({
    workerId: "worker_refresh",
    leaseToken: claimed.leaseToken,
    candidateRunId: refreshCandidate!.id,
    stage: "framework_catalog",
    status: "completed",
    inputFingerprint: catalogInputFingerprint,
    outputFingerprint: createCanonicalFingerprint({
      stage: "framework_catalog",
      inputFingerprint: catalogInputFingerprint,
      result: catalogIdentity,
    }),
    outputPayload: catalogIdentity,
    attemptCount: 1,
    costUnits: 0,
    tokenUnits: 0,
    actualTokenUnits: 0,
    providerAttempts: [],
    reasonCode: null,
    publicReason: null,
    savedAt: "2026-08-10T12:00:00.000Z",
  });
  artifacts.prepareFinalization = () => {
    throw new Error("canonical refresh reached non-reuse finalization");
  };

  for (const refreshNonce of [undefined, null, "refresh_wrong"] as const) {
    await assert.rejects(runs.finalizeCandidate({
      workerId: "worker_refresh",
      leaseToken: claimed.leaseToken,
      candidateRunId: refreshCandidate!.id,
      candidateAnalysisFingerprint: staleFingerprint,
      evidencePackBuildInputFingerprint: sha("e"),
      evidencePack: pack,
      versionSnapshot: refreshNonce === undefined ? {} : { refreshNonce },
    } as unknown as CandidateFinalization), /refresh identity.*owning batch/i);
  }

  for (const [field, value] of [
    ["frameworkCatalogVersion", "research-framework-catalog-forged"],
    ["frameworkCatalogFingerprint", sha("c")],
    ["frameworkCorpusDigest", sha("d")],
  ] as const) {
    await assert.rejects(runs.finalizeCandidate({
      workerId: "worker_refresh",
      leaseToken: claimed.leaseToken,
      candidateRunId: refreshCandidate!.id,
      candidateAnalysisFingerprint: staleFingerprint,
      evidencePackBuildInputFingerprint: sha("e"),
      evidencePack: pack,
      versionSnapshot: {
        refreshNonce: "refresh_correct_1",
        frameworkCatalogVersion: catalogIdentity.catalogVersion,
        frameworkCatalogFingerprint: catalogIdentity.catalogFingerprint,
        frameworkCorpusDigest: catalogIdentity.corpusDigest,
        [field]: value,
      },
    } as unknown as CandidateFinalization), /Framework catalog identity.*completed checkpoint/i);
  }

  await assert.rejects(runs.finalizeCandidate({
    workerId: "worker_refresh",
    leaseToken: claimed.leaseToken,
    candidateRunId: refreshCandidate!.id,
    candidateAnalysisFingerprint: staleFingerprint,
    evidencePackBuildInputFingerprint: sha("e"),
    evidencePack: pack,
    versionSnapshot: {
      refreshNonce: "refresh_correct_1",
      frameworkCatalogVersion: catalogIdentity.catalogVersion,
      frameworkCatalogFingerprint: catalogIdentity.catalogFingerprint,
      frameworkCorpusDigest: catalogIdentity.corpusDigest,
    },
  } as unknown as CandidateFinalization), /canonical refresh reached/);

  const persistedRefresh = runs.inspect().candidates.find(({ id }) =>
    id === refreshCandidate!.id
  );
  assert.equal(persistedRefresh?.status, "running");
  assert.equal(persistedRefresh?.artifactSourceCandidateRunId, null);
  const settled = await namedLensArtifacts.listAttempts(
    "workspace_refresh",
    refreshCandidate!.id,
  );
  assert.equal(settled.length, 1);
  assert.equal(settled[0]?.artifactSourceCandidateRunId, refreshCandidate!.id);
});

test("a completed and a partial candidate leave the memory batch partial", () => {
  assert.equal(statusForCandidateBatch([
    { status: "completed" },
    { status: "partial" },
  ]), "partial");
  assert.equal(statusForCandidateBatch([
    { status: "partial" },
    { status: "partial" },
  ]), "partial");
});

test("batch idempotency is workspace scoped and refresh requires an explicit nonce and parent", async () => {
  const repository = createMemoryUnderwritingRunsRepository(
    deterministicOptions(),
  );
  const common = {
    scanRunId: "scan_1",
    batchInputFingerprint: `sha256:${"2".repeat(64)}`,
    fundPolicySnapshotId: "fund_policy_1",
    forceRefresh: false,
    refreshNonce: null,
    rerunOfId: null,
  };
  const left = await repository.createOrReuseBatch({
    ...common,
    workspaceId: "workspace_1",
  });
  const right = await repository.createOrReuseBatch({
    ...common,
    workspaceId: "workspace_2",
  });

  assert.notEqual(left.id, right.id);
  await assert.rejects(
    repository.createOrReuseBatch({
      ...common,
      workspaceId: "workspace_1",
      forceRefresh: true,
    }),
    /refresh nonce|rerun/i,
  );
});

test("all positive priority ranks remain selected and receive CandidateRuns", async () => {
  const repository = createMemoryUnderwritingRunsRepository(
    deterministicOptions(),
  );
  const batch = await repository.createOrReuseBatch({
    workspaceId: "workspace_1",
    scanRunId: "scan_1",
    batchInputFingerprint: `sha256:${"3".repeat(64)}`,
    fundPolicySnapshotId: "fund_policy_1",
    forceRefresh: false,
    refreshNonce: null,
    rerunOfId: null,
  });
  const dealIds = Array.from({ length: 7 }, (_, index) => `deal_${index + 1}`);
  await repository.saveSelections({
    batchId: batch.id,
    selections: dealIds.map((dealId, index) => ({
      dealId,
      status: "selected",
      rank: index + 1,
      reason: `Rank ${index + 1}`,
    })),
  });
  const candidates = await repository.createSelectedCandidates({
    batchId: batch.id,
    dealIds,
  });
  const snapshot = repository.inspect();

  assert.deepEqual(
    snapshot.selections.map(({ dealId, status, rank }) => ({
      dealId,
      status,
      rank,
    })),
    dealIds.map((dealId, index) => ({
      dealId,
      status: "selected",
      rank: index + 1,
    })),
  );
  assert.deepEqual(
    candidates.map((candidate) => candidate.dealId),
    dealIds,
  );
});

test("memory claim uses persisted priority before candidate creation order", async () => {
  const repository = createMemoryUnderwritingRunsRepository(
    deterministicOptions(),
  );
  const batch = await repository.createOrReuseBatch({
    workspaceId: "workspace_1",
    scanRunId: "scan_priority",
    batchInputFingerprint: `sha256:${"a".repeat(64)}`,
    fundPolicySnapshotId: "fund_policy_1",
    forceRefresh: false,
    refreshNonce: null,
    rerunOfId: null,
  });
  await repository.saveSelections({
    batchId: batch.id,
    selections: [
      {
        dealId: "deal_rank_2",
        status: "selected",
        rank: 2,
        reason: "Second priority",
      },
      {
        dealId: "deal_rank_1",
        status: "selected",
        rank: 1,
        reason: "First priority",
      },
    ],
  });
  await repository.createSelectedCandidates({
    batchId: batch.id,
    dealIds: ["deal_rank_2"],
  });
  await repository.createSelectedCandidates({
    batchId: batch.id,
    dealIds: ["deal_rank_1"],
  });

  const claimed = await repository.claimNextCandidate({
    workerId: "priority_worker",
    leaseSeconds: 60,
  });
  assert.equal(claimed?.candidate.dealId, "deal_rank_1");
});

test("claim returns a lease capability and checkpoints reject a foreign token", async () => {
  const repository = createMemoryUnderwritingRunsRepository(
    deterministicOptions(),
  );
  const batch = await repository.createOrReuseBatch({
    workspaceId: "workspace_1",
    scanRunId: "scan_1",
    batchInputFingerprint: `sha256:${"4".repeat(64)}`,
    fundPolicySnapshotId: "fund_policy_1",
    forceRefresh: false,
    refreshNonce: null,
    rerunOfId: null,
  });
  await repository.saveSelections({
    batchId: batch.id,
    selections: [{
      dealId: "deal_1",
      status: "selected",
      rank: 1,
      reason: "Top candidate",
    }],
  });
  await repository.createSelectedCandidates({
    batchId: batch.id,
    dealIds: ["deal_1"],
  });
  const claimed = await repository.claimNextCandidate({
    workerId: "worker_1",
    leaseSeconds: 60,
  });
  assert.ok(claimed);
  assert.equal(claimed.candidate.status, "running");
  assert.match(claimed.leaseToken, /^lease_/);

  const checkpoint = {
    candidateRunId: claimed.candidate.id,
    stage: "evidence_pack" as const,
    status: "completed" as const,
    inputFingerprint: `sha256:${"5".repeat(64)}`,
    outputFingerprint: `sha256:${"6".repeat(64)}`,
    outputPayload: { packId: "pack_1" },
    attemptCount: 1,
    costUnits: 0,
    tokenUnits: 0,
    actualTokenUnits: 0,
    providerAttempts: [],
    reasonCode: null,
    publicReason: null,
    savedAt: "2026-07-29T12:00:00.000Z",
  };
  await assert.rejects(
    repository.saveCheckpoint({
      ...checkpoint,
      workerId: "worker_1",
      leaseToken: "foreign",
    }),
    /lease/i,
  );
  await repository.saveCheckpoint({
    ...checkpoint,
    workerId: "worker_1",
    leaseToken: claimed.leaseToken,
  });
  assert.deepEqual(repository.inspect().checkpoints, [checkpoint]);
});

async function createNamedLensLeaseFixture() {
  let currentTime = new Date("2026-07-29T12:00:00.000Z");
  let leaseSequence = 0;
  const now = () => currentTime;
  const candidateLeaseAuthority =
    createMemoryUnderwritingCandidateLeaseAuthority({ now });
  const namedLensArtifacts = createMemoryNamedLensArtifactsRepository({
    candidateLeaseAuthority,
  });
  const repository = createMemoryUnderwritingRunsRepository({
    now,
    idGenerator: (kind) => `${kind}_named_lens`,
    leaseTokenGenerator: () => `lease_${++leaseSequence}`,
    candidateLeaseAuthority,
    namedLensArtifacts,
  });
  const batch = await repository.createOrReuseBatch({
    workspaceId: "workspace_named_lens",
    scanRunId: "scan_named_lens",
    batchInputFingerprint: sha("a"),
    fundPolicySnapshotId: "fund_policy_named_lens",
    forceRefresh: false,
    refreshNonce: null,
    rerunOfId: null,
  });
  await repository.saveSelections({
    batchId: batch.id,
    selections: [{
      dealId: "deal_named_lens",
      status: "selected",
      rank: 1,
      reason: "Named Lens lease authority fixture.",
    }],
  });
  const [candidate] = await repository.createSelectedCandidates({
    batchId: batch.id,
    dealIds: ["deal_named_lens"],
  });
  assert.ok(candidate);
  const claimed = await repository.claimCandidate({
    workspaceId: candidate.workspaceId,
    candidateRunId: candidate.id,
    workerId: "worker_1",
    leaseSeconds: 60,
  });
  assert.ok(claimed);
  return {
    candidateLeaseAuthority,
    namedLensArtifacts,
    repository,
    candidate: claimed.candidate,
    claimed,
    setNow(value: string) {
      currentTime = new Date(value);
    },
  };
}

function namedLensReservation(input: {
  candidateRunId: string;
  leaseToken: string;
}) {
  return {
    workspaceId: "workspace_named_lens",
    artifactSourceCandidateRunId: input.candidateRunId,
    judgmentOrCatalogCandidateId: "judgment_named_lens",
    logicalPassageId:
      "judgment_named_lens@named-lens-passage-v1@named-lens-generator-v1",
    attemptNumber: 1,
    attemptFingerprint: sha("b"),
    workerId: "worker_1",
    leaseToken: input.leaseToken,
  };
}

test("memory Named Lens reserve rejects nonexistent and mismatched Candidate lease authority", async () => {
  const fixture = await createNamedLensLeaseFixture();
  const valid = namedLensReservation({
    candidateRunId: fixture.candidate.id,
    leaseToken: fixture.claimed.leaseToken,
  });
  const invalidReservations = [
    { ...valid, artifactSourceCandidateRunId: "candidate_missing" },
    { ...valid, workspaceId: "workspace_foreign" },
    { ...valid, workerId: "worker_foreign" },
    { ...valid, leaseToken: "lease_foreign" },
  ];

  for (const reservation of invalidReservations) {
    await assert.rejects(
      fixture.namedLensArtifacts.reserveAttempt(reservation),
      /running canonical candidate lease/i,
    );
  }
  assert.equal(
    fixture.namedLensArtifacts.inspect().rawAttemptEvents.length,
    0,
  );
});

test("memory Named Lens settlement rejects an expired lease after another worker reclaims it", async () => {
  const fixture = await createNamedLensLeaseFixture();
  const reserved = namedLensReservation({
    candidateRunId: fixture.candidate.id,
    leaseToken: fixture.claimed.leaseToken,
  });
  await fixture.namedLensArtifacts.reserveAttempt(reserved);
  fixture.setNow("2026-07-29T12:01:01.000Z");
  const reclaimed = await fixture.repository.claimCandidate({
    workspaceId: fixture.candidate.workspaceId,
    candidateRunId: fixture.candidate.id,
    workerId: "worker_2",
    leaseSeconds: 60,
  });
  assert.ok(reclaimed);
  assert.notEqual(reclaimed.leaseToken, fixture.claimed.leaseToken);

  await assert.rejects(fixture.namedLensArtifacts.settleAttempt({
    ...reserved,
    status: "aborted",
    telemetry: null,
    failureReason: {
      code: "provider_error",
      detail: "The original worker lost its lease.",
      retryable: true,
    },
  }), /running canonical candidate lease/i);
  assert.equal(
    fixture.namedLensArtifacts.inspect().rawAttemptEvents.length,
    1,
  );
});

test("memory Named Lens writes reject noncanonical and terminal candidates", async () => {
  const noncanonical = await createNamedLensLeaseFixture();
  noncanonical.candidateLeaseAuthority.saveCandidate({
    ...noncanonical.candidate,
    artifactSourceCandidateRunId: "candidate_source",
  });
  await assert.rejects(
    noncanonical.namedLensArtifacts.reserveAttempt(namedLensReservation({
      candidateRunId: noncanonical.candidate.id,
      leaseToken: noncanonical.claimed.leaseToken,
    })),
    /running canonical candidate lease/i,
  );

  const terminal = await createNamedLensLeaseFixture();
  await terminal.repository.markCandidateFailed({
    candidateRunId: terminal.candidate.id,
    publicReason: "Terminal authority fixture.",
  });
  await assert.rejects(
    terminal.namedLensArtifacts.reserveAttempt(namedLensReservation({
      candidateRunId: terminal.candidate.id,
      leaseToken: terminal.claimed.leaseToken,
    })),
    /running canonical candidate lease/i,
  );
});

test("memory underwriting composition rejects split Named Lens ledgers", () => {
  const firstAuthority = createMemoryUnderwritingCandidateLeaseAuthority();
  const firstNamedLensArtifacts = createMemoryNamedLensArtifactsRepository({
    candidateLeaseAuthority: firstAuthority,
  });
  const underwritingArtifacts = createMemoryUnderwritingArtifactsRepository({
    namedLensArtifacts: firstNamedLensArtifacts,
  });
  const secondAuthority = createMemoryUnderwritingCandidateLeaseAuthority();
  const secondNamedLensArtifacts = createMemoryNamedLensArtifactsRepository({
    candidateLeaseAuthority: secondAuthority,
  });

  assert.throws(() => createMemoryUnderwritingRunsRepository({
    candidateLeaseAuthority: secondAuthority,
    namedLensArtifacts: secondNamedLensArtifacts,
    artifacts: underwritingArtifacts,
  }), /same|shared|named lens|artifact/i);
});

test("memory underwriting composition reuses the artifact repository Named Lens ledger", () => {
  const candidateLeaseAuthority =
    createMemoryUnderwritingCandidateLeaseAuthority();
  const namedLensArtifacts = createMemoryNamedLensArtifactsRepository({
    candidateLeaseAuthority,
  });
  const artifacts = createMemoryUnderwritingArtifactsRepository({
    namedLensArtifacts,
  });

  const repository = createMemoryUnderwritingRunsRepository({
    candidateLeaseAuthority,
    artifacts,
  });

  assert.equal(repository.namedLensArtifacts, namedLensArtifacts);
  assert.equal(artifacts.namedLensArtifacts, namedLensArtifacts);
});

test("memory Candidate lease authority rejects an invalid expiry", () => {
  const authority = createMemoryUnderwritingCandidateLeaseAuthority();

  assert.throws(() => authority.saveLease("candidate_invalid_expiry", {
    workerId: "worker_1",
    token: "lease_1",
    expiresAt: "not-a-timestamp",
  }), /expiry|timestamp|date/i);
});

test("completed checkpoints are readable by exact workspace and candidate", async () => {
  const repository = createMemoryUnderwritingRunsRepository(
    deterministicOptions(),
  );
  const batch = await repository.createOrReuseBatch({
    workspaceId: "workspace_1",
    scanRunId: "scan_1",
    batchInputFingerprint: `sha256:${"4".repeat(64)}`,
    fundPolicySnapshotId: "fund_policy_1",
    forceRefresh: false,
    refreshNonce: null,
    rerunOfId: null,
  });
  await repository.saveSelections({
    batchId: batch.id,
    selections: [{
      dealId: "deal_1",
      status: "selected",
      rank: 1,
      reason: "Top candidate",
    }],
  });
  const [candidate] = await repository.createSelectedCandidates({
    batchId: batch.id,
    dealIds: ["deal_1"],
  });
  assert.ok(candidate);
  const claimed = await repository.claimCandidate({
    workspaceId: "workspace_1",
    candidateRunId: candidate.id,
    workerId: "worker_1",
    leaseSeconds: 60,
  });
  assert.ok(claimed);
  const checkpoint = {
    candidateRunId: candidate.id,
    stage: "context_router" as const,
    status: "completed" as const,
    inputFingerprint: `sha256:${"5".repeat(64)}`,
    outputFingerprint: `sha256:${"6".repeat(64)}`,
    outputPayload: { contextId: "context_1" },
    attemptCount: 1,
    costUnits: 0,
    tokenUnits: 0,
    actualTokenUnits: 0,
    providerAttempts: [],
    reasonCode: null,
    publicReason: null,
    savedAt: "2026-07-29T12:00:00.000Z",
  };
  await repository.saveCheckpoint({
    ...checkpoint,
    workerId: "worker_1",
    leaseToken: claimed.leaseToken,
  });

  const readable = repository as typeof repository & {
    listCheckpoints(input: {
      workspaceId: string;
      candidateRunId: string;
    }): Promise<typeof checkpoint[]>;
  };
  assert.deepEqual(await readable.listCheckpoints({
    workspaceId: "workspace_1",
    candidateRunId: candidate.id,
  }), [checkpoint]);
  assert.deepEqual(await readable.listCheckpoints({
    workspaceId: "workspace_foreign",
    candidateRunId: candidate.id,
  }), []);
  await repository.saveCheckpoint({
    ...checkpoint,
    savedAt: "2026-07-29T12:00:01.000Z",
    workerId: "worker_1",
    leaseToken: claimed.leaseToken,
  });
  assert.equal(
    repository.inspect().checkpoints[0]?.savedAt,
    checkpoint.savedAt,
    "an idempotent completed write retains the original checkpoint",
  );
  await assert.rejects(
    repository.saveCheckpoint({
      ...checkpoint,
      outputPayload: { contextId: "mutated_context" },
      workerId: "worker_1",
      leaseToken: claimed.leaseToken,
    }),
    /immutable/i,
  );
  await assert.rejects(
    repository.saveCheckpoint({
      ...checkpoint,
      inputFingerprint: `sha256:${"7".repeat(64)}`,
      workerId: "worker_1",
      leaseToken: claimed.leaseToken,
    }),
    /input fingerprint changed/i,
  );
});

test("target-scoped claim never leases an older candidate or a candidate from another workspace", async () => {
  const repository = createMemoryUnderwritingRunsRepository(
    deterministicOptions(),
  );
  const createCandidate = async (
    workspaceId: string,
    dealId: string,
    fingerprintCharacter: string,
  ) => {
    const batch = await repository.createOrReuseBatch({
      workspaceId,
      scanRunId: `scan_${workspaceId}`,
      batchInputFingerprint:
        `sha256:${fingerprintCharacter.repeat(64)}`,
      fundPolicySnapshotId: `fund_policy_${workspaceId}`,
      forceRefresh: false,
      refreshNonce: null,
      rerunOfId: null,
    });
    await repository.saveSelections({
      batchId: batch.id,
      selections: [{
        dealId,
        status: "selected",
        rank: 1,
        reason: "Target-safe claim fixture",
      }],
    });
    const [candidate] = await repository.createSelectedCandidates({
      batchId: batch.id,
      dealIds: [dealId],
    });
    assert.ok(candidate);
    return candidate;
  };
  const older = await createCandidate("workspace_a", "deal_a", "a");
  const target = await createCandidate("workspace_b", "deal_b", "b");

  const mismatched = await repository.claimCandidate({
    workspaceId: "workspace_a",
    candidateRunId: target.id,
    workerId: "worker_1",
    leaseSeconds: 60,
  });
  assert.equal(mismatched, null);
  assert.deepEqual(
    repository.inspect().candidates.map(({ id, status }) => ({ id, status })),
    [
      { id: older.id, status: "queued" },
      { id: target.id, status: "queued" },
    ],
  );

  const claimed = await repository.claimCandidate({
    workspaceId: "workspace_b",
    candidateRunId: target.id,
    workerId: "worker_1",
    leaseSeconds: 60,
  });
  assert.equal(claimed?.candidate.id, target.id);
  assert.deepEqual(
    repository.inspect().candidates.map(({ id, status }) => ({ id, status })),
    [
      { id: older.id, status: "queued" },
      { id: target.id, status: "running" },
    ],
  );
});

test("Supabase adapters use controlled RPC writes and workspace-scoped artifact reuse reads", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes("/rpc/create_or_reuse_underwriting_batch")) {
      return Response.json({
        id: "batch_db",
        workspaceId: "workspace_1",
        scanRunId: "scan_1",
        status: "queued",
        batchInputFingerprint: `sha256:${"7".repeat(64)}`,
        fundPolicySnapshotId: "fund_policy_1",
        rerunOfId: null,
        createdAt: "2026-07-29T12:00:00.000Z",
      });
    }
    if (String(url).includes("/candidate_runs?")) {
      return Response.json([{
        id: "candidate_db",
        workspace_id: "workspace_1",
        deal_id: "deal_1",
        candidate_analysis_fingerprint: `sha256:${"8".repeat(64)}`,
      }]);
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  const runs = createSupabaseUnderwritingRunsRepository({
    url: "https://supabase.example",
    serviceRoleKey: "secret",
    fetchImpl,
  });
  const artifacts = createSupabaseUnderwritingArtifactsRepository({
    url: "https://supabase.example",
    serviceRoleKey: "secret",
    fetchImpl,
  });

  const batch = await runs.createOrReuseBatch({
    workspaceId: "workspace_1",
    scanRunId: "scan_1",
    batchInputFingerprint: `sha256:${"7".repeat(64)}`,
    fundPolicySnapshotId: "fund_policy_1",
    forceRefresh: false,
    refreshNonce: null,
    rerunOfId: null,
  });
  const reusable = await artifacts.findReusable({
    workspaceId: "workspace_1",
    candidateAnalysisFingerprint: `sha256:${"8".repeat(64)}`,
  });

  assert.equal(batch.id, "batch_db");
  assert.equal(reusable?.candidateRunId, "candidate_db");
  assert.match(requests[0].url, /rpc\/create_or_reuse_underwriting_batch$/);
  assert.deepEqual(JSON.parse(String(requests[0].init.body)), {
    p_payload: {
      workspaceId: "workspace_1",
      scanRunId: "scan_1",
      batchInputFingerprint: `sha256:${"7".repeat(64)}`,
      fundPolicySnapshotId: "fund_policy_1",
      forceRefresh: false,
      refreshNonce: null,
      rerunOfId: null,
    },
  });
  const reuseUrl = new URL(requests[1].url);
  assert.equal(reuseUrl.searchParams.get("workspace_id"), "eq.workspace_1");
  assert.equal(
    reuseUrl.searchParams.get("status"),
    "in.(completed,partial)",
  );
  assert.equal(
    reuseUrl.searchParams.get("artifact_source_candidate_run_id"),
    "is.null",
  );
  assert.equal(
    reuseUrl.searchParams.get("candidate_analysis_fingerprint"),
    `eq.sha256:${"8".repeat(64)}`,
  );
});

test("Supabase candidate writes fail closed before RPC for a legacy finalization payload", async () => {
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  const candidate = {
    id: "candidate_target",
    batchId: "batch_target",
    workspaceId: "workspace_target",
    dealId: "deal_target",
    status: "running",
    candidateAnalysisFingerprint: "pending:candidate_target",
    rerunOfId: null,
    createdAt: "2026-07-29T12:00:00.000Z",
    finalizedAt: null,
  };
  const runs = createSupabaseUnderwritingRunsRepository({
    url: "https://supabase.example",
    serviceRoleKey: "secret",
    fetchImpl: async (url, init = {}) => {
      const body = init.body === undefined
        ? null
        : JSON.parse(String(init.body));
      requests.push({
        url: String(url),
        method: init.method ?? "GET",
        body,
      });
      if (String(url).endsWith("/rpc/claim_underwriting_candidate")) {
        return Response.json({
          candidate,
          leaseToken: "lease_target",
          leaseExpiresAt: "2026-07-29T12:01:00.000Z",
        });
      }
      if (String(url).includes("/candidate_runs?")) {
        return Response.json([candidate]);
      }
      if (String(url).includes("/underwriting_batches?")) {
        return Response.json([{
          id: "batch_target",
          workspaceId: "workspace_target",
          scanRunId: "scan_target",
          status: "running",
          batchInputFingerprint: `sha256:${"8".repeat(64)}`,
          fundPolicySnapshotId: "fund_policy_target",
          rerunOfId: null,
          createdAt: "2026-07-29T11:00:00.000Z",
        }]);
      }
      if (
        String(url).endsWith(
          "/rpc/finalize_or_reuse_candidate_underwriting",
        )
      ) {
        return Response.json({
          ...candidate,
          status: "completed",
          candidateAnalysisFingerprint: `sha256:${"9".repeat(64)}`,
          finalizedAt: "2026-07-29T12:00:30.000Z",
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    },
  });

  const claimed = await runs.claimCandidate({
    workspaceId: "workspace_target",
    candidateRunId: "candidate_target",
    workerId: "worker_target",
    leaseSeconds: 60,
  });
  assert.equal(claimed?.candidate.id, "candidate_target");
  const finalization = statusSafeFinalization();
  delete finalization.versionSnapshot.namedLensSelectionPolicyVersion;
  delete finalization.versionSnapshot.namedLensPassageSchemaVersion;
  delete finalization.versionSnapshot.namedLensGeneratorVersion;
  delete finalization.versionSnapshot.underwritingPresentationSchemaVersion;
  delete finalization.versionSnapshot.decisionTaxonomyVersion;
  delete finalization.namedLensCatalogConsiderations;
  delete finalization.decisionCriticalEvidenceProjection;
  delete finalization.namedLensAttemptRefs;
  delete finalization.namedLensDispositions;
  delete finalization.namedLensPassages;
  delete finalization.underwritingPresentationReportId;
  delete finalization.namedLensPresentation;
  delete finalization.terminalStatus;
  delete finalization.terminalReasonCodes;
  await assert.rejects(
    runs.finalizeCandidate(finalization),
    /Current Named Lens identity fingerprints require the complete version set/i,
  );
  assert.deepEqual(
    requests.map(({ url, method }) => ({
      pathname: new URL(url).pathname,
      method,
    })),
    [
      {
        pathname:
          "/rest/v1/rpc/claim_underwriting_candidate",
        method: "POST",
      },
      { pathname: "/rest/v1/candidate_runs", method: "GET" },
      { pathname: "/rest/v1/underwriting_batches", method: "GET" },
    ],
  );
  assert.equal(
    requests.some(({ url }) =>
      url.endsWith("/rpc/finalize_or_reuse_candidate_underwriting")
    ),
    false,
  );
});

test("Supabase finalization rejects forged current authority before the finalize RPC", async () => {
  const base = statusSafeFinalization();
  const variants: CandidateFinalization[] = [
    forgedCoreOnlyUsFinalization(),
    forgedUnavailableGeographyDecision(),
    forgedFullUnavailableDecision(),
    forgedFullUnavailableValuation(),
    (() => {
      const value = structuredClone(base);
      value.valuation.currentAsk = "1";
      return value;
    })(),
    {
      ...structuredClone(base),
      actionDrafts: [{
        ...structuredClone(base.actionDrafts[0]!),
        body: "INTERNAL UNDERWRITING ACTION MEMO — DRAFT ONLY\nforged",
        beliefDirection: "mixed",
      } as never],
    },
    {
      ...structuredClone(base),
      versionSnapshot: {
        ...structuredClone(base.versionSnapshot),
        geography: "global",
      },
    },
    {
      ...structuredClone(base),
      versionSnapshot: {
        ...structuredClone(base.versionSnapshot),
        routerVersion: "context-router-v1",
      },
    },
    {
      ...structuredClone(base),
      versionSnapshot: {
        ...structuredClone(base.versionSnapshot),
        canonicalActions: actionsForDealStatusAndDirection(
          "invested",
          "mixed",
        ),
      },
    },
  ];
  for (const finalization of variants) {
    const requests: string[] = [];
    const runs = createSupabaseUnderwritingRunsRepository({
      url: "https://supabase.example",
      serviceRoleKey: "secret",
      fetchImpl: async (url) => {
        requests.push(String(url));
        if (String(url).includes("/candidate_runs?")) {
          return Response.json([{
            id: "candidate_target",
            batchId: "batch_target",
            workspaceId: "workspace_target",
            dealId: "deal_target",
            status: "running",
            candidateAnalysisFingerprint: "pending:candidate_target",
            rerunOfId: null,
            createdAt: "2026-07-29T12:00:00.000Z",
            finalizedAt: null,
          }]);
        }
        if (String(url).includes("/underwriting_batches?")) {
          return Response.json([{
            id: "batch_target",
            workspaceId: "workspace_target",
            scanRunId: "scan_target",
            status: "running",
            batchInputFingerprint: `sha256:${"8".repeat(64)}`,
            fundPolicySnapshotId: "fund_policy_target",
            rerunOfId: null,
            createdAt: "2026-07-29T11:00:00.000Z",
          }]);
        }
        if (String(url).includes("/candidate_checkpoints?")) {
          return Response.json([
            frameworkCatalogCheckpointRow(finalization),
          ]);
        }
        throw new Error(`Finalize RPC must not run for forged input: ${url}`);
      },
    });
    await assert.rejects(runs.finalizeCandidate(finalization));
    assert.equal(requests.some((url) =>
      url.endsWith("/rpc/finalize_or_reuse_candidate_underwriting")
    ), false);
  }
});

test("Supabase finalization rejects forged Framework catalog checkpoint fingerprints", async () => {
  const finalization = statusSafeFinalization();
  const candidate = {
    id: finalization.candidateRunId,
    batchId: "batch_target",
    workspaceId: finalization.evidencePack.workspaceId,
    dealId: finalization.evidencePack.dealId,
    status: "running",
    candidateAnalysisFingerprint: `pending:${finalization.candidateRunId}`,
    rerunOfId: null,
    createdAt: "2026-07-29T11:00:00.000Z",
    finalizedAt: null,
  };
  const checkpointOverrides = [
    { input_fingerprint: sha("c") },
    { output_fingerprint: sha("d") },
  ];
  for (const overrides of checkpointOverrides) {
    let finalizeRpcCalled = false;
    const runs = createSupabaseUnderwritingRunsRepository({
      url: "https://supabase.example",
      serviceRoleKey: "secret",
      fetchImpl: async (url) => {
        const parsed = new URL(String(url));
        if (parsed.pathname.endsWith("/candidate_runs")) {
          return Response.json([candidate]);
        }
        if (parsed.pathname.endsWith("/underwriting_batches")) {
          return Response.json([{
            id: candidate.batchId,
            workspaceId: candidate.workspaceId,
            scanRunId: "scan_target",
            status: "running",
            batchInputFingerprint: sha("8"),
            fundPolicySnapshotId:
              finalization.versionSnapshot.fundPolicyId,
            forceRefresh: false,
            refreshNonce: null,
            rerunOfId: null,
            createdAt: "2026-07-29T11:00:00.000Z",
          }]);
        }
        if (parsed.pathname.endsWith("/candidate_checkpoints")) {
          return Response.json([
            frameworkCatalogCheckpointRow(finalization, overrides),
          ]);
        }
        if (parsed.pathname.endsWith(
          "/rpc/finalize_or_reuse_candidate_underwriting",
        )) {
          finalizeRpcCalled = true;
        }
        throw new Error(`Unexpected URL ${url}`);
      },
    });

    await assert.rejects(
      runs.finalizeCandidate(finalization),
      /Framework catalog identity.*completed checkpoint/i,
    );
    assert.equal(finalizeRpcCalled, false);
  }
});

test("Supabase finalization fails closed on ambiguous or misaligned persisted identity", async () => {
  const candidate = {
    id: "candidate_target",
    batchId: "batch_target",
    workspaceId: "workspace_target",
    dealId: "deal_target",
    status: "running",
    candidateAnalysisFingerprint: "pending:candidate_target",
    rerunOfId: null,
    createdAt: "2026-07-29T12:00:00.000Z",
    finalizedAt: null,
  };
  const batch = {
    id: "batch_target",
    workspaceId: "workspace_target",
    scanRunId: "scan_target",
    status: "running",
    batchInputFingerprint: `sha256:${"8".repeat(64)}`,
    fundPolicySnapshotId: "fund_policy_target",
    rerunOfId: null,
    createdAt: "2026-07-29T11:00:00.000Z",
  };
  const cases = [
    { name: "candidate missing", candidateRows: [], batchRows: [batch] },
    {
      name: "candidate ambiguous",
      candidateRows: [candidate, candidate],
      batchRows: [batch],
    },
    {
      name: "candidate not running",
      candidateRows: [{ ...candidate, status: "completed" }],
      batchRows: [batch],
    },
    { name: "batch missing", candidateRows: [candidate], batchRows: [] },
    {
      name: "batch ambiguous",
      candidateRows: [candidate],
      batchRows: [batch, batch],
    },
    {
      name: "batch workspace mismatch",
      candidateRows: [candidate],
      batchRows: [{ ...batch, workspaceId: "workspace_foreign" }],
    },
    {
      name: "batch ID mismatch",
      candidateRows: [candidate],
      batchRows: [{ ...batch, id: "batch_foreign" }],
    },
  ];
  for (const testCase of cases) {
    const requests: string[] = [];
    const runs = createSupabaseUnderwritingRunsRepository({
      url: "https://supabase.example",
      serviceRoleKey: "secret",
      fetchImpl: async (url) => {
        requests.push(String(url));
        if (String(url).includes("/candidate_runs?")) {
          return Response.json(testCase.candidateRows);
        }
        if (String(url).includes("/underwriting_batches?")) {
          return Response.json(testCase.batchRows);
        }
        throw new Error(
          `Finalize RPC must not run for ${testCase.name}: ${url}`,
        );
      },
    });
    await assert.rejects(
      runs.finalizeCandidate(statusSafeFinalization()),
    );
    assert.equal(requests.some((url) =>
      url.endsWith("/rpc/finalize_or_reuse_candidate_underwriting")
    ), false, testCase.name);
  }
});

test("Supabase finalization rereads a partial canonical reuse instead of trusting an incomplete RPC response", async () => {
  const fixture = createCurrentNamedLensFinalizationFixture();
  const finalization = fixture.finalization;
  const sourceId = "candidate_source";
  const targetRunning = {
    id: finalization.candidateRunId,
    batch_id: "batch_current",
    workspace_id: finalization.evidencePack.workspaceId,
    deal_id: finalization.evidencePack.dealId,
    status: "running",
    candidate_analysis_fingerprint: "pending:candidate_current",
    artifact_source_candidate_run_id: null,
    unavailable_reason_codes: [],
    rerun_of_id: sourceId,
    created_at: "2026-08-10T12:00:00.000Z",
    finalized_at: null,
  };
  const reasons = ["named_lens_passage_attempts_exhausted"];
  const targetFinalized = {
    ...targetRunning,
    status: "partial",
    candidate_analysis_fingerprint:
      finalization.candidateAnalysisFingerprint,
    artifact_source_candidate_run_id: sourceId,
    unavailable_reason_codes: reasons,
    finalized_at: "2026-08-10T12:01:00.000Z",
  };
  const sourceFinalized = {
    ...targetFinalized,
    id: sourceId,
    batch_id: "batch_source",
    artifact_source_candidate_run_id: null,
    rerun_of_id: null,
  };
  const createRuns = (sourceOverride: Record<string, unknown> = {}) => {
    let finalized = false;
    return createSupabaseUnderwritingRunsRepository({
      url: "https://supabase.example",
      serviceRoleKey: "secret",
      namedLensArtifacts: {
        reserveAttempt: async () => {
          throw new Error("not used");
        },
        settleAttempt: async () => {
          throw new Error("not used");
        },
        listAttempts: async () => fixture.persistedAttempts,
      },
      fetchImpl: async (url, init = {}) => {
        const parsed = new URL(String(url));
        if (parsed.pathname.endsWith(
          "/rpc/finalize_or_reuse_candidate_underwriting",
        )) {
          finalized = true;
          return Response.json({ id: finalization.candidateRunId });
        }
        if (parsed.pathname.endsWith("/candidate_runs")) {
          if (!finalized) return Response.json([targetRunning]);
          return Response.json([
            parsed.searchParams.get("id") === `eq.${sourceId}`
              ? { ...sourceFinalized, ...sourceOverride }
              : targetFinalized,
          ]);
        }
        if (parsed.pathname.endsWith("/underwriting_batches")) {
          return Response.json([{
            id: "batch_current",
            workspace_id: finalization.evidencePack.workspaceId,
            scan_run_id: "scan_current",
            status: "running",
            batch_input_fingerprint: `sha256:${"8".repeat(64)}`,
            fund_policy_snapshot_id: finalization.versionSnapshot.fundPolicyId,
            rerun_of_id: null,
            created_at: "2026-08-10T11:00:00.000Z",
          }]);
        }
        if (parsed.pathname.endsWith("/candidate_checkpoints")) {
          return Response.json([
            frameworkCatalogCheckpointRow(finalization),
          ]);
        }
        throw new Error(`Unexpected URL ${url}; ${init.method ?? "GET"}`);
      },
    });
  };

  const result = await createRuns().finalizeCandidate(finalization);
  assert.equal(result.status, "partial");
  assert.equal(result.artifactSourceCandidateRunId, sourceId);
  assert.deepEqual(result.terminalReasonCodes, reasons);
  for (const sourceOverride of [{
    workspace_id: "workspace_foreign",
  }, {
    deal_id: "deal_foreign",
  }, {
    candidate_analysis_fingerprint: `sha256:${"f".repeat(64)}`,
  }]) {
    await assert.rejects(
      createRuns(sourceOverride).finalizeCandidate(finalization),
      /canonical source ownership|fingerprint|inherit/i,
    );
  }
});

test("Supabase finalization preserves completed limited-framework coverage reasons", async () => {
  const fixture = createCurrentNamedLensFinalizationFixture();
  const finalization = fixture.finalization;
  let finalized = false;
  const running = {
    id: finalization.candidateRunId,
    batch_id: "batch_current",
    workspace_id: finalization.evidencePack.workspaceId,
    deal_id: finalization.evidencePack.dealId,
    status: "running",
    candidate_analysis_fingerprint: "pending:candidate_current",
    artifact_source_candidate_run_id: null,
    unavailable_reason_codes: [],
    rerun_of_id: null,
    created_at: "2026-08-10T12:00:00.000Z",
    finalized_at: null,
  };
  const completed = {
    ...running,
    status: "completed",
    candidate_analysis_fingerprint:
      finalization.candidateAnalysisFingerprint,
    unavailable_reason_codes: ["limited_framework_coverage"],
    finalized_at: "2026-08-10T12:01:00.000Z",
  };
  const runs = createSupabaseUnderwritingRunsRepository({
    url: "https://supabase.example",
    serviceRoleKey: "secret",
    namedLensArtifacts: {
      reserveAttempt: async () => { throw new Error("not used"); },
      settleAttempt: async () => { throw new Error("not used"); },
      listAttempts: async () => fixture.persistedAttempts,
    },
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      if (parsed.pathname.endsWith(
        "/rpc/finalize_or_reuse_candidate_underwriting",
      )) {
        finalized = true;
        return Response.json({ id: finalization.candidateRunId });
      }
      if (parsed.pathname.endsWith("/candidate_runs")) {
        return Response.json([finalized ? completed : running]);
      }
      if (parsed.pathname.endsWith("/underwriting_batches")) {
        return Response.json([{
          id: "batch_current",
          workspace_id: finalization.evidencePack.workspaceId,
          scan_run_id: "scan_current",
          status: "running",
          batch_input_fingerprint: sha("8"),
          fund_policy_snapshot_id: finalization.versionSnapshot.fundPolicyId,
          force_refresh: false,
          refresh_nonce: null,
          rerun_of_id: null,
          created_at: "2026-08-10T11:00:00.000Z",
        }]);
      }
      if (parsed.pathname.endsWith("/candidate_checkpoints")) {
        return Response.json([
          frameworkCatalogCheckpointRow(finalization),
        ]);
      }
      throw new Error(`Unexpected URL ${url}`);
    },
  });

  const result = await runs.finalizeCandidate(finalization);
  assert.equal(result.status, "completed");
  assert.deepEqual(result.terminalReasonCodes,
    ["limited_framework_coverage"]);
});

test("Supabase checkpoint replay reads only the exact workspace candidate", async () => {
  let requestedUrl = "";
  const runs = createSupabaseUnderwritingRunsRepository({
    url: "https://supabase.example",
    serviceRoleKey: "secret",
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return Response.json([{
        candidate_run_id: "candidate_target",
        stage: "framework_lenses",
        status: "completed",
        input_fingerprint: `sha256:${"1".repeat(64)}`,
        output_fingerprint: `sha256:${"2".repeat(64)}`,
        output_payload: { judgments: [], disagreements: [] },
        attempt_count: 1,
        cost_units: 1,
        token_units: 4_000,
        actual_token_units: 17,
        provider_attempts: [{
          attemptFingerprint: `sha256:${"3".repeat(64)}`,
          status: "completed",
          reservedCostUnits: 1,
          reservedTokenUnits: 4_000,
          actualTokenUnits: 17,
        }],
        reason_code: null,
        public_reason: null,
        saved_at: "2026-07-29T12:00:00.000Z",
      }]);
    },
  });

  const checkpoints = await runs.listCheckpoints({
    workspaceId: "workspace_target",
    candidateRunId: "candidate_target",
  });

  assert.equal(checkpoints[0]?.actualTokenUnits, 17);
  const url = new URL(requestedUrl);
  assert.equal(url.pathname, "/rest/v1/candidate_checkpoints");
  assert.equal(
    url.searchParams.get("workspace_id"),
    "eq.workspace_target",
  );
  assert.equal(
    url.searchParams.get("candidate_run_id"),
    "eq.candidate_target",
  );
  assert.equal(url.searchParams.get("order"), "saved_at.asc,stage.asc");
});

test("Supabase underwriting read models scope every batch projection to one workspace", async () => {
  const requestedUrls: string[] = [];
  const runs = createSupabaseUnderwritingRunsRepository({
    url: "https://supabase.example",
    serviceRoleKey: "secret",
    fetchImpl: async (url) => {
      const requestedUrl = String(url);
      requestedUrls.push(requestedUrl);
      if (requestedUrl.includes("/underwriting_batches?")) {
        return Response.json([{
          id: "batch_target",
          workspace_id: "workspace_target",
          scan_run_id: "scan_target",
          status: "completed",
          batch_input_fingerprint: `sha256:${"a".repeat(64)}`,
          fund_policy_snapshot_id: "policy_target",
          rerun_of_id: null,
          created_at: "2026-07-29T12:00:00.000Z",
        }]);
      }
      if (requestedUrl.includes("/underwriting_selections?")) {
        return Response.json([{
          batch_id: "batch_target",
          deal_id: "deal_target",
          status: "selected",
          rank: 1,
          reason: "Top candidate",
        }]);
      }
      if (requestedUrl.includes("/candidate_runs?")) {
        return Response.json([{
          id: "candidate_target",
          batch_id: "batch_target",
          workspace_id: "workspace_target",
          deal_id: "deal_target",
          status: "completed",
          candidate_analysis_fingerprint: `sha256:${"b".repeat(64)}`,
          rerun_of_id: null,
          created_at: "2026-07-29T12:00:00.000Z",
          finalized_at: "2026-07-29T12:01:00.000Z",
        }]);
      }
      throw new Error(`Unexpected URL ${requestedUrl}`);
    },
  });

  assert.equal((await runs.getBatchByScanRunId({
    workspaceId: "workspace_target",
    scanRunId: "scan_target",
  }))?.id, "batch_target");
  assert.equal((await runs.listSelectionsForBatch({
    workspaceId: "workspace_target",
    batchId: "batch_target",
  }))[0]?.dealId, "deal_target");
  assert.equal((await runs.listCandidatesForBatch({
    workspaceId: "workspace_target",
    batchId: "batch_target",
  }))[0]?.id, "candidate_target");

  const [batchUrl, selectionUrl, candidateUrl] = requestedUrls.map(
    (value) => new URL(value),
  );
  assert.equal(
    batchUrl.searchParams.get("workspace_id"),
    "eq.workspace_target",
  );
  assert.equal(batchUrl.searchParams.get("scan_run_id"), "eq.scan_target");
  assert.equal(
    selectionUrl.searchParams.get("workspace_id"),
    "eq.workspace_target",
  );
  assert.equal(selectionUrl.searchParams.get("batch_id"), "eq.batch_target");
  assert.equal(
    candidateUrl.searchParams.get("workspace_id"),
    "eq.workspace_target",
  );
  assert.equal(candidateUrl.searchParams.get("batch_id"), "eq.batch_target");
});
