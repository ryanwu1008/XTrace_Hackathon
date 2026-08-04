import {
  SAMPLE_RESEARCH_SCREENING_RECORD_LABEL,
  type ResearchDispositionMemoryPayload,
} from "../contracts/research-candidate";
import {
  WritableSourceRefV2Schema,
  type WritableSourceRefV2,
} from "../contracts/source-evidence";

export function renderSampleResearchScreeningStatement(
  payload: ResearchDispositionMemoryPayload,
): string {
  return [
    `${SAMPLE_RESEARCH_SCREENING_RECORD_LABEL}.`,
    "Synthetic research-only context; no meeting or VC interaction occurred.",
    `Disposition: ${payload.disposition}.`,
    `Qualification: ${payload.qualificationRationale}`,
    `Not selected reason: ${payload.notSelectedReason}`,
    `Reconsideration conditions: ${payload.reconsiderationConditions.join(" ")}`,
  ].join(" ");
}

export function buildSampleResearchScreeningSourceRef(input: {
  payload: ResearchDispositionMemoryPayload;
  documentId: string;
  sourceRevisionId: string;
  contentFingerprint: string;
}): WritableSourceRefV2 {
  return WritableSourceRefV2Schema.parse({
    schemaVersion: "source-ref-v2",
    adaptation: "canonical",
    id: input.payload.id,
    provenance: "source_document",
    title: SAMPLE_RESEARCH_SCREENING_RECORD_LABEL,
    canonicalUrl: null,
    documentId: input.documentId,
    publisher: "Internal Research Registry",
    providerId: "belief-reversal-research-seed-v1",
    eventAt: input.payload.recordedAt,
    eventAtPrecision: "timestamp",
    publishedAt: null,
    publishedAtPrecision: null,
    retrievedAt: input.payload.recordedAt,
    retrievedAtPrecision: "timestamp",
    updatedAt: null,
    updatedAtPrecision: null,
    entityKeys: [...input.payload.entityKeys],
    sourceClass: "internal_decision_record",
    sourceAuthority: "primary",
    evidenceRole: "context",
    sourceRevisionId: input.sourceRevisionId,
    locator: { kind: "json_pointer", pointer: "/record" },
    contentFingerprint: input.contentFingerprint,
    text: {
      status: "normalized_only",
      normalizedStatement: renderSampleResearchScreeningStatement(
        input.payload,
      ),
    },
  });
}
