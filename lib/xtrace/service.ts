import { createHash } from "node:crypto";

import {
  getXTraceLineageRepository,
  type XTraceLineageRepository,
} from "../../db/repositories/xtrace-lineage";
import {
  evidenceSourceText,
  type DealMemoryBundle,
  type Provenance,
} from "../contracts/domain";
import {
  XTraceHttpError,
  isAcceptedXTraceSearchResponse,
  type XTraceClient,
  type XTraceJob,
  type XTraceSearchResult,
} from "./client";

export const DEAL_MEMORY_SERIALIZER_VERSION = "deal-memory-v1";
const DEFAULT_APP_ID = "xtrace-vc-deal-intelligence";
const REQUESTS_PER_MINUTE = 25;
const REQUEST_WINDOW_MS = 60_000;

export type RecallDealContextInput = {
  workspaceId: string;
  runId?: string;
  query: string;
  candidateDealIds: string[];
  limit: number;
};

export type MemoryContext = {
  dealId: string;
  memoryId: string;
  memoryType: string | undefined;
  text: string;
  score: number;
  provenance: Provenance;
  sourceRevisionIds?: string[];
  sourceIds: string[];
  fixtureIds: string[];
};

export type PersistedIngest = {
  dealId: string;
  jobId: string;
  status: XTraceJob["status"];
  memoryIds: string[];
};

export interface XTraceRateLimiter {
  acquire(): Promise<void>;
}

export type XTraceServiceDependencies = {
  resolveMemory?: (memory: XTraceSearchResult, scope: {
    workspaceId: string;
    candidateDealIds: string[];
  }) => Promise<{
    dealId: string;
    sourceRevisionIds?: string[];
    sourceIds: string[];
    fixtureIds?: string[];
    provenance: Provenance;
  } | null>;
  persistIngest?: (record: PersistedIngest) => Promise<void> | void;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  appId?: string;
  workspaceId: string;
  serializerVersion?: string;
  lineageRepository?: XTraceLineageRepository;
  limiter?: XTraceRateLimiter;
};

export class XTraceUnavailableError extends Error {
  readonly code: string = "XTRACE_UNAVAILABLE";

  constructor(readonly retryable: boolean, message = "XTrace is temporarily unavailable") {
    super(message);
    this.name = "XTraceUnavailableError";
  }
}

export class XTracePollingTimeoutError extends XTraceUnavailableError {
  readonly code = "XTRACE_POLL_TIMEOUT";

  constructor(
    readonly jobId: string,
    readonly lastStatus: XTraceJob["status"],
  ) {
    super(true, `XTrace job ${jobId} remained ${lastStatus} after the polling budget`);
    this.name = "XTracePollingTimeoutError";
  }
}

const sharedLimiter = createXTraceRateLimiter(Date.now, defaultSleep);
let persistentLimiter: XTraceRateLimiter | undefined;

export function createXTraceService(
  client: XTraceClient,
  dependencies: XTraceServiceDependencies,
) {
  const cache = new Map<string, MemoryContext[]>();
  const limiter = dependencies.limiter
    ?? (dependencies.now || dependencies.sleep
      ? createXTraceRateLimiter(
          dependencies.now ?? Date.now,
          dependencies.sleep ?? defaultSleep,
        )
      : defaultXTraceRateLimiter());
  const appId = dependencies.appId ?? DEFAULT_APP_ID;
  const workspaceId = requiredWorkspaceId(dependencies.workspaceId);
  const serializerVersion =
    dependencies.serializerVersion ?? DEAL_MEMORY_SERIALIZER_VERSION;
  const lineage = dependencies.lineageRepository ?? getXTraceLineageRepository();

  const persist = async (record: PersistedIngest) => {
    await dependencies.persistIngest?.(record);
  };

  return {
    async ingestDealMemory(
      bundle: DealMemoryBundle,
      exactLineage?: {
        sourceRevisionIds: string[];
        sourceIds: string[];
        fixtureIds: string[];
      },
    ): Promise<PersistedIngest> {
      const sourceRevisionIds = exactLineage?.sourceRevisionIds ?? [];
      const sourceIds = exactLineage?.sourceIds ?? [...new Set(
        bundle.facts.flatMap((fact) =>
          fact.sources.map((source) => source.id)
        ),
      )];
      const fixtureIds = exactLineage?.fixtureIds ?? [...new Set(
        bundle.interactions.map((interaction) => interaction.id),
      )];
      const serializedBundle = serializeBundle(bundle, {
        sourceRevisionIds,
        sourceIds,
        fixtureIds,
      });
      const bundleFingerprint = createHash("sha256")
        .update(serializedBundle, "utf8")
        .digest("hex");
      const reusable = await lineage.findReusableIngest({
        workspaceId,
        dealId: bundle.dealId,
        sourceRevisionIds,
        sourceIds,
        fixtureIds,
        bundleFingerprint,
        serializerVersion,
      });
      const reusableIsEmptySuccess = reusable?.status === "succeeded"
        && reusable.memoryIds.length === 0;
      if (reusable && !reusableIsEmptySuccess) {
        const record = {
          dealId: reusable.dealId,
          jobId: reusable.jobId,
          status: reusable.status,
          memoryIds: reusable.memoryIds,
        };
        await persist(record);
        return record;
      }
      const response = await invoke(async () => {
        await limiter.acquire();
        return client.ingest({
          messages: [{ role: "user", content: serializedBundle }],
          user_id: stableXTraceUserId(workspaceId),
          conv_id: `deal:${bundle.dealId}`,
          app_id: appId,
        }, { wait: false });
      });
      const record = toPersistedIngest(bundle.dealId, response);
      await lineage.recordSubmission({
        jobId: record.jobId,
        workspaceId,
        dealId: bundle.dealId,
        sourceRevisionIds,
        sourceIds,
        fixtureIds,
        bundleFingerprint,
        serializerVersion,
        provenance: bundleProvenance(bundle),
        status: record.status,
      });
      if (isTerminal(record.status)) {
        await lineage.recordCompletion({
          workspaceId,
          jobId: record.jobId,
          status: record.status,
          memoryIds: record.memoryIds,
        });
      }
      await persist(record);
      return record;
    },

    async pollIngestJob(jobId: string, options: {
      maxAttempts?: number;
      initialDelayMs?: number;
      dealId?: string;
    } = {}): Promise<PersistedIngest> {
      const maxAttempts = options.maxAttempts ?? 8;
      let delay = options.initialDelayMs ?? 500;
      let latest: XTraceJob | undefined;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        latest = await invoke(async () => {
          await limiter.acquire();
          return client.getJob(jobId);
        });
        const record = toPersistedIngest(options.dealId ?? "", latest, jobId);
        await persist(record);
        if (isTerminal(latest.status)) {
          await lineage.recordCompletion({
            workspaceId,
            jobId,
            status: latest.status,
            memoryIds: record.memoryIds,
          });
          return record;
        }

        if (attempt < maxAttempts - 1) {
          await (dependencies.sleep ?? defaultSleep)(delay);
          delay = Math.min(delay * 1.5, 5_000);
        }
      }

      if (!latest) throw new XTraceUnavailableError(true);
      throw new XTracePollingTimeoutError(jobId, latest.status);
    },

    async recallDealContext(input: RecallDealContextInput): Promise<MemoryContext[]> {
      const requestWorkspaceId = requiredWorkspaceId(input.workspaceId);
      if (requestWorkspaceId !== workspaceId) {
        throw new Error("XTrace request workspace does not match the scoped service.");
      }
      const scopedInput = { ...input, workspaceId };
      const fingerprint = recallFingerprint(scopedInput);
      const cached = cache.get(fingerprint);
      if (cached) return cached;

      const response = await invoke(async () => {
        await limiter.acquire();
        return client.search({
          query: scopedInput.query,
          user_id: stableXTraceUserId(workspaceId),
          app_id: appId,
          mode: "retrieve",
          limit: Math.max(1, Math.min(scopedInput.limit, 100)),
        });
      });
      if (!isAcceptedXTraceSearchResponse(response)) {
        throw new XTraceUnavailableError(false, "XTrace search response was invalid");
      }
      const allowedDealIds = new Set(scopedInput.candidateDealIds);
      const contexts: MemoryContext[] = [];
      for (const memory of response.data) {
        const resolved = dependencies.resolveMemory
          ? await dependencies.resolveMemory(memory, {
              workspaceId,
              candidateDealIds: scopedInput.candidateDealIds,
            })
          : await lineage.resolve({
              memoryId: memory.id,
              workspaceId,
              convId: memory.conv_id ?? undefined,
            });
        if (!resolved || !allowedDealIds.has(resolved.dealId)) continue;
        const fixtureIds = resolved.fixtureIds ?? [];
        if (!resolved.sourceIds.length && !fixtureIds.length) continue;
        contexts.push({
          dealId: resolved.dealId,
          memoryId: memory.id,
          memoryType: memory.type,
          text: memory.text,
          score: memory.score,
          provenance: resolved.provenance,
          sourceRevisionIds: resolved.sourceRevisionIds ?? [],
          sourceIds: resolved.sourceIds,
          fixtureIds,
        });
      }
      const result = contexts.slice(0, input.limit);
      cache.set(fingerprint, result);
      return result;
    },
  };
}

function requiredWorkspaceId(workspaceId: string): string {
  const normalized = workspaceId?.trim();
  if (!normalized) throw new Error("An XTrace workspace is required.");
  return normalized;
}

function defaultXTraceRateLimiter(): XTraceRateLimiter {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return sharedLimiter;
  persistentLimiter ??= createPersistentXTraceRateLimiter({
    url,
    serviceRoleKey,
  });
  return persistentLimiter;
}

export function createPersistentXTraceRateLimiter(options: {
  url: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}): XTraceRateLimiter {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  return {
    async acquire() {
      for (;;) {
        const response = await fetchImpl(
          `${options.url.replace(/\/$/, "")}/rest/v1/rpc/take_public_request`,
          {
            method: "POST",
            headers: {
              apikey: options.serviceRoleKey,
              authorization: `Bearer ${options.serviceRoleKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              p_scope: "xtrace-api",
              p_client_hash: "shared-server-key",
              p_limit: REQUESTS_PER_MINUTE,
              p_window_seconds: Math.ceil(REQUEST_WINDOW_MS / 1_000),
            }),
            cache: "no-store",
          },
        );
        if (!response.ok) {
          throw new XTraceUnavailableError(
            true,
            `Shared XTrace quota coordinator failed with ${response.status}`,
          );
        }
        const rows = await response.json() as Array<{
          allowed: boolean;
          retry_after_seconds: number;
        }>;
        if (rows[0]?.allowed) return;
        await sleep(Math.max(1, Number(rows[0]?.retry_after_seconds ?? 1)) * 1_000);
      }
    },
  };
}

function isTerminal(status: XTraceJob["status"]) {
  return status === "succeeded" || status === "failed";
}

function toPersistedIngest(
  dealId: string,
  response: XTraceJob,
  fallbackJobId?: string,
): PersistedIngest {
  return {
    dealId,
    jobId: response.id ?? fallbackJobId ?? "",
    status: response.status,
    memoryIds: response.result?.memories_created?.map((memory) => memory.id) ?? [],
  };
}

function serializeBundle(
  bundle: DealMemoryBundle,
  lineage: {
    sourceRevisionIds: string[];
    sourceIds: string[];
    fixtureIds: string[];
  },
): string {
  const facts = bundle.facts.flatMap((fact) => fact.sources.map((source) =>
    `[${source.provenance}] source_id=${source.id}; title=${source.title}; evidence=${evidenceSourceText(source)}; fact=${fact.text}`,
  ));
  const interactions = bundle.interactions.map((interaction) =>
    `[demo_fixture] fixture_id=${interaction.id}; label=${interaction.label}; occurred_at=${interaction.occurredAt}; summary=${interaction.summary}; decision_reason=${interaction.decisionReason}; concerns=${interaction.concerns.join(" | ")}; revisit_conditions=${interaction.revisitConditions.join(" | ")}`,
  );
  return [
    `Deal ${bundle.companyName} (deal_id=${bundle.dealId}; status=${bundle.status})`,
    `Exact lineage: source_revision_ids=${lineage.sourceRevisionIds.join(",")}; source_ids=${lineage.sourceIds.join(",")}; fixture_ids=${lineage.fixtureIds.join(",")}`,
    ...facts,
    ...interactions,
  ].join("\n");
}

function bundleProvenance(bundle: DealMemoryBundle): Provenance {
  const sourceProvenances = bundle.facts.flatMap((fact) =>
    fact.sources.map((source) => source.provenance)
  );
  if (sourceProvenances.includes("source_document")) return "source_document";
  if (sourceProvenances.includes("public_web")) return "public_web";
  if (sourceProvenances.includes("demo_fixture") || bundle.interactions.length > 0) {
    return "demo_fixture";
  }
  return "model_inference";
}

function recallFingerprint(input: RecallDealContextInput): string {
  return JSON.stringify({
    workspaceId: input.workspaceId,
    runId: input.runId ?? "",
    query: input.query.trim().toLocaleLowerCase(),
    candidateDealIds: [...input.candidateDealIds].sort(),
    limit: input.limit,
  });
}

export function stableXTraceUserId(workspaceId: string): string {
  return `workspace:${workspaceId}`;
}

async function invoke<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof XTraceUnavailableError) throw error;
    if (error instanceof XTraceHttpError) {
      throw new XTraceUnavailableError(error.retryable, error.message);
    }
    throw new XTraceUnavailableError(true);
  }
}

export function createXTraceRateLimiter(
  now: () => number,
  sleep: (milliseconds: number) => Promise<void>,
  requestsPerWindow = REQUESTS_PER_MINUTE,
  requestWindowMs = REQUEST_WINDOW_MS,
): XTraceRateLimiter {
  const timestamps: number[] = [];
  return {
    async acquire(): Promise<void> {
      for (;;) {
        const current = now();
        while (timestamps.length > 0 && timestamps[0] <= current - requestWindowMs) {
          timestamps.shift();
        }
        if (timestamps.length < requestsPerWindow) {
          timestamps.push(current);
          return;
        }
        await sleep(Math.max(1, timestamps[0] + requestWindowMs - current));
      }
    },
  };
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
