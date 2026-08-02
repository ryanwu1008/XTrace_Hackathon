import { z } from "zod";

import {
  MarketEventV2Schema,
  SourceRefV2Schema,
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

export const DEMO_FIXTURE_LABEL = "Sample decision record" as const;

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
});

export const DealFactSchema = z.object({
  text: z.string().min(1),
  sources: z.array(SourceRefSchema).min(1),
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
  if (eventSourceIds.some((sourceId) => !evidence.sourceIds.includes(sourceId))) {
    context.addIssue({
      code: "custom",
      message: "Market event sources must be included in market evidence sources",
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
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Verified source counts and market evidence must match analysis lineage",
    });
  }

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
export type ReportAnalysisStatus = z.infer<
  typeof ReportAnalysisStatusSchema
>;
export type CompanyAnalysisCounts = z.infer<
  typeof CompanyAnalysisCountsSchema
>;
export type EvidenceCoverage = z.infer<typeof EvidenceCoverageSchema>;
