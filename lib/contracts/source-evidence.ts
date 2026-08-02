import { z } from "zod";

const NonEmptyStringSchema = z.string().trim().min(1);
const NullableDateTimeSchema = z.string().datetime({ offset: true }).nullable();
const Sha256FingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const EntityKeySchema = z.string().regex(
  /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/,
  "Entity keys must be normalized lowercase identifiers",
);

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
  verbatimExcerpt: NonEmptyStringSchema,
  normalizedStatement: NonEmptyStringSchema.optional(),
});

const NormalizedOnlyTextSchema = z.strictObject({
  status: z.literal("normalized_only"),
  normalizedStatement: NonEmptyStringSchema,
});

const LegacyUnverifiedTextSchema = z.strictObject({
  status: z.literal("legacy_unverified"),
  normalizedStatement: NonEmptyStringSchema,
});

const ModelInferenceTextSchema = z.strictObject({
  status: z.literal("model_inference"),
  normalizedStatement: NonEmptyStringSchema,
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
  canonicalUrl: z.string().url().nullable(),
  documentId: NonEmptyStringSchema.nullable(),
  publisher: NonEmptyStringSchema.nullable(),
  providerId: NonEmptyStringSchema.nullable(),
  eventAt: NullableDateTimeSchema,
  publishedAt: NullableDateTimeSchema,
  retrievedAt: NullableDateTimeSchema,
  updatedAt: NullableDateTimeSchema,
  entityKeys: z.array(EntityKeySchema),
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
  if (new Set(source.entityKeys).size !== source.entityKeys.length) {
    context.addIssue({ code: "custom", message: "Entity keys must be unique" });
  }

  if (
    source.provenance === "public_web"
    && (
      source.canonicalUrl === null
      || source.publisher === null
      || source.providerId === null
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
    source.publishedAt !== null
    && source.retrievedAt !== null
    && Date.parse(source.retrievedAt) < Date.parse(source.publishedAt)
  ) {
    context.addIssue({
      code: "custom",
      message: "Evidence cannot be retrieved before publication",
    });
  }
  if (
    source.publishedAt !== null
    && source.updatedAt !== null
    && Date.parse(source.updatedAt) < Date.parse(source.publishedAt)
  ) {
    context.addIssue({
      code: "custom",
      message: "Evidence cannot be updated before publication",
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
  publishedAt: NullableDateTimeSchema,
  retrievedAt: z.null(),
  updatedAt: z.null(),
  entityKeys: z.array(z.never()).length(0),
  sourceClass: z.literal("unknown_legacy"),
  sourceAuthority: z.literal("unknown_legacy"),
  evidenceRole: z.literal("unknown_legacy"),
  sourceRevisionId: NonEmptyStringSchema.nullable(),
  locator: SourceLocatorV2Schema.nullable(),
  contentFingerprint: z.null(),
  text: LegacyUnverifiedTextSchema,
});

export const SourceRefV2Schema = z.union([
  CanonicalSourceRefV2Schema,
  LegacyAdaptedSourceRefV2Schema,
]);

const CanonicalMarketEventV2Schema = z.strictObject({
  schemaVersion: z.literal("market-event-v2"),
  adaptation: z.literal("canonical"),
  id: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  eventType: NonEmptyStringSchema,
  sectors: z.array(NonEmptyStringSchema),
  themes: z.array(NonEmptyStringSchema),
  summary: NonEmptyStringSchema,
  positiveImplications: z.array(NonEmptyStringSchema),
  negativeImplications: z.array(NonEmptyStringSchema),
  eventAt: NullableDateTimeSchema,
  publishedAt: z.string().datetime({ offset: true }),
  retrievedAt: z.string().datetime({ offset: true }),
  updatedAt: NullableDateTimeSchema,
  confidence: z.enum(["low", "medium", "high"]),
  canonicalUrl: z.string().url(),
  providerId: NonEmptyStringSchema,
  contentFingerprint: Sha256FingerprintSchema,
  entityKeys: z.array(EntityKeySchema),
  triggerSourceId: NonEmptyStringSchema,
  sources: z.array(CanonicalSourceRefV2Schema).min(1),
}).superRefine((event, context) => {
  if (new Set(event.entityKeys).size !== event.entityKeys.length) {
    context.addIssue({ code: "custom", message: "Entity keys must be unique" });
  }
  const sourceIds = event.sources.map((source) => source.id);
  if (new Set(sourceIds).size !== sourceIds.length) {
    context.addIssue({ code: "custom", message: "Source IDs must be unique" });
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
  if (
    trigger.canonicalUrl !== event.canonicalUrl
    || trigger.eventAt !== event.eventAt
    || trigger.publishedAt !== event.publishedAt
    || trigger.retrievedAt !== event.retrievedAt
    || trigger.updatedAt !== event.updatedAt
    || trigger.providerId !== event.providerId
  ) {
    context.addIssue({
      code: "custom",
      message: "Market-event provenance must match its trigger source",
    });
  }

  if (trigger.entityKeys.some((key) => !event.entityKeys.includes(key))) {
    context.addIssue({
      code: "custom",
      message: "Market-event entity keys must include every trigger entity key",
    });
  }

  if (Date.parse(event.retrievedAt) < Date.parse(event.publishedAt)) {
    context.addIssue({
      code: "custom",
      message: "A market event cannot be retrieved before publication",
    });
  }
  if (
    event.updatedAt !== null
    && Date.parse(event.updatedAt) < Date.parse(event.publishedAt)
  ) {
    context.addIssue({
      code: "custom",
      message: "A market event cannot be updated before publication",
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
  publishedAt: NullableDateTimeSchema,
  retrievedAt: NullableDateTimeSchema,
  updatedAt: NullableDateTimeSchema,
  confidence: z.enum(["low", "medium", "high"]),
  canonicalUrl: z.string().url().nullable(),
  providerId: NonEmptyStringSchema.nullable(),
  contentFingerprint: Sha256FingerprintSchema.nullable(),
  entityKeys: z.array(EntityKeySchema),
  triggerSourceId: z.null(),
  sources: z.array(LegacyAdaptedSourceRefV2Schema).min(1),
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

export function sourceCanGroundExactQuote(source: SourceRefV2): boolean {
  return source.adaptation === "canonical"
    && source.text.status === "verified_exact";
}

export function sourceCanGroundOutputFact(source: SourceRefV2): boolean {
  return source.adaptation === "canonical"
    && (
      source.text.status === "verified_exact"
      || source.text.status === "normalized_only"
    );
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
        .sort(([left], [right]) => left.localeCompare(right))
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
