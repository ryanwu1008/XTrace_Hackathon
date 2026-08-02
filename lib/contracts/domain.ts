import { z } from "zod";

import {
  assertConsistentCanonicalEvidenceUnits,
  MarketEventV2Schema,
  SAMPLE_DECISION_RECORD_LABEL,
  SourceRefV2Schema,
  TemporalValueV2Schema,
  sourceClaimSupportKind,
  sourceTextForRetrieval,
  uniqueByCanonicalId,
  type MarketEventV2,
  type SourceRefV2,
} from "./source-evidence";
import {
  buildOpportunityScoreBreakdown,
  type OpportunityScoreInputs,
} from "../matching/scoring";
import {
  beliefRevisionGateResultsEqual,
  evaluateBeliefRevisionHardGates,
} from "../matching/hard-gates";
import {
  beliefActionListsEqual,
  metadataForBeliefActionKind,
  renderRecommendedNextMove,
} from "../reports/action-policy";

export const ProvenanceSchema = z.enum([
  "source_document",
  "public_web",
  "demo_fixture",
  "model_inference",
]);

export const CanonicalDealStatusSchema = z.enum([
  "screening",
  "watchlist",
  "evaluating",
  "passed",
  "invested",
]);

export const DealStatusSchema = z.preprocess(
  (value) => value === "interested" ? "watchlist" : value,
  CanonicalDealStatusSchema,
);

export const BeliefChangeDirectionSchema = z.enum([
  "positive",
  "mixed",
  "negative",
  "none",
  "unavailable",
]);

export const BeliefActionKindSchema = z.enum([
  "advance_diligence",
  "continue_monitoring",
  "deprioritize",
  "reopen_diligence",
  "evaluate_follow_on",
  "pause_follow_on",
  "portfolio_risk_review",
  "no_new_action",
  "review_analysis_failure",
]);
export const BeliefActionScopeSchema = z.enum([
  "deal",
  "portfolio",
  "analysis",
]);
export const BeliefActionPrioritySchema = z.enum(["high", "standard"]);
export const BeliefActionVisibilitySchema = z.literal("internal_only");

export const BeliefActionSchema = z.strictObject({
  kind: BeliefActionKindSchema,
  scope: BeliefActionScopeSchema,
  priority: BeliefActionPrioritySchema,
  visibility: BeliefActionVisibilitySchema,
}).superRefine((action, context) => {
  const expected = metadataForBeliefActionKind(action.kind);
  if (
    action.scope !== expected.scope
    || action.priority !== expected.priority
    || action.visibility !== expected.visibility
  ) {
    context.addIssue({
      code: "custom",
      message: "Belief action metadata must be derived from its action kind",
    });
  }
});

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
  priorActions: z.array(BeliefActionSchema).min(1).optional(),
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

const ScoreDimensionSchema = z.number().min(0).max(1);

export const OpportunityScoreBreakdownSchema = z.strictObject({
  eventRelevance: ScoreDimensionSchema,
  dealRelevance: ScoreDimensionSchema,
  priorContextStrength: ScoreDimensionSchema,
  evidenceQuality: ScoreDimensionSchema,
  finalScore: z.number().min(0).max(1),
  confidence: CompanyAnalysisConfidenceSchema,
}).superRefine((score, context) => {
  const input: OpportunityScoreInputs = {
    eventRelevance: score.eventRelevance,
    dealRelevance: score.dealRelevance,
    priorContextStrength: score.priorContextStrength,
    evidenceQuality: score.evidenceQuality,
  };
  const expected = buildOpportunityScoreBreakdown(input);
  if (score.finalScore !== expected.finalScore) {
    context.addIssue({
      code: "custom",
      message: "Final score must equal the deterministic weighted calculation",
    });
  }
  if (score.confidence !== expected.confidence) {
    context.addIssue({
      code: "custom",
      message: "Score confidence must equal the deterministic score boundary",
    });
  }
});

const GateFailureReasonSchema = z.string().trim().min(1).max(500).nullable();

function validateGateFailureReason(
  gate: { passed: boolean; failureReason: string | null },
  context: z.RefinementCtx,
): void {
  if (
    (gate.passed && gate.failureReason !== null)
    || (!gate.passed && gate.failureReason === null)
  ) {
    context.addIssue({
      code: "custom",
      message: "Passed gates require no failure reason and failed gates require one",
    });
  }
}

export const ChronologyGateResultSchema = z.strictObject({
  priorInteractionId: z.string().min(1).nullable(),
  priorInteractionAt: z.string().datetime({ offset: true }).nullable(),
  triggerEventId: z.string().min(1).nullable(),
  triggerEventAt: TemporalValueV2Schema.nullable(),
  passed: z.boolean(),
  failureReason: GateFailureReasonSchema,
}).superRefine((gate, context) => {
  validateGateFailureReason(gate, context);
});

export const RevisitConditionMappingGateResultSchema = z.strictObject({
  priorInteractionId: z.string().min(1).nullable(),
  revisitConditionIndex: z.number().int().nonnegative().nullable(),
  revisitConditionText: z.string().min(1).nullable(),
  triggerEventId: z.string().min(1).nullable(),
  citedSourceIds: z.array(z.string().min(1)),
  passed: z.boolean(),
  failureReason: GateFailureReasonSchema,
}).superRefine((gate, context) => {
  validateGateFailureReason(gate, context);
  if (
    gate.passed
    && (
      gate.priorInteractionId === null
      || gate.revisitConditionIndex === null
      || gate.revisitConditionText === null
      || gate.triggerEventId === null
      || gate.citedSourceIds.length === 0
      || new Set(gate.citedSourceIds).size !== gate.citedSourceIds.length
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "A passed revisit gate requires exact unique lineage bindings",
    });
  }
});

export const CounterevidenceGateResultSchema = z.strictObject({
  statement: z.string().max(2_000),
  citedSourceIds: z.array(z.string().min(1)),
  passed: z.boolean(),
  failureReason: GateFailureReasonSchema,
}).superRefine((gate, context) => {
  validateGateFailureReason(gate, context);
});

export const ActionDeltaGateResultSchema = z.strictObject({
  priorActions: z.array(BeliefActionSchema).min(1),
  proposedActions: z.array(BeliefActionSchema).min(1),
  passed: z.boolean(),
  failureReason: GateFailureReasonSchema,
}).superRefine(validateGateFailureReason);

export const BeliefRevisionGateResultsSchema = z.strictObject({
  chronology: ChronologyGateResultSchema,
  revisitConditionMapping: RevisitConditionMappingGateResultSchema,
  counterevidence: CounterevidenceGateResultSchema,
  actionDelta: ActionDeltaGateResultSchema,
  allPassed: z.boolean(),
}).superRefine((gates, context) => {
  const expected = gates.chronology.passed
    && gates.revisitConditionMapping.passed
    && gates.counterevidence.passed
    && gates.actionDelta.passed;
  if (gates.allPassed !== expected) {
    context.addIssue({
      code: "custom",
      message: "allPassed must be derived from every named hard gate",
    });
  }
});

export const BELIEF_CHANGE_ASSESSMENT_SCHEMA_VERSION =
  "belief-change-assessment-v1" as const;

export const AuthoritativeBeliefGateContextSchema = z.strictObject({
  priorInteraction: z.strictObject({
    id: z.string().min(1),
    occurredAt: z.string().datetime({ offset: true }),
    sourceIds: z.array(z.string().min(1)).length(1),
    revisitConditions: z.array(z.string().min(1)).min(1),
    priorActions: z.array(BeliefActionSchema).min(1),
    provenance: z.literal("demo_fixture"),
    label: z.literal(DEMO_FIXTURE_LABEL),
  }),
  triggerEvent: z.strictObject({
    id: z.string().min(1),
    eventAt: TemporalValueV2Schema,
    sourceIds: z.array(z.string().min(1)).min(1),
  }),
  sources: z.array(SourceRefV2Schema).min(1),
}).superRefine((gateContext, context) => {
  const sourceIds = new Set(gateContext.sources.map((source) => source.id));
  const priorSource = gateContext.sources.find(
    (source) => source.id === gateContext.priorInteraction.sourceIds[0],
  );
  if (
    gateContext.sources.some((source) => source.adaptation !== "canonical")
    || sourceIds.size !== gateContext.sources.length
    || new Set(gateContext.triggerEvent.sourceIds).size
      !== gateContext.triggerEvent.sourceIds.length
    || gateContext.triggerEvent.sourceIds.some((id) => !sourceIds.has(id))
    || gateContext.priorInteraction.sourceIds[0]
      !== gateContext.priorInteraction.id
    || priorSource === undefined
    || priorSource.adaptation !== "canonical"
    || priorSource.provenance !== "demo_fixture"
    || priorSource.title !== DEMO_FIXTURE_LABEL
    || priorSource.evidenceRole !== "context"
    || priorSource.eventAt !== gateContext.priorInteraction.occurredAt
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Authoritative gate context requires unique canonical trigger sources and an exact Sample decision record source binding",
    });
  }
  validateSourcePayloads(gateContext.sources, context);
});

export const BeliefChangeAssessmentV1Schema = z.strictObject({
  schemaVersion: z.literal(BELIEF_CHANGE_ASSESSMENT_SCHEMA_VERSION),
  dealStatus: CanonicalDealStatusSchema,
  direction: BeliefChangeDirectionSchema,
  scoreBreakdown: OpportunityScoreBreakdownSchema,
  gateContext: AuthoritativeBeliefGateContextSchema,
  gates: BeliefRevisionGateResultsSchema,
  actions: z.array(BeliefActionSchema).min(1),
}).superRefine((assessment, context) => {
  try {
    const recomputed = evaluateBeliefRevisionHardGates({
      priorInteraction: assessment.gateContext.priorInteraction,
      triggerEvent: assessment.gateContext.triggerEvent,
      sources: assessment.gateContext.sources,
      revisitMapping: assessment.gates.revisitConditionMapping,
      counterevidence: assessment.gates.counterevidence,
      dealStatus: assessment.dealStatus,
      direction: assessment.direction,
      proposedActions: assessment.actions,
    });
    if (beliefRevisionGateResultsEqual(assessment.gates, recomputed)) return;
  } catch {
    // Nested schema issues and runtime policy validation both fail this boundary.
  }
  context.addIssue({
    code: "custom",
    message:
      "Every persisted hard gate must exactly equal its deterministic recomputation from authoritative context",
  });
});

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
  priorActions: z.array(BeliefActionSchema).min(1).optional(),
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

const CompanyAnalysisObjectSchema = z.object({
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
  beliefAssessment: BeliefChangeAssessmentV1Schema.optional(),
  recommendedNextMove: z.string().min(1),
  companyBrief: CompanyBriefSchema,
  sources: z.array(EvidenceSourceRefSchema),
  createdAt: z.string().datetime({ offset: true }),
}).superRefine((analysis, context) => {
  const assessment = analysis.beliefAssessment;
  if (assessment) {
    const analysisSourceById = new Map(
      analysis.sources.map((source) => [source.id, source]),
    );
    const gateContext = assessment.gateContext;
    const contextIdsResolve = gateContext.sources.every(
      (source) => analysisSourceById.has(source.id),
    );
    const prior = gateContext.priorInteraction;
    const priorSourceIdsMatchMemory = prior.sourceIds.every((sourceId) =>
      analysis.investmentMemory.sourceIds.includes(sourceId)
      && analysis.investmentMemory.fixtureIds.includes(sourceId)
    );
    const priorActionsMatchMemory =
      analysis.investmentMemory.priorActions !== undefined
      && beliefActionListsEqual(
        analysis.investmentMemory.priorActions,
        prior.priorActions,
      );
    const triggerEvent = analysis.marketEvidence.events.find(
      (event) => event.id === gateContext.triggerEvent.id,
    );
    const triggerSourceIds = triggerEvent && "schemaVersion" in triggerEvent
      ? triggerEvent.sources.map((source) => source.id)
      : [];
    if (
      !contextIdsResolve
      || !priorSourceIdsMatchMemory
      || !priorActionsMatchMemory
      || analysis.investmentMemory.lastEvaluatedAt !== prior.occurredAt
      || JSON.stringify(analysis.investmentMemory.revisitConditions)
        !== JSON.stringify(prior.revisitConditions)
      || triggerEvent === undefined
      || !("schemaVersion" in triggerEvent)
      || triggerEvent.eventAt !== gateContext.triggerEvent.eventAt
      || !sameStringSet(
        gateContext.triggerEvent.sourceIds,
        new Set(triggerSourceIds),
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Belief gate context must re-resolve through the analysis memory, event, and canonical source lineage",
      });
    }
    validateSourcePayloads([
      ...analysis.sources,
      ...gateContext.sources,
    ], context);
    if (assessment.dealStatus !== analysis.dealStatus) {
      context.addIssue({
        code: "custom",
        message: "Belief assessment status must preserve the historical Deal status",
      });
    }
    if (
      assessment.scoreBreakdown.finalScore !== analysis.score
      || assessment.scoreBreakdown.confidence !== analysis.confidence
    ) {
      context.addIssue({
        code: "custom",
        message: "Company analysis score and confidence must match its assessment",
      });
    }
    if (
      analysis.recommendedNextMove
        !== renderRecommendedNextMove(assessment.actions)
    ) {
      context.addIssue({
        code: "custom",
        message: "Compatibility next-move text must be rendered from typed actions",
      });
    }
    const materialDirection = assessment.direction === "positive"
      || assessment.direction === "mixed"
      || assessment.direction === "negative";
    const qualifiedConfidence = assessment.scoreBreakdown.confidence === "medium"
      || assessment.scoreBreakdown.confidence === "high";
    if (
      analysis.outcome === "belief_revised"
      && (
        !materialDirection
        || !qualifiedConfidence
        || !assessment.gates.allPassed
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Belief revisions require material direction, qualified confidence, and every hard gate",
      });
    }
  }

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

export const CompanyAnalysisSchema = z.unknown().superRefine(
  (value, context) => {
    if (
      typeof value === "object"
      && value !== null
      && "beliefAssessment" in value
      && (value as { beliefAssessment?: unknown }).beliefAssessment !== undefined
      && (
        !("dealStatus" in value)
        || !CanonicalDealStatusSchema.safeParse(
          (value as { dealStatus?: unknown }).dealStatus,
        ).success
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Versioned CompanyAnalysis requires a canonical outer Deal status",
      });
    }
  },
).pipe(CompanyAnalysisObjectSchema);

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
export type BeliefChangeDirection = z.infer<
  typeof BeliefChangeDirectionSchema
>;
export type BeliefActionKind = z.infer<typeof BeliefActionKindSchema>;
export type BeliefActionScope = z.infer<typeof BeliefActionScopeSchema>;
export type BeliefActionPriority = z.infer<typeof BeliefActionPrioritySchema>;
export type BeliefActionVisibility = z.infer<
  typeof BeliefActionVisibilitySchema
>;
export type BeliefAction = z.infer<typeof BeliefActionSchema>;
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
export type OpportunityScoreBreakdown = z.infer<
  typeof OpportunityScoreBreakdownSchema
>;
export type ChronologyGateResult = z.infer<
  typeof ChronologyGateResultSchema
>;
export type RevisitConditionMappingGateResult = z.infer<
  typeof RevisitConditionMappingGateResultSchema
>;
export type CounterevidenceGateResult = z.infer<
  typeof CounterevidenceGateResultSchema
>;
export type ActionDeltaGateResult = z.infer<
  typeof ActionDeltaGateResultSchema
>;
export type BeliefRevisionGateResults = z.infer<
  typeof BeliefRevisionGateResultsSchema
>;
export type BeliefChangeAssessmentV1 = z.infer<
  typeof BeliefChangeAssessmentV1Schema
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
