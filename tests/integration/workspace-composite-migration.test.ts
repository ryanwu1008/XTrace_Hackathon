import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { makeDisposableDatabaseName, requireLoopbackPostgres } from "../helpers/require-loopback-postgres";

const migrationPaths = Array.from({ length: 9 }, (_, index) => {
  const prefix = String(index).padStart(4, "0");
  const filenames = [
    "0000_vsee_postgres.sql",
    "0001_remove_report_delivery.sql",
    "0002_durable_decision_lineage.sql",
    "0003_sanitize_report_next_steps.sql",
    "0004_company_analyses.sql",
    "0005_sample_decision_label.sql",
    "0006_reasoner_judgments.sql",
    "0007_uploaded_documents.sql",
    "0008_workspace_composite_identity.sql",
  ];
  assert.ok(filenames[index].startsWith(prefix));
  return fileURLToPath(
    new URL(`../../drizzle/${filenames[index]}`, import.meta.url),
  );
});

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
const requirePostgres = process.env.REQUIRE_POSTGRES_MIGRATION_TESTS === "1";

test(
  "0008 upgrades legacy rows and enforces workspace-composite catalog identities",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    withTemporaryDatabase((database) => {
      for (const path of migrationPaths.slice(0, -1)) {
        applySql(database, path);
      }
      seedLegacyWorkspace(database);
      applySql(database, migrationPaths.at(-1)!);
      seedSecondWorkspaceWithSharedExternalIds(database);

      for (const [constraint, definition] of [
        ["companies_pkey", "PRIMARY KEY (workspace_id, id)"],
        ["deals_pkey", "PRIMARY KEY (workspace_id, id)"],
        ["source_evidence_pkey", "PRIMARY KEY (workspace_id, id)"],
        ["deal_interactions_pkey", "PRIMARY KEY (workspace_id, id)"],
        ["intelligence_reports_pkey", "PRIMARY KEY (workspace_id, id)"],
        ["company_analyses_pkey", "PRIMARY KEY (workspace_id, id)"],
        [
          "xtrace_ingest_jobs_pkey",
          "PRIMARY KEY (workspace_id, job_id)",
        ],
        [
          "xtrace_memory_links_pkey",
          "PRIMARY KEY (workspace_id, memory_id)",
        ],
        ["uploaded_documents_pkey", "PRIMARY KEY (workspace_id, id)"],
        [
          "deals_workspace_company_fkey",
          "FOREIGN KEY (workspace_id, company_id) REFERENCES companies(workspace_id, id) ON DELETE CASCADE",
        ],
        [
          "source_evidence_workspace_deal_fkey",
          "FOREIGN KEY (workspace_id, deal_id) REFERENCES deals(workspace_id, id) ON DELETE CASCADE",
        ],
        [
          "deal_interactions_workspace_deal_fkey",
          "FOREIGN KEY (workspace_id, deal_id) REFERENCES deals(workspace_id, id) ON DELETE CASCADE",
        ],
        [
          "intelligence_reports_workspace_run_fkey",
          "FOREIGN KEY (workspace_id, run_id) REFERENCES scan_runs(workspace_id, id) ON DELETE CASCADE",
        ],
        [
          "company_analyses_workspace_report_fkey",
          "FOREIGN KEY (workspace_id, report_id) REFERENCES intelligence_reports(workspace_id, id) ON DELETE CASCADE",
        ],
        [
          "company_analyses_workspace_run_fkey",
          "FOREIGN KEY (workspace_id, run_id) REFERENCES scan_runs(workspace_id, id) ON DELETE CASCADE",
        ],
        [
          "company_analyses_workspace_deal_fkey",
          "FOREIGN KEY (workspace_id, deal_id) REFERENCES deals(workspace_id, id) ON DELETE CASCADE",
        ],
        [
          "xtrace_ingest_jobs_workspace_deal_fkey",
          "FOREIGN KEY (workspace_id, deal_id) REFERENCES deals(workspace_id, id) ON DELETE CASCADE",
        ],
        [
          "xtrace_memory_links_workspace_deal_fkey",
          "FOREIGN KEY (workspace_id, deal_id) REFERENCES deals(workspace_id, id) ON DELETE CASCADE",
        ],
        [
          "scan_run_steps_workspace_run_fkey",
          "FOREIGN KEY (workspace_id, run_id) REFERENCES scan_runs(workspace_id, id) ON DELETE CASCADE",
        ],
      ]) {
        assert.equal(constraintDefinition(database, constraint), definition);
      }

      assert.equal(
        executeSql(database, `
          select is_nullable
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'scan_run_steps'
            and column_name = 'workspace_id';
        `),
        "NO",
      );

      assert.equal(
        executeSql(database, `
          select table_name || '|' || row_count
          from (
            select 'companies' as table_name, count(*) as row_count
              from public.companies where id = 'company_shared'
            union all
            select 'deals', count(*) from public.deals where id = 'deal_shared'
            union all
            select 'source_evidence', count(*) from public.source_evidence
              where id = 'evidence_shared'
            union all
            select 'deal_interactions', count(*) from public.deal_interactions
              where id = 'fixture_shared'
            union all
            select 'intelligence_reports', count(*) from public.intelligence_reports
              where id = 'report_shared'
            union all
            select 'company_analyses', count(*) from public.company_analyses
              where id = 'analysis_shared'
            union all
            select 'xtrace_ingest_jobs', count(*) from public.xtrace_ingest_jobs
              where job_id = 'job_shared'
            union all
            select 'xtrace_memory_links', count(*) from public.xtrace_memory_links
              where memory_id = 'memory_shared'
            union all
            select 'uploaded_documents', count(*) from public.uploaded_documents
              where id = 'upload_shared'
          ) as counts
          order by table_name;
        `),
        [
          "companies|2",
          "company_analyses|2",
          "deal_interactions|2",
          "deals|2",
          "intelligence_reports|2",
          "source_evidence|2",
          "uploaded_documents|2",
          "xtrace_ingest_jobs|2",
          "xtrace_memory_links|2",
        ].join("\n"),
      );

      assert.equal(
        executeSql(database, `
          select string_agg(workspace_id, ',' order by workspace_id)
          from public.scan_run_steps;
        `),
        "workspace_one,workspace_two",
      );

      executeSql(database, `
        insert into public.companies (workspace_id, id, name)
        values ('workspace_one', 'company_one_only', 'One only');
      `);
      assert.throws(() => executeSql(database, `
        insert into public.deals (
          workspace_id, id, company_id, company_name
        ) values (
          'workspace_two', 'deal_bad_parent', 'company_one_only', 'Bad'
        );
      `));
    });
  },
);

test("operator instructions require every migration through 0019", () => {
  const readme = readFileSync(
    fileURLToPath(new URL("../../README.md", import.meta.url)),
    "utf8",
  );
  const operatorInstructions = [
    {
      path: "README.md",
      content: readme,
    },
    {
      path: "docs/demo-runbook.md",
      content: readFileSync(
        fileURLToPath(new URL("../../docs/demo-runbook.md", import.meta.url)),
        "utf8",
      ),
    },
  ];
  let previous = -1;
  for (let index = 0; index <= 19; index += 1) {
    const marker = `drizzle/${String(index).padStart(4, "0")}_`;
    const position = readme.indexOf(marker);
    assert.ok(position > previous, `${marker} must appear in migration order`);
    previous = position;
  }
  const staleMigrationRange =
    /\bmigrations?\b[^\n.]{0,160}(?:through|to|套到|到|`?0000`?\s*(?:-|–|—|→))\s*`?(?:000[0-9]|001[0-8])`?/iu;
  assert.match(
    "migrations 必須依序套用 0000 到 0006",
    staleMigrationRange,
    "operator-doc regression must recognize the active Chinese range syntax",
  );
  assert.match(
    "apply migrations 0000 through 0018 in order",
    staleMigrationRange,
    "operator-doc regression must recognize the immediately previous release range",
  );
  for (const instruction of operatorInstructions) {
    assert.doesNotMatch(
      instruction.content,
      staleMigrationRange,
      `${instruction.path} must not retain a stale migration range`,
    );
  }

  const runbook = operatorInstructions[1]!.content;
  const maintenanceWindowSteps = [
    /stop (?:the )?Worker and (?:the )?Web writers/i,
    /no active scan or upload leases?/i,
    /database snapshot/i,
    /bootstrap-production-baseline\.zsh/i,
    /apply-production-migrations\.zsh/i,
    /verify[^\n.]{0,100}`?0019`?/i,
    /resume (?:the )?Web and (?:the )?Worker/i,
  ];
  let previousMaintenanceStep = -1;
  for (const expectedStep of maintenanceWindowSteps) {
    const match = expectedStep.exec(runbook);
    assert.ok(match, `runbook must document maintenance step ${expectedStep}`);
    const position = match.index;
    assert.ok(
      position > previousMaintenanceStep,
      `runbook maintenance step ${expectedStep} must appear in operational order`,
    );
    previousMaintenanceStep = position;
  }

  const releaseVerification = readme.match(
    /## Verification\s+```bash\n([\s\S]*?)\n```/,
  );
  assert.ok(releaseVerification, "README must retain release verification");
  assert.match(
    releaseVerification[1],
    /^npm run test:migrations$/m,
    "README release verification must require live migration tests",
  );
});

function withTemporaryDatabase(run: (database: string) => void): void {
  const database = makeDisposableDatabaseName("workspace_identity");
  execFileSync("createdb", [database], { stdio: "pipe" });
  try {
    run(database);
  } finally {
    execFileSync("dropdb", ["--if-exists", database], { stdio: "pipe" });
  }
}

function applySql(database: string, path: string): void {
  execFileSync(
    "psql",
    ["-v", "ON_ERROR_STOP=1", "-d", database, "-f", path],
    { stdio: "pipe" },
  );
}

function executeSql(database: string, sql: string): string {
  return execFileSync(
    "psql",
    ["-v", "ON_ERROR_STOP=1", "-d", database, "-AtF", "|", "-c", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

function constraintDefinition(database: string, name: string): string {
  return executeSql(database, `
    select pg_get_constraintdef(oid)
    from pg_constraint
    where connamespace = 'public'::regnamespace
      and conname = '${name}';
  `);
}

function seedLegacyWorkspace(database: string): void {
  executeSql(database, `
    insert into public.workspaces (id, name)
    values ('workspace_one', 'One'), ('workspace_two', 'Two');
    insert into public.source_documents (
      id, filename, title, role, checksum, byte_size, object_key
    ) values (
      'document_shared', 'shared.txt', 'Shared', 'deal_document',
      'checksum_shared', 10, 'private/shared.txt'
    );
    insert into public.companies (id, workspace_id, name)
    values ('company_shared', 'workspace_one', 'One company');
    insert into public.deals (id, workspace_id, company_id, company_name)
    values (
      'deal_shared', 'workspace_one', 'company_shared', 'One company'
    );
    insert into public.source_evidence (
      id, workspace_id, document_id, deal_id, company_name, provenance,
      page, fact, excerpt
    ) values (
      'evidence_shared', 'workspace_one', 'document_shared', 'deal_shared',
      'One company', 'source_document', 1, 'One fact', 'One excerpt'
    );
    insert into public.deal_interactions (
      id, workspace_id, document_id, deal_id, company_name, occurred_at,
      provenance, label, status, decision_reason, concerns,
      revisit_conditions, meeting_summary
    ) values (
      'fixture_shared', 'workspace_one', 'document_shared', 'deal_shared',
      'One company', now(), 'demo_fixture', 'Sample decision record',
      'screening', 'One reason', '[]', '[]', 'One summary'
    );
    insert into public.scan_runs (
      id, workspace_id, mode, window_days, status
    ) values (
      '00000000-0000-4000-8000-000000000001',
      'workspace_one', 'structured', 14, 'completed'
    );
    insert into public.scan_run_steps (run_id, stage, status)
    values (
      '00000000-0000-4000-8000-000000000001', 'market_scan', 'completed'
    );
    insert into public.intelligence_reports (
      id, workspace_id, run_id, market_summary
    ) values (
      'report_shared', 'workspace_one',
      '00000000-0000-4000-8000-000000000001', 'One report'
    );
    insert into public.company_analyses (
      id, workspace_id, report_id, run_id, deal_id, company_name,
      deal_status, outcome, confidence, score, investment_memory,
      market_evidence, implications, recommended_next_move,
      company_brief, source_refs
    ) values (
      'analysis_shared', 'workspace_one', 'report_shared',
      '00000000-0000-4000-8000-000000000001', 'deal_shared',
      'One company', 'screening', 'no_material_change', 'medium', 0.5,
      '{}', '{}', '{}', 'Review', '{}', '[]'
    );
    insert into public.xtrace_ingest_jobs (
      job_id, workspace_id, deal_id, bundle_fingerprint,
      serializer_version, provenance, status
    ) values (
      'job_shared', 'workspace_one', 'deal_shared', 'fingerprint_one',
      'deal-memory-v1', 'source_document', 'succeeded'
    );
    insert into public.xtrace_memory_links (
      memory_id, workspace_id, deal_id, provenance
    ) values (
      'memory_shared', 'workspace_one', 'deal_shared', 'source_document'
    );
    insert into public.uploaded_documents (
      id, workspace_id, filename, content_type, byte_size,
      checksum, object_key
    ) values (
      'upload_shared', 'workspace_one', 'shared.txt', 'text/plain', 10,
      'upload_checksum_shared', 'private/workspaces/one/shared.txt'
    );
  `);
}

function seedSecondWorkspaceWithSharedExternalIds(database: string): void {
  executeSql(database, `
    insert into public.companies (id, workspace_id, name)
    values ('company_shared', 'workspace_two', 'Two company');
    insert into public.deals (id, workspace_id, company_id, company_name)
    values (
      'deal_shared', 'workspace_two', 'company_shared', 'Two company'
    );
    insert into public.source_evidence (
      id, workspace_id, document_id, deal_id, company_name, provenance,
      page, fact, excerpt
    ) values (
      'evidence_shared', 'workspace_two', 'document_shared', 'deal_shared',
      'Two company', 'source_document', 1, 'Two fact', 'Two excerpt'
    );
    insert into public.deal_interactions (
      id, workspace_id, document_id, deal_id, company_name, occurred_at,
      provenance, label, status, decision_reason, concerns,
      revisit_conditions, meeting_summary
    ) values (
      'fixture_shared', 'workspace_two', 'document_shared', 'deal_shared',
      'Two company', now(), 'demo_fixture', 'Sample decision record',
      'screening', 'Two reason', '[]', '[]', 'Two summary'
    );
    insert into public.scan_runs (
      id, workspace_id, mode, window_days, status
    ) values (
      '00000000-0000-4000-8000-000000000002',
      'workspace_two', 'structured', 14, 'completed'
    );
    insert into public.scan_run_steps (
      workspace_id, run_id, stage, status
    ) values (
      'workspace_two', '00000000-0000-4000-8000-000000000002',
      'market_scan', 'completed'
    );
    insert into public.xtrace_ingest_jobs (
      job_id, workspace_id, deal_id, bundle_fingerprint,
      serializer_version, provenance, status
    ) values (
      'job_shared', 'workspace_two', 'deal_shared', 'fingerprint_two',
      'deal-memory-v1', 'source_document', 'succeeded'
    );
    insert into public.xtrace_memory_links (
      memory_id, workspace_id, deal_id, provenance
    ) values (
      'memory_shared', 'workspace_two', 'deal_shared', 'source_document'
    );
    insert into public.uploaded_documents (
      id, workspace_id, filename, content_type, byte_size,
      checksum, object_key
    ) values (
      'upload_shared', 'workspace_two', 'shared.txt', 'text/plain', 10,
      'upload_checksum_shared', 'private/workspaces/two/shared.txt'
    );

    select id
    from public.save_intelligence_report(
      jsonb_build_object(
        'id', 'report_shared',
        'workspaceId', 'workspace_two',
        'runId', '00000000-0000-4000-8000-000000000002',
        'marketSummary', 'Two report',
        'opportunities', '[]'::jsonb
      ),
      jsonb_build_array(jsonb_build_object(
        'id', 'analysis_shared',
        'runId', '00000000-0000-4000-8000-000000000002',
        'dealId', 'deal_shared',
        'companyName', 'Two company',
        'dealStatus', 'screening',
        'outcome', 'no_material_change',
        'confidence', 'medium',
        'score', 0.5,
        'investmentMemory', '{}'::jsonb,
        'marketEvidence', '{}'::jsonb,
        'implications', '{}'::jsonb,
        'recommendedNextMove', 'Review',
        'companyBrief', '{}'::jsonb,
        'sourceRefs', '[]'::jsonb
      ))
    );
  `);
}
