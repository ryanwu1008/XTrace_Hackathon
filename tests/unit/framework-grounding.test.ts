import assert from "node:assert/strict";
import test from "node:test";

import type {
  Assumption,
  Calculation,
  EvidencePack,
  Fact,
} from "../../lib/contracts/evidence";
import type {
  CandidateRun,
  ResolvedUnderwritingContext,
} from "../../lib/contracts/underwriting";
import {
  buildFrameworkAbstention,
  groundFrameworkLensOutput,
} from "../../lib/underwriting/frameworks/grounding";
import {
  authorizedResearchComposites,
  loadResearchFrameworkCatalog,
} from "../../lib/underwriting/frameworks/research-loader";
import {
  ClaudeFrameworkLensOutputSchema,
} from "../../lib/underwriting/frameworks/schemas";
import { SYNTHETIC_FRAMEWORK_PACK } from "../../seed/underwriting/framework-pack-v1";

const fact: Fact = {
  id: "fact_arr",
  analysisType: "fact",
  provenanceOrigin: "uploaded_document",
  field: "arr",
  value: "2400000",
  unit: "currency",
  currency: "USD",
  periodStart: "2025-01-01",
  periodEnd: "2025-12-31",
  publishedAt: null,
  eventAt: "2025-12-31T23:59:59.000Z",
  retrievedAt: "2026-07-29T10:00:00.000Z",
  sourceRevisionId: "revision_1",
  locator: {
    kind: "text_range",
    start: 0,
    end: 12,
    excerpt: "ARR $2.4m.",
  },
  sourceRole: "management",
  assertionStatus: "reported",
  verificationMethod: null,
  freshness: "current",
  acceptedForGate: true,
};

const assumption: Assumption = {
  id: "assumption_benchmark",
  analysisType: "assumption",
  provenanceOrigin: "benchmark",
  scenario: "all",
  field: "compatible_benchmark_value",
  value: "24000000",
  unit: "USD",
  rationale: "Published compatible benchmark.",
  inputRefIds: ["benchmark_pack_1"],
  sensitivity: "high",
  requiresConfirmation: false,
};

const calculation: Calculation = {
  id: "calculation_pricing_premium",
  analysisType: "calculation",
  formulaId: "pricing_premium",
  formulaVersion: "1",
  inputRefs: [
    { itemId: fact.id, value: fact.value, type: "fact" },
    {
      itemId: assumption.id,
      value: assumption.value,
      type: "benchmark",
    },
  ],
  output: "-0.9",
  unit: "decimal",
  currency: null,
  period: null,
  roundingPolicy: "half_even_display_only",
  computedAt: "2026-07-29T10:05:00.000Z",
  status: "completed",
};

const pack: EvidencePack = {
  id: "evidence_pack_1",
  version: 1,
  workspaceId: "workspace_1",
  dealId: "deal_1",
  asOfDate: "2026-07-29",
  sourceRevisionIds: ["revision_1"],
  facts: [fact],
  assumptions: [assumption],
  conflicts: [],
  coverage: {
    minimumModelInputsComplete: true,
    criticalEvidenceComplete: true,
    missingFieldIds: [],
    blockingConflictIds: [],
    decisionCeiling: "Invest Candidate",
    underwritingStatus: "available",
    reasonCodes: [],
  },
  createdAt: "2026-07-29T10:01:00.000Z",
};

const candidate: CandidateRun = {
  id: "candidate_1",
  batchId: "batch_1",
  workspaceId: "workspace_1",
  dealId: "deal_1",
  status: "running",
  candidateAnalysisFingerprint: "candidate-fingerprint-1",
  rerunOfId: null,
  createdAt: "2026-07-29T10:02:00.000Z",
  finalizedAt: null,
};

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
  frameworkPackId: "framework_pack_synthetic_universal_saas_ai_v1",
};

function output() {
  const card = SYNTHETIC_FRAMEWORK_PACK.cards[0]!;
  return {
    applicability: "applicable" as const,
    conclusion: "supportive" as const,
    supportEvidenceItemIds: [fact.id],
    counterEvidenceItemIds: [assumption.id],
    unusedEvidenceItemIds: [],
    strongestSupport: "The source Fact supports the criterion.",
    strongestCounterargument:
      "The benchmark Assumption is a meaningful counterpoint.",
    unknowns: ["Independent customer verification remains unknown."],
    limitations: ["The synthetic lens carries no formal decision weight."],
    confidence: {
      sourceReliability: "medium" as const,
      evidenceStrength: "medium" as const,
      evidenceCoverage: "medium" as const,
      applicability: "high" as const,
      judgment: "medium" as const,
    },
    frameworkRuleRefs: [card.id],
  };
}

test("the strict Claude lens schema has no decision or recalculation output", () => {
  assert.throws(() =>
    ClaudeFrameworkLensOutputSchema.parse({
      ...output(),
      decision: "Invest Candidate",
    })
  );
  assert.throws(() =>
    ClaudeFrameworkLensOutputSchema.parse({
      ...output(),
      calculatedValue: "999999999",
    })
  );
  assert.throws(() =>
    ClaudeFrameworkLensOutputSchema.parse({
      ...output(),
      unknowns: [],
    })
  );
  assert.throws(() =>
    ClaudeFrameworkLensOutputSchema.parse({
      ...output(),
      counterEvidenceItemIds: [],
      strongestCounterargument: null,
    })
  );
});

test("grounds every persisted judgment edge in the exact pack and card", () => {
  const card = SYNTHETIC_FRAMEWORK_PACK.cards[0]!;
  const judgment = groundFrameworkLensOutput({
    candidate,
    pack,
    card,
    calculations: [calculation],
    fingerprint: "sha256:grounded",
    output: output(),
  });

  assert.deepEqual(judgment.supportEvidenceItemIds, [fact.id]);
  assert.deepEqual(judgment.counterEvidenceItemIds, [assumption.id]);
  assert.deepEqual(judgment.claimEdges, [
    {
      claimItemId: judgment.id,
      dependencyItemId: assumption.id,
      dependencyType: "assumption",
    },
    {
      claimItemId: judgment.id,
      dependencyItemId: fact.id,
      dependencyType: "fact",
    },
    {
      claimItemId: judgment.id,
      dependencyItemId: card.id,
      dependencyType: "framework_ref",
    },
  ]);

  assert.throws(() =>
    groundFrameworkLensOutput({
      candidate,
      pack,
      card,
      calculations: [calculation],
      fingerprint: "sha256:ungrounded",
      output: {
        ...output(),
        supportEvidenceItemIds: ["invented_fact"],
        unusedEvidenceItemIds: [fact.id],
      },
    })
  , /outside the allowed immutable inputs/i);
});

test("only the Valuation lens may cite an already-saved Calculation", () => {
  const ordinaryCard = SYNTHETIC_FRAMEWORK_PACK.cards[0]!;
  const valuationCard = SYNTHETIC_FRAMEWORK_PACK.cards[7]!;
  const calculationOutput = {
    ...output(),
    supportEvidenceItemIds: [calculation.id],
    counterEvidenceItemIds: [assumption.id],
    unusedEvidenceItemIds: [fact.id],
    frameworkRuleRefs: [valuationCard.id],
  };

  assert.throws(() =>
    groundFrameworkLensOutput({
      candidate,
      pack,
      card: ordinaryCard,
      calculations: [calculation],
      fingerprint: "sha256:ordinary",
      output: {
        ...calculationOutput,
        frameworkRuleRefs: [ordinaryCard.id],
      },
    })
  , /outside the allowed immutable inputs/i);

  const judgment = groundFrameworkLensOutput({
    candidate,
    pack,
    card: valuationCard,
    calculations: [calculation],
    fingerprint: "sha256:valuation",
    output: calculationOutput,
  });
  assert.equal(
    judgment.claimEdges.some((edge) =>
      edge.dependencyItemId === calculation.id
      && edge.dependencyType === "calculation"
    ),
    true,
  );
});

test("persists complete loader-owned advisory metadata beside a grounded real pack opinion", async () => {
  const catalog = await loadResearchFrameworkCatalog({
    context,
  });
  const card = authorizedResearchComposites(catalog).find(
    ({ experimentalAdvisory }) =>
      experimentalAdvisory.packId
        === "peter_thiel_public_frameworks_v0_1",
  );
  assert.ok(card);
  const judgment = groundFrameworkLensOutput({
    candidate,
    pack,
    card,
    calculations: [calculation],
    fingerprint: "sha256:real-pack-grounded",
    output: {
      ...output(),
      strongestSupport:
        "fact_arr supports a testable, value-linked company premise.",
      strongestCounterargument:
        "assumption_benchmark remains an unverified external comparison.",
      unknowns: [
        "Whether customer evidence falsifies the core company premise.",
      ],
      limitations: [
        "This opinion is experimental and cannot alter the formal decision.",
      ],
      frameworkRuleRefs: [card.id],
      counterevidenceBoundary: {
        kind: "grounded_counterevidence",
        evidenceRequestRefs: [],
      },
    },
  });

  assert.deepEqual(
    judgment.frameworkMetadata,
    card.experimentalAdvisory,
  );
  assert.equal(
    judgment.frameworkMetadata?.componentCardIds.includes("PT-01"),
    true,
  );
  assert.match(
    judgment.frameworkMetadata?.components.find(
      ({ frameworkId }) => frameworkId === "PT-01",
    )?.neutralParaphrase ?? "",
    /testable/i,
  );
  assert.deepEqual(
    judgment.frameworkMetadata?.components.find(
      ({ frameworkId }) => frameworkId === "PT-01",
    )?.sourceRefs[0]?.locator,
    {
      kind: "web_section",
      value: "Three questions and contrarian/business question",
    },
  );
  assert.equal(
    judgment.frameworkMetadata?.sources.some(
      ({ sourceId, url }) =>
        sourceId === "PT-P2-CS183-01"
        && url.includes("blakemasters.tumblr.com"),
    ),
    true,
  );
  assert.deepEqual(judgment.supportEvidenceItemIds, [fact.id]);
  assert.deepEqual(judgment.counterEvidenceItemIds, [assumption.id]);
  assert.deepEqual(judgment.unknowns, [
    "Whether customer evidence falsifies the core company premise.",
  ]);
  assert.equal(
    judgment.limitations.some((item) =>
      item.includes("cannot alter the formal decision")
    ),
    true,
  );
  assert.deepEqual(
    judgment.claimEdges.filter(
      ({ dependencyType }) => dependencyType === "framework_ref",
    ),
    [{
      claimItemId: judgment.id,
      dependencyItemId: card.id,
      dependencyType: "framework_ref",
    }],
  );

  const unavailable = buildFrameworkAbstention({
    candidate,
    pack,
    card,
    calculations: [calculation],
    fingerprint: "sha256:real-pack-unavailable",
    applicability: "unavailable",
    reason: "The one permitted advisory attempt returned invalid JSON.",
    retainAdvisoryMetadata: true,
  });
  assert.deepEqual(
    unavailable.frameworkMetadata,
    card.experimentalAdvisory,
  );
  assert.equal(unavailable.conclusion, "abstain");
});
