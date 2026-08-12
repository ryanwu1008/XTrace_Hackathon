import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { DealMemoryBundle } from "../../lib/contracts/domain";
import {
  buildMatchingSources,
  buildStructuredMemoryContexts,
} from "../../lib/matching/context";
import { createClaudeMatchingReasoner } from "../../lib/matching/claude-reasoner";
import { IntegrationTransportError } from "../../lib/api/errors";
import { ClaudeCompletionTruncatedError } from "../../lib/claude/client";
import { MatchingFailure } from "../../lib/matching/failure";
import { stableEvidencePromptJson } from "../../lib/matching/prompt-evidence";
import { createClaudeReasoner } from "../../lib/claude/service";
import {
  sourceTextForRetrieval,
  WritableMarketEventV2Schema,
} from "../../lib/contracts/source-evidence";
import { refingerprintMarketEvent } from "../../lib/market/identity";
import { buildSampleDecisionSourceRef } from "../../lib/belief-reversal/sample-decision-source";
import {
  exactSourceV2,
  marketEventV2,
  normalizedSourceV2,
} from "../helpers/source-evidence-v2";

const bundle: DealMemoryBundle = {
  dealId: "deal_ably",
  companyName: "Ably",
  status: "passed",
  facts: [{
    text: "Ably provides realtime data infrastructure.",
    sources: [{
      id: "deal_source",
      provenance: "source_document",
      title: "Ably deck",
      documentId: "doc_ably",
      page: 5,
      excerpt: "Realtime communication at the edge.",
    }],
  }],
  interactions: [{
    id: "fixture_ably",
    occurredAt: "2026-07-01T00:00:00.000Z",
    summary: "Synthetic pass note.",
    decisionReason: "The synthetic team passed pending stronger adoption evidence.",
    concerns: ["Timing"],
    revisitConditions: ["Relevant market change"],
    priorActions: [{
      kind: "no_new_action",
      scope: "deal",
      priority: "standard",
      visibility: "internal_only",
    }],
    provenance: "demo_fixture",
    label: "Sample decision record",
  }],
};

const eventSource = normalizedSourceV2("market_source", {
  title: "Official announcement",
  canonicalUrl: "https://example.com/announcement",
  publisher: "Example",
  providerId: "example-feed",
  eventAt: "2026-07-20T00:00:00.000Z",
  eventAtPrecision: "timestamp",
  publishedAt: "2026-07-20T00:00:00.000Z",
  retrievedAt: "2026-07-20T01:00:00.000Z",
  entityKeys: [],
  text: {
    status: "normalized_only",
    normalizedStatement: "The official announcement concerns realtime infrastructure.",
  },
});

const eventCounterSource = normalizedSourceV2("market_counter_source", {
  title: "Official announcement limitation",
  canonicalUrl: "https://example.com/announcement-limitation",
  publisher: "Example",
  providerId: "example-feed",
  eventAt: "2026-07-20T00:00:00.000Z",
  eventAtPrecision: "timestamp",
  publishedAt: "2026-07-20T00:00:00.000Z",
  retrievedAt: "2026-07-20T01:00:00.000Z",
  entityKeys: [],
  evidenceRole: "counterevidence",
  text: {
    status: "normalized_only",
    normalizedStatement:
      "The supplied evidence does not establish durable customer retention.",
  },
});

const event = marketEventV2(eventSource, {
  id: "event_1",
  title: "Realtime infrastructure announcement",
  eventType: "announcement",
  sectors: ["infrastructure"],
  themes: ["realtime"],
  summary: "A source-backed market event.",
  confidence: "medium",
  sources: [eventSource, eventCounterSource],
});

const TEST_LIVE_SCOPE = {
  schemaVersion: "matching-evidence-scope-v1" as const,
  evidenceMode: "live" as const,
  contextFingerprint: `sha256:${"a".repeat(64)}` as const,
  eventSetFingerprint: `sha256:${"b".repeat(64)}` as const,
  bindingFingerprint: `sha256:${"c".repeat(64)}` as const,
  snapshotFingerprint: null,
};

function canonicalCompletionFor(input: ReturnType<typeof replayInput>, options: {
  dealId: string;
  priorId: string;
  overrides?: Record<string, unknown>;
}) {
  const prior = input.sources.find(({ id }) => id === options.priorId);
  assert.ok(prior);
  const whyNow = sourceTextForRetrieval(eventSource);
  const previousContext = sourceTextForRetrieval(prior);
  const counterevidence = sourceTextForRetrieval(eventCounterSource);
  return {
    dealId: options.dealId,
    whyNow,
    previousContext,
    positiveImplications: [],
    negativeImplications: [],
    selectedTriggerEventId: "event_1",
    selectedPriorInteractionId: options.priorId,
    revisitConditionIndex: 0,
    revisitConditionText: "Relevant market change",
    revisitCitedSourceIds: ["market_source"],
    counterevidence: {
      statement: counterevidence,
      citedSourceIds: ["market_counter_source"],
    },
    citedSourceIds: [
      "market_source",
      "market_counter_source",
      options.priorId,
    ],
    scoreInputs: {
      eventRelevance: 0.8,
      dealRelevance: 0.8,
      priorContextStrength: 0.7,
      evidenceQuality: 0.8,
    },
    claimSourceIds: {
      [whyNow]: ["market_source"],
      [previousContext]: [options.priorId],
    },
    ...options.overrides,
  };
}

function canonicalReplayCompletion(overrides: Record<string, unknown> = {}) {
  return canonicalCompletionFor(replayInput(), {
    dealId: "deal_ably",
    priorId: "fixture_ably",
    overrides,
  });
}

test("structured matching context preserves source and synthetic-fixture lineage", () => {
  const contexts = buildStructuredMemoryContexts([bundle]);
  assert.deepEqual(contexts[0].sourceIds, ["deal_source"]);
  assert.deepEqual(contexts[0].fixtureIds, ["fixture_ably"]);
  assert.match(contexts[0].text, /Sample decision record/i);
  assert.match(contexts[0].text, /Decision reason: The synthetic team passed pending stronger adoption evidence/i);

  const sources = buildMatchingSources([bundle], [event]);
  assert.deepEqual(sources.map((source) => source.id).sort(), [
    "deal_source",
    "fixture_ably",
    "market_counter_source",
    "market_source",
  ]);
  assert.match(
    sources.find((source) => source.id === "fixture_ably")?.text
      .normalizedStatement ?? "",
    /Decision reason: The synthetic team passed pending stronger adoption evidence/i,
  );
  const fixtureSource = sources.find((source) =>
    source.id === "fixture_ably"
  );
  assert.equal(fixtureSource?.eventAt, "2026-07-01T00:00:00.000Z");
  assert.equal(fixtureSource?.eventAtPrecision, "timestamp");
  assert.equal(fixtureSource?.publishedAt, null);
  assert.equal(fixtureSource?.publishedAtPrecision, null);
});

test("Sample decision source timestamps canonicalize one exact Fact and interaction authority", () => {
  const sourceInput = {
    id: "fixture_henry_passed_v1",
    documentId: "source_fixture_henry_passed_v1",
    sourceRevisionId: "source_revision_source_fixture_henry_passed_v1_1",
    contentFingerprint:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    retrievedAt: "2026-08-01T00:00:00+00:00",
    summary: "Sample internal pass note.",
    decisionReason: "Commercial proof was limited.",
    concerns: ["Workflow benefit was not quantified."],
    revisitConditions: ["Verify material workflow compression."],
  };
  const factSource = buildSampleDecisionSourceRef({
    ...sourceInput,
    occurredAt: "2026-06-10T10:00:00-07:00",
  });
  const interactionSource = buildSampleDecisionSourceRef({
    ...sourceInput,
    occurredAt: "2026-06-10T17:00:00.000Z",
  });
  assert.equal(factSource.eventAt, "2026-06-10T17:00:00.000Z");
  assert.equal(factSource.retrievedAt, "2026-08-01T00:00:00.000Z");
  assert.deepEqual(factSource, interactionSource);

  const exactBundle: DealMemoryBundle = {
    dealId: "deal_henry_ai_v1",
    companyName: "Henry AI",
    status: "passed",
    facts: [{
      text: sourceTextForRetrieval(factSource),
      sources: [factSource],
    }],
    interactions: [{
      id: factSource.id,
      occurredAt: factSource.eventAt!,
      summary: sourceInput.summary,
      decisionReason: sourceInput.decisionReason,
      concerns: [...sourceInput.concerns],
      revisitConditions: [...sourceInput.revisitConditions],
      priorActions: [{
        kind: "no_new_action",
        scope: "deal",
        priority: "standard",
        visibility: "internal_only",
      }],
      actionPolicyVersion: "belief-action-policy-v1",
      interactionSchemaVersion: "sample-decision-interaction-v1",
      provenance: "demo_fixture",
      label: "Sample decision record",
      source: interactionSource,
    }],
  };
  assert.equal(
    buildMatchingSources([exactBundle], []).filter(({ id }) =>
      id === factSource.id
    ).length,
    1,
  );
});

test("Claude matching reasoner parses canonical JSON", async () => {
  const calls: string[] = [];
  const valid = canonicalReplayCompletion({
    positiveImplications: [sourceTextForRetrieval(eventSource)],
    claimSourceIds: {
      ...canonicalReplayCompletion().claimSourceIds,
    },
  });
  const reasoner = createClaudeMatchingReasoner({
    async complete(input) {
      calls.push(`${input.system}\n${input.messages[0].content}`);
      return JSON.stringify([valid]);
    },
  });

  const result = await reasoner.reason({
    evidenceScope: TEST_LIVE_SCOPE,
    deals: [{ id: "deal_ably", companyName: "Ably", status: "passed" }],
    events: [event],
    memoryContexts: buildStructuredMemoryContexts([bundle]),
    sources: buildMatchingSources([bundle], [event]),
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0], /Do not invent company progress/i);
  assert.deepEqual(result.map((item) => item.dealId), ["deal_ably"]);
});

test("matching reasoner asks for coverage-first reporting", async () => {
  let systemPrompt = "";
  const reasoner = createClaudeMatchingReasoner({
    async complete(input: { system: string }) {
      systemPrompt = input.system;
      return "[]";
    },
  } as never);

  await reasoner.reason({
    evidenceScope: TEST_LIVE_SCOPE,
    deals: [{ id: "deal_x", companyName: "X", status: "passed" }],
    events: [event],
    memoryContexts: [],
    sources: [eventSource],
  });

  assert.match(
    systemPrompt,
    /including uncertain ones/,
    "the reasoner must be instructed to report uncertain overlaps and let "
    + "downstream deterministic validation filter, otherwise literal "
    + "instruction-following suppresses recall",
  );
  assert.match(
    systemPrompt,
    /priorContextStrength belongs at 0\.6 or higher/,
    "prior-context calibration guidance must stay in the prompt",
  );
  assert.match(
    systemPrompt,
    /evidenceQuality belongs at 0\.6 or higher/,
    "evidence-quality calibration guidance must stay in the prompt",
  );
  assert.match(
    systemPrompt,
    /at most one observation per Deal/i,
    "a 30-Deal response must never emit ambiguous duplicate Deal rows",
  );
  assert.match(
    systemPrompt,
    /complete whyNow.*complete previousContext.*each complete implication.*own exact key in claimSourceIds/i,
    "every grounded output field must be mechanically complete before persistence",
  );
  assert.match(
    systemPrompt,
    /each implication must equal one complete eligible canonical evidence unit/i,
    "implications cannot be uncited model synthesis",
  );
  assert.match(
    systemPrompt,
    /counterevidence-role sources belong only in counterevidence/i,
    "counterevidence must not be manufactured as an action-changing implication",
  );
  assert.match(
    systemPrompt,
    /observation polarity.*formal belief direction.*downstream/i,
    "the model may classify evidence polarity but cannot choose the formal belief direction",
  );
});

test("matching reasoner accepts every field advertised by its output schema", async () => {
  let calls = 0;
  let advertisedCompletion = "";
  const reasoner = createClaudeMatchingReasoner({
    async complete(input) {
      calls += 1;
      if (!advertisedCompletion) {
        const prompt = JSON.parse(String(input.messages[0].content)) as {
          outputSchema: Record<string, unknown>;
        };
        const completion: Record<string, unknown> = canonicalReplayCompletion();
        for (const [field, example] of Object.entries(prompt.outputSchema)) {
          if (!(field in completion)) completion[field] = example;
        }
        advertisedCompletion = JSON.stringify([completion]);
      }
      return advertisedCompletion;
    },
  });

  const result = await reasoner.reason(replayInput());

  assert.equal(calls, 1, "an advertised output must not require repair");
  assert.deepEqual(result.map(({ dealId }) => dealId), ["deal_ably"]);
});

test("matching reasoner accepts one valid observation for every Deal in a 30-Deal scan", async () => {
  const deals = Array.from({ length: 30 }, (_, index) => ({
    id: `deal_${index + 1}`,
    companyName: `Company ${index + 1}`,
    status: "passed" as const,
  }));
  const bundles = deals.map((deal, index): DealMemoryBundle => ({
    ...bundle,
    dealId: deal.id,
    companyName: deal.companyName,
    interactions: bundle.interactions.map((interaction) => ({
      ...interaction,
      id: `fixture_${index + 1}`,
    })),
  }));
  const input = replayInput({
    deals,
    memoryContexts: buildStructuredMemoryContexts(bundles),
    sources: buildMatchingSources(bundles, [event]),
  });
  const completion = deals.map(({ id }, index) =>
    canonicalCompletionFor(input, {
      dealId: id,
      priorId: `fixture_${index + 1}`,
    })
  );
  let calls = 0;
  const reasoner = createClaudeMatchingReasoner({
    async complete() {
      calls += 1;
      return JSON.stringify(completion);
    },
  });

  const result = await reasoner.reason(input);

  assert.equal(calls, 1, "a valid 30-Deal response must not require repair");
  assert.deepEqual(result.map(({ dealId }) => dealId), deals.map(({ id }) => id));
});

test("matching reasoner rejects a 31-row response without widening the 30-Deal contract", async () => {
  const template = JSON.parse(REPLAY_COMPLETION)[0] as Record<string, unknown>;
  const completion = Array.from({ length: 31 }, (_, index) => ({
    ...template,
    dealId: `deal_${index + 1}`,
  }));
  let calls = 0;
  const reasoner = createClaudeMatchingReasoner({
    async complete() {
      calls += 1;
      return JSON.stringify(completion);
    },
  });

  await assert.rejects(
    reasoner.reason(replayInput({
      deals: completion.map((_, index) => ({
        id: `deal_${index + 1}`,
        companyName: `Company ${index + 1}`,
        status: "passed" as const,
      })),
    })),
    (error: unknown) =>
      error instanceof MatchingFailure
      && error.code === "MATCHING_RESPONSE_INVALID",
  );
  assert.equal(calls, 2, "one bounded repair attempt is still required");
});

test("matching reasoner keeps each 30-Deal row strict", async () => {
  const completion = JSON.parse(REPLAY_COMPLETION) as Array<Record<string, unknown>>;
  completion[0]!.modelSelectedAction = "invest_now";
  let calls = 0;
  const reasoner = createClaudeMatchingReasoner({
    async complete() {
      calls += 1;
      return JSON.stringify(completion);
    },
  });

  await assert.rejects(
    reasoner.reason(replayInput()),
    (error: unknown) =>
      error instanceof MatchingFailure
      && error.code === "MATCHING_RESPONSE_INVALID",
  );
  assert.equal(calls, 2, "an unknown field cannot bypass strict repair");
});

test("matching reasoner repairs each structurally valid row missing an exact claim key once", async () => {
  const complete = canonicalReplayCompletion();
  const missingClaims = [
    complete.whyNow,
    complete.previousContext,
  ] as const;

  for (const missingClaim of missingClaims) {
    const incomplete = structuredClone(complete);
    delete incomplete.claimSourceIds[missingClaim];
    let calls = 0;
    const reasoner = createClaudeMatchingReasoner({
      async complete() {
        calls += 1;
        return JSON.stringify([calls === 1 ? incomplete : complete]);
      },
    });

    const result = await reasoner.reason(replayInput());

    assert.equal(calls, 2, `missing exact key must be repaired: ${missingClaim}`);
    assert.deepEqual(result.map(({ dealId }) => dealId), ["deal_ably"]);
  }
});

test("matching semantic repair regenerates from source evidence without echoing raw output", async () => {
  const complete = canonicalReplayCompletion();
  const incomplete = {
    ...complete,
    whyNow: "SENSITIVE_FIRST_RESPONSE_MUST_NOT_REENTER_THE_PROMPT",
    claimSourceIds: {
      [complete.previousContext]: ["fixture_ably"],
    },
  };
  const prompts: string[] = [];
  const reasoner = createClaudeMatchingReasoner({
    async complete(input) {
      prompts.push(String(input.messages[0].content));
      return JSON.stringify([prompts.length === 1 ? incomplete : complete]);
    },
  });

  const result = await reasoner.reason(replayInput());

  assert.deepEqual(result.map(({ dealId }) => dealId), ["deal_ably"]);
  assert.equal(prompts.length, 2);
  assert.doesNotMatch(
    prompts[1],
    /SENSITIVE_FIRST_RESPONSE_MUST_NOT_REENTER_THE_PROMPT/u,
  );
  assert.match(prompts[1], /regenerate.*from scratch/i);
  assert.match(
    prompts[1],
    /replace whyNow, previousContext, and every implication.*complete eligible.*source catalog/i,
  );
  assert.match(prompts[1], /exact claimSourceIds key.*source IDs/i);
});

test("matching reasoner never saves a self-cited paraphrase that no canonical source supports", async () => {
  const canonicalWhyNow = sourceTextForRetrieval(eventSource);
  const priorSource = replayInput().sources.find(({ id }) =>
    id === "fixture_ably"
  );
  assert.ok(priorSource);
  const canonicalPreviousContext = sourceTextForRetrieval(priorSource);
  const canonicalCounterevidence = sourceTextForRetrieval(eventCounterSource);
  const unsupported = {
    dealId: "deal_ably",
    whyNow: "A self-cited paraphrase absent from every canonical evidence unit.",
    previousContext: canonicalPreviousContext,
    positiveImplications: [],
    negativeImplications: [],
    selectedTriggerEventId: "event_1",
    selectedPriorInteractionId: "fixture_ably",
    revisitConditionIndex: 0,
    revisitConditionText: "Relevant market change",
    revisitCitedSourceIds: ["market_source"],
    counterevidence: {
      statement: canonicalCounterevidence,
      citedSourceIds: ["market_counter_source"],
    },
    citedSourceIds: [
      "market_source",
      "market_counter_source",
      "fixture_ably",
    ],
    scoreInputs: {
      eventRelevance: 0.8,
      dealRelevance: 0.8,
      priorContextStrength: 0.7,
      evidenceQuality: 0.8,
    },
    claimSourceIds: {
      "A self-cited paraphrase absent from every canonical evidence unit.": [
        "market_source",
      ],
      [canonicalPreviousContext]: ["fixture_ably"],
    },
  };
  const repaired = {
    ...unsupported,
    whyNow: canonicalWhyNow,
    claimSourceIds: {
      [canonicalWhyNow]: ["market_source"],
      [canonicalPreviousContext]: ["fixture_ably"],
    },
  };
  let calls = 0;
  let saves = 0;
  const reasoner = createClaudeMatchingReasoner({
    async complete() {
      calls += 1;
      return JSON.stringify([calls === 1 ? unsupported : repaired]);
    },
  }, {
    judgments: {
      async find() { return null; },
      async save(record) {
        saves += 1;
        return {
          state: "current" as const,
          judgmentSchemaVersion: "reasoner-judgment-record-v1" as const,
          ...record,
          evidenceContextFingerprint:
            record.evidenceContextFingerprint ?? null,
          evidenceBindingFingerprint:
            record.evidenceBindingFingerprint ?? null,
          judgmentRecordFingerprint: `sha256:${"f".repeat(64)}`,
        };
      },
    },
  });

  const result = await reasoner.reason(replayInput());

  assert.equal(calls, 2, "canonical authority failure must trigger one repair");
  assert.equal(saves, 1, "only the canonical repaired judgment may be saved");
  assert.equal(result[0]?.whyNow, canonicalWhyNow);
});

test("a counterevidence-role source cannot be reused as a directional implication", async () => {
  const canonical = canonicalReplayCompletion();
  const counterText = sourceTextForRetrieval(eventCounterSource);
  const whyNow = canonical.whyNow;
  const invalid = {
    ...canonical,
    positiveImplications: [counterText],
    claimSourceIds: {
      ...canonical.claimSourceIds,
      [counterText]: ["market_counter_source"],
    },
  };
  const repaired = {
    ...canonical,
    positiveImplications: [whyNow],
    claimSourceIds: {
      ...canonical.claimSourceIds,
      [whyNow]: ["market_source"],
    },
  };
  let calls = 0;
  const reasoner = createClaudeMatchingReasoner({
    async complete() {
      calls += 1;
      return JSON.stringify([calls === 1 ? invalid : repaired]);
    },
  });

  const result = await reasoner.reason(replayInput());

  assert.equal(calls, 2);
  assert.deepEqual(result[0]?.positiveImplications, [whyNow]);
});

test("matching reasoner rejects a semantically incomplete bounded repair without retaining raw output", async () => {
  const sensitiveIncomplete = {
    dealId: "deal_ably",
    whyNow: "SENSITIVE_SEMANTICALLY_INCOMPLETE_MODEL_OUTPUT",
    previousContext: "Complete prior-context evidence unit.",
    positiveImplications: [],
    negativeImplications: [],
    selectedTriggerEventId: "event_1",
    selectedPriorInteractionId: "fixture_ably",
    revisitConditionIndex: 0,
    revisitConditionText: "Relevant market change",
    revisitCitedSourceIds: ["market_source"],
    counterevidence: {
      statement: "Complete counterevidence unit.",
      citedSourceIds: ["market_source"],
    },
    citedSourceIds: ["market_source", "fixture_ably"],
    scoreInputs: {
      eventRelevance: 0.8,
      dealRelevance: 0.8,
      priorContextStrength: 0.7,
      evidenceQuality: 0.8,
    },
    claimSourceIds: {
      "Complete prior-context evidence unit.": ["fixture_ably"],
    },
  };
  let calls = 0;
  let saves = 0;
  const reasoner = createClaudeMatchingReasoner({
    async complete() {
      calls += 1;
      return JSON.stringify([sensitiveIncomplete]);
    },
  }, {
    judgments: {
      async find() { return null; },
      async save(record) {
        saves += 1;
        return {
          state: "current" as const,
          judgmentSchemaVersion: "reasoner-judgment-record-v1" as const,
          ...record,
          evidenceContextFingerprint:
            record.evidenceContextFingerprint ?? null,
          evidenceBindingFingerprint:
            record.evidenceBindingFingerprint ?? null,
          judgmentRecordFingerprint: `sha256:${"e".repeat(64)}`,
        };
      },
    },
  });

  await assert.rejects(
    reasoner.reason(replayInput()),
    (error: unknown) => {
      assert.ok(error instanceof MatchingFailure);
      assert.equal(error.code, "MATCHING_RESPONSE_INVALID");
      assert.equal(error.phase, "response_validation");
      assert.doesNotMatch(
        error.message,
        /SENSITIVE_SEMANTICALLY_INCOMPLETE_MODEL_OUTPUT/u,
      );
      return true;
    },
  );
  assert.equal(calls, 2, "semantic validation permits exactly one repair call");
  assert.equal(saves, 0, "an invalid repaired response must not be persisted");
});

test("both Claude prompt paths separate normalized text from quote eligibility", async () => {
  const normalized = normalizedSourceV2("normalized_prompt_source", {
    text: {
      status: "normalized_only",
      normalizedStatement: "Normalized provider prose is not a quotation.",
    },
  });
  const exact = exactSourceV2("exact_prompt_source", {
    text: {
      status: "verified_exact",
      verbatimExcerpt: "Exact bounded source text.",
      normalizedStatement: "An exact source supplied bounded text.",
    },
  });
  const input = {
    evidenceScope: TEST_LIVE_SCOPE,
    deals: [{
      id: "deal_ably",
      companyName: "Ably",
      status: "passed" as const,
      expectedDirection: "CANARY_DEAL_EXPECTED_DIRECTION",
    }],
    events: [{
      ...marketEventV2(normalized),
      positiveImplications: ["CANARY_EVENT_POSITIVE_IMPLICATION"],
      negativeImplications: ["CANARY_EVENT_NEGATIVE_IMPLICATION"],
      expectedOutcome: "CANARY_EVENT_EXPECTED_OUTCOME",
    }],
    memoryContexts: [{
      dealId: "deal_ably",
      text: "Prior context",
      sourceIds: [],
      fixtureIds: [],
      expectedNewActions: ["CANARY_CONTEXT_EXPECTED_ACTION"],
    }],
    sources: [normalized, exact],
  };

  for (const reasonerFactory of [createClaudeMatchingReasoner, createClaudeReasoner]) {
    const calls: string[] = [];
    const reasoner = reasonerFactory({
      async complete(call: { system: string; messages: Array<{ content: string }> }) {
        calls.push(`${call.system}\n${call.messages[0].content}`);
        return "[]";
      },
    } as never);

    await reasoner.reason(input);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /"quoteEligible":false/);
    assert.match(
      calls[0],
      /"normalizedStatement":"Normalized provider prose is not a quotation\."/,
    );
    assert.doesNotMatch(
      calls[0],
      /"verbatimExcerpt":"Normalized provider prose is not a quotation\."/,
    );
    assert.match(calls[0], /complete eligible evidence unit/i);
    assert.match(calls[0], /qualifier|negation/i);
    assert.doesNotMatch(calls[0], /contiguous substring/i);
    assert.doesNotMatch(calls[0], /every cited source's excerpt/i);
    assert.doesNotMatch(calls[0], /CANARY_DEAL_EXPECTED_DIRECTION/);
    assert.doesNotMatch(calls[0], /CANARY_EVENT_EXPECTED_OUTCOME/);
    assert.doesNotMatch(
      calls[0],
      /CANARY_EVENT_(?:POSITIVE|NEGATIVE)_IMPLICATION/,
      "event-level implication metadata is retrieval annotation, not canonical evidence",
    );
    assert.doesNotMatch(calls[0], /CANARY_CONTEXT_EXPECTED_ACTION/);
  }
});

test("matching repair cannot alter a Deal row that already passed exact authority", async () => {
  const deals = [
    { id: "deal_1", companyName: "Company 1", status: "passed" as const },
    { id: "deal_2", companyName: "Company 2", status: "passed" as const },
  ];
  const bundles = deals.map((deal, index): DealMemoryBundle => ({
    ...bundle,
    dealId: deal.id,
    companyName: deal.companyName,
    interactions: bundle.interactions.map((interaction) => ({
      ...interaction,
      id: `fixture_selection_${index + 1}`,
    })),
  }));
  const input = replayInput({
    deals,
    memoryContexts: buildStructuredMemoryContexts(bundles),
    sources: buildMatchingSources(bundles, [event]),
  });
  const validFirst = canonicalCompletionFor(input, {
    dealId: "deal_1",
    priorId: "fixture_selection_1",
  });
  const validSecond = canonicalCompletionFor(input, {
    dealId: "deal_2",
    priorId: "fixture_selection_2",
  });
  const invalidSecond = {
    ...validSecond,
    whyNow: "Unsupported second-Deal paraphrase.",
    claimSourceIds: {
      ...validSecond.claimSourceIds,
      "Unsupported second-Deal paraphrase.": ["market_source"],
    },
  };
  const alteredFirst = {
    ...validFirst,
    scoreInputs: {
      ...validFirst.scoreInputs,
      eventRelevance: 0.1,
    },
  };
  let calls = 0;
  let saves = 0;
  const reasoner = createClaudeMatchingReasoner({
    async complete() {
      calls += 1;
      return JSON.stringify(calls === 1
        ? [validFirst, invalidSecond]
        : [alteredFirst, validSecond]);
    },
  }, {
    judgments: {
      async find() { return null; },
      async save(record) {
        saves += 1;
        return {
          state: "current" as const,
          judgmentSchemaVersion: "reasoner-judgment-record-v1" as const,
          ...record,
          evidenceContextFingerprint:
            record.evidenceContextFingerprint ?? null,
          evidenceBindingFingerprint:
            record.evidenceBindingFingerprint ?? null,
          judgmentRecordFingerprint: `sha256:${"9".repeat(64)}`,
        };
      },
    },
  });

  await assert.rejects(
    reasoner.reason(input),
    (error: unknown) =>
      error instanceof MatchingFailure
      && error.code === "MATCHING_RESPONSE_INVALID",
  );
  assert.equal(calls, 2);
  assert.equal(saves, 0, "selection drift must fail before immutable persistence");
});

test("matching repair freezes the invalid row's selected authority and scores", async () => {
  const alternateEvent = marketEventV2(eventSource, {
    id: "event_2",
    title: "Alternate realtime infrastructure event",
    sources: [eventSource, eventCounterSource],
  });
  const input = replayInput({ events: [event, alternateEvent] });
  const canonical = canonicalReplayCompletion();
  const invalid = {
    ...canonical,
    whyNow: "Unsupported paraphrase that requires semantic repair.",
    claimSourceIds: {
      ...canonical.claimSourceIds,
      "Unsupported paraphrase that requires semantic repair.": [
        "market_source",
      ],
    },
  };
  const drifted = {
    ...canonical,
    selectedTriggerEventId: "event_2",
    scoreInputs: {
      ...canonical.scoreInputs,
      eventRelevance: 0.1,
    },
  };
  let calls = 0;
  const reasoner = createClaudeMatchingReasoner({
    async complete() {
      calls += 1;
      return JSON.stringify([calls === 1 ? invalid : drifted]);
    },
  });

  await assert.rejects(
    reasoner.reason(input),
    (error: unknown) =>
      error instanceof MatchingFailure
      && error.code === "MATCHING_RESPONSE_INVALID",
  );
  assert.equal(calls, 2);
});

test("extra claim keys, citation drift, and duplicate polarity cannot enter an immutable judgment", async () => {
  const canonical = canonicalReplayCompletion();
  const variants = [{
    ...canonical,
    claimSourceIds: {
      ...canonical.claimSourceIds,
      [sourceTextForRetrieval(eventCounterSource)]: ["market_counter_source"],
    },
  }, {
    ...canonical,
    citedSourceIds: [...canonical.citedSourceIds, "unknown_source"],
  }, {
    ...canonical,
    positiveImplications: [canonical.whyNow, canonical.whyNow],
  }, {
    ...canonical,
    positiveImplications: [canonical.whyNow],
    negativeImplications: [canonical.whyNow],
  }];

  for (const invalid of variants) {
    let calls = 0;
    let saves = 0;
    const reasoner = createClaudeMatchingReasoner({
      async complete() {
        calls += 1;
        return JSON.stringify([invalid]);
      },
    }, {
      judgments: {
        async find() { return null; },
        async save(record) {
          saves += 1;
          return {
            state: "current" as const,
            judgmentSchemaVersion: "reasoner-judgment-record-v1" as const,
            ...record,
            evidenceContextFingerprint:
              record.evidenceContextFingerprint ?? null,
            evidenceBindingFingerprint:
              record.evidenceBindingFingerprint ?? null,
            judgmentRecordFingerprint: `sha256:${"7".repeat(64)}`,
          };
        },
      },
    });

    await assert.rejects(
      reasoner.reason(replayInput()),
      (error: unknown) =>
        error instanceof MatchingFailure
        && error.code === "MATCHING_RESPONSE_INVALID",
    );
    assert.equal(calls, 2);
    assert.equal(saves, 0);
  }
});

test("a semantically invalid current judgment cannot replay or survive save-return validation", async () => {
  const canonical = canonicalReplayCompletion();
  const invalid = {
    ...canonical,
    whyNow: "Cached self-cited paraphrase with no canonical authority.",
    claimSourceIds: {
      ...canonical.claimSourceIds,
      "Cached self-cited paraphrase with no canonical authority.": [
        "market_source",
      ],
    },
  };
  let providerCalls = 0;
  let saves = 0;
  const currentRecord = (fingerprint: string) => ({
    state: "current" as const,
    judgmentSchemaVersion: "reasoner-judgment-record-v1" as const,
    fingerprint,
    model: "claude-opus-4-8",
    payload: [invalid],
    evidenceContextFingerprint: TEST_LIVE_SCOPE.contextFingerprint,
    evidenceBindingFingerprint: TEST_LIVE_SCOPE.bindingFingerprint,
    judgmentRecordFingerprint: `sha256:${"8".repeat(64)}`,
  });
  const reasoner = createClaudeMatchingReasoner({
    async complete() {
      providerCalls += 1;
      return JSON.stringify([canonical]);
    },
  }, {
    judgments: {
      async find(fingerprint) { return currentRecord(fingerprint); },
      async save(record) {
        saves += 1;
        return currentRecord(record.fingerprint);
      },
    },
  });

  await assert.rejects(
    reasoner.reason(replayInput()),
    (error: unknown) =>
      error instanceof MatchingFailure
      && error.code === "MATCHING_RESPONSE_INVALID",
  );
  assert.equal(providerCalls, 0, "a corrupted exact-context cache must fail closed");
  assert.equal(saves, 0, "immutable corruption cannot be overwritten in place");
});

test("a repository cannot substitute another judgment identity after save", async () => {
  const canonical = canonicalReplayCompletion();
  let calls = 0;
  const reasoner = createClaudeMatchingReasoner({
    async complete() {
      calls += 1;
      return JSON.stringify([canonical]);
    },
  }, {
    judgments: {
      async find() { return null; },
      async save(record) {
        return {
          state: "current" as const,
          judgmentSchemaVersion: "reasoner-judgment-record-v1" as const,
          ...record,
          model: "unexpected-model",
          evidenceContextFingerprint:
            record.evidenceContextFingerprint ?? null,
          evidenceBindingFingerprint:
            record.evidenceBindingFingerprint ?? null,
          judgmentRecordFingerprint: `sha256:${"6".repeat(64)}`,
        };
      },
    },
  });

  await assert.rejects(
    reasoner.reason(replayInput()),
    (error: unknown) =>
      error instanceof MatchingFailure
      && error.code === "MATCHING_RESPONSE_INVALID",
  );
  assert.equal(calls, 1);
});

test("both Claude paths reject model attempts to choose direction, actions, gates, rank, or next step", async () => {
  const policyChoosingCompletion = JSON.stringify([{
    dealId: "deal_ably",
    whyNow: "The announcement concerns realtime infrastructure.",
    previousContext: "The prior record concerned realtime infrastructure.",
    positiveImplications: [],
    negativeImplications: [],
    nextStep: "Invest now.",
    direction: "positive",
    actions: [{ kind: "reopen_diligence" }],
    gates: { allPassed: true },
    rank: 1,
    citedSourceIds: ["market_source", "fixture_ably"],
    demoFixtureIds: ["fixture_ably"],
    scoreInputs: {
      eventRelevance: 0.8,
      dealRelevance: 0.8,
      priorContextStrength: 0.8,
      evidenceQuality: 0.8,
    },
    claimSourceIds: {
      "The announcement concerns realtime infrastructure.": ["market_source"],
    },
  }]);

  for (const reasonerFactory of [createClaudeMatchingReasoner, createClaudeReasoner]) {
    let calls = 0;
    const reasoner = reasonerFactory({
      async complete() {
        calls += 1;
        return policyChoosingCompletion;
      },
    } as never);

    await assert.rejects(
      reasoner.reason(replayInput()),
      /validation|unrecognized|invalid|schema/i,
    );
    assert.equal(calls, 2, "one repair attempt must still reject policy fields");
  }
});

test("an unversioned legacy judgment cannot replay under the current storage envelope", async () => {
  let modelCalls = 0;
  const requestedFingerprints: string[] = [];
  const reasoner = createClaudeMatchingReasoner({
    async complete() {
      modelCalls += 1;
      return REPLAY_COMPLETION;
    },
  }, {
    judgments: {
      async find(fingerprint) {
        requestedFingerprints.push(fingerprint);
        return /^[0-9a-f]{64}$/.test(fingerprint)
          ? {
              state: "legacy_unbound" as const,
              fingerprint,
              model: "claude-opus-4-8",
              payload: JSON.parse(REPLAY_COMPLETION),
              evidenceContextFingerprint: null,
              evidenceBindingFingerprint: null,
              judgmentRecordFingerprint: null,
            }
          : null;
      },
      async save(record) {
        return {
          state: "current" as const,
          judgmentSchemaVersion: "reasoner-judgment-record-v1" as const,
          ...record,
          evidenceContextFingerprint:
            record.evidenceContextFingerprint ?? null,
          evidenceBindingFingerprint:
            record.evidenceBindingFingerprint ?? null,
          judgmentRecordFingerprint: `sha256:${"a".repeat(64)}`,
        };
      },
    },
  });

  await reasoner.reason(replayInput());

  assert.equal(modelCalls, 1);
  assert.match(
    requestedFingerprints[0],
    /^reasoner-judgment-v3:sha256:[0-9a-f]{64}$/,
  );
});

test("matching reasoner uses the v4 contract domain without replaying an old v3 judgment", async () => {
  const complete = [canonicalReplayCompletion()];
  let system = "";
  let requestContent = "";
  const primer = createClaudeMatchingReasoner({
    async complete(input) {
      system = input.system;
      requestContent = String(input.messages[0].content);
      return JSON.stringify(complete);
    },
  });
  await primer.reason(replayInput());
  const scopeJson = stableEvidencePromptJson({
    schemaVersion: TEST_LIVE_SCOPE.schemaVersion,
    evidenceMode: TEST_LIVE_SCOPE.evidenceMode,
    contextFingerprint: TEST_LIVE_SCOPE.contextFingerprint,
    eventSetFingerprint: TEST_LIVE_SCOPE.eventSetFingerprint,
    snapshotFingerprint: TEST_LIVE_SCOPE.snapshotFingerprint,
  });
  const fingerprintFor = (domain: string) =>
    `reasoner-judgment-v3:sha256:${
      createHash("sha256")
        .update(
          `${domain}\nclaude-opus-4-8\n${system}\n${requestContent}\n${scopeJson}`,
          "utf8",
        )
        .digest("hex")
    }`;
  const oldFingerprint = fingerprintFor("reasoner-judgment-v3");
  const expectedFingerprint = fingerprintFor("reasoner-judgment-v4");
  let requestedFingerprint = "";
  let providerCalls = 0;
  const currentRecord = (fingerprint: string) => ({
    state: "current" as const,
    judgmentSchemaVersion: "reasoner-judgment-record-v1" as const,
    fingerprint,
    model: "claude-opus-4-8",
    payload: complete,
    evidenceContextFingerprint: TEST_LIVE_SCOPE.contextFingerprint,
    evidenceBindingFingerprint: TEST_LIVE_SCOPE.bindingFingerprint,
    judgmentRecordFingerprint: `sha256:${"d".repeat(64)}`,
  });
  const reasoner = createClaudeMatchingReasoner({
    async complete() {
      providerCalls += 1;
      return JSON.stringify(complete);
    },
  }, {
    judgments: {
      async find(fingerprint) {
        requestedFingerprint = fingerprint;
        return fingerprint === oldFingerprint
          ? currentRecord(fingerprint)
          : null;
      },
      async save(record) {
        return currentRecord(record.fingerprint);
      },
    },
  });

  await reasoner.reason(replayInput());

  assert.equal(providerCalls, 1, "the old v3-domain judgment must not replay");
  assert.equal(requestedFingerprint, expectedFingerprint);
  assert.notEqual(requestedFingerprint, oldFingerprint);
});

test("matching reasoner coerces numeric score strings from the model", async () => {
  const match = canonicalReplayCompletion({
    scoreInputs: {
      eventRelevance: "0.7",
      dealRelevance: "0.6",
      priorContextStrength: "0.5",
      evidenceQuality: "0.8",
    },
  });
  const reasoner = createClaudeMatchingReasoner({
    async complete() {
      return JSON.stringify([match]);
    },
  } as never);

  const result = await reasoner.reason(replayInput());

  assert.equal(result.length, 1, "string score values must not reject the match");
  assert.equal(result[0].scoreInputs.eventRelevance, 0.7);
});

const REPLAY_COMPLETION = JSON.stringify([canonicalReplayCompletion()]);

function replayInput(overrides: Record<string, unknown> = {}) {
  return {
    evidenceScope: TEST_LIVE_SCOPE,
    deals: [{ id: "deal_ably", companyName: "Ably", status: "passed" as const }],
    events: [event],
    memoryContexts: buildStructuredMemoryContexts([bundle]),
    sources: buildMatchingSources([bundle], [event]),
    ...overrides,
  };
}

test("matching reasoner classifies provider failures without exposing provider content", async () => {
  const cases = [
    {
      name: "401 authentication",
      error: new IntegrationTransportError({ retryable: false, status: 401 }),
      code: "MATCHING_PROVIDER_AUTH_FAILED",
      phase: "provider_request",
    },
    {
      name: "403 authentication",
      error: new IntegrationTransportError({ retryable: false, status: 403 }),
      code: "MATCHING_PROVIDER_AUTH_FAILED",
      phase: "provider_request",
    },
    {
      name: "429 rate limit",
      error: new IntegrationTransportError({ retryable: true, status: 429 }),
      code: "MATCHING_PROVIDER_RATE_LIMITED",
      phase: "provider_request",
    },
    {
      name: "503 provider outage",
      error: new IntegrationTransportError({ retryable: true, status: 503 }),
      code: "MATCHING_PROVIDER_UNAVAILABLE",
      phase: "provider_request",
    },
    {
      name: "network outage",
      error: new IntegrationTransportError({ retryable: true }),
      code: "MATCHING_PROVIDER_UNAVAILABLE",
      phase: "provider_request",
    },
    {
      name: "truncated response",
      error: new ClaudeCompletionTruncatedError(
        "SENSITIVE_PROVIDER_RESPONSE_MUST_NOT_PERSIST",
      ),
      code: "MATCHING_RESPONSE_TRUNCATED",
      phase: "provider_response",
    },
  ] as const;

  for (const fixture of cases) {
    const reasoner = createClaudeMatchingReasoner({
      async complete() {
        throw fixture.error;
      },
    });
    await assert.rejects(
      reasoner.reason(replayInput()),
      (error: unknown) => {
        assert.ok(error instanceof MatchingFailure, fixture.name);
        assert.equal(error.code, fixture.code, fixture.name);
        assert.equal(error.phase, fixture.phase, fixture.name);
        assert.doesNotMatch(
          error.message,
          /SENSITIVE_PROVIDER_RESPONSE_MUST_NOT_PERSIST/u,
          fixture.name,
        );
        return true;
      },
    );
  }
});

test("matching reasoner classifies an invalid repaired response without retaining raw output", async () => {
  let calls = 0;
  const reasoner = createClaudeMatchingReasoner({
    async complete() {
      calls += 1;
      return "SENSITIVE_INVALID_MODEL_OUTPUT_MUST_NOT_PERSIST";
    },
  });

  await assert.rejects(
    reasoner.reason(replayInput()),
    (error: unknown) => {
      assert.ok(error instanceof MatchingFailure);
      assert.equal(error.code, "MATCHING_RESPONSE_INVALID");
      assert.equal(error.phase, "response_validation");
      assert.doesNotMatch(
        error.message,
        /SENSITIVE_INVALID_MODEL_OUTPUT_MUST_NOT_PERSIST/u,
      );
      return true;
    },
  );
  assert.equal(calls, 2, "one repair attempt is required before classification");
});

test("judgment replay is scoped to evidence context while identical pinned evidence ignores run binding identity", async () => {
  const { createMemoryReasonerJudgmentsRepository } = await import(
    "../../db/repositories/reasoner-judgments"
  );
  const judgments = createMemoryReasonerJudgmentsRepository();
  let modelCalls = 0;
  const reasoner = createClaudeMatchingReasoner({
    async complete() {
      modelCalls += 1;
      return REPLAY_COMPLETION;
    },
  }, { judgments });
  const pinnedScope = {
    schemaVersion: "matching-evidence-scope-v1" as const,
    evidenceMode: "pinned" as const,
    contextFingerprint: `sha256:${"1".repeat(64)}`,
    eventSetFingerprint: `sha256:${"2".repeat(64)}`,
    bindingFingerprint: `sha256:${"3".repeat(64)}`,
    snapshotFingerprint: `sha256:${"4".repeat(64)}`,
  };

  await reasoner.reason(replayInput({ evidenceScope: pinnedScope }));
  await reasoner.reason(replayInput({
    evidenceScope: {
      ...pinnedScope,
      bindingFingerprint: `sha256:${"5".repeat(64)}`,
    },
  }));
  await reasoner.reason(replayInput({
    evidenceScope: {
      ...pinnedScope,
      contextFingerprint: `sha256:${"6".repeat(64)}`,
      bindingFingerprint: `sha256:${"7".repeat(64)}`,
    },
  }));

  assert.equal(modelCalls, 2);
});

test("identical evidence replays the stored judgment without a new model call", async () => {
  const { createMemoryReasonerJudgmentsRepository } = await import(
    "../../db/repositories/reasoner-judgments"
  );
  const judgments = createMemoryReasonerJudgmentsRepository();
  let modelCalls = 0;
  const reasoner = createClaudeMatchingReasoner({
    async complete() {
      modelCalls += 1;
      return REPLAY_COMPLETION;
    },
  }, { judgments });

  const first = await reasoner.reason(replayInput());
  const second = await reasoner.reason(replayInput());

  assert.equal(modelCalls, 1);
  assert.deepEqual(second, first);
  assert.equal(first[0].dealId, "deal_ably");
});

test("configured judgment read failure is hard and never invokes the provider", async () => {
  let modelCalls = 0;
  const reasoner = createClaudeMatchingReasoner({
    async complete() {
      modelCalls += 1;
      return REPLAY_COMPLETION;
    },
  }, {
    judgments: {
      async find() { throw new Error("configured repository read failed"); },
      async save() { throw new Error("unreachable"); },
    },
  });
  await assert.rejects(reasoner.reason(replayInput()), /repository read failed/);
  assert.equal(modelCalls, 0);
});

test("configured judgment save failure is hard and cannot return an unpersisted result", async () => {
  let modelCalls = 0;
  const reasoner = createClaudeMatchingReasoner({
    async complete() {
      modelCalls += 1;
      return REPLAY_COMPLETION;
    },
  }, {
    judgments: {
      async find() { return null; },
      async save() { throw new Error("configured repository save failed"); },
    },
  });
  await assert.rejects(reasoner.reason(replayInput()), /repository save failed/);
  assert.equal(modelCalls, 1);
});

test("immutable refresh mode fails before provider invocation with a typed revision error", async () => {
  const { createMemoryReasonerJudgmentsRepository } = await import(
    "../../db/repositories/reasoner-judgments"
  );
  const judgments = createMemoryReasonerJudgmentsRepository();
  let refreshCalls = 0;
  const refreshing = createClaudeMatchingReasoner({
    async complete() {
      refreshCalls += 1;
      return REPLAY_COMPLETION;
    },
  }, { judgments, refreshJudgments: true });

  await assert.rejects(
    refreshing.reason(replayInput()),
    /IMMUTABLE_JUDGMENT_REFRESH_REQUIRES_REVISION/,
  );
  assert.equal(refreshCalls, 0);
});

test("retrieval metadata changes invalidate v2 judgment replay", async () => {
  const { createMemoryReasonerJudgmentsRepository } = await import(
    "../../db/repositories/reasoner-judgments"
  );
  const judgments = createMemoryReasonerJudgmentsRepository();
  let modelCalls = 0;
  const reasoner = createClaudeMatchingReasoner({
    async complete() {
      modelCalls += 1;
      return REPLAY_COMPLETION;
    },
  }, { judgments });

  const stamped = (retrievedAt: string) => {
    const input = replayInput();
    const canonicalEvent = WritableMarketEventV2Schema.parse(event);
    return {
      ...input,
      events: [refingerprintMarketEvent({
        ...canonicalEvent,
        retrievedAt,
        sources: canonicalEvent.sources.map((source) => ({
          ...source,
          retrievedAt,
        })),
      })],
      sources: input.sources.map((source) =>
        source.id === eventSource.id && source.adaptation === "canonical"
          ? { ...source, retrievedAt }
          : source
      ),
    };
  };
  await reasoner.reason(stamped("2026-07-25T10:00:00.000Z"));
  await reasoner.reason(stamped("2026-07-25T11:30:00.000Z"));

  assert.equal(
    modelCalls,
    2,
    "every persisted v2 evidence field must bind judgment replay identity",
  );
});
