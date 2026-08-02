import { createHash } from "node:crypto";

import {
  canonicalEvidenceJson,
  WritableSourceRefV2Schema,
  WritableMarketEventV2Schema,
  type WritableSourceRefV2,
  type WritableMarketEventV2,
} from "../contracts/source-evidence";

/** Recompute the immutable identity after any canonical event field changes. */
export function reidentifyMarketEvent(
  event: Omit<WritableMarketEventV2, "id" | "contentFingerprint">
    & Partial<Pick<WritableMarketEventV2, "id" | "contentFingerprint">>,
): WritableMarketEventV2 {
  const payload = canonicalMarketEventPayload({
    ...event,
    id: "market_pending_identity",
    contentFingerprint: `sha256:${"0".repeat(64)}`,
  });
  const digest = marketEventPayloadDigest(payload);
  return WritableMarketEventV2Schema.parse({
    ...payload,
    id: `market_${digest.slice(0, 24)}`,
    contentFingerprint: `sha256:${digest}`,
  });
}

function marketEventPayloadDigest(
  event: Omit<WritableMarketEventV2, "id" | "contentFingerprint">,
): string {
  return createHash("sha256")
    .update(canonicalEvidenceJson(event), "utf8")
    .digest("hex");
}

function canonicalMarketEventPayload(
  event: WritableMarketEventV2,
): Omit<WritableMarketEventV2, "id" | "contentFingerprint"> {
  const parsed = WritableMarketEventV2Schema.parse(event);
  const payload = { ...parsed };
  delete (payload as Partial<WritableMarketEventV2>).id;
  delete (payload as Partial<WritableMarketEventV2>).contentFingerprint;
  return payload;
}

/** Bind a canonical payload to a fingerprint while preserving an explicit ID. */
export function refingerprintMarketEvent(
  event: WritableMarketEventV2,
): WritableMarketEventV2 {
  const parsed = WritableMarketEventV2Schema.parse({
    ...event,
    contentFingerprint: `sha256:${"0".repeat(64)}`,
  });
  const digest = marketEventPayloadDigest(canonicalMarketEventPayload(parsed));
  return WritableMarketEventV2Schema.parse({
    ...parsed,
    contentFingerprint: `sha256:${digest}`,
  });
}

/** Stable seed IDs are allowed, but every writable fingerprint must be exact. */
export function assertMarketEventFingerprint(
  event: WritableMarketEventV2,
): WritableMarketEventV2 {
  const parsed = WritableMarketEventV2Schema.parse(event);
  const expected = `sha256:${marketEventPayloadDigest(
    canonicalMarketEventPayload(parsed),
  )}`;
  if (parsed.contentFingerprint !== expected) {
    throw new Error(
      `Market event ${parsed.id} has a content fingerprint that does not match its canonical payload.`,
    );
  }
  return parsed;
}

/** Derive a new source ID after changing canonical lineage metadata. */
export function reidentifySourceRef(
  source: WritableSourceRefV2,
): WritableSourceRefV2 {
  const parsed = WritableSourceRefV2Schema.parse({
    ...source,
    id: "source_pending_identity",
  });
  const payload = { ...parsed };
  delete (payload as Partial<WritableSourceRefV2>).id;
  const digest = createHash("sha256")
    .update(canonicalEvidenceJson(payload), "utf8")
    .digest("hex");
  return WritableSourceRefV2Schema.parse({
    ...parsed,
    id: `source_${digest.slice(0, 24)}`,
  });
}
