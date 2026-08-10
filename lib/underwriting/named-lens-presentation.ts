import {
  DecisionCriticalEvidenceProjectionSchema,
  NamedLensCatalogConsiderationSchema,
  NamedLensDispositionSchema,
  NamedLensFinalizationDispositionSchema,
  NamedLensPresentationSchema,
  type NamedLensCatalogConsideration,
  type NamedLensFinalizationDisposition,
  type NamedLensPassage,
  type NamedLensPresentation,
  type NamedLensProviderAttempt,
  type NamedLensProviderAttemptRef,
} from "../contracts/named-lens";
import type { CompanyAnalysis } from "../contracts/domain";
import type {
  Calculation,
  ClaimEdge,
  EvidencePack,
} from "../contracts/evidence";
import type {
  DecisionResult,
  FrameworkJudgment,
  FundPolicySnapshot,
  ResolvedUnderwritingContext,
  ValuationEvaluation,
} from "../contracts/underwriting";
import { compareUtf8 } from "../format/canonical-order";
import type { CandidateGroundingSnapshot } from "./candidate-grounding";
import { isFormalDecisionJudgment } from "./decision/engine";
import { createCanonicalFingerprint } from "./fingerprints";
import {
  buildDecisionCriticalEvidenceProjection,
  DecisionCriticalEvidenceResolutionError,
} from
  "./frameworks/critical-evidence";
import type { DecisionTaxonomyBinding } from
  "./frameworks/decision-taxonomy";
import type { FrameworkLensAdvisoryFailure } from
  "./frameworks/service";
import {
  buildNamedLensSynthesis,
  finalizeNamedLensPlacement,
  prioritizeNamedLensJudgments,
  type NamedLensCatalogCandidate,
  type NamedLensPassageValidationResult,
} from "./frameworks/relevance";

export const NAMED_LENS_RENDERER_VERSION =
  "named-lens-renderer-v1" as const;
export const DECISION_CRITICAL_EVIDENCE_PROJECTION_FINGERPRINT_VERSION =
  "decision-critical-evidence-projection-v1" as const;
export const NAMED_LENS_FINAL_DISPOSITIONS_FINGERPRINT_VERSION =
  "named-lens-final-dispositions-v1" as const;
export const NAMED_LENS_PRESENTATION_FINGERPRINT_VERSION =
  "named-lens-presentation-v1" as const;

export interface NamedLensPresentationArtifacts {
  catalogConsiderations: NamedLensCatalogConsideration[];
  decisionCriticalEvidenceProjection: ReturnType<
    typeof DecisionCriticalEvidenceProjectionSchema.parse
  >;
  attemptRefs: NamedLensProviderAttemptRef[];
  dispositions: NamedLensFinalizationDisposition[];
  passages: NamedLensPassage[];
  presentationReportId: string;
  presentation: NamedLensPresentation;
  finalDispositionsFingerprint: string;
  terminalStatus: "completed" | "partial";
  terminalReasonCodes: string[];
}

export function buildNamedLensPresentationArtifacts(input: {
  workspaceId: string;
  candidateRunId: string;
  reportId: string;
  analysis: CompanyAnalysis;
  pack: EvidencePack;
  grounding: CandidateGroundingSnapshot;
  calculations: Calculation[];
  calculationClaimEdges?: ClaimEdge[];
  decision: DecisionResult;
  judgments: FrameworkJudgment[];
  authorityBindings?: {
    valuation: ValuationEvaluation;
    fundPolicy: FundPolicySnapshot;
    context: ResolvedUnderwritingContext;
    decisionPolicyId: string;
  };
  taxonomyByFrameworkId:
    | ReadonlyMap<string, DecisionTaxonomyBinding>
    | Readonly<Record<string, DecisionTaxonomyBinding>>;
  passageResults: NamedLensPassageValidationResult[];
  advisoryFailures: FrameworkLensAdvisoryFailure[];
  attempts: NamedLensProviderAttempt[];
}): NamedLensPresentationArtifacts {
  const catalogCandidates = [
    ...input.judgments
    .filter(({ frameworkMetadata }) => frameworkMetadata !== undefined)
    .sort((left, right) => compareUtf8(left.id, right.id))
    .map((judgment) => catalogCandidate({
      workspaceId: input.workspaceId,
      candidateRunId: input.candidateRunId,
      judgment,
    })),
    ...input.advisoryFailures.map((failure) => ({
      workspaceId: input.workspaceId,
      artifactSourceCandidateRunId: input.candidateRunId,
      judgmentOrCatalogCandidateId:
        failure.judgmentOrCatalogCandidateId,
      judgmentId: null,
      frameworkCardId: failure.frameworkCardId,
      frameworkVersion: failure.frameworkVersion,
      initialDisposition: "unavailable" as const,
      reasonCodes: [failure.reasonCode.toUpperCase()],
    })),
  ].sort((left, right) => compareUtf8(
    left.judgmentOrCatalogCandidateId,
    right.judgmentOrCatalogCandidateId,
  ));
  const catalogConsiderations = catalogCandidates.map((candidate) =>
    NamedLensCatalogConsiderationSchema.parse({
      ...candidate,
      fingerprint: createCanonicalFingerprint({
        kind: "named-lens-catalog-consideration-v1",
        ...candidate,
      }),
    })
  );
  const eligibleIds = new Set(catalogCandidates
    .filter(({ initialDisposition }) =>
      initialDisposition === "judgment_eligible"
    )
    .map(({ judgmentOrCatalogCandidateId }) =>
      judgmentOrCatalogCandidateId
    ));
  const resultsByCandidate = new Map(input.passageResults.map((result) => [
    result.judgmentOrCatalogCandidateId,
    result,
  ]));
  const missingResultId = [...eligibleIds]
    .sort(compareUtf8)
    .find((candidateId) => !resultsByCandidate.has(candidateId));
  if (missingResultId) {
    throw new Error(
      `Every eligible Named Lens catalog candidate requires one explicit validation result before placement: ${missingResultId}.`,
    );
  }
  let projectionUnavailable = false;
  let evidenceRefs: ReturnType<
    typeof buildDecisionCriticalEvidenceProjection
  > = [];
  try {
    evidenceRefs = buildDecisionCriticalEvidenceProjection({
      analysis: input.analysis,
      pack: input.pack,
      grounding: input.grounding,
      calculations: input.calculations,
      calculationClaimEdges: input.calculationClaimEdges,
      decision: input.decision,
      judgments: input.judgments,
      authorityBindings: input.authorityBindings,
    });
  } catch (error) {
    if (!(error instanceof DecisionCriticalEvidenceResolutionError)) {
      throw error;
    }
    projectionUnavailable = true;
  }
  const decisionCriticalEvidenceProjection =
    DecisionCriticalEvidenceProjectionSchema.parse({
      id: `decision-critical-projection:${input.candidateRunId}`,
      workspaceId: input.workspaceId,
      artifactSourceCandidateRunId: input.candidateRunId,
      evidenceRefs,
      fingerprint:
        createDecisionCriticalEvidenceProjectionFingerprint(
          evidenceRefs,
          input.judgments,
        ),
    });
  const validatedJudgmentIds = new Set(input.passageResults
    .filter(({ status }) => status === "validated")
    .map(({ judgmentOrCatalogCandidateId }) =>
      judgmentOrCatalogCandidateId
    ));
  const provisionalPriority = projectionUnavailable
    ? []
    : prioritizeNamedLensJudgments({
      judgments: input.judgments.filter(({ id, frameworkMetadata }) =>
        frameworkMetadata !== undefined && validatedJudgmentIds.has(id)
      ),
      criticalEvidence: evidenceRefs,
      taxonomyByFrameworkId: input.taxonomyByFrameworkId,
    });
  const passageResults = input.passageResults;
  const placement = projectionUnavailable
    ? {
      dispositions: catalogCandidates.map((candidate) => {
        const { initialDisposition, ...candidateIdentity } = candidate;
        const disposition = initialDisposition
          === "judgment_eligible"
          ? "withheld" as const
          : candidate.initialDisposition;
        const value = {
          ...candidateIdentity,
          disposition,
          selectedPosition: null,
          priorityTier: null,
          reasonCodes: disposition === "withheld"
            ? ["DECISION_CRITICAL_EVIDENCE_PROJECTION_UNAVAILABLE"]
            : candidate.reasonCodes,
          decisionQuestionCode: null,
          stance: null,
          advisoryPosture: null,
          selectionBasisEvidenceIds: [],
          criticalEvidence: [],
          selectionPolicyVersion: "named-lens-selection-v1" as const,
          passageFingerprint: null,
        };
        return NamedLensDispositionSchema.parse({
          ...value,
          fingerprint: createCanonicalFingerprint({
            kind: "named-lens-disposition-v1",
            ...value,
          }),
        });
      }),
      passages: [],
    }
    : finalizeNamedLensPlacement({
      catalogCandidates,
      provisionalPriority,
      passageResults,
      criticalEvidence: evidenceRefs,
    });
  const dispositions = placement.dispositions.map((disposition) => {
    const persisted = {
      ...disposition,
      decisionCriticalEvidenceProjectionId:
        decisionCriticalEvidenceProjection.id,
      decisionCriticalEvidenceProjectionFingerprint:
        decisionCriticalEvidenceProjection.fingerprint,
    };
    return NamedLensFinalizationDispositionSchema.parse({
      ...persisted,
      fingerprint: createCanonicalFingerprint({
        kind: "named-lens-final-disposition-v1",
        ...persisted,
        fingerprint: undefined,
      }),
    });
  });
  const synthesis = buildNamedLensSynthesis({
    passages: placement.passages,
    dispositions: placement.dispositions,
  });
  const selected = dispositions
    .filter(({ disposition }) => disposition === "selected_main")
    .sort((left, right) =>
      left.selectedPosition! - right.selectedPosition!
      || compareUtf8(left.judgmentId!, right.judgmentId!)
    );
  const passageByJudgmentId = new Map(
    placement.passages.map((passage) => [passage.judgmentId, passage]),
  );
  const presentationWithoutFingerprint = {
    schemaVersion: "decision-first-named-lens-v1" as const,
    rendererVersion: NAMED_LENS_RENDERER_VERSION,
    workspaceId: input.workspaceId,
    artifactSourceCandidateRunId: input.candidateRunId,
    synthesis,
    segmentCitations: selected.flatMap((disposition) =>
      segmentCitations(passageByJudgmentId.get(disposition.judgmentId!)!)
    ),
    firstScreenProjectionRefs: {
      decisionId: input.decision.id,
      decisionEvidenceItemIds: decisionEvidenceIds(
        input.decision,
        input.pack,
      ),
      selectedJudgmentIds: selected.map(({ judgmentId }) => judgmentId!),
    },
  };
  const semanticFingerprints = createNamedLensSemanticFingerprints({
    evidenceRefs,
    dispositions,
    passages: placement.passages,
    presentation: presentationWithoutFingerprint,
    formalJudgments: input.judgments,
  });
  const presentation = NamedLensPresentationSchema.parse({
    ...presentationWithoutFingerprint,
    fingerprint: semanticFingerprints.presentationFingerprint,
  });
  const attemptRefs = input.attempts
    .filter(({ status }) => status !== "reserved")
    .sort((left, right) => compareUtf8(
      attemptIdentity(left),
      attemptIdentity(right),
    ))
    .map(({ judgmentOrCatalogCandidateId, logicalPassageId, attemptNumber,
      attemptFingerprint }) => ({
      judgmentOrCatalogCandidateId,
      logicalPassageId,
      attemptNumber,
      attemptFingerprint,
    }));
  const unavailable = dispositions.filter(({ disposition }) =>
    disposition === "unavailable" || disposition === "withheld"
  );
  const terminalStatus = !projectionUnavailable && unavailable.length === 0
    ? "completed" as const
    : "partial" as const;
  const terminalReasonCodes = terminalStatus === "partial"
    ? projectionUnavailable
      ? ["decision_critical_evidence_projection_unavailable"]
      : uniqueSorted(unavailable.flatMap(({ reasonCodes }) => reasonCodes))
    : placement.passages.length < 4 && eligibleIds.size < 4
    ? ["limited_framework_coverage"]
    : [];
  return {
    catalogConsiderations,
    decisionCriticalEvidenceProjection,
    attemptRefs,
    dispositions,
    passages: placement.passages,
    presentationReportId: input.reportId,
    presentation,
    finalDispositionsFingerprint:
      semanticFingerprints.finalDispositionsFingerprint,
    terminalStatus,
    terminalReasonCodes,
  };
}

export function createDecisionCriticalEvidenceProjectionFingerprint(
  evidenceRefs: ReturnType<typeof buildDecisionCriticalEvidenceProjection>,
  formalJudgments: readonly FrameworkJudgment[] = [],
): string {
  return createCanonicalFingerprint({
    kind: DECISION_CRITICAL_EVIDENCE_PROJECTION_FINGERPRINT_VERSION,
    evidenceRefs: semanticCriticalEvidenceRefs(
      evidenceRefs,
      formalJudgments,
    ),
  });
}

export function createNamedLensSemanticFingerprints(input: {
  evidenceRefs: ReturnType<typeof buildDecisionCriticalEvidenceProjection>;
  dispositions: NamedLensFinalizationDisposition[];
  passages: NamedLensPassage[];
  presentation: Omit<NamedLensPresentation, "fingerprint">;
  formalJudgments?: readonly FrameworkJudgment[];
}): {
  finalDispositionsFingerprint: string;
  presentationFingerprint: string;
} {
  const semanticEvidenceRefs = semanticCriticalEvidenceRefs(
    input.evidenceRefs,
    input.formalJudgments ?? [],
  );
  const semanticPassageByJudgment = new Map(input.passages.map((passage) => [
    passage.judgmentId,
    semanticPassage(passage),
  ]));
  const semanticDispositions = input.dispositions.map((disposition) => ({
    frameworkCardId: disposition.frameworkCardId,
    frameworkVersion: disposition.frameworkVersion,
    disposition: disposition.disposition,
    selectedPosition: disposition.selectedPosition,
    priorityTier: disposition.priorityTier,
    reasonCodes: disposition.reasonCodes,
    decisionQuestionCode: disposition.decisionQuestionCode,
    stance: disposition.stance,
    advisoryPosture: disposition.advisoryPosture,
    selectionBasisEvidenceIds: disposition.selectionBasisEvidenceIds,
    criticalEvidence: semanticCriticalEvidenceRefs(
      disposition.criticalEvidence,
      input.formalJudgments ?? [],
    ),
    passage: disposition.judgmentId === null
      ? null
      : semanticPassageByJudgment.get(disposition.judgmentId) ?? null,
  })).sort((left, right) => compareUtf8(
    createCanonicalFingerprint(left),
    createCanonicalFingerprint(right),
  ));
  const semanticCitations = input.presentation.segmentCitations.map(
    (citation) => {
      const { judgmentId: omittedJudgmentId, ...semanticCitation } = citation;
      void omittedJudgmentId;
      return semanticCitation;
    },
  ).sort((left, right) => compareUtf8(
    createCanonicalFingerprint(left),
    createCanonicalFingerprint(right),
  ));
  return {
    finalDispositionsFingerprint: createCanonicalFingerprint({
      kind: NAMED_LENS_FINAL_DISPOSITIONS_FINGERPRINT_VERSION,
      projection: semanticEvidenceRefs,
      dispositions: semanticDispositions,
    }),
    presentationFingerprint: createCanonicalFingerprint({
      kind: NAMED_LENS_PRESENTATION_FINGERPRINT_VERSION,
      schemaVersion: input.presentation.schemaVersion,
      rendererVersion: input.presentation.rendererVersion,
      synthesis: {
        branch: input.presentation.synthesis.branch,
        text: input.presentation.synthesis.text,
        evidenceItemIds: input.presentation.synthesis.evidenceItemIds,
        judgmentCount: input.presentation.synthesis.judgmentIds.length,
      },
      segmentCitations: semanticCitations,
      firstScreenProjectionRefs: {
        decisionEvidenceItemIds:
          input.presentation.firstScreenProjectionRefs
            .decisionEvidenceItemIds,
        selectedJudgmentCount:
          input.presentation.firstScreenProjectionRefs.selectedJudgmentIds
            .length,
      },
    }),
  };
}

function semanticCriticalEvidenceRefs(
  evidenceRefs: ReturnType<typeof buildDecisionCriticalEvidenceProjection>,
  judgments: readonly FrameworkJudgment[],
): ReturnType<typeof buildDecisionCriticalEvidenceProjection> {
  const semanticJudgments = new Map(judgments
    .filter(isFormalDecisionJudgment)
    .map((judgment) => [
      judgment.id,
      `formal_framework:${judgment.frameworkCardId}@${judgment.frameworkVersion}`,
    ]));
  if (semanticJudgments.size === 0) return evidenceRefs;
  return evidenceRefs.map((reference) => ({
    ...reference,
    resolutionPath: reference.resolutionPath.map((part) => {
      const direct = semanticJudgments.get(part);
      if (direct) return direct;
      for (const [judgmentId, semanticIdentity] of semanticJudgments) {
        if (part === `framework_judgment:${judgmentId}`) {
          return `framework_judgment_ref:${semanticIdentity}`;
        }
      }
      return part;
    }),
  }));
}

function catalogCandidate(input: {
  workspaceId: string;
  candidateRunId: string;
  judgment: FrameworkJudgment;
}): NamedLensCatalogCandidate {
  const { judgment } = input;
  const contextInapplicable = judgment.frameworkMetadata?.applicable === false
    || judgment.applicability === "not_applicable";
  const initialDisposition = contextInapplicable
    ? "context_inapplicable" as const
    : judgment.applicability === "unavailable"
    ? "unavailable" as const
    : judgment.conclusion === "abstain"
    ? "abstained" as const
    : "judgment_eligible" as const;
  return {
    workspaceId: input.workspaceId,
    artifactSourceCandidateRunId: input.candidateRunId,
    judgmentOrCatalogCandidateId: judgment.id,
    judgmentId: initialDisposition === "context_inapplicable"
      ? null
      : judgment.id,
    frameworkCardId: judgment.frameworkCardId,
    frameworkVersion: judgment.frameworkVersion,
    initialDisposition,
    reasonCodes: [initialDisposition === "judgment_eligible"
      ? "JUDGMENT_ELIGIBLE"
      : initialDisposition.toUpperCase()],
  };
}

function segmentCitations(passage: NamedLensPassage) {
  const empty = {
    evidenceItemIds: [] as string[],
    publicSourceIds: [] as string[],
    claimIds: [] as string[],
    judgmentUnknownRefs: [] as string[],
    judgmentLimitationRefs: [] as string[],
    evidenceRequestRefs: [] as string[],
    stanceRefs: [] as Array<"supportive" | "mixed" | "negative" | "abstain">,
    advisoryPostureRefs: [] as Array<
      "supports_further_diligence" | "urges_caution" | "withholds_view"
    >,
  };
  return [{
    ...empty,
    judgmentId: passage.judgmentId,
    segment: "premise" as const,
    publicSourceIds: passage.premise.publicSourceIds,
    claimIds: passage.premise.claimIds,
  }, {
    ...empty,
    judgmentId: passage.judgmentId,
    segment: "case_application" as const,
    evidenceItemIds: passage.caseApplication.evidenceItemIds,
  }, {
    ...empty,
    judgmentId: passage.judgmentId,
    segment: "countercase" as const,
    evidenceItemIds: passage.countercase.evidenceItemIds,
    evidenceRequestRefs: passage.countercase.evidenceRequestRefs,
  }, {
    ...empty,
    judgmentId: passage.judgmentId,
    segment: "unknown_boundary" as const,
    judgmentUnknownRefs: passage.unknownBoundary.judgmentUnknownRefs,
    judgmentLimitationRefs: passage.unknownBoundary.judgmentLimitationRefs,
    evidenceRequestRefs: passage.unknownBoundary.evidenceRequestRefs,
  }, {
    ...empty,
    judgmentId: passage.judgmentId,
    segment: "conditional_conclusion" as const,
    stanceRefs: [passage.conditionalConclusion.stance],
    advisoryPostureRefs: [passage.conditionalConclusion.advisoryPosture],
  }];
}

function decisionEvidenceIds(
  decision: DecisionResult,
  pack: EvidencePack,
): string[] {
  const allowed = new Set([
    ...pack.facts.map(({ id }) => id),
    ...pack.assumptions.map(({ id }) => id),
  ]);
  return uniqueSorted([
    ...decision.blockingEvidenceItemIds,
    ...decision.firedRules.flatMap(({ inputRefs }) => inputRefs),
    ...decision.claimEdges
      .filter(({ dependencyType }) =>
        dependencyType === "fact" || dependencyType === "assumption"
      )
      .map(({ dependencyItemId }) => dependencyItemId),
  ].filter((id) => allowed.has(id)));
}

function semanticPassage(passage: NamedLensPassage) {
  return {
    schemaVersion: passage.schemaVersion,
    frameworkCardId: passage.frameworkCardId,
    frameworkVersion: passage.frameworkVersion,
    decisionQuestionCode: passage.decisionQuestionCode,
    evidenceDomainCodes: passage.evidenceDomainCodes,
    premise: passage.premise,
    caseApplication: passage.caseApplication,
    countercase: passage.countercase,
    unknownBoundary: passage.unknownBoundary,
    conditionalConclusion: passage.conditionalConclusion,
    advisoryContract: passage.advisoryContract,
    selectionBasisEvidenceIds: passage.selectionBasisEvidenceIds,
    wordCount: passage.wordCount,
    generatorVersion: passage.generatorVersion,
  };
}

function attemptIdentity(attempt: NamedLensProviderAttempt): string {
  return [
    attempt.judgmentOrCatalogCandidateId,
    attempt.logicalPassageId,
    String(attempt.attemptNumber),
    attempt.attemptFingerprint,
  ].join("\u0000");
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf8);
}
