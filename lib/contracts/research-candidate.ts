import { z } from "zod";

import { compareUtf8 } from "../format/canonical-order";
import { withinPublicationWindow } from "../market/publication-window";
import { CanonicalHttpUrlSchema } from "../security/safe-url";

const IdSchema = z.string().min(1).refine(
  (value) => value.trim() === value,
  "IDs cannot be blank or have surrounding whitespace",
);
const NonEmptyTextSchema = z.string().min(1).refine(
  (value) => value.trim() === value && value.trim().length > 0,
  "Text cannot be blank or have surrounding whitespace",
);
const NonEmptyTextsSchema = z.array(NonEmptyTextSchema).min(1);
const FingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const CalendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(
  (value) => {
    const parsed = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed)
      && new Date(parsed).toISOString().slice(0, 10) === value;
  },
  "Research dates must be real ISO calendar dates",
);
const TimestampSchema = z.string().datetime({ offset: true });

const EntityKeySchema = z.string().regex(
  /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/u,
  "Entity keys must be normalized lowercase identifiers",
);

export const CanonicalResearchEntityKeysSchema = z.array(EntityKeySchema)
  .min(1)
  .superRefine((keys, context) => {
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: "custom", message: "Entity keys must be unique" });
    }
    if (keys.some((key, index) =>
      index > 0 && compareUtf8(keys[index - 1]!, key) >= 0
    )) {
      context.addIssue({
        code: "custom",
        message: "Entity keys must already be canonically sorted",
      });
    }
  });

export const ResearchDispositionSchema = z.enum([
  "selected",
  "qualified_not_selected",
  "insufficient_evidence",
  "rejected",
]);
export type ResearchDisposition = z.infer<typeof ResearchDispositionSchema>;

export const DeepUnderwritingAdmissionPolicySchema = z.strictObject({
  requiredOutcome: z.literal("belief_revised"),
  allowedConfidence: z.tuple([z.literal("medium"), z.literal("high")]),
  scoreThreshold: z.literal("configured_threshold_met"),
  hardGates: z.literal("all_passed"),
  lineage: z.literal("complete"),
  failureState: z.literal("none"),
  researchDispositionAffectsAdmission: z.literal(false),
  admissionMode: z.literal("all_qualifying_deals"),
  orderingRole: z.literal("priority_only"),
});
export type DeepUnderwritingAdmissionPolicy = z.infer<
  typeof DeepUnderwritingAdmissionPolicySchema
>;

export const ResearchWorkflowEligibilitySchema = z.strictObject({
  deal: z.literal(true),
  xtrace: z.literal(true),
  matching: z.literal(true),
  companyAnalysis: z.literal(true),
  deepUnderwritingAdmissionPolicy: DeepUnderwritingAdmissionPolicySchema,
});
export type ResearchWorkflowEligibility = z.infer<
  typeof ResearchWorkflowEligibilitySchema
>;

export const ResearchActionDeltaSchema = z.strictObject({
  classification: z.literal("research_only"),
  nextStep: z.enum([
    "continue_monitoring",
    "gather_missing_evidence",
    "deprioritize_research",
  ]),
  summary: NonEmptyTextSchema,
  createsFormalWorkflowArtifact: z.literal(false),
});
export type ResearchActionDelta = z.infer<typeof ResearchActionDeltaSchema>;

export const PinnedResearchEvidenceContextSchema = z.strictObject({
  mode: z.literal("pinned"),
  scope: z.literal("research_only"),
  formalReportEligible: z.literal(false),
  researchSnapshotVersion: z.literal("research-evidence-snapshot-v1"),
  snapshotId: IdSchema,
  snapshotAsOfDate: CalendarDateSchema,
  snapshotFingerprint: FingerprintSchema,
  anchorAt: TimestampSchema,
  windowStartAt: TimestampSchema,
  windowEndAt: TimestampSchema,
  windowTimezone: z.literal("America/Los_Angeles"),
  displayLabel: NonEmptyTextSchema,
}).superRefine((context, refinement) => {
  if (context.anchorAt !== context.windowEndAt) {
    refinement.addIssue({
      code: "custom",
      message: "A research snapshot anchor must equal its persisted window end",
    });
  }
  if (Date.parse(context.windowStartAt) > Date.parse(context.windowEndAt)) {
    refinement.addIssue({
      code: "custom",
      message: "A research snapshot window cannot be reversed",
    });
  }
  if (context.displayLabel !== `Demo evidence snapshot as of ${context.snapshotAsOfDate}`) {
    refinement.addIssue({
      code: "custom",
      message: "A research snapshot display label must match its as-of date",
    });
  }
});
export type PinnedResearchEvidenceContext = z.infer<
  typeof PinnedResearchEvidenceContextSchema
>;

const ResearchDispositionFields = {
  disposition: ResearchDispositionSchema,
  qualificationRationale: NonEmptyTextSchema,
  notSelectedReason: NonEmptyTextSchema.nullable(),
  missingEvidence: NonEmptyTextsSchema,
  counterevidenceAndLimits: NonEmptyTextsSchema,
  invalidatingEvidence: NonEmptyTextsSchema,
  upgradingEvidence: NonEmptyTextsSchema,
  reconsiderationConditions: NonEmptyTextsSchema,
  actionDelta: ResearchActionDeltaSchema,
  workflowEligibility: ResearchWorkflowEligibilitySchema,
} as const;

const ResearchScreeningDealFields = {
  stableDealId: IdSchema,
  dealStatus: z.literal("screening"),
  analysisEligible: z.literal(true),
} as const;

function validateDispositionFields(
  value: {
    disposition: ResearchDisposition;
    notSelectedReason: string | null;
  },
  context: z.RefinementCtx,
): void {
  if (value.disposition === "selected" && value.notSelectedReason !== null) {
    context.addIssue({
      code: "custom",
      message: "A selected research disposition cannot have a non-selection reason",
    });
  }
  if (value.disposition !== "selected" && value.notSelectedReason === null) {
    context.addIssue({
      code: "custom",
      message: "A non-selected research disposition requires a reason",
    });
  }
}

export const ResearchCandidateSchema = z.strictObject({
  schemaVersion: z.literal("research-candidate-v1"),
  id: IdSchema,
  workspaceId: IdSchema,
  companyId: IdSchema,
  ...ResearchScreeningDealFields,
  entityKeys: CanonicalResearchEntityKeysSchema,
  identityStatus: z.enum(["resolved", "partially_resolved"]),
  ...ResearchDispositionFields,
  sampleResearchScreeningRecordId: IdSchema,
  evidenceContext: PinnedResearchEvidenceContextSchema,
}).superRefine(validateDispositionFields);
export type ResearchCandidate = z.infer<typeof ResearchCandidateSchema>;

const SourceClassSchema = z.enum([
  "company_official",
  "government_or_regulator",
  "court_or_public_filing",
  "customer_or_partner_official",
  "investor_official",
  "funding_publication",
  "industry_publication",
  "commercial_database",
  "founder_social",
]);
const SourceAuthoritySchema = z.enum(["primary", "secondary"]);
const EvidenceRoleSchema = z.enum([
  "trigger",
  "corroborating",
  "counterevidence",
]);
const VerbatimExcerptSchema = z.string().refine(
  (value) => value.trim().length > 0,
  "A verbatim excerpt must contain non-whitespace text",
).refine(
  (value) => value.trim().split(/\s+/u).length <= 25,
  "A verbatim excerpt cannot exceed 25 words",
);

const ResearchPublicSourceSchema = z.strictObject({
  sourceId: IdSchema,
  sourceRevisionId: IdSchema,
  contentFingerprint: FingerprintSchema,
  title: NonEmptyTextSchema,
  publisher: NonEmptyTextSchema,
  canonicalUrl: CanonicalHttpUrlSchema,
  sourceClass: SourceClassSchema,
  sourceAuthority: SourceAuthoritySchema,
  evidenceRole: EvidenceRoleSchema,
  entityKeys: CanonicalResearchEntityKeysSchema,
  eventAt: CalendarDateSchema.nullable(),
  publishedAt: CalendarDateSchema.nullable(),
  publicationTimestamp: TimestampSchema.nullable(),
  retrievedAt: CalendarDateSchema,
  locator: NonEmptyTextSchema,
  verbatimExcerpt: VerbatimExcerptSchema,
  normalizedStatement: NonEmptyTextSchema,
}).superRefine((source, context) => {
  if (source.verbatimExcerpt === source.normalizedStatement) {
    context.addIssue({
      code: "custom",
      message: "Normalized text cannot masquerade as a verbatim excerpt",
    });
  }
  if (source.publicationTimestamp !== null && source.publishedAt === null) {
    context.addIssue({
      code: "custom",
      message: "A publication timestamp requires a publication date",
    });
  }
  if (source.evidenceRole === "trigger"
    && (source.eventAt === null || source.publishedAt === null)) {
    context.addIssue({
      code: "custom",
      message: "A research trigger requires event and publication dates",
    });
  }
  if (source.publishedAt !== null && source.publishedAt > source.retrievedAt) {
    context.addIssue({
      code: "custom",
      message: "Research evidence cannot be retrieved before publication",
    });
  }
  if (source.eventAt !== null && source.eventAt > source.retrievedAt) {
    context.addIssue({
      code: "custom",
      message: "Research evidence cannot be retrieved before its event",
    });
  }
});

export const PublicEvidenceMemoryPayloadSchema = z.strictObject({
  schemaVersion: z.literal("research-public-evidence-memory-v1"),
  memoryKind: z.literal("public_evidence"),
  workspaceId: IdSchema,
  candidateId: IdSchema,
  companyId: IdSchema,
  stableDealId: IdSchema,
  entityKeys: CanonicalResearchEntityKeysSchema,
  evidenceContext: PinnedResearchEvidenceContextSchema,
  source: ResearchPublicSourceSchema,
}).superRefine((payload, context) => {
  if (payload.entityKeys.some((key) => !payload.source.entityKeys.includes(key))) {
    context.addIssue({
      code: "custom",
      message: "Public evidence must include every candidate entity key",
    });
  }
  if (
    payload.source.evidenceRole === "trigger"
    && !withinPublicationWindow({
      publishedAt: payload.source.publicationTimestamp
        ?? payload.source.publishedAt!,
      publishedAtPrecision: payload.source.publicationTimestamp === null
        ? "date"
        : "timestamp",
    }, {
      windowStartAt: payload.evidenceContext.windowStartAt,
      windowEndAt: payload.evidenceContext.windowEndAt,
      windowTimezone: payload.evidenceContext.windowTimezone,
    })
  ) {
    context.addIssue({
      code: "custom",
      message: "A research trigger must fall inside its exact rolling window",
    });
  }
});
export type PublicEvidenceMemoryPayload = z.infer<
  typeof PublicEvidenceMemoryPayloadSchema
>;

export const SAMPLE_RESEARCH_SCREENING_RECORD_LABEL =
  "Sample research screening record" as const;

export const ResearchDispositionMemoryPayloadSchema = z.strictObject({
  schemaVersion: z.literal("research-disposition-memory-v1"),
  memoryKind: z.literal("research_disposition"),
  id: IdSchema,
  workspaceId: IdSchema,
  candidateId: IdSchema,
  companyId: IdSchema,
  ...ResearchScreeningDealFields,
  entityKeys: CanonicalResearchEntityKeysSchema,
  evidenceContext: PinnedResearchEvidenceContextSchema,
  provenance: z.literal("synthetic_research_record"),
  recordKind: z.literal("research_screening_disposition"),
  meetingOccurred: z.literal(false),
  vcInteraction: z.literal(false),
  label: z.literal(SAMPLE_RESEARCH_SCREENING_RECORD_LABEL),
  recordedAt: TimestampSchema,
  ...ResearchDispositionFields,
}).superRefine(validateDispositionFields);
export type ResearchDispositionMemoryPayload = z.infer<
  typeof ResearchDispositionMemoryPayloadSchema
>;

export const ResearchEvidenceGapSchema = z.strictObject({
  schemaVersion: z.literal("research-evidence-gap-v1"),
  id: IdSchema,
  workspaceId: IdSchema,
  candidateId: IdSchema,
  companyId: IdSchema,
  stableDealId: IdSchema,
  entityKeys: CanonicalResearchEntityKeysSchema,
  status: z.literal("unresolved"),
  title: NonEmptyTextSchema,
  publisher: NonEmptyTextSchema,
  surfacedUrl: CanonicalHttpUrlSchema,
  retrievedAt: CalendarDateSchema,
  reason: NonEmptyTextSchema,
  memoryEligible: z.literal(false),
});
export type ResearchEvidenceGap = z.infer<typeof ResearchEvidenceGapSchema>;

export const ResearchCandidateDispositionMemoryPairSchema = z.strictObject({
  candidate: ResearchCandidateSchema,
  dispositionMemory: ResearchDispositionMemoryPayloadSchema,
}).superRefine(({ candidate, dispositionMemory }, context) => {
  const sharedFields = [
    "workspaceId",
    "companyId",
    "stableDealId",
    "dealStatus",
    "analysisEligible",
    "entityKeys",
    "evidenceContext",
    "disposition",
    "qualificationRationale",
    "notSelectedReason",
    "missingEvidence",
    "counterevidenceAndLimits",
    "invalidatingEvidence",
    "upgradingEvidence",
    "reconsiderationConditions",
    "actionDelta",
    "workflowEligibility",
  ] as const;
  if (
    dispositionMemory.candidateId !== candidate.id
    || dispositionMemory.id !== candidate.sampleResearchScreeningRecordId
    || sharedFields.some((field) =>
      JSON.stringify(dispositionMemory[field]) !== JSON.stringify(candidate[field])
    )
  ) {
    context.addIssue({
      code: "custom",
      message:
        "A Sample research screening record must map one-to-one to its exact candidate disposition",
    });
  }
});
export type ResearchCandidateDispositionMemoryPair = z.infer<
  typeof ResearchCandidateDispositionMemoryPairSchema
>;
