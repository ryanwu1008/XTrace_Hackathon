import { parseSourceRefV2Read } from "./legacy-evidence-adapter";
import {
  assertConsistentCanonicalEvidenceUnits,
  uniqueByCanonicalId,
  type SourceRefV2,
} from "./source-evidence";

/** Validate a complete source catalog before filtering or truncating it. */
export function validateEvidenceSourceCatalog(
  sources: readonly unknown[],
  label: string,
): SourceRefV2[] {
  const parsed = uniqueByCanonicalId(
    sources.map(parseSourceRefV2Read),
    label,
  );
  assertConsistentCanonicalEvidenceUnits(parsed);
  return parsed;
}
