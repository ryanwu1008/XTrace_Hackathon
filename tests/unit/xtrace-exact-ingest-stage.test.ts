import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { ExactXTraceParentUnit } from "../../lib/xtrace/exact-parent-planner";
import {
  runExactXTraceIngestStage,
} from "../../worker/ingest-exact-xtrace-parents";
import { createMemoryXTraceLineageRepository } from "../../db/repositories/xtrace-lineage";
import { runExactXTraceIngestWorker } from "../../worker/run-exact-xtrace-ingest";

function parent(index: number): ExactXTraceParentUnit {
  return {
    workspaceId: "workspace_demo",
    dealId: `deal_${index}`,
    sourceId: `source_${index}`,
    sourceRevisionId: `revision_${index}`,
    parentKind: "canonical_source_revision",
    parentFingerprint: `sha256:${String(index).repeat(64)}`,
    payloadFingerprint: `sha256:${String(index + 2).repeat(64)}`,
    bundle: {
      dealId: `deal_${index}`,
      companyName: `Company ${index}`,
      status: "passed",
      facts: [],
      interactions: [],
    },
  };
}

test("explicit exact-parent ingest stage plans once and returns one typed result per parent", async () => {
  const parents = [parent(1), parent(2)];
  const calls: string[] = [];
  const result = await runExactXTraceIngestStage({
    workspaceId: "workspace_demo",
    planner: {
      async plan(workspaceId) {
        assert.equal(workspaceId, "workspace_demo");
        return parents;
      },
    },
    service: {
      async ingestExactParent(unit) {
        calls.push(unit.sourceRevisionId);
        if (unit.dealId === "deal_2") {
          const error = new Error("operator reconciliation required") as Error & {
            code: string;
          };
          error.code = "XTRACE_SUBMISSION_UNKNOWN";
          throw error;
        }
        return {
          intentId: "intent_1",
          state: "succeeded" as const,
          providerJobId: "job_1",
          memoryIds: ["memory_1"],
          reused: false,
        };
      },
      async pollExactIntent() {
        throw new Error("Terminal fake ingests must not poll.");
      },
    },
  });

  assert.deepEqual(calls, ["revision_1", "revision_2"]);
  assert.deepEqual(result, {
    workspaceId: "workspace_demo",
    parentCount: 2,
    results: [{
      dealId: "deal_1",
      parentKind: "canonical_source_revision",
      sourceId: "source_1",
      sourceRevisionId: "revision_1",
      outcome: "recorded",
      ingest: {
        intentId: "intent_1",
        state: "succeeded",
        providerJobId: "job_1",
        memoryIds: ["memory_1"],
        reused: false,
      },
    }, {
      dealId: "deal_2",
      parentKind: "canonical_source_revision",
      sourceId: "source_2",
      sourceRevisionId: "revision_2",
      outcome: "failed",
      failureCode: "XTRACE_SUBMISSION_UNKNOWN",
    }],
  });
});

test("a submitting exact intent without a provider job is blocked, never recorded", async () => {
  const result = await runExactXTraceIngestStage({
    workspaceId: "workspace_demo",
    planner: { async plan() { return [parent(1)]; } },
    service: {
      async ingestExactParent() {
        return {
          intentId: "intent_1",
          state: "submitting" as const,
          providerJobId: null,
          memoryIds: [],
          reused: true,
        };
      },
      async pollExactIntent() {
        throw new Error("A jobless submitting intent cannot be polled.");
      },
    },
  });

  assert.deepEqual(result.results.map(({ outcome }) => outcome), ["failed"]);
  assert.equal(
    result.results[0]?.outcome === "failed"
      ? result.results[0].failureCode
      : "",
    "XTRACE_EXACT_INGEST_BLOCKED",
  );
});

test("the callable exact-ingest worker composes authority planning with v2 child links", async () => {
  const lineage = createMemoryXTraceLineageRepository({
    isParentActive: () => true,
  });
  const result = await runExactXTraceIngestWorker({
    workspaceId: "workspace_demo",
  }, {
    dealRegistry: {
      async listForWorkspace() {
        return [{
          id: "deal_1",
          workspaceId: "workspace_demo",
          companyId: "company_1",
          companyName: "Acme",
          status: "passed",
          analysisEligibleAt: "2026-08-03T00:00:00.000Z",
          activeSourceRevisionFingerprint: `sha256:${"f".repeat(64)}`,
          activeSourceRevisionIds: ["revision_1"],
        }];
      },
      async listActiveSourceAssignments() {
        return [{
          workspaceId: "workspace_demo",
          dealId: "deal_1",
          sourceId: "source_1",
          sourceRevisionId: "revision_1",
        }];
      },
      async getExactSourceBundle() {
        return {
          workspaceId: "workspace_demo",
          dealId: "deal_1",
          sourceId: "source_1",
          sourceRevisionId: "revision_1",
          bundle: {
            dealId: "deal_1",
            companyName: "Acme",
            status: "passed" as const,
            facts: [{
              text: "Acme has ten customers.",
              sources: [{
                id: "evidence_1",
                documentId: "source_1",
                sourceRevisionId: "revision_1",
                provenance: "source_document" as const,
                title: "Acme",
                excerpt: "Acme has ten customers.",
              }],
            }],
            interactions: [],
          },
        };
      },
    },
    sourceRegistry: {
      async getRevision() {
        return {
          id: "revision_1",
          workspaceId: "workspace_demo",
          sourceId: "source_1",
          revision: 1,
          contentHash: `sha256:${"a".repeat(64)}`,
          objectKey: "private/source_1",
          objectVersion: "1",
          contentType: "text/plain",
          extractorId: "test",
          extractorVersion: "1",
          extractedAt: "2026-08-03T00:00:00.000Z",
          createdAt: "2026-08-03T00:00:00.000Z",
        };
      },
    },
    lineageRepository: lineage,
    client: {
      async ingest() {
        return {
          id: "job_v2",
          status: "succeeded" as const,
          result: {
            memories_created: [{ id: "memory_v2", type: "fact", text: "Acme" }],
          },
        };
      },
    } as never,
    limiter: { async acquire() {} },
  } as never);

  assert.equal(result.parentCount, 1);
  assert.equal(result.results[0]?.outcome, "recorded");
  assert.ok(await lineage.resolveExact({
    workspaceId: "workspace_demo",
    memoryId: "memory_v2",
    dealId: "deal_1",
    activeParentFingerprint: `sha256:${"f".repeat(64)}`,
  }));
});

test("the normal corpus-confirm route prepares authority without legacy v1 auto-ingest", () => {
  const route = readFileSync(new URL(
    "../../app/api/imports/confirm/route.ts",
    import.meta.url,
  ), "utf8");
  assert.doesNotMatch(route, /\.ingestDealMemory\s*\(/u);
  assert.match(route, /xtraceExactIngestPrepared/u);
});
