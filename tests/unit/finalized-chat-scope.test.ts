import assert from "node:assert/strict";
import test from "node:test";

import type { RunRecord } from "../../db/client";
import type {
  IntelligenceReportRecord,
} from "../../db/repositories/intelligence";
import type {
  CandidateArtifactBundle,
} from "../../db/repositories/underwriting-artifacts";
import type {
  UnderwritingRunsRepository,
} from "../../db/repositories/underwriting-runs";
import {
  loadExactFinalizedChatScope,
} from "../../lib/chat/finalized-scope";
import type { CompanyAnalysis } from "../../lib/contracts/domain";
import type {
  CandidateRun,
  UnderwritingBatch,
} from "../../lib/contracts/underwriting";
import type {
  ResolvedReportEvidenceScope,
} from "../../lib/reports/evidence-scope";

const RUN_ID = "00000000-0000-4000-8000-000000000011";
const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;
const SHA_C = `sha256:${"c".repeat(64)}`;
const SHA_D = `sha256:${"d".repeat(64)}`;

const currentRunContext = {
  state: "current" as const,
  schemaVersion: "run-evidence-context-v1" as const,
  evidenceMode: "pinned" as const,
  windowDays: 14 as const,
  anchorAt: "2026-08-01T23:59:59.000Z",
  windowStartAt: "2026-07-19T00:00:00.000Z",
  windowEndAt: "2026-08-01T23:59:59.000Z",
  windowTimezone: "America/Los_Angeles",
  snapshotId: "belief_reversal_2026_08_01",
  snapshotFingerprint: SHA_A,
  contextFingerprint: SHA_B,
};

const currentReportContext = {
  ...currentRunContext,
  displayLabel: "Demo evidence snapshot as of 2026-08-01",
  eventCount: 4,
  eventSetFingerprint: SHA_C,
  bindingFingerprint: SHA_D,
};

function analysis(input: {
  dealId: string;
  companyName: string;
  dealStatus: CompanyAnalysis["dealStatus"];
  reportId?: string;
  runId?: string;
}): CompanyAnalysis {
  return {
    id: `analysis_${input.dealId}`,
    reportId: input.reportId ?? "report_1",
    runId: input.runId ?? RUN_ID,
    dealId: input.dealId,
    companyName: input.companyName,
    dealStatus: input.dealStatus,
  } as CompanyAnalysis;
}

function candidate(input: {
  id: string;
  dealId: string;
  batchId?: string;
  workspaceId?: string;
  status?: CandidateRun["status"];
  fingerprint?: string;
  rerunOfId?: string | null;
  finalizedAt?: string | null;
}): CandidateRun {
  return {
    id: input.id,
    batchId: input.batchId ?? "batch_1",
    workspaceId: input.workspaceId ?? "workspace_1",
    dealId: input.dealId,
    status: input.status ?? "completed",
    candidateAnalysisFingerprint: input.fingerprint ?? `fp:${input.dealId}`,
    rerunOfId: input.rerunOfId ?? null,
    createdAt: "2026-08-01T12:00:00.000Z",
    finalizedAt: input.finalizedAt === undefined
      ? "2026-08-01T12:05:00.000Z"
      : input.finalizedAt,
  };
}

function batch(overrides: Partial<UnderwritingBatch> = {}): UnderwritingBatch {
  return {
    id: "batch_1",
    workspaceId: "workspace_1",
    scanRunId: RUN_ID,
    status: "completed",
    batchInputFingerprint: "batch-fingerprint",
    fundPolicySnapshotId: "fund_1",
    rerunOfId: null,
    createdAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

function bundle(input: {
  candidateRunId: string;
  dealId: string;
  workspaceId?: string;
  fingerprint?: string;
  generation?: "current" | "legacy" | "partial";
  dealStatus?: CompanyAnalysis["dealStatus"];
}): CandidateArtifactBundle {
  const currentIdentity = {
    dealStatus: input.dealStatus ?? (input.dealId === "deal_hush"
      ? "invested" as const
      : "passed" as const),
    beliefDirection: "positive" as const,
    canonicalActions: [],
    actionPolicyVersion: "belief-action-policy-v1" as const,
    draftPolicyVersion: "status-safe-action-draft-v2" as const,
    semanticContextAssumptionPolicyVersion:
      "belief-reversal-demo-context-v1" as const,
    semanticContextMappingVersion:
      "belief-reversal-reviewed-context-mapping-v1" as const,
    analysisMode: "core_only" as const,
    contextVersion: "context-v1",
    geography: "us" as const,
    benchmarkCompatibility: "exact" as const,
  };
  const versionSnapshot = input.generation === "legacy"
    ? {}
    : input.generation === "partial"
    ? { dealStatus: "passed" as const }
    : currentIdentity;
  return {
    candidateRunId: input.candidateRunId,
    workspaceId: input.workspaceId ?? "workspace_1",
    dealId: input.dealId,
    candidateAnalysisFingerprint: input.fingerprint ?? `fp:${input.dealId}`,
    versionSnapshot,
  } as CandidateArtifactBundle;
}

function resolvedScope(overrides: {
  analyses?: CompanyAnalysis[];
  candidateRunIds?: string[];
  reportWorkspaceId?: string;
  runWorkspaceId?: string;
  reportRunId?: string;
  reportContext?: IntelligenceReportRecord["evidenceContext"];
  runContext?: RunRecord["evidenceContext"];
  runStatus?: RunRecord["status"];
  dealId?: string | null;
} = {}): ResolvedReportEvidenceScope {
  const analyses = overrides.analyses ?? [
    analysis({
      dealId: "deal_ably",
      companyName: "Ably",
      dealStatus: "passed",
    }),
    analysis({
      dealId: "deal_hush",
      companyName: "Hush Security",
      dealStatus: "invested",
    }),
  ];
  return {
    requestKind: "report",
    report: {
      id: "report_1",
      workspaceId: overrides.reportWorkspaceId ?? "workspace_1",
      runId: overrides.reportRunId ?? RUN_ID,
      createdAt: "2026-08-01T12:10:00.000Z",
      marketSummary: "Pinned report",
      opportunities: [],
      analysisStatus: "completed",
      evidenceCoverage: {
        acceptedPublicEvents: 4,
        excludedPublicItems: 0,
        truncatedPublicEvents: 0,
        recalledDealCount: analyses.length,
        unavailableDealCount: 0,
      },
      counts: {
        companyCount: analyses.length,
        beliefRevised: analyses.length,
        monitor: 0,
        noMaterialChange: 0,
        analysisUnavailable: 0,
      },
      priorityDealId: analyses[0]?.dealId ?? null,
      companyAnalyses: analyses,
      evidenceContext: overrides.reportContext === undefined
        ? currentReportContext
        : overrides.reportContext,
    },
    run: {
      id: RUN_ID,
      workspaceId: overrides.runWorkspaceId ?? "workspace_1",
      mode: "structured",
      windowDays: 14,
      status: overrides.runStatus ?? "completed",
      currentStage: null,
      warningCount: 0,
      warnings: [],
      workerId: "worker_1",
      createdAt: "2026-08-01T12:00:00.000Z",
      startedAt: "2026-08-01T12:00:01.000Z",
      completedAt: "2026-08-01T12:09:00.000Z",
      leaseExpiresAt: null,
      evidenceContext: overrides.runContext === undefined
        ? currentRunContext
        : overrides.runContext,
    },
    dealId: overrides.dealId ?? null,
    candidateRunIds: overrides.candidateRunIds ?? [
      "candidate_ably",
      "candidate_hush",
    ],
  };
}

function repositories(input: {
  batch?: UnderwritingBatch | null;
  candidates?: CandidateRun[];
  bundles?: Record<string, CandidateArtifactBundle | null>;
}) {
  const selectedBatch = input.batch === undefined ? batch() : input.batch;
  const candidates = input.candidates ?? [
    candidate({ id: "candidate_ably", dealId: "deal_ably" }),
    candidate({ id: "candidate_hush", dealId: "deal_hush" }),
  ];
  const bundles = input.bundles ?? {
    candidate_ably: bundle({
      candidateRunId: "candidate_ably",
      dealId: "deal_ably",
    }),
    candidate_hush: bundle({
      candidateRunId: "candidate_hush",
      dealId: "deal_hush",
    }),
  };
  const candidateLookups: string[] = [];
  let globalListCalls = 0;
  const underwritingRuns = {
    async getBatchByScanRunId() {
      return selectedBatch;
    },
    async listCandidatesForBatch() {
      return candidates;
    },
  } as Pick<
    UnderwritingRunsRepository,
    "getBatchByScanRunId" | "listCandidatesForBatch"
  >;
  const artifacts = {
    async getByCandidateRunId(request: {
      workspaceId: string;
      candidateRunId: string;
    }) {
      assert.equal(request.workspaceId, "workspace_1");
      candidateLookups.push(request.candidateRunId);
      return bundles[request.candidateRunId] ?? null;
    },
    async listFinalizedForWorkspace() {
      globalListCalls += 1;
      throw new Error("global finalized-artifact lookup is forbidden");
    },
  };
  return {
    underwritingRuns,
    artifacts,
    candidateLookups,
    get globalListCalls() {
      return globalListCalls;
    },
  };
}

test("loads the exact report Deal and validates every scoped candidate through exact lookup", async () => {
  const storage = repositories({});
  const scope = resolvedScope({ dealId: "deal_ably" });
  scope.candidateRunIds = ["candidate_ably"];

  const result = await loadExactFinalizedChatScope({
    workspaceId: "workspace_1",
    scope,
    question: "Why did we originally pass?",
    underwritingRuns: storage.underwritingRuns,
    artifacts: storage.artifacts,
  });

  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.equal(result.dealId, "deal_ably");
  assert.equal(result.analysis.companyName, "Ably");
  assert.equal(result.candidate?.id, "candidate_ably");
  assert.equal(result.bundle?.candidateRunId, "candidate_ably");
  assert.deepEqual(storage.candidateLookups, ["candidate_ably"]);
  assert.equal(storage.globalListCalls, 0);
});

test("looks up a rerun alias by the exact scoped candidate ID and validates its immutable source bundle", async () => {
  const alias = candidate({
    id: "candidate_rerun",
    dealId: "deal_ably",
    fingerprint: "fp:ably-stable",
    rerunOfId: "candidate_original",
  });
  const storage = repositories({
    candidates: [alias],
    bundles: {
      candidate_rerun: bundle({
        candidateRunId: "candidate_original",
        dealId: "deal_ably",
        fingerprint: "fp:ably-stable",
      }),
    },
  });
  const scope = resolvedScope({
    dealId: "deal_ably",
    candidateRunIds: ["candidate_rerun"],
  });

  const result = await loadExactFinalizedChatScope({
    workspaceId: "workspace_1",
    scope,
    question: "Why did we originally pass?",
    underwritingRuns: storage.underwritingRuns,
    artifacts: storage.artifacts,
  });

  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.equal(result.candidate?.id, "candidate_rerun");
  assert.equal(result.bundle?.candidateRunId, "candidate_original");
  assert.deepEqual(storage.candidateLookups, ["candidate_rerun"]);
  assert.equal(storage.globalListCalls, 0);
});

test("resolves exactly one company name, Deal ID, or unique mentioned status without an explicit Deal", async () => {
  const cases = [
    ["What changed for Hush Security?", "deal_hush"],
    ["What is missing for deal_ably?", "deal_ably"],
    ["What should we do for the invested company?", "deal_hush"],
  ] as const;
  for (const [question, expectedDealId] of cases) {
    const storage = repositories({});
    const result = await loadExactFinalizedChatScope({
      workspaceId: "workspace_1",
      scope: resolvedScope(),
      question,
      underwritingRuns: storage.underwritingRuns,
      artifacts: storage.artifacts,
    });
    assert.equal(result.status, "ready", question);
    if (result.status === "ready") {
      assert.equal(result.dealId, expectedDealId, question);
    }
  }
});

test("returns typed insufficient evidence for absent or ambiguous implicit Deal selection", async () => {
  const questions = [
    "What is the strongest counterargument?",
    "Compare Ably with Hush Security.",
    "What should we do for the passed or invested company?",
    "What was the prior investment decision reason?",
    "What does the valuation evaluation say?",
  ];
  for (const question of questions) {
    const storage = repositories({});
    const result = await loadExactFinalizedChatScope({
      workspaceId: "workspace_1",
      scope: resolvedScope(),
      question,
      underwritingRuns: storage.underwritingRuns,
      artifacts: storage.artifacts,
    });
    assert.equal(result.status, "insufficient_evidence", question);
    if (result.status === "insufficient_evidence") {
      assert.equal(result.reason, "deal_unresolved", question);
    }
  }
});

test("rejects an explicit Deal that conflicts with the resolved report scope", async () => {
  const storage = repositories({});
  const result = await loadExactFinalizedChatScope({
    workspaceId: "workspace_1",
    scope: resolvedScope({ dealId: "deal_ably", candidateRunIds: ["candidate_ably"] }),
    dealId: "deal_hush",
    question: "What changed for Hush Security?",
    underwritingRuns: storage.underwritingRuns,
    artifacts: storage.artifacts,
  });

  assert.equal(result.status, "insufficient_evidence");
  if (result.status === "insufficient_evidence") {
    assert.equal(result.reason, "deal_scope_mismatch");
  }
});

test("fails closed for report, run, evidence-frame, and CompanyAnalysis identity mismatches", async () => {
  const cases: Array<{
    label: string;
    scope: ResolvedReportEvidenceScope;
    reason: string;
  }> = [
    {
      label: "foreign report workspace",
      scope: resolvedScope({ reportWorkspaceId: "workspace_foreign" }),
      reason: "workspace_mismatch",
    },
    {
      label: "foreign run workspace",
      scope: resolvedScope({ runWorkspaceId: "workspace_foreign" }),
      reason: "workspace_mismatch",
    },
    {
      label: "report run mismatch",
      scope: resolvedScope({ reportRunId: "00000000-0000-4000-8000-000000000099" }),
      reason: "report_run_mismatch",
    },
    {
      label: "nonterminal run",
      scope: resolvedScope({ runStatus: "running" }),
      reason: "run_not_terminal",
    },
    {
      label: "live/pinned mismatch",
      scope: resolvedScope({
        reportContext: {
          ...currentReportContext,
          evidenceMode: "live",
          snapshotId: null,
          snapshotFingerprint: null,
        },
      }),
      reason: "evidence_context_mismatch",
    },
    {
      label: "analysis report mismatch",
      scope: resolvedScope({
        analyses: [analysis({
          dealId: "deal_ably",
          companyName: "Ably",
          dealStatus: "passed",
          reportId: "report_foreign",
        })],
        candidateRunIds: ["candidate_ably"],
      }),
      reason: "analysis_identity_mismatch",
    },
    {
      label: "analysis run mismatch",
      scope: resolvedScope({
        analyses: [analysis({
          dealId: "deal_ably",
          companyName: "Ably",
          dealStatus: "passed",
          runId: "00000000-0000-4000-8000-000000000099",
        })],
        candidateRunIds: ["candidate_ably"],
      }),
      reason: "analysis_identity_mismatch",
    },
  ];
  for (const item of cases) {
    const storage = repositories({});
    const result = await loadExactFinalizedChatScope({
      workspaceId: "workspace_1",
      scope: item.scope,
      dealId: "deal_ably",
      question: "Why did we pass?",
      underwritingRuns: storage.underwritingRuns,
      artifacts: storage.artifacts,
    });
    assert.equal(result.status, "insufficient_evidence", item.label);
    if (result.status === "insufficient_evidence") {
      assert.equal(result.reason, item.reason, item.label);
    }
  }
});

test("fails closed for missing, foreign, nonterminal, or partial candidate scope ownership", async () => {
  const cases: Array<{
    label: string;
    scope?: ResolvedReportEvidenceScope;
    batch?: UnderwritingBatch | null;
    candidates?: CandidateRun[];
    reason: string;
  }> = [
    {
      label: "candidate IDs without a batch",
      batch: null,
      reason: "batch_identity_mismatch",
    },
    {
      label: "foreign batch workspace",
      batch: batch({ workspaceId: "workspace_foreign" }),
      reason: "batch_identity_mismatch",
    },
    {
      label: "foreign batch run",
      batch: batch({ scanRunId: "00000000-0000-4000-8000-000000000099" }),
      reason: "batch_identity_mismatch",
    },
    {
      label: "nonterminal batch",
      batch: batch({ status: "running" }),
      reason: "batch_not_terminal",
    },
    {
      label: "scope omits a batch candidate",
      scope: resolvedScope({ candidateRunIds: ["candidate_ably"] }),
      reason: "candidate_scope_mismatch",
    },
    {
      label: "candidate belongs to another batch",
      candidates: [
        candidate({ id: "candidate_ably", dealId: "deal_ably", batchId: "batch_foreign" }),
        candidate({ id: "candidate_hush", dealId: "deal_hush" }),
      ],
      reason: "candidate_identity_mismatch",
    },
    {
      label: "completed candidate lacks finalization time",
      candidates: [
        candidate({ id: "candidate_ably", dealId: "deal_ably", finalizedAt: null }),
        candidate({ id: "candidate_hush", dealId: "deal_hush" }),
      ],
      reason: "candidate_identity_mismatch",
    },
    {
      label: "candidate has no CompanyAnalysis member",
      candidates: [
        candidate({ id: "candidate_ably", dealId: "deal_unknown" }),
        candidate({ id: "candidate_hush", dealId: "deal_hush" }),
      ],
      reason: "candidate_identity_mismatch",
    },
  ];
  for (const item of cases) {
    const storage = repositories({
      batch: item.batch,
      candidates: item.candidates,
    });
    const result = await loadExactFinalizedChatScope({
      workspaceId: "workspace_1",
      scope: item.scope ?? resolvedScope(),
      dealId: "deal_ably",
      question: "Why did we pass?",
      underwritingRuns: storage.underwritingRuns,
      artifacts: storage.artifacts,
    });
    assert.equal(result.status, "insufficient_evidence", item.label);
    if (result.status === "insufficient_evidence") {
      assert.equal(result.reason, item.reason, item.label);
    }
  }
});

test("allows terminal unavailable candidates only when no finalized bundle is returned", async () => {
  const unavailable = candidate({
    id: "candidate_ably",
    dealId: "deal_ably",
    status: "unavailable",
  });
  const storage = repositories({
    candidates: [unavailable],
    bundles: { candidate_ably: null },
  });
  const scope = resolvedScope({
    dealId: "deal_ably",
    candidateRunIds: ["candidate_ably"],
    analyses: [analysis({
      dealId: "deal_ably",
      companyName: "Ably",
      dealStatus: "passed",
    })],
  });

  const result = await loadExactFinalizedChatScope({
    workspaceId: "workspace_1",
    scope,
    question: "What evidence is missing?",
    underwritingRuns: storage.underwritingRuns,
    artifacts: storage.artifacts,
  });

  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    assert.equal(result.candidate?.status, "unavailable");
    assert.equal(result.bundle, null);
  }
});

test("allows a terminal partial belief-revised candidate when its exact finalized artifact is available", async () => {
  const partial = candidate({
    id: "candidate_ably",
    dealId: "deal_ably",
    status: "partial",
  });
  const partialBundle = bundle({
    candidateRunId: partial.id,
    dealId: partial.dealId,
    fingerprint: partial.candidateAnalysisFingerprint,
  });
  const storage = repositories({
    batch: batch({ status: "partial" }),
    candidates: [partial],
    bundles: { candidate_ably: partialBundle },
  });
  const scope = resolvedScope({
    dealId: "deal_ably",
    candidateRunIds: [partial.id],
    analyses: [analysis({
      dealId: "deal_ably",
      companyName: "Ably",
      dealStatus: "passed",
    })],
  });

  const result = await loadExactFinalizedChatScope({
    workspaceId: "workspace_1",
    scope,
    question: "What finalized evidence is available?",
    underwritingRuns: storage.underwritingRuns,
    artifacts: storage.artifacts,
  });

  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    assert.equal(result.candidate?.status, "partial");
    assert.equal(result.bundle?.candidateRunId, partial.id);
  }
});

test("rejects absent, foreign, mismatched, and wrong-generation finalized artifacts", async () => {
  const cases: Array<{
    label: string;
    value: CandidateArtifactBundle | null;
    reason: string;
  }> = [
    { label: "missing bundle", value: null, reason: "artifact_missing" },
    {
      label: "foreign workspace",
      value: bundle({
        candidateRunId: "candidate_ably",
        dealId: "deal_ably",
        workspaceId: "workspace_foreign",
      }),
      reason: "artifact_identity_mismatch",
    },
    {
      label: "foreign Deal",
      value: bundle({ candidateRunId: "candidate_ably", dealId: "deal_foreign" }),
      reason: "artifact_identity_mismatch",
    },
    {
      label: "foreign candidate",
      value: bundle({ candidateRunId: "candidate_foreign", dealId: "deal_ably" }),
      reason: "artifact_identity_mismatch",
    },
    {
      label: "fingerprint mismatch",
      value: bundle({
        candidateRunId: "candidate_ably",
        dealId: "deal_ably",
        fingerprint: "fp:foreign",
      }),
      reason: "artifact_identity_mismatch",
    },
    {
      label: "legacy artifact in current scope",
      value: bundle({
        candidateRunId: "candidate_ably",
        dealId: "deal_ably",
        generation: "legacy",
      }),
      reason: "artifact_generation_mismatch",
    },
    {
      label: "partial generation identity",
      value: bundle({
        candidateRunId: "candidate_ably",
        dealId: "deal_ably",
        generation: "partial",
      }),
      reason: "artifact_generation_mismatch",
    },
  ];
  for (const item of cases) {
    const storage = repositories({
      bundles: {
        candidate_ably: item.value,
        candidate_hush: bundle({
          candidateRunId: "candidate_hush",
          dealId: "deal_hush",
        }),
      },
    });
    const result = await loadExactFinalizedChatScope({
      workspaceId: "workspace_1",
      scope: resolvedScope(),
      dealId: "deal_ably",
      question: "Why did we pass?",
      underwritingRuns: storage.underwritingRuns,
      artifacts: storage.artifacts,
    });
    assert.equal(result.status, "insufficient_evidence", item.label);
    if (result.status === "insufficient_evidence") {
      assert.equal(result.reason, item.reason, item.label);
    }
  }
});

test("rejects a current artifact whose pinned Deal status differs from CompanyAnalysis", async () => {
  const storage = repositories({
    bundles: {
      candidate_ably: bundle({
        candidateRunId: "candidate_ably",
        dealId: "deal_ably",
        dealStatus: "invested",
      }),
      candidate_hush: bundle({
        candidateRunId: "candidate_hush",
        dealId: "deal_hush",
      }),
    },
  });

  const result = await loadExactFinalizedChatScope({
    workspaceId: "workspace_1",
    scope: resolvedScope(),
    dealId: "deal_ably",
    question: "Why did we pass?",
    underwritingRuns: storage.underwritingRuns,
    artifacts: storage.artifacts,
  });

  assert.equal(result.status, "insufficient_evidence");
  if (result.status === "insufficient_evidence") {
    assert.equal(result.reason, "artifact_identity_mismatch");
  }
});

test("legacy report scope remains isolated from current artifacts", async () => {
  const legacyScope = resolvedScope({
    reportContext: { state: "legacy_unbound" },
    runContext: { state: "legacy_unbound" },
    candidateRunIds: ["candidate_ably"],
    dealId: "deal_ably",
    analyses: [analysis({
      dealId: "deal_ably",
      companyName: "Ably",
      dealStatus: "passed",
    })],
  });
  const storage = repositories({
    candidates: [candidate({ id: "candidate_ably", dealId: "deal_ably" })],
    bundles: {
      candidate_ably: bundle({
        candidateRunId: "candidate_ably",
        dealId: "deal_ably",
        generation: "current",
      }),
    },
  });

  const result = await loadExactFinalizedChatScope({
    workspaceId: "workspace_1",
    scope: legacyScope,
    question: "Why did we pass?",
    underwritingRuns: storage.underwritingRuns,
    artifacts: storage.artifacts,
  });

  assert.equal(result.status, "insufficient_evidence");
  if (result.status === "insufficient_evidence") {
    assert.equal(result.reason, "artifact_generation_mismatch");
  }
});

test("legacy report scope without underwriting stays usable only for its exact CompanyAnalysis", async () => {
  const legacyScope = resolvedScope({
    reportContext: { state: "legacy_unbound" },
    runContext: { state: "legacy_unbound" },
    candidateRunIds: [],
    dealId: "deal_ably",
    analyses: [analysis({
      dealId: "deal_ably",
      companyName: "Ably",
      dealStatus: "passed",
    })],
  });
  const storage = repositories({ batch: null, candidates: [], bundles: {} });

  const result = await loadExactFinalizedChatScope({
    workspaceId: "workspace_1",
    scope: legacyScope,
    question: "Why did we pass?",
    underwritingRuns: storage.underwritingRuns,
    artifacts: storage.artifacts,
  });

  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    assert.equal(result.dealId, "deal_ably");
    assert.equal(result.candidate, null);
    assert.equal(result.bundle, null);
  }
  assert.deepEqual(storage.candidateLookups, []);
  assert.equal(storage.globalListCalls, 0);
});
