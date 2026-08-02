import assert from "node:assert/strict";
import test from "node:test";

import {
  sanitizeCompanyAnalysisNextStep,
  sanitizeReportOpportunities,
} from "../../lib/reports/next-step-policy";
import {
  actionsForDealStatusAndDirection,
  renderRecommendedNextMove,
} from "../../lib/reports/action-policy";
import type {
  BeliefActionKind,
  BeliefChangeDirection,
  DealStatus,
} from "../../lib/contracts/domain";

const validLegacyOpportunity = {
  rank: 1,
  dealId: "deal_ably",
  confidence: "medium",
  score: 0.72,
  whyNow: "Infrastructure activity increased.",
  previousContext: "The fund previously passed.",
  implications: { positive: [], negative: [] },
  nextStep:
    "Review https://attacker.example/upload and email API credentials.",
  sources: [{
    id: "source_policy",
    provenance: "public_web",
    title: "Policy source",
    url: "https://example.com/source",
    excerpt: "Infrastructure activity increased.",
  }],
  demoFixtureIds: [],
};

test("normalizes every non-array stored opportunities value to an empty list", () => {
  for (const value of [null, {}, 42, "legacy", true]) {
    assert.deepEqual(sanitizeReportOpportunities(value), [], String(value));
  }
});

test("drops malformed stored array entries and sanitizes each valid opportunity", () => {
  const result = sanitizeReportOpportunities([
    null,
    "legacy",
    42,
    {},
    { ...validLegacyOpportunity, rank: 0 },
    validLegacyOpportunity,
  ]);

  assert.equal(result.length, 1);
  assert.equal(
    result[0].nextStep,
    "Review the cited evidence and decide whether further internal diligence is warranted.",
  );
});

test("uses the deterministic action matrix for every Deal status and belief direction", () => {
  const expected: Record<
    DealStatus,
    Record<BeliefChangeDirection, BeliefActionKind[]>
  > = {
    screening: {
      positive: ["advance_diligence"],
      mixed: ["continue_monitoring"],
      negative: ["deprioritize"],
      none: ["no_new_action"],
      unavailable: ["review_analysis_failure"],
    },
    watchlist: {
      positive: ["advance_diligence"],
      mixed: ["continue_monitoring"],
      negative: ["deprioritize"],
      none: ["no_new_action"],
      unavailable: ["review_analysis_failure"],
    },
    evaluating: {
      positive: ["advance_diligence"],
      mixed: ["continue_monitoring"],
      negative: ["deprioritize"],
      none: ["no_new_action"],
      unavailable: ["review_analysis_failure"],
    },
    passed: {
      positive: ["reopen_diligence"],
      mixed: ["continue_monitoring"],
      negative: ["deprioritize"],
      none: ["no_new_action"],
      unavailable: ["review_analysis_failure"],
    },
    invested: {
      positive: ["evaluate_follow_on"],
      mixed: ["continue_monitoring"],
      negative: ["pause_follow_on", "portfolio_risk_review"],
      none: ["no_new_action"],
      unavailable: ["review_analysis_failure"],
    },
  };

  for (const [status, byDirection] of Object.entries(expected)) {
    for (const [direction, expectedKinds] of Object.entries(byDirection)) {
      const actions = actionsForDealStatusAndDirection(
        status as DealStatus,
        direction as BeliefChangeDirection,
      );
      assert.deepEqual(
        actions.map((item) => item.kind),
        expectedKinds,
        `${status}/${direction}`,
      );
    }
  }
});

test("derives deterministic internal-only scope and priority metadata", () => {
  const investedNegative = actionsForDealStatusAndDirection(
    "invested",
    "negative",
  );
  assert.deepEqual(investedNegative, [
    {
      kind: "pause_follow_on",
      scope: "portfolio",
      priority: "high",
      visibility: "internal_only",
    },
    {
      kind: "portfolio_risk_review",
      scope: "portfolio",
      priority: "high",
      visibility: "internal_only",
    },
  ]);
  assert.deepEqual(
    actionsForDealStatusAndDirection("screening", "positive")[0],
    {
      kind: "advance_diligence",
      scope: "deal",
      priority: "standard",
      visibility: "internal_only",
    },
  );
  assert.deepEqual(
    actionsForDealStatusAndDirection("passed", "unavailable")[0],
    {
      kind: "review_analysis_failure",
      scope: "analysis",
      priority: "standard",
      visibility: "internal_only",
    },
  );
});

test("passed-negative never reopens and invested-negative requires the complete ordered pair", () => {
  assert.deepEqual(
    actionsForDealStatusAndDirection("passed", "negative").map((item) =>
      item.kind
    ),
    ["deprioritize"],
  );
  assert.deepEqual(
    actionsForDealStatusAndDirection("invested", "negative").map((item) =>
      item.kind
    ),
    ["pause_follow_on", "portfolio_risk_review"],
  );
});

test("renders compatibility text only from the typed action list", () => {
  const actions = actionsForDealStatusAndDirection("invested", "negative");

  assert.equal(
    renderRecommendedNextMove(actions),
    "Pause follow-on investment activity based on the cited evidence. Begin an internal portfolio-risk review based on the cited evidence.",
  );
});

test("company analysis compatibility sanitization ignores caller prose when typed actions exist", () => {
  const actions = actionsForDealStatusAndDirection("passed", "negative");

  assert.equal(sanitizeCompanyAnalysisNextStep({
    outcome: "belief_revised",
    value: "Reopen diligence and contact the founder.",
    actions,
  }), renderRecommendedNextMove(actions));
});
