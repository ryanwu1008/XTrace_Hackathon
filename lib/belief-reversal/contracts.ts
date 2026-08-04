import { z } from "zod";

import {
  DeepUnderwritingAdmissionPolicySchema,
  ResearchActionDeltaSchema,
  ResearchDispositionSchema,
  ResearchWorkflowEligibilitySchema,
} from "../contracts/research-candidate";
import { withinPublicationWindow } from "../market/dedupe";
import { CanonicalHttpUrlSchema } from "../security/safe-url";

const StableIdSchema = z.string().regex(
  /^[a-z0-9]+(?:_[a-z0-9]+)*_v\d+$/,
  "Stable ids must use lowercase snake case and end in a version suffix",
);
const NonEmptyStringSchema = z.string().trim().min(1);
const VerbatimExcerptSchema = z.string().refine(
  (value) => value.trim().length > 0,
  "Verbatim excerpts must contain non-whitespace text",
);
const BoundedVerbatimExcerptSchema = VerbatimExcerptSchema.refine(
  (value) => value.trim().split(/\s+/u).length <= 25,
  "Verbatim excerpts are bounded to 25 words",
);
const NonEmptyStringsSchema = z.array(NonEmptyStringSchema).min(1);
const EntityKeySchema = z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/);
const EntityKeysSchema = z.array(EntityKeySchema).min(1).superRefine(
  (keys, context) => {
    if (
      new Set(keys).size !== keys.length
      || keys.some((key, index) => index > 0 && keys[index - 1]! >= key)
    ) {
      context.addIssue({
        code: "custom",
        message: "Entity keys must be unique and canonically sorted",
      });
    }
  },
);

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).superRefine((value, context) => {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    context.addIssue({ code: "custom", message: "Date must be a real ISO calendar date" });
  }
});
const IsoDateTimeSchema = z.iso.datetime({ offset: true });

export const CanonicalActionKindSchema = z.enum([
  "reopen_diligence",
  "advance_diligence",
  "continue_monitoring",
  "deprioritize",
  "evaluate_follow_on",
  "validate_channel_economics",
  "pause_follow_on",
  "portfolio_risk_review",
  "review_analysis_failure",
]);

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
const EvidenceRoleSchema = z.enum(["trigger", "corroborating", "counterevidence"]);

const FingerprintInputsSchema = z.strictObject({
  title: NonEmptyStringSchema,
  publisher: NonEmptyStringSchema,
  canonicalUrl: CanonicalHttpUrlSchema,
  sourceClass: SourceClassSchema,
  sourceAuthority: SourceAuthoritySchema,
  evidenceRole: EvidenceRoleSchema,
  eventAt: IsoDateSchema.nullable(),
  publishedAt: IsoDateSchema.nullable(),
  publicationTimestamp: IsoDateTimeSchema.nullable(),
  retrievedAt: IsoDateSchema,
  locator: NonEmptyStringSchema,
  verbatimExcerpt: VerbatimExcerptSchema,
  normalizedStatement: NonEmptyStringSchema,
  referenceId: StableIdSchema,
});

const ResearchFingerprintInputsSchema = FingerprintInputsSchema.extend({
  entityKeys: EntityKeysSchema,
});

const ResearchSourceSchema = z.strictObject({
  id: StableIdSchema,
  title: NonEmptyStringSchema,
  publisher: NonEmptyStringSchema,
  canonicalUrl: CanonicalHttpUrlSchema,
  sourceClass: SourceClassSchema,
  sourceAuthority: SourceAuthoritySchema,
  evidenceRole: EvidenceRoleSchema,
  entityKeys: EntityKeysSchema,
  eventAt: IsoDateSchema.nullable(),
  publishedAt: IsoDateSchema.nullable(),
  publicationTimestamp: IsoDateTimeSchema.nullable(),
  retrievedAt: IsoDateSchema,
  locator: NonEmptyStringSchema,
  verbatimExcerpt: BoundedVerbatimExcerptSchema,
  normalizedStatement: NonEmptyStringSchema,
  supportedClaimId: StableIdSchema,
  fingerprintInputs: ResearchFingerprintInputsSchema,
}).superRefine((source, context) => {
  if (source.verbatimExcerpt === source.normalizedStatement) {
    context.addIssue({ code: "custom", message: "Normalized text cannot masquerade as exact verbatim support" });
  }
});

const PublicClaimSchema = z.strictObject({
  id: StableIdSchema,
  classification: z.literal("fact"),
  statement: NonEmptyStringSchema,
  reportingBasis: z.enum([
    "company_reported",
    "company_reported_partner_quote",
    "publisher_reported",
    "official_incident_report",
    "official_legal_terms",
    "third_party_profile",
  ]),
  sourceId: StableIdSchema,
});

const SourcedStringSchema = z.strictObject({
  value: NonEmptyStringSchema,
  sourceId: StableIdSchema,
});
const AvailableProfileFieldSchema = z.strictObject({
  availability: z.literal("available"),
  value: NonEmptyStringSchema,
  sourceId: StableIdSchema,
});
const UnavailableProfileFieldSchema = z.strictObject({
  availability: z.literal("unavailable"),
  reason: NonEmptyStringSchema,
  checkedSourceIds: z.array(StableIdSchema).min(1),
});
const ProfileFieldSchema = z.discriminatedUnion("availability", [
  AvailableProfileFieldSchema,
  UnavailableProfileFieldSchema,
]);

const CompanyProfileSchema = z.strictObject({
  brandName: SourcedStringSchema,
  legalName: ProfileFieldSchema,
  officialDomain: SourcedStringSchema.extend({ value: z.string().url() }),
  founders: z.array(z.strictObject({ name: NonEmptyStringSchema, sourceId: StableIdSchema })).min(1),
  stage: ProfileFieldSchema,
  businessModel: ProfileFieldSchema,
  geography: ProfileFieldSchema,
  securityType: z.strictObject({
    classification: z.literal("assumption"),
    value: z.literal("preferred"),
    rationale: NonEmptyStringSchema,
    sourceBoundary: z.literal("No reviewed public source disclosed the security type."),
  }),
});

const FoundingDateSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("available"), value: NonEmptyStringSchema, sourceId: StableIdSchema }),
  z.strictObject({ status: z.literal("unavailable"), reason: NonEmptyStringSchema, checkedSourceIds: z.array(StableIdSchema).min(1) }),
  z.strictObject({
    status: z.literal("conflicting"),
    observations: z.array(z.strictObject({ value: NonEmptyStringSchema, sourceId: StableIdSchema })).min(2),
  }),
]);

const SourceDateConflictSchema = z.strictObject({
  description: NonEmptyStringSchema,
  observations: z.array(z.strictObject({ value: IsoDateSchema, sourceId: StableIdSchema })).min(2),
});

const MetricSchema = z.discriminatedUnion("availability", [
  z.strictObject({
    availability: z.literal("available"),
    value: NonEmptyStringSchema,
    basis: NonEmptyStringSchema,
    asOfDate: IsoDateSchema,
    sourceIds: z.array(StableIdSchema).min(1),
  }),
  z.strictObject({
    availability: z.literal("unavailable"),
    reason: NonEmptyStringSchema,
    checkedSourceIds: z.array(StableIdSchema).min(1),
  }),
]);

const ValuationBasisSchema = z.discriminatedUnion("availability", [
  z.strictObject({
    availability: z.literal("available"),
    basisType: z.enum(["company_reported", "publisher_reported"]),
    statement: NonEmptyStringSchema,
    sourceIds: z.array(StableIdSchema).min(1),
  }),
  z.strictObject({
    availability: z.literal("unavailable"),
    reason: NonEmptyStringSchema,
    checkedSourceIds: z.array(StableIdSchema).min(1),
  }),
]);

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
  priorAction: CanonicalActionKindSchema,
});

const RecentMarketEventSchema = z.strictObject({
  id: StableIdSchema,
  eventType: z.enum(["funding", "product_change", "security_incident", "strategic_partnership"]),
  title: NonEmptyStringSchema,
  summary: NonEmptyStringSchema,
  sectors: NonEmptyStringsSchema,
  themes: NonEmptyStringsSchema,
  positiveImplications: NonEmptyStringsSchema,
  negativeImplications: NonEmptyStringsSchema,
  eventAt: IsoDateSchema.nullable(),
  publishedAt: IsoDateSchema,
  retrievedAt: IsoDateSchema,
  confidence: z.enum(["low", "medium", "high"]),
  entityKeys: EntityKeysSchema,
  triggerSourceId: StableIdSchema,
  sourceIds: z.array(StableIdSchema).min(1),
});

const ResearchUnknownSchema = z.strictObject({
  reason: NonEmptyStringSchema,
  externalLabel: NonEmptyStringSchema,
});

const ResearchCaseSchema = z.strictObject({
  id: StableIdSchema,
  companyId: StableIdSchema,
  dealId: StableIdSchema,
  entityKeys: EntityKeysSchema,
  profile: CompanyProfileSchema,
  foundingDate: FoundingDateSchema,
  sourceDateConflicts: z.array(SourceDateConflictSchema),
  priorDecision: PriorDecisionSchema,
  claims: z.array(PublicClaimSchema).min(1),
  sources: z.array(ResearchSourceSchema).min(2),
  events: z.array(RecentMarketEventSchema).min(1),
  counterevidenceSourceIds: z.array(StableIdSchema).min(1),
  unknowns: z.array(ResearchUnknownSchema).min(1),
  metrics: z.strictObject({
    reportedValuation: MetricSchema,
    arrOrRevenue: MetricSchema,
    customerEvidence: MetricSchema,
    cash: MetricSchema,
    burn: MetricSchema,
    reportedValuationBasis: ValuationBasisSchema,
    runway: MetricSchema,
    retention: MetricSchema,
    customerCount: MetricSchema,
  }),
});

const ResolvedScreeningSourceSchema = z.strictObject({
  status: z.literal("resolved"),
  id: StableIdSchema,
  title: NonEmptyStringSchema,
  publisher: NonEmptyStringSchema,
  canonicalUrl: CanonicalHttpUrlSchema,
  sourceClass: SourceClassSchema,
  sourceAuthority: SourceAuthoritySchema,
  evidenceRole: EvidenceRoleSchema,
  entityKeys: EntityKeysSchema,
  eventAt: IsoDateSchema.nullable(),
  publishedAt: IsoDateSchema.nullable(),
  publicationTimestamp: IsoDateTimeSchema.nullable(),
  retrievedAt: IsoDateSchema,
  locator: NonEmptyStringSchema,
  verbatimExcerpt: BoundedVerbatimExcerptSchema,
  normalizedStatement: NonEmptyStringSchema,
  candidateId: StableIdSchema,
  fingerprintInputs: ResearchFingerprintInputsSchema,
}).superRefine((source, context) => {
  if (source.verbatimExcerpt === source.normalizedStatement) {
    context.addIssue({ code: "custom", message: "Screening source exact and normalized text must remain separate" });
  }
});
const UnresolvedScreeningSourceSchema = z.strictObject({
  status: z.literal("unresolved"),
  id: StableIdSchema,
  title: NonEmptyStringSchema,
  publisher: NonEmptyStringSchema,
  surfacedUrl: CanonicalHttpUrlSchema,
  retrievedAt: IsoDateSchema,
  candidateId: StableIdSchema,
  reason: NonEmptyStringSchema,
});
const ScreeningSourceSchema = z.discriminatedUnion("status", [
  ResolvedScreeningSourceSchema,
  UnresolvedScreeningSourceSchema,
]);

const CandidateIdentitySchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("resolved"),
    brandName: NonEmptyStringSchema,
    legalName: NonEmptyStringSchema,
    officialDomain: z.string().url(),
    identityNote: NonEmptyStringSchema,
    identitySourceIds: z.array(StableIdSchema).min(1),
  }),
  z.strictObject({
    status: z.literal("partially_resolved"),
    brandName: NonEmptyStringSchema,
    legalName: NonEmptyStringSchema.nullable(),
    officialDomain: z.string().url().nullable(),
    identityNote: NonEmptyStringSchema,
    identitySourceIds: z.array(StableIdSchema).min(1),
    unresolvedFields: z.array(z.enum(["legal_name", "official_domain"])).min(1).max(2),
  }),
]).superRefine((identity, context) => {
  if (identity.status !== "partially_resolved") return;
  const expected = [
    ...(identity.legalName === null ? ["legal_name" as const] : []),
    ...(identity.officialDomain === null ? ["official_domain" as const] : []),
  ];
  if (JSON.stringify(identity.unresolvedFields) !== JSON.stringify(expected)) {
    context.addIssue({ code: "custom", message: "unresolvedFields must exactly match null identity fields" });
  }
});
const CandidateTriggerSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("resolved"),
    title: NonEmptyStringSchema,
    canonicalUrl: CanonicalHttpUrlSchema,
    eventAt: IsoDateSchema,
    publishedAt: IsoDateSchema,
    retrievedAt: IsoDateSchema,
    sourceId: StableIdSchema,
  }),
  z.strictObject({
    status: z.literal("unresolved"),
    sourceId: StableIdSchema,
    reason: NonEmptyStringSchema,
  }),
]);
const CandidateLedgerBaseShape = {
  id: StableIdSchema,
  companyId: StableIdSchema,
  entityKeys: EntityKeysSchema,
  companyIdentity: CandidateIdentitySchema,
  triggeringEvent: CandidateTriggerSchema,
  screeningSourceIds: z.array(StableIdSchema).min(1),
  missingEvidence: NonEmptyStringsSchema,
  counterevidenceAndLimits: NonEmptyStringsSchema,
} as const;
const SelectedCandidateLedgerEntrySchema = z.strictObject({
  ...CandidateLedgerBaseShape,
  caseId: StableIdSchema,
  disposition: z.literal("selected"),
  reason: NonEmptyStringSchema,
});
const ResearchOnlyCandidateLedgerShape = {
  ...CandidateLedgerBaseShape,
  stableDealId: StableIdSchema,
  dealStatus: z.literal("screening"),
  analysisEligible: z.literal(true),
  caseId: z.null(),
  qualificationRationale: NonEmptyStringSchema,
  notSelectedReason: NonEmptyStringSchema,
  invalidatingEvidence: NonEmptyStringsSchema,
  upgradingEvidence: NonEmptyStringsSchema,
  reconsiderationConditions: NonEmptyStringsSchema,
  actionDelta: ResearchActionDeltaSchema,
  workflowEligibility: ResearchWorkflowEligibilitySchema,
  sampleResearchScreeningRecordId: StableIdSchema,
} as const;
const CandidateLedgerEntrySchema = z.discriminatedUnion("disposition", [
  SelectedCandidateLedgerEntrySchema,
  z.strictObject({
    ...ResearchOnlyCandidateLedgerShape,
    disposition: ResearchDispositionSchema.extract(["qualified_not_selected"]),
  }),
  z.strictObject({
    ...ResearchOnlyCandidateLedgerShape,
    disposition: ResearchDispositionSchema.extract(["insufficient_evidence"]),
  }),
  z.strictObject({
    ...ResearchOnlyCandidateLedgerShape,
    disposition: ResearchDispositionSchema.extract(["rejected"]),
  }),
]);

const ResearchIntegrationContractSchema = z.strictObject({
  schemaVersion: z.literal("research-integration-contract-v1"),
  companyIdentityCount: z.literal(30),
  dealCount: z.literal(30),
  analysisEligibleDealCount: z.literal(30),
  completedScanCompanyAnalysisCount: z.literal(30),
  companyAnalysisOutcomeCounts: z.strictObject({
    beliefRevised: z.literal(4),
    monitor: z.literal(7),
    noMaterialChange: z.literal(19),
    analysisUnavailable: z.literal(0),
  }),
  currentDeepUnderwritingQueueCount: z.literal(4),
  currentNotAdmittedCompanyAnalysisCount: z.literal(26),
  deepUnderwritingAdmissionPolicy: DeepUnderwritingAdmissionPolicySchema,
  legacyPinnedRankAdapter: z.literal("compatibility_only"),
  resolvedPublicSourceParentCount: z.literal(18),
  unresolvedEvidenceGapCount: z.literal(1),
  sampleResearchScreeningParentCount: z.literal(7),
  researchDealBoundParentCount: z.literal(25),
  existingDealBoundParentCount: z.literal(60),
  totalDealBoundParentCount: z.literal(85),
  sourceDocumentCount: z.literal(80),
  sourceRevisionCount: z.literal(80),
  workspaceDocumentCount: z.literal(79),
  dealSourceAssignmentCount: z.literal(85),
  xtraceExactDealParentCount: z.literal(85),
  xtraceExactDealChildCount: z.literal(85),
});

export const BeliefReversalResearchPackageSchema = z.strictObject({
  schemaVersion: z.literal("belief-reversal-research-v2"),
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
  researchMemoryContext: z.strictObject({
    schemaVersion: z.literal("research-memory-context-v1"),
    mode: z.literal("pinned"),
    scope: z.literal("research_only"),
    researchSnapshotVersion: z.literal("research-evidence-snapshot-v1"),
    snapshotId: z.literal("belief_reversal_research_2026_08_03_v1"),
    snapshotAsOfDate: z.literal("2026-08-03"),
    retrievalCutoffDate: z.literal("2026-08-03"),
    anchorAt: z.literal("2026-08-03T13:34:43.000Z"),
    windowStartAt: z.literal("2026-07-20T13:34:43.000Z"),
    windowEndAt: z.literal("2026-08-03T13:34:43.000Z"),
    windowTimezone: z.literal("America/Los_Angeles"),
    displayLabel: z.literal("Demo evidence snapshot as of 2026-08-03"),
    formalReportEligible: z.literal(false),
  }),
  researchIntegrationContract: ResearchIntegrationContractSchema,
  selectedCases: z.array(ResearchCaseSchema).length(4),
  screeningSources: z.array(ScreeningSourceSchema).min(7),
  candidateLedger: z.array(CandidateLedgerEntrySchema).length(11),
}).superRefine((researchPackage, context) => {
  const issue = (message: string): void => context.addIssue({ code: "custom", message });
  const windowStart = researchPackage.evidenceWindow.startAt.slice(0, 10);
  const windowEnd = researchPackage.evidenceWindow.endAt.slice(0, 10);
  if (researchPackage.historicalCutoffDate >= windowStart) issue("Historical cutoff must predate the evidence window");

  const allIds: string[] = [];
  const allSelectedSources = new Map<string, z.infer<typeof ResearchSourceSchema>>();
  const selectedSourceOwners = new Map<string, string>();
  const selectedCases = new Map<string, z.infer<typeof ResearchCaseSchema>>();

  for (const selectedCase of researchPackage.selectedCases) {
    selectedCases.set(selectedCase.id, selectedCase);
    allIds.push(
      selectedCase.id,
      selectedCase.companyId,
      selectedCase.dealId,
      selectedCase.priorDecision.id,
      ...selectedCase.claims.map((claim) => claim.id),
      ...selectedCase.sources.map((source) => source.id),
      ...selectedCase.events.map((event) => event.id),
    );
    const sourceById = new Map(selectedCase.sources.map((source) => [source.id, source]));
    const claimById = new Map(selectedCase.claims.map((claim) => [claim.id, claim]));
    for (const source of selectedCase.sources) {
      allSelectedSources.set(source.id, source);
      selectedSourceOwners.set(source.id, selectedCase.id);
    }

    const requireSource = (sourceId: string, label: string): void => {
      if (!sourceById.has(sourceId)) issue(`${selectedCase.id} has unknown source reference for ${label}: ${sourceId}`);
    };
    requireSource(selectedCase.profile.brandName.sourceId, "brand name");
    requireSource(selectedCase.profile.officialDomain.sourceId, "official domain");
    for (const founder of selectedCase.profile.founders) requireSource(founder.sourceId, "founder");
    for (const field of [selectedCase.profile.legalName, selectedCase.profile.stage]) {
      if (field.availability === "available") requireSource(field.sourceId, "company profile");
      else for (const sourceId of field.checkedSourceIds) requireSource(sourceId, "company profile");
    }
    for (const [label, field] of [["business model", selectedCase.profile.businessModel], ["geography", selectedCase.profile.geography]] as const) {
      if (field.availability === "available") requireSource(field.sourceId, label);
      else for (const sourceId of field.checkedSourceIds) requireSource(sourceId, label);
    }

    if (selectedCase.foundingDate.status === "available") requireSource(selectedCase.foundingDate.sourceId, "founding date");
    if (selectedCase.foundingDate.status === "unavailable") {
      for (const sourceId of selectedCase.foundingDate.checkedSourceIds) requireSource(sourceId, "founding date");
    }
    if (selectedCase.foundingDate.status === "conflicting") {
      for (const observation of selectedCase.foundingDate.observations) requireSource(observation.sourceId, "founding date");
    }
    for (const conflict of selectedCase.sourceDateConflicts) {
      for (const observation of conflict.observations) requireSource(observation.sourceId, "date-conflict observation");
    }
    for (const [metricName, metric] of Object.entries(selectedCase.metrics)) {
      const sourceIds = metric.availability === "available" ? metric.sourceIds : metric.checkedSourceIds;
      for (const sourceId of sourceIds) requireSource(sourceId, `metric ${metricName}`);
    }

    for (const source of selectedCase.sources) {
      const claim = claimById.get(source.supportedClaimId);
      if (!claim || claim.sourceId !== source.id) issue(`${source.id} has dangling or mismatched claim support`);
      if (claim && claim.statement !== source.normalizedStatement) issue(`${source.id} normalized statement must equal its one supported factual claim`);
      if (source.retrievedAt !== researchPackage.retrievalDate) issue(`${source.id} retrieval date does not match the package`);
      if (source.publishedAt !== null && source.publishedAt > source.retrievedAt) issue(`${source.id} publication date is after retrieval`);
      if (source.eventAt !== null && source.eventAt > source.retrievedAt) issue(`${source.id} event date is after retrieval`);
      if (source.evidenceRole === "trigger" && source.eventAt === null) issue(`${source.id} trigger source requires an event date`);
      if (source.evidenceRole === "trigger" && source.publishedAt === null) issue(`${source.id} trigger source requires a publication date`);
      if (source.publicationTimestamp !== null && source.publishedAt === null) issue(`${source.id} timestamp requires a publication date`);
      const expectedFingerprintInputs = researchSourceFingerprintInputs(
        source,
        source.supportedClaimId,
      );
      if (JSON.stringify(source.fingerprintInputs) !== JSON.stringify(expectedFingerprintInputs)) {
        issue(`${source.id} fingerprint inputs do not match every immutable provenance field`);
      }
    }
    if (selectedCase.metrics.reportedValuation.availability !== selectedCase.metrics.reportedValuationBasis.availability) {
      issue(`${selectedCase.id} reported valuation and valuation basis availability must match`);
    }
    for (const claim of selectedCase.claims) {
      const source = sourceById.get(claim.sourceId);
      if (!source || source.supportedClaimId !== claim.id) issue(`${claim.id} has dangling source support`);
    }

    if (!selectedCase.sources.some((source) => source.evidenceRole === "trigger")) issue(`${selectedCase.id} requires a trigger source`);
    if (!selectedCase.sources.some((source) => source.sourceAuthority === "primary")) issue(`${selectedCase.id} requires a primary source`);
    if (!selectedCase.sources.some((source) => source.evidenceRole === "counterevidence")) issue(`${selectedCase.id} requires counterevidence`);
    for (const sourceId of selectedCase.counterevidenceSourceIds) {
      const source = sourceById.get(sourceId);
      if (!source || source.evidenceRole !== "counterevidence") issue(`${selectedCase.id} has invalid counterevidence source ${sourceId}`);
    }

    for (const event of selectedCase.events) {
      if (event.eventAt === null) issue(`${event.id} selected trigger event requires an event date`);
      else if (event.eventAt < windowStart || event.eventAt > windowEnd) issue(`${event.id} is outside the 14-day trigger window`);
      if (event.publishedAt < windowStart || event.publishedAt > windowEnd) issue(`${event.id} publication is outside the 14-day trigger window`);
      if (event.retrievedAt !== researchPackage.retrievalDate) issue(`${event.id} retrieval date does not match the package`);
      const triggerSource = sourceById.get(event.triggerSourceId);
      if (!triggerSource || triggerSource.evidenceRole !== "trigger") issue(`${event.id} has unknown or invalid trigger source`);
      else if (
        !event.sourceIds.includes(event.triggerSourceId) ||
        event.eventAt !== triggerSource.eventAt ||
        event.publishedAt !== triggerSource.publishedAt ||
        event.retrievedAt !== triggerSource.retrievedAt ||
        selectedCase.entityKeys.some((key) =>
          !triggerSource.entityKeys.includes(key)
        )
      ) issue(`${event.id} trigger provenance does not match its referenced source`);
      const eventSources = event.sourceIds.flatMap((sourceId) => {
        const source = sourceById.get(sourceId);
        if (!source) {
          issue(`${event.id} has unknown event source ${sourceId}`);
          return [];
        }
        return [source];
      });
      const expectedEventEntityKeys = [...new Set(eventSources.flatMap(
        ({ entityKeys }) => entityKeys,
      ))].sort();
      if (
        JSON.stringify(event.entityKeys)
          !== JSON.stringify(expectedEventEntityKeys)
      ) {
        issue(
          `${event.id} event entity keys must exactly equal its source entity keys`,
        );
      }
      const implications = [...event.positiveImplications, ...event.negativeImplications].join(" ");
      if (/reopen|diligence|follow-on|portfolio_risk|pause_follow/i.test(implications)) issue(`${event.id} implication contains a company action or expected direction`);
    }
    if (
      selectedCase.priorDecision.occurredAt.slice(0, 10) > researchPackage.historicalCutoffDate ||
      selectedCase.events.some((event) => event.eventAt !== null && selectedCase.priorDecision.occurredAt.slice(0, 10) >= event.eventAt)
    ) {
      issue(`${selectedCase.id} prior decision must predate every trigger event`);
    }
  }

  const screeningSources = new Map(researchPackage.screeningSources.map((source) => [source.id, source]));
  const resolvedScreeningSourceCount = researchPackage.screeningSources.filter(
    (source) => source.status === "resolved",
  ).length;
  const unresolvedScreeningSourceCount = researchPackage.screeningSources.length
    - resolvedScreeningSourceCount;
  if (
    resolvedScreeningSourceCount
      !== researchPackage.researchIntegrationContract.resolvedPublicSourceParentCount
  ) issue("Resolved research source-parent count does not match the integration contract");
  if (
    unresolvedScreeningSourceCount
      !== researchPackage.researchIntegrationContract.unresolvedEvidenceGapCount
  ) issue("Unresolved research evidence-gap count does not match the integration contract");
  for (const source of researchPackage.screeningSources) {
    allIds.push(source.id);
    if (source.retrievedAt > researchPackage.researchMemoryContext.retrievalCutoffDate) {
      issue(`${source.id} screening retrieval date exceeds the research-memory cutoff`);
    }
    if (source.status === "resolved") {
      if (source.evidenceRole === "trigger" && (source.eventAt === null || source.publishedAt === null)) {
        issue(`${source.id} screening trigger requires event and publication dates`);
      }
      if (
        source.evidenceRole === "trigger"
        && source.publishedAt !== null
        && !withinPublicationWindow({
          publishedAt: source.publicationTimestamp ?? source.publishedAt,
          publishedAtPrecision: source.publicationTimestamp === null
            ? "date"
            : "timestamp",
        }, {
          windowStartAt: researchPackage.researchMemoryContext.windowStartAt,
          windowEndAt: researchPackage.researchMemoryContext.windowEndAt,
          windowTimezone: researchPackage.researchMemoryContext.windowTimezone,
        })
      ) issue(`${source.id} screening trigger is outside the exact research-memory window`);
      if (source.publicationTimestamp !== null && source.publishedAt === null) {
        issue(`${source.id} screening timestamp requires a publication date`);
      }
      const expected = researchSourceFingerprintInputs(source, source.candidateId);
      if (JSON.stringify(source.fingerprintInputs) !== JSON.stringify(expected)) issue(`${source.id} screening fingerprint mismatch`);
    }
  }
  const candidateCompanyIds = new Set<string>();
  for (const entry of researchPackage.candidateLedger) {
    allIds.push(entry.id);
    if (candidateCompanyIds.has(entry.companyId)) issue(`${entry.id} reuses another candidate company identity`);
    candidateCompanyIds.add(entry.companyId);
    if (entry.disposition !== "selected") {
      allIds.push(entry.stableDealId, entry.sampleResearchScreeningRecordId);
    }
    if (entry.caseId !== null && !selectedCases.has(entry.caseId)) issue(`${entry.id} has unknown selected case reference`);
    for (const sourceId of entry.screeningSourceIds) {
      if (!screeningSources.has(sourceId) && !allSelectedSources.has(sourceId)) issue(`${entry.id} has unknown screening source ${sourceId}`);
      const screeningSource = screeningSources.get(sourceId);
      if (screeningSource && screeningSource.candidateId !== entry.id) issue(`${entry.id} cannot borrow another candidate's screening source`);
      const selectedOwner = selectedSourceOwners.get(sourceId);
      if (selectedOwner && selectedOwner !== entry.caseId) issue(`${entry.id} cannot borrow another selected case's source`);
    }
    for (const sourceId of entry.companyIdentity.identitySourceIds) {
      const screeningSource = screeningSources.get(sourceId);
      const selectedOwner = selectedSourceOwners.get(sourceId);
      if (!entry.screeningSourceIds.includes(sourceId)) issue(`${entry.id} identity source must be included in screeningSourceIds`);
      if (!screeningSource && !selectedOwner) issue(`${entry.id} has unknown identity source ${sourceId}`);
      if (screeningSource?.status === "unresolved") issue(`${entry.id} identity source must reference resolved evidence`);
      if (screeningSource && screeningSource.candidateId !== entry.id) issue(`${entry.id} cannot borrow another candidate's identity source`);
      if (
        screeningSource?.status === "resolved"
        && entry.entityKeys.some((key) => !screeningSource.entityKeys.includes(key))
      ) issue(`${entry.id} identity source is missing a candidate entity key`);
      if (selectedOwner && selectedOwner !== entry.caseId) issue(`${entry.id} cannot borrow another selected case's identity source`);
    }
    const screeningTriggerSource = screeningSources.get(entry.triggeringEvent.sourceId);
    const selectedTriggerSource = allSelectedSources.get(entry.triggeringEvent.sourceId);
    const triggerSource = screeningTriggerSource ?? selectedTriggerSource;
    if (!triggerSource) issue(`${entry.id} triggering event has unknown source`);
    if (screeningTriggerSource && screeningTriggerSource.candidateId !== entry.id) issue(`${entry.id} trigger source belongs to another candidate`);
    const selectedTriggerOwner = selectedSourceOwners.get(entry.triggeringEvent.sourceId);
    if (selectedTriggerOwner && selectedTriggerOwner !== entry.caseId) issue(`${entry.id} trigger source belongs to another selected case`);
    if (entry.triggeringEvent.status === "resolved") {
      const resolvedTriggerSource = screeningTriggerSource?.status === "resolved"
        ? screeningTriggerSource
        : selectedTriggerSource;
      if (!entry.screeningSourceIds.includes(entry.triggeringEvent.sourceId)) {
        issue(`${entry.id} resolved trigger source must be included in screeningSourceIds`);
      }
      if (!resolvedTriggerSource) issue(`${entry.id} resolved trigger requires a resolved source`);
      else if (resolvedTriggerSource.evidenceRole !== "trigger") issue(`${entry.id} resolved trigger source must have trigger evidenceRole`);
      else if (
        entry.triggeringEvent.canonicalUrl !== resolvedTriggerSource.canonicalUrl ||
        entry.triggeringEvent.eventAt !== resolvedTriggerSource.eventAt ||
        entry.triggeringEvent.publishedAt !== resolvedTriggerSource.publishedAt ||
        entry.triggeringEvent.retrievedAt !== resolvedTriggerSource.retrievedAt
        || entry.entityKeys.some((key) => !resolvedTriggerSource.entityKeys.includes(key))
      ) issue(`${entry.id} triggering event does not match its source`);
    } else if (screeningTriggerSource?.status !== "unresolved") {
      issue(`${entry.id} unresolved trigger requires an unresolved screening source`);
    }
  }
  if (new Set(allIds).size !== allIds.length) issue("All package, event, screening, and ledger IDs must be globally unique");

  const selectedEntries = researchPackage.candidateLedger.filter((entry) => entry.disposition === "selected");
  const researchOnlyEntries = researchPackage.candidateLedger.filter(
    (entry) => entry.disposition !== "selected",
  );
  const integrationContract = researchPackage.researchIntegrationContract;
  const outcomeCountSum = Object.values(
    integrationContract.companyAnalysisOutcomeCounts,
  ).reduce<number>((sum, count) => sum + count, 0);
  if (outcomeCountSum !== integrationContract.completedScanCompanyAnalysisCount) {
    issue("CompanyAnalysis outcome counts must sum to the completed scan count");
  }
  if (
    integrationContract.currentDeepUnderwritingQueueCount
      !== integrationContract.companyAnalysisOutcomeCounts.beliefRevised
  ) issue("Every current qualifying changed belief must enter the underwriting queue");
  if (
    integrationContract.currentNotAdmittedCompanyAnalysisCount
      !== integrationContract.completedScanCompanyAnalysisCount
        - integrationContract.currentDeepUnderwritingQueueCount
  ) issue("Admitted and not-admitted CompanyAnalysis counts must cover the completed scan");
  if (
    researchOnlyEntries.length
      !== integrationContract.sampleResearchScreeningParentCount
  ) issue("Sample research screening parent count does not match the candidate ledger");
  if (
    integrationContract.researchDealBoundParentCount
      !== integrationContract.resolvedPublicSourceParentCount
        + integrationContract.sampleResearchScreeningParentCount
  ) issue("Research Deal-bound parent count must equal public plus sample parents");
  if (
    integrationContract.totalDealBoundParentCount
      !== integrationContract.existingDealBoundParentCount
        + integrationContract.researchDealBoundParentCount
  ) issue("Total Deal-bound parent count must equal existing plus research parents");
  const selectedCaseIds = selectedEntries.map((entry) => entry.caseId);
  const selectedCaseIdSet = new Set(selectedCaseIds);
  if (
    selectedEntries.length !== selectedCases.size ||
    selectedCaseIdSet.size !== selectedCases.size ||
    selectedCaseIds.some((id) => !selectedCases.has(id)) ||
    [...selectedCases.keys()].some((id) => !selectedCaseIdSet.has(id))
  ) {
    issue("Selected ledger case IDs must be a one-to-one set match with selected cases");
  }
  for (const entry of selectedEntries) {
    const selectedCase = selectedCases.get(entry.caseId);
    if (
      selectedCase && (
        entry.companyId !== selectedCase.companyId ||
        JSON.stringify(entry.entityKeys) !== JSON.stringify(selectedCase.entityKeys) ||
        entry.companyIdentity.brandName !== selectedCase.profile.brandName.value ||
        entry.companyIdentity.officialDomain !== selectedCase.profile.officialDomain.value
      )
    ) {
      issue(`${entry.id} selected company identity must match its selected case company, entity keys, brand, and domain`);
    }
  }
  const centralize = researchPackage.candidateLedger.find((entry) => entry.companyIdentity.brandName === "Centralize");
  if (centralize?.disposition !== "qualified_not_selected") issue("Centralize must be qualified_not_selected");
  const requiredResearchDeals = new Map([
    ["Centralize", "deal_centralize_v1"],
    ["ChipAgents", "deal_chipagents_v1"],
    ["Sent", "deal_sent_v1"],
    ["Cascade", "deal_cascade_v1"],
    ["Cordant", "deal_cordant_v1"],
    ["Empirical Security", "deal_empirical_security_v1"],
    ["Freight Hero", "deal_freight_hero_v1"],
  ] as const);
  for (const [requiredName, requiredDealId] of requiredResearchDeals) {
    if (!researchPackage.candidateLedger.some((entry) =>
      entry.companyIdentity.brandName === requiredName
      && entry.disposition === "qualified_not_selected"
      && entry.stableDealId === requiredDealId
    )) {
      issue(`Candidate ledger is missing qualified_not_selected screening Deal ${requiredName}`);
    }
  }
  const cordant = researchPackage.candidateLedger.find(
    (entry) => entry.companyIdentity.brandName === "Cordant",
  );
  if (
    cordant?.disposition !== "qualified_not_selected"
    || !/production customer/iu.test(cordant.missingEvidence.join(" "))
    || !/(?:enterprise AI.*core|core.*enterprise AI)/iu.test(cordant.missingEvidence.join(" "))
    || !/(?:unverified|insufficient)/iu.test(cordant.notSelectedReason)
  ) {
    issue("Cordant evidence limits must preserve unverified production customer and core enterprise-AI evidence");
  }
});

type MutableResearchPackage = z.infer<typeof BeliefReversalResearchPackageSchema>;

export type DeepReadonly<T> =
  T extends (...args: never[]) => unknown ? T
    : T extends readonly (infer U)[] ? readonly DeepReadonly<U>[]
      : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
        : T;

export type BeliefReversalResearchPackage = DeepReadonly<MutableResearchPackage>;

export function parseBeliefReversalManifest(input: unknown): BeliefReversalResearchPackage {
  return deepFreeze(BeliefReversalResearchPackageSchema.parse(input));
}

function sourceFingerprintInputs(
  source: {
    title: string;
    publisher: string;
    canonicalUrl: string;
    sourceClass: z.infer<typeof SourceClassSchema>;
    sourceAuthority: z.infer<typeof SourceAuthoritySchema>;
    evidenceRole: z.infer<typeof EvidenceRoleSchema>;
    eventAt: string | null;
    publishedAt: string | null;
    publicationTimestamp: string | null;
    retrievedAt: string;
    locator: string;
    verbatimExcerpt: string;
    normalizedStatement: string;
  },
  referenceId: string,
): z.infer<typeof FingerprintInputsSchema> {
  return {
    title: source.title,
    publisher: source.publisher,
    canonicalUrl: source.canonicalUrl,
    sourceClass: source.sourceClass,
    sourceAuthority: source.sourceAuthority,
    evidenceRole: source.evidenceRole,
    eventAt: source.eventAt,
    publishedAt: source.publishedAt,
    publicationTimestamp: source.publicationTimestamp,
    retrievedAt: source.retrievedAt,
    locator: source.locator,
    verbatimExcerpt: source.verbatimExcerpt,
    normalizedStatement: source.normalizedStatement,
    referenceId,
  };
}

function researchSourceFingerprintInputs(
  source: Parameters<typeof sourceFingerprintInputs>[0] & {
    entityKeys: readonly string[];
  },
  referenceId: string,
): z.infer<typeof ResearchFingerprintInputsSchema> {
  return {
    ...sourceFingerprintInputs(source, referenceId),
    entityKeys: [...source.entityKeys],
  };
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
