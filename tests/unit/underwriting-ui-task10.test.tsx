import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  type UnderwritingAnalysisContext,
  UnderwritingDetailPanel,
} from "../../app/underwriting-detail";
import { isCurrentUnderwritingDetail } from "../../app/underwriting-passage-detail";
import { UnderwritingSummaryPanel } from "../../app/underwriting-summary";
import type { ReportEvidenceContext } from "../../lib/contracts/evidence-context";
import type { SourceRefV2 } from "../../lib/contracts/source-evidence";
import type { ScenarioInputField, ScenarioModel } from "../../lib/contracts/underwriting";
import { actionsForDealStatusAndDirection } from "../../lib/reports/action-policy";
import type {
  CandidateUnderwritingDetail,
  PublicActionDraft,
} from "../../lib/underwriting/read-model";
import { toVersionedCandidateUnderwritingDetail } from
  "../../lib/underwriting/read-model";
import { createCurrentNamedLensFinalizationFixture } from
  "../helpers/current-named-lens-finalization";

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
        sourceAction: {
          kind: "original_public_source",
          url: "https://public.example.test/reported-valuation",
        },
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
        sourceAction: {
          kind: "original_public_source",
          url: "https://public.example.test/arr-left",
        },
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
        sourceAction: {
          kind: "original_public_source",
          url: "https://public.example.test/arr-right",
        },
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
      }, {
        id: "assumption_price_bear",
        field: "scenario_price_multiplier",
        value: "0.75",
        unit: "decimal",
        scenario: "bear",
        rationale: "Bear scenario multiplier from the pinned Fund Policy.",
        inputRefIds: ["fund_policy:workspace_demo:v1"],
        provenanceOrigin: "recommended_policy",
        sensitivity: "high",
        requiresConfirmation: false,
      }, {
        id: "assumption_price_base",
        field: "scenario_price_multiplier",
        value: "1",
        unit: "decimal",
        scenario: "base",
        rationale: "Base scenario multiplier from the pinned Fund Policy.",
        inputRefIds: ["fund_policy:workspace_demo:v1"],
        provenanceOrigin: "recommended_policy",
        sensitivity: "high",
        requiresConfirmation: false,
      }, {
        id: "assumption_price_bull",
        field: "scenario_price_multiplier",
        value: "1.25",
        unit: "decimal",
        scenario: "bull",
        rationale: "Bull scenario multiplier from the pinned Fund Policy.",
        inputRefIds: ["fund_policy:workspace_demo:v1"],
        provenanceOrigin: "recommended_policy",
        sensitivity: "high",
        requiresConfirmation: false,
      }, {
        id: "assumption_security_type",
        field: "security_type",
        value: "preferred",
        unit: null,
        scenario: "all",
        rationale: "Placeholder security type pending transaction documents.",
        inputRefIds: ["company:deal_invested_negative:terms"],
        provenanceOrigin: "recommended_policy",
        sensitivity: "medium",
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

function currentDetailFixture(input: {
  claimEdges?: CandidateUnderwritingDetail["claimEdges"];
  providerModel?: string;
} = {}): CandidateUnderwritingDetail {
  const finalization = createCurrentNamedLensFinalizationFixture().finalization;
  finalization.versionSnapshot.providerModel = input.providerModel
    ?? finalization.versionSnapshot.providerModel;
  return toVersionedCandidateUnderwritingDetail({
    bundle: {
      ...finalization,
      sourceCandidateRunId: finalization.candidateRunId,
      workspaceId: finalization.evidencePack.workspaceId,
      dealId: finalization.evidencePack.dealId,
      claimEdges: input.claimEdges ?? [],
    },
    adapter: {
      kind: "current",
      schemaVersion: "decision-first-named-lens-v1",
    },
  });
}

test("current decision-first memo renders persisted prose before audit with one advisory disclosure", () => {
  const html = renderToStaticMarkup(<UnderwritingDetailPanel
    companyName="Current Lens Co"
    analysis={analysisFixture()}
    detail={currentDetailFixture()}
    drafts={[]}
    canSaveDrafts={false}
    onEditDraft={() => {}}
  />);

  for (const heading of [
    "Decision Request",
    "What Changed",
    "Company Position",
    "Thesis Assessment",
    "Financial and Valuation Status",
    "Named Lens Readings",
    "Recommendation and Next Steps",
  ]) assert.match(html, new RegExp(heading));
  assert.match(html, /Appendix/);
  assert.match(html, /The public framework tests durable customer demand\./);
  assert.match(html, /Saved company evidence applies the framework\./);
  assert.match(html, /Saved counterevidence limits the conclusion\./);
  assert.match(html, /A saved unknown defines the diligence boundary\./);
  assert.match(html, /The view remains conditional on resolving the saved unknown\./);
  assert.equal((html.match(/formal decision weight zero/g) ?? []).length, 1);
  assert.match(html, /<details[^>]*><summary>Audit Appendix/);
  assert.doesNotMatch(html, /vsee-framework-synthesis-table/);
  assert.doesNotMatch(html, /AnalystPanelSynthesis/);
  assert.doesNotMatch(html, /<button[^>]*>\s*(?:SEND|PUBLISH)/i);
});

test("current memo preserves the authoritative sample-research label and raw lineage in its audit", () => {
  const html = renderToStaticMarkup(<UnderwritingDetailPanel
    companyName="Current Lens Co"
    analysis={{
      ...analysisFixture(),
      sources: [sampleResearchScreeningSource()],
    }}
    detail={currentDetailFixture({
      providerModel: "reviewed-provider-v1",
      claimEdges: [{
        claimItemId: "xtrace:claim_current",
        dependencyItemId: "fact_1",
        dependencyType: "fact",
      }],
    })}
    drafts={[]}
    canSaveDrafts={false}
    onEditDraft={() => {}}
  />);

  assert.match(html,
    /Sample research screening record · synthetic, no meeting or VC interaction/);
  const appendix = html.slice(html.indexOf("Audit Appendix"));
  assert.match(appendix, /xtrace:claim_current/);
  assert.match(appendix, /fact_1/);
});

test("current first screen uses its saved projection references across facts and assumptions", () => {
  const detail = currentDetailFixture();
  if (!isCurrentUnderwritingDetail(detail)) throw new Error("Expected current detail.");
  detail.evidencePack.assumptions.push({
    id: "assumption_decisive_growth",
    field: "growth",
    value: "0.35",
    unit: "decimal",
    scenario: "all",
    rationale: "Persisted decisive assumption.",
    inputRefIds: [],
    provenanceOrigin: "recommended_policy",
    sensitivity: "high",
    requiresConfirmation: false,
  });
  detail.namedLensPresentation.firstScreenProjectionRefs.decisionEvidenceItemIds = [
    "assumption_decisive_growth",
    "fact_1",
  ];
  const html = renderToStaticMarkup(<UnderwritingDetailPanel
    companyName="Current Lens Co"
    analysis={analysisFixture()}
    detail={detail}
    drafts={[]}
    canSaveDrafts={false}
    onEditDraft={() => {}}
  />);
  const firstScreen = html.slice(0, html.indexOf("What Changed"));

  assert.match(firstScreen, /Growth: 0\.35 decimal\./);
  assert.match(firstScreen, /Customer Demand: supported\./);
});

test("current Named Lens body fails closed when one saved segment is invalid", () => {
  const detail = currentDetailFixture();
  if (!isCurrentUnderwritingDetail(detail)) throw new Error("Expected current detail.");
  detail.namedLensPresentation.selectedPassages[0]!.passage.countercase.text = "\u0000invalid";
  const html = renderToStaticMarkup(<UnderwritingDetailPanel
    companyName="Current Lens Co"
    analysis={analysisFixture()}
    detail={detail}
    drafts={[]}
    canSaveDrafts={false}
    onEditDraft={() => {}}
  />);

  assert.doesNotMatch(html, /The public framework tests durable customer demand\./);
  assert.doesNotMatch(html, /class="underwriting-passage"/);
});

test("current Appendix retains complete persisted audit identities", () => {
  const detail = currentDetailFixture();
  if (!isCurrentUnderwritingDetail(detail)) throw new Error("Expected current detail.");
  const html = renderToStaticMarkup(<UnderwritingDetailPanel
    companyName="Current Lens Co"
    analysis={analysisFixture()}
    detail={detail}
    drafts={[]}
    canSaveDrafts={false}
    onEditDraft={() => {}}
  />);
  const appendix = html.slice(html.indexOf("Audit Appendix"));

  assert.match(appendix, /judgment_advisory_1/);
  assert.match(appendix, /named-lens-passage-v1/);
  assert.match(appendix, /decision-first-named-lens-v1/);
  assert.match(appendix, /judgment_advisory_1@named-lens-passage-v1@named-lens-generator-v1/);
  assert.match(appendix, /attemptNumber[\s\S]*1/);
});

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
  const evidenceRegisterIndex = html.indexOf("Evidence and Source Register");
  const auditIndex = html.indexOf("Audit Appendix");
  const mainMemo = html.slice(0, evidenceRegisterIndex);
  const evidenceRegister = html.slice(evidenceRegisterIndex, auditIndex);
  const auditAppendix = html.slice(auditIndex);

  assert.ok(evidenceRegisterIndex > 0);
  assert.equal(mainMemo.match(/data-scenario-input=/g)?.length ?? 0, 0);
  assert.equal(auditAppendix.match(/data-scenario-input=/g)?.length, 51);
  assert.match(mainMemo, /Current modeling status/);
  assert.match(mainMemo, /45 of 51 required scenario inputs/);
  assert.match(mainMemo, /Required Before Valuation/);
  assert.match(mainMemo, /Required Evidence/);
  assert.match(mainMemo, /Decision Use/);
  assert.match(auditAppendix, /Complete scenario input matrix/);
  assert.doesNotMatch(mainMemo, /vsee-evidence-ledger/);
  assert.match(evidenceRegister, /vsee-evidence-ledger/);
  assert.doesNotMatch(mainMemo, /vsee-source-revisions|vsee-version-grid/);
  assert.match(auditAppendix, /vsee-source-revisions/);
  assert.match(auditAppendix, /vsee-version-grid/);
  assert.doesNotMatch(auditAppendix, /Final IC Position/);
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

  assert.match(html, /Advance authorizes continued diligence/);
  assert.match(html, /What this changes for the portfolio/);
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
  assert.match(html, /Decision Request/);
  assert.match(html, /VSee IC Synthesis/);
  assert.match(html, /could go no further than Advance/);
  assert.match(html, /public sources do not disclose: net retention/);
});

test("presents modeling assumptions and the complete IC approval request without transport metadata in the memo", () => {
  const html = renderToStaticMarkup(<UnderwritingDetailPanel
    companyName="Invested Risk Co"
    analysis={analysisFixture()}
    detail={detailFixture()}
    drafts={[draftFixture()]}
    canSaveDrafts={true}
    onEditDraft={() => {}}
    evidenceContext={PINNED_CONTEXT}
  />);
  const evidenceRegisterIndex = html.indexOf("Evidence and Source Register");
  const auditIndex = html.indexOf("Audit Appendix");
  assert.ok(evidenceRegisterIndex > 0);
  assert.ok(auditIndex > evidenceRegisterIndex);
  const mainMemo = html.slice(0, evidenceRegisterIndex);
  const auditAppendix = html.slice(auditIndex);

  assert.match(mainMemo, /Modeling Assumptions/);
  assert.match(mainMemo, /Bear[\s\S]*0\.75× \(−25%\)/);
  assert.match(mainMemo, /Base[\s\S]*1\.00× \(Base\)/);
  assert.match(mainMemo, /Bull[\s\S]*1\.25× \(\+25%\)/);
  assert.match(mainMemo, /Preferred equity[\s\S]*Requires confirmation/);
  assert.doesNotMatch(
    mainMemo,
    /Changed assumptions|0\.75 decimal|fund_policy:|assumption_price_bear/i,
  );
  assert.match(
    auditAppendix,
    /Persisted assumption inventory[\s\S]*assumption_price_bear[\s\S]*fund_policy:/,
  );

  assert.match(mainMemo, /IC APPROVAL REQUEST/);
  assert.match(mainMemo, /Pause follow-on investment activity/);
  assert.match(mainMemo, /Begin an internal portfolio-risk review/);
  assert.match(
    mainMemo,
    /portfolio-level decision[\s\S]*stays inside the fund[\s\S]*does not wait/,
  );
  assert.doesNotMatch(mainMemo, /<button[^>]*>\s*(?:SEND|PUBLISH)/i);
});

test("renders live evidence context as a readable window instead of its transport label", () => {
  const liveContext: ReportEvidenceContext = {
    ...PINNED_CONTEXT,
    evidenceMode: "live",
    snapshotId: null,
    snapshotFingerprint: null,
    windowStartAt: "2026-07-21T07:00:00.000Z",
    windowEndAt: "2026-08-04T06:59:59.999Z",
    displayLabel: "Live evidence window ending 2026-08-04T06:59:59.999Z",
    eventCount: 8,
  };
  const html = renderToStaticMarkup(<UnderwritingDetailPanel
    companyName="Invested Risk Co"
    analysis={analysisFixture()}
    detail={detailFixture()}
    drafts={[]}
    canSaveDrafts={false}
    onEditDraft={() => {}}
    evidenceContext={liveContext}
  />);
  const notice = html.slice(0, html.indexOf("DEEP UNDERWRITING"));

  assert.match(notice, /LIVE EVIDENCE/);
  assert.match(notice, /Evidence window[\s\S]*Jul 21, 2026 – Aug 3, 2026/);
  assert.match(notice, /America\/Los_Angeles/);
  assert.match(notice, /8 accepted events/);
  assert.doesNotMatch(notice, /Live evidence window ending/);
  assert.doesNotMatch(notice, /2026-08-04T06:59:59\.999Z/);
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
    "Decision Request",
    "What Changed",
    "Company Position",
    "Thesis Assessment",
    "Financial and Valuation Status",
    "Named Lens Readings",
    "Recommendation and Next Steps",
    "Appendix",
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

test("Evidence register distinguishes the original public source from its archived snapshot", () => {
  const html = renderToStaticMarkup(<UnderwritingDetailPanel
    companyName="Source Link Co"
    analysis={analysisFixture()}
    detail={detailFixture()}
    drafts={[]}
    canSaveDrafts={false}
    onEditDraft={() => {}}
    evidenceContext={PINNED_CONTEXT}
  />);
  const start = html.indexOf("Evidence and Source Register");
  const end = html.indexOf("Audit Appendix");
  const register = html.slice(start, end);

  assert.match(
    register,
    /href="https:\/\/public\.example\.test\/reported-valuation"[^>]*>View original source ↗<\/a>/,
  );
  assert.match(register, /Open archived evidence snapshot/);
  assert.doesNotMatch(
    register,
    />Source Revision · revision_ask ↗<\/a>/,
  );
});

test("Action Drafts summarize evidence once and keep complete bodies in readable disclosures", () => {
  const actions = actionsForDealStatusAndDirection("watchlist", "positive");
  const internal: PublicActionDraft = {
    ...draftFixture(),
    dealStatus: "watchlist",
    beliefDirection: "positive",
    actions,
  };
  const email: PublicActionDraft = {
    ...internal,
    id: "draft_founder_email",
    format: "founder_email",
    channel: "email",
    audienceType: "founder",
    body: "SUBJECT: Follow-up\n\nWe would like to request the remaining evidence.",
  };
  const html = renderToStaticMarkup(<UnderwritingDetailPanel
    companyName="Draft Presentation Co"
    analysis={analysisFixture()}
    detail={detailFixture()}
    drafts={[email, internal]}
    canSaveDrafts={true}
    onEditDraft={() => {}}
    evidenceContext={PINNED_CONTEXT}
  />);
  const start = html.indexOf("Status-aware Action Drafts");
  const end = html.indexOf("Evidence and Source Register");
  const section = html.slice(start, end);

  assert.equal(section.match(/class="vsee-action-draft-evidence-summary"/g)?.length, 1);
  assert.equal(
    section.match(/<summary[^>]*>Read full draft<\/summary>/g)?.length,
    2,
  );
  assert.equal(
    section.match(/<summary[^>]*>Audit metadata<\/summary>/g)?.length,
    2,
  );
  assert.match(section, /aria-label="Read full Internal Underwriting Memo draft"/);
  assert.match(section, /aria-label="Read full Founder Email draft"/);
  assert.match(
    section,
    /<pre class="vsee-action-draft-body">INTERNAL UNDERWRITING ACTION MEMO — DRAFT ONLY\nPause follow-on pending risk review\.<\/pre>/,
  );
  assert.ok(
    section.indexOf("Internal Underwriting Memo")
      < section.indexOf("Founder Email"),
  );
  assert.equal(section.match(/EDIT CURRENT BODY/g)?.length, 2);
  assert.doesNotMatch(
    section,
    /<button[^>]*>\s*(?:SEND|PUBLISH)/i,
  );
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
    "No modeling assumptions were persisted",
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
