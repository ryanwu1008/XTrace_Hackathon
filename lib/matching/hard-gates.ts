import type {
  BeliefAction,
  BeliefChangeDirection,
  BeliefRevisionGateResults,
  DealStatus,
} from "../contracts/domain";
import {
  TemporalValueV2Schema,
  sourceCanGroundOutputFact,
  sourceClaimSupportKind,
  type SourceRefV2,
} from "../contracts/source-evidence";
import {
  actionsForDealStatusAndDirection,
  beliefActionListsEqual,
  parseBeliefActions,
} from "../reports/action-policy";

interface SelectedSampleDecisionForBeliefRevision {
  id: string;
  occurredAt: string;
  sourceIds: readonly string[];
  revisitConditions: readonly string[];
  provenance: "demo_fixture";
  label: "Sample decision record";
  priorActions: readonly BeliefAction[];
}

interface SelectedResearchScreeningForBeliefRevision {
  id: string;
  occurredAt: string;
  sourceIds: readonly string[];
  revisitConditions: readonly string[];
  provenance: "source_document";
  label: "Sample research screening record";
  meetingOccurred: false;
  vcInteraction: false;
  priorActions: readonly BeliefAction[];
}

export type SelectedPriorInteractionForBeliefRevision =
  | SelectedSampleDecisionForBeliefRevision
  | SelectedResearchScreeningForBeliefRevision;

export interface SelectedTriggerEventForBeliefRevision {
  id: string;
  eventAt: string;
  sourceIds: readonly string[];
}

export interface ClaimedRevisitConditionMapping {
  priorInteractionId: string | null;
  revisitConditionIndex: number | null;
  revisitConditionText: string | null;
  triggerEventId: string | null;
  citedSourceIds: readonly string[];
}

export interface ClaimedCounterevidence {
  statement: string;
  citedSourceIds: readonly string[];
}

export interface EvaluateBeliefRevisionHardGatesInput {
  priorInteraction: SelectedPriorInteractionForBeliefRevision;
  triggerEvent: SelectedTriggerEventForBeliefRevision;
  revisitMapping: ClaimedRevisitConditionMapping;
  counterevidence: ClaimedCounterevidence;
  sources: readonly SourceRefV2[];
  dealStatus: DealStatus;
  direction: BeliefChangeDirection;
  proposedActions: readonly BeliefAction[];
}

function uniqueNonemptyResolvableIds(
  citedSourceIds: readonly string[],
  resolvableSourceIds: ReadonlySet<string>,
): boolean {
  return citedSourceIds.length > 0
    && new Set(citedSourceIds).size === citedSourceIds.length
    && citedSourceIds.every((sourceId) => resolvableSourceIds.has(sourceId));
}

function selectedPriorPredatesTrigger(
  priorInteractionAt: string,
  triggerEventAt: string,
): boolean {
  const parsedPrior = TemporalValueV2Schema.safeParse(priorInteractionAt);
  if (
    !parsedPrior.success
    || /^\d{4}-\d{2}-\d{2}$/u.test(parsedPrior.data)
  ) {
    throw new TypeError("Invalid prior interaction timestamp");
  }
  const parsedTrigger = TemporalValueV2Schema.safeParse(triggerEventAt);
  if (!parsedTrigger.success) {
    throw new TypeError("Invalid trigger event date or timestamp");
  }
  if (/^\d{4}-\d{2}-\d{2}$/u.test(parsedTrigger.data)) {
    return parsedPrior.data.slice(0, 10) < parsedTrigger.data;
  }
  return Date.parse(parsedPrior.data) < Date.parse(parsedTrigger.data);
}

function substantiveStatement(statement: string): boolean {
  const trimmed = statement.trim();
  return trimmed.length >= 20
    && trimmed.split(/\s+/u).filter(Boolean).length >= 3;
}

export function evaluateBeliefRevisionHardGates(
  input: EvaluateBeliefRevisionHardGatesInput,
): BeliefRevisionGateResults {
  const priorActions = parseBeliefActions(input.priorInteraction.priorActions);
  const proposedActions = parseBeliefActions(input.proposedActions);
  const sourceById = new Map(input.sources.map((source) => [source.id, source]));
  const resolvableSourceIds = new Set(sourceById.keys());
  const triggerSourceIds = new Set(input.triggerEvent.sourceIds);

  const chronologyPassed = selectedPriorPredatesTrigger(
    input.priorInteraction.occurredAt,
    input.triggerEvent.eventAt,
  );

  const mapping = input.revisitMapping;
  const mappedCondition = typeof mapping.revisitConditionIndex === "number"
    && Number.isInteger(mapping.revisitConditionIndex)
    && mapping.revisitConditionIndex >= 0
    ? input.priorInteraction.revisitConditions[mapping.revisitConditionIndex]
    : undefined;
  const mappingCitationsResolvable = uniqueNonemptyResolvableIds(
    mapping.citedSourceIds,
    resolvableSourceIds,
  ) && mapping.citedSourceIds.every((sourceId) => triggerSourceIds.has(sourceId));
  const validPriorAuthority =
    (input.priorInteraction.provenance === "demo_fixture"
      && input.priorInteraction.label === "Sample decision record")
    || (input.priorInteraction.provenance === "source_document"
      && input.priorInteraction.label === "Sample research screening record"
      && input.priorInteraction.meetingOccurred === false
      && input.priorInteraction.vcInteraction === false);
  const revisitPassed = validPriorAuthority
    && mapping.priorInteractionId === input.priorInteraction.id
    && mapping.triggerEventId === input.triggerEvent.id
    && mappedCondition !== undefined
    && mapping.revisitConditionText === mappedCondition
    && mappingCitationsResolvable;

  const counterevidencePassed = substantiveStatement(
    input.counterevidence.statement,
  ) && uniqueNonemptyResolvableIds(
    input.counterevidence.citedSourceIds,
    resolvableSourceIds,
  ) && input.counterevidence.citedSourceIds.every((sourceId) => {
    const source = sourceById.get(sourceId);
    return source !== undefined
      && source.adaptation === "canonical"
      && source.evidenceRole === "counterevidence"
      && sourceCanGroundOutputFact(source)
      && sourceClaimSupportKind(
        source,
        input.counterevidence.statement,
      ) !== null;
  });

  const expectedActions = actionsForDealStatusAndDirection(
    input.dealStatus,
    input.direction,
  );
  const actionDeltaPassed = beliefActionListsEqual(
    proposedActions,
    expectedActions,
  ) && !beliefActionListsEqual(priorActions, proposedActions);

  return {
    chronology: {
      priorInteractionId: input.priorInteraction.id,
      priorInteractionAt: input.priorInteraction.occurredAt,
      triggerEventId: input.triggerEvent.id,
      triggerEventAt: input.triggerEvent.eventAt,
      passed: chronologyPassed,
      failureReason: chronologyPassed
        ? null
        : "The selected prior interaction must predate the selected trigger event.",
    },
    revisitConditionMapping: {
      priorInteractionId: mapping.priorInteractionId,
      revisitConditionIndex: mapping.revisitConditionIndex,
      revisitConditionText: mapping.revisitConditionText,
      triggerEventId: mapping.triggerEventId,
      citedSourceIds: [...mapping.citedSourceIds],
      passed: revisitPassed,
      failureReason: revisitPassed
        ? null
        : "The claimed revisit condition must exactly bind the selected typed prior-context authority, trigger event, and resolvable trigger citations.",
    },
    counterevidence: {
      statement: input.counterevidence.statement,
      citedSourceIds: [...input.counterevidence.citedSourceIds],
      passed: counterevidencePassed,
      failureReason: counterevidencePassed
        ? null
        : "Counterevidence must be substantive and cite canonical evidence that supports the complete statement.",
    },
    actionDelta: {
      priorActions,
      proposedActions,
      passed: actionDeltaPassed,
      failureReason: actionDeltaPassed
        ? null
        : "Proposed actions must materially differ from the selected prior action and exactly match the deterministic status-direction policy.",
    },
    allPassed: chronologyPassed
      && revisitPassed
      && counterevidencePassed
      && actionDeltaPassed,
  };
}

export function beliefRevisionGateResultsEqual(
  left: BeliefRevisionGateResults,
  right: BeliefRevisionGateResults,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
