import assert from "node:assert/strict";
import {
  cp,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";

import type {
  ResolvedUnderwritingContext,
} from "../../lib/contracts/underwriting";
import {
  authorizedResearchComposites,
  isAuthorizedResearchComposite,
  loadResearchFrameworkCatalog,
} from "../../lib/underwriting/frameworks/research-loader";
import {
  DECISION_TAXONOMY_VERSION,
  DecisionQuestionCodeSchema,
  EvidenceDomainCodeSchema,
  resolveDecisionTaxonomy,
} from "../../lib/underwriting/frameworks/decision-taxonomy";

const researchRoot = fileURLToPath(
  new URL("../../research/framework-authoring", import.meta.url),
);

const context: ResolvedUnderwritingContext = {
  id: "underwriting_context_seed_b2b_saas_v1",
  contextVersion: "1",
  stage: "seed",
  businessModel: "b2b_saas",
  geography: "us",
  securityType: "preferred",
  asOfDate: "2026-07-29",
  criticalEvidenceProfileId: "critical_evidence_seed_b2b_saas_v1",
  benchmarkPackId: "benchmark_pack_synthetic_us_software_v1",
  benchmarkCompatibility: "exact",
  valuationMethodPolicyId: "valuation_method_seed_b2b_saas_v1",
  decisionPolicyId: "decision_policy_seed_b2b_saas_v1",
  frameworkPackId: "framework_pack_synthetic_universal_saas_ai_v1",
};

const pendingReviewIds = [
  "BVC-02",
  "BVC-03",
  "BVC-04",
  "BVC-05",
  "BVC-09",
  "FD-02",
  "FD-04",
  "FD-06",
  "FD-07",
  "FD-10",
  "OA2-08",
  "VCFI-03",
  "VCFI-04",
  "VCFI-05",
  "VCFI-06",
  "VCFI-07",
  "VCFI-08",
  "VCFI-09",
  "VCFI-10",
] as const;

test("exposes the closed V1 decision-question and evidence-domain taxonomies", () => {
  assert.deepEqual(DecisionQuestionCodeSchema.options, [
    "market_structure", "product_differentiation", "customer_adoption",
    "founder_team_execution", "operating_model", "unit_economics",
    "financing_valuation", "governance", "security", "portfolio_risk",
  ]);
  assert.deepEqual(EvidenceDomainCodeSchema.options, [
    "market", "product", "customer", "distribution", "team", "operations",
    "financial_performance", "unit_economics", "financing_terms", "valuation",
    "governance", "security", "regulatory", "portfolio_risk",
  ]);
  assert.throws(() => DecisionQuestionCodeSchema.parse("famous_investor_view"));
});

test("binds each audited Card decision question to one exact taxonomy row", async () => {
  const catalog = await loadResearchFrameworkCatalog({ context });
  const cards = await loadAllAuthoringCards();
  const expected = cards.flatMap((card) =>
    card.decisionQuestions.map((questionText: string, index: number) => ({
      frameworkId: card.frameworkId as string,
      cardFieldRef: `decisionQuestions[${index}]`,
      questionText,
    }))
  ).toSorted((left, right) =>
    compareUtf8(
      `${left.frameworkId}\u0000${left.cardFieldRef}`,
      `${right.frameworkId}\u0000${right.cardFieldRef}`,
    )
  );
  const actual = [...catalog.decisionTaxonomyBindings];

  assert.equal(catalog.decisionTaxonomyVersion, DECISION_TAXONOMY_VERSION);
  assert.match(catalog.decisionTaxonomyDigest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(
    actual.map(({ frameworkId, cardFieldRef, questionText }) => ({
      frameworkId,
      cardFieldRef,
      questionText,
    })),
    expected,
  );
  assert.equal(
    new Set(actual.map(({ frameworkId, cardFieldRef }) =>
      `${frameworkId}\u0000${cardFieldRef}`
    )).size,
    expected.length,
  );
});

test("uses explicit semantic taxonomy assignments for collision words", () => {
  assert.deepEqual(
    pickDecisionTaxonomy("BG-10", "decisionQuestions[3]"),
    { decisionQuestionCode: "governance", evidenceDomainCodes: ["governance"] },
  );
  assert.deepEqual(
    pickDecisionTaxonomy("CSP-06", "decisionQuestions[3]"),
    { decisionQuestionCode: "customer_adoption", evidenceDomainCodes: ["customer"] },
  );
  assert.deepEqual(
    pickDecisionTaxonomy("SP-03", "decisionQuestions[3]"),
    { decisionQuestionCode: "founder_team_execution", evidenceDomainCodes: ["team"] },
  );
  assert.deepEqual(
    pickDecisionTaxonomy("SQ-03", "decisionQuestions[4]"),
    { decisionQuestionCode: "customer_adoption", evidenceDomainCodes: ["customer"] },
  );
  assert.deepEqual(
    pickDecisionTaxonomy("VD-02", "decisionQuestions[0]"),
    { decisionQuestionCode: "financing_valuation", evidenceDomainCodes: ["financing_terms", "valuation"] },
  );
  assert.deepEqual(
    pickDecisionTaxonomy("BVC-03", "decisionQuestions[0]"),
    { decisionQuestionCode: "financing_valuation", evidenceDomainCodes: ["financing_terms", "valuation"] },
  );
  assert.deepEqual(
    pickDecisionTaxonomy("VM-07", "decisionQuestions[2]"),
    { decisionQuestionCode: "financing_valuation", evidenceDomainCodes: ["financing_terms", "valuation"] },
  );
});

test("does not expose mutable taxonomy rows after computing the digest", () => {
  const binding = resolveDecisionTaxonomy("BG-10", "decisionQuestions[3]");
  assert.equal(Object.isFrozen(binding), true);
  assert.equal(Object.isFrozen(binding.evidenceDomainCodes), true);
  assert.throws(() => {
    (binding as { decisionQuestionCode: string }).decisionQuestionCode =
      "security";
  }, TypeError);
  assert.throws(() => {
    (binding.evidenceDomainCodes as string[]).push("security");
  }, TypeError);
});

test("loads the audited corpus into twenty immutable pack composites and excludes all pending-review cards", async () => {
  const catalog = await loadResearchFrameworkCatalog({
    context,
  });
  const deterministicReplay = await loadResearchFrameworkCatalog({
    context,
  });

  assert.deepEqual(catalog.stats, {
    packCount: 20,
    cardCount: 199,
    sourceCount: 270,
    eligibleCardCount: 180,
    excludedCardCount: 19,
  });
  assert.deepEqual(catalog.authorization, {
    mode: "canonical_audited",
    corpusDigest:
      "sha256:222c869b57362bdc38742717b9a5e894693f66843f6851d265c344439de3c461",
  });
  assert.equal(catalog.composites.length, 20);
  assert.equal(new Set(catalog.composites.map(({ id }) => id)).size, 20);
  assert.deepEqual(
    catalog.composites.map(({ experimentalAdvisory }) =>
      experimentalAdvisory.packId
    ),
    catalog.composites
      .map(({ experimentalAdvisory }) => experimentalAdvisory.packId)
      .toSorted(compareUtf8),
  );
  const componentIds = catalog.composites.flatMap(
    ({ experimentalAdvisory }) =>
      experimentalAdvisory.componentCardIds,
  );
  assert.equal(
    pendingReviewIds.some((id) => componentIds.includes(id)),
    false,
  );
  assert.equal(Object.isFrozen(catalog), true);
  assert.equal(Object.isFrozen(catalog.composites), true);
  assert.equal(Object.isFrozen(catalog.composites[0]), true);
  assert.equal(
    Object.isFrozen(catalog.composites[0]?.experimentalAdvisory.components),
    true,
  );
  assert.equal(deterministicReplay.fingerprint, catalog.fingerprint);
  assert.deepEqual(deterministicReplay.composites, catalog.composites);

  const peterThiel = catalog.composites.find(({ experimentalAdvisory }) =>
    experimentalAdvisory.packId
      === "peter_thiel_public_frameworks_v0_1"
  );
  assert.ok(peterThiel);
  const contrarian = peterThiel.experimentalAdvisory.components.find(
    ({ frameworkId }) => frameworkId === "PT-01",
  );
  assert.ok(contrarian);
  assert.match(contrarian.neutralParaphrase, /testable/i);
  assert.equal(contrarian.decisionQuestions.length, 6);
  assert.equal(contrarian.positiveSignals.length, 5);
  assert.equal(contrarian.redFlags.length, 6);
  assert.equal(contrarian.disconfirmingEvidence.length, 5);
  assert.equal(contrarian.contraindications.length, 4);
  assert.equal(contrarian.sourceRefs[0]?.sourceId, "PT-P2-CS183-01");
  assert.deepEqual(contrarian.sourceRefs[0]?.locator, {
    kind: "web_section",
    value: "Three questions and contrarian/business question",
  });
  const source = peterThiel.experimentalAdvisory.sources.find(
    ({ sourceId }) => sourceId === "PT-P2-CS183-01",
  );
  assert.deepEqual(
    {
      title: source?.title,
      publisher: source?.publisher,
      url: source?.url,
      attributionScope: source?.attributionScope,
    },
    {
      title: "CS183 Class 1: The Challenge of the Future",
      publisher: "Blake Masters",
      url: "https://blakemasters.tumblr.com/post/20400301508/cs183class1",
      attributionScope: "course_notes_derivative",
    },
  );

  for (
    const [packId, frameworkId] of [
      ["bill_gurley_public_frameworks_v0_1", "BG-01"],
      [
        "aswath_damodaran_dark_side_valuation_public_frameworks_v0_1",
        "DSV-01",
      ],
      ["hamilton_helmer_7_powers_public_frameworks_v0_1", "H7P-01"],
    ] as const
  ) {
    const composite = catalog.composites.find(({ experimentalAdvisory }) =>
      experimentalAdvisory.packId === packId
    );
    assert.ok(composite);
    assert.equal(
      composite.experimentalAdvisory.componentCardIds.includes(frameworkId),
      true,
    );
  }
});

test("filters component cards by all four immutable context dimensions before authorization", async () => {
  const [seed, seriesA, global] = await Promise.all([
    loadResearchFrameworkCatalog({ context }),
    loadResearchFrameworkCatalog({
      context: { ...context, stage: "series_a" },
    }),
    loadResearchFrameworkCatalog({
      context: {
        ...context,
        geography: "global",
        benchmarkPackId: null,
        benchmarkCompatibility: "unavailable",
      },
    }),
  ]);
  const billSeed = packComponentIds(seed, "bill_gurley_public_frameworks_v0_1");
  const billSeriesA = packComponentIds(
    seriesA,
    "bill_gurley_public_frameworks_v0_1",
  );
  const ventureDealsUs = packComponentIds(
    seed,
    "venture_deals_public_frameworks_v0_1",
  );
  const ventureDealsGlobal = packComponentIds(
    global,
    "venture_deals_public_frameworks_v0_1",
  );

  assert.equal(billSeed.includes("BG-01"), true);
  assert.equal(billSeed.includes("BG-02"), false);
  assert.equal(billSeriesA.includes("BG-02"), true);
  assert.equal(ventureDealsUs.includes("VD-01"), true);
  assert.equal(ventureDealsGlobal.includes("VD-01"), false);
});

test("unavailable Deal geography keeps geography-agnostic Cards eligible and rejects geography-specific Cards", async () => {
  const catalog = await loadResearchFrameworkCatalog({
    context: {
      ...context,
      analysisMode: "core_only",
      geography: "unavailable",
      benchmarkPackId: null,
      benchmarkCompatibility: "unavailable",
    },
  });

  assert.equal(
    packComponentIds(catalog, "peter_thiel_public_frameworks_v0_1")
      .includes("PT-01"),
    true,
    "an audited Card explicitly applicable to all geographies must not be removed merely because Deal geography is unknown",
  );
  assert.equal(
    packComponentIds(catalog, "venture_deals_public_frameworks_v0_1")
      .includes("VD-01"),
    false,
    "a United-States-specific Card must fail closed when Deal geography is unknown",
  );
});

test("authorizes only exact composite objects emitted by this loader instance", async () => {
  const catalog = await loadResearchFrameworkCatalog({
    context,
  });
  const authorized = authorizedResearchComposites(catalog);
  const exact = authorized.find(({ experimentalAdvisory }) =>
    experimentalAdvisory.applicable
  );
  assert.ok(exact);

  assert.equal(isAuthorizedResearchComposite(catalog, exact), true);
  assert.equal(
    isAuthorizedResearchComposite(catalog, structuredClone(exact)),
    false,
  );
  assert.throws(
    () => authorizedResearchComposites(structuredClone(catalog)),
    /not an authorized research catalog/i,
  );
});

test("custom research roots are validation-only and can never authorize execution", async (t) => {
  const fixture = await copyPeterThielFixture(t);
  const catalog = await loadResearchFrameworkCatalog({
    context,
    researchRoot: fixture,
    authorizationMode: "validation_only",
  });

  assert.deepEqual(catalog.stats, {
    packCount: 1,
    cardCount: 10,
    sourceCount: 23,
    eligibleCardCount: 10,
    excludedCardCount: 0,
  });
  assert.ok(catalog.authorization);
  assert.deepEqual(catalog.authorization, {
    mode: "validation_only",
    corpusDigest: catalog.authorization.corpusDigest,
  });
  assert.match(
    catalog.authorization.corpusDigest,
    /^sha256:[a-f0-9]{64}$/,
  );
  assert.throws(
    () => authorizedResearchComposites(catalog),
    /validation-only|not an authorized research catalog/i,
  );
  assert.equal(
    isAuthorizedResearchComposite(catalog, catalog.composites[0]!),
    false,
  );
});

test("rejects missing, extra, stale, or unsorted taxonomy bindings before catalog resolution", async (t) => {
  const missing = await copyPeterThielFixture(t);
  const missingPath = join(missing, "decision-question-taxonomy.v1.json");
  const missingTaxonomy = await readJson(missingPath);
  missingTaxonomy.bindings = (missingTaxonomy.bindings as unknown[]).slice(1);
  await writeJson(missingPath, missingTaxonomy);
  await assert.rejects(
    loadResearchFrameworkCatalog({
      context,
      researchRoot: missing,
      authorizationMode: "validation_only",
    }),
    /requires exactly one decision taxonomy binding/i,
  );

  const extra = await copyPeterThielFixture(t);
  const extraPath = join(extra, "decision-question-taxonomy.v1.json");
  const extraTaxonomy = await readJson(extraPath);
  const extraBindings = extraTaxonomy.bindings as Array<Record<string, unknown>>;
  extraBindings.push({
    ...extraBindings[0],
    cardFieldRef: "decisionQuestions[99]",
  });
  extraBindings.sort((left, right) => compareUtf8(
    `${left.frameworkId}\u0000${left.cardFieldRef}`,
    `${right.frameworkId}\u0000${right.cardFieldRef}`,
  ));
  await writeJson(extraPath, extraTaxonomy);
  await assert.rejects(
    loadResearchFrameworkCatalog({
      context,
      researchRoot: extra,
      authorizationMode: "validation_only",
    }),
    /unknown Framework Card or field/i,
  );

  const stale = await copyPeterThielFixture(t);
  const stalePath = join(stale, "decision-question-taxonomy.v1.json");
  const staleTaxonomy = await readJson(stalePath);
  (staleTaxonomy.bindings as Array<Record<string, unknown>>)[0]!
    .questionText = "Stale question text";
  await writeJson(stalePath, staleTaxonomy);
  await assert.rejects(
    loadResearchFrameworkCatalog({
      context,
      researchRoot: stale,
      authorizationMode: "validation_only",
    }),
    /question text must exactly match/i,
  );

  const unsorted = await copyPeterThielFixture(t);
  const unsortedPath = join(unsorted, "decision-question-taxonomy.v1.json");
  const unsortedTaxonomy = await readJson(unsortedPath);
  const unsortedBindings = unsortedTaxonomy.bindings as unknown[];
  [unsortedBindings[0], unsortedBindings[1]] = [
    unsortedBindings[1],
    unsortedBindings[0],
  ];
  await writeJson(unsortedPath, unsortedTaxonomy);
  await assert.rejects(
    loadResearchFrameworkCatalog({
      context,
      researchRoot: unsorted,
      authorizationMode: "validation_only",
    }),
    /UTF-8 sorted/i,
  );
});

test("rejects duplicate taxonomy rows and propagates a taxonomy-code change through loader digests", async (t) => {
  const duplicate = await copyPeterThielFixture(t);
  const duplicatePath = join(duplicate, "decision-question-taxonomy.v1.json");
  const duplicateTaxonomy = await readJson(duplicatePath);
  const duplicateBindings = duplicateTaxonomy.bindings as Array<Record<string, unknown>>;
  duplicateBindings.splice(1, 0, structuredClone(duplicateBindings[0]!));
  await writeJson(duplicatePath, duplicateTaxonomy);
  await assert.rejects(
    loadResearchFrameworkCatalog({
      context,
      researchRoot: duplicate,
      authorizationMode: "validation_only",
    }),
    /unique and UTF-8 sorted/i,
  );

  const fixture = await copyPeterThielFixture(t);
  const before = await loadResearchFrameworkCatalog({
    context,
    researchRoot: fixture,
    authorizationMode: "validation_only",
  });
  const taxonomyPath = join(fixture, "decision-question-taxonomy.v1.json");
  const taxonomy = await readJson(taxonomyPath);
  const binding = (taxonomy.bindings as Array<Record<string, unknown>>).find(
    ({ frameworkId, cardFieldRef }) =>
      frameworkId === "PT-01" && cardFieldRef === "decisionQuestions[0]",
  );
  assert.ok(binding);
  binding.decisionQuestionCode = binding.decisionQuestionCode === "market_structure"
    ? "operating_model"
    : "market_structure";
  await writeJson(taxonomyPath, taxonomy);
  const after = await loadResearchFrameworkCatalog({
    context,
    researchRoot: fixture,
    authorizationMode: "validation_only",
  });
  const beforeComposite = before.composites.find(({ experimentalAdvisory }) =>
    experimentalAdvisory.packId === "peter_thiel_public_frameworks_v0_1"
  );
  const afterComposite = after.composites.find(({ experimentalAdvisory }) =>
    experimentalAdvisory.packId === "peter_thiel_public_frameworks_v0_1"
  );
  assert.ok(beforeComposite);
  assert.ok(afterComposite);
  assert.notEqual(after.decisionTaxonomyDigest, before.decisionTaxonomyDigest);
  assert.notEqual(after.authorization.corpusDigest, before.authorization.corpusDigest);
  assert.notEqual(after.fingerprint, before.fingerprint);
  assert.notEqual(
    afterComposite.experimentalAdvisory.authorizationDigest,
    beforeComposite.experimentalAdvisory.authorizationDigest,
  );
});

test("rejects client-supplied taxonomy bindings rather than accepting a catalog-order fallback", async () => {
  await assert.rejects(
    loadResearchFrameworkCatalog({
      context,
      decisionTaxonomyBindings: [],
    } as unknown as Parameters<typeof loadResearchFrameworkCatalog>[0]),
    /does not accept client-supplied authorization or taxonomy fields/i,
  );
});

test("rejects a taxonomy document whose bindings belong to a different Card component", async (t) => {
  const fixture = await copyPeterThielFixture(t);
  const cardPath = join(
    fixture,
    "authors/peter-thiel/cards/pt-01-contrarian-truth.card.json",
  );
  const card = await readJson(cardPath);
  card.frameworkId = "PT-99";
  await writeJson(cardPath, card);

  await assert.rejects(
    loadResearchFrameworkCatalog({
      context,
      researchRoot: fixture,
      authorizationMode: "validation_only",
    }),
    /unknown Framework Card or field/i,
  );
});

test("rejects unknown manifest fields from the authoring JSON contract", async (t) => {
  const fixture = await copyPeterThielFixture(t);
  const manifestPath = join(
    fixture,
    "authors/peter-thiel/peter-thiel-public-frameworks.pack.json",
  );
  const manifest = await readJson(manifestPath);
  manifest.unreviewedRuntimeOverride = true;
  await writeJson(manifestPath, manifest);

  await assert.rejects(
    loadResearchFrameworkCatalog({
      context,
      researchRoot: fixture,
      authorizationMode: "validation_only",
    }),
    /pack manifest.*invalid/i,
  );
});

test("rejects a manifest Card path that escapes the author directory", async (t) => {
  const fixture = await copyPeterThielFixture(t);
  const manifestPath = join(
    fixture,
    "authors/peter-thiel/peter-thiel-public-frameworks.pack.json",
  );
  const manifest = await readJson(manifestPath);
  const cardFiles = manifest.cardFiles as string[];
  cardFiles[0] = "../peter-thiel/sources.json";
  await writeJson(manifestPath, manifest);

  await assert.rejects(
    loadResearchFrameworkCatalog({
      context,
      researchRoot: fixture,
      authorizationMode: "validation_only",
    }),
    /pack manifest.*invalid|safe relative card path/i,
  );
});

test("rejects duplicate source identities inside one pack", async (t) => {
  const fixture = await copyPeterThielFixture(t);
  const sourcesPath = join(
    fixture,
    "authors/peter-thiel/sources.json",
  );
  const catalog = await readJson(sourcesPath);
  const sources = catalog.sources as Array<Record<string, unknown>>;
  sources[1]!.sourceId = sources[0]!.sourceId;
  await writeJson(sourcesPath, catalog);

  await assert.rejects(
    loadResearchFrameworkCatalog({
      context,
      researchRoot: fixture,
      authorizationMode: "validation_only",
    }),
    /source identities must be unique/i,
  );
});

test("rejects a Card source reference that does not resolve in its own pack", async (t) => {
  const fixture = await copyPeterThielFixture(t);
  const cardPath = join(
    fixture,
    "authors/peter-thiel/cards/pt-01-contrarian-truth.card.json",
  );
  const card = await readJson(cardPath);
  const sourceRefs = card.sourceRefs as Array<Record<string, unknown>>;
  sourceRefs[0]!.sourceId = "SOURCE-OUTSIDE-AUDITED-PACK";
  await writeJson(cardPath, card);

  await assert.rejects(
    loadResearchFrameworkCatalog({
      context,
      researchRoot: fixture,
      authorizationMode: "validation_only",
    }),
    /source reference.*does not resolve/i,
  );
});

function packComponentIds(
  catalog: Awaited<ReturnType<typeof loadResearchFrameworkCatalog>>,
  packId: string,
): string[] {
  const composite = catalog.composites.find(({ experimentalAdvisory }) =>
    experimentalAdvisory.packId === packId
  );
  assert.ok(composite);
  return [...composite.experimentalAdvisory.componentCardIds];
}

async function copyPeterThielFixture(
  t: TestContext,
): Promise<string> {
  const fixture = await mkdtemp(join(tmpdir(), "framework-loader-test-"));
  t.after(async () => {
    await rm(fixture, { recursive: true, force: true });
  });
  const destination = join(fixture, "authors/peter-thiel");
  await mkdir(dirname(destination), { recursive: true });
  await cp(
    join(researchRoot, "authors/peter-thiel"),
    destination,
    { recursive: true },
  );
  const taxonomy = await readJson(
    join(researchRoot, "decision-question-taxonomy.v1.json"),
  );
  const bindings = taxonomy.bindings as Array<Record<string, unknown>>;
  await writeJson(join(fixture, "decision-question-taxonomy.v1.json"), {
    schemaVersion: taxonomy.schemaVersion,
    bindings: bindings.filter(({ frameworkId }) =>
      typeof frameworkId === "string" && frameworkId.startsWith("PT-")
    ),
  });
  return fixture;
}

async function loadAllAuthoringCards(): Promise<Array<{
  frameworkId: string;
  decisionQuestions: string[];
}>> {
  const authorsRoot = join(researchRoot, "authors");
  const cards: Array<{ frameworkId: string; decisionQuestions: string[] }> = [];
  for (const author of await readdir(authorsRoot)) {
    const cardsRoot = join(authorsRoot, author, "cards");
    for (const cardFile of await readdir(cardsRoot)) {
      if (cardFile.endsWith(".card.json")) {
        cards.push(await readJson(join(cardsRoot, cardFile)) as unknown as {
          frameworkId: string;
          decisionQuestions: string[];
        });
      }
    }
  }
  return cards;
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function writeJson(
  path: string,
  value: Record<string, unknown>,
): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function pickDecisionTaxonomy(
  frameworkId: string,
  cardFieldRef: string,
): { decisionQuestionCode: string; evidenceDomainCodes: string[] } {
  const binding = resolveDecisionTaxonomy(frameworkId, cardFieldRef);
  return {
    decisionQuestionCode: binding.decisionQuestionCode,
    evidenceDomainCodes: [...binding.evidenceDomainCodes],
  };
}
