import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import {
  canonicalEvidenceJson,
  type WritableMarketEventV2,
} from "../../lib/contracts/source-evidence";
import { discoverMigrationPlan } from "../helpers/belief-reversal-e2e-harness";
import {
  exactSourceV2,
  marketEventV2,
} from "../helpers/source-evidence-v2";
import {
  makeDisposableDatabaseName,
  requireLoopbackPostgres,
  type VerifiedLoopbackPostgresContext,
} from "../helpers/require-loopback-postgres";

const migrationName = "0023_pg17_market_event_validator.sql";
const migrationPath = fileURLToPath(new URL(
  `../../drizzle/${migrationName}`,
  import.meta.url,
));
const journalPath = fileURLToPath(new URL(
  "../../drizzle/meta/_journal.json",
  import.meta.url,
));
const postgres = requireLoopbackPostgres();

function success(
  result: ReturnType<VerifiedLoopbackPostgresContext["run"]>,
  operation: string,
): string {
  assert.equal(result.status, 0, `${operation} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function lengthFramedFingerprint(values: readonly string[]): string {
  const hash = createHash("sha256");
  for (const value of values) {
    const bytes = Buffer.from(value, "utf8");
    hash.update(`${bytes.length}:`);
    hash.update(bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}

function migrationFiles() {
  return discoverMigrationPlan({
    directory: fileURLToPath(new URL("../../drizzle/", import.meta.url)),
    journalPath,
  }).files.filter(({ index }) => index <= 23);
}

function prepareMigrationDatabase(
  context: VerifiedLoopbackPostgresContext,
  database: string,
): void {
  success(context.run("psql", [
    "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
    "-c", "create extension if not exists pgcrypto",
  ]), "pgcrypto creation");
  success(context.run("psql", [
    "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
    "-c", [
      "do $$ begin",
      "if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;",
      "if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;",
      "if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;",
      "end $$",
    ].join(" "),
  ]), "API-role setup");
}

function applyMigrationFiles(
  context: VerifiedLoopbackPostgresContext,
  database: string,
  files: ReturnType<typeof migrationFiles>,
): void {
  for (const migration of files) {
    success(context.run("psql", [
      "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
      "-f", migration.path!,
    ]), `migration ${migration.tag}`);
  }
}

function observePsqlExit(
  child: ReturnType<VerifiedLoopbackPostgresContext["spawn"]>,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function canonicalEvent(): WritableMarketEventV2 {
  const trigger = exactSourceV2("source_pg17_trigger", {
    entityKeys: ["acme"],
    evidenceRole: "trigger",
  });
  const corroborating = exactSourceV2("source_pg17_corroborating", {
    title: "Acme investor announcement",
    canonicalUrl: "https://investor.example/acme-series-b",
    documentId: "document_pg17_corroborating",
    publisher: "Acme Investor",
    providerId: "investor-feed",
    entityKeys: ["acme"],
    sourceClass: "investor_official",
    evidenceRole: "corroborating",
    sourceRevisionId: "revision_pg17_corroborating",
    contentFingerprint: `sha256:${"b".repeat(64)}`,
    text: {
      status: "verified_exact",
      verbatimExcerpt: "We are pleased to support Acme's Series B.",
      normalizedStatement: "The investor confirmed its participation in Acme's Series B.",
    },
  });
  return marketEventV2(trigger, {
    id: "event_pg17_shared_entity",
    entityKeys: ["acme"],
    sources: [corroborating, trigger],
  }) as WritableMarketEventV2;
}

test("0023 is the contiguous local-only PostgreSQL 17 validator correction", () => {
  assert.equal(existsSync(migrationPath), true);
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: Array<{
      idx: number;
      version: string;
      when: number;
      tag: string;
      breakpoints: boolean;
    }>;
  };
  assert.deepEqual(journal.entries.find(({ idx }) => idx === 23), {
    idx: 23,
    version: "7",
    when: 1786010400000,
    tag: "0023_pg17_market_event_validator",
    breakpoints: true,
  });
  const migration = readFileSync(migrationPath, "utf8");
  assert.match(migration, /valid_market_event_v2_0019/u);
  assert.match(migration, /evidence_event_in_window_0019/u);
  assert.match(migration, /create_scan_run_with_evidence_context/u);
  assert.match(migration, /save_reasoner_judgment_immutable/u);
  assert.match(migration, /canonical_ecmascript_jsonb_text_0023/u);
  assert.match(migration, /VSEE_0023_FIRST_APPLY_ONLY/u);
  assert.match(
    migration,
    /lock table public\.reasoner_judgments in share row exclusive mode/u,
  );
  assert.match(migration, /reasoner_judgments_current_record_fingerprint_0023/u);
  assert.match(migration, /companyAnalysisUnknowns/u);
  assert.match(migration, /externalLabel/u);
  assert.match(migration, /VSEE_0023_UNEXPECTED_TASK9_FINALIZER_DEFINITION/u);
  assert.match(
    migration,
    /valid_belief_assessment_shape_0019[\s\S]*array_append\(source_ids/iu,
  );
  assert.match(migration, /vsee\.report_finalizer_0019/u);
  assert.match(migration, /\^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}/u);
  assert.doesNotMatch(
    migration,
    /market_evidence_snapshots[\s\S]{0,240}for share/iu,
  );
  assert.doesNotMatch(
    migration,
    /array_agg\(distinct entity_key order by entity_key collate "C"\)/u,
  );
  const launcher = readFileSync(fileURLToPath(new URL(
    "../../scripts/apply-production-migrations.zsh",
    import.meta.url,
  )), "utf8");
  assert.match(launcher, /through 0019/u);
  assert.doesNotMatch(launcher, /0023_pg17_market_event_validator/u);
});

test(
  "0023 accepts a valid multi-source shared-entity event while malformed evidence remains fail-closed",
  { skip: postgres.state === "skipped" ? postgres.reason : false },
  () => {
    assert.equal(postgres.state, "verified");
    if (postgres.state !== "verified") return;
    const database = makeDisposableDatabaseName("pg17_event_fix");
    success(postgres.run("createdb", [database]), "database creation");
    try {
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", "create extension if not exists pgcrypto",
      ]), "pgcrypto creation");
      const serverVersion = success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", "select current_setting('server_version_num')",
      ]), "PostgreSQL server-version attestation");
      assert.equal(serverVersion, "170006");
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", [
          "do $$ begin",
          "if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;",
          "if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;",
          "if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;",
          "end $$",
        ].join(" "),
      ]), "API-role setup");
      const migrationPlan = discoverMigrationPlan({
        directory: fileURLToPath(new URL("../../drizzle/", import.meta.url)),
        journalPath,
      });
      for (const migration of migrationPlan.files) {
        success(postgres.run("psql", [
          "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
          "-f", migration.path!,
        ]), `migration ${migration.tag}`);
      }
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", "insert into public.workspaces(id,name) values ('workspace_pg17_event','PG17 event validator')",
      ]), "workspace setup");

      const event = canonicalEvent();
      const eventJson = JSON.stringify(event);
      const windowChecks = success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-AtF", "|", "-d", database,
        "-c", `select ${[
          "public.evidence_event_in_window_0019('2026-07-23T15:00:00.000Z','timestamp','2026-07-19T12:00:00.000Z','2026-08-02T12:00:00.000Z','UTC')",
          "public.evidence_event_in_window_0019('2026-07-23','date','2026-07-19T12:00:00.000Z','2026-08-02T12:00:00.000Z','UTC')",
          "not public.evidence_event_in_window_0019('2026-07-18','date','2026-07-19T12:00:00.000Z','2026-08-02T12:00:00.000Z','UTC')",
        ].join(",")}`,
      ]), "publication-window predicates");
      assert.equal(windowChecks, "t|t|t");
      const valid = success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", `select public.valid_market_event_v2_0019($event$${eventJson}$event$::jsonb)`,
      ]), "valid event predicate");
      assert.equal(valid, "t");

      const request = JSON.stringify({
        schemaVersion: "market-evidence-snapshot-v1",
        workspaceId: "workspace_pg17_event",
        id: "snapshot_pg17_event",
        snapshotAsOfDate: "2026-08-02",
        windowDays: 14,
        anchorAt: "2026-08-02T12:00:00.000Z",
        windowStartAt: "2026-07-19T12:00:00.000Z",
        windowEndAt: "2026-08-02T12:00:00.000Z",
        windowTimezone: "UTC",
        events: [event],
      });
      const snapshotId = success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", `select id from public.create_market_evidence_snapshot($request$${request}$request$::jsonb)`,
      ]), "snapshot creation");
      assert.equal(snapshotId, "snapshot_pg17_event");

      const runRequest = JSON.stringify({
        workspaceId: "workspace_pg17_event",
        mode: "structured",
        windowDays: 14,
        evidenceRequest: {
          schemaVersion: "run-evidence-request-v1",
          evidenceMode: "pinned",
          snapshotId: "snapshot_pg17_event",
        },
      });
      const pinnedRun = success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-AtF", "|", "-d", database,
        "-c", [
          "set role service_role;",
          "select evidence_mode,evidence_snapshot_id",
          `from public.create_scan_run_with_evidence_context($request$${runRequest}$request$::jsonb)`,
        ].join(" "),
      ]), "pinned run creation").split("\n").at(-1);
      assert.equal(pinnedRun, "pinned|snapshot_pg17_event");

      const finalizerGuard = success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-AtF", "|", "-d", database,
        "-c", [
          "select bool_and(position('vsee.report_finalizer_0019' in pg_get_functiondef(oid)) > 0),",
          "bool_and(position('vsee.0019_finalizer' in pg_get_functiondef(oid)) = 0)",
          "from pg_proc",
          "where oid in (",
          "'public.protect_report_evidence_0019()'::regprocedure,",
          "'public.protect_analysis_assessment_0019()'::regprocedure,",
          "'public.finalize_new_report_current_fields_0019(text,text,uuid,text,jsonb)'::regprocedure",
          ")",
        ].join(" "),
      ]), "legal finalizer guard configuration");
      assert.equal(finalizerGuard, "t|t");

      const judgmentPayload = [{
        dealId: "deal_pg17",
        scoreInputs: { evidenceQuality: 1, eventRelevance: 0.91 },
        sourceIds: ["source_b", "source_a"],
      }];
      const judgmentFingerprint = `reasoner-judgment-v3:sha256:${"a".repeat(64)}`;
      const judgmentRequest = {
        fingerprint: judgmentFingerprint,
        model: "claude-opus-4-8",
        payload: judgmentPayload,
        evidenceContextFingerprint: null,
        evidenceBindingFingerprint: null,
      };
      const expectedJudgmentRecordFingerprint = lengthFramedFingerprint([
        "reasoner-judgment-record-v1",
        judgmentFingerprint,
        judgmentRequest.model,
        "",
        "",
        canonicalEvidenceJson(judgmentPayload),
      ]);
      const savedJudgmentFingerprint = success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", [
          "set role service_role;",
          "select judgment_record_fingerprint",
          `from public.save_reasoner_judgment_immutable($request$${JSON.stringify(judgmentRequest)}$request$::jsonb)`,
        ].join(" "),
      ]), "canonical reasoner judgment save").split("\n").at(-1);
      assert.equal(
        savedJudgmentFingerprint,
        expectedJudgmentRecordFingerprint,
      );

      const numericCanonicalCases = [
        { suffix: "c", literal: "0.90" },
        { suffix: "d", literal: "1.0" },
        { suffix: "e", literal: "1e-6" },
        { suffix: "f", literal: "1e-7" },
        { suffix: "1", literal: "0.30000000000000004" },
      ] as const;
      for (const numericCase of numericCanonicalCases) {
        const fingerprint = `reasoner-judgment-v3:sha256:${
          numericCase.suffix.repeat(64)
        }`;
        const rawRequest = [
          `{"fingerprint":"${fingerprint}"`,
          `"model":"claude-opus-4-8"`,
          `"payload":[{"score":${numericCase.literal}}]`,
          `"evidenceContextFingerprint":null`,
          `"evidenceBindingFingerprint":null}`,
        ].join(",");
        const parsed = JSON.parse(rawRequest) as {
          model: string;
          payload: unknown;
        };
        const expected = lengthFramedFingerprint([
          "reasoner-judgment-record-v1",
          fingerprint,
          parsed.model,
          "",
          "",
          canonicalEvidenceJson(parsed.payload),
        ]);
        const actual = success(postgres.run("psql", [
          "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
          "-c", [
            "set role service_role;",
            "select judgment_record_fingerprint",
            `from public.save_reasoner_judgment_immutable($request$${rawRequest}$request$::jsonb)`,
          ].join(" "),
        ]), `canonical numeric judgment ${numericCase.literal}`)
          .split("\n").at(-1);
        assert.equal(actual, expected, numericCase.literal);
      }

      const malformed = JSON.stringify({
        ...event,
        contentFingerprint: `sha256:${"0".repeat(64)}`,
      });
      const invalid = success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", `select public.valid_market_event_v2_0019($event$${malformed}$event$::jsonb)`,
      ]), "malformed event predicate");
      assert.equal(invalid, "f");

      const authority = success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-AtF", "|", "-d", database,
        "-c", [
          "select pg_get_userbyid(proowner),",
          "not has_function_privilege('service_role','public.valid_market_event_v2_0019(jsonb)','execute')",
          ",has_function_privilege('service_role','public.create_market_evidence_snapshot(jsonb)','execute')",
          "from pg_proc where oid='public.valid_market_event_v2_0019(jsonb)'::regprocedure",
        ].join(" "),
      ]), "validator authority");
      assert.equal(authority, "vsee_registry_owner|t|t");
    } finally {
      success(
        postgres.run("dropdb", ["--if-exists", database]),
        "database cleanup",
      );
    }
  },
);

test(
  "0023 rejects committed current judgments before catalog mutation and is first-apply-only",
  { skip: postgres.state === "skipped" ? postgres.reason : false },
  () => {
    assert.equal(postgres.state, "verified");
    if (postgres.state !== "verified") return;
    const database = makeDisposableDatabaseName("pg17_reasoner_existing");
    success(postgres.run("createdb", [database]), "database creation");
    try {
      prepareMigrationDatabase(postgres, database);
      const files = migrationFiles();
      applyMigrationFiles(postgres, database, files.slice(0, -1));
      const request = {
        fingerprint: `reasoner-judgment-v3:sha256:${"a".repeat(64)}`,
        model: "claude-opus-4-8",
        payload: [{ score: 0.9 }],
        evidenceContextFingerprint: null,
        evidenceBindingFingerprint: null,
      };
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", [
          "set role service_role;",
          `select fingerprint from public.save_reasoner_judgment_immutable($request$${JSON.stringify(request)}$request$::jsonb)`,
        ].join(" "),
      ]), "pre-existing current judgment");
      const rejected = postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-f", files.at(-1)!.path!,
      ]);
      assert.notEqual(rejected.status, 0);
      assert.match(
        rejected.stderr,
        /VSEE_0023_REQUIRES_EMPTY_CURRENT_REASONER_JUDGMENTS/u,
      );
      const untouched = success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-AtF", "|", "-d",
        database,
        "-c", [
          "select to_regprocedure('public.canonical_ecmascript_json_number_0023(jsonb)') is null,",
          "not exists(select 1 from pg_constraint where conrelid='public.reasoner_judgments'::regclass and conname='reasoner_judgments_current_record_fingerprint_0023')",
        ].join(" "),
      ]), "failed migration rollback");
      assert.equal(untouched, "t|t");
    } finally {
      success(postgres.run("dropdb", ["--if-exists", database]), "database cleanup");
    }

    const replayDatabase = makeDisposableDatabaseName("pg17_first_apply");
    success(postgres.run("createdb", [replayDatabase]), "replay database creation");
    try {
      prepareMigrationDatabase(postgres, replayDatabase);
      const files = migrationFiles();
      applyMigrationFiles(postgres, replayDatabase, files);
      const replay = postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", replayDatabase,
        "-f", files.at(-1)!.path!,
      ]);
      assert.notEqual(replay.status, 0);
      assert.match(replay.stderr, /VSEE_0023_FIRST_APPLY_ONLY/u);
    } finally {
      success(
        postgres.run("dropdb", ["--if-exists", replayDatabase]),
        "replay database cleanup",
      );
    }
  },
);

test(
  "0023 rejects an attested dynamic-function body that has drifted",
  { skip: postgres.state === "skipped" ? postgres.reason : false },
  () => {
    assert.equal(postgres.state, "verified");
    if (postgres.state !== "verified") return;
    const database = makeDisposableDatabaseName("pg17_body_drift");
    success(postgres.run("createdb", [database]), "database creation");
    try {
      prepareMigrationDatabase(postgres, database);
      const files = migrationFiles();
      applyMigrationFiles(postgres, database, files.slice(0, -1));
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", [
          "do $drift$ declare definition text; begin",
          "select pg_get_functiondef('public.valid_belief_assessment_shape_0019(text,text,jsonb,jsonb,jsonb,jsonb,text,text,text,double precision,text)'::regprocedure) into strict definition;",
          "definition := replace(definition,'declare source_ids text[] := array[]::text[];','declare source_ids text[] := array[]::text[] /* drift */;');",
          "execute definition; end; $drift$",
        ].join(" "),
      ]), "belief-validator drift fixture");
      const rejected = postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-f", files.at(-1)!.path!,
      ]);
      assert.notEqual(rejected.status, 0);
      assert.match(
        rejected.stderr,
        /VSEE_0023_UNEXPECTED_BELIEF_VALIDATOR_DEFINITION/u,
      );
      const rolledBack = success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", "select to_regprocedure('public.canonical_ecmascript_json_number_0023(jsonb)') is null",
      ]), "drifted migration rollback");
      assert.equal(rolledBack, "t");
    } finally {
      success(postgres.run("dropdb", ["--if-exists", database]), "database cleanup");
    }
  },
);

test(
  "0023 waits for an in-flight immutable writer and rejects its committed current row",
  { skip: postgres.state === "skipped" ? postgres.reason : false },
  async () => {
    assert.equal(postgres.state, "verified");
    if (postgres.state !== "verified") return;
    const database = makeDisposableDatabaseName("pg17_reasoner_concurrent");
    success(postgres.run("createdb", [database]), "database creation");
    let writer: ReturnType<VerifiedLoopbackPostgresContext["spawn"]> | null =
      null;
    let migration: ReturnType<VerifiedLoopbackPostgresContext["spawn"]> | null =
      null;
    try {
      prepareMigrationDatabase(postgres, database);
      const files = migrationFiles();
      applyMigrationFiles(postgres, database, files.slice(0, -1));
      const request = {
        fingerprint: `reasoner-judgment-v3:sha256:${"b".repeat(64)}`,
        model: "claude-opus-4-8",
        payload: [{ score: 0.9 }],
        evidenceContextFingerprint: null,
        evidenceBindingFingerprint: null,
      };
      writer = postgres.spawn("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
      ]);
      const writerExit = observePsqlExit(writer);
      writer.stdin.write(`${[
        "set application_name='vsee_0023_writer';",
        "begin;",
        "set role service_role;",
        `select fingerprint from public.save_reasoner_judgment_immutable($request$${JSON.stringify(request)}$request$::jsonb);`,
      ].join("\n")}\n`);
      let writerHasRowLock = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const holding = success(postgres.run("psql", [
          "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
          "-c", [
            "select exists(select 1 from pg_stat_activity activity",
            "join pg_locks lock on lock.pid=activity.pid",
            "where activity.application_name='vsee_0023_writer'",
            "and lock.relation='public.reasoner_judgments'::regclass",
            "and lock.mode='RowExclusiveLock' and lock.granted)",
          ].join(" "),
        ]), "writer lock observation");
        if (holding === "t") {
          writerHasRowLock = true;
          break;
        }
        await delay(100);
      }
      assert.equal(writerHasRowLock, true, "writer must hold its insert lock");

      migration = postgres.spawn("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
      ]);
      const migrationExit = observePsqlExit(migration);
      migration.stdin.end([
        "set application_name='vsee_0023_migration';",
        readFileSync(files.at(-1)!.path!, "utf8"),
      ].join("\n"));

      let observedWaitingLock = false;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const waiting = success(postgres.run("psql", [
          "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
          "-c", [
            "select exists(select 1 from pg_stat_activity activity",
            "join pg_locks lock on lock.pid=activity.pid",
            "where activity.application_name='vsee_0023_migration'",
            "and lock.relation='public.reasoner_judgments'::regclass",
            "and lock.mode='ShareRowExclusiveLock' and not lock.granted)",
          ].join(" "),
        ]), "migration lock observation");
        if (waiting === "t") {
          observedWaitingLock = true;
          break;
        }
        await delay(100);
      }
      assert.equal(
        observedWaitingLock,
        true,
        "migration must wait on the current-judgment writer",
      );
      writer.stdin.end("commit;\n\\q\n");
      const writerResult = await writerExit;
      assert.equal(writerResult.code, 0, writerResult.stderr);
      const migrationResult = await migrationExit;
      assert.notEqual(migrationResult.code, 0);
      assert.match(
        migrationResult.stderr,
        /VSEE_0023_REQUIRES_EMPTY_CURRENT_REASONER_JUDGMENTS/u,
      );
      const currentRows = success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", "select count(*) from public.reasoner_judgments where judgment_schema_version='reasoner-judgment-record-v1'",
      ]), "committed writer row");
      assert.equal(currentRows, "1");
    } finally {
      if (writer?.exitCode === null) writer.kill("SIGTERM");
      if (migration?.exitCode === null) migration.kill("SIGTERM");
      success(postgres.run("dropdb", ["--if-exists", database]), "database cleanup");
    }
  },
);

test(
  "0023 applies under the attested non-superuser CREATEROLE executor and restores owner memberships",
  { skip: postgres.state === "skipped" ? postgres.reason : false },
  () => {
    assert.equal(postgres.state, "verified");
    if (postgres.state !== "verified") return;
    const database = makeDisposableDatabaseName("pg17_non_super");
    const executorRole = `vsee_0023_executor_${database.slice(-16)}`;
    assert.match(executorRole, /^[a-z0-9_]+$/u);
    let databaseCreated = false;
    try {
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", "postgres",
        "-c", [
          "do $roles$ begin",
          `if not exists(select 1 from pg_roles where rolname='${executorRole}') then create role ${executorRole} nologin inherit createrole; end if;`,
          "if not exists(select 1 from pg_roles where rolname='vsee_registry_owner') then create role vsee_registry_owner nologin noinherit; end if;",
          "end $roles$;",
        ].join(" "),
      ]), "non-super migration-role bootstrap");
      success(
        postgres.run("createdb", [database]),
        "non-super migration database creation",
      );
      databaseCreated = true;
      prepareMigrationDatabase(postgres, database);
      const serverVersion = success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", "select current_setting('server_version_num')",
      ]), "PostgreSQL server-version attestation");
      assert.equal(serverVersion, "170006");
      const files = migrationFiles();
      applyMigrationFiles(postgres, database, files.slice(0, -1));
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", [
          `grant vsee_registry_owner to ${executorRole} with admin true, inherit false, set false`,
          `alter database ${database} owner to ${executorRole}`,
          `alter function public.assert_task9_current_finalization(jsonb,text,text,text) owner to ${executorRole}`,
          `alter table public.reasoner_judgments owner to ${executorRole}`,
        ].join("; "),
      ]), "non-super 0023 ownership fixture");
      const applied = postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
      ], {
        input: [
          `set role ${executorRole};`,
          readFileSync(files.at(-1)!.path!, "utf8"),
        ].join("\n"),
      });
      assert.equal(
        applied.status,
        0,
        `non-super migration 0023 failed: ${applied.stderr}`,
      );
      const authority = success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-AtF", "|", "-d",
        database,
        "-c", [
          "select pg_get_userbyid((select proowner from pg_proc where oid='public.canonical_ecmascript_json_number_0023(jsonb)'::regprocedure)),",
          `pg_get_userbyid((select proowner from pg_proc where oid='public.assert_task9_current_finalization(jsonb,text,text,text)'::regprocedure)),`,
          "not has_schema_privilege('vsee_registry_owner','public','create'),",
          `(select count(*) from pg_auth_members membership where membership.member='${executorRole}'::regrole and membership.roleid='vsee_registry_owner'::regrole and membership.grantor=10 and membership.admin_option and not membership.inherit_option and not membership.set_option)`,
        ].join(" "),
      ]), "non-super authority restoration");
      assert.equal(
        authority,
        `vsee_registry_owner|${executorRole}|t|1`,
      );
    } finally {
      if (databaseCreated) {
        success(
          postgres.run("dropdb", ["--if-exists", database]),
          "non-super database cleanup",
        );
      }
      const cleanup = postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", "postgres",
        "-c", [
          `revoke vsee_registry_owner from ${executorRole};`,
          `drop role if exists ${executorRole};`,
        ].join(" "),
      ]);
      assert.equal(cleanup.status, 0, cleanup.stderr);
    }
  },
);

test(
  "0023 rejects fabricated company-analysis unknown IDs and labels",
  { skip: postgres.state === "skipped" ? postgres.reason : false },
  () => {
    assert.equal(postgres.state, "verified");
    if (postgres.state !== "verified") return;
    const database = makeDisposableDatabaseName("pg17_task9_unknowns");
    success(postgres.run("createdb", [database]), "database creation");
    try {
      prepareMigrationDatabase(postgres, database);
      applyMigrationFiles(postgres, database, migrationFiles());
      const fieldId = `semantic-field-${"a".repeat(24)}`;
      const internalLabel =
        "Internal channel economics remain unresolved.";
      const externalLabel =
        "Current channel bookings, margins, and sell-through evidence";
      const companyBrief = {
        structuredFields: [{
          id: fieldId,
          schemaVersion: "deal-semantic-field-v1",
          fieldId: "unknowns",
          classification: "unknown",
          reason: internalLabel,
          externalLabel,
        }],
      };
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", [
          "insert into public.workspaces(id,name) values ('workspace_task9_unknown','Task9 unknown')",
          "insert into public.scan_runs(id,workspace_id,mode,status) values ('00000000-0000-4000-8000-000000000023','workspace_task9_unknown','structured','completed')",
          "select public.activate_fund_policy_version(jsonb_build_object('workspaceId','workspace_task9_unknown','actorId',null,'expectedActiveVersionId',null,'action','recommended'))",
          "insert into public.companies(id,workspace_id,name) values ('company_task9_unknown','workspace_task9_unknown','Task9 Unknown Co')",
          "insert into public.deals(id,workspace_id,company_id,company_name,status) values ('deal_task9_unknown','workspace_task9_unknown','company_task9_unknown','Task9 Unknown Co','screening')",
          "insert into public.intelligence_reports(id,workspace_id,run_id,market_summary,analysis_status) values ('report_task9_unknown','workspace_task9_unknown','00000000-0000-4000-8000-000000000023','Task9 unknown report','completed')",
          `insert into public.company_analyses(id,workspace_id,report_id,run_id,deal_id,company_name,deal_status,outcome,confidence,score,investment_memory,market_evidence,implications,recommended_next_move,company_brief,source_refs) values ('analysis_task9_unknown','workspace_task9_unknown','report_task9_unknown','00000000-0000-4000-8000-000000000023','deal_task9_unknown','Task9 Unknown Co','screening','belief_revised','medium',1,'{}'::jsonb,'{}'::jsonb,'{"positive":[],"negative":[]}'::jsonb,'Advance diligence',$brief$${JSON.stringify(companyBrief)}$brief$::jsonb,'[]'::jsonb)`,
          `insert into public.underwriting_batches(id,workspace_id,scan_run_id,status,batch_input_fingerprint,fund_policy_snapshot_id,force_refresh) values ('batch_task9_unknown','workspace_task9_unknown','00000000-0000-4000-8000-000000000023','running','sha256:${"1".repeat(64)}','fund_policy:workspace_task9_unknown:v1',false)`,
          "insert into public.candidate_runs(id,batch_id,workspace_id,deal_id,status,candidate_analysis_fingerprint,worker_id,lease_token,lease_expires_at) values ('candidate_task9_unknown','batch_task9_unknown','workspace_task9_unknown','deal_task9_unknown','running','pending:task9-unknown','worker_task9_unknown','lease_task9_unknown',now()+interval '5 minutes')",
        ].join("; "),
      ]), "Task9 authoritative CompanyAnalysis fixture");

      const actions = [{
        kind: "advance_diligence",
        scope: "deal",
        priority: "standard",
        visibility: "internal_only",
      }];
      const generic = {
        fieldId: "arr",
        label: "arr",
        externalLabel: "arr",
        reasonCode: "MISSING_CRITICAL_EVIDENCE",
        mostLikelyDecisionImpact:
          "Providing accepted evidence may raise or lower the formal decision ceiling.",
      };
      const semantic = {
        fieldId,
        label: internalLabel,
        externalLabel,
        reasonCode: "UNRESOLVED_COMPANY_OR_EVENT_UNKNOWN",
        mostLikelyDecisionImpact:
          "Resolving this company- or event-specific unknown may raise or lower the formal decision ceiling.",
      };
      const formats = [
        ["internal_memo", "internal", "internal"],
        ["founder_email", "email", "founder"],
        ["founder_sms", "sms", "founder"],
        ["founder_linkedin", "linkedin", "founder"],
        ["diligence_request", "email", "founder"],
      ] as const;
      const payload = (unknownSnapshot: {
        fieldId: string;
        label: string;
        externalLabel: string;
      }, draftUnknown: typeof semantic) => ({
        evidencePack: {
          asOfDate: "2026-08-03",
          coverage: { missingFieldIds: ["arr"] },
        },
        context: {
          analysisMode: "core_only",
          contextVersion: "1",
          geography: "unavailable",
          benchmarkPackId: null,
          benchmarkCompatibility: "unavailable",
          asOfDate: "2026-08-03",
          valuationMethodPolicyId: "valuation_task9",
        },
        scenarioModel: { formulaPolicyVersion: "valuation_task9" },
        calculations: [],
        calculationClaimEdges: [],
        judgments: [],
        disagreements: [],
        valuation: {},
        decision: {},
        actionDrafts: formats.map(([format, channel, audienceType]) => ({
          schemaVersion: "action-draft-v2",
          safety: "status_safe",
          deliveryMode: "draft_only",
          draftPolicyVersion: "status-safe-action-draft-v2",
          actionPolicyVersion: "belief-action-policy-v1",
          workspaceId: "workspace_task9_unknown",
          candidateRunId: "candidate_task9_unknown",
          dealStatus: "screening",
          beliefDirection: "positive",
          actions,
          missingEvidence: [generic, draftUnknown],
          format,
          channel,
          audienceType,
          body: "DRAFT ONLY",
        })),
        versionSnapshot: {
          fundPolicyId: "fund_policy:workspace_task9_unknown:v1",
          actionPolicyVersion: "belief-action-policy-v1",
          draftPolicyVersion: "status-safe-action-draft-v2",
          semanticContextAssumptionPolicyVersion:
            "belief-reversal-demo-context-v1",
          semanticContextMappingVersion:
            "belief-reversal-reviewed-context-mapping-v1",
          routerVersion: "context-router-v2",
          dealStatus: "screening",
          beliefDirection: "positive",
          canonicalActions: actions,
          analysisMode: "core_only",
          contextVersion: "1",
          geography: "unavailable",
          benchmarkCompatibility: "unavailable",
          benchmarkPackId: null,
          benchmarkEntryId: null,
          benchmarkDefinitionFingerprint: null,
          companyAnalysisUnknowns: [unknownSnapshot],
        },
      });
      const call = (value: unknown) => postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", `select public.assert_task9_current_finalization($payload$${JSON.stringify(value)}$payload$::jsonb,'workspace_task9_unknown','candidate_task9_unknown','deal_task9_unknown')`,
      ]);
      const fabricatedId = call(payload({
        fieldId: `semantic-field-${"b".repeat(24)}`,
        label: internalLabel,
        externalLabel,
      }, semantic));
      assert.notEqual(fabricatedId.status, 0);
      assert.match(
        fabricatedId.stderr,
        /CompanyAnalysis unknown lineage is invalid/u,
      );

      const fabricatedLabel = call(payload({
        fieldId,
        label: internalLabel,
        externalLabel,
      }, { ...semantic, label: "Forged internal label" }));
      assert.notEqual(fabricatedLabel.status, 0);
      assert.match(
        fabricatedLabel.stderr,
        /status-safe draft identity is invalid/u,
      );
    } finally {
      success(postgres.run("dropdb", ["--if-exists", database]), "database cleanup");
    }
  },
);
