import type {
  DealMemoryBundle,
  DealInteraction,
  MarketEvent,
  SourceRef,
} from "../contracts/domain";
import {
  assertConsistentCanonicalEvidenceUnits,
  uniqueByCanonicalId,
  type MarketEventV2,
  type SourceRefV2,
} from "../contracts/source-evidence";
import {
  parseMarketEventV2Read,
  parseSourceRefV2Read,
} from "../contracts/legacy-evidence-adapter";
import type { MatchingMemoryContext } from "./service";

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
    interactionCandidates: bundle.interactions.map((interaction) => ({
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
