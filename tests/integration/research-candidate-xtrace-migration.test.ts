import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { canonicalEvidenceJson } from "../../lib/contracts/source-evidence";
import { discoverMigrationPlan } from "../helpers/belief-reversal-e2e-harness";
import { exactSourceV2, marketEventV2 } from "../helpers/source-evidence-v2";
import {
  makeDisposableDatabaseName,
  requireLoopbackPostgres,
  type VerifiedLoopbackPostgresContext,
} from "../helpers/require-loopback-postgres";

const migrationName = "0024_research_candidate_xtrace.sql";
const migrationPath = fileURLToPath(new URL(`../../drizzle/${migrationName}`, import.meta.url));
const terminalMigrationPath = fileURLToPath(new URL(
  "../../drizzle/0025_report_deal_universe_authority.sql",
  import.meta.url,
));
const journalPath = fileURLToPath(new URL("../../drizzle/meta/_journal.json", import.meta.url));
const schemaPath = fileURLToPath(new URL("../../db/schema.ts", import.meta.url));
const postgres = requireLoopbackPostgres();

function success(result: ReturnType<VerifiedLoopbackPostgresContext["run"]>, label: string): string {
  assert.equal(result.status, 0, `${label} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function failure(
  result: ReturnType<VerifiedLoopbackPostgresContext["run"]>,
  label: string,
  pattern: RegExp,
): void {
  assert.notEqual(result.status, 0, `${label} unexpectedly succeeded`);
  assert.match(result.stderr, pattern);
}

function fingerprint(index: number): string {
  return `sha256:${index.toString(16).padStart(64, "0")}`;
}

function jsonFingerprint(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalEvidenceJson(value)).digest("hex")}`;
}

function rpc(name: string, payload: unknown): string {
  return `set role service_role; select public.${name}($json$${JSON.stringify(payload)}$json$::jsonb)`;
}

test("terminal 0028 preserves the local-only Deal-bound research registry without parallel XTrace", () => {
  assert.equal(existsSync(migrationPath), true);
  const plan = discoverMigrationPlan({
    directory: fileURLToPath(new URL("../../drizzle/", import.meta.url)),
    journalPath,
  });
  assert.equal(plan.terminal.index, 28);
  assert.equal(plan.terminal.tag, "0028_named_lens_authority_repair");
  const migration = readFileSync(migrationPath, "utf8");
  assert.match(migration, /create table public\.research_candidates/u);
  assert.match(migration, /create table public\.deal_universe_snapshots_v1/u);
  assert.match(migration, /create table public\.deal_universe_snapshot_members_v1/u);
  assert.match(migration, /create table public\.run_deal_universe_bindings_v1/u);
  assert.match(migration, /sample_research_screening_record/u);
  assert.match(migration, /qualified_not_selected/u);
  assert.match(migration, /save_deal_universe_snapshot_v1\(p_payload jsonb\)/u);
  assert.match(migration, /bind_run_deal_universe_v1\(p_payload jsonb\)/u);
  assert.match(migration, /candidate_runs_terminal_reason_check/u);
  assert.match(migration, /before insert or update on public\.scan_runs/u);
  assert.match(migration, /xtrace_ingest_intents_v2_parent_kind_check/u);
  assert.match(migration, /report\.company_count is distinct from binding\.deal_count/u);
  assert.match(migration, /report\.eligible_snapshot_count is distinct from binding\.deal_count/u);
  assert.doesNotMatch(migration, /create table public\.xtrace_research_/u);
  const terminalMigration = readFileSync(terminalMigrationPath, "utf8");
  assert.match(terminalMigration, /resolve_xtrace_memory_v2/u);
  assert.match(terminalMigration, /sample_research_screening_record/u);
  const schema = readFileSync(schemaPath, "utf8");
  assert.match(schema, /export const researchCandidates = pgTable\("research_candidates"/u);
  assert.match(schema, /export const researchCandidateSourceAssignments = pgTable/u);
  assert.match(schema, /export const dealUniverseSnapshotsV1 = pgTable/u);
  assert.match(schema, /sample_research_screening_record/u);
  assert.match(schema, /\$\{table\.rank\} > 0/u);
  const launcher = readFileSync(fileURLToPath(new URL(
    "../../scripts/apply-production-migrations.zsh",
    import.meta.url,
  )), "utf8");
  assert.match(launcher, /0018/u);
  assert.doesNotMatch(launcher, /0024_research_candidate_xtrace/u);
  assert.doesNotMatch(launcher, /0028_named_lens_authority_repair/u);
});

test(
  "0024 binds old 23 and current 30 Deal universes and reuses exact Deal XTrace lineage",
  { skip: postgres.state === "skipped" ? postgres.reason : false },
  () => {
    assert.equal(postgres.state, "verified");
    if (postgres.state !== "verified") return;
    const database = makeDisposableDatabaseName("deal_universe_0024");
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
      const plan = discoverMigrationPlan({
        directory: fileURLToPath(new URL("../../drizzle/", import.meta.url)),
        journalPath,
      });
      for (const migration of plan.files.filter(({ index }) => index < 24)) {
        success(postgres.run("psql", [
          "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
          "-f", migration.path!,
        ]), migration.tag);
      }

      const oldAnchor = "2026-08-01T12:00:00.000Z";
      const currentAnchor = "2026-08-03T13:34:43.000Z";
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", [
          "insert into public.workspaces(id,name) values ('workspace_0024','0024')",
          "insert into public.companies(id,workspace_id,name) select 'company_'||i,'workspace_0024','Company '||i from generate_series(1,30) i",
          `insert into public.deals(id,workspace_id,company_id,company_name,status,analysis_eligible_at,active_source_revision_fingerprint) select 'deal_'||i,'workspace_0024','company_'||i,'Company '||i,case when i>23 then 'screening' else 'watchlist' end,'${currentAnchor}','sha256:'||lpad(to_hex(900+i),64,'0') from generate_series(1,30) i`,
        ].join("; "),
      ]), "30 Deal fixtures");
      const event = marketEventV2(exactSourceV2("source_0024_event", {
        entityKeys: ["company-24"],
        publishedAt: "2026-07-24T15:00:00.000Z",
        retrievedAt: "2026-07-24T16:00:00.000Z",
      }), {
        id: "event_0024_shared",
        entityKeys: ["company-24"],
      });
      const createSnapshot = (input: {
        id: string;
        snapshotAsOfDate: string;
        anchorAt: string;
        windowStartAt: string;
      }) => success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", `set role service_role; select snapshot_fingerprint from public.create_market_evidence_snapshot($snapshot$${JSON.stringify({
          schemaVersion: "market-evidence-snapshot-v1",
          workspaceId: "workspace_0024",
          id: input.id,
          snapshotAsOfDate: input.snapshotAsOfDate,
          windowDays: 14,
          anchorAt: input.anchorAt,
          windowStartAt: input.windowStartAt,
          windowEndAt: input.anchorAt,
          windowTimezone: "America/Los_Angeles",
          events: [event],
        })}$snapshot$::jsonb)`,
      ]), `${input.id} creation`).split("\n").at(-1)!;
      const oldEvidenceFingerprint = createSnapshot({
        id: "belief_reversal_2026_08_01",
        snapshotAsOfDate: "2026-08-01",
        anchorAt: oldAnchor,
        windowStartAt: "2026-07-18T12:00:00.000Z",
      });
      const researchEvidenceFingerprint = createSnapshot({
        id: "belief_reversal_research_2026_08_03_v1",
        snapshotAsOfDate: "2026-08-03",
        anchorAt: currentAnchor,
        windowStartAt: "2026-07-20T13:34:43.000Z",
      });
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", `insert into public.scan_runs(id,workspace_id,mode,status,evidence_context_version,evidence_mode,evidence_anchor_at,evidence_window_start_at,evidence_window_end_at,evidence_window_timezone,evidence_snapshot_id,evidence_snapshot_fingerprint,evidence_context_fingerprint) values ('00000000-0000-4000-8000-000000000023','workspace_0024','structured','completed','run-evidence-context-v1','pinned','${oldAnchor}','2026-07-18T12:00:00Z','${oldAnchor}','America/Los_Angeles','belief_reversal_2026_08_01','${oldEvidenceFingerprint}','${fingerprint(823)}'),('00000000-0000-4000-8000-000000000030','workspace_0024','structured','running','run-evidence-context-v1','live','${currentAnchor}','2026-07-20T13:34:43Z','${currentAnchor}','America/Los_Angeles',null,null,'${fingerprint(830)}')`,
      ]), "run fixtures");
      const researchMigration = plan.files.find(({ index }) => index === 24)!;
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-f", researchMigration.path!,
      ]), researchMigration.tag);
      const terminalMigration = plan.files.find(({ index }) => index === 25)!;
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-f", terminalMigration.path!,
      ]), terminalMigration.tag);
      const rpcArgumentNames = success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", [
          "select string_agg(proname||':'||(proargnames)[1],',' order by proname)",
          "from pg_catalog.pg_proc where pronamespace='public'::regnamespace",
          "and proname in ('bind_run_deal_universe_v1','save_deal_universe_snapshot_v1','save_research_candidate_v1','save_research_candidate_evidence_gap_v1','save_research_candidate_source_assignment_v1')",
        ].join(" "),
      ]), "0024 named RPC arguments");
      assert.equal(rpcArgumentNames, [
        "bind_run_deal_universe_v1:p_payload",
        "save_deal_universe_snapshot_v1:p_payload",
        "save_research_candidate_evidence_gap_v1:p_payload",
        "save_research_candidate_source_assignment_v1:p_payload",
        "save_research_candidate_v1:p_payload",
      ].join(","));
      failure(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", `insert into public.scan_runs(id,workspace_id,mode,status,evidence_context_version,evidence_mode,evidence_anchor_at,evidence_window_start_at,evidence_window_end_at,evidence_window_timezone,evidence_context_fingerprint) values ('00000000-0000-4000-8000-000000000031','workspace_0024','structured','completed','run-evidence-context-v1','live','${currentAnchor}','2026-07-20T13:34:43Z','${currentAnchor}','America/Los_Angeles','${fingerprint(831)}')`,
      ]), "unbound completed current run insert", /requires one universe|Completed current run/iu);

      const emptyPayload = {};
      const emptyPayloadFingerprint = jsonFingerprint(emptyPayload);
      for (let index = 24; index <= 30; index += 1) {
        const request = {
          schemaVersion: "research-candidate-v1",
          workspaceId: "workspace_0024",
          candidateId: `candidate_${index}`,
          companyId: `company_${index}`,
          dealId: `deal_${index}`,
          disposition: "qualified_not_selected",
          snapshotId: "belief_reversal_research_2026_08_03_v1",
          snapshotFingerprint: researchEvidenceFingerprint,
          anchorAt: currentAnchor,
          evidenceMode: "pinned",
          entityKeys: [`company-${index}`],
          activeParentFingerprint: fingerprint(900 + index),
          payload: emptyPayload,
          payloadFingerprint: emptyPayloadFingerprint,
        };
        success(postgres.run("psql", [
          "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
          "-c", rpc("save_research_candidate_v1", request),
        ]), `QNS candidate ${index}`);
      }
      failure(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", rpc("save_research_candidate_v1", {
          schemaVersion: "research-candidate-v1",
          workspaceId: "workspace_0024",
          candidateId: "candidate_passed",
          companyId: "company_24",
          dealId: "deal_24",
          disposition: "passed",
          snapshotId: "belief_reversal_research_2026_08_03_v1",
          snapshotFingerprint: researchEvidenceFingerprint,
          anchorAt: currentAnchor,
          evidenceMode: "pinned",
          entityKeys: ["company-24"],
          activeParentFingerprint: fingerprint(924),
          payload: emptyPayload,
          payloadFingerprint: emptyPayloadFingerprint,
        }),
      ]), "QNS parsed as passed", /qualified_not_selected|disposition/iu);

      const oldMembers = Array.from({ length: 23 }, (_, offset) => ({
        ordinal: offset,
        dealId: `deal_${offset + 1}`,
        companyId: `company_${offset + 1}`,
        dealStatus: "watchlist",
        analysisEligibleAt: currentAnchor,
      }));
      const currentMembers = Array.from({ length: 30 }, (_, offset) => ({
        ordinal: offset,
        dealId: `deal_${offset + 1}`,
        companyId: `company_${offset + 1}`,
        dealStatus: offset + 1 > 23 ? "screening" : "watchlist",
        analysisEligibleAt: currentAnchor,
      }));
      const oldUniverse = {
        schemaVersion: "deal-universe-snapshot-v1",
        workspaceId: "workspace_0024",
        universeId: "belief_reversal_deal_universe_2026_08_01_v1",
        mode: "pinned",
        anchorAt: oldAnchor,
        evidenceSnapshotId: "belief_reversal_2026_08_01",
        evidenceSnapshotFingerprint: oldEvidenceFingerprint,
        members: oldMembers,
      };
      const currentUniverse = {
        schemaVersion: "deal-universe-snapshot-v1",
        workspaceId: "workspace_0024",
        universeId: "belief_reversal_deal_universe_2026_08_03_v1",
        mode: "live",
        anchorAt: currentAnchor,
        evidenceSnapshotId: null,
        evidenceSnapshotFingerprint: null,
        members: currentMembers,
      };
      const oldSaved = JSON.parse(success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", rpc("save_deal_universe_snapshot_v1", oldUniverse),
      ]), "old universe").split("\n").at(-1) ?? "null") as { universeFingerprint: string };
      const currentSaved = JSON.parse(success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", rpc("save_deal_universe_snapshot_v1", currentUniverse),
      ]), "current universe").split("\n").at(-1) ?? "null") as { universeFingerprint: string };
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", rpc("save_deal_universe_snapshot_v1", oldUniverse),
      ]), "old universe replay");
      failure(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", rpc("save_deal_universe_snapshot_v1", {
          ...oldUniverse,
          members: oldMembers.slice(0, 22),
        }),
      ]), "old universe drift", /immutable|collision|fingerprint/iu);

      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", rpc("bind_run_deal_universe_v1", {
          schemaVersion: "run-deal-universe-binding-v1",
          workspaceId: "workspace_0024",
          runId: "00000000-0000-4000-8000-000000000023",
          universeId: oldUniverse.universeId,
          universeFingerprint: oldSaved.universeFingerprint,
        }),
      ]), "old universe binding");
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", rpc("bind_run_deal_universe_v1", {
          schemaVersion: "run-deal-universe-binding-v1",
          workspaceId: "workspace_0024",
          runId: "00000000-0000-4000-8000-000000000030",
          universeId: currentUniverse.universeId,
          universeFingerprint: currentSaved.universeFingerprint,
        }),
      ]), "current universe binding");

      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", "insert into public.companies(id,workspace_id,name) values ('company_without_deal','workspace_0024','No Deal')",
      ]), "orphan company");
      failure(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", rpc("save_deal_universe_snapshot_v1", {
          ...currentUniverse,
          universeId: "invalid_orphan_universe",
          members: [...currentMembers, {
            ordinal: 30,
            dealId: "missing_deal",
            companyId: "company_without_deal",
            dealStatus: "screening",
            analysisEligibleAt: currentAnchor,
          }],
        }),
      ]), "company without Deal", /Deal|member|authoritative/iu);
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", "delete from public.companies where workspace_id='workspace_0024' and id='company_without_deal'",
      ]), "orphan cleanup");

      const counts = success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-AtF", "|", "-d", database,
        "-c", [
          "select (select count(*) from public.companies where workspace_id='workspace_0024')",
          "(select count(*) from public.deals where workspace_id='workspace_0024')",
          "(select count(*) from public.deals where workspace_id='workspace_0024' and analysis_eligible_at is not null)",
          "(select count(*) from public.deal_universe_snapshot_members_v1 where workspace_id='workspace_0024' and universe_id='belief_reversal_deal_universe_2026_08_01_v1')",
          "(select count(*) from public.deal_universe_snapshot_members_v1 where workspace_id='workspace_0024' and universe_id='belief_reversal_deal_universe_2026_08_03_v1')",
          "(select count(*) from public.research_candidates where disposition='qualified_not_selected')",
          "(select count(*) from public.research_candidates candidate join public.deals deal on deal.workspace_id=candidate.workspace_id and deal.id=candidate.deal_id where deal.status='screening' and deal.analysis_eligible_at is not null)",
        ].join(","),
      ]), "authority counts");
      assert.equal(counts, "30|30|30|23|30|7|7");
      const forbiddenColumns = success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", "select count(*) from information_schema.columns where table_schema='public' and table_name='research_candidates' and column_name in ('underwriting_eligible','underwriting_disposition','report_disposition','selected_for_underwriting')",
      ]), "no permanent QNS exclusion");
      assert.equal(forbiddenColumns, "0");

      const researchParents = Array.from({ length: 25 }, (_, offset) => {
        const index = offset + 1;
        const isPublic = index <= 18;
        const dealNumber = isPublic
          ? 24 + ((index - 1) % 7)
          : 24 + (index - 19);
        const sourceId = `source_research_${index}`;
        const revisionId = `revision_research_${index}`;
        const assignmentId = `assignment_research_${index}`;
        const sourceRole = isPublic
          ? "public_web_snapshot"
          : "sample_research_screening_record";
        return {
          index,
          isPublic,
          dealNumber,
          sourceId,
          revisionId,
          assignmentId,
          sourceRole,
          revisionFingerprint: fingerprint(3000 + index),
        };
      });
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", researchParents.flatMap((parent) => [
          `insert into public.source_documents(id,filename,title,role,company_name,deal_id,checksum,byte_size,object_key) values ('${parent.sourceId}','${parent.sourceId}.json','Research parent ${parent.index}','${parent.sourceRole}','Company ${parent.dealNumber}','deal_${parent.dealNumber}','checksum_${parent.index}',1,'private/research-parent-${parent.index}')`,
          `insert into public.workspace_documents(workspace_id,document_id) values ('workspace_0024','${parent.sourceId}')`,
          `insert into public.source_revisions(id,workspace_id,source_id,revision,content_hash,object_key,object_version,content_type,extractor_id,extractor_version,extracted_at,created_at) values ('${parent.revisionId}','workspace_0024','${parent.sourceId}',1,'${parent.revisionFingerprint}','private/research-parent-${parent.index}','1','application/json','fixture','1','${currentAnchor}','${currentAnchor}')`,
          `insert into public.deal_source_assignments(id,request_id,request_fingerprint,workspace_id,deal_id,source_id,source_revision_id,assigned_by_user_id,reason,created_at) values ('${parent.assignmentId}','request_research_${parent.index}','${fingerprint(4000 + parent.index)}','workspace_0024','deal_${parent.dealNumber}','${parent.sourceId}','${parent.revisionId}','fixture','research parent ${parent.index}','${currentAnchor}')`,
        ]).join("; "),
      ]), "25 exact Deal-bound research parents");

      const researchAssignmentRequest = (
        parent: (typeof researchParents)[number],
        overrides: Partial<Record<
          "eventAt" | "eventAtPrecision" | "publishedAt" |
          "publishedAtPrecision" | "retrievedAt" | "evidenceRole",
          string | null
        >> = {},
      ) => {
        const isTrigger = parent.index === 1;
        const isHistorical = parent.index === 2;
        const isEvergreen = parent.index === 3 || !parent.isPublic;
        const eventAt = isTrigger
          ? "2026-07-20T13:34:43.000Z"
          : isHistorical
            ? "2025-01-01T00:00:00.000Z"
            : isEvergreen
              ? null
              : "2026-07-25T12:00:00.000Z";
        const publishedAt = isTrigger
          ? "2026-07-20T13:34:43.000Z"
          : isHistorical
            ? "2025-01-02T00:00:00.000Z"
            : isEvergreen
              ? null
              : "2026-07-25T13:00:00.000Z";
        const payload = parent.isPublic
          ? {
            schemaVersion: "research-public-evidence-memory-v1",
            memoryKind: "public_evidence",
            source: {
              verbatimExcerpt: `Research source ${parent.index} exact excerpt`,
              normalizedStatement: `Research source ${parent.index} normalized statement.`,
            },
          }
          : {
            schemaVersion: "research-disposition-memory-v1",
            memoryKind: "research_disposition",
            recordKind: "research_screening_disposition",
            label: "Sample research screening record",
            provenance: "synthetic_research_record",
            meetingOccurred: false,
            vcInteraction: false,
          };
        return {
          schemaVersion: "research-candidate-source-assignment-v1",
          workspaceId: "workspace_0024",
          candidateId: `candidate_${parent.dealNumber}`,
          dealId: `deal_${parent.dealNumber}`,
          dealAssignmentId: parent.assignmentId,
          parentKind: parent.isPublic ? "public_evidence" : "research_disposition",
          xtraceParentKind: parent.isPublic
            ? "canonical_source_revision"
            : "sample_research_screening_record",
          claimClass: parent.isPublic ? "fact" : "research_disposition",
          sourceId: parent.sourceId,
          sourceRevisionId: parent.revisionId,
          sourceRevisionFingerprint: parent.revisionFingerprint,
          sourceRole: parent.sourceRole,
          sourceClass: parent.isPublic ? "company_official" : "internal_decision_record",
          sourceAuthority: "primary",
          evidenceRole: isTrigger
            ? "trigger"
            : isHistorical
              ? "counterevidence"
              : "context",
          canonicalUrl: parent.isPublic
            ? `https://example.com/research-${parent.index}`
            : null,
          eventAt,
          eventAtPrecision: eventAt === null ? null : "timestamp",
          publishedAt,
          publishedAtPrecision: publishedAt === null ? null : "timestamp",
          retrievedAt: "2026-08-03T12:00:00.000Z",
          retrievedAtPrecision: "timestamp",
          snapshotId: "belief_reversal_research_2026_08_03_v1",
          snapshotFingerprint: researchEvidenceFingerprint,
          anchorAt: currentAnchor,
          entityKeys: [`company-${parent.dealNumber}`],
          activeParentFingerprint: fingerprint(900 + parent.dealNumber),
          payload,
          payloadFingerprint: jsonFingerprint(payload),
          ...overrides,
        };
      };
      const normalizedMasquerade = researchAssignmentRequest(researchParents[3]!);
      normalizedMasquerade.payload = {
        schemaVersion: "research-public-evidence-memory-v1",
        memoryKind: "public_evidence",
        source: {
          verbatimExcerpt: "Identical text is not an exact quote",
          normalizedStatement: "Identical text is not an exact quote",
        },
      };
      normalizedMasquerade.payloadFingerprint = jsonFingerprint(
        normalizedMasquerade.payload,
      );
      failure(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", rpc(
          "save_research_candidate_source_assignment_v1",
          normalizedMasquerade,
        ),
      ]), "normalized statement masquerading as verbatim", /verbatim|normalized|source assignment/iu);
      const unlabeledSample = researchAssignmentRequest(researchParents[18]!);
      unlabeledSample.payload = {
        schemaVersion: "research-disposition-memory-v1",
        memoryKind: "research_disposition",
        recordKind: "research_screening_disposition",
        label: "Internal note",
        provenance: "synthetic_research_record",
        meetingOccurred: false,
        vcInteraction: false,
      };
      unlabeledSample.payloadFingerprint = jsonFingerprint(unlabeledSample.payload);
      failure(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", rpc(
          "save_research_candidate_source_assignment_v1",
          unlabeledSample,
        ),
      ]), "unlabeled synthetic research screening record", /Sample research screening record|label|source assignment/iu);
      failure(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", rpc("save_research_candidate_source_assignment_v1", researchAssignmentRequest(
          researchParents[0]!,
          {
            eventAt: "2026-07-20T13:34:42.999Z",
            publishedAt: "2026-07-20T13:34:42.999Z",
          },
        )),
      ]), "one-millisecond-early research trigger", /14-day window|outside/iu);
      for (const parent of researchParents) {
        success(postgres.run("psql", [
          "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
          "-c", rpc(
            "save_research_candidate_source_assignment_v1",
            researchAssignmentRequest(parent),
          ),
        ]), `research source assignment ${parent.index}`);
      }
      const researchSourceCounts = success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-AtF", "|", "-d", database,
        "-c", [
          "select count(*),",
          "count(*) filter(where parent_kind='public_evidence'),",
          "count(*) filter(where parent_kind='research_disposition'),",
          "count(*) filter(where evidence_role='counterevidence' and event_at like '2025-%'),",
          "count(*) filter(where evidence_role='context' and event_at is null and published_at is null)",
          "from public.research_candidate_source_assignments",
        ].join(" "),
      ]), "research parent authority counts");
      assert.equal(researchSourceCounts, "25|18|7|1|8");

      const completionReaderPrivileges = success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-AtF", "|", "-d", database,
        "-c", "select has_table_privilege('vsee_registry_owner','public.underwriting_batches','select'),has_table_privilege('vsee_registry_owner','public.underwriting_selections','select'),has_table_privilege('vsee_registry_owner','public.candidate_runs','select')",
      ]), "completion validator read privileges");
      assert.equal(completionReaderPrivileges, "t|t|t");

      const sevenOpportunities = Array.from({ length: 7 }, (_, offset) => ({
        dealId: `deal_${offset + 1}`,
      }));
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", [
          `insert into public.intelligence_reports(id,workspace_id,run_id,market_summary,opportunities,analysis_status,company_count,belief_revised_count,monitor_count,no_material_change_count,analysis_unavailable_count,priority_deal_id,evidence_coverage,eligible_snapshot_count,eligible_snapshot_fingerprint) values ('report_current_30','workspace_0024','00000000-0000-4000-8000-000000000030','validator fixture',$opportunities$${JSON.stringify(sevenOpportunities)}$opportunities$::jsonb,'completed',30,7,23,0,0,'deal_1','{}'::jsonb,30,'${fingerprint(5001)}')`,
          "insert into public.company_analyses(id,workspace_id,report_id,run_id,deal_id,company_name,deal_status,outcome,confidence,score,investment_memory,market_evidence,implications,recommended_next_move,company_brief,source_refs) select 'analysis_'||i,'workspace_0024','report_current_30','00000000-0000-4000-8000-000000000030','deal_'||i,'Company '||i,case when i>23 then 'screening' else 'watchlist' end,case when i<=7 then 'belief_revised' else 'monitor' end,'medium',1-(i::double precision/100),'{}'::jsonb,'{}'::jsonb,'{\"positive\":[],\"negative\":[]}'::jsonb,'validator fixture','{}'::jsonb,'[]'::jsonb from generate_series(1,30) i",
          "insert into public.fund_policy_versions(id,workspace_id,version,source,values) values ('policy_0024','workspace_0024',1,'recommended_policy',public.balanced_fund_policy_values())",
          `insert into public.underwriting_batches(id,workspace_id,scan_run_id,status,batch_input_fingerprint,fund_policy_snapshot_id) values ('batch_current_30','workspace_0024','00000000-0000-4000-8000-000000000030','completed','${fingerprint(5002)}','policy_0024')`,
          "insert into public.underwriting_selections(batch_id,workspace_id,deal_id,status,rank,reason) select 'batch_current_30','workspace_0024','deal_'||i,case when i<=7 then 'selected' else 'not_selected' end,case when i<=7 then i else null end,'uncapped validator fixture' from generate_series(1,30) i",
          `insert into public.candidate_runs(id,batch_id,workspace_id,deal_id,status,candidate_analysis_fingerprint,finalized_at) select 'candidate_run_'||i,'batch_current_30','workspace_0024','deal_'||i,'completed','sha256:'||lpad(to_hex(5100+i),64,'0'),'${currentAnchor}' from generate_series(1,6) i`,
        ].join("; "),
      ]), "uncapped completion validator fixture");
      failure(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", "update public.scan_runs set status='completed' where workspace_id='workspace_0024' and id='00000000-0000-4000-8000-000000000030'",
      ]), "missing seventh terminal job", /Every belief-revised Deal|terminal underwriting job/iu);
      for (const terminalStatus of ["partial", "unavailable", "failed"]) {
        failure(postgres.run("psql", [
          "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
          "-c", `insert into public.candidate_runs(id,batch_id,workspace_id,deal_id,status,candidate_analysis_fingerprint,unavailable_reason_codes,finalized_at) values ('candidate_run_7','batch_current_30','workspace_0024','deal_7','${terminalStatus}','${fingerprint(5107)}','[]'::jsonb,'${currentAnchor}')`,
        ]), `${terminalStatus} terminal job without persisted reason`, /terminal_reason|check constraint|persisted reason/iu);
      }
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", [
          `insert into public.candidate_runs(id,batch_id,workspace_id,deal_id,status,candidate_analysis_fingerprint,unavailable_reason_codes,public_failure_reason,finalized_at) values ('candidate_run_7','batch_current_30','workspace_0024','deal_7','partial','${fingerprint(5107)}','[]'::jsonb,'Source coverage remained partial','${currentAnchor}')`,
          "update public.scan_runs set status='completed',completed_at=now() where workspace_id='workspace_0024' and id='00000000-0000-4000-8000-000000000030'",
        ].join("; "),
      ]), "current30 completed with seven uncapped terminal jobs");
      const completionCounts = success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-AtF", "|", "-d", database,
        "-c", [
          "select report.company_count,report.belief_revised_count,report.monitor_count,",
          "(select count(*) from public.company_analyses analysis where analysis.report_id=report.id),",
          "(select count(*) from public.underwriting_selections selection where selection.batch_id='batch_current_30' and selection.status='selected'),",
          "(select max(rank) from public.underwriting_selections selection where selection.batch_id='batch_current_30'),",
          "(select count(*) from public.candidate_runs candidate where candidate.batch_id='batch_current_30')",
          "from public.intelligence_reports report where report.workspace_id='workspace_0024' and report.id='report_current_30'",
        ].join(" "),
      ]), "completed current30 authority counts");
      assert.equal(completionCounts, "30|7|23|30|7|7|7");

      const xtraceParent = researchParents[18]!;
      const intent = {
        intentId: `xtrace_intent_${"d".repeat(64)}`,
        workspaceId: "workspace_0024",
        dealId: "deal_24",
        parentKind: "sample_research_screening_record",
        sourceId: xtraceParent.sourceId,
        sourceRevisionId: xtraceParent.revisionId,
        parentFingerprint: xtraceParent.revisionFingerprint,
        payloadFingerprint: fingerprint(2403),
        serializerVersion: "xtrace-parent-v2",
      };
      const reserved = JSON.parse(success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", rpc("reserve_xtrace_ingest_intent_v2", intent),
      ]), "existing v2 research reserve").split("\n").at(-1) ?? "null") as {
        action: string;
        intent: { intentId: string; leaseToken: string };
      };
      assert.equal(reserved.action, "submit");
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", [
          "set role service_role",
          `select public.attach_xtrace_ingest_job_v2('${reserved.intent.intentId}','${reserved.intent.leaseToken}','research_job')`,
          `select public.advance_xtrace_ingest_intent_v2('${reserved.intent.intentId}','research_job','succeeded',array['research_memory'])`,
        ].join("; "),
      ]), "existing v2 research completion");
      const resolved = success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-AtF", "|", "-d", database,
        "-c", `set role service_role; select source_ids::text,fixture_ids::text,provenance from public.resolve_xtrace_memory_v2('workspace_0024','research_memory','deal_24','${fingerprint(924)}')`,
      ]), "existing v2 research resolve").split("\n").at(-1);
      assert.equal(
        resolved,
        `["${xtraceParent.sourceId}"]|[]|source_document`,
      );
      failure(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", `set role service_role; update public.source_documents set role='reference' where id='${xtraceParent.sourceId}'`,
      ]), "permanent sample research role", /sample research|immutable|RPC-only|permission denied/iu);
      const parallelTables = success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", "select count(*) from information_schema.tables where table_schema='public' and table_name like 'xtrace_research_%'",
      ]), "parallel XTrace absence");
      assert.equal(parallelTables, "0");
    } finally {
      success(postgres.run("dropdb", ["--if-exists", database]), "database cleanup");
    }
  },
);
