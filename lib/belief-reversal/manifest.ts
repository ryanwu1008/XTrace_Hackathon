import manifest from "../../seed/belief-reversal/2026-08-01/manifest.json";

import {
  parseBeliefReversalManifest,
  type BeliefReversalResearchPackage,
} from "./contracts";

const researchPackage = parseBeliefReversalManifest(manifest);

export function loadBeliefReversalManifest(): BeliefReversalResearchPackage {
  return researchPackage;
}
