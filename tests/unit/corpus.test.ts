import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DEMO_DEAL_EVIDENCE } from "../../lib/corpus/evidence";
import { DEMO_FIXTURES } from "../../lib/corpus/fixtures";
import { DEMO_MARKET_REPORT_EVIDENCE } from "../../lib/corpus/market-evidence";
import {
  evidenceSourceText,
  type EvidenceSourceRef,
} from "../../lib/contracts/domain";
import {
  getPreloadedDocument,
  listDocumentDeals,
  listPreloadedDocuments,
  parseCorpusManifest,
} from "../../lib/corpus/manifest";
import {
  buildPreloadedDealMemoryBundles,
  confirmImport,
  createCorpusService,
  previewImport,
  type CorpusPersistence,
} from "../../lib/corpus/service";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function evidenceSourcePage(source: EvidenceSourceRef | undefined) {
  if (!source) return undefined;
  if (!("schemaVersion" in source)) return source.page;
  return source.locator?.kind === "document_page"
    ? source.locator.page
    : undefined;
}

test("the fixed corpus is exactly 9 pitch decks, 4 market reports, and 1 reference with matching files", async () => {
  const documents = listPreloadedDocuments();

  assert.equal(documents.length, 14);
  assert.equal(documents.filter((document) => document.role === "deal_document").length, 9);
  assert.equal(documents.filter((document) => document.role === "market_report").length, 4);
  assert.equal(documents.filter((document) => document.role === "reference").length, 1);
  assert.equal(new Set(documents.map((document) => document.id)).size, 14);
  assert.equal(new Set(documents.map((document) => document.filename)).size, 14);
  assert.equal(new Set(documents.map((document) => document.checksum)).size, 14);

  for (const document of documents) {
    assert.equal(
      document.role === "deal_document",
      listDocumentDeals(document).length > 0,
    );
    const bytes = await readFile(path.join(workspaceRoot, "seed", "corpus", document.filename));
    assert.equal(bytes.byteLength, document.byteSize, `${document.filename} byte size`);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      document.checksum,
      `${document.filename} checksum`,
    );
  }
});

test("manifest validation rejects malformed fields, duplicate keys, and role-count drift", () => {
  const valid = {
    version: 1,
    documents: listPreloadedDocuments().map((document) => ({ ...document })),
  };

  assert.throws(
    () => parseCorpusManifest({
      ...valid,
      documents: valid.documents.map((document, index) => index === 0
        ? { ...document, checksum: "not-a-sha" }
        : document),
    }),
    /checksum/i,
  );
  assert.throws(
    () => parseCorpusManifest({
      ...valid,
      documents: valid.documents.map((document, index) => index === 1
        ? { ...document, id: valid.documents[0].id }
        : document),
    }),
    /duplicate document id/i,
  );
  assert.throws(
    () => parseCorpusManifest({
      ...valid,
      documents: valid.documents.map((document, index) => index === 0
        ? { ...document, role: "market_report", company: undefined, dealId: undefined }
        : document),
    }),
    /exactly 9 deal_document/i,
  );
});

test("every synthetic record is permanently labeled and every selected deal has real page evidence", () => {
  const manifestDealIds = listPreloadedDocuments()
    .filter((document) => document.role === "deal_document")
    .flatMap((document) => listDocumentDeals(document).map((deal) => deal.dealId));

  assert.equal(DEMO_FIXTURES.length, 19);
  assert.equal(new Set(DEMO_FIXTURES.map((fixture) => fixture.dealId)).size, 19);
  assert.deepEqual(
    new Set(DEMO_FIXTURES.map((fixture) => fixture.dealId)),
    new Set(manifestDealIds),
  );
  assert.ok(DEMO_FIXTURES.every((fixture) => fixture.provenance === "demo_fixture"));
  assert.ok(DEMO_FIXTURES.every(
    (fixture) => fixture.label === "Sample decision record",
  ));
  assert.equal(DEMO_DEAL_EVIDENCE.length, DEMO_FIXTURES.length);

  for (const fixture of DEMO_FIXTURES) {
    assert.ok(fixture.decisionReason.trim(), `missing decision reason for ${fixture.dealId}`);
    assert.ok(fixture.concerns.length > 0, `missing concerns for ${fixture.dealId}`);
    assert.ok(
      fixture.concerns.every((concern) => concern.trim()),
      `blank concern for ${fixture.dealId}`,
    );
    assert.ok(
      fixture.revisitConditions.length > 0,
      `missing revisit conditions for ${fixture.dealId}`,
    );
    assert.ok(
      fixture.revisitConditions.every((condition) => condition.trim()),
      `blank revisit condition for ${fixture.dealId}`,
    );
    assert.ok(fixture.meetingSummary.trim(), `missing meeting summary for ${fixture.dealId}`);
    const evidence = DEMO_DEAL_EVIDENCE.find((item) => item.dealId === fixture.dealId);
    assert.ok(evidence, `missing evidence for ${fixture.dealId}`);
    assert.equal(evidence.provenance, "source_document");
    assert.equal(evidence.documentId, fixture.documentId);
    assert.ok(evidence.page > 0);
    assert.ok(evidence.excerpt.length >= 20);
    assert.doesNotMatch(evidence.excerpt, /included in (the )?fixed demo corpus/i);
  }
});

test("all four supplied market reports have page-level baseline evidence", () => {
  assert.equal(DEMO_MARKET_REPORT_EVIDENCE.length, 4);
  assert.equal(
    new Set(DEMO_MARKET_REPORT_EVIDENCE.map((evidence) => evidence.documentId)).size,
    4,
  );
  assert.ok(DEMO_MARKET_REPORT_EVIDENCE.every((evidence) =>
    evidence.source.provenance === "source_document"
    && Boolean(evidence.source.documentId)
    && Boolean(evidence.source.page)
    && evidence.source.excerpt.length >= 40
  ));
  for (const evidence of DEMO_MARKET_REPORT_EVIDENCE) {
    const document = getPreloadedDocument(evidence.documentId);
    assert.ok(document, `missing market report ${evidence.documentId}`);
    assert.equal(document.role, "market_report");
    assert.equal(evidence.source.documentId, document.id);
  }
});

test("preview accepts only importable preloaded documents", () => {
  const [dealDocument] = listPreloadedDocuments().filter((document) => document.role === "deal_document");
  const [marketReport] = listPreloadedDocuments().filter((document) => document.role === "market_report");
  const [reference] = listPreloadedDocuments().filter((document) => document.role === "reference");

  assert.deepEqual(previewImport([dealDocument.id, marketReport.id]), [
    {
      documentId: dealDocument.id,
      title: dealDocument.title,
      classification: "deal_document",
      company: dealDocument.company,
      deals: [{
        dealId: dealDocument.dealId!,
        companyName: dealDocument.company!,
        page: undefined,
      }],
      requiresDealConfirmation: true,
    },
    {
      documentId: marketReport.id,
      title: marketReport.title,
      classification: "market_report",
      company: undefined,
      deals: [],
      requiresDealConfirmation: false,
    },
  ]);
  assert.throws(() => previewImport([reference.id]), /reference-only/i);
  assert.throws(() => previewImport(["not-in-the-demo-corpus"]), /Unknown preloaded document/);
});

test("confirm validates the whole request before writes and rejects duplicates, mismatches, and references", async () => {
  const [dealDocument] = listPreloadedDocuments().filter((document) => document.role === "deal_document");
  const [reference] = listPreloadedDocuments().filter((document) => document.role === "reference");
  const writes: string[] = [];
  const persistence = createPersistence(writes);

  const invalidInputs = [
    {
      workspaceId: "workspace_demo",
      documentIds: [dealDocument.id],
      dealConfirmations: [],
    },
    {
      workspaceId: "workspace_demo",
      documentIds: [dealDocument.id],
      dealConfirmations: [{ documentId: dealDocument.id, dealId: "deal_wrong" }],
    },
    {
      workspaceId: "workspace_demo",
      documentIds: [dealDocument.id, dealDocument.id],
      dealConfirmations: [{ documentId: dealDocument.id, dealId: dealDocument.dealId! }],
    },
    {
      workspaceId: "workspace_demo",
      documentIds: [reference.id],
      dealConfirmations: [],
    },
  ];

  for (const input of invalidInputs) {
    await assert.rejects(confirmImport(input, persistence));
    assert.deepEqual(writes, [], "invalid input must not partially mutate persistence");
  }
});

test("confirmation persists the complete labeled fixture and emits page-backed evidence", async () => {
  const document = listPreloadedDocuments().find((item) => item.id === "doc_7bridges");
  const fixture = DEMO_FIXTURES.find((item) => item.documentId === document?.id);
  assert.ok(document && fixture);

  const writes: string[] = [];
  let persistedFixture: unknown;
  const persistence = createPersistence(writes, (input) => {
    persistedFixture = input.fixture;
  });
  const service = createCorpusService(persistence);
  const result = await service.confirmImport({
    workspaceId: "workspace_demo",
    documentIds: [document.id],
    dealConfirmations: [{ documentId: document.id, dealId: fixture.dealId }],
  });

  assert.deepEqual(writes, [
    `document:${document.id}`,
    `deal:${fixture.dealId}`,
    `fixture:${fixture.id}:demo_fixture`,
  ]);
  assert.deepEqual(persistedFixture, fixture);
  assert.equal(result.memoryBundles.length, 1);
  assert.equal(result.memoryBundles[0].interactions[0].provenance, "demo_fixture");
  assert.equal(
    result.memoryBundles[0].interactions[0].label,
    "Sample decision record",
  );
  assert.equal(result.memoryBundles[0].facts[0].sources[0].provenance, "source_document");
  assert.equal(evidenceSourcePage(result.memoryBundles[0].facts[0].sources[0]), 4);
  assert.match(
    evidenceSourceText(result.memoryBundles[0].facts[0].sources[0]),
    /unified, AI powered logistics platform/i,
  );
});

test("confirmation creates source-backed memory and synthetic decision context for 100Plus", async () => {
  const document = listPreloadedDocuments().find((item) => item.id === "doc_100plus");
  assert.ok(document);

  const result = await confirmImport({
    workspaceId: "workspace_demo",
    documentIds: [document.id],
    dealConfirmations: [{ documentId: document.id, dealId: document.dealId! }],
  }, createPersistence([]));

  assert.equal(result.memoryBundles.length, 1);
  assert.equal(result.memoryBundles[0].dealId, "deal_100plus");
  assert.equal(result.memoryBundles[0].status, "evaluating");
  assert.equal(result.memoryBundles[0].interactions.length, 1);
  assert.match(
    result.memoryBundles[0].interactions[0].decisionReason,
    /remote patient monitoring/i,
  );
  assert.equal(result.memoryBundles[0].interactions[0].provenance, "demo_fixture");
  assert.equal(evidenceSourcePage(result.memoryBundles[0].facts[0].sources[0]), 1);
});

test("confirmation splits the combined PDF into eleven page-scoped Deals", async () => {
  const document = listPreloadedDocuments().find(
    (item) => item.id === "doc_pitch_combined",
  );
  assert.ok(document);
  const deals = listDocumentDeals(document);
  const writes: string[] = [];

  const result = await confirmImport({
    workspaceId: "workspace_demo",
    documentIds: [document.id],
    dealConfirmations: deals.map((deal) => ({
      documentId: document.id,
      dealId: deal.dealId,
    })),
  }, createPersistence(writes));

  assert.equal(
    writes.filter((entry) => entry === `document:${document.id}`).length,
    1,
  );
  assert.deepEqual(
    result.memoryBundles.map((bundle) => ({
      dealId: bundle.dealId,
      page: evidenceSourcePage(bundle.facts[0]?.sources[0]),
    })),
    deals.map((deal) => ({ dealId: deal.dealId, page: deal.page })),
  );
});

test("the worker builds all single- and multi-page preloaded Deal memory bundles", () => {
  const bundles = buildPreloadedDealMemoryBundles();
  assert.equal(bundles.length, 19);
  assert.equal(new Set(bundles.map((bundle) => bundle.dealId)).size, 19);
  assert.equal(
    bundles.every((bundle) => evidenceSourcePage(bundle.facts[0]?.sources[0])),
    true,
  );
  assert.equal(bundles.filter((bundle) =>
    bundle.facts[0]?.sources[0]?.documentId === "doc_pitch_combined"
  ).length, 11);
});

test("the public corpus service exposes only guarded operations and delegates a ten-minute private read URL", async () => {
  const document = listPreloadedDocuments()[0];
  const writes: string[] = [];
  const persistence = createPersistence(writes);
  const service = createCorpusService(persistence);

  assert.deepEqual(
    Object.keys(service).sort(),
    ["confirmImport", "getSignedDocumentUrl", "list", "previewImport"],
  );
  const signedUrl = await service.getSignedDocumentUrl({
    context: {
      mode: "product",
      principal: { userId: "user_1", email: "user@example.test" },
      workspaceId: "workspace_demo",
      role: "partner",
      permissions: {
        readWorkspace: true,
        readPrivateSources: true,
        mutateSources: true,
        managePolicy: false,
        administerFrameworks: false,
      },
    },
    documentId: document.id,
  });
  const parsed = new URL(signedUrl, "https://app.example.test");
  assert.equal(parsed.origin, "https://app.example.test");
  assert.equal(parsed.pathname, `/api/documents/${document.id}`);
  assert.ok(parsed.searchParams.has("capability"));
  assert.ok(parsed.searchParams.has("signature"));
  assert.equal(parsed.searchParams.has("token"), false);
  assert.equal(writes.at(-1), `signed:${document.id}:600`);
});

function createPersistence(
  writes: string[],
  onFixture?: (input: Parameters<CorpusPersistence["ensureFixture"]>[0]) => void,
): CorpusPersistence {
  return {
    async ensureWorkspaceDocument({ documentId }) {
      writes.push(`document:${documentId}`);
      return { documentId };
    },
    async ensureDeal({ dealId }) {
      writes.push(`deal:${dealId}`);
      return { dealId };
    },
    async ensureFixture(input) {
      onFixture?.(input);
      writes.push(`fixture:${input.fixture.id}:${input.fixture.provenance}`);
      return { fixtureId: input.fixture.id };
    },
    async createPrivateReadUrl({ capability, expiresInSeconds }) {
      writes.push(`signed:${capability.sourceRevisionId}:${expiresInSeconds}`);
      return `/api/documents/${encodeURIComponent(capability.sourceRevisionId)}?capability=read-only&signature=read-only`;
    },
  };
}
