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

function requireFailure(
  result: ReturnType<VerifiedLoopbackPostgresContext["run"]>,
  operation: string,
  message: RegExp,
): void {
  assert.notEqual(result.status, 0, `${operation} unexpectedly succeeded`);
  assert.match(result.stderr, message, `${operation} failed for the wrong reason`);
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
  const entryIndex = journal.entries.findIndex(({ idx }) => idx === 20);
  assert.deepEqual(journal.entries[entryIndex], {
    idx: 20,
    version: "7",
    when: 1785751200000,
    tag: "0020_belief_reversal_demo_seed",
    breakpoints: true,
  });
  assert.equal(journal.entries[entryIndex - 1]?.idx, 19);
  assert.equal(journal.entries[entryIndex + 1]?.idx, 21);
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
      assert.equal(migrations.length, 22);
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
          "and exists (select 1 from pg_trigger where tgname='protect_sample_decision_document_0020' and not tgisinternal)",
          "and has_function_privilege('service_role', 'public.save_sample_decision_interaction(jsonb)', 'execute')",
          "and not has_function_privilege('anon', 'public.save_sample_decision_interaction(jsonb)', 'execute')",
          "and not has_function_privilege('authenticated', 'public.save_sample_decision_interaction(jsonb)', 'execute')",
        ].join(" "),
      ]), "0020 sentinel");
      assert.equal(sentinel, "t");

      requireSuccess(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", [
          "insert into public.workspaces(id,name) values ('workspace_sample','Sample workspace')",
          "insert into public.source_documents(id,filename,title,role,company_name,deal_id,checksum,byte_size,object_key) values ('document_sample','sample.json','Sample decision record','sample_decision_record','Sample Co','deal_sample','sample-checksum',1,'private/sample.json'), ('document_normal','normal.json','Normal source','reference','Sample Co','deal_sample','normal-checksum',1,'private/normal.json')",
          "insert into public.companies(id,workspace_id,name) values ('company_sample','workspace_sample','Sample Co')",
          "insert into public.deals(id,workspace_id,company_id,company_name,status) values ('deal_sample','workspace_sample','company_sample','Sample Co','passed')",
          "insert into public.source_revisions(id,workspace_id,source_id,revision,content_hash,object_key,object_version,content_type,extractor_id,extractor_version,extracted_at,created_at) values ('revision_sample','workspace_sample','document_sample',1,'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','private/sample.json','sample-v1','application/json','test','1','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z'), ('revision_normal','workspace_sample','document_normal',1,'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','private/normal.json','normal-v1','application/json','test','1','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z')",
          "insert into public.deal_source_assignments(id,request_id,request_fingerprint,workspace_id,deal_id,source_id,source_revision_id,assigned_by_user_id,reason,created_at) values ('assignment_sample','request_sample','sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','workspace_sample','deal_sample','document_sample','revision_sample','user_sample','test','2026-08-01T00:00:00Z'), ('assignment_normal','request_normal','sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd','workspace_sample','deal_sample','document_normal','revision_normal','user_sample','test','2026-08-01T00:00:00Z')",
          "grant insert,update,delete on public.deal_interactions to service_role",
          "grant update(role) on public.source_documents to service_role",
          "grant update(role) on public.source_documents to vsee_registry_owner",
        ].join("; "),
      ]), "Sample interaction fixture setup");

      const directVersionedInsert = [
        "insert into public.deal_interactions(",
        "id,workspace_id,document_id,source_revision_id,deal_id,company_name,occurred_at,provenance,label,status,decision_reason,concerns,revisit_conditions,meeting_summary,prior_actions,action_policy_version,interaction_schema_version",
        ") values ('interaction_direct','workspace_sample','document_normal','revision_normal','deal_sample','Sample Co','2026-01-01T00:00:00Z','demo_fixture','Sample decision record','passed','Direct reason','[]'::jsonb,'[]'::jsonb,'Direct summary','[\"deprioritize\"]'::jsonb,'belief-action-policy-v1','sample-decision-interaction-v1')",
      ].join(" ");
      requireFailure(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", `set role service_role; ${directVersionedInsert}`,
      ]), "direct service-role versioned INSERT", /RPC-only|versioned Sample/iu);
      requireFailure(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", `set role vsee_registry_owner; ${directVersionedInsert}`,
      ]), "owner versioned INSERT under a non-Sample parent", /sample_decision_record role/iu);

      const samplePayload = JSON.stringify({
        id: "interaction_sample",
        workspaceId: "workspace_sample",
        documentId: "document_sample",
        sourceRevisionId: "revision_sample",
        dealId: "deal_sample",
        companyName: "Sample Co",
        occurredAt: "2026-01-01T00:00:00.000Z",
        provenance: "demo_fixture",
        label: "Sample decision record",
        status: "passed",
        decisionReason: "Sample reason",
        concerns: ["Sample concern"],
        revisitConditions: ["Sample revisit"],
        meetingSummary: "Sample summary",
        priorActions: ["deprioritize"],
        actionPolicyVersion: "belief-action-policy-v1",
        interactionSchemaVersion: "sample-decision-interaction-v1",
      });
      const saveSample = [
        "set role service_role",
        `select public.save_sample_decision_interaction($sample$${samplePayload}$sample$::jsonb)`,
      ];
      const firstSave = requireSuccess(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", saveSample.join("; "),
      ]), "first Sample RPC save").split("\n").at(-1);
      const retrySave = requireSuccess(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", saveSample.join("; "),
      ]), "idempotent Sample RPC retry").split("\n").at(-1);
      assert.deepEqual(JSON.parse(firstSave ?? "null"), {
        id: "interaction_sample",
        created: true,
      });
      assert.deepEqual(JSON.parse(retrySave ?? "null"), {
        id: "interaction_sample",
        created: false,
      });

      requireFailure(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", "set role service_role; update public.source_documents set role='reference' where id='document_sample'",
      ]), "direct service-role Sample parent role flip", /RPC-only|immutable/iu);
      requireSuccess(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", "set role vsee_registry_owner; update public.source_documents set role='reference' where id='document_sample'",
      ]), "trusted Sample parent role-drift simulation");
      requireFailure(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", "set role service_role; update public.deal_interactions set decision_reason='mutated' where workspace_id='workspace_sample' and id='interaction_sample'",
      ]), "direct service-role UPDATE after parent role flip", /RPC-only|immutable/iu);
      requireFailure(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", "set role service_role; delete from public.deal_interactions where workspace_id='workspace_sample' and id='interaction_sample'",
      ]), "direct service-role DELETE after parent role flip", /RPC-only|immutable/iu);
    } finally {
      requireSuccess(postgres.run("dropdb", ["--if-exists", database]), "database cleanup");
    }
  },
);
