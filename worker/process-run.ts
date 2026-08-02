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
} from "../lib/matching/context";
import type {
  GroundedMatch,
  MatchingMemoryContext,
  MatchingReasoner,
} from "../lib/matching/service";
import { createMatchingService } from "../lib/matching/service";
import {
  MAX_MARKET_EVENTS_FOR_ANALYSIS,
  selectMarketEventsForAnalysis,
  type MarketEventSelection,
} from "../lib/market/selection";
import { classifyMarketEventForAnalysis } from "../lib/market/classification";
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

type RunsRepository = ReturnType<typeof createRunsRepository>;

export interface ProcessRunDependencies {
  runs: RunsRepository;
  intelligence: IntelligenceRepository;
  dealRegistry: Pick<
    DealRegistry,
    | "getAnalysisEligibleSnapshot"
    | "listAnalysisEligibleBundles"
    | "findForWorkspace"
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
    }): Promise<MemoryContext[]>;
  };
  now?: () => Date;
}

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
  let activeStage = claimedRun.currentStage ?? "worker_setup";
  let activeStageStatus:
    | "running"
    | "skipped"
    | "completed"
    | "failed"
    | undefined;
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
      eligibleSnapshotFingerprint =
        eligibleDealSnapshotFingerprint(eligibleDeals);
      const snapshotAfter = await dependencies.dealRegistry
        .getAnalysisEligibleSnapshot(claimedRun.workspaceId);
      const bundleIds = bundles.map(({ dealId }) => dealId).sort();
      if (
        snapshotBefore.fingerprint !== snapshotAfter.fingerprint
        || snapshotAfter.fingerprint !== eligibleSnapshotFingerprint
        || snapshotAfter.count !== bundles.length
        || JSON.stringify([...snapshotAfter.dealIds].sort())
          !== JSON.stringify(bundleIds)
      ) {
        throw new Error(
          "The eligible Deal snapshot changed while the scan was starting.",
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

    await updateStage("market_scan", "running");
    const scannedMarket = await dependencies.market.scanMarketWindow({
      days: 14,
      now: now(),
    });
    // Classification changes canonical sectors/themes and therefore identity.
    // Normalize it once before the first durable write, then reuse that exact
    // payload for selection, matching, reports, and underwriting.
    const market = {
      ...scannedMarket,
      events: scannedMarket.events.map((event) =>
        classifyMarketEventForAnalysis(event) ?? event
      ),
    };
    const persistedMarketEvents = await dependencies.intelligence.saveMarketEvents(
      market.events,
      claimedRun.workspaceId,
    );
    market.events = persistedMarketEvents;
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
    const marketSelection = selectMarketEventsForAnalysis(
      market.events,
      MAX_MARKET_EVENTS_FOR_ANALYSIS,
      portfolioTexts,
    );
    const analysisEvents = marketSelection.events;
    const marketWarnings: string[] = [];
    if (market.status !== "completed") {
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

    if (claimedRun.mode === "xtrace") {
      await updateStage("memory_ingest_sync", "running");
      if (dependencies.xtrace) {
        let failedJobs = 0;
        try {
          const openJobs = await dependencies.xtrace.listOpenIngestJobs(
            claimedRun.workspaceId,
          );
          for (const job of openJobs) {
            try {
              const completed = await dependencies.xtrace.pollIngestJob(
                job.jobId,
                { dealId: job.dealId },
              );
              if (completed.status === "failed") failedJobs += 1;
            } catch {
              failedJobs += 1;
            }
          }
        } catch {
          const warning = "Pending XTrace ingest jobs could not be inspected before recall.";
          warnings.push(warning);
          await updateStage(
            "memory_ingest_sync",
            "failed",
            warning,
          );
          failedJobs = -1;
        }
        if (failedJobs > 0) {
          const warning = `${failedJobs} pending XTrace ingest ${failedJobs === 1 ? "job" : "jobs"} did not complete before recall.`;
          warnings.push(warning);
          await updateStage(
            "memory_ingest_sync",
            "completed",
            warning,
          );
        } else if (failedJobs === 0) {
          await updateStage(
            "memory_ingest_sync",
            "completed",
          );
        }
      } else {
        await updateStage(
          "memory_ingest_sync",
          "skipped",
        );
      }

      await updateStage("memory_recall", "running");
      const xtraceRecallBundles = bundles.filter((bundle) => {
        if (isCanonicalImageOnlyBundle(bundle)) {
          structuredImageFallbackDealIds.add(bundle.dealId);
          return false;
        }
        return true;
      });
      const recalled = await recallAllDealContexts({
        workspaceId: claimedRun.workspaceId,
        runId: claimedRun.id,
        bundles: xtraceRecallBundles,
        service: dependencies.xtrace,
      });
      contextsByDeal = recalled.contextsByDeal;
      for (const failure of recalled.failures) {
        unavailableDealIds.add(failure.dealId);
      }
      for (const bundle of xtraceRecallBundles) {
        if ((contextsByDeal.get(bundle.dealId)?.length ?? 0) === 0) {
          unavailableDealIds.add(bundle.dealId);
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
          deals,
          events: analysisEvents,
          memoryContexts,
          sources,
        });
      await updateStage("opportunity_matching", "completed");
    } catch {
      for (const deal of deals) unavailableDealIds.add(deal.id);
      const warning =
        "Company matching was unavailable; affected analyses are marked unavailable.";
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
    });
    const counts = countCompanyAnalyses(companyAnalyses);
    const opportunities = projectRecommendedOpportunities(companyAnalyses);
    const priorityDealId = opportunities[0]?.dealId ?? null;
    const report: IntelligenceReportWrite = {
      id: `report_${claimedRun.id}`,
      workspaceId: claimedRun.workspaceId,
      runId: claimedRun.id,
      createdAt,
      marketSummary: buildMarketSummary(market, marketSelection),
      opportunities,
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
    const storedReport = await dependencies.intelligence.saveReport(report);
    await updateStage("report", "completed");
    await updateStage("underwriting", "running");
    try {
      await dependencies.underwriting.createBatchAndSelections({
        scanRun: claimedRun,
        report: storedReport,
        analyses: companyAnalyses,
        eligibleDeals,
        forceRefresh: false,
      });
      await updateStage("underwriting", "completed");
    } catch {
      const warning =
        "Underwriting was partially unavailable; the legacy market report remains available.";
      warnings.push(warning);
      await updateStage("underwriting", "failed", warning);
    }
    await updateStage("notification", "skipped");

    const finalRun = await dependencies.runs.finish({
      workspaceId: claimedRun.workspaceId,
      runId: claimedRun.id,
      status: warnings.length ? "partial" : "completed",
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
    const fixtureIds = uniqueStrings(
      contexts.flatMap((context) => context.fixtureIds),
    );
    return [{
      dealId: bundle.dealId,
      text: contexts
        .slice(0, 3)
        .map((context) => context.text.slice(0, 1_200))
        .join("\n"),
      sourceIds: uniqueStrings(
        contexts.flatMap((context) => context.sourceIds),
      ),
      fixtureIds,
      interactionCandidates: bundle.interactions
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
