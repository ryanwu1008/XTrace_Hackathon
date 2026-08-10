import assert from "node:assert/strict";
import test from "node:test";

import {
  ClaudeCompletionTruncatedError,
  type ClaudeClient,
} from "../../lib/claude/client";
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
  NAMED_LENS_GENERATOR_VERSION,
  NAMED_LENS_PASSAGE_SCHEMA_VERSION,
} from "../../lib/contracts/named-lens";
import {
  DECISION_TAXONOMY_DIGEST,
  DECISION_TAXONOMY_VERSION,
} from "../../lib/underwriting/frameworks/decision-taxonomy";
import {
  authorizedResearchComposites,
  loadResearchFrameworkCatalog,
} from "../../lib/underwriting/frameworks/research-loader";
import {
  createFrameworkLensService,
  createMemoryFrameworkLensCache,
  type FrameworkLensCache,
  type FrameworkLensCacheRecord,
} from "../../lib/underwriting/frameworks/service";
import type {
  ExperimentalAdvisoryFrameworkCard,
  FrameworkCard,
} from "../../lib/underwriting/frameworks/schemas";
import { parseFrameworkLensResult } from "../../lib/underwriting/stage-replay";
import { SYNTHETIC_FRAMEWORK_PACK } from "../../seed/underwriting/framework-pack-v1";

const fact: Fact = {
  id: "fact_customer_retention",
  analysisType: "fact",
  provenanceOrigin: "uploaded_document",
  field: "customer_retention",
  value: "0.94",
  unit: "decimal",
  currency: null,
  periodStart: "2025-01-01",
  periodEnd: "2025-12-31",
  publishedAt: null,
  eventAt: "2025-12-31T23:59:59.000Z",
  retrievedAt: "2026-07-29T10:00:00.000Z",
  sourceRevisionId: "revision_customer_metrics",
  locator: {
    kind: "text_range",
    start: 0,
    end: 25,
    excerpt: "Customer retention was 94%.",
  },
  sourceRole: "management",
  assertionStatus: "reported",
  verificationMethod: null,
  freshness: "current",
  acceptedForGate: true,
};

const assumption: Assumption = {
  id: "assumption_customer_cohort_quality",
  analysisType: "assumption",
  provenanceOrigin: "benchmark",
  scenario: "all",
  field: "customer_cohort_quality",
  value: "unverified",
  unit: "status",
  rationale: "The reported retention has not been independently cohort-tested.",
  inputRefIds: [fact.id],
  sensitivity: "high",
  requiresConfirmation: true,
};

const calculation: Calculation = {
  id: "calculation_must_not_reach_advisory",
  analysisType: "calculation",
  formulaId: "test_only",
  formulaVersion: "1",
  inputRefs: [{
    itemId: fact.id,
    value: fact.value,
    type: "fact",
  }],
  output: "999",
  unit: "forbidden_advisory_input",
  currency: null,
  period: null,
  roundingPolicy: "half_even_display_only",
  computedAt: "2026-07-29T10:05:00.000Z",
  status: "completed",
};

const evidencePack: EvidencePack = {
  id: "evidence_pack_advisory_1",
  version: 1,
  workspaceId: "workspace_1",
  dealId: "deal_1",
  asOfDate: "2026-07-29",
  sourceRevisionIds: ["revision_customer_metrics"],
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
  id: "candidate_advisory_1",
  batchId: "batch_1",
  workspaceId: "workspace_1",
  dealId: "deal_1",
  status: "running",
  candidateAnalysisFingerprint: "candidate-advisory-fingerprint-1",
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
  frameworkPackId: "framework_pack_synthetic_universal_saas_ai_v1",
};

const execution = {
  provider: "anthropic",
  model: "claude-opus-4-8",
  promptVersion: "framework-lens-prompt-v1",
  schemaVersion: "framework-lens-schema-v1",
  settingsFingerprint: "settings:advisory-deterministic",
  applicationCommit: "task-11b-test",
} as const;

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

test("executes each applicable real pack once through a stable four-worker pool and persists complete opinions", async () => {
  const catalog = await loadResearchFrameworkCatalog({
    context,
  });
  const requests: Array<Parameters<ClaudeClient["complete"]>[0]> = [];
  let active = 0;
  let maximumActive = 0;
  const client: ClaudeClient = {
    async complete(request) {
      requests.push(structuredClone(request));
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return JSON.stringify(advisoryOutput(promptCard(request)));
    },
  };
  const service = createFrameworkLensService({
    client,
    cards: [],
    advisoryCatalog: catalog,
    execution,
  });

  const result = await service.runAll(runInput());
  const composites = authorizedResearchComposites(catalog);
  const applicable = composites.filter(
    ({ experimentalAdvisory }) => experimentalAdvisory.applicable,
  );

  assert.equal(result.judgments.length, 20);
  assert.equal(result.passageCandidates.length, applicable.length);
  assert.equal(result.passageResults.length, applicable.length);
  assert.deepEqual(
    parseFrameworkLensResult(
      JSON.parse(JSON.stringify(result)),
      currentPassageContract(),
    ),
    result,
  );
  assert.equal(
    Object.keys(result.taxonomyByFrameworkId).length,
    applicable.length,
    JSON.stringify(
      result.passageResults.filter(({ status }) => status !== "validated"),
    ),
  );
  assert.equal(requests.length, applicable.length);
  assert.equal(requests.length, 19);
  assert.equal(maximumActive, 4);
  assert.deepEqual(
    result.judgments.map(({ frameworkCardId }) => frameworkCardId),
    composites.map(({ id }) => id),
  );

  const inapplicableCard = composites.find(
    ({ experimentalAdvisory }) => !experimentalAdvisory.applicable,
  );
  assert.ok(inapplicableCard);
  const inapplicableJudgment = result.judgments.find(
    ({ frameworkCardId }) => frameworkCardId === inapplicableCard.id,
  );
  assert.deepEqual(
    {
      applicability: inapplicableJudgment?.applicability,
      conclusion: inapplicableJudgment?.conclusion,
      providerCalled: requests.some(
        (request) => promptCard(request).id === inapplicableCard.id,
      ),
    },
    {
      applicability: "not_applicable",
      conclusion: "abstain",
      providerCalled: false,
    },
  );

  assert.doesNotMatch(JSON.stringify(requests), new RegExp(calculation.id));
  for (const request of requests) {
    assert.match(request.system, /experimental product synthesis/i);
    assert.match(request.system, /not an endorsement/i);
    assert.match(request.system, /private reasoning|chain of thought/i);
    assert.match(request.system, /formal decision weight zero/i);
    assert.match(request.system, /third-person application/i);
    assert.match(request.system, /bounded advisoryPosture/i);
    assert.match(request.system, /exact supplied Card fields/i);
    assert.match(request.system, /do not invent or output a quotation/i);
    assert.equal("tools" in request, false);
    const payload = promptPayload(request);
    assert.equal(payload.card.executionMode, "experimental_advisory");
    assert.equal(Array.isArray(payload.card), false);
    assert.equal(payload.card.experimentalAdvisory.applicable, true);
    assert.equal(
      payload.card.experimentalAdvisory.components.some(
        ({ frameworkId }) =>
          pendingReviewIds.includes(
            frameworkId as typeof pendingReviewIds[number],
          ),
      ),
      false,
    );
    assert.equal(
      payload.card.experimentalAdvisory.components.every(
        ({ rights }) => rights.status === "public_source_paraphrase",
      ),
      true,
    );
  }

  const peter = result.judgments.find(({ frameworkMetadata }) =>
    frameworkMetadata?.packId === "peter_thiel_public_frameworks_v0_1"
  );
  assert.ok(peter);
  assert.ok(peter.frameworkMetadata);
  assert.equal(peter.applicability, "applicable");
  assert.equal(peter.conclusion, "supportive");
  assert.deepEqual(peter.supportEvidenceItemIds, [fact.id]);
  assert.deepEqual(peter.counterEvidenceItemIds, [assumption.id]);
  assert.deepEqual(peter.unusedEvidenceItemIds, []);
  assert.match(peter.strongestSupport ?? "", /retention/i);
  assert.match(peter.strongestCounterargument ?? "", /cohort/i);
  assert.deepEqual(peter.unknowns, [
    "Independent customer calls and cohort exports remain unknown.",
  ]);
  assert.equal(
    peter.limitations.some((item) =>
      item.includes("cannot create a formal investment decision")
    ),
    true,
  );
  assert.equal(
    peter.frameworkMetadata.components.some(
      ({ frameworkId }) => frameworkId === "PT-01",
    ),
    true,
  );
  assert.equal(
    peter.frameworkMetadata.sources.some(
      ({ sourceId }) => sourceId === "PT-P2-CS183-01",
    ),
    true,
  );
  assert.equal(peter.frameworkMetadata.formalDecisionWeight, "0");
});

test("stage replay requires the exact current passage generation contract", async () => {
  const catalog = await loadResearchFrameworkCatalog({ context });
  const service = createFrameworkLensService({
    cards: [],
    advisoryCatalog: catalog,
    execution,
    client: {
      async complete(request) {
        return JSON.stringify(advisoryOutput(promptCard(request)));
      },
    },
  });
  const persisted = JSON.parse(JSON.stringify(
    await service.runAll(runInput()),
  )) as Record<string, unknown>;
  const current = currentPassageContract();

  assert.deepEqual(parseFrameworkLensResult(persisted, current), persisted);

  const staleGenerator = structuredClone(persisted) as {
    passageResults: Array<{
      status: string;
      groundedCandidate?: { generatorVersion: string };
    }>;
  };
  const validated = staleGenerator.passageResults.find(
    ({ status }) => status === "validated",
  );
  assert.ok(validated?.groundedCandidate);
  validated.groundedCandidate.generatorVersion = "named-lens-generator-stale";
  assert.throws(
    () => parseFrameworkLensResult(staleGenerator, current),
    /passage.*contract|generator.*version|current/i,
  );

  const staleTaxonomy = structuredClone(persisted) as {
    judgments: Array<{
      frameworkMetadata?: { decisionTaxonomyDigest: string };
    }>;
  };
  const advisory = staleTaxonomy.judgments.find(
    ({ frameworkMetadata }) => frameworkMetadata !== undefined,
  );
  assert.ok(advisory?.frameworkMetadata);
  advisory.frameworkMetadata.decisionTaxonomyDigest =
    `sha256:${"0".repeat(64)}`;
  assert.throws(
    () => parseFrameworkLensResult(staleTaxonomy, current),
    /passage.*contract|taxonomy.*digest|current/i,
  );
});

test("core-only Deal context executes geography-agnostic named advisory packs without weakening the valuation ceiling", async () => {
  const unavailableContext: ResolvedUnderwritingContext = {
    ...context,
    analysisMode: "core_only",
    geography: "unavailable",
    benchmarkPackId: null,
    benchmarkCompatibility: "unavailable",
  };
  const catalog = await loadResearchFrameworkCatalog({
    context: unavailableContext,
  });
  const requests: Array<Parameters<ClaudeClient["complete"]>[0]> = [];
  const service = createFrameworkLensService({
    client: {
      async complete(request) {
        requests.push(structuredClone(request));
        return JSON.stringify(advisoryOutput(promptCard(request)));
      },
    },
    cards: [],
    advisoryCatalog: catalog,
    execution,
  });

  const result = await service.runAll({
    ...runInput(),
    context: unavailableContext,
  });
  const peter = result.judgments.find(({ frameworkMetadata }) =>
    frameworkMetadata?.packId === "peter_thiel_public_frameworks_v0_1"
  );
  const ventureDeals = result.judgments.find(({ frameworkMetadata }) =>
    frameworkMetadata?.packId === "venture_deals_public_frameworks_v0_1"
  );

  assert.ok(requests.length > 0);
  assert.equal(peter?.applicability, "applicable");
  assert.equal(peter?.conclusion, "supportive");
  assert.equal(ventureDeals?.applicability, "applicable");
  assert.equal(
    ventureDeals?.frameworkMetadata?.components.some(
      ({ frameworkId }) => frameworkId === "VD-01",
    ),
    false,
    "the US-specific Venture Deals component must remain excluded even when another geography-agnostic component keeps the pack applicable",
  );
  assert.equal(unavailableContext.analysisMode, "core_only");
  assert.equal(unavailableContext.benchmarkPackId, null);
});

test("replays advisory fingerprints without calls and never stores prompts or raw model responses", async () => {
  const catalog = await loadResearchFrameworkCatalog({
    context,
  });
  const cache = createMemoryFrameworkLensCache();
  let calls = 0;
  const service = createFrameworkLensService({
    cards: [],
    advisoryCatalog: catalog,
    cache,
    execution,
    client: {
      async complete(request) {
        calls += 1;
        return JSON.stringify(advisoryOutput(promptCard(request)));
      },
    },
  });

  const first = await service.runAll(runInput());
  const second = await service.runAll(runInput());

  assert.equal(calls, 19);
  assert.deepEqual(second, first);
  assert.equal(cache.inspect().length, 20);
  for (const record of cache.inspect()) {
    assert.deepEqual(
      Object.keys(record).sort(),
      [
        "binding",
        "fingerprint",
        "judgment",
        "passageCandidate",
        "passageContract",
        "passageValidationResult",
        "providerMetadata",
      ],
    );
    assert.equal(
      record.binding.authorizationMode,
      "authorized_research_catalog",
    );
    assert.equal(record.binding.catalogFingerprint, catalog.fingerprint);
    assert.equal(
      record.binding.corpusDigest,
      catalog.authorization.corpusDigest,
    );
    assert.equal(
      record.binding.compositeAuthorizationDigest,
      record.judgment.frameworkMetadata?.authorizationDigest,
    );
    assert.equal("system" in record, false);
    assert.equal("messages" in record, false);
    assert.equal("rawResponse" in record, false);
    assert.deepEqual(record.passageContract, {
      passageSchemaVersion: NAMED_LENS_PASSAGE_SCHEMA_VERSION,
      generatorVersion: NAMED_LENS_GENERATOR_VERSION,
      decisionTaxonomyVersion: DECISION_TAXONOMY_VERSION,
      decisionTaxonomyDigest:
        record.judgment.frameworkMetadata?.decisionTaxonomyDigest,
    });
    if (record.judgment.applicability === "applicable") {
      assert.ok(record.passageCandidate);
      assert.equal(record.passageValidationResult?.status, "validated");
    } else {
      assert.equal(record.passageCandidate, null);
      assert.equal(record.passageValidationResult, null);
    }
  }
});

test("provider-declared non-applicable advisory outputs replay identically without passage artifacts", async () => {
  const catalog = await loadResearchFrameworkCatalog({ context });
  const cache = createMemoryFrameworkLensCache();
  let calls = 0;
  const service = createFrameworkLensService({
    cards: [],
    advisoryCatalog: catalog,
    cache,
    execution,
    client: {
      async complete(request) {
        calls += 1;
        return JSON.stringify(notApplicableAdvisoryOutput(promptCard(request)));
      },
    },
  });

  const first = await service.runAll(runInput());
  const second = await service.runAll(runInput());

  assert.equal(calls, 19);
  assert.deepEqual(second, first);
  assert.equal(first.passageCandidates.length, 0);
  assert.equal(first.passageResults.length, 0);
  assert.deepEqual(first.taxonomyByFrameworkId, {});
  assert.equal(
    first.judgments.filter(
      ({ frameworkMetadata }) => frameworkMetadata?.applicable === true,
    ).every(
      ({ applicability, conclusion }) =>
        applicability === "not_applicable" && conclusion === "abstain",
    ),
    true,
  );
});

test("coalesces two concurrent full-catalog runs to one call per applicable pack", async () => {
  const catalog = await loadResearchFrameworkCatalog({ context });
  let calls = 0;
  const service = createFrameworkLensService({
    cards: [],
    advisoryCatalog: catalog,
    execution,
    client: {
      async complete(request) {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return JSON.stringify(advisoryOutput(promptCard(request)));
      },
    },
  });

  const [first, second] = await Promise.all([
    service.runAll(runInput()),
    service.runAll(runInput()),
  ]);

  assert.equal(calls, 19);
  assert.deepEqual(second, first);
});

test("runs the exact core pack first and appends no more than twenty advisory pack judgments", async () => {
  const catalog = await loadResearchFrameworkCatalog({
    context,
  });
  const coreCard = SYNTHETIC_FRAMEWORK_PACK.cards[0]!;
  let calls = 0;
  const service = createFrameworkLensService({
    cards: [coreCard],
    advisoryCatalog: catalog,
    execution,
    client: {
      async complete(request) {
        calls += 1;
        const card = promptAnyCard(request);
        return JSON.stringify(
          "executionMode" in card
            ? advisoryOutput(card)
            : {
              ...advisoryOutputShape(),
              frameworkRuleRefs: [card.id],
            },
        );
      },
    },
  });

  const result = await service.runAll(runInput());

  assert.equal(calls, 20);
  assert.equal(result.judgments.length, 21);
  assert.equal(result.judgments[0]?.frameworkCardId, coreCard.id);
  assert.equal(result.judgments[0]?.frameworkMetadata, undefined);
  assert.deepEqual(
    result.judgments.slice(1).map(({ frameworkCardId }) => frameworkCardId),
    authorizedResearchComposites(catalog).map(({ id }) => id),
  );
});

test("stops advisory failures after one attempt and records unavailable abstentions, never negative evidence", async () => {
  const catalog = await loadResearchFrameworkCatalog({
    context,
  });
  const callsByPack = new Map<string, number>();
  const malformedPack = "peter_thiel_public_frameworks_v0_1";
  const truncatedPack = "bill_gurley_public_frameworks_v0_1";
  const service = createFrameworkLensService({
    cards: [],
    advisoryCatalog: catalog,
    execution,
    client: {
      async complete(request) {
        const card = promptCard(request);
        const packId = card.experimentalAdvisory.packId;
        callsByPack.set(packId, (callsByPack.get(packId) ?? 0) + 1);
        if (packId === malformedPack) return "{\"malformed\":true}";
        if (packId === truncatedPack) {
          throw new ClaudeCompletionTruncatedError(
            "The advisory output reached max_tokens.",
          );
        }
        return JSON.stringify(advisoryOutput(card));
      },
    },
  });

  const result = await service.runAll(runInput());
  const replayed = await service.runAll(runInput());

  assert.deepEqual(replayed, result);

  for (const packId of [malformedPack, truncatedPack]) {
    assert.equal(callsByPack.get(packId), 1);
    const judgment = result.judgments.find(
      ({ frameworkMetadata }) => frameworkMetadata?.packId === packId,
    );
    assert.deepEqual(
      {
        applicability: judgment?.applicability,
        conclusion: judgment?.conclusion,
        support: judgment?.supportEvidenceItemIds,
        counter: judgment?.counterEvidenceItemIds,
      },
      {
        applicability: "unavailable",
        conclusion: "abstain",
        support: [],
        counter: [],
      },
    );
    assert.match(
      judgment?.limitations.join(" ") ?? "",
      /one permitted advisory attempt/i,
    );
  }
});

test("keeps a grounded advisory judgment when only its one-call passage has foreign evidence", async () => {
  const catalog = await loadResearchFrameworkCatalog({ context });
  const targetPack = "peter_thiel_public_frameworks_v0_1";
  const service = createFrameworkLensService({
    cards: [],
    advisoryCatalog: catalog,
    execution,
    client: {
      async complete(request) {
        const card = promptCard(request);
        const output = advisoryOutput(card);
        if (card.experimentalAdvisory.packId === targetPack) {
          output.passage.caseApplication.evidenceItemIds = [
            fact.id,
            "foreign_fact",
          ].sort();
        }
        return JSON.stringify(output);
      },
    },
  });

  const result = await service.runAll(runInput());
  const judgment = result.judgments.find(
    ({ frameworkMetadata }) => frameworkMetadata?.packId === targetPack,
  );
  assert.equal(judgment?.applicability, "applicable");
  assert.deepEqual(judgment?.supportEvidenceItemIds, [fact.id]);
  const passageResult = result.passageResults.find(
    ({ judgmentOrCatalogCandidateId }) =>
      judgmentOrCatalogCandidateId === judgment?.id,
  );
  assert.deepEqual(
    passageResult && {
      status: passageResult.status,
      reasonCode: passageResult.status === "validated"
        ? null
        : passageResult.reasonCode,
    },
    { status: "withheld", reasonCode: "foreign_passage_evidence" },
  );
  assert.equal(
    Object.hasOwn(result.taxonomyByFrameworkId, judgment!.frameworkCardId),
    true,
  );
});

test("rejects cloned catalogs and keeps caller-created advisory lookalikes inert", async () => {
  const catalog = await loadResearchFrameworkCatalog({
    context,
  });
  assert.throws(
    () =>
      createFrameworkLensService({
        cards: [],
        advisoryCatalog: structuredClone(catalog),
        execution,
        client: {
          async complete() {
            throw new Error("A cloned catalog must never reach the provider.");
          },
        },
      }),
    /not an authorized research catalog/i,
  );

  const lookalike = structuredClone(
    authorizedResearchComposites(catalog).find(
      ({ experimentalAdvisory }) => experimentalAdvisory.applicable,
    )!,
  );
  const sharedCache = createMemoryFrameworkLensCache();
  const authorizedService = createFrameworkLensService({
    cards: [],
    advisoryCatalog: catalog,
    cache: sharedCache,
    execution,
    client: {
      async complete(request) {
        return JSON.stringify(advisoryOutput(promptCard(request)));
      },
    },
  });
  await authorizedService.runAll(runInput());
  let calls = 0;
  const service = createFrameworkLensService({
    cards: [lookalike],
    cache: sharedCache,
    execution,
    client: {
      async complete() {
        calls += 1;
        throw new Error("A lookalike Card must never reach the provider.");
      },
    },
  });
  const result = await service.runAll(runInput());
  assert.equal(calls, 0);
  assert.deepEqual(
    {
      applicability: result.judgments[0]?.applicability,
      conclusion: result.judgments[0]?.conclusion,
      frameworkMetadata: result.judgments[0]?.frameworkMetadata,
    },
    {
      applicability: "unavailable",
      conclusion: "abstain",
      frameworkMetadata: undefined,
    },
  );
});

test("rejects an unauthorized advisory lookalike before consulting a caller cache", async () => {
  const catalog = await loadResearchFrameworkCatalog({ context });
  const lookalike = structuredClone(
    authorizedResearchComposites(catalog).find(
      ({ experimentalAdvisory }) => experimentalAdvisory.applicable,
    )!,
  );
  let findCalls = 0;
  let saveCalls = 0;
  const hostileCache: FrameworkLensCache = {
    async find(fingerprint) {
      findCalls += 1;
      return {
        fingerprint,
        judgment: poisonedAdvisoryJudgment(lookalike, fingerprint),
        providerMetadata: {
          ...execution,
          attempts: 1,
          repaired: false,
        },
      } as unknown as FrameworkLensCacheRecord;
    },
    async save() {
      saveCalls += 1;
    },
  };
  let providerCalls = 0;
  const result = await createFrameworkLensService({
    cards: [lookalike],
    cache: hostileCache,
    execution,
    client: {
      async complete() {
        providerCalls += 1;
        throw new Error("Unauthorized input must be rejected before I/O.");
      },
    },
  }).runAll(runInput());

  assert.equal(findCalls, 0);
  assert.equal(saveCalls, 0);
  assert.equal(providerCalls, 0);
  assert.deepEqual(
    {
      applicability: result.judgments[0]?.applicability,
      conclusion: result.judgments[0]?.conclusion,
      frameworkMetadata: result.judgments[0]?.frameworkMetadata,
    },
    {
      applicability: "unavailable",
      conclusion: "abstain",
      frameworkMetadata: undefined,
    },
  );
});

test("fails closed when cached advisory metadata does not exactly match the authorized composite", async () => {
  const catalog = await loadResearchFrameworkCatalog({ context });
  const cache = createMemoryFrameworkLensCache();
  const seeded = createFrameworkLensService({
    cards: [],
    advisoryCatalog: catalog,
    cache,
    execution,
    client: {
      async complete(request) {
        return JSON.stringify(advisoryOutput(promptCard(request)));
      },
    },
  });
  await seeded.runAll(runInput());
  const valid = cache.inspect().find(
    ({ judgment }) =>
      judgment.frameworkMetadata?.packId
        === "peter_thiel_public_frameworks_v0_1",
  );
  assert.ok(valid);
  const validMetadata = valid.judgment.frameworkMetadata;
  assert.ok(validMetadata);
  const corrupt = structuredClone(valid);
  corrupt.judgment.frameworkMetadata!.authorizationDigest =
    `sha256:${"0".repeat(64)}`;
  const corruptCache: FrameworkLensCache = {
    async find(fingerprint) {
      return fingerprint === valid.fingerprint ? corrupt : null;
    },
    async save() {},
  };
  const replay = createFrameworkLensService({
    cards: [],
    advisoryCatalog: catalog,
    cache: corruptCache,
    execution,
    client: {
      async complete(request) {
        return JSON.stringify(advisoryOutput(promptCard(request)));
      },
    },
  });

  await assert.rejects(
    replay.runAll(runInput()),
    /cache record.*authorized|cache record.*metadata|cache.*mismatch/i,
  );

  const changedCode = structuredClone(valid);
  const binding = changedCode.judgment.frameworkMetadata!
    .decisionTaxonomyBindings[0]!;
  binding.decisionQuestionCode = binding.decisionQuestionCode === "market_structure"
    ? "operating_model"
    : "market_structure";
  const staleTaxonomyCache: FrameworkLensCache = {
    async find(fingerprint) {
      return fingerprint === valid.fingerprint ? changedCode : null;
    },
    async save() {},
  };
  const staleTaxonomyReplay = createFrameworkLensService({
    cards: [],
    advisoryCatalog: catalog,
    cache: staleTaxonomyCache,
    execution,
    client: {
      async complete(request) {
        return JSON.stringify(advisoryOutput(promptCard(request)));
      },
    },
  });

  await assert.rejects(
    staleTaxonomyReplay.runAll(runInput()),
    /cache record.*authorized|cache record.*metadata|cache.*mismatch/i,
  );

  const oldDigest = structuredClone(valid);
  oldDigest.judgment.frameworkMetadata!.decisionTaxonomyDigest =
    `sha256:${"0".repeat(64)}`;
  const oldDigestCache: FrameworkLensCache = {
    async find(fingerprint) {
      return fingerprint === valid.fingerprint ? oldDigest : null;
    },
    async save() {},
  };
  const oldDigestReplay = createFrameworkLensService({
    cards: [],
    advisoryCatalog: catalog,
    cache: oldDigestCache,
    execution,
    client: {
      async complete(request) {
        return JSON.stringify(advisoryOutput(promptCard(request)));
      },
    },
  });

  await assert.rejects(
    oldDigestReplay.runAll(runInput()),
    /cache record.*authorized|cache record.*metadata|cache.*mismatch/i,
  );

  const prePassageContract = structuredClone(valid) as Partial<
    FrameworkLensCacheRecord
  >;
  delete prePassageContract.passageContract;
  delete prePassageContract.passageCandidate;
  delete prePassageContract.passageValidationResult;
  const prePassageReplay = createFrameworkLensService({
    cards: [],
    advisoryCatalog: catalog,
    execution,
    cache: {
      async find(fingerprint) {
        return fingerprint === valid.fingerprint
          ? prePassageContract as FrameworkLensCacheRecord
          : null;
      },
      async save() {},
    },
    client: {
      async complete(request) {
        return JSON.stringify(advisoryOutput(promptCard(request)));
      },
    },
  });
  await assert.rejects(
    prePassageReplay.runAll(runInput()),
    /cache record.*invalid|passage contract/i,
  );
});

test("fails closed on cached applicable advisory passage mutations", async () => {
  const catalog = await loadResearchFrameworkCatalog({ context });
  const cache = createMemoryFrameworkLensCache();
  await createFrameworkLensService({
    cards: [],
    advisoryCatalog: catalog,
    cache,
    execution,
    client: {
      async complete(request) {
        return JSON.stringify(advisoryOutput(promptCard(request)));
      },
    },
  }).runAll(runInput());
  const valid = cache.inspect().find(
    ({ judgment, passageValidationResult }) =>
      judgment.applicability === "applicable"
      && passageValidationResult?.status === "validated",
  );
  assert.ok(valid?.passageCandidate);

  const missingCandidate = structuredClone(valid) as unknown as Record<
    string,
    unknown
  >;
  missingCandidate.passageCandidate = null;
  missingCandidate.passageValidationResult = {
    judgmentOrCatalogCandidateId: valid.judgment.id,
    status: "withheld",
    reasonCode: "foreign_passage_evidence",
    authorizedFocus: valid.passageValidationResult?.authorizedFocus ?? null,
  };

  const alteredReason = structuredClone(valid) as unknown as Record<
    string,
    unknown
  >;
  alteredReason.passageValidationResult = {
    judgmentOrCatalogCandidateId: valid.judgment.id,
    status: "withheld",
    reasonCode: "arbitrary_cache_reason",
    authorizedFocus: valid.passageValidationResult?.authorizedFocus ?? null,
  };

  const malformedCandidate = structuredClone(valid) as unknown as {
    passageCandidate: Record<string, unknown>;
  };
  delete malformedCandidate.passageCandidate.caseApplication;

  const mismatchedCandidate = structuredClone(valid);
  mismatchedCandidate.passageCandidate!.caseApplication.evidenceItemIds = [
    assumption.id,
  ];

  const alteredFingerprint = structuredClone(valid);
  if (alteredFingerprint.passageValidationResult?.status === "validated") {
    alteredFingerprint.passageValidationResult.groundedCandidate
      .groundingFingerprint = `sha256:${"0".repeat(64)}`;
  }

  for (const mutated of [
    missingCandidate as unknown as FrameworkLensCacheRecord,
    alteredReason as unknown as FrameworkLensCacheRecord,
    malformedCandidate as unknown as FrameworkLensCacheRecord,
    mismatchedCandidate,
    alteredFingerprint,
  ]) {
    const replay = createFrameworkLensService({
      cards: [],
      advisoryCatalog: catalog,
      execution,
      cache: {
        async find(fingerprint) {
          return fingerprint === valid.fingerprint ? mutated : null;
        },
        async save() {},
      },
      client: {
        async complete(request) {
          return JSON.stringify(advisoryOutput(promptCard(request)));
        },
      },
    });
    await assert.rejects(
      replay.runAll(runInput()),
      /cache record.*(?:invalid|passage|grounded|contract|mismatch)/i,
    );
  }
});

function runInput() {
  return {
    candidate,
    pack: evidencePack,
    context,
    calculations: [calculation],
  };
}

function advisoryOutput(card: ExperimentalAdvisoryFrameworkCard) {
  const binding = card.experimentalAdvisory.decisionTaxonomyBindings[0]!;
  const component = card.experimentalAdvisory.components.find(
    ({ frameworkId }) => frameworkId === binding.frameworkId,
  );
  if (!component) throw new Error("Expected an authorized component binding.");
  const sourceRef = component.sourceRefs[0]!;
  return {
    ...advisoryOutputShape(),
    frameworkRuleRefs: [card.id],
    counterevidenceBoundary: {
      kind: "grounded_counterevidence",
      evidenceRequestRefs: [],
    },
    passage: {
      focus: {
        componentFrameworkId: component.frameworkId,
        componentVersion: component.version,
        cardFieldRef: binding.cardFieldRef,
        decisionQuestionCode: binding.decisionQuestionCode,
        evidenceDomainCodes: [...binding.evidenceDomainCodes].sort(),
      },
      premise: {
        text: "VSee applies the public framework premise to a testable company question.",
        componentFrameworkId: component.frameworkId,
        componentVersion: component.version,
        cardFieldRef: binding.cardFieldRef,
        publicSourceIds: [sourceRef.sourceId],
        claimIds: [...sourceRef.claimIds].sort(),
        locator: sourceRef.locator,
        attributionScope: sourceRef.attributionScope,
      },
      caseApplication: {
        text: "Reported customer retention supports the premise through observed company performance.",
        evidenceItemIds: [fact.id],
      },
      countercase: {
        text: "The unverified cohort assumption limits confidence in durability.",
        boundaryKind: "grounded_counterevidence",
        evidenceItemIds: [assumption.id],
        evidenceRequestRefs: [],
      },
      unknownBoundary: {
        text: "Independent customer calls and cohort exports would resolve the saved unknown.",
        judgmentUnknownRefs: [
          "Independent customer calls and cohort exports remain unknown.",
        ],
        judgmentLimitationRefs: [],
        evidenceRequestRefs: [],
      },
      conditionalConclusion: {
        text: "The framework supports further diligence if independent cohorts confirm durability.",
        stance: "supportive",
        advisoryPosture: "supports_further_diligence",
      },
      advisoryContract: {
        formalDecisionWeight: "0",
        noEndorsement: true,
        namedPersonImpersonation: false,
        hiddenChainOfThought: false,
      },
    },
  };
}

function notApplicableAdvisoryOutput(
  card: ExperimentalAdvisoryFrameworkCard,
) {
  const output = advisoryOutput(card);
  return {
    ...output,
    applicability: "not_applicable" as const,
    conclusion: "abstain" as const,
    supportEvidenceItemIds: [],
    counterEvidenceItemIds: [],
    unusedEvidenceItemIds: [fact.id, assumption.id].sort(),
    strongestSupport: null,
    strongestCounterargument: null,
    counterevidenceBoundary: {
      kind: "no_candidate_local_counterevidence" as const,
      evidenceRequestRefs: ["request_if_lens_becomes_applicable"],
    },
    passage: {
      ...output.passage,
      countercase: {
        ...output.passage.countercase,
        boundaryKind: "no_candidate_local_counterevidence" as const,
        evidenceItemIds: [],
        evidenceRequestRefs: ["request_if_lens_becomes_applicable"],
      },
      conditionalConclusion: {
        ...output.passage.conditionalConclusion,
        stance: "abstain" as const,
        advisoryPosture: "abstains" as const,
      },
    },
  };
}

function currentPassageContract() {
  return {
    passageSchemaVersion: NAMED_LENS_PASSAGE_SCHEMA_VERSION,
    generatorVersion: NAMED_LENS_GENERATOR_VERSION,
    decisionTaxonomyVersion: DECISION_TAXONOMY_VERSION,
    decisionTaxonomyDigest: DECISION_TAXONOMY_DIGEST,
  } as const;
}

function advisoryOutputShape() {
  return {
    applicability: "applicable",
    conclusion: "supportive",
    supportEvidenceItemIds: [fact.id],
    counterEvidenceItemIds: [assumption.id],
    unusedEvidenceItemIds: [],
    strongestSupport:
      "Reported customer retention supports part of the named lens.",
    strongestCounterargument:
      "Independent cohort quality remains unverified.",
    unknowns: [
      "Independent customer calls and cohort exports remain unknown.",
    ],
    limitations: [
      "This experimental advisory cannot create a formal investment decision.",
    ],
    confidence: {
      sourceReliability: "medium",
      evidenceStrength: "medium",
      evidenceCoverage: "medium",
      applicability: "high",
      judgment: "medium",
    },
  };
}

function promptPayload(
  request: Parameters<ClaudeClient["complete"]>[0],
): { card: ExperimentalAdvisoryFrameworkCard } {
  const content = request.messages[0]?.content;
  if (typeof content !== "string") {
    throw new Error("Advisory prompt must be text-only.");
  }
  return JSON.parse(content) as {
    card: ExperimentalAdvisoryFrameworkCard;
  };
}

function promptCard(
  request: Parameters<ClaudeClient["complete"]>[0],
): ExperimentalAdvisoryFrameworkCard {
  return promptPayload(request).card;
}

function promptAnyCard(
  request: Parameters<ClaudeClient["complete"]>[0],
): FrameworkCard {
  const content = request.messages[0]?.content;
  if (typeof content !== "string") {
    throw new Error("Framework prompt must be text-only.");
  }
  return (JSON.parse(content) as { card: FrameworkCard }).card;
}

function poisonedAdvisoryJudgment(
  card: ExperimentalAdvisoryFrameworkCard,
  fingerprint: string,
) {
  const id = [
    "framework_judgment",
    candidate.id,
    card.id,
    fingerprint.replace(/^sha256:/, ""),
  ].join(":");
  return {
    id,
    analysisType: "framework_judgment" as const,
    frameworkCardId: card.id,
    frameworkVersion: card.version,
    applicability: "applicable" as const,
    conclusion: "supportive" as const,
    supportEvidenceItemIds: [fact.id],
    counterEvidenceItemIds: [assumption.id],
    unusedEvidenceItemIds: [],
    strongestSupport: "A caller cache tried to inject support.",
    strongestCounterargument: "A caller cache tried to inject counterevidence.",
    unknowns: ["This record was not loader-authorized."],
    limitations: ["Hostile cache probe."],
    confidence: {
      sourceReliability: "high" as const,
      evidenceStrength: "high" as const,
      evidenceCoverage: "high" as const,
      applicability: "high" as const,
      judgment: "high" as const,
    },
    claimEdges: [{
      claimItemId: id,
      dependencyItemId: card.id,
      dependencyType: "framework_ref" as const,
    }],
    frameworkMetadata: card.experimentalAdvisory,
    fingerprint,
  };
}
