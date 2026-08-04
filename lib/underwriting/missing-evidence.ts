import type { DealSemanticField } from "../contracts/domain";
import {
  MissingEvidenceItemSchema,
  type MissingEvidenceItem,
} from "../contracts/underwriting";
import { compareUtf8 } from "../format/canonical-order";

const CRITICAL_EVIDENCE_IMPACT =
  "Providing accepted evidence may raise or lower the formal decision ceiling.";
const COMPANY_OR_EVENT_UNKNOWN_IMPACT =
  "Resolving this company- or event-specific unknown may raise or lower the formal decision ceiling.";

export function buildCandidateMissingEvidence(input: {
  criticalFieldIds: readonly string[];
  structuredFields?: readonly DealSemanticField[];
}): MissingEvidenceItem[] {
  const candidates = [
    ...input.criticalFieldIds.map((fieldId) =>
      MissingEvidenceItemSchema.parse({
        fieldId,
        label: fieldId.replaceAll("_", " "),
        externalLabel: fieldId.replaceAll("_", " "),
        reasonCode: "MISSING_CRITICAL_EVIDENCE",
        mostLikelyDecisionImpact: CRITICAL_EVIDENCE_IMPACT,
      })
    ),
    ...(input.structuredFields ?? [])
      .filter((field) => field.classification === "unknown")
      .map((field) => MissingEvidenceItemSchema.parse({
        fieldId: field.id,
        label: field.reason,
        externalLabel: field.externalLabel,
        reasonCode: "UNRESOLVED_COMPANY_OR_EVENT_UNKNOWN",
        mostLikelyDecisionImpact: COMPANY_OR_EVENT_UNKNOWN_IMPACT,
      })),
  ];
  const byFieldId = new Map<string, MissingEvidenceItem>();
  for (const candidate of candidates) {
    const existing = byFieldId.get(candidate.fieldId);
    if (existing === undefined) {
      byFieldId.set(candidate.fieldId, candidate);
      continue;
    }
    if (!missingEvidenceItemsEqual(existing, candidate)) {
      throw new TypeError(
        `Persisted field ID has a conflicting missing-evidence payload: ${candidate.fieldId}`,
      );
    }
  }
  return [...byFieldId.values()].sort((left, right) =>
    compareUtf8(left.fieldId, right.fieldId)
  );
}

function missingEvidenceItemsEqual(
  left: MissingEvidenceItem,
  right: MissingEvidenceItem,
): boolean {
  return left.fieldId === right.fieldId
    && left.label === right.label
    && left.externalLabel === right.externalLabel
    && left.reasonCode === right.reasonCode
    && left.mostLikelyDecisionImpact === right.mostLikelyDecisionImpact;
}
