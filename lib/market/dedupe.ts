import { createHash } from "node:crypto";

import {
  canonicalEvidenceJson,
  MarketEventV2Schema,
  uniqueByCanonicalId,
  WritableMarketEventV2Schema,
  type MarketEventV2,
} from "../contracts/source-evidence";
import { parseMarketEventV2Read } from "../contracts/legacy-evidence-adapter";
import { reidentifyMarketEvent } from "./identity";
import type {
  MarketConfidence,
  NormalizedMarketEvent,
} from "./types";

const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
]);

const CONFIDENCE_RANK: Record<MarketConfidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export function canonicalizeUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(`Unsupported market source URL protocol: ${url.protocol}`);
  }

  url.hash = "";
  url.username = "";
  url.password = "";

  const retainedParameters = [...url.searchParams.entries()]
    .filter(([name]) => {
      const normalized = name.toLowerCase();
      return !normalized.startsWith("utm_")
        && !TRACKING_PARAMETERS.has(normalized);
    })
    .sort(([leftName, leftValue], [rightName, rightValue]) => (
      leftName.localeCompare(rightName) || leftValue.localeCompare(rightValue)
    ));

  url.search = "";
  for (const [name, value] of retainedParameters) {
    url.searchParams.append(name, value);
  }

  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString().replace(/\/$/, "");
}

export function withinPublicationWindow(
  publishedAt: string,
  now: Date,
  days: number,
): boolean {
  const publicationTime = Date.parse(publishedAt);
  const upperBound = now.getTime();
  if (
    !Number.isFinite(publicationTime)
    || !Number.isFinite(upperBound)
    || !Number.isFinite(days)
    || days <= 0
  ) {
    return false;
  }

  const lowerBound = upperBound - days * 24 * 60 * 60 * 1_000;
  return publicationTime >= lowerBound && publicationTime <= upperBound;
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
  if (
    sameDates
    && left.canonicalUrl !== null
    && right.canonicalUrl !== null
    && canonicalizeUrl(left.canonicalUrl) === canonicalizeUrl(right.canonicalUrl)
  ) {
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

  const similarity = titleSimilarity(left.title, right.title);
  return similarity >= 0.85
    || (
      left.eventType === right.eventType
      && sharesEntity(left, right)
      && similarity >= 0.75
    );
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
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
  return rightRetrievedAt > leftRetrievedAt
    ? right
    : left;
}

function mergeEvents(
  left: MarketEventV2,
  right: MarketEventV2,
): MarketEventV2 {
  const preferred = preferredEvent(left, right);
  const sources = uniqueByCanonicalId(
    [...left.sources, ...right.sources],
    "source",
  );

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
    entityKeys: unique([
      ...left.entityKeys,
      ...right.entityKeys,
    ]),
    sources,
  };
  if (preferred.adaptation === "canonical") {
    return reidentifyMarketEvent(merged);
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
  const parsedEvents = events.map(parseMarketEventV2Read);
  const collisionCheckedEvents = uniqueByCanonicalId(
    parsedEvents,
    "market event",
  );
  uniqueByCanonicalId(
    collisionCheckedEvents.flatMap((event) => event.sources),
    "source",
  );
  const deduplicated: MarketEventV2[] = [];

  for (const event of collisionCheckedEvents) {
    const normalizedUrlEvent = {
      ...event,
      canonicalUrl: event.canonicalUrl === null
        ? null
        : canonicalizeUrl(event.canonicalUrl),
      sources: event.sources.map((source) => ({
        ...source,
        canonicalUrl: source.canonicalUrl === null
          ? null
          : canonicalizeUrl(source.canonicalUrl),
      })),
    };
    const canonicalEvent = event.adaptation === "canonical"
      ? WritableMarketEventV2Schema.parse(normalizedUrlEvent)
      : MarketEventV2Schema.parse(normalizedUrlEvent);
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

  return deduplicated;
}
