import { z } from "zod";

import { canonicalizeUrl, dedupeEvents, withinPublicationWindow } from "./dedupe";
import { reidentifyMarketEvent } from "./identity";
import type {
  MarketProvider,
  MarketProviderReport,
  MarketScanOptions,
  MarketScanResult,
  NormalizedMarketEvent,
  PersistMarketEvents,
  RawSourceItem,
} from "./types";

const RawSourceItemSchema = z.strictObject({
  providerId: z.string().min(1),
  externalId: z.string().min(1).optional(),
  title: z.string().min(1),
  url: z.string().url(),
  publisher: z.string().min(1),
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
  ]),
  sourceAuthority: z.enum(["primary", "secondary"]),
  evidenceRole: z.enum([
    "trigger",
    "corroborating",
    "counterevidence",
    "context",
  ]),
  eventAt: z.string().optional(),
  publishedAt: z.string().optional(),
  retrievedAt: z.string().optional(),
  updatedAt: z.string().optional(),
  summary: z.string().min(1).optional(),
  normalizedStatement: z.string().min(1),
  eventType: z.string().min(1).optional(),
  entities: z.array(z.string().regex(
    /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/,
  )).optional(),
  sectors: z.array(z.string().min(1)).optional(),
  themes: z.array(z.string().min(1)).optional(),
  positiveImplications: z.array(z.string().min(1)).optional(),
  negativeImplications: z.array(z.string().min(1)).optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
});

export interface NormalizeMarketItemOptions {
  retrievedAt?: Date;
}

export interface CreateMarketServiceOptions {
  providers: MarketProvider[];
  persistEvents?: PersistMarketEvents;
}

export interface MarketService {
  scanMarketWindow(options?: MarketScanOptions): Promise<MarketScanResult>;
}

function cleanText(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function validDate(value: string | undefined, label: string): Date {
  if (!value) {
    throw new TypeError(`Market source item requires a ${label}.`);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`Market source item has an invalid ${label}.`);
  }
  return date;
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function normalizeMarketItem(
  input: RawSourceItem,
  options: NormalizeMarketItemOptions = {},
): Promise<NormalizedMarketEvent> {
  const parsedItem = RawSourceItemSchema.safeParse(input);
  if (!parsedItem.success) {
    if (
      !("normalizedStatement" in (input as object))
      || !(input as { normalizedStatement?: unknown }).normalizedStatement
    ) {
      throw new TypeError(
        "Market source item requires a normalized evidence statement.",
      );
    }
    throw parsedItem.error;
  }
  const item = parsedItem.data;
  const publishedAt = validDate(item.publishedAt, "publication time");
  const eventAt = item.eventAt
    ? validDate(item.eventAt, "event time").toISOString()
    : null;
  const retrievedAt = item.retrievedAt
    ? validDate(item.retrievedAt, "retrieval time")
    : options.retrievedAt ?? new Date();
  if (!Number.isFinite(retrievedAt.getTime())) {
    throw new TypeError("Market source item has an invalid retrieval time.");
  }

  const normalizedStatement = cleanText(item.normalizedStatement);
  if (!normalizedStatement) {
    throw new TypeError(
      "Market source item requires a normalized evidence statement.",
    );
  }

  const title = cleanText(item.title);
  const summary = cleanText(item.summary ?? normalizedStatement);
  const publisher = cleanText(item.publisher);
  if (!title || !summary || !publisher) {
    throw new TypeError("Market source item contains empty required text.");
  }

  const canonicalUrl = canonicalizeUrl(item.url);
  const normalizedPublicationTime = publishedAt.toISOString();
  const updatedAt = item.updatedAt
    ? validDate(item.updatedAt, "update time").toISOString()
    : null;
  const retrievedAtValue = retrievedAt.toISOString();
  const entityKeys = [...new Set(item.entities ?? [])];
  const sourceContentFingerprint = `sha256:${await sha256(normalizedStatement)}`;
  const sourceChecksum = await sha256(JSON.stringify({
    canonicalUrl,
    contentFingerprint: sourceContentFingerprint,
    entityKeys,
    eventAt,
    evidenceRole: item.evidenceRole,
    externalId: item.externalId ?? "",
    normalizedStatement,
    providerId: item.providerId,
    publishedAt: normalizedPublicationTime,
    publisher,
    retrievedAt: retrievedAtValue,
    sourceAuthority: item.sourceAuthority,
    sourceClass: item.sourceClass,
    title,
    updatedAt,
  }));
  const sourceId = `source_${sourceChecksum.slice(0, 24)}`;
  const source = {
    schemaVersion: "source-ref-v2" as const,
    adaptation: "canonical" as const,
    id: sourceId,
    provenance: "public_web" as const,
    title,
    canonicalUrl,
    documentId: null,
    publisher,
    providerId: item.providerId,
    eventAt,
    publishedAt: normalizedPublicationTime,
    retrievedAt: retrievedAtValue,
    updatedAt,
    entityKeys,
    sourceClass: item.sourceClass,
    sourceAuthority: item.sourceAuthority,
    evidenceRole: item.evidenceRole,
    sourceRevisionId: null,
    locator: null,
    contentFingerprint: sourceContentFingerprint,
    text: {
      status: "normalized_only" as const,
      normalizedStatement,
    },
  };
  const eventPayload = {
    schemaVersion: "market-event-v2" as const,
    adaptation: "canonical" as const,
    title,
    eventType: cleanText(item.eventType ?? "announcement"),
    sectors: item.sectors?.map(cleanText).filter(Boolean) ?? [],
    themes: item.themes?.map(cleanText).filter(Boolean) ?? [],
    summary,
    positiveImplications:
      item.positiveImplications?.map(cleanText).filter(Boolean) ?? [],
    negativeImplications:
      item.negativeImplications?.map(cleanText).filter(Boolean) ?? [],
    eventAt,
    publishedAt: normalizedPublicationTime,
    retrievedAt: retrievedAtValue,
    updatedAt,
    confidence: item.confidence ?? "low",
    canonicalUrl,
    providerId: item.providerId,
    entityKeys,
    triggerSourceId: sourceId,
    sources: [source],
  };
  return reidentifyMarketEvent(eventPayload);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validScanDays(days: number): number {
  if (!Number.isInteger(days) || days <= 0) {
    throw new TypeError("Market scan days must be a positive integer.");
  }
  return days;
}

export function createMarketService(
  dependencies: CreateMarketServiceOptions,
): MarketService {
  const persistEvents = dependencies.persistEvents ?? (() => undefined);

  return {
    async scanMarketWindow(
      options: MarketScanOptions = {},
    ): Promise<MarketScanResult> {
      const days = validScanDays(options.days ?? 14);
      const to = options.now ?? new Date();
      if (!Number.isFinite(to.getTime())) {
        throw new TypeError("Market scan requires a valid current time.");
      }
      const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1_000);

      const providerResults = await Promise.all(
        dependencies.providers.map(async (provider) => {
          try {
            const rawItems: unknown = await provider.fetch({ from, to });
            if (!Array.isArray(rawItems)) {
              throw new TypeError("Provider returned a non-array response.");
            }

            const accepted: NormalizedMarketEvent[] = [];
            let rejectedCount = 0;
            for (const rawItem of rawItems) {
              const candidate = {
                ...(rawItem as RawSourceItem),
                providerId: provider.id,
              };
              if (
                !candidate.publishedAt
                || !withinPublicationWindow(candidate.publishedAt, to, days)
              ) {
                rejectedCount += 1;
                continue;
              }

              try {
                accepted.push(await normalizeMarketItem(candidate, {
                  retrievedAt: to,
                }));
              } catch {
                rejectedCount += 1;
              }
            }

            const report: MarketProviderReport = {
              providerId: provider.id,
              providerName: provider.name,
              fetchedCount: rawItems.length,
              acceptedCount: accepted.length,
              rejectedCount,
              lastSuccessAt: to.toISOString(),
            };
            return { events: accepted, report, succeeded: true };
          } catch (error) {
            const report: MarketProviderReport = {
              providerId: provider.id,
              providerName: provider.name,
              fetchedCount: 0,
              acceptedCount: 0,
              rejectedCount: 0,
              error: errorMessage(error),
            };
            return {
              events: [] as NormalizedMarketEvent[],
              report,
              succeeded: false,
            };
          }
        }),
      );

      const events = dedupeEvents(
        providerResults.flatMap((result) => result.events),
      );
      if (events.length > 0) {
        await persistEvents(events);
      }

      const successfulProviders = providerResults.filter(
        (result) => result.succeeded,
      ).length;
      const status = successfulProviders === dependencies.providers.length
        && successfulProviders > 0
        ? "completed"
        : successfulProviders > 0
        ? "partial"
        : "failed";

      return {
        status,
        window: {
          from: from.toISOString(),
          to: to.toISOString(),
          days,
        },
        events,
        providers: providerResults.map((result) => result.report),
      };
    },
  };
}

export async function scanMarketWindow(
  options: MarketScanOptions,
  dependencies: CreateMarketServiceOptions,
): Promise<MarketScanResult> {
  return createMarketService(dependencies).scanMarketWindow(options);
}
