import assert from "node:assert/strict";
import test from "node:test";

import { underwritingSummaryNeedsRefresh } from
  "../../app/underwriting-summary";
import type { UnderwritingBatchSummary } from
  "../../lib/underwriting/read-model";

function batch(input: {
  status: UnderwritingBatchSummary["status"];
  queueStatuses: UnderwritingBatchSummary["queue"][number]["status"][];
}): UnderwritingBatchSummary {
  const underwritingStatusCounts = {
    queued: 0,
    running: 0,
    completed: 0,
    partial: 0,
    failed: 0,
  };
  for (const status of input.queueStatuses) {
    underwritingStatusCounts[status] += 1;
  }
  return {
    batchId: "batch_refresh_test",
    status: input.status,
    queue: input.queueStatuses.map((status, index) => ({
      batchId: "batch_refresh_test",
      dealId: `deal_${index}`,
      candidateRunId: `candidate_${index}`,
      priorityRank: index + 1,
      status,
      decision: null,
    })),
    underwritingStatusCounts,
  };
}

test("a report with belief revisions keeps refreshing until its underwriting batch exists", () => {
  assert.equal(underwritingSummaryNeedsRefresh(null, 4, "running"), true);
  assert.equal(underwritingSummaryNeedsRefresh(null, 0, "running"), true);
});

test("an active owning scan keeps refreshing while jobs are transient", () => {
  assert.equal(underwritingSummaryNeedsRefresh(batch({
    status: "completed",
    queueStatuses: ["completed", "running", "queued"],
  }), 3, "queued"), true);
});

test("a terminal owning scan stops polling when the batch is absent or short", () => {
  assert.equal(underwritingSummaryNeedsRefresh(null, 4, "partial"), false);
  assert.equal(underwritingSummaryNeedsRefresh(batch({
    status: "running",
    queueStatuses: ["running"],
  }), 4, "failed"), false);
});

test("a terminal owning scan stops polling once every exact job is terminal", () => {
  assert.equal(underwritingSummaryNeedsRefresh(batch({
    status: "partial",
    queueStatuses: ["completed", "partial", "failed"],
  }), 3, "partial"), false);
  assert.equal(underwritingSummaryNeedsRefresh(batch({
    status: "completed",
    queueStatuses: ["completed", "completed"],
  }), 2, "completed"), false);
});
