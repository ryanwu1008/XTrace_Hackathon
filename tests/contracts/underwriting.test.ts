import assert from "node:assert/strict";
import test from "node:test";

import {
  ActionDraftSchema,
  CandidateCheckpointSchema,
  CandidateRunSchema,
  DecisionResultSchema,
  FrameworkDisagreementSchema,
  FrameworkJudgmentSchema,
  FundPolicySnapshotSchema,
  LegacyPinnedUnderwritingSelectionSchema,
  MissingEvidenceItemSchema,
  parseActionDraftRead,
  ResolvedUnderwritingContextSchema,
  ScenarioInputSchema,
  ScenarioModelSchema,
  UnderwritingBatchSchema,
  UnderwritingQueueEntrySchema,
  UnderwritingSelectionSchema,
  ValuationEvaluationSchema,
  XTraceLineageSnapshotSchema,
} from "../../lib/contracts/underwriting";

function judgmentFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "judgment_1",
    analysisType: "framework_judgment",
    frameworkCardId: "card_1",
    frameworkVersion: "1",
    applicability: "applicable",
    conclusion: "mixed",
    supportEvidenceItemIds: ["fact_1"],
    counterEvidenceItemIds: ["fact_2"],
    unusedEvidenceItemIds: ["fact_3"],
    strongestSupport: "Growth is strong.",
    strongestCounterargument: "Retention is not yet verified.",
    unknowns: ["Net retention"],
    limitations: ["One quarter of cohort data"],
    confidence: {
      sourceReliability: "high",
      evidenceStrength: "medium",
      evidenceCoverage: "medium",
      applicability: "high",
      judgment: "medium",
    },
    claimEdges: [{
      claimItemId: "judgment_1",
      dependencyItemId: "fact_1",
      dependencyType: "fact",
    }],
    fingerprint: "sha256:judgment",
    ...overrides,
  };
}

function scenarioInput(
  scenario: "bear" | "base" | "bull",
  field: string,
): Record<string, unknown> {
  return {
    id: `${scenario}_${field}`,
    scenario,
    field,
    value: null,
    unit: null,
    evidenceItemId: null,
    assumptionItemId: null,
    unavailableReason: `No ${field} evidence`,
  };
}

const scenarioFields = [
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

function scenarioModelFixture(): Record<string, unknown> {
  return {
    id: "scenario_model_1",
    candidateRunId: "candidate_1",
    formulaPolicyVersion: "1",
    scenarios: (["bear", "base", "bull"] as const).map((name) => ({
      name,
      inputs: scenarioFields.map((field) => scenarioInput(name, field)),
    })),
    probabilityWeighted: false,
  };
}

function decisionFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "decision_1",
    analysisType: "final_synthesis",
    companyQuality: "mixed",
    priceAttractiveness: "unavailable",
    fundFit: "pass",
    decision: "Watch",
    decisionCeiling: "Watch",
    hardVeto: false,
    firedRules: [{
      ruleId: "critical_evidence_v1",
      inputRefs: ["fact_1"],
      result: "fail",
      appliedCeiling: "Watch",
      veto: false,
    }],
    blockingEvidenceItemIds: ["fact_2"],
    claimEdges: [{
      claimItemId: "decision_1",
      dependencyItemId: "judgment_1",
      dependencyType: "framework_judgment",
    }],
    confidence: "medium",
    ...overrides,
  };
}

test("round-trips a strict fund policy snapshot and resolved context", () => {
  const policy = {
    id: "policy_1",
    workspaceId: "workspace_1",
    version: 1,
    source: "user_custom",
    values: {
      targetOwnership: "0.1",
      enabled: true,
      stages: ["seed", "series_a"],
      decision: null,
      metadata: { owner: "investment_team" },
    },
    createdByUserId: "user_1",
    createdAt: "2026-07-28T10:00:00.000Z",
  };
  const context = {
    id: "context_1",
    contextVersion: "1",
    stage: "seed",
    businessModel: "enterprise_ai",
    geography: "us",
    securityType: "preferred",
    asOfDate: "2026-07-28",
    criticalEvidenceProfileId: "profile_1",
    benchmarkPackId: null,
    benchmarkCompatibility: "unavailable",
    valuationMethodPolicyId: "valuation_policy_1",
    decisionPolicyId: "decision_policy_1",
    frameworkPackId: "framework_pack_1",
  };

  assert.deepEqual(FundPolicySnapshotSchema.parse(policy), policy);
  assert.deepEqual(ResolvedUnderwritingContextSchema.parse(context), context);
  assert.throws(() => FundPolicySnapshotSchema.parse({
    ...policy,
    workspaceId: "",
  }));
  assert.throws(() => ResolvedUnderwritingContextSchema.parse({
    ...context,
    asOfDate: "28 July 2026",
  }));
});

test("keeps framework judgments source-grounded through saved evidence items", () => {
  assert.deepEqual(
    FrameworkJudgmentSchema.parse(judgmentFixture()),
    judgmentFixture(),
  );
  assert.throws(() => FrameworkJudgmentSchema.parse(judgmentFixture({
    claimEdges: [{
      claimItemId: "another_judgment",
      dependencyItemId: "fact_1",
      dependencyType: "fact",
    }],
  })));
  assert.throws(() => FrameworkJudgmentSchema.parse(judgmentFixture({
    claimEdges: [{
      claimItemId: "judgment_1",
      dependencyItemId: "revision_1",
      dependencyType: "source_revision",
    }],
  })));
});

test("round-trips explicit framework disagreement topics", () => {
  const disagreement = {
    id: "disagreement_1",
    leftJudgmentId: "judgment_1",
    rightJudgmentId: "judgment_2",
    topic: "company_quality_vs_price",
    explanation: "Quality is promising but the price is unsupported.",
    evidenceItemIds: ["fact_1", "calculation_1"],
  };
  assert.deepEqual(
    FrameworkDisagreementSchema.parse(disagreement),
    disagreement,
  );
  assert.throws(() => FrameworkDisagreementSchema.parse({
    ...disagreement,
    rightJudgmentId: "judgment_1",
  }));
});

test("accepts source-backed, assumption-backed, and unavailable scenario inputs", () => {
  const sourceBacked = {
    ...scenarioInput("base", "arr_path"),
    value: "2400000",
    unit: "USD",
    evidenceItemId: "fact_arr",
    unavailableReason: null,
  };
  const assumptionBacked = {
    ...scenarioInput("base", "growth"),
    value: "0.4",
    unit: "decimal",
    assumptionItemId: "assumption_growth",
    unavailableReason: null,
  };

  assert.deepEqual(ScenarioInputSchema.parse(sourceBacked), sourceBacked);
  assert.deepEqual(
    ScenarioInputSchema.parse(assumptionBacked),
    assumptionBacked,
  );
  assert.deepEqual(
    ScenarioInputSchema.parse(scenarioInput("base", "burn")),
    scenarioInput("base", "burn"),
  );
});

test("rejects ambiguous or silently missing ScenarioInput lineage", () => {
  const invalid = [
    {
      ...scenarioInput("base", "growth"),
      value: "0.4",
      evidenceItemId: "fact_1",
      assumptionItemId: "assumption_1",
      unavailableReason: null,
    },
    {
      ...scenarioInput("base", "growth"),
      unavailableReason: null,
    },
    {
      ...scenarioInput("base", "growth"),
      value: null,
      evidenceItemId: "fact_1",
    },
  ];
  for (const input of invalid) {
    assert.throws(() => ScenarioInputSchema.parse(input));
  }
});

test("requires an exact complete Bear, Base, and Bull scenario model", () => {
  const fixture = scenarioModelFixture();
  assert.deepEqual(ScenarioModelSchema.parse(fixture), fixture);

  const scenarios = fixture.scenarios as Array<Record<string, unknown>>;
  assert.throws(() => ScenarioModelSchema.parse({
    ...fixture,
    scenarios: scenarios.slice(0, 2),
  }));
  assert.throws(() => ScenarioModelSchema.parse({
    ...fixture,
    scenarios: scenarios.map((scenario, index) => index === 0
      ? {
          ...scenario,
          inputs: (
            scenario.inputs as Array<Record<string, unknown>>
          ).slice(1),
        }
      : scenario),
  }));
  assert.throws(() => ScenarioModelSchema.parse({
    ...fixture,
    scenarios: scenarios.map((scenario, index) => index === 0
      ? {
          ...scenario,
          inputs: (
            scenario.inputs as Array<Record<string, unknown>>
          ).map((input, inputIndex) => inputIndex === 0
            ? { ...input, scenario: "base" }
            : input),
        }
      : scenario),
  }));
});

test("round-trips valuation results without inventing unavailable numbers", () => {
  const valuation = {
    id: "valuation_1",
    status: "partial",
    scenarios: [
      { name: "bear", valuation: "18000000", calculationIds: ["calc_bear"] },
      { name: "base", valuation: "24000000", calculationIds: ["calc_base"] },
      { name: "bull", valuation: null, calculationIds: [] },
    ],
    currentAsk: "30000000",
    maximumAcceptablePreMoney: null,
    initialOwnership: null,
    postDilutionOwnership: null,
    grossMoic: null,
    grossIrr: null,
    pricingPremium: "0.25",
    calculationIds: ["calc_bear", "calc_base", "calc_premium"],
    blockerCodes: ["BULL_INPUT_UNAVAILABLE"],
  };
  assert.deepEqual(ValuationEvaluationSchema.parse(valuation), valuation);

  const reordered = {
    ...valuation,
    scenarios: [
      valuation.scenarios[2],
      valuation.scenarios[0],
      valuation.scenarios[1],
    ],
  };
  assert.deepEqual(ValuationEvaluationSchema.parse(reordered), reordered);
});

test("requires valuation results to contain Bear, Base, and Bull exactly once", () => {
  const scenarios = [
    { name: "bear", valuation: "18000000", calculationIds: ["calc_bear"] },
    { name: "base", valuation: "24000000", calculationIds: ["calc_base"] },
    { name: "bull", valuation: null, calculationIds: [] },
  ];
  const valuation = {
    id: "valuation_1",
    status: "partial",
    scenarios,
    currentAsk: null,
    maximumAcceptablePreMoney: null,
    initialOwnership: null,
    postDilutionOwnership: null,
    grossMoic: null,
    grossIrr: null,
    pricingPremium: null,
    calculationIds: [],
    blockerCodes: [],
  };

  assert.throws(() => ValuationEvaluationSchema.parse({
    ...valuation,
    scenarios: scenarios.slice(1),
  }));
  assert.throws(() => ValuationEvaluationSchema.parse({
    ...valuation,
    scenarios: [scenarios[1], scenarios[1], scenarios[2]],
  }));
});

test("prevents final synthesis claim edges from bypassing saved analysis items", () => {
  assert.deepEqual(DecisionResultSchema.parse(decisionFixture()), decisionFixture());
  assert.throws(() => DecisionResultSchema.parse(decisionFixture({
    claimEdges: [{
      claimItemId: "decision_1",
      dependencyItemId: "revision_1",
      dependencyType: "source_revision",
    }],
  })));
  assert.throws(() => DecisionResultSchema.parse(decisionFixture({
    claimEdges: [{
      claimItemId: "another_decision",
      dependencyItemId: "judgment_1",
      dependencyType: "framework_judgment",
    }],
  })));
});

test("round-trips batch, legacy persistence selection, candidate, checkpoint, and lineage contracts", () => {
  const batch = {
    id: "batch_1",
    workspaceId: "workspace_1",
    scanRunId: "scan_1",
    status: "running",
    batchInputFingerprint: "sha256:batch",
    fundPolicySnapshotId: "policy_1",
    rerunOfId: null,
    createdAt: "2026-07-28T10:00:00.000Z",
  };
  const selection = {
    batchId: "batch_1",
    dealId: "deal_1",
    status: "selected",
    rank: 1,
    reason: "Highest evidence-qualified opportunity.",
  };
  const candidate = {
    id: "candidate_1",
    batchId: "batch_1",
    workspaceId: "workspace_1",
    dealId: "deal_1",
    status: "completed",
    candidateAnalysisFingerprint: "sha256:candidate",
    rerunOfId: null,
    createdAt: "2026-07-28T10:01:00.000Z",
    finalizedAt: "2026-07-28T10:05:00.000Z",
  };
  const checkpoint = {
    candidateRunId: "candidate_1",
    stage: "decision",
    status: "completed",
    inputFingerprint: "sha256:decision-input",
    outputFingerprint: "sha256:decision-output",
    outputPayload: { decisionId: "decision_1" },
    attemptCount: 1,
    costUnits: 0,
    tokenUnits: 0,
    actualTokenUnits: 0,
    providerAttempts: [],
    reasonCode: null,
    publicReason: null,
    savedAt: "2026-07-28T10:04:00.000Z",
  };
  const lineage = {
    memoryIds: ["memory_1"],
    sourceRevisionIds: ["revision_1"],
    sourceIds: ["source_1"],
    fixtureIds: [],
    capturedAt: "2026-07-28T10:05:00.000Z",
  };

  assert.deepEqual(UnderwritingBatchSchema.parse(batch), batch);
  assert.deepEqual(UnderwritingSelectionSchema.parse(selection), selection);
  assert.deepEqual(
    LegacyPinnedUnderwritingSelectionSchema.parse(selection),
    selection,
  );
  assert.deepEqual(CandidateRunSchema.parse(candidate), candidate);
  assert.deepEqual(CandidateCheckpointSchema.parse(checkpoint), checkpoint);
  assert.deepEqual(XTraceLineageSnapshotSchema.parse(lineage), lineage);
  assert.throws(() => UnderwritingSelectionSchema.parse({
    ...selection,
    status: "not_selected",
    rank: 1,
  }));
});

test("current XTrace lineage binds every recalled memory to one exact parent deterministically", () => {
  const current = {
    memoryIds: ["memory_1", "memory_2"],
    sourceRevisionIds: ["revision_1", "revision_2"],
    sourceIds: ["source_1"],
    fixtureIds: ["fixture_2"],
    parentBindings: [{
      kind: "source" as const,
      memoryId: "memory_1",
      sourceRevisionId: "revision_1",
      sourceId: "source_1",
      fixtureId: null,
    }, {
      kind: "fixture" as const,
      memoryId: "memory_2",
      sourceRevisionId: "revision_2",
      sourceId: null,
      fixtureId: "fixture_2",
    }],
    capturedAt: "2026-07-28T10:05:00.000Z",
  };
  assert.deepEqual(XTraceLineageSnapshotSchema.parse(current), current);
  for (const invalid of [{
    ...current,
    parentBindings: [current.parentBindings[1], current.parentBindings[0]],
  }, {
    ...current,
    parentBindings: [current.parentBindings[0], current.parentBindings[0]],
  }, {
    ...current,
    parentBindings: [current.parentBindings[0]],
  }, {
    ...current,
    parentBindings: [{
      ...current.parentBindings[0],
      sourceRevisionId: "revision_foreign",
    }, current.parentBindings[1]],
  }]) {
    assert.throws(() => XTraceLineageSnapshotSchema.parse(invalid));
  }
});

test("new-run underwriting queue entries expose priority and every supported status without selection semantics", () => {
  const statuses = [
    "queued",
    "running",
    "completed",
    "partial",
    "failed",
  ] as const;
  const entries = statuses.map((status, index) => ({
    batchId: "batch_current",
    dealId: `deal_${index + 1}`,
    priorityRank: index + 1,
    status,
    candidateRunId: `candidate_${index + 1}`,
    ...(status === "partial" || status === "failed"
      ? { reason: `${status} reason` }
      : {}),
  }));

  assert.deepEqual(
    entries.map((entry) => UnderwritingQueueEntrySchema.parse(entry)),
    entries,
  );
  for (const forbidden of [
    { ...entries[0], status: "not_selected" },
    { ...entries[0], status: "unavailable" },
    { ...entries[0], rank: 1 },
    { ...entries[0], selectedForTop5: true },
  ]) {
    assert.equal(UnderwritingQueueEntrySchema.safeParse(forbidden).success, false);
  }
  assert.equal(UnderwritingQueueEntrySchema.safeParse({
    ...entries[3],
    reason: undefined,
  }).success, false);
  assert.equal(UnderwritingQueueEntrySchema.safeParse({
    ...entries[4],
    reason: undefined,
  }).success, false);
});

test("round-trips missing evidence and action drafts as strict persisted shapes", () => {
  const missing = {
    fieldId: "gross_margin",
    label: "Gross margin",
    externalLabel: "Latest gross-margin evidence",
    reasonCode: "NOT_REPORTED",
    mostLikelyDecisionImpact: "May cap the decision at Watch.",
  };
  const draft = {
    id: "draft_1",
    workspaceId: "workspace_1",
    candidateRunId: "candidate_1",
    channel: "dd_request",
    audienceType: "founder",
    body: "Please provide the latest gross-margin bridge.",
    createdAt: "2026-07-28T10:00:00.000Z",
    updatedAt: "2026-07-28T10:01:00.000Z",
  };
  assert.deepEqual(MissingEvidenceItemSchema.parse(missing), missing);
  assert.deepEqual(ActionDraftSchema.parse(draft), draft);
  assert.throws(() => ActionDraftSchema.parse({
    ...draft,
    audioUrl: "https://example.com/draft.mp3",
  }));
});

test("persisted action-draft-v2 reads preserve the legacy canonical body byte for byte", () => {
  const legacyLabel = "current customer references";
  const legacy = {
    schemaVersion: "action-draft-v2",
    safety: "status_safe",
    deliveryMode: "draft_only",
    draftPolicyVersion: "status-safe-action-draft-v2",
    actionPolicyVersion: "belief-action-policy-v1",
    id: "draft_legacy_external_label",
    workspaceId: "workspace_1",
    candidateRunId: "candidate_1",
    dealStatus: "passed",
    beliefDirection: "positive",
    actions: [{
      kind: "reopen_diligence",
      scope: "deal",
      priority: "standard",
      visibility: "internal_only",
    }],
    missingEvidence: [{
      fieldId: "customer_evidence",
      label: legacyLabel,
      reasonCode: "MISSING_CRITICAL_EVIDENCE",
      mostLikelyDecisionImpact:
        "Providing accepted evidence may raise or lower the formal decision ceiling.",
    }],
    format: "founder_email",
    channel: "email",
    audienceType: "founder",
    body: [
      "Subject: Draft evidence follow-up",
      "",
      "DRAFT ONLY — NOT SENT",
      "Please share the following current evidence for review:",
      `- ${legacyLabel}`,
      "This draft is limited to evidence collection and neutral sharing instructions.",
    ].join("\n"),
    createdAt: "2026-07-28T10:00:00.000Z",
    updatedAt: "2026-07-28T10:01:00.000Z",
  };

  assert.equal(
    ActionDraftSchema.safeParse(legacy).success,
    false,
    "new canonical writes must not omit externalLabel",
  );
  const parsed = parseActionDraftRead(legacy);
  assert.ok("schemaVersion" in parsed);
  const missingEvidence = parsed.missingEvidence as Array<{
    label: string;
    externalLabel: string;
  }>;
  assert.equal(missingEvidence[0]?.label, legacyLabel);
  assert.equal(missingEvidence[0]?.externalLabel, legacyLabel);
  assert.equal(parsed.body, legacy.body);
  assert.equal(ActionDraftSchema.safeParse(parsed).success, true);
  assert.throws(() => parseActionDraftRead({
    ...legacy,
    body: `${legacy.body}\nNon-canonical historical posture.`,
  }));
});
