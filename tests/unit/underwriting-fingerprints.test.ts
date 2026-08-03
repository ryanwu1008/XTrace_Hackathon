import assert from "node:assert/strict";
import test from "node:test";

import {
  createBatchInputFingerprint,
  createCandidateAnalysisFingerprint,
  createReferenceCatalogSnapshot,
  type BatchFingerprintInput,
  type CandidateFingerprintInput,
} from "../../lib/underwriting/fingerprints";

function batchInput(): BatchFingerprintInput {
  return {
    workspaceId: "workspace_1",
    evidenceFrame: {
      schemaVersion: "underwriting-evidence-frame-v1",
      evidenceMode: "pinned",
      contextFingerprint: `sha256:${"a".repeat(64)}`,
      eventSetFingerprint: `sha256:${"b".repeat(64)}`,
      bindingFingerprint: `sha256:${"c".repeat(64)}`,
      snapshotFingerprint: `sha256:${"d".repeat(64)}`,
    },
    window: {
      days: 14,
      startsAt: "2026-07-15T00:00:00.000Z",
      endsAt: "2026-07-29T00:00:00.000Z",
    },
    marketSnapshot: {
      id: "market_snapshot_1",
      fingerprint: `sha256:${"1".repeat(64)}`,
    },
    eligibleDealRevisions: [
      {
        dealId: "deal_b",
        status: "screening",
        sourceRevisionIds: ["revision_2", "revision_1"],
        fingerprint: `sha256:${"2".repeat(64)}`,
      },
      {
        dealId: "deal_a",
        status: "passed",
        sourceRevisionIds: ["revision_3"],
        fingerprint: `sha256:${"3".repeat(64)}`,
      },
    ],
    xtraceLineage: {
      memoryIds: ["memory_2", "memory_1"],
      sourceRevisionIds: ["revision_3", "revision_1"],
      sourceIds: ["source_2", "source_1"],
      fixtureIds: ["fixture_1"],
      capturedAt: "2026-07-29T00:00:00.000Z",
    },
    selectedEvents: [
      {
        id: "event_b",
        fingerprint: `sha256:${"4".repeat(64)}`,
      },
      {
        id: "event_a",
        fingerprint: `sha256:${"5".repeat(64)}`,
      },
    ],
    matching: {
      providerModel: "claude-sonnet-4-5",
      promptVersion: "matching-prompt-v1",
      schemaVersion: "matching-schema-v1",
      scoringPolicyVersion: "score-v1",
      selectionPolicyVersion: "top-five-v1",
      judgmentFingerprint: `sha256:${"6".repeat(64)}`,
    },
    fundPolicySnapshot: {
      id: "fund_policy_1",
      version: 1,
      fingerprint: `sha256:${"7".repeat(64)}`,
    },
    frameworkPack: {
      id: "framework_pack_1",
      version: "1",
    },
    routerVersion: "router-v1",
    decisionPolicy: {
      id: "decision_policy_1",
      version: "1",
    },
    referenceCatalog: createReferenceCatalogSnapshot([
      reference("critical_evidence_profile", "critical_1", "1"),
      reference("benchmark_definition", "benchmark_entry_1", "2", {
        parentId: "benchmark_1",
      }),
      reference("valuation_method_policy", "valuation_policy_1", "3"),
      reference("framework_pack", "framework_pack_1", "4"),
      reference("decision_policy", "decision_policy_1", "5"),
    ]),
  };
}

function candidateInput(): CandidateFingerprintInput {
  return {
    workspaceId: "workspace_1",
    batchInputFingerprint: createBatchInputFingerprint(batchInput()),
    dealRevision: {
      dealId: "deal_a",
      status: "passed",
      sourceRevisionIds: ["revision_3", "revision_1"],
      fingerprint: `sha256:${"8".repeat(64)}`,
    },
    evidencePack: {
      id: "evidence_pack_1",
      version: 1,
      sourceRevisionIds: ["revision_3", "revision_1"],
      fingerprint: `sha256:${"9".repeat(64)}`,
    },
    evidenceSourceIds: ["source_2", "source_1"],
    context: {
      id: "context_1",
      contextVersion: "1",
      criticalEvidenceProfileId: "critical_1",
      benchmarkPackId: "benchmark_1",
      valuationMethodPolicyId: "valuation_policy_1",
      frameworkPackId: "framework_pack_1",
      decisionPolicyId: "decision_policy_1",
    },
    criticalEvidenceProfile:
      reference("critical_evidence_profile", "critical_1", "1"),
    benchmark: reference(
      "benchmark_definition",
      "benchmark_entry_1",
      "2",
      { parentId: "benchmark_1" },
    ),
    valuationMethodPolicy:
      reference("valuation_method_policy", "valuation_policy_1", "3"),
    frameworkPack: reference("framework_pack", "framework_pack_1", "4"),
    decisionPolicy: reference("decision_policy", "decision_policy_1", "5"),
    referenceCatalogFingerprint:
      batchInput().referenceCatalog.definitionFingerprint,
    frameworkCatalog: {
      version: "research-framework-catalog-v1",
      fingerprint: `sha256:${"b".repeat(64)}`,
      corpusDigest: `sha256:${"c".repeat(64)}`,
    },
    formulaVersions: [
      "venture_return_method_v1@1",
      "market_comps_v1@1",
    ],
    providerModel: "claude-sonnet-4-5",
    promptVersion: "underwriting-prompt-v1",
    schemaVersion: "underwriting-schema-v1",
    settingsFingerprint: `sha256:${"a".repeat(64)}`,
    applicationCommit: "0002f6b",
  };
}

test("batch fingerprint is canonical over unordered revision, event, and lineage sets", () => {
  const left = batchInput();
  const right = batchInput();
  right.eligibleDealRevisions.reverse();
  right.eligibleDealRevisions[0].sourceRevisionIds.reverse();
  right.selectedEvents.reverse();
  right.xtraceLineage.memoryIds.reverse();
  right.xtraceLineage.sourceRevisionIds.reverse();
  right.xtraceLineage.sourceIds.reverse();

  const fingerprint = createBatchInputFingerprint(left);
  assert.match(fingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.equal(createBatchInputFingerprint(right), fingerprint);
});

test("batch fingerprint changes for every required execution dimension", () => {
  const baseline = createBatchInputFingerprint(batchInput());
  const mutations: Array<(input: BatchFingerprintInput) => void> = [
    (input) => {
      input.workspaceId = "workspace_2";
    },
    (input) => {
      input.window.startsAt = "2026-07-14T00:00:00.000Z";
    },
    (input) => {
      input.marketSnapshot.fingerprint = `sha256:${"b".repeat(64)}`;
    },
    (input) => {
      input.eligibleDealRevisions[0].fingerprint =
        `sha256:${"c".repeat(64)}`;
    },
    (input) => {
      input.xtraceLineage.memoryIds.push("memory_3");
    },
    (input) => {
      input.selectedEvents[0].fingerprint = `sha256:${"d".repeat(64)}`;
    },
    (input) => {
      input.matching.providerModel = "claude-opus-4-1";
    },
    (input) => {
      input.matching.promptVersion = "matching-prompt-v2";
    },
    (input) => {
      input.matching.schemaVersion = "matching-schema-v2";
    },
    (input) => {
      input.matching.scoringPolicyVersion = "score-v2";
    },
    (input) => {
      input.matching.selectionPolicyVersion = "top-five-v2";
    },
    (input) => {
      input.matching.judgmentFingerprint = `sha256:${"e".repeat(64)}`;
    },
    (input) => {
      input.fundPolicySnapshot.fingerprint = `sha256:${"f".repeat(64)}`;
    },
    (input) => {
      input.frameworkPack.version = "2";
    },
    (input) => {
      input.routerVersion = "router-v2";
    },
    (input) => {
      input.decisionPolicy.version = "2";
    },
  ];

  for (const mutate of mutations) {
    const input = batchInput();
    mutate(input);
    assert.notEqual(createBatchInputFingerprint(input), baseline);
  }
});

test("batch fingerprint binds every field of the exact evidence frame", () => {
  const baseline = createBatchInputFingerprint(batchInput());
  const mutations: Array<(input: BatchFingerprintInput) => void> = [
    (input) => { input.evidenceFrame.evidenceMode = "live"; input.evidenceFrame.snapshotFingerprint = null; },
    (input) => { input.evidenceFrame.contextFingerprint = `sha256:${"1".repeat(64)}`; },
    (input) => { input.evidenceFrame.eventSetFingerprint = `sha256:${"2".repeat(64)}`; },
    (input) => { input.evidenceFrame.bindingFingerprint = `sha256:${"3".repeat(64)}`; },
    (input) => { input.evidenceFrame.snapshotFingerprint = `sha256:${"4".repeat(64)}`; },
  ];
  for (const mutate of mutations) {
    const input = batchInput();
    mutate(input);
    assert.notEqual(createBatchInputFingerprint(input), baseline);
  }
});

test("candidate fingerprint is canonical and binds all candidate-specific versions", () => {
  const baselineInput = candidateInput();
  const reordered = candidateInput();
  reordered.dealRevision.sourceRevisionIds.reverse();
  reordered.evidencePack.sourceRevisionIds.reverse();
  reordered.evidenceSourceIds.reverse();
  reordered.formulaVersions.reverse();

  const baseline = createCandidateAnalysisFingerprint(baselineInput);
  assert.match(baseline, /^sha256:[0-9a-f]{64}$/);
  assert.equal(createCandidateAnalysisFingerprint(reordered), baseline);

  const mutations: Array<(input: CandidateFingerprintInput) => void> = [
    (input) => {
      input.batchInputFingerprint = `sha256:${"b".repeat(64)}`;
    },
    (input) => {
      input.dealRevision.fingerprint = `sha256:${"c".repeat(64)}`;
    },
    (input) => {
      input.evidencePack.fingerprint = `sha256:${"d".repeat(64)}`;
    },
    (input) => {
      input.evidenceSourceIds.push("source_3");
    },
    (input) => {
      input.context.contextVersion = "2";
    },
    (input) => {
      input.criticalEvidenceProfile.version = "2";
    },
    (input) => {
      input.benchmark = null;
    },
    (input) => {
      input.valuationMethodPolicy.version = "2";
    },
    (input) => {
      input.formulaVersions.push("future_dilution_v1@2");
    },
    (input) => {
      input.providerModel = "claude-opus-4-1";
    },
    (input) => {
      input.promptVersion = "underwriting-prompt-v2";
    },
    (input) => {
      input.schemaVersion = "underwriting-schema-v2";
    },
    (input) => {
      input.settingsFingerprint = `sha256:${"e".repeat(64)}`;
    },
    (input) => {
      input.applicationCommit = "different";
    },
  ];
  for (const mutate of mutations) {
    const input = candidateInput();
    mutate(input);
    assert.notEqual(createCandidateAnalysisFingerprint(input), baseline);
  }
});

test("batch and candidate fingerprints bind every effective reference definition digest", () => {
  const batch = batchInput();
  const changedBatch = structuredClone(batch);
  changedBatch.referenceCatalog =
    createReferenceCatalogSnapshot(changedBatch.referenceCatalog.definitions
      .map((definition, index) => index === 0
        ? {
            ...definition,
            definitionFingerprint: `sha256:${"f".repeat(64)}`,
          }
        : definition));
  assert.notEqual(
    createBatchInputFingerprint(batch),
    createBatchInputFingerprint(changedBatch),
  );

  const candidate = candidateInput();
  candidate.referenceCatalogFingerprint = `sha256:${"0".repeat(64)}`;
  candidate.criticalEvidenceProfile.definitionFingerprint =
    `sha256:${"1".repeat(64)}`;
  candidate.benchmark!.definitionFingerprint =
    `sha256:${"2".repeat(64)}`;
  candidate.valuationMethodPolicy.definitionFingerprint =
    `sha256:${"3".repeat(64)}`;
  candidate.frameworkPack =
    reference("framework_pack", "framework_pack_1", "4");
  candidate.decisionPolicy =
    reference("decision_policy", "decision_policy_1", "5");
  const baseline = createCandidateAnalysisFingerprint(candidate);
  for (
    const field of [
      "criticalEvidenceProfile",
      "benchmark",
      "valuationMethodPolicy",
      "frameworkPack",
      "decisionPolicy",
    ] as const
  ) {
    const changed = structuredClone(candidate);
    changed[field]!.definitionFingerprint = `sha256:${"f".repeat(64)}`;
    assert.notEqual(
      createCandidateAnalysisFingerprint(changed),
      baseline,
      `${field} digest must be identity-bearing`,
    );
  }
  const changedCatalog = structuredClone(candidate);
  changedCatalog.referenceCatalogFingerprint =
    `sha256:${"e".repeat(64)}`;
  assert.notEqual(
    createCandidateAnalysisFingerprint(changedCatalog),
    baseline,
  );
});

test("candidate fingerprints bind the selected research catalog and audited corpus", () => {
  const baseline = createCandidateAnalysisFingerprint(candidateInput());
  const changedVersion = candidateInput();
  changedVersion.frameworkCatalog!.version =
    "research-framework-catalog-v2";
  const changedCatalog = candidateInput();
  changedCatalog.frameworkCatalog!.fingerprint =
    `sha256:${"d".repeat(64)}`;
  const changedCorpus = candidateInput();
  changedCorpus.frameworkCatalog!.corpusDigest =
    `sha256:${"e".repeat(64)}`;

  assert.notEqual(
    createCandidateAnalysisFingerprint(changedVersion),
    baseline,
  );
  assert.notEqual(
    createCandidateAnalysisFingerprint(changedCatalog),
    baseline,
  );
  assert.notEqual(
    createCandidateAnalysisFingerprint(changedCorpus),
    baseline,
  );
});

function reference(
  kind:
    | "critical_evidence_profile"
    | "benchmark_definition"
    | "valuation_method_policy"
    | "decision_policy"
    | "framework_pack",
  id: string,
  digit: string,
  options: { parentId?: string } = {},
) {
  return {
    kind,
    id,
    version: "1",
    ...(options.parentId ? { parentId: options.parentId } : {}),
    definitionFingerprint: `sha256:${digit.repeat(64)}`,
  };
}
