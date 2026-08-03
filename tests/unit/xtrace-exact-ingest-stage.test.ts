import assert from "node:assert/strict";
import test from "node:test";

import type { ExactXTraceParentUnit } from "../../lib/xtrace/exact-parent-planner";
import {
  runExactXTraceIngestStage,
} from "../../worker/ingest-exact-xtrace-parents";

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
