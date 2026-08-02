import type {
  CompanyAnalysis,
  EvidenceSourceRef,
  OpportunityReportItem,
} from "../contracts/domain";
import { sanitizeReportNextStep } from "./next-step-policy";
import { safeExternalHttpUrl } from "../security/safe-url";
import { rankBeliefRevisionCandidates } from "../matching/ranking";

export interface InternalReportDraft {
  subject: string;
  bodyText: string;
}

export interface InternalReportDraftInput {
  report: {
    id: string;
    createdAt: string;
    marketSummary: string;
    opportunities: OpportunityReportItem[];
    companyAnalyses?: CompanyAnalysis[];
  };
  companyNames: Readonly<Record<string, string>>;
  appOrigin: string;
}

export function buildInternalReportDraft(
  input: InternalReportDraftInput,
): InternalReportDraft {
  const origin = input.appOrigin.replace(/\/+$/, "");
  const reportDate = input.report.createdAt.slice(0, 10);
  const recommendedAnalyses = rankBeliefRevisionCandidates(
    input.report.companyAnalyses ?? [],
  );
  const hasCompanyAnalyses = input.report.companyAnalyses !== undefined;
  const opportunities = hasCompanyAnalyses
    ? []
    : input.report.opportunities.slice(0, 5);
  const bodySections = recommendedAnalyses.length > 0
    ? recommendedAnalyses.map((analysis, index) =>
        formatCompanyAnalysis(analysis, index, origin)
      )
    : opportunities.length
    ? opportunities.map((opportunity) =>
        formatOpportunity(opportunity, input.companyNames, origin)
      )
    : ["No medium- or high-confidence Deal overlap was found."];
  const reportUrl =
    `${origin}/?view=reports&report=${encodeURIComponent(input.report.id)}`;

  return {
    subject: `VSee · Deals worth a second look — ${reportDate}`,
    bodyText: [
      "VSEE · DEAL INTELLIGENCE",
      "",
      "14-DAY MARKET SUMMARY",
      input.report.marketSummary,
      "",
      ...bodySections.flatMap((section) => [section, ""]),
      "OPEN COMPLETE REPORT",
      reportUrl,
    ].join("\n").trim(),
  };
}

function formatCompanyAnalysis(
  analysis: CompanyAnalysis,
  index: number,
  origin: string,
): string {
  const remainingRisks = unique([
    ...analysis.investmentMemory.concerns,
    ...analysis.companyBrief.risks.map((risk) => risk.detail),
  ]);
  const lines = [
    `#${index + 1} · ${analysis.companyName.toUpperCase()} · ${analysis.confidence.toUpperCase()} CONFIDENCE · ${Math.round(analysis.score * 100)}%`,
    "",
    "THEN / INVESTMENT MEMORY",
    `Previous meeting: ${analysis.investmentMemory.previousMeetingSummary}`,
    `Decision reason: ${analysis.investmentMemory.decisionReason}`,
  ];
  appendList(lines, "Partner concerns:", analysis.investmentMemory.concerns);
  appendList(
    lines,
    "Revisit conditions:",
    analysis.investmentMemory.revisitConditions,
  );
  lines.push(
    "",
    "NOW / MARKET EVIDENCE",
    analysis.marketEvidence.explanation,
  );
  appendList(lines, "Potential positive effects:", analysis.implications.positive);
  appendList(lines, "Potential negative effects:", analysis.implications.negative);
  appendList(lines, "REMAINING RISKS", remainingRisks);
  lines.push(
    "",
    "RECOMMENDED NEXT MOVE",
    sanitizeReportNextStep(analysis.recommendedNextMove),
    "",
    "Sources:",
    ...analysis.sources.map((source) => formatSource(source, origin)),
  );
  return lines.join("\n");
}

export function buildFullDraftText(draft: InternalReportDraft): string {
  return `Subject: ${draft.subject}\n\n${draft.bodyText}`;
}

function formatOpportunity(
  opportunity: OpportunityReportItem,
  companyNames: Readonly<Record<string, string>>,
  origin: string,
): string {
  const companyName = companyNames[opportunity.dealId] ?? opportunity.dealId;
  const lines = [
    `#${opportunity.rank} · ${companyName.toUpperCase()} · ${opportunity.confidence.toUpperCase()} CONFIDENCE · ${Math.round(opportunity.score * 100)}%`,
    "",
    "Why now:",
    opportunity.whyNow,
    "",
    "Previous context:",
    opportunity.previousContext,
  ];

  appendList(lines, "Potential positive effects:", opportunity.implications.positive);
  appendList(lines, "Potential negative effects:", opportunity.implications.negative);
  lines.push(
    "",
    "Suggested next step:",
    sanitizeReportNextStep(opportunity.nextStep),
    "",
    "Sources:",
    ...opportunity.sources.map((source) => formatSource(source, origin)),
  );
  return lines.join("\n");
}

function appendList(lines: string[], heading: string, items: string[]): void {
  if (!items.length) return;
  lines.push("", heading, ...items.map((item) => `- ${item}`));
}

function formatSource(source: EvidenceSourceRef, origin: string): string {
  const url = resolveSourceUrl(source, origin);
  return url ? `- ${source.title} — ${url}` : `- ${source.title}`;
}

function resolveSourceUrl(
  source: EvidenceSourceRef,
  origin: string,
): string | undefined {
  const externalUrl = "schemaVersion" in source
    ? source.canonicalUrl ?? undefined
    : source.url;
  const page = "schemaVersion" in source
    && source.locator?.kind === "document_page"
    ? source.locator.page
    : !("schemaVersion" in source)
    ? source.page
    : undefined;
  const safeExternalUrl = safeExternalHttpUrl(externalUrl);
  if (safeExternalUrl) {
    const url = new URL(safeExternalUrl);
    if (page && !url.hash) url.hash = `page=${page}`;
    return url.toString();
  }
  if (!source.documentId) return undefined;
  const pageAnchor = page ? `#page=${page}` : "";
  return `${origin}/api/documents/${encodeURIComponent(source.documentId)}/access${pageAnchor}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
