import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import rawExpectedOutcomes from "../../seed/belief-reversal/2026-08-01/expected-outcomes.json";
import rawManifest from "../../seed/belief-reversal/2026-08-01/manifest.json";
import * as productionManifestModule from "../../lib/belief-reversal/manifest";
import * as productionContractsModule from "../../lib/belief-reversal/contracts";
import {
  parseBeliefReversalManifest,
} from "../../lib/belief-reversal/contracts";
import {
  crossCheckBeliefReversalExpectedOutcomes,
  parseBeliefReversalExpectedOutcomes,
} from "../helpers/belief-reversal-expected-outcomes";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mutation tests intentionally traverse untyped JSON fixtures
type JsonObject = Record<string, any>;

const originalCompanyNames = new Set([
  "7bridges", "100Plus", "1906", "A-Champs", "Ably", "Acin", "Acquco",
  "Ada Health", "InterTwin.ai", "UniKudo", "Mirror", "CouPro", "IndieShow",
  "HuMetric", "Alpha Builders", "INNFormNest", "SilverMemory", "Kanesh", "Fellowtrip",
]);

function manifestCopy(): JsonObject {
  return structuredClone(rawManifest) as JsonObject;
}

function outcomesCopy(): JsonObject {
  return structuredClone(rawExpectedOutcomes) as JsonObject;
}

function firstCase(input: JsonObject): JsonObject {
  return input.selectedCases[0];
}

function firstSource(input: JsonObject): JsonObject {
  return firstCase(input).sources[0];
}

function assertManifestRejected(mutator: (input: JsonObject) => void, pattern: RegExp): void {
  const input = manifestCopy();
  mutator(input);
  assert.throws(() => parseBeliefReversalManifest(input), pattern);
}

test("production loading exposes research evidence but no expected answer fields", () => {
  const researchPackage = productionManifestModule.loadBeliefReversalManifest();
  assert.equal(researchPackage.schemaVersion, "belief-reversal-research-v2");
  assert.equal(researchPackage.selectedCases.length, 4);

  for (const selectedCase of researchPackage.selectedCases) {
    assert.equal("direction" in selectedCase, false);
    assert.equal("proposedActions" in selectedCase, false);
    assert.equal("inferences" in selectedCase, false);
    assert.equal("hiddenChainOfThought" in selectedCase, false);
    assert.equal(originalCompanyNames.has(selectedCase.profile.brandName.value), false);
  }
  assert.equal(JSON.stringify(researchPackage.selectedCases).includes("qualificationRationale"), false);
  assert.equal(JSON.stringify(researchPackage).includes("expectedNewActions"), false);
  assert.equal("parseBeliefReversalExpectedOutcomes" in productionContractsModule, false);
  assert.equal("crossCheckBeliefReversalExpectedOutcomes" in productionContractsModule, false);
  assert.deepEqual(Object.keys(productionManifestModule), ["loadBeliefReversalManifest"]);
});

test("test-only expected outcomes carry the exact four-case matrix and canonical actions", () => {
  const manifest = productionManifestModule.loadBeliefReversalManifest();
  const outcomes = parseBeliefReversalExpectedOutcomes(rawExpectedOutcomes);
  crossCheckBeliefReversalExpectedOutcomes(manifest, outcomes);

  assert.deepEqual(outcomes.cases.map((item) => ({
    companyName: item.companyName,
    priorStatus: item.priorStatus,
    direction: item.direction,
    priorAction: item.priorAction,
    expectedNewActions: item.expectedNewActions,
  })), [
    { companyName: "Henry AI", priorStatus: "passed", direction: "positive", priorAction: "deprioritize", expectedNewActions: ["reopen_diligence"] },
    { companyName: "Smallest.ai", priorStatus: "watchlist", direction: "positive", priorAction: "continue_monitoring", expectedNewActions: ["advance_diligence"] },
    { companyName: "Hush Security", priorStatus: "invested", direction: "positive", priorAction: "continue_monitoring", expectedNewActions: ["evaluate_follow_on", "validate_channel_economics"] },
    { companyName: "Irregular", priorStatus: "invested", direction: "negative", priorAction: "evaluate_follow_on", expectedNewActions: ["pause_follow_on", "portfolio_risk_review"] },
  ]);
  assert.deepEqual(
    outcomes.cases.find((item) => item.companyName === "Hush Security")?.requiredOpenDiligence,
    ["Validate Akamai and Kyndryl channel economics, bookings, margins, and sell-through."],
  );
  assert.deepEqual(
    outcomes.cases.find((item) => item.companyName === "Smallest.ai")?.requiredOpenDiligence,
    ["Confirm customer deployment depth, retention, revenue, corporate registry and contracting-entity alignment, and the operational impact of Agent Versioning."],
  );
});

test("test-only cross-check rejects an expected outcome without a new action delta", () => {
  const manifestInput = manifestCopy();
  const outcomesInput = outcomesCopy();
  const hushCase = manifestInput.selectedCases.find((item: JsonObject) => item.profile.brandName.value === "Hush Security");
  const hushOutcome = outcomesInput.cases.find((item: JsonObject) => item.companyName === "Hush Security");
  hushCase.priorDecision.priorAction = "evaluate_follow_on";
  hushOutcome.priorAction = "evaluate_follow_on";
  hushOutcome.expectedNewActions = ["evaluate_follow_on"];
  assert.throws(
    () => crossCheckBeliefReversalExpectedOutcomes(
      parseBeliefReversalManifest(manifestInput),
      parseBeliefReversalExpectedOutcomes(outcomesInput),
    ),
    /action delta/i,
  );
});

test("selected cases contain source-backed profiles, complete unavailable metrics, and typed prior actions", () => {
  const researchPackage = productionManifestModule.loadBeliefReversalManifest();
  for (const selectedCase of researchPackage.selectedCases) {
    const sourceIds = new Set(selectedCase.sources.map((source) => source.id));
    assert.ok(sourceIds.has(selectedCase.profile.brandName.sourceId));
    assert.ok(sourceIds.has(selectedCase.profile.officialDomain.sourceId));
    if (selectedCase.profile.legalName.availability === "available") {
      assert.ok(sourceIds.has(selectedCase.profile.legalName.sourceId));
    }
    assert.ok(selectedCase.profile.founders.every((founder) => sourceIds.has(founder.sourceId)));
    assert.equal(selectedCase.profile.securityType.classification, "assumption");
    assert.equal(selectedCase.profile.securityType.sourceBoundary, "No reviewed public source disclosed the security type.");
    assert.match(selectedCase.priorDecision.priorAction, /^(deprioritize|continue_monitoring|evaluate_follow_on)$/);
    assert.deepEqual(Object.keys(selectedCase.metrics), [
      "reportedValuation", "arrOrRevenue", "customerEvidence", "cash", "burn",
      "reportedValuationBasis", "runway", "retention", "customerCount",
    ]);
    for (const metric of Object.values(selectedCase.metrics)) {
      if (metric.availability === "unavailable") assert.equal("value" in metric, false);
    }
  }
});

test("every selected case has a seed-ready recent event with bounded referenced provenance", () => {
  const researchPackage = productionManifestModule.loadBeliefReversalManifest();
  assert.deepEqual(researchPackage.evidenceWindow, {
    startAt: "2026-07-19T00:00:00-07:00",
    endAt: "2026-08-01T23:59:59-07:00",
    timezone: "America/Los_Angeles",
    displayLabel: "Demo evidence snapshot as of 2026-08-01",
  });

  for (const selectedCase of researchPackage.selectedCases) {
    assert.ok(selectedCase.events.length > 0);
    const sourceIds = new Set(selectedCase.sources.map((source) => source.id));
    for (const event of selectedCase.events) {
      assert.ok(event.eventAt);
      assert.ok(event.eventAt >= "2026-07-19" && event.eventAt <= "2026-08-01");
      assert.equal(event.retrievedAt, "2026-08-01");
      assert.match(event.confidence, /^(low|medium|high)$/);
      assert.ok(event.entityKeys.length > 0);
      assert.ok(sourceIds.has(event.triggerSourceId));
      assert.ok(event.sourceIds.every((id) => sourceIds.has(id)));
      const sources = event.sourceIds.map((id) =>
        selectedCase.sources.find((source) => source.id === id)
      );
      assert.ok(sources.every((source) => source !== undefined));
      assert.deepEqual(
        event.entityKeys,
        [...new Set(sources.flatMap((source) => source?.entityKeys ?? []))]
          .sort(),
      );
      const trigger = selectedCase.sources.find((source) =>
        source.id === event.triggerSourceId
      );
      assert.ok(trigger);
      assert.ok(selectedCase.entityKeys.every((key) =>
        trigger.entityKeys.includes(key)
      ));
      assert.ok(event.positiveImplications.every((text) => !/diligence|follow-on|portfolio|reopen/i.test(text)));
      assert.ok(event.negativeImplications.every((text) => !/diligence|follow-on|portfolio|reopen/i.test(text)));
    }
  }
});

test("source-level entity provenance preserves the Hush-to-Irregular counter-source boundary", () => {
  const researchPackage = productionManifestModule.loadBeliefReversalManifest();
  const hush = researchPackage.selectedCases.find(({ dealId }) =>
    dealId === "deal_hush_security_v1"
  );
  assert.ok(hush);
  const counter = hush.sources.find(({ id }) =>
    id === "source_hush_anthropic_controls_v1"
  ) as unknown as JsonObject | undefined;
  assert.ok(counter);
  assert.deepEqual(counter.entityKeys, ["irregular"]);
  assert.deepEqual(hush.events[0]?.entityKeys, ["hush_security", "irregular"]);
});

test("source entity keys are required, fingerprint-bound, and exactly covered by each event", () => {
  assertManifestRejected((input) => {
    delete input.selectedCases[0].sources[0].entityKeys;
  }, /entityKeys|entity keys/i);
  assertManifestRejected((input) => {
    input.selectedCases[0].sources[0].entityKeys = ["forged_company"];
  }, /fingerprint inputs/i);
  assertManifestRejected((input) => {
    const hush = input.selectedCases.find((item: JsonObject) =>
      item.dealId === "deal_hush_security_v1"
    );
    hush.events[0].entityKeys = ["hush_security"];
  }, /event entity keys.*source entity keys/i);
});

test("claim support is one exact bounded span and normalized text stays distinct", () => {
  const researchPackage = productionManifestModule.loadBeliefReversalManifest();
  for (const selectedCase of researchPackage.selectedCases) {
    const claims = new Map(selectedCase.claims.map((claim) => [claim.id, claim]));
    for (const source of selectedCase.sources) {
      const claim = claims.get(source.supportedClaimId);
      assert.ok(claim);
      assert.equal(claim.sourceId, source.id);
      assert.equal(claim.statement, source.normalizedStatement);
      assert.notEqual(source.verbatimExcerpt, source.normalizedStatement);
      assert.ok(source.verbatimExcerpt.split(/\s+/u).length <= 25);
    }
  }

  const smallest = researchPackage.selectedCases.find((item) => item.profile.brandName.value === "Smallest.ai");
  assert.ok(smallest);
  assert.ok(smallest.claims.some((claim) => claim.statement === "Smallest.ai reports more than $21 million in total funding."));
  assert.ok(smallest.claims.some((claim) => claim.statement === "TechCrunch reports RingCentral and Truecaller as existing Smallest.ai customers; this remains secondary reporting."));
  assert.ok(smallest.claims.some((claim) => claim.statement === "Smallest.ai's changelog says the isLocked field was removed."));

  const irregular = researchPackage.selectedCases.find((item) => item.profile.brandName.value === "Irregular");
  assert.ok(irregular);
  assert.ok(irregular.claims.some((claim) => claim.statement.includes("unauthorized access to real systems")));
  assert.ok(irregular.claims.some((claim) => claim.statement === "Anthropic says it conducted the incident review in collaboration with Irregular."));
});

test("Smallest.ai preserves both source-linked article-date observations", () => {
  const smallest = productionManifestModule.loadBeliefReversalManifest().selectedCases
    .find((item) => item.profile.brandName.value === "Smallest.ai");
  assert.ok(smallest);
  assert.deepEqual(smallest.sourceDateConflicts, [{
    description: "The article page displays July 31, 2026 while the blog index displays July 30, 2026.",
    observations: [
      { value: "2026-07-30", sourceId: "source_smallest_blog_index_v1" },
      { value: "2026-07-31", sourceId: "source_smallest_official_series_a_v1" },
    ],
  }]);
});

test("dynamic non-trigger pages may omit publication dates but triggers may not", () => {
  const researchPackage = productionManifestModule.loadBeliefReversalManifest();
  assert.equal(researchPackage.selectedCases[0].sources.find((source) => source.id === "source_henry_yc_founders_v1")?.publishedAt, null);
  assert.equal(researchPackage.selectedCases[1].sources.find((source) => source.id === "source_smallest_author_v1")?.publishedAt, null);
  assert.equal(researchPackage.selectedCases[2].sources.find((source) => source.id === "source_hush_about_v1")?.publishedAt, null);
  assertManifestRejected((input) => {
    const trigger = firstCase(input).sources.find((source: JsonObject) => source.evidenceRole === "trigger");
    trigger.publishedAt = null;
    trigger.fingerprintInputs.publishedAt = null;
  }, /trigger.*publication date/i);
});

test("Henry identity and legal fields use claim-specific exact spans", () => {
  const henry = productionManifestModule.loadBeliefReversalManifest().selectedCases[0];
  assert.deepEqual(henry.profile.legalName, { availability: "available", value: "Henry AI Inc.", sourceId: "source_henry_legal_name_v1" });
  assert.equal(henry.profile.officialDomain.sourceId, "source_henry_yc_domain_v1");
  assert.equal(henry.profile.businessModel.availability === "available" && henry.profile.businessModel.sourceId, "source_henry_yc_product_v1");
  assert.equal(henry.profile.geography.availability === "available" && henry.profile.geography.sourceId, "source_henry_yc_location_v1");
  assert.equal(henry.foundingDate.status === "available" && henry.foundingDate.sourceId, "source_henry_yc_founded_v1");
  assert.equal(henry.sources.find((source) => source.id === "source_henry_series_a_v1")?.canonicalUrl, "https://www.prnewswire.com/news-releases/henry-ai-raises-16-5m-series-a-and-launches-henry-deal-302837784.html");
  assert.equal(henry.sources.find((source) => source.id === "source_henry_terms_v1")?.canonicalUrl, "https://www.henry.ai/standard-terms");
});

test("reported valuation basis is typed and source-linked for every selected case", () => {
  for (const selectedCase of productionManifestModule.loadBeliefReversalManifest().selectedCases) {
    const sourceIds = new Set(selectedCase.sources.map((source) => source.id));
    const basis = selectedCase.metrics.reportedValuationBasis;
    const ids = basis.availability === "available" ? basis.sourceIds : basis.checkedSourceIds;
    assert.ok(ids.length > 0 && ids.every((sourceId) => sourceIds.has(sourceId)));
  }
});

test("Hush retains company-reported Kyndryl deployment and resale evidence", () => {
  const hush = productionManifestModule.loadBeliefReversalManifest().selectedCases
    .find((item) => item.profile.brandName.value === "Hush Security");
  assert.ok(hush);
  const claim = hush.claims.find((item) => item.id === "claim_hush_kyndryl_v1");
  assert.ok(claim);
  assert.equal(claim.reportingBasis, "company_reported_partner_quote");
  assert.match(claim.statement, /deployed.*internally.*resell/i);
});

test("the machine ledger records four pinned narrative cases and seven analysis-eligible research candidates", () => {
  const researchPackage = productionManifestModule.loadBeliefReversalManifest();
  assert.deepEqual(researchPackage.candidateLedger.map((entry) => ({
    name: entry.companyIdentity.brandName,
    disposition: entry.disposition,
  })), [
    { name: "Henry AI", disposition: "selected" },
    { name: "Smallest.ai", disposition: "selected" },
    { name: "Hush Security", disposition: "selected" },
    { name: "Irregular", disposition: "selected" },
    { name: "Centralize", disposition: "qualified_not_selected" },
    { name: "ChipAgents", disposition: "qualified_not_selected" },
    { name: "Sent", disposition: "qualified_not_selected" },
    { name: "Cascade", disposition: "qualified_not_selected" },
    { name: "Cordant", disposition: "qualified_not_selected" },
    { name: "Empirical Security", disposition: "qualified_not_selected" },
    { name: "Freight Hero", disposition: "qualified_not_selected" },
  ]);
  for (const entry of researchPackage.candidateLedger) {
    assert.ok(entry.screeningSourceIds.length > 0);
    assert.ok(entry.missingEvidence.length > 0);
    assert.ok(entry.counterevidenceAndLimits.length > 0);
    assert.ok(entry.companyIdentity.identitySourceIds.length > 0);
    assert.ok(entry.triggeringEvent.status === "resolved" || entry.triggeringEvent.status === "unresolved");
  }
  const researchOnly = researchPackage.candidateLedger.filter(
    (entry) => entry.disposition === "qualified_not_selected",
  );
  assert.equal(researchOnly.length, 7);
  const stableDealIds = new Map([
    ["Centralize", "deal_centralize_v1"],
    ["ChipAgents", "deal_chipagents_v1"],
    ["Sent", "deal_sent_v1"],
    ["Cascade", "deal_cascade_v1"],
    ["Cordant", "deal_cordant_v1"],
    ["Empirical Security", "deal_empirical_security_v1"],
    ["Freight Hero", "deal_freight_hero_v1"],
  ]);
  for (const entry of researchOnly) {
    assert.equal(entry.caseId, null);
    assert.ok(entry.companyId.length > 0);
    assert.equal(
      entry.stableDealId,
      stableDealIds.get(entry.companyIdentity.brandName),
    );
    assert.equal(entry.dealStatus, "screening");
    assert.equal(entry.analysisEligible, true);
    assert.ok(entry.entityKeys.length > 0);
    assert.ok(entry.qualificationRationale.length > 0);
    assert.ok(entry.notSelectedReason.length > 0);
    assert.ok(entry.invalidatingEvidence.length > 0);
    assert.ok(entry.upgradingEvidence.length > 0);
    assert.ok(entry.reconsiderationConditions.length > 0);
    assert.equal(entry.actionDelta.classification, "research_only");
    assert.equal(entry.actionDelta.createsFormalWorkflowArtifact, false);
    assert.deepEqual(entry.workflowEligibility, {
      deal: true,
      xtrace: true,
      matching: true,
      companyAnalysis: true,
      deepUnderwritingAdmissionPolicy: {
        requiredOutcome: "belief_revised",
        allowedConfidence: ["medium", "high"],
        scoreThreshold: "configured_threshold_met",
        hardGates: "all_passed",
        lineage: "complete",
        failureState: "none",
        researchDispositionAffectsAdmission: false,
        admissionMode: "all_qualifying_deals",
        orderingRole: "priority_only",
      },
    });
  }
  const centralize = researchPackage.candidateLedger.find((entry) => entry.companyIdentity.brandName === "Centralize");
  assert.ok(centralize?.disposition === "qualified_not_selected");
  assert.equal(centralize.companyIdentity.legalName, "Collate Labs, Inc.");
  assert.equal(centralize.triggeringEvent.status, "resolved");
  assert.match(centralize.notSelectedReason, /qualifying changed belief.*Deep Underwriting/i);
  assert.match(centralize.notSelectedReason, /does not affect future runtime admission/i);

  const chipAgents = researchPackage.candidateLedger.find((entry) => entry.companyIdentity.brandName === "ChipAgents");
  assert.ok(chipAgents?.disposition === "qualified_not_selected");
  assert.equal(chipAgents.companyIdentity.legalName, "Alpha Design AI, Inc.");
  assert.equal(chipAgents.triggeringEvent.status, "resolved");
  assert.match(chipAgents.notSelectedReason, /qualifying changed belief.*Deep Underwriting/i);
  assert.match(chipAgents.notSelectedReason, /does not affect future runtime admission/i);
  const chipReutersGap = researchPackage.screeningSources.find((source) => source.id === "source_chipagents_reuters_gap_v1");
  assert.ok(chipReutersGap?.status === "unresolved");
  assert.match(chipReutersGap.reason, /Reuters-specific.*not used/i);
  assert.match(chipReutersGap.reason, /amount and stage.*Axios/i);
  const chipBaseline = researchPackage.screeningSources.find((source) => source.id === "source_chipagents_businesswire_baseline_v1");
  assert.ok(chipBaseline?.status === "resolved");
  assert.equal(chipBaseline.canonicalUrl, "https://www.businesswire.com/news/home/20260217568914/en/ChipAgents-Raises-%2474M-to-Scale-an-Agentic-AI-Platform-to-Accelerate-Chip-Design");
  assert.ok(chipAgents.screeningSourceIds.includes(chipBaseline.id));
  assert.match(chipAgents.counterevidenceAndLimits.join(" "), /\$74 million.*baseline.*does not conflict.*\$60 million/i);
  assert.match(chipAgents.counterevidenceAndLimits.join(" "), /\$131 million.*not verified/i);
});

test("the completed research scan sends every qualifying changed belief to the underwriting queue", () => {
  const contract = productionManifestModule.loadBeliefReversalManifest()
    .researchIntegrationContract;
  assert.deepEqual(contract, {
    schemaVersion: "research-integration-contract-v1",
    companyIdentityCount: 30,
    dealCount: 30,
    analysisEligibleDealCount: 30,
    completedScanCompanyAnalysisCount: 30,
    companyAnalysisOutcomeCounts: {
      beliefRevised: 4,
      monitor: 7,
      noMaterialChange: 19,
      analysisUnavailable: 0,
    },
    currentDeepUnderwritingQueueCount: 4,
    currentNotAdmittedCompanyAnalysisCount: 26,
    deepUnderwritingAdmissionPolicy: {
      requiredOutcome: "belief_revised",
      allowedConfidence: ["medium", "high"],
      scoreThreshold: "configured_threshold_met",
      hardGates: "all_passed",
      lineage: "complete",
      failureState: "none",
      researchDispositionAffectsAdmission: false,
      admissionMode: "all_qualifying_deals",
      orderingRole: "priority_only",
    },
    legacyPinnedRankAdapter: "compatibility_only",
    resolvedPublicSourceParentCount: 18,
    unresolvedEvidenceGapCount: 1,
    sampleResearchScreeningParentCount: 7,
    researchDealBoundParentCount: 25,
    existingDealBoundParentCount: 60,
    totalDealBoundParentCount: 85,
    sourceDocumentCount: 80,
    sourceRevisionCount: 80,
    workspaceDocumentCount: 79,
    dealSourceAssignmentCount: 85,
    xtraceExactDealParentCount: 85,
    xtraceExactDealChildCount: 85,
  });
});

test("research Deal eligibility and changed-belief underwriting admission fail closed", () => {
  assertManifestRejected((input) => {
    const entry = input.candidateLedger.find(
      (candidate: JsonObject) => candidate.companyIdentity.brandName === "Centralize",
    );
    entry.dealStatus = "passed";
  }, /screening|deal status/i);
  assertManifestRejected((input) => {
    const entry = input.candidateLedger.find(
      (candidate: JsonObject) => candidate.companyIdentity.brandName === "Centralize",
    );
    entry.analysisEligible = false;
  }, /analysis|literal|true/i);
  assertManifestRejected((input) => {
    const entry = input.candidateLedger.find(
      (candidate: JsonObject) => candidate.companyIdentity.brandName === "Centralize",
    );
    entry.stableDealId = "deal_henry_ai_v1";
  }, /unique|duplicate/i);
  assertManifestRejected((input) => {
    const entry = input.candidateLedger.find(
      (candidate: JsonObject) => candidate.companyIdentity.brandName === "Centralize",
    );
    entry.workflowEligibility.deepUnderwritingAdmissionPolicy
      .researchDispositionAffectsAdmission = true;
  }, /disposition|admission|literal|false/i);
  assertManifestRejected((input) => {
    const entry = input.candidateLedger.find(
      (candidate: JsonObject) => candidate.companyIdentity.brandName === "Centralize",
    );
    entry.workflowEligibility.ranking = false;
  }, /unrecognized|ranking/i);
  assertManifestRejected((input) => {
    input.researchIntegrationContract.companyAnalysisOutcomeCounts.monitor = 6;
  }, /analysis|count|literal|30/i);
  assertManifestRejected((input) => {
    input.researchIntegrationContract.totalDealBoundParentCount = 84;
  }, /parent|count|literal|85/i);
});

test("Cascade screening copy uses the verified release-summary seed span", () => {
  const researchPackage = productionManifestModule.loadBeliefReversalManifest();
  const source = researchPackage.screeningSources.find((item) => item.id === "source_cascade_globenewswire_v1");
  assert.ok(source?.status === "resolved");
  assert.equal(
    source.normalizedStatement,
    "Cascade announced a $3.5 million seed round.",
  );
  assert.equal(source.verbatimExcerpt, "announces a $3.5 million seed round.");
  assert.equal(source.publicationTimestamp, "2026-07-21T13:30:00Z");
  assert.equal(source.retrievedAt, "2026-08-03");
  assert.equal(source.locator, "Release Summary/description metadata");
  assert.equal(source.fingerprintInputs.normalizedStatement, source.normalizedStatement);
  assert.doesNotMatch(source.normalizedStatement, /AEC|pursuit platform/i);

  const ledgerMarkdown = readFileSync(
    new URL("../../seed/belief-reversal/2026-08-01/candidate-ledger.md", import.meta.url),
    "utf8",
  );
  assert.match(ledgerMarkdown, /\| Cascade \|.*\$3\.5m seed/i);
  assert.match(ledgerMarkdown, /\| Cordant \|.*\| Qualified research record;/i);
  assert.match(ledgerMarkdown, /All qualifying Deals are admitted/i);
  assert.match(ledgerMarkdown, /ordering only controls processing priority/i);
});

test("Sent identity metadata follows the final official Privacy Notice", () => {
  const researchPackage = productionManifestModule.loadBeliefReversalManifest();
  const sent = researchPackage.candidateLedger.find((entry) => entry.companyIdentity.brandName === "Sent");
  const source = researchPackage.screeningSources.find((item) => item.id === "source_sent_identity_v1");
  assert.ok(sent);
  assert.ok(source?.status === "resolved");
  assert.equal(source.title, "Privacy Notice");
  assert.equal(source.canonicalUrl, "https://www.sent.dm/en/legal/privacy-policy");
  assert.equal(source.publishedAt, "2026-03-03");
  assert.equal(source.fingerprintInputs.title, "Privacy Notice");
  assert.equal(source.fingerprintInputs.canonicalUrl, "https://www.sent.dm/en/legal/privacy-policy");
  assert.equal(source.fingerprintInputs.publishedAt, "2026-03-03");
  assert.equal(source.verbatimExcerpt, "Sent, Inc. (“Sent,” “we,” “us,” or “our”) respects your privacy.");
  assert.match(sent.companyIdentity.identityNote, /official privacy notice.*brand.*legal entity.*domain/i);
  assert.match(sent.companyIdentity.identityNote, /financing.*trigger source/i);

  const cascade = researchPackage.candidateLedger.find((entry) => entry.companyIdentity.brandName === "Cascade");
  assert.ok(cascade);
  assert.match(cascade.companyIdentity.identityNote, /official privacy page.*brand.*legal entity.*domain/i);
  assert.match(cascade.companyIdentity.identityNote, /financing.*trigger source/i);
});

test("partial candidate identities do not assert domains absent from exact source spans", () => {
  const ledger = productionManifestModule.loadBeliefReversalManifest().candidateLedger;
  const empirical = ledger.find((entry) => entry.companyIdentity.brandName === "Empirical Security");
  const freightHero = ledger.find((entry) => entry.companyIdentity.brandName === "Freight Hero");
  assert.ok(empirical);
  assert.ok(freightHero);
  if (empirical.companyIdentity.status !== "partially_resolved") assert.fail("Empirical identity must remain partial");
  if (freightHero.companyIdentity.status !== "partially_resolved") assert.fail("Freight Hero identity must remain partial");
  assert.equal(empirical.companyIdentity.officialDomain, null);
  assert.equal(freightHero.companyIdentity.officialDomain, "https://freighthero.ai");
  assert.deepEqual(empirical.companyIdentity.unresolvedFields, ["legal_name", "official_domain"]);
  assert.deepEqual(freightHero.companyIdentity.unresolvedFields, ["legal_name"]);
  assert.match(empirical.companyIdentity.identityNote, /official domain.*unresolved/i);
  assert.match(freightHero.companyIdentity.identityNote, /official.*brand.*domain.*legal entity.*unresolved/i);
  assert.match(empirical.missingEvidence.join(" "), /official domain/i);
  assert.doesNotMatch(freightHero.missingEvidence.join(" "), /official domain/i);
});

test("research-only evidence uses its own August 3 snapshot and exact 18-resolved/one-gap catalog", () => {
  const researchPackage = productionManifestModule.loadBeliefReversalManifest();
  assert.deepEqual(researchPackage.researchMemoryContext, {
    schemaVersion: "research-memory-context-v1",
    mode: "pinned",
    scope: "research_only",
    researchSnapshotVersion: "research-evidence-snapshot-v1",
    snapshotId: "belief_reversal_research_2026_08_03_v1",
    snapshotAsOfDate: "2026-08-03",
    retrievalCutoffDate: "2026-08-03",
    anchorAt: "2026-08-03T13:34:43.000Z",
    windowStartAt: "2026-07-20T13:34:43.000Z",
    windowEndAt: "2026-08-03T13:34:43.000Z",
    windowTimezone: "America/Los_Angeles",
    displayLabel: "Demo evidence snapshot as of 2026-08-03",
    formalReportEligible: false,
  });
  assert.equal(researchPackage.evidenceWindow.displayLabel, "Demo evidence snapshot as of 2026-08-01");
  const resolved = researchPackage.screeningSources.filter((source) => source.status === "resolved");
  const unresolved = researchPackage.screeningSources.filter((source) => source.status === "unresolved");
  assert.equal(resolved.length, 18);
  assert.deepEqual(unresolved.map(({ id }) => id), ["source_chipagents_reuters_gap_v1"]);

  const expectedAugust3 = new Map([
    ["source_cordant_private_beta_v1", "counterevidence"],
    ["source_empirical_benchmark_context_v1", "counterevidence"],
    ["source_freight_hero_official_seed_v1", "trigger"],
    ["source_freight_hero_managed_model_v1", "counterevidence"],
    ["source_freight_hero_per_load_pricing_v1", "counterevidence"],
  ] as const);
  for (const [id, evidenceRole] of expectedAugust3) {
    const source = resolved.find((item) => item.id === id);
    assert.ok(source);
    assert.equal(source.retrievedAt, "2026-08-03");
    assert.equal(source.sourceClass, "company_official");
    assert.equal(source.sourceAuthority, "primary");
    assert.equal(source.evidenceRole, evidenceRole);
  }
  const benchmark = resolved.find((source) =>
    source.id === "source_empirical_benchmark_context_v1"
  );
  assert.ok(benchmark);
  assert.equal(benchmark.publishedAt, "2025-07-15");
  assert.equal(benchmark.eventAt, null);
  assert.equal(benchmark.evidenceRole, "counterevidence");
});

test("the Empirical trigger includes the exact rolling-window boundary and excludes one millisecond earlier", () => {
  const researchPackage = productionManifestModule.loadBeliefReversalManifest();
  const empirical = researchPackage.screeningSources.find((source) =>
    source.id === "source_empirical_finsmes_v1"
  );
  assert.ok(empirical?.status === "resolved");
  assert.equal(empirical.publicationTimestamp, "2026-07-20T13:34:43Z");

  assertManifestRejected((input) => {
    const source = input.screeningSources.find(
      (item: JsonObject) => item.id === "source_empirical_finsmes_v1",
    );
    source.publicationTimestamp = "2026-07-20T13:34:42.999Z";
    source.fingerprintInputs.publicationTimestamp =
      "2026-07-20T13:34:42.999Z";
  }, /research-memory window|outside.*window/i);
});

test("Centralize keeps company-provided Series A corroboration without adopting a floating total", () => {
  const researchPackage = productionManifestModule.loadBeliefReversalManifest();
  const centralize = researchPackage.candidateLedger.find((entry) => entry.companyIdentity.brandName === "Centralize");
  const source = researchPackage.screeningSources.find((item) => item.id === "source_centralize_job_board_v1");
  assert.ok(centralize);
  assert.ok(source?.status === "resolved");
  assert.equal(source.canonicalUrl, "https://jobs.ashbyhq.com/centralize/8debce91-6f36-482a-91be-e5c91ffe79e2");
  assert.equal(source.verbatimExcerpt, "We just raised a Series A led by NEA");
  assert.equal(source.publishedAt, null);
  assert.equal(source.evidenceRole, "corroborating");
  assert.equal(source.sourceAuthority, "primary");
  assert.ok(centralize.screeningSourceIds.includes(source.id));
  assert.match(centralize.counterevidenceAndLimits.join(" "), /job board.*Series A.*NEA/i);
  assert.doesNotMatch(source.normalizedStatement, /total/i);
});

test("resolved candidate triggers must be included in screeningSourceIds", () => {
  assertManifestRejected((input) => {
    const sent = input.candidateLedger.find((entry: JsonObject) => entry.companyIdentity.brandName === "Sent");
    sent.screeningSourceIds = sent.screeningSourceIds.filter((sourceId: string) => sourceId !== sent.triggeringEvent.sourceId);
  }, /trigger.*screeningSourceIds|screening.*trigger/i);
});

test("resolved candidate triggers must reference resolved trigger-role evidence", () => {
  assertManifestRejected((input) => {
    const source = input.screeningSources.find((item: JsonObject) => item.id === "source_sent_globenewswire_v1");
    source.evidenceRole = "corroborating";
    source.fingerprintInputs.evidenceRole = "corroborating";
  }, /trigger.*evidenceRole|trigger-role/i);
});

test("resolved candidate trigger fields must exactly match their source", () => {
  const mutations: Array<[string, string]> = [
    ["canonicalUrl", "https://example.com/mismatched-trigger"],
    ["eventAt", "2026-07-27"],
    ["publishedAt", "2026-07-27"],
    ["retrievedAt", "2026-07-31"],
  ];
  for (const [field, value] of mutations) {
    assertManifestRejected((input) => {
      const sent = input.candidateLedger.find((entry: JsonObject) => entry.companyIdentity.brandName === "Sent");
      sent.triggeringEvent[field] = value;
    }, /triggering event.*match|trigger.*provenance/i);
  }
});

test("identitySourceIds must be included in screeningSourceIds", () => {
  assertManifestRejected((input) => {
    const sent = input.candidateLedger.find((entry: JsonObject) => entry.companyIdentity.brandName === "Sent");
    sent.screeningSourceIds = sent.screeningSourceIds.filter((sourceId: string) => !sent.companyIdentity.identitySourceIds.includes(sourceId));
  }, /identity.*screeningSourceIds|screening.*identity/i);
});

test("identitySourceIds must reference resolved owned evidence", () => {
  assertManifestRejected((input) => {
    const chipAgents = input.candidateLedger.find((entry: JsonObject) => entry.companyIdentity.brandName === "ChipAgents");
    chipAgents.companyIdentity.identitySourceIds = ["source_chipagents_reuters_gap_v1"];
  }, /identity.*resolved/i);
});

test("candidate identity resolution status must match field completeness", () => {
  assertManifestRejected((input) => {
    const sent = input.candidateLedger.find((entry: JsonObject) => entry.companyIdentity.brandName === "Sent");
    sent.companyIdentity.legalName = null;
  }, /resolved identity.*legalName.*officialDomain|identity.*complete|expected string/i);
  assertManifestRejected((input) => {
    const cordant = input.candidateLedger.find((entry: JsonObject) => entry.companyIdentity.brandName === "Cordant");
    cordant.companyIdentity.legalName = "Cordant, Inc.";
  }, /partially.resolved.*incomplete|identity.*status|unresolvedFields.*null identity fields/i);
  assertManifestRejected((input) => {
    const cordant = input.candidateLedger.find((entry: JsonObject) => entry.companyIdentity.brandName === "Cordant");
    cordant.companyIdentity.unresolvedFields = ["official_domain"];
  }, /unresolvedFields.*match|null.*field/i);
  assertManifestRejected((input) => {
    const sent = input.candidateLedger.find((entry: JsonObject) => entry.companyIdentity.brandName === "Sent");
    sent.companyIdentity.unresolvedFields = ["legal_name"];
  }, /unrecognized key|unresolvedFields/i);
});

test("selected candidate case IDs must be a one-to-one set match", () => {
  assertManifestRejected((input) => {
    const selected = input.candidateLedger.filter((entry: JsonObject) => entry.disposition === "selected");
    selected[0].caseId = selected[1].caseId;
  }, /selected.*one-to-one|exactly link/i);
});

test("selected candidate links must match selected brand and domain", () => {
  assertManifestRejected((input) => {
    const henry = input.candidateLedger.find((entry: JsonObject) => entry.companyIdentity.brandName === "Henry AI");
    henry.companyIdentity.brandName = "Wrong company";
  }, /selected.*brand|selected.*domain|company identity/i);
  assertManifestRejected((input) => {
    const henry = input.candidateLedger.find((entry: JsonObject) => entry.companyIdentity.brandName === "Henry AI");
    henry.companyIdentity.officialDomain = "https://wrong.example.com";
  }, /selected.*brand|selected.*domain|company identity/i);
});

test("resolved screening sources bind canonical entity keys into their fingerprints", () => {
  const researchPackage = productionManifestModule.loadBeliefReversalManifest();
  const resolved = researchPackage.screeningSources.filter(
    (source) => source.status === "resolved",
  );
  assert.ok(resolved.length > 0);
  for (const source of resolved) {
    assert.ok(source.entityKeys.length > 0);
    assert.deepEqual(source.fingerprintInputs.entityKeys, source.entityKeys);
  }

  assertManifestRejected((input) => {
    const source = input.screeningSources.find(
      (item: JsonObject) => item.status === "resolved",
    );
    source.entityKeys = ["forged_company"];
  }, /fingerprint|entity keys/i);
});

test("Cordant stays qualified but its unavailable production proof is never promoted into a fact", () => {
  const researchPackage = productionManifestModule.loadBeliefReversalManifest();
  const cordant = researchPackage.candidateLedger.find(
    (entry) => entry.companyIdentity.brandName === "Cordant",
  );
  assert.ok(cordant?.disposition === "qualified_not_selected");
  assert.match(cordant.missingEvidence.join(" "), /production customer/i);
  assert.match(cordant.missingEvidence.join(" "), /enterprise AI.*core|core.*enterprise AI/i);
  assert.match(cordant.notSelectedReason, /unverified|insufficient/i);
  assert.doesNotMatch(cordant.qualificationRationale, /production customer.*(proved|verified|deployed)/i);

  assertManifestRejected((input) => {
    const entry = input.candidateLedger.find(
      (item: JsonObject) => item.companyIdentity.brandName === "Cordant",
    );
    entry.missingEvidence = ["No material evidence gaps."];
    entry.notSelectedReason = "Qualified despite unavailable production evidence.";
    entry.counterevidenceAndLimits = ["Cordant has verified production customers."];
  }, /Cordant.*production|Cordant.*evidence limit/i);
});

test("impossible calendar dates fail closed", () => {
  assertManifestRejected((input) => {
    firstSource(input).eventAt = "2026-02-31";
    firstSource(input).fingerprintInputs.eventAt = "2026-02-31";
  }, /date|calendar/i);
});

test("prior chronology failures fail closed", () => {
  assertManifestRejected((input) => {
    firstCase(input).priorDecision.occurredAt = "2026-07-30T10:00:00-07:00";
  }, /prior.*predate|chronology/i);
});

test("fixture provenance and display label failures fail closed", () => {
  assertManifestRejected((input) => { firstCase(input).priorDecision.provenance = "real_interaction"; }, /demo_fixture|provenance/i);
  assertManifestRejected((input) => { firstCase(input).priorDecision.label = "Decision record"; }, /Sample decision record|label/i);
});

test("missing trigger, primary authority, or counterevidence fails closed", () => {
  assertManifestRejected((input) => {
    for (const source of firstCase(input).sources) source.evidenceRole = "corroborating";
  }, /trigger/i);
  assertManifestRejected((input) => {
    for (const source of firstCase(input).sources) source.sourceAuthority = "secondary";
  }, /primary/i);
  assertManifestRejected((input) => {
    firstCase(input).counterevidenceSourceIds = [];
  }, /counterevidence/i);
});

test("normalized text cannot masquerade as exact support", () => {
  assertManifestRejected((input) => {
    firstSource(input).verbatimExcerpt = firstSource(input).normalizedStatement;
    firstSource(input).fingerprintInputs.verbatimExcerpt = firstSource(input).normalizedStatement;
  }, /verbatim|normalized|exact/i);
});

test("research contracts preserve verbatim whitespace without accepting whitespace-only text", () => {
  const input = manifestCopy();
  const original = firstSource(input).verbatimExcerpt as string;
  const verbatim = `\n  ${original}  \t`;
  firstSource(input).verbatimExcerpt = verbatim;
  firstSource(input).fingerprintInputs.verbatimExcerpt = verbatim;

  const parsed = parseBeliefReversalManifest(input);
  assert.equal(parsed.selectedCases[0].sources[0].verbatimExcerpt, verbatim);
  assert.equal(
    parsed.selectedCases[0].sources[0].fingerprintInputs.verbatimExcerpt,
    verbatim,
  );

  assertManifestRejected((candidate) => {
    firstSource(candidate).verbatimExcerpt = " \n\t ";
    firstSource(candidate).fingerprintInputs.verbatimExcerpt = " \n\t ";
  }, /non-whitespace|verbatim|nonempty/i);
});

test("research source URLs reject unsafe protocols before seed promotion", () => {
  assertManifestRejected((input) => {
    const source = firstSource(input);
    source.canonicalUrl = "javascript:alert(1)";
    source.fingerprintInputs.canonicalUrl = "javascript:alert(1)";
    for (const entry of input.candidateLedger) {
      if (
        entry.triggeringEvent.status === "resolved"
        && entry.triggeringEvent.sourceId === source.id
      ) {
        entry.triggeringEvent.canonicalUrl = "javascript:alert(1)";
      }
    }
  }, /canonical|http|url|protocol/i);
});

test("duplicate IDs fail across selected evidence, events, and candidate ledger", () => {
  assertManifestRejected((input) => {
    input.candidateLedger[0].id = firstSource(input).id;
  }, /unique|duplicate/i);
  assertManifestRejected((input) => {
    input.candidateLedger[1].id = input.candidateLedger[0].id;
  }, /unique|duplicate/i);
});

test("dangling source, event, metric, founder, date-conflict, and input references fail closed", () => {
  assertManifestRejected((input) => { firstCase(input).profile.founders[0].sourceId = "source_missing_v1"; }, /source.*reference|unknown source/i);
  assertManifestRejected((input) => { firstCase(input).events[0].triggerSourceId = "source_missing_v1"; }, /trigger source|unknown source/i);
  assertManifestRejected((input) => { firstCase(input).events[0].sourceIds = ["source_missing_v1"]; }, /event.*source|unknown source/i);
  assertManifestRejected((input) => {
    firstCase(input).metrics.customerEvidence = { availability: "available", value: "Example", basis: "company reported", asOfDate: "2026-07-29", sourceIds: ["source_missing_v1"] };
  }, /metric.*source|unknown source/i);
  assertManifestRejected((input) => {
    input.selectedCases[1].sourceDateConflicts[0].observations[0].sourceId = "source_missing_v1";
  }, /date.conflict|unknown source/i);
  assertManifestRejected((input) => { input.candidateLedger[0].screeningSourceIds = ["source_missing_v1"]; }, /screening source|unknown source/i);
});

test("invalid expected-outcome matrices and dangling case links fail closed", () => {
  const invalidDirection = outcomesCopy();
  invalidDirection.cases[0].direction = "negative";
  assert.throws(() => crossCheckBeliefReversalExpectedOutcomes(
    productionManifestModule.loadBeliefReversalManifest(),
    parseBeliefReversalExpectedOutcomes(invalidDirection),
  ), /matrix|Henry|direction/i);

  const dangling = outcomesCopy();
  dangling.cases[0].caseId = "case_missing_v1";
  assert.throws(() => crossCheckBeliefReversalExpectedOutcomes(
    productionManifestModule.loadBeliefReversalManifest(),
    parseBeliefReversalExpectedOutcomes(dangling),
  ), /case|manifest/i);
});

test("publication timestamps and every exact provenance field are fingerprint-bound", () => {
  assertManifestRejected((input) => {
    firstSource(input).publicationTimestamp = "2026-07-29T10:00:00-04:00";
  }, /fingerprint/i);
  assertManifestRejected((input) => {
    firstSource(input).locator = "Changed locator";
  }, /fingerprint/i);
  assertManifestRejected((input) => {
    firstSource(input).sourceAuthority = "secondary";
  }, /fingerprint/i);
});

test("parsed research packages are recursively immutable at runtime", () => {
  const researchPackage = parseBeliefReversalManifest(rawManifest);
  const nestedSource = researchPackage.selectedCases[0].sources[0];
  assert.equal(Object.isFrozen(researchPackage), true);
  assert.equal(Object.isFrozen(researchPackage.selectedCases), true);
  assert.equal(Object.isFrozen(nestedSource), true);
  const originalTitle = nestedSource.title;
  assert.throws(() => { (nestedSource as { title: string }).title = "mutated"; }, /read only|assign|frozen/i);
  assert.equal(nestedSource.title, originalTitle);
});

test("event trigger lineage must be included and field-identical", () => {
  assertManifestRejected((input) => { firstCase(input).events[0].sourceIds = [firstCase(input).sources[1].id]; }, /trigger provenance/i);
  assertManifestRejected((input) => { firstCase(input).events[0].eventAt = "2026-07-28"; }, /trigger provenance/i);
  assertManifestRejected((input) => { firstCase(input).events[0].publishedAt = "2026-07-28"; }, /trigger provenance/i);
  assertManifestRejected((input) => { firstCase(input).events[0].retrievedAt = "2026-07-31"; }, /trigger provenance|retrieval date/i);
});

test("candidate ledgers cannot borrow another candidate's screening source", () => {
  assertManifestRejected((input) => {
    input.candidateLedger[4].screeningSourceIds = [input.candidateLedger[6].screeningSourceIds[0]];
  }, /another candidate|belongs/i);
  assertManifestRejected((input) => {
    input.candidateLedger[4].triggeringEvent.sourceId = input.candidateLedger[6].triggeringEvent.sourceId;
  }, /another candidate|belongs/i);
  assertManifestRejected((input) => {
    input.candidateLedger[0].screeningSourceIds = [input.candidateLedger[1].screeningSourceIds[0]];
  }, /another selected case|belongs/i);
  assertManifestRejected((input) => {
    input.candidateLedger[0].triggeringEvent.sourceId = input.candidateLedger[1].triggeringEvent.sourceId;
  }, /another selected case|belongs/i);
  assertManifestRejected((input) => {
    input.candidateLedger[4].companyIdentity.identitySourceIds = input.candidateLedger[6].companyIdentity.identitySourceIds;
  }, /another candidate.*identity|identity source/i);
  assertManifestRejected((input) => {
    input.candidateLedger[0].companyIdentity.identitySourceIds = input.candidateLedger[1].companyIdentity.identitySourceIds;
  }, /another selected case.*identity|identity source/i);
});

test("publication timestamps require a publication date", () => {
  assertManifestRejected((input) => {
    firstSource(input).publishedAt = null;
    firstSource(input).publicationTimestamp = "2026-07-29T09:00:00-04:00";
    firstSource(input).fingerprintInputs.publishedAt = null;
    firstSource(input).fingerprintInputs.publicationTimestamp = "2026-07-29T09:00:00-04:00";
  }, /timestamp.*publication date/i);
});

test("production manifest parsing rejects expected-outcome injection at any case boundary", () => {
  assertManifestRejected((input) => {
    firstCase(input).direction = "positive";
  }, /unrecognized key|direction/i);
  assertManifestRejected((input) => {
    firstCase(input).expectedNewActions = ["reopen_diligence"];
  }, /unrecognized key|expectedNewActions/i);
  assertManifestRejected((input) => {
    input.expectedOutcomes = rawExpectedOutcomes;
  }, /unrecognized key|expectedOutcomes/i);
});
