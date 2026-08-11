import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { createMemoryDealRegistry } from "../../db/repositories/deal-registry";
import { createMemoryEvidencePacksRepository } from "../../db/repositories/evidence-packs";
import { createMemorySourceRegistry } from "../../db/repositories/source-registry";
import { createMemoryMarketEvidenceSnapshotsRepository } from "../../db/repositories/market-evidence-snapshots";
import { createMemoryXTraceLineageRepository } from "../../db/repositories/xtrace-lineage";
import {
  createExactParentPlanner,
  createExactXTraceParentUnit,
  projectExactXTraceParentV2RetrievalPayload,
} from "../../lib/xtrace/exact-parent-planner";
import {
  createMemoryDemoDataStore,
  createMemoryPrivateObjectStorage,
} from "../../lib/storage/service";
import { runBeliefReversalDemoSeed } from "../../scripts/seed-belief-reversal-demo";
import { runDemoSeed } from "../../scripts/seed-demo";

const workspaceRoot = path.resolve(import.meta.dirname, "../..");

test("plans the current fixture as 30 Deals and 85 exact immutable parents", async () => {
  const dataStore = createMemoryDemoDataStore();
  const objectStorage = createMemoryPrivateObjectStorage();
  const sourceRegistry = createMemorySourceRegistry();
  const dealRegistry = createMemoryDealRegistry({ sourceRegistry });
  await runDemoSeed({
    dataStore,
    objectStorage,
    sourceRegistry,
    dealRegistry,
    corpusDirectory: path.join(workspaceRoot, "seed", "corpus"),
  });
  await runBeliefReversalDemoSeed({
    dataStore,
    objectStorage,
    sourceRegistry,
    dealRegistry,
    evidencePacks: createMemoryEvidencePacksRepository(),
    marketEvidenceSnapshots: createMemoryMarketEvidenceSnapshotsRepository(),
  });

  const plan = await createExactParentPlanner({
    dealRegistry,
    sourceRegistry,
  }).plan("workspace_demo");

  assert.equal(new Set(plan.map((unit) => unit.dealId)).size, 30);
  assert.equal(plan.length, 85);
  assert.deepEqual(
    plan.reduce<Record<string, number>>((counts, unit) => {
      counts[unit.parentKind] = (counts[unit.parentKind] ?? 0) + 1;
      return counts;
    }, {}),
    {
      legacy_source_revision: 19,
      canonical_source_revision: 55,
      sample_decision_record: 4,
      sample_research_screening_record: 7,
    },
  );
  assert.ok(plan.every((unit) =>
    unit.workspaceId === "workspace_demo"
    && unit.sourceId.length > 0
    && unit.sourceRevisionId.length > 0
    && /^sha256:[0-9a-f]{64}$/.test(unit.parentFingerprint)
    && /^sha256:[0-9a-f]{64}$/.test(unit.payloadFingerprint)
    && unit.bundle.facts.length + unit.bundle.interactions.length > 0
  ));
});

test("each Sample research screening parent is a labeled non-interaction fact", async () => {
  const sourceRegistry = createMemorySourceRegistry();
  const dealRegistry = createMemoryDealRegistry({ sourceRegistry });
  await runBeliefReversalDemoSeed({
    dataStore: createMemoryDemoDataStore(),
    objectStorage: createMemoryPrivateObjectStorage(),
    sourceRegistry,
    dealRegistry,
    evidencePacks: createMemoryEvidencePacksRepository(),
    marketEvidenceSnapshots: createMemoryMarketEvidenceSnapshotsRepository(),
  });

  const plan = await createExactParentPlanner({ dealRegistry, sourceRegistry })
    .plan("workspace_demo");
  const samples = plan.filter((unit) =>
    unit.parentKind === "sample_research_screening_record"
  );

  assert.equal(samples.length, 7);
  for (const sample of samples) {
    assert.equal(sample.bundle.facts.length, 1);
    assert.equal(sample.bundle.interactions.length, 0);
    const source = sample.bundle.facts[0]!.sources[0]!;
    assert.equal(source.title, "Sample research screening record");
    assert.equal(source.provenance, "source_document");
    assert.ok("sourceClass" in source);
    assert.equal(source.sourceClass, "internal_decision_record");
    assert.equal(source.evidenceRole, "context");
    assert.match(sample.bundle.facts[0]!.text, /^Sample research screening record\./u);
    assert.match(
      sample.bundle.facts[0]!.text,
      /no meeting or VC interaction occurred/iu,
    );
  }
});

test("each planned Sample parent preserves its permanent marker and typed policy inputs", async () => {
  const sourceRegistry = createMemorySourceRegistry();
  const dealRegistry = createMemoryDealRegistry({ sourceRegistry });
  await runBeliefReversalDemoSeed({
    dataStore: createMemoryDemoDataStore(),
    objectStorage: createMemoryPrivateObjectStorage(),
    sourceRegistry,
    dealRegistry,
    evidencePacks: createMemoryEvidencePacksRepository(),
    marketEvidenceSnapshots: createMemoryMarketEvidenceSnapshotsRepository(),
  });

  const plan = await createExactParentPlanner({ dealRegistry, sourceRegistry })
    .plan("workspace_demo");
  const samples = plan.filter((unit) =>
    unit.parentKind === "sample_decision_record"
  );
  const legacyPostgresV2PayloadFingerprints = new Map([
    [
      "deal_henry_ai_v1",
      "sha256:1a261504a8a85dcc5be75ab26266e2086a2a1fd4f58ab36d395584228249832b",
    ],
    [
      "deal_hush_security_v1",
      "sha256:e12ef059ea8658975642c70aaf9637b5cf7e1bcb9456828a55e3d459fb87355d",
    ],
    [
      "deal_irregular_v1",
      "sha256:f0586abacca2a40ab9fe2a5fe5d83d0b645862c2c8e2f60055bac4c460fb50a7",
    ],
    [
      "deal_smallest_ai_v1",
      "sha256:f9226e83215bc3df6541f38e4a3beb317a191080eaf9b50e57ddd7a81313b863",
    ],
  ]);

  assert.equal(samples.length, 4);
  for (const sample of samples) {
    assert.equal(
      sample.payloadFingerprint,
      legacyPostgresV2PayloadFingerprints.get(sample.dealId),
      `${sample.dealId} must preserve the reviewed PostgreSQL xtrace-parent-v2 payload identity`,
    );
    const v2RetrievalPayload =
      projectExactXTraceParentV2RetrievalPayload(sample);
    assert.equal(v2RetrievalPayload.facts.length, 0);
    assert.deepEqual(v2RetrievalPayload.interactions, sample.bundle.interactions);
    assert.equal(sample.bundle.facts.length, 1);
    assert.equal(sample.bundle.interactions.length, 1);
    const fact = sample.bundle.facts[0]!;
    const factSource = fact.sources[0]!;
    assert.match(fact.text, /^Sample decision record\. /u);
    assert.equal(fact.sources.length, 1);
    assert.equal(factSource.provenance, "demo_fixture");
    assert.equal(factSource.title, "Sample decision record");
    assert.equal(factSource.documentId, sample.sourceId);
    assert.equal(factSource.sourceRevisionId, sample.sourceRevisionId);
    const interaction = sample.bundle.interactions[0];
    assert.equal(interaction.provenance, "demo_fixture");
    assert.equal(interaction.label, "Sample decision record");
    assert.equal(interaction.actionPolicyVersion, "belief-action-policy-v1");
    assert.equal(
      interaction.interactionSchemaVersion,
      "sample-decision-interaction-v1",
    );
    assert.ok(interaction.priorActions && interaction.priorActions.length > 0);
    assert.equal("expectedOutcome" in interaction, false);
    assert.equal(JSON.stringify(sample).includes("expectedOutcome"), false);

    const legacyPersistedParent = createExactXTraceParentUnit({
      ...sample,
      bundle: {
        ...sample.bundle,
        facts: [],
      },
    }, {
      workspaceId: sample.workspaceId,
      sourceId: sample.sourceId,
      contentHash: sample.parentFingerprint,
    });
    assert.equal(legacyPersistedParent.parentKind, "sample_decision_record");
    assert.equal(legacyPersistedParent.bundle.facts.length, 0);
    assert.equal(
      legacyPersistedParent.payloadFingerprint,
      sample.payloadFingerprint,
      "The read adapter must preserve the reviewed legacy wire identity.",
    );
    assert.deepEqual(
      projectExactXTraceParentV2RetrievalPayload(legacyPersistedParent),
      v2RetrievalPayload,
    );
    assert.throws(
      () => createExactXTraceParentUnit({
        ...sample,
        bundle: {
          ...sample.bundle,
          facts: [],
          interactions: [{
            ...interaction,
            source: {
              ...interaction.source!,
              title: "Unlabeled internal note",
            },
          }],
        },
      }, {
        workspaceId: sample.workspaceId,
        sourceId: sample.sourceId,
        contentHash: sample.parentFingerprint,
      }),
      /permanent typed marker/iu,
    );

    assert.throws(
      () => createExactXTraceParentUnit({
        ...sample,
        bundle: {
          ...sample.bundle,
          facts: [fact, structuredClone(fact)],
        },
      }, {
        workspaceId: sample.workspaceId,
        sourceId: sample.sourceId,
        contentHash: sample.parentFingerprint,
      }),
      /exactly one interaction and at most one non-gating context bridge/iu,
    );
    assert.throws(
      () => createExactXTraceParentUnit({
        ...sample,
        bundle: {
          ...sample.bundle,
          interactions: [interaction, structuredClone(interaction)],
        },
      }, {
        workspaceId: sample.workspaceId,
        sourceId: sample.sourceId,
        contentHash: sample.parentFingerprint,
      }),
      /exactly one interaction and at most one non-gating context bridge/iu,
    );
    assert.throws(
      () => createExactXTraceParentUnit({
        ...sample,
        bundle: {
          ...sample.bundle,
          facts: [{
            ...fact,
            sources: [{
              ...factSource,
              provenance: "public_web",
              title: "Public market source",
              canonicalUrl: "https://example.com/public-market-source",
            }],
          }],
        },
      }, {
        workspaceId: sample.workspaceId,
        sourceId: sample.sourceId,
        contentHash: sample.parentFingerprint,
      }),
      /permanent typed marker/iu,
    );
    assert.throws(
      () => createExactXTraceParentUnit({
        ...sample,
        bundle: {
          ...sample.bundle,
          facts: [{
            ...fact,
            sources: [{
              ...factSource,
              documentId: "source_foreign",
            }],
          }],
        },
      }, {
        workspaceId: sample.workspaceId,
        sourceId: sample.sourceId,
        contentHash: sample.parentFingerprint,
      }),
      /crossed its exact source parent/iu,
    );

    const lineage = createMemoryXTraceLineageRepository();
    const legacyParent = {
      ...structuredClone(sample),
      bundle: v2RetrievalPayload,
    };
    const legacy = await lineage.reserveExactIntent({
      parent: legacyParent,
      serializerVersion: "xtrace-parent-v2",
    });
    assert.equal(legacy.action, "submit");
    await lineage.attachExactJob({
      intentId: legacy.intent.intentId,
      leaseToken: legacy.intent.leaseToken!,
      providerJobId: `legacy_job_${sample.dealId}`,
    });
    await lineage.advanceExactIntent({
      intentId: legacy.intent.intentId,
      providerJobId: `legacy_job_${sample.dealId}`,
      state: "succeeded",
      memoryIds: [`legacy_memory_${sample.dealId}`],
    });
    const upgraded = await lineage.reserveExactIntent({
      parent: sample,
      serializerVersion: "xtrace-parent-v2",
    });
    assert.equal(upgraded.action, "reuse");
    assert.equal(upgraded.intent.intentId, legacy.intent.intentId);
  }
});
