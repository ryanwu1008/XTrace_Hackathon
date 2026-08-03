import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { makeDisposableDatabaseName, requireLoopbackPostgres } from "../helpers/require-loopback-postgres";

const migrationName = "0018_pgcrypto_registry_schema_usage";
const migrationPath = fileURLToPath(
  new URL(`../../drizzle/${migrationName}.sql`, import.meta.url),
);
const journalPath = fileURLToPath(
  new URL("../../drizzle/meta/_journal.json", import.meta.url),
);
const postgresSafety = requireLoopbackPostgres();
const postgresAvailable = postgresSafety.state === "verified" ? postgresSafety.run(
  "psql",
  [
    "-d",
    "postgres",
    "-Atqc",
    "select (rolsuper or rolcreatedb)::text from pg_roles where rolname = current_user",
  ],
) : { status: null, stdout: "" };
const canCreateTemporaryDatabase =
  postgresSafety.state === "verified"
  && postgresAvailable.status === 0
  && postgresAvailable.stdout.trim() === "true"
  && postgresSafety.run("createdb", ["--version"]).status === 0
  && postgresSafety.run("dropdb", ["--version"]).status === 0;
const requirePostgres = postgresSafety.state === "verified";

function postgresExec(
  command: "psql" | "createdb" | "dropdb",
  args: readonly string[],
  options: { input?: string; encoding?: "utf8"; stdio?: unknown } = {},
): string {
  assert.equal(postgresSafety.state, "verified");
  if (postgresSafety.state !== "verified") throw new Error("unreachable");
  return postgresSafety.exec(command, args, {
    ...(options.input === undefined ? {} : { input: options.input }),
  });
}

function sqlScalar(database: string, sql: string): string {
  return postgresExec(
    "psql",
    ["-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-d", database, "-c", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

function sqlScriptOutput(database: string, sql: string): string {
  return postgresExec(
    "psql",
    ["-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-d", database, "-f", "-"],
    { encoding: "utf8", input: sql, stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}

test("journals the pgcrypto registry schema usage migration after 0017", () => {
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
    idx: 18,
    version: "7",
    when: 1785402000000,
    tag: migrationName,
    breakpoints: true,
  }]);
  const prior = journal.entries.find(
    ({ tag }) => tag === "0017_public_sandbox_test_generations",
  );
  assert.ok(prior);
  assert.ok(prior.idx < entries[0]!.idx);
  assert.ok(prior.when < entries[0]!.when);
});

test(
  "0018 lets the registry-owned snapshot use pgcrypto while preserving API-role schema usage",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    const database = makeDisposableDatabaseName("pgcrypto_usage");
    postgresExec("createdb", [database], { stdio: "pipe" });
    try {
      postgresExec("psql", [
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        database,
        "-c",
        `
          create schema extensions;
          create extension pgcrypto with schema extensions;
          do $$
          begin
            create role anon nologin inherit;
          exception when duplicate_object then null;
          end;
          $$;
          do $$
          begin
            create role authenticated nologin inherit;
          exception when duplicate_object then null;
          end;
          $$;
          do $$
          begin
            create role service_role nologin inherit bypassrls;
          exception when duplicate_object then null;
          end;
          $$;
          grant usage on schema extensions to anon, authenticated, service_role;
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
        "0017_public_sandbox_test_generations.sql",
      ]) {
        postgresExec("psql", [
          "-X",
          "-v",
          "ON_ERROR_STOP=1",
          "-d",
          database,
          "-f",
          fileURLToPath(new URL(`../../drizzle/${migration}`, import.meta.url)),
        ], { stdio: "pipe" });
      }

      const apiRoleUsageBefore = sqlScalar(database, `
        select string_agg(
          has_schema_privilege(role_name, 'extensions', 'USAGE')::text,
          '|' order by role_name
        )
        from unnest(array['anon', 'authenticated', 'service_role'])
          as roles(role_name);
      `);
      assert.equal(apiRoleUsageBefore, "true|true|true");
      assert.equal(sqlScalar(database, `
        select has_schema_privilege(
          'vsee_registry_owner',
          'extensions',
          'USAGE'
        );
      `), "f");

      postgresExec("psql", [
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        database,
        "-f",
        migrationPath,
      ], { stdio: "pipe" });

      assert.equal(sqlScriptOutput(database, `
        set role service_role;
        select public.get_analysis_eligible_snapshot('workspace_empty')->>'count';
        reset role;
      `), "0");
      assert.equal(sqlScalar(database, `
        select
          has_schema_privilege('vsee_registry_owner', 'extensions', 'USAGE')
          and has_schema_privilege('anon', 'extensions', 'USAGE')
          and has_schema_privilege('authenticated', 'extensions', 'USAGE')
          and has_schema_privilege('service_role', 'extensions', 'USAGE');
      `), "t");
      assert.equal(sqlScalar(database, `
        select string_agg(
          has_schema_privilege(role_name, 'extensions', 'USAGE')::text,
          '|' order by role_name
        )
        from unnest(array['anon', 'authenticated', 'service_role'])
          as roles(role_name);
      `), apiRoleUsageBefore);
      assert.equal(sqlScalar(database, `
        select
          not has_function_privilege(
            'anon',
            'public.get_analysis_eligible_snapshot(text)',
            'EXECUTE'
          )
          and not has_function_privilege(
            'authenticated',
            'public.get_analysis_eligible_snapshot(text)',
            'EXECUTE'
          );
      `), "t");
    } finally {
      postgresExec("dropdb", ["--if-exists", database], {
        stdio: "pipe",
      });
    }
  },
);
