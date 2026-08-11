import assert from "node:assert/strict";
import test from "node:test";

import {
  POST,
  resolveFinalizedRouteCandidateBinding,
} from "../../app/api/chat/route";
import type { RunRecord } from "../../db/client";
import {
  getIntelligenceRepository,
  type IntelligenceReportRecord,
} from "../../db/repositories/intelligence";
import type { CandidateArtifactBundle } from
  "../../db/repositories/underwriting-artifacts";
import type { RouteDependencies } from "../../lib/api/route-dependencies";
import type { FinalizedChatResponseV2 } from
  "../../lib/contracts/finalized-chat";
import type {
  CandidateRun,
  UnderwritingBatch,
} from "../../lib/contracts/underwriting";
import { canonicalIntelligenceReportFixture } from "../helpers/canonical-intelligence-report";
import { createCurrentNamedLensFinalizationFixture } from
  "../helpers/current-named-lens-finalization";
import { exactSourceV2 } from "../helpers/source-evidence-v2";

const sha = (digit: string) => `sha256:${digit.repeat(64)}`;

function currentNamedLensBundle(): CandidateArtifactBundle {
  const { finalization } = createCurrentNamedLensFinalizationFixture();
  const {
    workerId: _workerId,
    leaseToken: _leaseToken,
    candidateRunId,
    evidencePackBuildInputFingerprint: _evidencePackBuildInputFingerprint,
    ...artifacts
  } = structuredClone(finalization);
  void _workerId;
  void _leaseToken;
  void _evidencePackBuildInputFingerprint;
  return {
    ...artifacts,
    candidateRunId,
    sourceCandidateRunId: candidateRunId,
    workspaceId: finalization.evidencePack.workspaceId,
    dealId: finalization.evidencePack.dealId,
    claimEdges: [
      ...finalization.judgments.flatMap(({ claimEdges }) =>
        structuredClone(claimEdges)
      ),
      ...structuredClone(finalization.decision.claimEdges),
    ],
  } as CandidateArtifactBundle;
}

function currentNamedLensRouteFixture(input: {
  bundle?: CandidateArtifactBundle;
  candidateStatus?: CandidateRun["status"];
  reportId?: string;
} = {}) {
  const bundle = structuredClone(input.bundle ?? currentNamedLensBundle());
  const workspaceId = bundle.workspaceId;
  const reportId = input.reportId ?? "report_current";
  const runId = "00000000-0000-4000-8000-000000000088";
  const createdAt = "2026-08-10T12:00:00.000Z";
  const exactSources = bundle.evidencePack.facts.map((fact, index) =>
    exactSourceV2(`source_${fact.id}`, {
      title: `Exact source for ${fact.id}`,
      documentId: `document_${fact.id}`,
      sourceRevisionId: fact.sourceRevisionId,
      contentFingerprint: sha(index === 0 ? "8" : "9"),
      text: {
        status: "verified_exact",
        verbatimExcerpt: index === 0
          ? "Saved counterevidence limits the investment conclusion."
          : "Saved customer evidence supports further investment diligence.",
        normalizedStatement: index === 0
          ? "The saved counterevidence limits the conclusion."
          : "The saved demand evidence supports diligence.",
      },
    })
  );
  const reportWrite = canonicalIntelligenceReportFixture({
    id: reportId,
    workspaceId,
    runId,
    createdAt,
    marketSummary: "Current Named Lens finalized Chat report.",
    dealIds: [bundle.dealId],
  });
  const companyAnalyses = (reportWrite.companyAnalyses ?? []).map((analysis) => ({
    ...analysis,
    dealStatus: bundle.versionSnapshot.dealStatus ?? analysis.dealStatus,
    outcome: "belief_revised" as const,
    confidence: "high" as const,
    score: 0.91,
    sources: [...analysis.sources, ...exactSources],
    companyBrief: {
      ...analysis.companyBrief,
      sourceLineage: [
        ...analysis.companyBrief.sourceLineage,
        ...exactSources,
      ],
    },
  }));
  const evidenceContext = {
    state: "current" as const,
    schemaVersion: "run-evidence-context-v1" as const,
    evidenceMode: "live" as const,
    windowDays: 14 as const,
    anchorAt: createdAt,
    windowStartAt: "2026-07-28T00:00:00.000Z",
    windowEndAt: createdAt,
    windowTimezone: "America/Los_Angeles",
    snapshotId: null,
    snapshotFingerprint: null,
    contextFingerprint: sha("1"),
  };
  const report = {
    ...reportWrite,
    companyAnalyses,
    analysisStatus: "completed" as const,
    evidenceCoverage: {
      acceptedPublicEvents: 1,
      excludedPublicItems: 0,
      truncatedPublicEvents: 0,
      recalledDealCount: 1,
      unavailableDealCount: 0,
    },
    counts: {
      companyCount: 1,
      beliefRevised: 1,
      monitor: 0,
      noMaterialChange: 0,
      analysisUnavailable: 0,
    },
    priorityDealId: bundle.dealId,
    evidenceContext: {
      ...evidenceContext,
      displayLabel: "Live evidence through 2026-08-10",
      eventCount: 1,
      eventSetFingerprint: sha("2"),
      bindingFingerprint: sha("3"),
    },
  } as IntelligenceReportRecord;
  const run = {
    id: runId,
    workspaceId,
    mode: "structured",
    windowDays: 14,
    status: "completed",
    currentStage: null,
    warningCount: 0,
    warnings: [],
    workerId: null,
    createdAt,
    startedAt: createdAt,
    completedAt: createdAt,
    leaseExpiresAt: null,
    evidenceContext,
  } as RunRecord;
  const batch: UnderwritingBatch = {
    id: "batch_current_chat_v2",
    workspaceId,
    scanRunId: runId,
    status: input.candidateStatus === "partial" ? "partial" : "completed",
    batchInputFingerprint: "batch-current-chat-v2",
    fundPolicySnapshotId: bundle.versionSnapshot.fundPolicyId,
    rerunOfId: null,
    createdAt,
  };
  const candidate: CandidateRun = {
    id: bundle.candidateRunId,
    batchId: batch.id,
    workspaceId,
    dealId: bundle.dealId,
    status: input.candidateStatus ?? "completed",
    candidateAnalysisFingerprint: bundle.candidateAnalysisFingerprint,
    rerunOfId: null,
    createdAt,
    finalizedAt: createdAt,
  };
  const passage = bundle.namedLensPassages![0]!;
  const judgment = bundle.judgments.find(({ id }) => id === passage.judgmentId)!;
  const component = judgment.frameworkMetadata!.components.find(
    ({ frameworkId }) => frameworkId === passage.premise.componentFrameworkId,
  )!;
  const dependencies: RouteDependencies = {
    async resolveRequestContext() {
      return {
        mode: "public_sandbox",
        principal: null,
        workspaceId,
        role: "partner",
        permissions: {
          readWorkspace: true,
          readPrivateSources: true,
          mutateSources: true,
          managePolicy: false,
          administerFrameworks: false,
        },
      };
    },
    async rateLimitRequest() {
      return { allowed: true, retryAfterSeconds: 0 };
    },
    intelligence: {
      async listReports(requestWorkspaceId: string) {
        return requestWorkspaceId === workspaceId ? [report] : [];
      },
      async getReport(requestWorkspaceId: string, requestReportId: string) {
        return requestWorkspaceId === workspaceId && requestReportId === reportId
          ? report
          : null;
      },
    } as RouteDependencies["intelligence"],
    runs: {
      async list(requestWorkspaceId: string) {
        return requestWorkspaceId === workspaceId ? [run] : [];
      },
      async get(requestWorkspaceId: string, requestRunId: string) {
        return requestWorkspaceId === workspaceId && requestRunId === runId
          ? run
          : null;
      },
    } as RouteDependencies["runs"],
    underwritingRuns: {
      async getBatchByScanRunId() {
        return batch;
      },
      async listCandidatesForBatch() {
        return [candidate];
      },
    } as unknown as RouteDependencies["underwritingRuns"],
    underwritingArtifacts: {
      async getByCandidateRunId() {
        return bundle;
      },
    } as unknown as RouteDependencies["underwritingArtifacts"],
  };
  return {
    bundle,
    candidate,
    component,
    dependencies,
    report,
    reportId,
    run,
    runId,
    workspaceId,
  };
}

function adaptCurrentFixtureToLegacy(
  fixture: ReturnType<typeof currentNamedLensRouteFixture>,
  adapter: "pinned_23" | "pre_passage_30",
): void {
  const bundle = fixture.bundle;
  for (const field of [
    "frameworkCatalogVersion",
    "frameworkCatalogFingerprint",
    "frameworkCorpusDigest",
    "namedLensSelectionPolicyVersion",
    "namedLensPassageSchemaVersion",
    "namedLensGeneratorVersion",
    "underwritingPresentationSchemaVersion",
    "decisionTaxonomyVersion",
    "decisionTaxonomyDigest",
    "criticalEvidenceProjectionFingerprint",
    "finalDispositionsFingerprint",
    "presentationFingerprint",
    "refreshNonce",
  ] as const) {
    delete (bundle.versionSnapshot as Record<string, unknown>)[field];
  }
  delete bundle.decisionCriticalEvidenceProjection;
  delete bundle.namedLensCatalogConsiderations;
  delete bundle.namedLensAttemptRefs;
  delete bundle.namedLensDispositions;
  delete bundle.namedLensPassages;
  delete bundle.underwritingPresentationReportId;
  delete bundle.namedLensPresentation;
  delete bundle.terminalStatus;
  delete bundle.terminalReasonCodes;

  if (adapter === "pre_passage_30") {
    bundle.versionSnapshot.schemaVersion = "framework-judgment-v1";
    bundle.versionSnapshot.settingsFingerprint = "belief-reversal-task12-v1";
    bundle.versionSnapshot.applicationCommit = "task12-local-e2e";
    fixture.report.evidenceContext = { state: "legacy_unbound" };
    fixture.run.evidenceContext = { state: "legacy_unbound" };
    return;
  }
  bundle.versionSnapshot.schemaVersion = "framework-judgment-v1";
  bundle.versionSnapshot.settingsFingerprint = "legacy-pinned-settings";
  bundle.versionSnapshot.applicationCommit = "legacy-pinned-commit";
  const runContext = {
    state: "current" as const,
    schemaVersion: "run-evidence-context-v1" as const,
    evidenceMode: "pinned" as const,
    windowDays: 14 as const,
    anchorAt: "2026-08-01T23:59:59.000Z",
    windowStartAt: "2026-07-19T00:00:00.000Z",
    windowEndAt: "2026-08-01T23:59:59.000Z",
    windowTimezone: "America/Los_Angeles",
    snapshotId: "belief_reversal_2026_08_01",
    snapshotFingerprint: sha("4"),
    contextFingerprint: sha("5"),
  };
  fixture.run.evidenceContext = runContext;
  fixture.report.evidenceContext = {
    ...runContext,
    displayLabel: "Demo evidence snapshot as of 2026-08-01",
    eventCount: 4,
    eventSetFingerprint: sha("6"),
    bindingFingerprint: sha("7"),
  };
}

function currentChatRequest(input: {
  question: string;
  reportId: string;
  runId: string;
  dealId: string;
}): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 100) + 100}`,
    },
    body: JSON.stringify(input),
  });
}

test("route identity preserves a scoped rerun alias and explicitly binds its immutable source candidate", () => {
  assert.deepEqual(resolveFinalizedRouteCandidateBinding({
    id: "candidate_alias",
    rerunOfId: "candidate_original",
    artifactSourceCandidateRunId: "candidate_original",
    candidateAnalysisFingerprint: "fp:stable",
  }), {
    candidateRunId: "candidate_alias",
    rerunOfId: "candidate_original",
    artifactSourceCandidateRunId: "candidate_original",
    candidateAnalysisFingerprint: "fp:stable",
  });
  assert.deepEqual(resolveFinalizedRouteCandidateBinding({
    id: "candidate_refresh",
    rerunOfId: "candidate_original",
    artifactSourceCandidateRunId: null,
    candidateAnalysisFingerprint: "fp:refresh",
  }), {
    candidateRunId: "candidate_refresh",
    rerunOfId: "candidate_original",
    artifactSourceCandidateRunId: null,
    candidateAnalysisFingerprint: "fp:refresh",
  });
  assert.equal(resolveFinalizedRouteCandidateBinding(null), null);
});

test("durable Chat fails closed on an unsupported topic without constructing a provider or XTrace path", async () => {
  const workspaceId = `workspace_finalized_route_${crypto.randomUUID()}`;
  const runId = crypto.randomUUID();
  const reportId = `report_finalized_route_${crypto.randomUUID()}`;
  const createdAt = "2026-08-01T20:00:00.000Z";
  const repository = getIntelligenceRepository();
  const report = await repository.saveReport(canonicalIntelligenceReportFixture({
    id: reportId,
    workspaceId,
    runId,
    createdAt,
    marketSummary: "A finalized report used only for deterministic Chat routing.",
    dealIds: ["deal_finalized_route"],
  }));
  const run = {
    id: runId,
    workspaceId,
    mode: "structured" as const,
    windowDays: 14 as const,
    status: "completed" as const,
    currentStage: null,
    warningCount: 0,
    warnings: [],
    workerId: null,
    createdAt,
    startedAt: createdAt,
    completedAt: createdAt,
    leaseExpiresAt: null,
    evidenceContext: { state: "legacy_unbound" as const },
  };
  const dependencies: RouteDependencies = {
    async resolveRequestContext() {
      return {
        mode: "public_sandbox",
        principal: null,
        workspaceId,
        role: "partner",
        permissions: {
          readWorkspace: true,
          readPrivateSources: true,
          mutateSources: true,
          managePolicy: false,
          administerFrameworks: false,
        },
      };
    },
    intelligence: {
      ...repository,
      async listReports(requestWorkspaceId) {
        return requestWorkspaceId === workspaceId ? [report] : [];
      },
      async getReport(requestWorkspaceId, requestReportId) {
        return requestWorkspaceId === workspaceId && requestReportId === report.id
          ? report
          : null;
      },
    },
    runs: {
      async list(requestWorkspaceId: string) {
        return requestWorkspaceId === workspaceId ? [run] : [];
      },
      async get(requestWorkspaceId: string, requestRunId: string) {
        return requestWorkspaceId === workspaceId && requestRunId === run.id
          ? run
          : null;
      },
    } as unknown as RouteDependencies["runs"],
    underwritingRuns: {
      async getBatchByScanRunId() {
        return null;
      },
      async listCandidatesForBatch() {
        throw new Error("No batch means candidates must not be listed.");
      },
    } as unknown as RouteDependencies["underwritingRuns"],
    underwritingArtifacts: {
      async getByCandidateRunId() {
        throw new Error("No scoped candidate artifact may be loaded.");
      },
    } as unknown as RouteDependencies["underwritingArtifacts"],
  };

  const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const previousSupabaseUrl = process.env.SUPABASE_URL;
  const previousSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousFetch = globalThis.fetch;
  process.env.ANTHROPIC_API_KEY = "must-not-be-used";
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("Durable finalized Chat must not call the network.");
  };

  try {
    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 100) + 100}`,
      },
      body: JSON.stringify({
        question: "Tell me everything about this company.",
        reportId,
        runId,
        dealId: "deal_finalized_route",
      }),
    }), undefined, dependencies);

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      data: {
        status: string;
        reasonCode: string;
        insufficientEvidence: boolean;
        citations: unknown[];
        memoryStatus: string;
        usedXTrace: boolean;
        scope: {
          reportId: string;
          runId: string;
          dealId: string;
          companyName: string;
          evidenceContext: { state: string };
        };
      };
    };
    assert.equal(payload.data.status, "insufficient");
    assert.equal(payload.data.reasonCode, "unsupported_topic");
    assert.equal(payload.data.insufficientEvidence, true);
    assert.deepEqual(payload.data.citations, []);
    assert.equal(payload.data.memoryStatus, "disabled");
    assert.equal(payload.data.usedXTrace, false);
    assert.deepEqual(payload.data.scope, {
      reportId,
      runId,
      dealId: "deal_finalized_route",
      companyName: "deal_finalized_route",
      evidenceContext: { state: "legacy_unbound" },
    });
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
    if (previousSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousSupabaseUrl;
    if (previousSupabaseKey === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = previousSupabaseKey;
    }
  }
});

test("current adapter routes all four exact Named Lens questions through immutable Chat V2", async () => {
  const fixture = currentNamedLensRouteFixture();
  const displayIdentity = fixture.component.attribution.display;
  const questions = [
    `Why was the ${displayIdentity} Lens selected?`,
    `Which exact evidence did the ${displayIdentity} Lens use?`,
    `What would change the ${displayIdentity} Lens view?`,
    `Why does the ${displayIdentity} Lens have zero formal decision weight?`,
  ];
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("Current finalized Chat V2 must not call the network.");
  };
  try {
    for (const question of questions) {
      const response = await POST(currentChatRequest({
        question,
        reportId: fixture.reportId,
        runId: fixture.runId,
        dealId: fixture.bundle.dealId,
      }), undefined, fixture.dependencies);
      assert.equal(response.status, 200, question);
      const payload = await response.json() as {
        data: FinalizedChatResponseV2 & {
          memoryStatus: string;
          usedXTrace: boolean;
        };
      };
      assert.equal(payload.data.schemaVersion, "finalized-chat-response-v2");
      assert.equal(payload.data.status, "success", question);
      if (payload.data.status !== "success") continue;
      assert.equal(
        payload.data.target.publicDisplayIdentity,
        displayIdentity,
        question,
      );
      assert.equal(
        payload.data.projection.presentationIdentity.presentationReportId,
        fixture.reportId,
      );
      assert.equal(payload.data.memoryStatus, "disabled");
      assert.equal(payload.data.usedXTrace, false);
      assert.ok(payload.data.citations.length > 0, question);
      assert.doesNotMatch(payload.data.answer, /CHANGED_BELIEF_EVIDENCE/u);
      assert.doesNotMatch(payload.data.answer, /\bfact_1\b|\bcounter_1\b/u);
    }
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("current partial candidate remains readable without fabricated withheld prose", async () => {
  const bundle = currentNamedLensBundle();
  bundle.terminalStatus = "partial";
  bundle.terminalReasonCodes = ["named_lens_provider_timeout"];
  const fixture = currentNamedLensRouteFixture({
    bundle,
    candidateStatus: "partial",
  });
  const response = await POST(currentChatRequest({
    question:
      `Why was the ${fixture.component.attribution.display} Lens selected?`,
    reportId: fixture.reportId,
    runId: fixture.runId,
    dealId: fixture.bundle.dealId,
  }), undefined, fixture.dependencies);

  assert.equal(response.status, 200);
  const payload = await response.json() as {
    data: FinalizedChatResponseV2;
  };
  assert.equal(payload.data.schemaVersion, "finalized-chat-response-v2");
  assert.equal(payload.data.status, "success");
});

test("current adapter integrity failures return bounded 409 and never call a network path", async () => {
  const cases: Array<{
    label: string;
    mutate: (bundle: CandidateArtifactBundle) => void;
  }> = [{
    label: "unknown version",
    mutate(bundle) {
      bundle.versionSnapshot = {
        ...bundle.versionSnapshot,
        schemaVersion: "unknown-version",
        settingsFingerprint: "unknown-settings",
        applicationCommit: "unknown-commit",
      };
      for (const field of [
        "frameworkCatalogVersion",
        "frameworkCatalogFingerprint",
        "frameworkCorpusDigest",
        "namedLensSelectionPolicyVersion",
        "namedLensPassageSchemaVersion",
        "namedLensGeneratorVersion",
        "underwritingPresentationSchemaVersion",
        "decisionTaxonomyVersion",
        "decisionTaxonomyDigest",
        "criticalEvidenceProjectionFingerprint",
        "finalDispositionsFingerprint",
        "presentationFingerprint",
        "refreshNonce",
      ] as const) {
        delete (bundle.versionSnapshot as Record<string, unknown>)[field];
      }
    },
  }, {
    label: "missing presentation",
    mutate(bundle) {
      delete bundle.namedLensPresentation;
    },
  }, {
    label: "cross-report presentation",
    mutate(bundle) {
      bundle.underwritingPresentationReportId = "report_other";
    },
  }, {
    label: "fingerprint mismatch",
    mutate(bundle) {
      bundle.namedLensPresentation = {
        ...bundle.namedLensPresentation!,
        fingerprint: sha("f"),
      };
    },
  }, {
    label: "duplicate physical passage outside the exact disposition graph",
    mutate(bundle) {
      const duplicate = structuredClone(bundle.namedLensPassages![0]!);
      duplicate.fingerprint = sha("e");
      bundle.namedLensPassages!.push(duplicate);
    },
  }];
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("Integrity rejection must not call the network.");
  };
  try {
    for (const item of cases) {
      const bundle = currentNamedLensBundle();
      item.mutate(bundle);
      const fixture = currentNamedLensRouteFixture({ bundle });
      const response = await POST(currentChatRequest({
        question:
          `Why was the ${fixture.component.attribution.display} Lens selected?`,
        reportId: fixture.reportId,
        runId: fixture.runId,
        dealId: fixture.bundle.dealId,
      }), undefined, fixture.dependencies);
      assert.equal(response.status, 409, item.label);
      const payload = await response.json() as {
        error: { code: string; message: string };
      };
      assert.equal(payload.error.code, "CONFLICT", item.label);
      assert.equal(
        payload.error.message,
        "Underwriting presentation identity is unavailable or inconsistent.",
        item.label,
      );
    }
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("exact pinned-23 and pre-passage-30 adapters preserve immutable Chat V1 routing", async () => {
  for (const adapter of ["pinned_23", "pre_passage_30"] as const) {
    const fixture = currentNamedLensRouteFixture();
    adaptCurrentFixtureToLegacy(fixture, adapter);
    const response = await POST(currentChatRequest({
      question: "What evidence is still missing?",
      reportId: fixture.reportId,
      runId: fixture.runId,
      dealId: fixture.bundle.dealId,
    }), undefined, fixture.dependencies);

    assert.equal(response.status, 200, adapter);
    const payload = await response.json() as {
      data: {
        schemaVersion: string;
        status: string;
        topic: string | null;
        projection?: { schemaVersion: string };
      };
    };
    assert.equal(payload.data.status, "success", adapter);
    assert.equal(payload.data.schemaVersion, "finalized-chat-response-v1", adapter);
    assert.equal(payload.data.topic, "missing_evidence", adapter);
    assert.equal(
      payload.data.projection?.schemaVersion,
      "finalized-chat-projection-v1",
      adapter,
    );
  }
});
