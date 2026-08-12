import { getDealRegistry, type DealRegistry } from "../db/repositories/deal-registry";
import {
  getXTraceLineageRepository,
  type XTraceLineageRepository,
} from "../db/repositories/xtrace-lineage";
import { getSourceRegistry, type SourceRegistry } from "../db/repositories/source-registry";
import { getXTraceClient, type XTraceClient } from "../lib/xtrace/client";
import { createExactParentPlanner } from "../lib/xtrace/exact-parent-planner";
import {
  createXTraceService,
  resolveXTraceAppId,
  type XTraceRateLimiter,
} from "../lib/xtrace/service";
import { runExactXTraceIngestStage } from "./ingest-exact-xtrace-parents";

type ExactWorkerDependencies = {
  dealRegistry: Pick<
    DealRegistry,
    "listForWorkspace" | "listActiveSourceAssignments" | "getExactSourceBundle"
  >;
  sourceRegistry: Pick<SourceRegistry, "getRevision">;
  lineageRepository: XTraceLineageRepository;
  client: XTraceClient;
  limiter?: XTraceRateLimiter;
};

export async function runExactXTraceIngestWorker(
  input: { workspaceId: string; appId?: string },
  dependencies?: ExactWorkerDependencies,
) {
  const runtime = dependencies ?? {
    dealRegistry: getDealRegistry(),
    sourceRegistry: getSourceRegistry(),
    lineageRepository: getXTraceLineageRepository(),
    client: getXTraceClient({ stage: "explicit_ingest", allowLive: true }),
  };
  return runExactXTraceIngestStage({
    workspaceId: input.workspaceId,
    planner: createExactParentPlanner(runtime),
    service: createXTraceService(runtime.client, {
      workspaceId: input.workspaceId,
      ...(input.appId ? { appId: input.appId } : {}),
      lineageRepository: runtime.lineageRepository,
      ...(runtime.limiter ? { limiter: runtime.limiter } : {}),
    }),
  });
}

async function main(): Promise<void> {
  const workspaceId = process.argv[2]?.trim();
  if (!workspaceId) throw new Error("Usage: npm run xtrace:ingest -- <workspace-id>");
  const result = await runExactXTraceIngestWorker({
    workspaceId,
    appId: resolveXTraceAppId(),
  });
  console.log(JSON.stringify(result));
  if (result.results.some(({ outcome }) => outcome === "failed")) {
    process.exitCode = 1;
  }
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Exact XTrace ingest failed.");
    process.exitCode = 1;
  });
}
