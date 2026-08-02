import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryIntelligenceRepository } from "../../db/repositories/intelligence";
import { createMemoryUploadedDocumentsRepository } from "../../db/repositories/uploaded-documents";
import { createMemoryXTraceLineageRepository } from "../../db/repositories/xtrace-lineage";
import { createMemoryDemoDataStore } from "../../lib/storage/service";
import { canonicalIntelligenceReportFixture } from "../helpers/canonical-intelligence-report";

const first = { workspaceId: "workspace:a", id: "external" };
const second = { workspaceId: "workspace", id: "a:external" };

test("memory corpus identity is injective when workspace and external ids contain delimiters", async () => {
  const store = createMemoryDemoDataStore();
  await store.ensureCompany({ ...first, name: "First" });
  await store.ensureCompany({ ...second, name: "Second" });

  assert.deepEqual(
    store.inspect().companies
      .map(({ workspaceId, id, name }) => ({ workspaceId, id, name }))
      .sort((left, right) => left.workspaceId.localeCompare(right.workspaceId)),
    [
      { workspaceId: "workspace", id: "a:external", name: "Second" },
      { workspaceId: "workspace:a", id: "external", name: "First" },
    ],
  );
});

test("memory report identity is injective when workspace and report ids contain delimiters", async () => {
  const repository = createMemoryIntelligenceRepository();
  for (const [identity, marketSummary] of [
    [first, "First"],
    [second, "Second"],
  ] as const) {
    await repository.saveReport(canonicalIntelligenceReportFixture({
      ...identity,
      runId: `run_${marketSummary.toLowerCase()}`,
      createdAt: "2026-07-28T12:00:00.000Z",
      marketSummary,
    }));
  }

  assert.equal(
    (await repository.getReport(first.workspaceId, first.id))?.marketSummary,
    "First",
  );
  assert.equal(
    (await repository.getReport(second.workspaceId, second.id))?.marketSummary,
    "Second",
  );
});

test("memory XTrace identity is injective when workspace and job ids contain delimiters", async () => {
  const repository = createMemoryXTraceLineageRepository();
  for (const [identity, dealId] of [
    [first, "deal_first"],
    [second, "deal_second"],
  ] as const) {
    await repository.recordSubmission({
      workspaceId: identity.workspaceId,
      jobId: identity.id,
      dealId,
      sourceIds: [],
      fixtureIds: [],
      bundleFingerprint: `fingerprint_${dealId}`,
      serializerVersion: "deal-memory-v1",
      provenance: "source_document",
      status: "pending",
    });
  }

  assert.deepEqual(
    (await repository.listOpenJobs(first.workspaceId)).map(({ dealId }) =>
      dealId
    ),
    ["deal_first"],
  );
  assert.deepEqual(
    (await repository.listOpenJobs(second.workspaceId)).map(({ dealId }) =>
      dealId
    ),
    ["deal_second"],
  );
});

test("memory upload identity is injective when workspace and upload ids contain delimiters", async () => {
  const repository = createMemoryUploadedDocumentsRepository();
  for (const [identity, filename] of [
    [first, "first.txt"],
    [second, "second.txt"],
  ] as const) {
    await repository.create({
      ...identity,
      filename,
      contentType: "text/plain",
      byteSize: 1,
      checksum: `checksum_${filename}`,
      objectKey: `private/${filename}`,
    });
  }

  assert.equal((await repository.get(first))?.filename, "first.txt");
  assert.equal((await repository.get(second))?.filename, "second.txt");
});
