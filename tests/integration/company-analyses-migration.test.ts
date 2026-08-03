import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { makeDisposableDatabaseName, requireLoopbackPostgres } from "../helpers/require-loopback-postgres";

const migrationPaths = [
  "0000_vsee_postgres.sql",
  "0001_remove_report_delivery.sql",
  "0002_durable_decision_lineage.sql",
  "0003_sanitize_report_next_steps.sql",
  "0004_company_analyses.sql",
].map((filename) => fileURLToPath(
  new URL(`../../drizzle/${filename}`, import.meta.url),
));

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

function withTemporaryDatabase(run: (database: string) => void): void {
  const database = makeDisposableDatabaseName("company_analysis");
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

function seedReportDependencies(database: string): void {
  executeSql(database, `
    insert into public.workspaces (id, name)
    values ('workspace_demo', 'Demo');
    insert into public.companies (id, workspace_id, name)
    values ('company_1', 'workspace_demo', '7bridges');
    insert into public.deals (id, workspace_id, company_id, company_name)
    values ('deal_7bridges', 'workspace_demo', 'company_1', '7bridges');
    insert into public.scan_runs (
      id, workspace_id, mode, window_days, status
    ) values (
      '00000000-0000-4000-8000-000000000001',
      'workspace_demo',
      'xtrace',
      14,
      'running'
    );
  `);
}

test(
  "company analysis migration creates report summary and analysis columns",
  { skip: !canCreateTemporaryDatabase },
  () => {
    assert.ok(existsSync(migrationPaths.at(-1) ?? ""));
    withTemporaryDatabase((database) => {
      for (const path of migrationPaths) {
        applySql(database, path);
      }

      const columns = executeSql(database, `
        select column_name
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'company_analyses'
        order by ordinal_position;
      `);

      assert.equal(columns, [
        "id",
        "workspace_id",
        "report_id",
        "run_id",
        "deal_id",
        "company_name",
        "deal_status",
        "outcome",
        "confidence",
        "score",
        "investment_memory",
        "market_evidence",
        "implications",
        "recommended_next_move",
        "company_brief",
        "source_refs",
        "created_at",
      ].join("\n"));

      assert.equal(
        executeSql(database, `
          select column_name
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'intelligence_reports'
            and column_name in (
              'analysis_status',
              'company_count',
              'belief_revised_count',
              'monitor_count',
              'no_material_change_count',
              'analysis_unavailable_count',
              'priority_deal_id',
              'evidence_coverage'
            )
          order by column_name;
        `).split("\n").length,
        8,
      );
    });
  },
);

test(
  "save_intelligence_report atomically replaces one analysis per report and deal",
  { skip: !canCreateTemporaryDatabase },
  () => {
    withTemporaryDatabase((database) => {
      for (const path of migrationPaths) {
        applySql(database, path);
      }
      seedReportDependencies(database);

      executeSql(database, `
        select id
        from public.save_intelligence_report(
          jsonb_build_object(
            'id', 'report_1',
            'workspaceId', 'workspace_demo',
            'runId', '00000000-0000-4000-8000-000000000001',
            'createdAt', '2026-07-24T12:00:00.000Z',
            'marketSummary', 'No material changes.',
            'opportunities', '[]'::jsonb,
            'analysisStatus', 'completed',
            'companyCount', 1,
            'beliefRevisedCount', 0,
            'monitorCount', 0,
            'noMaterialChangeCount', 1,
            'analysisUnavailableCount', 0,
            'priorityDealId', null,
            'evidenceCoverage', '{}'::jsonb
          ),
          jsonb_build_array(jsonb_build_object(
            'id', 'analysis_1',
            'workspaceId', 'workspace_demo',
            'reportId', 'report_1',
            'runId', '00000000-0000-4000-8000-000000000001',
            'dealId', 'deal_7bridges',
            'companyName', '7bridges',
            'dealStatus', 'passed',
            'outcome', 'no_material_change',
            'confidence', 'low',
            'score', 0.1,
            'investmentMemory', '{}'::jsonb,
            'marketEvidence', '{}'::jsonb,
            'implications', '{}'::jsonb,
            'recommendedNextMove', 'Continue monitoring.',
            'companyBrief', '{}'::jsonb,
            'sourceRefs', '[]'::jsonb,
            'createdAt', '2026-07-24T12:00:00.000Z'
          ))
        );
      `);

      assert.equal(
        executeSql(database, `
          select company_count || '|' || (
            select count(*) from public.company_analyses
            where report_id = 'report_1'
          )
          from public.intelligence_reports
          where id = 'report_1';
        `),
        "1|1",
      );

      assert.throws(() => executeSql(database, `
        insert into public.company_analyses (
          id, workspace_id, report_id, run_id, deal_id, company_name,
          deal_status, outcome, confidence, score, investment_memory,
          market_evidence, implications, recommended_next_move,
          company_brief, source_refs
        )
        select
          'analysis_duplicate', workspace_id, report_id, run_id, deal_id,
          company_name, deal_status, outcome, confidence, score,
          investment_memory, market_evidence, implications,
          recommended_next_move, company_brief, source_refs
        from public.company_analyses
        where id = 'analysis_1';
      `));
    });
  },
);
