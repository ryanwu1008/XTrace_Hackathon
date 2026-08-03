import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryDealRegistry } from "../../db/repositories/deal-registry";
import { createMemoryEvidencePacksRepository } from "../../db/repositories/evidence-packs";
import { createMemoryMarketEvidenceSnapshotsRepository } from "../../db/repositories/market-evidence-snapshots";
import { createMemorySourceRegistry } from "../../db/repositories/source-registry";
import { APPROVED_PINNED_DEMO_SNAPSHOT_ID } from "../../lib/contracts/evidence-context";
import {
  createMemoryDemoDataStore,
  createMemoryPrivateObjectStorage,
} from "../../lib/storage/service";
import { runBeliefReversalDemoSeed } from "../../scripts/seed-belief-reversal-demo";

test("the local belief-reversal seed creates the exact immutable four-event snapshot idempotently", async () => {
  const sourceRegistry = createMemorySourceRegistry();
  const snapshots = createMemoryMarketEvidenceSnapshotsRepository({
    now: () => new Date("2026-08-01T23:59:59.999Z"),
  });
  const dependencies = {
    dataStore: createMemoryDemoDataStore(),
    objectStorage: createMemoryPrivateObjectStorage(),
    sourceRegistry,
    dealRegistry: createMemoryDealRegistry({ sourceRegistry }),
    evidencePacks: createMemoryEvidencePacksRepository(),
    marketEvidenceSnapshots: snapshots,
  };

  await runBeliefReversalDemoSeed(dependencies);
  const first = await snapshots.get(
    "workspace_demo",
    APPROVED_PINNED_DEMO_SNAPSHOT_ID,
  );
  assert.ok(first);
  await runBeliefReversalDemoSeed(dependencies);
  const second = await snapshots.get(
    "workspace_demo",
    APPROVED_PINNED_DEMO_SNAPSHOT_ID,
  );
  assert.ok(second);

  assert.equal(first.snapshotFingerprint, second.snapshotFingerprint);
  assert.equal(first.displayLabel, "Demo evidence snapshot as of 2026-08-01");
  assert.deepEqual(first.events.map(({ id }) => id), [
    "event_henry_series_a_v1",
    "event_hush_series_a_v1",
    "event_irregular_incidents_v1",
    "event_smallest_series_a_v1",
  ]);
  assert.ok(first.events.every((event) => event.sources.every((source) =>
    source.adaptation === "canonical"
    && source.text.status === "verified_exact"
    && source.sourceRevisionId === `source_revision_${source.documentId}_1`
  )));
});
