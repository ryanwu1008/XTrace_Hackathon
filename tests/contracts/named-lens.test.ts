import assert from "node:assert/strict";
import test from "node:test";

import {
  DecisionCriticalEvidenceRefSchema,
  NAMED_LENS_PASSAGE_SCHEMA_VERSION,
  NAMED_LENS_SELECTION_POLICY_VERSION,
  NamedLensDispositionSchema,
  NamedLensPassageSchema,
  NamedLensPresentationSchema,
  NamedLensProviderAttemptSchema,
  UNDERWRITING_PRESENTATION_SCHEMA_VERSION,
} from "../../lib/contracts/named-lens";

const sha = (digit: string) => `sha256:${digit.repeat(64)}`;

const premise = {
  text: "The framework treats durable customer pull as stronger than launch activity.",
  componentFrameworkId: "MA-01-PRODUCT-MARKET-FIT",
  componentVersion: "1.0.0",
  cardFieldRef: "decisionQuestions[0]",
  publicSourceIds: ["source_1"],
  claimIds: ["MA-CLM-001"],
  locator: { kind: "web_section", value: "Lines 10-20" },
  attributionScope: "person_direct",
};

const passage = {
  schemaVersion: NAMED_LENS_PASSAGE_SCHEMA_VERSION,
  workspaceId: "workspace_1",
  artifactSourceCandidateRunId: "candidate_1",
  judgmentId: "judgment_1",
  frameworkCardId: "MA-01-PRODUCT-MARKET-FIT",
  frameworkVersion: "1.0.0",
  decisionQuestionCode: "customer_adoption",
  evidenceDomainCodes: ["customer", "product"],
  premise,
  caseApplication: {
    text: "Renewal evidence supports customer pull, while the short cohort limits confidence.",
    evidenceItemIds: ["fact_1"],
  },
  countercase: {
    text: "The short cohort leaves durable retention unresolved.",
    boundaryKind: "grounded_counterevidence",
    evidenceItemIds: ["fact_2"],
    evidenceRequestRefs: [],
  },
  unknownBoundary: {
    text: "A longer renewal cohort would test whether the signal persists.",
    judgmentUnknownRefs: ["Net retention"],
    judgmentLimitationRefs: ["One quarter of cohort data"],
    evidenceRequestRefs: ["request_retention_cohort"],
  },
  conditionalConclusion: {
    text: "Further diligence is warranted if the next cohort confirms renewal durability.",
    stance: "supportive",
    advisoryPosture: "supports_further_diligence",
  },
  advisoryContract: {
    formalDecisionWeight: "0",
    noEndorsement: true,
    namedPersonImpersonation: false,
    hiddenChainOfThought: false,
  },
  selectionBasisEvidenceIds: ["fact_1", "fact_2"],
  wordCount: 72,
  generatorVersion: "named-lens-generator-v1",
  fingerprint: sha("1"),
};

const criticalEvidence = {
  evidencePackItemId: "fact_1",
  classification: "fact",
  originRefs: [{ kind: "fired_rule", id: "rule_1" }],
  reasonCodes: ["FORMAL_DECISION_RULE_INPUT"],
  resolutionPath: ["rule_1", "fact_1"],
};

const selected = {
  workspaceId: "workspace_1",
  artifactSourceCandidateRunId: "candidate_1",
  judgmentOrCatalogCandidateId: "judgment_1",
  judgmentId: "judgment_1",
  frameworkCardId: "MA-01-PRODUCT-MARKET-FIT",
  frameworkVersion: "1.0.0",
  disposition: "selected_main",
  selectedPosition: 1,
  priorityTier: "changed_belief",
  reasonCodes: ["CHANGED_BELIEF_EVIDENCE"],
  decisionQuestionCode: "customer_adoption",
  stance: "supportive",
  advisoryPosture: "supports_further_diligence",
  selectionBasisEvidenceIds: ["fact_1", "fact_2"],
  criticalEvidence: [
    criticalEvidence,
    {
      evidencePackItemId: "fact_2",
      classification: "fact",
      originRefs: [{ kind: "blocking_evidence", id: "fact_2" }],
      reasonCodes: ["FORMAL_DECISION_BLOCKER"],
      resolutionPath: ["fact_2"],
    },
  ],
  selectionPolicyVersion: NAMED_LENS_SELECTION_POLICY_VERSION,
  passageFingerprint: passage.fingerprint,
  fingerprint: sha("2"),
};

const appendix = {
  ...selected,
  judgmentOrCatalogCandidateId: "judgment_2",
  judgmentId: "judgment_2",
  disposition: "appendix_only",
  selectedPosition: null,
  priorityTier: "context_only",
  reasonCodes: ["CONTEXT_ONLY"],
  selectionBasisEvidenceIds: [],
  passageFingerprint: sha("3"),
  fingerprint: sha("4"),
};

const appendixPassage = {
  ...passage,
  judgmentId: "judgment_2",
  fingerprint: appendix.passageFingerprint,
};

const withheld = {
  ...selected,
  judgmentOrCatalogCandidateId: "judgment_3",
  judgmentId: "judgment_3",
  disposition: "withheld",
  selectedPosition: null,
  priorityTier: null,
  reasonCodes: ["FOREIGN_PASSAGE_EVIDENCE"],
  advisoryPosture: null,
  selectionBasisEvidenceIds: [],
  criticalEvidence: [],
  passageFingerprint: null,
  fingerprint: sha("5"),
};

const attempt = {
  workspaceId: "workspace_1",
  artifactSourceCandidateRunId: "candidate_1",
  judgmentOrCatalogCandidateId: "judgment_1",
  logicalPassageId: "judgment_1@named-lens-passage-v1@named-lens-generator-v1",
  attemptNumber: 1,
  attemptFingerprint: sha("6"),
  status: "completed",
  telemetry: {
    inputTokens: 500,
    outputTokens: 180,
    costUsd: "0.0042",
    latencyMs: 900,
  },
  failureReason: null,
};

const presentation = {
  schemaVersion: UNDERWRITING_PRESENTATION_SCHEMA_VERSION,
  rendererVersion: "named-lens-renderer-v1",
  workspaceId: "workspace_1",
  artifactSourceCandidateRunId: "candidate_1",
  synthesis: {
    branch: "single_perspective",
    text: "One source-grounded advisory perspective supports further diligence.",
    judgmentIds: ["judgment_1"],
    evidenceItemIds: ["fact_1"],
  },
  segmentCitations: [{
    judgmentId: "judgment_1",
    segment: "case_application",
    evidenceItemIds: ["fact_1"],
    publicSourceIds: [],
    claimIds: [],
  }],
  firstScreenProjectionRefs: {
    decisionId: "decision_1",
    decisionEvidenceItemIds: ["fact_1"],
    selectedJudgmentIds: ["judgment_1"],
  },
  fingerprint: sha("7"),
};

test("round-trips strict selected, appendix, attempt, and presentation artifacts", () => {
  assert.equal(
    NamedLensDispositionSchema.parse(selected).selectedPosition,
    1,
  );
  assert.equal(
    NamedLensDispositionSchema.parse(appendix).disposition,
    "appendix_only",
  );
  assert.deepEqual(
    NamedLensPassageSchema.parse(appendixPassage),
    appendixPassage,
  );
  assert.deepEqual(NamedLensProviderAttemptSchema.parse(attempt), attempt);
  assert.throws(() => NamedLensProviderAttemptSchema.parse({
    ...attempt,
    status: "failed",
    telemetry: null,
    failureReason: {
      code: "provider_error",
      detail: "Provider failed.",
      retryable: false,
    },
  }));
  assert.deepEqual(
    NamedLensPresentationSchema.parse(presentation),
    presentation,
  );
  assert.throws(() => NamedLensPresentationSchema.parse({
    ...presentation,
    undeclared: true,
  }));
});

test("only selected main dispositions carry a position or publishable passage", () => {
  assert.throws(() => NamedLensDispositionSchema.parse({
    ...selected,
    priorityTier: null,
  }));
  assert.throws(() => NamedLensDispositionSchema.parse({
    ...selected,
    selectionBasisEvidenceIds: [],
  }));
  assert.throws(() => NamedLensDispositionSchema.parse({
    ...withheld,
    selectedPosition: 1,
  }));
  assert.throws(() => NamedLensDispositionSchema.parse({
    ...appendix,
    selectedPosition: 7,
  }));
  assert.throws(() => NamedLensDispositionSchema.parse({
    ...withheld,
    bodyText: "Generic replacement prose is forbidden.",
  }));
  assert.throws(() => NamedLensDispositionSchema.parse({
    ...withheld,
    disposition: "unavailable",
    passageFingerprint: passage.fingerprint,
  }));
});

test("requires complete plain-text passage segment provenance", () => {
  assert.deepEqual(NamedLensPassageSchema.parse(passage), passage);
  assert.throws(() => NamedLensPassageSchema.parse({
    ...passage,
    caseApplication: { ...passage.caseApplication, evidenceItemIds: [] },
  }));
  assert.throws(() => NamedLensPassageSchema.parse({
    ...passage,
    premise: { ...passage.premise, claimIds: [] },
  }));
  assert.throws(() => NamedLensPassageSchema.parse({
    ...passage,
    premise: { ...passage.premise, text: "**Unreviewed Markdown**" },
  }));
  assert.throws(() => NamedLensPassageSchema.parse({
    ...passage,
    advisoryContract: {
      ...passage.advisoryContract,
      formalDecisionWeight: "0.1",
    },
  }));
  assert.throws(() => NamedLensPassageSchema.parse({
    ...passage,
    countercase: {
      ...passage.countercase,
      boundaryKind: "no_candidate_local_counterevidence",
      evidenceItemIds: [],
      evidenceRequestRefs: [],
    },
  }));
});

test("requires canonical decision-critical and selection evidence IDs", () => {
  assert.deepEqual(
    DecisionCriticalEvidenceRefSchema.parse(criticalEvidence),
    criticalEvidence,
  );
  assert.throws(() => NamedLensPassageSchema.parse({
    ...passage,
    selectionBasisEvidenceIds: ["fact_2", "fact_1"],
  }));
  assert.throws(() => NamedLensPassageSchema.parse({
    ...passage,
    selectionBasisEvidenceIds: ["fact_1", "fact_1"],
  }));
  assert.throws(() => DecisionCriticalEvidenceRefSchema.parse({
    ...criticalEvidence,
    originRefs: [
      { kind: "fired_rule", id: "rule_2" },
      { kind: "fired_rule", id: "rule_1" },
    ],
  }));
});
