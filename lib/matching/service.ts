import {
  ClaimSupportV2Schema,
  OpportunityReportItemSchema,
  type ClaimSupportV2,
  type DealStatus,
  type OpportunityReportItem,
} from "../contracts/domain";
import {
  sourceCanGroundOutputFact,
  sourceTextForRetrieval,
  uniqueByCanonicalId,
  type MarketEventV2,
  type SourceRefV2,
} from "../contracts/source-evidence";
import {
  parseMarketEventV2Read,
  parseSourceRefV2Read,
} from "../contracts/legacy-evidence-adapter";
import { nextStepForDealStatus } from "../reports/next-step-policy";
import {
  confidenceForScore,
  rankQualifiedMatches,
  weightedOpportunityScore,
  type OpportunityScoreInputs,
} from "./scoring";

export interface MatchingDeal {
  id: string;
  companyName: string;
  status: DealStatus;
}

export interface MatchingMemoryContext {
  dealId: string;
  text: string;
  sourceIds: string[];
  fixtureIds: string[];
}

export interface ReasonedMatch {
  dealId: string;
  whyNow: string;
  previousContext: string;
  positiveImplications: string[];
  negativeImplications: string[];
  nextStep: string;
  citedSourceIds: string[];
  demoFixtureIds: string[];
  scoreInputs: OpportunityScoreInputs;
  claimSourceIds: Record<string, string[]>;
}

export interface MatchingInput {
  deals: MatchingDeal[];
  events: MarketEventV2[];
  memoryContexts: MatchingMemoryContext[];
  sources: SourceRefV2[];
}

export interface MatchingReasoner {
  reason(input: MatchingInput): Promise<ReasonedMatch[]>;
}

export interface GroundedMatch {
  dealId: string;
  confidence: "low" | "medium" | "high";
  score: number;
  whyNow: string;
  previousContext: string;
  implications: {
    positive: string[];
    negative: string[];
  };
  nextStep: string;
  relationship: "satisfies" | "contradicts" | "related";
  events: MarketEventV2[];
  sources: SourceRefV2[];
  demoFixtureIds: string[];
  claimSupport: ClaimSupportV2[];
}

interface GroundedText {
  text: string;
  sourceIds: string[];
  supports: ClaimSupportV2[];
}

type ClaimScope = "public_fact" | "prior_context" | "any_fact";

function supportKind(
  source: SourceRefV2,
  claim: string,
): ClaimSupportV2["kind"] | null {
  if (!sourceCanGroundOutputFact(source)) return null;
  if (source.text.status === "verified_exact") {
    if (source.text.verbatimExcerpt.includes(claim)) return "exact_quote";
    if (source.text.normalizedStatement?.includes(claim)) {
      return "normalized_non_quote";
    }
    return null;
  }
  return source.text.normalizedStatement.includes(claim)
    ? "normalized_non_quote"
    : null;
}

function sourceAllowedForScope(
  source: SourceRefV2,
  scope: ClaimScope,
): boolean {
  if (!sourceCanGroundOutputFact(source)) return false;
  if (scope === "public_fact") {
    return source.provenance === "public_web"
      && source.evidenceRole !== "context";
  }
  if (scope === "prior_context") {
    return source.provenance === "source_document"
      || source.provenance === "demo_fixture";
  }
  return source.provenance !== "model_inference";
}

function supportedClaims(
  match: ReasonedMatch,
  validSourceIds: Set<string>,
  sourceById: Map<string, SourceRefV2>,
  scope: ClaimScope,
): ClaimSupportV2[] {
  return Object.entries(match.claimSourceIds).flatMap(([claim, sourceIds]) => {
    const kinds = sourceIds.map((sourceId) => {
      const source = sourceById.get(sourceId);
      if (
        !source
        || !validSourceIds.has(sourceId)
        || !sourceAllowedForScope(source, scope)
      ) return null;
      return supportKind(source, claim);
    });
    if (sourceIds.length === 0 || kinds.some((kind) => kind === null)) return [];
    return [ClaimSupportV2Schema.parse({
      text: claim,
      kind: kinds.includes("normalized_non_quote")
        ? "normalized_non_quote"
        : "exact_quote",
      sourceIds,
    })];
  });
}

function groundedText(
  text: string,
  match: ReasonedMatch,
  validSourceIds: Set<string>,
  sourceById: Map<string, SourceRefV2>,
  scope: ClaimScope,
): GroundedText {
  const supports = supportedClaims(match, validSourceIds, sourceById, scope)
    .filter((support) => text.includes(support.text));
  return {
    text: supports.map((support) => support.text).join(" "),
    sourceIds: [...new Set(supports.flatMap((support) => support.sourceIds))],
    supports,
  };
}

const OVERLAP_STOP_WORDS = new Set([
  "about", "ai", "company", "data", "deal", "digital", "from",
  "enterprise", "funding", "into", "investment", "market", "platform",
  "regulation", "regulatory", "services", "software", "source", "startup",
  "technology", "that", "their", "this", "with",
]);

function evidenceTokens(value: string): Set<string> {
  return new Set(
    value.toLocaleLowerCase()
      .split(/[^\p{L}\p{N}+.-]+/u)
      .filter((token) => token.length > 1 && !OVERLAP_STOP_WORDS.has(token)),
  );
}

function overlapStrength(
  publicSourceIds: string[],
  dealSourceIds: string[],
  sourceById: Map<string, SourceRefV2>,
  deal: MatchingDeal,
  events: MarketEventV2[],
): number {
  const sourceText = (sourceId: string) => {
    const source = sourceById.get(sourceId);
    return source ? sourceTextForRetrieval(source) : "";
  };
  const publicTokens = evidenceTokens(publicSourceIds.map(sourceText).join(" "));
  const dealTokens = evidenceTokens(dealSourceIds.map(sourceText).join(" "));
  const overlapCount = [...publicTokens]
    .filter((token) => dealTokens.has(token)).length;
  const companyTokens = evidenceTokens(deal.companyName);
  const explicitCompanyMatch = companyTokens.size > 0
    && [...companyTokens].every((token) => publicTokens.has(token));
  const relevantEvents = events.filter((event) =>
    event.sources.some((source) => publicSourceIds.includes(source.id))
  );
  const eventMetadataTokens = evidenceTokens(
    relevantEvents.flatMap((event) => [...event.sectors, ...event.themes])
      .join(" "),
  );
  const explicitMetadataMatch = [...eventMetadataTokens]
    .some((token) => dealTokens.has(token));

  if (overlapCount < 2 && !explicitCompanyMatch && !explicitMetadataMatch) {
    return 0;
  }
  return Math.min(
    0.9,
    0.6 + Math.min(Math.max(overlapCount - 2, 0), 2) * 0.15,
  );
}

function uniqueClaimSupport(supports: ClaimSupportV2[]): ClaimSupportV2[] {
  const seen = new Set<string>();
  return supports.filter((support) => {
    const key = JSON.stringify([
      support.text,
      support.kind,
      [...support.sourceIds].sort(),
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function createMatchingService(reasoner: MatchingReasoner) {
  const analyze = async (input: MatchingInput): Promise<GroundedMatch[]> => {
    const events = uniqueByCanonicalId(
      input.events.map(parseMarketEventV2Read),
      "market event",
    );
    const sources = uniqueByCanonicalId([
      ...input.sources.map(parseSourceRefV2Read),
      ...events.flatMap((event) => event.sources),
    ], "source");
    const validatedInput: MatchingInput = {
      ...input,
      events,
      sources,
    };
    const sourceById = new Map(sources.map((source) => [source.id, source]));
    const contextByDeal = new Map(input.memoryContexts.map((context) => [
      context.dealId,
      context,
    ]));
    const raw = await reasoner.reason(validatedInput);
    const grounded = raw.flatMap((match) => {
      const context = contextByDeal.get(match.dealId);
      const deal = input.deals.find((candidate) => candidate.id === match.dealId);
      if (!context || !deal) return [];
      const dealLineageIds = new Set([
        ...context.sourceIds,
        ...context.fixtureIds,
      ]);
      const validSourceIds = new Set(
        match.citedSourceIds.filter((sourceId) => sourceById.has(sourceId)),
      );
      const publicSourceIds = [...validSourceIds].filter((sourceId) =>
        sourceById.get(sourceId)?.provenance === "public_web"
      );
      const dealSourceIds = [...validSourceIds].filter((sourceId) =>
        dealLineageIds.has(sourceId)
      );
      if (!publicSourceIds.length || !dealSourceIds.length) return [];
      const deterministicRelevance = overlapStrength(
        publicSourceIds,
        dealSourceIds,
        sourceById,
        deal,
        events,
      );
      if (deterministicRelevance === 0) return [];

      const whyNow = groundedText(
        match.whyNow,
        match,
        new Set(publicSourceIds),
        sourceById,
        "public_fact",
      );
      const previousContext = groundedText(
        match.previousContext,
        match,
        dealLineageIds,
        sourceById,
        "prior_context",
      );
      if (!whyNow.text || !previousContext.text) return [];

      const groundedImplications = [
        ...match.positiveImplications,
        ...match.negativeImplications,
      ].map((claim) => groundedText(
        claim,
        match,
        validSourceIds,
        sourceById,
        "any_fact",
      ));
      const positiveImplications = match.positiveImplications.filter((claim) =>
        groundedImplications.some((groundedClaim) => groundedClaim.text === claim)
      );
      const negativeImplications = match.negativeImplications.filter((claim) =>
        groundedImplications.some((groundedClaim) => groundedClaim.text === claim)
      );
      const usedSourceIds = new Set([
        ...whyNow.sourceIds,
        ...previousContext.sourceIds,
        ...groundedImplications.flatMap((claim) => claim.sourceIds),
      ]);
      const matchedEvents = events.filter((event) =>
        event.sources.some((source) => usedSourceIds.has(source.id))
      );
      for (const event of matchedEvents) {
        for (const source of event.sources) usedSourceIds.add(source.id);
      }
      const demoFixtureIds = match.demoFixtureIds.filter((fixtureId) =>
        context.fixtureIds.includes(fixtureId) && usedSourceIds.has(fixtureId)
      );
      const score = weightedOpportunityScore({
        ...match.scoreInputs,
        eventRelevance: Math.min(
          match.scoreInputs.eventRelevance,
          deterministicRelevance,
        ),
        dealRelevance: Math.min(
          match.scoreInputs.dealRelevance,
          deterministicRelevance,
        ),
      });
      const confidence = confidenceForScore(score);
      const relationship = positiveImplications.length > 0
        && negativeImplications.length === 0
        ? "satisfies" as const
        : negativeImplications.length > 0
          && positiveImplications.length === 0
        ? "contradicts" as const
        : "related" as const;
      const claimSupport = uniqueClaimSupport([
        ...whyNow.supports,
        ...previousContext.supports,
        ...groundedImplications.flatMap((claim) => claim.supports),
      ]);
      return [{
        dealId: match.dealId,
        confidence,
        score,
        whyNow: whyNow.text,
        previousContext: previousContext.text,
        implications: {
          positive: positiveImplications,
          negative: negativeImplications,
        },
        nextStep: nextStepForDealStatus(deal.status),
        relationship,
        events: matchedEvents,
        demoFixtureIds,
        sources: [...usedSourceIds].map((sourceId) => sourceById.get(sourceId)!),
        claimSupport,
      }];
    });

    return grounded.sort((left, right) => right.score - left.score);
  };

  return {
    analyze,
    async match(input: MatchingInput): Promise<OpportunityReportItem[]> {
      const grounded = await analyze(input);
      return rankQualifiedMatches(grounded).map((match, index) =>
        OpportunityReportItemSchema.parse({
          rank: index + 1,
          dealId: match.dealId,
          confidence: match.confidence,
          score: match.score,
          whyNow: match.whyNow,
          previousContext: match.previousContext,
          implications: match.implications,
          nextStep: match.nextStep,
          sources: match.sources,
          demoFixtureIds: match.demoFixtureIds,
          claimSupport: match.claimSupport,
        })
      );
    },
  };
}
