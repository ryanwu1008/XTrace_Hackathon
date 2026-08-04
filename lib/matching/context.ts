import type {
  DealMemoryBundle,
  DealInteraction,
  MarketEvent,
  SourceRef,
} from "../contracts/domain";
import {
  assertConsistentCanonicalEvidenceUnits,
  sourceCanGroundOutputFact,
  sourceTextForRetrieval,
  uniqueByCanonicalId,
  type MarketEventV2,
  type SourceRefV2,
} from "../contracts/source-evidence";
import {
  parseMarketEventV2Read,
  parseSourceRefV2Read,
} from "../contracts/legacy-evidence-adapter";
import { SAMPLE_RESEARCH_SCREENING_RECORD_LABEL } from "../contracts/research-candidate";
import { actionsForDealStatusAndDirection } from "../reports/action-policy";
import type {
  MatchingMemoryContext,
  MatchingPriorInteractionCandidate,
} from "./service";

export function interactionSourceV2(
  interaction: DealInteraction,
): SourceRefV2 {
  if (interaction.source) return structuredClone(interaction.source);
  return {
    schemaVersion: "source-ref-v2",
    adaptation: "canonical",
    id: interaction.id,
    provenance: interaction.provenance,
    title: interaction.label,
    canonicalUrl: null,
    documentId: null,
    publisher: "Internal Deal Registry",
    providerId: "deal-registry",
    eventAt: interaction.occurredAt,
    eventAtPrecision: "timestamp",
    publishedAt: null,
    publishedAtPrecision: null,
    retrievedAt: null,
    retrievedAtPrecision: null,
    updatedAt: null,
    updatedAtPrecision: null,
    entityKeys: [],
    sourceClass: "internal_decision_record",
    sourceAuthority: "primary",
    evidenceRole: "context",
    sourceRevisionId: null,
    locator: null,
    contentFingerprint: null,
    text: {
      status: "normalized_only",
      normalizedStatement: [
        interaction.label,
        interaction.summary,
        `Decision reason: ${interaction.decisionReason}`,
        `Concerns: ${interaction.concerns.join(" ") || "None recorded."}`,
        `Revisit conditions: ${interaction.revisitConditions.join(" ") || "None recorded."}`,
      ].join(". "),
    },
  };
}

export function buildStructuredMemoryContexts(
  bundles: DealMemoryBundle[],
): MatchingMemoryContext[] {
  return bundles.map((bundle) => ({
    dealId: bundle.dealId,
    sourceIds: unique(bundle.facts.flatMap((fact) =>
      fact.sources.map((source) => source.id)
    )),
    fixtureIds: unique(bundle.interactions.map((interaction) => interaction.id)),
    interactionCandidates: [
      ...bundle.interactions.map((interaction) => ({
        id: interaction.id,
        occurredAt: interaction.occurredAt,
        sourceIds: [interaction.id],
        revisitConditions: [...interaction.revisitConditions],
        provenance: interaction.provenance,
        label: interaction.label,
        priorActions: interaction.priorActions
          ? structuredClone(interaction.priorActions)
          : undefined,
      })),
      ...researchScreeningPriorCandidates(bundle),
    ],
    text: [
      `${bundle.companyName} is currently recorded as ${bundle.status}.`,
      ...bundle.facts.map((fact) => `Source-backed fact: ${fact.text}`),
      ...bundle.interactions.map((interaction) => [
        `${interaction.label}.`,
        `Summary: ${interaction.summary}`,
        `Decision reason: ${interaction.decisionReason}`,
        `Concerns: ${interaction.concerns.join(" ") || "None recorded."}`,
        `Revisit conditions: ${interaction.revisitConditions.join(" ") || "None recorded."}`,
      ].join(" ")),
    ].join("\n"),
  }));
}

export interface RecalledSourceAuthority {
  sourceIds: readonly string[];
  sourceRevisionIds?: readonly string[];
}

/**
 * XTrace exact-parent lineage persists registry Source IDs, while matching is
 * intentionally expressed in canonical SourceRef IDs. Project between those
 * identities only when one recalled parent proves the exact document/revision
 * pair carried by the Deal-bound SourceRef. Older structured contexts that do
 * not carry revision lineage may preserve an already-canonical SourceRef ID,
 * but cannot project a raw registry identity.
 */
export function projectRecalledCanonicalSourceIds(
  bundle: DealMemoryBundle,
  contexts: readonly RecalledSourceAuthority[],
): string[] {
  const exactParents = new Set(contexts.flatMap((context) => {
    if (
      context.sourceRevisionIds === undefined
      || context.sourceIds.length !== 1
      || context.sourceRevisionIds.length !== 1
    ) return [];
    return [JSON.stringify([
      context.sourceIds[0],
      context.sourceRevisionIds[0],
    ])];
  }));
  const legacyCanonicalIds = new Set(contexts.flatMap((context) =>
    context.sourceRevisionIds === undefined ? [...context.sourceIds] : []
  ));
  const projected = bundle.facts.flatMap((fact) =>
    fact.sources.flatMap((rawSource) => {
      const source = parseSourceRefV2Read(rawSource);
      if (legacyCanonicalIds.has(source.id)) return [source.id];
      if (source.documentId === null || source.sourceRevisionId === null) {
        return [];
      }
      return exactParents.has(JSON.stringify([
          source.documentId,
          source.sourceRevisionId,
        ]))
        ? [source.id]
        : [];
    })
  );
  return unique(projected);
}

export function researchScreeningPriorCandidates(
  bundle: DealMemoryBundle,
  recalledSourceIds?: ReadonlySet<string>,
): MatchingPriorInteractionCandidate[] {
  const candidates = bundle.facts.flatMap((fact) =>
    fact.sources.flatMap((rawSource) => {
      const source = parseSourceRefV2Read(rawSource);
      if (
        !isSampleResearchScreeningAuthoritySource(source)
        || (recalledSourceIds && !recalledSourceIds.has(source.id))
      ) return [];
      const reconsiderationCondition = source.text.status === "normalized_only"
        ? source.text.normalizedStatement.split(
          "Reconsideration conditions: ",
        )[1]?.trim()
        : undefined;
      if (!reconsiderationCondition) return [];
      return [{
        id: source.id,
        occurredAt: source.eventAt!,
        sourceIds: [source.id],
        revisitConditions: [reconsiderationCondition],
        provenance: "source_document" as const,
        label: SAMPLE_RESEARCH_SCREENING_RECORD_LABEL,
        meetingOccurred: false as const,
        vcInteraction: false as const,
        priorActions: actionsForDealStatusAndDirection(bundle.status, "none"),
      }];
    })
  );
  const uniqueCandidates = new Map(candidates.map((candidate) => [
    candidate.id,
    candidate,
  ]));
  return [...uniqueCandidates.values()];
}

export function isSampleResearchScreeningAuthoritySource(
  source: SourceRefV2,
): boolean {
  return source.adaptation === "canonical"
    && source.provenance === "source_document"
    && source.title === SAMPLE_RESEARCH_SCREENING_RECORD_LABEL
    && source.canonicalUrl === null
    && source.documentId !== null
    && source.publisher === "Internal Research Registry"
    && source.providerId !== null
    && source.eventAt !== null
    && source.eventAtPrecision === "timestamp"
    && source.publishedAt === null
    && source.sourceClass === "internal_decision_record"
    && source.sourceAuthority === "primary"
    && source.evidenceRole === "context"
    && source.sourceRevisionId !== null
    && source.locator?.kind === "json_pointer"
    && source.contentFingerprint !== null
    && source.entityKeys.length > 0
    && source.text.status === "normalized_only"
    && source.text.normalizedStatement.startsWith(
      `${SAMPLE_RESEARCH_SCREENING_RECORD_LABEL}. Synthetic research-only context; no meeting or VC interaction occurred.`,
    )
    && sourceCanGroundOutputFact(source)
    && sourceTextForRetrieval(source).includes(
      "Reconsideration conditions: ",
    );
}

export function buildMatchingSources(
  bundles: DealMemoryBundle[],
  events: Array<MarketEvent | MarketEventV2>,
  baselineSources: Array<SourceRef | SourceRefV2> = [],
): SourceRefV2[] {
  const sources: SourceRefV2[] = [
    ...bundles.flatMap((bundle) =>
      bundle.facts.flatMap((fact) => fact.sources.map(parseSourceRefV2Read))
    ),
    ...bundles.flatMap((bundle) =>
      bundle.interactions.map(interactionSourceV2)
    ),
    ...events.flatMap((event): SourceRefV2[] => [
      ...parseMarketEventV2Read(event).sources,
    ]),
    ...baselineSources.map(parseSourceRefV2Read),
  ];
  const uniqueSources = uniqueByCanonicalId<SourceRefV2>(sources, "source");
  assertConsistentCanonicalEvidenceUnits(uniqueSources);
  return uniqueSources;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
