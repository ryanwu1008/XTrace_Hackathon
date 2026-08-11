import { getDataClient } from "../../../db/client";
import { getIntelligenceRepository } from "../../../db/repositories/intelligence";
import { createRunsRepository } from "../../../db/repositories/runs";
import { errorResponse, jsonOk } from "../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../lib/api/route-dependencies";
import { requirePermission } from "../../../lib/api/safety";
import { toPublicReport } from "../../../lib/reports/public";
import { getTestGenerationRepository } from "../../../db/repositories/test-generations";
import { getUnderwritingArtifactsRepository } from "../../../db/repositories/underwriting-artifacts";
import { getUnderwritingRunsRepository } from "../../../db/repositories/underwriting-runs";
import { isDurableWorkspaceMode } from "../../../lib/auth/request-context";
import { APPROVED_PINNED_DEMO_SNAPSHOT_ID } from "../../../lib/contracts/evidence-context";
import { buildUnderwritingBatchSummary } from "../../../lib/underwriting/read-model";
import { buildCurrentUnderwritingExecution } from
  "../../../lib/reports/current-underwriting-integrity";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  _routeContext?: unknown,
  dependencies: RouteDependencies = {},
) {
  try {
    const context = await resolveRouteRequestContext(request, dependencies);
    requirePermission(context, "readWorkspace");
    const runId = new URL(request.url).searchParams.get("runId")?.trim();
    const repository = dependencies.intelligence ?? getIntelligenceRepository();
    const resetAt = runId
      ? null
      : await getTestGenerationRepository().currentResetAt(
        context.workspaceId,
      );
    const reports = runId
      ? [await repository.getReportByRunId(context.workspaceId, runId)].filter(
          (report) => report !== null,
        )
      : await repository.listReports(context.workspaceId, resetAt);
    const durableWorkspace = isDurableWorkspaceMode(context.mode);
    const scanRuns = dependencies.runs
      ?? createRunsRepository(getDataClient());
    const publicReports = await Promise.all(reports.map(async (report) => {
      if (!durableWorkspace) return toPublicReport(report);
      const legacyPinnedSnapshotId = report.evidenceContext?.state === "current"
          && report.evidenceContext.evidenceMode === "pinned"
          && report.evidenceContext.snapshotId
            === APPROVED_PINNED_DEMO_SNAPSHOT_ID
        ? APPROVED_PINNED_DEMO_SNAPSHOT_ID
        : null;
      const currentReport =
        report.evidenceContext?.state === "current"
        && legacyPinnedSnapshotId === null;
      const owningRun = currentReport
        ? await scanRuns.get(context.workspaceId, report.runId)
        : null;
      let batchReadIntegrityError = false;
      let underwritingBatch = null;
      try {
        underwritingBatch = await buildUnderwritingBatchSummary({
          workspaceId: context.workspaceId,
          scanRunId: report.runId,
          runs: dependencies.underwritingRuns
            ?? getUnderwritingRunsRepository(),
          artifacts: dependencies.underwritingArtifacts
            ?? getUnderwritingArtifactsRepository(),
          legacyPinnedSnapshotId,
        });
      } catch (error) {
        const terminalCurrentRun = currentReport
          && owningRun !== null
          && !["queued", "running"].includes(owningRun.status);
        if (!terminalCurrentRun) throw error;
        batchReadIntegrityError = true;
      }
      const reportWithObservedBatch = toPublicReport(report, {
        underwritingBatch,
      });
      let underwritingExecution = currentReport
        ? buildCurrentUnderwritingExecution({
          reportRunId: report.runId,
          run: owningRun,
          companyAnalyses: reportWithObservedBatch.companyAnalyses,
          underwritingBatch,
        })
        : null;
      if (underwritingExecution && batchReadIntegrityError) {
        underwritingExecution = {
          ...underwritingExecution,
          state: "integrity_error",
          message:
            "Deep Underwriting integrity error: the persisted batch could not be verified against the terminal scan.",
        };
      }
      const trustedUnderwritingBatch =
        underwritingExecution?.state === "integrity_error"
          ? null
          : underwritingBatch;
      const publicReport = trustedUnderwritingBatch === underwritingBatch
        ? reportWithObservedBatch
        : toPublicReport(report, { underwritingBatch: null });
      return {
        ...publicReport,
        ...(trustedUnderwritingBatch
          ? { underwritingBatch: trustedUnderwritingBatch }
          : {}),
        ...(underwritingExecution ? { underwritingExecution } : {}),
      };
    }));
    return jsonOk(publicReports);
  } catch (error) {
    return errorResponse(error);
  }
}
