import { errorResponse, jsonError, jsonOk } from "../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../lib/api/route-dependencies";
import { rateLimitRequest, requirePermission } from "../../../lib/api/safety";
import {
  getIntelligenceRepository,
  type IntelligenceRepository,
} from "../../../db/repositories/intelligence";
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

export const dynamic = "force-dynamic";

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

async function searchRuntimeIntelligence(
  question: string,
  workspaceId: string,
  repository: IntelligenceRepository,
  mode: DeploymentMode,
): Promise<ChatEvidence[]> {
  const tokens = evidenceQueryTokens(question);
  if (!tokens.length) return [];
  const [events, reports] = await Promise.all([
    repository.listMarketEvents(workspaceId),
    repository.listReports(workspaceId),
  ]);
  validateEvidenceSourceCatalog([
    ...events.flatMap((event): EvidenceSourceRef[] => [...event.sources]),
    ...reports.flatMap((report) => [
      ...report.opportunities.flatMap((opportunity) => opportunity.sources),
      ...report.companyAnalyses.flatMap((analysis) => analysis.sources),
    ]),
  ], "runtime Chat authority source");
  const eventEvidence = events.flatMap((event) => {
    const sources = isDurableWorkspaceMode(mode)
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
  const companyByDeal = isDurableWorkspaceMode(mode)
    ? new Map<string, string>()
    : new Map(
        buildDemoViewModel().deals.map((deal) => [deal.id, deal.companyName]),
      )
  const searchableReports = isDurableWorkspaceMode(mode)
    ? reports.map((report) => ({
        ...report,
        opportunities: report.opportunities.filter(
          isProductOpportunityEvidence,
        ),
        companyAnalyses: report.companyAnalyses.filter(
          isProductCompanyAnalysisEvidence,
        ),
      }))
    : reports;
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
  workspaceId: string,
  repository: IntelligenceRepository,
): Promise<{
  sourceById: Map<string, EvidenceSourceRef>;
  candidateDealIds: string[];
}> {
  const reports = await repository.listReports(workspaceId);
  validateEvidenceSourceCatalog(
    reports.flatMap((report) => [
      ...report.opportunities.flatMap((opportunity) => opportunity.sources),
      ...report.companyAnalyses.flatMap((analysis) => analysis.sources),
    ]),
    "Chat memory authority source",
  );
  const durableSourceCandidates: EvidenceSourceRef[] = [];
  const dealIds = new Set<string>();
  const addDurableDealSources = (
    dealId: string,
    sources: readonly EvidenceSourceRef[],
  ) => {
    const durableSources = sources.filter((source) =>
      source.provenance !== "demo_fixture"
    );
    if (durableSources.length === 0) return;
    dealIds.add(dealId);
    durableSourceCandidates.push(...durableSources);
  };
  for (const report of reports) {
    for (const opportunity of report.opportunities) {
      if (!isProductOpportunityEvidence(opportunity)) continue;
      addDurableDealSources(opportunity.dealId, opportunity.sources);
    }
    for (const analysis of report.companyAnalyses) {
      if (!isProductCompanyAnalysisEvidence(analysis)) continue;
      addDurableDealSources(analysis.dealId, analysis.sources);
    }
  }
  const durableSources = validateEvidenceSourceCatalog(
    durableSourceCandidates,
    "Chat durable source",
  );
  return {
    sourceById: new Map(durableSources.map((source) => [source.id, source])),
    candidateDealIds: [...dealIds],
  };
}

async function recallExistingMemory(
  question: string,
  workspaceId: string,
  mode: DeploymentMode,
  repository: IntelligenceRepository,
): Promise<MemoryRecallOutcome> {
  if (!isXTraceConfigured()) return { status: "unavailable" };
  const scope = isDurableWorkspaceMode(mode)
    ? await productMemoryScope(workspaceId, repository)
    : {
        sourceById: allDemoSources(),
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
      query: question,
      candidateDealIds: scope.candidateDealIds,
      limit: 8,
    });
    const evidence = contexts.flatMap((context) => {
      if (
        isDurableWorkspaceMode(mode)
        && (
          context.fixtureIds.length > 0
          || context.provenance === "demo_fixture"
        )
      ) {
        return [];
      }
      const evidenceIds = isDurableWorkspaceMode(mode)
        ? context.sourceIds
        : [...context.sourceIds, ...context.fixtureIds];
      const sources = evidenceIds.flatMap((sourceId) => {
        const source = scope.sourceById.get(sourceId);
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
    const service = createGroundedChatService({
      async searchExistingData({ question }) {
        return [
          ...(context.mode === "public_demo"
            ? searchDemoEvidence(question)
            : []),
          ...await searchRuntimeIntelligence(
            question,
            context.workspaceId,
            repository,
            context.mode,
          ),
        ];
      },
      async recallMemory({ question }) {
        return recallExistingMemory(
          question,
          context.workspaceId,
          context.mode,
          repository,
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
    return jsonOk(await service.answer({
      workspaceId: context.workspaceId,
      question: input.question,
      xtraceEnabled: input.xtraceEnabled,
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
