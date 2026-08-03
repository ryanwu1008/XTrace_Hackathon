import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  makeDisposableDatabaseName,
  requireLoopbackPostgres,
  type VerifiedLoopbackPostgresContext,
} from "../helpers/require-loopback-postgres";

const migrationPath = fileURLToPath(new URL(
  "../../drizzle/0021_exact_xtrace_lineage.sql",
  import.meta.url,
));
const journalPath = fileURLToPath(new URL("../../drizzle/meta/_journal.json", import.meta.url));
const postgres = requireLoopbackPostgres();

function success(
  result: ReturnType<VerifiedLoopbackPostgresContext["run"]>,
  operation: string,
): string {
  assert.equal(result.status, 0, `${operation} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function failure(
  result: ReturnType<VerifiedLoopbackPostgresContext["run"]>,
  operation: string,
  pattern: RegExp,
): void {
  assert.notEqual(result.status, 0, `${operation} unexpectedly succeeded`);
  assert.match(result.stderr, pattern);
}

test("0021 is contiguous local-only while production authorization remains through 0019", () => {
  assert.equal(existsSync(migrationPath), true);
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  assert.equal(journal.entries.at(-1)?.idx, 21);
  assert.equal(journal.entries.at(-1)?.tag, "0021_exact_xtrace_lineage");
  const launcher = readFileSync(fileURLToPath(new URL(
    "../../scripts/apply-production-migrations.zsh",
    import.meta.url,
  )), "utf8");
  assert.match(launcher, /through 0019/u);
  assert.doesNotMatch(launcher, /0021_exact_xtrace_lineage/u);
});

test(
  "0021 enforces reserve-before-submit immutable exact lineage on PostgreSQL 17",
  { skip: postgres.state === "skipped" ? postgres.reason : false },
  () => {
    assert.equal(postgres.state, "verified");
    if (postgres.state !== "verified") return;
    const database = makeDisposableDatabaseName("xtrace_v2");
    success(postgres.run("createdb", [database]), "database creation");
    try {
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", "create extension if not exists pgcrypto",
      ]), "pgcrypto creation");
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", [
          "do $$ begin",
          "if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;",
          "if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;",
          "if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;",
          "end $$",
        ].join(" "),
      ]), "API roles");
      const directory = fileURLToPath(new URL("../../drizzle/", import.meta.url));
      const migrations = readdirSync(directory)
        .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
        .sort();
      assert.equal(migrations.length, 22);
      for (const migration of migrations) {
        success(postgres.run("psql", [
          "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
          "-f", fileURLToPath(new URL(`../../drizzle/${migration}`, import.meta.url)),
        ]), `migration ${migration.slice(0, 4)}`);
      }
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", [
          "insert into public.workspaces(id,name) values ('workspace_x','X')",
          "insert into public.companies(id,workspace_id,name) values ('company_x','workspace_x','X Co')",
          "insert into public.deals(id,workspace_id,company_id,company_name,status,analysis_eligible_at,active_source_revision_fingerprint) values ('deal_x','workspace_x','company_x','X Co','passed',now(),public.source_revision_set_fingerprint(array['revision_x']))",
          "insert into public.source_documents(id,filename,title,role,company_name,deal_id,checksum,byte_size,object_key) values ('source_x','x.json','X source','public_web_snapshot','X Co','deal_x','x',1,'private/x')",
          "insert into public.source_revisions(id,workspace_id,source_id,revision,content_hash,object_key,object_version,content_type,extractor_id,extractor_version,extracted_at,created_at) values ('revision_x','workspace_x','source_x',1,'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','private/x','1','application/json','test','1',now(),now())",
          "insert into public.deal_source_assignments(id,request_id,request_fingerprint,workspace_id,deal_id,source_id,source_revision_id,assigned_by_user_id,reason,created_at) values ('assignment_x','request_x','sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','workspace_x','deal_x','source_x','revision_x','user_x','test',now())",
          "insert into public.scan_runs(id,workspace_id,mode,status) values ('00000000-0000-4000-8000-000000000001','workspace_x','xtrace','completed')",
        ].join("; "),
      ]), "fixture setup");

      const intent = {
        intentId: `xtrace_intent_${"1".repeat(64)}`,
        workspaceId: "workspace_x",
        dealId: "deal_x",
        parentKind: "canonical_source_revision",
        sourceId: "source_x",
        sourceRevisionId: "revision_x",
        parentFingerprint: `sha256:${"a".repeat(64)}`,
        payloadFingerprint: `sha256:${"c".repeat(64)}`,
        serializerVersion: "xtrace-parent-v2",
      };
      const reserveSql = `set role service_role; select public.reserve_xtrace_ingest_intent_v2($json$${JSON.stringify(intent)}$json$::jsonb)`;
      const first = JSON.parse(success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", reserveSql,
      ]), "first reserve").split("\n").at(-1) ?? "null") as {
        action: string;
        intent: { intentId: string; leaseToken: string };
      };
      assert.equal(first.action, "submit");
      const second = JSON.parse(success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", reserveSql,
      ]), "concurrent reserve").split("\n").at(-1) ?? "null") as { action: string };
      assert.equal(second.action, "wait");

      failure(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", "set role service_role; update public.xtrace_ingest_intents_v2 set state='succeeded'",
      ]), "direct intent mutation", /RPC-only|permission denied/iu);

      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", [
          "set role service_role",
          `select public.attach_xtrace_ingest_job_v2('${first.intent.intentId}','${first.intent.leaseToken}','job_x')`,
          `select public.advance_xtrace_ingest_intent_v2('${first.intent.intentId}','job_x','succeeded',array['memory_x'])`,
        ].join("; "),
      ]), "attach and finalize");
      const reused = JSON.parse(success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", reserveSql,
      ]), "succeeded reuse").split("\n").at(-1) ?? "null") as { action: string };
      assert.equal(reused.action, "reuse");

      failure(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", `set role service_role; select public.reserve_xtrace_ingest_intent_v2($json$${JSON.stringify({ ...intent, payloadFingerprint: `sha256:${"d".repeat(64)}` })}$json$::jsonb)`,
      ]), "changed payload collision", /different immutable payload/iu);

      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", [
          "insert into public.source_documents(id,filename,title,role,company_name,deal_id,checksum,byte_size,object_key) values ('source_y','y.json','Y source','public_web_snapshot','X Co','deal_x','y',1,'private/y')",
          "insert into public.source_revisions(id,workspace_id,source_id,revision,content_hash,object_key,object_version,content_type,extractor_id,extractor_version,extracted_at,created_at) values ('revision_y','workspace_x','source_y',1,'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff','private/y','1','application/json','test','1',now(),now())",
          "insert into public.deal_source_assignments(id,request_id,request_fingerprint,workspace_id,deal_id,source_id,source_revision_id,assigned_by_user_id,reason,created_at) values ('assignment_y','request_y','sha256:9999999999999999999999999999999999999999999999999999999999999999','workspace_x','deal_x','source_y','revision_y','user_x','test',now())",
        ].join("; "),
      ]), "second parent setup");
      const secondIntent = {
        ...intent,
        intentId: `xtrace_intent_${"2".repeat(64)}`,
        sourceId: "source_y",
        sourceRevisionId: "revision_y",
        parentFingerprint: `sha256:${"f".repeat(64)}`,
        payloadFingerprint: `sha256:${"9".repeat(64)}`,
      };
      const secondReserve = JSON.parse(success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", `set role service_role; select public.reserve_xtrace_ingest_intent_v2($json$${JSON.stringify(secondIntent)}$json$::jsonb)`,
      ]), "second parent reserve").split("\n").at(-1) ?? "null") as {
        intent: { intentId: string; leaseToken: string };
      };
      failure(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", `set role service_role; select public.attach_xtrace_ingest_job_v2('${secondReserve.intent.intentId}','${secondReserve.intent.leaseToken}','job_x')`,
      ]), "provider job collision", /different exact intent/iu);
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", `set role service_role; select public.attach_xtrace_ingest_job_v2('${secondReserve.intent.intentId}','${secondReserve.intent.leaseToken}','job_y')`,
      ]), "second provider job attach");
      failure(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", `set role service_role; select public.advance_xtrace_ingest_intent_v2('${secondReserve.intent.intentId}','job_y','succeeded',array['memory_x'])`,
      ]), "memory child collision", /different exact parent/iu);

      const audit = {
        workspaceId: "workspace_x",
        runId: "00000000-0000-4000-8000-000000000001",
        dealId: "deal_x",
        evidenceContextFingerprint: `sha256:${"3".repeat(64)}`,
        activeParentFingerprint: `sha256:${"4".repeat(64)}`,
        queryFingerprint: "5".repeat(64),
        memoryIds: ["memory_x"],
      };
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", `set role service_role; select public.record_xtrace_recall_audit_v2($json$${JSON.stringify(audit)}$json$::jsonb)`,
      ]), "authoritative recall audit");
      failure(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", "set role service_role; update public.xtrace_recall_audits_v2 set deal_id='other'",
      ]), "direct recall-audit mutation", /RPC-only|permission denied/iu);
      const resolved = success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", `set role service_role; select count(*) from public.resolve_xtrace_memory_v2('workspace_x','memory_x','deal_x','sha256:${"e".repeat(64)}')`,
      ]), "active exact-parent resolution").split("\n").at(-1);
      assert.equal(resolved, "1");
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", "update public.deal_source_assignments set superseded_at=now() where id='assignment_x'",
      ]), "parent supersession");
      const stale = success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", `set role service_role; select count(*) from public.resolve_xtrace_memory_v2('workspace_x','memory_x','deal_x','sha256:${"e".repeat(64)}')`,
      ]), "stale exact-parent resolution").split("\n").at(-1);
      assert.equal(stale, "0");
    } finally {
      success(postgres.run("dropdb", ["--if-exists", database]), "database cleanup");
    }
  },
);
