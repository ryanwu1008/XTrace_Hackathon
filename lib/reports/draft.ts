import type {
  CompanyAnalysis,
  EvidenceSourceRef,
  OpportunityReportItem,
} from "../contracts/domain";
import { SAMPLE_DECISION_RECORD_LABEL } from "../contracts/source-evidence";
import { sanitizeReportNextStep } from "./next-step-policy";
import { safeExternalHttpUrl } from "../security/safe-url";
import { rankBeliefRevisionCandidates } from "../matching/ranking";

const SYNTHETIC_HISTORY_LABEL =
  `${SAMPLE_DECISION_RECORD_LABEL} · synthetic demo history`;

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
    ...(analysis.investmentMemory.fixtureIds.length > 0
      ? [SYNTHETIC_HISTORY_LABEL]
      : []),
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
    ...(opportunity.demoFixtureIds.length > 0
      ? [SYNTHETIC_HISTORY_LABEL]
      : []),
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
  const links = resolveSourceLinks(source, origin);
  const details = [
    ...(links.publicUrl
      ? [`${links.isLegacy ? "Legacy public source" : "Public canonical source"}: ${links.publicUrl}`]
      : []),
    ...(links.revisionUrl
      ? [`Exact Source Revision: ${links.revisionUrl}`]
      : []),
    ...(links.isLegacy && !links.revisionUrl
      ? ["Legacy evidence · Exact Source Revision unavailable"]
      : []),
  ];
  return details.length > 0
    ? [`- ${source.title}`, ...details.map((detail) => `  ${detail}`)].join("\n")
    : `- ${source.title}`;
}

function resolveSourceLinks(
  source: EvidenceSourceRef,
  origin: string,
): {
  publicUrl?: string;
  revisionUrl?: string;
  isLegacy: boolean;
} {
  const isLegacy = !("schemaVersion" in source)
    || source.adaptation === "legacy_read";
  const externalUrl = source.provenance === "public_web"
    ? "schemaVersion" in source
      ? source.canonicalUrl ?? undefined
      : source.url
    : undefined;
  const page = "schemaVersion" in source
    && source.locator?.kind === "document_page"
    ? source.locator.page
    : !("schemaVersion" in source)
    ? source.page
    : undefined;
  const safeExternalUrl = safeExternalHttpUrl(externalUrl);
  let publicUrl: string | undefined;
  if (safeExternalUrl) {
    const url = new URL(safeExternalUrl);
    if (page && !url.hash) url.hash = `page=${page}`;
    publicUrl = url.toString();
  }
  const sourceRevisionId = "schemaVersion" in source
    ? source.sourceRevisionId ?? undefined
    : source.sourceRevisionId;
  const pageAnchor = page ? `#page=${page}` : "";
  const revisionUrl = sourceRevisionId
    ? `${origin}/api/source-revisions/${encodeURIComponent(sourceRevisionId)}/access${pageAnchor}`
    : undefined;
  return { publicUrl, revisionUrl, isLegacy };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
