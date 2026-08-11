import type { CandidateFinalization } from
  "../../db/repositories/underwriting-artifacts";
import { ScenarioInputFieldSchema } from "../../lib/contracts/underwriting";
import type {
  NamedLensCatalogConsideration,
  NamedLensFinalizationDisposition,
  NamedLensPassage,
  NamedLensPresentation,
  NamedLensProviderAttempt,
} from "../../lib/contracts/named-lens";
import { actionsForDealStatusAndDirection } from
  "../../lib/reports/action-policy";
import {
  authorizedResearchComposites,
  loadResearchFrameworkCatalog,
} from "../../lib/underwriting/frameworks/research-loader";
import { DECISION_TAXONOMY_DIGEST } from
  "../../lib/underwriting/frameworks/decision-taxonomy";
import {
  createDecisionCriticalEvidenceProjectionFingerprint,
  createNamedLensSemanticFingerprints,
} from
  "../../lib/underwriting/named-lens-presentation";
import { SYNTHETIC_FRAMEWORK_PACK } from
  "../../seed/underwriting/framework-pack-v1";

const sha = (digit: string) => `sha256:${digit.repeat(64)}`;
const workspaceId = "workspace_current";
const dealId = "deal_current";
const candidateRunId = "candidate_current";
const now = "2026-08-10T12:00:00.000Z";

const researchContext = {
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
  decisionPolicyId: "decision_policy_seed_b2b_saas_v1",
  frameworkPackId: SYNTHETIC_FRAMEWORK_PACK.id,
} as const;
const catalog = await loadResearchFrameworkCatalog({ context: researchContext });
const advisoryCard = (() => {
  const value = authorizedResearchComposites(catalog).find(
    ({ experimentalAdvisory }) =>
      experimentalAdvisory.components.some(({ sourceRefs }) =>
        sourceRefs.length > 0
      ),
  );
  if (!value) throw new Error("Expected one authorized advisory Card.");
  return value;
})();
const metadata = advisoryCard.experimentalAdvisory;
const component = (() => {
  const value = metadata.components.find(({ sourceRefs }) =>
    sourceRefs.length > 0
  );
  if (!value) throw new Error("Expected one grounded advisory component.");
  return value;
})();
const sourceRef = (() => {
  const value = component.sourceRefs[0];
  if (!value) throw new Error("Expected one grounded advisory source.");
  return value;
})();

function fact(id: "fact_1" | "counter_1", field: string) {
  return {
    id,
    analysisType: "fact" as const,
    provenanceOrigin: "public_source" as const,
    field,
    value: id === "fact_1" ? "supported" : "counter",
    unit: null,
    currency: null,
    periodStart: null,
    periodEnd: null,
    publishedAt: now,
    eventAt: null,
    retrievedAt: now,
    sourceRevisionId: `revision_${id}`,
    locator: {
      kind: "web_snapshot" as const,
      url: `https://example.test/${id}`,
      excerpt: `Persisted ${id} evidence.`,
    },
    sourceRole: "independent_third_party" as const,
    assertionStatus: "reported" as const,
    verificationMethod: null,
    freshness: "current" as const,
    acceptedForGate: true,
  };
}

export interface CurrentNamedLensFinalizationFixture {
  finalization: CandidateFinalization;
  persistedAttempts: NamedLensProviderAttempt[];
  rawAttemptEvents: NamedLensProviderAttempt[];
  dispositionRows: Array<Record<string, unknown>>;
  passageRows: Array<Record<string, unknown>>;
  segmentRows: Array<Record<string, unknown>>;
  projectionRows: Array<Record<string, unknown>>;
  presentationRows: Array<Record<string, unknown>>;
}

export function createCurrentNamedLensFinalizationFixture():
  CurrentNamedLensFinalizationFixture {
  const evidencePack = {
    id: "pack_current",
    version: 1,
    workspaceId,
    dealId,
    asOfDate: "2026-08-10",
    sourceRevisionIds: ["revision_counter_1", "revision_fact_1"],
    facts: [fact("counter_1", "customer_counterevidence"), fact(
      "fact_1",
      "customer_demand",
    )],
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
    createdAt: now,
  };
  const context = {
    id: "context_current",
    contextVersion: "1",
    analysisMode: "core_only" as const,
    stage: "series_a" as const,
    businessModel: "enterprise_ai" as const,
    geography: "unavailable" as const,
    securityType: "preferred" as const,
    asOfDate: "2026-08-10",
    criticalEvidenceProfileId: "critical_evidence_series_a_enterprise_ai_v1",
    benchmarkPackId: null,
    benchmarkCompatibility: "unavailable" as const,
    valuationMethodPolicyId: "valuation_method_series_a_enterprise_ai_v1",
    decisionPolicyId: "decision_policy_series_a_enterprise_ai_v1",
    frameworkPackId: SYNTHETIC_FRAMEWORK_PACK.id,
  };
  const formalJudgments: CandidateFinalization["judgments"] =
    SYNTHETIC_FRAMEWORK_PACK.cards.map((card, index) => {
      const id = `judgment_formal_${index + 1}`;
      return {
        id,
        analysisType: "framework_judgment",
        frameworkCardId: card.id,
        frameworkVersion: card.version,
        applicability: "unavailable",
        conclusion: "abstain",
        supportEvidenceItemIds: [],
        counterEvidenceItemIds: [],
        unusedEvidenceItemIds: ["counter_1", "fact_1"],
        strongestSupport: null,
        strongestCounterargument: null,
        unknowns: ["Geography is unavailable."],
        limitations: ["Core-only analysis cannot run this formal framework."],
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
        fingerprint: `formal-${index + 1}`,
      };
    });
  const advisoryJudgmentId = "judgment_advisory_1";
  const advisoryJudgment: CandidateFinalization["judgments"][number] = {
    id: advisoryJudgmentId,
    analysisType: "framework_judgment",
    frameworkCardId: advisoryCard.id,
    frameworkVersion: advisoryCard.version,
    applicability: "applicable",
    conclusion: "supportive",
    supportEvidenceItemIds: ["fact_1"],
    counterEvidenceItemIds: ["counter_1"],
    unusedEvidenceItemIds: [],
    strongestSupport: "Persisted customer demand support.",
    strongestCounterargument: "Persisted customer counterevidence.",
    unknowns: ["Unknown customer durability."],
    limitations: ["One customer signal remains bounded."],
    confidence: {
      sourceReliability: "high",
      evidenceStrength: "high",
      evidenceCoverage: "high",
      applicability: "high",
      judgment: "high",
    },
    claimEdges: [{
      claimItemId: advisoryJudgmentId,
      dependencyItemId: "fact_1",
      dependencyType: "fact",
    }, {
      claimItemId: advisoryJudgmentId,
      dependencyItemId: "counter_1",
      dependencyType: "fact",
    }, {
      claimItemId: advisoryJudgmentId,
      dependencyItemId: advisoryCard.id,
      dependencyType: "framework_ref",
    }],
    counterevidenceBoundary: {
      kind: "grounded_counterevidence",
      evidenceRequestRefs: [],
    },
    frameworkMetadata: metadata,
    fingerprint: "advisory-fixture-fingerprint",
  };
  const projectionEvidenceRefs = [{
    evidencePackItemId: "counter_1",
    classification: "fact" as const,
    originRefs: [{
      kind: "counterevidence_gate" as const,
      id: "counter_1",
    }],
    reasonCodes: ["COUNTEREVIDENCE_GATE_INPUT"],
    resolutionPath: ["counter_1"],
  }, {
    evidencePackItemId: "fact_1",
    classification: "fact" as const,
    originRefs: [{ kind: "fired_rule" as const, id: "rule_current" }],
    reasonCodes: ["FORMAL_DECISION_RULE_INPUT"],
    resolutionPath: ["fact_1", "rule_current"],
  }];
  const projection = {
    id: "projection_current",
    workspaceId,
    artifactSourceCandidateRunId: candidateRunId,
    evidenceRefs: projectionEvidenceRefs,
    fingerprint: createDecisionCriticalEvidenceProjectionFingerprint(
      projectionEvidenceRefs,
    ),
  };
  const passage: NamedLensPassage = {
    schemaVersion: "named-lens-passage-v1",
    workspaceId,
    artifactSourceCandidateRunId: candidateRunId,
    judgmentId: advisoryJudgmentId,
    frameworkCardId: advisoryCard.id,
    frameworkVersion: advisoryCard.version,
    decisionQuestionCode: "customer_adoption",
    evidenceDomainCodes: ["customer"],
    premise: {
      text: "The public framework tests durable customer demand.",
      componentFrameworkId: component.frameworkId,
      componentVersion: component.version,
      cardFieldRef: "decisionQuestions[0]",
      publicSourceIds: [sourceRef.sourceId],
      claimIds: sourceRef.claimIds,
      locator: sourceRef.locator,
      attributionScope: sourceRef.attributionScope,
    },
    caseApplication: {
      text: "Saved company evidence applies the framework.",
      evidenceItemIds: ["fact_1"],
    },
    countercase: {
      text: "Saved counterevidence limits the conclusion.",
      boundaryKind: "grounded_counterevidence",
      evidenceItemIds: ["counter_1"],
      evidenceRequestRefs: [],
    },
    unknownBoundary: {
      text: "A saved unknown defines the diligence boundary.",
      judgmentUnknownRefs: ["Unknown customer durability."],
      judgmentLimitationRefs: ["One customer signal remains bounded."],
      evidenceRequestRefs: [],
    },
    conditionalConclusion: {
      text: "The view remains conditional on resolving the saved unknown.",
      stance: "supportive",
      advisoryPosture: "supports_further_diligence",
    },
    advisoryContract: {
      formalDecisionWeight: "0",
      noEndorsement: true,
      namedPersonImpersonation: false,
      hiddenChainOfThought: false,
    },
    selectionBasisEvidenceIds: ["fact_1"],
    wordCount: 45,
    generatorVersion: "named-lens-generator-v1",
    fingerprint: sha("1"),
  };
  const catalogConsideration: NamedLensCatalogConsideration = {
    workspaceId,
    artifactSourceCandidateRunId: candidateRunId,
    judgmentOrCatalogCandidateId: advisoryJudgmentId,
    judgmentId: advisoryJudgmentId,
    frameworkCardId: advisoryCard.id,
    frameworkVersion: advisoryCard.version,
    initialDisposition: "judgment_eligible",
    reasonCodes: ["JUDGMENT_ELIGIBLE"],
    fingerprint: sha("2"),
  };
  const disposition: NamedLensFinalizationDisposition = {
    workspaceId,
    artifactSourceCandidateRunId: candidateRunId,
    judgmentOrCatalogCandidateId: advisoryJudgmentId,
    judgmentId: advisoryJudgmentId,
    frameworkCardId: advisoryCard.id,
    frameworkVersion: advisoryCard.version,
    disposition: "selected_main",
    selectedPosition: 1,
    priorityTier: "changed_belief",
    reasonCodes: ["CHANGED_BELIEF_EVIDENCE"],
    decisionQuestionCode: "customer_adoption",
    stance: "supportive",
    advisoryPosture: "supports_further_diligence",
    selectionBasisEvidenceIds: ["fact_1"],
    criticalEvidence: projection.evidenceRefs,
    selectionPolicyVersion: "named-lens-selection-v1",
    passageFingerprint: passage.fingerprint,
    fingerprint: sha("3"),
    decisionCriticalEvidenceProjectionId: projection.id,
    decisionCriticalEvidenceProjectionFingerprint: projection.fingerprint,
  };
  const attempt: NamedLensProviderAttempt = {
    workspaceId,
    artifactSourceCandidateRunId: candidateRunId,
    judgmentOrCatalogCandidateId: advisoryJudgmentId,
    logicalPassageId:
      `${advisoryJudgmentId}@named-lens-passage-v1@named-lens-generator-v1`,
    attemptNumber: 1,
    attemptFingerprint: sha("4"),
    status: "completed",
    telemetry: {
      inputTokens: 100,
      outputTokens: 50,
      costUsd: "0",
      costUsdPricingVersion: "deterministic-zero-cost-v1",
      costUsdUnavailableReason: null,
      latencyMs: 10,
    },
    failureReason: null,
  };
  const presentation: NamedLensPresentation = {
    schemaVersion: "decision-first-named-lens-v1",
    rendererVersion: "named-lens-renderer-v1",
    workspaceId,
    artifactSourceCandidateRunId: candidateRunId,
    synthesis: {
      branch: "single_perspective",
      text: "One bounded advisory reading informs diligence.",
      judgmentIds: [advisoryJudgmentId],
      evidenceItemIds: ["fact_1"],
    },
    segmentCitations: [{
      judgmentId: advisoryJudgmentId,
      segment: "case_application",
      evidenceItemIds: ["fact_1"],
      publicSourceIds: [],
      claimIds: [],
      judgmentUnknownRefs: [],
      judgmentLimitationRefs: [],
      evidenceRequestRefs: [],
      stanceRefs: [],
      advisoryPostureRefs: [],
    }],
    firstScreenProjectionRefs: {
      decisionId: "decision_current",
      decisionEvidenceItemIds: ["counter_1", "fact_1"],
      selectedJudgmentIds: [advisoryJudgmentId],
    },
    fingerprint: sha("9"),
  };
  const { fingerprint: _presentationFingerprint, ...presentationPayload } =
    presentation;
  const semanticFingerprints = createNamedLensSemanticFingerprints({
    evidenceRefs: projection.evidenceRefs,
    dispositions: [disposition],
    passages: [passage],
    presentation: presentationPayload,
  });
  presentation.fingerprint = semanticFingerprints.presentationFingerprint;
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
  const actions = actionsForDealStatusAndDirection("invested", "negative");
  const decision = {
    id: "decision_current",
    analysisType: "final_synthesis" as const,
    companyQuality: "unavailable" as const,
    priceAttractiveness: "unavailable" as const,
    fundFit: "unavailable" as const,
    decision: null,
    decisionCeiling: null,
    hardVeto: false,
    firedRules: [{
      ruleId: "rule_current",
      inputRefs: ["counter_1", "fact_1"],
      result: "not_applicable" as const,
      appliedCeiling: null,
      veto: false,
    }],
    blockingEvidenceItemIds: [],
    claimEdges: [],
    confidence: "low" as const,
  };
  const finalization: CandidateFinalization = {
    workerId: "worker_current",
    leaseToken: "lease_current",
    candidateRunId,
    candidateAnalysisFingerprint: sha("a"),
    evidencePackBuildInputFingerprint: sha("e"),
    evidencePack,
    context,
    scenarioModel: {
      id: "scenario_current",
      candidateRunId,
      formulaPolicyVersion: context.valuationMethodPolicyId,
      scenarios: (["bear", "base", "bull"] as const).map((name) => ({
        name,
        inputs: scenarioInputs(name),
      })),
      probabilityWeighted: false,
    },
    calculations: [],
    calculationClaimEdges: [],
    judgments: [...formalJudgments, advisoryJudgment],
    disagreements: [],
    valuation: {
      id: "valuation_current",
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
    decision,
    narrative: "Formal values remain unavailable; one advisory passage is bounded.",
    actionDrafts: [{
      schemaVersion: "action-draft-v2",
      safety: "status_safe",
      deliveryMode: "draft_only",
      draftPolicyVersion: "status-safe-action-draft-v2",
      actionPolicyVersion: "belief-action-policy-v1",
      id: "draft_current",
      workspaceId,
      candidateRunId,
      dealStatus: "invested",
      beliefDirection: "negative",
      actions,
      missingEvidence: [{
        fieldId: "arr",
        label: "arr",
        externalLabel: "arr",
        reasonCode: "MISSING_CRITICAL_EVIDENCE",
        mostLikelyDecisionImpact:
          "Providing accepted evidence may raise or lower the formal decision ceiling.",
      }],
      format: "internal_memo",
      channel: "internal",
      audienceType: "internal",
      body: "INTERNAL UNDERWRITING ACTION MEMO — DRAFT ONLY\nFormal values remain unavailable.",
      createdAt: now,
      updatedAt: now,
    }],
    versionSnapshot: {
      fundPolicyId: "fund_policy_current",
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
      frameworkPackId: SYNTHETIC_FRAMEWORK_PACK.id,
      frameworkPackDefinitionFingerprint: sha("2"),
      routerVersion: "context-router-v2",
      criticalEvidenceProfileId: context.criticalEvidenceProfileId,
      criticalEvidenceProfileDefinitionFingerprint: sha("3"),
      valuationMethodPolicyId: context.valuationMethodPolicyId,
      valuationMethodPolicyDefinitionFingerprint: sha("4"),
      decisionPolicyId: context.decisionPolicyId,
      decisionPolicyDefinitionFingerprint: sha("5"),
      referenceCatalogFingerprint: sha("6"),
      frameworkCatalogVersion: catalog.version,
      frameworkCatalogFingerprint: catalog.fingerprint,
      frameworkCorpusDigest: catalog.authorization.corpusDigest,
      formulaVersions: [],
      providerModel: "synthetic-test",
      promptVersion: "framework-lens-v1",
      schemaVersion: "framework-judgment-v1",
      settingsFingerprint: sha("7"),
      applicationCommit: "task-6-test",
      companyAnalysisUnknowns: [],
      namedLensSelectionPolicyVersion: "named-lens-selection-v1",
      namedLensPassageSchemaVersion: "named-lens-passage-v1",
      namedLensGeneratorVersion: "named-lens-generator-v1",
      underwritingPresentationSchemaVersion: "decision-first-named-lens-v1",
      decisionTaxonomyVersion: "named-lens-decision-taxonomy-v1",
      decisionTaxonomyDigest: DECISION_TAXONOMY_DIGEST,
      criticalEvidenceProjectionFingerprint: projection.fingerprint,
      finalDispositionsFingerprint:
        semanticFingerprints.finalDispositionsFingerprint,
      presentationFingerprint: semanticFingerprints.presentationFingerprint,
      refreshNonce: null,
    },
    namedLensCatalogConsiderations: [catalogConsideration],
    decisionCriticalEvidenceProjection: projection,
    namedLensAttemptRefs: [{
      judgmentOrCatalogCandidateId: advisoryJudgmentId,
      logicalPassageId: attempt.logicalPassageId,
      attemptNumber: 1,
      attemptFingerprint: attempt.attemptFingerprint,
    }],
    namedLensDispositions: [disposition],
    namedLensPassages: [passage],
    underwritingPresentationReportId: "report_current",
    namedLensPresentation: presentation,
    terminalStatus: "completed",
    terminalReasonCodes: ["limited_framework_coverage"],
  };
  const segmentEntries = [
    ["premise", passage.premise],
    ["case_application", passage.caseApplication],
    ["countercase", passage.countercase],
    ["unknown_boundary", passage.unknownBoundary],
    ["conditional_conclusion", passage.conditionalConclusion],
  ] as const;
  return {
    finalization,
    persistedAttempts: [attempt],
    rawAttemptEvents: [{
      ...attempt,
      status: "reserved",
      telemetry: null,
      failureReason: null,
    }, attempt],
    projectionRows: [{
      projection_id: projection.id,
      payload_fingerprint: projection.fingerprint,
      payload: projection,
    }],
    dispositionRows: [{
      catalog_ordinal: 1,
      judgment_or_catalog_candidate_id: advisoryJudgmentId,
      catalog_consideration_fingerprint: catalogConsideration.fingerprint,
      catalog_consideration: catalogConsideration,
      payload_fingerprint: disposition.fingerprint,
      payload: disposition,
    }],
    passageRows: [{
      judgment_id: advisoryJudgmentId,
      passage_fingerprint: passage.fingerprint,
      payload: passage,
    }],
    segmentRows: segmentEntries.map(([segment_kind, payload], index) => ({
      judgment_id: advisoryJudgmentId,
      segment_ordinal: index + 1,
      segment_kind,
      payload,
    })),
    presentationRows: [{
      report_id: "report_current",
      presentation_fingerprint: presentation.fingerprint,
      payload: presentation,
    }],
  };
}

/**
 * Completes a current formal-only fixture with an explicit zero-available
 * Named Lens presentation. Callers must not use this to erase advisory
 * judgments; fixtures with advisory execution need their full catalog graph.
 */
export function withEmptyCurrentNamedLensArtifacts(
  input: CandidateFinalization,
): CandidateFinalization {
  if (input.judgments.some(({ frameworkMetadata }) =>
    frameworkMetadata !== undefined
  )) {
    throw new Error(
      "A zero-available Named Lens fixture cannot omit advisory judgments.",
    );
  }
  const candidateRunId = input.candidateRunId;
  const workspaceId = input.evidencePack.workspaceId;
  const projection = {
    id: `projection_zero_${candidateRunId}`,
    workspaceId,
    artifactSourceCandidateRunId: candidateRunId,
    evidenceRefs: [],
    fingerprint: createDecisionCriticalEvidenceProjectionFingerprint([]),
  };
  const presentation: NamedLensPresentation = {
    schemaVersion: "decision-first-named-lens-v1",
    rendererVersion: "named-lens-renderer-v1",
    workspaceId,
    artifactSourceCandidateRunId: candidateRunId,
    synthesis: {
      branch: "zero_available",
      text: "No eligible advisory perspective was available for this formal-only fixture.",
      judgmentIds: [],
      evidenceItemIds: [],
    },
    segmentCitations: [],
    firstScreenProjectionRefs: {
      decisionId: input.decision.id,
      decisionEvidenceItemIds: [],
      selectedJudgmentIds: [],
    },
    fingerprint: sha("f"),
  };
  const { fingerprint: _presentationFingerprint, ...presentationPayload } =
    presentation;
  const semanticFingerprints = createNamedLensSemanticFingerprints({
    evidenceRefs: projection.evidenceRefs,
    dispositions: [],
    passages: [],
    presentation: presentationPayload,
  });
  presentation.fingerprint = semanticFingerprints.presentationFingerprint;
  return {
    ...structuredClone(input),
    versionSnapshot: {
      ...structuredClone(input.versionSnapshot),
      frameworkCatalogVersion:
        input.versionSnapshot.frameworkCatalogVersion
        ?? catalog.version,
      frameworkCatalogFingerprint:
        input.versionSnapshot.frameworkCatalogFingerprint
        ?? catalog.fingerprint,
      frameworkCorpusDigest:
        input.versionSnapshot.frameworkCorpusDigest
        ?? catalog.authorization.corpusDigest,
      namedLensSelectionPolicyVersion: "named-lens-selection-v1",
      namedLensPassageSchemaVersion: "named-lens-passage-v1",
      namedLensGeneratorVersion: "named-lens-generator-v1",
      underwritingPresentationSchemaVersion:
        "decision-first-named-lens-v1",
      decisionTaxonomyVersion: "named-lens-decision-taxonomy-v1",
      decisionTaxonomyDigest: DECISION_TAXONOMY_DIGEST,
      criticalEvidenceProjectionFingerprint: projection.fingerprint,
      finalDispositionsFingerprint:
        semanticFingerprints.finalDispositionsFingerprint,
      presentationFingerprint: semanticFingerprints.presentationFingerprint,
      refreshNonce: input.versionSnapshot.refreshNonce ?? null,
    },
    namedLensCatalogConsiderations: [],
    decisionCriticalEvidenceProjection: projection,
    namedLensAttemptRefs: [],
    namedLensDispositions: [],
    namedLensPassages: [],
    underwritingPresentationReportId: `report_zero_${candidateRunId}`,
    namedLensPresentation: presentation,
    terminalStatus: "completed",
    terminalReasonCodes: ["limited_framework_coverage"],
  };
}

/**
 * Task 6 fixture for advisory judgments whose durable provider executions are
 * settled but whose Task 7 passage/presentation stage has not run. It keeps
 * the formal artifacts intact and records an honest partial, withheld graph.
 */
export function withWithheldCurrentNamedLensArtifacts(
  input: CandidateFinalization,
  persistedAttempts: NamedLensProviderAttempt[],
): CandidateFinalization {
  const normalizedInput = structuredClone(input);
  normalizedInput.judgments = normalizedInput.judgments.map((judgment) =>
    judgment.frameworkMetadata !== undefined
      && !("counterevidenceBoundary" in judgment)
      ? {
        ...judgment,
        counterevidenceBoundary:
          judgment.counterEvidenceItemIds.length > 0
            ? {
              kind: "grounded_counterevidence" as const,
              evidenceRequestRefs: [],
            }
            : {
              kind: "no_candidate_local_counterevidence" as const,
              evidenceRequestRefs: [
                `request_counterevidence_${judgment.id}`,
              ],
            },
      }
      : judgment
  );
  const advisory = normalizedInput.judgments
    .filter(({ frameworkMetadata }) => frameworkMetadata !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (advisory.length === 0) {
    return withEmptyCurrentNamedLensArtifacts(normalizedInput);
  }
  const candidateRunId = input.candidateRunId;
  const workspaceId = input.evidencePack.workspaceId;
  const projection = {
    id: `projection_withheld_${candidateRunId}`,
    workspaceId,
    artifactSourceCandidateRunId: candidateRunId,
    evidenceRefs: [],
    fingerprint: createDecisionCriticalEvidenceProjectionFingerprint([]),
  };
  const fingerprintFor = (index: number) =>
    `sha256:${(index + 1).toString(16).padStart(64, "0")}`;
  const classifications = advisory.map((judgment) => {
    const eligible = judgment.frameworkMetadata?.applicable === true
      && judgment.applicability === "applicable"
      && judgment.conclusion !== "abstain";
    const disposition = eligible
      ? "withheld" as const
      : judgment.frameworkMetadata?.applicable === false
          || judgment.applicability === "not_applicable"
      ? "context_inapplicable" as const
      : judgment.applicability === "unavailable"
      ? "unavailable" as const
      : "abstained" as const;
    return {
      judgment,
      eligible,
      disposition,
      judgmentId: disposition === "context_inapplicable"
        ? null
        : judgment.id,
      reasonCodes: disposition === "withheld"
        ? ["PASSAGE_NOT_GENERATED"]
        : disposition === "context_inapplicable"
        ? ["CONTEXT_INAPPLICABLE"]
        : disposition === "unavailable"
        ? ["JUDGMENT_UNAVAILABLE"]
        : ["JUDGMENT_ABSTAINED"],
    };
  });
  const catalogConsiderations = classifications.map((classification, index) => ({
    workspaceId,
    artifactSourceCandidateRunId: candidateRunId,
    judgmentOrCatalogCandidateId: classification.judgment.id,
    judgmentId: classification.judgmentId,
    frameworkCardId: classification.judgment.frameworkCardId,
    frameworkVersion: classification.judgment.frameworkVersion,
    initialDisposition: classification.disposition === "withheld"
      ? "judgment_eligible" as const
      : classification.disposition,
    reasonCodes: classification.eligible
      ? ["JUDGMENT_ELIGIBLE"]
      : classification.reasonCodes,
    fingerprint: fingerprintFor(index),
  }));
  const dispositions = classifications.map((classification, index) => ({
    workspaceId,
    artifactSourceCandidateRunId: candidateRunId,
    judgmentOrCatalogCandidateId: classification.judgment.id,
    judgmentId: classification.judgmentId,
    frameworkCardId: classification.judgment.frameworkCardId,
    frameworkVersion: classification.judgment.frameworkVersion,
    disposition: classification.disposition,
    selectedPosition: null,
    priorityTier: null,
    reasonCodes: classification.reasonCodes,
    decisionQuestionCode: null,
    stance: null,
    advisoryPosture: null,
    selectionBasisEvidenceIds: [],
    criticalEvidence: [],
    selectionPolicyVersion: "named-lens-selection-v1" as const,
    passageFingerprint: null,
    fingerprint: fingerprintFor(advisory.length + index),
    decisionCriticalEvidenceProjectionId: projection.id,
    decisionCriticalEvidenceProjectionFingerprint: projection.fingerprint,
  }));
  const eligibleJudgmentIds = new Set(
    classifications
      .filter(({ eligible }) => eligible)
      .map(({ judgment }) => judgment.id),
  );
  const attempts = persistedAttempts
    .filter(({ judgmentOrCatalogCandidateId }) =>
      eligibleJudgmentIds.has(judgmentOrCatalogCandidateId)
    )
    .sort((left, right) =>
      left.logicalPassageId.localeCompare(right.logicalPassageId)
      || left.attemptNumber - right.attemptNumber
    );
  const presentation: NamedLensPresentation = {
    schemaVersion: "decision-first-named-lens-v1",
    rendererVersion: "named-lens-renderer-v1",
    workspaceId,
    artifactSourceCandidateRunId: candidateRunId,
    synthesis: {
      branch: "zero_available",
      text: "Advisory passages remain withheld pending the deterministic presentation stage.",
      judgmentIds: [],
      evidenceItemIds: [],
    },
    segmentCitations: [],
    firstScreenProjectionRefs: {
      decisionId: input.decision.id,
      decisionEvidenceItemIds: [],
      selectedJudgmentIds: [],
    },
    fingerprint: sha("e"),
  };
  const { fingerprint: _presentationFingerprint, ...presentationPayload } =
    presentation;
  const semanticFingerprints = createNamedLensSemanticFingerprints({
    evidenceRefs: projection.evidenceRefs,
    dispositions,
    passages: [],
    presentation: presentationPayload,
  });
  presentation.fingerprint = semanticFingerprints.presentationFingerprint;
  return {
    ...normalizedInput,
    versionSnapshot: {
      ...normalizedInput.versionSnapshot,
      frameworkCatalogVersion:
        normalizedInput.versionSnapshot.frameworkCatalogVersion
        ?? catalog.version,
      frameworkCatalogFingerprint:
        normalizedInput.versionSnapshot.frameworkCatalogFingerprint
        ?? catalog.fingerprint,
      frameworkCorpusDigest:
        normalizedInput.versionSnapshot.frameworkCorpusDigest
        ?? catalog.authorization.corpusDigest,
      namedLensSelectionPolicyVersion: "named-lens-selection-v1",
      namedLensPassageSchemaVersion: "named-lens-passage-v1",
      namedLensGeneratorVersion: "named-lens-generator-v1",
      underwritingPresentationSchemaVersion:
        "decision-first-named-lens-v1",
      decisionTaxonomyVersion: "named-lens-decision-taxonomy-v1",
      decisionTaxonomyDigest: DECISION_TAXONOMY_DIGEST,
      criticalEvidenceProjectionFingerprint: projection.fingerprint,
      finalDispositionsFingerprint:
        semanticFingerprints.finalDispositionsFingerprint,
      presentationFingerprint: semanticFingerprints.presentationFingerprint,
      refreshNonce: normalizedInput.versionSnapshot.refreshNonce ?? null,
    },
    namedLensCatalogConsiderations: catalogConsiderations,
    decisionCriticalEvidenceProjection: projection,
    namedLensAttemptRefs: attempts.map((attempt) => ({
      judgmentOrCatalogCandidateId: attempt.judgmentOrCatalogCandidateId,
      logicalPassageId: attempt.logicalPassageId,
      attemptNumber: attempt.attemptNumber,
      attemptFingerprint: attempt.attemptFingerprint,
    })),
    namedLensDispositions: dispositions,
    namedLensPassages: [],
    underwritingPresentationReportId: `report_withheld_${candidateRunId}`,
    namedLensPresentation: presentation,
    terminalStatus: "partial",
    terminalReasonCodes: ["named_lens_passage_attempts_exhausted"],
  };
}
