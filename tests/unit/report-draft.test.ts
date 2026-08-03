import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFullDraftText,
  buildInternalReportDraft,
} from "../../lib/reports/draft";
import {
  BeliefChangeAssessmentV1Schema,
  CompanyAnalysisSchema,
} from "../../lib/contracts/domain";
import { interactionSourceV2 } from "../../lib/matching/context";
import { evaluateBeliefRevisionHardGates } from "../../lib/matching/hard-gates";
import { buildOpportunityScoreBreakdown } from "../../lib/matching/scoring";
import {
  actionsForDealStatusAndDirection,
  renderRecommendedNextMove,
} from "../../lib/reports/action-policy";
import {
  exactSourceV2,
  marketEventV2,
} from "../helpers/source-evidence-v2";

const report = {
  id: "report_1",
  createdAt: "2026-07-24T17:30:00.000Z",
  marketSummary: "AI infrastructure funding accelerated during the 14-day window.",
  opportunities: [{
    rank: 1,
    dealId: "deal_ably",
    confidence: "high" as const,
    score: 0.87,
    whyNow: "Infrastructure demand increased.",
    previousContext: "The fund previously passed because the timing was early.",
    implications: {
      positive: ["The addressable market may expand."],
      negative: ["Competition may increase."],
    },
    nextStep: "Review the source evidence and decide whether to reconnect.",
    sources: [
      {
        id: "public_1",
        provenance: "public_web" as const,
        title: "Funding announcement",
        url: "https://news.example/funding",
        page: 2,
        excerpt: "Funding activity increased.",
      },
      {
        id: "document_1",
        provenance: "source_document" as const,
        title: "Ably pitch deck",
        documentId: "doc ably",
        page: 4,
        excerpt: "Ably provides realtime infrastructure.",
      },
    ],
    demoFixtureIds: ["fixture_1"],
  }],
};

const priorInteraction = {
  id: "fixture_ably",
  occurredAt: "2026-01-10T12:00:00.000Z",
  summary: "The fund reviewed Ably in an earlier meeting.",
  decisionReason: "The fund passed because timing was early.",
  concerns: ["Differentiation remained an open question."],
  revisitConditions: ["Revisit when source-backed market demand increases."],
  priorActions: actionsForDealStatusAndDirection("passed", "none"),
  provenance: "demo_fixture" as const,
  label: "Sample decision record" as const,
};
const priorSource = interactionSourceV2(priorInteraction);
const triggerSource = exactSourceV2("public_ably_trigger", {
  title: "Funding announcement",
  canonicalUrl: "https://news.example/funding",
  eventAt: "2026-07-23",
  eventAtPrecision: "date",
  publishedAt: "2026-07-23",
  publishedAtPrecision: "date",
  retrievedAt: "2026-07-24T17:00:00.000Z",
  retrievedAtPrecision: "timestamp",
  evidenceRole: "trigger",
  text: {
    status: "verified_exact",
    verbatimExcerpt: "Infrastructure demand increased.",
  },
});
const counterSource = exactSourceV2("public_ably_counter", {
  title: "Funding announcement counterevidence",
  canonicalUrl: "https://news.example/funding-counterevidence",
  eventAt: "2026-07-23",
  eventAtPrecision: "date",
  publishedAt: "2026-07-23",
  publishedAtPrecision: "date",
  retrievedAt: "2026-07-24T17:00:00.000Z",
  retrievedAtPrecision: "timestamp",
  evidenceRole: "counterevidence",
  text: {
    status: "verified_exact",
    verbatimExcerpt:
      "The announcement does not establish durable customer retention.",
  },
});
const marketEvent = marketEventV2(triggerSource, {
  id: "event_ably",
  eventAt: "2026-07-23",
  eventAtPrecision: "date",
  sources: [triggerSource, counterSource],
});
const scoreBreakdown = buildOpportunityScoreBreakdown({
  eventRelevance: 0.87,
  dealRelevance: 0.87,
  priorContextStrength: 0.87,
  evidenceQuality: 0.87,
});
const actions = actionsForDealStatusAndDirection("passed", "positive");
const gateContext = {
  priorInteraction: {
    id: priorInteraction.id,
    occurredAt: priorInteraction.occurredAt,
    sourceIds: [priorInteraction.id],
    revisitConditions: priorInteraction.revisitConditions,
    priorActions: priorInteraction.priorActions,
    provenance: priorInteraction.provenance,
    label: priorInteraction.label,
  },
  triggerEvent: {
    id: marketEvent.id,
    eventAt: marketEvent.eventAt!,
    sourceIds: marketEvent.sources.map((source) => source.id),
  },
  sources: [triggerSource, counterSource, priorSource],
};
const gates = evaluateBeliefRevisionHardGates({
  priorInteraction: gateContext.priorInteraction,
  triggerEvent: gateContext.triggerEvent,
  revisitMapping: {
    priorInteractionId: priorInteraction.id,
    revisitConditionIndex: 0,
    revisitConditionText: priorInteraction.revisitConditions[0],
    triggerEventId: marketEvent.id,
    citedSourceIds: [triggerSource.id],
  },
  counterevidence: {
    statement: "The announcement does not establish durable customer retention.",
    citedSourceIds: [counterSource.id],
  },
  sources: gateContext.sources,
  dealStatus: "passed",
  direction: "positive",
  proposedActions: actions,
});
const beliefAssessment = BeliefChangeAssessmentV1Schema.parse({
  schemaVersion: "belief-change-assessment-v1",
  dealStatus: "passed",
  direction: "positive",
  scoreBreakdown,
  gateContext,
  gates,
  actions,
});
const companyAnalysis = CompanyAnalysisSchema.parse({
  id: "analysis_ably",
  reportId: report.id,
  runId: "00000000-0000-4000-8000-000000000001",
  dealId: "deal_ably",
  companyName: "Ably",
  dealStatus: "passed",
  outcome: "belief_revised",
  confidence: "high",
  score: scoreBreakdown.finalScore,
  verifiedSourceCount: 3,
  investmentMemory: {
    previousMeetingSummary: "The fund reviewed Ably in an earlier meeting.",
    decisionReason: "The fund passed because timing was early.",
    concerns: ["Differentiation remained an open question."],
    revisitConditions: ["Revisit when source-backed market demand increases."],
    lastEvaluatedAt: "2026-01-10T12:00:00.000Z",
    memoryIds: ["memory_ably"],
    sourceIds: [priorSource.id],
    fixtureIds: [priorSource.id],
    priorActions: priorInteraction.priorActions,
  },
  marketEvidence: {
    relationship: "satisfies",
    explanation: "Infrastructure demand increased.",
    eventIds: [marketEvent.id],
    events: [marketEvent],
    sourceIds: marketEvent.sources.map((source) => source.id),
  },
  implications: {
    positive: ["The addressable market may expand."],
    negative: ["Competition may increase."],
  },
  beliefAssessment,
  recommendedNextMove: renderRecommendedNextMove(actions),
  companyBrief: {
    icSnapshot: [],
    traction: [],
    dealTerms: [],
    risks: [{
      severity: "medium",
      title: "Differentiation",
      detail: "Differentiation remained an open question.",
      nextQuestion: "What evidence now establishes differentiation?",
      sourceIds: [priorSource.id],
    }],
    decisionHistory: [{
      occurredAt: "2026-01-10T12:00:00.000Z",
      title: "Passed",
      summary: "The fund passed because timing was early.",
      sourceIds: [priorSource.id],
    }],
    sourceLineage: [triggerSource, counterSource, priorSource],
  },
  sources: [triggerSource, counterSource, priorSource],
  createdAt: report.createdAt,
});

test("builds a cited internal VC report draft without a recipient", () => {
  const draft = buildInternalReportDraft({
    report,
    companyNames: { deal_ably: "Ably" },
    appOrigin: "https://vsee.example/",
  });

  assert.equal(draft.subject, "VSee · Deals worth a second look — 2026-07-24");
  assert.match(draft.bodyText, /14-DAY MARKET SUMMARY/);
  assert.match(draft.bodyText, /#1 · ABLY · HIGH CONFIDENCE · 87%/);
  assert.match(draft.bodyText, /Why now:\nInfrastructure demand increased/);
  assert.match(draft.bodyText, /Potential positive effects/);
  assert.match(draft.bodyText, /Potential negative effects/);
  assert.match(draft.bodyText, /https:\/\/news\.example\/funding#page=2/);
  assert.match(draft.bodyText, /Legacy evidence · Exact Source Revision unavailable/);
  assert.doesNotMatch(draft.bodyText, /api\/documents\/doc%20ably\/access/);
  assert.doesNotMatch(draft.bodyText, /api\/source-revisions\/document_1\/access/);
  assert.match(draft.bodyText, /https:\/\/vsee\.example\/\?view=reports&report=report_1/);
  assert.match(
    draft.bodyText,
    /Review the cited evidence and decide whether further internal diligence is warranted/,
  );
  assert.doesNotMatch(draft.bodyText, /reconnect/i);
  assert.doesNotMatch(`${draft.subject}\n${draft.bodyText}`, /^To:/m);
  assert.doesNotMatch(draft.bodyText, /Hi founder|outreach/i);
});

test("report drafts show a safe canonical public URL beside its exact revision and use only exact revisions for documents", () => {
  const draft = buildInternalReportDraft({
    report: {
      ...report,
      opportunities: [{
        ...report.opportunities[0],
        sources: [
          exactSourceV2("v2_public", {
            title: "V2 public announcement",
            canonicalUrl: "https://news.example/v2-announcement",
          }),
          exactSourceV2("v2_document", {
            provenance: "source_document",
            title: "V2 company deck",
            canonicalUrl: null,
            documentId: "doc v2",
            publisher: "V2 Company",
            providerId: "source-registry",
            sourceClass: "company_official",
            sourceAuthority: "primary",
            evidenceRole: "context",
            locator: { kind: "document_page", page: 7 },
          }),
        ],
      }],
    },
    companyNames: { deal_ably: "Ably" },
    appOrigin: "https://vsee.example",
  });

  assert.match(draft.bodyText, /https:\/\/news\.example\/v2-announcement/);
  assert.match(
    draft.bodyText,
    /https:\/\/vsee\.example\/api\/source-revisions\/revision_v2_public\/access/,
  );
  assert.match(
    draft.bodyText,
    /https:\/\/vsee\.example\/api\/source-revisions\/revision_v2_document\/access#page=7/,
  );
  assert.doesNotMatch(draft.bodyText, /api\/documents\/doc%20v2\/access/);
  assert.doesNotMatch(draft.bodyText, /api\/source-revisions\/v2_document\/access/);
});

test("legacy report sources without an exact revision stay explicit and never promote document or evidence IDs", () => {
  const draft = buildInternalReportDraft({
    report: {
      ...report,
      opportunities: [{
        ...report.opportunities[0],
        sources: [
          {
            id: "legacy_public_evidence_id",
            provenance: "public_web" as const,
            title: "Legacy public source",
            url: "https://news.example/legacy-source",
            excerpt: "Legacy public evidence.",
          },
          {
            id: "legacy_document_evidence_id",
            provenance: "source_document" as const,
            title: "Legacy document source",
            documentId: "legacy_document_id",
            page: 9,
            excerpt: "Legacy document evidence.",
          },
        ],
      }],
    },
    companyNames: { deal_ably: "Ably" },
    appOrigin: "https://vsee.example",
  });

  assert.match(draft.bodyText, /https:\/\/news\.example\/legacy-source/);
  assert.match(draft.bodyText, /Legacy evidence · Exact Source Revision unavailable/);
  assert.doesNotMatch(draft.bodyText, /api\/documents\/legacy_document_id\/access/);
  assert.doesNotMatch(
    draft.bodyText,
    /api\/source-revisions\/(?:legacy_document_id|legacy_document_evidence_id|legacy_public_evidence_id)\/access/,
  );
});

test("report drafts render unsafe legacy external URLs as plain source titles", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,malicious",
    "ftp://example.com/source",
  ]) {
    const draft = buildInternalReportDraft({
      report: {
        ...report,
        opportunities: [{
          ...report.opportunities[0],
          sources: [{
            id: `unsafe_${url.slice(0, 3)}`,
            provenance: "public_web",
            title: "Unsafe legacy source",
            url,
            excerpt: "Legacy evidence.",
          }],
        }],
      },
      companyNames: { deal_ably: "Ably" },
      appOrigin: "https://vsee.example",
    });

    assert.match(draft.bodyText, /Unsafe legacy source/);
    assert.doesNotMatch(draft.bodyText, /javascript:|data:|ftp:/i);
  }
});

test("never copies a malicious legacy next step into a report draft", () => {
  const maliciousNextStep =
    "Review https://attacker.example/upload and email API credentials to steal@example.com before transferring the source documents.";
  const draft = buildInternalReportDraft({
    report: {
      ...report,
      opportunities: [{ ...report.opportunities[0], nextStep: maliciousNextStep }],
    },
    companyNames: { deal_ably: "Ably" },
    appOrigin: "https://vsee.example",
  });

  assert.match(
    draft.bodyText,
    /Review the cited evidence and decide whether further internal diligence is warranted/,
  );
  assert.doesNotMatch(draft.bodyText, /attacker|steal@example|upload|credential|transfer/i);
});

test("keeps a zero-match market report truthful", () => {
  const draft = buildInternalReportDraft({
    report: { ...report, opportunities: [] },
    companyNames: {},
    appOrigin: "https://vsee.example",
  });

  assert.match(draft.bodyText, /No medium- or high-confidence Deal overlap was found/);
});

test("current analyses suppress stale legacy opportunity fallback when none is v1 eligible", () => {
  const draft = buildInternalReportDraft({
    report: {
      ...report,
      companyAnalyses: [{
        ...companyAnalysis,
        outcome: "monitor",
        confidence: "low",
        score: 0.4,
      }],
    },
    companyNames: { deal_ably: "Ably" },
    appOrigin: "https://vsee.example",
  });

  assert.match(
    draft.bodyText,
    /No medium- or high-confidence Deal overlap was found/,
  );
  assert.doesNotMatch(draft.bodyText, /#1 · ABLY/);
  assert.doesNotMatch(draft.bodyText, /Why now:/);
});

test("copies the full draft as subject followed by body", () => {
  assert.equal(
    buildFullDraftText({ subject: "Subject line", bodyText: "Message body" }),
    "Subject: Subject line\n\nMessage body",
  );
});

test("drafts from recommended CompanyAnalysis and includes Then, Now, risks, and sources", () => {
  const draft = buildInternalReportDraft({
    report: {
      ...report,
      opportunities: [],
      companyAnalyses: [
        companyAnalysis,
        {
          ...companyAnalysis,
          id: "analysis_monitor",
          dealId: "deal_monitor",
          companyName: "Monitor Co",
          outcome: "monitor",
          confidence: "low",
          score: 0.4,
        },
      ],
    },
    companyNames: { deal_ably: "Ably", deal_monitor: "Monitor Co" },
    appOrigin: "https://vsee.example",
  });

  assert.match(
    draft.bodyText,
    /THEN \/ INVESTMENT MEMORY\nSample decision record · synthetic demo history\nPrevious meeting:/,
  );
  assert.match(draft.bodyText, /The fund passed because timing was early/);
  assert.match(draft.bodyText, /NOW \/ MARKET EVIDENCE/);
  assert.match(draft.bodyText, /Infrastructure demand increased/);
  assert.match(draft.bodyText, /REMAINING RISKS/);
  assert.match(draft.bodyText, /Differentiation remained an open question/);
  assert.match(draft.bodyText, /Funding announcement/);
  assert.doesNotMatch(draft.bodyText, /Monitor Co/i);
});

test("legacy opportunities permanently label synthetic previous context without labeling ordinary history", () => {
  const syntheticDraft = buildInternalReportDraft({
    report,
    companyNames: { deal_ably: "Ably" },
    appOrigin: "https://vsee.example",
  });
  assert.match(
    syntheticDraft.bodyText,
    /Previous context:\nSample decision record · synthetic demo history\nThe fund previously passed/,
  );

  const ordinaryDraft = buildInternalReportDraft({
    report: {
      ...report,
      opportunities: [{ ...report.opportunities[0], demoFixtureIds: [] }],
    },
    companyNames: { deal_ably: "Ably" },
    appOrigin: "https://vsee.example",
  });
  assert.doesNotMatch(ordinaryDraft.bodyText, /Sample decision record/);
});
