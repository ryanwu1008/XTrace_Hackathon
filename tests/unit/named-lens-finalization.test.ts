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
} from "../../lib/contracts/underwriting";
import type {
  NamedLensDisposition,
  NamedLensPassage,
  NamedLensPresentation,
  NamedLensProviderAttempt,
  NamedLensProviderAttemptRef,
} from "../../lib/contracts/named-lens";

const sha = (digit: string) => `sha256:${digit.repeat(64)}`;

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
      id: `judgment_${ordinal}`,
      analysisType: "framework_judgment",
      frameworkCardId: `CARD-${ordinal}`,
      frameworkVersion: "1.0.0",
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
      componentFrameworkId: judgment.frameworkCardId,
      componentVersion: judgment.frameworkVersion,
      cardFieldRef: "decisionQuestions[0]",
      publicSourceIds: [`source_${index + 1}`],
      claimIds: [`CLAIM-${index + 1}`],
      locator: { kind: "web_section", value: `Section ${index + 1}` },
      attributionScope: "person_direct",
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
  const presentation = {
    schemaVersion: "decision-first-named-lens-v1",
    rendererVersion: "named-lens-renderer-v1",
    workspaceId: "workspace_1",
    artifactSourceCandidateRunId: "candidate_1",
    synthesis: {
      branch: "principal_disagreement",
      text: "The selected readings disagree on customer adoption.",
      judgmentIds: passages.map(({ judgmentId }) => judgmentId),
      evidenceItemIds: passages.map((_, index) => `fact_${index + 1}`),
    },
    segmentCitations: passages.map((passage, index) => ({
      judgmentId: passage.judgmentId,
      segment: "case_application",
      evidenceItemIds: [`fact_${index + 1}`],
      publicSourceIds: [],
      claimIds: [],
    })),
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
      judgmentId: "judgment_2",
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
