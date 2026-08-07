import type { RunStatus } from "../lib/contracts/domain";
import { createHash } from "node:crypto";
import {
  IntegrationTransportError,
  isRetryableTransportStatus,
} from "../lib/api/errors";
import {
  RunEvidenceRequestV1Schema,
  RunEvidenceBindingV1Schema,
  parseRunEvidenceContextRow,
  type CurrentRunEvidenceContextV1,
  type MarketEvidenceSnapshotV1,
  type RunEvidenceContext,
  type RunEvidenceRequestV1,
  type RunEvidenceBindingV1,
} from "../lib/contracts/evidence-context";
import {
  canonicalEvidenceJson,
  WritableMarketEventV2Schema,
  type WritableMarketEventV2,
} from "../lib/contracts/source-evidence";
import { compareUtf8 } from "../lib/format/canonical-order";
import { withinPublicationWindow } from "../lib/market/dedupe";

export type RunMode = "xtrace" | "structured";
export type StageStatus = "queued" | "running" | "skipped" | "completed" | "failed";

export const ACTIVE_RUN_EVIDENCE_CONTEXT_CONFLICT =
  "ACTIVE_RUN_EVIDENCE_CONTEXT_CONFLICT" as const;

export class ActiveRunEvidenceContextConflictError extends Error {
  readonly code = ACTIVE_RUN_EVIDENCE_CONTEXT_CONFLICT;

  constructor() {
    super(ACTIVE_RUN_EVIDENCE_CONTEXT_CONFLICT);
    this.name = "ActiveRunEvidenceContextConflictError";
  }
}

export interface RunRecord {
  id: string;
  workspaceId: string;
  mode: RunMode;
  windowDays: 14;
  status: RunStatus;
  currentStage: string | null;
  warningCount: number;
  warnings: string[];
  workerId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  leaseExpiresAt: string | null;
  evidenceContext: RunEvidenceContext;
}

export interface RunStageRecord {
  id: string;
  workspaceId: string;
  runId: string;
  stage: string;
  status: StageStatus;
  warning: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface CreateRunRow {
  workspaceId: string;
  mode: RunMode;
  windowDays: 14;
}

export interface CreateRunWithEvidenceContextRow extends CreateRunRow {
  evidenceRequest: RunEvidenceRequestV1;
}

export type RunUpdatePatch = Partial<Omit<
  RunRecord,
  "id" | "workspaceId" | "mode" | "windowDays" | "createdAt"
>>;

export interface DataClient {
  createRunWithEvidenceContext(
    input: CreateRunWithEvidenceContextRow,
  ): Promise<RunRecord>;
  bindPinnedRunMarketEvents(
    workspaceId: string,
    runId: string,
  ): Promise<RunEvidenceBindingV1>;
  bindLiveRunMarketEvents(
    workspaceId: string,
    runId: string,
    events: WritableMarketEventV2[],
  ): Promise<RunEvidenceBindingV1>;
  getRunEvidenceBinding(
    workspaceId: string,
    runId: string,
  ): Promise<RunEvidenceBindingV1 | null>;
  findActiveRun(input: CreateRunRow): Promise<RunRecord | null>;
  insertRun(input: CreateRunRow): Promise<RunRecord>;
  // Global worker-only queue claim. Every mutation after claim is scoped by
  // the workspace returned on the claimed record.
  claimNextRun(workerId: string): Promise<RunRecord | null>;
  renewRunLease(
    workspaceId: string,
    runId: string,
    workerId: string,
  ): Promise<boolean>;
  updateRun(
    workspaceId: string,
    runId: string,
    patch: RunUpdatePatch,
  ): Promise<RunRecord>;
  getRun(workspaceId: string, runId: string): Promise<RunRecord | null>;
  listRuns(
    workspaceId: string,
    resetAt?: string | null,
  ): Promise<RunRecord[]>;
  insertRunStage(input: Omit<RunStageRecord, "id">): Promise<RunStageRecord>;
  touchWorkerHeartbeat(workerId: string): Promise<void>;
  isWorkerHealthy(maxAgeMs: number): Promise<boolean>;
}

const DEFAULT_LEASE_DURATION_MS = 120_000;

function makeRun(
  input: CreateRunRow,
  now: Date,
  evidenceContext: RunEvidenceContext = { state: "legacy_unbound" },
): RunRecord {
  return {
    id: crypto.randomUUID(),
    workspaceId: input.workspaceId,
    mode: input.mode,
    windowDays: input.windowDays,
    status: "queued",
    currentStage: null,
    warningCount: 0,
    warnings: [],
    workerId: null,
    createdAt: now.toISOString(),
    startedAt: null,
    completedAt: null,
    leaseExpiresAt: null,
    evidenceContext,
  };
}

function assertRunIdentityIsImmutable(patch: RunUpdatePatch): void {
  const candidate = patch as Partial<RunRecord>;
  if (candidate.id !== undefined || candidate.workspaceId !== undefined) {
    throw new Error("Run workspace identity cannot be changed.");
  }
}

export function createMemoryDataClient(options: {
  now?: () => Date;
  leaseDurationMs?: number;
  getEvidenceSnapshot?: (
    workspaceId: string,
    snapshotId: string,
  ) => Promise<MarketEvidenceSnapshotV1 | null>;
  getLiveMarketEvents?: (
    workspaceId: string,
  ) => Promise<WritableMarketEventV2[]>;
} = {}): DataClient {
  const runs = new Map<string, RunRecord>();
  const stages: RunStageRecord[] = [];
  const workerHeartbeats = new Map<string, string>();
  const evidenceBindings = new Map<string, RunEvidenceBindingV1>();
  const now = options.now ?? (() => new Date());
  const leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;

  function fingerprint(frames: readonly string[]): string {
    const hash = createHash("sha256");
    for (const frame of frames) {
      const bytes = Buffer.from(frame, "utf8");
      hash.update(`${bytes.length}:`);
      hash.update(bytes);
    }
    return `sha256:${hash.digest("hex")}`;
  }

  async function resolveEvidenceContext(
    input: CreateRunWithEvidenceContextRow,
  ): Promise<CurrentRunEvidenceContextV1> {
    const request = RunEvidenceRequestV1Schema.parse(input.evidenceRequest);
    if (request.evidenceMode === "pinned") {
      const snapshot = await options.getEvidenceSnapshot?.(
        input.workspaceId,
        request.snapshotId,
      );
      if (!snapshot) throw new Error(`Evidence snapshot ${request.snapshotId} was not found.`);
      const context = {
        state: "current" as const,
        schemaVersion: "run-evidence-context-v1" as const,
        evidenceMode: "pinned" as const,
        windowDays: 14 as const,
        anchorAt: snapshot.anchorAt,
        windowStartAt: snapshot.windowStartAt,
        windowEndAt: snapshot.windowEndAt,
        windowTimezone: snapshot.windowTimezone,
        snapshotId: snapshot.id,
        snapshotFingerprint: snapshot.snapshotFingerprint,
        contextFingerprint: "",
      };
      context.contextFingerprint = fingerprint([
        context.schemaVersion,
        input.workspaceId,
        input.mode,
        String(input.windowDays),
        context.evidenceMode,
        context.anchorAt,
        context.windowStartAt,
        context.windowEndAt,
        context.windowTimezone,
        context.snapshotId,
        context.snapshotFingerprint,
      ]);
      return context;
    }
    const anchor = now();
    if (!Number.isFinite(anchor.getTime())) throw new Error("A valid database clock is required.");
    const anchorAt = anchor.toISOString();
    const windowStartAt = new Date(anchor.getTime() - 14 * 86_400_000).toISOString();
    const context = {
      state: "current" as const,
      schemaVersion: "run-evidence-context-v1" as const,
      evidenceMode: "live" as const,
      windowDays: 14 as const,
      anchorAt,
      windowStartAt,
      windowEndAt: anchorAt,
      windowTimezone: "America/Los_Angeles",
      snapshotId: null,
      snapshotFingerprint: null,
      contextFingerprint: "",
    };
    context.contextFingerprint = fingerprint([
      context.schemaVersion,
      input.workspaceId,
      input.mode,
      String(input.windowDays),
      context.evidenceMode,
      context.anchorAt,
      context.windowStartAt,
      context.windowEndAt,
      context.windowTimezone,
      "",
      "",
    ]);
    return context;
  }

  function bindingKey(workspaceId: string, runId: string) {
    return `${workspaceId}\0${runId}`;
  }

  function createBinding(
    run: RunRecord,
    eventsInput: readonly WritableMarketEventV2[],
    displayLabel: string,
  ): RunEvidenceBindingV1 {
    if (run.evidenceContext.state !== "current") {
      throw new Error("A current evidence context is required before binding events.");
    }
    const events = [...eventsInput]
      .map((event) => WritableMarketEventV2Schema.parse(event))
      .sort((left, right) => compareUtf8(left.id, right.id));
    const eventSetFingerprint = fingerprint([
      "run-event-set-v1",
      ...events.map(canonicalEvidenceJson),
    ]);
    const bindingFingerprint = fingerprint([
      "run-evidence-binding-v1",
      run.workspaceId,
      run.id,
      run.evidenceContext.contextFingerprint,
      eventSetFingerprint,
      String(events.length),
    ]);
    return RunEvidenceBindingV1Schema.parse({
      schemaVersion: "run-evidence-binding-v1",
      workspaceId: run.workspaceId,
      runId: run.id,
      evidenceMode: run.evidenceContext.evidenceMode,
      windowDays: 14,
      anchorAt: run.evidenceContext.anchorAt,
      windowStartAt: run.evidenceContext.windowStartAt,
      windowEndAt: run.evidenceContext.windowEndAt,
      windowTimezone: run.evidenceContext.windowTimezone,
      snapshotId: run.evidenceContext.snapshotId,
      snapshotFingerprint: run.evidenceContext.snapshotFingerprint,
      contextFingerprint: run.evidenceContext.contextFingerprint,
      eventCount: events.length,
      eventSetFingerprint,
      bindingFingerprint,
      displayLabel,
      boundAt: now().toISOString(),
      events,
    });
  }

  function exactBindingRetry(
    existing: RunEvidenceBindingV1 | undefined,
    proposed: RunEvidenceBindingV1,
  ): RunEvidenceBindingV1 {
    if (!existing) return proposed;
    if (existing.bindingFingerprint !== proposed.bindingFingerprint) {
      throw new Error("Run evidence binding collision.");
    }
    return existing;
  }

  return {
    async createRunWithEvidenceContext(input) {
      const request = RunEvidenceRequestV1Schema.parse(input.evidenceRequest);
      const active = [...runs.values()].find((run) =>
        run.workspaceId === input.workspaceId
        && run.mode === input.mode
        && run.windowDays === input.windowDays
        && (run.status === "queued" || run.status === "running")
      );
      if (active) {
        const same = active.evidenceContext.state === "current"
          && active.evidenceContext.evidenceMode === request.evidenceMode
          && (
            request.evidenceMode === "live"
            || active.evidenceContext.snapshotId === request.snapshotId
          );
        if (!same) {
          throw new ActiveRunEvidenceContextConflictError();
        }
        return structuredClone(active);
      }
      const context = await resolveEvidenceContext(input);
      const run = makeRun(input, now(), context);
      runs.set(run.id, run);
      return structuredClone(run);
    },
    async bindPinnedRunMarketEvents(workspaceId, runId) {
      const run = runs.get(runId);
      if (!run || run.workspaceId !== workspaceId) throw new Error(`Run ${runId} was not found.`);
      if (run.evidenceContext.state !== "current" || run.evidenceContext.evidenceMode !== "pinned") {
        throw new Error("Pinned event binding requires a pinned run.");
      }
      const snapshot = await options.getEvidenceSnapshot?.(
        workspaceId,
        run.evidenceContext.snapshotId!,
      );
      if (!snapshot || snapshot.snapshotFingerprint !== run.evidenceContext.snapshotFingerprint) {
        throw new Error("The pinned run snapshot was not found.");
      }
      const proposed = createBinding(run, snapshot.events, snapshot.displayLabel);
      const stored = exactBindingRetry(evidenceBindings.get(bindingKey(workspaceId, runId)), proposed);
      evidenceBindings.set(bindingKey(workspaceId, runId), stored);
      return structuredClone(stored);
    },
    async bindLiveRunMarketEvents(workspaceId, runId, eventsInput) {
      const run = runs.get(runId);
      if (!run || run.workspaceId !== workspaceId) throw new Error(`Run ${runId} was not found.`);
      if (run.evidenceContext.state !== "current" || run.evidenceContext.evidenceMode !== "live") {
        throw new Error("Live event binding requires a live run.");
      }
      const context = run.evidenceContext;
      const events = eventsInput.map((event) =>
        WritableMarketEventV2Schema.parse(event)
      );
      if (new Set(events.map(({ id }) => id)).size !== events.length) {
        throw new Error("Live event IDs must be unique.");
      }
      for (const event of events) {
        if (!withinPublicationWindow({
          publishedAt: event.publishedAt,
          publishedAtPrecision: event.publishedAtPrecision,
        }, {
          windowStartAt: context.windowStartAt,
          windowEndAt: context.windowEndAt,
          windowTimezone: context.windowTimezone,
        })) throw new Error(`Live event ${event.id} was not found in the run window.`);
      }
      const proposed = createBinding(
        run,
        events,
        `Live evidence window ending ${run.evidenceContext.windowEndAt}`,
      );
      const stored = exactBindingRetry(evidenceBindings.get(bindingKey(workspaceId, runId)), proposed);
      evidenceBindings.set(bindingKey(workspaceId, runId), stored);
      return structuredClone(stored);
    },
    async getRunEvidenceBinding(workspaceId, runId) {
      const binding = evidenceBindings.get(bindingKey(workspaceId, runId));
      return binding ? structuredClone(binding) : null;
    },
    async findActiveRun(input) {
      return [...runs.values()].find((run) =>
        run.workspaceId === input.workspaceId
        && run.mode === input.mode
        && run.windowDays === input.windowDays
        && (run.status === "queued" || run.status === "running")
      ) ?? null;
    },
    async insertRun(input) {
      const run = makeRun(input, now());
      runs.set(run.id, run);
      return structuredClone(run);
    },
    async claimNextRun(workerId) {
      const claimedAt = now();
      for (const candidate of runs.values()) {
        if (
          candidate.status === "running"
          && candidate.leaseExpiresAt
          && new Date(candidate.leaseExpiresAt).getTime() <= claimedAt.getTime()
        ) {
          candidate.status = "queued";
          candidate.workerId = null;
          candidate.startedAt = null;
          candidate.leaseExpiresAt = null;
        }
      }
      const run = [...runs.values()]
        .filter((candidate) => candidate.status === "queued")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!run) return null;
      run.status = "running";
      run.workerId = workerId;
      run.startedAt = claimedAt.toISOString();
      run.leaseExpiresAt = new Date(claimedAt.getTime() + leaseDurationMs).toISOString();
      return structuredClone(run);
    },
    async renewRunLease(workspaceId, runId, workerId) {
      const run = runs.get(runId);
      if (
        !run
        || run.workspaceId !== workspaceId
        || run.status !== "running"
        || run.workerId !== workerId
      ) return false;
      run.leaseExpiresAt = new Date(now().getTime() + leaseDurationMs).toISOString();
      return true;
    },
    async updateRun(workspaceId, runId, patch) {
      assertRunIdentityIsImmutable(patch);
      const run = runs.get(runId);
      if (!run || run.workspaceId !== workspaceId) {
        throw new Error(`Run ${runId} was not found`);
      }
      const next = { ...run, ...structuredClone(patch) };
      runs.set(runId, next);
      return structuredClone(next);
    },
    async getRun(workspaceId, runId) {
      const run = runs.get(runId);
      return run && run.workspaceId === workspaceId
        ? structuredClone(run)
        : null;
    },
    async listRuns(workspaceId, resetAt = null) {
      return [...runs.values()]
        .filter((run) =>
          run.workspaceId === workspaceId
          && (
            resetAt === null
            || new Date(run.createdAt).getTime() > new Date(resetAt).getTime()
          )
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((run) => structuredClone(run));
    },
    async insertRunStage(input) {
      const run = runs.get(input.runId);
      if (!run || run.workspaceId !== input.workspaceId) {
        throw new Error(`Run ${input.runId} was not found`);
      }
      const stage = { ...structuredClone(input), id: crypto.randomUUID() };
      stages.push(stage);
      return structuredClone(stage);
    },
    async touchWorkerHeartbeat(workerId) {
      workerHeartbeats.set(workerId, now().toISOString());
    },
    async isWorkerHealthy(maxAgeMs) {
      const latest = [...workerHeartbeats.values()]
        .map((heartbeat) => new Date(heartbeat).getTime())
        .sort((left, right) => right - left)[0];
      return latest !== undefined && now().getTime() - latest <= maxAgeMs;
    },
  };
}

interface SupabaseOptions {
  url: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}

function toRunRecord(row: Record<string, unknown>): RunRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    mode: row.mode as RunMode,
    windowDays: 14,
    status: row.status as RunStatus,
    currentStage: row.current_stage ? String(row.current_stage) : null,
    warningCount: Number(row.warning_count ?? 0),
    warnings: Array.isArray(row.warnings) ? row.warnings.map(String) : [],
    workerId: row.worker_id ? String(row.worker_id) : null,
    createdAt: String(row.created_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    leaseExpiresAt: row.lease_expires_at ? String(row.lease_expires_at) : null,
    evidenceContext: parseRunEvidenceContextRow(row),
  };
}

export function createSupabaseDataClient(options: SupabaseOptions): DataClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = `${options.url.replace(/\/$/, "")}/rest/v1`;
  const headers = {
    apikey: options.serviceRoleKey,
    authorization: `Bearer ${options.serviceRoleKey}`,
    "content-type": "application/json",
  };

  async function request(path: string, init: RequestInit = {}) {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        ...init,
        headers: { ...headers, ...(init.headers ?? {}) },
        cache: "no-store",
      });
    } catch {
      throw new IntegrationTransportError({ retryable: true });
    }
    if (!response.ok) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (
        payload
        && typeof payload === "object"
        && !Array.isArray(payload)
        && "code" in payload
        && payload.code === "55006"
        && "message" in payload
        && payload.message === ACTIVE_RUN_EVIDENCE_CONTEXT_CONFLICT
      ) {
        throw new ActiveRunEvidenceContextConflictError();
      }
      throw new IntegrationTransportError({
        retryable: isRetryableTransportStatus(response.status),
        status: response.status,
      });
    }
    if (response.status === 204) return null;
    const body = await response.text();
    return body.trim() ? JSON.parse(body) : null;
  }

  async function toBinding(
    row: Record<string, unknown>,
  ): Promise<RunEvidenceBindingV1> {
    const workspaceId = String(row.workspace_id);
    const runId = String(row.run_id);
    const eventRows = await request(
      `/run_market_events?workspace_id=eq.${encodeURIComponent(workspaceId)}`
      + `&run_id=eq.${encodeURIComponent(runId)}&select=payload&order=ordinal.asc`,
    ) as Array<{ payload: unknown }>;
    return RunEvidenceBindingV1Schema.parse({
      schemaVersion: row.schema_version,
      workspaceId,
      runId,
      evidenceMode: row.evidence_mode,
      windowDays: row.window_days,
      anchorAt: row.anchor_at,
      windowStartAt: row.window_start_at,
      windowEndAt: row.window_end_at,
      windowTimezone: row.window_timezone,
      snapshotId: row.snapshot_id ?? null,
      snapshotFingerprint: row.snapshot_fingerprint ?? null,
      contextFingerprint: row.evidence_context_fingerprint,
      eventCount: row.event_count,
      eventSetFingerprint: row.event_set_fingerprint,
      bindingFingerprint: row.binding_fingerprint,
      displayLabel: row.display_label,
      boundAt: row.bound_at,
      events: eventRows.map(({ payload }) => payload),
    });
  }

  return {
    async createRunWithEvidenceContext(input) {
      const evidenceRequest = RunEvidenceRequestV1Schema.parse(input.evidenceRequest);
      const rows = await request("/rpc/create_scan_run_with_evidence_context", {
        method: "POST",
        body: JSON.stringify({
          p_request: {
            workspaceId: input.workspaceId,
            mode: input.mode,
            windowDays: input.windowDays,
            evidenceRequest,
          },
        }),
      }) as Record<string, unknown>[];
      if (!rows[0]) throw new Error("Run creation returned no row.");
      return toRunRecord(rows[0]);
    },
    async bindPinnedRunMarketEvents(workspaceId, runId) {
      const rows = await request("/rpc/bind_pinned_run_market_events", {
        method: "POST",
        body: JSON.stringify({ p_workspace_id: workspaceId, p_run_id: runId }),
      }) as Record<string, unknown>[];
      if (!rows[0]) throw new Error("Pinned event binding returned no row.");
      return toBinding(rows[0]);
    },
    async bindLiveRunMarketEvents(workspaceId, runId, events) {
      const parsedEvents = events.map((event) =>
        WritableMarketEventV2Schema.parse(event)
      );
      const rows = await request("/rpc/bind_live_run_market_events", {
        method: "POST",
        body: JSON.stringify({
          p_workspace_id: workspaceId,
          p_run_id: runId,
          p_event_ids: parsedEvents.map(({ id }) => id),
        }),
      }) as Record<string, unknown>[];
      if (!rows[0]) throw new Error("Live event binding returned no row.");
      const binding = await toBinding(rows[0]);
      const expectedById = new Map(parsedEvents.map((event) => [event.id, event]));
      if (
        binding.events.length !== parsedEvents.length
        || binding.events.some((event) =>
          canonicalEvidenceJson(event)
            !== canonicalEvidenceJson(expectedById.get(event.id))
        )
      ) {
        throw new Error("The sealed live binding does not equal the submitted event set.");
      }
      return binding;
    },
    async getRunEvidenceBinding(workspaceId, runId) {
      const rows = await request(
        `/run_evidence_bindings?workspace_id=eq.${encodeURIComponent(workspaceId)}`
        + `&run_id=eq.${encodeURIComponent(runId)}&select=*&limit=1`,
      ) as Record<string, unknown>[];
      return rows[0] ? toBinding(rows[0]) : null;
    },
    async findActiveRun(input) {
      const params = new URLSearchParams({
        workspace_id: `eq.${input.workspaceId}`,
        mode: `eq.${input.mode}`,
        window_days: `eq.${input.windowDays}`,
        status: "in.(queued,running)",
        order: "created_at.asc",
        limit: "1",
      });
      const rows = await request(`/scan_runs?${params}`) as Record<string, unknown>[];
      return rows[0] ? toRunRecord(rows[0]) : null;
    },
    async insertRun(input) {
      const rows = await request("/scan_runs", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          workspace_id: input.workspaceId,
          mode: input.mode,
          window_days: input.windowDays,
        }),
      }) as Record<string, unknown>[];
      return toRunRecord(rows[0]);
    },
    async claimNextRun(workerId) {
      const rows = await request("/rpc/claim_next_scan_run", {
        method: "POST",
        body: JSON.stringify({ worker_name: workerId }),
      }) as Record<string, unknown>[];
      return rows[0] ? toRunRecord(rows[0]) : null;
    },
    async renewRunLease(workspaceId, runId, workerId) {
      const rows = await request(
        `/scan_runs?workspace_id=eq.${encodeURIComponent(workspaceId)}`
        + `&id=eq.${encodeURIComponent(runId)}`
        + `&worker_id=eq.${encodeURIComponent(workerId)}&status=eq.running`,
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            lease_expires_at: new Date(Date.now() + DEFAULT_LEASE_DURATION_MS).toISOString(),
          }),
        },
      ) as Record<string, unknown>[];
      return rows.length > 0;
    },
    async updateRun(workspaceId, runId, patch) {
      assertRunIdentityIsImmutable(patch);
      const body: Record<string, unknown> = {};
      if (patch.status !== undefined) body.status = patch.status;
      if (patch.currentStage !== undefined) body.current_stage = patch.currentStage;
      if (patch.warningCount !== undefined) body.warning_count = patch.warningCount;
      if (patch.warnings !== undefined) body.warnings = patch.warnings;
      if (patch.workerId !== undefined) body.worker_id = patch.workerId;
      if (patch.startedAt !== undefined) body.started_at = patch.startedAt;
      if (patch.completedAt !== undefined) body.completed_at = patch.completedAt;
      if (patch.leaseExpiresAt !== undefined) body.lease_expires_at = patch.leaseExpiresAt;
      const rows = await request(
        `/scan_runs?workspace_id=eq.${encodeURIComponent(workspaceId)}`
        + `&id=eq.${encodeURIComponent(runId)}`,
        {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(body),
        },
      ) as Record<string, unknown>[];
      if (!rows[0]) throw new Error(`Run ${runId} was not found`);
      return toRunRecord(rows[0]);
    },
    async getRun(workspaceId, runId) {
      const rows = await request(
        `/scan_runs?workspace_id=eq.${encodeURIComponent(workspaceId)}`
        + `&id=eq.${encodeURIComponent(runId)}&limit=1`,
      ) as Record<string, unknown>[];
      return rows[0] ? toRunRecord(rows[0]) : null;
    },
    async listRuns(workspaceId, resetAt = null) {
      const resetFilter = resetAt === null
        ? ""
        : `&created_at=gt.${encodeURIComponent(resetAt)}`;
      const rows = await request(
        `/scan_runs?workspace_id=eq.${encodeURIComponent(workspaceId)}`
        + `${resetFilter}&order=created_at.desc`,
      ) as Record<string, unknown>[];
      return rows.map(toRunRecord);
    },
    async insertRunStage(input) {
      const rows = await request("/scan_run_steps", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          workspace_id: input.workspaceId,
          run_id: input.runId,
          stage: input.stage,
          status: input.status,
          warning: input.warning,
          started_at: input.startedAt,
          completed_at: input.completedAt,
        }),
      }) as Record<string, unknown>[];
      const row = rows[0];
      return {
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        runId: String(row.run_id),
        stage: String(row.stage),
        status: row.status as StageStatus,
        warning: row.warning ? String(row.warning) : null,
        startedAt: String(row.started_at),
        completedAt: row.completed_at ? String(row.completed_at) : null,
      };
    },
    async touchWorkerHeartbeat(workerId) {
      await request("/worker_heartbeats?on_conflict=worker_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          worker_id: workerId,
          last_seen_at: new Date().toISOString(),
        }),
      });
    },
    async isWorkerHealthy(maxAgeMs) {
      const rows = await request("/worker_heartbeats?select=last_seen_at&order=last_seen_at.desc&limit=1") as Record<string, unknown>[];
      if (!rows[0]?.last_seen_at) return false;
      return Date.now() - new Date(String(rows[0].last_seen_at)).getTime() <= maxAgeMs;
    },
  };
}

let singleton: DataClient | undefined;

export function getDataClient(): DataClient {
  if (singleton) return singleton;
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  singleton = url && serviceRoleKey
    ? createSupabaseDataClient({ url, serviceRoleKey })
    : createMemoryDataClient();
  return singleton;
}
