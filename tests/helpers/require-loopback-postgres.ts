import { randomBytes } from "node:crypto";
import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";

const OPT_IN_ERROR =
  "PostgreSQL migration tests require explicit REQUIRE_POSTGRES_MIGRATION_TESTS=1 opt-in.";
const TARGET_ERROR =
  "PostgreSQL migration tests require one verified loopback PostgreSQL target.";
const DATABASE_NAME_PATTERN = /^vsee_[a-z0-9_]{1,37}_[0-9a-f]{16}$/;

export interface LoopbackProbeInput {
  optIn: string | undefined;
  probeStatus: number | null;
  probeStdout: string;
}

export type VerifiedLoopbackEndpoint = "unix_socket" | "127.0.0.1" | "::1";

export interface VerifiedLoopbackDecision {
  allowed: true;
  endpoint: VerifiedLoopbackEndpoint;
}

type SpawnResult = { status: number | null; stdout: string; stderr: string };
type SpawnRunner = (
  command: string,
  args: readonly string[],
  options: SpawnSyncOptionsWithStringEncoding,
) => SpawnResult;

export interface VerifiedLoopbackPostgresContext {
  state: "verified";
  endpoint: VerifiedLoopbackEndpoint;
  run(command: "psql" | "createdb" | "dropdb", args: readonly string[]): SpawnResult;
}

export interface SkippedLoopbackPostgresContext {
  state: "skipped";
  reason: string;
}

export type LoopbackPostgresContext =
  | VerifiedLoopbackPostgresContext
  | SkippedLoopbackPostgresContext;

export function postgresMigrationSkipReason(
  environment: Readonly<Record<string, string | undefined>>,
): string | null {
  return environment.REQUIRE_POSTGRES_MIGRATION_TESTS === "1"
    ? null
    : OPT_IN_ERROR;
}

export function decideLoopbackPostgresTarget(
  input: LoopbackProbeInput,
): VerifiedLoopbackDecision {
  if (input.optIn !== "1" || input.probeStatus !== 0) {
    throw new Error(TARGET_ERROR);
  }
  const rows = input.probeStdout
    .split(/\r?\n/u)
    .map((row) => row.trim())
    .filter(Boolean);
  if (rows.length !== 1) throw new Error(TARGET_ERROR);
  const value = rows[0];
  if (value === "<unix-socket>") {
    return { allowed: true, endpoint: "unix_socket" };
  }
  if (value === "127.0.0.1" || value === "::1") {
    return { allowed: true, endpoint: value };
  }
  throw new Error(TARGET_ERROR);
}

export function assertDisposableDatabaseName(name: string): string {
  if (!DATABASE_NAME_PATTERN.test(name) || name.length > 63) {
    throw new Error("Invalid disposable database name.");
  }
  return name;
}

export function makeDisposableDatabaseName(
  purpose: string,
  randomSuffix = randomBytes(8).toString("hex"),
): string {
  const normalizedPurpose = purpose.toLowerCase().replace(/[^a-z0-9_]/gu, "_");
  return assertDisposableDatabaseName(`vsee_${normalizedPurpose}_${randomSuffix}`);
}

function defaultSpawnRunner(
  command: string,
  args: readonly string[],
  options: SpawnSyncOptionsWithStringEncoding,
): SpawnResult {
  const result = spawnSync(command, [...args], options);
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function requireLoopbackPostgres(options: {
  environment?: Readonly<Record<string, string | undefined>>;
  runner?: SpawnRunner;
} = {}): LoopbackPostgresContext {
  const environment = Object.freeze({
    ...(options.environment ?? process.env),
  }) as NodeJS.ProcessEnv;
  const skip = postgresMigrationSkipReason(environment);
  if (skip) return { state: "skipped", reason: skip };
  const runner = options.runner ?? defaultSpawnRunner;
  const commandOptions: SpawnSyncOptionsWithStringEncoding = {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: environment,
  };
  const probe = runner("psql", [
    "--no-password",
    "-d",
    "postgres",
    "-At",
    "-c",
    "select coalesce(inet_server_addr()::text, '<unix-socket>')",
  ], commandOptions);
  const decision = decideLoopbackPostgresTarget({
    optIn: environment.REQUIRE_POSTGRES_MIGRATION_TESTS,
    probeStatus: probe.status,
    probeStdout: probe.stdout,
  });
  const privilege = runner("psql", [
    "--no-password",
    "-d",
    "postgres",
    "-At",
    "-c",
    "select (rolsuper or rolcreatedb)::text from pg_catalog.pg_roles where rolname = current_user",
  ], commandOptions);
  if (privilege.status !== 0 || privilege.stdout.trim() !== "true") {
    throw new Error("The verified loopback PostgreSQL role cannot create a disposable database.");
  }
  return Object.freeze({
    state: "verified" as const,
    endpoint: decision.endpoint,
    run(command: "psql" | "createdb" | "dropdb", args: readonly string[]) {
      return runner(command, args, commandOptions);
    },
  });
}
