import assert from "node:assert/strict";
import test from "node:test";

import { buildChatApiRequest } from "../../app/page";
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
  const sample = normalizedSourceV2("fixture_sample", {
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
  const context = {
    provenance: "demo_fixture" as const,
    sourceIds: [] as string[],
    sourceRevisionIds: [] as string[],
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
    sources: [sample],
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
  assert.equal(sandbox.some((item) => item.sources.some((source) =>
    source.id === sample.id
    && source.title === "Sample decision record"
  )), true);
});
