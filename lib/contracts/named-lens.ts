import { z } from "zod";

import { compareUtf8 } from "../format/canonical-order";
import {
  DecisionQuestionCodeSchema,
  EvidenceDomainCodeSchema,
} from "../underwriting/frameworks/decision-taxonomy";
import { ResearchSourceLocatorSchema } from
  "../underwriting/frameworks/research-schemas";

export const NAMED_LENS_PASSAGE_SCHEMA_VERSION =
  "named-lens-passage-v1" as const;
export const NAMED_LENS_SELECTION_POLICY_VERSION =
  "named-lens-selection-v1" as const;
export const UNDERWRITING_PRESENTATION_SCHEMA_VERSION =
  "decision-first-named-lens-v1" as const;
export const NAMED_LENS_GENERATOR_VERSION =
  "named-lens-generator-v1" as const;

export const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const NamedLensDispositionKindSchema = z.enum([
  "context_inapplicable",
  "ineligible",
  "abstained",
  "unavailable",
  "withheld",
  "selected_main",
  "appendix_only",
]);

export const AdvisoryPostureSchema = z.enum([
  "supports_further_diligence",
  "urges_caution",
  "withholds_view",
]);

export const NamedLensPassageFocusSchema = z.strictObject({
  componentFrameworkId: z.string().min(1),
  componentVersion: z.string().min(1),
  cardFieldRef: z.string().regex(/^decisionQuestions\[[0-9]+\]$/),
  questionText: z.string().min(1).optional(),
  decisionQuestionCode: DecisionQuestionCodeSchema,
  evidenceDomainCodes: z.array(EvidenceDomainCodeSchema).min(1),
}).superRefine((value, context) => {
  requireCanonicalStrings(
    value.evidenceDomainCodes,
    context,
    "Named Lens focus evidence-domain codes",
  );
});

export const NamedLensPriorityTierSchema = z.enum([
  "principal_disagreement",
  "changed_belief",
  "decision_or_valuation",
  "distinct_material",
  "context_only",
]);

export const DecisionCriticalOriginRefSchema = z.strictObject({
  kind: z.enum([
    "market_event",
    "source_revision",
    "xtrace_memory",
    "prior_record",
    "chronology_gate",
    "revisit_gate",
    "counterevidence_gate",
    "action_delta_gate",
    "fired_rule",
    "blocking_evidence",
    "scenario_input",
    "calculation",
    "valuation_evaluation",
    "return_calculation",
  ]),
  id: z.string().min(1),
});

export const DecisionCriticalEvidenceRefSchema = z.strictObject({
  evidencePackItemId: z.string().min(1),
  classification: z.enum(["fact", "assumption"]),
  originRefs: z.array(DecisionCriticalOriginRefSchema).min(1),
  reasonCodes: z.array(z.string().min(1)).min(1),
  resolutionPath: z.array(z.string().min(1)).min(1),
}).superRefine((value, context) => {
  requireCanonicalUnique(
    value.originRefs,
    ({ kind, id }) => `${kind}\u0000${id}`,
    context,
    "Decision-critical origin references",
  );
});

export const DecisionCriticalEvidenceProjectionSchema = z.strictObject({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  artifactSourceCandidateRunId: z.string().min(1),
  evidenceRefs: z.array(DecisionCriticalEvidenceRefSchema),
  fingerprint: Sha256Schema,
}).superRefine((value, context) => {
  requireCanonicalUnique(
    value.evidenceRefs,
    ({ evidencePackItemId }) => evidencePackItemId,
    context,
    "Decision-critical projection evidence IDs",
  );
});

export const NamedLensCatalogConsiderationSchema = z.strictObject({
  workspaceId: z.string().min(1),
  artifactSourceCandidateRunId: z.string().min(1),
  judgmentOrCatalogCandidateId: z.string().min(1),
  judgmentId: z.string().min(1).nullable(),
  frameworkCardId: z.string().min(1),
  frameworkVersion: z.string().min(1),
  initialDisposition: z.enum([
    "judgment_eligible",
    "context_inapplicable",
    "ineligible",
    "abstained",
    "unavailable",
  ]),
  reasonCodes: z.array(z.string().min(1)).min(1),
  fingerprint: Sha256Schema,
}).superRefine((value, context) => {
  requireCanonicalStrings(
    value.reasonCodes,
    context,
    "Named Lens catalog consideration reason codes",
  );
  if (
    value.initialDisposition === "judgment_eligible"
      ? value.judgmentId === null
      : value.initialDisposition === "context_inapplicable"
        || value.initialDisposition === "ineligible"
      ? value.judgmentId !== null
      : false
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Catalog consideration judgment identity must match its authorized initial disposition.",
    });
  }
});

const PlainTextSchema = z.string().min(1).superRefine((value, context) => {
  if (
    /<\/?[A-Za-z][^>]*>/.test(value)
    || /```|\[[^\]]+\]\([^)]+\)|(?:^|\n)\s{0,3}(?:#{1,6}\s|[-+*>]\s)/m
      .test(value)
    || /(?:^|\s)(?:\*\*|__)[^\n]+(?:\*\*|__)(?:\s|$)/.test(value)
  ) {
    context.addIssue({
      code: "custom",
      message: "Named Lens passage content must be plain text.",
    });
  }
});

const AttributionScopeSchema = z.enum([
  "person_direct",
  "coauthored_work",
  "course_notes_derivative",
  "institution_doctrine",
  "revealed_behavior",
  "external_empirical",
]);

export const FrameworkPremiseSegmentSchema = z.strictObject({
  text: PlainTextSchema,
  componentFrameworkId: z.string().min(1),
  componentVersion: z.string().min(1),
  cardFieldRef: z.string().min(1),
  publicSourceIds: z.array(z.string().min(1)).min(1),
  claimIds: z.array(z.string().min(1)).min(1),
  locator: ResearchSourceLocatorSchema,
  attributionScope: AttributionScopeSchema,
}).superRefine((value, context) => {
  requireCanonicalStrings(
    value.publicSourceIds,
    context,
    "Framework premise public source IDs",
  );
  requireCanonicalStrings(
    value.claimIds,
    context,
    "Framework premise claim IDs",
  );
});

export const CompanyEvidenceSegmentSchema = z.strictObject({
  text: PlainTextSchema,
  evidenceItemIds: z.array(z.string().min(1)).min(1),
}).superRefine((value, context) => {
  requireCanonicalStrings(
    value.evidenceItemIds,
    context,
    "Company evidence item IDs",
  );
});

export const CountercaseSegmentSchema = z.strictObject({
  text: PlainTextSchema,
  boundaryKind: z.enum([
    "grounded_counterevidence",
    "no_candidate_local_counterevidence",
  ]),
  evidenceItemIds: z.array(z.string().min(1)),
  evidenceRequestRefs: z.array(z.string().min(1)),
}).superRefine((value, context) => {
  requireCanonicalStrings(
    value.evidenceItemIds,
    context,
    "Countercase evidence item IDs",
  );
  requireCanonicalStrings(
    value.evidenceRequestRefs,
    context,
    "Countercase evidence-request references",
  );
  const grounded = value.boundaryKind === "grounded_counterevidence";
  if (
    (grounded && value.evidenceItemIds.length === 0)
    || (!grounded && (
      value.evidenceItemIds.length !== 0
      || value.evidenceRequestRefs.length === 0
    ))
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Countercase boundaries must match grounded counterevidence or a persisted evidence request.",
    });
  }
});

export const UnknownBoundarySegmentSchema = z.strictObject({
  text: PlainTextSchema,
  judgmentUnknownRefs: z.array(z.string().min(1)),
  judgmentLimitationRefs: z.array(z.string().min(1)),
  evidenceRequestRefs: z.array(z.string().min(1)),
}).superRefine((value, context) => {
  requireCanonicalStrings(
    value.judgmentUnknownRefs,
    context,
    "Judgment unknown references",
  );
  requireCanonicalStrings(
    value.judgmentLimitationRefs,
    context,
    "Judgment limitation references",
  );
  requireCanonicalStrings(
    value.evidenceRequestRefs,
    context,
    "Unknown-boundary evidence-request references",
  );
  if (
    value.judgmentUnknownRefs.length === 0
    && value.judgmentLimitationRefs.length === 0
    && value.evidenceRequestRefs.length === 0
  ) {
    context.addIssue({
      code: "custom",
      message:
        "An unknown boundary must cite a saved unknown, limitation, or evidence request.",
    });
  }
});

export const ConditionalConclusionSegmentSchema = z.strictObject({
  text: PlainTextSchema,
  stance: z.enum(["supportive", "mixed", "negative", "abstain"]),
  advisoryPosture: AdvisoryPostureSchema,
});

export const NamedLensAdvisoryContractSchema = z.strictObject({
  formalDecisionWeight: z.literal("0"),
  noEndorsement: z.literal(true),
  namedPersonImpersonation: z.literal(false),
  hiddenChainOfThought: z.literal(false),
});

export const GroundedNamedLensPassageCandidateSchema = z.strictObject({
  schemaVersion: z.literal(NAMED_LENS_PASSAGE_SCHEMA_VERSION),
  workspaceId: z.string().min(1),
  artifactSourceCandidateRunId: z.string().min(1),
  judgmentId: z.string().min(1),
  frameworkCardId: z.string().min(1),
  frameworkVersion: z.string().min(1),
  focus: NamedLensPassageFocusSchema.required({ questionText: true }),
  premise: FrameworkPremiseSegmentSchema,
  caseApplication: CompanyEvidenceSegmentSchema,
  countercase: CountercaseSegmentSchema,
  unknownBoundary: UnknownBoundarySegmentSchema,
  conditionalConclusion: ConditionalConclusionSegmentSchema,
  advisoryContract: NamedLensAdvisoryContractSchema,
  wordCount: z.number().int().min(1).max(260),
  generatorVersion: z.literal(NAMED_LENS_GENERATOR_VERSION),
  groundingFingerprint: Sha256Schema,
}).superRefine((value, context) => {
  if (
    value.focus.componentFrameworkId !== value.premise.componentFrameworkId
    || value.focus.componentVersion !== value.premise.componentVersion
    || value.focus.cardFieldRef !== value.premise.cardFieldRef
  ) {
    context.addIssue({
      code: "custom",
      message: "Grounded Named Lens focus must exactly match its premise Card binding.",
    });
  }
});

export const NamedLensPassageSchema = z.strictObject({
  schemaVersion: z.literal(NAMED_LENS_PASSAGE_SCHEMA_VERSION),
  workspaceId: z.string().min(1),
  artifactSourceCandidateRunId: z.string().min(1),
  judgmentId: z.string().min(1),
  frameworkCardId: z.string().min(1),
  frameworkVersion: z.string().min(1),
  decisionQuestionCode: DecisionQuestionCodeSchema,
  evidenceDomainCodes: z.array(EvidenceDomainCodeSchema).min(1),
  premise: FrameworkPremiseSegmentSchema,
  caseApplication: CompanyEvidenceSegmentSchema,
  countercase: CountercaseSegmentSchema,
  unknownBoundary: UnknownBoundarySegmentSchema,
  conditionalConclusion: ConditionalConclusionSegmentSchema,
  advisoryContract: NamedLensAdvisoryContractSchema,
  selectionBasisEvidenceIds: z.array(z.string().min(1)),
  wordCount: z.number().int().min(1).max(260),
  generatorVersion: z.literal(NAMED_LENS_GENERATOR_VERSION),
  fingerprint: Sha256Schema,
}).superRefine((value, context) => {
  requireCanonicalStrings(
    value.evidenceDomainCodes,
    context,
    "Named Lens evidence-domain codes",
  );
  requireCanonicalStrings(
    value.selectionBasisEvidenceIds,
    context,
    "Named Lens selection-basis evidence IDs",
  );
});

const NamedLensDispositionBaseSchema = z.strictObject({
  workspaceId: z.string().min(1),
  artifactSourceCandidateRunId: z.string().min(1),
  judgmentOrCatalogCandidateId: z.string().min(1),
  judgmentId: z.string().min(1).nullable(),
  frameworkCardId: z.string().min(1),
  frameworkVersion: z.string().min(1),
  disposition: NamedLensDispositionKindSchema,
  selectedPosition: z.number().int().min(1).max(6).nullable(),
  priorityTier: NamedLensPriorityTierSchema.nullable(),
  reasonCodes: z.array(z.string().min(1)).min(1),
  decisionQuestionCode: DecisionQuestionCodeSchema.nullable(),
  stance: z.enum(["supportive", "mixed", "negative", "abstain"]).nullable(),
  advisoryPosture: AdvisoryPostureSchema.nullable(),
  selectionBasisEvidenceIds: z.array(z.string().min(1)),
  criticalEvidence: z.array(DecisionCriticalEvidenceRefSchema),
  selectionPolicyVersion: z.literal(NAMED_LENS_SELECTION_POLICY_VERSION),
  passageFingerprint: Sha256Schema.nullable(),
  fingerprint: Sha256Schema,
});

export const NamedLensDispositionSchema = NamedLensDispositionBaseSchema
  .superRefine(validateNamedLensDisposition);

export const NamedLensFinalizationDispositionSchema =
  NamedLensDispositionBaseSchema.extend({
    decisionCriticalEvidenceProjectionId: z.string().min(1),
    decisionCriticalEvidenceProjectionFingerprint: Sha256Schema,
  }).superRefine(validateNamedLensDisposition);

function validateNamedLensDisposition(
  value: z.infer<typeof NamedLensDispositionBaseSchema>,
  context: z.core.$RefinementCtx,
): void {
    const hasSelectedShape = value.disposition === "selected_main"
      ? value.selectedPosition !== null
      : value.selectedPosition === null;
    if (!hasSelectedShape) {
      context.addIssue({
        code: "custom",
        message:
          "Only selected_main dispositions may carry a position from one through six.",
      });
    }
    if (
      value.disposition === "selected_main"
      && (
        value.priorityTier === null
        || value.selectionBasisEvidenceIds.length === 0
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Selected Named Lens dispositions require a priority tier and grounded selection basis.",
      });
    }
    const publishable = value.disposition === "selected_main"
      || value.disposition === "appendix_only";
    if (publishable !== (value.passageFingerprint !== null)) {
      context.addIssue({
        code: "custom",
        message:
          "Only selected or appendix dispositions may reference a publishable passage.",
      });
    }
    requireCanonicalStrings(
      value.reasonCodes,
      context,
      "Named Lens disposition reason codes",
    );
    requireCanonicalStrings(
      value.selectionBasisEvidenceIds,
      context,
      "Named Lens disposition selection-basis evidence IDs",
    );
    requireCanonicalUnique(
      value.criticalEvidence,
      ({ evidencePackItemId }) => evidencePackItemId,
      context,
      "Decision-critical evidence IDs",
    );
    const criticalIds = new Set(
      value.criticalEvidence.map(({ evidencePackItemId }) =>
        evidencePackItemId
      ),
    );
    if (
      value.selectionBasisEvidenceIds.some((id) => !criticalIds.has(id))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Selection-basis IDs must be candidate-local decision-critical Evidence Pack item IDs.",
      });
    }
}

export const NamedLensProviderFailureReasonSchema = z.strictObject({
  code: z.enum([
    "timeout",
    "transport_error",
    "provider_error",
    "invalid_response",
    "budget_exhausted",
    "aborted",
  ]),
  detail: z.string().min(1),
  retryable: z.boolean(),
});

export const NamedLensProviderTelemetrySchema = z.strictObject({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/),
  latencyMs: z.number().int().nonnegative(),
});

export const NamedLensProviderAttemptSchema = z.strictObject({
  workspaceId: z.string().min(1),
  artifactSourceCandidateRunId: z.string().min(1),
  judgmentOrCatalogCandidateId: z.string().min(1),
  logicalPassageId: z.string().min(1),
  attemptNumber: z.number().int().positive(),
  attemptFingerprint: Sha256Schema,
  status: z.enum(["reserved", "completed", "failed", "aborted"]),
  telemetry: NamedLensProviderTelemetrySchema.nullable(),
  failureReason: NamedLensProviderFailureReasonSchema.nullable(),
}).superRefine((value, context) => {
  if (
    value.status === "reserved"
      ? value.telemetry !== null || value.failureReason !== null
      : value.status === "completed"
      ? value.telemetry === null || value.failureReason !== null
      : value.telemetry === null || value.failureReason === null
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Named Lens attempt status must match its settled telemetry and failure reason.",
    });
  }
});

export const NamedLensProviderAttemptRefSchema = z.strictObject({
  judgmentOrCatalogCandidateId: z.string().min(1),
  logicalPassageId: z.string().min(1),
  attemptNumber: z.number().int().positive(),
  attemptFingerprint: Sha256Schema,
});

export const NamedLensSynthesisBranchSchema = z.enum([
  "zero_available",
  "single_perspective",
  "bounded_alignment",
  "different_emphasis",
  "principal_disagreement",
]);

export const NamedLensPresentationSchema = z.strictObject({
  schemaVersion: z.literal(UNDERWRITING_PRESENTATION_SCHEMA_VERSION),
  rendererVersion: z.string().min(1),
  workspaceId: z.string().min(1),
  artifactSourceCandidateRunId: z.string().min(1),
  synthesis: z.strictObject({
    branch: NamedLensSynthesisBranchSchema,
    text: PlainTextSchema,
    judgmentIds: z.array(z.string().min(1)),
    evidenceItemIds: z.array(z.string().min(1)),
  }).superRefine((value, context) => {
    requireCanonicalStrings(
      value.judgmentIds,
      context,
      "Synthesis judgment IDs",
    );
    requireCanonicalStrings(
      value.evidenceItemIds,
      context,
      "Synthesis evidence IDs",
    );
  }),
  segmentCitations: z.array(z.strictObject({
    judgmentId: z.string().min(1),
    segment: z.enum([
      "premise",
      "case_application",
      "countercase",
      "unknown_boundary",
      "conditional_conclusion",
      "synthesis",
    ]),
    evidenceItemIds: z.array(z.string().min(1)),
    publicSourceIds: z.array(z.string().min(1)),
    claimIds: z.array(z.string().min(1)),
    judgmentUnknownRefs: z.array(z.string().min(1)),
    judgmentLimitationRefs: z.array(z.string().min(1)),
    evidenceRequestRefs: z.array(z.string().min(1)),
    stanceRefs: z.array(z.enum([
      "supportive",
      "mixed",
      "negative",
      "abstain",
    ])),
    advisoryPostureRefs: z.array(AdvisoryPostureSchema),
  }).superRefine((value, context) => {
    requireCanonicalStrings(
      value.evidenceItemIds,
      context,
      "Segment citation evidence IDs",
    );
    requireCanonicalStrings(
      value.publicSourceIds,
      context,
      "Segment citation public source IDs",
    );
    requireCanonicalStrings(
      value.claimIds,
      context,
      "Segment citation claim IDs",
    );
    requireCanonicalStrings(
      value.judgmentUnknownRefs,
      context,
      "Segment citation judgment-unknown references",
    );
    requireCanonicalStrings(
      value.judgmentLimitationRefs,
      context,
      "Segment citation judgment-limitation references",
    );
    requireCanonicalStrings(
      value.evidenceRequestRefs,
      context,
      "Segment citation evidence-request references",
    );
    requireCanonicalStrings(
      value.stanceRefs,
      context,
      "Segment citation stance references",
    );
    requireCanonicalStrings(
      value.advisoryPostureRefs,
      context,
      "Segment citation advisory-posture references",
    );
    const hasEvidence = value.evidenceItemIds.length > 0;
    const hasPremise = value.publicSourceIds.length > 0
      || value.claimIds.length > 0;
    const hasUnknownBoundary = value.judgmentUnknownRefs.length > 0
      || value.judgmentLimitationRefs.length > 0
      || value.evidenceRequestRefs.length > 0;
    const hasConclusion = value.stanceRefs.length > 0
      || value.advisoryPostureRefs.length > 0;
    if (
      !hasEvidence && !hasPremise && !hasUnknownBoundary && !hasConclusion
    ) {
      context.addIssue({
        code: "custom",
        message: "Every presentation segment citation must carry a reference.",
      });
    }
    const validReferenceKinds = value.segment === "premise"
      ? hasPremise && !hasEvidence && !hasUnknownBoundary && !hasConclusion
      : value.segment === "case_application"
        || value.segment === "synthesis"
      ? hasEvidence && !hasPremise && !hasUnknownBoundary && !hasConclusion
      : value.segment === "countercase"
      ? (hasEvidence || value.evidenceRequestRefs.length > 0)
        && !hasPremise
        && value.judgmentUnknownRefs.length === 0
        && value.judgmentLimitationRefs.length === 0
        && !hasConclusion
      : value.segment === "unknown_boundary"
      ? hasUnknownBoundary && !hasEvidence && !hasPremise && !hasConclusion
      : hasConclusion && !hasEvidence && !hasPremise && !hasUnknownBoundary;
    if (!validReferenceKinds) {
      context.addIssue({
        code: "custom",
        message:
          "Presentation segment citation reference kinds must match the cited segment.",
      });
    }
  })),
  firstScreenProjectionRefs: z.strictObject({
    decisionId: z.string().min(1),
    decisionEvidenceItemIds: z.array(z.string().min(1)),
    selectedJudgmentIds: z.array(z.string().min(1)),
  }).superRefine((value, context) => {
    requireCanonicalStrings(
      value.decisionEvidenceItemIds,
      context,
      "First-screen decision evidence IDs",
    );
    requireUniqueStrings(
      value.selectedJudgmentIds,
      context,
      "First-screen selected judgment IDs",
    );
  }),
  fingerprint: Sha256Schema,
}).superRefine((value, context) => {
  if (
    value.synthesis.branch === "zero_available"
      ? value.synthesis.judgmentIds.length !== 0
        || value.segmentCitations.length !== 0
      : value.synthesis.judgmentIds.length === 0
        || value.segmentCitations.length === 0
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Presentation citations and judgment references must match the five-branch synthesis.",
    });
  }
});

export type DecisionCriticalOriginRef = z.infer<
  typeof DecisionCriticalOriginRefSchema
>;
export type DecisionCriticalEvidenceRef = z.infer<
  typeof DecisionCriticalEvidenceRefSchema
>;
export type DecisionCriticalEvidenceProjection = z.infer<
  typeof DecisionCriticalEvidenceProjectionSchema
>;
export type NamedLensCatalogConsideration = z.infer<
  typeof NamedLensCatalogConsiderationSchema
>;
export type FrameworkPremiseSegment = z.infer<
  typeof FrameworkPremiseSegmentSchema
>;
export type CompanyEvidenceSegment = z.infer<
  typeof CompanyEvidenceSegmentSchema
>;
export type CountercaseSegment = z.infer<typeof CountercaseSegmentSchema>;
export type UnknownBoundarySegment = z.infer<
  typeof UnknownBoundarySegmentSchema
>;
export type ConditionalConclusionSegment = z.infer<
  typeof ConditionalConclusionSegmentSchema
>;
export type NamedLensAdvisoryContract = z.infer<
  typeof NamedLensAdvisoryContractSchema
>;
export type NamedLensPassageFocus = z.infer<
  typeof NamedLensPassageFocusSchema
>;
export type GroundedNamedLensPassageCandidate = z.infer<
  typeof GroundedNamedLensPassageCandidateSchema
>;
export type NamedLensPassage = z.infer<typeof NamedLensPassageSchema>;
export type NamedLensDisposition = z.infer<typeof NamedLensDispositionSchema>;
export type NamedLensFinalizationDisposition = z.infer<
  typeof NamedLensFinalizationDispositionSchema
>;
export type NamedLensProviderAttempt = z.infer<
  typeof NamedLensProviderAttemptSchema
>;
export type NamedLensProviderAttemptRef = z.infer<
  typeof NamedLensProviderAttemptRefSchema
>;
export type NamedLensPresentation = z.infer<
  typeof NamedLensPresentationSchema
>;

function requireCanonicalStrings(
  values: readonly string[],
  context: z.core.$RefinementCtx,
  label: string,
): void {
  requireCanonicalUnique(values, (value) => value, context, label);
}

function requireUniqueStrings(
  values: readonly string[],
  context: z.core.$RefinementCtx,
  label: string,
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({
      code: "custom",
      message: `${label} must be unique.`,
    });
  }
}

function requireCanonicalUnique<T>(
  values: readonly T[],
  identity: (value: T) => string,
  context: z.core.$RefinementCtx,
  label: string,
): void {
  const identities = values.map(identity);
  if (
    new Set(identities).size !== identities.length
    || identities.some((value, index) =>
      index > 0 && compareUtf8(identities[index - 1]!, value) >= 0
    )
  ) {
    context.addIssue({
      code: "custom",
      message: `${label} must be unique and UTF-8 sorted.`,
    });
  }
}
