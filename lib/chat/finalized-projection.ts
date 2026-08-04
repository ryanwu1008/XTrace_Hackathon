import type { CandidateArtifactBundle } from "../../db/repositories/underwriting-artifacts";
import {
  type BeliefAction,
  type CompanyAnalysis,
  type EvidenceSourceRef,
} from "../contracts/domain";
import type { Fact } from "../contracts/evidence";
import {
  type ActionDraftV2,
  type FrameworkJudgment,
} from "../contracts/underwriting";
import {
  FinalizedChatProjectionBuildResultSchema,
  FinalizedChatProjectionV1Schema,
  createFinalizedChatClaim,
  createFinalizedChatProjection,
  type FinalizedChatArtifactRef,
  type FinalizedChatEvidenceFrame,
  type FinalizedChatIdentity,
  type FinalizedChatInsufficientReasonCode,
  type FinalizedChatProjectionBuildResult,
  type FinalizedChatSourceRef,
  type FinalizedChatTextClass,
  type FinalizedChatTopic,
} from "../contracts/finalized-chat";
import {
  actionsForDealStatusAndDirection,
  beliefActionListsEqual,
} from "../reports/action-policy";
import { renderSampleDecisionStatement } from "../belief-reversal/sample-decision-source";

export type FinalizedChatRequestMode = "product" | "public_sandbox";

export interface FinalizedChatCandidateBinding {
  candidateRunId: string;
  rerunOfId: string | null;
  candidateAnalysisFingerprint: string;
}

export interface BuildFinalizedChatProjectionInput {
  topic: FinalizedChatTopic;
  requestMode: FinalizedChatRequestMode;
  identity: FinalizedChatIdentity;
  evidenceFrame: FinalizedChatEvidenceFrame;
  analysis: CompanyAnalysis;
  candidateBinding: FinalizedChatCandidateBinding;
  bundle?: CandidateArtifactBundle | null;
}

class ProjectionFailure extends Error {
  constructor(
    readonly reasonCode: FinalizedChatInsufficientReasonCode,
    readonly refs: FinalizedChatArtifactRef[],
  ) {
    super(reasonCode);
  }
}

interface ProjectionContext extends BuildFinalizedChatProjectionInput {
  bundle: CandidateArtifactBundle | null;
  sourceById: Map<string, EvidenceSourceRef>;
}

interface ClaimInput {
  text: string;
  textClass: FinalizedChatTextClass;
  artifactRefs: FinalizedChatArtifactRef[];
  sourceRefs?: FinalizedChatSourceRef[];
}

export function buildFinalizedChatProjection(
  input: BuildFinalizedChatProjectionInput,
): FinalizedChatProjectionBuildResult {
  const bundle = input.bundle ?? null;
  const context: ProjectionContext = {
    ...input,
    bundle,
    sourceById: new Map(input.analysis.sources.map((source) => [source.id, source])),
  };

  try {
    assertExactScope(context);
    const claims = claimsForTopic(context);
    const projection = createFinalizedChatProjection({
      topic: context.topic,
      identity: context.identity,
      evidenceFrame: context.evidenceFrame,
      claims: claims.map((claim) => createFinalizedChatClaim({
        identity: context.identity,
        topic: context.topic,
        text: claim.text,
        textClass: claim.textClass,
        artifactRefs: uniqueArtifactRefs(claim.artifactRefs),
        sourceRefs: uniqueSourceRefs(claim.sourceRefs ?? []),
      })),
    });
    return FinalizedChatProjectionBuildResultSchema.parse({
      status: "success",
      projection: FinalizedChatProjectionV1Schema.parse(projection),
    });
  } catch (error) {
    const failure = error instanceof ProjectionFailure
      ? error
      : new ProjectionFailure("artifact_mismatch", [
        analysisRef(context, "id"),
      ]);
    return insufficient(context, failure.reasonCode, failure.refs);
  }
}

function assertExactScope(context: ProjectionContext): void {
  const { analysis, bundle, candidateBinding, identity } = context;
  if (
    analysis.reportId !== identity.reportId
    || analysis.runId !== identity.runId
      || analysis.dealId !== identity.dealId
      || candidateBinding.candidateRunId !== identity.candidateRunId
  ) {
    fail("scope_identity_mismatch", [analysisRef(context, "reportId")]);
  }
  if (
    bundle !== null
    && (
      bundle.workspaceId !== identity.workspaceId
      || bundle.dealId !== identity.dealId
      || (
        bundle.candidateRunId !== candidateBinding.candidateRunId
        && bundle.candidateRunId !== candidateBinding.rerunOfId
      )
      || bundle.candidateAnalysisFingerprint
        !== candidateBinding.candidateAnalysisFingerprint
      || bundle.evidencePack.workspaceId !== identity.workspaceId
      || bundle.evidencePack.dealId !== identity.dealId
    )
  ) {
    fail("scope_identity_mismatch", [bundleRef(context, "identity")]);
  }
  const hasDemoFixture = analysis.investmentMemory.fixtureIds.length > 0
    || analysis.sources.some((source) => source.provenance === "demo_fixture");
  if (hasDemoFixture && context.requestMode === "product") {
    fail("demo_fixture_forbidden", [
      analysisRef(context, "investmentMemory.fixtureIds"),
    ]);
  }
  if (hasDemoFixture) exactSampleSource(context);
}

function claimsForTopic(context: ProjectionContext): ClaimInput[] {
  switch (context.topic) {
    case "prior_reason":
      return priorReasonClaims(context);
    case "belief_change":
      return beliefChangeClaims(context);
    case "strongest_counterargument":
      return counterargumentClaims(context);
    case "match_confidence":
      return matchConfidenceClaims(context);
    case "framework_disagreement":
      return frameworkDisagreementClaims(context);
    case "valuation":
      return valuationClaims(context);
    case "missing_evidence":
      return missingEvidenceClaims(context);
    case "invested_action":
      return investedActionClaims(context);
  }
}

function priorReasonClaims(context: ProjectionContext): ClaimInput[] {
  const sample = exactSampleSource(context);
  return [{
    text: sample.text.normalizedStatement,
    textClass: "normalized_statement",
    artifactRefs: [
      analysisRef(context, "investmentMemory.decisionReason"),
      {
        artifactType: "sample_decision_record",
        artifactId: sample.sourceId,
        fieldPath: "text.normalizedStatement",
      },
    ],
    sourceRefs: [sample],
  }];
}

function beliefChangeClaims(context: ProjectionContext): ClaimInput[] {
  const assessment = requireAssessment(context);
  const sample = exactSampleSource(context);
  const mappingSources = exactSources(
    context,
    assessment.gates.revisitConditionMapping.citedSourceIds,
  );
  const triggerSources = exactSources(
    context,
    assessment.gateContext.triggerEvent.sourceIds,
  );
  const triggerEvent = context.analysis.marketEvidence.events.find(
    ({ id }) => id === assessment.gateContext.triggerEvent.id,
  );
  if (!triggerEvent || !("schemaVersion" in triggerEvent)) {
    fail("source_lineage_incomplete", [{
      artifactType: "market_event",
      artifactId: assessment.gateContext.triggerEvent.id,
      fieldPath: "sources",
    }]);
  }
  const priorKinds = assessment.gates.actionDelta.priorActions.map(({ kind }) => kind);
  const proposedKinds = assessment.gates.actionDelta.proposedActions.map(({ kind }) => kind);
  const summary = [
    `Belief direction: ${assessment.direction}.`,
    `Revisit mapping: ${assessment.gates.revisitConditionMapping.revisitConditionText}.`,
    `Trigger event: ${assessment.gateContext.triggerEvent.id}.`,
    `Action delta: [${priorKinds.join(", ")}] -> [${proposedKinds.join(", ")}].`,
  ].join(" ");
  const sourceClaims = triggerSources.map((source): ClaimInput => {
    const index = triggerEvent.sources.findIndex((candidate) =>
      candidate.id === source.sourceId
      && candidate.sourceRevisionId === source.sourceRevisionId
      && candidate.contentFingerprint === source.contentFingerprint
    );
    if (index < 0) {
      fail("source_lineage_incomplete", [{
        artifactType: "market_event",
        artifactId: triggerEvent.id,
        fieldPath: "sources",
      }]);
    }
    if (source.text.status === "verified_exact") {
      return {
        text: source.text.verbatimExcerpt,
        textClass: "exact_quote",
        artifactRefs: [{
          artifactType: "market_event",
          artifactId: assessment.gateContext.triggerEvent.id,
          fieldPath: `sources[${index}].text.verbatimExcerpt`,
        }],
        sourceRefs: [source],
      };
    }
    return {
      text: source.text.normalizedStatement,
      textClass: "normalized_statement",
      artifactRefs: [{
        artifactType: "market_event",
        artifactId: assessment.gateContext.triggerEvent.id,
        fieldPath: `sources[${index}].text.normalizedStatement`,
      }],
      sourceRefs: [source],
    };
  });
  return [{
    text: sample.text.normalizedStatement,
    textClass: "normalized_statement",
    artifactRefs: [{
      artifactType: "sample_decision_record",
      artifactId: sample.sourceId,
      fieldPath: "text.normalizedStatement",
    }],
    sourceRefs: [sample],
  }, ...sourceClaims, {
    text: summary,
    textClass: "persisted_inference",
    artifactRefs: [
      analysisRef(context, "beliefAssessment.direction"),
      {
        artifactType: "belief_assessment",
        artifactId: context.analysis.id,
        fieldPath: "gates.revisitConditionMapping",
      },
      {
        artifactType: "belief_assessment",
        artifactId: context.analysis.id,
        fieldPath: "gates.actionDelta",
      },
    ],
    sourceRefs: [sample, ...mappingSources, ...triggerSources],
  }];
}

function counterargumentClaims(context: ProjectionContext): ClaimInput[] {
  const assessment = requireAssessment(context);
  const gate = assessment.gates.counterevidence;
  if (!gate.statement.trim() || gate.citedSourceIds.length === 0) {
    fail("finalized_artifact_missing", [{
      artifactType: "belief_assessment",
      artifactId: context.analysis.id,
      fieldPath: "gates.counterevidence",
    }]);
  }
  const sourceRefs = exactSources(context, gate.citedSourceIds);
  let textClass: FinalizedChatTextClass = "persisted_inference";
  if (sourceRefs.every((source) =>
    source.text.status === "verified_exact"
    && source.text.verbatimExcerpt === gate.statement
  )) {
    textClass = "exact_quote";
  } else if (sourceRefs.every((source) =>
    source.text.status === "normalized_only"
    && source.text.normalizedStatement === gate.statement
  )) {
    textClass = "normalized_statement";
  }
  return [{
    text: gate.statement,
    textClass,
    artifactRefs: [{
      artifactType: "belief_assessment",
      artifactId: context.analysis.id,
      fieldPath: "gates.counterevidence.statement",
    }],
    sourceRefs,
  }];
}

function matchConfidenceClaims(context: ProjectionContext): ClaimInput[] {
  const assessment = requireAssessment(context);
  const score = assessment.scoreBreakdown;
  const gates = assessment.gates;
  const namedGates = [
    ["chronology", gates.chronology],
    ["revisitConditionMapping", gates.revisitConditionMapping],
    ["counterevidence", gates.counterevidence],
    ["actionDelta", gates.actionDelta],
  ] as const;
  const failures = namedGates.flatMap(([name, gate]) =>
    gate.failureReason === null ? [] : [`${name}=${gate.failureReason}`]
  );
  const text = [
    `Match confidence: ${score.confidence}; final score=${score.finalScore}.`,
    "Thresholds: medium>=0.5; high>=0.78.",
    `Dimensions: eventRelevance=${score.eventRelevance} (weight 0.35); dealRelevance=${score.dealRelevance} (weight 0.30); priorContextStrength=${score.priorContextStrength} (weight 0.20); evidenceQuality=${score.evidenceQuality} (weight 0.15).`,
    `Hard gates: ${namedGates.map(([name, gate]) =>
      `${name}=${gate.passed ? "passed" : "failed"}`
    ).join("; ")}; allPassed=${gates.allPassed}.`,
    `Failures: ${failures.length === 0 ? "none" : failures.join("; ")}.`,
  ].join(" ");
  return [{
    text,
    textClass: "persisted_inference",
    artifactRefs: [{
      artifactType: "match_assessment",
      artifactId: context.analysis.id,
      fieldPath: "beliefAssessment.scoreBreakdown",
    }],
  }];
}

function frameworkDisagreementClaims(context: ProjectionContext): ClaimInput[] {
  const bundle = requireBundle(context, "framework_disagreement");
  if (bundle.disagreements.length === 0) {
    fail("finalized_artifact_missing", [{
      artifactType: "framework_disagreement",
      artifactId: bundle.candidateRunId,
      fieldPath: "disagreements",
    }]);
  }
  const claims: ClaimInput[] = [];
  const judgmentIds = new Set<string>();
  for (const disagreement of bundle.disagreements) {
    const left = exactJudgment(bundle, disagreement.leftJudgmentId);
    const right = exactJudgment(bundle, disagreement.rightJudgmentId);
    for (const judgment of [left, right]) {
      if (judgmentIds.has(judgment.id)) continue;
      judgmentIds.add(judgment.id);
      claims.push(frameworkJudgmentClaim(context, bundle, judgment));
    }
    claims.push({
      text: disagreement.explanation,
      textClass: "persisted_inference",
      artifactRefs: [{
        artifactType: "framework_disagreement",
        artifactId: disagreement.id,
        fieldPath: "explanation",
      }, {
        artifactType: "framework_judgment",
        artifactId: left.id,
        fieldPath: "conclusion",
      }, {
        artifactType: "framework_judgment",
        artifactId: right.id,
        fieldPath: "conclusion",
      }],
      sourceRefs: evidenceSourcesForItemIds(
        context,
        bundle,
        disagreement.evidenceItemIds,
      ),
    });
  }
  return claims;
}

function frameworkJudgmentClaim(
  context: ProjectionContext,
  bundle: CandidateArtifactBundle,
  judgment: FrameworkJudgment,
): ClaimInput {
  const text = [
    `Framework ${judgment.frameworkCardId}@${judgment.frameworkVersion}: ${judgment.conclusion}.`,
    `Strongest support: ${judgment.strongestSupport ?? "Unavailable"}.`,
    `Strongest counterargument: ${judgment.strongestCounterargument ?? "Unavailable"}.`,
  ].join(" ");
  return {
    text,
    textClass: "persisted_inference",
    artifactRefs: [{
      artifactType: "framework_judgment",
      artifactId: judgment.id,
      fieldPath: "conclusion",
    }],
    sourceRefs: evidenceSourcesForItemIds(context, bundle, [
      ...judgment.supportEvidenceItemIds,
      ...judgment.counterEvidenceItemIds,
    ]),
  };
}

function valuationClaims(context: ProjectionContext): ClaimInput[] {
  const bundle = requireBundle(context, "valuation");
  const valuation = bundle.valuation;
  const availableValues = valuation.scenarios.flatMap(({ valuation }) =>
    valuation === null ? [] : [valuation]
  );
  if (valuation.status === "unavailable" || availableValues.length === 0) {
    return [{
      text: `Valuation: Unavailable. Blockers: ${
        valuation.blockerCodes.join(", ") || "No saved blocker code"
      }.`,
      textClass: "persisted_inference",
      artifactRefs: [{
        artifactType: "valuation_evaluation",
        artifactId: valuation.id,
        fieldPath: "status",
      }],
    }];
  }
  const scenarioText = valuation.scenarios.map((scenario) =>
    `${capitalize(scenario.name)}=${scenario.valuation ?? "Unavailable"}`
  ).join("; ");
  const text = [
    `Valuation status=${valuation.status}. ${scenarioText}.`,
    `Current ask=${valuation.currentAsk ?? "Unavailable"}.`,
    `Maximum acceptable pre-money=${valuation.maximumAcceptablePreMoney ?? "Unavailable"}.`,
    `Initial ownership=${valuation.initialOwnership ?? "Unavailable"}; post-dilution ownership=${valuation.postDilutionOwnership ?? "Unavailable"}.`,
    `Gross MOIC=${valuation.grossMoic ?? "Unavailable"}; gross IRR=${valuation.grossIrr ?? "Unavailable"}.`,
    `Pricing premium=${valuation.pricingPremium ?? "Unavailable"}.`,
  ].join(" ");
  const calculations = valuation.calculationIds.map((calculationId) => {
    const calculation = bundle.calculations.find(({ id }) => id === calculationId);
    if (!calculation) {
      fail("source_lineage_incomplete", [{
        artifactType: "calculation",
        artifactId: calculationId,
        fieldPath: "id",
      }]);
    }
    return calculation;
  });
  return [{
    text,
    textClass: "persisted_inference",
    artifactRefs: [{
      artifactType: "valuation_evaluation",
      artifactId: valuation.id,
      fieldPath: "scenarios",
    }, ...calculations.map((calculation) => ({
      artifactType: "calculation" as const,
      artifactId: calculation.id,
      fieldPath: "output",
    }))],
    sourceRefs: evidenceSourcesForItemIds(
      context,
      bundle,
      calculations.flatMap((calculation) =>
        calculation.inputRefs.map(({ itemId }) => itemId)
      ),
    ),
  }];
}

function missingEvidenceClaims(context: ProjectionContext): ClaimInput[] {
  const bundle = requireBundle(context, "missing_evidence");
  const coverage = bundle.evidencePack.coverage;
  const claims: ClaimInput[] = [{
    text: [
      `Evidence coverage status=${coverage.underwritingStatus}.`,
      `Missing fields: ${coverage.missingFieldIds.join(", ") || "none"}.`,
      `Blocking conflicts: ${coverage.blockingConflictIds.join(", ") || "none"}.`,
      `Decision ceiling: ${coverage.decisionCeiling ?? "Unavailable"}.`,
      `Reason codes: ${coverage.reasonCodes.join(", ") || "none"}.`,
    ].join(" "),
    textClass: "persisted_inference",
    artifactRefs: [{
      artifactType: "evidence_pack",
      artifactId: bundle.evidencePack.id,
      fieldPath: "coverage",
    }],
  }];

  const v2Drafts = bundle.actionDrafts.filter(
    (draft): draft is ActionDraftV2 => "schemaVersion" in draft,
  );
  const savedMissingFieldIds = new Set(v2Drafts.flatMap((draft) =>
    draft.missingEvidence.map(({ fieldId }) => fieldId)
  ));
  if (coverage.missingFieldIds.some((fieldId) =>
    !savedMissingFieldIds.has(fieldId)
  )) {
    fail("finalized_artifact_missing", [{
      artifactType: "missing_evidence",
      artifactId: bundle.evidencePack.id,
      fieldPath: "coverage.missingFieldIds",
    }]);
  }
  const seenMissing = new Set<string>();
  for (const draft of v2Drafts) {
    for (const missing of draft.missingEvidence) {
      const key = [
        missing.fieldId,
        missing.label,
        missing.reasonCode,
        missing.mostLikelyDecisionImpact,
      ].join("\u0000");
      if (seenMissing.has(key)) continue;
      seenMissing.add(key);
      claims.push({
        text: `Missing evidence ${missing.label}: ${missing.reasonCode}. ${missing.mostLikelyDecisionImpact}`,
        textClass: "persisted_inference",
        artifactRefs: [{
          artifactType: "missing_evidence",
          artifactId: `${draft.id}:${missing.fieldId}`,
          fieldPath: "label",
        }, {
          artifactType: "action_draft",
          artifactId: draft.id,
          fieldPath: "missingEvidence",
        }],
      });
    }
  }

  for (const conflictId of coverage.blockingConflictIds) {
    const conflict = bundle.evidencePack.conflicts.find(({ id }) => id === conflictId);
    if (!conflict) {
      fail("source_lineage_incomplete", [{
        artifactType: "evidence_pack",
        artifactId: bundle.evidencePack.id,
        fieldPath: "coverage.blockingConflictIds",
      }]);
    }
    const facts = [conflict.leftFactId, conflict.rightFactId].map((factId) =>
      requireFact(bundle, factId)
    );
    claims.push({
      text: `Fact conflict ${conflict.field}: ${facts.map((fact) =>
        `${fact.id}=${fact.value}`
      ).join(" versus ")}.`,
      textClass: "persisted_inference",
      artifactRefs: facts.map((fact) => ({
        artifactType: "fact" as const,
        artifactId: fact.id,
        fieldPath: "value",
      })),
      sourceRefs: facts.map((fact) => sourceForFact(context, fact)),
    });
  }

  for (const assumption of bundle.evidencePack.assumptions) {
    claims.push({
      text: `Assumption ${assumption.field}=${assumption.value} (${assumption.scenario}): ${assumption.rationale}`,
      textClass: "persisted_inference",
      artifactRefs: [{
        artifactType: "assumption",
        artifactId: assumption.id,
        fieldPath: "value",
      }],
    });
  }
  for (const calculation of bundle.calculations) {
    claims.push({
      text: `Calculation ${calculation.formulaId}@${calculation.formulaVersion}: output=${calculation.output} ${calculation.unit}; status=${calculation.status}.`,
      textClass: "persisted_inference",
      artifactRefs: [{
        artifactType: "calculation",
        artifactId: calculation.id,
        fieldPath: "output",
      }],
      sourceRefs: evidenceSourcesForItemIds(
        context,
        bundle,
        calculation.inputRefs.map(({ itemId }) => itemId),
      ),
    });
  }
  return claims;
}

function investedActionClaims(context: ProjectionContext): ClaimInput[] {
  if (context.analysis.dealStatus !== "invested") {
    fail("not_invested", [analysisRef(context, "dealStatus")]);
  }
  const assessment = requireAssessment(context);
  const bundle = requireBundle(context, "invested_action");
  const expectedActions = actionsForDealStatusAndDirection(
    "invested",
    assessment.direction,
  );
  const snapshot = bundle.versionSnapshot;
  const v2Drafts = bundle.actionDrafts.filter(
    (draft): draft is ActionDraftV2 => "schemaVersion" in draft,
  );
  if (
    !beliefActionListsEqual(assessment.actions, expectedActions)
    || snapshot.dealStatus !== "invested"
    || snapshot.beliefDirection !== assessment.direction
    || snapshot.actionPolicyVersion !== "belief-action-policy-v1"
    || snapshot.canonicalActions === undefined
    || !beliefActionListsEqual(snapshot.canonicalActions, expectedActions)
    || v2Drafts.length === 0
    || v2Drafts.some((draft) =>
      draft.dealStatus !== "invested"
      || draft.beliefDirection !== assessment.direction
      || !beliefActionListsEqual(draft.actions, expectedActions)
    )
  ) {
    fail("artifact_mismatch", [{
      artifactType: "action_policy",
      artifactId: snapshot.actionPolicyVersion ?? "missing_action_policy",
      fieldPath: "canonicalActions",
    }]);
  }
  const actionText = `Typed invested action (separate from formal underwriting): ${
    renderActionKinds(expectedActions)
  }.`;
  const decisionText = bundle.decision.decision === null
    ? "Formal underwriting decision: Unavailable."
    : `Formal underwriting decision: ${bundle.decision.decision}.`;
  return [{
    text: actionText,
    textClass: "persisted_inference",
    artifactRefs: [{
      artifactType: "belief_assessment",
      artifactId: context.analysis.id,
      fieldPath: "actions",
    }, {
      artifactType: "action_policy",
      artifactId: snapshot.actionPolicyVersion,
      fieldPath: "canonicalActions",
    }, ...v2Drafts.map((draft) => ({
      artifactType: "action_draft" as const,
      artifactId: draft.id,
      fieldPath: "actions",
    }))],
  }, {
    text: decisionText,
    textClass: "persisted_inference",
    artifactRefs: [{
      artifactType: "decision_result",
      artifactId: bundle.decision.id,
      fieldPath: "decision",
    }],
  }];
}

function exactSampleSource(context: ProjectionContext): FinalizedChatSourceRef & {
  text: { status: "normalized_only"; normalizedStatement: string };
} {
  const fixtures = context.analysis.investmentMemory.fixtureIds;
  if (fixtures.length === 0) {
    fail("finalized_artifact_missing", [analysisRef(context, "investmentMemory.fixtureIds")]);
  }
  if (context.requestMode !== "public_sandbox") {
    fail("demo_fixture_forbidden", [analysisRef(context, "investmentMemory.fixtureIds")]);
  }
  if (
    fixtures.length !== 1
    || !context.analysis.investmentMemory.sourceIds.includes(fixtures[0])
  ) {
    fail("source_lineage_incomplete", [analysisRef(context, "investmentMemory")]);
  }
  const source = context.sourceById.get(fixtures[0]);
  const expectedStatement = renderSampleDecisionStatement({
    summary: context.analysis.investmentMemory.previousMeetingSummary,
    decisionReason: context.analysis.investmentMemory.decisionReason,
    concerns: context.analysis.investmentMemory.concerns,
    revisitConditions: context.analysis.investmentMemory.revisitConditions,
  });
  if (
    source === undefined
    || !("schemaVersion" in source)
    || source.adaptation !== "canonical"
    || source.provenance !== "demo_fixture"
    || source.title !== "Sample decision record"
    || source.providerId !== "deal-registry"
    || source.sourceClass !== "internal_decision_record"
    || source.sourceAuthority !== "primary"
    || source.evidenceRole !== "context"
    || source.documentId === null
    || source.sourceRevisionId === null
    || source.contentFingerprint === null
    || source.text.status !== "normalized_only"
    || source.text.normalizedStatement !== expectedStatement
    || source.eventAt !== context.analysis.investmentMemory.lastEvaluatedAt
    || !context.analysis.companyBrief.sourceLineage.some((candidate) =>
      candidate.id === source.id
      && "schemaVersion" in candidate
      && candidate.sourceRevisionId === source.sourceRevisionId
      && candidate.contentFingerprint === source.contentFingerprint
    )
    || (
      context.analysis.beliefAssessment !== undefined
      && !context.analysis.beliefAssessment.gateContext.sources.some((candidate) =>
        candidate.id === source.id
        && candidate.sourceRevisionId === source.sourceRevisionId
        && candidate.contentFingerprint === source.contentFingerprint
      )
    )
  ) {
    fail("source_lineage_incomplete", [analysisRef(context, "investmentMemory.fixtureIds")]);
  }
  return toFinalizedSourceRef(source) as FinalizedChatSourceRef & {
    text: { status: "normalized_only"; normalizedStatement: string };
  };
}

function exactSources(
  context: ProjectionContext,
  sourceIds: readonly string[],
): FinalizedChatSourceRef[] {
  if (sourceIds.length === 0 || new Set(sourceIds).size !== sourceIds.length) {
    fail("source_lineage_incomplete", [analysisRef(context, "sources")]);
  }
  return sourceIds.map((sourceId) => {
    const source = context.sourceById.get(sourceId);
    if (!source) {
      fail("source_lineage_incomplete", [analysisRef(context, "sources")]);
    }
    return toFinalizedSourceRef(source);
  });
}

function toFinalizedSourceRef(source: EvidenceSourceRef): FinalizedChatSourceRef {
  if (
    !("schemaVersion" in source)
    || source.adaptation !== "canonical"
    || source.sourceRevisionId === null
    || source.contentFingerprint === null
    || (
      source.text.status !== "verified_exact"
      && source.text.status !== "normalized_only"
    )
  ) {
    fail("source_lineage_incomplete", [{
      artifactType: "company_analysis",
      artifactId: source.id,
      fieldPath: "sourceRevisionId",
    }]);
  }
  return {
    sourceId: source.id,
    documentId: source.documentId,
    sourceRevisionId: source.sourceRevisionId,
    contentFingerprint: source.contentFingerprint,
    canonicalSource: structuredClone(source),
    text: structuredClone(source.text),
  };
}

function sourceForFact(
  context: ProjectionContext,
  fact: Fact,
): FinalizedChatSourceRef {
  const matches = context.analysis.sources.filter((source) =>
    "schemaVersion" in source
    && source.sourceRevisionId === fact.sourceRevisionId
  );
  if (matches.length !== 1) {
    fail("source_lineage_incomplete", [{
      artifactType: "fact",
      artifactId: fact.id,
      fieldPath: "sourceRevisionId",
    }]);
  }
  return toFinalizedSourceRef(matches[0]);
}

function evidenceSourcesForItemIds(
  context: ProjectionContext,
  bundle: CandidateArtifactBundle,
  itemIds: readonly string[],
): FinalizedChatSourceRef[] {
  const refs: FinalizedChatSourceRef[] = [];
  for (const itemId of [...new Set(itemIds)]) {
    const fact = bundle.evidencePack.facts.find(({ id }) => id === itemId);
    if (fact) {
      refs.push(sourceForFact(context, fact));
      continue;
    }
    if (bundle.evidencePack.assumptions.some(({ id }) => id === itemId)) {
      continue;
    }
    const calculation = bundle.calculations.find(({ id }) => id === itemId);
    if (calculation) {
      refs.push(...evidenceSourcesForItemIds(
        context,
        bundle,
        calculation.inputRefs.map(({ itemId: inputId }) => inputId),
      ));
      continue;
    }
    fail("source_lineage_incomplete", [{
      artifactType: "evidence_pack",
      artifactId: bundle.evidencePack.id,
      fieldPath: "facts",
    }]);
  }
  return uniqueSourceRefs(refs);
}

function requireFact(
  bundle: CandidateArtifactBundle,
  factId: string,
): Fact {
  const fact = bundle.evidencePack.facts.find(({ id }) => id === factId);
  if (!fact) {
    fail("source_lineage_incomplete", [{
      artifactType: "evidence_pack",
      artifactId: bundle.evidencePack.id,
      fieldPath: "facts",
    }]);
  }
  return fact;
}

function exactJudgment(
  bundle: CandidateArtifactBundle,
  judgmentId: string,
): FrameworkJudgment {
  const matches = bundle.judgments.filter(({ id }) => id === judgmentId);
  if (matches.length !== 1) {
    fail("source_lineage_incomplete", [{
      artifactType: "framework_judgment",
      artifactId: judgmentId,
      fieldPath: "id",
    }]);
  }
  return matches[0];
}

function requireAssessment(context: ProjectionContext) {
  if (!context.analysis.beliefAssessment) {
    fail("finalized_artifact_missing", [{
      artifactType: "belief_assessment",
      artifactId: context.analysis.id,
      fieldPath: "beliefAssessment",
    }]);
  }
  return context.analysis.beliefAssessment;
}

function requireBundle(
  context: ProjectionContext,
  fieldPath: string,
): CandidateArtifactBundle {
  if (!context.bundle) {
    fail("finalized_artifact_missing", [{
      artifactType: "evidence_pack",
      artifactId: context.identity.candidateRunId,
      fieldPath,
    }]);
  }
  return context.bundle;
}

function analysisRef(
  context: Pick<ProjectionContext, "analysis">,
  fieldPath: string,
): FinalizedChatArtifactRef {
  return {
    artifactType: "company_analysis",
    artifactId: context.analysis.id,
    fieldPath,
  };
}

function bundleRef(
  context: Pick<ProjectionContext, "bundle" | "identity">,
  fieldPath: string,
): FinalizedChatArtifactRef {
  return {
    artifactType: "evidence_pack",
    artifactId: context.bundle?.evidencePack.id
      ?? context.identity.candidateRunId,
    fieldPath,
  };
}

function insufficient(
  context: ProjectionContext,
  reasonCode: FinalizedChatInsufficientReasonCode,
  refs: FinalizedChatArtifactRef[],
): FinalizedChatProjectionBuildResult {
  return FinalizedChatProjectionBuildResultSchema.parse({
    status: "insufficient",
    topic: context.topic,
    reasonCode,
    missingArtifactRefs: uniqueArtifactRefs(
      refs.length > 0 ? refs : [analysisRef(context, "id")],
    ),
    identity: structuredClone(context.identity),
    evidenceFrame: structuredClone(context.evidenceFrame),
  });
}

function fail(
  reasonCode: FinalizedChatInsufficientReasonCode,
  refs: FinalizedChatArtifactRef[],
): never {
  throw new ProjectionFailure(reasonCode, refs);
}

function uniqueArtifactRefs(
  refs: readonly FinalizedChatArtifactRef[],
): FinalizedChatArtifactRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.artifactType}\u0000${ref.artifactId}\u0000${ref.fieldPath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((ref) => structuredClone(ref));
}

function uniqueSourceRefs(
  refs: readonly FinalizedChatSourceRef[],
): FinalizedChatSourceRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.sourceId}\u0000${ref.sourceRevisionId}\u0000${ref.contentFingerprint}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((ref) => structuredClone(ref));
}

function renderActionKinds(actions: readonly BeliefAction[]): string {
  return actions.map(({ kind, scope, priority, visibility }) =>
    `${kind}{scope=${scope}, priority=${priority}, visibility=${visibility}}`
  ).join(", ");
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
