import { getDataClient } from "../../../../../../db/client";
import { getIntelligenceRepository } from "../../../../../../db/repositories/intelligence";
import { createRunsRepository } from "../../../../../../db/repositories/runs";
import { getUnderwritingArtifactsRepository } from "../../../../../../db/repositories/underwriting-artifacts";
import { getUnderwritingRunsRepository } from "../../../../../../db/repositories/underwriting-runs";
import {
  errorResponse,
  jsonError,
  jsonOk,
} from "../../../../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../../../../lib/api/route-dependencies";
import { requirePermission } from "../../../../../../lib/api/safety";
import {
  buildUnderwritingBatchSummary,
  findCandidateForReportDeal,
  toVersionedCandidateUnderwritingDetail,
} from "../../../../../../lib/underwriting/read-model";
import {
  UnderwritingPresentationIntegrityError,
  resolveUnderwritingPresentationAdapter,
} from "../../../../../../lib/underwriting/presentation-version";
import { isDurableWorkspaceMode } from "../../../../../../lib/auth/request-context";
import { APPROVED_PINNED_DEMO_SNAPSHOT_ID } from
  "../../../../../../lib/contracts/evidence-context";
import { toPublicReport } from "../../../../../../lib/reports/public";
import {
  assertCurrentReportUnderwritingIntegrity,
  buildCurrentUnderwritingExecution,
} from "../../../../../../lib/reports/current-underwriting-integrity";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; dealId: string }> },
  dependencies: RouteDependencies = {},
) {
  try {
    const requestContext = await resolveRouteRequestContext(
      request,
      dependencies,
    );
    requirePermission(requestContext, "readWorkspace");
    if (!isDurableWorkspaceMode(requestContext.mode)) throw new Error("FORBIDDEN");
    const { id, dealId } = await context.params;
    const report = await (
      dependencies.intelligence ?? getIntelligenceRepository()
    ).getReport(requestContext.workspaceId, id);
    if (!report) {
      return jsonError("NOT_FOUND", `Report ${id} was not found`, 404);
    }
    const underwritingRuns = dependencies.underwritingRuns
      ?? getUnderwritingRunsRepository();
    const underwritingArtifacts = dependencies.underwritingArtifacts
      ?? getUnderwritingArtifactsRepository();
    const legacyPinnedSnapshotId =
      report.evidenceContext?.state === "current"
      && report.evidenceContext.evidenceMode === "pinned"
      && report.evidenceContext.snapshotId === APPROVED_PINNED_DEMO_SNAPSHOT_ID
        ? APPROVED_PINNED_DEMO_SNAPSHOT_ID
        : null;
    if (
      report.evidenceContext?.state === "current"
      && legacyPinnedSnapshotId === null
    ) {
      let underwritingBatch;
      try {
        underwritingBatch = await buildUnderwritingBatchSummary({
          workspaceId: requestContext.workspaceId,
          scanRunId: report.runId,
          runs: underwritingRuns,
          artifacts: underwritingArtifacts,
        });
      } catch {
        throw new UnderwritingPresentationIntegrityError(
          "report_underwriting_integrity",
        );
      }
      const publicReport = toPublicReport(report, { underwritingBatch });
      const owningRun = await (
        dependencies.runs ?? createRunsRepository(getDataClient())
      ).get(requestContext.workspaceId, report.runId);
      const execution = buildCurrentUnderwritingExecution({
        reportRunId: report.runId,
        run: owningRun,
        companyAnalyses: publicReport.companyAnalyses,
        underwritingBatch,
      });
      if (execution.state === "integrity_error") {
        throw new UnderwritingPresentationIntegrityError(
          "report_underwriting_integrity",
        );
      }
      try {
        assertCurrentReportUnderwritingIntegrity({
          companyAnalyses: publicReport.companyAnalyses,
          underwritingBatch,
        });
      } catch {
        throw new UnderwritingPresentationIntegrityError(
          "report_underwriting_integrity",
        );
      }
    }
    const candidate = await findCandidateForReportDeal({
      workspaceId: requestContext.workspaceId,
      scanRunId: report.runId,
      dealId,
      runs: underwritingRuns,
    });
    if (!candidate) {
      return jsonError(
        "NOT_FOUND",
        `Deal ${dealId} has no underwriting candidate in Report ${id}`,
        404,
      );
    }
    const bundle = await underwritingArtifacts.getByCandidateRunId({
      workspaceId: requestContext.workspaceId,
      candidateRunId: candidate.id,
    });
    if (!bundle) {
      return jsonError(
        "NOT_FOUND",
        `Deal ${dealId} has no finalized underwriting detail`,
        404,
      );
    }
    const adapter = resolveUnderwritingPresentationAdapter({
      report: {
        id: report.id,
        workspaceId: report.workspaceId,
        evidenceContext: report.evidenceContext,
      },
      requestedDealId: dealId,
      candidate: {
        id: candidate.id,
        workspaceId: candidate.workspaceId,
        dealId: candidate.dealId,
        artifactSourceCandidateRunId:
          candidate.artifactSourceCandidateRunId ?? null,
      },
      bundle,
    });
    return jsonOk(toVersionedCandidateUnderwritingDetail({
      bundle,
      adapter,
    }));
  } catch (error) {
    if (error instanceof UnderwritingPresentationIntegrityError) {
      return jsonError("CONFLICT", error.message, 409);
    }
    return errorResponse(error);
  }
}
