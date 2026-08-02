import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFullDraftText,
  buildInternalReportDraft,
} from "../../lib/reports/draft";
import type { CompanyAnalysis } from "../../lib/contracts/domain";
import {
  exactSourceV2,
  normalizedSourceV2,
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

const companyAnalysis: CompanyAnalysis = {
  id: "analysis_ably",
  reportId: report.id,
  runId: "00000000-0000-4000-8000-000000000001",
  dealId: "deal_ably",
  companyName: "Ably",
  dealStatus: "passed",
  outcome: "belief_revised",
  confidence: "high",
  score: 0.87,
  verifiedSourceCount: 2,
  investmentMemory: {
    previousMeetingSummary: "The fund reviewed Ably in an earlier meeting.",
    decisionReason: "The fund passed because timing was early.",
    concerns: ["Differentiation remained an open question."],
    revisitConditions: ["Revisit when source-backed market demand increases."],
    lastEvaluatedAt: "2026-01-10T12:00:00.000Z",
    memoryIds: ["memory_ably"],
    sourceIds: ["document_1"],
    fixtureIds: ["fixture_1"],
  },
  marketEvidence: {
    relationship: "satisfies",
    explanation: "Infrastructure demand increased.",
    eventIds: ["event_1"],
    events: [{
      id: "event_1",
      title: "Funding announcement",
      eventType: "funding",
      publishedAt: "2026-07-23T12:00:00.000Z",
      sourceIds: ["public_1"],
    }],
    sourceIds: ["public_1"],
  },
  implications: {
    positive: ["The addressable market may expand."],
    negative: ["Competition may increase."],
  },
  recommendedNextMove:
    "Review the cited evidence and decide whether to reopen internal diligence.",
  companyBrief: {
    icSnapshot: [],
    traction: [],
    dealTerms: [],
    risks: [{
      severity: "medium",
      title: "Differentiation",
      detail: "Differentiation remained an open question.",
      nextQuestion: "What evidence now establishes differentiation?",
      sourceIds: ["document_1"],
    }],
    decisionHistory: [{
      occurredAt: "2026-01-10T12:00:00.000Z",
      title: "Passed",
      summary: "The fund passed because timing was early.",
      sourceIds: ["document_1"],
    }],
    sourceLineage: report.opportunities[0].sources,
  },
  sources: report.opportunities[0].sources,
  createdAt: report.createdAt,
};

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
  assert.match(
    draft.bodyText,
    /https:\/\/vsee\.example\/api\/documents\/doc%20ably\/access#page=4/,
  );
  assert.match(draft.bodyText, /https:\/\/vsee\.example\/\?view=reports&report=report_1/);
  assert.match(
    draft.bodyText,
    /Review the cited evidence and decide whether further internal diligence is warranted/,
  );
  assert.doesNotMatch(draft.bodyText, /reconnect/i);
  assert.doesNotMatch(`${draft.subject}\n${draft.bodyText}`, /^To:/m);
  assert.doesNotMatch(draft.bodyText, /Hi founder|outreach/i);
});

test("report drafts preserve v2 canonical URLs and typed document pages", () => {
  const draft = buildInternalReportDraft({
    report: {
      ...report,
      opportunities: [{
        ...report.opportunities[0],
        sources: [
          normalizedSourceV2("v2_public", {
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
    /https:\/\/vsee\.example\/api\/documents\/doc%20v2\/access#page=7/,
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

  assert.match(draft.bodyText, /THEN \/ INVESTMENT MEMORY/);
  assert.match(draft.bodyText, /The fund passed because timing was early/);
  assert.match(draft.bodyText, /NOW \/ MARKET EVIDENCE/);
  assert.match(draft.bodyText, /Infrastructure demand increased/);
  assert.match(draft.bodyText, /REMAINING RISKS/);
  assert.match(draft.bodyText, /Differentiation remained an open question/);
  assert.match(draft.bodyText, /Funding announcement/);
  assert.doesNotMatch(draft.bodyText, /Monitor Co/i);
});
