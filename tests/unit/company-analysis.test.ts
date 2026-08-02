import assert from "node:assert/strict";
import test from "node:test";

import type {
  DealMemoryBundle,
} from "../../lib/contracts/domain";
import { parseSourceRefV2Read } from "../../lib/contracts/legacy-evidence-adapter";
import { buildPreloadedDealMemoryBundles } from "../../lib/corpus/service";
import { interactionSourceV2 } from "../../lib/matching/context";
import type { GroundedMatch } from "../../lib/matching/service";
import {
  buildCompanyAnalyses,
  countCompanyAnalyses,
} from "../../lib/reports/company-analysis";
import type { MemoryContext } from "../../lib/xtrace/service";
import {
  exactSourceV2,
  marketEventV2,
  normalizedSourceV2,
} from "../helpers/source-evidence-v2";

const REPORT_ID = "report_1";
const RUN_ID = "00000000-0000-4000-8000-000000000001";
const CREATED_AT = "2026-07-24T12:00:00.000Z";

function contextsForEveryDeal(
  bundles: DealMemoryBundle[],
): Map<string, MemoryContext[]> {
  return new Map(bundles.map((bundle) => [
    bundle.dealId,
    [{
      dealId: bundle.dealId,
      memoryId: `memory_${bundle.dealId}`,
      memoryType: "fact",
      text: `Verified investment memory for ${bundle.companyName}.`,
      score: 0.9,
      provenance: "source_document",
      sourceIds: bundle.facts.flatMap((fact) =>
        fact.sources.map((source) => source.id)
      ),
      fixtureIds: bundle.interactions.map((interaction) => interaction.id),
    }],
  ]));
}

function groundedMatch(
  bundle: DealMemoryBundle,
  confidence: GroundedMatch["confidence"],
): GroundedMatch {
  const marketSource = normalizedSourceV2(`market_${bundle.dealId}`, {
    title: `${bundle.companyName} market evidence`,
    canonicalUrl: `https://example.com/${bundle.dealId}`,
    publisher: "Example",
    providerId: "example-feed",
    entityKeys: [],
    text: {
      status: "normalized_only",
      normalizedStatement: `${bundle.companyName} sector activity increased.`,
    },
  });
  assert.equal(marketSource.text.status, "normalized_only");
  if (marketSource.text.status !== "normalized_only") {
    throw new Error("Grounded-match fixture requires normalized market text.");
  }
  const dealSource = parseSourceRefV2Read(bundle.facts[0].sources[0]);
  const syntheticSource = interactionSourceV2(bundle.interactions[0]);
  const score = confidence === "high" ? 0.82 : confidence === "medium"
    ? 0.65
    : 0.42;
  return {
    dealId: bundle.dealId,
    dealStatus: bundle.status,
    outcome: confidence === "low" ? "monitor" : "belief_revised",
    confidence,
    score,
    whyNow: marketSource.text.normalizedStatement,
    previousContext: bundle.interactions[0].decisionReason,
    implications: {
      positive: ["The market evidence warrants renewed internal review."],
      negative: [],
    },
    nextStep:
      "Review the cited evidence and decide whether further internal diligence is warranted.",
    relationship: "satisfies",
    events: [marketEventV2(marketSource, {
      id: `event_${bundle.dealId}`,
      title: marketSource.title,
      eventType: "funding",
    })],
    sources: [marketSource, dealSource, syntheticSource],
    demoFixtureIds: [syntheticSource.id],
    claimSupport: [{
      text: marketSource.text.normalizedStatement,
      kind: "normalized_non_quote",
      sourceIds: [marketSource.id],
    }],
  };
}

function baseInput() {
  const bundles = buildPreloadedDealMemoryBundles();
  return {
    reportId: REPORT_ID,
    runId: RUN_ID,
    createdAt: CREATED_AT,
    bundles,
    contextsByDeal: contextsForEveryDeal(bundles),
    recallFailures: new Set<string>(),
    groundedMatches: [] as GroundedMatch[],
  };
}

test("builds one no-change analysis for every fixed MVP Deal", () => {
  const analyses = buildCompanyAnalyses(baseInput());

  assert.equal(analyses.length, 19);
  assert.ok(analyses.every((analysis) =>
    analysis.outcome === "no_material_change"
  ));
  assert.deepEqual(countCompanyAnalyses(analyses), {
    companyCount: 19,
    beliefRevised: 0,
    monitor: 0,
    noMaterialChange: 19,
    analysisUnavailable: 0,
  });
});

test("projects qualified and low grounded matches without inventing fields", () => {
  const input = baseInput();
  const highBundle = input.bundles.find((bundle) =>
    bundle.dealId === "deal_ably"
  )!;
  const lowBundle = input.bundles.find((bundle) =>
    bundle.dealId === "deal_100plus"
  )!;
  const analyses = buildCompanyAnalyses({
    ...input,
    groundedMatches: [
      groundedMatch(highBundle, "high"),
      groundedMatch(lowBundle, "low"),
    ],
  });
  const byDeal = new Map(analyses.map((analysis) => [
    analysis.dealId,
    analysis,
  ]));

  assert.equal(byDeal.get("deal_ably")?.outcome, "monitor");
  assert.equal(byDeal.get("deal_100plus")?.outcome, "monitor");
  assert.equal(
    byDeal.get("deal_ably")?.companyBrief.traction[0].value,
    null,
  );
  assert.equal(
    byDeal.get("deal_ably")?.companyBrief.traction[0].unavailableReason,
    "Not available in current evidence",
  );
});

test("a high-score match without a current hard-gate assessment cannot become a belief revision", () => {
  const input = baseInput();
  const bundle = input.bundles.find((candidate) =>
    candidate.dealId === "deal_ably"
  )!;

  const analysis = buildCompanyAnalyses({
    ...input,
    groundedMatches: [groundedMatch(bundle, "high")],
  }).find((candidate) => candidate.dealId === bundle.dealId)!;

  assert.equal(analysis.outcome, "monitor");
  assert.equal(analysis.beliefAssessment, undefined);
});

test("market evidence lineage contains exactly embedded event sources and excludes unrelated local public facts", () => {
  const input = baseInput();
  const bundle = input.bundles.find((candidate) =>
    candidate.dealId === "deal_ably"
  )!;
  const unrelatedPublicSource = normalizedSourceV2(
    "unrelated_local_public_source",
    {
      title: "Unrelated local company fact",
      canonicalUrl: "https://example.com/unrelated-local-fact",
      publisher: "Example",
      providerId: "company-registry",
      text: {
        status: "normalized_only",
        normalizedStatement: "An unrelated local company fact was recorded.",
      },
    },
  );
  bundle.facts = [...bundle.facts, {
    text: "An unrelated local company fact was recorded.",
    sources: [unrelatedPublicSource],
  }];
  const match = groundedMatch(bundle, "high");
  const eventSourceIds = match.events.flatMap((event) =>
    event.sources.map((source) => source.id)
  );
  match.sources = match.sources.filter((source) =>
    !eventSourceIds.includes(source.id)
  );

  const analysis = buildCompanyAnalyses({
    ...input,
    groundedMatches: [match],
  }).find((candidate) => candidate.dealId === bundle.dealId)!;

  assert.deepEqual(
    analysis.marketEvidence.sourceIds.slice().sort(),
    eventSourceIds.slice().sort(),
  );
  assert.equal(
    analysis.marketEvidence.sourceIds.includes(unrelatedPublicSource.id),
    false,
  );
  assert.ok(
    eventSourceIds.every((sourceId) =>
      analysis.sources.some((source) => source.id === sourceId)
    ),
    "every embedded event source remains in the full analysis lineage",
  );
  assert.ok(
    analysis.sources.some((source) => source.id === unrelatedPublicSource.id),
    "unrelated local evidence remains visible as general company lineage",
  );
});

test("uses analysis unavailable only for the failed company recall", () => {
  const input = baseInput();
  const analyses = buildCompanyAnalyses({
    ...input,
    recallFailures: new Set(["deal_7bridges"]),
  });
  const unavailable = analyses.filter((analysis) =>
    analysis.outcome === "analysis_unavailable"
  );

  assert.equal(unavailable.length, 1);
  assert.equal(unavailable[0].dealId, "deal_7bridges");
  assert.equal(unavailable[0].sources.length, 0);
});

test("treats an empty XTrace result as unavailable instead of using local fallback", () => {
  const input = baseInput();
  input.contextsByDeal.set("deal_7bridges", []);
  const analyses = buildCompanyAnalyses(input);

  assert.equal(
    analyses.find((analysis) => analysis.dealId === "deal_7bridges")?.outcome,
    "analysis_unavailable",
  );
});

test("keeps untyped exact prose metrics unavailable until typed evidence exists", () => {
  const input = baseInput();
  const legacyCouPro = buildCompanyAnalyses(input).find((analysis) =>
    analysis.dealId === "deal_coupro"
  )!;
  assert.equal(
    legacyCouPro.companyBrief.traction.find((field) =>
      field.label === "Customers / users"
    )?.value,
    null,
    "legacy unverified text must not pass an exact-value extractor",
  );
  const couProBundle = input.bundles.find((bundle) =>
    bundle.dealId === "deal_coupro"
  )!;
  couProBundle.facts = couProBundle.facts.map((fact) => ({
    ...fact,
    sources: fact.sources.map((source) => {
      if ("schemaVersion" in source) return source;
      return exactSourceV2(source.id, {
        provenance: "source_document",
        title: source.title,
        canonicalUrl: null,
        documentId: source.documentId ?? `document_${source.id}`,
        publisher: "Internal Deal Registry",
        providerId: "deal-registry",
        eventAt: null,
        eventAtPrecision: null,
        publishedAt: null,
        publishedAtPrecision: null,
        retrievedAt: CREATED_AT,
        retrievedAtPrecision: "timestamp",
        updatedAt: null,
        updatedAtPrecision: null,
        entityKeys: [],
        sourceClass: "internal_decision_record",
        sourceAuthority: "primary",
        evidenceRole: "context",
        locator: { kind: "document_page", page: source.page ?? 1 },
        text: {
          status: "verified_exact",
          verbatimExcerpt: source.excerpt,
        },
      });
    }),
  }));
  const analyses = buildCompanyAnalyses(input);
  const couPro = analyses.find((analysis) =>
    analysis.dealId === "deal_coupro"
  )!;
  const users = couPro.companyBrief.traction.find((field) =>
    field.label === "Customers / users"
  );
  const growth = couPro.companyBrief.traction.find((field) =>
    field.label === "Growth"
  );

  assert.equal(users?.value, null);
  assert.equal(growth?.value, null);
  assert.deepEqual(users?.sourceIds, []);
  assert.deepEqual(growth?.sourceIds, []);
});

test("does not extract six decision metrics from negated or qualified exact prose", () => {
  const prose = [
    "ARR $10M not established.",
    "500 customers only upper bound.",
    "25% growth unverified.",
    "Series B not current.",
    "$20M raise unplanned.",
    "$100M valuation unsupported.",
  ].join(" ");
  const source = exactSourceV2("qualified_metric_source", {
    provenance: "source_document",
    title: "Qualified metrics memo",
    canonicalUrl: null,
    documentId: "qualified_metrics_document",
    publisher: "Internal Deal Registry",
    providerId: "deal-registry",
    eventAt: null,
    eventAtPrecision: null,
    publishedAt: null,
    publishedAtPrecision: null,
    retrievedAt: CREATED_AT,
    retrievedAtPrecision: "timestamp",
    updatedAt: null,
    updatedAtPrecision: null,
    entityKeys: [],
    sourceClass: "company_official",
    sourceAuthority: "primary",
    evidenceRole: "context",
    locator: { kind: "document_page", page: 1 },
    text: {
      status: "verified_exact",
      verbatimExcerpt: prose,
    },
  });
  const bundle: DealMemoryBundle = {
    dealId: "deal_qualified_metrics",
    companyName: "Qualified Metrics",
    status: "passed",
    facts: [{ text: prose, sources: [source] }],
    interactions: [],
  };
  const [analysis] = buildCompanyAnalyses({
    reportId: REPORT_ID,
    runId: RUN_ID,
    createdAt: CREATED_AT,
    bundles: [bundle],
    contextsByDeal: new Map([[bundle.dealId, [{
      dealId: bundle.dealId,
      memoryId: "memory_qualified_metrics",
      memoryType: "fact",
      text: prose,
      score: 1,
      provenance: "source_document",
      sourceIds: [source.id],
      fixtureIds: [],
    }]]]),
    recallFailures: new Set(),
    groundedMatches: [],
  });

  const metricFields = [
    ...analysis.companyBrief.traction,
    ...analysis.companyBrief.dealTerms,
  ];
  assert.deepEqual(
    metricFields.map((field) => [
      field.label,
      field.value,
      field.unavailableReason,
      field.sourceIds,
    ]),
    [
      ["ARR", null, "Not available in current evidence", []],
      ["Customers / users", null, "Not available in current evidence", []],
      ["Growth", null, "Not available in current evidence", []],
      ["Round", null, "Not available in current evidence", []],
      ["Raise", null, "Not available in current evidence", []],
      ["Valuation", null, "Not available in current evidence", []],
    ],
  );
});

test("does not promote unverified or source-unrelated Deal facts into the factual company overview", () => {
  const modelStatement =
    "Structured image evidence (not a quotation): ARR = 8000000 USD.";
  const bundle: DealMemoryBundle = {
    dealId: "deal_unverified_overview",
    companyName: "Unverified Overview",
    status: "passed",
    facts: [{
      text: "Legacy company overview.",
      sources: [{
        id: "legacy_overview_source",
        provenance: "source_document",
        title: "Legacy memo",
        documentId: "legacy_document",
        excerpt: "Legacy company overview.",
      }],
    }, {
      text: modelStatement,
      sources: [normalizedSourceV2("model_overview_source", {
        provenance: "model_inference",
        title: "company-image.png",
        canonicalUrl: null,
        documentId: "image_document",
        publisher: null,
        providerId: "anthropic",
        eventAt: null,
        eventAtPrecision: null,
        publishedAt: null,
        publishedAtPrecision: null,
        retrievedAt: CREATED_AT,
        retrievedAtPrecision: "timestamp",
        updatedAt: null,
        updatedAtPrecision: null,
        entityKeys: ["unverified-overview"],
        sourceClass: "model_output",
        sourceAuthority: "not_applicable",
        evidenceRole: "context",
        sourceRevisionId: "revision_image_document",
        locator: null,
        text: {
          status: "model_inference",
          normalizedStatement: modelStatement,
          model: {
            provider: "anthropic",
            model: "claude-vision-test",
            generatedAt: CREATED_AT,
            inputFingerprint: `sha256:${"8".repeat(64)}`,
          },
        },
      })],
    }, {
      text: "Fabricated company overview unrelated to its cited source.",
      sources: [normalizedSourceV2("unrelated_overview_source", {
        text: {
          status: "normalized_only",
          normalizedStatement: "This source supports a different statement.",
        },
      })],
    }],
    interactions: [],
  };
  const analyses = buildCompanyAnalyses({
    reportId: REPORT_ID,
    runId: RUN_ID,
    createdAt: CREATED_AT,
    bundles: [bundle],
    contextsByDeal: new Map([[bundle.dealId, [{
      dealId: bundle.dealId,
      memoryId: "memory_unverified_overview",
      memoryType: "structured",
      text: `${bundle.facts[0].text}\n${bundle.facts[1].text}`,
      score: 1,
      provenance: "model_inference",
      sourceIds: bundle.facts.flatMap((fact) =>
        fact.sources.map((source) => source.id)
      ),
      fixtureIds: [],
    }]]]),
    recallFailures: new Set(),
    groundedMatches: [],
  });

  assert.deepEqual(analyses[0].companyBrief.icSnapshot, []);
  assert.deepEqual(
    analyses[0].sources.map((source) =>
      "schemaVersion" in source ? source.text.status : "legacy_unverified"
    ).sort(),
    [
      "model_inference",
      "normalized_only",
    ],
    "unverified sources remain available as visibly classified lineage/context",
  );
});
