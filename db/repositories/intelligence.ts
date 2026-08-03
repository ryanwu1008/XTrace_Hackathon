import {
  CompanyAnalysisSchema,
  EvidenceCoverageSchema,
  OpportunityReportItemSchema,
  ReportAnalysisStatusSchema,
  type CompanyAnalysis,
  type CompanyAnalysisCounts,
  type EvidenceSourceRef,
  type EvidenceCoverage,
  type OpportunityReportItem,
  type ReportAnalysisStatus,
} from "../../lib/contracts/domain";
import {
  IntegrationTransportError,
  isRetryableTransportStatus,
} from "../../lib/api/errors";
import {
  parseMarketEventV2Read,
  parseSourceRefV2Read,
} from "../../lib/contracts/legacy-evidence-adapter";
import {
  assertConsistentCanonicalEvidenceUnits,
  uniqueByCanonicalId,
  WritableMarketEventV2Schema,
  WritableSourceRefV2Schema,
  type MarketEventV2,
  type SourceRefV2,
  type WritableMarketEventV2,
} from "../../lib/contracts/source-evidence";
import {
  assertCanonicalMarketEventUrls,
  coalesceEquivalentTriggerAcquisitions,
  dedupeEvents,
  withinPublicationWindow,
} from "../../lib/market/dedupe";
import { assertMarketEventFingerprint } from "../../lib/market/identity";
import { canonicalMarketObservationKey } from "../../lib/market/observation";
import { compareUtf8 } from "../../lib/format/canonical-order";
import { sanitizeReportOpportunities } from "../../lib/reports/next-step-policy";
import { rankBeliefRevisionCandidates } from "../../lib/matching/ranking";
import { afterReset, filterAfterReset } from "./test-generations";
import {
  getDealRegistry,
  type DealRegistry,
} from "./deal-registry";
import {
  parseReportEvidenceContextRow,
  parseRunEvidenceContextRow,
  type ReportEvidenceContext,
  type RunEvidenceContext,
} from "../../lib/contracts/evidence-context";

const MARKET_EVENT_WINDOW_DAYS = 14;

interface IntelligenceRepositoryClockOptions {
  now?: () => Date;
  dealRegistry?: DealRegistry;
}

interface IntelligenceReportIdentity {
  id: string;
  workspaceId: string;
  runId: string;
  createdAt: string;
  marketSummary: string;
}

export interface IntelligenceReportWrite extends IntelligenceReportIdentity {
  opportunities: OpportunityReportItem[];
  evidenceBindingFingerprint?: string;
  // Internal write-time snapshot. It validates that every Deal selected by the
  // authoritative registry received an analysis, but is not added to legacy
  // report response shapes.
  eligibleDealCount?: number;
  eligibleSnapshotFingerprint?: string;
  analysisStatus?: ReportAnalysisStatus;
  evidenceCoverage?: EvidenceCoverage;
  counts?: CompanyAnalysisCounts;
  priorityDealId?: string | null;
  companyAnalyses?: CompanyAnalysis[];
}

export interface IntelligenceReportRecord extends IntelligenceReportIdentity {
  opportunities: OpportunityReportItem[];
  analysisStatus: ReportAnalysisStatus;
  evidenceCoverage: EvidenceCoverage;
  counts: CompanyAnalysisCounts;
  priorityDealId: string | null;
  companyAnalyses: CompanyAnalysis[];
  evidenceContext?: ReportEvidenceContext;
}

export interface IntelligenceRepository {
  saveMarketEvents(
    events: WritableMarketEventV2[],
    workspaceId: string,
  ): Promise<WritableMarketEventV2[]>;
  listMarketEvents(
    workspaceId: string,
    resetAt?: string | null,
  ): Promise<MarketEventV2[]>;
  saveReport(report: IntelligenceReportWrite): Promise<IntelligenceReportRecord>;
  getReport(
    workspaceId: string,
    reportId: string,
  ): Promise<IntelligenceReportRecord | null>;
  getReportByRunId(
    workspaceId: string,
    runId: string,
  ): Promise<IntelligenceReportRecord | null>;
  listReports(
    workspaceId: string,
    resetAt?: string | null,
  ): Promise<IntelligenceReportRecord[]>;
  listDealAnalyses(
    workspaceId: string,
    dealId: string,
  ): Promise<CompanyAnalysis[]>;
  // Demo choreography: wipe every scan product (reports, analyses, finished
  // runs, market events) while keeping the corpus, XTrace lineage, and
  // stored judgments. Queued and running scans survive.
  resetScanProducts(workspaceId: string): Promise<void>;
}

function marketWindowAt(to: Date) {
  if (!Number.isFinite(to.getTime())) {
    throw new TypeError("Market event reads require a valid current time.");
  }
  return {
    from: new Date(
      to.getTime() - MARKET_EVENT_WINDOW_DAYS * 24 * 60 * 60 * 1_000,
    ),
    to,
  };
}

function currentMarketWindow(now: () => Date) {
  return marketWindowAt(now());
}

function validateMarketEventReadBatch(
  values: readonly unknown[],
): MarketEventV2[] {
  const events = values.map(parseMarketEventV2Read);
  for (const event of events) {
    if (event.adaptation === "canonical") {
      assertCanonicalMarketEventUrls(event);
    }
  }
  uniqueByCanonicalId(events, "market event");
  const sources = events.flatMap((event): SourceRefV2[] => [...event.sources]);
  uniqueByCanonicalId(sources, "source");
  assertConsistentCanonicalEvidenceUnits(sources);
  return events;
}

export function buildMarketEventsReadPath(input: {
  workspaceId: string;
  now: Date;
  resetAt?: string | null;
}): string {
  const window = marketWindowAt(input.now);
  const resetFilter = input.resetAt == null
    ? ""
    : `&observed_at=gt.${encodeURIComponent(input.resetAt)}`;
  return `/market_events?workspace_id=eq.${encodeURIComponent(input.workspaceId)}`
    + `&published_at=gte.${encodeURIComponent(`${window.from.toISOString().slice(0, 10)}T00:00:00.000Z`)}`
    + `&published_at=lte.${encodeURIComponent(window.to.toISOString())}`
    + resetFilter
    + "&select=payload&order=published_at.desc";
}

const EMPTY_EVIDENCE_COVERAGE: EvidenceCoverage = {
  acceptedPublicEvents: 0,
  excludedPublicItems: 0,
  truncatedPublicEvents: 0,
  recalledDealCount: 0,
  unavailableDealCount: 0,
};

function countsFromAnalyses(
  analyses: readonly CompanyAnalysis[],
): CompanyAnalysisCounts {
  return {
    companyCount: analyses.length,
    beliefRevised: analyses.filter(
      (analysis) => analysis.outcome === "belief_revised",
    ).length,
    monitor: analyses.filter((analysis) => analysis.outcome === "monitor")
      .length,
    noMaterialChange: analyses.filter(
      (analysis) => analysis.outcome === "no_material_change",
    ).length,
    analysisUnavailable: analyses.filter(
      (analysis) => analysis.outcome === "analysis_unavailable",
    ).length,
  };
}

function projectLegacyOpportunity(input: {
  report: IntelligenceReportWrite;
  opportunity: OpportunityReportItem;
  index: number;
}): CompanyAnalysis | null {
  const { report, opportunity, index } = input;
  const sourceIds = opportunity.sources.map((source) => source.id);
  const candidate = {
    id: `${report.id}:legacy:${opportunity.dealId}`,
    reportId: report.id,
    runId: report.runId,
    dealId: opportunity.dealId,
    companyName: opportunity.dealId,
    dealStatus: "screening",
    outcome: "belief_revised",
    confidence: opportunity.confidence,
    score: opportunity.score,
    verifiedSourceCount: new Set(sourceIds).size,
    investmentMemory: {
      previousMeetingSummary: opportunity.previousContext,
      decisionReason: opportunity.previousContext,
      concerns: [],
      revisitConditions: [],
      lastEvaluatedAt: null,
      memoryIds: [],
      sourceIds,
      fixtureIds: opportunity.demoFixtureIds,
    },
    marketEvidence: {
      relationship: "related",
      explanation: opportunity.whyNow,
      eventIds: [],
      events: [],
      sourceIds,
    },
    implications: opportunity.implications,
    recommendedNextMove: opportunity.nextStep,
    companyBrief: {
      icSnapshot: [{
        label: "Legacy recommendation",
        value: opportunity.whyNow,
        unavailableReason: null,
        sourceIds,
      }],
      traction: [],
      dealTerms: [],
      risks: [],
      decisionHistory: [{
        occurredAt: report.createdAt,
        title: `Legacy recommendation ${index + 1}`,
        summary: opportunity.previousContext,
        sourceIds,
      }],
      sourceLineage: opportunity.sources,
    },
    sources: opportunity.sources,
    createdAt: report.createdAt,
  };
  const parsed = CompanyAnalysisSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function parseCompanyAnalyses(
  report: IntelligenceReportWrite,
): CompanyAnalysis[] {
  if (report.companyAnalyses !== undefined) {
    if (
      report.eligibleDealCount !== undefined
      && (
        !Number.isInteger(report.eligibleDealCount)
        || report.eligibleDealCount < 0
      )
    ) {
      throw new Error(
        "The eligible Deal snapshot count must be a nonnegative integer.",
      );
    }
    if (
      report.eligibleDealCount !== undefined
      && report.companyAnalyses.length !== report.eligibleDealCount
    ) {
      throw new Error(
        `The eligible Deal snapshot contains ${report.eligibleDealCount} Deals, but the report contains ${report.companyAnalyses.length} analyses.`,
      );
    }
    return report.companyAnalyses.map((analysis) =>
      CompanyAnalysisSchema.parse(analysis)
    );
  }

  const opportunities = sanitizeReportOpportunities(report.opportunities);
  return opportunities.flatMap((opportunity, index) => {
    const analysis = projectLegacyOpportunity({ report, opportunity, index });
    return analysis ? [analysis] : [];
  });
}

function validateReportEvidenceBatch(
  opportunities: readonly OpportunityReportItem[],
  analyses: readonly CompanyAnalysis[],
): void {
  validateCompanyAnalysisEvidenceBatch(
    analyses,
    opportunities.flatMap((opportunity) => opportunity.sources),
    "report",
  );
}

function validateCompanyAnalysisEvidenceBatch(
  analyses: readonly CompanyAnalysis[],
  additionalSources: readonly EvidenceSourceRef[],
  label: string,
): void {
  const events = analyses.flatMap((analysis) =>
    analysis.marketEvidence.events
  );
  uniqueByCanonicalId(events, `${label} market event`);
  const sources = [
    ...additionalSources,
    ...analyses.flatMap((analysis) => [
      ...analysis.sources,
      ...analysis.companyBrief.sourceLineage,
      ...analysis.marketEvidence.events.flatMap((event): SourceRefV2[] =>
        "schemaVersion" in event ? [...event.sources] : []
      ),
    ]),
  ];
  uniqueByCanonicalId(sources, `${label} source`);
  assertConsistentCanonicalEvidenceUnits(
    sources.flatMap((source): SourceRefV2[] =>
      "schemaVersion" in source ? [source] : [parseSourceRefV2Read(source)]
    ),
  );
}

function validateReportReadBatch(
  reports: readonly IntelligenceReportRecord[],
): IntelligenceReportRecord[] {
  uniqueByCanonicalId(reports, "workspace report");
  validateCompanyAnalysisEvidenceBatch(
    reports.flatMap((report) => report.companyAnalyses),
    reports.flatMap((report) =>
      report.opportunities.flatMap((opportunity) => opportunity.sources)
    ),
    "workspace report catalog",
  );
  return [...reports];
}

function adaptOpportunityEvidenceRead(
  opportunities: readonly OpportunityReportItem[],
): OpportunityReportItem[] {
  return opportunities.map((opportunity) =>
    OpportunityReportItemSchema.parse({
      ...opportunity,
      sources: opportunity.sources.map(parseSourceRefV2Read),
    })
  );
}

function adaptCompanyAnalysisEvidenceRead(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const sources = Array.isArray(input.sources)
    ? input.sources.map(parseSourceRefV2Read)
    : input.sources;
  const companyBrief = input.companyBrief;
  const briefRecord = companyBrief
      && typeof companyBrief === "object"
      && !Array.isArray(companyBrief)
    ? companyBrief as Record<string, unknown>
    : null;
  const adaptedBrief = companyBrief
      && briefRecord
    ? {
        ...briefRecord,
        sourceLineage: Array.isArray(briefRecord.sourceLineage)
          ? briefRecord.sourceLineage.map(parseSourceRefV2Read)
          : briefRecord.sourceLineage,
      }
    : companyBrief;
  const marketEvidence = input.marketEvidence;
  const marketRecord = marketEvidence
      && typeof marketEvidence === "object"
      && !Array.isArray(marketEvidence)
    ? marketEvidence as Record<string, unknown>
    : null;
  const adaptedMarketEvidence = marketEvidence
      && marketRecord
    ? {
        ...marketRecord,
        events: Array.isArray(marketRecord.events)
          ? marketRecord.events.map((event: unknown) => {
              if (
                event
                && typeof event === "object"
                && (
                  "schemaVersion" in event
                  || "sources" in event
                )
              ) return parseMarketEventV2Read(event);
              // Historical compact report events do not contain enough
              // provenance to construct V2 without inventing fields.
              return event;
            })
          : marketRecord.events,
      }
    : marketEvidence;
  return {
    ...input,
    sources,
    companyBrief: adaptedBrief,
    marketEvidence: adaptedMarketEvidence,
  };
}

function assertWritableReportEvidence(report: IntelligenceReportWrite): void {
  const opportunitySources = report.opportunities.flatMap(
    (opportunity) => opportunity.sources,
  );
  const writableOpportunitySources = opportunitySources.map((source) =>
    WritableSourceRefV2Schema.parse(source)
  );
  if (report.companyAnalyses === undefined) return;
  const analysisSources = report.companyAnalyses.flatMap((analysis) => [
    ...analysis.sources,
    ...analysis.companyBrief.sourceLineage,
  ]);
  const events = report.companyAnalyses.flatMap((analysis) =>
    analysis.marketEvidence.events
  );
  const writableAnalysisSources = analysisSources.map((source) =>
    WritableSourceRefV2Schema.parse(source)
  );
  const writableEvents = events.map((event) => {
    const writable = assertCanonicalMarketEventUrls(
      assertMarketEventFingerprint(WritableMarketEventV2Schema.parse(event)),
    );
    for (const source of writable.sources) {
      WritableSourceRefV2Schema.parse(source);
    }
    return writable;
  });
  uniqueByCanonicalId<MarketEventV2>(
    writableEvents,
    "report market event",
  );
  uniqueByCanonicalId<SourceRefV2>(
    [
      ...writableOpportunitySources,
      ...writableAnalysisSources,
      ...writableEvents.flatMap((event): SourceRefV2[] => [...event.sources]),
    ],
    "report source",
  );
  assertConsistentCanonicalEvidenceUnits([
    ...writableOpportunitySources,
    ...writableAnalysisSources,
    ...writableEvents.flatMap((event): SourceRefV2[] => [...event.sources]),
  ]);
}

function validateCanonicalReportWrite(report: IntelligenceReportWrite): {
  canonicalReport: IntelligenceReportWrite;
  snapshot: { count: number; fingerprint: string };
} {
  if (report.companyAnalyses === undefined) {
    throw new Error(
      "New report writes require complete company analyses and an eligible Deal snapshot.",
    );
  }
  if (!Array.isArray(report.opportunities)) {
    throw new Error("New report writes require an opportunity array.");
  }
  if (
    report.evidenceBindingFingerprint !== undefined
    && !/^sha256:[0-9a-f]{64}$/u.test(report.evidenceBindingFingerprint)
  ) {
    throw new Error("A report evidence binding fingerprint must be canonical SHA-256.");
  }
  // Preserve source-contract diagnostics (unsafe URL, spoofed Sample record,
  // stale event fingerprint) before the aggregate schema reports a generic
  // declared-evidence failure. Both checks remain pre-mutation/pre-network.
  assertWritableReportEvidence(report);
  const canonicalReport: IntelligenceReportWrite = {
    ...report,
    opportunities: report.opportunities.map((opportunity) =>
      OpportunityReportItemSchema.parse(opportunity)
    ),
    companyAnalyses: report.companyAnalyses.map((analysis) =>
      CompanyAnalysisSchema.parse(analysis)
    ),
  };
  const snapshot = validateEligibleSnapshot(canonicalReport);
  if (!snapshot) {
    throw new Error("New report writes require an eligible Deal snapshot.");
  }
  return { canonicalReport, snapshot };
}

async function validateAuthoritativeCurrentReport(
  report: IntelligenceReportWrite,
  dealRegistry: DealRegistry,
): Promise<void> {
  if (report.evidenceBindingFingerprint === undefined) return;
  const analyses = report.companyAnalyses ?? [];
  const deals = await dealRegistry.listForWorkspace(report.workspaceId);
  const historicalStatusByDeal = new Map<string, (typeof deals)[number]["status"]>();
  for (const deal of deals) {
    if (deal.workspaceId !== report.workspaceId) {
      throw new Error("The authoritative Deal registry crossed workspace identity.");
    }
    if (historicalStatusByDeal.has(deal.id)) {
      throw new Error(`The authoritative Deal registry duplicated ${deal.id}.`);
    }
    historicalStatusByDeal.set(deal.id, deal.status);
  }
  for (const analysis of analyses) {
    const status = historicalStatusByDeal.get(analysis.dealId);
    if (status === undefined) {
      throw new Error(`The authoritative Deal registry is missing ${analysis.dealId}.`);
    }
    if (
      status !== analysis.dealStatus
      || (
        analysis.beliefAssessment !== undefined
        && analysis.beliefAssessment.dealStatus !== status
      )
    ) {
      throw new Error(`The authoritative Deal status does not match ${analysis.dealId}.`);
    }
  }
  const rankedIds = rankBeliefRevisionCandidates(analyses, {
    historicalStatusByDeal,
    limit: 5,
  }).map(({ dealId }) => dealId);
  const opportunityIds = report.opportunities.map(({ dealId }) => dealId);
  if (
    rankedIds.length !== opportunityIds.length
    || rankedIds.some((dealId, index) => opportunityIds[index] !== dealId)
  ) {
    throw new Error("The report opportunities do not equal the authoritative Top 5.");
  }
  if ((report.priorityDealId ?? null) !== (rankedIds[0] ?? null)) {
    throw new Error("The report priority Deal does not equal the authoritative Top 5.");
  }
}

function validateEligibleSnapshot(report: IntelligenceReportWrite): {
  count: number;
  fingerprint: string;
} | null {
  if (report.companyAnalyses === undefined) return null;
  if (
    !Number.isInteger(report.eligibleDealCount)
    || (report.eligibleDealCount ?? -1) < 0
  ) {
    throw new Error(
      "A new analysis report requires an eligible Deal snapshot count.",
    );
  }
  const fingerprint = report.eligibleSnapshotFingerprint?.trim();
  if (!fingerprint) {
    throw new Error(
      "A new analysis report requires an eligible snapshot fingerprint.",
    );
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(fingerprint)) {
    throw new Error(
      "A new analysis report requires a canonical SHA-256 eligible snapshot fingerprint.",
    );
  }
  if (report.companyAnalyses.length !== report.eligibleDealCount) {
    throw new Error(
      `The eligible Deal snapshot contains ${report.eligibleDealCount} Deals, but the report contains ${report.companyAnalyses.length} analyses.`,
    );
  }
  if (
    report.counts
    && report.counts.companyCount !== report.eligibleDealCount
  ) {
    throw new Error(
      "The report company count does not match the eligible Deal snapshot.",
    );
  }
  return { count: report.eligibleDealCount, fingerprint };
}

/** Durable read projection; legacy evidence is adapted here, never written. */
function projectReportRead(
  report: IntelligenceReportWrite,
): IntelligenceReportRecord {
  const cloned = structuredClone(report);
  const legacyShape = { ...cloned };
  delete legacyShape.eligibleDealCount;
  delete legacyShape.eligibleSnapshotFingerprint;
  delete legacyShape.evidenceBindingFingerprint;
  const workspaceId = requiredWorkspaceId(cloned.workspaceId);
  const opportunities = adaptOpportunityEvidenceRead(
    sanitizeReportOpportunities(cloned.opportunities),
  );
  const companyAnalyses = parseCompanyAnalyses({
    ...cloned,
    opportunities,
  });
  validateReportEvidenceBatch(opportunities, companyAnalyses);
  const counts = companyAnalyses.length > 0
    ? countsFromAnalyses(companyAnalyses)
    : cloned.counts ?? countsFromAnalyses([]);
  return {
    ...legacyShape,
    workspaceId,
    opportunities,
    analysisStatus: ReportAnalysisStatusSchema.parse(
      cloned.analysisStatus ?? "completed",
    ),
    evidenceCoverage: EvidenceCoverageSchema.parse(
      cloned.evidenceCoverage ?? EMPTY_EVIDENCE_COVERAGE,
    ),
    counts,
    priorityDealId: cloned.priorityDealId
      ?? companyAnalyses.find(
        (analysis) => analysis.outcome === "belief_revised",
      )?.dealId
      ?? null,
    companyAnalyses,
  };
}

function requiredWorkspaceId(workspaceId: string): string {
  const normalized = workspaceId?.trim();
  if (!normalized) throw new Error("A workspace is required.");
  return normalized;
}

function writableMarketEventBatch(items: readonly unknown[]) {
  const events = items.map((item) =>
    assertCanonicalMarketEventUrls(
      assertMarketEventFingerprint(WritableMarketEventV2Schema.parse(item)),
    )
  );
  uniqueByCanonicalId(events, "market event");
  uniqueByCanonicalId(events.flatMap((event) => event.sources), "source");
  return dedupeEvents(events).map((event) =>
    WritableMarketEventV2Schema.parse(event)
  );
}

function marketObservationInvariant(event: WritableMarketEventV2): string {
  return canonicalMarketObservationKey(event);
}

function reconcileMarketObservations(
  existing: readonly MarketEventV2[],
  incoming: readonly WritableMarketEventV2[],
): WritableMarketEventV2[] {
  const coalescedIncoming = coalesceEquivalentTriggerAcquisitions(
    incoming,
    existing,
  ).map((event) => WritableMarketEventV2Schema.parse(event));
  const byObservation = new Map<string, WritableMarketEventV2>();
  for (const candidate of existing) {
    if (candidate.adaptation !== "canonical") continue;
    const event = WritableMarketEventV2Schema.parse(candidate);
    const key = marketObservationInvariant(event);
    const prior = byObservation.get(key);
    if (prior && prior.id !== event.id) {
      throw new Error(
        "Durable market evidence contains duplicate canonical observations.",
      );
    }
    byObservation.set(key, event);
  }

  const resolved: WritableMarketEventV2[] = [];
  for (const event of coalescedIncoming) {
    const key = marketObservationInvariant(event);
    const prior = byObservation.get(key);
    if (prior) {
      resolved.push(prior);
      continue;
    }
    byObservation.set(key, event);
    resolved.push(event);
  }
  return uniqueByCanonicalId(resolved, "market event");
}

function workspaceIdentity(workspaceId: string, externalId: string): string {
  return JSON.stringify([requiredWorkspaceId(workspaceId), externalId]);
}

export function createMemoryIntelligenceRepository(
  options: IntelligenceRepositoryClockOptions = {},
): IntelligenceRepository {
  const events = new Map<string, {
    workspaceId: string;
    observedAt: string;
    event: WritableMarketEventV2;
  }>();
  const reports = new Map<string, IntelligenceReportRecord>();
  const snapshots = new Map<string, {
    runId: string;
    count: number | null;
    fingerprint: string | null;
    evidenceBindingFingerprint: string | null;
  }>();
  const resetAtByWorkspace = new Map<string, string>();
  const now = options.now ?? (() => new Date());
  const dealRegistry = options.dealRegistry ?? getDealRegistry();
  function reportCatalogForWorkspace(
    workspaceId: string,
    includeHidden = false,
  ): IntelligenceReportRecord[] {
    const resetAt = resetAtByWorkspace.get(workspaceId) ?? null;
    const catalog = [...reports.values()]
      .filter((report) =>
        report.workspaceId === workspaceId
        && (includeHidden || afterReset(report.createdAt, resetAt))
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((report) => structuredClone(report));
    return validateReportReadBatch(catalog);
  }
  return {
    async saveMarketEvents(items, workspaceId) {
      workspaceId = requiredWorkspaceId(workspaceId);
      const validatedItems = writableMarketEventBatch(items);
      const existing = validateMarketEventReadBatch([...events.values()]
        .filter((row) => row.workspaceId === workspaceId)
        .map((row) => row.event));
      uniqueByCanonicalId([...existing, ...validatedItems], "market event");
      uniqueByCanonicalId(
        [...existing, ...validatedItems].flatMap(
          (event): SourceRefV2[] => [...event.sources],
        ),
        "source",
      );
      const canonicalItems = reconcileMarketObservations(
        existing,
        validatedItems,
      );
      const observedAt = now().toISOString();
      for (const event of canonicalItems) {
        events.set(workspaceIdentity(workspaceId, event.id), {
          workspaceId,
          observedAt,
          event: structuredClone(event),
        });
      }
      return structuredClone(canonicalItems);
    },
    async listMarketEvents(workspaceId, resetAt = null) {
      const { to } = currentMarketWindow(now);
      const logicalResetAt = resetAtByWorkspace.get(workspaceId) ?? resetAt;
      const rows = [...events.values()]
        .filter((row) =>
          row.workspaceId === workspaceId
          && afterReset(row.observedAt, logicalResetAt)
          && withinPublicationWindow(
            row.event.publishedAt,
            to,
            MARKET_EVENT_WINDOW_DAYS,
          )
        );
      return validateMarketEventReadBatch(
        rows.map((row) => structuredClone(row.event)),
      ).sort((left, right) =>
        compareUtf8(right.publishedAt ?? "", left.publishedAt ?? "")
      );
    },
    async saveReport(report) {
      const { canonicalReport, snapshot } = validateCanonicalReportWrite(report);
      await validateAuthoritativeCurrentReport(canonicalReport, dealRegistry);
      const validated = projectReportRead(canonicalReport);
      const key = workspaceIdentity(validated.workspaceId, validated.id);
      validateReportReadBatch([
        ...reportCatalogForWorkspace(validated.workspaceId, true).filter(
          (existing) => existing.id !== validated.id,
        ),
        validated,
      ]);
      const existingSnapshot = snapshots.get(key);
      const submittedSnapshot = {
        runId: validated.runId,
        count: snapshot.count,
        fingerprint: snapshot.fingerprint,
        evidenceBindingFingerprint:
          canonicalReport.evidenceBindingFingerprint ?? null,
      };
      if (
        existingSnapshot
        && (
          existingSnapshot.runId !== submittedSnapshot.runId
          || existingSnapshot.count !== submittedSnapshot.count
          || existingSnapshot.fingerprint
            !== submittedSnapshot.fingerprint
          || existingSnapshot.evidenceBindingFingerprint
            !== submittedSnapshot.evidenceBindingFingerprint
        )
      ) {
        throw new Error(
          "The report's eligible Deal snapshot is immutable and cannot be replaced with a different snapshot.",
        );
      }
      reports.set(
        key,
        structuredClone(validated),
      );
      snapshots.set(key, submittedSnapshot);
      return structuredClone(validated);
    },
    async getReport(workspaceId, reportId) {
      return reportCatalogForWorkspace(workspaceId).find(
        (report) => report.id === reportId,
      ) ?? null;
    },
    async getReportByRunId(workspaceId, runId) {
      return reportCatalogForWorkspace(workspaceId).find(
        (report) => report.runId === runId,
      ) ?? null;
    },
    async listReports(workspaceId, resetAt = null) {
      const catalog = reportCatalogForWorkspace(workspaceId);
      return filterAfterReset(catalog, resetAt);
    },
    async listDealAnalyses(workspaceId, dealId) {
      return reportCatalogForWorkspace(workspaceId)
        .flatMap((report) => report.companyAnalyses)
        .filter((analysis) => analysis.dealId === dealId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((analysis) => structuredClone(analysis));
    },
    async resetScanProducts(workspaceId) {
      workspaceId = requiredWorkspaceId(workspaceId);
      resetAtByWorkspace.set(workspaceId, now().toISOString());
    },
  };
}

export function createSupabaseIntelligenceRepository(options: {
  url: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  dealRegistry?: DealRegistry;
}): IntelligenceRepository {
  const base = `${options.url.replace(/\/$/, "")}/rest/v1`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const dealRegistry = options.dealRegistry ?? getDealRegistry();
  const headers = {
    apikey: options.serviceRoleKey,
    authorization: `Bearer ${options.serviceRoleKey}`,
    "content-type": "application/json",
  };
  async function request(path: string, init: RequestInit = {}) {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        ...init,
        headers: { ...headers, ...(init.headers ?? {}) },
        cache: "no-store",
      });
    } catch {
      throw new IntegrationTransportError({ retryable: true });
    }
    if (!response.ok) {
      throw new IntegrationTransportError({
        retryable: isRetryableTransportStatus(response.status),
      });
    }
    if (response.status === 204) return null;
    const body = await response.text();
    return body.trim() ? JSON.parse(body) : null;
  }
  function toAnalysis(
    row: Record<string, unknown>,
  ): CompanyAnalysis | null {
    if (!Array.isArray(row.source_refs)) return null;
    const sources = row.source_refs;
    const storedMarketEvidence = row.market_evidence;
    const claimSupport = storedMarketEvidence
        && typeof storedMarketEvidence === "object"
        && !Array.isArray(storedMarketEvidence)
        && "claimSupport" in storedMarketEvidence
      ? storedMarketEvidence.claimSupport
      : undefined;
    const assessmentColumns = [
      row.belief_assessment_version,
      row.belief_direction,
      row.belief_score_breakdown,
      row.belief_gate_context,
      row.belief_gate_results,
      row.belief_actions,
    ];
    const declaresAssessment = assessmentColumns.some(
      (value) => value !== null && value !== undefined,
    );
    if (declaresAssessment && assessmentColumns.some(
      (value) => value === null || value === undefined,
    )) {
      throw new Error("Partial declared belief assessment is not readable.");
    }
    const candidate = adaptCompanyAnalysisEvidenceRead({
      id: row.id,
      reportId: row.report_id,
      runId: row.run_id,
      dealId: row.deal_id,
      companyName: row.company_name,
      dealStatus: row.deal_status,
      outcome: row.outcome,
      confidence: row.confidence,
      score: row.score,
      verifiedSourceCount: new Set(
        sources.flatMap((source) =>
          source && typeof source === "object" && "id" in source
            ? [String(source.id)]
            : []
        ),
      ).size,
      investmentMemory: row.investment_memory,
      marketEvidence: storedMarketEvidence,
      implications: row.implications,
      recommendedNextMove: row.recommended_next_move,
      companyBrief: row.company_brief,
      sources,
      claimSupport,
      beliefAssessment: declaresAssessment ? {
        schemaVersion: row.belief_assessment_version,
        dealStatus: row.deal_status,
        direction: row.belief_direction,
        scoreBreakdown: row.belief_score_breakdown,
        gateContext: row.belief_gate_context,
        gates: row.belief_gate_results,
        actions: row.belief_actions,
      } : undefined,
      createdAt: row.created_at,
    });
    if (declaresAssessment) {
      try {
        return CompanyAnalysisSchema.parse(candidate);
      } catch (error) {
        throw new Error("Invalid declared belief assessment.", { cause: error });
      }
    }
    const parsed = CompanyAnalysisSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }
  function toReport(
    row: Record<string, unknown>,
    analyses: CompanyAnalysis[] = [],
    runContext: RunEvidenceContext = { state: "legacy_unbound" },
  ): IntelligenceReportRecord {
    const report = projectReportRead({
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      runId: String(row.run_id),
      createdAt: String(row.created_at),
      marketSummary: String(row.market_summary),
      opportunities: sanitizeReportOpportunities(row.opportunities),
      analysisStatus: ReportAnalysisStatusSchema.catch("completed").parse(
        row.analysis_status,
      ),
      evidenceCoverage: EvidenceCoverageSchema.catch(
        EMPTY_EVIDENCE_COVERAGE,
      ).parse(row.evidence_coverage),
      counts: {
        companyCount: Number(row.company_count ?? analyses.length),
        beliefRevised: Number(row.belief_revised_count ?? 0),
        monitor: Number(row.monitor_count ?? 0),
        noMaterialChange: Number(row.no_material_change_count ?? 0),
        analysisUnavailable: Number(
          row.analysis_unavailable_count ?? 0,
        ),
      },
      priorityDealId: row.priority_deal_id
        ? String(row.priority_deal_id)
        : null,
      companyAnalyses: analyses,
    });
    return {
      ...report,
      evidenceContext: parseReportEvidenceContextRow(row, runContext),
    };
  }

  async function currentRunContexts(
    workspaceId: string,
    reportRows: readonly Record<string, unknown>[],
  ): Promise<Map<string, RunEvidenceContext>> {
    const runIds = [...new Set(reportRows.map((row) => String(row.run_id)))];
    const contexts = new Map<string, RunEvidenceContext>();
    if (runIds.length === 0) return contexts;
    const filter = `(${runIds.map(encodeURIComponent).join(",")})`;
    const rows = await request(
      `/scan_runs?workspace_id=eq.${encodeURIComponent(workspaceId)}`
      + `&id=in.${filter}&select=id,evidence_context_version,evidence_mode,`
      + "evidence_anchor_at,evidence_window_start_at,evidence_window_end_at,"
      + "evidence_window_timezone,evidence_snapshot_id,"
      + "evidence_snapshot_fingerprint,evidence_context_fingerprint",
    ) as Record<string, unknown>[];
    for (const row of rows) {
      const runId = String(row.id);
      if (contexts.has(runId)) throw new Error(`Duplicate current run ${runId}.`);
      contexts.set(runId, parseRunEvidenceContextRow(row));
    }
    for (const runId of runIds) {
      if (!contexts.has(runId)) {
        throw new Error(`Current report run ${runId} was not found.`);
      }
    }
    return contexts;
  }
  async function analysesForReportIds(
    workspaceId: string,
    reportIds: string[],
  ): Promise<Map<string, CompanyAnalysis[]>> {
    const grouped = new Map<string, CompanyAnalysis[]>();
    if (reportIds.length === 0) return grouped;
    const filter = `(${reportIds.map(encodeURIComponent).join(",")})`;
    const rows = await request(
      `/company_analyses?workspace_id=eq.${encodeURIComponent(workspaceId)}`
      + `&report_id=in.${filter}&order=created_at.asc,company_name.asc`,
    ) as Record<string, unknown>[];
    for (const row of rows) {
      const analysis = toAnalysis(row);
      if (!analysis) continue;
      const current = grouped.get(analysis.reportId) ?? [];
      current.push(analysis);
      grouped.set(analysis.reportId, current);
    }
    return grouped;
  }
  async function reportCatalogForWorkspace(
    rawWorkspaceId: string,
  ): Promise<IntelligenceReportRecord[]> {
    const workspaceId = requiredWorkspaceId(rawWorkspaceId);
    const rows = await request(
      `/intelligence_reports?workspace_id=eq.${encodeURIComponent(workspaceId)}`
      + "&order=created_at.desc",
    ) as Record<string, unknown>[];
    const reportIds = rows.map((row) => String(row.id));
    const analyses = await analysesForReportIds(workspaceId, reportIds);
    const runContexts = await currentRunContexts(workspaceId, rows);
    return validateReportReadBatch(rows.map((row) => {
      const reportId = String(row.id);
      return toReport(
        row,
        analyses.get(reportId) ?? [],
        runContexts.get(String(row.run_id)) ?? { state: "legacy_unbound" },
      );
    }));
  }
  return {
    async saveMarketEvents(items, workspaceId) {
      workspaceId = requiredWorkspaceId(workspaceId);
      const validatedItems = writableMarketEventBatch(items);
      if (!validatedItems.length) return [];
      const existingRows = await request(
        `/market_events?workspace_id=eq.${encodeURIComponent(workspaceId)}`
        + "&select=payload",
      ) as Array<{ payload: unknown }>;
      const existingEvents = validateMarketEventReadBatch(
        existingRows.map((row) => row.payload),
      );
      const allEvents: MarketEventV2[] = [
        ...existingEvents,
        ...validatedItems,
      ];
      uniqueByCanonicalId<MarketEventV2>(
        allEvents,
        "market event",
      );
      uniqueByCanonicalId<SourceRefV2>(
        allEvents.flatMap((event): SourceRefV2[] =>
          [...event.sources]
        ),
        "source",
      );
      const canonicalItems = reconcileMarketObservations(
        existingEvents,
        validatedItems,
      );
      const observedAt = now().toISOString();
      await request("/market_events?on_conflict=workspace_id,id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(canonicalItems.map((event) => ({
          workspace_id: workspaceId,
          id: event.id,
          published_at: event.publishedAt,
          observed_at: observedAt,
          payload: event,
        }))),
      });
      return structuredClone(canonicalItems);
    },
    async listMarketEvents(workspaceId, resetAt = null) {
      const readNow = now();
      const rows = await request(
        buildMarketEventsReadPath({ workspaceId, now: readNow, resetAt }),
      ) as Array<{ payload: unknown }>;
      return validateMarketEventReadBatch(rows.map((row) => row.payload))
        .filter((event) =>
          event.publishedAt !== null
          && withinPublicationWindow(
            event.publishedAt,
            readNow,
            MARKET_EVENT_WINDOW_DAYS,
          )
        );
    },
    async saveReport(report) {
      const { canonicalReport, snapshot } = validateCanonicalReportWrite(report);
      await validateAuthoritativeCurrentReport(canonicalReport, dealRegistry);
      const validated = projectReportRead(canonicalReport);
      const analysesToPersist = canonicalReport.companyAnalyses === undefined
        ? []
        : validated.companyAnalyses;
      const existingCatalog = await reportCatalogForWorkspace(
        validated.workspaceId,
      );
      validateReportReadBatch([
        ...existingCatalog.filter((existing) => existing.id !== validated.id),
        validated,
      ]);
      const rows = await request("/rpc/save_intelligence_report", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          p_report: {
            id: validated.id,
            workspaceId: validated.workspaceId,
            runId: validated.runId,
            createdAt: validated.createdAt,
            marketSummary: validated.marketSummary,
            opportunities: validated.opportunities,
            analysisStatus: validated.analysisStatus,
            companyCount: validated.counts.companyCount,
            beliefRevisedCount: validated.counts.beliefRevised,
            monitorCount: validated.counts.monitor,
            noMaterialChangeCount: validated.counts.noMaterialChange,
            analysisUnavailableCount:
              validated.counts.analysisUnavailable,
            priorityDealId: validated.priorityDealId,
            evidenceCoverage: validated.evidenceCoverage,
            eligibleSnapshotCount: snapshot.count,
            eligibleSnapshotFingerprint: snapshot.fingerprint,
            evidenceBindingFingerprint:
              canonicalReport.evidenceBindingFingerprint ?? null,
          },
          p_analyses: analysesToPersist.map((analysis) => ({
            ...analysis,
            workspaceId: validated.workspaceId,
            marketEvidence: {
              ...analysis.marketEvidence,
              claimSupport: analysis.claimSupport ?? [],
            },
            sourceRefs: analysis.sources,
            beliefAssessmentVersion: analysis.beliefAssessment?.schemaVersion ?? null,
            beliefDirection: analysis.beliefAssessment?.direction ?? null,
            beliefScoreBreakdown: analysis.beliefAssessment?.scoreBreakdown ?? null,
            beliefGateContext: analysis.beliefAssessment?.gateContext ?? null,
            beliefGateResults: analysis.beliefAssessment?.gates ?? null,
            beliefActions: analysis.beliefAssessment?.actions ?? null,
          })),
        }),
      }) as Record<string, unknown>[];
      if (!rows[0]) throw new Error("Report save returned no row.");
      const runContexts = await currentRunContexts(
        validated.workspaceId,
        rows,
      );
      return toReport(
        rows[0],
        validated.companyAnalyses,
        runContexts.get(validated.runId) ?? { state: "legacy_unbound" },
      );
    },
    async getReport(workspaceId, reportId) {
      return (await reportCatalogForWorkspace(workspaceId)).find(
        (report) => report.id === reportId,
      ) ?? null;
    },
    async getReportByRunId(workspaceId, runId) {
      return (await reportCatalogForWorkspace(workspaceId)).find(
        (report) => report.runId === runId,
      ) ?? null;
    },
    async listReports(workspaceId, resetAt = null) {
      return filterAfterReset(
        await reportCatalogForWorkspace(workspaceId),
        resetAt,
      );
    },
    async listDealAnalyses(workspaceId, dealId) {
      return (await reportCatalogForWorkspace(workspaceId))
        .flatMap((report) => report.companyAnalyses)
        .filter((analysis) => analysis.dealId === dealId)
        .sort((left, right) =>
          right.createdAt.localeCompare(left.createdAt)
        );
    },
    async resetScanProducts(workspaceId) {
      workspaceId = requiredWorkspaceId(workspaceId);
      await request("/rpc/reset_intelligence_products", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ p_workspace_id: workspaceId }),
      });
    },
  };
}

let singleton: IntelligenceRepository | undefined;

export function getIntelligenceRepository(): IntelligenceRepository {
  if (singleton) return singleton;
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  singleton = url && serviceRoleKey
    ? createSupabaseIntelligenceRepository({ url, serviceRoleKey })
    : createMemoryIntelligenceRepository();
  return singleton;
}
