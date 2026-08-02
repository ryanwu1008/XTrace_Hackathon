import assert from "node:assert/strict";
import test from "node:test";

import { canonicalIntelligenceReportFixture } from "../helpers/canonical-intelligence-report";

import { POST as chat } from "../../app/api/chat/route";
import { GET as actionDrafts } from "../../app/api/action-drafts/route";
import { PATCH as actionDraft } from "../../app/api/action-drafts/[id]/route";
import { GET as dealAnalyses } from "../../app/api/deals/[id]/analyses/route";
import { GET as deal } from "../../app/api/deals/[id]/route";
import { GET as deals } from "../../app/api/deals/route";
import { POST as resetDemo } from "../../app/api/demo/reset/route";
import { GET as documentAccess } from "../../app/api/documents/[id]/access/route";
import { GET as document } from "../../app/api/documents/[id]/route";
import { GET as documents } from "../../app/api/documents/route";
import { POST as uploadDocument } from "../../app/api/documents/upload/route";
import { GET as uploadedDocuments } from "../../app/api/documents/uploaded/route";
import { GET as listUploads, POST as createUpload } from "../../app/api/uploads/route";
import { GET as getUpload } from "../../app/api/uploads/[id]/route";
import { POST as confirmUpload } from "../../app/api/uploads/[id]/confirm/route";
import { GET as accessSourceRevision } from "../../app/api/source-revisions/[id]/access/route";
import {
  POST as confirmImport,
  toPublicXTraceErrors,
} from "../../app/api/imports/confirm/route";
import { POST as previewImport } from "../../app/api/imports/preview/route";
import { GET as marketEvents } from "../../app/api/market/events/route";
import { GET as overview } from "../../app/api/overview/route";
import { GET as reportCompany } from "../../app/api/reports/[id]/companies/[dealId]/route";
import { GET as report } from "../../app/api/reports/[id]/route";
import { GET as reportUnderwriting } from "../../app/api/reports/[id]/underwriting/[dealId]/route";
import { GET as reports } from "../../app/api/reports/route";
import { GET as search } from "../../app/api/search/route";
import { GET as run } from "../../app/api/runs/[id]/route";
import { GET as runs, POST as createRun } from "../../app/api/runs/route";
import { GET as health } from "../../app/api/settings/health/route";
import { getDataClient } from "../../db/client";
import { getIntelligenceRepository } from "../../db/repositories/intelligence";
import { getTestGenerationRepository } from "../../db/repositories/test-generations";
import { getUploadedDocumentsRepository } from "../../db/repositories/uploaded-documents";
import { toPublicUploadedDocument } from "../../lib/uploads/public";

type RouteInvocation = () => Promise<Response>;

const allCurrentRouteHandlers: Array<{
  method: "GET" | "POST" | "PATCH";
  path: string;
  invoke: RouteInvocation;
}> = [
  {
    method: "GET",
    path: "/api/action-drafts",
    invoke: () => actionDrafts(request(
      "/api/action-drafts?candidateRunId=candidate_missing",
    )),
  },
  {
    method: "PATCH",
    path: "/api/action-drafts/[id]",
    invoke: () => actionDraft(
      request("/api/action-drafts/draft_missing", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "Body" }),
      }),
      params({ id: "draft_missing" }),
    ),
  },
  {
    method: "POST",
    path: "/api/chat",
    invoke: () => chat(jsonRequest("/api/chat", {
      question: "What changed?",
      xtraceEnabled: false,
    })),
  },
  {
    method: "GET",
    path: "/api/deals",
    invoke: () => deals(request("/api/deals")),
  },
  {
    method: "GET",
    path: "/api/deals/[id]",
    invoke: () => deal(request("/api/deals/deal_7bridges"), params({ id: "deal_7bridges" })),
  },
  {
    method: "GET",
    path: "/api/deals/[id]/analyses",
    invoke: () => dealAnalyses(
      request("/api/deals/deal_7bridges/analyses"),
      params({ id: "deal_7bridges" }),
    ),
  },
  {
    method: "POST",
    path: "/api/demo/reset",
    invoke: () => resetDemo(request("/api/demo/reset", { method: "POST" })),
  },
  {
    method: "GET",
    path: "/api/documents",
    invoke: () => documents(request("/api/documents")),
  },
  {
    method: "GET",
    path: "/api/documents/[id]",
    invoke: () => document(
      request("/api/documents/doc_7bridges"),
      params({ id: "doc_7bridges" }),
    ),
  },
  {
    method: "GET",
    path: "/api/documents/[id]/access",
    invoke: () => documentAccess(
      request("/api/documents/doc_7bridges/access"),
      params({ id: "doc_7bridges" }),
    ),
  },
  {
    method: "POST",
    path: "/api/documents/upload",
    invoke: () => uploadDocument(request("/api/documents/upload", { method: "POST" })),
  },
  {
    method: "GET",
    path: "/api/documents/uploaded",
    invoke: () => uploadedDocuments(request("/api/documents/uploaded")),
  },
  {
    method: "POST",
    path: "/api/uploads",
    invoke: () => createUpload(request("/api/uploads", { method: "POST" })),
  },
  {
    method: "GET",
    path: "/api/uploads",
    invoke: () => listUploads(request("/api/uploads")),
  },
  {
    method: "GET",
    path: "/api/uploads/[id]",
    invoke: () => getUpload(
      request("/api/uploads/upload_missing"),
      params({ id: "upload_missing" }),
    ),
  },
  {
    method: "POST",
    path: "/api/uploads/[id]/confirm",
    invoke: () => confirmUpload(
      jsonRequest("/api/uploads/upload_missing/confirm", {}),
      params({ id: "upload_missing" }),
    ),
  },
  {
    method: "GET",
    path: "/api/source-revisions/[id]/access",
    invoke: () => accessSourceRevision(
      request("/api/source-revisions/revision_missing/access"),
      params({ id: "revision_missing" }),
    ),
  },
  {
    method: "POST",
    path: "/api/imports/confirm",
    invoke: () => confirmImport(jsonRequest("/api/imports/confirm", {})),
  },
  {
    method: "POST",
    path: "/api/imports/preview",
    invoke: () => previewImport(jsonRequest("/api/imports/preview", { documentIds: [] })),
  },
  {
    method: "GET",
    path: "/api/market/events",
    invoke: () => marketEvents(request("/api/market/events")),
  },
  {
    method: "GET",
    path: "/api/overview",
    invoke: () => overview(request("/api/overview")),
  },
  {
    method: "GET",
    path: "/api/reports",
    invoke: () => reports(request("/api/reports")),
  },
  {
    method: "GET",
    path: "/api/reports/[id]",
    invoke: () => report(request("/api/reports/report_missing"), params({ id: "report_missing" })),
  },
  {
    method: "GET",
    path: "/api/reports/[id]/companies/[dealId]",
    invoke: () => reportCompany(
      request("/api/reports/report_missing/companies/deal_7bridges"),
      params({ id: "report_missing", dealId: "deal_7bridges" }),
    ),
  },
  {
    method: "GET",
    path: "/api/reports/[id]/underwriting/[dealId]",
    invoke: () => reportUnderwriting(
      request("/api/reports/report_missing/underwriting/deal_7bridges"),
      params({ id: "report_missing", dealId: "deal_7bridges" }),
    ),
  },
  {
    method: "GET",
    path: "/api/search",
    invoke: () => search(request("/api/search?q=carrier")),
  },
  {
    method: "GET",
    path: "/api/runs",
    invoke: () => runs(request("/api/runs")),
  },
  {
    method: "POST",
    path: "/api/runs",
    invoke: () => createRun(jsonRequest("/api/runs", { xtraceEnabled: false })),
  },
  {
    method: "GET",
    path: "/api/runs/[id]",
    invoke: () => run(request("/api/runs/run_missing"), params({ id: "run_missing" })),
  },
  {
    method: "GET",
    path: "/api/settings/health",
    invoke: () => health(request("/api/settings/health")),
  },
];

for (const route of allCurrentRouteHandlers) {
  test(`${route.method} ${route.path} rejects product requests without a session`, async () => {
    await withDeployment("product", async () => {
      const response = await route.invoke();
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), {
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication required",
          retryable: false,
        },
      });
    });
  });
}

test("POST /api/runs keeps the public demo read-only and never queues a scan", async () => {
  const workspaceId = `workspace_public_demo_run_${crypto.randomUUID()}`;
  const before = await getDataClient().listRuns(workspaceId);
  assert.deepEqual(before, []);

  const response = await createRun(
    jsonRequest("/api/runs", { xtraceEnabled: false }),
    undefined,
    {
      async resolveRequestContext() {
        return {
          mode: "public_demo",
          principal: null,
          workspaceId,
          role: "demo",
          permissions: {
            readWorkspace: true,
            readPrivateSources: false,
            mutateSources: false,
            managePolicy: false,
            administerFrameworks: false,
          },
        };
      },
    },
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await getDataClient().listRuns(workspaceId), []);
});

test("POST /api/runs accepts an anonymous public-sandbox request", async () => {
  await withDeployment("public_sandbox", async () => {
    const response = await createRun(
      jsonRequest("/api/runs", { xtraceEnabled: false }),
    );

    assert.equal(response.status, 503);
  });
});

for (const route of [
  {
    path: "/api/documents/upload",
    invoke: () => uploadDocument(request("/api/documents/upload", { method: "POST" })),
  },
  {
    path: "/api/uploads",
    invoke: () => createUpload(request("/api/uploads", { method: "POST" })),
  },
  {
    path: "/api/uploads/[id]/confirm",
    invoke: () => confirmUpload(
      jsonRequest("/api/uploads/upload_missing/confirm", {}),
      params({ id: "upload_missing" }),
    ),
  },
  {
    path: "/api/imports/confirm",
    invoke: () => confirmImport(jsonRequest("/api/imports/confirm", {})),
  },
  {
    path: "/api/demo/reset",
    invoke: () => resetDemo(request("/api/demo/reset", { method: "POST" })),
  },
]) {
  test(`${route.path} rejects public-demo mutation`, async () => {
    await withDeployment("public_demo", async () => {
      const response = await route.invoke();
      assert.equal(response.status, 403);
    });
  });
}

test("report and report-by-run reads cannot cross workspaces", async () => {
  const repository = getIntelligenceRepository();
  await repository.saveReport(canonicalIntelligenceReportFixture({
    id: "report_workspace_other",
    workspaceId: "workspace_other",
    runId: "run_workspace_other_report",
    createdAt: "2026-07-28T12:00:00.000Z",
    marketSummary: "Other workspace summary",
  }));

  await withDeployment("public_demo", async () => {
    const byId = await report(
      request("/api/reports/report_workspace_other"),
      params({ id: "report_workspace_other" }),
    );
    assert.equal(byId.status, 404);

    const byRun = await reports(
      request("/api/reports?runId=run_workspace_other_report"),
    );
    assert.deepEqual(await byRun.json(), { data: [] });
  });
});

test("run reads cannot cross workspaces", async () => {
  const otherRun = await getDataClient().insertRun({
    workspaceId: "workspace_other",
    mode: "structured",
    windowDays: 14,
  });

  await withDeployment("public_demo", async () => {
    const response = await run(
      request(`/api/runs/${otherRun.id}`),
      params({ id: otherRun.id }),
    );
    assert.equal(response.status, 404);
  });
});

test("public run serializers never expose worker identity or leases", async () => {
  const client = getDataClient();
  const publicRun = await client.insertRun({
    workspaceId: "workspace_demo",
    mode: "structured",
    windowDays: 14,
  });
  await client.updateRun(publicRun.workspaceId, publicRun.id, {
    workerId: "private-worker",
    leaseExpiresAt: "2026-07-28T15:00:00.000Z",
    warningCount: 1,
    warnings: ["provider secret stack trace"],
  });

  await withDeployment("public_demo", async () => {
    const byId = await run(
      request(`/api/runs/${publicRun.id}`),
      params({ id: publicRun.id }),
    );
    const byIdPayload = await byId.json() as { data: Record<string, unknown> };
    assert.equal(byId.status, 200);
    assert.equal("workerId" in byIdPayload.data, false);
    assert.equal("leaseExpiresAt" in byIdPayload.data, false);
    assert.deepEqual(
      byIdPayload.data.warnings,
      ["A scan stage reported a warning."],
    );
    assert.doesNotMatch(JSON.stringify(byIdPayload), /provider secret|stack trace/i);

    const listing = await runs(request("/api/runs"));
    const listPayload = await listing.json() as {
      data: Array<Record<string, unknown>>;
    };
    const listed = listPayload.data.find((candidate) =>
      candidate.id === publicRun.id
    );
    assert.ok(listed);
    assert.equal("workerId" in listed, false);
    assert.equal("leaseExpiresAt" in listed, false);
  });
});

test("uploaded-source serializers hide object keys and internal failure details", () => {
  const serialized = toPublicUploadedDocument({
    id: "upload_failed",
    workspaceId: "workspace_one",
    filename: "failed.txt",
    contentType: "text/plain",
    byteSize: 10,
    checksum: "checksum",
    objectKey: "private/workspaces/workspace_one/secret",
    status: "failed",
    failureReason: "service-role=secret provider stack trace",
    extractionPreview: {
      candidateCompanyName: "Sentinel Company",
      candidateHeadline: "Sentinel headline",
      facts: [{
        text: "Sentinel fact",
        excerpt: "Sentinel excerpt",
        locator: { kind: "text_range", start: 7, end: 23 },
      }],
      extractionMetadata: {
        extractorId: "claude_vision_v1",
        extractorVersion: "1",
        extractedAt: "2026-07-28T12:00:30.000Z",
        contentHash: "sentinel-internal-content-hash",
        inputBytes: 987_654,
        extractedCharacters: 123_456,
        truncated: false,
      },
    },
    createdAt: "2026-07-28T12:00:00.000Z",
    updatedAt: "2026-07-28T12:01:00.000Z",
  });

  assert.equal("objectKey" in serialized, false);
  assert.equal(serialized.failureReason, "Document processing failed.");
  assert.deepEqual(serialized.extractionPreview, {
    candidateCompanyName: "Sentinel Company",
    candidateHeadline: "Sentinel headline",
    facts: [{
      text: "Sentinel fact",
      excerpt: "Sentinel excerpt",
      locator: { kind: "text_range", start: 7, end: 23 },
    }],
  });
  assert.doesNotMatch(
    JSON.stringify(serialized),
    /service-role|stack trace|extractor|content.hash|input.bytes|extracted.characters/i,
  );
});

test("import serializers hide provider diagnostics", () => {
  const errors = toPublicXTraceErrors([
    {
      status: "rejected",
      reason: new Error("service role and provider prompt leaked"),
    },
  ]);

  assert.deepEqual(errors, ["XTrace ingestion failed"]);
  assert.doesNotMatch(JSON.stringify(errors), /service role|provider prompt/i);
});

test("Deal analysis reads cannot cross workspaces", async () => {
  const repository = getIntelligenceRepository();
  await repository.saveReport(canonicalIntelligenceReportFixture({
    id: "report_other_deal_analysis",
    workspaceId: "workspace_other",
    runId: "00000000-0000-4000-8000-000000000473",
    createdAt: "2026-07-28T13:00:00.000Z",
    marketSummary: "Other workspace analysis",
    dealIds: ["deal_ably"],
  }));

  await withDeployment("public_demo", async () => {
    const response = await dealAnalyses(
      request("/api/deals/deal_ably/analyses"),
      params({ id: "deal_ably" }),
    );
    const payload = await response.json() as { data: unknown[] };
    assert.equal(response.status, 200);
    assert.deepEqual(payload.data, []);
  });
});

test("public demo cannot list or request access to an uploaded private source", async () => {
  const upload = await getUploadedDocumentsRepository().create({
    id: "upload_workspace_other_private",
    workspaceId: "workspace_other",
    filename: "private.txt",
    contentType: "text/plain",
    byteSize: 7,
    checksum: "private-checksum",
    objectKey: "private/workspaces/workspace_other/uploads/private.txt",
  });

  await withDeployment("public_demo", async () => {
    const listing = await uploadedDocuments(request("/api/documents/uploaded"));
    assert.equal(listing.status, 403);

    const access = await documentAccess(
      request(`/api/documents/${upload.id}/access`),
      params({ id: upload.id }),
    );
    assert.equal(access.status, 403);

    const read = await document(
      request(`/api/documents/${upload.id}`),
      params({ id: upload.id }),
    );
    assert.equal(read.status, 403);
  });
});

test("public demo preloaded PDF access never receives a private capability", async () => {
  await withDeployment("public_demo", async () => {
    const response = await documentAccess(
      request("/api/documents/doc_7bridges/access"),
      params({ id: "doc_7bridges" }),
    );
    assert.equal(response.status, 307);
    const location = new URL(
      response.headers.get("location") ?? "https://invalid.test",
    );
    assert.equal(location.pathname, "/api/documents/doc_7bridges");
    assert.equal(location.search, "");
  });
});

test("public demo reset is forbidden and cannot delete another workspace report", async () => {
  const repository = getIntelligenceRepository();
  await repository.saveReport(canonicalIntelligenceReportFixture({
    id: "report_reset_other_workspace",
    workspaceId: "workspace_other",
    runId: "run_reset_other_workspace",
    createdAt: "2026-07-28T14:00:00.000Z",
    marketSummary: "Must survive forbidden reset",
  }));

  await withDeployment("public_demo", async () => {
    const response = await resetDemo(request("/api/demo/reset", { method: "POST" }));
    assert.equal(response.status, 403);
  });

  assert.ok(await repository.getReport(
    "workspace_other",
    "report_reset_other_workspace",
  ));
});

test("public sandbox reset rejects an active run without advancing its test-view marker", async () => {
  const workspaceId = `workspace_reset_active_${crypto.randomUUID()}`;
  const client = getDataClient();
  const activeRun = await client.insertRun({
    workspaceId,
    mode: "structured",
    windowDays: 14,
  });
  const generations = getTestGenerationRepository();
  assert.equal(await generations.currentResetAt(workspaceId), null);

  const response = await resetDemo(
    request("/api/demo/reset", { method: "POST" }),
    undefined,
    {
      async resolveRequestContext() {
        return {
          mode: "public_sandbox",
          principal: {
            userId: "system:public-sandbox",
            email: "public-sandbox@invalid.local",
          },
          workspaceId,
          role: "sandbox",
          permissions: {
            readWorkspace: true,
            readPrivateSources: true,
            mutateSources: true,
            managePolicy: true,
            administerFrameworks: false,
          },
        };
      },
    },
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: {
      code: "CONFLICT",
      message: "The current test view cannot be reset while a scan is active.",
      retryable: false,
    },
  });
  assert.equal(await generations.currentResetAt(workspaceId), null);
  assert.equal((await client.getRun(workspaceId, activeRun.id))?.status, "queued");
});

function request(path: string, init?: RequestInit): Request {
  return new Request(`https://vsee.test${path}`, init);
}

function jsonRequest(path: string, body: unknown): Request {
  return request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params<T extends Record<string, string>>(value: T): { params: Promise<T> } {
  return { params: Promise.resolve(value) };
}

async function withDeployment(
  mode: "product" | "public_demo" | "public_sandbox",
  action: () => Promise<void>,
): Promise<void> {
  const previousMode = process.env.VSEE_DEPLOYMENT_MODE;
  const previousWorkspace = process.env.DEMO_WORKSPACE_ID;
  const previousUrl = process.env.SUPABASE_URL;
  const previousServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.VSEE_DEPLOYMENT_MODE = mode;
  process.env.DEMO_WORKSPACE_ID = "workspace_demo";
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    await action();
  } finally {
    restoreEnvironment("VSEE_DEPLOYMENT_MODE", previousMode);
    restoreEnvironment("DEMO_WORKSPACE_ID", previousWorkspace);
    restoreEnvironment("SUPABASE_URL", previousUrl);
    restoreEnvironment("SUPABASE_SERVICE_ROLE_KEY", previousServiceRole);
  }
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
