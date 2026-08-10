import assert from "node:assert/strict";
import test from "node:test";

import type { UnderwritingRunsRepository } from "../../db/repositories/underwriting-runs";
import type { CandidateRun } from "../../lib/contracts/underwriting";
import {
  createMemoryNamedLensArtifactsRepository,
  type NamedLensArtifactsRepository,
} from "../../db/repositories/named-lens-artifacts";
import { actionsForDealStatusAndDirection } from "../../lib/reports/action-policy";
import {
  createCandidateStagePolicies,
  createCandidateStageRuntime,
} from "../../lib/underwriting/candidate-stage-runtime";
import { createCanonicalFingerprint } from "../../lib/underwriting/fingerprints";
import {
  parseCandidateGroundingSnapshot,
  parseNarrativeArtifacts,
} from "../../lib/underwriting/stage-replay";

test("context-router replay preserves assumption and semantic availability evidence", () => {
  const snapshot = {
    identityEvidence: {
      asOfDate: "2026-08-01",
      companyIdentity: [{
        value: "company_irregular_v1",
        basis: "confirmed",
        evidenceItemId: "deal-confirmation:deal_irregular_v1",
      }],
      stage: [{
        value: "series_a",
        basis: "source_explicit",
        evidenceItemId: "semantic-stage",
      }],
      businessModel: [{
        value: "enterprise_ai",
        basis: "source_explicit",
        evidenceItemId: "semantic-business-model",
      }],
      geography: [{
        value: "unavailable",
        basis: "semantic_availability",
        evidenceItemId: "semantic-geography-unavailable",
      }],
      securityType: [{
        value: "preferred",
        basis: "assumption",
        evidenceItemId: "semantic-security-assumption",
      }],
    },
    sourceRevisionIds: [],
    sourceRevisionSnapshots: [],
    xtraceLineage: {
      memoryIds: [],
      sourceRevisionIds: [],
      sourceIds: [],
      fixtureIds: [],
      capturedAt: "2026-08-01T12:00:00.000Z",
    },
  };

  assert.deepEqual(parseCandidateGroundingSnapshot(snapshot), snapshot);
});

test("completed legacy narrative checkpoint verifies its raw fingerprint before read adaptation", async () => {
  const stage = "narrative_drafts" as const;
  const inputFingerprint = `sha256:${"1".repeat(64)}`;
  const body = [
    "Subject: Draft evidence follow-up",
    "",
    "DRAFT ONLY — NOT SENT",
    "Please share the following current evidence for review:",
    "- arr",
    "This draft is limited to evidence collection and neutral sharing instructions.",
  ].join("\n");
  const legacyPayload = {
    narrative: "Legacy persisted narrative.",
    actionDrafts: [{
      schemaVersion: "action-draft-v2",
      safety: "status_safe",
      deliveryMode: "draft_only",
      draftPolicyVersion: "status-safe-action-draft-v2",
      actionPolicyVersion: "belief-action-policy-v1",
      id: "draft_legacy_checkpoint",
      workspaceId: "workspace_legacy_checkpoint",
      candidateRunId: "candidate_legacy_checkpoint",
      dealStatus: "passed",
      beliefDirection: "positive",
      actions: actionsForDealStatusAndDirection("passed", "positive"),
      missingEvidence: [{
        fieldId: "arr",
        label: "arr",
        reasonCode: "MISSING_CRITICAL_EVIDENCE",
        mostLikelyDecisionImpact:
          "Providing accepted evidence may raise or lower the formal decision ceiling.",
      }],
      format: "founder_email",
      channel: "email",
      audienceType: "founder",
      body,
      createdAt: "2026-07-29T12:00:00.000Z",
      updatedAt: "2026-07-29T12:00:00.000Z",
    }],
  };
  const checkpoint = {
    candidateRunId: "candidate_legacy_checkpoint",
    stage,
    status: "completed" as const,
    inputFingerprint,
    outputFingerprint: createCanonicalFingerprint({
      stage,
      inputFingerprint,
      result: legacyPayload,
    }),
    outputPayload: legacyPayload,
    attemptCount: 1,
    costUnits: 0,
    tokenUnits: 0,
    actualTokenUnits: 0,
    providerAttempts: [],
    reasonCode: null,
    publicReason: null,
    savedAt: "2026-07-29T12:00:00.000Z",
  };
  const runs = {
    listCheckpoints: async () => [structuredClone(checkpoint)],
    saveCheckpoint: async () => {
      throw new Error("completed checkpoint replay must not save");
    },
  } as unknown as UnderwritingRunsRepository;
  const candidate: CandidateRun = {
    id: "candidate_legacy_checkpoint",
    batchId: "batch_legacy_checkpoint",
    workspaceId: "workspace_legacy_checkpoint",
    dealId: "deal_legacy_checkpoint",
    status: "running",
    candidateAnalysisFingerprint: `sha256:${"2".repeat(64)}`,
    rerunOfId: null,
    createdAt: "2026-07-29T12:00:00.000Z",
    finalizedAt: null,
  };
  const runtime = await createCandidateStageRuntime({
    runs,
    candidate,
    workerId: "worker_legacy_checkpoint",
    leaseToken: "lease_legacy_checkpoint",
    budget: {
      maxCostUnits: 100,
      maxTokenUnits: 100,
      maxConcurrency: 1,
      stages: createCandidateStagePolicies({
        timeoutMs: 1_000,
        retryableAttempts: 1,
      }),
    },
    now: () => new Date("2026-07-29T12:00:00.000Z"),
  });

  const replayed = await runtime.run({
    stage,
    inputFingerprint,
    parseOutput: parseNarrativeArtifacts,
    operation: () => {
      throw new Error("completed checkpoint replay must not execute");
    },
  });

  const replayedDraft = replayed.actionDrafts[0];
  assert.ok(replayedDraft && "schemaVersion" in replayedDraft);
  assert.equal(replayedDraft.body, body);
  assert.equal(
    replayedDraft.missingEvidence[0]?.externalLabel,
    "arr",
  );

  const tamperedCheckpoint = structuredClone(checkpoint);
  const tamperedPayload = tamperedCheckpoint.outputPayload as typeof legacyPayload;
  tamperedPayload.actionDrafts[0]!.body += "\nTampered after fingerprinting.";
  const tamperedRuns = {
    listCheckpoints: async () => [tamperedCheckpoint],
    saveCheckpoint: async () => {
      throw new Error("tampered checkpoint replay must not save");
    },
  } as unknown as UnderwritingRunsRepository;
  const tamperedRuntime = await createCandidateStageRuntime({
    runs: tamperedRuns,
    candidate,
    workerId: "worker_legacy_checkpoint",
    leaseToken: "lease_legacy_checkpoint",
    budget: {
      maxCostUnits: 100,
      maxTokenUnits: 100,
      maxConcurrency: 1,
      stages: createCandidateStagePolicies({
        timeoutMs: 1_000,
        retryableAttempts: 1,
      }),
    },
    now: () => new Date("2026-07-29T12:00:00.000Z"),
  });
  await assert.rejects(
    tamperedRuntime.run({
      stage,
      inputFingerprint,
      parseOutput: parseNarrativeArtifacts,
      operation: () => {
        throw new Error("tampered checkpoint replay must not execute");
      },
    }),
    /fingerprint does not match its payload/u,
  );
});

test("Named Lens provider I/O starts only after durable and checkpoint reservations", async () => {
  const order: string[] = [];
  let checkpoint: Parameters<UnderwritingRunsRepository["saveCheckpoint"]>[0]
    | undefined;
  const runs = {
    listCheckpoints: async () => checkpoint ? [checkpoint] : [],
    saveCheckpoint: async (value: typeof checkpoint) => {
      checkpoint = structuredClone(value);
      if (value?.providerAttempts.at(-1)?.status === "reserved") {
        order.push("checkpoint-reserve");
      }
    },
  } as unknown as UnderwritingRunsRepository;
  const storage = createMemoryNamedLensArtifactsRepository();
  const namedLensArtifacts: NamedLensArtifactsRepository = {
    async reserveAttempt(input) {
      order.push("durable-reserve");
      return storage.reserveAttempt(input);
    },
    async settleAttempt(input) {
      order.push(`durable-${input.status}`);
      return storage.settleAttempt(input);
    },
    listAttempts: storage.listAttempts,
  };
  const candidate: CandidateRun = {
    id: "candidate_named_lens",
    batchId: "batch_named_lens",
    workspaceId: "workspace_named_lens",
    dealId: "deal_named_lens",
    status: "running",
    candidateAnalysisFingerprint: `sha256:${"1".repeat(64)}`,
    rerunOfId: null,
    createdAt: "2026-08-10T12:00:00.000Z",
    finalizedAt: null,
  };
  const runtime = await createCandidateStageRuntime({
    runs,
    namedLensArtifacts,
    candidate,
    workerId: "worker_1",
    leaseToken: "lease_1",
    budget: {
      maxCostUnits: 10,
      maxTokenUnits: 10_000,
      maxConcurrency: 1,
      stages: createCandidateStagePolicies({
        timeoutMs: 1_000,
        retryableAttempts: 1,
      }),
    },
    now: () => new Date("2026-08-10T12:00:00.000Z"),
  } as Parameters<typeof createCandidateStageRuntime>[0] & {
    namedLensArtifacts: NamedLensArtifactsRepository;
  });
  await runtime.run({
    stage: "framework_lenses",
    inputFingerprint: `sha256:${"2".repeat(64)}`,
    parseOutput: (value) => value,
    operation: async () => {
      await (runtime.runProviderAttempt as (input: Record<string, unknown>) =>
        Promise<unknown>)({
        stage: "framework_lenses",
        inputFingerprint: `sha256:${"2".repeat(64)}`,
        attemptFingerprint: `sha256:${"3".repeat(64)}`,
        costUnits: 1,
        tokenUnits: 100,
        namedLensAttempt: {
          judgmentOrCatalogCandidateId: "judgment_1",
          logicalPassageId: "judgment_1@named-lens-passage-v1@named-lens-generator-v1",
          attemptNumber: 1,
        },
        operation: async () => {
          order.push("provider");
          return {
            text: "grounded",
            stopReason: "end_turn",
            usage: {
              inputTokens: 10,
              outputTokens: 5,
              cacheCreationInputTokens: 0,
              cacheReadInputTokens: 0,
            },
          };
        },
      });
      return { ok: true };
    },
  });
  assert.deepEqual(order, [
    "durable-reserve",
    "checkpoint-reserve",
    "provider",
    "durable-completed",
  ]);
  assert.equal(storage.inspect().rawAttemptEvents.length, 2);
});

test("checkpoint reservation failure aborts the durable attempt before provider I/O", async () => {
  const order: string[] = [];
  const storage = createMemoryNamedLensArtifactsRepository();
  const namedLensArtifacts: NamedLensArtifactsRepository = {
    async reserveAttempt(input) {
      order.push("durable-reserve");
      return storage.reserveAttempt(input);
    },
    async settleAttempt(input) {
      order.push(`durable-${input.status}`);
      return storage.settleAttempt(input);
    },
    listAttempts: storage.listAttempts,
  };
  const runs = {
    listCheckpoints: async () => [],
    saveCheckpoint: async (value: { providerAttempts: unknown[] }) => {
      if (value.providerAttempts.length > 0) {
        order.push("checkpoint-rejected");
        throw new Error("simulated checkpoint failure");
      }
    },
  } as unknown as UnderwritingRunsRepository;
  const candidate = {
    id: "candidate_named_lens",
    batchId: "batch_named_lens",
    workspaceId: "workspace_named_lens",
    dealId: "deal_named_lens",
    status: "running",
    candidateAnalysisFingerprint: `sha256:${"1".repeat(64)}`,
    rerunOfId: null,
    createdAt: "2026-08-10T12:00:00.000Z",
    finalizedAt: null,
  } satisfies CandidateRun;
  const runtime = await createCandidateStageRuntime({
    runs,
    namedLensArtifacts,
    candidate,
    workerId: "worker_1",
    leaseToken: "lease_1",
    budget: {
      maxCostUnits: 10,
      maxTokenUnits: 10_000,
      maxConcurrency: 1,
      stages: createCandidateStagePolicies({
        timeoutMs: 1_000,
        retryableAttempts: 1,
      }),
    },
    now: () => new Date("2026-08-10T12:00:00.000Z"),
  } as Parameters<typeof createCandidateStageRuntime>[0] & {
    namedLensArtifacts: NamedLensArtifactsRepository;
  });
  await assert.rejects(runtime.run({
    stage: "framework_lenses",
    inputFingerprint: `sha256:${"2".repeat(64)}`,
    parseOutput: (value) => value,
    operation: async () => (runtime.runProviderAttempt as (
      input: Record<string, unknown>,
    ) => Promise<unknown>)({
      stage: "framework_lenses",
      inputFingerprint: `sha256:${"2".repeat(64)}`,
      attemptFingerprint: `sha256:${"3".repeat(64)}`,
      costUnits: 1,
      tokenUnits: 100,
      namedLensAttempt: {
        judgmentOrCatalogCandidateId: "judgment_1",
        logicalPassageId: "judgment_1@named-lens-passage-v1@named-lens-generator-v1",
        attemptNumber: 1,
      },
      operation: async () => {
        order.push("provider");
        throw new Error("provider must not execute");
      },
    }),
  }), /checkpoint failure/);
  assert.deepEqual(order, [
    "durable-reserve",
    "checkpoint-rejected",
    "durable-aborted",
  ]);
  assert.equal(
    (await storage.listAttempts(
      "workspace_named_lens",
      "candidate_named_lens",
    ))[0]?.status,
    "aborted",
  );
});

test("timeout settlement wins and a late provider resolution cannot complete the durable attempt", async () => {
  let checkpoint: Parameters<UnderwritingRunsRepository["saveCheckpoint"]>[0]
    | undefined;
  let resolveProvider!: (value: {
    text: string;
    stopReason: string;
    usage: {
      inputTokens: number;
      outputTokens: number;
      cacheCreationInputTokens: number;
      cacheReadInputTokens: number;
    };
  }) => void;
  const provider = new Promise<Parameters<typeof resolveProvider>[0]>(
    (resolve) => {
      resolveProvider = resolve;
    },
  );
  const runs = {
    listCheckpoints: async () => checkpoint ? [checkpoint] : [],
    saveCheckpoint: async (value: typeof checkpoint) => {
      checkpoint = structuredClone(value);
    },
  } as unknown as UnderwritingRunsRepository;
  const namedLensArtifacts = createMemoryNamedLensArtifactsRepository();
  const candidate = {
    id: "candidate_named_lens_timeout",
    batchId: "batch_named_lens",
    workspaceId: "workspace_named_lens",
    dealId: "deal_named_lens",
    status: "running",
    candidateAnalysisFingerprint: `sha256:${"1".repeat(64)}`,
    rerunOfId: null,
    createdAt: "2026-08-10T12:00:00.000Z",
    finalizedAt: null,
  } satisfies CandidateRun;
  const runtime = await createCandidateStageRuntime({
    runs,
    namedLensArtifacts,
    candidate,
    workerId: "worker_1",
    leaseToken: "lease_1",
    budget: {
      maxCostUnits: 10,
      maxTokenUnits: 10_000,
      maxConcurrency: 1,
      stages: createCandidateStagePolicies({
        timeoutMs: 10,
        retryableAttempts: 1,
      }),
    },
    now: () => new Date("2026-08-10T12:00:00.000Z"),
  });
  await assert.rejects(runtime.run({
    stage: "framework_lenses",
    inputFingerprint: `sha256:${"2".repeat(64)}`,
    parseOutput: (value) => value,
    operation: async () => runtime.runProviderAttempt({
      stage: "framework_lenses",
      inputFingerprint: `sha256:${"2".repeat(64)}`,
      attemptFingerprint: `sha256:${"3".repeat(64)}`,
      costUnits: 1,
      tokenUnits: 100,
      namedLensAttempt: {
        judgmentOrCatalogCandidateId: "judgment_1",
        logicalPassageId:
          "judgment_1@named-lens-passage-v1@named-lens-generator-v1",
        attemptNumber: 1,
      },
      operation: () => provider,
    }),
  }), /timeout|bounded/i);
  assert.equal(
    (await namedLensArtifacts.listAttempts(
      candidate.workspaceId,
      candidate.id,
    ))[0]?.status,
    "aborted",
  );
  resolveProvider({
    text: "late passage",
    stopReason: "end_turn",
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(namedLensArtifacts.inspect().rawAttemptEvents.length, 2);
  assert.equal(
    (await namedLensArtifacts.listAttempts(
      candidate.workspaceId,
      candidate.id,
    ))[0]?.status,
    "aborted",
  );
});

test("timeout checkpoint settlement wins over a late provider rejection", async () => {
  let checkpoint: Parameters<UnderwritingRunsRepository["saveCheckpoint"]>[0]
    | undefined;
  let rejectProvider!: (error: Error) => void;
  const provider = new Promise<never>((_resolve, reject) => {
    rejectProvider = reject;
  });
  const runs = {
    listCheckpoints: async () => checkpoint ? [checkpoint] : [],
    saveCheckpoint: async (value: typeof checkpoint) => {
      checkpoint = structuredClone(value);
    },
  } as unknown as UnderwritingRunsRepository;
  const namedLensArtifacts = createMemoryNamedLensArtifactsRepository();
  const candidate = {
    id: "candidate_named_lens_late_rejection",
    batchId: "batch_named_lens",
    workspaceId: "workspace_named_lens",
    dealId: "deal_named_lens",
    status: "running",
    candidateAnalysisFingerprint: `sha256:${"1".repeat(64)}`,
    rerunOfId: null,
    createdAt: "2026-08-10T12:00:00.000Z",
    finalizedAt: null,
  } satisfies CandidateRun;
  const runtime = await createCandidateStageRuntime({
    runs,
    namedLensArtifacts,
    candidate,
    workerId: "worker_1",
    leaseToken: "lease_1",
    budget: {
      maxCostUnits: 10,
      maxTokenUnits: 10_000,
      maxConcurrency: 1,
      stages: createCandidateStagePolicies({
        timeoutMs: 10,
        retryableAttempts: 1,
      }),
    },
    now: () => new Date("2026-08-10T12:00:00.000Z"),
  });
  await assert.rejects(runtime.run({
    stage: "framework_lenses",
    inputFingerprint: `sha256:${"2".repeat(64)}`,
    parseOutput: (value) => value,
    operation: async () => runtime.runProviderAttempt({
      stage: "framework_lenses",
      inputFingerprint: `sha256:${"2".repeat(64)}`,
      attemptFingerprint: `sha256:${"3".repeat(64)}`,
      costUnits: 1,
      tokenUnits: 100,
      namedLensAttempt: {
        judgmentOrCatalogCandidateId: "judgment_1",
        logicalPassageId:
          "judgment_1@named-lens-passage-v1@named-lens-generator-v1",
        attemptNumber: 1,
      },
      operation: () => provider,
    }),
  }), /timeout|bounded/i);
  rejectProvider(new Error("late provider rejection"));
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(namedLensArtifacts.inspect().rawAttemptEvents.length, 2);
  assert.equal(
    (await namedLensArtifacts.listAttempts(
      candidate.workspaceId,
      candidate.id,
    ))[0]?.status,
    "aborted",
  );
  assert.equal(checkpoint?.providerAttempts[0]?.status, "aborted");
  assert.equal(checkpoint?.reasonCode,
    "CANDIDATE_STAGE_TIMEOUT_FRAMEWORK_LENSES");
});
