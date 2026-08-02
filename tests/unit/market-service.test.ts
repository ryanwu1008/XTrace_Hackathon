import assert from "node:assert/strict";
import test from "node:test";

import { MarketEventSchema } from "../../lib/contracts/domain";
import {
  MarketEventV2Schema,
  WritableMarketEventV2Schema,
  WritableSourceRefV2Schema,
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
import { createMatchingService } from "../../lib/matching/service";
import {
  assertMarketEventFingerprint,
  reidentifyMarketEvent,
  reidentifySourceRef,
  refingerprintMarketEvent,
} from "../../lib/market/identity";
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
    eventAtPrecision: null,
    publishedAt: "2026-07-23T15:00:00.000Z",
    publishedAtPrecision: "timestamp",
    retrievedAt: NOW.toISOString(),
    retrievedAtPrecision: "timestamp",
    updatedAt: null,
    updatedAtPrecision: null,
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
  return refingerprintMarketEvent({
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
    eventAtPrecision: null,
    publishedAt: "2026-07-23T15:00:00.000Z",
    publishedAtPrecision: "timestamp",
    retrievedAt: NOW.toISOString(),
    retrievedAtPrecision: "timestamp",
    updatedAt: null,
    updatedAtPrecision: null,
    confidence: "medium",
    canonicalUrl: "https://acme.example/news/series-b",
    providerId: "company-feed",
    contentFingerprint: SHA256_B,
    entityKeys: ["acme"],
    triggerSourceId: "source_v2_1",
    sources: [sourceV2()],
    ...overrides,
  } as NormalizedMarketEvent);
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
  const eventAt = typeof overrides.eventAt === "string"
    ? overrides.eventAt
    : null;
  const eventAtPrecision = eventAt === null
    ? null
    : eventAt.includes("T")
    ? "timestamp"
    : "date";
  const sources = overrideSources.map((input, index) => {
    if ("schemaVersion" in input && input.schemaVersion === "source-ref-v2") {
      return input;
    }
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
      eventAt,
      eventAtPrecision,
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
  return refingerprintMarketEvent(WritableMarketEventV2Schema.parse({
    schemaVersion: "market-event-v2",
    adaptation: "canonical",
    ...base,
    ...eventOverrides,
    canonicalUrl,
    publishedAt,
    retrievedAt,
    providerId,
    contentFingerprint: SHA256_B,
    eventAt,
    eventAtPrecision,
    publishedAtPrecision: "timestamp",
    retrievedAtPrecision: "timestamp",
    updatedAt: null,
    updatedAtPrecision: null,
    entityKeys,
    triggerSourceId: String(sources[0].id),
    sources,
  }));
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
  assert.equal(
    withinWindow("2026-07-10", NOW, 14),
    true,
    "date-only evidence overlaps the lower-bound day without inventing midnight",
  );
  assert.equal(withinWindow("2026-07-09", NOW, 14), false);
});

test("keeps conflicting same-URL evidence units as distinct observations", () => {
  assert.equal(
    canonicalizeUrl(
      "HTTPS://Acme.Example:443/news/series-b/?utm_source=newsletter&b=2&a=1#details",
    ),
    "https://acme.example/news/series-b?a=1&b=2",
  );

  const duplicate = event({
    id: "market_2",
    confidence: "high",
    canonicalUrl: "https://acme.example/news/series-b",
    sources: [{
      id: "source_2",
      provenance: "public_web",
      title: "Publisher coverage",
      url: "https://acme.example/news/series-b",
      publisher: "Acme",
      publishedAt: "2026-07-23T15:00:00.000Z",
      excerpt: "The company closed its Series B.",
    }],
  });

  const result = dedupeEvents([event(), duplicate]);

  assert.equal(result.length, 2);
  assert.ok(result.every((candidate) => candidate.sources.length === 1));
  assert.ok(result.every((candidate) =>
    candidate.sources[0].evidenceRole === "trigger"
  ));
  assert.ok(result.every((candidate) =>
    assertMarketEventFingerprint(candidate)
  ));
});

test("provider external IDs cannot create false corroboration for identical canonical evidence", async () => {
  const first = await normalizeMarketItem(rawItem({ externalId: "feed-a" }), {
    retrievedAt: NOW,
  });
  const second = await normalizeMarketItem(rawItem({ externalId: "feed-b" }), {
    retrievedAt: NOW,
  });

  assert.equal(first.sources[0].id, second.sources[0].id);
  assert.equal(first.id, second.id);
  const [deduplicated] = dedupeEvents([first, second]);
  assert.equal(deduplicated.sources.length, 1);
  assert.equal(deduplicated.sources[0].evidenceRole, "trigger");
});

test("acquisition providers cannot create false corroboration for one canonical document", async () => {
  const feedB = await normalizeMarketItem(rawItem({
    providerId: "feed-b",
    externalId: "feed-b-document-id",
  }), { retrievedAt: NOW });
  const feedA = await normalizeMarketItem(rawItem({
    providerId: "feed-a",
    externalId: "feed-a-document-id",
  }), { retrievedAt: NOW });

  const forward = dedupeEvents([feedB, feedA]);
  const reverse = dedupeEvents([feedA, feedB]);

  assert.deepEqual(forward, reverse);
  assert.equal(forward.length, 1);
  assert.equal(forward[0].sources.length, 1);
  assert.equal(forward[0].providerId, "feed-a");
  assert.equal(forward[0].sources[0].providerId, "feed-a");
  assert.equal(forward[0].sources[0].evidenceRole, "trigger");
});

test("acquisition providers cannot overwrite different event semantics", async () => {
  const lowConfidence = await normalizeMarketItem(rawItem({
    providerId: "feed-a",
    summary: "The first feed reports an early financing signal.",
    confidence: "low",
  }), { retrievedAt: NOW });
  const highConfidence = await normalizeMarketItem(rawItem({
    providerId: "feed-b",
    summary: "The second feed reports a confirmed strategic financing.",
    confidence: "high",
  }), { retrievedAt: NOW });

  const forward = dedupeEvents([lowConfidence, highConfidence]);
  const reverse = dedupeEvents([highConfidence, lowConfidence]);

  assert.deepEqual(forward, reverse);
  assert.equal(forward.length, 2);
  assert.deepEqual(
    forward.map((candidate) => candidate.summary).sort(),
    [
      "The first feed reports an early financing signal.",
      "The second feed reports a confirmed strategic financing.",
    ],
  );
  assert.ok(forward.every((candidate) => candidate.sources.length === 1));
  assert.equal(
    new Set(forward.flatMap((candidate) =>
      candidate.sources.map((source) => source.id)
    )).size,
    1,
    "semantic event variants share one acquisition-independent evidence unit",
  );

  let reasonerCalls = 0;
  const matching = createMatchingService({
    async reason() {
      reasonerCalls += 1;
      return [];
    },
  });
  await matching.analyze({
    deals: [],
    events: forward,
    memoryContexts: [],
    sources: forward.flatMap((candidate) => candidate.sources),
  });
  assert.equal(reasonerCalls, 1);
});

test("same-URL document revisions remain separate observations", async () => {
  const original = await normalizeMarketItem(rawItem({
    providerId: "feed-a",
  }), { retrievedAt: NOW });
  const revised = await normalizeMarketItem(rawItem({
    providerId: "feed-b",
    normalizedStatement:
      "Acme revised its announcement with materially different terms.",
    summary: "Acme revised its Series B announcement.",
    updatedAt: "2026-07-24T10:00:00.000Z",
  }), { retrievedAt: NOW });

  const result = dedupeEvents([original, revised]);

  assert.equal(result.length, 2);
  assert.notEqual(
    result[0].sources[0].contentFingerprint,
    result[1].sources[0].contentFingerprint,
  );
});

test("adding corroborating evidence creates a new immutable event evidence version", () => {
  const baseline = event();
  const corroborating = reidentifySourceRef(sourceV2({
    id: "corroborating_pending",
    title: "Independent Acme coverage",
    canonicalUrl: "https://publisher.example/acme-series-b",
    publisher: "Independent Publisher",
    providerId: "independent-feed",
    evidenceRole: "corroborating",
    text: {
      status: "normalized_only",
      normalizedStatement: "Independent coverage confirmed Acme's financing.",
    },
  }) as Parameters<typeof reidentifySourceRef>[0]);
  const enrichedVersion = refingerprintMarketEvent({
    ...baseline,
    id: "market_with_corroboration",
    sources: [...baseline.sources, corroborating],
  });

  const forward = dedupeEvents([baseline, enrichedVersion]);
  const reverse = dedupeEvents([enrichedVersion, baseline]);
  assert.deepEqual(forward, reverse);
  assert.equal(forward.length, 2);
  assert.deepEqual(
    forward.map((candidate) => candidate.sources.length).sort(),
    [1, 2],
  );
});

test("same document revision preserves distinct trigger and counterevidence observations", () => {
  const original = event();
  const trigger = reidentifySourceRef({
    ...original.sources[0],
    sourceRevisionId: "revision_acme_announcement",
    locator: { kind: "web_text" as const, selector: "#trigger" },
    text: {
      status: "verified_exact" as const,
      verbatimExcerpt: "Acme closed its Series B funding round.",
      normalizedStatement: "Acme completed its Series B financing.",
    },
  });
  const counterevidence = reidentifySourceRef({
    ...trigger,
    evidenceRole: "counterevidence",
    locator: { kind: "web_text" as const, selector: "#risk" },
    text: {
      status: "verified_exact" as const,
      verbatimExcerpt: "Acme expects materially higher operating costs.",
      normalizedStatement: "Acme expects its operating costs to rise materially.",
    },
  });
  const baseline = refingerprintMarketEvent({
    ...original,
    id: "market_baseline_revision",
    triggerSourceId: trigger.id,
    sources: [trigger],
  });
  const withRisk = refingerprintMarketEvent({
    ...baseline,
    id: "market_revision_with_risk",
    negativeImplications: ["Operating costs may rise materially."],
    sources: [trigger, counterevidence],
  });

  const observations = dedupeEvents([baseline, withRisk]);

  assert.equal(observations.length, 2);
  const riskObservation = observations.find((candidate) =>
    candidate.negativeImplications.includes(
      "Operating costs may rise materially.",
    )
  );
  assert.ok(riskObservation);
  assert.ok(riskObservation.sources.some((source) =>
    source.evidenceRole === "counterevidence"
      && source.locator?.kind === "web_text"
      && source.locator.selector === "#risk"
  ));
});

test("same evidence reference with conflicting authority metadata fails closed", () => {
  const baseline = event();
  const conflictingSource = reidentifySourceRef({
    ...baseline.sources[0],
    sourceClass: "industry_publication",
    sourceAuthority: "secondary",
  });
  const conflicting = refingerprintMarketEvent({
    ...baseline,
    id: "market_conflicting_source_metadata",
    triggerSourceId: conflictingSource.id,
    sources: [conflictingSource],
  });

  assert.throws(
    () => dedupeEvents([baseline, conflicting]),
    /conflicting evidence metadata/i,
  );
});

test("same immutable locator with conflicting exact text fails closed", () => {
  const original = event();
  const trigger = reidentifySourceRef({
    ...original.sources[0],
    sourceRevisionId: "revision_shared_locator",
    locator: { kind: "web_text" as const, selector: "#same" },
    text: {
      status: "verified_exact" as const,
      verbatimExcerpt: "Acme closed its Series B funding round.",
      normalizedStatement: "Acme completed its Series B financing.",
    },
  });
  const conflictingTrigger = reidentifySourceRef({
    ...trigger,
    text: {
      status: "verified_exact" as const,
      verbatimExcerpt: "Acme did not close its Series B funding round.",
      normalizedStatement: "Acme did not complete its Series B financing.",
    },
  });
  const baseline = refingerprintMarketEvent({
    ...original,
    id: "market_shared_locator_baseline",
    triggerSourceId: trigger.id,
    sources: [trigger],
  });
  const conflicting = refingerprintMarketEvent({
    ...original,
    id: "market_shared_locator_conflict",
    triggerSourceId: conflictingTrigger.id,
    sources: [conflictingTrigger],
  });

  assert.throws(
    () => dedupeEvents([baseline, conflicting]),
    /conflicting evidence metadata/i,
  );
});

test("dedupe rejects a single event that repeats one intrinsic unit under another role", () => {
  const baseline = event();
  const roleSpoof = {
    ...baseline.sources[0],
    id: "source_role_spoof",
    evidenceRole: "counterevidence" as const,
  };
  const invalid = {
    ...baseline,
    sources: [baseline.sources[0], roleSpoof],
  };

  assert.throws(
    () => dedupeEvents([invalid as never]),
    /intrinsic evidence unit/i,
  );
});

test("set-like market fields have permutation-stable canonical identity", async () => {
  const first = await normalizeMarketItem(rawItem({
    entities: ["partner", "acme", "partner"],
    sectors: ["workflow", "healthcare", "workflow"],
    themes: ["growth", "automation", "growth"],
    positiveImplications: ["Demand rises.", "Adoption accelerates."],
    negativeImplications: ["Competition rises.", "Margins compress."],
  }), { retrievedAt: NOW });
  const permuted = await normalizeMarketItem(rawItem({
    entities: ["acme", "partner"],
    sectors: ["healthcare", "workflow"],
    themes: ["automation", "growth"],
    positiveImplications: ["Adoption accelerates.", "Demand rises."],
    negativeImplications: ["Margins compress.", "Competition rises."],
  }), { retrievedAt: NOW });

  assert.deepEqual(permuted, first);
  assert.deepEqual(first.entityKeys, ["acme", "partner"]);
  assert.deepEqual(first.sectors, ["healthcare", "workflow"]);
});

test("canonical market identity never depends on the host locale", () => {
  const originalLocaleCompare = String.prototype.localeCompare;
  String.prototype.localeCompare = function forbiddenLocaleCompare() {
    throw new Error("localeCompare cannot participate in canonical identity");
  };
  try {
    const canonical = event({
      sectors: ["ä-sector", "z-sector"],
      themes: ["ö-theme", "a-theme"],
    });
    assert.deepEqual(canonical.sectors, ["z-sector", "ä-sector"]);
    assert.deepEqual(canonical.themes, ["a-theme", "ö-theme"]);
    assertMarketEventFingerprint(canonical);
    assert.equal(
      canonicalizeUrl("https://example.com/path?ä=2&z=1"),
      "https://example.com/path?z=1&%C3%A4=2",
    );
  } finally {
    String.prototype.localeCompare = originalLocaleCompare;
  }
});

test("rejects non-canonical URLs at canonical contract construction", () => {
  assert.throws(
    () => event({
      canonicalUrl:
        "https://acme.example/news/series-b?utm_source=tracking",
    }),
    /canonical.*HTTP|Source URL/i,
  );
});

test("canonical event fingerprints bind payload while allowing explicit stable IDs", () => {
  const stable = refingerprintMarketEvent({
    ...event(),
    id: "event_henry_series_a_v1",
  });
  assert.equal(stable.id, "event_henry_series_a_v1");
  assert.doesNotThrow(() => assertMarketEventFingerprint(stable));
  assert.throws(
    () => dedupeEvents([{ ...stable, summary: "Mutated after fingerprinting." }]),
    /fingerprint.*canonical payload/i,
  );
});

test("identity helpers hash schema-normalized persisted payloads", () => {
  const rawSource = sourceV2({
    title: "  Acme funding announcement  ",
  }) as Parameters<typeof reidentifySourceRef>[0];
  const identifiedSource = reidentifySourceRef(rawSource);
  const normalizedSource = WritableSourceRefV2Schema.parse(rawSource);
  assert.equal(identifiedSource.title, "Acme funding announcement");
  assert.equal(
    identifiedSource.id,
    reidentifySourceRef(normalizedSource).id,
  );

  const rawEvent = {
    ...event(),
    title: "  Acme closes Series B funding round  ",
  } as Parameters<typeof reidentifyMarketEvent>[0];
  const identifiedEvent = reidentifyMarketEvent(rawEvent);
  const normalizedEvent = WritableMarketEventV2Schema.parse(rawEvent);
  assert.equal(identifiedEvent.title, "Acme closes Series B funding round");
  assert.equal(
    identifiedEvent.id,
    reidentifyMarketEvent(normalizedEvent).id,
  );
  assert.doesNotThrow(() => assertMarketEventFingerprint(identifiedEvent));

  const refingerprinted = refingerprintMarketEvent({
    ...event(),
    title: "  Acme closes Series B funding round  ",
  });
  assert.equal(refingerprinted.title, "Acme closes Series B funding round");
  assert.doesNotThrow(() => assertMarketEventFingerprint(refingerprinted));
});

test("deduplicates semantically similar titles from the same publication day", () => {
  const duplicate = event({
    id: "market_2",
    eventAt: "2026-07-23",
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

  assert.equal(
    dedupeEvents([event({ eventAt: "2026-07-23" }), duplicate]).length,
    1,
  );

  const nextDay = duplicate.publishedAt.replace("2026-07-23", "2026-07-24");
  const nextDayRetrieval = "2026-07-24T19:00:00.000Z";
  assert.equal(
    dedupeEvents([
      event(),
      refingerprintMarketEvent({
        ...duplicate,
        publishedAt: nextDay,
        retrievedAt: nextDayRetrieval,
        sources: duplicate.sources.map((source) => ({
          ...source,
          publishedAt: nextDay,
          retrievedAt: nextDayRetrieval,
        })),
      }),
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
  assert.equal(normalized.sources[0].canonicalUrl, normalized.canonicalUrl);
  assert.doesNotThrow(() => assertMarketEventFingerprint(normalized));
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

test("normalization preserves provider date-only precision", async () => {
  const normalized = await normalizeMarketItem(rawItem({
    eventAt: "2026-07-23",
    publishedAt: "2026-07-23",
    updatedAt: "2026-07-23",
  }), { retrievedAt: NOW });

  assert.equal(normalized.eventAt, "2026-07-23");
  assert.equal(normalized.eventAtPrecision, "date");
  assert.equal(normalized.publishedAt, "2026-07-23");
  assert.equal(normalized.publishedAtPrecision, "date");
  assert.equal(normalized.updatedAt, "2026-07-23");
  assert.equal(normalized.updatedAtPrecision, "date");
  assert.equal(normalized.retrievedAtPrecision, "timestamp");
});

test("normalization rejects offset-less provider datetimes instead of inventing an instant", async () => {
  for (const overrides of [
    { eventAt: "2026-07-23T12:00:00" },
    { publishedAt: "2026-07-23T12:00:00" },
    { retrievedAt: "2026-07-23T12:00:00" },
    { updatedAt: "2026-07-23T12:00:00" },
  ]) {
    await assert.rejects(
      normalizeMarketItem(rawItem(overrides), { retrievedAt: NOW }),
      /invalid .* time/i,
    );
  }
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
      eventAtPrecision: "timestamp",
      publishedAt: laterPublishedAt,
      retrievedAt: laterRetrievedAt,
      sources: [sourceV2({
        id: "source_v2_2",
        eventAt: "2026-07-24T14:00:00.000Z",
        eventAtPrecision: "timestamp",
        publishedAt: laterPublishedAt,
        retrievedAt: laterRetrievedAt,
      })],
      triggerSourceId: "source_v2_2",
    }),
  ] as never);

  assert.equal(result.length, 2);

  const sameDayDifferentPublication = dedupeEvents([
    eventV2(),
    eventV2({
      id: "market_v2_same_day",
      publishedAt: "2026-07-23T16:00:00.000Z",
      sources: [sourceV2({
        id: "source_v2_same_day",
        publishedAt: "2026-07-23T16:00:00.000Z",
      })],
      triggerSourceId: "source_v2_same_day",
    }),
  ] as never);
  assert.equal(
    sameDayDifferentPublication.length,
    2,
    "same-day publication instants on a rolling URL are distinct events",
  );

  const differentEventAt = dedupeEvents([
    eventV2(),
    eventV2({
      id: "market_v2_event_at",
      eventAt: "2026-07-23T14:00:00.000Z",
      eventAtPrecision: "timestamp",
      sources: [sourceV2({
        id: "source_v2_event_at",
        eventAt: "2026-07-23T14:00:00.000Z",
        eventAtPrecision: "timestamp",
      })],
      triggerSourceId: "source_v2_event_at",
    }),
  ] as never);
  assert.equal(
    differentEventAt.length,
    2,
    "different event instants on a rolling URL are distinct events",
  );
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
    eventAt: "2026-07-23",
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

  assert.equal(
    dedupeEvents([event({ eventAt: "2026-07-23" }), syndicated]).length,
    1,
  );
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

test("does not fuzzy-merge same-day lookalike headlines for disjoint entities", () => {
  const first = event({
    title:
      "Acme announces a major strategic Series B financing round to accelerate its global artificial intelligence infrastructure platform expansion",
    canonicalUrl: "https://publisher.example/acme-series-b",
    entityKeys: ["acme"],
    sources: [{
      id: "source_acme_lookalike",
      title: "Acme financing announcement",
      url: "https://publisher.example/acme-series-b",
      publisher: "Publisher",
      publishedAt: "2026-07-23T18:00:00.000Z",
      excerpt: "Acme announced its Series B financing.",
    }],
  });
  const second = event({
    id: "market_beta_lookalike",
    title:
      "Beta announces a major strategic Series B financing round to accelerate its global artificial intelligence infrastructure platform expansion",
    canonicalUrl: "https://publisher.example/beta-series-b",
    entityKeys: ["beta"],
    sources: [{
      id: "source_beta_lookalike",
      title: "Beta financing announcement",
      url: "https://publisher.example/beta-series-b",
      publisher: "Publisher",
      publishedAt: "2026-07-23T18:00:00.000Z",
      excerpt: "Beta announced its Series B financing.",
    }],
  });

  const result = dedupeEvents([first, second]);
  const reverse = dedupeEvents([second, first]);

  assert.deepEqual(result, reverse);
  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map((candidate) => candidate.entityKeys).sort(),
    [["acme"], ["beta"]],
  );
  assert.ok(result.every((candidate) => candidate.sources.length === 1));

  const unknownEntity = event({
    id: "market_unknown_lookalike",
    title:
      "Gamma announces a major strategic Series B financing round to accelerate its global artificial intelligence infrastructure platform expansion",
    canonicalUrl: "https://publisher.example/gamma-series-b",
    entityKeys: [],
    sources: [{
      id: "source_unknown_lookalike",
      title: "Gamma financing announcement",
      url: "https://publisher.example/gamma-series-b",
      publisher: "Publisher",
      publishedAt: "2026-07-23T18:00:00.000Z",
      excerpt: "Gamma announced its Series B financing.",
    }],
  });
  assert.equal(dedupeEvents([first, unknownEntity]).length, 2);
});

test("does not fuzzy-merge same-entity actions with different or unknown event dates", () => {
  const first = event({
    id: "market_acme_alpha_action",
    title:
      "FDA publishes Acme Alpha action after a comprehensive regulatory review of the company artificial intelligence diagnostics platform",
    eventType: "regulatory",
    eventAt: "2026-07-22",
    canonicalUrl: "https://fda.example/acme-alpha-action",
    entityKeys: ["acme"],
    sources: [{
      id: "source_acme_alpha_action",
      title: "FDA Acme Alpha action",
      url: "https://fda.example/acme-alpha-action",
      publisher: "FDA",
      publishedAt: "2026-07-23T18:00:00.000Z",
      excerpt: "FDA published the Acme Alpha action.",
    }],
  });
  const second = event({
    id: "market_acme_beta_action",
    title:
      "FDA publishes Acme Beta action after a comprehensive regulatory review of the company artificial intelligence diagnostics platform",
    eventType: "regulatory",
    eventAt: "2026-07-23",
    canonicalUrl: "https://fda.example/acme-beta-action",
    entityKeys: ["acme"],
    sources: [{
      id: "source_acme_beta_action",
      title: "FDA Acme Beta action",
      url: "https://fda.example/acme-beta-action",
      publisher: "FDA",
      publishedAt: "2026-07-23T18:00:00.000Z",
      excerpt: "FDA published the Acme Beta action.",
    }],
  });

  const forward = dedupeEvents([first, second]);
  const reverse = dedupeEvents([second, first]);
  assert.deepEqual(forward, reverse);
  assert.equal(forward.length, 2);
  assert.ok(forward.every((candidate) => candidate.sources.length === 1));

  const unknownDate = event({
    id: "market_acme_unknown_date_action",
    title:
      "FDA publishes Acme Gamma action after a comprehensive regulatory review of the company artificial intelligence diagnostics platform",
    eventType: "regulatory",
    canonicalUrl: "https://fda.example/acme-unknown-date-action",
    entityKeys: ["acme"],
    sources: [{
      id: "source_acme_unknown_date_action",
      title: "FDA Acme unknown-date action",
      url: "https://fda.example/acme-unknown-date-action",
      publisher: "FDA",
      publishedAt: "2026-07-23T18:00:00.000Z",
      excerpt: "FDA published another Acme action.",
    }],
  });
  assert.equal(dedupeEvents([first, unknownDate]).length, 2);
});

test("deterministically ranks and caps market events for downstream analysis", () => {
  const candidates = [
    event({
      id: "medium-new",
      confidence: "medium",
      publishedAt: "2026-07-24T11:00:00.000Z",
      canonicalUrl: "https://example.com/medium-new",
    }),
    event({
      id: "high-old",
      confidence: "high",
      publishedAt: "2026-07-20T11:00:00.000Z",
      canonicalUrl: "https://example.com/high-old",
    }),
    event({
      id: "high-new-b",
      confidence: "high",
      publishedAt: "2026-07-24T10:00:00.000Z",
      canonicalUrl: "https://example.com/high-new-b",
    }),
    event({
      id: "high-new-a",
      confidence: "high",
      publishedAt: "2026-07-24T10:00:00.000Z",
      canonicalUrl: "https://example.com/high-new-a",
    }),
  ];
  const selected = selectMarketEventsForAnalysis(candidates, 3);
  const repeated = selectMarketEventsForAnalysis(candidates, 3);

  assert.deepEqual(
    repeated.events.map((candidate) => candidate.id),
    selected.events.map((candidate) => candidate.id),
  );
  assert.deepEqual(
    selected.events.slice(0, 2).map((candidate) => candidate.canonicalUrl).sort(),
    ["https://example.com/high-new-a", "https://example.com/high-new-b"],
  );
  assert.equal(selected.events[2].canonicalUrl, "https://example.com/high-old");
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
    selected.events.map((candidate) => candidate.title),
    ["Cannabis brand closes Series B funding round"],
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
    selected.events.some((candidate) =>
      candidate.canonicalUrl === "https://relevant.example/amazon"
    ),
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
    selected.events.map((candidate) => candidate.title),
    ["Robotics startup closes a $40 million Series B"],
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
  assert.deepEqual(
    persisted[0][0],
    result.events[0],
    "the service must persist and return the same classified canonical event",
  );
  const selected = selectMarketEventsForAnalysis(result.events);
  assert.equal(selected.events.length, 1);
  assert.deepEqual(
    selected.events[0],
    persisted[0][0],
    "downstream selection must be identity-idempotent",
  );
  assert.equal(selected.events[0].id, persisted[0][0].id);
  assert.equal(
    selected.events[0].contentFingerprint,
    persisted[0][0].contentFingerprint,
  );
  assert.deepEqual(selected.events[0].themes, ["funding"]);
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
