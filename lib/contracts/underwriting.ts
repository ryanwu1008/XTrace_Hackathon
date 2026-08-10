import { z } from "zod";

import { ClaimEdgeSchema } from "./evidence";
import {
  BeliefActionSchema,
  BeliefChangeDirectionSchema,
  CanonicalDealStatusSchema,
} from "./domain";
import {
  FrameworkCardAuthoringSchema,
  FrameworkPackAuthoringSchema,
  ResearchSourceRecordSchema,
} from "../underwriting/frameworks/research-schemas";
import {
  DECISION_TAXONOMY_VERSION,
  DecisionTaxonomyBindingSchema,
} from "../underwriting/frameworks/decision-taxonomy";
import {
  actionsForDealStatusAndDirection,
  beliefActionListsEqual,
} from "../reports/action-policy";

const IdSchema = z.string().min(1).refine(
  (value) => value.trim() === value,
  "IDs cannot have surrounding whitespace",
);
const IsoDateSchema = z.iso.date();
const IsoDateTimeSchema = z.iso.datetime({ offset: true });
const ConfidenceSchema = z.enum(["low", "medium", "high"]);
const ScenarioNameSchema = z.enum(["bear", "base", "bull"]);
const DecisionLabelSchema = z.enum([
  "Pass",
  "Watch",
  "Advance",
  "Invest Candidate",
]);

export const FundPolicySnapshotSchema = z.strictObject({
  id: IdSchema,
  workspaceId: IdSchema,
  version: z.number().int().positive(),
  source: z.enum(["recommended_policy", "user_custom"]),
  values: z.record(
    z.string(),
    z.union([
      z.string(),
      z.array(z.string()),
      z.boolean(),
      z.null(),
      z.record(z.string(), z.unknown()),
    ]),
  ),
  createdByUserId: IdSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});

const ResolvedUnderwritingContextShape = {
  id: IdSchema,
  contextVersion: z.string().min(1),
  analysisMode: z.enum(["full", "core_only"]).optional(),
  stage: z.enum(["seed", "series_a"]),
  businessModel: z.enum(["b2b_saas", "enterprise_ai"]),
  geography: z.enum(["us", "global", "unavailable"]),
  securityType: z.literal("preferred"),
  asOfDate: IsoDateSchema,
  criticalEvidenceProfileId: IdSchema,
  benchmarkPackId: IdSchema.nullable(),
  benchmarkCompatibility: z.enum([
    "exact",
    "broad_compatible",
    "adjacent_only",
    "unavailable",
  ]),
  valuationMethodPolicyId: IdSchema,
  decisionPolicyId: IdSchema,
  frameworkPackId: IdSchema,
} as const;

function validateResolvedContext(
  value: {
    analysisMode?: "full" | "core_only";
    geography: "us" | "global" | "unavailable";
    benchmarkPackId: string | null;
    benchmarkCompatibility:
      | "exact"
      | "broad_compatible"
      | "adjacent_only"
      | "unavailable";
  },
  context: z.core.$RefinementCtx,
): void {
  if (
    value.geography !== "us"
    && (
      value.benchmarkPackId !== null
      || value.benchmarkCompatibility !== "unavailable"
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Non-US contexts cannot bind or claim a benchmark.",
    });
  }
  if (
    value.geography === "unavailable"
    && (
      value.analysisMode !== "core_only"
      || value.benchmarkPackId !== null
      || value.benchmarkCompatibility !== "unavailable"
    )
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Unavailable geography requires explicit Core-only analysis and no benchmark.",
    });
  }
  if (
    value.analysisMode === "full"
    && (
      value.geography !== "us"
      || value.benchmarkPackId === null
      || !["exact", "broad_compatible"].includes(
        value.benchmarkCompatibility,
      )
    )
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Full analysis requires a compatible US benchmark-bound context.",
    });
  }
}

export const ResolvedUnderwritingContextSchema = z.strictObject(
  ResolvedUnderwritingContextShape,
).superRefine(validateResolvedContext);

export const ResearchFrameworkContextSchema = z.strictObject({
    ...ResolvedUnderwritingContextShape,
    securityType: z.enum(["preferred", "convertible"]),
  }).superRefine(validateResolvedContext);

export type ResearchFrameworkContext = z.infer<
  typeof ResearchFrameworkContextSchema
>;

export const FrameworkConfidenceSchema = z.strictObject({
  sourceReliability: ConfidenceSchema,
  evidenceStrength: ConfidenceSchema,
  evidenceCoverage: ConfidenceSchema,
  applicability: ConfidenceSchema,
  judgment: ConfidenceSchema,
});

export const FrameworkAdvisoryMetadataSchema = z.strictObject({
  packId: IdSchema,
  packName: z.string().min(1),
  packVersion: z.string().min(1),
  packDescription: z.string().min(1),
  packReview: FrameworkPackAuthoringSchema.shape.review,
  sourceCatalogId: IdSchema,
  researchCutoff: IsoDateSchema,
  context: z.strictObject({
    stage: z.enum(["seed", "series_a"]),
    businessModel: z.enum(["b2b_saas", "enterprise_ai"]),
    geography: z.enum(["us", "global", "unavailable"]),
    securityType: ResearchFrameworkContextSchema.shape.securityType,
  }),
  applicable: z.boolean(),
  componentCardIds: z.array(IdSchema),
  components: z.array(FrameworkCardAuthoringSchema),
  decisionTaxonomyVersion: z.literal(DECISION_TAXONOMY_VERSION),
  decisionTaxonomyDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  decisionTaxonomyBindings: z.array(DecisionTaxonomyBindingSchema),
  sources: z.array(ResearchSourceRecordSchema),
  notices: z.strictObject({
    noEndorsement: z.string().min(1),
    noPrivateReasoning: z.string().min(1),
    experimentalOnly: z.string().min(1),
  }),
  formalDecisionWeight: z.literal("0"),
  authorizationDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).superRefine((metadata, context) => {
  const componentIds = metadata.components.map(({ frameworkId }) =>
    frameworkId
  );
  if (
    componentIds.length !== metadata.componentCardIds.length
    || componentIds.some(
      (frameworkId, index) =>
        frameworkId !== metadata.componentCardIds[index],
    )
    || new Set(componentIds).size !== componentIds.length
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Advisory component Card IDs must uniquely match component records",
    });
  }
  if (metadata.applicable !== (metadata.components.length > 0)) {
    context.addIssue({
      code: "custom",
      message:
        "Advisory applicability must match whether components were selected",
    });
  }
  const expectedDecisionTaxonomyBindings = metadata.components.flatMap(
    ({ frameworkId, decisionQuestions }) =>
      decisionQuestions.map((questionText, index) => ({
        frameworkId,
        cardFieldRef: `decisionQuestions[${index}]`,
        questionText,
      })),
  ).sort((left, right) =>
    `${left.frameworkId}\u0000${left.cardFieldRef}`.localeCompare(
      `${right.frameworkId}\u0000${right.cardFieldRef}`,
      "en",
    )
  );
  if (
    metadata.decisionTaxonomyBindings.length
      !== expectedDecisionTaxonomyBindings.length
    || metadata.decisionTaxonomyBindings.some((binding, index) => {
      const expected = expectedDecisionTaxonomyBindings[index];
      return !expected
        || binding.frameworkId !== expected.frameworkId
        || binding.cardFieldRef !== expected.cardFieldRef
        || binding.questionText !== expected.questionText;
    })
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Advisory decision taxonomy bindings must exactly cover selected component decision questions",
    });
  }
  const sourceIds = metadata.sources.map(({ sourceId }) => sourceId);
  const sourceIdSet = new Set(sourceIds);
  if (
    sourceIdSet.size !== sourceIds.length
    || metadata.components.some((component) =>
      component.sourceRefs.some(({ sourceId }) => !sourceIdSet.has(sourceId))
    )
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Every advisory component source reference must resolve uniquely",
    });
  }
  if (
    metadata.components.some((component) =>
      component.rights.status !== "public_source_paraphrase"
      || component.review.contentStatus !== "draft"
      || component.review.publicationStatus !== "unpublished"
      || component.decisionUtility.formalDecisionWeight !== 0
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Advisory components must satisfy every eligibility gate",
    });
  }
});

const FrameworkJudgmentShape = {
  id: IdSchema,
  analysisType: z.literal("framework_judgment"),
  frameworkCardId: IdSchema,
  frameworkVersion: z.string().min(1),
  applicability: z.enum(["applicable", "not_applicable", "unavailable"]),
  conclusion: z.enum(["supportive", "mixed", "negative", "abstain"]),
  supportEvidenceItemIds: z.array(IdSchema),
  counterEvidenceItemIds: z.array(IdSchema),
  unusedEvidenceItemIds: z.array(IdSchema),
  strongestSupport: z.string().min(1).nullable(),
  strongestCounterargument: z.string().min(1).nullable(),
  unknowns: z.array(z.string().min(1)),
  limitations: z.array(z.string().min(1)),
  confidence: FrameworkConfidenceSchema,
  claimEdges: z.array(ClaimEdgeSchema),
  frameworkMetadata: FrameworkAdvisoryMetadataSchema.optional(),
  fingerprint: z.string().min(1),
} as const;

export const CounterevidenceBoundarySchema = z.strictObject({
  kind: z.enum([
    "grounded_counterevidence",
    "no_candidate_local_counterevidence",
  ]),
  evidenceRequestRefs: z.array(IdSchema),
});

function validateFrameworkJudgmentClaimEdges(
  judgment: { id: string; claimEdges: z.infer<typeof ClaimEdgeSchema>[] },
  context: z.core.$RefinementCtx,
): void {
  if (
    judgment.claimEdges.some((edge) => edge.claimItemId !== judgment.id)
  ) {
    context.addIssue({
      code: "custom",
      message: "Framework claim edges must belong to the saved judgment",
    });
  }
}

/** Persisted compatibility branch for judgments finalized before Named Lens v1. */
export const LegacyFrameworkJudgmentSchema = z.strictObject(
  FrameworkJudgmentShape,
).superRefine(validateFrameworkJudgmentClaimEdges);

/** Fail-closed contract for every current advisory judgment. */
export const CurrentFrameworkJudgmentSchema = z.strictObject({
  ...FrameworkJudgmentShape,
  counterevidenceBoundary: CounterevidenceBoundarySchema,
}).superRefine((judgment, context) => {
  validateFrameworkJudgmentClaimEdges(judgment, context);
  const grounded = judgment.counterevidenceBoundary.kind
    === "grounded_counterevidence";
  if (
    (grounded && judgment.counterEvidenceItemIds.length === 0)
    || (!grounded && (
      judgment.counterEvidenceItemIds.length !== 0
      || judgment.counterevidenceBoundary.evidenceRequestRefs.length === 0
    ))
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Current advisory judgments require grounded counterevidence or a persisted evidence request.",
    });
  }
});

/** Explicit current-or-legacy dispatch for immutable persisted reads. */
export const FrameworkJudgmentReadSchema = z.union([
  CurrentFrameworkJudgmentSchema,
  LegacyFrameworkJudgmentSchema,
]);

export const FrameworkJudgmentSchema = FrameworkJudgmentReadSchema;

export const FrameworkDisagreementSchema = z.strictObject({
  id: IdSchema,
  leftJudgmentId: IdSchema,
  rightJudgmentId: IdSchema,
  topic: z.enum([
    "growth_vs_revenue_quality",
    "fde_moat_vs_services_burden",
    "tam_vs_willingness_to_pay",
    "company_quality_vs_price",
    "contrarian_insight_vs_adoption",
    "independent_framework_conflict",
  ]),
  explanation: z.string().min(1),
  evidenceItemIds: z.array(IdSchema),
}).refine(
  (disagreement) =>
    disagreement.leftJudgmentId !== disagreement.rightJudgmentId,
  "A framework disagreement requires two distinct judgments",
);

function hasExactScenarioSet(
  scenarios: ReadonlyArray<{ name: z.infer<typeof ScenarioNameSchema> }>,
): boolean {
  return scenarios.length === ScenarioNameSchema.options.length
    && ScenarioNameSchema.options.every(
      (name) => scenarios.filter((scenario) => scenario.name === name).length
        === 1,
    );
}

export const ValuationScenarioSchema = z.strictObject({
  name: ScenarioNameSchema,
  valuation: z.string().min(1).nullable(),
  calculationIds: z.array(IdSchema),
});

export const ValuationEvaluationSchema = z.strictObject({
  id: IdSchema,
  status: z.enum(["completed", "partial", "unavailable"]),
  scenarios: z.array(ValuationScenarioSchema),
  currentAsk: z.string().min(1).nullable(),
  maximumAcceptablePreMoney: z.string().min(1).nullable(),
  initialOwnership: z.string().min(1).nullable(),
  postDilutionOwnership: z.string().min(1).nullable(),
  grossMoic: z.string().min(1).nullable(),
  grossIrr: z.string().min(1).nullable(),
  pricingPremium: z.string().min(1).nullable(),
  calculationIds: z.array(IdSchema),
  blockerCodes: z.array(z.string().min(1)),
}).refine(
  (valuation) => hasExactScenarioSet(valuation.scenarios),
  "ValuationEvaluation requires exactly Bear, Base, and Bull",
);

export const ScenarioInputFieldSchema = z.enum([
  "revenue_path",
  "arr_path",
  "growth",
  "gross_margin",
  "contribution_margin",
  "operating_expenses",
  "burn",
  "cash",
  "runway",
  "future_financing",
  "future_dilution",
  "exit_timing",
  "exit_method",
  "exit_multiple",
  "success_conditions",
  "failure_conditions",
  "probability",
]);

export const ScenarioInputSchema = z.strictObject({
  id: IdSchema,
  scenario: ScenarioNameSchema,
  field: ScenarioInputFieldSchema,
  value: z.string().min(1).nullable(),
  unit: z.string().min(1).nullable(),
  evidenceItemId: IdSchema.nullable(),
  assumptionItemId: IdSchema.nullable(),
  unavailableReason: z.string().min(1).nullable(),
}).superRefine((input, context) => {
  const referenceCount = Number(input.evidenceItemId !== null)
    + Number(input.assumptionItemId !== null);

  if (
    input.value === null
    && (
      referenceCount !== 0
      || input.unavailableReason === null
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Unavailable scenario inputs require a reason and no lineage",
    });
  }

  if (
    input.value !== null
    && (
      referenceCount !== 1
      || input.unavailableReason !== null
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Available scenario inputs require exactly one lineage reference",
    });
  }
});

export const ScenarioModelEntrySchema = z.strictObject({
  name: ScenarioNameSchema,
  inputs: z.array(ScenarioInputSchema),
});

const requiredScenarioFields = new Set(ScenarioInputFieldSchema.options);

export const ScenarioModelSchema = z.strictObject({
  id: IdSchema,
  candidateRunId: IdSchema,
  formulaPolicyVersion: z.string().min(1),
  scenarios: z.array(ScenarioModelEntrySchema),
  probabilityWeighted: z.boolean(),
}).superRefine((model, context) => {
  if (!hasExactScenarioSet(model.scenarios)) {
    context.addIssue({
      code: "custom",
      message: "ScenarioModel requires exactly Bear, Base, and Bull",
    });
  }

  for (const scenario of model.scenarios) {
    const fieldNames = scenario.inputs.map((input) => input.field);
    if (
      scenario.inputs.some((input) => input.scenario !== scenario.name)
      || fieldNames.length !== requiredScenarioFields.size
      || [...requiredScenarioFields].some(
        (field) => fieldNames.filter((item) => item === field).length !== 1,
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Each scenario requires one matching input for every scenario field",
      });
    }
  }
});

export const FiredRuleSchema = z.strictObject({
  ruleId: IdSchema,
  inputRefs: z.array(IdSchema),
  result: z.enum(["pass", "fail", "not_applicable"]),
  appliedCeiling: z.string().min(1).nullable(),
  veto: z.boolean(),
});

export const DecisionResultSchema = z.strictObject({
  id: IdSchema,
  analysisType: z.literal("final_synthesis"),
  companyQuality: z.enum(["pass", "mixed", "fail", "unavailable"]),
  priceAttractiveness: z.enum(["pass", "mixed", "fail", "unavailable"]),
  fundFit: z.enum(["pass", "mixed", "fail", "unavailable"]),
  decision: DecisionLabelSchema.nullable(),
  decisionCeiling: DecisionLabelSchema.nullable(),
  hardVeto: z.boolean(),
  firedRules: z.array(FiredRuleSchema),
  blockingEvidenceItemIds: z.array(IdSchema),
  claimEdges: z.array(ClaimEdgeSchema),
  confidence: ConfidenceSchema,
}).superRefine((decision, context) => {
  if (decision.claimEdges.some((edge) => edge.claimItemId !== decision.id)) {
    context.addIssue({
      code: "custom",
      message: "Final synthesis claim edges must belong to the saved decision",
    });
  }
});

export const FinalSynthesisSchema = DecisionResultSchema;

export const UnderwritingBatchSchema = z.strictObject({
  id: IdSchema,
  workspaceId: IdSchema,
  scanRunId: IdSchema,
  status: z.enum(["queued", "running", "partial", "completed", "failed"]),
  batchInputFingerprint: z.string().min(1),
  fundPolicySnapshotId: IdSchema,
  rerunOfId: IdSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});

export const UnderwritingQueueStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "partial",
  "failed",
]);

export const UnderwritingQueueEntrySchema = z.strictObject({
  batchId: IdSchema,
  dealId: IdSchema,
  priorityRank: z.number().int().positive(),
  status: UnderwritingQueueStatusSchema,
  candidateRunId: IdSchema,
  reason: z.string().trim().min(1).optional(),
}).superRefine((entry, context) => {
  if (
    (entry.status === "partial" || entry.status === "failed")
    && entry.reason === undefined
  ) {
    context.addIssue({
      code: "custom",
      path: ["reason"],
      message: "Partial and failed underwriting queue entries require a reason.",
    });
  }
});

/**
 * Read/write compatibility shape for the immutable historical persistence
 * model. New API and UI projections must use UnderwritingQueueEntrySchema.
 */
export const LegacyPinnedUnderwritingSelectionSchema = z.strictObject({
  batchId: IdSchema,
  dealId: IdSchema,
  status: z.enum(["selected", "not_selected"]),
  rank: z.number().int().positive().nullable(),
  reason: z.string().min(1),
}).superRefine((selection, context) => {
  if (
    (selection.status === "selected" && selection.rank === null)
    || (selection.status === "not_selected" && selection.rank !== null)
  ) {
    context.addIssue({
      code: "custom",
      message: "Selection rank must match selection status",
    });
  }
});

/** @deprecated Persistence compatibility only. */
export const UnderwritingSelectionSchema =
  LegacyPinnedUnderwritingSelectionSchema;

export const CandidateRunSchema = z.strictObject({
  id: IdSchema,
  batchId: IdSchema,
  workspaceId: IdSchema,
  dealId: IdSchema,
  status: z.enum([
    "queued",
    "running",
    "partial",
    "completed",
    "unavailable",
    "failed",
  ]),
  candidateAnalysisFingerprint: z.string().min(1),
  rerunOfId: IdSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  finalizedAt: IsoDateTimeSchema.nullable(),
});

export const CandidateProviderAttemptSchema = z.strictObject({
  attemptFingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  status: z.enum(["reserved", "completed", "failed", "aborted"]),
  reservedCostUnits: z.number().int().nonnegative(),
  reservedTokenUnits: z.number().int().nonnegative(),
  actualCostUnits: z.number().int().nonnegative().default(0),
  actualTokenUnits: z.number().int().nonnegative(),
  usageKnown: z.boolean().default(false),
});

export const CandidateCheckpointSchema = z.strictObject({
  candidateRunId: IdSchema,
  stage: z.enum([
    "evidence_pack",
    "context_router",
    "valuation",
    "framework_catalog",
    "framework_lenses",
    "decision",
    "narrative_drafts",
    "finalization",
  ]),
  status: z.enum(["running", "completed", "failed"]),
  inputFingerprint: z.string().min(1),
  outputFingerprint: z.string().min(1).nullable(),
  outputPayload: z.unknown().nullable(),
  attemptCount: z.number().int().nonnegative(),
  costUnits: z.number().int().nonnegative(),
  tokenUnits: z.number().int().nonnegative(),
  actualTokenUnits: z.number().int().nonnegative(),
  providerAttempts: z.array(CandidateProviderAttemptSchema),
  reasonCode: z.string().min(1).nullable(),
  publicReason: z.string().min(1).nullable(),
  savedAt: IsoDateTimeSchema,
});

export const XTraceLineageSnapshotSchema = z.strictObject({
  memoryIds: z.array(IdSchema),
  sourceRevisionIds: z.array(IdSchema),
  sourceIds: z.array(IdSchema),
  fixtureIds: z.array(IdSchema),
  capturedAt: IsoDateTimeSchema,
});

export const MissingEvidenceItemSchema = z.strictObject({
  fieldId: IdSchema,
  label: z.string().min(1),
  externalLabel: z.string().min(1),
  reasonCode: z.string().min(1),
  mostLikelyDecisionImpact: z.string().min(1),
});

export const LegacyActionDraftV1Schema = z.strictObject({
  id: IdSchema,
  workspaceId: IdSchema,
  candidateRunId: IdSchema,
  channel: z.enum([
    "email",
    "sms",
    "linkedin",
    "internal_memo",
    "dd_request",
  ]),
  audienceType: z.enum(["founder", "customer", "internal"]),
  body: z.string().min(1),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const ACTION_DRAFT_POLICY_VERSION =
  "status-safe-action-draft-v2" as const;

const EXTERNAL_ACTION_DRAFT_FORMATS = new Set([
  "founder_email",
  "founder_sms",
  "founder_linkedin",
  "diligence_request",
]);

type ExternalActionDraftFormat =
  | "founder_email"
  | "founder_sms"
  | "founder_linkedin"
  | "diligence_request";

export function canonicalExternalActionDraftBodies(input: {
  format: ExternalActionDraftFormat;
  missingEvidence: z.infer<typeof MissingEvidenceItemSchema>[];
}): string[] {
  if (input.missingEvidence.some(({ externalLabel }) =>
    externalLabel.includes("\n") || externalLabel.includes("\r")
  )) return [];
  const bulletLines = input.missingEvidence.length > 0
    ? input.missingEvidence.map(({ externalLabel }) => `- ${externalLabel}`)
    : ["- No additional evidence item is currently requested."];
  const inlineLabels = input.missingEvidence.length > 0
    ? input.missingEvidence.map(({ externalLabel }) => externalLabel).join("; ")
    : "no saved missing-evidence item";
  const requestLines = [
    "Please share the following current evidence for review:",
    ...bulletLines,
  ];
  switch (input.format) {
    case "founder_email": {
      const body = [
        "DRAFT ONLY — NOT SENT",
        ...requestLines,
        "This draft is limited to evidence collection and neutral sharing instructions.",
      ];
      return [
        ["Subject: Draft evidence follow-up", "", ...body].join("\n"),
        body.join("\n"),
      ];
    }
    case "founder_sms":
      return [
        `DRAFT ONLY — NOT SENT. Please share current evidence for review: ${inlineLabels}.`,
      ];
    case "founder_linkedin":
      return [["DRAFT ONLY — NOT SENT", ...requestLines].join("\n")];
    case "diligence_request":
      return [[
        "DUE DILIGENCE EVIDENCE REQUEST — DRAFT ONLY — NOT SENT",
        "",
        ...requestLines,
        "Please use a secure sharing method approved by your organization.",
      ].join("\n")];
  }
}

export function externalActionDraftBodySafetyViolations(input: {
  format: string;
  body: string;
  missingEvidence: z.infer<typeof MissingEvidenceItemSchema>[];
}): string[] {
  if (!EXTERNAL_ACTION_DRAFT_FORMATS.has(input.format)) return [];
  const allowedBodies = canonicalExternalActionDraftBodies({
    format: input.format as ExternalActionDraftFormat,
    missingEvidence: input.missingEvidence,
  });
  return allowedBodies.includes(input.body)
    ? []
    : [
      "External action draft body must match the format-specific neutral evidence-request grammar and exact saved missing-evidence labels.",
    ];
}

function hasPermanentDraftOnlyMarker(input: {
  format: string;
  body: string;
}): boolean {
  const lines = input.body.split("\n");
  switch (input.format) {
    case "internal_memo":
      return lines[0] === "INTERNAL UNDERWRITING ACTION MEMO — DRAFT ONLY";
    case "founder_email":
      return lines[0] === "DRAFT ONLY — NOT SENT"
        || (
          lines[0]?.startsWith("Subject:")
          && lines[1] === ""
          && lines[2] === "DRAFT ONLY — NOT SENT"
        );
    case "founder_sms":
      return input.body.startsWith("DRAFT ONLY — NOT SENT.");
    case "founder_linkedin":
      return lines[0] === "DRAFT ONLY — NOT SENT";
    case "diligence_request":
      return lines[0]
        === "DUE DILIGENCE EVIDENCE REQUEST — DRAFT ONLY — NOT SENT";
    default:
      return false;
  }
}

export const ActionDraftV2Schema = z.strictObject({
  schemaVersion: z.literal("action-draft-v2"),
  safety: z.literal("status_safe"),
  deliveryMode: z.literal("draft_only"),
  draftPolicyVersion: z.literal(ACTION_DRAFT_POLICY_VERSION),
  actionPolicyVersion: z.literal("belief-action-policy-v1"),
  id: IdSchema,
  workspaceId: IdSchema,
  candidateRunId: IdSchema,
  dealStatus: CanonicalDealStatusSchema,
  beliefDirection: BeliefChangeDirectionSchema,
  actions: z.array(BeliefActionSchema).min(1),
  missingEvidence: z.array(MissingEvidenceItemSchema),
  format: z.enum([
    "founder_email",
    "founder_sms",
    "founder_linkedin",
    "internal_memo",
    "diligence_request",
  ]),
  channel: z.enum(["email", "sms", "linkedin", "internal"]),
  audienceType: z.enum(["founder", "internal"]),
  body: z.string().min(1),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
}).superRefine((draft, context) => {
  const compatibility = {
    founder_email: ["email", "founder"],
    founder_sms: ["sms", "founder"],
    founder_linkedin: ["linkedin", "founder"],
    internal_memo: ["internal", "internal"],
    diligence_request: ["email", "founder"],
  } as const;
  const [channel, audienceType] = compatibility[draft.format];
  if (draft.channel !== channel || draft.audienceType !== audienceType) {
    context.addIssue({
      code: "custom",
      message: "Action draft format, channel, and audience are incompatible.",
    });
  }
  const expectedActions = actionsForDealStatusAndDirection(
    draft.dealStatus,
    draft.beliefDirection,
  );
  if (!beliefActionListsEqual(draft.actions, expectedActions)) {
    context.addIssue({
      code: "custom",
      message:
        "Action draft actions do not match the authoritative status policy.",
    });
  }
  const actionKinds = new Set(expectedActions.map(({ kind }) => kind));
  const allowedFormats = actionKinds.has("advance_diligence")
      || actionKinds.has("reopen_diligence")
    ? new Set([
      "internal_memo",
      "founder_email",
      "founder_sms",
      "founder_linkedin",
      "diligence_request",
    ])
    : actionKinds.has("evaluate_follow_on")
    ? new Set(["internal_memo", "founder_email", "diligence_request"])
    : new Set(["internal_memo"]);
  if (!allowedFormats.has(draft.format)) {
    context.addIssue({
      code: "custom",
      message:
        "Action draft format is not allowed by the authoritative status policy.",
    });
  }
  if (!hasPermanentDraftOnlyMarker(draft)) {
    context.addIssue({
      code: "custom",
      message:
        "Status-safe action drafts require the exact permanent DRAFT ONLY marker for their format.",
    });
  }
  if (externalActionDraftBodySafetyViolations(draft).length > 0) {
    context.addIssue({
      code: "custom",
      message:
        "External action drafts must use the format-specific neutral evidence-request grammar and exact saved missing-evidence labels.",
    });
  }
});

export const ActionDraftSchema = z.union([
  ActionDraftV2Schema,
  LegacyActionDraftV1Schema,
]);

/**
 * Read adapter for action-draft-v2 JSON persisted before missing-evidence
 * items gained an audience-safe external label. Canonical writes must continue
 * to use ActionDraftSchema directly.
 */
export function parseActionDraftRead(
  value: unknown,
): z.infer<typeof ActionDraftSchema> {
  const current = ActionDraftSchema.safeParse(value);
  if (current.success) return current.data;
  if (
    typeof value !== "object"
    || value === null
    || (value as Record<string, unknown>).schemaVersion !== "action-draft-v2"
    || !Array.isArray((value as Record<string, unknown>).missingEvidence)
  ) {
    throw current.error;
  }

  let adapted = false;
  const missingEvidence = (
    (value as Record<string, unknown>).missingEvidence as unknown[]
  ).map((item) => {
    if (
      typeof item !== "object"
      || item === null
      || Object.prototype.hasOwnProperty.call(item, "externalLabel")
    ) {
      return item;
    }
    adapted = true;
    return {
      ...item,
      externalLabel: (item as Record<string, unknown>).label,
    };
  });
  if (!adapted) throw current.error;

  return ActionDraftSchema.parse({
    ...value,
    missingEvidence,
  });
}

export type FundPolicySnapshot = z.infer<typeof FundPolicySnapshotSchema>;
export type ResolvedUnderwritingContext = z.infer<
  typeof ResolvedUnderwritingContextSchema
>;
export type FrameworkConfidence = z.infer<typeof FrameworkConfidenceSchema>;
export type FrameworkAdvisoryMetadata = z.infer<
  typeof FrameworkAdvisoryMetadataSchema
>;
export type CounterevidenceBoundary = z.infer<
  typeof CounterevidenceBoundarySchema
>;
export type LegacyFrameworkJudgment = z.infer<
  typeof LegacyFrameworkJudgmentSchema
>;
export type CurrentFrameworkJudgment = z.infer<
  typeof CurrentFrameworkJudgmentSchema
>;
export type FrameworkJudgment = z.infer<typeof FrameworkJudgmentSchema>;
export type FrameworkDisagreement = z.infer<
  typeof FrameworkDisagreementSchema
>;
export type ValuationEvaluation = z.infer<typeof ValuationEvaluationSchema>;
export type ScenarioInputField = z.infer<typeof ScenarioInputFieldSchema>;
export type ScenarioInput = z.infer<typeof ScenarioInputSchema>;
export type ScenarioModel = z.infer<typeof ScenarioModelSchema>;
export type DecisionResult = z.infer<typeof DecisionResultSchema>;
export type FinalSynthesis = DecisionResult;
export type UnderwritingBatch = z.infer<typeof UnderwritingBatchSchema>;
export type UnderwritingQueueStatus = z.infer<
  typeof UnderwritingQueueStatusSchema
>;
export type UnderwritingQueueEntry = z.infer<
  typeof UnderwritingQueueEntrySchema
>;
export type LegacyPinnedUnderwritingSelection = z.infer<
  typeof LegacyPinnedUnderwritingSelectionSchema
>;
export type UnderwritingSelection = z.infer<
  typeof UnderwritingSelectionSchema
>;
export type CandidateRun = z.infer<typeof CandidateRunSchema>;
export type CandidateCheckpoint = z.infer<typeof CandidateCheckpointSchema>;
export type CandidateProviderAttempt = z.infer<
  typeof CandidateProviderAttemptSchema
>;
export type XTraceLineageSnapshot = z.infer<
  typeof XTraceLineageSnapshotSchema
>;
export type MissingEvidenceItem = z.infer<typeof MissingEvidenceItemSchema>;
export type ActionDraft = z.infer<typeof ActionDraftSchema>;
export type ActionDraftV2 = z.infer<typeof ActionDraftV2Schema>;
