import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
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

test("0021 remains contiguous before later local-only migrations while production stops before them", () => {
  assert.equal(existsSync(migrationPath), true);
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  const xtraceEntry = journal.entries.find(({ idx }) => idx === 21);
  assert.equal(xtraceEntry?.idx, 21);
  assert.equal(xtraceEntry?.tag, "0021_exact_xtrace_lineage");
  const finalizationEntry = journal.entries.find(({ idx }) => idx === 22);
  assert.equal(finalizationEntry?.tag, "0022_task9_finalization_authority");
  assert.equal(journal.entries.at(-1)?.idx, 30);
  assert.equal(
    journal.entries.at(-1)?.tag,
    "0030_xtrace_recall_audit_authority",
  );
  const launcher = readFileSync(fileURLToPath(new URL(
    "../../scripts/apply-production-migrations.zsh",
    import.meta.url,
  )), "utf8");
  assert.match(launcher, /through 0019/u);
  assert.doesNotMatch(launcher, /0021_exact_xtrace_lineage/u);
  assert.doesNotMatch(launcher, /0023_pg17_market_event_validator/u);
  assert.doesNotMatch(launcher, /0028_named_lens_authority_repair/u);
});

test(
  "0021-0030 apply under a hosted-Supabase-style CREATEROLE executor",
  { skip: postgres.state === "skipped" ? postgres.reason : false },
  () => {
    assert.equal(postgres.state, "verified");
    if (postgres.state !== "verified") return;
    const database = makeDisposableDatabaseName("hosted_supabase");
    const executorRole = `vsee_hosted_executor_${database.slice(-16)}`;
    assert.match(executorRole, /^[a-z0-9_]+$/u);
    success(postgres.run("createdb", [database]), "database creation");
    try {
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", [
          "create schema extensions",
          "create extension pgcrypto with schema extensions",
          [
            "do $$ begin",
            "if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;",
            "if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;",
            "if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;",
            "end $$",
          ].join(" "),
        ].join("; "),
      ]), "hosted Supabase prerequisites");
      const directory = fileURLToPath(new URL("../../drizzle/", import.meta.url));
      const migrations = readdirSync(directory)
        .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
        .sort();
      assert.equal(migrations.length, 31);
      for (const migration of migrations.slice(0, 21)) {
        success(postgres.run("psql", [
          "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
          "-f", `${directory}/${migration}`,
        ]), `migration ${migration.slice(0, 4)}`);
      }
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", "postgres",
        "-c", [
          `create role ${executorRole} login inherit createrole`,
          `alter role ${executorRole} set createrole_self_grant=''`,
        ].join("; "),
      ]), "hosted migration executor creation");
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", [
          "do $ownership$ declare target record; begin",
          "for target in select class.oid, class.relkind from pg_catalog.pg_class class join pg_catalog.pg_namespace namespace on namespace.oid=class.relnamespace where namespace.nspname='public' and class.relowner='postgres'::regrole and class.relkind in ('r','p','v','m','S') loop",
          `execute pg_catalog.format(case when target.relkind='S' then 'alter sequence %s owner to ${executorRole}' else 'alter table %s owner to ${executorRole}' end,target.oid::regclass);`,
          "end loop;",
          "for target in select procedure_record.oid from pg_catalog.pg_proc procedure_record join pg_catalog.pg_namespace namespace on namespace.oid=procedure_record.pronamespace where namespace.nspname='public' and procedure_record.proowner='postgres'::regrole loop",
          `execute pg_catalog.format('alter function %s owner to ${executorRole}',target.oid::regprocedure);`,
          "end loop;",
          "end $ownership$;",
        ].join(" "),
      ]), "hosted executor continuity for executor-owned public objects");
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", [
          `grant vsee_registry_owner to ${executorRole} with admin true, inherit false, set false`,
          `grant vsee_underwriting_owner to ${executorRole} with admin true, inherit false, set false`,
          `grant usage, create on schema public to ${executorRole} with grant option`,
          `grant usage on schema extensions to ${executorRole} with grant option`,
        ].join("; "),
      ]), "hosted executor privileges");
      const xtraceOwnerExists = success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", "select exists(select 1 from pg_roles where rolname='vsee_xtrace_owner')",
      ]), "preexisting XTrace-owner check");
      if (xtraceOwnerExists === "f") {
        success(postgres.run("psql", [
          "--no-password", "-U", executorRole,
          "-v", "ON_ERROR_STOP=1", "-d", database,
          "-c", "create role vsee_xtrace_owner nologin noinherit",
        ]), "hosted executor XTrace-owner bootstrap");
      } else {
        success(postgres.run("psql", [
          "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
          "-c", `grant vsee_xtrace_owner to ${executorRole} with admin true, inherit false, set false`,
        ]), "shared-cluster XTrace-owner bootstrap fixture");
      }
      for (const migration of migrations.slice(21, 22)) {
        success(postgres.run("psql", [
          "--no-password", "-U", executorRole,
          "-v", "ON_ERROR_STOP=1", "-d", database,
          "-f", `${directory}/${migration}`,
        ]), `hosted migration ${migration.slice(0, 4)}`);
      }
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", [
          "insert into public.workspaces(id,name) values ('workspace_hosted','Hosted')",
          "insert into public.companies(id,workspace_id,name) values ('company_hosted','workspace_hosted','Hosted Co')",
          `insert into public.deals(id,workspace_id,company_id,company_name,status,analysis_eligible_at,active_source_revision_fingerprint) values ('deal_hosted','workspace_hosted','company_hosted','Hosted Co','passed',now(),'sha256:${"e".repeat(64)}')`,
          `insert into public.scan_runs(id,workspace_id,mode,status,evidence_context_version,evidence_mode,evidence_anchor_at,evidence_window_start_at,evidence_window_end_at,evidence_window_timezone,evidence_context_fingerprint) values ('00000000-0000-4000-8000-000000000021','workspace_hosted','xtrace','completed','run-evidence-context-v1','live','2026-08-03T00:00:00Z','2026-07-20T00:00:00Z','2026-08-03T00:00:00Z','UTC','sha256:${"3".repeat(64)}')`,
          "set role service_role",
          `select public.record_xtrace_recall_audit_v2($json$${JSON.stringify({
            workspaceId: "workspace_hosted",
            runId: "00000000-0000-4000-8000-000000000021",
            dealId: "deal_hosted",
            evidenceContextFingerprint: `sha256:${"3".repeat(64)}`,
            activeParentFingerprint: `sha256:${"e".repeat(64)}`,
            queryFingerprint: "5".repeat(64),
            memoryIds: [],
          })}$json$::jsonb)`,
        ].join("; "),
      ]), "external-schema XTrace audit execution");
      for (const migration of migrations.slice(22)) {
        success(postgres.run("psql", [
          "--no-password", "-U", executorRole,
          "-v", "ON_ERROR_STOP=1", "-d", database,
          "-f", `${directory}/${migration}`,
        ]), `hosted migration ${migration.slice(0, 4)}`);
      }
      const restored = success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", [
          "select count(*) from pg_auth_members membership",
          "join pg_roles owner_role on owner_role.oid=membership.roleid",
          "join pg_roles member_role on member_role.oid=membership.member",
          "join pg_roles grantor_role on grantor_role.oid=membership.grantor",
          `where member_role.rolname='${executorRole}'`,
          "and owner_role.rolname in ('vsee_registry_owner','vsee_underwriting_owner','vsee_xtrace_owner')",
          "and grantor_role.rolsuper and membership.admin_option",
          "and not membership.inherit_option and not membership.set_option",
        ].join(" "),
      ]), "hosted owner-membership restoration");
      assert.equal(restored, "3");
      const schemaPrivileges = success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", [
          "select count(*) from unnest(array['vsee_registry_owner','vsee_underwriting_owner','vsee_xtrace_owner']) owner_role",
          "where has_schema_privilege(owner_role,'public','CREATE')",
        ].join(" "),
      ]), "owner schema privilege restoration");
      assert.equal(schemaPrivileges, "0");
      const finalAuthority = success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", [
          "select concat_ws('|',",
          "(select proconfig::text from pg_proc where oid='public.resolve_xtrace_memory_v2(text,text,text,text)'::regprocedure),",
          "(select proconfig::text from pg_proc where oid='public.record_xtrace_recall_audit_v2(jsonb)'::regprocedure),",
          "(select to_regprocedure('public.prepare_isolated_owner_0021(text,boolean)') is null),",
          "(select to_regprocedure('public.finish_isolated_owner_0021(text,boolean)') is null))",
        ].join(" "),
      ]), "final XTrace authority hardening");
      assert.equal(finalAuthority, '{"search_path=\\"\\""}|{"search_path=\\"\\""}|t|t');
    } finally {
      success(postgres.run("dropdb", ["--if-exists", database]), "database cleanup");
      postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", "postgres",
        "-c", `drop role if exists ${executorRole}`,
      ]);
    }
  },
);

test(
  "0030 repairs the historical 0028 recall audit on hosted pgcrypto without replaying 0021",
  { skip: postgres.state === "skipped" ? postgres.reason : false },
  () => {
    assert.equal(postgres.state, "verified");
    if (postgres.state !== "verified") return;
    const database = makeDisposableDatabaseName("xtrace_forward");
    const executorRole = `vsee_forward_executor_${database.slice(-16)}`;
    assert.match(executorRole, /^[a-z0-9_]+$/u);
    success(postgres.run("createdb", [database]), "forward database creation");
    try {
      const directory = fileURLToPath(new URL("../../drizzle/", import.meta.url));
      const migrations = readdirSync(directory)
        .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
        .sort();
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", [
          "create schema extensions",
          "create extension pgcrypto with schema extensions",
          [
            "do $$ begin",
            "if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;",
            "if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;",
            "if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;",
            "end $$",
          ].join(" "),
        ].join("; "),
      ]), "forward hosted prerequisites");
      for (const migration of migrations.slice(0, 21)) {
        success(postgres.run("psql", [
          "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
          "-f", `${directory}/${migration}`,
        ]), `forward migration ${migration.slice(0, 4)}`);
      }
      const historicalAuditFunction = [
        "create or replace function public.record_xtrace_recall_audit_v2(p_audit jsonb)",
        "returns void language plpgsql security definer",
        "set search_path = pg_catalog, public as $$",
        "declare v_audit_id text; authorized boolean; begin",
        "v_audit_id := 'xtrace_audit_' || encode(digest(p_audit::text, 'sha256'), 'hex');",
        "with authority as materialized (select 1 from public.scan_runs run join public.deals deal on deal.workspace_id=run.workspace_id and deal.id=p_audit->>'dealId' where run.workspace_id=p_audit->>'workspaceId' and run.id=(p_audit->>'runId')::uuid and run.evidence_context_fingerprint=p_audit->>'evidenceContextFingerprint' and deal.active_source_revision_fingerprint=p_audit->>'activeParentFingerprint'),",
        "inserted as (insert into public.xtrace_recall_audits_v2(audit_id,workspace_id,run_id,deal_id,evidence_context_fingerprint,active_parent_fingerprint,query_fingerprint,memory_ids) select v_audit_id,p_audit->>'workspaceId',(p_audit->>'runId')::uuid,p_audit->>'dealId',p_audit->>'evidenceContextFingerprint',p_audit->>'activeParentFingerprint',p_audit->>'queryFingerprint',p_audit->'memoryIds' from authority on conflict(audit_id) do nothing returning 1)",
        "select exists(select 1 from authority) into authorized; if not authorized then raise exception 'drift'; end if; end; $$;",
        "alter function public.record_xtrace_recall_audit_v2(jsonb) owner to vsee_xtrace_owner;",
      ].join("\n");
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-f", `${directory}/${migrations[21]}`,
      ]), "0021 catalog setup");
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", [
          historicalAuditFunction,
          "revoke usage on schema extensions from vsee_xtrace_owner",
        ].join("\n"),
      ]), "historical 0021 recall-audit catalog downgrade");
      for (const migration of migrations.slice(22, 30)) {
        success(postgres.run("psql", [
          "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
          "-f", `${directory}/${migration}`,
        ]), `historical continuation ${migration.slice(0, 4)}`);
      }
      const audit = {
        workspaceId: "workspace_forward",
        runId: "00000000-0000-4000-8000-000000000030",
        dealId: "deal_forward",
        evidenceContextFingerprint: `sha256:${"3".repeat(64)}`,
        activeParentFingerprint: `sha256:${"e".repeat(64)}`,
        queryFingerprint: "5".repeat(64),
        memoryIds: [],
      };
      const auditSql = [
        "set role service_role",
        `select public.record_xtrace_recall_audit_v2($json$${JSON.stringify(audit)}$json$::jsonb)`,
      ].join("; ");
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", [
          "insert into public.workspaces(id,name) values ('workspace_forward','Forward')",
          "insert into public.companies(id,workspace_id,name) values ('company_forward','workspace_forward','Forward Co')",
          `insert into public.deals(id,workspace_id,company_id,company_name,status,analysis_eligible_at,active_source_revision_fingerprint) values ('deal_forward','workspace_forward','company_forward','Forward Co','passed',now(),'sha256:${"e".repeat(64)}')`,
          `insert into public.scan_runs(id,workspace_id,mode,status,evidence_context_version,evidence_mode,evidence_anchor_at,evidence_window_start_at,evidence_window_end_at,evidence_window_timezone,evidence_context_fingerprint) values ('${audit.runId}','workspace_forward','xtrace','running','run-evidence-context-v1','live','2026-08-03T00:00:00Z','2026-07-20T00:00:00Z','2026-08-03T00:00:00Z','UTC','sha256:${"3".repeat(64)}')`,
        ].join("; "),
      ]), "historical forward audit fixture");
      failure(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", auditSql,
      ]), "historical external-schema audit failure", /digest.*does not exist/iu);
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", "postgres",
        "-c", [
          `create role ${executorRole} login inherit createrole`,
          `alter role ${executorRole} set createrole_self_grant=''`,
        ].join("; "),
      ]), "historical forward executor creation");
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", [
          `grant vsee_xtrace_owner to ${executorRole} with admin true, inherit false, set false`,
          `grant usage, create on schema public to ${executorRole} with grant option`,
          `grant usage on schema extensions to ${executorRole} with grant option`,
        ].join("; "),
      ]), "historical forward executor privileges");
      success(postgres.run("psql", [
        "--no-password", "-U", executorRole,
        "-v", "ON_ERROR_STOP=1", "-d", database,
        "-f", `${directory}/${migrations[30]}`,
      ]), "0030-only forward repair");
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", auditSql,
      ]), "0030 repaired external-schema audit execution");
      const hardened = success(postgres.run("psql", [
        "--no-password", "-At", "-d", database,
        "-c", [
          "select concat_ws('|',",
          "(select proconfig::text from pg_proc where oid='public.record_xtrace_recall_audit_v2(jsonb)'::regprocedure),",
          "(select count(*) from public.xtrace_recall_audits_v2 where workspace_id='workspace_forward'),",
          "(select count(*) from pg_auth_members membership join pg_roles owner_role on owner_role.oid=membership.roleid join pg_roles member_role on member_role.oid=membership.member join pg_roles grantor_role on grantor_role.oid=membership.grantor",
          `where member_role.rolname='${executorRole}' and owner_role.rolname='vsee_xtrace_owner' and grantor_role.rolsuper and membership.admin_option and not membership.inherit_option and not membership.set_option),`,
          "not has_schema_privilege('vsee_xtrace_owner','public','CREATE'))",
        ].join(" "),
      ]), "0030 repaired audit config");
      assert.equal(hardened, '{"search_path=\\"\\""}|1|1|t');
    } finally {
      success(postgres.run("dropdb", ["--if-exists", database]), "forward database cleanup");
      postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", "postgres",
        "-c", `drop role if exists ${executorRole}`,
      ]);
    }
  },
);

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
        .filter((name) => /^\d{4}_.+\.sql$/u.test(name)
          && Number(name.slice(0, 4)) <= 21)
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
          `insert into public.deals(id,workspace_id,company_id,company_name,status,analysis_eligible_at,active_source_revision_fingerprint) values ('deal_x','workspace_x','company_x','X Co','passed',now(),'sha256:${"e".repeat(64)}')`,
          "insert into public.source_documents(id,filename,title,role,company_name,deal_id,checksum,byte_size,object_key) values ('source_x','x.json','X source','public_web_snapshot','X Co','deal_x','x',1,'private/x')",
          "insert into public.source_revisions(id,workspace_id,source_id,revision,content_hash,object_key,object_version,content_type,extractor_id,extractor_version,extracted_at,created_at) values ('revision_x','workspace_x','source_x',1,'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','private/x','1','application/json','test','1',now(),now())",
          "insert into public.deal_source_assignments(id,request_id,request_fingerprint,workspace_id,deal_id,source_id,source_revision_id,assigned_by_user_id,reason,created_at) values ('assignment_x','request_x','sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','workspace_x','deal_x','source_x','revision_x','user_x','test',now())",
          `insert into public.scan_runs(id,workspace_id,mode,status,evidence_context_version,evidence_mode,evidence_anchor_at,evidence_window_start_at,evidence_window_end_at,evidence_window_timezone,evidence_context_fingerprint) values ('00000000-0000-4000-8000-000000000001','workspace_x','xtrace','completed','run-evidence-context-v1','live','2026-08-03T00:00:00Z','2026-07-20T00:00:00Z','2026-08-03T00:00:00Z','UTC','sha256:${"3".repeat(64)}')`,
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

      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", [
          "insert into public.source_documents(id,filename,title,role,company_name,deal_id,checksum,byte_size,object_key) values ('source_z','z.json','Z source','public_web_snapshot','X Co','deal_x','z',1,'private/z')",
          "insert into public.source_revisions(id,workspace_id,source_id,revision,content_hash,object_key,object_version,content_type,extractor_id,extractor_version,extracted_at,created_at) values ('revision_z','workspace_x','source_z',1,'sha256:8888888888888888888888888888888888888888888888888888888888888888','private/z','1','application/json','test','1',now(),now())",
          "insert into public.deal_source_assignments(id,request_id,request_fingerprint,workspace_id,deal_id,source_id,source_revision_id,assigned_by_user_id,reason,created_at) values ('assignment_z','request_z','sha256:7777777777777777777777777777777777777777777777777777777777777777','workspace_x','deal_x','source_z','revision_z','user_x','test',now())",
        ].join("; "),
      ]), "expired lease parent setup");
      const expiringIntent = {
        ...intent,
        intentId: `xtrace_intent_${"8".repeat(64)}`,
        sourceId: "source_z",
        sourceRevisionId: "revision_z",
        parentFingerprint: `sha256:${"8".repeat(64)}`,
        payloadFingerprint: `sha256:${"7".repeat(64)}`,
      };
      const expiringReserve = JSON.parse(success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", `set role service_role; select public.reserve_xtrace_ingest_intent_v2($json$${JSON.stringify(expiringIntent)}$json$::jsonb)`,
      ]), "expiring reserve").split("\n").at(-1) ?? "null") as {
        intent: { intentId: string; leaseToken: string };
      };
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", `set role vsee_xtrace_owner; update public.xtrace_ingest_intents_v2 set lease_expires_at=clock_timestamp()-interval '1 second' where intent_id='${expiringReserve.intent.intentId}'`,
      ]), "force exact lease expiry");
      const expiredReserve = JSON.parse(success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", `set role service_role; select public.reserve_xtrace_ingest_intent_v2($json$${JSON.stringify(expiringIntent)}$json$::jsonb)`,
      ]), "expired reserve reconciliation").split("\n").at(-1) ?? "null") as {
        action: string; intent: { state: string };
      };
      assert.equal(expiredReserve.action, "blocked");
      assert.equal(expiredReserve.intent.state, "submission_unknown");
      failure(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", `set role service_role; select public.attach_xtrace_ingest_job_v2('${expiringReserve.intent.intentId}','${expiringReserve.intent.leaseToken}','late_job')`,
      ]), "late expired-lease attach", /lease is not active/iu);

      const audit = {
        workspaceId: "workspace_x",
        runId: "00000000-0000-4000-8000-000000000001",
        dealId: "deal_x",
        evidenceContextFingerprint: `sha256:${"3".repeat(64)}`,
        activeParentFingerprint: `sha256:${"e".repeat(64)}`,
        queryFingerprint: "5".repeat(64),
        memoryIds: ["memory_x"],
      };
      failure(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", `set role service_role; select public.record_xtrace_recall_audit_v2($json$${JSON.stringify({ ...audit, evidenceContextFingerprint: `sha256:${"6".repeat(64)}` })}$json$::jsonb)`,
      ]), "stale evidence-context audit", /evidence context|authoritative|drift/iu);
      failure(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", `set role service_role; select public.record_xtrace_recall_audit_v2($json$${JSON.stringify({ ...audit, activeParentFingerprint: `sha256:${"7".repeat(64)}` })}$json$::jsonb)`,
      ]), "stale active-parent audit", /active parent|authoritative|drift/iu);
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", `set role service_role; select public.record_xtrace_recall_audit_v2($json$${JSON.stringify(audit)}$json$::jsonb)`,
      ]), "authoritative recall audit");
      failure(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", "set role service_role; update public.xtrace_recall_audits_v2 set deal_id='other'",
      ]), "direct recall-audit mutation", /RPC-only|permission denied/iu);
      const driftedFingerprint = success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", `set role service_role; select count(*) from public.resolve_xtrace_memory_v2('workspace_x','memory_x','deal_x','sha256:${"7".repeat(64)}')`,
      ]), "drifted active-parent resolution").split("\n").at(-1);
      assert.equal(driftedFingerprint, "0");
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
