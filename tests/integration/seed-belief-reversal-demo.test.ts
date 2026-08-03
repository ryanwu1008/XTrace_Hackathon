import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createMemoryDealRegistry } from "../../db/repositories/deal-registry";
import { createMemoryEvidencePacksRepository } from "../../db/repositories/evidence-packs";
import { createMemorySourceRegistry } from "../../db/repositories/source-registry";
import { getProductInputReadiness } from "../../lib/corpus/import-readiness";
import { DEMO_DEAL_EVIDENCE } from "../../lib/corpus/evidence";
import { DEMO_FIXTURES } from "../../lib/corpus/fixtures";
import { listPreloadedDocuments } from "../../lib/corpus/manifest";
import {
  createMemoryDemoDataStore,
  createMemoryPrivateObjectStorage,
} from "../../lib/storage/service";
import { runDemoSeed } from "../../scripts/seed-demo";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

async function loadSeedModule(): Promise<Record<string, unknown>> {
  const modulePath = pathToFileURL(
    path.join(workspaceRoot, "scripts/seed-belief-reversal-demo.ts"),
  ).href;
  const loaded = await import(modulePath).catch(() => null);
  assert.ok(
    loaded,
    "Task 6 requires a separately versioned belief-reversal seed module",
  );
  return loaded as Record<string, unknown>;
}

test("belief-reversal seed coexists with the fixed corpus and is exactly idempotent", async () => {
  const seedModule = await loadSeedModule();
  assert.equal(typeof seedModule.runBeliefReversalDemoSeed, "function");
  const runBeliefReversalDemoSeed = seedModule.runBeliefReversalDemoSeed as (
    dependencies: Record<string, unknown>,
  ) => Promise<{ created: Record<string, number> }>;

  const dataStore = createMemoryDemoDataStore();
  const objectStorage = createMemoryPrivateObjectStorage();
  const sourceRegistry = createMemorySourceRegistry();
  const dealRegistry = createMemoryDealRegistry({ sourceRegistry });
  const evidencePacks = createMemoryEvidencePacksRepository();
  const originalDependencies = {
    dataStore,
    objectStorage,
    sourceRegistry,
    dealRegistry,
    corpusDirectory: path.join(workspaceRoot, "seed", "corpus"),
  };
  await runDemoSeed(originalDependencies);
  const originalDealIds = (await dealRegistry.listForWorkspace("workspace_demo"))
    .map((deal) => deal.id)
    .sort();
  assert.equal((await getProductInputReadiness(dataStore, "workspace_demo")).confirmedCount, 0);

  const dependencies = {
    dataStore,
    objectStorage,
    sourceRegistry,
    dealRegistry,
    evidencePacks,
  };
  const first = await runBeliefReversalDemoSeed(dependencies);
  const second = await runBeliefReversalDemoSeed(dependencies);
  assert.deepEqual(first.created, {
    privateObjects: 41,
    documents: 41,
    workspaceDocuments: 41,
    companies: 4,
    deals: 4,
    sourceRevisions: 41,
    assignments: 41,
    canonicalEvidence: 37,
    sampleInteractions: 4,
  });
  assert.deepEqual(second.created, {
    privateObjects: 0,
    documents: 0,
    workspaceDocuments: 0,
    companies: 0,
    deals: 0,
    sourceRevisions: 0,
    assignments: 0,
    canonicalEvidence: 0,
    sampleInteractions: 0,
  });

  const snapshot = dataStore.inspect();
  assert.equal(listPreloadedDocuments().length, 14);
  assert.equal(snapshot.documents.length, 55);
  assert.equal(snapshot.workspaceDocuments.length, 41);
  assert.equal(snapshot.companies.length, 23);
  assert.equal(snapshot.deals.length, 23);
  assert.equal(sourceRegistry.inspect().revisions.length, 55);
  assert.equal(dealRegistry.inspect().assignments.length, 60);
  assert.equal(evidencePacks.inspect().sourceEvidence.length, 37);
  const semanticFields = evidencePacks.inspect().sourceEvidence.flatMap(
    (item) => (item as unknown as {
      semanticFields?: Array<Record<string, unknown>>;
    }).semanticFields ?? [],
  );
  for (const field of semanticFields) {
    assert.match(String(field.id), /^semantic-field-[a-f0-9]{24}$/);
    assert.equal(field.schemaVersion, "deal-semantic-field-v1");
  }
  for (const fieldId of [
    "company_identity",
    "stage",
    "business_model",
    "geography",
    "security_type",
    "reported_valuation",
    "reported_valuation_basis",
    "arr",
    "customer_evidence",
    "cash",
    "burn",
    "runway",
  ]) {
    assert.ok(
      semanticFields.some((field) => field.fieldId === fieldId),
      `typed semantic projection must include ${fieldId}`,
    );
  }
  assert.ok(semanticFields.some((field) =>
    field.fieldId === "security_type"
    && field.classification === "assumption"
    && field.value === "preferred"
    && field.basis === "assumption"
    && field.requiresConfirmation === true
    && field.assumptionPolicyVersion === "belief-reversal-demo-context-v1"
    && !("sourceIds" in field)
    && typeof field.rationale === "string"
    && typeof field.sourceBoundary === "string"
  ));
  assert.ok(semanticFields.some((field) =>
    field.fieldId === "reported_valuation"
    && field.availability === "unavailable"
    && field.classification === "unavailable"
  ));
  assert.equal(snapshot.evidence.length, DEMO_DEAL_EVIDENCE.length);
  assert.equal(snapshot.fixtures.length, DEMO_FIXTURES.length + 4);
  assert.deepEqual(
    originalDealIds,
    (await dealRegistry.listForWorkspace("workspace_demo"))
      .map((deal) => deal.id)
      .filter((dealId) => originalDealIds.includes(dealId))
      .sort(),
  );
  assert.deepEqual(
    snapshot.fixtures.slice(-4).map((fixture) => ({
      id: fixture.id,
      provenance: fixture.provenance,
      label: fixture.label,
      status: fixture.status,
      priorActions: fixture.priorActions,
      actionPolicyVersion: fixture.actionPolicyVersion,
    })),
    [
      ["fixture_henry_passed_v1", "passed", "deprioritize"],
      ["fixture_smallest_watchlist_v1", "watchlist", "continue_monitoring"],
      ["fixture_hush_invested_v1", "invested", "continue_monitoring"],
      ["fixture_irregular_invested_v1", "invested", "evaluate_follow_on"],
    ].map(([id, status, priorAction]) => ({
      id,
      provenance: "demo_fixture",
      label: "Sample decision record",
      status,
      priorActions: [priorAction],
      actionPolicyVersion: "belief-action-policy-v1",
    })),
  );
  const qualifiedOnly = [
    "Centralize",
    "ChipAgents",
    "Sent",
    "Cascade",
    "Cordant",
    "Empirical Security",
    "Freight Hero",
  ];
  assert.ok(snapshot.deals.every((deal) => !qualifiedOnly.includes(deal.companyName)));
  assert.equal((await getProductInputReadiness(dataStore, "workspace_demo")).confirmedCount, 0);

  const productInputs = listPreloadedDocuments()
    .filter((document) => document.role !== "reference");
  for (const document of productInputs.slice(0, 12)) {
    await dataStore.ensureWorkspaceDocument({
      workspaceId: "workspace_demo",
      documentId: document.id,
    });
  }
  assert.deepEqual(
    await getProductInputReadiness(dataStore, "workspace_demo"),
    {
      ready: false,
      confirmedCount: 12,
      requiredCount: 13,
      missingDocumentIds: [productInputs[12]!.id],
    },
  );
  await dataStore.ensureWorkspaceDocument({
    workspaceId: "workspace_demo",
    documentId: productInputs[12]!.id,
  });
  assert.equal((await getProductInputReadiness(dataStore, "workspace_demo")).confirmedCount, 13);

  const bundles = await dealRegistry.listAnalysisEligibleBundles("workspace_demo");
  const reversalBundles = bundles.filter((bundle) =>
    bundle.dealId.endsWith("_v1")
  );
  assert.equal(reversalBundles.length, 4);
  assert.equal(reversalBundles.flatMap((bundle) => bundle.facts).length, 37);
  assert.equal(reversalBundles.flatMap((bundle) => bundle.interactions).length, 4);
  assert.ok(reversalBundles.flatMap((bundle) => bundle.interactions).every(
    (interaction) => {
      const source = (interaction as unknown as {
        source?: Record<string, unknown>;
      }).source;
      return source?.documentId === `source_${interaction.id}`
        && source.sourceRevisionId === `source_revision_source_${interaction.id}_1`
        && source.retrievedAt === "2026-08-01T00:00:00.000Z"
        && source.retrievedAtPrecision === "timestamp"
        && Array.isArray(source.entityKeys)
        && source.entityKeys.length === 0
        && (interaction as unknown as { actionPolicyVersion?: string })
          .actionPolicyVersion === "belief-action-policy-v1"
        && (interaction as unknown as { interactionSchemaVersion?: string })
          .interactionSchemaVersion === "sample-decision-interaction-v1"
        && typeof source.contentFingerprint === "string";
    },
  ));
  assert.ok(reversalBundles.flatMap((bundle) => bundle.facts).every((fact) =>
    fact.sources.every((source) =>
      "schemaVersion" in source && source.schemaVersion === "source-ref-v2"
    )
  ));
});

test("default belief-reversal seed rejects unsafe targets before constructing dependencies", async () => {
  const seedModule = await loadSeedModule();
  assert.equal(
    typeof seedModule.runDefaultBeliefReversalDemoSeed,
    "function",
  );
  const runDefaultBeliefReversalDemoSeed =
    seedModule.runDefaultBeliefReversalDemoSeed as (input: {
      environment: Record<string, string | undefined>;
      createDependencies: () => Record<string, unknown>;
    }) => Promise<unknown>;
  const unsafeEnvironments = [
    {
      NODE_ENV: "production",
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_SERVICE_ROLE_KEY: "local-key",
    },
    {
      NODE_ENV: "development",
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "remote-key",
    },
    {
      NODE_ENV: "development",
      SUPABASE_URL: "not a URL",
      SUPABASE_SERVICE_ROLE_KEY: "key",
    },
    {
      NODE_ENV: "development",
      SUPABASE_URL: "http://localhost:54321",
      SUPABASE_SERVICE_ROLE_KEY: undefined,
    },
  ];
  for (const environment of unsafeEnvironments) {
    let constructed = 0;
    await assert.rejects(
      runDefaultBeliefReversalDemoSeed({
        environment,
        createDependencies: () => {
          constructed += 1;
          return {};
        },
      }),
      /production|loopback|url|credentials|local/i,
    );
    assert.equal(constructed, 0);
  }
});
