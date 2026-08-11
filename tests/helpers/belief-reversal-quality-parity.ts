import { isDeepStrictEqual } from "node:util";

import {
  DecisionCriticalEvidenceProjectionSchema,
  NamedLensProviderAttemptRefSchema,
  NamedLensProviderAttemptSchema,
} from "../../lib/contracts/named-lens";
import {
  FrameworkJudgmentSchema,
} from "../../lib/contracts/underwriting";
import { createCanonicalFingerprint } from
  "../../lib/underwriting/fingerprints";
import {
  createDecisionCriticalEvidenceProjectionFingerprint,
} from "../../lib/underwriting/named-lens-presentation";
import {
  validateNamedLensFinalization,
  type CurrentCandidateArtifactBundle,
} from "../../db/repositories/underwriting-artifacts";
import {
  SYNTHETIC_FRAMEWORK_PACK,
} from "../../seed/underwriting/framework-pack-v1";
import {
  APPROVED_PINNED_DEMO_SNAPSHOT_ID,
} from "../../lib/contracts/evidence-context";
import {
  PINNED_THIRTY_DEAL_SNAPSHOT_ID,
  loadPinnedThirtyDealSnapshotPackage,
} from "../../lib/belief-reversal/pinned-thirty-deal-snapshot";

type UnknownRecord = Record<string, unknown>;

const SCENARIO_FIELDS = new Set([
  "revenue_path",
  "arr_path",
  "growth",
  "gross_margin",
  "contribution_margin",
  "operating_expenses",
  "burn",
  "cash",
  "runway",
  "future_financing",
  "future_dilution",
  "exit_timing",
  "exit_method",
  "exit_multiple",
  "success_conditions",
  "failure_conditions",
  "probability",
]);

const RUN_IDENTITY_FIELDS = new Set([
  "runId",
  "reportId",
  "scanRunId",
  "batchId",
  "candidateRunId",
  "artifactCandidateRunId",
  "rerunOfId",
  "workerId",
  "leaseToken",
]);

const LIFECYCLE_TIMESTAMP_FIELDS = new Set([
  "createdAt",
  "updatedAt",
  "startedAt",
  "completedAt",
  "finalizedAt",
  "leaseExpiresAt",
  "computedAt",
  "extractedAt",
]);

const RUN_DERIVED_FINGERPRINT_FIELDS = new Set([
  "batchInputFingerprint",
  "candidateAnalysisFingerprint",
]);

const EVIDENCE_BINDING_FIELDS = new Set([
  "evidenceMode",
  "snapshotId",
  "snapshotFingerprint",
  "contextFingerprint",
  "bindingFingerprint",
  "evidenceBindingFingerprint",
  "anchorAt",
  "windowStartAt",
  "windowEndAt",
]);

const EXTERNAL_DRAFT_MARKERS: Record<string, (body: string) => boolean> = {
  internal_memo: (body) =>
    body.startsWith("INTERNAL UNDERWRITING ACTION MEMO — DRAFT ONLY"),
  founder_email: (body) =>
    body.startsWith("DRAFT ONLY — NOT SENT")
    || body.includes("\n\nDRAFT ONLY — NOT SENT\n"),
  founder_sms: (body) => body.startsWith("DRAFT ONLY — NOT SENT."),
  founder_linkedin: (body) => body.startsWith("DRAFT ONLY — NOT SENT"),
  diligence_request: (body) =>
    body.startsWith(
      "DUE DILIGENCE EVIDENCE REQUEST — DRAFT ONLY — NOT SENT",
    ),
};

const RUN_BOUND_FINGERPRINT_ALIAS_PREFIX = "\u0000run-fingerprint\u0000";
const PINNED_THIRTY_SCREENING_DEAL_IDS = new Set(
  loadPinnedThirtyDealSnapshotPackage().screeningDeals.map(({ dealId }) =>
    dealId
  ),
);

export class BeliefReversalQualityParityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BeliefReversalQualityParityError";
  }
}

interface ValidatedPass {
  pass: UnknownRecord;
  analysisByDeal: Map<string, UnknownRecord>;
  opportunityByDeal: Map<string, UnknownRecord>;
  selectionByDeal: Map<string, UnknownRecord>;
  selectedDeals: Set<string>;
  candidateByDeal: Map<string, UnknownRecord>;
  artifactByDeal: Map<string, UnknownRecord>;
  caseByDeal: Map<string, UnknownRecord>;
}

const OUTCOME_COUNT_FIELDS = {
  belief_revised: "beliefRevised",
  monitor: "monitor",
  no_material_change: "noMaterialChange",
  analysis_unavailable: "analysisUnavailable",
} as const;

/**
 * Fails unless a 30-Deal cold live pass retains the complete canonical
 * semantics of the immutable 23-Deal pinned baseline and derives every
 * terminal underwriting result from the same score/gate policy. The
 * projection deliberately ignores identities, lifecycle metadata, evidence
 * bindings, and the typed current-run audit envelope that are expected to
 * change per run. Each pass validates that audit envelope independently;
 * the parity projection compares the resulting report semantics.
 */
export function assertBeliefReversalQualityParity(
  liveInput: unknown,
  pinnedInput: unknown,
): void {
  const live = requireRecord(liveInput, "live pass");
  const pinned = requireRecord(pinnedInput, "pinned baseline");
  const pinnedContract = pinnedBaselineContract(pinned);
  const pinnedPass = validateCompletePass(
    pinned,
    "pinned baseline",
    pinnedContract.expectedAnalysisCount,
    pinnedContract.underwritingMode,
  );
  const livePass = validateCompletePass(
    live,
    "live pass",
    30,
    "all_belief_revised",
  );

  const pinnedDeals = new Set(pinnedPass.analysisByDeal.keys());
  const liveDeals = new Set(livePass.analysisByDeal.keys());
  assertExactPinnedThirtyScreeningDeals(livePass, "live pass");
  if (pinnedContract.kind === "current_30") {
    assertExactPinnedThirtyScreeningDeals(pinnedPass, "pinned baseline");
  }
  if ([...pinnedDeals].some((dealId) => !liveDeals.has(dealId))) {
    fail("live pass must preserve all 23 pinned CompanyAnalysis Deal identities");
  }
  const addedLiveDeals = [...liveDeals].filter((dealId) => !pinnedDeals.has(dealId));
  if (
    (pinnedContract.kind === "legacy_23" && addedLiveDeals.length !== 7)
    || (pinnedContract.kind === "current_30" && addedLiveDeals.length !== 0)
  ) {
    fail(
      pinnedContract.kind === "legacy_23"
        ? "live pass must add exactly seven screened Deal analyses"
        : "live pass and pinned-30 baseline must use the same 30-Deal universe",
    );
  }

  const qualityComparisonDeals = new Set(
    [...pinnedPass.analysisByDeal.keys()].filter((dealId) =>
      pinnedContract.kind === "legacy_23"
      || !PINNED_THIRTY_SCREENING_DEAL_IDS.has(dealId)
    ),
  );
  if (qualityComparisonDeals.size !== 23) {
    fail("quality parity requires the exact 23 non-screening Deal identities");
  }

  const commonUnderwritingDeals = new Set(
    [...pinnedPass.selectedDeals].filter((dealId) =>
      livePass.selectedDeals.has(dealId)
    ),
  );
  const liveProjection = projectSharedQuality(
    livePass,
    qualityComparisonDeals,
    commonUnderwritingDeals,
  );
  const pinnedProjection = projectSharedQuality(
    pinnedPass,
    qualityComparisonDeals,
    commonUnderwritingDeals,
  );
  if (isDeepStrictEqual(liveProjection, pinnedProjection)) return;

  const difference = firstDifference(liveProjection, pinnedProjection, "$");
  const path = difference?.path ?? "$";
  throw new BeliefReversalQualityParityError(
    `Belief-reversal quality parity mismatch at ${path}: `
      + `live=${summarize(difference?.left ?? projectionSummary(liveProjection))} `
      + `pinned=${summarize(difference?.right ?? projectionSummary(pinnedProjection))}`,
  );
}

function assertExactPinnedThirtyScreeningDeals(
  pass: ValidatedPass,
  label: string,
): void {
  if (PINNED_THIRTY_SCREENING_DEAL_IDS.size !== 7) {
    fail("the reviewed pinned-30 package must define exactly seven screening Deals");
  }
  for (const dealId of PINNED_THIRTY_SCREENING_DEAL_IDS) {
    const analysis = pass.analysisByDeal.get(dealId);
    if (!analysis || analysis.dealStatus !== "screening") {
      fail(
        `${label} must retain reviewed screening Deal ${dealId} with screening status`,
      );
    }
  }
}

function pinnedBaselineContract(pass: UnknownRecord): {
  kind: "legacy_23" | "current_30";
  expectedAnalysisCount: 23 | 30;
  underwritingMode: "legacy_pinned_top_five" | "all_belief_revised";
} {
  const report = requireRecord(pass.report, "pinned baseline.report");
  const evidenceContext = requireRecord(
    report.evidenceContext,
    "pinned baseline.report.evidenceContext",
  );
  if (
    evidenceContext.state !== "current"
    || evidenceContext.evidenceMode !== "pinned"
  ) {
    fail("pinned baseline must use a current pinned evidence context");
  }
  if (evidenceContext.snapshotId === APPROVED_PINNED_DEMO_SNAPSHOT_ID) {
    return {
      kind: "legacy_23",
      expectedAnalysisCount: 23,
      underwritingMode: "legacy_pinned_top_five",
    };
  }
  if (evidenceContext.snapshotId === PINNED_THIRTY_DEAL_SNAPSHOT_ID) {
    return {
      kind: "current_30",
      expectedAnalysisCount: 30,
      underwritingMode: "all_belief_revised",
    };
  }
  fail("pinned baseline uses an unreviewed snapshot identity");
}

function validateCompletePass(
  pass: UnknownRecord,
  label: string,
  expectedAnalysisCount: 23 | 30,
  underwritingMode: "legacy_pinned_top_five" | "all_belief_revised",
): ValidatedPass {
  const report = requireRecord(pass.report, `${label}.report`);
  const analyses = requireArray(
    report.companyAnalyses,
    `${label}.report.companyAnalyses`,
  );
  if (analyses.length !== expectedAnalysisCount) {
    fail(`${label} must contain exactly ${expectedAnalysisCount} company analyses`);
  }
  const opportunities = requireArray(
    report.opportunities,
    `${label}.report.opportunities`,
  );

  const analysisByDeal = new Map<string, UnknownRecord>();
  const outcomeCounts = new Map<string, number>(
    Object.keys(OUTCOME_COUNT_FIELDS).map((outcome) => [outcome, 0]),
  );
  analyses.forEach((value, index) => {
    const path = `${label}.report.companyAnalyses[${index}]`;
    const item = requireRecord(value, path);
    const dealId = requireString(item.dealId, `${path}.dealId`);
    if (analysisByDeal.has(dealId)) fail(`${path} duplicates Deal ${dealId}`);
    analysisByDeal.set(dealId, item);
    requireFiniteNumber(item.score, `${path}.score`);
    requireString(item.confidence, `${path}.confidence`);
    const outcome = requireString(item.outcome, `${path}.outcome`);
    if (!Object.hasOwn(OUTCOME_COUNT_FIELDS, outcome)) {
      fail(`${path}.outcome is not one of the four canonical outcomes`);
    }
    outcomeCounts.set(outcome, (outcomeCounts.get(outcome) ?? 0) + 1);
    const sources = requireArray(item.sources, `${path}.sources`);
    if (outcome !== "analysis_unavailable" && sources.length === 0) {
      fail(`${path} requires complete source revision coverage`);
    }
    const sourceIds = validateSources(sources, `${path}.sources`);
    if (requireFiniteNumber(
      item.verifiedSourceCount,
      `${path}.verifiedSourceCount`,
    ) !== sourceIds.size) {
      fail(`${path}.verifiedSourceCount does not match source revision coverage`);
    }
    validateCitations(
      item.claimSupport ?? [],
      sourceIds,
      `${path}.claimSupport`,
    );
    if (item.beliefAssessment !== undefined) {
      validateBeliefAssessment(
        item.beliefAssessment,
        `${path}.beliefAssessment`,
        false,
      );
    }
  });

  validateOutcomeCounts({
    counts: report.counts,
    outcomeCounts,
    expectedAnalysisCount,
    path: `${label}.report.counts`,
  });
  const evidenceCoverage = requireRecord(
    report.evidenceCoverage,
    `${label}.report.evidenceCoverage`,
  );
  const recalledDealCount = requireNonnegativeInteger(
    evidenceCoverage.recalledDealCount,
    `${label}.report.evidenceCoverage.recalledDealCount`,
  );
  const unavailableDealCount = requireNonnegativeInteger(
    evidenceCoverage.unavailableDealCount,
    `${label}.report.evidenceCoverage.unavailableDealCount`,
  );
  const structuredFallbackCount = evidenceCoverage.structuredImageFallbackDealCount
      === undefined
    ? 0
    : requireNonnegativeInteger(
      evidenceCoverage.structuredImageFallbackDealCount,
      `${label}.report.evidenceCoverage.structuredImageFallbackDealCount`,
    );
  const expectedUnavailable = outcomeCounts.get("analysis_unavailable") ?? 0;
  if (
    unavailableDealCount !== expectedUnavailable
    || recalledDealCount + structuredFallbackCount + unavailableDealCount
      < expectedAnalysisCount
  ) {
    fail(`${label} must retain full ${expectedAnalysisCount}-Deal analysis coverage`);
  }
  const expectedAnalysisStatus = expectedUnavailable === 0
    ? "completed"
    : "incomplete";
  if (report.analysisStatus !== expectedAnalysisStatus) {
    fail(`${label}.report.analysisStatus does not match unavailable outcomes`);
  }

  const beliefRevised = [...analysisByDeal.values()]
    .filter((item) => item.outcome === "belief_revised")
    .map((item) => {
      if (!isCompleteBeliefReversal(item)) {
        fail(
          `${label}.report.companyAnalyses(${String(item.dealId)}) `
            + "marks belief_revised without complete score, confidence, direction, gates, and actions",
        );
      }
      return item;
    })
    .sort((left, right) => {
      const scoreDelta = requireFiniteNumber(right.score, "derived score")
        - requireFiniteNumber(left.score, "derived score");
      if (scoreDelta !== 0) return scoreDelta;
      return compareText(
        requireString(left.dealId, "derived Deal"),
        requireString(right.dealId, "derived Deal"),
      );
    });
  const derived = underwritingMode === "legacy_pinned_top_five"
    ? beliefRevised.slice(0, 5)
    : beliefRevised;
  const derivedDealIds = derived.map((item) =>
    requireString(item.dealId, `${label}.derived.dealId`)
  );
  const selectedDeals = new Set(derivedDealIds);
  if (opportunities.length !== selectedDeals.size) {
    fail(
      `${label}.report.opportunities must equal ${underwritingMode === "all_belief_revised"
        ? "every belief_revised analysis"
        : "the immutable legacy Top-5 projection"}`,
    );
  }

  const opportunityByDeal = new Map<string, UnknownRecord>();
  opportunities.forEach((value, index) => {
    const path = `${label}.report.opportunities[${index}]`;
    const item = requireRecord(value, path);
    const dealId = requireString(item.dealId, `${path}.dealId`);
    if (opportunityByDeal.has(dealId)) fail(`${path} duplicates Deal ${dealId}`);
    opportunityByDeal.set(dealId, item);
    const expected = derived[index];
    if (
      !expected
      || dealId !== expected.dealId
      || readPriorityRank(item, path) !== index + 1
      || item.score !== expected.score
      || item.confidence !== expected.confidence
    ) {
      fail(`${path} priority rank must be score-derived with deterministic Deal-ID ties`);
    }
    const sources = requireArray(item.sources, `${path}.sources`);
    if (sources.length === 0) fail(`${path} requires source revision lineage`);
    const sourceIds = validateSources(sources, `${path}.sources`);
    validateCitations(item.claimSupport, sourceIds, `${path}.claimSupport`);

    const analysis = analysisByDeal.get(dealId);
    if (!analysis) fail(`${path} has no matching CompanyAnalysis`);
    if (
      !isDeepStrictEqual(item.sources, analysis.sources)
      || !isDeepStrictEqual(item.claimSupport, analysis.claimSupport)
    ) {
      fail(`${path} source revision and citation coverage must match CompanyAnalysis`);
    }
    validateBeliefAssessment(
      analysis.beliefAssessment,
      `${label}.report.companyAnalyses(${dealId}).beliefAssessment`,
      true,
    );
  });

  const selections = requireArray(pass.selections, `${label}.selections`);
  if (selections.length !== analyses.length) {
    fail(`${label}.selections must cover every analyzed Deal`);
  }
  const selectionByDeal = new Map<string, UnknownRecord>();
  selections.forEach((value, index) => {
    const path = `${label}.selections[${index}]`;
    const item = requireRecord(value, path);
    const dealId = requireString(item.dealId, `${path}.dealId`);
    if (!analysisByDeal.has(dealId) || selectionByDeal.has(dealId)) {
      fail(`${path} must uniquely cover an analyzed Deal`);
    }
    selectionByDeal.set(dealId, item);
    const expectedRank = derivedDealIds.indexOf(dealId);
    const actualRank = readNullablePriorityRank(item, path);
    if (expectedRank === -1) {
      if (item.status !== "not_selected" || actualRank !== null) {
      fail(`${path} creates underwriting for a non-belief-revised Deal`);
      }
    } else if (item.status !== "selected" || actualRank !== expectedRank + 1) {
      fail(`${path} does not match the derived underwriting priority rank`);
    }
  });

  const candidates = requireArray(pass.candidates, `${label}.candidates`);
  if (candidates.length !== selectedDeals.size) {
    fail(
      `${label} terminal underwriting candidate count must equal the `
        + `${underwritingMode === "all_belief_revised"
          ? "beliefRevisedCount"
          : "legacy pinned projection count"}`,
    );
  }
  const candidateByDeal = new Map<string, UnknownRecord>();
  candidates.forEach((value, index) => {
    const path = `${label}.candidates[${index}]`;
    const item = requireRecord(value, path);
    const dealId = requireString(item.dealId, `${path}.dealId`);
    if (!selectedDeals.has(dealId) || candidateByDeal.has(dealId)) {
      fail(`${path} creates a candidate for an unselected or duplicate Deal`);
    }
    if (item.status !== "completed" && item.status !== "partial") {
      fail(`${path} is not a terminal underwriting candidate`);
    }
    candidateByDeal.set(dealId, item);
  });

  const artifacts = requireArray(pass.artifacts, `${label}.artifacts`);
  if (artifacts.length !== selectedDeals.size) {
    fail(`${label} finalized artifact count must equal underwriting candidate count`);
  }
  const artifactByDeal = new Map<string, UnknownRecord>();
  artifacts.forEach((value, index) => {
    const path = `${label}.artifacts[${index}]`;
    const artifact = requireRecord(value, path);
    const dealId = requireString(artifact.dealId, `${path}.dealId`);
    if (!selectedDeals.has(dealId) || artifactByDeal.has(dealId)) {
      fail(`${path} creates an artifact or drafts for an unselected or duplicate Deal`);
    }
    artifactByDeal.set(dealId, artifact);
    const analysis = analysisByDeal.get(dealId)!;
    const assessment = requireRecord(
      analysis.beliefAssessment,
      `${path}.CompanyAnalysis.beliefAssessment`,
    );
    const actionKinds = requireArray(
      assessment.actions,
      `${path}.CompanyAnalysis.beliefAssessment.actions`,
    ).map((action, actionIndex) =>
      requireString(
        requireRecord(
          action,
          `${path}.CompanyAnalysis.beliefAssessment.actions[${actionIndex}]`,
        ).kind,
        `${path}.CompanyAnalysis.beliefAssessment.actions[${actionIndex}].kind`,
      )
    );
    const candidate = candidateByDeal.get(dealId)!;
    validateArtifact(artifact, path, actionKinds, {
      dealId,
      candidateRunId: requireString(candidate.id, `${path}.CandidateRun.id`),
    });
  });
  assertExactDealSet(
    new Set(artifactByDeal.keys()),
    selectedDeals,
    `${label}.artifacts`,
  );

  const cases = requireArray(pass.cases, `${label}.cases`);
  if (cases.length !== selectedDeals.size) {
    fail(`${label} reviewed case count must equal underwriting candidate count`);
  }
  const caseByDeal = new Map<string, UnknownRecord>();
  cases.forEach((value, index) => {
    const path = `${label}.cases[${index}]`;
    const item = requireRecord(value, path);
    const dealId = requireString(item.dealId, `${path}.dealId`);
    if (!selectedDeals.has(dealId) || caseByDeal.has(dealId)) {
      fail(`${path} creates a formal decision for an unselected or duplicate Deal`);
    }
    caseByDeal.set(dealId, item);
    const analysis = analysisByDeal.get(dealId)!;
    const assessment = requireRecord(
      analysis.beliefAssessment,
      `${path}.CompanyAnalysis.beliefAssessment`,
    );
    const expectedRank = derivedDealIds.indexOf(dealId) + 1;
    if (
      readPriorityRank(item, path) !== expectedRank
      || item.score !== analysis.score
      || item.confidence !== analysis.confidence
      || item.direction !== assessment.direction
    ) fail(`${path} does not match its score-derived CompanyAnalysis`);
    const caseActions = requireStringArray(item.actions, `${path}.actions`);
    const assessmentActions = requireArray(
      assessment.actions,
      `${path}.CompanyAnalysis.beliefAssessment.actions`,
    ).map((action, actionIndex) =>
      requireString(
        requireRecord(action, `${path}.assessment.actions[${actionIndex}]`).kind,
        `${path}.assessment.actions[${actionIndex}].kind`,
      )
    );
    if (caseActions.length === 0) {
      fail(`${path}.actions cannot be empty`);
    }
    if (!isDeepStrictEqual(caseActions, assessmentActions)) {
      fail(`${path}.actions do not match the typed CompanyAnalysis actions`);
    }
    const gates = requireRecord(item.gates, `${path}.gates`);
    const assessmentGates = requireRecord(
      assessment.gates,
      `${path}.CompanyAnalysis.beliefAssessment.gates`,
    );
    for (const gate of [
      "chronology",
      "revisitConditionMapping",
      "counterevidence",
      "actionDelta",
    ]) {
      if (
        typeof gates[gate] !== "boolean"
        || gates[gate] !== requireRecord(
          assessmentGates[gate],
          `${path}.CompanyAnalysis.beliefAssessment.gates.${gate}`,
        ).passed
      ) fail(`${path}.gates.${gate} must match the persisted hard gate`);
    }
    if (
      typeof gates.allPassed !== "boolean"
      || gates.allPassed !== assessmentGates.allPassed
    ) fail(`${path}.gates.allPassed must match the persisted hard gates`);

    const candidate = candidateByDeal.get(dealId)!;
    const artifact = artifactByDeal.get(dealId)!;
    const candidateRunId = requireString(candidate.id, `${path}.CandidateRun.id`);
    if (
      item.candidateRunId !== candidateRunId
      || item.artifactCandidateRunId !== candidateRunId
      || item.formalDecision
        !== requireRecord(artifact.decision, `${path}.artifact.decision`).decision
    ) {
      fail(`${path} is not linked to its terminal candidate and formal decision`);
    }
  });
  assertExactDealSet(new Set(caseByDeal.keys()), selectedDeals, `${label}.cases`);

  return {
    pass,
    analysisByDeal,
    opportunityByDeal,
    selectionByDeal,
    selectedDeals,
    candidateByDeal,
    artifactByDeal,
    caseByDeal,
  };
}

function validateBeliefAssessment(
  value: unknown,
  path: string,
  requireActions: boolean,
): void {
  const assessment = requireRecord(value, path);
  requireString(assessment.schemaVersion, `${path}.schemaVersion`);
  requireString(assessment.dealStatus, `${path}.dealStatus`);
  requireString(assessment.direction, `${path}.direction`);
  const scoreBreakdown = requireRecord(
    assessment.scoreBreakdown,
    `${path}.scoreBreakdown`,
  );
  requireFiniteNumber(scoreBreakdown.finalScore, `${path}.scoreBreakdown.finalScore`);
  requireString(scoreBreakdown.confidence, `${path}.scoreBreakdown.confidence`);
  const gates = requireRecord(assessment.gates, `${path}.gates`);
  const individualResults: boolean[] = [];
  for (const gate of [
    "chronology",
    "revisitConditionMapping",
    "counterevidence",
    "actionDelta",
  ]) {
    const result = requireRecord(gates[gate], `${path}.gates.${gate}`);
    if (typeof result.passed !== "boolean") fail(`${path}.gates.${gate}.passed is required`);
    individualResults.push(result.passed);
  }
  if (typeof gates.allPassed !== "boolean") fail(`${path}.gates.allPassed is required`);
  if (gates.allPassed !== individualResults.every(Boolean)) {
    fail(`${path}.gates.allPassed must equal the four persisted hard gates`);
  }
  if (requireActions && requireArray(assessment.actions, `${path}.actions`).length === 0) {
    fail(`${path}.actions cannot be empty`);
  }
  if (!requireActions) requireArray(assessment.actions, `${path}.actions`);
}

function validateOutcomeCounts(input: {
  counts: unknown;
  outcomeCounts: ReadonlyMap<string, number>;
  expectedAnalysisCount: number;
  path: string;
}): void {
  const counts = requireRecord(input.counts, input.path);
  if (
    requireNonnegativeInteger(counts.companyCount, `${input.path}.companyCount`)
      !== input.expectedAnalysisCount
  ) {
    fail(`${input.path}.companyCount must equal ${input.expectedAnalysisCount}`);
  }
  let total = 0;
  for (const [outcome, field] of Object.entries(OUTCOME_COUNT_FIELDS)) {
    const value = requireNonnegativeInteger(counts[field], `${input.path}.${field}`);
    if (value !== input.outcomeCounts.get(outcome)) {
      fail(`${input.path}.${field} does not match CompanyAnalysis outcomes`);
    }
    total += value;
  }
  if (total !== input.expectedAnalysisCount) {
    fail(`${input.path} four outcome counts must total ${input.expectedAnalysisCount}`);
  }
}

function isCompleteBeliefReversal(analysis: UnknownRecord): boolean {
  if (
    analysis.outcome !== "belief_revised"
    || (analysis.confidence !== "medium" && analysis.confidence !== "high")
  ) return false;
  if (!isRecord(analysis.beliefAssessment)) return false;
  const assessment = analysis.beliefAssessment;
  if (
    !["positive", "mixed", "negative"].includes(String(assessment.direction))
    || assessment.dealStatus !== analysis.dealStatus
    || !isRecord(assessment.scoreBreakdown)
    || assessment.scoreBreakdown.finalScore !== analysis.score
    || assessment.scoreBreakdown.confidence !== analysis.confidence
    || !isRecord(assessment.gates)
    || assessment.gates.allPassed !== true
    || !Array.isArray(assessment.actions)
    || assessment.actions.length === 0
  ) return false;
  return [
    "chronology",
    "revisitConditionMapping",
    "counterevidence",
    "actionDelta",
  ].every((gate) =>
    isRecord(assessment.gates)
    && isRecord(assessment.gates[gate])
    && assessment.gates[gate].passed === true
  );
}

function validateArtifact(
  artifact: UnknownRecord,
  path: string,
  actionKinds: readonly string[],
  identity: { dealId: string; candidateRunId: string },
): void {
  if (
    artifact.dealId !== identity.dealId
    || artifact.candidateRunId !== identity.candidateRunId
  ) fail(`${path} is not linked to its selected Deal and CandidateRun`);
  const pack = requireRecord(artifact.evidencePack, `${path}.evidencePack`);
  if (pack.dealId !== identity.dealId) {
    fail(`${path}.evidencePack is not linked to its selected Deal`);
  }
  const sourceRevisionIds = requireStringArray(
    pack.sourceRevisionIds,
    `${path}.evidencePack.sourceRevisionIds`,
  );
  if (sourceRevisionIds.length === 0 || new Set(sourceRevisionIds).size !== sourceRevisionIds.length) {
    fail(`${path}.evidencePack requires unique source revision coverage`);
  }
  const sourceRevisionSet = new Set(sourceRevisionIds);
  const facts = requireArray(pack.facts, `${path}.evidencePack.facts`);
  const assumptions = requireArray(
    pack.assumptions,
    `${path}.evidencePack.assumptions`,
  );
  if (facts.length === 0) fail(`${path}.evidencePack.facts cannot be empty`);
  if (assumptions.length === 0) fail(`${path}.evidencePack.assumptions cannot be empty`);
  const evidenceItemIds = new Set<string>();
  facts.forEach((value, index) => {
    const factPath = `${path}.evidencePack.facts[${index}]`;
    const fact = requireRecord(value, factPath);
    const id = requireString(fact.id, `${factPath}.id`);
    const revisionId = requireString(
      fact.sourceRevisionId,
      `${factPath}.sourceRevisionId`,
    );
    if (!sourceRevisionSet.has(revisionId)) {
      fail(`${factPath} cites a source revision outside the Evidence Pack`);
    }
    addUnique(evidenceItemIds, id, factPath);
  });
  assumptions.forEach((value, index) => {
    const assumptionPath = `${path}.evidencePack.assumptions[${index}]`;
    const id = requireString(
      requireRecord(value, assumptionPath).id,
      `${assumptionPath}.id`,
    );
    addUnique(evidenceItemIds, id, assumptionPath);
  });
  requireArray(pack.conflicts, `${path}.evidencePack.conflicts`);
  const coverage = requireRecord(pack.coverage, `${path}.evidencePack.coverage`);
  requireArray(coverage.missingFieldIds, `${path}.evidencePack.coverage.missingFieldIds`);
  requireArray(
    coverage.blockingConflictIds,
    `${path}.evidencePack.coverage.blockingConflictIds`,
  );
  requireArray(coverage.reasonCodes, `${path}.evidencePack.coverage.reasonCodes`);
  if (!Object.hasOwn(coverage, "decisionCeiling")) {
    fail(`${path}.evidencePack.coverage.decisionCeiling is required`);
  }

  const scenarioModel = requireRecord(
    artifact.scenarioModel,
    `${path}.scenarioModel`,
  );
  if (scenarioModel.candidateRunId !== identity.candidateRunId) {
    fail(`${path}.scenarioModel is not linked to its CandidateRun`);
  }
  const scenarios = requireArray(
    scenarioModel.scenarios,
    `${path}.scenarioModel.scenarios`,
  );
  validateScenarioSet(scenarios, `${path}.scenarioModel.scenarios`, true, evidenceItemIds);

  const valuation = requireRecord(artifact.valuation, `${path}.valuation`);
  const valuationStatus = requireString(
    valuation.status,
    `${path}.valuation.status`,
  );
  const valuationScenarios = requireArray(
    valuation.scenarios,
    `${path}.valuation.scenarios`,
  );
  const calculations = requireArray(artifact.calculations, `${path}.calculations`);
  const calculationClaimEdges = requireArray(
    artifact.calculationClaimEdges,
    `${path}.calculationClaimEdges`,
  );
  if (calculations.length === 0) {
    const valuationCalculationIds = requireStringArray(
      valuation.calculationIds,
      `${path}.valuation.calculationIds`,
    );
    const blockerCodes = requireStringArray(
      valuation.blockerCodes,
      `${path}.valuation.blockerCodes`,
    );
    const reasonCodes = requireStringArray(
      coverage.reasonCodes,
      `${path}.evidencePack.coverage.reasonCodes`,
    );
    const missingModelInputsAuthority =
      coverage.minimumModelInputsComplete === false
      && coverage.underwritingStatus === "unavailable"
      && blockerCodes.includes("MISSING_MINIMUM_MODEL_INPUTS");
    const coreOnlyGeographyAuthority =
      coverage.minimumModelInputsComplete === true
      && coverage.underwritingStatus === "available"
      && blockerCodes.includes("CORE_ONLY_GEOGRAPHY_UNAVAILABLE")
      && reasonCodes.includes("CORE_ONLY_ANALYSIS_CEILING");
    const unavailableScenariosAreClosed = valuationScenarios.every(
      (value, index) => {
        const scenario = requireRecord(
          value,
          `${path}.valuation.scenarios[${index}]`,
        );
        return scenario.valuation === null
          && requireStringArray(
              scenario.calculationIds,
              `${path}.valuation.scenarios[${index}].calculationIds`,
            ).length === 0;
      },
    );
    if (
      valuationStatus !== "unavailable"
      || valuationCalculationIds.length !== 0
      || calculationClaimEdges.length !== 0
      || blockerCodes.length === 0
      || reasonCodes.length === 0
      || (!missingModelInputsAuthority && !coreOnlyGeographyAuthority)
      || !unavailableScenariosAreClosed
    ) {
      fail(
        `${path}.calculations may be empty only for an explicit, reasoned, `
          + "calculation-free unavailable valuation",
      );
    }
  }
  const calculationIds = new Set<string>();
  calculations.forEach((value, index) => {
    const calculationPath = `${path}.calculations[${index}]`;
    const calculation = requireRecord(value, calculationPath);
    addUnique(
      calculationIds,
      requireString(calculation.id, `${calculationPath}.id`),
      calculationPath,
    );
    requireString(calculation.formulaId, `${calculationPath}.formulaId`);
    if (!Object.hasOwn(calculation, "output")) fail(`${calculationPath}.output is required`);
    requireArray(calculation.inputRefs, `${calculationPath}.inputRefs`);
  });
  validateScenarioSet(
    valuationScenarios,
    `${path}.valuation.scenarios`,
    false,
    evidenceItemIds,
  );
  for (const id of requireStringArray(
    valuation.calculationIds,
    `${path}.valuation.calculationIds`,
  )) {
    if (!calculationIds.has(id)) fail(`${path}.valuation cites an unknown calculation`);
  }

  const judgments = requireArray(artifact.judgments, `${path}.judgments`);
  const requiredCoreFrameworkIds = new Set(
    SYNTHETIC_FRAMEWORK_PACK.cards.map(({ id }) => id),
  );
  if (judgments.length < requiredCoreFrameworkIds.size) {
    fail(`${path} requires all eight core framework judgments`);
  }
  const frameworkCardIds = new Set<string>();
  const judgmentIds = new Set<string>();
  judgments.forEach((value, index) => {
    const judgmentPath = `${path}.judgments[${index}]`;
    const judgment = requireRecord(value, judgmentPath);
    addUnique(
      judgmentIds,
      requireString(judgment.id, `${judgmentPath}.id`),
      judgmentPath,
    );
    addUnique(
      frameworkCardIds,
      requireString(judgment.frameworkCardId, `${judgmentPath}.frameworkCardId`),
      judgmentPath,
    );
    requireString(judgment.conclusion, `${judgmentPath}.conclusion`);
    for (const key of [
      "supportEvidenceItemIds",
      "counterEvidenceItemIds",
      "unusedEvidenceItemIds",
    ]) {
      const ids = requireStringArray(judgment[key], `${judgmentPath}.${key}`);
      for (const id of ids) {
        if (!evidenceItemIds.has(id) && !calculationIds.has(id)) {
          fail(`${judgmentPath}.${key} cites unknown underwriting evidence`);
        }
      }
    }
  });
  if ([...requiredCoreFrameworkIds].some((id) => !frameworkCardIds.has(id))) {
    fail(`${path} is missing one or more of the eight core framework judgments`);
  }
  requireArray(artifact.disagreements, `${path}.disagreements`).forEach(
    (value, index) => {
      const disagreementPath = `${path}.disagreements[${index}]`;
      const disagreement = requireRecord(value, disagreementPath);
      if (
        !judgmentIds.has(requireString(
          disagreement.leftJudgmentId,
          `${disagreementPath}.leftJudgmentId`,
        ))
        || !judgmentIds.has(requireString(
          disagreement.rightJudgmentId,
          `${disagreementPath}.rightJudgmentId`,
        ))
      ) {
        fail(`${disagreementPath} cites an unknown framework judgment`);
      }
    },
  );

  const decision = requireRecord(artifact.decision, `${path}.decision`);
  if (!Object.hasOwn(decision, "decision") || !Object.hasOwn(decision, "decisionCeiling")) {
    fail(`${path}.decision requires a formal decision and decision ceiling`);
  }
  requireRecord(artifact.versionSnapshot, `${path}.versionSnapshot`);
  requireString(artifact.narrative, `${path}.narrative`);
  requireArray(artifact.claimEdges, `${path}.claimEdges`);

  if (artifact.decisionCriticalEvidenceProjection !== undefined) {
    const projectionResult = DecisionCriticalEvidenceProjectionSchema.safeParse(
      artifact.decisionCriticalEvidenceProjection,
    );
    if (!projectionResult.success) {
      fail(`${path}.decisionCriticalEvidenceProjection is not a valid projection`);
    }
    const projection = projectionResult.data;
    if (
      projection.workspaceId !== artifact.workspaceId
      || projection.artifactSourceCandidateRunId !== identity.candidateRunId
    ) {
      fail(
        `${path}.decisionCriticalEvidenceProjection is not linked to its artifact`,
      );
    }
    const parsedJudgments = judgments.map((value, index) => {
      const result = FrameworkJudgmentSchema.safeParse(value);
      if (!result.success) {
        fail(`${path}.judgments[${index}] is not a valid framework judgment`);
      }
      return result.data;
    });
    const expectedFingerprint =
      createDecisionCriticalEvidenceProjectionFingerprint(
        projection.evidenceRefs,
        parsedJudgments,
      );
    if (projection.fingerprint !== expectedFingerprint) {
      fail(
        `${path}.decisionCriticalEvidenceProjection fingerprint does not `
          + "match its original run-bound projection",
      );
    }
  }
  validateNamedLensAttemptLedgerBinding(artifact, path, identity);
  validatePersistedNamedLensFinalizationAuthority(artifact, path, identity);

  const drafts = requireArray(artifact.actionDrafts, `${path}.actionDrafts`);
  if (drafts.length === 0) fail(`${path} requires at least one action draft`);
  const expectedFormats = expectedActionDraftFormats(actionKinds);
  const formats = new Set<string>();
  drafts.forEach((value, index) => {
    const draftPath = `${path}.actionDrafts[${index}]`;
    const draft = requireRecord(value, draftPath);
    if (draft.candidateRunId !== identity.candidateRunId) {
      fail(`${draftPath} is not linked to its CandidateRun`);
    }
    const format = requireString(draft.format, `${draftPath}.format`);
    addUnique(formats, format, draftPath);
    if (draft.deliveryMode !== "draft_only") fail(`${draftPath} must remain draft-only`);
    const body = requireString(draft.body, `${draftPath}.body`);
    const marker = EXTERNAL_DRAFT_MARKERS[format];
    if (!marker || !marker(body)) fail(`${draftPath} is missing its permanent external draft label`);
    const missingEvidence = requireArray(
      draft.missingEvidence,
      `${draftPath}.missingEvidence`,
    );
    if (missingEvidence.length === 0) fail(`${draftPath}.missingEvidence cannot be empty`);
    missingEvidence.forEach((item, missingIndex) => {
      requireString(
        requireRecord(
          item,
          `${draftPath}.missingEvidence[${missingIndex}]`,
        ).externalLabel,
        `${draftPath}.missingEvidence[${missingIndex}].externalLabel`,
      );
    });
  });
  if (
    formats.size !== expectedFormats.size
    || [...formats].some((format) => !expectedFormats.has(format))
  ) {
    fail(`${path}.actionDrafts action draft formats do not match typed actions`);
  }
}

function expectedActionDraftFormats(
  actionKinds: readonly string[],
): ReadonlySet<string> {
  if (
    actionKinds.includes("advance_diligence")
    || actionKinds.includes("reopen_diligence")
  ) {
    return new Set(Object.keys(EXTERNAL_DRAFT_MARKERS));
  }
  if (actionKinds.includes("evaluate_follow_on")) {
    return new Set(["internal_memo", "founder_email", "diligence_request"]);
  }
  return new Set(["internal_memo"]);
}

function validateNamedLensAttemptLedgerBinding(
  artifact: UnknownRecord,
  path: string,
  identity: { dealId: string; candidateRunId: string },
): void {
  const hasRefs = artifact.namedLensAttemptRefs !== undefined;
  const hasLedger = artifact.namedLensProviderAttempts !== undefined;
  if (!hasRefs && !hasLedger) return;
  if (!hasRefs || !hasLedger) {
    fail(`${path} requires both Named Lens attempt refs and its provider ledger`);
  }
  const refs = requireArray(
    artifact.namedLensAttemptRefs,
    `${path}.namedLensAttemptRefs`,
  ).map((value, index) => {
    const result = NamedLensProviderAttemptRefSchema.safeParse(value);
    if (!result.success) {
      fail(`${path}.namedLensAttemptRefs[${index}] is invalid`);
    }
    return result.data;
  });
  const attempts = requireArray(
    artifact.namedLensProviderAttempts,
    `${path}.namedLensProviderAttempts`,
  ).map((value, index) => {
    const result = NamedLensProviderAttemptSchema.safeParse(value);
    if (!result.success) {
      fail(`${path}.namedLensProviderAttempts[${index}] is invalid`);
    }
    if (
      result.data.workspaceId !== artifact.workspaceId
      || result.data.artifactSourceCandidateRunId !== identity.candidateRunId
      || result.data.status === "reserved"
    ) {
      fail(
        `${path}.namedLensProviderAttempts[${index}] is foreign or unsettled`,
      );
    }
    return result.data;
  });
  const identityKey = (value: {
    judgmentOrCatalogCandidateId: string;
    logicalPassageId: string;
    attemptNumber: number;
    attemptFingerprint: string;
  }) => [
    value.judgmentOrCatalogCandidateId,
    value.logicalPassageId,
    String(value.attemptNumber),
    value.attemptFingerprint,
  ].join("\u0000");
  const refKeys = refs.map(identityKey);
  const ledgerKeys = attempts.map(identityKey);
  if (
    new Set(refKeys).size !== refKeys.length
    || new Set(ledgerKeys).size !== ledgerKeys.length
    || refKeys.length !== ledgerKeys.length
    || refKeys.some((key) => !ledgerKeys.includes(key))
    || ledgerKeys.some((key) => !refKeys.includes(key))
  ) {
    fail(
      `${path} Named Lens attempt refs must exactly match the settled `
        + "candidate-local provider ledger",
    );
  }
}

function validatePersistedNamedLensFinalizationAuthority(
  artifact: UnknownRecord,
  path: string,
  identity: { dealId: string; candidateRunId: string },
): void {
  if (artifact.underwritingPresentationReportId === undefined) return;
  const current = artifact as unknown as CurrentCandidateArtifactBundle;
  try {
    validateNamedLensFinalization({
      workspaceId: requireString(artifact.workspaceId, `${path}.workspaceId`),
      candidateRunId: identity.candidateRunId,
      catalogConsiderations: current.namedLensCatalogConsiderations,
      decisionCriticalEvidenceProjection:
        current.decisionCriticalEvidenceProjection,
      attemptRefs: current.namedLensAttemptRefs,
      persistedAttempts: current.namedLensProviderAttempts,
      dispositions: current.namedLensDispositions,
      passages: current.namedLensPassages,
      underwritingPresentationReportId: requireString(
        artifact.underwritingPresentationReportId,
        `${path}.underwritingPresentationReportId`,
      ),
      presentation: current.namedLensPresentation,
      terminalStatus: current.terminalStatus,
      terminalReasonCodes: current.terminalReasonCodes,
      generatorVersion: current.versionSnapshot.namedLensGeneratorVersion!,
      evidencePack: current.evidencePack,
      judgments: current.judgments,
      decision: current.decision,
    });
  } catch (error) {
    fail(
      `${path} current Named Lens finalization failed its same-run authority `
        + `validation: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

function validateScenarioSet(
  scenarios: unknown[],
  path: string,
  requireInputs: boolean,
  evidenceItemIds: ReadonlySet<string>,
): void {
  if (scenarios.length !== 3) fail(`${path} requires Bear, Base, and Bull`);
  const names = scenarios.map((value, index) =>
    requireString(
      requireRecord(value, `${path}[${index}]`).name,
      `${path}[${index}].name`,
    )
  ).sort();
  if (names.join(",") !== "base,bear,bull") fail(`${path} requires Bear, Base, and Bull`);
  if (!requireInputs) return;
  scenarios.forEach((value, index) => {
    const scenarioPath = `${path}[${index}]`;
    const scenario = requireRecord(value, scenarioPath);
    const inputs = requireArray(scenario.inputs, `${scenarioPath}.inputs`);
    if (inputs.length !== SCENARIO_FIELDS.size) {
      fail(`${scenarioPath} requires all 17 Bear/Base/Bull inputs`);
    }
    const fields = new Set<string>();
    inputs.forEach((inputValue, inputIndex) => {
      const inputPath = `${scenarioPath}.inputs[${inputIndex}]`;
      const input = requireRecord(inputValue, inputPath);
      const field = requireString(input.field, `${inputPath}.field`);
      addUnique(fields, field, inputPath);
      for (const key of ["evidenceItemId", "assumptionItemId"]) {
        const reference = input[key];
        if (reference !== null && !evidenceItemIds.has(requireString(reference, `${inputPath}.${key}`))) {
          fail(`${inputPath}.${key} cites unknown Evidence Pack input`);
        }
      }
    });
    if ([...SCENARIO_FIELDS].some((field) => !fields.has(field))) {
      fail(`${scenarioPath} requires all 17 Bear/Base/Bull inputs`);
    }
  });
}

function validateSources(sources: unknown[], path: string): Set<string> {
  const ids = new Set<string>();
  sources.forEach((value, index) => {
    const sourcePath = `${path}[${index}]`;
    const item = requireRecord(value, sourcePath);
    addUnique(ids, requireString(item.id, `${sourcePath}.id`), sourcePath);
    if (item.sourceRevisionId === null) {
      if (
        item.provenance !== "demo_fixture"
        || item.sourceClass !== "internal_decision_record"
      ) {
        fail(`${sourcePath}.sourceRevisionId is required for durable source revision coverage`);
      }
    } else {
      requireString(
        item.sourceRevisionId,
        `${sourcePath}.sourceRevisionId (source revision coverage)`,
      );
    }
  });
  return ids;
}

function validateCitations(
  value: unknown,
  sourceIds: ReadonlySet<string>,
  path: string,
): void {
  const citations = requireArray(value, path);
  citations.forEach((entry, index) => {
    const citationPath = `${path}[${index}]`;
    const citation = requireRecord(entry, citationPath);
    const citedIds = requireStringArray(
      citation.sourceIds,
      `${citationPath}.sourceIds`,
    );
    if (citedIds.length === 0 || citedIds.some((id) => !sourceIds.has(id))) {
      fail(`${citationPath} has unresolved citation coverage`);
    }
  });
}

function projectSharedQuality(
  validated: ValidatedPass,
  sharedDeals: ReadonlySet<string>,
  commonUnderwritingDeals: ReadonlySet<string>,
): unknown {
  const aliases = buildIdentityAliases(validated.pass);
  const companyAnalyses = [...sharedDeals].sort(compareText).map((dealId) => ({
    dealId,
    analysis: normalize(
      validated.analysisByDeal.get(dealId),
      `$.companyAnalyses.${dealId}`,
      aliases,
    ),
  }));
  const underwriting = [...commonUnderwritingDeals]
    .sort(compareText)
    .map((dealId) => ({
      dealId,
      opportunity: normalize(
        omitRankingMetadata(validated.opportunityByDeal.get(dealId)),
        `$.underwriting.${dealId}.opportunity`,
        aliases,
      ),
      selection: normalize(
        omitRankingMetadata(validated.selectionByDeal.get(dealId), true),
        `$.underwriting.${dealId}.selection`,
        aliases,
      ),
      candidate: normalize(
        validated.candidateByDeal.get(dealId),
        `$.underwriting.${dealId}.candidate`,
        aliases,
      ),
      artifact: normalize(
        validated.artifactByDeal.get(dealId),
        `$.underwriting.${dealId}.artifact`,
        aliases,
      ),
      case: normalize(
        omitRankingMetadata(validated.caseByDeal.get(dealId)),
        `$.underwriting.${dealId}.case`,
        aliases,
      ),
    }));
  return { companyAnalyses, underwriting };
}

function omitRankingMetadata(
  value: UnknownRecord | undefined,
  omitReason = false,
): UnknownRecord {
  if (!value) fail("Shared underwriting projection is missing a required section");
  const result = { ...value };
  delete result.rank;
  delete result.priorityRank;
  if (omitReason) delete result.reason;
  return result;
}

function buildIdentityAliases(pass: UnknownRecord): ReadonlyMap<string, string> {
  const aliases = new AliasMap();
  const run = requireRecord(pass.run, "pass.run");
  aliases.add(requireString(run.id, "pass.run.id"), "run");
  const report = requireRecord(pass.report, "pass.report");
  aliases.add(requireString(report.id, "pass.report.id"), "report");
  requireArray(report.companyAnalyses, "pass.report.companyAnalyses")
    .forEach((value, index) => {
      const item = requireRecord(value, `pass.report.companyAnalyses[${index}]`);
      const dealId = requireString(
        item.dealId,
        `pass.report.companyAnalyses[${index}].dealId`,
      );
      aliases.add(
        requireString(item.id, `pass.report.companyAnalyses[${index}].id`),
        `analysis:${dealId}`,
      );
      const marketEvidence = isRecord(item.marketEvidence)
        ? item.marketEvidence
        : null;
      const events = marketEvidence && Array.isArray(marketEvidence.events)
        ? marketEvidence.events
        : [];
      events.forEach((eventValue, eventIndex) => {
        const event = requireRecord(
          eventValue,
          `pass.report.companyAnalyses[${index}].marketEvidence.events[${eventIndex}]`,
        );
        if (typeof event.triggerSourceId !== "string") return;
        aliases.add(
          requireString(
            event.id,
            `pass.report.companyAnalyses[${index}].marketEvidence.events[${eventIndex}].id`,
          ),
          `market-event:${requireString(
            event.triggerSourceId,
            `pass.report.companyAnalyses[${index}].marketEvidence.events[${eventIndex}].triggerSourceId`,
          )}`,
        );
      });
    });
  const batch = requireRecord(pass.batch, "pass.batch");
  aliases.add(requireString(batch.id, "pass.batch.id"), "batch");
  requireArray(pass.candidates, "pass.candidates").forEach((value, index) => {
    const candidate = requireRecord(value, `pass.candidates[${index}]`);
    aliases.add(
      requireString(candidate.id, `pass.candidates[${index}].id`),
      `candidate:${requireString(candidate.dealId, `pass.candidates[${index}].dealId`)}`,
    );
  });
  requireArray(pass.artifacts, "pass.artifacts").forEach((value, index) => {
    collectArtifactAliases(
      requireRecord(value, `pass.artifacts[${index}]`),
      aliases,
      `pass.artifacts[${index}]`,
    );
  });
  return aliases.values;
}

function collectArtifactAliases(
  artifact: UnknownRecord,
  aliases: AliasMap,
  path: string,
): void {
  const dealId = requireString(artifact.dealId, `${path}.dealId`);
  const pack = requireRecord(artifact.evidencePack, `${path}.evidencePack`);
  aliases.add(requireString(pack.id, `${path}.evidencePack.id`), `evidence-pack:${dealId}`);
  const scenarioModel = requireRecord(artifact.scenarioModel, `${path}.scenarioModel`);
  aliases.add(
    requireString(scenarioModel.id, `${path}.scenarioModel.id`),
    `scenario-model:${dealId}`,
  );
  requireArray(scenarioModel.scenarios, `${path}.scenarioModel.scenarios`)
    .forEach((scenarioValue, scenarioIndex) => {
      const scenario = requireRecord(
        scenarioValue,
        `${path}.scenarioModel.scenarios[${scenarioIndex}]`,
      );
      const name = requireString(
        scenario.name,
        `${path}.scenarioModel.scenarios[${scenarioIndex}].name`,
      );
      requireArray(
        scenario.inputs,
        `${path}.scenarioModel.scenarios[${scenarioIndex}].inputs`,
      ).forEach((inputValue, inputIndex) => {
        const input = requireRecord(
          inputValue,
          `${path}.scenarioModel.scenarios[${scenarioIndex}].inputs[${inputIndex}]`,
        );
        aliases.add(
          requireString(input.id, `${path}.scenario input id`),
          `scenario-input:${dealId}:${name}:${requireString(input.field, `${path}.scenario input field`)}`,
        );
      });
    });

  requireArray(artifact.calculations, `${path}.calculations`)
    .forEach((value, index) => {
      const calculation = requireRecord(value, `${path}.calculations[${index}]`);
      const id = requireString(calculation.id, `${path}.calculations[${index}].id`);
      const formulaId = requireString(
        calculation.formulaId,
        `${path}.calculations[${index}].formulaId`,
      );
      aliases.add(id, `calculation:${dealId}:${formulaId}:${calculationOutputKey(id, formulaId, index)}`);
    });
  const frameworkCardIdByJudgmentId = new Map<string, string>();
  requireArray(artifact.judgments, `${path}.judgments`).forEach((value, index) => {
    const judgment = requireRecord(value, `${path}.judgments[${index}]`);
    const judgmentId = requireString(
      judgment.id,
      `${path}.judgments[${index}].id`,
    );
    const frameworkCardId = requireString(
      judgment.frameworkCardId,
      `${path}.judgments[${index}].frameworkCardId`,
    );
    frameworkCardIdByJudgmentId.set(judgmentId, frameworkCardId);
    aliases.add(
      judgmentId,
      `judgment:${dealId}:${frameworkCardId}`,
    );
  });
  const semanticCandidateById = new Map(frameworkCardIdByJudgmentId);
  if (Array.isArray(artifact.namedLensCatalogConsiderations)) {
    artifact.namedLensCatalogConsiderations.forEach((value, index) => {
      const consideration = requireRecord(
        value,
        `${path}.namedLensCatalogConsiderations[${index}]`,
      );
      const candidateId = requireString(
        consideration.judgmentOrCatalogCandidateId,
        `${path}.namedLensCatalogConsiderations[${index}].judgmentOrCatalogCandidateId`,
      );
      const cardIdentity = `${requireString(
        consideration.frameworkCardId,
        `${path}.namedLensCatalogConsiderations[${index}].frameworkCardId`,
      )}@${requireString(
        consideration.frameworkVersion,
        `${path}.namedLensCatalogConsiderations[${index}].frameworkVersion`,
      )}`;
      semanticCandidateById.set(candidateId, cardIdentity);
    });
  }
  if (Array.isArray(artifact.namedLensAttemptRefs)) {
    artifact.namedLensAttemptRefs.forEach((value, index) => {
      const attempt = requireRecord(
        value,
        `${path}.namedLensAttemptRefs[${index}]`,
      );
      const candidateId = requireString(
        attempt.judgmentOrCatalogCandidateId,
        `${path}.namedLensAttemptRefs[${index}].judgmentOrCatalogCandidateId`,
      );
      const candidateIdentity = semanticCandidateById.get(candidateId);
      if (!candidateIdentity) {
        fail(`${path}.namedLensAttemptRefs[${index}] has no catalog identity`);
      }
      aliases.addRunFingerprint(
        requireString(
          attempt.attemptFingerprint,
          `${path}.namedLensAttemptRefs[${index}].attemptFingerprint`,
        ),
        `named-lens-attempt:${dealId}:${candidateIdentity}:#${requireFiniteNumber(
          attempt.attemptNumber,
          `${path}.namedLensAttemptRefs[${index}].attemptNumber`,
        )}`,
      );
    });
  }
  if (isRecord(artifact.decisionCriticalEvidenceProjection)) {
    aliases.addRunFingerprint(
      requireString(
        artifact.decisionCriticalEvidenceProjection.fingerprint,
        `${path}.decisionCriticalEvidenceProjection.fingerprint`,
      ),
      `decision-critical-projection-fingerprint:${dealId}`,
    );
  }
  if (typeof artifact.underwritingPresentationReportId === "string") {
    requireArray(
      artifact.namedLensCatalogConsiderations,
      `${path}.namedLensCatalogConsiderations`,
    ).forEach((value, index) => {
      const consideration = requireRecord(
        value,
        `${path}.namedLensCatalogConsiderations[${index}]`,
      );
      const candidateId = requireString(
        consideration.judgmentOrCatalogCandidateId,
        `${path}.namedLensCatalogConsiderations[${index}].judgmentOrCatalogCandidateId`,
      );
      const candidateIdentity = semanticCandidateById.get(candidateId);
      if (!candidateIdentity) {
        fail(`${path}.namedLensCatalogConsiderations[${index}] has no identity`);
      }
      aliases.addRunFingerprint(
        requireString(
          consideration.fingerprint,
          `${path}.namedLensCatalogConsiderations[${index}].fingerprint`,
        ),
        `named-lens-catalog:${dealId}:${candidateIdentity}`,
      );
    });
    requireArray(
      artifact.namedLensDispositions,
      `${path}.namedLensDispositions`,
    ).forEach((value, index) => {
      const disposition = requireRecord(
        value,
        `${path}.namedLensDispositions[${index}]`,
      );
      const candidateId = requireString(
        disposition.judgmentOrCatalogCandidateId,
        `${path}.namedLensDispositions[${index}].judgmentOrCatalogCandidateId`,
      );
      const candidateIdentity = semanticCandidateById.get(candidateId);
      if (!candidateIdentity) {
        fail(`${path}.namedLensDispositions[${index}] has no identity`);
      }
      aliases.addRunFingerprint(
        requireString(
          disposition.fingerprint,
          `${path}.namedLensDispositions[${index}].fingerprint`,
        ),
        `named-lens-disposition:${dealId}:${candidateIdentity}`,
      );
    });
    requireArray(
      artifact.namedLensPassages,
      `${path}.namedLensPassages`,
    ).forEach((value, index) => {
      const passage = requireRecord(
        value,
        `${path}.namedLensPassages[${index}]`,
      );
      const cardIdentity = `${requireString(
        passage.frameworkCardId,
        `${path}.namedLensPassages[${index}].frameworkCardId`,
      )}@${requireString(
        passage.frameworkVersion,
        `${path}.namedLensPassages[${index}].frameworkVersion`,
      )}`;
      aliases.addRunFingerprint(
        requireString(
          passage.fingerprint,
          `${path}.namedLensPassages[${index}].fingerprint`,
        ),
        `named-lens-passage:${dealId}:${cardIdentity}`,
      );
    });
    const presentation = requireRecord(
      artifact.namedLensPresentation,
      `${path}.namedLensPresentation`,
    );
    aliases.addRunFingerprint(
      requireString(
        presentation.fingerprint,
        `${path}.namedLensPresentation.fingerprint`,
      ),
      `named-lens-presentation:${dealId}`,
    );
    const versionSnapshot = requireRecord(
      artifact.versionSnapshot,
      `${path}.versionSnapshot`,
    );
    aliases.addRunFingerprint(
      requireString(
        versionSnapshot.finalDispositionsFingerprint,
        `${path}.versionSnapshot.finalDispositionsFingerprint`,
      ),
      `named-lens-final-dispositions:${dealId}`,
    );
  }
  requireArray(artifact.disagreements, `${path}.disagreements`)
    .forEach((value, index) => {
      const disagreement = requireRecord(value, `${path}.disagreements[${index}]`);
      const leftJudgmentId = requireString(
        disagreement.leftJudgmentId,
        `${path}.disagreements[${index}].leftJudgmentId`,
      );
      const rightJudgmentId = requireString(
        disagreement.rightJudgmentId,
        `${path}.disagreements[${index}].rightJudgmentId`,
      );
      const leftFrameworkCardId = frameworkCardIdByJudgmentId.get(leftJudgmentId);
      const rightFrameworkCardId = frameworkCardIdByJudgmentId.get(rightJudgmentId);
      if (!leftFrameworkCardId || !rightFrameworkCardId) {
        fail(`${path}.disagreements[${index}] cites an unknown framework judgment`);
      }
      aliases.add(
        requireString(disagreement.id, `${path}.disagreements[${index}].id`),
        [
          "disagreement",
          dealId,
          requireString(
            disagreement.topic,
            `${path}.disagreements[${index}].topic`,
          ),
          leftFrameworkCardId,
          rightFrameworkCardId,
        ].join(":"),
      );
    });
  const valuation = requireRecord(artifact.valuation, `${path}.valuation`);
  aliases.add(requireString(valuation.id, `${path}.valuation.id`), `valuation:${dealId}`);
  const decision = requireRecord(artifact.decision, `${path}.decision`);
  aliases.add(requireString(decision.id, `${path}.decision.id`), `decision:${dealId}`);
  requireArray(artifact.actionDrafts, `${path}.actionDrafts`).forEach((value, index) => {
    const draft = requireRecord(value, `${path}.actionDrafts[${index}]`);
    aliases.add(
      requireString(draft.id, `${path}.actionDrafts[${index}].id`),
      `action-draft:${dealId}:${requireString(draft.format, `${path}.actionDrafts[${index}].format`)}`,
    );
  });
}

function calculationOutputKey(id: string, formulaId: string, index: number): string {
  const marker = `:${formulaId}:`;
  const markerIndex = id.lastIndexOf(marker);
  return markerIndex === -1 ? String(index) : id.slice(markerIndex + marker.length);
}

function normalize(
  value: unknown,
  path: string,
  aliases: ReadonlyMap<string, string>,
): unknown {
  if (typeof value === "string") return normalizeString(value, aliases);
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (Array.isArray(value)) {
    const normalized = value.map((item, index) =>
      normalize(item, `${path}[${index}]`, aliases)
    );
    if (path.endsWith(".judgments") || path.endsWith(".disagreements")) {
      return normalized.sort((left, right) =>
        compareText(JSON.stringify(left), JSON.stringify(right))
      );
    }
    return normalized;
  }
  if (typeof value !== "object") {
    fail(`${path} contains a non-serializable semantic value`);
  }
  const record = value as UnknownRecord;
  const result: UnknownRecord = {};
  for (const key of Object.keys(record).sort()) {
    const child = record[key];
    if (child === undefined || shouldOmit(record, path, key)) continue;
    if (
      typeof child === "string"
      && isRunBoundNamedLensFingerprintField(path, key)
    ) {
      const fingerprintAlias = aliases.get(
        `${RUN_BOUND_FINGERPRINT_ALIAS_PREFIX}${child}`,
      );
      if (fingerprintAlias !== undefined) {
        result[key] = fingerprintAlias;
        continue;
      }
    }
    result[key] = normalize(child, `${path}.${key}`, aliases);
  }
  if (path.endsWith(".decisionCriticalEvidenceProjection")) {
    result.semanticSignature = createCanonicalFingerprint({
      kind: "belief-reversal-quality-parity-critical-evidence-v1",
      evidenceRefs: result.evidenceRefs,
    });
  }
  if (
    path.endsWith(".artifact")
    && Array.isArray(result.namedLensAttemptRefs)
  ) {
    const versions = isRecord(result.versionSnapshot)
      ? result.versionSnapshot
      : {};
    result.namedLensAttemptSemanticSignature = createCanonicalFingerprint({
      kind: "belief-reversal-quality-parity-named-lens-attempts-v1",
      execution: {
        providerModel: versions.providerModel,
        promptVersion: versions.promptVersion,
        schemaVersion: versions.schemaVersion,
        settingsFingerprint: versions.settingsFingerprint,
        applicationCommit: versions.applicationCommit,
        namedLensPassageSchemaVersion:
          versions.namedLensPassageSchemaVersion,
        namedLensGeneratorVersion: versions.namedLensGeneratorVersion,
      },
      input: {
        evidencePack: result.evidencePack,
        context: result.context,
        calculations: result.calculations,
      },
      catalogConsiderations: result.namedLensCatalogConsiderations,
      attemptRefs: result.namedLensAttemptRefs,
      providerAttempts: semanticProviderAttempts(
        result.namedLensProviderAttempts,
      ),
      dispositions: result.namedLensDispositions,
      passages: result.namedLensPassages,
      presentation: result.namedLensPresentation,
    });
  }
  return result;
}

function semanticProviderAttempts(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((entry) => {
    if (!isRecord(entry)) return entry;
    const { telemetry: omittedTelemetry, ...semantic } = entry;
    void omittedTelemetry;
    return semantic;
  });
}

function isRunBoundNamedLensFingerprintField(
  path: string,
  key: string,
): boolean {
  if (path.includes(".namedLens")) {
    return key === "fingerprint"
      || key === "attemptFingerprint"
      || key === "passageFingerprint"
      || key === "decisionCriticalEvidenceProjectionFingerprint";
  }
  if (path.endsWith(".decisionCriticalEvidenceProjection")) {
    return key === "fingerprint";
  }
  return path.endsWith(".versionSnapshot")
    && [
      "criticalEvidenceProjectionFingerprint",
      "finalDispositionsFingerprint",
      "presentationFingerprint",
    ].includes(key);
}

function normalizeString(
  value: string,
  aliases: ReadonlyMap<string, string>,
): string {
  const exact = aliases.get(value);
  if (exact !== undefined) return exact;
  let normalized = value;
  const replacements = [...aliases.entries()]
    .filter(([original]) => normalized.includes(original))
    .sort(([left], [right]) => right.length - left.length);
  for (const [original, alias] of replacements) {
    normalized = normalized.replaceAll(original, alias);
  }
  return normalized;
}

function shouldOmit(record: UnknownRecord, path: string, key: string): boolean {
  if (
    RUN_IDENTITY_FIELDS.has(key)
    || LIFECYCLE_TIMESTAMP_FIELDS.has(key)
    || RUN_DERIVED_FINGERPRINT_FIELDS.has(key)
    || EVIDENCE_BINDING_FIELDS.has(key)
  ) return true;
  // The audit contains the exact run-bound Deal universe, scanned MarketEvent
  // IDs, Source Revision lineage, and XTrace recall IDs. Those values must be
  // valid for each pass, but a 30-Deal live scan cannot equal the immutable
  // 23-Deal pinned scan byte-for-byte. Outcome, score, confidence, gates,
  // actions, evidence, and underwriting remain compared outside this envelope.
  if (key === "currentRunAudit") return true;
  // MarketEvent IDs are deterministic within one evidence snapshot, but a
  // fresh collection legitimately assigns different IDs to the same public
  // event. The typed CompanyAnalysis contract verifies the references inside
  // each pass; parity compares the event payload, dates, sources, gates, and
  // conclusions rather than the run-bound identifier.
  if (
    (key === "eventIds" && path.endsWith(".marketEvidence"))
    || (
      path.includes(".marketEvidence.events[")
      && [
        "id",
        "retrievedAt",
        "retrievedAtPrecision",
        "providerId",
        "contentFingerprint",
      ].includes(key)
    )
    || (key === "id" && path.endsWith(".gateContext.triggerEvent"))
    || (key === "triggerEventId" && path.includes(".beliefAssessment.gates."))
  ) return true;
  if (key === "priorityRank") return true;
  if (key === "displayLabel" && path.includes("evidenceContext")) return true;
  // This raw fingerprint intentionally binds the original run-scoped event
  // identities and is verified independently above. Cross-run parity compares
  // a second fingerprint derived from the normalized evidence semantics.
  if (
    key === "fingerprint"
    && path.endsWith(".decisionCriticalEvidenceProjection")
  ) return true;
  return key === "fingerprint" && record.analysisType === "framework_judgment";
}

class AliasMap {
  readonly values = new Map<string, string>();
  readonly originals = new Map<string, string>();

  add(original: string, alias: string): void {
    const previousAlias = this.values.get(original);
    if (previousAlias !== undefined && previousAlias !== alias) {
      fail(`Run-scoped identity ${original} maps to conflicting semantic roles`);
    }
    const previousOriginal = this.originals.get(alias);
    if (previousOriginal !== undefined && previousOriginal !== original) {
      fail(`Semantic role ${alias} has duplicate run-scoped identities`);
    }
    this.values.set(original, alias);
    this.originals.set(alias, original);
  }

  addRunFingerprint(original: string, alias: string): void {
    this.add(`${RUN_BOUND_FINGERPRINT_ALIAS_PREFIX}${original}`, alias);
  }
}

function firstDifference(
  left: unknown,
  right: unknown,
  path: string,
): { path: string; left: unknown; right: unknown } | null {
  if (Object.is(left, right)) return null;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return { path, left, right };
    if (left.length !== right.length) {
      return {
        path: `${path}.length`,
        left: left.length,
        right: right.length,
      };
    }
    for (let index = 0; index < left.length; index += 1) {
      const difference = firstDifference(
        left[index],
        right[index],
        `${path}[${index}]`,
      );
      if (difference) return difference;
    }
    return null;
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return { path, left, right };
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (!isDeepStrictEqual(leftKeys, rightKeys)) {
      const allKeys = [...new Set([...leftKeys, ...rightKeys])].sort();
      const missing = allKeys.find((key) => !Object.hasOwn(left, key) || !Object.hasOwn(right, key));
      const differencePath = missing ? `${path}.${missing}` : path;
      return {
        path: differencePath,
        left: missing ? left[missing] : left,
        right: missing ? right[missing] : right,
      };
    }
    for (const key of leftKeys) {
      const difference = firstDifference(left[key], right[key], `${path}.${key}`);
      if (difference) return difference;
    }
    return null;
  }
  return { path, left, right };
}

function projectionSummary(value: unknown): unknown {
  // The exact path is already actionable; avoid a second permissive path
  // parser that could obscure a malformed difference location.
  return value;
}

function summarize(value: unknown): string {
  const rendered = JSON.stringify(value);
  if (rendered === undefined) return String(value);
  return rendered.length > 240 ? `${rendered.slice(0, 237)}...` : rendered;
}

function assertExactDealSet(
  actual: ReadonlySet<string>,
  expected: ReadonlySet<string>,
  path: string,
): void {
  if (
    actual.size !== expected.size
    || [...actual].some((dealId) => !expected.has(dealId))
  ) {
    fail(`${path} does not exactly match the expected identities`);
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function readPriorityRank(value: UnknownRecord, path: string): number {
  const rank = readNullablePriorityRank(value, path);
  if (rank === null) fail(`${path}.priorityRank is required`);
  return rank;
}

function readNullablePriorityRank(
  value: UnknownRecord,
  path: string,
): number | null {
  const hasPriorityRank = Object.hasOwn(value, "priorityRank");
  const hasLegacyRank = Object.hasOwn(value, "rank");
  const priorityRank = hasPriorityRank ? value.priorityRank : undefined;
  const legacyRank = hasLegacyRank ? value.rank : undefined;
  if (
    hasPriorityRank
    && hasLegacyRank
    && priorityRank !== legacyRank
  ) fail(`${path}.priorityRank conflicts with legacy rank`);
  const raw = hasPriorityRank ? priorityRank : legacyRank;
  if (raw === null || raw === undefined) return null;
  const parsed = requireFiniteNumber(raw, `${path}.priorityRank`);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    fail(`${path}.priorityRank must be a positive integer`);
  }
  return parsed;
}

function addUnique(values: Set<string>, value: string, path: string): void {
  if (values.has(value)) fail(`${path} duplicates identity ${value}`);
  values.add(value);
}

function requireRecord(value: unknown, path: string): UnknownRecord {
  if (!isRecord(value)) fail(`${path} must be a complete object`);
  return value;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(`${path} must be a complete array`);
  return value;
}

function requireStringArray(value: unknown, path: string): string[] {
  return requireArray(value, path).map((item, index) =>
    requireString(item, `${path}[${index}]`)
  );
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) fail(`${path} must be a non-empty string`);
  return value;
}

function requireFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${path} must be a finite number`);
  return value;
}

function requireNonnegativeInteger(value: unknown, path: string): number {
  const parsed = requireFiniteNumber(value, path);
  if (!Number.isInteger(parsed) || parsed < 0) {
    fail(`${path} must be a non-negative integer`);
  }
  return parsed;
}

function fail(message: string): never {
  throw new BeliefReversalQualityParityError(message);
}
