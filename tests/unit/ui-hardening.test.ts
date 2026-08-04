import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement, type ComponentType, type FormEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import "../helpers/public-demo";
import * as pageModule from "../../app/page";
import * as pageCompanyIntelligenceModule from "../../app/company-intelligence";
import { ActionDraftEditor } from "../../app/action-draft-dialog";
import { FundPolicyPanel } from "../../app/fund-policy";
import { SourceUploadFlow } from "../../app/source-upload-flow";
import { UnderwritingDetailPanel } from "../../app/underwriting-detail";
import {
  UnderwritingSummaryPanel,
} from "../../app/underwriting-summary";
import { GET as getDocumentAccess } from "../../app/api/documents/[id]/access/route";
import { GET as getHealth } from "../../app/api/settings/health/route";
import { listPreloadedDocuments } from "../../lib/corpus/manifest";
import { buildDemoViewModel } from "../../lib/demo/view-model";
import { createDefaultDemoDataStore } from "../../lib/storage/service";
import type {
  CandidateUnderwritingDetail,
} from "../../lib/underwriting/read-model";

const pagePath = new URL("../../app/page.tsx", import.meta.url);
const cssPath = new URL("../../app/vsee.css", import.meta.url);
const dialogPath = new URL("../../app/report-draft-dialog.tsx", import.meta.url);
const scanProgressPath = new URL("../../app/scan-progress.tsx", import.meta.url);
const companyIntelligencePath = new URL(
  "../../app/company-intelligence.tsx",
  import.meta.url,
);
const environmentPath = new URL("../../.env.example", import.meta.url);
const migrationPath = new URL("../../drizzle/0000_vsee_postgres.sql", import.meta.url);
const cleanupMigrationPath = new URL(
  "../../drizzle/0001_remove_report_delivery.sql",
  import.meta.url,
);
const obsoleteEmailConfigurationPattern = new RegExp([
  ["RE", "SEND_API_KEY"].join(""),
  ["REPORT", "_FROM_EMAIL"].join(""),
  ["REPORT", "_TO_EMAIL"].join(""),
  ["REPORT", "_ALLOWED_RECIPIENTS"].join(""),
].join("|"));
const obsoleteReportDeliverySqlPattern = new RegExp(
  `${["claim", "report", "delivery"].join("_")}|\\bdelivery\\s+jsonb\\b`,
);
const cleanupMigration = [
  "begin;",
  `drop function if exists public.${["claim", "report", "delivery"].join("_")}(text, text);`,
  `alter table public.intelligence_reports drop column if exists ${["de", "livery"].join("")};`,
  "commit;",
  "",
].join("\n");
const obsoleteEmailButtonPattern = new RegExp([
  ["EMAIL", "THIS", "REPORT"].join(" "),
  ["EMAIL", "SENT"].join(" "),
  "SENDING…",
].join("|"));

test("the demo has no email-provider or report-delivery configuration", async () => {
  const [environment, migration] = await Promise.all([
    readFile(environmentPath, "utf8"),
    readFile(migrationPath, "utf8"),
  ]);

  assert.doesNotMatch(environment, obsoleteEmailConfigurationPattern);
  assert.doesNotMatch(migration, obsoleteReportDeliverySqlPattern);
});

test("the forward migration removes only legacy report-delivery database state", async () => {
  const cleanup = await readFile(cleanupMigrationPath, "utf8");

  assert.equal(cleanup, cleanupMigration);
});

test("health response exposes worker readiness independently from PostgreSQL configuration", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    const response = await getHealth(
      new Request("http://localhost/api/settings/health"),
    );
    const body = await response.json() as {
      data: {
        postgres: boolean;
        worker: boolean;
        corpusReady: boolean;
        deploymentMode: string;
        capabilities: Record<string, boolean>;
      };
    };

    assert.equal(body.data.postgres, false);
    assert.equal(body.data.worker, false);
    assert.equal(body.data.corpusReady, false);
    assert.equal(body.data.deploymentMode, "public_demo");
    assert.deepEqual(body.data.capabilities, {
      runScans: false,
      resetDemo: false,
      uploadSources: false,
      confirmUploads: false,
      manageFundPolicy: false,
      saveActionDrafts: false,
    });
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

test("health exposes product controls from the server-authorized request context", async () => {
  const response = await getHealth(
    new Request("http://localhost/api/settings/health"),
    undefined,
    {
      async resolveRequestContext() {
        return {
          mode: "product",
          principal: {
            userId: "owner_1",
            email: "owner@example.test",
          },
          workspaceId: "workspace_1",
          role: "owner",
          permissions: {
            readWorkspace: true,
            readPrivateSources: true,
            mutateSources: true,
            managePolicy: true,
            administerFrameworks: false,
          },
        };
      },
    },
  );
  const body = await response.json() as {
    data: {
      deploymentMode: string;
      capabilities: Record<string, boolean>;
    };
  };

  assert.equal(body.data.deploymentMode, "product");
  assert.deepEqual(body.data.capabilities, {
    runScans: true,
    resetDemo: false,
    uploadSources: true,
    confirmUploads: true,
    manageFundPolicy: true,
    saveActionDrafts: true,
  });
});

test("health exposes all testing controls for a public sandbox context", async () => {
  const response = await getHealth(
    new Request("http://localhost/api/settings/health"),
    undefined,
    {
      async resolveRequestContext() {
        return {
          mode: "public_sandbox",
          principal: {
            userId: "system:public-sandbox",
            email: "public-sandbox@invalid.local",
          },
          workspaceId: "workspace_sandbox",
          role: "sandbox",
          permissions: {
            readWorkspace: true,
            readPrivateSources: true,
            mutateSources: true,
            managePolicy: true,
            administerFrameworks: false,
          },
        };
      },
    },
  );
  const body = await response.json() as {
    data: { deploymentMode: string; capabilities: Record<string, boolean> };
  };

  assert.equal(body.data.deploymentMode, "public_sandbox");
  assert.deepEqual(body.data.capabilities, {
    runScans: true,
    resetDemo: true,
    uploadSources: true,
    confirmUploads: true,
    manageFundPolicy: true,
    saveActionDrafts: true,
  });
});

test("health reports XTrace configured for an mmk key without an organization ID", async () => {
  const previousApiKey = process.env.XTRACE_API_KEY;
  const previousOrgId = process.env.XTRACE_ORG_ID;
  process.env.XTRACE_API_KEY = "mmk_test";
  delete process.env.XTRACE_ORG_ID;

  try {
    const response = await getHealth(
      new Request("http://localhost/api/settings/health"),
    );
    const body = await response.json() as { data: { xtrace: boolean } };

    assert.equal(body.data.xtrace, true);
  } finally {
    if (previousApiKey === undefined) delete process.env.XTRACE_API_KEY;
    else process.env.XTRACE_API_KEY = previousApiKey;
    if (previousOrgId === undefined) delete process.env.XTRACE_ORG_ID;
    else process.env.XTRACE_ORG_ID = previousOrgId;
  }
});

test("health derives corpus readiness from durable confirmation, not browser state", async () => {
  const store = createDefaultDemoDataStore();
  await store.resetDemoData("workspace_demo");
  try {
    for (const document of listPreloadedDocuments()) {
      if (document.role === "reference") continue;
      await store.ensureWorkspaceDocument({
        workspaceId: "workspace_demo",
        documentId: document.id,
      });
    }
    const response = await getHealth(
      new Request("http://localhost/api/settings/health"),
    );
    const body = await response.json() as {
      data: { corpusReady: boolean; corpusConfirmedCount: number };
    };
    assert.equal(body.data.corpusReady, true);
    assert.equal(body.data.corpusConfirmedCount, 13);
  } finally {
    await store.resetDemoData("workspace_demo");
  }
});

test("dashboard keeps scans honest and requires explicit import review", async () => {
  const page = await readFile(pagePath, "utf8");

  assert.match(page, /worker:\s*boolean/);
  assert.match(page, /health\?\.postgres/);
  assert.match(page, /health\.worker/);
  assert.match(page, /health\.anthropic/);
  assert.match(page, /health\.corpusReady/);
  assert.doesNotMatch(page, /localStorage/);
  assert.match(page, /!xtraceEnabled\s*\|\|\s*health\.xtrace/);
  assert.match(page, /\/api\/imports\/preview/);
  assert.match(page, /Confirm company &(?:amp;)? Deal ownership/i);
  assert.match(page, /aria-checked=\{xtraceEnabled\}/);
  assert.match(page, /role="alert"/);
  assert.match(page, /role="status"/);
});

test("public sandbox reset states its safety contract and reload behavior", async () => {
  const [page, css] = await Promise.all([
    readFile(pagePath, "utf8"),
    readFile(cssPath, "utf8"),
  ]);

  assert.match(page, /RESET TEST VIEW/);
  assert.match(
    page,
    /does not delete Deals, Sources, XTrace memory, Fund Policy, underwriting artifacts, or action drafts/,
  );
  assert.match(page, /PUBLIC TEST SANDBOX/);
  assert.match(page, /Do not upload confidential or real customer data/);
  assert.match(page, /setFocusedReportId\(null\)/);
  assert.match(page, /setActiveRunId\(null\)/);
  assert.match(page, /setActiveRun\(null\)/);
  assert.match(page, /setScanProgressOpen\(false\)/);
  assert.match(page, /setReportDraft\(null\)/);
  assert.match(page, /window\.history\.replaceState\(\{\}, "", window\.location\.pathname\)/);
  assert.match(page, /Current test view reset\. Durable evidence and analysis history were preserved\./);
  assert.match(css, /vsee-sandbox-warning/);
});

test("reset control stays disabled outside the public sandbox", async () => {
  const page = await readFile(pagePath, "utf8");

  assert.match(page, /uiSession\.capabilities\.resetDemo\s*\?\s*\(/);
  assert.match(page, /RESET TEST VIEW/);
  assert.match(page, /RESET DISABLED/);
  assert.match(page, /aria-label="Reset is disabled"/);
  assert.match(page, /title="Durable analysis products are never deleted from this UI\."/);
});

test("uploaded-source UI accepts only staged runtime formats and renders confirmation previews", () => {
  const html = renderToStaticMarkup(createElement(SourceUploadFlow, {
    uploads: [upload("awaiting_confirmation", {
      preview: {
        candidateCompanyName: "Acme",
        candidateHeadline: "Acme serves carriers.",
        facts: [],
      },
      candidateDeals: [],
    })],
    canUpload: true,
    canConfirm: true,
    uploading: false,
    confirmingUploadId: null,
    onUpload() {},
    onConfirm() {},
  }));

  assert.match(html, /accept="\.txt,\.md,\.pdf,\.docx,\.png,\.webp"/);
  assert.match(html, /TXT, Markdown, PDF, DOCX, PNG, or WebP · 12 MB maximum/);
  assert.doesNotMatch(html, /JPEG|GIF|audio/i);
  assert.match(html, /Needs confirmation/);
  assert.match(html, /Confirm company (?:&amp;|&) Deal ownership/);
  assert.doesNotMatch(html, /PDF, DOCX, TXT, or MD/);
  assert.doesNotMatch(html, /stores it in XTrace as a new Deal memory/);
});

test("dashboard supports report deep links, page anchors, and a two-row mobile nav", async () => {
  const [page, css] = await Promise.all([
    readFile(pagePath, "utf8"),
    readFile(cssPath, "utf8"),
  ]);

  assert.match(page, /searchParams\.get\("view"\)/);
  assert.match(page, /searchParams\.get\("report"\)/);
  assert.match(page, /#page=\$\{page\}/);
  assert.match(page, /No Deals match/i);
  assert.match(css, /grid-template-columns:repeat\(4,1fr\)/);
});

test("scans stay in the investor workflow and open the durable report", async () => {
  const [page, progress] = await Promise.all([
    readFile(pagePath, "utf8"),
    readFile(scanProgressPath, "utf8"),
  ]);
  const runScanBody = page.slice(
    page.indexOf("async function runScan()"),
    page.indexOf("function selectDocuments"),
  );

  assert.match(page, /WAKE AGENT & SCAN MARKET/);
  assert.match(page, /setActiveRunId/);
  assert.match(page, /\/api\/reports\?runId=/);
  assert.doesNotMatch(runScanBody, /navigate\("runs"\)/);
  for (const label of [
    "Scanning the last 14 days of public evidence",
    "Normalizing and ranking market events",
    "Recalling XTrace investment memory",
    "Comparing evidence across eligible companies",
    "Generating company intelligence report",
    "Report ready",
    "The scan could not produce a report",
  ]) {
    assert.match(progress, new RegExp(label));
  }
});

test("reports render the complete company intelligence hierarchy", async () => {
  const [page, companyIntelligence] = await Promise.all([
    readFile(pagePath, "utf8"),
    readFile(companyIntelligencePath, "utf8"),
  ]);

  for (const label of [
    "THEN / INVESTMENT MEMORY",
    "NOW / MARKET EVIDENCE",
    "RECOMMENDED NEXT MOVE",
    "IC Snapshot",
    "Traction",
    "Deal Terms",
    "Risks",
    "Decision History",
    "Source Lineage",
    "Not available in current evidence",
  ]) {
    assert.match(companyIntelligence, new RegExp(label.replace("/", "\\/")));
  }
  assert.doesNotMatch(page, /\{ view: "runs", label: "Runs"/);
  assert.match(page, /System activity/);
  assert.match(page, /priorityDealId/);
  assert.match(page, /CompanyIntelligenceReport/);
});

test("latest intelligence uses neutral changed-belief and priority wording", async () => {
  const page = await readFile(pagePath, "utf8");

  assert.match(page, /Belief revisions requiring review/);
  assert.match(page, /Priority #\{item\.rank\}/);
  assert.doesNotMatch(page, /Deals deserve another look/);
});

test("reports make structured image fallback and missing XTrace memory explicit", () => {
  const CompanyIntelligenceReport = (
    pageCompanyIntelligenceModule as unknown as {
      CompanyIntelligenceReport: ComponentType<{
        report: {
          id: string;
          createdAt: string;
          marketSummary: string;
          opportunities: never[];
          analysisStatus: "incomplete";
          evidenceCoverage: {
            acceptedPublicEvents: number;
            excludedPublicItems: number;
            truncatedPublicEvents: number;
            recalledDealCount: number;
            unavailableDealCount: number;
            structuredImageFallbackDealCount: number;
          };
          counts: {
            companyCount: number;
            beliefRevised: number;
            monitor: number;
            noMaterialChange: number;
            analysisUnavailable: number;
          };
          priorityDealId: null;
          companyAnalyses: ReturnType<typeof priorityAnalysisFixture>[];
        };
        focused: boolean;
        allowDraft: boolean;
        onDraft(): void;
        showDemoProfiles: boolean;
        underwritingEnabled: boolean;
        canSaveActionDrafts: boolean;
      }>;
    }
  ).CompanyIntelligenceReport;

  const html = renderToStaticMarkup(createElement(
    CompanyIntelligenceReport,
    {
      report: {
        id: "report_image_partial",
        createdAt: "2026-07-29T12:00:00.000Z",
        marketSummary: "One source-backed event was accepted.",
        opportunities: [],
        analysisStatus: "incomplete",
        evidenceCoverage: {
          acceptedPublicEvents: 1,
          excludedPublicItems: 0,
          truncatedPublicEvents: 0,
          recalledDealCount: 0,
          unavailableDealCount: 0,
          structuredImageFallbackDealCount: 1,
        },
        counts: {
          companyCount: 1,
          beliefRevised: 0,
          monitor: 1,
          noMaterialChange: 0,
          analysisUnavailable: 0,
        },
        priorityDealId: null,
        companyAnalyses: [priorityAnalysisFixture()],
      },
      focused: true,
      allowDraft: false,
      onDraft() {},
      showDemoProfiles: false,
      underwritingEnabled: true,
      canSaveActionDrafts: false,
    },
  ));

  assert.match(html, /PARTIAL XTRACE COVERAGE/);
  assert.match(html, /Structured image evidence was used for[\s\S]*1[\s\S]*image-only[\s\S]*Deal/);
  assert.match(html, /contain no XTrace memory IDs/);
  assert.match(html, /not counted as recalled Deal memories/);
  assert.match(html, />1<\/strong><span>Structured image fallbacks<\/span>/);
  assert.match(html, /1 traceable source/);
  assert.match(html, /DURABLE UNDERWRITING REPORT/);
  assert.match(html, /independent named-advisory viewpoints/i);
  assert.match(html, /formal deterministic decision/i);
  assert.doesNotMatch(html, /verified sources?/i);
});

test("Deals render the complete labeled synthetic decision context", async () => {
  const page = await readFile(pagePath, "utf8");

  assert.match(page, /decisionReasonLabel\(deal\.status\)/);
  assert.match(page, /\{deal\.fixture\.label\}/);
  assert.match(page, /deal\.fixture\.decisionReason/);
  assert.match(page, /Partner concern/);
  assert.match(page, /Revisit condition/);
  assert.match(page, /Previous meeting summary/);
});

test("reports open an editable internal draft dialog without sending email", async () => {
  const [page, dialog, css] = await Promise.all([
    readFile(pagePath, "utf8"),
    readFile(dialogPath, "utf8"),
    readFile(cssPath, "utf8"),
  ]);

  assert.match(page, /DRAFT THIS REPORT →/);
  assert.match(page, /buildInternalReportDraft/);
  assert.match(dialog, /<dialog/);
  assert.match(dialog, /Subject/);
  assert.match(dialog, /Message/);
  assert.match(dialog, /COPY BODY/);
  assert.match(dialog, /COPY FULL DRAFT/);
  assert.match(dialog, /aria-live="polite"/);
  assert.doesNotMatch(dialog, />To</);
  assert.doesNotMatch(page, /\/api\/reports\/\$\{latestReport\.id\}\/email/);
  assert.doesNotMatch(page, obsoleteEmailButtonPattern);
  assert.match(css, /\.vsee-draft-dialog::backdrop/);
  assert.match(css, new RegExp("@media\\(max-width:680px\\).*\\.vsee-draft-dialog", "s"));
});

test("browser API reads bypass stale deployment caches", async () => {
  const page = await readFile(pagePath, "utf8");

  assert.match(
    page,
    /fetch\(url,\s*\{[\s\S]*cache:\s*init\?\.cache\s*\?\?\s*"no-store"/,
  );
});

test("report draft dialog has no implicit submit or nested main landmark", async () => {
  const dialog = await readFile(dialogPath, "utf8");

  assert.doesNotMatch(dialog, /<form\b[^>]*\bmethod=["']dialog["']/i);
  assert.doesNotMatch(dialog, /<main\b/i);
});

test("Chat renders an explicit warning when requested XTrace recall is unavailable", () => {
  const ChatView = (
    pageModule as unknown as {
      ChatView?: ComponentType<{
        messages: Array<{
          role: "user" | "assistant";
          text: string;
          memoryStatus?: "disabled" | "available" | "unavailable";
        }>;
        question: string;
        onQuestion(value: string): void;
        onSubmit(event: FormEvent): void;
        busy: boolean;
        xtraceEnabled: boolean;
      }>;
    }
  ).ChatView;
  assert.ok(ChatView);

  const html = renderToStaticMarkup(createElement(ChatView, {
    messages: [{
      role: "assistant",
      text: "XTrace recall is currently unavailable.",
      memoryStatus: "unavailable",
    }],
    question: "",
    onQuestion() {},
    onSubmit() {},
    busy: false,
    xtraceEnabled: true,
  }));

  assert.match(html, /role="status"/);
  assert.match(html, /XTRACE RECALL UNAVAILABLE/i);
  assert.match(html, /LOCAL-ONLY ANSWER WITHHELD/i);
});

test("Fund Policy follows Sources and public demo mutations explain why they are disabled", () => {
  const Home = pageModule.default;
  const shell = renderToStaticMarkup(createElement(Home));
  assert.ok(shell.indexOf("Open Sources") < shell.indexOf("Open Fund Policy"));

  const policy = {
    id: "policy_workspace_v2",
    workspaceId: "workspace_1",
    version: 2,
    source: "user_custom" as const,
    values: {
      id: "fund_policy_balanced_us_software_v1",
      riskPreference: "balanced",
      baseCurrency: "USD",
      stageMandate: ["seed"],
      businessModelMandate: ["b2b_saas"],
      geographyMandate: ["us"],
      committedFundSize: "200000000",
      remainingDeployableCapital: "140000000",
      initialCheckMin: "1500000",
      initialCheckMax: "5000000",
      targetOwnership: "0.10",
      targetOwnershipMin: "0.075",
      targetOwnershipMax: "0.15",
      hardMinimumOwnership: null,
      reserveMultipleOfInitialCheck: "1.0",
      portfolioConcentrationLimit: "0.10",
      returnTargets: {
        seed: {
          grossMoic: "5",
          grossIrr: "0.2228445449938519",
          horizonYears: "8",
        },
        series_a: {
          grossMoic: "3",
          grossIrr: "0.169930812758687",
          horizonYears: "7",
        },
      },
      scenarioPriceMultipliers: {
        bear: "0.75",
        base: "1",
        bull: "1.25",
      },
      valuationPremiumReviewThreshold: "0.25",
      valuationPremiumBlockerThreshold: "0.50",
      acceptableFutureDilution: "0.50",
      humanFinalApproval: true,
      externalActionMode: "draft_only",
    },
    createdByUserId: "owner_1",
    createdAt: "2026-07-29T12:00:00.000Z",
  };
  const html = renderToStaticMarkup(createElement(FundPolicyPanel, {
    policy,
    canManage: false,
    previewOpen: true,
    applying: false,
    onOpenPreview() {},
    onClosePreview() {},
    onApplyRecommended() {},
  }));

  assert.match(html, /Fund Policy · Version 2/);
  assert.match(html, /Initial check max/i);
  assert.match(html, /\$5,000,000/);
  assert.match(html, /Initial check max[\s\S]*\$8,000,000/i);
  assert.match(html, /read-only public demo/i);
  assert.match(html, /disabled/);
});

test("source upload renders refresh-safe lifecycle, identity confirmation, and terminal IDs", () => {
  const uploads = [
    upload("queued"),
    upload("extracting"),
    upload("awaiting_confirmation", {
      uploadId: "upload_confirm",
      preview: {
        candidateCompanyName: "Acme",
        candidateHeadline: "Acme serves carriers.",
        facts: [{
          text: "Acme serves carriers.",
          excerpt: "Acme serves carriers.",
          locator: { kind: "text_range" as const, start: 0, end: 21 },
        }],
      },
      candidateDeals: [{
        dealId: "deal_acme",
        companyName: "Acme",
        status: "evaluating" as const,
      }],
    }),
    upload("confirmed"),
    upload("confirmed", {
      uploadId: "upload_retryable",
      failure: "Memory ingestion failed. Retry is available.",
    }),
    upload("ready", {
      uploadId: "upload_ready",
      dealId: "deal_ready",
      sourceRevisionId: "revision_ready",
    }),
    upload("failed", {
      uploadId: "upload_failed",
      failure: "Document processing failed.",
    }),
  ];
  const html = renderToStaticMarkup(createElement(SourceUploadFlow, {
    uploads,
    canUpload: true,
    canConfirm: true,
    uploading: false,
    confirmingUploadId: null,
    onUpload() {},
    onConfirm() {},
  }));

  for (const label of [
    "Queued for extraction",
    "Extracting preview",
    "Needs confirmation",
    "Confirmed for promotion",
    "Retryable memory failure",
    "Ready",
    "Terminal extraction failure",
  ]) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /Company name/);
  assert.match(html, /Deal ownership/);
  assert.match(html, /Confirm Acme and Deal ownership/);
  assert.match(html, /deal_ready/);
  assert.match(html, /revision_ready/);
});

test("underwriting summary renders every changed belief in priority order without cutoff language", () => {
  const html = renderToStaticMarkup(createElement(UnderwritingSummaryPanel, {
    batch: {
      batchId: "batch_1",
      status: "partial",
      queue: [
        queueEntry("deal_priority_six", "completed", 6),
        queueEntry("deal_failed", "failed", 5),
        queueEntry("deal_completed", "completed", 1),
        queueEntry("deal_running", "running", 2),
        queueEntry("deal_partial", "partial", 3),
        queueEntry("deal_queued", "queued", 4),
      ],
      underwritingStatusCounts: {
        queued: 1,
        running: 1,
        completed: 2,
        partial: 1,
        failed: 1,
      },
    },
    companyNames: {
      deal_completed: "Completed Co",
      deal_running: "Running Co",
      deal_partial: "Partial Co",
      deal_queued: "Queued Co",
      deal_failed: "Failed Co",
      deal_priority_six: "Priority Six Co",
    },
    onOpenCandidate() {},
  }));

  assert.match(html, /Belief Revisions/);
  assert.match(html, /Changed Beliefs/);
  assert.match(html, /Underwriting Queue/);
  assert.match(html, /Priority Order/);
  assert.match(html, /Underwriting Status/);
  assert.match(html, /Deep Underwriting/);
  assert.match(html, /Investor Framework Perspectives/);
  assert.match(html, /exact public-source lineage/i);
  assert.ok(html.indexOf("Completed Co") < html.indexOf("Priority Six Co"));
  assert.match(html, /Priority Six Co/);
  assert.match(html, /Priority Order · #6/);
  for (const label of [
    "Completed",
    "Running",
    "Partial",
    "Queued",
    "Failed",
  ]) {
    assert.match(html, new RegExp(label));
  }
  assert.doesNotMatch(
    html,
    /Top[ -]?5|Selected for Top|rank cutoff|not selected|sixth.*reject/i,
  );
});

test("underwriting detail preserves section order, lineage, public version pins, and draft-only actions", () => {
  const html = renderToStaticMarkup(createElement(UnderwritingDetailPanel, {
    companyName: "Acme",
    analysis: {
      companyName: "Acme",
      dealStatus: "evaluating",
      confidence: "high",
      marketEvidence: {
        relationship: "satisfies",
        explanation: "Carrier adoption accelerated.",
        events: [{
          id: "event_1",
          title: "Carrier capital shifted",
          eventType: "capital_flow",
          publishedAt: "2026-07-28T12:00:00.000Z",
          sourceIds: ["source_public"],
        }],
      },
      implications: {
        positive: ["Faster enterprise adoption."],
        negative: ["Pricing pressure may rise."],
      },
      investmentMemory: {
        previousMeetingSummary: "The fund waited for carrier proof.",
        decisionReason: "Commercial proof was early.",
        fixtureIds: [],
      },
      sources: [{
        id: "source_public",
        provenance: "public_web",
        title: "Carrier News",
        url: "https://example.test/carrier-news",
        excerpt: "Carrier adoption accelerated.",
      }],
    },
    detail: underwritingDetailFixture(),
    drafts: [{
      id: "draft_1",
      candidateRunId: "candidate_1",
      schemaVersion: "legacy-action-draft-v1",
      safety: "legacy_unclassified",
      deliveryMode: "draft_only",
      draftPolicyVersion: null,
      actionPolicyVersion: null,
      dealStatus: null,
      beliefDirection: null,
          actions: [],
          missingEvidence: [],
      format: null,
      channel: "dd_request",
      audienceType: "founder",
      body: "Please share the latest retention schedule.",
      createdAt: "2026-07-29T12:00:00.000Z",
      updatedAt: "2026-07-29T12:00:00.000Z",
    }],
    canSaveDrafts: true,
    onEditDraft() {},
  }));

  const orderedHeadings = [
    "What happened?",
    "What is the impact?",
    "Which historical companies are affected?",
    "Investor Framework Perspectives",
    "Valuation and fund return",
    "Final conclusion",
    "What can you do?",
    "Action drafts",
  ];
  for (let index = 1; index < orderedHeadings.length; index += 1) {
    assert.ok(
      html.indexOf(orderedHeadings[index - 1])
        < html.indexOf(orderedHeadings[index]),
    );
  }
  assert.match(html, />Calculation</);
  assert.match(html, />Fact</);
  assert.match(html, /Capital flow[\s\S]*?Unsupported/);
  assert.match(html, /Gross IRR[\s\S]*?Unsupported/);
  assert.match(html, /Stale benchmark/);
  assert.match(html, /Open disagreement evidence and lineage/);
  assert.match(
    html,
    /\/api\/source-revisions\/revision_1\/access/,
  );
  for (const label of [
    "Policy",
    "Benchmark",
    "Framework",
    "Underwriting reference catalog",
    "Framework catalog version",
    "Framework catalog fingerprint",
    "Framework corpus digest",
    "Router",
    "Critical Evidence",
    "Valuation Method",
    "Decision",
    "Formula",
    "Model",
    "Prompt",
    "Schema",
    "Settings",
    "Application commit",
  ]) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /framework_1 · sha256:framework/);
  assert.match(html, /private-provider-model/);
  assert.match(html, /private-prompt-version/);
  assert.match(html, /private-settings-fingerprint/);
  assert.match(html, /private-application-commit/);
  assert.match(html, /formal decision weight · 0/i);
  assert.match(html, /named_advisory_pack_v1/);
  assert.match(html, /2\.3\.0/);
  assert.match(html, /named_advisory_sources_v1/);
  assert.match(html, /Jun 30, 2026/);
  assert.match(html, /PT-01/);
  assert.match(html, /1\.4\.0/);
  assert.match(html, /Contrarian Monopoly Lens/);
  assert.match(html, /Peter Thiel public source/);
  assert.match(html, /https:\/\/example\.test\/peter-thiel-source/);
  assert.match(html, /Peter Thiel · Blake Masters/);
  assert.match(html, /A1 · book/);
  assert.match(html, /person direct · primary/);
  assert.match(html, /claim_monopoly/);
  assert.match(html, /sha256:source-content/);
  assert.match(html, /Public-source paraphrase only/);
  assert.match(html, /framework-catalog-v7/);
  assert.match(html, /sha256:framework-catalog/);
  assert.match(html, /sha256:framework-corpus/);
  assert.doesNotMatch(html, /\bTo\b|>Send<|>Publish</);
});

test("each valuation card links only to its exact calculation identity", () => {
  const detail = underwritingDetailFixture();
  const calculation = detail.calculations[0];
  const calculations = [
    {
      ...calculation,
      id: "calculation:candidate_1:venture_return_method_v1:maximum_acceptable_pre_money",
      formulaId: "venture_return_method_v1",
      output: "24000000",
      status: "completed",
    },
    {
      ...calculation,
      id: "calculation:candidate_1:simple_pre_post_ownership_v1:initial_ownership",
      formulaId: "simple_pre_post_ownership_v1",
      output: "0.10",
      status: "completed",
    },
    {
      ...calculation,
      id: "calculation:candidate_1:future_dilution_v1:post_dilution_ownership",
      formulaId: "future_dilution_v1",
      output: "0.075",
      status: "completed",
    },
    {
      ...calculation,
      id: "calculation:candidate_1:gross_deal_moic_v1:gross_moic",
      formulaId: "gross_deal_moic_v1",
      output: "4",
      status: "completed",
    },
    {
      ...calculation,
      id: "calculation:candidate_1:annualized_gross_irr_v1:gross_irr",
      formulaId: "annualized_gross_irr_v1",
      output: "0.219",
      status: "completed",
    },
  ];
  const renderedDetail = {
    ...detail,
    calculations,
    claimEdges: detail.claimEdges.filter(
      ({ claimItemId }) => !claimItemId.startsWith("calculation:"),
    ),
    valuation: {
      ...detail.valuation,
      grossIrr: "0.219",
      calculationIds: calculations.map(({ id }) => id),
    },
  };
  const html = renderToStaticMarkup(createElement(UnderwritingDetailPanel, {
    companyName: "Acme",
    analysis: null,
    detail: renderedDetail as CandidateUnderwritingDetail,
    drafts: [],
    canSaveDrafts: false,
    onEditDraft() {},
  }));
  const expectedByLabel = new Map([
    [
      "Maximum acceptable pre-money",
      "calculation:candidate_1:venture_return_method_v1:maximum_acceptable_pre_money",
    ],
    [
      "Initial ownership",
      "calculation:candidate_1:simple_pre_post_ownership_v1:initial_ownership",
    ],
    [
      "Post-dilution ownership",
      "calculation:candidate_1:future_dilution_v1:post_dilution_ownership",
    ],
    [
      "Gross MOIC",
      "calculation:candidate_1:gross_deal_moic_v1:gross_moic",
    ],
    [
      "Gross IRR",
      "calculation:candidate_1:annualized_gross_irr_v1:gross_irr",
    ],
  ]);

  for (const [label, calculationId] of expectedByLabel) {
    const cardStart = html.indexOf(`<span>${label}</span>`);
    assert.notEqual(cardStart, -1, `${label} card was not rendered`);
    const cardEnd = html.indexOf("</article>", cardStart);
    assert.notEqual(cardEnd, -1, `${label} card was not closed`);
    const card = html.slice(cardStart, cardEnd);
    assert.match(card, />Calculation</);
    assert.match(card, new RegExp(calculationId));
    for (const otherCalculationId of expectedByLabel.values()) {
      if (otherCalculationId !== calculationId) {
        assert.doesNotMatch(card, new RegExp(otherCalculationId));
      }
    }
  }
});

test("action drafts edit only the current body and expose save, copy, and download without delivery controls", () => {
  const html = renderToStaticMarkup(createElement(ActionDraftEditor, {
    draft: {
      id: "draft_1",
      candidateRunId: "candidate_1",
      schemaVersion: "legacy-action-draft-v1",
      safety: "legacy_unclassified",
      deliveryMode: "draft_only",
      draftPolicyVersion: null,
      actionPolicyVersion: null,
      dealStatus: null,
      beliefDirection: null,
      actions: [],
      missingEvidence: [],
      format: null,
      channel: "internal_memo",
      audienceType: "internal",
      body: "Current saved body.",
      createdAt: "2026-07-29T12:00:00.000Z",
      updatedAt: "2026-07-29T13:00:00.000Z",
    },
    body: "Current edited body.",
    saving: false,
    canSave: true,
    statusMessage: "",
    onBodyChange() {},
    onSave() {},
    onCopy() {},
    onDownload() {},
  }));

  assert.match(html, /Current edited body/);
  assert.match(html, /SAVE CURRENT BODY/);
  assert.match(html, /COPY CURRENT BODY/);
  assert.match(html, /DOWNLOAD \.TXT/);
  assert.doesNotMatch(
    html,
    /\bTo\b|recipient|delivery state|>Send<|>Publish<|Email provider|LinkedIn provider/i,
  );
});

test("public demo Deal links retain document access routes and those routes resolve", async () => {
  const DealsView = (
    pageModule as unknown as {
      DealsView?: ComponentType<{
        deals: ReturnType<typeof buildDemoViewModel>["deals"];
        uploads: [];
        query: string;
        deploymentMode: "public_demo";
        onQuery(value: string): void;
      }>;
    }
  ).DealsView;
  assert.ok(DealsView);
  const deal = buildDemoViewModel(new Date("2026-07-29T12:00:00.000Z"))
    .deals.find(({ documentId }) => documentId === "doc_100plus");
  assert.ok(deal);

  const html = renderToStaticMarkup(createElement(DealsView, {
    deals: [deal],
    uploads: [],
    query: "",
    deploymentMode: "public_demo",
    onQuery() {},
  }));
  assert.match(
    html,
    /href="\/api\/documents\/doc_100plus\/access(?:#page=\d+)?"/,
  );
  assert.doesNotMatch(html, /\/api\/source-revisions\/doc_100plus\/access/);

  const response = await getDocumentAccess(
    new Request("https://vsee.test/api/documents/doc_100plus/access"),
    { params: Promise.resolve({ id: "doc_100plus" }) },
  );
  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get("location"),
    "https://vsee.test/api/documents/doc_100plus",
  );
});

test("product Deals and report priority never render demo profile fixtures as persisted facts", () => {
  const DealsView = (
    pageModule as unknown as {
      DealsView?: ComponentType<{
        deals: Array<{
          id: string;
          companyName: string;
          status: "screening";
          documentId: string;
          sourceTitle: string;
          sourceUrl: string;
          sourceRevisionIds: string[];
          sourceLinks: Array<{
            sourceRevisionId: string;
            sourceUrl: string;
          }>;
        }>;
        uploads: [];
        query: string;
        deploymentMode: "product";
        onQuery(value: string): void;
      }>;
    }
  ).DealsView;
  assert.ok(DealsView);
  const dealsHtml = renderToStaticMarkup(createElement(DealsView, {
    deals: [{
      id: "deal_1906",
      companyName: "Persisted Company",
      status: "screening",
      documentId: "revision_primary",
      sourceTitle: "2 confirmed sources",
      sourceUrl: "/api/source-revisions/revision_primary/access",
      sourceRevisionIds: ["revision_primary", "revision_second"],
      sourceLinks: [
        {
          sourceRevisionId: "revision_primary",
          sourceUrl: "/api/source-revisions/revision_primary/access",
        },
        {
          sourceRevisionId: "revision_second",
          sourceUrl: "/api/source-revisions/revision_second/access",
        },
      ],
    }],
    uploads: [],
    query: "",
    deploymentMode: "product",
    onQuery() {},
  }));
  assert.match(dealsHtml, /revision_primary/);
  assert.match(dealsHtml, /revision_second/);
  assert.match(
    dealsHtml,
    /href="\/api\/source-revisions\/revision_primary\/access"/,
  );
  assert.match(
    dealsHtml,
    /href="\/api\/source-revisions\/revision_second\/access"/,
  );
  assert.doesNotMatch(dealsHtml, /\$9\.8M|Sample deal profile/);

  const priorityHtml = renderToStaticMarkup(createElement(
    (
      awaitImportPriorityResult()
    ),
    {
      analysis: priorityAnalysisFixture(),
      onOpenBrief() {},
      showDemoProfiles: false,
    },
  ));
  assert.doesNotMatch(priorityHtml, /\$9\.8M|Sample deal profile/);
  assert.match(priorityHtml, /1 traceable source/);
  assert.doesNotMatch(priorityHtml, /verified sources?/i);
});

function upload(
  status:
    | "queued"
    | "extracting"
    | "awaiting_confirmation"
    | "confirmed"
    | "ingesting_memory"
    | "ready"
    | "failed",
  overrides: Record<string, unknown> = {},
) {
  return {
    uploadId: `upload_${status}`,
    status,
    filename: `${status}.md`,
    contentType: "text/markdown",
    preview: null,
    candidateDeals: [],
    failure: null,
    memoryNotice: null,
    dealId: null,
    sourceRevisionId: null,
    createdAt: "2026-07-29T12:00:00.000Z",
    updatedAt: "2026-07-29T12:00:00.000Z",
    ...overrides,
  };
}

function queueEntry(
  dealId: string,
  status:
    | "queued"
    | "running"
    | "partial"
    | "completed"
    | "failed",
  priorityRank: number,
) {
  return {
    batchId: "batch_1",
    dealId,
    status,
    priorityRank,
    candidateRunId: `candidate_${dealId}`,
    ...(status === "partial" || status === "failed"
      ? { reason: `${status} persisted reason` }
      : {}),
    decision: status === "completed" ? "Advance" as const : null,
  };
}

function underwritingDetailFixture(): CandidateUnderwritingDetail {
  return {
    candidateRunId: "candidate_1",
    dealId: "deal_1",
    evidencePack: {
      id: "evidence_pack_1",
      version: 1,
      asOfDate: "2026-07-29",
      sourceRevisionIds: ["revision_1"],
      facts: [{
        id: "fact_1",
        analysisType: "fact",
        provenanceOrigin: "uploaded_document",
        field: "reported_valuation",
        value: "18000000",
        unit: "money",
        currency: "USD",
        periodStart: null,
        periodEnd: null,
        publishedAt: null,
        eventAt: null,
        retrievedAt: "2026-07-29T12:00:00.000Z",
        sourceRevisionId: "revision_1",
        locator: { kind: "text_range", start: 0, end: 8 },
        sourceRole: "management",
        assertionStatus: "reported",
        verificationMethod: null,
        freshness: "current",
        acceptedForGate: true,
      }],
      assumptions: [{
        id: "assumption_1",
        analysisType: "assumption",
        provenanceOrigin: "recommended_policy",
        scenario: "base",
        field: "future_dilution",
        value: "0.25",
        unit: "rate",
        rationale: "Fund Policy default.",
        inputRefIds: [],
        sensitivity: "high",
        requiresConfirmation: true,
      }],
      conflicts: [],
      coverage: {
        minimumModelInputsComplete: true,
        criticalEvidenceComplete: false,
        missingFieldIds: ["net_retention"],
        blockingConflictIds: [],
        decisionCeiling: "Advance",
        underwritingStatus: "available",
        reasonCodes: ["MISSING_CRITICAL_EVIDENCE"],
      },
      createdAt: "2026-07-29T12:00:00.000Z",
    },
    context: {
      id: "context_1",
      contextVersion: "1",
      stage: "seed",
      businessModel: "b2b_saas",
      geography: "us",
      securityType: "preferred",
      asOfDate: "2026-07-29",
      criticalEvidenceProfileId: "critical_1",
      benchmarkPackId: null,
      benchmarkCompatibility: "unavailable",
      valuationMethodPolicyId: "valuation_1",
      decisionPolicyId: "decision_policy_1",
      frameworkPackId: "framework_1",
    },
    scenarioModel: {
      id: "scenario_1",
      candidateRunId: "candidate_1",
      formulaPolicyVersion: "valuation_1",
      scenarios: [],
      probabilityWeighted: false,
    },
    calculations: [{
      id: "calculation_1",
      analysisType: "calculation",
      formulaId: "venture_method",
      formulaVersion: "1",
      inputRefs: [{
        itemId: "fact_1",
        value: "18000000",
        type: "fact",
      }],
      output: "24000000",
      unit: "money",
      currency: "USD",
      period: null,
      roundingPolicy: "half_even_display_only",
      computedAt: "2026-07-29T12:00:00.000Z",
      status: "stale_benchmark",
    }],
    judgments: [{
      id: "judgment_1",
      analysisType: "framework_judgment",
      frameworkCardId: "core_growth_quality",
      frameworkVersion: "1",
      applicability: "applicable",
      conclusion: "supportive",
      supportEvidenceItemIds: ["fact_1"],
      counterEvidenceItemIds: [],
      unusedEvidenceItemIds: [],
      strongestSupport: "Carrier traction is source-backed.",
      strongestCounterargument: "Retention is unavailable.",
      unknowns: ["Net retention"],
      limitations: ["Management-reported source"],
      confidence: {
        sourceReliability: "medium",
        evidenceStrength: "medium",
        evidenceCoverage: "low",
        applicability: "high",
        judgment: "medium",
      },
      claimEdges: [{
        claimItemId: "judgment_1",
        dependencyItemId: "fact_1",
        dependencyType: "fact",
      }],
      frameworkMetadata: {
        packId: "named_advisory_pack_v1",
        packName: "Named advisory pack",
        packVersion: "2.3.0",
        sourceCatalogId: "named_advisory_sources_v1",
        researchCutoff: "2026-06-30",
        componentCardIds: ["PT-01"],
        components: [{
          frameworkId: "PT-01",
          version: "1.4.0",
          name: "Contrarian Monopoly Lens",
          attribution: {
            display: "Based on Peter Thiel public works",
          },
          sourceRefs: [{
            sourceId: "source_pt_1",
            claimIds: ["claim_monopoly"],
            locator: {
              kind: "chapter_page",
              value: "Chapter 3, p. 25",
            },
            attributionScope: "person_direct",
            supportType: "primary",
          }],
        }],
        sources: [{
          sourceId: "source_pt_1",
          title: "Peter Thiel public source",
          authorOrSpeaker: ["Peter Thiel", "Blake Masters"],
          publisher: "Public Publisher",
          sourceClass: "A1",
          sourceType: "book",
          url: "https://example.test/peter-thiel-source",
          edition: "First public edition",
          publishedAt: "2014-09-16",
          eventAt: null,
          accessedAt: "2026-06-30",
          language: "English",
          rightsStatus: "public_source_paraphrase",
          attributionScope: "person_direct",
          attributionNotes: "Public-source paraphrase only.",
          immutableRevision: {
            status: "verified",
            hashAlgorithm: "sha256",
            contentHash: "sha256:source-content",
            reviewedPdfPages: [25],
          },
        }],
        formalDecisionWeight: "0",
      },
      fingerprint: "sha256:judgment",
    }],
    disagreements: [{
      id: "disagreement_1",
      leftJudgmentId: "judgment_1",
      rightJudgmentId: "judgment_2",
      topic: "company_quality_vs_price",
      explanation: "Quality support conflicts with price uncertainty.",
      evidenceItemIds: ["fact_1"],
    }],
    valuation: {
      id: "valuation_result_1",
      status: "partial",
      scenarios: [
        {
          name: "bear",
          valuation: null,
          calculationIds: [],
        },
        {
          name: "base",
          valuation: "24000000",
          calculationIds: ["calculation_1"],
        },
        {
          name: "bull",
          valuation: null,
          calculationIds: [],
        },
      ],
      currentAsk: "18000000",
      maximumAcceptablePreMoney: "24000000",
      initialOwnership: "0.10",
      postDilutionOwnership: "0.075",
      grossMoic: "4",
      grossIrr: null,
      pricingPremium: "-0.25",
      calculationIds: ["calculation_1"],
      blockerCodes: ["IRR_UNAVAILABLE"],
    },
    decision: {
      id: "decision_1",
      analysisType: "final_synthesis",
      companyQuality: "pass",
      priceAttractiveness: "mixed",
      fundFit: "pass",
      decision: "Advance",
      decisionCeiling: "Advance",
      hardVeto: false,
      firedRules: [{
        ruleId: "rule_1",
        inputRefs: ["calculation_1"],
        result: "pass",
        appliedCeiling: "Advance",
        veto: false,
      }],
      blockingEvidenceItemIds: ["net_retention"],
      claimEdges: [{
        claimItemId: "decision_1",
        dependencyItemId: "judgment_1",
        dependencyType: "framework_judgment",
      }],
      confidence: "medium",
    },
    narrative: "Source-grounded diligence supports an Advance, not an investment approval.",
    claimEdges: [
      {
        claimItemId: "calculation_1",
        dependencyItemId: "fact_1",
        dependencyType: "fact" as const,
      },
      {
        claimItemId: "judgment_1",
        dependencyItemId: "fact_1",
        dependencyType: "fact" as const,
      },
      {
        claimItemId: "decision_1",
        dependencyItemId: "judgment_1",
        dependencyType: "framework_judgment" as const,
      },
    ],
    sourceRevisionIds: ["revision_1"],
    versionSnapshot: {
      fundPolicyId: "policy_v2",
      benchmarkPackId: null,
      benchmarkEntryId: null,
      benchmarkDefinitionFingerprint: null,
      frameworkPackId: "framework_1",
      frameworkPackDefinitionFingerprint: "sha256:framework",
      routerVersion: "router-v1",
      criticalEvidenceProfileId: "critical_1",
      criticalEvidenceProfileDefinitionFingerprint: "sha256:critical",
      valuationMethodPolicyId: "valuation_1",
      valuationMethodPolicyDefinitionFingerprint: "sha256:valuation",
      decisionPolicyId: "decision_policy_1",
      decisionPolicyDefinitionFingerprint: "sha256:decision",
      referenceCatalogFingerprint: "sha256:catalog",
      frameworkCatalogVersion: "framework-catalog-v7",
      frameworkCatalogFingerprint: "sha256:framework-catalog",
      frameworkCorpusDigest: "sha256:framework-corpus",
      formulaVersions: ["venture_method@1"],
      providerModel: "private-provider-model",
      promptVersion: "private-prompt-version",
      schemaVersion: "schema-v1",
      settingsFingerprint: "private-settings-fingerprint",
      applicationCommit: "private-application-commit",
    },
  } as unknown as CandidateUnderwritingDetail;
}

function awaitImportPriorityResult() {
  return (
    pageCompanyIntelligenceModule as unknown as {
      PriorityResult: ComponentType<{
        analysis: ReturnType<typeof priorityAnalysisFixture>;
        onOpenBrief(): void;
        showDemoProfiles: boolean;
      }>;
    }
  ).PriorityResult;
}

function priorityAnalysisFixture() {
  return {
    id: "analysis_product",
    reportId: "report_product",
    runId: "11111111-1111-4111-8111-111111111111",
    dealId: "deal_1906",
    companyName: "Persisted Company",
    dealStatus: "screening" as const,
    outcome: "monitor" as const,
    confidence: "medium" as const,
    score: 0.5,
    verifiedSourceCount: 1,
    investmentMemory: {
      previousMeetingSummary: "Persisted meeting.",
      decisionReason: "Persisted reason.",
      concerns: [],
      revisitConditions: [],
      lastEvaluatedAt: null,
      memoryIds: [],
      sourceIds: ["source_1"],
      fixtureIds: [],
    },
    marketEvidence: {
      relationship: "related" as const,
      explanation: "Persisted evidence.",
      eventIds: [],
      events: [],
      sourceIds: ["source_1"],
    },
    implications: { positive: [], negative: [] },
    recommendedNextMove: "Review persisted evidence.",
    companyBrief: {
      icSnapshot: [],
      traction: [],
      dealTerms: [],
      risks: [],
      decisionHistory: [],
      sourceLineage: [],
    },
    sources: [{
      id: "source_1",
      provenance: "source_document" as const,
      title: "Persisted source",
      documentId: "revision_primary",
      excerpt: "Persisted evidence.",
    }],
    createdAt: "2026-07-29T12:00:00.000Z",
  };
}
