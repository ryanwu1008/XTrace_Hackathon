import { createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { assertDisposableDatabaseName } from "./require-loopback-postgres";

export const POSTGRES_IMAGE = "postgres:17.6";
export const POSTGREST_IMAGE = "postgrest/postgrest:v12.2.3";

// Disposable, per-run, loopback-only credential. The cold E2E finishes in about
// 75 seconds, but the browser fixture stays up for manual review.
const FIXTURE_JWT_LIFETIME_SECONDS = 12 * 60 * 60;

const E2E_OPT_IN_ERROR =
  "Belief-reversal E2E requires explicit REQUIRE_BELIEF_REVERSAL_E2E=1 opt-in.";
const MIGRATION_OPT_IN_ERROR =
  "Belief-reversal E2E requires explicit REQUIRE_POSTGRES_MIGRATION_TESTS=1 opt-in.";
const TARGET_ERROR = "Belief-reversal E2E target failed closed.";
const MIGRATION_ERROR = "Belief-reversal E2E migration chain failed closed.";

export type HarnessCommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

export interface HarnessCommandOptions {
  environment?: Readonly<Record<string, string | undefined>>;
}

export type HarnessCommandRunner = (
  command: string,
  args: readonly string[],
  options?: HarnessCommandOptions,
) => HarnessCommandResult;

export const runHarnessCommand: HarnessCommandRunner = (
  command,
  args,
  options,
) => {
  const result = spawnSync(command, [...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: (options?.environment === undefined
      ? process.env
      : Object.fromEntries(
        Object.entries(options.environment).filter((entry): entry is [string, string] =>
          entry[1] !== undefined
        ),
      )) as NodeJS.ProcessEnv,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
};

export type BeliefReversalE2EAvailability =
  | { state: "skipped"; reason: string }
  | { state: "eligible"; dockerServerVersion: string };

const DOCKER_ENVIRONMENT_KEYS = [
  "DOCKER_CONFIG",
  "DOCKER_CONTEXT",
  "DOCKER_HOST",
  "HOME",
  "PATH",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TMPDIR",
  "XDG_CONFIG_HOME",
] as const;

function dockerCommandEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(
    DOCKER_ENVIRONMENT_KEYS.flatMap((key) =>
      source[key] === undefined ? [] : [[key, source[key]!]]
    ),
  ));
}

export function probeBeliefReversalE2EAvailability(input: {
  environment: Readonly<Record<string, string | undefined>>;
  runner: HarnessCommandRunner;
}): BeliefReversalE2EAvailability {
  if (input.environment.REQUIRE_BELIEF_REVERSAL_E2E !== "1") {
    return { state: "skipped", reason: E2E_OPT_IN_ERROR };
  }
  if (input.environment.REQUIRE_POSTGRES_MIGRATION_TESTS !== "1") {
    return { state: "skipped", reason: MIGRATION_OPT_IN_ERROR };
  }
  if (input.environment.NODE_ENV === "production") {
    return {
      state: "skipped",
      reason: "Belief-reversal E2E refuses NODE_ENV=production.",
    };
  }
  const environment = dockerCommandEnvironment(input.environment);

  const daemon = input.runner(
    "docker",
    ["info", "--format", "{{.ServerVersion}}"],
    { environment },
  );
  if (daemon.status !== 0 || daemon.stdout.trim().length === 0) {
    return {
      state: "skipped",
      reason: "Belief-reversal E2E Docker daemon is unavailable.",
    };
  }
  for (const image of [POSTGRES_IMAGE, POSTGREST_IMAGE]) {
    const inspected = input.runner(
      "docker",
      ["image", "inspect", "--format", "{{.RepoTags}}", image],
      { environment },
    );
    if (inspected.status !== 0) {
      return {
        state: "skipped",
        reason: `Belief-reversal E2E requires the local pinned image ${image}.`,
      };
    }
  }
  return {
    state: "eligible",
    dockerServerVersion: daemon.stdout.trim(),
  };
}

export interface MigrationJournal {
  entries: Array<{ idx: number; tag: string }>;
}

export interface MigrationFile {
  index: number;
  tag: string;
  filename: string;
  path?: string;
}

export interface MigrationPlan {
  files: MigrationFile[];
  terminal: MigrationFile;
}

export function resolveMigrationPlan(input: {
  filenames: readonly string[];
  journal: MigrationJournal;
  directory?: string;
}): MigrationPlan {
  const files = input.filenames.flatMap((filename): MigrationFile[] => {
    const match = /^(\d{4})_([a-z0-9][a-z0-9_]*)\.sql$/u.exec(filename);
    if (!match) return [];
    return [{
      index: Number(match[1]),
      tag: filename.slice(0, -4),
      filename,
      ...(input.directory === undefined
        ? {}
        : { path: path.join(input.directory, filename) }),
    }];
  }).sort((left, right) =>
    left.index - right.index || left.filename.localeCompare(right.filename)
  );
  if (files.length === 0) throw new Error(MIGRATION_ERROR);
  for (let expected = 0; expected < files.length; expected += 1) {
    if (files[expected]?.index !== expected) throw new Error(MIGRATION_ERROR);
  }

  let priorJournalIndex = -1;
  const journalIndices = new Set<number>();
  for (const entry of input.journal.entries) {
    if (
      !Number.isSafeInteger(entry.idx)
      || entry.idx <= priorJournalIndex
      || journalIndices.has(entry.idx)
      || files[entry.idx]?.tag !== entry.tag
    ) {
      throw new Error(MIGRATION_ERROR);
    }
    journalIndices.add(entry.idx);
    priorJournalIndex = entry.idx;
  }
  const terminal = files.at(-1)!;
  const journalTerminal = input.journal.entries.at(-1);
  if (
    journalTerminal === undefined
    || journalTerminal.idx !== terminal.index
    || journalTerminal.tag !== terminal.tag
  ) {
    throw new Error(MIGRATION_ERROR);
  }
  return { files, terminal };
}

export function discoverMigrationPlan(input: {
  directory: string;
  journalPath: string;
}): MigrationPlan {
  let journal: MigrationJournal;
  try {
    journal = JSON.parse(readFileSync(input.journalPath, "utf8")) as MigrationJournal;
  } catch {
    throw new Error(MIGRATION_ERROR);
  }
  if (!journal || !Array.isArray(journal.entries)) {
    throw new Error(MIGRATION_ERROR);
  }
  return resolveMigrationPlan({
    filenames: readdirSync(input.directory),
    journal,
    directory: input.directory,
  });
}

interface DockerContainerPlan {
  name: string;
  image: string;
  runArgs: string[];
}

export interface BeliefReversalDockerPlan {
  databaseName: string;
  networkName: string;
  postgresPassword: string;
  authenticatorPassword: string;
  jwtSecret: string;
  postgres: DockerContainerPlan;
  postgrest: DockerContainerPlan;
  cleanup: string[][];
}

export function buildBeliefReversalDockerPlan(input: {
  databaseName: string;
  resourceSuffix: string;
}): BeliefReversalDockerPlan {
  const databaseName = assertDisposableDatabaseName(input.databaseName);
  if (!/^[0-9a-f]{16}$/u.test(input.resourceSuffix)) {
    throw new Error("Belief-reversal E2E requires a bounded resource suffix.");
  }
  const networkName = `vsee-belief-e2e-${input.resourceSuffix}`;
  const postgresName = `${networkName}-postgres`;
  const postgrestName = `${networkName}-postgrest`;
  const postgresPassword = `vsee-pg-${input.resourceSuffix}`;
  const authenticatorPassword = `vsee-auth-${input.resourceSuffix}`;
  const jwtSecret = `vsee-task12-test-only-jwt-${input.resourceSuffix}-secret`;
  const postgres: DockerContainerPlan = {
    name: postgresName,
    image: POSTGRES_IMAGE,
    runArgs: [
      "run",
      "--detach",
      "--name",
      postgresName,
      "--network",
      networkName,
      "--network-alias",
      postgresName,
      "--publish",
      "127.0.0.1::5432",
      "--env",
      `POSTGRES_DB=${databaseName}`,
      "--env",
      "POSTGRES_USER=postgres",
      "--env",
      `POSTGRES_PASSWORD=${postgresPassword}`,
      "--tmpfs",
      "/var/lib/postgresql/data:rw,noexec,nosuid",
      "--health-cmd",
      `pg_isready -U postgres -d ${databaseName}`,
      "--health-interval",
      "1s",
      "--health-timeout",
      "3s",
      "--health-retries",
      "30",
      POSTGRES_IMAGE,
    ],
  };
  const encodedAuthenticatorPassword = encodeURIComponent(authenticatorPassword);
  const postgrest: DockerContainerPlan = {
    name: postgrestName,
    image: POSTGREST_IMAGE,
    runArgs: [
      "run",
      "--detach",
      "--name",
      postgrestName,
      "--network",
      networkName,
      "--publish",
      "127.0.0.1::3000",
      "--env",
      `PGRST_DB_URI=postgres://authenticator:${encodedAuthenticatorPassword}@${postgresName}:5432/${databaseName}`,
      "--env",
      "PGRST_DB_SCHEMAS=public",
      "--env",
      "PGRST_DB_ANON_ROLE=anon",
      "--env",
      `PGRST_JWT_SECRET=${jwtSecret}`,
      "--env",
      "PGRST_SERVER_PORT=3000",
      POSTGREST_IMAGE,
    ],
  };
  return {
    databaseName,
    networkName,
    postgresPassword,
    authenticatorPassword,
    jwtSecret,
    postgres,
    postgrest,
    cleanup: [
      ["rm", "--force", postgrestName],
      ["rm", "--force", postgresName],
      ["network", "rm", networkName],
    ],
  };
}

export function parseLoopbackPublishedPort(
  output: string,
  containerPort: number,
): number {
  const rows = output.split(/\r?\n/u).map((row) => row.trim()).filter(Boolean);
  const match = rows.length === 1
    ? /^127\.0\.0\.1:(\d{1,5})$/u.exec(rows[0]!)
    : null;
  const port = match ? Number(match[1]) : 0;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `Belief-reversal E2E requires one loopback binding for container port ${containerPort}.`,
    );
  }
  return port;
}

export interface BeliefReversalE2ETargetInput {
  databaseName: string;
  postgresHost: string;
  postgresVersion: string;
  postgrestUrl: string;
  postgrestVersion: string;
  postgrestDatabaseIdentity: string;
}

export interface VerifiedBeliefReversalE2ETarget {
  databaseName: string;
  postgresHost: "127.0.0.1";
  postgresVersion: "17.6";
  postgrestUrl: string;
  postgrestVersion: "12.2.3";
}

export function assertBeliefReversalE2ETarget(
  input: BeliefReversalE2ETargetInput,
): VerifiedBeliefReversalE2ETarget {
  try {
    assertDisposableDatabaseName(input.databaseName);
    if (
      input.postgresHost !== "127.0.0.1"
      || input.postgresVersion !== "17.6"
      || input.postgrestVersion !== "12.2.3"
      || input.postgrestDatabaseIdentity !== input.databaseName
    ) {
      throw new Error(TARGET_ERROR);
    }
    const parsed = new URL(input.postgrestUrl);
    if (
      parsed.protocol !== "http:"
      || parsed.hostname !== "127.0.0.1"
      || parsed.port.length === 0
      || parsed.pathname !== "/"
      || parsed.username.length > 0
      || parsed.password.length > 0
      || parsed.search.length > 0
      || parsed.hash.length > 0
    ) {
      throw new Error(TARGET_ERROR);
    }
  } catch {
    throw new Error(TARGET_ERROR);
  }
  return {
    databaseName: input.databaseName,
    postgresHost: "127.0.0.1",
    postgresVersion: "17.6",
    postgrestUrl: input.postgrestUrl,
    postgrestVersion: "12.2.3",
  };
}

export function buildBeliefReversalRuntimeEnvironment(input: {
  postgrestUrl: string;
  serviceRoleJwt: string;
  inheritedEnvironment?: Readonly<Record<string, string | undefined>>;
}): Readonly<Record<string, string>> {
  const parsed = new URL(input.postgrestUrl);
  if (
    parsed.protocol !== "http:"
    || parsed.hostname !== "127.0.0.1"
    || parsed.port.length === 0
    || parsed.pathname !== "/"
  ) {
    throw new Error(TARGET_ERROR);
  }
  const inherited = input.inheritedEnvironment ?? process.env;
  return Object.freeze({
    NODE_ENV: "test",
    ...(inherited.PATH === undefined ? {} : { PATH: inherited.PATH }),
    SUPABASE_URL: input.postgrestUrl,
    SUPABASE_SERVICE_ROLE_KEY: input.serviceRoleJwt,
  });
}

/**
 * Supabase exposes PostgREST below `/rest/v1`, while the pinned standalone
 * PostgREST image serves the same REST/RPC surface at `/`. Keep production
 * repository adapters unchanged and translate only that gateway prefix on the
 * already-attested loopback origin.
 */
export function createStandalonePostgrestRepositoryFetch(input: {
  postgrestUrl: string;
  fetchImpl?: typeof fetch;
}): typeof fetch {
  const base = new URL(input.postgrestUrl);
  if (
    base.protocol !== "http:"
    || base.hostname !== "127.0.0.1"
    || base.port.length === 0
    || base.pathname !== "/"
    || base.username.length > 0
    || base.password.length > 0
    || base.search.length > 0
    || base.hash.length > 0
  ) {
    throw new Error(
      "Standalone repository transport requires the attested loopback PostgREST origin.",
    );
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  return async (request, init) => {
    const url = new URL(
      typeof request === "string"
        ? request
        : request instanceof URL
        ? request.href
        : request.url,
    );
    if (url.origin !== base.origin) {
      throw new Error(
        "Standalone repository transport refuses a non-loopback PostgREST origin.",
      );
    }
    if (url.pathname === "/rest/v1") {
      url.pathname = "/";
    } else if (url.pathname.startsWith("/rest/v1/")) {
      url.pathname = url.pathname.slice("/rest/v1".length);
    } else {
      throw new Error(
        "Standalone repository transport requires the Supabase REST gateway prefix.",
      );
    }
    const rewritten = request instanceof Request
      ? new Request(url, request)
      : url.href;
    return fetchImpl(rewritten, init);
  };
}

function encodeJwtPart(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function createServiceRoleJwt(input: {
  secret: string;
  issuedAtSeconds: number;
}): string {
  if (
    Buffer.byteLength(input.secret, "utf8") < 32
    || !Number.isSafeInteger(input.issuedAtSeconds)
    || input.issuedAtSeconds < 1
  ) {
    throw new Error("Belief-reversal E2E JWT inputs are invalid.");
  }
  const header = encodeJwtPart({ alg: "HS256", typ: "JWT" });
  const payload = encodeJwtPart({
    aud: "authenticated",
    // The browser fixture holds this token for a whole manual review session.
    // At one hour PostgREST started answering 401, which the transport treats
    // as non-retryable, so the Worker exited and tore the environment down.
    exp: input.issuedAtSeconds + FIXTURE_JWT_LIFETIME_SECONDS,
    iat: input.issuedAtSeconds,
    role: "service_role",
  });
  const unsigned = `${header}.${payload}`;
  const signature = createHmac("sha256", input.secret)
    .update(unsigned)
    .digest("base64url");
  return `${unsigned}.${signature}`;
}

export interface BeliefReversalE2EInfrastructure {
  target: VerifiedBeliefReversalE2ETarget;
  migrationTerminal: MigrationFile;
  serviceRoleJwt: string;
  environment: Readonly<Record<string, string>>;
  cleanup(): Promise<void>;
}

function requireCommandSuccess(
  result: HarnessCommandResult,
  operation: string,
): string {
  if (result.status !== 0) {
    const diagnostic = (result.stderr.trim() || result.stdout.trim())
      .slice(-2_000);
    throw new Error(
      `Belief-reversal E2E ${operation} failed.`
        + (diagnostic ? ` ${diagnostic}` : ""),
    );
  }
  return result.stdout.trim();
}

function postgresEnvironment(input: {
  inheritedEnvironment: Readonly<Record<string, string | undefined>>;
  plan: BeliefReversalDockerPlan;
  port: number;
}): Readonly<Record<string, string>> {
  return Object.freeze({
    ...(input.inheritedEnvironment.PATH === undefined
      ? {}
      : { PATH: input.inheritedEnvironment.PATH }),
    PGDATABASE: input.plan.databaseName,
    PGHOSTADDR: "127.0.0.1",
    PGPASSWORD: input.plan.postgresPassword,
    PGPORT: String(input.port),
    PGSSLMODE: "disable",
    PGUSER: "postgres",
  });
}

async function waitForPostgresIdentity(input: {
  runner: HarnessCommandRunner;
  environment: Readonly<Record<string, string>>;
  databaseName: string;
  delayImpl: (milliseconds: number) => Promise<void>;
}): Promise<{ version: string; databaseName: string }> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = input.runner("psql", [
      "--no-password",
      "-AtF",
      "|",
      "-d",
      input.databaseName,
      "-c",
      "select current_setting('server_version_num') || '|' || current_database()",
    ], { environment: input.environment });
    if (result.status === 0) {
      const rows = result.stdout.split(/\r?\n/u).map((row) => row.trim())
        .filter(Boolean);
      const fields = rows.length === 1 ? rows[0]!.split("|") : [];
      if (fields.length === 2) {
        return { version: fields[0]!, databaseName: fields[1]! };
      }
    }
    await input.delayImpl(100);
  }
  throw new Error("Belief-reversal E2E PostgreSQL readiness failed.");
}

function normalizePostgrestVersion(output: string): string {
  const match = /(?:^|\s)(\d+\.\d+\.\d+)(?:\s|$)/u.exec(output.trim());
  if (!match) throw new Error("Belief-reversal E2E PostgREST version failed.");
  return match[1]!;
}

async function waitForPostgrestDatabaseIdentity(input: {
  fetchImpl: typeof fetch;
  postgrestUrl: string;
  serviceRoleJwt: string;
  delayImpl: (milliseconds: number) => Promise<void>;
}): Promise<string> {
  const url = `${input.postgrestUrl}/rpc/__vsee_task12_database_identity`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await input.fetchImpl(url, {
        method: "POST",
        headers: {
          apikey: input.serviceRoleJwt,
          authorization: `Bearer ${input.serviceRoleJwt}`,
          "content-type": "application/json",
        },
        body: "{}",
      });
      if (response.ok) {
        const body = await response.json() as unknown;
        if (typeof body === "string") return body;
      }
    } catch {
      // A newly started local PostgREST container may not be listening yet.
    }
    await input.delayImpl(100);
  }
  throw new Error("Belief-reversal E2E PostgREST readiness failed.");
}

function roleBootstrapSql(plan: BeliefReversalDockerPlan): string {
  return [
    "do $task12_roles$ begin",
    "if not exists (select 1 from pg_catalog.pg_roles where rolname='anon') then create role anon nologin noinherit; end if;",
    "if not exists (select 1 from pg_catalog.pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;",
    "if not exists (select 1 from pg_catalog.pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;",
    `if not exists (select 1 from pg_catalog.pg_roles where rolname='authenticator') then create role authenticator login noinherit password '${plan.authenticatorPassword}'; end if;`,
    "grant anon to authenticator;",
    "grant authenticated to authenticator;",
    "grant service_role to authenticator;",
    "end $task12_roles$;",
  ].join(" ");
}

const DATABASE_IDENTITY_SQL = [
  "create or replace function public.__vsee_task12_database_identity()",
  "returns text language sql stable security definer",
  "set search_path = pg_catalog",
  "as 'select current_database()';",
  "revoke all on function public.__vsee_task12_database_identity() from public, anon, authenticated;",
  "grant execute on function public.__vsee_task12_database_identity() to service_role;",
  "notify pgrst, 'reload schema';",
].join(" ");

export function createBeliefReversalInfrastructureCleanup(input: {
  dockerPlan: BeliefReversalDockerPlan;
  runner: HarnessCommandRunner;
  environment: Readonly<Record<string, string>>;
}): () => Promise<void> {
  let cleanupPromise: Promise<void> | undefined;
  return () => {
    cleanupPromise ??= Promise.resolve().then(() => {
      for (const args of input.dockerPlan.cleanup) {
        input.runner("docker", args, { environment: input.environment });
      }

      const verificationCommands = [
        [
          "ps",
          "--all",
          "--filter",
          `name=^/${input.dockerPlan.postgrest.name}$`,
          "--format",
          "{{.Names}}",
        ],
        [
          "ps",
          "--all",
          "--filter",
          `name=^/${input.dockerPlan.postgres.name}$`,
          "--format",
          "{{.Names}}",
        ],
        [
          "network",
          "ls",
          "--filter",
          `name=^${input.dockerPlan.networkName}$`,
          "--format",
          "{{.Name}}",
        ],
      ] as const;
      let verificationFailed = false;
      let namedResourceRemains = false;
      for (const args of verificationCommands) {
        const result = input.runner("docker", args, {
          environment: input.environment,
        });
        verificationFailed ||= result.status !== 0;
        namedResourceRemains ||= result.stdout.trim().length > 0;
      }
      if (verificationFailed) {
        throw new Error(
          "Belief-reversal E2E could not verify Docker resource cleanup.",
        );
      }
      if (namedResourceRemains) {
        throw new Error(
          "Belief-reversal E2E cleanup left an exact named Docker resource.",
        );
      }
    });
    return cleanupPromise;
  };
}

export async function provisionBeliefReversalE2EInfrastructure(input: {
  availability: BeliefReversalE2EAvailability;
  dockerPlan: BeliefReversalDockerPlan;
  migrationPlan: MigrationPlan;
  runner?: HarnessCommandRunner;
  fetchImpl?: typeof fetch;
  inheritedEnvironment?: Readonly<Record<string, string | undefined>>;
  issuedAtSeconds: number;
  delayImpl?: (milliseconds: number) => Promise<void>;
}): Promise<BeliefReversalE2EInfrastructure> {
  if (input.availability.state !== "eligible") {
    throw new Error("Belief-reversal E2E preflight is not eligible.");
  }
  if (input.migrationPlan.files.some((file) => file.path === undefined)) {
    throw new Error(MIGRATION_ERROR);
  }
  assertDisposableDatabaseName(input.dockerPlan.databaseName);

  const runner = input.runner ?? runHarnessCommand;
  const fetchImpl = input.fetchImpl ?? fetch;
  const inheritedEnvironment = input.inheritedEnvironment ?? process.env;
  const delayImpl = input.delayImpl ?? ((milliseconds) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const dockerEnvironment = dockerCommandEnvironment(inheritedEnvironment);
  const cleanup = createBeliefReversalInfrastructureCleanup({
    dockerPlan: input.dockerPlan,
    runner,
    environment: dockerEnvironment,
  });

  try {
    requireCommandSuccess(
      runner(
        "docker",
        ["network", "create", input.dockerPlan.networkName],
        { environment: dockerEnvironment },
      ),
      "network creation",
    );
    requireCommandSuccess(
      runner("docker", input.dockerPlan.postgres.runArgs, {
        environment: dockerEnvironment,
      }),
      "PostgreSQL container start",
    );
    const postgresPort = parseLoopbackPublishedPort(
      requireCommandSuccess(
        runner("docker", [
          "port",
          input.dockerPlan.postgres.name,
          "5432/tcp",
        ], { environment: dockerEnvironment }),
        "PostgreSQL port inspection",
      ),
      5432,
    );
    const pgEnvironment = postgresEnvironment({
      inheritedEnvironment,
      plan: input.dockerPlan,
      port: postgresPort,
    });
    const postgresIdentity = await waitForPostgresIdentity({
      runner,
      environment: pgEnvironment,
      databaseName: input.dockerPlan.databaseName,
      delayImpl,
    });
    if (
      postgresIdentity.version !== "170006"
      || postgresIdentity.databaseName !== input.dockerPlan.databaseName
    ) {
      throw new Error(TARGET_ERROR);
    }

    requireCommandSuccess(runner("psql", [
      "--no-password",
      "-v",
      "ON_ERROR_STOP=1",
      "-d",
      input.dockerPlan.databaseName,
      "-c",
      roleBootstrapSql(input.dockerPlan),
    ], { environment: pgEnvironment }), "API-role bootstrap");

    for (const migration of input.migrationPlan.files) {
      requireCommandSuccess(runner("psql", [
        "--no-password",
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        input.dockerPlan.databaseName,
        "-f",
        migration.path!,
      ], { environment: pgEnvironment }), `migration ${migration.tag}`);
    }

    requireCommandSuccess(runner("psql", [
      "--no-password",
      "-v",
      "ON_ERROR_STOP=1",
      "-d",
      input.dockerPlan.databaseName,
      "-c",
      DATABASE_IDENTITY_SQL,
    ], { environment: pgEnvironment }), "database identity installation");

    requireCommandSuccess(
      runner("docker", input.dockerPlan.postgrest.runArgs, {
        environment: dockerEnvironment,
      }),
      "PostgREST container start",
    );
    const postgrestPort = parseLoopbackPublishedPort(
      requireCommandSuccess(
        runner("docker", [
          "port",
          input.dockerPlan.postgrest.name,
          "3000/tcp",
        ], { environment: dockerEnvironment }),
        "PostgREST port inspection",
      ),
      3000,
    );
    const postgrestVersion = normalizePostgrestVersion(
      requireCommandSuccess(runner("docker", [
        "exec",
        input.dockerPlan.postgrest.name,
        "postgrest",
        "--version",
      ], { environment: dockerEnvironment }), "PostgREST version inspection"),
    );
    const postgrestUrl = `http://127.0.0.1:${postgrestPort}`;
    const serviceRoleJwt = createServiceRoleJwt({
      secret: input.dockerPlan.jwtSecret,
      issuedAtSeconds: input.issuedAtSeconds,
    });
    const postgrestDatabaseIdentity = await waitForPostgrestDatabaseIdentity({
      fetchImpl,
      postgrestUrl,
      serviceRoleJwt,
      delayImpl,
    });
    const target = assertBeliefReversalE2ETarget({
      databaseName: input.dockerPlan.databaseName,
      postgresHost: "127.0.0.1",
      postgresVersion: "17.6",
      postgrestUrl,
      postgrestVersion,
      postgrestDatabaseIdentity,
    });
    const environment = buildBeliefReversalRuntimeEnvironment({
      postgrestUrl,
      serviceRoleJwt,
      inheritedEnvironment,
    });
    return {
      target,
      migrationTerminal: input.migrationPlan.terminal,
      serviceRoleJwt,
      environment,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
