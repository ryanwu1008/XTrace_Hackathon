import { getSourceRegistry } from "../../../../../db/repositories/source-registry";
import { errorResponse, jsonError, jsonOk } from "../../../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../../../lib/api/route-dependencies";
import { rateLimitRequest, requirePermission } from "../../../../../lib/api/safety";
import { createDefaultPrivateDocumentAccess } from "../../../../../lib/storage/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PRIVATE_READ_TTL_SECONDS = 10 * 60;

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
    requirePermission(requestContext, "readPrivateSources");
    const { id } = await context.params;
    const revision = await (
      dependencies.sourceRegistry ?? getSourceRegistry()
    ).getRevision({
      workspaceId: requestContext.workspaceId,
      revisionId: id,
    });
    if (!revision) {
      return jsonError("NOT_FOUND", "Source revision was not found", 404);
    }
    const rate = await rateLimitRequest(
      request,
      "source-revision-access",
      30,
      undefined,
      { context: requestContext },
    );
    if (!rate.allowed) {
      return jsonError(
        "RATE_LIMITED",
        `Too many source requests. Try again in ${rate.retryAfterSeconds} seconds.`,
        429,
        true,
      );
    }
    const now = (dependencies.now ?? Date.now)();
    const expiresAtEpochSeconds = Math.floor(now / 1_000)
      + PRIVATE_READ_TTL_SECONDS;
    const url = await (
      dependencies.documentAccess ?? createDefaultPrivateDocumentAccess()
    ).createPrivateReadUrl({
      capability: {
        workspaceId: requestContext.workspaceId,
        sourceRevisionId: revision.id,
        objectVersion: revision.objectVersion,
        expiresAtEpochSeconds,
        permission: "read",
      },
      expiresInSeconds: PRIVATE_READ_TTL_SECONDS,
    });
    const acceptsHtml = request.headers.get("accept")
      ?.toLowerCase()
      .includes("text/html") ?? false;
    if (
      acceptsHtml
      || request.headers.get("sec-fetch-mode")?.toLowerCase() === "navigate"
    ) {
      return new Response(null, {
        status: 307,
        headers: {
          "cache-control": "private, no-store",
          location: new URL(url, request.url).toString(),
        },
      });
    }
    return jsonOk({
      url,
      expiresAt: new Date(expiresAtEpochSeconds * 1_000).toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
