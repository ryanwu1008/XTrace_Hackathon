import { createHash } from "node:crypto";

import { z } from "zod";

import rawDecisionTaxonomy from "../../../research/framework-authoring/decision-question-taxonomy.v1.json";

export const DECISION_TAXONOMY_VERSION =
  "named-lens-decision-taxonomy-v1" as const;

export const DecisionQuestionCodeSchema = z.enum([
  "market_structure", "product_differentiation", "customer_adoption",
  "founder_team_execution", "operating_model", "unit_economics",
  "financing_valuation", "governance", "security", "portfolio_risk",
]);

export const EvidenceDomainCodeSchema = z.enum([
  "market", "product", "customer", "distribution", "team", "operations",
  "financial_performance", "unit_economics", "financing_terms", "valuation",
  "governance", "security", "regulatory", "portfolio_risk",
]);

export const DecisionTaxonomyBindingSchema = z.strictObject({
  frameworkId: z.string().min(1),
  cardFieldRef: z.string().regex(/^decisionQuestions\[[0-9]+\]$/),
  questionText: z.string().min(1),
  decisionQuestionCode: DecisionQuestionCodeSchema,
  evidenceDomainCodes: z.array(EvidenceDomainCodeSchema).min(1),
});

export const DecisionTaxonomyDocumentSchema = z.strictObject({
  schemaVersion: z.literal(DECISION_TAXONOMY_VERSION),
  bindings: z.array(DecisionTaxonomyBindingSchema),
});

export type DecisionQuestionCode = z.infer<typeof DecisionQuestionCodeSchema>;
export type EvidenceDomainCode = z.infer<typeof EvidenceDomainCodeSchema>;
export type DecisionTaxonomyBinding = z.infer<
  typeof DecisionTaxonomyBindingSchema
>;
export type DecisionTaxonomyDocument = z.infer<
  typeof DecisionTaxonomyDocumentSchema
>;

const decisionTaxonomy = DecisionTaxonomyDocumentSchema.parse(
  rawDecisionTaxonomy,
);
validateIntrinsicTaxonomy(decisionTaxonomy.bindings);
const bindingByIdentity = new Map(
  decisionTaxonomy.bindings.map((binding) => [
    taxonomyIdentity(binding.frameworkId, binding.cardFieldRef),
    binding,
  ]),
);

export const DECISION_TAXONOMY_DIGEST = decisionTaxonomyDigest(decisionTaxonomy);

export function decisionTaxonomyBindings(): readonly DecisionTaxonomyBinding[] {
  return decisionTaxonomy.bindings;
}

export function resolveDecisionTaxonomy(
  frameworkId: string,
  cardFieldRef: string,
): DecisionTaxonomyBinding {
  const binding = bindingByIdentity.get(taxonomyIdentity(frameworkId, cardFieldRef));
  if (!binding) {
    throw new Error(
      `Decision taxonomy has no binding for ${frameworkId} ${cardFieldRef}.`,
    );
  }
  return binding;
}

export function validateDecisionTaxonomyForCards(
  cards: readonly {
    frameworkId: string;
    decisionQuestions: readonly string[];
  }[],
  document: DecisionTaxonomyDocument = decisionTaxonomy,
): readonly DecisionTaxonomyBinding[] {
  validateIntrinsicTaxonomy(document.bindings);
  const expected = cards.flatMap((card) =>
    card.decisionQuestions.map((questionText, index) => ({
      frameworkId: card.frameworkId,
      cardFieldRef: `decisionQuestions[${index}]`,
      questionText,
    }))
  ).sort((left, right) => compareUtf8(
    taxonomyIdentity(left.frameworkId, left.cardFieldRef),
    taxonomyIdentity(right.frameworkId, right.cardFieldRef),
  ));
  const expectedByIdentity = new Map(
    expected.map((binding) => [
      taxonomyIdentity(binding.frameworkId, binding.cardFieldRef),
      binding,
    ]),
  );
  const selected = document.bindings.filter((binding) =>
    expectedByIdentity.has(taxonomyIdentity(binding.frameworkId, binding.cardFieldRef))
  );

  if (selected.length !== document.bindings.length) {
    throw new Error("Decision taxonomy contains a binding for an unknown Framework Card or field.");
  }
  if (selected.length !== expected.length) {
    throw new Error("Every Framework Card decision question requires exactly one decision taxonomy binding.");
  }
  for (const binding of selected) {
    const expectedBinding = expectedByIdentity.get(
      taxonomyIdentity(binding.frameworkId, binding.cardFieldRef),
    );
    if (!expectedBinding || binding.questionText !== expectedBinding.questionText) {
      throw new Error("Decision taxonomy question text must exactly match its Framework Card decision question.");
    }
  }
  return selected;
}

export function decisionTaxonomyDigest(
  document: DecisionTaxonomyDocument,
): string {
  return sha256(document);
}

export function taxonomyIdentity(
  frameworkId: string,
  cardFieldRef: string,
): string {
  return `${frameworkId}\u0000${cardFieldRef}`;
}

function validateIntrinsicTaxonomy(
  bindings: readonly DecisionTaxonomyBinding[],
): void {
  for (let index = 1; index < bindings.length; index += 1) {
    const previous = bindings[index - 1]!;
    const current = bindings[index]!;
    if (
      compareUtf8(
        taxonomyIdentity(previous.frameworkId, previous.cardFieldRef),
        taxonomyIdentity(current.frameworkId, current.cardFieldRef),
      ) >= 0
    ) {
      throw new Error(
        "Decision taxonomy rows must be unique and UTF-8 sorted by framework ID and Card field reference.",
      );
    }
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

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
