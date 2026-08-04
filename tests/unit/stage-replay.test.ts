import assert from "node:assert/strict";
import test from "node:test";

import type { UnderwritingRunsRepository } from "../../db/repositories/underwriting-runs";
import type { CandidateRun } from "../../lib/contracts/underwriting";
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
