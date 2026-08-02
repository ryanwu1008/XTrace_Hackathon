import {
  MarketEventSchema,
  SourceRefSchema,
  type SourceRef,
} from "./domain";
import {
  MarketEventV2Schema,
  SourceRefV2Schema,
  type MarketEventV2,
  type SourceRefV2,
} from "./source-evidence";
import { assertMarketEventFingerprint } from "../market/identity";
import { z } from "zod";

const LegacyNormalizedEventMetadataSchema = z.object({
  canonicalUrl: z.string().url().optional(),
  retrievedAt: z.string().datetime({ offset: true }).optional(),
  updatedAt: z.string().datetime({ offset: true }).optional(),
  providerId: z.string().trim().min(1).optional(),
  entityKeys: z.array(z.string().regex(
    /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/,
  )).optional(),
  contentChecksum: z.string().optional(),
});

function hasDeclaredSchemaVersion(input: unknown): boolean {
  return typeof input === "object"
    && input !== null
    && Object.prototype.hasOwnProperty.call(input, "schemaVersion");
}

export function adaptLegacySourceRef(input: SourceRef): SourceRefV2 {
  const source = SourceRefSchema.parse(input);
  return SourceRefV2Schema.parse({
    schemaVersion: "source-ref-v2",
    adaptation: "legacy_read",
    id: source.id,
    provenance: source.provenance,
    title: source.title,
    canonicalUrl: source.url ?? null,
    documentId: source.documentId ?? null,
    publisher: source.publisher ?? null,
    providerId: null,
    eventAt: null,
    eventAtPrecision: null,
    publishedAt: source.publishedAt ?? null,
    publishedAtPrecision: source.publishedAt ? "timestamp" : null,
    retrievedAt: null,
    retrievedAtPrecision: null,
    updatedAt: null,
    updatedAtPrecision: null,
    entityKeys: [],
    sourceClass: "unknown_legacy",
    sourceAuthority: "unknown_legacy",
    evidenceRole: "unknown_legacy",
    sourceRevisionId: source.sourceRevisionId ?? null,
    locator: source.page === undefined
      ? null
      : { kind: "document_page", page: source.page },
    contentFingerprint: null,
    text: {
      status: "legacy_unverified",
      normalizedStatement: source.excerpt,
    },
  });
}

export function parseSourceRefV2Read(input: unknown): SourceRefV2 {
  const current = SourceRefV2Schema.safeParse(input);
  if (current.success) return current.data;
  if (hasDeclaredSchemaVersion(input)) {
    throw current.error;
  }
  return adaptLegacySourceRef(SourceRefSchema.parse(input));
}

export function adaptLegacyMarketEvent(input: unknown): MarketEventV2 {
  const event = MarketEventSchema.parse(input);
  const metadata = LegacyNormalizedEventMetadataSchema.parse(input);
  const sources = event.sources.map(adaptLegacySourceRef);
  const contentFingerprint = metadata.contentChecksum !== undefined
    && /^[0-9a-f]{64}$/.test(metadata.contentChecksum)
    ? `sha256:${metadata.contentChecksum}`
    : metadata.contentChecksum !== undefined
      && /^sha256:[0-9a-f]{64}$/.test(metadata.contentChecksum)
      ? metadata.contentChecksum
      : null;
  return MarketEventV2Schema.parse({
    schemaVersion: "market-event-v2",
    adaptation: "legacy_read",
    id: event.id,
    title: event.title,
    eventType: event.eventType,
    sectors: event.sectors,
    themes: event.themes,
    summary: event.summary,
    positiveImplications: event.positiveImplications,
    negativeImplications: event.negativeImplications,
    eventAt: null,
    eventAtPrecision: null,
    publishedAt: event.publishedAt,
    publishedAtPrecision: "timestamp",
    retrievedAt: metadata.retrievedAt ?? null,
    retrievedAtPrecision: metadata.retrievedAt ? "timestamp" : null,
    updatedAt: metadata.updatedAt ?? null,
    updatedAtPrecision: metadata.updatedAt ? "timestamp" : null,
    confidence: event.confidence,
    canonicalUrl: metadata.canonicalUrl
      ?? event.sources.find((source) => source.url)?.url
      ?? null,
    providerId: metadata.providerId ?? null,
    contentFingerprint,
    entityKeys: metadata.entityKeys ?? [],
    triggerSourceId: null,
    sources,
  });
}

export function parseMarketEventV2Read(input: unknown): MarketEventV2 {
  const current = MarketEventV2Schema.safeParse(input);
  if (current.success) {
    return current.data.adaptation === "canonical"
      ? assertMarketEventFingerprint(current.data)
      : current.data;
  }
  if (hasDeclaredSchemaVersion(input)) {
    throw current.error;
  }
  return adaptLegacyMarketEvent(input);
}
