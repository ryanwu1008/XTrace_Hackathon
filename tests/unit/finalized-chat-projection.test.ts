import assert from "node:assert/strict";
import test from "node:test";

import type { CandidateArtifactBundle } from "../../db/repositories/underwriting-artifacts";
import type { FinalizedChatIdentity } from "../../lib/contracts/finalized-chat";
import {
  BeliefChangeAssessmentV1Schema,
  CompanyAnalysisSchema,
  type BeliefChangeDirection,
  type CompanyAnalysis,
  type DealStatus,
} from "../../lib/contracts/domain";
import { buildSampleDecisionSourceRef } from "../../lib/belief-reversal/sample-decision-source";
import { evaluateBeliefRevisionHardGates } from "../../lib/matching/hard-gates";
import { buildOpportunityScoreBreakdown } from "../../lib/matching/scoring";
import {
  actionsForDealStatusAndDirection,
  renderRecommendedNextMove,
} from "../../lib/reports/action-policy";
import { buildFinalizedChatProjection } from "../../lib/chat/finalized-projection";
import {
  exactSourceV2,
  marketEventV2,
} from "../helpers/source-evidence-v2";

const WORKSPACE_ID = "workspace_finalized_chat";
const REPORT_ID = "report_finalized_chat";
const RUN_ID = "00000000-0000-4000-8000-000000000011";
const DEAL_ID = "deal_finalized_chat";
const CANDIDATE_RUN_ID = "candidate_finalized_chat";
const CREATED_AT = "2026-08-01T19:00:00.000Z";
const FP_A = `sha256:${"1".repeat(64)}`;
const FP_B = `sha256:${"2".repeat(64)}`;
const FP_C = `sha256:${"3".repeat(64)}`;
const FP_D = `sha256:${"4".repeat(64)}`;

const identity = {
  workspaceId: WORKSPACE_ID,
  reportId: REPORT_ID,
  runId: RUN_ID,
  dealId: DEAL_ID,
  candidateRunId: CANDIDATE_RUN_ID,
} as const;

const evidenceFrame = {
  state: "current",
  evidenceMode: "pinned",
  contextFingerprint: FP_A,
  eventSetFingerprint: FP_B,
  bindingFingerprint: FP_C,
  snapshotId: "belief_reversal_2026_08_01",
  snapshotFingerprint: FP_D,
} as const;

function analysisFixture(input: {
  dealStatus?: DealStatus;
  direction?: BeliefChangeDirection;
} = {}): CompanyAnalysis {
  const dealStatus = input.dealStatus ?? "passed";
  const direction = input.direction ?? "positive";
  if (dealStatus === "screening" || dealStatus === "evaluating") {
    throw new Error("The projection fixture requires a decision-history status.");
  }
  const priorActions = actionsForDealStatusAndDirection(dealStatus, "none");
  const actions = actionsForDealStatusAndDirection(dealStatus, direction);
  const sample = buildSampleDecisionSourceRef({
    id: "fixture_finalized_chat",
    documentId: "document_fixture_finalized_chat",
    sourceRevisionId: "revision_fixture_finalized_chat",
    contentFingerprint: `sha256:${"5".repeat(64)}`,
    occurredAt: "2026-06-10T17:00:00.000Z",
    retrievedAt: "2026-08-01T18:00:00.000Z",
    summary: "The sample committee deferred action pending durable customer proof.",
    decisionReason: "Durable customer proof was incomplete.",
    concerns: ["Retention remained unverified."],
    revisitConditions: ["Revisit when a verified customer expansion becomes public."],
  });
  const trigger = exactSourceV2("source_finalized_trigger", {
    title: "Verified customer expansion",
    canonicalUrl: "https://example.test/customer-expansion",
    eventAt: "2026-07-31",
    eventAtPrecision: "date",
    publishedAt: "2026-07-31",
    publishedAtPrecision: "date",
    retrievedAt: "2026-08-01T18:00:00.000Z",
    retrievedAtPrecision: "timestamp",
    sourceRevisionId: "revision_finalized_trigger",
    contentFingerprint: `sha256:${"6".repeat(64)}`,
    text: {
      status: "verified_exact",
      verbatimExcerpt: "A named customer expanded its production deployment.",
      normalizedStatement: "A named customer expanded a production deployment.",
    },
  });
  const counter = exactSourceV2("source_finalized_counter", {
    title: "Customer expansion limitations",
    canonicalUrl: "https://example.test/customer-expansion-limitations",
    eventAt: "2026-07-31",
    eventAtPrecision: "date",
    publishedAt: "2026-07-31",
    publishedAtPrecision: "date",
    retrievedAt: "2026-08-01T18:00:00.000Z",
    retrievedAtPrecision: "timestamp",
    evidenceRole: "counterevidence",
    sourceRevisionId: "revision_finalized_counter",
    contentFingerprint: `sha256:${"7".repeat(64)}`,
    text: {
      status: "verified_exact",
      verbatimExcerpt: "The announcement does not establish durable retention.",
      normalizedStatement: "Durable retention remains unverified after the announcement.",
    },
  });
  const event = marketEventV2(trigger, {
    id: "event_finalized_chat",
    title: "Named customer expands production deployment",
    eventAt: "2026-07-31",
    eventAtPrecision: "date",
    sources: [trigger, counter],
  });
  const scoreBreakdown = buildOpportunityScoreBreakdown({
    eventRelevance: 0.82,
    dealRelevance: 0.82,
    priorContextStrength: 0.82,
    evidenceQuality: 0.82,
  });
  const gateContext = {
    priorInteraction: {
      id: sample.id,
      occurredAt: sample.eventAt!,
      sourceIds: [sample.id],
      revisitConditions: [
        "Revisit when a verified customer expansion becomes public.",
      ],
      priorActions,
      provenance: "demo_fixture" as const,
      label: "Sample decision record" as const,
    },
    triggerEvent: {
      id: event.id,
      eventAt: event.eventAt!,
      sourceIds: event.sources.map(({ id }) => id),
    },
    sources: [trigger, counter, sample],
  };
  const gates = evaluateBeliefRevisionHardGates({
    priorInteraction: gateContext.priorInteraction,
    triggerEvent: gateContext.triggerEvent,
    sources: gateContext.sources,
    revisitMapping: {
      priorInteractionId: sample.id,
      revisitConditionIndex: 0,
      revisitConditionText:
        "Revisit when a verified customer expansion becomes public.",
      triggerEventId: event.id,
      citedSourceIds: [trigger.id],
    },
    counterevidence: {
      statement: "The announcement does not establish durable retention.",
      citedSourceIds: [counter.id],
    },
    dealStatus,
    direction,
    proposedActions: actions,
  });
  const beliefAssessment = BeliefChangeAssessmentV1Schema.parse({
    schemaVersion: "belief-change-assessment-v1",
    dealStatus,
    direction,
    scoreBreakdown,
    gateContext,
    gates,
    actions,
  });

  return CompanyAnalysisSchema.parse({
    id: "analysis_finalized_chat",
    reportId: REPORT_ID,
    runId: RUN_ID,
    dealId: DEAL_ID,
    companyName: "Finalized Chat Co",
    dealStatus,
    outcome: "belief_revised",
    confidence: "high",
    score: 0.82,
    verifiedSourceCount: 3,
    investmentMemory: {
      previousMeetingSummary:
        "The sample committee deferred action pending durable customer proof.",
      decisionReason: "Durable customer proof was incomplete.",
      concerns: ["Retention remained unverified."],
      revisitConditions: [
        "Revisit when a verified customer expansion becomes public.",
      ],
      lastEvaluatedAt: sample.eventAt,
      memoryIds: ["memory_finalized_chat"],
      sourceIds: [sample.id],
      fixtureIds: [sample.id],
      priorActions,
    },
    marketEvidence: {
      relationship: direction === "negative" ? "contradicts" : "satisfies",
      explanation:
        "The saved customer expansion evidence changes the prior proof assessment.",
      eventIds: [event.id],
      events: [event],
      sourceIds: event.sources.map(({ id }) => id),
    },
    implications: {
      positive: ["A named production expansion improves commercial evidence."],
      negative: ["Durable retention remains unverified."],
    },
    beliefAssessment,
    recommendedNextMove: renderRecommendedNextMove(actions),
    companyBrief: {
      icSnapshot: [],
      traction: [],
      dealTerms: [],
      risks: [{
        severity: "high",
        title: "Retention",
        detail: "Retention remained unverified.",
        nextQuestion: "What current cohort evidence establishes retention?",
        sourceIds: [sample.id],
      }],
      decisionHistory: [{
        occurredAt: sample.eventAt,
        title: "Sample decision record",
        summary: "Durable customer proof was incomplete.",
        sourceIds: [sample.id],
      }],
      sourceLineage: [trigger, counter, sample],
    },
    sources: [trigger, counter, sample],
    createdAt: CREATED_AT,
  });
}

function bundleFixture(analysis: CompanyAnalysis): CandidateArtifactBundle {
  const actions = analysis.beliefAssessment!.actions;
  const factTrigger = {
    id: "fact_customer_expansion",
    analysisType: "fact" as const,
    provenanceOrigin: "public_source" as const,
    field: "customer_expansion",
    value: "A named customer expanded its production deployment.",
    unit: null,
    currency: null,
    periodStart: null,
    periodEnd: null,
    publishedAt: "2026-07-31T00:00:00.000Z",
    eventAt: "2026-07-31T00:00:00.000Z",
    retrievedAt: "2026-08-01T18:00:00.000Z",
    sourceRevisionId: "revision_finalized_trigger",
    locator: {
      kind: "text_range" as const,
      start: 0,
      end: 53,
      excerpt: "A named customer expanded its production deployment.",
    },
    sourceRole: "independent_third_party" as const,
    assertionStatus: "verified" as const,
    verificationMethod: "Exact reviewed source revision",
    freshness: "current" as const,
    acceptedForGate: true,
  };
  const factCounter = {
    ...factTrigger,
    id: "fact_retention_limit",
    field: "retention",
    value: "The announcement does not establish durable retention.",
    sourceRevisionId: "revision_finalized_counter",
    locator: {
      kind: "text_range" as const,
      start: 0,
      end: 55,
      excerpt: "The announcement does not establish durable retention.",
    },
    assertionStatus: "reported" as const,
  };
  const calculation = {
    id: "calculation_base_valuation",
    analysisType: "calculation" as const,
    formulaId: "market_comps_v1",
    formulaVersion: "1",
    inputRefs: [{
      itemId: factTrigger.id,
      value: "24000000",
      type: "fact" as const,
    }],
    output: "24000000",
    unit: "USD",
    currency: "USD",
    period: null,
    roundingPolicy: "half_even_display_only" as const,
    computedAt: CREATED_AT,
    status: "completed" as const,
  };
  const missingEvidence = [{
    fieldId: "net_revenue_retention",
    label: "Current net revenue retention",
    reasonCode: "MISSING_CRITICAL_EVIDENCE",
    mostLikelyDecisionImpact: "Could change company quality and price attractiveness.",
  }];
  const bundle = {
    candidateRunId: CANDIDATE_RUN_ID,
    workspaceId: WORKSPACE_ID,
    dealId: DEAL_ID,
    candidateAnalysisFingerprint: `sha256:${"8".repeat(64)}`,
    evidencePack: {
      id: "evidence_pack_finalized_chat",
      version: 1,
      workspaceId: WORKSPACE_ID,
      dealId: DEAL_ID,
      asOfDate: "2026-08-01",
      sourceRevisionIds: [
        "revision_finalized_trigger",
        "revision_finalized_counter",
      ],
      facts: [factTrigger, factCounter],
      assumptions: [{
        id: "assumption_exit_multiple",
        analysisType: "assumption",
        provenanceOrigin: "recommended_policy",
        scenario: "base",
        field: "exit_multiple",
        value: "8",
        unit: "multiple",
        rationale: "Pinned underwriting policy assumption.",
        inputRefIds: ["valuation_policy_finalized_chat"],
        sensitivity: "high",
        requiresConfirmation: true,
      }],
      conflicts: [{
        id: "conflict_retention",
        field: "retention",
        leftFactId: factTrigger.id,
        rightFactId: factCounter.id,
        materialityRuleId: "materiality_retention",
        material: true,
        status: "open",
        resolutionFactId: null,
        resolutionReason: null,
      }],
      coverage: {
        minimumModelInputsComplete: false,
        criticalEvidenceComplete: false,
        missingFieldIds: ["net_revenue_retention"],
        blockingConflictIds: ["conflict_retention"],
        decisionCeiling: "Advance",
        underwritingStatus: "unavailable",
        reasonCodes: ["MISSING_CRITICAL_EVIDENCE"],
      },
      createdAt: CREATED_AT,
    },
    context: {
      id: "context_finalized_chat",
      contextVersion: "1",
      stage: "series_a",
      businessModel: "enterprise_ai",
      geography: "us",
      securityType: "preferred",
      asOfDate: "2026-08-01",
      criticalEvidenceProfileId: "critical_profile_finalized_chat",
      benchmarkPackId: "benchmark_finalized_chat",
      benchmarkCompatibility: "exact",
      valuationMethodPolicyId: "valuation_policy_finalized_chat",
      decisionPolicyId: "decision_policy_finalized_chat",
      frameworkPackId: "framework_pack_finalized_chat",
    },
    scenarioModel: {
      id: "scenario_model_finalized_chat",
      candidateRunId: CANDIDATE_RUN_ID,
      formulaPolicyVersion: "valuation_policy_finalized_chat",
      scenarios: [],
      probabilityWeighted: false,
    },
    calculations: [calculation],
    calculationClaimEdges: [],
    judgments: [{
      id: "judgment_quality",
      analysisType: "framework_judgment",
      frameworkCardId: "framework_quality",
      frameworkVersion: "1.0.0",
      applicability: "applicable",
      conclusion: "supportive",
      supportEvidenceItemIds: [factTrigger.id],
      counterEvidenceItemIds: [factCounter.id],
      unusedEvidenceItemIds: [],
      strongestSupport: "The named deployment expansion improves proof quality.",
      strongestCounterargument: "Retention remains unverified.",
      unknowns: ["Current net revenue retention"],
      limitations: ["Public evidence does not establish cohort retention."],
      confidence: {
        sourceReliability: "high",
        evidenceStrength: "medium",
        evidenceCoverage: "medium",
        applicability: "high",
        judgment: "medium",
      },
      claimEdges: [],
      fingerprint: `sha256:${"9".repeat(64)}`,
    }, {
      id: "judgment_risk",
      analysisType: "framework_judgment",
      frameworkCardId: "framework_risk",
      frameworkVersion: "2.0.0",
      applicability: "applicable",
      conclusion: "negative",
      supportEvidenceItemIds: [factCounter.id],
      counterEvidenceItemIds: [factTrigger.id],
      unusedEvidenceItemIds: [],
      strongestSupport: "Retention evidence remains absent.",
      strongestCounterargument: "The named deployment expanded.",
      unknowns: ["Expansion economics"],
      limitations: ["One deployment is not a cohort."],
      confidence: {
        sourceReliability: "high",
        evidenceStrength: "medium",
        evidenceCoverage: "low",
        applicability: "high",
        judgment: "medium",
      },
      claimEdges: [],
      fingerprint: `sha256:${"a".repeat(64)}`,
    }],
    disagreements: [{
      id: "disagreement_quality_risk",
      leftJudgmentId: "judgment_quality",
      rightJudgmentId: "judgment_risk",
      topic: "company_quality_vs_price",
      explanation:
        "The quality lens treats expansion as progress while the risk lens requires retention proof.",
      evidenceItemIds: [factTrigger.id, factCounter.id],
    }],
    valuation: {
      id: "valuation_finalized_chat",
      status: "completed",
      scenarios: [{
        name: "bear",
        valuation: "18000000",
        calculationIds: [calculation.id],
      }, {
        name: "base",
        valuation: "24000000",
        calculationIds: [calculation.id],
      }, {
        name: "bull",
        valuation: "32000000",
        calculationIds: [calculation.id],
      }],
      currentAsk: "26000000",
      maximumAcceptablePreMoney: "24000000",
      initialOwnership: "0.1667",
      postDilutionOwnership: "0.12",
      grossMoic: "6.5",
      grossIrr: "0.45",
      pricingPremium: "0.0833",
      calculationIds: [calculation.id],
      blockerCodes: [],
    },
    decision: {
      id: "decision_finalized_chat",
      analysisType: "final_synthesis",
      companyQuality: "mixed",
      priceAttractiveness: "mixed",
      fundFit: "pass",
      decision: "Advance",
      decisionCeiling: "Advance",
      hardVeto: false,
      firedRules: [],
      blockingEvidenceItemIds: ["net_revenue_retention"],
      claimEdges: [],
      confidence: "medium",
    },
    narrative: "Persisted underwriting narrative.",
    actionDrafts: [{
      schemaVersion: "action-draft-v2",
      safety: "status_safe",
      deliveryMode: "draft_only",
      draftPolicyVersion: "status-safe-action-draft-v2",
      actionPolicyVersion: "belief-action-policy-v1",
      id: "action_draft_finalized_chat",
      workspaceId: WORKSPACE_ID,
      candidateRunId: CANDIDATE_RUN_ID,
      dealStatus: analysis.dealStatus,
      beliefDirection: analysis.beliefAssessment!.direction,
      actions,
      missingEvidence,
      format: "internal_memo",
      channel: "internal",
      audienceType: "internal",
      body: "INTERNAL UNDERWRITING ACTION MEMO — DRAFT ONLY\nSaved action memo.",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    }],
    versionSnapshot: {
      fundPolicyId: "fund_policy_finalized_chat",
      dealStatus: analysis.dealStatus,
      beliefDirection: analysis.beliefAssessment!.direction,
      canonicalActions: actions,
      actionPolicyVersion: "belief-action-policy-v1",
      draftPolicyVersion: "status-safe-action-draft-v2",
      benchmarkPackId: "benchmark_finalized_chat",
      benchmarkEntryId: "benchmark_entry_finalized_chat",
      benchmarkDefinitionFingerprint: FP_A,
      frameworkPackId: "framework_pack_finalized_chat",
      frameworkPackDefinitionFingerprint: FP_B,
      routerVersion: "1",
      criticalEvidenceProfileId: "critical_profile_finalized_chat",
      criticalEvidenceProfileDefinitionFingerprint: FP_C,
      valuationMethodPolicyId: "valuation_policy_finalized_chat",
      valuationMethodPolicyDefinitionFingerprint: FP_D,
      decisionPolicyId: "decision_policy_finalized_chat",
      decisionPolicyDefinitionFingerprint: `sha256:${"b".repeat(64)}`,
      referenceCatalogFingerprint: `sha256:${"c".repeat(64)}`,
      formulaVersions: ["market_comps_v1"],
      providerModel: "persisted-only",
      promptVersion: "persisted-only",
      schemaVersion: "candidate-version-v1",
      settingsFingerprint: `sha256:${"d".repeat(64)}`,
      applicationCommit: "task-11-test",
    },
    claimEdges: [],
  };
  return bundle as unknown as CandidateArtifactBundle;
}

function project(input: {
  topic: Parameters<typeof buildFinalizedChatProjection>[0]["topic"];
  analysis?: CompanyAnalysis;
  bundle?: CandidateArtifactBundle | null;
  requestMode?: "product" | "public_sandbox";
  identityOverride?: Partial<FinalizedChatIdentity>;
  candidateBinding?: Parameters<
    typeof buildFinalizedChatProjection
  >[0]["candidateBinding"];
}) {
  const analysis = input.analysis ?? analysisFixture();
  return buildFinalizedChatProjection({
    topic: input.topic,
    requestMode: input.requestMode ?? "public_sandbox",
    identity: { ...identity, ...input.identityOverride },
    evidenceFrame,
    analysis,
    bundle: input.bundle === undefined ? bundleFixture(analysis) : input.bundle,
    candidateBinding: input.candidateBinding ?? {
      candidateRunId: CANDIDATE_RUN_ID,
      rerunOfId: null,
      candidateAnalysisFingerprint: `sha256:${"8".repeat(64)}`,
    },
  });
}

test("a rerun alias remains the exact projection identity while binding its immutable source artifact", () => {
  const analysis = analysisFixture();
  const sourceBundle = {
    ...bundleFixture(analysis),
    candidateRunId: "candidate_finalized_chat_original",
    candidateAnalysisFingerprint: "fp:alias-stable",
  };
  const result = project({
    topic: "match_confidence",
    bundle: sourceBundle,
    candidateBinding: {
      candidateRunId: CANDIDATE_RUN_ID,
      rerunOfId: "candidate_finalized_chat_original",
      candidateAnalysisFingerprint: "fp:alias-stable",
    },
  });

  assert.equal(result.status, "success");
  if (result.status !== "success") return;
  assert.equal(result.projection.identity.candidateRunId, CANDIDATE_RUN_ID);
  assert.notEqual(
    result.projection.identity.candidateRunId,
    sourceBundle.candidateRunId,
  );

  const forged = project({
    topic: "match_confidence",
    bundle: sourceBundle,
    candidateBinding: {
      candidateRunId: CANDIDATE_RUN_ID,
      rerunOfId: "candidate_wrong_original",
      candidateAnalysisFingerprint: "fp:alias-stable",
    },
  });
  assert.equal(forged.status, "insufficient");
  if (forged.status === "insufficient") {
    assert.equal(forged.reasonCode, "scope_identity_mismatch");
  }
});

test("builds all eight topics only from exact scoped finalized artifacts", () => {
  const invested = analysisFixture({
    dealStatus: "invested",
    direction: "positive",
  });
  const cases = [{
    topic: "prior_reason" as const,
    expected: "Durable customer proof was incomplete",
  }, {
    topic: "belief_change" as const,
    expected: "positive",
  }, {
    topic: "strongest_counterargument" as const,
    expected: "does not establish durable retention",
  }, {
    topic: "match_confidence" as const,
    expected: "0.82",
  }, {
    topic: "framework_disagreement" as const,
    expected: "quality lens",
  }, {
    topic: "valuation" as const,
    expected: "24000000",
  }, {
    topic: "missing_evidence" as const,
    expected: "Current net revenue retention",
  }, {
    topic: "invested_action" as const,
    expected: "evaluate_follow_on",
    analysis: invested,
  }];

  for (const item of cases) {
    const result = project({
      topic: item.topic,
      analysis: item.analysis,
      bundle: item.analysis ? bundleFixture(item.analysis) : undefined,
    });
    assert.equal(result.status, "success", item.topic);
    if (result.status !== "success") continue;
    assert.equal(result.projection.topic, item.topic);
    assert.deepEqual(result.projection.identity, identity);
    assert.deepEqual(result.projection.evidenceFrame, evidenceFrame);
    assert.ok(result.projection.claims.length > 0);
    assert.ok(result.projection.claims.some(({ text }) =>
      text.includes(item.expected)
    ), `${item.topic} preserves ${item.expected}`);
    assert.ok(result.projection.claims.every(({ artifactRefs }) =>
      artifactRefs.length > 0
    ));
  }
});

test("keeps a sandbox prior decision permanently normalized and revision-linked", () => {
  const result = project({ topic: "prior_reason" });
  assert.equal(result.status, "success");
  if (result.status !== "success") return;
  const sample = result.projection.claims.find((claim) =>
    claim.artifactRefs.some(({ artifactType }) =>
      artifactType === "sample_decision_record"
    )
  );
  assert.ok(sample);
  assert.equal(sample.textClass, "normalized_statement");
  assert.match(sample.text, /^Sample decision record\. /);
  assert.deepEqual(sample.sourceRefs.map((source) => ({
    sourceId: source.sourceId,
    documentId: source.documentId,
    sourceRevisionId: source.sourceRevisionId,
    contentFingerprint: source.contentFingerprint,
  })), [{
    sourceId: "fixture_finalized_chat",
    documentId: "document_fixture_finalized_chat",
    sourceRevisionId: "revision_fixture_finalized_chat",
    contentFingerprint: `sha256:${"5".repeat(64)}`,
  }]);
});

test("sandbox Sample authority fails closed when finalized memory and normalized text drift", () => {
  const forgedMemory = structuredClone(analysisFixture()) as CompanyAnalysis;
  forgedMemory.investmentMemory.decisionReason =
    "A forged reason that is absent from the immutable Sample revision.";
  const memoryResult = project({
    topic: "prior_reason",
    analysis: forgedMemory,
    bundle: bundleFixture(forgedMemory),
  });
  assert.equal(memoryResult.status, "insufficient");
  if (memoryResult.status === "insufficient") {
    assert.equal(memoryResult.reasonCode, "source_lineage_incomplete");
  }

  const forgedSource = structuredClone(analysisFixture()) as CompanyAnalysis;
  const sample = forgedSource.sources.find(({ id }) =>
    id === "fixture_finalized_chat"
  );
  assert.ok(sample && "schemaVersion" in sample);
  if (!sample || !("schemaVersion" in sample)) return;
  sample.text = {
    status: "normalized_only",
    normalizedStatement:
      "Sample decision record. A forged normalized statement.",
  };
  const sourceResult = project({
    topic: "prior_reason",
    analysis: forgedSource,
    bundle: bundleFixture(forgedSource),
  });
  assert.equal(sourceResult.status, "insufficient");
  if (sourceResult.status === "insufficient") {
    assert.equal(sourceResult.reasonCode, "source_lineage_incomplete");
  }
});

test("rejects the same Sample decision record in product mode", () => {
  const result = project({
    topic: "prior_reason",
    requestMode: "product",
  });
  assert.equal(result.status, "insufficient");
  if (result.status !== "insufficient") return;
  assert.equal(result.topic, "prior_reason");
  assert.equal(result.reasonCode, "demo_fixture_forbidden");
});

test("product mode rejects Sample-derived topics even when the claim omits the Sample text", () => {
  const result = project({
    topic: "match_confidence",
    requestMode: "product",
  });
  assert.equal(result.status, "insufficient");
  if (result.status !== "insufficient") return;
  assert.equal(result.reasonCode, "demo_fixture_forbidden");
});

test("fails closed on mismatched scope and missing exact source revision lineage", () => {
  const foreign = project({
    topic: "match_confidence",
    identityOverride: { dealId: "deal_foreign" },
  });
  assert.equal(foreign.status, "insufficient");
  if (foreign.status === "insufficient") {
    assert.equal(foreign.reasonCode, "scope_identity_mismatch");
  }

  const analysis = structuredClone(analysisFixture()) as CompanyAnalysis;
  const counter = analysis.sources.find(({ id }) =>
    id === "source_finalized_counter"
  ) as CompanyAnalysis["sources"][number] & {
    sourceRevisionId: string | null;
  };
  counter.sourceRevisionId = null;
  const missingRevision = project({
    topic: "strongest_counterargument",
    analysis,
    bundle: bundleFixture(analysis),
  });
  assert.equal(missingRevision.status, "insufficient");
  if (missingRevision.status === "insufficient") {
    assert.equal(missingRevision.reasonCode, "source_lineage_incomplete");
  }
});

test("never upgrades normalized or persisted inference text into an exact quote", () => {
  const prior = project({ topic: "prior_reason" });
  const confidence = project({ topic: "match_confidence" });
  assert.equal(prior.status, "success");
  assert.equal(confidence.status, "success");
  if (prior.status !== "success" || confidence.status !== "success") return;

  assert.ok(prior.projection.claims.some(({ textClass }) =>
    textClass === "normalized_statement"
  ));
  assert.ok(prior.projection.claims.every(({ textClass }) =>
    textClass !== "exact_quote"
  ));
  assert.ok(confidence.projection.claims.every(({ textClass }) =>
    textClass === "persisted_inference"
  ));
});

test("returns explicit unavailable valuation blockers without inventing a number", () => {
  const analysis = analysisFixture();
  const bundle = structuredClone(bundleFixture(analysis));
  bundle.valuation = {
    ...bundle.valuation,
    status: "unavailable",
    scenarios: bundle.valuation.scenarios.map((scenario) => ({
      ...scenario,
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
    blockerCodes: ["valuation_basis_unknown"],
  };

  const result = project({ topic: "valuation", analysis, bundle });
  assert.equal(result.status, "success");
  if (result.status !== "success") return;
  assert.ok(result.projection.claims.some(({ text, textClass }) =>
    textClass === "persisted_inference"
    && text.includes("valuation_basis_unknown")
  ));
  assert.doesNotMatch(
    result.projection.claims.map(({ text }) => text).join("\n"),
    /18000000|24000000|32000000/,
  );
});

test("preserves both independent framework conclusions and their versions", () => {
  const result = project({ topic: "framework_disagreement" });
  assert.equal(result.status, "success");
  if (result.status !== "success") return;
  const text = result.projection.claims.map((claim) => claim.text).join("\n");
  assert.match(text, /framework_quality@1\.0\.0[^\n]*supportive/);
  assert.match(text, /framework_risk@2\.0\.0[^\n]*negative/);
  assert.doesNotMatch(text, /average|averaged|combined score/i);
});

test("keeps invested positive and negative typed actions distinct from formal underwriting", () => {
  const positive = analysisFixture({
    dealStatus: "invested",
    direction: "positive",
  });
  const negative = analysisFixture({
    dealStatus: "invested",
    direction: "negative",
  });
  const positiveResult = project({
    topic: "invested_action",
    analysis: positive,
    bundle: bundleFixture(positive),
  });
  const negativeResult = project({
    topic: "invested_action",
    analysis: negative,
    bundle: bundleFixture(negative),
  });
  assert.equal(positiveResult.status, "success");
  assert.equal(negativeResult.status, "success");
  if (positiveResult.status !== "success" || negativeResult.status !== "success") {
    return;
  }
  const positiveText = positiveResult.projection.claims.map(({ text }) => text)
    .join("\n");
  const negativeText = negativeResult.projection.claims.map(({ text }) => text)
    .join("\n");
  assert.match(
    positiveText,
    /evaluate_follow_on\{scope=portfolio, priority=standard, visibility=internal_only\}/,
  );
  assert.doesNotMatch(positiveText, /pause_follow_on|portfolio_risk_review/);
  assert.match(
    negativeText,
    /pause_follow_on\{scope=portfolio, priority=high, visibility=internal_only\}/,
  );
  assert.match(
    negativeText,
    /portfolio_risk_review\{scope=portfolio, priority=high, visibility=internal_only\}/,
  );
  assert.doesNotMatch(negativeText, /evaluate_follow_on/);
  for (const result of [positiveResult, negativeResult]) {
    const actionClaim = result.projection.claims.find((claim) =>
      claim.artifactRefs.some(({ artifactType }) =>
        artifactType === "action_policy"
      )
    );
    const decisionClaim = result.projection.claims.find((claim) =>
      claim.artifactRefs.some(({ artifactType }) =>
        artifactType === "decision_result"
      )
    );
    assert.ok(actionClaim);
    assert.ok(decisionClaim);
    assert.notEqual(actionClaim.claimId, decisionClaim.claimId);
  }
});

test("underwriting topics never fall back when the finalized bundle is absent", () => {
  for (const topic of [
    "framework_disagreement",
    "valuation",
    "missing_evidence",
  ] as const) {
    const result = project({ topic, bundle: null });
    assert.equal(result.status, "insufficient", topic);
    if (result.status === "insufficient") {
      assert.equal(result.reasonCode, "finalized_artifact_missing");
    }
  }
});

test("missing-evidence projection fails closed when coverage lacks its finalized v2 record", () => {
  const analysis = analysisFixture();
  const bundle = structuredClone(bundleFixture(analysis));
  bundle.actionDrafts = [];

  const result = project({ topic: "missing_evidence", analysis, bundle });
  assert.equal(result.status, "insufficient");
  if (result.status !== "insufficient") return;
  assert.equal(result.reasonCode, "finalized_artifact_missing");
});
