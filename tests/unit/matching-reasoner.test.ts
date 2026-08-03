import assert from "node:assert/strict";
import test from "node:test";

import type { DealMemoryBundle } from "../../lib/contracts/domain";
import {
  buildMatchingSources,
  buildStructuredMemoryContexts,
} from "../../lib/matching/context";
import { createClaudeMatchingReasoner } from "../../lib/matching/claude-reasoner";
import { createClaudeReasoner } from "../../lib/claude/service";
import { WritableMarketEventV2Schema } from "../../lib/contracts/source-evidence";
import { refingerprintMarketEvent } from "../../lib/market/identity";
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
  publishedAt: "2026-07-20T00:00:00.000Z",
  retrievedAt: "2026-07-20T01:00:00.000Z",
  entityKeys: [],
  text: {
    status: "normalized_only",
    normalizedStatement: "The announcement concerns realtime infrastructure.",
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
});

const TEST_LIVE_SCOPE = {
  schemaVersion: "matching-evidence-scope-v1" as const,
  evidenceMode: "live" as const,
  contextFingerprint: `sha256:${"a".repeat(64)}` as const,
  eventSetFingerprint: `sha256:${"b".repeat(64)}` as const,
  bindingFingerprint: `sha256:${"c".repeat(64)}` as const,
  snapshotFingerprint: null,
};

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

test("Claude matching reasoner parses JSON and rejects Deals outside the candidate set", async () => {
  const calls: string[] = [];
  const reasoner = createClaudeMatchingReasoner({
    async complete(input) {
      calls.push(`${input.system}\n${input.messages[0].content}`);
      return `\`\`\`json
      [
        {
          "dealId": "deal_ably",
          "whyNow": "The official announcement concerns realtime infrastructure.",
          "previousContext": "The synthetic record says the fund passed.",
          "positiveImplications": ["The event overlaps the supplied company description."],
          "negativeImplications": [],
          "selectedTriggerEventId": "event_1",
          "selectedPriorInteractionId": "fixture_ably",
          "revisitConditionIndex": 0,
          "revisitConditionText": "Relevant market change",
          "revisitCitedSourceIds": ["market_source"],
          "counterevidence": {
            "statement": "The supplied evidence does not establish durable customer retention.",
            "citedSourceIds": ["market_source"]
          },
          "citedSourceIds": ["market_source", "deal_source"],
          "scoreInputs": {
            "eventRelevance": 0.8,
            "dealRelevance": 0.8,
            "priorContextStrength": 0.7,
            "evidenceQuality": 0.8
          },
          "claimSourceIds": {
            "The official announcement concerns realtime infrastructure.": ["market_source"]
          }
        },
        {
          "dealId": "deal_unknown",
          "whyNow": "Unknown.",
          "previousContext": "Unknown.",
          "positiveImplications": [],
          "negativeImplications": [],
          "selectedTriggerEventId": "event_1",
          "selectedPriorInteractionId": "fixture_ably",
          "revisitConditionIndex": 0,
          "revisitConditionText": "Relevant market change",
          "revisitCitedSourceIds": ["market_source"],
          "counterevidence": {
            "statement": "The supplied evidence does not establish durable customer retention.",
            "citedSourceIds": ["market_source"]
          },
          "citedSourceIds": ["market_source"],
          "scoreInputs": {
            "eventRelevance": 1,
            "dealRelevance": 1,
            "priorContextStrength": 1,
            "evidenceQuality": 1
          },
          "claimSourceIds": {
            "Unknown.": ["market_source"]
          }
        }
      ]\`\`\``;
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
    assert.doesNotMatch(calls[0], /CANARY_CONTEXT_EXPECTED_ACTION/);
  }
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

test("a reasoner v2 judgment cannot replay under the strict v3 schema", async () => {
  const normalized = normalizedSourceV2("normalized_replay_source");
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
          evidenceContextFingerprint: null,
          evidenceBindingFingerprint: null,
          judgmentRecordFingerprint: `sha256:${"a".repeat(64)}`,
        };
      },
    },
  });

  await reasoner.reason({
    evidenceScope: TEST_LIVE_SCOPE,
    deals: [{ id: "deal_ably", companyName: "Ably", status: "passed" }],
    events: [marketEventV2(normalized)],
    memoryContexts: [],
    sources: [normalized],
  });

  assert.equal(modelCalls, 1);
  assert.match(
    requestedFingerprints[0],
    /^reasoner-judgment-v3:sha256:[0-9a-f]{64}$/,
  );
});

test("matching reasoner coerces numeric score strings from the model", async () => {
  const match = {
    dealId: "deal_x",
    whyNow: "Event happened.",
    previousContext: "Prior context.",
    positiveImplications: [],
    negativeImplications: [],
    selectedTriggerEventId: "event_x",
    selectedPriorInteractionId: "fixture_x",
    revisitConditionIndex: 0,
    revisitConditionText: "Revisit after a material event.",
    revisitCitedSourceIds: ["source_x"],
    counterevidence: {
      statement: "The supplied evidence does not establish durable customer retention.",
      citedSourceIds: ["source_x"],
    },
    citedSourceIds: ["source_x"],
    scoreInputs: {
      eventRelevance: "0.7",
      dealRelevance: "0.6",
      priorContextStrength: "0.5",
      evidenceQuality: "0.8",
    },
    claimSourceIds: { "Event happened.": ["source_x"] },
  };
  const reasoner = createClaudeMatchingReasoner({
    async complete() {
      return JSON.stringify([match]);
    },
  } as never);

  const source = normalizedSourceV2("source_x", {
    text: {
      status: "normalized_only",
      normalizedStatement: "Event happened.",
    },
  });

  const result = await reasoner.reason({
    evidenceScope: TEST_LIVE_SCOPE,
    deals: [{ id: "deal_x", companyName: "X", status: "passed" }],
    events: [marketEventV2(source, { id: "event_x", title: "Event X" })],
    memoryContexts: [],
    sources: [source],
  });

  assert.equal(result.length, 1, "string score values must not reject the match");
  assert.equal(result[0].scoreInputs.eventRelevance, 0.7);
});

const REPLAY_COMPLETION = `[
  {
    "dealId": "deal_ably",
    "whyNow": "The official announcement concerns realtime infrastructure.",
    "previousContext": "The synthetic record says the fund passed.",
    "positiveImplications": [],
    "negativeImplications": [],
    "selectedTriggerEventId": "event_1",
    "selectedPriorInteractionId": "fixture_ably",
    "revisitConditionIndex": 0,
    "revisitConditionText": "Relevant market change",
    "revisitCitedSourceIds": ["market_source"],
    "counterevidence": {
      "statement": "The supplied evidence does not establish durable customer retention.",
      "citedSourceIds": ["market_source"]
    },
    "citedSourceIds": ["market_source", "deal_source"],
    "scoreInputs": {
      "eventRelevance": 0.8,
      "dealRelevance": 0.8,
      "priorContextStrength": 0.7,
      "evidenceQuality": 0.8
    },
    "claimSourceIds": {
      "The official announcement concerns realtime infrastructure.": ["market_source"]
    }
  }
]`;

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
