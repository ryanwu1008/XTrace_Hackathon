import { z } from "zod";

import {
  assertConsistentCanonicalEvidenceUnits,
  MarketEventV2Schema,
  SAMPLE_DECISION_RECORD_LABEL,
  SourceRefV2Schema,
  sourceClaimSupportKind,
  sourceTextForRetrieval,
  uniqueByCanonicalId,
  type MarketEventV2,
  type SourceRefV2,
} from "./source-evidence";

export const ProvenanceSchema = z.enum([
  "source_document",
  "public_web",
  "demo_fixture",
  "model_inference",
]);

export const DealStatusSchema = z.preprocess(
  (value) => value === "interested" ? "watchlist" : value,
  z.enum(["screening", "watchlist", "evaluating", "passed", "invested"]),
);

export const DEMO_FIXTURE_LABEL = SAMPLE_DECISION_RECORD_LABEL;

export const RunStatusSchema = z.enum([
  "queued",
  "running",
  "partial",
  "completed",
  "failed",
]);

export const SourceRefSchema = z.object({
  id: z.string().min(1),
  provenance: ProvenanceSchema,
  title: z.string().min(1),
  url: z.string().url().optional(),
  documentId: z.string().min(1).optional(),
  page: z.number().int().positive().optional(),
  publisher: z.string().min(1).optional(),
  publishedAt: z.string().datetime().optional(),
  excerpt: z.string().min(1),
  sourceRevisionId: z.string().min(1).optional(),
});

function declaresSchemaVersion(value: unknown): boolean {
  return typeof value === "object"
    && value !== null
    && "schemaVersion" in value;
}

export const EvidenceSourceRefSchema = z.unknown().transform(
  (value, context): SourceRefV2 | z.infer<typeof SourceRefSchema> => {
    const parsed = declaresSchemaVersion(value)
      ? SourceRefV2Schema.safeParse(value)
      : SourceRefSchema.safeParse(value);
    if (!parsed.success) {
      context.addIssue({
        code: "custom",
        message: "Evidence source does not satisfy its declared schema version",
      });
      return z.NEVER;
    }
    return parsed.data;
  },
);

export const ClaimSupportV2Schema = z.strictObject({
  text: z.string().min(1),
  kind: z.enum(["exact_quote", "normalized_non_quote"]),
  sourceIds: z.array(z.string().min(1)).min(1),
}).superRefine((support, context) => {
  if (new Set(support.sourceIds).size !== support.sourceIds.length) {
    context.addIssue({
      code: "custom",
      message: "Claim support source IDs must be unique",
    });
  }
});

type ParsedEvidenceSource = SourceRefV2 | z.infer<typeof SourceRefSchema>;

function validateSourcePayloads(
  sources: readonly ParsedEvidenceSource[],
  context: z.RefinementCtx,
): void {
  try {
    uniqueByCanonicalId(sources, "evidence source");
    assertConsistentCanonicalEvidenceUnits(
      sources.flatMap((source): SourceRefV2[] =>
        "schemaVersion" in source ? [source] : []
      ),
    );
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error
        ? error.message
        : "Evidence source IDs must resolve to one canonical payload",
    });
  }
}

function validateClaimSupport(
  sources: readonly ParsedEvidenceSource[],
  supports: readonly z.infer<typeof ClaimSupportV2Schema>[],
  context: z.RefinementCtx,
): void {
  validateSourcePayloads(sources, context);
  const byId = new Map(sources.map((source) => [source.id, source]));
  for (const support of supports) {
    const kinds = support.sourceIds.map((sourceId) => {
      const source = byId.get(sourceId);
      if (!source || !("schemaVersion" in source)) return null;
      return sourceClaimSupportKind(source, support.text);
    });
    if (kinds.some((kind) => kind === null)) {
      context.addIssue({
        code: "custom",
        message:
          "Claim support must resolve to eligible canonical evidence containing the claim text",
      });
      continue;
    }
    const requiredKind = kinds.includes("normalized_non_quote")
      ? "normalized_non_quote"
      : "exact_quote";
    if (support.kind !== requiredKind) {
      context.addIssue({
        code: "custom",
        message:
          "Claim support kind must match the strictest support available from every cited source",
      });
    }
  }
}

function canonicalSampleDecisionSourceIds(
  sources: readonly ParsedEvidenceSource[],
): Set<string> {
  return new Set(sources.flatMap((source) =>
    "schemaVersion" in source
      && source.adaptation === "canonical"
      && source.provenance === "demo_fixture"
      ? [source.id]
      : []
  ));
}

function sameStringSet(
  left: readonly string[],
  right: ReadonlySet<string>,
): boolean {
  return new Set(left).size === left.length
    && left.length === right.size
    && left.every((value) => right.has(value));
}

export const DealFactSchema = z.object({
  text: z.string().min(1),
  sources: z.array(EvidenceSourceRefSchema).min(1),
});

export const DealInteractionSchema = z.object({
  id: z.string().min(1),
  occurredAt: z.string().datetime(),
  summary: z.string().min(1),
  decisionReason: z.string().min(1),
  concerns: z.array(z.string()),
  revisitConditions: z.array(z.string()),
  provenance: z.literal("demo_fixture"),
  label: z.literal(DEMO_FIXTURE_LABEL),
});

export const DealMemoryBundleSchema = z.object({
  dealId: z.string().min(1),
  companyName: z.string().min(1),
  status: DealStatusSchema,
  facts: z.array(DealFactSchema),
  interactions: z.array(DealInteractionSchema),
});

export const MarketEventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  eventType: z.string().min(1),
  sectors: z.array(z.string()),
  themes: z.array(z.string()),
  summary: z.string().min(1),
  positiveImplications: z.array(z.string()),
  negativeImplications: z.array(z.string()),
  publishedAt: z.string().datetime(),
  confidence: z.enum(["low", "medium", "high"]),
  sources: z.array(SourceRefSchema).min(1),
});

export const OpportunityReportItemSchema = z.object({
  rank: z.number().int().min(1).max(5),
  dealId: z.string().min(1),
  confidence: z.enum(["medium", "high"]),
  score: z.number().min(0).max(1),
  whyNow: z.string().min(1),
  previousContext: z.string().min(1),
  implications: z.object({
    positive: z.array(z.string()),
    negative: z.array(z.string()),
  }),
  nextStep: z.string().min(1),
  sources: z.array(EvidenceSourceRefSchema).min(1),
  demoFixtureIds: z.array(z.string()),
  claimSupport: z.array(ClaimSupportV2Schema).optional(),
}).superRefine((opportunity, context) => {
  validateClaimSupport(
    opportunity.sources,
    opportunity.claimSupport ?? [],
    context,
  );
  const fixtureSourceIds = canonicalSampleDecisionSourceIds(
    opportunity.sources,
  );
  if (!sameStringSet(opportunity.demoFixtureIds, fixtureSourceIds)) {
    context.addIssue({
      code: "custom",
      message:
        "Opportunity fixture IDs must uniquely and exactly resolve to canonical Sample decision record sources",
    });
  }
});

export const CompanyAnalysisOutcomeSchema = z.enum([
  "belief_revised",
  "monitor",
  "no_material_change",
  "analysis_unavailable",
]);

export const CompanyAnalysisConfidenceSchema = z.enum([
  "low",
  "medium",
  "high",
]);

export const EvidenceFieldSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1).nullable(),
  unavailableReason: z
    .literal("Not available in current evidence")
    .nullable(),
  sourceIds: z.array(z.string().min(1)),
}).superRefine((field, context) => {
  if (
    field.value !== null
    && (field.unavailableReason !== null || field.sourceIds.length === 0)
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Available evidence fields require source IDs and no unavailable reason",
    });
  }

  if (
    field.value === null
    && (
      field.unavailableReason !== "Not available in current evidence"
      || field.sourceIds.length !== 0
    )
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Unavailable evidence fields require the fixed unavailable label and no source IDs",
    });
  }
});

const NO_RECORDED_MEETING = "No previous meeting summary was recorded.";
const NO_RECORDED_DECISION = "No previous decision reason was recorded.";
const MEMORY_ANALYSIS_UNAVAILABLE =
  "Analysis unavailable because XTrace did not return verified investment memory for this company.";

export const InvestmentMemorySnapshotSchema = z.object({
  previousMeetingSummary: z.string().min(1),
  decisionReason: z.string().min(1),
  concerns: z.array(z.string().min(1)),
  revisitConditions: z.array(z.string().min(1)),
  lastEvaluatedAt: z.string().datetime().nullable(),
  memoryIds: z.array(z.string().min(1)),
  sourceIds: z.array(z.string().min(1)),
  fixtureIds: z.array(z.string().min(1)),
});

const LegacyCompanyMarketEvidenceEventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  eventType: z.string().min(1),
  publishedAt: z.string().datetime(),
  sourceIds: z.array(z.string().min(1)).min(1),
});

export const CompanyMarketEvidenceEventSchema = z.unknown().transform(
  (
    value,
    context,
  ): MarketEventV2 | z.infer<typeof LegacyCompanyMarketEvidenceEventSchema> => {
    const parsed = declaresSchemaVersion(value)
      ? MarketEventV2Schema.safeParse(value)
      : LegacyCompanyMarketEvidenceEventSchema.safeParse(value);
    if (!parsed.success) {
      context.addIssue({
        code: "custom",
        message:
          "Market evidence event does not satisfy its declared schema version",
      });
      return z.NEVER;
    }
    return parsed.data;
  },
);

export const CompanyMarketEvidenceSchema = z.object({
  relationship: z.enum([
    "satisfies",
    "contradicts",
    "related",
    "none",
    "unavailable",
  ]),
  explanation: z.string().min(1),
  eventIds: z.array(z.string().min(1)),
  events: z.array(CompanyMarketEvidenceEventSchema),
  sourceIds: z.array(z.string().min(1)),
}).superRefine((evidence, context) => {
  const eventIds = new Set(evidence.events.map((event) => event.id));
  if (
    evidence.eventIds.some((eventId) => !eventIds.has(eventId))
    || evidence.events.some((event) => !evidence.eventIds.includes(event.id))
  ) {
    context.addIssue({
      code: "custom",
      message: "Market evidence event IDs must match the embedded event records",
    });
  }

  const eventSourceIds = evidence.events.flatMap((event) => (
    "schemaVersion" in event
      ? event.sources.map((source) => source.id)
      : event.sourceIds
  ));
  const canonicalEvents = evidence.events.every((event) =>
    "schemaVersion" in event && event.adaptation === "canonical"
  );
  const eventIdSet = new Set(evidence.eventIds);
  const eventSourceIdSet = new Set(eventSourceIds);
  const evidenceSourceIdSet = new Set(evidence.sourceIds);
  if (
    canonicalEvents
    && (
      eventIdSet.size !== evidence.eventIds.length
      || eventIdSet.size !== evidence.events.length
      || evidenceSourceIdSet.size !== evidence.sourceIds.length
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Canonical market evidence event and source IDs must be unique",
    });
  }
  const canonicalSetsDiffer = canonicalEvents
    && (
      eventSourceIdSet.size !== evidenceSourceIdSet.size
      || [...eventSourceIdSet].some((sourceId) =>
        !evidenceSourceIdSet.has(sourceId)
      )
    );
  const legacyEventSourceMissing = !canonicalEvents
    && eventSourceIds.some((sourceId) => !evidenceSourceIdSet.has(sourceId));
  if (canonicalSetsDiffer || legacyEventSourceMissing) {
    context.addIssue({
      code: "custom",
      message: canonicalEvents
        ? "Canonical market evidence sources must exactly match embedded event sources"
        : "Market event sources must be included in market evidence sources",
    });
  }

  if (
    (evidence.relationship === "none" || evidence.relationship === "unavailable")
    && (
      evidence.eventIds.length > 0
      || evidence.events.length > 0
      || evidence.sourceIds.length > 0
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "No or unavailable market evidence cannot contain market events",
    });
  }
});

export const CompanyRiskSchema = z.object({
  severity: z.enum(["low", "medium", "high"]),
  title: z.string().min(1),
  detail: z.string().min(1),
  nextQuestion: z.string().min(1),
  sourceIds: z.array(z.string().min(1)).min(1),
});

export const CompanyBriefSchema = z.object({
  icSnapshot: z.array(EvidenceFieldSchema),
  traction: z.array(EvidenceFieldSchema),
  dealTerms: z.array(EvidenceFieldSchema),
  risks: z.array(CompanyRiskSchema),
  decisionHistory: z.array(z.object({
    occurredAt: z.string().datetime(),
    title: z.string().min(1),
    summary: z.string().min(1),
    sourceIds: z.array(z.string().min(1)).min(1),
  })),
  sourceLineage: z.array(EvidenceSourceRefSchema),
});

export const CompanyAnalysisSchema = z.object({
  id: z.string().min(1),
  reportId: z.string().min(1),
  runId: z.string().uuid(),
  dealId: z.string().min(1),
  companyName: z.string().min(1),
  dealStatus: DealStatusSchema,
  outcome: CompanyAnalysisOutcomeSchema,
  confidence: CompanyAnalysisConfidenceSchema,
  score: z.number().min(0).max(1),
  verifiedSourceCount: z.number().int().nonnegative(),
  investmentMemory: InvestmentMemorySnapshotSchema,
  marketEvidence: CompanyMarketEvidenceSchema,
  implications: z.object({
    positive: z.array(z.string().min(1)),
    negative: z.array(z.string().min(1)),
  }),
  claimSupport: z.array(ClaimSupportV2Schema).optional(),
  recommendedNextMove: z.string().min(1),
  companyBrief: CompanyBriefSchema,
  sources: z.array(EvidenceSourceRefSchema),
  createdAt: z.string().datetime({ offset: true }),
}).superRefine((analysis, context) => {
  if (
    analysis.outcome === "belief_revised"
    && analysis.confidence === "low"
  ) {
    context.addIssue({
      code: "custom",
      message: "Belief revisions require medium or high confidence",
    });
  }

  if (
    analysis.outcome === "no_material_change"
    && analysis.confidence !== "low"
  ) {
    context.addIssue({
      code: "custom",
      message: "No-material-change analyses must use low confidence",
    });
  }

  if (
    analysis.outcome !== "analysis_unavailable"
    && analysis.sources.length === 0
  ) {
    context.addIssue({
      code: "custom",
      message: "Completed company analyses require source lineage",
    });
  }

  const sourceIds = new Set(analysis.sources.map((source) => source.id));
  if (
    analysis.verifiedSourceCount !== sourceIds.size
    || analysis.marketEvidence.sourceIds.some((id) => !sourceIds.has(id))
    || (analysis.claimSupport ?? []).some((support) =>
      support.sourceIds.some((id) => !sourceIds.has(id))
    )
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Verified source counts and market evidence must match analysis lineage",
    });
  }

  const embeddedEventSources = analysis.marketEvidence.events.flatMap(
    (event): ParsedEvidenceSource[] =>
      "schemaVersion" in event ? [...event.sources] : [],
  );
  validateSourcePayloads([
    ...analysis.sources,
    ...embeddedEventSources,
    ...analysis.companyBrief.sourceLineage,
  ], context);
  validateClaimSupport(
    analysis.sources,
    analysis.claimSupport ?? [],
    context,
  );

  const briefSourceIds = [
    ...analysis.companyBrief.icSnapshot,
    ...analysis.companyBrief.traction,
    ...analysis.companyBrief.dealTerms,
    ...analysis.companyBrief.risks,
    ...analysis.companyBrief.decisionHistory,
  ].flatMap((item) => item.sourceIds);

  const memorySourceIds = analysis.investmentMemory.sourceIds;
  const lineageSourceIds = analysis.companyBrief.sourceLineage.map(
    (source) => source.id,
  );
  if (
    [...briefSourceIds, ...memorySourceIds, ...lineageSourceIds]
      .some((id) => !sourceIds.has(id))
  ) {
    context.addIssue({
      code: "custom",
      message: "All company claims must resolve to the analysis source lineage",
    });
  }

  const fixtureIds = analysis.investmentMemory.fixtureIds;
  const fixtureIdSet = new Set(fixtureIds);
  const analysisSampleIds = canonicalSampleDecisionSourceIds(analysis.sources);
  const briefLineageIds = new Set(lineageSourceIds);
  if (
    !sameStringSet(fixtureIds, analysisSampleIds)
    || fixtureIds.some((fixtureId) =>
      !memorySourceIds.includes(fixtureId) || !briefLineageIds.has(fixtureId)
    )
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Investment-memory fixture IDs must uniquely resolve to canonical Sample decision record lineage",
    });
  }
  if (fixtureIds.length === 0) {
    const fixedNoRecord =
      analysis.investmentMemory.previousMeetingSummary === NO_RECORDED_MEETING
      && analysis.investmentMemory.decisionReason === NO_RECORDED_DECISION;
    const fixedUnavailable =
      analysis.investmentMemory.previousMeetingSummary
          === MEMORY_ANALYSIS_UNAVAILABLE
      && analysis.investmentMemory.decisionReason
          === MEMORY_ANALYSIS_UNAVAILABLE;
    if (
      analysis.investmentMemory.lastEvaluatedAt !== null
      || analysis.investmentMemory.concerns.length !== 0
      || analysis.investmentMemory.revisitConditions.length !== 0
      || analysis.companyBrief.decisionHistory.length !== 0
      || (!fixedNoRecord && !fixedUnavailable)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Investment memory without a Sample decision record may only use the fixed no-record payload",
      });
    }
  } else if (analysis.investmentMemory.lastEvaluatedAt === null) {
    context.addIssue({
      code: "custom",
      message: "Sample decision records require an evaluation date",
    });
  }
  if (analysis.companyBrief.decisionHistory.some((item) =>
    item.sourceIds.some((sourceId) => !fixtureIdSet.has(sourceId))
  )) {
    context.addIssue({
      code: "custom",
      message:
        "Decision history must resolve only to linked Sample decision records",
    });
  }
});

export const ReportAnalysisStatusSchema = z.enum(["completed", "incomplete"]);

export const CompanyAnalysisCountsSchema = z.object({
  companyCount: z.number().int().nonnegative(),
  beliefRevised: z.number().int().nonnegative(),
  monitor: z.number().int().nonnegative(),
  noMaterialChange: z.number().int().nonnegative(),
  analysisUnavailable: z.number().int().nonnegative(),
});

export const EvidenceCoverageSchema = z.object({
  acceptedPublicEvents: z.number().int().nonnegative(),
  excludedPublicItems: z.number().int().nonnegative(),
  truncatedPublicEvents: z.number().int().nonnegative(),
  recalledDealCount: z.number().int().nonnegative(),
  unavailableDealCount: z.number().int().nonnegative(),
  structuredImageFallbackDealCount: z.number().int().nonnegative().optional(),
});

export type Provenance = z.infer<typeof ProvenanceSchema>;
export type DealStatus = z.infer<typeof DealStatusSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type SourceRef = z.infer<typeof SourceRefSchema>;
export type EvidenceSourceRef = z.infer<typeof EvidenceSourceRefSchema>;
export type ClaimSupportV2 = z.infer<typeof ClaimSupportV2Schema>;
export type DealFact = z.infer<typeof DealFactSchema>;
export type DealInteraction = z.infer<typeof DealInteractionSchema>;
export type DealMemoryBundle = z.infer<typeof DealMemoryBundleSchema>;
export type MarketEvent = z.infer<typeof MarketEventSchema>;
export type OpportunityReportItem = z.infer<typeof OpportunityReportItemSchema>;
export type CompanyAnalysisOutcome = z.infer<
  typeof CompanyAnalysisOutcomeSchema
>;
export type CompanyAnalysisConfidence = z.infer<
  typeof CompanyAnalysisConfidenceSchema
>;
export type EvidenceField = z.infer<typeof EvidenceFieldSchema>;
export type InvestmentMemorySnapshot = z.infer<
  typeof InvestmentMemorySnapshotSchema
>;
export type CompanyMarketEvidence = z.infer<
  typeof CompanyMarketEvidenceSchema
>;
export type CompanyRisk = z.infer<typeof CompanyRiskSchema>;
export type CompanyBrief = z.infer<typeof CompanyBriefSchema>;
export type CompanyAnalysis = z.infer<typeof CompanyAnalysisSchema>;

export function evidenceSourceText(source: EvidenceSourceRef): string {
  return "schemaVersion" in source
    ? sourceTextForRetrieval(source)
    : source.excerpt;
}
export type ReportAnalysisStatus = z.infer<
  typeof ReportAnalysisStatusSchema
>;
export type CompanyAnalysisCounts = z.infer<
  typeof CompanyAnalysisCountsSchema
>;
export type EvidenceCoverage = z.infer<typeof EvidenceCoverageSchema>;
