import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { makeDisposableDatabaseName, requireLoopbackPostgres } from "../helpers/require-loopback-postgres";

const bootstrapPath = fileURLToPath(
  new URL("../../scripts/bootstrap-production-baseline.zsh", import.meta.url),
);
const migrationLauncherPath = fileURLToPath(
  new URL("../../scripts/apply-production-migrations.zsh", import.meta.url),
);
const libpqServiceRendererPath = fileURLToPath(
  new URL("../../scripts/render-private-libpq-service.mjs", import.meta.url),
);
const catalogManifestPath = fileURLToPath(
  new URL(
    "../../scripts/sql/production-baseline-catalog-manifest.sql",
    import.meta.url,
  ),
);
const catalogHasherPath = fileURLToPath(
  new URL("../../scripts/hash-stdin-sha256.mjs", import.meta.url),
);
const catalogFingerprintsPath = fileURLToPath(
  new URL("../../scripts/production-catalog-fingerprints.zsh", import.meta.url),
);
const registryInvariantsPath = fileURLToPath(
  new URL(
    "../../scripts/sql/production-registry-data-invariants.sql",
    import.meta.url,
  ),
);
const aclRepairPath = fileURLToPath(
  new URL(
    "../../scripts/sql/repair-0009-default-function-acl.sql",
    import.meta.url,
  ),
);
const bridgePath = fileURLToPath(
  new URL(
    "../../scripts/sql/upgrade-prototype-uploaded-documents-to-0007.sql",
    import.meta.url,
  ),
);
const workspaceCompositePath = fileURLToPath(
  new URL("../../drizzle/0008_workspace_composite_identity.sql", import.meta.url),
);
const registryPath = fileURLToPath(
  new URL("../../drizzle/0009_source_revision_deal_registry.sql", import.meta.url),
);
const baselineMigrations = [
  "0000_vsee_postgres.sql",
  "0001_remove_report_delivery.sql",
  "0002_durable_decision_lineage.sql",
  "0003_sanitize_report_next_steps.sql",
  "0004_company_analyses.sql",
  "0005_sample_decision_label.sql",
  "0006_reasoner_judgments.sql",
].map((filename) =>
  fileURLToPath(new URL(`../../drizzle/${filename}`, import.meta.url))
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
const requireSupabasePg176 =
  process.env.REQUIRE_SUPABASE_PG176_MIGRATION_TESTS === "1";
let requiredSupabasePg176Executions = 0;

test.after(() => {
  if (requireSupabasePg176) {
    assert.equal(
      requiredSupabasePg176Executions,
      3,
      "the required PostgreSQL 17.6 release gate must execute both launcher E2Es and the ACL repair E2E",
    );
  }
});
const localDatabaseUser = canCreateTemporaryDatabase
  ? execFileSync(
    "psql",
    ["-d", "postgres", "-Atqc", "select current_user"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim()
  : "";
const localServerVersionNumber = canCreateTemporaryDatabase
  ? execFileSync(
    "psql",
    ["-d", "postgres", "-Atqc", "show server_version_num"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim()
  : "";
type DatabaseCredentials = {
  user: string;
  password?: string;
};

const nonSuperExecutorCredentials: DatabaseCredentials = {
  user: "vsee_test_migration_executor",
  password: "test-only-migration-password",
};
const localDatabaseCredentials: DatabaseCredentials =
  process.env.PGPASSWORD === undefined
    ? { user: localDatabaseUser }
    : { user: localDatabaseUser, password: process.env.PGPASSWORD };

function databaseUrl(
  database: string,
  credentials: DatabaseCredentials,
): string {
  const host = process.env.PGHOST && !process.env.PGHOST.startsWith("/")
    ? process.env.PGHOST
    : "localhost";
  const port = process.env.PGPORT ? `:${process.env.PGPORT}` : "";
  const password = credentials.password === undefined
    ? ""
    : `:${encodeURIComponent(credentials.password)}`;
  return `postgresql://${encodeURIComponent(credentials.user)}${password}`
    + `@${host}${port}/${database}`;
}

function withTemporaryDatabase(run: (database: string) => void): void {
  const database = makeDisposableDatabaseName("production_bridge");
  execFileSync("createdb", [database], { stdio: "pipe" });
  try {
    run(database);
  } finally {
    execFileSync("dropdb", ["--if-exists", database], { stdio: "pipe" });
  }
}

function withTemporaryDatabaseOwnedBy(
  owner: string,
  run: (database: string) => void,
): void {
  const database = makeDisposableDatabaseName("production_bridge");
  execFileSync("createdb", ["--owner", owner, database], { stdio: "pipe" });
  try {
    run(database);
  } finally {
    execFileSync("dropdb", ["--if-exists", database], { stdio: "pipe" });
  }
}

function applySql(
  database: string,
  path: string,
  credentials?: DatabaseCredentials,
): void {
  execFileSync(
    "psql",
    [
      "-v",
      "ON_ERROR_STOP=1",
      "-d",
      credentials ? databaseUrl(database, credentials) : database,
      "-f",
      path,
    ],
    { stdio: "pipe" },
  );
}

function executeSql(
  database: string,
  sql: string,
  credentials?: DatabaseCredentials,
): string {
  return execFileSync(
    "psql",
    [
      "-v",
      "ON_ERROR_STOP=1",
      "-d",
      credentials ? databaseUrl(database, credentials) : database,
      "-AtF",
      "|",
      "-c",
      sql,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

function readCatalogManifestJson(database: string): string {
  return execFileSync(
    "psql",
    [
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-d",
      database,
      "-AtX",
      "-f",
      catalogManifestPath,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

function readCatalogManifest(database: string): Array<Record<string, unknown>> {
  return JSON.parse(readCatalogManifestJson(database)) as Array<
    Record<string, unknown>
  >;
}

function readCatalogFingerprint(database: string): string {
  const manifest = readCatalogManifestJson(database);
  return `sha256:${createHash("sha256").update(manifest).digest("hex")}`;
}

function readBaselineStateSql(migrationId: "0007" | "0008" | "0009"): string {
  const source = readFileSync(bootstrapPath, "utf8");
  const marker = `-- vsee-baseline-state: ${migrationId}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Missing ${migrationId} baseline-state SQL`);
  const end = source.indexOf("\nSQL", start);
  assert.notEqual(end, -1, `Unterminated ${migrationId} baseline-state SQL`);
  return source.slice(start, end);
}

function dropRegistryOwnerRole(): void {
  const result = spawnSync(
    "psql",
    [
      "-v",
      "ON_ERROR_STOP=1",
      "-d",
      "postgres",
      "-c",
      "drop role if exists vsee_underwriting_owner; "
        + "drop role if exists vsee_registry_owner",
    ],
    { encoding: "utf8", stdio: "pipe" },
  );
  assert.equal(
    result.status,
    0,
    `Could not isolate the registry-owner role fixture: ${result.stderr}`,
  );
}

function dropNonSuperExecutorRole(): void {
  dropRegistryOwnerRole();
  executeSql(
    "postgres",
    `drop role if exists ${nonSuperExecutorCredentials.user};`,
  );
}

function createNonSuperExecutorRole(): void {
  dropNonSuperExecutorRole();
  executeSql(
    "postgres",
    `create role ${nonSuperExecutorCredentials.user}
      login password '${nonSuperExecutorCredentials.password}'
      nosuperuser createrole createdb;`,
  );
}

function ensureProductionRoles(): void {
  executeSql("postgres", `
    do $$
    begin
      if not exists (
        select 1 from pg_catalog.pg_roles where rolname = 'service_role'
      ) then
        create role service_role nologin;
      end if;
      if not exists (
        select 1 from pg_catalog.pg_roles where rolname = 'anon'
      ) then
        create role anon nologin;
      end if;
      if not exists (
        select 1 from pg_catalog.pg_roles where rolname = 'authenticated'
      ) then
        create role authenticated nologin;
      end if;
      if not exists (
        select 1 from pg_catalog.pg_roles where rolname = 'postgres'
      ) then
        create role postgres nologin;
      end if;
    end;
    $$;
  `);
}

function runProductionScript(
  database: string,
  path: string,
  credentials: DatabaseCredentials = localDatabaseCredentials,
): ReturnType<typeof spawnSync> {
  const fixtureDirectory = mkdtempSync(join(tmpdir(), "vsee-security-fixture-"));
  const securityPath = join(fixtureDirectory, "security");
  const targetDatabaseUrl = databaseUrl(database, credentials);
  writeFileSync(
    securityPath,
    `#!/bin/sh\nprintf '%s' '${targetDatabaseUrl}'\n`,
    "utf8",
  );
  chmodSync(securityPath, 0o755);
  try {
    return spawnSync("zsh", [path], {
      env: {
        ...process.env,
        PATH: `${fixtureDirectory}:${process.env.PATH ?? ""}`,
        USER: "fixture-user",
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } finally {
    rmSync(fixtureDirectory, { recursive: true, force: true });
  }
}

function runBootstrap(
  database: string,
  path: string = bootstrapPath,
  credentials?: DatabaseCredentials,
): ReturnType<typeof spawnSync> {
  return runProductionScript(database, path, credentials);
}

function assertBootstrapRefused(
  result: ReturnType<typeof spawnSync>,
  pattern: RegExp = /partial|refus|unsafe|prototype|baseline|catalog|reviewed/i,
): void {
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, pattern);
}

function installPrototypeSchema(
  database: string,
  credentials?: DatabaseCredentials,
): void {
  ensureProductionRoles();
  for (const migration of baselineMigrations) {
    applySql(database, migration, credentials);
  }
  executeSql(database, `
    create table public.uploaded_documents (
      id text primary key,
      workspace_id text not null
        references public.workspaces(id) on delete cascade,
      filename text not null,
      content_type text not null,
      byte_size bigint not null check (byte_size > 0),
      checksum text not null,
      object_key text not null,
      status text not null default 'queued' check (
        status in ('queued', 'extracting', 'ready', 'failed')
      ),
      failure_reason text,
      company_name text,
      headline text,
      extracted_facts jsonb not null default '[]'::jsonb,
      memory_texts jsonb not null default '[]'::jsonb,
      memory_ids jsonb not null default '[]'::jsonb,
      xtrace_job_id text,
      deal_id text,
      lease_expires_at timestamptz,
      worker_id text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (workspace_id, checksum)
    );
    create index uploaded_documents_workspace_created
      on public.uploaded_documents (workspace_id, created_at desc);
    create index uploaded_documents_claimable
      on public.uploaded_documents (status, lease_expires_at);
    alter table public.uploaded_documents enable row level security;
    revoke all privileges on table public.uploaded_documents from public;
    do $$
    begin
      if exists (
        select 1 from pg_catalog.pg_roles where rolname = 'service_role'
      ) then
        grant all privileges on table public.uploaded_documents
          to service_role;
      end if;
    end;
    $$;
  `, credentials);
}

function insertPrototypeRow(
  database: string,
  values: {
    status: "queued" | "extracting" | "ready" | "failed";
    extractedFacts?: string;
    memoryTexts?: string;
    memoryIds?: string;
    workerId?: string;
  },
  credentials?: DatabaseCredentials,
): void {
  executeSql(database, `
    insert into public.workspaces (id, name)
    values ('workspace_bridge', 'Bridge');
    insert into public.uploaded_documents (
      id, workspace_id, filename, content_type, byte_size, checksum,
      object_key, status, failure_reason, extracted_facts, memory_texts,
      memory_ids, worker_id
    ) values (
      'upload_bridge', 'workspace_bridge', 'bridge.pdf',
      'application/pdf', 42, 'checksum_bridge',
      'private/workspace_bridge/bridge.pdf', '${values.status}',
      'prototype failure',
      '${values.extractedFacts ?? "[]"}'::jsonb,
      '${values.memoryTexts ?? "[]"}'::jsonb,
      '${values.memoryIds ?? "[]"}'::jsonb,
      ${values.workerId ? `'${values.workerId}'` : "null"}
    );
  `, credentials);
}

test(
  "the production bridge upgrades an empty-payload failed prototype upload without losing legacy or shared fields",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    assert.equal(existsSync(bridgePath), true, "the 0007 compatibility bridge must exist");
    withTemporaryDatabase((database) => {
      installPrototypeSchema(database);
      insertPrototypeRow(database, {
        status: "failed",
        workerId: "stale-prototype-worker",
      });

      applySql(database, bridgePath);

      assert.equal(
        executeSql(database, `
          select id || '|' || workspace_id || '|' || filename || '|'
            || status || '|' || failure_reason || '|'
            || (extraction_preview is null)::text || '|' || worker_id
          from public.uploaded_documents;
        `),
        "upload_bridge|workspace_bridge|bridge.pdf|failed|prototype failure|true|stale-prototype-worker",
      );
      assert.equal(
        executeSql(database, `
          select count(*)
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'uploaded_documents'
            and column_name in (
              'company_name', 'headline', 'extracted_facts', 'memory_texts',
              'memory_ids', 'xtrace_job_id', 'deal_id'
            );
        `),
        "7",
      );
      assert.doesNotThrow(() =>
        executeSql(database, `
          insert into public.uploaded_documents (
            id, workspace_id, filename, content_type, byte_size, checksum,
            object_key, status
          ) values (
            'upload_current', 'workspace_bridge', 'current.pdf',
            'application/pdf', 43, 'checksum_current',
            'private/workspace_bridge/current.pdf', 'awaiting_confirmation'
          );
        `)
      );
    });
  },
);

test(
  "the production-shaped prototype bridge reaches 0009 when pgcrypto is installed in extensions",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(canCreateTemporaryDatabase, true);
    assert.equal(existsSync(bridgePath), true);
    dropRegistryOwnerRole();
    withTemporaryDatabase((database) => {
      executeSql(database, `
        drop extension if exists pgcrypto cascade;
        create schema if not exists extensions;
        create extension pgcrypto with schema extensions;
      `);
      installPrototypeSchema(database);
      insertPrototypeRow(database, {
        status: "failed",
        workerId: "stale-production-worker",
      });

      applySql(database, bridgePath);
      applySql(database, workspaceCompositePath);
      applySql(database, registryPath);

      const verified = runBootstrap(database);
      assert.equal(
        verified.status,
        0,
        `${verified.stdout}${verified.stderr}`,
      );

      assert.equal(
        executeSql(database, `
          select public.sha256_length_framed(array['a', 'bc']);
        `),
        "sha256:5310a58788781ab25d5ad7c3f85035824b4eb7bdfa394e0ac2186271472b5492",
      );
      assert.equal(
        executeSql(database, `
          select
            to_regprocedure(
              'public.confirm_source_assignment(jsonb)'
            ) is not null
            and exists (
              select 1
              from information_schema.columns
              where table_schema = 'public'
                and table_name = 'uploaded_documents'
                and column_name = 'memory_texts'
            )
            and exists (
              select 1
              from information_schema.columns
              where table_schema = 'public'
                and table_name = 'uploaded_documents'
                and column_name = 'extraction_preview'
            );
        `),
        "t",
      );
    });
  },
);

test(
  "0013 clears a stale worker from the quiescent failed upload preserved by the production bridge",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(canCreateTemporaryDatabase, true);
    dropRegistryOwnerRole();
    try {
      withTemporaryDatabase((database) => {
        executeSql(database, `
          drop extension if exists pgcrypto cascade;
          create schema if not exists extensions;
          create extension pgcrypto with schema extensions;
        `);
        installPrototypeSchema(database);
        insertPrototypeRow(database, {
          status: "failed",
          workerId: "stale-production-worker",
        });

        applySql(database, bridgePath);
        applySql(database, workspaceCompositePath);
        applySql(database, registryPath);
        for (const migration of [
          "0010_underwriting_references.sql",
          "0011_underwriting_runs.sql",
          "0012_source_grounded_underwriting.sql",
        ]) {
          applySql(
            database,
            fileURLToPath(new URL(`../../drizzle/${migration}`, import.meta.url)),
          );
        }

        assert.equal(
          executeSql(database, `
            select status || '|' || failure_reason || '|' || worker_id || '|'
              || (lease_expires_at is null)::text
            from public.uploaded_documents;
          `),
          "failed|prototype failure|stale-production-worker|true",
        );

        applySql(
          database,
          fileURLToPath(
            new URL(
              "../../drizzle/0013_confirmed_upload_ingest.sql",
              import.meta.url,
            ),
          ),
        );

        assert.equal(
          executeSql(database, `
            select
              id || '|' || workspace_id || '|' || filename || '|'
                || content_type || '|' || byte_size::text || '|' || checksum
                || '|' || object_key || '|' || status || '|'
                || failure_reason || '|' || (worker_id is null)::text || '|'
                || (lease_token is null)::text || '|'
                || (lease_expires_at is null)::text || '|'
                || exists (
                  select 1
                  from pg_catalog.pg_constraint
                  where conrelid = 'public.uploaded_documents'::regclass
                    and conname = 'uploaded_documents_lease_shape_check'
                    and convalidated
                )::text
            from public.uploaded_documents;
          `),
          "upload_checksum_bridge|workspace_bridge|bridge.pdf|application/pdf|"
            + "42|checksum_bridge|private/workspace_bridge/bridge.pdf|failed|"
            + "prototype failure|true|true|true|true",
        );
      });
    } finally {
      dropRegistryOwnerRole();
    }
  },
);

test(
  "the 0009 baseline inspection classifies exact pre-0009 state when owner roles are absent",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(canCreateTemporaryDatabase, true);
    dropRegistryOwnerRole();
    withTemporaryDatabase((database) => {
      installPrototypeSchema(database);
      applySql(database, bridgePath);
      applySql(database, workspaceCompositePath);

      assert.equal(
        executeSql(database, `
          select count(*)
          from pg_catalog.pg_roles
          where rolname in (
            'vsee_registry_owner', 'vsee_underwriting_owner'
          );
        `),
        "0",
      );
      assert.equal(
        executeSql(database, readBaselineStateSql("0009")),
        "absent",
      );
    });
  },
);

test(
  "the 0009 baseline inspection remains fail closed for unsafe owner membership",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(canCreateTemporaryDatabase, true);
    dropRegistryOwnerRole();
    try {
      withTemporaryDatabase((database) => {
        installPrototypeSchema(database);
        applySql(database, bridgePath);
        applySql(database, workspaceCompositePath);
        applySql(database, registryPath);

        assert.equal(
          executeSql(database, readBaselineStateSql("0009")),
          "complete",
        );
        executeSql(
          database,
          "grant vsee_registry_owner to service_role;",
        );
        assert.equal(
          executeSql(database, readBaselineStateSql("0009")),
          "partial",
        );
      });
    } finally {
      dropRegistryOwnerRole();
    }
  },
);

test(
  "migration 0009 normalizes Supabase default function grants to the reviewed ACL contract",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(canCreateTemporaryDatabase, true);
    dropRegistryOwnerRole();
    try {
      withTemporaryDatabase((database) => {
        installPrototypeSchema(database);
        applySql(database, bridgePath);
        applySql(database, workspaceCompositePath);
        executeSql(database, `
          alter default privileges in schema public
            grant execute on functions to anon, authenticated, service_role;
        `);

        applySql(database, registryPath);

        assert.equal(
          executeSql(database, `
            with target(signature, service_role_is_explicit) as (
              values
                ('public.canonical_utc_iso_milliseconds(timestamp with time zone)', false),
                ('public.save_intelligence_report(jsonb,jsonb)', true),
                ('public.sha256_length_framed(text[])', false),
                ('public.source_assignment_result(deals,source_revisions,text[],boolean)', true),
                ('public.source_revision_set_fingerprint(text[])', false)
            ), explicit_grants as (
              select
                target.signature,
                target.service_role_is_explicit,
                grantee.rolname
              from target
              join pg_catalog.pg_proc as procedure_record
                on procedure_record.oid = to_regprocedure(target.signature)
              cross join lateral pg_catalog.aclexplode(
                coalesce(procedure_record.proacl, '{}'::aclitem[])
              ) as privilege_record
              join pg_catalog.pg_roles as grantee
                on grantee.oid = privilege_record.grantee
              where privilege_record.privilege_type = 'EXECUTE'
            )
            select
              count(*) filter (
                where rolname in ('anon', 'authenticated')
                  or (rolname = 'service_role'
                    and not service_role_is_explicit)
              )::text || '|' ||
              count(*) filter (
                where rolname = 'service_role'
                  and service_role_is_explicit
              )::text
            from explicit_grants;
          `),
          "0|2",
        );

        assert.equal(
          executeSql(database, `
            with target(role_name, signature) as (
              values
                ('anon', 'public.canonical_utc_iso_milliseconds(timestamp with time zone)'),
                ('anon', 'public.save_intelligence_report(jsonb,jsonb)'),
                ('anon', 'public.sha256_length_framed(text[])'),
                ('anon', 'public.source_assignment_result(deals,source_revisions,text[],boolean)'),
                ('anon', 'public.source_revision_set_fingerprint(text[])'),
                ('authenticated', 'public.canonical_utc_iso_milliseconds(timestamp with time zone)'),
                ('authenticated', 'public.save_intelligence_report(jsonb,jsonb)'),
                ('authenticated', 'public.sha256_length_framed(text[])'),
                ('authenticated', 'public.source_assignment_result(deals,source_revisions,text[],boolean)'),
                ('authenticated', 'public.source_revision_set_fingerprint(text[])'),
                ('service_role', 'public.canonical_utc_iso_milliseconds(timestamp with time zone)'),
                ('service_role', 'public.save_intelligence_report(jsonb,jsonb)'),
                ('service_role', 'public.sha256_length_framed(text[])'),
                ('service_role', 'public.source_assignment_result(deals,source_revisions,text[],boolean)'),
                ('service_role', 'public.source_revision_set_fingerprint(text[])')
            )
            select string_agg(
              role_name || '|' || signature || '|' ||
                pg_catalog.has_function_privilege(
                  role_name, to_regprocedure(signature), 'EXECUTE'
                )::text,
              E'\\n' order by role_name, signature
            )
            from target;
          `),
          [
            "anon|public.canonical_utc_iso_milliseconds(timestamp with time zone)|false",
            "anon|public.save_intelligence_report(jsonb,jsonb)|false",
            "anon|public.sha256_length_framed(text[])|true",
            "anon|public.source_assignment_result(deals,source_revisions,text[],boolean)|false",
            "anon|public.source_revision_set_fingerprint(text[])|true",
            "authenticated|public.canonical_utc_iso_milliseconds(timestamp with time zone)|false",
            "authenticated|public.save_intelligence_report(jsonb,jsonb)|false",
            "authenticated|public.sha256_length_framed(text[])|true",
            "authenticated|public.source_assignment_result(deals,source_revisions,text[],boolean)|false",
            "authenticated|public.source_revision_set_fingerprint(text[])|true",
            "service_role|public.canonical_utc_iso_milliseconds(timestamp with time zone)|false",
            "service_role|public.save_intelligence_report(jsonb,jsonb)|true",
            "service_role|public.sha256_length_framed(text[])|true",
            "service_role|public.source_assignment_result(deals,source_revisions,text[],boolean)|true",
            "service_role|public.source_revision_set_fingerprint(text[])|true",
          ].join("\n"),
        );
      });
    } finally {
      dropRegistryOwnerRole();
    }
  },
);

test(
  "the guarded bootstrap classifies and upgrades the production-shaped prototype on real PostgreSQL",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(canCreateTemporaryDatabase, true);
    dropRegistryOwnerRole();
    withTemporaryDatabase((database) => {
      executeSql(database, `
        drop extension if exists pgcrypto cascade;
        create schema if not exists extensions;
        create extension pgcrypto with schema extensions;
      `);
      installPrototypeSchema(database);
      insertPrototypeRow(database, {
        status: "failed",
        workerId: "stale-production-worker",
      });

      const result = runBootstrap(database);
      assert.equal(
        result.status,
        0,
        `${result.stdout}${result.stderr}`,
      );

      assert.equal(
        executeSql(database, `
          select
            to_regprocedure(
              'public.confirm_source_assignment(jsonb)'
            ) is not null
            and exists (
              select 1 from pg_catalog.pg_constraint
              where conrelid = 'public.uploaded_documents'::regclass
                and contype = 'p'
                and pg_catalog.pg_get_constraintdef(oid)
                  = 'PRIMARY KEY (workspace_id, id)'
            );
        `),
        "t",
      );
    });
  },
);

test(
  "the audited Supabase prototype profile changes only redundant public-schema USAGE ACL rows",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(canCreateTemporaryDatabase, true);
    dropRegistryOwnerRole();
    withTemporaryDatabase((database) => {
      installPrototypeSchema(database);
      const baseline = readCatalogManifest(database);

      executeSql(database, `
        grant usage on schema public to anon, authenticated, postgres;
      `);
      const supabaseProfile = readCatalogManifest(database);

      const changedIndexes = baseline.flatMap((row, index) =>
        JSON.stringify(row) === JSON.stringify(supabaseProfile[index])
          ? []
          : [index]
      );
      assert.equal(changedIndexes.length, 1);

      const changedIndex = changedIndexes[0]!;
      assert.deepEqual(baseline[changedIndex], {
        acl: [
          {
            grantee: "$schema_owner",
            grantor: "$schema_owner",
            grantable: false,
            privilege: "CREATE",
          },
          {
            grantee: "$schema_owner",
            grantor: "$schema_owner",
            grantable: false,
            privilege: "USAGE",
          },
          {
            grantee: "PUBLIC",
            grantor: "$schema_owner",
            grantable: false,
            privilege: "USAGE",
          },
          {
            grantee: "service_role",
            grantor: "$schema_owner",
            grantable: false,
            privilege: "USAGE",
          },
        ],
        kind: "schema",
        name: "public",
        owner: "$schema_owner",
        ownerSupported: true,
      });
      assert.deepEqual(supabaseProfile[changedIndex], {
        acl: [
          {
            grantee: "$schema_owner",
            grantor: "$schema_owner",
            grantable: false,
            privilege: "CREATE",
          },
          {
            grantee: "$schema_owner",
            grantor: "$schema_owner",
            grantable: false,
            privilege: "USAGE",
          },
          {
            grantee: "PUBLIC",
            grantor: "$schema_owner",
            grantable: false,
            privilege: "USAGE",
          },
          {
            grantee: "anon",
            grantor: "$schema_owner",
            grantable: false,
            privilege: "USAGE",
          },
          {
            grantee: "authenticated",
            grantor: "$schema_owner",
            grantable: false,
            privilege: "USAGE",
          },
          {
            grantee: "postgres",
            grantor: "$schema_owner",
            grantable: false,
            privilege: "USAGE",
          },
          {
            grantee: "service_role",
            grantor: "$schema_owner",
            grantable: false,
            privilege: "USAGE",
          },
        ],
        kind: "schema",
        name: "public",
        owner: "$schema_owner",
        ownerSupported: true,
      });

      assert.deepEqual(
        baseline.filter(({ kind }) => kind === "effective-schema-acl"),
        supabaseProfile.filter(({ kind }) => kind === "effective-schema-acl"),
      );
    });
  },
);

test(
  "the PostgreSQL 17.6 Supabase prototype passes both guarded launchers through 0018",
  {
    skip: !requireSupabasePg176 && localServerVersionNumber !== "170006",
  },
  () => {
    if (requireSupabasePg176) {
      requiredSupabasePg176Executions += 1;
    }
    assert.equal(canCreateTemporaryDatabase, true);
    assert.equal(localServerVersionNumber, "170006");
    dropRegistryOwnerRole();
    withTemporaryDatabase((database) => {
      installPrototypeSchema(database);
      insertPrototypeRow(database, {
        status: "failed",
        workerId: "stale-production-worker",
      });
      executeSql(database, `
        grant usage on schema public to anon, authenticated, postgres;
      `);

      const baseline = runBootstrap(database);
      assert.equal(
        baseline.status,
        0,
        `${baseline.stdout}${baseline.stderr}\nActual catalog: ${
          readCatalogFingerprint(database)
        }`,
      );
      const forward = runProductionScript(database, migrationLauncherPath);
      assert.equal(
        forward.status,
        0,
        `${forward.stdout}${forward.stderr}\nActual catalog: ${
          readCatalogFingerprint(database)
        }`,
      );
      assert.match(`${baseline.stdout}${baseline.stderr}`, /0010 through 0018/i);
      assert.match(`${forward.stdout}${forward.stderr}`, /through 0018.*complete.*verified/i);

      assert.equal(
        executeSql(database, `
          select
            to_regclass('public.workspace_test_generations') is not null
            and to_regprocedure(
              'public.confirm_source_assignment(jsonb)'
            ) is not null
            and exists (
              select 1
              from pg_catalog.pg_extension as extension_record
              join pg_catalog.pg_depend as dependency
                on dependency.refclassid = 'pg_catalog.pg_extension'::regclass
                and dependency.refobjid = extension_record.oid
                and dependency.classid = 'pg_catalog.pg_proc'::regclass
                and dependency.deptype = 'e'
              join pg_catalog.pg_proc as procedure_record
                on procedure_record.oid = dependency.objid
              join pg_catalog.pg_namespace as namespace
                on namespace.oid = procedure_record.pronamespace
              where extension_record.extname = 'pgcrypto'
                and procedure_record.proname = 'digest'
                and procedure_record.proargtypes = '17 25'::oidvector
                and pg_catalog.has_schema_privilege(
                  'vsee_registry_owner', namespace.oid, 'USAGE'
                )
            );
        `),
        "t",
      );
      assert.equal(
        executeSql(database, `
          select status || '|' || failure_reason || '|'
            || (worker_id is null)::text || '|'
            || (lease_token is null)::text || '|'
            || (lease_expires_at is null)::text
          from public.uploaded_documents;
        `),
        "failed|prototype failure|true|true|true",
      );
    });
  },
);

test(
  "a PostgreSQL 17.6 non-superuser CREATEROLE executor passes both guarded launchers through 0018",
  {
    skip: !requireSupabasePg176 && localServerVersionNumber !== "170006",
  },
  () => {
    if (requireSupabasePg176) {
      requiredSupabasePg176Executions += 1;
    }
    assert.equal(canCreateTemporaryDatabase, true);
    assert.equal(localServerVersionNumber, "170006");
    createNonSuperExecutorRole();
    try {
      withTemporaryDatabaseOwnedBy(
        nonSuperExecutorCredentials.user,
        (database) => {
          installPrototypeSchema(database, nonSuperExecutorCredentials);
          insertPrototypeRow(
            database,
            {
              status: "failed",
              workerId: "stale-production-worker",
            },
            nonSuperExecutorCredentials,
          );
          executeSql(
            database,
            "grant usage on schema public to anon, authenticated, postgres;",
            nonSuperExecutorCredentials,
          );

          assert.equal(
            executeSql(
              database,
              "select rolsuper::text || '|' || rolcreaterole::text "
                + "from pg_roles where rolname = current_user;",
              nonSuperExecutorCredentials,
            ),
            "false|true",
          );

          const baseline = runBootstrap(
            database,
            bootstrapPath,
            nonSuperExecutorCredentials,
          );
          assert.equal(
            baseline.status,
            0,
            `${baseline.stdout}${baseline.stderr}\nActual catalog: ${
              readCatalogFingerprint(database)
            }`,
          );
          const forward = runProductionScript(
            database,
            migrationLauncherPath,
            nonSuperExecutorCredentials,
          );
          assert.equal(
            forward.status,
            0,
            `${forward.stdout}${forward.stderr}\nActual catalog: ${
              readCatalogFingerprint(database)
            }`,
          );
          assert.match(`${baseline.stdout}${baseline.stderr}`, /0010 through 0018/i);
          assert.match(`${forward.stdout}${forward.stderr}`, /through 0018.*complete.*verified/i);

          assert.equal(
            executeSql(database, `
              select
                to_regclass('public.workspace_test_generations') is not null
                and to_regprocedure(
                  'public.confirm_source_assignment(jsonb)'
                ) is not null
                and exists (
                  select 1
                  from pg_catalog.pg_extension as extension_record
                  join pg_catalog.pg_depend as dependency
                    on dependency.refclassid = 'pg_catalog.pg_extension'::regclass
                    and dependency.refobjid = extension_record.oid
                    and dependency.classid = 'pg_catalog.pg_proc'::regclass
                    and dependency.deptype = 'e'
                  join pg_catalog.pg_proc as procedure_record
                    on procedure_record.oid = dependency.objid
                  join pg_catalog.pg_namespace as namespace
                    on namespace.oid = procedure_record.pronamespace
                  where extension_record.extname = 'pgcrypto'
                    and procedure_record.proname = 'digest'
                    and procedure_record.proargtypes = '17 25'::oidvector
                    and pg_catalog.has_schema_privilege(
                      'vsee_registry_owner', namespace.oid, 'USAGE'
                    )
                );
            `),
            "t",
          );
          assert.equal(
            executeSql(database, `
              select status || '|' || failure_reason || '|'
                || (worker_id is null)::text || '|'
                || (lease_token is null)::text || '|'
                || (lease_expires_at is null)::text
              from public.uploaded_documents;
            `),
            "failed|prototype failure|true|true|true",
          );

          assert.equal(
            executeSql(database, `
              select rolname || '|' || rolsuper::text || '|'
                || rolinherit::text || '|' || rolcreaterole::text || '|'
                || rolcreatedb::text || '|' || rolcanlogin::text || '|'
                || rolreplication::text || '|' || rolbypassrls::text
              from pg_catalog.pg_roles
              where rolname in (
                'vsee_registry_owner', 'vsee_underwriting_owner'
              )
              order by rolname;
            `),
            [
              "vsee_registry_owner|false|false|false|false|false|false|false",
              "vsee_underwriting_owner|false|false|false|false|false|false|false",
            ].join("\n"),
          );

          const executorRole = executeSql(
            database,
            "select current_user;",
            nonSuperExecutorCredentials,
          );
          assert.equal(executorRole, nonSuperExecutorCredentials.user);
          assert.equal(
            executeSql(database, `
              select owner_role.rolname || '|' || member_role.rolname || '|'
                || membership.grantor::text || '|'
                || grantor_role.rolsuper::text || '|'
                || membership.admin_option::text || '|'
                || membership.inherit_option::text || '|'
                || membership.set_option::text
              from pg_catalog.pg_auth_members as membership
              join pg_catalog.pg_roles as owner_role
                on owner_role.oid = membership.roleid
              join pg_catalog.pg_roles as member_role
                on member_role.oid = membership.member
              join pg_catalog.pg_roles as grantor_role
                on grantor_role.oid = membership.grantor
              where owner_role.rolname in (
                'vsee_registry_owner', 'vsee_underwriting_owner'
              ) or member_role.rolname in (
                'vsee_registry_owner', 'vsee_underwriting_owner'
              )
              order by owner_role.rolname, member_role.rolname;
            `),
            [
              `vsee_registry_owner|${executorRole}|10|true|true|false|false`,
              `vsee_underwriting_owner|${executorRole}|10|true|true|false|false`,
            ].join("\n"),
          );

          assert.equal(
            executeSql(database, `
              select owner_role.rolname || '|'
                || pg_catalog.has_schema_privilege(
                  owner_role.rolname, 'public', 'CREATE'
                )::text || '|'
                || pg_catalog.pg_has_role(
                  'service_role', owner_role.rolname, 'MEMBER'
                )::text
              from pg_catalog.pg_roles as owner_role
              where owner_role.rolname in (
                'vsee_registry_owner', 'vsee_underwriting_owner'
              )
              order by owner_role.rolname;
            `),
            [
              "vsee_registry_owner|false|false",
              "vsee_underwriting_owner|false|false",
            ].join("\n"),
          );
        },
      );
    } finally {
      dropNonSuperExecutorRole();
    }
  },
);

test(
  "the guarded bootstrap repairs the exact PostgreSQL 17.6 Supabase default-function ACL defect",
  {
    skip: !requireSupabasePg176 && localServerVersionNumber !== "170006",
  },
  () => {
    if (requireSupabasePg176) {
      requiredSupabasePg176Executions += 1;
    }
    assert.equal(canCreateTemporaryDatabase, true);
    assert.equal(localServerVersionNumber, "170006");
    assert.equal(existsSync(aclRepairPath), true);
    createNonSuperExecutorRole();
    try {
      withTemporaryDatabaseOwnedBy(
        nonSuperExecutorCredentials.user,
        (database) => {
          installPrototypeSchema(database, nonSuperExecutorCredentials);
          insertPrototypeRow(
            database,
            { status: "failed" },
            nonSuperExecutorCredentials,
          );
          executeSql(
            database,
            "grant usage on schema public to anon, authenticated, postgres;",
            nonSuperExecutorCredentials,
          );
          applySql(database, bridgePath, nonSuperExecutorCredentials);
          applySql(database, workspaceCompositePath, nonSuperExecutorCredentials);
          executeSql(database, `
            alter default privileges in schema public
              grant execute on functions
              to anon, authenticated, service_role;
          `, nonSuperExecutorCredentials);
          applySql(database, registryPath, nonSuperExecutorCredentials);

          assert.equal(
            readCatalogFingerprint(database),
            "sha256:15d4475110a5425162e246a0b33a547f33b8550d1e0327c92f67de9db8f1071e",
          );

          executeSql(database, `
            set role vsee_registry_owner;
            grant execute on function
              public.canonical_utc_iso_milliseconds(timestamptz)
              to anon, authenticated, service_role;
            grant execute on function
              public.save_intelligence_report(jsonb, jsonb)
              to anon, authenticated;
            grant execute on function public.sha256_length_framed(text[])
              to anon, authenticated, service_role;
            grant execute on function public.source_assignment_result(
              public.deals, public.source_revisions, text[], boolean
            ) to anon, authenticated;
            grant execute on function
              public.source_revision_set_fingerprint(text[])
              to anon, authenticated, service_role;
            reset role;
          `);

          assert.equal(
            readCatalogFingerprint(database),
            "sha256:a5e1729c32fbe1a99a0487ce7a11701e23d09dc4c201fece540967101565591c",
          );
          assert.equal(
            executeSql(
              database,
              readBaselineStateSql("0009"),
              nonSuperExecutorCredentials,
            ),
            "partial",
          );

          const repair = runBootstrap(
            database,
            bootstrapPath,
            nonSuperExecutorCredentials,
          );
          assert.equal(
            repair.status,
            0,
            `${repair.stdout}${repair.stderr}\nActual catalog: ${
              readCatalogFingerprint(database)
            }`,
          );
          assert.match(
            `${repair.stdout}${repair.stderr}`,
            /default-function ACL repair reached the reviewed catalog/i,
          );
          assert.equal(
            readCatalogFingerprint(database),
            "sha256:15d4475110a5425162e246a0b33a547f33b8550d1e0327c92f67de9db8f1071e",
          );
          assert.equal(
            executeSql(
              database,
              readBaselineStateSql("0009"),
              nonSuperExecutorCredentials,
            ),
            "complete",
          );
          assert.equal(
            executeSql(
              database,
              readFileSync(registryInvariantsPath, "utf8"),
              nonSuperExecutorCredentials,
            ),
            "t",
          );
        },
      );
    } finally {
      dropNonSuperExecutorRole();
    }
  },
);

test(
  "the guarded bootstrap rejects exact prototype catalog drift before mutation",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  async (t) => {
    assert.equal(canCreateTemporaryDatabase, true);
    const scenarios: Array<{ name: string; mutate: string }> = [
      {
        name: "wrong status default",
        mutate:
          "alter table public.uploaded_documents alter column status set default 'failed'",
      },
      {
        name: "missing workspace foreign key",
        mutate:
          "alter table public.uploaded_documents drop constraint uploaded_documents_workspace_id_fkey",
      },
      {
        name: "missing claimable index",
        mutate: "drop index public.uploaded_documents_claimable",
      },
      {
        name: "unexpected public table privilege",
        mutate: "grant select on public.uploaded_documents to public",
      },
      {
        name: "unexpected anonymous schema create privilege",
        mutate: "grant create on schema public to anon",
      },
      {
        name: "unexpected public schema grantee",
        mutate: "grant usage on schema public to pg_read_all_data",
      },
      {
        name: "partial service-role table privilege set",
        mutate: `
          revoke all privileges on public.uploaded_documents
            from service_role;
          grant select on public.uploaded_documents to service_role;
        `,
      },
      {
        name: "unexpected non-internal trigger",
        mutate: `
          create function public.prototype_drift_trigger()
          returns trigger language plpgsql as $$
          begin
            return new;
          end;
          $$;
          create trigger uploaded_documents_unexpected
          before update on public.uploaded_documents
          for each row execute function public.prototype_drift_trigger();
        `,
      },
    ];

    for (const scenario of scenarios) {
      await t.test(scenario.name, () => {
        dropRegistryOwnerRole();
        withTemporaryDatabase((database) => {
          installPrototypeSchema(database);
          insertPrototypeRow(database, { status: "failed" });
          executeSql(database, scenario.mutate);

          assertBootstrapRefused(runBootstrap(database));
          assert.equal(
            executeSql(database, `
              select count(*)
              from information_schema.columns
              where table_schema = 'public'
                and table_name = 'uploaded_documents'
                and column_name = 'extraction_preview';
            `),
            "0",
          );
        });
      });
    }
  },
);

test(
  "a bridged prototype with newly meaningful legacy payload is never treated as current",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(canCreateTemporaryDatabase, true);
    dropRegistryOwnerRole();
    withTemporaryDatabase((database) => {
      installPrototypeSchema(database);
      insertPrototypeRow(database, { status: "failed" });
      applySql(database, bridgePath);
      executeSql(database, `
        update public.uploaded_documents
        set memory_texts = '["material legacy memory"]'::jsonb;
      `);

      assertBootstrapRefused(runBootstrap(database), /legacy|unsafe|0007/i);
      assert.equal(
        executeSql(database, `
          select pg_catalog.pg_get_constraintdef(oid)
          from pg_catalog.pg_constraint
          where conrelid = 'public.companies'::regclass
            and contype = 'p';
        `),
        "PRIMARY KEY (id)",
      );
    });
  },
);

test(
  "the guarded bootstrap safely resumes after an injected failure between the bridge and 0008",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(canCreateTemporaryDatabase, true);
    dropRegistryOwnerRole();
    withTemporaryDatabase((database) => {
      installPrototypeSchema(database);
      insertPrototypeRow(database, { status: "failed" });

      const fixtureRoot = mkdtempSync(join(tmpdir(), "vsee-baseline-retry-"));
      const fixtureScripts = join(fixtureRoot, "scripts");
      const fixtureSql = join(fixtureScripts, "sql");
      const fixtureDrizzle = join(fixtureRoot, "drizzle");
      mkdirSync(fixtureSql, { recursive: true });
      mkdirSync(fixtureDrizzle, { recursive: true });
      const fixtureBootstrap = join(
        fixtureScripts,
        "bootstrap-production-baseline.zsh",
      );
      copyFileSync(bootstrapPath, fixtureBootstrap);
      copyFileSync(
        libpqServiceRendererPath,
        join(fixtureScripts, "render-private-libpq-service.mjs"),
      );
      copyFileSync(
        catalogHasherPath,
        join(fixtureScripts, "hash-stdin-sha256.mjs"),
      );
      copyFileSync(
        catalogFingerprintsPath,
        join(fixtureScripts, "production-catalog-fingerprints.zsh"),
      );
      copyFileSync(
        catalogManifestPath,
        join(fixtureSql, "production-baseline-catalog-manifest.sql"),
      );
      copyFileSync(
        registryInvariantsPath,
        join(fixtureSql, "production-registry-data-invariants.sql"),
      );
      copyFileSync(
        aclRepairPath,
        join(fixtureSql, "repair-0009-default-function-acl.sql"),
      );
      copyFileSync(
        bridgePath,
        join(fixtureSql, "upgrade-prototype-uploaded-documents-to-0007.sql"),
      );
      copyFileSync(
        registryPath,
        join(fixtureDrizzle, "0009_source_revision_deal_registry.sql"),
      );
      writeFileSync(
        join(fixtureDrizzle, "0008_workspace_composite_identity.sql"),
        "begin; select 1 / 0; commit;\n",
        "utf8",
      );

      try {
        assertBootstrapRefused(runBootstrap(database, fixtureBootstrap));
        assert.equal(
          executeSql(database, `
            select
              exists (
                select 1 from information_schema.columns
                where table_schema = 'public'
                  and table_name = 'uploaded_documents'
                  and column_name = 'extraction_preview'
              )::text || '|' ||
              exists (
                select 1 from information_schema.columns
                where table_schema = 'public'
                  and table_name = 'uploaded_documents'
                  and column_name = 'memory_texts'
              )::text;
          `),
          "true|true",
        );

        copyFileSync(
          workspaceCompositePath,
          join(fixtureDrizzle, "0008_workspace_composite_identity.sql"),
        );
        const retry = runBootstrap(database, fixtureBootstrap);
        assert.equal(
          retry.status,
          0,
          `${retry.stdout}${retry.stderr}`,
        );
        assert.equal(
          executeSql(database, `
            select to_regprocedure(
              'public.confirm_source_assignment(jsonb)'
            ) is not null;
          `),
          "t",
        );
      } finally {
        rmSync(fixtureRoot, { recursive: true, force: true });
      }
    });
  },
);

test(
  "the guarded bootstrap rejects same-name 0008 constraint and function drift",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  async (t) => {
    assert.equal(canCreateTemporaryDatabase, true);
    const scenarios: Array<{ name: string; mutate: string }> = [
      {
        name: "foreign key action drift",
        mutate: `
          alter table public.deals
            drop constraint deals_workspace_company_fkey;
          alter table public.deals
            add constraint deals_workspace_company_fkey
            foreign key (workspace_id, company_id)
            references public.companies(workspace_id, id)
            on delete restrict;
        `,
      },
      {
        name: "missing report-deal uniqueness",
        mutate: `
          alter table public.company_analyses
            drop constraint company_analyses_workspace_report_deal_unique;
        `,
      },
      {
        name: "report saver semantic and security drift",
        mutate: `
          create or replace function public.save_intelligence_report(
            p_report jsonb,
            p_analyses jsonb
          )
          returns setof public.intelligence_reports
          language sql
          security definer
          set search_path = public
          as $$
            select report.*
            from public.intelligence_reports as report
            where false
          $$;
        `,
      },
    ];

    for (const scenario of scenarios) {
      await t.test(scenario.name, () => {
        dropRegistryOwnerRole();
        withTemporaryDatabase((database) => {
          applySql(database, baselineMigrations[0]!);
          for (const migration of baselineMigrations.slice(1)) {
            applySql(database, migration);
          }
          applySql(
            database,
            fileURLToPath(
              new URL("../../drizzle/0007_uploaded_documents.sql", import.meta.url),
            ),
          );
          applySql(database, workspaceCompositePath);
          executeSql(database, scenario.mutate);

          assertBootstrapRefused(
            runBootstrap(database),
            /0008|partial|catalog|reviewed/i,
          );
          assert.equal(
            executeSql(database, `
              select to_regclass('public.source_revisions') is null;
            `),
            "t",
          );
        });
      });
    }
  },
);

test(
  "the guarded bootstrap rejects incomplete 0009 security and registry catalogs",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  async (t) => {
    assert.equal(canCreateTemporaryDatabase, true);
    const scenarios: Array<{ name: string; mutate: string }> = [
      {
        name: "annotation RLS disabled",
        mutate:
          "alter table public.source_revision_annotations disable row level security",
      },
      {
        name: "immutable trigger missing",
        mutate:
          "drop trigger source_revision_annotations_immutable on public.source_revision_annotations",
      },
      {
        name: "definer function changed to invoker",
        mutate: `
          alter function public.confirm_source_assignment(jsonb)
            security invoker;
          alter function public.confirm_source_assignment(jsonb)
            set search_path = public;
        `,
      },
      {
        name: "service role regained direct destructive registry access",
        mutate: `
          grant delete, truncate on public.deals to service_role;
          grant delete, truncate on public.companies to service_role;
        `,
      },
      {
        name: "privileged function body changed without metadata drift",
        mutate: `
          create or replace function public.confirm_source_assignment(
            p_assignment jsonb
          )
          returns jsonb
          language plpgsql
          security definer
          set search_path = ''
          as $$
          begin
            return '{}'::jsonb;
          end;
          $$;
        `,
      },
      {
        name: "trigger function body changed without metadata drift",
        mutate: `
          create or replace function
            public.reject_immutable_source_registry_mutation()
          returns trigger
          language plpgsql
          security invoker
          set search_path = ''
          as $$
          begin
            return old;
          end;
          $$;
        `,
      },
      {
        name: "trigger definition changed with the same function",
        mutate: `
          drop trigger source_revision_annotations_immutable
            on public.source_revision_annotations;
          create trigger source_revision_annotations_immutable
          before update on public.source_revision_annotations
          for each row execute function
            public.reject_immutable_source_registry_mutation();
        `,
      },
      {
        name: "unexpected registry column",
        mutate:
          "alter table public.source_revisions add column drift text",
      },
      {
        name: "unexpected registry constraint",
        mutate: `
          alter table public.source_revisions
            add constraint source_revisions_drift_check check (true);
        `,
      },
      {
        name: "unexpected registry index",
        mutate: `
          create index source_revisions_drift_idx
            on public.source_revisions (created_at);
        `,
      },
      {
        name: "unexpected registry policy",
        mutate: `
          create policy source_revisions_drift_policy
            on public.source_revisions for select
            to public using (true);
        `,
      },
      {
        name: "partial service-role column privilege set",
        mutate: `
          revoke insert (status) on public.deals from service_role;
        `,
      },
      {
        name: "unexpected table grantee",
        mutate: `
          grant select on public.deal_source_assignments to public;
        `,
      },
    ];

    for (const scenario of scenarios) {
      await t.test(scenario.name, () => {
        dropRegistryOwnerRole();
        withTemporaryDatabase((database) => {
          executeSql(database, `
            do $$
            begin
              if not exists (
                select 1 from pg_catalog.pg_roles
                where rolname = 'service_role'
              ) then
                create role service_role nologin;
              end if;
            end;
            $$;
          `);
          for (const migration of baselineMigrations) {
            applySql(database, migration);
          }
          applySql(
            database,
            fileURLToPath(
              new URL("../../drizzle/0007_uploaded_documents.sql", import.meta.url),
            ),
          );
          applySql(database, workspaceCompositePath);
          applySql(database, registryPath);
          executeSql(database, scenario.mutate);

          assertBootstrapRefused(
            runBootstrap(database),
            /0009|partial|catalog|reviewed/i,
          );
        });
      });
    }
  },
);

test(
  "a pre-existing registry owner without 0009 schema is partial rather than absent",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(canCreateTemporaryDatabase, true);
    dropRegistryOwnerRole();
    try {
      executeSql(
        "postgres",
        "create role vsee_registry_owner nologin noinherit nobypassrls",
      );
      withTemporaryDatabase((database) => {
        for (const migration of baselineMigrations) {
          applySql(database, migration);
        }
        applySql(
          database,
          fileURLToPath(
            new URL("../../drizzle/0007_uploaded_documents.sql", import.meta.url),
          ),
        );
        applySql(database, workspaceCompositePath);

        assertBootstrapRefused(
          runBootstrap(database),
          /0009|partial|catalog|reviewed/i,
        );
        assert.equal(
          executeSql(
            database,
            "select to_regclass('public.source_revisions') is null",
          ),
          "t",
        );
      });
    } finally {
      dropRegistryOwnerRole();
    }
  },
);

test(
  "the guarded bootstrap rejects inherited service-role privileges",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(canCreateTemporaryDatabase, true);
    ensureProductionRoles();
    dropRegistryOwnerRole();
    try {
      withTemporaryDatabase((database) => {
        for (const migration of baselineMigrations) {
          applySql(database, migration);
        }
        applySql(
          database,
          fileURLToPath(
            new URL("../../drizzle/0007_uploaded_documents.sql", import.meta.url),
          ),
        );
        applySql(database, workspaceCompositePath);
        applySql(database, registryPath);

        const exactBoundary = runBootstrap(database);
        assert.equal(
          exactBoundary.status,
          0,
          `${exactBoundary.stdout}${exactBoundary.stderr}`,
        );

        executeSql("postgres", "grant service_role to anon");
        assert.equal(
          executeSql(database, `
            select
              pg_catalog.has_table_privilege(
                'anon', 'public.deals', 'SELECT'
              )::text
              || '|'
              || pg_catalog.has_function_privilege(
                'anon',
                'public.confirm_source_assignment(jsonb)',
                'EXECUTE'
              )::text;
          `),
          "true|true",
        );
        assertBootstrapRefused(
          runBootstrap(database),
          /0009|catalog|reviewed/i,
        );
      });
    } finally {
      executeSql("postgres", "revoke service_role from anon");
      dropRegistryOwnerRole();
    }
  },
);

test(
  "the production bridge refuses to discard meaningful prototype payload",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(canCreateTemporaryDatabase, true);
    assert.equal(existsSync(bridgePath), true);
    withTemporaryDatabase((database) => {
      installPrototypeSchema(database);
      insertPrototypeRow(database, {
        status: "failed",
        extractedFacts: '[{"text":"material fact","excerpt":"source"}]',
      });

      assert.throws(() => applySql(database, bridgePath));
      assert.equal(
        executeSql(database, `
          select
            exists (
              select 1 from information_schema.columns
              where table_schema = 'public'
                and table_name = 'uploaded_documents'
                and column_name = 'extracted_facts'
            )::text || '|' ||
            exists (
              select 1 from information_schema.columns
              where table_schema = 'public'
                and table_name = 'uploaded_documents'
                and column_name = 'extraction_preview'
            )::text || '|' ||
            jsonb_array_length(extracted_facts)::text
          from public.uploaded_documents;
        `),
        "true|false|1",
      );
    });
  },
);

test(
  "the production bridge refuses prototype rows whose ready or extracting state changed meaning",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(canCreateTemporaryDatabase, true);
    assert.equal(existsSync(bridgePath), true);
    for (const status of ["ready", "extracting"] as const) {
      withTemporaryDatabase((database) => {
        installPrototypeSchema(database);
        insertPrototypeRow(database, { status });

        assert.throws(() => applySql(database, bridgePath));
        assert.equal(
          executeSql(database, `
            select status || '|' ||
              exists (
                select 1 from information_schema.columns
                where table_schema = 'public'
                  and table_name = 'uploaded_documents'
                  and column_name = 'extraction_preview'
              )::text
            from public.uploaded_documents;
          `),
          `${status}|false`,
        );
      });
    }
  },
);
