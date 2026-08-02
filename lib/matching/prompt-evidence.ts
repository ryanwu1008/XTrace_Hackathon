import {
  canonicalEvidenceJson,
  sourceCanGroundExactQuote,
  sourceCanGroundOutputFact,
  type MarketEventV2,
  type SourceRefV2,
} from "../contracts/source-evidence";

/**
 * Serialize evidence for a model without collapsing normalized provider prose
 * into a field that can be mistaken for a quotation. The complete v2 metadata
 * remains in the payload so prompt identity binds every evidence field.
 */
export function serializeSourceForReasoner(source: SourceRefV2) {
  const normalizedStatement = source.text.status === "verified_exact"
    ? source.text.normalizedStatement ?? null
    : source.text.normalizedStatement;
  const model = source.text.status === "model_inference"
    ? source.text.model
    : null;

  return {
    schemaVersion: source.schemaVersion,
    adaptation: source.adaptation,
    id: source.id,
    provenance: source.provenance,
    title: source.title,
    canonicalUrl: source.canonicalUrl,
    documentId: source.documentId,
    publisher: source.publisher,
    providerId: source.providerId,
    eventAt: source.eventAt,
    eventAtPrecision: source.eventAtPrecision,
    publishedAt: source.publishedAt,
    publishedAtPrecision: source.publishedAtPrecision,
    retrievedAt: source.retrievedAt,
    retrievedAtPrecision: source.retrievedAtPrecision,
    updatedAt: source.updatedAt,
    updatedAtPrecision: source.updatedAtPrecision,
    entityKeys: source.entityKeys,
    sourceClass: source.sourceClass,
    sourceAuthority: source.sourceAuthority,
    evidenceRole: source.evidenceRole,
    sourceRevisionId: source.sourceRevisionId,
    locator: source.locator,
    contentFingerprint: source.contentFingerprint,
    textStatus: source.text.status,
    quoteEligible: sourceCanGroundExactQuote(source),
    factEligible: sourceCanGroundOutputFact(source),
    verbatimExcerpt: source.text.status === "verified_exact"
      ? source.text.verbatimExcerpt
      : null,
    normalizedStatement,
    model,
  };
}

export function serializeEventForReasoner(event: MarketEventV2) {
  return {
    ...event,
    sources: event.sources.map(serializeSourceForReasoner),
  };
}

export function serializeMatchingEvidence(input: {
  events: MarketEventV2[];
  sources: SourceRefV2[];
}) {
  return {
    marketEvents: input.events.map(serializeEventForReasoner),
    sources: input.sources.map(serializeSourceForReasoner),
  };
}

export function stableEvidencePromptJson(value: unknown): string {
  return canonicalEvidenceJson(value);
}
