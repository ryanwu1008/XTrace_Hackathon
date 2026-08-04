import assert from "node:assert/strict";
import test from "node:test";

import type {
  FrameworkJudgment,
  ResolvedUnderwritingContext,
} from "../../lib/contracts/underwriting";
import {
  buildFrameworkDisagreements,
} from "../../lib/underwriting/frameworks/disagreements";
import {
  authorizedResearchComposites,
  loadResearchFrameworkCatalog,
} from "../../lib/underwriting/frameworks/research-loader";
import { SYNTHETIC_FRAMEWORK_PACK } from "../../seed/underwriting/framework-pack-v1";

const marketCard = SYNTHETIC_FRAMEWORK_PACK.cards[0]!;
const valuationCard = SYNTHETIC_FRAMEWORK_PACK.cards[7]!;

function judgment(input: {
  id: string;
  cardId: string;
  conclusion: "supportive" | "negative";
  supportIds: string[];
  counterIds: string[];
}): FrameworkJudgment {
  return {
    id: input.id,
    analysisType: "framework_judgment",
    frameworkCardId: input.cardId,
    frameworkVersion: "1",
    applicability: "applicable",
    conclusion: input.conclusion,
    supportEvidenceItemIds: input.supportIds,
    counterEvidenceItemIds: input.counterIds,
    unusedEvidenceItemIds: [],
    strongestSupport: "Grounded strongest support.",
    strongestCounterargument: "Grounded strongest counterargument.",
    unknowns: ["One material unknown remains."],
    limitations: ["Synthetic framework fixture only."],
    confidence: {
      sourceReliability: "medium",
      evidenceStrength: "medium",
      evidenceCoverage: "medium",
      applicability: "high",
      judgment: "medium",
    },
    claimEdges: [],
    fingerprint: `sha256:${input.id}`,
  };
}

test("preserves opposing company-quality and price judgments as one deterministic disagreement", () => {
  const companyQuality = judgment({
    id: "judgment_company_quality",
    cardId: marketCard.id,
    conclusion: "supportive",
    supportIds: ["fact_market"],
    counterIds: ["fact_adoption_unknown"],
  });
  const price = judgment({
    id: "judgment_price",
    cardId: valuationCard.id,
    conclusion: "negative",
    supportIds: ["calculation_pricing_premium"],
    counterIds: ["assumption_benchmark"],
  });
  const original = structuredClone([companyQuality, price]);

  const forward = buildFrameworkDisagreements({
    judgments: [companyQuality, price],
    cards: [marketCard, valuationCard],
  });
  const reversed = buildFrameworkDisagreements({
    judgments: [price, companyQuality],
    cards: [valuationCard, marketCard],
  });

  assert.deepEqual(forward, reversed);
  assert.deepEqual([companyQuality, price], original);
  assert.equal(forward.length, 1);
  assert.deepEqual(
    {
      leftJudgmentId: forward[0]?.leftJudgmentId,
      rightJudgmentId: forward[0]?.rightJudgmentId,
      topic: forward[0]?.topic,
      evidenceItemIds: forward[0]?.evidenceItemIds,
    },
    {
      leftJudgmentId: companyQuality.id,
      rightJudgmentId: price.id,
      topic: "company_quality_vs_price",
      evidenceItemIds: [
        "assumption_benchmark",
        "calculation_pricing_premium",
        "fact_adoption_unknown",
        "fact_market",
      ],
    },
  );
  assert.match(forward[0]?.explanation ?? "", /supportive/i);
  assert.match(forward[0]?.explanation ?? "", /negative/i);
  assert.doesNotMatch(forward[0]?.explanation ?? "", /average|blended score/i);
});

test("preserves every opposing named advisory opinion as an independent framework conflict", async () => {
  const context: ResolvedUnderwritingContext = {
    id: "underwriting_context_seed_b2b_saas_v1",
    contextVersion: "1",
    stage: "seed",
    businessModel: "b2b_saas",
    geography: "us",
    securityType: "preferred",
    asOfDate: "2026-07-29",
    criticalEvidenceProfileId: "critical_evidence_seed_b2b_saas_v1",
    benchmarkPackId: "benchmark_pack_synthetic_us_software_v1",
    benchmarkCompatibility: "exact",
    valuationMethodPolicyId: "valuation_method_seed_b2b_saas_v1",
    decisionPolicyId: "decision_policy_seed_b2b_saas_v1",
    frameworkPackId: SYNTHETIC_FRAMEWORK_PACK.id,
  };
  const catalog = await loadResearchFrameworkCatalog({
    context,
  });
  const cards = authorizedResearchComposites(catalog).filter(
    ({ experimentalAdvisory }) => experimentalAdvisory.applicable,
  );
  const billGurley = cards.find(({ experimentalAdvisory }) =>
    experimentalAdvisory.packId === "bill_gurley_public_frameworks_v0_1"
  );
  const peterThiel = cards.find(({ experimentalAdvisory }) =>
    experimentalAdvisory.packId === "peter_thiel_public_frameworks_v0_1"
  );
  assert.ok(billGurley);
  assert.ok(peterThiel);
  const gurleyJudgment: FrameworkJudgment = {
    ...judgment({
      id: "judgment_bill_gurley",
      cardId: billGurley.id,
      conclusion: "negative",
      supportIds: ["fact_customer_retention"],
      counterIds: ["assumption_cohort_quality"],
    }),
    frameworkMetadata: billGurley.experimentalAdvisory,
  };
  const thielJudgment: FrameworkJudgment = {
    ...judgment({
      id: "judgment_peter_thiel",
      cardId: peterThiel.id,
      conclusion: "supportive",
      supportIds: ["fact_contrarian_thesis"],
      counterIds: ["assumption_adoption"],
    }),
    frameworkMetadata: peterThiel.experimentalAdvisory,
  };
  const original = structuredClone([gurleyJudgment, thielJudgment]);

  const forward = buildFrameworkDisagreements({
    judgments: [gurleyJudgment, thielJudgment],
    cards: [billGurley, peterThiel],
  });
  const reversed = buildFrameworkDisagreements({
    judgments: [thielJudgment, gurleyJudgment],
    cards: [peterThiel, billGurley],
  });

  assert.deepEqual(forward, reversed);
  assert.deepEqual([gurleyJudgment, thielJudgment], original);
  assert.equal(forward.length, 1);
  assert.deepEqual(
    {
      leftJudgmentId: forward[0]?.leftJudgmentId,
      rightJudgmentId: forward[0]?.rightJudgmentId,
      topic: forward[0]?.topic,
      evidenceItemIds: forward[0]?.evidenceItemIds,
    },
    {
      leftJudgmentId: gurleyJudgment.id,
      rightJudgmentId: thielJudgment.id,
      topic: "independent_framework_conflict",
      evidenceItemIds: [
        "assumption_adoption",
        "assumption_cohort_quality",
        "fact_contrarian_thesis",
        "fact_customer_retention",
      ],
    },
  );
  assert.match(forward[0]?.explanation ?? "", /Bill Gurley/i);
  assert.match(forward[0]?.explanation ?? "", /Peter Thiel/i);
  assert.match(forward[0]?.explanation ?? "", /negative/i);
  assert.match(forward[0]?.explanation ?? "", /supportive/i);
  assert.doesNotMatch(
    forward[0]?.explanation ?? "",
    /average|blend|consensus score/i,
  );
});

test("orders advisory conflicts by framework semantics instead of run-scoped judgment ids", async () => {
  const context: ResolvedUnderwritingContext = {
    id: "underwriting_context_seed_b2b_saas_v1",
    contextVersion: "1",
    stage: "seed",
    businessModel: "b2b_saas",
    geography: "us",
    securityType: "preferred",
    asOfDate: "2026-07-29",
    criticalEvidenceProfileId: "critical_evidence_seed_b2b_saas_v1",
    benchmarkPackId: "benchmark_pack_synthetic_us_software_v1",
    benchmarkCompatibility: "exact",
    valuationMethodPolicyId: "valuation_method_seed_b2b_saas_v1",
    decisionPolicyId: "decision_policy_seed_b2b_saas_v1",
    frameworkPackId: SYNTHETIC_FRAMEWORK_PACK.id,
  };
  const cards = authorizedResearchComposites(
    await loadResearchFrameworkCatalog({ context }),
  )
    .filter(({ experimentalAdvisory }) => experimentalAdvisory.applicable)
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, 3);
  assert.equal(cards.length, 3);

  const buildJudgments = (ids: readonly string[]) => cards.map((card, index) => ({
    ...judgment({
      id: ids[index]!,
      cardId: card.id,
      conclusion: index === 1 ? "negative" : "supportive",
      supportIds: [`fact_${index}`],
      counterIds: [`assumption_${index}`],
    }),
    frameworkMetadata: card.experimentalAdvisory,
  }));
  const first = buildFrameworkDisagreements({
    judgments: buildJudgments(["judgment_z", "judgment_m", "judgment_a"]),
    cards,
  });
  const second = buildFrameworkDisagreements({
    judgments: buildJudgments(["judgment_a", "judgment_m", "judgment_z"]),
    cards,
  });

  assert.deepEqual(
    first.map(({ topic, explanation }) => ({ topic, explanation })),
    second.map(({ topic, explanation }) => ({ topic, explanation })),
  );
});
