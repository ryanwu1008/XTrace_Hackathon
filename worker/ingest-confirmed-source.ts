import type { DealMemoryBundle } from "../lib/contracts/domain";
import type {
  ClaimedUploadedDocument,
  UploadedDocumentsRepository,
} from "../db/repositories/uploaded-documents";
import type { ExactSourceMemoryBundle } from "../db/repositories/deal-registry";
import type { SourceEvidenceInput } from "../db/repositories/evidence-packs";
import type { PersistedIngest } from "../lib/xtrace/service";
import { parseSourceRefV2Read } from "../lib/contracts/legacy-evidence-adapter";
import { sourceTextForRetrieval } from "../lib/contracts/source-evidence";
import {
  STRUCTURED_IMAGE_EVIDENCE_PREFIX,
} from "../lib/uploads/structured-image-evidence";

export interface ConfirmedSourceLineage {
  sourceRevisionIds: string[];
  sourceIds: string[];
  fixtureIds: string[];
}

export type ConfirmedSourceProcessingResult =
  | {
    kind: "xtrace_ingested";
    ingest: PersistedIngest;
  }
  | {
    kind: "ready_without_xtrace_memory";
    reason: "image_without_exact_quote";
  };

export async function processConfirmedSource(
  upload: ClaimedUploadedDocument,
  dependencies: {
    loadBundle: (
      upload: ClaimedUploadedDocument,
    ) => Promise<ExactSourceMemoryBundle | null>;
    loadCanonicalEvidence?: (
      upload: ClaimedUploadedDocument,
    ) => Promise<SourceEvidenceInput[]>;
    ingest?: (
      bundle: DealMemoryBundle,
      lineage: ConfirmedSourceLineage,
    ) => Promise<PersistedIngest>;
    poll?: (
      jobId: string,
      options: { dealId: string },
    ) => Promise<PersistedIngest>;
    complete: UploadedDocumentsRepository["completeConfirmed"];
    fail?: UploadedDocumentsRepository["failConfirmed"];
  },
): Promise<ConfirmedSourceProcessingResult> {
  try {
    if (!upload.dealId || !upload.sourceId || !upload.sourceRevisionId) {
      throw new Error("Confirmed upload lineage is incomplete.");
    }
    const exact = await dependencies.loadBundle(upload);
    if (
      !exact
      || exact.workspaceId !== upload.workspaceId
      || exact.dealId !== upload.dealId
      || exact.sourceId !== upload.sourceId
      || exact.sourceRevisionId !== upload.sourceRevisionId
    ) {
      throw new Error(
        "Confirmed source facts do not match the exact revision ownership.",
      );
    }
    const bundle = exact.bundle;
    if (isImageWithoutExactQuote(upload, bundle)) {
      const canonicalEvidence =
        await dependencies.loadCanonicalEvidence?.(upload) ?? [];
      if (canonicalEvidence.length === 0) {
        throw new Error(
          "Confirmed image source has no canonical image evidence.",
        );
      }
      if (
        canonicalEvidence.some((evidence) =>
          evidence.workspaceId !== upload.workspaceId
          || evidence.dealId !== upload.dealId
          || evidence.sourceId !== upload.sourceId
          || evidence.sourceRevisionId !== upload.sourceRevisionId
          || evidence.locator.kind !== "image"
        )
      ) {
        throw new Error(
          "Confirmed canonical image evidence ownership is not exact.",
        );
      }
      const completed = await dependencies.complete({
        workspaceId: upload.workspaceId,
        id: upload.id,
        workerId: upload.workerId,
        leaseToken: upload.leaseToken,
      });
      if (!completed) {
        throw new Error(
          "Confirmed upload claim was lost before completion.",
        );
      }
      return {
        kind: "ready_without_xtrace_memory",
        reason: "image_without_exact_quote",
      };
    }
    if (bundle.facts.length === 0) {
      throw new Error("Confirmed source has no exact source-backed facts.");
    }
    if (!dependencies.ingest) {
      throw new Error(
        "XTrace is not configured for confirmed source ingest.",
      );
    }
    const exactLineage: ConfirmedSourceLineage = {
      sourceRevisionIds: [upload.sourceRevisionId],
      sourceIds: [upload.sourceId],
      fixtureIds: [],
    };
    let result = await dependencies.ingest(bundle, exactLineage);
    if (
      (result.status === "pending" || result.status === "running")
      && dependencies.poll
    ) {
      result = await dependencies.poll(result.jobId, {
        dealId: bundle.dealId,
      });
    }
    if (result.status !== "succeeded") {
      throw new Error(`XTrace ingest ended in ${result.status}.`);
    }
    const completed = await dependencies.complete({
      workspaceId: upload.workspaceId,
      id: upload.id,
      workerId: upload.workerId,
      leaseToken: upload.leaseToken,
    });
    if (!completed) {
      throw new Error(
        "Confirmed upload claim was lost before completion.",
      );
    }
    return {
      kind: "xtrace_ingested",
      ingest: result,
    };
  } catch (error) {
    await dependencies.fail?.({
      workspaceId: upload.workspaceId,
      id: upload.id,
      workerId: upload.workerId,
      leaseToken: upload.leaseToken,
      reason: "Memory ingestion failed. Retry is available.",
    });
    throw error;
  }
}

function isImageWithoutExactQuote(
  upload: ClaimedUploadedDocument,
  bundle: DealMemoryBundle,
): boolean {
  return upload.contentType.startsWith("image/")
    && bundle.facts.length > 0
    && bundle.facts.every((fact) =>
      fact.text.startsWith(STRUCTURED_IMAGE_EVIDENCE_PREFIX)
      && fact.sources.length > 0
      && fact.sources.every((source) =>
        source.provenance === "model_inference"
        && source.documentId === upload.sourceId
        && source.sourceRevisionId === upload.sourceRevisionId
        && sourceTextForRetrieval(parseSourceRefV2Read(source)).startsWith(
          STRUCTURED_IMAGE_EVIDENCE_PREFIX,
        )
      )
    )
    && Boolean(upload.extractionPreview?.facts.length)
    && upload.extractionPreview!.facts.every((fact) =>
      fact.excerpt === null && fact.locator.kind === "image"
    );
}
