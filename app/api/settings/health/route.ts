import { getDataClient } from "../../../../db/client";
import { createRunsRepository } from "../../../../db/repositories/runs";
import { errorResponse, jsonOk } from "../../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../../lib/api/route-dependencies";
import { requirePermission } from "../../../../lib/api/safety";
import { getProductInputReadiness } from "../../../../lib/corpus/import-readiness";
import { readMarketProviderConfiguration } from "../../../../lib/market/config";
import { createDefaultDemoDataStore } from "../../../../lib/storage/service";
import { isXTraceScanModeAvailable } from "../../../../lib/xtrace/client";
import {
  canonicalPublicAppOrigin,
  uiSessionForContext,
} from "../../../ui-capabilities";
import { isDurableWorkspaceMode } from "../../../../lib/auth/request-context";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  _routeContext?: unknown,
  dependencies: RouteDependencies = {},
) {
  try {
    const context = await resolveRouteRequestContext(request, dependencies);
    requirePermission(context, "readWorkspace");
    const market = readMarketProviderConfiguration();
    const corpus = await getProductInputReadiness(
      createDefaultDemoDataStore(),
      context.workspaceId,
    );
    const postgres = Boolean(
      process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    let worker = false;
    if (postgres) {
      try {
        worker = await createRunsRepository(getDataClient()).isWorkerHealthy();
      } catch {
        worker = false;
      }
    }
    const canonicalAppOrigin = !isDurableWorkspaceMode(context.mode)
      ? canonicalPublicAppOrigin(process.env.PUBLIC_APP_URL)
      : undefined;

    return jsonOk({
      ...uiSessionForContext(context),
      ...(canonicalAppOrigin ? { canonicalAppOrigin } : {}),
      postgres,
      worker,
      xtrace: isXTraceScanModeAvailable(process.env, context.mode),
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      storage: Boolean(
        postgres &&
        process.env.SUPABASE_STORAGE_BUCKET &&
        process.env.DOCUMENT_URL_SIGNING_SECRET &&
        process.env.DOCUMENT_URL_SIGNING_SECRET.length >= 32
      ),
      corpusReady: corpus.ready,
      corpusConfirmedCount: corpus.confirmedCount,
      corpusRequiredCount: corpus.requiredCount,
      marketProviders: market.configuredProviderCount,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
