import assert from "node:assert/strict";
import test from "node:test";

import {
  PINNED_THIRTY_DEAL_SNAPSHOT_ID,
} from "../../lib/belief-reversal/pinned-thirty-deal-snapshot";
import {
  UnderwritingPresentationIntegrityError,
  resolveUnderwritingPresentationAdapter,
  type UnderwritingPresentationIdentityInput,
} from "../../lib/underwriting/presentation-version";
import { createCurrentNamedLensFinalizationFixture } from
  "../helpers/current-named-lens-finalization";
import {
  createDecisionCriticalEvidenceProjectionFingerprint,
  createNamedLensSemanticFingerprints,
} from "../../lib/underwriting/named-lens-presentation";

const sha = (digit: string) => `sha256:${digit.repeat(64)}`;

function legacyPrePassageInput(): UnderwritingPresentationIdentityInput {
  return {
    report: {
      id: "report_legacy_30",
      workspaceId: "workspace_1",
      evidenceContext: { state: "legacy_unbound" },
    },
    requestedDealId: "deal_1",
    candidate: {
      id: "candidate_legacy_30",
      workspaceId: "workspace_1",
      dealId: "deal_1",
      artifactSourceCandidateRunId: null,
    },
    bundle: {
      candidateRunId: "candidate_legacy_30",
      sourceCandidateRunId: "candidate_legacy_30",
      workspaceId: "workspace_1",
      dealId: "deal_1",
      versionSnapshot: {
        schemaVersion: "framework-judgment-v1",
        settingsFingerprint: "belief-reversal-task12-v1",
        applicationCommit: "task12-local-e2e",
      },
    },
  };
}

function pinned23Input(): UnderwritingPresentationIdentityInput {
  const input = legacyPrePassageInput();
  return {
    ...input,
    report: {
      id: "report_pinned_23",
      workspaceId: "workspace_1",
      evidenceContext: {
        state: "current",
        schemaVersion: "run-evidence-context-v1",
        evidenceMode: "pinned",
        windowDays: 14,
        anchorAt: "2026-08-01T23:59:59.000Z",
        windowStartAt: "2026-07-19T00:00:00.000Z",
        windowEndAt: "2026-08-01T23:59:59.000Z",
        windowTimezone: "America/Los_Angeles",
        snapshotId: "belief_reversal_2026_08_01",
        snapshotFingerprint: sha("1"),
        contextFingerprint: sha("2"),
        displayLabel: "Demo evidence snapshot as of 2026-08-01",
        eventCount: 4,
        eventSetFingerprint: sha("3"),
        bindingFingerprint: sha("4"),
      },
    },
  };
}

function currentInput(): UnderwritingPresentationIdentityInput {
  const fixture = createCurrentNamedLensFinalizationFixture();
  const finalization = structuredClone(fixture.finalization);
  const input: UnderwritingPresentationIdentityInput = {
    report: {
      id: "report_current",
      workspaceId: "workspace_current",
      evidenceContext: {
        state: "current",
        schemaVersion: "run-evidence-context-v1",
        evidenceMode: "live",
        windowDays: 14,
        anchorAt: "2026-08-10T12:00:00.000Z",
        windowStartAt: "2026-07-28T00:00:00.000Z",
        windowEndAt: "2026-08-10T12:00:00.000Z",
        windowTimezone: "America/Los_Angeles",
        snapshotId: null,
        snapshotFingerprint: null,
        contextFingerprint: sha("5"),
        displayLabel: "Live evidence through 2026-08-10",
        eventCount: 8,
        eventSetFingerprint: sha("6"),
        bindingFingerprint: sha("7"),
      },
    },
    requestedDealId: "deal_current",
    candidate: {
      id: "candidate_alias",
      workspaceId: "workspace_current",
      dealId: "deal_current",
      artifactSourceCandidateRunId: "candidate_current",
    },
    bundle: {
      candidateRunId: "candidate_alias",
      sourceCandidateRunId: "candidate_current",
      workspaceId: "workspace_current",
      dealId: "deal_current",
      versionSnapshot: finalization.versionSnapshot,
      judgments: finalization.judgments,
      decisionCriticalEvidenceProjection:
        finalization.decisionCriticalEvidenceProjection!,
      namedLensCatalogConsiderations:
        finalization.namedLensCatalogConsiderations!,
      namedLensAttemptRefs: finalization.namedLensAttemptRefs!,
      namedLensDispositions: finalization.namedLensDispositions!,
      namedLensPassages: finalization.namedLensPassages!,
      namedLensProviderAttempts: structuredClone(fixture.persistedAttempts),
      underwritingPresentationReportId:
        finalization.underwritingPresentationReportId!,
      namedLensPresentation: finalization.namedLensPresentation!,
    },
  };
  return input;
}

function expectIntegrityError(
  run: () => unknown,
  reason?: UnderwritingPresentationIntegrityError["reason"],
): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof UnderwritingPresentationIntegrityError);
    if (reason) assert.equal(error.reason, reason);
    return true;
  });
}

test("resolves only the exact approved pinned snapshot as legacy-pinned-23-v1", () => {
  assert.deepEqual(resolveUnderwritingPresentationAdapter(pinned23Input()), {
    kind: "legacy_pinned_23",
    schemaVersion: "legacy-pinned-23-v1",
  });

  for (const [field, value] of [
    ["schemaVersion", "unreviewed-schema"],
    ["settingsFingerprint", "unreviewed-settings"],
    ["applicationCommit", "unreviewed-commit"],
  ] as const) {
    const wrongExecution = pinned23Input();
    wrongExecution.bundle.versionSnapshot[field] = value;
    expectIntegrityError(
      () => resolveUnderwritingPresentationAdapter(wrongExecution),
      "unsupported_identity",
    );
  }

  for (const snapshotId of [
    PINNED_THIRTY_DEAL_SNAPSHOT_ID,
    "unreviewed_snapshot",
  ]) {
    const wrongSnapshot = pinned23Input();
    if (wrongSnapshot.report.evidenceContext?.state === "current") {
      wrongSnapshot.report.evidenceContext.snapshotId = snapshotId;
    }
    wrongSnapshot.bundle.versionSnapshot = {
      schemaVersion: "unreviewed",
      settingsFingerprint: "unreviewed",
      applicationCommit: "unreviewed",
    };
    expectIntegrityError(
      () => resolveUnderwritingPresentationAdapter(wrongSnapshot),
      "unsupported_identity",
    );
  }
});

test("resolves only the finite reviewed pre-passage tuple", () => {
  const input = legacyPrePassageInput();
  assert.deepEqual(resolveUnderwritingPresentationAdapter(input), {
    kind: "legacy_pre_passage_30",
    schemaVersion: "legacy-pre-passage-30-v1",
  });

  for (const [field, value] of [
    ["schemaVersion", "schema-v1"],
    ["settingsFingerprint", "some-other-settings"],
    ["applicationCommit", "some-other-commit"],
  ] as const) {
    const changed = legacyPrePassageInput();
    changed.bundle.versionSnapshot[field] = value;
    expectIntegrityError(
      () => resolveUnderwritingPresentationAdapter(changed),
      "unsupported_identity",
    );
  }
});

test("legacy pre-passage reports may retain their reviewed framework catalog identity", () => {
  const input = legacyPrePassageInput();
  input.bundle.versionSnapshot.frameworkCatalogVersion =
    "framework-catalog-v1";
  input.bundle.versionSnapshot.frameworkCatalogFingerprint = sha("8");
  input.bundle.versionSnapshot.frameworkCorpusDigest = sha("9");

  assert.deepEqual(resolveUnderwritingPresentationAdapter(input), {
    kind: "legacy_pre_passage_30",
    schemaVersion: "legacy-pre-passage-30-v1",
  });
});

test("company count and date metadata cannot affect adapter dispatch", () => {
  const input = legacyPrePassageInput() as UnderwritingPresentationIdentityInput
    & { companyCount?: number; createdAt?: string };
  input.companyCount = 23;
  input.createdAt = "1900-01-01T00:00:00.000Z";
  assert.equal(
    resolveUnderwritingPresentationAdapter(input).kind,
    "legacy_pre_passage_30",
  );
  input.companyCount = 30;
  input.createdAt = "2099-12-31T23:59:59.000Z";
  assert.equal(
    resolveUnderwritingPresentationAdapter(input).kind,
    "legacy_pre_passage_30",
  );
});

test("resolves a complete current replay alias to decision-first-named-lens-v1", () => {
  assert.deepEqual(resolveUnderwritingPresentationAdapter(currentInput()), {
    kind: "current",
    schemaVersion: "decision-first-named-lens-v1",
  });

  const canonical = currentInput();
  canonical.candidate.id = "candidate_current";
  canonical.candidate.artifactSourceCandidateRunId = null;
  canonical.bundle.candidateRunId = "candidate_current";
  assert.equal(resolveUnderwritingPresentationAdapter(canonical).kind, "current");
});

test("the new pinned-30 identity uses current presentation only with a complete current artifact identity", () => {
  const currentPinned = currentInput();
  if (currentPinned.report.evidenceContext?.state !== "current") {
    throw new Error("Current presentation fixture lost its evidence context.");
  }
  currentPinned.report.evidenceContext.evidenceMode = "pinned";
  currentPinned.report.evidenceContext.snapshotId =
    PINNED_THIRTY_DEAL_SNAPSHOT_ID;
  currentPinned.report.evidenceContext.snapshotFingerprint = sha("a");
  assert.deepEqual(resolveUnderwritingPresentationAdapter(currentPinned), {
    kind: "current",
    schemaVersion: "decision-first-named-lens-v1",
  });

  const legacyTupleOnPinnedThirty = legacyPrePassageInput();
  legacyTupleOnPinnedThirty.report.evidenceContext = structuredClone(
    currentPinned.report.evidenceContext,
  );
  expectIntegrityError(
    () => resolveUnderwritingPresentationAdapter(legacyTupleOnPinnedThirty),
    "mixed_generation",
  );

  legacyTupleOnPinnedThirty.bundle.versionSnapshot
    .underwritingPresentationSchemaVersion = "decision-first-named-lens-v1";
  expectIntegrityError(
    () => resolveUnderwritingPresentationAdapter(legacyTupleOnPinnedThirty),
    "mixed_generation",
  );

  const currentOnPinnedTwentyThree = currentInput();
  currentOnPinnedTwentyThree.report.evidenceContext =
    pinned23Input().report.evidenceContext;
  expectIntegrityError(
    () => resolveUnderwritingPresentationAdapter(currentOnPinnedTwentyThree),
    "mixed_generation",
  );
});

test("validates current semantic fingerprints with formal judgment identity", () => {
  const input = currentInput();
  const formalJudgment = input.bundle.judgments?.find(
    ({ frameworkMetadata }) => frameworkMetadata === undefined,
  );
  assert.ok(formalJudgment);
  const evidenceRef = input.bundle.decisionCriticalEvidenceProjection!
    .evidenceRefs[0]!;
  evidenceRef.resolutionPath = [
    ...evidenceRef.resolutionPath,
    `framework_judgment:${formalJudgment.id}`,
  ];
  input.bundle.namedLensDispositions![0]!.criticalEvidence = [
    structuredClone(evidenceRef),
  ];
  const projectionFingerprint =
    createDecisionCriticalEvidenceProjectionFingerprint(
      input.bundle.decisionCriticalEvidenceProjection!.evidenceRefs,
      input.bundle.judgments,
    );
  input.bundle.decisionCriticalEvidenceProjection!.fingerprint =
    projectionFingerprint;
  input.bundle.namedLensDispositions![0]!
    .decisionCriticalEvidenceProjectionFingerprint = projectionFingerprint;
  const presentation = input.bundle.namedLensPresentation!;
  const presentationPayload = {
    schemaVersion: presentation.schemaVersion,
    rendererVersion: presentation.rendererVersion,
    workspaceId: presentation.workspaceId,
    artifactSourceCandidateRunId: presentation.artifactSourceCandidateRunId,
    synthesis: presentation.synthesis,
    segmentCitations: presentation.segmentCitations,
    firstScreenProjectionRefs: presentation.firstScreenProjectionRefs,
  };
  const semantic = createNamedLensSemanticFingerprints({
    evidenceRefs:
      input.bundle.decisionCriticalEvidenceProjection!.evidenceRefs,
    dispositions: input.bundle.namedLensDispositions!,
    passages: input.bundle.namedLensPassages!,
    presentation: presentationPayload,
    formalJudgments: input.bundle.judgments,
  });
  input.bundle.versionSnapshot.criticalEvidenceProjectionFingerprint =
    projectionFingerprint;
  input.bundle.versionSnapshot.finalDispositionsFingerprint =
    semantic.finalDispositionsFingerprint;
  input.bundle.versionSnapshot.presentationFingerprint =
    semantic.presentationFingerprint;
  presentation.fingerprint = semantic.presentationFingerprint;

  assert.equal(resolveUnderwritingPresentationAdapter(input).kind, "current");
});

test("rejects incomplete, null, unknown, and mixed generation identities", () => {
  const missingRow = currentInput();
  delete missingRow.bundle.namedLensPresentation;
  expectIntegrityError(
    () => resolveUnderwritingPresentationAdapter(missingRow),
    "missing_current_presentation",
  );

  const incomplete = currentInput();
  delete incomplete.bundle.versionSnapshot.presentationFingerprint;
  expectIntegrityError(
    () => resolveUnderwritingPresentationAdapter(incomplete),
    "incomplete_current_identity",
  );

  const undefinedRefresh = currentInput();
  undefinedRefresh.bundle.versionSnapshot.refreshNonce = undefined;
  expectIntegrityError(
    () => resolveUnderwritingPresentationAdapter(undefinedRefresh),
    "incomplete_current_identity",
  );

  const mixed = legacyPrePassageInput();
  mixed.bundle.versionSnapshot.underwritingPresentationSchemaVersion =
    "decision-first-named-lens-v1";
  expectIntegrityError(
    () => resolveUnderwritingPresentationAdapter(mixed),
    "mixed_generation",
  );

  const attemptsOnlyMixed = legacyPrePassageInput();
  attemptsOnlyMixed.bundle.namedLensProviderAttempts = structuredClone(
    createCurrentNamedLensFinalizationFixture().persistedAttempts,
  );
  expectIntegrityError(
    () => resolveUnderwritingPresentationAdapter(attemptsOnlyMixed),
    "mixed_generation",
  );

  const missingAttempts = currentInput();
  delete missingAttempts.bundle.namedLensProviderAttempts;
  expectIntegrityError(
    () => resolveUnderwritingPresentationAdapter(missingAttempts),
    "incomplete_current_identity",
  );

  const missingAttemptRefs = currentInput();
  delete missingAttemptRefs.bundle.namedLensAttemptRefs;
  expectIntegrityError(
    () => resolveUnderwritingPresentationAdapter(missingAttemptRefs),
    "incomplete_current_identity",
  );

  const unknown = legacyPrePassageInput();
  unknown.bundle.versionSnapshot = {
    schemaVersion: "unknown",
    settingsFingerprint: "unknown",
    applicationCommit: "unknown",
  };
  expectIntegrityError(
    () => resolveUnderwritingPresentationAdapter(unknown),
    "unsupported_identity",
  );

  const currentOnLegacyReport = currentInput();
  currentOnLegacyReport.report.evidenceContext = {
    state: "legacy_unbound",
  };
  expectIntegrityError(
    () => resolveUnderwritingPresentationAdapter(currentOnLegacyReport),
    "mixed_generation",
  );
});

test("absence of a presentation row cannot select the legacy pre-passage adapter", () => {
  const input = currentInput();
  input.bundle.versionSnapshot = {
    schemaVersion: "framework-judgment-v1",
    settingsFingerprint: "unreviewed-pre-passage",
    applicationCommit: "unreviewed-pre-passage",
  };
  delete input.bundle.namedLensPresentation;
  delete input.bundle.underwritingPresentationReportId;
  expectIntegrityError(
    () => resolveUnderwritingPresentationAdapter(input),
  );
});

test("rejects current cross-report, canonical-source, ownership, and fingerprint mismatches", () => {
  const mutations: Array<{
    name: string;
    reason: UnderwritingPresentationIntegrityError["reason"];
    mutate: (input: UnderwritingPresentationIdentityInput) => void;
  }> = [{
    name: "presentation report",
    reason: "cross_report_presentation",
    mutate: (input) => {
      input.bundle.underwritingPresentationReportId = "report_other";
    },
  }, {
    name: "requested alias",
    reason: "identity_mismatch",
    mutate: (input) => {
      input.bundle.candidateRunId = "candidate_other";
    },
  }, {
    name: "canonical source",
    reason: "identity_mismatch",
    mutate: (input) => {
      input.bundle.sourceCandidateRunId = "candidate_other";
    },
  }, {
    name: "presentation fingerprint",
    reason: "current_fingerprint_mismatch",
    mutate: (input) => {
      input.bundle.namedLensPresentation!.fingerprint = sha("e");
    },
  }, {
    name: "projection fingerprint",
    reason: "current_fingerprint_mismatch",
    mutate: (input) => {
      input.bundle.decisionCriticalEvidenceProjection!.fingerprint = sha("e");
    },
  }, {
    name: "final dispositions fingerprint",
    reason: "current_fingerprint_mismatch",
    mutate: (input) => {
      input.bundle.versionSnapshot.finalDispositionsFingerprint = sha("e");
    },
  }, {
    name: "persisted disposition content",
    reason: "current_fingerprint_mismatch",
    mutate: (input) => {
      input.bundle.namedLensDispositions![0]!.reasonCodes = [
        "MUTATED_REASON",
      ];
    },
  }, {
    name: "child ownership",
    reason: "current_artifact_ownership_mismatch",
    mutate: (input) => {
      input.bundle.namedLensPassages![0]!.artifactSourceCandidateRunId =
        "candidate_other";
    },
  }, {
    name: "provider attempt ownership",
    reason: "current_artifact_ownership_mismatch",
    mutate: (input) => {
      input.bundle.namedLensProviderAttempts![0]!.workspaceId =
        "workspace_other";
    },
  }, {
    name: "provider attempt reference identity",
    reason: "current_artifact_ownership_mismatch",
    mutate: (input) => {
      input.bundle.namedLensProviderAttempts![0]!.attemptFingerprint = sha("e");
    },
  }];

  for (const mutation of mutations) {
    const input = currentInput();
    mutation.mutate(input);
    expectIntegrityError(
      () => resolveUnderwritingPresentationAdapter(input),
      mutation.reason,
    );
  }
});
