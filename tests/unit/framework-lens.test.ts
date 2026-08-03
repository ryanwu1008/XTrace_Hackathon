import assert from "node:assert/strict";
import test from "node:test";

import type { ClaudeClient } from "../../lib/claude/client";
import { IntegrationTransportError } from "../../lib/api/errors";
import type {
  Assumption,
  Calculation,
  EvidencePack,
  Fact,
} from "../../lib/contracts/evidence";
import type {
  CandidateRun,
  ResolvedUnderwritingContext,
} from "../../lib/contracts/underwriting";
import {
  createFrameworkLensService,
  createMemoryFrameworkLensCache,
  type FrameworkLensCache,
  type FrameworkLensCacheRecord,
} from "../../lib/underwriting/frameworks/service";
import type {
  FrameworkCard,
} from "../../lib/underwriting/frameworks/schemas";
import { SYNTHETIC_FRAMEWORK_PACK } from "../../seed/underwriting/framework-pack-v1";

const fact: Fact = {
  id: "fact_arr",
  analysisType: "fact",
  provenanceOrigin: "uploaded_document",
  field: "arr",
  value: "2400000",
  unit: "currency",
  currency: "USD",
  periodStart: "2025-01-01",
  periodEnd: "2025-12-31",
  publishedAt: null,
  eventAt: "2025-12-31T23:59:59.000Z",
  retrievedAt: "2026-07-29T10:00:00.000Z",
  sourceRevisionId: "revision_1",
  locator: {
    kind: "text_range",
    start: 0,
    end: 12,
    excerpt: "ARR $2.4m.",
  },
  sourceRole: "management",
  assertionStatus: "reported",
  verificationMethod: null,
  freshness: "current",
  acceptedForGate: true,
};

const assumption: Assumption = {
  id: "assumption_benchmark",
  analysisType: "assumption",
  provenanceOrigin: "benchmark",
  scenario: "all",
  field: "compatible_benchmark_value",
  value: "24000000",
  unit: "USD",
  rationale: "Published compatible benchmark.",
  inputRefIds: ["benchmark_pack_synthetic_us_software_v1"],
  sensitivity: "high",
  requiresConfirmation: false,
};

const calculation: Calculation = {
  id: "calculation_pricing_premium",
  analysisType: "calculation",
  formulaId: "pricing_premium",
  formulaVersion: "1",
  inputRefs: [
    { itemId: fact.id, value: fact.value, type: "fact" },
    {
      itemId: assumption.id,
      value: assumption.value,
      type: "benchmark",
    },
  ],
  output: "-0.9",
  unit: "decimal",
  currency: null,
  period: null,
  roundingPolicy: "half_even_display_only",
  computedAt: "2026-07-29T10:05:00.000Z",
  status: "completed",
};

const pack: EvidencePack = {
  id: "evidence_pack_1",
  version: 1,
  workspaceId: "workspace_1",
  dealId: "deal_1",
  asOfDate: "2026-07-29",
  sourceRevisionIds: ["revision_1"],
  facts: [fact],
  assumptions: [assumption],
  conflicts: [],
  coverage: {
    minimumModelInputsComplete: true,
    criticalEvidenceComplete: true,
    missingFieldIds: [],
    blockingConflictIds: [],
    decisionCeiling: "Invest Candidate",
    underwritingStatus: "available",
    reasonCodes: [],
  },
  createdAt: "2026-07-29T10:01:00.000Z",
};

const candidate: CandidateRun = {
  id: "candidate_1",
  batchId: "batch_1",
  workspaceId: "workspace_1",
  dealId: "deal_1",
  status: "running",
  candidateAnalysisFingerprint: "candidate-fingerprint-1",
  rerunOfId: null,
  createdAt: "2026-07-29T10:02:00.000Z",
  finalizedAt: null,
};

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
  frameworkPackId: SYNTHETIC_FRAMEWORK_PACK.id,
};

const execution = {
  provider: "anthropic",
  model: "claude-opus-4-8",
  promptVersion: "framework-lens-prompt-v1",
  schemaVersion: "framework-lens-schema-v1",
  settingsFingerprint: "settings:deterministic",
  applicationCommit: "97b1133",
} as const;

function lensOutput(card: FrameworkCard) {
  const valuation = card.title === "Valuation & Fund Return";
  return {
    applicability: "applicable",
    conclusion: valuation ? "negative" : "supportive",
    supportEvidenceItemIds: valuation ? [calculation.id] : [fact.id],
    counterEvidenceItemIds: valuation ? [assumption.id] : [assumption.id],
    unusedEvidenceItemIds: valuation ? [fact.id] : [],
    strongestSupport: valuation
      ? "The saved pricing-premium Calculation is negative."
      : "The source Fact supports this synthetic criterion.",
    strongestCounterargument:
      "The compatible benchmark remains a bounded counterpoint.",
    unknowns: ["Independent customer verification remains unknown."],
    limitations: ["No conclusion is a formal investment decision."],
    confidence: {
      sourceReliability: "medium",
      evidenceStrength: "medium",
      evidenceCoverage: "medium",
      applicability: "high",
      judgment: "medium",
    },
    frameworkRuleRefs: [card.id],
  };
}

function input() {
  return { candidate, pack, context, calculations: [calculation] };
}

test("runs published synthetic lenses independently and scopes saved calculations to valuation", async () => {
  const ordinaryCard = SYNTHETIC_FRAMEWORK_PACK.cards[0]!;
  const valuationCard = SYNTHETIC_FRAMEWORK_PACK.cards[7]!;
  const calls: Array<Parameters<ClaudeClient["complete"]>[0]> = [];
  const client: ClaudeClient = {
    async complete(request) {
      calls.push(structuredClone(request));
      const content = request.messages[0]?.content;
      if (typeof content !== "string") {
        throw new Error("Framework lens request must use a text-only prompt.");
      }
      const payload = JSON.parse(content) as {
        card: FrameworkCard;
      };
      return JSON.stringify(lensOutput(payload.card));
    },
  };
  const service = createFrameworkLensService({
    client,
    cards: [ordinaryCard, valuationCard],
    execution,
  });

  const result = await service.runAll(input());

  assert.equal(result.judgments.length, 2);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.match(call.system, /no browsing or tool access/i);
    assert.match(call.system, /must not output.*decision/i);
    assert.equal("tools" in call, false);
  }
  const ordinaryPrompt = String(calls[0]?.messages[0]?.content);
  const valuationPrompt = String(calls[1]?.messages[0]?.content);
  assert.match(ordinaryPrompt, new RegExp(ordinaryCard.id));
  assert.doesNotMatch(ordinaryPrompt, new RegExp(valuationCard.id));
  assert.doesNotMatch(ordinaryPrompt, new RegExp(calculation.id));
  assert.match(valuationPrompt, new RegExp(valuationCard.id));
  assert.match(valuationPrompt, new RegExp(calculation.id));
  assert.match(valuationPrompt, new RegExp(context.valuationMethodPolicyId));
  assert.match(valuationPrompt, new RegExp(context.benchmarkPackId!));
  assert.equal(
    result.judgments[1]?.claimEdges.some((edge) =>
      edge.dependencyItemId === calculation.id
      && edge.dependencyType === "calculation"
    ),
    true,
  );
});

test("core-only unavailable geography produces explicit framework abstentions without provider calls", async () => {
  let providerCalls = 0;
  const cards = SYNTHETIC_FRAMEWORK_PACK.cards.slice(0, 2);
  const cache = createMemoryFrameworkLensCache();
  const service = createFrameworkLensService({
    cards,
    cache,
    execution,
    client: {
      async complete() {
        providerCalls += 1;
        return "{}";
      },
    },
  });

  const result = await service.runAll({
    ...input(),
    context: {
      ...context,
      analysisMode: "core_only",
      geography: "unavailable",
      benchmarkPackId: null,
      benchmarkCompatibility: "unavailable",
    },
  });
  const replay = await service.runAll({
    ...input(),
    context: {
      ...context,
      analysisMode: "core_only",
      geography: "unavailable",
      benchmarkPackId: null,
      benchmarkCompatibility: "unavailable",
    },
  });

  assert.equal(providerCalls, 0);
  assert.deepEqual(replay, result);
  assert.equal(cache.inspect().length, cards.length);
  assert.equal(cache.inspect().every(({ providerMetadata }) =>
    providerMetadata.attempts === 0
    && providerMetadata.repaired === false
  ), true);
  assert.equal(result.judgments.length, cards.length);
  assert.equal(result.judgments.every((judgment) =>
    judgment.applicability === "unavailable"
    && judgment.conclusion === "abstain"
    && judgment.limitations.some((limitation) =>
      /core-only.*geography.*unavailable/i.test(limitation)
    )
  ), true);
  assert.deepEqual(result.disagreements, []);
});

test("propagates caller cancellation before starting any framework provider work", async () => {
  let modelCalls = 0;
  const controller = new AbortController();
  controller.abort(new Error("candidate stage expired"));
  const service = createFrameworkLensService({
    cards: [SYNTHETIC_FRAMEWORK_PACK.cards[0]!],
    execution,
    client: {
      async complete() {
        modelCalls += 1;
        return "{}";
      },
    },
  });

  await assert.rejects(
    service.runAll({
      ...input(),
      signal: controller.signal,
    }),
    /candidate stage expired|aborted/i,
  );
  assert.equal(modelCalls, 0);
});

test("repairs malformed or ungrounded output exactly once and then persists unavailable", async () => {
  const card = SYNTHETIC_FRAMEWORK_PACK.cards[0]!;
  let repairedCalls = 0;
  const repaired = createFrameworkLensService({
    cards: [card],
    execution,
    client: {
      async complete() {
        repairedCalls += 1;
        return repairedCalls === 1
          ? JSON.stringify({
            ...lensOutput(card),
            supportEvidenceItemIds: ["invented_fact"],
          })
          : JSON.stringify(lensOutput(card));
      },
    },
  });
  const repairedResult = await repaired.runAll(input());
  assert.equal(repairedCalls, 2);
  assert.equal(repairedResult.judgments[0]?.applicability, "applicable");

  let failedCalls = 0;
  const failed = createFrameworkLensService({
    cards: [card],
    execution,
    client: {
      async complete() {
        failedCalls += 1;
        return "{\"malformed\":true}";
      },
    },
  });
  const failedResult = await failed.runAll(input());
  assert.equal(failedCalls, 2);
  assert.equal(failedResult.judgments[0]?.applicability, "unavailable");
  assert.equal(failedResult.judgments[0]?.conclusion, "abstain");
  assert.match(
    failedResult.judgments[0]?.limitations.join(" ") ?? "",
    /unavailable after one repair/i,
  );
});

test("replays the same fingerprint without a Claude call and caches metadata without prompts", async () => {
  const card = SYNTHETIC_FRAMEWORK_PACK.cards[0]!;
  const cache = createMemoryFrameworkLensCache();
  let modelCalls = 0;
  const service = createFrameworkLensService({
    cards: [card],
    cache,
    execution,
    client: {
      async complete() {
        modelCalls += 1;
        return JSON.stringify(lensOutput(card));
      },
    },
  });

  const first = await service.runAll(input());
  const second = await service.runAll(input());

  assert.equal(modelCalls, 1);
  assert.deepEqual(second, first);
  const records = cache.inspect();
  assert.equal(records.length, 1);
  assert.deepEqual(records[0]?.providerMetadata, {
    ...execution,
    attempts: 1,
    repaired: false,
  });
  assert.deepEqual(
    Object.keys(records[0] ?? {}).sort(),
    ["binding", "fingerprint", "judgment", "providerMetadata"],
  );
  assert.deepEqual(records[0]?.binding, {
    candidateId: candidate.id,
    candidateAnalysisFingerprint:
      candidate.candidateAnalysisFingerprint,
    evidencePackId: pack.id,
    evidencePackVersion: pack.version,
    contextId: context.id,
    contextVersion: context.contextVersion,
    frameworkCardId: card.id,
    frameworkVersion: card.version,
    authorizationMode: "ordinary_framework_card",
    catalogFingerprint: null,
    corpusDigest: null,
    compositeAuthorizationDigest: null,
  });
  assert.equal("system" in (records[0] ?? {}), false);
  assert.equal("messages" in (records[0] ?? {}), false);
  assert.equal("rawResponse" in (records[0] ?? {}), false);
});

test("fails closed when a caller cache rebinds a record to another candidate", async () => {
  const card = SYNTHETIC_FRAMEWORK_PACK.cards[0]!;
  const seededCache = createMemoryFrameworkLensCache();
  await createFrameworkLensService({
    cards: [card],
    cache: seededCache,
    execution,
    client: {
      async complete() {
        return JSON.stringify(lensOutput(card));
      },
    },
  }).runAll(input());
  const corrupt = seededCache.inspect()[0];
  assert.ok(corrupt);
  corrupt.binding.candidateId = "candidate_from_another_execution";
  let providerCalls = 0;
  const replay = createFrameworkLensService({
    cards: [card],
    cache: {
      async find() {
        return corrupt;
      },
      async save() {
        throw new Error("A mismatched replay must not be replaced.");
      },
    },
    execution,
    client: {
      async complete() {
        providerCalls += 1;
        return JSON.stringify(lensOutput(card));
      },
    },
  });

  await assert.rejects(
    replay.runAll(input()),
    /cache record does not match.*execution request/i,
  );
  assert.equal(providerCalls, 0);
});

test("coalesces concurrent execution for the same composite fingerprint", async () => {
  const card = SYNTHETIC_FRAMEWORK_PACK.cards[0]!;
  let modelCalls = 0;
  const service = createFrameworkLensService({
    cards: [card],
    execution,
    client: {
      async complete() {
        modelCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return JSON.stringify(lensOutput(card));
      },
    },
  });

  const [first, second] = await Promise.all([
    service.runAll(input()),
    service.runAll(input()),
  ]);

  assert.equal(modelCalls, 1);
  assert.deepEqual(second, first);
});

test("cleans a failed in-flight cache write so the exact fingerprint can retry", async () => {
  const card = SYNTHETIC_FRAMEWORK_PACK.cards[0]!;
  let modelCalls = 0;
  let saveCalls = 0;
  let saved: FrameworkLensCacheRecord | null = null;
  const cache: FrameworkLensCache = {
    async find() {
      return saved;
    },
    async save(record) {
      saveCalls += 1;
      if (saveCalls === 1) {
        throw new Error("Synthetic cache write failure.");
      }
      saved = structuredClone(record);
    },
  };
  const service = createFrameworkLensService({
    cards: [card],
    cache,
    execution,
    client: {
      async complete() {
        modelCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return JSON.stringify(lensOutput(card));
      },
    },
  });

  const failed = await Promise.allSettled([
    service.runAll(input()),
    service.runAll(input()),
  ]);
  assert.deepEqual(
    failed.map(({ status }) => status),
    ["rejected", "rejected"],
  );
  assert.equal(modelCalls, 1);
  assert.equal(saveCalls, 1);

  await service.runAll(input());
  assert.equal(modelCalls, 2);
  assert.equal(saveCalls, 2);
});

test("never shares cached judgments across candidate or context identities", async () => {
  const card = SYNTHETIC_FRAMEWORK_PACK.cards[0]!;
  let modelCalls = 0;
  const service = createFrameworkLensService({
    cards: [card],
    execution,
    client: {
      async complete() {
        modelCalls += 1;
        return JSON.stringify(lensOutput(card));
      },
    },
  });

  const baseline = await service.runAll(input());
  const otherCandidate = await service.runAll({
    ...input(),
    candidate: {
      ...candidate,
      id: "candidate_2",
      candidateAnalysisFingerprint: "candidate-fingerprint-2",
    },
  });
  const otherContext = await service.runAll({
    ...input(),
    context: {
      ...context,
      id: "underwriting_context_seed_b2b_saas_v2",
      contextVersion: "2",
    },
  });

  assert.equal(modelCalls, 3);
  assert.notEqual(
    baseline.judgments[0]?.fingerprint,
    otherCandidate.judgments[0]?.fingerprint,
  );
  assert.notEqual(
    baseline.judgments[0]?.fingerprint,
    otherContext.judgments[0]?.fingerprint,
  );
});

test("only exact Task 7 cards run; draft, lookalike, and non-applicable cards abstain without Claude", async () => {
  const applicableCard = SYNTHETIC_FRAMEWORK_PACK.cards[0]!;
  const namedDraftCard: FrameworkCard = {
    ...applicableCard,
    id: "side_quest_named_real_card_v1",
    title: "Named Side Quest Lens",
    synthetic: false,
    publicationStatus: "draft",
    attribution: "Named real framework source",
    rightsStatus: "review_pending",
    formalDecisionWeight: "0",
  };
  const unregisteredSyntheticCard: FrameworkCard = {
    ...applicableCard,
    id: "framework_card_unregistered_synthetic_v1",
    title: "Unregistered Synthetic Lens",
  };
  let modelCalls = 0;
  const service = createFrameworkLensService({
    cards: [namedDraftCard, unregisteredSyntheticCard, applicableCard],
    execution,
    isApplicable: (card) => card.id !== applicableCard.id,
    client: {
      async complete() {
        modelCalls += 1;
        throw new Error("Inert cards must never reach Claude.");
      },
    },
  });

  const result = await service.runAll(input());

  assert.equal(modelCalls, 0);
  assert.deepEqual(
    result.judgments.map(({ applicability, conclusion }) => ({
      applicability,
      conclusion,
    })),
    [
      { applicability: "unavailable", conclusion: "abstain" },
      { applicability: "unavailable", conclusion: "abstain" },
      { applicability: "not_applicable", conclusion: "abstain" },
    ],
  );
});

test("reserves every initial and repair provider request instead of one flat stage charge", async () => {
  const reservations: Array<{
    attemptFingerprint: string;
    outputTokenUnits: number;
  }> = [];
  let calls = 0;
  const service = createFrameworkLensService({
    execution,
    client: {
      async complete(request) {
        calls += 1;
        const content = String(request.messages[0]?.content);
        const payload = JSON.parse(content) as {
          card?: FrameworkCard;
          originalRequest?: { card: FrameworkCard };
        };
        const card = payload.card ?? payload.originalRequest?.card;
        assert.ok(card);
        if (card.id === SYNTHETIC_FRAMEWORK_PACK.cards[0]!.id && calls === 1) {
          return "{\"malformed\":true}";
        }
        return JSON.stringify(lensOutput(card));
      },
    },
  });
  const providerAttempt = {
    async execute<T>(request: {
      attemptFingerprint: string;
      outputTokenUnits: number;
      operation(): Promise<T>;
    }): Promise<T> {
      reservations.push({
        attemptFingerprint: request.attemptFingerprint,
        outputTokenUnits: request.outputTokenUnits,
      });
      return request.operation();
    },
  };

  await service.runAll({
    ...input(),
    providerAttempt,
  } as Parameters<typeof service.runAll>[0]);

  assert.equal(calls, 9);
  assert.equal(reservations.length, 9);
  assert.equal(
    reservations.reduce(
      (total, reservation) => total + reservation.outputTokenUnits,
      0,
    ),
    9 * 4_000,
  );
  assert.equal(
    new Set(reservations.map(({ attemptFingerprint }) => attemptFingerprint))
      .size,
    9,
  );
});

test("reserves retryable transport attempts separately and propagates provider budget failures", async () => {
  const card = SYNTHETIC_FRAMEWORK_PACK.cards[0]!;
  let calls = 0;
  const reservations: string[] = [];
  const service = createFrameworkLensService({
    cards: [card],
    execution,
    client: {
      async complete() {
        calls += 1;
        if (calls === 1) {
          throw new IntegrationTransportError({ retryable: true });
        }
        return JSON.stringify(lensOutput(card));
      },
    },
  });
  const result = await service.runAll({
    ...input(),
    providerAttempt: {
      async execute(request) {
        reservations.push(request.attemptFingerprint);
        return request.operation();
      },
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.judgments[0]?.applicability, "applicable");
  assert.equal(reservations.length, 2);
  assert.equal(new Set(reservations).size, 2);

  const budgeted = createFrameworkLensService({
    cards: [card],
    execution,
    client: {
      async complete() {
        throw new Error("provider operation must not start");
      },
    },
  });
  await assert.rejects(
    budgeted.runAll({
      ...input(),
      providerAttempt: {
        async execute() {
          throw new Error("candidate provider budget exhausted");
        },
      },
    }),
    /provider budget exhausted/,
  );
});
