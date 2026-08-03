import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { makeDisposableDatabaseName, requireLoopbackPostgres } from "../helpers/require-loopback-postgres";

const migrationName = "0017_public_sandbox_test_generations";
const migrationPath = fileURLToPath(
  new URL(`../../drizzle/${migrationName}.sql`, import.meta.url),
);
const journalPath = fileURLToPath(
  new URL("../../drizzle/meta/_journal.json", import.meta.url),
);
const postgresSafety = requireLoopbackPostgres();
const postgresAvailable = postgresSafety.state === "verified" ? spawnSync(
  "psql",
  [
    "-d",
    "postgres",
    "-Atqc",
    "select (rolsuper or rolcreatedb)::text from pg_roles where rolname = current_user",
  ],
  { encoding: "utf8" },
) : { status: null, stdout: "" };
const canCreateTemporaryDatabase =
  postgresAvailable.status === 0
  && postgresAvailable.stdout.trim() === "true"
  && spawnSync("createdb", ["--version"]).status === 0
  && spawnSync("dropdb", ["--version"]).status === 0;
const requirePostgres = process.env.REQUIRE_POSTGRES_MIGRATION_TESTS === "1";

function sqlScalar(database: string, sql: string): string {
  return execFileSync(
    "psql",
    ["-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-d", database, "-c", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

test("journals the public sandbox generation migration after 0016", () => {
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
  const entries = journal.entries.filter(({ tag }) => tag === migrationName);
  assert.deepEqual(entries, [{
    idx: 17,
    version: "7",
    when: 1785398400000,
    tag: migrationName,
    breakpoints: true,
  }]);
  const prior = journal.entries.find(
    ({ tag }) => tag === "0016_confirmed_upload_source_evidence_bridge",
  );
  assert.ok(prior);
  assert.ok(prior.idx < entries[0]!.idx);
  assert.ok(prior.when < entries[0]!.when);
});

test(
  "0017 advances only the reset marker and refuses active scans",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    const database = makeDisposableDatabaseName("reset");
    execFileSync("createdb", [database], { stdio: "pipe" });
    try {
      execFileSync("psql", [
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        database,
        "-c",
        `
          do $$
          begin
            create role anon nologin noinherit;
          exception when duplicate_object then null;
          end;
          $$;
          do $$
          begin
            create role authenticated nologin noinherit;
          exception when duplicate_object then null;
          end;
          $$;
          do $$
          begin
            create role service_role nologin noinherit bypassrls;
          exception when duplicate_object then null;
          end;
          $$;
        `,
      ], { stdio: "pipe" });
      for (const migration of [
        "0000_vsee_postgres.sql",
        "0001_remove_report_delivery.sql",
        "0002_durable_decision_lineage.sql",
        "0003_sanitize_report_next_steps.sql",
        "0004_company_analyses.sql",
        "0005_sample_decision_label.sql",
        "0006_reasoner_judgments.sql",
        "0007_uploaded_documents.sql",
        "0008_workspace_composite_identity.sql",
        "0009_source_revision_deal_registry.sql",
        "0010_underwriting_references.sql",
        "0011_underwriting_runs.sql",
        "0012_source_grounded_underwriting.sql",
        "0013_confirmed_upload_ingest.sql",
        "0014_read_api_action_drafts.sql",
        "0015_framework_catalog_checkpoint.sql",
        "0016_confirmed_upload_source_evidence_bridge.sql",
        `${migrationName}.sql`,
      ]) {
        execFileSync("psql", [
          "-v",
          "ON_ERROR_STOP=1",
          "-d",
          database,
          "-f",
          fileURLToPath(new URL(`../../drizzle/${migration}`, import.meta.url)),
        ], { stdio: "pipe" });
      }

      execFileSync("psql", [
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        database,
        "-f",
        "-",
      ], {
        stdio: ["pipe", "pipe", "pipe"],
        input: `
          insert into public.workspaces (id, name)
          values ('workspace_reset', 'Reset workspace');
          insert into public.scan_runs (
            id, workspace_id, mode, status, window_days, created_at
          ) values (
            '11111111-1111-4111-8111-111111111111',
            'workspace_reset', 'structured', 'completed', 14,
            '2026-07-29T12:00:00.000Z'
          );
          insert into public.market_events (
            workspace_id, id, published_at, payload, created_at
          ) values (
            'workspace_reset', 'event_old',
            '2026-07-29T12:00:00.000Z', '{}',
            '2026-07-29T12:00:00.000Z'
          );
          insert into public.intelligence_reports (
            id, workspace_id, run_id, created_at, market_summary, opportunities
          ) values (
            'report_old', 'workspace_reset',
            '11111111-1111-4111-8111-111111111111',
            '2026-07-29T12:00:00.000Z', 'Old report', '[]'
          );
          insert into public.fund_policy_versions (
            id, workspace_id, version, source, values, created_at
          ) values (
            'fund_reset', 'workspace_reset', 1, 'recommended_policy', '{}',
            '2026-07-29T12:00:00.000Z'
          );
          insert into public.underwriting_batches (
            id, workspace_id, scan_run_id, status, batch_input_fingerprint,
            fund_policy_snapshot_id, force_refresh, created_at
          ) values (
            'batch_reset', 'workspace_reset',
            '11111111-1111-4111-8111-111111111111', 'completed',
            'sha256:${"1".repeat(64)}', 'fund_reset', false,
            '2026-07-29T12:00:00.000Z'
          );
          insert into public.companies (
            id, workspace_id, name
          ) values (
            'company_reset', 'workspace_reset', 'Reset Co'
          );
          insert into public.deals (
            id, workspace_id, company_id, company_name, status
          ) values (
            'deal_reset', 'workspace_reset', 'company_reset', 'Reset Co',
            'evaluating'
          );
          insert into public.candidate_runs (
            id, batch_id, workspace_id, deal_id, status,
            candidate_analysis_fingerprint, created_at, finalized_at
          ) values (
            'candidate_reset', 'batch_reset', 'workspace_reset', 'deal_reset',
            'completed', 'sha256:${"2".repeat(64)}',
            '2026-07-29T12:00:00.000Z', '2026-07-29T12:00:00.000Z'
          );
          insert into public.action_drafts (
            workspace_id, candidate_run_id, artifact_id, payload, created_at
          ) values (
            'workspace_reset', 'candidate_reset', 'draft_reset',
            '{"id":"draft_reset","workspaceId":"workspace_reset","candidateRunId":"candidate_reset","channel":"email","audienceType":"founder","body":"Preserve","createdAt":"2026-07-29T12:00:00.000Z","updatedAt":"2026-07-29T12:00:00.000Z"}',
            '2026-07-29T12:00:00.000Z'
          );
        `,
      });

      const resetResult = JSON.parse(sqlScalar(database, `
        select public.reset_test_view(
          'workspace_reset',
          'system:public-sandbox'
        )::text
      `)) as { reset: boolean; resetAt?: string };
      assert.equal(resetResult.reset, true);
      assert.ok(resetResult.resetAt);
      assert.equal(sqlScalar(database, `
        select count(*) from public.intelligence_reports
        where workspace_id = 'workspace_reset'
      `), "1");
      assert.equal(sqlScalar(database, `
        select count(*) from public.market_events
        where workspace_id = 'workspace_reset'
      `), "1");
      assert.equal(sqlScalar(database, `
        select count(*) from public.scan_runs
        where workspace_id = 'workspace_reset'
      `), "1");
      assert.equal(sqlScalar(database, `
        select count(*) from public.underwriting_batches
        where workspace_id = 'workspace_reset'
      `), "1");
      assert.equal(sqlScalar(database, `
        select count(*) from public.candidate_runs
        where workspace_id = 'workspace_reset'
      `), "1");
      assert.equal(sqlScalar(database, `
        select count(*) from public.action_drafts
        where workspace_id = 'workspace_reset'
      `), "1");
      assert.equal(sqlScalar(database, `
        select observed_at is not null from public.market_events
        where workspace_id = 'workspace_reset' and id = 'event_old'
      `), "t");

      const markerBeforeConflict = sqlScalar(database, `
        select public.canonical_utc_iso_milliseconds(reset_at)
        from public.workspace_test_generations
        where workspace_id = 'workspace_reset'
      `);
      sqlScalar(database, `
        insert into public.scan_runs (
          id, workspace_id, mode, status, window_days, created_at
        ) values (
          '22222222-2222-4222-8222-222222222222',
          'workspace_reset', 'xtrace', 'queued', 14, now()
        )
      `);
      const conflict = JSON.parse(sqlScalar(database, `
        select public.reset_test_view(
          'workspace_reset',
          'system:public-sandbox'
        )::text
      `));
      assert.deepEqual(conflict, { reset: false, reason: "active_scan" });
      assert.equal(sqlScalar(database, `
        select public.canonical_utc_iso_milliseconds(reset_at)
        from public.workspace_test_generations
        where workspace_id = 'workspace_reset'
      `), markerBeforeConflict);

      assert.equal(sqlScalar(database, `
        select has_function_privilege(
          'service_role',
          'public.reset_test_view(text,text)',
          'EXECUTE'
        )
      `), "t");
      assert.equal(sqlScalar(database, `
        select has_function_privilege(
          'anon',
          'public.reset_test_view(text,text)',
          'EXECUTE'
        )
      `), "f");
      assert.equal(sqlScalar(database, `
        select has_function_privilege(
          'authenticated',
          'public.reset_test_view(text,text)',
          'EXECUTE'
        )
      `), "f");
      assert.equal(sqlScalar(database, `
        select has_table_privilege(
          'service_role',
          'public.workspace_test_generations',
          'SELECT'
        )
      `), "t");
      assert.equal(sqlScalar(database, `
        select has_table_privilege(
          'service_role',
          'public.workspace_test_generations',
          'DELETE'
        )
      `), "f");
    } finally {
      execFileSync("dropdb", ["--if-exists", database], {
        stdio: "pipe",
      });
    }
  },
);
