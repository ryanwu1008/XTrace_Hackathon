import assert from "node:assert/strict";
import test from "node:test";

import type { EvidencePack, Fact, Assumption } from "../../lib/contracts/evidence";
import type {
  CandidateRun,
  FrameworkJudgment,
} from "../../lib/contracts/underwriting";
import {
  NAMED_LENS_GENERATOR_VERSION,
} from "../../lib/contracts/named-lens";
import {
  groundNamedLensPassage,
} from "../../lib/underwriting/frameworks/passage-grounding";
import {
  authorizedResearchComposites,
  loadResearchFrameworkCatalog,
} from "../../lib/underwriting/frameworks/research-loader";
import {
  ClaudeAdvisoryFrameworkLensOutputSchema,
  NamedLensPassageCandidateSchema,
  type NamedLensPassageCandidate,
} from "../../lib/underwriting/frameworks/schemas";

const context = {
  id: "underwriting_context_seed_b2b_saas_v1",
  contextVersion: "1",
  stage: "seed" as const,
  businessModel: "b2b_saas" as const,
  geography: "us" as const,
  securityType: "preferred" as const,
  asOfDate: "2026-07-29",
  criticalEvidenceProfileId: "critical_evidence_seed_b2b_saas_v1",
  benchmarkPackId: "benchmark_pack_synthetic_us_software_v1",
  benchmarkCompatibility: "exact" as const,
  valuationMethodPolicyId: "valuation_method_seed_b2b_saas_v1",
  decisionPolicyId: "decision_policy_seed_b2b_saas_v1",
  frameworkPackId: "framework_pack_synthetic_universal_saas_ai_v1",
};
const catalog = await loadResearchFrameworkCatalog({ context });
const card = (() => {
  const found = authorizedResearchComposites(catalog).find(
    ({ experimentalAdvisory }) => experimentalAdvisory.applicable,
  );
  if (!found) throw new Error("Expected an applicable advisory Card.");
  return found;
})();
const binding = card.experimentalAdvisory.decisionTaxonomyBindings[0]!;
const component = (() => {
  const found = card.experimentalAdvisory.components.find(
    ({ frameworkId }) => frameworkId === binding.frameworkId,
  );
  if (!found) throw new Error("Expected the bound advisory component.");
  return found;
})();
const sourceRef = component.sourceRefs[0]!;

const supportFact: Fact = {
  id: "fact_critical_retention",
  analysisType: "fact",
  provenanceOrigin: "uploaded_document",
  field: "retention",
  value: "0.94",
  unit: "decimal",
  currency: null,
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
    excerpt: "Retention 94%.",
  },
  sourceRole: "management",
  assertionStatus: "reported",
  verificationMethod: null,
  freshness: "current",
  acceptedForGate: true,
};
const contextFact: Fact = {
  ...supportFact,
  id: "fact_context_growth",
  field: "growth",
  value: "0.41",
  sourceRevisionId: "revision_2",
  locator: {
    kind: "text_range",
    start: 12,
    end: 23,
    excerpt: "Growth 41%.",
  },
};
const counterAssumption: Assumption = {
  id: "assumption_cohort_quality",
  analysisType: "assumption",
  provenanceOrigin: "benchmark",
  scenario: "all",
  field: "cohort_quality",
  value: "unverified",
  unit: "status",
  rationale: "Independent cohort evidence is not yet available.",
  inputRefIds: [supportFact.id],
  sensitivity: "high",
  requiresConfirmation: true,
};
const pack: EvidencePack = {
  id: "evidence_pack_1",
  version: 1,
  workspaceId: "workspace_1",
  dealId: "deal_1",
  asOfDate: "2026-07-29",
  sourceRevisionIds: ["revision_1", "revision_2"],
  facts: [supportFact, contextFact],
  assumptions: [counterAssumption],
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
const judgmentId = "framework_judgment:candidate_1:advisory:grounded";
const groundedCounterevidenceBoundary = {
  kind: "grounded_counterevidence" as const,
  evidenceRequestRefs: [] as string[],
};
const judgment: FrameworkJudgment = {
  id: judgmentId,
  analysisType: "framework_judgment",
  frameworkCardId: card.id,
  frameworkVersion: card.version,
  applicability: "applicable",
  conclusion: "supportive",
  supportEvidenceItemIds: [supportFact.id, contextFact.id].sort(),
  counterEvidenceItemIds: [counterAssumption.id],
  unusedEvidenceItemIds: [],
  strongestSupport: "The saved company evidence supports the premise.",
  strongestCounterargument: "Independent cohort quality remains unverified.",
  unknowns: ["Whether independent cohorts confirm the reported retention."],
  limitations: ["The evidence is company-reported."],
  confidence: {
    sourceReliability: "medium",
    evidenceStrength: "medium",
    evidenceCoverage: "medium",
    applicability: "high",
    judgment: "medium",
  },
  claimEdges: [supportFact.id, contextFact.id, counterAssumption.id].sort()
    .map((dependencyItemId) => ({
      claimItemId: judgmentId,
      dependencyItemId,
      dependencyType: dependencyItemId.startsWith("assumption_")
        ? "assumption" as const
        : "fact" as const,
    })),
  frameworkMetadata: card.experimentalAdvisory,
  counterevidenceBoundary: groundedCounterevidenceBoundary,
  fingerprint: "sha256:judgment",
};

function passage(): NamedLensPassageCandidate {
  return {
    focus: {
      componentFrameworkId: component.frameworkId,
      componentVersion: component.version,
      cardFieldRef: binding.cardFieldRef,
      decisionQuestionCode: binding.decisionQuestionCode,
      evidenceDomainCodes: [...binding.evidenceDomainCodes].sort(),
    },
    premise: {
      text: "VSee applies the public framework premise to a testable company question.",
      componentFrameworkId: component.frameworkId,
      componentVersion: component.version,
      cardFieldRef: binding.cardFieldRef,
      publicSourceIds: [sourceRef.sourceId],
      claimIds: [...sourceRef.claimIds].sort(),
      locator: sourceRef.locator,
      attributionScope: sourceRef.attributionScope,
    },
    caseApplication: {
      text: "The reported retention and growth support the premise through observed company performance.",
      evidenceItemIds: [supportFact.id, contextFact.id].sort(),
    },
    countercase: {
      text: "The unverified cohort assumption limits confidence in durability.",
      boundaryKind: "grounded_counterevidence",
      evidenceItemIds: [counterAssumption.id],
      evidenceRequestRefs: [],
    },
    unknownBoundary: {
      text: "Independent cohort evidence would resolve the saved unknown.",
      judgmentUnknownRefs: [...judgment.unknowns],
      judgmentLimitationRefs: [],
      evidenceRequestRefs: [],
    },
    conditionalConclusion: {
      text: "The framework supports further diligence if independent cohorts confirm durability.",
      stance: "supportive",
      advisoryPosture: "supports_further_diligence",
    },
    advisoryContract: {
      formalDecisionWeight: "0",
      noEndorsement: true,
      namedPersonImpersonation: false,
      hiddenChainOfThought: false,
    },
  };
}

function grounded(candidatePassage: unknown, savedJudgment = judgment) {
  return groundNamedLensPassage({
    candidate,
    pack,
    card,
    judgment: savedJudgment,
    candidatePassage,
    generatorVersion: NAMED_LENS_GENERATOR_VERSION,
  });
}

function advisoryOutput() {
  return {
    applicability: "applicable",
    conclusion: "supportive",
    supportEvidenceItemIds: [...judgment.supportEvidenceItemIds],
    counterEvidenceItemIds: [...judgment.counterEvidenceItemIds],
    unusedEvidenceItemIds: [...judgment.unusedEvidenceItemIds],
    strongestSupport: judgment.strongestSupport,
    strongestCounterargument: judgment.strongestCounterargument,
    unknowns: [...judgment.unknowns],
    limitations: [...judgment.limitations],
    confidence: judgment.confidence,
    frameworkRuleRefs: [card.id],
    counterevidenceBoundary: groundedCounterevidenceBoundary,
    passage: passage(),
  };
}

test("the advisory output schema requires one complete passage without weakening the core judgment shape", () => {
  assert.doesNotThrow(() =>
    ClaudeAdvisoryFrameworkLensOutputSchema.parse(advisoryOutput())
  );
  const missing = advisoryOutput() as Record<string, unknown>;
  delete missing.passage;
  assert.throws(() => ClaudeAdvisoryFrameworkLensOutputSchema.parse(missing));

  const wrongBoundary = advisoryOutput() as Record<string, unknown>;
  wrongBoundary.counterevidenceBoundary = {
    kind: "no_candidate_local_counterevidence",
    evidenceRequestRefs: ["request_foreign"],
  };
  assert.throws(() =>
    ClaudeAdvisoryFrameworkLensOutputSchema.parse(wrongBoundary)
  , /counterevidence|boundary/i);
});

test("the provider candidate requires all five plain-text segments and rejects HTML or Markdown", () => {
  const missing = structuredClone(passage()) as Record<string, unknown>;
  delete missing.countercase;
  assert.throws(() => NamedLensPassageCandidateSchema.parse(missing));

  for (const text of [
    "<p>Rendered HTML is forbidden.</p>",
    "## Markdown heading",
    "[linked prose](https://example.com)",
  ]) {
    assert.throws(() => NamedLensPassageCandidateSchema.parse({
      ...passage(),
      premise: { ...passage().premise, text },
    }), /plain text/i);
  }
});

test("grounds a complete passage candidate without accepting a model-authored selection basis", () => {
  const result = grounded(passage());
  assert.equal(result.status, "validated");
  if (result.status !== "validated") return;
  assert.equal("selectionBasisEvidenceIds" in result.groundedCandidate, false);
  assert.equal(
    result.groundedCandidate.wordCount,
    [
      passage().premise.text,
      passage().caseApplication.text,
      passage().countercase.text,
      passage().unknownBoundary.text,
      passage().conditionalConclusion.text,
    ].join(" ").trim().split(/\s+/u).length,
  );
  assert.equal(
    result.authorizedFocus.compositeFrameworkCardId,
    judgment.frameworkCardId,
  );
  assert.deepEqual(result.authorizedFocus.binding, binding);
});

test("withholds exact component/Card-field and public-source/claim mismatches", () => {
  const wrongField = passage();
  wrongField.focus.cardFieldRef = "decisionQuestions[999]";
  wrongField.premise.cardFieldRef = "decisionQuestions[999]";
  assert.equal(grounded(wrongField).status, "withheld");

  const wrongComponent = passage();
  wrongComponent.focus.componentFrameworkId = "FOREIGN-01";
  wrongComponent.premise.componentFrameworkId = "FOREIGN-01";
  assert.equal(grounded(wrongComponent).status, "withheld");

  const wrongClaim = passage();
  wrongClaim.premise.claimIds = [...wrongClaim.premise.claimIds, "foreign_claim"]
    .sort();
  const result = grounded(wrongClaim);
  assert.equal(result.status, "withheld");
  if ("reasonCode" in result) {
    assert.equal(result.reasonCode, "foreign_passage_source");
  }
});

test("withholds foreign, mixed, and wrong-partition evidence without mutating the judgment", () => {
  for (const evidenceItemIds of [
    ["foreign_fact"],
    [supportFact.id, "foreign_fact"].sort(),
    [counterAssumption.id],
  ]) {
    const candidatePassage = passage();
    candidatePassage.caseApplication.evidenceItemIds = evidenceItemIds;
    const result = grounded(candidatePassage);
    assert.equal(result.status, "withheld");
    if ("reasonCode" in result) {
      assert.equal(
        result.reasonCode,
        evidenceItemIds.includes("foreign_fact")
          ? "foreign_passage_evidence"
          : "passage_partition_mismatch",
      );
    }
    assert.equal(judgment.applicability, "applicable");
    assert.deepEqual(judgment.supportEvidenceItemIds, [
      supportFact.id,
      contextFact.id,
    ].sort());
  }

  const wrongCounterPartition = passage();
  wrongCounterPartition.countercase.evidenceItemIds = [supportFact.id];
  const wrongCounter = grounded(wrongCounterPartition);
  assert.equal(wrongCounter.status, "withheld");
  if ("reasonCode" in wrongCounter) {
    assert.equal(wrongCounter.reasonCode, "passage_partition_mismatch");
  }
});

test("withholds stance/posture mismatches and unsafe action, voice, or quotation text", () => {
  const ordinaryVerbs = passage();
  ordinaryVerbs.caseApplication.text =
    "Observed gains may pass through to retained usage while teams watch independent cohorts.";
  assert.equal(grounded(ordinaryVerbs).status, "validated");

  const mismatch = passage();
  mismatch.conditionalConclusion.stance = "negative";
  mismatch.conditionalConclusion.advisoryPosture = "urges_caution";
  const mismatchResult = grounded(mismatch);
  assert.equal(mismatchResult.status, "withheld");
  if ("reasonCode" in mismatchResult) {
    assert.equal(mismatchResult.reasonCode, "passage_stance_mismatch");
  }

  const posture = passage();
  posture.conditionalConclusion.advisoryPosture = "urges_caution";
  const postureResult = grounded(posture);
  assert.equal(postureResult.status, "withheld");
  if ("reasonCode" in postureResult) {
    assert.equal(postureResult.reasonCode, "passage_posture_mismatch");
  }

  const unsafeCases = [
    ["The formal decision should be Invest Candidate.", "unsafe_passage_action"],
    ["The decision ceiling is Watch.", "unsafe_passage_action"],
    ["This framework creates a veto.", "unsafe_passage_action"],
    ["VSee should invest in this company.", "unsafe_passage_action"],
    ["The next step is advance_diligence.", "unsafe_passage_action"],
    ["The fund must continue monitoring this company.", "unsafe_passage_action"],
    ["The IC should advance diligence now.", "unsafe_passage_action"],
    ["VSee recommends buying this company.", "unsafe_passage_action"],
    ["The IC directs an investment.", "unsafe_passage_action"],
    ["This lens endorses the investment.", "unsafe_passage_voice"],
    ["Peter Thiel endorses this investment.", "unsafe_passage_voice"],
    ["Peter Thiel would reject the investment.", "unsafe_passage_voice"],
    ["Peter Thiel believes this company will win.", "unsafe_passage_voice"],
    ["I interpret this premise as contingent.", "unsafe_passage_voice"],
    ["We interpret this premise as contingent.", "unsafe_passage_voice"],
    ["The framework says “this company must win.”", "unsafe_passage_quote"],
  ] as const;
  for (const [text, reasonCode] of unsafeCases) {
    const unsafe = passage();
    unsafe.premise.text = text;
    const result = grounded(unsafe);
    assert.equal(result.status, "withheld");
    if ("reasonCode" in result) assert.equal(result.reasonCode, reasonCode);
  }

  for (const [action, humanized] of [
    ["advance_diligence", "advance internal diligence"],
    ["continue_monitoring", "continue internal monitoring"],
    ["deprioritize", "deprioritize this Deal"],
    ["reopen_diligence", "reopen internal diligence"],
    ["evaluate_follow_on", "evaluate a follow-on investment"],
    ["pause_follow_on", "pause follow-on investment activity"],
    ["portfolio_risk_review", "begin an internal portfolio-risk review"],
    ["no_new_action", "no new internal action"],
    ["review_analysis_failure", "review the analysis failure"],
  ] as const) {
    for (const phrase of [
      action,
      action.replaceAll("_", " "),
      humanized,
    ]) {
      const unsafe = passage();
      unsafe.premise.text = `The prescribed action is ${phrase}.`;
      const result = grounded(unsafe);
      assert.equal(result.status, "withheld", phrase);
      if ("reasonCode" in result) {
        assert.equal(result.reasonCode, "unsafe_passage_action", phrase);
      }
    }
  }
});

test("computes the exact five-segment Unicode-whitespace word count and withholds over 260 words", () => {
  const over = passage();
  over.caseApplication.text = Array.from({ length: 260 }, () => "word").join("\u00a0");
  const result = grounded(over);
  assert.equal(result.status, "withheld");
  if ("reasonCode" in result) {
    assert.equal(result.reasonCode, "passage_word_limit_exceeded");
  }
});

test("requires the saved no-counterevidence boundary and its exact evidence request", () => {
  const noCounterJudgment: FrameworkJudgment = {
    ...judgment,
    counterEvidenceItemIds: [],
    unusedEvidenceItemIds: [counterAssumption.id],
    strongestCounterargument: null,
    claimEdges: judgment.claimEdges.filter(
      ({ dependencyItemId }) => dependencyItemId !== counterAssumption.id,
    ),
    counterevidenceBoundary: {
      kind: "no_candidate_local_counterevidence",
      evidenceRequestRefs: ["evidence_request_independent_cohorts"],
    },
  };
  const validNoCounter = passage();
  validNoCounter.countercase = {
    text: "No candidate-local contrary item is saved; independent cohorts remain requested.",
    boundaryKind: "no_candidate_local_counterevidence",
    evidenceItemIds: [],
    evidenceRequestRefs: ["evidence_request_independent_cohorts"],
  };
  assert.equal(grounded(validNoCounter, noCounterJudgment).status, "validated");

  const missingBoundary = passage();
  const result = grounded(missingBoundary, noCounterJudgment);
  assert.equal(result.status, "withheld");
  if ("reasonCode" in result) {
    assert.equal(result.reasonCode, "counterevidence_boundary_mismatch");
  }
});
