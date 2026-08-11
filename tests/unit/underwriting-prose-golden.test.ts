import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

type SourceBinding = {
  label: string;
  url: string;
};

type LensPassage = {
  lens: string;
  frameworkBasis: string;
  premise: string;
  caseApplication: string;
  countercase: string;
  evidenceRequest: string;
  conditionalPosture: string;
  sourceBindings: SourceBinding[];
};

type GoldenSection = {
  number: string;
  title: string;
  paragraphs: string[];
  disclosure?: string;
  passages?: LensPassage[];
  synthesis?: string;
};

type EvidenceLedger = {
  facts: Array<{
    statement: string;
    sourceBindings: SourceBinding[];
  }>;
  assumptions: Array<{
    statement: string;
    rationale: string;
  }>;
  unknowns: string[];
  numericalClaims: Array<{
    statement: string;
    classification: "fact" | "assumption";
    sourceBindings: SourceBinding[];
  }>;
};

type GoldenMemo = {
  schemaVersion: string;
  artifactKind: string;
  artifactLabel: string;
  companyName: string;
  title: string;
  productionProviderQualityEvidence: boolean;
  sections: GoldenSection[];
  appendix: {
    title: string;
    paragraphs: string[];
    publicSources: SourceBinding[];
    evidenceLedger: EvidenceLedger;
  };
};

const jsonPath = fileURLToPath(new URL(
  "../fixtures/underwriting/irregular-named-lens-golden-v1.json",
  import.meta.url,
));
const textPath = fileURLToPath(new URL(
  "../fixtures/underwriting/irregular-named-lens-golden-v1.txt",
  import.meta.url,
));

const expectedSections = [
  "Decision Request",
  "What Changed",
  "Company Position",
  "Thesis Assessment",
  "Financial and Valuation Status",
  "Named Lens Readings",
  "Recommendation and Next Steps",
];

function loadGolden(): { memo: GoldenMemo; text: string } {
  assert.equal(
    existsSync(jsonPath),
    true,
    "the structured Irregular editorial golden fixture must exist",
  );
  assert.equal(
    existsSync(textPath),
    true,
    "the readable Irregular editorial golden fixture must exist",
  );

  return {
    memo: JSON.parse(readFileSync(jsonPath, "utf8")) as GoldenMemo,
    text: readFileSync(textPath, "utf8"),
  };
}

function wordCount(value: string): number {
  return value.match(/[A-Za-z0-9]+(?:[’'-][A-Za-z0-9]+)*/g)?.length ?? 0;
}

function passageText(passage: LensPassage): string {
  return [
    passage.premise,
    passage.caseApplication,
    passage.countercase,
    passage.evidenceRequest,
    passage.conditionalPosture,
  ].join(" ");
}

test("the Irregular prose golden is permanently and explicitly synthetic", () => {
  const { memo, text } = loadGolden();

  assert.equal(memo.schemaVersion, "underwriting-editorial-golden-v1");
  assert.equal(memo.artifactKind, "synthetic_sample_editorial_fixture");
  assert.equal(memo.productionProviderQualityEvidence, false);
  assert.match(memo.artifactLabel, /SYNTHETIC SAMPLE/i);
  assert.match(text.slice(0, 500), /SYNTHETIC SAMPLE/i);
  assert.match(text.slice(0, 500), /not a real VC interaction/i);
  assert.match(text, /Sample decision record/i);
  assert.match(text, /not evidence of production provider quality/i);
});

test("the memo is decision-first with seven numbered sections and an Appendix", () => {
  const { memo, text } = loadGolden();

  assert.deepEqual(
    memo.sections.map(({ title }) => title),
    expectedSections,
  );
  assert.deepEqual(
    memo.sections.map(({ number }) => number),
    ["01", "02", "03", "04", "05", "06", "07"],
  );
  assert.equal(memo.appendix.title, "Appendix");

  const orderedHeadings = [
    ...memo.sections.map(({ number, title }) => `${number} ${title}`),
    memo.appendix.title,
  ];
  let priorIndex = -1;
  for (const heading of orderedHeadings) {
    const index = text.indexOf(heading);
    assert.ok(index > priorIndex, `${heading} must appear in decision-first order`);
    priorIndex = index;
  }
});

test("Named Lens readings are complete prose within the editorial word budget", () => {
  const { memo, text } = loadGolden();
  const section = memo.sections.find(({ title }) => title === "Named Lens Readings");
  assert.ok(section);
  assert.ok(section.disclosure);
  assert.ok(section.synthesis);
  assert.ok(section.passages);
  assert.ok(
    section.passages.length >= 4 && section.passages.length <= 6,
    "the main memo must carry four to six decision-relevant lenses",
  );

  let passageWords = 0;
  for (const passage of section.passages) {
    const rendered = passageText(passage);
    const words = wordCount(rendered);
    assert.ok(
      words >= 180 && words <= 260,
      `${passage.lens} must be 180–260 words; received ${words}`,
    );
    passageWords += words;

    for (const segment of [
      passage.premise,
      passage.caseApplication,
      passage.countercase,
      passage.evidenceRequest,
      passage.conditionalPosture,
    ]) {
      assert.ok(wordCount(segment) >= 18, `${passage.lens} has a thin logic segment`);
      assert.ok(text.includes(segment), `${passage.lens} prose must appear in the readable memo`);
    }
    assert.match(
      passage.caseApplication,
      /\b(?:because|therefore|which|so that|means that)\b/i,
      `${passage.lens} must state a causal connection to this case`,
    );
    assert.match(passage.countercase, /\b(?:however|countercase|could|would|if)\b/i);
    assert.match(passage.evidenceRequest, /\b(?:request|need|before|evidence|diligence)\b/i);
    assert.match(passage.conditionalPosture, /\b(?:if|until|unless|only if|subject to)\b/i);
  }

  const combinedWords = passageWords + wordCount(section.synthesis);
  assert.ok(
    combinedWords <= 1_600,
    `Named Lens passages plus synthesis must stay within 1,600 words; received ${combinedWords}`,
  );
});

test("public frameworks and company facts have descriptive source bindings", () => {
  const { memo, text } = loadGolden();
  const section = memo.sections.find(({ title }) => title === "Named Lens Readings");
  assert.ok(section?.passages);

  const bindings = [
    ...section.passages.flatMap(({ sourceBindings }) => sourceBindings),
    ...memo.appendix.publicSources,
  ];
  assert.ok(bindings.length >= section.passages.length + 4);
  for (const binding of bindings) {
    assert.ok(wordCount(binding.label) >= 3, "source labels must be descriptive");
    assert.match(binding.url, /^https:\/\//);
    assert.ok(text.includes(binding.label));
    assert.ok(text.includes(binding.url));
  }

  assert.ok(memo.appendix.evidenceLedger.facts.length >= 7);
  for (const fact of memo.appendix.evidenceLedger.facts) {
    assert.ok(fact.sourceBindings.length > 0, `fact lacks a source: ${fact.statement}`);
  }
  for (const assumption of memo.appendix.evidenceLedger.assumptions) {
    assert.match(assumption.statement, /^Assumption:/);
    assert.ok(assumption.rationale.length >= 20);
  }
  assert.ok(memo.appendix.evidenceLedger.unknowns.length >= 4);
});

test("every declared financial number is classified as a sourced fact or an explicit assumption", () => {
  const { memo, text } = loadGolden();
  const claims = memo.appendix.evidenceLedger.numericalClaims;
  assert.ok(claims.length >= 6);

  for (const claim of claims) {
    assert.ok(text.includes(claim.statement));
    if (claim.classification === "fact") {
      assert.ok(claim.sourceBindings.length > 0, `public fact lacks a source: ${claim.statement}`);
    } else {
      assert.match(claim.statement, /^Assumption:/);
      assert.equal(claim.sourceBindings.length, 0);
    }
  }
});

test("the readable memo uses professional prose and hides implementation language", () => {
  const { memo, text } = loadGolden();
  const visible = [
    memo.title,
    ...memo.sections.flatMap((section) => [
      ...section.paragraphs,
      section.disclosure ?? "",
      section.synthesis ?? "",
      ...(section.passages?.map(passageText) ?? []),
    ]),
    ...memo.appendix.paragraphs,
  ].join("\n");

  assert.match(visible, /investment committee/i);
  assert.match(visible, /valuation/i);
  assert.match(visible, /diligence/i);
  assert.match(visible, /counterevidence/i);
  assert.doesNotMatch(
    visible,
    /\b(?:belief_revised|no_material_change|analysis_unavailable|internal_only|pause_follow_on|portfolio_risk_review)\b/i,
  );
  assert.doesNotMatch(
    visible,
    /\b(?:source_revision|framework_advisory|evidence_pack|fixture|deal)_[a-z0-9_:-]+\b/i,
  );
  assert.doesNotMatch(
    visible,
    /\b(?:as an AI|delve|it is important to note|in conclusion|chain of thought|private reasoning|internal reasoning process)\b/i,
  );
  assert.equal((visible.match(/\bUnavailable\b/g) ?? []).length, 0);
  assert.doesNotMatch(text, /(?:^|\n)(?:Premise|Case application|Countercase|Evidence request|Conditional posture):/);
});
