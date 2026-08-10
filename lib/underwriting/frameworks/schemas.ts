import { z } from "zod";

import {
  FrameworkAdvisoryMetadataSchema,
} from "../../contracts/underwriting";

export {
  ClaudeAdvisoryFrameworkJudgmentOutputSchema,
  ClaudeAdvisoryFrameworkLensOutputSchema,
  ClaudeFrameworkLensOutputBaseSchema,
  ClaudeFrameworkLensOutputSchema,
  NamedLensPassageCandidateSchema,
  type ClaudeAdvisoryFrameworkJudgmentOutput,
  type ClaudeAdvisoryFrameworkLensOutput,
  type ClaudeFrameworkLensOutput,
  type NamedLensPassageCandidate,
} from "../../claude/schemas";

const IdSchema = z.string().min(1).refine(
  (value) => value.trim() === value,
  "IDs cannot have surrounding whitespace",
);

export const SyntheticFrameworkCardSchema = z.strictObject({
  id: IdSchema,
  version: z.string().min(1),
  title: z.string().min(1),
  synthetic: z.boolean(),
  publicationStatus: z.enum(["draft", "published", "retired"]),
  attribution: z.string().min(1),
  approvedNeutralParaphrase: z.string().min(1),
  locator: z.string().min(1),
  limitations: z.array(z.string().min(1)),
  rightsStatus: z.string().min(1),
  formalDecisionWeight: z.string().min(1),
});

export const ExperimentalAdvisoryMetadataSchema =
  FrameworkAdvisoryMetadataSchema;

export const ExperimentalAdvisoryFrameworkCardSchema = z.strictObject({
  id: IdSchema,
  version: z.string().min(1),
  title: z.string().min(1),
  synthetic: z.literal(false),
  publicationStatus: z.literal("unpublished"),
  attribution: z.string().min(1),
  approvedNeutralParaphrase: z.string().min(1),
  locator: z.string().min(1),
  limitations: z.array(z.string().min(1)),
  rightsStatus: z.literal("public_source_paraphrase"),
  formalDecisionWeight: z.literal("0"),
  executionMode: z.literal("experimental_advisory"),
  experimentalAdvisory: ExperimentalAdvisoryMetadataSchema,
});

export const FrameworkCardSchema = z.union([
  SyntheticFrameworkCardSchema,
  ExperimentalAdvisoryFrameworkCardSchema,
]);

export type FrameworkCard = z.infer<typeof FrameworkCardSchema>;
export type ExperimentalAdvisoryFrameworkCard = z.infer<
  typeof ExperimentalAdvisoryFrameworkCardSchema
>;

export function isExperimentalAdvisoryFrameworkCard(
  card: FrameworkCard,
): card is ExperimentalAdvisoryFrameworkCard {
  return "executionMode" in card
    && card.executionMode === "experimental_advisory";
}
