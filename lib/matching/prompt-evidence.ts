import {
  canonicalEvidenceJson,
  sourceCanGroundExactQuote,
  sourceCanGroundOutputFact,
  type MarketEventV2,
  type SourceRefV2,
} from "../contracts/source-evidence";
import type { BeliefAction, DealStatus } from "../contracts/domain";
import type { MatchingPriorInteractionCandidate } from "./service";

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
    schemaVersion: event.schemaVersion,
    adaptation: event.adaptation,
    id: event.id,
    title: event.title,
    eventType: event.eventType,
    sectors: event.sectors,
    themes: event.themes,
    summary: event.summary,
    eventAt: event.eventAt,
    eventAtPrecision: event.eventAtPrecision,
    publishedAt: event.publishedAt,
    publishedAtPrecision: event.publishedAtPrecision,
    retrievedAt: event.retrievedAt,
    retrievedAtPrecision: event.retrievedAtPrecision,
    updatedAt: event.updatedAt,
    updatedAtPrecision: event.updatedAtPrecision,
    confidence: event.confidence,
    canonicalUrl: event.canonicalUrl,
    providerId: event.providerId,
    contentFingerprint: event.contentFingerprint,
    entityKeys: event.entityKeys,
    triggerSourceId: event.triggerSourceId,
    sources: event.sources.map(serializeSourceForReasoner),
  };
}

function serializeActionForReasoner(action: BeliefAction) {
  return {
    kind: action.kind,
    scope: action.scope,
    priority: action.priority,
    visibility: action.visibility,
  };
}

export function serializeDealForReasoner(deal: {
  id: string;
  companyName: string;
  status: DealStatus;
}) {
  return {
    id: deal.id,
    companyName: deal.companyName,
    status: deal.status,
  };
}

export function serializeMemoryContextForReasoner(context: {
  dealId: string;
  text: string;
  sourceIds: string[];
  fixtureIds: string[];
  interactionCandidates?: MatchingPriorInteractionCandidate[];
}) {
  return {
    dealId: context.dealId,
    text: context.text,
    sourceIds: context.sourceIds,
    fixtureIds: context.fixtureIds,
    interactionCandidates: (context.interactionCandidates ?? []).map(
      (candidate) => ({
        id: candidate.id,
        occurredAt: candidate.occurredAt,
        sourceIds: candidate.sourceIds,
        revisitConditions: candidate.revisitConditions,
        provenance: candidate.provenance,
        label: candidate.label,
        ...(candidate.provenance === "source_document"
          ? {
              meetingOccurred: candidate.meetingOccurred,
              vcInteraction: candidate.vcInteraction,
            }
          : {}),
        priorActions: candidate.priorActions?.map(serializeActionForReasoner)
          ?? null,
      }),
    ),
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

export function serializeMatchingPromptInput(input: {
  deals: Array<{ id: string; companyName: string; status: DealStatus }>;
  events: MarketEventV2[];
  memoryContexts: Array<Parameters<typeof serializeMemoryContextForReasoner>[0]>;
  sources: SourceRefV2[];
}) {
  const evidence = serializeMatchingEvidence(input);
  return {
    deals: input.deals.map(serializeDealForReasoner),
    marketEvents: evidence.marketEvents,
    memoryContexts: input.memoryContexts.map(serializeMemoryContextForReasoner),
    sources: evidence.sources,
  };
}

export function stableEvidencePromptJson(value: unknown): string {
  return canonicalEvidenceJson(value);
}
