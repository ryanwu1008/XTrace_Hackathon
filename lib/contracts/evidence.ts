import { z } from "zod";

const IdSchema = z.string().min(1).refine(
  (value) => value.trim() === value,
  "IDs cannot have surrounding whitespace",
);
const IsoDateSchema = z.iso.date();
const IsoDateTimeSchema = z.iso.datetime({ offset: true });
const DecimalTextSchema = z.string().regex(
  /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/,
  "Expected a finite decimal string",
);

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

export type DecimalString = string & {
  readonly __decimalString: unique symbol;
};

export const DecimalStringSchema = DecimalTextSchema
  .transform((value) => value as DecimalString);

export const AnalysisTypeSchema = z.enum([
  "fact",
  "assumption",
  "calculation",
  "framework_judgment",
  "final_synthesis",
]);

export const ProvenanceOriginSchema = z.enum([
  "management",
  "uploaded_document",
  "public_source",
  "demo_fixture",
  "benchmark",
  "recommended_policy",
  "user_custom",
]);

export const EvidenceLocatorSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("text_range"),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    excerpt: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("pdf_page"),
    page: z.number().int().positive(),
    excerpt: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("image"),
    imageIndex: z.number().int().nonnegative(),
    region: z.tuple([
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
    ]).nullable(),
  }),
  z.strictObject({
    kind: z.literal("web_snapshot"),
    url: z.url(),
    excerpt: z.string().min(1),
  }),
]).superRefine((locator, context) => {
  if (locator.kind === "text_range" && locator.end <= locator.start) {
    context.addIssue({
      code: "custom",
      message: "Text range end must be greater than start",
    });
  }
});

export const MoneyValueSchema = z.strictObject({
  amount: DecimalStringSchema,
  currency: z.literal("USD"),
  scale: z.number().int().nonnegative(),
  asOfDate: IsoDateSchema,
});

export const RateValueSchema = z.strictObject({
  value: DecimalStringSchema,
  basis: z.literal("decimal"),
});

export const MultipleValueSchema = z.strictObject({
  value: DecimalStringSchema.refine(
    (value) => !value.startsWith("-") || /^-0(?:\.0*)?$/.test(value),
    "Multiple values cannot be negative",
  ),
  basis: z.literal("multiple"),
});

export const SourceRevisionSchema = z.strictObject({
  id: IdSchema,
  workspaceId: IdSchema,
  sourceId: IdSchema,
  revision: z.number().int().positive(),
  contentHash: z.string().min(1),
  objectKey: z.string().min(1),
  objectVersion: z.string().min(1),
  contentType: z.string().min(1),
  extractorId: IdSchema,
  extractorVersion: z.string().min(1),
  extractedAt: IsoDateTimeSchema,
  supersedesRevisionId: IdSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});

export const FactSchema = z.strictObject({
  id: IdSchema,
  analysisType: z.literal("fact"),
  provenanceOrigin: z.enum([
    "management",
    "uploaded_document",
    "public_source",
    "demo_fixture",
  ]),
  field: z.string().min(1),
  value: z.string().min(1),
  unit: z.string().min(1).nullable(),
  currency: z.string().min(1).nullable(),
  periodStart: IsoDateSchema.nullable(),
  periodEnd: IsoDateSchema.nullable(),
  publishedAt: IsoDateTimeSchema.nullable(),
  eventAt: IsoDateTimeSchema.nullable(),
  retrievedAt: IsoDateTimeSchema,
  sourceRevisionId: IdSchema,
  locator: EvidenceLocatorSchema,
  sourceRole: z.enum([
    "management",
    "first_party_filing",
    "independent_third_party",
  ]),
  assertionStatus: z.enum([
    "reported",
    "corroborated",
    "verified",
    "disputed",
  ]),
  verificationMethod: z.string().min(1).nullable(),
  freshness: z.enum(["current", "stale", "unknown"]),
  acceptedForGate: z.boolean(),
}).superRefine((fact, context) => {
  if (
    fact.periodStart !== null
    && fact.periodEnd !== null
    && fact.periodEnd < fact.periodStart
  ) {
    context.addIssue({
      code: "custom",
      message: "Fact period end cannot precede its start",
    });
  }
  if (
    fact.provenanceOrigin === "demo_fixture"
    && (
      fact.field !== "sample_decision_context"
      || !fact.value.startsWith("Sample decision record. ")
      || fact.acceptedForGate
      || fact.unit !== null
      || fact.currency !== null
      || fact.periodStart !== null
      || fact.periodEnd !== null
      || fact.publishedAt !== null
      || fact.sourceRole !== "management"
      || fact.assertionStatus !== "reported"
      || fact.verificationMethod !== "synthetic_sample_decision_record_v1"
    )
  ) {
    context.addIssue({
      code: "custom",
      message:
        "A synthetic Sample decision Fact must remain permanently labeled, non-gating, and context-only",
    });
  }
});

export const AssumptionSchema = z.strictObject({
  id: IdSchema,
  analysisType: z.literal("assumption"),
  provenanceOrigin: z.enum([
    "benchmark",
    "recommended_policy",
    "user_custom",
  ]),
  scenario: z.enum(["bear", "base", "bull", "all"]),
  field: z.string().min(1),
  value: z.string().min(1),
  unit: z.string().min(1).nullable(),
  rationale: z.string().min(1),
  inputRefIds: z.array(IdSchema),
  sensitivity: z.enum(["low", "medium", "high"]),
  requiresConfirmation: z.boolean(),
});

export const CalculationInputRefSchema = z.strictObject({
  itemId: IdSchema,
  value: z.string().min(1),
  type: z.enum(["fact", "assumption", "policy", "benchmark"]),
});

export const CalculationSchema = z.strictObject({
  id: IdSchema,
  analysisType: z.literal("calculation"),
  formulaId: IdSchema,
  formulaVersion: z.string().min(1),
  inputRefs: z.array(CalculationInputRefSchema),
  output: z.string().min(1),
  unit: z.string().min(1),
  currency: z.string().min(1).nullable(),
  period: z.string().min(1).nullable(),
  roundingPolicy: z.literal("half_even_display_only"),
  computedAt: IsoDateTimeSchema,
  status: z.enum([
    "completed",
    "not_applicable",
    "insufficient_input",
    "unsupported_terms",
    "invalid_domain",
    "stale_benchmark",
  ]),
});

export const ClaimEdgeSchema = z.strictObject({
  claimItemId: IdSchema,
  dependencyItemId: IdSchema,
  dependencyType: z.enum([
    "fact",
    "assumption",
    "calculation",
    "framework_judgment",
    "policy_ref",
    "benchmark_ref",
    "framework_ref",
  ]),
});

export const EvidenceConflictSchema = z.strictObject({
  id: IdSchema,
  field: z.string().min(1),
  leftFactId: IdSchema,
  rightFactId: IdSchema,
  materialityRuleId: IdSchema,
  material: z.boolean(),
  status: z.enum(["open", "resolved", "immaterial"]),
  resolutionFactId: IdSchema.nullable(),
  resolutionReason: z.string().min(1).nullable(),
}).superRefine((conflict, context) => {
  if (
    conflict.leftFactId === conflict.rightFactId
    || (conflict.status === "open" && !conflict.material)
    || (conflict.status === "immaterial" && conflict.material)
    || (
      conflict.status === "resolved"
      && (
        conflict.resolutionFactId === null
        || conflict.resolutionReason === null
      )
    )
    || (
      conflict.status === "open"
      && (
        conflict.resolutionFactId !== null
        || conflict.resolutionReason !== null
      )
    )
    || (
      conflict.status === "immaterial"
      && conflict.resolutionFactId !== null
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Conflict resolution fields must match resolution status",
    });
  }
});

export const EvidenceCoverageResultSchema = z.strictObject({
  minimumModelInputsComplete: z.boolean(),
  criticalEvidenceComplete: z.boolean(),
  missingFieldIds: z.array(IdSchema),
  blockingConflictIds: z.array(IdSchema),
  decisionCeiling: z.enum([
    "Pass",
    "Watch",
    "Advance",
    "Invest Candidate",
  ]).nullable(),
  underwritingStatus: z.enum(["available", "unavailable"]),
  reasonCodes: z.array(z.string().min(1)),
});

export const EvidencePackSchema = z.strictObject({
  id: IdSchema,
  version: z.number().int().positive(),
  workspaceId: IdSchema,
  dealId: IdSchema,
  asOfDate: IsoDateSchema,
  sourceRevisionIds: z.array(IdSchema),
  facts: z.array(FactSchema),
  assumptions: z.array(AssumptionSchema),
  conflicts: z.array(EvidenceConflictSchema),
  coverage: EvidenceCoverageResultSchema,
  createdAt: IsoDateTimeSchema,
}).superRefine((pack, context) => {
  const sourceRevisionIds = new Set(pack.sourceRevisionIds);
  const factIdList = pack.facts.map((fact) => fact.id);
  const assumptionIdList = pack.assumptions.map((assumption) => assumption.id);
  const conflictIdList = pack.conflicts.map((conflict) => conflict.id);
  const blockingConflictIds = pack.coverage.blockingConflictIds;
  const factIds = new Set(factIdList);

  if (
    hasDuplicates(pack.sourceRevisionIds)
    || hasDuplicates(factIdList)
    || hasDuplicates(assumptionIdList)
    || hasDuplicates([...factIdList, ...assumptionIdList])
    || hasDuplicates(conflictIdList)
    || hasDuplicates(blockingConflictIds)
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Source revisions, evidence items, conflicts, and blocking references must be unique",
    });
  }

  if (
    pack.facts.some(
      (fact) => !sourceRevisionIds.has(fact.sourceRevisionId),
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Every Fact must reference a SourceRevision in the pack",
    });
  }

  if (
    pack.conflicts.some((conflict) =>
      !factIds.has(conflict.leftFactId)
      || !factIds.has(conflict.rightFactId)
      || (
        conflict.resolutionFactId !== null
        && !factIds.has(conflict.resolutionFactId)
      )
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Conflict references must resolve to Facts in the pack",
    });
  }

  if (
    blockingConflictIds.some((id) => {
      const matches = pack.conflicts.filter((conflict) => conflict.id === id);
      return matches.length !== 1
        || matches[0].status !== "open"
        || !matches[0].material;
    })
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Blocking conflict IDs must each resolve to one material open conflict",
    });
  }
});

export type AnalysisType = z.infer<typeof AnalysisTypeSchema>;
export type ProvenanceOrigin = z.infer<typeof ProvenanceOriginSchema>;
export type EvidenceLocator = z.infer<typeof EvidenceLocatorSchema>;
export type MoneyValue = z.infer<typeof MoneyValueSchema>;
export type RateValue = z.infer<typeof RateValueSchema>;
export type MultipleValue = z.infer<typeof MultipleValueSchema>;
export type SourceRevision = z.infer<typeof SourceRevisionSchema>;
export type Fact = z.infer<typeof FactSchema>;
export type Assumption = z.infer<typeof AssumptionSchema>;
export type CalculationInputRef = z.infer<typeof CalculationInputRefSchema>;
export type Calculation = z.infer<typeof CalculationSchema>;
export type ClaimEdge = z.infer<typeof ClaimEdgeSchema>;
export type EvidenceConflict = z.infer<typeof EvidenceConflictSchema>;
export type EvidenceCoverageResult = z.infer<
  typeof EvidenceCoverageResultSchema
>;
export type EvidencePack = z.infer<typeof EvidencePackSchema>;
