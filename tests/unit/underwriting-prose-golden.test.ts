import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

type SourceBinding = {
  label: string;
  url: string;
};

type ClaimClassification =
  | "fact"
  | "assumption"
  | "calculation"
  | "unknown";

type TypedClaim = {
  statement: string;
  classification: ClaimClassification;
  sourceBindings: SourceBinding[];
  rationale?: string;
  derivedFrom?: string[];
};

type AdjacentClaimGroup = {
  paragraphIndex: number;
  paragraphRef: string;
  claims: TypedClaim[];
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
  adjacentClaims?: AdjacentClaimGroup[];
  disclosure?: string;
  passages?: LensPassage[];
  synthesis?: string;
};

type NumericExemption = {
  token: string;
  reason: string;
};

type GoldenMemo = {
  schemaVersion: string;
  artifactKind: string;
  artifactLabel: string;
  editorialNotice: string;
  generationPath: string;
  companyName: string;
  title: string;
  productionProviderQualityEvidence: boolean;
  sections: GoldenSection[];
  appendix: {
    title: string;
    paragraphs: string[];
    publicSources: SourceBinding[];
    typedClaims: TypedClaim[];
    numericExemptions: NumericExemption[];
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

function loadGolden(): { memo: GoldenMemo; rawJson: string; text: string } {
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

  const rawJson = readFileSync(jsonPath, "utf8");
  return {
    memo: JSON.parse(rawJson) as GoldenMemo,
    rawJson,
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

function claimLines(claim: TypedClaim): string[] {
  const lines = [
    `${claim.classification.toUpperCase()} — ${claim.statement}`,
  ];
  for (const binding of claim.sourceBindings) {
    lines.push(`Source — ${binding.label}`, binding.url);
  }
  if (claim.rationale) {
    lines.push(`Basis — ${claim.rationale}`);
  }
  if (claim.derivedFrom?.length) {
    lines.push(`Derived from — ${claim.derivedFrom.join("; ")}`);
  }
  return lines;
}

function pushParagraph(lines: string[], value: string): void {
  lines.push(value, "");
}

type NumericOccurrence = {
  token: string;
  index: number;
  context: string;
};

function visibleNumericOccurrences(text: string): NumericOccurrence[] {
  const urlRanges: Array<{ start: number; end: number }> = [];
  for (const match of text.matchAll(/https:\/\/\S+/g)) {
    const start = match.index;
    urlRanges.push({ start, end: start + match[0].length });
  }

  const occurrences: NumericOccurrence[] = [];
  for (const match of text.matchAll(
    /(?<![A-Za-z0-9])\$?\d+(?:\.\d+)?(?:%|x)?(?![A-Za-z0-9])/g,
  )) {
    const index = match.index;
    if (urlRanges.some(({ start, end }) => index >= start && index < end)) {
      continue;
    }
    const contextStart = text.lastIndexOf("\n\n", index - 1) + 2;
    const contextEndCandidate = text.indexOf("\n\n", index);
    const contextEnd = contextEndCandidate === -1 ? text.length : contextEndCandidate;
    occurrences.push({
      token: match[0],
      index,
      context: text.slice(contextStart, contextEnd),
    });
  }
  return occurrences;
}

export function renderCanonicalMemo(memo: GoldenMemo): string {
  const lines = [memo.artifactLabel, "", memo.title, ""];
  lines.push(`Company — ${memo.companyName}`, "");
  pushParagraph(lines, memo.editorialNotice);

  for (const section of memo.sections) {
    lines.push(`${section.number} ${section.title}`, "");

    if (section.title === "Named Lens Readings") {
      assert.ok(section.disclosure);
      assert.ok(section.passages);
      assert.notEqual(section.synthesis, undefined);
      pushParagraph(lines, section.disclosure);
      for (const passage of section.passages) {
        lines.push(passage.lens, "");
        lines.push(`Framework basis — ${passage.frameworkBasis}`, "");
        for (const segment of [
          passage.premise,
          passage.caseApplication,
          passage.countercase,
          passage.evidenceRequest,
          passage.conditionalPosture,
        ]) {
          pushParagraph(lines, segment);
        }
        for (const binding of passage.sourceBindings) {
          lines.push(`Framework source — ${binding.label}`, binding.url, "");
        }
      }
      lines.push("Synthesis", "");
      pushParagraph(lines, section.synthesis ?? "");
      continue;
    }

    const groups = section.adjacentClaims ?? [];
    for (const [paragraphIndex, paragraph] of section.paragraphs.entries()) {
      pushParagraph(lines, paragraph);
      const group = groups.find((candidate) =>
        candidate.paragraphIndex === paragraphIndex
      );
      assert.ok(group, `${section.title} paragraph ${paragraphIndex} lacks adjacent claims`);
      assert.equal(
        group.paragraphRef,
        `${section.number}.${paragraphIndex + 1}`,
        `${section.title} paragraph ${paragraphIndex} has a stale claim binding`,
      );
      lines.push("Evidence standing", "");
      for (const claim of group.claims) {
        for (const line of claimLines(claim)) {
          lines.push(line);
        }
        lines.push("");
      }
    }
  }

  lines.push(memo.appendix.title, "");
  for (const paragraph of memo.appendix.paragraphs) {
    pushParagraph(lines, paragraph);
  }
  lines.push("Public source register", "");
  for (const binding of memo.appendix.publicSources) {
    lines.push(`Source — ${binding.label}`, binding.url, "");
  }
  lines.push("Typed evidence ledger", "");
  for (const claim of memo.appendix.typedClaims) {
    for (const line of claimLines(claim)) {
      lines.push(line);
    }
    lines.push("");
  }
  lines.push("Display-number exemptions", "");
  for (const exemption of memo.appendix.numericExemptions) {
    lines.push(`${exemption.token} — ${exemption.reason}`);
  }

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

function sectionClaims(section: GoldenSection): TypedClaim[] {
  return (section.adjacentClaims ?? []).flatMap(({ claims }) => claims);
}

function allTypedClaims(memo: GoldenMemo): TypedClaim[] {
  return [
    ...memo.sections.flatMap(sectionClaims),
    ...memo.appendix.typedClaims,
  ];
}

function assertTypedClaim(claim: TypedClaim): void {
  assert.ok(claim.statement.trim().length >= 12);
  if (claim.classification === "fact") {
    assert.ok(
      claim.sourceBindings.length > 0,
      `public fact lacks a source: ${claim.statement}`,
    );
  } else if (claim.classification === "assumption") {
    assert.match(claim.statement, /^Assumption:/);
    assert.equal(claim.sourceBindings.length, 0);
    assert.ok((claim.rationale?.length ?? 0) >= 20);
  } else if (claim.classification === "calculation") {
    assert.match(claim.statement, /^Calculation:/);
    assert.equal(claim.sourceBindings.length, 0);
    assert.ok((claim.derivedFrom?.length ?? 0) >= 2);
  } else {
    assert.match(claim.statement, /^Unknown:/);
    assert.equal(claim.sourceBindings.length, 0);
  }
}

test("the Irregular prose golden is permanently and adjacently synthetic", () => {
  const { memo, text } = loadGolden();

  assert.equal(memo.schemaVersion, "underwriting-editorial-golden-v1");
  assert.equal(memo.artifactKind, "synthetic_sample_editorial_fixture");
  assert.equal(memo.generationPath, "manual_editorial_fixture");
  assert.equal(memo.productionProviderQualityEvidence, false);
  assert.match(memo.artifactLabel, /SYNTHETIC SAMPLE/i);
  assert.match(text.slice(0, 600), /SYNTHETIC SAMPLE/i);
  assert.match(text.slice(0, 600), /not a real VC interaction/i);
  assert.match(text, /not evidence of production provider quality/i);

  const nonLensParagraphs = memo.sections
    .filter(({ title }) => title !== "Named Lens Readings")
    .flatMap(({ paragraphs }) => paragraphs);
  for (const paragraph of nonLensParagraphs.filter((value) =>
    /\bprior (?:thesis|record|investment)|Sample decision record/i.test(value)
  )) {
    assert.match(
      paragraph,
      /(?:synthetic|Sample decision record)/i,
      "every synthetic prior-history statement must carry its label locally",
    );
  }
  const sampleRecord = nonLensParagraphs.find((value) =>
    value.includes("Sample decision record")
  );
  assert.match(sampleRecord ?? "", /Sample decision record — permanently synthetic:/);
});

test("the TXT is the exact canonical rendering of every JSON field shown to readers", () => {
  const { memo, text } = loadGolden();
  assert.equal(text, renderCanonicalMemo(memo));

  const missingParagraph = structuredClone(memo);
  missingParagraph.sections[2].paragraphs.splice(0, 1);
  missingParagraph.sections[2].adjacentClaims?.splice(0, 1);
  for (const group of missingParagraph.sections[2].adjacentClaims ?? []) {
    group.paragraphIndex -= 1;
    group.paragraphRef = `03.${group.paragraphIndex + 1}`;
  }
  assert.notEqual(renderCanonicalMemo(missingParagraph), text);

  const replacedSection = structuredClone(memo);
  replacedSection.sections[3].paragraphs[0] = "Replacement prose.";
  assert.notEqual(renderCanonicalMemo(replacedSection), text);

  const changedCompany = structuredClone(memo);
  changedCompany.companyName = "Replacement Company";
  assert.notEqual(renderCanonicalMemo(changedCompany), text);

  const changedFrameworkBasis = structuredClone(memo);
  changedFrameworkBasis.sections[5].passages![0].frameworkBasis =
    "Replacement framework basis";
  assert.notEqual(renderCanonicalMemo(changedFrameworkBasis), text);

  const missingSynthesis = structuredClone(memo);
  missingSynthesis.sections[5].synthesis = "";
  assert.notEqual(renderCanonicalMemo(missingSynthesis), text);

  const missingAppendix = structuredClone(memo);
  missingAppendix.appendix.paragraphs = [];
  assert.notEqual(renderCanonicalMemo(missingAppendix), text);
});

test("the memo is decision-first with seven numbered sections and an Appendix", () => {
  const { memo, text } = loadGolden();

  assert.deepEqual(memo.sections.map(({ title }) => title), expectedSections);
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

test("decision-first reasons carry adjacent typed evidence instead of Appendix-only support", () => {
  const { memo, text } = loadGolden();
  const requiredSectionNumbers = new Set(["01", "02", "03", "04", "05", "07"]);

  for (const section of memo.sections.filter(({ number }) =>
    requiredSectionNumbers.has(number)
  )) {
    assert.equal(section.adjacentClaims?.length, section.paragraphs.length);
    for (const [paragraphIndex, paragraph] of section.paragraphs.entries()) {
      const group: AdjacentClaimGroup | undefined =
        section.adjacentClaims?.[paragraphIndex];
      assert.equal(group?.paragraphIndex, paragraphIndex);
      assert.equal(group?.paragraphRef, `${section.number}.${paragraphIndex + 1}`);
      assert.ok(group && group.claims.length > 0);
      for (const claim of group.claims) {
        assertTypedClaim(claim);
        if (claim.classification === "fact") {
          for (const binding of claim.sourceBindings) {
            assert.ok(wordCount(binding.label) >= 3);
            assert.match(binding.url, /^https:\/\//);
            assert.ok(
              memo.appendix.publicSources.some((registered) =>
                registered.label === binding.label && registered.url === binding.url
              ),
              `adjacent fact source is absent from Appendix registry: ${binding.label}`,
            );
          }
        }
      }

      const paragraphAt = text.indexOf(paragraph);
      const evidenceAt = text.indexOf("Evidence standing", paragraphAt);
      const nextParagraph = section.paragraphs[paragraphIndex + 1];
      const nextParagraphAt = nextParagraph
        ? text.indexOf(nextParagraph, paragraphAt + paragraph.length)
        : Number.POSITIVE_INFINITY;
      assert.ok(evidenceAt > paragraphAt && evidenceAt < nextParagraphAt);
    }
  }

  const firstScreenClaims = sectionClaims(memo.sections[0]);
  assert.ok(firstScreenClaims.some(({ classification }) => classification === "fact"));
  assert.ok(firstScreenClaims.some(({ classification }) => classification === "unknown"));
  assert.ok(firstScreenClaims.some(({ classification }) => classification === "assumption"));
});

test("Named Lens readings are complete, exactly bound prose within the word budget", () => {
  const { memo, text } = loadGolden();
  const section = memo.sections.find(({ title }) => title === "Named Lens Readings");
  assert.ok(section?.disclosure);
  assert.ok(section.synthesis);
  assert.ok(section.passages);
  assert.ok(section.passages.length >= 4 && section.passages.length <= 6);

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
      assert.ok(text.includes(segment));
    }
    assert.match(passage.caseApplication, /\b(?:because|therefore|which|so that|means that)\b/i);
    assert.match(passage.countercase, /\b(?:however|countercase|could|would|if)\b/i);
    assert.match(passage.evidenceRequest, /\b(?:request|need|before|evidence|diligence)\b/i);
    assert.match(passage.conditionalPosture, /\b(?:if|until|unless|only if|subject to)\b/i);

    assert.ok(passage.sourceBindings.length > 0);
    assert.equal(
      new Set(passage.sourceBindings.map(({ url }) => url)).size,
      passage.sourceBindings.length,
    );
    for (const binding of passage.sourceBindings) {
      assert.ok(wordCount(binding.label) >= 3);
      assert.match(binding.url, /^https:\/\//);
      const exactBlock = `Framework source — ${binding.label}\n${binding.url}`;
      const sourceAt = text.indexOf(exactBlock, text.indexOf(passage.conditionalPosture));
      assert.ok(sourceAt > text.indexOf(passage.conditionalPosture));
    }
  }

  assert.ok(passageWords + wordCount(section.synthesis) <= 1_600);
});

test("every visible number occurrence has typed local context", () => {
  const { memo, text } = loadGolden();
  const claims = allTypedClaims(memo);
  assert.ok(claims.length >= 20);
  claims.forEach(assertTypedClaim);

  const returnsClaim = claims.find(({ statement }) =>
    /0\.35x.*24\.1%/.test(statement)
  );
  assert.equal(returnsClaim?.classification, "calculation");
  assert.ok(returnsClaim?.derivedFrom && returnsClaim.derivedFrom.length >= 2);

  const exemptions = new Map(
    memo.appendix.numericExemptions.map(({ token, reason }) => [token, reason]),
  );
  const sectionsByParagraph = new Map<string, TypedClaim[]>();
  for (const section of memo.sections) {
    for (const [index, paragraph] of section.paragraphs.entries()) {
      const group = section.adjacentClaims?.find(({ paragraphIndex }) =>
        paragraphIndex === index
      );
      sectionsByParagraph.set(paragraph, group?.claims ?? []);
    }
  }

  const occurrences = visibleNumericOccurrences(text);
  assert.ok(occurrences.length >= 30);
  for (const occurrence of occurrences) {
    const paragraphClaims = sectionsByParagraph.get(occurrence.context);
    const typedParagraph = paragraphClaims?.some(({ statement }) =>
      statement.includes(occurrence.token)
    ) ?? false;
    const claimContext = claims.some((claim) =>
      occurrence.context.startsWith(
        `${claim.classification.toUpperCase()} — ${claim.statement}`,
      )
      && claim.statement.includes(occurrence.token)
    );
    const calculationInputContext = claims.some((claim) =>
      claim.classification === "calculation"
      && claim.derivedFrom?.some((input) =>
        occurrence.context ===
          `CALCULATION — ${claim.statement}\nDerived from — `
            + claim.derivedFrom!.join("; ")
        && input.includes(occurrence.token)
      )
    );
    const headingOrExemption = exemptions.has(occurrence.token)
      && (
        /^\d{2} [A-Z]/.test(occurrence.context)
        || occurrence.context.split("\n").includes(
          `${occurrence.token} — ${exemptions.get(occurrence.token)}`,
        )
      );
    assert.ok(
      typedParagraph || claimContext || calculationInputContext || headingOrExemption,
      `numeric occurrence at ${occurrence.index} lacks typed local context: `
        + `${occurrence.token} in ${JSON.stringify(occurrence.context)}`,
    );
  }
  for (const exemption of memo.appendix.numericExemptions) {
    assert.ok(exemption.reason.length >= 20);
  }
});

test("every sample-dependent main-body surface carries a local synthetic label", () => {
  const { memo } = loadGolden();
  const mainBodySurfaces = [
    memo.editorialNotice,
    ...memo.sections.flatMap((section) => [
      ...section.paragraphs,
      ...(section.adjacentClaims?.flatMap(({ claims }) =>
        claims.flatMap((claim) => [
          claim.statement,
          claim.rationale ?? "",
          ...(claim.derivedFrom ?? []),
        ])
      ) ?? []),
      section.disclosure ?? "",
      section.synthesis ?? "",
      ...(section.passages?.flatMap((passage) => [
        passage.premise,
        passage.caseApplication,
        passage.countercase,
        passage.evidenceRequest,
        passage.conditionalPosture,
      ]) ?? []),
    ]),
  ].filter(Boolean);
  const dependsOnSample =
    /\b(?:prior thesis|prior record|prior action|sample investment record|sample revisit condition|original check|those synthetic inputs|synthetic fund)\b/i;

  for (const surface of mainBodySurfaces.filter((value) =>
    dependsOnSample.test(value)
  )) {
    assert.match(
      surface,
      /\b(?:synthetic|sample|Assumption:|Calculation:)\b/i,
      `sample-dependent prose lacks a local label: ${surface}`,
    );
  }

  for (const claim of memo.appendix.typedClaims) {
    if (claim.classification === "assumption") {
      assert.match(claim.statement, /^Assumption:/);
    }
  }
});

test("professional and attribution safety rules cover both TXT and JSON", () => {
  const { memo, rawJson, text } = loadGolden();
  const corpus = `${text}\n${rawJson}`;
  const person = "(?:Howard Marks|Scott Kupor|Marc Andreessen|Aswath Damodaran|Peter Thiel)";

  assert.match(corpus, /investment committee/i);
  assert.match(corpus, /valuation/i);
  assert.match(corpus, /diligence/i);
  assert.match(corpus, /counterevidence/i);
  assert.doesNotMatch(
    corpus,
    /\b(?:belief_revised|no_material_change|analysis_unavailable|internal_only|pause_follow_on|portfolio_risk_review)\b/i,
  );
  assert.doesNotMatch(
    corpus,
    /\b(?:source_revision|framework_advisory|evidence_pack|fixture|deal)_[a-z0-9_:-]+\b/i,
  );
  assert.doesNotMatch(
    corpus,
    /\b(?:as an AI|delve|it is important to note|in conclusion|chain of thought|private reasoning|internal reasoning process)\b/i,
  );
  assert.doesNotMatch(
    corpus,
    new RegExp(`\\b${person}\\s+(?:believes|recommends|thinks|argues|concludes|endorses)\\b`, "i"),
  );
  assert.doesNotMatch(
    corpus,
    new RegExp(`(?:reviewed|approved|endorsed)\\s+by\\s+${person}|${person}.{0,40}(?:reviewed|approved|endorsed)`, "i"),
  );
  const lensSection = memo.sections.find(({ title }) => title === "Named Lens Readings");
  assert.ok(lensSection?.passages);
  for (const passage of lensSection.passages) {
    assert.doesNotMatch(
      passageText(passage),
      /(?:^|[.!?]\s+)(?:I|We)\s+(?:believe|recommend|think|would|conclude)|\b(?:my|our)\s+(?:view|opinion|recommendation)\b/i,
    );
  }
  assert.equal((corpus.match(/\bUnavailable\b/g) ?? []).length, 0);
  assert.doesNotMatch(text, /(?:^|\n)(?:Premise|Case application|Countercase|Evidence request|Conditional posture):/);
});
