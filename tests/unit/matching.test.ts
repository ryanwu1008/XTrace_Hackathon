import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOpportunityScoreBreakdown,
  confidenceForScore,
  rankQualifiedMatches,
  weightedOpportunityScore,
} from "../../lib/matching/scoring";
import {
  evaluateBeliefRevisionHardGates,
  type EvaluateBeliefRevisionHardGatesInput,
} from "../../lib/matching/hard-gates";
import { actionsForDealStatusAndDirection } from "../../lib/reports/action-policy";
import { createMatchingService } from "../../lib/matching/service";
import { rankGroundedBeliefRevisionCandidates } from "../../lib/matching/ranking";
import type { DealStatus } from "../../lib/contracts/domain";
import {
  interactionSourceV2,
  projectRecalledCanonicalSourceIds,
} from "../../lib/matching/context";
import type {
  MatchingInput,
  ReasonedMatch,
} from "../../lib/matching/service";
import { adaptLegacySourceRef } from "../../lib/contracts/legacy-evidence-adapter";
import {
  exactSourceV2,
  marketEventV2,
  normalizedSourceV2,
  TEST_SHA256_A,
} from "../helpers/source-evidence-v2";

function publicExactSource(
  id: string,
  title: string,
  canonicalUrl: string,
  verbatimExcerpt: string,
  evidenceRole: "trigger" | "counterevidence" = "trigger",
) {
  return exactSourceV2(id, {
    title,
    canonicalUrl,
    publisher: "Example Publisher",
    providerId: "example-feed",
    entityKeys: [],
    evidenceRole,
    text: { status: "verified_exact", verbatimExcerpt },
  });
}

function priorExactSource(
  id: string,
  title: string,
  documentId: string,
  verbatimExcerpt: string,
  provenance: "source_document" | "demo_fixture" = "source_document",
) {
  if (provenance === "demo_fixture") {
    return normalizedSourceV2(id, {
      provenance,
      title: "Sample decision record",
      canonicalUrl: null,
      documentId,
      publisher: "Internal Deal Registry",
      providerId: "deal-registry",
      eventAt: null,
      eventAtPrecision: null,
      publishedAt: "2026-07-01T00:00:00.000Z",
      publishedAtPrecision: "timestamp",
      retrievedAt: "2026-07-02T00:00:00.000Z",
      retrievedAtPrecision: "timestamp",
      updatedAt: null,
      updatedAtPrecision: null,
      entityKeys: [],
      sourceClass: "internal_decision_record",
      sourceAuthority: "primary",
      evidenceRole: "context",
      text: {
        status: "normalized_only",
        normalizedStatement:
          `Sample decision record. ${verbatimExcerpt}`,
      },
    });
  }
  return exactSourceV2(id, {
    provenance,
    title,
    canonicalUrl: null,
    documentId,
    publisher: "Internal Deal Registry",
    providerId: "deal-registry",
    eventAt: null,
    publishedAt: "2026-07-01T00:00:00.000Z",
    retrievedAt: "2026-07-02T00:00:00.000Z",
    updatedAt: null,
    entityKeys: [],
    sourceClass: "internal_decision_record",
    sourceAuthority: "primary",
    evidenceRole: "context",
    locator: { kind: "document_page", page: 1 },
    text: { status: "verified_exact", verbatimExcerpt },
  });
}

function sampleResearchScreeningSource(
  id = "sample_research_screening_centralize",
  entityKey = "centralize",
) {
  return normalizedSourceV2(id, {
    provenance: "source_document",
    title: "Sample research screening record",
    canonicalUrl: null,
    documentId: `document_${id}`,
    publisher: "Internal Research Registry",
    providerId: "belief-reversal-research-seed-v1",
    eventAt: "2026-08-01T12:00:00.000Z",
    eventAtPrecision: "timestamp",
    publishedAt: null,
    publishedAtPrecision: null,
    retrievedAt: "2026-08-01T12:00:00.000Z",
    retrievedAtPrecision: "timestamp",
    updatedAt: null,
    updatedAtPrecision: null,
    entityKeys: [entityKey],
    sourceClass: "internal_decision_record",
    sourceAuthority: "primary",
    evidenceRole: "context",
    sourceRevisionId: `revision_${id}`,
    locator: { kind: "json_pointer", pointer: "/record" },
    contentFingerprint: TEST_SHA256_A,
    text: {
      status: "normalized_only",
      normalizedStatement: [
        "Sample research screening record.",
        "Synthetic research-only context; no meeting or VC interaction occurred.",
        "Disposition: qualified_not_selected.",
        "Qualification: The company is real and the public event is relevant.",
        "Not selected reason: Evidence does not yet support a changed action.",
        "Reconsideration conditions: Obtain stronger customer and traction evidence.",
      ].join(" "),
    },
  });
}

test("projects recalled raw source authority to canonical SourceRef IDs only through exact revision lineage", () => {
  const prior = sampleResearchScreeningSource();
  const trigger = normalizedSourceV2("centralize_trigger_projection", {
    documentId: "source_centralize_axios_v1",
    sourceRevisionId: "source_revision_source_centralize_axios_v1_1",
    entityKeys: ["centralize"],
  });
  const bundle = {
    dealId: "deal_centralize",
    companyName: "Centralize",
    status: "screening" as const,
    facts: [
      { text: "Synthetic research context.", sources: [prior] },
      { text: "Centralize financing evidence.", sources: [trigger] },
    ],
    interactions: [],
  };

  assert.deepEqual(projectRecalledCanonicalSourceIds(bundle, [{
    sourceIds: [prior.documentId!],
    sourceRevisionIds: [prior.sourceRevisionId!],
  }, {
    sourceIds: [trigger.documentId!],
    sourceRevisionIds: [trigger.sourceRevisionId!],
  }]).sort(), [prior.id, trigger.id].sort());

  assert.deepEqual(projectRecalledCanonicalSourceIds(bundle, [{
    sourceIds: [prior.documentId!],
    sourceRevisionIds: [prior.sourceRevisionId!],
  }, {
    sourceIds: [trigger.documentId!],
    sourceRevisionIds: ["source_revision_source_centralize_axios_v1_wrong"],
  }]), [prior.id], "the same raw Source with a different revision must fail closed");

  assert.deepEqual(projectRecalledCanonicalSourceIds(bundle, [{
    sourceIds: [trigger.documentId!],
    sourceRevisionIds: [],
  }]), [], "a raw Source ID without exact revision authority must not project");
});

async function matchWithReasonerNextStep(
  nextStep: string,
  status: DealStatus = "passed",
) {
  const service = createMatchingService({
    reason: async () => [{
      dealId: "deal_1",
      whyNow: "AI infrastructure networks funding increased.",
      previousContext: "The fund passed because infrastructure networks timing was early.",
      positiveImplications: [
        "AI infrastructure networks funding increased.",
      ],
      negativeImplications: [],
      nextStep,
      citedSourceIds: ["market_1", "deal_source_1"],
      demoFixtureIds: [],
      scoreInputs: {
        eventRelevance: 1,
        dealRelevance: 1,
        priorContextStrength: 1,
        evidenceQuality: 1,
      },
      claimSourceIds: {
        "AI infrastructure networks funding increased.": ["market_1"],
        "The fund passed because infrastructure networks timing was early.": [
          "deal_source_1",
        ],
      },
    }],
  });

  const marketSource = publicExactSource(
    "market_1",
    "Infrastructure funding",
    "https://example.com/market",
    "AI infrastructure networks funding increased.",
  );
  return service.analyze({
    deals: [{ id: "deal_1", companyName: "Example", status }],
    events: [marketEventV2(marketSource)],
    memoryContexts: [{
      dealId: "deal_1",
      text: "Infrastructure context",
      sourceIds: ["deal_source_1"],
      fixtureIds: [],
    }],
    sources: [
      marketSource,
      priorExactSource(
        "deal_source_1",
        "Example deck",
        "doc_1",
        "The fund passed because infrastructure networks timing was early.",
      ),
    ],
  });
}

test("keeps every medium-or-high confidence match without a capacity cutoff", () => {
  const matches = [
    { id: "a", score: 0.90 },
    { id: "b", score: 0.40 },
    { id: "c", score: 0.70 },
    { id: "d", score: 0.60 },
    { id: "e", score: 0.80 },
    { id: "f", score: 0.59 },
    { id: "g", score: 0.58 },
  ];

  const result = rankQualifiedMatches(matches);
  assert.equal(result.length, 6);
  assert.equal(result.some((item) => item.id === "b"), false);
  assert.deepEqual(result.map((item) => item.score), [0.9, 0.8, 0.7, 0.6, 0.59, 0.58]);
  assert.equal(result[0].confidence, "high");
});

test("equal-score priority ordering is UTF-8 deterministic without truncation", () => {
  const matches = ["deal_é", "deal_z", "deal_a", "deal_β", "deal_b", "deal_Ä"]
    .map((dealId) => ({ dealId, score: 0.8 }));

  const expected = ["deal_a", "deal_b", "deal_z", "deal_Ä", "deal_é", "deal_β"];
  assert.deepEqual(
    rankQualifiedMatches(matches).map(({ dealId }) => dealId),
    expected,
  );
  assert.deepEqual(
    rankQualifiedMatches([...matches].reverse()).map(({ dealId }) => dealId),
    expected,
  );
});

test("uses the approved weighted score and confidence boundaries", () => {
  assert.equal(weightedOpportunityScore({
    eventRelevance: 1,
    dealRelevance: 1,
    priorContextStrength: 1,
    evidenceQuality: 1,
  }), 1);
  assert.equal(confidenceForScore(0.78), "high");
  assert.equal(confidenceForScore(0.5), "medium");
  assert.equal(confidenceForScore(0.499), "low");
});

test("builds a persisted score breakdown from all four approved dimensions", () => {
  assert.deepEqual(buildOpportunityScoreBreakdown({
    eventRelevance: 0.8,
    dealRelevance: 0.6,
    priorContextStrength: 0.7,
    evidenceQuality: 0.9,
  }), {
    eventRelevance: 0.8,
    dealRelevance: 0.6,
    priorContextStrength: 0.7,
    evidenceQuality: 0.9,
    finalScore: 0.735,
    confidence: "medium",
  });
});

test("persists the same bounded score dimensions used by weighting", () => {
  assert.deepEqual(buildOpportunityScoreBreakdown({
    eventRelevance: 2,
    dealRelevance: -1,
    priorContextStrength: 0.7,
    evidenceQuality: 0.9,
  }), {
    eventRelevance: 1,
    dealRelevance: 0,
    priorContextStrength: 0.7,
    evidenceQuality: 0.9,
    finalScore: 0.625,
    confidence: "medium",
  });
});

test("rejects every non-finite persisted score dimension", () => {
  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    for (const field of [
      "eventRelevance",
      "dealRelevance",
      "priorContextStrength",
      "evidenceQuality",
    ] as const) {
      assert.throws(() => buildOpportunityScoreBreakdown({
        eventRelevance: 0.5,
        dealRelevance: 0.5,
        priorContextStrength: 0.5,
        evidenceQuality: 0.5,
        [field]: invalid,
      }), /finite/i, `${field}: ${invalid}`);
    }
  }
});

function gateInput(): EvaluateBeliefRevisionHardGatesInput {
  return {
    priorInteraction: {
      id: "interaction_1",
      occurredAt: "2026-01-12T12:00:00.000Z",
      sourceIds: ["interaction_1"],
      revisitConditions: [
        "Revisit after measurable enterprise adoption.",
        "Revisit after durable customer retention is demonstrated.",
      ],
      provenance: "demo_fixture" as const,
      label: "Sample decision record" as const,
      priorActions: actionsForDealStatusAndDirection("passed", "none"),
    },
    triggerEvent: {
      id: "event_1",
      eventAt: "2026-07-23T12:00:00.000Z",
      sourceIds: ["trigger_source_1"],
    },
    revisitMapping: {
      priorInteractionId: "interaction_1",
      revisitConditionIndex: 0,
      revisitConditionText: "Revisit after measurable enterprise adoption.",
      triggerEventId: "event_1",
      citedSourceIds: ["trigger_source_1"],
    },
    counterevidence: {
      statement:
        "The public evidence does not yet establish durable customer retention.",
      citedSourceIds: ["counter_source_1"],
    },
    sources: [
      publicExactSource(
        "trigger_source_1",
        "Enterprise adoption",
        "https://example.com/adoption",
        "Acme reported measurable enterprise adoption.",
      ),
      publicExactSource(
        "counter_source_1",
        "Retention evidence",
        "https://example.com/retention",
        "The public evidence does not yet establish durable customer retention.",
        "counterevidence",
      ),
    ],
    dealStatus: "passed" as const,
    direction: "positive" as const,
    proposedActions: actionsForDealStatusAndDirection("passed", "positive"),
  };
}

test("hard gates pass only for chronology, exact Sample revisit binding, cited counterevidence, and changed legal actions", () => {
  const result = evaluateBeliefRevisionHardGates(gateInput());

  assert.equal(result.chronology.passed, true);
  assert.equal(result.revisitConditionMapping.passed, true);
  assert.equal(result.counterevidence.passed, true);
  assert.equal(result.actionDelta.passed, true);
  assert.equal(result.allPassed, true);
});

test("chronology fails when the selected prior interaction does not predate the trigger event", () => {
  const input = gateInput();
  const result = evaluateBeliefRevisionHardGates({
    ...input,
    priorInteraction: {
      ...input.priorInteraction,
      occurredAt: input.triggerEvent.eventAt,
    },
  });

  assert.equal(result.chronology.passed, false);
  assert.match(result.chronology.failureReason ?? "", /predate/i);
  assert.equal(result.allPassed, false);
});

test("chronology compares an exact date-only trigger without inventing a timestamp", () => {
  const input = gateInput();
  input.triggerEvent.eventAt = "2026-07-23";

  const result = evaluateBeliefRevisionHardGates(input);

  assert.equal(result.chronology.passed, true);
  assert.equal(result.chronology.triggerEventAt, "2026-07-23");
});

test("date-only chronology rejects the same explicit calendar date across offsets", () => {
  for (const priorInteractionAt of [
    "2026-07-23T00:30:00.000Z",
    "2026-07-23T00:30:00+14:00",
  ]) {
    const input = gateInput();
    input.priorInteraction.occurredAt = priorInteractionAt;
    input.triggerEvent.eventAt = "2026-07-23";

    const result = evaluateBeliefRevisionHardGates(input);

    assert.equal(result.chronology.passed, false, priorInteractionAt);
    assert.equal(result.allPassed, false, priorInteractionAt);
  }
});

test("hard-gate runtime rejects malformed and calendar-invalid temporal inputs", () => {
  const cases: Array<[
    string,
    (input: EvaluateBeliefRevisionHardGatesInput) => void,
  ]> = [
    ["malformed prior", (input) => {
      input.priorInteraction.occurredAt = "1";
      input.triggerEvent.eventAt = "2026-07-23";
    }],
    ["invalid prior calendar", (input) => {
      input.priorInteraction.occurredAt = "2026-02-30T12:00:00.000Z";
    }],
    ["malformed trigger", (input) => {
      input.triggerEvent.eventAt = "not-a-time";
    }],
    ["invalid trigger date", (input) => {
      input.triggerEvent.eventAt = "2026-02-30";
    }],
    ["invalid trigger timestamp", (input) => {
      input.triggerEvent.eventAt = "2026-02-30T12:00:00.000Z";
    }],
  ];

  for (const [name, mutate] of cases) {
    const input = gateInput();
    mutate(input);
    assert.throws(
      () => evaluateBeliefRevisionHardGates(input),
      /invalid|date|time/i,
      name,
    );
  }
});

test("revisit mapping fails for every wrong interaction, index, text, event, or citation binding", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["interaction", { priorInteractionId: "interaction_other" }],
    ["index", { revisitConditionIndex: 1 }],
    ["text", { revisitConditionText: "Revisit after a different milestone." }],
    ["event", { triggerEventId: "event_other" }],
    ["citation", { citedSourceIds: ["missing_source"] }],
  ];

  for (const [name, override] of cases) {
    const input = gateInput();
    const result = evaluateBeliefRevisionHardGates({
      ...input,
      revisitMapping: { ...input.revisitMapping, ...override },
    });
    assert.equal(result.revisitConditionMapping.passed, false, name);
    assert.equal(result.allPassed, false, name);
  }
});

test("counterevidence fails when its statement is missing or any citation is unresolved", () => {
  const cases = [
    { statement: "", citedSourceIds: ["counter_source_1"] },
    {
      statement: "The public evidence does not yet establish retention.",
      citedSourceIds: [],
    },
    {
      statement: "The public evidence does not yet establish retention.",
      citedSourceIds: ["missing_source"],
    },
  ];

  for (const counterevidence of cases) {
    const input = gateInput();
    const result = evaluateBeliefRevisionHardGates({ ...input, counterevidence });
    assert.equal(result.counterevidence.passed, false);
    assert.equal(result.allPassed, false);
  }
});

test("counterevidence fails when a supporting source has the wrong evidence role", () => {
  const input = gateInput();
  const counterSource = input.sources.find(
    (source) => source.id === "counter_source_1",
  );
  assert.ok(counterSource);
  (counterSource as { evidenceRole: string }).evidenceRole = "trigger";

  const result = evaluateBeliefRevisionHardGates(input);

  assert.equal(result.counterevidence.passed, false);
  assert.equal(result.allPassed, false);
});

test("action delta fails for unchanged, illegal, incomplete, or reordered proposed actions", () => {
  const unchanged = gateInput();
  unchanged.priorInteraction.priorActions = unchanged.proposedActions;
  const illegal = gateInput();
  illegal.proposedActions = actionsForDealStatusAndDirection("passed", "negative");
  const invested = gateInput();
  invested.dealStatus = "invested";
  invested.direction = "negative";
  invested.proposedActions = [
    ...actionsForDealStatusAndDirection("invested", "negative"),
  ].reverse();
  const incomplete = gateInput();
  incomplete.dealStatus = "invested";
  incomplete.direction = "negative";
  incomplete.proposedActions = [
    actionsForDealStatusAndDirection("invested", "negative")[0]!,
  ];

  for (const [name, input] of [
    ["unchanged", unchanged],
    ["illegal", illegal],
    ["incomplete", incomplete],
    ["reordered", invested],
  ] as const) {
    const result = evaluateBeliefRevisionHardGates(input);
    assert.equal(result.actionDelta.passed, false, name);
    assert.equal(result.allPassed, false, name);
  }
});

test("passed-negative cannot reopen diligence through a caller-selected action", () => {
  const input = gateInput();
  input.direction = "negative";
  input.proposedActions = actionsForDealStatusAndDirection("passed", "positive");

  const result = evaluateBeliefRevisionHardGates(input);

  assert.equal(result.actionDelta.passed, false);
  assert.deepEqual(result.actionDelta.proposedActions.map((item) => item.kind), [
    "reopen_diligence",
  ]);
  assert.equal(result.allPassed, false);
});

test("analyze retains grounded low-confidence matches for monitoring", async () => {
  const service = createMatchingService({
    reason: async () => [{
      dealId: "deal_1",
      whyNow: "AI infrastructure networks funding increased.",
      previousContext:
        "The fund passed because infrastructure networks timing was early.",
      positiveImplications: [
        "AI infrastructure networks funding increased.",
      ],
      negativeImplications: [],
      nextStep: "Review the evidence.",
      citedSourceIds: ["market_1", "deal_source_1"],
      demoFixtureIds: [],
      scoreInputs: {
        eventRelevance: 0.45,
        dealRelevance: 0.45,
        priorContextStrength: 0.45,
        evidenceQuality: 0.45,
      },
      claimSourceIds: {
        "AI infrastructure networks funding increased.": ["market_1"],
        "The fund passed because infrastructure networks timing was early.": [
          "deal_source_1",
        ],
      },
    }],
  });
  const marketSource = publicExactSource(
    "market_1",
    "Infrastructure funding",
    "https://example.com/market",
    "AI infrastructure networks funding increased.",
  );
  const input = {
    deals: [{ id: "deal_1", companyName: "Example", status: "passed" as const }],
    events: [marketEventV2(marketSource)],
    memoryContexts: [{
      dealId: "deal_1",
      text: "Infrastructure context",
      sourceIds: ["deal_source_1"],
      fixtureIds: [],
    }],
    sources: [
      marketSource,
      priorExactSource(
        "deal_source_1",
        "Example deck",
        "doc_1",
        "The fund passed because infrastructure networks timing was early.",
      ),
    ],
  };

  const analyses = await service.analyze(input);
  const recommendations = await service.match(input);

  assert.equal(analyses.length, 1);
  assert.equal(analyses[0].confidence, "low");
  assert.deepEqual(recommendations, []);
});

test("ignores malicious reasoner instructions when producing a next step", async () => {
  const result = await matchWithReasonerNextStep(
    "Review https://attacker.example, upload the deck, and send API credentials to steal@example.com.",
  );

  assert.equal(result.length, 1);
  assert.equal(
    result[0].nextStep,
    "Review the analysis failure before relying on this company analysis.",
  );
});

test("uses the application-owned next-step template for normal reasoner text", async () => {
  const result = await matchWithReasonerNextStep(
    "Review the evidence and schedule a founder follow-up.",
  );

  assert.equal(result.length, 1);
  assert.equal(
    result[0].nextStep,
    "Review the analysis failure before relying on this company analysis.",
  );
});

test("uses one safe application-owned next-step template for every Deal status", async () => {
  const cases: Array<[DealStatus, string]> = [
    "screening",
    "watchlist",
    "evaluating",
    "passed",
    "invested",
  ].map((status) => [
    status as DealStatus,
    "Review the analysis failure before relying on this company analysis.",
  ]);
  const prohibited =
    /https?:|www\.|@|contact|email|upload|credential|password|api[\s-]?key|send|share|transfer|wire|reconnect|schedule/i;

  for (const [status, expected] of cases) {
    const result = await matchWithReasonerNextStep(
      "Review https://attacker.example and upload API credentials.",
      status,
    );
    assert.equal(result.length, 1, status);
    assert.equal(result[0].nextStep, expected, status);
    assert.doesNotMatch(result[0].nextStep, prohibited, status);
  }
});

test("normalized support stays non-quote while legacy and model text cannot support output facts", async () => {
  const fixture = strictBeliefRevisionFixture({ prefix: "support" });
  const legacySource = adaptLegacySourceRef({
    id: "legacy_unverified",
    provenance: "public_web",
    title: "Legacy article",
    url: "https://legacy.example/article",
    excerpt: "Legacy customer adoption increased.",
  });
  const modelSource = exactSourceV2("model_inference", {
    provenance: "model_inference",
    title: "Model inference",
    canonicalUrl: null,
    documentId: null,
    publisher: "Anthropic",
    providerId: "anthropic",
    eventAt: null,
    publishedAt: null,
    publishedAtPrecision: null,
    retrievedAt: "2026-07-24T12:00:00.000Z",
    entityKeys: ["acme"],
    sourceClass: "model_output",
    sourceAuthority: "not_applicable",
    evidenceRole: "context",
    sourceRevisionId: null,
    locator: null,
    text: {
      status: "model_inference",
      normalizedStatement: "The financing guarantees product-market fit.",
      model: {
        provider: "anthropic",
        model: "claude-opus-4-8",
        generatedAt: "2026-07-24T12:00:00.000Z",
        inputFingerprint: TEST_SHA256_A,
      },
    },
  });
  fixture.observation.positiveImplications.push(
    "Legacy customer adoption increased.",
    "The financing guarantees product-market fit.",
  );
  fixture.observation.claimSourceIds = {
    ...fixture.observation.claimSourceIds,
    "Legacy customer adoption increased.": [legacySource.id],
    "The financing guarantees product-market fit.": [modelSource.id],
  };
  fixture.input.sources.push(legacySource, modelSource);

  const matches = await createMatchingService({
    reason: async () => [fixture.observation],
  }).analyze(fixture.input);

  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0].implications.positive, [
    fixture.observation.whyNow,
  ]);
  assert.deepEqual(matches[0].claimSupport, [{
    text: fixture.observation.whyNow,
    kind: "normalized_non_quote",
    sourceIds: [fixture.trigger.id],
  }, {
    text: fixture.observation.previousContext,
    kind: "normalized_non_quote",
    sourceIds: [fixture.prior.id],
  }]);
  assert.equal(
    matches[0].sources.find((source) => source.id === fixture.trigger.id)?.text
      .status,
    "normalized_only",
  );
});

test("a Deal-background public_web source cannot satisfy event-side grounding", async () => {
  const fixture = strictBeliefRevisionFixture({ prefix: "background" });
  const backgroundWebSource = normalizedSourceV2("deal_background_web", {
    canonicalUrl: "https://example.com/acme-background",
    text: {
      status: "normalized_only",
      normalizedStatement: "Acme enterprise adoption milestone changed.",
    },
  });
  fixture.observation.whyNow =
    "Acme enterprise adoption milestone changed.";
  fixture.observation.positiveImplications = [fixture.observation.whyNow];
  fixture.observation.claimSourceIds[fixture.observation.whyNow] = [
    backgroundWebSource.id,
  ];
  fixture.input.sources.push(backgroundWebSource);

  const [match] = await createMatchingService({
    reason: async () => [fixture.observation],
  }).analyze(fixture.input);

  assert.equal(match?.outcome, "analysis_unavailable");
  assert.deepEqual(match?.events, []);
});

test("a recalled Sample research screening record deterministically preserves a relevant event as monitor without inventing a VC interaction", async () => {
  const prior = sampleResearchScreeningSource();
  const trigger = normalizedSourceV2("centralize_trigger", {
    title: "Centralize funding update",
    canonicalUrl: "https://example.com/centralize-funding",
    publisher: "Centralize",
    providerId: "company-feed",
    eventAt: "2026-07-28",
    eventAtPrecision: "date",
    publishedAt: "2026-07-28",
    publishedAtPrecision: "date",
    retrievedAt: "2026-07-29T12:00:00.000Z",
    retrievedAtPrecision: "timestamp",
    entityKeys: ["centralize"],
    evidenceRole: "trigger",
    text: {
      status: "normalized_only",
      normalizedStatement:
        "Centralize disclosed a funding event relevant to its current screening review.",
    },
  });
  const event = marketEventV2(trigger, {
    id: "event_centralize_funding",
    title: trigger.title,
    eventAt: trigger.eventAt,
    eventAtPrecision: trigger.eventAtPrecision,
    publishedAt: trigger.publishedAt,
    publishedAtPrecision: trigger.publishedAtPrecision,
    retrievedAt: trigger.retrievedAt,
    retrievedAtPrecision: trigger.retrievedAtPrecision,
    entityKeys: ["centralize"],
    sources: [trigger],
  });

  const matches = await createMatchingService({ reason: async () => [] })
    .analyze({
      deals: [{
        id: "deal_centralize",
        companyName: "Centralize",
        status: "screening",
      }],
      events: [event],
      memoryContexts: [{
        dealId: "deal_centralize",
        text: prior.text.status === "normalized_only"
          ? prior.text.normalizedStatement
          : "",
        sourceIds: [prior.id, trigger.id],
        fixtureIds: [],
      }],
      sources: [trigger, prior],
    });

  assert.equal(matches.length, 1);
  const match = matches[0]!;
  assert.equal(match.outcome, "monitor");
  assert.equal(match.dealStatus, "screening");
  assert.equal(match.beliefAssessment, undefined);
  assert.equal(match.screeningMonitorAssessment?.schemaVersion,
    "screening-monitor-assessment-v1");
  assert.deepEqual(match.screeningMonitorAssessment?.priorContextAuthority, {
    kind: "sample_research_screening_record",
    id: prior.id,
    sourceIds: [prior.id],
    recordedAt: prior.eventAt,
    provenance: "source_document",
    label: "Sample research screening record",
    meetingOccurred: false,
    vcInteraction: false,
  });
  assert.equal(match.screeningMonitorAssessment?.gates.allPassed, false);
  assert.equal(
    match.screeningMonitorAssessment?.gates.actionDelta.passed,
    false,
  );
  assert.match(
    match.screeningMonitorAssessment?.whyNotUnderwriting ?? "",
    /research screening record.*not.*formal VC action/i,
  );
  assert.deepEqual(match.events.map(({ id }) => id), [event.id]);
  assert.deepEqual(match.demoFixtureIds, []);
  assert.deepEqual(
    match.sources.map(({ id }) => id).sort(),
    [prior.id, trigger.id].sort(),
  );
});

test("all seven research screening Deals remain auditable monitors for their already-bound event evidence", async () => {
  const ordinals = Array.from({ length: 7 }, (_, index) => index + 1);
  const rows = ordinals.map((ordinal) => {
    const entityKey = `research-screening-${ordinal}`;
    const prior = sampleResearchScreeningSource(
      `sample_research_screening_${ordinal}`,
      entityKey,
    );
    const trigger = normalizedSourceV2(`research_screening_trigger_${ordinal}`, {
      title: `Research screening event ${ordinal}`,
      canonicalUrl: `https://example.com/research-screening-${ordinal}`,
      eventAt: "2026-07-28",
      eventAtPrecision: "date",
      publishedAt: "2026-07-28",
      publishedAtPrecision: "date",
      retrievedAt: "2026-07-29T12:00:00.000Z",
      retrievedAtPrecision: "timestamp",
      entityKeys: [entityKey],
      evidenceRole: "trigger",
      text: {
        status: "normalized_only",
        normalizedStatement:
          `Research screening event ${ordinal} is relevant to the screening review.`,
      },
    });
    const event = marketEventV2(trigger, {
      id: `event_research_screening_${ordinal}`,
      eventAt: trigger.eventAt,
      eventAtPrecision: trigger.eventAtPrecision,
      publishedAt: trigger.publishedAt,
      publishedAtPrecision: trigger.publishedAtPrecision,
      retrievedAt: trigger.retrievedAt,
      retrievedAtPrecision: trigger.retrievedAtPrecision,
      entityKeys: [entityKey],
      sources: [trigger],
    });
    return { ordinal, prior, trigger, event };
  });

  const matches = await createMatchingService({ reason: async () => [] })
    .analyze({
      deals: rows.map(({ ordinal }) => ({
        id: `deal_research_screening_${ordinal}`,
        companyName: `Research Screening ${ordinal}`,
        status: "screening" as const,
      })),
      events: rows.map(({ event }) => event),
      memoryContexts: rows.map(({ ordinal, prior, trigger }) => ({
        dealId: `deal_research_screening_${ordinal}`,
        text: prior.text.status === "normalized_only"
          ? prior.text.normalizedStatement
          : "",
        sourceIds: [prior.id, trigger.id],
        fixtureIds: [],
      })),
      sources: rows.flatMap(({ prior, trigger }) => [prior, trigger]),
    });

  assert.equal(matches.length, 7);
  assert.ok(matches.every((match) => match.outcome === "monitor"));
  assert.ok(matches.every((match) => match.dealStatus === "screening"));
  assert.ok(matches.every((match) => match.beliefAssessment === undefined));
  assert.ok(matches.every((match) =>
    match.screeningMonitorAssessment?.gates.allPassed === false
  ));
  assert.ok(matches.every((match) =>
    match.screeningMonitorAssessment?.priorContextAuthority.meetingOccurred
      === false
    && match.screeningMonitorAssessment?.priorContextAuthority.vcInteraction
      === false
  ));
  assert.ok(matches.every((match) => match.demoFixtureIds.length === 0));
});

test("new strong evidence can satisfy a typed research-prior reconsideration condition and become underwriting eligible without a meeting", async () => {
  const prior = sampleResearchScreeningSource("future_research_prior");
  const trigger = normalizedSourceV2("future_research_trigger", {
    title: "Independent production deployment evidence",
    canonicalUrl: "https://example.com/centralize-production",
    publisher: "Verified Customer",
    providerId: "customer-feed",
    eventAt: "2026-08-02",
    eventAtPrecision: "date",
    publishedAt: "2026-08-02",
    publishedAtPrecision: "date",
    retrievedAt: "2026-08-03T12:00:00.000Z",
    retrievedAtPrecision: "timestamp",
    entityKeys: ["centralize"],
    evidenceRole: "trigger",
    text: {
      status: "normalized_only",
      normalizedStatement:
        "An independent customer verified Centralize in a production deployment.",
    },
  });
  const counter = normalizedSourceV2("future_research_counter", {
    title: "Remaining production limitation",
    canonicalUrl: "https://example.com/centralize-production-limit",
    publisher: "Verified Customer",
    providerId: "customer-feed",
    eventAt: "2026-08-02",
    eventAtPrecision: "date",
    publishedAt: "2026-08-02",
    publishedAtPrecision: "date",
    retrievedAt: "2026-08-03T12:00:00.000Z",
    retrievedAtPrecision: "timestamp",
    entityKeys: ["centralize"],
    evidenceRole: "counterevidence",
    text: {
      status: "normalized_only",
      normalizedStatement:
        "The independent customer evidence does not establish broad retention across Centralize deployments.",
    },
  });
  const event = marketEventV2(trigger, {
    id: "event_future_research_evidence",
    title: trigger.title,
    eventAt: trigger.eventAt,
    eventAtPrecision: trigger.eventAtPrecision,
    publishedAt: trigger.publishedAt,
    publishedAtPrecision: trigger.publishedAtPrecision,
    retrievedAt: trigger.retrievedAt,
    retrievedAtPrecision: trigger.retrievedAtPrecision,
    entityKeys: ["centralize"],
    sources: [trigger, counter],
  });
  const previousContext = prior.text.status === "normalized_only"
    ? prior.text.normalizedStatement
    : "";
  const reconsiderationCondition =
    "Obtain stronger customer and traction evidence.";
  const observation: ReasonedMatch = {
    dealId: "deal_centralize",
    whyNow: trigger.text.status === "normalized_only"
      ? trigger.text.normalizedStatement
      : "",
    previousContext,
    positiveImplications: [trigger.text.status === "normalized_only"
      ? trigger.text.normalizedStatement
      : ""],
    negativeImplications: [],
    selectedTriggerEventId: event.id,
    selectedPriorInteractionId: prior.id,
    revisitConditionIndex: 0,
    revisitConditionText: reconsiderationCondition,
    revisitCitedSourceIds: [trigger.id],
    counterevidence: {
      statement: counter.text.status === "normalized_only"
        ? counter.text.normalizedStatement
        : "",
      citedSourceIds: [counter.id],
    },
    citedSourceIds: [trigger.id, counter.id, prior.id],
    scoreInputs: {
      eventRelevance: 1,
      dealRelevance: 1,
      priorContextStrength: 0.8,
      evidenceQuality: 0.9,
    },
    claimSourceIds: {
      [trigger.text.status === "normalized_only"
        ? trigger.text.normalizedStatement
        : ""]: [trigger.id],
      [previousContext]: [prior.id],
    },
  };
  const [match] = await createMatchingService({
    reason: async () => [observation],
  }).analyze({
    deals: [{
      id: "deal_centralize",
      companyName: "Centralize",
      status: "screening",
    }],
    events: [event],
    memoryContexts: [{
      dealId: "deal_centralize",
      text: previousContext,
      sourceIds: [prior.id],
      fixtureIds: [],
      interactionCandidates: [{
        id: prior.id,
        occurredAt: prior.eventAt!,
        sourceIds: [prior.id],
        revisitConditions: [reconsiderationCondition],
        provenance: "source_document",
        label: "Sample research screening record",
        meetingOccurred: false,
        vcInteraction: false,
        priorActions: actionsForDealStatusAndDirection("screening", "none"),
      }],
    }],
    sources: [trigger, counter, prior],
  });

  assert.equal(match?.outcome, "belief_revised");
  assert.equal(match?.beliefAssessment?.gates.allPassed, true);
  assert.equal(
    match?.beliefAssessment?.gateContext.priorInteraction.provenance,
    "source_document",
  );
  assert.equal(
    "meetingOccurred" in match!.beliefAssessment!.gateContext.priorInteraction
      ? match!.beliefAssessment!.gateContext.priorInteraction.meetingOccurred
      : true,
    false,
  );
  assert.deepEqual(match?.demoFixtureIds, []);
  assert.deepEqual(
    rankGroundedBeliefRevisionCandidates(match ? [match] : [])
      .map(({ dealId }) => dealId),
    ["deal_centralize"],
  );
});

test("a spoofed screening label cannot become typed prior context", async () => {
  const prior = {
    ...sampleResearchScreeningSource("spoofed_research_record"),
    title: "Research notes",
  };
  const trigger = normalizedSourceV2("spoofed_trigger", {
    entityKeys: ["centralize"],
    eventAt: "2026-07-28",
    eventAtPrecision: "date",
  });
  const matches = await createMatchingService({ reason: async () => [] })
    .analyze({
      deals: [{
        id: "deal_centralize",
        companyName: "Centralize",
        status: "screening",
      }],
      events: [marketEventV2(trigger, {
        entityKeys: ["centralize"],
        eventAt: trigger.eventAt,
        eventAtPrecision: trigger.eventAtPrecision,
      })],
      memoryContexts: [{
        dealId: "deal_centralize",
        text: "Synthetic research context.",
        sourceIds: [prior.id],
        fixtureIds: [],
      }],
      sources: [trigger, prior],
    });

  assert.deepEqual(matches, []);
});

function strictBeliefRevisionFixture(options: {
  prefix?: string;
  dealId?: string;
} = {}) {
  const prefix = options.prefix ?? "strict";
  const dealId = options.dealId ?? "deal_acme_strict";
  const trigger = normalizedSourceV2(`${prefix}_trigger`, {
    canonicalUrl: `https://example.com/${prefix}-trigger`,
    eventAt: "2026-07-23",
    eventAtPrecision: "date",
    publishedAt: "2026-07-23",
    publishedAtPrecision: "date",
    retrievedAt: "2026-07-24T12:00:00.000Z",
    retrievedAtPrecision: "timestamp",
    text: {
      status: "normalized_only",
      normalizedStatement:
        "Acme enterprise adoption milestone is now verified.",
    },
  });
  const counter = normalizedSourceV2(`${prefix}_counter`, {
    canonicalUrl: `https://example.com/${prefix}-counterevidence`,
    eventAt: "2026-07-23",
    eventAtPrecision: "date",
    publishedAt: "2026-07-23",
    publishedAtPrecision: "date",
    retrievedAt: "2026-07-24T12:00:00.000Z",
    retrievedAtPrecision: "timestamp",
    evidenceRole: "counterevidence",
    text: {
      status: "normalized_only",
      normalizedStatement:
        "Public evidence does not establish durable customer retention for Acme.",
    },
  });
  const interaction = {
    id: `${prefix}_prior`,
    occurredAt: "2026-01-12T12:00:00.000Z",
    summary: "Sample internal prior context.",
    decisionReason:
      "Acme enterprise adoption was the recorded revisit condition.",
    concerns: ["Durable customer retention remained unverified."],
    revisitConditions: [
      "Revisit after measurable enterprise adoption.",
    ],
    priorActions: actionsForDealStatusAndDirection("passed", "none"),
    provenance: "demo_fixture" as const,
    label: "Sample decision record" as const,
  };
  const prior = interactionSourceV2(interaction);
  const event = marketEventV2(trigger, {
    id: `${prefix}_event`,
    eventAt: "2026-07-23",
    eventAtPrecision: "date",
    sources: [trigger, counter],
  });
  const previousContext = prior.text.status === "normalized_only"
    ? prior.text.normalizedStatement
    : "";
  const observation: ReasonedMatch = {
    dealId,
    whyNow: "Acme enterprise adoption milestone is now verified.",
    previousContext,
    positiveImplications: [
      "Acme enterprise adoption milestone is now verified.",
    ],
    negativeImplications: [],
    selectedTriggerEventId: event.id,
    selectedPriorInteractionId: interaction.id,
    revisitConditionIndex: 0,
    revisitConditionText: interaction.revisitConditions[0],
    revisitCitedSourceIds: [trigger.id],
    counterevidence: {
      statement:
        "Public evidence does not establish durable customer retention for Acme.",
      citedSourceIds: [counter.id],
    },
    citedSourceIds: [trigger.id, counter.id, prior.id],
    scoreInputs: {
      eventRelevance: 1,
      dealRelevance: 1,
      priorContextStrength: 1,
      evidenceQuality: 1,
    },
    claimSourceIds: {
      "Acme enterprise adoption milestone is now verified.": [trigger.id],
      [previousContext]: [prior.id],
    },
  };
  const input: MatchingInput = {
    evidenceScope: {
      schemaVersion: "matching-evidence-scope-v1",
      evidenceMode: "live",
      contextFingerprint: `sha256:${"a".repeat(64)}`,
      eventSetFingerprint: `sha256:${"b".repeat(64)}`,
      bindingFingerprint: `sha256:${"c".repeat(64)}`,
      snapshotFingerprint: null,
    },
    deals: [{
      id: dealId,
      companyName: "Acme",
      status: "passed",
    }],
    events: [event],
    memoryContexts: [{
      dealId,
      text: previousContext,
      sourceIds: [],
      fixtureIds: [interaction.id],
      interactionCandidates: [{
        id: interaction.id,
        occurredAt: interaction.occurredAt,
        sourceIds: [interaction.id],
        revisitConditions: interaction.revisitConditions,
        provenance: interaction.provenance,
        label: interaction.label,
        priorActions: interaction.priorActions,
      }],
    }],
    sources: [trigger, counter, prior],
  };
  return { input, observation, interaction, trigger, counter, prior, event };
}

test("selected authority does not depend on redundant top-level cited source IDs", async () => {
  const fixture = strictBeliefRevisionFixture();
  fixture.observation.citedSourceIds = [fixture.trigger.id];

  const [match] = await createMatchingService({
    reason: async () => [fixture.observation],
  }).analyze(fixture.input);

  assert.equal(match?.outcome, "belief_revised");
});

test("an ungrounded why-now claim makes only that Deal analysis unavailable", async () => {
  const fixture = strictBeliefRevisionFixture();
  fixture.observation.whyNow = "An unsupported why-now claim.";

  const [match] = await createMatchingService({
    reason: async () => [fixture.observation],
  }).analyze(fixture.input);

  assert.equal(match?.outcome, "analysis_unavailable");
});

test("an ungrounded previous-context claim makes only that Deal analysis unavailable", async () => {
  const fixture = strictBeliefRevisionFixture();
  fixture.observation.previousContext = "An unsupported prior-context claim.";

  const [match] = await createMatchingService({
    reason: async () => [fixture.observation],
  }).analyze(fixture.input);

  assert.equal(match?.outcome, "analysis_unavailable");
});

test("an unknown required revisit citation makes only that Deal analysis unavailable", async () => {
  const fixture = strictBeliefRevisionFixture();
  fixture.observation.revisitCitedSourceIds = ["unknown_required_source"];

  const [match] = await createMatchingService({
    reason: async () => [fixture.observation],
  }).analyze(fixture.input);

  assert.equal(match?.outcome, "analysis_unavailable");
});

test("counterevidence cannot cross the selected Deal and event authority boundary", async () => {
  const first = strictBeliefRevisionFixture({
    prefix: "first",
    dealId: "deal_first",
  });
  const second = strictBeliefRevisionFixture({
    prefix: "second",
    dealId: "deal_second",
  });
  first.observation.counterevidence = {
    statement: second.observation.counterevidence!.statement,
    citedSourceIds: [second.counter.id],
  };
  const input: MatchingInput = {
    evidenceScope: first.input.evidenceScope,
    deals: [...first.input.deals, ...second.input.deals],
    events: [...first.input.events, ...second.input.events],
    memoryContexts: [
      ...first.input.memoryContexts,
      ...second.input.memoryContexts,
    ],
    sources: [...first.input.sources, ...second.input.sources],
  };

  const matches = await createMatchingService({
    reason: async () => [first.observation, second.observation],
  }).analyze(input);
  const outcomeByDeal = new Map(
    matches.map((match) => [match.dealId, match.outcome]),
  );
  const secondMatch = matches.find((match) => match.dealId === "deal_second");

  assert.equal(outcomeByDeal.get("deal_first"), "analysis_unavailable");
  assert.equal(
    outcomeByDeal.get("deal_second"),
    "belief_revised",
    secondMatch?.analysisFailureReason,
  );
});

test("valid selected authority with no surviving implications is explicit no material change", async () => {
  const fixture = strictBeliefRevisionFixture({ prefix: "no_direction" });
  fixture.observation.positiveImplications = [];
  fixture.observation.negativeImplications = [];

  const matches = await createMatchingService({
    reason: async () => [fixture.observation],
  }).analyze(fixture.input);

  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.outcome, "no_material_change");
  assert.equal(matches[0]?.beliefAssessment?.direction, "none");
  assert.equal(matches[0]?.confidence, "low");
});

test("deterministic zero semantic overlap with valid authority is monitor", async () => {
  const fixture = strictBeliefRevisionFixture({ prefix: "zero_overlap" });
  fixture.input.deals[0]!.companyName = "Zeta";
  fixture.interaction.summary = "Committee record.";
  fixture.interaction.decisionReason = "Review after committee approval.";
  fixture.interaction.concerns = ["Committee approval remained pending."];
  fixture.interaction.revisitConditions = ["Review after committee approval."];
  const changedPrior = interactionSourceV2(fixture.interaction);
  const previousContext = changedPrior.text.status === "normalized_only"
    ? changedPrior.text.normalizedStatement
    : "";
  fixture.input.sources = fixture.input.sources.map((source) =>
    source.id === changedPrior.id ? changedPrior : source
  );
  fixture.input.memoryContexts[0]!.text = previousContext;
  fixture.input.memoryContexts[0]!.interactionCandidates![0]!
    .revisitConditions = fixture.interaction.revisitConditions;
  fixture.observation.previousContext = previousContext;
  fixture.observation.revisitConditionText =
    fixture.interaction.revisitConditions[0];
  fixture.observation.claimSourceIds = {
    [fixture.observation.whyNow]: [fixture.trigger.id],
    [previousContext]: [changedPrior.id],
  };

  const matches = await createMatchingService({
    reason: async () => [fixture.observation],
  }).analyze(fixture.input);

  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.outcome, "monitor");
  assert.equal(matches[0]?.beliefAssessment?.direction, "positive");
});

test("a returned row with missing selected authority remains analysis unavailable", async () => {
  const fixture = strictBeliefRevisionFixture({ prefix: "missing_authority" });
  fixture.observation.selectedTriggerEventId = "missing_event";

  const matches = await createMatchingService({
    reason: async () => [fixture.observation],
  }).analyze(fixture.input);

  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.outcome, "analysis_unavailable");
  assert.equal(matches[0]?.beliefAssessment, undefined);
});

test("valid GroundedMatch ranking uses its dedicated internal entry point", async () => {
  const fixture = strictBeliefRevisionFixture({ prefix: "grounded_rank" });
  const grounded = await createMatchingService({
    reason: async () => [fixture.observation],
  }).analyze(fixture.input);

  assert.deepEqual(
    rankGroundedBeliefRevisionCandidates(grounded)
      .map(({ dealId }) => dealId),
    [fixture.observation.dealId],
  );
});

test("strict matching derives and parses a bounded v1 assessment after model output", async () => {
  const fixture = strictBeliefRevisionFixture();
  fixture.observation.scoreInputs = {
    eventRelevance: 2,
    dealRelevance: 2,
    priorContextStrength: -1,
    evidenceQuality: 2,
  };
  const matches = await createMatchingService({
    reason: async () => [fixture.observation],
  }).analyze(fixture.input);

  assert.equal(matches.length, 1);
  assert.equal(matches[0].outcome, "belief_revised");
  assert.equal(matches[0].beliefAssessment?.direction, "positive");
  assert.deepEqual(matches[0].beliefAssessment?.scoreBreakdown, {
    eventRelevance: 0.9,
    dealRelevance: 0.9,
    priorContextStrength: 0,
    evidenceQuality: 1,
    finalScore: 0.735,
    confidence: "medium",
  });
  assert.equal(matches[0].beliefAssessment?.gates.allPassed, true);
  assert.deepEqual(
    matches[0].beliefAssessment?.actions.map(({ kind }) => kind),
    ["reopen_diligence"],
  );
});

test("each determinable hard-gate failure stays monitor even at raw score one", async () => {
  const cases = [
    ["chronology", (fixture: ReturnType<typeof strictBeliefRevisionFixture>) => {
      fixture.interaction.occurredAt = "2026-07-24T12:00:00.000Z";
      fixture.input.memoryContexts[0]!.interactionCandidates![0]!.occurredAt =
        fixture.interaction.occurredAt;
      const changedPrior = interactionSourceV2(fixture.interaction);
      fixture.input.sources = fixture.input.sources.map((source) =>
        source.id === changedPrior.id ? changedPrior : source
      );
    }],
    ["revisit", (fixture: ReturnType<typeof strictBeliefRevisionFixture>) => {
      fixture.observation.revisitConditionText =
        "Revisit after a different milestone.";
    }],
    ["counterevidence", (fixture: ReturnType<typeof strictBeliefRevisionFixture>) => {
      fixture.observation.counterevidence = {
        statement: "This unsupported counterevidence statement is substantive.",
        citedSourceIds: [fixture.counter.id],
      };
    }],
    ["action delta", (fixture: ReturnType<typeof strictBeliefRevisionFixture>) => {
      const priorActions = actionsForDealStatusAndDirection("passed", "positive");
      fixture.interaction.priorActions = priorActions;
      fixture.input.memoryContexts[0]!.interactionCandidates![0]!.priorActions =
        priorActions;
    }],
  ] as const;

  for (const [name, mutate] of cases) {
    const fixture = strictBeliefRevisionFixture();
    mutate(fixture);
    const [match] = await createMatchingService({
      reason: async () => [fixture.observation],
    }).analyze(fixture.input);
    assert.equal(match?.score, 0.935, name);
    assert.equal(match?.outcome, "monitor", name);
    assert.equal(match?.beliefAssessment?.gates.allPassed, false, name);
  }
});

test("missing selected event, crossed event/prior IDs, and missing priorActions fail the affected Deal unavailable", async () => {
  const cases = [
    ["event", (fixture: ReturnType<typeof strictBeliefRevisionFixture>) => {
      fixture.observation.selectedTriggerEventId = "missing_event";
    }],
    ["crossed lineage", (fixture: ReturnType<typeof strictBeliefRevisionFixture>) => {
      const candidate = fixture.input.memoryContexts[0]!
        .interactionCandidates![0]!;
      candidate.sourceIds = [fixture.trigger.id];
      fixture.observation.previousContext =
        "Acme enterprise adoption milestone is now verified.";
    }],
    ["prior actions", (fixture: ReturnType<typeof strictBeliefRevisionFixture>) => {
      delete fixture.input.memoryContexts[0]!.interactionCandidates![0]!
        .priorActions;
    }],
  ] as const;

  for (const [name, mutate] of cases) {
    const fixture = strictBeliefRevisionFixture();
    mutate(fixture);
    const [match] = await createMatchingService({
      reason: async () => [fixture.observation],
    }).analyze(fixture.input);
    assert.equal(match?.outcome, "analysis_unavailable", name);
  }
});

test("no model candidate and a global reasoner failure remain distinct dispositions", async () => {
  const fixture = strictBeliefRevisionFixture();
  assert.deepEqual(
    await createMatchingService({ reason: async () => [] }).analyze(
      fixture.input,
    ),
    [],
  );
  await assert.rejects(
    createMatchingService({
      reason: async () => {
        throw new Error("global model failure");
      },
    }).analyze(fixture.input),
    /global model failure/,
  );
});

test("matching source ID conflicts throw before the reasoner is called", async () => {
  let reasonerCalls = 0;
  const first = normalizedSourceV2("conflicting_source");
  const conflicting = normalizedSourceV2("conflicting_source", {
    text: {
      status: "normalized_only",
      normalizedStatement: "A different statement under the same source ID.",
    },
  });
  const service = createMatchingService({
    async reason() {
      reasonerCalls += 1;
      return [];
    },
  });

  await assert.rejects(service.analyze({
    deals: [{ id: "deal_1", companyName: "Acme", status: "passed" }],
    events: [marketEventV2(first)],
    memoryContexts: [],
    sources: [first, conflicting],
  }), /conflicting source id/i);
  assert.equal(reasonerCalls, 0);
});

test("matching intrinsic-unit conflicts throw before the reasoner is called", async () => {
  let reasonerCalls = 0;
  const first = exactSourceV2("intrinsic_matching_source_a", {
    sourceRevisionId: "revision_shared_matching",
    locator: { kind: "web_text", selector: "#same" },
  });
  const roleSpoof = exactSourceV2("intrinsic_matching_source_b", {
    sourceRevisionId: "revision_shared_matching",
    locator: { kind: "web_text", selector: "#same" },
    evidenceRole: "counterevidence",
  });
  const service = createMatchingService({
    async reason() {
      reasonerCalls += 1;
      return [];
    },
  });

  await assert.rejects(service.analyze({
    deals: [{ id: "deal_1", companyName: "Acme", status: "passed" }],
    events: [marketEventV2(first)],
    memoryContexts: [],
    sources: [first, roleSpoof],
  }), /intrinsic evidence unit|conflicting evidence metadata/i);
  assert.equal(reasonerCalls, 0);
});

test("matching rejects a stale canonical event before the reasoner is called", async () => {
  let reasonerCalls = 0;
  const source = normalizedSourceV2("stale_matching_source");
  const validEvent = marketEventV2(source);
  const service = createMatchingService({
    async reason() {
      reasonerCalls += 1;
      return [];
    },
  });

  await assert.rejects(service.analyze({
    deals: [{ id: "deal_1", companyName: "Acme", status: "passed" }],
    events: [{
      ...validEvent,
      summary: "Tampered after its canonical fingerprint was computed.",
    }],
    memoryContexts: [],
    sources: [source],
  }), /fingerprint.*canonical payload/i);
  assert.equal(reasonerCalls, 0);
});

test("an unknown cited source fails only the affected Deal unavailable", async () => {
  const fixture = strictBeliefRevisionFixture({ prefix: "unknown" });
  fixture.observation.whyNow += " Unsupported customer claim.";
  fixture.observation.claimSourceIds["Unsupported customer claim."] = [
    "missing_source",
  ];
  const result = await createMatchingService({
    reason: async () => [fixture.observation],
  }).analyze(fixture.input);

  assert.equal(result.length, 1);
  const grounded = result[0];
  assert.ok(grounded);
  assert.equal(grounded.outcome, "analysis_unavailable");
  assert.match(grounded.whyNow, /unknown canonical source/i);
});

test("rejects a match with no Deal-linked evidence and sanitizes unsafe actions", async () => {
  const service = createMatchingService({
    reason: async () => [{
      dealId: "deal_1",
      whyNow: "A robotics event occurred.",
      previousContext: "The company is a robotics leader.",
      positiveImplications: [],
      negativeImplications: [],
      nextStep: "Invest now.",
      citedSourceIds: ["market_1"],
      demoFixtureIds: ["invented_fixture"],
      scoreInputs: {
        eventRelevance: 1,
        dealRelevance: 1,
        priorContextStrength: 1,
        evidenceQuality: 1,
      },
      claimSourceIds: {
        "A robotics event occurred.": ["market_1"],
        "The company is a robotics leader.": ["market_1"],
      },
    }],
  });

  const result = await service.match({
    deals: [{ id: "deal_1", companyName: "Acin", status: "invested" }],
    events: [],
    memoryContexts: [{
      dealId: "deal_1",
      text: "Operational-risk context",
      sourceIds: ["deal_source_1"],
      fixtureIds: [],
    }],
    sources: [publicExactSource(
      "market_1",
      "Robotics event",
      "https://example.com/robotics",
      "A robotics event occurred.",
    )],
  });

  assert.deepEqual(result, []);
});

test("rejects fabricated matching claims even when every cited source id exists", async () => {
  const fabricated = "The company signed 50 enterprise customers yesterday.";
  const service = createMatchingService({
    reason: async () => [{
      dealId: "deal_1",
      whyNow: fabricated,
      previousContext: "The company makes infrastructure software.",
      positiveImplications: [],
      negativeImplications: [],
      nextStep: "Review the cited evidence.",
      citedSourceIds: ["market_1", "deal_source_1"],
      demoFixtureIds: [],
      scoreInputs: {
        eventRelevance: 1,
        dealRelevance: 1,
        priorContextStrength: 1,
        evidenceQuality: 1,
      },
      claimSourceIds: {
        [fabricated]: ["market_1"],
        "The company makes infrastructure software.": ["deal_source_1"],
      },
    }],
  });

  const result = await service.match({
    deals: [{ id: "deal_1", companyName: "Example", status: "screening" }],
    events: [],
    memoryContexts: [{
      dealId: "deal_1",
      text: "Infrastructure context",
      sourceIds: ["deal_source_1"],
      fixtureIds: [],
    }],
    sources: [
      publicExactSource(
        "market_1",
        "Unrelated filing notice",
        "https://example.com/filing",
        "The filing deadline is next week.",
      ),
      priorExactSource(
        "deal_source_1",
        "Example deck",
        "doc_1",
        "The company makes infrastructure software.",
      ),
    ],
  });

  assert.deepEqual(result, []);
});

test("rejects a matching claim that strips negation from a complete evidence unit", async () => {
  const strippedClaim = "Acme signed enterprise customers.";
  const negativeStatement =
    "The source did not establish that Acme signed enterprise customers.";
  const previousContext = "Acme builds enterprise customer infrastructure.";
  const service = createMatchingService({
    reason: async () => [{
      dealId: "deal_1",
      whyNow: strippedClaim,
      previousContext,
      positiveImplications: [],
      negativeImplications: [],
      nextStep: "Review the cited evidence.",
      citedSourceIds: ["market_negative", "deal_source_negative"],
      demoFixtureIds: [],
      scoreInputs: {
        eventRelevance: 0.8,
        dealRelevance: 0.8,
        priorContextStrength: 0.7,
        evidenceQuality: 0.8,
      },
      claimSourceIds: {
        [strippedClaim]: ["market_negative"],
        [previousContext]: ["deal_source_negative"],
      },
    }],
  });

  const result = await service.match({
    deals: [{ id: "deal_1", companyName: "Acme", status: "passed" }],
    events: [],
    memoryContexts: [{
      dealId: "deal_1",
      text: previousContext,
      sourceIds: ["deal_source_negative"],
      fixtureIds: [],
    }],
    sources: [
      publicExactSource(
        "market_negative",
        "Negative customer evidence",
        "https://example.com/negative-customer-evidence",
        negativeStatement,
      ),
      priorExactSource(
        "deal_source_negative",
        "Acme deck",
        "doc_acme_negative",
        previousContext,
      ),
    ],
  });

  assert.deepEqual(result, []);
});

test("rejects a quoted but unrelated event-to-Deal pairing", async () => {
  const service = createMatchingService({
    reason: async () => [{
      dealId: "deal_1906",
      whyNow: "A new AI regulation was announced.",
      previousContext: "Controlled-dose cannabis products.",
      positiveImplications: [],
      negativeImplications: [],
      nextStep: "Review the cited evidence.",
      citedSourceIds: ["market_ai", "deal_cannabis"],
      demoFixtureIds: [],
      scoreInputs: {
        eventRelevance: 1,
        dealRelevance: 1,
        priorContextStrength: 1,
        evidenceQuality: 1,
      },
      claimSourceIds: {
        "A new AI regulation was announced.": ["market_ai"],
        "Controlled-dose cannabis products.": ["deal_cannabis"],
      },
    }],
  });

  const result = await service.match({
    deals: [{ id: "deal_1906", companyName: "1906", status: "screening" }],
    events: [],
    memoryContexts: [{
      dealId: "deal_1906",
      text: "Cannabis context",
      sourceIds: ["deal_cannabis"],
      fixtureIds: [],
    }],
    sources: [
      publicExactSource(
        "market_ai",
        "AI regulation",
        "https://example.com/ai",
        "A new AI regulation was announced.",
      ),
      priorExactSource(
        "deal_cannabis",
        "1906 deck",
        "doc_1906",
        "Controlled-dose cannabis products.",
      ),
    ],
  });

  assert.deepEqual(result, []);
});

test("does not treat the generic token AI as sufficient Deal/event overlap", async () => {
  const service = createMatchingService({
    reason: async () => [{
      dealId: "deal_7bridges",
      whyNow: "AI regulation changed.",
      previousContext: "AI logistics platform.",
      positiveImplications: [],
      negativeImplications: [],
      nextStep: "Review the cited evidence.",
      citedSourceIds: ["market_ai", "deal_ai"],
      demoFixtureIds: [],
      scoreInputs: {
        eventRelevance: 1,
        dealRelevance: 1,
        priorContextStrength: 1,
        evidenceQuality: 1,
      },
      claimSourceIds: {
        "AI regulation changed.": ["market_ai"],
        "AI logistics platform.": ["deal_ai"],
      },
    }],
  });

  const result = await service.match({
    deals: [{ id: "deal_7bridges", companyName: "7bridges", status: "passed" }],
    events: [],
    memoryContexts: [{
      dealId: "deal_7bridges",
      text: "AI logistics",
      sourceIds: ["deal_ai"],
      fixtureIds: [],
    }],
    sources: [
      publicExactSource(
        "market_ai",
        "AI regulation",
        "https://example.com/ai",
        "AI regulation changed.",
      ),
      priorExactSource(
        "deal_ai",
        "7bridges deck",
        "doc_7bridges",
        "AI logistics platform.",
      ),
    ],
  });

  assert.deepEqual(result, []);
});

test("does not surface an unrelated match from one shared enterprise token", async () => {
  const service = createMatchingService({
    reason: async () => [{
      dealId: "deal_logistics",
      whyNow: "Enterprise tax filing deadline changed.",
      previousContext: "Enterprise logistics software.",
      positiveImplications: [],
      negativeImplications: [],
      nextStep: "Review the cited evidence.",
      citedSourceIds: ["market_tax", "deal_logistics_source"],
      demoFixtureIds: [],
      scoreInputs: {
        eventRelevance: 1,
        dealRelevance: 1,
        priorContextStrength: 1,
        evidenceQuality: 1,
      },
      claimSourceIds: {
        "Enterprise tax filing deadline changed.": ["market_tax"],
        "Enterprise logistics software.": ["deal_logistics_source"],
      },
    }],
  });

  const result = await service.match({
    deals: [{
      id: "deal_logistics",
      companyName: "Example Logistics",
      status: "watchlist",
    }],
    events: [],
    memoryContexts: [{
      dealId: "deal_logistics",
      text: "Enterprise logistics software.",
      sourceIds: ["deal_logistics_source"],
      fixtureIds: [],
    }],
    sources: [
      publicExactSource(
        "market_tax",
        "Tax filing update",
        "https://example.com/tax",
        "Enterprise tax filing deadline changed.",
      ),
      priorExactSource(
        "deal_logistics_source",
        "Logistics deck",
        "doc_logistics",
        "Enterprise logistics software.",
      ),
    ],
  });

  assert.deepEqual(result, []);
});
