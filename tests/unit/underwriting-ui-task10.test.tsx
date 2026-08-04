import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  type UnderwritingAnalysisContext,
  UnderwritingDetailPanel,
} from "../../app/underwriting-detail";
import { UnderwritingSummaryPanel } from "../../app/underwriting-summary";
import type { ReportEvidenceContext } from "../../lib/contracts/evidence-context";
import type { SourceRefV2 } from "../../lib/contracts/source-evidence";
import type { ScenarioInputField, ScenarioModel } from "../../lib/contracts/underwriting";
import type {
  CandidateUnderwritingDetail,
  PublicActionDraft,
} from "../../lib/underwriting/read-model";

const SCENARIO_FIELDS: readonly ScenarioInputField[] = [
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
];

const ACTIONS = [{
  kind: "pause_follow_on" as const,
  scope: "portfolio" as const,
  priority: "high" as const,
  visibility: "internal_only" as const,
}, {
  kind: "portfolio_risk_review" as const,
  scope: "portfolio" as const,
  priority: "high" as const,
  visibility: "internal_only" as const,
}];

type CanonicalSourceRefV2 = Extract<
  SourceRefV2,
  { adaptation: "canonical" }
>;

function canonicalPublicSource(): CanonicalSourceRefV2 {
  return {
    schemaVersion: "source-ref-v2",
    adaptation: "canonical",
    id: "source_public_event",
    provenance: "public_web",
    title: "Canonical public evidence",
    canonicalUrl: "https://public.example.test/canonical-event",
    documentId: "document_public_must_not_win",
    publisher: "Public Example",
    providerId: "public-example-feed",
    eventAt: "2026-07-29",
    eventAtPrecision: "date",
    publishedAt: "2026-07-29T12:00:00.000Z",
    publishedAtPrecision: "timestamp",
    retrievedAt: "2026-08-01T12:00:00.000Z",
    retrievedAtPrecision: "timestamp",
    updatedAt: null,
    updatedAtPrecision: null,
    entityKeys: ["company:source-link-test"],
    sourceClass: "industry_publication",
    sourceAuthority: "secondary",
    evidenceRole: "trigger",
    sourceRevisionId: "revision_public_exact",
    locator: { kind: "web_text", selector: "main" },
    contentFingerprint: `sha256:${"b".repeat(64)}`,
    text: {
      status: "verified_exact",
      verbatimExcerpt: "A canonical public event changed the market.",
      normalizedStatement: "The public event materially changed the market.",
    },
  };
}

function canonicalDocumentSource(): CanonicalSourceRefV2 {
  return {
    ...canonicalPublicSource(),
    id: "source_document_event",
    provenance: "source_document",
    title: "Canonical source document",
    canonicalUrl: "https://document.example.test/must-not-render",
    documentId: "document_source_must_not_win",
    publisher: "Internal source registry",
    providerId: "document-ingest",
    evidenceRole: "corroborating",
    sourceRevisionId: "revision_document_exact",
    locator: { kind: "document_page", page: 7 },
    contentFingerprint: `sha256:${"c".repeat(64)}`,
  };
}

function sampleResearchScreeningSource(): CanonicalSourceRefV2 {
  return {
    ...canonicalPublicSource(),
    id: "research_screening_underwriting_v1",
    provenance: "source_document",
    title: "Sample research screening record",
    canonicalUrl: null,
    documentId: "document_research_screening_underwriting",
    publisher: "Internal Research Registry",
    providerId: "belief-reversal-research-seed-v1",
    eventAt: "2026-04-01T12:00:00.000Z",
    eventAtPrecision: "timestamp",
    publishedAt: null,
    publishedAtPrecision: null,
    updatedAt: null,
    updatedAtPrecision: null,
    sourceClass: "internal_decision_record",
    sourceAuthority: "primary",
    evidenceRole: "context",
    sourceRevisionId: "revision_research_screening_underwriting",
    locator: { kind: "json_pointer", pointer: "/record" },
    text: {
      status: "normalized_only",
      normalizedStatement:
        "Sample research screening record. Synthetic research-only context; no meeting or VC interaction occurred. Reconsideration conditions: Independent customer adoption is confirmed.",
    },
  };
}

const PINNED_CONTEXT: ReportEvidenceContext = {
  state: "current",
  schemaVersion: "run-evidence-context-v1",
  evidenceMode: "pinned",
  windowDays: 14,
  anchorAt: "2026-08-01T23:59:59.000-07:00",
  windowStartAt: "2026-07-19T00:00:00.000-07:00",
  windowEndAt: "2026-08-01T23:59:59.000-07:00",
  windowTimezone: "America/Los_Angeles",
  snapshotId: "belief_reversal_2026_08_01",
  snapshotFingerprint: `sha256:${"1".repeat(64)}`,
  contextFingerprint: `sha256:${"2".repeat(64)}`,
  displayLabel: "Demo evidence snapshot as of 2026-08-01",
  eventCount: 4,
  eventSetFingerprint: `sha256:${"3".repeat(64)}`,
  bindingFingerprint: `sha256:${"4".repeat(64)}`,
};

function scenarioModel(): ScenarioModel {
  return {
    id: "scenario_model_1",
    candidateRunId: "candidate_1",
    formulaPolicyVersion: "formula-policy-v9",
    probabilityWeighted: true,
    scenarios: (["bear", "base", "bull"] as const).map((scenario) => ({
      name: scenario,
      inputs: SCENARIO_FIELDS.map((field, index) => ({
        id: `scenario-input-${scenario}-${field}`,
        scenario,
        field,
        value: field === "revenue_path"
          ? "12000000"
          : field === "growth"
          ? "0.35"
          : null,
        unit: field === "revenue_path"
          ? "USD"
          : field === "growth"
          ? "decimal"
          : null,
        evidenceItemId: field === "revenue_path" ? "fact_ask" : null,
        assumptionItemId: field === "growth" ? "assumption_growth" : null,
        unavailableReason: index > 2
          ? `${field} unavailable in ${scenario}`
          : field === "arr_path"
          ? `arr_path unavailable in ${scenario}`
          : null,
      })),
    })),
  };
}

function detailFixture(): CandidateUnderwritingDetail {
  const premiumCalculationId =
    "calculation:candidate_1:market_comps_v1:pricing_premium";
  return {
    candidateRunId: "candidate_1",
    dealId: "deal_invested_negative",
    evidencePack: {
      asOfDate: "2026-08-01",
      sourceRevisionIds: ["revision_ask", "revision_left", "revision_right"],
      facts: [{
        id: "fact_ask",
        field: "reported_valuation",
        value: "20000000",
        unit: "USD",
        currency: "USD",
        publishedAt: null,
        eventAt: null,
        retrievedAt: "2026-08-01T12:00:00.000Z",
        sourceRevisionId: "revision_ask",
        provenanceOrigin: "public_source",
        sourceRole: "independent_third_party",
        assertionStatus: "corroborated",
        freshness: "current",
        acceptedForGate: true,
      }, {
        id: "fact_left",
        field: "arr",
        value: "5000000",
        unit: "USD",
        currency: "USD",
        publishedAt: null,
        eventAt: null,
        retrievedAt: "2026-08-01T12:00:00.000Z",
        sourceRevisionId: "revision_left",
        provenanceOrigin: "public_source",
        sourceRole: "independent_third_party",
        assertionStatus: "reported",
        freshness: "current",
        acceptedForGate: false,
      }, {
        id: "fact_right",
        field: "arr",
        value: "7000000",
        unit: "USD",
        currency: "USD",
        publishedAt: null,
        eventAt: null,
        retrievedAt: "2026-08-01T12:00:00.000Z",
        sourceRevisionId: "revision_right",
        provenanceOrigin: "public_source",
        sourceRole: "independent_third_party",
        assertionStatus: "disputed",
        freshness: "current",
        acceptedForGate: false,
      }],
      assumptions: [{
        id: "assumption_growth",
        field: "growth",
        value: "0.35",
        unit: "decimal",
        scenario: "all",
        rationale: "Policy scenario assumption.",
        inputRefIds: [],
        provenanceOrigin: "recommended_policy",
        sensitivity: "high",
        requiresConfirmation: true,
      }],
      conflicts: [{
        id: "conflict_arr",
        field: "arr",
        leftFactId: "fact_left",
        rightFactId: "fact_right",
        materialityRuleId: "materiality-rule-1",
        material: true,
        status: "open",
        resolutionFactId: null,
        resolutionReason: null,
      }],
      coverage: {
        minimumModelInputsComplete: false,
        criticalEvidenceComplete: false,
        missingFieldIds: ["net_retention"],
        blockingConflictIds: ["conflict_arr"],
        decisionCeiling: "Advance",
        underwritingStatus: "unavailable",
        reasonCodes: ["CORE_ONLY_ANALYSIS_CEILING"],
      },
    },
    context: {
      contextVersion: "context-v1",
      stage: "series_a",
      businessModel: "enterprise_ai",
      geography: "global",
      securityType: "preferred",
      asOfDate: "2026-08-01",
      benchmarkCompatibility: "broad_compatible",
    },
    scenarioModel: scenarioModel(),
    calculations: [{
      id: premiumCalculationId,
      formulaId: "market_comps_v1",
      formulaVersion: "1",
      inputRefs: [],
      output: "0.25",
      unit: "decimal",
      currency: null,
      status: "completed",
    }],
    judgments: [],
    disagreements: [],
    valuation: {
      status: "partial",
      scenarios: [{ name: "bear", valuation: null, calculationIds: [] }, {
        name: "base",
        valuation: "24000000",
        calculationIds: [],
      }, { name: "bull", valuation: null, calculationIds: [] }],
      currentAsk: "20000000",
      maximumAcceptablePreMoney: null,
      initialOwnership: null,
      postDilutionOwnership: null,
      grossMoic: null,
      grossIrr: null,
      pricingPremium: "0.25",
      calculationIds: [premiumCalculationId],
      blockerCodes: ["OPEN_MATERIAL_CONFLICT"],
    },
    decision: {
      id: "decision_1",
      companyQuality: "mixed",
      priceAttractiveness: "unavailable",
      fundFit: "mixed",
      decision: "Advance",
      decisionCeiling: "Advance",
      hardVeto: false,
      firedRules: [],
      blockingEvidenceItemIds: ["conflict_arr"],
      confidence: "low",
    },
    narrative: "Formal underwriting remains limited by evidence gaps.",
    claimEdges: [{
      claimItemId: premiumCalculationId,
      dependencyItemId: "fact_ask",
      dependencyType: "fact",
    }],
    sourceRevisionIds: ["revision_ask", "revision_left", "revision_right"],
    versionSnapshot: {
      fundPolicyId: "fund-policy-v1",
      benchmarkPackId: null,
      benchmarkEntryId: null,
      benchmarkDefinitionFingerprint: null,
      frameworkPackId: "framework-pack-v1",
      frameworkPackDefinitionFingerprint: `sha256:${"5".repeat(64)}`,
      routerVersion: "router-v2",
      criticalEvidenceProfileId: "critical-v1",
      criticalEvidenceProfileDefinitionFingerprint: `sha256:${"6".repeat(64)}`,
      valuationMethodPolicyId: "valuation-v1",
      valuationMethodPolicyDefinitionFingerprint: `sha256:${"7".repeat(64)}`,
      decisionPolicyId: "decision-v1",
      decisionPolicyDefinitionFingerprint: `sha256:${"8".repeat(64)}`,
      referenceCatalogFingerprint: `sha256:${"9".repeat(64)}`,
      formulaVersions: ["market_comps_v1@1"],
      providerModel: "deterministic",
      promptVersion: "prompt-v1",
      schemaVersion: "schema-v1",
      settingsFingerprint: `sha256:${"a".repeat(64)}`,
      applicationCommit: "task10-test",
    },
  };
}

function analysisFixture(): UnderwritingAnalysisContext & {
  beliefAssessment: {
    direction: "negative";
    actions: typeof ACTIONS;
  };
} {
  return {
    companyName: "Invested Risk Co",
    dealStatus: "invested",
    confidence: "high",
    marketEvidence: {
      relationship: "contradicts",
      explanation: "New evidence weakens the prior portfolio thesis.",
      events: [],
    },
    implications: { positive: [], negative: ["Containment risk increased."] },
    investmentMemory: {
      previousMeetingSummary: "The sample team expected containment.",
      decisionReason: "The sample portfolio thesis depended on containment.",
      fixtureIds: ["fixture_invested_negative_sample"],
    },
    sources: [],
    beliefAssessment: {
      direction: "negative",
      actions: ACTIONS,
    },
  };
}

function draftFixture(): PublicActionDraft {
  return {
    id: "draft_1",
    candidateRunId: "candidate_1",
    schemaVersion: "action-draft-v2",
    safety: "status_safe",
    deliveryMode: "draft_only",
    draftPolicyVersion: "status-safe-action-draft-v2",
    actionPolicyVersion: "belief-action-policy-v1",
    dealStatus: "invested",
    beliefDirection: "negative",
    actions: ACTIONS.map((action) => ({ ...action })),
    missingEvidence: [{
      fieldId: "arr",
      label: "Latest ARR",
      externalLabel: "Latest ARR",
      reasonCode: "MISSING_ARR",
      mostLikelyDecisionImpact: "Could lower the current decision ceiling.",
    }],
    format: "internal_memo",
    channel: "internal",
    audienceType: "internal",
    body: "INTERNAL UNDERWRITING ACTION MEMO — DRAFT ONLY\nPause follow-on pending risk review.",
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z",
  };
}

test("new-run summary presents all queue statuses and a sixth priority without selection semantics", () => {
  const statuses = [
    "queued",
    "running",
    "completed",
    "partial",
    "failed",
    "completed",
  ] as const;
  const html = renderToStaticMarkup(<UnderwritingSummaryPanel
    batch={{
      batchId: "batch_current",
      status: "partial",
      queue: statuses.map((status, index) => ({
        batchId: "batch_current",
        dealId: `deal_${index + 1}`,
        priorityRank: index + 1,
        status,
        candidateRunId: `candidate_${index + 1}`,
        ...(status === "partial" || status === "failed"
          ? { reason: `${status} persisted reason` }
          : {}),
        decision: status === "completed" ? "Advance" as const : null,
      })),
      underwritingStatusCounts: {
        queued: 1,
        running: 1,
        completed: 2,
        partial: 1,
        failed: 1,
      },
    }}
    companyNames={Object.fromEntries(
      statuses.map((_, index) => [`deal_${index + 1}`, `Company ${index + 1}`]),
    )}
    onOpenCandidate={() => {}}
  />);

  for (const copy of [
    "Belief Revisions",
    "Changed Beliefs",
    "Underwriting Queue",
    "Priority Order",
    "Underwriting Status",
    "Deep Underwriting",
    "Investor Framework Perspectives",
    "Company 6",
  ]) {
    assert.match(html, new RegExp(copy));
  }
  assert.doesNotMatch(
    html,
    /Top[ -]?5|Selected for Top|rank cutoff|not selected|sixth.*reject/i,
  );
});

test("keeps the exact 3 by 17 scenario matrix in audit while the main memo consolidates missing inputs", () => {
  const props = {
    companyName: "Invested Risk Co",
    analysis: analysisFixture(),
    detail: detailFixture(),
    drafts: [draftFixture()],
    canSaveDrafts: true,
    onEditDraft() {},
    evidenceContext: PINNED_CONTEXT,
  };
  const html = renderToStaticMarkup(<UnderwritingDetailPanel {...props} />);
  const auditIndex = html.indexOf("Audit Appendix");
  const mainMemo = html.slice(0, auditIndex);
  const auditAppendix = html.slice(auditIndex);

  assert.equal(mainMemo.match(/data-scenario-input=/g)?.length ?? 0, 0);
  assert.equal(auditAppendix.match(/data-scenario-input=/g)?.length, 51);
  assert.match(mainMemo, /Current modeling status/);
  assert.match(mainMemo, /45 of 51 required scenario inputs/);
  assert.match(mainMemo, /Required Before Valuation/);
  assert.match(mainMemo, /Required Evidence/);
  assert.match(mainMemo, /Decision Use/);
  assert.match(auditAppendix, /Complete scenario input matrix/);
  assert.match(html, /Formula policy · formula-policy-v9/);
  assert.match(html, /Probability weighted · Yes/);
  assert.match(html, /Fact · fact_ask/);
  assert.match(html, /Assumption · assumption_growth/);
  assert.match(html, /future financing unavailable in bear/i);

  assert.match(html, /Evidence coverage/);
  assert.match(html, /Minimum model inputs complete/);
  assert.match(html, /Critical evidence complete/);
  assert.match(html, /net_retention/);
  assert.match(html, /conflict_arr/);
  assert.match(html, /CORE_ONLY_ANALYSIS_CEILING/);
  assert.match(html, /Underwriting Status/);

  assert.match(html, /Evidence conflicts/);
  assert.match(html, /fact_left/);
  assert.match(html, /fact_right/);
  assert.match(html, /materiality-rule-1/);
  assert.match(html, /Open · Material/);
  assert.match(html, /Resolution unavailable — conflict remains open/);

  assert.match(
    html,
    /Pricing premium[\s\S]*calculation:candidate_1:market_comps_v1:pricing_premium/,
  );

  assert.match(html, /PINNED DEMO REPLAY/);
  assert.match(html, /Demo evidence snapshot as of 2026-08-01/);
  assert.match(html, /Historical evidence snapshot—not current news/);

  assert.match(html, /FORMAL UNDERWRITING DECISION/);
  assert.match(html, /STATUS-AWARE PORTFOLIO ACTION/);
  assert.match(html, /Negative belief change/);
  assert.match(html, /Pause follow on/);
  assert.match(html, /Portfolio risk review/);
  assert.match(html, /Sample decision record/);
  assert.match(html, /fixture_invested_negative_sample/);

  assert.match(html, /DRAFT ONLY — NOT SENT OR PUBLISHED/);
  assert.match(html, /Status safe/);
  assert.match(html, /Invested · Negative/);
  assert.match(html, /Internal memo · Internal · Internal/);
  assert.match(html, /Latest ARR/);
  assert.match(html, /Could lower the current decision ceiling/);
  assert.match(html, /Executive Conclusion/);
  assert.match(html, /VSee IC Synthesis/);
  assert.match(html, /Decision ceiling · Advance/);
  assert.match(html, /Critical missing evidence · net_retention/);
});

test("Deep Underwriting renders the approved complete IC article reading order", () => {
  const html = renderToStaticMarkup(<UnderwritingDetailPanel
    companyName="Invested Risk Co"
    analysis={analysisFixture()}
    detail={detailFixture()}
    drafts={[draftFixture()]}
    canSaveDrafts={true}
    onEditDraft={() => {}}
    evidenceContext={PINNED_CONTEXT}
  />);

  const headings = [
    "Executive Conclusion",
    "What Changed?",
    "Verified Company Snapshot",
    "Investment Thesis Assessment",
    "Investor Framework Synthesis",
    "Investment Committee Debate",
    "Financial Case",
    "Valuation and Return Analysis",
    "VSee IC Synthesis",
    "Required Diligence",
    "Status-aware Action Drafts",
    "Evidence Classification",
    "Audit Appendix",
    "Final IC Position",
  ];
  let previousIndex = -1;
  for (const heading of headings) {
    const index = html.indexOf(heading);
    assert.ok(index > previousIndex, `${heading} must appear in the approved order`);
    previousIndex = index;
  }
  assert.match(html, /Bull Case/);
  assert.match(html, /Bear Case/);
  assert.match(html, /True Disagreement/);
  assert.match(html, /Facts/);
  assert.match(html, /Assumptions/);
  assert.match(html, /Unknowns/);
  assert.match(html, /Conflicts/);
  assert.match(html, /Reported Valuation — 20000000 USD · corroborated/);
  assert.match(html, /Arr — 5000000 USD · reported/);
  assert.match(html, /Portfolio Risk Re-underwriting Memorandum/);
});

test("Investor Framework Synthesis renders an editorial table instead of issue cards", () => {
  const detail = detailFixture();
  detail.judgments = [{
    id: "judgment_marks",
    frameworkCardId: "howard_marks_most_important_thing",
    frameworkVersion: "1.0.0",
    applicability: "applicable",
    conclusion: "negative",
    strongestSupport: "Operational exposure is material to the portfolio thesis.",
    strongestCounterargument: "The incident may be remediable.",
    supportEvidenceItemIds: ["fact_ask"],
    counterEvidenceItemIds: [],
    unusedEvidenceItemIds: [],
    unknowns: ["Independent remediation evidence"],
    limitations: ["Public evidence only"],
    confidence: {
      sourceReliability: "high",
      evidenceStrength: "medium",
      evidenceCoverage: "medium",
      applicability: "high",
      judgment: "medium",
    },
    claimEdges: [],
    frameworkMetadata: {
      packId: "howard_marks_most_important_thing_public_frameworks_v0_1",
      packName: "Howard Marks / The Most Important Thing Public Frameworks — Research Draft",
      packVersion: "0.1.0",
      sourceCatalogId: "howard_marks_sources",
      researchCutoff: "2026-07-28",
      componentCardIds: [],
      components: [],
      sources: [],
      formalDecisionWeight: "0",
    },
    fingerprint: "sha256:judgment",
  } as CandidateUnderwritingDetail["judgments"][number]];
  detail.disagreements = [{
    id: "disagreement_1",
    leftJudgmentId: "judgment_marks",
    rightJudgmentId: "judgment_other",
    topic: "company_quality_vs_price",
    explanation: "Risk urgency conflicts with incomplete remediation evidence.",
    evidenceItemIds: ["fact_ask"],
  }];

  const html = renderToStaticMarkup(<UnderwritingDetailPanel
    companyName="Invested Risk Co"
    analysis={analysisFixture()}
    detail={detail}
    drafts={[]}
    canSaveDrafts={false}
    onEditDraft={() => {}}
  />);

  assert.match(html, /Panel Conclusion/);
  assert.match(html, /Areas of Agreement/);
  assert.match(html, /Principal Disagreement/);
  assert.match(html, /Strongest Counterargument/);
  assert.match(html, /IC Implication/);
  assert.match(html, /IC Question/);
  assert.match(html, /Representative Framework Lenses/);
  assert.match(html, /Synthesized View/);
  assert.match(html, /data-label="IC Question"/);
  assert.match(html, /data-label="Representative Framework Lenses"/);
  assert.match(html, /data-label="Synthesized View"/);
  assert.match(html, /Operational exposure is material to the portfolio thesis/);
  assert.doesNotMatch(html, /vsee-analyst-issue-grid/);
});

test("Deep Underwriting keeps pairwise framework noise out of the main IC reading flow", () => {
  const detail = detailFixture();
  detail.disagreements = Array.from({ length: 5 }, (_, index) => ({
    id: `disagreement_${index + 1}`,
    leftJudgmentId: `judgment_left_${index + 1}`,
    rightJudgmentId: `judgment_right_${index + 1}`,
    topic: "independent_framework_conflict" as const,
    explanation: `Persisted disagreement ${index + 1}`,
    evidenceItemIds: ["fact_ask"],
  }));

  const html = renderToStaticMarkup(<UnderwritingDetailPanel
    companyName="Invested Risk Co"
    analysis={analysisFixture()}
    detail={detail}
    drafts={[draftFixture()]}
    canSaveDrafts={true}
    onEditDraft={() => {}}
    evidenceContext={PINNED_CONTEXT}
  />);

  assert.match(html, /Priority disagreements · 3 of 5/);
  assert.match(html, /Persisted disagreement 1/);
  assert.match(html, /Persisted disagreement 3/);
  assert.doesNotMatch(html, /Persisted disagreement 4/);
  assert.match(html, /not repeated in the main IC reading flow/);
});

test("Deep Underwriting permanently labels an exact synthetic research screening authority without impersonating a meeting", () => {
  const analysis = analysisFixture();
  analysis.dealStatus = "screening";
  analysis.investmentMemory = {
    previousMeetingSummary: "No recorded meeting.",
    decisionReason: "No recorded decision.",
    fixtureIds: [],
  };
  analysis.sources = [sampleResearchScreeningSource()];
  const html = renderToStaticMarkup(<UnderwritingDetailPanel
    companyName="Screening Co"
    analysis={analysis}
    detail={detailFixture()}
    drafts={[]}
    canSaveDrafts={false}
    onEditDraft={() => {}}
  />);

  assert.match(
    html,
    /Sample research screening record · synthetic, no meeting or VC interaction/,
  );
  assert.doesNotMatch(html, /Sample decision record · synthetic demo history/);
});

test("renders canonical public and document source links without forging revision identity", () => {
  const analysis = analysisFixture();
  analysis.investmentMemory.fixtureIds = [];
  analysis.investmentMemory.previousMeetingSummary =
    "The sourced product record documents prior diligence.";
  analysis.investmentMemory.decisionReason =
    "The sourced product decision remains under review.";
  analysis.marketEvidence.events = [{
    id: "event_source_link_test",
    title: "Canonical source-link event",
    eventType: "funding",
    publishedAt: "2026-07-29T12:00:00.000Z",
    sourceIds: ["source_public_event", "source_document_event"],
  }] as UnderwritingAnalysisContext["marketEvidence"]["events"];
  analysis.sources = [canonicalPublicSource(), canonicalDocumentSource()];

  const html = renderToStaticMarkup(
    <UnderwritingDetailPanel
      companyName="Source Link Co"
      analysis={analysis}
      detail={detailFixture()}
      drafts={[]}
      canSaveDrafts={false}
      onEditDraft={() => {}}
    />,
  );

  assert.match(html, /href="https:\/\/public\.example\.test\/canonical-event"/);
  assert.match(html, /api\/source-revisions\/revision_public_exact\/access/);
  assert.match(
    html,
    /api\/source-revisions\/revision_document_exact\/access#page=7/,
  );
  assert.doesNotMatch(html, /api\/documents\/document_public_must_not_win/);
  assert.doesNotMatch(html, /api\/documents\/document_source_must_not_win/);
  assert.doesNotMatch(html, /document\.example\.test\/must-not-render/);
  for (const nonRevisionId of [
    "document_public_must_not_win",
    "document_source_must_not_win",
    "source_public_event",
    "source_document_event",
    "event_source_link_test",
  ]) {
    assert.doesNotMatch(
      html,
      new RegExp(`api/source-revisions/${nonRevisionId}/access`),
    );
  }
  assert.doesNotMatch(html, /Sample decision record/);
});

test("renders an explicit unavailable state for every empty artifact area and legacy evidence context", () => {
  const detail = detailFixture();
  detail.evidencePack.facts = [];
  detail.evidencePack.assumptions = [];
  detail.evidencePack.conflicts = [];
  detail.scenarioModel.scenarios = [];
  detail.calculations = [];
  detail.judgments = [];
  detail.disagreements = [];
  detail.valuation.scenarios = [];
  detail.valuation.pricingPremium = null;
  detail.valuation.calculationIds = [];
  detail.sourceRevisionIds = [];

  const props = {
    companyName: "Empty Co",
    analysis: null,
    detail,
    drafts: [],
    canSaveDrafts: false,
    onEditDraft() {},
    evidenceContext: { state: "legacy_unbound" as const },
  };
  const html = renderToStaticMarkup(<UnderwritingDetailPanel {...props} />);

  for (const copy of [
    "Evidence context unavailable",
    "No persisted Evidence Pack Facts are available",
    "No changed assumptions were persisted",
    "No persisted framework judgments are available",
    "No framework disagreements were persisted",
    "No persisted calculations are available",
    "No Bear/Base/Bull scenario model was persisted",
    "No persisted Evidence Pack conflicts are available",
    "No Source Revision lineage was persisted",
    "No action draft was finalized",
  ]) {
    assert.match(html, new RegExp(copy.replaceAll("/", "\\/"), "i"));
  }
});

test("Ask lineage fails closed for an unaccepted, mismatched, or ambiguous reported valuation Fact", () => {
  const renderAskCard = (detail: CandidateUnderwritingDetail): string => {
    const html = renderToStaticMarkup(<UnderwritingDetailPanel
      companyName="Ask Lineage Co"
      analysis={null}
      detail={detail}
      drafts={[]}
      canSaveDrafts={false}
      onEditDraft={() => {}}
      evidenceContext={PINNED_CONTEXT}
    />);
    const start = html.indexOf("<span>Ask</span>");
    const end = html.indexOf("<span>Maximum acceptable pre-money</span>", start);
    assert.ok(start >= 0 && end > start);
    return html.slice(start, end);
  };

  const unaccepted = detailFixture();
  unaccepted.evidencePack.facts[0]!.acceptedForGate = false;
  assert.match(renderAskCard(unaccepted), /Unsupported/);
  assert.doesNotMatch(renderAskCard(unaccepted), /fact_ask/);

  const mismatched = detailFixture();
  mismatched.evidencePack.facts[0]!.value = "19000000";
  assert.match(renderAskCard(mismatched), /Unsupported/);
  assert.doesNotMatch(renderAskCard(mismatched), /fact_ask/);

  const ambiguous = detailFixture();
  ambiguous.evidencePack.facts.push({
    ...ambiguous.evidencePack.facts[0]!,
    id: "fact_ask_duplicate",
    sourceRevisionId: "revision_ask_duplicate",
  });
  assert.match(renderAskCard(ambiguous), /Unsupported/);
  assert.doesNotMatch(renderAskCard(ambiguous), /fact_ask(?:_duplicate)?/);
});
