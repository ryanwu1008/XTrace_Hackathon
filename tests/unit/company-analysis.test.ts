import assert from "node:assert/strict";
import test from "node:test";

import type {
  DealMemoryBundle,
} from "../../lib/contracts/domain";
import { parseSourceRefV2Read } from "../../lib/contracts/legacy-evidence-adapter";
import { buildPreloadedDealMemoryBundles } from "../../lib/corpus/service";
import { interactionSourceV2 } from "../../lib/matching/context";
import {
  createMatchingService,
  type GroundedMatch,
} from "../../lib/matching/service";
import { isEligibleBeliefRevision } from "../../lib/matching/ranking";
import { actionsForDealStatusAndDirection } from "../../lib/reports/action-policy";
import {
  buildCompanyAnalyses,
  countCompanyAnalyses,
} from "../../lib/reports/company-analysis";
import type { MemoryContext } from "../../lib/xtrace/service";
import {
  exactSourceV2,
  marketEventV2,
  normalizedSourceV2,
  TEST_SHA256_A,
} from "../helpers/source-evidence-v2";

const REPORT_ID = "report_1";
const RUN_ID = "00000000-0000-4000-8000-000000000001";
const CREATED_AT = "2026-07-24T12:00:00.000Z";

function sampleResearchScreeningSource() {
  return normalizedSourceV2("sample_research_screening_monitor", {
    provenance: "source_document",
    title: "Sample research screening record",
    canonicalUrl: null,
    documentId: "document_sample_research_screening_monitor",
    publisher: "Internal Research Registry",
    providerId: "belief-reversal-research-seed-v1",
    eventAt: "2026-08-01T12:00:00.000Z",
    eventAtPrecision: "timestamp",
    publishedAt: null,
    publishedAtPrecision: null,
    retrievedAt: "2026-08-01T12:00:00.000Z",
    retrievedAtPrecision: "timestamp",
    updatedAt: null,
    updatedAtPrecision: null,
    entityKeys: ["screening-monitor"],
    sourceClass: "internal_decision_record",
    sourceAuthority: "primary",
    evidenceRole: "context",
    sourceRevisionId: "revision_sample_research_screening_monitor",
    locator: { kind: "json_pointer", pointer: "/record" },
    contentFingerprint: TEST_SHA256_A,
    text: {
      status: "normalized_only",
      normalizedStatement: [
        "Sample research screening record.",
        "Synthetic research-only context; no meeting or VC interaction occurred.",
        "Disposition: qualified_not_selected.",
        "Qualification: The company and relevant public evidence are verified.",
        "Not selected reason: Evidence does not yet support a changed action.",
        "Reconsideration conditions: Obtain stronger customer and traction evidence.",
      ].join(" "),
    },
  });
}

function semanticBundle(input: {
  sourceIds?: readonly [string, string];
} = {}): {
  bundle: DealMemoryBundle;
  structuredFields: NonNullable<DealMemoryBundle["facts"][number]["semanticFields"]>;
} {
  const [primaryId, corroboratingId] = input.sourceIds ?? [
    "semantic_primary_source",
    "semantic_corroborating_source",
  ];
  const primary = normalizedSourceV2(primaryId, {
    title: "Reviewed company profile",
    text: {
      status: "normalized_only",
      normalizedStatement: "Structured Metrics is a reviewed Series A company.",
    },
  });
  const corroborating = normalizedSourceV2(corroboratingId, {
    title: "Corroborating company profile",
    text: {
      status: "normalized_only",
      normalizedStatement: "A second source reports a conflicting founding year.",
    },
  });
  const structuredFields: NonNullable<
    DealMemoryBundle["facts"][number]["semanticFields"]
  > = [{
    id: "semantic-field-111111111111111111111111",
    schemaVersion: "deal-semantic-field-v1",
    fieldId: "stage",
    classification: "fact",
    availability: "available",
    value: "Series A",
    basis: "company-reported",
    asOfDate: "2026-07-29",
    sourceIds: [primary.id],
  }, {
    id: "semantic-field-222222222222222222222222",
    schemaVersion: "deal-semantic-field-v1",
    fieldId: "arr",
    classification: "unavailable",
    availability: "unavailable",
    reason: "No public ARR disclosure was found.",
    checkedSourceIds: [primary.id, corroborating.id],
  }, {
    id: "semantic-field-333333333333333333333333",
    schemaVersion: "deal-semantic-field-v1",
    fieldId: "founding_date",
    classification: "conflicting",
    observations: [{ value: "2022", sourceId: primary.id }, {
      value: "2023",
      sourceId: corroborating.id,
    }],
  }, {
    id: "semantic-field-444444444444444444444444",
    schemaVersion: "deal-semantic-field-v1",
    fieldId: "security_type",
    classification: "assumption",
    value: "preferred",
    basis: "assumption",
    requiresConfirmation: true,
    assumptionPolicyVersion: "belief-reversal-demo-context-v1",
    rationale: "Scenario policy requires a security type.",
    sourceBoundary: "This is not a company-reported term.",
  }, {
    id: "semantic-field-555555555555555555555555",
    schemaVersion: "deal-semantic-field-v1",
    fieldId: "unknowns",
    classification: "unknown",
    reason: "Current net retention is unknown.",
    externalLabel: "Current retention evidence",
  }];
  return {
    bundle: {
      dealId: "deal_structured_metrics",
      companyName: "Structured Metrics",
      status: "watchlist",
      facts: [{
        text: "Structured Metrics is a reviewed Series A company.",
        sources: [primary],
        semanticFields: structuredFields,
      }, {
        text: "A second source reports a conflicting founding year.",
        sources: [corroborating],
      }],
      interactions: [],
    },
    structuredFields,
  };
}

function buildSingleCompanyAnalysis(bundle: DealMemoryBundle) {
  return buildCompanyAnalyses({
    reportId: REPORT_ID,
    runId: RUN_ID,
    createdAt: CREATED_AT,
    bundles: [bundle],
    contextsByDeal: new Map([[bundle.dealId, [{
      dealId: bundle.dealId,
      memoryId: `memory_${bundle.dealId}`,
      memoryType: "fact",
      text: bundle.facts.map((fact) => fact.text).join("\n"),
      score: 1,
      provenance: "source_document",
      sourceIds: bundle.facts.flatMap((fact) =>
        fact.sources.map((source) => source.id)
      ),
      fixtureIds: [],
    }]]]),
    recallFailures: new Set(),
    groundedMatches: [],
  })[0];
}

function contextsForEveryDeal(
  bundles: DealMemoryBundle[],
): Map<string, MemoryContext[]> {
  return new Map(bundles.map((bundle) => [
    bundle.dealId,
    [{
      dealId: bundle.dealId,
      memoryId: `memory_${bundle.dealId}`,
      memoryType: "fact",
      text: `Verified investment memory for ${bundle.companyName}.`,
      score: 0.9,
      provenance: "source_document",
      sourceIds: bundle.facts.flatMap((fact) =>
        fact.sources.map((source) => source.id)
      ),
      fixtureIds: bundle.interactions.map((interaction) => interaction.id),
    }],
  ]));
}

function groundedMatch(
  bundle: DealMemoryBundle,
  confidence: GroundedMatch["confidence"],
): GroundedMatch {
  const marketSource = normalizedSourceV2(`market_${bundle.dealId}`, {
    title: `${bundle.companyName} market evidence`,
    canonicalUrl: `https://example.com/${bundle.dealId}`,
    publisher: "Example",
    providerId: "example-feed",
    entityKeys: [],
    text: {
      status: "normalized_only",
      normalizedStatement: `${bundle.companyName} sector activity increased.`,
    },
  });
  assert.equal(marketSource.text.status, "normalized_only");
  if (marketSource.text.status !== "normalized_only") {
    throw new Error("Grounded-match fixture requires normalized market text.");
  }
  const dealSource = parseSourceRefV2Read(bundle.facts[0].sources[0]);
  const syntheticSource = interactionSourceV2(bundle.interactions[0]);
  const score = confidence === "high" ? 0.82 : confidence === "medium"
    ? 0.65
    : 0.42;
  return {
    dealId: bundle.dealId,
    dealStatus: bundle.status,
    outcome: confidence === "low" ? "monitor" : "belief_revised",
    confidence,
    score,
    whyNow: marketSource.text.normalizedStatement,
    previousContext: bundle.interactions[0].decisionReason,
    implications: {
      positive: ["The market evidence warrants renewed internal review."],
      negative: [],
    },
    nextStep:
      "Review the cited evidence and decide whether further internal diligence is warranted.",
    relationship: "satisfies",
    events: [marketEventV2(marketSource, {
      id: `event_${bundle.dealId}`,
      title: marketSource.title,
      eventType: "funding",
    })],
    sources: [marketSource, dealSource, syntheticSource],
    demoFixtureIds: [syntheticSource.id],
    claimSupport: [{
      text: marketSource.text.normalizedStatement,
      kind: "normalized_non_quote",
      sourceIds: [marketSource.id],
    }],
  };
}

function baseInput() {
  const bundles = buildPreloadedDealMemoryBundles();
  return {
    reportId: REPORT_ID,
    runId: RUN_ID,
    createdAt: CREATED_AT,
    bundles,
    contextsByDeal: contextsForEveryDeal(bundles),
    recallFailures: new Set<string>(),
    groundedMatches: [] as GroundedMatch[],
  };
}

function withCurrentRunAuthority(input: ReturnType<typeof baseInput>) {
  return {
    ...input,
    currentRunAuthority: {
      workspaceId: "workspace_demo",
      dealUniverseId: "belief_reversal_deal_universe_2026_08_03_v1",
      dealUniverseFingerprint: `sha256:${"1".repeat(64)}`,
      evidenceContextFingerprint: `sha256:${"2".repeat(64)}`,
      evidenceBindingFingerprint: `sha256:${"3".repeat(64)}`,
      consideredMarketEventIds: ["event_considered_a", "event_considered_b"],
      dealsById: new Map(input.bundles.map((bundle, index) => [
        bundle.dealId,
        {
          companyId: `company_${index + 1}`,
          priorDealStatus: bundle.status,
          analysisEligibleAt: "2026-08-03T12:00:00.000Z",
          activeSourceRevisionIds: [`revision_${index + 1}`],
          activeParentFingerprint: `sha256:${(index + 4).toString(16).padStart(64, "0")}`,
        },
      ])),
      recallFailureReasons: new Map<string, string>(),
    },
  };
}

test("persists a complete current-run audit for a no-event Deal", () => {
  const input = withCurrentRunAuthority(baseInput());
  const analysis = buildCompanyAnalyses(input)[0]!;

  assert.deepEqual(analysis.currentRunAudit, {
    schemaVersion: "company-analysis-current-run-audit-v1",
    workspaceId: "workspace_demo",
    companyId: "company_1",
    stableDealId: analysis.dealId,
    priorDealStatus: analysis.dealStatus,
    analysisEligibleAt: "2026-08-03T12:00:00.000Z",
    dealUniverseId: "belief_reversal_deal_universe_2026_08_03_v1",
    dealUniverseFingerprint: `sha256:${"1".repeat(64)}`,
    evidenceContextFingerprint: `sha256:${"2".repeat(64)}`,
    evidenceBindingFingerprint: `sha256:${"3".repeat(64)}`,
    activeParentFingerprint: `sha256:${"4".padStart(64, "0")}`,
    sourceRevisionIds: ["revision_1"],
    xtraceMemoryIds: [`memory_${analysis.dealId}`],
    priorMemory: {
      kind: "investment",
      previousMeetingSummary: analysis.investmentMemory.previousMeetingSummary,
      decisionReason: analysis.investmentMemory.decisionReason,
      concerns: analysis.investmentMemory.concerns,
      revisitConditions: analysis.investmentMemory.revisitConditions,
      lastEvaluatedAt: analysis.investmentMemory.lastEvaluatedAt,
      sourceIds: analysis.investmentMemory.sourceIds,
      fixtureIds: analysis.investmentMemory.fixtureIds,
    },
    consideredMarketEventIds: ["event_considered_a", "event_considered_b"],
    matchedMarketEventIds: [],
    scoreBreakdown: {
      eventRelevance: 0,
      dealRelevance: 0,
      priorContextStrength: 0,
      evidenceQuality: 0,
      finalScore: 0,
      confidence: "low",
    },
    gates: {
      chronology: { passed: false, failureReason: "No matched market event was available." },
      revisitConditionMapping: { passed: false, failureReason: "No matched market event was available." },
      counterevidence: { passed: false, failureReason: "No matched market event was available." },
      actionDelta: { passed: false, failureReason: "No matched market event was available." },
      allPassed: false,
    },
    direction: "none",
    actions: [{
      kind: "no_new_action",
      scope: "deal",
      priority: "standard",
      visibility: "internal_only",
    }],
    outcome: "no_material_change",
    nonChangeReason:
      "No material market evidence matched this company during the current 14-day scan.",
    analysisFailureReason: null,
    whyNotUnderwriting:
      "No material belief change was supported by the current evidence.",
    recall: {
      attempted: true,
      succeeded: true,
      failureReason: null,
    },
  });
});

test("persists a recalled screening-record monitor with explicit failed gates and no synthetic VC decision", async () => {
  const prior = sampleResearchScreeningSource();
  const trigger = normalizedSourceV2("screening_monitor_trigger", {
    title: "Screening Monitor funding update",
    canonicalUrl: "https://example.com/screening-monitor-funding",
    publisher: "Screening Monitor",
    providerId: "company-feed",
    eventAt: "2026-07-28",
    eventAtPrecision: "date",
    publishedAt: "2026-07-28",
    publishedAtPrecision: "date",
    retrievedAt: "2026-07-29T12:00:00.000Z",
    retrievedAtPrecision: "timestamp",
    entityKeys: ["screening-monitor"],
    sourceRevisionId: "revision_screening_monitor_trigger",
    contentFingerprint: TEST_SHA256_A,
    text: {
      status: "normalized_only",
      normalizedStatement:
        "Screening Monitor disclosed a funding event relevant to its current review.",
    },
  });
  const event = marketEventV2(trigger, {
    id: "event_screening_monitor",
    entityKeys: ["screening-monitor"],
    eventAt: trigger.eventAt,
    eventAtPrecision: trigger.eventAtPrecision,
    publishedAt: trigger.publishedAt,
    publishedAtPrecision: trigger.publishedAtPrecision,
    retrievedAt: trigger.retrievedAt,
    retrievedAtPrecision: trigger.retrievedAtPrecision,
    sources: [trigger],
  });
  const bundle: DealMemoryBundle = {
    dealId: "deal_screening_monitor",
    companyName: "Screening Monitor",
    status: "screening",
    facts: [{
      text: trigger.text.status === "normalized_only"
        ? trigger.text.normalizedStatement
        : "",
      sources: [trigger],
    }, {
      text: prior.text.status === "normalized_only"
        ? prior.text.normalizedStatement
        : "",
      sources: [prior],
    }],
    interactions: [],
  };
  const memoryContext: MemoryContext = {
    dealId: bundle.dealId,
    memoryId: "memory_sample_research_screening_monitor",
    memoryType: "research_disposition",
    text: prior.text.status === "normalized_only"
      ? prior.text.normalizedStatement
      : "",
    score: 1,
    provenance: "source_document",
    sourceRevisionIds: [prior.sourceRevisionId!],
    sourceIds: [prior.id, trigger.id],
    fixtureIds: [],
  };
  const [match] = await createMatchingService({ reason: async () => [] })
    .analyze({
      deals: [{
        id: bundle.dealId,
        companyName: bundle.companyName,
        status: bundle.status,
      }],
      events: [event],
      memoryContexts: [{
        dealId: bundle.dealId,
        text: memoryContext.text,
        sourceIds: memoryContext.sourceIds,
        fixtureIds: [],
      }],
      sources: [trigger, prior],
    });
  assert.ok(match);

  const [analysis] = buildCompanyAnalyses({
    reportId: REPORT_ID,
    runId: RUN_ID,
    createdAt: "2026-08-03T12:00:00.000Z",
    bundles: [bundle],
    contextsByDeal: new Map([[bundle.dealId, [memoryContext]]]),
    recallFailures: new Set(),
    groundedMatches: [match],
    currentRunAuthority: {
      workspaceId: "workspace_demo",
      dealUniverseId: "current_30_deals",
      dealUniverseFingerprint: `sha256:${"1".repeat(64)}`,
      evidenceContextFingerprint: `sha256:${"2".repeat(64)}`,
      evidenceBindingFingerprint: `sha256:${"3".repeat(64)}`,
      consideredMarketEventIds: [event.id],
      dealsById: new Map([[bundle.dealId, {
        companyId: "company_screening_monitor",
        priorDealStatus: "screening",
        analysisEligibleAt: "2026-08-03T10:00:00.000Z",
        activeSourceRevisionIds: [
          trigger.sourceRevisionId!,
          prior.sourceRevisionId!,
        ],
        activeParentFingerprint: `sha256:${"4".repeat(64)}`,
      }]]),
      recallAttemptedDealIds: new Set([bundle.dealId]),
      recallFailureReasons: new Map(),
    },
  });

  assert.equal(analysis.outcome, "monitor");
  assert.equal(analysis.beliefAssessment, undefined);
  assert.deepEqual(analysis.investmentMemory.fixtureIds, []);
  assert.deepEqual(analysis.investmentMemory.sourceIds, [prior.id]);
  assert.equal(
    analysis.investmentMemory.previousMeetingSummary,
    "No previous meeting summary was recorded.",
  );
  assert.equal(
    analysis.investmentMemory.decisionReason,
    "No previous decision reason was recorded.",
  );
  assert.deepEqual(analysis.companyBrief.decisionHistory, []);
  assert.deepEqual(analysis.currentRunAudit?.matchedMarketEventIds, [event.id]);
  assert.equal(analysis.currentRunAudit?.priorMemory.kind, "screening");
  assert.equal(analysis.currentRunAudit?.gates.allPassed, false);
  assert.equal(analysis.currentRunAudit?.gates.actionDelta.passed, false);
  assert.match(
    analysis.currentRunAudit?.whyNotUnderwriting ?? "",
    /research screening record.*not.*formal VC action/i,
  );
  assert.equal(isEligibleBeliefRevision(analysis), false);
});

test("persists a gate-passing research-prior belief revision without fabricating a meeting or formal prior decision", async () => {
  const prior = sampleResearchScreeningSource();
  const trigger = normalizedSourceV2("research_revision_trigger", {
    title: "Independent production evidence",
    canonicalUrl: "https://example.com/screening-monitor-production",
    publisher: "Verified Customer",
    providerId: "customer-feed",
    eventAt: "2026-08-02",
    eventAtPrecision: "date",
    publishedAt: "2026-08-02",
    publishedAtPrecision: "date",
    retrievedAt: "2026-08-03T12:00:00.000Z",
    retrievedAtPrecision: "timestamp",
    entityKeys: ["screening-monitor"],
    sourceRevisionId: "revision_research_revision_trigger",
    contentFingerprint: TEST_SHA256_A,
    text: {
      status: "normalized_only",
      normalizedStatement:
        "An independent customer verified Screening Monitor in a production deployment.",
    },
  });
  const counter = normalizedSourceV2("research_revision_counter", {
    title: "Remaining adoption limitation",
    canonicalUrl: "https://example.com/screening-monitor-limit",
    publisher: "Verified Customer",
    providerId: "customer-feed",
    eventAt: "2026-08-02",
    eventAtPrecision: "date",
    publishedAt: "2026-08-02",
    publishedAtPrecision: "date",
    retrievedAt: "2026-08-03T12:00:00.000Z",
    retrievedAtPrecision: "timestamp",
    entityKeys: ["screening-monitor"],
    evidenceRole: "counterevidence",
    sourceRevisionId: "revision_research_revision_counter",
    contentFingerprint: TEST_SHA256_A,
    text: {
      status: "normalized_only",
      normalizedStatement:
        "The independent evidence does not establish broad retention across Screening Monitor deployments.",
    },
  });
  const event = marketEventV2(trigger, {
    id: "event_research_revision",
    entityKeys: ["screening-monitor"],
    eventAt: trigger.eventAt,
    eventAtPrecision: trigger.eventAtPrecision,
    publishedAt: trigger.publishedAt,
    publishedAtPrecision: trigger.publishedAtPrecision,
    retrievedAt: trigger.retrievedAt,
    retrievedAtPrecision: trigger.retrievedAtPrecision,
    sources: [trigger, counter],
  });
  const priorText = prior.text.status === "normalized_only"
    ? prior.text.normalizedStatement
    : "";
  const triggerText = trigger.text.status === "normalized_only"
    ? trigger.text.normalizedStatement
    : "";
  const counterText = counter.text.status === "normalized_only"
    ? counter.text.normalizedStatement
    : "";
  const reconsiderationCondition =
    "Obtain stronger customer and traction evidence.";
  const [match] = await createMatchingService({
    reason: async () => [{
      dealId: "deal_screening_monitor",
      whyNow: triggerText,
      previousContext: priorText,
      positiveImplications: [triggerText],
      negativeImplications: [],
      selectedTriggerEventId: event.id,
      selectedPriorInteractionId: prior.id,
      revisitConditionIndex: 0,
      revisitConditionText: reconsiderationCondition,
      revisitCitedSourceIds: [trigger.id],
      counterevidence: {
        statement: counterText,
        citedSourceIds: [counter.id],
      },
      citedSourceIds: [trigger.id, counter.id, prior.id],
      scoreInputs: {
        eventRelevance: 1,
        dealRelevance: 1,
        priorContextStrength: 0.8,
        evidenceQuality: 0.9,
      },
      claimSourceIds: {
        [triggerText]: [trigger.id],
        [priorText]: [prior.id],
      },
    }],
  }).analyze({
    deals: [{
      id: "deal_screening_monitor",
      companyName: "Screening Monitor",
      status: "screening",
    }],
    events: [event],
    memoryContexts: [{
      dealId: "deal_screening_monitor",
      text: priorText,
      sourceIds: [prior.id],
      fixtureIds: [],
      interactionCandidates: [{
        id: prior.id,
        occurredAt: prior.eventAt!,
        sourceIds: [prior.id],
        revisitConditions: [reconsiderationCondition],
        provenance: "source_document",
        label: "Sample research screening record",
        meetingOccurred: false,
        vcInteraction: false,
        priorActions: actionsForDealStatusAndDirection("screening", "none"),
      }],
    }],
    sources: [trigger, counter, prior],
  });
  assert.ok(match);
  const bundle: DealMemoryBundle = {
    dealId: "deal_screening_monitor",
    companyName: "Screening Monitor",
    status: "screening",
    facts: [{ text: triggerText, sources: [trigger] }, {
      text: counterText,
      sources: [counter],
    }, { text: priorText, sources: [prior] }],
    interactions: [],
  };
  const memoryContext: MemoryContext = {
    dealId: bundle.dealId,
    memoryId: "memory_research_prior",
    memoryType: "research_disposition",
    text: priorText,
    score: 1,
    provenance: "source_document",
    sourceRevisionIds: [prior.sourceRevisionId!],
    sourceIds: [prior.id],
    fixtureIds: [],
  };
  const [analysis] = buildCompanyAnalyses({
    reportId: REPORT_ID,
    runId: RUN_ID,
    createdAt: "2026-08-03T12:00:00.000Z",
    bundles: [bundle],
    contextsByDeal: new Map([[bundle.dealId, [memoryContext]]]),
    recallFailures: new Set(),
    groundedMatches: [match],
    currentRunAuthority: {
      workspaceId: "workspace_demo",
      dealUniverseId: "current_30_deals",
      dealUniverseFingerprint: `sha256:${"1".repeat(64)}`,
      evidenceContextFingerprint: `sha256:${"2".repeat(64)}`,
      evidenceBindingFingerprint: `sha256:${"3".repeat(64)}`,
      consideredMarketEventIds: [event.id],
      dealsById: new Map([[bundle.dealId, {
        companyId: "company_screening_monitor",
        priorDealStatus: "screening",
        analysisEligibleAt: "2026-08-03T10:00:00.000Z",
        activeSourceRevisionIds: [
          prior.sourceRevisionId!,
          trigger.sourceRevisionId!,
          counter.sourceRevisionId!,
        ],
        activeParentFingerprint: `sha256:${"4".repeat(64)}`,
      }]]),
      recallAttemptedDealIds: new Set([bundle.dealId]),
      recallFailureReasons: new Map(),
    },
  });

  assert.equal(analysis.outcome, "belief_revised");
  assert.equal(analysis.dealStatus, "screening");
  assert.deepEqual(analysis.investmentMemory.fixtureIds, []);
  assert.deepEqual(analysis.investmentMemory.sourceIds, [prior.id]);
  assert.equal(
    analysis.investmentMemory.previousMeetingSummary,
    "No previous meeting summary was recorded.",
  );
  assert.equal(
    analysis.investmentMemory.decisionReason,
    "No previous decision reason was recorded.",
  );
  assert.deepEqual(analysis.companyBrief.decisionHistory, []);
  assert.equal(analysis.currentRunAudit?.gates.allPassed, true);
  assert.equal(analysis.currentRunAudit?.whyNotUnderwriting, null);
  assert.equal(isEligibleBeliefRevision(analysis), true);
});

test("retains considered events and the exact recall failure on unavailable analyses", () => {
  const input = withCurrentRunAuthority(baseInput());
  const failedDealId = input.bundles[0]!.dealId;
  input.recallFailures = new Set([failedDealId]);
  input.currentRunAuthority.recallFailureReasons.set(
    failedDealId,
    "XTRACE_RECALL_LINEAGE_FAILED",
  );

  const analysis = buildCompanyAnalyses(input)[0]!;

  assert.equal(analysis.outcome, "analysis_unavailable");
  assert.deepEqual(
    analysis.currentRunAudit?.consideredMarketEventIds,
    ["event_considered_a", "event_considered_b"],
  );
  assert.deepEqual(analysis.currentRunAudit?.recall, {
    attempted: true,
    succeeded: false,
    failureReason: "XTRACE_RECALL_LINEAGE_FAILED",
  });
  assert.equal(
    analysis.currentRunAudit?.analysisFailureReason,
    "XTRACE_RECALL_LINEAGE_FAILED",
  );
  assert.match(analysis.currentRunAudit?.whyNotUnderwriting ?? "", /unavailable/i);
});

test("a matching-lineage failure retains the successful XTrace recall audit", () => {
  const input = withCurrentRunAuthority(baseInput());
  const bundle = input.bundles[0]!;
  input.groundedMatches = [groundedMatch(bundle, "high")];

  const analysis = buildCompanyAnalyses(input)[0]!;

  assert.equal(analysis.outcome, "analysis_unavailable");
  assert.deepEqual(
    analysis.investmentMemory.memoryIds,
    [`memory_${bundle.dealId}`],
  );
  assert.deepEqual(analysis.currentRunAudit?.recall, {
    attempted: true,
    succeeded: true,
    failureReason: null,
  });
  assert.deepEqual(
    analysis.currentRunAudit?.xtraceMemoryIds,
    [`memory_${bundle.dealId}`],
  );
  assert.match(
    analysis.currentRunAudit?.analysisFailureReason ?? "",
    /belief-assessment lineage/i,
  );
});

test("rejects duplicate Deal analyses instead of silently overwriting authority", () => {
  const input = baseInput();
  input.bundles = [input.bundles[0]!, structuredClone(input.bundles[0]!)];

  assert.throws(
    () => buildCompanyAnalyses(input),
    /duplicate.*Deal|Deal.*duplicate/i,
  );
});

test("builds one no-change analysis for every fixed MVP Deal", () => {
  const analyses = buildCompanyAnalyses(baseInput());

  assert.equal(analyses.length, 19);
  assert.ok(analyses.every((analysis) =>
    analysis.outcome === "no_material_change"
  ));
  assert.deepEqual(countCompanyAnalyses(analyses), {
    companyCount: 19,
    beliefRevised: 0,
    monitor: 0,
    noMaterialChange: 19,
    analysisUnavailable: 0,
  });
});

test("builds exactly one auditable analysis for a 30-Deal run universe", () => {
  const base = baseInput();
  const addedBundles = Array.from({ length: 11 }, (_, index) => {
    const ordinal = index + 20;
    const { bundle } = semanticBundle({
      sourceIds: [
        `semantic_primary_source_${ordinal}`,
        `semantic_corroborating_source_${ordinal}`,
      ],
    });
    return {
      ...bundle,
      dealId: `deal_universe_${ordinal}`,
      companyName: `Universe Company ${ordinal}`,
    };
  });
  const bundles = [...base.bundles, ...addedBundles];
  const input = withCurrentRunAuthority({
    ...base,
    bundles,
    contextsByDeal: contextsForEveryDeal(bundles),
  });

  const analyses = buildCompanyAnalyses(input);
  const counts = countCompanyAnalyses(analyses);

  assert.equal(analyses.length, 30);
  assert.equal(new Set(analyses.map(({ dealId }) => dealId)).size, 30);
  assert.ok(analyses.every(({ currentRunAudit }) => currentRunAudit !== undefined));
  assert.equal(
    counts.beliefRevised + counts.monitor + counts.noMaterialChange
      + counts.analysisUnavailable,
    30,
  );
});

test("projects qualified and low grounded matches without inventing fields", () => {
  const input = baseInput();
  const highBundle = input.bundles.find((bundle) =>
    bundle.dealId === "deal_ably"
  )!;
  const lowBundle = input.bundles.find((bundle) =>
    bundle.dealId === "deal_100plus"
  )!;
  const analyses = buildCompanyAnalyses({
    ...input,
    groundedMatches: [
      groundedMatch(highBundle, "high"),
      groundedMatch(lowBundle, "low"),
    ],
  });
  const byDeal = new Map(analyses.map((analysis) => [
    analysis.dealId,
    analysis,
  ]));

  assert.equal(byDeal.get("deal_ably")?.outcome, "monitor");
  assert.equal(byDeal.get("deal_100plus")?.outcome, "monitor");
  assert.equal(
    byDeal.get("deal_ably")?.companyBrief.traction[0].value,
    null,
  );
  assert.equal(
    byDeal.get("deal_ably")?.companyBrief.traction[0].unavailableReason,
    "Not available in current evidence",
  );
});

test("a high-score match without a current hard-gate assessment cannot become a belief revision", () => {
  const input = baseInput();
  const bundle = input.bundles.find((candidate) =>
    candidate.dealId === "deal_ably"
  )!;

  const analysis = buildCompanyAnalyses({
    ...input,
    groundedMatches: [groundedMatch(bundle, "high")],
  }).find((candidate) => candidate.dealId === bundle.dealId)!;

  assert.equal(analysis.outcome, "monitor");
  assert.equal(analysis.beliefAssessment, undefined);
});

test("market evidence lineage contains exactly embedded event sources and excludes unrelated local public facts", () => {
  const input = baseInput();
  const bundle = input.bundles.find((candidate) =>
    candidate.dealId === "deal_ably"
  )!;
  const unrelatedPublicSource = normalizedSourceV2(
    "unrelated_local_public_source",
    {
      title: "Unrelated local company fact",
      canonicalUrl: "https://example.com/unrelated-local-fact",
      publisher: "Example",
      providerId: "company-registry",
      text: {
        status: "normalized_only",
        normalizedStatement: "An unrelated local company fact was recorded.",
      },
    },
  );
  bundle.facts = [...bundle.facts, {
    text: "An unrelated local company fact was recorded.",
    sources: [unrelatedPublicSource],
  }];
  const match = groundedMatch(bundle, "high");
  const eventSourceIds = match.events.flatMap((event) =>
    event.sources.map((source) => source.id)
  );
  match.sources = match.sources.filter((source) =>
    !eventSourceIds.includes(source.id)
  );

  const analysis = buildCompanyAnalyses({
    ...input,
    groundedMatches: [match],
  }).find((candidate) => candidate.dealId === bundle.dealId)!;

  assert.deepEqual(
    analysis.marketEvidence.sourceIds.slice().sort(),
    eventSourceIds.slice().sort(),
  );
  assert.equal(
    analysis.marketEvidence.sourceIds.includes(unrelatedPublicSource.id),
    false,
  );
  assert.ok(
    eventSourceIds.every((sourceId) =>
      analysis.sources.some((source) => source.id === sourceId)
    ),
    "every embedded event source remains in the full analysis lineage",
  );
  assert.ok(
    analysis.sources.some((source) => source.id === unrelatedPublicSource.id),
    "unrelated local evidence remains visible as general company lineage",
  );
});

test("uses analysis unavailable only for the failed company recall", () => {
  const input = baseInput();
  const analyses = buildCompanyAnalyses({
    ...input,
    recallFailures: new Set(["deal_7bridges"]),
  });
  const unavailable = analyses.filter((analysis) =>
    analysis.outcome === "analysis_unavailable"
  );

  assert.equal(unavailable.length, 1);
  assert.equal(unavailable[0].dealId, "deal_7bridges");
  assert.equal(unavailable[0].sources.length, 0);
});

test("treats an empty XTrace result as unavailable instead of using local fallback", () => {
  const input = baseInput();
  input.contextsByDeal.set("deal_7bridges", []);
  const analyses = buildCompanyAnalyses(input);

  assert.equal(
    analyses.find((analysis) => analysis.dealId === "deal_7bridges")?.outcome,
    "analysis_unavailable",
  );
});

test("keeps untyped exact prose metrics unavailable until typed evidence exists", () => {
  const input = baseInput();
  const legacyCouPro = buildCompanyAnalyses(input).find((analysis) =>
    analysis.dealId === "deal_coupro"
  )!;
  assert.equal(
    legacyCouPro.companyBrief.traction.find((field) =>
      field.label === "Customers / users"
    )?.value,
    null,
    "legacy unverified text must not pass an exact-value extractor",
  );
  const couProBundle = input.bundles.find((bundle) =>
    bundle.dealId === "deal_coupro"
  )!;
  couProBundle.facts = couProBundle.facts.map((fact) => ({
    ...fact,
    sources: fact.sources.map((source) => {
      if ("schemaVersion" in source) return source;
      return exactSourceV2(source.id, {
        provenance: "source_document",
        title: source.title,
        canonicalUrl: null,
        documentId: source.documentId ?? `document_${source.id}`,
        publisher: "Internal Deal Registry",
        providerId: "deal-registry",
        eventAt: null,
        eventAtPrecision: null,
        publishedAt: null,
        publishedAtPrecision: null,
        retrievedAt: CREATED_AT,
        retrievedAtPrecision: "timestamp",
        updatedAt: null,
        updatedAtPrecision: null,
        entityKeys: [],
        sourceClass: "internal_decision_record",
        sourceAuthority: "primary",
        evidenceRole: "context",
        locator: { kind: "document_page", page: source.page ?? 1 },
        text: {
          status: "verified_exact",
          verbatimExcerpt: source.excerpt,
        },
      });
    }),
  }));
  const analyses = buildCompanyAnalyses(input);
  const couPro = analyses.find((analysis) =>
    analysis.dealId === "deal_coupro"
  )!;
  const users = couPro.companyBrief.traction.find((field) =>
    field.label === "Customers / users"
  );
  const growth = couPro.companyBrief.traction.find((field) =>
    field.label === "Growth"
  );

  assert.equal(users?.value, null);
  assert.equal(growth?.value, null);
  assert.deepEqual(users?.sourceIds, []);
  assert.deepEqual(growth?.sourceIds, []);
});

test("does not extract six decision metrics from negated or qualified exact prose", () => {
  const prose = [
    "ARR $10M not established.",
    "500 customers only upper bound.",
    "25% growth unverified.",
    "Series B not current.",
    "$20M raise unplanned.",
    "$100M valuation unsupported.",
  ].join(" ");
  const source = exactSourceV2("qualified_metric_source", {
    provenance: "source_document",
    title: "Qualified metrics memo",
    canonicalUrl: null,
    documentId: "qualified_metrics_document",
    publisher: "Internal Deal Registry",
    providerId: "deal-registry",
    eventAt: null,
    eventAtPrecision: null,
    publishedAt: null,
    publishedAtPrecision: null,
    retrievedAt: CREATED_AT,
    retrievedAtPrecision: "timestamp",
    updatedAt: null,
    updatedAtPrecision: null,
    entityKeys: [],
    sourceClass: "company_official",
    sourceAuthority: "primary",
    evidenceRole: "context",
    locator: { kind: "document_page", page: 1 },
    text: {
      status: "verified_exact",
      verbatimExcerpt: prose,
    },
  });
  const bundle: DealMemoryBundle = {
    dealId: "deal_qualified_metrics",
    companyName: "Qualified Metrics",
    status: "passed",
    facts: [{ text: prose, sources: [source] }],
    interactions: [],
  };
  const [analysis] = buildCompanyAnalyses({
    reportId: REPORT_ID,
    runId: RUN_ID,
    createdAt: CREATED_AT,
    bundles: [bundle],
    contextsByDeal: new Map([[bundle.dealId, [{
      dealId: bundle.dealId,
      memoryId: "memory_qualified_metrics",
      memoryType: "fact",
      text: prose,
      score: 1,
      provenance: "source_document",
      sourceIds: [source.id],
      fixtureIds: [],
    }]]]),
    recallFailures: new Set(),
    groundedMatches: [],
  });

  const metricFields = [
    ...analysis.companyBrief.traction,
    ...analysis.companyBrief.dealTerms,
  ];
  assert.deepEqual(
    metricFields.map((field) => [
      field.label,
      field.value,
      field.unavailableReason,
      field.sourceIds,
    ]),
    [
      ["ARR", null, "Not available in current evidence", []],
      ["Customers / users", null, "Not available in current evidence", []],
      ["Growth", null, "Not available in current evidence", []],
      ["Round", null, "Not available in current evidence", []],
      ["Raise", null, "Not available in current evidence", []],
      ["Valuation", null, "Not available in current evidence", []],
    ],
  );
});

test("does not promote unverified or source-unrelated Deal facts into the factual company overview", () => {
  const modelStatement =
    "Structured image evidence (not a quotation): ARR = 8000000 USD.";
  const bundle: DealMemoryBundle = {
    dealId: "deal_unverified_overview",
    companyName: "Unverified Overview",
    status: "passed",
    facts: [{
      text: "Legacy company overview.",
      sources: [{
        id: "legacy_overview_source",
        provenance: "source_document",
        title: "Legacy memo",
        documentId: "legacy_document",
        excerpt: "Legacy company overview.",
      }],
    }, {
      text: modelStatement,
      sources: [normalizedSourceV2("model_overview_source", {
        provenance: "model_inference",
        title: "company-image.png",
        canonicalUrl: null,
        documentId: "image_document",
        publisher: null,
        providerId: "anthropic",
        eventAt: null,
        eventAtPrecision: null,
        publishedAt: null,
        publishedAtPrecision: null,
        retrievedAt: CREATED_AT,
        retrievedAtPrecision: "timestamp",
        updatedAt: null,
        updatedAtPrecision: null,
        entityKeys: ["unverified-overview"],
        sourceClass: "model_output",
        sourceAuthority: "not_applicable",
        evidenceRole: "context",
        sourceRevisionId: "revision_image_document",
        locator: null,
        text: {
          status: "model_inference",
          normalizedStatement: modelStatement,
          model: {
            provider: "anthropic",
            model: "claude-vision-test",
            generatedAt: CREATED_AT,
            inputFingerprint: `sha256:${"8".repeat(64)}`,
          },
        },
      })],
    }, {
      text: "Fabricated company overview unrelated to its cited source.",
      sources: [normalizedSourceV2("unrelated_overview_source", {
        text: {
          status: "normalized_only",
          normalizedStatement: "This source supports a different statement.",
        },
      })],
    }],
    interactions: [],
  };
  const analyses = buildCompanyAnalyses({
    reportId: REPORT_ID,
    runId: RUN_ID,
    createdAt: CREATED_AT,
    bundles: [bundle],
    contextsByDeal: new Map([[bundle.dealId, [{
      dealId: bundle.dealId,
      memoryId: "memory_unverified_overview",
      memoryType: "structured",
      text: `${bundle.facts[0].text}\n${bundle.facts[1].text}`,
      score: 1,
      provenance: "model_inference",
      sourceIds: bundle.facts.flatMap((fact) =>
        fact.sources.map((source) => source.id)
      ),
      fixtureIds: [],
    }]]]),
    recallFailures: new Set(),
    groundedMatches: [],
  });

  assert.deepEqual(analyses[0].companyBrief.icSnapshot, []);
  assert.deepEqual(
    analyses[0].sources.map((source) =>
      "schemaVersion" in source ? source.text.status : "legacy_unverified"
    ).sort(),
    [
      "model_inference",
      "normalized_only",
    ],
    "unverified sources remain available as visibly classified lineage/context",
  );
});

test("projects persisted semantic fields exactly while preserving every classification", () => {
  const { bundle, structuredFields } = semanticBundle();

  const analysis = buildSingleCompanyAnalysis(bundle);
  const brief = analysis.companyBrief as typeof analysis.companyBrief & {
    structuredFields?: unknown[];
  };

  assert.deepEqual(brief.structuredFields, structuredFields);
});

test("rejects a Company Brief semantic field whose source ID is not in canonical lineage", () => {
  const { bundle } = semanticBundle();
  const semantic = bundle.facts[0].semanticFields![0];
  assert.equal(semantic.classification, "fact");
  if (semantic.classification !== "fact") {
    throw new Error("The fixture requires a semantic fact.");
  }
  semantic.sourceIds = ["missing_semantic_source"];

  assert.throws(
    () => buildSingleCompanyAnalysis(bundle),
    /semantic field source IDs must resolve to Company Brief lineage/i,
  );
});

test("labels every synthetic decision-history entry as Sample decision record", () => {
  const input = baseInput();
  const analysis = buildCompanyAnalyses(input).find((candidate) =>
    candidate.companyBrief.decisionHistory.length > 0
  );

  assert.ok(analysis);
  assert.ok(analysis.companyBrief.decisionHistory.every((entry) =>
    entry.title === "Sample decision record"
  ));
});
