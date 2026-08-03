import assert from "node:assert/strict";
import test from "node:test";

import type { RunRecord } from "../../db/client";
import type { IntelligenceReportRecord } from "../../db/repositories/intelligence";
import { resolveReportEvidenceScope } from "../../lib/reports/evidence-scope";

function run(id: string, status: RunRecord["status"]): RunRecord {
  return {
    id,
    workspaceId: "workspace_1",
    mode: "structured",
    windowDays: 14,
    status,
    currentStage: null,
    warningCount: 0,
    warnings: [],
    workerId: null,
    createdAt: id === "run_new" ? "2026-08-02T00:00:00.000Z" : "2026-08-01T00:00:00.000Z",
    startedAt: null,
    completedAt: status === "running" ? null : "2026-08-01T01:00:00.000Z",
    leaseExpiresAt: null,
    evidenceContext: { state: "legacy_unbound" },
  };
}

function report(id: string, runId: string, createdAt: string): IntelligenceReportRecord {
  return {
    id,
    workspaceId: "workspace_1",
    runId,
    createdAt,
    marketSummary: id,
    opportunities: [],
    analysisStatus: "completed",
    evidenceCoverage: {
      acceptedPublicEvents: 0,
      excludedPublicItems: 0,
      truncatedPublicEvents: 0,
      recalledDealCount: 0,
      unavailableDealCount: 0,
    },
    counts: {
      companyCount: 0,
      beliefRevised: 0,
      monitor: 0,
      noMaterialChange: 0,
      analysisUnavailable: 0,
    },
    priorityDealId: null,
    companyAnalyses: [],
    evidenceContext: { state: "legacy_unbound" },
  };
}

test("latest report scope skips newer reports whose scan run is not terminal", async () => {
  const reports = [
    report("report_new", "run_new", "2026-08-02T00:00:00.000Z"),
    report("report_terminal", "run_terminal", "2026-08-01T00:00:00.000Z"),
  ];
  const runs = [run("run_new", "running"), run("run_terminal", "completed")];
  const resolved = await resolveReportEvidenceScope({
    workspaceId: "workspace_1",
    request: { kind: "latest_terminal" },
    intelligence: {
      listReports: async () => reports,
      getReport: async (_workspaceId, id) => reports.find((item) => item.id === id) ?? null,
    },
    runs: {
      list: async () => runs,
      get: async (_workspaceId, id) => runs.find((item) => item.id === id) ?? null,
    },
  });
  assert.equal(resolved.report.id, "report_terminal");
  assert.equal(resolved.run.id, "run_terminal");
});

test("explicit report scope never falls back when reportId and runId do not match", async () => {
  const selectedReport = report("report_1", "run_1", "2026-08-01T00:00:00.000Z");
  await assert.rejects(
    resolveReportEvidenceScope({
      workspaceId: "workspace_1",
      request: { kind: "report", reportId: "report_1", runId: "run_other" },
      intelligence: {
        listReports: async () => [selectedReport],
        getReport: async () => selectedReport,
      },
      runs: {
        list: async () => [run("run_1", "completed")],
        get: async () => run("run_other", "completed"),
      },
    }),
    /report.*run.*match/i,
  );
});
