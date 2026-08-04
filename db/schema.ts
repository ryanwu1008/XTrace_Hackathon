import {
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import type {
  CompanyBrief,
  CompanyMarketEvidence,
  ClaimSupportV2,
  EvidenceSourceRef,
  EvidenceCoverage,
  InvestmentMemorySnapshot,
  OpportunityReportItem,
  CompanyAnalysis,
} from "../lib/contracts/domain";
import type {
  EvidenceRoleV2,
  SourceAuthorityV2,
  SourceClassV2,
  TemporalPrecisionV2,
  WritableMarketEventV2,
} from "../lib/contracts/source-evidence";
import type {
  Calculation,
  ClaimEdge,
  EvidencePack,
} from "../lib/contracts/evidence";

import type {
  ActionDraft,
  CandidateProviderAttempt,
  DecisionResult,
  FrameworkDisagreement,
  FrameworkJudgment,
  ResolvedUnderwritingContext,
  ScenarioModel,
  ValuationEvaluation,
} from "../lib/contracts/underwriting";
import type {
  CandidateVersionSnapshot,
} from "./repositories/underwriting-artifacts";
import type { ExtractionPreview } from "./repositories/uploaded-documents";
import type {
  FundPolicyValues,
} from "../seed/underwriting/balanced-policy-v1";

type PersistedCompanyMarketEvidence = CompanyMarketEvidence & {
  claimSupport?: ClaimSupportV2[];
};

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const workspaceTestGenerations = pgTable("workspace_test_generations", {
  workspaceId: text("workspace_id").primaryKey().references(
    () => workspaces.id,
    { onDelete: "cascade" },
  ),
  resetAt: timestamp("reset_at", { withTimezone: true }).defaultNow().notNull(),
  updatedBy: text("updated_by").notNull(),
}, (table) => [
  check(
    "workspace_test_generations_updated_by_check",
    sql`btrim(${table.updatedBy}) <> ''`,
  ),
]);

export const scanRuns = pgTable("scan_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: text("workspace_id").notNull().references(
    () => workspaces.id,
  ),
  mode: text("mode").notNull(),
  windowDays: integer("window_days").notNull().default(14),
  status: text("status").notNull().default("queued"),
  currentStage: text("current_stage"),
  warningCount: integer("warning_count").notNull().default(0),
  warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
  workerId: text("worker_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  evidenceContextVersion: text("evidence_context_version"),
  evidenceMode: text("evidence_mode"),
  evidenceAnchorAt: timestamp("evidence_anchor_at", { withTimezone: true }),
  evidenceWindowStartAt: timestamp("evidence_window_start_at", { withTimezone: true }),
  evidenceWindowEndAt: timestamp("evidence_window_end_at", { withTimezone: true }),
  evidenceWindowTimezone: text("evidence_window_timezone"),
  evidenceSnapshotId: text("evidence_snapshot_id"),
  evidenceSnapshotFingerprint: text("evidence_snapshot_fingerprint"),
  evidenceContextFingerprint: text("evidence_context_fingerprint"),
}, (table) => [
  unique("scan_runs_workspace_id_id_unique").on(table.workspaceId, table.id),
]);

export const scanRunSteps = pgTable("scan_run_steps", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  runId: uuid("run_id").notNull(),
  stage: text("stage").notNull(),
  status: text("status").notNull(),
  warning: text("warning"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  foreignKey({
    columns: [table.workspaceId, table.runId],
    foreignColumns: [scanRuns.workspaceId, scanRuns.id],
    name: "scan_run_steps_workspace_run_fkey",
  }).onDelete("cascade"),
]);

export const workerHeartbeats = pgTable("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
});

export const publicRequestLimits = pgTable("public_request_limits", {
  scope: text("scope").notNull(),
  clientHash: text("client_hash").notNull(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  requestCount: integer("request_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.scope, table.clientHash] }),
]);

export const sourceDocuments = pgTable("source_documents", {
  id: text("id").primaryKey(),
  filename: text("filename").notNull(),
  title: text("title").notNull(),
  role: text("role").notNull(),
  companyName: text("company_name"),
  dealId: text("deal_id"),
  checksum: text("checksum").notNull(),
  byteSize: integer("byte_size").notNull(),
  objectKey: text("object_key").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("source_documents_checksum_idx").on(table.checksum),
  check(
    "source_documents_role_check",
    sql`${table.role} in ('deal_document', 'market_report', 'reference', 'public_web_snapshot', 'sample_decision_record', 'sample_research_screening_record')`,
  ),
]);

export const workspaceDocuments = pgTable("workspace_documents", {
  workspaceId: text("workspace_id").notNull().references(
    () => workspaces.id,
    { onDelete: "cascade" },
  ),
  documentId: text("document_id").notNull().references(
    () => sourceDocuments.id,
    { onDelete: "cascade" },
  ),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.documentId] }),
]);

export const companies = pgTable("companies", {
  id: text("id").notNull(),
  workspaceId: text("workspace_id").notNull().references(
    () => workspaces.id,
    { onDelete: "cascade" },
  ),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.id] }),
]);

export const deals = pgTable("deals", {
  id: text("id").notNull(),
  workspaceId: text("workspace_id").notNull().references(
    () => workspaces.id,
    { onDelete: "cascade" },
  ),
  companyId: text("company_id").notNull(),
  companyName: text("company_name").notNull(),
  status: text("status").notNull().default("screening"),
  analysisEligibleAt: timestamp("analysis_eligible_at", {
    withTimezone: true,
  }),
  activeSourceRevisionFingerprint: text(
    "active_source_revision_fingerprint",
  ),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.id] }),
  foreignKey({
    columns: [table.workspaceId, table.companyId],
    foreignColumns: [companies.workspaceId, companies.id],
    name: "deals_workspace_company_fkey",
  }).onDelete("cascade"),
  check(
    "deals_status_check",
    sql`${table.status} in ('screening', 'watchlist', 'evaluating', 'passed', 'invested')`,
  ),
]);

export const sourceRevisions = pgTable("source_revisions", {
  id: text("id").notNull(),
  workspaceId: text("workspace_id").notNull().references(
    () => workspaces.id,
    { onDelete: "cascade" },
  ),
  sourceId: text("source_id").notNull(),
  revision: integer("revision").notNull(),
  contentHash: text("content_hash").notNull(),
  objectKey: text("object_key").notNull(),
  objectVersion: text("object_version").notNull(),
  contentType: text("content_type").notNull(),
  extractorId: text("extractor_id").notNull(),
  extractorVersion: text("extractor_version").notNull(),
  extractedAt: timestamp("extracted_at", { withTimezone: true }).notNull(),
  supersedesRevisionId: text("supersedes_revision_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.id] }),
  unique("source_revisions_workspace_source_revision_unique").on(
    table.workspaceId,
    table.sourceId,
    table.revision,
  ),
  unique("source_revisions_workspace_source_id_unique").on(
    table.workspaceId,
    table.sourceId,
    table.id,
  ),
  foreignKey({
    columns: [
      table.workspaceId,
      table.sourceId,
      table.supersedesRevisionId,
    ],
    foreignColumns: [
      table.workspaceId,
      table.sourceId,
      table.id,
    ],
    name: "source_revisions_exact_supersedes_fkey",
  }),
  index("source_revisions_workspace_source_created").on(
    table.workspaceId,
    table.sourceId,
    table.revision,
  ),
  check("source_revisions_revision_check", sql`${table.revision} > 0`),
  check(
    "source_revisions_initial_link_check",
    sql`(${table.revision} = 1 and ${table.supersedesRevisionId} is null) or (${table.revision} > 1 and ${table.supersedesRevisionId} is not null)`,
  ),
  check("source_revisions_content_hash_check", sql`btrim(${table.contentHash}) <> ''`),
  check("source_revisions_object_key_check", sql`btrim(${table.objectKey}) <> ''`),
  check("source_revisions_object_version_check", sql`btrim(${table.objectVersion}) <> ''`),
  check("source_revisions_content_type_check", sql`btrim(${table.contentType}) <> ''`),
  check("source_revisions_extractor_id_check", sql`btrim(${table.extractorId}) <> ''`),
  check("source_revisions_extractor_version_check", sql`btrim(${table.extractorVersion}) <> ''`),
]);

export const sourceEvidenceItems = pgTable("source_evidence_items", {
  workspaceId: text("workspace_id").notNull(),
  evidenceId: text("evidence_id").notNull(),
  dealId: text("deal_id").notNull(),
  sourceId: text("source_id").notNull(),
  sourceRevisionId: text("source_revision_id").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
    .notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.evidenceId] }),
  foreignKey({
    columns: [table.workspaceId, table.dealId],
    foreignColumns: [deals.workspaceId, deals.id],
    name: "source_evidence_items_workspace_deal_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.workspaceId, table.sourceRevisionId],
    foreignColumns: [sourceRevisions.workspaceId, sourceRevisions.id],
    name: "source_evidence_items_workspace_revision_fkey",
  }),
  foreignKey({
    columns: [
      table.workspaceId,
      table.sourceId,
      table.sourceRevisionId,
    ],
    foreignColumns: [
      sourceRevisions.workspaceId,
      sourceRevisions.sourceId,
      sourceRevisions.id,
    ],
    name: "source_evidence_items_exact_revision_fkey",
  }),
  index("source_evidence_items_grounding_idx").on(
    table.workspaceId,
    table.dealId,
    table.sourceRevisionId,
    table.evidenceId,
  ),
  check(
    "source_evidence_items_payload_shape_check",
    sql`jsonb_typeof(${table.payload}) = 'object'`,
  ),
  check(
    "source_evidence_items_payload_identity_check",
    sql`coalesce(${table.payload} ->> 'id' = ${table.evidenceId} and ${table.payload} ->> 'workspaceId' = ${table.workspaceId} and ${table.payload} ->> 'dealId' = ${table.dealId} and ${table.payload} ->> 'sourceId' = ${table.sourceId} and ${table.payload} ->> 'sourceRevisionId' = ${table.sourceRevisionId}, false)`,
  ),
]);

export const evidencePackBuilds = pgTable("evidence_pack_builds", {
  workspaceId: text("workspace_id").notNull(),
  inputFingerprint: text("input_fingerprint").notNull(),
  packId: text("pack_id").notNull(),
  packPayload: jsonb("pack_payload").$type<EvidencePack>().notNull(),
  sourceRevisionSnapshots: jsonb("source_revision_snapshots")
    .$type<Array<Record<string, unknown>>>()
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
    .notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.inputFingerprint] }),
  unique("evidence_pack_builds_workspace_pack_unique").on(
    table.workspaceId,
    table.packId,
  ),
  check(
    "evidence_pack_builds_input_fingerprint_check",
    sql`${table.inputFingerprint} ~ '^sha256:[0-9a-f]{64}$'`,
  ),
  check(
    "evidence_pack_builds_payload_shape_check",
    sql`jsonb_typeof(${table.packPayload}) = 'object'`,
  ),
  check(
    "evidence_pack_builds_snapshots_shape_check",
    sql`jsonb_typeof(${table.sourceRevisionSnapshots}) = 'array'`,
  ),
  check(
    "evidence_pack_builds_payload_identity_check",
    sql`coalesce(${table.packPayload} ->> 'workspaceId' = ${table.workspaceId} and ${table.packPayload} ->> 'id' = ${table.packId} and btrim(coalesce(${table.packPayload} ->> 'dealId', '')) <> '', false)`,
  ),
]);

export const sourceRevisionAnnotations = pgTable(
  "source_revision_annotations",
  {
    id: uuid("id").defaultRandom().notNull(),
    workspaceId: text("workspace_id").notNull().references(
      () => workspaces.id,
      { onDelete: "cascade" },
    ),
    revisionId: text("revision_id").notNull(),
    kind: text("kind").notNull(),
    reason: text("reason").notNull(),
    supersededByRunId: uuid("superseded_by_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    foreignKey({
      columns: [table.workspaceId, table.revisionId],
      foreignColumns: [sourceRevisions.workspaceId, sourceRevisions.id],
      name: "source_revision_annotations_workspace_revision_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.supersededByRunId],
      foreignColumns: [scanRuns.workspaceId, scanRuns.id],
      name: "source_revision_annotations_workspace_run_fkey",
    }),
    check(
      "source_revision_annotations_kind_check",
      sql`${table.kind} in ('retracted', 'identity_corrected', 'superseded')`,
    ),
    check(
      "source_revision_annotations_reason_check",
      sql`btrim(${table.reason}) <> ''`,
    ),
  ],
);

export const dealSourceAssignments = pgTable("deal_source_assignments", {
  id: text("id").notNull(),
  requestId: text("request_id").notNull(),
  requestFingerprint: text("request_fingerprint").notNull(),
  workspaceId: text("workspace_id").notNull().references(
    () => workspaces.id,
    { onDelete: "cascade" },
  ),
  dealId: text("deal_id").notNull(),
  sourceId: text("source_id").notNull(),
  sourceRevisionId: text("source_revision_id").notNull(),
  assignedByUserId: text("assigned_by_user_id").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
    .notNull(),
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.id] }),
  unique("deal_source_assignments_workspace_request_unique").on(
    table.workspaceId,
    table.requestId,
  ),
  foreignKey({
    columns: [table.workspaceId, table.dealId],
    foreignColumns: [deals.workspaceId, deals.id],
    name: "deal_source_assignments_workspace_deal_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [
      table.workspaceId,
      table.sourceId,
      table.sourceRevisionId,
    ],
    foreignColumns: [
      sourceRevisions.workspaceId,
      sourceRevisions.sourceId,
      sourceRevisions.id,
    ],
    name: "deal_source_assignments_exact_revision_fkey",
  }),
  uniqueIndex("deal_source_assignments_one_active_source")
    .on(table.workspaceId, table.dealId, table.sourceId)
    .where(sql`${table.supersededAt} is null`),
  check(
    "deal_source_assignments_request_id_check",
    sql`btrim(${table.requestId}) <> ''`,
  ),
  check(
    "deal_source_assignments_request_fingerprint_check",
    sql`${table.requestFingerprint} ~ '^sha256:[0-9a-f]{64}$'`,
  ),
  check(
    "deal_source_assignments_assigned_by_user_id_check",
    sql`btrim(${table.assignedByUserId}) <> ''`,
  ),
  check(
    "deal_source_assignments_reason_check",
    sql`btrim(${table.reason}) <> ''`,
  ),
  check(
    "deal_source_assignments_supersession_time_check",
    sql`${table.supersededAt} is null or ${table.supersededAt} >= ${table.createdAt}`,
  ),
]);

export const sourceEvidence = pgTable("source_evidence", {
  id: text("id").notNull(),
  workspaceId: text("workspace_id").notNull().references(
    () => workspaces.id,
    { onDelete: "cascade" },
  ),
  documentId: text("document_id").notNull().references(
    () => sourceDocuments.id,
    { onDelete: "cascade" },
  ),
  sourceRevisionId: text("source_revision_id"),
  dealId: text("deal_id").notNull(),
  companyName: text("company_name").notNull(),
  provenance: text("provenance").notNull(),
  page: integer("page").notNull(),
  fact: text("fact").notNull(),
  excerpt: text("excerpt").notNull(),
  analysisQuarantineReason: text("analysis_quarantine_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.id] }),
  foreignKey({
    columns: [table.workspaceId, table.dealId],
    foreignColumns: [deals.workspaceId, deals.id],
    name: "source_evidence_workspace_deal_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.workspaceId, table.documentId, table.sourceRevisionId],
    foreignColumns: [
      sourceRevisions.workspaceId,
      sourceRevisions.sourceId,
      sourceRevisions.id,
    ],
    name: "source_evidence_exact_revision_fkey",
  }),
]);

export const dealInteractions = pgTable("deal_interactions", {
  id: text("id").notNull(),
  workspaceId: text("workspace_id").notNull().references(
    () => workspaces.id,
    { onDelete: "cascade" },
  ),
  documentId: text("document_id").notNull().references(
    () => sourceDocuments.id,
    { onDelete: "cascade" },
  ),
  sourceRevisionId: text("source_revision_id"),
  dealId: text("deal_id").notNull(),
  companyName: text("company_name").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  provenance: text("provenance").notNull(),
  label: text("label").notNull(),
  status: text("status").notNull(),
  decisionReason: text("decision_reason").notNull(),
  concerns: jsonb("concerns").$type<string[]>().notNull().default([]),
  revisitConditions: jsonb("revisit_conditions").$type<string[]>().notNull().default([]),
  meetingSummary: text("meeting_summary").notNull(),
  priorActions: jsonb("prior_actions").$type<string[]>(),
  actionPolicyVersion: text("action_policy_version"),
  interactionSchemaVersion: text("interaction_schema_version"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.id] }),
  foreignKey({
    columns: [table.workspaceId, table.dealId],
    foreignColumns: [deals.workspaceId, deals.id],
    name: "deal_interactions_workspace_deal_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.workspaceId, table.documentId, table.sourceRevisionId],
    foreignColumns: [
      sourceRevisions.workspaceId,
      sourceRevisions.sourceId,
      sourceRevisions.id,
    ],
    name: "deal_interactions_exact_revision_fkey",
  }),
]);

export const marketEvents = pgTable("market_events", {
  workspaceId: text("workspace_id").notNull().references(
    () => workspaces.id,
    { onDelete: "cascade" },
  ),
  id: text("id").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).defaultNow().notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.id] }),
]);

export const marketEvidenceSnapshots = pgTable("market_evidence_snapshots", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  id: text("id").notNull(),
  schemaVersion: text("schema_version").notNull(),
  snapshotAsOfDate: date("snapshot_as_of_date").notNull(),
  windowDays: integer("window_days").notNull(),
  anchorAt: timestamp("anchor_at", { withTimezone: true }).notNull(),
  windowStartAt: timestamp("window_start_at", { withTimezone: true }).notNull(),
  windowEndAt: timestamp("window_end_at", { withTimezone: true }).notNull(),
  windowTimezone: text("window_timezone").notNull(),
  displayLabel: text("display_label").notNull(),
  eventCount: integer("event_count").notNull(),
  snapshotFingerprint: text("snapshot_fingerprint").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.id] }),
  unique("market_evidence_snapshots_identity_fingerprint_unique").on(
    table.workspaceId,
    table.id,
    table.snapshotFingerprint,
  ),
]);

export const marketEvidenceSnapshotEvents = pgTable("market_evidence_snapshot_events", {
  workspaceId: text("workspace_id").notNull(),
  snapshotId: text("snapshot_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  eventId: text("event_id").notNull(),
  eventContentFingerprint: text("event_content_fingerprint").notNull(),
  publishedValue: text("published_value").notNull(),
  publishedPrecision: text("published_precision").notNull(),
  payload: jsonb("payload").$type<WritableMarketEventV2>().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.snapshotId, table.ordinal] }),
  unique("market_evidence_snapshot_events_event_unique").on(
    table.workspaceId,
    table.snapshotId,
    table.eventId,
  ),
  foreignKey({
    columns: [table.workspaceId, table.snapshotId],
    foreignColumns: [marketEvidenceSnapshots.workspaceId, marketEvidenceSnapshots.id],
    name: "market_evidence_snapshot_events_parent_fkey",
  }),
]);

export const runEvidenceBindings = pgTable("run_evidence_bindings", {
  workspaceId: text("workspace_id").notNull(),
  runId: uuid("run_id").notNull(),
  schemaVersion: text("schema_version").notNull(),
  evidenceContextVersion: text("evidence_context_version").notNull(),
  evidenceMode: text("evidence_mode").notNull(),
  windowDays: integer("window_days").notNull(),
  anchorAt: timestamp("anchor_at", { withTimezone: true }).notNull(),
  windowStartAt: timestamp("window_start_at", { withTimezone: true }).notNull(),
  windowEndAt: timestamp("window_end_at", { withTimezone: true }).notNull(),
  windowTimezone: text("window_timezone").notNull(),
  snapshotId: text("snapshot_id"),
  snapshotFingerprint: text("snapshot_fingerprint"),
  evidenceContextFingerprint: text("evidence_context_fingerprint").notNull(),
  displayLabel: text("display_label").notNull(),
  eventCount: integer("event_count").notNull(),
  eventSetFingerprint: text("event_set_fingerprint").notNull(),
  bindingFingerprint: text("binding_fingerprint").notNull(),
  boundAt: timestamp("bound_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.runId] }),
  unique("run_evidence_bindings_fingerprint_unique").on(
    table.workspaceId,
    table.bindingFingerprint,
  ),
  unique("run_evidence_bindings_run_fingerprint_unique").on(
    table.workspaceId,
    table.runId,
    table.bindingFingerprint,
  ),
]);

export const runMarketEvents = pgTable("run_market_events", {
  workspaceId: text("workspace_id").notNull(),
  runId: uuid("run_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  eventId: text("event_id").notNull(),
  eventContentFingerprint: text("event_content_fingerprint").notNull(),
  publishedValue: text("published_value").notNull(),
  publishedPrecision: text("published_precision").notNull(),
  payload: jsonb("payload").$type<WritableMarketEventV2>().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.runId, table.ordinal] }),
  unique("run_market_events_event_unique").on(table.workspaceId, table.runId, table.eventId),
  foreignKey({
    columns: [table.workspaceId, table.runId],
    foreignColumns: [runEvidenceBindings.workspaceId, runEvidenceBindings.runId],
    name: "run_market_events_binding_fkey",
  }),
]);

export const intelligenceReports = pgTable("intelligence_reports", {
  id: text("id").notNull(),
  workspaceId: text("workspace_id").notNull().references(
    () => workspaces.id,
    { onDelete: "cascade" },
  ),
  runId: uuid("run_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  marketSummary: text("market_summary").notNull(),
  opportunities: jsonb("opportunities")
    .$type<OpportunityReportItem[]>()
    .notNull()
    .default([]),
  analysisStatus: text("analysis_status").notNull().default("completed"),
  companyCount: integer("company_count").notNull().default(0),
  beliefRevisedCount: integer("belief_revised_count").notNull().default(0),
  monitorCount: integer("monitor_count").notNull().default(0),
  noMaterialChangeCount: integer("no_material_change_count").notNull().default(0),
  analysisUnavailableCount: integer("analysis_unavailable_count")
    .notNull()
    .default(0),
  priorityDealId: text("priority_deal_id"),
  evidenceCoverage: jsonb("evidence_coverage")
    .$type<EvidenceCoverage>()
    .notNull()
    .default({
      acceptedPublicEvents: 0,
      excludedPublicItems: 0,
      truncatedPublicEvents: 0,
      recalledDealCount: 0,
      unavailableDealCount: 0,
    }),
  eligibleSnapshotCount: integer("eligible_snapshot_count"),
  eligibleSnapshotFingerprint: text("eligible_snapshot_fingerprint"),
  evidenceContextVersion: text("evidence_context_version"),
  evidenceMode: text("evidence_mode"),
  evidenceWindowDays: integer("evidence_window_days"),
  evidenceAnchorAt: timestamp("evidence_anchor_at", { withTimezone: true }),
  evidenceWindowStartAt: timestamp("evidence_window_start_at", { withTimezone: true }),
  evidenceWindowEndAt: timestamp("evidence_window_end_at", { withTimezone: true }),
  evidenceWindowTimezone: text("evidence_window_timezone"),
  evidenceSnapshotId: text("evidence_snapshot_id"),
  evidenceSnapshotFingerprint: text("evidence_snapshot_fingerprint"),
  evidenceContextFingerprint: text("evidence_context_fingerprint"),
  evidenceDisplayLabel: text("evidence_display_label"),
  evidenceEventCount: integer("evidence_event_count"),
  evidenceEventSetFingerprint: text("evidence_event_set_fingerprint"),
  evidenceBindingFingerprint: text("evidence_binding_fingerprint"),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.id] }),
  unique("intelligence_reports_one_per_run").on(
    table.workspaceId,
    table.runId,
  ),
  foreignKey({
    columns: [table.workspaceId, table.runId],
    foreignColumns: [scanRuns.workspaceId, scanRuns.id],
    name: "intelligence_reports_workspace_run_fkey",
  }).onDelete("cascade"),
  check(
    "intelligence_reports_eligible_snapshot_check",
    sql`(${table.eligibleSnapshotCount} is null and ${table.eligibleSnapshotFingerprint} is null) or (${table.eligibleSnapshotCount} >= 0 and btrim(${table.eligibleSnapshotFingerprint}) <> '')`,
  ),
]);

export const companyAnalyses = pgTable("company_analyses", {
  id: text("id").notNull(),
  workspaceId: text("workspace_id").notNull().references(
    () => workspaces.id,
    { onDelete: "cascade" },
  ),
  reportId: text("report_id").notNull(),
  runId: uuid("run_id").notNull(),
  dealId: text("deal_id").notNull(),
  companyName: text("company_name").notNull(),
  dealStatus: text("deal_status").notNull(),
  outcome: text("outcome").notNull(),
  confidence: text("confidence").notNull(),
  score: doublePrecision("score").notNull(),
  investmentMemory: jsonb("investment_memory")
    .$type<InvestmentMemorySnapshot>()
    .notNull(),
  marketEvidence: jsonb("market_evidence")
    .$type<PersistedCompanyMarketEvidence>()
    .notNull(),
  implications: jsonb("implications")
    .$type<{ positive: string[]; negative: string[] }>()
    .notNull(),
  recommendedNextMove: text("recommended_next_move").notNull(),
  companyBrief: jsonb("company_brief").$type<CompanyBrief>().notNull(),
  sourceRefs: jsonb("source_refs").$type<EvidenceSourceRef[]>().notNull(),
  beliefAssessmentVersion: text("belief_assessment_version"),
  beliefDirection: text("belief_direction"),
  beliefScoreBreakdown: jsonb("belief_score_breakdown")
    .$type<NonNullable<CompanyAnalysis["beliefAssessment"]>["scoreBreakdown"]>(),
  beliefGateContext: jsonb("belief_gate_context")
    .$type<NonNullable<CompanyAnalysis["beliefAssessment"]>["gateContext"]>(),
  beliefGateResults: jsonb("belief_gate_results")
    .$type<NonNullable<CompanyAnalysis["beliefAssessment"]>["gates"]>(),
  beliefActions: jsonb("belief_actions")
    .$type<NonNullable<CompanyAnalysis["beliefAssessment"]>["actions"]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.id] }),
  unique("company_analyses_workspace_report_deal_unique").on(
    table.workspaceId,
    table.reportId,
    table.dealId,
  ),
  foreignKey({
    columns: [table.workspaceId, table.reportId],
    foreignColumns: [intelligenceReports.workspaceId, intelligenceReports.id],
    name: "company_analyses_workspace_report_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.workspaceId, table.runId],
    foreignColumns: [scanRuns.workspaceId, scanRuns.id],
    name: "company_analyses_workspace_run_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.workspaceId, table.dealId],
    foreignColumns: [deals.workspaceId, deals.id],
    name: "company_analyses_workspace_deal_fkey",
  }).onDelete("cascade"),
]);

export const reasonerJudgments = pgTable("reasoner_judgments", {
  fingerprint: text("fingerprint").primaryKey(),
  model: text("model").notNull(),
  payload: jsonb("payload").notNull(),
  judgmentSchemaVersion: text("judgment_schema_version"),
  judgmentRecordFingerprint: text("judgment_record_fingerprint"),
  evidenceContextFingerprint: text("evidence_context_fingerprint"),
  evidenceBindingFingerprint: text("evidence_binding_fingerprint"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const xtraceIngestJobs = pgTable("xtrace_ingest_jobs", {
  jobId: text("job_id").notNull(),
  workspaceId: text("workspace_id").notNull().references(
    () => workspaces.id,
    { onDelete: "cascade" },
  ),
  dealId: text("deal_id").notNull(),
  sourceRevisionIds: jsonb("source_revision_ids").$type<string[]>().notNull()
    .default([]),
  sourceIds: jsonb("source_ids").$type<string[]>().notNull().default([]),
  fixtureIds: jsonb("fixture_ids").$type<string[]>().notNull().default([]),
  bundleFingerprint: text("bundle_fingerprint").notNull(),
  serializerVersion: text("serializer_version").notNull(),
  provenance: text("provenance").notNull(),
  status: text("status").notNull(),
  memoryIds: jsonb("memory_ids").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.jobId] }),
  foreignKey({
    columns: [table.workspaceId, table.dealId],
    foreignColumns: [deals.workspaceId, deals.id],
    name: "xtrace_ingest_jobs_workspace_deal_fkey",
  }).onDelete("cascade"),
]);

export const xtraceMemoryLinks = pgTable("xtrace_memory_links", {
  memoryId: text("memory_id").notNull(),
  workspaceId: text("workspace_id").notNull().references(
    () => workspaces.id,
    { onDelete: "cascade" },
  ),
  dealId: text("deal_id").notNull(),
  sourceRevisionIds: jsonb("source_revision_ids").$type<string[]>().notNull()
    .default([]),
  sourceIds: jsonb("source_ids").$type<string[]>().notNull().default([]),
  fixtureIds: jsonb("fixture_ids").$type<string[]>().notNull().default([]),
  provenance: text("provenance").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.memoryId] }),
  foreignKey({
    columns: [table.workspaceId, table.dealId],
    foreignColumns: [deals.workspaceId, deals.id],
    name: "xtrace_memory_links_workspace_deal_fkey",
  }).onDelete("cascade"),
]);

export const xtraceIngestIntentsV2 = pgTable("xtrace_ingest_intents_v2", {
  intentId: text("intent_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  dealId: text("deal_id").notNull(),
  parentKind: text("parent_kind").notNull(),
  sourceId: text("source_id").notNull(),
  sourceRevisionId: text("source_revision_id").notNull(),
  parentFingerprint: text("parent_fingerprint").notNull(),
  payloadFingerprint: text("payload_fingerprint").notNull(),
  serializerVersion: text("serializer_version").notNull(),
  state: text("state").notNull(),
  stateHistory: jsonb("state_history").$type<string[]>().notNull(),
  leaseToken: uuid("lease_token"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  providerJobId: text("provider_job_id"),
  memoryIds: jsonb("memory_ids").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.intentId] }),
  unique("xtrace_ingest_intents_v2_parent_unique").on(
    table.workspaceId,
    table.dealId,
    table.parentKind,
    table.sourceId,
    table.sourceRevisionId,
    table.parentFingerprint,
    table.serializerVersion,
  ),
  uniqueIndex("xtrace_ingest_intents_v2_provider_job_unique")
    .on(table.workspaceId, table.providerJobId)
    .where(sql`${table.providerJobId} is not null`),
  foreignKey({
    columns: [table.workspaceId, table.dealId],
    foreignColumns: [deals.workspaceId, deals.id],
    name: "xtrace_ingest_intents_v2_workspace_deal_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.workspaceId, table.sourceRevisionId],
    foreignColumns: [sourceRevisions.workspaceId, sourceRevisions.id],
    name: "xtrace_ingest_intents_v2_workspace_revision_fkey",
  }),
  check(
    "xtrace_ingest_intents_v2_parent_kind_check",
    sql`${table.parentKind} in ('legacy_source_revision', 'canonical_source_revision', 'sample_decision_record', 'sample_research_screening_record')`,
  ),
]);

export const xtraceMemoryLinksV2 = pgTable("xtrace_memory_links_v2", {
  workspaceId: text("workspace_id").notNull(),
  memoryId: text("memory_id").notNull(),
  intentId: text("intent_id").notNull(),
  dealId: text("deal_id").notNull(),
  parentKind: text("parent_kind").notNull(),
  sourceId: text("source_id").notNull(),
  sourceRevisionId: text("source_revision_id").notNull(),
  parentFingerprint: text("parent_fingerprint").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.memoryId] }),
  foreignKey({
    columns: [table.workspaceId, table.intentId],
    foreignColumns: [xtraceIngestIntentsV2.workspaceId, xtraceIngestIntentsV2.intentId],
    name: "xtrace_memory_links_v2_intent_fkey",
  }),
  foreignKey({
    columns: [table.workspaceId, table.dealId],
    foreignColumns: [deals.workspaceId, deals.id],
    name: "xtrace_memory_links_v2_workspace_deal_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.workspaceId, table.sourceRevisionId],
    foreignColumns: [sourceRevisions.workspaceId, sourceRevisions.id],
    name: "xtrace_memory_links_v2_workspace_revision_fkey",
  }),
]);

export const xtraceRecallAuditsV2 = pgTable("xtrace_recall_audits_v2", {
  auditId: text("audit_id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  runId: uuid("run_id").notNull(),
  dealId: text("deal_id").notNull(),
  evidenceContextFingerprint: text("evidence_context_fingerprint").notNull(),
  activeParentFingerprint: text("active_parent_fingerprint").notNull(),
  queryFingerprint: text("query_fingerprint").notNull(),
  memoryIds: jsonb("memory_ids").$type<string[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.workspaceId, table.runId],
    foreignColumns: [scanRuns.workspaceId, scanRuns.id],
    name: "xtrace_recall_audits_v2_workspace_run_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.workspaceId, table.dealId],
    foreignColumns: [deals.workspaceId, deals.id],
    name: "xtrace_recall_audits_v2_workspace_deal_fkey",
  }).onDelete("cascade"),
]);

export const uploadedDocuments = pgTable("uploaded_documents", {
  id: text("id").notNull(),
  workspaceId: text("workspace_id").notNull().references(
    () => workspaces.id,
    { onDelete: "cascade" },
  ),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  byteSize: bigint("byte_size", { mode: "number" }).notNull(),
  checksum: text("checksum").notNull(),
  objectKey: text("object_key").notNull(),
  status: text("status").notNull().default("queued"),
  failureReason: text("failure_reason"),
  extractionPreview: jsonb("extraction_preview").$type<ExtractionPreview>(),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  workerId: text("worker_id"),
  leaseToken: uuid("lease_token"),
  dealId: text("deal_id"),
  sourceId: text("source_id"),
  sourceRevisionId: text("source_revision_id"),
  confirmationFingerprint: text("confirmation_fingerprint"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.id] }),
  unique("uploaded_documents_workspace_checksum_unique").on(
    table.workspaceId,
    table.checksum,
  ),
  foreignKey({
    columns: [table.workspaceId, table.dealId],
    foreignColumns: [deals.workspaceId, deals.id],
    name: "uploaded_documents_workspace_deal_fkey",
  }),
  foreignKey({
    columns: [
      table.workspaceId,
      table.sourceId,
      table.sourceRevisionId,
    ],
    foreignColumns: [
      sourceRevisions.workspaceId,
      sourceRevisions.sourceId,
      sourceRevisions.id,
    ],
    name: "uploaded_documents_exact_revision_fkey",
  }),
]);

export const benchmarkPacks = pgTable("benchmark_packs", {
  id: text("id").primaryKey(),
  version: text("version").notNull(),
  provider: text("provider").notNull(),
  sourceUrl: text("source_url").notNull(),
  publishedAt: date("published_at").notNull(),
  retrievalDate: date("retrieval_date").notNull(),
  geography: text("geography").notNull(),
  sector: text("sector").notNull(),
  observationWindow: text("observation_window").notNull(),
  sampleNotes: text("sample_notes").notNull(),
  staleAfterDays: integer("stale_after_days").notNull(),
  synthetic: boolean("synthetic").notNull().default(false),
  publicationStatus: text("publication_status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
    .notNull(),
});

export const benchmarkEntries = pgTable("benchmark_entries", {
  id: text("id").primaryKey(),
  benchmarkPackId: text("benchmark_pack_id").notNull().references(
    () => benchmarkPacks.id,
  ),
  stage: text("stage").notNull(),
  metric: text("metric").notNull(),
  value: text("value").notNull(),
  valuationBasis: text("valuation_basis"),
  currency: text("currency"),
  metricDefinition: text("metric_definition").notNull(),
  effectiveAt: date("effective_at").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
    .notNull(),
});

export const criticalEvidenceProfiles = pgTable(
  "critical_evidence_profiles",
  {
    id: text("id").primaryKey(),
    version: text("version").notNull(),
    stage: text("stage").notNull(),
    businessModel: text("business_model").notNull(),
    requiredFields: jsonb("required_fields").$type<string[]>().notNull(),
    synthetic: boolean("synthetic").notNull().default(false),
    publicationStatus: text("publication_status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
      .notNull(),
  },
);

export const criticalEvidenceProfileFields = pgTable(
  "critical_evidence_profile_fields",
  {
    criticalEvidenceProfileId: text("critical_evidence_profile_id")
      .notNull()
      .references(() => criticalEvidenceProfiles.id),
    fieldId: text("field_id").notNull(),
    critical: boolean("critical").notNull(),
    minimumModelInput: boolean("minimum_model_input").notNull(),
    acceptedAssertionStatuses: jsonb("accepted_assertion_statuses")
      .$type<string[]>()
      .notNull(),
    acceptedFreshness: jsonb("accepted_freshness")
      .$type<string[]>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.criticalEvidenceProfileId, table.fieldId],
    }),
    check(
      "critical_evidence_profile_fields_assertion_statuses_shape_check",
      sql`case when jsonb_typeof(${table.acceptedAssertionStatuses}) = 'array' then jsonb_array_length(${table.acceptedAssertionStatuses}) > 0 and not jsonb_path_exists(${table.acceptedAssertionStatuses}, '$[*] ? (@.type() != "string" || @ like_regex "^\\\\s*$")') else false end`,
    ),
    check(
      "critical_evidence_profile_fields_freshness_shape_check",
      sql`case when jsonb_typeof(${table.acceptedFreshness}) = 'array' then jsonb_array_length(${table.acceptedFreshness}) > 0 and not jsonb_path_exists(${table.acceptedFreshness}, '$[*] ? (@.type() != "string" || @ like_regex "^\\\\s*$")') else false end`,
    ),
  ],
);

export const valuationMethodPolicies = pgTable(
  "valuation_method_policies",
  {
    id: text("id").primaryKey(),
    version: text("version").notNull(),
    stage: text("stage").notNull(),
    businessModel: text("business_model").notNull(),
    methods: jsonb("methods").$type<string[]>().notNull(),
    synthetic: boolean("synthetic").notNull().default(false),
    publicationStatus: text("publication_status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
      .notNull(),
  },
);

export const decisionPolicies = pgTable("decision_policies", {
  id: text("id").primaryKey(),
  version: text("version").notNull(),
  stage: text("stage").notNull(),
  businessModel: text("business_model").notNull(),
  rules: jsonb("rules").$type<Record<string, unknown>>().notNull(),
  synthetic: boolean("synthetic").notNull().default(false),
  publicationStatus: text("publication_status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
    .notNull(),
});

export const frameworkSources = pgTable("framework_sources", {
  id: text("id").primaryKey(),
  version: text("version").notNull(),
  rightsStatus: text("rights_status").notNull(),
  privateBody: text("private_body").notNull(),
  privateObjectKey: text("private_object_key"),
  adminReviewNote: text("admin_review_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
    .notNull(),
});

export const frameworkCards = pgTable("framework_cards", {
  id: text("id").primaryKey(),
  version: text("version").notNull(),
  sourceId: text("source_id").notNull().references(() => frameworkSources.id),
  title: text("title").notNull(),
  synthetic: boolean("synthetic").notNull().default(false),
  publicationStatus: text("publication_status").notNull(),
  attribution: text("attribution").notNull(),
  approvedNeutralParaphrase: text("approved_neutral_paraphrase").notNull(),
  locator: text("locator").notNull(),
  limitations: jsonb("limitations").$type<string[]>().notNull(),
  rightsStatus: text("rights_status").notNull(),
  formalDecisionWeight: numeric("formal_decision_weight").notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
    .notNull(),
});

export const frameworkPacks = pgTable("framework_packs", {
  id: text("id").primaryKey(),
  version: text("version").notNull(),
  title: text("title").notNull(),
  synthetic: boolean("synthetic").notNull().default(false),
  publicationStatus: text("publication_status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
    .notNull(),
});

export const frameworkPackCards = pgTable("framework_pack_cards", {
  frameworkPackId: text("framework_pack_id").notNull().references(
    () => frameworkPacks.id,
  ),
  frameworkCardId: text("framework_card_id").notNull().references(
    () => frameworkCards.id,
  ),
  position: integer("position").notNull(),
}, (table) => [
  primaryKey({
    columns: [table.frameworkPackId, table.frameworkCardId],
  }),
  unique("framework_pack_cards_position_unique").on(
    table.frameworkPackId,
    table.position,
  ),
]);

export const underwritingContexts = pgTable("underwriting_contexts", {
  id: text("id").primaryKey(),
  contextVersion: text("context_version").notNull(),
  stage: text("stage").notNull(),
  businessModel: text("business_model").notNull(),
  supportedGeographies: jsonb("supported_geographies")
    .$type<string[]>()
    .notNull(),
  securityType: text("security_type").notNull(),
  criticalEvidenceProfileId: text("critical_evidence_profile_id")
    .notNull()
    .references(() => criticalEvidenceProfiles.id),
  usBenchmarkPackId: text("us_benchmark_pack_id").references(
    () => benchmarkPacks.id,
  ),
  usBenchmarkCompatibility: text("us_benchmark_compatibility").notNull(),
  globalBenchmarkCompatibility: text("global_benchmark_compatibility")
    .notNull(),
  valuationMethodPolicyId: text("valuation_method_policy_id")
    .notNull()
    .references(() => valuationMethodPolicies.id),
  decisionPolicyId: text("decision_policy_id").notNull().references(
    () => decisionPolicies.id,
  ),
  frameworkPackId: text("framework_pack_id").notNull().references(
    () => frameworkPacks.id,
  ),
  publicationStatus: text("publication_status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
    .notNull(),
}, (table) => [
  unique("underwriting_contexts_stage_model_version_unique").on(
    table.stage,
    table.businessModel,
    table.contextVersion,
  ),
]);

export const fundPolicyVersions = pgTable("fund_policy_versions", {
  id: text("id").notNull(),
  workspaceId: text("workspace_id").notNull().references(
    () => workspaces.id,
    { onDelete: "cascade" },
  ),
  version: integer("version").notNull(),
  source: text("source").notNull(),
  values: jsonb("values").$type<FundPolicyValues>().notNull(),
  createdByUserId: text("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
    .notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.id] }),
  unique("fund_policy_versions_workspace_version_unique").on(
    table.workspaceId,
    table.version,
  ),
]);

export const workspaceActiveFundPolicies = pgTable(
  "workspace_active_fund_policies",
  {
    workspaceId: text("workspace_id").primaryKey().references(
      () => workspaces.id,
      { onDelete: "cascade" },
    ),
    versionId: text("version_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.versionId],
      foreignColumns: [fundPolicyVersions.workspaceId, fundPolicyVersions.id],
      name: "workspace_active_fund_policy_version_fkey",
    }),
  ],
);

export const underwritingBatches = pgTable("underwriting_batches", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(
    () => workspaces.id,
    { onDelete: "cascade" },
  ),
  scanRunId: uuid("scan_run_id").notNull(),
  status: text("status").notNull(),
  batchInputFingerprint: text("batch_input_fingerprint").notNull(),
  fundPolicySnapshotId: text("fund_policy_snapshot_id").notNull(),
  forceRefresh: boolean("force_refresh").notNull().default(false),
  refreshNonce: text("refresh_nonce"),
  rerunOfId: text("rerun_of_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
    .notNull(),
}, (table) => [
  unique("underwriting_batches_workspace_id_unique").on(
    table.workspaceId,
    table.id,
  ),
  foreignKey({
    columns: [table.workspaceId, table.scanRunId],
    foreignColumns: [scanRuns.workspaceId, scanRuns.id],
    name: "underwriting_batches_workspace_scan_fkey",
  }),
  foreignKey({
    columns: [table.workspaceId, table.fundPolicySnapshotId],
    foreignColumns: [fundPolicyVersions.workspaceId, fundPolicyVersions.id],
    name: "underwriting_batches_workspace_policy_fkey",
  }),
  foreignKey({
    columns: [table.workspaceId, table.rerunOfId],
    foreignColumns: [table.workspaceId, table.id],
    name: "underwriting_batches_workspace_rerun_fkey",
  }),
  check(
    "underwriting_batches_status_check",
    sql`${table.status} in ('queued', 'running', 'partial', 'completed', 'failed')`,
  ),
  check(
    "underwriting_batches_fingerprint_check",
    sql`${table.batchInputFingerprint} ~ '^sha256:[0-9a-f]{64}$'`,
  ),
  check(
    "underwriting_batches_refresh_shape_check",
    sql`(not ${table.forceRefresh} and ${table.refreshNonce} is null and ${table.rerunOfId} is null) or (${table.forceRefresh} and btrim(coalesce(${table.refreshNonce}, '')) <> '' and ${table.rerunOfId} is not null)`,
  ),
  uniqueIndex("underwriting_batches_idempotent_input_unique")
    .on(table.workspaceId, table.batchInputFingerprint)
    .where(sql`not ${table.forceRefresh}`),
  uniqueIndex("underwriting_batches_refresh_nonce_unique")
    .on(table.workspaceId, table.batchInputFingerprint, table.refreshNonce)
    .where(sql`${table.forceRefresh}`),
]);

export const underwritingSelections = pgTable("underwriting_selections", {
  batchId: text("batch_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  dealId: text("deal_id").notNull(),
  status: text("status").notNull(),
  rank: integer("rank"),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
    .notNull(),
}, (table) => [
  primaryKey({ columns: [table.batchId, table.dealId] }),
  foreignKey({
    columns: [table.workspaceId, table.batchId],
    foreignColumns: [underwritingBatches.workspaceId, underwritingBatches.id],
    name: "underwriting_selections_workspace_batch_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.workspaceId, table.dealId],
    foreignColumns: [deals.workspaceId, deals.id],
    name: "underwriting_selections_workspace_deal_fkey",
  }),
  check(
    "underwriting_selections_status_check",
    sql`${table.status} in ('selected', 'not_selected')`,
  ),
  check(
    "underwriting_selections_rank_shape_check",
    sql`(${table.status} = 'selected' and ${table.rank} > 0) or (${table.status} = 'not_selected' and ${table.rank} is null)`,
  ),
  uniqueIndex("underwriting_selections_selected_rank_unique")
    .on(table.batchId, table.rank)
    .where(sql`${table.status} = 'selected'`),
]);

export const candidateRuns = pgTable("candidate_runs", {
  id: text("id").primaryKey(),
  batchId: text("batch_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  dealId: text("deal_id").notNull(),
  status: text("status").notNull(),
  candidateAnalysisFingerprint: text("candidate_analysis_fingerprint")
    .notNull(),
  rerunOfId: text("rerun_of_id"),
  artifactSourceCandidateRunId: text("artifact_source_candidate_run_id"),
  workerId: text("worker_id"),
  leaseToken: text("lease_token"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  unavailableReasonCodes: jsonb("unavailable_reason_codes")
    .$type<string[]>()
    .notNull()
    .default([]),
  publicFailureReason: text("public_failure_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
    .notNull(),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
}, (table) => [
  unique("candidate_runs_workspace_id_unique").on(table.workspaceId, table.id),
  unique("candidate_runs_batch_deal_unique").on(table.batchId, table.dealId),
  foreignKey({
    columns: [table.workspaceId, table.batchId],
    foreignColumns: [underwritingBatches.workspaceId, underwritingBatches.id],
    name: "candidate_runs_workspace_batch_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.workspaceId, table.dealId],
    foreignColumns: [deals.workspaceId, deals.id],
    name: "candidate_runs_workspace_deal_fkey",
  }),
  foreignKey({
    columns: [table.workspaceId, table.rerunOfId],
    foreignColumns: [table.workspaceId, table.id],
    name: "candidate_runs_workspace_rerun_fkey",
  }),
  foreignKey({
    columns: [table.workspaceId, table.artifactSourceCandidateRunId],
    foreignColumns: [table.workspaceId, table.id],
    name: "candidate_runs_workspace_artifact_source_fkey",
  }),
  check(
    "candidate_runs_terminal_reason_check",
    sql`${table.status} not in ('partial', 'unavailable', 'failed') or coalesce(btrim(${table.publicFailureReason}), '') <> '' or jsonb_array_length(${table.unavailableReasonCodes}) > 0`,
  ),
  check(
    "candidate_runs_status_check",
    sql`${table.status} in ('queued', 'running', 'partial', 'completed', 'unavailable', 'failed')`,
  ),
  check(
    "candidate_runs_lease_shape_check",
    sql`(${table.workerId} is null and ${table.leaseToken} is null and ${table.leaseExpiresAt} is null) or (${table.status} = 'running' and btrim(coalesce(${table.workerId}, '')) <> '' and btrim(coalesce(${table.leaseToken}, '')) <> '' and ${table.leaseExpiresAt} is not null)`,
  ),
  check(
    "candidate_runs_artifact_alias_shape_check",
    sql`${table.artifactSourceCandidateRunId} is null or (${table.status} = 'completed' and ${table.rerunOfId} = ${table.artifactSourceCandidateRunId})`,
  ),
  uniqueIndex("candidate_runs_completed_fingerprint_unique")
    .on(table.workspaceId, table.candidateAnalysisFingerprint)
    .where(
      sql`${table.status} = 'completed' and ${table.artifactSourceCandidateRunId} is null`,
    ),
  index("candidate_runs_claim_queue_idx").on(
    table.status,
    table.createdAt,
    table.id,
  ),
]);

export const candidateCheckpoints = pgTable("candidate_checkpoints", {
  candidateRunId: text("candidate_run_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  stage: text("stage").notNull(),
  status: text("status").notNull(),
  inputFingerprint: text("input_fingerprint").notNull(),
  outputFingerprint: text("output_fingerprint"),
  outputPayload: jsonb("output_payload"),
  attemptCount: integer("attempt_count").notNull().default(0),
  costUnits: integer("cost_units").notNull().default(0),
  tokenUnits: integer("token_units").notNull().default(0),
  actualTokenUnits: integer("actual_token_units").notNull().default(0),
  providerAttempts: jsonb("provider_attempts")
    .$type<CandidateProviderAttempt[]>()
    .notNull()
    .default([]),
  reasonCode: text("reason_code"),
  publicReason: text("public_reason"),
  savedAt: timestamp("saved_at", { withTimezone: true }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.candidateRunId, table.stage] }),
  foreignKey({
    columns: [table.workspaceId, table.candidateRunId],
    foreignColumns: [candidateRuns.workspaceId, candidateRuns.id],
    name: "candidate_checkpoints_workspace_candidate_fkey",
  }).onDelete("cascade"),
  check(
    "candidate_checkpoints_status_check",
    sql`${table.status} in ('running', 'completed', 'failed')`,
  ),
  check(
    "candidate_checkpoints_stage_check",
    sql`${table.stage} in ('evidence_pack', 'context_router', 'valuation', 'framework_catalog', 'framework_lenses', 'decision', 'narrative_drafts', 'finalization')`,
  ),
  check(
    "candidate_checkpoints_usage_check",
    sql`${table.attemptCount} >= 0 and ${table.costUnits} >= 0 and ${table.tokenUnits} >= 0 and ${table.actualTokenUnits} >= 0`,
  ),
  check(
    "candidate_checkpoints_provider_attempts_shape_check",
    sql`jsonb_typeof(${table.providerAttempts}) = 'array'`,
  ),
]);

export const evidencePacks = pgTable("evidence_packs", {
  workspaceId: text("workspace_id").notNull(),
  candidateRunId: text("candidate_run_id").notNull(),
  artifactId: text("artifact_id").notNull(),
  version: integer("version").notNull(),
  payload: jsonb("payload").$type<EvidencePack>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
    .notNull(),
}, artifactTableConfig("evidence_packs_workspace_candidate_fkey"));

export const candidateContextSnapshots = pgTable(
  "candidate_context_snapshots",
  {
    workspaceId: text("workspace_id").notNull(),
    candidateRunId: text("candidate_run_id").notNull(),
    artifactId: text("artifact_id").notNull(),
    payload: jsonb("payload").$type<ResolvedUnderwritingContext>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
      .notNull(),
  },
  artifactTableConfig("candidate_context_snapshots_candidate_fkey"),
);

export const scenarioModels = pgTable("scenario_models", {
  workspaceId: text("workspace_id").notNull(),
  candidateRunId: text("candidate_run_id").notNull(),
  artifactId: text("artifact_id").notNull(),
  payload: jsonb("payload").$type<ScenarioModel>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
    .notNull(),
}, artifactTableConfig("scenario_models_workspace_candidate_fkey"));

export const underwritingCalculations = pgTable(
  "underwriting_calculations",
  {
    workspaceId: text("workspace_id").notNull(),
    candidateRunId: text("candidate_run_id").notNull(),
    artifactId: text("artifact_id").notNull(),
    payload: jsonb("payload").$type<Calculation>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
      .notNull(),
  },
  manyArtifactTableConfig("underwriting_calculations_candidate_fkey"),
);

export const frameworkJudgmentArtifacts = pgTable(
  "framework_judgment_artifacts",
  {
    workspaceId: text("workspace_id").notNull(),
    candidateRunId: text("candidate_run_id").notNull(),
    artifactId: text("artifact_id").notNull(),
    payload: jsonb("payload").$type<FrameworkJudgment>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
      .notNull(),
  },
  manyArtifactTableConfig("framework_judgment_artifacts_candidate_fkey"),
);

export const frameworkDisagreementArtifacts = pgTable(
  "framework_disagreement_artifacts",
  {
    workspaceId: text("workspace_id").notNull(),
    candidateRunId: text("candidate_run_id").notNull(),
    artifactId: text("artifact_id").notNull(),
    payload: jsonb("payload").$type<FrameworkDisagreement>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
      .notNull(),
  },
  manyArtifactTableConfig(
    "framework_disagreement_artifacts_candidate_fkey",
  ),
);

export const valuationEvaluations = pgTable("valuation_evaluations", {
  workspaceId: text("workspace_id").notNull(),
  candidateRunId: text("candidate_run_id").notNull(),
  artifactId: text("artifact_id").notNull(),
  payload: jsonb("payload").$type<ValuationEvaluation>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
    .notNull(),
}, artifactTableConfig("valuation_evaluations_workspace_candidate_fkey"));

export const finalSyntheses = pgTable("final_syntheses", {
  workspaceId: text("workspace_id").notNull(),
  candidateRunId: text("candidate_run_id").notNull(),
  artifactId: text("artifact_id").notNull(),
  payload: jsonb("payload").$type<DecisionResult>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
    .notNull(),
}, artifactTableConfig("final_syntheses_workspace_candidate_fkey"));

export const underwritingNarratives = pgTable("underwriting_narratives", {
  workspaceId: text("workspace_id").notNull(),
  candidateRunId: text("candidate_run_id").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
    .notNull(),
}, artifactTableConfig("underwriting_narratives_workspace_candidate_fkey"));

export const actionDrafts = pgTable("action_drafts", {
  workspaceId: text("workspace_id").notNull(),
  candidateRunId: text("candidate_run_id").notNull(),
  artifactId: text("artifact_id").notNull(),
  payload: jsonb("payload").$type<ActionDraft>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
    .notNull(),
}, (table) => [
  ...manyArtifactTableConfig(
    "action_drafts_workspace_candidate_fkey",
  )(table),
  uniqueIndex("action_drafts_workspace_artifact_unique").on(
    table.workspaceId,
    table.artifactId,
  ),
]);

export const underwritingClaimEdges = pgTable("underwriting_claim_edges", {
  workspaceId: text("workspace_id").notNull(),
  candidateRunId: text("candidate_run_id").notNull(),
  claimItemId: text("claim_item_id").notNull(),
  dependencyItemId: text("dependency_item_id").notNull(),
  dependencyType: text("dependency_type").$type<ClaimEdge["dependencyType"]>()
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
    .notNull(),
}, (table) => [
  primaryKey({
    columns: [
      table.workspaceId,
      table.candidateRunId,
      table.claimItemId,
      table.dependencyItemId,
      table.dependencyType,
    ],
  }),
  foreignKey({
    columns: [table.workspaceId, table.candidateRunId],
    foreignColumns: [candidateRuns.workspaceId, candidateRuns.id],
    name: "underwriting_claim_edges_workspace_candidate_fkey",
  }),
]);

export const candidateVersionSnapshots = pgTable(
  "candidate_version_snapshots",
  {
    workspaceId: text("workspace_id").notNull(),
    candidateRunId: text("candidate_run_id").notNull(),
    payload: jsonb("payload").$type<CandidateVersionSnapshot>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
      .notNull(),
  },
  artifactTableConfig("candidate_version_snapshots_workspace_candidate_fkey"),
);

export const researchCandidates = pgTable("research_candidates", {
  workspaceId: text("workspace_id").notNull(),
  candidateId: text("candidate_id").notNull(),
  companyId: text("company_id").notNull(),
  dealId: text("deal_id").notNull(),
  schemaVersion: text("schema_version").$type<"research-candidate-v1">()
    .notNull(),
  disposition: text("disposition").$type<"qualified_not_selected">()
    .notNull(),
  researchSnapshotVersion: text("research_snapshot_version")
    .notNull()
    .default("research-evidence-snapshot-v1"),
  snapshotId: text("snapshot_id").notNull(),
  snapshotFingerprint: text("snapshot_fingerprint").notNull(),
  anchorAt: timestamp("anchor_at", { withTimezone: true }).notNull(),
  evidenceMode: text("evidence_mode").$type<"pinned">().notNull(),
  entityKeys: jsonb("entity_keys").$type<string[]>().notNull(),
  activeParentFingerprint: text("active_parent_fingerprint").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  payloadFingerprint: text("payload_fingerprint").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
    .notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.candidateId] }),
  unique("research_candidates_workspace_deal_unique").on(
    table.workspaceId,
    table.dealId,
  ),
  unique("research_candidates_full_scope_unique").on(
    table.workspaceId,
    table.candidateId,
    table.dealId,
    table.snapshotId,
    table.snapshotFingerprint,
    table.anchorAt,
    table.activeParentFingerprint,
  ),
  foreignKey({
    columns: [table.workspaceId, table.companyId],
    foreignColumns: [companies.workspaceId, companies.id],
    name: "research_candidates_workspace_company_fkey",
  }),
  foreignKey({
    columns: [table.workspaceId, table.dealId],
    foreignColumns: [deals.workspaceId, deals.id],
    name: "research_candidates_workspace_deal_fkey",
  }),
  foreignKey({
    columns: [table.workspaceId, table.snapshotId, table.snapshotFingerprint],
    foreignColumns: [
      marketEvidenceSnapshots.workspaceId,
      marketEvidenceSnapshots.id,
      marketEvidenceSnapshots.snapshotFingerprint,
    ],
    name: "research_candidates_snapshot_fkey",
  }),
  check(
    "research_candidates_schema_version_check",
    sql`${table.schemaVersion} = 'research-candidate-v1'`,
  ),
  check(
    "research_candidates_disposition_check",
    sql`${table.disposition} = 'qualified_not_selected'`,
  ),
  check(
    "research_candidates_snapshot_version_check",
    sql`${table.researchSnapshotVersion} = 'research-evidence-snapshot-v1'`,
  ),
  check(
    "research_candidates_evidence_mode_check",
    sql`${table.evidenceMode} = 'pinned'`,
  ),
  check(
    "research_candidates_snapshot_fingerprint_check",
    sql`${table.snapshotFingerprint} ~ '^sha256:[0-9a-f]{64}$'`,
  ),
  check(
    "research_candidates_active_parent_fingerprint_check",
    sql`${table.activeParentFingerprint} ~ '^sha256:[0-9a-f]{64}$'`,
  ),
  check(
    "research_candidates_entity_keys_check",
    sql`public.jsonb_sorted_unique_text_array_0019(${table.entityKeys}, false, true)`,
  ),
  check(
    "research_candidates_payload_shape_check",
    sql`jsonb_typeof(${table.payload}) = 'object'`,
  ),
  check(
    "research_candidates_payload_fingerprint_check",
    sql`${table.payloadFingerprint} = public.sha256_canonical_jsonb_0019(${table.payload})`,
  ),
]);

export const researchCandidateSourceAssignments = pgTable(
  "research_candidate_source_assignments",
  {
    workspaceId: text("workspace_id").notNull(),
    candidateId: text("candidate_id").notNull(),
    dealId: text("deal_id").notNull(),
    dealAssignmentId: text("deal_assignment_id").notNull(),
    parentKind: text("parent_kind")
      .$type<"public_evidence" | "research_disposition">()
      .notNull(),
    xtraceParentKind: text("xtrace_parent_kind")
      .$type<"canonical_source_revision" | "sample_research_screening_record">()
      .notNull(),
    claimClass: text("claim_class")
      .$type<"fact" | "research_disposition">()
      .notNull(),
    sourceId: text("source_id").notNull(),
    sourceRevisionId: text("source_revision_id").notNull(),
    sourceRevisionFingerprint: text("source_revision_fingerprint").notNull(),
    sourceRole: text("source_role")
      .$type<"public_web_snapshot" | "sample_research_screening_record">()
      .notNull(),
    sourceClass: text("source_class")
      .$type<Exclude<SourceClassV2, "unknown_legacy">>()
      .notNull(),
    sourceAuthority: text("source_authority")
      .$type<Exclude<SourceAuthorityV2, "unknown_legacy">>()
      .notNull(),
    evidenceRole: text("evidence_role")
      .$type<Exclude<EvidenceRoleV2, "unknown_legacy">>()
      .notNull(),
    canonicalUrl: text("canonical_url"),
    eventAt: text("event_at"),
    eventAtPrecision: text("event_at_precision").$type<TemporalPrecisionV2>(),
    publishedAt: text("published_at"),
    publishedAtPrecision: text("published_at_precision")
      .$type<TemporalPrecisionV2>(),
    retrievedAt: text("retrieved_at").notNull(),
    retrievedAtPrecision: text("retrieved_at_precision")
      .$type<TemporalPrecisionV2>()
      .notNull(),
    snapshotId: text("snapshot_id").notNull(),
    snapshotFingerprint: text("snapshot_fingerprint").notNull(),
    anchorAt: timestamp("anchor_at", { withTimezone: true }).notNull(),
    entityKeys: jsonb("entity_keys").$type<string[]>().notNull(),
    activeParentFingerprint: text("active_parent_fingerprint").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    payloadFingerprint: text("payload_fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.workspaceId,
        table.candidateId,
        table.parentKind,
        table.sourceId,
        table.sourceRevisionId,
      ],
    }),
    foreignKey({
      columns: [
        table.workspaceId,
        table.candidateId,
        table.dealId,
        table.snapshotId,
        table.snapshotFingerprint,
        table.anchorAt,
        table.activeParentFingerprint,
      ],
      foreignColumns: [
        researchCandidates.workspaceId,
        researchCandidates.candidateId,
        researchCandidates.dealId,
        researchCandidates.snapshotId,
        researchCandidates.snapshotFingerprint,
        researchCandidates.anchorAt,
        researchCandidates.activeParentFingerprint,
      ],
      name: "research_candidate_sources_candidate_fkey",
    }),
    foreignKey({
      columns: [table.workspaceId, table.dealAssignmentId],
      foreignColumns: [dealSourceAssignments.workspaceId, dealSourceAssignments.id],
      name: "research_candidate_sources_deal_assignment_fkey",
    }),
    foreignKey({
      columns: [table.workspaceId, table.sourceId, table.sourceRevisionId],
      foreignColumns: [
        sourceRevisions.workspaceId,
        sourceRevisions.sourceId,
        sourceRevisions.id,
      ],
      name: "research_candidate_sources_revision_fkey",
    }),
    check(
      "research_candidate_sources_parent_kind_check",
      sql`${table.parentKind} in ('public_evidence', 'research_disposition')`,
    ),
    check(
      "research_candidate_sources_xtrace_parent_kind_check",
      sql`${table.xtraceParentKind} in ('canonical_source_revision', 'sample_research_screening_record')`,
    ),
    check(
      "research_candidate_sources_claim_class_check",
      sql`${table.claimClass} in ('fact', 'research_disposition')`,
    ),
    check(
      "research_candidate_sources_source_role_check",
      sql`${table.sourceRole} in ('public_web_snapshot', 'sample_research_screening_record')`,
    ),
    check(
      "research_candidate_sources_evidence_role_check",
      sql`${table.evidenceRole} in ('trigger', 'corroborating', 'counterevidence', 'context')`,
    ),
    check(
      "research_candidate_sources_source_class_check",
      sql`${table.sourceClass} in ('company_official', 'government_or_regulator', 'court_or_public_filing', 'customer_or_partner_official', 'investor_official', 'funding_publication', 'industry_publication', 'commercial_database', 'founder_social', 'internal_decision_record', 'model_output')`,
    ),
    check(
      "research_candidate_sources_authority_check",
      sql`${table.sourceAuthority} in ('primary', 'secondary', 'not_applicable')`,
    ),
    check(
      "research_candidate_sources_kind_check",
      sql`(${table.parentKind} = 'public_evidence' and ${table.claimClass} = 'fact' and ${table.xtraceParentKind} = 'canonical_source_revision' and ${table.sourceRole} = 'public_web_snapshot') or (${table.parentKind} = 'research_disposition' and ${table.claimClass} = 'research_disposition' and ${table.xtraceParentKind} = 'sample_research_screening_record' and ${table.sourceRole} = 'sample_research_screening_record')`,
    ),
    check(
      "research_candidate_sources_revision_fingerprint_check",
      sql`${table.sourceRevisionFingerprint} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    check(
      "research_candidate_sources_event_temporal_check",
      sql`public.valid_temporal_pair_0019(coalesce(to_jsonb(${table.eventAt}), 'null'::jsonb), coalesce(to_jsonb(${table.eventAtPrecision}), 'null'::jsonb), true)`,
    ),
    check(
      "research_candidate_sources_published_temporal_check",
      sql`public.valid_temporal_pair_0019(coalesce(to_jsonb(${table.publishedAt}), 'null'::jsonb), coalesce(to_jsonb(${table.publishedAtPrecision}), 'null'::jsonb), true)`,
    ),
    check(
      "research_candidate_sources_retrieved_temporal_check",
      sql`public.valid_temporal_pair_0019(to_jsonb(${table.retrievedAt}), to_jsonb(${table.retrievedAtPrecision}), false)`,
    ),
    check(
      "research_candidate_sources_trigger_temporal_check",
      sql`${table.evidenceRole} <> 'trigger' or (${table.eventAt} is not null and ${table.publishedAt} is not null)`,
    ),
    check(
      "research_candidate_sources_url_check",
      sql`${table.canonicalUrl} is null or public.valid_canonical_http_url_0019(to_jsonb(${table.canonicalUrl}))`,
    ),
    check(
      "research_candidate_sources_chronology_check",
      sql`(${table.eventAt} is null or ${table.publishedAt} is null or not public.temporal_definitely_before_0019(to_jsonb(${table.publishedAt}), to_jsonb(${table.eventAt}))) and (${table.publishedAt} is null or not public.temporal_definitely_before_0019(to_jsonb(${table.retrievedAt}), to_jsonb(${table.publishedAt})))`,
    ),
    check(
      "research_candidate_sources_payload_shape_check",
      sql`jsonb_typeof(${table.payload}) = 'object'`,
    ),
    check(
      "research_candidate_sources_payload_fingerprint_check",
      sql`${table.payloadFingerprint} = public.sha256_canonical_jsonb_0019(${table.payload})`,
    ),
  ],
);

export const researchCandidateEvidenceGaps = pgTable(
  "research_candidate_evidence_gaps",
  {
    workspaceId: text("workspace_id").notNull(),
    candidateId: text("candidate_id").notNull(),
    dealId: text("deal_id").notNull(),
    gapId: text("gap_id").notNull(),
    schemaVersion: text("schema_version").notNull(),
    gapKind: text("gap_kind").notNull(),
    sourceLabel: text("source_label").notNull(),
    surfacedUrl: text("surfaced_url"),
    reason: text("reason").notNull(),
    snapshotId: text("snapshot_id").notNull(),
    snapshotFingerprint: text("snapshot_fingerprint").notNull(),
    anchorAt: timestamp("anchor_at", { withTimezone: true }).notNull(),
    activeParentFingerprint: text("active_parent_fingerprint").notNull(),
    entityKeys: jsonb("entity_keys").$type<string[]>().notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    payloadFingerprint: text("payload_fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.candidateId, table.gapId] }),
    foreignKey({
      columns: [
        table.workspaceId,
        table.candidateId,
        table.dealId,
        table.snapshotId,
        table.snapshotFingerprint,
        table.anchorAt,
        table.activeParentFingerprint,
      ],
      foreignColumns: [
        researchCandidates.workspaceId,
        researchCandidates.candidateId,
        researchCandidates.dealId,
        researchCandidates.snapshotId,
        researchCandidates.snapshotFingerprint,
        researchCandidates.anchorAt,
        researchCandidates.activeParentFingerprint,
      ],
      name: "research_candidate_gaps_candidate_fkey",
    }),
    check(
      "research_candidate_gaps_schema_version_check",
      sql`${table.schemaVersion} = 'research-candidate-evidence-gap-v1'`,
    ),
    check(
      "research_candidate_gaps_kind_check",
      sql`${table.gapKind} in ('unresolved_source', 'insufficient_corroboration', 'missing_metric', 'identity_ambiguity')`,
    ),
    check(
      "research_candidate_gaps_source_label_check",
      sql`btrim(${table.sourceLabel}) <> ''`,
    ),
    check(
      "research_candidate_gaps_reason_check",
      sql`btrim(${table.reason}) <> ''`,
    ),
    check(
      "research_candidate_gaps_payload_shape_check",
      sql`jsonb_typeof(${table.payload}) = 'object'`,
    ),
    check(
      "research_candidate_gaps_payload_fingerprint_check",
      sql`${table.payloadFingerprint} = public.sha256_canonical_jsonb_0019(${table.payload})`,
    ),
  ],
);

export const dealUniverseSnapshotsV1 = pgTable("deal_universe_snapshots_v1", {
  workspaceId: text("workspace_id").notNull(),
  universeId: text("universe_id").notNull(),
  schemaVersion: text("schema_version")
    .$type<"deal-universe-snapshot-v1">()
    .notNull(),
  mode: text("mode").$type<"live" | "pinned">().notNull(),
  anchorAt: timestamp("anchor_at", { withTimezone: true }).notNull(),
  evidenceSnapshotId: text("evidence_snapshot_id"),
  evidenceSnapshotFingerprint: text("evidence_snapshot_fingerprint"),
  dealCount: integer("deal_count").notNull(),
  universeFingerprint: text("universe_fingerprint").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
    .notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.universeId] }),
  unique("deal_universe_snapshots_scope_fingerprint_unique").on(
    table.workspaceId,
    table.universeId,
    table.universeFingerprint,
  ),
  foreignKey({
    columns: [
      table.workspaceId,
      table.evidenceSnapshotId,
      table.evidenceSnapshotFingerprint,
    ],
    foreignColumns: [
      marketEvidenceSnapshots.workspaceId,
      marketEvidenceSnapshots.id,
      marketEvidenceSnapshots.snapshotFingerprint,
    ],
    name: "deal_universe_snapshot_evidence_fkey",
  }),
  check(
    "deal_universe_snapshots_schema_version_check",
    sql`${table.schemaVersion} = 'deal-universe-snapshot-v1'`,
  ),
  check(
    "deal_universe_snapshot_mode_check",
    sql`(${table.mode} = 'live' and ${table.evidenceSnapshotId} is null and ${table.evidenceSnapshotFingerprint} is null) or (${table.mode} = 'pinned' and ${table.evidenceSnapshotId} is not null and ${table.evidenceSnapshotFingerprint} is not null)`,
  ),
  check("deal_universe_snapshots_count_check", sql`${table.dealCount} > 0`),
  check(
    "deal_universe_snapshots_fingerprint_check",
    sql`${table.universeFingerprint} ~ '^sha256:[0-9a-f]{64}$'`,
  ),
]);

export const dealUniverseSnapshotMembersV1 = pgTable(
  "deal_universe_snapshot_members_v1",
  {
    workspaceId: text("workspace_id").notNull(),
    universeId: text("universe_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    dealId: text("deal_id").notNull(),
    companyId: text("company_id").notNull(),
    dealStatus: text("deal_status")
      .$type<"screening" | "watchlist" | "evaluating" | "passed" | "invested">()
      .notNull(),
    analysisEligibleAt: timestamp("analysis_eligible_at", { withTimezone: true })
      .notNull(),
    memberFingerprint: text("member_fingerprint").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.universeId, table.ordinal] }),
    unique("deal_universe_members_workspace_deal_unique").on(
      table.workspaceId,
      table.universeId,
      table.dealId,
    ),
    foreignKey({
      columns: [table.workspaceId, table.universeId],
      foreignColumns: [dealUniverseSnapshotsV1.workspaceId, dealUniverseSnapshotsV1.universeId],
      name: "deal_universe_members_snapshot_fkey",
    }),
    foreignKey({
      columns: [table.workspaceId, table.dealId],
      foreignColumns: [deals.workspaceId, deals.id],
      name: "deal_universe_members_deal_fkey",
    }),
    foreignKey({
      columns: [table.workspaceId, table.companyId],
      foreignColumns: [companies.workspaceId, companies.id],
      name: "deal_universe_members_company_fkey",
    }),
    check("deal_universe_members_ordinal_check", sql`${table.ordinal} >= 0`),
    check(
      "deal_universe_members_status_check",
      sql`${table.dealStatus} in ('screening', 'watchlist', 'evaluating', 'passed', 'invested')`,
    ),
    check(
      "deal_universe_members_fingerprint_check",
      sql`${table.memberFingerprint} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
  ],
);

export const runDealUniverseBindingsV1 = pgTable("run_deal_universe_bindings_v1", {
  workspaceId: text("workspace_id").notNull(),
  runId: uuid("run_id").notNull(),
  schemaVersion: text("schema_version")
    .$type<"run-deal-universe-binding-v1">()
    .notNull(),
  universeId: text("universe_id").notNull(),
  universeFingerprint: text("universe_fingerprint").notNull(),
  dealCount: integer("deal_count").notNull(),
  boundAt: timestamp("bound_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.runId] }),
  foreignKey({
    columns: [table.workspaceId, table.runId],
    foreignColumns: [scanRuns.workspaceId, scanRuns.id],
    name: "run_deal_universe_binding_run_fkey",
  }),
  foreignKey({
    columns: [table.workspaceId, table.universeId, table.universeFingerprint],
    foreignColumns: [
      dealUniverseSnapshotsV1.workspaceId,
      dealUniverseSnapshotsV1.universeId,
      dealUniverseSnapshotsV1.universeFingerprint,
    ],
    name: "run_deal_universe_binding_universe_fkey",
  }),
  check(
    "run_deal_universe_binding_schema_version_check",
    sql`${table.schemaVersion} = 'run-deal-universe-binding-v1'`,
  ),
  check("run_deal_universe_binding_count_check", sql`${table.dealCount} > 0`),
]);

export const reportDealUniverseBindingsV1 = pgTable(
  "report_deal_universe_bindings_v1",
  {
    workspaceId: text("workspace_id").notNull(),
    reportId: text("report_id").notNull(),
    runId: uuid("run_id").notNull(),
    universeId: text("universe_id").notNull(),
    universeFingerprint: text("universe_fingerprint").notNull(),
    dealCount: integer("deal_count").notNull(),
    boundAt: timestamp("bound_at", { withTimezone: true }).defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.reportId] }),
    unique("report_deal_universe_binding_workspace_run_unique").on(
      table.workspaceId,
      table.runId,
    ),
    foreignKey({
      columns: [table.workspaceId, table.reportId],
      foreignColumns: [intelligenceReports.workspaceId, intelligenceReports.id],
      name: "report_deal_universe_binding_report_fkey",
    }),
    foreignKey({
      columns: [table.workspaceId, table.runId],
      foreignColumns: [runDealUniverseBindingsV1.workspaceId, runDealUniverseBindingsV1.runId],
      name: "report_deal_universe_binding_run_fkey",
    }),
    foreignKey({
      columns: [table.workspaceId, table.universeId, table.universeFingerprint],
      foreignColumns: [
        dealUniverseSnapshotsV1.workspaceId,
        dealUniverseSnapshotsV1.universeId,
        dealUniverseSnapshotsV1.universeFingerprint,
      ],
      name: "report_deal_universe_binding_universe_fkey",
    }),
    check(
      "report_deal_universe_binding_count_check",
      sql`${table.dealCount} > 0`,
    ),
  ],
);

function artifactTableConfig(constraintName: string) {
  return (table: {
    workspaceId: AnyPgColumn;
    candidateRunId: AnyPgColumn;
  }) => [
    primaryKey({ columns: [table.workspaceId, table.candidateRunId] }),
    foreignKey({
      columns: [table.workspaceId, table.candidateRunId],
      foreignColumns: [candidateRuns.workspaceId, candidateRuns.id],
      name: constraintName,
    }),
  ];
}

function manyArtifactTableConfig(constraintName: string) {
  return (table: {
    workspaceId: AnyPgColumn;
    candidateRunId: AnyPgColumn;
    artifactId: AnyPgColumn;
  }) => [
    primaryKey({
      columns: [table.workspaceId, table.candidateRunId, table.artifactId],
    }),
    foreignKey({
      columns: [table.workspaceId, table.candidateRunId],
      foreignColumns: [candidateRuns.workspaceId, candidateRuns.id],
      name: constraintName,
    }),
  ];
}
