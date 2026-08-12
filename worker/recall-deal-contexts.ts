import type { DealMemoryBundle } from "../lib/contracts/domain";
import {
  XTraceUnavailableError,
  type MemoryContext,
  type RecallDealContextInput,
} from "../lib/xtrace/service";

export interface DealRecallService {
  recallDealContext(input: RecallDealContextInput): Promise<MemoryContext[]>;
}

export interface DealRecallResult {
  contextsByDeal: Map<string, MemoryContext[]>;
  failures: Array<{ dealId: string; message: string }>;
}

// The shared XTrace budget is 25 requests per minute and one scan issues one
// recall per Deal, so a full 19-Deal recall fits inside a single window and
// the only reason to stay below full fan-out is politeness to the API.
const RECALL_CONCURRENCY = 6;
const RECALL_RETRY_DELAY_MS = 2_000;

export async function recallAllDealContexts(input: {
  workspaceId: string;
  runId: string;
  bundles: DealMemoryBundle[];
  service?: DealRecallService;
  evidenceContextFingerprint?: string;
  activeParentFingerprints?: ReadonlyMap<string, string>;
}): Promise<DealRecallResult> {
  const contextsByDeal = new Map<string, MemoryContext[]>();
  const failures: DealRecallResult["failures"] = [];

  if (!input.service) {
    return {
      contextsByDeal,
      failures: input.bundles.map((bundle) => ({
        dealId: bundle.dealId,
        message: "XTRACE_SERVICE_UNAVAILABLE",
      })),
    };
  }

  const service = input.service;
  type RecallOutcome =
    | { dealId: string; contexts: MemoryContext[] }
    | { dealId: string; message: string; retryable: boolean };
  const recallOnce = async (bundle: DealMemoryBundle): Promise<RecallOutcome> => {
    try {
      const contexts = await service.recallDealContext({
        workspaceId: input.workspaceId,
        runId: input.runId,
        query: dealRecallQuery(bundle),
        fallbackQuery: dealRecallFallbackQuery(bundle),
        candidateDealIds: [bundle.dealId],
        limit: 20,
        evidenceContextFingerprint: input.evidenceContextFingerprint,
        activeParentFingerprint: input.activeParentFingerprints?.get(bundle.dealId),
      });
      return {
        dealId: bundle.dealId,
        contexts: contexts.filter((context) => context.dealId === bundle.dealId),
      };
    } catch (error) {
      return {
        dealId: bundle.dealId,
        message: safeRecallFailure(error),
        retryable: !(error instanceof XTraceUnavailableError) || error.retryable,
      };
    }
  };
  const primaryOutcomes = await mapWithConcurrency(
    input.bundles,
    RECALL_CONCURRENCY,
    recallOnce,
  );

  const outcomes = [...primaryOutcomes];
  let retriesRemaining = 2;
  for (let index = 0; index < outcomes.length && retriesRemaining > 0; index += 1) {
    const outcome = outcomes[index];
    if ("contexts" in outcome || !outcome.retryable) continue;
    retriesRemaining -= 1;
    await delay(RECALL_RETRY_DELAY_MS);
    outcomes[index] = await recallOnce(input.bundles[index]);
  }

  for (const outcome of outcomes) {
    if ("contexts" in outcome) {
      contextsByDeal.set(outcome.dealId, outcome.contexts);
    } else {
      failures.push({ dealId: outcome.dealId, message: outcome.message });
    }
  }

  return { contextsByDeal, failures };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function mapWithConcurrency<Item, Result>(
  items: readonly Item[],
  concurrency: number,
  operation: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        results[index] = await operation(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export function dealRecallQuery(bundle: DealMemoryBundle): string {
  // Template-only queries rank poorly: every Deal's memories share the same
  // boilerplate phrasing, so the query must carry this Deal's own decision
  // content for similarity search to surface this Deal's memories first.
  const decisionContext = bundle.interactions.flatMap((interaction) => [
    interaction.summary,
    interaction.decisionReason,
    ...interaction.concerns,
    ...interaction.revisitConditions,
  ]);
  const factTexts = bundle.facts.map((fact) => fact.text);
  return [
    bundle.companyName,
    "investment decision",
    ...decisionContext,
    ...factTexts,
  ].join(" · ").slice(0, 4_000);
}

function dealRecallFallbackQuery(bundle: DealMemoryBundle): string | undefined {
  const distinguishingContext = bundle.interactions.at(-1)?.summary
    ?? bundle.facts[0]?.text;
  if (!distinguishingContext) return undefined;
  return [
    distinguishingContext,
    distinguishingContext,
    distinguishingContext,
    bundle.companyName,
    bundle.dealId,
    bundle.facts[0]?.text,
  ].filter((value): value is string => Boolean(value)).join(" · ").slice(0, 4_000);
}

function safeRecallFailure(error: unknown): string {
  if (
    error
    && typeof error === "object"
    && "code" in error
    && typeof error.code === "string"
    && /^[A-Z0-9_]{1,80}$/.test(error.code)
  ) {
    return error.code;
  }
  if (error instanceof Error && /^[A-Za-z][A-Za-z0-9]+$/.test(error.name)) {
    return error.name.slice(0, 80);
  }
  return "XTRACE_RECALL_FAILED";
}
