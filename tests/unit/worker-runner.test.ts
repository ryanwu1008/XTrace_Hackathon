import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as workerRunner from "../../worker/runner";
import { createMemoryEvidencePacksRepository } from
  "../../db/repositories/evidence-packs";
import { createCanonicalFingerprint } from
  "../../lib/underwriting/fingerprints";

test("worker application identity is explicit and never a shared development placeholder", () => {
  const resolveApplicationCommit = (
    workerRunner as typeof workerRunner & {
      resolveWorkerApplicationCommit?: (
        environment: Record<string, string | undefined>,
      ) => string;
    }
  ).resolveWorkerApplicationCommit;
  assert.equal(typeof resolveApplicationCommit, "function");
  assert.throws(
    () => resolveApplicationCommit!({}),
    /APPLICATION_COMMIT|commit identity/i,
  );
  assert.throws(
    () => resolveApplicationCommit!({ APPLICATION_COMMIT: "local-development" }),
    /placeholder|commit identity/i,
  );
  assert.equal(
    resolveApplicationCommit!({ APPLICATION_COMMIT: "fixture:task-7" }),
    "fixture:task-7",
  );
  assert.equal(
    resolveApplicationCommit!({ RAILWAY_GIT_COMMIT_SHA: "railway-commit" }),
    "railway-commit",
  );
  assert.equal(
    resolveApplicationCommit!({
      APPLICATION_COMMIT: "explicit-commit",
      RAILWAY_GIT_COMMIT_SHA: "railway-commit",
    }),
    "explicit-commit",
  );
});

test("supported Worker launchers inject an explicit application commit", () => {
  const keychainLauncher = readFileSync(
    "scripts/run-worker-from-keychain.zsh",
    "utf8",
  );
  assert.match(
    keychainLauncher,
    /git status --porcelain --untracked-files=all/,
  );
  assert.match(keychainLauncher, /git rev-parse --verify HEAD/);
  assert.match(keychainLauncher, /export APPLICATION_COMMIT=/);
  assert.doesNotMatch(keychainLauncher, /local-development/);

  const workerContainer = readFileSync("Dockerfile.worker", "utf8");
  assert.match(workerContainer, /ARG APPLICATION_COMMIT/);
  assert.match(workerContainer, /APPLICATION_COMMIT=\$\{APPLICATION_COMMIT\}/);
  assert.doesNotMatch(workerContainer, /local-development/);
});

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

test("worker candidate execution identity is one canonical current-contract fingerprint", () => {
  const configuration = {
    providerModel: "claude-test",
    promptVersion: "framework-lens-v1",
    schemaVersion: "framework-judgment-v1",
    settingsFingerprint: "balanced-underwriting-v1",
    applicationCommit: "commit-a",
  };
  const contract = workerRunner.createWorkerCandidateExecutionContract(
    configuration,
  );
  assert.deepEqual(contract.stageDag, [
    "context_router",
    "evidence_pack",
    "valuation",
    "framework_catalog",
    "framework_lenses",
    "decision",
    "named_lens_presentation",
    "narrative_drafts",
    "finalization",
  ]);
  assert.equal(contract.admissionPolicyVersion, "all-belief-revisions-v1");
  assert.equal(
    contract.namedLens.presentationSchemaVersion,
    "decision-first-named-lens-v1",
  );
  assert.equal(contract.namedLens.rendererVersion, "named-lens-renderer-v1");
  assert.deepEqual(contract.namedLens.semanticFingerprintVersions, {
    criticalEvidenceProjection: "decision-critical-evidence-projection-v1",
    finalDispositions: "named-lens-final-dispositions-v1",
    presentation: "named-lens-presentation-v1",
  });
  assert.deepEqual(contract.namedLens.advisoryProviderTimeoutPolicy, {
    version: "named-lens-provider-timeout-v1",
    timeoutMs: 20_000,
  });
  assert.equal(
    contract.refreshSemanticsVersion,
    "refresh-new-canonical-never-alias-v1",
  );
  assert.match(contract.namedLens.decisionTaxonomyDigest, /^sha256:[a-f0-9]{64}$/);
  const baseline = workerRunner.createWorkerCandidateExecutionFingerprint(
    configuration,
  );
  assert.match(baseline, /^sha256:[a-f0-9]{64}$/);
  assert.equal(
    workerRunner.createWorkerCandidateExecutionFingerprint(configuration),
    baseline,
  );
  for (const field of [
    "providerModel",
    "promptVersion",
    "schemaVersion",
    "settingsFingerprint",
    "applicationCommit",
  ] as const) {
    assert.notEqual(
      workerRunner.createWorkerCandidateExecutionFingerprint({
        ...configuration,
        [field]: `${configuration[field]}-changed`,
      }),
      baseline,
      field,
    );
  }
  const staticContractMutations = [{
    ...contract,
    namedLens: {
      ...contract.namedLens,
      rendererVersion: `${contract.namedLens.rendererVersion}-changed`,
    },
  }, {
    ...contract,
    namedLens: {
      ...contract.namedLens,
      semanticFingerprintVersions: {
        ...contract.namedLens.semanticFingerprintVersions,
        criticalEvidenceProjection:
          `${contract.namedLens.semanticFingerprintVersions.criticalEvidenceProjection}-changed`,
      },
    },
  }, {
    ...contract,
    namedLens: {
      ...contract.namedLens,
      semanticFingerprintVersions: {
        ...contract.namedLens.semanticFingerprintVersions,
        finalDispositions:
          `${contract.namedLens.semanticFingerprintVersions.finalDispositions}-changed`,
      },
    },
  }, {
    ...contract,
    namedLens: {
      ...contract.namedLens,
      semanticFingerprintVersions: {
        ...contract.namedLens.semanticFingerprintVersions,
        presentation:
          `${contract.namedLens.semanticFingerprintVersions.presentation}-changed`,
      },
    },
  }, {
    ...contract,
    namedLens: {
      ...contract.namedLens,
      advisoryProviderTimeoutPolicy: {
        ...contract.namedLens.advisoryProviderTimeoutPolicy,
        version: "named-lens-provider-timeout-stale",
      },
    },
  }, {
    ...contract,
    namedLens: {
      ...contract.namedLens,
      advisoryProviderTimeoutPolicy: {
        ...contract.namedLens.advisoryProviderTimeoutPolicy,
        timeoutMs:
          contract.namedLens.advisoryProviderTimeoutPolicy.timeoutMs + 1,
      },
    },
  }, {
    ...contract,
    refreshSemanticsVersion: `${contract.refreshSemanticsVersion}-changed`,
  }];
  for (const mutation of staticContractMutations) {
    assert.notEqual(createCanonicalFingerprint(mutation), baseline);
  }
});

test("worker underwriting composition shares one Named Lens repository with runtime and finalization", async () => {
  const composition = workerRunner.createWorkerUnderwritingPersistence({
    evidencePacks: createMemoryEvidencePacksRepository(),
  });
  assert.ok(composition.underwritingArtifacts);
  const batch = await composition.runs.createOrReuseBatch({
    workspaceId: "workspace_1",
    scanRunId: "scan_1",
    batchInputFingerprint: `sha256:${"a".repeat(64)}`,
    fundPolicySnapshotId: "fund_policy_1",
    forceRefresh: false,
    refreshNonce: null,
    rerunOfId: null,
  });
  await composition.runs.saveSelections({
    batchId: batch.id,
    selections: [{
      dealId: "deal_1",
      status: "selected",
      rank: 1,
      reason: "Worker composition fixture.",
    }],
  });
  const [candidate] = await composition.runs.createSelectedCandidates({
    batchId: batch.id,
    dealIds: ["deal_1"],
  });
  assert.ok(candidate);
  const claimed = await composition.runs.claimCandidate({
    workspaceId: candidate.workspaceId,
    candidateRunId: candidate.id,
    workerId: "worker_1",
    leaseSeconds: 60,
  });
  assert.ok(claimed);
  const identity = {
    workspaceId: claimed.candidate.workspaceId,
    artifactSourceCandidateRunId: claimed.candidate.id,
    judgmentOrCatalogCandidateId: "judgment_1",
    logicalPassageId:
      "judgment_1@named-lens-passage-v1@named-lens-generator-v1",
    attemptNumber: 1,
    attemptFingerprint: `sha256:${"1".repeat(64)}`,
    workerId: "worker_1",
    leaseToken: claimed.leaseToken,
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
      artifactSourceCandidateRunId: claimed.candidate.id,
    }),
    await composition.namedLensArtifacts.listAttempts(
      "workspace_1",
      claimed.candidate.id,
    ),
  );
  assert.equal(
    composition.underwritingArtifacts.inspect().rowCounts
      .namedLensProviderAttemptEvents,
    2,
  );
});
