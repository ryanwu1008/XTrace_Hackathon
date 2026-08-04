import assert from "node:assert/strict";
import test from "node:test";

import type { CandidateUnderwritingDetail } from "../../lib/underwriting/read-model";
import { buildAnalystPanel } from "../../app/analyst-panel-view-model";

type Judgment = CandidateUnderwritingDetail["judgments"][number];

test("groups active named judgments by IC issue without dropping opposing views", () => {
  const judgments = [
    judgment({
      id: "judgment_thiel",
      packId: "peter_thiel_public_frameworks_v0_1",
      packName: "Peter Thiel Public Frameworks — Research Draft",
      conclusion: "negative",
      support: "The category has a scarce technical wedge.",
      counter: "Containment failure weakens durable trust.",
    }),
    judgment({
      id: "judgment_sequoia",
      packId: "sequoia_valentine_moritz_public_frameworks_v0_1",
      packName: "Sequoia / Valentine / Moritz Public Frameworks — Research Draft",
      conclusion: "supportive",
      support: "The team is operating in an important new category.",
      counter: "Remediation quality remains unverified.",
    }),
    judgment({
      id: "judgment_helmer",
      packId: "hamilton_helmer_7_powers_public_frameworks_v0_1",
      packName: "Hamilton Helmer / 7 Powers Public Frameworks — Research Draft",
      conclusion: "mixed",
    }),
    judgment({
      id: "judgment_people",
      packId: "claire_hughes_johnson_scaling_people_public_frameworks_v0_1",
      packName: "Claire Hughes Johnson / Scaling People Public Frameworks — Research Draft",
      conclusion: "negative",
    }),
    judgment({
      id: "judgment_marks",
      packId: "howard_marks_most_important_thing_public_frameworks_v0_1",
      packName: "Howard Marks / The Most Important Thing Public Frameworks — Research Draft",
      conclusion: "negative",
    }),
    judgment({
      id: "judgment_value",
      packId: "aswath_damodaran_dark_side_valuation_public_frameworks_v0_1",
      packName: "Aswath Damodaran / The Dark Side of Valuation Public Frameworks — Research Draft",
      conclusion: "mixed",
    }),
    judgment({
      id: "judgment_abstain",
      packId: "andrew_chen_cold_start_problem_public_frameworks_v0_1",
      packName: "Andrew Chen / The Cold Start Problem Public Frameworks — Research Draft",
      applicability: "not_applicable",
      conclusion: "abstain",
    }),
  ];

  const panel = buildAnalystPanel(judgments);

  assert.equal(panel.totalJudgmentCount, judgments.length);
  assert.equal(panel.activeJudgmentCount, 6);
  assert.equal(panel.abstainedJudgmentCount, 1);
  assert.deepEqual(
    [...panel.groups.flatMap((group) => group.judgmentIds), ...panel.abstainedJudgmentIds].sort(),
    judgments.map(({ id }) => id).sort(),
  );

  const market = panel.groups.find(({ id }) => id === "market_and_category");
  assert.ok(market);
  assert.deepEqual(market.conclusions, ["negative", "supportive"]);
  assert.match(market.participants.join(" "), /Peter Thiel/);
  assert.match(market.participants.join(" "), /Sequoia/);
  assert.match(market.strongestSupport.join(" "), /scarce technical wedge/);
  assert.match(market.strongestCounterevidence.join(" "), /durable trust/);

  for (const issueId of [
    "competitive_power",
    "team_and_execution",
    "downside_and_risk",
    "valuation_and_returns",
  ]) {
    assert.ok(panel.groups.some(({ id }) => id === issueId), issueId);
  }
});

test("analyst issue synthesis is deterministic and retains uncategorized core lenses", () => {
  const judgments = [
    judgment({
      id: "judgment_core",
      frameworkCardId: "specialist_regulatory_readiness",
      packId: null,
      packName: null,
      conclusion: "mixed",
    }),
    judgment({
      id: "judgment_unavailable",
      packId: "bill_gurley_public_frameworks_v0_1",
      packName: "Bill Gurley Public Frameworks — Research Draft",
      applicability: "unavailable",
      conclusion: "abstain",
    }),
  ];

  const first = buildAnalystPanel(judgments);
  const second = buildAnalystPanel(structuredClone(judgments));

  assert.deepEqual(first, second);
  assert.equal(first.coreLensCount, 1);
  assert.equal(first.namedAnalystCount, 1);
  assert.deepEqual(first.abstainedJudgmentIds, ["judgment_unavailable"]);
  assert.deepEqual(
    first.groups.find(({ id }) => id === "cross_cutting")?.judgmentIds,
    ["judgment_core"],
  );
});

function judgment({
  id,
  packId = "named_pack",
  packName = "Named Public Frameworks — Research Draft",
  frameworkCardId = "framework_card",
  applicability = "applicable",
  conclusion,
  support = "Persisted strongest support.",
  counter = "Persisted strongest counterevidence.",
}: {
  id: string;
  packId?: string | null;
  packName?: string | null;
  frameworkCardId?: string;
  applicability?: Judgment["applicability"];
  conclusion: Judgment["conclusion"];
  support?: string;
  counter?: string;
}): Judgment {
  return {
    id,
    frameworkCardId,
    frameworkVersion: "1.0.0",
    applicability,
    conclusion,
    strongestSupport: support,
    strongestCounterargument: counter,
    supportEvidenceItemIds: [`evidence_support_${id}`],
    counterEvidenceItemIds: [`evidence_counter_${id}`],
    unknowns: [`Unknown for ${id}`],
    limitations: [`Limitation for ${id}`],
    confidence: {
      sourceReliability: "high",
      evidenceStrength: "medium",
      evidenceCoverage: "medium",
      applicability: "high",
      judgment: "medium",
    },
    ...(packId && packName
      ? {
        frameworkMetadata: {
          packId,
          packName,
          packVersion: "0.1.0",
          sourceCatalogId: `${packId}_sources`,
          researchCutoff: "2026-07-28",
          components: [],
          sources: [],
        },
      }
      : {}),
  } as Judgment;
}
