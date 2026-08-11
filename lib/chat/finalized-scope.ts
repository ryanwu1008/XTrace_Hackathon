import type {
  CandidateArtifactBundle,
  UnderwritingArtifactsRepository,
} from "../../db/repositories/underwriting-artifacts";
import type {
  UnderwritingRunsRepository,
} from "../../db/repositories/underwriting-runs";
import type { CompanyAnalysis } from "../contracts/domain";
import {
  CurrentReportEvidenceContextV1Schema,
  CurrentRunEvidenceContextV1Schema,
} from "../contracts/evidence-context";
import type {
  CandidateRun,
  UnderwritingBatch,
} from "../contracts/underwriting";
import type {
  ResolvedReportEvidenceScope,
} from "../reports/evidence-scope";
import {
  resolveUnderwritingPresentationAdapter,
  type UnderwritingPresentationAdapter,
} from "../underwriting/presentation-version";

type FinalizedScopeRunsReader = Pick<
  UnderwritingRunsRepository,
  "getBatchByScanRunId" | "listCandidatesForBatch"
>;

type FinalizedScopeArtifactsReader = Pick<
  UnderwritingArtifactsRepository,
  "getByCandidateRunId"
>;

export type FinalizedChatScopeInsufficientReason =
  | "workspace_mismatch"
  | "report_run_mismatch"
  | "run_not_terminal"
  | "evidence_context_mismatch"
  | "analysis_identity_mismatch"
  | "deal_unresolved"
  | "deal_scope_mismatch"
  | "deal_not_in_report"
  | "batch_identity_mismatch"
  | "batch_not_terminal"
  | "candidate_scope_mismatch"
  | "candidate_identity_mismatch"
  | "artifact_missing"
  | "artifact_identity_mismatch";

export interface ReadyFinalizedChatScope {
  status: "ready";
  scope: ResolvedReportEvidenceScope;
  dealId: string;
  analysis: CompanyAnalysis;
  candidate: CandidateRun | null;
  bundle: CandidateArtifactBundle | null;
  presentationAdapter: UnderwritingPresentationAdapter | null;
}

export interface InsufficientFinalizedChatScope {
  status: "insufficient_evidence";
  reason: FinalizedChatScopeInsufficientReason;
  message: string;
  scope: ResolvedReportEvidenceScope;
  dealId: string | null;
}

export type FinalizedChatScopeLoadResult =
  | ReadyFinalizedChatScope
  | InsufficientFinalizedChatScope;

const REASON_MESSAGES: Record<
  FinalizedChatScopeInsufficientReason,
  string
> = {
  workspace_mismatch:
    "The finalized report scope does not belong to this workspace.",
  report_run_mismatch:
    "The finalized report and run do not match exactly.",
  run_not_terminal:
    "The report run is not terminal.",
  evidence_context_mismatch:
    "The report and run evidence contexts do not match exactly.",
  analysis_identity_mismatch:
    "A CompanyAnalysis does not belong to the exact report and run.",
  deal_unresolved:
    "The question does not identify exactly one company, Deal, or Deal status.",
  deal_scope_mismatch:
    "The requested Deal conflicts with the resolved report scope.",
  deal_not_in_report:
    "The requested Deal is not a CompanyAnalysis member of the report.",
  batch_identity_mismatch:
    "The underwriting batch does not belong to the exact report run.",
  batch_not_terminal:
    "The underwriting batch is not terminal.",
  candidate_scope_mismatch:
    "The candidate IDs do not equal the exact resolved report scope.",
  candidate_identity_mismatch:
    "A candidate does not belong to the exact batch, workspace, or Deal.",
  artifact_missing:
    "A completed candidate is missing its finalized artifacts.",
  artifact_identity_mismatch:
    "A finalized artifact bundle does not match its exact candidate identity.",
};

const STATUS_MENTIONS: ReadonlyArray<{
  status: CompanyAnalysis["dealStatus"];
  patterns: RegExp[];
}> = [
  { status: "screening", patterns: [/\bscreen(?:ing|ed)?\b/u] },
  { status: "watchlist", patterns: [/\bwatch\s*list\b/u] },
  {
    status: "evaluating",
    patterns: [
      /\bevaluating\s+(?:company|deal)\b/u,
      /\bstatus\s+(?:is\s+)?evaluating\b/u,
    ],
  },
  { status: "passed", patterns: [/\bpass(?:ed|ing)?\b/u] },
  {
    status: "invested",
    patterns: [
      /\binvested\s+(?:company|deal)\b/u,
      /\bstatus\s+(?:is\s+)?invested\b/u,
    ],
  },
];

export async function loadExactFinalizedChatScope(input: {
  workspaceId: string;
  scope: ResolvedReportEvidenceScope;
  question: string;
  dealId?: string | null;
  underwritingRuns: FinalizedScopeRunsReader;
  artifacts: FinalizedScopeArtifactsReader;
}): Promise<FinalizedChatScopeLoadResult> {
  const { scope } = input;
  const insufficient = (
    reason: FinalizedChatScopeInsufficientReason,
    dealId: string | null = effectiveRequestedDeal(input),
  ): InsufficientFinalizedChatScope => ({
    status: "insufficient_evidence",
    reason,
    message: REASON_MESSAGES[reason],
    scope,
    dealId,
  });

  if (
    scope.report.workspaceId !== input.workspaceId
    || scope.run.workspaceId !== input.workspaceId
  ) {
    return insufficient("workspace_mismatch");
  }
  if (
    scope.report.runId !== scope.run.id
    || scope.report.workspaceId !== scope.run.workspaceId
  ) {
    return insufficient("report_run_mismatch");
  }
  if (!isTerminalReportRun(scope.run.status)) {
    return insufficient("run_not_terminal");
  }
  if (!evidenceContextsMatch(scope)) {
    return insufficient("evidence_context_mismatch");
  }

  const analyses = scope.report.companyAnalyses;
  const analysisByDeal = new Map<string, CompanyAnalysis>();
  for (const analysis of analyses) {
    if (
      analysis.reportId !== scope.report.id
      || analysis.runId !== scope.run.id
      || analysisByDeal.has(analysis.dealId)
    ) {
      return insufficient("analysis_identity_mismatch");
    }
    analysisByDeal.set(analysis.dealId, analysis);
  }

  const inputDealId = cleanOptionalId(input.dealId);
  const scopeDealId = cleanOptionalId(scope.dealId);
  if (inputDealId !== null && scopeDealId !== null && inputDealId !== scopeDealId) {
    return insufficient("deal_scope_mismatch", inputDealId);
  }
  const requestedDealId = inputDealId
    ?? scopeDealId
    ?? resolveQuestionDeal(input.question, analyses);
  if (requestedDealId === null) {
    return insufficient("deal_unresolved", null);
  }
  const selectedAnalysis = analysisByDeal.get(requestedDealId);
  if (!selectedAnalysis) {
    return insufficient("deal_not_in_report", requestedDealId);
  }

  const batch = await input.underwritingRuns.getBatchByScanRunId({
    workspaceId: input.workspaceId,
    scanRunId: scope.run.id,
  });
  if (!batch) {
    if (scope.candidateRunIds.length !== 0) {
      return insufficient("batch_identity_mismatch", requestedDealId);
    }
    return ready(scope, selectedAnalysis, null, null, null);
  }
  const batchFailure = validateBatch(batch, scope, input.workspaceId);
  if (batchFailure) return insufficient(batchFailure, requestedDealId);

  const candidates = await input.underwritingRuns.listCandidatesForBatch({
    workspaceId: input.workspaceId,
    batchId: batch.id,
  });
  const candidateFailure = validateCandidateScope({
    candidates,
    batch,
    scope,
    workspaceId: input.workspaceId,
    analysisByDeal,
  });
  if (candidateFailure) return insufficient(candidateFailure, requestedDealId);

  const candidateById = new Map(candidates.map((value) => [value.id, value]));
  const bundleByRequestedCandidateId = new Map<
    string,
    CandidateArtifactBundle | null
  >();
  const adapterByRequestedCandidateId = new Map<
    string,
    UnderwritingPresentationAdapter | null
  >();
  for (const candidateRunId of scope.candidateRunIds) {
    const candidate = candidateById.get(candidateRunId)!;
    const loaded = await input.artifacts.getByCandidateRunId({
      workspaceId: input.workspaceId,
      candidateRunId,
    });
    if (["completed", "partial"].includes(candidate.status) && !loaded) {
      return insufficient("artifact_missing", requestedDealId);
    }
    if (!["completed", "partial"].includes(candidate.status) && loaded) {
      return insufficient("artifact_identity_mismatch", requestedDealId);
    }
    if (loaded) {
      const identityFailure = validateArtifactIdentity({
        candidate,
        analysis: analysisByDeal.get(candidate.dealId)!,
        bundle: loaded,
        workspaceId: input.workspaceId,
      });
      if (identityFailure) {
        return insufficient(identityFailure, requestedDealId);
      }
      const adapter = resolveUnderwritingPresentationAdapter({
        report: scope.report,
        requestedDealId: candidate.dealId,
        candidate: {
          id: candidate.id,
          workspaceId: candidate.workspaceId,
          dealId: candidate.dealId,
          artifactSourceCandidateRunId:
            candidate.artifactSourceCandidateRunId ?? null,
        },
        bundle: loaded,
      });
      adapterByRequestedCandidateId.set(candidateRunId, adapter);
    } else {
      adapterByRequestedCandidateId.set(candidateRunId, null);
    }
    bundleByRequestedCandidateId.set(candidateRunId, loaded);
  }

  const selectedCandidates = candidates.filter((value) =>
    value.dealId === requestedDealId
  );
  if (selectedCandidates.length > 1) {
    return insufficient("candidate_identity_mismatch", requestedDealId);
  }
  const selectedCandidate = selectedCandidates[0] ?? null;
  const selectedBundle = selectedCandidate
    ? bundleByRequestedCandidateId.get(selectedCandidate.id) ?? null
    : null;
  const selectedAdapter = selectedCandidate
    ? adapterByRequestedCandidateId.get(selectedCandidate.id) ?? null
    : null;
  return ready(
    scope,
    selectedAnalysis,
    selectedCandidate,
    selectedBundle,
    selectedAdapter,
  );
}

function ready(
  scope: ResolvedReportEvidenceScope,
  analysis: CompanyAnalysis,
  candidate: CandidateRun | null,
  bundle: CandidateArtifactBundle | null,
  presentationAdapter: UnderwritingPresentationAdapter | null,
): ReadyFinalizedChatScope {
  return {
    status: "ready",
    scope,
    dealId: analysis.dealId,
    analysis,
    candidate,
    bundle,
    presentationAdapter,
  };
}

function effectiveRequestedDeal(input: {
  dealId?: string | null;
  scope: ResolvedReportEvidenceScope;
}): string | null {
  return cleanOptionalId(input.dealId) ?? cleanOptionalId(input.scope.dealId);
}

function cleanOptionalId(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : null;
}

function isTerminalReportRun(status: string): boolean {
  return status === "completed" || status === "partial";
}

function evidenceContextsMatch(scope: ResolvedReportEvidenceScope): boolean {
  const runContext = scope.run.evidenceContext;
  const reportContext = scope.report.evidenceContext
    ?? { state: "legacy_unbound" as const };
  if (runContext.state !== reportContext.state) return false;
  if (runContext.state === "legacy_unbound") return true;
  if (reportContext.state !== "current") return false;
  const parsedRun = CurrentRunEvidenceContextV1Schema.safeParse(runContext);
  const parsedReport = CurrentReportEvidenceContextV1Schema.safeParse(
    reportContext,
  );
  if (!parsedRun.success || !parsedReport.success) return false;
  const report = parsedReport.data;
  const run = parsedRun.data;
  return report.evidenceMode === run.evidenceMode
    && report.windowDays === run.windowDays
    && report.anchorAt === run.anchorAt
    && report.windowStartAt === run.windowStartAt
    && report.windowEndAt === run.windowEndAt
    && report.windowTimezone === run.windowTimezone
    && report.snapshotId === run.snapshotId
    && report.snapshotFingerprint === run.snapshotFingerprint
    && report.contextFingerprint === run.contextFingerprint;
}

function resolveQuestionDeal(
  question: string,
  analyses: readonly CompanyAnalysis[],
): string | null {
  const normalizedQuestion = normalizeMention(question);
  if (!normalizedQuestion) return null;
  const explicitlyMentioned = analyses.filter((analysis) =>
    phraseIsMentioned(normalizedQuestion, analysis.companyName)
    || phraseIsMentioned(normalizedQuestion, analysis.dealId)
  );
  const uniqueExplicit = uniqueDeals(explicitlyMentioned);
  if (uniqueExplicit.length > 0) {
    return uniqueExplicit.length === 1 ? uniqueExplicit[0]!.dealId : null;
  }

  const normalizedStatusQuestion = question.normalize("NFKC").toLowerCase();
  const mentionedStatuses = new Set(
    STATUS_MENTIONS.filter(({ patterns }) =>
      patterns.some((pattern) => pattern.test(normalizedStatusQuestion))
    ).map(({ status }) => status),
  );
  const statusMatches = uniqueDeals(
    analyses.filter(({ dealStatus }) => mentionedStatuses.has(dealStatus)),
  );
  return statusMatches.length === 1 ? statusMatches[0]!.dealId : null;
}

function uniqueDeals(
  analyses: readonly CompanyAnalysis[],
): CompanyAnalysis[] {
  return [...new Map(analyses.map((value) => [value.dealId, value])).values()];
}

function normalizeMention(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function phraseIsMentioned(
  normalizedQuestion: string,
  candidate: string,
): boolean {
  const normalizedCandidate = normalizeMention(candidate);
  return normalizedCandidate.length > 0
    && ` ${normalizedQuestion} `.includes(` ${normalizedCandidate} `);
}

function validateBatch(
  batch: UnderwritingBatch,
  scope: ResolvedReportEvidenceScope,
  workspaceId: string,
): FinalizedChatScopeInsufficientReason | null {
  if (
    batch.workspaceId !== workspaceId
    || batch.scanRunId !== scope.run.id
  ) {
    return "batch_identity_mismatch";
  }
  return ["completed", "partial", "failed"].includes(batch.status)
    ? null
    : "batch_not_terminal";
}

function validateCandidateScope(input: {
  candidates: readonly CandidateRun[];
  batch: UnderwritingBatch;
  scope: ResolvedReportEvidenceScope;
  workspaceId: string;
  analysisByDeal: ReadonlyMap<string, CompanyAnalysis>;
}): FinalizedChatScopeInsufficientReason | null {
  const seenCandidateIds = new Set<string>();
  const seenDeals = new Set<string>();
  for (const candidate of input.candidates) {
    if (
      seenCandidateIds.has(candidate.id)
      || seenDeals.has(candidate.dealId)
      || candidate.batchId !== input.batch.id
      || candidate.workspaceId !== input.workspaceId
      || !input.analysisByDeal.has(candidate.dealId)
      || !["completed", "partial", "unavailable", "failed"].includes(
        candidate.status,
      )
      || candidate.finalizedAt === null
    ) {
      return "candidate_identity_mismatch";
    }
    seenCandidateIds.add(candidate.id);
    seenDeals.add(candidate.dealId);
  }
  const scopedCandidates = input.candidates
    .filter((value) =>
      input.scope.dealId === null || value.dealId === input.scope.dealId
    )
    .map(({ id }) => id)
    .sort();
  const requestedCandidates = [...input.scope.candidateRunIds].sort();
  if (
    new Set(input.scope.candidateRunIds).size
      !== input.scope.candidateRunIds.length
    || scopedCandidates.length !== requestedCandidates.length
    || scopedCandidates.some((value, index) =>
      value !== requestedCandidates[index]
    )
  ) {
    return "candidate_scope_mismatch";
  }
  return null;
}

function validateArtifactIdentity(input: {
  candidate: CandidateRun;
  analysis: CompanyAnalysis;
  bundle: CandidateArtifactBundle;
  workspaceId: string;
}): FinalizedChatScopeInsufficientReason | null {
  const expectedSourceCandidateRunId =
    input.candidate.artifactSourceCandidateRunId ?? input.candidate.id;
  if (
    input.bundle.candidateRunId !== input.candidate.id
    || input.bundle.sourceCandidateRunId !== expectedSourceCandidateRunId
    || input.bundle.workspaceId !== input.workspaceId
    || input.bundle.dealId !== input.candidate.dealId
    || input.bundle.dealId !== input.analysis.dealId
    || input.bundle.candidateAnalysisFingerprint
      !== input.candidate.candidateAnalysisFingerprint
    || (
      input.bundle.versionSnapshot.dealStatus !== undefined
      && input.bundle.versionSnapshot.dealStatus !== input.analysis.dealStatus
    )
  ) {
    return "artifact_identity_mismatch";
  }
  return null;
}
