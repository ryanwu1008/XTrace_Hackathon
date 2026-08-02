import {
  canonicalEvidenceJson,
  canonicalIntrinsicEvidenceUnitKey,
  canonicalSourceEvidenceObservationKey,
  type MarketEventV2,
  type SourceRefV2,
} from "../contracts/source-evidence";
import { compareUtf8 } from "../format/canonical-order";

/**
 * Identify one underlying document revision independently of the feed through
 * which it was acquired. Acquisition provider and retrieval observation are
 * deliberately excluded; content and revision chronology are deliberately
 * included so a changed document is never counted as corroboration.
 */
/** Acquisition-independent identity for one immutable source locator. */
export function canonicalEvidenceReferenceKey(
  source: SourceRefV2,
): string | null {
  return canonicalIntrinsicEvidenceUnitKey(source);
}

export function canonicalDocumentObservationKey(
  source: SourceRefV2,
): string | null {
  return canonicalSourceEvidenceObservationKey(source);
}

export function triggerDocumentObservationKey(
  event: MarketEventV2,
): string | null {
  if (event.adaptation !== "canonical") return null;
  const trigger = event.sources.find(
    (source) => source.id === event.triggerSourceId,
  );
  return trigger ? canonicalDocumentObservationKey(trigger) : null;
}

/** Stable repository key for the same observed event across acquisition feeds. */
export function canonicalMarketObservationKey(
  event: MarketEventV2,
): string {
  if (event.adaptation !== "canonical") {
    return canonicalEvidenceJson(event);
  }
  const {
    id: _id,
    contentFingerprint: _contentFingerprint,
    providerId: _providerId,
    triggerSourceId: _triggerSourceId,
    retrievedAt: _retrievedAt,
    retrievedAtPrecision: _retrievedAtPrecision,
    sources,
    ...stableEvent
  } = event;
  void _id;
  void _contentFingerprint;
  void _providerId;
  void _triggerSourceId;
  void _retrievedAt;
  void _retrievedAtPrecision;

  const documentObservations = [...new Set(
    sources.flatMap((source) => {
      const key = canonicalDocumentObservationKey(source);
      return key === null ? [] : [key];
    }),
  )].sort(compareUtf8);

  return canonicalEvidenceJson({
    ...stableEvent,
    triggerDocumentObservation: triggerDocumentObservationKey(event),
    documentObservations,
  });
}
