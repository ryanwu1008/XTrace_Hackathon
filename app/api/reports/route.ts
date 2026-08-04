import { getIntelligenceRepository } from "../../../db/repositories/intelligence";
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
import { assertCurrentReportUnderwritingIntegrity } from "../../../lib/reports/current-underwriting-integrity";

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
    const publicReports = await Promise.all(reports.map(async (report) => {
      if (!durableWorkspace) return toPublicReport(report);
      const legacyPinnedSnapshotId = report.evidenceContext?.state === "current"
          && report.evidenceContext.evidenceMode === "pinned"
          && report.evidenceContext.snapshotId
            === APPROVED_PINNED_DEMO_SNAPSHOT_ID
        ? APPROVED_PINNED_DEMO_SNAPSHOT_ID
        : null;
      const underwritingBatch = await buildUnderwritingBatchSummary({
        workspaceId: context.workspaceId,
        scanRunId: report.runId,
        runs: dependencies.underwritingRuns
          ?? getUnderwritingRunsRepository(),
        artifacts: dependencies.underwritingArtifacts
          ?? getUnderwritingArtifactsRepository(),
        legacyPinnedSnapshotId,
      });
      const publicReport = toPublicReport(report, { underwritingBatch });
      if (
        report.evidenceContext?.state === "current"
        && legacyPinnedSnapshotId === null
      ) {
        assertCurrentReportUnderwritingIntegrity({
          companyAnalyses: publicReport.companyAnalyses,
          underwritingBatch,
        });
      }
      return publicReport;
    }));
    return jsonOk(publicReports);
  } catch (error) {
    return errorResponse(error);
  }
}
