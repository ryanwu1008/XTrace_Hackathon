import assert from "node:assert/strict";
import test from "node:test";

import { evidenceSourceText } from "../../lib/contracts/domain";
import { searchDemoEvidence } from "../../lib/demo/search";

test("search returns only evidence already present in the fixed corpus", () => {
  const results = searchDemoEvidence("Why did we mark 7bridges as passed?");

  assert.ok(results.length > 0);
  assert.ok(results.some((item) => item.text.includes("7bridges")));
  assert.ok(results.flatMap((item) => item.sources).every((source) =>
    source.provenance === "source_document" || source.provenance === "demo_fixture"
  ));
});

test("search does not invent an answer for an unknown company", () => {
  assert.deepEqual(searchDemoEvidence("What happened with Asteria Bio?"), []);
});

test("search includes page-cited evidence from the supplied market reports", () => {
  const results = searchDemoEvidence("What does the robotics report say about paying customers?");
  assert.ok(results.some((result) =>
    result.sources.some((source) => source.id === "evidence_robotics_vc_trends_page_4")
  ));
});

test("search ranks an exact combined-PDF company and preserves its page citation", () => {
  const results = searchDemoEvidence("What does Mirror do?");
  assert.ok(results.length > 0);
  assert.equal(results[0].sources[0].id, "evidence_mirror_page_3");
  const source = results[0].sources[0];
  assert.equal(
    "schemaVersion" in source && source.locator?.kind === "document_page"
      ? source.locator.page
      : "page" in source
      ? source.page
      : undefined,
    3,
  );
  assert.equal(
    results.some((result) =>
      result.sources.some((source) => source.id === "evidence_7bridges_page_4")
    ),
    false,
  );
});

test("search does not answer a broad thematic query from partial token overlap", () => {
  assert.deepEqual(
    searchDemoEvidence("Which companies relate to AI orbital infrastructure?"),
    [],
  );
});

test("search finds and cites a synthetic decision reason", () => {
  const results = searchDemoEvidence("broad travel-collaboration proposition");

  assert.ok(results.length > 0);
  assert.match(results[0].text, /Fellowtrip/);
  const fixture = results
    .flatMap((result) => result.sources)
    .find((source) => source.id === "fixture_fellowtrip_passed");
  assert.ok(fixture);
  assert.match(
    evidenceSourceText(fixture),
    /Decision reason: The team passed because the broad travel-collaboration proposition/i,
  );
});
