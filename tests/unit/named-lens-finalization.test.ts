import assert from "node:assert/strict";
import test from "node:test";

import {
  candidateRunStatusForFinalization,
  createMemoryUnderwritingRunsRepository,
} from "../../db/repositories/underwriting-runs";
import {
  createMemoryUnderwritingArtifactsRepository,
  validateNamedLensFinalization,
  type CandidateArtifactBundle,
  type CandidateFinalization,
} from "../../db/repositories/underwriting-artifacts";
import { createMemoryEvidencePacksRepository } from
  "../../db/repositories/evidence-packs";
import type { EvidencePack } from "../../lib/contracts/evidence";
import type {
  DecisionResult,
  FrameworkJudgment,
  ResolvedUnderwritingContext,
} from "../../lib/contracts/underwriting";
import type {
  NamedLensDisposition,
  NamedLensPassage,
  NamedLensPresentation,
  NamedLensProviderAttempt,
  NamedLensProviderAttemptRef,
} from "../../lib/contracts/named-lens";
import {
  authorizedResearchComposites,
  loadResearchFrameworkCatalog,
} from "../../lib/underwriting/frameworks/research-loader";

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
  const judgments = Array.from({ length: 4 }, (_, index) => {
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
      resolutionPath: [`rule_${index + 1}`, `fact_${index + 1}`],
    }],
    selectionPolicyVersion: "named-lens-selection-v1",
    passageFingerprint: passage.fingerprint,
    fingerprint: sha(String(index + 5)),
  } satisfies NamedLensDisposition));
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
    attemptRefs,
    persistedAttempts: attempts,
    dispositions,
    passages,
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
      failureReason: {
        code: "provider_error" as const,
        detail: "Provider failed.",
        retryable: false,
      },
    })),
  }), /completed attempt|publishable|passage/i);
});

test("requires four to six grounded selections only for completed results", () => {
  const onlyThree = currentArtifacts(3);
  assert.throws(() => validateNamedLensFinalization(onlyThree), /four|4|six|6/i);
  assert.doesNotThrow(() => validateNamedLensFinalization({
    ...onlyThree,
    terminalStatus: "partial",
    terminalReasonCodes: ["FRAMEWORK_COVERAGE_INCOMPLETE"],
  }));
});

test("resolves critical, passage, and disposition refs to the saved pack and judgment", () => {
  const valid = currentArtifacts();
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
  }), /judgment|identity/i);
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

test("persists attempt transitions before finalization and keeps partial artifacts canonical-only", async () => {
  const current = currentArtifacts();
  const repository = createMemoryUnderwritingArtifactsRepository();
  const reserved = {
    ...current.persistedAttempts[0]!,
    status: "reserved" as const,
    telemetry: null,
  };
  repository.recordNamedLensProviderAttempt(reserved);
  repository.recordNamedLensProviderAttempt(current.persistedAttempts[0]!);
  assert.throws(() => repository.recordNamedLensProviderAttempt({
    ...current.persistedAttempts[0]!,
    attemptFingerprint: sha("0"),
  }), /immutable|identity|attempt/i);

  const partial = {
    candidateRunId: "candidate_1",
    workspaceId: "workspace_1",
    dealId: "deal_1",
    candidateAnalysisFingerprint: sha("a"),
    terminalStatus: "partial",
  } as unknown as CandidateArtifactBundle;
  repository.commitPrepared(partial);
  assert.equal(await repository.findReusable({
    workspaceId: "workspace_1",
    candidateAnalysisFingerprint: partial.candidateAnalysisFingerprint,
  }), null);
  assert.throws(() => repository.aliasCandidate({
    workspaceId: "workspace_1",
    candidateRunId: "candidate_alias",
    sourceCandidateRunId: "candidate_1",
    dealId: "deal_1",
    candidateAnalysisFingerprint: partial.candidateAnalysisFingerprint,
  }), /partial|reusable/i);
  assert.equal(candidateRunStatusForFinalization(partial), "partial");
});

test("a partial finalization marks its Candidate partial and cannot enter reuse", async () => {
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
    workspaceId: "workspace_1",
    dealId: "deal_1",
    candidateAnalysisFingerprint: sha("a"),
    terminalStatus: "partial",
  } as unknown as CandidateArtifactBundle;
  artifacts.prepareFinalization = () => partialBundle;
  const result = await runs.finalizeCandidate({
    workerId: "worker_1",
    leaseToken: claimed!.leaseToken,
    candidateRunId: candidate!.id,
    candidateAnalysisFingerprint: sha("a"),
    evidencePackBuildInputFingerprint: sha("e"),
    evidencePack,
  } as unknown as CandidateFinalization);

  assert.equal(result.status, "partial");
  assert.equal(await artifacts.findReusable({
    workspaceId: "workspace_1",
    candidateAnalysisFingerprint: sha("a"),
  }), null);
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
