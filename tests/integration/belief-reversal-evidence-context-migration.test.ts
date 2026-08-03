import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  makeDisposableDatabaseName,
  requireLoopbackPostgres,
  type VerifiedLoopbackPostgresContext,
} from "../helpers/require-loopback-postgres";

const migrationName = "0019_belief_reversal_evidence_context";
const migrationPath = fileURLToPath(
  new URL(`../../drizzle/${migrationName}.sql`, import.meta.url),
);
const journalPath = fileURLToPath(
  new URL("../../drizzle/meta/_journal.json", import.meta.url),
);
const postgres = requireLoopbackPostgres();

function requireSuccess(
  result: ReturnType<VerifiedLoopbackPostgresContext["run"]>,
  operation: string,
): string {
  assert.equal(
    result.status,
    0,
    `${operation} failed inside the verified disposable PostgreSQL context: ${result.stderr}`,
  );
  return result.stdout.trim();
}

test("0019 evidence-context migration is the contiguous journal terminal", () => {
  assert.equal(existsSync(migrationPath), true);
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: Array<{
      idx: number;
      version: string;
      when: number;
      tag: string;
      breakpoints: boolean;
    }>;
  };
  assert.deepEqual(journal.entries.at(-1), {
    idx: 19,
    version: "7",
    when: 1785661200000,
    tag: migrationName,
    breakpoints: true,
  });
  assert.equal(journal.entries.at(-2)?.idx, 18);
  assert.equal(
    new Set(journal.entries.map(({ idx }) => idx)).size,
    journal.entries.length,
  );
});

test("0019 declares the immutable snapshot, binding, report, and reasoner boundaries", () => {
  const migration = readFileSync(migrationPath, "utf8");
  for (const required of [
    "market_evidence_snapshots",
    "market_evidence_snapshot_events",
    "run_evidence_bindings",
    "run_market_events",
    "create_market_evidence_snapshot",
    "create_scan_run_with_evidence_context",
    "bind_pinned_run_market_events",
    "bind_live_run_market_events",
    "save_reasoner_judgment_immutable",
  ]) {
    assert.match(migration, new RegExp(`\\b${required}\\b`, "u"));
  }
  assert.match(migration, /transaction isolation level read committed/iu);
  assert.match(migration, /active scans or upload leases remain; 0019 requires maintenance/iu);
  assert.match(migration, /do \$registry_owner_prepare\$/u);
  assert.match(
    migration,
    /grant vsee_registry_owner to %I with admin false, inherit true, set true/u,
  );
  assert.match(migration, /do \$registry_owner_finish\$/u);
  assert.match(migration, /grant create on schema public to vsee_registry_owner/u);
  assert.match(migration, /revoke create on schema public from vsee_registry_owner/u);
  assert.match(
    migration,
    /revoke vsee_registry_owner from %I granted by %I/u,
  );
  assert.match(migration, /do \$invariant_executor_grant\$/u);
  assert.match(
    migration,
    /grant execute on function public\.evidence_event_in_window_0019[\s\S]*to %I/u,
  );
  assert.match(
    migration,
    /revoke all on table[\s\S]*public\.reasoner_judgments from public, anon, authenticated, service_role/iu,
  );
});

test(
  "0019 reaches its complete sentinel only in a verified disposable loopback database",
  { skip: postgres.state === "skipped" ? postgres.reason : false },
  () => {
    assert.equal(postgres.state, "verified");
    if (postgres.state !== "verified") return;
    const database = makeDisposableDatabaseName("belief_context");
    requireSuccess(postgres.run("createdb", [database]), "database creation");
    try {
      requireSuccess(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", "create extension if not exists pgcrypto",
      ]), "pgcrypto creation");
      requireSuccess(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", [
          "do $$ begin",
          "if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;",
          "if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;",
          "if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;",
          "end $$",
        ].join(" "),
      ]), "API-role setup");
      const migrations = readdirSync(
        fileURLToPath(new URL("../../drizzle/", import.meta.url)),
      ).filter((name) => /^\d{4}_.+\.sql$/u.test(name)).sort();
      assert.equal(migrations.length, 20);
      for (const migration of migrations) {
        const prefix = migration.slice(0, 4);
        const path = fileURLToPath(
          new URL(`../../drizzle/${migration}`, import.meta.url),
        );
        requireSuccess(postgres.run("psql", [
          "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database, "-f", path,
        ]), `migration ${prefix}`);
      }
      const sentinel = requireSuccess(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", [
          "select",
          "to_regclass('public.market_evidence_snapshots') is not null",
          "and to_regclass('public.market_evidence_snapshot_events') is not null",
          "and to_regclass('public.run_evidence_bindings') is not null",
          "and to_regclass('public.run_market_events') is not null",
          "and to_regprocedure('public.create_market_evidence_snapshot(jsonb)') is not null",
          "and to_regprocedure('public.bind_pinned_run_market_events(text,uuid)') is not null",
          "and to_regprocedure('public.bind_live_run_market_events(text,uuid,text[])') is not null",
          "and to_regprocedure('public.save_reasoner_judgment_immutable(jsonb)') is not null",
        ].join(" "),
      ]), "0019 sentinel");
      assert.equal(sentinel, "t");
    } finally {
      requireSuccess(
        postgres.run("dropdb", ["--if-exists", database]),
        "database cleanup",
      );
    }
  },
);
