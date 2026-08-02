import type {
  IntelligenceReportRecord,
  IntelligenceReportWrite,
} from "../../db/repositories/intelligence";
import type { CompanyAnalysis } from "../contracts/domain";
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
    }),
  };
}

export function toPublicReport(
  report: IntelligenceReportRecord | IntelligenceReportWrite,
) {
  const companyAnalyses = ("companyAnalyses" in report
    && Array.isArray(report.companyAnalyses)
    ? report.companyAnalyses
    : [])
    .flatMap((analysis) => {
      const safe = toPublicCompanyAnalysis(analysis);
      return safe ? [safe] : [];
    });
  const counts = "counts" in report && report.counts
    ? report.counts
    : {
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
    counts,
    priorityDealId: "priorityDealId" in report
      ? report.priorityDealId ?? null
      : null,
    companyAnalyses,
  };
}
