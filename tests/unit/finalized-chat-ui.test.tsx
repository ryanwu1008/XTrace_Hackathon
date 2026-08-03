import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildChatApiRequest,
  ChatView,
  mergeResolvedChatScope,
  resolveReportChatScope,
  shouldApplyChatResponse,
  shouldResetChatTranscript,
} from "../../app/page";
import type { IntelligenceReportView } from "../../app/company-intelligence";

const PINNED_CONTEXT = {
  state: "current" as const,
  schemaVersion: "run-evidence-context-v1" as const,
  evidenceMode: "pinned" as const,
  windowDays: 14 as const,
  anchorAt: "2026-08-01T23:59:59.000-07:00",
  windowStartAt: "2026-07-19T00:00:00.000-07:00",
  windowEndAt: "2026-08-01T23:59:59.000-07:00",
  windowTimezone: "America/Los_Angeles",
  snapshotId: "belief_reversal_2026_08_01",
  snapshotFingerprint: `sha256:${"1".repeat(64)}`,
  contextFingerprint: `sha256:${"2".repeat(64)}`,
  displayLabel: "Demo evidence snapshot as of 2026-08-01",
  eventCount: 4,
  eventSetFingerprint: `sha256:${"3".repeat(64)}`,
  bindingFingerprint: `sha256:${"4".repeat(64)}`,
};

function reportFixture(): IntelligenceReportView {
  return {
    id: "report_chat_ui",
    runId: "11111111-1111-4111-8111-111111111111",
    createdAt: "2026-08-01T12:00:00.000Z",
    marketSummary: "Pinned report.",
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
    },
    priorityDealId: "deal_chat_ui",
    companyAnalyses: [{
      dealId: "deal_chat_ui",
      companyName: "Pinned Example Co",
    } as IntelligenceReportView["companyAnalyses"][number]],
    evidenceContext: PINNED_CONTEXT,
  };
}

test("report Chat scope preserves company and evidence-frame presentation without serializing presentation metadata", () => {
  const scope = resolveReportChatScope(reportFixture());
  assert.deepEqual(scope, {
    reportId: "report_chat_ui",
    runId: "11111111-1111-4111-8111-111111111111",
    dealId: "deal_chat_ui",
    companyName: "Pinned Example Co",
    evidenceContext: PINNED_CONTEXT,
  });

  const request = buildChatApiRequest({
    question: "Which new evidence changed that belief?",
    xtraceEnabled: true,
    scope,
    deploymentMode: "public_sandbox",
  });
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    question: "Which new evidence changed that belief?",
    reportId: "report_chat_ui",
    runId: "11111111-1111-4111-8111-111111111111",
    dealId: "deal_chat_ui",
  });
});

test("Chat header identifies the exact company and pinned evidence context", () => {
  const scope = resolveReportChatScope(reportFixture());
  const html = renderToStaticMarkup(createElement(ChatView, {
    messages: [],
    question: "",
    onQuestion() {},
    onSubmit() {},
    busy: false,
    xtraceEnabled: true,
    deploymentMode: "public_sandbox" as const,
    reportScope: scope,
  }));

  assert.match(html, /ASKING REPORT · report_chat_ui/);
  assert.match(html, /Pinned Example Co/);
  assert.match(html, /PINNED DEMO REPLAY/);
  assert.match(html, /Demo evidence snapshot as of 2026-08-01/);
});

test("read-only public demo Chat retains the explicit XTrace toggle", () => {
  const request = buildChatApiRequest({
    question: "Why did we mark 7bridges as passed?",
    xtraceEnabled: true,
    scope: null,
    deploymentMode: "public_demo",
  });
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    question: "Why did we mark 7bridges as passed?",
    xtraceEnabled: true,
  });
});

test("durable Chat renders an exact finalized Source Revision citation", () => {
  const html = renderToStaticMarkup(createElement(ChatView, {
    messages: [{
      role: "assistant" as const,
      text: "Persisted inference: verified result.",
      memoryStatus: "disabled" as const,
      citations: [{
        sourceId: "source_finalized_ui",
        documentId: "document_finalized_ui",
        sourceRevisionId: "revision_finalized_ui",
        contentFingerprint: `sha256:${"5".repeat(64)}`,
        text: {
          status: "normalized_only" as const,
          normalizedStatement: "Verified result.",
        },
      }],
    }],
    question: "",
    onQuestion() {},
    onSubmit() {},
    busy: false,
    xtraceEnabled: false,
    deploymentMode: "public_sandbox" as const,
    reportScope: resolveReportChatScope(reportFixture()),
  }));

  assert.match(html, /source_finalized_ui/);
  assert.match(
    html,
    /\/api\/source-revisions\/revision_finalized_ui\/access/,
  );
});

test("Chat transcript resets across report, Deal, and global scope boundaries", () => {
  const reportA = resolveReportChatScope(reportFixture());
  assert.ok(reportA);
  const reportB = reportA ? {
    ...reportA,
    reportId: "report_chat_ui_b",
    runId: "22222222-2222-4222-8222-222222222222",
    dealId: "deal_chat_ui_b",
    companyName: "Report B Co",
  } : null;

  assert.equal(shouldResetChatTranscript(reportA, reportA), false);
  assert.equal(shouldResetChatTranscript(reportA, reportB), true);
  assert.equal(shouldResetChatTranscript(reportA, null), true);
  assert.equal(shouldResetChatTranscript(null, reportA), true);
  assert.equal(shouldResetChatTranscript(null, null), false);
  assert.equal(shouldApplyChatResponse(reportA, reportA), true);
  assert.equal(shouldApplyChatResponse(reportA, reportB), false);
  assert.equal(shouldApplyChatResponse(reportA, null), false);
  assert.equal(shouldApplyChatResponse(null, reportA), false);
  assert.equal(shouldApplyChatResponse(null, null), true);
});

test("an implicitly resolved report company is merged into the exact Chat header scope", () => {
  const unresolved = {
    reportId: "report_multi_company",
    runId: "33333333-3333-4333-8333-333333333333",
    evidenceContext: PINNED_CONTEXT,
  };
  const resolved = mergeResolvedChatScope(unresolved, {
    reportId: unresolved.reportId,
    runId: unresolved.runId,
    dealId: "deal_resolved_company",
    companyName: "Resolved Company",
    evidenceContext: PINNED_CONTEXT,
  });
  assert.deepEqual(resolved, {
    ...unresolved,
    dealId: "deal_resolved_company",
    companyName: "Resolved Company",
  });

  assert.deepEqual(mergeResolvedChatScope(unresolved, {
    reportId: "report_foreign",
    runId: unresolved.runId,
    dealId: "deal_foreign",
    companyName: "Foreign Company",
    evidenceContext: PINNED_CONTEXT,
  }), unresolved);
  assert.equal(mergeResolvedChatScope(null, {
    reportId: unresolved.reportId,
    runId: unresolved.runId,
    dealId: "deal_resolved_company",
    companyName: "Resolved Company",
    evidenceContext: PINNED_CONTEXT,
  }), null);
});
