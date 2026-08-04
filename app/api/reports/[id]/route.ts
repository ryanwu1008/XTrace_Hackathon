import { getIntelligenceRepository } from "../../../../db/repositories/intelligence";
import { getUnderwritingArtifactsRepository } from "../../../../db/repositories/underwriting-artifacts";
import { getUnderwritingRunsRepository } from "../../../../db/repositories/underwriting-runs";
import { errorResponse, jsonError, jsonOk } from "../../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../../lib/api/route-dependencies";
import { requirePermission } from "../../../../lib/api/safety";
import { toPublicReport } from "../../../../lib/reports/public";
import {
  buildUnderwritingBatchSummary,
} from "../../../../lib/underwriting/read-model";
import { isDurableWorkspaceMode } from "../../../../lib/auth/request-context";
import { APPROVED_PINNED_DEMO_SNAPSHOT_ID } from "../../../../lib/contracts/evidence-context";
import { assertCurrentReportUnderwritingIntegrity } from "../../../../lib/reports/current-underwriting-integrity";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
  dependencies: RouteDependencies = {},
) {
  try {
    const requestContext = await resolveRouteRequestContext(
      request,
      dependencies,
    );
    requirePermission(requestContext, "readWorkspace");
    const { id } = await context.params;
    const report = await (
      dependencies.intelligence ?? getIntelligenceRepository()
    ).getReport(
      requestContext.workspaceId,
      id,
    );
    if (!report) {
      return jsonError("NOT_FOUND", `Report ${id} was not found`, 404);
    }
    const legacyPinnedSnapshotId = report.evidenceContext?.state === "current"
        && report.evidenceContext.evidenceMode === "pinned"
        && report.evidenceContext.snapshotId
          === APPROVED_PINNED_DEMO_SNAPSHOT_ID
      ? APPROVED_PINNED_DEMO_SNAPSHOT_ID
      : null;
    const durableWorkspace = isDurableWorkspaceMode(requestContext.mode);
    const underwritingBatch = durableWorkspace
      ? await buildUnderwritingBatchSummary({
        workspaceId: requestContext.workspaceId,
        scanRunId: report.runId,
        runs: dependencies.underwritingRuns
          ?? getUnderwritingRunsRepository(),
        artifacts: dependencies.underwritingArtifacts
          ?? getUnderwritingArtifactsRepository(),
        legacyPinnedSnapshotId,
      })
      : null;
    const publicReport = toPublicReport(report, { underwritingBatch });
    if (
      durableWorkspace
      &&
      report.evidenceContext?.state === "current"
      && legacyPinnedSnapshotId === null
    ) {
      assertCurrentReportUnderwritingIntegrity({
        companyAnalyses: publicReport.companyAnalyses,
        underwritingBatch,
      });
    }
    return jsonOk({
      ...publicReport,
      ...(underwritingBatch ? { underwritingBatch } : {}),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
