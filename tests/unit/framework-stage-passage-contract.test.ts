import assert from "node:assert/strict";
import test from "node:test";

import {
  CURRENT_FRAMEWORK_LENS_PASSAGE_CONTRACT,
  createFrameworkLensStageInputFingerprint,
} from "../../lib/underwriting/frameworks/passage-contract";
import { createCanonicalFingerprint } from
  "../../lib/underwriting/fingerprints";

const stageInput = {
  candidate: { id: "candidate_1" },
  pack: { id: "pack_1", version: 1 },
  context: { id: "context_1", version: "1" },
  calculations: [{ id: "calculation_1" }],
  execution: { applicationCommit: "contract-test" },
  frameworkCatalog: {
    version: "research-framework-catalog-v1",
    fingerprint: `sha256:${"1".repeat(64)}`,
    corpusDigest: `sha256:${"2".repeat(64)}`,
  },
};

test("framework stage input fingerprint binds every passage contract field", () => {
  const current = createFrameworkLensStageInputFingerprint({
    ...stageInput,
    passageContract: CURRENT_FRAMEWORK_LENS_PASSAGE_CONTRACT,
  });
  assert.equal(current, createCanonicalFingerprint({
    stage: "framework_lenses",
    ...stageInput,
    passageContract: CURRENT_FRAMEWORK_LENS_PASSAGE_CONTRACT,
  }));

  for (const [field, staleValue] of [
    ["passageSchemaVersion", "named-lens-passage-stale"],
    ["generatorVersion", "named-lens-generator-stale"],
    ["decisionTaxonomyVersion", "named-lens-taxonomy-stale"],
    ["decisionTaxonomyDigest", `sha256:${"0".repeat(64)}`],
  ] as const) {
    const staleContract = {
      ...CURRENT_FRAMEWORK_LENS_PASSAGE_CONTRACT,
      [field]: staleValue,
    };
    assert.notEqual(
      createCanonicalFingerprint({
        stage: "framework_lenses",
        ...stageInput,
        passageContract: staleContract,
      }),
      current,
      field,
    );
    assert.throws(
      () => createFrameworkLensStageInputFingerprint({
        ...stageInput,
        passageContract: staleContract,
      } as Parameters<
        typeof createFrameworkLensStageInputFingerprint
      >[0]),
      /passage.*contract|invalid|version|digest/i,
      field,
    );
  }

  assert.throws(
    () => createFrameworkLensStageInputFingerprint(
      stageInput as Parameters<
        typeof createFrameworkLensStageInputFingerprint
      >[0],
    ),
    /passage.*contract|required|invalid/i,
  );
});
