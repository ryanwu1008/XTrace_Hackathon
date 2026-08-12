import { z } from "zod";

import {
  CompanyEvidenceSegmentSchema,
  ConditionalConclusionSegmentSchema,
  CountercaseSegmentSchema,
  FrameworkPremiseSegmentSchema,
  NamedLensAdvisoryContractSchema,
  NamedLensPassageFocusSchema,
  UnknownBoundarySegmentSchema,
} from "../contracts/named-lens";
import {
  CounterevidenceBoundarySchema,
} from "../contracts/underwriting";

const BoundedObservationScoreSchema = z.coerce.number().min(0).max(1);

export const ClaudeReasonedMatchSchema = z.strictObject({
  dealId: z.string().min(1),
  whyNow: z.string().min(1),
  previousContext: z.string().min(1),
  positiveImplications: z.array(z.string()),
  negativeImplications: z.array(z.string()),
  selectedTriggerEventId: z.string().min(1),
  selectedPriorInteractionId: z.string().min(1),
  revisitConditionIndex: z.number().int().nonnegative(),
  revisitConditionText: z.string().min(1),
  revisitCitedSourceIds: z.array(z.string().min(1)).min(1),
  counterevidence: z.strictObject({
    statement: z.string().min(1),
    citedSourceIds: z.array(z.string().min(1)).min(1),
  }),
  citedSourceIds: z.array(z.string()).min(1),
  scoreInputs: z.strictObject({
    eventRelevance: BoundedObservationScoreSchema,
    dealRelevance: BoundedObservationScoreSchema,
    priorContextStrength: BoundedObservationScoreSchema,
    evidenceQuality: BoundedObservationScoreSchema,
  }),
  claimSourceIds: z.record(z.string(), z.array(z.string()).min(1)),
});

export const ClaudeReasonedMatchesSchema = z.array(ClaudeReasonedMatchSchema)
  .max(30);

export type ClaudeReasonedMatch = z.infer<typeof ClaudeReasonedMatchSchema>;

export const ClaudeChatClaimSchema = z.object({
  text: z.string().min(1),
  sourceIds: z.array(z.string()).min(1),
});

export const ClaudeChatAnswerSchema = z.object({
  claims: z.array(ClaudeChatClaimSchema),
  insufficientEvidence: z.boolean(),
});

const FrameworkIdSchema = z.string().min(1).refine(
  (value) => value.trim() === value,
  "Framework IDs cannot have surrounding whitespace",
);
const FrameworkConfidenceLevelSchema = z.enum(["low", "medium", "high"]);

const ClaudeFrameworkLensOutputShape = {
  applicability: z.enum(["applicable", "not_applicable"]),
  conclusion: z.enum(["supportive", "mixed", "negative", "abstain"]),
  supportEvidenceItemIds: z.array(FrameworkIdSchema),
  counterEvidenceItemIds: z.array(FrameworkIdSchema),
  unusedEvidenceItemIds: z.array(FrameworkIdSchema),
  strongestSupport: z.string().min(1).nullable(),
  strongestCounterargument: z.string().min(1).nullable(),
  unknowns: z.array(z.string().min(1)).min(1),
  limitations: z.array(z.string().min(1)),
  confidence: z.strictObject({
    sourceReliability: FrameworkConfidenceLevelSchema,
    evidenceStrength: FrameworkConfidenceLevelSchema,
    evidenceCoverage: FrameworkConfidenceLevelSchema,
    applicability: FrameworkConfidenceLevelSchema,
    judgment: FrameworkConfidenceLevelSchema,
  }),
  frameworkRuleRefs: z.array(FrameworkIdSchema).min(1),
} as const;

export const ClaudeFrameworkLensOutputBaseSchema = z.strictObject(
  ClaudeFrameworkLensOutputShape,
);

const NamedLensProviderFocusSchema = z.strictObject({
  componentFrameworkId:
    NamedLensPassageFocusSchema.shape.componentFrameworkId,
  componentVersion: NamedLensPassageFocusSchema.shape.componentVersion,
  cardFieldRef: NamedLensPassageFocusSchema.shape.cardFieldRef,
  decisionQuestionCode:
    NamedLensPassageFocusSchema.shape.decisionQuestionCode,
  evidenceDomainCodes:
    NamedLensPassageFocusSchema.shape.evidenceDomainCodes,
}).superRefine((value, context) => {
  if (!isCanonicalStrings(value.evidenceDomainCodes)) {
    context.addIssue({
      code: "custom",
      message: "Named Lens focus evidence-domain codes must be unique and UTF-8 sorted.",
    });
  }
});

export const NamedLensPassageCandidateSchema = z.strictObject({
  focus: NamedLensProviderFocusSchema,
  premise: FrameworkPremiseSegmentSchema,
  caseApplication: CompanyEvidenceSegmentSchema,
  countercase: CountercaseSegmentSchema,
  unknownBoundary: UnknownBoundarySegmentSchema,
  conditionalConclusion: ConditionalConclusionSegmentSchema,
  advisoryContract: NamedLensAdvisoryContractSchema,
}).superRefine((value, context) => {
  if (
    value.focus.componentFrameworkId !== value.premise.componentFrameworkId
    || value.focus.componentVersion !== value.premise.componentVersion
    || value.focus.cardFieldRef !== value.premise.cardFieldRef
  ) {
    context.addIssue({
      code: "custom",
      message: "Named Lens focus must exactly match its premise Card binding.",
    });
  }
});

export const ClaudeFrameworkLensOutputSchema =
  ClaudeFrameworkLensOutputBaseSchema.superRefine((output, context) => {
    validateNonApplicableFrameworkLensOutput(output, context);
    validateAbstainingFrameworkLensOutput(output, context);
    if (
      output.applicability === "applicable"
      && (
        output.conclusion !== "abstain"
        && (
          output.supportEvidenceItemIds.length === 0
          || output.counterEvidenceItemIds.length === 0
          || output.strongestSupport === null
          || output.strongestCounterargument === null
        )
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "An applicable framework lens requires a bounded conclusion with grounded support and counterevidence",
      });
    }
  });

export const ClaudeAdvisoryFrameworkJudgmentOutputSchema =
  ClaudeFrameworkLensOutputBaseSchema.extend({
    counterevidenceBoundary: CounterevidenceBoundarySchema,
  }).strict().superRefine(validateAdvisoryFrameworkJudgmentOutput);

export const ClaudeAdvisoryFrameworkLensOutputSchema =
  ClaudeFrameworkLensOutputBaseSchema.extend({
    counterevidenceBoundary: CounterevidenceBoundarySchema,
    passage: NamedLensPassageCandidateSchema,
  }).strict().superRefine((output, context) => {
    validateAdvisoryFrameworkJudgmentOutput(output, context);
    if (
      output.counterevidenceBoundary.kind
        !== output.passage.countercase.boundaryKind
      || !sameStrings(
        output.counterevidenceBoundary.evidenceRequestRefs,
        output.passage.countercase.evidenceRequestRefs,
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Advisory passage counterevidence boundary must match the judgment boundary.",
      });
    }
  });

function validateNonApplicableFrameworkLensOutput(
  output: z.infer<typeof ClaudeFrameworkLensOutputBaseSchema>,
  context: z.core.$RefinementCtx,
): void {
  if (
    output.applicability === "not_applicable"
    && (
      output.conclusion !== "abstain"
      || output.supportEvidenceItemIds.length > 0
      || output.counterEvidenceItemIds.length > 0
      || output.strongestSupport !== null
      || output.strongestCounterargument !== null
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "A non-applicable framework lens must abstain without claims",
    });
  }
}

function validateAbstainingFrameworkLensOutput(
  output: z.infer<typeof ClaudeFrameworkLensOutputBaseSchema>,
  context: z.core.$RefinementCtx,
): void {
  if (
    output.conclusion === "abstain"
    && (
      output.supportEvidenceItemIds.length > 0
      || output.counterEvidenceItemIds.length > 0
      || output.strongestSupport !== null
      || output.strongestCounterargument !== null
      || Object.values(output.confidence).some((level) => level !== "low")
    )
  ) {
    context.addIssue({
      code: "custom",
      message:
        "An abstaining framework lens cannot make evidence claims or claim confidence above low",
    });
  }
}

function validateAdvisoryFrameworkJudgmentOutput(
  output: z.infer<typeof ClaudeFrameworkLensOutputBaseSchema> & {
    counterevidenceBoundary: z.infer<typeof CounterevidenceBoundarySchema>;
  },
  context: z.core.$RefinementCtx,
): void {
  validateNonApplicableFrameworkLensOutput(output, context);
  validateAbstainingFrameworkLensOutput(output, context);
  if (output.conclusion === "abstain") {
    if (
      output.counterevidenceBoundary.kind
        !== "no_candidate_local_counterevidence"
      || output.counterevidenceBoundary.evidenceRequestRefs.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message:
          "An abstaining advisory lens requires an explicit candidate-local evidence request boundary.",
      });
    }
    return;
  }
  if (output.applicability !== "applicable") return;
  const groundedCounterevidence = output.counterEvidenceItemIds.length > 0;
  if (
    output.supportEvidenceItemIds.length === 0
    || output.strongestSupport === null
    || (
      groundedCounterevidence
        ? output.strongestCounterargument === null
          || output.counterevidenceBoundary.kind
            !== "grounded_counterevidence"
          || output.counterevidenceBoundary.evidenceRequestRefs.length > 0
        : output.strongestCounterargument !== null
          || output.counterevidenceBoundary.kind
            !== "no_candidate_local_counterevidence"
          || output.counterevidenceBoundary.evidenceRequestRefs.length === 0
    )
  ) {
    context.addIssue({
      code: "custom",
      message:
        "An applicable advisory lens requires grounded support and either grounded counterevidence or an exact evidence-request boundary.",
    });
  }
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function isCanonicalStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length
    && values.every((value, index) =>
      index === 0
      || Buffer.compare(
        Buffer.from(values[index - 1]!, "utf8"),
        Buffer.from(value, "utf8"),
      ) < 0
    );
}

/*
 * Keep this type below the validators so Zod can infer the complete strict
 * one-call artifact without making the provider's passage metadata authoritative
 * for deterministic selection.
 */
export type NamedLensPassageCandidate = z.infer<
  typeof NamedLensPassageCandidateSchema
>;
export type ClaudeAdvisoryFrameworkJudgmentOutput = z.infer<
  typeof ClaudeAdvisoryFrameworkJudgmentOutputSchema
>;
export type ClaudeAdvisoryFrameworkLensOutput = z.infer<
  typeof ClaudeAdvisoryFrameworkLensOutputSchema
>;

export type ClaudeFrameworkLensOutput = z.infer<
  typeof ClaudeFrameworkLensOutputSchema
>;
