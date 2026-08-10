import type { CompanyAnalysis } from "../../contracts/domain";
import type {
  Calculation,
  ClaimEdge,
  EvidencePack,
} from "../../contracts/evidence";
import {
  DecisionCriticalEvidenceRefSchema,
  type DecisionCriticalEvidenceRef,
  type DecisionCriticalOriginRef,
} from "../../contracts/named-lens";
import type {
  DecisionResult,
  FrameworkJudgment,
  FundPolicySnapshot,
  ResolvedUnderwritingContext,
  ValuationEvaluation,
} from "../../contracts/underwriting";
import { compareUtf8 } from "../../format/canonical-order";
import type { CandidateGroundingSnapshot } from "../candidate-grounding";
import { isFormalDecisionJudgment } from "../decision/engine";
import { DECISION_POLICY_V1 } from "../decision/rules";

interface ProjectionContribution {
  evidencePackItemId: string;
  classification: "fact" | "assumption";
  originRefs: DecisionCriticalOriginRef[];
  reasonCode: string;
  resolutionPath: string[];
}

export interface DecisionCriticalAuthorityBindings {
  valuation: ValuationEvaluation;
  fundPolicy: FundPolicySnapshot;
  context: ResolvedUnderwritingContext;
  decisionPolicyId: string;
}

export class DecisionCriticalEvidenceResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionCriticalEvidenceResolutionError";
  }
}

export function buildDecisionCriticalEvidenceProjection(input: {
  analysis: CompanyAnalysis;
  pack: EvidencePack;
  grounding: CandidateGroundingSnapshot;
  calculations: Calculation[];
  calculationClaimEdges?: ClaimEdge[];
  decision: DecisionResult;
  judgments: FrameworkJudgment[];
  authorityBindings?: DecisionCriticalAuthorityBindings;
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
  const calculationClaimEdges = input.calculationClaimEdges ?? [];
  const calculationEdgesByClaimId = new Map<string, ClaimEdge[]>();
  const calculationEdgeKeys = new Set<string>();
  for (const edge of calculationClaimEdges) {
    const key = [
      edge.claimItemId,
      edge.dependencyType,
      edge.dependencyItemId,
    ].join("\u0000");
    if (calculationEdgeKeys.has(key)) {
      throw new DecisionCriticalEvidenceResolutionError(
        "Calculation claim edges must be unique.",
      );
    }
    calculationEdgeKeys.add(key);
    if (!calculationsById.has(edge.claimItemId)) {
      throw new DecisionCriticalEvidenceResolutionError(
        `Calculation claim edge ${edge.claimItemId} does not belong to the candidate-local calculation set.`,
      );
    }
    const edges = calculationEdgesByClaimId.get(edge.claimItemId) ?? [];
    edges.push(edge);
    calculationEdgesByClaimId.set(edge.claimItemId, edges);
  }
  const formalJudgmentsById = uniqueMap(
    input.judgments.filter(isFormalDecisionJudgment),
    ({ id }) => id,
    "Formal FrameworkJudgment",
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
    const exactCalculation = calculationsById.get(options.itemId);
    if (exactCalculation) {
      resolveCalculation(exactCalculation, options);
      return;
    }
    const exactJudgment = formalJudgmentsById.get(options.itemId);
    if (exactJudgment) {
      resolveJudgment(exactJudgment, options);
      return;
    }
    if (options.itemId.startsWith("framework_judgment:")) {
      const judgment = formalJudgmentsById.get(options.itemId.slice(
        "framework_judgment:".length,
      ));
      if (!judgment) unresolved(options.origin, options.itemId);
      resolveJudgment(judgment, options);
      return;
    }
    const typed = parseTypedDecisionRef(options.itemId);
    if (typed) {
      if (typed.kind === "fact") {
        if (!factById.has(typed.id)) unresolved(options.origin, options.itemId);
        addPackItem({
          ...options,
          itemId: typed.id,
          path: [...options.path, options.itemId],
          additionalOriginRefs: options.calculationOriginRefs,
        });
        return;
      }
      if (typed.kind === "assumption") {
        if (!assumptionById.has(typed.id)) {
          unresolved(options.origin, options.itemId);
        }
        addPackItem({
          ...options,
          itemId: typed.id,
          path: [...options.path, options.itemId],
          additionalOriginRefs: options.calculationOriginRefs,
        });
        return;
      }
      if (typed.kind === "calculation") {
        const calculation = calculationsById.get(typed.id);
        if (!calculation) unresolved(options.origin, options.itemId);
        resolveCalculation(calculation, {
          ...options,
          path: [...options.path, options.itemId],
        });
        return;
      }
      if (isValidatedAuthorityRef({
        typed,
        input,
      })) return;
      unresolved(options.origin, options.itemId);
    }
    unresolved(options.origin, options.itemId);
  };

  const resolveJudgment = (
    judgment: FrameworkJudgment,
    options: Parameters<typeof resolveDecisionRef>[0],
  ): void => {
      const evidenceItemIds = judgment
        ? uniqueSorted([
            ...judgment.supportEvidenceItemIds,
            ...judgment.counterEvidenceItemIds,
          ])
        : [];
      if (evidenceItemIds.length === 0) {
        unresolved(options.origin, options.itemId);
      }
      for (const evidenceItemId of evidenceItemIds) {
        const expectedDependencyType = factById.has(evidenceItemId)
          ? "fact"
          : assumptionById.has(evidenceItemId)
            ? "assumption"
            : calculationsById.has(evidenceItemId)
              ? "calculation"
              : null;
        const exactEdges = judgment.claimEdges.filter((edge) =>
          edge.claimItemId === judgment.id
          && edge.dependencyItemId === evidenceItemId
          && edge.dependencyType === expectedDependencyType
        );
        if (expectedDependencyType === null || exactEdges.length !== 1) {
          unresolved(options.origin, options.itemId);
        }
        resolveDecisionRef({
          ...options,
          itemId: evidenceItemId,
          path: [...options.path, options.itemId],
        });
      }
  };

  const resolveCalculation = (
    calculation: Calculation,
    options: Parameters<typeof resolveDecisionRef>[0],
  ): void => {
    if (calculation.status !== "completed") {
      unresolved(options.origin, calculation.id);
    }
    if (options.activeCalculationIds.has(calculation.id)) {
      throw new DecisionCriticalEvidenceResolutionError(
        `Decision-critical Calculation lineage cycle at ${calculation.id}.`,
      );
    }
    const activeCalculationIds = new Set(options.activeCalculationIds);
    activeCalculationIds.add(calculation.id);
    let validatedDependencies = 0;
    for (const reference of calculation.inputRefs) {
      if (reference.type === "policy") {
        if (!isValidCalculationPolicyRef(
          reference.itemId,
          input.authorityBindings?.fundPolicy,
        )) {
          unresolved(options.origin, reference.itemId);
        }
        validatedDependencies += 1;
        continue;
      }
      const expectedType = factById.has(reference.itemId)
        ? "fact"
        : assumptionById.has(reference.itemId)
          ? reference.type === "benchmark" ? "benchmark" : "assumption"
          : null;
      if (expectedType === null || reference.type !== expectedType) {
        unresolved(options.origin, reference.itemId);
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
      validatedDependencies += 1;
    }
    for (const edge of calculationEdgesByClaimId.get(calculation.id) ?? []) {
      const expectedType = factById.has(edge.dependencyItemId)
        ? "fact"
        : assumptionById.has(edge.dependencyItemId)
          ? "assumption"
          : calculationsById.has(edge.dependencyItemId)
            ? "calculation"
            : null;
      if (expectedType === null || edge.dependencyType !== expectedType) {
        unresolved(options.origin, edge.dependencyItemId);
      }
      resolveDecisionRef({
        itemId: edge.dependencyItemId,
        origin: options.origin,
        reasonCode: options.reasonCode,
        path: [...options.path, calculation.id],
        activeCalculationIds,
        calculationOriginRefs: [
          ...options.calculationOriginRefs,
          { kind: "calculation", id: calculation.id },
        ],
      });
      validatedDependencies += 1;
    }
    if (validatedDependencies === 0) {
      unresolved(options.origin, calculation.id);
    }
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

interface TypedDecisionRef {
  kind: string;
  id: string;
}

function parseTypedDecisionRef(value: string): TypedDecisionRef | null {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) return null;
  return {
    kind: value.slice(0, separator),
    id: value.slice(separator + 1),
  };
}

function isValidatedAuthorityRef(input: {
  typed: TypedDecisionRef;
  input: {
    pack: EvidencePack;
    decision: DecisionResult;
    authorityBindings?: DecisionCriticalAuthorityBindings;
  };
}): boolean {
  const { typed } = input;
  if (typed.kind === "evidence_pack") {
    return typed.id === input.input.pack.id;
  }
  if (typed.kind === "field") {
    return input.input.pack.coverage.missingFieldIds.includes(typed.id);
  }
  if (typed.kind === "evidence_conflict") {
    return input.input.pack.coverage.blockingConflictIds.includes(typed.id)
      && input.input.pack.conflicts.some(({ id }) => id === typed.id);
  }
  const bindings = input.input.authorityBindings;
  if (!bindings) return false;
  switch (typed.kind) {
    case "valuation":
      return typed.id === bindings.valuation.id;
    case "blocker_code":
      return bindings.valuation.blockerCodes.includes(typed.id);
    case "underwriting_context":
      return typed.id === bindings.context.id;
    case "benchmark_ref":
      return bindings.context.benchmarkPackId !== null
        && typed.id === bindings.context.benchmarkPackId;
    case "policy_ref":
      if (!typed.id.startsWith(`${bindings.fundPolicy.id}#`)) return false;
      return hasFundPolicyPath(
        bindings.fundPolicy,
        typed.id.slice(bindings.fundPolicy.id.length + 1),
      ) || new Set([
        "mandates",
        DECISION_POLICY_V1.explicitHardVetoPolicyKey,
      ]).has(typed.id.slice(bindings.fundPolicy.id.length + 1));
    case "decision_policy":
      return typed.id === bindings.decisionPolicyId;
    case "decision_dimension":
      return [
        `company_quality=${input.input.decision.companyQuality}`,
        `price_attractiveness=${input.input.decision.priceAttractiveness}`,
        `fund_fit=${input.input.decision.fundFit}`,
      ].includes(typed.id);
    default:
      return false;
  }
}

function isValidCalculationPolicyRef(
  itemId: string,
  policy: FundPolicySnapshot | undefined,
): boolean {
  return policy !== undefined
    && itemId.startsWith("policy:")
    && hasFundPolicyPath(policy, itemId.slice("policy:".length));
}

function hasFundPolicyPath(
  policy: FundPolicySnapshot,
  path: string,
): boolean {
  const segments = path.split(".");
  if (segments.length === 0 || segments.some((segment) => segment.length === 0)) {
    return false;
  }
  let cursor: unknown = policy.values;
  for (const segment of segments) {
    if (
      typeof cursor !== "object"
      || cursor === null
      || !Object.prototype.hasOwnProperty.call(cursor, segment)
    ) return false;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor !== undefined;
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
    throw new DecisionCriticalEvidenceResolutionError("XTrace memory lineage cannot resolve exactly to the CompanyAnalysis memory set.");
  }
  if (lineage.memoryIds.length === 0) {
    if (
      lineage.sourceRevisionIds.length > 0
      || lineage.sourceIds.length > 0
      || lineage.fixtureIds.length > 0
    ) {
      throw new DecisionCriticalEvidenceResolutionError("XTrace lineage without a memory cannot resolve exactly.");
    }
    return;
  }
  if (lineage.memoryIds.length !== 1) {
    throw new DecisionCriticalEvidenceResolutionError(
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
    throw new DecisionCriticalEvidenceResolutionError("XTrace memory source identities cannot resolve exactly to source revisions.");
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
    throw new DecisionCriticalEvidenceResolutionError("Decision-critical evidence must remain candidate-local to one Deal.");
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
    throw new DecisionCriticalEvidenceResolutionError(
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
        throw new DecisionCriticalEvidenceResolutionError("Decision-critical Evidence Pack classification is ambiguous.");
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
  throw new DecisionCriticalEvidenceResolutionError(
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
    if (result.has(id)) {
      throw new DecisionCriticalEvidenceResolutionError(
        `${label} IDs must be unique.`,
      );
    }
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
