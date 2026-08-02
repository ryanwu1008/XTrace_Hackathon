import { createHash } from "node:crypto";

import {
  assertConsistentCanonicalEvidenceUnits,
  canonicalEvidenceJson,
  MarketEventV2Schema,
  TemporalValueV2Schema,
  uniqueByCanonicalId,
  WritableMarketEventV2Schema,
  type MarketEventV2,
  type SourceRefV2,
} from "../contracts/source-evidence";
import { compareUtf8 } from "../format/canonical-order";
import { parseMarketEventV2Read } from "../contracts/legacy-evidence-adapter";
import {
  assertMarketEventFingerprint,
  reidentifyMarketEvent,
  reidentifySourceRef,
} from "./identity";
import type {
  MarketConfidence,
  NormalizedMarketEvent,
} from "./types";
import { canonicalizeHttpUrl } from "../security/safe-url";
import {
  canonicalDocumentObservationKey,
  canonicalMarketObservationKey,
} from "./observation";

const CONFIDENCE_RANK: Record<MarketConfidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export function canonicalizeUrl(value: string): string {
  return canonicalizeHttpUrl(value);
}

export function assertCanonicalMarketEventUrls(
  event: NormalizedMarketEvent,
): NormalizedMarketEvent {
  if (canonicalizeUrl(event.canonicalUrl) !== event.canonicalUrl) {
    throw new Error(
      `Canonical market event ${event.id} contains a non-canonical URL.`,
    );
  }
  for (const source of event.sources) {
    if (
      source.canonicalUrl !== null
      && canonicalizeUrl(source.canonicalUrl) !== source.canonicalUrl
    ) {
      throw new Error(
        `Canonical source ${source.id} contains a non-canonical URL.`,
      );
    }
  }
  return event;
}

export function withinPublicationWindow(
  publishedAt: string,
  now: Date,
  days: number,
): boolean {
  const upperBound = now.getTime();
  if (
    !Number.isFinite(upperBound)
    || !Number.isFinite(days)
    || days <= 0
  ) {
    return false;
  }

  const lowerBound = upperBound - days * 24 * 60 * 60 * 1_000;
  if (/^\d{4}-\d{2}-\d{2}$/.test(publishedAt)) {
    const earliest = Date.parse(`${publishedAt}T00:00:00.000Z`);
    if (
      !Number.isFinite(earliest)
      || new Date(earliest).toISOString().slice(0, 10) !== publishedAt
    ) return false;
    const latest = earliest + 24 * 60 * 60 * 1_000 - 1;
    return latest >= lowerBound && earliest <= upperBound;
  }
  if (!TemporalValueV2Schema.safeParse(publishedAt).success) return false;
  const publicationTime = Date.parse(publishedAt);
  return Number.isFinite(publicationTime)
    && publicationTime >= lowerBound
    && publicationTime <= upperBound;
}

export const withinWindow = withinPublicationWindow;

function normalizedTitleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean),
  );
}

function titleSimilarity(left: string, right: string): number {
  const leftTokens = normalizedTitleTokens(left);
  const rightTokens = normalizedTitleTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }

  return intersection / new Set([...leftTokens, ...rightTokens]).size;
}

function publicationDay(event: MarketEventV2): string | null {
  return event.publishedAt?.slice(0, 10) ?? null;
}

function sharesEntity(
  left: MarketEventV2,
  right: MarketEventV2,
): boolean {
  const rightEntities = new Set(right.entityKeys);
  return left.entityKeys.some((entity) => rightEntities.has(entity));
}

function eventsMatch(
  left: MarketEventV2,
  right: MarketEventV2,
): boolean {
  // A legacy read projection cannot be promoted by merging it into canonical
  // evidence. Keep both records and let a writer reject the legacy payload.
  if (left.adaptation !== right.adaptation) return false;
  const sameDates = left.eventAt === right.eventAt
    && left.publishedAt !== null
    && left.publishedAt === right.publishedAt;
  const sameCanonicalUrl = left.canonicalUrl !== null
    && right.canonicalUrl !== null
    && canonicalizeUrl(left.canonicalUrl) === canonicalizeUrl(right.canonicalUrl);
  if (sameCanonicalUrl) {
    if (!sameDates) return false;
    if (left.adaptation === "canonical" && right.adaptation === "canonical") {
      return canonicalMarketObservationKey(left)
        === canonicalMarketObservationKey(right);
    }
    return true;
  }
  if (
    sameDates
    && left.contentFingerprint !== null
    && left.contentFingerprint.length > 0
    && left.contentFingerprint === right.contentFingerprint
  ) {
    return true;
  }

  const leftDay = publicationDay(left);
  const rightDay = publicationDay(right);
  if (leftDay === null || rightDay === null || leftDay !== rightDay) {
    return false;
  }
  if (
    left.eventAt === null
    || right.eventAt === null
    || left.eventAt !== right.eventAt
    || left.eventAtPrecision !== right.eventAtPrecision
  ) {
    return false;
  }

  if (
    left.entityKeys.length === 0
    || right.entityKeys.length === 0
    || !sharesEntity(left, right)
    || left.eventType !== right.eventType
  ) {
    return false;
  }

  const similarity = titleSimilarity(left.title, right.title);
  return similarity >= 0.75;
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort(compareUtf8);
}

function preferredEvent(
  left: MarketEventV2,
  right: MarketEventV2,
): MarketEventV2 {
  if (CONFIDENCE_RANK[right.confidence] !== CONFIDENCE_RANK[left.confidence]) {
    return CONFIDENCE_RANK[right.confidence] > CONFIDENCE_RANK[left.confidence]
      ? right
      : left;
  }
  if (right.sources.length !== left.sources.length) {
    return right.sources.length > left.sources.length ? right : left;
  }
  const leftRetrievedAt = left.retrievedAt === null
    ? Number.NEGATIVE_INFINITY
    : Date.parse(left.retrievedAt);
  const rightRetrievedAt = right.retrievedAt === null
    ? Number.NEGATIVE_INFINITY
    : Date.parse(right.retrievedAt);
  if (rightRetrievedAt !== leftRetrievedAt) {
    return rightRetrievedAt > leftRetrievedAt ? right : left;
  }
  const leftProvider = left.providerId ?? "\uffff";
  const rightProvider = right.providerId ?? "\uffff";
  if (leftProvider !== rightProvider) {
    return compareUtf8(rightProvider, leftProvider) < 0 ? right : left;
  }
  return compareUtf8(
      canonicalEvidenceJson(right),
      canonicalEvidenceJson(left),
    ) < 0
    ? right
    : left;
}

function mergeCanonicalSources(
  sources: readonly SourceRefV2[],
  preferredTriggerSourceId: string,
): { sources: SourceRefV2[]; triggerSourceId: string } {
  assertConsistentCanonicalEvidenceUnits(sources, {
    allowEquivalentAcquisitions: true,
  });
  const groups = new Map<string, SourceRefV2[]>();
  for (const source of sources) {
    const observationKey = canonicalDocumentObservationKey(source)
      ?? `legacy:${source.id}`;
    groups.set(observationKey, [
      ...(groups.get(observationKey) ?? []),
      source,
    ]);
  }

  let triggerSourceId: string | null = null;
  const mergedSources = [...groups.entries()]
    .sort(([left], [right]) => compareUtf8(left, right))
    .map(([, group]) => {
      const containsPreferredTrigger = group.some(
        (source) => source.id === preferredTriggerSourceId,
      );
      const ordered = [...group].sort((left, right) => {
        const leftPreferred = left.id === preferredTriggerSourceId ? 0 : 1;
        const rightPreferred = right.id === preferredTriggerSourceId ? 0 : 1;
        return leftPreferred - rightPreferred
          || compareUtf8(
            left.providerId ?? "\uffff",
            right.providerId ?? "\uffff",
          )
          || compareUtf8(
            canonicalEvidenceJson(left),
            canonicalEvidenceJson(right),
          );
      });
      const base = ordered[0]!;
      if (base.adaptation !== "canonical") return base;
      const evidenceRole = containsPreferredTrigger
        ? "trigger" as const
        : group.some((source) => source.evidenceRole === "counterevidence")
        ? "counterevidence" as const
        : "corroborating" as const;
      const entityKeys = unique(group.flatMap((source) => source.entityKeys));
      const merged = base.evidenceRole === evidenceRole
          && canonicalEvidenceJson(base.entityKeys)
            === canonicalEvidenceJson(entityKeys)
        ? base
        : reidentifySourceRef({
            ...base,
            evidenceRole,
            entityKeys,
          });
      if (containsPreferredTrigger) triggerSourceId = merged.id;
      return merged;
    });

  if (triggerSourceId === null) {
    throw new Error("A merged canonical market event lost its trigger source.");
  }
  return { sources: mergedSources, triggerSourceId };
}

function assertNoCanonicalEvidenceMetadataConflicts(
  sources: readonly SourceRefV2[],
): void {
  assertConsistentCanonicalEvidenceUnits(sources, {
    allowEquivalentAcquisitions: true,
  });
}

function compareAcquisitionSources(left: SourceRefV2, right: SourceRefV2) {
  return compareUtf8(left.providerId ?? "\uffff", right.providerId ?? "\uffff")
    || compareUtf8(canonicalEvidenceJson(left), canonicalEvidenceJson(right));
}

function rewriteCanonicalTrigger(
  event: Extract<MarketEventV2, { adaptation: "canonical" }>,
  representative: Extract<SourceRefV2, { adaptation: "canonical" }>,
): Extract<MarketEventV2, { adaptation: "canonical" }> {
  const current = event.sources.find((source) =>
    source.id === event.triggerSourceId
  );
  if (!current || current.evidenceRole !== "trigger") {
    throw new Error("Canonical acquisition coalescence requires a trigger source.");
  }
  if (current.id === representative.id) return event;
  if (representative.evidenceRole !== "trigger") {
    throw new Error(
      "Equivalent acquisition sources with different edge roles cannot be coalesced.",
    );
  }
  return reidentifyMarketEvent({
    ...event,
    canonicalUrl: representative.canonicalUrl!,
    providerId: representative.providerId!,
    eventAt: representative.eventAt,
    eventAtPrecision: representative.eventAtPrecision,
    publishedAt: representative.publishedAt!,
    publishedAtPrecision: representative.publishedAtPrecision!,
    retrievedAt: representative.retrievedAt!,
    retrievedAtPrecision: representative.retrievedAtPrecision!,
    updatedAt: representative.updatedAt,
    updatedAtPrecision: representative.updatedAtPrecision,
    triggerSourceId: representative.id,
    sources: event.sources.map((source) =>
      source.id === current.id ? representative : source
    ),
  });
}

function triggerRepresentativeByObservation(
  events: readonly MarketEventV2[],
): Map<string, Extract<SourceRefV2, { adaptation: "canonical" }>> {
  const representatives = new Map<
    string,
    Extract<SourceRefV2, { adaptation: "canonical" }>
  >();
  for (const event of events) {
    if (event.adaptation !== "canonical") continue;
    const trigger = event.sources.find((source) =>
      source.id === event.triggerSourceId
    );
    if (!trigger || trigger.adaptation !== "canonical") continue;
    const key = canonicalDocumentObservationKey(trigger);
    if (key === null) continue;
    const prior = representatives.get(key);
    if (prior && prior.id !== trigger.id) {
      throw new Error(
        "Durable market evidence contains multiple acquisition representatives for one intrinsic evidence unit.",
      );
    }
    representatives.set(key, trigger);
  }
  return representatives;
}

/**
 * Keep semantic event variants while ensuring acquisition feeds do not create
 * multiple source identities for the same underlying trigger document.
 */
export function coalesceEquivalentTriggerAcquisitions(
  events: readonly MarketEventV2[],
  preferredEvents: readonly MarketEventV2[] = [],
): MarketEventV2[] {
  const allSources = [...preferredEvents, ...events].flatMap(
    (event): SourceRefV2[] => [...event.sources],
  );
  assertConsistentCanonicalEvidenceUnits(allSources, {
    allowEquivalentAcquisitions: true,
  });
  const preferred = triggerRepresentativeByObservation(preferredEvents);
  const occurrences = new Map<string, Array<{
    event: Extract<MarketEventV2, { adaptation: "canonical" }>;
    source: Extract<SourceRefV2, { adaptation: "canonical" }>;
    isTrigger: boolean;
  }>>();
  for (const event of events) {
    if (event.adaptation !== "canonical") continue;
    for (const source of event.sources) {
      const key = canonicalDocumentObservationKey(source);
      if (key === null) continue;
      occurrences.set(key, [
        ...(occurrences.get(key) ?? []),
        { event, source, isTrigger: source.id === event.triggerSourceId },
      ]);
    }
  }

  const representatives = new Map(preferred);
  for (const [key, group] of occurrences) {
    const distinctIds = new Set(group.map(({ source }) => source.id));
    const preferredSource = preferred.get(key);
    if (preferredSource) distinctIds.add(preferredSource.id);
    if (
      distinctIds.size > 1
      && group.some(({ source, isTrigger }) =>
        !isTrigger || source.evidenceRole !== "trigger"
      )
    ) {
      throw new Error(
        "Equivalent acquisition sources with different edge roles cannot be coalesced.",
      );
    }
    representatives.set(
      key,
      preferredSource
        ?? [...group].map(({ source }) => source)
          .sort(compareAcquisitionSources)[0]!,
    );
  }

  const rewritten = events.map((event): MarketEventV2 => {
    if (event.adaptation !== "canonical") return event;
    const trigger = event.sources.find((source) =>
      source.id === event.triggerSourceId
    )!;
    const key = canonicalDocumentObservationKey(trigger);
    const representative = key === null ? undefined : representatives.get(key);
    return representative
      ? rewriteCanonicalTrigger(event, representative)
      : event;
  });
  assertConsistentCanonicalEvidenceUnits(
    [...preferredEvents, ...rewritten].flatMap(
      (event): SourceRefV2[] => [...event.sources],
    ),
  );
  return uniqueByCanonicalId(rewritten, "market event");
}

function mergeEvents(
  left: MarketEventV2,
  right: MarketEventV2,
): MarketEventV2 {
  const preferred = preferredEvent(left, right);
  const mergedSources = uniqueByCanonicalId(
    [...left.sources, ...right.sources],
    "source",
  );
  const canonicalSourceMerge = preferred.adaptation === "canonical"
    ? mergeCanonicalSources(mergedSources, preferred.triggerSourceId)
    : null;
  const sources = canonicalSourceMerge?.sources ?? mergedSources;

  const merged = {
    ...preferred,
    canonicalUrl: preferred.canonicalUrl === null
      ? null
      : canonicalizeUrl(preferred.canonicalUrl),
    sectors: unique([...left.sectors, ...right.sectors]),
    themes: unique([...left.themes, ...right.themes]),
    positiveImplications: unique([
      ...left.positiveImplications,
      ...right.positiveImplications,
    ]),
    negativeImplications: unique([
      ...left.negativeImplications,
      ...right.negativeImplications,
    ]),
    entityKeys: unique(sources.flatMap((source) => source.entityKeys)),
    triggerSourceId: canonicalSourceMerge?.triggerSourceId
      ?? preferred.triggerSourceId,
    sources,
  };
  if (preferred.adaptation === "canonical") {
    return reidentifyMarketEvent(WritableMarketEventV2Schema.parse(merged));
  }
  const identityPayload = { ...merged };
  delete (identityPayload as Partial<MarketEventV2>).id;
  delete (identityPayload as Partial<MarketEventV2>).contentFingerprint;
  const digest = createHash("sha256")
    .update(canonicalEvidenceJson(identityPayload), "utf8")
    .digest("hex");
  const mergedWithIdentity = {
    ...merged,
    id: `market_${digest.slice(0, 24)}`,
    contentFingerprint: `sha256:${digest}`,
  };
  return MarketEventV2Schema.parse(mergedWithIdentity);
}

export function dedupeEvents(
  events: readonly NormalizedMarketEvent[],
): NormalizedMarketEvent[];
export function dedupeEvents(
  events: readonly unknown[],
): MarketEventV2[];
export function dedupeEvents(events: readonly unknown[]): MarketEventV2[] {
  const parsedEvents = events.map(parseMarketEventV2Read)
    .sort((left, right) =>
      compareUtf8(canonicalEvidenceJson(left), canonicalEvidenceJson(right))
    );
  for (const event of parsedEvents) {
    if (event.adaptation === "canonical") {
      assertCanonicalMarketEventUrls(
        assertMarketEventFingerprint(
          WritableMarketEventV2Schema.parse(event),
        ),
      );
    }
  }
  const collisionCheckedEvents = uniqueByCanonicalId<MarketEventV2>(
    parsedEvents,
    "market event",
  );
  uniqueByCanonicalId<SourceRefV2>(
    collisionCheckedEvents.flatMap((event): SourceRefV2[] => [
      ...event.sources,
    ]),
    "source",
  );
  assertNoCanonicalEvidenceMetadataConflicts(
    collisionCheckedEvents.flatMap((event): SourceRefV2[] => [
      ...event.sources,
    ]),
  );
  const deduplicated: MarketEventV2[] = [];

  for (const event of collisionCheckedEvents) {
    const canonicalEvent = event;
    const matchIndex = deduplicated.findIndex((candidate) => (
      eventsMatch(candidate, canonicalEvent)
    ));

    if (matchIndex === -1) {
      deduplicated.push(canonicalEvent);
      continue;
    }

    deduplicated[matchIndex] = mergeEvents(
      deduplicated[matchIndex],
      canonicalEvent,
    );
  }

  const collisionCheckedResult = uniqueByCanonicalId<MarketEventV2>(
    coalesceEquivalentTriggerAcquisitions(deduplicated),
    "market event",
  );
  uniqueByCanonicalId<SourceRefV2>(
    collisionCheckedResult.flatMap((event): SourceRefV2[] => [
      ...event.sources,
    ]),
    "source",
  );
  return collisionCheckedResult.sort((left, right) =>
    compareUtf8(right.publishedAt ?? "", left.publishedAt ?? "")
      || compareUtf8(
        canonicalEvidenceJson(left),
        canonicalEvidenceJson(right),
      )
  );
}
