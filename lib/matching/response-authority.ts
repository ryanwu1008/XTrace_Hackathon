import {
  SAMPLE_DECISION_RECORD_LABEL,
  sourceCanGroundOutputFact,
  sourceClaimSupportKind,
  type SourceRefV2,
} from "../contracts/source-evidence";
import { SAMPLE_RESEARCH_SCREENING_RECORD_LABEL } from "../contracts/research-candidate";
import { isSampleResearchScreeningAuthoritySource } from "./context";
import type {
  MatchingInput,
  MatchingPriorInteractionCandidate,
  ReasonedMatch,
} from "./service";

export type ReasonedMatchAuthorityPartition = {
  valid: ReasonedMatch[];
  invalid: ReasonedMatch[];
  duplicateDealIds: string[];
};

export type ReasonedMatchRepairConstraint = {
  dealId: string;
  selectedTriggerEventId: string;
  selectedPriorInteractionId: string;
  revisitConditionIndex: number;
  revisitConditionText: string;
  revisitCitedSourceIds: string[];
  counterevidenceCitedSourceIds: string[];
  scoreInputs: ReasonedMatch["scoreInputs"];
  positiveImplicationCount: number;
  negativeImplicationCount: number;
};

type ResolvedSelection = {
  eventSourceIds: Set<string>;
  priorSourceIds: Set<string>;
  selectedAuthorityIds: Set<string>;
  sourceById: Map<string, SourceRefV2>;
};

export function partitionReasonedMatchAuthority(
  matches: readonly ReasonedMatch[],
  input: MatchingInput,
): ReasonedMatchAuthorityPartition {
  const counts = new Map<string, number>();
  for (const match of matches) {
    counts.set(match.dealId, (counts.get(match.dealId) ?? 0) + 1);
  }
  const duplicateDealIds = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([dealId]) => dealId);
  const duplicateSet = new Set(duplicateDealIds);
  const valid: ReasonedMatch[] = [];
  const invalid: ReasonedMatch[] = [];
  for (const match of matches) {
    if (
      duplicateSet.has(match.dealId)
      || !reasonedMatchHasExactAuthority(match, input)
    ) {
      invalid.push(match);
    } else {
      valid.push(match);
    }
  }
  return { valid, invalid, duplicateDealIds };
}

export function reasonedMatchesHaveExactAuthority(
  matches: readonly ReasonedMatch[],
  input: MatchingInput,
): boolean {
  const partition = partitionReasonedMatchAuthority(matches, input);
  return partition.invalid.length === 0
    && partition.duplicateDealIds.length === 0;
}

export function buildReasonedMatchRepairConstraint(
  match: ReasonedMatch,
  input: MatchingInput,
): ReasonedMatchRepairConstraint | null {
  if (!resolveSelection(match, input)) return null;
  return {
    dealId: match.dealId,
    selectedTriggerEventId: match.selectedTriggerEventId!,
    selectedPriorInteractionId: match.selectedPriorInteractionId!,
    revisitConditionIndex: match.revisitConditionIndex!,
    revisitConditionText: match.revisitConditionText!,
    revisitCitedSourceIds: sortedUnique(match.revisitCitedSourceIds!),
    counterevidenceCitedSourceIds: sortedUnique(
      match.counterevidence!.citedSourceIds,
    ),
    scoreInputs: { ...match.scoreInputs },
    positiveImplicationCount: match.positiveImplications.length,
    negativeImplicationCount: match.negativeImplications.length,
  };
}

export function reasonedMatchSatisfiesRepairConstraint(
  match: ReasonedMatch,
  constraint: ReasonedMatchRepairConstraint,
): boolean {
  return match.dealId === constraint.dealId
    && match.selectedTriggerEventId === constraint.selectedTriggerEventId
    && match.selectedPriorInteractionId === constraint.selectedPriorInteractionId
    && match.revisitConditionIndex === constraint.revisitConditionIndex
    && match.revisitConditionText === constraint.revisitConditionText
    && sameStrings(
      match.revisitCitedSourceIds ?? [],
      constraint.revisitCitedSourceIds,
    )
    && sameStrings(
      match.counterevidence?.citedSourceIds ?? [],
      constraint.counterevidenceCitedSourceIds,
    )
    && match.scoreInputs.eventRelevance
      === constraint.scoreInputs.eventRelevance
    && match.scoreInputs.dealRelevance === constraint.scoreInputs.dealRelevance
    && match.scoreInputs.priorContextStrength
      === constraint.scoreInputs.priorContextStrength
    && match.scoreInputs.evidenceQuality
      === constraint.scoreInputs.evidenceQuality
    && match.positiveImplications.length
      === constraint.positiveImplicationCount
    && match.negativeImplications.length
      === constraint.negativeImplicationCount;
}

function reasonedMatchHasExactAuthority(
  match: ReasonedMatch,
  input: MatchingInput,
): boolean {
  const selection = resolveSelection(match, input);
  if (!selection) return false;
  const {
    eventSourceIds,
    priorSourceIds,
    selectedAuthorityIds,
    sourceById,
  } = selection;
  if (
    !isUnique(match.positiveImplications)
    || !isUnique(match.negativeImplications)
    || match.positiveImplications.some((claim) =>
      match.negativeImplications.includes(claim)
    )
  ) return false;

  const expectedClaims = sortedUnique([
    match.whyNow,
    match.previousContext,
    ...match.positiveImplications,
    ...match.negativeImplications,
  ]);
  const actualClaimKeys = sortedUnique(Object.keys(match.claimSourceIds));
  if (!sameStrings(expectedClaims, actualClaimKeys)) return false;

  if (!claimHasExactAuthority({
    claim: match.whyNow,
    sourceIds: match.claimSourceIds[match.whyNow],
    allowedSourceIds: eventSourceIds,
    sourceById,
    scope: "event",
  })) return false;
  if (!claimHasExactAuthority({
    claim: match.previousContext,
    sourceIds: match.claimSourceIds[match.previousContext],
    allowedSourceIds: priorSourceIds,
    sourceById,
    scope: "prior",
  })) return false;
  for (const claim of [
    ...match.positiveImplications,
    ...match.negativeImplications,
  ]) {
    if (!claimHasExactAuthority({
      claim,
      sourceIds: match.claimSourceIds[claim],
      allowedSourceIds: eventSourceIds,
      sourceById,
      scope: "event",
    })) return false;
  }
  if (!claimHasExactAuthority({
    claim: match.counterevidence!.statement,
    sourceIds: match.counterevidence!.citedSourceIds,
    allowedSourceIds: selectedAuthorityIds,
    sourceById,
    scope: "counterevidence",
  })) return false;

  const expectedCitedSourceIds = sortedUnique([
    ...Object.values(match.claimSourceIds).flat(),
    ...match.revisitCitedSourceIds!,
    ...match.counterevidence!.citedSourceIds,
  ]);
  return isUnique(match.citedSourceIds)
    && sameStrings(match.citedSourceIds, expectedCitedSourceIds);
}

function resolveSelection(
  match: ReasonedMatch,
  input: MatchingInput,
): ResolvedSelection | null {
  if (
    !input.deals.some(({ id }) => id === match.dealId)
    || match.selectedTriggerEventId === undefined
    || match.selectedPriorInteractionId === undefined
    || match.revisitConditionIndex === undefined
    || match.revisitConditionText === undefined
    || match.revisitCitedSourceIds === undefined
    || match.counterevidence === undefined
  ) return null;

  const selectedEvent = input.events.find(
    ({ id }) => id === match.selectedTriggerEventId,
  );
  const dealContexts = input.memoryContexts.filter(
    ({ dealId }) => dealId === match.dealId,
  );
  if (
    !selectedEvent
    || selectedEvent.adaptation !== "canonical"
    || selectedEvent.eventAt === null
    || dealContexts.length !== 1
  ) return null;
  const candidates = (dealContexts[0]!.interactionCandidates ?? []).filter(
    ({ id }) => id === match.selectedPriorInteractionId,
  );
  if (candidates.length !== 1) return null;
  const selectedPrior = candidates[0]!;

  const sourceById = new Map<string, SourceRefV2>();
  for (const source of input.sources) sourceById.set(source.id, source);
  for (const event of input.events) {
    for (const source of event.sources) sourceById.set(source.id, source);
  }
  const priorSource = sourceById.get(selectedPrior.id);
  if (!priorSource || !validPriorAuthority(selectedPrior, priorSource)) {
    return null;
  }
  const selectedCondition = selectedPrior.revisitConditions[
    match.revisitConditionIndex
  ];
  const eventSourceIds = new Set(
    selectedEvent.sources.map(({ id }) => id),
  );
  if (
    selectedCondition === undefined
    || selectedCondition !== match.revisitConditionText
    || !isUnique(match.revisitCitedSourceIds)
    || match.revisitCitedSourceIds.length === 0
    || match.revisitCitedSourceIds.some((id) => {
      const source = sourceById.get(id);
      return !source
        || !eventSourceIds.has(id)
        || source.provenance !== "public_web"
        || !["trigger", "corroborating"].includes(source.evidenceRole)
        || !sourceCanGroundOutputFact(source);
    })
  ) return null;
  if (
    !isUnique(match.counterevidence.citedSourceIds)
    || match.counterevidence.citedSourceIds.length === 0
  ) return null;

  const priorSourceIds = new Set(selectedPrior.sourceIds);
  return {
    eventSourceIds,
    priorSourceIds,
    selectedAuthorityIds: new Set([
      ...eventSourceIds,
      ...priorSourceIds,
    ]),
    sourceById,
  };
}

function validPriorAuthority(
  candidate: MatchingPriorInteractionCandidate,
  source: SourceRefV2,
): boolean {
  if (
    candidate.sourceIds.length !== 1
    || candidate.sourceIds[0] !== candidate.id
    || source.id !== candidate.id
    || source.adaptation !== "canonical"
    || source.evidenceRole !== "context"
    || source.eventAt !== candidate.occurredAt
    || !sourceCanGroundOutputFact(source)
  ) return false;
  if (candidate.provenance === "demo_fixture") {
    return candidate.label === SAMPLE_DECISION_RECORD_LABEL
      && source.provenance === "demo_fixture"
      && source.title === SAMPLE_DECISION_RECORD_LABEL;
  }
  return candidate.label === SAMPLE_RESEARCH_SCREENING_RECORD_LABEL
    && candidate.meetingOccurred === false
    && candidate.vcInteraction === false
    && isSampleResearchScreeningAuthoritySource(source);
}

function claimHasExactAuthority(input: {
  claim: string;
  sourceIds: readonly string[] | undefined;
  allowedSourceIds: ReadonlySet<string>;
  sourceById: ReadonlyMap<string, SourceRefV2>;
  scope: "event" | "prior" | "counterevidence";
}): boolean {
  if (!input.sourceIds?.length || !isUnique(input.sourceIds)) return false;
  return input.sourceIds.every((sourceId) => {
    const source = input.sourceById.get(sourceId);
    if (!source || !input.allowedSourceIds.has(sourceId)) return false;
    if (
      input.scope === "event"
      && (
        source.provenance !== "public_web"
        || !["trigger", "corroborating"].includes(source.evidenceRole)
      )
    ) return false;
    if (
      input.scope === "prior"
      && source.evidenceRole !== "context"
    ) return false;
    if (
      input.scope === "counterevidence"
      && source.evidenceRole !== "counterevidence"
    ) return false;
    return sourceClaimSupportKind(source, input.claim) !== null;
  });
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function isUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.length === sortedRight.length
    && sortedLeft.every((value, index) => value === sortedRight[index]);
}
