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
import { POST as confirmImport } from "../../app/api/imports/confirm/route";
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
import {
  createMemoryUploadedDocumentsRepository,
  type ExtractionPreview,
} from "../../db/repositories/uploaded-documents";
import { createMemorySourceRegistry } from "../../db/repositories/source-registry";
import type { RouteDependencies } from "../../lib/api/route-dependencies";
import {
  listDocumentDeals,
  listPreloadedDocuments,
} from "../../lib/corpus/manifest";
import {
  createDefaultDemoDataStore,
  createMemoryPrivateObjectStorage,
  createPrivateDocumentAccess,
} from "../../lib/storage/service";

const FORGED_SELECTOR_WORKSPACE = "workspace_request_attacker";
const partner = productDependencies(
  "partner",
  "workspace_demo",
  "user_product",
  true,
);

const authenticatedProductHandlers: Array<{
  method: "GET" | "POST" | "PATCH";
  path: string;
  invoke(dependencies: RouteDependencies): Promise<Response>;
}> = [
  {
    method: "GET",
    path: "/api/action-drafts",
    invoke: (dependencies) => actionDrafts(
      request("/api/action-drafts?candidateRunId=candidate_missing"),
      undefined,
      dependencies,
    ),
  },
  {
    method: "PATCH",
    path: "/api/action-drafts/[id]",
    invoke: (dependencies) => actionDraft(
      request("/api/action-drafts/draft_missing", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: "Body",
          workspaceId: FORGED_SELECTOR_WORKSPACE,
        }),
      }),
      params({ id: "draft_missing" }),
      dependencies,
    ),
  },
  {
    method: "POST",
    path: "/api/chat",
    invoke: (dependencies) => chat(
      jsonRequest("/api/chat", {
        question: "What changed?",
        xtraceEnabled: false,
      }),
      undefined,
      dependencies,
    ),
  },
  {
    method: "GET",
    path: "/api/deals",
    invoke: (dependencies) =>
      deals(request("/api/deals"), undefined, dependencies),
  },
  {
    method: "GET",
    path: "/api/deals/[id]",
    invoke: (dependencies) => deal(
      request("/api/deals/deal_7bridges"),
      params({ id: "deal_7bridges" }),
      dependencies,
    ),
  },
  {
    method: "GET",
    path: "/api/deals/[id]/analyses",
    invoke: (dependencies) => dealAnalyses(
      request("/api/deals/deal_7bridges/analyses"),
      params({ id: "deal_7bridges" }),
      dependencies,
    ),
  },
  {
    method: "GET",
    path: "/api/documents",
    invoke: (dependencies) =>
      documents(request("/api/documents"), undefined, dependencies),
  },
  {
    method: "GET",
    path: "/api/documents/[id]",
    invoke: (dependencies) => document(
      request("/api/documents/doc_7bridges"),
      params({ id: "doc_7bridges" }),
      dependencies,
    ),
  },
  {
    method: "GET",
    path: "/api/documents/[id]/access",
    invoke: (dependencies) => documentAccess(
      request("/api/documents/doc_7bridges/access"),
      params({ id: "doc_7bridges" }),
      dependencies,
    ),
  },
  {
    method: "POST",
    path: "/api/documents/upload",
    invoke: (dependencies) => uploadDocument(
      emptyUploadRequest(),
      undefined,
      dependencies,
    ),
  },
  {
    method: "GET",
    path: "/api/documents/uploaded",
    invoke: (dependencies) => uploadedDocuments(
      request("/api/documents/uploaded"),
      undefined,
      dependencies,
    ),
  },
  {
    method: "POST",
    path: "/api/uploads",
    invoke: (dependencies) => createUpload(
      emptyUploadRequest("/api/uploads"),
      undefined,
      dependencies,
    ),
  },
  {
    method: "GET",
    path: "/api/uploads",
    invoke: (dependencies) => listUploads(
      request("/api/uploads"),
      undefined,
      dependencies,
    ),
  },
  {
    method: "GET",
    path: "/api/uploads/[id]",
    invoke: (dependencies) => getUpload(
      request("/api/uploads/upload_missing"),
      params({ id: "upload_missing" }),
      dependencies,
    ),
  },
  {
    method: "POST",
    path: "/api/uploads/[id]/confirm",
    invoke: (dependencies) => confirmUpload(
      jsonRequest("/api/uploads/upload_missing/confirm", {}),
      params({ id: "upload_missing" }),
      dependencies,
    ),
  },
  {
    method: "GET",
    path: "/api/source-revisions/[id]/access",
    invoke: (dependencies) => accessSourceRevision(
      request("/api/source-revisions/revision_missing/access"),
      params({ id: "revision_missing" }),
      dependencies,
    ),
  },
  {
    method: "POST",
    path: "/api/imports/confirm",
    invoke: (dependencies) => confirmImport(
      jsonRequest("/api/imports/confirm", {}),
      undefined,
      dependencies,
    ),
  },
  {
    method: "POST",
    path: "/api/imports/preview",
    invoke: (dependencies) => previewImport(
      jsonRequest("/api/imports/preview", { documentIds: [] }),
      undefined,
      dependencies,
    ),
  },
  {
    method: "GET",
    path: "/api/market/events",
    invoke: (dependencies) => marketEvents(
      request("/api/market/events"),
      undefined,
      dependencies,
    ),
  },
  {
    method: "GET",
    path: "/api/overview",
    invoke: (dependencies) =>
      overview(request("/api/overview"), undefined, dependencies),
  },
  {
    method: "GET",
    path: "/api/reports",
    invoke: (dependencies) =>
      reports(request("/api/reports"), undefined, dependencies),
  },
  {
    method: "GET",
    path: "/api/reports/[id]",
    invoke: (dependencies) => report(
      request("/api/reports/report_missing"),
      params({ id: "report_missing" }),
      dependencies,
    ),
  },
  {
    method: "GET",
    path: "/api/reports/[id]/companies/[dealId]",
    invoke: (dependencies) => reportCompany(
      request("/api/reports/report_missing/companies/deal_7bridges"),
      params({ id: "report_missing", dealId: "deal_7bridges" }),
      dependencies,
    ),
  },
  {
    method: "GET",
    path: "/api/reports/[id]/underwriting/[dealId]",
    invoke: (dependencies) => reportUnderwriting(
      request("/api/reports/report_missing/underwriting/deal_7bridges"),
      params({ id: "report_missing", dealId: "deal_7bridges" }),
      dependencies,
    ),
  },
  {
    method: "GET",
    path: "/api/search",
    invoke: (dependencies) => search(
      request("/api/search?q=carrier"),
      undefined,
      dependencies,
    ),
  },
  {
    method: "GET",
    path: "/api/runs",
    invoke: (dependencies) =>
      runs(request("/api/runs"), undefined, dependencies),
  },
  {
    method: "POST",
    path: "/api/runs",
    invoke: (dependencies) => createRun(
      jsonRequest("/api/runs", { xtraceEnabled: false }),
      undefined,
      dependencies,
    ),
  },
  {
    method: "GET",
    path: "/api/runs/[id]",
    invoke: (dependencies) => run(
      request("/api/runs/00000000-0000-4000-8000-000000000099"),
      params({ id: "00000000-0000-4000-8000-000000000099" }),
      dependencies,
    ),
  },
  {
    method: "GET",
    path: "/api/settings/health",
    invoke: (dependencies) => health(
      request("/api/settings/health"),
      undefined,
      dependencies,
    ),
  },
];

for (const route of authenticatedProductHandlers) {
  test(`${route.method} ${route.path} reaches product behavior with a trusted membership`, async () => {
    const response = await route.invoke(partner);
    assert.notEqual(response.status, 401);
    assert.notEqual(response.status, 403);
    assert.notEqual(response.status, 500);
  });
}

for (const route of authenticatedProductHandlers.filter(({ path }) => [
  "/api/action-drafts",
  "/api/action-drafts/[id]",
  "/api/chat",
  "/api/deals",
  "/api/deals/[id]",
  "/api/documents/[id]",
  "/api/documents/[id]/access",
  "/api/overview",
  "/api/reports/[id]",
  "/api/reports/[id]/underwriting/[dealId]",
  "/api/search",
  "/api/runs",
].includes(path))) {
  test(`${route.method} ${route.path} reaches durable behavior in the public sandbox`, async () => {
    const response = await route.invoke(publicSandboxDependencies());
    assert.notEqual(response.status, 401);
    assert.notEqual(response.status, 403);
    assert.notEqual(response.status, 500);
  });
}

const sourceMutationPaths = new Set([
  "/api/documents/upload",
  "/api/uploads",
  "/api/uploads/[id]/confirm",
  "/api/imports/confirm",
]);

for (const route of authenticatedProductHandlers.filter(
  ({ path }) => !sourceMutationPaths.has(path),
)) {
  test(`${route.method} ${route.path} allows an authenticated associate read`, async () => {
    const response = await route.invoke(productDependencies("associate"));
    assert.notEqual(response.status, 401);
    assert.notEqual(response.status, 403);
    assert.notEqual(response.status, 500);
  });
}

for (const route of [
  {
    path: "/api/documents/upload",
    invoke: (dependencies: RouteDependencies) => uploadDocument(
      emptyUploadRequest(),
      undefined,
      dependencies,
    ),
  },
  {
    path: "/api/uploads",
    invoke: (dependencies: RouteDependencies) => createUpload(
      emptyUploadRequest("/api/uploads"),
      undefined,
      dependencies,
    ),
  },
  {
    path: "/api/uploads/[id]/confirm",
    invoke: (dependencies: RouteDependencies) => confirmUpload(
      jsonRequest("/api/uploads/upload_missing/confirm", {}),
      params({ id: "upload_missing" }),
      dependencies,
    ),
  },
  {
    path: "/api/imports/confirm",
    invoke: (dependencies: RouteDependencies) => confirmImport(
      jsonRequest("/api/imports/confirm", {}),
      undefined,
      dependencies,
    ),
  },
]) {
  test(`${route.path} allows partner but denies associate source mutation`, async () => {
    assert.notEqual((await route.invoke(partner)).status, 403);
    assert.equal(
      (await route.invoke(productDependencies("associate"))).status,
      403,
    );
  });
}

test("/api/demo/reset is forbidden outside the public sandbox", async () => {
  assert.equal(
    (await resetDemo(
      jsonRequest("/api/demo/reset", {}),
      undefined,
      partner,
    )).status,
    403,
  );
  assert.equal(
    (await resetDemo(
      jsonRequest("/api/demo/reset", {}),
      undefined,
      productDependencies("associate"),
    )).status,
    403,
  );
});

for (const scenario of ["zero memberships", "ambiguous memberships"]) {
  for (const route of authenticatedProductHandlers) {
    test(`${route.method} ${route.path} fails closed for ${scenario}`, async () => {
      const response = await route.invoke({
        async resolveRequestContext() {
          throw new Error("FORBIDDEN");
        },
      });
      assert.equal(response.status, 403);
    });
  }
}

test("forged workspace selectors cannot change product read scope or cross-tenant ids", async () => {
  const trustedWorkspace = "workspace_route_trusted";
  const otherWorkspace = "workspace_route_other";
  const dependencies = productDependencies(
    "partner",
    trustedWorkspace,
    "user_forged_selector",
  );
  const intelligence = getIntelligenceRepository();
  await intelligence.saveReport(canonicalIntelligenceReportFixture({
    id: "report_route_trusted",
    workspaceId: trustedWorkspace,
    runId: "run_route_trusted_report",
    createdAt: "2026-07-28T12:00:00.000Z",
    marketSummary: "Trusted report",
  }));
  await intelligence.saveReport(canonicalIntelligenceReportFixture({
    id: "report_route_other",
    workspaceId: otherWorkspace,
    runId: "00000000-0000-4000-8000-000000000464",
    createdAt: "2026-07-28T12:01:00.000Z",
    marketSummary: "Other report",
    dealIds: ["deal_route_other"],
  }));
  const trustedRun = await getDataClient().insertRun({
    workspaceId: trustedWorkspace,
    mode: "structured",
    windowDays: 14,
  });
  const otherRun = await getDataClient().insertRun({
    workspaceId: otherWorkspace,
    mode: "structured",
    windowDays: 14,
  });
  const uploads = createMemoryUploadedDocumentsRepository();
  await uploads.create({
    id: "upload_route_trusted",
    workspaceId: trustedWorkspace,
    filename: "trusted.txt",
    contentType: "text/plain",
    byteSize: 7,
    checksum: "trusted-checksum",
    objectKey: "private/workspaces/workspace_route_trusted/trusted.txt",
  });
  await uploads.create({
    id: "upload_route_other",
    workspaceId: otherWorkspace,
    filename: "other.txt",
    contentType: "text/plain",
    byteSize: 5,
    checksum: "other-checksum",
    objectKey: "private/workspaces/workspace_route_other/other.txt",
  });
  const forged = (path: string) => request(
    `${path}${path.includes("?") ? "&" : "?"}workspaceId=${otherWorkspace}`,
    {
      headers: {
        "x-workspace-id": otherWorkspace,
        cookie: `workspaceId=${otherWorkspace}`,
      },
    },
  );

  const reportList = await reports(forged("/api/reports"), undefined, dependencies);
  const reportPayload = await reportList.json() as {
    data: Array<{ id: string }>;
  };
  assert.ok(reportPayload.data.some(({ id }) => id === "report_route_trusted"));
  assert.equal(
    reportPayload.data.some(({ id }) => id === "report_route_other"),
    false,
  );

  const runList = await runs(forged("/api/runs"), undefined, dependencies);
  const runPayload = await runList.json() as {
    data: Array<{ id: string }>;
  };
  assert.ok(runPayload.data.some(({ id }) => id === trustedRun.id));
  assert.equal(runPayload.data.some(({ id }) => id === otherRun.id), false);

  const uploadList = await uploadedDocuments(
    forged("/api/documents/uploaded"),
    undefined,
    { ...dependencies, uploadedDocuments: uploads },
  );
  assert.deepEqual(
    (await uploadList.json() as {
      data: Array<{ uploadId: string }>;
    }).data.map(
      ({ uploadId }) => uploadId,
    ),
    ["upload_route_trusted"],
  );

  assert.equal(
    (await report(
      forged("/api/reports/report_route_other"),
      params({ id: "report_route_other" }),
      dependencies,
    )).status,
    404,
  );
  assert.equal(
    (await reportCompany(
      forged("/api/reports/report_route_other/companies/deal_7bridges"),
      params({ id: "report_route_other", dealId: "deal_7bridges" }),
      dependencies,
    )).status,
    404,
  );
  const otherDealAnalyses = await dealAnalyses(
    forged("/api/deals/deal_route_other/analyses"),
    params({ id: "deal_route_other" }),
    dependencies,
  );
  assert.equal(otherDealAnalyses.status, 200);
  assert.deepEqual(
    (await otherDealAnalyses.json() as { data: unknown[] }).data,
    [],
  );
  assert.equal(
    (await run(
      forged(`/api/runs/${otherRun.id}`),
      params({ id: otherRun.id }),
      dependencies,
    )).status,
    404,
  );
  assert.equal(
    (await documentAccess(
      forged("/api/documents/upload_route_other/access"),
      params({ id: "upload_route_other" }),
      { ...dependencies, uploadedDocuments: uploads },
    )).status,
    404,
  );
});

test("public sandbox reset ignores forged selectors and preserves immutable reports", async () => {
  const trustedWorkspace = "workspace_reset_trusted";
  const otherWorkspace = "workspace_reset_other";
  const intelligence = getIntelligenceRepository();
  for (const workspaceId of [trustedWorkspace, otherWorkspace]) {
    await intelligence.saveReport(canonicalIntelligenceReportFixture({
      id: "report_reset_shared",
      workspaceId,
      runId: `run_${workspaceId}`,
      createdAt: "2026-07-28T12:00:00.000Z",
      marketSummary: workspaceId,
    }));
  }

  const response = await resetDemo(
    request(`/api/demo/reset?workspaceId=${otherWorkspace}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-workspace-id": otherWorkspace,
        cookie: `workspaceId=${otherWorkspace}`,
      },
      body: JSON.stringify({ workspaceId: otherWorkspace }),
    }),
    undefined,
    publicSandboxDependencies(trustedWorkspace),
  );

  assert.equal(response.status, 200);
  const resetAt = await getTestGenerationRepository().currentResetAt(
    trustedWorkspace,
  );
  assert.ok(resetAt);
  assert.ok(
    await intelligence.getReport(trustedWorkspace, "report_reset_shared"),
  );
  assert.ok(
    await intelligence.getReport(otherWorkspace, "report_reset_shared"),
  );
  assert.deepEqual(
    await intelligence.listReports(trustedWorkspace, resetAt),
    [],
  );
  await intelligence.resetScanProducts(otherWorkspace);
});

test("forged workspace selectors cannot redirect import-confirm writes", async () => {
  const trustedWorkspace = "workspace_confirm_trusted";
  const otherWorkspace = "workspace_confirm_other";
  const store = createDefaultDemoDataStore();
  await store.resetDemoData(trustedWorkspace);
  await store.resetDemoData(otherWorkspace);
  const documentIds = listPreloadedDocuments()
    .filter((document) => document.role !== "reference")
    .map((document) => document.id);
  const dealConfirmations = listPreloadedDocuments()
    .filter((document) => document.role === "deal_document")
    .flatMap((document) => listDocumentDeals(document).map((deal) => ({
      documentId: document.id,
      dealId: deal.dealId,
    })));
  const response = await confirmImport(
    request(
      `/api/imports/confirm?workspaceId=${otherWorkspace}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-workspace-id": otherWorkspace,
          cookie: `workspaceId=${otherWorkspace}`,
        },
        body: JSON.stringify({
          workspaceId: otherWorkspace,
          documentIds,
          dealConfirmations,
        }),
      },
    ),
    undefined,
    productDependencies(
      "partner",
      trustedWorkspace,
      "user_confirm_selector",
    ),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    await store.listWorkspaceDocumentIds(trustedWorkspace),
    documentIds.slice().sort(),
  );
  assert.deepEqual(await store.listWorkspaceDocumentIds(otherWorkspace), []);
  await store.resetDemoData(trustedWorkspace);
  await store.resetDemoData(otherWorkspace);
});

test("legacy document routes never issue or honor Source Revision capabilities for staged uploads", async () => {
  const workspaceId = "workspace_staged_capability";
  const uploadId = "upload_staged_capability";
  const objectKey = `private/workspaces/${workspaceId}/${uploadId}.txt`;
  const uploads = createMemoryUploadedDocumentsRepository();
  const objects = createMemoryPrivateObjectStorage();
  await uploads.create({
    id: uploadId,
    workspaceId,
    filename: "staged.txt",
    contentType: "text/plain",
    byteSize: 6,
    checksum: "staged-version",
    objectKey,
  });
  await objects.ensurePrivateObject({
    key: objectKey,
    bytes: new TextEncoder().encode("staged"),
    contentType: "text/plain",
  });
  const access = createPrivateDocumentAccess({
    signingSecret: "staged-capability-test-secret-at-least-32-bytes",
  });
  const dependencies: RouteDependencies = {
    ...productDependencies("partner", workspaceId, "user_staged"),
    uploadedDocuments: uploads,
    privateObjectStorage: objects,
    documentAccess: access,
  };
  const forgedStagingUrl = await access.createPrivateReadUrl({
    capability: {
      workspaceId,
      sourceRevisionId: uploadId,
      objectVersion: "staged-version",
      expiresAtEpochSeconds: Math.floor(Date.now() / 1_000) + 600,
      permission: "read",
    },
    expiresInSeconds: 600,
  });

  assert.equal((await documentAccess(
    request(`/api/documents/${uploadId}/access`),
    params({ id: uploadId }),
    dependencies,
  )).status, 404);
  assert.equal((await document(
    new Request(new URL(forgedStagingUrl, "https://vsee.test")),
    params({ id: uploadId }),
    dependencies,
  )).status, 404);

  const claim = await uploads.claimNext("extractor");
  assert.ok(claim);
  assert.equal(await uploads.savePreview({
    workspaceId,
    id: uploadId,
    workerId: claim.workerId,
    leaseToken: claim.leaseToken,
    preview: {
      candidateCompanyName: "Staged",
      candidateHeadline: "Still awaiting confirmation.",
      facts: [{
        text: "Still awaiting confirmation.",
        excerpt: "Still awaiting confirmation.",
        locator: { kind: "text_range", start: 0, end: 28 },
      }],
      extractionMetadata: {
        extractorId: "plain_text_v1",
        extractorVersion: "1",
        extractedAt: "2026-07-29T12:00:00.000Z",
        contentHash: "staged-version",
        inputBytes: 6,
        extractedCharacters: 6,
        truncated: false,
      },
    },
  }), true);
  assert.equal((await documentAccess(
    request(`/api/documents/${uploadId}/access`),
    params({ id: uploadId }),
    dependencies,
  )).status, 404);
  assert.equal((await document(
    new Request(new URL(forgedStagingUrl, "https://vsee.test")),
    params({ id: uploadId }),
    dependencies,
  )).status, 404);
});

test("an issued private capability is exact across every replay dimension", async () => {
  const workspaceId = "workspace_capability";
  const revisionId = "revision_capability";
  const objectKey = `private/workspaces/${workspaceId}/${revisionId}.txt`;
  const sources = createMemorySourceRegistry();
  const objects = createMemoryPrivateObjectStorage();
  await sources.createInitialRevision({
    id: revisionId,
    workspaceId,
    sourceId: "source_capability",
    contentHash: "content-hash-one",
    objectKey,
    objectVersion: "object-version-one",
    contentType: "text/plain",
    extractorId: "plain_text_v1",
    extractorVersion: "1",
    extractedAt: "2026-07-29T12:00:00.000Z",
    createdAt: "2026-07-29T12:00:00.000Z",
  });
  await objects.ensurePrivateObject({
    key: objectKey,
    bytes: new TextEncoder().encode("capability"),
    contentType: "text/plain",
  });
  let now = 1_700_000_000_000;
  const access = createPrivateDocumentAccess({
    signingSecret: "route-capability-test-secret-at-least-32-bytes",
    now: () => now,
  });
  const dependencies: RouteDependencies = {
    ...productDependencies("partner", workspaceId, "user_capability"),
    sourceRegistry: sources,
    privateObjectStorage: objects,
    documentAccess: access,
    now: () => now,
  };
  const issued = await documentAccess(
    request(`/api/documents/${revisionId}/access`),
    params({ id: revisionId }),
    dependencies,
  );
  assert.equal(issued.status, 307);
  const signedUrl = issued.headers.get("location");
  assert.ok(signedUrl);

  const valid = await document(
    new Request(signedUrl),
    params({ id: revisionId }),
    dependencies,
  );
  assert.equal(valid.status, 200);
  assert.equal(await valid.text(), "capability");

  const wrongWorkspace = await document(
    new Request(signedUrl),
    params({ id: revisionId }),
    {
      ...dependencies,
      ...productDependencies(
        "partner",
        "workspace_capability_other",
        "user_capability",
      ),
    },
  );
  assert.equal(wrongWorkspace.status, 404);

  assert.equal(
    (await document(
      new Request(signedUrl),
      params({ id: "revision_different_path_param" }),
      dependencies,
    )).status,
    404,
  );

  const wrongSourceRevision = new URL(signedUrl);
  wrongSourceRevision.pathname = "/api/documents/revision_different";
  assert.equal(
    (await document(
      new Request(wrongSourceRevision),
      params({ id: "revision_different" }),
      dependencies,
    )).status,
    404,
  );

  const wrongObjectVersion = tamperCapability(signedUrl, {
    objectVersion: "object-version-two",
  });
  assert.equal(
    (await document(
      new Request(wrongObjectVersion),
      params({ id: revisionId }),
      dependencies,
    )).status,
    404,
  );

  const permissionTamper = tamperCapability(signedUrl, {
    permission: "write",
  });
  assert.equal(
    (await document(
      new Request(permissionTamper),
      params({ id: revisionId }),
      dependencies,
    )).status,
    404,
  );

  const wrongRoute = new URL(signedUrl);
  wrongRoute.pathname = `/api/not-documents/${revisionId}`;
  assert.equal(
    (await document(
      new Request(wrongRoute),
      params({ id: revisionId }),
      dependencies,
    )).status,
    404,
  );

  now += 600_000;
  assert.equal(
    (await document(
      new Request(signedUrl),
      params({ id: revisionId }),
      dependencies,
    )).status,
    404,
  );
});

test("uploaded route projects a non-null preview without extraction internals", async () => {
  const workspaceId = "workspace_preview_route";
  const uploads = createMemoryUploadedDocumentsRepository();
  await uploads.create({
    id: "upload_preview_route",
    workspaceId,
    filename: "preview.txt",
    contentType: "text/plain",
    byteSize: 10,
    checksum: "preview-checksum",
    objectKey: "private/preview.txt",
  });
  const claimed = await uploads.claimNext("preview-worker");
  assert.ok(claimed);
  const preview: ExtractionPreview = {
    candidateCompanyName: "Preview Company",
    candidateHeadline: "Preview headline",
    facts: [{
      text: "Preview fact",
      excerpt: "Preview excerpt",
      locator: { kind: "text_range", start: 0, end: 15 },
    }],
    extractionMetadata: {
      extractorId: "plain_text_v1",
      extractorVersion: "1",
      extractedAt: "2026-07-28T12:00:00.000Z",
      contentHash: "route-sentinel-content-hash",
      inputBytes: 999,
      extractedCharacters: 888,
      truncated: false,
    },
  };
  assert.equal(await uploads.savePreview({
    workspaceId,
    id: claimed.id,
    workerId: claimed.workerId,
    leaseToken: claimed.leaseToken,
    preview,
  }), true);

  const response = await uploadedDocuments(
    request("/api/documents/uploaded"),
    undefined,
    {
      ...productDependencies("associate", workspaceId, "user_preview_route"),
      uploadedDocuments: uploads,
    },
  );
  assert.equal(response.status, 200);
  const payload = await response.json() as {
    data: Array<{ preview: Record<string, unknown> | null }>;
  };
  assert.deepEqual(payload.data[0].preview, {
    candidateCompanyName: "Preview Company",
    candidateHeadline: "Preview headline",
    facts: preview.facts,
  });
  assert.doesNotMatch(
    JSON.stringify(payload),
    /route-sentinel|extractor|inputBytes|extractedCharacters/,
  );
});

function productDependencies(
  role: "owner" | "partner" | "associate" | "admin",
  workspaceId = "workspace_demo",
  userId = "user_product",
  requireForgedSelectors = false,
): RouteDependencies {
  return {
    async resolveRequestContext(request) {
      if (requireForgedSelectors) {
        await assertForgedSelectors(request);
      }
      return {
        mode: "product",
        principal: {
          userId,
          email: `${userId}@example.test`,
        },
        workspaceId,
        role,
        permissions: role === "associate"
          ? {
              readWorkspace: true,
              readPrivateSources: true,
              mutateSources: false,
              managePolicy: false,
              administerFrameworks: false,
            }
          : {
              readWorkspace: true,
              readPrivateSources: true,
              mutateSources: true,
              managePolicy: role === "owner" || role === "admin",
              administerFrameworks: false,
            },
      };
    },
  };
}

function publicSandboxDependencies(
  workspaceId = "workspace_demo",
): RouteDependencies {
  return {
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
  };
}

async function assertForgedSelectors(request: Request): Promise<void> {
  const url = new URL(request.url);
  assert.equal(url.searchParams.get("workspaceId"), FORGED_SELECTOR_WORKSPACE);
  assert.equal(
    request.headers.get("x-workspace-id"),
    FORGED_SELECTOR_WORKSPACE,
  );
  assert.match(
    request.headers.get("cookie") ?? "",
    new RegExp(`(?:^|;\\s*)workspaceId=${FORGED_SELECTOR_WORKSPACE}(?:;|$)`),
  );
  if (request.method !== "POST") return;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.startsWith("application/json")) {
    assert.equal(
      (await request.clone().json() as { workspaceId?: string }).workspaceId,
      FORGED_SELECTOR_WORKSPACE,
    );
    return;
  }
  assert.equal(
    (await request.clone().formData()).get("workspaceId"),
    FORGED_SELECTOR_WORKSPACE,
  );
}

function request(path: string, init?: RequestInit): Request {
  const url = new URL(path, "https://vsee.test");
  if (!url.searchParams.has("workspaceId")) {
    url.searchParams.set("workspaceId", FORGED_SELECTOR_WORKSPACE);
  }
  const headers = new Headers(init?.headers);
  if (!headers.has("x-workspace-id")) {
    headers.set("x-workspace-id", FORGED_SELECTOR_WORKSPACE);
  }
  if (!headers.has("cookie")) {
    headers.set("cookie", `workspaceId=${FORGED_SELECTOR_WORKSPACE}`);
  }
  if (!headers.has("x-forwarded-for")) {
    headers.set("x-forwarded-for", "203.0.113.44");
  }
  return new Request(url, { ...init, headers });
}

function jsonRequest(path: string, body: unknown): Request {
  const forgedBody = body && typeof body === "object" && !Array.isArray(body)
    ? { ...(body as Record<string, unknown>), workspaceId: FORGED_SELECTOR_WORKSPACE }
    : body;
  return request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(forgedBody),
  });
}

function emptyUploadRequest(path = "/api/documents/upload"): Request {
  const form = new FormData();
  form.set("workspaceId", FORGED_SELECTOR_WORKSPACE);
  return request(path, {
    method: "POST",
    body: form,
  });
}

function tamperCapability(
  signedUrl: string,
  patch: Record<string, unknown>,
): URL {
  const url = new URL(signedUrl);
  const encoded = url.searchParams.get("capability");
  assert.ok(encoded);
  const capability = JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
  url.searchParams.set(
    "capability",
    Buffer.from(JSON.stringify({ ...capability, ...patch })).toString(
      "base64url",
    ),
  );
  return url;
}

function params<T extends Record<string, string>>(value: T): {
  params: Promise<T>;
} {
  return { params: Promise.resolve(value) };
}
