import { z } from "zod";

import type {
  MarketFetchWindow,
  MarketProvider,
  RawSourceItem,
} from "./types";

export const REQUEST_TIMEOUT_MS = 10_000;
export const MAX_FETCH_ATTEMPTS = 3;
export const MAX_PROVIDER_PAGES = 20;
const PROVIDER_PAGE_SIZE = 100;
export const MARKET_USER_AGENT =
  "XTrace Market Intelligence/1.0 (public evidence collection)";

export const FEDERAL_REGISTER_API_URL =
  "https://www.federalregister.gov/api/v1/documents.json";
export const FDA_PRESS_RELEASES_RSS_URL =
  "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml";
export const SEC_PRESS_RELEASES_RSS_URL =
  "https://www.sec.gov/news/pressreleases.rss";
export const FTC_PRESS_RELEASES_RSS_URL =
  "https://www.ftc.gov/feeds/press-release.xml";
export const TECHCRUNCH_VENTURE_RSS_URL =
  "https://techcrunch.com/category/venture/feed/";
export const CRUNCHBASE_FUNDING_SEARCH_URL =
  "https://api.crunchbase.com/v4/data/searches/funding_rounds";

export type NativeFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface ProviderRuntime {
  fetch?: NativeFetch;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  userAgent?: string;
}

export interface RssMarketProviderConfig {
  id: string;
  name: string;
  url: string;
  publisher: string;
  eventType?: string;
  sectors?: string[];
  themes?: string[];
  confidence?: "low" | "medium" | "high";
  sourceClass?: RawSourceItem["sourceClass"];
  sourceAuthority?: RawSourceItem["sourceAuthority"];
  evidenceRole?: RawSourceItem["evidenceRole"];
}

export interface DefaultMarketProviderOptions {
  officialAnnouncementFeeds?: RssMarketProviderConfig[];
  stablePublisherFeeds?: RssMarketProviderConfig[];
  crunchbaseApiKey?: string;
}

const RssMarketProviderConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url(),
  publisher: z.string().min(1),
  eventType: z.string().min(1).optional(),
  sectors: z.array(z.string().min(1)).optional(),
  themes: z.array(z.string().min(1)).optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
  sourceClass: z.enum([
    "company_official",
    "government_or_regulator",
    "court_or_public_filing",
    "customer_or_partner_official",
    "investor_official",
    "funding_publication",
    "industry_publication",
    "commercial_database",
    "founder_social",
  ]).optional(),
  sourceAuthority: z.enum(["primary", "secondary"]).optional(),
  evidenceRole: z.enum([
    "trigger",
    "corroborating",
    "counterevidence",
    "context",
  ]).optional(),
});

const FederalRegisterResponseSchema = z.object({
  count: z.number().int().nonnegative().optional(),
  results: z.array(z.object({
    document_number: z.string().min(1),
    title: z.string().min(1),
    html_url: z.string().url(),
    publication_date: z.string().min(1),
    abstract: z.string().nullable().optional(),
    agencies: z.array(z.object({
      name: z.string().min(1).optional(),
      raw_name: z.string().min(1).optional(),
    }).passthrough()).optional(),
  }).passthrough()),
}).passthrough();

const CrunchbaseIdentifierSchema = z.object({
  value: z.string().min(1).optional(),
  permalink: z.string().min(1).optional(),
}).passthrough();

const CrunchbaseResponseSchema = z.object({
  count: z.number().int().nonnegative().optional(),
  entities: z.array(z.object({
    uuid: z.string().min(1).optional(),
    properties: z.object({
      identifier: CrunchbaseIdentifierSchema.optional(),
      announced_on: z.string().min(1).optional(),
      funded_organization_identifier:
        CrunchbaseIdentifierSchema.optional(),
      funded_organization_categories:
        z.array(CrunchbaseIdentifierSchema).optional(),
      investor_identifiers:
        z.array(CrunchbaseIdentifierSchema).optional(),
      money_raised: z.union([
        z.number(),
        z.object({
          value: z.number().optional(),
          currency: z.string().min(1).optional(),
        }).passthrough(),
      ]).optional(),
    }).passthrough(),
  }).passthrough()),
}).passthrough();

class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    readonly requestUrl: string,
  ) {
    super(`Market provider request failed with HTTP ${status} (${requestUrl}).`);
    this.name = "ProviderHttpError";
  }
}

class ProviderPaginationLimitError extends Error {
  constructor(providerName: string) {
    super(
      `${providerName} exceeded the bounded ${MAX_PROVIDER_PAGES}-page scan limit.`,
    );
    this.name = "ProviderPaginationLimitError";
  }
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isRetryable(error: unknown): boolean {
  if (!(error instanceof ProviderHttpError)) {
    return true;
  }
  return error.status === 408
    || error.status === 425
    || error.status === 429
    || error.status >= 500;
}

function retryDelay(attempt: number, random: () => number): number {
  const exponentialDelay = Math.min(250 * (2 ** (attempt - 1)), 1_500);
  const jitterMultiplier = 0.75 + Math.max(0, Math.min(1, random())) * 0.5;
  return Math.min(Math.round(exponentialDelay * jitterMultiplier), 2_000);
}

async function fetchWithRetries(
  url: string | URL,
  init: RequestInit,
  runtime: ProviderRuntime,
): Promise<Response> {
  const fetchImplementation = runtime.fetch
    ?? globalThis.fetch.bind(globalThis);
  const sleep = runtime.sleep ?? defaultSleep;
  const random = runtime.random ?? Math.random;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(
        new DOMException("Market provider request timed out.", "TimeoutError"),
      ),
      REQUEST_TIMEOUT_MS,
    );
    const headers = new Headers(init.headers);
    headers.set(
      "user-agent",
      runtime.userAgent?.trim() || MARKET_USER_AGENT,
    );
    headers.set("accept-encoding", "gzip, deflate");

    try {
      const response = await fetchImplementation(url, {
        ...init,
        headers,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new ProviderHttpError(response.status, String(url));
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt === MAX_FETCH_ATTEMPTS || !isRetryable(error)) {
        throw error;
      }
      await sleep(retryDelay(attempt, random));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

function decodeXml(value: string): string {
  const withoutCdata = value.trim().replace(
    /^<!\[CDATA\[([\s\S]*)\]\]>$/,
    "$1",
  );
  return withoutCdata
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => (
      String.fromCodePoint(Number.parseInt(code, 16))
    ))
    .replace(/&#([0-9]+);/g, (_match, code: string) => (
      String.fromCodePoint(Number.parseInt(code, 10))
    ))
    .replace(/&quot;/gi, "\"")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function cleanXmlText(value: string): string {
  return decodeXml(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function excerpt(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const cleaned = cleanXmlText(value);
  if (!cleaned) {
    return undefined;
  }
  return cleaned.slice(0, 2_000);
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstTag(block: string, names: string[]): string | undefined {
  for (const name of names) {
    const escapedName = escapeRegularExpression(name);
    const match = block.match(
      new RegExp(
        `<${escapedName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedName}\\s*>`,
        "i",
      ),
    );
    if (match) {
      return decodeXml(match[1]).trim();
    }
  }
  return undefined;
}

function attribute(tag: string, name: string): string | undefined {
  const escapedName = escapeRegularExpression(name);
  const match = tag.match(
    new RegExp(`\\b${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"),
  );
  const value = match?.[1] ?? match?.[2];
  return value ? decodeXml(value).trim() : undefined;
}

function atomLink(block: string): string | undefined {
  const tags = block.match(/<link\b[^>]*\/?>/gi) ?? [];
  const alternate = tags.find((tag) => {
    const rel = attribute(tag, "rel");
    return !rel || rel.toLowerCase() === "alternate";
  });
  return alternate ? attribute(alternate, "href") : undefined;
}

function normalizedDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const cleaned = cleanXmlText(value);
  // Some trade-press feeds glue am/pm onto the time ("12:31pm"), which
  // Date rejects; separate it before parsing.
  const parsed = new Date(cleaned.replace(/(\d)\s*(am|pm)\b/i, "$1 $2"));
  return Number.isFinite(parsed.getTime())
    ? parsed.toISOString()
    : cleaned;
}

function parseRssItems(
  xml: string,
  config: RssMarketProviderConfig,
): RawSourceItem[] {
  if (!/<(?:rss|feed|rdf:RDF)\b/i.test(xml)) {
    throw new TypeError("Market provider response is not an RSS or Atom document.");
  }

  const rssBlocks = xml.match(/<item\b[^>]*>[\s\S]*?<\/item\s*>/gi) ?? [];
  const atomBlocks = xml.match(/<entry\b[^>]*>[\s\S]*?<\/entry\s*>/gi) ?? [];

  return [...rssBlocks, ...atomBlocks].flatMap((block) => {
    const title = excerpt(firstTag(block, ["title"]));
    const rssLink = firstTag(block, ["link"]);
    const url = rssLink ? cleanXmlText(rssLink) : atomLink(block);
    if (!title || !url) {
      return [];
    }

    const rawEvidence = firstTag(block, [
      "description",
      "content:encoded",
      "summary",
      "content",
    ]);
    const normalizedStatement = excerpt(rawEvidence);
    const externalId = excerpt(firstTag(block, ["guid", "id"])) ?? url;
    const publishedAt = normalizedDate(firstTag(block, [
      "pubDate",
      "published",
      "dc:date",
    ]));
    const updatedAt = normalizedDate(firstTag(block, ["updated"]));
    if (!normalizedStatement) return [];

    return [{
      providerId: config.id,
      externalId,
      title,
      url,
      publisher: config.publisher,
      sourceClass: config.sourceClass ?? "industry_publication",
      sourceAuthority: config.sourceAuthority ?? "secondary",
      evidenceRole: config.evidenceRole ?? "trigger",
      ...(publishedAt ? { publishedAt } : {}),
      ...(updatedAt ? { updatedAt } : {}),
      summary: normalizedStatement,
      normalizedStatement,
      eventType: config.eventType ?? "announcement",
      sectors: [...(config.sectors ?? [])],
      themes: [...(config.themes ?? [])],
      confidence: config.confidence ?? "medium",
    }];
  });
}

function validatedHttpUrl(value: string, label: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError(`${label} must use HTTP or HTTPS.`);
  }
  return url.toString();
}

export function createRssMarketProvider(
  input: RssMarketProviderConfig,
  runtime: ProviderRuntime = {},
): MarketProvider {
  const config = RssMarketProviderConfigSchema.parse(input);
  const feedUrl = validatedHttpUrl(config.url, "RSS feed URL");

  return {
    id: config.id,
    name: config.name,
    async fetch(): Promise<RawSourceItem[]> {
      const response = await fetchWithRetries(feedUrl, {
        method: "GET",
        headers: {
          accept: "application/atom+xml, application/rss+xml, application/xml, text/xml",
        },
        redirect: "follow",
      }, runtime);
      return parseRssItems(await response.text(), config);
    },
  };
}

export function createFederalRegisterProvider(
  runtime: ProviderRuntime = {},
): MarketProvider {
  return {
    id: "federal-register",
    name: "Federal Register",
    async fetch(window: MarketFetchWindow): Promise<RawSourceItem[]> {
      const items: RawSourceItem[] = [];
      let fetchedCount = 0;

      for (let page = 1; page <= MAX_PROVIDER_PAGES; page += 1) {
        const url = new URL(FEDERAL_REGISTER_API_URL);
        url.searchParams.set("per_page", String(PROVIDER_PAGE_SIZE));
        url.searchParams.set("page", String(page));
        url.searchParams.set("order", "newest");
        url.searchParams.set(
          "conditions[publication_date][gte]",
          window.from.toISOString().slice(0, 10),
        );
        url.searchParams.set(
          "conditions[publication_date][lte]",
          window.to.toISOString().slice(0, 10),
        );

        const response = await fetchWithRetries(url, {
          method: "GET",
          headers: { accept: "application/json" },
        }, runtime);
        const payload = FederalRegisterResponseSchema.parse(
          await response.json(),
        );
        fetchedCount += payload.results.length;

        items.push(...payload.results.flatMap((document): RawSourceItem[] => {
          const normalizedStatement = excerpt(document.abstract ?? undefined);
          if (!normalizedStatement) return [];
          return [{
            providerId: "federal-register",
            externalId: document.document_number,
            title: cleanXmlText(document.title),
            url: document.html_url,
            publisher: "Federal Register",
            sourceClass: "government_or_regulator",
            sourceAuthority: "primary",
            evidenceRole: "trigger",
            publishedAt: normalizedDate(document.publication_date),
            summary: normalizedStatement,
            normalizedStatement,
            eventType: "regulatory",
            sectors: [],
            themes: ["regulation"],
            confidence: "high",
          }];
        }));

        const hasMore = payload.count === undefined
          ? payload.results.length === PROVIDER_PAGE_SIZE
          : fetchedCount < payload.count;
        if (!hasMore) {
          return items;
        }
        if (payload.results.length === 0 || page === MAX_PROVIDER_PAGES) {
          throw new ProviderPaginationLimitError("Federal Register");
        }
      }

      throw new ProviderPaginationLimitError("Federal Register");
    },
  };
}

function crunchbaseMoney(
  money: z.infer<typeof CrunchbaseResponseSchema>["entities"][number][
    "properties"
  ]["money_raised"],
): { value?: number; currency?: string } {
  if (typeof money === "number") {
    return { value: money };
  }
  return money ?? {};
}

type CrunchbaseEntity = z.infer<
  typeof CrunchbaseResponseSchema
>["entities"][number];

function identifierValues(
  identifiers: Array<z.infer<typeof CrunchbaseIdentifierSchema>> | undefined,
): string[] {
  return [...new Set(
    (identifiers ?? [])
      .map((identifier) => identifier.value)
      .filter((value): value is string => Boolean(value)),
  )];
}

function crunchbaseItem(entity: CrunchbaseEntity): RawSourceItem[] {
  const organization =
    entity.properties.funded_organization_identifier?.value;
  const roundName = entity.properties.identifier?.value;
  const roundPermalink =
    entity.properties.identifier?.permalink ?? entity.uuid;
  const announcedOn = normalizedDate(entity.properties.announced_on);
  if (!organization || !roundName || !roundPermalink || !announcedOn) {
    return [];
  }

  const money = crunchbaseMoney(entity.properties.money_raised);
  const categories = identifierValues(
    entity.properties.funded_organization_categories,
  );
  const investors = identifierValues(entity.properties.investor_identifiers);
  const evidenceFacts = [
    money.value === undefined
      ? undefined
      : `reported amount ${money.currency
        ? `${money.currency} `
        : ""}${money.value}`,
    categories.length > 0
      ? `organization categories ${categories.join(", ")}`
      : undefined,
    investors.length > 0
      ? `investors ${investors.join(", ")}`
      : undefined,
  ].filter((fact): fact is string => Boolean(fact));
  const additionalFacts = evidenceFacts.length > 0
    ? `; ${evidenceFacts.join("; ")}`
    : "";
  const normalizedStatement =
    `Crunchbase records ${roundName} for ${organization}, announced `
    + `${announcedOn.slice(0, 10)}${additionalFacts}.`;

  return [{
    providerId: "crunchbase",
    externalId: entity.uuid ?? roundPermalink,
    title: `${organization} — ${roundName}`,
    url:
      `https://www.crunchbase.com/funding_round/${encodeURIComponent(roundPermalink)}`,
    publisher: "Crunchbase",
    sourceClass: "commercial_database",
    sourceAuthority: "secondary",
    evidenceRole: "trigger",
    eventAt: announcedOn,
    publishedAt: announcedOn,
    summary: normalizedStatement,
    normalizedStatement,
    eventType: "funding",
    entities: [organization.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")].filter(Boolean),
    sectors: categories,
    themes: [
      "funding",
      ...investors.map((investor) => `investor:${investor}`),
    ],
    confidence: "medium",
  }];
}

export function createCrunchbaseProvider(
  apiKey: string,
  runtime: ProviderRuntime = {},
): MarketProvider {
  const authorizedApiKey = apiKey.trim();
  if (!authorizedApiKey) {
    throw new TypeError("Crunchbase requires an authorized API key.");
  }

  return {
    id: "crunchbase",
    name: "Crunchbase funding rounds",
    async fetch(window: MarketFetchWindow): Promise<RawSourceItem[]> {
      const items: RawSourceItem[] = [];
      const query = [
        {
          type: "predicate",
          field_id: "announced_on",
          operator_id: "gte",
          values: [window.from.toISOString().slice(0, 10)],
        },
        {
          type: "predicate",
          field_id: "announced_on",
          operator_id: "lte",
          values: [window.to.toISOString().slice(0, 10)],
        },
      ];
      let afterId: string | undefined;
      let fetchedCount = 0;

      for (let page = 1; page <= MAX_PROVIDER_PAGES; page += 1) {
        const response = await fetchWithRetries(
          CRUNCHBASE_FUNDING_SEARCH_URL,
          {
            method: "POST",
            headers: {
              accept: "application/json",
              "content-type": "application/json",
              "x-cb-user-key": authorizedApiKey,
            },
            body: JSON.stringify({
              field_ids: [
                "identifier",
                "announced_on",
                "funded_organization_identifier",
                "money_raised",
                "funded_organization_categories",
                "investor_identifiers",
              ],
              query,
              order: [{ field_id: "announced_on", sort: "asc" }],
              limit: PROVIDER_PAGE_SIZE,
              ...(afterId ? { after_id: afterId } : {}),
            }),
          },
          runtime,
        );
        const payload = CrunchbaseResponseSchema.parse(await response.json());
        fetchedCount += payload.entities.length;
        items.push(...payload.entities.flatMap(crunchbaseItem));

        const hasMore = payload.count === undefined
          ? payload.entities.length === PROVIDER_PAGE_SIZE
          : fetchedCount < payload.count;
        if (!hasMore) {
          return items;
        }

        const nextAfterId = payload.entities.at(-1)?.uuid;
        if (!nextAfterId || page === MAX_PROVIDER_PAGES) {
          throw new ProviderPaginationLimitError("Crunchbase");
        }
        afterId = nextAfterId;
      }

      throw new ProviderPaginationLimitError("Crunchbase");
    },
  };
}

function assertUniqueProviderIds(providers: MarketProvider[]): void {
  const seen = new Set<string>();
  for (const provider of providers) {
    if (seen.has(provider.id)) {
      throw new TypeError(`Duplicate market provider id: ${provider.id}`);
    }
    seen.add(provider.id);
  }
}

export function createDefaultMarketProviders(
  options: DefaultMarketProviderOptions = {},
  runtime: ProviderRuntime = {},
): MarketProvider[] {
  const providers: MarketProvider[] = [
    createFederalRegisterProvider(runtime),
    createRssMarketProvider({
      id: "fda-news",
      name: "FDA press releases",
      url: FDA_PRESS_RELEASES_RSS_URL,
      publisher: "U.S. Food and Drug Administration",
      eventType: "regulatory",
      sectors: ["healthcare"],
      themes: ["regulation"],
      confidence: "high",
      sourceClass: "government_or_regulator",
      sourceAuthority: "primary",
      evidenceRole: "trigger",
    }, runtime),
    createRssMarketProvider({
      id: "sec-public-releases",
      name: "SEC public releases",
      url: SEC_PRESS_RELEASES_RSS_URL,
      publisher: "U.S. Securities and Exchange Commission",
      eventType: "regulatory",
      themes: ["regulation"],
      confidence: "high",
      sourceClass: "government_or_regulator",
      sourceAuthority: "primary",
      evidenceRole: "trigger",
    }, runtime),
    createRssMarketProvider({
      id: "ftc-press-releases",
      name: "FTC press releases",
      url: FTC_PRESS_RELEASES_RSS_URL,
      publisher: "U.S. Federal Trade Commission",
      eventType: "regulatory",
      themes: ["competition", "consumer-protection", "regulation"],
      confidence: "high",
      sourceClass: "government_or_regulator",
      sourceAuthority: "primary",
      evidenceRole: "trigger",
    }, runtime),
    createRssMarketProvider({
      id: "techcrunch-venture",
      name: "TechCrunch venture news",
      url: TECHCRUNCH_VENTURE_RSS_URL,
      publisher: "TechCrunch",
      eventType: "venture_news",
      themes: ["venture-capital"],
      confidence: "medium",
      sourceClass: "industry_publication",
      sourceAuthority: "secondary",
      evidenceRole: "trigger",
    }, runtime),
    ...(options.officialAnnouncementFeeds ?? []).map((feed) => (
      createRssMarketProvider({
        sourceClass: "company_official",
        sourceAuthority: "primary",
        evidenceRole: "trigger",
        ...feed,
      }, runtime)
    )),
    ...(options.stablePublisherFeeds ?? []).map((feed) => (
      createRssMarketProvider({
        sourceClass: "industry_publication",
        sourceAuthority: "secondary",
        evidenceRole: "trigger",
        ...feed,
      }, runtime)
    )),
  ];

  if (options.crunchbaseApiKey?.trim()) {
    providers.push(
      createCrunchbaseProvider(options.crunchbaseApiKey, runtime),
    );
  }

  assertUniqueProviderIds(providers);
  return providers;
}
