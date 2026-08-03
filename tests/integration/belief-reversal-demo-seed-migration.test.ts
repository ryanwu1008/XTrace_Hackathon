import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  makeDisposableDatabaseName,
  requireLoopbackPostgres,
  type VerifiedLoopbackPostgresContext,
} from "../helpers/require-loopback-postgres";

const migrationPath = fileURLToPath(
  new URL(
    "../../drizzle/0020_belief_reversal_demo_seed.sql",
    import.meta.url,
  ),
);
const journalPath = fileURLToPath(
  new URL("../../drizzle/meta/_journal.json", import.meta.url),
);
const postgres = requireLoopbackPostgres();

function requireSuccess(
  result: ReturnType<VerifiedLoopbackPostgresContext["run"]>,
  operation: string,
): string {
  assert.equal(result.status, 0, `${operation} failed: ${result.stderr}`);
  return result.stdout.trim();
}

test("0020 is a contiguous local migration without production launcher authorization", () => {
  assert.equal(
    existsSync(migrationPath),
    true,
    "Task 6 requires the contiguous 0020 durable seed migration",
  );
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  assert.deepEqual(journal.entries.at(-1), {
    idx: 20,
    version: "7",
    when: 1785751200000,
    tag: "0020_belief_reversal_demo_seed",
    breakpoints: true,
  });
  const packageJson = JSON.parse(readFileSync(
    fileURLToPath(new URL("../../package.json", import.meta.url)),
    "utf8",
  )) as { scripts: Record<string, string> };
  assert.match(
    packageJson.scripts["test:migrations"] ?? "",
    /belief-reversal-demo-seed-migration\.test\.ts/u,
  );
  assert.doesNotMatch(
    packageJson.scripts["test:migrations:production-pg176"] ?? "",
    /0020|belief-reversal-demo-seed/u,
  );
  const productionLauncher = readFileSync(
    fileURLToPath(new URL("../../scripts/apply-production-migrations.zsh", import.meta.url)),
    "utf8",
  );
  assert.doesNotMatch(productionLauncher, /0020_belief_reversal_demo_seed/u);
  assert.match(productionLauncher, /through 0019/u);
  const migration = readFileSync(migrationPath, "utf8");
  assert.match(migration, /old_document_role = 'sample_decision_record'/u);
  assert.match(migration, /new_document_role = 'sample_decision_record'/u);
});

test(
  "0020 installs the immutable Sample interaction boundary in disposable loopback PostgreSQL",
  { skip: postgres.state === "skipped" ? postgres.reason : false },
  () => {
    assert.equal(postgres.state, "verified");
    if (postgres.state !== "verified") return;
    const database = makeDisposableDatabaseName("belief_seed");
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
      const directory = fileURLToPath(new URL("../../drizzle/", import.meta.url));
      const migrations = readdirSync(directory)
        .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
        .sort();
      assert.equal(migrations.length, 21);
      for (const migration of migrations) {
        requireSuccess(postgres.run("psql", [
          "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
          "-f", fileURLToPath(new URL(`../../drizzle/${migration}`, import.meta.url)),
        ]), `migration ${migration.slice(0, 4)}`);
      }
      const sentinel = requireSuccess(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", [
          "select",
          "to_regprocedure('public.save_sample_decision_interaction(jsonb)') is not null",
          "and exists (select 1 from information_schema.columns where table_schema='public' and table_name='deal_interactions' and column_name='prior_actions')",
          "and exists (select 1 from pg_trigger where tgname='protect_sample_decision_interaction_0020' and not tgisinternal)",
          "and has_function_privilege('service_role', 'public.save_sample_decision_interaction(jsonb)', 'execute')",
          "and not has_function_privilege('anon', 'public.save_sample_decision_interaction(jsonb)', 'execute')",
          "and not has_function_privilege('authenticated', 'public.save_sample_decision_interaction(jsonb)', 'execute')",
        ].join(" "),
      ]), "0020 sentinel");
      assert.equal(sentinel, "t");
    } finally {
      requireSuccess(postgres.run("dropdb", ["--if-exists", database]), "database cleanup");
    }
  },
);
