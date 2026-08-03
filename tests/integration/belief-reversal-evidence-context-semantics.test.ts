import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
import test from "node:test";

import {
  makeDisposableDatabaseName,
  requireLoopbackPostgres,
  type VerifiedLoopbackPostgresContext,
} from "../helpers/require-loopback-postgres";

const postgres = requireLoopbackPostgres();
const skip = postgres.state === "skipped" ? postgres.reason : false;
const database = makeDisposableDatabaseName("belief_semantics");
const workspaceId = "workspace_belief_semantics";
const currentRunId = "11111111-1111-4111-8111-111111111111";

function requireVerified(): VerifiedLoopbackPostgresContext {
  assert.equal(postgres.state, "verified");
  if (postgres.state !== "verified") throw new Error("PostgreSQL is not verified.");
  return postgres;
}

function requireSuccess(
  result: ReturnType<VerifiedLoopbackPostgresContext["run"]>,
  operation: string,
): string {
  assert.equal(result.status, 0, `${operation}: ${result.stderr}`);
  return result.stdout.trim();
}

function sql(command: string): ReturnType<VerifiedLoopbackPostgresContext["run"]> {
  return requireVerified().run("psql", [
    "--no-password",
    "-v",
    "ON_ERROR_STOP=1",
    "-d",
    database,
    "-c",
    command,
  ]);
}

function query(command: string): string {
  return requireSuccess(requireVerified().run("psql", [
    "--no-password",
    "-v",
    "ON_ERROR_STOP=1",
    "-At",
    "-d",
    database,
    "-c",
    command,
  ]), "semantic query");
}

function requireSqlFailure(command: string, expected: RegExp): void {
  const result = sql(command);
  assert.notEqual(result.status, 0, "the invalid SQL mutation unexpectedly committed");
  assert.match(result.stderr, expected);
}

test.before(() => {
  if (postgres.state !== "verified") return;
  requireSuccess(postgres.run("createdb", [database]), "semantic database creation");
  requireSuccess(sql("create extension if not exists pgcrypto"), "pgcrypto creation");
  requireSuccess(sql([
    "do $$ begin",
    "if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;",
    "if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;",
    "if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;",
    "end $$",
  ].join(" ")), "API-role setup");
  const migrations = readdirSync(
    fileURLToPath(new URL("../../drizzle/", import.meta.url)),
  ).filter((name) => /^\d{4}_.+\.sql$/u.test(name)).sort();
  for (const migration of migrations) {
    requireSuccess(postgres.run("psql", [
      "--no-password",
      "-v",
      "ON_ERROR_STOP=1",
      "-d",
      database,
      "-f",
      fileURLToPath(new URL(`../../drizzle/${migration}`, import.meta.url)),
    ]), `semantic migration ${migration}`);
  }
  requireSuccess(sql(
    [
      `insert into public.workspaces(id,name) values ('${workspaceId}','Belief semantics');`,
      "insert into public.scan_runs(",
      "id,workspace_id,mode,window_days,evidence_context_version,evidence_mode,",
      "evidence_anchor_at,evidence_window_start_at,evidence_window_end_at,",
      "evidence_window_timezone,evidence_context_fingerprint",
      `) values ('${currentRunId}','${workspaceId}','structured',14,`,
      "'run-evidence-context-v1','live','2026-08-02T12:00:00Z',",
      "'2026-07-19T12:00:00Z','2026-08-02T12:00:00Z','UTC',",
      `'sha256:${"1".repeat(64)}');`,
    ].join(" "),
  ), "semantic workspace setup");
});

test.after(() => {
  if (postgres.state !== "verified") return;
  requireSuccess(postgres.run("dropdb", ["--if-exists", database]), "semantic database cleanup");
});

test("service_role cannot execute the renamed legacy report writer", { skip }, () => {
  requireSqlFailure([
    "set role service_role;",
    "select * from public.save_intelligence_report_legacy_0019('{}'::jsonb,'[]'::jsonb);",
  ].join(" "), /permission denied for function save_intelligence_report_legacy_0019/iu);
});

test("a current run without a sealed binding cannot save a legacy-unbound report", { skip }, () => {
  const report = JSON.stringify({
    id: "report_current_without_binding",
    workspaceId,
    runId: currentRunId,
    createdAt: "2026-08-02T12:00:00.000Z",
    marketSummary: "No bound evidence",
    opportunities: [],
    analysisStatus: "completed",
    companyCount: 0,
    beliefRevisedCount: 0,
    monitorCount: 0,
    noMaterialChangeCount: 0,
    analysisUnavailableCount: 0,
    priorityDealId: null,
    evidenceCoverage: {},
    eligibleSnapshotCount: null,
    eligibleSnapshotFingerprint: null,
  });
  requireSqlFailure(
    `begin; select * from public.save_intelligence_report($json$${report}$json$::jsonb,'[]'::jsonb); rollback;`,
    /CURRENT_RUN_REQUIRES_EVIDENCE_BINDING/iu,
  );
});

test("run RPC accepts the exact current live request shape", { skip }, () => {
  const request = JSON.stringify({
    workspaceId,
    mode: "structured",
    windowDays: 14,
    evidenceRequest: {
      schemaVersion: "run-evidence-request-v1",
      evidenceMode: "live",
    },
  });
  assert.equal(
    query(
      `select id from public.create_scan_run_with_evidence_context($json$${request}$json$::jsonb)`,
    ),
    currentRunId,
  );
});

test("snapshot RPC rejects a minimal fake market-event-v2 payload", { skip }, () => {
  const request = JSON.stringify({
    schemaVersion: "market-evidence-snapshot-v1",
    workspaceId,
    id: "snapshot_minimal_fake",
    snapshotAsOfDate: "2026-08-02",
    windowDays: 14,
    anchorAt: "2026-08-02T12:00:00.000Z",
    windowStartAt: "2026-07-19T12:00:00.000Z",
    windowEndAt: "2026-08-02T12:00:00.000Z",
    windowTimezone: "UTC",
    events: [{
      schemaVersion: "market-event-v2",
      adaptation: "canonical",
      id: "event_minimal_fake",
      contentFingerprint: `sha256:${"a".repeat(64)}`,
      publishedAt: "2026-08-01T12:00:00.000Z",
      publishedAtPrecision: "timestamp",
    }],
  });
  requireSqlFailure(
    `begin; select * from public.create_market_evidence_snapshot($json$${request}$json$::jsonb); rollback;`,
    /INVALID_MARKET_EVENT_V2/iu,
  );
});

test("run RPC rejects caller-owned extra fields before active-run reuse", { skip }, () => {
  const request = JSON.stringify({
    workspaceId,
    mode: "structured",
    windowDays: 14,
    evidenceRequest: {
      schemaVersion: "run-evidence-request-v1",
      evidenceMode: "live",
    },
    status: "completed",
  });
  requireSqlFailure(
    `select * from public.create_scan_run_with_evidence_context($json$${request}$json$::jsonb)`,
    /INVALID_RUN_EVIDENCE_REQUEST/iu,
  );
});

test("snapshot parent validation is deferred and rejects a missing child set", { skip }, () => {
  requireSqlFailure([
    "begin;",
    "insert into public.market_evidence_snapshots(",
    "workspace_id,id,schema_version,snapshot_as_of_date,window_days,anchor_at,",
    "window_start_at,window_end_at,window_timezone,display_label,event_count,snapshot_fingerprint",
    ") values (",
    `'${workspaceId}','snapshot_missing_children','market-evidence-snapshot-v1','2026-08-02',14,`,
    "'2026-08-02T12:00:00Z','2026-07-19T12:00:00Z','2026-08-02T12:00:00Z','UTC',",
    `'Demo evidence snapshot as of 2026-08-02',1,'sha256:${"a".repeat(64)}');`,
    "set constraints all immediate; rollback;",
  ].join(" "), /INVALID_MARKET_EVIDENCE_SNAPSHOT/iu);
});

test("run-binding parent validation is deferred and rejects a missing child set", { skip }, () => {
  requireSqlFailure([
    "begin;",
    "insert into public.run_evidence_bindings(",
    "workspace_id,run_id,schema_version,evidence_context_version,evidence_mode,window_days,",
    "anchor_at,window_start_at,window_end_at,window_timezone,snapshot_id,snapshot_fingerprint,",
    "evidence_context_fingerprint,display_label,event_count,event_set_fingerprint,binding_fingerprint",
    ") select workspace_id,id,'run-evidence-binding-v1',evidence_context_version,evidence_mode,window_days,",
    "evidence_anchor_at,evidence_window_start_at,evidence_window_end_at,evidence_window_timezone,null,null,",
    `evidence_context_fingerprint,'Missing events',1,'sha256:${"b".repeat(64)}','sha256:${"c".repeat(64)}' `,
    `from public.scan_runs where workspace_id='${workspaceId}' and id='${currentRunId}';`,
    "set constraints all immediate; rollback;",
  ].join(" "), /INVALID_RUN_EVIDENCE_BINDING/iu);
});
