import { z } from "zod";

import { compareUtf8 } from "../format/canonical-order";
import { CanonicalHttpUrlSchema } from "../security/safe-url";

const NonEmptyStringSchema = z.string().trim().min(1);
export const MAX_EVIDENCE_TEXT_CHARS = 2_000;
export const MAX_VERBATIM_EXCERPT_WORDS = 25;
const VerbatimExcerptSchema = z.string()
  .max(MAX_EVIDENCE_TEXT_CHARS)
  .refine(
    (value) => value.trim().length > 0,
    "A verbatim excerpt must contain non-whitespace text",
  )
  .refine(
    (value) => value.trim().split(/\s+/u).length <= MAX_VERBATIM_EXCERPT_WORDS,
    `A verbatim excerpt cannot exceed ${MAX_VERBATIM_EXCERPT_WORDS} words`,
  );
const NormalizedStatementSchema = NonEmptyStringSchema.max(
  MAX_EVIDENCE_TEXT_CHARS,
);
const Sha256FingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const EntityKeySchema = z.string().regex(
  /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/,
  "Entity keys must be normalized lowercase identifiers",
);

export const SAMPLE_DECISION_RECORD_LABEL = "Sample decision record" as const;
export const SAMPLE_DECISION_RECORD_PREFIX =
  `${SAMPLE_DECISION_RECORD_LABEL}. ` as const;

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf8);
}

const CanonicalEntityKeysSchema = z.array(EntityKeySchema)
  .transform(sortedUnique);
const CanonicalStringSetSchema = z.array(NonEmptyStringSchema)
  .transform(sortedUnique);

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  (value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime())
      && parsed.toISOString().slice(0, 10) === value;
  },
  "Date-only evidence must be a real ISO calendar date",
);
const OffsetDateTimeSchema = z.string().datetime({ offset: true });
export const TemporalValueV2Schema = z.union([
  IsoDateSchema,
  OffsetDateTimeSchema,
]);
export const TemporalPrecisionV2Schema = z.enum(["date", "timestamp"]);
const NullableTemporalValueSchema = TemporalValueV2Schema.nullable();
const NullableTemporalPrecisionSchema = TemporalPrecisionV2Schema.nullable();

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function temporalBounds(value: string): { earliest: number; latest: number } {
  if (isDateOnly(value)) {
    const earliest = Date.parse(`${value}T00:00:00.000Z`);
    return { earliest, latest: earliest + 24 * 60 * 60 * 1_000 - 1 };
  }
  const instant = Date.parse(value);
  return { earliest: instant, latest: instant };
}

function validateTemporalPair(
  value: string | null,
  precision: "date" | "timestamp" | null,
  label: string,
  context: z.RefinementCtx,
): void {
  const expected = value === null
    ? null
    : isDateOnly(value)
    ? "date"
    : "timestamp";
  if (precision !== expected) {
    context.addIssue({
      code: "custom",
      message: `${label} precision must exactly match its persisted value`,
    });
  }
}

function definitelyBefore(left: string, right: string): boolean {
  return temporalBounds(left).latest < temporalBounds(right).earliest;
}

export const SourceClassV2Schema = z.enum([
  "company_official",
  "government_or_regulator",
  "court_or_public_filing",
  "customer_or_partner_official",
  "investor_official",
  "funding_publication",
  "industry_publication",
  "commercial_database",
  "founder_social",
  "internal_decision_record",
  "model_output",
  "unknown_legacy",
]);

export const SourceAuthorityV2Schema = z.enum([
  "primary",
  "secondary",
  "not_applicable",
  "unknown_legacy",
]);

export const EvidenceRoleV2Schema = z.enum([
  "trigger",
  "corroborating",
  "counterevidence",
  "context",
  "unknown_legacy",
]);

export const SourceLocatorV2Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("web_text"),
    selector: NonEmptyStringSchema,
  }),
  z.strictObject({
    kind: z.literal("document_page"),
    page: z.number().int().positive(),
  }),
  z.strictObject({
    kind: z.literal("json_pointer"),
    pointer: z.string().regex(/^\/(?:[^~/]|~[01])+(?:\/(?:[^~/]|~[01])+)*$/),
  }),
  z.strictObject({
    kind: z.literal("line_range"),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  }).superRefine((locator, context) => {
    if (locator.endLine < locator.startLine) {
      context.addIssue({
        code: "custom",
        message: "A source line range cannot end before it starts",
      });
    }
  }),
]);

const VerifiedExactTextSchema = z.strictObject({
  status: z.literal("verified_exact"),
  verbatimExcerpt: VerbatimExcerptSchema,
  normalizedStatement: NormalizedStatementSchema.optional(),
});

const NormalizedOnlyTextSchema = z.strictObject({
  status: z.literal("normalized_only"),
  normalizedStatement: NormalizedStatementSchema,
});

const LegacyUnverifiedTextSchema = z.strictObject({
  status: z.literal("legacy_unverified"),
  normalizedStatement: NormalizedStatementSchema,
});

const ModelInferenceTextSchema = z.strictObject({
  status: z.literal("model_inference"),
  normalizedStatement: NormalizedStatementSchema,
  model: z.strictObject({
    provider: NonEmptyStringSchema,
    model: NonEmptyStringSchema,
    generatedAt: z.string().datetime({ offset: true }),
    inputFingerprint: Sha256FingerprintSchema,
  }),
});

export const SourceTextV2Schema = z.discriminatedUnion("status", [
  VerifiedExactTextSchema,
  NormalizedOnlyTextSchema,
  LegacyUnverifiedTextSchema,
  ModelInferenceTextSchema,
]);

const EvidenceProvenanceV2Schema = z.enum([
  "source_document",
  "public_web",
  "demo_fixture",
  "model_inference",
]);

const CanonicalSourceRefV2Schema = z.strictObject({
  schemaVersion: z.literal("source-ref-v2"),
  adaptation: z.literal("canonical"),
  id: NonEmptyStringSchema,
  provenance: EvidenceProvenanceV2Schema,
  title: NonEmptyStringSchema,
  canonicalUrl: CanonicalHttpUrlSchema.nullable(),
  documentId: NonEmptyStringSchema.nullable(),
  publisher: NonEmptyStringSchema.nullable(),
  providerId: NonEmptyStringSchema.nullable(),
  eventAt: NullableTemporalValueSchema,
  eventAtPrecision: NullableTemporalPrecisionSchema,
  publishedAt: NullableTemporalValueSchema,
  publishedAtPrecision: NullableTemporalPrecisionSchema,
  retrievedAt: NullableTemporalValueSchema,
  retrievedAtPrecision: NullableTemporalPrecisionSchema,
  updatedAt: NullableTemporalValueSchema,
  updatedAtPrecision: NullableTemporalPrecisionSchema,
  entityKeys: CanonicalEntityKeysSchema,
  sourceClass: SourceClassV2Schema.exclude(["unknown_legacy"]),
  sourceAuthority: SourceAuthorityV2Schema.exclude(["unknown_legacy"]),
  evidenceRole: EvidenceRoleV2Schema.exclude(["unknown_legacy"]),
  sourceRevisionId: NonEmptyStringSchema.nullable(),
  locator: SourceLocatorV2Schema.nullable(),
  contentFingerprint: Sha256FingerprintSchema.nullable(),
  text: z.discriminatedUnion("status", [
    VerifiedExactTextSchema,
    NormalizedOnlyTextSchema,
    ModelInferenceTextSchema,
  ]),
}).superRefine((source, context) => {
  validateTemporalPair(
    source.eventAt,
    source.eventAtPrecision,
    "Event date",
    context,
  );
  validateTemporalPair(
    source.publishedAt,
    source.publishedAtPrecision,
    "Publication date",
    context,
  );
  validateTemporalPair(
    source.retrievedAt,
    source.retrievedAtPrecision,
    "Retrieval date",
    context,
  );
  validateTemporalPair(
    source.updatedAt,
    source.updatedAtPrecision,
    "Update date",
    context,
  );
  if (
    source.provenance === "public_web"
    && (
      source.canonicalUrl === null
      || source.publisher === null
      || source.providerId === null
      || source.retrievedAt === null
      || source.contentFingerprint === null
    )
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Public-web evidence requires a canonical URL, publisher, and provider",
    });
  }
  if (
    source.provenance === "source_document"
    && (
      source.documentId === null
      || source.sourceRevisionId === null
      || source.retrievedAt === null
      || source.contentFingerprint === null
    )
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Source-document evidence requires a document, revision, retrieval date, and content fingerprint",
    });
  }
  if (
    source.provenance === "public_web"
    && (
      source.sourceClass === "internal_decision_record"
      || source.sourceClass === "model_output"
    )
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Public-web evidence cannot use an internal-decision or model-output class",
    });
  }

  if (
    source.publishedAt !== null
    && source.retrievedAt !== null
    && definitelyBefore(source.retrievedAt, source.publishedAt)
  ) {
    context.addIssue({
      code: "custom",
      message: "Evidence cannot be retrieved before publication",
    });
  }
  if (
    source.publishedAt !== null
    && source.updatedAt !== null
    && definitelyBefore(source.updatedAt, source.publishedAt)
  ) {
    context.addIssue({
      code: "custom",
      message: "Evidence cannot be updated before publication",
    });
  }
  if (
    source.retrievedAt !== null
    && source.updatedAt !== null
    && definitelyBefore(source.retrievedAt, source.updatedAt)
  ) {
    context.addIssue({
      code: "custom",
      message: "Evidence cannot include an update newer than its retrieval",
    });
  }

  if (source.text.status === "verified_exact") {
    if (
      source.sourceRevisionId === null
      || source.locator === null
      || source.retrievedAt === null
      || source.contentFingerprint === null
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Verified exact evidence requires a revision, locator, retrieval date, and content fingerprint",
      });
    }
    if (
      source.text.normalizedStatement !== undefined
      && source.text.normalizedStatement === source.text.verbatimExcerpt
    ) {
      context.addIssue({
        code: "custom",
        message: "Normalized text must be distinct from the verbatim excerpt",
      });
    }
  }

  if (source.text.status === "model_inference") {
    if (
      source.provenance !== "model_inference"
      || source.sourceClass !== "model_output"
      || source.sourceAuthority !== "not_applicable"
      || source.evidenceRole !== "context"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Model inference requires model provenance, model-output class, not-applicable authority, and context role",
      });
    }
  } else if (
    source.provenance === "model_inference"
    || source.sourceClass === "model_output"
    || source.sourceAuthority === "not_applicable"
  ) {
    context.addIssue({
      code: "custom",
      message: "Model provenance and class require model-inference text",
    });
  }

  if (source.provenance === "demo_fixture") {
    if (
      source.title !== SAMPLE_DECISION_RECORD_LABEL
      || source.sourceClass !== "internal_decision_record"
      || source.sourceAuthority !== "primary"
      || source.evidenceRole !== "context"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A demo fixture must remain a primary internal Sample decision record with context role",
      });
    }
    if (
      source.text.status !== "normalized_only"
      || !source.text.normalizedStatement.startsWith(
        SAMPLE_DECISION_RECORD_PREFIX,
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A demo fixture must use normalized-only text beginning with the exact Sample decision record. prefix",
      });
    }
  }
});

const LegacyAdaptedSourceRefV2Schema = z.strictObject({
  schemaVersion: z.literal("source-ref-v2"),
  adaptation: z.literal("legacy_read"),
  id: NonEmptyStringSchema,
  provenance: EvidenceProvenanceV2Schema,
  title: NonEmptyStringSchema,
  canonicalUrl: z.string().url().nullable(),
  documentId: NonEmptyStringSchema.nullable(),
  publisher: NonEmptyStringSchema.nullable(),
  providerId: z.null(),
  eventAt: z.null(),
  eventAtPrecision: z.null(),
  publishedAt: NullableTemporalValueSchema,
  publishedAtPrecision: NullableTemporalPrecisionSchema,
  retrievedAt: z.null(),
  retrievedAtPrecision: z.null(),
  updatedAt: z.null(),
  updatedAtPrecision: z.null(),
  entityKeys: z.array(z.never()).length(0),
  sourceClass: z.literal("unknown_legacy"),
  sourceAuthority: z.literal("unknown_legacy"),
  evidenceRole: z.literal("unknown_legacy"),
  sourceRevisionId: NonEmptyStringSchema.nullable(),
  locator: SourceLocatorV2Schema.nullable(),
  contentFingerprint: z.null(),
  text: LegacyUnverifiedTextSchema,
}).superRefine((source, context) => {
  validateTemporalPair(
    source.publishedAt,
    source.publishedAtPrecision,
    "Publication date",
    context,
  );
});

export const SourceRefV2Schema = z.union([
  CanonicalSourceRefV2Schema,
  LegacyAdaptedSourceRefV2Schema,
]);

type CanonicalSourceRefV2Internal = z.infer<
  typeof CanonicalSourceRefV2Schema
>;

function canonicalSourceRevisionPayload(
  source: CanonicalSourceRefV2Internal,
) {
  return {
    provenance: source.provenance,
    canonicalUrl: source.canonicalUrl,
    documentId: source.documentId,
    eventAt: source.eventAt,
    eventAtPrecision: source.eventAtPrecision,
    publishedAt: source.publishedAt,
    publishedAtPrecision: source.publishedAtPrecision,
    updatedAt: source.updatedAt,
    updatedAtPrecision: source.updatedAtPrecision,
    sourceRevisionId: source.sourceRevisionId,
    contentFingerprint: source.contentFingerprint,
  };
}

export function canonicalSourceRevisionIdentityKey(
  source: z.infer<typeof SourceRefV2Schema>,
): string | null {
  if (source.adaptation !== "canonical") return null;
  if (source.sourceRevisionId !== null) {
    return canonicalEvidenceJson({
      kind: "source_revision",
      sourceRevisionId: source.sourceRevisionId,
    });
  }
  if (source.provenance === "public_web") {
    return canonicalEvidenceJson({
      kind: "public_web_observation",
      ...canonicalSourceRevisionPayload(source),
    });
  }
  if (source.provenance === "demo_fixture") {
    return canonicalEvidenceJson({ kind: "demo_fixture", id: source.id });
  }
  if (source.provenance === "model_inference") {
    return canonicalEvidenceJson({ kind: "model_inference", id: source.id });
  }
  return canonicalEvidenceJson({
    kind: "canonical_source_fallback",
    id: source.id,
  });
}

export function canonicalSourceRevisionPayloadKey(
  source: z.infer<typeof SourceRefV2Schema>,
): string | null {
  return source.adaptation === "canonical"
    ? canonicalEvidenceJson(canonicalSourceRevisionPayload(source))
    : null;
}

export function canonicalIntrinsicEvidenceUnitKey(
  source: z.infer<typeof SourceRefV2Schema>,
): string | null {
  const revisionIdentity = canonicalSourceRevisionIdentityKey(source);
  return revisionIdentity === null
    ? null
    : canonicalEvidenceJson({
        revisionIdentity,
        locator: source.locator,
        unlocatedNormalizedText:
          source.adaptation === "canonical"
            && source.locator === null
            && source.text.status !== "verified_exact"
            ? source.text
            : null,
      });
}

function canonicalEvidenceRoleSemantics(
  source: CanonicalSourceRefV2Internal,
): string {
  return source.evidenceRole === "trigger"
      || source.evidenceRole === "corroborating"
    ? "supporting"
    : source.evidenceRole;
}

export function canonicalSourceEvidenceObservationKey(
  source: z.infer<typeof SourceRefV2Schema>,
): string | null {
  if (source.adaptation !== "canonical") return null;
  return canonicalEvidenceJson({
    intrinsicUnit: canonicalIntrinsicEvidenceUnitKey(source),
    revisionPayload: canonicalSourceRevisionPayloadKey(source),
    title: source.title,
    publisher: source.publisher,
    sourceClass: source.sourceClass,
    sourceAuthority: source.sourceAuthority,
    entityKeys: source.entityKeys,
    text: source.text,
    evidenceRole: canonicalEvidenceRoleSemantics(source),
  });
}

export function assertConsistentCanonicalEvidenceUnits(
  sources: readonly z.infer<typeof SourceRefV2Schema>[],
  options: { allowEquivalentAcquisitions?: boolean } = {},
): void {
  const payloadByRevision = new Map<string, string>();
  const observationByUnit = new Map<string, {
    observationKey: string;
    sourceIds: Set<string>;
  }>();
  for (const source of sources) {
    if (source.adaptation !== "canonical") continue;
    const revisionIdentity = canonicalSourceRevisionIdentityKey(source)!;
    const revisionPayload = canonicalSourceRevisionPayloadKey(source)!;
    const priorPayload = payloadByRevision.get(revisionIdentity);
    if (priorPayload !== undefined && priorPayload !== revisionPayload) {
      throw new Error(
        "Conflicting immutable provenance for one canonical source revision.",
      );
    }
    payloadByRevision.set(revisionIdentity, revisionPayload);

    const unitKey = canonicalIntrinsicEvidenceUnitKey(source)!;
    const observationKey = canonicalSourceEvidenceObservationKey(source)!;
    const prior = observationByUnit.get(unitKey);
    if (prior === undefined) {
      observationByUnit.set(unitKey, {
        observationKey,
        sourceIds: new Set([source.id]),
      });
      continue;
    }
    if (prior.observationKey !== observationKey) {
      throw new Error(
        "Conflicting evidence metadata, text, or role for one intrinsic evidence unit.",
      );
    }
    if (
      !options.allowEquivalentAcquisitions
      && !prior.sourceIds.has(source.id)
    ) {
      throw new Error(
        "The same intrinsic evidence unit cannot use multiple canonical source IDs.",
      );
    }
    prior.sourceIds.add(source.id);
  }
}

const CanonicalMarketEventV2Schema = z.strictObject({
  schemaVersion: z.literal("market-event-v2"),
  adaptation: z.literal("canonical"),
  id: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  eventType: NonEmptyStringSchema,
  sectors: CanonicalStringSetSchema,
  themes: CanonicalStringSetSchema,
  summary: NonEmptyStringSchema,
  positiveImplications: CanonicalStringSetSchema,
  negativeImplications: CanonicalStringSetSchema,
  eventAt: NullableTemporalValueSchema,
  eventAtPrecision: NullableTemporalPrecisionSchema,
  publishedAt: TemporalValueV2Schema,
  publishedAtPrecision: TemporalPrecisionV2Schema,
  retrievedAt: TemporalValueV2Schema,
  retrievedAtPrecision: TemporalPrecisionV2Schema,
  updatedAt: NullableTemporalValueSchema,
  updatedAtPrecision: NullableTemporalPrecisionSchema,
  confidence: z.enum(["low", "medium", "high"]),
  canonicalUrl: CanonicalHttpUrlSchema,
  providerId: NonEmptyStringSchema,
  contentFingerprint: Sha256FingerprintSchema,
  entityKeys: CanonicalEntityKeysSchema,
  triggerSourceId: NonEmptyStringSchema,
  sources: z.array(CanonicalSourceRefV2Schema).min(1).transform((sources) =>
    [...sources].sort((left, right) => {
      const leftTriggerRank = left.evidenceRole === "trigger" ? 0 : 1;
      const rightTriggerRank = right.evidenceRole === "trigger" ? 0 : 1;
      return leftTriggerRank - rightTriggerRank
        || compareUtf8(left.id, right.id)
        || compareUtf8(canonicalEvidenceJson(left), canonicalEvidenceJson(right));
    })
  ),
}).superRefine((event, context) => {
  validateTemporalPair(
    event.eventAt,
    event.eventAtPrecision,
    "Event date",
    context,
  );
  validateTemporalPair(
    event.publishedAt,
    event.publishedAtPrecision,
    "Publication date",
    context,
  );
  validateTemporalPair(
    event.retrievedAt,
    event.retrievedAtPrecision,
    "Retrieval date",
    context,
  );
  validateTemporalPair(
    event.updatedAt,
    event.updatedAtPrecision,
    "Update date",
    context,
  );
  const sourceIds = event.sources.map((source) => source.id);
  if (new Set(sourceIds).size !== sourceIds.length) {
    context.addIssue({ code: "custom", message: "Source IDs must be unique" });
  }
  try {
    assertConsistentCanonicalEvidenceUnits(event.sources);
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error
        ? error.message
        : "Market-event evidence units must be unique and consistent",
    });
  }

  const triggerRoleSources = event.sources.filter(
    (source) => source.evidenceRole === "trigger",
  );
  if (triggerRoleSources.length !== 1) {
    context.addIssue({
      code: "custom",
      message: "A market event must contain exactly one trigger-role source",
    });
  }

  const trigger = event.sources.find(
    (source) => source.id === event.triggerSourceId,
  );
  if (!trigger || trigger.evidenceRole !== "trigger") {
    context.addIssue({
      code: "custom",
      message: "The trigger source must resolve to a trigger-role source",
    });
    return;
  }
  if (trigger.provenance !== "public_web") {
    context.addIssue({
      code: "custom",
      message: "A market-event trigger must be public-web evidence",
    });
  }
  if (
    trigger.canonicalUrl !== event.canonicalUrl
    || trigger.eventAt !== event.eventAt
    || trigger.eventAtPrecision !== event.eventAtPrecision
    || trigger.publishedAt !== event.publishedAt
    || trigger.publishedAtPrecision !== event.publishedAtPrecision
    || trigger.retrievedAt !== event.retrievedAt
    || trigger.retrievedAtPrecision !== event.retrievedAtPrecision
    || trigger.updatedAt !== event.updatedAt
    || trigger.updatedAtPrecision !== event.updatedAtPrecision
    || trigger.providerId !== event.providerId
  ) {
    context.addIssue({
      code: "custom",
      message: "Market-event provenance must match its trigger source",
    });
  }

  const sourceEntityKeys = sortedUnique(
    event.sources.flatMap((source) => source.entityKeys),
  );
  if (
    sourceEntityKeys.length !== event.entityKeys.length
    || sourceEntityKeys.some((key, index) => key !== event.entityKeys[index])
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Market-event entity keys must exactly equal the union of all source entity keys",
    });
  }

  if (event.sources.some((source) =>
    source.provenance === "demo_fixture"
    || source.provenance === "model_inference"
    || source.sourceClass === "internal_decision_record"
    || source.sourceClass === "model_output"
  )) {
    context.addIssue({
      code: "custom",
      message:
        "Market events cannot embed synthetic, model, or internal-decision evidence",
    });
  }

  if (definitelyBefore(event.retrievedAt, event.publishedAt)) {
    context.addIssue({
      code: "custom",
      message: "A market event cannot be retrieved before publication",
    });
  }
  if (
    event.updatedAt !== null
    && definitelyBefore(event.updatedAt, event.publishedAt)
  ) {
    context.addIssue({
      code: "custom",
      message: "A market event cannot be updated before publication",
    });
  }
  if (
    event.updatedAt !== null
    && definitelyBefore(event.retrievedAt, event.updatedAt)
  ) {
    context.addIssue({
      code: "custom",
      message: "A market event cannot include an update newer than retrieval",
    });
  }
});

const LegacyAdaptedMarketEventV2Schema = z.strictObject({
  schemaVersion: z.literal("market-event-v2"),
  adaptation: z.literal("legacy_read"),
  id: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  eventType: NonEmptyStringSchema,
  sectors: z.array(NonEmptyStringSchema),
  themes: z.array(NonEmptyStringSchema),
  summary: NonEmptyStringSchema,
  positiveImplications: z.array(NonEmptyStringSchema),
  negativeImplications: z.array(NonEmptyStringSchema),
  eventAt: z.null(),
  eventAtPrecision: z.null(),
  publishedAt: NullableTemporalValueSchema,
  publishedAtPrecision: NullableTemporalPrecisionSchema,
  retrievedAt: NullableTemporalValueSchema,
  retrievedAtPrecision: NullableTemporalPrecisionSchema,
  updatedAt: NullableTemporalValueSchema,
  updatedAtPrecision: NullableTemporalPrecisionSchema,
  confidence: z.enum(["low", "medium", "high"]),
  canonicalUrl: z.string().url().nullable(),
  providerId: NonEmptyStringSchema.nullable(),
  contentFingerprint: Sha256FingerprintSchema.nullable(),
  entityKeys: z.array(EntityKeySchema),
  triggerSourceId: z.null(),
  sources: z.array(LegacyAdaptedSourceRefV2Schema).min(1),
}).superRefine((event, context) => {
  validateTemporalPair(
    event.publishedAt,
    event.publishedAtPrecision,
    "Publication date",
    context,
  );
  validateTemporalPair(
    event.retrievedAt,
    event.retrievedAtPrecision,
    "Retrieval date",
    context,
  );
  validateTemporalPair(
    event.updatedAt,
    event.updatedAtPrecision,
    "Update date",
    context,
  );
  if (new Set(event.entityKeys).size !== event.entityKeys.length) {
    context.addIssue({ code: "custom", message: "Entity keys must be unique" });
  }
  const sourceIds = event.sources.map((source) => source.id);
  if (new Set(sourceIds).size !== sourceIds.length) {
    context.addIssue({ code: "custom", message: "Source IDs must be unique" });
  }
  if (
    event.publishedAt !== null
    && event.retrievedAt !== null
    && definitelyBefore(event.retrievedAt, event.publishedAt)
  ) {
    context.addIssue({
      code: "custom",
      message: "Legacy evidence cannot be retrieved before publication",
    });
  }
  if (
    event.publishedAt !== null
    && event.updatedAt !== null
    && definitelyBefore(event.updatedAt, event.publishedAt)
  ) {
    context.addIssue({
      code: "custom",
      message: "Legacy evidence cannot be updated before publication",
    });
  }
  if (
    event.retrievedAt !== null
    && event.updatedAt !== null
    && definitelyBefore(event.retrievedAt, event.updatedAt)
  ) {
    context.addIssue({
      code: "custom",
      message: "Legacy evidence cannot include an update newer than retrieval",
    });
  }
});

export const MarketEventV2Schema = z.union([
  CanonicalMarketEventV2Schema,
  LegacyAdaptedMarketEventV2Schema,
]);

export const WritableSourceRefV2Schema = CanonicalSourceRefV2Schema;
export const WritableMarketEventV2Schema = CanonicalMarketEventV2Schema;

export type SourceRefV2 = z.infer<typeof SourceRefV2Schema>;
export type WritableSourceRefV2 = z.infer<typeof WritableSourceRefV2Schema>;
export type MarketEventV2 = z.infer<typeof MarketEventV2Schema>;
export type WritableMarketEventV2 = z.infer<typeof WritableMarketEventV2Schema>;
export type SourceClassV2 = z.infer<typeof SourceClassV2Schema>;
export type SourceAuthorityV2 = z.infer<typeof SourceAuthorityV2Schema>;
export type EvidenceRoleV2 = z.infer<typeof EvidenceRoleV2Schema>;
export type TemporalPrecisionV2 = z.infer<typeof TemporalPrecisionV2Schema>;
export type ExactQuoteSourceRefV2 = Extract<
  SourceRefV2,
  { adaptation: "canonical" }
> & {
  text: Extract<SourceRefV2["text"], { status: "verified_exact" }>;
};

export function sourceCanGroundExactQuote(
  source: SourceRefV2,
): source is ExactQuoteSourceRefV2 {
  return source.adaptation === "canonical"
    && source.text.status === "verified_exact";
}

export function sourceCanGroundOutputFact(source: SourceRefV2): boolean {
  return source.adaptation === "canonical"
    && (
      source.provenance !== "public_web"
      || (
        source.canonicalUrl !== null
        && source.publisher !== null
        && source.providerId !== null
        && source.retrievedAt !== null
        && source.contentFingerprint !== null
      )
    )
    && (
      source.provenance !== "source_document"
      || (
        source.documentId !== null
        && source.sourceRevisionId !== null
        && source.retrievedAt !== null
        && source.contentFingerprint !== null
      )
    )
    && (
      source.text.status === "verified_exact"
      || source.text.status === "normalized_only"
    );
}

export function sourceClaimSupportKind(
  source: SourceRefV2,
  claim: string,
): "exact_quote" | "normalized_non_quote" | null {
  if (!sourceCanGroundOutputFact(source)) return null;
  if (source.text.status === "verified_exact") {
    if (source.text.verbatimExcerpt === claim) return "exact_quote";
    if (source.text.normalizedStatement === claim) {
      return "normalized_non_quote";
    }
    return null;
  }
  return source.text.normalizedStatement === claim
    ? "normalized_non_quote"
    : null;
}

export function sourceTextForRetrieval(source: SourceRefV2): string {
  return source.text.status === "verified_exact"
    ? source.text.normalizedStatement ?? source.text.verbatimExcerpt
    : source.text.normalizedStatement;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => compareUtf8(left, right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

export function canonicalEvidenceJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function uniqueByCanonicalId<T extends { id: string }>(
  items: readonly T[],
  label: string,
): T[] {
  const byId = new Map<string, { item: T; canonical: string }>();
  for (const item of items) {
    const canonical = canonicalEvidenceJson(item);
    const existing = byId.get(item.id);
    if (existing && existing.canonical !== canonical) {
      throw new TypeError(`Conflicting ${label} ID: ${item.id}`);
    }
    if (!existing) byId.set(item.id, { item, canonical });
  }
  return [...byId.values()].map(({ item }) => item);
}
