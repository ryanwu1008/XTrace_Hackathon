import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("browser-reachable Named Lens contracts do not import server-only taxonomy hashing", async () => {
  const browserReachableSources = await Promise.all([
    "lib/contracts/named-lens.ts",
    "lib/contracts/underwriting.ts",
    "lib/underwriting/frameworks/research-schemas.ts",
  ].map(async (relativePath) => ({
    relativePath,
    source: await readFile(path.join(process.cwd(), relativePath), "utf8"),
  })));

  for (const { relativePath, source } of browserReachableSources) {
    assert.doesNotMatch(
      source,
      /(?:from|import\()\s*["'][^"']*\/decision-taxonomy["']\)?/,
      `${relativePath} must import the client-safe taxonomy contract instead`,
    );
  }

  const clientContract = await readFile(
    path.join(
      process.cwd(),
      "lib/underwriting/frameworks/decision-taxonomy-contract.ts",
    ),
    "utf8",
  );
  assert.doesNotMatch(clientContract, /["']node:/);
  assert.doesNotMatch(clientContract, /\bcreateHash\b/);
});
