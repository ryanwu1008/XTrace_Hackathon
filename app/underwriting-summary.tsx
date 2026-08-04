"use client";

import { useEffect, useState } from "react";

import type { CompanyAnalysis } from "../lib/contracts/domain";
import type { ReportEvidenceContext } from "../lib/contracts/evidence-context";
import type {
  CandidateUnderwritingDetail,
  PublicActionDraft,
  UnderwritingBatchSummary,
} from "../lib/underwriting/read-model";
import { ActionDraftDialog } from "./action-draft-dialog";
import { apiRequest } from "./api-client";
import {
  UnderwritingDetailDialog,
} from "./underwriting-detail";
import { orderUnderwritingQueue } from "./underwriting-view-model";

const statusLabels = {
  queued: "Queued",
  running: "Running",
  partial: "Partial",
  completed: "Completed",
  failed: "Failed",
} as const;

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
  const [candidateError, setCandidateError] = useState("");
  const [retryToken, setRetryToken] = useState(0);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [detail, setDetail] =
    useState<CandidateUnderwritingDetail | null>(null);
  const [loadedEvidenceContext, setLoadedEvidenceContext] = useState<{
    reportId: string;
    context: ReportEvidenceContext | undefined;
  } | null>(null);
  const [drafts, setDrafts] = useState<PublicActionDraft[]>([]);
  const [editingDraft, setEditingDraft] =
    useState<PublicActionDraft | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void apiRequest<{
      underwritingBatch?: UnderwritingBatchSummary;
      evidenceContext?: ReportEvidenceContext;
    }>(`/api/reports/${encodeURIComponent(reportId)}`)
      .then((report) => {
        if (!cancelled) {
          setBatch(report.underwritingBatch ?? null);
          setLoadedEvidenceContext({
            reportId,
            context: report.evidenceContext,
          });
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setBatchError(loadError instanceof Error
            ? loadError.message
            : "Underwriting summary could not be loaded.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, reportId, retryToken]);

  async function openCandidate(
    entry: UnderwritingBatchSummary["queue"][number],
  ) {
    setSelectedDealId(entry.dealId);
    setDetail(null);
    setDrafts([]);
    setCandidateError("");
    try {
      const [candidateDetail, actionDrafts] = await Promise.all([
        apiRequest<CandidateUnderwritingDetail>(
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
}: {
  batch: UnderwritingBatchSummary | null;
  companyNames: Record<string, string>;
  onOpenCandidate(
    entry: UnderwritingBatchSummary["queue"][number],
  ): void;
  emptyMessage?: string;
}) {
  const queue = batch
    ? orderUnderwritingQueue(batch.queue)
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
            work for calculations, Investor Framework Perspectives, Evidence
            Pack IDs, and exact public-source lineage.
          </p>
        </div>
        {batch && (
          <span className={`vsee-batch-state ${batch.status}`}>
            Underwriting Status · {statusLabels[batch.status]}
          </span>
        )}
      </header>

      {!batch ? (
        <p className="vsee-underwriting-empty" role="status">{emptyMessage}</p>
      ) : (
        <>
          <div
            className="vsee-underwriting-status-counts"
            aria-label="Underwriting Status counts"
          >
            {Object.entries(batch.underwritingStatusCounts).map(
              ([status, count]) => (
                <span key={status}>
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
                <span className="vsee-underwriting-rank">
                  Priority Order · #{entry.priorityRank}
                </span>
                <div>
                  <strong>
                    {companyNames[entry.dealId] ?? entry.dealId}
                  </strong>
                  <small>{entry.dealId}</small>
                  {entry.reason && <small>{entry.reason}</small>}
                </div>
                <span className="vsee-underwriting-status">
                  Underwriting Status · {statusLabels[entry.status]}
                </span>
                <span>{entry.decision ?? "Decision unavailable"}</span>
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
          {batch.legacyPinnedPriorityOrder && (
            <details className="vsee-details">
              <summary>Historical Priority Order · read-only pinned report</summary>
              <p>
                This compatibility view records historical ordering only. It
                does not control eligibility for new runs.
              </p>
              <ol>
                {batch.legacyPinnedPriorityOrder.entries.map((entry) => (
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
