import { errorResponse, jsonError, jsonOk } from "../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../lib/api/route-dependencies";
import { rateLimitRequest, requirePermission } from "../../../lib/api/safety";
import {
  getIntelligenceRepository,
  type IntelligenceReportRecord,
} from "../../../db/repositories/intelligence";
import { getDataClient } from "../../../db/client";
import { createRunsRepository } from "../../../db/repositories/runs";
import { getUnderwritingRunsRepository } from "../../../db/repositories/underwriting-runs";
import { getDealRegistry } from "../../../db/repositories/deal-registry";
import {
  createGroundedChatService,
  type ChatEvidence,
  type MemoryRecallOutcome,
} from "../../../lib/chat/service";
import { buildPersistedReportEvidence } from "../../../lib/chat/report-evidence";
import { createClaudeClient } from "../../../lib/claude/client";
import { ChatRequestSchema } from "../../../lib/contracts/http";
import {
  evidenceSourceText,
  type EvidenceSourceRef,
} from "../../../lib/contracts/domain";
import type { MarketEventV2 } from "../../../lib/contracts/source-evidence";
import {
  SAMPLE_DECISION_RECORD_LABEL,
  SAMPLE_DECISION_RECORD_PREFIX,
} from "../../../lib/contracts/source-evidence";
import {
  validateEvidenceSourceCatalog,
} from "../../../lib/contracts/evidence-catalog";
import { DEMO_DEAL_EVIDENCE } from "../../../lib/corpus/evidence";
import { DEMO_FIXTURES } from "../../../lib/corpus/fixtures";
import { getPreloadedDocument } from "../../../lib/corpus/manifest";
import {
  evidenceQueryTokens,
  searchDemoEvidence,
} from "../../../lib/demo/search";
import { buildDemoViewModel } from "../../../lib/demo/view-model";
import { interactionSourceV2 } from "../../../lib/matching/context";
import {
  getXTraceClient,
  isXTraceConfigured,
} from "../../../lib/xtrace/client";
import { createXTraceService } from "../../../lib/xtrace/service";
import {
  isDurableWorkspaceMode,
  type DeploymentMode,
} from "../../../lib/auth/request-context";
import {
  ReportScopeNotFoundError,
  resolveReportEvidenceScope,
} from "../../../lib/reports/evidence-scope";

export const dynamic = "force-dynamic";

export interface ScopedRecallSourceIndex {
  parentClaims: Map<string, Map<string, EvidenceSourceRef[]>>;
  fixtureClaims: Map<string, EvidenceSourceRef>;
}

export function buildScopedRecallSourceIndex(
  sources: readonly EvidenceSourceRef[],
  mode: DeploymentMode,
): ScopedRecallSourceIndex {
  const catalog = validateEvidenceSourceCatalog(
    [...sources],
    "Chat scoped recall source",
  );
  const parentClaims = new Map<string, Map<string, EvidenceSourceRef[]>>();
  const fixtureClaims = new Map<string, EvidenceSourceRef>();
  for (const source of catalog) {
    if (!isAllowedScopedChatSource(source, mode)) continue;
    if (source.provenance === "demo_fixture") {
      fixtureClaims.set(source.id, source);
      continue;
    }
    if (
      !("schemaVersion" in source)
      || source.adaptation !== "canonical"
      || source.documentId === null
      || source.sourceRevisionId === null
    ) continue;
    const byRevision = parentClaims.get(source.documentId) ?? new Map();
    byRevision.set(source.sourceRevisionId, [
      ...(byRevision.get(source.sourceRevisionId) ?? []),
      source,
    ]);
    parentClaims.set(source.documentId, byRevision);
  }
  return { parentClaims, fixtureClaims };
}

export function resolveScopedRecallContextSources(
  index: ScopedRecallSourceIndex,
  context: {
    provenance: EvidenceSourceRef["provenance"];
    sourceIds: readonly string[];
    sourceRevisionIds?: readonly string[];
    fixtureIds: readonly string[];
  },
  mode: DeploymentMode,
): EvidenceSourceRef[] {
  if (
    mode === "product"
    && (context.provenance === "demo_fixture" || context.fixtureIds.length > 0)
  ) return [];
  const revisions = context.sourceRevisionIds ?? [];
  const resolved: EvidenceSourceRef[] = [];
  const matchedRevisions = new Set<string>();
  for (const documentId of context.sourceIds) {
    const byRevision = index.parentClaims.get(documentId);
    const claims = revisions.flatMap((revisionId) => {
      const revisionClaims = byRevision?.get(revisionId) ?? [];
      if (revisionClaims.length > 0) matchedRevisions.add(revisionId);
      return revisionClaims;
    });
    if (claims.length === 0) return [];
    resolved.push(...claims);
  }
  if (matchedRevisions.size !== new Set(revisions).size) return [];
  for (const fixtureId of context.fixtureIds) {
    const fixture = index.fixtureClaims.get(fixtureId);
    if (!fixture || mode !== "public_sandbox") return [];
    resolved.push(fixture);
  }
  if (context.sourceIds.length === 0 && context.fixtureIds.length === 0) {
    return [];
  }
  return [...new Map(resolved.map((source) => [source.id, source])).values()];
}

function isAllowedScopedChatSource(
  source: EvidenceSourceRef,
  mode: DeploymentMode,
): boolean {
  if (source.provenance !== "demo_fixture") return true;
  return mode === "public_sandbox"
    && "schemaVersion" in source
    && source.adaptation === "canonical"
    && source.title === SAMPLE_DECISION_RECORD_LABEL
    && source.providerId === "deal-registry"
    && source.sourceClass === "internal_decision_record"
    && source.sourceAuthority === "primary"
    && source.evidenceRole === "context"
    && source.text.status === "normalized_only"
    && source.text.normalizedStatement.startsWith(
      SAMPLE_DECISION_RECORD_PREFIX,
    );
}

function allDemoSources() {
  const candidates: EvidenceSourceRef[] = [];
  for (const evidence of DEMO_DEAL_EVIDENCE) {
    const document = getPreloadedDocument(evidence.documentId);
    if (!document) continue;
    candidates.push({
      id: evidence.id,
      provenance: evidence.provenance,
      title: document.title,
      documentId: evidence.documentId,
      page: evidence.page,
      excerpt: evidence.excerpt,
    });
  }
  for (const deal of buildDemoViewModel().deals) {
    const document = getPreloadedDocument(deal.documentId);
    if (!document) continue;
    candidates.push({
      id: `source_${deal.documentId}`,
      provenance: "source_document",
      title: document.title,
      documentId: deal.documentId,
      excerpt:
        `${document.title} is a supplied source document in the demo corpus.`,
    });
  }
  for (const fixture of DEMO_FIXTURES) {
    candidates.push(interactionSourceV2({
      ...fixture,
      summary: fixture.meetingSummary,
    }));
  }
  const sources = validateEvidenceSourceCatalog(candidates, "demo Chat source");
  return new Map(sources.map((source) => [source.id, source]));
}

export async function searchRuntimeIntelligence(
  question: string,
  report: IntelligenceReportRecord | null,
  mode: DeploymentMode,
  dealId: string | null = null,
): Promise<ChatEvidence[]> {
  const tokens = evidenceQueryTokens(question);
  if (!tokens.length || report === null) return [];
  const scopedAnalyses = report.companyAnalyses.filter((analysis) =>
    dealId === null || analysis.dealId === dealId
  );
  const scopedReport = { ...report, companyAnalyses: scopedAnalyses };
  const events = scopedAnalyses.flatMap((analysis) =>
    analysis.marketEvidence.events
  ).filter((event): event is MarketEventV2 =>
    "schemaVersion" in event && "sources" in event
  );
  validateEvidenceSourceCatalog([
    ...events.flatMap((event): EvidenceSourceRef[] => [...event.sources]),
    ...scopedReport.opportunities.flatMap((opportunity) => opportunity.sources),
    ...scopedAnalyses.flatMap((analysis) => analysis.sources),
  ], "runtime Chat authority source");
  const eventEvidence = events.flatMap((event) => {
    const sources = mode === "product"
      ? event.sources.filter((source) =>
        source.provenance !== "demo_fixture"
      )
      : event.sources;
    if (sources.length === 0) return [];
    const haystack = [
      event.title,
      event.summary,
      event.eventType,
      ...event.sectors,
      ...event.themes,
    ].join(" ").toLocaleLowerCase();
    const searchableTokens = new Set(evidenceQueryTokens(haystack));
    if (!tokens.every((token) => searchableTokens.has(token))) return [];
    return [{
      text: `${event.title}. ${event.summary}`,
      sources,
    }];
  });
  const companyByDeal = mode === "product"
    ? new Map<string, string>()
    : new Map(
        buildDemoViewModel().deals.map((deal) => [deal.id, deal.companyName]),
      )
  const searchableReports = mode === "product"
    ? [{
        ...scopedReport,
        opportunities: scopedReport.opportunities.filter(
          isProductOpportunityEvidence,
        ),
        companyAnalyses: scopedAnalyses.filter(
          isProductCompanyAnalysisEvidence,
        ),
      }]
    : [scopedReport];
  const reportEvidence = buildPersistedReportEvidence({
    question,
    reports: searchableReports,
    companyByDeal,
  });
  const runtimeEvidence = [...eventEvidence, ...reportEvidence];
  validateEvidenceSourceCatalog(
    runtimeEvidence.flatMap((item) => item.sources),
    "runtime Chat source",
  );
  return runtimeEvidence.slice(0, 12);
}

function hasDemoFixtureSource(sources: readonly EvidenceSourceRef[]): boolean {
  return sources.some((source) => source.provenance === "demo_fixture");
}

function isProductOpportunityEvidence(
  opportunity: {
    demoFixtureIds: readonly string[];
    sources: readonly EvidenceSourceRef[];
  },
): boolean {
  return opportunity.demoFixtureIds.length === 0
    && !hasDemoFixtureSource(opportunity.sources);
}

function isProductCompanyAnalysisEvidence(
  analysis: {
    investmentMemory: { fixtureIds: readonly string[] };
    sources: readonly EvidenceSourceRef[];
  },
): boolean {
  return analysis.investmentMemory.fixtureIds.length === 0
    && !hasDemoFixtureSource(analysis.sources);
}

async function productMemoryScope(
  report: IntelligenceReportRecord,
  dealId: string,
  mode: DeploymentMode,
): Promise<{
  sourceIndex: ScopedRecallSourceIndex;
  candidateDealIds: string[];
}> {
  validateEvidenceSourceCatalog(
    [
      ...report.opportunities.flatMap((opportunity) => opportunity.sources),
      ...report.companyAnalyses.flatMap((analysis) => analysis.sources),
    ],
    "Chat memory authority source",
  );
  const durableSourceCandidates: EvidenceSourceRef[] = [];
  const dealIds = new Set<string>();
  const addDurableDealSources = (
    dealId: string,
    sources: readonly EvidenceSourceRef[],
  ) => {
    const durableSources = sources.filter((source) =>
      isAllowedScopedChatSource(source, mode)
    );
    if (durableSources.length === 0) return;
    dealIds.add(dealId);
    durableSourceCandidates.push(...durableSources);
  };
  for (const opportunity of report.opportunities) {
      if (opportunity.dealId !== dealId) continue;
      if (mode === "product" && !isProductOpportunityEvidence(opportunity)) continue;
      addDurableDealSources(opportunity.dealId, opportunity.sources);
  }
  for (const analysis of report.companyAnalyses) {
      if (analysis.dealId !== dealId) continue;
      if (mode === "product" && !isProductCompanyAnalysisEvidence(analysis)) continue;
      addDurableDealSources(analysis.dealId, analysis.sources);
  }
  const durableSources = validateEvidenceSourceCatalog(
    durableSourceCandidates,
    "Chat durable source",
  );
  return {
    sourceIndex: buildScopedRecallSourceIndex(durableSources, mode),
    candidateDealIds: [...dealIds],
  };
}

async function recallExistingMemory(
  question: string,
  workspaceId: string,
  mode: DeploymentMode,
  report: IntelligenceReportRecord | null,
  runId: string | null,
  dealId: string | null,
  evidenceContextFingerprint: string | null,
  activeParentFingerprint: string | null,
): Promise<MemoryRecallOutcome> {
  if (!isXTraceConfigured()) {
    return { status: "unavailable" };
  }
  if (mode !== "public_demo" && (!report || !runId || !dealId)) {
    return { status: "unavailable" };
  }
  const scope = isDurableWorkspaceMode(mode) && report && dealId
    ? await productMemoryScope(report, dealId, mode)
    : {
        sourceIndex: null,
        candidateDealIds: buildDemoViewModel().deals.map((deal) => deal.id),
      };
  if (scope.candidateDealIds.length === 0) return { status: "unavailable" };
  const service = createXTraceService(getXTraceClient({
    stage: "explicit_recall",
    allowLive: true,
  }), {
    workspaceId,
  });
  try {
    const contexts = await service.recallDealContext({
      workspaceId,
      runId: runId ?? undefined,
      query: question,
      candidateDealIds: dealId === null
        ? scope.candidateDealIds
        : [dealId],
      limit: 8,
      evidenceContextFingerprint: evidenceContextFingerprint ?? undefined,
      activeParentFingerprint: activeParentFingerprint ?? undefined,
    });
    const evidence = contexts.flatMap((context) => {
      if (
        mode === "product"
        && (
          context.fixtureIds.length > 0
          || context.provenance === "demo_fixture"
        )
      ) {
        return [];
      }
      const sources = isDurableWorkspaceMode(mode) && scope.sourceIndex
        ? resolveScopedRecallContextSources(
            scope.sourceIndex,
            context,
            mode,
          )
        : [...context.sourceIds, ...context.fixtureIds].flatMap((sourceId) => {
            const source = allDemoSources().get(sourceId);
            return source ? [source] : [];
          });
      return sources.map((source) => ({
        text: evidenceSourceText(source),
        sources: [source],
      }));
    });
    return { status: "available", evidence };
  } catch {
    return { status: "unavailable" };
  }
}

function deterministicCompletion(prompt: string) {
  const parsed = JSON.parse(prompt) as {
    question: string;
    evidence: Array<{ text: string; sourceIds: string[] }>;
  };
  const normalizedQuestion = parsed.question.trim().toLocaleLowerCase();
  const questionTokens = evidenceQueryTokens(parsed.question);
  const evidence = parsed.evidence.find((item) =>
    item.text.toLocaleLowerCase().includes(normalizedQuestion)
  ) ?? parsed.evidence
    .map((item) => ({
      item,
      score: questionTokens.filter((token) =>
        evidenceQueryTokens(`${item.text} ${item.sourceIds.join(" ")}`)
          .includes(token)
      ).length,
    }))
    .sort((left, right) => right.score - left.score)[0]?.item;
  return JSON.stringify({
    claims: evidence ? [{
      text: evidence.text,
      sourceIds: evidence.sourceIds,
    }] : [],
    insufficientEvidence: !evidence,
  });
}

export async function POST(
  request: Request,
  _routeContext?: unknown,
  dependencies: RouteDependencies = {},
) {
  try {
    const context = await resolveRouteRequestContext(request, dependencies);
    requirePermission(context, "readWorkspace");
    const rate = await rateLimitRequest(
      request,
      "chat",
      20,
      undefined,
      { context },
    );
    if (!rate.allowed) {
      return jsonError(
        "RATE_LIMITED",
        `Too many Chat requests. Try again in ${rate.retryAfterSeconds} seconds.`,
        429,
        true,
      );
    }
    const input = ChatRequestSchema.parse(await request.json());
    const claude = process.env.ANTHROPIC_API_KEY ? createClaudeClient() : null;
    const repository =
      dependencies.intelligence ?? getIntelligenceRepository();
    const resolvedScope = isDurableWorkspaceMode(context.mode)
      ? await resolveReportEvidenceScope({
          workspaceId: context.workspaceId,
          request: input.reportId === undefined
            ? { kind: "latest_terminal" }
            : {
                kind: "report",
                reportId: input.reportId,
                runId: input.runId!,
                ...(input.dealId === undefined ? {} : { dealId: input.dealId }),
              },
          intelligence: repository,
          runs: dependencies.runs ?? createRunsRepository(getDataClient()),
          underwritingRuns: dependencies.underwritingRuns
            ?? getUnderwritingRunsRepository(),
        }).catch((error) => {
          if (
            input.reportId === undefined
            && error instanceof ReportScopeNotFoundError
          ) return null;
          throw error;
        })
      : null;
    const scopedReport = resolvedScope?.report ?? null;
    const scopedDealId = resolvedScope?.dealId ?? null;
    const scopedContextFingerprint = scopedReport?.evidenceContext?.state === "current"
      ? scopedReport.evidenceContext.contextFingerprint
      : null;
    const scopedDeal = scopedDealId === null
      ? null
      : await (dependencies.dealRegistry ?? getDealRegistry()).findForWorkspace({
          workspaceId: context.workspaceId,
          dealId: scopedDealId,
        });
    const service = createGroundedChatService({
      async searchExistingData({ question }) {
        return [
          ...(context.mode === "public_demo"
            ? searchDemoEvidence(question)
            : []),
          ...await searchRuntimeIntelligence(
            question,
            scopedReport,
            context.mode,
            scopedDealId,
          ),
        ];
      },
      async recallMemory({ question }) {
        return recallExistingMemory(
          question,
          context.workspaceId,
          context.mode,
          scopedReport,
          resolvedScope?.run.id ?? null,
          scopedDealId,
          scopedContextFingerprint,
          scopedDeal?.activeSourceRevisionFingerprint ?? null,
        );
      },
      async complete({ system, prompt }) {
        if (!claude) return deterministicCompletion(prompt);
        return claude.complete({
          system,
          messages: [{ role: "user", content: prompt }],
          maxTokens: 1_200,
        });
      },
    });
    const answer = await service.answer({
      workspaceId: context.workspaceId,
      question: input.question,
      xtraceEnabled: input.xtraceEnabled,
    });
    return jsonOk({
      ...answer,
      scope: resolvedScope === null
        ? null
        : {
            reportId: resolvedScope.report.id,
            runId: resolvedScope.run.id,
            dealId: resolvedScope.dealId,
            evidenceContext: resolvedScope.report.evidenceContext
              ?? { state: "legacy_unbound" },
          },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
