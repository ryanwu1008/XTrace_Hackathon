import { createHash } from "node:crypto";

import type { SourceRegistry } from "../../db/repositories/source-registry";
import { loadBeliefReversalManifest } from "../../lib/belief-reversal/manifest";
import {
  buildBeliefReversalResearchPublicSourceRef,
  buildBeliefReversalSelectedPublicSourceRef,
} from "../../lib/belief-reversal/public-source-ref";
import {
  type WritableMarketEventV2,
} from "../../lib/contracts/source-evidence";
import { reidentifyMarketEvent } from "../../lib/market/identity";
import { withinPublicationWindow } from "../../lib/market/dedupe";
import type { MarketService } from "../../lib/market/service";
import type {
  MarketFetchWindow,
  MarketProvider,
  RawSourceItem,
} from "../../lib/market/types";

export const BELIEF_REVERSAL_LIVE_MARKET_PROVIDER_ID =
  "belief_reversal_loopback_market_v1" as const;

type BeliefReversalManifest = ReturnType<typeof loadBeliefReversalManifest>;
type SelectedResearchSource =
  BeliefReversalManifest["selectedCases"][number]["sources"][number];
type ScreeningResearchSource =
  BeliefReversalManifest["screeningSources"][number];
type ResolvedScreeningResearchSource = Extract<
  ScreeningResearchSource,
  { status: "resolved" }
>;
type LiveMarketSource = SelectedResearchSource | ResolvedScreeningResearchSource;

export interface BeliefReversalLiveMarketPacket {
  schemaVersion: "belief-reversal-live-market-packet-v1";
  packageId: string;
  sourceSnapshot:
    | {
      schemaVersion: "belief-reversal-public-source-snapshot-v1";
      caseId: string;
    }
    | {
      schemaVersion: "belief-reversal-research-source-snapshot-v1";
      candidateId: string;
    };
  event: {
    id: string;
    eventType: string;
    title: string;
    summary: string;
    sectors: string[];
    themes: string[];
    positiveImplications: string[];
    negativeImplications: string[];
    eventAt: string | null;
    publishedAt: string;
    retrievedAt: string;
    confidence: "low" | "medium" | "high";
    entityKeys: string[];
    triggerSourceId: string;
    sourceIds: string[];
  };
  sources: LiveMarketSource[];
  sourceRefIds: Record<string, string>;
  collectedAt: string;
}

/**
 * Builds the controlled public-provider payload independently from the pinned
 * market snapshot. The live acceptance Worker must collect this payload over
 * loopback HTTP and pass it through the production MarketService normalizer.
 */
export function buildBeliefReversalLiveMarketSourceItems(input: {
  retrievedAt: string;
}): RawSourceItem[] {
  const retrievedAt = new Date(input.retrievedAt);
  if (!Number.isFinite(retrievedAt.getTime())) {
    throw new Error("The live market fixture requires a valid retrieval time.");
  }
  return buildBeliefReversalLiveMarketPackets({
    collectedAt: retrievedAt.toISOString(),
  }).map((packet) => {
      const trigger = packet.sources.find(
        (source) => source.id === packet.event.triggerSourceId,
      );
      if (!trigger) {
        throw new Error(
          `Live market fixture event ${packet.event.id} has no reviewed trigger source.`,
        );
      }
      return {
        providerId: BELIEF_REVERSAL_LIVE_MARKET_PROVIDER_ID,
        externalId: packet.event.id,
        title: packet.event.title,
        url: trigger.canonicalUrl,
        publisher: trigger.publisher,
        sourceClass: trigger.sourceClass,
        sourceAuthority: trigger.sourceAuthority,
        evidenceRole: "trigger" as const,
        eventAt: packet.event.eventAt ?? undefined,
        publishedAt: packet.event.publishedAt,
        retrievedAt: retrievedAt.toISOString(),
        summary: packet.event.summary,
        normalizedStatement: trigger.normalizedStatement,
        eventType: packet.event.eventType,
        entities: [...packet.event.entityKeys],
        sectors: [...packet.event.sectors],
        themes: [...packet.event.themes],
        positiveImplications: [...packet.event.positiveImplications],
        negativeImplications: [...packet.event.negativeImplications],
        confidence: packet.event.confidence,
      } satisfies RawSourceItem;
    });
}

export function buildBeliefReversalLiveMarketPackets(input: {
  collectedAt: string;
}): BeliefReversalLiveMarketPacket[] {
  const collectedAt = new Date(input.collectedAt);
  if (!Number.isFinite(collectedAt.getTime())) {
    throw new Error("The live market packet fixture requires a valid collection time.");
  }
  const manifest = loadBeliefReversalManifest();
  const selectedPackets = manifest.selectedCases.flatMap((selectedCase) =>
    selectedCase.events.map((event) => ({
      schemaVersion: "belief-reversal-live-market-packet-v1" as const,
      packageId: manifest.packageId,
      sourceSnapshot: {
        schemaVersion: "belief-reversal-public-source-snapshot-v1" as const,
        caseId: selectedCase.id,
      },
      event: {
        ...event,
        sectors: [...event.sectors],
        themes: [...event.themes],
        positiveImplications: [...event.positiveImplications],
        negativeImplications: [...event.negativeImplications],
        entityKeys: [...event.entityKeys],
        sourceIds: [...event.sourceIds],
      },
      sources: selectedCase.sources.filter((source) =>
        event.sourceIds.includes(source.id)
      ),
      sourceRefIds: Object.fromEntries(selectedCase.sources.map((source) => [
        source.id,
        source.supportedClaimId,
      ])),
      collectedAt: collectedAt.toISOString(),
    }))
  );
  const researchPackets = manifest.candidateLedger.flatMap((candidate) => {
    if (
      candidate.disposition !== "qualified_not_selected"
      || candidate.triggeringEvent.status !== "resolved"
    ) return [];
    const resolvedSources = manifest.screeningSources.filter(
      (source): source is ResolvedScreeningResearchSource =>
        source.status === "resolved" && source.candidateId === candidate.id,
    );
    const trigger = resolvedSources.find(
      ({ id }) => id === candidate.triggeringEvent.sourceId,
    );
    if (
      !trigger
      || trigger.eventAt === null
      || trigger.publishedAt === null
    ) {
      throw new Error(
        `Live research fixture candidate ${candidate.id} has no resolved trigger source.`,
      );
    }
    const eventSources = resolvedSources.filter((source) =>
      source.evidenceRole !== "trigger" || source.id === trigger.id
    );
    return [{
      schemaVersion: "belief-reversal-live-market-packet-v1" as const,
      packageId: manifest.packageId,
      sourceSnapshot: {
        schemaVersion: "belief-reversal-research-source-snapshot-v1" as const,
        candidateId: candidate.id,
      },
      event: {
        id: `event_research_${candidate.id.replace(/^candidate_/u, "")}`,
        eventType: "funding",
        title: candidate.triggeringEvent.title,
        summary: trigger.normalizedStatement,
        sectors: ["research_screening"],
        themes: ["funding"],
        positiveImplications: [],
        negativeImplications: [],
        eventAt: trigger.eventAt,
        publishedAt: trigger.publishedAt,
        retrievedAt: trigger.retrievedAt,
        confidence: "medium" as const,
        entityKeys: [...candidate.entityKeys],
        triggerSourceId: trigger.id,
        sourceIds: eventSources.map(({ id }) => id),
      },
      sources: eventSources,
      sourceRefIds: Object.fromEntries(eventSources.map((source) => [
        source.id,
        researchEvidenceId(source.id),
      ])),
      collectedAt: collectedAt.toISOString(),
    }];
  });
  return [...selectedPackets, ...researchPackets];
}

export function createBeliefReversalRegistryGroundedLiveMarketService(input: {
  sourceUrl: string;
  sourceRegistry: Pick<SourceRegistry, "getRevision">;
  workspaceId: string;
  fetchImpl?: typeof fetch;
}): MarketService {
  const sourceUrl = exactLoopbackUrl(input.sourceUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  const manifest = loadBeliefReversalManifest();
  return {
    async scanMarketWindow(options = {}) {
      const days = options.days ?? 14;
      if (!Number.isInteger(days) || days !== 14) {
        throw new Error("Cold live acceptance requires the exact 14-day window.");
      }
      const to = options.now ?? new Date();
      const retrievedAt = options.retrievedAt ?? to;
      if (!Number.isFinite(to.getTime()) || !Number.isFinite(retrievedAt.getTime())) {
        throw new Error("Cold live acceptance requires valid scan timestamps.");
      }
      const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1_000);
      const requestUrl = new URL(sourceUrl);
      requestUrl.searchParams.set("from", from.toISOString());
      requestUrl.searchParams.set("to", to.toISOString());
      const response = await fetchImpl(requestUrl, {
        method: "GET",
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(
          `Controlled canonical market source failed with HTTP ${response.status}.`,
        );
      }
      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) {
        throw new Error("Controlled canonical market source returned a non-array payload.");
      }
      const packets = payload as BeliefReversalLiveMarketPacket[];
      const events: WritableMarketEventV2[] = [];
      for (const packet of packets) {
        if (
          packet?.schemaVersion !== "belief-reversal-live-market-packet-v1"
          || packet.collectedAt !== to.toISOString()
          || !packet.event
          || !Array.isArray(packet.sources)
        ) {
          throw new Error("Controlled canonical market packet is malformed or stale.");
        }
        const publishedAt = Date.parse(packet.event.publishedAt);
        const latestPublishedAt = /^\d{4}-\d{2}-\d{2}$/u.test(
            packet.event.publishedAt,
          )
          ? publishedAt + 24 * 60 * 60 * 1_000 - 1
          : publishedAt;
        if (!Number.isFinite(publishedAt)) {
          throw new Error("Controlled canonical market event has no valid publication date.");
        }
        if (publishedAt > to.getTime()) {
          throw new Error("Controlled canonical market event is future-dated.");
        }
        if (latestPublishedAt < from.getTime()) continue;
        const sourceRefs = await Promise.all(packet.sources.map(async (source) => {
          const sourceRevisionId = `source_revision_${source.id}_1`;
          const revision = await input.sourceRegistry.getRevision({
            workspaceId: input.workspaceId,
            revisionId: sourceRevisionId,
          });
          const expectedSnapshot = packet.sourceSnapshot.schemaVersion
              === "belief-reversal-public-source-snapshot-v1"
            ? {
              schemaVersion: packet.sourceSnapshot.schemaVersion,
              packageId: packet.packageId,
              caseId: packet.sourceSnapshot.caseId,
              source: selectedSourceSnapshot(source),
            }
            : {
              schemaVersion: packet.sourceSnapshot.schemaVersion,
              packageId: packet.packageId,
              candidateId: packet.sourceSnapshot.candidateId,
              source,
            };
          const expectedHash = sha256CanonicalSnapshot(expectedSnapshot);
          const revisionHash = revision?.contentHash.startsWith("sha256:")
            ? revision.contentHash.slice("sha256:".length)
            : revision?.contentHash;
          if (
            !revision
            || revision.sourceId !== source.id
            || revisionHash !== expectedHash
          ) {
            throw new Error(
              `Collected live source ${source.id} did not match its immutable Source Revision.`,
            );
          }
          const canonical = "supportedClaimId" in source
            ? buildBeliefReversalSelectedPublicSourceRef({
              manifest,
              source,
              revision,
            })
            : buildBeliefReversalResearchPublicSourceRef({
              source,
              revision,
            });
          if (canonical.id !== packet.sourceRefIds[source.id]) {
            throw new Error(
              `Collected live source ${source.id} did not resolve its canonical evidence identity.`,
            );
          }
          return canonical;
        }));
        const trigger = sourceRefs.find((source) =>
          source.documentId === packet.event.triggerSourceId
        );
        if (!trigger) {
          throw new Error("Controlled canonical event lost its trigger source.");
        }
        const canonicalEvent = reidentifyMarketEvent({
          schemaVersion: "market-event-v2",
          adaptation: "canonical",
          title: packet.event.title,
          eventType: packet.event.eventType,
          sectors: [...packet.event.sectors],
          themes: [...packet.event.themes],
          summary: packet.event.summary,
          positiveImplications: [...packet.event.positiveImplications],
          negativeImplications: [...packet.event.negativeImplications],
          eventAt: trigger.eventAt ?? trigger.publishedAt,
          eventAtPrecision: trigger.eventAtPrecision
            ?? trigger.publishedAtPrecision,
          publishedAt: trigger.publishedAt!,
          publishedAtPrecision: trigger.publishedAtPrecision!,
          retrievedAt: retrievedAt.toISOString(),
          retrievedAtPrecision: "timestamp",
          updatedAt: null,
          updatedAtPrecision: null,
          confidence: packet.event.confidence,
          canonicalUrl: trigger.canonicalUrl!,
          providerId: BELIEF_REVERSAL_LIVE_MARKET_PROVIDER_ID,
          entityKeys: [...packet.event.entityKeys],
          triggerSourceId: trigger.id,
          sources: sourceRefs,
        });
        if (!withinPublicationWindow({
          publishedAt: canonicalEvent.publishedAt,
          publishedAtPrecision: canonicalEvent.publishedAtPrecision,
        }, {
          windowStartAt: from.toISOString(),
          windowEndAt: to.toISOString(),
          windowTimezone: "America/Los_Angeles",
        })) continue;
        events.push(canonicalEvent);
      }
      return {
        status: "completed",
        window: {
          from: from.toISOString(),
          to: to.toISOString(),
          days,
        },
        events,
        providers: [{
          providerId: BELIEF_REVERSAL_LIVE_MARKET_PROVIDER_ID,
          providerName: "Belief-reversal controlled canonical loopback source",
          fetchedCount: packets.length,
          acceptedCount: events.length,
          rejectedCount: packets.length - events.length,
          lastSuccessAt: retrievedAt.toISOString(),
        }],
      };
    },
  };
}

function researchEvidenceId(sourceId: string): string {
  if (!/^source_[a-z0-9_]+_v\d+$/u.test(sourceId)) {
    throw new Error(`Research source id ${sourceId} is not stable.`);
  }
  return sourceId.replace(/^source_/u, "research_evidence_");
}

function selectedSourceSnapshot(source: LiveMarketSource) {
  if (!("supportedClaimId" in source)) {
    throw new Error(
      `Selected-case source snapshot received research source ${source.id}.`,
    );
  }
  return {
    id: source.id,
    title: source.title,
    publisher: source.publisher,
    canonicalUrl: source.canonicalUrl,
    sourceClass: source.sourceClass,
    sourceAuthority: source.sourceAuthority,
    evidenceRole: source.evidenceRole,
    entityKeys: [...source.entityKeys],
    eventAt: source.eventAt,
    publishedAt: source.publishedAt,
    publicationTimestamp: source.publicationTimestamp,
    retrievedAt: source.retrievedAt,
    locator: source.locator,
    verbatimExcerpt: source.verbatimExcerpt,
    normalizedStatement: source.normalizedStatement,
    supportedClaimId: source.supportedClaimId,
  };
}

export function createBeliefReversalLoopbackMarketProvider(input: {
  sourceUrl: string;
  fetchImpl?: typeof fetch;
}): MarketProvider {
  const sourceUrl = exactLoopbackUrl(input.sourceUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  return {
    id: BELIEF_REVERSAL_LIVE_MARKET_PROVIDER_ID,
    name: "Belief-reversal controlled loopback public source",
    async fetch(window: MarketFetchWindow): Promise<RawSourceItem[]> {
      const requestUrl = new URL(sourceUrl);
      requestUrl.searchParams.set("from", window.from.toISOString());
      requestUrl.searchParams.set("to", window.to.toISOString());
      const response = await fetchImpl(requestUrl, {
        method: "GET",
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(
          `Controlled loopback market source failed with HTTP ${response.status}.`,
        );
      }
      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) {
        throw new Error("Controlled loopback market source returned a non-array payload.");
      }
      return payload as RawSourceItem[];
    },
  };
}

function exactLoopbackUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Controlled market source must be an exact loopback URL.");
  }
  if (
    url.protocol !== "http:"
    || url.hostname !== "127.0.0.1"
    || !url.port
    || url.username
    || url.password
    || url.hash
  ) {
    throw new Error("Controlled market source must be an exact loopback URL.");
  }
  return url;
}

function sha256CanonicalSnapshot(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, canonical(child)]),
      );
    }
    return item;
  };
  return createHash("sha256")
    .update(`${JSON.stringify(canonical(value))}\n`, "utf8")
    .digest("hex");
}
