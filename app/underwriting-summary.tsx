"use client";

import { useEffect, useState } from "react";

import type { CompanyAnalysis, RunStatus } from "../lib/contracts/domain";
import type { ReportEvidenceContext } from "../lib/contracts/evidence-context";
import type {
  PublicActionDraft,
  UnderwritingBatchSummary,
  VersionedCandidateUnderwritingDetail,
} from "../lib/underwriting/read-model";
import { ActionDraftDialog } from "./action-draft-dialog";
import { apiRequest } from "./api-client";
import {
  UnderwritingDetailDialog,
} from "./underwriting-detail";
import { orderUnderwritingQueue } from "./underwriting-view-model";
import type { CurrentUnderwritingExecution } from
  "../lib/reports/current-underwriting-integrity";

const statusLabels = {
  queued: "Queued",
  running: "Running",
  partial: "Partial",
  completed: "Completed",
  failed: "Failed",
} as const;

const UNDERWRITING_REFRESH_INTERVAL_MS = 2_000;

export function underwritingSummaryNeedsRefresh(
  batch: UnderwritingBatchSummary | null,
  expectedCandidateCount: number,
  runStatus: RunStatus | "unavailable" | undefined,
): boolean {
  void batch;
  void expectedCandidateCount;
  return runStatus === "queued" || runStatus === "running";
}

export function UnderwritingSummary({
  reportId,
  companyNames,
  analyses,
  enabled,
  canSaveDrafts,
}: {
  reportId: string;
  companyNames: Record<string, string>;
  analyses: CompanyAnalysis[];
  enabled: boolean;
  canSaveDrafts: boolean;
}) {
  const [batch, setBatch] = useState<UnderwritingBatchSummary | null>(
    null,
  );
  const [loading, setLoading] = useState(enabled);
  const [batchError, setBatchError] = useState("");
  const [execution, setExecution] =
    useState<CurrentUnderwritingExecution | null>(null);
  const [candidateError, setCandidateError] = useState("");
  const [retryToken, setRetryToken] = useState(0);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [detail, setDetail] =
    useState<VersionedCandidateUnderwritingDetail | null>(null);
  const [loadedEvidenceContext, setLoadedEvidenceContext] = useState<{
    reportId: string;
    context: ReportEvidenceContext | undefined;
  } | null>(null);
  const [drafts, setDrafts] = useState<PublicActionDraft[]>([]);
  const [editingDraft, setEditingDraft] =
    useState<PublicActionDraft | null>(null);
  const expectedCandidateCount = analyses.filter(
    ({ outcome }) => outcome === "belief_revised",
  ).length;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let lastRunStatus: CurrentUnderwritingExecution["runStatus"] | undefined;

    queueMicrotask(() => {
      if (cancelled) return;
      setBatch(null);
      setExecution(null);
      setBatchError("");
      setLoading(true);
    });

    const scheduleRefresh = () => {
      refreshTimer = setTimeout(() => {
        void loadSummary();
      }, UNDERWRITING_REFRESH_INTERVAL_MS);
    };
    const loadSummary = async () => {
      try {
        const report = await apiRequest<{
          underwritingBatch?: UnderwritingBatchSummary;
          underwritingExecution?: CurrentUnderwritingExecution;
          evidenceContext?: ReportEvidenceContext;
        }>(`/api/reports/${encodeURIComponent(reportId)}`);
        if (!cancelled) {
          const nextBatch = report.underwritingBatch ?? null;
          const nextExecution = report.underwritingExecution ?? null;
          setBatchError("");
          setBatch(nextBatch);
          setExecution(nextExecution);
          if (nextExecution?.state === "integrity_error") {
            setSelectedDealId(null);
            setDetail(null);
            setDrafts([]);
            setEditingDraft(null);
          }
          lastRunStatus = report.underwritingExecution?.runStatus;
          setLoadedEvidenceContext({
            reportId,
            context: report.evidenceContext,
          });
          if (underwritingSummaryNeedsRefresh(
            nextBatch,
            expectedCandidateCount,
            report.underwritingExecution?.runStatus,
          )) {
            scheduleRefresh();
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setBatchError(loadError instanceof Error
            ? loadError.message
            : "Underwriting summary could not be loaded.");
          if (underwritingSummaryNeedsRefresh(
            null,
            expectedCandidateCount,
            lastRunStatus,
          )) {
            scheduleRefresh();
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadSummary();
    return () => {
      cancelled = true;
      if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    };
  }, [enabled, expectedCandidateCount, reportId, retryToken]);

  async function openCandidate(
    entry: UnderwritingBatchSummary["queue"][number],
  ) {
    if (execution?.state === "integrity_error") {
      setCandidateError(
        "Candidate detail is withheld until the underwriting integrity error is resolved.",
      );
      return;
    }
    setSelectedDealId(entry.dealId);
    setDetail(null);
    setDrafts([]);
    setCandidateError("");
    try {
      const [candidateDetail, actionDrafts] = await Promise.all([
        apiRequest<VersionedCandidateUnderwritingDetail>(
          `/api/reports/${encodeURIComponent(reportId)}/underwriting/${
            encodeURIComponent(entry.dealId)
          }`,
        ),
        apiRequest<PublicActionDraft[]>(
          `/api/action-drafts?candidateRunId=${
            encodeURIComponent(entry.candidateRunId)
          }`,
        ),
      ]);
      setDetail(candidateDetail);
      setDrafts(actionDrafts);
    } catch (loadError) {
      setSelectedDealId(null);
      setCandidateError(loadError instanceof Error
        ? loadError.message
        : "Candidate underwriting detail could not be loaded.");
    }
  }

  const selectedAnalysis = analyses.find(
    (analysis) => analysis.dealId === selectedDealId,
  ) ?? null;
  const selectedName = selectedDealId
    ? companyNames[selectedDealId]
      ?? selectedAnalysis?.companyName
      ?? selectedDealId
    : "";
  const evidenceContext = loadedEvidenceContext?.reportId === reportId
    ? loadedEvidenceContext.context
    : undefined;

  return (
    <>
      {loading ? (
        <section className="vsee-underwriting-summary" role="status">
          <header>
            <span className="vsee-eyebrow">Belief Revisions</span>
            <h2>Loading Underwriting Queue and Underwriting Status…</h2>
          </header>
        </section>
      ) : (
        <UnderwritingSummaryPanel
          batch={batch}
          companyNames={companyNames}
          onOpenCandidate={(entry) => void openCandidate(entry)}
          emptyMessage={enabled
            ? "This report has no persisted underwriting batch."
            : "Public demo reports are synthetic and read-only; no persisted product underwriting is presented as fact."}
          executionMessage={execution?.message ?? undefined}
          integrityBlocked={execution?.state === "integrity_error"}
        />
      )}
      {batchError && (
        <div className="vsee-underwriting-error" role="alert">
          <span>{batchError}</span>
          <button
            onClick={() => {
              setLoading(true);
              setBatchError("");
              setRetryToken((current) => current + 1);
            }}
          >
            RETRY
          </button>
        </div>
      )}
      {candidateError && (
        <p className="vsee-underwriting-error" role="alert">
          {candidateError}
        </p>
      )}
      <UnderwritingDetailDialog
        open={selectedDealId !== null}
        companyName={selectedName}
        analysis={selectedAnalysis}
        detail={detail}
        drafts={drafts}
        evidenceContext={evidenceContext}
        canSaveDrafts={canSaveDrafts}
        onClose={() => setSelectedDealId(null)}
        onEditDraft={setEditingDraft}
      />
      <ActionDraftDialog
        draft={editingDraft}
        canSave={canSaveDrafts}
        onClose={() => setEditingDraft(null)}
        onSaved={(updated) => {
          setDrafts((current) =>
            current.map((draft) => draft.id === updated.id ? updated : draft)
          );
          setEditingDraft(updated);
        }}
      />
    </>
  );
}

export function UnderwritingSummaryPanel({
  batch,
  companyNames,
  onOpenCandidate,
  emptyMessage = "This report has no persisted underwriting batch.",
  executionMessage,
  integrityBlocked = false,
}: {
  batch: UnderwritingBatchSummary | null;
  companyNames: Record<string, string>;
  onOpenCandidate(
    entry: UnderwritingBatchSummary["queue"][number],
  ): void;
  emptyMessage?: string;
  executionMessage?: string;
  integrityBlocked?: boolean;
}) {
  const trustedBatch = integrityBlocked ? null : batch;
  const queue = trustedBatch
    ? orderUnderwritingQueue(trustedBatch.queue)
    : [];

  return (
    <section
      className="vsee-underwriting-summary"
      aria-labelledby="underwriting-queue"
    >
      <header>
        <div>
          <span className="vsee-eyebrow">Belief Revisions</span>
          <h2 id="underwriting-queue">Underwriting Queue</h2>
          <p>
            All Changed Beliefs enter Deep Underwriting. Priority Order
            controls execution order only and never eligibility. Open finalized
            work for the decision-first memo, complete Investor Framework
            Perspectives and Named Lens readings, Evidence Pack IDs, and exact
            public-source lineage.
          </p>
        </div>
        {trustedBatch && (
          <span className={`vsee-batch-state ${trustedBatch.status}`}>
            Underwriting Status · {statusLabels[trustedBatch.status]}
          </span>
        )}
      </header>

      {executionMessage && (
        <p className="vsee-underwriting-execution-message" role="alert">
          {executionMessage}
        </p>
      )}

      {integrityBlocked ? (
        <p className="vsee-underwriting-empty" role="status">
          The underwriting queue and candidate details are withheld. Review
          System activity and rerun the scan before relying on this work.
        </p>
      ) : !trustedBatch ? (
        <p className="vsee-underwriting-empty" role="status">{emptyMessage}</p>
      ) : (
        <>
          <div
            className="vsee-underwriting-status-counts"
            aria-label="Underwriting Status counts"
          >
            {Object.entries(trustedBatch.underwritingStatusCounts).map(
              ([status, count]) => (
                <span className="vsee-underwriting-count" key={status}>
                  {statusLabels[status as keyof typeof statusLabels]} · {count}
                </span>
              ),
            )}
          </div>
          <div className="vsee-underwriting-rows">
          {queue.map((entry) => {
            const openable = entry.status === "completed"
              || entry.status === "partial";
            return (
              <article
                className={`vsee-underwriting-row ${entry.status}`}
                key={entry.dealId}
              >
                <div className="vsee-underwriting-priority">
                  <small>Priority Order</small>
                  <strong>#{entry.priorityRank}</strong>
                  <span className="vsee-visually-hidden">
                    Priority Order · #{entry.priorityRank}
                  </span>
                </div>
                <div className="vsee-underwriting-company">
                  <strong>
                    {companyNames[entry.dealId] ?? entry.dealId}
                  </strong>
                  <small>{entry.dealId}</small>
                  {entry.reason && <small>{entry.reason}</small>}
                </div>
                <span className="vsee-underwriting-status">
                  Underwriting Status · {statusLabels[entry.status]}
                </span>
                <div className="vsee-underwriting-decision">
                  <small>IC RESULT</small>
                  {entry.decision ? (
                    <strong>{entry.decision}</strong>
                  ) : (
                    <span>
                      Formal decision unavailable — open the report for blockers
                      and decision ceilings.
                    </span>
                  )}
                </div>
                <button
                  onClick={() => onOpenCandidate(entry)}
                  disabled={!openable}
                  aria-label={openable
                    ? `Open underwriting for ${
                        companyNames[entry.dealId] ?? entry.dealId
                      }`
                    : `${statusLabels[entry.status]} underwriting is not finalized`}
                >
                  {openable ? "OPEN DETAIL →" : "NOT READY"}
                </button>
              </article>
            );
          })}
          </div>
          {trustedBatch.legacyPinnedPriorityOrder && (
            <details className="vsee-details">
              <summary>Historical Priority Order · read-only pinned report</summary>
              <p>
                This compatibility view records historical ordering only. It
                does not control eligibility for new runs.
              </p>
              <ol>
                {trustedBatch.legacyPinnedPriorityOrder.entries.map((entry) => (
                  <li key={entry.dealId}>
                    {entry.historicalPriorityOrder === null
                      ? "No historical priority"
                      : `#${entry.historicalPriorityOrder}`} · {companyNames[entry.dealId]
                      ?? entry.dealId} · {entry.historicalAdmissionStatus
                        === "historically_admitted"
                      ? "Historically admitted"
                      : "Historical non-admission"}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </>
      )}
    </section>
  );
}
