import type { MarketConfidence, NormalizedMarketEvent } from "./types";
import { classifyMarketEventForAnalysis } from "./classification";

export const MAX_MARKET_EVENTS_FOR_ANALYSIS = 20;

const CONFIDENCE_RANK: Record<MarketConfidence, number> = {
  high: 2,
  medium: 1,
  low: 0,
};

// Terms appearing in more Deals than this are treated as shared boilerplate
// (fixture template phrasing) and excluded from portfolio relevance.
const MAX_TERM_DEAL_FREQUENCY = 3;

const TERM_STOPWORDS = new Set([
  "that", "this", "with", "from", "have", "will", "would", "should", "could",
  "into", "over", "under", "about", "after", "before", "their", "they",
  "them", "your", "when", "where", "which", "while", "than", "then",
  "because", "been", "being", "also", "only", "more", "most", "some",
  "such", "other", "these", "those", "there", "here", "what", "each",
  "between", "during", "without", "within", "upon", "does", "must",
]);

function termsOf(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9-]+/)
      .filter((token) => token.length >= 4 && !TERM_STOPWORDS.has(token)),
  );
}

function filteredDealTerms(
  dealTexts: ReadonlyMap<string, readonly string[]>,
): Map<string, Set<string>> {
  const rawByDeal = new Map<string, Set<string>>();
  const dealFrequency = new Map<string, number>();
  for (const [dealId, texts] of dealTexts) {
    const raw = termsOf(texts.join(" "));
    rawByDeal.set(dealId, raw);
    for (const term of raw) {
      dealFrequency.set(term, (dealFrequency.get(term) ?? 0) + 1);
    }
  }
  const filtered = new Map<string, Set<string>>();
  for (const [dealId, raw] of rawByDeal) {
    filtered.set(
      dealId,
      new Set([...raw].filter((term) =>
        (dealFrequency.get(term) ?? 0) <= MAX_TERM_DEAL_FREQUENCY
      )),
    );
  }
  return filtered;
}

export function portfolioSearchTerms(
  bundleTexts: readonly (readonly string[])[],
): Set<string> {
  const keyed = new Map(
    bundleTexts.map((texts, index) => [`bundle_${index}`, texts]),
  );
  const union = new Set<string>();
  for (const terms of filteredDealTerms(keyed).values()) {
    for (const term of terms) union.add(term);
  }
  return union;
}

export interface MarketEventSelection {
  events: NormalizedMarketEvent[];
  totalCount: number;
  eligibleCount: number;
  ineligibleCount: number;
  droppedCount: number;
}

export function selectMarketEventsForAnalysis(
  events: NormalizedMarketEvent[],
  limit: number | undefined = undefined,
  portfolio: ReadonlyMap<string, readonly string[]> = new Map(),
): MarketEventSelection {
  const effectiveLimit = limit
    ?? Math.min(25, Math.max(MAX_MARKET_EVENTS_FOR_ANALYSIS, portfolio.size));
  if (!Number.isInteger(effectiveLimit) || effectiveLimit <= 0) {
    throw new TypeError("Market analysis event limit must be a positive integer.");
  }

  const eligible = events.flatMap((event) => {
    const classified = classifyMarketEventForAnalysis(event);
    return classified ? [classified] : [];
  });

  const dealTerms = filteredDealTerms(portfolio);
  const relevance = new Map<string, number>();
  const overlapsByEvent = new Map<string, Map<string, number>>();
  for (const event of eligible) {
    const eventTerms = termsOf([
      event.title,
      event.summary,
      ...event.sectors,
      ...event.themes,
    ].join(" "));
    const overlaps = new Map<string, number>();
    let maxOverlap = 0;
    for (const [dealId, terms] of dealTerms) {
      let overlap = 0;
      for (const term of eventTerms) {
        if (terms.has(term)) overlap += 1;
      }
      if (overlap > 0) overlaps.set(dealId, overlap);
      if (overlap > maxOverlap) maxOverlap = overlap;
    }
    overlapsByEvent.set(event.id, overlaps);
    relevance.set(event.id, maxOverlap);
  }

  const ranked = eligible.sort((left, right) => {
    const relevanceDifference =
      (relevance.get(right.id) ?? 0) - (relevance.get(left.id) ?? 0);
    if (relevanceDifference !== 0) return relevanceDifference;

    const confidenceDifference =
      CONFIDENCE_RANK[right.confidence] - CONFIDENCE_RANK[left.confidence];
    if (confidenceDifference !== 0) return confidenceDifference;

    const publicationDifference =
      Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
    if (publicationDifference !== 0) return publicationDifference;

    const sourceDifference = right.sources.length - left.sources.length;
    if (sourceDifference !== 0) return sourceDifference;

    return left.id.localeCompare(right.id);
  });

  // Every Deal's strongest candidate keeps a bounded reserved slot so broad
  // high-confidence noise cannot crowd a Deal's only relevant evidence out
  // of the analysis window. Ties follow the main ranking order.
  const bestEventForDeal = new Map<string, { eventId: string; overlap: number }>();
  for (const event of ranked) {
    const overlaps = overlapsByEvent.get(event.id);
    if (!overlaps) continue;
    for (const [dealId, overlap] of overlaps) {
      const best = bestEventForDeal.get(dealId);
      if (!best || overlap > best.overlap) {
        bestEventForDeal.set(dealId, { eventId: event.id, overlap });
      }
    }
  }
  const reservedEventIds = new Set(
    [...bestEventForDeal.values()].map((best) => best.eventId),
  );
  if (reservedEventIds.size > 25) {
    throw new Error(
      "Unique Deal market-event coverage exceeds the 25-event analysis capacity.",
    );
  }
  const reserved = ranked.filter((event) => reservedEventIds.has(event.id));
  const remainder = ranked.filter((event) => !reservedEventIds.has(event.id));
  const selected = [...reserved, ...remainder].slice(0, effectiveLimit);

  return {
    events: selected,
    totalCount: events.length,
    eligibleCount: ranked.length,
    ineligibleCount: events.length - ranked.length,
    droppedCount: events.length - selected.length,
  };
}
