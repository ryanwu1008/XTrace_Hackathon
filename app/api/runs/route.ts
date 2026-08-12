import { CreateRunRequestSchema } from "../../../lib/contracts/http";
import { createRunsRepository } from "../../../db/repositories/runs";
import { getDataClient } from "../../../db/client";
import {
  errorResponse,
  jsonCreated,
  jsonError,
  jsonOk,
} from "../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../lib/api/route-dependencies";
import { rateLimitRequest, requirePermission } from "../../../lib/api/safety";
import { getProductInputReadiness } from "../../../lib/corpus/import-readiness";
import { createDefaultDemoDataStore } from "../../../lib/storage/service";
import { isXTraceScanModeAvailable } from "../../../lib/xtrace/client";
import { toPublicRun } from "../../../lib/runs/public";
import { isDurableWorkspaceMode } from "../../../lib/auth/request-context";
import { getTestGenerationRepository } from "../../../db/repositories/test-generations";
import {
  PINNED_THIRTY_DEAL_SNAPSHOT_ID,
} from "../../../lib/belief-reversal/pinned-thirty-deal-snapshot";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  _routeContext?: unknown,
  dependencies: RouteDependencies = {},
) {
  try {
    const context = await resolveRouteRequestContext(request, dependencies);
    requirePermission(context, "readWorkspace");
    const resetAt = await getTestGenerationRepository().currentResetAt(
      context.workspaceId,
    );
    const runsRepository = dependencies.runs
      ?? createRunsRepository(getDataClient());
    const runs = await runsRepository.list(
      context.workspaceId,
      resetAt,
    );
    return jsonOk(runs.map(toPublicRun));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  _routeContext?: unknown,
  dependencies: RouteDependencies = {},
) {
  try {
    const context = await resolveRouteRequestContext(request, dependencies);
    requirePermission(context, "readWorkspace");
    if (!isDurableWorkspaceMode(context.mode)) throw new Error("FORBIDDEN");
    const parsed = CreateRunRequestSchema.parse(await request.json());
    if (
      parsed.evidenceRequest.evidenceMode === "pinned"
      && (
        context.mode !== "public_sandbox"
        || parsed.evidenceRequest.snapshotId
          !== PINNED_THIRTY_DEAL_SNAPSHOT_ID
      )
    ) throw new Error("FORBIDDEN");
    if (
      process.env.NODE_ENV === "production" &&
      (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    ) {
      return jsonError(
        "INTEGRATION_UNAVAILABLE",
        "Persistent PostgreSQL is required before a public scan can be queued.",
        503,
        true,
      );
    }
    const limitRequest = dependencies.rateLimitRequest ?? rateLimitRequest;
    const rate = await limitRequest(
      request,
      "run-scan",
      5,
      10 * 60_000,
      { context },
    );
    if (!rate.allowed) {
      return jsonError(
        "RATE_LIMITED",
        `Too many scans. Try again in ${rate.retryAfterSeconds} seconds.`,
        429,
        true,
      );
    }
    const runs = dependencies.runs ?? createRunsRepository(getDataClient());
    let workerReady = false;
    try {
      workerReady = await runs.isWorkerHealthy();
    } catch {
      workerReady = false;
    }
    if (!workerReady) {
      return jsonError(
        "INTEGRATION_UNAVAILABLE",
        "A healthy background worker is required before a market scan can be queued.",
        503,
        true,
      );
    }
    const readiness = await getProductInputReadiness(
      createDefaultDemoDataStore(),
      context.workspaceId,
    );
    if (!readiness.ready) {
      return jsonError(
        "CONFLICT",
        `Confirm the fixed MVP corpus before running a scan: ${readiness.confirmedCount} of ${readiness.requiredCount} product inputs are durable.`,
        409,
      );
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return jsonError(
        "INTEGRATION_UNAVAILABLE",
        "Anthropic is required before a market scan can be queued.",
        503,
        true,
      );
    }
    if (
      parsed.xtraceEnabled
      && !isXTraceScanModeAvailable(process.env, context.mode)
    ) {
      return jsonError(
        "INTEGRATION_UNAVAILABLE",
        "XTrace is required for an XTrace-mode scan.",
        503,
        true,
      );
    }
    const run = await runs.create({
      workspaceId: context.workspaceId,
      mode: parsed.xtraceEnabled ? "xtrace" : "structured",
      windowDays: 14,
      evidenceRequest: parsed.evidenceRequest,
    });
    return jsonCreated(toPublicRun(run));
  } catch (error) {
    return errorResponse(error);
  }
}
