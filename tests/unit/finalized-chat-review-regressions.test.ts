import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFinalizedChatProjectionV2,
  type BuildFinalizedChatProjectionV2Input,
} from "../../lib/chat/finalized-projection";
import {
  DecisionCriticalEvidenceProjectionSchema,
  NamedLensFinalizationDispositionSchema,
  NamedLensPassageSchema,
  NamedLensPresentationSchema,
} from "../../lib/contracts/named-lens";

const sha = (digit: string) => `sha256:${digit.repeat(64)}`;

function inputFor(input: {
  topic: BuildFinalizedChatProjectionV2Input["topic"];
  contextOnly?: boolean;
  requestBoundaries?: boolean;
}): BuildFinalizedChatProjectionV2Input {
  const selectionBasisEvidenceIds = input.contextOnly
    ? []
    : ["evidence_case"];
  const counterEvidenceItemIds = input.requestBoundaries
    ? []
    : ["evidence_counter"];
  const counterEvidenceRequestRefs = input.requestBoundaries
    ? ["request_counterevidence"]
    : [];
  const disposition = {
    workspaceId: "workspace_review",
    artifactSourceCandidateRunId: "candidate_review",
    judgmentOrCatalogCandidateId: "judgment_review",
    judgmentId: "judgment_review",
    frameworkCardId: "framework_review",
    frameworkVersion: "1",
    disposition: "appendix_only" as const,
    selectedPosition: null,
    priorityTier: input.contextOnly
      ? "context_only" as const
      : "changed_belief" as const,
    reasonCodes: input.contextOnly
      ? ["CONTEXT_ONLY"]
      : ["DUPLICATE_DECISION_RATIONALE"],
    decisionQuestionCode: "customer_adoption" as const,
    stance: "supportive" as const,
    advisoryPosture: "supports_further_diligence" as const,
    selectionBasisEvidenceIds,
    criticalEvidence: selectionBasisEvidenceIds.map((evidencePackItemId) => ({
      evidencePackItemId,
      classification: "assumption" as const,
      originRefs: [{ kind: "blocking_evidence" as const, id: "blocker" }],
      reasonCodes: ["FORMAL_DECISION_BLOCKER"],
      resolutionPath: [evidencePackItemId],
    })),
    selectionPolicyVersion: "named-lens-selection-v1" as const,
    passageFingerprint: sha("1"),
    fingerprint: sha("2"),
    decisionCriticalEvidenceProjectionId: "projection_review",
    decisionCriticalEvidenceProjectionFingerprint: sha("3"),
  };
  const passage = {
    schemaVersion: "named-lens-passage-v1" as const,
    workspaceId: "workspace_review",
    artifactSourceCandidateRunId: "candidate_review",
    judgmentId: "judgment_review",
    frameworkCardId: "framework_review",
    frameworkVersion: "1",
    decisionQuestionCode: "customer_adoption" as const,
    evidenceDomainCodes: ["customer" as const],
    premise: {
      text: "The public framework tests durable customer demand.",
      componentFrameworkId: "component_review",
      componentVersion: "1",
      cardFieldRef: "decisionQuestions[0]",
      publicSourceIds: ["public_source_review"],
      claimIds: ["public_claim_review"],
      locator: { kind: "web_section" as const, value: "Customer demand" },
      attributionScope: "person_direct" as const,
    },
    caseApplication: {
      text: "Saved company evidence applies the framework.",
      evidenceItemIds: ["evidence_case"],
    },
    countercase: {
      text: "Saved counterevidence or its request limits the conclusion.",
      boundaryKind: input.requestBoundaries
        ? "no_candidate_local_counterevidence" as const
        : "grounded_counterevidence" as const,
      evidenceItemIds: counterEvidenceItemIds,
      evidenceRequestRefs: counterEvidenceRequestRefs,
    },
    unknownBoundary: {
      text: "A saved unknown defines the diligence boundary.",
      judgmentUnknownRefs: ["Unknown customer durability."],
      judgmentLimitationRefs: ["One signal remains bounded."],
      evidenceRequestRefs: input.requestBoundaries
        ? ["request_customer_durability"]
        : [],
    },
    conditionalConclusion: {
      text: "The view remains conditional on resolving the saved unknown.",
      stance: "supportive" as const,
      advisoryPosture: "supports_further_diligence" as const,
    },
    advisoryContract: {
      formalDecisionWeight: "0" as const,
      noEndorsement: true as const,
      namedPersonImpersonation: false as const,
      hiddenChainOfThought: false as const,
    },
    selectionBasisEvidenceIds,
    wordCount: 45,
    generatorVersion: "named-lens-generator-v1" as const,
    fingerprint: sha("1"),
  };
  return {
    topic: input.topic,
    requestedLensDisplayIdentity: "Review Lens",
    identity: {
      workspaceId: "workspace_review",
      reportId: "report_review",
      runId: "run_review",
      dealId: "deal_review",
      candidateRunId: "candidate_alias_review",
    },
    evidenceFrame: { state: "legacy_unbound" },
    presentationIdentity: {
      adapterSchemaVersion: "decision-first-named-lens-v1",
      sourceCandidateRunId: "candidate_review",
      presentationReportId: "report_review",
      presentationSchemaVersion: "decision-first-named-lens-v1",
      presentationFingerprint: sha("4"),
      criticalEvidenceProjectionFingerprint: sha("3"),
      finalDispositionsFingerprint: sha("5"),
    },
    decisionCriticalEvidenceProjection: {
      id: "projection_review",
      workspaceId: "workspace_review",
      artifactSourceCandidateRunId: "candidate_review",
      evidenceRefs: disposition.criticalEvidence,
      fingerprint: sha("3"),
    },
    dispositions: [disposition],
    passages: [passage],
    presentation: {
      schemaVersion: "decision-first-named-lens-v1",
      rendererVersion: "renderer_review",
      workspaceId: "workspace_review",
      artifactSourceCandidateRunId: "candidate_review",
      synthesis: {
        branch: "single_perspective",
        text: "One bounded perspective remains available.",
        judgmentIds: ["judgment_review"],
        evidenceItemIds: selectionBasisEvidenceIds,
      },
      segmentCitations: [{
        judgmentId: "judgment_review",
        segment: "unknown_boundary",
        evidenceItemIds: [],
        publicSourceIds: [],
        claimIds: [],
        judgmentUnknownRefs: ["Unknown customer durability."],
        judgmentLimitationRefs: ["One signal remains bounded."],
        evidenceRequestRefs: input.requestBoundaries
          ? ["request_customer_durability"]
          : [],
        stanceRefs: [],
        advisoryPostureRefs: [],
      }],
      firstScreenProjectionRefs: {
        decisionId: "decision_review",
        decisionEvidenceItemIds: selectionBasisEvidenceIds,
        selectedJudgmentIds: [],
      },
      fingerprint: sha("4"),
    },
    lensDisplayIdentities: [{
      judgmentId: "judgment_review",
      frameworkCardId: "framework_review",
      componentFrameworkId: "component_review",
      publicDisplayIdentity: "Review Lens",
      displayName: "Review Lens",
      attributionDisplay: "Review Lens",
    }],
    evidenceItems: ["evidence_case", ...counterEvidenceItemIds].map(
      (evidencePackItemId) => ({
        evidencePackItemId,
        classification: "assumption" as const,
        sourceRef: null,
      }),
    ),
  };
}

test("appendix-only selection reason never calls the saved passage unpublishable", () => {
  const input = inputFor({
    topic: "named_lens_selection_reason",
  });
  assert.ok(DecisionCriticalEvidenceProjectionSchema.safeParse(
    input.decisionCriticalEvidenceProjection,
  ).success);
  assert.ok(NamedLensFinalizationDispositionSchema.safeParse(
    input.dispositions[0],
  ).success);
  assert.ok(NamedLensPassageSchema.safeParse(input.passages[0]).success);
  assert.ok(NamedLensPresentationSchema.safeParse(input.presentation).success);
  const result = buildFinalizedChatProjectionV2(input);
  assert.equal(result.status, "success", JSON.stringify(result));
  if (result.status !== "success") return;
  const text = result.projection.claims.map((claim) => claim.text).join("\n");
  assert.match(text, /retains this complete perspective in its audit Appendix/u);
  assert.doesNotMatch(text, /not publishable/u);
});

test("context-only selection reason says the Appendix passage is background, not main-memo analysis", () => {
  const result = buildFinalizedChatProjectionV2(inputFor({
    topic: "named_lens_selection_reason",
    contextOnly: true,
  }));
  assert.equal(result.status, "success", JSON.stringify(result));
  if (result.status !== "success") return;
  const text = result.projection.claims.map((claim) => claim.text).join("\n");
  assert.match(text, /background context/u);
  assert.match(text, /rather than the main reading flow/u);
  assert.doesNotMatch(text, /not publishable/u);
});

test("exact-evidence case and counter claims cite their persisted evidence ID fields", () => {
  const result = buildFinalizedChatProjectionV2(inputFor({
    topic: "named_lens_exact_evidence",
  }));
  assert.equal(result.status, "success", JSON.stringify(result));
  if (result.status !== "success") return;
  const paths = result.projection.claims.flatMap((claim) =>
    claim.artifactRefs.map((ref) => ref.fieldPath)
  );
  assert.ok(paths.includes("caseApplication.evidenceItemIds"));
  assert.ok(paths.includes("countercase.evidenceItemIds"));
});

test("view-change boundaries cite persisted evidence and evidence-request ID fields", () => {
  const result = buildFinalizedChatProjectionV2(inputFor({
    topic: "named_lens_view_change",
    requestBoundaries: true,
  }));
  assert.equal(result.status, "success", JSON.stringify(result));
  if (result.status !== "success") return;
  const paths = result.projection.claims.flatMap((claim) =>
    claim.artifactRefs.map((ref) => ref.fieldPath)
  );
  assert.ok(paths.includes("countercase.evidenceItemIds"));
  assert.ok(paths.includes("countercase.evidenceRequestRefs"));
  assert.ok(paths.includes("unknownBoundary.judgmentUnknownRefs"));
  assert.ok(paths.includes("unknownBoundary.judgmentLimitationRefs"));
  assert.ok(paths.includes("unknownBoundary.evidenceRequestRefs"));
});
