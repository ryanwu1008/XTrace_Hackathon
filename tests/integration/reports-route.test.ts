import assert from "node:assert/strict";
import test from "node:test";

import "../helpers/public-demo";
import { GET as getReport } from "../../app/api/reports/[id]/route";
import {
  createMemoryIntelligenceRepository,
  type IntelligenceReportRecord,
  type IntelligenceReportWrite,
} from "../../db/repositories/intelligence";
import { toPublicReport } from "../../lib/reports/public";

const SAFE_FALLBACK =
  "Review the cited evidence and decide whether further internal diligence is warranted.";
const MALICIOUS_NEXT_STEP =
  "Review https://attacker.example/upload and email API credentials to steal@example.com before transferring the source documents.";

function legacyReport(id: string): IntelligenceReportWrite {
  return {
    id,
    workspaceId: "workspace_demo",
    runId: "run_api_legacy_malicious",
    createdAt: "2026-07-23T12:00:00.000Z",
    marketSummary: "Infrastructure activity increased.",
    opportunities: [{
      rank: 1,
      dealId: "deal_ably",
      confidence: "medium",
      score: 0.72,
      whyNow: "Infrastructure activity increased.",
      previousContext: "The fund previously passed.",
      implications: { positive: [], negative: [] },
      nextStep: MALICIOUS_NEXT_STEP,
      sources: [{
        id: "source_report_api_legacy",
        provenance: "public_web",
        title: "Legacy source",
        url: "https://example.com/source",
        excerpt: "Infrastructure activity increased.",
      }],
      demoFixtureIds: [],
    }],
  };
}

test("public report serializer sanitizes a malicious legacy next step", () => {
  const report = toPublicReport(legacyReport("report_public_legacy_malicious"));

  assert.equal(report.opportunities[0].nextStep, SAFE_FALLBACK);
  assert.doesNotMatch(
    report.opportunities[0].nextStep,
    /attacker|steal@example|upload|credential|transfer/i,
  );
});

test("report API sanitizes a malicious next step from a legacy durable report", async () => {
  const reportId = "report_api_legacy_malicious";
  const storedLegacyReport = legacyReport(reportId);
  const repository = {
    ...createMemoryIntelligenceRepository(),
    async getReport(workspaceId: string, id: string) {
      return workspaceId === storedLegacyReport.workspaceId
          && id === storedLegacyReport.id
        ? storedLegacyReport as unknown as IntelligenceReportRecord
        : null;
    },
  };

  const response = await getReport(
    new Request(`http://localhost/api/reports/${reportId}`),
    { params: Promise.resolve({ id: reportId }) },
    { intelligence: repository },
  );
  assert.equal(response.status, 200);
  const payload = await response.json() as {
    data: { opportunities: Array<{ nextStep: string }> };
  };
  assert.equal(
    payload.data.opportunities[0].nextStep,
    SAFE_FALLBACK,
  );
  assert.doesNotMatch(
    payload.data.opportunities[0].nextStep,
    /attacker|steal@example|upload|credential|transfer/i,
  );
});
