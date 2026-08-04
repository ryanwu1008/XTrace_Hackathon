import {
  SourceRefV2Schema,
  sourceCanGroundOutputFact,
  sourceTextForRetrieval,
  type SourceRefV2,
} from "../contracts/source-evidence";

export const SAMPLE_RESEARCH_SCREENING_RECORD_LABEL =
  "Sample research screening record" as const;

export const SAMPLE_RESEARCH_SCREENING_BADGE =
  `${SAMPLE_RESEARCH_SCREENING_RECORD_LABEL} · synthetic, no meeting or VC interaction` as const;

const SYNTHETIC_RESEARCH_PREFIX =
  `${SAMPLE_RESEARCH_SCREENING_RECORD_LABEL}. Synthetic research-only context; no meeting or VC interaction occurred.` as const;

/**
 * Fail closed unless this is the exact persisted research authority contract.
 * It intentionally does not infer the label from a Deal status, company name,
 * or a similarly titled source.
 */
export function isSampleResearchScreeningAuthority(
  value: unknown,
): value is SourceRefV2 {
  const parsed = SourceRefV2Schema.safeParse(value);
  if (!parsed.success) return false;
  const source = parsed.data;
  return source.adaptation === "canonical"
    && source.provenance === "source_document"
    && source.title === SAMPLE_RESEARCH_SCREENING_RECORD_LABEL
    && source.canonicalUrl === null
    && source.documentId !== null
    && source.publisher === "Internal Research Registry"
    && source.providerId !== null
    && source.eventAt !== null
    && source.eventAtPrecision === "timestamp"
    && source.publishedAt === null
    && source.sourceClass === "internal_decision_record"
    && source.sourceAuthority === "primary"
    && source.evidenceRole === "context"
    && source.sourceRevisionId !== null
    && source.locator?.kind === "json_pointer"
    && source.contentFingerprint !== null
    && source.entityKeys.length > 0
    && source.text.status === "normalized_only"
    && source.text.normalizedStatement.startsWith(SYNTHETIC_RESEARCH_PREFIX)
    && sourceCanGroundOutputFact(source)
    && sourceTextForRetrieval(source).includes("Reconsideration conditions: ");
}

export function hasSampleResearchScreeningAuthority(
  sources: readonly unknown[],
): boolean {
  return sources.some(isSampleResearchScreeningAuthority);
}
