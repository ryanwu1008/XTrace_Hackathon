import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { makeDisposableDatabaseName, requireLoopbackPostgres } from "../helpers/require-loopback-postgres";

const migrationName = "0014_read_api_action_drafts.sql";
const migrationPath = fileURLToPath(
  new URL(`../../drizzle/${migrationName}`, import.meta.url),
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

test("0014 action-draft operation is journaled after confirmed upload ingest", () => {
  assert.equal(existsSync(migrationPath), true);
  const migration = readFileSync(migrationPath, "utf8");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: Array<{ idx: number; tag: string; when: number }>;
  };
  const prior = journal.entries.find(({ tag }) =>
    tag === "0013_confirmed_upload_ingest"
  );
  const current = journal.entries.find(({ tag }) =>
    tag === "0014_read_api_action_drafts"
  );
  assert.ok(prior);
  assert.deepEqual(current, {
    idx: 14,
    version: "7",
    when: 1785376800000,
    tag: "0014_read_api_action_drafts",
    breakpoints: true,
  });
  assert.ok(prior.when < current.when);
  assert.match(
    migration,
    /security definer\s+set search_path = ''/i,
  );
  assert.match(
    migration,
    /revoke all privileges on table public\.action_drafts from service_role/i,
  );
  assert.match(
    migration,
    /grant select on table public\.action_drafts to service_role/i,
  );
  assert.match(
    migration,
    /grant execute on function\s+public\.replace_action_draft_body/i,
  );
  assert.doesNotMatch(
    migration,
    /grant\s+(?:update|insert|delete|all privileges)\s+on table public\.action_drafts to service_role/i,
  );
});

test(
  "0014 replaces only body and updatedAt while direct service-role DML stays denied",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    const database = makeDisposableDatabaseName("draft");
    postgresExec("createdb", [database], { stdio: "pipe" });
    try {
      postgresExec("psql", [
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        database,
        "-c",
        `
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
        migrationName,
      ]) {
        postgresExec("psql", [
          "-v",
          "ON_ERROR_STOP=1",
          "-d",
          database,
          "-f",
          fileURLToPath(new URL(`../../drizzle/${migration}`, import.meta.url)),
        ], { stdio: "pipe" });
      }
      const output = postgresExec("psql", [
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        database,
        "-X",
        "-A",
        "-t",
        "-q",
        "-F",
        "|",
        "-f",
        "-",
      ], {
        encoding: "utf8",
        input: `
          insert into public.workspaces (id, name)
          values ('workspace_draft', 'Draft');
          insert into public.scan_runs (
            id, workspace_id, mode, status, window_days, created_at
          ) values (
            '11111111-1111-4111-8111-111111111111',
            'workspace_draft', 'structured', 'completed', 14,
            '2026-07-29T12:00:00.000Z'
          );
          insert into public.fund_policy_versions (
            id, workspace_id, version, source, values, created_at
          ) values (
            'fund_draft', 'workspace_draft', 1, 'recommended_policy', '{}',
            '2026-07-29T12:00:00.000Z'
          );
          insert into public.underwriting_batches (
            id, workspace_id, scan_run_id, status, batch_input_fingerprint,
            fund_policy_snapshot_id, force_refresh, created_at
          ) values (
            'batch_draft', 'workspace_draft',
            '11111111-1111-4111-8111-111111111111', 'completed',
            'sha256:${"1".repeat(64)}', 'fund_draft', false,
            '2026-07-29T12:00:00.000Z'
          );
          insert into public.companies (
            id, workspace_id, name
          ) values (
            'company_draft', 'workspace_draft', 'Draft Co'
          );
          insert into public.deals (
            id, workspace_id, company_id, company_name, status
          ) values (
            'deal_draft', 'workspace_draft', 'company_draft', 'Draft Co',
            'evaluating'
          );
          insert into public.candidate_runs (
            id, batch_id, workspace_id, deal_id, status,
            candidate_analysis_fingerprint, created_at, finalized_at
          ) values (
            'candidate_draft', 'batch_draft', 'workspace_draft', 'deal_draft',
            'completed', 'sha256:${"2".repeat(64)}',
            '2026-07-29T12:00:00.000Z', '2026-07-29T12:00:00.000Z'
          );
          insert into public.action_drafts (
            workspace_id, candidate_run_id, artifact_id, payload, created_at
          ) values (
            'workspace_draft', 'candidate_draft', 'draft_1',
            '{"id":"draft_1","workspaceId":"workspace_draft","candidateRunId":"candidate_draft","channel":"email","audienceType":"founder","body":"Original","createdAt":"2026-07-29T12:00:00.000Z","updatedAt":"2026-07-29T12:00:00.000Z"}',
            '2026-07-29T12:00:00.000Z'
          );
          select (
            public.replace_action_draft_body(
              'workspace_draft', 'draft_1', 'Revised'
            ) ->> 'body'
          );
          select count(*)
          from public.action_drafts;
          select artifact_id, workspace_id, candidate_run_id,
                 created_at = '2026-07-29T12:00:00.000Z'::timestamptz,
                 payload->>'id', payload->>'workspaceId',
                 payload->>'candidateRunId', payload->>'channel',
                 payload->>'audienceType', payload->>'body',
                 payload->>'createdAt',
                 (
                   (payload->>'updatedAt')::timestamptz
                     > (payload->>'createdAt')::timestamptz
                 )
          from public.action_drafts
          where workspace_id = 'workspace_draft' and artifact_id = 'draft_1';
          set role service_role;
          select has_table_privilege(
            current_user, 'public.action_drafts', 'UPDATE'
          );
          select has_function_privilege(
            current_user,
            'public.replace_action_draft_body(text,text,text)',
            'EXECUTE'
          );
          reset role;
        `,
      });
      assert.deepEqual(output.trim().split("\n"), [
        "Revised",
        "1",
        "draft_1|workspace_draft|candidate_draft|t|draft_1|workspace_draft|candidate_draft|email|founder|Revised|2026-07-29T12:00:00.000Z|t",
        "f",
        "t",
      ]);
    } finally {
      postgresExec("dropdb", ["--if-exists", database], { stdio: "pipe" });
    }
  },
);
