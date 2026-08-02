import assert from "node:assert/strict";
import test from "node:test";

import { MarketEventSchema } from "../../lib/contracts/domain";
import {
  MarketEventV2Schema,
  WritableMarketEventV2Schema,
} from "../../lib/contracts/source-evidence";
import {
  canonicalizeUrl,
  dedupeEvents,
  withinWindow,
} from "../../lib/market/dedupe";
import {
  createMarketService,
  normalizeMarketItem,
} from "../../lib/market/service";
import {
  MAX_MARKET_EVENTS_FOR_ANALYSIS,
  portfolioSearchTerms,
  selectMarketEventsForAnalysis,
} from "../../lib/market/selection";
import type {
  MarketProvider,
  NormalizedMarketEvent,
  RawSourceItem,
} from "../../lib/market/types";
import { marketScanStage } from "../../worker/stages/market-scan";

const NOW = new Date("2026-07-24T12:00:00.000Z");
const SHA256_A = `sha256:${"a".repeat(64)}`;
const SHA256_B = `sha256:${"b".repeat(64)}`;

function sourceV2(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "source-ref-v2",
    adaptation: "canonical",
    id: "source_v2_1",
    provenance: "public_web",
    title: "Acme funding announcement",
    canonicalUrl: "https://acme.example/news/series-b",
    documentId: null,
    publisher: "Acme",
    providerId: "company-feed",
    eventAt: null,
    publishedAt: "2026-07-23T15:00:00.000Z",
    retrievedAt: NOW.toISOString(),
    updatedAt: null,
    entityKeys: ["acme"],
    sourceClass: "company_official",
    sourceAuthority: "primary",
    evidenceRole: "trigger",
    sourceRevisionId: null,
    locator: null,
    contentFingerprint: SHA256_A,
    text: {
      status: "normalized_only",
      normalizedStatement: "Acme announced a Series B funding round.",
    },
    ...overrides,
  };
}

function eventV2(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "market-event-v2",
    adaptation: "canonical",
    id: "market_v2_1",
    title: "Acme closes Series B funding round",
    eventType: "funding",
    sectors: ["healthcare"],
    themes: ["growth"],
    summary: "Acme announced a Series B funding round.",
    positiveImplications: [],
    negativeImplications: [],
    eventAt: null,
    publishedAt: "2026-07-23T15:00:00.000Z",
    retrievedAt: NOW.toISOString(),
    updatedAt: null,
    confidence: "medium",
    canonicalUrl: "https://acme.example/news/series-b",
    providerId: "company-feed",
    contentFingerprint: SHA256_B,
    entityKeys: ["acme"],
    triggerSourceId: "source_v2_1",
    sources: [sourceV2()],
    ...overrides,
  };
}

function event(
  overrides: Record<string, unknown> = {},
): NormalizedMarketEvent {
  const base = {
    id: "market_1",
    title: "Acme closes Series B funding round",
    eventType: "funding",
    sectors: ["healthcare"],
    themes: ["growth"],
    summary: "Acme announced a Series B funding round.",
    positiveImplications: [],
    negativeImplications: [],
    publishedAt: "2026-07-23T15:00:00.000Z",
    confidence: "medium",
    sources: [{
      id: "source_1",
      provenance: "public_web",
      title: "Acme funding announcement",
      url: "https://acme.example/news/series-b",
      publisher: "Acme",
      publishedAt: "2026-07-23T15:00:00.000Z",
      excerpt: "Acme announced that it closed a Series B funding round.",
    }],
    canonicalUrl: "https://acme.example/news/series-b",
    retrievedAt: "2026-07-24T12:00:00.000Z",
    providerId: "company-feed",
    entityKeys: ["acme"],
  };
  const overrideSources = Array.isArray(overrides.sources)
    ? overrides.sources as Array<Record<string, unknown>>
    : base.sources;
  const triggerInput = overrideSources[0] ?? base.sources[0];
  const canonicalUrl = typeof overrides.canonicalUrl === "string"
    ? overrides.canonicalUrl
    : typeof triggerInput.url === "string"
    ? triggerInput.url
    : base.canonicalUrl;
  const publishedAt = typeof overrides.publishedAt === "string"
    ? overrides.publishedAt
    : typeof triggerInput.publishedAt === "string"
    ? triggerInput.publishedAt
    : base.publishedAt;
  const retrievedAt = typeof overrides.retrievedAt === "string"
    ? overrides.retrievedAt
    : base.retrievedAt;
  const providerId = typeof overrides.providerId === "string"
    ? overrides.providerId
    : base.providerId;
  const entityKeys = Array.isArray(overrides.entityKeys)
    ? overrides.entityKeys
    : base.entityKeys;
  const sources = overrideSources.map((input, index) => {
    if (input.schemaVersion === "source-ref-v2") return input;
    const normalizedStatement = typeof input.excerpt === "string"
      ? input.excerpt
      : base.sources[0].excerpt;
    return sourceV2({
      id: typeof input.id === "string" ? input.id : `source_${index + 1}`,
      title: typeof input.title === "string" ? input.title : base.title,
      canonicalUrl: index === 0
        ? canonicalUrl
        : typeof input.url === "string"
        ? input.url
        : canonicalUrl,
      publisher: typeof input.publisher === "string"
        ? input.publisher
        : "Example Publisher",
      providerId,
      eventAt: null,
      publishedAt: index === 0
        ? publishedAt
        : typeof input.publishedAt === "string"
        ? input.publishedAt
        : publishedAt,
      retrievedAt,
      updatedAt: null,
      entityKeys,
      evidenceRole: index === 0 ? "trigger" : "corroborating",
      text: { status: "normalized_only", normalizedStatement },
    });
  });
  const {
    contentChecksum: _legacyContentChecksum,
    sources: _legacySources,
    ...eventOverrides
  } = overrides;
  void _legacyContentChecksum;
  void _legacySources;
  return WritableMarketEventV2Schema.parse({
    schemaVersion: "market-event-v2",
    adaptation: "canonical",
    ...base,
    ...eventOverrides,
    canonicalUrl,
    publishedAt,
    retrievedAt,
    providerId,
    contentFingerprint: SHA256_B,
    eventAt: null,
    updatedAt: null,
    entityKeys,
    triggerSourceId: String(sources[0].id),
    sources,
  });
}

function rawItem(overrides: Partial<RawSourceItem> = {}): RawSourceItem {
  return {
    providerId: "company-feed",
    externalId: "announcement-1",
    title: "Acme closes Series B funding round",
    url: "https://acme.example/news/series-b?utm_source=email",
    publisher: "Acme",
    sourceClass: "company_official",
    sourceAuthority: "primary",
    evidenceRole: "trigger",
    publishedAt: "2026-07-23T15:00:00.000Z",
    summary: "Acme announced a Series B funding round.",
    normalizedStatement:
      "Acme announced that it closed a Series B funding round.",
    eventType: "funding",
    sectors: ["healthcare"],
    themes: ["growth"],
    confidence: "high",
    ...overrides,
  };
}

test("uses publication time for an inclusive fourteen-day window", () => {
  assert.equal(
    withinWindow("2026-07-10T12:00:00.000Z", NOW, 14),
    true,
  );
  assert.equal(
    withinWindow("2026-07-10T11:59:59.999Z", NOW, 14),
    false,
  );
  assert.equal(
    withinWindow("2026-07-24T12:00:00.001Z", NOW, 14),
    false,
  );
  assert.equal(withinWindow("not-a-date", NOW, 14), false);
});

test("canonicalizes URLs before deduplication", () => {
  assert.equal(
    canonicalizeUrl(
      "HTTPS://Acme.Example:443/news/series-b/?utm_source=newsletter&b=2&a=1#details",
    ),
    "https://acme.example/news/series-b?a=1&b=2",
  );

  const duplicate = event({
    id: "market_2",
    confidence: "high",
    canonicalUrl:
      "https://acme.example/news/series-b/?utm_campaign=roundup",
    sources: [{
      id: "source_2",
      provenance: "public_web",
      title: "Publisher coverage",
      url: "https://acme.example/news/series-b/?utm_campaign=roundup",
      publisher: "Acme",
      publishedAt: "2026-07-23T15:00:00.000Z",
      excerpt: "The company closed its Series B.",
    }],
  });

  const result = dedupeEvents([event(), duplicate]);

  assert.equal(result.length, 1);
  assert.equal(result[0].confidence, "high");
  assert.deepEqual(
    result[0].sources.map((source) => source.id).sort(),
    ["source_1", "source_2"],
  );
});

test("deduplicates semantically similar titles from the same publication day", () => {
  const duplicate = event({
    id: "market_2",
    title: "Acme closes Series B funding round today",
    canonicalUrl: "https://publisher.example/acme-series-b",
    contentChecksum: "checksum-2",
    sources: [{
      id: "source_2",
      provenance: "public_web",
      title: "Acme closes Series B funding round today",
      url: "https://publisher.example/acme-series-b",
      publisher: "Publisher",
      publishedAt: "2026-07-23T18:00:00.000Z",
      excerpt: "Acme closed its Series B funding round today.",
    }],
  });

  assert.equal(dedupeEvents([event(), duplicate]).length, 1);

  const nextDay = duplicate.publishedAt.replace("2026-07-23", "2026-07-24");
  const nextDayRetrieval = "2026-07-24T19:00:00.000Z";
  assert.equal(
    dedupeEvents([
      event(),
      {
        ...duplicate,
        publishedAt: nextDay,
        retrievedAt: nextDayRetrieval,
        sources: duplicate.sources.map((source) => ({
          ...source,
          publishedAt: nextDay,
          retrievedAt: nextDayRetrieval,
        })),
      },
    ]).length,
    2,
  );
});

test("normalizes a source item into a validated, evidence-backed event", async () => {
  const normalized = await normalizeMarketItem(rawItem(), {
    retrievedAt: NOW,
  });

  assert.equal(MarketEventSchema.safeParse(normalized).success, false);
  assert.equal(WritableMarketEventV2Schema.safeParse(normalized).success, true);
  assert.equal(
    normalized.canonicalUrl,
    "https://acme.example/news/series-b",
  );
  assert.match(normalized.contentFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.match(normalized.id, /^market_[a-f0-9]{24}$/);
  assert.equal(normalized.retrievedAt, NOW.toISOString());
  assert.equal(
    normalized.sources[0].text.normalizedStatement,
    "Acme announced that it closed a Series B funding round.",
  );
});

test("normalizes provider prose as non-quote v2 evidence", async () => {
  const normalized = await normalizeMarketItem({
    ...rawItem(),
    normalizedStatement: "Acme announced that it closed a Series B funding round.",
  }, { retrievedAt: NOW });

  assert.equal(WritableMarketEventV2Schema.safeParse(normalized).success, true);
  assert.equal(MarketEventV2Schema.safeParse(normalized).success, true);
  assert.equal(normalized.adaptation, "canonical");
  assert.equal(normalized.eventAt, null);
  assert.equal(normalized.sources[0].text.status, "normalized_only");
  assert.equal("verbatimExcerpt" in normalized.sources[0].text, false);
  assert.equal(normalized.sources[0].sourceClass, "company_official");
  assert.equal(normalized.sources[0].sourceAuthority, "primary");
  assert.equal(normalized.sources[0].evidenceRole, "trigger");
});

test("missing event date stays null and updatedAt never becomes publishedAt", async () => {
  const normalized = await normalizeMarketItem(rawItem({
    eventAt: undefined,
    updatedAt: "2026-07-23T16:00:00.000Z",
  }), { retrievedAt: NOW });

  assert.equal(normalized.eventAt, null);
  assert.equal(normalized.publishedAt, "2026-07-23T15:00:00.000Z");
  assert.equal(normalized.updatedAt, "2026-07-23T16:00:00.000Z");
  await assert.rejects(
    normalizeMarketItem(rawItem({
      publishedAt: undefined,
      updatedAt: "2026-07-23T16:00:00.000Z",
    }), { retrievedAt: NOW }),
    /publication time/i,
  );
});

test("normalization rejects malformed class authority role entity and event date", async () => {
  const invalidCases: Array<[string, Partial<RawSourceItem>]> = [
    ["class", { sourceClass: "blog" as never }],
    ["authority", { sourceAuthority: "official" as never }],
    ["role", { evidenceRole: "citation" as never }],
    ["entity", { entities: ["Acme Incorporated"] }],
    ["event date", { eventAt: "not-a-date" }],
  ];
  for (const [label, overrides] of invalidCases) {
    await assert.rejects(
      normalizeMarketItem(rawItem(overrides), { retrievedAt: NOW }),
      undefined,
      label,
    );
  }
});

test("same source or event ID with conflicting canonical payload throws", () => {
  assert.throws(() => dedupeEvents([
    eventV2(),
    eventV2({ title: "Conflicting title for the same event ID" }),
  ] as never), /conflicting market event id/i);

  assert.throws(() => dedupeEvents([
    eventV2(),
    eventV2({
      id: "market_v2_2",
      sources: [sourceV2({ title: "Conflicting source revision" })],
    }),
  ] as never), /conflicting source id/i);
});

test("a rolling URL with different event or publication dates is not merged", () => {
  const laterPublishedAt = "2026-07-24T15:00:00.000Z";
  const laterRetrievedAt = "2026-07-24T16:00:00.000Z";
  const result = dedupeEvents([
    eventV2(),
    eventV2({
      id: "market_v2_2",
      eventAt: "2026-07-24T14:00:00.000Z",
      publishedAt: laterPublishedAt,
      retrievedAt: laterRetrievedAt,
      sources: [sourceV2({
        id: "source_v2_2",
        eventAt: "2026-07-24T14:00:00.000Z",
        publishedAt: laterPublishedAt,
        retrievedAt: laterRetrievedAt,
      })],
      triggerSourceId: "source_v2_2",
    }),
  ] as never);

  assert.equal(result.length, 2);
});

test("normalized source content fingerprints identify text independently of URL", async () => {
  const first = await normalizeMarketItem(rawItem(), { retrievedAt: NOW });
  const syndicated = await normalizeMarketItem(rawItem({
    providerId: "publisher-feed",
    externalId: "publisher-copy",
    url: "https://publisher.example/acme-series-b",
    publisher: "Publisher",
  }), { retrievedAt: NOW });

  assert.equal(
    first.sources[0].contentFingerprint,
    syndicated.sources[0].contentFingerprint,
  );
  assert.notEqual(first.id, syndicated.id);
});

test("preserves the original retrieval time when cached evidence is reused", async () => {
  const originalRetrievalTime = "2026-07-23T16:00:00.000Z";
  const normalized = await normalizeMarketItem({
    ...rawItem(),
    retrievedAt: originalRetrievalTime,
  }, {
    retrievedAt: NOW,
  });

  assert.equal(normalized.retrievedAt, originalRetrievalTime);
});

test("deduplicates reordered syndicated headlines on the same day", () => {
  const syndicated = event({
    id: "market_2",
    title: "Series B funding round closes for Acme",
    canonicalUrl: "https://publisher.example/acme-series-b",
    contentChecksum: "checksum-2",
    sources: [{
      id: "source_2",
      provenance: "public_web",
      title: "Series B funding round closes for Acme",
      url: "https://publisher.example/acme-series-b",
      publisher: "Publisher",
      publishedAt: "2026-07-23T18:00:00.000Z",
      excerpt: "Acme closed its Series B funding round.",
    }],
  });

  assert.equal(dedupeEvents([event(), syndicated]).length, 1);
});

test("does not merge distinct same-day events that share a broad entity", () => {
  const first = event({
    title: "FDA approves Drug X for cancer",
    eventType: "regulatory",
    canonicalUrl: "https://fda.example/drug-x",
    contentChecksum: "drug-x-checksum",
    entityKeys: ["fda"],
  });
  const second = event({
    id: "market_2",
    title: "FDA approves Drug Y for cancer",
    eventType: "regulatory",
    canonicalUrl: "https://fda.example/drug-y",
    contentChecksum: "drug-y-checksum",
    entityKeys: ["fda"],
    sources: [{
      id: "source_2",
      provenance: "public_web",
      title: "FDA approves Drug Y for cancer",
      url: "https://fda.example/drug-y",
      publisher: "FDA",
      publishedAt: "2026-07-23T18:00:00.000Z",
      excerpt: "FDA approved Drug Y for cancer.",
    }],
  });

  assert.equal(dedupeEvents([first, second]).length, 2);
});

test("deterministically ranks and caps market events for downstream analysis", () => {
  const selected = selectMarketEventsForAnalysis([
    event({
      id: "medium-new",
      confidence: "medium",
      publishedAt: "2026-07-24T11:00:00.000Z",
    }),
    event({
      id: "high-old",
      confidence: "high",
      publishedAt: "2026-07-20T11:00:00.000Z",
    }),
    event({
      id: "high-new-b",
      confidence: "high",
      publishedAt: "2026-07-24T10:00:00.000Z",
    }),
    event({
      id: "high-new-a",
      confidence: "high",
      publishedAt: "2026-07-24T10:00:00.000Z",
    }),
  ], 3);

  assert.deepEqual(
    selected.events.map((candidate) => candidate.id),
    ["high-new-a", "high-new-b", "high-old"],
  );
  assert.equal(selected.totalCount, 4);
  assert.equal(selected.droppedCount, 1);
});

const PORTFOLIO_TEXTS = new Map<string, readonly string[]>([
  ["deal_1906", ["1906", "The company develops controlled-dose cannabis products.", "Sample internal note: the team reviewed the proposition."]],
  ["deal_100plus", ["100Plus", "100Plus provides remote patient monitoring for chronic care.", "Sample internal note: the team reviewed the proposition."]],
  ["deal_7bridges", ["7bridges", "7bridges automates logistics and supply chain decisions.", "Sample internal note: the team reviewed the proposition."]],
  ["deal_acquco", ["Acquco", "Acquco acquires and scales Amazon marketplace brands.", "Sample internal note: the team reviewed the proposition."]],
]);

test("portfolio-relevant events outrank higher-confidence unrelated events", () => {
  const terms = portfolioSearchTerms([...PORTFOLIO_TEXTS.values()]);
  assert.ok(terms.has("cannabis"));
  assert.ok(terms.has("logistics"));
  assert.ok(!terms.has("team"), "boilerplate shared by most Deals must be dropped");
  assert.ok(!terms.has("proposition"), "boilerplate shared by most Deals must be dropped");

  const selected = selectMarketEventsForAnalysis([
    event({
      id: "junk-high",
      confidence: "high",
      publishedAt: "2026-07-24T11:00:00.000Z",
    }),
    event({
      id: "relevant-medium",
      title: "Cannabis brand closes Series B funding round",
      summary: "The cannabis company announced a Series B funding round.",
      confidence: "medium",
      publishedAt: "2026-07-23T11:00:00.000Z",
    }),
  ], 1, PORTFOLIO_TEXTS);

  assert.deepEqual(
    selected.events.map((candidate) => candidate.id),
    ["relevant-medium"],
    "a portfolio-relevant medium-confidence event must beat unrelated "
    + "high-confidence noise for the bounded analysis slots",
  );
});

test("every Deal's strongest candidate keeps a reserved analysis slot", () => {
  const noise = Array.from({ length: 6 }, (_, index) =>
    event({
      id: `noise-${index}`,
      title: "Monitoring payment records funding round announced",
      summary: "A broad announcement mentioning monitoring and payment records.",
      confidence: "high",
      publishedAt: "2026-07-24T11:00:00.000Z",
      canonicalUrl: `https://noise.example/${index}`,
      contentChecksum: `noise-${index}`,
    }));
  const dealSpecific = event({
    id: "amazon-specific",
    title: "Amazon marketplace brands see funding round revival",
    summary: "Amazon marketplace aggregators announced new funding.",
    confidence: "medium",
    publishedAt: "2026-07-20T11:00:00.000Z",
    canonicalUrl: "https://relevant.example/amazon",
    contentChecksum: "amazon-1",
  });

  const selected = selectMarketEventsForAnalysis(
    [...noise, dealSpecific],
    3,
    PORTFOLIO_TEXTS,
  );

  assert.ok(
    selected.events.some((candidate) => candidate.id === "amazon-specific"),
    "the only event matching a Deal's own terms must survive the cap even "
    + "when broad noise outranks it globally",
  );
});

test("excludes generic press releases even when a provider assigns broad market labels", () => {
  const selected = selectMarketEventsForAnalysis([
    event({
      id: "generic-fda-release",
      title: "Senate approves a new FDA deputy commissioner",
      eventType: "regulatory",
      sectors: ["healthcare"],
      themes: ["regulation"],
      summary: "The Senate approved a leadership appointment and the agency announced it.",
      confidence: "high",
      sources: [{
        id: "generic-fda-source",
        provenance: "public_web",
        title: "Senate approves a new FDA deputy commissioner",
        url: "https://www.fda.gov/news-events/leadership-appointment",
        publisher: "U.S. Food and Drug Administration",
        publishedAt: "2026-07-24T11:30:00.000Z",
        excerpt: "The Senate approved a leadership appointment and the agency announced it.",
      }],
    }),
    event({
      id: "robotics-series-b",
      title: "Robotics startup closes a $40 million Series B",
      eventType: "venture_news",
      sectors: [],
      themes: ["venture-capital"],
      summary: "The robotics company raised new venture funding for manufacturing.",
      confidence: "medium",
      sources: [{
        id: "robotics-series-b-source",
        provenance: "public_web",
        title: "Robotics startup closes a $40 million Series B",
        url: "https://example.com/robotics-series-b",
        publisher: "Example News",
        publishedAt: "2026-07-24T10:30:00.000Z",
        excerpt: "The robotics company raised new venture funding for manufacturing.",
      }],
    }),
  ]);

  assert.deepEqual(
    selected.events.map((candidate) => candidate.id),
    ["robotics-series-b"],
  );
  assert.equal(selected.totalCount, 2);
  assert.equal(selected.droppedCount, 1);
  assert.equal(selected.ineligibleCount, 1);
  assert.equal(selected.eligibleCount, 1);
});

test("derives bounded sectors and themes from event evidence instead of static provider labels", () => {
  const selected = selectMarketEventsForAnalysis([
    event({
      id: "cyber-rule",
      title: "SEC adopts final cybersecurity disclosure rule for AI companies",
      eventType: "regulatory",
      sectors: ["healthcare"],
      themes: ["growth"],
      summary: "The final rule changes cybersecurity disclosure requirements for public companies.",
      confidence: "high",
      sources: [{
        id: "cyber-rule-source",
        provenance: "public_web",
        title: "SEC adopts final cybersecurity disclosure rule for AI companies",
        url: "https://www.sec.gov/newsroom/press-releases/cyber-rule",
        publisher: "U.S. Securities and Exchange Commission",
        publishedAt: "2026-07-24T11:00:00.000Z",
        excerpt: "The final rule changes cybersecurity disclosure requirements for public companies.",
      }],
    }),
  ]);

  assert.equal(selected.events.length, 1);
  assert.deepEqual(
    selected.events[0].sectors,
    ["artificial-intelligence", "cybersecurity"],
  );
  assert.deepEqual(selected.events[0].themes, ["regulation"]);
});

test("uses a fixed safe default cap for market analysis", () => {
  const selected = selectMarketEventsForAnalysis(
    Array.from(
      { length: MAX_MARKET_EVENTS_FOR_ANALYSIS + 5 },
      (_, index) => event({
        id: `event-${index}`,
        publishedAt: new Date(
          NOW.getTime() - index * 60_000,
        ).toISOString(),
      }),
    ),
  );

  assert.equal(selected.events.length, MAX_MARKET_EVENTS_FOR_ANALYSIS);
  assert.equal(selected.droppedCount, 5);
});

test("rejects undated or evidence-free source items", async () => {
  await assert.rejects(
    normalizeMarketItem(rawItem({ publishedAt: undefined }), {
      retrievedAt: NOW,
    }),
    /publication time/i,
  );
  await assert.rejects(
    normalizeMarketItem(rawItem({
      summary: undefined,
      normalizedStatement: undefined,
    }), {
      retrievedAt: NOW,
    }),
    /normalized evidence statement/i,
  );
});

test("scans providers independently, filters by publication date, and persists deduplicated events", async () => {
  let requestedWindow: { from: Date; to: Date } | undefined;
  const goodProvider: MarketProvider = {
    id: "company-feed",
    name: "Company announcements",
    async fetch(window) {
      requestedWindow = window;
      return [
        rawItem(),
        rawItem({
          externalId: "announcement-duplicate",
          url: "https://acme.example/news/series-b?utm_campaign=roundup",
          confidence: "medium",
        }),
        rawItem({
          externalId: "too-old",
          title: "Old Acme announcement",
          url: "https://acme.example/news/old",
          publishedAt: "2026-07-09T11:00:00.000Z",
        }),
        rawItem({
          externalId: "no-evidence",
          title: "Unverifiable announcement",
          url: "https://acme.example/news/no-evidence",
          normalizedStatement: undefined,
          summary: undefined,
        }),
      ];
    },
  };
  const failingProvider: MarketProvider = {
    id: "broken-feed",
    name: "Broken feed",
    async fetch() {
      throw new Error("upstream unavailable");
    },
  };
  const persisted: NormalizedMarketEvent[][] = [];
  const service = createMarketService({
    providers: [goodProvider, failingProvider],
    persistEvents(events) {
      persisted.push(events);
    },
  });

  const result = await service.scanMarketWindow({ days: 14, now: NOW });

  assert.equal(result.status, "partial");
  assert.equal(result.events.length, 1);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].length, 1);
  assert.equal(requestedWindow?.from.toISOString(), "2026-07-10T12:00:00.000Z");
  assert.equal(requestedWindow?.to.toISOString(), NOW.toISOString());

  const goodReport = result.providers.find(
    (provider) => provider.providerId === "company-feed",
  );
  assert.deepEqual(goodReport, {
    providerId: "company-feed",
    providerName: "Company announcements",
    fetchedCount: 4,
    acceptedCount: 2,
    rejectedCount: 2,
    lastSuccessAt: NOW.toISOString(),
  });

  const failedReport = result.providers.find(
    (provider) => provider.providerId === "broken-feed",
  );
  assert.equal(failedReport?.fetchedCount, 0);
  assert.match(failedReport?.error ?? "", /upstream unavailable/);
});

test("completes an evidence-backed empty scan when a provider succeeds", async () => {
  const service = createMarketService({
    providers: [{
      id: "empty-feed",
      name: "Empty feed",
      async fetch() {
        return [];
      },
    }],
  });

  const result = await service.scanMarketWindow({ now: NOW });

  assert.equal(result.status, "completed");
  assert.deepEqual(result.events, []);
  assert.equal(result.window.days, 14);
});

test("the worker market stage delegates to the injected service", async () => {
  const expected = {
    status: "completed" as const,
    window: {
      from: "2026-07-10T12:00:00.000Z",
      to: NOW.toISOString(),
      days: 14,
    },
    events: [],
    providers: [],
  };
  let receivedDays: number | undefined;

  const result = await marketScanStage(
    { days: 14, now: NOW },
    {
      service: {
        async scanMarketWindow(options) {
          receivedDays = options?.days;
          return expected;
        },
      },
    },
  );

  assert.equal(receivedDays, 14);
  assert.equal(result, expected);
});
