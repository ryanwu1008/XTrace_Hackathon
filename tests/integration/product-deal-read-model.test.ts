import assert from "node:assert/strict";
import test from "node:test";

import { GET as getDeal } from "../../app/api/deals/[id]/route";
import { GET as listDeals } from "../../app/api/deals/route";
import { GET as getOverview } from "../../app/api/overview/route";
import {
  createMemoryDealRegistry,
} from "../../db/repositories/deal-registry";
import {
  createMemoryIntelligenceRepository,
} from "../../db/repositories/intelligence";
import {
  createMemorySourceRegistry,
} from "../../db/repositories/source-registry";
import {
  createMemoryUploadedDocumentsRepository,
} from "../../db/repositories/uploaded-documents";
import type { RouteDependencies } from "../../lib/api/route-dependencies";
import { DEMO_FIXTURE_LABEL } from "../../lib/contracts/domain";
import { toProductDealView } from "../../lib/deals/read-model";
import { canonicalIntelligenceReportFixture } from "../helpers/canonical-intelligence-report";

const WORKSPACE_ID = "workspace_product_deals";

async function productFixture() {
  const sources = createMemorySourceRegistry();
  const deals = createMemoryDealRegistry({ sourceRegistry: sources });
  const intelligence = createMemoryIntelligenceRepository();
  const uploads = createMemoryUploadedDocumentsRepository();
  for (const [id, sourceId, createdAt] of [
    ["revision_product_a", "source_product_a", "2026-07-29T12:00:00.000Z"],
    ["revision_product_b", "source_product_b", "2026-07-29T12:01:00.000Z"],
  ] as const) {
    await sources.createInitialRevision({
      id,
      workspaceId: WORKSPACE_ID,
      sourceId,
      contentHash: `hash-${id}`,
      objectKey: `private/${WORKSPACE_ID}/${id}.md`,
      objectVersion: `version-${id}`,
      contentType: "text/markdown",
      extractorId: "plain_text_v1",
      extractorVersion: "1",
      extractedAt: createdAt,
      createdAt,
    });
    await deals.confirmSourceAssignment({
      requestId: `request-${id}`,
      workspaceId: WORKSPACE_ID,
      dealId: "deal_product",
      companyId: "company_product",
      companyName: "Product Registry Co",
      status: "evaluating",
      sourceRevisionId: id,
      assignedByUserId: "user_product",
      reason: "Confirmed product source.",
      confirmedAt: createdAt,
      ...(id === "revision_product_a"
        ? {
            memoryBundle: {
              dealId: "deal_product",
              companyName: "Product Registry Co",
              status: "evaluating" as const,
              facts: [],
              interactions: [{
                id: "fixture_product_registry",
                occurredAt: "2026-07-01T12:00:00.000Z",
                summary:
                  "Sample internal note: the team deferred the company.",
                decisionReason:
                  "The sample team deferred pending enterprise proof.",
                concerns: ["Production adoption was not established."],
                revisitConditions: [
                  "Verify a named production customer.",
                ],
                provenance: "demo_fixture" as const,
                label: DEMO_FIXTURE_LABEL,
              }],
            },
            memoryLineage: {
              evidence: {},
              interactions: {
                fixture_product_registry: {
                  workspaceId: WORKSPACE_ID,
                  dealId: "deal_product",
                  sourceId,
                  sourceRevisionId: id,
                },
              },
            },
          }
        : {}),
    });
  }
  await sources.createInitialRevision({
    id: "revision_no_memory",
    workspaceId: WORKSPACE_ID,
    sourceId: "source_no_memory",
    contentHash: "hash-revision-no-memory",
    objectKey: `private/${WORKSPACE_ID}/revision_no_memory.md`,
    objectVersion: "version-revision-no-memory",
    contentType: "text/markdown",
    extractorId: "plain_text_v1",
    extractorVersion: "1",
    extractedAt: "2026-07-29T12:02:00.000Z",
    createdAt: "2026-07-29T12:02:00.000Z",
  });
  await deals.confirmSourceAssignment({
    requestId: "request-revision-no-memory",
    workspaceId: WORKSPACE_ID,
    dealId: "deal_no_memory",
    companyId: "company_no_memory",
    companyName: "No Memory Co",
    status: "watchlist",
    sourceRevisionId: "revision_no_memory",
    assignedByUserId: "user_product",
    reason: "Confirmed source without a sample interaction.",
    confirmedAt: "2026-07-29T12:02:00.000Z",
  });
  await intelligence.saveReport(canonicalIntelligenceReportFixture({
    id: "report_product",
    workspaceId: WORKSPACE_ID,
    runId: "run_product",
    createdAt: "2026-07-29T13:00:00.000Z",
    marketSummary: "Product report",
  }));
  await uploads.create({
    id: "upload_product",
    workspaceId: WORKSPACE_ID,
    filename: "pending.md",
    contentType: "text/markdown",
    byteSize: 10,
    checksum: "pending-hash",
    objectKey: `private/${WORKSPACE_ID}/pending.md`,
  });
  const dependencies: RouteDependencies = {
    async resolveRequestContext() {
      return {
        mode: "product",
        principal: { userId: "user_product", email: "product@example.test" },
        workspaceId: WORKSPACE_ID,
        role: "associate",
        permissions: {
          readWorkspace: true,
          readPrivateSources: true,
          mutateSources: false,
          managePolicy: false,
          administerFrameworks: false,
        },
      };
    },
    dealRegistry: deals,
    sourceRegistry: sources,
    intelligence,
    uploadedDocuments: uploads,
    now: () => Date.parse("2026-07-29T14:00:00.000Z"),
  };
  return { dependencies, deals, sources };
}

test("product Deal list projects the registry and exact active source links", async () => {
  const { dependencies } = await productFixture();
  const response = await listDeals(
    new Request("https://vsee.test/api/deals?q=registry&status=evaluating"),
    undefined,
    dependencies,
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json() as { data: unknown[] }).data, [{
    id: "deal_product",
    companyName: "Product Registry Co",
    status: "evaluating",
    documentId: "revision_product_a",
    sourceTitle: "2 confirmed sources",
    sourceUrl: "/api/source-revisions/revision_product_a/access",
    sourceRevisionIds: ["revision_product_a", "revision_product_b"],
    sourceCount: 2,
    sourceLinks: [
      {
        sourceRevisionId: "revision_product_a",
        sourceUrl: "/api/source-revisions/revision_product_a/access",
      },
      {
        sourceRevisionId: "revision_product_b",
        sourceUrl: "/api/source-revisions/revision_product_b/access",
      },
    ],
    fixture: {
      id: "fixture_product_registry",
      label: "Sample decision record",
      provenance: "demo_fixture",
      meetingSummary:
        "Sample internal note: the team deferred the company.",
      decisionReason:
        "The sample team deferred pending enterprise proof.",
      concerns: ["Production adoption was not established."],
      revisitConditions: ["Verify a named production customer."],
    },
  }]);
});

test("product Deal search includes the durable sample decision and revisit condition", async () => {
  const { dependencies } = await productFixture();
  for (const query of ["enterprise proof", "named production customer"]) {
    const response = await listDeals(
      new Request(`https://vsee.test/api/deals?q=${encodeURIComponent(query)}`),
      undefined,
      dependencies,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(
      (await response.json() as { data: Array<{ id: string }> }).data.map(
        (deal) => deal.id,
      ),
      ["deal_product"],
    );
  }
});

test("product Deal projection rejects a sample interaction linked to another Deal", () => {
  assert.throws(() => toProductDealView({
    id: "deal_product",
    workspaceId: WORKSPACE_ID,
    companyId: "company_product",
    companyName: "Product Registry Co",
    status: "evaluating",
    analysisEligibleAt: "2026-07-29T12:00:00.000Z",
    activeSourceRevisionFingerprint: `sha256:${"1".repeat(64)}`,
    activeSourceRevisionIds: ["revision_product_a"],
  }, {
    dealId: "deal_foreign",
    companyName: "Foreign Co",
    status: "passed",
    facts: [],
    interactions: [{
      id: "fixture_foreign",
      occurredAt: "2026-07-01T12:00:00.000Z",
      summary: "Sample foreign note.",
      decisionReason: "Sample foreign decision.",
      concerns: [],
      revisitConditions: [],
      provenance: "demo_fixture",
      label: DEMO_FIXTURE_LABEL,
    }],
  }), /memory bundle must match its registry Deal identity/i);
});

test("product Deal detail cannot fall back to a demo fixture or cross scope", async () => {
  const { dependencies } = await productFixture();
  const response = await getDeal(
    new Request("https://vsee.test/api/deals/deal_product"),
    { params: Promise.resolve({ id: "deal_product" }) },
    dependencies,
  );
  assert.equal(response.status, 200);
  const payload = await response.json() as { data: Record<string, unknown> };
  assert.equal(payload.data.companyName, "Product Registry Co");
  assert.deepEqual(payload.data.fixture, {
    id: "fixture_product_registry",
    label: "Sample decision record",
    provenance: "demo_fixture",
    meetingSummary: "Sample internal note: the team deferred the company.",
    decisionReason: "The sample team deferred pending enterprise proof.",
    concerns: ["Production adoption was not established."],
    revisitConditions: ["Verify a named production customer."],
  });
  assert.deepEqual(payload.data.sourceRevisionIds, [
    "revision_product_a",
    "revision_product_b",
  ]);

  const missingDemo = await getDeal(
    new Request("https://vsee.test/api/deals/deal_7bridges"),
    { params: Promise.resolve({ id: "deal_7bridges" }) },
    dependencies,
  );
  assert.equal(missingDemo.status, 404);
});

test("product overview uses real registry/report/upload availability counts", async () => {
  const { dependencies } = await productFixture();
  const response = await getOverview(
    new Request("https://vsee.test/api/overview"),
    undefined,
    dependencies,
  );
  assert.equal(response.status, 200);
  const payload = await response.json() as {
    data: {
      generatedAt: string;
      stats: Record<string, number>;
      deals: Array<Record<string, unknown>>;
      documents: unknown[];
    };
  };
  assert.equal(payload.data.generatedAt, "2026-07-29T14:00:00.000Z");
  assert.deepEqual(payload.data.stats, {
    deals: 2,
    marketReports: 1,
    referenceDocuments: 0,
    fixtureDeals: 1,
    activeSourceRevisions: 3,
    uploads: 1,
  });
  const productDeal = payload.data.deals.find((deal) =>
    deal.companyName === "Product Registry Co"
  );
  const unlinkedDeal = payload.data.deals.find((deal) =>
    deal.companyName === "No Memory Co"
  );
  assert.equal(
    (productDeal?.fixture as { label?: string } | undefined)?.label,
    "Sample decision record",
  );
  assert.equal("fixture" in (unlinkedDeal ?? {}), false);
  assert.deepEqual(payload.data.documents, []);
});

test("public demo Deal and overview reads retain the synthetic view model", async () => {
  const demoDependencies: RouteDependencies = {
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
  const deals = await listDeals(
    new Request("https://vsee.test/api/deals?q=7bridges"),
    undefined,
    demoDependencies,
  );
  const overview = await getOverview(
    new Request("https://vsee.test/api/overview"),
    undefined,
    demoDependencies,
  );
  assert.equal(deals.status, 200);
  assert.equal(
    (await deals.json() as { data: Array<{ id: string }> }).data[0].id,
    "deal_7bridges",
  );
  assert.ok(
    (await overview.json() as { data: { stats: { fixtureDeals: number } } })
      .data.stats.fixtureDeals > 0,
  );
});
