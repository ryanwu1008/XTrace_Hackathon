import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { createMemoryDealRegistry } from "../../db/repositories/deal-registry";
import { createMemoryEvidencePacksRepository } from "../../db/repositories/evidence-packs";
import { createMemorySourceRegistry } from "../../db/repositories/source-registry";
import {
  createExactParentPlanner,
} from "../../lib/xtrace/exact-parent-planner";
import {
  createMemoryDemoDataStore,
  createMemoryPrivateObjectStorage,
} from "../../lib/storage/service";
import { runBeliefReversalDemoSeed } from "../../scripts/seed-belief-reversal-demo";
import { runDemoSeed } from "../../scripts/seed-demo";

const workspaceRoot = path.resolve(import.meta.dirname, "../..");

test("plans the accepted fixture as 23 Deals and 60 exact immutable parents", async () => {
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
  });

  const plan = await createExactParentPlanner({
    dealRegistry,
    sourceRegistry,
  }).plan("workspace_demo");

  assert.equal(new Set(plan.map((unit) => unit.dealId)).size, 23);
  assert.equal(plan.length, 60);
  assert.deepEqual(
    plan.reduce<Record<string, number>>((counts, unit) => {
      counts[unit.parentKind] = (counts[unit.parentKind] ?? 0) + 1;
      return counts;
    }, {}),
    {
      legacy_source_revision: 19,
      canonical_source_revision: 37,
      sample_decision_record: 4,
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

test("each planned Sample parent preserves its permanent marker and typed policy inputs", async () => {
  const sourceRegistry = createMemorySourceRegistry();
  const dealRegistry = createMemoryDealRegistry({ sourceRegistry });
  await runBeliefReversalDemoSeed({
    dataStore: createMemoryDemoDataStore(),
    objectStorage: createMemoryPrivateObjectStorage(),
    sourceRegistry,
    dealRegistry,
    evidencePacks: createMemoryEvidencePacksRepository(),
  });

  const plan = await createExactParentPlanner({ dealRegistry, sourceRegistry })
    .plan("workspace_demo");
  const samples = plan.filter((unit) =>
    unit.parentKind === "sample_decision_record"
  );

  assert.equal(samples.length, 4);
  for (const sample of samples) {
    assert.equal(sample.bundle.facts.length, 0);
    assert.equal(sample.bundle.interactions.length, 1);
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
  }
});
