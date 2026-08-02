import { z } from "zod";

import {
  BeliefActionSchema,
  BeliefRevisionGateResultsSchema,
  type BeliefAction,
  type BeliefChangeDirection,
  type BeliefRevisionGateResults,
  type DealStatus,
} from "../contracts/domain";
import {
  actionsForDealStatusAndDirection,
  beliefActionListsEqual,
} from "../reports/action-policy";

export interface SelectedPriorInteractionForBeliefRevision {
  id: string;
  occurredAt: string;
  revisitConditions: readonly string[];
  provenance: "demo_fixture";
  label: "Sample decision record";
  priorActions: readonly BeliefAction[];
}

export interface SelectedTriggerEventForBeliefRevision {
  id: string;
  eventAt: string;
  sourceIds: readonly string[];
}

export interface ClaimedRevisitConditionMapping {
  priorInteractionId: string;
  revisitConditionIndex: number;
  revisitConditionText: string;
  triggerEventId: string;
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
  resolvableSourceIds: readonly string[];
  dealStatus: DealStatus;
  direction: BeliefChangeDirection;
  proposedActions: readonly BeliefAction[];
}

const ActionListSchema = z.array(BeliefActionSchema).min(1);

function uniqueNonemptyResolvableIds(
  citedSourceIds: readonly string[],
  resolvableSourceIds: ReadonlySet<string>,
): boolean {
  return citedSourceIds.length > 0
    && new Set(citedSourceIds).size === citedSourceIds.length
    && citedSourceIds.every((sourceId) => resolvableSourceIds.has(sourceId));
}

function substantiveStatement(statement: string): boolean {
  const trimmed = statement.trim();
  return trimmed.length >= 20
    && trimmed.split(/\s+/u).filter(Boolean).length >= 3;
}

export function evaluateBeliefRevisionHardGates(
  input: EvaluateBeliefRevisionHardGatesInput,
): BeliefRevisionGateResults {
  const priorActions = ActionListSchema.parse(input.priorInteraction.priorActions);
  const proposedActions = ActionListSchema.parse(input.proposedActions);
  const resolvableSourceIds = new Set(input.resolvableSourceIds);
  const triggerSourceIds = new Set(input.triggerEvent.sourceIds);

  const chronologyPassed = Date.parse(input.priorInteraction.occurredAt)
    < Date.parse(input.triggerEvent.eventAt);

  const mapping = input.revisitMapping;
  const mappedCondition = Number.isInteger(mapping.revisitConditionIndex)
    && mapping.revisitConditionIndex >= 0
    ? input.priorInteraction.revisitConditions[mapping.revisitConditionIndex]
    : undefined;
  const mappingCitationsResolvable = uniqueNonemptyResolvableIds(
    mapping.citedSourceIds,
    resolvableSourceIds,
  ) && mapping.citedSourceIds.every((sourceId) => triggerSourceIds.has(sourceId));
  const revisitPassed = input.priorInteraction.provenance === "demo_fixture"
    && input.priorInteraction.label === "Sample decision record"
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
  );

  const expectedActions = actionsForDealStatusAndDirection(
    input.dealStatus,
    input.direction,
  );
  const actionDeltaPassed = beliefActionListsEqual(
    proposedActions,
    expectedActions,
  ) && !beliefActionListsEqual(priorActions, proposedActions);

  return BeliefRevisionGateResultsSchema.parse({
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
        : "The claimed revisit condition must exactly bind the selected Sample decision record, trigger event, and resolvable trigger citations.",
    },
    counterevidence: {
      statement: input.counterevidence.statement,
      citedSourceIds: [...input.counterevidence.citedSourceIds],
      passed: counterevidencePassed,
      failureReason: counterevidencePassed
        ? null
        : "Counterevidence must be substantive and cite at least one resolvable source.",
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
  });
}
