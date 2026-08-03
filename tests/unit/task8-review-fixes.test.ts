import assert from "node:assert/strict";
import test from "node:test";
import { isValidElement, type ReactNode } from "react";
import type { IntelligenceReportView } from "../../app/company-intelligence";

import {
  buildChatApiRequest,
  ReportsView,
  resolveReportChatScope,
} from "../../app/page";
import {
  POST,
  buildScopedRecallSourceIndex,
  resolveScopedRecallContextSources,
  searchRuntimeIntelligence,
} from "../../app/api/chat/route";
import type { IntelligenceReportRecord } from "../../db/repositories/intelligence";
import { OpportunityReportItemSchema } from "../../lib/contracts/domain";
import type { RouteDependencies } from "../../lib/api/route-dependencies";
import type { RunRecord } from "../../db/client";
import { buildSampleDecisionSourceRef } from "../../lib/belief-reversal/sample-decision-source";
import { normalizedSourceV2 } from "../helpers/source-evidence-v2";

test("durable report-launched Chat posts the exact report scope to the Chat route", () => {
  const request = buildChatApiRequest({
    question: "What changed?",
    xtraceEnabled: true,
    scope: { reportId: "report_1", runId: "run_1" },
  });

  assert.equal(request.url, "/api/chat");
  assert.equal(request.init.method, "POST");
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    question: "What changed?",
    xtraceEnabled: true,
    reportId: "report_1",
    runId: "run_1",
  });
});

test("ASK THIS REPORT sends the authoritative priority Deal in the normal Chat request", () => {
  const report = {
    id: "report_selected",
    runId: "run_selected",
    createdAt: "2026-08-01T00:00:00.000Z",
    marketSummary: "Selected report",
    opportunities: [],
    analysisStatus: "completed",
    evidenceCoverage: {},
    counts: {},
    priorityDealId: "deal_priority",
    companyAnalyses: [
      { dealId: "deal_other" },
      { dealId: "deal_priority" },
    ],
  } as unknown as IntelligenceReportView;
  let request!: ReturnType<typeof buildChatApiRequest>;
  const tree = ReportsView({
    reports: [report],
    deals: [],
    onDraft() {},
    focusedReportId: report.id,
    deploymentMode: "product",
    canSaveActionDrafts: false,
    onAsk(selected) {
      request = buildChatApiRequest({
        question: "What changed?",
        xtraceEnabled: true,
        scope: resolveReportChatScope(selected),
      });
    },
  });

  const askButton = findButton(tree, "ASK THIS REPORT");
  assert.ok(askButton);
  askButton.props.onClick();
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    question: "What changed?",
    xtraceEnabled: true,
    reportId: "report_selected",
    runId: "run_selected",
    dealId: "deal_priority",
  });
});

test("report Chat scope fails closed when no authoritative Deal is unambiguous", () => {
  assert.deepEqual(resolveReportChatScope({
    id: "report_ambiguous",
    runId: "run_ambiguous",
    priorityDealId: "deal_not_in_report",
    companyAnalyses: [{ dealId: "deal_a" }, { dealId: "deal_b" }],
  } as never), {
    reportId: "report_ambiguous",
    runId: "run_ambiguous",
  });
});

test("the UI report request exercises scoped Chat POST and returns that exact scope", async () => {
  const source = normalizedSourceV2("source_scoped_chat", {
    provenance: "public_web",
    documentId: null,
    sourceRevisionId: null,
    canonicalUrl: "https://example.test/scoped-chat",
    title: "Scoped Chat source",
    text: {
      status: "normalized_only",
      normalizedStatement: "Scoped Chat evidence changed.",
    },
  });
  const report = {
    id: "report_scoped",
    workspaceId: "workspace_scoped",
    runId: "00000000-0000-4000-8000-000000000008",
    createdAt: "2026-08-01T00:00:00.000Z",
    marketSummary: "Scoped summary",
    opportunities: [OpportunityReportItemSchema.parse({
      rank: 1,
      dealId: "deal_scoped",
      confidence: "medium",
      score: 0.7,
      whyNow: "Scoped Chat evidence changed.",
      previousContext: "Prior context.",
      implications: { positive: [], negative: [] },
      nextStep: "Review evidence.",
      sources: [source],
      demoFixtureIds: [],
    })],
    analysisStatus: "completed",
    evidenceCoverage: {
      acceptedPublicEvents: 1,
      excludedPublicItems: 0,
      truncatedPublicEvents: 0,
      recalledDealCount: 0,
      unavailableDealCount: 0,
    },
    counts: {
      companyCount: 0,
      beliefRevised: 0,
      monitor: 0,
      noMaterialChange: 0,
      analysisUnavailable: 0,
    },
    priorityDealId: null,
    companyAnalyses: [],
    evidenceContext: { state: "legacy_unbound" as const },
  } satisfies IntelligenceReportRecord;
  const run = {
    id: report.runId,
    workspaceId: report.workspaceId,
    mode: "structured",
    windowDays: 14,
    status: "completed",
    currentStage: "notification",
    warningCount: 0,
    warnings: [],
    workerId: null,
    createdAt: report.createdAt,
    startedAt: report.createdAt,
    completedAt: report.createdAt,
    leaseExpiresAt: null,
    evidenceContext: { state: "legacy_unbound" },
  } satisfies RunRecord;
  const requestSpec = buildChatApiRequest({
    question: "Scoped Chat evidence changed",
    xtraceEnabled: false,
    scope: { reportId: report.id, runId: run.id },
  });
  const response = await POST(new Request(`https://vsee.test${requestSpec.url}`, {
    ...requestSpec.init,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `review-${crypto.randomUUID()}`,
    },
  }), undefined, {
    resolveRequestContext: async () => ({
      mode: "product",
      principal: { userId: "user_1", email: "user@example.test" },
      workspaceId: report.workspaceId,
      role: "member",
      permissions: {
        readWorkspace: true,
        readPrivateSources: true,
        mutateSources: true,
        managePolicy: false,
        administerFrameworks: false,
      },
    }),
    intelligence: {
      getReport: async () => report,
      listReports: async () => [report],
    },
    runs: {
      get: async () => run,
      list: async () => [run],
    },
    underwritingRuns: {
      getBatchByScanRunId: async () => null,
      listCandidatesForBatch: async () => [],
    },
  } as unknown as RouteDependencies);

  assert.equal(response.status, 200);
  const payload = await response.json() as {
    data: { scope: { reportId: string; runId: string } };
  };
  assert.deepEqual(payload.data.scope, {
    reportId: report.id,
    runId: run.id,
    dealId: null,
    evidenceContext: { state: "legacy_unbound" },
  });
});

test("exact XTrace parent lineage resolves every in-report claim for one document revision", () => {
  const claims = ["claim_a", "claim_b"].map((id) => normalizedSourceV2(id, {
    provenance: "source_document",
    documentId: "document_parent",
    sourceRevisionId: "revision_parent_1",
    title: `Parent claim ${id}`,
    text: {
      status: "normalized_only",
      normalizedStatement: `Distinct parent claim ${id}.`,
    },
  }));
  const index = buildScopedRecallSourceIndex(claims, "product");

  const resolved = resolveScopedRecallContextSources(index, {
    provenance: "source_document",
    sourceIds: ["document_parent"],
    sourceRevisionIds: ["revision_parent_1"],
    fixtureIds: [],
  }, "product");

  assert.deepEqual(resolved.map(({ id }) => id), ["claim_a", "claim_b"]);
});

test("XTrace parent lineage rejects a revision mismatch", () => {
  const source = normalizedSourceV2("claim_revision", {
    provenance: "source_document",
    documentId: "document_parent",
    sourceRevisionId: "revision_parent_1",
  });
  const index = buildScopedRecallSourceIndex([source], "product");

  assert.deepEqual(resolveScopedRecallContextSources(index, {
    provenance: "source_document",
    sourceIds: ["document_parent"],
    sourceRevisionIds: ["revision_parent_2"],
    fixtureIds: [],
  }, "product"), []);
  assert.deepEqual(resolveScopedRecallContextSources(index, {
    provenance: "source_document",
    sourceIds: ["document_parent"],
    sourceRevisionIds: ["revision_parent_1", "revision_unrelated"],
    fixtureIds: [],
  }, "product"), []);
});

test("product rejects fixture recall while sandbox accepts only a permanent canonical Sample record", () => {
  const sample = buildSampleDecisionSourceRef({
    id: "fixture_sample",
    documentId: "source_fixture_sample",
    sourceRevisionId: "revision_fixture_sample",
    contentFingerprint: `sha256:${"a".repeat(64)}`,
    occurredAt: "2026-08-01T00:00:00.000Z",
    retrievedAt: "2026-08-01T00:00:01.000Z",
    summary: "The fund passed pending validation.",
    decisionReason: "Validation was incomplete.",
    concerns: ["Customer proof remained limited."],
    revisitConditions: ["New customer proof becomes available."],
  });
  const context = {
    provenance: "demo_fixture" as const,
    sourceIds: [] as string[],
    sourceRevisionIds: [sample.sourceRevisionId] as string[],
    fixtureIds: [sample.id],
  };

  assert.deepEqual(resolveScopedRecallContextSources(
    buildScopedRecallSourceIndex([sample], "product"),
    context,
    "product",
  ), []);
  assert.deepEqual(resolveScopedRecallContextSources(
    buildScopedRecallSourceIndex([sample], "public_sandbox"),
    context,
    "public_sandbox",
  ).map(({ id }) => id), [sample.id]);

});

test("local report Chat filters Sample evidence only in product and retains its permanent sandbox label", async () => {
  const sample = normalizedSourceV2("fixture_local_sample", {
    provenance: "demo_fixture",
    title: "Sample decision record",
    documentId: null,
    sourceRevisionId: null,
    publisher: "Internal Deal Registry",
    providerId: "deal-registry",
    sourceClass: "internal_decision_record",
    sourceAuthority: "primary",
    evidenceRole: "context",
    publishedAt: null,
    publishedAtPrecision: null,
    retrievedAt: null,
    retrievedAtPrecision: null,
    text: {
      status: "normalized_only",
      normalizedStatement: "Sample decision record. The fund passed pending validation.",
    },
  });
  const publicSource = normalizedSourceV2("public_local_source", {
    provenance: "public_web",
    title: "Public local source",
    canonicalUrl: "https://example.test/public-local-source",
    documentId: null,
    sourceRevisionId: null,
    providerId: "reviewed-public-provider",
    sourceClass: "industry_publication",
    sourceAuthority: "secondary",
    evidenceRole: "trigger",
    text: {
      status: "normalized_only",
      normalizedStatement: "Public evidence changed.",
    },
  });
  const opportunity = OpportunityReportItemSchema.parse({
    rank: 1,
    dealId: "deal_1",
    confidence: "medium",
    score: 0.7,
    whyNow: "Public evidence changed.",
    previousContext: sample.text.status === "normalized_only"
      ? sample.text.normalizedStatement
      : "",
    implications: { positive: [], negative: [] },
    nextStep: "Review evidence.",
    sources: [publicSource, sample],
    demoFixtureIds: [sample.id],
  });
  const report = {
    id: "report_1",
    workspaceId: "workspace_1",
    runId: "run_1",
    createdAt: "2026-08-01T00:00:00.000Z",
    marketSummary: "Summary",
    opportunities: [opportunity],
    analysisStatus: "completed",
    evidenceCoverage: {
      acceptedPublicEvents: 0,
      excludedPublicItems: 0,
      truncatedPublicEvents: 0,
      recalledDealCount: 1,
      unavailableDealCount: 0,
    },
    counts: {
      companyCount: 0,
      beliefRevised: 0,
      monitor: 0,
      noMaterialChange: 0,
      analysisUnavailable: 0,
    },
    priorityDealId: null,
    companyAnalyses: [],
    evidenceContext: { state: "legacy_unbound" },
  } satisfies IntelligenceReportRecord;

  const product = await searchRuntimeIntelligence(
    "previous context",
    report,
    "product",
  );
  const sandbox = await searchRuntimeIntelligence(
    "previous context",
    report,
    "public_sandbox",
  );
  assert.equal(product.some((item) =>
    item.sources.some(({ provenance }) => provenance === "demo_fixture")
  ), false);
  const productPublic = await searchRuntimeIntelligence(
    "public evidence",
    report,
    "product",
    "deal_1",
  );
  assert.equal(productPublic.some((item) =>
    item.sources.some(({ id }) => id === publicSource.id)
  ), true);
  assert.equal(sandbox.some((item) => item.sources.some((source) =>
    source.id === sample.id
    && source.title === "Sample decision record"
  )), true);
});

test("sandbox local report Chat rejects a non-authoritative Sample provider", async () => {
  const invalidSample = normalizedSourceV2("fixture_untrusted_sample", {
    provenance: "demo_fixture",
    title: "Sample decision record",
    documentId: "source_fixture_untrusted_sample",
    sourceRevisionId: "revision_fixture_untrusted_sample",
    publisher: "Internal Deal Registry",
    providerId: "untrusted-import",
    sourceClass: "internal_decision_record",
    sourceAuthority: "primary",
    evidenceRole: "context",
    publishedAt: null,
    publishedAtPrecision: null,
    retrievedAt: null,
    retrievedAtPrecision: null,
    text: {
      status: "normalized_only",
      normalizedStatement:
        "Sample decision record. Untrusted historical decision prose.",
    },
  });
  const publicSource = normalizedSourceV2("public_untrusted_companion", {
    provenance: "public_web",
    title: "Reviewed public companion",
    canonicalUrl: "https://example.test/reviewed-public-companion",
    documentId: null,
    sourceRevisionId: null,
    providerId: "reviewed-public-provider",
    sourceClass: "industry_publication",
    sourceAuthority: "secondary",
    evidenceRole: "trigger",
    text: {
      status: "normalized_only",
      normalizedStatement: "A reviewed public change exists.",
    },
  });
  const report = {
    id: "report_untrusted_sample",
    workspaceId: "workspace_1",
    runId: "run_1",
    createdAt: "2026-08-01T00:00:00.000Z",
    marketSummary: "Summary",
    opportunities: [OpportunityReportItemSchema.parse({
      rank: 1,
      dealId: "deal_1",
      confidence: "medium",
      score: 0.7,
      whyNow: "No public change.",
      previousContext: invalidSample.text.normalizedStatement,
      implications: { positive: [], negative: [] },
      nextStep: "Review evidence.",
      sources: [publicSource, invalidSample],
      demoFixtureIds: [invalidSample.id],
    })],
    analysisStatus: "completed",
    evidenceCoverage: {
      acceptedPublicEvents: 0,
      excludedPublicItems: 0,
      truncatedPublicEvents: 0,
      recalledDealCount: 1,
      unavailableDealCount: 0,
    },
    counts: {
      companyCount: 0,
      beliefRevised: 0,
      monitor: 0,
      noMaterialChange: 0,
      analysisUnavailable: 0,
    },
    priorityDealId: null,
    companyAnalyses: [],
    evidenceContext: { state: "legacy_unbound" },
  } satisfies IntelligenceReportRecord;

  const evidence = await searchRuntimeIntelligence(
    "previous context",
    report,
    "public_sandbox",
    "deal_1",
  );
  assert.ok(evidence.length > 0);
  assert.equal(evidence.some((item) =>
    item.text.includes("Untrusted historical decision prose")
    || item.sources.some(({ id }) => id === invalidSample.id)
  ), false);
});

function findButton(
  node: ReactNode,
  label: string,
): { props: { onClick(): void } } | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButton(child, label);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const props = node.props as { children?: ReactNode; onClick?: () => void };
  if (
    node.type === "button"
    && props.children === label
    && props.onClick
  ) return { props: { onClick: props.onClick } };
  return findButton(props.children, label);
}
