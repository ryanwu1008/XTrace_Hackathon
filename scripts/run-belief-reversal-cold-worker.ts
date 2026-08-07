import { hostname } from "node:os";

import { getDataClient } from "../db/client";
import { createRunsRepository } from "../db/repositories/runs";
import { getSourceRegistry } from "../db/repositories/source-registry";
import { createDefaultDemoDataStore } from "../lib/storage/service";
import {
  createBeliefReversalProcessRuntime,
} from "../tests/helpers/belief-reversal-e2e-pipeline";
import {
  createBeliefReversalRegistryGroundedLiveMarketService,
} from "../tests/helpers/belief-reversal-live-market";
import { processClaimedRun } from "../worker/process-run";

const WORKER_ID = process.env.WORKER_ID?.trim()
  || `belief-reversal-cold-${hostname()}-${process.pid}`;
const POLL_INTERVAL_MS = 250;
const HEARTBEAT_INTERVAL_MS = 5_000;

// A heartbeat is a periodic call, so one failed attempt says nothing about
// Worker health. Tolerate a bounded run of failures, then fail closed so a
// genuinely unusable credential or gateway still stops the Worker.
export const MAXIMUM_CONSECUTIVE_HEARTBEAT_FAILURES = 5;

export function shouldContinueAfterHeartbeatFailure(
  consecutiveFailures: number,
): boolean {
  return consecutiveFailures < MAXIMUM_CONSECUTIVE_HEARTBEAT_FAILURES;
}

export function readBeliefReversalColdWorkerConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
) {
  if (environment.NODE_ENV?.trim().toLowerCase() === "production") {
    throw new Error("Cold Worker is forbidden in production.");
  }
  const postgrestUrl = exactLoopbackOrigin(
    required(environment.SUPABASE_URL, "SUPABASE_URL"),
    "SUPABASE_URL",
  );
  const marketSourceUrl = exactLoopbackUrl(
    required(
      environment.BELIEF_REVERSAL_MARKET_FIXTURE_URL,
      "BELIEF_REVERSAL_MARKET_FIXTURE_URL",
    ),
    "BELIEF_REVERSAL_MARKET_FIXTURE_URL",
  );
  const serviceRoleKey = required(
    environment.SUPABASE_SERVICE_ROLE_KEY,
    "SUPABASE_SERVICE_ROLE_KEY",
  );
  const databaseName = required(
    environment.BELIEF_REVERSAL_FIXTURE_DATABASE,
    "BELIEF_REVERSAL_FIXTURE_DATABASE",
  );
  if (!/^vsee_[a-z0-9_]{1,37}_[0-9a-f]{16}$/u.test(databaseName)) {
    throw new Error("Cold Worker requires an exact disposable database identity.");
  }
  return {
    postgrestUrl: postgrestUrl.origin,
    marketSourceUrl: marketSourceUrl.href,
    serviceRoleKey,
    databaseName,
  };
}

export async function preflightBeliefReversalColdWorkerTarget(input: {
  environment?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
} = {}) {
  const configuration = readBeliefReversalColdWorkerConfiguration(
    input.environment ?? process.env,
  );
  const response = await (input.fetchImpl ?? fetch)(
    `${configuration.postgrestUrl}/rest/v1/rpc/__vsee_task12_database_identity`,
    {
      method: "POST",
      headers: {
        apikey: configuration.serviceRoleKey,
        authorization: `Bearer ${configuration.serviceRoleKey}`,
        "content-type": "application/json",
      },
      body: "{}",
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error("Cold Worker could not verify its disposable database identity.");
  }
  const observedIdentity = await response.json().catch(() => null) as unknown;
  if (observedIdentity !== configuration.databaseName) {
    throw new Error("Cold Worker database identity mismatch.");
  }
  return configuration;
}

export async function runBeliefReversalColdWorker(): Promise<never> {
  // This RPC proves which database the loopback PostgREST endpoint actually
  // fronts. It must complete before repositories are created, heartbeat/claim
  // writes occur, or the runtime can start any provider work.
  const configuration = await preflightBeliefReversalColdWorkerTarget();
  const heartbeatRuns = createRunsRepository(getDataClient());
  await heartbeatRuns.touchWorkerHeartbeat(WORKER_ID);
  const marketCalls = { count: 0 };
  const workspaceId = process.env.DEMO_WORKSPACE_ID?.trim() || "workspace_demo";
  const marketService = createBeliefReversalRegistryGroundedLiveMarketService({
    sourceUrl: configuration.marketSourceUrl,
    sourceRegistry: getSourceRegistry(),
    workspaceId,
    fetchImpl: async (request, init) => {
      marketCalls.count += 1;
      return fetch(request, init);
    },
  });
  const runtime = await createBeliefReversalProcessRuntime({
    target: {
      databaseName: configuration.databaseName,
      postgresVersion: "17.6",
      postgrestUrl: configuration.postgrestUrl,
      postgrestVersion: "12.2.3",
      serviceRoleKey: configuration.serviceRoleKey,
    },
    workspaceId,
    dataStore: createDefaultDemoDataStore(),
    market: marketService,
  });
  console.log(
    `[${WORKER_ID}] cold Scan Worker ready with ${runtime.parents.length} exact Deal parents`,
  );

  let consecutiveHeartbeatFailures = 0;
  for (;;) {
    try {
      await runtime.runs.touchWorkerHeartbeat(WORKER_ID);
      consecutiveHeartbeatFailures = 0;
    } catch (error) {
      consecutiveHeartbeatFailures += 1;
      console.error(
        `[${WORKER_ID}] heartbeat failed `
          + `(${consecutiveHeartbeatFailures}/${MAXIMUM_CONSECUTIVE_HEARTBEAT_FAILURES}): `
          + errorMessage(error),
      );
      if (!shouldContinueAfterHeartbeatFailure(consecutiveHeartbeatFailures)) {
        throw error;
      }
      await delay(POLL_INTERVAL_MS);
      continue;
    }
    const claimed = await runtime.runs.claimNext(WORKER_ID);
    if (!claimed) {
      await delay(POLL_INTERVAL_MS);
      continue;
    }
    const heartbeat = setInterval(() => {
      void Promise.all([
        runtime.runs.touchWorkerHeartbeat(WORKER_ID),
        runtime.runs.renewLease(claimed.workspaceId, claimed.id, WORKER_ID),
      ]).catch((error) => {
        console.error(
          `[${WORKER_ID}] heartbeat failed: ${errorMessage(error)}`,
        );
      });
    }, HEARTBEAT_INTERVAL_MS);
    heartbeat.unref();
    try {
      const beforeMarketCalls = marketCalls.count;
      const result = await processClaimedRun(
        claimed,
        runtime.processDependencies,
      );
      const collectedMarketCalls = marketCalls.count - beforeMarketCalls;
      if (
        claimed.evidenceContext.state === "current"
        && claimed.evidenceContext.evidenceMode === "live"
        && collectedMarketCalls !== 1
      ) {
        throw new Error(
          `Cold live Scan required one source collection, observed ${collectedMarketCalls}.`,
        );
      }
      console.log(JSON.stringify({
        event: "belief_reversal_cold_scan_completed",
        runId: result.run.id,
        reportId: result.report.id,
        status: result.run.status,
        marketCollectionCalls: collectedMarketCalls,
        providerInspection: runtime.providers.inspect(),
      }));
    } catch (error) {
      const current = await runtime.runs.get(claimed.workspaceId, claimed.id);
      if (current?.status === "running" && current.workerId === WORKER_ID) {
        await runtime.runs.finish({
          workspaceId: claimed.workspaceId,
          runId: claimed.id,
          status: "failed",
          workerId: WORKER_ID,
        });
      }
      console.error(
        `[${WORKER_ID}] cold Scan ${claimed.id} failed: ${errorMessage(error)}`,
      );
    } finally {
      clearInterval(heartbeat);
    }
  }
}

function required(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Cold Worker requires ${label}.`);
  return normalized;
}

function exactLoopbackOrigin(value: string, label: string): URL {
  const url = exactLoopbackUrl(value, label);
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`Cold Worker ${label} must be an exact loopback origin.`);
  }
  return url;
}

function exactLoopbackUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Cold Worker ${label} must use loopback HTTP.`);
  }
  if (
    url.protocol !== "http:"
    || url.hostname !== "127.0.0.1"
    || !url.port
    || url.username
    || url.password
    || url.hash
  ) {
    throw new Error(`Cold Worker ${label} must use loopback HTTP.`);
  }
  return url;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  runBeliefReversalColdWorker().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
