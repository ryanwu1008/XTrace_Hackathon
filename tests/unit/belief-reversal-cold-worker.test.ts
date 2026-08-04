import assert from "node:assert/strict";
import test from "node:test";

import {
  preflightBeliefReversalColdWorkerTarget,
  readBeliefReversalColdWorkerConfiguration,
} from "../../scripts/run-belief-reversal-cold-worker";

test("cold Worker accepts only disposable loopback provider and database boundaries", () => {
  assert.deepEqual(readBeliefReversalColdWorkerConfiguration({
    NODE_ENV: "test",
    SUPABASE_URL: "http://127.0.0.1:43123",
    SUPABASE_SERVICE_ROLE_KEY: "test-only-service-role",
    BELIEF_REVERSAL_MARKET_FIXTURE_URL:
      "http://127.0.0.1:43123/__fixture/market",
    BELIEF_REVERSAL_FIXTURE_DATABASE:
      "vsee_belief_browser_0123456789abcdef",
  }), {
    postgrestUrl: "http://127.0.0.1:43123",
    marketSourceUrl: "http://127.0.0.1:43123/__fixture/market",
    serviceRoleKey: "test-only-service-role",
    databaseName: "vsee_belief_browser_0123456789abcdef",
  });
});

test("cold Worker refuses production, localhost aliases, and non-disposable databases", () => {
  const base: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    SUPABASE_URL: "http://127.0.0.1:43123",
    SUPABASE_SERVICE_ROLE_KEY: "test-only-service-role",
    BELIEF_REVERSAL_MARKET_FIXTURE_URL:
      "http://127.0.0.1:43123/__fixture/market",
    BELIEF_REVERSAL_FIXTURE_DATABASE:
      "vsee_belief_browser_0123456789abcdef",
  };
  assert.throws(
    () => readBeliefReversalColdWorkerConfiguration({
      ...base,
      NODE_ENV: "production",
    }),
    /production/u,
  );
  assert.throws(
    () => readBeliefReversalColdWorkerConfiguration({
      ...base,
      SUPABASE_URL: "https://production.example.test",
    }),
    /loopback HTTP/u,
  );
  assert.throws(
    () => readBeliefReversalColdWorkerConfiguration({
      ...base,
      BELIEF_REVERSAL_MARKET_FIXTURE_URL:
        "http://localhost:43123/__fixture/market",
    }),
    /loopback HTTP/u,
  );
  assert.throws(
    () => readBeliefReversalColdWorkerConfiguration({
      ...base,
      BELIEF_REVERSAL_FIXTURE_DATABASE: "postgres",
    }),
    /disposable database identity/u,
  );
});

test("cold Worker verifies the disposable database identity before any startup side effect", async () => {
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    SUPABASE_URL: "http://127.0.0.1:43123",
    SUPABASE_SERVICE_ROLE_KEY: "test-only-service-role",
    BELIEF_REVERSAL_MARKET_FIXTURE_URL:
      "http://127.0.0.1:43123/__fixture/market",
    BELIEF_REVERSAL_FIXTURE_DATABASE:
      "vsee_belief_browser_0123456789abcdef",
  };
  let startupSideEffects = 0;
  await assert.rejects(async () => {
    await preflightBeliefReversalColdWorkerTarget({
      environment,
      fetchImpl: async (request, init) => {
        assert.equal(
          String(request),
          "http://127.0.0.1:43123/rpc/__vsee_task12_database_identity",
        );
        assert.equal(init?.method, "POST");
        return Response.json("vsee_different_0123456789abcdef");
      },
    });
    startupSideEffects += 1;
  }, /database identity mismatch/u);
  assert.equal(startupSideEffects, 0);

  const configuration = await preflightBeliefReversalColdWorkerTarget({
    environment,
    fetchImpl: async () => Response.json(
      "vsee_belief_browser_0123456789abcdef",
    ),
  });
  assert.equal(
    configuration.databaseName,
    "vsee_belief_browser_0123456789abcdef",
  );
});

test("cold Worker production rejection occurs before the identity request", async () => {
  let identityRequests = 0;
  await assert.rejects(
    preflightBeliefReversalColdWorkerTarget({
      environment: {
        NODE_ENV: "production",
        SUPABASE_URL: "http://127.0.0.1:43123",
        SUPABASE_SERVICE_ROLE_KEY: "test-only-service-role",
        BELIEF_REVERSAL_MARKET_FIXTURE_URL:
          "http://127.0.0.1:43123/__fixture/market",
        BELIEF_REVERSAL_FIXTURE_DATABASE:
          "vsee_belief_browser_0123456789abcdef",
      },
      fetchImpl: async () => {
        identityRequests += 1;
        return Response.json("vsee_belief_browser_0123456789abcdef");
      },
    }),
    /production/u,
  );
  assert.equal(identityRequests, 0);
});
