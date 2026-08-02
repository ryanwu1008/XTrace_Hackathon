import { z } from "zod";

const StableIdSchema = z.string().regex(
  /^[a-z0-9]+(?:_[a-z0-9]+)*_v\d+$/,
  "Stable ids must use lowercase snake case and end in a version suffix",
);
const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  (value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
  "Date must be a real ISO calendar date",
);
const IsoDateTimeSchema = z.iso.datetime({ offset: true });
const NonEmptyStringSchema = z.string().trim().min(1);
const NonEmptyStringsSchema = z.array(NonEmptyStringSchema).min(1);

const FingerprintInputsSchema = z.strictObject({
  canonicalUrl: z.string().url(),
  eventAt: IsoDateSchema,
  publishedAt: IsoDateSchema,
  publicationTimestamp: IsoDateTimeSchema.optional(),
  retrievedAt: IsoDateSchema,
  verbatimExcerpt: NonEmptyStringSchema,
});

const ResearchSourceSchema = z.strictObject({
  id: StableIdSchema,
  title: NonEmptyStringSchema,
  publisher: NonEmptyStringSchema,
  canonicalUrl: z.string().url(),
  sourceClass: z.enum([
    "company_press_release",
    "official_company_site",
    "official_documentation",
    "legal_terms",
    "incident_report",
    "investor_profile",
    "news_report",
    "company_profile",
  ]),
  sourceAuthority: z.enum(["primary", "secondary"]),
  evidenceRole: z.enum([
    "trigger",
    "corroborating",
    "background",
    "counterevidence",
    "conflict",
  ]),
  eventAt: IsoDateSchema,
  publishedAt: IsoDateSchema,
  publicationTimestamp: IsoDateTimeSchema.optional(),
  retrievedAt: IsoDateSchema,
  locator: NonEmptyStringSchema,
  verbatimExcerpt: NonEmptyStringSchema.refine(
    (value) => value.split(/\s+/u).length <= 25,
    "Verbatim excerpts are bounded to 25 words",
  ),
  normalizedStatement: NonEmptyStringSchema,
  claimIds: z.array(StableIdSchema).min(1),
  fingerprintInputs: FingerprintInputsSchema,
});

const PublicClaimSchema = z.strictObject({
  id: StableIdSchema,
  classification: z.literal("fact"),
  statement: NonEmptyStringSchema,
  reportingBasis: z.enum([
    "company_reported",
    "publisher_reported",
    "official_incident_report",
    "official_legal_terms",
    "third_party_profile",
  ]),
});

const TypedAnalysisItemSchema = z.strictObject({
  id: StableIdSchema,
  classification: z.enum([
    "assumption",
    "calculation",
    "framework_viewpoint",
    "inference",
  ]),
  statement: NonEmptyStringSchema,
  inputIds: z.array(StableIdSchema),
});

const PriorDecisionSchema = z.strictObject({
  id: StableIdSchema,
  occurredAt: IsoDateTimeSchema,
  provenance: z.literal("demo_fixture"),
  label: z.literal("Sample decision record"),
  status: z.enum(["passed", "watchlist", "invested"]),
  meetingSummary: NonEmptyStringSchema,
  decisionReason: NonEmptyStringSchema,
  concerns: NonEmptyStringsSchema,
  revisitConditions: NonEmptyStringsSchema,
  priorActions: NonEmptyStringsSchema,
});

const UnavailableMetricSchema = z.strictObject({
  availability: z.literal("unavailable"),
  reason: NonEmptyStringSchema,
});
const AvailableMetricSchema = z.strictObject({
  availability: z.literal("available"),
  value: z.number().finite(),
  unit: NonEmptyStringSchema,
  asOfDate: IsoDateSchema,
  sourceIds: z.array(StableIdSchema).min(1),
  reportingBasis: z.enum(["company_reported", "publisher_reported"]),
});
const MetricSchema = z.discriminatedUnion("availability", [
  UnavailableMetricSchema,
  AvailableMetricSchema,
]);

const FoundingDateSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("available"), value: NonEmptyStringSchema, sourceId: StableIdSchema }),
  z.strictObject({ status: z.literal("unavailable"), reason: NonEmptyStringSchema }),
  z.strictObject({
    status: z.literal("conflicting"),
    observations: z.array(z.strictObject({ value: NonEmptyStringSchema, sourceId: StableIdSchema })).min(2),
  }),
]);

const SourceDateConflictSchema = z.strictObject({
  description: NonEmptyStringSchema,
  values: z.array(IsoDateSchema).min(2),
  sourceIds: z.array(StableIdSchema).min(1),
});

const ResearchCaseSchema = z.strictObject({
  id: StableIdSchema,
  companyId: StableIdSchema,
  dealId: StableIdSchema,
  companyName: NonEmptyStringSchema,
  identityName: NonEmptyStringSchema,
  officialDomain: z.string().url(),
  founders: NonEmptyStringsSchema,
  stage: z.literal("series_a"),
  geography: z.enum(["us", "global"]),
  businessModel: z.enum(["b2b_saas", "enterprise_ai"]),
  foundingDate: FoundingDateSchema,
  sourceDateConflicts: z.array(SourceDateConflictSchema),
  priorDecision: PriorDecisionSchema,
  direction: z.enum(["positive", "negative"]),
  proposedActions: z.array(z.enum([
    "reopen_diligence",
    "advance_diligence",
    "evaluate_follow_on",
    "validate_channel_economics",
    "pause_follow_on",
    "portfolio_risk_review",
  ])).min(1),
  claims: z.array(PublicClaimSchema).min(1),
  sources: z.array(ResearchSourceSchema).min(2),
  counterevidenceSourceIds: z.array(StableIdSchema).min(1),
  unknowns: NonEmptyStringsSchema,
  metrics: z.strictObject({
    valuation: MetricSchema,
    arr: MetricSchema,
    retention: MetricSchema,
    customerCount: MetricSchema,
  }),
  assumptions: z.array(TypedAnalysisItemSchema.extend({ classification: z.literal("assumption") })),
  calculations: z.array(TypedAnalysisItemSchema.extend({ classification: z.literal("calculation") })),
  frameworkViewpoints: z.array(TypedAnalysisItemSchema.extend({ classification: z.literal("framework_viewpoint") })),
  inferences: z.array(TypedAnalysisItemSchema.extend({ classification: z.literal("inference") })).min(1),
  hiddenChainOfThought: z.literal(false),
});

const CandidateLedgerEntrySchema = z.strictObject({
  id: StableIdSchema,
  companyName: NonEmptyStringSchema,
  disposition: z.enum(["accepted", "rejected"]),
  reason: NonEmptyStringSchema,
  supersededReason: NonEmptyStringSchema.optional(),
  supersededBy: NonEmptyStringSchema.optional(),
});

export const BeliefReversalResearchPackageSchema = z.strictObject({
  schemaVersion: z.literal("belief-reversal-research-v1"),
  packageId: z.literal("belief_reversal_2026_08_01"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  retrievalDate: IsoDateSchema,
  historicalCutoffDate: IsoDateSchema,
  evidenceWindow: z.strictObject({
    startAt: IsoDateTimeSchema,
    endAt: IsoDateTimeSchema,
    timezone: z.literal("America/Los_Angeles"),
    displayLabel: z.literal("Demo evidence snapshot as of 2026-08-01"),
  }),
  selectedCases: z.array(ResearchCaseSchema).length(4),
  candidateLedger: z.array(CandidateLedgerEntrySchema).min(11),
}).superRefine((researchPackage, context) => {
  const windowStart = researchPackage.evidenceWindow.startAt.slice(0, 10);
  const windowEnd = researchPackage.evidenceWindow.endAt.slice(0, 10);
  if (researchPackage.historicalCutoffDate >= windowStart) {
    context.addIssue({ code: "custom", message: "Historical cutoff must predate the evidence window" });
  }

  const allIds: string[] = [];
  const selectedNames = new Set<string>();
  for (const selectedCase of researchPackage.selectedCases) {
    selectedNames.add(selectedCase.companyName);
    allIds.push(
      selectedCase.id,
      selectedCase.companyId,
      selectedCase.dealId,
      selectedCase.priorDecision.id,
      ...selectedCase.claims.map((claim) => claim.id),
      ...selectedCase.sources.map((source) => source.id),
      ...selectedCase.assumptions.map((item) => item.id),
      ...selectedCase.calculations.map((item) => item.id),
      ...selectedCase.frameworkViewpoints.map((item) => item.id),
      ...selectedCase.inferences.map((item) => item.id),
    );

    const sourceIds = new Set(selectedCase.sources.map((source) => source.id));
    const claimIds = new Set(selectedCase.claims.map((claim) => claim.id));
    const supportedClaimIds = new Set<string>();
    const triggerSources = selectedCase.sources.filter((source) => source.evidenceRole === "trigger");
    if (triggerSources.length === 0) {
      context.addIssue({ code: "custom", message: `${selectedCase.companyName} requires a trigger source` });
    }
    if (!selectedCase.sources.some((source) => source.sourceAuthority === "primary")) {
      context.addIssue({ code: "custom", message: `${selectedCase.companyName} requires a primary source` });
    }
    if (!selectedCase.sources.some((source) => source.evidenceRole === "counterevidence")) {
      context.addIssue({ code: "custom", message: `${selectedCase.companyName} requires counterevidence` });
    }

    for (const source of selectedCase.sources) {
      if (source.publishedAt > researchPackage.retrievalDate || source.retrievedAt !== researchPackage.retrievalDate) {
        context.addIssue({ code: "custom", message: `${source.id} violates the retrieval cutoff` });
      }
      if (source.eventAt > researchPackage.retrievalDate) {
        context.addIssue({ code: "custom", message: `${source.id} has a future event date` });
      }
      if (source.evidenceRole === "trigger" && (source.eventAt < windowStart || source.eventAt > windowEnd)) {
        context.addIssue({ code: "custom", message: `${source.id} falls outside the evidence window` });
      }
      if (
        source.fingerprintInputs.canonicalUrl !== source.canonicalUrl ||
        source.fingerprintInputs.eventAt !== source.eventAt ||
        source.fingerprintInputs.publishedAt !== source.publishedAt ||
        source.fingerprintInputs.retrievedAt !== source.retrievedAt ||
        source.fingerprintInputs.verbatimExcerpt !== source.verbatimExcerpt
      ) {
        context.addIssue({ code: "custom", message: `${source.id} fingerprint inputs do not match its immutable source fields` });
      }
      for (const claimId of source.claimIds) {
        if (!claimIds.has(claimId)) {
          context.addIssue({ code: "custom", message: `${source.id} references unknown claim ${claimId}` });
        }
        supportedClaimIds.add(claimId);
      }
    }
    for (const claimId of claimIds) {
      if (!supportedClaimIds.has(claimId)) {
        context.addIssue({ code: "custom", message: `${claimId} has no source support` });
      }
    }
    for (const sourceId of selectedCase.counterevidenceSourceIds) {
      const source = selectedCase.sources.find((candidate) => candidate.id === sourceId);
      if (!source || source.evidenceRole !== "counterevidence") {
        context.addIssue({ code: "custom", message: `${sourceId} is not a counterevidence source` });
      }
    }
    for (const conflict of selectedCase.sourceDateConflicts) {
      if (conflict.sourceIds.some((sourceId) => !sourceIds.has(sourceId))) {
        context.addIssue({ code: "custom", message: `${selectedCase.companyName} has an unresolved date-conflict source id` });
      }
    }
    if (
      selectedCase.priorDecision.occurredAt.slice(0, 10) > researchPackage.historicalCutoffDate ||
      triggerSources.some((source) => selectedCase.priorDecision.occurredAt.slice(0, 10) >= source.eventAt)
    ) {
      context.addIssue({ code: "custom", message: `${selectedCase.companyName} prior decision must predate its triggers` });
    }
  }

  if (new Set(allIds).size !== allIds.length) {
    context.addIssue({ code: "custom", message: "All package identities must be globally unique" });
  }
  if (selectedNames.size !== researchPackage.selectedCases.length) {
    context.addIssue({ code: "custom", message: "Selected company identities must be unique" });
  }

  const ledgerNames = new Set(researchPackage.candidateLedger.map((entry) => entry.companyName));
  if (ledgerNames.size !== researchPackage.candidateLedger.length) {
    context.addIssue({ code: "custom", message: "Candidate ledger identities must be unique" });
  }
  const acceptedNames = researchPackage.candidateLedger
    .filter((entry) => entry.disposition === "accepted")
    .map((entry) => entry.companyName);
  if (acceptedNames.length !== selectedNames.size || acceptedNames.some((name) => !selectedNames.has(name))) {
    context.addIssue({ code: "custom", message: "Accepted ledger entries must exactly match selected cases" });
  }
  for (const requiredRejectedName of [
    "Centralize",
    "ChipAgents",
    "Sent",
    "Cascade",
    "Cordant",
    "Empirical Security",
    "Freight Hero",
  ]) {
    if (!researchPackage.candidateLedger.some((entry) => (
      entry.companyName === requiredRejectedName && entry.disposition === "rejected"
    ))) {
      context.addIssue({ code: "custom", message: `Candidate ledger is missing rejected ${requiredRejectedName}` });
    }
  }
});

export type BeliefReversalResearchPackage = Readonly<z.infer<typeof BeliefReversalResearchPackageSchema>>;

export function parseBeliefReversalManifest(input: unknown): BeliefReversalResearchPackage {
  return deepFreeze(BeliefReversalResearchPackageSchema.parse(input));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
