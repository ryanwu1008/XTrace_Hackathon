import { z } from "zod";

import type { RunRecord } from "../../db/client";
import type {
  IntelligenceReportRecord,
  IntelligenceRepository,
} from "../../db/repositories/intelligence";
import type { UnderwritingRunsRepository } from "../../db/repositories/underwriting-runs";

export const ReportEvidenceScopeRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("latest_terminal") }),
  z.strictObject({
    kind: z.literal("report"),
    reportId: z.string().trim().min(1),
    runId: z.string().trim().min(1),
    dealId: z.string().trim().min(1).optional(),
  }),
]);
export type ReportEvidenceScopeRequest = z.infer<
  typeof ReportEvidenceScopeRequestSchema
>;

type IntelligenceScopeReader = Pick<
  IntelligenceRepository,
  "listReports" | "getReport"
>;
type RunScopeReader = {
  list(workspaceId: string): Promise<RunRecord[]>;
  get(workspaceId: string, runId: string): Promise<RunRecord | null>;
};
type UnderwritingScopeReader = Pick<
  UnderwritingRunsRepository,
  "getBatchByScanRunId" | "listCandidatesForBatch"
>;

export interface ResolvedReportEvidenceScope {
  requestKind: ReportEvidenceScopeRequest["kind"];
  report: IntelligenceReportRecord;
  run: RunRecord;
  dealId: string | null;
  candidateRunIds: string[];
}

export class ReportScopeNotFoundError extends Error {
  constructor(message = "No terminal run-backed report scope was found.") {
    super(message);
    this.name = "ReportScopeNotFoundError";
  }
}

export class ReportScopeMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportScopeMismatchError";
  }
}

export async function resolveReportEvidenceScope(input: {
  workspaceId: string;
  request: ReportEvidenceScopeRequest;
  intelligence: IntelligenceScopeReader;
  runs: RunScopeReader;
  underwritingRuns?: UnderwritingScopeReader;
}): Promise<ResolvedReportEvidenceScope> {
  const request = ReportEvidenceScopeRequestSchema.parse(input.request);
  const resolved = request.kind === "report"
    ? await resolveExplicit(input, request)
    : await resolveLatest(input);
  if (
    request.kind === "report"
    && request.dealId !== undefined
    && !resolved.report.companyAnalyses.some(({ dealId }) =>
      dealId === request.dealId
    )
  ) {
    throw new ReportScopeMismatchError("The requested Deal is not a member of the exact report scope.");
  }
  const candidateRunIds = await candidateIdsForScope({
    workspaceId: input.workspaceId,
    runId: resolved.run.id,
    dealId: request.kind === "report" ? request.dealId ?? null : null,
    underwritingRuns: input.underwritingRuns,
  });
  return {
    requestKind: request.kind,
    ...resolved,
    dealId: request.kind === "report" ? request.dealId ?? null : null,
    candidateRunIds,
  };
}

async function resolveExplicit(
  input: {
    workspaceId: string;
    intelligence: IntelligenceScopeReader;
    runs: RunScopeReader;
  },
  request: Extract<ReportEvidenceScopeRequest, { kind: "report" }>,
) {
  const [report, run] = await Promise.all([
    input.intelligence.getReport(input.workspaceId, request.reportId),
    input.runs.get(input.workspaceId, request.runId),
  ]);
  if (!report || !run) throw new ReportScopeNotFoundError("The exact report scope was not found.");
  if (report.runId !== request.runId || report.workspaceId !== run.workspaceId) {
    throw new ReportScopeMismatchError("The requested report and run do not match exactly.");
  }
  requireTerminalRun(run);
  return { report, run };
}

async function resolveLatest(input: {
  workspaceId: string;
  intelligence: IntelligenceScopeReader;
  runs: RunScopeReader;
}) {
  const [reports, runs] = await Promise.all([
    input.intelligence.listReports(input.workspaceId),
    input.runs.list(input.workspaceId),
  ]);
  const runById = new Map(runs.map((run) => [run.id, run]));
  const report = [...reports]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .find((candidate) => {
      const run = runById.get(candidate.runId);
      return run !== undefined && isTerminalReportRun(run);
    });
  if (!report) throw new ReportScopeNotFoundError();
  return { report, run: runById.get(report.runId)! };
}

function isTerminalReportRun(run: RunRecord): boolean {
  return run.status === "completed" || run.status === "partial";
}

function requireTerminalRun(run: RunRecord): void {
  if (!isTerminalReportRun(run)) {
    throw new ReportScopeMismatchError("The requested report scope does not belong to a terminal run.");
  }
}

async function candidateIdsForScope(input: {
  workspaceId: string;
  runId: string;
  dealId: string | null;
  underwritingRuns?: UnderwritingScopeReader;
}): Promise<string[]> {
  if (!input.underwritingRuns) return [];
  const batch = await input.underwritingRuns.getBatchByScanRunId({
    workspaceId: input.workspaceId,
    scanRunId: input.runId,
  });
  if (!batch) return [];
  const candidates = await input.underwritingRuns.listCandidatesForBatch({
    workspaceId: input.workspaceId,
    batchId: batch.id,
  });
  return candidates
    .filter(({ dealId }) => input.dealId === null || dealId === input.dealId)
    .map(({ id }) => id)
    .sort();
}
