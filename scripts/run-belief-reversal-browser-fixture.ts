import { spawn, type ChildProcess } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { type EventEmitter, once } from "node:events";
import {
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { PrivateObjectStorage } from "../lib/storage/service";
import {
  buildBeliefReversalDockerPlan,
  createStandalonePostgrestRepositoryFetch,
  discoverMigrationPlan,
  probeBeliefReversalE2EAvailability,
  provisionBeliefReversalE2EInfrastructure,
  runHarnessCommand,
} from "../tests/helpers/belief-reversal-e2e-harness";
import {
  createBeliefReversalE2EDataRuntime,
  seedAndVerifyBeliefReversalE2EData,
} from "../tests/helpers/belief-reversal-e2e-data";
import {
  runBeliefReversalPinnedPipeline,
} from "../tests/helpers/belief-reversal-e2e-pipeline";
import {
  makeDisposableDatabaseName,
} from "../tests/helpers/require-loopback-postgres";
import {
  buildBeliefReversalLiveMarketPackets,
} from "../tests/helpers/belief-reversal-live-market";

type BrowserFixtureEnvironmentInput = {
  inheritedEnvironment: Readonly<Record<string, string | undefined>>;
  proxyUrl: string;
  serviceRoleKey: string;
  webUrl: string;
  resourceSuffix: string;
  databaseName: string;
};

type BrowserFixtureChildEnvironment = Record<string, string> & {
  NODE_ENV: "development";
};

export function assertBeliefReversalBrowserFixtureCredentialIsolation(
  repositoryRoot: string,
): void {
  let entries: string[];
  try {
    entries = readdirSync(repositoryRoot);
  } catch {
    throw new Error(
      "Browser fixture could not inspect the repository credential-file boundary.",
    );
  }
  const blocked = entries.filter((entry) =>
    (
      (entry === ".env" || entry.startsWith(".env."))
      && entry !== ".env.example"
    ) || (
      (entry === ".dev.vars" || entry.startsWith(".dev.vars."))
      && entry !== ".dev.vars.example"
    )
  ).sort();
  if (blocked.length > 0) {
    throw new Error(
      `Browser fixture refuses ignored credential file ${blocked[0]}.`,
    );
  }
}

export function buildBeliefReversalBrowserFixtureEnvironment(
  input: BrowserFixtureEnvironmentInput,
): BrowserFixtureChildEnvironment {
  const proxyUrl = assertExactLoopbackOrigin(input.proxyUrl, "proxy").origin;
  const webUrl = assertExactLoopbackOrigin(input.webUrl, "web").origin;
  if (!/^[0-9a-f]{16}$/u.test(input.resourceSuffix)) {
    throw new Error("Browser fixture resource suffix must be 16 hexadecimal characters.");
  }
  if (!input.serviceRoleKey.trim()) {
    throw new Error("Browser fixture requires a test-only service role key.");
  }
  if (!/^vsee_[a-z0-9_]{1,37}_[0-9a-f]{16}$/u.test(input.databaseName)) {
    throw new Error("Browser fixture requires an exact disposable database identity.");
  }
  const temporaryDirectory = (
    input.inheritedEnvironment.TMPDIR?.replace(/\/+$/u, "") || "/tmp"
  );
  const fixtureHomeDirectory = path.join(
    temporaryDirectory,
    `vsee-belief-reversal-browser-${input.resourceSuffix}-home`,
  );
  const environment: BrowserFixtureChildEnvironment = {
    NODE_ENV: "development",
    BELIEF_REVERSAL_BROWSER_FIXTURE_RUNTIME: "1",
    HOME: fixtureHomeDirectory,
    XDG_CONFIG_HOME: path.join(fixtureHomeDirectory, ".config"),
    CLOUDFLARE_VITE_FORCE_LOCAL: "true",
    PUBLIC_APP_URL: webUrl,
    VSEE_DEPLOYMENT_MODE: "public_sandbox",
    DEMO_WORKSPACE_ID: "workspace_demo",
    SUPABASE_URL: proxyUrl,
    SUPABASE_SERVICE_ROLE_KEY: input.serviceRoleKey,
    SUPABASE_STORAGE_BUCKET: "vsee-demo-sources",
    DOCUMENT_URL_SIGNING_SECRET:
      `vsee-task14-test-only-document-signing-secret-${input.resourceSuffix}`,
    ANTHROPIC_MODEL: "claude-opus-4-8",
    ANTHROPIC_API_KEY:
      `belief-reversal-test-only-anthropic-${input.resourceSuffix}`,
    XTRACE_API_KEY: `mmk_test_only_${input.resourceSuffix}`,
    XTRACE_APP_ID: `xtrace-belief-reversal-browser-${input.resourceSuffix}`,
    XTRACE_DRY_RUN: "1",
    MARKET_USER_AGENT: "VSee belief-reversal browser fixture",
    MARKET_OFFICIAL_FEEDS_JSON: "[]",
    MARKET_PUBLISHER_FEEDS_JSON: "[]",
    WORKER_ID: `belief-reversal-browser-${input.resourceSuffix}`,
    BELIEF_REVERSAL_MARKET_FIXTURE_URL:
      `${proxyUrl}/__fixture/market`,
    BELIEF_REVERSAL_FIXTURE_DATABASE: input.databaseName,
    WORKER_HEALTH_FILE:
      `${temporaryDirectory}/vsee-belief-reversal-browser-${input.resourceSuffix}.health`,
    WRANGLER_LOG_PATH: ".wrangler/wrangler.log",
  };

  for (const inheritedName of ["PATH", "TMPDIR"] as const) {
    const inheritedValue = input.inheritedEnvironment[inheritedName];
    if (inheritedValue) {
      environment[inheritedName] = inheritedValue;
    }
  }

  return environment;
}

const HOSTED_SITES_ENVIRONMENT_KEYS = [
  "VSEE_DEPLOYMENT_MODE",
  "DEMO_WORKSPACE_ID",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_STORAGE_BUCKET",
  "DOCUMENT_URL_SIGNING_SECRET",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_API_KEY",
  "XTRACE_API_KEY",
  "XTRACE_APP_ID",
  "XTRACE_DRY_RUN",
  "MARKET_USER_AGENT",
  "MARKET_OFFICIAL_FEEDS_JSON",
  "MARKET_PUBLISHER_FEEDS_JSON",
] as const;

export function buildBeliefReversalHostedSitesEnvironment(
  environment: BrowserFixtureChildEnvironment,
): Readonly<Record<(typeof HOSTED_SITES_ENVIRONMENT_KEYS)[number], string>> {
  const entries = HOSTED_SITES_ENVIRONMENT_KEYS.map((key) => {
    const value = environment[key]?.trim();
    if (!value) {
      throw new Error(`Browser fixture hosted Sites handoff requires ${key}.`);
    }
    return [key, value] as const;
  });
  return Object.freeze(Object.fromEntries(entries)) as Readonly<
    Record<(typeof HOSTED_SITES_ENVIRONMENT_KEYS)[number], string>
  >;
}

type BrowserFixtureProxyInput = {
  request: Request;
  postgrestUrl: string;
  objectStorage: PrivateObjectStorage;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
};

const STORAGE_PATH_PREFIX = "/storage/v1/object/";
const STORAGE_BUCKET = "vsee-demo-sources";

export async function handleBeliefReversalBrowserFixtureRequest(
  input: BrowserFixtureProxyInput,
): Promise<Response> {
  const requestUrl = new URL(input.request.url);
  if (
    requestUrl.pathname === "/rest/v1"
    || requestUrl.pathname.startsWith("/rest/v1/")
  ) {
    const authorizationFailure = fixtureGatewayAuthorizationFailure(
      input.request.headers,
      input.serviceRoleKey,
    );
    if (authorizationFailure) return authorizationFailure;
    const postgrestUrl = assertExactLoopbackOrigin(input.postgrestUrl, "PostgREST");
    const upstreamPath = requestUrl.pathname.slice("/rest/v1".length) || "/";
    if (upstreamPath.startsWith("//")) {
      return new Response("Invalid REST path", { status: 400 });
    }
    const upstreamUrl = new URL(postgrestUrl);
    upstreamUrl.pathname = upstreamPath;
    upstreamUrl.search = requestUrl.search;
    if (upstreamUrl.origin !== postgrestUrl.origin) {
      throw new Error("Browser fixture REST proxy refused an origin change.");
    }
    const headers = new Headers(input.request.headers);
    for (const hopByHopHeader of ["connection", "content-length", "host"]) {
      headers.delete(hopByHopHeader);
    }
    const body = ["GET", "HEAD"].includes(input.request.method)
      ? undefined
      : await input.request.arrayBuffer();
    const upstream = await (input.fetchImpl ?? fetch)(upstreamUrl, {
      method: input.request.method,
      headers,
      body,
      cache: "no-store",
    });
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: upstream.headers,
    });
  }

  if (requestUrl.pathname.startsWith(STORAGE_PATH_PREFIX)) {
    const authorizationFailure = fixtureGatewayAuthorizationFailure(
      input.request.headers,
      input.serviceRoleKey,
    );
    if (authorizationFailure) return authorizationFailure;
    const encodedObjectPath = requestUrl.pathname.slice(STORAGE_PATH_PREFIX.length);
    const separator = encodedObjectPath.indexOf("/");
    const bucket = separator === -1
      ? encodedObjectPath
      : encodedObjectPath.slice(0, separator);
    const encodedKey = separator === -1
      ? ""
      : encodedObjectPath.slice(separator + 1);
    if (decodeURIComponent(bucket) !== STORAGE_BUCKET || !encodedKey) {
      return new Response("Not found", { status: 404 });
    }
    const key = encodedKey
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
    if (key.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
      return new Response("Invalid object key", { status: 400 });
    }
    if (input.request.method === "GET" || input.request.method === "HEAD") {
      const bytes = await input.objectStorage.readPrivateObject(key);
      if (!bytes) return new Response("Not found", { status: 404 });
      return new Response(
        input.request.method === "HEAD" ? null : toOwnedArrayBuffer(bytes),
        {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(bytes.byteLength),
          "cache-control": "no-store",
        },
        },
      );
    }
    if (input.request.method === "POST") {
      const bytes = new Uint8Array(await input.request.arrayBuffer());
      const result = await input.objectStorage.ensurePrivateObject({
        key,
        bytes,
        contentType:
          input.request.headers.get("content-type") ?? "application/octet-stream",
      });
      return Response.json(result.value, { status: result.created ? 201 : 200 });
    }
    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "GET, HEAD, POST" },
    });
  }

  if (
    requestUrl.pathname === "/__fixture/market"
    && input.request.method === "GET"
  ) {
    const retrievedAt = requestUrl.searchParams.get("to");
    if (!retrievedAt) {
      return Response.json(
        { error: "missing_market_window" },
        { status: 400 },
      );
    }
    return Response.json(buildBeliefReversalLiveMarketPackets({
      collectedAt: retrievedAt,
    }), {
      headers: { "cache-control": "no-store" },
    });
  }

  if (requestUrl.pathname === "/__fixture/health") {
    return Response.json({ ok: true });
  }

  return new Response("Not found", { status: 404 });
}

function fixtureGatewayAuthorizationFailure(
  headers: Headers,
  serviceRoleKey: string,
): Response | undefined {
  const expected = serviceRoleKey.trim();
  const apikey = headers.get("apikey");
  const authorization = headers.get("authorization");
  if (!expected || !apikey || !authorization) {
    return new Response("Authentication required", { status: 401 });
  }
  const bearerPrefix = "Bearer ";
  const bearerToken = authorization.startsWith(bearerPrefix)
    ? authorization.slice(bearerPrefix.length)
    : "";
  if (
    !constantTimeFixtureCredentialEquals(apikey, expected)
    || !constantTimeFixtureCredentialEquals(bearerToken, expected)
  ) {
    return new Response("Forbidden", { status: 403 });
  }
  return undefined;
}

function constantTimeFixtureCredentialEquals(
  candidate: string,
  expected: string,
): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(candidate), digest(expected));
}

function assertExactLoopbackOrigin(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} URL must use an exact loopback origin.`);
  }
  if (
    url.protocol !== "http:"
    || url.hostname !== "127.0.0.1"
    || !url.port
    || url.pathname !== "/"
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error(`${label} URL must use an exact loopback origin.`);
  }
  return url;
}

export function createIdempotentBrowserFixtureCleanup(
  cleanupStepsInOwnershipOrder: Array<() => Promise<void>>,
): () => Promise<void> {
  let cleanupPromise: Promise<void> | undefined;
  return () => {
    cleanupPromise ??= (async () => {
      const errors: unknown[] = [];
      for (const cleanupStep of cleanupStepsInOwnershipOrder.toReversed()) {
        try {
          await cleanupStep();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, "Browser fixture cleanup failed.");
      }
    })();
    return cleanupPromise;
  };
}

interface BrowserFixtureAnnouncementInput {
  webUrl: string;
  gatewayUrl: string;
  stagingEnvironmentPath: string;
  baselineReportId: string;
  baselineRunId: string;
  databaseName: string;
  migrationTerminal: string;
  webLogPath: string;
  workerLogPath: string;
}

export function buildBeliefReversalBrowserFixtureAnnouncement(
  input: BrowserFixtureAnnouncementInput,
) {
  const webUrl = assertExactLoopbackOrigin(input.webUrl, "web");
  const gatewayUrl = assertExactLoopbackOrigin(input.gatewayUrl, "gateway");
  const baselineReportId = requireFixtureText(
    input.baselineReportId,
    "baseline report id",
  );
  return Object.freeze({
    status: "ready" as const,
    acceptance: "click_wake_agent_and_scan_market" as const,
    url: webUrl.href,
    gatewayUrl: gatewayUrl.href,
    stagingEnvironmentPath: requireFixtureText(
      input.stagingEnvironmentPath,
      "staging environment path",
    ),
    baselineReportId,
    baselineRunId: requireFixtureText(
      input.baselineRunId,
      "baseline run id",
    ),
    databaseName: requireFixtureText(input.databaseName, "database name"),
    migrationTerminal: requireFixtureText(
      input.migrationTerminal,
      "migration terminal",
    ),
    webLogPath: requireFixtureText(input.webLogPath, "web log path"),
    workerLogPath: requireFixtureText(input.workerLogPath, "worker log path"),
  });
}

function requireFixtureText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Browser fixture ${label} is required.`);
  return normalized;
}

type BrowserFixtureStopResult =
  | { kind: "signal"; signal: "SIGINT" | "SIGTERM" }
  | { kind: "child_exit"; child: string }
  | { kind: "child_error"; child: string };

export function createBeliefReversalBrowserFixtureSignalLatch(
  signalSource: Pick<EventEmitter, "on" | "off">,
) {
  let requestedSignal: "SIGINT" | "SIGTERM" | undefined;
  let disposed = false;
  const onSigint = () => {
    requestedSignal ??= "SIGINT";
  };
  const onSigterm = () => {
    requestedSignal ??= "SIGTERM";
  };
  signalSource.on("SIGINT", onSigint);
  signalSource.on("SIGTERM", onSigterm);
  return {
    get signal() {
      return requestedSignal;
    },
    throwIfRequested() {
      if (requestedSignal) {
        throw new Error(`Browser fixture interrupted by ${requestedSignal}.`);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      signalSource.off("SIGINT", onSigint);
      signalSource.off("SIGTERM", onSigterm);
    },
  };
}

export function waitForBeliefReversalBrowserFixtureStop(input: {
  signalSource: Pick<EventEmitter, "once" | "off">;
  getLatchedSignal?: () => "SIGINT" | "SIGTERM" | undefined;
  children: Array<{
    name: string;
    events: Pick<EventEmitter, "once" | "off">;
    state?: Pick<ChildProcess, "exitCode" | "signalCode">;
  }>;
}): Promise<BrowserFixtureStopResult> {
  return new Promise((resolve) => {
    let settled = false;
    const listeners: Array<{
      source: Pick<EventEmitter, "once" | "off">;
      event: string;
      listener: () => void;
    }> = [];
    const settle = (result: BrowserFixtureStopResult) => {
      if (settled) return;
      settled = true;
      for (const registered of listeners) {
        registered.source.off(registered.event, registered.listener);
      }
      resolve(result);
    };
    const register = (
      source: Pick<EventEmitter, "once" | "off">,
      event: string,
      listener: () => void,
    ) => {
      listeners.push({ source, event, listener });
      source.once(event, listener);
    };

    register(input.signalSource, "SIGINT", () => {
      settle({ kind: "signal", signal: "SIGINT" });
    });
    register(input.signalSource, "SIGTERM", () => {
      settle({ kind: "signal", signal: "SIGTERM" });
    });
    for (const child of input.children) {
      register(child.events, "exit", () => {
        settle({ kind: "child_exit", child: child.name });
      });
      register(child.events, "error", () => {
        settle({ kind: "child_error", child: child.name });
      });
    }
    const latchedSignal = input.getLatchedSignal?.();
    if (latchedSignal) settle({ kind: "signal", signal: latchedSignal });
    for (const child of input.children) {
      if (
        child.state
        && (
          child.state.exitCode !== null
          || child.state.signalCode !== null
        )
      ) {
        settle({ kind: "child_exit", child: child.name });
      }
    }
  });
}

interface BrowserFixtureProxyServer {
  url: string;
  close(): Promise<void>;
}

async function startBeliefReversalBrowserFixtureProxy(input: {
  postgrestUrl: string;
  objectStorage: PrivateObjectStorage;
  serviceRoleKey: string;
}): Promise<BrowserFixtureProxyServer> {
  assertExactLoopbackOrigin(input.postgrestUrl, "PostgREST");
  const server = createServer((request, response) => {
    void serveNodeProxyRequest({
      request,
      response,
      postgrestUrl: input.postgrestUrl,
      objectStorage: input.objectStorage,
      serviceRoleKey: input.serviceRoleKey,
    });
  });
  await listenOnLoopback(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("Browser fixture could not inspect its loopback proxy.");
  }
  const url = `http://127.0.0.1:${(address as AddressInfo).port}`;
  assertExactLoopbackOrigin(url, "proxy");
  return {
    url,
    close: () => closeServer(server),
  };
}

async function serveNodeProxyRequest(input: {
  request: IncomingMessage;
  response: ServerResponse;
  postgrestUrl: string;
  objectStorage: PrivateObjectStorage;
  serviceRoleKey: string;
}): Promise<void> {
  try {
    if (input.request.socket.remoteAddress !== "127.0.0.1") {
      input.response.writeHead(403).end("Loopback requests only");
      return;
    }
    const headers = new Headers();
    for (let index = 0; index < input.request.rawHeaders.length; index += 2) {
      const name = input.request.rawHeaders[index];
      const value = input.request.rawHeaders[index + 1];
      if (name && value !== undefined) headers.append(name, value);
    }
    const method = input.request.method ?? "GET";
    const bodyBytes = ["GET", "HEAD"].includes(method)
      ? undefined
      : await readIncomingRequestBytes(input.request);
    const request = new Request(
      new URL(input.request.url ?? "/", "http://127.0.0.1"),
      {
        method,
        headers,
        body: bodyBytes === undefined ? undefined : toOwnedArrayBuffer(bodyBytes),
      },
    );
    const response = await handleBeliefReversalBrowserFixtureRequest({
      request,
      postgrestUrl: input.postgrestUrl,
      objectStorage: input.objectStorage,
      serviceRoleKey: input.serviceRoleKey,
    });
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      responseHeaders[name] = value;
    });
    input.response.writeHead(response.status, responseHeaders);
    if (method === "HEAD" || response.body === null) {
      input.response.end();
      return;
    }
    input.response.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!input.response.headersSent) {
      input.response.writeHead(500, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
    }
    input.response.end(JSON.stringify({ error: "fixture_proxy_failed", message }));
  }
}

async function readIncomingRequestBytes(
  request: IncomingMessage,
): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function toOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function listenOnLoopback(server: Server): Promise<void> {
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function spawnLoggedFixtureChild(input: {
  command: string;
  args: string[];
  environment: BrowserFixtureChildEnvironment;
  workingDirectory: string;
  logPath: string;
}): Promise<ChildProcess> {
  const logDescriptor = openSync(input.logPath, "a", 0o600);
  let child: ChildProcess;
  try {
    child = spawn(input.command, input.args, {
      cwd: input.workingDirectory,
      env: input.environment,
      stdio: ["ignore", logDescriptor, logDescriptor],
    });
  } finally {
    closeSync(logDescriptor);
  }
  await new Promise<void>((resolve, reject) => {
    const onSpawn = () => {
      child.off("error", onError);
      resolve();
    };
    const onError = (error: Error) => {
      child.off("spawn", onSpawn);
      reject(error);
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
  return child;
}

type TerminableBrowserFixtureChild = Pick<
  ChildProcess,
  "exitCode" | "signalCode" | "kill" | "once" | "off"
>;

interface BrowserFixtureTerminationOptions {
  gracefulTimeoutMs?: number;
  forceTimeoutMs?: number;
  delayImpl?: (milliseconds: number) => Promise<void>;
}

function browserFixtureChildHasExited(
  child: Pick<ChildProcess, "exitCode" | "signalCode">,
): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForBrowserFixtureChildExit(input: {
  child: TerminableBrowserFixtureChild;
  timeoutMs: number;
  delayImpl: (milliseconds: number) => Promise<void>;
}): Promise<boolean> {
  if (browserFixtureChildHasExited(input.child)) return true;
  let onExit!: () => void;
  let onError!: (error: Error) => void;
  const exited = new Promise<boolean>((resolve, reject) => {
    onExit = () => resolve(true);
    onError = (error) => reject(error);
    input.child.once("exit", onExit);
    input.child.once("error", onError);
  });
  try {
    return await Promise.race([
      exited,
      input.delayImpl(input.timeoutMs).then(() =>
        browserFixtureChildHasExited(input.child)
      ),
    ]);
  } finally {
    input.child.off("exit", onExit);
    input.child.off("error", onError);
  }
}

export async function terminateBeliefReversalBrowserFixtureChild(
  child: TerminableBrowserFixtureChild,
  options: BrowserFixtureTerminationOptions = {},
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const delayImpl = options.delayImpl ?? delay;
  child.kill("SIGTERM");
  const graceful = await waitForBrowserFixtureChildExit({
    child,
    timeoutMs: options.gracefulTimeoutMs ?? 5_000,
    delayImpl,
  });
  if (graceful) return;
  child.kill("SIGKILL");
  const forced = await waitForBrowserFixtureChildExit({
    child,
    timeoutMs: options.forceTimeoutMs ?? 2_000,
    delayImpl,
  });
  if (!forced) {
    throw new Error("Browser fixture child did not exit after SIGKILL.");
  }
}

async function waitForDurableBrowserFixture(input: {
  webUrl: string;
  children: Array<{ name: string; process: ChildProcess }>;
  throwIfStopRequested?: () => void;
}): Promise<void> {
  const healthUrl = new URL("/api/settings/health", input.webUrl);
  for (let attempt = 0; attempt < 180; attempt += 1) {
    input.throwIfStopRequested?.();
    for (const child of input.children) {
      if (child.process.exitCode !== null || child.process.signalCode !== null) {
        throw new Error(
          `Browser fixture ${child.name} exited before readiness.`,
        );
      }
    }
    try {
      const response = await fetch(healthUrl, { cache: "no-store" });
      const body = await response.json() as {
        data?: {
          deploymentMode?: unknown;
          postgres?: unknown;
          worker?: unknown;
          storage?: unknown;
          corpusReady?: unknown;
          xtrace?: unknown;
          anthropic?: unknown;
        };
      };
      if (
        response.ok
        && body.data?.deploymentMode === "public_sandbox"
        && body.data.postgres === true
        && body.data.worker === true
        && body.data.storage === true
        && body.data.corpusReady === true
        && body.data.xtrace === true
        && body.data.anthropic === true
      ) {
        return;
      }
    } catch {
      // The local dev server may still be compiling its first route.
    }
    await delay(500);
  }
  throw new Error("Browser fixture app/worker readiness timed out.");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function browserFixtureWebPort(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const configured = environment.VSEE_BROWSER_FIXTURE_WEB_PORT;
  if (configured === undefined || configured.trim() === "") return 3_100;
  const port = Number(configured);
  if (!Number.isSafeInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error(
      "VSEE_BROWSER_FIXTURE_WEB_PORT must be an unprivileged TCP port.",
    );
  }
  return port;
}

export function buildBeliefReversalBrowserFixtureWebArguments(
  port: number,
): string[] {
  if (!Number.isSafeInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error("Browser fixture web port must be an unprivileged TCP port.");
  }
  return [
    "dev",
    "-H",
    "127.0.0.1",
    "-p",
    String(port),
    "--strictPort",
  ];
}

export async function runBeliefReversalBrowserFixture(): Promise<void> {
  const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
  assertBeliefReversalBrowserFixtureCredentialIsolation(repositoryRoot);
  const cleanupSteps: Array<() => Promise<void>> = [];
  const cleanup = createIdempotentBrowserFixtureCleanup(cleanupSteps);
  const signalLatch = createBeliefReversalBrowserFixtureSignalLatch(process);
  try {
    const availability = probeBeliefReversalE2EAvailability({
      environment: {
        ...process.env,
        NODE_ENV: "test",
        REQUIRE_BELIEF_REVERSAL_E2E: "1",
        REQUIRE_POSTGRES_MIGRATION_TESTS: "1",
      },
      runner: runHarnessCommand,
    });
    if (availability.state !== "eligible") {
      throw new Error(availability.reason);
    }

    const databaseName = makeDisposableDatabaseName("belief_browser");
    const resourceSuffix = databaseName.slice(-16);
    const migrationPlan = discoverMigrationPlan({
      directory: path.join(repositoryRoot, "drizzle"),
      journalPath: path.join(repositoryRoot, "drizzle", "meta", "_journal.json"),
    });
    console.error(
      `[browser-fixture] provisioning ${databaseName} through ${migrationPlan.terminal.tag}`,
    );
    const infrastructure = await provisionBeliefReversalE2EInfrastructure({
      availability,
      dockerPlan: buildBeliefReversalDockerPlan({
        databaseName,
        resourceSuffix,
      }),
      migrationPlan,
      issuedAtSeconds: Math.floor(Date.now() / 1_000),
    });
    cleanupSteps.push(infrastructure.cleanup);
    signalLatch.throwIfRequested();

    const repositoryFetch = createStandalonePostgrestRepositoryFetch({
      postgrestUrl: infrastructure.target.postgrestUrl,
    });
    const dataRuntime = createBeliefReversalE2EDataRuntime({
      infrastructure,
      fetchImpl: repositoryFetch,
    });
    console.error(
      "[browser-fixture] seeding 30 analysis-eligible Deals while preserving the pinned 23-Deal replay universe",
    );
    await seedAndVerifyBeliefReversalE2EData({
      runtime: dataRuntime,
      corpusDirectory: path.join(repositoryRoot, "seed", "corpus"),
    });
    signalLatch.throwIfRequested();
    console.error("[browser-fixture] running deterministic pinned pipeline and replay");
    const pipeline = await runBeliefReversalPinnedPipeline({
      target: {
        databaseName,
        postgresVersion: infrastructure.target.postgresVersion,
        postgrestUrl: infrastructure.target.postgrestUrl,
        postgrestVersion: infrastructure.target.postgrestVersion,
        serviceRoleKey: infrastructure.serviceRoleJwt,
      },
      workspaceId: dataRuntime.workspaceId,
      dataStore: dataRuntime.dataStore,
      fetchImpl: repositoryFetch,
      now: () => new Date("2026-08-03T12:00:00.000Z"),
    });
    signalLatch.throwIfRequested();

    const proxy = await startBeliefReversalBrowserFixtureProxy({
      postgrestUrl: infrastructure.target.postgrestUrl,
      objectStorage: dataRuntime.objectStorage,
      serviceRoleKey: infrastructure.serviceRoleJwt,
    });
    cleanupSteps.push(proxy.close);
    signalLatch.throwIfRequested();
    const webPort = browserFixtureWebPort();
    const webUrl = `http://127.0.0.1:${webPort}`;
    const childEnvironment = buildBeliefReversalBrowserFixtureEnvironment({
      inheritedEnvironment: process.env,
      proxyUrl: proxy.url,
      serviceRoleKey: infrastructure.serviceRoleJwt,
      webUrl,
      resourceSuffix,
      databaseName,
    });
    mkdirSync(childEnvironment.HOME, { recursive: true, mode: 0o700 });
    mkdirSync(childEnvironment.XDG_CONFIG_HOME, {
      recursive: true,
      mode: 0o700,
    });
    const runtimeDirectory = path.join(repositoryRoot, ".runtime");
    mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 });
    const stagingEnvironmentPath = path.join(
      runtimeDirectory,
      `belief-reversal-browser-${resourceSuffix}-staging-env.json`,
    );
    writeFileSync(
      stagingEnvironmentPath,
      `${JSON.stringify(
        buildBeliefReversalHostedSitesEnvironment(childEnvironment),
      )}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    cleanupSteps.push(async () => {
      rmSync(stagingEnvironmentPath, { force: true });
    });
    const workerLogPath = path.join(
      runtimeDirectory,
      `belief-reversal-browser-${resourceSuffix}-worker.log`,
    );
    const webLogPath = path.join(
      runtimeDirectory,
      `belief-reversal-browser-${resourceSuffix}-web.log`,
    );
    const worker = await spawnLoggedFixtureChild({
      command: process.execPath,
      args: ["--import", "tsx", "scripts/run-belief-reversal-cold-worker.ts"],
      environment: childEnvironment,
      workingDirectory: repositoryRoot,
      logPath: workerLogPath,
    });
    cleanupSteps.push(() => terminateBeliefReversalBrowserFixtureChild(worker));
    signalLatch.throwIfRequested();
    const web = await spawnLoggedFixtureChild({
      command: path.join(repositoryRoot, "node_modules", ".bin", "vinext"),
      args: buildBeliefReversalBrowserFixtureWebArguments(webPort),
      environment: childEnvironment,
      workingDirectory: repositoryRoot,
      logPath: webLogPath,
    });
    cleanupSteps.push(() => terminateBeliefReversalBrowserFixtureChild(web));
    signalLatch.throwIfRequested();

    await waitForDurableBrowserFixture({
      webUrl,
      children: [
        { name: "worker", process: worker },
        { name: "web", process: web },
      ],
      throwIfStopRequested: () => signalLatch.throwIfRequested(),
    });
    const announcement = buildBeliefReversalBrowserFixtureAnnouncement({
      webUrl,
      gatewayUrl: proxy.url,
      stagingEnvironmentPath,
      baselineReportId: pipeline.replay.report.id,
      baselineRunId: pipeline.replay.run.id,
      databaseName,
      migrationTerminal: infrastructure.migrationTerminal.tag,
      webLogPath,
      workerLogPath,
    });
    process.stdout.write(`${JSON.stringify(announcement, null, 2)}\n`);
    console.error("[browser-fixture] press Ctrl-C after manual browser acceptance");

    const stopped = await waitForBeliefReversalBrowserFixtureStop({
      signalSource: process,
      getLatchedSignal: () => signalLatch.signal,
      children: [
        { name: "worker", events: worker, state: worker },
        { name: "web", events: web, state: web },
      ],
    });
    if (stopped.kind !== "signal") {
      throw new Error(`Browser fixture ${stopped.child} stopped unexpectedly.`);
    }
  } finally {
    console.error("[browser-fixture] cleaning local app, worker, proxy, and database");
    try {
      await cleanup();
    } finally {
      signalLatch.dispose();
    }
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : "";
if (import.meta.url === invokedPath) {
  void runBeliefReversalBrowserFixture().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
