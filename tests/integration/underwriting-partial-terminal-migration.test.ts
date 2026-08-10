import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  makeDisposableDatabaseName,
  requireLoopbackPostgres,
  type VerifiedLoopbackPostgresContext,
} from "../helpers/require-loopback-postgres";

const migrationPath = fileURLToPath(new URL(
  "../../drizzle/0025_report_deal_universe_authority.sql",
  import.meta.url,
));
const migrationDirectory = fileURLToPath(new URL("../../drizzle/", import.meta.url));
const postgres = requireLoopbackPostgres();
const postgresVersion = postgres.state === "verified"
  ? postgres.run("psql", ["--no-password", "-d", "postgres", "-Atqc", "show server_version_num"])
  : null;
const postgres17SkipReason = postgres.state === "skipped"
  ? postgres.reason
  : postgresVersion?.status !== 0
    || Number(postgresVersion.stdout.trim()) < 170000
    ? "The full migration chain requires PostgreSQL 17 or newer."
    : false;

function definition(source: string, functionName: string): string {
  const start = source.lastIndexOf(
    `create or replace function public.${functionName}(`,
  );
  assert.notEqual(start, -1, `0025 must replace ${functionName}.`);
  const end = source.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `${functionName} must have a complete SQL body.`);
  return source.slice(start, end + 4);
}

test("0025 treats partial underwriting candidates as immutable terminal results", () => {
  const source = readFileSync(migrationPath, "utf8");
  const refresh = definition(source, "refresh_underwriting_batch_status");
  const claimNext = definition(source, "claim_next_underwriting_candidate");
  const claimTarget = definition(source, "claim_underwriting_candidate");
  const markUnavailable = definition(
    source,
    "mark_candidate_underwriting_unavailable",
  );
  const markFailed = definition(source, "mark_candidate_underwriting_failed");

  assert.match(
    refresh,
    /status in \('completed', 'partial', 'unavailable', 'failed'\)/u,
  );
  assert.match(
    refresh,
    /when completed_count = candidate_count then 'completed'[\s\S]*?when failed_count = candidate_count then 'failed'[\s\S]*?else 'partial'/u,
  );

  for (const claim of [claimNext, claimTarget]) {
    assert.doesNotMatch(
      claim,
      /status\s*=\s*'partial'/u,
      "A persisted partial result must never be reclaimed for execution.",
    );
  }
  for (const terminalUpdate of [markUnavailable, markFailed]) {
    assert.match(terminalUpdate, /status in \('queued', 'running'\)/u);
    assert.doesNotMatch(
      terminalUpdate,
      /status in \('queued', 'running', 'partial'\)/u,
      "A partial result must not be replaced by unavailable or failed.",
    );
  }
});

test("0025 makes priority rank non-gating for every selected underwriting candidate", () => {
  const source = readFileSync(migrationPath, "utf8");
  const saveSelections = definition(source, "save_underwriting_selections");
  const createCandidates = definition(
    source,
    "create_selected_underwriting_candidates",
  );
  const claimNext = definition(source, "claim_next_underwriting_candidate");

  assert.doesNotMatch(saveSelections, /between\s+1\s+and\s+5/u);
  assert.doesNotMatch(createCandidates, /between\s+1\s+and\s+5/u);
  assert.match(
    saveSelections,
    /when item\s*->>\s*'status'\s*=\s*'selected'[\s\S]*?then\s*'selected'/u,
  );
  assert.match(
    createCandidates,
    /and status = 'selected'/u,
  );
  assert.match(
    claimNext,
    /join public\.underwriting_selections as selection/u,
  );
  assert.match(
    claimNext,
    /order by selection\.rank, candidate\.deal_id, candidate\.id/u,
  );
});

function success(
  result: ReturnType<VerifiedLoopbackPostgresContext["run"]>,
  operation: string,
): string {
  assert.equal(result.status, 0, `${operation} failed: ${result.stderr}`);
  return result.stdout.trim();
}

test(
  "0025 keeps partial rows terminal across PostgreSQL batch and claim RPCs",
  { skip: postgres17SkipReason },
  () => {
    assert.equal(postgres.state, "verified");
    if (postgres.state !== "verified") return;
    const database = makeDisposableDatabaseName("underwriting_partial_terminal");
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
      for (const migration of readdirSync(migrationDirectory)
        .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
        .sort()) {
        success(postgres.run("psql", [
          "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
          "-f", `${migrationDirectory}/${migration}`,
        ]), `migration ${migration.slice(0, 4)}`);
      }
      const run = (sql: string) => success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-At", "-c", sql,
      ]), "partial-terminal assertion");
      run([
        "insert into public.workspaces(id,name) values ('workspace_partial','Partial')",
        "insert into public.scan_runs(id,workspace_id,mode,status) values ('00000000-0000-4000-8000-000000000025','workspace_partial','structured','completed')",
        "select public.activate_fund_policy_version(jsonb_build_object('workspaceId','workspace_partial','actorId',null,'expectedActiveVersionId',null,'action','recommended'))",
        "insert into public.companies(id,workspace_id,name) values ('company_partial','workspace_partial','Partial Co')",
        "insert into public.deals(id,workspace_id,company_id,company_name,status) values ('deal_partial','workspace_partial','company_partial','Partial Co','screening'),('deal_completed','workspace_partial','company_partial','Partial Co','screening')",
        "insert into public.underwriting_batches(id,workspace_id,scan_run_id,status,batch_input_fingerprint,fund_policy_snapshot_id,force_refresh) values ('batch_partial','workspace_partial','00000000-0000-4000-8000-000000000025','running','sha256:1111111111111111111111111111111111111111111111111111111111111111','fund_policy:workspace_partial:v1',false),('batch_mixed','workspace_partial','00000000-0000-4000-8000-000000000025','running','sha256:2222222222222222222222222222222222222222222222222222222222222222','fund_policy:workspace_partial:v1',false)",
        "insert into public.candidate_runs(id,batch_id,workspace_id,deal_id,status,candidate_analysis_fingerprint,unavailable_reason_codes,finalized_at) values ('candidate_partial','batch_partial','workspace_partial','deal_partial','partial','pending:candidate_partial','[\"PARTIAL_UNDERWRITING_ARTIFACT\"]'::jsonb,now()),('candidate_mixed_partial','batch_mixed','workspace_partial','deal_partial','partial','pending:candidate_mixed_partial','[\"PARTIAL_UNDERWRITING_ARTIFACT\"]'::jsonb,now()),('candidate_mixed_completed','batch_mixed','workspace_partial','deal_completed','completed','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','[]'::jsonb,now())",
        "select public.refresh_underwriting_batch_status('batch_partial')",
        "select public.refresh_underwriting_batch_status('batch_mixed')",
      ].join("; "));

      assert.equal(
        run("select string_agg(status, ',' order by id) from public.underwriting_batches where id in ('batch_partial','batch_mixed')"),
        "partial,partial",
      );
      assert.equal(
        run("set role service_role; select public.claim_underwriting_candidate('workspace_partial','candidate_partial','worker_partial',60) is null"),
        "t",
      );
      assert.equal(
        run("set role service_role; select public.claim_next_underwriting_candidate('worker_partial',60) is null"),
        "t",
      );

      for (const functionName of [
        "mark_candidate_underwriting_unavailable",
        "mark_candidate_underwriting_failed",
      ]) {
        const rejected = postgres.run("psql", [
          "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
          "-c", [
            "set role service_role",
            `select public.${functionName}(jsonb_build_object('candidateRunId','candidate_partial','reasonCodes','[\"PROVIDER_FAILURE\"]'::jsonb,'publicReason','Provider failure'))`,
          ].join("; "),
        ]);
        assert.notEqual(rejected.status, 0, `${functionName} must reject partial.`);
      }
      assert.equal(
        run("select status || '|' || (finalized_at is not null)::text from public.candidate_runs where id='candidate_partial'"),
        "partial|true",
      );
    } finally {
      postgres.run("dropdb", ["--if-exists", database]);
    }
  },
);

test(
  "0025 creates every selected priority rank without a five-candidate cutoff and replays idempotently",
  { skip: postgres17SkipReason },
  () => {
    assert.equal(postgres.state, "verified");
    if (postgres.state !== "verified") return;
    const database = makeDisposableDatabaseName("underwriting_all_priorities");
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
      for (const migration of readdirSync(migrationDirectory)
        .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
        .sort()) {
        success(postgres.run("psql", [
          "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
          "-f", `${migrationDirectory}/${migration}`,
        ]), `migration ${migration.slice(0, 4)}`);
      }
      const run = (sql: string) => success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-At", "-c", sql,
      ]), "unbounded-priority assertion");

      run([
        "insert into public.workspaces(id,name) values ('workspace_priority','Priority')",
        "insert into public.scan_runs(id,workspace_id,mode,status) select (lpad(i::text,8,'0') || '-0000-4000-8000-000000000026')::uuid,'workspace_priority','structured','completed' from generate_series(1,10) i",
        "select public.activate_fund_policy_version(jsonb_build_object('workspaceId','workspace_priority','actorId',null,'expectedActiveVersionId',null,'action','recommended'))",
        "insert into public.companies(id,workspace_id,name) values ('company_priority','workspace_priority','Priority Co')",
        "insert into public.deals(id,workspace_id,company_id,company_name,status) select 'deal_' || i,'workspace_priority','company_priority','Priority Co','screening' from generate_series(1,30) i",
      ].join("; "));

      const createBatch = (batchId: string, scanIndex: number) => run([
        "insert into public.underwriting_batches(id,workspace_id,scan_run_id,status,batch_input_fingerprint,fund_policy_snapshot_id,force_refresh)",
        `values ('${batchId}','workspace_priority','${String(scanIndex).padStart(8, "0")}-0000-4000-8000-000000000026','queued','sha256:${String(scanIndex).repeat(64)}','fund_policy:workspace_priority:v1',false)`,
      ].join(" "));
      const saveAndCreate = (batchId: string, count: number) => run([
        "set role service_role",
        [
          "select public.save_underwriting_selections(jsonb_build_object(",
          `'batchId','${batchId}',`,
          "'selections',coalesce((select jsonb_agg(jsonb_build_object('dealId','deal_' || i,'status','selected','rank',i,'reason','Belief revision admitted')) from generate_series(1," + count + ") i),'[]'::jsonb)",
          "))",
        ].join(" "),
        [
          "select public.create_selected_underwriting_candidates(jsonb_build_object(",
          `'batchId','${batchId}',`,
          "'dealIds',coalesce((select jsonb_agg('deal_' || i) from generate_series(1," + count + ") i),'[]'::jsonb)",
          "))",
        ].join(" "),
      ].join("; "));

      createBatch("batch_priority", 1);
      run([
        "set role service_role",
        [
          "select public.save_underwriting_selections(jsonb_build_object('batchId','batch_priority','selections',jsonb_build_array(",
          "jsonb_build_object('dealId','deal_1','status','selected','rank',2,'reason','Second priority'),",
          "jsonb_build_object('dealId','deal_7','status','selected','rank',1,'reason','First priority'))))",
        ].join(" "),
        "select public.create_selected_underwriting_candidates(jsonb_build_object('batchId','batch_priority','dealIds',jsonb_build_array('deal_1','deal_7')))",
        "select (public.claim_next_underwriting_candidate('priority_worker',60)->'candidate'->>'dealId')",
      ].join("; "));
      assert.equal(
        run("select deal_id from public.candidate_runs where batch_id='batch_priority' and status='running'"),
        "deal_7",
        "claim_next must honor persisted priority rank before creation order.",
      );

      const cardinalities = [0, 1, 4, 5, 7, 30] as const;
      cardinalities.forEach((count, index) => {
        const batchId = `batch_${count}`;
        createBatch(batchId, index + 2);
        saveAndCreate(batchId, count);
        assert.equal(
          run(`select count(*) from public.candidate_runs where batch_id='${batchId}'`),
          String(count),
          `${count} selected belief revisions must create ${count} candidates.`,
        );
        saveAndCreate(batchId, count);
        assert.equal(
          run(`select count(*) from public.candidate_runs where batch_id='${batchId}'`),
          String(count),
          `replaying ${count} selections must not duplicate candidates.`,
        );
      });
      assert.equal(
        run("select status || '|' || rank from public.underwriting_selections where batch_id='batch_30' and deal_id='deal_30'"),
        "selected|30",
        "rank 30 is persisted as priority, not converted to not_selected.",
      );
    } finally {
      postgres.run("dropdb", ["--if-exists", database]);
    }
  },
);
