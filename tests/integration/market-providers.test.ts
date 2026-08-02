import assert from "node:assert/strict";
import test from "node:test";

import {
  createCrunchbaseProvider,
  createDefaultMarketProviders,
  createFederalRegisterProvider,
  createRssMarketProvider,
  MAX_FETCH_ATTEMPTS,
  REQUEST_TIMEOUT_MS,
} from "../../lib/market/providers";
import { createMarketService } from "../../lib/market/service";

const NOW = new Date("2026-07-24T12:00:00.000Z");
const WINDOW = {
  from: new Date("2026-07-10T12:00:00.000Z"),
  to: NOW,
};

const RECORDED_COMPANY_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Acme Newsroom</title>
    <item>
      <guid>acme-series-b</guid>
      <title><![CDATA[Acme closes Series B funding round]]></title>
      <link>https://acme.example/news/series-b?utm_source=rss</link>
      <pubDate>Thu, 23 Jul 2026 15:00:00 GMT</pubDate>
      <description><![CDATA[<p>Acme announced that it closed a Series B funding round.</p>]]></description>
    </item>
    <item>
      <guid>acme-old</guid>
      <title>Acme opens its first office</title>
      <link>https://acme.example/news/first-office</link>
      <pubDate>Wed, 01 Jul 2026 08:00:00 GMT</pubDate>
      <description>Acme opened its first office.</description>
    </item>
  </channel>
</rss>`;

const RECORDED_SEC_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>SEC Press Releases</title>
  <entry>
    <id>sec-release-2026-91</id>
    <title>SEC Announces Public Regulatory Roundtable</title>
    <link rel="alternate" href="https://www.sec.gov/newsroom/press-releases/2026-91"/>
    <published>2026-07-22T14:00:00Z</published>
    <summary>The Commission announced a public regulatory roundtable.</summary>
  </entry>
</feed>`;

const RECORDED_FEDERAL_REGISTER_JSON = {
  count: 1,
  results: [{
    document_number: "2026-12345",
    title: "Health Data Interoperability Request for Information",
    html_url:
      "https://www.federalregister.gov/documents/2026/07/21/2026-12345/health-data-interoperability",
    publication_date: "2026-07-21",
    abstract:
      "The agency requests public comment on health data interoperability.",
  }],
};

const RECORDED_CRUNCHBASE_JSON = {
  entities: [{
    uuid: "funding-round-uuid",
    properties: {
      identifier: {
        value: "Series B - Acme",
        permalink: "acme-series-b--funding-round",
      },
      announced_on: "2026-07-20",
      funded_organization_identifier: {
        value: "Acme",
        permalink: "acme",
      },
      money_raised: {
        value: 40_000_000,
        currency: "USD",
      },
      funded_organization_categories: [{
        value: "Health Care",
        permalink: "health-care",
      }],
      investor_identifiers: [{
        value: "Example Ventures",
        permalink: "example-ventures",
      }],
    },
  }],
};

type FetchCall = {
  url: string;
  init?: RequestInit;
};

function recordingFetch(
  responses: Array<Response | Error>,
  calls: FetchCall[],
) {
  return async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({ url: String(input), init });
    const response = responses.shift();
    if (!response) {
      throw new Error("No recorded response remains.");
    }
    if (response instanceof Error) {
      throw response;
    }
    return response;
  };
}

test("RSS emits normalized-only prose with explicit source provenance", async () => {
  const calls: FetchCall[] = [];
  const fetch = recordingFetch([
    new Response(RECORDED_COMPANY_RSS, {
      status: 200,
      headers: { "content-type": "application/rss+xml" },
    }),
    new Response(RECORDED_SEC_ATOM, {
      status: 200,
      headers: { "content-type": "application/atom+xml" },
    }),
  ], calls);

  const company = createRssMarketProvider({
    id: "acme-announcements",
    name: "Acme announcements",
    url: "https://acme.example/news/rss.xml",
    publisher: "Acme",
    eventType: "company_announcement",
    sourceClass: "company_official",
    sourceAuthority: "primary",
    evidenceRole: "trigger",
  }, { fetch });
  const sec = createRssMarketProvider({
    id: "sec-public-releases",
    name: "SEC public releases",
    url: "https://www.sec.gov/news/pressreleases.rss",
    publisher: "U.S. Securities and Exchange Commission",
    eventType: "regulatory",
    sourceClass: "government_or_regulator",
    sourceAuthority: "primary",
    evidenceRole: "trigger",
  }, { fetch });

  const [companyItems, secItems] = await Promise.all([
    company.fetch(WINDOW),
    sec.fetch(WINDOW),
  ]);

  assert.equal(companyItems.length, 2);
  assert.deepEqual(companyItems[0], {
    providerId: "acme-announcements",
    externalId: "acme-series-b",
    title: "Acme closes Series B funding round",
    url: "https://acme.example/news/series-b?utm_source=rss",
    publisher: "Acme",
    sourceClass: "company_official",
    sourceAuthority: "primary",
    evidenceRole: "trigger",
    publishedAt: "2026-07-23T15:00:00.000Z",
    summary: "Acme announced that it closed a Series B funding round.",
    normalizedStatement:
      "Acme announced that it closed a Series B funding round.",
    eventType: "company_announcement",
    sectors: [],
    themes: [],
    confidence: "medium",
  });
  assert.equal(secItems[0].externalId, "sec-release-2026-91");
  assert.equal(secItems[0].sourceClass, "government_or_regulator");
  assert.equal(secItems[0].sourceAuthority, "primary");
  assert.equal(secItems[0].evidenceRole, "trigger");
  assert.equal("evidenceExcerpt" in companyItems[0], false);
  assert.equal(
    secItems[0].url,
    "https://www.sec.gov/newsroom/press-releases/2026-91",
  );

  assert.equal(calls.length, 2);
  for (const call of calls) {
    const headers = new Headers(call.init?.headers);
    assert.match(headers.get("user-agent") ?? "", /XTrace Market Intelligence/);
    assert.equal(headers.get("accept-encoding"), "gzip, deflate");
    assert.ok(call.init?.signal instanceof AbortSignal);
  }
  assert.equal(REQUEST_TIMEOUT_MS, 10_000);
});

test("allows a deployer to identify itself with an SEC-compatible contact", async () => {
  const calls: FetchCall[] = [];
  const provider = createRssMarketProvider({
    id: "identified-feed",
    name: "Identified feed",
    url: "https://publisher.example/feed.xml",
    publisher: "Publisher",
  }, {
    fetch: recordingFetch([
      new Response(RECORDED_COMPANY_RSS, { status: 200 }),
    ], calls),
    userAgent: "XTrace VC Demo market-ops@example.com",
  });

  await provider.fetch(WINDOW);

  assert.equal(
    new Headers(calls[0].init?.headers).get("user-agent"),
    "XTrace VC Demo market-ops@example.com",
  );
});

test("Federal Register emits normalized-only primary government evidence", async () => {
  const calls: FetchCall[] = [];
  const provider = createFederalRegisterProvider({
    fetch: recordingFetch([
      Response.json(RECORDED_FEDERAL_REGISTER_JSON),
    ], calls),
  });

  const items = await provider.fetch(WINDOW);

  assert.equal(items.length, 1);
  assert.equal(items[0].providerId, "federal-register");
  assert.equal(items[0].publishedAt, "2026-07-21");
  assert.equal(items[0].eventType, "regulatory");
  assert.equal(
    items[0].normalizedStatement,
    "The agency requests public comment on health data interoperability.",
  );
  assert.equal(items[0].sourceClass, "government_or_regulator");
  assert.equal(items[0].sourceAuthority, "primary");
  assert.equal(items[0].evidenceRole, "trigger");
  assert.equal("evidenceExcerpt" in items[0], false);

  const requestUrl = new URL(calls[0].url);
  assert.equal(requestUrl.hostname, "www.federalregister.gov");
  assert.equal(
    requestUrl.searchParams.get("conditions[publication_date][gte]"),
    "2026-07-10",
  );
  assert.equal(
    requestUrl.searchParams.get("conditions[publication_date][lte]"),
    "2026-07-24",
  );
});

test("paginates Federal Register results instead of silently truncating", async () => {
  const calls: FetchCall[] = [];
  const secondDocument = {
    ...RECORDED_FEDERAL_REGISTER_JSON.results[0],
    document_number: "2026-12346",
    title: "Second Health Data Notice",
    html_url:
      "https://www.federalregister.gov/documents/2026/07/22/2026-12346/second-notice",
    publication_date: "2026-07-22",
  };
  const provider = createFederalRegisterProvider({
    fetch: recordingFetch([
      Response.json({
        count: 2,
        results: RECORDED_FEDERAL_REGISTER_JSON.results,
      }),
      Response.json({
        count: 2,
        results: [secondDocument],
      }),
    ], calls),
  });

  const items = await provider.fetch(WINDOW);

  assert.equal(items.length, 2);
  assert.equal(new URL(calls[1].url).searchParams.get("page"), "2");
});

test("covers an eleven-page Federal Register window within the bounded limit", async () => {
  const calls: FetchCall[] = [];
  const provider = createFederalRegisterProvider({
    fetch: recordingFetch(
      Array.from({ length: 11 }, (_, index) => Response.json({
        count: 11,
        results: [{
          ...RECORDED_FEDERAL_REGISTER_JSON.results[0],
          document_number: `2026-${String(index + 1).padStart(5, "0")}`,
          title: `Federal Register notice ${index + 1}`,
        }],
      })),
      calls,
    ),
  });

  const items = await provider.fetch(WINDOW);

  assert.equal(items.length, 11);
  assert.equal(calls.length, 11);
  assert.equal(new URL(calls[10].url).searchParams.get("page"), "11");
});

test("reports a bounded pagination error instead of returning a truncated result", async () => {
  const calls: FetchCall[] = [];
  const provider = createFederalRegisterProvider({
    fetch: recordingFetch(
      Array.from({ length: 20 }, () => Response.json({
        count: 21,
        results: RECORDED_FEDERAL_REGISTER_JSON.results,
      })),
      calls,
    ),
  });

  await assert.rejects(provider.fetch(WINDOW), /bounded 20-page scan limit/i);
  assert.equal(calls.length, 20);
});

test("retries transient provider failures at most three times", async () => {
  const calls: FetchCall[] = [];
  const delays: number[] = [];
  const provider = createRssMarketProvider({
    id: "retrying-feed",
    name: "Retrying feed",
    url: "https://publisher.example/feed.xml",
    publisher: "Publisher",
  }, {
    fetch: recordingFetch([
      new Response("temporary", { status: 503 }),
      new Response("rate limited", { status: 429 }),
      new Response(RECORDED_COMPANY_RSS, { status: 200 }),
    ], calls),
    random: () => 0.5,
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
  });

  const items = await provider.fetch(WINDOW);

  assert.equal(items.length, 2);
  assert.equal(calls.length, MAX_FETCH_ATTEMPTS);
  assert.equal(delays.length, MAX_FETCH_ATTEMPTS - 1);
  assert.ok(delays.every((delay) => delay > 0 && delay <= 2_000));
});

test("does not retry a nonretryable provider response", async () => {
  const calls: FetchCall[] = [];
  const delays: number[] = [];
  const provider = createRssMarketProvider({
    id: "missing-feed",
    name: "Missing feed",
    url: "https://publisher.example/missing.xml",
    publisher: "Publisher",
  }, {
    fetch: recordingFetch([
      new Response("not found", { status: 404 }),
      new Response(RECORDED_COMPANY_RSS, { status: 200 }),
    ], calls),
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
  });

  await assert.rejects(provider.fetch(WINDOW), /HTTP 404/);
  assert.equal(calls.length, 1);
  assert.deepEqual(delays, []);
});

test("rejects a successful HTTP response that is not an RSS or Atom document", async () => {
  const provider = createRssMarketProvider({
    id: "invalid-feed",
    name: "Invalid feed",
    url: "https://publisher.example/feed.xml",
    publisher: "Publisher",
  }, {
    fetch: async () => new Response("<html>not a feed</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
  });

  await assert.rejects(provider.fetch(WINDOW), /RSS or Atom/i);
});

test("does not treat an Atom update timestamp as a new publication", async () => {
  const updatedOnlyAtom = `<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <id>old-story</id>
        <title>Old story edited today</title>
        <link href="https://publisher.example/old-story"/>
        <updated>2026-07-23T12:00:00Z</updated>
        <summary>The publisher edited an older story.</summary>
      </entry>
    </feed>`;
  const provider = createRssMarketProvider({
    id: "atom-feed",
    name: "Atom feed",
    url: "https://publisher.example/feed.xml",
    publisher: "Publisher",
  }, {
    fetch: async () => new Response(updatedOnlyAtom, { status: 200 }),
  });

  const items = await provider.fetch(WINDOW);

  assert.equal(items[0].publishedAt, undefined);
  assert.equal(
    (items[0] as typeof items[number] & { updatedAt?: string }).updatedAt,
    "2026-07-23T12:00:00.000Z",
  );
});

test("RSS does not invent a timezone for an offset-less publication datetime", async () => {
  const offsetlessRss = `<?xml version="1.0"?>
    <rss version="2.0"><channel><item>
      <guid>offsetless-story</guid>
      <title>Offset-less story</title>
      <link>https://publisher.example/offsetless-story</link>
      <pubDate>2026-07-23T12:00:00</pubDate>
      <description>The publisher omitted the required timezone.</description>
    </item></channel></rss>`;
  const provider = createRssMarketProvider({
    id: "offsetless-feed",
    name: "Offset-less feed",
    url: "https://publisher.example/feed.xml",
    publisher: "Publisher",
  }, {
    fetch: async () => new Response(offsetlessRss, { status: 200 }),
  });

  const [raw] = await provider.fetch(WINDOW);
  assert.equal(raw.publishedAt, undefined);

  const scan = await createMarketService({ providers: [provider] })
    .scanMarketWindow({ now: NOW, days: 14 });
  assert.deepEqual(scan.events, []);
  assert.equal(scan.providers[0].acceptedCount, 0);
  assert.equal(scan.providers[0].rejectedCount, 1);
});

test("RSS rejects impossible calendars and every timestamp without an explicit zone", async () => {
  const invalidDates = [
    "2026-02-30",
    "2026-02-30T12:00:00Z",
    "30 Feb 2026 12:00:00 GMT",
    "2026-07-23 12:00:00",
    "Jul 23 2026 12:00:00",
  ];
  const feed = `<?xml version="1.0"?><rss version="2.0"><channel>${
    invalidDates.map((date, index) => `<item>
      <guid>invalid-date-${index}</guid>
      <title>Invalid date story ${index}</title>
      <link>https://publisher.example/invalid-date-${index}</link>
      <pubDate>${date}</pubDate>
      <description>The date must fail closed.</description>
    </item>`).join("")
  }</channel></rss>`;
  const provider = createRssMarketProvider({
    id: "invalid-date-feed",
    name: "Invalid date feed",
    url: "https://publisher.example/feed.xml",
    publisher: "Publisher",
  }, {
    fetch: async () => new Response(feed, { status: 200 }),
  });

  const items = await provider.fetch(WINDOW);
  assert.equal(items.length, invalidDates.length);
  assert.ok(items.every((item) => item.publishedAt === undefined));

  const scan = await createMarketService({ providers: [provider] })
    .scanMarketWindow({ now: NOW, days: 14 });
  assert.deepEqual(scan.events, []);
  assert.equal(scan.providers[0].acceptedCount, 0);
  assert.equal(scan.providers[0].rejectedCount, invalidDates.length);
});

test("Crunchbase emits synthesized normalized-only secondary database evidence", async () => {
  const calls: FetchCall[] = [];
  const provider = createCrunchbaseProvider("authorized-test-key", {
    fetch: recordingFetch([
      Response.json(RECORDED_CRUNCHBASE_JSON),
    ], calls),
  });

  const items = await provider.fetch(WINDOW);

  assert.equal(items.length, 1);
  assert.equal(items[0].providerId, "crunchbase");
  assert.equal(items[0].title, "Acme — Series B - Acme");
  assert.equal(items[0].eventAt, undefined);
  assert.equal(items[0].publishedAt, "2026-07-20");
  assert.match(items[0].normalizedStatement ?? "", /USD 40000000/);
  assert.equal(items[0].sourceClass, "commercial_database");
  assert.equal(items[0].sourceAuthority, "secondary");
  assert.equal(items[0].evidenceRole, "trigger");
  assert.equal("evidenceExcerpt" in items[0], false);
  assert.deepEqual(items[0].sectors, ["Health Care"]);
  assert.deepEqual(items[0].themes, ["funding", "investor:Example Ventures"]);

  const headers = new Headers(calls[0].init?.headers);
  assert.equal(headers.get("x-cb-user-key"), "authorized-test-key");
  assert.equal(calls[0].init?.method, "POST");
  const body = JSON.parse(String(calls[0].init?.body)) as {
    query: Array<{ field_id: string; values: string[] }>;
  };
  assert.deepEqual(
    body.query.map((predicate) => predicate.field_id),
    ["announced_on", "announced_on"],
  );
  assert.deepEqual(
    body.query.map((predicate) => predicate.values[0]),
    ["2026-07-10", "2026-07-24"],
  );
  assert.deepEqual(
    (JSON.parse(String(calls[0].init?.body)) as { field_ids: string[] })
      .field_ids,
    [
      "identifier",
      "announced_on",
      "funded_organization_identifier",
      "money_raised",
      "funded_organization_categories",
      "investor_identifiers",
    ],
  );
});

test("paginates authorized Crunchbase searches with after_id", async () => {
  const calls: FetchCall[] = [];
  const secondEntity = {
    ...RECORDED_CRUNCHBASE_JSON.entities[0],
    uuid: "second-funding-round-uuid",
    properties: {
      ...RECORDED_CRUNCHBASE_JSON.entities[0].properties,
      identifier: {
        value: "Seed - Beta",
        permalink: "beta-seed--funding-round",
      },
      funded_organization_identifier: {
        value: "Beta",
        permalink: "beta",
      },
    },
  };
  const provider = createCrunchbaseProvider("authorized-test-key", {
    fetch: recordingFetch([
      Response.json({
        count: 2,
        entities: RECORDED_CRUNCHBASE_JSON.entities,
      }),
      Response.json({
        count: 2,
        entities: [secondEntity],
      }),
    ], calls),
  });

  const items = await provider.fetch(WINDOW);

  assert.equal(items.length, 2);
  assert.equal(
    (JSON.parse(String(calls[1].init?.body)) as { after_id?: string }).after_id,
    "funding-round-uuid",
  );
});

test("registers required public providers and gates Crunchbase on its API key", () => {
  const configuredFeed = {
    id: "configured-vc-feed",
    name: "Configured VC announcements",
    url: "https://vc.example/announcements.xml",
    publisher: "Example Ventures",
  };
  const stablePublisher = {
    id: "stable-publisher-feed",
    name: "Stable Publisher",
    url: "https://publisher.example/funding.xml",
    publisher: "Stable Publisher",
  };

  const withoutKey = createDefaultMarketProviders({
    officialAnnouncementFeeds: [configuredFeed],
    stablePublisherFeeds: [stablePublisher],
  });
  const withoutKeyIds = withoutKey.map((provider) => provider.id);

  assert.ok(withoutKeyIds.includes("federal-register"));
  assert.ok(withoutKeyIds.includes("fda-news"));
  assert.ok(withoutKeyIds.includes("sec-public-releases"));
  assert.ok(withoutKeyIds.includes("ftc-press-releases"));
  assert.ok(withoutKeyIds.includes("techcrunch-venture"));
  assert.ok(withoutKeyIds.includes("configured-vc-feed"));
  assert.ok(withoutKeyIds.includes("stable-publisher-feed"));
  assert.equal(withoutKeyIds.includes("crunchbase"), false);

  const withKeyIds = createDefaultMarketProviders({
    crunchbaseApiKey: "authorized-test-key",
  }).map((provider) => provider.id);
  assert.ok(withKeyIds.includes("crunchbase"));
});

test("the default FTC provider uses the current official RSS endpoint", async () => {
  const calls: FetchCall[] = [];
  const providers = createDefaultMarketProviders({}, {
    fetch: recordingFetch([
      new Response(RECORDED_COMPANY_RSS, {
        status: 200,
        headers: { "content-type": "application/rss+xml" },
      }),
    ], calls),
  });
  const ftc = providers.find((provider) => provider.id === "ftc-press-releases");
  assert.ok(ftc);

  await ftc.fetch(WINDOW);

  assert.equal(calls[0].url, "https://www.ftc.gov/feeds/press-release.xml");
});

test("runs a fourteen-day scan from recorded providers and preserves scoped failures", async () => {
  const calls: FetchCall[] = [];
  const sharedFetch = recordingFetch([
    new Response(RECORDED_COMPANY_RSS, { status: 200 }),
    Response.json(RECORDED_FEDERAL_REGISTER_JSON),
  ], calls);
  const service = createMarketService({
    providers: [
      createRssMarketProvider({
        id: "company-feed",
        name: "Company feed",
        url: "https://acme.example/news/rss.xml",
        publisher: "Acme",
      }, { fetch: sharedFetch }),
      createFederalRegisterProvider({ fetch: sharedFetch }),
      {
        id: "failed-provider",
        name: "Failed provider",
        async fetch() {
          throw new Error("recorded upstream timeout");
        },
      },
    ],
  });

  const result = await service.scanMarketWindow({ days: 14, now: NOW });

  assert.equal(result.status, "partial");
  assert.equal(result.events.length, 2);
  assert.equal(
    result.events.some((item) => item.title === "Acme opens its first office"),
    false,
  );
  assert.ok(result.events.every((item) => item.sources.length > 0));
  assert.match(
    result.providers.find(
      (provider) => provider.providerId === "failed-provider",
    )?.error ?? "",
    /recorded upstream timeout/,
  );
});

test("parses publisher feeds whose explicitly zoned dates glue am/pm to the time", async () => {
  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Trade press</title>
    <item>
      <guid>trade-1</guid>
      <title>Health system expands remote patient monitoring program</title>
      <link>https://trade.example/rpm-expansion</link>
      <pubDate>23 Jul 2026 12:31pm GMT</pubDate>
      <description>The health system announced a major expansion of its remote patient monitoring program.</description>
    </item>
  </channel>
</rss>`;
  const provider = createRssMarketProvider({
    id: "trade-feed",
    name: "Trade feed",
    url: "https://trade.example/feed.xml",
    publisher: "Trade Press",
  }, {
    fetch: recordingFetch([new Response(feed, { status: 200 })], []),
  });

  const items = await provider.fetch(WINDOW);

  assert.equal(
    items.length,
    1,
    "items with non-RFC822 dates must not be silently dropped",
  );
  assert.ok(
    Number.isFinite(Date.parse(items[0].publishedAt ?? "")),
    `publishedAt must normalize to a parseable timestamp, got: ${items[0]?.publishedAt}`,
  );
}); 
