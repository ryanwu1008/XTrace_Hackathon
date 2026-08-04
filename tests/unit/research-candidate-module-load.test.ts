import assert from "node:assert/strict";
import test from "node:test";

test("research candidate contract initializes without loading the domain adapter graph", async () => {
  const contracts = await import("../../lib/contracts/research-candidate");

  assert.equal(
    contracts.SAMPLE_RESEARCH_SCREENING_RECORD_LABEL,
    "Sample research screening record",
  );
});
