import assert from "node:assert/strict";
import test from "node:test";

import type { CandidateArtifactBundle } from "../../db/repositories/underwriting-artifacts";
import type { SourceRevision } from "../../db/repositories/source-registry";
import { buildSampleDecisionSourceRef } from "../../lib/belief-reversal/sample-decision-source";
import {
  FinalizedChatTopicSchema,
  createFinalizedChatClaim,
  createFinalizedChatProjection,
  type FinalizedChatTopic,
} from "../../lib/contracts/finalized-chat";
import type {
  BeliefChangeDirection,
  CompanyAnalysis,
  DealStatus,
} from "../../lib/contracts/domain";
import { renderFinalizedChatProjection } from "../../lib/chat/finalized-renderer";
import { buildFinalizedChatProjection } from "../../lib/chat/finalized-projection";
import { classifyFinalizedChatTopic } from "../../lib/chat/finalized-topic";
import {
  actionsForDealStatusAndDirection,
  renderRecommendedNextMove,
} from "../../lib/reports/action-policy";
import { toPublicCompanyAnalysis } from "../../lib/reports/public";
import { createActionDraftGenerator } from "../../lib/underwriting/action-drafts";
import { buildCandidateMissingEvidence } from "../../lib/underwriting/missing-evidence";
import {
  toCandidateUnderwritingDetail,
  toPublicActionDraft,
} from "../../lib/underwriting/read-model";
import {
  BeliefReversalQaRecordSchema,
  FINALIZED_CHAT_E2E_QUERIES,
  renderBeliefReversalQaRecord,
  verifyBeliefReversalCurrentColdReport,
  verifyBeliefReversalReportsAndChat,
} from "../helpers/belief-reversal-e2e-verifier";
import {
  exactSourceV2,
  marketEventV2,
} from "../helpers/source-evidence-v2";

const FINGERPRINT = `sha256:${"a".repeat(64)}`;
const WORKSPACE_ID = "workspace_task12_verifier";
const REPORT_ID = "report_task12_verifier";
const RUN_ID = "00000000-0000-4000-8000-000000000012";
const CREATED_AT = "2026-08-01T20:00:00.000Z";

const PINNED_CONTEXT = {
  state: "current" as const,
  schemaVersion: "run-evidence-context-v1" as const,
  evidenceMode: "pinned" as const,
  windowDays: 14 as const,
  anchorAt: "2026-08-02T06:59:59.000Z",
  windowStartAt: "2026-07-19T07:00:00.000Z",
  windowEndAt: "2026-08-02T06:59:59.000Z",
  windowTimezone: "America/Los_Angeles",
  snapshotId: "belief_reversal_2026_08_01" as const,
  snapshotFingerprint: `sha256:${"1".repeat(64)}`,
  contextFingerprint: `sha256:${"2".repeat(64)}`,
  displayLabel: "Demo evidence snapshot as of 2026-08-01",
  eventCount: 4,
  eventSetFingerprint: `sha256:${"3".repeat(64)}`,
  bindingFingerprint: `sha256:${"4".repeat(64)}`,
};

const REVIEWED_CASES = [{
  dealId: "deal_henry_ai_v1",
  companyName: "Henry AI",
  dealStatus: "passed",
  direction: "positive",
  score: 0.91,
}, {
  dealId: "deal_smallest_ai_v1",
  companyName: "Smallest.ai",
  dealStatus: "watchlist",
  direction: "positive",
  score: 0.86,
}, {
  dealId: "deal_hush_security_v1",
  companyName: "Hush Security",
  dealStatus: "invested",
  direction: "positive",
  score: 0.81,
}, {
  dealId: "deal_irregular_v1",
  companyName: "Irregular",
  dealStatus: "invested",
  direction: "negative",
  score: 0.76,
}] as const;

function analysisFixture(input: typeof REVIEWED_CASES[number]) {
  const stem = input.dealId.replace(/^deal_/u, "");
  const caseIndex = REVIEWED_CASES.indexOf(input);
  const priorActions = actionsForDealStatusAndDirection(input.dealStatus, "none");
  const actions = actionsForDealStatusAndDirection(
    input.dealStatus,
    input.direction,
  );
  const sample = buildSampleDecisionSourceRef({
    id: `fixture_${stem}`,
    documentId: `document_fixture_${stem}`,
    sourceRevisionId: `revision_fixture_${stem}`,
    contentFingerprint: `sha256:${"5".repeat(63)}${REVIEWED_CASES.indexOf(input)}`,
    occurredAt: "2026-06-10T17:00:00.000Z",
    retrievedAt: CREATED_AT,
    summary: "The sample committee retained the prior decision pending reviewed evidence.",
    decisionReason: "The prior evidence did not satisfy the reviewed condition.",
    concerns: ["Durability remained unverified."],
    revisitConditions: ["Revisit when reviewed public evidence changes the condition."],
  });
  const trigger = exactSourceV2(`source_${stem}_trigger`, {
    title: `${input.companyName} reviewed trigger`,
    canonicalUrl: `https://example.test/${stem}/trigger`,
    eventAt: "2026-07-31",
    eventAtPrecision: "date",
    publishedAt: "2026-07-31",
    publishedAtPrecision: "date",
    retrievedAt: CREATED_AT,
    retrievedAtPrecision: "timestamp",
    sourceRevisionId: `revision_${stem}_trigger`,
    contentFingerprint: `sha256:${"6".repeat(63)}${REVIEWED_CASES.indexOf(input)}`,
    text: {
      status: "verified_exact",
      verbatimExcerpt: "Reviewed evidence changed the prior condition.",
      normalizedStatement: "Reviewed evidence changed the prior decision condition.",
    },
  });
  const counter = exactSourceV2(`source_${stem}_counter`, {
    title: `${input.companyName} reviewed counterevidence`,
    canonicalUrl: `https://example.test/${stem}/counter`,
    eventAt: null,
    eventAtPrecision: null,
    publishedAt: null,
    publishedAtPrecision: null,
    retrievedAt: CREATED_AT,
    retrievedAtPrecision: "timestamp",
    evidenceRole: "counterevidence",
    sourceRevisionId: `revision_${stem}_counter`,
    contentFingerprint: `sha256:${"7".repeat(63)}${REVIEWED_CASES.indexOf(input)}`,
    text: {
      status: "verified_exact",
      verbatimExcerpt: "Durability remains unverified by this announcement.",
      normalizedStatement: "The reviewed announcement does not establish durability.",
    },
  });
  const event = marketEventV2(trigger, {
    id: `event_${stem}`,
    title: `${input.companyName} reviewed event`,
    eventAt: "2026-07-31",
    eventAtPrecision: "date",
    sources: [trigger, counter],
  });
  const unknown = {
    id: `semantic-field-${caseIndex.toString(16).padStart(24, "0")}`,
    schemaVersion: "deal-semantic-field-v1" as const,
    fieldId: "unknowns" as const,
    classification: "unknown" as const,
    reason: input.dealId === "deal_hush_security_v1"
      ? "Akamai and Kyndryl channel bookings, margins, and sell-through remain unavailable."
      : `Current reviewed company evidence remains unavailable for ${input.companyName}.`,
    externalLabel: input.dealId === "deal_hush_security_v1"
      ? "Current partner bookings, margins, and sell-through"
      : `Current evidence for ${input.companyName}`,
  };
  const confidence = input.score >= 0.8 ? "high" : "medium";
  return {
    id: `analysis_${stem}`,
    reportId: REPORT_ID,
    runId: RUN_ID,
    dealId: input.dealId,
    companyName: input.companyName,
    dealStatus: input.dealStatus,
    outcome: "belief_revised",
    confidence,
    score: input.score,
    verifiedSourceCount: 3,
    investmentMemory: {
      previousMeetingSummary:
        "The sample committee retained the prior decision pending reviewed evidence.",
      decisionReason:
        "The prior evidence did not satisfy the reviewed condition.",
      concerns: ["Durability remained unverified."],
      revisitConditions: ["Revisit when reviewed public evidence changes the condition."],
      lastEvaluatedAt: sample.eventAt,
      memoryIds: [`memory_${stem}`],
      sourceIds: [sample.id],
      fixtureIds: [sample.id],
      priorActions,
    },
    marketEvidence: {
      relationship: input.direction === "negative" ? "contradicts" : "satisfies",
      explanation: "The reviewed event changes the prior evidence condition.",
      eventIds: [event.id],
      events: [event],
      sourceIds: event.sources.map(({ id }) => id),
    },
    implications: { positive: ["Reviewed upside."], negative: ["Reviewed risk."] },
    beliefAssessment: {
      schemaVersion: "belief-change-assessment-v1",
      dealStatus: input.dealStatus,
      direction: input.direction,
      scoreBreakdown: {
        eventRelevance: input.score,
        dealRelevance: input.score,
        priorContextStrength: input.score,
        evidenceQuality: input.score,
        finalScore: input.score,
        confidence,
      },
      gateContext: {
        priorInteraction: {
          id: sample.id,
          occurredAt: sample.eventAt,
          sourceIds: [sample.id],
          revisitConditions: ["Revisit when reviewed public evidence changes the condition."],
          priorActions,
          provenance: "demo_fixture",
          label: "Sample decision record",
        },
        triggerEvent: {
          id: event.id,
          eventAt: event.eventAt,
          sourceIds: event.sources.map(({ id }) => id),
        },
        sources: [trigger, counter, sample],
      },
      gates: {
        chronology: {
          priorInteractionId: sample.id,
          priorInteractionAt: sample.eventAt,
          triggerEventId: event.id,
          triggerEventAt: event.eventAt,
          passed: true,
          failureReason: null,
        },
        revisitConditionMapping: {
          priorInteractionId: sample.id,
          revisitConditionIndex: 0,
          revisitConditionText: "Revisit when reviewed public evidence changes the condition.",
          triggerEventId: event.id,
          citedSourceIds: [trigger.id],
          passed: true,
          failureReason: null,
        },
        counterevidence: {
          statement: "Durability remains unverified by this announcement.",
          citedSourceIds: [counter.id],
          passed: true,
          failureReason: null,
        },
        actionDelta: {
          priorActions,
          proposedActions: actions,
          passed: true,
          failureReason: null,
        },
        allPassed: true,
      },
      actions,
    },
    recommendedNextMove: renderRecommendedNextMove(actions),
    companyBrief: {
      icSnapshot: [],
      traction: [],
      dealTerms: [],
      risks: [],
      decisionHistory: [{
        occurredAt: sample.eventAt,
        title: "Sample decision record",
        summary: "Sample decision record. The reviewed condition was not satisfied.",
        sourceIds: [sample.id],
      }],
      sourceLineage: [sample, trigger, counter],
      structuredFields: [unknown],
    },
    sources: [sample, trigger, counter],
    createdAt: CREATED_AT,
  } as unknown as CompanyAnalysis;
}

test("public report projection preserves compatibility text from typed belief actions", () => {
  const analysis = analysisFixture(REVIEWED_CASES[3]);
  const projected = toPublicCompanyAnalysis(analysis);

  assert.ok(projected?.beliefAssessment);
  assert.equal(
    projected.recommendedNextMove,
    renderRecommendedNextMove(projected.beliefAssessment.actions),
  );
});

function bundleFixture(
  analysis: CompanyAnalysis,
  candidateRunId: string,
): CandidateArtifactBundle {
  const stem = analysis.dealId.replace(/^deal_/u, "");
  const publicSources = analysis.sources.filter((source) =>
    "schemaVersion" in source && source.provenance !== "demo_fixture"
  );
  const sourceRevisionIds = publicSources.map((source) => source.sourceRevisionId!);
  const factId = `fact_${stem}`;
  const calculationId = `calculation_${stem}`;
  const criticalFieldId = analysis.dealId === "deal_hush_security_v1"
    ? "channel_economics"
    : `missing_${stem}`;
  const companyAnalysisUnknowns = (analysis.companyBrief.structuredFields ?? [])
    .filter((field) => field.classification === "unknown")
    .map((field) => ({
      fieldId: field.id,
      label: field.reason,
      externalLabel: field.externalLabel,
    }));
  const missingEvidence = buildCandidateMissingEvidence({
    criticalFieldIds: [criticalFieldId],
    structuredFields: analysis.companyBrief.structuredFields,
  });
  const decision = {
    id: `decision_${stem}`,
    analysisType: "final_synthesis" as const,
    companyQuality: "mixed" as const,
    priceAttractiveness: "unavailable" as const,
    fundFit: "pass" as const,
    decision: null,
    decisionCeiling: null,
    hardVeto: false,
    firedRules: [],
    blockingEvidenceItemIds: missingEvidence.map(({ fieldId }) => fieldId),
    claimEdges: [],
    confidence: "low" as const,
  };
  const actions = actionsForDealStatusAndDirection(
    analysis.dealStatus as DealStatus,
    analysis.beliefAssessment!.direction as BeliefChangeDirection,
  );
  const actionDrafts = createActionDraftGenerator({
    workspaceId: WORKSPACE_ID,
    now: () => new Date(CREATED_AT),
  }).generate({
    candidateRunId,
    decision,
    missingEvidence,
    dealStatus: analysis.dealStatus,
    beliefDirection: analysis.beliefAssessment!.direction,
    actions,
  });
  const valuationAvailable = false;
  const valuationScenarios = ["bear", "base", "bull"].map((name, index) => ({
    name: name as "bear" | "base" | "bull",
    valuation: valuationAvailable ? String(350_000_000 + index * 100_000_000) : null,
    calculationIds: valuationAvailable ? [calculationId] : [],
  }));
  return {
    candidateRunId,
    workspaceId: WORKSPACE_ID,
    dealId: analysis.dealId,
    candidateAnalysisFingerprint: `sha256:${"8".repeat(64)}`,
    evidencePack: {
      id: `pack_${stem}`,
      version: 1,
      workspaceId: WORKSPACE_ID,
      dealId: analysis.dealId,
      asOfDate: "2026-08-01",
      sourceRevisionIds,
      facts: [{
        id: factId,
        analysisType: "fact",
        provenanceOrigin: "public_source",
        field: "reviewed_event",
        value: "Reviewed event evidence",
        unit: null,
        currency: null,
        periodStart: null,
        periodEnd: null,
        publishedAt: "2026-07-31T00:00:00.000Z",
        eventAt: "2026-07-31T00:00:00.000Z",
        retrievedAt: CREATED_AT,
        sourceRevisionId: sourceRevisionIds[0]!,
        locator: {
          kind: "text_range",
          start: 0,
          end: 23,
          excerpt: "Reviewed event evidence",
        },
        sourceRole: "independent_third_party",
        assertionStatus: "verified",
        verificationMethod: "Reviewed exact revision",
        freshness: "current",
        acceptedForGate: true,
      }],
      assumptions: [{
        id: `assumption_${stem}`,
        analysisType: "assumption",
        provenanceOrigin: "recommended_policy",
        scenario: "base",
        field: "exit_multiple",
        value: "8",
        unit: "multiple",
        rationale: "Pinned policy assumption.",
        inputRefIds: [`valuation_policy_${stem}`],
        sensitivity: "high",
        requiresConfirmation: true,
      }],
      conflicts: [],
      coverage: {
        minimumModelInputsComplete: valuationAvailable,
        criticalEvidenceComplete: false,
        missingFieldIds: [criticalFieldId],
        blockingConflictIds: [],
        decisionCeiling: null,
        underwritingStatus: valuationAvailable ? "available" : "unavailable",
        reasonCodes: [
          "MISSING_CRITICAL_EVIDENCE",
          "MISSING_MINIMUM_MODEL_INPUTS",
        ],
      },
      createdAt: CREATED_AT,
    },
    context: {
      id: `context_${stem}`,
      contextVersion: "1",
      stage: "series_a",
      businessModel: "enterprise_ai",
      geography: "us",
      securityType: "preferred",
      asOfDate: "2026-08-01",
      criticalEvidenceProfileId: `critical_profile_${stem}`,
      benchmarkPackId: `benchmark_${stem}`,
      benchmarkCompatibility: "exact",
      valuationMethodPolicyId: `valuation_policy_${stem}`,
      decisionPolicyId: `decision_policy_${stem}`,
      frameworkPackId: `framework_pack_${stem}`,
    },
    scenarioModel: {
      id: `scenario_model_${stem}`,
      candidateRunId,
      formulaPolicyVersion: `valuation_policy_${stem}`,
      scenarios: ["bear", "base", "bull"].map((name) => ({ name, inputs: [] })),
      probabilityWeighted: false,
    },
    calculations: [{
      id: calculationId,
      analysisType: "calculation",
      formulaId: "market_comps_v1",
      formulaVersion: "1",
      inputRefs: [{ itemId: factId, value: "1", type: "fact" }],
      output: valuationAvailable ? "450000000" : "Unavailable",
      unit: "USD",
      currency: "USD",
      period: null,
      roundingPolicy: "half_even_display_only",
      computedAt: CREATED_AT,
      status: valuationAvailable ? "completed" : "insufficient_input",
    }],
    calculationClaimEdges: [],
    judgments: ["growth", "risk"].map((kind, index) => ({
      id: `judgment_${stem}_${kind}`,
      analysisType: "framework_judgment" as const,
      frameworkCardId: `framework_${kind}`,
      frameworkVersion: "1.0.0",
      applicability: "applicable" as const,
      conclusion: index === 0 ? "supportive" as const : "negative" as const,
      supportEvidenceItemIds: [factId],
      counterEvidenceItemIds: [],
      unusedEvidenceItemIds: [],
      strongestSupport: "Reviewed support.",
      strongestCounterargument: "Reviewed counterargument.",
      unknowns: missingEvidence.map(({ label }) => label),
      limitations: ["Public evidence remains incomplete."],
      confidence: {
        sourceReliability: "high" as const,
        evidenceStrength: "medium" as const,
        evidenceCoverage: "medium" as const,
        applicability: "high" as const,
        judgment: "medium" as const,
      },
      claimEdges: [],
      fingerprint: `sha256:${index === 0 ? "9".repeat(64) : "a".repeat(64)}`,
    })),
    disagreements: [{
      id: `disagreement_${stem}`,
      leftJudgmentId: `judgment_${stem}_growth`,
      rightJudgmentId: `judgment_${stem}_risk`,
      topic: "independent_framework_conflict",
      explanation: "The two saved framework judgments disagree.",
      evidenceItemIds: [factId],
    }],
    valuation: {
      id: `valuation_${stem}`,
      status: valuationAvailable ? "completed" : "unavailable",
      scenarios: valuationScenarios,
      currentAsk: valuationAvailable ? "450000000" : null,
      maximumAcceptablePreMoney: valuationAvailable ? "450000000" : null,
      initialOwnership: valuationAvailable ? "0.1" : null,
      postDilutionOwnership: valuationAvailable ? "0.08" : null,
      grossMoic: valuationAvailable ? "5" : null,
      grossIrr: valuationAvailable ? "0.35" : null,
      pricingPremium: valuationAvailable ? "0" : null,
      calculationIds: valuationAvailable ? [calculationId] : [],
      blockerCodes: valuationAvailable ? [] : ["MISSING_REPORTED_VALUATION"],
    },
    decision,
    narrative: `Persisted underwriting narrative for ${analysis.companyName}.`,
    actionDrafts,
    versionSnapshot: {
      fundPolicyId: `fund_policy_${stem}`,
      dealStatus: analysis.dealStatus,
      beliefDirection: analysis.beliefAssessment!.direction,
      canonicalActions: actions,
      actionPolicyVersion: "belief-action-policy-v1",
      draftPolicyVersion: "status-safe-action-draft-v2",
      benchmarkPackId: `benchmark_${stem}`,
      benchmarkEntryId: `benchmark_entry_${stem}`,
      benchmarkDefinitionFingerprint: `sha256:${"b".repeat(64)}`,
      frameworkPackId: `framework_pack_${stem}`,
      frameworkPackDefinitionFingerprint: `sha256:${"c".repeat(64)}`,
      routerVersion: "1",
      criticalEvidenceProfileId: `critical_profile_${stem}`,
      criticalEvidenceProfileDefinitionFingerprint: `sha256:${"d".repeat(64)}`,
      valuationMethodPolicyId: `valuation_policy_${stem}`,
      valuationMethodPolicyDefinitionFingerprint: `sha256:${"e".repeat(64)}`,
      decisionPolicyId: `decision_policy_${stem}`,
      decisionPolicyDefinitionFingerprint: `sha256:${"f".repeat(64)}`,
      referenceCatalogFingerprint: `sha256:${"0".repeat(64)}`,
      formulaVersions: ["market_comps_v1"],
      providerModel: "task12-fake-observations-only",
      promptVersion: "task12-v1",
      schemaVersion: "candidate-version-v1",
      settingsFingerprint: `sha256:${"1".repeat(64)}`,
      applicationCommit: "fca8617",
      companyAnalysisUnknowns,
    },
    claimEdges: [],
  } as unknown as CandidateArtifactBundle;
}

function qaRecordFixture() {
  return {
    schemaVersion: "belief-reversal-e2e-qa-v2" as const,
    recordedAt: "2026-08-03T20:00:00.000Z",
    commitSha: "fca8617",
    infrastructure: {
      postgresImage: "postgres:17.6" as const,
      postgrestImage: "postgrest/postgrest:v12.2.3" as const,
      postgresHost: "127.0.0.1" as const,
      postgrestHost: "127.0.0.1" as const,
      postgresPort: 54321,
      postgrestPort: 54322,
      databaseName: "vsee_belief_e2e_0123456789abcdef",
      terminalMigration: "0022_task9_finalization_authority",
      migrationCount: 23,
    },
    counts: {
      companies: 23,
      deals: 23,
      sourceDocuments: 55,
      sourceRevisions: 55,
      workspaceDocuments: 54,
      activeAssignments: 60,
      legacyEvidenceItems: 19,
      canonicalEvidenceItems: 37,
      sampleInteractions: 23,
      originalReadyInputs: 13,
      originalExpectedInputs: 13,
      qualifiedNotSelectedPresent: 0,
    },
    ranking: [
      ["deal_henry_ai_v1", "Henry AI", "passed", "positive"],
      ["deal_smallest_ai_v1", "Smallest.ai", "watchlist", "positive"],
      ["deal_hush_security_v1", "Hush Security", "invested", "positive"],
      ["deal_irregular_v1", "Irregular", "invested", "negative"],
    ].map(([dealId, companyName, dealStatus, direction], index) => ({
      rank: index + 1,
      dealId,
      companyName,
      dealStatus,
      direction,
      score: 0.9 - index * 0.05,
      confidence: "high" as const,
      allGatesPassed: true as const,
    })),
    terminalStates: [1, 2, 3, 4].map((index) => ({
      candidateRunId: `candidate_${index}`,
      status: "completed" as const,
      artifactState: "finalized" as const,
    })),
    replay: {
      snapshotIdentityEqual: true,
      snapshotIdEqual: true,
      snapshotFingerprintEqual: true,
      contextFingerprintEqual: true,
      eventSetFingerprintEqual: true,
      bindingFingerprintDistinct: true,
      scoreConfidenceGateActionRankEqual: true,
      semanticOutcomeEqual: true,
      newReasonerJudgments: 0,
      newXtraceMemories: 0,
      newXtraceLinks: 0,
      newSourceRevisions: 0,
      newSampleInteractions: 0,
    },
    reports: {
      reportId: "report_task12",
      runId: "00000000-0000-4000-8000-000000000012",
      evidenceMode: "pinned" as const,
      snapshotId: "belief_reversal_2026_08_01" as const,
      snapshotFingerprint: FINGERPRINT,
      verifiedDealCount: 4,
      allSourcesResolved: true,
    },
    chat: {
      topics: [
        "prior_reason",
        "belief_change",
        "strongest_counterargument",
        "match_confidence",
        "framework_disagreement",
        "valuation",
        "missing_evidence",
        "invested_action",
      ] as const,
      hushInvestedActionVerified: true,
      hushResearchActionCrosswalkVerified: true,
      irregularInvestedActionVerified: true,
      sameReportRunScope: true,
      isolationCountersUnchanged: true,
    },
    productionIsolation: {
      nodeEnvironment: "test" as const,
      loopbackOnly: true,
      remoteCalls: 0,
      productionWrites: 0,
      productionCredentialsRead: 0,
    },
    exitCode: 0 as const,
  };
}

test("QA record accepts only the complete secret-free Task 12 proof", () => {
  const parsed = BeliefReversalQaRecordSchema.parse(qaRecordFixture());
  assert.equal(parsed.counts.companies, 23);
  assert.equal(parsed.ranking.length, 4);
  assert.equal(parsed.exitCode, 0);
});

test("QA record rejects the false claim that run-scoped binding fingerprints are equal", () => {
  const invalidReplay = {
    ...qaRecordFixture(),
    replay: {
      ...qaRecordFixture().replay,
      bindingFingerprintEqual: true,
    },
  };
  delete (invalidReplay.replay as Partial<typeof invalidReplay.replay>)
    .bindingFingerprintDistinct;

  assert.throws(
    () => BeliefReversalQaRecordSchema.parse(invalidReplay),
    /bindingFingerprintDistinct|unrecognized|Unrecognized/u,
  );
});

test("QA renderer emits deterministic review JSON and never accepts secret fields", () => {
  const rendered = renderBeliefReversalQaRecord(qaRecordFixture());
  assert.deepEqual(JSON.parse(rendered), qaRecordFixture());
  assert.doesNotMatch(rendered, /password|jwt|service[_-]?role|secret/i);

  assert.throws(() => BeliefReversalQaRecordSchema.parse({
    ...qaRecordFixture(),
    jwtSecret: "must-not-be-recorded",
  }), /unrecognized|Unrecognized/i);
});

test("QA record rejects duplicated reviewed Deals even when ranks are contiguous", () => {
  const duplicate = qaRecordFixture();
  duplicate.ranking = duplicate.ranking.map((row) => ({
    ...row,
    dealId: "deal_henry_ai_v1",
    companyName: "Henry AI",
    dealStatus: "passed",
    direction: "positive",
  }));

  assert.throws(
    () => BeliefReversalQaRecordSchema.parse(duplicate),
    /exact four reviewed belief-reversal cases/u,
  );
});

test("fixed E2E Chat questions each classify to exactly their declared finalized topic", () => {
  assert.equal(FINALIZED_CHAT_E2E_QUERIES.length, 9);
  for (const query of FINALIZED_CHAT_E2E_QUERIES) {
    assert.deepEqual(classifyFinalizedChatTopic(query.question), {
      status: "matched",
      topic: query.topic,
    });
  }
});

function finalizedChatResponse(input: {
  topic: FinalizedChatTopic;
  analysis: CompanyAnalysis;
  candidateRunId: string;
  bundle: CandidateArtifactBundle;
}) {
  const identity = {
    workspaceId: WORKSPACE_ID,
    reportId: REPORT_ID,
    runId: RUN_ID,
    dealId: input.analysis.dealId,
    candidateRunId: input.candidateRunId,
  };
  const evidenceFrame = {
    state: "current" as const,
    evidenceMode: "pinned" as const,
    contextFingerprint: PINNED_CONTEXT.contextFingerprint,
    eventSetFingerprint: PINNED_CONTEXT.eventSetFingerprint,
    bindingFingerprint: PINNED_CONTEXT.bindingFingerprint,
    snapshotId: PINNED_CONTEXT.snapshotId,
    snapshotFingerprint: PINNED_CONTEXT.snapshotFingerprint,
  };
  const build = buildFinalizedChatProjection({
    topic: input.topic,
    requestMode: "public_sandbox",
    identity,
    evidenceFrame,
    analysis: input.analysis,
    candidateBinding: {
      candidateRunId: input.candidateRunId,
      rerunOfId: null,
      candidateAnalysisFingerprint: input.bundle.candidateAnalysisFingerprint,
    },
    bundle: input.bundle,
  });
  assert.equal(build.status, "success", JSON.stringify(build));
  if (build.status !== "success") {
    throw new Error("Fixture canonical projection did not build.");
  }
  return {
    ...renderFinalizedChatProjection(build.projection),
    memoryStatus: "disabled" as const,
    usedXTrace: false,
    scope: {
      reportId: REPORT_ID,
      runId: RUN_ID,
      dealId: input.analysis.dealId,
      companyName: input.analysis.companyName,
      evidenceContext: PINNED_CONTEXT,
    },
  };
}

function verificationFixture() {
  const analyses = REVIEWED_CASES.map(analysisFixture);
  const candidateIds = new Map(analyses.map((analysis) => [
    analysis.dealId,
    `candidate_${analysis.dealId.replace(/^deal_/u, "")}`,
  ]));
  const bundles = new Map(analyses.map((analysis) => {
    const candidateRunId = candidateIds.get(analysis.dealId)!;
    return [candidateRunId, bundleFixture(analysis, candidateRunId)];
  }));
  const originalAnalyses = Array.from({ length: 19 }, (_, index) => ({
    id: `analysis_original_${index + 1}`,
    reportId: REPORT_ID,
    runId: RUN_ID,
    dealId: `deal_original_${index + 1}`,
    companyName: `Original ${index + 1}`,
    dealStatus: "screening",
    outcome: "no_material_change",
    confidence: "low",
    score: 0,
  }));
  const report = {
    id: REPORT_ID,
    workspaceId: WORKSPACE_ID,
    runId: RUN_ID,
    createdAt: CREATED_AT,
    marketSummary: "Pinned reviewed belief-reversal report.",
    opportunities: [],
    analysisStatus: "completed",
    evidenceCoverage: {
      acceptedPublicEvents: 4,
      excludedPublicItems: 0,
      truncatedPublicEvents: 0,
      recalledDealCount: 4,
      unavailableDealCount: 0,
    },
    counts: {
      companyCount: 23,
      beliefRevised: 4,
      monitor: 0,
      noMaterialChange: 19,
      analysisUnavailable: 0,
    },
    priorityDealId: analyses[0]!.dealId,
    companyAnalyses: [...analyses, ...originalAnalyses],
    evidenceContext: PINNED_CONTEXT,
    underwritingBatch: {
      batchId: "batch_task12",
      status: "completed",
      queue: analyses.map((analysis, index) => ({
          batchId: "batch_task12",
          dealId: analysis.dealId,
          priorityRank: index + 1,
          status: "completed",
          candidateRunId: candidateIds.get(analysis.dealId)!,
          decision: null,
        })),
      underwritingStatusCounts: {
        queued: 0,
        running: 0,
        completed: 4,
        partial: 0,
        failed: 0,
      },
      legacyPinnedPriorityOrder: {
        adapter: "legacy-pinned-priority-order-v1",
        snapshotId: "belief_reversal_2026_08_01",
        entries: [
          ...analyses.map((analysis, index) => ({
            batchId: "batch_task12",
            dealId: analysis.dealId,
            historicalPriorityOrder: index + 1,
            historicalAdmissionStatus: "historically_admitted",
            historicalReason: "Historical belief-reversal admission.",
          })),
          ...originalAnalyses.map((analysis) => ({
            batchId: "batch_task12",
            dealId: analysis.dealId,
            historicalPriorityOrder: null,
            historicalAdmissionStatus: "historically_not_admitted",
            historicalReason: "Historical report did not admit this Deal.",
          })),
        ],
      },
    },
  };
  const revisions = new Map<string, SourceRevision>();
  for (const analysis of analyses) {
    for (const source of analysis.sources) {
      if (
        !("schemaVersion" in source)
        || source.sourceRevisionId === null
        || source.contentFingerprint === null
      ) continue;
      revisions.set(source.sourceRevisionId, {
        id: source.sourceRevisionId,
        workspaceId: WORKSPACE_ID,
        sourceId: source.id,
        revision: 1,
        contentHash: source.contentFingerprint,
        objectKey: `task12/${source.sourceRevisionId}.json`,
        objectVersion: "v1",
        contentType: "application/json",
        extractorId: "task12-extractor",
        extractorVersion: "1",
        extractedAt: CREATED_AT,
        supersedesRevisionId: null,
        createdAt: CREATED_AT,
      });
    }
  }
  const counters = {
    liveMarketCalls: 0,
    xtrace: {
      ingestCalls: 60,
      searchCalls: 8,
      deleteCalls: 0,
      exactParentCount: 60,
      memoryCount: 60,
    },
    model: {
      matchingCalls: 1,
      frameworkCalls: 8,
      unexpectedCalls: 0,
    },
    durable: {
      scanRuns: 2,
      scanRunSteps: 14,
      sourceRevisions: 55,
      sampleInteractions: 23,
      reasonerJudgments: 1,
      xtraceIngestIntents: 60,
      xtraceMemoryLinks: 60,
    },
    route: {
      rateLimitCalls: 0,
      rateLimitDbRequests: 0,
      remoteNetworkAttempts: 0,
    },
  };
  const input = {
    workspaceId: WORKSPACE_ID,
    reportId: REPORT_ID,
    runId: RUN_ID,
    async readReport() {
      return structuredClone(report);
    },
    async readUnderwritingDetail({ dealId }: { dealId: string }) {
      const candidateRunId = candidateIds.get(dealId)!;
      return toCandidateUnderwritingDetail(bundles.get(candidateRunId)!);
    },
    async readArtifact({ candidateRunId }: { candidateRunId: string }) {
      return structuredClone(bundles.get(candidateRunId) ?? null);
    },
    async readActionDrafts({ candidateRunId }: { candidateRunId: string }) {
      return (bundles.get(candidateRunId)?.actionDrafts ?? [])
        .map(toPublicActionDraft);
    },
    async resolveSourceRevision({ sourceRevisionId }: { sourceRevisionId: string }) {
      return structuredClone(revisions.get(sourceRevisionId) ?? null);
    },
    async askFinalizedChat(request: {
      question: string;
      reportId: string;
      runId: string;
      dealId: string;
    }) {
      const query = FINALIZED_CHAT_E2E_QUERIES.find((candidate) =>
        candidate.question === request.question && candidate.dealId === request.dealId
      );
      assert.ok(query);
      counters.route.rateLimitCalls += 1;
      counters.route.rateLimitDbRequests += 1;
      const analysis = analyses.find(({ dealId }) => dealId === request.dealId)!;
      return finalizedChatResponse({
        topic: query.topic,
        analysis,
        candidateRunId: candidateIds.get(request.dealId)!,
        bundle: bundles.get(candidateIds.get(request.dealId)!)!,
      });
    },
    readIsolationCounters() {
      return structuredClone(counters);
    },
  };
  return { input, report, analyses, bundles, revisions, counters };
}

test("verifier reads the exact four PostgreSQL-backed report cases through full underwriting, drafts, sources, and finalized Chat", async () => {
  const fixture = verificationFixture();
  const result = await verifyBeliefReversalReportsAndChat(fixture.input);

  assert.deepEqual(result.ranking.map(({ dealId, rank }) => ({ dealId, rank })), [
    { dealId: "deal_henry_ai_v1", rank: 1 },
    { dealId: "deal_smallest_ai_v1", rank: 2 },
    { dealId: "deal_hush_security_v1", rank: 3 },
    { dealId: "deal_irregular_v1", rank: 4 },
  ]);
  assert.equal(result.chatQueryCount, 9);
  assert.deepEqual(result.chatTopics, [
    "prior_reason",
    "belief_change",
    "strongest_counterargument",
    "match_confidence",
    "framework_disagreement",
    "valuation",
    "missing_evidence",
    "invested_action",
  ]);
  assert.ok(result.resolvedSourceRevisionIds.length >= 12);
  assert.equal(result.hushInvestedActionVerified, true);
  assert.equal(result.hushResearchActionCrosswalkVerified, true);
  assert.equal(result.irregularInvestedActionVerified, true);
  assert.deepEqual(fixture.counters, {
    liveMarketCalls: 0,
    xtrace: {
      ingestCalls: 60,
      searchCalls: 8,
      deleteCalls: 0,
      exactParentCount: 60,
      memoryCount: 60,
    },
    model: {
      matchingCalls: 1,
      frameworkCalls: 8,
      unexpectedCalls: 0,
    },
    durable: {
      scanRuns: 2,
      scanRunSteps: 14,
      sourceRevisions: 55,
      sampleInteractions: 23,
      reasonerJudgments: 1,
      xtraceIngestIntents: 60,
      xtraceMemoryLinks: 60,
    },
    route: {
      rateLimitCalls: 9,
      rateLimitDbRequests: 9,
      remoteNetworkAttempts: 0,
    },
  });
});

function currentReportFixture() {
  const screeningDeals = [
    "deal_centralize_v1",
    "deal_chipagents_v1",
    "deal_sent_v1",
    "deal_cascade_v1",
    "deal_cordant_v1",
    "deal_empirical_security_v1",
    "deal_freight_hero_v1",
  ];
  const revisedDeals = REVIEWED_CASES.map(({ dealId }) => dealId);
  const noChangeDeals = Array.from(
    { length: 19 },
    (_, index) => `deal_original_${index + 1}`,
  );
  const liveContext = {
    ...PINNED_CONTEXT,
    evidenceMode: "live" as const,
    anchorAt: "2026-08-03T12:00:00.000Z",
    windowStartAt: "2026-07-20T12:00:00.000Z",
    windowEndAt: "2026-08-03T12:00:00.000Z",
    snapshotId: null,
    snapshotFingerprint: null,
    displayLabel: "Live 14-day market scan as of 2026-08-03",
    eventCount: 11,
  };
  const buildAnalysis = (
    dealId: string,
    outcome: "belief_revised" | "monitor" | "no_material_change",
    index: number,
  ) => {
    const screening = screeningDeals.includes(dealId);
    const dealStatus = screening
      ? "screening"
      : dealId.startsWith("deal_original_") && index % 3 === 0
      ? "evaluating"
      : "watchlist";
    return {
      dealId,
      companyName: dealId,
      dealStatus,
      outcome,
      confidence: outcome === "belief_revised" ? "high" : "low",
      score: outcome === "belief_revised" ? 0.95 - index * 0.01 : 0.2,
      currentRunAudit: {
        schemaVersion: "company-analysis-current-run-audit-v1",
        workspaceId: WORKSPACE_ID,
        stableDealId: dealId,
        priorDealStatus: dealStatus,
        dealUniverseId: `deal_universe_${RUN_ID}`,
        dealUniverseFingerprint: `sha256:${"6".repeat(64)}`,
        evidenceContextFingerprint: liveContext.contextFingerprint,
        evidenceBindingFingerprint: liveContext.bindingFingerprint,
        priorMemory: { kind: screening ? "screening" : "investment" },
        outcome,
      },
    };
  };
  const companyAnalyses = [
    ...revisedDeals.map((dealId, index) =>
      buildAnalysis(dealId, "belief_revised", index)
    ),
    ...screeningDeals.map((dealId, index) =>
      buildAnalysis(dealId, "monitor", index)
    ),
    ...noChangeDeals.map((dealId, index) =>
      buildAnalysis(dealId, "no_material_change", index)
    ),
  ];
  return {
    id: REPORT_ID,
    workspaceId: WORKSPACE_ID,
    runId: RUN_ID,
    analysisStatus: "completed",
    counts: {
      companyCount: 30,
      beliefRevised: 4,
      monitor: 7,
      noMaterialChange: 19,
      analysisUnavailable: 0,
      eligibleDealCount: 30,
      companyAnalysisCount: 30,
      beliefRevisedCount: 4,
      monitorCount: 7,
      noMaterialChangeCount: 19,
      analysisUnavailableCount: 0,
      underwritingCandidateCount: 4,
      underwritingQueuedCount: 0,
      underwritingRunningCount: 0,
      underwritingCompletedCount: 4,
      underwritingPartialCount: 0,
      underwritingFailedCount: 0,
    },
    companyAnalyses,
    evidenceContext: liveContext,
    underwritingBatch: {
      batchId: "batch_current_30",
      status: "completed",
      queue: revisedDeals.map((dealId, index) => ({
        batchId: "batch_current_30",
        dealId,
        priorityRank: index + 1,
        status: "completed",
        candidateRunId: `candidate_${dealId}`,
        decision: null,
      })),
      underwritingStatusCounts: {
        queued: 0,
        running: 0,
        completed: 4,
        partial: 0,
        failed: 0,
      },
    },
  };
}

test("current report verifier accepts 30 analyses, 4/7/19/0 outcomes, and a four-job priority queue without Top-5 semantics", () => {
  const fixture = currentReportFixture();
  const result = verifyBeliefReversalCurrentColdReport(fixture, {
    beliefRevised: 4,
    monitor: 7,
    noMaterialChange: 19,
    analysisUnavailable: 0,
    screeningOutcomeByDeal: Object.fromEntries(
      fixture.companyAnalyses
        .filter(({ dealStatus }) => dealStatus === "screening")
        .map(({ dealId }) => [dealId, "monitor"]),
    ),
  });

  assert.deepEqual(result.priorityOrder.map(({ dealId, priorityRank }) => ({
    dealId,
    priorityRank,
  })), REVIEWED_CASES.map(({ dealId }, index) => ({
    dealId,
    priorityRank: index + 1,
  })));
  assert.equal(result.screeningMonitorCount, 7);
});

test("current report verifier rejects 23-only output, candidate truncation, and a legacy adapter on a live run", () => {
  const oldOnly = currentReportFixture();
  oldOnly.companyAnalyses = oldOnly.companyAnalyses.slice(0, 23);
  assert.throws(
    () => verifyBeliefReversalCurrentColdReport(oldOnly),
    /exactly 30 CompanyAnalyses/u,
  );

  const truncated = currentReportFixture();
  truncated.underwritingBatch.queue.pop();
  assert.throws(
    () => verifyBeliefReversalCurrentColdReport(truncated),
    /every and only belief revision/u,
  );

  const contaminated = currentReportFixture() as ReturnType<
    typeof currentReportFixture
  > & { underwritingBatch: { legacyPinnedPriorityOrder?: unknown } };
  contaminated.underwritingBatch.legacyPinnedPriorityOrder = {};
  assert.throws(
    () => verifyBeliefReversalCurrentColdReport(contaminated),
    /legacy pinned priority adapter/u,
  );
});

test("verifier rejects a replay-consistent report outside the exact reviewed pinned window", async () => {
  const fixture = verificationFixture();
  const wrongWindow = {
    ...PINNED_CONTEXT,
    windowStartAt: "2026-07-18T07:00:00.000Z",
  };
  fixture.report.evidenceContext = wrongWindow;
  const ask = fixture.input.askFinalizedChat;
  fixture.input.askFinalizedChat = async (request) => {
    const response = await ask(request);
    return {
      ...response,
      scope: {
        ...response.scope,
        evidenceContext: wrongWindow,
      },
    };
  };

  await assert.rejects(
    verifyBeliefReversalReportsAndChat(fixture.input),
    /exact reviewed pinned evidence window/i,
  );
});

test("verifier rejects a priority order that was not derived from persisted scores", async () => {
  const fixture = verificationFixture();
  fixture.report.underwritingBatch.queue[0]!.priorityRank = 2;
  fixture.report.underwritingBatch.legacyPinnedPriorityOrder.entries[0]!
    .historicalPriorityOrder = 2;

  await assert.rejects(
    verifyBeliefReversalReportsAndChat(fixture.input),
    /priority order is not score-derived/u,
  );
});

test("verifier rejects an underwriting DTO that is not the public artifact projection", async () => {
  const fixture = verificationFixture();

  await assert.rejects(
    verifyBeliefReversalReportsAndChat({
      ...fixture.input,
      async readUnderwritingDetail() {
        return { candidateRunId: "forged_candidate" };
      },
    }),
    /Underwriting DTO is not the public projection/u,
  );
});

test("verifier requires the explicit unavailable decision-ceiling contract", async () => {
  const fixture = verificationFixture();
  const bundle = fixture.bundles.values().next().value!;
  bundle.evidencePack.coverage.reasonCodes = ["MISSING_CRITICAL_EVIDENCE"];

  await assert.rejects(
    verifyBeliefReversalReportsAndChat(fixture.input),
    /explicit unavailable decision ceiling/u,
  );
});

test("verifier accepts the exact core-only Advance ceiling while the formal decision remains unavailable", async () => {
  const fixture = verificationFixture();
  const bundle = [...fixture.bundles.values()].find(
    ({ dealId }) => dealId === "deal_irregular_v1",
  )!;
  bundle.evidencePack.coverage = {
    minimumModelInputsComplete: true,
    criticalEvidenceComplete: false,
    missingFieldIds: ["arr", "burn", "cash", "runway"],
    blockingConflictIds: [],
    decisionCeiling: "Advance",
    underwritingStatus: "available",
    reasonCodes: [
      "MISSING_CRITICAL_EVIDENCE",
      "CORE_ONLY_ANALYSIS_CEILING",
    ],
  };

  await assert.doesNotReject(
    verifyBeliefReversalReportsAndChat(fixture.input),
  );
  assert.equal(bundle.decision.decision, null);
  assert.equal(bundle.decision.decisionCeiling, null);
});

test("verifier rejects any referenced source revision that fails exact workspace resolution", async () => {
  const fixture = verificationFixture();
  fixture.input.resolveSourceRevision = async () => null;

  await assert.rejects(
    verifyBeliefReversalReportsAndChat(fixture.input),
    /source revision .* does not resolve/u,
  );
});

test("verifier rejects finalized Chat when a response escapes the requested report/run scope", async () => {
  const fixture = verificationFixture();
  const ask = fixture.input.askFinalizedChat;
  fixture.input.askFinalizedChat = async (request) => {
    const response = await ask(request);
    return {
      ...response,
      scope: {
        ...response.scope,
        runId: "00000000-0000-4000-8000-000000000099",
      },
    };
  };

  await assert.rejects(
    verifyBeliefReversalReportsAndChat(fixture.input),
    /Finalized Chat scope mismatch/u,
  );
});

for (const mutation of ["text", "field_path"] as const) {
  test(`verifier rejects a valid-but-wrong canonical Chat ${mutation} for every topic`, async () => {
    for (const topic of FinalizedChatTopicSchema.options) {
      const fixture = verificationFixture();
      const query = FINALIZED_CHAT_E2E_QUERIES.find((item) =>
        item.topic === topic
      )!;
      const ask = fixture.input.askFinalizedChat;
      let forged = false;
      fixture.input.askFinalizedChat = async (request) => {
        const route = await ask(request);
        if (
          forged
          || request.question !== query.question
          || request.dealId !== query.dealId
        ) return route;
        forged = true;
        const original = route.projection.claims[0]!;
        const claim = createFinalizedChatClaim({
          identity: route.projection.identity,
          topic: route.projection.topic,
          text: mutation === "text"
            ? `Forged persisted ${topic} answer.`
            : original.text,
          textClass: mutation === "text"
            ? "persisted_inference"
            : original.textClass,
          artifactRefs: mutation === "field_path"
            ? [{
              ...original.artifactRefs[0]!,
              fieldPath: "forgedField",
            }, ...original.artifactRefs.slice(1)]
            : original.artifactRefs,
          sourceRefs: mutation === "text" ? [] : original.sourceRefs,
        });
        const projection = createFinalizedChatProjection({
          topic: route.projection.topic,
          identity: route.projection.identity,
          evidenceFrame: route.projection.evidenceFrame,
          claims: [claim, ...route.projection.claims.slice(1)],
        });
        return {
          ...route,
          ...renderFinalizedChatProjection(projection),
        };
      };

      await assert.rejects(
        verifyBeliefReversalReportsAndChat(fixture.input),
        new RegExp(
          `canonical finalized projection for ${topic}/${query.dealId}`,
          "u",
        ),
        `${mutation}/${topic}`,
      );
    }
  });
}

for (const tupleField of ["sourceId", "documentId", "text"] as const) {
  test(`verifier rejects forged Chat ${tupleField} with an authentic revision and hash`, async () => {
    const fixture = verificationFixture();
    const query = FINALIZED_CHAT_E2E_QUERIES.find(({ topic }) =>
      topic === "prior_reason"
    )!;
    const ask = fixture.input.askFinalizedChat;
    let forged = false;
    fixture.input.askFinalizedChat = async (request) => {
      const route = await ask(request);
      if (forged || request.question !== query.question) return route;
      forged = true;
      const original = route.projection.claims[0]!;
      const source = original.sourceRefs[0]!;
      assert.equal(source.text.status, "normalized_only");
      assert.equal(source.canonicalSource.text.status, "normalized_only");
      const forgedText = {
        status: "normalized_only" as const,
        normalizedStatement:
          "Sample decision record. Forged text under an authentic revision and hash.",
      };
      const forgedSource = {
        ...source,
        sourceId: tupleField === "sourceId"
          ? `${source.sourceId}_forged`
          : source.sourceId,
        documentId: tupleField === "documentId"
          ? `${source.documentId}_forged`
          : source.documentId,
        text: tupleField === "text" ? forgedText : source.text,
        canonicalSource: {
          ...source.canonicalSource,
          id: tupleField === "sourceId"
            ? `${source.sourceId}_forged`
            : source.canonicalSource.id,
          documentId: tupleField === "documentId"
            ? `${source.documentId}_forged`
            : source.canonicalSource.documentId,
          text: tupleField === "text"
            ? forgedText
            : source.canonicalSource.text,
        },
      };
      const claim = createFinalizedChatClaim({
        identity: route.projection.identity,
        topic: route.projection.topic,
        text: tupleField === "text" ? forgedText.normalizedStatement : original.text,
        textClass: original.textClass,
        artifactRefs: original.artifactRefs,
        sourceRefs: [forgedSource, ...original.sourceRefs.slice(1)],
      });
      const projection = createFinalizedChatProjection({
        topic: route.projection.topic,
        identity: route.projection.identity,
        evidenceFrame: route.projection.evidenceFrame,
        claims: [claim, ...route.projection.claims.slice(1)],
      });
      return { ...route, ...renderFinalizedChatProjection(projection) };
    };

    await assert.rejects(
      verifyBeliefReversalReportsAndChat(fixture.input),
      /canonical finalized projection for prior_reason/u,
    );
  });
}

test("verifier rejects any browse, XTrace, rerun, mutation, or model side effect", async () => {
  const fixture = verificationFixture();
  const ask = fixture.input.askFinalizedChat;
  fixture.input.askFinalizedChat = async (request) => {
    const response = await ask(request);
    fixture.counters.xtrace.searchCalls += 1;
    return response;
  };

  await assert.rejects(
    verifyBeliefReversalReportsAndChat(fixture.input),
    /live provider\/database isolation changed/u,
  );
});
