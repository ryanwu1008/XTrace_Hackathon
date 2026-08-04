import assert from "node:assert/strict";
import {
  cp,
  mkdtemp,
  mkdir,
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
      "sha256:5144000c0f34c5c352f9bc886460cd561a52b45da31049f00d7fbf6115e3a8bb",
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
  return fixture;
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
