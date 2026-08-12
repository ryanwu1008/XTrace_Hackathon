import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  resolveBeliefReversalBrowserFixtureWorkerBindings,
} from "../../build/browser-fixture-worker-bindings";
import {
  createMemoryPrivateObjectStorage,
  type PrivateObjectStorage,
} from "../../lib/storage/service";
import * as browserFixture from "../../scripts/run-belief-reversal-browser-fixture";
import {
  buildBeliefReversalBrowserFixtureEnvironment,
  buildBeliefReversalBrowserFixtureAnnouncement,
  buildBeliefReversalBrowserFixtureWebArguments,
  buildBeliefReversalHostedSitesEnvironment,
  createBeliefReversalBrowserFixtureSignalLatch,
  createIdempotentBrowserFixtureCleanup,
  handleBeliefReversalBrowserFixtureRequest,
  waitForBeliefReversalBrowserFixtureStop,
} from "../../scripts/run-belief-reversal-browser-fixture";

test("browser fixture refuses to fall back to a different web port", () => {
  assert.deepEqual(
    buildBeliefReversalBrowserFixtureWebArguments(3_100),
    ["dev", "-H", "127.0.0.1", "-p", "3100", "--strictPort"],
  );
});

test("browser fixture refuses ignored runtime credential files before provisioning", () => {
  const repositoryRoot = mkdtempSync(
    path.join(tmpdir(), "vsee-browser-fixture-credentials-"),
  );
  try {
    writeFileSync(
      path.join(repositoryRoot, ".env.local"),
      "SUPABASE_URL=https://production.example.test\n",
      { encoding: "utf8", mode: 0o600 },
    );
    const assertCredentialIsolation = Reflect.get(
      browserFixture,
      "assertBeliefReversalBrowserFixtureCredentialIsolation",
    ) as undefined | ((root: string) => void);

    assert.equal(typeof assertCredentialIsolation, "function");
    assert.throws(
      () => assertCredentialIsolation!(repositoryRoot),
      /refuses ignored credential file \.env\.local/u,
    );
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test("browser fixture refuses Wrangler dev-var credentials before provisioning", () => {
  const repositoryRoot = mkdtempSync(
    path.join(tmpdir(), "vsee-browser-fixture-dev-vars-"),
  );
  try {
    writeFileSync(
      path.join(repositoryRoot, ".dev.vars"),
      "ANTHROPIC_API_KEY=production-anthropic-secret\n",
      { encoding: "utf8", mode: 0o600 },
    );

    assert.throws(
      () =>
        browserFixture.assertBeliefReversalBrowserFixtureCredentialIsolation(
          repositoryRoot,
        ),
      /refuses ignored credential file \.dev\.vars/u,
    );
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test("browser fixture child environment keeps only loopback test configuration and strips provider credentials", () => {
  const environment = buildBeliefReversalBrowserFixtureEnvironment({
    inheritedEnvironment: {
      PATH: "/usr/local/bin:/usr/bin:/bin",
      HOME: "/tmp/browser-fixture-home",
      TMPDIR: "/tmp/browser-fixture",
      ANTHROPIC_API_KEY: "production-anthropic-secret",
      XTRACE_API_KEY: "mmk_production-secret",
      XTRACE_ORG_ID: "production-org",
      CRUNCHBASE_API_KEY: "production-crunchbase-secret",
      SUPABASE_URL: "https://production.example.test",
      SUPABASE_SERVICE_ROLE_KEY: "production-service-role-secret",
      VSEE_DEPLOYMENT_MODE: "product",
    },
    proxyUrl: "http://127.0.0.1:43123",
    serviceRoleKey: "task14-test-only-service-role-jwt",
    webUrl: "http://127.0.0.1:3100",
    resourceSuffix: "0123456789abcdef",
    databaseName: "vsee_belief_browser_0123456789abcdef",
  });

  assert.deepEqual(environment, {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME:
      "/tmp/browser-fixture/vsee-belief-reversal-browser-0123456789abcdef-home",
    XDG_CONFIG_HOME:
      "/tmp/browser-fixture/vsee-belief-reversal-browser-0123456789abcdef-home/.config",
    TMPDIR: "/tmp/browser-fixture",
    NODE_ENV: "development",
    BELIEF_REVERSAL_BROWSER_FIXTURE_RUNTIME: "1",
    PUBLIC_APP_URL: "http://127.0.0.1:3100",
    VSEE_DEPLOYMENT_MODE: "public_sandbox",
    DEMO_WORKSPACE_ID: "workspace_demo",
    SUPABASE_URL: "http://127.0.0.1:43123",
    SUPABASE_SERVICE_ROLE_KEY: "task14-test-only-service-role-jwt",
    SUPABASE_STORAGE_BUCKET: "vsee-demo-sources",
    DOCUMENT_URL_SIGNING_SECRET:
      "vsee-task14-test-only-document-signing-secret-0123456789abcdef",
    ANTHROPIC_MODEL: "claude-opus-4-8",
    ANTHROPIC_API_KEY:
      "belief-reversal-test-only-anthropic-0123456789abcdef",
    XTRACE_API_KEY: "mmk_test_only_0123456789abcdef",
    XTRACE_APP_ID: "xtrace-belief-reversal-browser-0123456789abcdef",
    XTRACE_DRY_RUN: "1",
    MARKET_USER_AGENT: "VSee belief-reversal browser fixture",
    MARKET_OFFICIAL_FEEDS_JSON: "[]",
    MARKET_PUBLISHER_FEEDS_JSON: "[]",
    WORKER_ID: "belief-reversal-browser-0123456789abcdef",
    BELIEF_REVERSAL_MARKET_FIXTURE_URL:
      "http://127.0.0.1:43123/__fixture/market",
    BELIEF_REVERSAL_FIXTURE_DATABASE:
      "vsee_belief_browser_0123456789abcdef",
    WORKER_HEALTH_FILE:
      "/tmp/browser-fixture/vsee-belief-reversal-browser-0123456789abcdef.health",
    CLOUDFLARE_VITE_FORCE_LOCAL: "true",
    WRANGLER_LOG_PATH: ".wrangler/wrangler.log",
  });
  assert.notEqual(environment.HOME, "/tmp/browser-fixture-home");
  assert.notEqual(
    environment.ANTHROPIC_API_KEY,
    "production-anthropic-secret",
  );
  assert.notEqual(environment.XTRACE_API_KEY, "mmk_production-secret");
  for (const secretName of ["XTRACE_ORG_ID", "CRUNCHBASE_API_KEY"]) {
    assert.equal(secretName in environment, false);
  }
});

test("browser fixture exposes its allowlisted child environment as local Worker bindings only behind the fixture sentinel", () => {
  const child = buildBeliefReversalBrowserFixtureEnvironment({
    inheritedEnvironment: { PATH: "/usr/bin:/bin" },
    proxyUrl: "http://127.0.0.1:43123",
    serviceRoleKey: "task14-test-only-service-role-jwt",
    webUrl: "http://127.0.0.1:3100",
    resourceSuffix: "0123456789abcdef",
    databaseName: "vsee_belief_browser_0123456789abcdef",
  });

  assert.equal(
    resolveBeliefReversalBrowserFixtureWorkerBindings({
      ...child,
      BELIEF_REVERSAL_BROWSER_FIXTURE_RUNTIME: undefined,
    }),
    undefined,
  );
  assert.deepEqual(
    resolveBeliefReversalBrowserFixtureWorkerBindings(child),
    {
      PUBLIC_APP_URL: "http://127.0.0.1:3100",
      VSEE_DEPLOYMENT_MODE: "public_sandbox",
      DEMO_WORKSPACE_ID: "workspace_demo",
      SUPABASE_URL: "http://127.0.0.1:43123",
      SUPABASE_SERVICE_ROLE_KEY: "task14-test-only-service-role-jwt",
      SUPABASE_STORAGE_BUCKET: "vsee-demo-sources",
      DOCUMENT_URL_SIGNING_SECRET:
        "vsee-task14-test-only-document-signing-secret-0123456789abcdef",
      ANTHROPIC_MODEL: "claude-opus-4-8",
      ANTHROPIC_API_KEY:
        "belief-reversal-test-only-anthropic-0123456789abcdef",
      BELIEF_REVERSAL_BROWSER_FIXTURE_RUNTIME: "1",
      XTRACE_API_KEY: "mmk_test_only_0123456789abcdef",
      XTRACE_APP_ID: "xtrace-belief-reversal-browser-0123456789abcdef",
      XTRACE_DRY_RUN: "1",
      MARKET_USER_AGENT: "VSee belief-reversal browser fixture",
      MARKET_OFFICIAL_FEEDS_JSON: "[]",
      MARKET_PUBLISHER_FEEDS_JSON: "[]",
    },
  );
});

test("hosted Sites handoff exports only disposable fixture values and defers public URLs", () => {
  const child = buildBeliefReversalBrowserFixtureEnvironment({
    inheritedEnvironment: {
      PATH: "/usr/local/bin:/usr/bin:/bin",
      ANTHROPIC_API_KEY: "production-anthropic-secret",
      SUPABASE_SERVICE_ROLE_KEY: "production-service-role-secret",
    },
    proxyUrl: "http://127.0.0.1:43123",
    serviceRoleKey: "task14-test-only-service-role-jwt",
    webUrl: "http://127.0.0.1:3100",
    resourceSuffix: "0123456789abcdef",
    databaseName: "vsee_belief_browser_0123456789abcdef",
  });

  const hosted = buildBeliefReversalHostedSitesEnvironment(child);

  assert.deepEqual(hosted, {
    VSEE_DEPLOYMENT_MODE: "public_sandbox",
    DEMO_WORKSPACE_ID: "workspace_demo",
    SUPABASE_SERVICE_ROLE_KEY: "task14-test-only-service-role-jwt",
    SUPABASE_STORAGE_BUCKET: "vsee-demo-sources",
    DOCUMENT_URL_SIGNING_SECRET:
      "vsee-task14-test-only-document-signing-secret-0123456789abcdef",
    ANTHROPIC_MODEL: "claude-opus-4-8",
    ANTHROPIC_API_KEY:
      "belief-reversal-test-only-anthropic-0123456789abcdef",
    XTRACE_API_KEY: "mmk_test_only_0123456789abcdef",
    XTRACE_APP_ID: "xtrace-belief-reversal-browser-0123456789abcdef",
    XTRACE_DRY_RUN: "1",
    MARKET_USER_AGENT: "VSee belief-reversal browser fixture",
    MARKET_OFFICIAL_FEEDS_JSON: "[]",
    MARKET_PUBLISHER_FEEDS_JSON: "[]",
  });
  assert.equal("SUPABASE_URL" in hosted, false);
  assert.equal("PUBLIC_APP_URL" in hosted, false);
  assert.equal(JSON.stringify(hosted).includes("production-"), false);
});

test("browser fixture proxies the app REST prefix to standalone loopback PostgREST", async () => {
  const objectStorage = createMemoryPrivateObjectStorage();
  const upstreamRequests: Request[] = [];
  const response = await handleBeliefReversalBrowserFixtureRequest({
    request: new Request(
      "http://127.0.0.1:43123/rest/v1/rpc/browser_fixture_probe?limit=1",
      {
        method: "POST",
        headers: {
          apikey: "test-service-role",
          authorization: "Bearer test-service-role",
          "content-type": "application/json",
        },
        body: JSON.stringify({ companyName: "Henry AI" }),
      },
    ),
    postgrestUrl: "http://127.0.0.1:49154",
    objectStorage,
    serviceRoleKey: "test-service-role",
    fetchImpl: (async (request, init) => {
      upstreamRequests.push(new Request(request, init));
      return Response.json({ ok: true }, { status: 201 });
    }) as typeof fetch,
  });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true });
  const upstreamRequest = upstreamRequests[0];
  assert.ok(upstreamRequest);
  assert.equal(
    upstreamRequest.url,
    "http://127.0.0.1:49154/rpc/browser_fixture_probe?limit=1",
  );
  assert.equal(upstreamRequest.method, "POST");
  assert.equal(
    upstreamRequest.headers.get("apikey"),
    "test-service-role",
  );
  assert.equal(
    upstreamRequest.headers.get("authorization"),
    "Bearer test-service-role",
  );
  assert.deepEqual(await upstreamRequest.json(), { companyName: "Henry AI" });
});

test("browser fixture refuses REST requests without the exact fixture credentials before contacting PostgREST", async () => {
  const objectStorage = createMemoryPrivateObjectStorage();
  let upstreamCalls = 0;
  const response = await handleBeliefReversalBrowserFixtureRequest({
    request: new Request(
      "http://127.0.0.1:43123/rest/v1/rpc/browser_fixture_probe",
      {
        headers: { apikey: "fixture-service-role" },
      },
    ),
    postgrestUrl: "http://127.0.0.1:49154",
    objectStorage,
    serviceRoleKey: "fixture-service-role",
    fetchImpl: (async () => {
      upstreamCalls += 1;
      return new Response("unexpected");
    }) as typeof fetch,
  });

  assert.equal(response.status, 401);
  assert.equal(upstreamCalls, 0);
  assert.doesNotMatch(await response.text(), /fixture-service-role/u);

  const missingApiKey = await handleBeliefReversalBrowserFixtureRequest({
    request: new Request(
      "http://127.0.0.1:43123/rest/v1/rpc/browser_fixture_probe",
      { headers: { authorization: "Bearer fixture-service-role" } },
    ),
    postgrestUrl: "http://127.0.0.1:49154",
    objectStorage,
    serviceRoleKey: "fixture-service-role",
    fetchImpl: (async () => {
      upstreamCalls += 1;
      return new Response("unexpected");
    }) as typeof fetch,
  });
  assert.equal(missingApiKey.status, 401);
  assert.equal(upstreamCalls, 0);
});

test("browser fixture refuses storage requests with an incorrect fixture credential before reading bytes", async () => {
  let reads = 0;
  const objectStorage = {
    async readPrivateObject() {
      reads += 1;
      return new Uint8Array([1]);
    },
    async ensurePrivateObject() {
      throw new Error("unexpected storage write");
    },
  } as unknown as PrivateObjectStorage;
  const response = await handleBeliefReversalBrowserFixtureRequest({
    request: new Request(
      "http://127.0.0.1:43123/storage/v1/object/vsee-demo-sources/private.json",
      {
        headers: {
          apikey: "fixture-service-role",
          authorization: "Bearer wrong-fixture-service-role",
        },
      },
    ),
    postgrestUrl: "http://127.0.0.1:49154",
    objectStorage,
    serviceRoleKey: "fixture-service-role",
  });

  assert.equal(response.status, 403);
  assert.equal(reads, 0);
  assert.doesNotMatch(await response.text(), /fixture-service-role/u);
});

test("browser fixture rejects REST network-path references before forwarding credentials", async () => {
  const objectStorage = createMemoryPrivateObjectStorage();
  let upstreamCalls = 0;
  const response = await handleBeliefReversalBrowserFixtureRequest({
    request: new Request(
      "http://127.0.0.1:43123/rest/v1//attacker.example.test/leak",
      {
        headers: {
          apikey: "disposable-service-role",
          authorization: "Bearer disposable-service-role",
        },
      },
    ),
    postgrestUrl: "http://127.0.0.1:49154",
    objectStorage,
    serviceRoleKey: "disposable-service-role",
    fetchImpl: (async () => {
      upstreamCalls += 1;
      return new Response("unexpected");
    }) as typeof fetch,
  });

  assert.equal(response.status, 400);
  assert.equal(upstreamCalls, 0);
});

test("browser fixture serves the exact private source bytes from its test-only storage endpoint", async () => {
  const objectStorage = createMemoryPrivateObjectStorage();
  const bytes = new TextEncoder().encode("permanent source revision bytes");
  await objectStorage.ensurePrivateObject({
    key: "belief-reversal/henry-ai/source.json",
    bytes,
    contentType: "application/json",
  });

  const response = await handleBeliefReversalBrowserFixtureRequest({
    request: new Request(
      "http://127.0.0.1:43123/storage/v1/object/vsee-demo-sources/belief-reversal/henry-ai/source.json",
      {
        headers: {
          apikey: "fixture-storage-service-role",
          authorization: "Bearer fixture-storage-service-role",
        },
      },
    ),
    postgrestUrl: "http://127.0.0.1:49154",
    objectStorage,
    serviceRoleKey: "fixture-storage-service-role",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);

  const wrongBucket = await handleBeliefReversalBrowserFixtureRequest({
    request: new Request(
      "http://127.0.0.1:43123/storage/v1/object/production-bucket/belief-reversal/henry-ai/source.json",
      {
        headers: {
          apikey: "fixture-storage-service-role",
          authorization: "Bearer fixture-storage-service-role",
        },
      },
    ),
    postgrestUrl: "http://127.0.0.1:49154",
    objectStorage,
    serviceRoleKey: "fixture-storage-service-role",
  });
  assert.equal(wrongBucket.status, 404);
});

test("browser fixture exposes the controlled live market source independently of the pinned report", async () => {
  const response = await handleBeliefReversalBrowserFixtureRequest({
    request: new Request(
      "http://127.0.0.1:43123/__fixture/market?from=2026-07-20T12%3A00%3A00.000Z&to=2026-08-03T12%3A00%3A00.000Z",
    ),
    postgrestUrl: "http://127.0.0.1:49154",
    objectStorage: createMemoryPrivateObjectStorage(),
    serviceRoleKey: "unused-market-service-role",
  });

  assert.equal(response.status, 200);
  const items = await response.json() as Array<Record<string, unknown>>;
  assert.equal(items.length, 11);
  assert.ok(items.every((item) => item.collectedAt === "2026-08-03T12:00:00.000Z"));
  assert.ok(items.every((item) => !("snapshotId" in item)));
});

test("browser fixture cleanup runs every resource cleanup exactly once in reverse ownership order", async () => {
  const calls: string[] = [];
  const cleanup = createIdempotentBrowserFixtureCleanup([
    async () => {
      calls.push("database");
    },
    async () => {
      calls.push("proxy");
    },
    async () => {
      calls.push("worker");
    },
    async () => {
      calls.push("web");
    },
  ]);

  await Promise.all([cleanup(), cleanup(), cleanup()]);
  await cleanup();

  assert.deepEqual(calls, ["web", "worker", "proxy", "database"]);
});

test("browser fixture cleanup fails when a child survives SIGKILL", async () => {
  const signals: NodeJS.Signals[] = [];
  const child = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill(signal: NodeJS.Signals) {
      signals.push(signal);
      return true;
    },
  });
  const terminateChild = Reflect.get(
    browserFixture,
    "terminateBeliefReversalBrowserFixtureChild",
  ) as unknown as undefined | ((
    process: typeof child,
    options: {
      gracefulTimeoutMs: number;
      forceTimeoutMs: number;
      delayImpl(milliseconds: number): Promise<void>;
    },
  ) => Promise<void>);

  assert.equal(typeof terminateChild, "function");
  await assert.rejects(
    () => terminateChild!(child, {
      gracefulTimeoutMs: 1,
      forceTimeoutMs: 1,
      delayImpl: async () => {},
    }),
    /did not exit after SIGKILL/u,
  );
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(child.listenerCount("exit"), 0);
  assert.equal(child.listenerCount("error"), 0);
});

test("browser fixture fails closed when a child endpoint is not exact loopback", () => {
  assert.throws(
    () => buildBeliefReversalBrowserFixtureEnvironment({
      inheritedEnvironment: {},
      proxyUrl: "https://production.example.test",
      serviceRoleKey: "test-only-key",
      webUrl: "http://127.0.0.1:3100",
      resourceSuffix: "0123456789abcdef",
      databaseName: "vsee_belief_browser_0123456789abcdef",
    }),
    /proxy URL must use an exact loopback origin/u,
  );
  assert.throws(
    () => buildBeliefReversalBrowserFixtureEnvironment({
      inheritedEnvironment: {},
      proxyUrl: "http://127.0.0.1:43123",
      serviceRoleKey: "test-only-key",
      webUrl: "http://localhost:3100",
      resourceSuffix: "0123456789abcdef",
      databaseName: "vsee_belief_browser_0123456789abcdef",
    }),
    /web URL must use an exact loopback origin/u,
  );
});

test("browser fixture announcement exposes only the UI handoff identifiers", () => {
  const announcement = buildBeliefReversalBrowserFixtureAnnouncement({
    webUrl: "http://127.0.0.1:3100",
    gatewayUrl: "http://127.0.0.1:43123",
    stagingEnvironmentPath: "/repo/.runtime/browser-staging-env.json",
    baselineReportId: "report-pinned-replay",
    baselineRunId: "run-pinned-replay",
    databaseName: "vsee_test_belief_browser_0123456789abcdef",
    migrationTerminal: "0023_belief_reversal",
    webLogPath: "/repo/.runtime/browser-web.log",
    workerLogPath: "/repo/.runtime/browser-worker.log",
  });

  assert.deepEqual(announcement, {
    status: "ready",
    acceptance: "click_wake_agent_and_scan_market",
    url: "http://127.0.0.1:3100/",
    gatewayUrl: "http://127.0.0.1:43123/",
    stagingEnvironmentPath: "/repo/.runtime/browser-staging-env.json",
    baselineReportId: "report-pinned-replay",
    baselineRunId: "run-pinned-replay",
    databaseName: "vsee_test_belief_browser_0123456789abcdef",
    migrationTerminal: "0023_belief_reversal",
    webLogPath: "/repo/.runtime/browser-web.log",
    workerLogPath: "/repo/.runtime/browser-worker.log",
  });
  assert.doesNotMatch(JSON.stringify(announcement), /secret|service-role|api-key/iu);
});

test("browser fixture stop waiter resolves on SIGINT and removes all lifecycle listeners", async () => {
  const signalSource = new EventEmitter();
  const child = new EventEmitter();
  const stopped = waitForBeliefReversalBrowserFixtureStop({
    signalSource,
    children: [{ name: "web", events: child }],
  });

  signalSource.emit("SIGINT");

  assert.deepEqual(await stopped, { kind: "signal", signal: "SIGINT" });
  assert.equal(signalSource.listenerCount("SIGINT"), 0);
  assert.equal(signalSource.listenerCount("SIGTERM"), 0);
  assert.equal(child.listenerCount("exit"), 0);
  assert.equal(child.listenerCount("error"), 0);
});

test("browser fixture stop waiter observes a signal latched before lifecycle listeners attach", async () => {
  const signalSource = new EventEmitter();
  const child = new EventEmitter();
  const latch = createBeliefReversalBrowserFixtureSignalLatch(signalSource);
  signalSource.emit("SIGTERM");

  const stopped = waitForBeliefReversalBrowserFixtureStop({
    signalSource,
    children: [{ name: "web", events: child }],
    getLatchedSignal: () => latch.signal,
  });
  child.emit("exit");

  assert.deepEqual(await stopped, { kind: "signal", signal: "SIGTERM" });
  latch.dispose();
});

test("browser fixture stop waiter observes a child that exited before listeners attach", async () => {
  const signalSource = new EventEmitter();
  const child = new EventEmitter();
  const stopped = waitForBeliefReversalBrowserFixtureStop({
    signalSource,
    children: [{
      name: "web",
      events: child,
      state: { exitCode: 1, signalCode: null },
    }],
  });
  const result = await Promise.race([
    stopped,
    new Promise<"missed_exit">((resolve) => {
      setImmediate(() => resolve("missed_exit"));
    }),
  ]);
  if (result === "missed_exit") signalSource.emit("SIGINT");

  assert.deepEqual(result, { kind: "child_exit", child: "web" });
  assert.equal(signalSource.listenerCount("SIGINT"), 0);
  assert.equal(signalSource.listenerCount("SIGTERM"), 0);
  assert.equal(child.listenerCount("exit"), 0);
  assert.equal(child.listenerCount("error"), 0);
});

test("browser fixture latches an early signal until the current disposable operation can clean up", () => {
  const signalSource = new EventEmitter();
  const latch = createBeliefReversalBrowserFixtureSignalLatch(signalSource);

  signalSource.emit("SIGTERM");

  assert.equal(latch.signal, "SIGTERM");
  assert.throws(
    () => latch.throwIfRequested(),
    /interrupted by SIGTERM/u,
  );
  latch.dispose();
  assert.equal(signalSource.listenerCount("SIGINT"), 0);
  assert.equal(signalSource.listenerCount("SIGTERM"), 0);
});
