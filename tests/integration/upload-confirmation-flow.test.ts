import assert from "node:assert/strict";
import test from "node:test";

import { openSourceRevision } from "../../app/source-revision-link";
import { POST as createUpload } from "../../app/api/uploads/route";
import { GET as getUpload } from "../../app/api/uploads/[id]/route";
import { POST as confirmUpload } from "../../app/api/uploads/[id]/confirm/route";
import { GET as accessRevision } from "../../app/api/source-revisions/[id]/access/route";
import { GET as readDocument } from "../../app/api/documents/[id]/route";
import {
  createMemoryUploadedDocumentsRepository,
  type ExtractionPreview,
} from "../../db/repositories/uploaded-documents";
import { createMemorySourceRegistry } from "../../db/repositories/source-registry";
import { createMemoryDealRegistry } from "../../db/repositories/deal-registry";
import type { RouteDependencies } from "../../lib/api/route-dependencies";
import { evidenceSourceText } from "../../lib/contracts/domain";
import {
  createMemoryPrivateObjectStorage,
  createPrivateDocumentAccess,
} from "../../lib/storage/service";

function productDependencies(workspaceId = "workspace_1"): RouteDependencies {
  const uploads = createMemoryUploadedDocumentsRepository();
  const sources = createMemorySourceRegistry();
  return {
    async resolveRequestContext() {
      return {
        mode: "product",
        principal: { userId: "user_1", email: "user@example.test" },
        workspaceId,
        role: "partner",
        permissions: {
          readWorkspace: true,
          readPrivateSources: true,
          mutateSources: true,
          managePolicy: true,
          administerFrameworks: false,
        },
      };
    },
    uploadedDocuments: uploads,
    sourceRegistry: sources,
    dealRegistry: createMemoryDealRegistry({ sourceRegistry: sources }),
    privateObjectStorage: createMemoryPrivateObjectStorage(),
    documentAccess: createPrivateDocumentAccess({
      signingSecret: "upload-confirmation-route-secret-at-least-32-bytes",
      routePrefix: "/api/documents",
    }),
  };
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

test("product upload returns 202, preview is safe, and explicit confirmation promotes it", async () => {
  const dependencies = productDependencies();
  const form = new FormData();
  form.set("file", new File(["Acme serves carriers."], "../../acme.md", {
    type: "text/markdown",
  }));
  const created = await createUpload(new Request("https://vsee.test/api/uploads", {
    method: "POST",
    body: form,
  }), undefined, dependencies);
  assert.equal(created.status, 202);
  const createdBody = await created.json() as {
    data: { uploadId: string; status: string };
  };
  assert.equal(createdBody.data.status, "queued");

  const claimed = await dependencies.uploadedDocuments!.claimNext("extractor");
  assert.ok(claimed);
  const preview: ExtractionPreview = {
    candidateCompanyName: "Acme",
    candidateHeadline: "Acme serves carriers.",
    facts: [{
      text: "Acme serves carriers.",
      excerpt: "Acme serves carriers.",
      locator: { kind: "text_range", start: 0, end: 21 },
    }],
    extractionMetadata: {
      extractorId: "plain_text_v1",
      extractorVersion: "1",
      extractedAt: "2026-07-29T12:00:00.000Z",
      contentHash: "f".repeat(64),
      inputBytes: 21,
      extractedCharacters: 21,
      truncated: false,
    },
  };
  assert.equal(await dependencies.uploadedDocuments!.savePreview({
    workspaceId: "workspace_1",
    id: claimed.id,
    workerId: claimed.workerId,
    leaseToken: claimed.leaseToken,
    preview,
  }), true);

  const previewResponse = await getUpload(
    new Request(`https://vsee.test/api/uploads/${claimed.id}`),
    params(claimed.id),
    dependencies,
  );
  assert.equal(previewResponse.status, 200);
  const serialized = JSON.stringify(await previewResponse.json());
  for (const secret of [
    "workspace_1",
    "objectKey",
    "checksum",
    "workerId",
    "leaseToken",
    "providerJobId",
    "recalledMemory",
  ]) {
    assert.equal(serialized.includes(secret), false);
  }

  const confirmed = await confirmUpload(
    new Request(`https://vsee.test/api/uploads/${claimed.id}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        companyName: "Acme",
        assignment: { kind: "new_deal", dealStatus: "evaluating" },
      }),
    }),
    params(claimed.id),
    dependencies,
  );
  assert.equal(confirmed.status, 200);
  assert.equal(
    (await confirmed.json() as { data: { status: string } }).data.status,
    "confirmed",
  );
  const conflictingReplay = await confirmUpload(
    new Request(`https://vsee.test/api/uploads/${claimed.id}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        companyName: "Different Co",
        assignment: { kind: "new_deal", dealStatus: "passed" },
      }),
    }),
    params(claimed.id),
    dependencies,
  );
  assert.equal(conflictingReplay.status, 409);
});

test("PDF page lineage reaches Deal memory only after explicit confirmation", async () => {
  const dependencies = productDependencies();
  const excerpt =
    "Second-page evidence: Acme signed three enterprise customers.";
  await dependencies.uploadedDocuments!.create({
    id: "upload_pdf_lineage",
    workspaceId: "workspace_1",
    filename: "acme.pdf",
    contentType: "application/pdf",
    byteSize: 1_024,
    checksum: "pdf-lineage-hash",
    objectKey:
      "private/workspaces/workspace_1/uploads/upload_pdf_lineage/acme.pdf",
  });
  const claimed = await dependencies.uploadedDocuments!.claimNext("extractor");
  assert.ok(claimed);
  assert.equal(await dependencies.uploadedDocuments!.savePreview({
    workspaceId: claimed.workspaceId,
    id: claimed.id,
    workerId: claimed.workerId,
    leaseToken: claimed.leaseToken,
    preview: {
      candidateCompanyName: "Acme",
      candidateHeadline: null,
      facts: [{
        text: "Acme signed three enterprise customers.",
        excerpt,
        locator: { kind: "pdf_page", page: 2, excerpt },
      }],
      extractionMetadata: {
        extractorId: "pdf_text_v1",
        extractorVersion: "1",
        extractedAt: "2026-07-30T12:00:00.000Z",
        contentHash: "pdf-lineage-hash",
        inputBytes: 1_024,
        extractedCharacters: excerpt.length,
        truncated: false,
      },
    },
  }), true);
  assert.deepEqual(
    await dependencies.dealRegistry!.listAnalysisEligibleBundles("workspace_1"),
    [],
  );

  const confirmed = await confirmUpload(
    new Request(
      "https://vsee.test/api/uploads/upload_pdf_lineage/confirm",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyName: "Acme",
          assignment: { kind: "new_deal", dealStatus: "evaluating" },
        }),
      },
    ),
    params("upload_pdf_lineage"),
    dependencies,
  );
  assert.equal(confirmed.status, 200);
  const [bundle] = await dependencies.dealRegistry!
    .listAnalysisEligibleBundles("workspace_1");
  assert.ok(bundle);
  const source = bundle.facts[0]?.sources[0];
  assert.ok(source);
  const page = "schemaVersion" in source
    && source.locator?.kind === "document_page"
    ? source.locator.page
    : "page" in source
    ? source.page
    : undefined;
  assert.deepEqual({
    provenance: source.provenance,
    title: source.title,
    page,
    excerpt: evidenceSourceText(source),
  }, {
    provenance: "source_document",
    title: "acme.pdf",
    page: 2,
    excerpt,
  });
});

test("confirmation cannot select a Deal outside the request workspace", async () => {
  const dependencies = productDependencies("workspace_owner");
  await dependencies.uploadedDocuments!.create({
    id: "upload_cross_workspace",
    workspaceId: "workspace_owner",
    filename: "cross.txt",
    contentType: "text/plain",
    byteSize: 5,
    checksum: "cross-hash",
    objectKey: "private/cross.txt",
  });
  const claim = await dependencies.uploadedDocuments!.claimNext("extractor");
  assert.ok(claim);
  assert.equal(await dependencies.uploadedDocuments!.savePreview({
    workspaceId: claim.workspaceId,
    id: claim.id,
    workerId: claim.workerId,
    leaseToken: claim.leaseToken,
    preview: {
      candidateCompanyName: "Cross",
      candidateHeadline: null,
      facts: [{
        text: "Cross",
        excerpt: "Cross",
        locator: { kind: "text_range", start: 0, end: 5 },
      }],
      extractionMetadata: {
        extractorId: "plain_text_v1",
        extractorVersion: "1",
        extractedAt: "2026-07-29T12:00:00.000Z",
        contentHash: "cross-hash",
        inputBytes: 5,
        extractedCharacters: 5,
        truncated: false,
      },
    },
  }), true);

  const response = await confirmUpload(
    new Request("https://vsee.test/api/uploads/upload_cross_workspace/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        companyName: "Foreign Co",
        assignment: {
          kind: "existing_deal",
          dealId: "deal_from_another_workspace",
        },
      }),
    }),
    params("upload_cross_workspace"),
    dependencies,
  );
  assert.equal(response.status, 404);
});

test("public demo cannot upload, confirm, or create private source access", async () => {
  const dependencies: RouteDependencies = {
    async resolveRequestContext() {
      return {
        mode: "public_demo",
        principal: null,
        workspaceId: "workspace_demo",
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
  };
  const upload = await createUpload(
    new Request("https://vsee.test/api/uploads", { method: "POST" }),
    undefined,
    dependencies,
  );
  const confirm = await confirmUpload(
    new Request("https://vsee.test/api/uploads/upload_1/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
    params("upload_1"),
    dependencies,
  );
  const access = await accessRevision(
    new Request("https://vsee.test/api/source-revisions/revision_1/access"),
    params("revision_1"),
    dependencies,
  );
  assert.deepEqual([upload.status, confirm.status, access.status], [403, 403, 403]);
});

test("source revision access is workspace scoped and returns only URL plus expiry", async () => {
  const owner = productDependencies("workspace_owner");
  await owner.sourceRegistry!.createInitialRevision({
    id: "revision_private",
    workspaceId: "workspace_owner",
    sourceId: "source_private",
    contentHash: "hash",
    objectKey: "private/workspaces/workspace_owner/source.txt",
    objectVersion: "hash",
    contentType: "text/plain",
    extractorId: "plain_text_v1",
    extractorVersion: "1",
    extractedAt: "2026-07-29T12:00:00.000Z",
    createdAt: "2026-07-29T12:00:00.000Z",
  });
  await owner.privateObjectStorage!.ensurePrivateObject({
    key: "private/workspaces/workspace_owner/source.txt",
    bytes: new TextEncoder().encode("private source bytes"),
    contentType: "text/plain",
  });

  const allowed = await accessRevision(
    new Request("https://vsee.test/api/source-revisions/revision_private/access"),
    params("revision_private"),
    owner,
  );
  assert.equal(allowed.status, 200);
  const accessPayload = await allowed.json() as {
    data: { url: string; expiresAt: string };
  };
  assert.deepEqual(
    Object.keys(accessPayload.data).sort(),
    ["expiresAt", "url"],
  );
  const directNavigation = await accessRevision(
    new Request(
      "https://vsee.test/api/source-revisions/revision_private/access",
      { headers: { accept: "text/html" } },
    ),
    params("revision_private"),
    owner,
  );
  assert.equal(directNavigation.status, 307);
  assert.equal(directNavigation.headers.get("cache-control"), "private, no-store");
  assert.equal(
    directNavigation.headers.get("location"),
    new URL(accessPayload.data.url, "https://vsee.test").toString(),
  );
  const content = await readDocument(
    new Request(new URL(accessPayload.data.url, "https://vsee.test")),
    params("revision_private"),
    owner,
  );
  assert.equal(content.status, 200);
  assert.equal(await content.text(), "private source bytes");

  let routeIssuedUrl = "";
  let navigatedUrl = "";
  await openSourceRevision({
    revisionId: "revision_private",
    request: async (accessPath) => {
      assert.equal(
        accessPath,
        "/api/source-revisions/revision_private/access",
      );
      const response = await accessRevision(
        new Request(`https://vsee.test${accessPath}`),
        params("revision_private"),
        owner,
      );
      assert.equal(response.status, 200);
      const payload = await response.json() as {
        data: { url: string; expiresAt: string };
      };
      routeIssuedUrl = payload.data.url;
      return payload.data;
    },
    navigate(url) {
      navigatedUrl = url;
    },
  });
  assert.equal(navigatedUrl, routeIssuedUrl);
  assert.match(navigatedUrl, /^\/api\/documents\/revision_private\?/);
  const openedContent = await readDocument(
    new Request(new URL(navigatedUrl, "https://vsee.test")),
    params("revision_private"),
    owner,
  );
  assert.equal(openedContent.status, 200);
  assert.equal(await openedContent.text(), "private source bytes");

  const denied = await accessRevision(
    new Request("https://vsee.test/api/source-revisions/revision_private/access"),
    params("revision_private"),
    { ...owner, ...productDependencies("workspace_other") },
  );
  assert.equal(denied.status, 404);
});
