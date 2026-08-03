import { z } from "zod";

import {
  canonicalEvidenceJson,
  uniqueByCanonicalId,
  WritableMarketEventV2Schema,
} from "./source-evidence";
import { compareUtf8 } from "../format/canonical-order";
import { withinPublicationWindow } from "../market/dedupe";

const FingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const TimestampSchema = z.string().datetime({ offset: true });
const CalendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(
  (value) => {
    const parsed = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed)
      && new Date(parsed).toISOString().slice(0, 10) === value;
  },
  "Invalid calendar date",
);
const IanaTimezoneSchema = z.string().min(1).refine((value) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return value.includes("/");
  } catch {
    return false;
  }
}, "A reviewed IANA timezone is required");

export const RunEvidenceModeSchema = z.enum(["live", "pinned"]);
export type RunEvidenceMode = z.infer<typeof RunEvidenceModeSchema>;

export const RunEvidenceRequestV1Schema = z.discriminatedUnion("evidenceMode", [
  z.strictObject({
    schemaVersion: z.literal("run-evidence-request-v1"),
    evidenceMode: z.literal("live"),
  }),
  z.strictObject({
    schemaVersion: z.literal("run-evidence-request-v1"),
    evidenceMode: z.literal("pinned"),
    snapshotId: z.string().trim().min(1),
  }),
]);
export type RunEvidenceRequestV1 = z.infer<typeof RunEvidenceRequestV1Schema>;

export const LegacyUnboundEvidenceContextSchema = z.strictObject({
  state: z.literal("legacy_unbound"),
});

export const CurrentRunEvidenceContextV1Schema = z.strictObject({
  state: z.literal("current"),
  schemaVersion: z.literal("run-evidence-context-v1"),
  evidenceMode: RunEvidenceModeSchema,
  windowDays: z.literal(14),
  anchorAt: TimestampSchema,
  windowStartAt: TimestampSchema,
  windowEndAt: TimestampSchema,
  windowTimezone: IanaTimezoneSchema,
  snapshotId: z.string().min(1).nullable(),
  snapshotFingerprint: FingerprintSchema.nullable(),
  contextFingerprint: FingerprintSchema,
}).superRefine((context, refinement) => {
  const pinned = context.evidenceMode === "pinned";
  if (
    pinned !== (context.snapshotId !== null)
    || pinned !== (context.snapshotFingerprint !== null)
  ) {
    refinement.addIssue({
      code: "custom",
      message: "The evidence context has an invalid live/pinned snapshot identity.",
    });
  }
  if (Date.parse(context.windowStartAt) > Date.parse(context.windowEndAt)) {
    refinement.addIssue({ code: "custom", message: "The evidence window is reversed." });
  }
});
export type CurrentRunEvidenceContextV1 = z.infer<
  typeof CurrentRunEvidenceContextV1Schema
>;
export type RunEvidenceContext =
  | z.infer<typeof LegacyUnboundEvidenceContextSchema>
  | CurrentRunEvidenceContextV1;

const SnapshotRequestBaseSchema = z.strictObject({
  schemaVersion: z.literal("market-evidence-snapshot-v1"),
  workspaceId: z.string().trim().min(1),
  id: z.string().trim().min(1),
  snapshotAsOfDate: CalendarDateSchema,
  windowDays: z.literal(14),
  anchorAt: TimestampSchema,
  windowStartAt: TimestampSchema,
  windowEndAt: TimestampSchema,
  windowTimezone: IanaTimezoneSchema,
  events: z.array(WritableMarketEventV2Schema).min(1),
});

export const CreateMarketEvidenceSnapshotRequestV1Schema =
  SnapshotRequestBaseSchema.superRefine((request, refinement) => {
    if (Date.parse(request.windowStartAt) > Date.parse(request.windowEndAt)) {
      refinement.addIssue({ code: "custom", message: "The snapshot window is reversed." });
    }
    try {
      uniqueByCanonicalId(request.events, "snapshot event");
      uniqueByCanonicalId(
        request.events.flatMap((event) => event.sources),
        "snapshot source",
      );
    } catch (error) {
      refinement.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Duplicate evidence identity",
      });
    }
    if (new Set(request.events.map(({ id }) => id)).size !== request.events.length) {
      refinement.addIssue({
        code: "custom",
        message: "Snapshot event IDs must be unique.",
      });
    }
    for (const event of request.events) {
      if (event.sources.some((source) =>
        source.adaptation !== "canonical"
        || source.provenance === "model_inference"
        || source.text.status !== "verified_exact"
      )) {
        refinement.addIssue({
          code: "custom",
          message: "Pinned snapshots require canonical verified source evidence.",
        });
      }
      if (!withinPublicationWindow({
        publishedAt: event.publishedAt,
        publishedAtPrecision: event.publishedAtPrecision,
      }, {
        windowStartAt: request.windowStartAt,
        windowEndAt: request.windowEndAt,
        windowTimezone: request.windowTimezone,
      })) {
        refinement.addIssue({
          code: "custom",
          message: `Event ${event.id} is outside the persisted evidence window.`,
        });
      }
    }
  }).transform((request) => ({
    ...request,
    events: [...request.events].sort((left, right) =>
      compareUtf8(left.id, right.id)
      || compareUtf8(canonicalEvidenceJson(left), canonicalEvidenceJson(right))
    ),
  }));
export type CreateMarketEvidenceSnapshotRequestV1 = z.input<
  typeof CreateMarketEvidenceSnapshotRequestV1Schema
>;
export type ParsedCreateMarketEvidenceSnapshotRequestV1 = z.output<
  typeof CreateMarketEvidenceSnapshotRequestV1Schema
>;

export const MarketEvidenceSnapshotV1Schema = z.strictObject({
  ...SnapshotRequestBaseSchema.shape,
  displayLabel: z.string().min(1),
  eventCount: z.number().int().positive(),
  snapshotFingerprint: FingerprintSchema,
  createdAt: TimestampSchema,
}).superRefine((snapshot, refinement) => {
  if (snapshot.eventCount !== snapshot.events.length) {
    refinement.addIssue({ code: "custom", message: "Snapshot event count mismatch." });
  }
  if (snapshot.displayLabel !== `Demo evidence snapshot as of ${snapshot.snapshotAsOfDate}`) {
    refinement.addIssue({ code: "custom", message: "Snapshot display label mismatch." });
  }
});
export type MarketEvidenceSnapshotV1 = z.infer<
  typeof MarketEvidenceSnapshotV1Schema
>;

export const RunEvidenceBindingV1Schema = z.strictObject({
  schemaVersion: z.literal("run-evidence-binding-v1"),
  workspaceId: z.string().trim().min(1),
  runId: z.string().uuid(),
  evidenceMode: RunEvidenceModeSchema,
  windowDays: z.literal(14),
  anchorAt: TimestampSchema,
  windowStartAt: TimestampSchema,
  windowEndAt: TimestampSchema,
  windowTimezone: IanaTimezoneSchema,
  snapshotId: z.string().min(1).nullable(),
  snapshotFingerprint: FingerprintSchema.nullable(),
  contextFingerprint: FingerprintSchema,
  eventCount: z.number().int().nonnegative(),
  eventSetFingerprint: FingerprintSchema,
  bindingFingerprint: FingerprintSchema,
  displayLabel: z.string().trim().min(1),
  boundAt: TimestampSchema,
  events: z.array(WritableMarketEventV2Schema),
}).superRefine((binding, refinement) => {
  const pinned = binding.evidenceMode === "pinned";
  if (pinned !== (binding.snapshotId !== null)
    || pinned !== (binding.snapshotFingerprint !== null)) {
    refinement.addIssue({ code: "custom", message: "Invalid run binding snapshot identity." });
  }
  if (binding.eventCount !== binding.events.length) {
    refinement.addIssue({ code: "custom", message: "Run binding event count mismatch." });
  }
  if (pinned && binding.eventCount === 0) {
    refinement.addIssue({ code: "custom", message: "Pinned run bindings cannot be empty." });
  }
});
export type RunEvidenceBindingV1 = z.infer<typeof RunEvidenceBindingV1Schema>;

const RUN_EVIDENCE_ROW_FIELDS = [
  "evidence_context_version",
  "evidence_mode",
  "evidence_anchor_at",
  "evidence_window_start_at",
  "evidence_window_end_at",
  "evidence_window_timezone",
  "evidence_snapshot_id",
  "evidence_snapshot_fingerprint",
  "evidence_context_fingerprint",
] as const;

export function parseRunEvidenceContextRow(
  row: Readonly<Record<string, unknown>>,
): RunEvidenceContext {
  const values = RUN_EVIDENCE_ROW_FIELDS.map((field) => row[field] ?? null);
  if (values.every((value) => value === null)) return { state: "legacy_unbound" };
  if (values.slice(0, 6).some((value) => value === null) || values[8] === null) {
    throw new Error("Partial current run evidence context is not readable.");
  }
  const parsed = CurrentRunEvidenceContextV1Schema.safeParse({
    state: "current",
    schemaVersion: row.evidence_context_version,
    evidenceMode: row.evidence_mode,
    windowDays: 14,
    anchorAt: row.evidence_anchor_at,
    windowStartAt: row.evidence_window_start_at,
    windowEndAt: row.evidence_window_end_at,
    windowTimezone: row.evidence_window_timezone,
    snapshotId: row.evidence_snapshot_id ?? null,
    snapshotFingerprint: row.evidence_snapshot_fingerprint ?? null,
    contextFingerprint: row.evidence_context_fingerprint,
  });
  if (!parsed.success) {
    throw new Error("Invalid current run evidence context.", { cause: parsed.error });
  }
  return parsed.data;
}

export const CurrentReportEvidenceContextV1Schema =
  CurrentRunEvidenceContextV1Schema.and(z.strictObject({
    displayLabel: z.string().trim().min(1),
    eventCount: z.number().int().nonnegative(),
    eventSetFingerprint: FingerprintSchema,
    bindingFingerprint: FingerprintSchema,
  }));
export type ReportEvidenceContext =
  | z.infer<typeof LegacyUnboundEvidenceContextSchema>
  | z.infer<typeof CurrentReportEvidenceContextV1Schema>;

const REPORT_EVIDENCE_ROW_FIELDS = [
  "evidence_context_version", "evidence_mode", "evidence_window_days",
  "evidence_anchor_at", "evidence_window_start_at", "evidence_window_end_at",
  "evidence_window_timezone", "evidence_snapshot_id",
  "evidence_snapshot_fingerprint", "evidence_context_fingerprint",
  "evidence_display_label", "evidence_event_count",
  "evidence_event_set_fingerprint", "evidence_binding_fingerprint",
] as const;

export function parseReportEvidenceContextRow(
  row: Readonly<Record<string, unknown>>,
  runContext: RunEvidenceContext,
): ReportEvidenceContext {
  const values = REPORT_EVIDENCE_ROW_FIELDS.map((field) => row[field] ?? null);
  if (values.every((value) => value === null)) {
    if (runContext.state === "current") {
      throw new Error("A current run cannot resolve through a legacy report.");
    }
    return { state: "legacy_unbound" };
  }
  if (runContext.state !== "current") {
    throw new Error("A current report cannot resolve through a legacy run.");
  }
  const parsed = CurrentReportEvidenceContextV1Schema.safeParse({
    state: "current",
    schemaVersion: row.evidence_context_version,
    evidenceMode: row.evidence_mode,
    windowDays: row.evidence_window_days,
    anchorAt: row.evidence_anchor_at,
    windowStartAt: row.evidence_window_start_at,
    windowEndAt: row.evidence_window_end_at,
    windowTimezone: row.evidence_window_timezone,
    snapshotId: row.evidence_snapshot_id ?? null,
    snapshotFingerprint: row.evidence_snapshot_fingerprint ?? null,
    contextFingerprint: row.evidence_context_fingerprint,
    displayLabel: row.evidence_display_label,
    eventCount: row.evidence_event_count,
    eventSetFingerprint: row.evidence_event_set_fingerprint,
    bindingFingerprint: row.evidence_binding_fingerprint,
  });
  if (!parsed.success) {
    throw new Error("Partial or invalid report evidence context.", { cause: parsed.error });
  }
  const report = parsed.data;
  if (
    report.evidenceMode !== runContext.evidenceMode
    || report.anchorAt !== runContext.anchorAt
    || report.windowStartAt !== runContext.windowStartAt
    || report.windowEndAt !== runContext.windowEndAt
    || report.windowTimezone !== runContext.windowTimezone
    || report.snapshotId !== runContext.snapshotId
    || report.snapshotFingerprint !== runContext.snapshotFingerprint
    || report.contextFingerprint !== runContext.contextFingerprint
  ) {
    throw new Error("The report and run evidence context do not match.");
  }
  return report;
}
