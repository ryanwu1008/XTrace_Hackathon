import { errorResponse, jsonError, jsonOk } from "../../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../../lib/api/route-dependencies";
import { requirePermission } from "../../../../lib/api/safety";
import { buildDemoViewModel } from "../../../../lib/demo/view-model";
import { getDealRegistry } from "../../../../db/repositories/deal-registry";
import { findProductDeal } from "../../../../lib/deals/read-model";
import { isDurableWorkspaceMode } from "../../../../lib/auth/request-context";

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
    const deal = isDurableWorkspaceMode(requestContext.mode)
      ? await findProductDeal({
        workspaceId: requestContext.workspaceId,
        dealId: id,
        deals: dependencies.dealRegistry ?? getDealRegistry(),
      })
      : buildDemoViewModel().deals.find((candidate) => candidate.id === id);
    return deal
      ? jsonOk(deal)
      : jsonError("NOT_FOUND", `Deal ${id} was not found`, 404);
  } catch (error) {
    return errorResponse(error);
  }
}
