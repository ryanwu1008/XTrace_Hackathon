import type {
  IntelligenceReportRecord,
  IntelligenceReportWrite,
} from "../../db/repositories/intelligence";
import type { CompanyAnalysis } from "../contracts/domain";
import type { UnderwritingBatchSummary } from "../underwriting/read-model";
import { safeParseCompanyAnalysisEvidence } from "./company-analysis-evidence";
import {
  sanitizeCompanyAnalysisNextStep,
  sanitizeReportOpportunities,
} from "./next-step-policy";

export function toPublicCompanyAnalysis(
  value: CompanyAnalysis,
): CompanyAnalysis | null {
  const parsed = safeParseCompanyAnalysisEvidence(value);
  if (!parsed) return null;
  return {
    ...parsed,
    recommendedNextMove: sanitizeCompanyAnalysisNextStep({
      outcome: parsed.outcome,
      value: parsed.recommendedNextMove,
      actions: parsed.beliefAssessment?.actions,
    }),
  };
}

export function toPublicReport(
  report: IntelligenceReportRecord | IntelligenceReportWrite,
  options: { underwritingBatch?: UnderwritingBatchSummary | null } = {},
) {
  const rawCompanyAnalyses = ("companyAnalyses" in report
    && Array.isArray(report.companyAnalyses)
    ? report.companyAnalyses
    : []);
  const currentEvidenceBound = report.evidenceContext?.state === "current";
  const companyAnalyses = rawCompanyAnalyses.flatMap((analysis) => {
    const safe = toPublicCompanyAnalysis(analysis);
    if (!safe && currentEvidenceBound) {
      throw new Error("Invalid current Company analysis cannot be published.");
    }
    return safe ? [safe] : [];
  });
  const derivedCounts = {
    companyCount: companyAnalyses.length,
    beliefRevised: companyAnalyses.filter(
      (analysis) => analysis.outcome === "belief_revised",
    ).length,
    monitor: companyAnalyses.filter(
      (analysis) => analysis.outcome === "monitor",
    ).length,
    noMaterialChange: companyAnalyses.filter(
      (analysis) => analysis.outcome === "no_material_change",
    ).length,
    analysisUnavailable: companyAnalyses.filter(
      (analysis) => analysis.outcome === "analysis_unavailable",
    ).length,
  };
  const counts = companyAnalyses.length > 0
    ? derivedCounts
    : "counts" in report && report.counts
    ? report.counts
    : derivedCounts;
  const underwritingStatusCounts = options.underwritingBatch
    ?.underwritingStatusCounts ?? {
      queued: 0,
      running: 0,
      completed: 0,
      partial: 0,
      failed: 0,
    };
  const publicCounts = {
    ...counts,
    eligibleDealCount: counts.companyCount,
    companyAnalysisCount: companyAnalyses.length,
    beliefRevisedCount: counts.beliefRevised,
    monitorCount: counts.monitor,
    noMaterialChangeCount: counts.noMaterialChange,
    analysisUnavailableCount: counts.analysisUnavailable,
    underwritingCandidateCount: options.underwritingBatch?.queue.length ?? 0,
    underwritingQueuedCount: underwritingStatusCounts.queued,
    underwritingRunningCount: underwritingStatusCounts.running,
    underwritingCompletedCount: underwritingStatusCounts.completed,
    underwritingPartialCount: underwritingStatusCounts.partial,
    underwritingFailedCount: underwritingStatusCounts.failed,
  };
  return {
    id: report.id,
    workspaceId: report.workspaceId,
    runId: report.runId,
    createdAt: report.createdAt,
    marketSummary: report.marketSummary,
    opportunities: sanitizeReportOpportunities(report.opportunities),
    analysisStatus: "analysisStatus" in report
      ? report.analysisStatus ?? "completed"
      : "completed",
    evidenceCoverage: "evidenceCoverage" in report
      ? report.evidenceCoverage ?? {
          acceptedPublicEvents: 0,
          excludedPublicItems: 0,
          truncatedPublicEvents: 0,
          recalledDealCount: 0,
          unavailableDealCount: 0,
        }
      : {
          acceptedPublicEvents: 0,
          excludedPublicItems: 0,
          truncatedPublicEvents: 0,
          recalledDealCount: 0,
          unavailableDealCount: 0,
        },
    counts: publicCounts,
    priorityDealId: "priorityDealId" in report
      ? report.priorityDealId ?? null
      : null,
    companyAnalyses,
    evidenceContext: "evidenceContext" in report && report.evidenceContext
      ? structuredClone(report.evidenceContext)
      : { state: "legacy_unbound" as const },
  };
}
