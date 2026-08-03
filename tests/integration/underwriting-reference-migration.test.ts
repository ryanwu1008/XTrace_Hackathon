import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { makeDisposableDatabaseName, requireLoopbackPostgres } from "../helpers/require-loopback-postgres";

const migrationPath = fileURLToPath(
  new URL("../../drizzle/0010_underwriting_references.sql", import.meta.url),
);
const migrations = [
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
].map((filename) =>
  fileURLToPath(new URL(`../../drizzle/${filename}`, import.meta.url))
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

test("0010 declares the complete synthetic reference spine without named framework claims", () => {
  const migration = readFileSync(migrationPath, "utf8");
  for (const table of [
    "benchmark_packs",
    "benchmark_entries",
    "fund_policy_versions",
    "workspace_active_fund_policies",
    "underwriting_contexts",
    "critical_evidence_profiles",
    "valuation_method_policies",
    "decision_policies",
    "framework_sources",
    "framework_cards",
    "framework_packs",
    "framework_pack_cards",
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  }
  assert.match(migration, /Product-owned synthetic fixture/);
  assert.doesNotMatch(
    migration,
    /Peter Thiel|Sequoia|Hamilton Helmer|Bessemer|Damodaran|Carta|PitchBook|NVCA/i,
  );
  assert.match(
    migration,
    /revoke all privileges on table public\.framework_sources from service_role/i,
  );
});

test(
  "0010 installs immutable policy versions, four profiles, and eight synthetic cards",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    withTemporaryDatabase((database) => {
      executeSql(database, `
        do $$
        begin
          create role service_role nologin noinherit bypassrls;
        exception when duplicate_object then null;
        end;
        $$;
      `);
      for (const migration of migrations) applySql(database, migration);

      assert.equal(
        executeSql(database, `
          select
            (select count(*) from public.underwriting_contexts)
            || '|' ||
            (select count(*) from public.framework_cards
              where publication_status = 'published' and synthetic)
            || '|' ||
            (select count(*) from public.framework_cards
              where not synthetic or formal_decision_weight <> 0);
        `),
        "4|8|0",
      );
      assert.equal(
        executeSql(database, `
          select count(*)
          from pg_trigger
          where not tgisinternal
            and tgname in (
              'benchmark_packs_immutable',
              'benchmark_entries_immutable',
              'critical_evidence_profiles_immutable',
              'valuation_method_policies_immutable',
              'decision_policies_immutable',
              'framework_sources_immutable',
              'framework_cards_immutable',
              'framework_packs_immutable',
              'framework_pack_cards_immutable',
              'underwriting_contexts_immutable',
              'fund_policy_versions_immutable'
            );
        `),
        "11",
      );
      assert.throws(() =>
        executeSql(database, `
          update public.benchmark_packs
          set sample_notes = 'retroactively changed'
          where id = 'benchmark_pack_synthetic_us_software_v1';
        `)
      );
      assert.throws(() =>
        executeSql(database, `
          delete from public.underwriting_contexts
          where id = 'underwriting_context_seed_b2b_saas_v1';
        `)
      );
      assert.throws(() =>
        executeSql(database, `
          update public.framework_cards
          set approved_neutral_paraphrase = 'retroactively changed'
          where id = 'framework_card_synthetic_1_v1';
        `)
      );
      assert.throws(() =>
        executeSql(database, `
          delete from public.framework_pack_cards
          where framework_pack_id =
            'framework_pack_synthetic_universal_saas_ai_v1'
            and position = 1;
        `)
      );
      assert.throws(() =>
        executeSql(database, `
          update public.valuation_method_policies
          set methods = '[]'::jsonb
          where id = 'valuation_method_seed_b2b_saas_v1';
        `)
      );
      assert.throws(() =>
        executeSql(database, `
          delete from public.decision_policies
          where id = 'decision_policy_seed_b2b_saas_v1';
        `)
      );
      executeSql(database, `
        insert into public.framework_packs (
          id, version, title, synthetic, publication_status
        ) values (
          'framework_pack_synthetic_universal_saas_ai_v2',
          '2',
          'Synthetic v2 append-only fixture',
          true,
          'published'
        );
      `);
      assert.equal(
        executeSql(database, `
          select version
          from public.framework_packs
          where id = 'framework_pack_synthetic_universal_saas_ai_v2';
        `),
        "2",
      );

      executeSql(database, `
        insert into public.workspaces (id, name)
        values ('workspace_policy', 'Policy');
        select public.activate_fund_policy_version(jsonb_build_object(
          'workspaceId', 'workspace_policy',
          'actorId', null,
          'expectedActiveVersionId', null,
          'action', 'recommended'
        ));
      `);
      assert.equal(
        executeSql(database, `
          select version || '|' || source || '|'
            || (values ->> 'riskPreference')
          from public.fund_policy_versions
          where workspace_id = 'workspace_policy';
        `),
        "1|recommended_policy|balanced",
      );
      assert.throws(() =>
        executeSql(database, `
          update public.fund_policy_versions
          set values = jsonb_build_object('riskPreference', 'mutated')
          where workspace_id = 'workspace_policy';
        `)
      );
      assert.throws(() =>
        executeSql(database, `
          set role service_role;
          select private_body from public.framework_sources limit 1;
        `)
      );
    });
  },
);

function withTemporaryDatabase(run: (database: string) => void): void {
  const database = makeDisposableDatabaseName("underwriting_refs");
  postgresExec("createdb", [database], { stdio: "pipe" });
  try {
    run(database);
  } finally {
    postgresExec("dropdb", ["--if-exists", database], { stdio: "pipe" });
  }
}

function applySql(database: string, path: string): void {
  postgresExec(
    "psql",
    ["-v", "ON_ERROR_STOP=1", "-d", database, "-f", path],
    { stdio: "pipe" },
  );
}

function executeSql(database: string, sql: string): string {
  return postgresExec(
    "psql",
    ["-v", "ON_ERROR_STOP=1", "-d", database, "-AtF", "|", "-c", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}
