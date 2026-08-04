import {
  CompanyAnalysisSchema,
  type CompanyAnalysis,
  type CompanyAnalysisCurrentRunAuditV1,
  type CompanyAnalysisCounts,
  type DealMemoryBundle,
  type DealStatus,
  type EvidenceField,
} from "../contracts/domain";
import { parseSourceRefV2Read } from "../contracts/legacy-evidence-adapter";
import {
  assertConsistentCanonicalEvidenceUnits,
  sourceCanGroundOutputFact,
  sourceClaimSupportKind,
  uniqueByCanonicalId,
  type SourceRefV2,
} from "../contracts/source-evidence";
import { SAMPLE_RESEARCH_SCREENING_RECORD_LABEL } from "../contracts/research-candidate";
import { interactionSourceV2 } from "../matching/context";
import type { GroundedMatch } from "../matching/service";
import { actionsForDealStatusAndDirection } from "./action-policy";
import type { MemoryContext } from "../xtrace/service";

const UNAVAILABLE = "Not available in current evidence" as const;
const NO_CHANGE =
  "No material market evidence matched this company during the current 14-day scan.";
const CONTINUE_MONITORING =
  "No immediate follow-up recommended. Continue monitoring.";
const ANALYSIS_UNAVAILABLE =
  "Analysis unavailable because XTrace did not return verified investment memory for this company.";
const NO_MATCHED_EVENT = "No matched market event was available.";

export interface CompanyAnalysisCurrentRunAuthority {
  workspaceId: string;
  dealUniverseId: string;
  dealUniverseFingerprint: string;
  evidenceContextFingerprint: string;
  evidenceBindingFingerprint: string;
  consideredMarketEventIds: string[];
  dealsById: ReadonlyMap<string, {
    companyId: string;
    priorDealStatus: DealStatus;
    analysisEligibleAt: string;
    activeSourceRevisionIds: string[];
    activeParentFingerprint: string;
  }>;
  recallAttemptedDealIds?: ReadonlySet<string>;
  recallFailureReasons: ReadonlyMap<string, string>;
}

export function buildCompanyAnalyses(input: {
  reportId: string;
  runId: string;
  createdAt: string;
  bundles: DealMemoryBundle[];
  contextsByDeal: ReadonlyMap<string, MemoryContext[]>;
  recallFailures: ReadonlySet<string>;
  structuredImageFallbackDealIds?: ReadonlySet<string>;
  groundedMatches: GroundedMatch[];
  currentRunAuthority?: CompanyAnalysisCurrentRunAuthority;
}): CompanyAnalysis[] {
  assertUniqueDealIds(input.bundles.map(({ dealId }) => dealId), "Deal bundle");
  assertUniqueDealIds(
    input.groundedMatches.map(({ dealId }) => dealId),
    "grounded match",
  );
  const groundedByDeal = new Map(
    input.groundedMatches.map((match) => [match.dealId, match]),
  );

  return input.bundles.map((bundle) => {
    const contexts = input.contextsByDeal.get(bundle.dealId);
    const recallFailed = input.recallFailures.has(bundle.dealId);
    const match = groundedByDeal.get(bundle.dealId);
    const usesStructuredImageFallback =
      input.structuredImageFallbackDealIds?.has(bundle.dealId) === true;
    const currentAuthority = currentAuthorityForDeal(
      input.currentRunAuthority,
      bundle,
      contexts ?? [],
    );
    const invalidCurrentMatch = currentAuthority !== undefined
      && match !== undefined
      && match.beliefAssessment === undefined
      && !validScreeningMonitorMatch(match);
    if (
      recallFailed
      || match?.outcome === "analysis_unavailable"
      || invalidCurrentMatch
      || (
        (!contexts || contexts.length === 0)
        && !usesStructuredImageFallback
      )
    ) {
      return unavailableAnalysis({
        reportId: input.reportId,
        runId: input.runId,
        createdAt: input.createdAt,
        bundle,
        contexts: contexts ?? [],
        currentAuthority,
        failureReason: input.currentRunAuthority?.recallFailureReasons.get(
          bundle.dealId,
        ) ?? match?.analysisFailureReason
          ?? (invalidCurrentMatch
            ? "Matching did not preserve the complete belief-assessment lineage."
            : ANALYSIS_UNAVAILABLE),
      });
    }

    return completeAnalysis({
      reportId: input.reportId,
      runId: input.runId,
      createdAt: input.createdAt,
      bundle,
      contexts: contexts ?? [],
      match,
      currentAuthority,
    });
  });
}

export function countCompanyAnalyses(
  analyses: readonly CompanyAnalysis[],
): CompanyAnalysisCounts {
  return {
    companyCount: analyses.length,
    beliefRevised: analyses.filter(
      (analysis) => analysis.outcome === "belief_revised",
    ).length,
    monitor: analyses.filter((analysis) => analysis.outcome === "monitor")
      .length,
    noMaterialChange: analyses.filter(
      (analysis) => analysis.outcome === "no_material_change",
    ).length,
    analysisUnavailable: analyses.filter(
      (analysis) => analysis.outcome === "analysis_unavailable",
    ).length,
  };
}

function completeAnalysis(input: {
  reportId: string;
  runId: string;
  createdAt: string;
  bundle: DealMemoryBundle;
  contexts: MemoryContext[];
  match?: GroundedMatch;
  currentAuthority?: CurrentDealAuthority;
}): CompanyAnalysis {
  const { bundle, contexts, match } = input;
  const selectedPriorInteractionId = match?.beliefAssessment?.gateContext
    .priorInteraction.id;
  const interaction = selectedPriorInteractionId
    ? bundle.interactions.find((candidate) =>
      candidate.id === selectedPriorInteractionId
    )
    : latestInteraction(bundle);
  const localSources = bundleSources(bundle);
  const sampleDecisionSources = localSources.filter((source) =>
    source.adaptation === "canonical"
    && source.provenance === "demo_fixture"
  );
  const researchPrior = match?.beliefAssessment?.gateContext.priorInteraction
    .provenance === "source_document"
    ? match.beliefAssessment.gateContext.priorInteraction
    : undefined;
  const screeningPriorSourceIds = researchPrior?.sourceIds
    ?? match?.screeningMonitorAssessment?.priorContextAuthority.sourceIds
    ?? [];
  const matchedEventSources = uniqueSources(
    match?.events.flatMap((event): SourceRefV2[] => [...event.sources]) ?? [],
  );
  const sources = uniqueSources([
    ...localSources,
    ...(match?.sources ?? []),
    ...matchedEventSources,
  ]);
  const outcome = match
    ? match.beliefAssessment ? match.outcome : "monitor"
    : "no_material_change";
  const confidence = match?.confidence ?? "low";
  const marketEvidence = match
    ? {
        relationship: match.relationship,
        explanation: match.whyNow,
        eventIds: match.events.map((event) => event.id),
        events: match.events,
        sourceIds: matchedEventSources.map((source) => source.id),
      }
    : {
        relationship: "none" as const,
        explanation: NO_CHANGE,
        eventIds: [],
        events: [],
        sourceIds: [],
      };

  const investmentMemory = {
    previousMeetingSummary:
      interaction?.summary ?? "No previous meeting summary was recorded.",
    decisionReason:
      interaction?.decisionReason ?? "No previous decision reason was recorded.",
    concerns: interaction?.concerns ?? [],
    revisitConditions: interaction?.revisitConditions
      ?? researchPrior?.revisitConditions
      ?? [],
    lastEvaluatedAt: interaction?.occurredAt
      ?? researchPrior?.occurredAt
      ?? null,
    memoryIds: unique(contexts.map((context) => context.memoryId)),
    sourceIds: unique([
      ...sampleDecisionSources.map((source) => source.id),
      ...screeningPriorSourceIds,
    ]),
    fixtureIds: unique(sampleDecisionSources.map((source) => source.id)),
    priorActions: interaction?.priorActions ?? researchPrior?.priorActions,
  };
  const currentRunAudit = input.currentAuthority
    ? buildCurrentRunAudit({
        authority: input.currentAuthority,
        bundle,
        contexts,
        investmentMemory,
        match,
        outcome,
      })
    : undefined;
  return CompanyAnalysisSchema.parse({
    id: `${input.reportId}:${bundle.dealId}`,
    reportId: input.reportId,
    runId: input.runId,
    dealId: bundle.dealId,
    companyName: bundle.companyName,
    dealStatus: bundle.status,
    outcome,
    confidence,
    score: match?.score ?? 0,
    verifiedSourceCount: sources.length,
    investmentMemory,
    marketEvidence,
    implications: match?.implications ?? { positive: [], negative: [] },
    claimSupport: match?.claimSupport ?? [],
    beliefAssessment: match?.beliefAssessment,
    recommendedNextMove: match?.beliefAssessment
      ? match.nextStep
      : CONTINUE_MONITORING,
    companyBrief: buildCompanyBrief(bundle, sources),
    sources,
    currentRunAudit,
    createdAt: input.createdAt,
  });
}

function unavailableAnalysis(input: {
  reportId: string;
  runId: string;
  createdAt: string;
  bundle: DealMemoryBundle;
  contexts: MemoryContext[];
  currentAuthority?: CurrentDealAuthority;
  failureReason: string;
}): CompanyAnalysis {
  const investmentMemory = {
    previousMeetingSummary: ANALYSIS_UNAVAILABLE,
    decisionReason: ANALYSIS_UNAVAILABLE,
    concerns: [],
    revisitConditions: [],
    lastEvaluatedAt: null,
    memoryIds: input.currentAuthority?.recallFailureReason === null
      ? unique(input.contexts.map(({ memoryId }) => memoryId))
      : [],
    sourceIds: [],
    fixtureIds: [],
  };
  const currentRunAudit = input.currentAuthority
    ? buildCurrentRunAudit({
        authority: input.currentAuthority,
        bundle: input.bundle,
        contexts: input.contexts,
        investmentMemory,
        outcome: "analysis_unavailable",
        failureReason: input.failureReason,
      })
    : undefined;
  return CompanyAnalysisSchema.parse({
    id: `${input.reportId}:${input.bundle.dealId}`,
    reportId: input.reportId,
    runId: input.runId,
    dealId: input.bundle.dealId,
    companyName: input.bundle.companyName,
    dealStatus: input.bundle.status,
    outcome: "analysis_unavailable",
    confidence: "low",
    score: 0,
    verifiedSourceCount: 0,
    investmentMemory,
    marketEvidence: {
      relationship: "unavailable",
      explanation: ANALYSIS_UNAVAILABLE,
      eventIds: [],
      events: [],
      sourceIds: [],
    },
    implications: { positive: [], negative: [] },
    recommendedNextMove:
      "Review system activity before relying on this company analysis.",
    companyBrief: {
      icSnapshot: [],
      traction: unavailableTraction(),
      dealTerms: unavailableDealTerms(),
      risks: [],
      decisionHistory: [],
      sourceLineage: [],
      structuredFields: [],
    },
    sources: [],
    currentRunAudit,
    createdAt: input.createdAt,
  });
}

interface CurrentDealAuthority {
  workspaceId: string;
  dealUniverseId: string;
  dealUniverseFingerprint: string;
  evidenceContextFingerprint: string;
  evidenceBindingFingerprint: string;
  consideredMarketEventIds: string[];
  companyId: string;
  priorDealStatus: DealStatus;
  analysisEligibleAt: string;
  activeSourceRevisionIds: string[];
  activeParentFingerprint: string;
  recallAttempted: boolean;
  recallFailureReason: string | null;
}

function validScreeningMonitorMatch(match: GroundedMatch): boolean {
  const assessment = match.screeningMonitorAssessment;
  if (
    !assessment
    || assessment.schemaVersion !== "screening-monitor-assessment-v1"
    || match.dealStatus !== "screening"
    || match.outcome !== "monitor"
    || match.beliefAssessment !== undefined
    || match.demoFixtureIds.length !== 0
    || assessment.priorContextAuthority.kind
      !== "sample_research_screening_record"
    || assessment.priorContextAuthority.provenance !== "source_document"
    || assessment.priorContextAuthority.label
      !== SAMPLE_RESEARCH_SCREENING_RECORD_LABEL
    || assessment.priorContextAuthority.meetingOccurred !== false
    || assessment.priorContextAuthority.vcInteraction !== false
    || assessment.priorContextAuthority.sourceIds.length !== 1
    || assessment.priorContextAuthority.sourceIds[0]
      !== assessment.priorContextAuthority.id
    || assessment.scoreBreakdown.finalScore !== match.score
    || assessment.scoreBreakdown.confidence !== match.confidence
    || assessment.gates.allPassed
    || assessment.gates.revisitConditionMapping.passed
    || assessment.gates.counterevidence.passed
    || assessment.gates.actionDelta.passed
  ) return false;
  const prior = match.sources.find(
    ({ id }) => id === assessment.priorContextAuthority.id,
  );
  const event = match.events.find(
    ({ id }) => id === assessment.triggerEvent.id,
  );
  return prior !== undefined
    && prior.adaptation === "canonical"
    && prior.provenance === "source_document"
    && prior.title === SAMPLE_RESEARCH_SCREENING_RECORD_LABEL
    && prior.sourceClass === "internal_decision_record"
    && prior.sourceAuthority === "primary"
    && prior.evidenceRole === "context"
    && prior.eventAt === assessment.priorContextAuthority.recordedAt
    && prior.text.status === "normalized_only"
    && prior.text.normalizedStatement.startsWith(
      `${SAMPLE_RESEARCH_SCREENING_RECORD_LABEL}. Synthetic research-only context; no meeting or VC interaction occurred.`,
    )
    && sourceCanGroundOutputFact(prior)
    && event !== undefined
    && event.adaptation === "canonical"
    && event.eventAt === assessment.triggerEvent.eventAt
    && sameStringSet(
      assessment.triggerEvent.sourceIds,
      event.sources.map(({ id }) => id),
    );
}

function currentAuthorityForDeal(
  authority: CompanyAnalysisCurrentRunAuthority | undefined,
  bundle: DealMemoryBundle,
  contexts: readonly MemoryContext[],
): CurrentDealAuthority | undefined {
  if (!authority) return undefined;
  const deal = authority.dealsById.get(bundle.dealId);
  if (!deal) {
    throw new Error(
      `Current-run CompanyAnalysis authority is missing Deal ${bundle.dealId}.`,
    );
  }
  if (deal.priorDealStatus !== bundle.status) {
    throw new Error(
      `Current-run CompanyAnalysis authority changed Deal ${bundle.dealId} status.`,
    );
  }
  const recallAttempted = authority.recallAttemptedDealIds?.has(bundle.dealId)
    ?? contexts.some((context) => !context.memoryId.startsWith("structured:"));
  return {
    workspaceId: authority.workspaceId,
    dealUniverseId: authority.dealUniverseId,
    dealUniverseFingerprint: authority.dealUniverseFingerprint,
    evidenceContextFingerprint: authority.evidenceContextFingerprint,
    evidenceBindingFingerprint: authority.evidenceBindingFingerprint,
    consideredMarketEventIds: [...authority.consideredMarketEventIds],
    ...deal,
    recallAttempted,
    recallFailureReason: authority.recallFailureReasons.get(bundle.dealId) ?? null,
  };
}

function buildCurrentRunAudit(input: {
  authority: CurrentDealAuthority;
  bundle: DealMemoryBundle;
  contexts: readonly MemoryContext[];
  investmentMemory: CompanyAnalysis["investmentMemory"];
  outcome: CompanyAnalysis["outcome"];
  match?: GroundedMatch;
  failureReason?: string;
}): CompanyAnalysisCurrentRunAuditV1 {
  const assessment = input.match?.beliefAssessment;
  const screeningMonitor = input.match?.screeningMonitorAssessment;
  const failureReason = input.failureReason
    ?? input.authority.recallFailureReason;
  const scoreBreakdown = assessment?.scoreBreakdown
    ?? screeningMonitor?.scoreBreakdown
    ?? {
    eventRelevance: 0,
    dealRelevance: 0,
    priorContextStrength: 0,
    evidenceQuality: 0,
    finalScore: 0,
    confidence: "low" as const,
  };
  const defaultGateReason = input.outcome === "analysis_unavailable"
    ? failureReason ?? "Analysis lineage was unavailable."
    : NO_MATCHED_EVENT;
  const gates = assessment
    ? {
        chronology: gateSummary(assessment.gates.chronology),
        revisitConditionMapping: gateSummary(
          assessment.gates.revisitConditionMapping,
        ),
        counterevidence: gateSummary(assessment.gates.counterevidence),
        actionDelta: gateSummary(assessment.gates.actionDelta),
        allPassed: assessment.gates.allPassed,
      }
    : screeningMonitor?.gates ?? unavailableAuditGates(defaultGateReason);
  const direction = assessment?.direction ?? screeningMonitor?.direction
    ?? (input.outcome === "analysis_unavailable" ? "unavailable" : "none");
  const actions = assessment?.actions ?? screeningMonitor?.actions
    ?? actionsForDealStatusAndDirection(input.bundle.status, direction);
  const recallSucceeded = input.authority.recallAttempted
    && input.authority.recallFailureReason === null
    && input.contexts.length > 0;
  const xtraceMemoryIds = recallSucceeded
    ? unique(input.contexts.map(({ memoryId }) => memoryId))
    : [];
  return {
    schemaVersion: "company-analysis-current-run-audit-v1",
    workspaceId: input.authority.workspaceId,
    companyId: input.authority.companyId,
    stableDealId: input.bundle.dealId,
    priorDealStatus: input.authority.priorDealStatus,
    analysisEligibleAt: input.authority.analysisEligibleAt,
    dealUniverseId: input.authority.dealUniverseId,
    dealUniverseFingerprint: input.authority.dealUniverseFingerprint,
    evidenceContextFingerprint: input.authority.evidenceContextFingerprint,
    evidenceBindingFingerprint: input.authority.evidenceBindingFingerprint,
    activeParentFingerprint: input.authority.activeParentFingerprint,
    sourceRevisionIds: unique(input.authority.activeSourceRevisionIds),
    xtraceMemoryIds,
    priorMemory: {
      kind: input.bundle.status === "screening" ? "screening" : "investment",
      previousMeetingSummary: input.investmentMemory.previousMeetingSummary,
      decisionReason: input.investmentMemory.decisionReason,
      concerns: input.investmentMemory.concerns,
      revisitConditions: input.investmentMemory.revisitConditions,
      lastEvaluatedAt: input.investmentMemory.lastEvaluatedAt,
      sourceIds: input.investmentMemory.sourceIds,
      fixtureIds: input.investmentMemory.fixtureIds,
    },
    consideredMarketEventIds: unique(
      input.authority.consideredMarketEventIds,
    ),
    matchedMarketEventIds: input.match?.events.map(({ id }) => id) ?? [],
    scoreBreakdown,
    gates,
    direction,
    actions,
    outcome: input.outcome,
    nonChangeReason: input.outcome === "no_material_change"
      ? input.match?.whyNow ?? NO_CHANGE
      : null,
    analysisFailureReason: input.outcome === "analysis_unavailable"
      ? failureReason ?? ANALYSIS_UNAVAILABLE
      : null,
    whyNotUnderwriting: input.outcome === "belief_revised"
      ? null
      : input.outcome === "analysis_unavailable"
      ? "Deep underwriting was not created because analysis was unavailable."
      : input.outcome === "no_material_change"
      ? "No material belief change was supported by the current evidence."
      : screeningMonitor?.whyNotUnderwriting
        ?? "The belief change did not satisfy confidence and all hard gates.",
    recall: {
      attempted: input.authority.recallAttempted,
      succeeded: recallSucceeded,
      failureReason: input.authority.recallAttempted && !recallSucceeded
        ? input.authority.recallFailureReason ?? "XTRACE_RECALL_EMPTY"
        : null,
    },
  };
}

function gateSummary(gate: { passed: boolean; failureReason: string | null }) {
  return { passed: gate.passed, failureReason: gate.failureReason };
}

function unavailableAuditGates(failureReason: string) {
  const failed = { passed: false, failureReason };
  return {
    chronology: { ...failed },
    revisitConditionMapping: { ...failed },
    counterevidence: { ...failed },
    actionDelta: { ...failed },
    allPassed: false,
  };
}

function assertUniqueDealIds(dealIds: readonly string[], label: string): void {
  if (new Set(dealIds).size !== dealIds.length) {
    throw new Error(`Duplicate Deal identity in ${label} input.`);
  }
}

function buildCompanyBrief(
  bundle: DealMemoryBundle,
  sources: SourceRefV2[],
): CompanyAnalysis["companyBrief"] {
  const interaction = latestInteraction(bundle);
  const fixtureId = interaction?.id;
  const structuredFields = bundle.facts.flatMap((fact) =>
    fact.semanticFields ?? []
  );
  const groundedFact = bundle.facts.map((fact) => ({
    fact,
    sourceIds: fact.sources.map(parseSourceRefV2Read)
      .filter((source) =>
        (source.provenance === "public_web"
          || source.provenance === "source_document")
        && sourceClaimSupportKind(source, fact.text) !== null
      )
      .map((source) => source.id),
  })).find(({ sourceIds }) => sourceIds.length > 0);

  return {
    icSnapshot: [
      ...(groundedFact
        ? [{
            label: "Company overview",
            value: groundedFact.fact.text,
            unavailableReason: null,
            sourceIds: unique(groundedFact.sourceIds),
          }]
        : []),
      ...(fixtureId
        ? [{
            label: "Deal status",
            value: bundle.status,
            unavailableReason: null,
            sourceIds: [fixtureId],
          }, {
            label: "Decision reason",
            value: interaction!.decisionReason,
            unavailableReason: null,
            sourceIds: [fixtureId],
          }]
        : []),
    ],
    traction: unavailableTraction(),
    dealTerms: unavailableDealTerms(),
    risks: interaction
      ? interaction.concerns.map((concern) => ({
          severity: "medium" as const,
          title: "Recorded Partner concern",
          detail: concern,
          nextQuestion: interaction.revisitConditions[0]
            ?? "What new source-backed evidence addresses this concern?",
          sourceIds: [interaction.id],
        }))
      : [],
    decisionHistory: interaction
      ? [{
          occurredAt: interaction.occurredAt,
          title: "Sample decision record",
          summary: interaction.decisionReason,
          sourceIds: [interaction.id],
        }]
      : [],
    sourceLineage: sources,
    structuredFields,
  };
}

function unavailableTraction(): EvidenceField[] {
  return [
    unavailableField("ARR"),
    unavailableField("Customers / users"),
    unavailableField("Growth"),
  ];
}

function unavailableDealTerms(): EvidenceField[] {
  return [
    unavailableField("Round"),
    unavailableField("Raise"),
    unavailableField("Valuation"),
  ];
}

function unavailableField(label: string): EvidenceField {
  return {
    label,
    value: null,
    unavailableReason: UNAVAILABLE,
    sourceIds: [],
  };
}

function latestInteraction(bundle: DealMemoryBundle) {
  return [...bundle.interactions].sort(
    (left, right) => right.occurredAt.localeCompare(left.occurredAt),
  )[0];
}

function bundleSources(bundle: DealMemoryBundle): SourceRefV2[] {
  return uniqueSources([
    ...bundle.facts.flatMap((fact) =>
      fact.sources.flatMap((source) => {
        const parsed = parseSourceRefV2Read(source);
        return parsed.adaptation === "canonical" ? [parsed] : [];
      })
    ),
    ...bundle.interactions.map(interactionSourceV2),
  ]);
}

function uniqueSources(sources: SourceRefV2[]): SourceRefV2[] {
  const unique = uniqueByCanonicalId(sources, "source");
  assertConsistentCanonicalEvidenceUnits(unique);
  return unique;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  return left.length === right.length
    && new Set(left).size === left.length
    && left.every((id) => right.includes(id));
}
