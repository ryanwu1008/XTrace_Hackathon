import assert from "node:assert/strict";
import test from "node:test";

import {
  assertBeliefReversalQualityParity,
} from "../helpers/belief-reversal-quality-parity";
import {
  SYNTHETIC_FRAMEWORK_PACK,
} from "../../seed/underwriting/framework-pack-v1";
import {
  createDecisionCriticalEvidenceProjectionFingerprint,
} from "../../lib/underwriting/named-lens-presentation";

const SCENARIO_FIELDS = [
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
] as const;

const sha = (digit: string) => `sha256:${digit.repeat(64)}`;

const FORMAL_CASES = [{
  dealId: "deal_henry_ai_v1",
  direction: "positive",
  action: "reopen_diligence",
}, {
  dealId: "deal_smallest_ai_v1",
  direction: "positive",
  action: "advance_diligence",
}, {
  dealId: "deal_hush_security_v1",
  direction: "positive",
  action: "evaluate_follow_on",
}, {
  dealId: "deal_irregular_v1",
  direction: "negative",
  action: "pause_follow_on",
}] as const;

const SCREENING_CASES = [
  "deal_cascade_v1",
  "deal_centralize_v1",
  "deal_chipagents_v1",
  "deal_cordant_v1",
  "deal_empirical_security_v1",
  "deal_freight_hero_v1",
  "deal_sent_v1",
].map((dealId, index) => ({
  dealId,
  direction: index % 2 === 0 ? "positive" as const : "negative" as const,
}));

function source(dealId: string) {
  return {
    id: `source_${dealId}`,
    sourceRevisionId: `revision_${dealId}`,
    schemaVersion: "source-ref-v2",
    title: `${dealId} exact source`,
    canonicalUrl: `https://example.test/${dealId}`,
    contentFingerprint: `sha256:${"a".repeat(64)}`,
    verbatimExcerpt: "Exact public evidence.",
    normalizedStatement: "The public source supports the reviewed fact.",
  };
}

function analysis(dealId: string, index: number) {
  const selected = FORMAL_CASES[index];
  const analysisSource = source(dealId);
  return {
    id: `analysis_run_a_${dealId}`,
    reportId: "report_run_a",
    runId: "00000000-0000-4000-8000-000000000001",
    dealId,
    companyName: `Company ${index + 1}`,
    dealStatus: selected?.dealId === "deal_henry_ai_v1"
      ? "passed"
      : selected?.dealId === "deal_hush_security_v1"
          || selected?.dealId === "deal_irregular_v1"
      ? "invested"
      : "watchlist",
    outcome: selected ? "belief_revised" : "no_material_change",
    confidence: selected ? "high" : "low",
    score: selected ? Number((0.91 - index * 0.05).toFixed(2)) : 0.1,
    verifiedSourceCount: 1,
    sources: [analysisSource],
    claimSupport: [{
      text: "The public source supports the reviewed fact.",
      kind: "normalized_non_quote",
      sourceIds: [analysisSource.id],
    }],
    companyBrief: {
      sourceLineage: [analysisSource],
      structuredFields: [{
        id: `semantic-field-${String(index).padStart(24, "0")}`,
        schemaVersion: "deal-semantic-field-v1",
        fieldId: "company_identity",
        classification: "fact",
        availability: "available",
        value: `Company ${index + 1}`,
        sourceIds: [analysisSource.id],
      }],
    },
    beliefAssessment: selected
      ? {
        schemaVersion: "belief-change-assessment-v1",
        dealStatus: selected.dealId === "deal_henry_ai_v1"
          ? "passed"
          : selected.dealId === "deal_hush_security_v1"
              || selected.dealId === "deal_irregular_v1"
          ? "invested"
          : "watchlist",
        direction: selected.direction,
        scoreBreakdown: {
          finalScore: Number((0.91 - index * 0.05).toFixed(2)),
          confidence: "high",
        },
        gates: {
          chronology: { passed: true, reason: "The event follows the prior record." },
          revisitConditionMapping: { passed: true, mappings: ["condition-to-event"] },
          counterevidence: { passed: true, sourceIds: [analysisSource.id] },
          actionDelta: { passed: true, actionKinds: [selected.action] },
          allPassed: true,
        },
        actions: [{
          kind: selected.action,
          scope: "deal",
          priority: "high",
          visibility: "internal_only",
        }],
      }
      : undefined,
    createdAt: "2026-08-01T20:00:00.000Z",
  };
}

function screeningAnalysis(dealId: string, index: number) {
  const base = analysis(dealId, FORMAL_CASES.length + index);
  const direction = SCREENING_CASES[index]!.direction;
  const score = Number((0.49 - index * 0.01).toFixed(2));
  return {
    ...base,
    dealStatus: "screening" as const,
    outcome: "monitor" as const,
    confidence: "low" as const,
    score,
    beliefAssessment: {
      schemaVersion: "belief-change-assessment-v1",
      dealStatus: "screening" as const,
      direction,
      scoreBreakdown: {
        finalScore: score,
        confidence: "low" as const,
      },
      gates: {
        chronology: { passed: true, reason: "Chronology was established." },
        revisitConditionMapping: { passed: false, mappings: [] },
        counterevidence: { passed: true, sourceIds: [`source_${dealId}`] },
        actionDelta: { passed: false, actionKinds: [] },
        allPassed: false,
      },
      actions: [],
    },
  };
}

function artifact(
  formal: {
    dealId: string;
    direction: "positive" | "negative";
    action: string;
  },
  index: number,
) {
  const dealId = formal.dealId;
  const candidateRunId = `candidate_run_a_${dealId}`;
  const packId = `evidence_pack_run_a_${dealId}`;
  const factId = `fact_${dealId}_round`;
  const assumptionId = `assumption_${dealId}_growth`;
  const calculationId = `calculation:${packId}:market_comps_v1:base_valuation`;
  const coreFrameworkCardIds = SYNTHETIC_FRAMEWORK_PACK.cards.map(({ id }) => id);
  const judgmentIds = coreFrameworkCardIds.map(
    (frameworkCardId) => `judgment:${candidateRunId}:${frameworkCardId}`,
  );
  const decisionId = `decision:${packId}:policy_v1`;
  const draftDefinitions = formal.action === "advance_diligence"
      || formal.action === "reopen_diligence"
    ? [{
      format: "internal_memo",
      channel: "internal",
      audienceType: "internal",
      body: "INTERNAL UNDERWRITING ACTION MEMO — DRAFT ONLY\n\nRetain the reviewed evidence boundary.",
    }, {
      format: "founder_email",
      channel: "email",
      audienceType: "founder",
      body: "DRAFT ONLY — NOT SENT\n\nPlease share the cited diligence evidence.",
    }, {
      format: "founder_sms",
      channel: "sms",
      audienceType: "founder",
      body: "DRAFT ONLY — NOT SENT. Please share the cited diligence evidence.",
    }, {
      format: "founder_linkedin",
      channel: "linkedin",
      audienceType: "founder",
      body: "DRAFT ONLY — NOT SENT\nPlease share the cited diligence evidence.",
    }, {
      format: "diligence_request",
      channel: "email",
      audienceType: "founder",
      body: "DUE DILIGENCE EVIDENCE REQUEST — DRAFT ONLY — NOT SENT\n\nPlease share the cited evidence.",
    }]
    : formal.action === "evaluate_follow_on"
    ? [{
      format: "internal_memo",
      channel: "internal",
      audienceType: "internal",
      body: "INTERNAL UNDERWRITING ACTION MEMO — DRAFT ONLY\n\nRetain the reviewed evidence boundary.",
    }, {
      format: "founder_email",
      channel: "email",
      audienceType: "founder",
      body: "DRAFT ONLY — NOT SENT\n\nPlease share the cited diligence evidence.",
    }, {
      format: "diligence_request",
      channel: "email",
      audienceType: "founder",
      body: "DUE DILIGENCE EVIDENCE REQUEST — DRAFT ONLY — NOT SENT\n\nPlease share the cited evidence.",
    }]
    : [{
      format: "internal_memo",
      channel: "internal",
      audienceType: "internal",
      body: "INTERNAL UNDERWRITING ACTION MEMO — DRAFT ONLY\n\nRetain the reviewed evidence boundary.",
    }];
  return {
    candidateRunId,
    workspaceId: "workspace_quality_parity",
    dealId,
    candidateAnalysisFingerprint: `sha256:${String(index + 1).repeat(64)}`,
    evidencePack: {
      id: packId,
      version: 2,
      workspaceId: "workspace_quality_parity",
      dealId,
      asOfDate: "2026-08-01",
      sourceRevisionIds: [`revision_${dealId}`],
      facts: [{
        id: factId,
        field: "round",
        value: "16000000",
        unit: "USD",
        sourceRevisionId: `revision_${dealId}`,
        acceptedForGate: true,
        locator: { kind: "web_snapshot", url: `https://example.test/${dealId}` },
      }],
      assumptions: [{
        id: assumptionId,
        scenario: "base",
        field: "growth",
        value: "0.50",
        unit: "decimal",
        rationale: "Explicit scenario assumption.",
        inputRefIds: [factId],
      }],
      conflicts: [],
      coverage: {
        minimumModelInputsComplete: true,
        criticalEvidenceComplete: false,
        missingFieldIds: ["retention"],
        blockingConflictIds: [],
        decisionCeiling: "Advance",
        underwritingStatus: "available",
        reasonCodes: ["MISSING_RETENTION"],
      },
      createdAt: "2026-08-01T20:02:00.000Z",
    },
    context: {
      id: "context_seed_b2b_saas_v1",
      contextVersion: "1",
      analysisMode: "full",
      benchmarkCompatibility: "exact",
    },
    scenarioModel: {
      id: `scenario-model:${candidateRunId}`,
      candidateRunId,
      formulaPolicyVersion: "valuation-formulas-v1",
      probabilityWeighted: true,
      scenarios: (["bear", "base", "bull"] as const).map((scenarioName) => ({
        name: scenarioName,
        inputs: SCENARIO_FIELDS.map((field, fieldIndex) => ({
          id: `scenario:${candidateRunId}:${scenarioName}:${field}`,
          scenario: scenarioName,
          field,
          value: field === "probability"
            ? scenarioName === "base" ? "0.50" : "0.25"
            : String(fieldIndex + index + 1),
          unit: "decimal",
          evidenceItemId: field === "revenue_path" ? factId : null,
          assumptionItemId: field === "revenue_path" ? null : assumptionId,
          unavailableReason: null,
        })),
      })),
    },
    calculations: [{
      id: calculationId,
      analysisType: "calculation",
      formulaId: "market_comps_v1",
      formulaVersion: "1",
      inputRefs: [{ itemId: factId, value: "16000000", type: "fact" }],
      output: "64000000",
      unit: "USD",
      status: "completed",
      computedAt: "2026-08-01T20:03:00.000Z",
    }],
    calculationClaimEdges: [{
      claimItemId: calculationId,
      dependencyItemId: factId,
      dependencyType: "fact",
    }],
    judgments: judgmentIds.map((id, frameworkIndex) => ({
      id,
      analysisType: "framework_judgment",
      frameworkCardId: coreFrameworkCardIds[frameworkIndex],
      frameworkVersion: "1",
      applicability: "applicable",
      conclusion: frameworkIndex === 7 ? "mixed" : "supportive",
      supportEvidenceItemIds: [factId],
      counterEvidenceItemIds: [assumptionId],
      unusedEvidenceItemIds: [calculationId],
      strongestSupport: "The sourced round is material.",
      strongestCounterargument: "Retention remains unknown.",
      unknowns: ["Retention"],
      limitations: ["Public evidence only"],
      confidence: {
        sourceReliability: "medium",
        evidenceStrength: "medium",
        evidenceCoverage: "medium",
        applicability: "medium",
        judgment: "medium",
      },
      claimEdges: [{
        claimItemId: id,
        dependencyItemId: factId,
        dependencyType: "fact",
      }],
      fingerprint: `sha256:${String(frameworkIndex + 1).repeat(64)}`,
    })),
    disagreements: [{
      id: `disagreement:${candidateRunId}:growth_vs_revenue_quality`,
      leftJudgmentId: judgmentIds[0],
      rightJudgmentId: judgmentIds[6],
      topic: "growth_vs_revenue_quality",
      explanation: "Growth evidence is stronger than revenue-quality evidence.",
      evidenceItemIds: [factId, assumptionId],
    }],
    valuation: {
      id: `valuation:${packId}`,
      status: "partial",
      scenarios: (["bear", "base", "bull"] as const).map((name, scenarioIndex) => ({
        name,
        valuation: String(48000000 + scenarioIndex * 16000000),
        calculationIds: [calculationId],
      })),
      currentAsk: "80000000",
      maximumAcceptablePreMoney: "64000000",
      grossMoic: "4",
      grossIrr: "0.32",
      pricingPremium: "0.25",
      calculationIds: [calculationId],
      blockerCodes: ["retention_missing"],
    },
    decision: {
      id: decisionId,
      analysisType: "final_synthesis",
      companyQuality: "pass",
      priceAttractiveness: "mixed",
      fundFit: "pass",
      decision: "Advance",
      decisionCeiling: "Advance",
      hardVeto: false,
      firedRules: [{ ruleId: "rule_critical_evidence", result: "pass" }],
      blockingEvidenceItemIds: [assumptionId],
      claimEdges: [{
        claimItemId: decisionId,
        dependencyItemId: judgmentIds[0],
        dependencyType: "framework_judgment",
      }],
      confidence: "medium",
    },
    narrative: "Evidence supports a bounded next step, subject to retention proof.",
    actionDrafts: draftDefinitions.map((draft) => ({
      id: `action_draft:${candidateRunId}:${draft.format}`,
      candidateRunId,
      schemaVersion: "action-draft-v2",
      safety: "status_safe",
      deliveryMode: "draft_only",
      draftPolicyVersion: "status-safe-action-draft-v2",
      actionPolicyVersion: "belief-action-policy-v1",
      format: draft.format,
      channel: draft.channel,
      audienceType: draft.audienceType,
      body: draft.body,
      missingEvidence: [{
        fieldId: "retention",
        label: "Retention evidence",
        externalLabel: "Current retention evidence",
        reasonCode: "MISSING_RETENTION",
        mostLikelyDecisionImpact: "Could lower the decision ceiling.",
      }],
      createdAt: "2026-08-01T20:04:00.000Z",
      updatedAt: "2026-08-01T20:04:00.000Z",
    })),
    versionSnapshot: {
      fundPolicyId: "fund_policy_v1",
      actionPolicyVersion: "belief-action-policy-v1",
      draftPolicyVersion: "status-safe-action-draft-v2",
      frameworkPackId: "framework_pack_v1",
      frameworkCatalogVersion: "1",
      frameworkCatalogFingerprint: `sha256:${"b".repeat(64)}`,
      formulaVersions: ["market_comps_v1@1"],
      providerModel: "fixture-model",
      promptVersion: "prompt-v1",
      schemaVersion: "underwriting-v1",
      settingsFingerprint: `sha256:${"c".repeat(64)}`,
      applicationCommit: "reviewed-commit",
    },
    claimEdges: [{
      claimItemId: decisionId,
      dependencyItemId: calculationId,
      dependencyType: "calculation",
    }],
  };
}

function evidenceContext(mode: "live" | "pinned" | "pinned_30") {
  const pinned = mode !== "live";
  return {
    state: "current",
    schemaVersion: "run-evidence-context-v1",
    evidenceMode: pinned ? "pinned" : "live",
    windowDays: 14,
    anchorAt: mode === "live"
      ? "2026-08-03T20:00:00.000Z"
      : "2026-08-02T06:59:59.000Z",
    windowStartAt: mode === "live"
      ? "2026-07-20T20:00:00.000Z"
      : "2026-07-19T07:00:00.000Z",
    windowEndAt: mode === "live"
      ? "2026-08-03T20:00:00.000Z"
      : "2026-08-02T06:59:59.000Z",
    windowTimezone: "America/Los_Angeles",
    snapshotId: mode === "pinned"
      ? "belief_reversal_2026_08_01"
      : mode === "pinned_30"
      ? "belief_reversal_pinned_30_2026_08_10_v1"
      : null,
    snapshotFingerprint: pinned ? `sha256:${"d".repeat(64)}` : null,
    contextFingerprint: pinned
      ? `sha256:${"e".repeat(64)}`
      : `sha256:${"f".repeat(64)}`,
    bindingFingerprint: pinned
      ? `sha256:${"1".repeat(64)}`
      : `sha256:${"2".repeat(64)}`,
    displayLabel: pinned
      ? "Demo evidence snapshot as of 2026-08-01"
      : "Live evidence window",
    eventCount: 4,
    eventSetFingerprint: `sha256:${"3".repeat(64)}`,
  };
}

function buildPass(mode: "live" | "pinned" | "pinned_30" = "pinned") {
  const runId = "00000000-0000-4000-8000-000000000001";
  const baselineAnalyses = Array.from({ length: 23 }, (_, index) =>
    analysis(
      FORMAL_CASES[index]?.dealId ?? `deal_original_${index - 3}`,
      index,
    )
  );
  const analyses = mode !== "pinned"
    ? [
      ...baselineAnalyses,
      ...SCREENING_CASES.map(({ dealId }, index) =>
        screeningAnalysis(dealId, index)
      ),
    ]
    : baselineAnalyses;
  const artifacts = FORMAL_CASES.map(artifact);
  const outcomeCount = (outcome: string) =>
    analyses.filter((item) => item.outcome === outcome).length;
  return {
    run: {
      id: runId,
      workspaceId: "workspace_quality_parity",
      mode: "xtrace",
      windowDays: 14,
      status: "completed",
      currentStage: "completed",
      warningCount: 0,
      warnings: [],
      workerId: "worker_run_a",
      createdAt: "2026-08-01T20:00:00.000Z",
      startedAt: "2026-08-01T20:00:01.000Z",
      completedAt: "2026-08-01T20:05:00.000Z",
      leaseExpiresAt: null,
      evidenceContext: evidenceContext(mode),
    },
    report: {
      id: "report_run_a",
      workspaceId: "workspace_quality_parity",
      runId,
      createdAt: "2026-08-01T20:01:00.000Z",
      marketSummary: "Four reviewed events changed the bounded next action.",
      analysisStatus: "completed",
      evidenceCoverage: {
        acceptedPublicEvents: 4,
        excludedPublicItems: 0,
        truncatedPublicEvents: 0,
        recalledDealCount: analyses.length,
        unavailableDealCount: 0,
      },
      counts: {
        companyCount: analyses.length,
        beliefRevised: outcomeCount("belief_revised"),
        monitor: outcomeCount("monitor"),
        noMaterialChange: outcomeCount("no_material_change"),
        analysisUnavailable: outcomeCount("analysis_unavailable"),
      },
      priorityDealId: FORMAL_CASES[0].dealId,
      companyAnalyses: analyses,
      opportunities: FORMAL_CASES.map((formal, index) => ({
        rank: index + 1,
        dealId: formal.dealId,
        confidence: "high",
        score: Number((0.91 - index * 0.05).toFixed(2)),
        whyNow: "A reviewed public event changed the next action.",
        nextStep: formal.action,
        sources: [source(formal.dealId)],
        claimSupport: [{
          text: "The public source supports the reviewed fact.",
          kind: "normalized_non_quote",
          sourceIds: [`source_${formal.dealId}`],
        }],
      })),
      evidenceContext: evidenceContext(mode),
    },
    batch: {
      id: "batch_run_a",
      workspaceId: "workspace_quality_parity",
      scanRunId: runId,
      status: "completed",
      batchInputFingerprint: `sha256:${"4".repeat(64)}`,
      fundPolicySnapshotId: "fund_policy_v1",
      rerunOfId: null,
      createdAt: "2026-08-01T20:01:30.000Z",
    },
    selections: analyses.map((item) => {
      const selectedIndex = FORMAL_CASES.findIndex(
        ({ dealId }) => dealId === item.dealId,
      );
      return selectedIndex === -1
        ? {
          batchId: "batch_run_a",
          dealId: item.dealId,
          status: "not_selected" as const,
          rank: null,
          reason: "Did not pass the score and hard-gate selection policy.",
        }
        : {
          batchId: "batch_run_a",
          dealId: item.dealId,
          status: "selected" as const,
          rank: selectedIndex + 1,
          reason: "Highest reviewed deterministic score.",
        };
    }),
    candidates: FORMAL_CASES.map((formal) => ({
      id: `candidate_run_a_${formal.dealId}`,
      batchId: "batch_run_a",
      workspaceId: "workspace_quality_parity",
      dealId: formal.dealId,
      status: "completed",
      candidateAnalysisFingerprint: `sha256:${"5".repeat(64)}`,
      rerunOfId: null,
      createdAt: "2026-08-01T20:01:40.000Z",
      finalizedAt: "2026-08-01T20:05:00.000Z",
    })),
    artifacts,
    cases: FORMAL_CASES.map((formal, index) => ({
      rank: index + 1,
      dealId: formal.dealId,
      score: Number((0.91 - index * 0.05).toFixed(2)),
      confidence: "high",
      direction: formal.direction,
      actions: [formal.action],
      gates: {
        chronology: true,
        revisitConditionMapping: true,
        counterevidence: true,
        actionDelta: true,
        allPassed: true,
      },
      candidateRunId: `candidate_run_a_${formal.dealId}`,
      artifactCandidateRunId: `candidate_run_a_${formal.dealId}`,
      formalDecision: "Advance",
    })),
    semanticFingerprint: `sha256:${"6".repeat(64)}`,
  };
}

function attachRunScopedMarketOrigin(input: {
  pass: ReturnType<typeof buildPass>;
  dealId: string;
  eventId: string;
  triggerSourceId: string;
}) {
  const analysis = input.pass.report.companyAnalyses.find(
    ({ dealId }) => dealId === input.dealId,
  )! as unknown as Record<string, unknown>;
  analysis.marketEvidence = {
    eventIds: [input.eventId],
    events: [{
      id: input.eventId,
      triggerSourceId: input.triggerSourceId,
    }],
  };
  const reviewed = input.pass.artifacts.find(
    ({ dealId }) => dealId === input.dealId,
  )! as unknown as Record<string, unknown>;
  const evidenceRefs = [{
    evidencePackItemId: `fact_${input.dealId}_round`,
    classification: "fact" as const,
    originRefs: [{
      kind: "market_event" as const,
      id: input.eventId,
    }, {
      kind: "source_revision" as const,
      id: `revision_${input.dealId}`,
    }],
    reasonCodes: ["CHANGED_BELIEF_EVIDENCE"],
    resolutionPath: ["market_event", "evidence_pack_fact"],
  }];
  reviewed.decisionCriticalEvidenceProjection = {
    id: `decision-critical-projection:${String(reviewed.candidateRunId)}`,
    workspaceId: reviewed.workspaceId,
    artifactSourceCandidateRunId: reviewed.candidateRunId,
    fingerprint: createDecisionCriticalEvidenceProjectionFingerprint(
      evidenceRefs,
    ),
    evidenceRefs,
  };
}

type FixtureCriticalEvidenceProjection = {
  fingerprint: string;
  evidenceRefs: Parameters<
    typeof createDecisionCriticalEvidenceProjectionFingerprint
  >[0];
};

function criticalEvidenceProjection(
  pass: ReturnType<typeof buildPass>,
  dealId: string,
): FixtureCriticalEvidenceProjection {
  const reviewed = pass.artifacts.find((artifact) => artifact.dealId === dealId)!;
  return (reviewed as unknown as {
    decisionCriticalEvidenceProjection: FixtureCriticalEvidenceProjection;
  }).decisionCriticalEvidenceProjection;
}

function refreshCriticalEvidenceProjectionFingerprint(
  pass: ReturnType<typeof buildPass>,
  dealId: string,
): void {
  const projection = criticalEvidenceProjection(pass, dealId);
  projection.fingerprint = createDecisionCriticalEvidenceProjectionFingerprint(
    projection.evidenceRefs,
  );
}

function attachRunScopedNamedLensAttempt(input: {
  pass: ReturnType<typeof buildPass>;
  dealId: string;
  runDigit: string;
}): void {
  const reviewed = input.pass.artifacts.find(
    ({ dealId }) => dealId === input.dealId,
  )! as unknown as Record<string, unknown>;
  const judgments = reviewed.judgments as Array<Record<string, unknown>>;
  const judgment = judgments[0]!;
  const judgmentId = String(judgment.id);
  const frameworkCardId = String(judgment.frameworkCardId);
  const frameworkVersion = String(judgment.frameworkVersion);
  const candidateRunId = String(reviewed.candidateRunId);
  const workspaceId = String(reviewed.workspaceId);
  const logicalPassageId =
    `${judgmentId}@named-lens-passage-v1@named-lens-generator-v1`;
  const attemptFingerprint = sha(input.runDigit);
  const passageFingerprint = sha("c");
  const projectionFingerprint = sha("e");
  const dispositionFingerprint = sha("1");
  const catalogFingerprint = sha("3");
  const presentationFingerprint = sha("5");
  const finalDispositionsFingerprint = sha("7");

  reviewed.namedLensCatalogConsiderations = [{
    workspaceId,
    artifactSourceCandidateRunId: candidateRunId,
    judgmentOrCatalogCandidateId: judgmentId,
    judgmentId,
    frameworkCardId,
    frameworkVersion,
    initialDisposition: "judgment_eligible",
    reasonCodes: ["AUTHORIZED_CANDIDATE"],
    fingerprint: catalogFingerprint,
  }];
  reviewed.namedLensAttemptRefs = [{
    judgmentOrCatalogCandidateId: judgmentId,
    logicalPassageId,
    attemptNumber: 1,
    attemptFingerprint,
  }];
  reviewed.namedLensProviderAttempts = [{
    workspaceId,
    artifactSourceCandidateRunId: candidateRunId,
    judgmentOrCatalogCandidateId: judgmentId,
    logicalPassageId,
    attemptNumber: 1,
    attemptFingerprint,
    status: "completed",
    telemetry: {
      inputTokens: 100,
      outputTokens: 200,
      costUsd: null,
      costUsdPricingVersion: null,
      costUsdUnavailableReason: "provider_cost_unavailable",
      latencyMs: 10,
    },
    failureReason: null,
  }];
  reviewed.namedLensDispositions = [{
    workspaceId,
    artifactSourceCandidateRunId: candidateRunId,
    judgmentOrCatalogCandidateId: judgmentId,
    judgmentId,
    frameworkCardId,
    frameworkVersion,
    disposition: "selected_main",
    reasonCodes: ["DECISION_RELEVANT"],
    passageFingerprint,
    decisionCriticalEvidenceProjectionFingerprint: projectionFingerprint,
    fingerprint: dispositionFingerprint,
  }];
  reviewed.namedLensPassages = [{
    workspaceId,
    artifactSourceCandidateRunId: candidateRunId,
    judgmentId,
    frameworkCardId,
    frameworkVersion,
    decisionQuestionCode: "QUESTION_01",
    text: "The persisted evidence supports a bounded advisory reading.",
    fingerprint: passageFingerprint,
  }];
  reviewed.namedLensPresentation = {
    workspaceId,
    artifactSourceCandidateRunId: candidateRunId,
    synthesis: {
      branch: "single_perspective",
      text: "One evidence-grounded perspective is available.",
    },
    fingerprint: presentationFingerprint,
  };
  const versionSnapshot = reviewed.versionSnapshot as Record<string, unknown>;
  versionSnapshot.namedLensPassageSchemaVersion = "named-lens-passage-v1";
  versionSnapshot.namedLensGeneratorVersion = "named-lens-generator-v1";
  versionSnapshot.finalDispositionsFingerprint =
    finalDispositionsFingerprint;
  versionSnapshot.presentationFingerprint = presentationFingerprint;
}

type BuiltPass = ReturnType<typeof buildPass>;
type WithStringDealId<T extends { dealId: string }> = Omit<T, "dealId"> & {
  dealId: string;
};
type QualityFixture = Omit<BuiltPass, "report" | "candidates" | "cases"> & {
  report: Omit<BuiltPass["report"], "opportunities"> & {
    opportunities: Array<WithStringDealId<
      BuiltPass["report"]["opportunities"][number]
    >>;
  };
  candidates: Array<WithStringDealId<BuiltPass["candidates"][number]>>;
  cases: Array<WithStringDealId<BuiltPass["cases"][number]>>;
};

function promoteScreeningDeal(
  pass: QualityFixture,
  dealId = SCREENING_CASES[0]!.dealId,
) {
  const promoted = pass.report.companyAnalyses.find(
    (item) => item.dealId === dealId,
  )!;
  const previousOutcome = promoted.outcome;
  const promotedCount = pass.report.companyAnalyses.filter(
    ({ outcome }) => outcome === "belief_revised",
  ).length;
  const score = Number((0.99 - promotedCount * 0.001).toFixed(4));
  promoted.outcome = "belief_revised";
  promoted.confidence = "high";
  promoted.score = score;
  promoted.beliefAssessment = {
    schemaVersion: "belief-change-assessment-v1",
    dealStatus: promoted.dealStatus,
    direction: "positive",
    scoreBreakdown: { finalScore: score, confidence: "high" },
    gates: {
      chronology: { passed: true, reason: "Chronology passed." },
      revisitConditionMapping: {
        passed: true,
        mappings: ["condition-to-event"],
      },
      counterevidence: { passed: true, sourceIds: [`source_${dealId}`] },
      actionDelta: {
        passed: true,
        actionKinds: ["advance_diligence"],
      },
      allPassed: true,
    },
    actions: [{
      kind: "advance_diligence",
      scope: "deal",
      priority: "high",
      visibility: "internal_only",
    }],
  };
  pass.report.opportunities.push({
    rank: pass.report.opportunities.length + 1,
    dealId,
    confidence: "high",
    score,
    whyNow: "A reviewed public event changed the next action.",
    nextStep: "advance_diligence",
    sources: [source(dealId)],
    claimSupport: [{
      text: "The public source supports the reviewed fact.",
      kind: "normalized_non_quote",
      sourceIds: [`source_${dealId}`],
    }],
  });
  pass.selections.forEach((selection) => {
    if (selection.dealId === dealId) {
      selection.status = "selected";
      selection.rank = pass.report.opportunities.length;
      selection.reason = "Underwritten because outcome is belief_revised.";
    }
  });
  const candidateId = `candidate_run_a_${dealId}`;
  pass.candidates.push({
    id: candidateId,
    batchId: "batch_run_a",
    workspaceId: "workspace_quality_parity",
    dealId,
    status: "completed",
    candidateAnalysisFingerprint: `sha256:${"8".repeat(64)}`,
    rerunOfId: null,
    createdAt: "2026-08-01T20:01:40.000Z",
    finalizedAt: "2026-08-01T20:05:00.000Z",
  });
  pass.artifacts.push(artifact({
    dealId,
    direction: "positive",
    action: "advance_diligence",
  }, 4));
  pass.cases.push({
    rank: pass.cases.length + 1,
    dealId,
    score,
    confidence: "high",
    direction: "positive",
    actions: ["advance_diligence"],
    gates: {
      chronology: true,
      revisitConditionMapping: true,
      counterevidence: true,
      actionDelta: true,
      allPassed: true,
    },
    candidateRunId: candidateId,
    artifactCandidateRunId: candidateId,
    formalDecision: "Advance",
  });
  pass.report.counts.beliefRevised += 1;
  if (previousOutcome === "monitor") pass.report.counts.monitor -= 1;
  if (previousOutcome === "no_material_change") {
    pass.report.counts.noMaterialChange -= 1;
  }
  if (previousOutcome === "analysis_unavailable") {
    pass.report.counts.analysisUnavailable -= 1;
  }
  rerankUnderwriting(pass);
}

function rerankUnderwriting(pass: QualityFixture) {
  pass.report.opportunities.sort((left, right) =>
    right.score - left.score
      || left.dealId.localeCompare(right.dealId, "en", { sensitivity: "variant" })
  );
  const rankByDeal = new Map<string, number>();
  pass.report.opportunities.forEach((item, index) => {
    item.rank = index + 1;
    rankByDeal.set(item.dealId, item.rank);
  });
  pass.selections.forEach((selection) => {
    const rank = rankByDeal.get(selection.dealId);
    selection.status = rank === undefined ? "not_selected" : "selected";
    selection.rank = rank ?? null;
  });
  pass.cases.sort((left, right) =>
    (rankByDeal.get(left.dealId) ?? Number.MAX_SAFE_INTEGER)
      - (rankByDeal.get(right.dealId) ?? Number.MAX_SAFE_INTEGER)
  );
  pass.cases.forEach((item, index) => item.rank = index + 1);
}

function retainLegacyPinnedTopFive(pass: QualityFixture) {
  rerankUnderwriting(pass);
  const retained = new Set<string>(
    pass.report.opportunities.slice(0, 5).map(({ dealId }) => dealId),
  );
  pass.report.opportunities = pass.report.opportunities.slice(0, 5);
  pass.selections.forEach((selection) => {
    if (retained.has(selection.dealId)) return;
    selection.status = "not_selected";
    selection.rank = null;
    selection.reason = "Legacy pinned Top-5 read projection.";
  });
  pass.candidates = pass.candidates.filter(({ dealId }) => retained.has(dealId));
  pass.artifacts = pass.artifacts.filter(({ dealId }) => retained.has(dealId));
  pass.cases = pass.cases.filter(({ dealId }) => retained.has(dealId));
  rerankUnderwriting(pass);
}

function removeAllUnderwriting(pass: QualityFixture) {
  for (const item of pass.report.companyAnalyses) {
    if (item.outcome !== "belief_revised") continue;
    item.outcome = "monitor";
    item.confidence = "low";
    item.score = 0.49;
    item.beliefAssessment = {
      ...item.beliefAssessment!,
      scoreBreakdown: { finalScore: 0.49, confidence: "low" },
      gates: {
        ...item.beliefAssessment!.gates,
        actionDelta: { passed: false, actionKinds: [] },
        allPassed: false,
      },
      actions: [],
    };
  }
  pass.report.opportunities = [];
  pass.selections.forEach((selection) => {
    selection.status = "not_selected";
    selection.rank = null;
    selection.reason = "Did not pass the score and hard-gate selection policy.";
  });
  pass.candidates = [];
  pass.artifacts = [];
  pass.cases = [];
  pass.report.counts.beliefRevised = 0;
  pass.report.counts.monitor += 4;
}

test("quality parity accepts a complete 30-analysis live pass over the immutable 23-analysis baseline", () => {
  const baseline = buildPass("pinned");
  assert.doesNotThrow(() =>
    assertBeliefReversalQualityParity(buildPass("live"), baseline)
  );
});

test("quality parity accepts the exact current pinned-30 baseline without treating seven screening Deals as legacy omissions", () => {
  assert.doesNotThrow(() =>
    assertBeliefReversalQualityParity(buildPass("live"), buildPass("pinned_30"))
  );
});

test("quality parity retains an original baseline Deal even when its historical status is screening", () => {
  const live = buildPass("live");
  const pinned = buildPass("pinned_30");
  const originalDealId = "deal_original_1";
  for (const pass of [live, pinned]) {
    const original = pass.report.companyAnalyses.find(
      ({ dealId }) => dealId === originalDealId,
    );
    assert.ok(original);
    original.dealStatus = "screening";
  }
  assert.doesNotThrow(() => assertBeliefReversalQualityParity(live, pinned));
});

test("quality parity rejects a current universe that replaces one reviewed screening Deal", () => {
  const live = buildPass("live");
  const pinned = buildPass("pinned_30");
  for (const pass of [live, pinned]) {
    const analysis = pass.report.companyAnalyses.find(
      ({ dealId }) => dealId === "deal_cascade_v1",
    );
    const selection = pass.selections.find(
      ({ dealId }) => dealId === "deal_cascade_v1",
    );
    assert.ok(analysis);
    assert.ok(selection);
    analysis.dealId = "deal_unreviewed_screening_v1";
    selection.dealId = "deal_unreviewed_screening_v1";
  }
  assert.throws(
    () => assertBeliefReversalQualityParity(live, pinned),
    /must retain reviewed screening Deal deal_cascade_v1/u,
  );
});

test("quality parity rejects a reviewed screening Deal whose status changes", () => {
  const live = buildPass("live");
  const pinned = buildPass("pinned_30");
  for (const pass of [live, pinned]) {
    const analysis = pass.report.companyAnalyses.find(
      ({ dealId }) => dealId === "deal_cascade_v1",
    );
    assert.ok(analysis);
    analysis.dealStatus = "watchlist";
    if (analysis.beliefAssessment) {
      analysis.beliefAssessment.dealStatus = "watchlist";
    }
  }
  assert.throws(
    () => assertBeliefReversalQualityParity(live, pinned),
    /must retain reviewed screening Deal deal_cascade_v1 with screening status/u,
  );
});

test("quality parity accepts an explicit unavailable valuation without invented calculations", () => {
  const live = buildPass("live");
  const pinned = buildPass("pinned");
  for (const pass of [live, pinned]) {
    const reviewed = pass.artifacts[0];
    const calculationId = reviewed.calculations[0]!.id;
    reviewed.calculations = [];
    reviewed.calculationClaimEdges = [];
    reviewed.evidencePack.coverage.minimumModelInputsComplete = false;
    reviewed.evidencePack.coverage.underwritingStatus = "unavailable";
    reviewed.evidencePack.coverage.reasonCodes = [
      "MISSING_MINIMUM_MODEL_INPUTS",
    ];
    const unavailableValuation = reviewed.valuation as unknown as {
      status: string;
      scenarios: Array<{
        name: "bear" | "base" | "bull";
        valuation: string | null;
        calculationIds: string[];
      }>;
      currentAsk: string | null;
      maximumAcceptablePreMoney: string | null;
      grossMoic: string | null;
      grossIrr: string | null;
      pricingPremium: string | null;
      calculationIds: string[];
      blockerCodes: string[];
    };
    unavailableValuation.status = "unavailable";
    unavailableValuation.scenarios = unavailableValuation.scenarios.map((scenario) => ({
      ...scenario,
      valuation: null,
      calculationIds: [],
    }));
    unavailableValuation.currentAsk = null;
    unavailableValuation.maximumAcceptablePreMoney = null;
    unavailableValuation.grossMoic = null;
    unavailableValuation.grossIrr = null;
    unavailableValuation.pricingPremium = null;
    unavailableValuation.calculationIds = [];
    unavailableValuation.blockerCodes = ["MISSING_MINIMUM_MODEL_INPUTS"];
    reviewed.judgments.forEach((judgment) => {
      judgment.unusedEvidenceItemIds = judgment.unusedEvidenceItemIds.filter(
        (id) => id !== calculationId,
      );
    });
    reviewed.claimEdges = reviewed.claimEdges.filter(
      (edge) => edge.dependencyType !== "calculation",
    );
  }

  assert.doesNotThrow(() => assertBeliefReversalQualityParity(live, pinned));
});

test("quality parity rejects empty calculations without typed unavailable authority", () => {
  const pinned = buildPass("pinned");
  pinned.artifacts[0].calculations = [];
  assert.throws(
    () => assertBeliefReversalQualityParity(buildPass("live"), pinned),
    /calculations.*unavailable valuation/u,
  );
});

test("quality parity accepts authorized advisory judgments in addition to all eight core frameworks", () => {
  const live = buildPass("live");
  const pinned = buildPass("pinned");
  for (const pass of [live, pinned]) {
    const reviewed = pass.artifacts[0];
    reviewed.judgments.push({
      ...structuredClone(reviewed.judgments[0]!),
      id: `judgment:${reviewed.candidateRunId}:authorized_advisory_1`,
      frameworkCardId: "framework_card_authorized_advisory_1",
    });
  }
  assert.doesNotThrow(() => assertBeliefReversalQualityParity(live, pinned));
});

test("quality parity treats framework judgments and disagreements as semantic sets", () => {
  const live = buildPass("live");
  live.artifacts.forEach((reviewed) => {
    reviewed.judgments.reverse();
    reviewed.disagreements.reverse();
  });

  assert.doesNotThrow(() =>
    assertBeliefReversalQualityParity(live, buildPass("pinned"))
  );
});

test("quality parity excludes only expected run identity, lifecycle timestamps, and evidence binding labels", () => {
  const baseline = buildPass("pinned");
  const live = buildPass("live");
  live.run.id = "00000000-0000-4000-8000-000000000099";
  live.run.workerId = "worker_live";
  live.run.createdAt = "2026-08-03T20:00:00.000Z";
  live.run.startedAt = "2026-08-03T20:00:01.000Z";
  live.run.completedAt = "2026-08-03T20:05:00.000Z";
  live.report.id = "report_live";
  live.report.runId = live.run.id;
  live.report.createdAt = "2026-08-03T20:01:00.000Z";
  live.batch.id = "batch_live";
  live.batch.scanRunId = live.run.id;
  live.batch.batchInputFingerprint = `sha256:${"7".repeat(64)}`;
  live.batch.createdAt = "2026-08-03T20:01:30.000Z";
  live.report.companyAnalyses.forEach((item) => {
    item.id = `analysis_live_${item.dealId}`;
    item.reportId = live.report.id;
    item.runId = live.run.id;
    item.createdAt = "2026-08-03T20:01:00.000Z";
  });
  live.selections.forEach((selection) => selection.batchId = live.batch.id);
  live.candidates.forEach((candidate, index) => {
    const oldId = candidate.id;
    const nextId = `candidate_live_${candidate.dealId}`;
    candidate.id = nextId;
    candidate.batchId = live.batch.id;
    candidate.candidateAnalysisFingerprint = `sha256:${String(index + 7).repeat(64)}`;
    candidate.createdAt = "2026-08-03T20:01:40.000Z";
    candidate.finalizedAt = "2026-08-03T20:05:00.000Z";
    const artifact = live.artifacts.find(({ dealId }) => dealId === candidate.dealId)!;
    artifact.candidateRunId = nextId;
    artifact.candidateAnalysisFingerprint = candidate.candidateAnalysisFingerprint;
    artifact.scenarioModel.id = `scenario-model:${nextId}`;
    artifact.scenarioModel.candidateRunId = nextId;
    artifact.scenarioModel.scenarios.forEach(({ inputs }) => {
      inputs.forEach((input) => input.id = input.id.replace(oldId, nextId));
    });
    artifact.actionDrafts.forEach((draft) => {
      draft.id = draft.id.replace(oldId, nextId);
      draft.candidateRunId = nextId;
      draft.createdAt = "2026-08-03T20:04:00.000Z";
      draft.updatedAt = "2026-08-03T20:04:00.000Z";
    });
    const reviewedCase = live.cases.find(({ dealId }) => dealId === candidate.dealId)!;
    reviewedCase.candidateRunId = nextId;
    reviewedCase.artifactCandidateRunId = nextId;
  });
  const baselineInlineCandidateId = baseline.candidates[0]!.id;
  const liveInlineCandidateId = live.candidates[0]!.id;
  baseline.artifacts[0]!.actionDrafts[0]!.body +=
    `\nEvidence identity: ${baselineInlineCandidateId}`;
  live.artifacts[0]!.actionDrafts[0]!.body +=
    `\nEvidence identity: ${liveInlineCandidateId}`;

  assert.doesNotThrow(() =>
    assertBeliefReversalQualityParity(live, baseline)
  );
});

test("quality parity aliases a run-scoped MarketEvent origin only through its stable trigger source", () => {
  const live = buildPass("live");
  const pinned = buildPass("pinned");
  const dealId = FORMAL_CASES[0].dealId;
  attachRunScopedMarketOrigin({
    pass: live,
    dealId,
    eventId: "market_284a1b524d6cd30f2e75def4",
    triggerSourceId: `source_${dealId}`,
  });
  attachRunScopedMarketOrigin({
    pass: pinned,
    dealId,
    eventId: "event_henry_series_a_v1",
    triggerSourceId: `source_${dealId}`,
  });

  assert.doesNotThrow(() => assertBeliefReversalQualityParity(live, pinned));

  const foreign = buildPass("live");
  attachRunScopedMarketOrigin({
    pass: foreign,
    dealId,
    eventId: "market_284a1b524d6cd30f2e75def4",
    triggerSourceId: "source_foreign_event",
  });
  assert.throws(
    () => assertBeliefReversalQualityParity(foreign, pinned),
    /marketEvidence|market_event|originRefs|triggerSourceId/u,
  );
});

test("quality parity verifies the original critical-evidence fingerprint before semantic comparison", () => {
  const live = buildPass("live");
  const pinned = buildPass("pinned");
  const dealId = FORMAL_CASES[0].dealId;
  attachRunScopedMarketOrigin({
    pass: live,
    dealId,
    eventId: "market_284a1b524d6cd30f2e75def4",
    triggerSourceId: `source_${dealId}`,
  });
  attachRunScopedMarketOrigin({
    pass: pinned,
    dealId,
    eventId: "event_henry_series_a_v1",
    triggerSourceId: `source_${dealId}`,
  });
  criticalEvidenceProjection(live, dealId).fingerprint =
    `sha256:${"f".repeat(64)}`;

  assert.throws(
    () => assertBeliefReversalQualityParity(live, pinned),
    /fingerprint does not match its original run-bound projection/u,
  );
});

test("quality parity rejects non-event critical-evidence semantic drift", () => {
  const mutations: Array<{
    name: string;
    mutate: (
      reference: FixtureCriticalEvidenceProjection["evidenceRefs"][number],
    ) => void;
  }> = [{
    name: "source-revision evidence changes",
    mutate: (reference) => {
      reference.originRefs[1] = {
        kind: "source_revision",
        id: "revision_semantically_different",
      };
    },
  }, {
    name: "reason code changes",
    mutate: (reference) => {
      reference.reasonCodes = ["COUNTEREVIDENCE_REVIEW_REQUIRED"];
    },
  }, {
    name: "resolution path changes",
    mutate: (reference) => {
      reference.resolutionPath = ["market_event", "different_projection_path"];
    },
  }];

  for (const { name, mutate } of mutations) {
    const live = buildPass("live");
    const pinned = buildPass("pinned");
    const dealId = FORMAL_CASES[0].dealId;
    attachRunScopedMarketOrigin({
      pass: live,
      dealId,
      eventId: "market_284a1b524d6cd30f2e75def4",
      triggerSourceId: `source_${dealId}`,
    });
    attachRunScopedMarketOrigin({
      pass: pinned,
      dealId,
      eventId: "event_henry_series_a_v1",
      triggerSourceId: `source_${dealId}`,
    });
    mutate(criticalEvidenceProjection(live, dealId).evidenceRefs[0]!);
    refreshCriticalEvidenceProjectionFingerprint(live, dealId);

    assert.throws(
      () => assertBeliefReversalQualityParity(live, pinned),
      /decisionCriticalEvidenceProjection/u,
      name,
    );
  }
});

test("quality parity aliases raw Named Lens attempts only after exact ledger binding", () => {
  const live = buildPass("live");
  const pinned = buildPass("pinned");
  const dealId = FORMAL_CASES[0].dealId;
  attachRunScopedNamedLensAttempt({ pass: live, dealId, runDigit: "a" });
  attachRunScopedNamedLensAttempt({ pass: pinned, dealId, runDigit: "b" });

  assert.doesNotThrow(() => assertBeliefReversalQualityParity(live, pinned));

  const corruptions: Array<{
    name: string;
    mutate: (artifact: Record<string, unknown>) => void;
  }> = [{
    name: "substituted ref fingerprint",
    mutate: (artifact) => {
      const refs = artifact.namedLensAttemptRefs as Array<Record<string, unknown>>;
      refs[0]!.attemptFingerprint = sha("9");
    },
  }, {
    name: "foreign candidate ledger row",
    mutate: (artifact) => {
      const attempts = artifact.namedLensProviderAttempts as Array<
        Record<string, unknown>
      >;
      attempts[0]!.artifactSourceCandidateRunId = "candidate_foreign";
    },
  }, {
    name: "missing attempt ref",
    mutate: (artifact) => {
      const refs = artifact.namedLensAttemptRefs as unknown[];
      refs.pop();
    },
  }];
  for (const { name, mutate } of corruptions) {
    const corrupted = buildPass("live");
    attachRunScopedNamedLensAttempt({
      pass: corrupted,
      dealId,
      runDigit: "a",
    });
    mutate(corrupted.artifacts[0] as unknown as Record<string, unknown>);
    assert.throws(
      () => assertBeliefReversalQualityParity(corrupted, pinned),
      /Named Lens attempt|foreign or unsettled/u,
      name,
    );
  }
});

test("quality parity preserves persisted Named Lens execution and content semantics", () => {
  const mutations: Array<{
    name: string;
    mutate: (artifact: Record<string, unknown>) => void;
  }> = [{
    name: "provider model",
    mutate: (artifact) => {
      (artifact.versionSnapshot as Record<string, unknown>).providerModel =
        "different-provider/different-model";
    },
  }, {
    name: "prompt version",
    mutate: (artifact) => {
      (artifact.versionSnapshot as Record<string, unknown>).promptVersion =
        "different-prompt";
    },
  }, {
    name: "schema version",
    mutate: (artifact) => {
      (artifact.versionSnapshot as Record<string, unknown>).schemaVersion =
        "different-schema";
    },
  }, {
    name: "settings fingerprint",
    mutate: (artifact) => {
      (artifact.versionSnapshot as Record<string, unknown>).settingsFingerprint =
        sha("0");
    },
  }, {
    name: "provider input",
    mutate: (artifact) => {
      const pack = artifact.evidencePack as {
        facts: Array<Record<string, unknown>>;
      };
      pack.facts[0]!.value = "semantically different evidence";
    },
  }, {
    name: "eligible catalog",
    mutate: (artifact) => {
      const catalog = artifact.namedLensCatalogConsiderations as Array<
        Record<string, unknown>
      >;
      catalog[0]!.reasonCodes = ["DIFFERENT_ELIGIBILITY_BASIS"];
    },
  }, {
    name: "disposition",
    mutate: (artifact) => {
      const dispositions = artifact.namedLensDispositions as Array<
        Record<string, unknown>
      >;
      dispositions[0]!.reasonCodes = ["DIFFERENT_PLACEMENT_BASIS"];
    },
  }, {
    name: "passage",
    mutate: (artifact) => {
      const passages = artifact.namedLensPassages as Array<
        Record<string, unknown>
      >;
      passages[0]!.text = "A materially different persisted passage.";
    },
  }];

  for (const { name, mutate } of mutations) {
    const live = buildPass("live");
    const pinned = buildPass("pinned");
    const dealId = FORMAL_CASES[0].dealId;
    attachRunScopedNamedLensAttempt({ pass: live, dealId, runDigit: "a" });
    attachRunScopedNamedLensAttempt({ pass: pinned, dealId, runDigit: "b" });
    mutate(live.artifacts[0] as unknown as Record<string, unknown>);

    assert.throws(
      () => assertBeliefReversalQualityParity(live, pinned),
      /quality parity mismatch/u,
      name,
    );
  }
});

test("quality parity rejects incomplete report and underwriting section counts", () => {
  const cases: Array<{
    name: string;
    mutate: (value: QualityFixture) => void;
    expected: RegExp;
  }> = [{
    name: "one of 30 live analyses is missing",
    mutate: (value) => void value.report.companyAnalyses.pop(),
    expected: /30 company analyses/u,
  }, {
    name: "one belief-revised opportunity is missing",
    mutate: (value) => void value.report.opportunities.pop(),
    expected: /opportunit|score-derived|selected/u,
  }, {
    name: "a source revision is missing",
    mutate: (value) => void value.artifacts[0].evidencePack.sourceRevisionIds.pop(),
    expected: /source revision/u,
  }, {
    name: "a framework judgment is missing",
    mutate: (value) => void value.artifacts[0].judgments.pop(),
    expected: /eight (?:core )?framework judgments/u,
  }, {
    name: "an action draft is missing",
    mutate: (value) => void value.artifacts[0].actionDrafts.pop(),
    expected: /action draft/u,
  }];

  for (const item of cases) {
    const changed = buildPass("live");
    item.mutate(changed);
    assert.throws(
      () => assertBeliefReversalQualityParity(changed, buildPass("pinned")),
      item.expected,
      item.name,
    );
  }

  const incompletePinned = buildPass("pinned");
  incompletePinned.report.companyAnalyses.pop();
  assert.throws(
    () => assertBeliefReversalQualityParity(
      buildPass("live"),
      incompletePinned,
    ),
    /23 company analyses/u,
  );
});

test("quality parity underwrites all 0, 1, 4, 5, 7, or 30 belief-revised analyses without truncation", () => {
  for (const expectedCount of [0, 1, 4, 5, 7, 30]) {
    const baseline = buildPass("pinned");
    const live = buildPass("live");
    if (expectedCount === 0 || expectedCount === 1) {
      removeAllUnderwriting(baseline);
      removeAllUnderwriting(live);
    }
    if (expectedCount === 1) {
      const sharedDealId = baseline.report.companyAnalyses[4]!.dealId;
      promoteScreeningDeal(baseline, sharedDealId);
      promoteScreeningDeal(live, sharedDealId);
    }
    if (expectedCount === 5 || expectedCount === 7) {
      SCREENING_CASES.slice(0, expectedCount - 4).forEach(({ dealId }) =>
        promoteScreeningDeal(live, dealId)
      );
    }
    if (expectedCount === 30) {
      const sharedNonRevised = baseline.report.companyAnalyses
        .filter(({ outcome }) => outcome !== "belief_revised")
        .map(({ dealId }) => dealId);
      sharedNonRevised.forEach((dealId) => {
        promoteScreeningDeal(baseline, dealId);
        promoteScreeningDeal(live, dealId);
      });
      SCREENING_CASES.forEach(({ dealId }) =>
        promoteScreeningDeal(live, dealId)
      );
      retainLegacyPinnedTopFive(baseline);
    }
    assert.equal(live.report.counts.beliefRevised, expectedCount);
    assert.equal(live.candidates.length, expectedCount);
    assert.equal(live.artifacts.length, expectedCount);
    assert.doesNotThrow(
      () => assertBeliefReversalQualityParity(live, baseline),
      `belief_revised=${expectedCount}`,
    );
  }
});

test("quality parity treats priority rank only as deterministic ordering and rejects terminal count drift", () => {
  const badRank = buildPass("live");
  [badRank.report.opportunities[0]!.rank, badRank.report.opportunities[1]!.rank] =
    [badRank.report.opportunities[1]!.rank, badRank.report.opportunities[0]!.rank];
  assert.throws(
    () => assertBeliefReversalQualityParity(badRank, buildPass("pinned")),
    /rank|score-derived/u,
  );

  const highScoreMonitor = buildPass("live");
  const screened = highScoreMonitor.report.companyAnalyses.at(-1)!;
  screened.score = 1;
  screened.beliefAssessment!.scoreBreakdown.finalScore = 1;
  assert.doesNotThrow(() =>
    assertBeliefReversalQualityParity(highScoreMonitor, buildPass("pinned"))
  );

  const priorityRankLive = buildPass("live");
  for (const item of [
    ...priorityRankLive.report.opportunities,
    ...priorityRankLive.selections,
    ...priorityRankLive.cases,
  ]) {
    const ranked = item as { rank?: number | null; priorityRank?: number | null };
    ranked.priorityRank = ranked.rank;
    delete ranked.rank;
  }
  assert.doesNotThrow(() =>
    assertBeliefReversalQualityParity(priorityRankLive, buildPass("pinned"))
  );

  const tiedBaseline = buildPass("pinned");
  const tiedLive = buildPass("live");
  for (const pass of [tiedBaseline, tiedLive]) {
    for (const dealId of [FORMAL_CASES[0].dealId, FORMAL_CASES[1].dealId]) {
      const analysis = pass.report.companyAnalyses.find(
        (item) => item.dealId === dealId,
      )!;
      analysis.score = 0.9;
      analysis.beliefAssessment!.scoreBreakdown.finalScore = 0.9;
      pass.report.opportunities.find((item) => item.dealId === dealId)!.score = 0.9;
      pass.cases.find((item) => item.dealId === dealId)!.score = 0.9;
    }
    rerankUnderwriting(pass);
  }
  assert.doesNotThrow(() =>
    assertBeliefReversalQualityParity(tiedLive, tiedBaseline)
  );
  const tiedRows = tiedLive.report.opportunities.slice(0, 2).reverse();
  tiedRows.forEach((item, index) => item.rank = index + 1);
  tiedLive.report.opportunities.splice(0, 2, ...tiedRows);
  assert.throws(
    () => assertBeliefReversalQualityParity(tiedLive, tiedBaseline),
    /deterministic|priority rank/u,
  );

  const missingTerminal = buildPass("live");
  missingTerminal.candidates.pop();
  assert.throws(
    () => assertBeliefReversalQualityParity(
      missingTerminal,
      buildPass("pinned"),
    ),
    /terminal|candidate|selected/u,
  );
});

test("quality parity requires all four outcome counts to total 30 and match analyses", () => {
  const changed = buildPass("live");
  changed.report.counts.monitor -= 1;
  assert.throws(
    () => assertBeliefReversalQualityParity(changed, buildPass("pinned")),
    /outcome|counts|30/u,
  );
});

test("quality parity requires complete source coverage for all 30 live analyses", () => {
  const changed = buildPass("live");
  changed.report.companyAnalyses.at(-1)!.sources = [];
  assert.throws(
    () => assertBeliefReversalQualityParity(changed, buildPass("pinned")),
    /source revision|source coverage/u,
  );
});

test("quality parity forbids frameworks, valuation, decisions, and drafts for every non-belief-revised Deal", () => {
  const changed = buildPass("live");
  const unselectedDealId = SCREENING_CASES[0]!.dealId;
  changed.artifacts.push(artifact({
    dealId: unselectedDealId,
    direction: "positive",
    action: "advance_diligence",
  }, 4));
  assert.throws(
    () => assertBeliefReversalQualityParity(changed, buildPass("pinned")),
    /unselected|artifact|selected/u,
  );

  const unavailable = buildPass("live");
  const unavailableAnalysis = unavailable.report.companyAnalyses.at(-1)!;
  unavailableAnalysis.outcome = "analysis_unavailable";
  unavailableAnalysis.score = 0;
  unavailableAnalysis.confidence = "low";
  unavailableAnalysis.sources = [];
  unavailableAnalysis.claimSupport = [];
  unavailableAnalysis.verifiedSourceCount = 0;
  unavailableAnalysis.beliefAssessment = undefined;
  unavailable.report.counts.monitor -= 1;
  unavailable.report.counts.analysisUnavailable += 1;
  unavailable.report.analysisStatus = "incomplete";
  unavailable.report.evidenceCoverage.recalledDealCount -= 1;
  unavailable.report.evidenceCoverage.unavailableDealCount += 1;
  assert.doesNotThrow(() =>
    assertBeliefReversalQualityParity(unavailable, buildPass("pinned"))
  );
});

test("quality parity fails closed on every reviewed semantic surface", () => {
  const cases: Array<{
    name: string;
    mutate: (value: QualityFixture) => void;
    expected: RegExp;
  }> = [{
    name: "analysis score",
    mutate: (value) => value.report.companyAnalyses[0].score = 0.5,
    expected: /companyAnalyses/u,
  }, {
    name: "analysis confidence",
    mutate: (value) => value.report.companyAnalyses[0].confidence = "medium",
    expected: /companyAnalyses/u,
  }, {
    name: "belief direction",
    mutate: (value) => value.report.companyAnalyses[0].beliefAssessment!.direction = "negative",
    expected: /beliefAssessment|CompanyAnalysis/u,
  }, {
    name: "hard gate",
    mutate: (value) => value.report.companyAnalyses[0].beliefAssessment!.gates.counterevidence.passed = false,
    expected: /gates/u,
  }, {
    name: "typed action",
    mutate: (value) => {
      const action = value.report.companyAnalyses[0]
        .beliefAssessment!.actions[0] as { kind: string };
      action.kind = "deprioritize";
    },
    expected: /actions/u,
  }, {
    name: "opportunity rank",
    mutate: (value) => value.report.opportunities[0].rank = 4,
    expected: /rank/u,
  }, {
    name: "Evidence Pack fact",
    mutate: (value) => value.artifacts[0].evidencePack.facts[0].value = "17000000",
    expected: /facts/u,
  }, {
    name: "Evidence Pack assumption",
    mutate: (value) => value.artifacts[0].evidencePack.assumptions[0].value = "0.60",
    expected: /assumptions/u,
  }, {
    name: "coverage decision ceiling",
    mutate: (value) => value.artifacts[0].evidencePack.coverage.decisionCeiling = "Invest Candidate",
    expected: /decisionCeiling/u,
  }, {
    name: "missing evidence",
    mutate: (value) => value.artifacts[0].evidencePack.coverage.missingFieldIds = [],
    expected: /missingFieldIds/u,
  }, {
    name: "scenario input",
    mutate: (value) => value.artifacts[0].scenarioModel.scenarios[1].inputs[2].value = "999",
    expected: /scenarioModel/u,
  }, {
    name: "calculation output",
    mutate: (value) => value.artifacts[0].calculations[0].output = "1",
    expected: /calculations/u,
  }, {
    name: "valuation",
    mutate: (value) => value.artifacts[0].valuation.grossMoic = "3",
    expected: /valuation/u,
  }, {
    name: "framework conclusion",
    mutate: (value) => value.artifacts[0].judgments[0].conclusion = "negative",
    expected: /judgments/u,
  }, {
    name: "framework disagreement",
    mutate: (value) => value.artifacts[0].disagreements[0].explanation = "Changed disagreement.",
    expected: /disagreements/u,
  }, {
    name: "formal decision",
    mutate: (value) => value.artifacts[0].decision.decision = "Watch",
    expected: /decision/u,
  }, {
    name: "version policy",
    mutate: (value) => value.artifacts[0].versionSnapshot.promptVersion = "prompt-v2",
    expected: /versionSnapshot/u,
  }, {
    name: "draft content",
    mutate: (value) => value.artifacts[0].actionDrafts[0].body += "\nChanged.",
    expected: /actionDrafts/u,
  }, {
    name: "external missing-evidence label",
    mutate: (value) => value.artifacts[0].actionDrafts[0].missingEvidence[0].externalLabel = "Changed label",
    expected: /externalLabel/u,
  }, {
    name: "source revision coverage",
    mutate: (value) => value.artifacts[0].evidencePack.sourceRevisionIds[0] = "revision_other",
    expected: /source revision|sourceRevisionIds/u,
  }, {
    name: "citation coverage",
    mutate: (value) => value.report.opportunities[0].claimSupport[0].sourceIds = ["source_missing"],
    expected: /citation/u,
  }];

  for (const item of cases) {
    const changed = buildPass("live");
    item.mutate(changed);
    assert.throws(
      () => assertBeliefReversalQualityParity(changed, buildPass("pinned")),
      item.expected,
      item.name,
    );
  }
});

test("quality parity does not exclude unapproved policy fingerprints", () => {
  const changed = buildPass("live");
  changed.artifacts[0].versionSnapshot.frameworkCatalogFingerprint =
    `sha256:${"9".repeat(64)}`;
  assert.throws(
    () => assertBeliefReversalQualityParity(changed, buildPass("pinned")),
    /frameworkCatalogFingerprint/u,
  );
});
