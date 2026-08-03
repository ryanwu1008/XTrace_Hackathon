import type { RunRecord } from "../../db/client";

export type PublicRunRecord = Omit<
  RunRecord,
  "workerId" | "leaseExpiresAt"
>;

export function toPublicRun(run: RunRecord): PublicRunRecord {
  return {
    id: run.id,
    workspaceId: run.workspaceId,
    mode: run.mode,
    windowDays: run.windowDays,
    status: run.status,
    currentStage: run.currentStage,
    warningCount: run.warningCount,
    warnings: run.warnings.map(() => "A scan stage reported a warning."),
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    evidenceContext: run.evidenceContext,
  };
}
