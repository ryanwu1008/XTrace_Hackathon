import type {
  MarketEventV2,
  SourceRefV2,
} from "../../lib/contracts/source-evidence";
import { refingerprintMarketEvent } from "../../lib/market/identity";

export const TEST_SHA256_A = `sha256:${"a".repeat(64)}`;
export const TEST_SHA256_B = `sha256:${"b".repeat(64)}`;

export function exactSourceV2(
  id = "source_exact_1",
  overrides: Record<string, unknown> = {},
): SourceRefV2 {
  return {
    schemaVersion: "source-ref-v2",
    adaptation: "canonical",
    id,
    provenance: "public_web",
    title: "Acme funding announcement",
    canonicalUrl: "https://acme.example/news/series-b",
    documentId: null,
    publisher: "Acme",
    providerId: "company-feed",
    eventAt: null,
    eventAtPrecision: null,
    publishedAt: "2026-07-23T15:00:00.000Z",
    publishedAtPrecision: "timestamp",
    retrievedAt: "2026-07-24T12:00:00.000Z",
    retrievedAtPrecision: "timestamp",
    updatedAt: null,
    updatedAtPrecision: null,
    entityKeys: ["acme"],
    sourceClass: "company_official",
    sourceAuthority: "primary",
    evidenceRole: "trigger",
    sourceRevisionId: `revision_${id}`,
    locator: {
      kind: "web_text",
      selector: "main article p:nth-of-type(2)",
    },
    contentFingerprint: TEST_SHA256_A,
    text: {
      status: "verified_exact",
      verbatimExcerpt: "Acme closed a Series B funding round.",
      normalizedStatement: "Acme completed its Series B financing.",
    },
    ...overrides,
  } as SourceRefV2;
}

export function normalizedSourceV2(
  id = "source_normalized_1",
  overrides: Record<string, unknown> = {},
): SourceRefV2 {
  return {
    ...exactSourceV2(id),
    sourceRevisionId: null,
    locator: null,
    text: {
      status: "normalized_only",
      normalizedStatement: "Acme announced a Series B funding round.",
    },
    ...overrides,
  } as SourceRefV2;
}

export function marketEventV2(
  source: SourceRefV2 = normalizedSourceV2(),
  overrides: Record<string, unknown> = {},
): MarketEventV2 {
  return refingerprintMarketEvent({
    schemaVersion: "market-event-v2",
    adaptation: "canonical",
    id: "market_acme_series_b_1",
    title: "Acme closes Series B funding round",
    eventType: "funding",
    sectors: ["infrastructure"],
    themes: ["funding"],
    summary: "Acme announced a Series B funding round.",
    positiveImplications: [],
    negativeImplications: [],
    eventAt: source.eventAt,
    eventAtPrecision: source.eventAtPrecision,
    publishedAt: source.publishedAt,
    publishedAtPrecision: source.publishedAtPrecision,
    retrievedAt: source.retrievedAt,
    retrievedAtPrecision: source.retrievedAtPrecision,
    updatedAt: source.updatedAt,
    updatedAtPrecision: source.updatedAtPrecision,
    confidence: "high",
    canonicalUrl: source.canonicalUrl,
    providerId: source.providerId,
    contentFingerprint: TEST_SHA256_B,
    entityKeys: [...source.entityKeys],
    triggerSourceId: source.id,
    sources: [source],
    ...overrides,
  } as Extract<MarketEventV2, { adaptation: "canonical" }>);
}
