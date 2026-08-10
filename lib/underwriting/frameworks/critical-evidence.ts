import type { CompanyAnalysis } from "../../contracts/domain";
import type {
  Calculation,
  EvidencePack,
} from "../../contracts/evidence";
import {
  DecisionCriticalEvidenceRefSchema,
  type DecisionCriticalEvidenceRef,
  type DecisionCriticalOriginRef,
} from "../../contracts/named-lens";
import type { DecisionResult } from "../../contracts/underwriting";
import { compareUtf8 } from "../../format/canonical-order";
import type { CandidateGroundingSnapshot } from "../candidate-grounding";

interface ProjectionContribution {
  evidencePackItemId: string;
  classification: "fact" | "assumption";
  originRefs: DecisionCriticalOriginRef[];
  reasonCode: string;
  resolutionPath: string[];
}

export function buildDecisionCriticalEvidenceProjection(input: {
  analysis: CompanyAnalysis;
  pack: EvidencePack;
  grounding: CandidateGroundingSnapshot;
  calculations: Calculation[];
  decision: DecisionResult;
}): DecisionCriticalEvidenceRef[] {
  assertCandidateBoundary(input);
  const factById = new Map(input.pack.facts.map((item) => [item.id, item]));
  const assumptionById = new Map(
    input.pack.assumptions.map((item) => [item.id, item]),
  );
  const revisionById = new Map(
    input.grounding.sourceRevisionSnapshots.map((item) => [item.id, item]),
  );
  const revisionIdsBySourceId = new Map<string, string[]>();
  for (const revision of input.grounding.sourceRevisionSnapshots) {
    const revisionIds = revisionIdsBySourceId.get(revision.sourceId) ?? [];
    revisionIds.push(revision.id);
    revisionIdsBySourceId.set(revision.sourceId, revisionIds);
  }
  const factsByRevisionId = new Map<string, typeof input.pack.facts>();
  for (const fact of input.pack.facts) {
    const facts = factsByRevisionId.get(fact.sourceRevisionId) ?? [];
    facts.push(fact);
    factsByRevisionId.set(fact.sourceRevisionId, facts);
  }
  const calculationsById = uniqueMap(
    input.calculations,
    ({ id }) => id,
    "Calculation",
  );
  const contributions: ProjectionContribution[] = [];

  const addPackItem = (options: {
    itemId: string;
    origin: DecisionCriticalOriginRef;
    additionalOriginRefs?: DecisionCriticalOriginRef[];
    reasonCode: string;
    path: string[];
  }): void => {
    const fact = factById.get(options.itemId);
    const assumption = assumptionById.get(options.itemId);
    if (!fact && !assumption) unresolved(options.origin, options.itemId);
    contributions.push({
      evidencePackItemId: options.itemId,
      classification: fact ? "fact" : "assumption",
      originRefs: [options.origin, ...(options.additionalOriginRefs ?? [])],
      reasonCode: options.reasonCode,
      resolutionPath: [...options.path, options.itemId],
    });
  };

  const resolveRevision = (options: {
    revisionId: string;
    origin: DecisionCriticalOriginRef;
    reasonCode: string;
    path: string[];
  }): void => {
    const revision = revisionById.get(options.revisionId);
    const facts = factsByRevisionId.get(options.revisionId) ?? [];
    if (
      !revision
      || revision.workspaceId !== input.pack.workspaceId
      || !input.pack.sourceRevisionIds.includes(options.revisionId)
      || facts.length === 0
    ) {
      unresolved(options.origin, options.revisionId);
    }
    for (const fact of facts) {
      contributions.push({
        evidencePackItemId: fact.id,
        classification: "fact",
        originRefs: [options.origin, {
          kind: "source_revision",
          id: options.revisionId,
        }],
        reasonCode: options.reasonCode,
        resolutionPath: [...options.path, options.revisionId, fact.id],
      });
    }
  };

  const resolveSource = (options: {
    sourceId: string;
    explicitRevisionId?: string | null;
    origin: DecisionCriticalOriginRef;
    reasonCode: string;
    path: string[];
  }): void => {
    const candidateRevisionIds = options.explicitRevisionId
      ? [options.explicitRevisionId]
      : revisionIdsBySourceId.get(options.sourceId) ?? [];
    if (candidateRevisionIds.length !== 1) {
      unresolved(options.origin, options.sourceId);
    }
    const revision = revisionById.get(candidateRevisionIds[0]!);
    if (!revision || revision.sourceId !== options.sourceId) {
      unresolved(options.origin, options.sourceId);
    }
    resolveRevision({
      revisionId: revision.id,
      origin: options.origin,
      reasonCode: options.reasonCode,
      path: [...options.path, options.sourceId],
    });
  };

  const matchedEventIds = input.analysis.currentRunAudit
    ?.matchedMarketEventIds ?? input.analysis.marketEvidence.eventIds;
  const eventById = uniqueMap(
    input.analysis.marketEvidence.events,
    ({ id }) => id,
    "MarketEvent",
  );
  for (const eventId of [...matchedEventIds].sort(compareUtf8)) {
    const event = eventById.get(eventId);
    if (!event || !("schemaVersion" in event) || event.adaptation !== "canonical") {
      unresolved({ kind: "market_event", id: eventId }, eventId);
    }
    for (const source of event.sources) {
      if (source.adaptation !== "canonical" || source.sourceRevisionId === null) {
        unresolved({ kind: "market_event", id: eventId }, source.id);
      }
      resolveSource({
        sourceId: source.id,
        explicitRevisionId: source.sourceRevisionId,
        origin: { kind: "market_event", id: eventId },
        reasonCode: "BELIEF_CHANGE_MARKET_EVENT",
        path: [eventId],
      });
    }
  }

  const assessment = input.analysis.beliefAssessment;
  if (assessment) {
    const sourceById = uniqueMap(
      assessment.gateContext.sources,
      ({ id }) => id,
      "hard-gate source",
    );
    const resolveGateSource = (
      kind:
        | "chronology_gate"
        | "revisit_gate"
        | "counterevidence_gate",
      sourceId: string,
      reasonCode: string,
    ): void => {
      const source = sourceById.get(sourceId);
      if (!source || source.adaptation !== "canonical") {
        unresolved({ kind, id: sourceId }, sourceId);
      }
      resolveSource({
        sourceId,
        explicitRevisionId: source.sourceRevisionId,
        origin: { kind, id: sourceId },
        reasonCode,
        path: [sourceId],
      });
    };

    if (assessment.gates.chronology.passed) {
      const chronologySourceIds = [
        ...assessment.gateContext.priorInteraction.sourceIds,
        ...assessment.gateContext.triggerEvent.sourceIds,
      ];
      for (const sourceId of uniqueSorted(chronologySourceIds)) {
        resolveGateSource(
          "chronology_gate",
          sourceId,
          "BELIEF_CHANGE_CHRONOLOGY_GATE",
        );
      }
    }
    if (assessment.gates.revisitConditionMapping.passed) {
      for (const sourceId of uniqueSorted(
        assessment.gates.revisitConditionMapping.citedSourceIds,
      )) {
        resolveGateSource(
          "revisit_gate",
          sourceId,
          "BELIEF_CHANGE_REVISIT_GATE",
        );
      }
    }
    if (assessment.gates.counterevidence.passed) {
      for (const sourceId of uniqueSorted(
        assessment.gates.counterevidence.citedSourceIds,
      )) {
        resolveGateSource(
          "counterevidence_gate",
          sourceId,
          "BELIEF_CHANGE_COUNTEREVIDENCE_GATE",
        );
      }
    }

    // actionDelta intentionally contributes no origin: its persisted action
    // records carry no candidate-local evidence edge.
  }

  for (const sourceId of uniqueSorted([
    ...input.analysis.investmentMemory.sourceIds,
    ...input.analysis.investmentMemory.fixtureIds,
  ])) {
    resolveSource({
      sourceId,
      origin: { kind: "prior_record", id: sourceId },
      reasonCode: "BELIEF_CHANGE_PRIOR_RECORD",
      path: [sourceId],
    });
  }

  resolveXTraceLineage({
    input,
    revisionById,
    resolveRevision,
  });

  const resolveDecisionRef = (options: {
    itemId: string;
    origin: DecisionCriticalOriginRef;
    reasonCode: string;
    path: string[];
    activeCalculationIds: Set<string>;
    calculationOriginRefs: DecisionCriticalOriginRef[];
  }): void => {
    if (factById.has(options.itemId) || assumptionById.has(options.itemId)) {
      addPackItem({
        ...options,
        additionalOriginRefs: options.calculationOriginRefs,
      });
      return;
    }
    const calculation = calculationsById.get(options.itemId);
    if (!calculation || calculation.status !== "completed") {
      unresolved(options.origin, options.itemId);
    }
    if (options.activeCalculationIds.has(calculation.id)) {
      throw new Error(
        `Decision-critical Calculation lineage cycle at ${calculation.id}.`,
      );
    }
    const activeCalculationIds = new Set(options.activeCalculationIds);
    activeCalculationIds.add(calculation.id);
    let resolvedInputs = 0;
    for (const reference of calculation.inputRefs) {
      if (
        reference.type === "policy"
        && !factById.has(reference.itemId)
        && !assumptionById.has(reference.itemId)
        && !calculationsById.has(reference.itemId)
      ) {
        continue;
      }
      resolveDecisionRef({
        itemId: reference.itemId,
        origin: options.origin,
        reasonCode: options.reasonCode,
        path: [...options.path, calculation.id],
        activeCalculationIds,
        calculationOriginRefs: [
          ...options.calculationOriginRefs,
          { kind: "calculation", id: calculation.id },
        ],
      });
      resolvedInputs += 1;
    }
    if (resolvedInputs === 0) unresolved(options.origin, calculation.id);
  };

  for (const rule of [...input.decision.firedRules].sort((left, right) =>
    compareUtf8(left.ruleId, right.ruleId)
  )) {
    for (const itemId of uniqueSorted(rule.inputRefs)) {
      resolveDecisionRef({
        itemId,
        origin: { kind: "fired_rule", id: rule.ruleId },
        reasonCode: "FORMAL_DECISION_RULE_INPUT",
        path: [rule.ruleId],
        activeCalculationIds: new Set(),
        calculationOriginRefs: [],
      });
    }
  }
  for (const itemId of uniqueSorted(input.decision.blockingEvidenceItemIds)) {
    addPackItem({
      itemId,
      origin: { kind: "blocking_evidence", id: itemId },
      reasonCode: "FORMAL_DECISION_BLOCKING_EVIDENCE",
      path: [input.decision.id],
    });
  }

  return canonicalProjection(contributions);
}

function resolveXTraceLineage(input: {
  input: {
    analysis: CompanyAnalysis;
    pack: EvidencePack;
    grounding: CandidateGroundingSnapshot;
  };
  revisionById: ReadonlyMap<string, CandidateGroundingSnapshot["sourceRevisionSnapshots"][number]>;
  resolveRevision(options: {
    revisionId: string;
    origin: DecisionCriticalOriginRef;
    reasonCode: string;
    path: string[];
  }): void;
}): void {
  const lineage = input.input.grounding.xtraceLineage;
  const analysisMemoryIds = uniqueSorted(
    input.input.analysis.investmentMemory.memoryIds,
  );
  if (!sameStrings(uniqueSorted(lineage.memoryIds), analysisMemoryIds)) {
    throw new Error("XTrace memory lineage cannot resolve exactly to the CompanyAnalysis memory set.");
  }
  if (lineage.memoryIds.length === 0) {
    if (
      lineage.sourceRevisionIds.length > 0
      || lineage.sourceIds.length > 0
      || lineage.fixtureIds.length > 0
    ) {
      throw new Error("XTrace lineage without a memory cannot resolve exactly.");
    }
    return;
  }
  if (lineage.memoryIds.length !== 1) {
    throw new Error(
      "Aggregate multi-memory XTrace lineage is ambiguous and cannot resolve to exact source revisions.",
    );
  }
  const expectedSourceIds = uniqueSorted(lineage.sourceRevisionIds.map(
    (revisionId) => {
      const revision = input.revisionById.get(revisionId);
      if (
        !revision
        || revision.workspaceId !== input.input.pack.workspaceId
        || !input.input.pack.sourceRevisionIds.includes(revisionId)
      ) {
        unresolved({ kind: "xtrace_memory", id: lineage.memoryIds[0]! }, revisionId);
      }
      return revision.sourceId;
    },
  ));
  const fixtureSourceIds = lineage.fixtureIds.map((id) => `source_${id}`);
  if (!sameStrings(
    expectedSourceIds,
    uniqueSorted([...lineage.sourceIds, ...fixtureSourceIds]),
  )) {
    throw new Error("XTrace memory source identities cannot resolve exactly to source revisions.");
  }
  for (const revisionId of uniqueSorted(lineage.sourceRevisionIds)) {
    input.resolveRevision({
      revisionId,
      origin: { kind: "xtrace_memory", id: lineage.memoryIds[0]! },
      reasonCode: "BELIEF_CHANGE_XTRACE_MEMORY",
      path: [lineage.memoryIds[0]!],
    });
  }
}

function assertCandidateBoundary(input: {
  analysis: CompanyAnalysis;
  pack: EvidencePack;
  grounding: CandidateGroundingSnapshot;
}): void {
  if (input.analysis.dealId !== input.pack.dealId) {
    throw new Error("Decision-critical evidence must remain candidate-local to one Deal.");
  }
  const packRevisionIds = uniqueSorted(input.pack.sourceRevisionIds);
  const groundingRevisionIds = uniqueSorted(input.grounding.sourceRevisionIds);
  const snapshotRevisionIds = uniqueSorted(
    input.grounding.sourceRevisionSnapshots.map(({ id }) => id),
  );
  if (
    !sameStrings(packRevisionIds, groundingRevisionIds)
    || !sameStrings(packRevisionIds, snapshotRevisionIds)
    || input.grounding.sourceRevisionSnapshots.some(({ workspaceId }) =>
      workspaceId !== input.pack.workspaceId
    )
  ) {
    throw new Error(
      "Decision-critical Source Revision lineage is outside the candidate-local workspace and Evidence Pack.",
    );
  }
}

function canonicalProjection(
  contributions: readonly ProjectionContribution[],
): DecisionCriticalEvidenceRef[] {
  const byItemId = new Map<string, ProjectionContribution[]>();
  for (const contribution of contributions) {
    const items = byItemId.get(contribution.evidencePackItemId) ?? [];
    items.push(contribution);
    byItemId.set(contribution.evidencePackItemId, items);
  }
  return [...byItemId.entries()]
    .sort(([left], [right]) => compareUtf8(left, right))
    .map(([, items]) => {
      const first = items[0]!;
      const classifications = new Set(items.map(({ classification }) => classification));
      if (classifications.size !== 1) {
        throw new Error("Decision-critical Evidence Pack classification is ambiguous.");
      }
      const originRefs = uniqueBy(
        items.flatMap(({ originRefs }) => originRefs),
        ({ kind, id }) => `${kind}\u0000${id}`,
      ).sort((left, right) =>
        compareUtf8(left.kind, right.kind) || compareUtf8(left.id, right.id)
      );
      const reasonCodes = uniqueSorted(items.map(({ reasonCode }) => reasonCode));
      const resolutionPath = items.map(({ resolutionPath }) => resolutionPath)
        .sort((left, right) => compareUtf8(left.join("\u0000"), right.join("\u0000")))[0]!;
      return DecisionCriticalEvidenceRefSchema.parse({
        evidencePackItemId: first.evidencePackItemId,
        classification: first.classification,
        originRefs,
        reasonCodes,
        resolutionPath,
      });
    });
}

function unresolved(origin: DecisionCriticalOriginRef, id: string): never {
  throw new Error(
    `${origin.kind} ${origin.id} origin ${id} cannot resolve to a candidate-local Evidence Pack item.`,
  );
}

function uniqueMap<T>(
  items: readonly T[],
  identity: (item: T) => string,
  label: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    const id = identity(item);
    if (result.has(id)) throw new Error(`${label} IDs must be unique.`);
    result.set(id, item);
  }
  return result;
}

function uniqueSorted(items: readonly string[]): string[] {
  return [...new Set(items)].sort(compareUtf8);
}

function uniqueBy<T>(items: readonly T[], identity: (item: T) => string): T[] {
  const result = new Map<string, T>();
  for (const item of items) result.set(identity(item), item);
  return [...result.values()];
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}
