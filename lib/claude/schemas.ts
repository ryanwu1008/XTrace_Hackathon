import { z } from "zod";

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
  .max(20);

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

export const ClaudeFrameworkLensOutputSchema = z.strictObject({
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
}).superRefine((output, context) => {
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
  if (
    output.applicability === "applicable"
    && (
      output.conclusion === "abstain"
      || output.supportEvidenceItemIds.length === 0
      || output.counterEvidenceItemIds.length === 0
      || output.strongestSupport === null
      || output.strongestCounterargument === null
    )
  ) {
    context.addIssue({
      code: "custom",
      message:
        "An applicable framework lens requires a bounded conclusion with grounded support and counterevidence",
    });
  }
});

export type ClaudeFrameworkLensOutput = z.infer<
  typeof ClaudeFrameworkLensOutputSchema
>;
