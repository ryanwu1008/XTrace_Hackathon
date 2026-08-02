import {
  BELIEF_CHANGE_ASSESSMENT_SCHEMA_VERSION,
  BeliefChangeAssessmentV1Schema,
  ClaimSupportV2Schema,
  OpportunityReportItemSchema,
  type BeliefAction,
  type BeliefChangeAssessmentV1,
  type BeliefChangeDirection,
  type ClaimSupportV2,
  type CompanyAnalysisOutcome,
  type DealStatus,
  type OpportunityReportItem,
} from "../contracts/domain";
import {
  assertConsistentCanonicalEvidenceUnits,
  sourceCanGroundOutputFact,
  sourceClaimSupportKind,
  sourceTextForRetrieval,
  uniqueByCanonicalId,
  type MarketEventV2,
  type SourceRefV2,
} from "../contracts/source-evidence";
import {
  parseMarketEventV2Read,
  parseSourceRefV2Read,
} from "../contracts/legacy-evidence-adapter";
import {
  actionsForDealStatusAndDirection,
  renderRecommendedNextMove,
} from "../reports/action-policy";
import { evaluateBeliefRevisionHardGates } from "./hard-gates";
import {
  buildOpportunityScoreBreakdown,
  type OpportunityScoreInputs,
} from "./scoring";
import { rankBeliefRevisionCandidates } from "./ranking";

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
  interactionCandidates?: MatchingPriorInteractionCandidate[];
}

export interface MatchingPriorInteractionCandidate {
  id: string;
  occurredAt: string;
  sourceIds: string[];
  revisitConditions: string[];
  provenance: "demo_fixture";
  label: "Sample decision record";
  priorActions?: BeliefAction[];
}

export interface ReasonedMatch {
  dealId: string;
  whyNow: string;
  previousContext: string;
  positiveImplications: string[];
  negativeImplications: string[];
  selectedTriggerEventId?: string;
  selectedPriorInteractionId?: string;
  revisitConditionIndex?: number;
  revisitConditionText?: string;
  revisitCitedSourceIds?: string[];
  counterevidence?: {
    statement: string;
    citedSourceIds: string[];
  };
  nextStep?: string;
  citedSourceIds: string[];
  /** @deprecated Current matching derives fixture lineage from the selected prior interaction. */
  demoFixtureIds?: string[];
  scoreInputs: OpportunityScoreInputs;
  claimSourceIds: Record<string, string[]>;
}

type CurrentReasonedMatch = ReasonedMatch & {
  selectedTriggerEventId: string;
  selectedPriorInteractionId: string;
  revisitConditionIndex: number;
  revisitConditionText: string;
  revisitCitedSourceIds: string[];
  counterevidence: {
    statement: string;
    citedSourceIds: string[];
  };
};

function hasCurrentSelection(match: ReasonedMatch): match is CurrentReasonedMatch {
  return Boolean(
    match.selectedTriggerEventId
      && match.selectedPriorInteractionId
      && match.revisitConditionIndex !== undefined
      && match.revisitConditionText !== undefined
      && match.revisitCitedSourceIds
      && match.counterevidence,
  );
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
  dealStatus: DealStatus;
  outcome: CompanyAnalysisOutcome;
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
  beliefAssessment?: BeliefChangeAssessmentV1;
  analysisFailureReason?: string;
}

interface GroundedText {
  text: string;
  sourceIds: string[];
  supports: ClaimSupportV2[];
}

type ClaimScope = "public_fact" | "prior_context" | "any_fact";

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
      return sourceClaimSupportKind(source, claim);
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
  return Number(Math.min(
    0.9,
    0.6 + Math.min(Math.max(overlapCount - 2, 0), 2) * 0.15,
  ).toFixed(4));
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
    const events = uniqueByCanonicalId<MarketEventV2>(
      input.events.map(parseMarketEventV2Read),
      "market event",
    );
    const sources = uniqueByCanonicalId<SourceRefV2>([
      ...input.sources.map(parseSourceRefV2Read),
      ...events.flatMap((event): SourceRefV2[] => [...event.sources]),
    ], "source");
    assertConsistentCanonicalEvidenceUnits(sources);
    const validatedInput: MatchingInput = {
      ...input,
      events,
      sources,
    };
    const sourceById = new Map(sources.map((source) => [source.id, source]));
    const contextGroups = Map.groupBy(
      input.memoryContexts,
      (context) => context.dealId,
    );
    const raw = await reasoner.reason(validatedInput);
    const rawGroups = Map.groupBy(raw, (match) => match.dealId);
    const grounded = input.deals.flatMap((deal) => {
      const rows = rawGroups.get(deal.id) ?? [];
      if (rows.length === 0) return [];
      const contexts = contextGroups.get(deal.id) ?? [];
      if (rows.length !== 1 || contexts.length !== 1) {
        return [unavailableMatch(
          deal,
          "Analysis unavailable because matching returned ambiguous Deal lineage.",
        )];
      }
      const match = rows[0]!;
      const context = contexts[0]!;
      if (!hasCurrentSelection(match)) {
        return [unavailableMatch(
          deal,
          "Analysis unavailable because matching omitted required selected authority.",
        )];
      }
      const referencedIds = unique([
        ...Object.values(match.claimSourceIds).flat(),
        ...match.revisitCitedSourceIds,
        ...match.counterevidence.citedSourceIds,
      ]);
      if (referencedIds.some((sourceId) => !sourceById.has(sourceId))) {
        return [unavailableMatch(
          deal,
          "Analysis unavailable because matching cited an unknown canonical source.",
        )];
      }

      const selectedEvent = events.find(
        (event) => event.id === match.selectedTriggerEventId,
      );
      if (!selectedEvent) {
        return [unavailableMatch(
          deal,
          "Analysis unavailable because the selected trigger event did not resolve to the supplied event set.",
        )];
      }
      const eventSourceIds = new Set(
        selectedEvent.sources.map((source) => source.id),
      );
      const selectedPrior = (context.interactionCandidates ?? []).find(
        (candidate) => candidate.id === match.selectedPriorInteractionId,
      );
      if (
        selectedPrior
        && (
          selectedPrior.sourceIds.length !== 1
          || selectedPrior.sourceIds[0] !== selectedPrior.id
          || selectedPrior.sourceIds.some((sourceId) =>
            eventSourceIds.has(sourceId)
          )
        )
      ) {
        return [unavailableMatch(
          deal,
          "Analysis unavailable because event and prior-memory source membership crossed.",
        )];
      }
      const dealSourceIds = selectedPrior?.sourceIds ?? [];
      const publicSourceIds = [...eventSourceIds].filter((sourceId) =>
        sourceById.get(sourceId)?.provenance === "public_web"
      );
      if (!publicSourceIds.length || !dealSourceIds.length) {
        return [unavailableMatch(
          deal,
          "Analysis unavailable because selected event or prior authority had no canonical grounding sources.",
        )];
      }
      const deterministicRelevance = overlapStrength(
        publicSourceIds,
        dealSourceIds,
        sourceById,
        deal,
        [selectedEvent],
      );
      if (deterministicRelevance === 0) {
        return [unavailableMatch(
          deal,
          "Analysis unavailable because the selected event and prior authority were not grounded to this Deal.",
        )];
      }

      const whyNow = groundedText(
        match.whyNow,
        match,
        eventSourceIds,
        sourceById,
        "public_fact",
      );
      const previousContext = groundedText(
        match.previousContext,
        match,
        new Set(dealSourceIds),
        sourceById,
        "prior_context",
      );
      if (!whyNow.text || !previousContext.text) {
        return [unavailableMatch(
          deal,
          "Analysis unavailable because required why-now or prior-context claims were not grounded.",
        )];
      }

      const groundedImplications = [
        ...match.positiveImplications,
        ...match.negativeImplications,
      ].map((claim) => groundedText(
        claim,
        match,
        eventSourceIds,
        sourceById,
        "public_fact",
      ));
      const positiveImplications = match.positiveImplications.filter((claim) =>
        groundedImplications.some((groundedClaim) => groundedClaim.text === claim)
      );
      const negativeImplications = match.negativeImplications.filter((claim) =>
        groundedImplications.some((groundedClaim) => groundedClaim.text === claim)
      );
      if (
        positiveImplications.length === 0 && negativeImplications.length === 0
      ) {
        return [unavailableMatch(
          deal,
          "Analysis unavailable because required implication grounding was absent.",
        )];
      }
      const selectedAuthorityIds = new Set([
        ...eventSourceIds,
        ...dealSourceIds,
      ]);
      if (
        match.revisitCitedSourceIds.some((sourceId) =>
          !eventSourceIds.has(sourceId)
        )
        || match.counterevidence.citedSourceIds.some((sourceId) =>
          !selectedAuthorityIds.has(sourceId)
        )
      ) {
        return [unavailableMatch(
          deal,
          "Analysis unavailable because required citations crossed selected Deal/event authority.",
        )];
      }
      const usedSourceIds = new Set([
        ...whyNow.sourceIds,
        ...previousContext.sourceIds,
        ...groundedImplications.flatMap((claim) => claim.sourceIds),
      ]);
      for (const source of selectedEvent.sources) usedSourceIds.add(source.id);
      if (selectedPrior) {
        for (const sourceId of selectedPrior.sourceIds) usedSourceIds.add(sourceId);
      }
      for (const sourceId of match.counterevidence?.citedSourceIds ?? []) {
        usedSourceIds.add(sourceId);
      }
      const scoreBreakdown = buildOpportunityScoreBreakdown({
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
      const direction = directionForImplications(
        positiveImplications,
        negativeImplications,
      );
      if (direction === "none") return [];
      const relationship = direction === "positive"
        ? "satisfies" as const
        : direction === "negative"
        ? "contradicts" as const
        : "related" as const;
      const claimSupport = uniqueClaimSupport([
        ...whyNow.supports,
        ...previousContext.supports,
        ...groundedImplications.flatMap((claim) => claim.supports),
      ]);
      if (
        selectedEvent.adaptation !== "canonical"
        || selectedEvent.eventAt === null
        || !selectedPrior
        || !selectedPrior.priorActions
        || selectedPrior.sourceIds.length !== 1
        || selectedPrior.sourceIds[0] !== selectedPrior.id
        || selectedPrior.provenance !== "demo_fixture"
        || selectedPrior.label !== "Sample decision record"
        || selectedPrior.sourceIds.some((sourceId) => eventSourceIds.has(sourceId))
      ) {
        return [unavailableMatch(
          deal,
          "Analysis unavailable because selected event and prior-memory authority did not resolve independently.",
        )];
      }
      const priorSource = sourceById.get(selectedPrior.id);
      if (
        !priorSource
        || priorSource.adaptation !== "canonical"
        || priorSource.provenance !== "demo_fixture"
        || priorSource.title !== "Sample decision record"
        || priorSource.eventAt !== selectedPrior.occurredAt
      ) {
        return [unavailableMatch(
          deal,
          "Analysis unavailable because the selected Sample decision record payload conflicted with canonical lineage.",
        )];
      }
      const gateSources = uniqueByCanonicalId<SourceRefV2>([
        ...selectedEvent.sources,
        priorSource,
        ...match.counterevidence.citedSourceIds.map(
          (sourceId) => sourceById.get(sourceId)!,
        ),
      ], "source");
      if (gateSources.some((source) => source.adaptation !== "canonical")) {
        return [unavailableMatch(
          deal,
          "Analysis unavailable because the hard-gate catalog was not canonical.",
        )];
      }
      const actions = actionsForDealStatusAndDirection(deal.status, direction);
      let assessment: BeliefChangeAssessmentV1;
      try {
        const gates = evaluateBeliefRevisionHardGates({
          priorInteraction: {
            ...selectedPrior,
            priorActions: selectedPrior.priorActions,
          },
          triggerEvent: {
            id: selectedEvent.id,
            eventAt: selectedEvent.eventAt,
            sourceIds: selectedEvent.sources.map((source) => source.id),
          },
          revisitMapping: {
            priorInteractionId: match.selectedPriorInteractionId,
            revisitConditionIndex: match.revisitConditionIndex,
            revisitConditionText: match.revisitConditionText,
            triggerEventId: match.selectedTriggerEventId,
            citedSourceIds: match.revisitCitedSourceIds,
          },
          counterevidence: match.counterevidence,
          sources: gateSources,
          dealStatus: deal.status,
          direction,
          proposedActions: actions,
        });
        assessment = BeliefChangeAssessmentV1Schema.parse({
          schemaVersion: BELIEF_CHANGE_ASSESSMENT_SCHEMA_VERSION,
          dealStatus: deal.status,
          direction,
          scoreBreakdown,
          gateContext: {
            priorInteraction: {
              ...selectedPrior,
              priorActions: selectedPrior.priorActions,
            },
            triggerEvent: {
              id: selectedEvent.id,
              eventAt: selectedEvent.eventAt,
              sourceIds: selectedEvent.sources.map((source) => source.id),
            },
            sources: gateSources,
          },
          gates,
          actions,
        });
      } catch {
        return [unavailableMatch(
          deal,
          "Analysis unavailable because deterministic hard-gate evaluation failed.",
        )];
      }
      const outcome: CompanyAnalysisOutcome =
        scoreBreakdown.confidence === "low" || !assessment.gates.allPassed
        ? "monitor"
        : "belief_revised";
      return [{
        dealId: match.dealId,
        dealStatus: deal.status,
        outcome,
        confidence: scoreBreakdown.confidence,
        score: scoreBreakdown.finalScore,
        whyNow: whyNow.text,
        previousContext: previousContext.text,
        implications: {
          positive: positiveImplications,
          negative: negativeImplications,
        },
        nextStep: renderRecommendedNextMove(actions),
        relationship,
        events: [selectedEvent],
        demoFixtureIds: [selectedPrior.id],
        sources: [...usedSourceIds].map((sourceId) => sourceById.get(sourceId)!),
        claimSupport,
        beliefAssessment: assessment,
      }];
    });

    return grounded.sort((left, right) => right.score - left.score);
  };

  return {
    analyze,
    async match(input: MatchingInput): Promise<OpportunityReportItem[]> {
      const grounded = await analyze(input);
      return rankBeliefRevisionCandidates(grounded).map((match, index) =>
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

function directionForImplications(
  positive: readonly string[],
  negative: readonly string[],
): Exclude<BeliefChangeDirection, "unavailable"> {
  if (positive.length > 0 && negative.length === 0) return "positive";
  if (negative.length > 0 && positive.length === 0) return "negative";
  if (positive.length > 0 && negative.length > 0) return "mixed";
  return "none";
}

function unavailableMatch(
  deal: MatchingDeal,
  reason: string,
): GroundedMatch {
  return {
    dealId: deal.id,
    dealStatus: deal.status,
    outcome: "analysis_unavailable",
    confidence: "low",
    score: 0,
    whyNow: reason,
    previousContext: reason,
    implications: { positive: [], negative: [] },
    nextStep: renderRecommendedNextMove(
      actionsForDealStatusAndDirection(deal.status, "unavailable"),
    ),
    relationship: "related",
    events: [],
    sources: [],
    demoFixtureIds: [],
    claimSupport: [],
    analysisFailureReason: reason,
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
