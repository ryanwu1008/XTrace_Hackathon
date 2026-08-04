import assert from "node:assert/strict";
import test from "node:test";

import {
  CreateMarketEvidenceSnapshotRequestV1Schema,
  CurrentRunEvidenceContextV1Schema,
  parseRunEvidenceContextRow,
  parseReportEvidenceContextRow,
} from "../../lib/contracts/evidence-context";
import {
  createMemoryMarketEvidenceSnapshotsRepository,
  createSupabaseMarketEvidenceSnapshotsRepository,
} from "../../db/repositories/market-evidence-snapshots";
import { withinPublicationWindow } from "../../lib/market/dedupe";
import type { WritableMarketEventV2 } from "../../lib/contracts/source-evidence";
import { exactSourceV2, marketEventV2 } from "../helpers/source-evidence-v2";

const ANCHOR = "2026-08-02T06:59:59.999Z";
const START = "2026-07-19T07:00:00.000Z";

function event(id: string, publishedAt = "2026-07-29T18:00:00.000Z"): WritableMarketEventV2 {
  const source = exactSourceV2(`source_${id}`, {
    canonicalUrl: `https://example.com/${id}`,
    publishedAt,
    publishedAtPrecision: publishedAt.length === 10 ? "date" : "timestamp",
    retrievedAt: "2026-08-01T12:00:00.000Z",
    sourceRevisionId: `revision_${id}`,
    entityKeys: [id],
  });
  return marketEventV2(source, {
    id,
    title: `Event ${id}`,
    publishedAt,
    publishedAtPrecision: publishedAt.length === 10 ? "date" : "timestamp",
    canonicalUrl: `https://example.com/${id}`,
    entityKeys: [id],
  }) as WritableMarketEventV2;
}

function request(events = [event("event_b"), event("event_a")]) {
  return {
    schemaVersion: "market-evidence-snapshot-v1" as const,
    workspaceId: "workspace_demo",
    id: "snapshot_2026_08_01",
    snapshotAsOfDate: "2026-08-01",
    windowDays: 14 as const,
    anchorAt: ANCHOR,
    windowStartAt: START,
    windowEndAt: ANCHOR,
    windowTimezone: "America/Los_Angeles",
    events,
  };
}

test("snapshot request rejects database-owned fields and noncanonical evidence before persistence", () => {
  for (const extra of [
    { displayLabel: "forged" },
    { eventCount: 1 },
    { snapshotFingerprint: `sha256:${"a".repeat(64)}` },
    { createdAt: ANCHOR },
    { ordinal: 0 },
  ]) {
    assert.equal(CreateMarketEvidenceSnapshotRequestV1Schema.safeParse({
      ...request(),
      ...extra,
    }).success, false);
  }

  assert.equal(CreateMarketEvidenceSnapshotRequestV1Schema.safeParse({
    ...request(),
    events: [{ ...event("event_a"), adaptation: "legacy_read" }],
  }).success, false);
  assert.equal(CreateMarketEvidenceSnapshotRequestV1Schema.safeParse({
    ...request(),
    events: [event("event_a"), event("event_a")],
  }).success, false);
});

test("report evidence parsing rejects a current run paired with an all-null or mismatched report", () => {
  const run = parseRunEvidenceContextRow({
    evidence_context_version: "run-evidence-context-v1",
    evidence_mode: "live",
    evidence_anchor_at: ANCHOR,
    evidence_window_start_at: START,
    evidence_window_end_at: ANCHOR,
    evidence_window_timezone: "America/Los_Angeles",
    evidence_snapshot_id: null,
    evidence_snapshot_fingerprint: null,
    evidence_context_fingerprint: `sha256:${"a".repeat(64)}`,
  });
  assert.throws(
    () => parseReportEvidenceContextRow({}, run),
    /current run.*legacy report/i,
  );
  const reportRow = {
    evidence_context_version: "run-evidence-context-v1",
    evidence_mode: "live",
    evidence_window_days: 14,
    evidence_anchor_at: ANCHOR,
    evidence_window_start_at: START,
    evidence_window_end_at: ANCHOR,
    evidence_window_timezone: "America/Los_Angeles",
    evidence_snapshot_id: null,
    evidence_snapshot_fingerprint: null,
    evidence_context_fingerprint: `sha256:${"a".repeat(64)}`,
    evidence_display_label: "Live evidence window",
    evidence_event_count: 0,
    evidence_event_set_fingerprint: `sha256:${"b".repeat(64)}`,
    evidence_binding_fingerprint: `sha256:${"c".repeat(64)}`,
  };
  const parsed = parseReportEvidenceContextRow(reportRow, run);
  assert.equal(parsed.state, "current");
  assert.throws(
    () => parseReportEvidenceContextRow({
      ...reportRow,
      evidence_context_fingerprint: `sha256:${"d".repeat(64)}`,
    }, run),
    /report.*run evidence context/i,
  );
});

test("database evidence timestamps normalize to canonical UTC ISO milliseconds", () => {
  const run = parseRunEvidenceContextRow({
    evidence_context_version: "run-evidence-context-v1",
    evidence_mode: "pinned",
    evidence_anchor_at: "2026-08-02T06:59:59+00:00",
    evidence_window_start_at: "2026-07-19T07:00:00+00:00",
    evidence_window_end_at: "2026-08-02T06:59:59+00:00",
    evidence_window_timezone: "America/Los_Angeles",
    evidence_snapshot_id: "belief_reversal_2026_08_01",
    evidence_snapshot_fingerprint: `sha256:${"1".repeat(64)}`,
    evidence_context_fingerprint: `sha256:${"2".repeat(64)}`,
  });
  assert.equal(run.state, "current");
  if (run.state !== "current") throw new Error("Expected current evidence context.");
  assert.equal(run.anchorAt, "2026-08-02T06:59:59.000Z");
  assert.equal(run.windowStartAt, "2026-07-19T07:00:00.000Z");
  assert.equal(run.windowEndAt, "2026-08-02T06:59:59.000Z");
});

test("snapshot request rejects malformed windows, timezone, empty sets, and out-of-window events", () => {
  const invalid = [
    { windowTimezone: "PST" },
    { snapshotAsOfDate: "2026-02-30" },
    { windowStartAt: ANCHOR, windowEndAt: START },
    { events: [] },
    { events: [event("too_old", "2026-07-18T23:59:59.999-07:00")] },
  ];
  for (const change of invalid) {
    assert.equal(CreateMarketEvidenceSnapshotRequestV1Schema.safeParse({
      ...request(),
      ...change,
    }).success, false);
  }
});

test("snapshot identity is order-independent, workspace isolated, and immutable", async () => {
  const repository = createMemoryMarketEvidenceSnapshotsRepository({
    now: () => new Date("2026-08-02T07:00:00.000Z"),
  });
  const first = await repository.create(request());
  const reordered = await repository.create(request([...request().events].reverse()));

  assert.deepEqual(reordered, first);
  assert.deepEqual(first.events.map(({ id }) => id), ["event_a", "event_b"]);
  assert.equal(first.displayLabel, "Demo evidence snapshot as of 2026-08-01");
  assert.equal(first.eventCount, 2);
  assert.match(first.snapshotFingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    await repository.get("workspace_other", first.id),
    null,
  );
  await assert.rejects(
    repository.create({ ...request(), anchorAt: "2026-08-02T06:59:59.998Z" }),
    /snapshot.*collision/i,
  );
});

test("Supabase snapshot reads reconstruct canonical parent and ordered child rows", async () => {
  const input = CreateMarketEvidenceSnapshotRequestV1Schema.parse(request());
  const parent = {
    workspace_id: input.workspaceId,
    id: input.id,
    schema_version: input.schemaVersion,
    snapshot_as_of_date: input.snapshotAsOfDate,
    window_days: input.windowDays,
    anchor_at: input.anchorAt,
    window_start_at: input.windowStartAt,
    window_end_at: input.windowEndAt,
    window_timezone: input.windowTimezone,
    display_label: "Demo evidence snapshot as of 2026-08-01",
    event_count: input.events.length,
    snapshot_fingerprint: `sha256:${"a".repeat(64)}`,
    created_at: "2026-08-02T07:00:00.000Z",
  };
  const childRows = input.events.map((payload) => ({ payload }));
  const paths: string[] = [];
  const repository = createSupabaseMarketEvidenceSnapshotsRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "service-role",
    fetchImpl: async (url, init) => {
      paths.push(`${init?.method ?? "GET"} ${String(url)}`);
      if (String(url).includes("/rpc/create_market_evidence_snapshot")) {
        return new Response(JSON.stringify([parent]), { status: 200 });
      }
      if (String(url).includes("/market_evidence_snapshot_events?")) {
        return new Response(JSON.stringify(childRows), { status: 200 });
      }
      if (String(url).includes("/market_evidence_snapshots?")) {
        return new Response(JSON.stringify([parent]), { status: 200 });
      }
      throw new Error(`Unexpected request: ${String(url)}`);
    },
  });

  const created = await repository.create(request());
  assert.deepEqual(created.events.map(({ id }) => id), ["event_a", "event_b"]);
  assert.equal(created.snapshotFingerprint, parent.snapshot_fingerprint);
  const loaded = await repository.get(input.workspaceId, input.id);
  assert.deepEqual(loaded, created);
  assert.equal(
    paths.filter((path) => path.includes("market_evidence_snapshot_events")).length,
    2,
  );
});

test("typed publication windows preserve inclusive instants and whole local calendar days", () => {
  const window = {
    windowStartAt: "2026-03-08T08:00:00.000Z",
    windowEndAt: "2026-03-09T06:59:59.999Z",
    windowTimezone: "America/Los_Angeles",
  };
  assert.equal(withinPublicationWindow({ publishedAt: window.windowStartAt, publishedAtPrecision: "timestamp" }, window), true);
  assert.equal(withinPublicationWindow({ publishedAt: window.windowEndAt, publishedAtPrecision: "timestamp" }, window), true);
  assert.equal(withinPublicationWindow({ publishedAt: "2026-03-08T07:59:59.999Z", publishedAtPrecision: "timestamp" }, window), false);
  assert.equal(withinPublicationWindow({ publishedAt: "2026-03-09T07:00:00.000Z", publishedAtPrecision: "timestamp" }, window), false);
  assert.equal(withinPublicationWindow({ publishedAt: "2026-03-08", publishedAtPrecision: "date" }, window), true);
  assert.equal(withinPublicationWindow({ publishedAt: "2026-03-07", publishedAtPrecision: "date" }, window), false);
  assert.equal(withinPublicationWindow({ publishedAt: "2026-03-08T00:00:00.000-08:00", publishedAtPrecision: "timestamp" }, window), true);

  const fallWindow = {
    windowStartAt: "2026-11-01T07:00:00.000Z",
    windowEndAt: "2026-11-02T07:59:59.999Z",
    windowTimezone: "America/Los_Angeles",
  };
  assert.equal(withinPublicationWindow({ publishedAt: "2026-11-01", publishedAtPrecision: "date" }, fallWindow), true);
  assert.equal(withinPublicationWindow({ publishedAt: "2026-11-02", publishedAtPrecision: "date" }, fallWindow), false);
});

test("run evidence parsing distinguishes all-null legacy from complete current context", () => {
  assert.deepEqual(parseRunEvidenceContextRow({}), { state: "legacy_unbound" });

  const current = {
    evidence_context_version: "run-evidence-context-v1",
    evidence_mode: "live",
    evidence_anchor_at: ANCHOR,
    evidence_window_start_at: START,
    evidence_window_end_at: ANCHOR,
    evidence_window_timezone: "America/Los_Angeles",
    evidence_snapshot_id: null,
    evidence_snapshot_fingerprint: null,
    evidence_context_fingerprint: `sha256:${"a".repeat(64)}`,
  };
  assert.equal(CurrentRunEvidenceContextV1Schema.parse(parseRunEvidenceContextRow(current)).state, "current");
  assert.throws(
    () => parseRunEvidenceContextRow({ ...current, evidence_mode: null }),
    /partial.*evidence context/i,
  );
  assert.throws(
    () => parseRunEvidenceContextRow({ ...current, evidence_snapshot_id: "snapshot" }),
    /evidence context/i,
  );
});
