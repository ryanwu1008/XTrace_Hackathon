import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { makeDisposableDatabaseName, requireLoopbackPostgres } from "../helpers/require-loopback-postgres";

const migrationName = "0015_framework_catalog_checkpoint";
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

test("journals the forward framework catalog checkpoint migration after 0014", () => {
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
  const catalogEntries = journal.entries.filter(
    ({ tag }) => tag === migrationName,
  );
  assert.deepEqual(catalogEntries, [{
    idx: 15,
    version: "7",
    when: 1785391200000,
    tag: migrationName,
    breakpoints: true,
  }]);
  const prior = journal.entries.find(
    ({ tag }) => tag === "0014_read_api_action_drafts",
  );
  assert.ok(prior);
  assert.ok(prior.idx < catalogEntries[0]!.idx);
  assert.ok(prior.when < catalogEntries[0]!.when);
});

test(
  "0015 accepts a distinct framework catalog checkpoint stage",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    const database = makeDisposableDatabaseName("framework_catalog");
    postgresExec("createdb", [database], { stdio: "pipe" });
    try {
      postgresExec(
        "psql",
        [
          "-v",
          "ON_ERROR_STOP=1",
          "-d",
          database,
          "-c",
          `do $$
           begin
             create role service_role nologin noinherit bypassrls;
           exception when duplicate_object then null;
           end;
           $$;`,
        ],
        { stdio: "pipe" },
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
        "0011_underwriting_runs.sql",
        "0012_source_grounded_underwriting.sql",
        "0013_confirmed_upload_ingest.sql",
        "0014_read_api_action_drafts.sql",
        `${migrationName}.sql`,
      ];
      for (const migration of migrations) {
        postgresExec(
          "psql",
          [
            "-v",
            "ON_ERROR_STOP=1",
            "-d",
            database,
            "-f",
            fileURLToPath(
              new URL(`../../drizzle/${migration}`, import.meta.url),
            ),
          ],
          { stdio: "pipe" },
        );
      }
      const definition = postgresExec(
        "psql",
        [
          "-d",
          database,
          "-Atqc",
          `select pg_get_constraintdef(oid)
           from pg_constraint
           where connamespace = 'public'::regnamespace
             and conname = 'candidate_checkpoints_stage_check';`,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ).trim();
      assert.match(definition, /framework_catalog/);
      assert.match(definition, /framework_lenses/);
    } finally {
      postgresExec("dropdb", ["--if-exists", database], {
        stdio: "pipe",
      });
    }
  },
);
