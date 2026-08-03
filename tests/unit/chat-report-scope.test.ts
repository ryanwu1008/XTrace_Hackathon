import assert from "node:assert/strict";
import test from "node:test";

import { searchRuntimeIntelligence } from "../../app/api/chat/route";

test("Chat report scope never reads the global market catalog", async () => {
  const evidence = await searchRuntimeIntelligence(
    "Global-only marker",
    null,
    "public_sandbox",
  );

  assert.deepEqual(evidence, []);
});
