import assert from "node:assert/strict";
import test from "node:test";

import {
  candidateRunStatusForFinalization,
  createMemoryUnderwritingRunsRepository,
  createSupabaseUnderwritingRunsRepository,
} from "../../db/repositories/underwriting-runs";
import {
  createMemoryUnderwritingArtifactsRepository,
  createSupabaseUnderwritingArtifactsRepository,
  validateNamedLensFinalization,
  type CandidateArtifactBundle,
  type CandidateFinalization,
} from "../../db/repositories/underwriting-artifacts";
import * as underwritingArtifactsModule from
  "../../db/repositories/underwriting-artifacts";
import {
  createMemoryNamedLensArtifactsRepository,
  createSupabaseNamedLensArtifactsRepository,
} from
  "../../db/repositories/named-lens-artifacts";
import { createMemoryEvidencePacksRepository } from
  "../../db/repositories/evidence-packs";
import { createCurrentNamedLensFinalizationFixture } from
  "../helpers/current-named-lens-finalization";
import { createTestNamedLensCandidateLeaseAuthority } from
  "../helpers/named-lens-attempt-authority";
import type { EvidencePack } from "../../lib/contracts/evidence";
import type {
  DecisionResult,
  FrameworkJudgment,
  ResolvedUnderwritingContext,
} from "../../lib/contracts/underwriting";
import type {
  DecisionCriticalEvidenceProjection,
  NamedLensCatalogConsideration,
  NamedLensFinalizationDisposition,
  NamedLensPassage,
  NamedLensPresentation,
  NamedLensProviderAttempt,
  NamedLensProviderAttemptRef,
} from "../../lib/contracts/named-lens";
import {
  authorizedResearchComposites,
  loadResearchFrameworkCatalog,
} from "../../lib/underwriting/frameworks/research-loader";
import { createCanonicalFingerprint } from
  "../../lib/underwriting/fingerprints";
import { createNamedLensSemanticFingerprints } from
  "../../lib/underwriting/named-lens-presentation";

const sha = (digit: string) => `sha256:${digit.repeat(64)}`;

const researchContext: ResolvedUnderwritingContext = {
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
const researchCatalog = await loadResearchFrameworkCatalog({
  context: researchContext,
});
const advisoryCard = (() => {
  const card = authorizedResearchComposites(researchCatalog).find(
    ({ experimentalAdvisory }) =>
      experimentalAdvisory.components.length >= 2,
  );
  if (!card) throw new Error("Expected a multi-component advisory fixture.");
  return card;
})();
const advisoryMetadata = advisoryCard.experimentalAdvisory;
const premiseComponent = advisoryMetadata.components[0]!;
const premiseSourceRef = premiseComponent.sourceRefs[0]!;
const rankedJudgmentIds = [
  "judgment_z",
  "judgment_a",
  "judgment_m",
  "judgment_b",
] as const;

function currentArtifacts(count = 4) {
  const evidencePack = {
    workspaceId: "workspace_1",
    facts: Array.from({ length: 8 }, (_, index) => ({
      id: index < 4 ? `fact_${index + 1}` : `counter_${index - 3}`,
    })),
    assumptions: [],
  } as unknown as EvidencePack;
  const judgments = Array.from({ length: count }, (_, index) => {
    const ordinal = index + 1;
    return {
      id: rankedJudgmentIds[index]!,
      analysisType: "framework_judgment",
      frameworkCardId: advisoryCard.id,
      frameworkVersion: advisoryCard.version,
      applicability: "applicable",
      conclusion: ordinal % 2 === 0 ? "negative" : "supportive",
      supportEvidenceItemIds: [`fact_${ordinal}`],
      counterEvidenceItemIds: [`counter_${ordinal}`],
      unusedEvidenceItemIds: [],
      strongestSupport: "Saved support.",
      strongestCounterargument: "Saved countercase.",
      unknowns: [`Unknown ${ordinal}`],
      limitations: [`Limitation ${ordinal}`],
      confidence: {
        sourceReliability: "high",
        evidenceStrength: "high",
        evidenceCoverage: "high",
        applicability: "high",
        judgment: "high",
      },
      claimEdges: [],
      counterevidenceBoundary: {
        kind: "grounded_counterevidence",
        evidenceRequestRefs: [],
      },
      frameworkMetadata: advisoryMetadata,
      fingerprint: `judgment-${ordinal}`,
    } satisfies FrameworkJudgment;
  });
  const decisionCriticalEvidenceProjection = {
    id: "decision_critical_projection_1",
    workspaceId: "workspace_1",
    artifactSourceCandidateRunId: "candidate_1",
    evidenceRefs: Array.from({ length: count }, (_, index) => ({
      evidencePackItemId: `fact_${index + 1}`,
      classification: "fact" as const,
      originRefs: [{ kind: "fired_rule" as const, id: `rule_${index + 1}` }],
      reasonCodes: ["FORMAL_DECISION_RULE_INPUT"],
      resolutionPath: [`fact_${index + 1}`, `rule_${index + 1}`],
    })),
    fingerprint: sha("8"),
  } satisfies DecisionCriticalEvidenceProjection;
  const passages = judgments.slice(0, count).map((judgment, index) => ({
    schemaVersion: "named-lens-passage-v1",
    workspaceId: "workspace_1",
    artifactSourceCandidateRunId: "candidate_1",
    judgmentId: judgment.id,
    frameworkCardId: judgment.frameworkCardId,
    frameworkVersion: judgment.frameworkVersion,
    decisionQuestionCode: "customer_adoption",
    evidenceDomainCodes: ["customer"],
    premise: {
      text: "The public framework tests durable customer demand.",
      componentFrameworkId: premiseComponent.frameworkId,
      componentVersion: premiseComponent.version,
      cardFieldRef: "decisionQuestions[0]",
      publicSourceIds: [premiseSourceRef.sourceId],
      claimIds: premiseSourceRef.claimIds,
      locator: premiseSourceRef.locator,
      attributionScope: premiseSourceRef.attributionScope,
    },
    caseApplication: {
      text: "Saved company evidence applies the framework.",
      evidenceItemIds: [`fact_${index + 1}`],
    },
    countercase: {
      text: "Saved counterevidence limits the conclusion.",
      boundaryKind: "grounded_counterevidence",
      evidenceItemIds: [`counter_${index + 1}`],
      evidenceRequestRefs: [],
    },
    unknownBoundary: {
      text: "A saved unknown defines the diligence boundary.",
      judgmentUnknownRefs: [`Unknown ${index + 1}`],
      judgmentLimitationRefs: [`Limitation ${index + 1}`],
      evidenceRequestRefs: [],
    },
    conditionalConclusion: {
      text: "The view remains conditional on resolving the saved unknown.",
      stance: judgment.conclusion,
      advisoryPosture: judgment.conclusion === "negative"
        ? "urges_caution"
        : "supports_further_diligence",
    },
    advisoryContract: {
      formalDecisionWeight: "0",
      noEndorsement: true,
      namedPersonImpersonation: false,
      hiddenChainOfThought: false,
    },
    selectionBasisEvidenceIds: [`fact_${index + 1}`],
    wordCount: 45,
    generatorVersion: "named-lens-generator-v1",
    fingerprint: sha(String(index + 1)),
  } satisfies NamedLensPassage));
  const dispositions = passages.map((passage, index) => ({
    workspaceId: "workspace_1",
    artifactSourceCandidateRunId: "candidate_1",
    judgmentOrCatalogCandidateId: passage.judgmentId,
    judgmentId: passage.judgmentId,
    frameworkCardId: passage.frameworkCardId,
    frameworkVersion: passage.frameworkVersion,
    disposition: "selected_main",
    selectedPosition: index + 1,
    priorityTier: "changed_belief",
    reasonCodes: ["CHANGED_BELIEF_EVIDENCE"],
    decisionQuestionCode: "customer_adoption",
    stance: passage.conditionalConclusion.stance,
    advisoryPosture: passage.conditionalConclusion.advisoryPosture,
    selectionBasisEvidenceIds: passage.selectionBasisEvidenceIds,
    criticalEvidence: [{
      evidencePackItemId: `fact_${index + 1}`,
      classification: "fact",
      originRefs: [{ kind: "fired_rule", id: `rule_${index + 1}` }],
      reasonCodes: ["FORMAL_DECISION_RULE_INPUT"],
      resolutionPath: [`fact_${index + 1}`, `rule_${index + 1}`],
    }],
    selectionPolicyVersion: "named-lens-selection-v1",
    passageFingerprint: passage.fingerprint,
    fingerprint: sha(String(index + 5)),
    decisionCriticalEvidenceProjectionId:
      decisionCriticalEvidenceProjection.id,
    decisionCriticalEvidenceProjectionFingerprint:
      decisionCriticalEvidenceProjection.fingerprint,
  } satisfies NamedLensFinalizationDisposition));
  const catalogConsiderations = passages.map((passage, index) => ({
    workspaceId: "workspace_1",
    artifactSourceCandidateRunId: "candidate_1",
    judgmentOrCatalogCandidateId: passage.judgmentId,
    judgmentId: passage.judgmentId,
    frameworkCardId: passage.frameworkCardId,
    frameworkVersion: passage.frameworkVersion,
    initialDisposition: "judgment_eligible",
    reasonCodes: ["JUDGMENT_ELIGIBLE"],
    fingerprint: sha(String(index + 1)),
  } satisfies NamedLensCatalogConsideration));
  const attempts = passages.map((passage, index) => ({
    workspaceId: "workspace_1",
    artifactSourceCandidateRunId: "candidate_1",
    judgmentOrCatalogCandidateId: passage.judgmentId,
    logicalPassageId:
      `${passage.judgmentId}@named-lens-passage-v1@named-lens-generator-v1`,
    attemptNumber: 1,
    attemptFingerprint: sha(String(index + 1)),
    status: "completed",
    telemetry: {
      inputTokens: 100,
      outputTokens: 50,
      costUsd: "0.01",
      costUsdPricingVersion: "provider-test-pricing-v1",
      costUsdUnavailableReason: null,
      latencyMs: 100,
    },
    failureReason: null,
  } satisfies NamedLensProviderAttempt));
  const attemptRefs = attempts.map((attempt) => ({
    judgmentOrCatalogCandidateId: attempt.judgmentOrCatalogCandidateId,
    logicalPassageId: attempt.logicalPassageId,
    attemptNumber: attempt.attemptNumber,
    attemptFingerprint: attempt.attemptFingerprint,
  } satisfies NamedLensProviderAttemptRef));
  const segmentCitations: NamedLensPresentation["segmentCitations"] =
    passages.map((passage, index) => ({
      judgmentId: passage.judgmentId,
      segment: "case_application",
      evidenceItemIds: [`fact_${index + 1}`],
      publicSourceIds: [],
      claimIds: [],
      judgmentUnknownRefs: [],
      judgmentLimitationRefs: [],
      evidenceRequestRefs: [],
      stanceRefs: [],
      advisoryPostureRefs: [],
    }));
  segmentCitations.push({
    judgmentId: passages[0]!.judgmentId,
    segment: "unknown_boundary",
    evidenceItemIds: [],
    publicSourceIds: [],
    claimIds: [],
    judgmentUnknownRefs: passages[0]!.unknownBoundary.judgmentUnknownRefs,
    judgmentLimitationRefs: [],
    evidenceRequestRefs: [],
    stanceRefs: [],
    advisoryPostureRefs: [],
  }, {
    judgmentId: passages[0]!.judgmentId,
    segment: "conditional_conclusion",
    evidenceItemIds: [],
    publicSourceIds: [],
    claimIds: [],
    judgmentUnknownRefs: [],
    judgmentLimitationRefs: [],
    evidenceRequestRefs: [],
    stanceRefs: [passages[0]!.conditionalConclusion.stance],
    advisoryPostureRefs: [
      passages[0]!.conditionalConclusion.advisoryPosture,
    ],
  });
  const presentation = {
    schemaVersion: "decision-first-named-lens-v1",
    rendererVersion: "named-lens-renderer-v1",
    workspaceId: "workspace_1",
    artifactSourceCandidateRunId: "candidate_1",
    synthesis: {
      branch: "principal_disagreement",
      text: "The selected readings disagree on customer adoption.",
      judgmentIds: passages.map(({ judgmentId }) => judgmentId).toSorted(),
      evidenceItemIds: passages.map((_, index) => `fact_${index + 1}`),
    },
    segmentCitations,
    firstScreenProjectionRefs: {
      decisionId: "decision_1",
      decisionEvidenceItemIds: ["fact_1"],
      selectedJudgmentIds: passages.map(({ judgmentId }) => judgmentId),
    },
    fingerprint: sha("9"),
  } satisfies NamedLensPresentation;
  const decision = {
    id: "decision_1",
    firedRules: [{ inputRefs: ["fact_1"] }],
    blockingEvidenceItemIds: [],
    claimEdges: [],
  } as unknown as DecisionResult;
  return {
    workspaceId: "workspace_1",
    candidateRunId: "candidate_1",
    catalogConsiderations,
    decisionCriticalEvidenceProjection,
    attemptRefs,
    persistedAttempts: attempts,
    dispositions,
    passages,
    underwritingPresentationReportId: "report_1",
    presentation,
    terminalStatus: "completed" as const,
    terminalReasonCodes: [] as string[],
    generatorVersion: "named-lens-generator-v1",
    evidencePack,
    judgments,
    decision,
  };
}

test("requires settled persisted attempt rows that exactly cover provider execution", () => {
  const valid = currentArtifacts();
  assert.doesNotThrow(() => validateNamedLensFinalization(valid));
  assert.throws(() => validateNamedLensFinalization({
    ...valid,
    persistedAttempts: [{
      ...valid.persistedAttempts[0]!,
      workspaceId: "workspace_other",
    }, ...valid.persistedAttempts.slice(1)],
  }), /attempt|candidate|workspace|ownership/i);
  assert.throws(() => validateNamedLensFinalization({
    ...valid,
    persistedAttempts: valid.persistedAttempts.slice(1),
  }), /attempt|persisted|cover/i);
  assert.throws(() => validateNamedLensFinalization({
    ...valid,
    persistedAttempts: [{
      ...valid.persistedAttempts[0]!,
      status: "reserved",
      telemetry: null,
    }, ...valid.persistedAttempts.slice(1)],
  }), /attempt|settled|reserved/i);
  assert.throws(() => validateNamedLensFinalization({
    ...valid,
    attemptRefs: [],
  }), /attempt|cover/i);
  assert.throws(() => validateNamedLensFinalization({
    ...valid,
    persistedAttempts: valid.persistedAttempts.map((attempt) => ({
      ...attempt,
      status: "failed" as const,
      telemetry: null,
      failureReason: {
        code: "provider_error" as const,
        detail: "Provider failed.",
        retryable: false,
      },
    })),
  }), /completed attempt|publishable|passage/i);
});

test("requires explicit limited coverage for fewer applicable catalogs", () => {
  const onlyThree = currentArtifacts(3);
  assert.throws(
    () => validateNamedLensFinalization(onlyThree),
    /coverage|reason/i,
  );
  assert.doesNotThrow(() => validateNamedLensFinalization({
    ...onlyThree,
    terminalReasonCodes: ["limited_framework_coverage"],
  }));
  assert.throws(() => validateNamedLensFinalization({
    ...onlyThree,
    terminalStatus: "partial",
    terminalReasonCodes: ["named_lens_passage_attempts_exhausted"],
  }), /coverage|reason/i);
});

test("rejects an applicable advisory judgment omitted from the authorized catalog", () => {
  const onlyThree = currentArtifacts(3);
  const fourthJudgment = currentArtifacts(4).judgments[3]!;

  assert.throws(() => validateNamedLensFinalization({
    ...onlyThree,
    judgments: [...onlyThree.judgments, fourthJudgment],
    terminalReasonCodes: ["limited_framework_coverage"],
  }), /authoritative|catalog|judgment|coverage/i);
});

test("rejects equal-sized catalog substitution of advisory identity or version", () => {
  const valid = currentArtifacts();

  assert.throws(() => validateNamedLensFinalization({
    ...valid,
    catalogConsiderations: [{
      ...valid.catalogConsiderations[0]!,
      frameworkVersion: "framework-version-substitution",
    }, ...valid.catalogConsiderations.slice(1)],
  }), /authoritative|catalog|judgment|version/i);
});

test("resolves critical, passage, and disposition refs to the saved pack and judgment", () => {
  const valid = currentArtifacts();
  const duplicateReason = structuredClone(valid);
  duplicateReason.decisionCriticalEvidenceProjection.evidenceRefs[0]!
    .reasonCodes = [
      "FORMAL_DECISION_RULE_INPUT",
      "FORMAL_DECISION_RULE_INPUT",
    ];
  duplicateReason.dispositions[0]!.criticalEvidence[0]!.reasonCodes = [
    "FORMAL_DECISION_RULE_INPUT",
    "FORMAL_DECISION_RULE_INPUT",
  ];
  assert.throws(
    () => validateNamedLensFinalization(duplicateReason),
    /reason codes|unique|sorted/i,
  );
  assert.throws(() => validateNamedLensFinalization({
    ...valid,
    dispositions: [{
      ...valid.dispositions[0]!,
      criticalEvidence: [{
        ...valid.dispositions[0]!.criticalEvidence[0]!,
        classification: "assumption",
      }],
    }, ...valid.dispositions.slice(1)],
  }), /classification|evidence|pack/i);
  assert.throws(() => validateNamedLensFinalization({
    ...valid,
    passages: [{
      ...valid.passages[0]!,
      caseApplication: {
        ...valid.passages[0]!.caseApplication,
        evidenceItemIds: ["counter_1"],
      },
    }, ...valid.passages.slice(1)],
  }), /partition|support|judgment/i);
  assert.throws(() => validateNamedLensFinalization({
    ...valid,
    dispositions: [{
      ...valid.dispositions[0]!,
      judgmentId: valid.judgments[1]!.id,
    }, ...valid.dispositions.slice(1)],
  }), /catalog|judgment|identity/i);
  assert.throws(() => validateNamedLensFinalization({
    ...valid,
    passages: [{
      ...valid.passages[0]!,
      countercase: {
        ...valid.passages[0]!.countercase,
        boundaryKind: "no_candidate_local_counterevidence",
        evidenceItemIds: [],
        evidenceRequestRefs: ["foreign_request"],
      },
    }, ...valid.passages.slice(1)],
  }), /counterevidence|boundary|request|partition/i);
});

test("grounds premises in the exact advisory component card and source claim", () => {
  const valid = currentArtifacts();
  assert.doesNotThrow(() => validateNamedLensFinalization(valid));
  const secondComponent = advisoryMetadata.components[1]!;
  const invalidPremises = [
    {
      ...valid.passages[0]!.premise,
      componentFrameworkId: secondComponent.frameworkId,
    },
    {
      ...valid.passages[0]!.premise,
      componentVersion: "9.9.9",
    },
    {
      ...valid.passages[0]!.premise,
      cardFieldRef: "decisionQuestions[999]",
    },
    {
      ...valid.passages[0]!.premise,
      publicSourceIds: [secondComponent.sourceRefs[0]!.sourceId],
    },
    {
      ...valid.passages[0]!.premise,
      claimIds: ["FOREIGN-CLAIM"],
    },
    {
      ...valid.passages[0]!.premise,
      locator: { kind: "web_section" as const, value: "Foreign locator" },
    },
    {
      ...valid.passages[0]!.premise,
      attributionScope: "external_empirical" as const,
    },
  ];
  for (const premise of invalidPremises) {
    assert.throws(() => validateNamedLensFinalization({
      ...valid,
      passages: [{
        ...valid.passages[0]!,
        premise,
      }, ...valid.passages.slice(1)],
    }), /premise|component|source|claim|ground/i);
  }
});

test("resolves presentation refs to the exact decision, selections, passages, and pack", () => {
  const valid = currentArtifacts();
  assert.throws(() => validateNamedLensFinalization({
    ...valid,
    presentation: {
      ...valid.presentation,
      firstScreenProjectionRefs: {
        ...valid.presentation.firstScreenProjectionRefs,
        decisionId: "decision_foreign",
      },
    },
  }), /presentation|decision/i);
  assert.throws(() => validateNamedLensFinalization({
    ...valid,
    presentation: {
      ...valid.presentation,
      synthesis: {
        ...valid.presentation.synthesis,
        evidenceItemIds: ["foreign_fact"],
      },
    },
  }), /presentation|evidence|pack/i);
  assert.throws(() => validateNamedLensFinalization({
    ...valid,
    presentation: {
      ...valid.presentation,
      segmentCitations: [{
        ...valid.presentation.segmentCitations[0]!,
        evidenceItemIds: ["counter_1"],
      }, ...valid.presentation.segmentCitations.slice(1)],
    },
  }), /citation|segment|passage/i);
  assert.throws(() => validateNamedLensFinalization({
    ...valid,
    presentation: {
      ...valid.presentation,
      firstScreenProjectionRefs: {
        ...valid.presentation.firstScreenProjectionRefs,
        selectedJudgmentIds: [
          valid.presentation.firstScreenProjectionRefs.selectedJudgmentIds[1]!,
          valid.presentation.firstScreenProjectionRefs.selectedJudgmentIds[0]!,
          ...valid.presentation.firstScreenProjectionRefs.selectedJudgmentIds
            .slice(2),
        ],
      },
    },
  }), /presentation|selection|position|order/i);
});

test("resolves unknown and conclusion citations only to their saved segment fields", () => {
  const valid = currentArtifacts();
  assert.doesNotThrow(() => validateNamedLensFinalization(valid));
  const unknownIndex = valid.presentation.segmentCitations.findIndex(
    ({ segment }) => segment === "unknown_boundary",
  );
  const conclusionIndex = valid.presentation.segmentCitations.findIndex(
    ({ segment }) => segment === "conditional_conclusion",
  );
  const withCitation = (
    index: number,
    citation: NamedLensPresentation["segmentCitations"][number],
  ) => ({
    ...valid,
    presentation: {
      ...valid.presentation,
      segmentCitations: valid.presentation.segmentCitations.map(
        (existing, candidateIndex) =>
          candidateIndex === index ? citation : existing,
      ),
    },
  });
  const unknown = valid.presentation.segmentCitations[unknownIndex]!;
  assert.throws(() => validateNamedLensFinalization(withCitation(
    unknownIndex,
    { ...unknown, judgmentUnknownRefs: ["Foreign unknown"] },
  )), /citation|unknown|segment/i);
  assert.throws(() => validateNamedLensFinalization(withCitation(
    unknownIndex,
    {
      ...unknown,
      judgmentUnknownRefs: [],
      judgmentLimitationRefs: ["Unknown 1"],
    },
  )), /citation|unknown|limitation|segment/i);
  const conclusion = valid.presentation.segmentCitations[conclusionIndex]!;
  assert.throws(() => validateNamedLensFinalization(withCitation(
    conclusionIndex,
    { ...conclusion, stanceRefs: ["negative"] },
  )), /citation|conclusion|stance|segment/i);
  assert.throws(() => validateNamedLensFinalization(withCitation(
    conclusionIndex,
    { ...conclusion, advisoryPostureRefs: ["urges_caution"] },
  )), /citation|conclusion|posture|segment/i);
});

test("persists two immutable attempt events and collapses them to one settled logical attempt", async () => {
  const current = currentArtifacts();
  const repository = createMemoryNamedLensArtifactsRepository({
    candidateLeaseAuthority: createTestNamedLensCandidateLeaseAuthority(),
  });
  const reserved = {
    workspaceId: current.persistedAttempts[0]!.workspaceId,
    artifactSourceCandidateRunId:
      current.persistedAttempts[0]!.artifactSourceCandidateRunId,
    judgmentOrCatalogCandidateId:
      current.persistedAttempts[0]!.judgmentOrCatalogCandidateId,
    logicalPassageId: current.persistedAttempts[0]!.logicalPassageId,
    attemptNumber: current.persistedAttempts[0]!.attemptNumber,
    attemptFingerprint: current.persistedAttempts[0]!.attemptFingerprint,
    workerId: "worker_1",
    leaseToken: "lease_1",
  };
  await repository.reserveAttempt(reserved);
  await assert.rejects(
    repository.reserveAttempt(reserved),
    /duplicate|reserved|attempt/i,
  );
  const settlement = {
    ...reserved,
    status: "completed" as const,
    telemetry: current.persistedAttempts[0]!.telemetry,
    failureReason: null,
  };
  await repository.settleAttempt(settlement);
  await assert.rejects(
    repository.settleAttempt(settlement),
    /duplicate|settled|attempt/i,
  );
  assert.deepEqual(
    await repository.listAttempts("workspace_1", "candidate_1"),
    [current.persistedAttempts[0]],
  );
  assert.equal(
    repository.inspect().rawAttemptEvents.length,
    2,
  );
});

test("memory row counts include global attempt events once and exclude aliases", () => {
  const fixture = createCurrentNamedLensFinalizationFixture();
  const namedLensArtifacts = createMemoryNamedLensArtifactsRepository({
    candidateLeaseAuthority: createTestNamedLensCandidateLeaseAuthority(),
  });
  for (const event of fixture.rawAttemptEvents) {
    namedLensArtifacts.recordAttemptEvent(event);
  }
  const repository = createMemoryUnderwritingArtifactsRepository({
    namedLensArtifacts,
  });
  const first = repository.prepareFinalization({
    candidate: {
      id: fixture.finalization.candidateRunId,
      workspaceId: fixture.finalization.evidencePack.workspaceId,
      dealId: fixture.finalization.evidencePack.dealId,
      fundPolicySnapshotId: fixture.finalization.versionSnapshot.fundPolicyId,
    },
    finalization: fixture.finalization,
  });
  repository.commitPrepared(first);
  repository.commitPrepared({
    ...structuredClone(first),
    candidateRunId: "candidate_second",
    sourceCandidateRunId: "candidate_second",
    candidateAnalysisFingerprint: sha("b"),
  });
  repository.aliasCandidate({
    workspaceId: first.workspaceId,
    candidateRunId: "candidate_alias",
    sourceCandidateRunId: first.candidateRunId,
    dealId: first.dealId,
    candidateAnalysisFingerprint: first.candidateAnalysisFingerprint,
  });

  const counts = repository.inspect().rowCounts;
  assert.equal(counts.decisionCriticalEvidenceProjections, 2);
  assert.equal(counts.namedLensProviderAttemptEvents, 2);
  assert.equal(counts.namedLensDispositions, 2);
  assert.equal(counts.namedLensPassages, 2);
  assert.equal(counts.namedLensPassageSegments, 10);
  assert.equal(counts.underwritingPresentations, 2);
});

test("current finalization requires every identity pin and recomputes the persisted Named Lens graph", () => {
  const fixture = createCurrentNamedLensFinalizationFixture();
  const prepare = (finalization: typeof fixture.finalization) => {
    const namedLensArtifacts = createMemoryNamedLensArtifactsRepository({
      candidateLeaseAuthority: createTestNamedLensCandidateLeaseAuthority(),
    });
    for (const event of fixture.rawAttemptEvents) {
      namedLensArtifacts.recordAttemptEvent(event);
    }
    return createMemoryUnderwritingArtifactsRepository({
      namedLensArtifacts,
    }).prepareFinalization({
      candidate: {
        id: finalization.candidateRunId,
        workspaceId: finalization.evidencePack.workspaceId,
        dealId: finalization.evidencePack.dealId,
        fundPolicySnapshotId: finalization.versionSnapshot.fundPolicyId,
      },
      finalization,
    });
  };
  assert.doesNotThrow(() => prepare(fixture.finalization));
  for (const field of [
    "frameworkCatalogVersion",
    "frameworkCatalogFingerprint",
    "frameworkCorpusDigest",
    "decisionTaxonomyDigest",
    "criticalEvidenceProjectionFingerprint",
    "finalDispositionsFingerprint",
    "presentationFingerprint",
    "refreshNonce",
  ] as const) {
    const missing = structuredClone(fixture.finalization);
    delete (missing.versionSnapshot as unknown as Record<string, unknown>)[
      field
    ];
    assert.throws(
      () => prepare(missing),
      /identity|fingerprint|refresh|current named lens/i,
      field,
    );
  }
  const mutations: Array<{
    name: string;
    mutate: (value: typeof fixture.finalization) => void;
  }> = [{
    name: "taxonomy digest",
    mutate: (value) => {
      value.versionSnapshot.decisionTaxonomyDigest = sha("f");
    },
  }, {
    name: "projection snapshot",
    mutate: (value) => {
      value.versionSnapshot.criticalEvidenceProjectionFingerprint = sha("f");
    },
  }, {
    name: "projection row",
    mutate: (value) => {
      value.decisionCriticalEvidenceProjection!.fingerprint = sha("f");
    },
  }, {
    name: "disposition aggregate",
    mutate: (value) => {
      value.versionSnapshot.finalDispositionsFingerprint = sha("f");
    },
  }, {
    name: "presentation snapshot",
    mutate: (value) => {
      value.versionSnapshot.presentationFingerprint = sha("f");
    },
  }, {
    name: "presentation row",
    mutate: (value) => {
      value.namedLensPresentation!.fingerprint = sha("f");
    },
  }];
  for (const { name, mutate } of mutations) {
    const changed = structuredClone(fixture.finalization);
    mutate(changed);
    assert.throws(
      () => prepare(changed),
      /fingerprint|taxonomy|persistence graph/i,
      name,
    );
  }
});

function namedLensOnlyPartialWithFormalPlaceholders() {
  const fixture = createCurrentNamedLensFinalizationFixture();
  const finalization = structuredClone(fixture.finalization);
  finalization.evidencePack.coverage = {
    minimumModelInputsComplete: true,
    criticalEvidenceComplete: true,
    missingFieldIds: [],
    blockingConflictIds: [],
    decisionCeiling: "Advance",
    underwritingStatus: "available",
    reasonCodes: [],
  };
  finalization.context = {
    ...finalization.context,
    analysisMode: "full",
    geography: "us",
    benchmarkPackId: "benchmark_pack_synthetic_us_software_v1",
    benchmarkCompatibility: "exact",
  };
  finalization.versionSnapshot = {
    ...finalization.versionSnapshot,
    analysisMode: "full",
    geography: "us",
    benchmarkCompatibility: "exact",
    benchmarkPackId: "benchmark_pack_synthetic_us_software_v1",
    benchmarkEntryId: "benchmark_entry_synthetic_seed_valuation_v1",
    benchmarkDefinitionFingerprint: sha("d"),
  };
  finalization.actionDrafts = finalization.actionDrafts.map((draft) => ({
    ...draft,
    missingEvidence: [],
  }));
  const unavailableId = "catalog_unavailable_1";
  const firstCatalog = finalization.namedLensCatalogConsiderations![0]!;
  const firstDisposition = finalization.namedLensDispositions![0]!;
  finalization.namedLensCatalogConsiderations!.push({
    ...firstCatalog,
    judgmentOrCatalogCandidateId: unavailableId,
    judgmentId: null,
    initialDisposition: "unavailable",
    reasonCodes: ["PROVIDER_ATTEMPTS_EXHAUSTED"],
    fingerprint: sha("c"),
  });
  finalization.namedLensDispositions!.push({
    ...firstDisposition,
    judgmentOrCatalogCandidateId: unavailableId,
    judgmentId: null,
    disposition: "unavailable",
    selectedPosition: null,
    priorityTier: null,
    reasonCodes: ["PROVIDER_ATTEMPTS_EXHAUSTED"],
    decisionQuestionCode: null,
    stance: null,
    advisoryPosture: null,
    selectionBasisEvidenceIds: [],
    criticalEvidence: [],
    passageFingerprint: null,
    fingerprint: sha("d"),
  });
  const failedAttempt = {
    ...fixture.persistedAttempts[0]!,
    judgmentOrCatalogCandidateId: unavailableId,
    logicalPassageId:
      `${unavailableId}@named-lens-passage-v1@named-lens-generator-v1`,
    attemptFingerprint: sha("e"),
    status: "failed" as const,
    telemetry: null,
    failureReason: {
      code: "provider_error" as const,
      detail: "Provider attempts exhausted.",
      retryable: false,
    },
  };
  finalization.namedLensAttemptRefs!.push({
    judgmentOrCatalogCandidateId: unavailableId,
    logicalPassageId: failedAttempt.logicalPassageId,
    attemptNumber: failedAttempt.attemptNumber,
    attemptFingerprint: failedAttempt.attemptFingerprint,
  });
  finalization.terminalStatus = "partial";
  finalization.terminalReasonCodes = [
    "named_lens_passage_attempts_exhausted",
  ];
  const {
    fingerprint: _presentationFingerprint,
    ...presentationWithoutFingerprint
  } = finalization.namedLensPresentation!;
  finalization.versionSnapshot.finalDispositionsFingerprint =
    createNamedLensSemanticFingerprints({
      evidenceRefs:
        finalization.decisionCriticalEvidenceProjection!.evidenceRefs,
      dispositions: finalization.namedLensDispositions!,
      passages: finalization.namedLensPassages!,
      presentation: presentationWithoutFingerprint,
    }).finalDispositionsFingerprint;
  return {
    finalization,
    persistedAttempts: [...fixture.persistedAttempts, failedAttempt],
    rawAttemptEvents: [
      ...fixture.rawAttemptEvents,
      { ...failedAttempt, status: "reserved" as const, failureReason: null },
      failedAttempt,
    ],
  };
}

test("Named Lens-only partial finalization rejects unavailable formal placeholders before any commit or RPC", async () => {
  const fixture = namedLensOnlyPartialWithFormalPlaceholders();
  const namedLensArtifacts = createMemoryNamedLensArtifactsRepository({
    candidateLeaseAuthority: createTestNamedLensCandidateLeaseAuthority(),
  });
  for (const event of fixture.rawAttemptEvents) {
    namedLensArtifacts.recordAttemptEvent(event);
  }
  const memory = createMemoryUnderwritingArtifactsRepository({
    namedLensArtifacts,
  });
  assert.throws(() => memory.prepareFinalization({
    candidate: {
      id: fixture.finalization.candidateRunId,
      workspaceId: fixture.finalization.evidencePack.workspaceId,
      dealId: fixture.finalization.evidencePack.dealId,
      fundPolicySnapshotId: fixture.finalization.versionSnapshot.fundPolicyId,
    },
    finalization: fixture.finalization,
  }), /partial|formal|placeholder|preserve/i);
  assert.equal(memory.inspect().bundles.length, 0);

  let finalizeRpcCalled = false;
  const candidate = {
    id: fixture.finalization.candidateRunId,
    batchId: "batch_current",
    workspaceId: fixture.finalization.evidencePack.workspaceId,
    dealId: fixture.finalization.evidencePack.dealId,
    status: "running",
    candidateAnalysisFingerprint: "pending:candidate_current",
    rerunOfId: null,
    createdAt: "2026-08-10T12:00:00.000Z",
    finalizedAt: null,
  };
  const supabase = createSupabaseUnderwritingRunsRepository({
    url: "https://supabase.example",
    serviceRoleKey: "secret",
    namedLensArtifacts: {
      reserveAttempt: async () => { throw new Error("not used"); },
      settleAttempt: async () => { throw new Error("not used"); },
      listAttempts: async () => fixture.persistedAttempts,
    },
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      if (parsed.pathname.endsWith("/candidate_runs")) {
        return Response.json([candidate]);
      }
      if (parsed.pathname.endsWith("/underwriting_batches")) {
        return Response.json([{
          id: "batch_current",
          workspaceId: candidate.workspaceId,
          scanRunId: "scan_current",
          status: "running",
          batchInputFingerprint: sha("b"),
          fundPolicySnapshotId: fixture.finalization.versionSnapshot.fundPolicyId,
          rerunOfId: null,
          createdAt: "2026-08-10T11:00:00.000Z",
        }]);
      }
      if (parsed.pathname.endsWith("/candidate_checkpoints")) {
        const inputFingerprint = sha("a");
        const outputPayload = {
          catalogVersion:
            fixture.finalization.versionSnapshot.frameworkCatalogVersion,
          catalogFingerprint:
            fixture.finalization.versionSnapshot.frameworkCatalogFingerprint,
          corpusDigest:
            fixture.finalization.versionSnapshot.frameworkCorpusDigest,
        };
        return Response.json([{
          candidate_run_id: candidate.id,
          stage: "framework_catalog",
          status: "completed",
          input_fingerprint: inputFingerprint,
          output_fingerprint: createCanonicalFingerprint({
            stage: "framework_catalog",
            inputFingerprint,
            result: outputPayload,
          }),
          output_payload: outputPayload,
          attempt_count: 1,
          cost_units: 0,
          token_units: 0,
          actual_token_units: 0,
          provider_attempts: [],
          reason_code: null,
          public_reason: null,
          saved_at: "2026-08-10T11:30:00.000Z",
        }]);
      }
      if (parsed.pathname.endsWith(
        "/rpc/finalize_or_reuse_candidate_underwriting",
      )) {
        finalizeRpcCalled = true;
        return Response.json(candidate);
      }
      throw new Error(`Unexpected URL ${url}`);
    },
  });
  await assert.rejects(
    supabase.finalizeCandidate(fixture.finalization),
    /partial|formal|placeholder|preserve/i,
  );
  assert.equal(finalizeRpcCalled, false);
});

test("critical-incomplete full US partial finalization cannot erase an available formal decision", () => {
  const fixture = namedLensOnlyPartialWithFormalPlaceholders();
  fixture.finalization.evidencePack.coverage = {
    ...fixture.finalization.evidencePack.coverage,
    criticalEvidenceComplete: false,
    missingFieldIds: ["arr"],
    decisionCeiling: "Advance",
    reasonCodes: ["MISSING_CRITICAL_EVIDENCE"],
  };
  fixture.finalization.actionDrafts = fixture.finalization.actionDrafts.map(
    (draft) => ({
      ...draft,
      missingEvidence: [{
        fieldId: "arr",
        label: "arr",
        externalLabel: "arr",
        reasonCode: "MISSING_CRITICAL_EVIDENCE" as const,
        mostLikelyDecisionImpact:
          "Providing accepted evidence may raise or lower the formal decision ceiling." as const,
      }],
    }),
  );
  const namedLensArtifacts = createMemoryNamedLensArtifactsRepository({
    candidateLeaseAuthority: createTestNamedLensCandidateLeaseAuthority(),
  });
  for (const event of fixture.rawAttemptEvents) {
    namedLensArtifacts.recordAttemptEvent(event);
  }
  const memory = createMemoryUnderwritingArtifactsRepository({
    namedLensArtifacts,
  });
  assert.throws(() => memory.prepareFinalization({
    candidate: {
      id: fixture.finalization.candidateRunId,
      workspaceId: fixture.finalization.evidencePack.workspaceId,
      dealId: fixture.finalization.evidencePack.dealId,
      fundPolicySnapshotId: fixture.finalization.versionSnapshot.fundPolicyId,
    },
    finalization: fixture.finalization,
  }), /partial|formal|decision|placeholder|preserve/i);
});

test("Supabase attempt persistence sends exact lease RPC payloads and collapses two raw events", async () => {
  const current = currentArtifacts().persistedAttempts[0]!;
  const reserved = { ...current, status: "reserved", telemetry: null };
  const requests: Array<{ pathname: string; body: unknown }> = [];
  const repository = createSupabaseNamedLensArtifactsRepository({
    url: "https://supabase.example",
    serviceRoleKey: "secret",
    fetchImpl: async (url, init = {}) => {
      const pathname = new URL(String(url)).pathname;
      const body = init.body === undefined
        ? null
        : JSON.parse(String(init.body));
      requests.push({ pathname, body });
      if (pathname.endsWith("/reserve_named_lens_passage_attempt")) {
        return Response.json(reserved);
      }
      if (pathname.endsWith("/settle_named_lens_passage_attempt")) {
        return Response.json(current);
      }
      return Response.json([{ payload: reserved }, { payload: current }]);
    },
  });
  const identity = {
    workspaceId: current.workspaceId,
    artifactSourceCandidateRunId: current.artifactSourceCandidateRunId,
    judgmentOrCatalogCandidateId: current.judgmentOrCatalogCandidateId,
    logicalPassageId: current.logicalPassageId,
    attemptNumber: current.attemptNumber,
    attemptFingerprint: current.attemptFingerprint,
    workerId: "worker_1",
    leaseToken: "lease_1",
  };
  await repository.reserveAttempt(identity);
  await repository.settleAttempt({
    ...identity,
    status: "completed",
    telemetry: current.telemetry,
    failureReason: null,
  });
  assert.deepEqual(
    await repository.listAttempts("workspace_1", "candidate_1"),
    [current],
  );
  assert.deepEqual(requests.slice(0, 2), [{
    pathname: "/rest/v1/rpc/reserve_named_lens_passage_attempt",
    body: { p_payload: identity },
  }, {
    pathname: "/rest/v1/rpc/settle_named_lens_passage_attempt",
    body: {
      p_payload: {
        ...identity,
        status: "completed",
        telemetry: current.telemetry,
        failureReason: null,
      },
    },
  }]);
});

function currentReadFetch(
  fixture: ReturnType<typeof createCurrentNamedLensFinalizationFixture>,
  overrides: Record<string, unknown[]> = {},
) {
  const current = fixture.finalization;
  const rowsByTable: Record<string, unknown[]> = {
    candidate_runs: [{
      id: current.candidateRunId,
      batch_id: "batch_current",
      workspace_id: current.evidencePack.workspaceId,
      deal_id: current.evidencePack.dealId,
      status: "completed",
      unavailable_reason_codes: ["limited_framework_coverage"],
      candidate_analysis_fingerprint: current.candidateAnalysisFingerprint,
      artifact_source_candidate_run_id: null,
      rerun_of_id: null,
    }],
    underwriting_batches: [{
      fund_policy_snapshot_id: current.versionSnapshot.fundPolicyId,
    }],
    evidence_packs: [{ payload: current.evidencePack }],
    candidate_context_snapshots: [{ payload: current.context }],
    scenario_models: [{ payload: current.scenarioModel }],
    underwriting_calculations: [],
    framework_judgment_artifacts: current.judgments.map((payload) => ({
      artifact_id: payload.id,
      payload,
    })),
    framework_disagreement_artifacts: [],
    valuation_evaluations: [{ payload: current.valuation }],
    final_syntheses: [{ payload: current.decision }],
    underwriting_narratives: [{ body: current.narrative }],
    action_drafts: current.actionDrafts.map((payload) => ({
      artifact_id: payload.id,
      payload,
    })),
    underwriting_claim_edges: current.judgments.flatMap(({ claimEdges }) =>
      claimEdges.map((edge) => ({
        claim_item_id: edge.claimItemId,
        dependency_item_id: edge.dependencyItemId,
        dependency_type: edge.dependencyType,
      }))
    ),
    candidate_version_snapshots: [{ payload: current.versionSnapshot }],
    decision_critical_evidence_projections: fixture.projectionRows,
    named_lens_passage_attempt_events: fixture.rawAttemptEvents.map(
      (payload) => ({ payload }),
    ),
    named_lens_dispositions: fixture.dispositionRows,
    named_lens_passages: fixture.passageRows,
    named_lens_passage_segments: fixture.segmentRows,
    underwriting_presentations: fixture.presentationRows,
  };
  return async (url: string | URL | Request) => {
    const table = new URL(String(url)).pathname.split("/").at(-1)!;
    return Response.json(overrides[table] ?? rowsByTable[table] ?? []);
  };
}

test("Supabase current bundle reads every Named Lens row authority before reconstruction", async () => {
  const fixture = createCurrentNamedLensFinalizationFixture();
  const current = fixture.finalization;
  const requestedTables: string[] = [];
  const repository = createSupabaseUnderwritingArtifactsRepository({
    url: "https://supabase.example",
    serviceRoleKey: "secret",
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      requestedTables.push(parsed.pathname.split("/").at(-1)!);
      if (parsed.pathname.endsWith("/candidate_runs")) {
        return Response.json([{
          id: current.candidateRunId,
          batch_id: "batch_current",
          workspace_id: current.evidencePack.workspaceId,
          deal_id: current.evidencePack.dealId,
          status: "completed",
          unavailable_reason_codes: ["limited_framework_coverage"],
          candidate_analysis_fingerprint:
            current.candidateAnalysisFingerprint,
          artifact_source_candidate_run_id: null,
          rerun_of_id: null,
        }]);
      }
      if (parsed.pathname.endsWith("/underwriting_batches")) {
        return Response.json([{
          fund_policy_snapshot_id: current.versionSnapshot.fundPolicyId,
        }]);
      }
      if (parsed.pathname.endsWith("/evidence_packs")) {
        return Response.json([{ payload: current.evidencePack }]);
      }
      if (parsed.pathname.endsWith("/candidate_context_snapshots")) {
        return Response.json([{ payload: current.context }]);
      }
      if (parsed.pathname.endsWith("/scenario_models")) {
        return Response.json([{ payload: current.scenarioModel }]);
      }
      if (parsed.pathname.endsWith("/underwriting_calculations")) {
        return Response.json([]);
      }
      if (parsed.pathname.endsWith("/framework_judgment_artifacts")) {
        return Response.json(current.judgments.map((payload) => ({
          artifact_id: payload.id,
          payload,
        })));
      }
      if (parsed.pathname.endsWith("/framework_disagreement_artifacts")) {
        return Response.json([]);
      }
      if (parsed.pathname.endsWith("/valuation_evaluations")) {
        return Response.json([{ payload: current.valuation }]);
      }
      if (parsed.pathname.endsWith("/final_syntheses")) {
        return Response.json([{ payload: current.decision }]);
      }
      if (parsed.pathname.endsWith("/underwriting_narratives")) {
        return Response.json([{ body: current.narrative }]);
      }
      if (parsed.pathname.endsWith("/action_drafts")) {
        return Response.json(current.actionDrafts.map((payload) => ({
          artifact_id: payload.id,
          payload,
        })));
      }
      if (parsed.pathname.endsWith("/underwriting_claim_edges")) {
        return Response.json(current.judgments.flatMap(({ claimEdges }) =>
          claimEdges.map((edge) => ({
            claim_item_id: edge.claimItemId,
            dependency_item_id: edge.dependencyItemId,
            dependency_type: edge.dependencyType,
          }))
        ));
      }
      if (parsed.pathname.endsWith("/candidate_version_snapshots")) {
        return Response.json([{ payload: current.versionSnapshot }]);
      }
      if (parsed.pathname.endsWith("/decision_critical_evidence_projections")) {
        return Response.json(fixture.projectionRows);
      }
      if (parsed.pathname.endsWith("/named_lens_passage_attempt_events")) {
        return Response.json(fixture.rawAttemptEvents.map((payload) => ({
          payload,
        })));
      }
      if (parsed.pathname.endsWith("/named_lens_dispositions")) {
        return Response.json(fixture.dispositionRows);
      }
      if (parsed.pathname.endsWith("/named_lens_passages")) {
        return Response.json(fixture.passageRows);
      }
      if (parsed.pathname.endsWith("/named_lens_passage_segments")) {
        return Response.json(fixture.segmentRows);
      }
      if (parsed.pathname.endsWith("/underwriting_presentations")) {
        return Response.json(fixture.presentationRows);
      }
      return Response.json([]);
    },
  });
  const bundle = await repository.getByCandidateRunId({
    workspaceId: current.evidencePack.workspaceId,
    candidateRunId: current.candidateRunId,
  });
  assert.deepEqual(bundle?.decisionCriticalEvidenceProjection,
    current.decisionCriticalEvidenceProjection);
  assert.deepEqual(bundle?.namedLensCatalogConsiderations,
    current.namedLensCatalogConsiderations);
  assert.deepEqual(bundle?.namedLensDispositions,
    current.namedLensDispositions);
  assert.deepEqual(bundle?.namedLensPassages, current.namedLensPassages);
  assert.deepEqual(bundle?.namedLensPresentation,
    current.namedLensPresentation);
  assert.equal(bundle?.underwritingPresentationReportId,
    current.underwritingPresentationReportId);
  assert.deepEqual(bundle?.namedLensAttemptRefs, current.namedLensAttemptRefs);
  assert.equal(bundle?.terminalStatus, "completed");
  assert.deepEqual(bundle?.terminalReasonCodes,
    ["limited_framework_coverage"]);
  for (const table of [
    "decision_critical_evidence_projections",
    "named_lens_passage_attempt_events",
    "named_lens_dispositions",
    "named_lens_passages",
    "named_lens_passage_segments",
    "underwriting_presentations",
  ]) {
    assert.ok(requestedTables.includes(table), `missing current read: ${table}`);
  }
});

test("Supabase current bundle reads fail closed on missing or foreign Named Lens rows", async () => {
  const fixture = createCurrentNamedLensFinalizationFixture();
  const input = {
    workspaceId: fixture.finalization.evidencePack.workspaceId,
    candidateRunId: fixture.finalization.candidateRunId,
  };
  const missingSegment = createSupabaseUnderwritingArtifactsRepository({
    url: "https://supabase.example",
    serviceRoleKey: "secret",
    fetchImpl: currentReadFetch(fixture, {
      named_lens_passage_segments: fixture.segmentRows.slice(1),
    }),
  });
  await assert.rejects(
    missingSegment.getByCandidateRunId(input),
    /five|segment|complete/i,
  );

  const presentation = fixture.presentationRows[0]!;
  const foreignPresentation = createSupabaseUnderwritingArtifactsRepository({
    url: "https://supabase.example",
    serviceRoleKey: "secret",
    fetchImpl: currentReadFetch(fixture, {
      underwriting_presentations: [{
        ...presentation,
        payload: {
          ...(presentation.payload as Record<string, unknown>),
          artifactSourceCandidateRunId: "candidate_foreign",
        },
      }],
    }),
  });
  await assert.rejects(
    foreignPresentation.getByCandidateRunId(input),
    /candidate-local|presentation|artifact/i,
  );
});

test("Supabase completed-limited alias reads preserve the exact canonical reason", async () => {
  const fixture = createCurrentNamedLensFinalizationFixture();
  const current = fixture.finalization;
  const canonicalId = current.candidateRunId;
  const aliasId = "candidate_completed_limited_alias";
  const canonicalFetch = currentReadFetch(fixture);
  const repository = createSupabaseUnderwritingArtifactsRepository({
    url: "https://supabase.example",
    serviceRoleKey: "secret",
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      if (parsed.pathname.endsWith("/candidate_runs")) {
        const id = parsed.searchParams.get("id");
        if (id === `eq.${aliasId}`) {
          return Response.json([{
            id: aliasId,
            batch_id: "batch_alias",
            workspace_id: current.evidencePack.workspaceId,
            deal_id: current.evidencePack.dealId,
            status: "completed",
            unavailable_reason_codes: ["limited_framework_coverage"],
            candidate_analysis_fingerprint:
              current.candidateAnalysisFingerprint,
            artifact_source_candidate_run_id: canonicalId,
            rerun_of_id: canonicalId,
          }]);
        }
        if (id === `eq.${canonicalId}`) {
          return Response.json([{
            id: canonicalId,
            batch_id: "batch_current",
            workspace_id: current.evidencePack.workspaceId,
            deal_id: current.evidencePack.dealId,
            status: "completed",
            unavailable_reason_codes: ["limited_framework_coverage"],
            candidate_analysis_fingerprint:
              current.candidateAnalysisFingerprint,
            artifact_source_candidate_run_id: null,
            rerun_of_id: null,
          }]);
        }
      }
      return canonicalFetch(url);
    },
  });

  const bundle = await repository.getByCandidateRunId({
    workspaceId: current.evidencePack.workspaceId,
    candidateRunId: aliasId,
  });

  assert.equal(bundle?.candidateRunId, aliasId);
  assert.equal(bundle?.sourceCandidateRunId, canonicalId);
  assert.equal(bundle?.terminalStatus, "completed");
  assert.deepEqual(bundle?.terminalReasonCodes,
    ["limited_framework_coverage"]);
});

test("Supabase alias reads validate the canonical source before loading its owning batch", async () => {
  const candidateQueries: string[] = [];
  const batchQueries: string[] = [];
  const repository = createSupabaseUnderwritingArtifactsRepository({
    url: "https://supabase.example",
    serviceRoleKey: "secret",
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      if (parsed.pathname.endsWith("/candidate_runs")) {
        const id = parsed.searchParams.get("id") ?? "";
        candidateQueries.push(id);
        if (id === "eq.candidate_alias") {
          return Response.json([{
            id: "candidate_alias",
            batch_id: "batch_alias",
            workspace_id: "workspace_1",
            deal_id: "deal_1",
            status: "partial",
            unavailable_reason_codes: [
              "named_lens_passage_attempts_exhausted",
            ],
            candidate_analysis_fingerprint: sha("a"),
            artifact_source_candidate_run_id: "candidate_source",
            rerun_of_id: "candidate_source",
          }]);
        }
        if (id === "eq.candidate_source") {
          return Response.json([{
            id: "candidate_source",
            batch_id: "batch_source",
            workspace_id: "workspace_1",
            deal_id: "deal_1",
            status: "partial",
            unavailable_reason_codes: [
              "named_lens_passage_attempts_exhausted",
            ],
            candidate_analysis_fingerprint: sha("a"),
            artifact_source_candidate_run_id: null,
            rerun_of_id: null,
          }]);
        }
      }
      if (parsed.pathname.endsWith("/underwriting_batches")) {
        batchQueries.push(parsed.searchParams.get("id") ?? "");
        return Response.json([{ fund_policy_snapshot_id: "fund_policy_1" }]);
      }
      return Response.json([]);
    },
  });
  await assert.rejects(repository.getByCandidateRunId({
    workspaceId: "workspace_1",
    candidateRunId: "candidate_alias",
  }), /incomplete|artifact/i);
  assert.deepEqual(candidateQueries, [
    "eq.candidate_alias",
    "eq.candidate_source",
  ]);
  assert.deepEqual(batchQueries, ["eq.batch_source"]);
});

test("bundle reconstruction derives catalog from dispositions and passage bodies from five segment rows", () => {
  const current = currentArtifacts();
  const reconstruct = (underwritingArtifactsModule as unknown as {
    reconstructNamedLensPersistence(input: {
      dispositionRows: Array<Record<string, unknown>>;
      passageRows: Array<Record<string, unknown>>;
      segmentRows: Array<Record<string, unknown>>;
    }): {
      catalogConsiderations: NamedLensCatalogConsideration[];
      dispositions: NamedLensFinalizationDisposition[];
      passages: NamedLensPassage[];
    };
  }).reconstructNamedLensPersistence;
  assert.equal(typeof reconstruct, "function");
  const segmentKinds = [
    ["premise", "premise"],
    ["case_application", "caseApplication"],
    ["countercase", "countercase"],
    ["unknown_boundary", "unknownBoundary"],
    ["conditional_conclusion", "conditionalConclusion"],
  ] as const;
  const result = reconstruct({
    dispositionRows: current.dispositions.map((payload, index) => ({
      catalog_ordinal: index + 1,
      catalog_consideration: current.catalogConsiderations[index],
      payload,
    })),
    passageRows: current.passages.map((passage) => ({
      judgment_id: passage.judgmentId,
      payload: {
        ...passage,
        premise: { ...passage.premise, text: "Contradictory flat payload." },
      },
    })),
    segmentRows: current.passages.flatMap((passage) =>
      segmentKinds.map(([segment_kind, property], index) => ({
        judgment_id: passage.judgmentId,
        segment_ordinal: index + 1,
        segment_kind,
        payload: passage[property],
      }))
    ),
  });
  assert.deepEqual(result.catalogConsiderations, current.catalogConsiderations);
  assert.deepEqual(result.dispositions, current.dispositions);
  assert.deepEqual(result.passages, current.passages);
});

test("attempt settlement fails closed for orphans and ignores every terminal event after abort", async () => {
  const current = currentArtifacts().persistedAttempts[0]!;
  const repository = createMemoryNamedLensArtifactsRepository({
    candidateLeaseAuthority: createTestNamedLensCandidateLeaseAuthority(),
  });
  const identity = {
    workspaceId: current.workspaceId,
    artifactSourceCandidateRunId: current.artifactSourceCandidateRunId,
    judgmentOrCatalogCandidateId: current.judgmentOrCatalogCandidateId,
    logicalPassageId: current.logicalPassageId,
    attemptNumber: current.attemptNumber,
    attemptFingerprint: current.attemptFingerprint,
    workerId: "worker_1",
    leaseToken: "lease_1",
  };
  await assert.rejects(repository.settleAttempt({
    ...identity,
    status: "failed",
    telemetry: null,
    failureReason: {
      code: "provider_error",
      detail: "Orphan settlement.",
      retryable: false,
    },
  }), /reserved|orphan|attempt/i);
  await repository.reserveAttempt(identity);
  await repository.settleAttempt({
    ...identity,
    status: "aborted",
    telemetry: null,
    failureReason: {
      code: "aborted",
      detail: "Timed out before provider completion.",
      retryable: false,
    },
  });
  await assert.rejects(repository.settleAttempt({
    ...identity,
    status: "completed",
    telemetry: current.telemetry,
    failureReason: null,
  }), /already settled|terminal|attempt/i);
  assert.equal(repository.inspect().rawAttemptEvents.length, 2);
  assert.equal(
    (await repository.listAttempts("workspace_1", "candidate_1"))[0]?.status,
    "aborted",
  );
});

test("partial canonical artifacts are reusable while alias bundles preserve requested and source identities", async () => {
  const repository = createMemoryUnderwritingArtifactsRepository();
  const partial = {
    candidateRunId: "candidate_1",
    workspaceId: "workspace_1",
    dealId: "deal_1",
    candidateAnalysisFingerprint: sha("a"),
    terminalStatus: "partial",
  } as unknown as CandidateArtifactBundle;
  repository.commitPrepared(partial);
  assert.deepEqual(await repository.findReusable({
    workspaceId: "workspace_1",
    candidateAnalysisFingerprint: partial.candidateAnalysisFingerprint,
  }), {
    candidateRunId: "candidate_1",
    workspaceId: "workspace_1",
    dealId: "deal_1",
    candidateAnalysisFingerprint: sha("a"),
    terminalStatus: "partial",
    terminalReasonCodes: [],
  });
  repository.aliasCandidate({
    workspaceId: "workspace_1",
    candidateRunId: "candidate_alias",
    sourceCandidateRunId: "candidate_1",
    dealId: "deal_1",
    candidateAnalysisFingerprint: partial.candidateAnalysisFingerprint,
  });
  const alias = await repository.getByCandidateRunId({
    workspaceId: "workspace_1",
    candidateRunId: "candidate_alias",
  });
  assert.equal(alias?.candidateRunId, "candidate_alias");
  assert.equal(
    (alias as CandidateArtifactBundle & { sourceCandidateRunId: string })
      ?.sourceCandidateRunId,
    "candidate_1",
  );
  assert.equal(alias?.terminalStatus, "partial");
  assert.equal(candidateRunStatusForFinalization(partial), "partial");
});

test("a partial finalization preserves typed coverage reasons and enters canonical reuse", async () => {
  let sequence = 0;
  const artifacts = createMemoryUnderwritingArtifactsRepository();
  const evidencePacks = createMemoryEvidencePacksRepository();
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => new Date("2026-08-10T12:00:00.000Z"),
    idGenerator: (kind: "batch" | "candidate") => `${kind}_${++sequence}`,
    leaseTokenGenerator: () => `lease_${++sequence}`,
    artifacts,
    evidencePacks,
  });
  const batch = await runs.createOrReuseBatch({
    workspaceId: "workspace_1",
    scanRunId: "scan_1",
    batchInputFingerprint: sha("b"),
    fundPolicySnapshotId: "fund_policy_1",
    forceRefresh: false,
    refreshNonce: null,
    rerunOfId: null,
  });
  await runs.saveSelections({
    batchId: batch.id,
    selections: [{
      dealId: "deal_1",
      status: "selected",
      rank: 1,
      reason: "Selected for underwriting.",
    }],
  });
  const [candidate] = await runs.createSelectedCandidates({
    batchId: batch.id,
    dealIds: ["deal_1"],
  });
  const claimed = await runs.claimNextCandidate({
    workerId: "worker_1",
    leaseSeconds: 60,
  });
  assert.equal(claimed?.candidate.id, candidate?.id);
  const evidencePack = {
    id: "pack_1",
    version: 1,
    workspaceId: "workspace_1",
    dealId: "deal_1",
    asOfDate: "2026-08-10",
    sourceRevisionIds: [],
    facts: [],
    assumptions: [],
    conflicts: [],
    coverage: {
      minimumModelInputsComplete: false,
      criticalEvidenceComplete: false,
      missingFieldIds: ["arr"],
      blockingConflictIds: [],
      decisionCeiling: null,
      underwritingStatus: "unavailable",
      reasonCodes: ["MISSING_MINIMUM_MODEL_INPUTS"],
    },
    createdAt: "2026-08-10T12:00:00.000Z",
  } satisfies EvidencePack;
  await evidencePacks.saveExact({
    pack: evidencePack,
    inputFingerprint: sha("e"),
    sourceRevisionSnapshots: [],
  });
  const partialBundle = {
    candidateRunId: candidate!.id,
    sourceCandidateRunId: candidate!.id,
    workspaceId: "workspace_1",
    dealId: "deal_1",
    candidateAnalysisFingerprint: sha("a"),
    terminalStatus: "partial",
    terminalReasonCodes: ["named_lens_passage_attempts_exhausted"],
  } as unknown as CandidateArtifactBundle;
  const catalogIdentity = {
    catalogVersion: "framework-catalog-test-v1",
    catalogFingerprint: sha("c"),
    corpusDigest: sha("d"),
  };
  const catalogInputFingerprint = sha("a");
  await runs.saveCheckpoint({
    workerId: "worker_1",
    leaseToken: claimed!.leaseToken,
    candidateRunId: candidate!.id,
    stage: "framework_catalog",
    status: "completed",
    inputFingerprint: catalogInputFingerprint,
    outputFingerprint: createCanonicalFingerprint({
      stage: "framework_catalog",
      inputFingerprint: catalogInputFingerprint,
      result: catalogIdentity,
    }),
    outputPayload: catalogIdentity,
    attemptCount: 1,
    costUnits: 0,
    tokenUnits: 0,
    actualTokenUnits: 0,
    providerAttempts: [],
    reasonCode: null,
    publicReason: null,
    savedAt: "2026-08-10T12:00:00.000Z",
  });
  artifacts.prepareFinalization = () => partialBundle;
  const result = await runs.finalizeCandidate({
    workerId: "worker_1",
    leaseToken: claimed!.leaseToken,
    candidateRunId: candidate!.id,
    candidateAnalysisFingerprint: sha("a"),
    evidencePackBuildInputFingerprint: sha("e"),
    evidencePack,
    versionSnapshot: {
      frameworkCatalogVersion: catalogIdentity.catalogVersion,
      frameworkCatalogFingerprint: catalogIdentity.catalogFingerprint,
      frameworkCorpusDigest: catalogIdentity.corpusDigest,
    },
  } as unknown as CandidateFinalization);

  assert.equal(result.status, "partial");
  assert.deepEqual(result.terminalReasonCodes,
    ["named_lens_passage_attempts_exhausted"]);
  assert.deepEqual(await artifacts.findReusable({
    workspaceId: "workspace_1",
    candidateAnalysisFingerprint: sha("a"),
  }), {
    candidateRunId: candidate!.id,
    workspaceId: "workspace_1",
    dealId: "deal_1",
    candidateAnalysisFingerprint: sha("a"),
    terminalStatus: "partial",
    terminalReasonCodes: ["named_lens_passage_attempts_exhausted"],
  });
  const refresh = await runs.createOrReuseBatch({
    workspaceId: "workspace_1",
    scanRunId: "scan_2",
    batchInputFingerprint: sha("b"),
    fundPolicySnapshotId: "fund_policy_1",
    forceRefresh: true,
    refreshNonce: "refresh_1",
    rerunOfId: batch.id,
  });
  await runs.saveSelections({
    batchId: refresh.id,
    selections: [{
      dealId: "deal_1",
      status: "selected",
      rank: 1,
      reason: "Refresh partial underwriting.",
    }],
  });
  const [refreshedCandidate] = await runs.createSelectedCandidates({
    batchId: refresh.id,
    dealIds: ["deal_1"],
  });
  assert.notEqual(refreshedCandidate?.id, candidate?.id);
  assert.equal(refreshedCandidate?.rerunOfId, candidate?.id);
});
