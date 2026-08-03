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
import { orderUnderwritingSelections } from "./underwriting-view-model";

const statusLabels = {
  not_selected: "Not selected",
  queued: "Queued",
  running: "Running",
  partial: "Partial",
  completed: "Completed",
  unavailable: "Unavailable",
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
    selection: UnderwritingBatchSummary["selections"][number],
  ) {
    if (!selection.candidateRunId) return;
    setSelectedDealId(selection.dealId);
    setDetail(null);
    setDrafts([]);
    setCandidateError("");
    try {
      const [candidateDetail, actionDrafts] = await Promise.all([
        apiRequest<CandidateUnderwritingDetail>(
          `/api/reports/${encodeURIComponent(reportId)}/underwriting/${
            encodeURIComponent(selection.dealId)
          }`,
        ),
        apiRequest<PublicActionDraft[]>(
          `/api/action-drafts?candidateRunId=${
            encodeURIComponent(selection.candidateRunId)
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
            <span className="vsee-eyebrow">TOP-5 UNDERWRITING</span>
            <h2>Loading persisted candidate states…</h2>
          </header>
        </section>
      ) : (
        <UnderwritingSummaryPanel
          batch={batch}
          companyNames={companyNames}
          onOpenCandidate={(selection) => void openCandidate(selection)}
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
    selection: UnderwritingBatchSummary["selections"][number],
  ): void;
  emptyMessage?: string;
}) {
  const selections = batch
    ? orderUnderwritingSelections(batch.selections)
    : [];

  return (
    <section
      className="vsee-underwriting-summary"
      aria-labelledby="top-five-underwriting"
    >
      <header>
        <div>
          <span className="vsee-eyebrow">TOP-5 UNDERWRITING</span>
          <h2 id="top-five-underwriting">Auditable candidate states</h2>
          <p>
            Every eligible Deal retains an explicit selection and execution
            state. Open finalized candidates for calculations, independent
            named-advisory viewpoints, Evidence Pack IDs, and exact
            public-source lineage.
          </p>
        </div>
        {batch && (
          <span className={`vsee-batch-state ${batch.status}`}>
            Batch · {batch.status}
          </span>
        )}
      </header>

      {!batch ? (
        <p className="vsee-underwriting-empty" role="status">{emptyMessage}</p>
      ) : (
        <div className="vsee-underwriting-rows">
          {selections.map((selection) => {
            const openable = selection.candidateRunId !== null
              && (
                selection.underwritingStatus === "completed"
                || selection.underwritingStatus === "partial"
              );
            return (
              <article
                className={`vsee-underwriting-row ${
                  selection.underwritingStatus
                }`}
                key={selection.dealId}
              >
                <span className="vsee-underwriting-rank">
                  {selection.rank ? `#${selection.rank}` : "—"}
                </span>
                <div>
                  <strong>
                    {companyNames[selection.dealId] ?? selection.dealId}
                  </strong>
                  <small>{selection.dealId}</small>
                </div>
                <span className="vsee-underwriting-status">
                  {statusLabels[selection.underwritingStatus]}
                </span>
                <span>{selection.decision ?? "Decision unavailable"}</span>
                <button
                  onClick={() => onOpenCandidate(selection)}
                  disabled={!openable}
                  aria-label={openable
                    ? `Open underwriting for ${
                        companyNames[selection.dealId] ?? selection.dealId
                      }`
                    : `${statusLabels[selection.underwritingStatus]} underwriting is not finalized`}
                >
                  {openable ? "OPEN DETAIL →" : "NOT READY"}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
