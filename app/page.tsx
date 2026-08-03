"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ReportDraftDialog } from "./report-draft-dialog";
import { ScanProgress } from "./scan-progress";
import { FundPolicyView } from "./fund-policy";
import {
  SourceUploadFlow,
  type SourceUploadDto,
} from "./source-upload-flow";
import {
  CompanyIntelligenceReport,
  type IntelligenceReportView,
} from "./company-intelligence";
import {
  buildInternalReportDraft,
  type InternalReportDraft,
} from "../lib/reports/draft";
import { decisionReasonLabel } from "../lib/demo/decision-label";
import { SAMPLE_DEAL_PROFILES } from "./deal-profiles";
import type { ChatMemoryStatus } from "../lib/chat/service";
import type { ConfirmUpload } from "../lib/contracts/http";
import type { EvidenceSourceRef } from "../lib/contracts/domain";
import type { MarketEventV2 } from "../lib/contracts/source-evidence";
import type {
  ReportEvidenceContext,
  RunEvidenceContext,
  RunEvidenceRequestV1,
} from "../lib/contracts/evidence-context";
import type {
  UploadRecoveryDto,
  UploadRecoveryDetailDto,
} from "../lib/uploads/confirmation";
import {
  resolveReportAppOrigin,
  SAFE_UI_SESSION,
  type UiCapabilities,
  type UiSession,
} from "./ui-capabilities";
import { SourceRevisionLink } from "./source-revision-link";
import { formatTemporalForDisplay } from "../lib/format/temporal";
import { safeExternalHttpUrl } from "../lib/security/safe-url";

type UploadedDocument = SourceUploadDto;

type View =
  | "overview"
  | "deals"
  | "import"
  | "policy"
  | "market"
  | "reports"
  | "chat"
  | "settings";

type DealStatus = "screening" | "watchlist" | "evaluating" | "passed" | "invested";

interface DemoFixture {
  id: string;
  label: string;
  provenance: "demo_fixture";
  meetingSummary: string;
  decisionReason: string;
  concerns: string[];
  revisitConditions: string[];
}

interface Deal {
  id: string;
  companyName: string;
  status: DealStatus;
  documentId: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceRevisionIds?: string[];
  sourceLinks?: Array<{
    sourceRevisionId: string;
    sourceUrl: string;
  }>;
  fixture?: DemoFixture;
}

interface DocumentItem {
  id: string;
  title: string;
  filename: string;
  role: "deal_document" | "market_report" | "reference";
  companyName?: string;
  byteSize: number;
  importable: boolean;
  sourceUrl: string;
}

interface Overview {
  generatedAt: string;
  windowDays: 14;
  stats: {
    deals: number;
    marketReports: number;
    referenceDocuments: number;
    fixtureDeals: number;
    activeSourceRevisions?: number;
    uploads?: number;
  };
  deals: Deal[];
  documents: DocumentItem[];
}

interface Run {
  id: string;
  mode: "xtrace" | "structured";
  status: "queued" | "running" | "partial" | "completed" | "failed";
  currentStage: string | null;
  warningCount: number;
  warnings: string[];
  createdAt: string;
  completedAt: string | null;
  evidenceContext: RunEvidenceContext;
}

interface LegacyUiSource {
  id: string;
  title: string;
  url?: string;
  documentId?: string;
  page?: number;
  publisher?: string;
  publishedAt?: string;
  excerpt: string;
  provenance:
    | "source_document"
    | "public_web"
    | "demo_fixture"
    | "model_inference"
    | "underwriting_reference";
}

type Source = EvidenceSourceRef | LegacyUiSource;

type MarketEvent = MarketEventV2;

type Report = IntelligenceReportView;

export function isDurableWorkspaceUiMode(
  deploymentMode: UiSession["deploymentMode"],
): boolean {
  return deploymentMode !== "public_demo";
}

interface Health {
  deploymentMode: UiSession["deploymentMode"];
  canonicalAppOrigin?: string;
  capabilities: UiCapabilities;
  postgres: boolean;
  worker: boolean;
  xtrace: boolean;
  anthropic: boolean;
  storage: boolean;
  corpusReady: boolean;
  corpusConfirmedCount: number;
  corpusRequiredCount: number;
  marketProviders: number;
}

interface ImportPreviewItem {
  documentId: string;
  title: string;
  classification: "deal_document" | "market_report";
  company?: string;
  deals?: Array<{ dealId: string; companyName: string; page?: number }>;
  requiresDealConfirmation: boolean;
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  citations?: Source[];
  memoryStatus?: ChatMemoryStatus;
}

interface ChatReportScope {
  reportId: string;
  runId: string;
  dealId?: string;
}

export function buildChatApiRequest(input: {
  question: string;
  xtraceEnabled: boolean;
  scope: ChatReportScope | null;
}): { url: "/api/chat"; init: RequestInit } {
  return {
    url: "/api/chat",
    init: {
      method: "POST",
      body: JSON.stringify({
        question: input.question,
        xtraceEnabled: input.xtraceEnabled,
        ...(input.scope ?? {}),
      }),
    },
  };
}

export function evidenceContextLabel(
  context: ReportEvidenceContext | RunEvidenceContext | undefined,
): string {
  if (!context || context.state === "legacy_unbound") {
    return "LEGACY REPORT · Evidence context unavailable";
  }
  if (context.evidenceMode === "pinned") {
    return "displayLabel" in context
      ? `PINNED DEMO REPLAY · ${context.displayLabel}`
      : `PINNED DEMO REPLAY · ${context.snapshotId}`;
  }
  return `LIVE EVIDENCE · Live evidence window ending ${context.windowEndAt}`;
}

export function canRunPinnedDemo(
  deploymentMode: UiSession["deploymentMode"],
): boolean {
  return deploymentMode === "public_sandbox";
}

const nav: Array<{ view: View; label: string; icon: string }> = [
  { view: "overview", label: "Overview", icon: "⌂" },
  { view: "deals", label: "Deals", icon: "▤" },
  { view: "import", label: "Sources", icon: "↥" },
  { view: "policy", label: "Fund Policy", icon: "§" },
  { view: "market", label: "Market", icon: "◉" },
  { view: "reports", label: "Reports", icon: "◇" },
  { view: "chat", label: "Chat", icon: "⌘" },
  { view: "settings", label: "Settings", icon: "⚙" },
];

const statusLabels: Record<DealStatus, string> = {
  screening: "Screening",
  watchlist: "Watchlist",
  evaluating: "Evaluating",
  passed: "Passed",
  invested: "Invested",
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  // FormData sets its own multipart boundary; forcing JSON would corrupt it.
  const isFormData = init?.body instanceof FormData;
  const response = await fetch(url, {
    ...init,
    cache: init?.cache ?? "no-store",
    headers: isFormData
      ? (init?.headers ?? {})
      : { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? `Request failed: ${response.status}`);
  return body.data as T;
}

function formatBytes(bytes: number) {
  return bytes < 1_000_000
    ? `${Math.round(bytes / 1_000)} KB`
    : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function shortDate(value: string) {
  return formatTemporalForDisplay({
    value,
    dateOnly: { month: "short", day: "numeric" },
    timestamp: {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  });
}

async function loadCanonicalUploads(): Promise<UploadedDocument[]> {
  const uploads = await api<UploadRecoveryDto[]>("/api/uploads");
  return Promise.all(uploads.map(async (upload) => {
    if (upload.status === "awaiting_confirmation") {
      return api<UploadRecoveryDetailDto>(
        `/api/uploads/${encodeURIComponent(upload.uploadId)}`,
      );
    }
    return { ...upload, candidateDeals: [] };
  }));
}

export default function Home() {
  const [view, setView] = useState<View>("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [events, setEvents] = useState<MarketEvent[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [xtraceEnabled, setXtraceEnabled] = useState(false);
  const xtraceInitialized = useRef(false);
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [importPreview, setImportPreview] = useState<ImportPreviewItem[] | null>(null);
  const [confirmedDealAssignments, setConfirmedDealAssignments] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [focusedReportId, setFocusedReportId] = useState<string | null>(null);
  const [reportDraft, setReportDraft] = useState<InternalReportDraft | null>(null);
  const [chatQuestion, setChatQuestion] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatScope, setChatScope] = useState<ChatReportScope | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploads, setUploads] = useState<UploadedDocument[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<Run | null>(null);
  const [scanProgressOpen, setScanProgressOpen] = useState(false);
  const [resetTestViewOpen, setResetTestViewOpen] = useState(false);

  const load = useCallback(async () => {
    const [model, runRows, marketRows, reportRows, healthState, uploadRows] =
      await Promise.allSettled([
        api<Overview>("/api/overview"),
        api<Run[]>("/api/runs"),
        api<MarketEvent[]>("/api/market/events"),
        api<Report[]>("/api/reports"),
        api<Health>("/api/settings/health"),
        loadCanonicalUploads(),
      ]);
    if (model.status === "fulfilled") setOverview(model.value);
    else setError(model.reason instanceof Error ? model.reason.message : "Unable to load workspace evidence");
    if (runRows.status === "fulfilled") setRuns(runRows.value);
    if (marketRows.status === "fulfilled") setEvents(marketRows.value);
    if (reportRows.status === "fulfilled") setReports(reportRows.value);
    if (uploadRows.status === "fulfilled") setUploads(uploadRows.value);
    if (healthState.status === "fulfilled") {
      setHealth(healthState.value);
      if (!xtraceInitialized.current) {
        setXtraceEnabled(healthState.value.xtrace);
        xtraceInitialized.current = true;
      }
    } else {
      setError(
        healthState.reason instanceof Error
          ? healthState.reason.message
          : "Unable to verify server capabilities",
      );
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const searchParams = new URLSearchParams(window.location.search);
      const requestedView = searchParams.get("view");
      if (nav.some((item) => item.view === requestedView)) {
        setView(requestedView as View);
      }
      setFocusedReportId(searchParams.get("report"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (view !== "reports" || !focusedReportId || !reports.length) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`report-${focusedReportId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusedReportId, reports, view]);

  useEffect(() => {
    if (!runs.some((run) => run.status === "queued" || run.status === "running")) return;
    const timer = window.setInterval(() => void load(), 2_500);
    return () => window.clearInterval(timer);
  }, [runs, load]);

  useEffect(() => {
    if (!uploads.some((item) =>
      item.status === "queued"
      || item.status === "extracting"
      || item.status === "confirmed"
      || item.status === "ingesting_memory"
    )) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadCanonicalUploads()
        .then(setUploads)
        .catch(() => undefined);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [uploads]);

  useEffect(() => {
    if (activeRunId) return;
    const durableRun = runs.find(
      (run) => run.status === "queued" || run.status === "running",
    );
    if (!durableRun) return;
    const timer = window.setTimeout(() => {
      setActiveRunId(durableRun.id);
      setActiveRun(durableRun);
      setScanProgressOpen(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeRunId, runs]);

  useEffect(() => {
    if (!activeRunId) return;
    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const run = await api<Run>(`/api/runs/${encodeURIComponent(activeRunId)}`);
        if (cancelled) return;
        setActiveRun(run);
        setRuns((current) => [
          run,
          ...current.filter((item) => item.id !== run.id),
        ]);

        if (run.status === "completed" || run.status === "partial") {
          const reportRows = await api<Report[]>(
            `/api/reports?runId=${encodeURIComponent(run.id)}`,
          );
          if (cancelled) return;
          const report = reportRows[0];
          if (!report) {
            setError("The scan finished, but its durable report could not be loaded.");
            return;
          }
          setReports((current) => [
            report,
            ...current.filter((item) => item.id !== report.id),
          ]);
          // The scan also produced new market events and overview counts.
          void load();
          setFocusedReportId(report.id);
          setView("reports");
          setScanProgressOpen(false);
          setActiveRunId(null);
          const url = new URL(window.location.href);
          url.searchParams.set("view", "reports");
          url.searchParams.set("report", report.id);
          window.history.replaceState(
            {},
            "",
            `${url.pathname}${url.search}${url.hash}`,
          );
          const structuredImageFallbacks =
            report.evidenceCoverage.structuredImageFallbackDealCount ?? 0;
          setNotice(structuredImageFallbacks > 0
            ? `Scan partially complete. ${structuredImageFallbacks} image-only ${
              structuredImageFallbacks === 1 ? "Deal uses" : "Deals use"
            } canonical structured evidence without XTrace memory IDs.`
            : report.priorityDealId
            ? "Scan complete. The highest-priority company analysis is ready."
            : "Scan complete. No investment belief changed at medium or high confidence; the full report is ready.");
          return;
        }

        if (run.status === "failed") {
          setActiveRunId(null);
          setError("The scan could not produce a report. Review the warning details in System activity.");
          return;
        }

        timer = window.setTimeout(poll, 2_000);
      } catch (pollError) {
        if (cancelled) return;
        setError(pollError instanceof Error
          ? pollError.message
          : "Could not read durable scan progress");
        timer = window.setTimeout(poll, 4_000);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [activeRunId, load]);

  const filteredDeals = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return overview?.deals ?? [];
    return (overview?.deals ?? []).filter((deal) =>
      [
        deal.companyName,
        deal.status,
        deal.sourceTitle,
        deal.fixture?.meetingSummary,
        deal.fixture?.decisionReason,
        ...(deal.fixture?.concerns ?? []),
        ...(deal.fixture?.revisitConditions ?? []),
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalized)
    );
  }, [overview, query]);

  const latestRun = runs[0];
  const latestReport = reports[0];
  const uiSession: UiSession = health
    ? {
        deploymentMode: health.deploymentMode,
        capabilities: health.capabilities,
      }
    : SAFE_UI_SESSION;
  const scanReady = Boolean(
    uiSession.capabilities.runScans &&
    health?.postgres &&
    health.worker &&
    health.anthropic &&
    health.corpusReady &&
    (!xtraceEnabled || health.xtrace),
  );

  function navigate(nextView: View) {
    if (nextView === "chat") setChatScope(null);
    setView(nextView);
    setFocusedReportId(null);
    const url = new URL(window.location.href);
    if (nextView === "overview") url.searchParams.delete("view");
    else url.searchParams.set("view", nextView);
    url.searchParams.delete("report");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  async function runScan(evidenceRequest: RunEvidenceRequestV1 = {
    schemaVersion: "run-evidence-request-v1",
    evidenceMode: "live",
  }) {
    if (!uiSession.capabilities.runScans) {
      setError(
        "Market scans are disabled in this read-only public demo.",
      );
      return;
    }
    if (!scanReady) {
      setError("Confirm the complete 13-source corpus first. The scan also needs PostgreSQL, an active worker, Anthropic, and—when enabled—XTrace.");
      setView("settings");
      return;
    }
    setBusy("scan");
    setError("");
    try {
      const run = await api<Run>("/api/runs", {
        method: "POST",
        body: JSON.stringify({ xtraceEnabled, evidenceRequest }),
      });
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setActiveRunId(run.id);
      setActiveRun(run);
      setScanProgressOpen(true);
      setNotice(`14-day scan ${run.status}. Progress is durable while the worker runs.`);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Could not start scan");
    } finally {
      setBusy(null);
    }
  }

  async function resetTestView() {
    if (!uiSession.capabilities.resetDemo) {
      setError("The server did not grant test-view reset.");
      return;
    }
    setBusy("reset");
    setError("");
    try {
      await api<{ reset: true; resetAt: string }>("/api/demo/reset", {
        method: "POST",
      });
      setFocusedReportId(null);
      setActiveRunId(null);
      setActiveRun(null);
      setScanProgressOpen(false);
      setReportDraft(null);
      setError("");
      window.history.replaceState({}, "", window.location.pathname);
      await load();
      setNotice("Current test view reset. Durable evidence and analysis history were preserved.");
      setResetTestViewOpen(false);
    } catch (resetError) {
      setError(
        resetError instanceof Error
          ? resetError.message
          : "Could not reset the current test view.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function uploadDocument(file: File) {
    setBusy("upload");
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const created = await api<{
        uploadId: string;
        status: UploadedDocument["status"];
      }>("/api/uploads", {
        method: "POST",
        headers: {},
        body,
      });
      const record = await api<UploadRecoveryDetailDto>(
        `/api/uploads/${encodeURIComponent(created.uploadId)}`,
      );
      setUploads((current) => [
        record,
        ...current.filter((item) => item.uploadId !== record.uploadId),
      ]);
      setNotice(
        `${record.filename} uploaded. We will show an extraction preview before any Deal or memory action.`,
      );
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload the document");
    } finally {
      setBusy(null);
    }
  }

  async function confirmUploadedSource(
    uploadId: string,
    choice: ConfirmUpload,
  ) {
    if (!uiSession.capabilities.confirmUploads) {
      setError("The server did not grant source confirmation.");
      return;
    }
    setBusy(`confirm:${uploadId}`);
    setError("");
    try {
      const confirmed = await api<{
        uploadId: string;
        dealId: string;
        sourceRevisionId: string;
        status: "confirmed";
      }>(`/api/uploads/${encodeURIComponent(uploadId)}/confirm`, {
        method: "POST",
        body: JSON.stringify(choice),
      });
      setUploads(await loadCanonicalUploads());
      setNotice(
        `Confirmed ${confirmed.uploadId}. Deal ${confirmed.dealId} and Source Revision ${confirmed.sourceRevisionId} are durable.`,
      );
      await load();
    } catch (confirmError) {
      setError(
        confirmError instanceof Error
          ? confirmError.message
          : "Could not confirm the upload.",
      );
    } finally {
      setBusy(null);
    }
  }

  function selectDocuments(documentIds: string[]) {
    setSelectedDocuments(documentIds);
    setImportPreview(null);
    setConfirmedDealAssignments([]);
  }

  async function previewSources() {
    if (!selectedDocuments.length) return;
    setBusy("preview");
    setError("");
    try {
      const preview = await api<ImportPreviewItem[]>("/api/imports/preview", {
        method: "POST",
        body: JSON.stringify({ documentIds: selectedDocuments }),
      });
      setImportPreview(preview);
      setConfirmedDealAssignments([]);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Could not preview source assignments");
    } finally {
      setBusy(null);
    }
  }

  async function confirmSources() {
    if (!selectedDocuments.length || !importPreview) return;
    const dealConfirmations = importPreview.flatMap((item) => {
      if (!item.requiresDealConfirmation) return [];
      const previewDeals = item.deals?.length
        ? item.deals
        : (overview?.deals ?? [])
            .filter((deal) => deal.documentId === item.documentId)
            .map((deal) => ({ dealId: deal.id, companyName: deal.companyName }));
      return previewDeals.map((deal) => ({
        documentId: item.documentId,
        dealId: deal.dealId,
      }));
    });
    if (!dealConfirmations.every(({ documentId, dealId }) =>
      confirmedDealAssignments.includes(`${documentId}:${dealId}`)
    )) {
      setError("Confirm every company and Deal assignment before ingestion.");
      return;
    }
    setBusy("import");
    setError("");
    try {
      const result = await api<{
        memoryBundles: unknown[];
        xtraceConfigured: boolean;
        xtraceJobs: unknown[];
        xtraceErrors: string[];
      }>("/api/imports/confirm", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: "workspace_demo",
          documentIds: selectedDocuments,
          dealConfirmations,
        }),
      });
      setNotice(result.xtraceConfigured
        ? `${selectedDocuments.length} sources confirmed; exact-parent XTrace ingestion is prepared for the explicit worker command.`
        : `${selectedDocuments.length} sources confirmed. XTrace ingestion was skipped because the integration is not configured; structured mode remains available.`);
      await load();
      setImportPreview(null);
      setConfirmedDealAssignments([]);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Could not confirm sources");
    } finally {
      setBusy(null);
    }
  }

  function draftReport(report: Report) {
    if (!overview) return;
    setReportDraft(buildInternalReportDraft({
      report,
      companyNames: Object.fromEntries(
        overview.deals.map((deal) => [deal.id, deal.companyName]),
      ),
      appOrigin: resolveReportAppOrigin({
        deploymentMode: uiSession.deploymentMode,
        canonicalAppOrigin: health?.canonicalAppOrigin,
        browserOrigin: window.location.origin,
      }),
    }));
  }

  async function askChat(event: FormEvent) {
    event.preventDefault();
    const question = chatQuestion.trim();
    if (!question) return;
    setChatMessages((current) => [...current, { role: "user", text: question }]);
    setChatQuestion("");
    setBusy("chat");
    setError("");
    try {
      const chatRequest = buildChatApiRequest({
        question,
        xtraceEnabled,
        scope: chatScope,
      });
      const answer = await api<{
        answer: string;
        citations: Source[];
        memoryStatus: ChatMemoryStatus;
        insufficientEvidence: boolean;
      }>(chatRequest.url, chatRequest.init);
      setChatMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: answer.answer,
          citations: answer.citations,
          memoryStatus: answer.memoryStatus,
        },
      ]);
    } catch (chatError) {
      setError(chatError instanceof Error ? chatError.message : "Chat unavailable");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="vsee-shell">
      <aside className="vsee-rail">
        <button className="vsee-brand" onClick={() => navigate("overview")} aria-label="VSee overview">
          <span>VS</span>
          <b>VSee</b>
        </button>
        <nav>
          {nav.map((item) => (
            <button
              key={item.view}
              className={view === item.view ? "active" : ""}
              onClick={() => navigate(item.view)}
              title={item.label}
              aria-label={`Open ${item.label}`}
              aria-current={view === item.view ? "page" : undefined}
            >
              <i>{item.icon}</i>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="vsee-rail-status">
          <span className={health?.xtrace ? "healthy" : ""} />
          <small>{health?.xtrace ? "XTRACE READY" : "XTRACE UNAVAILABLE"}</small>
        </div>
      </aside>

      <section className="vsee-main">
        <header className="vsee-topbar">
          <div>
            <span className="vsee-eyebrow">VC DECISION INTELLIGENCE</span>
            <strong>{nav.find((item) => item.view === view)?.label}</strong>
          </div>
          <div className="vsee-top-actions">
            {uiSession.capabilities.resetDemo ? (
              <button
                className="vsee-memory-toggle"
                onClick={() => {
                  setError("");
                  setResetTestViewOpen(true);
                }}
                disabled={busy !== null}
                aria-label="Reset current test view"
              >
                RESET TEST VIEW
              </button>
            ) : (
              <button
                className="vsee-memory-toggle"
                disabled
                aria-label="Reset is disabled"
                title="Durable analysis products are never deleted from this UI."
              >
                RESET DISABLED
              </button>
            )}
            <button
              className={`vsee-memory-toggle ${xtraceEnabled ? "on" : ""}`}
              onClick={() => setXtraceEnabled((enabled) => !enabled)}
              disabled={!health?.xtrace}
              role="switch"
              aria-checked={xtraceEnabled}
              aria-label={health?.xtrace ? "Use XTrace memory for scans and chat" : "XTrace is not configured"}
            >
              <span />
              XTrace {xtraceEnabled ? "ON" : "OFF"}
            </button>
            <button
              className="vsee-run"
              onClick={() => void runScan()}
              disabled={busy === "scan" || !scanReady}
              aria-label={scanReady
                ? "Run a 14-day market scan"
                : uiSession.deploymentMode === "public_demo"
                ? "Scan disabled in the read-only public demo"
                : "Scan unavailable until required integrations are ready"}
              title={scanReady
                ? undefined
                : uiSession.deploymentMode === "public_demo"
                ? "Public demo is read-only."
                : "PostgreSQL, worker, Anthropic, and the selected memory mode must be ready"}
            >
              {busy === "scan" ? "QUEUING…" : "WAKE AGENT & SCAN MARKET"} <span>→</span>
            </button>
            {canRunPinnedDemo(uiSession.deploymentMode) && (
              <button
                className="vsee-run"
                onClick={() => void runScan({
                  schemaVersion: "run-evidence-request-v1",
                  evidenceMode: "pinned",
                  snapshotId: "belief_reversal_2026_08_01",
                })}
                disabled={busy === "scan" || !scanReady}
              >
                RUN PINNED DEMO REPLAY <span>→</span>
              </button>
            )}
          </div>
        </header>

        {error && <div className="vsee-banner error" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
        {notice && <div className="vsee-banner" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notice">×</button></div>}
        {uiSession.deploymentMode === "public_sandbox" && (
          <div className="vsee-sandbox-warning" role="status">
            PUBLIC TEST SANDBOX — Do not upload confidential or real customer data.
          </div>
        )}

        {!overview || !health ? (
          <section className="vsee-loading">Loading workspace evidence…</section>
        ) : (
          <>
            {view === "overview" && (
              <OverviewView
                overview={overview}
                latestRun={latestRun}
                latestReport={latestReport}
                events={events}
                onNavigate={navigate}
                onRun={runScan}
                scanReady={scanReady}
                xtraceEnabled={xtraceEnabled}
                deploymentMode={uiSession.deploymentMode}
              />
            )}
            {view === "deals" && (
              <DealsView
                deals={filteredDeals}
                uploads={uploads}
                query={query}
                onQuery={setQuery}
                deploymentMode={uiSession.deploymentMode}
              />
            )}
            {view === "import" && (
              <SourcesView
                uploads={uploads}
                onUpload={uploadDocument}
                uploading={busy === "upload"}
                documents={overview.documents}
                selected={selectedDocuments}
                preview={importPreview}
                confirmedDealAssignments={confirmedDealAssignments}
                deals={overview.deals}
                onSelected={selectDocuments}
                onPreview={previewSources}
                onConfirm={confirmSources}
                onConfirmedDealAssignments={setConfirmedDealAssignments}
                busy={busy === "import" || busy === "preview"}
                deploymentMode={uiSession.deploymentMode}
                capabilities={uiSession.capabilities}
                confirmingUploadId={busy?.startsWith("confirm:")
                  ? busy.slice("confirm:".length)
                  : null}
                onConfirmUpload={confirmUploadedSource}
              />
            )}
            {view === "policy" && (
              <FundPolicyView
                canManage={uiSession.capabilities.manageFundPolicy}
              />
            )}
            {view === "market" && <MarketView events={events} />}
            {view === "reports" && (
              <ReportsView
                reports={reports}
                deals={overview.deals}
                onDraft={draftReport}
                focusedReportId={focusedReportId}
                deploymentMode={uiSession.deploymentMode}
                canSaveActionDrafts={
                  uiSession.capabilities.saveActionDrafts
                }
                onAsk={(report) => {
                  if (!report.runId) return;
                  setChatScope({ reportId: report.id, runId: report.runId });
                  setView("chat");
                }}
              />
            )}
            {view === "chat" && (
              <ChatView
                messages={chatMessages}
                question={chatQuestion}
                onQuestion={setChatQuestion}
                onSubmit={askChat}
                busy={busy === "chat"}
                xtraceEnabled={xtraceEnabled}
                deploymentMode={uiSession.deploymentMode}
                reportScope={chatScope}
              />
            )}
            {view === "settings" && <SettingsView health={health} runs={runs} />}
          </>
        )}
      </section>
      <ReportDraftDialog
        draft={reportDraft}
        onClose={() => setReportDraft(null)}
      />
      <ResetTestViewDialog
        open={resetTestViewOpen}
        busy={busy !== null}
        error={error}
        onCancel={() => setResetTestViewOpen(false)}
        onReset={() => void resetTestView()}
      />
      {scanProgressOpen && activeRun && (
        <ScanProgress
          run={activeRun}
          onClose={() => setScanProgressOpen(false)}
        />
      )}
    </main>
  );
}

function ResetTestViewDialog({
  open,
  busy,
  error,
  onCancel,
  onReset,
}: {
  open: boolean;
  busy: boolean;
  error: string;
  onCancel(): void;
  onReset(): void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="vsee-reset-test-view-dialog"
      aria-labelledby="reset-test-view-title"
      aria-describedby="reset-test-view-copy"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      onClose={() => {
        if (!busy) onCancel();
      }}
    >
      <div className="vsee-reset-test-view-card">
        <header>
          <div>
            <span className="vsee-eyebrow">PUBLIC TEST SANDBOX</span>
            <h2 id="reset-test-view-title">Reset current test view?</h2>
          </div>
        </header>
        <div className="vsee-reset-test-view-copy">
          <p id="reset-test-view-copy">
            This only starts a fresh current test view. It does not delete Deals, Sources, XTrace memory, Fund Policy, underwriting artifacts, or action drafts.
          </p>
          <p>Active scans must finish before the current test view can be reset.</p>
          {error && <p className="vsee-reset-test-view-error" role="alert">{error}</p>}
        </div>
        <footer>
          <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="primary" onClick={onReset} disabled={busy}>
            {busy ? "RESETTING…" : "RESET CURRENT VIEW"}
          </button>
        </footer>
      </div>
    </dialog>
  );
}

function OverviewView({
  overview,
  latestRun,
  latestReport,
  events,
  onNavigate,
  onRun,
  scanReady,
  xtraceEnabled,
  deploymentMode,
}: {
  overview: Overview;
  latestRun?: Run;
  latestReport?: Report;
  events: MarketEvent[];
  onNavigate(view: View): void;
  onRun(): void;
  scanReady: boolean;
  xtraceEnabled: boolean;
  deploymentMode: UiSession["deploymentMode"];
}) {
  const companyByDeal = new Map(
    overview.deals.map((deal) => [deal.id, deal.companyName]),
  );
  return (
    <div className="vsee-content">
      <section className="vsee-hero">
        <div>
          <p className="vsee-eyebrow">SECOND LOOK ENGINE</p>
          <h1>The market changed.<br /><em>Your old Deal memory should know.</em></h1>
          <p>
            {isDurableWorkspaceUiMode(deploymentMode)
              ? "VSee uses persisted Deal Registry sources, finalized report artifacts, and exact Source Revision lineage to surface source-grounded reasons to look again."
              : `VSee scans the last 14 days of public evidence, recalls historical Deals ${
                  xtraceEnabled
                    ? "through XTrace"
                    : "from confirmed structured memory"
                }, and surfaces only medium- or high-confidence reasons to look again.`}
          </p>
        </div>
        <div className="vsee-hero-card">
          <span>
            {isDurableWorkspaceUiMode(deploymentMode)
              ? "PERSISTED DEAL REGISTRY"
              : "FIXED MVP CORPUS"}
          </span>
          <strong>{overview.stats.deals}</strong>
          <p>historical Deals</p>
          <div>
            <b>{overview.stats.marketReports}</b> reports{" "}
            <b>
              {isDurableWorkspaceUiMode(deploymentMode)
                ? overview.stats.activeSourceRevisions ?? 0
                : overview.stats.fixtureDeals}
            </b>{" "}
            {isDurableWorkspaceUiMode(deploymentMode)
              ? "active Source Revisions"
              : "labeled VC decisions"}
          </div>
        </div>
      </section>

      <section className="vsee-stat-grid">
        <Metric
          label="Historical Deals"
          value={String(overview.stats.deals)}
          note={isDurableWorkspaceUiMode(deploymentMode)
            ? "Persisted Deal Registry"
            : "From 9 supplied pitch deck files"}
        />
        <Metric label="Market window" value="14 days" note="Manual, repeatable scan" />
        <Metric label="Latest signals" value={String(events.length)} note="Evidence-linked only" />
        <Metric
          label="Latest run"
          value={latestRun?.status.toUpperCase() ?? "NOT RUN"}
          note={latestRun?.currentStage ?? "Ready when you are"}
        />
      </section>

      <section className="vsee-section-grid">
        <article className="vsee-panel vsee-workflow">
          <header>
            <span>LIVE WORKFLOW</span>
            <button onClick={onRun} disabled={!scanReady}>
              {scanReady
                ? "START SCAN →"
                : deploymentMode === "public_demo"
                ? "READ-ONLY DEMO"
                : "SCAN NOT READY"}
            </button>
          </header>
          {[
            ["01", "Observe", "Collect and deduplicate public events published in the latest 14 days."],
            ["02", "Recall", xtraceEnabled
              ? "Use XTrace to recover source-backed facts and labeled internal decision context."
              : "Use the confirmed structured Deal context; XTrace is not active for this run."],
            ["03", "Match", "Claude connects changed conditions to the Deals that may be affected."],
            ["04", "Act", "Analyze every eligible company, rank supported belief revisions, and preserve the full report."],
          ].map(([number, title, copy]) => (
            <div className="vsee-workflow-row" key={number}>
              <b>{number}</b><strong>{title}</strong><p>{copy}</p>
            </div>
          ))}
        </article>
        <article className="vsee-panel vsee-latest">
          <header><span>LATEST INTELLIGENCE</span><button onClick={() => onNavigate("reports")}>VIEW REPORTS</button></header>
          {latestReport ? (
            <>
              <h2>{latestReport.opportunities.length} Deals deserve another look</h2>
              <p>{latestReport.marketSummary}</p>
              {latestReport.opportunities.slice(0, 3).map((item) => (
                <div className="vsee-mini-result" key={`${latestReport.id}-${item.dealId}`}>
                  <span>#{item.rank}</span>
                  <div><strong>{companyByDeal.get(item.dealId) ?? item.dealId}</strong><small>{item.confidence} confidence · {Math.round(item.score * 100)}%</small></div>
                </div>
              ))}
            </>
          ) : (
            <div className="vsee-empty">
              <span>◇</span>
              <h2>No report yet</h2>
              <p>Run the scan to connect current market evidence with historical Deal context.</p>
            </div>
          )}
        </article>
      </section>
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <article className="vsee-metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function UploadedDealCards({ uploads }: { uploads: UploadedDocument[] }) {
  const ready = uploads.filter((upload) => upload.status === "awaiting_confirmation");
  const pending = uploads.filter((upload) =>
    upload.status === "queued" || upload.status === "extracting"
  );
  if (!ready.length && !pending.length) return null;
  return (
    <section className="vsee-uploaded-deals" aria-label="Upload extraction previews">
      <span className="vsee-eyebrow">EXTRACTION PREVIEWS</span>
      {pending.map((upload) => (
        <article className="vsee-uploaded-deal pending" key={upload.uploadId}>
          <div>
            <strong>{upload.filename}</strong>
            <small>{uploadStatusCopy[upload.status]}…</small>
          </div>
        </article>
      ))}
      {ready.map((upload) => (
        <article className="vsee-uploaded-deal" key={upload.uploadId}>
          <header>
            <div>
              <strong>{upload.preview?.candidateCompanyName ?? upload.filename}</strong>
              <small>{upload.filename}</small>
            </div>
            <span className="vsee-status screening">awaiting confirmation</span>
          </header>
          <p className="vsee-uploaded-headline">{upload.preview?.candidateHeadline}</p>
          {(upload.preview?.facts.length ?? 0) > 0 && (
            <dl className="vsee-context-grid">
              {upload.preview?.facts.map((fact, index) => (
                <div key={`${upload.uploadId}-${index}`}>
                  <dt>{fact.text}</dt>
                  <dd>{fact.excerpt ? `“${fact.excerpt}”` : "Located in uploaded image"}</dd>
                </div>
              ))}
            </dl>
          )}
        </article>
      ))}
    </section>
  );
}

export function DealsView({
  deals,
  uploads,
  query,
  onQuery,
  deploymentMode,
}: {
  deals: Deal[];
  uploads: UploadedDocument[];
  query: string;
  onQuery(value: string): void;
  deploymentMode: UiSession["deploymentMode"];
}) {
  return (
    <div className="vsee-content">
      <SectionTitle
        eyebrow="HISTORICAL MEMORY"
        title="Every Deal you have already met."
        copy={isDurableWorkspaceUiMode(deploymentMode)
          ? "Company identity, status, and exact source links come from the persisted Deal Registry."
          : "Company facts come from the supplied pitch decks. Investment state and prior decision context are synthetic demo fixtures only when explicitly labeled."}
      />
      {deploymentMode === "public_demo" && (
        <UploadedDealCards uploads={uploads} />
      )}
      <input
        className="vsee-search"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        placeholder="Search company, status, or remembered context…"
        aria-label="Search historical Deals"
      />
      {!deals.length ? (
        <Empty
          title="No Deals match this search"
          copy={query ? `No company, status, or remembered context matches “${query}”.` : "No historical Deals are available."}
        />
      ) : (
        <div className="vsee-deal-list">
          {deals.map((deal) => {
            const profile = deploymentMode === "public_demo"
              ? SAMPLE_DEAL_PROFILES[deal.id]
              : undefined;
            const sourceLinks = isDurableWorkspaceUiMode(deploymentMode)
              ? deal.sourceLinks ?? []
              : [];
            return (
          <article className="vsee-deal" key={deal.id}>
            <div className="vsee-monogram">{deal.companyName.slice(0, 2).toUpperCase()}</div>
            <div className="vsee-deal-name">
              <strong>{deal.companyName}</strong>
              {deploymentMode === "public_demo" && deal.sourceUrl ? (
                <a
                  href={deal.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {deal.sourceTitle} ↗
                </a>
              ) : sourceLinks.length ? sourceLinks.map((source) => (
                <SourceRevisionLink
                  revisionId={source.sourceRevisionId}
                  key={source.sourceRevisionId}
                >
                  {source.sourceRevisionId} ↗
                </SourceRevisionLink>
              )) : <span>No confirmed Source Revision</span>}
            </div>
            <span className={`vsee-status ${deal.status}`}>{statusLabels[deal.status]}</span>
            <div className="vsee-context">
              {deploymentMode === "public_demo" && deal.fixture ? (
                <>
                  <b>{deal.fixture.label}</b>
                  <dl className="vsee-context-grid">
                    <div>
                      <dt>{decisionReasonLabel(deal.status)}</dt>
                      <dd>{deal.fixture.decisionReason}</dd>
                    </div>
                    <div>
                      <dt>Partner concern</dt>
                      <dd>{deal.fixture.concerns.join(" · ")}</dd>
                    </div>
                    <div>
                      <dt>Revisit condition</dt>
                      <dd>{deal.fixture.revisitConditions.join(" · ")}</dd>
                    </div>
                    <div>
                      <dt>Previous meeting summary</dt>
                      <dd>{deal.fixture.meetingSummary}</dd>
                    </div>
                  </dl>
                </>
              ) : (
                <>
                  <b>SOURCE LINEAGE</b>
                  <span>
                    {isDurableWorkspaceUiMode(deploymentMode)
                      ? `${deal.sourceRevisionIds?.length ?? sourceLinks.length} confirmed Source Revision(s).`
                      : "No synthetic decision record attached."}
                  </span>
                </>
              )}
              {profile && (
                <>
                  <b>{profile.label}</b>
                  <dl className="vsee-context-grid">
                    {profile.traction.map((row) => (
                      <div key={row.metric}>
                        <dt>{row.metric}</dt>
                        <dd>{row.value}</dd>
                      </div>
                    ))}
                    {profile.dealTerms.map((row) => (
                      <div key={row.term}>
                        <dt>{row.term}</dt>
                        <dd>{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}
            </div>
          </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

const uploadStatusCopy: Record<UploadedDocument["status"], string> = {
  queued: "Queued for extraction",
  extracting: "Extracting preview",
  awaiting_confirmation: "Awaiting your confirmation",
  confirmed: "Confirmed for intake",
  ingesting_memory: "Ingesting confirmed source",
  ready: "Ready",
  failed: "Extraction failed",
};

function SourcesView({
  documents,
  selected,
  preview,
  confirmedDealAssignments,
  deals,
  uploads,
  onUpload,
  uploading,
  onSelected,
  onPreview,
  onConfirm,
  onConfirmedDealAssignments,
  busy,
  deploymentMode,
  capabilities,
  confirmingUploadId,
  onConfirmUpload,
}: {
  documents: DocumentItem[];
  selected: string[];
  preview: ImportPreviewItem[] | null;
  confirmedDealAssignments: string[];
  deals: Deal[];
  uploads: UploadedDocument[];
  onUpload(file: File): void;
  uploading: boolean;
  onSelected(ids: string[]): void;
  onPreview(): void;
  onConfirm(): void;
  onConfirmedDealAssignments(ids: string[]): void;
  busy: boolean;
  deploymentMode: UiSession["deploymentMode"];
  capabilities: UiCapabilities;
  confirmingUploadId: string | null;
  onConfirmUpload(uploadId: string, choice: ConfirmUpload): void;
}) {
  const assignments = (preview ?? []).flatMap((item) => {
    if (!item.requiresDealConfirmation) return [];
    const previewDeals = item.deals?.length
      ? item.deals
      : deals
          .filter((deal) => deal.documentId === item.documentId)
          .map((deal) => ({ dealId: deal.id, companyName: deal.companyName, page: undefined }));
    return previewDeals.map((deal) => ({
      ...deal,
      documentId: item.documentId,
      documentTitle: item.title,
      key: `${item.documentId}:${deal.dealId}`,
    }));
  });
  const assignmentsResolved = (preview ?? [])
    .filter((item) => item.requiresDealConfirmation)
    .every((item) => (item.deals?.length ?? deals.filter((deal) => deal.documentId === item.documentId).length) > 0);
  const ownershipConfirmed = assignmentsResolved && assignments.every((assignment) =>
    confirmedDealAssignments.includes(assignment.key)
  );
  const importableIds = documents.filter((item) => item.importable).map((item) => item.id);
  const completeCorpusSelected = selected.length === importableIds.length &&
    importableIds.every((documentId) => selected.includes(documentId));

  function toggle(documentId: string) {
    onSelected(selected.includes(documentId)
      ? selected.filter((id) => id !== documentId)
      : [...selected, documentId]);
  }
  return (
    <div className="vsee-content">
      <SectionTitle
        eyebrow={isDurableWorkspaceUiMode(deploymentMode)
          ? "DURABLE SOURCE REGISTRY"
          : "PRELOADED SOURCES"}
        title={isDurableWorkspaceUiMode(deploymentMode)
          ? "Review and confirm source identity."
          : "Inspect the evidence corpus."}
        copy={isDurableWorkspaceUiMode(deploymentMode)
          ? "Uploaded sources remain staged until company identity and Deal ownership are explicitly confirmed."
          : "The public demo exposes its supplied source list for inspection, while all source mutations remain disabled."}
      />

      <SourceUploadFlow
        uploads={uploads}
        canUpload={capabilities.uploadSources}
        canConfirm={capabilities.confirmUploads}
        uploading={uploading}
        confirmingUploadId={confirmingUploadId}
        onUpload={onUpload}
        onConfirm={onConfirmUpload}
      />
      {documents.length > 0 && (
        <div className="vsee-source-actions">
          <span>
            {selected.length} selected ·{" "}
            {isDurableWorkspaceUiMode(deploymentMode)
              ? "durable source corpus"
              : "read-only demo corpus"}
          </span>
          <button
            onClick={() => onSelected(importableIds)}
            disabled={!capabilities.confirmUploads}
          >
            SELECT 13 PRODUCT INPUTS
          </button>
          {!preview && (
            <button
              className="primary"
              onClick={onPreview}
              disabled={
                !capabilities.confirmUploads
                || !completeCorpusSelected
                || busy
              }
            >
              {busy ? "PREPARING…" : "REVIEW ASSIGNMENTS →"}
            </button>
          )}
        </div>
      )}
      {preview && (
        <section className="vsee-import-review" aria-labelledby="import-review-title">
          <header>
            <div>
              <span>STEP 2 OF 2</span>
              <h2 id="import-review-title">Confirm company &amp; Deal ownership</h2>
              <p>Verify every pitch deck assignment before the App creates memory or submits it to XTrace.</p>
            </div>
            <button onClick={() => onSelected([...selected])} disabled={busy}>EDIT SELECTION</button>
          </header>
          <div className="vsee-import-assignments">
            {assignments.map((assignment) => {
              const checked = confirmedDealAssignments.includes(assignment.key);
              return (
                <label key={assignment.key}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!capabilities.confirmUploads}
                    onChange={() => onConfirmedDealAssignments(checked
                      ? confirmedDealAssignments.filter((key) => key !== assignment.key)
                      : [...confirmedDealAssignments, assignment.key])}
                    aria-label={`Confirm ${assignment.companyName} belongs to ${assignment.dealId}`}
                  />
                  <strong>{assignment.companyName}</strong>
                  <small>
                    {assignment.documentTitle}{assignment.page ? ` · p.${assignment.page}` : ""} → {assignment.dealId}
                  </small>
                </label>
              );
            })}
            {preview.filter((item) => !item.requiresDealConfirmation).map((item) => (
              <div className="vsee-import-market" key={item.documentId}>
                <span aria-hidden="true">✓</span>
                <strong>{item.title}</strong>
                <small>Market report · no Deal assignment required</small>
              </div>
            ))}
          </div>
          {!assignmentsResolved && (
            <p className="vsee-import-warning" role="alert">
              At least one pitch deck has no Deal assignment. Return to the source data before ingestion.
            </p>
          )}
          <footer>
            <span>{confirmedDealAssignments.length} of {assignments.length} Deal assignments confirmed</span>
            <button className="primary" onClick={onConfirm} disabled={!ownershipConfirmed || busy}>
              {busy ? "INGESTING…" : "CONFIRM & INGEST"}
            </button>
          </footer>
        </section>
      )}
      <div className="vsee-doc-grid">
        {documents.map((document) => (
          <article className={`vsee-doc ${!document.importable ? "reference" : ""}`} key={document.id}>
            <label>
              <input
                type="checkbox"
                checked={selected.includes(document.id)}
                disabled={
                  !document.importable || !capabilities.confirmUploads
                }
                onChange={() => toggle(document.id)}
                aria-label={`${selected.includes(document.id) ? "Deselect" : "Select"} ${document.title}`}
              />
              <span>{document.role.replace("_", " ")}</span>
            </label>
            <strong>{document.title}</strong>
            <small>{formatBytes(document.byteSize)} · PDF</small>
            <a href={document.sourceUrl} target="_blank" rel="noreferrer">OPEN SOURCE ↗</a>
          </article>
        ))}
      </div>
    </div>
  );
}

function MarketView({ events }: { events: MarketEvent[] }) {
  return (
    <div className="vsee-content">
      <SectionTitle eyebrow="LIVE MARKET ONLY · PUBLIC EVIDENCE" title="What changed in the last 14 days?" copy="Pinned demo snapshots never appear here. Each live event is deduplicated, dated, confidence-rated, and linked to its public evidence." />
      {!events.length ? <Empty title="No scan results yet" copy="Run the 14-day scan. The app will still write a market summary even if no event meets the opportunity threshold." /> : (
        <div className="vsee-event-list">
          {events.map((event) => (
            <article className="vsee-event" key={event.id}>
              <header><span>{event.eventType}</span><b className={event.confidence}>{event.confidence} confidence</b><time>{event.publishedAt ? shortDate(event.publishedAt) : "Date unknown"}</time></header>
              <h2>{event.title}</h2>
              <p>{event.summary}</p>
              <div className="vsee-tags">{[...event.sectors, ...event.themes].map((tag) => <span key={tag}>{tag}</span>)}</div>
              <footer>{event.sources.map((source) => <SourceLink source={source} key={source.id} />)}</footer>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReportsView({
  reports,
  deals,
  onDraft,
  focusedReportId,
  deploymentMode,
  canSaveActionDrafts,
  onAsk,
}: {
  reports: Report[];
  deals: Deal[];
  onDraft(report: Report): void;
  focusedReportId: string | null;
  deploymentMode: UiSession["deploymentMode"];
  canSaveActionDrafts: boolean;
  onAsk?(report: Report): void;
}) {
  const companyByDeal = new Map(deals.map((deal) => [deal.id, deal.companyName]));
  // Default to the newest report; a shared permalink (?report=<id>) still
  // opens the exact report it referenced.
  const report = reports.find((item) => item.id === focusedReportId) ?? reports[0];
  return (
    <div className="vsee-content">
      <SectionTitle eyebrow="DECISION BRIEF" title="Cited reasons for a second look." copy="This page always shows the most recent intelligence report. Only medium- and high-confidence matches enter the Top 5. A recommendation is never proof that a company has improved; it is a reason for the investor to follow up." />
      {!report ? (
        <Empty title="No intelligence report yet" copy="Complete a scan to generate the first evidence-linked report." />
      ) : report.companyAnalyses.length ? (
        <>
          <div className="vsee-banner" role="status">
            <strong>{evidenceContextLabel(report.evidenceContext)}</strong>
            {report.evidenceContext?.state === "current"
              && report.evidenceContext.evidenceMode === "pinned"
              && <span> · Historical evidence snapshot—not current news.</span>}
            {report.runId && onAsk && (
              <button onClick={() => onAsk(report)}>ASK THIS REPORT</button>
            )}
          </div>
          <CompanyIntelligenceReport
            report={report}
            focused={focusedReportId === report.id}
            allowDraft
            onDraft={onDraft}
            showDemoProfiles={deploymentMode === "public_demo"}
            underwritingEnabled={isDurableWorkspaceUiMode(deploymentMode)}
            canSaveActionDrafts={canSaveActionDrafts}
            companyNames={Object.fromEntries(
              deals.map((deal) => [deal.id, deal.companyName]),
            )}
            key={report.id}
          />
        </>
      ) : (
        <article
          className={`vsee-report ${focusedReportId === report.id ? "focused" : ""}`}
          id={`report-${report.id}`}
          tabIndex={-1}
          key={report.id}
        >
          <header>
            <div><span>{evidenceContextLabel(report.evidenceContext)} · {shortDate(report.createdAt)}</span><p>{report.marketSummary}</p></div>
            <button onClick={() => onDraft(report)}>DRAFT THIS REPORT →</button>
          </header>
          {report.opportunities.length ? report.opportunities.map((item) => (
            <section className="vsee-opportunity" key={`${report.id}-${item.dealId}`}>
              <div className="vsee-rank">#{item.rank}</div>
              <div>
                <h2>{companyByDeal.get(item.dealId) ?? item.dealId}</h2>
                <span className={`vsee-confidence ${item.confidence}`}>{item.confidence} · {Math.round(item.score * 100)}%</span>
                <h3>Why now</h3><p>{item.whyNow}</p>
                <h3>Previous context</h3><p>{item.previousContext}</p>
                {item.implications.positive.length > 0 && (
                  <><h3>Potential positive effects</h3><ul className="vsee-implications">{item.implications.positive.map((effect) => <li key={effect}>{effect}</li>)}</ul></>
                )}
                {item.implications.negative.length > 0 && (
                  <><h3>Potential negative effects</h3><ul className="vsee-implications">{item.implications.negative.map((effect) => <li key={effect}>{effect}</li>)}</ul></>
                )}
                <h3>Suggested next step</h3><p>{item.nextStep}</p>
                <footer>{item.sources.map((source) => <SourceLink source={source} key={source.id} />)}</footer>
              </div>
            </section>
          )) : <Empty title="No legacy opportunities" copy="This older report did not contain company-level analyses." />}
        </article>
      )}
    </div>
  );
}

function RunsView({
  runs,
  compact = false,
}: {
  runs: Run[];
  compact?: boolean;
}) {
  return (
    <div className={compact ? "vsee-runs-compact" : "vsee-content"}>
      {!compact && (
        <SectionTitle eyebrow="BACKGROUND WORKER" title="Every scan has a durable state." copy="Queued and running scans persist in PostgreSQL, so refreshing or closing the browser does not erase progress." />
      )}
      {!runs.length ? <Empty title="No runs yet" copy="Use Wake agent & scan market to create the first job." /> : (
        <div className="vsee-run-list">
          {runs.map((run) => (
            <article key={run.id}>
              <span className={`vsee-run-state ${run.status}`}>{run.status}</span>
              <div><strong>{evidenceContextLabel(run.evidenceContext)}</strong><small>{run.mode === "xtrace" ? "XTrace memory mode" : "Structured fallback mode"} · {run.id}</small></div>
              <div>
                <b>{run.currentStage ?? "Awaiting worker"}</b>
                <small>{shortDate(run.createdAt)} · {run.warningCount} warnings</small>
                {run.warnings.map((warning, index) => (
                  <small className="vsee-run-warning" key={`${run.id}-warning-${index}`}>{warning}</small>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatView({
  messages,
  question,
  onQuestion,
  onSubmit,
  busy,
  xtraceEnabled,
  deploymentMode = "public_demo",
  reportScope = null,
}: {
  messages: ChatMessage[];
  question: string;
  onQuestion(value: string): void;
  onSubmit(event: FormEvent): void;
  busy: boolean;
  xtraceEnabled: boolean;
  deploymentMode?: UiSession["deploymentMode"];
  reportScope?: ChatReportScope | null;
}) {
  return (
    <div className="vsee-content vsee-chat-page">
      <SectionTitle
        eyebrow="READ-ONLY QUERY"
        title={isDurableWorkspaceUiMode(deploymentMode)
          ? reportScope
            ? "Ask this exact report."
            : "Ask finalized underwriting."
          : "Ask the evidence already in VSee."}
        copy={isDurableWorkspaceUiMode(deploymentMode)
          ? "Chat reads finalized persisted Facts, Assumptions, Calculations, Framework Judgments, and Decisions. It cannot browse, run analysis, change policy, or create drafts."
          : `Chat never browses the web and never changes Deal state. XTrace recall is ${
              xtraceEnabled ? "enabled" : "disabled"
            } for this query.`}
      />
      {reportScope && (
        <div className="vsee-banner" role="status">
          ASKING REPORT · {reportScope.reportId} · RUN {reportScope.runId}
        </div>
      )}
      <div className="vsee-chat-log" aria-live="polite" aria-label="Evidence chat messages">
        {!messages.length && (
          <Empty
            title="Try a grounded question"
            copy={isDurableWorkspaceUiMode(deploymentMode)
              ? "Ask about a finalized company, framework conclusion, valuation input, or decision."
              : "For example: Which supplied companies relate to AI infrastructure? Why did we mark 7bridges as passed?"}
          />
        )}
        {messages.map((message, index) => (
          <article className={message.role} key={`${message.role}-${index}`}>
            <span>{message.role === "user" ? "YOU" : "VSEE"}</span>
            {message.role === "assistant" && message.memoryStatus === "unavailable" && (
              <strong className="vsee-chat-memory-warning" role="status">
                XTRACE RECALL UNAVAILABLE · LOCAL-ONLY ANSWER WITHHELD
              </strong>
            )}
            <p>{message.text}</p>
            {!!message.citations?.length && <footer>{message.citations.map((source) => <SourceLink source={source} key={source.id} />)}</footer>}
          </article>
        ))}
      </div>
      <form className="vsee-chat-form" onSubmit={onSubmit}>
        <input
          value={question}
          onChange={(event) => onQuestion(event.target.value)}
          placeholder="Ask about existing Deals, documents, events, or reports…"
          aria-label="Ask a question about existing evidence"
        />
        <button disabled={busy || question.trim().length < 2} aria-label="Ask VSee">
          {busy ? "THINKING…" : "ASK →"}
        </button>
      </form>
    </div>
  );
}

function SettingsView({
  health,
  runs,
}: {
  health: Health | null;
  runs: Run[];
}) {
  const services: Array<[keyof Health, string, string]> = [
    ["postgres", "PostgreSQL", "Persistent application data and worker queue"],
    ["worker", "Background worker", "Durable market scan and report processing"],
    ["xtrace", "XTrace Memory", "Long-term Deal and decision-context recall"],
    ["anthropic", "Anthropic", "Evidence-grounded matching and report reasoning"],
    ["storage", "Private source storage", "Private PDFs and ten-minute source access"],
    ["marketProviders", "Market providers", "Latest 14-day public information"],
  ];
  return (
    <div className="vsee-content">
      <SectionTitle
        eyebrow="SERVER-SIDE INTEGRATIONS"
        title={health && isDurableWorkspaceUiMode(health.deploymentMode)
          ? "Workspace readiness."
          : "Demo readiness."}
        copy="Keys and authorization remain on the server. Credentials are never sent to the browser."
      />
      <div className="vsee-health">
        {services.map(([key, name, copy]) => (
          <article key={key}>
            <span className={Boolean(health?.[key]) ? "ready" : ""} />
            <div><strong>{name}</strong><small>{copy}</small></div>
            <b>
              {key === "marketProviders" && health
                ? health.marketProviders > 0 ? `${health.marketProviders} READY` : "NOT CONFIGURED"
                : health?.[key] ? "READY" : "NOT CONFIGURED"}
            </b>
          </article>
        ))}
      </div>
      <section className="vsee-system-activity">
        <header>
          <span className="vsee-eyebrow">TECHNICAL DIAGNOSTICS</span>
          <h2>System activity</h2>
          <p>Durable run IDs, worker stages, and warnings are retained here for diagnostics.</p>
        </header>
        <RunsView runs={runs} compact />
      </section>
    </div>
  );
}

function SectionTitle({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return <header className="vsee-section-title"><span className="vsee-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{copy}</p></header>;
}

function Empty({ title, copy }: { title: string; copy: string }) {
  return <div className="vsee-empty"><span>◇</span><h2>{title}</h2><p>{copy}</p></div>;
}

function SourceLink({ source }: { source: Source }) {
  const legacy = !("schemaVersion" in source);
  const sourceUrl = legacy ? source.url : source.canonicalUrl ?? undefined;
  const page = legacy
    ? source.page
    : source.locator?.kind === "document_page"
    ? source.locator.page
    : undefined;
  if (
    source.provenance === "source_document"
    && sourceUrl?.startsWith("/api/source-revisions/")
  ) {
    return (
      <SourceRevisionLink revisionId={source.id}>
        {source.publisher ?? source.title}
        {page ? ` · p.${page}` : ""} ↗
      </SourceRevisionLink>
    );
  }
  const href = source.documentId
    ? `/api/documents/${encodeURIComponent(source.documentId)}/access${page ? `#page=${page}` : ""}`
    : safeExternalHttpUrl(sourceUrl);
  return href
    ? <a href={href} target="_blank" rel="noreferrer">
        {source.publisher ?? source.title}{page ? ` · p.${page}` : ""} ↗
      </a>
    : <span>{source.title}</span>;
}
