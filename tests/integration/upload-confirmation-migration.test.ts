import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { makeDisposableDatabaseName, requireLoopbackPostgres } from "../helpers/require-loopback-postgres";

interface MigrationJournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

const task6MigrationName = "0013_confirmed_upload_ingest.sql";
const migrationPath = fileURLToPath(
  new URL(`../../drizzle/${task6MigrationName}`, import.meta.url),
);
const task13MigrationName = "0012_source_grounded_underwriting.sql";
const task13MigrationPath = fileURLToPath(
  new URL(`../../drizzle/${task13MigrationName}`, import.meta.url),
);
const sourceEvidenceBridgeMigrationName =
  "0016_confirmed_upload_source_evidence_bridge.sql";
const sourceEvidenceBridgeMigrationPath = fileURLToPath(
  new URL(
    `../../drizzle/${sourceEvidenceBridgeMigrationName}`,
    import.meta.url,
  ),
);
const journalPath = fileURLToPath(
  new URL("../../drizzle/meta/_journal.json", import.meta.url),
);
const reservedTask13JournalEntry = {
  idx: 12,
  version: "7",
  when: 1785369431000,
  tag: "0012_source_grounded_underwriting",
  breakpoints: true,
};
const validTask6JournalEntry: MigrationJournalEntry = {
  idx: 13,
  version: "7",
  when: 1785373200000,
  tag: "0013_confirmed_upload_ingest",
  breakpoints: true,
};
const validSourceEvidenceBridgeJournalEntry: MigrationJournalEntry = {
  idx: 16,
  version: "7",
  when: 1785394800000,
  tag: "0016_confirmed_upload_source_evidence_bridge",
  breakpoints: true,
};
const migrationsThroughImmutableUploadConfirmation = [
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
] as const;

function validateSourceEvidenceBridgeJournal(
  entries: MigrationJournalEntry[],
): void {
  const indices = entryIndices(
    entries,
    validSourceEvidenceBridgeJournalEntry.tag,
  );
  assert.equal(indices.length, 1, "0016 requires one exact journal entry.");
  const index = indices[0]!;
  assert.deepEqual(entries[index], validSourceEvidenceBridgeJournalEntry);
  const task6Index = entryIndices(entries, validTask6JournalEntry.tag)[0]!;
  assert.ok(index > task6Index, "0016 must follow the immutable 0013 migration.");
}

function validatedTaskMigrationNames(
  entries: MigrationJournalEntry[],
  task13MigrationExists: boolean,
): string[] {
  const task6Indices = entryIndices(
    entries,
    validTask6JournalEntry.tag,
  );
  assert.equal(
    task6Indices.length,
    1,
    "Task 6 requires one exact journal entry.",
  );
  const task6Index = task6Indices[0];
  const task6Entry = entries[task6Index];
  assert.deepEqual(
    journalIdentity(task6Entry),
    journalIdentity(validTask6JournalEntry),
  );

  const task13Indices = entryIndices(
    entries,
    reservedTask13JournalEntry.tag,
  );
  if (!task13MigrationExists) {
    assert.equal(
      task13Indices.length,
      0,
      "Task 13 cannot be journaled while its migration file is absent.",
    );
    assert.ok(
      reservedTask13JournalEntry.when < task6Entry.when,
      "Task 6 migration timestamp must follow reserved Task 13.",
    );
    return [task6MigrationName];
  }

  assert.equal(
    task13Indices.length,
    1,
    "Task 13 requires one exact journal entry.",
  );
  const task13Index = task13Indices[0];
  const task13Entry = entries[task13Index];
  assert.deepEqual(
    task13Entry,
    reservedTask13JournalEntry,
  );
  assert.ok(
    task13Index < task6Index,
    "Task 13 must physically precede Task 6 in the journal.",
  );
  assert.ok(
    task13Entry.when < task6Entry.when,
    "Task 6 migration timestamp must follow Task 13.",
  );
  const taskEntryIndices = new Set([task13Index, task6Index]);
  return entries.flatMap((entry, index) =>
    taskEntryIndices.has(index) ? [`${entry.tag}.sql`] : []
  );
}

function entryIndices(
  entries: MigrationJournalEntry[],
  tag: string,
): number[] {
  return entries.flatMap((entry, index) =>
    entry.tag === tag ? [index] : []
  );
}

function journalIdentity(entry: MigrationJournalEntry) {
  return {
    idx: entry.idx,
    version: entry.version,
    tag: entry.tag,
    breakpoints: entry.breakpoints,
  };
}

function readMigrationJournalEntries(): MigrationJournalEntry[] {
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: MigrationJournalEntry[];
  };
  return journal.entries;
}
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

test("task migration journal guard rejects malformed metadata and physical order", () => {
  const validEntries = [
    { ...reservedTask13JournalEntry },
    { ...validTask6JournalEntry },
  ];
  assert.deepEqual(
    validatedTaskMigrationNames(validEntries, true),
    [task13MigrationName, task6MigrationName],
  );
  assert.deepEqual(
    validatedTaskMigrationNames([{ ...validTask6JournalEntry }], false),
    [task6MigrationName],
  );

  const malformedCases: Array<[string, MigrationJournalEntry[]]> = [
    [
      "Task 13 version",
      [{ ...reservedTask13JournalEntry, version: "6" }, validEntries[1]],
    ],
    [
      "Task 6 version",
      [validEntries[0], { ...validTask6JournalEntry, version: "6" }],
    ],
    [
      "Task 13 breakpoints",
      [{ ...reservedTask13JournalEntry, breakpoints: false }, validEntries[1]],
    ],
    [
      "Task 6 breakpoints",
      [validEntries[0], { ...validTask6JournalEntry, breakpoints: false }],
    ],
    [
      "Task 13 identity",
      [{ ...reservedTask13JournalEntry, idx: 11 }, validEntries[1]],
    ],
    [
      "Task 13 tag",
      [
        {
          ...reservedTask13JournalEntry,
          tag: "0012_mislabeled",
        },
        validEntries[1],
      ],
    ],
    [
      "Task 6 identity",
      [validEntries[0], { ...validTask6JournalEntry, idx: 12 }],
    ],
    [
      "Task 6 tag",
      [
        validEntries[0],
        {
          ...validTask6JournalEntry,
          tag: "0013_mislabeled",
        },
      ],
    ],
    [
      "non-increasing timestamp",
      [
        validEntries[0],
        {
          ...validTask6JournalEntry,
          when: reservedTask13JournalEntry.when,
        },
      ],
    ],
    ["physically reversed order", [...validEntries].reverse()],
  ];
  for (const [label, entries] of malformedCases) {
    assert.throws(
      () => validatedTaskMigrationNames(entries, true),
      label,
    );
  }
});

test("Task 6 migration is additive and journaled after the reserved Task 13 migration number", () => {
  assert.equal(existsSync(migrationPath), true);
  assert.equal(existsSync(sourceEvidenceBridgeMigrationPath), true);
  const task13MigrationExists = existsSync(task13MigrationPath);
  const entries = readMigrationJournalEntries();
  validatedTaskMigrationNames(
    entries,
    task13MigrationExists,
  );
  validateSourceEvidenceBridgeJournal(entries);
});

test(
  "0016 upgrades an already-applied 0013 and bridges confirmed evidence without changing source bytes",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    const database = makeDisposableDatabaseName("upload");
    execFileSync("createdb", [database], { stdio: "pipe" });
    try {
      const taskMigrations = validatedTaskMigrationNames(
        readMigrationJournalEntries(),
        existsSync(task13MigrationPath),
      );
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
        ...taskMigrations,
        "0014_read_api_action_drafts.sql",
        "0015_framework_catalog_checkpoint.sql",
        sourceEvidenceBridgeMigrationName,
      ]) {
        execFileSync("psql", [
          "-v",
          "ON_ERROR_STOP=1",
          "-d",
          database,
          "-f",
          fileURLToPath(new URL(`../../drizzle/${migration}`, import.meta.url)),
        ], { stdio: "pipe" });
        if (migration === task13MigrationName) {
          execFileSync("psql", [
            "-v",
            "ON_ERROR_STOP=1",
            "-d",
            database,
            "-c",
            `
              insert into public.workspaces (id, name)
              values ('workspace_backfill', 'Backfill');
              insert into public.companies (
                id, workspace_id, name
              ) values (
                'company_backfill', 'workspace_backfill', 'Backfill Co'
              );
              insert into public.deals (
                id, workspace_id, company_id, company_name, status
              ) values (
                'deal_backfill', 'workspace_backfill', 'company_backfill',
                'Backfill Co', 'evaluating'
              );
              insert into public.source_revisions (
                id, workspace_id, source_id, revision, content_hash,
                object_key, object_version, content_type, extractor_id,
                extractor_version, extracted_at, supersedes_revision_id
              ) values (
                'revision_backfill', 'workspace_backfill', 'source_backfill',
                1, 'hash-backfill', 'private/backfill.md', 'object:v1',
                'text/markdown', 'plain_text_v1', '1',
                '2026-07-29T11:00:00.000Z', null
              );
              select public.save_source_evidence_items(jsonb_build_array(
                jsonb_build_object(
                  'id', 'evidence_backfill',
                  'workspaceId', 'workspace_backfill',
                  'dealId', 'deal_backfill',
                  'sourceRevisionId', 'revision_backfill',
                  'provenanceOrigin', 'uploaded_document',
                  'field', 'unstructured_source_fact',
                  'value', 'Legacy canonical row.',
                  'unit', null,
                  'currency', null,
                  'periodStart', null,
                  'periodEnd', null,
                  'publishedAt', null,
                  'eventAt', null,
                  'retrievedAt', '2026-07-29T11:00:00.000Z',
                  'locator', jsonb_build_object(
                    'kind', 'text_range', 'start', 0, 'end', 21,
                    'excerpt', 'Legacy canonical row.'
                  ),
                  'sourceRole', 'management',
                  'assertionStatus', 'reported',
                  'verificationMethod', null,
                  'freshness', 'current',
                  'acceptedForGate', false
                )
              ));
            `,
          ], { stdio: "pipe" });
        }
      }
      const output = execFileSync("psql", [
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        database,
        "-AtF",
        "|",
        "-c",
        `
          insert into public.workspaces (id, name)
          values ('workspace_upload', 'Upload');
          insert into public.uploaded_documents (
            id, workspace_id, filename, content_type, byte_size, checksum,
            object_key, status, extraction_preview
          ) values (
            'upload_1', 'workspace_upload', 'acme.txt', 'text/plain', 20,
            'content-hash', 'private/workspace_upload/acme.txt',
            'awaiting_confirmation',
            '{"extractionMetadata":{"extractorId":"plain_text_v1","extractorVersion":"1","extractedAt":"2026-07-29T12:00:00.000Z"}}'
          );
          select public.confirm_uploaded_document(jsonb_build_object(
            'workspaceId', 'workspace_upload',
            'uploadId', 'upload_1',
            'confirmationFingerprint', 'sha256:${"a".repeat(64)}',
            'dealId', 'deal_1',
            'companyId', 'company_1',
            'companyName', 'Acme',
            'dealStatus', 'evaluating',
            'sourceId', 'source_1',
            'sourceRevisionId', 'revision_1',
            'assignedByUserId', 'user_1',
            'confirmedAt', '2026-07-29T12:05:00.000Z',
            'evidence', jsonb_build_array(
              jsonb_build_object(
                'id', 'evidence_1',
                'fact',
                  'ARR was $2,000,000 USD from 2025-01-01 through 2025-12-31.',
                'excerpt',
                  'ARR was $2,000,000 USD from 2025-01-01 through 2025-12-31.',
                'page', 1,
                'structured', jsonb_build_object(
                  'field', 'ARR',
                  'value', '$2,000,000',
                  'unit', 'currency',
                  'currency', 'USD',
                  'periodStart', '2025-01-01',
                  'periodEnd', '2025-12-31',
                  'publishedAt', null,
                  'eventAt', null
                )
              ),
              jsonb_build_object(
                'id', 'evidence_2',
                'fact', 'ARR was $2,000,000 for calendar 2025.',
                'excerpt', 'ARR was $2,000,000 for calendar 2025.',
                'page', 1,
                'structured', jsonb_build_object(
                  'field', 'ARR',
                  'value', '$2,000,000',
                  'unit', 'currency',
                  'currency', 'USD',
                  'periodStart', '2025-01-01',
                  'periodEnd', '2025-12-31',
                  'publishedAt', null,
                  'eventAt', null
                )
              ),
              jsonb_build_object(
                'id', 'evidence_3',
                'fact', 'Product/Market Fit Score: strong.',
                'excerpt', 'Product/Market Fit Score: strong.',
                'page', 1,
                'structured', jsonb_build_object(
                  'field', 'Product/Market Fit Score',
                  'value', 'strong',
                  'unit', null,
                  'currency', null,
                  'periodStart', null,
                  'periodEnd', null,
                  'publishedAt', null,
                  'eventAt', null
                )
              ),
              jsonb_build_object(
                'id', 'evidence_4',
                'fact', 'Monthly Recurring Revenue was $200,000 USD.',
                'excerpt', 'Monthly Recurring Revenue was $200,000 USD.',
                'page', 1,
                'structured', jsonb_build_object(
                  'field', 'Monthly Recurring Revenue',
                  'value', '$200,000',
                  'unit', 'currency',
                  'currency', 'USD',
                  'periodStart', null,
                  'periodEnd', null,
                  'publishedAt', null,
                  'eventAt', null
                )
              ),
              jsonb_build_object(
                'id', 'evidence_5',
                'fact', 'ARR was $2M USD.',
                'excerpt', 'ARR was $2M USD.',
                'page', 1,
                'structured', jsonb_build_object(
                  'field', 'ARR',
                  'value', '$2M',
                  'unit', 'currency',
                  'currency', 'USD',
                  'periodStart', null,
                  'periodEnd', null,
                  'publishedAt', null,
                  'eventAt', null
                )
              ),
              jsonb_build_object(
                'id', 'evidence_6',
                'fact', 'ARR was $2,000,000 ABC.',
                'excerpt', 'ARR was $2,000,000 ABC.',
                'page', 1,
                'structured', jsonb_build_object(
                  'field', 'ARR',
                  'value', '$2,000,000',
                  'unit', 'currency',
                  'currency', 'ABC',
                  'periodStart', null,
                  'periodEnd', null,
                  'publishedAt', null,
                  'eventAt', null
                )
              ),
              jsonb_build_object(
                'id', 'evidence_7',
                'fact',
                  'ARR was $2,000,000 USD from 2025-02-30 through 2025-12-31.',
                'excerpt',
                  'ARR was $2,000,000 USD from 2025-02-30 through 2025-12-31.',
                'page', 1,
                'structured', jsonb_build_object(
                  'field', 'ARR',
                  'value', '$2,000,000',
                  'unit', 'currency',
                  'currency', 'USD',
                  'periodStart', '2025-02-30',
                  'periodEnd', '2025-12-31',
                  'publishedAt', null,
                  'eventAt', null
                )
              ),
              jsonb_build_object(
                'id', 'evidence_8',
                'fact',
                  'ARR was $2,000,000 USD as of 2025-02-30T12:00:00.000Z.',
                'excerpt',
                  'ARR was $2,000,000 USD as of 2025-02-30T12:00:00.000Z.',
                'page', 1,
                'structured', jsonb_build_object(
                  'field', 'ARR',
                  'value', '$2,000,000',
                  'unit', 'currency',
                  'currency', 'USD',
                  'periodStart', null,
                  'periodEnd', null,
                  'publishedAt', null,
                  'eventAt', '2025-02-30T12:00:00.000Z'
                )
              ),
              jsonb_build_object(
                'id', 'evidence_9',
                'fact',
                  'ARR was $2,000,000 USD from 2025-12-31 through 2025-01-01.',
                'excerpt',
                  'ARR was $2,000,000 USD from 2025-12-31 through 2025-01-01.',
                'page', 1,
                'structured', jsonb_build_object(
                  'field', 'ARR',
                  'value', '$2,000,000',
                  'unit', 'currency',
                  'currency', 'USD',
                  'periodStart', '2025-12-31',
                  'periodEnd', '2025-01-01',
                  'publishedAt', null,
                  'eventAt', null
                )
              ),
              jsonb_build_object(
                'id', 'evidence_10',
                'fact', 'ARR was $2,000,000 in a USDA filing.',
                'excerpt', 'ARR was $2,000,000 in a USDA filing.',
                'page', 1,
                'structured', jsonb_build_object(
                  'field', 'ARR',
                  'value', '$2,000,000',
                  'unit', 'currency',
                  'currency', 'USD',
                  'periodStart', null,
                  'periodEnd', null,
                  'publishedAt', null,
                  'eventAt', null
                )
              ),
              jsonb_build_object(
                'id', 'evidence_11',
                'fact', 'The company carried $2,000,000 USD.',
                'excerpt', 'The company carried $2,000,000 USD.',
                'page', 1,
                'structured', jsonb_build_object(
                  'field', 'ARR',
                  'value', '$2,000,000',
                  'unit', 'currency',
                  'currency', 'USD',
                  'periodStart', null,
                  'periodEnd', null,
                  'publishedAt', null,
                  'eventAt', null
                )
              ),
              jsonb_build_object(
                'id', 'evidence_12',
                'fact',
                  'ARR was $2,000,000 USD as of 2025-01-01T12:00:00.000+19:00.',
                'excerpt',
                  'ARR was $2,000,000 USD as of 2025-01-01T12:00:00.000+19:00.',
                'page', 1,
                'structured', jsonb_build_object(
                  'field', 'ARR',
                  'value', '$2,000,000',
                  'unit', 'currency',
                  'currency', 'USD',
                  'periodStart', null,
                  'periodEnd', null,
                  'publishedAt', null,
                  'eventAt', '2025-01-01T12:00:00.000+19:00'
                )
              ),
              jsonb_build_object(
                'id', 'evidence_13',
                'fact',
                  'ARR was $2,000,000 USD from 2025-01-01 through 2025-12-31; event 2025-12-31T23:59:59.000Z; published 2026-01-15T10:30:00.000Z.',
                'excerpt',
                  'ARR was $2,000,000 USD from 2025-01-01 through 2025-12-31; event 2025-12-31T23:59:59.000Z; published 2026-01-15T10:30:00.000Z.',
                'page', 1,
                'structured', jsonb_build_object(
                  'field', E'\\tARR\\n',
                  'value', E'\\n$2,000,000\\t',
                  'unit', E'\\tcurrency\\n',
                  'currency', E'\\nUSD\\t',
                  'periodStart', E'\\t2025-01-01\\n',
                  'periodEnd', E'\\n2025-12-31\\t',
                  'publishedAt',
                    E'\\t2026-01-15T10:30:00.000Z\\n',
                  'eventAt',
                    E'\\n2025-12-31T23:59:59.000Z\\t'
                )
              ),
              jsonb_build_object(
                'id', 'evidence_14',
                'fact', 'A USDA filing reported ARR of $2,000,000 USD.',
                'excerpt', 'A USDA filing reported ARR of $2,000,000 USD.',
                'page', 1,
                'structured', jsonb_build_object(
                  'field', 'ARR',
                  'value', '$2,000,000',
                  'unit', 'currency',
                  'currency', 'USD',
                  'periodStart', null,
                  'periodEnd', null,
                  'publishedAt', null,
                  'eventAt', null
                )
              ),
              jsonb_build_object(
                'id', 'evidence_15',
                'fact',
                  'The company carried prior figures; ARR was $2,000,000 USD.',
                'excerpt',
                  'The company carried prior figures; ARR was $2,000,000 USD.',
                'page', 1,
                'structured', jsonb_build_object(
                  'field', 'ARR',
                  'value', '$2,000,000',
                  'unit', 'currency',
                  'currency', 'USD',
                  'periodStart', null,
                  'periodEnd', null,
                  'publishedAt', null,
                  'eventAt', null
                )
              ),
              jsonb_build_object(
                'id', 'evidence_16',
                'fact',
                  'ARR was $2,000,000 USD from 2025-01-01 through 2025-12-31; event 2025-12-31T23:59:59.000Z; published 2026-01-15T10:30:00.000Z.',
                'excerpt',
                  'ARR was $2,000,000 USD from 2025-01-01 through 2025-12-31; event 2025-12-31T23:59:59.000Z; published 2026-01-15T10:30:00.000Z.',
                'page', 1,
                'structured', jsonb_build_object(
                  'field', U&'\\00A0ARR\\00A0',
                  'value', '$2,000,000',
                  'unit', 'currency',
                  'currency', 'USD',
                  'periodStart', '2025-01-01',
                  'periodEnd', '2025-12-31',
                  'publishedAt', '2026-01-15T10:30:00.000Z',
                  'eventAt', '2025-12-31T23:59:59.000Z'
                )
              ),
              jsonb_build_object(
                'id', 'evidence_17',
                'fact', 'ARR was $2,000,000 USD.',
                'excerpt', 'ARR was $2,000,000 USD.',
                'page', 1,
                'structured', jsonb_build_object(
                  'field', 'ARR',
                  'value', '$2,000,000 USD',
                  'unit', 'currency',
                  'currency', 'USD',
                  'periodStart', null,
                  'periodEnd', null,
                  'publishedAt', null,
                  'eventAt', null
                )
              ),
              jsonb_build_object(
                'id', 'evidence_18',
                'fact',
                  'ARR was $2,000,000'
                    || pg_catalog.chr(9)
                    || pg_catalog.chr(10)
                    || pg_catalog.chr(11)
                    || pg_catalog.chr(12)
                    || pg_catalog.chr(13)
                    || ' USD.',
                'excerpt',
                  'ARR was $2,000,000'
                    || pg_catalog.chr(9)
                    || pg_catalog.chr(10)
                    || pg_catalog.chr(11)
                    || pg_catalog.chr(12)
                    || pg_catalog.chr(13)
                    || ' USD.',
                'page', 1,
                'structured', jsonb_build_object(
                  'field', 'ARR',
                  'value',
                    '$2,000,000'
                      || pg_catalog.chr(9)
                      || pg_catalog.chr(10)
                      || pg_catalog.chr(11)
                      || pg_catalog.chr(12)
                      || pg_catalog.chr(13)
                      || ' USD',
                  'unit', 'currency',
                  'currency', 'USD',
                  'periodStart', null,
                  'periodEnd', null,
                  'publishedAt', null,
                  'eventAt', null
                )
              ),
              jsonb_build_object(
                'id', 'evidence_19',
                'fact',
                  'ARR was $2,000,000'
                    || pg_catalog.chr(160)
                    || 'USD.',
                'excerpt',
                  'ARR was $2,000,000'
                    || pg_catalog.chr(160)
                    || 'USD.',
                'page', 1,
                'structured', jsonb_build_object(
                  'field', 'ARR',
                  'value',
                    '$2,000,000' || pg_catalog.chr(160) || 'USD',
                  'unit', 'currency',
                  'currency', 'USD',
                  'periodStart', null,
                  'periodEnd', null,
                  'publishedAt', null,
                  'eventAt', null
                )
              ),
              jsonb_build_object(
                'id', 'evidence_20',
                'fact',
                  'ARR was $2,000,000'
                    || pg_catalog.chr(8195)
                    || 'USD.',
                'excerpt',
                  'ARR was $2,000,000'
                    || pg_catalog.chr(8195)
                    || 'USD.',
                'page', 1,
                'structured', jsonb_build_object(
                  'field', 'ARR',
                  'value',
                    '$2,000,000' || pg_catalog.chr(8195) || 'USD',
                  'unit', 'currency',
                  'currency', 'USD',
                  'periodStart', null,
                  'periodEnd', null,
                  'publishedAt', null,
                  'eventAt', null
                )
              ),
              jsonb_build_object(
                'id', 'evidence_21',
                'fact', 'The image reports ARR of $2,000,000 USD.',
                'excerpt', null,
                'page', 1,
                'locator', jsonb_build_object(
                  'kind', 'image',
                  'imageIndex', 0,
                  'region', null
                ),
                'structured', jsonb_build_object(
                  'field', 'ARR',
                  'value', '$2,000,000',
                  'unit', 'currency',
                  'currency', 'USD',
                  'periodStart', null,
                  'periodEnd', null,
                  'publishedAt', null,
                  'eventAt', null
                )
              )
            )
          ));
          select count(*)
          from public.claim_next_uploaded_document(
            'confirmed', 'worker-a', 300
          );
          insert into public.uploaded_documents (
            id, workspace_id, filename, content_type, byte_size, checksum,
            object_key, status
          ) values (
            'upload_2', 'workspace_upload', 'second.txt', 'text/plain', 20,
            'content-hash-two', 'private/workspace_upload/second.txt',
            'queued'
          );
          do $lease_test$
          declare
            lease_token uuid;
            transitioned boolean;
          begin
            update public.uploaded_documents
            set lease_expires_at = clock_timestamp() - interval '1 second'
            where workspace_id = 'workspace_upload' and id = 'upload_1';
            select public.transition_uploaded_document_lease(
              'workspace_upload', 'upload_1', 'worker-a',
              (select upload.lease_token
               from public.uploaded_documents as upload
               where upload.workspace_id = 'workspace_upload'
                 and upload.id = 'upload_1'),
              'confirmed_complete', null, null
            ) into transitioned;
            if transitioned then
              raise exception 'expired confirmed completion succeeded';
            end if;
            select public.transition_uploaded_document_lease(
              'workspace_upload', 'upload_1', 'worker-a',
              (select upload.lease_token
               from public.uploaded_documents as upload
               where upload.workspace_id = 'workspace_upload'
                 and upload.id = 'upload_1'),
              'confirmed_fail', null, 'expired confirmed failure'
            ) into transitioned;
            if transitioned then
              raise exception 'expired confirmed failure succeeded';
            end if;
            perform *
            from public.claim_next_uploaded_document(
              'confirmed', 'worker-b', 300
            );
            select upload.lease_token into lease_token
            from public.uploaded_documents as upload
            where upload.workspace_id = 'workspace_upload'
              and upload.id = 'upload_1';
            select public.transition_uploaded_document_lease(
              'workspace_upload', 'upload_1', 'worker-b', lease_token,
              'confirmed_complete', null, null
            ) into transitioned;
            if not transitioned then
              raise exception 'reclaimed confirmed completion failed';
            end if;

            update public.uploaded_documents
            set status = 'ingesting_memory',
                worker_id = 'expired-confirmed-fail',
                lease_token = gen_random_uuid(),
                lease_expires_at = clock_timestamp() - interval '1 second'
            where workspace_id = 'workspace_upload' and id = 'upload_1';
            select public.transition_uploaded_document_lease(
              'workspace_upload', 'upload_1', 'expired-confirmed-fail',
              (select upload.lease_token
               from public.uploaded_documents as upload
               where upload.workspace_id = 'workspace_upload'
                 and upload.id = 'upload_1'),
              'confirmed_fail', null, 'expired confirmed failure'
            ) into transitioned;
            if transitioned then
              raise exception 'second expired confirmed failure succeeded';
            end if;
            perform *
            from public.claim_next_uploaded_document(
              'confirmed', 'worker-c', 300
            );
            select upload.lease_token into lease_token
            from public.uploaded_documents as upload
            where upload.workspace_id = 'workspace_upload'
              and upload.id = 'upload_1';
            select public.transition_uploaded_document_lease(
              'workspace_upload', 'upload_1', 'worker-c', lease_token,
              'confirmed_fail', null, 'retryable provider failure'
            ) into transitioned;
            if not transitioned then
              raise exception 'reclaimed confirmed failure failed';
            end if;

            perform *
            from public.claim_next_uploaded_document(
              'queued', 'extractor-a', 300
            );
            update public.uploaded_documents
            set lease_expires_at = clock_timestamp() - interval '1 second'
            where workspace_id = 'workspace_upload' and id = 'upload_2';
            select public.transition_uploaded_document_lease(
              'workspace_upload', 'upload_2', 'extractor-a',
              (select upload.lease_token
               from public.uploaded_documents as upload
               where upload.workspace_id = 'workspace_upload'
                 and upload.id = 'upload_2'),
              'extraction_complete',
              '{"candidateCompanyName":"Second","candidateHeadline":null,"facts":[],"extractionMetadata":{"extractorId":"plain_text_v1","extractorVersion":"1","extractedAt":"2026-07-29T12:10:00.000Z"}}',
              null
            ) into transitioned;
            if transitioned then
              raise exception 'expired extraction completion succeeded';
            end if;
            select public.transition_uploaded_document_lease(
              'workspace_upload', 'upload_2', 'extractor-a',
              (select upload.lease_token
               from public.uploaded_documents as upload
               where upload.workspace_id = 'workspace_upload'
                 and upload.id = 'upload_2'),
              'extraction_fail', null, 'expired extraction failure'
            ) into transitioned;
            if transitioned then
              raise exception 'expired extraction failure succeeded';
            end if;
            perform *
            from public.claim_next_uploaded_document(
              'queued', 'extractor-b', 300
            );
            select upload.lease_token into lease_token
            from public.uploaded_documents as upload
            where upload.workspace_id = 'workspace_upload'
              and upload.id = 'upload_2';
            select public.transition_uploaded_document_lease(
              'workspace_upload', 'upload_2', 'extractor-b', lease_token,
              'extraction_complete',
              '{"candidateCompanyName":"Second","candidateHeadline":null,"facts":[],"extractionMetadata":{"extractorId":"plain_text_v1","extractorVersion":"1","extractedAt":"2026-07-29T12:10:00.000Z"}}',
              null
            ) into transitioned;
            if not transitioned then
              raise exception 'reclaimed extraction completion failed';
            end if;

            update public.uploaded_documents
            set status = 'extracting',
                extraction_preview = null,
                failure_reason = null,
                worker_id = 'expired-extraction-fail',
                lease_token = gen_random_uuid(),
                lease_expires_at = clock_timestamp() - interval '1 second'
            where workspace_id = 'workspace_upload' and id = 'upload_2';
            select public.transition_uploaded_document_lease(
              'workspace_upload', 'upload_2', 'expired-extraction-fail',
              (select upload.lease_token
               from public.uploaded_documents as upload
               where upload.workspace_id = 'workspace_upload'
                 and upload.id = 'upload_2'),
              'extraction_fail', null, 'expired extraction failure'
            ) into transitioned;
            if transitioned then
              raise exception 'second expired extraction failure succeeded';
            end if;
            perform *
            from public.claim_next_uploaded_document(
              'queued', 'extractor-c', 300
            );
            select upload.lease_token into lease_token
            from public.uploaded_documents as upload
            where upload.workspace_id = 'workspace_upload'
              and upload.id = 'upload_2';
            select public.transition_uploaded_document_lease(
              'workspace_upload', 'upload_2', 'extractor-c', lease_token,
              'extraction_fail', null, 'terminal extraction failure'
            ) into transitioned;
            if not transitioned then
              raise exception 'reclaimed extraction failure failed';
            end if;
          end
          $lease_test$;
          select confirmed.status || '|' || extraction.status || '|' ||
            confirmed.deal_id || '|' || confirmed.source_revision_id || '|' ||
            (select count(*) from public.source_revisions
             where workspace_id = 'workspace_upload') || '|' ||
            (select count(*) from public.deal_source_assignments
             where workspace_id = 'workspace_upload') || '|' ||
            (select document.checksum
             from public.source_documents as document
             where document.id = 'source_1') || '|' ||
            (select revision.content_hash
             from public.source_revisions as revision
             where revision.workspace_id = 'workspace_upload'
               and revision.id = 'revision_1') || '|' ||
            (select count(*) from public.source_evidence
             where workspace_id = 'workspace_upload') || '|' ||
            (select count(*) from public.source_evidence_items
             where workspace_id = 'workspace_upload') || '|' ||
            (select string_agg(
                      item.evidence_id || ':' ||
                      (item.payload ->> 'field') || ':' ||
                      (item.payload ->> 'acceptedForGate'),
                      ',' order by
                        substring(item.evidence_id from '[0-9]+$')::integer
                    )
             from public.source_evidence_items as item
             where item.workspace_id = 'workspace_upload') || '|' ||
            (select concat_ws(
                      ':',
                      item.payload ->> 'field',
                      item.payload ->> 'value',
                      item.payload ->> 'unit',
                      item.payload ->> 'currency',
                      item.payload ->> 'periodStart',
                      item.payload ->> 'periodEnd',
                      item.payload ->> 'publishedAt',
                      item.payload ->> 'eventAt'
                    )
             from public.source_evidence_items as item
             where item.workspace_id = 'workspace_upload'
               and item.evidence_id = 'evidence_13') || '|' ||
            (select item.source_id || ':' ||
                    (item.payload ->> 'sourceId')
             from public.source_evidence_items as item
             where item.workspace_id = 'workspace_backfill'
               and item.evidence_id = 'evidence_backfill') || '|' ||
            (select
               (item.payload #>> '{locator,kind}') || ':' ||
               (item.payload #>> '{locator,imageIndex}') || ':' ||
               (item.payload ->> 'field') || ':' ||
               (item.payload ->> 'acceptedForGate')
             from public.source_evidence_items as item
             where item.workspace_id = 'workspace_upload'
               and item.evidence_id = 'evidence_21')
          from public.uploaded_documents as confirmed
          cross join public.uploaded_documents as extraction
          where confirmed.workspace_id = 'workspace_upload'
            and confirmed.id = 'upload_1'
            and extraction.workspace_id = 'workspace_upload'
            and extraction.id = 'upload_2';
        `,
      ], { encoding: "utf8" }).trim().split(/\r?\n/).at(-1) ?? "";
      assert.equal(
        output,
        "confirmed|failed|deal_1|revision_1|1|1|content-hash|content-hash|20|21|"
          + "evidence_1:ARR:true,"
          + "evidence_2:unstructured_source_fact:false,"
          + "evidence_3:unstructured_source_fact:false,"
          + "evidence_4:unstructured_source_fact:false,"
          + "evidence_5:unstructured_source_fact:false,"
          + "evidence_6:unstructured_source_fact:false,"
          + "evidence_7:unstructured_source_fact:false,"
          + "evidence_8:unstructured_source_fact:false,"
          + "evidence_9:unstructured_source_fact:false"
          + ",evidence_10:unstructured_source_fact:false"
          + ",evidence_11:unstructured_source_fact:false"
          + ",evidence_12:unstructured_source_fact:false"
          + ",evidence_13:ARR:true"
          + ",evidence_14:ARR:true"
          + ",evidence_15:ARR:true"
          + ",evidence_16:unstructured_source_fact:false"
          + ",evidence_17:ARR:true"
          + ",evidence_18:ARR:true"
          + ",evidence_19:unstructured_source_fact:false"
          + ",evidence_20:unstructured_source_fact:false"
          + ",evidence_21:ARR:true"
          + "|ARR:$2,000,000:currency:USD:2025-01-01:2025-12-31:"
          + "2026-01-15T10:30:00.000Z:2025-12-31T23:59:59.000Z"
          + "|source_backfill:source_backfill"
          + "|image:0:ARR:true",
      );
    } finally {
      execFileSync("dropdb", ["--if-exists", database], { stdio: "pipe" });
    }
  },
);

test(
  "0016 backfills pre-upgrade text confirmations, quarantines image summaries, and narrows upload privileges",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    const database = makeDisposableDatabaseName("upload_legacy");
    execFileSync("createdb", [database], { stdio: "pipe" });
    try {
      for (const migration of migrationsThroughImmutableUploadConfirmation) {
        execFileSync("psql", [
          "-v",
          "ON_ERROR_STOP=1",
          "-d",
          database,
          "-f",
          fileURLToPath(new URL(`../../drizzle/${migration}`, import.meta.url)),
        ], { stdio: "pipe" });
      }

      execFileSync("psql", [
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        database,
        "-c",
        `
          insert into public.workspaces (id, name) values
            ('workspace_legacy_text', 'Legacy text'),
            ('workspace_legacy_image', 'Legacy image');
          insert into public.uploaded_documents (
            id, workspace_id, filename, content_type, byte_size, checksum,
            object_key, status, extraction_preview
          ) values
            (
              'upload_legacy_text', 'workspace_legacy_text', 'legacy.md',
              'text/markdown', 38, 'legacy-text-hash',
              'private/workspace_legacy_text/legacy.md',
              'awaiting_confirmation',
              '{"extractionMetadata":{"extractorId":"plain_text_v1","extractorVersion":"1","extractedAt":"2026-07-28T10:00:00.000Z"}}'
            ),
            (
              'upload_legacy_image', 'workspace_legacy_image', 'legacy.png',
              'image/png', 128, 'legacy-image-hash',
              'private/workspace_legacy_image/legacy.png',
              'awaiting_confirmation',
              '{"extractionMetadata":{"extractorId":"claude_vision_v1","extractorVersion":"1","extractedAt":"2026-07-28T11:00:00.000Z"}}'
            );
          select public.confirm_uploaded_document(jsonb_build_object(
            'workspaceId', 'workspace_legacy_text',
            'uploadId', 'upload_legacy_text',
            'confirmationFingerprint', 'sha256:${"a".repeat(64)}',
            'dealId', 'deal_legacy_text',
            'companyId', 'company_legacy_text',
            'companyName', 'Legacy Text Co',
            'dealStatus', 'watchlist',
            'sourceId', 'source_legacy_text',
            'sourceRevisionId', 'revision_legacy_text',
            'assignedByUserId', 'user_legacy',
            'confirmedAt', '2026-07-28T10:05:00.000Z',
            'evidence', jsonb_build_array(jsonb_build_object(
              'id', 'evidence_legacy_text',
              'fact', 'Legacy Text Co serves 42 enterprise customers.',
              'excerpt', 'Legacy Text Co serves 42 enterprise customers.',
              'page', 1
            ))
          ));
          select public.confirm_uploaded_document(jsonb_build_object(
            'workspaceId', 'workspace_legacy_image',
            'uploadId', 'upload_legacy_image',
            'confirmationFingerprint', 'sha256:${"b".repeat(64)}',
            'dealId', 'deal_legacy_image',
            'companyId', 'company_legacy_image',
            'companyName', 'Legacy Image Co',
            'dealStatus', 'screening',
            'sourceId', 'source_legacy_image',
            'sourceRevisionId', 'revision_legacy_image',
            'assignedByUserId', 'user_legacy',
            'confirmedAt', '2026-07-28T11:05:00.000Z',
            'evidence', jsonb_build_array(jsonb_build_object(
              'id', 'evidence_legacy_image',
              'fact', 'The vision model inferred $8M ARR.',
              'excerpt', 'The vision model inferred $8M ARR.',
              'page', 1
            ))
          ));

          insert into public.scan_runs (
            id, workspace_id, mode, status
          ) values
            (
              '11111111-1111-4111-8111-111111111111',
              'workspace_legacy_text', 'structured', 'completed'
            ),
            (
              '22222222-2222-4222-8222-222222222222',
              'workspace_legacy_image', 'structured', 'completed'
            ),
            (
              '33333333-3333-4333-8333-333333333333',
              'workspace_legacy_image', 'structured', 'completed'
            );
          insert into public.intelligence_reports (
            id, workspace_id, run_id, market_summary, opportunities,
            analysis_status, company_count
          ) values
            (
              'report_legacy_text',
              'workspace_legacy_text',
              '11111111-1111-4111-8111-111111111111',
              'Text-backed report must survive the bridge.',
              jsonb_build_array(jsonb_build_object(
                'dealId', 'deal_legacy_text',
                'sources', jsonb_build_array(jsonb_build_object(
                  'id', 'evidence_legacy_text'
                ))
              )),
              'completed', 1
            ),
            (
              'report_legacy_image_analysis',
              'workspace_legacy_image',
              '22222222-2222-4222-8222-222222222222',
              'Image-derived analysis must be invalidated.',
              '[]'::jsonb,
              'completed', 1
            ),
            (
              'report_legacy_image_opportunity',
              'workspace_legacy_image',
              '33333333-3333-4333-8333-333333333333',
              'Image-derived opportunity must be invalidated.',
              jsonb_build_array(jsonb_build_object(
                'dealId', 'deal_legacy_image',
                'sources', jsonb_build_array(jsonb_build_object(
                  'id', 'evidence_legacy_image'
                ))
              )),
              'completed', 0
            );
          insert into public.company_analyses (
            id, workspace_id, report_id, run_id, deal_id, company_name,
            deal_status, outcome, confidence, score, investment_memory,
            market_evidence, implications, recommended_next_move,
            company_brief, source_refs
          ) values
            (
              'analysis_legacy_text',
              'workspace_legacy_text',
              'report_legacy_text',
              '11111111-1111-4111-8111-111111111111',
              'deal_legacy_text', 'Legacy Text Co', 'watchlist', 'monitor',
              'medium', 0.5, '{}'::jsonb, '{}'::jsonb,
              '{"positive":[],"negative":[]}'::jsonb,
              'Keep the clean text-backed analysis.',
              '{}'::jsonb,
              jsonb_build_array(jsonb_build_object(
                'id', 'evidence_legacy_text'
              ))
            ),
            (
              'analysis_legacy_image',
              'workspace_legacy_image',
              'report_legacy_image_analysis',
              '22222222-2222-4222-8222-222222222222',
              'deal_legacy_image', 'Legacy Image Co', 'screening',
              'belief_revised', 'high', 0.9, '{}'::jsonb, '{}'::jsonb,
              '{"positive":[],"negative":[]}'::jsonb,
              'Act on the ungrounded image summary.',
              '{}'::jsonb,
              jsonb_build_array(jsonb_build_object(
                'id', 'evidence_legacy_image'
              ))
            );

          insert into public.xtrace_ingest_jobs (
            job_id, workspace_id, deal_id, source_revision_ids, source_ids,
            fixture_ids, bundle_fingerprint, serializer_version, provenance,
            status, memory_ids
          ) values
            (
              'job_legacy_text',
              'workspace_legacy_text',
              'deal_legacy_text',
              '["revision_legacy_text"]'::jsonb,
              '["source_legacy_text"]'::jsonb,
              '[]'::jsonb,
              'fingerprint-legacy-text',
              'deal-memory-v1',
              'source_document',
              'succeeded',
              '["memory_legacy_text"]'::jsonb
            ),
            (
              'job_legacy_image',
              'workspace_legacy_image',
              'deal_legacy_image',
              '["revision_legacy_image"]'::jsonb,
              '["source_legacy_image"]'::jsonb,
              '[]'::jsonb,
              'fingerprint-legacy-image',
              'deal-memory-v1',
              'source_document',
              'succeeded',
              '["memory_legacy_image"]'::jsonb
            );
          insert into public.xtrace_memory_links (
            memory_id, workspace_id, deal_id, source_revision_ids, source_ids,
            fixture_ids, provenance
          ) values
            (
              'memory_legacy_text',
              'workspace_legacy_text',
              'deal_legacy_text',
              '["revision_legacy_text"]'::jsonb,
              '["source_legacy_text"]'::jsonb,
              '[]'::jsonb,
              'source_document'
            ),
            (
              'memory_legacy_image',
              'workspace_legacy_image',
              'deal_legacy_image',
              '["revision_legacy_image"]'::jsonb,
              '["source_legacy_image"]'::jsonb,
              '[]'::jsonb,
              'source_document'
            );

          insert into public.fund_policy_versions (
            id, workspace_id, version, source, values
          ) values
            (
              'fund_legacy_text', 'workspace_legacy_text', 1,
              'recommended_policy', '{}'::jsonb
            ),
            (
              'fund_legacy_image', 'workspace_legacy_image', 1,
              'recommended_policy', '{}'::jsonb
            );
          insert into public.underwriting_batches (
            id, workspace_id, scan_run_id, status, batch_input_fingerprint,
            fund_policy_snapshot_id, force_refresh, refresh_nonce, rerun_of_id
          ) values
            (
              'batch_legacy_text', 'workspace_legacy_text',
              '11111111-1111-4111-8111-111111111111', 'completed',
              'sha256:${"c".repeat(64)}', 'fund_legacy_text',
              false, null, null
            ),
            (
              'batch_legacy_image', 'workspace_legacy_image',
              '22222222-2222-4222-8222-222222222222', 'completed',
              'sha256:${"d".repeat(64)}', 'fund_legacy_image',
              false, null, null
            ),
            (
              'batch_legacy_image_alias', 'workspace_legacy_image',
              '22222222-2222-4222-8222-222222222222', 'completed',
              'sha256:${"d".repeat(64)}', 'fund_legacy_image',
              true, 'legacy-image-alias', 'batch_legacy_image'
            );
          insert into public.underwriting_selections (
            batch_id, workspace_id, deal_id, status, rank, reason
          ) values
            (
              'batch_legacy_text', 'workspace_legacy_text',
              'deal_legacy_text', 'selected', 1,
              'Clean text candidate must survive.'
            ),
            (
              'batch_legacy_image', 'workspace_legacy_image',
              'deal_legacy_image', 'selected', 1,
              'Legacy image candidate must be invalidated.'
            ),
            (
              'batch_legacy_image_alias', 'workspace_legacy_image',
              'deal_legacy_image', 'selected', 1,
              'Legacy image alias must also be invalidated.'
            );
          insert into public.candidate_runs (
            id, batch_id, workspace_id, deal_id, status,
            candidate_analysis_fingerprint, rerun_of_id,
            artifact_source_candidate_run_id, finalized_at
          ) values
            (
              'candidate_legacy_text', 'batch_legacy_text',
              'workspace_legacy_text', 'deal_legacy_text', 'completed',
              'sha256:${"e".repeat(64)}', null, null,
              '2026-07-28T12:00:00.000Z'
            ),
            (
              'candidate_legacy_image', 'batch_legacy_image',
              'workspace_legacy_image', 'deal_legacy_image', 'completed',
              'sha256:${"f".repeat(64)}', null, null,
              '2026-07-28T12:00:00.000Z'
            ),
            (
              'candidate_legacy_image_alias', 'batch_legacy_image_alias',
              'workspace_legacy_image', 'deal_legacy_image', 'completed',
              'sha256:${"f".repeat(64)}', 'candidate_legacy_image',
              'candidate_legacy_image', '2026-07-28T12:00:00.000Z'
            );
          insert into public.candidate_checkpoints (
            candidate_run_id, workspace_id, stage, status,
            input_fingerprint, saved_at
          ) values
            (
              'candidate_legacy_text', 'workspace_legacy_text',
              'finalization', 'completed', 'checkpoint-text',
              '2026-07-28T12:00:00.000Z'
            ),
            (
              'candidate_legacy_image', 'workspace_legacy_image',
              'finalization', 'completed', 'checkpoint-image',
              '2026-07-28T12:00:00.000Z'
            );
          insert into public.evidence_packs (
            workspace_id, candidate_run_id, artifact_id, version, payload
          ) values
            (
              'workspace_legacy_text', 'candidate_legacy_text',
              'pack_legacy_text', 1, '{}'::jsonb
            ),
            (
              'workspace_legacy_image', 'candidate_legacy_image',
              'pack_legacy_image', 1, '{}'::jsonb
            );
          insert into public.underwriting_narratives (
            workspace_id, candidate_run_id, body
          ) values
            (
              'workspace_legacy_text', 'candidate_legacy_text',
              'Clean text-only searchable narrative.'
            ),
            (
              'workspace_legacy_image', 'candidate_legacy_image',
              'Polluted legacy image searchable narrative.'
            );
          insert into public.final_syntheses (
            workspace_id, candidate_run_id, artifact_id, payload
          ) values
            (
              'workspace_legacy_text', 'candidate_legacy_text',
              'synthesis_legacy_text', '{}'::jsonb
            ),
            (
              'workspace_legacy_image', 'candidate_legacy_image',
              'synthesis_legacy_image', '{}'::jsonb
            );
          insert into public.action_drafts (
            workspace_id, candidate_run_id, artifact_id, payload
          ) values
            (
              'workspace_legacy_text', 'candidate_legacy_text',
              'draft_legacy_text',
              '{
                "id":"draft_legacy_text",
                "workspaceId":"workspace_legacy_text",
                "candidateRunId":"candidate_legacy_text",
                "channel":"email",
                "audienceType":"internal",
                "body":"Clean text draft",
                "createdAt":"2026-07-28T12:00:00.000Z",
                "updatedAt":"2026-07-28T12:00:00.000Z"
              }'::jsonb
            ),
            (
              'workspace_legacy_image', 'candidate_legacy_image',
              'draft_legacy_image',
              '{
                "id":"draft_legacy_image",
                "workspaceId":"workspace_legacy_image",
                "candidateRunId":"candidate_legacy_image",
                "channel":"email",
                "audienceType":"internal",
                "body":"Quarantined image draft",
                "createdAt":"2026-07-28T12:00:00.000Z",
                "updatedAt":"2026-07-28T12:00:00.000Z"
              }'::jsonb
            );
          insert into public.candidate_version_snapshots (
            workspace_id, candidate_run_id, payload
          ) values
            (
              'workspace_legacy_text', 'candidate_legacy_text', '{}'::jsonb
            ),
            (
              'workspace_legacy_image', 'candidate_legacy_image', '{}'::jsonb
            );
          insert into public.evidence_pack_builds (
            workspace_id, input_fingerprint, pack_id, pack_payload,
            source_revision_snapshots
          ) values
            (
              'workspace_legacy_text', 'sha256:${"1".repeat(64)}',
              'build_pack_legacy_text',
              '{"workspaceId":"workspace_legacy_text","id":"build_pack_legacy_text","dealId":"deal_legacy_text"}'::jsonb,
              '[]'::jsonb
            ),
            (
              'workspace_legacy_image', 'sha256:${"2".repeat(64)}',
              'build_pack_legacy_image',
              '{"workspaceId":"workspace_legacy_image","id":"build_pack_legacy_image","dealId":"deal_legacy_image"}'::jsonb,
              '[]'::jsonb
            );
        `,
      ], { stdio: "pipe" });

      for (const migration of [
        "0014_read_api_action_drafts.sql",
        "0015_framework_catalog_checkpoint.sql",
        sourceEvidenceBridgeMigrationName,
      ]) {
        execFileSync("psql", [
          "-v",
          "ON_ERROR_STOP=1",
          "-d",
          database,
          "-f",
          fileURLToPath(new URL(`../../drizzle/${migration}`, import.meta.url)),
        ], { stdio: "pipe" });
      }

      execFileSync("psql", [
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        database,
        "-c",
        `
          do $shape_guard$
          begin
            begin
              update public.uploaded_documents
              set status = 'failed',
                  failure_reason = 'arbitrary confirmed failure'
              where workspace_id = 'workspace_legacy_text'
                and id = 'upload_legacy_text';
              raise exception
                'arbitrary confirmed failed lineage passed the shape guard';
            exception when check_violation then
              null;
            end;
            begin
              update public.uploaded_documents
              set source_revision_id = null
              where workspace_id = 'workspace_legacy_image'
                and id = 'upload_legacy_image';
              raise exception
                'partial quarantined lineage passed the shape guard';
            exception when check_violation then
              null;
            end;
          end;
          $shape_guard$;
        `,
      ], { stdio: "pipe" });

      const draftEditBoundary = execFileSync("psql", [
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        database,
        "-AtF",
        "|",
        "-c",
        `
          select
            coalesce(
              public.replace_action_draft_body(
                'workspace_legacy_image',
                'draft_legacy_image',
                'Unsafe quarantined edit'
              )::text,
              'null'
            ),
            (
              select draft.payload ->> 'body'
              from public.action_drafts as draft
              where draft.workspace_id = 'workspace_legacy_image'
                and draft.artifact_id = 'draft_legacy_image'
            ),
            (
              public.replace_action_draft_body(
                'workspace_legacy_text',
                'draft_legacy_text',
                'Clean revised draft'
              ) ->> 'body'
            );
        `,
      ], { encoding: "utf8" }).trim();
      assert.equal(
        draftEditBoundary,
        "null|Quarantined image draft|Clean revised draft",
      );

      const retainedUnderwritingProducts = execFileSync("psql", [
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        database,
        "-AtF",
        "|",
        "-c",
        `
          select
            (select string_agg(
                      batch.id || ':' || batch.status,
                      ',' order by batch.id
                    )
             from public.underwriting_batches as batch),
            (select string_agg(
                      selection.batch_id || ':' || selection.deal_id,
                      ',' order by selection.batch_id
                    )
             from public.underwriting_selections as selection),
            (select string_agg(
                      candidate.id || ':' || candidate.status || ':' ||
                      coalesce(candidate.artifact_source_candidate_run_id, '-')
                      || ':' ||
                      candidate.unavailable_reason_codes::text || ':' ||
                      coalesce(candidate.public_failure_reason, '-'),
                      ',' order by candidate.id
                    )
             from public.candidate_runs as candidate),
            (select string_agg(checkpoint.candidate_run_id, ','
                               order by checkpoint.candidate_run_id)
             from public.candidate_checkpoints as checkpoint),
            (select string_agg(pack.candidate_run_id, ','
                               order by pack.candidate_run_id)
             from public.evidence_packs as pack),
            (select string_agg(narrative.candidate_run_id, ','
                               order by narrative.candidate_run_id)
             from public.underwriting_narratives as narrative),
            (select string_agg(synthesis.candidate_run_id, ','
                               order by synthesis.candidate_run_id)
             from public.final_syntheses as synthesis),
            (select string_agg(draft.candidate_run_id, ','
                               order by draft.candidate_run_id)
             from public.action_drafts as draft),
            (select string_agg(snapshot.candidate_run_id, ','
                               order by snapshot.candidate_run_id)
             from public.candidate_version_snapshots as snapshot),
            (select string_agg(build.pack_id, ',' order by build.pack_id)
             from public.evidence_pack_builds as build),
            (select trigger.tgenabled
             from pg_catalog.pg_trigger as trigger
             where trigger.tgrelid =
                 'public.underwriting_narratives'::regclass
               and trigger.tgname =
                 'underwriting_narratives_immutable'
               and not trigger.tgisinternal);
        `,
      ], { encoding: "utf8" }).trim();
      assert.equal(
        retainedUnderwritingProducts,
        "batch_legacy_image:failed,batch_legacy_image_alias:failed,"
          + "batch_legacy_text:completed|"
          + "batch_legacy_image:deal_legacy_image,"
          + "batch_legacy_image_alias:deal_legacy_image,"
          + "batch_legacy_text:deal_legacy_text|"
          + "candidate_legacy_image:unavailable:-:"
          + "[\"legacy_image_evidence_quarantined\"]:"
          + "This underwriting result is unavailable because legacy image "
          + "evidence was quarantined. Upload the image again and run "
          + "analysis before relying on this result.,"
          + "candidate_legacy_image_alias:unavailable:-:"
          + "[\"legacy_image_evidence_quarantined\"]:"
          + "This underwriting result is unavailable because legacy image "
          + "evidence was quarantined. Upload the image again and run "
          + "analysis before relying on this result.,"
          + "candidate_legacy_text:completed:-:[]:-|"
          + "candidate_legacy_image,candidate_legacy_text|"
          + "candidate_legacy_image,candidate_legacy_text|"
          + "candidate_legacy_image,candidate_legacy_text|"
          + "candidate_legacy_image,candidate_legacy_text|"
          + "candidate_legacy_image,candidate_legacy_text|"
          + "candidate_legacy_image,candidate_legacy_text|"
          + "build_pack_legacy_image,build_pack_legacy_text|O",
      );

      const invalidatedLegacyProducts = execFileSync("psql", [
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        database,
        "-AtF",
        "|",
        "-c",
        `
          select
            (select string_agg(report.id, ',' order by report.id)
             from public.intelligence_reports as report),
            (select string_agg(analysis.id, ',' order by analysis.id)
             from public.company_analyses as analysis),
            (select string_agg(job.job_id, ',' order by job.job_id)
             from public.xtrace_ingest_jobs as job),
            (select string_agg(memory.memory_id, ',' order by memory.memory_id)
             from public.xtrace_memory_links as memory),
            (select upload.status
             from public.uploaded_documents as upload
             where upload.workspace_id = 'workspace_legacy_image'
               and upload.id = 'upload_legacy_image'),
            (select upload.failure_reason
             from public.uploaded_documents as upload
             where upload.workspace_id = 'workspace_legacy_image'
               and upload.id = 'upload_legacy_image'),
            (select upload.status
             from public.uploaded_documents as upload
             where upload.workspace_id = 'workspace_legacy_text'
               and upload.id = 'upload_legacy_text'),
            coalesce((
              select upload.failure_reason
              from public.uploaded_documents as upload
              where upload.workspace_id = 'workspace_legacy_text'
                and upload.id = 'upload_legacy_text'
            ), '-');
        `,
      ], { encoding: "utf8" }).trim();
      assert.equal(
        invalidatedLegacyProducts,
        "report_legacy_text|analysis_legacy_text|"
          + "job_legacy_text|memory_legacy_text|failed|"
          + "Legacy image evidence was quarantined because the prior "
          + "vision-model summary was not an exact quotation. "
          + "Upload the image again before using it for analysis."
          + "|confirmed|-",
      );

      execFileSync("psql", [
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        database,
        "-c",
        `
          insert into public.workspaces (id, name)
          values ('workspace_worker_rpc', 'Worker RPC');
          insert into public.uploaded_documents (
            id, workspace_id, filename, content_type, byte_size, checksum,
            object_key
          ) values (
            'upload_worker_rpc', 'workspace_worker_rpc', 'worker.txt',
            'text/plain', 12, 'worker-rpc-hash',
            'private/workspace_worker_rpc/worker.txt'
          );
        `,
      ], { stdio: "pipe" });
      execFileSync("psql", [
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        database,
        "-c",
        `
          begin;
          set local role service_role;
          select id, lease_token
          from public.claim_next_uploaded_document(
            'queued', 'worker-before-expiry', 300
          );
          commit;
        `,
      ], { stdio: "pipe" });
      const firstClaim = execFileSync("psql", [
        "-v",
        "ON_ERROR_STOP=1",
        "-qAtF",
        "|",
        "-d",
        database,
        "-c",
        `
          select id, lease_token
          from public.uploaded_documents
          where workspace_id = 'workspace_worker_rpc'
            and worker_id = 'worker-before-expiry';
        `,
      ], { encoding: "utf8" }).trim();
      const [claimedId, firstLeaseToken] = firstClaim.split("|");
      assert.equal(claimedId, "upload_worker_rpc");
      assert.match(
        firstLeaseToken ?? "",
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      execFileSync("psql", [
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        database,
        "-c",
        `
          update public.uploaded_documents
          set lease_expires_at = clock_timestamp() - interval '1 second'
          where workspace_id = 'workspace_worker_rpc'
            and id = 'upload_worker_rpc';
        `,
      ], { stdio: "pipe" });
      execFileSync("psql", [
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        database,
        "-c",
        `
          begin;
          set local role service_role;
          select id, lease_token
          from public.claim_next_uploaded_document(
            'queued', 'worker-after-expiry', 300
          );
          commit;
        `,
      ], { stdio: "pipe" });
      const reclaimed = execFileSync("psql", [
        "-v",
        "ON_ERROR_STOP=1",
        "-qAtF",
        "|",
        "-d",
        database,
        "-c",
        `
          select id, lease_token
          from public.uploaded_documents
          where workspace_id = 'workspace_worker_rpc'
            and worker_id = 'worker-after-expiry';
        `,
      ], { encoding: "utf8" }).trim();
      const [reclaimedId, secondLeaseToken] = reclaimed.split("|");
      assert.equal(reclaimedId, "upload_worker_rpc");
      assert.notEqual(secondLeaseToken, firstLeaseToken);
      execFileSync("psql", [
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        database,
        "-c",
        `
          begin;
          set local role service_role;
          select public.transition_uploaded_document_lease(
            'workspace_worker_rpc',
            'upload_worker_rpc',
            'worker-after-expiry',
            '${secondLeaseToken}'::uuid,
            'extraction_fail',
            null,
            'terminal extraction failure'
          );
          commit;
        `,
      ], { stdio: "pipe" });
      const failedStatus = execFileSync("psql", [
        "-v",
        "ON_ERROR_STOP=1",
        "-qAt",
        "-d",
        database,
        "-c",
        `
          select status
          from public.uploaded_documents
          where workspace_id = 'workspace_worker_rpc'
            and id = 'upload_worker_rpc';
        `,
      ], { encoding: "utf8" }).trim();
      assert.equal(failedStatus, "failed");

      const output = execFileSync("psql", [
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        database,
        "-AtF",
        "|",
        "-c",
        `
          select
            text_item.workspace_id,
            text_item.deal_id,
            text_item.source_id,
            text_item.source_revision_id,
            text_item.payload ->> 'field',
            text_item.payload ->> 'value',
            text_item.payload ->> 'acceptedForGate',
            text_item.payload #>> '{locator,kind}',
            text_item.payload #>> '{locator,page}',
            text_item.payload #>> '{locator,excerpt}',
            (select count(*) from public.source_evidence_items
             where workspace_id = 'workspace_legacy_image'),
            (select count(*) from public.source_evidence
             where workspace_id = 'workspace_legacy_image'),
            (select analysis_quarantine_reason
             from public.source_evidence
             where workspace_id = 'workspace_legacy_image'
               and id = 'evidence_legacy_image'),
            coalesce((
              select analysis_quarantine_reason
              from public.source_evidence
              where workspace_id = 'workspace_legacy_text'
                and id = 'evidence_legacy_text'
            ), 'eligible'),
            (select checksum from public.source_documents
             where id = 'source_legacy_text'),
            has_table_privilege(
              'service_role', 'public.uploaded_documents', 'SELECT'
            ),
            has_table_privilege(
              'service_role', 'public.uploaded_documents', 'INSERT'
            ),
            has_column_privilege(
              'service_role', 'public.uploaded_documents', 'id', 'INSERT'
            ),
            has_column_privilege(
              'service_role', 'public.uploaded_documents', 'status', 'INSERT'
            ),
            has_table_privilege(
              'service_role', 'public.uploaded_documents', 'UPDATE'
            ),
            has_table_privilege(
              'service_role', 'public.uploaded_documents', 'DELETE'
            ),
            has_table_privilege(
              'service_role', 'public.uploaded_documents', 'TRUNCATE'
            ),
            has_table_privilege(
              'service_role', 'public.source_documents', 'SELECT'
            ),
            has_table_privilege(
              'service_role', 'public.source_documents', 'INSERT'
            ),
            has_column_privilege(
              'service_role', 'public.source_documents', 'id', 'INSERT'
            ),
            has_column_privilege(
              'service_role', 'public.source_documents', 'created_at',
              'INSERT'
            ),
            has_table_privilege(
              'service_role', 'public.source_documents', 'UPDATE'
            ),
            has_table_privilege(
              'service_role', 'public.source_documents', 'DELETE'
            ),
            has_table_privilege(
              'service_role', 'public.source_documents', 'TRUNCATE'
            ),
            has_table_privilege(
              'service_role', 'public.workspace_documents', 'SELECT'
            ),
            has_table_privilege(
              'service_role', 'public.workspace_documents', 'INSERT'
            ),
            has_column_privilege(
              'service_role', 'public.workspace_documents', 'workspace_id',
              'INSERT'
            ),
            has_column_privilege(
              'service_role', 'public.workspace_documents', 'created_at',
              'INSERT'
            ),
            has_table_privilege(
              'service_role', 'public.workspace_documents', 'UPDATE'
            ),
            has_table_privilege(
              'service_role', 'public.workspace_documents', 'DELETE'
            ),
            has_table_privilege(
              'service_role', 'public.workspace_documents', 'TRUNCATE'
            ),
            has_table_privilege(
              'service_role', 'public.source_evidence', 'SELECT'
            ),
            has_table_privilege(
              'service_role', 'public.source_evidence', 'INSERT'
            ),
            has_column_privilege(
              'service_role', 'public.source_evidence', 'id', 'INSERT'
            ),
            has_column_privilege(
              'service_role', 'public.source_evidence', 'created_at',
              'INSERT'
            ),
            has_table_privilege(
              'service_role', 'public.source_evidence', 'UPDATE'
            ),
            has_table_privilege(
              'service_role', 'public.source_evidence', 'DELETE'
            ),
            has_table_privilege(
              'service_role', 'public.source_evidence', 'TRUNCATE'
            ),
            has_table_privilege(
              'service_role', 'public.source_evidence_items', 'SELECT'
            ),
            has_table_privilege(
              'service_role', 'public.source_evidence_items', 'INSERT'
            ),
            has_table_privilege(
              'service_role', 'public.source_evidence_items', 'UPDATE'
            ),
            has_table_privilege(
              'service_role', 'public.source_evidence_items', 'DELETE'
            ),
            has_table_privilege(
              'service_role', 'public.source_evidence_items', 'TRUNCATE'
            ),
            has_function_privilege(
              'service_role',
              'public.claim_next_uploaded_document(text,text,integer)',
              'EXECUTE'
            ),
            has_function_privilege(
              'service_role',
              'public.renew_uploaded_document_lease(text,text,text,uuid,integer)',
              'EXECUTE'
            ),
            has_function_privilege(
              'service_role',
              'public.transition_uploaded_document_lease(text,text,text,uuid,text,jsonb,text)',
              'EXECUTE'
            ),
            has_function_privilege(
              'service_role',
              'public.confirm_uploaded_document(jsonb)',
              'EXECUTE'
            )
          from public.source_evidence_items as text_item
          where text_item.workspace_id = 'workspace_legacy_text'
            and text_item.evidence_id = 'evidence_legacy_text';
        `,
      ], { encoding: "utf8" }).trim();
      assert.equal(
        output,
        "workspace_legacy_text|deal_legacy_text|source_legacy_text|"
          + "revision_legacy_text|unstructured_source_fact|"
          + "Legacy Text Co serves 42 enterprise customers.|false|"
          + "pdf_page|1|Legacy Text Co serves 42 enterprise customers.|"
          + "0|1|legacy_model_derived_image_summary|eligible|"
          + "legacy-text-hash|"
          + "t|f|t|f|f|f|f|"
          + "t|f|t|f|f|f|f|"
          + "t|f|t|f|f|f|f|"
          + "t|f|t|f|f|f|f|"
          + "t|f|f|f|f|"
          + "t|t|t|t",
      );

      const privilegeMatrix = execFileSync("psql", [
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        database,
        "-AtF",
        "|",
        "-c",
        `
          with protected_tables(table_name) as (
            values
              ('source_documents'),
              ('source_evidence'),
              ('source_evidence_items'),
              ('uploaded_documents'),
              ('workspace_documents')
          )
          select
            protected.table_name,
            coalesce((
              select string_agg(grant_row.column_name, ','
                               order by grant_row.column_name)
              from information_schema.role_column_grants as grant_row
              where grant_row.grantee = 'service_role'
                and grant_row.table_schema = 'public'
                and grant_row.table_name = protected.table_name
                and grant_row.privilege_type = 'INSERT'
            ), '-'),
            has_table_privilege(
              'service_role',
              'public.' || protected.table_name,
              'SELECT'
            ),
            has_table_privilege(
              'service_role',
              'public.' || protected.table_name,
              'INSERT'
            ),
            has_table_privilege(
              'service_role',
              'public.' || protected.table_name,
              'UPDATE'
            ),
            has_table_privilege(
              'service_role',
              'public.' || protected.table_name,
              'DELETE'
            ),
            has_table_privilege(
              'service_role',
              'public.' || protected.table_name,
              'TRUNCATE'
            ),
            has_table_privilege(
              'service_role',
              'public.' || protected.table_name,
              'REFERENCES'
            ),
            has_table_privilege(
              'service_role',
              'public.' || protected.table_name,
              'TRIGGER'
            )
          from protected_tables as protected
          order by protected.table_name;
        `,
      ], { encoding: "utf8" }).trim();
      assert.equal(
        privilegeMatrix,
        [
          "source_documents|byte_size,checksum,company_name,deal_id,filename,"
            + "id,object_key,role,title|t|f|f|f|f|f|f",
          "source_evidence|company_name,deal_id,document_id,excerpt,fact,id,"
            + "page,provenance,source_revision_id,workspace_id|t|f|f|f|f|f|f",
          "source_evidence_items|-|t|f|f|f|f|f|f",
          "uploaded_documents|byte_size,checksum,content_type,filename,id,"
            + "object_key,workspace_id|t|f|f|f|f|f|f",
          "workspace_documents|document_id,workspace_id|t|f|f|f|f|f|f",
        ].join("\n"),
      );
    } finally {
      execFileSync("dropdb", ["--if-exists", database], { stdio: "pipe" });
    }
  },
);
