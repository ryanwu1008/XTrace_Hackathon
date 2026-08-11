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
import {
  getUnderwritingArtifactsRepository,
  type CandidateArtifactBundle,
} from "../../../db/repositories/underwriting-artifacts";
import { getXTraceLineageRepository } from "../../../db/repositories/xtrace-lineage";
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
  type CompanyAnalysis,
  type EvidenceSourceRef,
} from "../../../lib/contracts/domain";
import type { MarketEventV2 } from "../../../lib/contracts/source-evidence";
import {
  SAMPLE_DECISION_RECORD_LABEL,
  SAMPLE_DECISION_RECORD_PREFIX,
  WritableSourceRefV2Schema,
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
  type ResolvedReportEvidenceScope,
} from "../../../lib/reports/evidence-scope";
import {
  loadExactFinalizedChatScope,
  type ReadyFinalizedChatScope,
} from "../../../lib/chat/finalized-scope";
import {
  classifyFinalizedChatTopic,
  classifyFinalizedChatTopicV2,
} from "../../../lib/chat/finalized-topic";
import {
  buildFinalizedChatProjection,
  buildFinalizedChatProjectionV2,
  resolveFinalizedChatNamedLensTargetFromQuestion,
  type FinalizedChatV2EvidenceItem,
} from "../../../lib/chat/finalized-projection";
import {
  renderFinalizedChatProjection,
  renderFinalizedChatProjectionV2,
} from "../../../lib/chat/finalized-renderer";
import {
  FinalizedChatEvidenceFrameSchema,
  FinalizedChatInsufficientResponseSchema,
  FinalizedChatInsufficientResponseV2Schema,
  FinalizedChatSourceRefSchema,
  type FinalizedChatArtifactRef,
  type FinalizedChatArtifactRefV2,
  type FinalizedChatEvidenceFrame,
  type FinalizedChatIdentity,
  type FinalizedChatInsufficientReasonCode,
  type FinalizedChatInsufficientReasonCodeV2,
  type FinalizedChatNamedLensTarget,
  type FinalizedChatSourceRef,
  type FinalizedChatTopic,
  type FinalizedChatTopicV2,
} from "../../../lib/contracts/finalized-chat";
import type { AuthorizedRequestContext } from "../../../lib/auth/request-context";
import type { CandidateRun } from "../../../lib/contracts/underwriting";
import { UnderwritingPresentationIntegrityError } from
  "../../../lib/underwriting/presentation-version";

export const dynamic = "force-dynamic";

export interface ScopedRecallSourceIndex {
  parentClaims: Map<string, Map<string, EvidenceSourceRef[]>>;
  fixtureClaims: Map<string, Map<string, EvidenceSourceRef>>;
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
  const fixtureClaims = new Map<string, Map<string, EvidenceSourceRef>>();
  for (const source of catalog) {
    if (!isAllowedScopedChatSource(source, mode)) continue;
    if (source.provenance === "demo_fixture") {
      if (
        "schemaVersion" in source
        && source.adaptation === "canonical"
        && source.sourceRevisionId !== null
      ) {
        const byRevision = fixtureClaims.get(source.id) ?? new Map();
        byRevision.set(source.sourceRevisionId, source);
        fixtureClaims.set(source.id, byRevision);
      }
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
  for (const fixtureId of context.fixtureIds) {
    const byRevision = index.fixtureClaims.get(fixtureId);
    if (!byRevision || mode !== "public_sandbox") return [];
    const fixtures = revisions.flatMap((revisionId) => {
      const fixture = byRevision.get(revisionId);
      if (fixture) matchedRevisions.add(revisionId);
      return fixture ? [fixture] : [];
    });
    if (fixtures.length === 0) return [];
    resolved.push(...fixtures);
  }
  if (matchedRevisions.size !== new Set(revisions).size) return [];
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
  return mode !== "product"
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
    const sources = event.sources.filter((source) =>
      isAllowedScopedChatSource(source, mode)
    );
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
  const reportEvidence = buildPersistedReportEvidence({
    question,
    reports: [scopedReport],
    companyByDeal,
    allowSource: (source) => isAllowedScopedChatSource(source, mode),
  });
  const runtimeEvidence = [...eventEvidence, ...reportEvidence];
  validateEvidenceSourceCatalog(
    runtimeEvidence.flatMap((item) => item.sources),
    "runtime Chat source",
  );
  return runtimeEvidence.slice(0, 12);
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
    addDurableDealSources(opportunity.dealId, opportunity.sources);
  }
  for (const analysis of report.companyAnalyses) {
    if (analysis.dealId !== dealId) continue;
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
  dependencies: Pick<RouteDependencies, "xtraceLineage"> = {},
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
    lineageRepository:
      dependencies.xtraceLineage ?? getXTraceLineageRepository(),
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

function finalizedEvidenceFrame(
  scope: ResolvedReportEvidenceScope,
): FinalizedChatEvidenceFrame {
  const context = scope.report.evidenceContext ?? { state: "legacy_unbound" as const };
  if (context.state === "legacy_unbound") {
    return FinalizedChatEvidenceFrameSchema.parse({ state: "legacy_unbound" });
  }
  return FinalizedChatEvidenceFrameSchema.parse({
    state: "current",
    evidenceMode: context.evidenceMode,
    contextFingerprint: context.contextFingerprint,
    eventSetFingerprint: context.eventSetFingerprint,
    bindingFingerprint: context.bindingFingerprint,
    snapshotId: context.snapshotId,
    snapshotFingerprint: context.snapshotFingerprint,
  });
}

function finalizedIdentity(input: {
  context: AuthorizedRequestContext;
  scope: ResolvedReportEvidenceScope;
  dealId: string;
  candidateRunId: string;
}): FinalizedChatIdentity {
  return {
    workspaceId: input.context.workspaceId,
    reportId: input.scope.report.id,
    runId: input.scope.run.id,
    dealId: input.dealId,
    candidateRunId: input.candidateRunId,
  };
}

function finalizedScopePayload(
  scope: ResolvedReportEvidenceScope,
  dealId: string | null = scope.dealId,
  companyName?: string,
) {
  return {
    reportId: scope.report.id,
    runId: scope.run.id,
    dealId,
    ...(companyName === undefined ? {} : { companyName }),
    evidenceContext: scope.report.evidenceContext ?? { state: "legacy_unbound" as const },
  };
}

function finalizedInsufficient(input: {
  reasonCode: FinalizedChatInsufficientReasonCode;
  answer: string;
  topic?: FinalizedChatTopic | null;
  identity?: FinalizedChatIdentity | null;
  evidenceFrame?: FinalizedChatEvidenceFrame | null;
  missingArtifactRefs?: FinalizedChatArtifactRef[];
}) {
  return FinalizedChatInsufficientResponseSchema.parse({
    schemaVersion: "finalized-chat-response-v1",
    status: "insufficient",
    topic: input.topic ?? null,
    answer: input.answer,
    citations: [],
    identity: input.identity ?? null,
    evidenceFrame: input.evidenceFrame ?? null,
    insufficientEvidence: true,
    reasonCode: input.reasonCode,
    missingArtifactRefs: input.missingArtifactRefs ?? [],
  });
}

function finalizedInsufficientV2(input: {
  reasonCode: FinalizedChatInsufficientReasonCodeV2;
  answer: string;
  topic: FinalizedChatTopicV2 | null;
  requestedLensDisplayIdentity: string | null;
  identity: FinalizedChatIdentity;
  evidenceFrame: FinalizedChatEvidenceFrame;
  missingArtifactRefs?: FinalizedChatArtifactRefV2[];
}) {
  return FinalizedChatInsufficientResponseV2Schema.parse({
    schemaVersion: "finalized-chat-response-v2",
    status: "insufficient",
    topic: input.topic,
    requestedLensDisplayIdentity: input.requestedLensDisplayIdentity,
    answer: input.answer,
    citations: [],
    identity: input.identity,
    evidenceFrame: input.evidenceFrame,
    insufficientEvidence: true,
    reasonCode: input.reasonCode,
    missingArtifactRefs: input.missingArtifactRefs ?? [],
  });
}

function currentNamedLensTargets(
  bundle: CandidateArtifactBundle,
): FinalizedChatNamedLensTarget[] {
  const passages = bundle.namedLensPassages;
  if (!passages) {
    throw new UnderwritingPresentationIntegrityError(
      "incomplete_current_identity",
    );
  }
  return passages.map((passage) => {
    const dispositions = bundle.namedLensDispositions?.filter(
      (disposition) =>
        disposition.judgmentId === passage.judgmentId
        && disposition.frameworkCardId === passage.frameworkCardId,
    ) ?? [];
    const judgments = bundle.judgments.filter((judgment) =>
      judgment.id === passage.judgmentId
      && judgment.frameworkCardId === passage.frameworkCardId
    );
    if (
      dispositions.length !== 1
      || judgments.length !== 1
      || !judgments[0]!.frameworkMetadata
    ) {
      throw new UnderwritingPresentationIntegrityError(
        "incomplete_current_identity",
      );
    }
    const components = judgments[0]!.frameworkMetadata!.components.filter(
      ({ frameworkId }) =>
        frameworkId === passage.premise.componentFrameworkId,
    );
    if (components.length !== 1) {
      throw new UnderwritingPresentationIntegrityError(
        "incomplete_current_identity",
      );
    }
    const component = components[0]!;
    return {
      judgmentId: passage.judgmentId,
      frameworkCardId: passage.frameworkCardId,
      componentFrameworkId: component.frameworkId,
      publicDisplayIdentity: component.attribution.display,
      displayName: component.name,
      attributionDisplay: component.attribution.display,
    };
  });
}

function currentFinalizedEvidenceItems(input: {
  analysis: CompanyAnalysis;
  bundle: CandidateArtifactBundle;
}): FinalizedChatV2EvidenceItem[] {
  const sources: EvidenceSourceRef[] = [
    ...input.analysis.sources,
    ...input.analysis.companyBrief.sourceLineage,
  ];
  const canonicalSources = new Map<string, FinalizedChatSourceRef>();
  for (const source of sources) {
    const writable = WritableSourceRefV2Schema.safeParse(source);
    if (!writable.success) continue;
    const canonical = writable.data;
    const parsed = FinalizedChatSourceRefSchema.safeParse({
      sourceId: canonical.id,
      documentId: canonical.documentId,
      sourceRevisionId: canonical.sourceRevisionId,
      contentFingerprint: canonical.contentFingerprint,
      canonicalSource: canonical,
      text: canonical.text,
    });
    if (!parsed.success) continue;
    const key = [
      parsed.data.sourceId,
      parsed.data.sourceRevisionId,
      parsed.data.contentFingerprint,
    ].join("\u0000");
    canonicalSources.set(key, parsed.data);
  }
  const byRevision = new Map<string, FinalizedChatSourceRef[]>();
  for (const source of canonicalSources.values()) {
    byRevision.set(source.sourceRevisionId, [
      ...(byRevision.get(source.sourceRevisionId) ?? []),
      source,
    ]);
  }
  const facts = input.bundle.evidencePack.facts.flatMap((fact) => {
    const matches = byRevision.get(fact.sourceRevisionId) ?? [];
    return matches.length === 1
      ? [{
        evidencePackItemId: fact.id,
        classification: "fact" as const,
        sourceRef: matches[0]!,
      }]
      : [];
  });
  const assumptions = input.bundle.evidencePack.assumptions.map(
    (assumption) => ({
      evidencePackItemId: assumption.id,
      classification: "assumption" as const,
      sourceRef: null,
    }),
  );
  return [...facts, ...assumptions];
}

function answerCurrentFinalizedChatV2(input: {
  context: AuthorizedRequestContext;
  request: ReturnType<typeof ChatRequestSchema.parse>;
  loaded: ReadyFinalizedChatScope;
  identity: FinalizedChatIdentity;
  evidenceFrame: FinalizedChatEvidenceFrame;
}): Response | null {
  const { loaded } = input;
  const bundle = loaded.bundle;
  const adapter = loaded.presentationAdapter;
  if (
    adapter?.kind !== "current"
    || bundle === null
    || loaded.candidate === null
    || bundle.decisionCriticalEvidenceProjection === undefined
    || bundle.namedLensDispositions === undefined
    || bundle.namedLensPassages === undefined
    || bundle.namedLensPresentation === undefined
    || bundle.underwritingPresentationReportId === undefined
    || bundle.versionSnapshot.presentationFingerprint === undefined
    || bundle.versionSnapshot.criticalEvidenceProjectionFingerprint === undefined
    || bundle.versionSnapshot.finalDispositionsFingerprint === undefined
  ) {
    throw new UnderwritingPresentationIntegrityError(
      "incomplete_current_identity",
    );
  }

  const classification = classifyFinalizedChatTopicV2(input.request.question);
  if (classification.status === "insufficient") {
    // V2 adds Named Lens questions to current reports; it does not remove the
    // canonical finalized-report topics. An unambiguous non-V2 question falls
    // through to the V1 classifier and projection below. A question that
    // matches multiple V2 topics remains fail closed here.
    if (
      classification.reasonCode === "unsupported_topic"
      && classifyFinalizedChatTopic(input.request.question).status === "matched"
    ) return null;
    return jsonOk({
      ...finalizedInsufficientV2({
        reasonCode: classification.reasonCode,
        answer: classification.reasonCode === "ambiguous_topic"
          ? "Insufficient finalized evidence: ask one Named Lens question at a time."
          : "Insufficient finalized evidence: this current report supports questions about why a saved Named Lens appears, its exact evidence, what would change its view, or why its formal-decision weight is zero.",
        topic: null,
        requestedLensDisplayIdentity: null,
        identity: input.identity,
        evidenceFrame: input.evidenceFrame,
      }),
      memoryStatus: "disabled" as const,
      usedXTrace: false,
      scope: finalizedScopePayload(
        loaded.scope,
        loaded.dealId,
        loaded.analysis.companyName,
      ),
    });
  }

  const lensDisplayIdentities = currentNamedLensTargets(bundle);
  const targetResolution = resolveFinalizedChatNamedLensTargetFromQuestion({
    question: input.request.question,
    lensDisplayIdentities,
  });
  if (targetResolution.status === "insufficient") {
    return jsonOk({
      ...finalizedInsufficientV2({
        reasonCode: targetResolution.reasonCode,
        answer: targetResolution.reasonCode === "lens_target_ambiguous"
          ? "Insufficient finalized evidence: name exactly one saved Named Lens using its full displayed identity."
          : "Insufficient finalized evidence: include the full displayed identity of one Named Lens saved in this report.",
        topic: classification.topic,
        requestedLensDisplayIdentity: null,
        identity: input.identity,
        evidenceFrame: input.evidenceFrame,
      }),
      memoryStatus: "disabled" as const,
      usedXTrace: false,
      scope: finalizedScopePayload(
        loaded.scope,
        loaded.dealId,
        loaded.analysis.companyName,
      ),
    });
  }

  const built = buildFinalizedChatProjectionV2({
    topic: classification.topic,
    requestedLensDisplayIdentity:
      targetResolution.target.publicDisplayIdentity,
    identity: input.identity,
    evidenceFrame: input.evidenceFrame,
    presentationIdentity: {
      adapterSchemaVersion: adapter.schemaVersion,
      sourceCandidateRunId: bundle.sourceCandidateRunId,
      presentationReportId: bundle.underwritingPresentationReportId,
      presentationSchemaVersion: bundle.namedLensPresentation.schemaVersion,
      presentationFingerprint:
        bundle.versionSnapshot.presentationFingerprint,
      criticalEvidenceProjectionFingerprint:
        bundle.versionSnapshot.criticalEvidenceProjectionFingerprint,
      finalDispositionsFingerprint:
        bundle.versionSnapshot.finalDispositionsFingerprint,
    },
    decisionCriticalEvidenceProjection:
      bundle.decisionCriticalEvidenceProjection,
    dispositions: bundle.namedLensDispositions,
    passages: bundle.namedLensPassages,
    presentation: bundle.namedLensPresentation,
    lensDisplayIdentities,
    evidenceItems: currentFinalizedEvidenceItems({
      analysis: loaded.analysis,
      bundle,
    }),
  });
  if (built.status === "insufficient") {
    return jsonOk({
      ...finalizedInsufficientV2({
        reasonCode: built.reasonCode,
        answer: `Insufficient finalized evidence: ${built.reasonCode}.`,
        topic: built.topic,
        requestedLensDisplayIdentity: built.requestedLensDisplayIdentity,
        identity: built.identity,
        evidenceFrame: built.evidenceFrame,
        missingArtifactRefs: built.missingArtifactRefs,
      }),
      memoryStatus: "disabled" as const,
      usedXTrace: false,
      scope: finalizedScopePayload(
        loaded.scope,
        loaded.dealId,
        loaded.analysis.companyName,
      ),
    });
  }
  return jsonOk({
    ...renderFinalizedChatProjectionV2(built.projection),
    memoryStatus: "disabled" as const,
    usedXTrace: false,
    scope: finalizedScopePayload(
      loaded.scope,
      loaded.dealId,
      loaded.analysis.companyName,
    ),
  });
}

function presentationConflict(error: unknown): Response | null {
  return error instanceof UnderwritingPresentationIntegrityError
    ? jsonError(
      "CONFLICT",
      "Underwriting presentation identity is unavailable or inconsistent.",
      409,
      false,
    )
    : null;
}

function scopeFailureReason(
  reason: string,
): FinalizedChatInsufficientReasonCode {
  if (reason === "artifact_missing") return "artifact_missing";
  if (reason.startsWith("artifact_")) return "artifact_mismatch";
  return "scope_mismatch";
}

export function resolveFinalizedRouteCandidateBinding(
  candidate: Pick<
    CandidateRun,
    | "id"
    | "rerunOfId"
    | "artifactSourceCandidateRunId"
    | "candidateAnalysisFingerprint"
  > | null,
) {
  return candidate === null
    ? null
    : {
        candidateRunId: candidate.id,
        rerunOfId: candidate.rerunOfId,
        artifactSourceCandidateRunId:
          candidate.artifactSourceCandidateRunId ?? null,
        candidateAnalysisFingerprint: candidate.candidateAnalysisFingerprint,
      };
}

async function answerDurableFinalizedChat(input: {
  context: AuthorizedRequestContext;
  request: ReturnType<typeof ChatRequestSchema.parse>;
  dependencies: RouteDependencies;
  repository: ReturnType<typeof getIntelligenceRepository>;
}) {
  const underwritingRuns = input.dependencies.underwritingRuns
    ?? getUnderwritingRunsRepository();
  const resolvedScope = await resolveReportEvidenceScope({
    workspaceId: input.context.workspaceId,
    request: input.request.reportId === undefined
      ? { kind: "latest_terminal" }
      : {
          kind: "report",
          reportId: input.request.reportId,
          runId: input.request.runId!,
          ...(input.request.dealId === undefined
            ? {}
            : { dealId: input.request.dealId }),
        },
    intelligence: input.repository,
    runs: input.dependencies.runs ?? createRunsRepository(getDataClient()),
    underwritingRuns,
  }).catch((error) => {
    if (
      input.request.reportId === undefined
      && error instanceof ReportScopeNotFoundError
    ) return null;
    throw error;
  });
  if (resolvedScope === null) {
    return jsonOk({
      ...finalizedInsufficient({
        reasonCode: "scope_unavailable",
        answer: "Insufficient finalized evidence: no terminal report scope is available.",
      }),
      memoryStatus: "disabled" as const,
      usedXTrace: false,
      scope: null,
    });
  }

  const evidenceFrame = finalizedEvidenceFrame(resolvedScope);
  let loaded;
  try {
    loaded = await loadExactFinalizedChatScope({
      workspaceId: input.context.workspaceId,
      scope: resolvedScope,
      question: input.request.question,
      dealId: input.request.dealId,
      underwritingRuns,
      artifacts: input.dependencies.underwritingArtifacts
        ?? getUnderwritingArtifactsRepository(),
    });
  } catch (error) {
    const conflict = presentationConflict(error);
    if (conflict) return conflict;
    throw error;
  }
  if (loaded.status === "insufficient_evidence") {
    return jsonOk({
      ...finalizedInsufficient({
        reasonCode: scopeFailureReason(loaded.reason),
        answer: `Insufficient finalized evidence: ${loaded.message}`,
      }),
      memoryStatus: "disabled" as const,
      usedXTrace: false,
      scope: finalizedScopePayload(resolvedScope, loaded.dealId),
    });
  }

  const candidateBinding = resolveFinalizedRouteCandidateBinding(
    loaded.candidate,
  );
  const candidateRunId = candidateBinding?.candidateRunId ?? null;
  const identity = candidateRunId === null
    ? null
    : finalizedIdentity({
        context: input.context,
        scope: resolvedScope,
        dealId: loaded.dealId,
        candidateRunId,
      });
  if (loaded.presentationAdapter?.kind === "current") {
    if (identity === null) {
      return jsonError(
        "CONFLICT",
        "Underwriting presentation identity is unavailable or inconsistent.",
        409,
      );
    }
    try {
      const currentResponse = answerCurrentFinalizedChatV2({
        context: input.context,
        request: input.request,
        loaded,
        identity,
        evidenceFrame,
      });
      if (currentResponse !== null) return currentResponse;
    } catch (error) {
      const conflict = presentationConflict(error);
      if (conflict) return conflict;
      throw error;
    }
  }
  const classification = classifyFinalizedChatTopic(input.request.question);
  if (classification.status === "insufficient") {
    return jsonOk({
      ...finalizedInsufficient({
        reasonCode: classification.reasonCode,
        answer: classification.reasonCode === "ambiguous_topic"
          ? "Insufficient finalized evidence: ask one supported finalized-report question at a time."
          : "Insufficient finalized evidence: this finalized-report question is not supported.",
        identity,
        evidenceFrame: identity === null ? null : evidenceFrame,
      }),
      memoryStatus: "disabled" as const,
      usedXTrace: false,
      scope: finalizedScopePayload(
        resolvedScope,
        loaded.dealId,
        loaded.analysis.companyName,
      ),
    });
  }
  if (identity === null) {
    return jsonOk({
      ...finalizedInsufficient({
        reasonCode: "artifact_missing",
        answer: "Insufficient finalized evidence: the scoped Deal has no finalized candidate identity.",
        topic: classification.topic,
      }),
      memoryStatus: "disabled" as const,
      usedXTrace: false,
      scope: finalizedScopePayload(
        resolvedScope,
        loaded.dealId,
        loaded.analysis.companyName,
      ),
    });
  }

  const built = buildFinalizedChatProjection({
    topic: classification.topic,
    requestMode: input.context.mode === "product" ? "product" : "public_sandbox",
    identity,
    evidenceFrame,
    analysis: loaded.analysis,
    bundle: loaded.bundle,
    candidateBinding: candidateBinding!,
  });
  if (built.status === "insufficient") {
    return jsonOk({
      ...finalizedInsufficient({
        reasonCode: built.reasonCode,
        answer: `Insufficient finalized evidence: ${built.reasonCode}.`,
        topic: built.topic,
        identity: built.identity,
        evidenceFrame: built.evidenceFrame,
        missingArtifactRefs: built.missingArtifactRefs,
      }),
      memoryStatus: "disabled" as const,
      usedXTrace: false,
      scope: finalizedScopePayload(
        resolvedScope,
        loaded.dealId,
        loaded.analysis.companyName,
      ),
    });
  }
  return jsonOk({
    ...renderFinalizedChatProjection(built.projection),
    memoryStatus: "disabled" as const,
    usedXTrace: false,
    scope: finalizedScopePayload(
      resolvedScope,
      loaded.dealId,
      loaded.analysis.companyName,
    ),
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
    const rate = await (dependencies.rateLimitRequest ?? rateLimitRequest)(
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
    const repository =
      dependencies.intelligence ?? getIntelligenceRepository();
    if (isDurableWorkspaceMode(context.mode)) {
      return answerDurableFinalizedChat({
        context,
        request: input,
        dependencies,
        repository,
      });
    }

    const claude = process.env.ANTHROPIC_API_KEY ? createClaudeClient() : null;
    const service = createGroundedChatService({
      async searchExistingData({ question }) {
        return [
          ...(context.mode === "public_demo"
            ? searchDemoEvidence(question)
            : []),
          ...await searchRuntimeIntelligence(
            question,
            null,
            context.mode,
            null,
          ),
        ];
      },
      async recallMemory({ question }) {
        return recallExistingMemory(
          question,
          context.workspaceId,
          context.mode,
          null,
          null,
          null,
          null,
          null,
          dependencies,
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
      scope: null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
