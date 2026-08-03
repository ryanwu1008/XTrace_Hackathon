import assert from "node:assert/strict";
import test from "node:test";

import { buildPreloadedDealMemoryBundles } from "../../lib/corpus/service";
import type { RecallDealContextInput } from "../../lib/xtrace/service";
import {
  dealRecallQuery,
  recallAllDealContexts,
} from "../../worker/recall-deal-contexts";

test("recalls one bounded XTrace query for every MVP Deal", async () => {
  const queries: RecallDealContextInput[] = [];
  const result = await recallAllDealContexts({
    workspaceId: "workspace_demo",
    runId: "00000000-0000-4000-8000-000000000001",
    bundles: buildPreloadedDealMemoryBundles(),
    service: {
      async recallDealContext(input) {
        queries.push(input);
        return [{
          dealId: input.candidateDealIds[0],
          memoryId: `memory_${input.candidateDealIds[0]}`,
          memoryType: "fact",
          text: "Source-backed investment context.",
          score: 0.9,
          provenance: "source_document",
          sourceIds: [`source_${input.candidateDealIds[0]}`],
          fixtureIds: [],
        }];
      },
    },
  });

  assert.equal(queries.length, 19);
  assert.ok(queries.every((query) => query.query.length <= 4_000));
  assert.ok(queries.every((query) => query.candidateDealIds.length === 1));
  assert.ok(queries.every((query) => query.limit === 20));
  assert.ok(queries.every((query) =>
    query.runId === "00000000-0000-4000-8000-000000000001"
  ));
  assert.equal(result.contextsByDeal.size, 19);
  assert.equal(result.failures.length, 0);
});

test("one failed recall does not suppress the other eighteen Deals", async () => {
  const bundles = buildPreloadedDealMemoryBundles();
  const failedDealId = bundles[0].dealId;
  const result = await recallAllDealContexts({
    workspaceId: "workspace_demo",
    runId: "00000000-0000-4000-8000-000000000001",
    bundles,
    service: {
      async recallDealContext(input) {
        if (input.candidateDealIds[0] === failedDealId) {
          throw new Error("provider secret should not be copied");
        }
        return [{
          dealId: input.candidateDealIds[0],
          memoryId: `memory_${input.candidateDealIds[0]}`,
          memoryType: "fact",
          text: "Source-backed investment context.",
          score: 0.9,
          provenance: "source_document",
          sourceIds: [`source_${input.candidateDealIds[0]}`],
          fixtureIds: [],
        }];
      },
    },
  });

  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].dealId, failedDealId);
  assert.doesNotMatch(result.failures[0].message, /provider secret/i);
  assert.equal(result.contextsByDeal.size, 18);
});

test("a transient recall failure recovers on the single retry", async () => {
  const bundles = buildPreloadedDealMemoryBundles();
  const flakyDealId = bundles[0].dealId;
  let flakyCalls = 0;
  const result = await recallAllDealContexts({
    workspaceId: "workspace_demo",
    runId: "00000000-0000-4000-8000-000000000001",
    bundles,
    service: {
      async recallDealContext(input) {
        if (input.candidateDealIds[0] === flakyDealId) {
          flakyCalls += 1;
          if (flakyCalls === 1) throw new Error("transient provider timeout");
        }
        return [{
          dealId: input.candidateDealIds[0],
          memoryId: `memory_${input.candidateDealIds[0]}`,
          memoryType: "fact",
          text: "Source-backed investment context.",
          score: 0.9,
          provenance: "source_document",
          sourceIds: [`source_${input.candidateDealIds[0]}`],
          fixtureIds: [],
        }];
      },
    },
  });

  assert.equal(flakyCalls, 2);
  assert.equal(result.failures.length, 0);
  assert.equal(result.contextsByDeal.size, 19);
});

test("recall queries carry each Deal's own decision context, not only template words", () => {
  const bundles = buildPreloadedDealMemoryBundles();
  for (const bundle of bundles) {
    const query = dealRecallQuery(bundle);
    assert.ok(query.length <= 4_000);
    assert.ok(query.includes(bundle.companyName));
    const interaction = bundle.interactions[0];
    if (interaction) {
      assert.ok(
        query.includes(interaction.decisionReason),
        `${bundle.dealId} query must include its decision reason so similarity `
        + "search can rank the Deal's own memories above other Deals' "
        + "template phrasing",
      );
    }
    const fact = bundle.facts[0];
    if (fact) {
      assert.ok(
        query.includes(fact.text.slice(0, 60)),
        `${bundle.dealId} query must include source-backed fact text`,
      );
    }
  }
});

test("missing XTrace service marks every Deal unavailable without local fallback", async () => {
  const result = await recallAllDealContexts({
    workspaceId: "workspace_demo",
    runId: "00000000-0000-4000-8000-000000000001",
    bundles: buildPreloadedDealMemoryBundles(),
  });

  assert.equal(result.contextsByDeal.size, 0);
  assert.equal(result.failures.length, 19);
  assert.ok(result.failures.every((failure) =>
    failure.message === "XTRACE_SERVICE_UNAVAILABLE"
  ));
});

test("non-retryable recall failures are not retried", async () => {
  const { XTraceUnavailableError } = await import("../../lib/xtrace/service");
  const bundles = buildPreloadedDealMemoryBundles();
  const failedDealId = bundles[0].dealId;
  let failedCalls = 0;
  const result = await recallAllDealContexts({
    workspaceId: "workspace_demo",
    runId: "00000000-0000-4000-8000-000000000001",
    bundles,
    service: {
      async recallDealContext(input) {
        if (input.candidateDealIds[0] === failedDealId) {
          failedCalls += 1;
          throw new XTraceUnavailableError(false, "malformed search response");
        }
        return [{
          dealId: input.candidateDealIds[0],
          memoryId: `memory_${input.candidateDealIds[0]}`,
          memoryType: "fact",
          text: "Source-backed investment context.",
          score: 0.9,
          provenance: "source_document",
          sourceIds: [`source_${input.candidateDealIds[0]}`],
          fixtureIds: [],
        }];
      },
    },
  });

  assert.equal(failedCalls, 1, "non-retryable failures must not be retried");
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].dealId, failedDealId);
  assert.equal(result.contextsByDeal.size, 18);
});

test("runs all 23 primary recalls before spending only two global transient retries", async () => {
  const original = buildPreloadedDealMemoryBundles();
  const bundles = [
    ...original,
    ...original.slice(0, 4).map((bundle, index) => ({
      ...structuredClone(bundle),
      dealId: `deal_reversal_${index + 1}`,
      companyName: `Reversal Company ${index + 1}`,
    })),
  ];
  const transientDealIds = new Set(bundles.slice(0, 3).map((bundle) => bundle.dealId));
  const attempts = new Map<string, number>();
  const calls: string[] = [];

  const result = await recallAllDealContexts({
    workspaceId: "workspace_demo",
    runId: "00000000-0000-4000-8000-000000000001",
    bundles,
    service: {
      async recallDealContext(input) {
        const dealId = input.candidateDealIds[0];
        calls.push(dealId);
        const attempt = (attempts.get(dealId) ?? 0) + 1;
        attempts.set(dealId, attempt);
        if (transientDealIds.has(dealId) && attempt === 1) {
          const { XTraceUnavailableError } = await import("../../lib/xtrace/service");
          throw new XTraceUnavailableError(true, "temporary outage");
        }
        return [];
      },
    },
  });

  assert.deepEqual(
    calls.slice(0, 23),
    bundles.map((bundle) => bundle.dealId),
    "capacity must be available for every primary before any retry",
  );
  assert.equal(calls.length, 25, "the entire run has only two retry requests");
  assert.deepEqual(calls.slice(23), bundles.slice(0, 2).map((bundle) => bundle.dealId));
  assert.deepEqual(result.failures.map((failure) => failure.dealId), [bundles[2].dealId]);
});

test("23 successful Deals use exactly 23 search requests", async () => {
  const original = buildPreloadedDealMemoryBundles();
  const bundles = [
    ...original,
    ...original.slice(0, 4).map((bundle, index) => ({
      ...structuredClone(bundle),
      dealId: `deal_success_${index + 1}`,
      companyName: `Success Company ${index + 1}`,
    })),
  ];
  let calls = 0;
  const result = await recallAllDealContexts({
    workspaceId: "workspace_demo",
    runId: "00000000-0000-4000-8000-000000000001",
    bundles,
    service: {
      async recallDealContext(input) {
        calls += 1;
        return [{
          dealId: input.candidateDealIds[0],
          memoryId: `memory_${input.candidateDealIds[0]}`,
          memoryType: "fact",
          text: "Exact context.",
          score: 0.9,
          provenance: "source_document",
          sourceRevisionIds: [`revision_${input.candidateDealIds[0]}`],
          sourceIds: [`source_${input.candidateDealIds[0]}`],
          fixtureIds: [],
        }];
      },
    },
  });

  assert.equal(calls, 23);
  assert.equal(result.contextsByDeal.size, 23);
  assert.equal(result.failures.length, 0);
});
