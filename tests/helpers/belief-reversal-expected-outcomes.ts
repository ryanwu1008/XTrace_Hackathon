import { z } from "zod";

import {
  CanonicalActionKindSchema,
  type BeliefReversalResearchPackage,
} from "../../lib/belief-reversal/contracts";

const StableIdSchema = z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*_v\d+$/);
const NonEmptyStringSchema = z.string().trim().min(1);
const NonEmptyStringsSchema = z.array(NonEmptyStringSchema).min(1);

const ExpectedOutcomeCaseSchema = z.strictObject({
  caseId: StableIdSchema,
  companyName: NonEmptyStringSchema,
  expectedRelationship: z.enum(["satisfies_revisit_condition", "contradicts_revisit_condition"]),
  priorStatus: z.enum(["passed", "watchlist", "invested"]),
  direction: z.enum(["positive", "negative"]),
  priorAction: CanonicalActionKindSchema,
  expectedNewActions: z.array(CanonicalActionKindSchema).min(1),
  minimumConfidence: z.enum(["medium", "high"]),
  qualificationRationale: NonEmptyStringSchema,
  requiredOpenDiligence: NonEmptyStringsSchema,
  invalidatingEvidence: NonEmptyStringsSchema,
});

const ExpectedOutcomesSchema = z.strictObject({
  schemaVersion: z.literal("belief-reversal-expected-outcomes-v2"),
  packageId: z.literal("belief_reversal_2026_08_01"),
  usage: z.literal("test_and_review_only"),
  cases: z.array(ExpectedOutcomeCaseSchema).length(4),
}).superRefine((outcomes, context) => {
  if (new Set(outcomes.cases.map((item) => item.caseId)).size !== outcomes.cases.length) {
    context.addIssue({ code: "custom", message: "Expected outcome case IDs must be unique" });
  }
});

export type BeliefReversalExpectedOutcomes = z.infer<typeof ExpectedOutcomesSchema>;

export function parseBeliefReversalExpectedOutcomes(input: unknown): BeliefReversalExpectedOutcomes {
  return ExpectedOutcomesSchema.parse(input);
}

export function crossCheckBeliefReversalExpectedOutcomes(
  researchPackage: BeliefReversalResearchPackage,
  outcomes: BeliefReversalExpectedOutcomes,
): void {
  const requiredMatrix = new Map<string, { status: "passed" | "watchlist" | "invested"; direction: "positive" | "negative"; actions: readonly string[] }>([
    ["Henry AI", { status: "passed", direction: "positive", actions: ["reopen_diligence"] }],
    ["Smallest.ai", { status: "watchlist", direction: "positive", actions: ["advance_diligence"] }],
    ["Hush Security", { status: "invested", direction: "positive", actions: ["evaluate_follow_on"] }],
    ["Irregular", { status: "invested", direction: "negative", actions: ["pause_follow_on", "portfolio_risk_review"] }],
  ]);
  const manifestCases = new Map(researchPackage.selectedCases.map((item) => [item.id, item]));
  for (const outcome of outcomes.cases) {
    const selectedCase = manifestCases.get(outcome.caseId);
    if (!selectedCase || selectedCase.profile.brandName.value !== outcome.companyName) {
      throw new Error(`Expected outcome case ${outcome.caseId} does not resolve to the production manifest`);
    }
    const expected = requiredMatrix.get(outcome.companyName);
    if (
      selectedCase.priorDecision.status !== outcome.priorStatus ||
      selectedCase.priorDecision.priorAction !== outcome.priorAction ||
      !expected ||
      expected.status !== outcome.priorStatus ||
      expected.direction !== outcome.direction ||
      JSON.stringify(expected.actions) !== JSON.stringify(outcome.expectedNewActions)
    ) {
      throw new Error(`${outcome.companyName} expected-outcome matrix is invalid`);
    }
  }
  if (outcomes.cases.length !== manifestCases.size) throw new Error("Expected outcomes must cover exactly the production manifest cases");
}
