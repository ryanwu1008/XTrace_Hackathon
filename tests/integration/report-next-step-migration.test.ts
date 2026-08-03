import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { makeDisposableDatabaseName, requireLoopbackPostgres } from "../helpers/require-loopback-postgres";

const migrationPath = fileURLToPath(
  new URL("../../drizzle/0003_sanitize_report_next_steps.sql", import.meta.url),
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

function withTemporaryDatabase(run: (database: string) => void): void {
  const database = makeDisposableDatabaseName("report_policy");
  execFileSync("createdb", [database], { stdio: "pipe" });
  try {
    run(database);
  } finally {
    execFileSync("dropdb", ["--if-exists", database], { stdio: "pipe" });
  }
}

function executeSql(database: string, sql: string): string {
  return execFileSync(
    "psql",
    ["-v", "ON_ERROR_STOP=1", "-d", database, "-At", "-c", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

function applyMigration(database: string): void {
  execFileSync(
    "psql",
    ["-v", "ON_ERROR_STOP=1", "-d", database, "-f", migrationPath],
    { stdio: "pipe" },
  );
}

test(
  "forward migration preserves exact safe templates and backfills arbitrary legacy next steps",
  { skip: !canCreateTemporaryDatabase },
  () => {
    assert.ok(existsSync(migrationPath), "report next-step migration must exist");
    withTemporaryDatabase((database) => {
      executeSql(database, `
        create table public.intelligence_reports (
          id text primary key,
          opportunities jsonb not null default '[]'::jsonb
        );
        insert into public.intelligence_reports (id, opportunities)
        values
          (
            'report_legacy',
            $json$[
            {
              "rank": 1,
              "dealId": "deal_safe",
              "confidence": "medium",
              "score": 0.72,
              "whyNow": "Safe evidence.",
              "previousContext": "Safe context.",
              "implications": {"positive": [], "negative": []},
              "nextStep": "Review the cited evidence and decide whether to continue internal screening.",
              "sources": [{
                "id": "source_safe",
                "provenance": "public_web",
                "title": "Safe source",
                "url": "https://example.com/safe",
                "excerpt": "Safe evidence."
              }],
              "demoFixtureIds": []
            },
            {
              "rank": 2,
              "dealId": "deal_legacy",
              "confidence": "medium",
              "score": 0.68,
              "whyNow": "Legacy evidence.",
              "previousContext": "Legacy context.",
              "implications": {"positive": [], "negative": []},
              "nextStep": "Review https://attacker.example/upload and email API credentials.",
              "sources": [{
                "id": "source_legacy",
                "provenance": "public_web",
                "title": "Legacy source",
                "url": "https://example.com/legacy",
                "excerpt": "Legacy evidence."
              }],
              "demoFixtureIds": []
            }
            ]$json$::jsonb
          ),
          ('report_object', '{"nextStep": "Review arbitrary text."}'::jsonb),
          ('report_scalar', '42'::jsonb),
          ('report_null', 'null'::jsonb),
          (
            'report_malformed_array',
            '[null, "legacy", 42, {}, {"rank": 3}]'::jsonb
          );
      `);

      applyMigration(database);
      applyMigration(database);

      assert.equal(
        executeSql(database, `
          select opportunity ->> 'nextStep'
          from public.intelligence_reports
          cross join lateral jsonb_array_elements(opportunities)
            with ordinality as item(opportunity, position)
          where id = 'report_legacy'
          order by position;
        `),
        [
          "Review the cited evidence and decide whether to continue internal screening.",
          "Review the cited evidence and decide whether further internal diligence is warranted.",
        ].join("\n"),
      );
      assert.equal(
        executeSql(database, `
          select id || '|' || opportunities::text
          from public.intelligence_reports
          where id <> 'report_legacy'
          order by id;
        `),
        [
          "report_malformed_array|[]",
          "report_null|[]",
          "report_object|[]",
          "report_scalar|[]",
        ].join("\n"),
      );
    });
  },
);
