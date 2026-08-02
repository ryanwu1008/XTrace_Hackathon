import assert from "node:assert/strict";
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
  assert.equal(JSON.stringify(researchPackage).includes("qualificationRationale"), false);
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
    expectedNewActions: item.expectedNewActions,
  })), [
    { companyName: "Henry AI", priorStatus: "passed", direction: "positive", expectedNewActions: ["reopen_diligence"] },
    { companyName: "Smallest.ai", priorStatus: "watchlist", direction: "positive", expectedNewActions: ["advance_diligence"] },
    { companyName: "Hush Security", priorStatus: "invested", direction: "positive", expectedNewActions: ["evaluate_follow_on"] },
    { companyName: "Irregular", priorStatus: "invested", direction: "negative", expectedNewActions: ["pause_follow_on", "portfolio_risk_review"] },
  ]);
  assert.deepEqual(
    outcomes.cases.find((item) => item.companyName === "Hush Security")?.requiredOpenDiligence,
    ["Validate Akamai and Kyndryl channel economics, bookings, margins, and sell-through."],
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
      assert.ok(event.entityKeys.every((key) => selectedCase.entityKeys.includes(key)));
      assert.ok(sourceIds.has(event.triggerSourceId));
      assert.ok(event.sourceIds.every((id) => sourceIds.has(id)));
      assert.ok(event.positiveImplications.every((text) => !/diligence|follow-on|portfolio|reopen/i.test(text)));
      assert.ok(event.negativeImplications.every((text) => !/diligence|follow-on|portfolio|reopen/i.test(text)));
    }
  }
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

test("the machine ledger is auditable and distinguishes qualified-not-selected from rejected", () => {
  const researchPackage = productionManifestModule.loadBeliefReversalManifest();
  assert.deepEqual(researchPackage.candidateLedger.map((entry) => ({
    name: entry.companyIdentity.brandName,
    disposition: entry.disposition,
  })), [
    { name: "Henry AI", disposition: "accepted" },
    { name: "Smallest.ai", disposition: "accepted" },
    { name: "Hush Security", disposition: "accepted" },
    { name: "Irregular", disposition: "accepted" },
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
  const centralize = researchPackage.candidateLedger.find((entry) => entry.companyIdentity.brandName === "Centralize");
  assert.ok(centralize);
  assert.equal(centralize.companyIdentity.legalName, "Collate Labs, Inc.");
  assert.equal(centralize.triggeringEvent.status, "resolved");
  assert.match(centralize.reason, /four-case/i);

  const chipAgents = researchPackage.candidateLedger.find((entry) => entry.companyIdentity.brandName === "ChipAgents");
  assert.ok(chipAgents);
  assert.equal(chipAgents.companyIdentity.legalName, "Alpha Design AI, Inc.");
  assert.equal(chipAgents.triggeringEvent.status, "resolved");
  assert.match(chipAgents.reason, /four-case|weaker/i);
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
