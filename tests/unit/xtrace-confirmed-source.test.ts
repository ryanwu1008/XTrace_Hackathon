import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryXTraceLineageRepository } from "../../db/repositories/xtrace-lineage";
import {
  createMemoryUploadedDocumentsRepository,
  type ExtractionPreview,
} from "../../db/repositories/uploaded-documents";
import type { SourceEvidenceInput } from "../../db/repositories/evidence-packs";
import { createXTraceService } from "../../lib/xtrace/service";
import { processConfirmedSource } from "../../worker/ingest-confirmed-source";

const preview: ExtractionPreview = {
  candidateCompanyName: "Acme",
  candidateHeadline: "Acme builds software.",
  facts: [{
    text: "Acme has ten customers.",
    excerpt: "Acme has ten customers.",
    locator: { kind: "text_range", start: 0, end: 23 },
  }],
  extractionMetadata: {
    extractorId: "plain_text_v1",
    extractorVersion: "1",
    extractedAt: "2026-07-29T12:00:00.000Z",
    contentHash: "hash",
    inputBytes: 23,
    extractedCharacters: 23,
    truncated: false,
  },
};

const imagePreview: ExtractionPreview = {
  candidateCompanyName: "Image Co",
  candidateHeadline: "Image Co reported $8M ARR.",
  facts: [{
    text: "Image Co reported $8M ARR.",
    excerpt: null,
    locator: { kind: "image", imageIndex: 0 },
    structured: {
      field: "arr",
      value: "8000000",
      unit: null,
      currency: "USD",
      periodStart: null,
      periodEnd: "2026-06-30",
      publishedAt: null,
      eventAt: null,
    },
  }],
  extractionMetadata: {
    extractorId: "claude_vision_v1",
    extractorVersion: "1",
    extractedAt: "2026-07-29T12:00:00.000Z",
    contentHash: "image-hash",
    inputBytes: 4096,
    extractedCharacters: 26,
    truncated: false,
  },
};

test("confirmed-source ingest persists exact revision lineage in jobs and recalled memory", async () => {
  const lineage = createMemoryXTraceLineageRepository();
  const service = createXTraceService({
    ingest: async () => ({
      id: "job_confirmed",
      status: "succeeded",
      result: {
        memories_created: [{
          id: "memory_confirmed",
          type: "fact",
          text: "Acme has ten customers.",
        }],
      },
    }),
  } as never, {
    workspaceId: "workspace_1",
    lineageRepository: lineage,
  });

  await service.ingestDealMemory({
    dealId: "deal_1",
    companyName: "Acme",
    status: "evaluating",
    facts: [{
      text: "Acme has ten customers.",
      sources: [{
        id: "evidence_upload_1_0",
        documentId: "source_upload_1",
        provenance: "source_document",
        title: "acme.txt",
        excerpt: "Acme has ten customers.",
      }],
    }],
    interactions: [],
  }, {
    sourceRevisionIds: ["revision_upload_1"],
    sourceIds: ["source_upload_1"],
    fixtureIds: [],
  });

  assert.deepEqual(await lineage.resolve({
    workspaceId: "workspace_1",
    memoryId: "memory_confirmed",
  }), {
    workspaceId: "workspace_1",
    memoryId: "memory_confirmed",
    dealId: "deal_1",
    sourceRevisionIds: ["revision_upload_1"],
    sourceIds: ["source_upload_1"],
    fixtureIds: [],
    provenance: "source_document",
  });
});

test("a newer revision of the same source cannot ingest under an older revision lineage", async () => {
  const uploads = createMemoryUploadedDocumentsRepository();
  await uploads.create({
    id: "upload_old_revision",
    workspaceId: "workspace_1",
    filename: "acme.txt",
    contentType: "text/plain",
    byteSize: 23,
    checksum: "old-hash",
    objectKey: "private/acme-old.txt",
  });
  await stageConfirmed(uploads, {
    id: "upload_old_revision",
    dealId: "deal_1",
    sourceId: "source_acme",
    sourceRevisionId: "revision_old",
  });
  const claimed = await uploads.claimNextConfirmed("worker-a");
  assert.ok(claimed);
  let ingestCalls = 0;

  await assert.rejects(processConfirmedSource(claimed, {
    loadBundle: async () => ({
      workspaceId: "workspace_1",
      dealId: "deal_1",
      sourceId: "source_acme",
      sourceRevisionId: "revision_new",
      bundle: {
        dealId: "deal_1",
        companyName: "Acme",
        status: "evaluating",
        facts: [{
          text: "Fact from revision two.",
          sources: [{
            id: "evidence_revision_two",
            documentId: "source_acme",
            provenance: "source_document",
            title: "acme.txt",
            excerpt: "Fact from revision two.",
          }],
        }],
        interactions: [],
      },
    }),
    ingest: async () => {
      ingestCalls += 1;
      return {
        dealId: "deal_1",
        jobId: "job_wrong_revision",
        status: "succeeded",
        memoryIds: ["memory_wrong_revision"],
      };
    },
    complete: (
      input: Parameters<typeof uploads.completeConfirmed>[0],
    ) => uploads.completeConfirmed(input),
    fail: (input) => uploads.failConfirmed(input),
  }), /revision/i);
  assert.equal(ingestCalls, 0);
});

test("only a confirmed claim reaches XTrace and success is lease-token guarded", async () => {
  const uploads = createMemoryUploadedDocumentsRepository();
  await uploads.create({
    id: "upload_1",
    workspaceId: "workspace_1",
    filename: "acme.txt",
    contentType: "text/plain",
    byteSize: 23,
    checksum: "hash",
    objectKey: "private/acme.txt",
  });
  assert.equal(await uploads.claimNextConfirmed("worker-a"), null);
  await stageConfirmed(uploads, {
    id: "upload_1",
    dealId: "deal_1",
    sourceId: "source_upload_1",
    sourceRevisionId: "revision_upload_1",
  });
  const claimed = await uploads.claimNextConfirmed("worker-a");
  assert.ok(claimed);
  const calls: string[] = [];

  await processConfirmedSource(claimed, {
    loadBundle: async () => ({
      workspaceId: "workspace_1",
      dealId: "deal_1",
      sourceId: "source_upload_1",
      sourceRevisionId: "revision_upload_1",
      bundle: {
        dealId: "deal_1",
        companyName: "Acme",
        status: "evaluating",
        facts: [{
          text: "Acme has ten customers.",
          sources: [{
            id: "evidence_upload_1_0",
            documentId: "source_upload_1",
            provenance: "source_document",
            title: "acme.txt",
            excerpt: "Acme has ten customers.",
          }],
        }],
        interactions: [],
      },
    }),
    ingest: async (_bundle, exactLineage) => {
      calls.push(JSON.stringify(exactLineage));
      return {
        dealId: "deal_1",
        jobId: "job_1",
        status: "succeeded",
        memoryIds: ["memory_1"],
      };
    },
    complete: (input) => uploads.completeConfirmed(input),
  });

  assert.deepEqual(calls.map((value) => JSON.parse(value)), [{
    sourceRevisionIds: ["revision_upload_1"],
    sourceIds: ["source_upload_1"],
    fixtureIds: [],
  }]);
  assert.equal((await uploads.get({
    workspaceId: "workspace_1",
    id: "upload_1",
  }))?.status, "ready");
});

test("normal confirmed-source processing writes v2 exact links and never calls legacy ingest", async () => {
  const uploads = createMemoryUploadedDocumentsRepository();
  await uploads.create({
    id: "upload_v2",
    workspaceId: "workspace_1",
    filename: "acme.txt",
    contentType: "text/plain",
    byteSize: 23,
    checksum: "hash-v2",
    objectKey: "private/acme-v2.txt",
  });
  await stageConfirmed(uploads, {
    id: "upload_v2",
    dealId: "deal_1",
    sourceId: "source_upload_1",
    sourceRevisionId: "revision_upload_1",
  });
  const claimed = await uploads.claimNextConfirmed("worker-v2");
  assert.ok(claimed);
  const exact = {
    workspaceId: "workspace_1",
    dealId: "deal_1",
    sourceId: "source_upload_1",
    sourceRevisionId: "revision_upload_1",
    parentKind: "legacy_source_revision" as const,
    parentFingerprint: `sha256:${"a".repeat(64)}`,
    payloadFingerprint: `sha256:${"b".repeat(64)}`,
    bundle: {
      dealId: "deal_1",
      companyName: "Acme",
      status: "evaluating" as const,
      facts: [{
        text: "Acme has ten customers.",
        sources: [{
          id: "evidence_upload_1_0",
          documentId: "source_upload_1",
          sourceRevisionId: "revision_upload_1",
          provenance: "source_document" as const,
          title: "acme.txt",
          excerpt: "Acme has ten customers.",
        }],
      }],
      interactions: [],
    },
  };
  let exactCalls = 0;
  let legacyCalls = 0;
  const result = await processConfirmedSource(claimed, {
    loadBundle: async () => exact,
    loadExactParent: async () => exact,
    ingestExactParent: async () => {
      exactCalls += 1;
      return {
        intentId: "intent_v2",
        state: "succeeded" as const,
        providerJobId: "job_v2",
        memoryIds: ["memory_v2"],
        reused: false,
      };
    },
    ingest: async () => {
      legacyCalls += 1;
      return {
        dealId: "deal_1",
        jobId: "legacy_job",
        status: "succeeded" as const,
        memoryIds: ["legacy_memory"],
      };
    },
    complete: (
      input: Parameters<typeof uploads.completeConfirmed>[0],
    ) => uploads.completeConfirmed(input),
  } as never);

  assert.equal(result.kind, "xtrace_ingested");
  assert.equal(exactCalls, 1);
  assert.equal(legacyCalls, 0);
});

test("confirmed image evidence becomes ready without inventing XTrace memory", async () => {
  const uploads = createMemoryUploadedDocumentsRepository();
  await uploads.create({
    id: "upload_image",
    workspaceId: "workspace_1",
    filename: "image.png",
    contentType: "image/png",
    byteSize: 4096,
    checksum: "image-hash",
    objectKey: "private/image.png",
  });
  await stageConfirmed(uploads, {
    id: "upload_image",
    dealId: "deal_image",
    sourceId: "source_image",
    sourceRevisionId: "revision_image",
  }, imagePreview);
  const claimed = await uploads.claimNextConfirmed("worker-image");
  assert.ok(claimed);
  let failCalls = 0;
  const canonicalEvidence: SourceEvidenceInput[] = [{
    id: "evidence_image_0",
    workspaceId: "workspace_1",
    dealId: "deal_image",
    sourceId: "source_image",
    sourceRevisionId: "revision_image",
    provenanceOrigin: "uploaded_document",
    field: "arr",
    value: "8000000",
    unit: null,
    currency: "USD",
    periodStart: null,
    periodEnd: "2026-06-30",
    publishedAt: null,
    eventAt: null,
    retrievedAt: "2026-07-29T12:00:00.000Z",
    locator: { kind: "image", imageIndex: 0, region: null },
    sourceRole: "management",
    assertionStatus: "reported",
    verificationMethod: null,
    freshness: "current",
    acceptedForGate: true,
  }];
  const dependencies = {
    loadBundle: async () => ({
      workspaceId: "workspace_1",
      dealId: "deal_image",
      sourceId: "source_image",
      sourceRevisionId: "revision_image",
      bundle: {
        dealId: "deal_image",
        companyName: "Image Co",
        status: "screening" as const,
        facts: [{
          text:
            "Structured image evidence (not a quotation): arr = 8000000 USD.",
          sources: [{
            id: "evidence_image_0",
            provenance: "model_inference" as const,
            title: "image.png",
            documentId: "source_image",
            sourceRevisionId: "revision_image",
            excerpt:
              "Structured image evidence (not a quotation): arr = 8000000 USD.",
          }],
        }],
        interactions: [],
      },
    }),
    loadCanonicalEvidence: async () => canonicalEvidence,
    complete: (input: Parameters<typeof uploads.completeConfirmed>[0]) =>
      uploads.completeConfirmed(input),
    fail: async (
      input: Parameters<typeof uploads.failConfirmed>[0],
    ) => {
      failCalls += 1;
      return uploads.failConfirmed(input);
    },
  };

  const result = await processConfirmedSource(claimed, dependencies);

  assert.deepEqual(result, {
    kind: "ready_without_xtrace_memory",
    reason: "image_without_exact_quote",
  });
  assert.equal(failCalls, 0);
  assert.equal((await uploads.get({
    workspaceId: "workspace_1",
    id: "upload_image",
  }))?.status, "ready");
  assert.equal(await uploads.claimNextConfirmed("worker-next"), null);
});

test("image completion stays retryable when no accepted structured fact was projected", async () => {
  const uploads = createMemoryUploadedDocumentsRepository();
  await uploads.create({
    id: "upload_image_without_fact",
    workspaceId: "workspace_1",
    filename: "image-without-fact.png",
    contentType: "image/png",
    byteSize: 4096,
    checksum: "image-without-fact-hash",
    objectKey: "private/image-without-fact.png",
  });
  await stageConfirmed(uploads, {
    id: "upload_image_without_fact",
    dealId: "deal_image",
    sourceId: "source_image",
    sourceRevisionId: "revision_image",
  }, imagePreview);
  const claimed = await uploads.claimNextConfirmed("worker-image");
  assert.ok(claimed);
  let completeCalls = 0;
  let failCalls = 0;

  await assert.rejects(processConfirmedSource(claimed, {
    loadBundle: async () => ({
      workspaceId: "workspace_1",
      dealId: "deal_image",
      sourceId: "source_image",
      sourceRevisionId: "revision_image",
      bundle: {
        dealId: "deal_image",
        companyName: "Image Co",
        status: "screening",
        facts: [],
        interactions: [],
      },
    }),
    loadCanonicalEvidence: async (): Promise<SourceEvidenceInput[]> => [{
      id: "evidence_image_unaccepted",
      workspaceId: "workspace_1",
      dealId: "deal_image",
      sourceId: "source_image",
      sourceRevisionId: "revision_image",
      provenanceOrigin: "uploaded_document",
      field: "unstructured_source_fact",
      value: "Image Co reported $8M ARR.",
      unit: null,
      currency: null,
      periodStart: null,
      periodEnd: null,
      publishedAt: null,
      eventAt: null,
      retrievedAt: "2026-07-29T12:00:00.000Z",
      locator: { kind: "image", imageIndex: 0, region: null },
      sourceRole: "management",
      assertionStatus: "reported",
      verificationMethod: null,
      freshness: "current",
      acceptedForGate: false,
    }],
    complete: async (
      input: Parameters<typeof uploads.completeConfirmed>[0],
    ) => {
      completeCalls += 1;
      return uploads.completeConfirmed(input);
    },
    fail: async (
      input: Parameters<typeof uploads.failConfirmed>[0],
    ) => {
      failCalls += 1;
      return uploads.failConfirmed(input);
    },
  }), /no exact source-backed facts/i);

  assert.equal(completeCalls, 0);
  assert.equal(failCalls, 1);
  const retryable = await uploads.get({
    workspaceId: "workspace_1",
    id: "upload_image_without_fact",
  });
  assert.equal(retryable?.status, "confirmed");
  assert.equal(
    retryable?.failureReason,
    "Memory ingestion failed. Retry is available.",
  );
});

test("image completion rejects canonical evidence owned by another source", async () => {
  const uploads = createMemoryUploadedDocumentsRepository();
  await uploads.create({
    id: "upload_image_foreign",
    workspaceId: "workspace_1",
    filename: "image-foreign.png",
    contentType: "image/png",
    byteSize: 4096,
    checksum: "image-foreign-hash",
    objectKey: "private/image-foreign.png",
  });
  await stageConfirmed(uploads, {
    id: "upload_image_foreign",
    dealId: "deal_image",
    sourceId: "source_image",
    sourceRevisionId: "revision_image",
  }, imagePreview);
  const claimed = await uploads.claimNextConfirmed("worker-image");
  assert.ok(claimed);
  let ingestCalls = 0;
  let failCalls = 0;
  const dependencies = {
    loadBundle: async () => ({
      workspaceId: "workspace_1",
      dealId: "deal_image",
      sourceId: "source_image",
      sourceRevisionId: "revision_image",
      bundle: {
        dealId: "deal_image",
        companyName: "Image Co",
        status: "screening" as const,
        facts: [{
          text:
            "Structured image evidence (not a quotation): arr = 8000000 USD.",
          sources: [{
            id: "evidence_image_foreign",
            provenance: "model_inference" as const,
            title: "image-foreign.png",
            documentId: "source_image",
            sourceRevisionId: "revision_image",
            excerpt:
              "Structured image evidence (not a quotation): arr = 8000000 USD.",
          }],
        }],
        interactions: [],
      },
    }),
    loadCanonicalEvidence: async (): Promise<SourceEvidenceInput[]> => [{
      id: "evidence_image_foreign",
      workspaceId: "workspace_1",
      dealId: "deal_image",
      sourceId: "source_foreign",
      sourceRevisionId: "revision_image",
      provenanceOrigin: "uploaded_document",
      field: "arr",
      value: "8000000",
      unit: null,
      currency: "USD",
      periodStart: null,
      periodEnd: "2026-06-30",
      publishedAt: null,
      eventAt: null,
      retrievedAt: "2026-07-29T12:00:00.000Z",
      locator: { kind: "image", imageIndex: 0, region: null },
      sourceRole: "management",
      assertionStatus: "reported",
      verificationMethod: null,
      freshness: "current",
      acceptedForGate: true,
    }],
    ingest: async () => {
      ingestCalls += 1;
      return {
        dealId: "deal_image",
        jobId: "job_image_foreign",
        status: "succeeded" as const,
        memoryIds: ["memory_image_foreign"],
      };
    },
    complete: (input: Parameters<typeof uploads.completeConfirmed>[0]) =>
      uploads.completeConfirmed(input),
    fail: async (
      input: Parameters<typeof uploads.failConfirmed>[0],
    ) => {
      failCalls += 1;
      return uploads.failConfirmed(input);
    },
  };

  await assert.rejects(
    processConfirmedSource(claimed, dependencies),
    /canonical image evidence ownership/i,
  );

  assert.equal(ingestCalls, 0);
  assert.equal(failCalls, 1);
  const failed = await uploads.get({
    workspaceId: "workspace_1",
    id: "upload_image_foreign",
  });
  assert.equal(failed?.status, "confirmed");
  assert.equal(
    failed?.failureReason,
    "Memory ingestion failed. Retry is available.",
  );
});

test("text confirmation without a configured XTrace ingest remains retryable", async () => {
  const uploads = createMemoryUploadedDocumentsRepository();
  await uploads.create({
    id: "upload_text_unconfigured",
    workspaceId: "workspace_1",
    filename: "unconfigured.txt",
    contentType: "text/plain",
    byteSize: 23,
    checksum: "unconfigured-hash",
    objectKey: "private/unconfigured.txt",
  });
  await stageConfirmed(uploads, {
    id: "upload_text_unconfigured",
    dealId: "deal_unconfigured",
    sourceId: "source_unconfigured",
    sourceRevisionId: "revision_unconfigured",
  });
  const claimed = await uploads.claimNextConfirmed("worker-unconfigured");
  assert.ok(claimed);
  let failCalls = 0;
  const dependencies = {
    loadBundle: async () => ({
      workspaceId: "workspace_1",
      dealId: "deal_unconfigured",
      sourceId: "source_unconfigured",
      sourceRevisionId: "revision_unconfigured",
      bundle: {
        dealId: "deal_unconfigured",
        companyName: "Unconfigured Co",
        status: "screening" as const,
        facts: [{
          text: "Unconfigured Co has customers.",
          sources: [{
            id: "evidence_unconfigured",
            documentId: "source_unconfigured",
            provenance: "source_document" as const,
            title: "unconfigured.txt",
            excerpt: "Unconfigured Co has customers.",
          }],
        }],
        interactions: [],
      },
    }),
    complete: (input: Parameters<typeof uploads.completeConfirmed>[0]) =>
      uploads.completeConfirmed(input),
    fail: async (
      input: Parameters<typeof uploads.failConfirmed>[0],
    ) => {
      failCalls += 1;
      return uploads.failConfirmed(input);
    },
  };

  await assert.rejects(
    processConfirmedSource(claimed, dependencies),
    /XTrace is not configured/i,
  );
  assert.equal(failCalls, 1);
  assert.equal((await uploads.get({
    workspaceId: "workspace_1",
    id: "upload_text_unconfigured",
  }))?.status, "confirmed");
});

test("XTrace failure returns the upload to a visible retryable confirmed state", async () => {
  const uploads = createMemoryUploadedDocumentsRepository();
  await uploads.create({
    id: "upload_failure",
    workspaceId: "workspace_1",
    filename: "failure.txt",
    contentType: "text/plain",
    byteSize: 23,
    checksum: "failure-hash",
    objectKey: "private/failure.txt",
  });
  await stageConfirmed(uploads, {
    id: "upload_failure",
    dealId: "deal_failure",
    sourceId: "source_failure",
    sourceRevisionId: "revision_failure",
  });
  const claimed = await uploads.claimNextConfirmed("worker-a");
  assert.ok(claimed);

  await assert.rejects(processConfirmedSource(claimed, {
    loadBundle: async () => ({
      workspaceId: "workspace_1",
      dealId: "deal_failure",
      sourceId: "source_failure",
      sourceRevisionId: "revision_failure",
      bundle: {
        dealId: "deal_failure",
        companyName: "Failure",
        status: "watchlist",
        facts: [{
          text: "Failure source fact.",
          sources: [{
            id: "evidence_failure_0",
            documentId: "source_failure",
            provenance: "source_document",
            title: "failure.txt",
            excerpt: "Failure source fact.",
          }],
        }],
        interactions: [],
      },
    }),
    ingest: async () => {
      throw new Error("provider secret diagnostic");
    },
    complete: (input) => uploads.completeConfirmed(input),
    fail: (input) => uploads.failConfirmed(input),
  }));

  const failed = await uploads.get({
    workspaceId: "workspace_1",
    id: "upload_failure",
  });
  assert.equal(failed?.status, "confirmed");
  assert.equal(failed?.failureReason, "Memory ingestion failed. Retry is available.");
  assert.ok(await uploads.claimNextConfirmed("worker-b"));
});

async function stageConfirmed(
  uploads: ReturnType<typeof createMemoryUploadedDocumentsRepository>,
  input: {
    id: string;
    dealId: string;
    sourceId: string;
    sourceRevisionId: string;
  },
  extractionPreview: ExtractionPreview = preview,
) {
  const extraction = await uploads.claimNext("extractor");
  assert.ok(extraction);
  assert.equal(await uploads.savePreview({
    workspaceId: extraction.workspaceId,
    id: input.id,
    workerId: extraction.workerId,
    leaseToken: extraction.leaseToken,
    preview: extractionPreview,
  }), true);
  await uploads.markConfirmed({
    workspaceId: "workspace_1",
    id: input.id,
    confirmationFingerprint: `fingerprint:${input.id}`,
    dealId: input.dealId,
    sourceId: input.sourceId,
    sourceRevisionId: input.sourceRevisionId,
  });
}
