import assert from "node:assert/strict";
import test from "node:test";

import * as workerRunner from "../../worker/runner";
import { createMemoryEvidencePacksRepository } from
  "../../db/repositories/evidence-packs";

test("a transient worker error backs off instead of terminating the loop", async () => {
  let backoffMs = 0;
  let loggedMessage = "";

  assert.equal(
    typeof workerRunner.runWorkerIteration,
    "function",
    "the worker must expose a recoverable loop iteration",
  );

  await workerRunner.runWorkerIteration({
    runNext: async () => {
      throw new TypeError("fetch failed");
    },
    sleepImpl: async (milliseconds) => {
      backoffMs = milliseconds;
    },
    onError: (message) => {
      loggedMessage = message;
    },
  });

  assert.equal(backoffMs, 2_000);
  assert.match(loggedMessage, /fetch failed/);
});

test("the worker rotates successful queue classes so confirmed ingest cannot starve", async () => {
  const calls: string[] = [];
  const fairQueue = (
    workerRunner as typeof workerRunner & {
      runNextFairQueue?: (
        handlers: Array<() => Promise<boolean>>,
      ) => Promise<boolean>;
    }
  ).runNextFairQueue;
  assert.equal(typeof fairQueue, "function");
  const handlers = [
    async () => {
      calls.push("queued");
      return true;
    },
    async () => {
      calls.push("confirmed");
      return true;
    },
    async () => {
      calls.push("scan");
      return true;
    },
  ];

  assert.equal(await fairQueue!(handlers), true);
  assert.equal(await fairQueue!(handlers), true);
  assert.deepEqual(calls, ["queued", "confirmed"]);
});

test("worker underwriting composition shares one Named Lens repository with runtime and finalization", async () => {
  const composition = workerRunner.createWorkerUnderwritingPersistence({
    evidencePacks: createMemoryEvidencePacksRepository(),
  });
  assert.ok(composition.underwritingArtifacts);
  const identity = {
    workspaceId: "workspace_1",
    artifactSourceCandidateRunId: "candidate_1",
    judgmentOrCatalogCandidateId: "judgment_1",
    logicalPassageId:
      "judgment_1@named-lens-passage-v1@named-lens-generator-v1",
    attemptNumber: 1,
    attemptFingerprint: `sha256:${"1".repeat(64)}`,
    workerId: "worker_1",
    leaseToken: "lease_1",
  };
  await composition.namedLensArtifacts.reserveAttempt(identity);
  await composition.namedLensArtifacts.settleAttempt({
    ...identity,
    status: "failed",
    telemetry: null,
    failureReason: {
      code: "provider_error",
      detail: "Deterministic worker composition fixture.",
      retryable: false,
    },
  });
  assert.deepEqual(
    composition.underwritingArtifacts.listNamedLensProviderAttempts({
      workspaceId: "workspace_1",
      artifactSourceCandidateRunId: "candidate_1",
    }),
    await composition.namedLensArtifacts.listAttempts(
      "workspace_1",
      "candidate_1",
    ),
  );
  assert.equal(
    composition.underwritingArtifacts.inspect().rowCounts
      .namedLensProviderAttemptEvents,
    2,
  );
});
