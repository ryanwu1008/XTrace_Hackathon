import { z } from "zod";

import {
  NAMED_LENS_GENERATOR_VERSION,
  NAMED_LENS_PASSAGE_SCHEMA_VERSION,
} from "../../contracts/named-lens";
import { createCanonicalFingerprint } from "../fingerprints";
import {
  DECISION_TAXONOMY_DIGEST,
  DECISION_TAXONOMY_VERSION,
} from "./decision-taxonomy";
import {
  NamedLensProviderTimeoutPolicySchema,
  type NamedLensProviderTimeoutPolicy,
} from "./timeout-policy";

export const FrameworkLensPassageContractSchema = z.strictObject({
  passageSchemaVersion: z.literal(NAMED_LENS_PASSAGE_SCHEMA_VERSION),
  generatorVersion: z.literal(NAMED_LENS_GENERATOR_VERSION),
  decisionTaxonomyVersion: z.literal(DECISION_TAXONOMY_VERSION),
  decisionTaxonomyDigest: z.literal(DECISION_TAXONOMY_DIGEST),
});

export type FrameworkLensPassageContract = z.infer<
  typeof FrameworkLensPassageContractSchema
>;

export const CURRENT_FRAMEWORK_LENS_PASSAGE_CONTRACT = Object.freeze({
  passageSchemaVersion: NAMED_LENS_PASSAGE_SCHEMA_VERSION,
  generatorVersion: NAMED_LENS_GENERATOR_VERSION,
  decisionTaxonomyVersion: DECISION_TAXONOMY_VERSION,
  decisionTaxonomyDigest: DECISION_TAXONOMY_DIGEST,
}) satisfies FrameworkLensPassageContract;

export function createFrameworkLensStageInputFingerprint(input: {
  candidate: unknown;
  pack: unknown;
  context: unknown;
  calculations: unknown;
  execution: unknown;
  frameworkCatalog: unknown;
  passageContract: FrameworkLensPassageContract;
  advisoryProviderTimeoutPolicy: NamedLensProviderTimeoutPolicy;
}): string {
  const passageContract = FrameworkLensPassageContractSchema.parse(
    input.passageContract,
  );
  const advisoryProviderTimeoutPolicy =
    NamedLensProviderTimeoutPolicySchema.parse(
      input.advisoryProviderTimeoutPolicy,
    );
  return createCanonicalFingerprint({
    stage: "framework_lenses",
    candidate: input.candidate,
    pack: input.pack,
    context: input.context,
    calculations: input.calculations,
    execution: input.execution,
    frameworkCatalog: input.frameworkCatalog,
    passageContract,
    advisoryProviderTimeoutPolicy,
  });
}
