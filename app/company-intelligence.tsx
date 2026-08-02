"use client";

import { useMemo, useState } from "react";

import {
  SAMPLE_DEAL_PROFILES,
  type SampleDealProfile,
} from "./deal-profiles";
import { UnderwritingSummary } from "./underwriting-summary";
import type {
  CompanyAnalysis,
  CompanyAnalysisConfidence,
  CompanyAnalysisOutcome,
  CompanyAnalysisCounts,
  DealStatus,
  EvidenceCoverage,
  EvidenceField,
  EvidenceSourceRef,
  OpportunityReportItem,
} from "../lib/contracts/domain";
import { evidenceSourceText } from "../lib/contracts/domain";
import { formatTemporalForDisplay } from "../lib/format/temporal";
import { safeExternalHttpUrl } from "../lib/security/safe-url";

export interface IntelligenceReportView {
  id: string;
  runId?: string;
  createdAt: string;
  marketSummary: string;
  opportunities: OpportunityReportItem[];
  analysisStatus: "completed" | "incomplete";
  evidenceCoverage: EvidenceCoverage;
  counts: CompanyAnalysisCounts;
  priorityDealId: string | null;
  companyAnalyses: CompanyAnalysis[];
}

type BriefTab =
  | "IC Snapshot"
  | "Traction"
  | "Deal Terms"
  | "Risks"
  | "Decision History"
  | "Source Lineage";

const briefTabs: BriefTab[] = [
  "IC Snapshot",
  "Traction",
  "Deal Terms",
  "Risks",
  "Decision History",
  "Source Lineage",
];

const outcomeLabels: Record<CompanyAnalysisOutcome, string> = {
  belief_revised: "Belief revised",
  monitor: "Monitor",
  no_material_change: "No material change",
  analysis_unavailable: "Analysis unavailable",
};

const outcomeOrder: Record<CompanyAnalysisOutcome, number> = {
  belief_revised: 0,
  monitor: 1,
  no_material_change: 2,
  analysis_unavailable: 3,
};

const confidenceOrder: Record<CompanyAnalysisConfidence, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function formatReportDate(value: string) {
  return formatTemporalForDisplay({
    value,
    dateOnly: { month: "short", day: "numeric", year: "numeric" },
    timestamp: {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  });
}

// Grounded text is assembled from claim sentences, so the same source
// sentence can repeat. Display-level dedupe only; the stored text and the
// evidence trail are untouched.
function dedupeSentences(text: string): string {
  const sentences = text.split(/(?<=\.)\s+(?=["“(A-Z])/);
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence || seen.has(sentence)) continue;
    seen.add(sentence);
    kept.push(sentence);
  }
  return kept.join(" ");
}

function leadSentence(text: string): string {
  return dedupeSentences(text).split(/(?<=\.)\s+(?=["“(A-Z])/)[0] ?? text;
}

function traceableSourceLabel(count: number): string {
  return `${count} traceable ${count === 1 ? "source" : "sources"}`;
}

export function CompanyIntelligenceReport({
  report,
  focused,
  allowDraft,
  onDraft,
  showDemoProfiles = true,
  underwritingEnabled = false,
  canSaveActionDrafts = false,
  companyNames = {},
}: {
  report: IntelligenceReportView;
  focused: boolean;
  allowDraft: boolean;
  onDraft(report: IntelligenceReportView): void;
  showDemoProfiles?: boolean;
  underwritingEnabled?: boolean;
  canSaveActionDrafts?: boolean;
  companyNames?: Record<string, string>;
}) {
  const priority = report.priorityDealId
    ? report.companyAnalyses.find(
        (analysis) => analysis.dealId === report.priorityDealId,
      )
    : undefined;
  const [briefAnalysis, setBriefAnalysis] = useState<CompanyAnalysis | null>(
    null,
  );
  const [briefTab, setBriefTab] = useState<BriefTab>("IC Snapshot");

  function openBrief(analysis: CompanyAnalysis, tab: BriefTab = "IC Snapshot") {
    setBriefAnalysis(analysis);
    setBriefTab(tab);
  }

  return (
    <article
      className={`vsee-report vsee-intelligence-report ${focused ? "focused" : ""}`}
      id={`report-${report.id}`}
      tabIndex={-1}
    >
      <header className="vsee-intelligence-report-header">
        <div>
          <span>REPORT · {formatReportDate(report.createdAt)}</span>
          <h2>{report.counts.companyCount} companies analyzed</h2>
          <details className="vsee-details">
            <summary>How this scan was assembled</summary>
            <p>{report.marketSummary}</p>
          </details>
        </div>
        {allowDraft && (
          <button onClick={() => onDraft(report)}>DRAFT THIS REPORT →</button>
        )}
      </header>

      <ReportCoverage report={report} />

      {underwritingEnabled && (
        <section
          className="vsee-underwriting-summary vsee-underwriting-report-contract"
          role="note"
        >
          <header>
            <div>
              <span className="vsee-eyebrow">DURABLE UNDERWRITING REPORT</span>
              <p>
                Finalized candidate detail keeps the formal deterministic
                decision separate from independent named-advisory viewpoints,
                with exact Evidence Pack and public-source lineage.
              </p>
            </div>
          </header>
        </section>
      )}

      {(report.evidenceCoverage.structuredImageFallbackDealCount ?? 0) > 0 && (
        <section
          className="vsee-no-belief-change vsee-partial-coverage"
          role="status"
        >
          <span>PARTIAL XTRACE COVERAGE</span>
          <h2>
            Structured image evidence was used for{" "}
            {report.evidenceCoverage.structuredImageFallbackDealCount}{" "}
            image-only{" "}
            {report.evidenceCoverage.structuredImageFallbackDealCount === 1
              ? "Deal"
              : "Deals"}.
          </h2>
          <p>
            These analyses are grounded in canonical structured evidence.
            They contain no XTrace memory IDs and are not counted as recalled
            Deal memories.
          </p>
        </section>
      )}

      {priority ? (
        <PriorityResult
          analysis={priority}
          onOpenBrief={() => openBrief(priority)}
          showDemoProfiles={showDemoProfiles}
        />
      ) : (
        <section className="vsee-no-belief-change" role="status">
          <span>SCAN CONCLUSION</span>
          <h2>No material investment belief changed.</h2>
          <p>
            The agent still completed the company-by-company review. Related
            evidence remains in Monitor, while companies without a supported
            overlap are recorded as No material change.
          </p>
        </section>
      )}

      <UnderwritingSummary
        reportId={report.id}
        companyNames={{
          ...Object.fromEntries(
            report.companyAnalyses.map((analysis) => [
              analysis.dealId,
              analysis.companyName,
            ]),
          ),
          ...companyNames,
        }}
        analyses={report.companyAnalyses}
        enabled={underwritingEnabled}
        canSaveDrafts={canSaveActionDrafts}
      />

      <CompanyAnalysisList
        analyses={report.companyAnalyses}
        onOpenBrief={openBrief}
      />

      {briefAnalysis && (
        <CompanyBrief
          analysis={briefAnalysis}
          activeTab={briefTab}
          onTab={setBriefTab}
          onClose={() => setBriefAnalysis(null)}
          showDemoProfiles={showDemoProfiles}
        />
      )}
    </article>
  );
}

function ReportCoverage({ report }: { report: IntelligenceReportView }) {
  const items = [
    ["Belief revised", report.counts.beliefRevised],
    ["Monitor", report.counts.monitor],
    ["No material change", report.counts.noMaterialChange],
    ["Unavailable", report.counts.analysisUnavailable],
    ["Accepted public events", report.evidenceCoverage.acceptedPublicEvents],
    ["Recalled Deal memories", report.evidenceCoverage.recalledDealCount],
    [
      "Structured image fallbacks",
      report.evidenceCoverage.structuredImageFallbackDealCount ?? 0,
    ],
  ] as const;
  return (
    <section className="vsee-report-coverage" aria-label="Report evidence coverage">
      {items.map(([label, value]) => (
        <div key={label}><strong>{value}</strong><span>{label}</span></div>
      ))}
    </section>
  );
}

export function PriorityResult({
  analysis,
  onOpenBrief,
  showDemoProfiles = true,
}: {
  analysis: CompanyAnalysis;
  onOpenBrief(): void;
  showDemoProfiles?: boolean;
}) {
  return (
    <section className="vsee-priority-result" aria-labelledby={`priority-${analysis.id}`}>
      <header>
        <div>
          <span className="vsee-eyebrow">PRIORITY RESULT</span>
          <h2 id={`priority-${analysis.id}`}>{analysis.companyName}</h2>
        </div>
        <div className="vsee-analysis-badges">
          <span>{analysis.dealStatus}</span>
          <span className={`outcome ${analysis.outcome}`}>
            {outcomeLabels[analysis.outcome]}
          </span>
          <span className={`confidence ${analysis.confidence}`}>
            {analysis.confidence} confidence · {Math.round(analysis.score * 100)}%
          </span>
        </div>
      </header>

      <div className="vsee-priority-grid">
        <section>
          <span>THEN / INVESTMENT MEMORY</span>
          <h3>What the fund believed</h3>
          <p className="vsee-priority-lead">
            {analysis.investmentMemory.decisionReason}
          </p>
          <details className="vsee-details">
            <summary>Full decision context</summary>
            <Definition label="Previous meeting" value={analysis.investmentMemory.previousMeetingSummary} />
            <Definition label="Partner concerns" value={analysis.investmentMemory.concerns.join(" · ")} />
            <Definition label="Revisit conditions" value={analysis.investmentMemory.revisitConditions.join(" · ")} />
          </details>
        </section>
        <section className={`vsee-belief-shift ${analysis.outcome}`}>
          <span>{outcomeLabels[analysis.outcome].toUpperCase()}</span>
          <strong>→</strong>
          <p>
            {analysis.marketEvidence.relationship === "satisfies"
              ? "New evidence satisfies a recorded revisit condition."
              : analysis.marketEvidence.relationship === "contradicts"
              ? "New evidence contradicts part of the previous decision context."
              : analysis.marketEvidence.relationship === "related"
              ? "New evidence is relevant, but does not yet justify a belief change."
              : analysis.marketEvidence.relationship === "unavailable"
              ? "The required evidence or memory could not be analyzed."
              : "No material evidence matched this company in the current scan."}
          </p>
          <small>{traceableSourceLabel(analysis.verifiedSourceCount)}</small>
        </section>
        <section>
          <span>NOW / MARKET EVIDENCE</span>
          <h3>What changed</h3>
          <p className="vsee-priority-lead">
            {leadSentence(analysis.marketEvidence.explanation)}
          </p>
          {!!analysis.marketEvidence.events.length && (
            <ul>
              {analysis.marketEvidence.events.map((event) => {
                const eventSourceIds = "schemaVersion" in event
                  ? event.sources.map((source) => source.id)
                  : event.sourceIds;
                const sourceUrl = eventSourceIds
                  .map((sourceId) => analysis.sources.find(
                    (source) => source.id === sourceId,
                  ))
                  .map((source) => source ? sourceHref(source) : undefined)
                  .find(Boolean);
                return (
                  <li key={event.id}>
                    {sourceUrl ? (
                      <a
                        className="vsee-event-source-link"
                        href={sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <strong>{event.title} ↗</strong>
                      </a>
                    ) : (
                      <strong>{event.title}</strong>
                    )}
                    <small>
                      {event.eventType} · {event.publishedAt
                        ? formatReportDate(event.publishedAt)
                        : "Publication date unknown"}
                    </small>
                  </li>
                );
              })}
            </ul>
          )}
          {dedupeSentences(analysis.marketEvidence.explanation)
            !== leadSentence(analysis.marketEvidence.explanation) && (
            <details className="vsee-details">
              <summary>Full cited evidence</summary>
              <p>{dedupeSentences(analysis.marketEvidence.explanation)}</p>
            </details>
          )}
        </section>
      </div>

      {showDemoProfiles && (
        <SampleProfileSections dealId={analysis.dealId} />
      )}

      {analysis.outcome !== "analysis_unavailable" && (
        <section className="vsee-next-move">
          <span>RECOMMENDED NEXT MOVE</span>
          <p>{analysis.recommendedNextMove}</p>
        </section>
      )}
      <footer>
        <button className="primary" onClick={onOpenBrief}>OPEN FULL COMPANY BRIEF →</button>
      </footer>
    </section>
  );
}

function Definition({ label, value }: { label: string; value: string }) {
  return (
    <dl>
      <dt>{label}</dt>
      <dd>{value || "Not available in current evidence"}</dd>
    </dl>
  );
}

export function CompanyAnalysisList({
  analyses,
  onOpenBrief,
}: {
  analyses: CompanyAnalysis[];
  onOpenBrief(analysis: CompanyAnalysis): void;
}) {
  const [outcome, setOutcome] = useState<"all" | CompanyAnalysisOutcome>("all");
  const [status, setStatus] = useState<"all" | DealStatus>("all");
  const [confidence, setConfidence] = useState<
    "all" | CompanyAnalysisConfidence
  >("all");
  const sorted = useMemo(() => analyses
    .filter((analysis) => outcome === "all" || analysis.outcome === outcome)
    .filter((analysis) => status === "all" || analysis.dealStatus === status)
    .filter((analysis) =>
      confidence === "all" || analysis.confidence === confidence
    )
    .sort((left, right) =>
      outcomeOrder[left.outcome] - outcomeOrder[right.outcome]
      || confidenceOrder[left.confidence] - confidenceOrder[right.confidence]
      || right.score - left.score
      || left.companyName.localeCompare(right.companyName)
    ), [analyses, confidence, outcome, status]);

  return (
    <section className="vsee-company-analysis-list">
      <header>
        <div>
          <span>COMPLETE COMPANY REVIEW</span>
          <h2>All {analyses.length} company analyses</h2>
        </div>
        <div className="vsee-analysis-filters">
          <label>
            <span>Outcome</span>
            <select value={outcome} onChange={(event) =>
              setOutcome(event.target.value as "all" | CompanyAnalysisOutcome)
            }>
              <option value="all">All</option>
              <option value="belief_revised">Belief revised</option>
              <option value="monitor">Monitor</option>
              <option value="no_material_change">No material change</option>
              <option value="analysis_unavailable">Unavailable</option>
            </select>
          </label>
          <label>
            <span>Deal status</span>
            <select value={status} onChange={(event) =>
              setStatus(event.target.value as "all" | DealStatus)
            }>
              <option value="all">All</option>
              <option value="screening">Screening</option>
              <option value="watchlist">Watchlist</option>
              <option value="evaluating">Evaluating</option>
              <option value="passed">Passed</option>
              <option value="invested">Invested</option>
            </select>
          </label>
          <label>
            <span>Confidence</span>
            <select value={confidence} onChange={(event) =>
              setConfidence(
                event.target.value as "all" | CompanyAnalysisConfidence,
              )
            }>
              <option value="all">All</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
        </div>
      </header>

      <div className="vsee-company-analysis-rows">
        {sorted.map((analysis) => (
          <button
            key={analysis.id}
            onClick={() => onOpenBrief(analysis)}
            aria-label={`Open ${analysis.companyName} company brief`}
          >
            <div>
              <strong>{analysis.companyName}</strong>
              <small>
                {analysis.dealStatus} ·{" "}
                {traceableSourceLabel(analysis.verifiedSourceCount)}
              </small>
            </div>
            <span className={`vsee-analysis-outcome ${analysis.outcome}`}>
              {outcomeLabels[analysis.outcome]}
            </span>
            <span>{analysis.confidence} · {Math.round(analysis.score * 100)}%</span>
            <p>{analysis.marketEvidence.explanation}</p>
            <b>OPEN BRIEF →</b>
          </button>
        ))}
        {!sorted.length && (
          <p className="vsee-analysis-filter-empty">
            No company analyses match these filters.
          </p>
        )}
      </div>
    </section>
  );
}

export function CompanyBrief({
  analysis,
  activeTab,
  onTab,
  onClose,
  showDemoProfiles = true,
}: {
  analysis: CompanyAnalysis;
  activeTab: BriefTab;
  onTab(tab: BriefTab): void;
  onClose(): void;
  showDemoProfiles?: boolean;
}) {
  return (
    <section
      className="vsee-company-brief"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`brief-${analysis.id}`}
    >
      <div className="vsee-company-brief-card">
        <header>
          <div>
            <span className="vsee-eyebrow">COMPANY BRIEF</span>
            <h2 id={`brief-${analysis.id}`}>{analysis.companyName}</h2>
            <p>{outcomeLabels[analysis.outcome]} · {analysis.confidence} confidence</p>
          </div>
          <button onClick={onClose} aria-label="Close company brief">×</button>
        </header>
        <nav aria-label="Company brief sections">
          {briefTabs.map((tab) => (
            <button
              className={activeTab === tab ? "active" : ""}
              onClick={() => onTab(tab)}
              aria-current={activeTab === tab ? "page" : undefined}
              key={tab}
            >
              {tab}
            </button>
          ))}
        </nav>
        <div className="vsee-company-brief-body">
          {activeTab === "IC Snapshot" && (
            <EvidenceFields
              fields={analysis.companyBrief.icSnapshot}
              sources={analysis.sources}
            />
          )}
          {activeTab === "Traction" && (
            <BriefFieldsWithSample
              fields={analysis.companyBrief.traction}
              sources={analysis.sources}
              profile={showDemoProfiles
                ? SAMPLE_DEAL_PROFILES[analysis.dealId]
                : undefined}
              section="traction"
            />
          )}
          {activeTab === "Deal Terms" && (
            <BriefFieldsWithSample
              fields={analysis.companyBrief.dealTerms}
              sources={analysis.sources}
              profile={showDemoProfiles
                ? SAMPLE_DEAL_PROFILES[analysis.dealId]
                : undefined}
              section="dealTerms"
            />
          )}
          {activeTab === "Risks" && (
            <div className="vsee-brief-risks">
              {analysis.companyBrief.risks.length ? analysis.companyBrief.risks.map((risk) => (
                <article key={`${risk.title}-${risk.detail}`}>
                  <span>{risk.severity} risk</span>
                  <h3>{risk.title}</h3>
                  <p>{risk.detail}</p>
                  <strong>Next diligence question</strong>
                  <p>{risk.nextQuestion}</p>
                  <SourceIds ids={risk.sourceIds} sources={analysis.sources} />
                </article>
              )) : <Unavailable />}
            </div>
          )}
          {activeTab === "Decision History" && (
            <div className="vsee-decision-history">
              {analysis.companyBrief.decisionHistory.length
                ? analysis.companyBrief.decisionHistory.map((entry) => (
                    <article key={`${entry.occurredAt}-${entry.title}`}>
                      <time>{formatReportDate(entry.occurredAt)}</time>
                      <h3>{entry.title}</h3>
                      <p>{entry.summary}</p>
                      <SourceIds ids={entry.sourceIds} sources={analysis.sources} />
                    </article>
                  ))
                : <Unavailable />}
            </div>
          )}
          {activeTab === "Source Lineage" && (
            <div className="vsee-source-lineage">
              {analysis.companyBrief.sourceLineage.length
                ? analysis.companyBrief.sourceLineage.map((source) => (
                    <article key={source.id}>
                      <span>{source.provenance.replace("_", " ")}</span>
                      <h3>{source.title}</h3>
                      <p>{evidenceSourceText(source)}</p>
                      <CompanySourceLink source={source} />
                    </article>
                  ))
                : <Unavailable />}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function EvidenceFields({
  fields,
  sources,
}: {
  fields: EvidenceField[];
  sources: EvidenceSourceRef[];
}) {
  return fields.length ? (
    <div className="vsee-evidence-fields">
      {fields.map((field) => (
        <article key={field.label}>
          <span>{field.label}</span>
          <strong>
            {field.value ?? field.unavailableReason
              ?? "Not available in current evidence"}
          </strong>
          <SourceIds ids={field.sourceIds} sources={sources} />
        </article>
      ))}
    </div>
  ) : <Unavailable />;
}

function Unavailable() {
  return (
    <p className="vsee-unavailable">Not available in current evidence</p>
  );
}

function BriefFieldsWithSample({
  fields,
  sources,
  profile,
  section,
}: {
  fields: EvidenceField[];
  sources: EvidenceSourceRef[];
  profile: SampleDealProfile | undefined;
  section: "traction" | "dealTerms";
}) {
  if (!profile) return <EvidenceFields fields={fields} sources={sources} />;
  // With a sample profile present, empty evidence placeholders add nothing:
  // show only evidence fields that actually carry a cited value.
  const populated = fields.filter((field) => field.value);
  return (
    <>
      {populated.length > 0 && (
        <EvidenceFields fields={populated} sources={sources} />
      )}
      <SampleProfileFields profile={profile} section={section} />
    </>
  );
}

function SampleProfileSections({ dealId }: { dealId: string }) {
  const profile = SAMPLE_DEAL_PROFILES[dealId];
  if (!profile) return null;
  return (
    <div className="vsee-priority-profile">
      <SampleProfileFields
        profile={profile}
        section="traction"
        heading={`Traction · ${profile.label}`}
      />
      <SampleProfileFields
        profile={profile}
        section="dealTerms"
        heading={`Deal terms · ${profile.label}`}
      />
    </div>
  );
}

function SampleProfileFields({
  profile,
  section,
  heading,
}: {
  profile: SampleDealProfile | undefined;
  section: "traction" | "dealTerms";
  heading?: string;
}) {
  if (!profile) return null;
  const rows = section === "traction"
    ? profile.traction.map((row) => ({ label: row.metric, value: row.value }))
    : profile.dealTerms.map((row) => ({ label: row.term, value: row.value }));
  return (
    <div className="vsee-sample-profile">
      <span className="vsee-eyebrow">{heading ?? profile.label}</span>
      <div className="vsee-evidence-fields">
        {rows.map((row) => (
          <article key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </article>
        ))}
      </div>
    </div>
  );
}

function SourceIds({
  ids,
  sources,
}: {
  ids: string[];
  sources: EvidenceSourceRef[];
}) {
  const resolved = ids.flatMap((id) => {
    const source = sources.find((candidate) => candidate.id === id);
    return source ? [source] : [];
  });
  return resolved.length ? (
    <footer>
      {resolved.map((source) => (
        <CompanySourceLink key={source.id} source={source} />
      ))}
    </footer>
  ) : null;
}

function sourcePage(source: EvidenceSourceRef): number | undefined {
  if (!("schemaVersion" in source)) return source.page;
  return source.locator?.kind === "document_page"
    ? source.locator.page
    : undefined;
}

export function sourceHref(source: EvidenceSourceRef): string | undefined {
  const page = sourcePage(source);
  if (source.documentId) {
    return `/api/documents/${encodeURIComponent(source.documentId)}/access${page ? `#page=${page}` : ""}`;
  }
  const externalUrl = "schemaVersion" in source
    ? source.canonicalUrl ?? undefined
    : source.url;
  return safeExternalHttpUrl(externalUrl);
}

function CompanySourceLink({ source }: { source: EvidenceSourceRef }) {
  const page = sourcePage(source);
  const href = sourceHref(source);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer">
      {source.publisher ?? source.title}{page ? ` · p.${page}` : ""} ↗
    </a>
  ) : <span>{source.title}</span>;
}
