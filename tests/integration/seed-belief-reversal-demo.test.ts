import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createMemoryDealRegistry } from "../../db/repositories/deal-registry";
import { createMemoryEvidencePacksRepository } from "../../db/repositories/evidence-packs";
import { createMemorySourceRegistry } from "../../db/repositories/source-registry";
import { createMemoryMarketEvidenceSnapshotsRepository } from "../../db/repositories/market-evidence-snapshots";
import { createMemoryUnderwritingArtifactsRepository } from "../../db/repositories/underwriting-artifacts";
import { createMemoryUnderwritingReferencesRepository } from "../../db/repositories/underwriting-references";
import { getProductInputReadiness } from "../../lib/corpus/import-readiness";
import { DEMO_DEAL_EVIDENCE } from "../../lib/corpus/evidence";
import { DEMO_FIXTURES } from "../../lib/corpus/fixtures";
import { listPreloadedDocuments } from "../../lib/corpus/manifest";
import {
  createMemoryDemoDataStore,
  createMemoryPrivateObjectStorage,
} from "../../lib/storage/service";
import { runDemoSeed } from "../../scripts/seed-demo";
import {
  projectUnderwritingEvidence,
} from "../../lib/underwriting/evidence/semantic-projector";
import { createEvidencePackBuilder } from "../../lib/underwriting/evidence/builder";
import { createEvidencePackCandidateGrounding } from "../../lib/underwriting/candidate-grounding";
import { createContextRouter } from "../../lib/underwriting/router";
import { createFrameworkLensService } from "../../lib/underwriting/frameworks/service";
import { createSourceGroundedCandidateExecutor } from "../../lib/underwriting/orchestrator";
import { createReferenceCatalogSnapshot } from "../../lib/underwriting/fingerprints";
import { actionsForDealStatusAndDirection } from "../../lib/reports/action-policy";
import type { CompanyAnalysis } from "../../lib/contracts/domain";
import type {
  ActionDraftV2,
  CandidateRun,
  FundPolicySnapshot,
} from "../../lib/contracts/underwriting";
import type { CandidateStageRuntime } from "../../lib/underwriting/candidate-stage-runtime";

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
  const marketEvidenceSnapshots = createMemoryMarketEvidenceSnapshotsRepository();
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
    marketEvidenceSnapshots,
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
  const irregularProjection = projectUnderwritingEvidence(
    evidencePacks.inspect().sourceEvidence.filter(({ dealId }) =>
      dealId === "deal_irregular_v1"
    ),
  );
  assert.deepEqual(irregularProjection.contextValues.filter(({ fieldId }) =>
    ["stage", "business_model", "geography"].includes(fieldId)
  ).map(({ fieldId, value }) => ({ fieldId, value }))
    .sort((left, right) => left.fieldId.localeCompare(right.fieldId)), [{
    fieldId: "business_model",
    value: "enterprise_ai",
  }, {
    fieldId: "geography",
    value: "unavailable",
  }, {
    fieldId: "stage",
    value: "series_a",
  }].sort((left, right) => left.fieldId.localeCompare(right.fieldId)));
  assert.ok(irregularProjection.facts.some(({ field, value }) =>
    field === "stage" && value === "Seed and Series A"
  ));
  assert.ok(irregularProjection.facts.some(({ field, value }) =>
    field === "business_model"
    && value === "Frontier AI security evaluation and research."
  ));
  assert.equal(
    irregularProjection.facts.some(({ field }) => field === "geography"),
    false,
  );
  assert.ok(irregularProjection.assumptions.some(({ field, value, rationale }) =>
    field === "security_type"
    && value === "preferred"
    && rationale.startsWith("belief-reversal-demo-context-v1:")
  ));
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

test("actual Irregular seed evidence reaches one finalized core-only terminal artifact set", async () => {
  const seedModule = await loadSeedModule();
  const runBeliefReversalDemoSeed = seedModule.runBeliefReversalDemoSeed as (
    dependencies: Record<string, unknown>,
  ) => Promise<unknown>;
  const now = () => new Date("2026-08-01T00:00:00.000Z");
  const dataStore = createMemoryDemoDataStore();
  const objectStorage = createMemoryPrivateObjectStorage();
  const sourceRegistry = createMemorySourceRegistry();
  const dealRegistry = createMemoryDealRegistry({ sourceRegistry });
  const evidencePacks = createMemoryEvidencePacksRepository();
  const marketEvidenceSnapshots = createMemoryMarketEvidenceSnapshotsRepository();
  await runBeliefReversalDemoSeed({
    dataStore,
    objectStorage,
    sourceRegistry,
    dealRegistry,
    evidencePacks,
    marketEvidenceSnapshots,
  });

  const deal = (await dealRegistry.listForWorkspace("workspace_demo"))
    .find(({ id }) => id === "deal_irregular_v1");
  assert.ok(deal);
  assert.equal(deal.status, "invested");
  const references = createMemoryUnderwritingReferencesRepository({ now });
  const profileId = "critical_evidence_series_a_enterprise_ai_v1";
  const criticalEvidenceProfile = await references.getCriticalEvidenceProfile(
    profileId,
  );
  assert.ok(criticalEvidenceProfile);
  const fundPolicy = await references.activeFundPolicy(deal.workspaceId);
  const router = createContextRouter();
  const grounding = createEvidencePackCandidateGrounding({
    repository: evidencePacks,
    sourceRegistry,
    builder: createEvidencePackBuilder({
      repository: evidencePacks,
      sourceRegistry,
      router,
      criticalEvidenceProfiles: [criticalEvidenceProfile],
      now,
    }),
    criticalEvidenceProfiles: [criticalEvidenceProfile],
    resolveBenchmark: async () => null,
  });
  let providerCalls = 0;
  const frameworkLenses = createFrameworkLensService({
    client: {
      async complete() {
        providerCalls += 1;
        throw new Error("Core-only Irregular analysis must abstain before provider execution.");
      },
    },
    execution: {
      provider: "anthropic",
      model: "synthetic-irregular-test",
      promptVersion: "framework-lens-v1",
      schemaVersion: "framework-judgment-v1",
      settingsFingerprint: `sha256:${"7".repeat(64)}`,
      applicationCommit: "task-9-integration",
    },
  });
  const executor = createSourceGroundedCandidateExecutor({
    grounding,
    router,
    frameworkLenses,
    execution: {
      providerModel: "synthetic-irregular-test",
      promptVersion: "framework-lens-v1",
      schemaVersion: "framework-judgment-v1",
      settingsFingerprint: `sha256:${"7".repeat(64)}`,
      applicationCommit: "task-9-integration",
    },
    now,
  });
  const candidate: CandidateRun = {
    id: "candidate_irregular_v1",
    batchId: "batch_irregular_v1",
    workspaceId: deal.workspaceId,
    dealId: deal.id,
    status: "running",
    candidateAnalysisFingerprint: "pending",
    rerunOfId: null,
    createdAt: now().toISOString(),
    finalizedAt: null,
  };
  const canonicalActions = actionsForDealStatusAndDirection(
    "invested",
    "negative",
  );
  const analysis = {
    dealId: deal.id,
    companyName: deal.companyName,
    dealStatus: "invested",
    beliefAssessment: {
      dealStatus: "invested",
      direction: "negative",
      actions: canonicalActions,
    },
    investmentMemory: { memoryIds: [] },
    sources: [],
    createdAt: now().toISOString(),
  } as unknown as CompanyAnalysis;
  const groundedSnapshot = await grounding.load({
    candidate,
    analysis,
    deal,
    signal: new AbortController().signal,
  });
  assert.ok(groundedSnapshot.identityEvidence.stage.some(({ value, basis }) =>
    value === "series_a" && basis === "derived"
  ));
  assert.ok(groundedSnapshot.identityEvidence.businessModel.some(
    ({ value, basis }) => value === "enterprise_ai" && basis === "derived",
  ));
  assert.ok(groundedSnapshot.identityEvidence.securityType.some(
    ({ value, basis }) => value === "preferred" && basis === "assumption",
  ));
  const referenceCatalog = createReferenceCatalogSnapshot([
    {
      kind: "critical_evidence_profile",
      id: criticalEvidenceProfile.id,
      version: criticalEvidenceProfile.version,
      definitionFingerprint: criticalEvidenceProfile.definitionFingerprint,
    },
    {
      kind: "valuation_method_policy",
      id: "valuation_method_series_a_enterprise_ai_v1",
      version: "1",
      definitionFingerprint: `sha256:${"8".repeat(64)}`,
    },
    {
      kind: "decision_policy",
      id: "decision_policy_series_a_enterprise_ai_v1",
      version: "1",
      definitionFingerprint: `sha256:${"9".repeat(64)}`,
    },
    {
      kind: "framework_pack",
      id: "framework_pack_synthetic_universal_saas_ai_v1",
      version: "1",
      definitionFingerprint: `sha256:${"a".repeat(64)}`,
    },
  ]);
  const stageController = new AbortController();
  const stages: CandidateStageRuntime = {
    async run(input) {
      return input.parseOutput(await input.operation(stageController.signal));
    },
    async runProviderAttempt(input) {
      return input.operation();
    },
    usage() {
      return {
        costUnits: 0,
        tokenUnits: 0,
        actualTokenUnits: 0,
        remainingCostUnits: 100,
        remainingTokenUnits: 100_000,
      };
    },
  };
  const payload = await executor({
    candidate,
    analysis,
    deal,
    fundPolicy: fundPolicy as FundPolicySnapshot,
    batchInputFingerprint: `sha256:${"b".repeat(64)}`,
    referenceCatalog,
    workerId: "worker_irregular_v1",
    leaseToken: "lease_irregular_v1",
    budget: {
      maxCostUnits: 100,
      maxTokenUnits: 100_000,
      maxConcurrency: 1,
      stages: {} as never,
    },
    stages,
    signal: stageController.signal,
  });
  assert.ok(!("kind" in payload));
  assert.equal(payload.context.analysisMode, "core_only");
  assert.equal(payload.context.geography, "unavailable");
  assert.equal(payload.context.benchmarkPackId, null);
  assert.equal(payload.context.benchmarkCompatibility, "unavailable");
  assert.equal(payload.valuation.status, "unavailable");
  assert.deepEqual(payload.valuation.scenarios.map(({ name, valuation }) => ({
    name,
    valuation,
  })), [
    { name: "bear", valuation: null },
    { name: "base", valuation: null },
    { name: "bull", valuation: null },
  ]);
  assert.equal(payload.scenarioModel.scenarios.length, 3);
  assert.ok(payload.scenarioModel.scenarios.every(({ inputs }) =>
    inputs.length === 17
  ));
  assert.equal(payload.calculations.length, 0);
  assert.equal(payload.judgments.length, 8);
  assert.ok(payload.judgments.every(({ applicability, conclusion }) =>
    applicability === "unavailable" && conclusion === "abstain"
  ));
  assert.equal(payload.disagreements.length, 0);
  assert.equal(providerCalls, 0);
  assert.equal(payload.decision.decision, null);
  assert.equal(payload.decision.decisionCeiling, null);
  assert.equal(payload.decision.confidence, "low");
  const statusSafeDrafts = payload.actionDrafts.filter(
    (draft): draft is ActionDraftV2 => "format" in draft,
  );
  assert.equal(statusSafeDrafts.length, payload.actionDrafts.length);
  assert.deepEqual(statusSafeDrafts.map(({ format }) => format), [
    "internal_memo",
  ]);
  assert.ok(statusSafeDrafts.every(({ dealStatus, beliefDirection, actions }) =>
    dealStatus === "invested"
    && beliefDirection === "negative"
    && JSON.stringify(actions) === JSON.stringify(canonicalActions)
  ));

  const artifacts = createMemoryUnderwritingArtifactsRepository({ now });
  const currentFinalization = {
    ...payload,
    workerId: "worker_irregular_v1",
    leaseToken: "lease_irregular_v1",
    candidateRunId: candidate.id,
  };
  const candidateIdentity = {
    id: candidate.id,
    workspaceId: candidate.workspaceId,
    dealId: candidate.dealId,
    fundPolicySnapshotId: fundPolicy.id,
  };
  for (const forgedVersionSnapshot of [
    { ...payload.versionSnapshot, analysisMode: "full" as const },
    { ...payload.versionSnapshot, contextVersion: "forged-context-v0" },
    { ...payload.versionSnapshot, geography: "global" as const },
    {
      ...payload.versionSnapshot,
      benchmarkCompatibility: "adjacent_only" as const,
    },
    { ...payload.versionSnapshot, routerVersion: "context-router-v1" },
    {
      ...payload.versionSnapshot,
      canonicalActions: actionsForDealStatusAndDirection(
        "invested",
        "mixed",
      ),
    },
  ]) {
    assert.throws(() => artifacts.prepareFinalization({
      candidate: candidateIdentity,
      finalization: {
        ...currentFinalization,
        versionSnapshot: forgedVersionSnapshot,
      },
    }), /complete belief, policy, and context identity|status-safe action drafts|current status-safe artifact contract/i);
  }
  assert.throws(() => artifacts.prepareFinalization({
    candidate: candidateIdentity,
    finalization: { ...currentFinalization, actionDrafts: [] },
  }), /complete belief, policy, and context identity|status-safe action drafts|current status-safe artifact contract/i);
  assert.throws(() => artifacts.prepareFinalization({
    candidate: candidateIdentity,
    finalization: {
      ...currentFinalization,
      actionDrafts: [{
        id: "legacy_irregular_draft",
        workspaceId: candidate.workspaceId,
        candidateRunId: candidate.id,
        channel: "internal_memo",
        audienceType: "internal",
        body: "Legacy internal draft",
        createdAt: now().toISOString(),
        updatedAt: now().toISOString(),
      }],
    },
  }), /complete belief, policy, and context identity|current status-safe artifact contract/i);
  const finalized = artifacts.prepareFinalization({
    candidate: candidateIdentity,
    finalization: currentFinalization,
  });
  artifacts.commitPrepared(finalized);
  const persisted = await artifacts.getByCandidateRunId({
    workspaceId: candidate.workspaceId,
    candidateRunId: candidate.id,
  });
  assert.ok(persisted);
  assert.equal(persisted.context.analysisMode, "core_only");
  assert.equal(persisted.valuation.status, "unavailable");
  assert.equal(persisted.decision.decision, null);
  assert.deepEqual(persisted.actionDrafts, payload.actionDrafts);
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
