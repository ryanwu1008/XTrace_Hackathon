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
  DealSemanticField,
  DealStatus,
  EvidenceCoverage,
  EvidenceField,
  EvidenceSourceRef,
  OpportunityReportItem,
} from "../lib/contracts/domain";
import { formatTemporalForDisplay } from "../lib/format/temporal";
import { safeExternalHttpUrl } from "../lib/security/safe-url";
import type { ReportEvidenceContext } from "../lib/contracts/evidence-context";
import {
  hasSampleResearchScreeningAuthority,
  SAMPLE_RESEARCH_SCREENING_BADGE,
} from "../lib/belief-reversal/sample-research-screening-authority";
import { SourceRevisionLink } from "./source-revision-link";

export interface IntelligenceReportView {
  id: string;
  runId?: string;
  createdAt: string;
  marketSummary: string;
  opportunities: OpportunityReportItem[];
  analysisStatus: "completed" | "incomplete";
  evidenceCoverage: EvidenceCoverage;
  counts: CompanyAnalysisCounts & {
    eligibleDealCount?: number;
    companyAnalysisCount?: number;
    beliefRevisedCount?: number;
    monitorCount?: number;
    noMaterialChangeCount?: number;
    analysisUnavailableCount?: number;
    underwritingCandidateCount?: number;
    underwritingQueuedCount?: number;
    underwritingRunningCount?: number;
    underwritingCompletedCount?: number;
    underwritingPartialCount?: number;
    underwritingFailedCount?: number;
  };
  priorityDealId: string | null;
  companyAnalyses: CompanyAnalysis[];
  evidenceContext?: ReportEvidenceContext;
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
  belief_revised: "Changed belief",
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

function analysisHasSampleResearchScreeningAuthority(analysis: CompanyAnalysis): boolean {
  return hasSampleResearchScreeningAuthority(analysis.sources);
}

function SampleResearchScreeningBadge({ analysis }: { analysis: CompanyAnalysis }) {
  if (!analysisHasSampleResearchScreeningAuthority(analysis)) return null;
  return (
    <strong className="vsee-sample-decision-label vsee-sample-research-screening-label">
      {SAMPLE_RESEARCH_SCREENING_BADGE}
    </strong>
  );
}

export function CompanyIntelligenceReport({
  report,
  focused,
  allowDraft,
  onDraft,
  showDemoProfiles = false,
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
          <h2>
            Belief Change Analysis · {report.counts.companyCount} companies
          </h2>
          <details className="vsee-details">
            <summary>How this scan was assembled</summary>
            <p>{report.marketSummary}</p>
          </details>
        </div>
        {allowDraft && (
          <button onClick={() => onDraft(report)}>DRAFT THIS REPORT →</button>
        )}
      </header>

      <ReportEvidenceContextDetail context={report.evidenceContext} />
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
                Deep Underwriting keeps the formal deterministic decision
                separate from Investor Framework Perspectives (independent
                named-advisory viewpoints), with exact Evidence Pack and
                public-source lineage.
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
  const underwritingTerminalCount =
    (report.counts.underwritingCompletedCount ?? 0)
    + (report.counts.underwritingPartialCount ?? 0)
    + (report.counts.underwritingFailedCount ?? 0);
  const items = [
    ["Eligible Deals", report.counts.eligibleDealCount ?? report.counts.companyCount],
    [
      "Belief Change Checks",
      report.counts.companyAnalysisCount ?? report.companyAnalyses.length,
    ],
    ["Belief Revisions", report.counts.beliefRevised],
    ["Monitor", report.counts.monitor],
    ["No material change", report.counts.noMaterialChange],
    ["Unavailable", report.counts.analysisUnavailable],
    ["Accepted public events", report.evidenceCoverage.acceptedPublicEvents],
    ["Recalled Deal memories", report.evidenceCoverage.recalledDealCount],
    ["Underwriting terminal", underwritingTerminalCount],
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

function ReportEvidenceContextDetail({
  context,
}: {
  context: ReportEvidenceContext | undefined;
}) {
  if (!context || context.state === "legacy_unbound") {
    return (
      <section className="vsee-evidence-context-detail" role="note">
        <strong>LEGACY REPORT</strong>
        <span>Evidence context unavailable</span>
      </section>
    );
  }
  const pinned = context.evidenceMode === "pinned";
  return (
    <section className="vsee-evidence-context-detail" role="note">
      <header>
        <strong>{pinned ? "PINNED DEMO REPLAY" : "LIVE EVIDENCE"}</strong>
        <span>{context.displayLabel}</span>
        {pinned && (
          <small>Historical evidence snapshot · Not current news</small>
        )}
      </header>
      <details className="vsee-details">
        <summary>Evidence context and immutable identity</summary>
        <Definition label="Evidence mode" value={context.evidenceMode} />
        <Definition label="Anchor" value={formatReportDate(context.anchorAt)} />
        <Definition
          label="Evidence window"
          value={`${formatReportDate(context.windowStartAt)} → ${formatReportDate(context.windowEndAt)} · ${context.windowTimezone}`}
        />
        <Definition label="Accepted events" value={String(context.eventCount)} />
        <Definition
          label="Snapshot ID"
          value={context.snapshotId ?? "Not applicable to live evidence"}
        />
        <Definition
          label="Snapshot fingerprint"
          value={context.snapshotFingerprint ?? "Not applicable to live evidence"}
        />
        <Definition label="Context fingerprint" value={context.contextFingerprint} />
        <Definition label="Event-set fingerprint" value={context.eventSetFingerprint} />
        <Definition label="Binding fingerprint" value={context.bindingFingerprint} />
      </details>
    </section>
  );
}

export function PriorityResult({
  analysis,
  onOpenBrief,
  showDemoProfiles = false,
}: {
  analysis: CompanyAnalysis;
  onOpenBrief(): void;
  showDemoProfiles?: boolean;
}) {
  return (
    <section className="vsee-priority-result" aria-labelledby={`priority-${analysis.id}`}>
      <header>
        <div>
          <span className="vsee-eyebrow">
            CHANGED BELIEF · PRIORITY ORDER #1
          </span>
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
        <SampleResearchScreeningBadge analysis={analysis} />
      </header>

      <div className="vsee-priority-grid">
        <section>
          <span>THEN / INVESTMENT MEMORY</span>
          <h3>What the fund believed</h3>
          {analysis.investmentMemory.fixtureIds.length > 0 && (
            <strong className="vsee-sample-decision-label">
              Sample decision record
            </strong>
          )}
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
                const resolvedSources = eventSourceIds
                  .map((sourceId) => analysis.sources.find(
                    (source) => source.id === sourceId,
                  ))
                  .filter((source): source is EvidenceSourceRef =>
                    source !== undefined
                  );
                const sourceUrl = resolvedSources
                  .map((source) => sourceHref(source))
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
                    <EventProvenanceDetail event={event} />
                    {resolvedSources.length > 0 && (
                      <footer>
                        {resolvedSources.map((source) => (
                          <CompanySourceLink key={source.id} source={source} />
                        ))}
                      </footer>
                    )}
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

      <BeliefAssessmentDetail analysis={analysis} />

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

function formatProvenanceTemporal(
  value: string | null,
  precision: "date" | "timestamp" | null,
): string {
  return value === null || precision === null
    ? "Unavailable"
    : formatReportDate(value);
}

function EventProvenanceDetail({
  event,
}: {
  event: CompanyAnalysis["marketEvidence"]["events"][number];
}) {
  if (!("schemaVersion" in event)) {
    return (
      <details className="vsee-details">
        <summary>Event provenance</summary>
        <Definition
          label="Publication date · legacy timestamp precision"
          value={formatReportDate(event.publishedAt)}
        />
        <Definition
          label="Trigger lineage"
          value={event.sourceIds.join(" · ")}
        />
        <p>Legacy event provenance is incomplete.</p>
      </details>
    );
  }
  if (event.adaptation === "legacy_read") {
    return (
      <details className="vsee-details">
        <summary>Event provenance</summary>
        <Definition label="Event date · unknown precision" value="Unavailable" />
        <Definition
          label={`Publication date · ${event.publishedAtPrecision ?? "unknown"} precision`}
          value={formatProvenanceTemporal(
            event.publishedAt,
            event.publishedAtPrecision,
          )}
        />
        <Definition
          label={`Retrieval date · ${event.retrievedAtPrecision ?? "unknown"} precision`}
          value={formatProvenanceTemporal(
            event.retrievedAt,
            event.retrievedAtPrecision,
          )}
        />
        <Definition
          label={`Update date · ${event.updatedAtPrecision ?? "unknown"} precision`}
          value={formatProvenanceTemporal(
            event.updatedAt,
            event.updatedAtPrecision,
          )}
        />
        <Definition label="Provider" value={event.providerId ?? "Unavailable"} />
        <Definition
          label="Entity keys"
          value={event.entityKeys.length ? event.entityKeys.join(" · ") : "Unavailable"}
        />
        <Definition
          label="Content fingerprint"
          value={event.contentFingerprint ?? "Unavailable"}
        />
        <p>Legacy trigger lineage unavailable.</p>
      </details>
    );
  }
  return (
    <details className="vsee-details">
      <summary>Event provenance</summary>
      <Definition
        label={`Event date · ${event.eventAtPrecision ?? "unknown"} precision`}
        value={formatProvenanceTemporal(event.eventAt, event.eventAtPrecision)}
      />
      <Definition
        label={`Publication date · ${event.publishedAtPrecision} precision`}
        value={formatProvenanceTemporal(
          event.publishedAt,
          event.publishedAtPrecision,
        )}
      />
      <Definition
        label={`Retrieval date · ${event.retrievedAtPrecision} precision`}
        value={formatProvenanceTemporal(
          event.retrievedAt,
          event.retrievedAtPrecision,
        )}
      />
      <Definition
        label={`Update date · ${event.updatedAtPrecision ?? "unknown"} precision`}
        value={formatProvenanceTemporal(event.updatedAt, event.updatedAtPrecision)}
      />
      <Definition label="Provider" value={event.providerId ?? "Unavailable"} />
      <Definition label="Entity keys" value={event.entityKeys.join(" · ")} />
      <Definition
        label="Content fingerprint"
        value={event.contentFingerprint ?? "Unavailable"}
      />
      <p>Trigger source · {event.triggerSourceId}</p>
    </details>
  );
}

function percentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function actionListLabel(
  actions: NonNullable<CompanyAnalysis["beliefAssessment"]>["actions"],
): string {
  return actions.map((action) =>
    `${action.kind.replaceAll("_", " ")} · ${action.scope} · ${action.priority}`
  ).join(" | ");
}

function BeliefAssessmentDetail({ analysis }: { analysis: CompanyAnalysis }) {
  const assessment = analysis.beliefAssessment;
  const audit = analysis.currentRunAudit;
  if (!assessment && !audit) {
    return (
      <section className="vsee-belief-assessment" role="note">
        <strong>Weighted match assessment unavailable</strong>
        <p>This legacy analysis does not contain persisted score dimensions or hard-gate results.</p>
      </section>
    );
  }
  const score = assessment?.scoreBreakdown ?? audit!.scoreBreakdown;
  const gates = assessment?.gates ?? audit!.gates;
  const gateRows: Array<{
    label: string;
    result: { passed: boolean; failureReason: string | null };
    detail: string;
  }> = assessment
    ? [
      {
        label: "Chronology",
        result: assessment.gates.chronology,
        detail:
          `${assessment.gates.chronology.priorInteractionId ?? "No prior interaction"} → ${assessment.gates.chronology.triggerEventId ?? "No trigger event"}`,
      },
      {
        label: "Revisit-condition mapping",
        result: assessment.gates.revisitConditionMapping,
        detail: assessment.gates.revisitConditionMapping.revisitConditionText
          ? `Condition #${(assessment.gates.revisitConditionMapping.revisitConditionIndex ?? 0) + 1}: ${assessment.gates.revisitConditionMapping.revisitConditionText} · Sources: ${assessment.gates.revisitConditionMapping.citedSourceIds.join(" · ")}`
          : "No exact revisit condition was mapped.",
      },
      {
        label: "Counterevidence",
        result: assessment.gates.counterevidence,
        detail: assessment.gates.counterevidence.statement
          ? `${assessment.gates.counterevidence.statement} · Sources: ${assessment.gates.counterevidence.citedSourceIds.join(" · ") || "None"}`
          : "No counterevidence statement was retained.",
      },
      {
        label: "Action delta",
        result: assessment.gates.actionDelta,
        detail:
          `Before: ${actionListLabel(assessment.gates.actionDelta.priorActions)} · After: ${actionListLabel(assessment.gates.actionDelta.proposedActions)}`,
      },
    ]
    : [
      {
        label: "Chronology",
        result: audit!.gates.chronology,
        detail: "Persisted current-run chronology verdict.",
      },
      {
        label: "Revisit-condition mapping",
        result: audit!.gates.revisitConditionMapping,
        detail: "Persisted current-run revisit-condition verdict.",
      },
      {
        label: "Counterevidence",
        result: audit!.gates.counterevidence,
        detail: "Persisted current-run counterevidence verdict.",
      },
      {
        label: "Action delta",
        result: audit!.gates.actionDelta,
        detail: `Proposed: ${actionListLabel(audit!.actions)}`,
      },
    ];
  return (
    <section className="vsee-belief-assessment" aria-label="Match confidence and hard gates">
      <header>
        <span>WEIGHTED MATCH CONFIDENCE</span>
        <strong>{percentage(score.finalScore)} · {score.confidence}</strong>
      </header>
      {!assessment && audit && (
        <p>
          Current-run Belief Change Check · persisted audit result for a non-underwritten analysis.
        </p>
      )}
      <div className="vsee-score-breakdown">
        <Definition label="Event relevance · 35%" value={percentage(score.eventRelevance)} />
        <Definition label="Deal relevance · 30%" value={percentage(score.dealRelevance)} />
        <Definition
          label="Prior decision-context strength · 20%"
          value={percentage(score.priorContextStrength)}
        />
        <Definition label="Evidence quality · 15%" value={percentage(score.evidenceQuality)} />
        <Definition label="Medium threshold" value="50%" />
        <Definition label="High threshold" value="78%" />
      </div>
      <div className="vsee-hard-gates">
        <h3>Belief-revision hard gates</h3>
        {gateRows.map(({ label, result, detail }) => (
          <article key={label}>
            <header>
              <strong>{label}</strong>
              <span>{result.passed ? "Passed" : "Failed"}</span>
            </header>
            <p>{detail}</p>
            {!result.passed && (
              <p><strong>Exact failure reason:</strong> {result.failureReason}</p>
            )}
          </article>
        ))}
        <p>
          Overall hard-gate result · {gates.allPassed ? "Passed" : "Failed"}
        </p>
      </div>
      {!assessment && audit?.nonChangeReason && (
        <Definition label="Why no material change was recorded" value={audit.nonChangeReason} />
      )}
      {!assessment && audit?.analysisFailureReason && (
        <Definition label="Why analysis was unavailable" value={audit.analysisFailureReason} />
      )}
      {!assessment && audit?.whyNotUnderwriting && (
        <Definition
          label="Why Deep Underwriting did not start"
          value={audit.whyNotUnderwriting}
        />
      )}
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
          <span>BELIEF CHANGE ANALYSIS</span>
          <h2>All {analyses.length} Belief Change Analyses</h2>
        </div>
        <div className="vsee-analysis-filters">
          <label>
            <span>Outcome</span>
            <select value={outcome} onChange={(event) =>
              setOutcome(event.target.value as "all" | CompanyAnalysisOutcome)
            }>
              <option value="all">All</option>
              <option value="belief_revised">Changed belief</option>
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
              <SampleResearchScreeningBadge analysis={analysis} />
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
  showDemoProfiles = false,
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
            <SampleResearchScreeningBadge analysis={analysis} />
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
            <BeliefAssessmentDetail analysis={analysis} />
          )}
          {activeTab === "IC Snapshot" && (
            <CompanyBriefFieldSet
              fields={analysis.companyBrief.icSnapshot}
              structuredFields={structuredFieldsForTab(
                analysis.companyBrief.structuredFields ?? [],
                "IC Snapshot",
              )}
              sources={analysis.sources}
            />
          )}
          {activeTab === "Traction" && (
            <CompanyBriefFieldSet
              fields={analysis.companyBrief.traction}
              structuredFields={structuredFieldsForTab(
                analysis.companyBrief.structuredFields ?? [],
                "Traction",
              )}
              sources={analysis.sources}
              profile={showDemoProfiles
                ? SAMPLE_DEAL_PROFILES[analysis.dealId]
                : undefined}
              section="traction"
            />
          )}
          {activeTab === "Deal Terms" && (
            <CompanyBriefFieldSet
              fields={analysis.companyBrief.dealTerms}
              structuredFields={structuredFieldsForTab(
                analysis.companyBrief.structuredFields ?? [],
                "Deal Terms",
              )}
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
                ? analysis.companyBrief.decisionHistory.map((entry) => {
                    const sampleDecision = entry.sourceIds.some((sourceId) =>
                      analysis.investmentMemory.fixtureIds.includes(sourceId)
                    );
                    return (
                      <article key={`${entry.occurredAt}-${entry.title}`}>
                        <time>{formatReportDate(entry.occurredAt)}</time>
                        {sampleDecision && (
                          <strong className="vsee-sample-decision-label">
                            Sample decision record
                          </strong>
                        )}
                        {entry.title !== "Sample decision record" && (
                          <h3>{entry.title}</h3>
                        )}
                        <p>{entry.summary}</p>
                        <SourceIds ids={entry.sourceIds} sources={analysis.sources} />
                      </article>
                    );
                  })
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
                      <SourceEvidenceText source={source} />
                      <SourceProvenance source={source} />
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

const structuredFieldTabs: Record<BriefTab, ReadonlySet<DealSemanticField["fieldId"]>> = {
  "IC Snapshot": new Set([
    "company_identity",
    "legal_name",
    "official_domain",
    "founders",
    "founding_date",
    "stage",
    "business_model",
    "geography",
    "security_type",
    "unknowns",
  ]),
  Traction: new Set([
    "arr",
    "revenue",
    "customer_evidence",
    "customer_count",
    "cash",
    "burn",
    "runway",
    "retention",
  ]),
  "Deal Terms": new Set([
    "reported_valuation",
    "reported_valuation_basis",
    "round",
    "raise",
  ]),
  Risks: new Set(),
  "Decision History": new Set(),
  "Source Lineage": new Set(),
};

function structuredFieldsForTab(
  fields: DealSemanticField[],
  tab: BriefTab,
): DealSemanticField[] {
  const allowed = structuredFieldTabs[tab];
  return fields.filter((field) => allowed.has(field.fieldId));
}

function semanticFieldLabel(fieldId: DealSemanticField["fieldId"]): string {
  const words = fieldId.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function StructuredFields({
  fields,
  sources,
}: {
  fields: DealSemanticField[];
  sources: EvidenceSourceRef[];
}) {
  if (!fields.length) return null;
  return (
    <div className="vsee-evidence-fields vsee-structured-fields">
      {fields.map((field) => (
        <article key={field.id}>
          <span>{semanticFieldLabel(field.fieldId)}</span>
          {field.classification === "fact" && (
            <>
              <strong>{field.value}</strong>
              {field.basis && <small>Fact basis · {field.basis}</small>}
              {field.asOfDate && (
                <small>As of · {formatReportDate(field.asOfDate)}</small>
              )}
              <SourceIds ids={field.sourceIds} sources={sources} />
            </>
          )}
          {field.classification === "unavailable" && (
            <>
              <strong>Unavailable</strong>
              <p>{field.reason}</p>
              <SourceIds ids={field.checkedSourceIds} sources={sources} />
            </>
          )}
          {field.classification === "conflicting" && (
            <>
              <strong>Conflicting evidence</strong>
              {field.observations.map((observation) => (
                <div key={`${field.id}-${observation.sourceId}`}>
                  <p>{observation.value}</p>
                  <SourceIds ids={[observation.sourceId]} sources={sources} />
                </div>
              ))}
            </>
          )}
          {field.classification === "assumption" && (
            <>
              <strong>Assumption · Requires confirmation</strong>
              <p>{field.value}</p>
              <small>{field.rationale}</small>
              <small>Source boundary · {field.sourceBoundary}</small>
            </>
          )}
          {field.classification === "unknown" && (
            <>
              <strong>Unknown</strong>
              <p>{field.reason}</p>
            </>
          )}
        </article>
      ))}
    </div>
  );
}

function CompanyBriefFieldSet({
  fields,
  structuredFields,
  sources,
  profile,
  section,
}: {
  fields: EvidenceField[];
  structuredFields: DealSemanticField[];
  sources: EvidenceSourceRef[];
  profile?: SampleDealProfile;
  section?: "traction" | "dealTerms";
}) {
  const visibleFields = profile
    ? fields.filter((field) => field.value)
    : fields;
  const hasCanonicalEvidence = structuredFields.length > 0
    || visibleFields.length > 0;
  return (
    <>
      <StructuredFields fields={structuredFields} sources={sources} />
      {visibleFields.length > 0 && (
        <EvidenceFields fields={visibleFields} sources={sources} />
      )}
      {profile && section && (
        <SampleProfileFields profile={profile} section={section} />
      )}
      {!hasCanonicalEvidence && !profile && <Unavailable />}
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

function exactSourceRevisionId(
  source: EvidenceSourceRef,
): string | undefined {
  if ("schemaVersion" in source) {
    return source.sourceRevisionId ?? undefined;
  }
  return source.sourceRevisionId;
}

function publicCanonicalHref(
  source: EvidenceSourceRef,
): string | undefined {
  const value = "schemaVersion" in source
    ? source.provenance === "public_web"
      ? source.canonicalUrl ?? undefined
      : undefined
    : source.provenance === "public_web"
    ? source.url
    : undefined;
  return safeExternalHttpUrl(value);
}

export function sourceHref(source: EvidenceSourceRef): string | undefined {
  const page = sourcePage(source);
  const canonicalHref = publicCanonicalHref(source);
  if (canonicalHref) return canonicalHref;
  const revisionId = exactSourceRevisionId(source);
  return revisionId
    ? `/api/source-revisions/${encodeURIComponent(revisionId)}/access${page ? `#page=${page}` : ""}`
    : undefined;
}

function sourceLocator(source: EvidenceSourceRef): string {
  if (!("schemaVersion" in source)) {
    return source.page ? `Document page ${source.page}` : "Unavailable";
  }
  const locator = source.locator;
  if (!locator) return "Unavailable";
  if (locator.kind === "web_text") return `Web selector · ${locator.selector}`;
  if (locator.kind === "document_page") return `Document page · ${locator.page}`;
  if (locator.kind === "json_pointer") return `JSON pointer · ${locator.pointer}`;
  return `Lines ${locator.startLine}–${locator.endLine}`;
}

function SourceEvidenceText({ source }: { source: EvidenceSourceRef }) {
  if (!("schemaVersion" in source)) {
    return (
      <div className="vsee-source-evidence-text legacy-unverified">
        <strong>Legacy unverified statement · Not a quotation</strong>
        <p>{source.excerpt}</p>
      </div>
    );
  }
  const evidence = source.text;
  if (evidence.status === "verified_exact") {
    return (
      <div className="vsee-source-evidence-text verified-exact">
        <strong>Verified verbatim excerpt</strong>
        <blockquote>“{evidence.verbatimExcerpt}”</blockquote>
        {evidence.normalizedStatement && (
          <>
            <strong>Normalized statement · Not a quotation</strong>
            <p>{evidence.normalizedStatement}</p>
          </>
        )}
      </div>
    );
  }
  if (evidence.status === "normalized_only") {
    return (
      <div className="vsee-source-evidence-text normalized-only">
        <strong>Normalized-only evidence · Not a quotation</strong>
        <p>{evidence.normalizedStatement}</p>
      </div>
    );
  }
  if (evidence.status === "legacy_unverified") {
    return (
      <div className="vsee-source-evidence-text legacy-unverified">
        <strong>Legacy unverified statement · Not a quotation</strong>
        <p>{evidence.normalizedStatement}</p>
      </div>
    );
  }
  return (
    <div className="vsee-source-evidence-text model-inference">
      <strong>Model inference · Not a fact or quotation</strong>
      <p>{evidence.normalizedStatement}</p>
      <small>
        {evidence.model.provider} · {evidence.model.model} · Generated {formatReportDate(evidence.model.generatedAt)}
      </small>
      <small>Input fingerprint · {evidence.model.inputFingerprint}</small>
    </div>
  );
}

function SourceProvenance({ source }: { source: EvidenceSourceRef }) {
  if (!("schemaVersion" in source)) {
    return (
      <div className="vsee-source-provenance">
        <Definition label="Event date · unknown precision" value="Unavailable" />
        <Definition
          label={`Publication date · ${source.publishedAt ? "timestamp" : "unknown"} precision`}
          value={source.publishedAt
            ? formatReportDate(source.publishedAt)
            : "Unavailable"}
        />
        <Definition label="Retrieval date · unknown precision" value="Unavailable" />
        <Definition label="Update date · unknown precision" value="Unavailable" />
        <Definition label="Source class" value="Unknown legacy" />
        <Definition label="Source authority" value="Unknown legacy" />
        <Definition label="Evidence role" value="Unknown legacy" />
        <Definition label="Provider" value="Unavailable" />
        <Definition label="Entity keys" value="Unavailable" />
        <Definition label="Locator" value={sourceLocator(source)} />
        <Definition label="Content fingerprint" value="Unavailable" />
        <Definition
          label="Source Revision"
          value={source.sourceRevisionId ?? "Unavailable"}
        />
      </div>
    );
  }
  return (
    <div className="vsee-source-provenance">
      <Definition
        label={`Event date · ${source.eventAtPrecision ?? "unknown"} precision`}
        value={formatProvenanceTemporal(source.eventAt, source.eventAtPrecision)}
      />
      <Definition
        label={`Publication date · ${source.publishedAtPrecision ?? "unknown"} precision`}
        value={formatProvenanceTemporal(
          source.publishedAt,
          source.publishedAtPrecision,
        )}
      />
      <Definition
        label={`Retrieval date · ${source.retrievedAtPrecision ?? "unknown"} precision`}
        value={formatProvenanceTemporal(
          source.retrievedAt,
          source.retrievedAtPrecision,
        )}
      />
      <Definition
        label={`Update date · ${source.updatedAtPrecision ?? "unknown"} precision`}
        value={formatProvenanceTemporal(source.updatedAt, source.updatedAtPrecision)}
      />
      <Definition label="Source class" value={source.sourceClass.replaceAll("_", " ")} />
      <Definition label="Source authority" value={source.sourceAuthority.replaceAll("_", " ")} />
      <Definition label="Evidence role" value={source.evidenceRole.replaceAll("_", " ")} />
      <Definition label="Provider" value={source.providerId ?? "Unavailable"} />
      <Definition
        label="Entity keys"
        value={source.entityKeys.length ? source.entityKeys.join(" · ") : "Unavailable"}
      />
      <Definition label="Locator" value={sourceLocator(source)} />
      <Definition
        label="Content fingerprint"
        value={source.contentFingerprint ?? "Unavailable"}
      />
      <Definition
        label="Source Revision"
        value={source.sourceRevisionId ?? "Unavailable"}
      />
      <Definition
        label="Trigger lineage"
        value={source.evidenceRole === "trigger"
          ? `Trigger source · ${source.id}`
          : `Not a trigger · ${source.id}`}
      />
    </div>
  );
}

function CompanySourceLink({ source }: { source: EvidenceSourceRef }) {
  const page = sourcePage(source);
  const canonicalHref = publicCanonicalHref(source);
  const revisionId = exactSourceRevisionId(source);
  if (!canonicalHref && !revisionId) {
    return <span>{source.title} · No public URL or exact Source Revision</span>;
  }
  return (
    <span className="vsee-company-source-links">
      {canonicalHref && (
        <a href={canonicalHref} target="_blank" rel="noreferrer">
          {source.publisher ?? source.title} · Public canonical source ↗
        </a>
      )}
      {revisionId && (
        <SourceRevisionLink revisionId={revisionId} page={page}>
          Exact Source Revision · {revisionId}{page ? ` · p.${page}` : ""} ↗
        </SourceRevisionLink>
      )}
    </span>
  );
}
