import { z } from "zod";

import { getDataClient } from "../../../db/client";
import { createRunsRepository } from "../../../db/repositories/runs";
import { getIntelligenceRepository } from "../../../db/repositories/intelligence";
import { getUnderwritingRunsRepository } from "../../../db/repositories/underwriting-runs";
import { getUnderwritingArtifactsRepository } from "../../../db/repositories/underwriting-artifacts";
import { errorResponse, jsonError, jsonOk } from "../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../lib/api/route-dependencies";
import { requirePermission } from "../../../lib/api/safety";
import {
  searchPersistedUnderwriting,
} from "../../../lib/underwriting/read-model";
import { UnderwritingPresentationIntegrityError } from
  "../../../lib/underwriting/presentation-version";
import { isDurableWorkspaceMode } from "../../../lib/auth/request-context";
import { resolveReportEvidenceScope } from "../../../lib/reports/evidence-scope";

const SearchRequestSchema = z.strictObject({
  query: z.string().trim().min(2).max(500),
  reportId: z.string().trim().min(1).nullable(),
  runId: z.string().trim().min(1).nullable(),
  dealId: z.string().trim().min(1).nullable(),
}).superRefine((value, refinement) => {
  if ((value.reportId === null) !== (value.runId === null)) {
    refinement.addIssue({ code: "custom", message: "reportId and runId must be supplied together." });
  }
  if (value.dealId !== null && value.reportId === null) {
    refinement.addIssue({ code: "custom", message: "dealId requires an explicit report scope." });
  }
});

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  _routeContext?: unknown,
  dependencies: RouteDependencies = {},
) {
  try {
    const context = await resolveRouteRequestContext(request, dependencies);
    requirePermission(context, "readWorkspace");
    if (!isDurableWorkspaceMode(context.mode)) throw new Error("FORBIDDEN");
    const params = new URL(request.url).searchParams;
    const parsed = SearchRequestSchema.parse({
      query: params.get("q") ?? "",
      reportId: params.get("reportId"),
      runId: params.get("runId"),
      dealId: params.get("dealId"),
    });
    const intelligence = dependencies.intelligence ?? getIntelligenceRepository();
    const scope = await resolveReportEvidenceScope({
      workspaceId: context.workspaceId,
      request: parsed.reportId === null
        ? { kind: "latest_terminal" }
        : {
            kind: "report",
            reportId: parsed.reportId,
            runId: parsed.runId!,
            ...(parsed.dealId === null ? {} : { dealId: parsed.dealId }),
          },
      intelligence,
      runs: dependencies.runs ?? createRunsRepository(getDataClient()),
      underwritingRuns: dependencies.underwritingRuns
        ?? getUnderwritingRunsRepository(),
    });
    const results = await searchPersistedUnderwriting({
      workspaceId: context.workspaceId,
      query: parsed.query,
      artifacts: dependencies.underwritingArtifacts
        ?? getUnderwritingArtifactsRepository(),
      report: {
        id: scope.report.id,
        workspaceId: scope.report.workspaceId,
        evidenceContext: scope.report.evidenceContext,
      },
      candidateRunIds: scope.candidateRunIds,
    });
    return jsonOk({
      query: parsed.query,
      scope: {
        reportId: scope.report.id,
        runId: scope.run.id,
        dealId: scope.dealId,
        evidenceContext: scope.report.evidenceContext
          ?? { state: "legacy_unbound" },
      },
      results,
    });
  } catch (error) {
    if (error instanceof UnderwritingPresentationIntegrityError) {
      return jsonError("CONFLICT", error.message, 409);
    }
    return errorResponse(error);
  }
}
