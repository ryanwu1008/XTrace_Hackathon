"use client";

import { useEffect, useRef } from "react";

export const FIXED_DEEP_UNDERWRITE_REPORT_URL =
  "/reports/vsee-irregular-sample-underwriting-english-semantic-edition.pdf";

export function FixedDeepUnderwriteReport({
  open,
  onClose,
}: {
  open: boolean;
  onClose(): void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      className="vsee-fixed-report-dialog"
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="fixed-deep-underwrite-title"
      aria-describedby="fixed-deep-underwrite-meta"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <div className="vsee-fixed-report-card">
        <header>
          <div>
            <span className="vsee-eyebrow">FIXED DEEP UNDERWRITE DEMO</span>
            <h2 id="fixed-deep-underwrite-title">
              Portfolio Risk Reunderwriting
            </h2>
            <p id="fixed-deep-underwrite-meta">
              Irregular · English semantic edition · 18 pages · Synthetic
              financial inputs · Not investment advice
            </p>
          </div>
          <div className="vsee-fixed-report-actions">
            <a
              href={FIXED_DEEP_UNDERWRITE_REPORT_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open full report <span aria-hidden="true">↗</span>
            </a>
            <a href={FIXED_DEEP_UNDERWRITE_REPORT_URL} download>
              Download PDF
            </a>
            <button type="button" onClick={onClose} aria-label="Close fixed Deep Underwrite report">
              ×
            </button>
          </div>
        </header>
        <div className="vsee-fixed-report-viewer">
          <iframe
            src={`${FIXED_DEEP_UNDERWRITE_REPORT_URL}#view=FitH`}
            title="Irregular Portfolio Risk Reunderwriting — English semantic edition"
          />
          <p>
            If the embedded reader is unavailable, {" "}
            <a
              href={FIXED_DEEP_UNDERWRITE_REPORT_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              open the report in a new tab
            </a>.
          </p>
        </div>
      </div>
    </dialog>
  );
}
