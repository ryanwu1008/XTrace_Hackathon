import assert from "node:assert/strict";
import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";
import { makeDisposableDatabaseName, requireLoopbackPostgres } from "../helpers/require-loopback-postgres";

const execFileAsync = promisify(execFile);

const freshSchemaPath = fileURLToPath(
  new URL("../../drizzle/0000_vsee_postgres.sql", import.meta.url),
);
const removeDeliveryPath = fileURLToPath(
  new URL("../../drizzle/0001_remove_report_delivery.sql", import.meta.url),
);
const durabilityMigrationPath = fileURLToPath(
  new URL("../../drizzle/0002_durable_decision_lineage.sql", import.meta.url),
);
const registryMigrationPath = fileURLToPath(
  new URL(
    "../../drizzle/0009_source_revision_deal_registry.sql",
    import.meta.url,
  ),
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
const requirePostgres = process.env.REQUIRE_POSTGRES_MIGRATION_TESTS === "1";

function withTemporaryDatabase(run: (database: string) => void): void {
  const database = makeDisposableDatabaseName("migration");
  execFileSync("createdb", [database], { stdio: "pipe" });
  try {
    run(database);
  } finally {
    execFileSync("dropdb", ["--if-exists", database], { stdio: "pipe" });
  }
}

async function withTemporaryDatabaseAsync(
  run: (database: string) => Promise<void>,
): Promise<void> {
  const database = makeDisposableDatabaseName("migration_async");
  execFileSync("createdb", [database], { stdio: "pipe" });
  try {
    await run(database);
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

function dropOwnerLifecycleTestRoles(): void {
  executeSql("postgres", `
    drop role if exists vsee_underwriting_hostile_member;
    drop role if exists vsee_registry_hostile_member;
    drop role if exists vsee_underwriting_owner;
    drop role if exists vsee_registry_owner;
  `);
}

async function executeSqlAsync(database: string, sql: string): Promise<string> {
  const result = await execFileAsync(
    "psql",
    ["-v", "ON_ERROR_STOP=1", "-d", database, "-AtF", "|", "-c", sql],
    { encoding: "utf8" },
  );
  return result.stdout.trim();
}

type PsqlExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

function spawnPsql(
  database: string,
  arguments_: string[] = [],
  environment: Partial<NodeJS.ProcessEnv> = {},
) {
  const child = spawn(
    "psql",
    ["-v", "ON_ERROR_STOP=1", "-d", database, "-qAt", ...arguments_],
    {
      env: { ...process.env, ...environment },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  return child;
}

function observePsqlExit(child: ReturnType<typeof spawnPsql>): Promise<PsqlExit> {
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function waitForPsqlMarker(
  child: ReturnType<typeof spawnPsql>,
  marker: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for PostgreSQL marker: ${marker}`));
    }, 5_000);
    const onData = (chunk: string) => {
      stdout += chunk;
      if (stdout.includes(marker)) {
        cleanup();
        resolve();
      }
    };
    const onClose = () => {
      cleanup();
      reject(new Error(`PostgreSQL exited before marker: ${marker}`));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.off("close", onClose);
    };
    child.stdout.on("data", onData);
    child.once("close", onClose);
  });
}

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function waitForMigrationRelationLock(
  database: string,
  migrationApplicationName: string,
  writerApplicationName: string,
  relationName: string,
  migration: ReturnType<typeof spawnPsql>,
): Promise<boolean> {
  const deadline = Date.now() + 5_000;
  while (
    Date.now() < deadline
    && migration.exitCode === null
    && migration.signalCode === null
  ) {
    const waiting = executeSql(database, `
      select exists (
        select 1
        from pg_catalog.pg_stat_activity as migration_activity
        join pg_catalog.pg_locks as waiting_lock
          on waiting_lock.pid = migration_activity.pid
        where migration_activity.application_name = '${migrationApplicationName}'
          and migration_activity.wait_event_type = 'Lock'
          and waiting_lock.relation = 'public.${relationName}'::regclass
          and waiting_lock.mode = 'AccessExclusiveLock'
          and not waiting_lock.granted
          and exists (
            select 1
            from pg_catalog.pg_stat_activity as writer_activity
            join pg_catalog.pg_locks as writer_lock
              on writer_lock.pid = writer_activity.pid
            where writer_activity.application_name = '${writerApplicationName}'
              and writer_lock.relation = waiting_lock.relation
              and writer_lock.mode = 'RowExclusiveLock'
              and writer_lock.granted
          )
      );
    `);
    if (waiting === "t") {
      return true;
    }
    await delay(25);
  }
  return false;
}

async function assertMigrationWaitsForWriterThenRefuses(input: {
  database: string;
  migration: string;
  writerSql: string;
  writerRelation: string;
  targetAbsentSql: string;
}): Promise<void> {
  const writerApplicationName = `vsee-writer-guard-${randomUUID()}`;
  const writer = spawnPsql(
    input.database,
    [],
    { PGAPPNAME: writerApplicationName },
  );
  const writerExit = observePsqlExit(writer);
  let migration: ReturnType<typeof spawnPsql> | undefined;
  let migrationExit: Promise<PsqlExit> | undefined;
  try {
    writer.stdin.write(`begin;\n${input.writerSql}\nselect 'writer-ready';\n`);
    await waitForPsqlMarker(writer, "writer-ready");

    const migrationApplicationName =
      `vsee-migration-guard-${randomUUID()}`;
    migration = spawnPsql(
      input.database,
      [
        "-c",
        "set default_transaction_isolation to 'repeatable read'",
        "-f",
        input.migration,
      ],
      { PGAPPNAME: migrationApplicationName },
    );
    migrationExit = observePsqlExit(migration);
    const initialState = await waitForMigrationRelationLock(
      input.database,
      migrationApplicationName,
      writerApplicationName,
      input.writerRelation,
      migration,
    );
    assert.equal(
      initialState,
      true,
      "the migration must wait for the uncommitted writer's table lock",
    );

    writer.stdin.end("commit;\n\\q\n");
    const [writerResult, migrationResult] = await Promise.all([
      writerExit,
      migrationExit,
    ]);
    assert.equal(
      writerResult.code,
      0,
      `writer failed: ${writerResult.stdout}${writerResult.stderr}`,
    );
    assert.notEqual(
      migrationResult.code,
      0,
      "the migration must abort after observing the newly committed active work",
    );
    assert.match(
      `${migrationResult.stdout}${migrationResult.stderr}`,
      /active scans or upload leases remain|maintenance/i,
    );
    assert.equal(executeSql(input.database, input.targetAbsentSql), "t");
  } finally {
    if (writer.exitCode === null && writer.signalCode === null) {
      writer.stdin.end("rollback;\n\\q\n");
      await Promise.race([writerExit, delay(1_000)]);
      if (writer.exitCode === null && writer.signalCode === null) {
        writer.kill("SIGKILL");
      }
    }
    if (
      migration
      && migration.exitCode === null
      && migration.signalCode === null
    ) {
      migration.kill("SIGKILL");
      if (migrationExit) {
        await Promise.race([migrationExit, delay(1_000)]);
      }
    }
  }
}

test(
  "production migrations wait for concurrent writers and reject their newly committed active work",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  async (t) => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    const migrationPath = (filename: string) =>
      fileURLToPath(new URL(`../../drizzle/${filename}`, import.meta.url));
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
      "0015_framework_catalog_checkpoint.sql",
      "0016_confirmed_upload_source_evidence_bridge.sql",
      "0017_public_sandbox_test_generations.sql",
      "0018_pgcrypto_registry_schema_usage.sql",
    ];
    const guardCases = [
      {
        id: "0008",
        writer: "scan",
        targetAbsentSql: `
          select not exists (
            select 1
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'scan_run_steps'
              and column_name = 'workspace_id'
          )
        `,
      },
      {
        id: "0009",
        writer: "upload_without_token",
        targetAbsentSql:
          "select to_regclass('public.source_revisions') is null",
      },
      {
        id: "0010",
        writer: "scan",
        targetAbsentSql:
          "select to_regclass('public.benchmark_packs') is null",
      },
      {
        id: "0011",
        writer: "scan",
        targetAbsentSql:
          "select to_regclass('public.underwriting_batches') is null",
      },
      {
        id: "0012",
        writer: "scan",
        targetAbsentSql: `
          select not exists (
            select 1
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'candidate_runs'
              and column_name = 'artifact_source_candidate_run_id'
          )
        `,
      },
      {
        id: "0013",
        writer: "upload_without_token",
        targetAbsentSql: `
          select not exists (
            select 1
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'uploaded_documents'
              and column_name = 'lease_token'
          )
        `,
      },
      {
        id: "0014",
        writer: "scan",
        targetAbsentSql: `
          select to_regclass(
            'public.action_drafts_workspace_artifact_unique'
          ) is null
        `,
      },
      {
        id: "0015",
        writer: "scan",
        targetAbsentSql: `
          select not exists (
            select 1
            from pg_catalog.pg_constraint
            where conrelid = 'public.candidate_checkpoints'::regclass
              and conname = 'candidate_checkpoints_stage_check'
              and pg_catalog.pg_get_constraintdef(oid)
                like '%framework_catalog%'
          )
        `,
      },
      {
        id: "0016",
        writer: "upload_with_token",
        targetAbsentSql: `
          select not exists (
            select 1
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'source_evidence_items'
              and column_name = 'source_id'
          )
        `,
      },
      {
        id: "0017",
        writer: "scan",
        targetAbsentSql:
          "select to_regclass('public.workspace_test_generations') is null",
      },
    ] as const;

    for (const guardCase of guardCases) {
      const writerLabel = guardCase.writer === "scan" ? "scan" : "upload";
      await t.test(`${writerLabel} writer blocks ${guardCase.id}`, async () => {
        await withTemporaryDatabaseAsync(async (database) => {
          const migrationIndex = migrations.findIndex((migration) =>
            migration.startsWith(`${guardCase.id}_`)
          );
          assert.notEqual(migrationIndex, -1);
          for (const migration of migrations.slice(0, migrationIndex)) {
            applySql(database, migrationPath(migration));
          }
          const workspaceId = `workspace_guard_${guardCase.id}`;
          executeSql(database, `
            insert into public.workspaces (id, name)
            values ('${workspaceId}', 'Guard ${guardCase.id}');
          `);
          const writerSql = guardCase.writer === "scan"
            ? `
              insert into public.scan_runs (
                workspace_id, mode, status, worker_id, lease_expires_at
              ) values (
                '${workspaceId}', 'structured', 'running',
                'writer-before-${guardCase.id}',
                clock_timestamp() + interval '10 minutes'
              );
            `
            : `
              insert into public.uploaded_documents (
                id, workspace_id, filename, content_type, byte_size,
                checksum, object_key, status, worker_id,
                ${guardCase.writer === "upload_with_token"
                  ? "lease_token,"
                  : ""}
                lease_expires_at
              ) values (
                'upload_guard_${guardCase.id}', '${workspaceId}',
                'guard.txt', 'text/plain', 12,
                'checksum_guard_${guardCase.id}',
                'private/${workspaceId}/guard.txt', 'extracting',
                'writer-before-${guardCase.id}',
                ${guardCase.writer === "upload_with_token"
                  ? "gen_random_uuid(),"
                  : ""}
                clock_timestamp() + interval '10 minutes'
              );
            `;
          await assertMigrationWaitsForWriterThenRefuses({
            database,
            migration: migrationPath(migrations[migrationIndex]!),
            writerSql,
            writerRelation: guardCase.writer === "scan"
              ? "scan_runs"
              : "uploaded_documents",
            targetAbsentSql: guardCase.targetAbsentSql,
          });
        });
      });
    }
  },
);

test(
  "fresh PostgreSQL schema requires durable decision and XTrace reuse metadata",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    assert.ok(existsSync(durabilityMigrationPath), "forward durability migration must exist");
    withTemporaryDatabase((database) => {
      applySql(database, freshSchemaPath);
      applySql(database, removeDeliveryPath);
      applySql(database, durabilityMigrationPath);

      const columns = executeSql(database, `
        select table_name || '.' || column_name || ':' || is_nullable
        from information_schema.columns
        where table_schema = 'public'
          and (
            (table_name = 'deal_interactions' and column_name = 'decision_reason')
            or (
              table_name = 'xtrace_ingest_jobs'
              and column_name in ('bundle_fingerprint', 'serializer_version')
            )
          )
        order by table_name, column_name;
      `);

      assert.equal(columns, [
        "deal_interactions.decision_reason:NO",
        "xtrace_ingest_jobs.bundle_fingerprint:NO",
        "xtrace_ingest_jobs.serializer_version:NO",
      ].join("\n"));
    });
  },
);

test(
  "owner-role migrations fail closed on unsafe attributes and extra memberships",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  async (t) => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    const migrationPath = (name: string) =>
      fileURLToPath(new URL(`../../drizzle/${name}`, import.meta.url));
    const through0008 = [
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
    const scenarios = [
      {
        name: "registry owner unsafe attributes",
        ownerRole: "vsee_registry_owner",
        hostileMember: null,
        prerequisites: through0008,
        target: "0009_source_revision_deal_registry.sql",
        rollbackSentinel: "public.source_revisions",
      },
      {
        name: "registry owner extra membership",
        ownerRole: "vsee_registry_owner",
        hostileMember: "vsee_registry_hostile_member",
        prerequisites: through0008,
        target: "0009_source_revision_deal_registry.sql",
        rollbackSentinel: "public.source_revisions",
      },
      {
        name: "underwriting owner unsafe attributes",
        ownerRole: "vsee_underwriting_owner",
        hostileMember: null,
        prerequisites: [
          ...through0008,
          "0009_source_revision_deal_registry.sql",
          "0010_underwriting_references.sql",
        ],
        target: "0011_underwriting_runs.sql",
        rollbackSentinel: "public.candidate_runs",
      },
      {
        name: "underwriting owner extra membership",
        ownerRole: "vsee_underwriting_owner",
        hostileMember: "vsee_underwriting_hostile_member",
        prerequisites: [
          ...through0008,
          "0009_source_revision_deal_registry.sql",
          "0010_underwriting_references.sql",
        ],
        target: "0011_underwriting_runs.sql",
        rollbackSentinel: "public.candidate_runs",
      },
    ];

    for (const scenario of scenarios) {
      await t.test(scenario.name, () => {
        dropOwnerLifecycleTestRoles();
        try {
          withTemporaryDatabase((database) => {
            for (const prerequisite of scenario.prerequisites) {
              applySql(database, migrationPath(prerequisite));
            }
            executeSql(database, `
              create role ${scenario.ownerRole}
                nologin ${scenario.hostileMember ? "noinherit" : "inherit"};
              ${
                scenario.hostileMember
                  ? `create role ${scenario.hostileMember} nologin noinherit;
                     grant ${scenario.ownerRole}
                       to ${scenario.hostileMember};`
                  : ""
              }
            `);

            assert.throws(() =>
              applySql(database, migrationPath(scenario.target))
            );
            assert.equal(
              executeSql(database, `
                select pg_catalog.to_regclass(
                  '${scenario.rollbackSentinel}'
                ) is null;
              `),
              "t",
            );
          });
        } finally {
          dropOwnerLifecycleTestRoles();
        }
      });
    }
  },
);

test(
  "0009 installs immutable workspace-scoped source revisions and atomic Deal assignment",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    assert.ok(
      existsSync(registryMigrationPath),
      "source revision registry migration must exist",
    );
    withTemporaryDatabase((database) => {
      executeSql(database, `
        do $$
        begin
          create role service_role nologin noinherit bypassrls;
        exception when duplicate_object then null;
        end;
        $$;
        do $$
        begin
          create role vsee_registry_owner nologin noinherit;
        exception when duplicate_object then null;
        end;
        $$;
      `);
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
      ];
      for (const migration of migrations) {
        applySql(
          database,
          fileURLToPath(new URL(`../../drizzle/${migration}`, import.meta.url)),
        );
      }

      assert.equal(
        executeSql(database, `
          select table_name
          from information_schema.tables
          where table_schema = 'public'
            and table_name in (
              'source_revisions',
              'source_revision_annotations',
              'deal_source_assignments'
            )
          order by table_name;
        `),
        [
          "deal_source_assignments",
          "source_revision_annotations",
          "source_revisions",
        ].join("\n"),
      );
      const mirroredConstraints = [
        "deals_status_check",
        "source_revisions_revision_check",
        "source_revisions_content_hash_check",
        "source_revisions_object_key_check",
        "source_revisions_object_version_check",
        "source_revisions_content_type_check",
        "source_revisions_extractor_id_check",
        "source_revisions_extractor_version_check",
        "source_revisions_initial_link_check",
        "source_revision_annotations_kind_check",
        "source_revision_annotations_reason_check",
        "deal_source_assignments_request_id_check",
        "deal_source_assignments_request_fingerprint_check",
        "deal_source_assignments_assigned_by_user_id_check",
        "deal_source_assignments_reason_check",
        "deal_source_assignments_supersession_time_check",
        "intelligence_reports_eligible_snapshot_check",
      ];
      const schemaSource = readFileSync(
        fileURLToPath(new URL("../../db/schema.ts", import.meta.url)),
        "utf8",
      );
      for (const constraint of mirroredConstraints) {
        assert.match(schemaSource, new RegExp(constraint));
      }
      assert.equal(
        executeSql(database, `
          select count(*)
          from pg_constraint
          where connamespace = 'public'::regnamespace
            and conname = any(array[
              ${mirroredConstraints.map((name) => `'${name}'`).join(",")}
            ]);
        `),
        String(mirroredConstraints.length),
      );
      assert.equal(
        executeSql(database, `
          select rel.relname || '|' || con.conname || '|'
            || pg_get_constraintdef(con.oid)
          from pg_constraint as con
          join pg_class as rel on rel.oid = con.conrelid
          where con.connamespace = 'public'::regnamespace
            and con.conname = 'deals_status_check';
        `),
        "deals|deals_status_check|CHECK ((status = ANY (ARRAY['screening'::text, 'watchlist'::text, 'evaluating'::text, 'passed'::text, 'invested'::text])))",
      );
      assert.doesNotThrow(() =>
        executeSql(database, `
          insert into public.workspaces (id, name)
          values ('workspace_schema_check', 'Schema check');
          insert into public.scan_runs (
            id, workspace_id, mode, status
          ) values (
            '00000000-0000-4000-8000-000000000399',
            'workspace_schema_check', 'structured', 'completed'
          );
          insert into public.scan_run_steps (
            id, workspace_id, run_id, stage, status
          ) values (
            '00000000-0000-4000-8000-000000000398',
            'workspace_schema_check',
            '00000000-0000-4000-8000-000000000399',
            'analyze_companies', 'running'
          );
          update public.scan_run_steps
          set status = 'completed', completed_at = now()
          where id = '00000000-0000-4000-8000-000000000398';
        `)
      );
      assert.match(
        executeSql(database, `
          select pg_get_indexdef(indexrelid)
          from pg_index
          where indexrelid =
            'public.deal_source_assignments_one_active_source'::regclass;
        `),
        /workspace_id.*deal_id.*source_id.*superseded_at IS NULL/i,
      );
      assert.equal(
        executeSql(database, `
          select column_name || ':' || is_nullable
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'deals'
            and column_name in (
              'analysis_eligible_at',
              'active_source_revision_fingerprint',
              'status'
            )
          order by column_name;
        `),
        [
          "active_source_revision_fingerprint:YES",
          "analysis_eligible_at:YES",
          "status:NO",
        ].join("\n"),
      );
      assert.equal(
        executeSql(database, `
          select routine_name
          from information_schema.routines
          where routine_schema = 'public'
            and routine_name in (
              'append_source_revision',
              'confirm_source_assignment',
              'create_initial_source_revision'
            )
          order by routine_name;
        `),
        [
          "append_source_revision",
          "confirm_source_assignment",
          "create_initial_source_revision",
        ].join("\n"),
      );

      executeSql(database, `
        insert into public.workspaces (id, name)
        values ('workspace_one', 'One'), ('workspace_two', 'Two');
        select id
        from public.create_initial_source_revision(jsonb_build_object(
          'id', 'revision_shared',
          'workspaceId', 'workspace_one',
          'sourceId', 'source_one',
          'contentHash', 'hash_one',
          'objectKey', 'private/workspace_one/source_one.pdf',
          'objectVersion', 'hash_one',
          'contentType', 'application/pdf',
          'extractorId', 'pdf-text',
          'extractorVersion', '1',
          'extractedAt', '2026-07-28T10:00:00.000Z',
          'createdAt', '2026-07-28T10:00:01.000Z'
        ));
        select id
        from public.create_initial_source_revision(jsonb_build_object(
          'id', 'revision_shared',
          'workspaceId', 'workspace_one',
          'sourceId', 'source_one',
          'contentHash', 'hash_one',
          'objectKey', 'private/workspace_one/source_one.pdf',
          'objectVersion', 'hash_one',
          'contentType', 'application/pdf',
          'extractorId', 'pdf-text',
          'extractorVersion', '1',
          'extractedAt', '2026-07-28T10:00:00.000Z',
          'createdAt', '2026-07-28T10:00:01.000Z'
        ));
        select id
        from public.append_source_revision(jsonb_build_object(
          'id', 'revision_two',
          'workspaceId', 'workspace_one',
          'sourceId', 'source_one',
          'contentHash', 'hash_two',
          'objectKey', 'private/workspace_one/source_one-v2.pdf',
          'objectVersion', 'hash_two',
          'contentType', 'application/pdf',
          'extractorId', 'pdf-text',
          'extractorVersion', '1',
          'extractedAt', '2026-07-28T11:00:00.000Z',
          'createdAt', '2026-07-28T11:00:01.000Z',
          'supersedesRevisionId', 'revision_shared'
        ));
        select id
        from public.create_initial_source_revision(jsonb_build_object(
          'id', 'revision_shared',
          'workspaceId', 'workspace_two',
          'sourceId', 'source_one',
          'contentHash', 'hash_workspace_two',
          'objectKey', 'private/workspace_two/source_one.pdf',
          'objectVersion', 'hash_workspace_two',
          'contentType', 'application/pdf',
          'extractorId', 'pdf-text',
          'extractorVersion', '1',
          'extractedAt', '2026-07-28T10:00:00.000Z',
          'createdAt', '2026-07-28T10:00:01.000Z'
        ));
      `);
      assert.equal(
        executeSql(database, `
          select workspace_id || '|' || id || '|' || revision
          from public.source_revisions
          order by workspace_id, revision;
        `),
        [
          "workspace_one|revision_shared|1",
          "workspace_one|revision_two|2",
          "workspace_two|revision_shared|1",
        ].join("\n"),
      );
      assert.throws(() =>
        executeSql(database, `
          update public.source_revisions
          set content_hash = 'mutated'
          where workspace_id = 'workspace_one'
            and id = 'revision_shared';
        `)
      );
      executeSql(database, `
        insert into public.scan_runs (
          id, workspace_id, mode, status
        ) values (
          '00000000-0000-4000-8000-000000000300',
          'workspace_two', 'structured', 'running'
        );
      `);
      executeSql(database, `
        select * from public.save_intelligence_report(
          jsonb_build_object(
            'id', 'report_legacy_transition',
            'workspaceId', 'workspace_two',
            'runId', '00000000-0000-4000-8000-000000000300',
            'createdAt', '2026-07-28T12:31:00.000Z',
            'marketSummary', 'Legacy report.'
          ),
          '[]'::jsonb
        );
      `);
      assert.throws(() =>
        executeSql(database, `
          select * from public.save_intelligence_report(
            jsonb_build_object(
              'id', 'report_legacy_transition',
              'workspaceId', 'workspace_two',
              'runId', '00000000-0000-4000-8000-000000000300',
              'companyCount', 0,
              'eligibleSnapshotCount', 0,
              'eligibleSnapshotFingerprint',
                'sha256:b191db9f70688d445f293772932f76525aa10fdee96a0d4b696357c4fc2aca54'
            ),
            '[]'::jsonb
          );
        `)
      );
      assert.throws(() =>
        executeSql(database, `
          select id
          from public.append_source_revision(jsonb_build_object(
            'id', 'revision_stale',
            'workspaceId', 'workspace_one',
            'sourceId', 'source_one',
            'contentHash', 'hash_stale',
            'objectKey', 'private/stale.pdf',
            'objectVersion', 'hash_stale',
            'contentType', 'application/pdf',
            'extractorId', 'pdf-text',
            'extractorVersion', '1',
            'extractedAt', '2026-07-28T12:00:00.000Z',
            'createdAt', '2026-07-28T12:00:01.000Z',
            'supersedesRevisionId', 'revision_shared'
          ));
        `)
      );
      assert.throws(() =>
        executeSql(database, `
          insert into public.source_revisions (
            id, workspace_id, source_id, revision, content_hash, object_key,
            object_version, content_type, extractor_id, extractor_version,
            extracted_at, supersedes_revision_id, created_at
          ) values (
            'revision_four_invalid', 'workspace_one', 'source_one', 4,
            'hash_four', 'private/four.pdf', 'hash_four',
            'application/pdf', 'pdf-text', '1', now(), 'revision_two', now()
          );
        `)
      );

      executeSql(database, `
        select public.confirm_source_assignment(jsonb_build_object(
          'requestId', 'request_one',
          'workspaceId', 'workspace_one',
          'dealId', 'deal_one',
          'companyId', 'company_one',
          'companyName', 'Company one',
          'status', 'screening',
          'sourceRevisionId', 'revision_two',
          'assignedByUserId', 'user_one',
          'reason', 'Confirmed source ownership.',
          'confirmedAt', '2026-07-28T12:00:00.000Z'
        ));
        select public.confirm_source_assignment(jsonb_build_object(
          'requestId', 'request_one',
          'workspaceId', 'workspace_one',
          'dealId', 'deal_one',
          'companyId', 'company_one',
          'companyName', 'Company one',
          'status', 'screening',
          'sourceRevisionId', 'revision_two',
          'assignedByUserId', 'user_one',
          'reason', 'Confirmed source ownership.',
          'confirmedAt', '2026-07-28T12:00:00.000Z'
        ));
      `);
      assert.equal(
        executeSql(database, `
          select count(*) || '|' || to_char(
            max(deal.analysis_eligible_at) at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS"Z"'
          )
            || '|' || max(deal.active_source_revision_fingerprint)
          from public.deal_source_assignments as assignment
          join public.deals as deal
            on deal.workspace_id = assignment.workspace_id
            and deal.id = assignment.deal_id
          where assignment.workspace_id = 'workspace_one'
            and assignment.deal_id = 'deal_one';
        `),
        "1|2026-07-28T12:00:00Z|sha256:e261978d1aa749a6b4efa250d1e6ce21d151c1dc124dcfda394aa0d7ef936743",
      );
      assert.doesNotThrow(() =>
        executeSql(database, `
          set timezone = 'UTC';
          select public.confirm_source_assignment(jsonb_build_object(
            'requestId', 'request_timezone',
            'workspaceId', 'workspace_one',
            'dealId', 'deal_timezone',
            'companyId', 'company_timezone',
            'companyName', 'Timezone Company',
            'status', 'screening',
            'sourceRevisionId', 'revision_two',
            'assignedByUserId', 'user_one',
            'reason', 'Canonical timestamp replay.',
            'confirmedAt', '2026-07-28T12:00:00.123Z'
          ));
          set timezone = 'America/Los_Angeles';
          select public.confirm_source_assignment(jsonb_build_object(
            'requestId', 'request_timezone',
            'workspaceId', 'workspace_one',
            'dealId', 'deal_timezone',
            'companyId', 'company_timezone',
            'companyName', 'Timezone Company',
            'status', 'screening',
            'sourceRevisionId', 'revision_two',
            'assignedByUserId', 'user_one',
            'reason', 'Canonical timestamp replay.',
            'confirmedAt', '2026-07-28T05:00:00.123-07:00'
          ));
        `)
      );
      assert.equal(
        executeSql(database, `
          select request_fingerprint
          from public.deal_source_assignments
          where workspace_id = 'workspace_one'
            and request_id = 'request_timezone';
        `),
        "sha256:823a1edbcb7c8880e9d928685f7bcd71d73930947feb29d74e5b16fef4903cee",
      );
      executeSql(database, `
        insert into public.workspaces (id, name)
        values ('workspace_snapshot', 'Snapshot');
      `);
      assert.throws(() =>
        executeSql(database, `
          select * from public.save_intelligence_report(
            jsonb_build_object(
              'id', 'report_caller_lie',
              'workspaceId', 'workspace_two',
              'runId', '00000000-0000-4000-8000-000000000300',
              'createdAt', '2026-07-28T12:30:00.000Z',
              'marketSummary', 'Caller-authored lie.',
              'companyCount', 0,
              'eligibleSnapshotCount', 0,
              'eligibleSnapshotFingerprint', 'caller-lie'
            ),
            '[]'::jsonb
          );
        `)
      );
      assert.match(
        executeSql(database, `
          select public.get_analysis_eligible_snapshot('workspace_one')::text;
        `),
        /"count": 2.*"dealIds": \["deal_one", "deal_timezone"\].*"fingerprint": "sha256:/,
      );
      executeSql(database, `
        select id from public.append_source_revision(jsonb_build_object(
          'id', 'revision_three',
          'workspaceId', 'workspace_one',
          'sourceId', 'source_one',
          'contentHash', 'hash_three',
          'objectKey', 'private/workspace_one/source-one-v3.pdf',
          'objectVersion', 'hash_three',
          'contentType', 'application/pdf',
          'extractorId', 'pdf-text',
          'extractorVersion', '1',
          'extractedAt', '2026-07-28T13:00:00.000Z',
          'createdAt', '2026-07-28T13:00:01.000Z',
          'supersedesRevisionId', 'revision_two'
        ));
      `);
      assert.equal(
        executeSql(database, `
          select revision from public.append_source_revision(
            jsonb_build_object(
              'id', 'revision_two',
              'workspaceId', 'workspace_one',
              'sourceId', 'source_one',
              'contentHash', 'hash_two',
              'objectKey', 'private/workspace_one/source_one-v2.pdf',
              'objectVersion', 'hash_two',
              'contentType', 'application/pdf',
              'extractorId', 'pdf-text',
              'extractorVersion', '1',
              'extractedAt', '2026-07-28T11:00:00.000Z',
              'createdAt', '2026-07-28T11:00:01.000Z',
              'supersedesRevisionId', 'revision_shared'
            )
          );
        `),
        "2",
      );
      assert.throws(() =>
        executeSql(database, `
          select revision from public.append_source_revision(
            jsonb_build_object(
              'id', 'revision_two',
              'workspaceId', 'workspace_one',
              'sourceId', 'source_one',
              'contentHash', 'different',
              'objectKey', 'private/workspace_one/source_one-v2.pdf',
              'objectVersion', 'hash_two',
              'contentType', 'application/pdf',
              'extractorId', 'pdf-text',
              'extractorVersion', '1',
              'extractedAt', '2026-07-28T11:00:00.000Z',
              'createdAt', '2026-07-28T11:00:01.000Z',
              'supersedesRevisionId', 'revision_shared'
            )
          );
        `)
      );
      executeSql(database, `
        select public.confirm_source_assignment(jsonb_build_object(
          'requestId', 'request_chronology_equal',
          'workspaceId', 'workspace_one',
          'dealId', 'deal_one',
          'companyId', 'company_one',
          'companyName', 'Company one',
          'status', 'screening',
          'sourceRevisionId', 'revision_three',
          'assignedByUserId', 'user_one',
          'reason', 'Equal-time supersession.',
          'confirmedAt', '2026-07-28T12:00:00.000Z'
        ));
        select id from public.append_source_revision(jsonb_build_object(
          'id', 'revision_four',
          'workspaceId', 'workspace_one',
          'sourceId', 'source_one',
          'contentHash', 'hash_four',
          'objectKey', 'private/workspace_one/source-one-v4.pdf',
          'objectVersion', 'hash_four',
          'contentType', 'application/pdf',
          'extractorId', 'pdf-text',
          'extractorVersion', '1',
          'extractedAt', '2026-07-28T13:30:00.000Z',
          'createdAt', '2026-07-28T13:30:01.000Z',
          'supersedesRevisionId', 'revision_three'
        ));
        select public.confirm_source_assignment(jsonb_build_object(
          'requestId', 'request_chronology_later',
          'workspaceId', 'workspace_one',
          'dealId', 'deal_one',
          'companyId', 'company_one',
          'companyName', 'Company one',
          'status', 'screening',
          'sourceRevisionId', 'revision_four',
          'assignedByUserId', 'user_one',
          'reason', 'Later-time supersession.',
          'confirmedAt', '2026-07-28T13:00:00.000Z'
        ));
        select id from public.append_source_revision(jsonb_build_object(
          'id', 'revision_five',
          'workspaceId', 'workspace_one',
          'sourceId', 'source_one',
          'contentHash', 'hash_five',
          'objectKey', 'private/workspace_one/source-one-v5.pdf',
          'objectVersion', 'hash_five',
          'contentType', 'application/pdf',
          'extractorId', 'pdf-text',
          'extractorVersion', '1',
          'extractedAt', '2026-07-28T14:00:00.000Z',
          'createdAt', '2026-07-28T14:00:01.000Z',
          'supersedesRevisionId', 'revision_four'
        ));
      `);
      assert.throws(() =>
        executeSql(database, `
          select public.confirm_source_assignment(jsonb_build_object(
            'requestId', 'request_chronology_backdated',
            'workspaceId', 'workspace_one',
            'dealId', 'deal_one',
            'companyId', 'company_one',
            'companyName', 'Company one',
            'status', 'screening',
            'sourceRevisionId', 'revision_five',
            'assignedByUserId', 'user_one',
            'reason', 'Backdated supersession.',
            'confirmedAt', '2026-07-28T12:59:59.999Z'
          ));
        `)
      );
      assert.equal(
        executeSql(database, `
          select count(*) || '|' || max(source_revision_id)
          from public.deal_source_assignments
          where workspace_id = 'workspace_one'
            and deal_id = 'deal_one'
            and superseded_at is null;
        `),
        "1|revision_four",
      );

      assert.equal(
        executeSql(database, `
          select rolsuper::text || '|' || rolinherit::text || '|'
            || rolcreaterole::text || '|' || rolcreatedb::text || '|'
            || rolcanlogin::text || '|' || rolreplication::text || '|'
            || rolbypassrls::text
          from pg_roles
          where rolname = 'vsee_registry_owner';
        `),
        "false|false|false|false|false|false|false",
      );
      assert.equal(
        executeSql(database, `
          select (
            (select rolsuper from pg_catalog.pg_roles
              where rolname = current_user)
            or exists (
              select 1
              from pg_catalog.pg_auth_members as membership
              where membership.roleid =
                  'vsee_registry_owner'::pg_catalog.regrole
                and membership.member = (
                  select oid from pg_catalog.pg_roles
                  where rolname = current_user
                )
                and membership.grantor = 10
      and (select rolsuper from pg_catalog.pg_roles where oid = membership.grantor)
                and membership.admin_option
                and not membership.inherit_option
                and not membership.set_option
            )
          ) and not exists (
            select 1
            from pg_catalog.pg_auth_members as membership
            where (
              membership.roleid =
                'vsee_registry_owner'::pg_catalog.regrole
              or membership.member =
                'vsee_registry_owner'::pg_catalog.regrole
            ) and not (
              not (
                select rolsuper from pg_catalog.pg_roles
                where rolname = current_user
              )
              and membership.roleid =
                'vsee_registry_owner'::pg_catalog.regrole
              and membership.member = (
                select oid from pg_catalog.pg_roles
                where rolname = current_user
              )
              and membership.grantor = 10
      and (select rolsuper from pg_catalog.pg_roles where oid = membership.grantor)
              and membership.admin_option
              and not membership.inherit_option
              and not membership.set_option
            )
          );
        `),
        "t",
      );
      assert.equal(
        executeSql(database, `
          select pg_has_role(
            'service_role', 'vsee_registry_owner', 'MEMBER'
          )::text;
        `),
        "false",
      );
      assert.equal(
        executeSql(database, `
          select p.proname || '|' || r.rolname || '|'
            || array_to_string(p.proconfig, ',')
          from pg_proc as p
          join pg_namespace as n on n.oid = p.pronamespace
          join pg_roles as r on r.oid = p.proowner
          where n.nspname = 'public'
            and p.proname in (
              'annotate_source_revision',
              'append_source_revision',
              'confirm_source_assignment',
              'create_initial_source_revision'
            )
          order by p.proname;
        `),
        [
          "annotate_source_revision|vsee_registry_owner|search_path=\"\"",
          "append_source_revision|vsee_registry_owner|search_path=\"\"",
          "confirm_source_assignment|vsee_registry_owner|search_path=\"\"",
          "create_initial_source_revision|vsee_registry_owner|search_path=\"\"",
        ].join("\n"),
      );
      executeSql(database, `
        set role service_role;
        select public.annotate_source_revision(jsonb_build_object(
          'workspaceId', 'workspace_one',
          'revisionId', 'revision_two',
          'kind', 'retracted',
          'reason', 'Verified RPC boundary.'
        ));
        select count(*) from public.source_revisions;
        reset role;
      `);
      assert.equal(
        executeSql(database, `
          select table_name || '|'
            || has_table_privilege(
              'service_role', 'public.' || table_name, 'INSERT'
            )::text || '|'
            || has_table_privilege(
              'service_role', 'public.' || table_name, 'UPDATE'
            )::text || '|'
            || has_table_privilege(
              'service_role', 'public.' || table_name, 'DELETE'
            )::text || '|'
            || has_table_privilege(
              'service_role', 'public.' || table_name, 'TRUNCATE'
            )::text
          from (values
            ('company_analyses'),
            ('intelligence_reports')
          ) as report_tables(table_name)
          order by table_name;
        `),
        [
          "company_analyses|false|false|false|false",
          "intelligence_reports|false|false|false|false",
        ].join("\n"),
      );
      for (const forbidden of [
        "insert into public.source_revisions (id) values ('bypass')",
        "insert into public.source_revision_annotations (workspace_id, revision_id, kind, reason) values ('workspace_one', 'revision_two', 'retracted', 'bypass')",
        "insert into public.deal_source_assignments (id) values ('bypass')",
        "update public.deals set analysis_eligible_at = now() where workspace_id = 'workspace_one' and id = 'deal_one'",
        "update public.deals set active_source_revision_fingerprint = 'bypass' where workspace_id = 'workspace_one' and id = 'deal_one'",
        "truncate public.source_revisions",
        "insert into public.intelligence_reports (id) values ('bypass')",
        "update public.intelligence_reports set market_summary = 'bypass'",
        "delete from public.intelligence_reports",
        "truncate public.intelligence_reports cascade",
        "insert into public.company_analyses (id) values ('bypass')",
        "update public.company_analyses set company_name = 'bypass'",
        "delete from public.company_analyses",
        "truncate public.company_analyses",
      ]) {
        assert.throws(() =>
          executeSql(database, `set role service_role; ${forbidden};`)
        );
      }
      assert.throws(() =>
        executeSql(database, `
          select * from public.save_intelligence_report(
            jsonb_build_object(
              'id', 'report_missing_snapshot',
              'workspaceId', 'workspace_one',
              'runId', '00000000-0000-4000-8000-000000000301'
            ),
            jsonb_build_array(jsonb_build_object())
          );
        `)
      );
      assert.throws(() =>
        executeSql(database, `
          select * from public.save_intelligence_report(
            jsonb_build_object(
              'id', 'report_mismatch',
              'workspaceId', 'workspace_one',
              'runId', '00000000-0000-4000-8000-000000000301',
              'companyCount', 3,
              'eligibleSnapshotCount', 3,
              'eligibleSnapshotFingerprint', 'snapshot:mismatch'
            ),
            '[]'::jsonb
          );
        `)
      );
      executeSql(database, `
        insert into public.scan_runs (
          id, workspace_id, mode, status
        ) values (
          '00000000-0000-4000-8000-000000000301',
          'workspace_snapshot', 'xtrace', 'running'
        );
        insert into public.companies (workspace_id, id, name)
        select 'workspace_snapshot', 'snapshot_company_' || n, 'Company ' || n
        from generate_series(1, 3) as n;
        insert into public.deals (
          workspace_id, id, company_id, company_name, status
        )
        select 'workspace_snapshot', 'snapshot_deal_' || n,
          'snapshot_company_' || n, 'Company ' || n, 'screening'
        from generate_series(1, 3) as n;
        do $$
        begin
          for n in 1..3 loop
            perform public.create_initial_source_revision(
              jsonb_build_object(
                'id', 'snapshot_revision_' || n,
                'workspaceId', 'workspace_snapshot',
                'sourceId', 'snapshot_source_' || n,
                'contentHash', 'snapshot_hash_' || n,
                'objectKey', 'private/snapshot/' || n,
                'objectVersion', 'snapshot_hash_' || n,
                'contentType', 'application/pdf',
                'extractorId', 'pdf-text',
                'extractorVersion', '1',
                'extractedAt', '2026-07-28T13:30:00.000Z',
                'createdAt', '2026-07-28T13:30:01.000Z'
              )
            );
            perform public.confirm_source_assignment(
              jsonb_build_object(
                'requestId', 'snapshot_request_' || n,
                'workspaceId', 'workspace_snapshot',
                'dealId', 'snapshot_deal_' || n,
                'companyId', 'snapshot_company_' || n,
                'companyName', 'Company ' || n,
                'status', 'screening',
                'sourceRevisionId', 'snapshot_revision_' || n,
                'assignedByUserId', 'snapshot_user',
                'reason', 'Snapshot fixture.',
                'confirmedAt', '2026-07-28T13:45:00.000Z'
              )
            );
          end loop;
        end;
        $$;
      `);
      assert.equal(
        executeSql(database, `
          with analyses as (
            select jsonb_agg(jsonb_build_object(
              'id', 'snapshot_analysis_' || n,
              'reportId', 'report_snapshot_three',
              'runId', '00000000-0000-4000-8000-000000000301',
              'dealId', 'snapshot_deal_' || n,
              'companyName', 'Company ' || n,
              'dealStatus', 'screening',
              'outcome', 'no_material_change',
              'confidence', 'low',
              'score', 0,
              'investmentMemory', '{}'::jsonb,
              'marketEvidence', '{}'::jsonb,
              'implications', '{}'::jsonb,
              'recommendedNextMove', 'Continue monitoring.',
              'companyBrief', '{}'::jsonb,
              'sourceRefs', '[]'::jsonb,
              'createdAt', '2026-07-28T14:00:00.000Z'
            )) as payload
            from generate_series(1, 3) as n
          )
          select count(*)
          from analyses, public.save_intelligence_report(
            jsonb_build_object(
              'id', 'report_snapshot_three',
              'workspaceId', 'workspace_snapshot',
              'runId', '00000000-0000-4000-8000-000000000301',
              'createdAt', '2026-07-28T14:00:00.000Z',
              'marketSummary', 'Snapshot test.',
              'opportunities', '[]'::jsonb,
              'analysisStatus', 'completed',
              'companyCount', 3,
              'beliefRevisedCount', 0,
              'monitorCount', 0,
              'noMaterialChangeCount', 3,
              'analysisUnavailableCount', 0,
              'evidenceCoverage', '{}'::jsonb,
              'eligibleSnapshotCount', 3,
              'eligibleSnapshotFingerprint',
                'sha256:4d138886426eb83652d4e19dbb999869952b235025a84043bfc0b91897913ea2'
            ),
            analyses.payload
          );
        `),
        "1",
      );
      assert.throws(() =>
        executeSql(database, `
          select * from public.save_intelligence_report(
            jsonb_build_object(
              'id', 'report_snapshot_three',
              'workspaceId', 'workspace_snapshot',
              'runId', '00000000-0000-4000-8000-000000000301'
            ),
            '[]'::jsonb
          );
        `)
      );
      executeSql(database, `
        insert into public.scan_runs (
          id, workspace_id, mode, status
        ) values (
          '00000000-0000-4000-8000-000000000303',
          'workspace_snapshot', 'structured', 'running'
        );
      `);
      assert.throws(() =>
        executeSql(database, `
          select * from public.save_intelligence_report(
            jsonb_build_object(
              'id', 'report_snapshot_three',
              'workspaceId', 'workspace_snapshot',
              'runId', '00000000-0000-4000-8000-000000000303',
              'companyCount', 3,
              'eligibleSnapshotCount', 3,
              'eligibleSnapshotFingerprint',
                'sha256:4d138886426eb83652d4e19dbb999869952b235025a84043bfc0b91897913ea2'
            ),
            jsonb_build_array(
              jsonb_build_object('dealId', 'snapshot_deal_1'),
              jsonb_build_object('dealId', 'snapshot_deal_2'),
              jsonb_build_object('dealId', 'snapshot_deal_3')
            )
          );
        `)
      );
      executeSql(database, `
        update public.scan_runs
        set status = 'failed'
        where id = '00000000-0000-4000-8000-000000000303';
        insert into public.scan_runs (
          id, workspace_id, mode, status
        ) values (
          '00000000-0000-4000-8000-000000000304',
          'workspace_snapshot', 'structured', 'running'
        );
      `);
      const statusSnapshotBefore = JSON.parse(executeSql(database, `
        select public.get_analysis_eligible_snapshot(
          'workspace_snapshot'
        )::text;
      `)) as { fingerprint: string };
      executeSql(database, `
        select public.confirm_source_assignment(jsonb_build_object(
          'requestId', 'snapshot_request_1_invested',
          'workspaceId', 'workspace_snapshot',
          'dealId', 'snapshot_deal_1',
          'companyId', 'snapshot_company_1',
          'companyName', 'Company 1',
          'status', 'invested',
          'sourceRevisionId', 'snapshot_revision_1',
          'assignedByUserId', 'snapshot_user',
          'reason', 'Status-only snapshot change.',
          'confirmedAt', '2026-07-28T14:15:00.000Z'
        ));
      `);
      assert.throws(() =>
        executeSql(database, `
          with analyses as (
            select jsonb_agg(jsonb_build_object(
              'id', 'snapshot_status_analysis_' || n,
              'reportId', 'report_status_stale',
              'runId', '00000000-0000-4000-8000-000000000304',
              'dealId', 'snapshot_deal_' || n,
              'companyName', 'Company ' || n,
              'dealStatus', 'screening',
              'outcome', 'no_material_change',
              'confidence', 'low',
              'score', 0,
              'investmentMemory', '{}'::jsonb,
              'marketEvidence', '{}'::jsonb,
              'implications', '{}'::jsonb,
              'recommendedNextMove', 'Continue monitoring.',
              'companyBrief', '{}'::jsonb,
              'sourceRefs', '[]'::jsonb,
              'createdAt', '2026-07-28T14:20:00.000Z'
            )) as payload
            from generate_series(1, 3) as n
          )
          select count(*)
          from analyses, public.save_intelligence_report(
            jsonb_build_object(
              'id', 'report_status_stale',
              'workspaceId', 'workspace_snapshot',
              'runId', '00000000-0000-4000-8000-000000000304',
              'createdAt', '2026-07-28T14:20:00.000Z',
              'marketSummary', 'Stale status snapshot.',
              'opportunities', '[]'::jsonb,
              'analysisStatus', 'completed',
              'companyCount', 3,
              'beliefRevisedCount', 0,
              'monitorCount', 0,
              'noMaterialChangeCount', 3,
              'analysisUnavailableCount', 0,
              'evidenceCoverage', '{}'::jsonb,
              'eligibleSnapshotCount', 3,
              'eligibleSnapshotFingerprint',
                '${statusSnapshotBefore.fingerprint}'
            ),
            analyses.payload
          );
        `)
      );
      const statusSnapshotAfter = JSON.parse(executeSql(database, `
        select public.get_analysis_eligible_snapshot(
          'workspace_snapshot'
        )::text;
      `)) as { fingerprint: string };
      assert.deepEqual(
        {
          before: statusSnapshotBefore.fingerprint,
          after: statusSnapshotAfter.fingerprint,
          status: executeSql(database, `
            select status
            from public.deals
            where workspace_id = 'workspace_snapshot'
              and id = 'snapshot_deal_1';
          `),
        },
        {
          before:
            "sha256:4d138886426eb83652d4e19dbb999869952b235025a84043bfc0b91897913ea2",
          after:
            "sha256:82c6aac884116a6772417a844430b401161e945c30be96889ef16e99733ad5c9",
          status: "invested",
        },
      );
      executeSql(database, `
        update public.scan_runs
        set status = 'failed'
        where id = '00000000-0000-4000-8000-000000000304';
      `);
      executeSql(database, `
        insert into public.scan_runs (
          id, workspace_id, mode, status
        ) values (
          '00000000-0000-4000-8000-000000000302',
          'workspace_snapshot', 'structured', 'running'
        );
        select id from public.append_source_revision(jsonb_build_object(
          'id', 'snapshot_revision_1_v2',
          'workspaceId', 'workspace_snapshot',
          'sourceId', 'snapshot_source_1',
          'contentHash', 'snapshot_hash_1_v2',
          'objectKey', 'private/snapshot/1-v2',
          'objectVersion', 'snapshot_hash_1_v2',
          'contentType', 'application/pdf',
          'extractorId', 'pdf-text',
          'extractorVersion', '1',
          'extractedAt', '2026-07-28T14:30:00.000Z',
          'createdAt', '2026-07-28T14:30:01.000Z',
          'supersedesRevisionId', 'snapshot_revision_1'
        ));
        select public.confirm_source_assignment(jsonb_build_object(
          'requestId', 'snapshot_request_1_v2',
          'workspaceId', 'workspace_snapshot',
          'dealId', 'snapshot_deal_1',
          'companyId', 'snapshot_company_1',
          'companyName', 'Company 1',
          'status', 'screening',
          'sourceRevisionId', 'snapshot_revision_1_v2',
          'assignedByUserId', 'snapshot_user',
          'reason', 'Reassigned during a later snapshot.',
          'confirmedAt', '2026-07-28T14:45:00.000Z'
        ));
      `);
      assert.throws(() =>
        executeSql(database, `
          select * from public.save_intelligence_report(
            jsonb_build_object(
              'id', 'report_stale_snapshot',
              'workspaceId', 'workspace_snapshot',
              'runId', '00000000-0000-4000-8000-000000000302',
              'companyCount', 3,
              'eligibleSnapshotCount', 3,
              'eligibleSnapshotFingerprint',
                'sha256:82c6aac884116a6772417a844430b401161e945c30be96889ef16e99733ad5c9'
            ),
            jsonb_build_array(
              jsonb_build_object('dealId', 'snapshot_deal_1'),
              jsonb_build_object('dealId', 'snapshot_deal_2'),
              jsonb_build_object('dealId', 'snapshot_deal_3')
            )
          );
        `)
      );
      assert.throws(() =>
        executeSql(database, `
          select * from public.save_intelligence_report(
            jsonb_build_object(
              'id', 'report_snapshot_three',
              'workspaceId', 'workspace_snapshot',
              'runId', '00000000-0000-4000-8000-000000000301',
              'companyCount', 0,
              'eligibleSnapshotCount', 0,
              'eligibleSnapshotFingerprint', 'snapshot:different'
            ),
            '[]'::jsonb
          );
        `)
      );
    });
  },
);

test(
  "0009 backfills a legacy 0000-through-0008 source-backed Deal without fixed cardinality",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    withTemporaryDatabase((database) => {
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
      ];
      for (const migration of migrations) {
        applySql(
          database,
          fileURLToPath(new URL(`../../drizzle/${migration}`, import.meta.url)),
        );
      }
      executeSql(database, `
        insert into public.workspaces (id, name)
        values ('workspace_legacy', 'Legacy');
        insert into public.source_documents (
          id, filename, title, role, checksum, byte_size, object_key
        ) values (
          'doc_legacy', 'legacy.pdf', 'Legacy source', 'deal_document',
          'hash_legacy', 10, 'private/demo-corpus/hash/legacy.pdf'
        );
        insert into public.companies (workspace_id, id, name)
        values ('workspace_legacy', 'company_legacy', 'Legacy company');
        insert into public.deals (
          workspace_id, id, company_id, company_name
        ) values (
          'workspace_legacy', 'deal_legacy', 'company_legacy',
          'Legacy company'
        );
        insert into public.source_evidence (
          workspace_id, id, document_id, deal_id, company_name,
          provenance, page, fact, excerpt
        ) values (
          'workspace_legacy', 'evidence_legacy', 'doc_legacy',
          'deal_legacy', 'Legacy company', 'source_document', 1,
          'A legacy fact.', 'A legacy excerpt.'
        );
        insert into public.source_documents (
          id, filename, title, role, checksum, byte_size, object_key
        ) values
          ('c', 'c.pdf', 'C', 'deal_document', 'hash_c', 1, 'private/c'),
          ('b:c', 'bc.pdf', 'BC', 'deal_document', 'hash_bc', 1, 'private/bc');
        insert into public.companies (workspace_id, id, name) values
          ('workspace_legacy', 'company_ab', 'AB'),
          ('workspace_legacy', 'company_a', 'A');
        insert into public.deals (
          workspace_id, id, company_id, company_name
        ) values
          ('workspace_legacy', 'a:b', 'company_ab', 'AB'),
          ('workspace_legacy', 'a', 'company_a', 'A');
        insert into public.source_evidence (
          workspace_id, id, document_id, deal_id, company_name,
          provenance, page, fact, excerpt
        ) values
          ('workspace_legacy', 'collision_one', 'c', 'a:b', 'AB',
            'source_document', 1, 'one', 'one'),
          ('workspace_legacy', 'collision_two', 'b:c', 'a', 'A',
            'source_document', 1, 'two', 'two');
      `);

      applySql(database, registryMigrationPath);

      assert.equal(
        executeSql(database, `
          select revision.revision || '|' || assignment.deal_id || '|'
            || deal.status || '|'
            || (deal.analysis_eligible_at is not null)::text || '|'
            || deal.active_source_revision_fingerprint
          from public.source_revisions as revision
          join public.deal_source_assignments as assignment
            on assignment.workspace_id = revision.workspace_id
            and assignment.source_revision_id = revision.id
          join public.deals as deal
            on deal.workspace_id = assignment.workspace_id
            and deal.id = assignment.deal_id
          where revision.workspace_id = 'workspace_legacy'
            and assignment.deal_id = 'deal_legacy';
        `),
        "1|deal_legacy|screening|true|sha256:48d9ca8390d3d1782234507c24e57b3d4df79a8f216f7157697f68bfb564dc75",
      );
      assert.equal(
        executeSql(database, `
          select count(*) || '|' || count(distinct request_id)
          from public.deal_source_assignments
          where workspace_id = 'workspace_legacy'
            and deal_id in ('a', 'a:b');
        `),
        "2|2",
      );
    });
  },
);

test(
  "0009 serializes concurrent appends so only one revision two can commit",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  async () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    await withTemporaryDatabaseAsync(async (database) => {
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
      ];
      for (const migration of migrations) {
        applySql(
          database,
          fileURLToPath(new URL(`../../drizzle/${migration}`, import.meta.url)),
        );
      }
      executeSql(database, `
        insert into public.workspaces (id, name)
        values ('workspace_concurrent', 'Concurrent');
        select id
        from public.create_initial_source_revision(jsonb_build_object(
          'id', 'revision_one',
          'workspaceId', 'workspace_concurrent',
          'sourceId', 'source_concurrent',
          'contentHash', 'hash_one',
          'objectKey', 'private/source-one.pdf',
          'objectVersion', 'hash_one',
          'contentType', 'application/pdf',
          'extractorId', 'pdf-text',
          'extractorVersion', '1',
          'extractedAt', '2026-07-28T10:00:00.000Z',
          'createdAt', '2026-07-28T10:00:01.000Z'
        ));
      `);
      const appendSql = (suffix: string) => `
        select id
        from public.append_source_revision(jsonb_build_object(
          'id', 'revision_two_${suffix}',
          'workspaceId', 'workspace_concurrent',
          'sourceId', 'source_concurrent',
          'contentHash', 'hash_${suffix}',
          'objectKey', 'private/source-${suffix}.pdf',
          'objectVersion', 'hash_${suffix}',
          'contentType', 'application/pdf',
          'extractorId', 'pdf-text',
          'extractorVersion', '1',
          'extractedAt', '2026-07-28T11:00:00.000Z',
          'createdAt', '2026-07-28T11:00:01.000Z',
          'supersedesRevisionId', 'revision_one'
        ));
      `;
      const outcomes = await Promise.allSettled([
        executeSqlAsync(database, appendSql("a")),
        executeSqlAsync(database, appendSql("b")),
      ]);
      assert.equal(
        outcomes.filter((outcome) => outcome.status === "fulfilled").length,
        1,
      );
      assert.equal(
        outcomes.filter((outcome) => outcome.status === "rejected").length,
        1,
      );
      assert.equal(
        executeSql(database, `
          select count(*) || '|' || max(revision)
          from public.source_revisions
          where workspace_id = 'workspace_concurrent';
        `),
        "2|2",
      );
    });
  },
);

test(
  "0009 denies service_role destructive Deal registry writes while controlled confirmation succeeds",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    const originalBypassRls = executeSql("postgres", `
      select coalesce((
        select rolbypassrls::text
        from pg_roles
        where rolname = 'service_role'
      ), 'missing');
    `);
    try {
      executeSql("postgres", `
        do $$
        begin
          create role service_role nologin noinherit nobypassrls;
        exception when duplicate_object then null;
        end;
        $$;
        alter role service_role nobypassrls;
      `);
      withTemporaryDatabase((database) => {
        executeSql(database, "alter role service_role bypassrls;");
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
        ];
        for (const migration of migrations) {
          applySql(
            database,
            fileURLToPath(
              new URL(`../../drizzle/${migration}`, import.meta.url),
            ),
          );
        }
        assert.equal(
          executeSql(database, `
            select rolbypassrls::text
            from pg_roles
            where rolname = 'service_role';
          `),
          "true",
        );

        executeSql(database, `
        insert into public.workspaces (id, name)
        values ('workspace_privilege_boundary', 'Privilege boundary');
        select id
        from public.create_initial_source_revision(jsonb_build_object(
          'id', 'revision_privilege_boundary',
          'workspaceId', 'workspace_privilege_boundary',
          'sourceId', 'source_privilege_boundary',
          'contentHash', 'hash_privilege_boundary',
          'objectKey', 'private/privilege-boundary.pdf',
          'objectVersion', 'hash_privilege_boundary',
          'contentType', 'application/pdf',
          'extractorId', 'pdf-text',
          'extractorVersion', '1',
          'extractedAt', '2026-07-28T10:00:00.000Z',
          'createdAt', '2026-07-28T10:00:01.000Z'
        ));
        `);
        assert.doesNotThrow(() =>
          executeSql(database, `
          set role service_role;
          select 1 / case
            when current_user = 'service_role'
              and (
                select rolbypassrls
                from pg_roles
                where rolname = current_user
              )
            then 1
            else 0
          end;
          select public.confirm_source_assignment(jsonb_build_object(
            'requestId', 'request_privilege_boundary',
            'workspaceId', 'workspace_privilege_boundary',
            'dealId', 'deal_privilege_boundary',
            'companyId', 'company_privilege_boundary',
            'companyName', 'Privilege Boundary Company',
            'status', 'screening',
            'sourceRevisionId', 'revision_privilege_boundary',
            'assignedByUserId', 'user_privilege_boundary',
            'reason', 'Controlled confirmation remains available.',
            'confirmedAt', '2026-07-28T10:15:00.000Z'
          ));
          reset role;
        `)
        );
        executeSql(database, `
          insert into public.source_documents (
            id, filename, title, role, company_name, deal_id,
            checksum, byte_size, object_key
          ) values (
            'source_privilege_boundary',
            'privilege-boundary.pdf',
            'Privilege boundary',
            'deal_document',
            'Privilege Boundary Company',
            'deal_privilege_boundary',
            'source_checksum_privilege_boundary',
            1,
            'private/source-privilege-boundary.pdf'
          );
          insert into public.workspace_documents (workspace_id, document_id)
          values (
            'workspace_privilege_boundary',
            'source_privilege_boundary'
          );
          insert into public.source_evidence (
            id, workspace_id, document_id, source_revision_id, deal_id,
            company_name, provenance, page, fact, excerpt
          ) values (
            'evidence_privilege_boundary',
            'workspace_privilege_boundary',
            'source_privilege_boundary',
            'revision_privilege_boundary',
            'deal_privilege_boundary',
            'Privilege Boundary Company',
            'source_document',
            1,
            'A durable descendant fact.',
            'A durable descendant excerpt.'
          );
          insert into public.deal_interactions (
            id, workspace_id, document_id, source_revision_id, deal_id,
            company_name, occurred_at, provenance, label, status,
            decision_reason, concerns, revisit_conditions, meeting_summary
          ) values (
            'interaction_privilege_boundary',
            'workspace_privilege_boundary',
            'source_privilege_boundary',
            'revision_privilege_boundary',
            'deal_privilege_boundary',
            'Privilege Boundary Company',
            '2026-07-28T10:10:00.000Z',
            'demo_fixture',
            'Sample decision record',
            'screening',
            'A durable descendant decision.',
            '[]'::jsonb,
            '[]'::jsonb,
            'A durable descendant interaction.'
          );
          insert into public.scan_runs (
            id, workspace_id, mode, status
          ) values (
            '00000000-0000-4000-8000-000000000401',
            'workspace_privilege_boundary',
            'structured',
            'completed'
          );
          insert into public.intelligence_reports (
            id, workspace_id, run_id, market_summary, opportunities,
            company_count, eligible_snapshot_count,
            eligible_snapshot_fingerprint
          )
          select
            'report_privilege_boundary',
            'workspace_privilege_boundary',
            '00000000-0000-4000-8000-000000000401',
            'Privilege boundary report.',
            '[]'::jsonb,
            (snapshot.value ->> 'count')::integer,
            (snapshot.value ->> 'count')::integer,
            snapshot.value ->> 'fingerprint'
          from (
            select public.get_analysis_eligible_snapshot(
              'workspace_privilege_boundary'
            ) as value
          ) as snapshot;
          insert into public.company_analyses (
            id, workspace_id, report_id, run_id, deal_id, company_name,
            deal_status, outcome, confidence, score, investment_memory,
            market_evidence, implications, recommended_next_move,
            company_brief, source_refs
          ) values (
            'analysis_privilege_boundary',
            'workspace_privilege_boundary',
            'report_privilege_boundary',
            '00000000-0000-4000-8000-000000000401',
            'deal_privilege_boundary',
            'Privilege Boundary Company',
            'screening',
            'monitor',
            'medium',
            0.5,
            '{}'::jsonb,
            '{}'::jsonb,
            '{}'::jsonb,
            'Preserve this descendant.',
            '{}'::jsonb,
            '[]'::jsonb
          );
        `);

        const privilegeMatrix = executeSql(database, `
        select table_name || '|'
          || has_table_privilege(
            'service_role', 'public.' || table_name, 'SELECT'
          )::text || '|'
          || has_table_privilege(
            'service_role', 'public.' || table_name, 'DELETE'
          )::text || '|'
          || has_table_privilege(
            'service_role', 'public.' || table_name, 'TRUNCATE'
          )::text
        from (values ('companies'), ('deals')) as registry_tables(table_name)
        order by table_name;
        `);
        const exploitResults = [
        {
          label: "delete-companies",
          statement: `
            delete from public.companies
            where workspace_id = 'workspace_privilege_boundary'
              and id = 'company_privilege_boundary'
          `,
        },
        {
          label: "delete-deals",
          statement: `
            delete from public.deals
            where workspace_id = 'workspace_privilege_boundary'
              and id = 'deal_privilege_boundary'
          `,
        },
        {
          label: "truncate-companies",
          statement: "truncate public.companies cascade",
        },
        {
          label: "truncate-deals",
          statement: "truncate public.deals cascade",
        },
        ].map(({ label, statement }) => {
          try {
            executeSql(database, `
            begin;
            set role service_role;
            select 1 / case
              when current_user = 'service_role'
                and (
                  select rolbypassrls
                  from pg_roles
                  where rolname = current_user
                )
              then 1
              else 0
            end;
            ${statement};
            rollback;
          `);
            return `${label}|allowed`;
          } catch (error) {
            const stderr = error && typeof error === "object"
                && "stderr" in error
              ? String((error as { stderr?: unknown }).stderr ?? "")
              : String(error);
            return `${label}|${
              /permission denied for table (companies|deals)/i.test(stderr)
                ? "permission-denied"
                : "other-error"
            }`;
          }
        });

        assert.deepEqual(
          { privilegeMatrix, exploitResults },
          {
            privilegeMatrix: [
              "companies|true|false|false",
              "deals|true|false|false",
            ].join("\n"),
            exploitResults: [
              "delete-companies|permission-denied",
              "delete-deals|permission-denied",
              "truncate-companies|permission-denied",
              "truncate-deals|permission-denied",
            ],
          },
        );
        assert.equal(
          executeSql(database, `
          select
            (select count(*) from public.companies
              where workspace_id = 'workspace_privilege_boundary')
            || '|'
            || (select count(*) from public.deals
              where workspace_id = 'workspace_privilege_boundary')
            || '|'
            || (select count(*) from public.deal_source_assignments
              where workspace_id = 'workspace_privilege_boundary')
            || '|'
            || (select count(*) from public.source_evidence
              where workspace_id = 'workspace_privilege_boundary')
            || '|'
            || (select count(*) from public.deal_interactions
              where workspace_id = 'workspace_privilege_boundary')
            || '|'
            || (select count(*) from public.company_analyses
              where workspace_id = 'workspace_privilege_boundary');
        `),
          "1|1|1|1|1|1",
        );
      });
    } finally {
      if (originalBypassRls === "missing") {
        executeSql("postgres", "drop role if exists service_role;");
      } else {
        executeSql(
          "postgres",
          `alter role service_role ${
            originalBypassRls === "true" ? "bypassrls" : "nobypassrls"
          };`,
        );
      }
    }
    assert.equal(
      executeSql("postgres", `
        select coalesce((
          select rolbypassrls::text
          from pg_roles
          where rolname = 'service_role'
        ), 'missing');
      `),
      originalBypassRls,
    );
  },
);

test(
  "forward migration backfills legacy rows without treating synthetic rationale as a source fact",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    assert.ok(existsSync(durabilityMigrationPath), "forward durability migration must exist");
    withTemporaryDatabase((database) => {
      executeSql(database, `
        create table deal_interactions (
          id text primary key
        );
        insert into deal_interactions (id) values ('fixture_legacy');
        create table xtrace_ingest_jobs (
          job_id text primary key
        );
        insert into xtrace_ingest_jobs (job_id) values ('job_legacy');
        create table xtrace_memory_links (
          memory_id text primary key,
          deal_id text not null
        );
        insert into xtrace_memory_links (memory_id, deal_id)
        values ('mem_legacy', 'deal_legacy');
      `);

      applySql(database, durabilityMigrationPath);
      applySql(database, durabilityMigrationPath);

      assert.equal(
        executeSql(database, `
          select decision_reason
          from deal_interactions
          where id = 'fixture_legacy';
        `),
        "Synthetic fallback: the original demo decision rationale was not persisted before this migration.",
      );
      assert.equal(
        executeSql(database, `
          select bundle_fingerprint || '|' || serializer_version
          from xtrace_ingest_jobs
          where job_id = 'job_legacy';
        `),
        "legacy-unfingerprinted|legacy-v0",
      );
      assert.equal(
        executeSql(database, `
          select memory_id || '|' || deal_id
          from xtrace_memory_links
          where memory_id = 'mem_legacy';
        `),
        "mem_legacy|deal_legacy",
      );
      assert.equal(
        executeSql(database, `
          select count(*)
          from information_schema.columns
          where table_schema = 'public'
            and is_nullable = 'NO'
            and (
              (table_name = 'deal_interactions' and column_name = 'decision_reason')
              or (
                table_name = 'xtrace_ingest_jobs'
                and column_name in ('bundle_fingerprint', 'serializer_version')
              )
            );
        `),
        "3",
      );
    });
  },
);
