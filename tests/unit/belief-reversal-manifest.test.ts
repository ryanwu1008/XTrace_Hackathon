import assert from "node:assert/strict";
import test from "node:test";

import expectedOutcomes from "../../seed/belief-reversal/2026-08-01/expected-outcomes.json";
import rawManifest from "../../seed/belief-reversal/2026-08-01/manifest.json";
import * as productionManifestModule from "../../lib/belief-reversal/manifest";
import {
  parseBeliefReversalManifest,
  type BeliefReversalResearchPackage,
} from "../../lib/belief-reversal/contracts";

const originalCompanyNames = new Set([
  "7bridges",
  "100Plus",
  "1906",
  "A-Champs",
  "Ably",
  "Acin",
  "Acquco",
  "Ada Health",
  "InterTwin.ai",
  "UniKudo",
  "Mirror",
  "CouPro",
  "IndieShow",
  "HuMetric",
  "Alpha Builders",
  "INNFormNest",
  "SilverMemory",
  "Kanesh",
  "Fellowtrip",
]);

function loadPackage(): BeliefReversalResearchPackage {
  return productionManifestModule.loadBeliefReversalManifest();
}

test("production loading returns the four versioned reversal cases without changing the original corpus", () => {
  const researchPackage = loadPackage();
  assert.equal(researchPackage.schemaVersion, "belief-reversal-research-v1");
  assert.equal(researchPackage.packageId, "belief_reversal_2026_08_01");
  assert.equal(researchPackage.version, "1.0.0");
  assert.deepEqual(researchPackage.evidenceWindow, {
    startAt: "2026-07-19T00:00:00-07:00",
    endAt: "2026-08-01T23:59:59-07:00",
    timezone: "America/Los_Angeles",
    displayLabel: "Demo evidence snapshot as of 2026-08-01",
  });
  assert.equal(researchPackage.retrievalDate, "2026-08-01");
  assert.equal(researchPackage.selectedCases.length, 4);

  assert.deepEqual(
    researchPackage.selectedCases.map(({ companyName, priorDecision, direction, proposedActions }) => ({
      companyName,
      status: priorDecision.status,
      direction,
      proposedActions,
    })),
    [
      {
        companyName: "Henry AI",
        status: "passed",
        direction: "positive",
        proposedActions: ["reopen_diligence"],
      },
      {
        companyName: "Smallest.ai",
        status: "watchlist",
        direction: "positive",
        proposedActions: ["advance_diligence"],
      },
      {
        companyName: "Hush Security",
        status: "invested",
        direction: "positive",
        proposedActions: ["evaluate_follow_on", "validate_channel_economics"],
      },
      {
        companyName: "Irregular",
        status: "invested",
        direction: "negative",
        proposedActions: ["pause_follow_on", "portfolio_risk_review"],
      },
    ],
  );
  for (const selectedCase of researchPackage.selectedCases) {
    assert.equal(originalCompanyNames.has(selectedCase.companyName), false);
  }
});

test("stable identities and source-backed evidence metadata are complete and unique", () => {
  const researchPackage = loadPackage();
  const allIds = researchPackage.selectedCases.flatMap((selectedCase) => [
    selectedCase.id,
    selectedCase.companyId,
    selectedCase.dealId,
    selectedCase.priorDecision.id,
    ...selectedCase.claims.map((claim) => claim.id),
    ...selectedCase.sources.map((source) => source.id),
  ]);
  assert.equal(new Set(allIds).size, allIds.length);

  for (const selectedCase of researchPackage.selectedCases) {
    const claimIds = new Set(selectedCase.claims.map((claim) => claim.id));
    assert.ok(selectedCase.sources.some((source) => source.evidenceRole === "trigger"));
    assert.ok(selectedCase.sources.some((source) => source.evidenceRole === "counterevidence"));
    assert.ok(selectedCase.sources.some((source) => source.sourceAuthority === "primary"));

    for (const source of selectedCase.sources) {
      assert.match(source.canonicalUrl, /^https:\/\//);
      assert.notEqual(source.verbatimExcerpt, source.normalizedStatement);
      assert.ok(source.verbatimExcerpt.split(/\s+/u).length <= 25);
      assert.equal(source.retrievedAt, "2026-08-01");
      assert.match(source.eventAt, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(source.publishedAt, /^\d{4}-\d{2}-\d{2}$/);
      assert.deepEqual(source.fingerprintInputs, {
        canonicalUrl: source.canonicalUrl,
        eventAt: source.eventAt,
        publishedAt: source.publishedAt,
        retrievedAt: source.retrievedAt,
        verbatimExcerpt: source.verbatimExcerpt,
      });
      assert.ok(source.claimIds.length > 0);
      for (const claimId of source.claimIds) assert.ok(claimIds.has(claimId));
    }
  }
});

test("chronology, counterevidence, fixture labeling, and evidence classifications fail closed", () => {
  const researchPackage = loadPackage();
  assert.equal(researchPackage.historicalCutoffDate, "2026-07-18");

  for (const selectedCase of researchPackage.selectedCases) {
    const triggerDates = selectedCase.sources
      .filter((source) => source.evidenceRole === "trigger")
      .map((source) => source.eventAt);
    assert.ok(triggerDates.every((date) => date >= "2026-07-19" && date <= "2026-08-01"));
    assert.ok(triggerDates.every((date) => selectedCase.priorDecision.occurredAt.slice(0, 10) < date));
    assert.ok(selectedCase.priorDecision.occurredAt.slice(0, 10) <= researchPackage.historicalCutoffDate);
    assert.equal(selectedCase.priorDecision.provenance, "demo_fixture");
    assert.equal(selectedCase.priorDecision.label, "Sample decision record");
    assert.equal(selectedCase.hiddenChainOfThought, false);
    assert.ok(selectedCase.counterevidenceSourceIds.length > 0);
    assert.ok(selectedCase.unknowns.length > 0);
    assert.ok(selectedCase.claims.every((claim) => claim.classification === "fact"));
    assert.ok(selectedCase.inferences.every((inference) => inference.classification === "inference"));
    assert.ok(selectedCase.assumptions.every((assumption) => assumption.classification === "assumption"));
    assert.ok(selectedCase.calculations.every((calculation) => calculation.classification === "calculation"));
    assert.ok(selectedCase.frameworkViewpoints.every((viewpoint) => viewpoint.classification === "framework_viewpoint"));
    for (const metric of Object.values(selectedCase.metrics)) {
      if (metric.availability === "unavailable") assert.equal("value" in metric, false);
    }
  }
});

test("Smallest.ai preserves rather than resolves the public founding-date conflict", () => {
  const smallest = loadPackage().selectedCases.find((selectedCase) => selectedCase.companyName === "Smallest.ai");
  assert.ok(smallest);
  assert.deepEqual(smallest.foundingDate, {
    status: "conflicting",
    observations: [
      { value: "2023", sourceId: "source_smallest_tracxn_profile_v1" },
      { value: "late 2024", sourceId: "source_smallest_techcrunch_series_a_v1" },
    ],
  });
  assert.ok(smallest.sources.some((source) => (
    source.id === "source_smallest_official_series_a_v1" &&
    source.canonicalUrl === "https://smallest.ai/blog/series-a-funding-13m-next-generation-voice-ai"
  )));
  assert.deepEqual(smallest.sourceDateConflicts, [{
    description: "The article page displays July 31, 2026 while the blog index/related listing displays July 30, 2026.",
    values: ["2026-07-30", "2026-07-31"],
    sourceIds: ["source_smallest_official_series_a_v1"],
  }]);
});

test("the event-first ledger retains every accepted and rejected identity with explicit reasons", () => {
  const ledger = loadPackage().candidateLedger;
  assert.deepEqual(
    ledger.map(({ companyName, disposition }) => ({ companyName, disposition })),
    [
      { companyName: "Henry AI", disposition: "accepted" },
      { companyName: "Smallest.ai", disposition: "accepted" },
      { companyName: "Hush Security", disposition: "accepted" },
      { companyName: "Irregular", disposition: "accepted" },
      { companyName: "Centralize", disposition: "rejected" },
      { companyName: "ChipAgents", disposition: "rejected" },
      { companyName: "Sent", disposition: "rejected" },
      { companyName: "Cascade", disposition: "rejected" },
      { companyName: "Cordant", disposition: "rejected" },
      { companyName: "Empirical Security", disposition: "rejected" },
      { companyName: "Freight Hero", disposition: "rejected" },
    ],
  );
  assert.ok(ledger.every((candidate) => candidate.reason.trim().length > 0));
  const centralize = ledger.find((candidate) => candidate.companyName === "Centralize");
  assert.match(centralize?.reason ?? "", /four-case cap.*weaker.*action delta|weaker.*action delta.*four-case cap/i);
  assert.match(centralize?.supersededReason ?? "", /\$19m total funding.*stage/i);
  assert.match(centralize?.supersededBy ?? "", /NEA led our Series A/i);
});

test("test-only expected outcomes cannot enter the strict production manifest boundary", () => {
  assert.equal("expectedOutcomes" in productionManifestModule, false);
  assert.equal("expectedOutcomes" in loadPackage(), false);
  assert.throws(
    () => parseBeliefReversalManifest({ ...rawManifest, expectedOutcomes }),
    /unrecognized key|expectedOutcomes/i,
  );
});
