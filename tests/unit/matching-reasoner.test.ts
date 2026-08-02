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
          "nextStep": "Review the cited source and decide whether to follow up.",
          "citedSourceIds": ["market_source", "deal_source"],
          "demoFixtureIds": ["fixture_ably"],
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
          "nextStep": "None.",
          "citedSourceIds": ["market_source"],
          "demoFixtureIds": [],
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
    deals: [{ id: "deal_ably", companyName: "Ably", status: "passed" as const }],
    events: [marketEventV2(normalized)],
    memoryContexts: [],
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
  }
});

test("a legacy v1 judgment cannot replay for v2 evidence", async () => {
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
              fingerprint,
              model: "claude-opus-4-8",
              payload: JSON.parse(REPLAY_COMPLETION),
            }
          : null;
      },
      async save() {},
    },
  });

  await reasoner.reason({
    deals: [{ id: "deal_ably", companyName: "Ably", status: "passed" }],
    events: [marketEventV2(normalized)],
    memoryContexts: [],
    sources: [normalized],
  });

  assert.equal(modelCalls, 1);
  assert.match(
    requestedFingerprints[0],
    /^reasoner-judgment-v2:sha256:[0-9a-f]{64}$/,
  );
});

test("matching reasoner coerces numeric score strings from the model", async () => {
  const match = {
    dealId: "deal_x",
    whyNow: "Event happened.",
    previousContext: "Prior context.",
    positiveImplications: [],
    negativeImplications: [],
    nextStep: "Review the cited evidence.",
    citedSourceIds: ["source_x"],
    demoFixtureIds: [],
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
    "nextStep": "Review the cited source and decide whether to follow up.",
    "citedSourceIds": ["market_source", "deal_source"],
    "demoFixtureIds": ["fixture_ably"],
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

function replayInput() {
  return {
    deals: [{ id: "deal_ably", companyName: "Ably", status: "passed" as const }],
    events: [event],
    memoryContexts: buildStructuredMemoryContexts([bundle]),
    sources: buildMatchingSources([bundle], [event]),
  };
}

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

test("refresh mode re-rolls the model and later replays the refreshed judgment", async () => {
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

  await refreshing.reason(replayInput());
  await refreshing.reason(replayInput());
  assert.equal(refreshCalls, 2, "refresh mode must bypass replay");

  let frozenCalls = 0;
  const frozen = createClaudeMatchingReasoner({
    async complete() {
      frozenCalls += 1;
      return REPLAY_COMPLETION;
    },
  }, { judgments });
  const replayed = await frozen.reason(replayInput());
  assert.equal(frozenCalls, 0, "frozen mode must replay the stored judgment");
  assert.equal(replayed[0].dealId, "deal_ably");
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
