import {
  CompanyAnalysisSchema,
  type CompanyAnalysis,
} from "../../lib/contracts/domain";
import type {
  IntelligenceReportWrite,
} from "../../db/repositories/intelligence";
import { WritableSourceRefV2Schema } from "../../lib/contracts/source-evidence";
import { normalizedSourceV2 } from "./source-evidence-v2";

interface CanonicalReportFixtureInput {
  id: string;
  workspaceId: string;
  runId: string;
  createdAt: string;
  marketSummary: string;
  dealIds?: readonly string[];
}

export function canonicalIntelligenceReportFixture(
  input: CanonicalReportFixtureInput,
): IntelligenceReportWrite {
  const companyAnalyses = (input.dealIds ?? []).map((dealId) =>
    noChangeCompanyAnalysis({
      reportId: input.id,
      runId: input.runId,
      dealId,
      createdAt: input.createdAt,
    })
  );
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    runId: input.runId,
    createdAt: input.createdAt,
    marketSummary: input.marketSummary,
    opportunities: [],
    companyAnalyses,
    eligibleDealCount: companyAnalyses.length,
    eligibleSnapshotFingerprint: `sha256:${"e".repeat(64)}`,
  };
}

function noChangeCompanyAnalysis(input: {
  reportId: string;
  runId: string;
  dealId: string;
  createdAt: string;
}): CompanyAnalysis {
  const source = WritableSourceRefV2Schema.parse(normalizedSourceV2(
    `source_${input.reportId}_${input.dealId}`,
    {
      title: "Canonical report fixture source",
      canonicalUrl:
        `https://example.test/reports/${encodeURIComponent(input.reportId)}/${encodeURIComponent(input.dealId)}`,
      publisher: "Canonical report fixture",
      providerId: "canonical-report-fixture",
      publishedAt: input.createdAt,
      publishedAtPrecision: "timestamp",
      retrievedAt: input.createdAt,
      retrievedAtPrecision: "timestamp",
      entityKeys: [],
      evidenceRole: "context",
      text: {
        status: "normalized_only",
        normalizedStatement:
          `Canonical report fixture evidence for ${input.dealId}.`,
      },
    },
  ));
  return CompanyAnalysisSchema.parse({
    id: `${input.reportId}:analysis:${input.dealId}`,
    reportId: input.reportId,
    runId: input.runId,
    dealId: input.dealId,
    companyName: input.dealId,
    dealStatus: "screening",
    outcome: "no_material_change",
    confidence: "low",
    score: 0,
    verifiedSourceCount: 1,
    investmentMemory: {
      previousMeetingSummary: "No previous meeting summary was recorded.",
      decisionReason: "No previous decision reason was recorded.",
      concerns: [],
      revisitConditions: [],
      lastEvaluatedAt: null,
      memoryIds: [],
      sourceIds: [source.id],
      fixtureIds: [],
    },
    marketEvidence: {
      relationship: "none",
      explanation:
        "No material market evidence matched this company during the current 14-day scan.",
      eventIds: [],
      events: [],
      sourceIds: [],
    },
    implications: { positive: [], negative: [] },
    recommendedNextMove: "No immediate follow-up recommended. Continue monitoring.",
    companyBrief: {
      icSnapshot: [],
      traction: [],
      dealTerms: [],
      risks: [],
      decisionHistory: [],
      sourceLineage: [source],
    },
    sources: [source],
    createdAt: input.createdAt,
  });
}
