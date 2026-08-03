import assert from "node:assert/strict";
import test from "node:test";

import {
  POST,
  resolveFinalizedRouteCandidateBinding,
} from "../../app/api/chat/route";
import { getIntelligenceRepository } from "../../db/repositories/intelligence";
import type { RouteDependencies } from "../../lib/api/route-dependencies";
import { canonicalIntelligenceReportFixture } from "../helpers/canonical-intelligence-report";

test("route identity preserves a scoped rerun alias and explicitly binds its immutable source candidate", () => {
  assert.deepEqual(resolveFinalizedRouteCandidateBinding({
    id: "candidate_alias",
    rerunOfId: "candidate_original",
    candidateAnalysisFingerprint: "fp:stable",
  }), {
    candidateRunId: "candidate_alias",
    rerunOfId: "candidate_original",
    candidateAnalysisFingerprint: "fp:stable",
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
