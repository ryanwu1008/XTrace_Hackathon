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

/** Explicit review standard applied when authoring each taxonomy row. */
export const DECISION_TAXONOMY_SEMANTIC_CRITERIA = {
  market_structure: "Market shape, competition, category boundaries, and durable demand.",
  product_differentiation: "Product capabilities, technical advantages, and defensibility of the offering.",
  customer_adoption: "Observed customer behavior, demand, retention, willingness to pay, and adoption evidence.",
  founder_team_execution: "Founders, leaders, team behavior, incentives, and organizational execution.",
  operating_model: "Repeatable operating processes, resource allocation, and delivery mechanics.",
  unit_economics: "Incremental revenue, cost, margin, payback, and profitability mechanics.",
  financing_valuation: "Ownership, dilution, security terms, price, valuation, financing, and return economics.",
  governance: "Oversight, controls, accountability, fiduciary process, and decision rights.",
  security: "Information security, privacy, technical risk controls, and regulatory security obligations.",
  portfolio_risk: "Fund-level concentration, reserves, follow-on allocation, and portfolio exposure.",
} as const satisfies Record<DecisionQuestionCode, string>;

export const EVIDENCE_DOMAIN_SEMANTIC_CRITERIA = {
  market: "Market size, structure, competition, and demand evidence.",
  product: "Product behavior, capabilities, quality, and technical evidence.",
  customer: "Customer behavior, feedback, retention, and purchase evidence.",
  distribution: "Channels, go-to-market, acquisition, and reach evidence.",
  team: "Founder, executive, employee, and organization evidence.",
  operations: "Operating process, delivery, and execution evidence.",
  financial_performance: "Reported financial outcomes and performance evidence.",
  unit_economics: "Incremental revenue, cost, margin, and payback evidence.",
  financing_terms: "Security, capitalization, ownership, and financing agreement evidence.",
  valuation: "Price, valuation, return, and exit-value evidence.",
  governance: "Oversight, controls, accountability, and decision-right evidence.",
  security: "Security, privacy, and technical-control evidence.",
  regulatory: "Legal, regulatory, and compliance evidence.",
  portfolio_risk: "Fund concentration, reserve, and portfolio exposure evidence.",
} as const satisfies Record<EvidenceDomainCode, string>;

const decisionTaxonomy = deepFreeze(DecisionTaxonomyDocumentSchema.parse(
  rawDecisionTaxonomy,
));
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

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
