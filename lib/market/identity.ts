import { createHash } from "node:crypto";

import {
  canonicalEvidenceJson,
  WritableMarketEventV2Schema,
  type WritableMarketEventV2,
} from "../contracts/source-evidence";

/** Recompute the immutable identity after any canonical event field changes. */
export function reidentifyMarketEvent(
  event: Omit<WritableMarketEventV2, "id" | "contentFingerprint">
    & Partial<Pick<WritableMarketEventV2, "id" | "contentFingerprint">>,
): WritableMarketEventV2 {
  const payload = { ...event };
  delete payload.id;
  delete payload.contentFingerprint;
  const digest = createHash("sha256")
    .update(canonicalEvidenceJson(payload), "utf8")
    .digest("hex");
  return WritableMarketEventV2Schema.parse({
    ...payload,
    id: `market_${digest.slice(0, 24)}`,
    contentFingerprint: `sha256:${digest}`,
  });
}
