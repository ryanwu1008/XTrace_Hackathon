import { z } from "zod";

/**
 * Browser-safe Decision Taxonomy contract.
 *
 * Keep Node-only hashing and the authored taxonomy document in
 * decision-taxonomy.ts. Client-rendered report schemas import this module so
 * Vite never pulls `node:crypto` into the browser bundle.
 */
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

export function taxonomyIdentity(
  frameworkId: string,
  cardFieldRef: string,
): string {
  return `${frameworkId}\u0000${cardFieldRef}`;
}
