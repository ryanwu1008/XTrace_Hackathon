import { createHash } from "node:crypto";

import {
  DecisionCriticalEvidenceRefSchema,
  GroundedNamedLensPassageCandidateSchema,
  NAMED_LENS_SELECTION_POLICY_VERSION,
  NamedLensDispositionSchema,
  NamedLensPassageSchema,
  type DecisionCriticalEvidenceRef,
  type GroundedNamedLensPassageCandidate,
  type NamedLensDisposition,
  type NamedLensPassage,
  type NamedLensPresentation,
} from "../../contracts/named-lens";
import type { FrameworkJudgment } from "../../contracts/underwriting";
import { compareUtf8 } from "../../format/canonical-order";
import type {
  DecisionQuestionCode,
  DecisionTaxonomyBinding,
  EvidenceDomainCode,
} from "./decision-taxonomy";
import {
  NamedLensPassageValidationResultSchema,
  type NamedLensPassageValidationResult,
} from "./passage-grounding";

export type { NamedLensPassageValidationResult } from "./passage-grounding";

export interface NamedLensProvisionalPriority {
  judgmentId: string;
  frameworkCardId: string;
  frameworkVersion: string;
  packId: string;
  componentFrameworkId: string;
  componentVersion: string;
  cardFieldRef: string;
  questionText: string;
  decisionQuestionCode: DecisionQuestionCode;
  evidenceDomainCodes: EvidenceDomainCode[];
  stance: "supportive" | "mixed" | "negative";
  priorityTier:
    | "principal_disagreement"
    | "changed_belief"
    | "decision_or_valuation"
    | "distinct_material"
    | "context_only";
  priorityPosition: number;
  reasonCodes: string[];
  selectionBasisEvidenceIds: string[];
  criticalEvidence: DecisionCriticalEvidenceRef[];
  evidenceCoverage: "high" | "medium" | "low";
}

export interface NamedLensCatalogCandidate {
  workspaceId: string;
  artifactSourceCandidateRunId: string;
  judgmentOrCatalogCandidateId: string;
  judgmentId: string | null;
  frameworkCardId: string;
  frameworkVersion: string;
  initialDisposition:
    | "judgment_eligible"
    | "context_inapplicable"
    | "ineligible"
    | "abstained"
    | "unavailable";
  reasonCodes: string[];
}

interface PriorityWorkingRecord extends Omit<
  NamedLensProvisionalPriority,
  "priorityTier" | "priorityPosition" | "reasonCodes"
> {
  priorityTier: NamedLensProvisionalPriority["priorityTier"];
  reasonCodes: string[];
  suppliesOpposingStance: boolean;
}

const COVERAGE_ORDINAL = { low: 1, medium: 2, high: 3 } as const;
const TIER_ORDINAL = {
  principal_disagreement: 1,
  changed_belief: 2,
  decision_or_valuation: 3,
  distinct_material: 4,
  context_only: 5,
} as const;
const CHANGED_BELIEF_ORIGINS = new Set([
  "market_event",
  "source_revision",
  "xtrace_memory",
  "prior_record",
  "chronology_gate",
  "revisit_gate",
  "counterevidence_gate",
  "action_delta_gate",
]);
const DECISION_OR_VALUATION_ORIGINS = new Set([
  "fired_rule",
  "blocking_evidence",
  "scenario_input",
  "calculation",
  "valuation_evaluation",
  "return_calculation",
]);

export function prioritizeNamedLensJudgments(input: {
  judgments: FrameworkJudgment[];
  criticalEvidence: DecisionCriticalEvidenceRef[];
  taxonomyByFrameworkId:
    | ReadonlyMap<string, DecisionTaxonomyBinding>
    | Readonly<Record<string, DecisionTaxonomyBinding>>;
}): NamedLensProvisionalPriority[] {
  const criticalEvidence = canonicalCriticalEvidence(input.criticalEvidence);
  const criticalById = new Map(
    criticalEvidence.map((item) => [item.evidencePackItemId, item]),
  );
  const judgments = uniqueMap(input.judgments, ({ id }) => id, "judgment");
  const working: PriorityWorkingRecord[] = [];

  for (const judgment of judgments.values()) {
    if (
      judgment.applicability !== "applicable"
      || judgment.conclusion === "abstain"
    ) {
      continue;
    }
    const binding = taxonomyBindingFor(
      input.taxonomyByFrameworkId,
      judgment.frameworkCardId,
    );
    const authorizedBinding = binding
      ? exactAuthorizedJudgmentBinding(judgment, binding)
      : null;
    if (!binding || !authorizedBinding) {
      continue;
    }
    assertGroundedJudgment(judgment);
    const usedIds = uniqueSorted([
      ...judgment.supportEvidenceItemIds,
      ...judgment.counterEvidenceItemIds,
    ]);
    const selectionBasisEvidenceIds = usedIds.filter((id) =>
      criticalById.has(id)
    );
    const selectedCritical = selectionBasisEvidenceIds.map((id) =>
      criticalById.get(id)!
    );
    const changedBelief = selectedCritical.some((item) =>
      item.originRefs.some(({ kind }) => CHANGED_BELIEF_ORIGINS.has(kind))
    );
    const decisionOrValuation = selectedCritical.some((item) =>
      item.originRefs.some(({ kind }) =>
        DECISION_OR_VALUATION_ORIGINS.has(kind)
      )
    );
    const priorityTier = selectionBasisEvidenceIds.length === 0
      ? "context_only"
      : changedBelief
      ? "changed_belief"
      : decisionOrValuation
      ? "decision_or_valuation"
      : "distinct_material";
    working.push({
      judgmentId: judgment.id,
      frameworkCardId: judgment.frameworkCardId,
      frameworkVersion: judgment.frameworkVersion,
      packId: judgment.frameworkMetadata?.packId ?? judgment.frameworkCardId,
      componentFrameworkId: binding.frameworkId,
      componentVersion: authorizedBinding.componentVersion,
      cardFieldRef: binding.cardFieldRef,
      questionText: binding.questionText,
      decisionQuestionCode: binding.decisionQuestionCode,
      evidenceDomainCodes: uniqueSorted(
        binding.evidenceDomainCodes,
      ) as EvidenceDomainCode[],
      stance: judgment.conclusion,
      priorityTier,
      reasonCodes: [reasonCodeForTier(priorityTier)],
      selectionBasisEvidenceIds,
      criticalEvidence: selectedCritical,
      evidenceCoverage: judgment.confidence.evidenceCoverage,
      suppliesOpposingStance: false,
    });
  }

  for (const record of working) {
    record.suppliesOpposingStance = (
      record.stance === "supportive" || record.stance === "negative"
    ) && working.some((other) =>
      other.decisionQuestionCode === record.decisionQuestionCode
      && opposing(record.stance, other.stance)
    );
  }

  const principalPair = selectPrincipalPair(working);
  const principalIds = new Set(
    principalPair?.map(({ judgmentId }) => judgmentId) ?? [],
  );
  for (const record of working) {
    if (principalIds.has(record.judgmentId)) {
      record.priorityTier = "principal_disagreement";
      record.reasonCodes = ["PRINCIPAL_DISAGREEMENT"];
    }
  }

  const ordered = [...working].sort(comparePriorityRecords);
  return ordered.map((record, index) => ({
    judgmentId: record.judgmentId,
    frameworkCardId: record.frameworkCardId,
    frameworkVersion: record.frameworkVersion,
    packId: record.packId,
    componentFrameworkId: record.componentFrameworkId,
    componentVersion: record.componentVersion,
    cardFieldRef: record.cardFieldRef,
    questionText: record.questionText,
    decisionQuestionCode: record.decisionQuestionCode,
    evidenceDomainCodes: record.evidenceDomainCodes,
    stance: record.stance,
    priorityTier: record.priorityTier,
    priorityPosition: index + 1,
    reasonCodes: uniqueSorted(record.reasonCodes),
    selectionBasisEvidenceIds: record.selectionBasisEvidenceIds,
    criticalEvidence: record.criticalEvidence,
    evidenceCoverage: record.evidenceCoverage,
  }));
}

export function finalizeNamedLensPlacement(input: {
  catalogCandidates: NamedLensCatalogCandidate[];
  provisionalPriority: NamedLensProvisionalPriority[];
  passageResults: NamedLensPassageValidationResult[];
  criticalEvidence: DecisionCriticalEvidenceRef[];
}): { dispositions: NamedLensDisposition[]; passages: NamedLensPassage[] } {
  const criticalEvidence = canonicalCriticalEvidence(input.criticalEvidence);
  const criticalIds = new Set(
    criticalEvidence.map(({ evidencePackItemId }) => evidencePackItemId),
  );
  const candidates = uniqueMap(
    input.catalogCandidates,
    ({ judgmentOrCatalogCandidateId }) => judgmentOrCatalogCandidateId,
    "catalog candidate",
  );
  assertSingleCandidateScope([...candidates.values()]);
  const priorities = [...input.provisionalPriority]
    .sort((left, right) =>
      left.priorityPosition - right.priorityPosition
      || compareStablePriorityIdentity(left, right)
    );
  if (priorities.some((priority, index) =>
    priority.priorityPosition !== index + 1
  )) {
    throw new Error("Named Lens provisional priority positions must be unique and contiguous.");
  }
  const priorityByCandidateId = new Map<string, NamedLensProvisionalPriority>();
  for (const priority of priorities) {
    const candidate = [...candidates.values()].find((item) =>
      item.judgmentId === priority.judgmentId
    );
    if (
      !candidate
      || candidate.frameworkCardId !== priority.frameworkCardId
      || candidate.frameworkVersion !== priority.frameworkVersion
      || candidate.initialDisposition !== "judgment_eligible"
    ) {
      throw new Error(
        `Provisional judgment ${priority.judgmentId} does not resolve to one eligible catalog candidate.`,
      );
    }
    if (priorityByCandidateId.has(candidate.judgmentOrCatalogCandidateId)) {
      throw new Error("A catalog candidate cannot have multiple provisional priorities.");
    }
    priorityByCandidateId.set(candidate.judgmentOrCatalogCandidateId, priority);
  }
  const results = uniqueMap(
    input.passageResults.map((result) =>
      NamedLensPassageValidationResultSchema.parse(result)
    ),
    ({ judgmentOrCatalogCandidateId }) => judgmentOrCatalogCandidateId,
    "passage validation result",
  );
  for (const candidateId of results.keys()) {
    const candidate = candidates.get(candidateId);
    const result = results.get(candidateId)!;
    if (
      !candidate
      || candidate.initialDisposition !== "judgment_eligible"
      || (result.status === "validated"
        && !priorityByCandidateId.has(candidateId))
    ) {
      throw new Error(`Passage validation result ${candidateId} is foreign to the eligible catalog.`);
    }
  }
  for (const candidate of candidates.values()) {
    if (
      candidate.initialDisposition === "judgment_eligible"
      && !results.has(candidate.judgmentOrCatalogCandidateId)
    ) {
      throw new Error(`Every eligible Named Lens candidate requires a passage validation result: ${candidate.judgmentOrCatalogCandidateId}.`);
    }
  }

  const finalized = new Map<string, FinalizedCandidate>();
  const representatives: Array<{
    signature: string;
    proseFingerprint: string;
  }> = [];
  const selected: FinalizedCandidate[] = [];
  for (const [candidateId, result] of results) {
    if (priorityByCandidateId.has(candidateId)) continue;
    if (result.status === "validated") {
      throw new Error(
        `Validated passage ${candidateId} requires one exact provisional priority.`,
      );
    }
    finalized.set(candidateId, {
      candidate: candidates.get(candidateId)!,
      priority: null,
      disposition: result.status,
      reasonCodes: [result.reasonCode.toUpperCase()],
      passage: null,
      selectedPosition: null,
    });
  }
  for (const priority of priorities) {
    const candidate = [...candidates.values()].find(({ judgmentId }) =>
      judgmentId === priority.judgmentId
    )!;
    const candidateId = candidate.judgmentOrCatalogCandidateId;
    const result = results.get(candidateId)!;
    if (result.status !== "validated") {
      finalized.set(candidateId, {
        candidate,
        priority,
        disposition: result.status,
        reasonCodes: [result.reasonCode.toUpperCase()],
        passage: null,
        selectedPosition: null,
      });
      continue;
    }
    const validatedPassage = validatePassageForPriority({
      groundedCandidate: result.groundedCandidate,
      candidate,
      priority,
      criticalIds,
    });
    const signature = duplicateSignature(validatedPassage);
    const proseFingerprint = normalizedProseFingerprint(validatedPassage);
    const duplicate = representatives.some((representative) =>
      representative.signature === signature
      || representative.proseFingerprint === proseFingerprint
    );
    if (duplicate) {
      finalized.set(candidateId, {
        candidate,
        priority,
        disposition: "appendix_only",
        reasonCodes: ["DUPLICATE_DECISION_RATIONALE"],
        passage: validatedPassage,
        selectedPosition: null,
      });
      continue;
    }
    representatives.push({ signature, proseFingerprint });
    const canSelect = priority.priorityTier !== "context_only"
      && (
        selected.length < 4
        || (selected.length < 6 && addsRequiredDiversity(
          validatedPassage,
          selected.map(({ passage }) => passage!),
        ))
      );
    const record: FinalizedCandidate = {
      candidate,
      priority,
      disposition: canSelect ? "selected_main" : "appendix_only",
      reasonCodes: canSelect
        ? priority.reasonCodes
        : priority.priorityTier === "context_only"
        ? ["CONTEXT_ONLY"]
        : ["MAIN_PLACEMENT_CAP_OR_DIVERSITY_RULE"],
      passage: validatedPassage,
      selectedPosition: canSelect ? selected.length + 1 : null,
    };
    finalized.set(candidateId, record);
    if (canSelect) selected.push(record);
  }

  for (const candidate of candidates.values()) {
    if (finalized.has(candidate.judgmentOrCatalogCandidateId)) continue;
    const disposition = candidate.initialDisposition === "judgment_eligible"
      ? "unavailable"
      : candidate.initialDisposition;
    finalized.set(candidate.judgmentOrCatalogCandidateId, {
      candidate,
      priority: null,
      disposition,
      reasonCodes: candidate.reasonCodes.length > 0
        ? candidate.reasonCodes
        : [disposition.toUpperCase()],
      passage: null,
      selectedPosition: null,
    });
  }

  const finalizedRecords = [...finalized.values()].sort((left, right) => {
    const leftPosition = left.selectedPosition ?? Number.MAX_SAFE_INTEGER;
    const rightPosition = right.selectedPosition ?? Number.MAX_SAFE_INTEGER;
    return leftPosition - rightPosition
      || compareUtf8(
        left.candidate.judgmentOrCatalogCandidateId,
        right.candidate.judgmentOrCatalogCandidateId,
      );
  });
  const dispositions = finalizedRecords.map((record) =>
    buildDisposition(record, criticalEvidence)
  );
  const passages = finalizedRecords.flatMap(({ passage }) =>
    passage ? [passage] : []
  );
  return { dispositions, passages };
}

export function buildNamedLensSynthesis(input: {
  passages: NamedLensPassage[];
  dispositions: NamedLensDisposition[];
}): NamedLensPresentation["synthesis"] {
  const passages = input.passages.map((passage) =>
    NamedLensPassageSchema.parse(passage)
  );
  const dispositions = input.dispositions.map((disposition) =>
    NamedLensDispositionSchema.parse(disposition)
  );
  const ordered = selectedSynthesisPassages({ passages, dispositions });
  for (const passage of passages) {
    const exactWordCount = passageSegmentWordCount(passage);
    if (passage.wordCount !== exactWordCount) {
      throw new Error(
        `Named Lens persisted passage word count must exactly equal its five segments: ${passage.judgmentId}.`,
      );
    }
  }
  const evidenceItemIds = uniqueSorted(
    ordered.flatMap(({ selectionBasisEvidenceIds }) =>
      selectionBasisEvidenceIds
    ),
  );
  const judgmentIds = uniqueSorted(ordered.map(({ judgmentId }) => judgmentId));
  let branch: NamedLensPresentation["synthesis"]["branch"];
  let text: string;
  if (ordered.length === 0) {
    branch = "zero_available";
    text = "No source-grounded framework reading is available.";
  } else if (ordered.length === 1) {
    branch = "single_perspective";
    text = `One advisory perspective is available. ${ordered[0]!.conditionalConclusion.text}`;
  } else {
    const pair = principalPassagePair(ordered);
    const stances = new Set(ordered.map(({ conditionalConclusion }) =>
      conditionalConclusion.stance
    ));
    if (pair) {
      branch = "principal_disagreement";
      text = [
        "The persisted conditional conclusions establish a principal disagreement.",
        pair[0].conditionalConclusion.text,
        pair[1].conditionalConclusion.text,
        evidenceItemIds.length > 0
          ? `Deciding evidence IDs: ${evidenceItemIds.join(", ")}.`
          : "The persisted passages identify no deciding evidence ID.",
      ].join(" ");
    } else if (stances.size === 1) {
      branch = "bounded_alignment";
      text = [
        "The persisted conditional conclusions show bounded alignment without a principal disagreement.",
        ordered[0]!.conditionalConclusion.text,
        ordered[1]!.conditionalConclusion.text,
      ].join(" ");
    } else {
      branch = "different_emphasis";
      text = [
        "The persisted conditional conclusions place different emphasis without a principal disagreement.",
        ordered[0]!.conditionalConclusion.text,
        ordered[1]!.conditionalConclusion.text,
      ].join(" ");
    }
  }
  const totalWords = ordered.reduce((total, passage) =>
    total + passageSegmentWordCount(passage), 0
  ) + englishWordCount(text);
  if (totalWords > 1_600) {
    throw new Error(
      `Named Lens selected passages and synthesis exceed the 1,600-word budget (${totalWords}).`,
    );
  }
  return { branch, text, judgmentIds, evidenceItemIds };
}

function selectedSynthesisPassages(input: {
  passages: readonly NamedLensPassage[];
  dispositions: readonly NamedLensDisposition[];
}): NamedLensPassage[] {
  const passageByJudgmentId = uniqueMap(
    input.passages,
    ({ judgmentId }) => judgmentId,
    "synthesis passage membership",
  );
  const dispositionByCandidateId = uniqueMap(
    input.dispositions,
    ({ judgmentOrCatalogCandidateId }) => judgmentOrCatalogCandidateId,
    "synthesis disposition membership",
  );
  const publishable = [...dispositionByCandidateId.values()].filter(
    ({ disposition }) =>
      disposition === "selected_main" || disposition === "appendix_only",
  );
  const dispositionByJudgmentId = new Map<string, NamedLensDisposition>();
  for (const disposition of publishable) {
    if (
      disposition.judgmentId === null
      || dispositionByJudgmentId.has(disposition.judgmentId)
    ) {
      throw new Error(
        "Named Lens synthesis disposition-passage membership has a duplicate or missing judgment identity.",
      );
    }
    dispositionByJudgmentId.set(disposition.judgmentId, disposition);
  }
  for (const passage of input.passages) {
    const disposition = dispositionByJudgmentId.get(passage.judgmentId);
    if (!disposition) {
      throw new Error(
        `Named Lens synthesis has an extra passage outside publishable disposition membership: ${passage.judgmentId}.`,
      );
    }
    if (!passageMatchesDisposition(passage, disposition)) {
      throw new Error(
        `Named Lens synthesis disposition-passage membership mismatch: ${passage.judgmentId}.`,
      );
    }
  }
  for (const [judgmentId] of dispositionByJudgmentId) {
    if (!passageByJudgmentId.has(judgmentId)) {
      throw new Error(
        `Named Lens synthesis is missing a publishable disposition passage: ${judgmentId}.`,
      );
    }
  }
  const selected = publishable
    .filter(({ disposition }) => disposition === "selected_main")
    .sort((left, right) =>
      left.selectedPosition! - right.selectedPosition!
      || compareUtf8(left.judgmentId!, right.judgmentId!)
    );
  if (selected.some((disposition, index) =>
    disposition.selectedPosition !== index + 1
  )) {
    throw new Error(
      "Named Lens synthesis selected_main membership positions must be unique and contiguous.",
    );
  }
  return selected.map((disposition) =>
    passageByJudgmentId.get(disposition.judgmentId!)!
  );
}

function passageMatchesDisposition(
  passage: NamedLensPassage,
  disposition: NamedLensDisposition,
): boolean {
  return disposition.workspaceId === passage.workspaceId
    && disposition.artifactSourceCandidateRunId
      === passage.artifactSourceCandidateRunId
    && disposition.judgmentId === passage.judgmentId
    && disposition.frameworkCardId === passage.frameworkCardId
    && disposition.frameworkVersion === passage.frameworkVersion
    && disposition.decisionQuestionCode === passage.decisionQuestionCode
    && disposition.stance === passage.conditionalConclusion.stance
    && disposition.advisoryPosture
      === passage.conditionalConclusion.advisoryPosture
    && sameStrings(
      disposition.selectionBasisEvidenceIds,
      passage.selectionBasisEvidenceIds,
    )
    && disposition.passageFingerprint === passage.fingerprint;
}

function passageSegmentWordCount(passage: NamedLensPassage): number {
  return [
    passage.premise.text,
    passage.caseApplication.text,
    passage.countercase.text,
    passage.unknownBoundary.text,
    passage.conditionalConclusion.text,
  ].reduce((total, text) => total + englishWordCount(text), 0);
}

interface FinalizedCandidate {
  candidate: NamedLensCatalogCandidate;
  priority: NamedLensProvisionalPriority | null;
  disposition: NamedLensDisposition["disposition"];
  reasonCodes: string[];
  passage: NamedLensPassage | null;
  selectedPosition: number | null;
}

function buildDisposition(
  record: FinalizedCandidate,
  criticalEvidence: DecisionCriticalEvidenceRef[],
): NamedLensDisposition {
  const passage = record.passage;
  const priority = record.priority;
  const value = {
    workspaceId: record.candidate.workspaceId,
    artifactSourceCandidateRunId:
      record.candidate.artifactSourceCandidateRunId,
    judgmentOrCatalogCandidateId:
      record.candidate.judgmentOrCatalogCandidateId,
    judgmentId: record.candidate.judgmentId,
    frameworkCardId: record.candidate.frameworkCardId,
    frameworkVersion: record.candidate.frameworkVersion,
    disposition: record.disposition,
    selectedPosition: record.selectedPosition,
    priorityTier: priority?.priorityTier ?? null,
    reasonCodes: uniqueSorted(record.reasonCodes),
    decisionQuestionCode: priority?.decisionQuestionCode ?? null,
    stance: priority?.stance ?? null,
    advisoryPosture: passage?.conditionalConclusion.advisoryPosture ?? null,
    selectionBasisEvidenceIds:
      passage?.selectionBasisEvidenceIds
      ?? priority?.selectionBasisEvidenceIds
      ?? [],
    criticalEvidence,
    selectionPolicyVersion: NAMED_LENS_SELECTION_POLICY_VERSION,
    passageFingerprint: passage?.fingerprint ?? null,
  };
  return NamedLensDispositionSchema.parse({
    ...value,
    fingerprint: sha256(value),
  });
}

function validatePassageForPriority(input: {
  groundedCandidate: GroundedNamedLensPassageCandidate;
  candidate: NamedLensCatalogCandidate;
  priority: NamedLensProvisionalPriority;
  criticalIds: ReadonlySet<string>;
}): NamedLensPassage {
  const grounded = GroundedNamedLensPassageCandidateSchema.parse(
    input.groundedCandidate,
  );
  if (
    grounded.workspaceId !== input.candidate.workspaceId
    || grounded.artifactSourceCandidateRunId
      !== input.candidate.artifactSourceCandidateRunId
    || grounded.judgmentId !== input.priority.judgmentId
    || grounded.judgmentId !== input.candidate.judgmentId
    || grounded.frameworkCardId !== input.priority.frameworkCardId
    || grounded.frameworkCardId !== input.candidate.frameworkCardId
    || grounded.frameworkVersion !== input.priority.frameworkVersion
    || grounded.frameworkVersion !== input.candidate.frameworkVersion
    || grounded.focus.componentFrameworkId
      !== input.priority.componentFrameworkId
    || grounded.focus.componentVersion !== input.priority.componentVersion
    || grounded.focus.cardFieldRef !== input.priority.cardFieldRef
    || grounded.focus.questionText !== input.priority.questionText
    || grounded.focus.decisionQuestionCode
      !== input.priority.decisionQuestionCode
    || !sameStrings(
      grounded.focus.evidenceDomainCodes,
      input.priority.evidenceDomainCodes,
    )
    || grounded.conditionalConclusion.stance !== input.priority.stance
  ) {
    throw new Error("Validated Named Lens passage identity or taxonomy is foreign to its provisional judgment.");
  }
  const representedEvidenceIds = new Set([
    ...grounded.caseApplication.evidenceItemIds,
    ...grounded.countercase.evidenceItemIds,
  ]);
  if (
    input.priority.selectionBasisEvidenceIds.some((id) =>
      !input.criticalIds.has(id) || !representedEvidenceIds.has(id)
    )
  ) {
    throw new Error(
      "Deterministic selection-basis evidence must be candidate-local, decision-critical, and represented by the grounded passage boundary.",
    );
  }
  const persisted = {
    schemaVersion: grounded.schemaVersion,
    workspaceId: grounded.workspaceId,
    artifactSourceCandidateRunId: grounded.artifactSourceCandidateRunId,
    judgmentId: grounded.judgmentId,
    frameworkCardId: grounded.frameworkCardId,
    frameworkVersion: grounded.frameworkVersion,
    decisionQuestionCode: grounded.focus.decisionQuestionCode,
    evidenceDomainCodes: grounded.focus.evidenceDomainCodes,
    premise: grounded.premise,
    caseApplication: grounded.caseApplication,
    countercase: grounded.countercase,
    unknownBoundary: grounded.unknownBoundary,
    conditionalConclusion: grounded.conditionalConclusion,
    advisoryContract: grounded.advisoryContract,
    selectionBasisEvidenceIds: input.priority.selectionBasisEvidenceIds,
    wordCount: grounded.wordCount,
    generatorVersion: grounded.generatorVersion,
  };
  return NamedLensPassageSchema.parse({
    ...persisted,
    fingerprint: sha256({
      kind: "named-lens-passage-materialization-v1",
      groundedCandidateFingerprint: grounded.groundingFingerprint,
      ...persisted,
    }),
  });
}

function assertGroundedJudgment(judgment: FrameworkJudgment): void {
  const usedIds = uniqueSorted([
    ...judgment.supportEvidenceItemIds,
    ...judgment.counterEvidenceItemIds,
  ]);
  const groundedIds = new Set(judgment.claimEdges
    .filter(({ claimItemId, dependencyType }) =>
      claimItemId === judgment.id
      && dependencyType !== "framework_ref"
      && dependencyType !== "policy_ref"
      && dependencyType !== "benchmark_ref"
    )
    .map(({ dependencyItemId }) => dependencyItemId));
  if (usedIds.some((id) => !groundedIds.has(id))) {
    throw new Error(
      `Named Lens judgment ${judgment.id} is not grounded in its persisted evidence claim edges.`,
    );
  }
}

function exactAuthorizedJudgmentBinding(
  judgment: FrameworkJudgment,
  binding: DecisionTaxonomyBinding,
): { componentVersion: string } | null {
  const metadata = judgment.frameworkMetadata;
  if (!metadata || binding.evidenceDomainCodes.length === 0) return null;
  const matchingBindings = metadata.decisionTaxonomyBindings.filter(
    (authorized) =>
      authorized.frameworkId === binding.frameworkId
      && authorized.cardFieldRef === binding.cardFieldRef
      && authorized.questionText === binding.questionText
      && authorized.decisionQuestionCode === binding.decisionQuestionCode
      && sameStrings(
        authorized.evidenceDomainCodes,
        binding.evidenceDomainCodes,
      ),
  );
  const matchingComponentIds = metadata.componentCardIds.filter((id) =>
    id === binding.frameworkId
  );
  const matchingComponents = metadata.components.filter(({ frameworkId }) =>
    frameworkId === binding.frameworkId
  );
  const fieldMatch = /^decisionQuestions\[([0-9]+)\]$/u.exec(
    binding.cardFieldRef,
  );
  const questionIndex = fieldMatch ? Number(fieldMatch[1]) : -1;
  const exact = matchingBindings.length === 1
    && matchingComponentIds.length === 1
    && matchingComponents.length === 1
    && Number.isSafeInteger(questionIndex)
    && questionIndex >= 0
    && matchingComponents[0]!.decisionQuestions[questionIndex]
      === binding.questionText;
  return exact ? { componentVersion: matchingComponents[0]!.version } : null;
}

function selectPrincipalPair(
  records: readonly PriorityWorkingRecord[],
): readonly [PriorityWorkingRecord, PriorityWorkingRecord] | null {
  const pairs: Array<[PriorityWorkingRecord, PriorityWorkingRecord]> = [];
  for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) {
    const left = records[leftIndex]!;
    if (
      left.selectionBasisEvidenceIds.length === 0
      || (left.stance !== "supportive" && left.stance !== "negative")
    ) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex += 1) {
      const right = records[rightIndex]!;
      if (
        right.selectionBasisEvidenceIds.length === 0
        || left.decisionQuestionCode !== right.decisionQuestionCode
        || !opposing(left.stance, right.stance)
      ) continue;
      pairs.push(compareStablePriorityIdentity(left, right) <= 0
        ? [left, right]
        : [right, left]);
    }
  }
  pairs.sort((left, right) => {
    const leftUnion = new Set([
      ...left[0].selectionBasisEvidenceIds,
      ...left[1].selectionBasisEvidenceIds,
    ]).size;
    const rightUnion = new Set([
      ...right[0].selectionBasisEvidenceIds,
      ...right[1].selectionBasisEvidenceIds,
    ]).size;
    const leftMinimumCoverage = Math.min(
      COVERAGE_ORDINAL[left[0].evidenceCoverage],
      COVERAGE_ORDINAL[left[1].evidenceCoverage],
    );
    const rightMinimumCoverage = Math.min(
      COVERAGE_ORDINAL[right[0].evidenceCoverage],
      COVERAGE_ORDINAL[right[1].evidenceCoverage],
    );
    const leftShared = intersectionSize(
      left[0].selectionBasisEvidenceIds,
      left[1].selectionBasisEvidenceIds,
    );
    const rightShared = intersectionSize(
      right[0].selectionBasisEvidenceIds,
      right[1].selectionBasisEvidenceIds,
    );
    return rightUnion - leftUnion
      || rightMinimumCoverage - leftMinimumCoverage
      || rightShared - leftShared
      || compareStablePriorityIdentity(left[0], right[0])
      || compareStablePriorityIdentity(left[1], right[1]);
  });
  return pairs[0] ?? null;
}

function comparePriorityRecords(
  left: PriorityWorkingRecord,
  right: PriorityWorkingRecord,
): number {
  return TIER_ORDINAL[left.priorityTier] - TIER_ORDINAL[right.priorityTier]
    || right.selectionBasisEvidenceIds.length
      - left.selectionBasisEvidenceIds.length
    || COVERAGE_ORDINAL[right.evidenceCoverage]
      - COVERAGE_ORDINAL[left.evidenceCoverage]
    || Number(right.suppliesOpposingStance)
      - Number(left.suppliesOpposingStance)
    || compareStablePriorityIdentity(left, right);
}

function compareStablePriorityIdentity(
  left: Pick<NamedLensProvisionalPriority, "packId" | "frameworkCardId" | "judgmentId">,
  right: Pick<NamedLensProvisionalPriority, "packId" | "frameworkCardId" | "judgmentId">,
): number {
  return compareUtf8(left.packId, right.packId)
    || compareUtf8(left.frameworkCardId, right.frameworkCardId)
    || compareUtf8(left.judgmentId, right.judgmentId);
}

function addsRequiredDiversity(
  candidate: NamedLensPassage,
  selected: readonly NamedLensPassage[],
): boolean {
  const sameQuestion = selected.filter(({ decisionQuestionCode }) =>
    decisionQuestionCode === candidate.decisionQuestionCode
  );
  const selectedDomains = new Set(
    selected.flatMap(({ evidenceDomainCodes }) => evidenceDomainCodes),
  );
  return sameQuestion.length === 0
    || !sameQuestion.some(({ conditionalConclusion }) =>
      conditionalConclusion.stance === candidate.conditionalConclusion.stance
    )
    || candidate.evidenceDomainCodes.some((domain) =>
      !selectedDomains.has(domain)
    );
}

function duplicateSignature(passage: NamedLensPassage): string {
  return [
    passage.decisionQuestionCode,
    uniqueSorted(passage.selectionBasisEvidenceIds).join("\u001f"),
    passage.conditionalConclusion.advisoryPosture,
  ].join("\u0000");
}

function normalizedProseFingerprint(passage: NamedLensPassage): string {
  const normalized = [
    passage.premise.text,
    passage.caseApplication.text,
    passage.countercase.text,
    passage.unknownBoundary.text,
    passage.conditionalConclusion.text,
  ].join(" ").normalize("NFKC").toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ").trim();
  return sha256(normalized);
}

function principalPassagePair(
  passages: readonly NamedLensPassage[],
): readonly [NamedLensPassage, NamedLensPassage] | null {
  for (let leftIndex = 0; leftIndex < passages.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < passages.length; rightIndex += 1) {
      const left = passages[leftIndex]!;
      const right = passages[rightIndex]!;
      if (
        left.decisionQuestionCode === right.decisionQuestionCode
        && opposing(
          left.conditionalConclusion.stance,
          right.conditionalConclusion.stance,
        )
      ) return [left, right];
    }
  }
  return null;
}

function opposing(left: string, right: string): boolean {
  return (left === "supportive" && right === "negative")
    || (left === "negative" && right === "supportive");
}

function reasonCodeForTier(
  tier: PriorityWorkingRecord["priorityTier"],
): string {
  switch (tier) {
    case "principal_disagreement": return "PRINCIPAL_DISAGREEMENT";
    case "changed_belief": return "CHANGED_BELIEF_EVIDENCE";
    case "decision_or_valuation": return "DECISION_OR_VALUATION_EVIDENCE";
    case "distinct_material": return "DISTINCT_MATERIAL_EVIDENCE";
    case "context_only": return "CONTEXT_ONLY";
  }
}

function canonicalCriticalEvidence(
  values: readonly DecisionCriticalEvidenceRef[],
): DecisionCriticalEvidenceRef[] {
  const parsed = values.map((value) =>
    DecisionCriticalEvidenceRefSchema.parse(value)
  ).sort((left, right) =>
    compareUtf8(left.evidencePackItemId, right.evidencePackItemId)
  );
  if (
    new Set(parsed.map(({ evidencePackItemId }) => evidencePackItemId)).size
      !== parsed.length
  ) {
    throw new Error("Decision-critical Evidence Pack item IDs must be unique.");
  }
  return parsed;
}

function assertSingleCandidateScope(
  candidates: readonly NamedLensCatalogCandidate[],
): void {
  if (candidates.length === 0) return;
  const workspaceId = candidates[0]!.workspaceId;
  const candidateRunId = candidates[0]!.artifactSourceCandidateRunId;
  if (candidates.some((candidate) =>
    candidate.workspaceId !== workspaceId
    || candidate.artifactSourceCandidateRunId !== candidateRunId
    || candidate.reasonCodes.length === 0
  )) {
    throw new Error("Named Lens catalog candidates must share one candidate-local identity and typed reason.");
  }
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => compareUtf8(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** English words are non-empty tokens separated by Unicode whitespace. */
function englishWordCount(value: string): number {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

function intersectionSize(left: readonly string[], right: readonly string[]): number {
  const rightSet = new Set(right);
  return new Set(left.filter((item) => rightSet.has(item))).size;
}

function uniqueSorted<T extends string>(items: readonly T[]): T[] {
  return [...new Set(items)].sort(compareUtf8);
}

function uniqueMap<T>(
  items: readonly T[],
  identity: (item: T) => string,
  label: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    const id = identity(item);
    if (result.has(id)) throw new Error(`Named Lens ${label} IDs must be unique.`);
    result.set(id, item);
  }
  return result;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function taxonomyBindingFor(
  bindings:
    | ReadonlyMap<string, DecisionTaxonomyBinding>
    | Readonly<Record<string, DecisionTaxonomyBinding>>,
  frameworkCardId: string,
): DecisionTaxonomyBinding | undefined {
  if (bindings instanceof Map) return bindings.get(frameworkCardId);
  return (bindings as Readonly<Record<string, DecisionTaxonomyBinding>>)[
    frameworkCardId
  ];
}
