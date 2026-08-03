import { createHash } from "node:crypto";

import {
  CreateMarketEvidenceSnapshotRequestV1Schema,
  MarketEvidenceSnapshotV1Schema,
  type CreateMarketEvidenceSnapshotRequestV1,
  type MarketEvidenceSnapshotV1,
} from "../../lib/contracts/evidence-context";
import { canonicalEvidenceJson } from "../../lib/contracts/source-evidence";
import {
  IntegrationTransportError,
  isRetryableTransportStatus,
} from "../../lib/api/errors";

export interface MarketEvidenceSnapshotsRepository {
  create(
    request: CreateMarketEvidenceSnapshotRequestV1,
  ): Promise<MarketEvidenceSnapshotV1>;
  get(workspaceId: string, snapshotId: string): Promise<MarketEvidenceSnapshotV1 | null>;
}

function lengthFramedFingerprint(frames: readonly string[]): string {
  const hash = createHash("sha256");
  for (const frame of frames) {
    const bytes = Buffer.from(frame, "utf8");
    hash.update(String(bytes.length));
    hash.update(":");
    hash.update(bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}

function snapshotFingerprint(
  request: ReturnType<typeof CreateMarketEvidenceSnapshotRequestV1Schema.parse>,
): string {
  return lengthFramedFingerprint([
    "market-evidence-snapshot-v1",
    request.workspaceId,
    request.id,
    request.snapshotAsOfDate,
    `Demo evidence snapshot as of ${request.snapshotAsOfDate}`,
    String(request.windowDays),
    request.anchorAt,
    request.windowStartAt,
    request.windowEndAt,
    request.windowTimezone,
    ...request.events.map(canonicalEvidenceJson),
  ]);
}

export function createMemoryMarketEvidenceSnapshotsRepository(options: {
  now?: () => Date;
} = {}): MarketEvidenceSnapshotsRepository {
  const rows = new Map<string, MarketEvidenceSnapshotV1>();
  const now = options.now ?? (() => new Date());
  return {
    async create(input) {
      const request = CreateMarketEvidenceSnapshotRequestV1Schema.parse(input);
      const fingerprint = snapshotFingerprint(request);
      const key = `${request.workspaceId}\0${request.id}`;
      const existing = rows.get(key);
      if (existing) {
        if (existing.snapshotFingerprint !== fingerprint) {
          throw new Error("Market evidence snapshot identity collision.");
        }
        return structuredClone(existing);
      }
      const createdAt = now().toISOString();
      const snapshot = MarketEvidenceSnapshotV1Schema.parse({
        ...request,
        displayLabel: `Demo evidence snapshot as of ${request.snapshotAsOfDate}`,
        eventCount: request.events.length,
        snapshotFingerprint: fingerprint,
        createdAt,
      });
      rows.set(key, snapshot);
      return structuredClone(snapshot);
    },
    async get(workspaceId, snapshotId) {
      const value = rows.get(`${workspaceId}\0${snapshotId}`);
      return value ? structuredClone(value) : null;
    },
  };
}

export function createSupabaseMarketEvidenceSnapshotsRepository(options: {
  url: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}): MarketEvidenceSnapshotsRepository {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = `${options.url.replace(/\/$/u, "")}/rest/v1`;
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
      throw new IntegrationTransportError({
        retryable: isRetryableTransportStatus(response.status),
      });
    }
    const text = await response.text();
    return text.trim() ? JSON.parse(text) : null;
  }
  async function toSnapshot(
    row: Readonly<Record<string, unknown>>,
  ): Promise<MarketEvidenceSnapshotV1> {
    const workspaceId = String(row.workspace_id);
    const snapshotId = String(row.id);
    const eventRows = await request(
      `/market_evidence_snapshot_events?workspace_id=eq.${encodeURIComponent(workspaceId)}`
      + `&snapshot_id=eq.${encodeURIComponent(snapshotId)}`
      + "&select=payload&order=ordinal.asc",
    ) as Array<{ payload: unknown }>;
    return MarketEvidenceSnapshotV1Schema.parse({
      workspaceId,
      id: snapshotId,
      schemaVersion: row.schema_version,
      snapshotAsOfDate: row.snapshot_as_of_date,
      windowDays: row.window_days,
      anchorAt: row.anchor_at,
      windowStartAt: row.window_start_at,
      windowEndAt: row.window_end_at,
      windowTimezone: row.window_timezone,
      displayLabel: row.display_label,
      eventCount: row.event_count,
      snapshotFingerprint: row.snapshot_fingerprint,
      createdAt: row.created_at,
      events: eventRows.map(({ payload }) => payload),
    });
  }
  return {
    async create(input) {
      const parsed = CreateMarketEvidenceSnapshotRequestV1Schema.parse(input);
      const rows = await request("/rpc/create_market_evidence_snapshot", {
        method: "POST",
        body: JSON.stringify({ p_request: parsed }),
      }) as unknown;
      const row = (Array.isArray(rows) ? rows[0] : rows) as Record<string, unknown> | undefined;
      if (!row) throw new Error("Snapshot creation returned no row.");
      return toSnapshot(row);
    },
    async get(workspaceId, snapshotId) {
      const rows = await request(
        `/market_evidence_snapshots?workspace_id=eq.${encodeURIComponent(workspaceId)}`
        + `&id=eq.${encodeURIComponent(snapshotId)}&select=*&limit=1`,
      ) as unknown[];
      if (!rows[0]) return null;
      return toSnapshot(rows[0] as Record<string, unknown>);
    },
  };
}
