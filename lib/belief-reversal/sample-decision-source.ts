import {
  WritableSourceRefV2Schema,
  type WritableSourceRefV2,
} from "../contracts/source-evidence";

export interface SampleDecisionSourceInput {
  id: string;
  documentId: string;
  sourceRevisionId: string;
  contentFingerprint: string;
  occurredAt: string;
  retrievedAt: string;
  summary: string;
  decisionReason: string;
  concerns: readonly string[];
  revisitConditions: readonly string[];
}

export function renderSampleDecisionStatement(
  input: Pick<
    SampleDecisionSourceInput,
    "summary" | "decisionReason" | "concerns" | "revisitConditions"
  >,
): string {
  const sentence = (values: readonly string[]): string => {
    const text = values.join(" ") || "None recorded.";
    return /[.!?]$/u.test(text) ? text : `${text}.`;
  };
  return [
    "Sample decision record.",
    input.summary,
    `Decision reason: ${input.decisionReason}`,
    `Concerns: ${sentence(input.concerns)}`,
    `Revisit conditions: ${sentence(input.revisitConditions)}`,
  ].join(" ");
}

export function buildSampleDecisionSourceRef(
  input: SampleDecisionSourceInput,
): WritableSourceRefV2 {
  return WritableSourceRefV2Schema.parse({
    schemaVersion: "source-ref-v2",
    adaptation: "canonical",
    id: input.id,
    provenance: "demo_fixture",
    title: "Sample decision record",
    canonicalUrl: null,
    documentId: input.documentId,
    publisher: "Internal Deal Registry",
    providerId: "deal-registry",
    eventAt: input.occurredAt,
    eventAtPrecision: "timestamp",
    publishedAt: null,
    publishedAtPrecision: null,
    retrievedAt: input.retrievedAt,
    retrievedAtPrecision: "timestamp",
    updatedAt: null,
    updatedAtPrecision: null,
    entityKeys: [],
    sourceClass: "internal_decision_record",
    sourceAuthority: "primary",
    evidenceRole: "context",
    sourceRevisionId: input.sourceRevisionId,
    locator: { kind: "json_pointer", pointer: "/priorDecision" },
    contentFingerprint: input.contentFingerprint,
    text: {
      status: "normalized_only",
      normalizedStatement: renderSampleDecisionStatement(input),
    },
  });
}
