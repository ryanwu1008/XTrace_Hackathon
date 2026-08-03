import type { RunStatus } from "../../lib/contracts/domain";
import type { DataClient, RunMode } from "../client";
import {
  RunEvidenceRequestV1Schema,
  type RunEvidenceRequestV1,
} from "../../lib/contracts/evidence-context";

export function createRunsRepository(client: DataClient) {
  return {
    async create(input: {
      workspaceId: string;
      mode: RunMode;
      windowDays: 14;
      evidenceRequest?: RunEvidenceRequestV1;
    }) {
      const evidenceRequest = RunEvidenceRequestV1Schema.parse(
        input.evidenceRequest ?? {
          schemaVersion: "run-evidence-request-v1",
          evidenceMode: "live",
        },
      );
      return client.createRunWithEvidenceContext({ ...input, evidenceRequest });
    },
    claimNext(workerId: string) {
      return client.claimNextRun(workerId);
    },
    bindPinnedMarketEvents(workspaceId: string, runId: string) {
      return client.bindPinnedRunMarketEvents(workspaceId, runId);
    },
    bindLiveMarketEvents(workspaceId: string, runId: string, eventIds: string[]) {
      return client.bindLiveRunMarketEvents(workspaceId, runId, eventIds);
    },
    renewLease(workspaceId: string, runId: string, workerId: string) {
      return client.renewRunLease(workspaceId, runId, workerId);
    },
    touchWorkerHeartbeat(workerId: string) {
      return client.touchWorkerHeartbeat(workerId);
    },
    isWorkerHealthy(maxAgeMs = 45_000) {
      return client.isWorkerHealthy(maxAgeMs);
    },
    async get(workspaceId: string, runId: string) {
      return client.getRun(workspaceId, runId);
    },
    list(workspaceId: string, resetAt: string | null = null) {
      return client.listRuns(workspaceId, resetAt);
    },
    async updateStage(input: {
      workspaceId: string;
      runId: string;
      stage: string;
      status: "queued" | "running" | "skipped" | "completed" | "failed";
      warning?: string;
      workerId?: string;
    }) {
      const run = await client.getRun(input.workspaceId, input.runId);
      if (!run) throw new Error(`Run ${input.runId} was not found`);
      if (input.workerId && run.workerId !== input.workerId) {
        throw new Error(`Worker ${input.workerId} no longer owns run ${input.runId}`);
      }
      if (
        input.workerId &&
        !await client.renewRunLease(
          input.workspaceId,
          input.runId,
          input.workerId,
        )
      ) {
        throw new Error(`Worker ${input.workerId} lost the lease for run ${input.runId}`);
      }
      const warnings = input.warning ? [...run.warnings, input.warning] : run.warnings;
      await client.insertRunStage({
        workspaceId: input.workspaceId,
        runId: input.runId,
        stage: input.stage,
        status: input.status,
        warning: input.warning ?? null,
        startedAt: new Date().toISOString(),
        completedAt: input.status === "running" ? null : new Date().toISOString(),
      });
      return client.updateRun(input.workspaceId, input.runId, {
        currentStage: input.stage,
        warningCount: warnings.length,
        warnings,
      });
    },
    async finish(input: {
      workspaceId: string;
      runId: string;
      status: Extract<RunStatus, "partial" | "completed" | "failed">;
      workerId?: string;
    }) {
      const run = await client.getRun(input.workspaceId, input.runId);
      if (!run) throw new Error(`Run ${input.runId} was not found`);
      if (input.workerId && run.workerId !== input.workerId) {
        throw new Error(`Worker ${input.workerId} no longer owns run ${input.runId}`);
      }
      return client.updateRun(input.workspaceId, input.runId, {
        status: input.status,
        completedAt: new Date().toISOString(),
        leaseExpiresAt: null,
      });
    },
  };
}
