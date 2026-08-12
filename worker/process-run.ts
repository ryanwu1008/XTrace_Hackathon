import { createHash } from "node:crypto";

import type { RunRecord } from "../db/client";
import type {
  IntelligenceReportRecord,
  IntelligenceReportWrite,
  IntelligenceRepository,
} from "../db/repositories/intelligence";
import {
  eligibleDealSnapshotFingerprint,
  type DealRegistry,
  type RegisteredDeal,
  type RunDealUniverseBindingV1,
} from "../db/repositories/deal-registry";
import type { createRunsRepository } from "../db/repositories/runs";
import {
  OpportunityReportItemSchema,
  type CompanyAnalysis,
  type DealMemoryBundle,
  type OpportunityReportItem,
} from "../lib/contracts/domain";
import type { ProductInputGate } from "../lib/corpus/import-readiness";
import { parseSourceRefV2Read } from "../lib/contracts/legacy-evidence-adapter";
import { sourceTextForRetrieval } from "../lib/contracts/source-evidence";
import { rankBeliefRevisionCandidates } from "../lib/matching/ranking";
import { DEMO_MARKET_REPORT_EVIDENCE } from "../lib/corpus/market-evidence";
import {
  buildMatchingSources,
  buildStructuredMemoryContexts,
  isSampleResearchScreeningAuthoritySource,
  projectRecalledCanonicalSourceIds,
  researchScreeningPriorCandidates,
} from "../lib/matching/context";
import type {
  GroundedMatch,
  MatchingMemoryContext,
  MatchingReasoner,
} from "../lib/matching/service";
import { createMatchingService } from "../lib/matching/service";
import { safeMatchingFailureDiagnostic } from "../lib/matching/failure";
import {
  selectMarketEventsForAnalysis,
  type MarketEventSelection,
} from "../lib/market/selection";
import { classifyMarketEventForAnalysis } from "../lib/market/classification";
import { canonicalEvidenceJson } from "../lib/contracts/source-evidence";
import { compareUtf8 } from "../lib/format/canonical-order";
import type { MarketService } from "../lib/market/service";
import type { MemoryContext } from "../lib/xtrace/service";
import type { PersistedIngest } from "../lib/xtrace/service";
import {
  STRUCTURED_IMAGE_EVIDENCE_PREFIX,
} from "../lib/uploads/structured-image-evidence";
import {
  buildCompanyAnalyses,
  countCompanyAnalyses,
} from "../lib/reports/company-analysis";
import type {
  UnderwritingOrchestrator,
} from "../lib/underwriting/orchestrator";
import { recallAllDealContexts } from "./recall-deal-contexts";
import type {
  CurrentRunEvidenceContextV1,
  RunEvidenceBindingV1,
} from "../lib/contracts/evidence-context";
import { reportEvidenceContextFromBinding } from "../lib/contracts/evidence-context";
import { APPROVED_PINNED_DEMO_SNAPSHOT_ID } from "../lib/contracts/evidence-context";
import { SAMPLE_RESEARCH_SCREENING_RECORD_LABEL } from "../lib/contracts/research-candidate";
import type { MarketScanResult } from "../lib/market/types";
import { assertPinnedThirtyDealUniverse } from "../lib/belief-reversal/pinned-thirty-deal-snapshot";

type RunsRepository = ReturnType<typeof createRunsRepository>;

export interface ProcessRunDependencies {
  runs: RunsRepository;
  intelligence: IntelligenceRepository;
  dealRegistry: Pick<
    DealRegistry,
    | "getAnalysisEligibleSnapshot"
    | "listAnalysisEligibleBundles"
    | "findForWorkspace"
    | "bindRunDealUniverse"
    | "getRunDealUniverse"
  >;
  underwriting: UnderwritingOrchestrator;
  importGate: ProductInputGate;
  market: Pick<MarketService, "scanMarketWindow">;
  reasoner: MatchingReasoner;
  xtrace?: {
    listOpenIngestJobs(workspaceId: string): Promise<Array<{
      jobId: string;
      dealId: string;
    }>>;
    pollIngestJob(jobId: string, options: {
      dealId: string;
    }): Promise<PersistedIngest>;
    recallDealContext(input: {
      workspaceId: string;
      runId?: string;
      query: string;
      candidateDealIds: string[];
      limit: number;
      evidenceContextFingerprint?: string;
      activeParentFingerprint?: string;
    }): Promise<MemoryContext[]>;
  };
  now?: () => Date;
}

type ResolvedRunEvidenceRuntime = {
  context: CurrentRunEvidenceContextV1;
  binding: RunEvidenceBindingV1;
  events: RunEvidenceBindingV1["events"];
  selection: MarketEventSelection;
  contextFingerprint: string;
  eventSetFingerprint: string;
  bindingFingerprint: string;
  snapshotId: string | null;
  snapshotFingerprint: string | null;
} & (
  | { evidenceMode: "live"; providerResult: MarketScanResult }
  | { evidenceMode: "pinned"; providerResult: null }
);

export async function processClaimedRun(
  claimedRun: RunRecord,
  dependencies: ProcessRunDependencies,
): Promise<{ run: RunRecord; report: IntelligenceReportRecord }> {
  const now = dependencies.now ?? (() => new Date());
  const warnings: string[] = [];
  const workerId = claimedRun.workerId;
  if (!workerId) throw new Error(`Run ${claimedRun.id} has no owning worker`);
  let bundles: DealMemoryBundle[] = [];
  let eligibleDeals: RegisteredDeal[] = [];
  let eligibleSnapshotFingerprint = "";
  let boundDealUniverse: RunDealUniverseBindingV1 | null = null;
  let activeStage = claimedRun.currentStage ?? "worker_setup";
  let activeStageStatus:
    | "running"
    | "skipped"
    | "completed"
    | "failed"
    | undefined;
  let evidenceBindingFingerprint: string | undefined;
  if (claimedRun.evidenceContext.state !== "current") {
    throw new Error("Legacy-unbound runs cannot execute Worker analysis.");
  }
  const updateStage = async (
    name: string,
    status: "running" | "skipped" | "completed" | "failed",
    warning?: string,
  ) => {
    activeStage = name;
    activeStageStatus = status;
    return stage(
      dependencies.runs,
      claimedRun.workspaceId,
      claimedRun.id,
      workerId,
      name,
      status,
      warning,
    );
  };

  try {
    await updateStage("import_confirmation", "running");
    try {
      await dependencies.importGate.assertReady(claimedRun.workspaceId);
      const snapshotBefore = await dependencies.dealRegistry
        .getAnalysisEligibleSnapshot(claimedRun.workspaceId);
      bundles = structuredClone(
        await dependencies.dealRegistry.listAnalysisEligibleBundles(
          claimedRun.workspaceId,
        ),
      );
      eligibleDeals = await Promise.all(
        bundles.map(async ({ dealId }) => {
          const deal = await dependencies.dealRegistry.findForWorkspace({
            workspaceId: claimedRun.workspaceId,
            dealId,
          });
          if (
            !deal
            || deal.analysisEligibleAt === null
            || deal.activeSourceRevisionIds.length === 0
            || !deal.activeSourceRevisionFingerprint
          ) {
            throw new Error(
              `Analysis-eligible Deal ${dealId} is missing its immutable registry revision snapshot.`,
            );
          }
          return structuredClone(deal);
        }),
      );
      const registrySnapshotFingerprint =
        eligibleDealSnapshotFingerprint(eligibleDeals);
      const snapshotAfter = await dependencies.dealRegistry
        .getAnalysisEligibleSnapshot(claimedRun.workspaceId);
      const bundleIds = bundles.map(({ dealId }) => dealId).sort();
      if (
        snapshotBefore.fingerprint !== snapshotAfter.fingerprint
        || snapshotAfter.fingerprint !== registrySnapshotFingerprint
        || snapshotAfter.count !== bundles.length
        || JSON.stringify([...snapshotAfter.dealIds].sort())
          !== JSON.stringify(bundleIds)
      ) {
        throw new Error(
          "The eligible Deal snapshot changed while the scan was starting.",
        );
      }
      const selectedUniverse = selectRunDealUniverse({
        run: claimedRun,
        bundles,
        deals: eligibleDeals,
      });
      bundles = selectedUniverse.bundles;
      eligibleDeals = selectedUniverse.deals;
      assertPinnedThirtyDealUniverse({
        snapshotId: claimedRun.evidenceContext.snapshotId,
        deals: eligibleDeals,
      });
      eligibleSnapshotFingerprint =
        eligibleDealSnapshotFingerprint(eligibleDeals);
      boundDealUniverse = await dependencies.dealRegistry.bindRunDealUniverse({
        workspaceId: claimedRun.workspaceId,
        runId: claimedRun.id,
        universeId: `deal_universe_${claimedRun.id}`,
        mode: claimedRun.evidenceContext.evidenceMode,
        anchorAt: claimedRun.evidenceContext.anchorAt,
        evidenceSnapshotId: claimedRun.evidenceContext.snapshotId,
        evidenceSnapshotFingerprint:
          claimedRun.evidenceContext.snapshotFingerprint,
        members: eligibleDeals.map((deal, ordinal) => ({
          ordinal,
          dealId: deal.id,
          companyId: deal.companyId,
          dealStatus: deal.status,
          analysisEligibleAt: deal.analysisEligibleAt!,
        })),
      });
      const reloadedUniverse = await dependencies.dealRegistry
        .getRunDealUniverse({
          workspaceId: claimedRun.workspaceId,
          runId: claimedRun.id,
        });
      if (
        reloadedUniverse === null
        || JSON.stringify(reloadedUniverse) !== JSON.stringify(boundDealUniverse)
      ) {
        throw new Error(
          "The claimed run did not reload its exact immutable Deal universe.",
        );
      }
      await updateStage("import_confirmation", "completed");
    } catch (error) {
      const warning = error instanceof Error
        ? error.message
        : "The fixed MVP corpus is not confirmed.";
      await updateStage("import_confirmation", "failed", warning);
      throw error;
    }

    const portfolioTexts = new Map(bundles.map(
      (bundle) => [bundle.dealId, [
        bundle.companyName,
        ...bundle.facts.map((fact) => fact.text),
        ...bundle.interactions.flatMap((interaction) => [
          interaction.summary,
          interaction.decisionReason,
          ...interaction.concerns,
          ...interaction.revisitConditions,
        ]),
      ]],
    ));
    await updateStage("market_scan", "running");
    const evidenceRuntime: ResolvedRunEvidenceRuntime =
      claimedRun.evidenceContext.evidenceMode === "pinned"
        ? await resolvePinnedEvidenceRuntime(claimedRun, dependencies.runs)
        : await resolveLiveEvidenceRuntime({
            claimedRun,
            context: claimedRun.evidenceContext,
            dependencies,
            portfolioTexts,
            retrievedAt: now(),
          });
    const analysisEvents = evidenceRuntime.events;
    evidenceBindingFingerprint = evidenceRuntime.bindingFingerprint;
    const marketSelection = evidenceRuntime.selection;
    const market: MarketScanResult = evidenceRuntime.providerResult ?? {
      status: "completed",
      window: {
        from: evidenceRuntime.context.windowStartAt,
        to: evidenceRuntime.context.windowEndAt,
        days: 14,
      },
      events: analysisEvents,
      providers: [],
    };
    const marketWarnings: string[] = [];
    if (evidenceRuntime.evidenceMode === "live" && market.status !== "completed") {
      const warning = market.status === "failed"
        ? "All configured market providers failed; the report contains no fresh market evidence."
        : "Some market providers failed; the report is based on the successful sources only.";
      marketWarnings.push(warning);
    }
    warnings.push(...marketWarnings);
    await updateStage(
      "market_scan",
      "completed",
      marketWarnings.length
        ? marketWarnings.join(" ")
        : undefined,
    );

    const allDeals = bundles.map((bundle) => ({
      id: bundle.dealId,
      companyName: bundle.companyName,
      status: bundle.status,
    }));
    let contextsByDeal = claimedRun.mode === "xtrace"
      ? new Map<string, MemoryContext[]>()
      : structuredContextsByDeal(bundles);
    const unavailableDealIds = new Set<string>();
    const structuredImageFallbackDealIds = new Set<string>();
    const recallAttemptedDealIds = new Set<string>();
    const recallFailureReasons = new Map<string, string>();
    const analysisFailureReasons = new Map<string, string>();

    if (claimedRun.mode === "xtrace") {
      // Ingest submission and job polling are an explicit separate stage.
      // A normal analysis run spends its provider budget only on recall.
      await updateStage("memory_ingest_sync", "skipped");

      await updateStage("memory_recall", "running");
      const xtraceRecallBundles = bundles.filter((bundle) => {
        if (isCanonicalImageOnlyBundle(bundle)) {
          structuredImageFallbackDealIds.add(bundle.dealId);
          return false;
        }
        return true;
      });
      for (const bundle of xtraceRecallBundles) {
        recallAttemptedDealIds.add(bundle.dealId);
      }
      const recalled = await recallAllDealContexts({
        workspaceId: claimedRun.workspaceId,
        runId: claimedRun.id,
        bundles: xtraceRecallBundles,
        service: dependencies.xtrace,
        evidenceContextFingerprint:
          claimedRun.evidenceContext.state === "current"
            ? claimedRun.evidenceContext.contextFingerprint
            : undefined,
        activeParentFingerprints: new Map(eligibleDeals.flatMap((deal) =>
          deal.activeSourceRevisionFingerprint
            ? [[deal.id, deal.activeSourceRevisionFingerprint] as const]
            : []
        )),
      });
      contextsByDeal = recalled.contextsByDeal;
      for (const failure of recalled.failures) {
        unavailableDealIds.add(failure.dealId);
        recallFailureReasons.set(failure.dealId, failure.message);
      }
      for (const bundle of xtraceRecallBundles) {
        if ((contextsByDeal.get(bundle.dealId)?.length ?? 0) === 0) {
          unavailableDealIds.add(bundle.dealId);
          if (!recallFailureReasons.has(bundle.dealId)) {
            recallFailureReasons.set(bundle.dealId, "XTRACE_RECALL_EMPTY");
          }
        }
      }
      const recallWarnings: string[] = [];
      if (structuredImageFallbackDealIds.size > 0) {
        recallWarnings.push(
          `XTrace recall was intentionally bypassed for ${
            structuredImageFallbackDealIds.size
          } image-only ${
            structuredImageFallbackDealIds.size === 1 ? "Deal" : "Deals"
          }; canonical structured image evidence is being used as a partial fallback. `
            + "These Deals are not counted as XTrace recall and receive no XTrace memory IDs.",
        );
      }
      if (unavailableDealIds.size > 0) {
        recallWarnings.push(
          `XTrace recall was unavailable for ${unavailableDealIds.size} ${
            unavailableDealIds.size === 1 ? "Deal" : "Deals"
          }; those company analyses are marked unavailable.`,
        );
      }
      if (recallWarnings.length > 0) {
        warnings.push(...recallWarnings);
        await updateStage(
          "memory_recall",
          "failed",
          recallWarnings.join(" "),
        );
      } else {
        await updateStage("memory_recall", "completed");
      }
    } else {
      await updateStage("memory_ingest_sync", "skipped");
      await updateStage("memory_recall", "skipped");
    }

    await updateStage("opportunity_matching", "running");
    const matchingBundles = bundles.filter((bundle) =>
      (contextsByDeal.get(bundle.dealId)?.length ?? 0) > 0
      || structuredImageFallbackDealIds.has(bundle.dealId)
    );
    const deals = allDeals.filter((deal) =>
      (contextsByDeal.get(deal.id)?.length ?? 0) > 0
      || structuredImageFallbackDealIds.has(deal.id)
    );
    const recalledMatchingBundles = matchingBundles.filter((bundle) =>
      !structuredImageFallbackDealIds.has(bundle.dealId)
    );
    const structuredFallbackBundles = matchingBundles.filter((bundle) =>
      structuredImageFallbackDealIds.has(bundle.dealId)
    );
    const memoryContexts = [
      ...matchingMemoryContexts(
        recalledMatchingBundles,
        contextsByDeal,
      ),
      ...buildStructuredMemoryContexts(structuredFallbackBundles),
    ];
    const sources = buildMatchingSources(
      matchingBundles,
      analysisEvents,
      DEMO_MARKET_REPORT_EVIDENCE.map((evidence) => evidence.source),
    );
    let groundedMatches: GroundedMatch[] = [];
    try {
      groundedMatches = await createMatchingService(dependencies.reasoner)
        .analyze({
          evidenceScope: {
            schemaVersion: "matching-evidence-scope-v1",
            evidenceMode: evidenceRuntime.evidenceMode,
            contextFingerprint: evidenceRuntime.contextFingerprint as `sha256:${string}`,
            eventSetFingerprint: evidenceRuntime.eventSetFingerprint as `sha256:${string}`,
            bindingFingerprint: evidenceRuntime.bindingFingerprint as `sha256:${string}`,
            snapshotFingerprint: evidenceRuntime.snapshotFingerprint as `sha256:${string}` | null,
          },
          deals,
          events: analysisEvents,
          memoryContexts,
          sources,
        });
      await updateStage("opportunity_matching", "completed");
    } catch (error) {
      const diagnostic = safeMatchingFailureDiagnostic(error);
      const analysisFailureReason =
        `${diagnostic.code} (${diagnostic.phase})`;
      for (const deal of deals) {
        unavailableDealIds.add(deal.id);
        analysisFailureReasons.set(deal.id, analysisFailureReason);
      }
      const warning = [
        "Company matching was unavailable; affected analyses are marked unavailable.",
        `Diagnostic: code=${diagnostic.code} phase=${diagnostic.phase}.`,
      ].join(" ");
      warnings.push(warning);
      await updateStage("opportunity_matching", "failed", warning);
    }

    await updateStage("report", "running");
    const createdAt = now().toISOString();
    const companyAnalyses = buildCompanyAnalyses({
      reportId: `report_${claimedRun.id}`,
      runId: claimedRun.id,
      createdAt,
      bundles,
      contextsByDeal,
      recallFailures: unavailableDealIds,
      structuredImageFallbackDealIds,
      groundedMatches,
      currentRunAuthority: {
        workspaceId: claimedRun.workspaceId,
        dealUniverseId: boundDealUniverse!.universeId,
        dealUniverseFingerprint: boundDealUniverse!.universeFingerprint,
        evidenceContextFingerprint: evidenceRuntime.contextFingerprint,
        evidenceBindingFingerprint: evidenceRuntime.bindingFingerprint,
        consideredMarketEventIds: analysisEvents.map(({ id }) => id),
        dealsById: new Map(eligibleDeals.map((deal) => [deal.id, {
          companyId: deal.companyId,
          priorDealStatus: deal.status,
          analysisEligibleAt: deal.analysisEligibleAt!,
          activeSourceRevisionIds: [...deal.activeSourceRevisionIds],
          activeParentFingerprint: deal.activeSourceRevisionFingerprint!,
        }])),
        recallAttemptedDealIds,
        recallFailureReasons,
        analysisFailureReasons,
      },
    });
    const counts = countCompanyAnalyses(companyAnalyses);
    const opportunities = projectRecommendedOpportunities(companyAnalyses);
    const priorityDealId = opportunities[0]?.dealId ?? null;
    const report: IntelligenceReportWrite = {
      id: `report_${claimedRun.id}`,
      workspaceId: claimedRun.workspaceId,
      runId: claimedRun.id,
      createdAt,
      marketSummary: evidenceRuntime.evidenceMode === "pinned"
        ? `${evidenceRuntime.binding.displayLabel}. Historical evidence snapshot—not current news. The immutable replay contains ${analysisEvents.length} source-backed market ${analysisEvents.length === 1 ? "event" : "events"}.`
        : buildMarketSummary(market, marketSelection),
      opportunities,
      evidenceBindingFingerprint,
      evidenceContext: reportEvidenceContextFromBinding(evidenceRuntime.binding),
      analysisStatus:
        counts.analysisUnavailable > 0
          || structuredImageFallbackDealIds.size > 0
        ? "incomplete"
        : "completed",
      evidenceCoverage: {
        acceptedPublicEvents: market.events.length,
        excludedPublicItems: marketSelection.ineligibleCount,
        truncatedPublicEvents: Math.max(
          0,
          marketSelection.eligibleCount - marketSelection.events.length,
        ),
        recalledDealCount: [...contextsByDeal.values()].filter(
          (contexts) => contexts.length > 0,
        ).length,
        unavailableDealCount: counts.analysisUnavailable,
        structuredImageFallbackDealCount:
          structuredImageFallbackDealIds.size,
      },
      counts,
      priorityDealId,
      eligibleDealCount: bundles.length,
      eligibleSnapshotFingerprint,
      companyAnalyses,
    };
    await dependencies.intelligence.saveReport(report);
    const storedReport = requireExactReloadedReport({
      run: claimedRun,
      binding: evidenceRuntime.binding,
      report: await dependencies.intelligence.getReport(
        claimedRun.workspaceId,
        report.id,
      ),
      expectedAnalyses: companyAnalyses,
    });
    await updateStage("report", "completed");
    await updateStage("underwriting", "running");
    try {
      const underwritingBatch =
        await dependencies.underwriting.createBatchAndSelections({
        scanRun: claimedRun,
        report: storedReport,
        analyses: companyAnalyses,
        eligibleDeals,
        forceRefresh: false,
        evidenceFrame: {
          schemaVersion: "underwriting-evidence-frame-v1",
          evidenceMode: evidenceRuntime.evidenceMode,
          contextFingerprint: evidenceRuntime.contextFingerprint,
          eventSetFingerprint: evidenceRuntime.eventSetFingerprint,
          bindingFingerprint: evidenceRuntime.bindingFingerprint,
          snapshotFingerprint: evidenceRuntime.snapshotFingerprint,
        },
        });
      if (underwritingBatch.status === "completed") {
        await updateStage("underwriting", "completed");
      } else {
        const warning = underwritingBatch.status === "partial"
          ? "Underwriting completed only partially; every persisted formal result remains available, and incomplete Candidate reports retain their explicit reason codes."
          : underwritingBatch.status === "failed"
          ? "Underwriting failed for every admitted Candidate; the market report remains available without a false completed underwriting status."
          : `Underwriting did not reach a terminal state (batch status: ${underwritingBatch.status}); the market report remains available.`;
        warnings.push(warning);
        await updateStage("underwriting", "failed", warning);
      }
    } catch (error) {
      const warning = [
        "Underwriting was partially unavailable; the legacy market report remains available.",
        `Persisted failure reason: ${errorDetail(error)}`,
      ].join(" ");
      warnings.push(warning);
      await updateStage("underwriting", "failed", warning);
    }
    await updateStage("notification", "skipped");

    const reportIsIncomplete = storedReport.analysisStatus === "incomplete"
      || storedReport.counts.analysisUnavailable > 0;
    const finalRun = await dependencies.runs.finish({
      workspaceId: claimedRun.workspaceId,
      runId: claimedRun.id,
      status: warnings.length || reportIsIncomplete
        ? "partial"
        : "completed",
      workerId,
    });
    return { run: finalRun, report: storedReport };
  } catch (error) {
    if (activeStageStatus !== "failed") {
      const detail = errorDetail(error);
      try {
        await updateStage(
          activeStage,
          "failed",
          `${activeStage} failed: ${detail}`,
        );
      } catch {
        // Preserve the original stage failure even if diagnostics cannot be written.
      }
    }
    await dependencies.runs.finish({
      workspaceId: claimedRun.workspaceId,
      runId: claimedRun.id,
      status: "failed",
      workerId,
    });
    throw error;
  }
}

function selectRunDealUniverse(input: {
  run: RunRecord;
  bundles: DealMemoryBundle[];
  deals: RegisteredDeal[];
}): { bundles: DealMemoryBundle[]; deals: RegisteredDeal[] } {
  const researchDealIds = new Set(input.bundles.flatMap((bundle) =>
    hasPermanentResearchScreeningRecord(bundle) ? [bundle.dealId] : []
  ));
  if (
    researchDealIds.size > 0
    && (input.bundles.length !== 30 || researchDealIds.size !== 7)
  ) {
    throw new Error(
      "The current research-expanded Deal registry must contain exactly 30 eligible Deals and seven permanent screening records.",
    );
  }
  const approvedPinnedReplay = input.run.evidenceContext.state === "current"
    && input.run.evidenceContext.evidenceMode === "pinned"
    && input.run.evidenceContext.snapshotId
      === APPROVED_PINNED_DEMO_SNAPSHOT_ID;
  if (!approvedPinnedReplay) {
    return {
      bundles: structuredClone(input.bundles),
      deals: structuredClone(input.deals),
    };
  }
  if (input.bundles.length !== 30 || researchDealIds.size !== 7) {
    throw new Error(
      "The approved pinned replay requires the complete current 30-Deal registry before applying its legacy adapter.",
    );
  }
  const bundles = input.bundles.filter(({ dealId }) =>
    !researchDealIds.has(dealId)
  );
  const deals = input.deals.filter(({ id }) => !researchDealIds.has(id));
  if (
    bundles.length !== 23
    || deals.length !== 23
    || new Set(bundles.map(({ dealId }) => dealId)).size !== 23
    || bundles.some(({ dealId }) => !deals.some(({ id }) => id === dealId))
  ) {
    throw new Error(
      "The approved pinned replay legacy adapter did not resolve its exact 23-Deal universe.",
    );
  }
  return { bundles: structuredClone(bundles), deals: structuredClone(deals) };
}

function hasPermanentResearchScreeningRecord(
  bundle: DealMemoryBundle,
): boolean {
  const markerFacts = bundle.facts.filter((fact) =>
    fact.text.startsWith(`${SAMPLE_RESEARCH_SCREENING_RECORD_LABEL}.`)
    || fact.sources.some((source) =>
      source.title === SAMPLE_RESEARCH_SCREENING_RECORD_LABEL
    )
  );
  if (markerFacts.length === 0) return false;
  if (
    markerFacts.length !== 1
    || bundle.status !== "screening"
    || bundle.interactions.length !== 0
    || markerFacts[0]!.sources.length !== 1
  ) {
    throw new Error(
      "A Sample research screening Deal lost its permanent non-interaction identity.",
    );
  }
  const source = parseSourceRefV2Read(markerFacts[0]!.sources[0]!);
  if (!isSampleResearchScreeningAuthoritySource(source)) {
    throw new Error(
      "A Sample research screening Deal lost its exact source-document authority.",
    );
  }
  return true;
}

async function resolvePinnedEvidenceRuntime(
  claimedRun: RunRecord,
  runs: RunsRepository,
): Promise<ResolvedRunEvidenceRuntime> {
  if (
    claimedRun.evidenceContext.state !== "current"
    || claimedRun.evidenceContext.evidenceMode !== "pinned"
  ) throw new Error("Pinned evidence resolution requires a pinned current run.");
  await runs.bindPinnedMarketEvents(claimedRun.workspaceId, claimedRun.id);
  const binding = requireExactReloadedBinding({
    run: claimedRun,
    context: claimedRun.evidenceContext,
    binding: await runs.getEvidenceBinding(
      claimedRun.workspaceId,
      claimedRun.id,
    ),
  });
  return {
    evidenceMode: "pinned",
    context: claimedRun.evidenceContext,
    binding,
    events: binding.events,
    selection: {
      events: binding.events,
      totalCount: binding.events.length,
      eligibleCount: binding.events.length,
      ineligibleCount: 0,
      droppedCount: 0,
    },
    contextFingerprint: binding.contextFingerprint,
    eventSetFingerprint: binding.eventSetFingerprint,
    bindingFingerprint: binding.bindingFingerprint,
    snapshotId: binding.snapshotId,
    snapshotFingerprint: binding.snapshotFingerprint,
    providerResult: null,
  };
}

async function resolveLiveEvidenceRuntime(input: {
  claimedRun: RunRecord;
  context: CurrentRunEvidenceContextV1;
  dependencies: ProcessRunDependencies;
  portfolioTexts: ReadonlyMap<string, readonly string[]>;
  retrievedAt: Date;
}): Promise<ResolvedRunEvidenceRuntime> {
  if (input.context.evidenceMode !== "live") {
    throw new Error("Live evidence resolution requires a live current run.");
  }
  const scanned = await input.dependencies.market.scanMarketWindow({
    days: 14,
    now: new Date(input.context.anchorAt),
    retrievedAt: input.retrievedAt,
  });
  const classified = scanned.events.map((event) =>
    classifyMarketEventForAnalysis(event) ?? event
  );
  const persisted = await input.dependencies.intelligence.saveMarketEvents(
    classified,
    input.claimedRun.workspaceId,
  );
  const selected = selectMarketEventsForAnalysis(
    persisted,
    undefined,
    input.portfolioTexts,
  );
  await input.dependencies.runs.bindLiveMarketEvents(
    input.claimedRun.workspaceId,
    input.claimedRun.id,
    selected.events,
  );
  const binding = requireExactReloadedBinding({
    run: input.claimedRun,
    context: input.context,
    binding: await input.dependencies.runs.getEvidenceBinding(
      input.claimedRun.workspaceId,
      input.claimedRun.id,
    ),
    expectedEvents: selected.events,
  });
  return {
    evidenceMode: "live",
    context: input.context,
    binding,
    events: binding.events,
    selection: { ...selected, events: binding.events },
    contextFingerprint: binding.contextFingerprint,
    eventSetFingerprint: binding.eventSetFingerprint,
    bindingFingerprint: binding.bindingFingerprint,
    snapshotId: null,
    snapshotFingerprint: null,
    providerResult: { ...scanned, events: persisted },
  };
}

function requireExactReloadedBinding(input: {
  run: RunRecord;
  context: CurrentRunEvidenceContextV1;
  binding: RunEvidenceBindingV1 | null;
  expectedEvents?: readonly RunEvidenceBindingV1["events"][number][];
}): RunEvidenceBindingV1 {
  const binding = input.binding;
  const context = input.context;
  if (
    binding === null
    || binding.workspaceId !== input.run.workspaceId
    || binding.runId !== input.run.id
    || binding.evidenceMode !== context.evidenceMode
    || binding.windowDays !== context.windowDays
    || binding.anchorAt !== context.anchorAt
    || binding.windowStartAt !== context.windowStartAt
    || binding.windowEndAt !== context.windowEndAt
    || binding.windowTimezone !== context.windowTimezone
    || binding.snapshotId !== context.snapshotId
    || binding.snapshotFingerprint !== context.snapshotFingerprint
    || binding.contextFingerprint !== context.contextFingerprint
    || binding.eventCount !== binding.events.length
  ) throw new Error("The current run evidence binding did not reload with exact authority.");
  const events = [...binding.events].sort((left, right) =>
    compareUtf8(left.id, right.id)
  );
  const eventSetFingerprint = lengthFramedFingerprint([
    "run-event-set-v1",
    ...events.map(canonicalEvidenceJson),
  ]);
  const bindingFingerprint = lengthFramedFingerprint([
    "run-evidence-binding-v1",
    input.run.workspaceId,
    input.run.id,
    context.contextFingerprint,
    eventSetFingerprint,
    String(events.length),
  ]);
  if (
    binding.eventSetFingerprint !== eventSetFingerprint
    || binding.bindingFingerprint !== bindingFingerprint
  ) throw new Error("The current run evidence binding fingerprint is stale.");
  if (input.expectedEvents) {
    const expected = [...input.expectedEvents].sort((left, right) =>
      compareUtf8(left.id, right.id)
    );
    if (
      expected.length !== events.length
      || events.some((event, index) =>
        canonicalEvidenceJson(event) !== canonicalEvidenceJson(expected[index])
      )
    ) throw new Error("The reloaded run binding changed its canonical event payloads.");
  }
  return binding;
}

function lengthFramedFingerprint(frames: readonly string[]): string {
  const hash = createHash("sha256");
  for (const frame of frames) {
    const bytes = Buffer.from(frame, "utf8");
    hash.update(`${bytes.length}:`);
    hash.update(bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}

function requireExactReloadedReport(input: {
  run: RunRecord;
  binding: RunEvidenceBindingV1;
  report: IntelligenceReportRecord | null;
  expectedAnalyses: IntelligenceReportRecord["companyAnalyses"];
}): IntelligenceReportRecord {
  const report = input.report;
  const context = report?.evidenceContext;
  if (
    report === null
    || report.workspaceId !== input.run.workspaceId
    || report.runId !== input.run.id
    || context?.state !== "current"
    || context.contextFingerprint !== input.binding.contextFingerprint
    || context.eventSetFingerprint !== input.binding.eventSetFingerprint
    || context.bindingFingerprint !== input.binding.bindingFingerprint
    || context.snapshotFingerprint !== input.binding.snapshotFingerprint
    || canonicalAnalysisSetJson(report.companyAnalyses)
      !== canonicalAnalysisSetJson(input.expectedAnalyses)
  ) {
    throw new Error(
      "The saved report did not reload with its exact run evidence binding.",
    );
  }
  return report;
}

function canonicalAnalysisSetJson(
  analyses: readonly CompanyAnalysis[],
): string {
  return canonicalEvidenceJson(
    [...analyses]
      .sort((left, right) => compareUtf8(left.id, right.id))
      .map((analysis) => ({
        ...analysis,
        createdAt: new Date(analysis.createdAt).toISOString(),
      })),
  );
}

function isCanonicalImageOnlyBundle(bundle: DealMemoryBundle): boolean {
  return bundle.facts.length > 0
    && bundle.facts.every((fact) =>
      fact.text.startsWith(STRUCTURED_IMAGE_EVIDENCE_PREFIX)
      && fact.sources.length > 0
      && fact.sources.every((source) =>
        source.provenance === "model_inference"
        && Boolean(source.documentId)
        && Boolean(source.sourceRevisionId)
        && sourceTextForRetrieval(parseSourceRefV2Read(source)).startsWith(
          STRUCTURED_IMAGE_EVIDENCE_PREFIX,
        )
      )
    );
}

function structuredContextsByDeal(
  bundles: DealMemoryBundle[],
): Map<string, MemoryContext[]> {
  const contexts = buildStructuredMemoryContexts(bundles);
  return new Map(contexts.map((context) => [
    context.dealId,
    [{
      ...context,
      memoryId: `structured:${context.dealId}`,
      memoryType: "structured",
      score: 1,
      provenance: "source_document" as const,
    }],
  ]));
}

function matchingMemoryContexts(
  bundles: DealMemoryBundle[],
  contextsByDeal: ReadonlyMap<string, MemoryContext[]>,
): MatchingMemoryContext[] {
  return bundles.flatMap((bundle) => {
    const contexts = contextsByDeal.get(bundle.dealId) ?? [];
    if (contexts.length === 0) return [];
    const canonicalSourceIds = projectRecalledCanonicalSourceIds(
      bundle,
      contexts,
    );
    const fixtureIds = uniqueStrings(
      contexts.flatMap((context) => context.fixtureIds),
    );
    return [{
      dealId: bundle.dealId,
      text: contexts
        .slice(0, 3)
        .map((context) => context.text.slice(0, 1_200))
        .join("\n"),
      sourceIds: canonicalSourceIds,
      fixtureIds,
      interactionCandidates: [
        ...bundle.interactions
          .filter((interaction) => fixtureIds.includes(interaction.id))
          .map((interaction) => ({
            id: interaction.id,
            occurredAt: interaction.occurredAt,
            sourceIds: [interaction.id],
            revisitConditions: [...interaction.revisitConditions],
            provenance: interaction.provenance,
            label: interaction.label,
            priorActions: interaction.priorActions
              ? structuredClone(interaction.priorActions)
              : undefined,
          })),
        ...researchScreeningPriorCandidates(
          bundle,
          new Set(canonicalSourceIds),
        ),
      ],
    }];
  });
}

export function projectRecommendedOpportunities(
  analyses: readonly CompanyAnalysis[],
): OpportunityReportItem[] {
  return rankBeliefRevisionCandidates(analyses)
    .map((analysis, index) => OpportunityReportItemSchema.parse({
      rank: index + 1,
      dealId: analysis.dealId,
      confidence: analysis.confidence,
      score: analysis.score,
      whyNow: analysis.marketEvidence.explanation,
      previousContext: analysis.investmentMemory.decisionReason,
      implications: analysis.implications,
      claimSupport: analysis.claimSupport ?? [],
      nextStep: analysis.recommendedNextMove,
      sources: analysis.sources,
      demoFixtureIds: analysis.investmentMemory.fixtureIds,
    }));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function errorDetail(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800) || "Unknown scan error";
}

function buildMarketSummary(
  market: Awaited<ReturnType<MarketService["scanMarketWindow"]>>,
  selection: MarketEventSelection,
): string {
  const successful = market.providers.filter((provider) => !provider.error);
  if (!market.events.length) {
    return [
      `No source-backed market events were accepted in the ${market.window.days}-day window.`,
      `${successful.length} of ${market.providers.length} configured providers completed successfully.`,
      "This is an evidence-availability result, not a claim that the market was unchanged.",
    ].join(" ");
  }
  const themes = selection.events.flatMap((event) => event.themes)
    .filter(Boolean)
    .reduce<Map<string, number>>((counts, theme) => {
      counts.set(theme, (counts.get(theme) ?? 0) + 1);
      return counts;
    }, new Map());
  const leadingThemes = [...themes.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([theme, count]) => `${theme} (${count})`);
  return [
    `The ${market.window.days}-day scan accepted ${market.events.length} source-backed market ${market.events.length === 1 ? "event" : "events"} from ${successful.length} successful ${successful.length === 1 ? "provider" : "providers"}.`,
    `Analysis selected ${selection.events.length} of ${selection.totalCount} source-backed items. ${
      selection.ineligibleCount > 0
        ? `${selection.ineligibleCount} ${
          selection.ineligibleCount === 1 ? "item lacked" : "items lacked"
        } a bounded market-change signal.`
        : "Every accepted item contained a bounded market-change signal."
    } ${
      selection.eligibleCount > selection.events.length
        ? `${selection.eligibleCount - selection.events.length} lower-ranked eligible ${
          selection.eligibleCount - selection.events.length === 1
            ? "event was"
            : "events were"
        } excluded to keep XTrace and model inputs bounded.`
        : ""
    }`.trim(),
    leadingThemes.length
      ? `Most frequent normalized themes in the selected evidence: ${leadingThemes.join(", ")}.`
      : "The accepted sources did not provide enough normalized theme labels for a theme ranking.",
    "Review the cited sources before acting.",
  ].join(" ");
}

async function stage(
  runs: RunsRepository,
  workspaceId: string,
  runId: string,
  workerId: string,
  name: string,
  status: "running" | "skipped" | "completed" | "failed",
  warning?: string,
): Promise<void> {
  await runs.updateStage({
    workspaceId,
    runId,
    workerId,
    stage: name,
    status,
    warning,
  });
}
