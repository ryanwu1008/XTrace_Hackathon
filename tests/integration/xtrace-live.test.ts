import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryXTraceLineageRepository } from "../../db/repositories/xtrace-lineage";
import { DEMO_FIXTURE_LABEL } from "../../lib/contracts/domain";
import { getXTraceClient } from "../../lib/xtrace/client";
import { createXTraceService } from "../../lib/xtrace/service";

const LIVE_POLL_ATTEMPTS = 17;

test("XTrace live memory bridge", { skip: process.env.XTRACE_LIVE_TEST !== "1", timeout: 180_000 }, async (context) => {
  const client = getXTraceClient({
    stage: "explicit_ingest",
    allowLive: true,
  });
  const createdMemoryIds = new Set<string>();
  const submittedJob: { id?: string } = {};
  let completedMemoryIdsKnown = false;
  const workspaceId = "demo";
  const companyName = `Northstar Loom ${Date.now()}`;
  const dealId = `xtrace-live-${companyName.toLowerCase().replaceAll(" ", "-")}`;
  const sourceId = `${dealId}-source`;
  const service = createXTraceService(client, {
    workspaceId,
    lineageRepository: createMemoryXTraceLineageRepository(),
  });
  context.after(async () => {
    try {
      if (submittedJob.id && !completedMemoryIdsKnown) {
        const completed = await service.pollIngestJob(submittedJob.id, {
          dealId,
          maxAttempts: LIVE_POLL_ATTEMPTS,
        });
        for (const memoryId of completed.memoryIds) createdMemoryIds.add(memoryId);
        completedMemoryIdsKnown = true;
      }
      const deletions = await Promise.allSettled(
        [...createdMemoryIds].map((memoryId) => client.deleteMemory(memoryId)),
      );
      if (deletions.some((result) => result.status === "rejected")) {
        throw new Error("delete failed");
      }
    } catch {
      throw new Error("XTrace live cleanup failed");
    }
  });

  const submitted = await service.ingestDealMemory({
    dealId,
    companyName,
    status: "watchlist",
    facts: [{
      text: `${companyName} builds enterprise workflow software and has signed three enterprise customers.`,
      sources: [{
        id: sourceId,
        provenance: "demo_fixture",
        title: `${companyName} synthetic enterprise workflow note`,
        excerpt: `${companyName} builds enterprise workflow software and has signed three enterprise customers.`,
      }],
    }],
    interactions: [{
      id: `${dealId}-fixture`,
      occurredAt: new Date().toISOString(),
      summary: `The VC passed on ${companyName} because market timing was early.`,
      decisionReason: `The synthetic team retained ${companyName} for an evidence-backed demo review.`,
      concerns: [],
      revisitConditions: [`Revisit ${companyName} when enterprise workflow adoption increases.`],
      provenance: "demo_fixture",
      label: DEMO_FIXTURE_LABEL,
    }],
  });
  submittedJob.id = submitted.jobId;
  for (const memoryId of submitted.memoryIds) createdMemoryIds.add(memoryId);
  completedMemoryIdsKnown = submitted.status === "succeeded" || submitted.status === "failed";

  let completed = submitted;
  if (!completedMemoryIdsKnown) {
    try {
      completed = await service.pollIngestJob(submittedJob.id, {
        dealId,
        maxAttempts: LIVE_POLL_ATTEMPTS,
      });
    } catch {
      throw new Error("XTrace live ingest polling failed");
    }
    for (const memoryId of completed.memoryIds) createdMemoryIds.add(memoryId);
    completedMemoryIdsKnown = true;
  }

  assert.equal(completed.status, "succeeded", "XTrace live ingest did not succeed");
  const recalled = await service.recallDealContext({
    workspaceId,
    query: `${companyName} enterprise workflow adoption`,
    candidateDealIds: [dealId],
    limit: 5,
  });
  const completedMemoryIds = new Set(completed.memoryIds);
  const recalledLineage = recalled.find((memory) =>
    memory.dealId === dealId && completedMemoryIds.has(memory.memoryId)
  );
  assert.ok(recalledLineage, "XTrace live recall did not resolve completed memory lineage");
  assert.equal(
    recalledLineage.provenance,
    "demo_fixture",
    "XTrace live recall did not preserve synthetic provenance",
  );
});
