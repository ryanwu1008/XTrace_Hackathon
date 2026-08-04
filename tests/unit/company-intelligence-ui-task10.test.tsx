import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import {
  CompanyBrief,
  CompanyAnalysisList,
  CompanyIntelligenceReport,
  PriorityResult,
  type IntelligenceReportView,
} from "../../app/company-intelligence";
import { ChatView, DealsView, ReportsView } from "../../app/page";
import type { CompanyAnalysis } from "../../lib/contracts/domain";
import type { SourceRefV2 } from "../../lib/contracts/source-evidence";

type CanonicalSourceRefV2 = Extract<
  SourceRefV2,
  { adaptation: "canonical" }
>;

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_FINGERPRINT = `sha256:${"a".repeat(64)}`;
const SNAPSHOT_FINGERPRINT = `sha256:${"b".repeat(64)}`;
const CONTEXT_FINGERPRINT = `sha256:${"c".repeat(64)}`;
const EVENT_SET_FINGERPRINT = `sha256:${"d".repeat(64)}`;
const BINDING_FINGERPRINT = `sha256:${"e".repeat(64)}`;

function exactPublicSource(): CanonicalSourceRefV2 {
  return {
    schemaVersion: "source-ref-v2",
    adaptation: "canonical",
    id: "source_public_exact",
    provenance: "public_web",
    title: "Official launch evidence",
    canonicalUrl: "https://example.com/official-launch",
    documentId: "document_public_exact",
    publisher: "Example Company",
    providerId: "official-newsroom",
    eventAt: "2026-07-29",
    eventAtPrecision: "date",
    publishedAt: "2026-07-29T16:45:00.000Z",
    publishedAtPrecision: "timestamp",
    retrievedAt: "2026-08-01T12:00:00.000Z",
    retrievedAtPrecision: "timestamp",
    updatedAt: "2026-07-30",
    updatedAtPrecision: "date",
    entityKeys: ["company:example", "sector:enterprise-ai"],
    sourceClass: "company_official",
    sourceAuthority: "primary",
    evidenceRole: "trigger",
    sourceRevisionId: "revision_public_exact",
    locator: { kind: "web_text", selector: "main article p:nth-of-type(2)" },
    contentFingerprint: SOURCE_FINGERPRINT,
    text: {
      status: "verified_exact",
      verbatimExcerpt: "Named customers now use the product in production.",
      normalizedStatement:
        "The company reports named production customer adoption.",
    },
  };
}

function sampleDecisionSource(): CanonicalSourceRefV2 {
  return {
    schemaVersion: "source-ref-v2",
    adaptation: "canonical",
    id: "fixture_example_passed_v1",
    provenance: "demo_fixture",
    title: "Sample decision record",
    canonicalUrl: null,
    documentId: "document_fixture",
    publisher: "Sample investment team",
    providerId: "belief-reversal-seed",
    eventAt: "2026-04-01T12:00:00.000Z",
    eventAtPrecision: "timestamp",
    publishedAt: null,
    publishedAtPrecision: null,
    retrievedAt: "2026-08-01T12:00:00.000Z",
    retrievedAtPrecision: "timestamp",
    updatedAt: null,
    updatedAtPrecision: null,
    entityKeys: ["company:example"],
    sourceClass: "internal_decision_record",
    sourceAuthority: "primary",
    evidenceRole: "context",
    sourceRevisionId: "revision_fixture_example",
    locator: { kind: "json_pointer", pointer: "/decisionReason" },
    contentFingerprint: `sha256:${"f".repeat(64)}`,
    text: {
      status: "normalized_only",
      normalizedStatement:
        "Sample decision record. The sample team passed pending production adoption.",
    },
  };
}

function sampleResearchScreeningSource(): CanonicalSourceRefV2 {
  return {
    ...exactPublicSource(),
    id: "research_screening_example_v1",
    provenance: "source_document",
    title: "Sample research screening record",
    canonicalUrl: null,
    documentId: "document_research_screening_example",
    publisher: "Internal Research Registry",
    providerId: "belief-reversal-research-seed-v1",
    eventAt: "2026-04-01T12:00:00.000Z",
    eventAtPrecision: "timestamp",
    publishedAt: null,
    publishedAtPrecision: null,
    updatedAt: null,
    updatedAtPrecision: null,
    sourceClass: "internal_decision_record",
    sourceAuthority: "primary",
    evidenceRole: "context",
    sourceRevisionId: "revision_research_screening_example",
    locator: { kind: "json_pointer", pointer: "/record" },
    text: {
      status: "normalized_only",
      normalizedStatement:
        "Sample research screening record. Synthetic research-only context; no meeting or VC interaction occurred. Reconsideration conditions: Independent customer adoption is confirmed.",
    },
  };
}

function normalizedSource(): CanonicalSourceRefV2 {
  return {
    ...exactPublicSource(),
    id: "source_normalized",
    title: "Normalized provider summary",
    canonicalUrl: "https://example.com/provider-summary",
    documentId: null,
    eventAt: null,
    eventAtPrecision: null,
    sourceRevisionId: null,
    locator: null,
    evidenceRole: "corroborating",
    text: {
      status: "normalized_only",
      normalizedStatement:
        "Provider-normalized evidence reports a larger enterprise footprint.",
    },
  };
}

function exactDocumentSource(): CanonicalSourceRefV2 {
  return {
    ...exactPublicSource(),
    id: "source_document_page",
    provenance: "source_document",
    title: "Exact internal document page",
    canonicalUrl: null,
    documentId: "document_identity_not_revision",
    providerId: "document-registry",
    sourceClass: "internal_decision_record",
    sourceAuthority: "primary",
    evidenceRole: "corroborating",
    sourceRevisionId: "revision_document_page_exact",
    locator: { kind: "document_page", page: 6 },
  };
}

function legacySource(): SourceRefV2 {
  return {
    schemaVersion: "source-ref-v2",
    adaptation: "legacy_read",
    id: "source_legacy",
    provenance: "public_web",
    title: "Legacy evidence",
    canonicalUrl: "https://example.com/legacy",
    documentId: null,
    publisher: "Legacy Publisher",
    providerId: null,
    eventAt: null,
    eventAtPrecision: null,
    publishedAt: "2026-07-20",
    publishedAtPrecision: "date",
    retrievedAt: null,
    retrievedAtPrecision: null,
    updatedAt: null,
    updatedAtPrecision: null,
    entityKeys: [],
    sourceClass: "unknown_legacy",
    sourceAuthority: "unknown_legacy",
    evidenceRole: "unknown_legacy",
    sourceRevisionId: null,
    locator: null,
    contentFingerprint: null,
    text: {
      status: "legacy_unverified",
      normalizedStatement: "A legacy row contains unverified normalized prose.",
    },
  };
}

function modelInferenceSource(): CanonicalSourceRefV2 {
  return {
    ...exactPublicSource(),
    id: "source_model_inference",
    provenance: "model_inference",
    title: "Bounded model inference",
    canonicalUrl: null,
    documentId: null,
    publisher: "Analysis runtime",
    providerId: "anthropic",
    eventAt: null,
    eventAtPrecision: null,
    publishedAt: null,
    publishedAtPrecision: null,
    retrievedAt: null,
    retrievedAtPrecision: null,
    updatedAt: null,
    updatedAtPrecision: null,
    entityKeys: ["company:example"],
    sourceClass: "model_output",
    sourceAuthority: "not_applicable",
    evidenceRole: "context",
    sourceRevisionId: null,
    locator: null,
    contentFingerprint: null,
    text: {
      status: "model_inference",
      normalizedStatement:
        "The evidence may satisfy the sample team's production-adoption checkpoint.",
      model: {
        provider: "Anthropic",
        model: "bounded-analysis-model",
        generatedAt: "2026-08-01T12:05:00.000Z",
        inputFingerprint: `sha256:${"1".repeat(64)}`,
      },
    },
  };
}

function canonicalEvent(source = exactPublicSource()) {
  return {
    schemaVersion: "market-event-v2" as const,
    adaptation: "canonical" as const,
    id: "event_company_adoption",
    title: "Production adoption announced",
    eventType: "customer_adoption",
    sectors: ["enterprise_ai"],
    themes: ["production_adoption"],
    summary: "The company announced named production adoption.",
    positiveImplications: ["The recorded adoption checkpoint may be satisfied."],
    negativeImplications: ["Issuer-reported adoption still needs customer checks."],
    eventAt: "2026-07-29",
    eventAtPrecision: "date" as const,
    publishedAt: "2026-07-29T16:45:00.000Z",
    publishedAtPrecision: "timestamp" as const,
    retrievedAt: "2026-08-01T12:00:00.000Z",
    retrievedAtPrecision: "timestamp" as const,
    updatedAt: "2026-07-30",
    updatedAtPrecision: "date" as const,
    confidence: "high" as const,
    canonicalUrl: "https://example.com/official-launch",
    providerId: "official-newsroom",
    contentFingerprint: SOURCE_FINGERPRINT,
    entityKeys: ["company:example", "sector:enterprise-ai"],
    triggerSourceId: source.id,
    sources: [source],
  };
}

function analysisFixture(
  lineage: SourceRefV2[] = [exactPublicSource(), sampleDecisionSource()],
): CompanyAnalysis {
  const eventSource = exactPublicSource();
  const fixtureSource = sampleDecisionSource();
  return {
    id: "analysis_example",
    reportId: "report_example",
    runId: RUN_ID,
    dealId: "deal_example",
    companyName: "Example AI",
    dealStatus: "passed",
    outcome: "belief_revised",
    confidence: "high",
    score: 0.79,
    verifiedSourceCount: 2,
    investmentMemory: {
      previousMeetingSummary: "The sample team reviewed an early product demo.",
      decisionReason: "The sample team passed pending production adoption.",
      concerns: ["No named production users were public."],
      revisitConditions: ["Revisit after named production adoption."],
      lastEvaluatedAt: "2026-04-01T12:00:00.000Z",
      memoryIds: ["memory_fixture_example"],
      sourceIds: [fixtureSource.id],
      fixtureIds: [fixtureSource.id],
      priorActions: [{
        kind: "deprioritize",
        scope: "deal",
        priority: "standard",
        visibility: "internal_only",
      }],
    },
    marketEvidence: {
      relationship: "satisfies",
      explanation: "Named production adoption addresses the recorded checkpoint.",
      eventIds: ["event_company_adoption"],
      events: [canonicalEvent(eventSource)],
      sourceIds: [eventSource.id],
    },
    implications: {
      positive: ["The production-adoption checkpoint may now be satisfied."],
      negative: ["Customer references remain unverified."],
    },
    beliefAssessment: {
      schemaVersion: "belief-change-assessment-v1",
      dealStatus: "passed",
      direction: "positive",
      scoreBreakdown: {
        eventRelevance: 0.8,
        dealRelevance: 0.7,
        priorContextStrength: 0.9,
        evidenceQuality: 0.8,
        finalScore: 0.79,
        confidence: "high",
      },
      gateContext: {
        priorInteraction: {
          id: fixtureSource.id,
          occurredAt: "2026-04-01T12:00:00.000Z",
          sourceIds: [fixtureSource.id],
          revisitConditions: ["Revisit after named production adoption."],
          priorActions: [{
            kind: "deprioritize",
            scope: "deal",
            priority: "standard",
            visibility: "internal_only",
          }],
          provenance: "demo_fixture",
          label: "Sample decision record",
        },
        triggerEvent: {
          id: "event_company_adoption",
          eventAt: "2026-07-29",
          sourceIds: [eventSource.id],
        },
        sources: [fixtureSource, eventSource],
      },
      gates: {
        chronology: {
          priorInteractionId: fixtureSource.id,
          priorInteractionAt: "2026-04-01T12:00:00.000Z",
          triggerEventId: "event_company_adoption",
          triggerEventAt: "2026-07-29",
          passed: true,
          failureReason: null,
        },
        revisitConditionMapping: {
          priorInteractionId: fixtureSource.id,
          revisitConditionIndex: 0,
          revisitConditionText: "Revisit after named production adoption.",
          triggerEventId: "event_company_adoption",
          citedSourceIds: [eventSource.id],
          passed: true,
          failureReason: null,
        },
        counterevidence: {
          statement: "Customer references remain unverified.",
          citedSourceIds: [eventSource.id],
          passed: true,
          failureReason: null,
        },
        actionDelta: {
          priorActions: [{
            kind: "deprioritize",
            scope: "deal",
            priority: "standard",
            visibility: "internal_only",
          }],
          proposedActions: [{
            kind: "reopen_diligence",
            scope: "deal",
            priority: "high",
            visibility: "internal_only",
          }],
          passed: true,
          failureReason: null,
        },
        allPassed: true,
      },
      actions: [{
        kind: "reopen_diligence",
        scope: "deal",
        priority: "high",
        visibility: "internal_only",
      }],
    },
    recommendedNextMove: "Reopen diligence.",
    companyBrief: {
      icSnapshot: [],
      traction: [],
      dealTerms: [],
      risks: [],
      decisionHistory: [{
        occurredAt: "2026-04-01T12:00:00.000Z",
        title: "Sample decision record",
        summary: "The sample team passed pending production adoption.",
        sourceIds: [fixtureSource.id],
      }],
      sourceLineage: lineage,
      structuredFields: [],
    },
    sources: [fixtureSource, eventSource, ...lineage.filter((source) =>
      source.id !== fixtureSource.id && source.id !== eventSource.id
    )],
    createdAt: "2026-08-01T12:10:00.000Z",
  } as CompanyAnalysis;
}

function reportFixture(analysis: CompanyAnalysis): IntelligenceReportView {
  return {
    id: "report_example",
    runId: RUN_ID,
    createdAt: "2026-08-01T12:10:00.000Z",
    marketSummary: "One accepted trigger was evaluated.",
    opportunities: [],
    analysisStatus: "completed",
    evidenceCoverage: {
      acceptedPublicEvents: 1,
      excludedPublicItems: 0,
      truncatedPublicEvents: 0,
      recalledDealCount: 1,
      unavailableDealCount: 0,
      structuredImageFallbackDealCount: 0,
    },
    counts: {
      companyCount: 1,
      beliefRevised: 1,
      monitor: 0,
      noMaterialChange: 0,
      analysisUnavailable: 0,
      eligibleDealCount: 30,
      companyAnalysisCount: 30,
      underwritingCandidateCount: 1,
      underwritingQueuedCount: 0,
      underwritingRunningCount: 0,
      underwritingCompletedCount: 0,
      underwritingPartialCount: 1,
      underwritingFailedCount: 0,
    },
    priorityDealId: analysis.dealId,
    companyAnalyses: [analysis],
    evidenceContext: {
      state: "current",
      schemaVersion: "run-evidence-context-v1",
      evidenceMode: "pinned",
      windowDays: 14,
      anchorAt: "2026-08-01T23:59:59.000-07:00",
      windowStartAt: "2026-07-19T00:00:00.000-07:00",
      windowEndAt: "2026-08-01T23:59:59.000-07:00",
      windowTimezone: "America/Los_Angeles",
      snapshotId: "belief_reversal_2026_08_01",
      snapshotFingerprint: SNAPSHOT_FINGERPRINT,
      contextFingerprint: CONTEXT_FINGERPRINT,
      displayLabel: "Demo evidence snapshot as of 2026-08-01",
      eventCount: 1,
      eventSetFingerprint: EVENT_SET_FINGERPRINT,
      bindingFingerprint: BINDING_FINGERPRINT,
    },
  };
}

test("priority report visibly labels synthetic memory and renders weighted score plus every hard gate", () => {
  const html = renderToStaticMarkup(createElement(PriorityResult, {
    analysis: analysisFixture(),
    onOpenBrief() {},
    showDemoProfiles: false,
  }));

  assert.match(html, /Sample decision record/);
  assert.match(html, /Event relevance[^<]*·[^<]*35%/);
  assert.match(html, /Deal relevance[^<]*·[^<]*30%/);
  assert.match(html, /Prior decision-context strength[^<]*·[^<]*20%/);
  assert.match(html, /Evidence quality[^<]*·[^<]*15%/);
  assert.match(html, /Medium threshold[\s\S]*?50%/);
  assert.match(html, /High threshold[\s\S]*?78%/);
  for (const gate of [
    "Chronology",
    "Revisit-condition mapping",
    "Counterevidence",
    "Action delta",
  ]) {
    assert.match(html, new RegExp(`${gate}[\\s\\S]*Passed`));
  }
  assert.match(html, /Trigger source[^<]*source_public_exact/);
});

test("typed Sample research screening authority is visibly labeled in list, brief, and a future changed-belief priority card", () => {
  const researchAuthority = sampleResearchScreeningSource();
  const analysis = analysisFixture([exactPublicSource(), researchAuthority]);
  analysis.dealStatus = "screening";
  analysis.investmentMemory = {
    previousMeetingSummary: "No recorded meeting.",
    decisionReason: "No recorded decision.",
    concerns: [],
    revisitConditions: ["Independent customer adoption is confirmed."],
    lastEvaluatedAt: "2026-04-01T12:00:00.000Z",
    memoryIds: ["memory_research_screening_example"],
    sourceIds: [researchAuthority.id],
    fixtureIds: [],
    priorActions: [{
      kind: "continue_monitoring",
      scope: "deal",
      priority: "standard",
      visibility: "internal_only",
    }],
  };
  analysis.beliefAssessment!.gateContext.priorInteraction = {
    id: researchAuthority.id,
    occurredAt: "2026-04-01T12:00:00.000Z",
    sourceIds: [researchAuthority.id],
    revisitConditions: ["Independent customer adoption is confirmed."],
    priorActions: [{
      kind: "continue_monitoring",
      scope: "deal",
      priority: "standard",
      visibility: "internal_only",
    }],
    provenance: "source_document",
    label: "Sample research screening record",
    meetingOccurred: false,
    vcInteraction: false,
  };
  analysis.sources = [exactPublicSource(), researchAuthority];
  analysis.companyBrief.sourceLineage = [exactPublicSource(), researchAuthority];

  const expected = "Sample research screening record · synthetic, no meeting or VC interaction";
  const list = renderToStaticMarkup(createElement(CompanyAnalysisList, {
    analyses: [analysis],
    onOpenBrief() {},
  }));
  const brief = renderToStaticMarkup(createElement(CompanyBrief, {
    analysis,
    activeTab: "IC Snapshot",
    onTab() {},
    onClose() {},
  }));
  const priority = renderToStaticMarkup(createElement(PriorityResult, {
    analysis,
    onOpenBrief() {},
  }));

  for (const html of [list, brief, priority]) {
    assert.match(html, new RegExp(expected));
  }
});

test("screening-record label requires the exact typed research authority, never status or Sample decision fixture text", () => {
  const ordinaryScreening = analysisFixture();
  ordinaryScreening.dealStatus = "screening";
  const forgedResearch = sampleResearchScreeningSource();
  forgedResearch.provenance = "demo_fixture";
  const forgedAnalysis = analysisFixture([exactPublicSource(), forgedResearch]);
  forgedAnalysis.dealStatus = "screening";

  const label = /Sample research screening record · synthetic, no meeting or VC interaction/;
  for (const analysis of [ordinaryScreening, forgedAnalysis]) {
    const list = renderToStaticMarkup(createElement(CompanyAnalysisList, {
      analyses: [analysis],
      onOpenBrief() {},
    }));
    const brief = renderToStaticMarkup(createElement(CompanyBrief, {
      analysis,
      activeTab: "IC Snapshot",
      onTab() {},
      onClose() {},
    }));
    assert.doesNotMatch(list, label);
    assert.doesNotMatch(brief, label);
  }
});

test("presentation-only sample profiles stay off unless a caller explicitly opts into public demo enrichment", () => {
  const analysis = analysisFixture();
  analysis.dealId = "deal_1906";
  const html = renderToStaticMarkup(createElement(PriorityResult, {
    analysis,
    onOpenBrief() {},
  }));

  assert.doesNotMatch(html, /Sample deal profile|\$9\.8M/);
});

test("failed hard gates show their exact persisted failure reason", () => {
  const analysis = analysisFixture();
  analysis.beliefAssessment!.gates.counterevidence = {
    statement: "",
    citedSourceIds: [],
    passed: false,
    failureReason: "No cited counterevidence was retained.",
  };
  analysis.beliefAssessment!.gates.allPassed = false;
  const html = renderToStaticMarkup(createElement(PriorityResult, {
    analysis,
    onOpenBrief() {},
    showDemoProfiles: false,
  }));

  assert.match(html, /Counterevidence[\s\S]*Failed/);
  assert.match(html, /No cited counterevidence was retained\./);
});

test("current monitor analyses render persisted score and audit gates instead of a legacy fallback", () => {
  const analysis = analysisFixture();
  analysis.outcome = "monitor";
  analysis.confidence = "medium";
  analysis.score = 0.62;
  analysis.beliefAssessment = undefined;
  analysis.currentRunAudit = {
    schemaVersion: "company-analysis-current-run-audit-v1",
    workspaceId: "workspace_demo",
    companyId: "company_example",
    stableDealId: analysis.dealId,
    priorDealStatus: analysis.dealStatus,
    analysisEligibleAt: "2026-04-01T12:00:00.000Z",
    dealUniverseId: "deal-universe-example",
    dealUniverseFingerprint: SOURCE_FINGERPRINT,
    evidenceContextFingerprint: CONTEXT_FINGERPRINT,
    evidenceBindingFingerprint: BINDING_FINGERPRINT,
    activeParentFingerprint: SNAPSHOT_FINGERPRINT,
    sourceRevisionIds: ["revision_public_exact"],
    xtraceMemoryIds: ["memory_fixture_example"],
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
    consideredMarketEventIds: ["event_company_adoption"],
    matchedMarketEventIds: ["event_company_adoption"],
    scoreBreakdown: {
      eventRelevance: 0.7,
      dealRelevance: 0.6,
      priorContextStrength: 0.6,
      evidenceQuality: 0.5,
      finalScore: 0.62,
      confidence: "medium",
    },
    gates: {
      chronology: { passed: true, failureReason: null },
      revisitConditionMapping: {
        passed: false,
        failureReason: "The event does not satisfy the persisted revisit condition.",
      },
      counterevidence: { passed: true, failureReason: null },
      actionDelta: {
        passed: false,
        failureReason: "The proposed action does not differ from the prior action.",
      },
      allPassed: false,
    },
    direction: "positive",
    actions: [{
      kind: "continue_monitoring",
      scope: "deal",
      priority: "standard",
      visibility: "internal_only",
    }],
    outcome: "monitor",
    nonChangeReason: null,
    analysisFailureReason: null,
    whyNotUnderwriting: "Required belief-revision hard gates did not all pass.",
    recall: {
      attempted: true,
      succeeded: true,
      failureReason: null,
    },
  };

  const html = renderToStaticMarkup(createElement(CompanyBrief, {
    analysis,
    activeTab: "IC Snapshot",
    onTab() {},
    onClose() {},
  }));

  assert.match(html, /WEIGHTED MATCH CONFIDENCE[\s\S]*62% · medium/);
  assert.match(html, /Revisit-condition mapping[\s\S]*Failed/);
  assert.match(html, /The event does not satisfy the persisted revisit condition\./);
  assert.match(html, /Why Deep Underwriting did not start/);
  assert.match(html, /Required belief-revision hard gates did not all pass\./);
  assert.doesNotMatch(html, /legacy analysis/);
});

test("decision history derives the permanent Sample decision record label from fixture lineage", () => {
  const analysis = analysisFixture();
  analysis.companyBrief.decisionHistory[0]!.title = "passed decision";
  const html = renderToStaticMarkup(createElement(CompanyBrief, {
    analysis,
    activeTab: "Decision History",
    onTab() {},
    onClose() {},
    showDemoProfiles: false,
  }));

  assert.match(html, /Sample decision record/);
  assert.match(html, /passed decision/);
});

test("source lineage separates exact quotation from normalized, legacy, and model text and exposes full provenance", () => {
  const analysis = analysisFixture([
    exactPublicSource(),
    exactDocumentSource(),
    normalizedSource(),
    legacySource(),
    modelInferenceSource(),
    sampleDecisionSource(),
  ]);
  const html = renderToStaticMarkup(createElement(CompanyBrief, {
    analysis,
    activeTab: "Source Lineage",
    onTab() {},
    onClose() {},
    showDemoProfiles: false,
  }));

  assert.match(html, /Verified verbatim excerpt/);
  assert.match(
    html,
    /<blockquote>“Named customers now use the product in production\.”<\/blockquote>/,
  );
  assert.match(html, /Normalized statement · Not a quotation/);
  assert.match(html, /Normalized-only evidence · Not a quotation/);
  assert.match(html, /Legacy unverified statement · Not a quotation/);
  assert.match(html, /Model inference · Not a fact or quotation/);
  assert.doesNotMatch(
    html,
    /<blockquote>[^<]*(?:Provider-normalized|legacy row|may satisfy)[^<]*<\/blockquote>/i,
  );

  for (const label of [
    "Event date · date precision",
    "Publication date · timestamp precision",
    "Retrieval date · timestamp precision",
    "Update date · date precision",
    "Source class",
    "Source authority",
    "Evidence role",
    "Provider",
    "Entity keys",
    "Locator",
    "Content fingerprint",
    "Source Revision",
  ]) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /href="https:\/\/example\.com\/official-launch"/);
  assert.match(
    html,
    /href="\/api\/source-revisions\/revision_public_exact\/access"/,
  );
  assert.match(
    html,
    /href="\/api\/source-revisions\/revision_document_page_exact\/access#page=6"/,
  );
  assert.doesNotMatch(html, /\/api\/documents\/document_public_exact\/access/);
  assert.doesNotMatch(html, /\/api\/documents\/document_identity_not_revision\/access/);
  assert.doesNotMatch(html, /\/api\/source-revisions\/source_public_exact\/access/);
});

test("IC Snapshot renders structured fact, unavailable, conflict, assumption, and unknown classifications without fabrication", () => {
  const analysis = analysisFixture([
    exactPublicSource(),
    normalizedSource(),
    sampleDecisionSource(),
  ]);
  analysis.companyBrief.structuredFields = [
    {
      id: "semantic-field-111111111111111111111111",
      schemaVersion: "deal-semantic-field-v1",
      fieldId: "company_identity",
      classification: "fact",
      availability: "available",
      value: "Example AI Holdings, Inc.",
      basis: "Official company announcement",
      asOfDate: "2026-07-29",
      sourceIds: ["source_public_exact"],
    },
    {
      id: "semantic-field-222222222222222222222222",
      schemaVersion: "deal-semantic-field-v1",
      fieldId: "founders",
      classification: "unavailable",
      availability: "unavailable",
      reason: "Founder identities were not confirmed by accepted evidence.",
      checkedSourceIds: ["source_public_exact"],
    },
    {
      id: "semantic-field-333333333333333333333333",
      schemaVersion: "deal-semantic-field-v1",
      fieldId: "founding_date",
      classification: "conflicting",
      observations: [
        { value: "2023", sourceId: "source_public_exact" },
        { value: "2024", sourceId: "source_normalized" },
      ],
    },
    {
      id: "semantic-field-444444444444444444444444",
      schemaVersion: "deal-semantic-field-v1",
      fieldId: "security_type",
      classification: "assumption",
      value: "preferred",
      basis: "assumption",
      requiresConfirmation: true,
      assumptionPolicyVersion: "belief-reversal-demo-context-v1",
      rationale: "The public round announcement does not disclose security type.",
      sourceBoundary: "No accepted source states the security instrument.",
    },
    {
      id: "semantic-field-555555555555555555555555",
      schemaVersion: "deal-semantic-field-v1",
      fieldId: "unknowns",
      classification: "unknown",
      reason: "Customer retention remains unknown.",
      externalLabel: "Current customer retention evidence",
    },
  ];
  const html = renderToStaticMarkup(createElement(CompanyBrief, {
    analysis,
    activeTab: "IC Snapshot",
    onTab() {},
    onClose() {},
    showDemoProfiles: false,
  }));

  assert.match(html, /Company identity[\s\S]*Example AI Holdings, Inc\./);
  assert.match(html, /Founders[\s\S]*Unavailable/);
  assert.match(html, /Founder identities were not confirmed/);
  assert.match(html, /Founding date[\s\S]*Conflicting evidence/);
  assert.match(html, /2023[\s\S]*2024/);
  assert.match(html, /Security type[\s\S]*Assumption · Requires confirmation/);
  assert.match(html, /Unknowns[\s\S]*Customer retention remains unknown/);
  assert.match(html, /WEIGHTED MATCH CONFIDENCE[\s\S]*Event relevance · 35%/);
});

test("report detail separates its evidence status and readable window from immutable context identity", () => {
  const analysis = analysisFixture();
  const report = reportFixture(analysis);
  const context = report.evidenceContext;
  if (!context || context.state !== "current") {
    throw new Error("The report fixture must include a current evidence context.");
  }
  report.evidenceContext = {
    ...context,
    evidenceMode: "live" as const,
    snapshotId: null,
    snapshotFingerprint: null,
    displayLabel: "Live evidence window ending 2026-08-01T23:59:59.999Z",
  };
  const html = renderToStaticMarkup(createElement(CompanyIntelligenceReport, {
    report,
    focused: true,
    allowDraft: false,
    onDraft() {},
    showDemoProfiles: false,
    underwritingEnabled: false,
    canSaveActionDrafts: false,
  }));

  assert.match(html, /LIVE EVIDENCE[\s\S]*Evidence window/);
  assert.match(html, /Jul 19, 2026 – Aug 1, 2026/);
  assert.doesNotMatch(html, /2026-08-01T23:59:59\.999Z/);
  assert.match(html, /Not applicable to live evidence/);
  assert.match(html, /Context fingerprint/);
  assert.match(html, new RegExp(CONTEXT_FINGERPRINT));
  assert.match(html, /Belief Change Analysis/);
  assert.match(html, /30[\s\S]*Eligible Deals/);
  assert.match(html, /30[\s\S]*Belief Change Checks/);
  assert.match(html, /1[\s\S]*Underwriting terminal/);
  assert.match(html, /Belief Revisions/);
  assert.match(html, /Changed Belief/);
  assert.doesNotMatch(
    html,
    /Top[ -]?5|Selected for Top|rank cutoff|sixth.*reject/i,
  );
});

test("product Deal history keeps the permanent Sample decision record label", () => {
  const html = renderToStaticMarkup(createElement(DealsView, {
    deals: [{
      id: "deal_example",
      companyName: "Example AI",
      status: "passed" as const,
      documentId: "document_fixture",
      sourceTitle: "Confirmed source",
      sourceUrl: "/api/source-revisions/revision_fixture_example/access",
      sourceRevisionIds: ["revision_fixture_example"],
      sourceLinks: [{
        sourceRevisionId: "revision_fixture_example",
        sourceUrl: "/api/source-revisions/revision_fixture_example/access",
      }],
      fixture: {
        id: "fixture_example_passed_v1",
        label: "Sample decision record",
        provenance: "demo_fixture" as const,
        meetingSummary: "The sample team reviewed an early product demo.",
        decisionReason: "The sample team passed pending production adoption.",
        concerns: ["No named production users were public."],
        revisitConditions: ["Revisit after named production adoption."],
      },
    }],
    uploads: [],
    query: "",
    deploymentMode: "product" as const,
    onQuery() {},
  }));

  assert.match(html, /Sample decision record/);
  assert.match(html, /The sample team passed pending production adoption\./);
  assert.match(html, /No named production users were public\./);
  assert.match(html, /Revisit after named production adoption\./);
});

test("legacy report source links show a public URL beside the exact revision and never substitute document or evidence IDs", () => {
  const publicSource = exactPublicSource();
  const internalSource: CanonicalSourceRefV2 = {
    ...exactPublicSource(),
    id: "source_internal",
    provenance: "source_document",
    title: "Internal source document",
    canonicalUrl: null,
    documentId: "document_internal",
    providerId: "document-registry",
    eventAt: null,
    eventAtPrecision: null,
    publishedAt: null,
    publishedAtPrecision: null,
    updatedAt: null,
    updatedAtPrecision: null,
    sourceClass: "internal_decision_record",
    sourceAuthority: "primary",
    evidenceRole: "context",
    sourceRevisionId: "revision_internal",
    locator: { kind: "document_page", page: 3 },
  };
  const report: IntelligenceReportView = {
    ...reportFixture(analysisFixture()),
    priorityDealId: null,
    companyAnalyses: [],
    counts: {
      companyCount: 0,
      beliefRevised: 0,
      monitor: 0,
      noMaterialChange: 0,
      analysisUnavailable: 0,
    },
    opportunities: [{
      rank: 1,
      dealId: "deal_example",
      confidence: "high",
      score: 0.79,
      whyNow: "Production adoption changed the checkpoint.",
      previousContext: "The sample team had passed.",
      implications: { positive: [], negative: [] },
      nextStep: "Reopen diligence.",
      sources: [publicSource, internalSource],
      demoFixtureIds: ["fixture_legacy_sample"],
    }],
  };
  const html = renderToStaticMarkup(createElement(ReportsView, {
    reports: [report],
    deals: [],
    onDraft() {},
    focusedReportId: null,
    deploymentMode: "product" as const,
    canSaveActionDrafts: false,
  }));

  assert.match(html, /href="https:\/\/example\.com\/official-launch"/);
  assert.match(
    html,
    /href="\/api\/source-revisions\/revision_public_exact\/access"/,
  );
  assert.match(
    html,
    /href="\/api\/source-revisions\/revision_internal\/access#page=3"/,
  );
  assert.doesNotMatch(html, /\/api\/documents\/document_internal\/access/);
  assert.doesNotMatch(html, /\/api\/source-revisions\/source_internal\/access/);
  assert.match(html, /Sample decision record/);
});

test("legacy authorized document links remain available without guessing that a document or evidence ID is a revision", () => {
  const report: IntelligenceReportView = {
    ...reportFixture(analysisFixture()),
    priorityDealId: null,
    companyAnalyses: [],
    counts: {
      companyCount: 0,
      beliefRevised: 0,
      monitor: 0,
      noMaterialChange: 0,
      analysisUnavailable: 0,
    },
    opportunities: [{
      rank: 1,
      dealId: "deal_legacy_document",
      confidence: "medium",
      score: 0.6,
      whyNow: "A legacy report retained an authorized internal document.",
      previousContext: "Legacy prior context.",
      implications: { positive: [], negative: [] },
      nextStep: "Review the exact legacy source.",
      sources: [{
        id: "legacy_evidence_id_not_a_revision",
        provenance: "source_document",
        title: "Authorized legacy document",
        documentId: "legacy_document_1",
        page: 4,
        excerpt: "Legacy source content.",
      }],
      demoFixtureIds: [],
    }],
  };
  const html = renderToStaticMarkup(createElement(ReportsView, {
    reports: [report],
    deals: [],
    onDraft() {},
    focusedReportId: null,
    deploymentMode: "product" as const,
    canSaveActionDrafts: false,
  }));

  assert.match(
    html,
    /href="\/api\/documents\/legacy_document_1\/access#page=4"/,
  );
  assert.doesNotMatch(
    html,
    /\/api\/source-revisions\/legacy_(?:document_1|evidence_id_not_a_revision)\/access/,
  );
});

test("product Chat citations use an explicit typed Source Revision identity", () => {
  const html = renderToStaticMarkup(createElement(ChatView, {
    messages: [{
      role: "assistant" as const,
      text: "A finalized persisted fact matched.",
      citations: [{
        id: "citation_identity_not_revision",
        provenance: "source_document" as const,
        title: "Source Revision revision_chat_exact",
        url: "/api/source-revisions/revision_chat_exact/access",
        sourceRevisionId: "revision_chat_exact",
        excerpt: "Finalized persisted underwriting source revision.",
      }],
    }],
    question: "",
    onQuestion() {},
    onSubmit() {},
    busy: false,
    xtraceEnabled: true,
    deploymentMode: "product" as const,
    reportScope: null,
  }));

  assert.match(
    html,
    /href="\/api\/source-revisions\/revision_chat_exact\/access"/,
  );
  assert.doesNotMatch(
    html,
    /\/api\/source-revisions\/citation_identity_not_revision\/access/,
  );
});
