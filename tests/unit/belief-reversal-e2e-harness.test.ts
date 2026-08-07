import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  POSTGRES_IMAGE,
  POSTGREST_IMAGE,
  assertBeliefReversalE2ETarget,
  buildBeliefReversalDockerPlan,
  buildBeliefReversalRuntimeEnvironment,
  createBeliefReversalInfrastructureCleanup,
  createStandalonePostgrestRepositoryFetch,
  createServiceRoleJwt,
  discoverMigrationPlan,
  parseLoopbackPublishedPort,
  probeBeliefReversalE2EAvailability,
  provisionBeliefReversalE2EInfrastructure,
  resolveMigrationPlan,
} from "../helpers/belief-reversal-e2e-harness";

test("standalone PostgREST maps the Supabase gateway prefix without changing repository requests", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const repositoryFetch = createStandalonePostgrestRepositoryFetch({
    postgrestUrl: "http://127.0.0.1:49154",
    async fetchImpl(input, init) {
      calls.push({
        url: typeof input === "string"
          ? input
          : input instanceof URL
          ? input.href
          : input.url,
        method: init?.method ?? "GET",
      });
      return new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  await repositoryFetch(
    "http://127.0.0.1:49154/rest/v1/workspaces?select=id",
    { method: "GET" },
  );
  await repositoryFetch(
    "http://127.0.0.1:49154/rest/v1/rpc/create_run",
    { method: "POST" },
  );

  assert.deepEqual(calls, [{
    url: "http://127.0.0.1:49154/workspaces?select=id",
    method: "GET",
  }, {
    url: "http://127.0.0.1:49154/rpc/create_run",
    method: "POST",
  }]);
  await assert.rejects(
    repositoryFetch("https://remote.example.test/rest/v1/workspaces"),
    /loopback PostgREST origin/iu,
  );
});

test("belief-reversal E2E refuses to probe Docker until both exact opt-ins are present", () => {
  for (const environment of [
    {},
    { REQUIRE_BELIEF_REVERSAL_E2E: "1" },
    { REQUIRE_POSTGRES_MIGRATION_TESTS: "1" },
    {
      REQUIRE_BELIEF_REVERSAL_E2E: "true",
      REQUIRE_POSTGRES_MIGRATION_TESTS: "1",
    },
  ]) {
    let calls = 0;
    const result = probeBeliefReversalE2EAvailability({
      environment,
      runner() {
        calls += 1;
        throw new Error("Docker must not be probed before both opt-ins.");
      },
    });
    assert.equal(result.state, "skipped");
    assert.equal(calls, 0);
  }
});

test("belief-reversal E2E refuses production before probing Docker", () => {
  let calls = 0;
  const result = probeBeliefReversalE2EAvailability({
    environment: {
      REQUIRE_BELIEF_REVERSAL_E2E: "1",
      REQUIRE_POSTGRES_MIGRATION_TESTS: "1",
      NODE_ENV: "production",
    },
    runner() {
      calls += 1;
      throw new Error("Production refusal must precede Docker probing.");
    },
  });
  assert.deepEqual(result, {
    state: "skipped",
    reason: "Belief-reversal E2E refuses NODE_ENV=production.",
  });
  assert.equal(calls, 0);
});

test("Docker daemon and both pinned images must be locally available", () => {
  const environment = {
    REQUIRE_BELIEF_REVERSAL_E2E: "1",
    REQUIRE_POSTGRES_MIGRATION_TESTS: "1",
  };
  const unavailable = probeBeliefReversalE2EAvailability({
    environment,
    runner(command, args) {
      assert.equal(command, "docker");
      assert.deepEqual(args, ["info", "--format", "{{.ServerVersion}}"]) ;
      return { status: 1, stdout: "", stderr: "daemon unavailable" };
    },
  });
  assert.equal(unavailable.state, "skipped");
  if (unavailable.state === "skipped") {
    assert.match(unavailable.reason, /Docker daemon is unavailable/u);
  }

  const commands: string[][] = [];
  const missingImage = probeBeliefReversalE2EAvailability({
    environment,
    runner(_command, args) {
      commands.push([...args]);
      if (args[0] === "info") {
        return { status: 0, stdout: "29.4.1\n", stderr: "" };
      }
      return args.at(-1) === POSTGRES_IMAGE
        ? { status: 0, stdout: `${POSTGRES_IMAGE}\n`, stderr: "" }
        : { status: 1, stdout: "", stderr: "missing" };
    },
  });
  assert.deepEqual(commands, [
    ["info", "--format", "{{.ServerVersion}}"],
    ["image", "inspect", "--format", "{{.RepoTags}}", POSTGRES_IMAGE],
    ["image", "inspect", "--format", "{{.RepoTags}}", POSTGREST_IMAGE],
  ]);
  assert.equal(missingImage.state, "skipped");
  if (missingImage.state === "skipped") {
    assert.match(missingImage.reason, /postgrest\/postgrest:v12\.2\.3/u);
  }
});

test("a local daemon with both pinned images is eligible", () => {
  const result = probeBeliefReversalE2EAvailability({
    environment: {
      REQUIRE_BELIEF_REVERSAL_E2E: "1",
      REQUIRE_POSTGRES_MIGRATION_TESTS: "1",
    },
    runner(_command, args) {
      return {
        status: 0,
        stdout: args[0] === "info" ? "29.4.1\n" : `${args.at(-1)}\n`,
        stderr: "",
      };
    },
  });
  assert.deepEqual(result, { state: "eligible", dockerServerVersion: "29.4.1" });
});

test("migration planning derives a contiguous terminal from physical files and journal", () => {
  const plan = resolveMigrationPlan({
    filenames: [
      "0002_two.sql",
      "0000_zero.sql",
      "0003_three.sql",
      "notes.md",
      "0001_one.sql",
    ],
    journal: {
      entries: [
        { idx: 2, tag: "0002_two" },
        { idx: 3, tag: "0003_three" },
      ],
    },
  });
  assert.deepEqual(plan.files.map(({ filename }) => filename), [
    "0000_zero.sql",
    "0001_one.sql",
    "0002_two.sql",
    "0003_three.sql",
  ]);
  assert.deepEqual(plan.terminal, {
    index: 3,
    tag: "0003_three",
    filename: "0003_three.sql",
  });
});

test("migration planning fails closed on gaps, duplicate indices, tag drift, or an unjournaled terminal", () => {
  const cases = [
    {
      filenames: ["0000_zero.sql", "0002_two.sql"],
      journal: { entries: [{ idx: 2, tag: "0002_two" }] },
    },
    {
      filenames: ["0000_zero.sql", "0000_again.sql"],
      journal: { entries: [{ idx: 0, tag: "0000_zero" }] },
    },
    {
      filenames: ["0000_zero.sql", "0001_one.sql"],
      journal: { entries: [{ idx: 1, tag: "0001_wrong" }] },
    },
    {
      filenames: ["0000_zero.sql", "0001_one.sql", "0002_two.sql"],
      journal: { entries: [{ idx: 1, tag: "0001_one" }] },
    },
  ];
  for (const input of cases) {
    assert.throws(() => resolveMigrationPlan(input), /migration chain/iu);
  }
});

test("the repository migration plan reaches the current journal and physical terminal without a hardcoded index", () => {
  const directory = fileURLToPath(new URL("../../drizzle/", import.meta.url));
  const journalPath = fileURLToPath(
    new URL("../../drizzle/meta/_journal.json", import.meta.url),
  );
  const plan = discoverMigrationPlan({ directory, journalPath });
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  const physical = readdirSync(directory)
    .filter((filename) => /^\d{4}_.+\.sql$/u.test(filename));
  assert.equal(plan.files.length, physical.length);
  assert.equal(plan.terminal.index, journal.entries.at(-1)?.idx);
  assert.equal(plan.terminal.tag, journal.entries.at(-1)?.tag);
});

test("Docker setup pins versions, binds ephemeral ports only to loopback, and mounts no host volume", () => {
  const plan = buildBeliefReversalDockerPlan({
    databaseName: "vsee_belief_e2e_0123456789abcdef",
    resourceSuffix: "0123456789abcdef",
  });
  assert.equal(plan.postgres.image, POSTGRES_IMAGE);
  assert.equal(plan.postgrest.image, POSTGREST_IMAGE);
  assert.ok(plan.postgres.runArgs.includes("127.0.0.1::5432"));
  assert.ok(plan.postgrest.runArgs.includes("127.0.0.1::3000"));
  assert.ok(plan.postgres.runArgs.includes("/var/lib/postgresql/data:rw,noexec,nosuid"));
  for (const args of [plan.postgres.runArgs, plan.postgrest.runArgs]) {
    assert.equal(args.includes("--volume"), false);
    assert.equal(args.includes("-v"), false);
    assert.equal(args.some((value) => value.startsWith("0.0.0.0:")), false);
  }
  assert.deepEqual(plan.cleanup, [
    ["rm", "--force", plan.postgrest.name],
    ["rm", "--force", plan.postgres.name],
    ["network", "rm", plan.networkName],
  ]);
});

test("published Docker ports accept only one explicit 127.0.0.1 binding", () => {
  assert.equal(parseLoopbackPublishedPort("127.0.0.1:49153\n", 5432), 49153);
  for (const value of [
    "0.0.0.0:49153\n",
    ":::49153\n",
    "127.0.0.1:49153\n127.0.0.1:49154\n",
    "127.0.0.1:not-a-port\n",
    "",
  ]) {
    assert.throws(() => parseLoopbackPublishedPort(value, 5432), /loopback.*5432/iu);
  }
});

test("runtime target preflight requires PG 17.6, PostgREST 12.2.3, exact database identity, and loopback URLs", () => {
  assert.deepEqual(assertBeliefReversalE2ETarget({
    databaseName: "vsee_belief_e2e_0123456789abcdef",
    postgresHost: "127.0.0.1",
    postgresVersion: "17.6",
    postgrestUrl: "http://127.0.0.1:49154",
    postgrestVersion: "12.2.3",
    postgrestDatabaseIdentity: "vsee_belief_e2e_0123456789abcdef",
  }), {
    databaseName: "vsee_belief_e2e_0123456789abcdef",
    postgresHost: "127.0.0.1",
    postgresVersion: "17.6",
    postgrestUrl: "http://127.0.0.1:49154",
    postgrestVersion: "12.2.3",
  });

  const base = {
    databaseName: "vsee_belief_e2e_0123456789abcdef",
    postgresHost: "127.0.0.1",
    postgresVersion: "17.6",
    postgrestUrl: "http://127.0.0.1:49154",
    postgrestVersion: "12.2.3",
    postgrestDatabaseIdentity: "vsee_belief_e2e_0123456789abcdef",
  };
  for (const changed of [
    { postgresVersion: "17.5" },
    { postgresVersion: "17.6.1" },
    { postgresHost: "localhost" },
    { postgrestUrl: "http://0.0.0.0:49154" },
    { postgrestUrl: "https://127.0.0.1:49154" },
    { postgrestVersion: "12.2.4" },
    { postgrestDatabaseIdentity: "postgres" },
  ]) {
    assert.throws(
      () => assertBeliefReversalE2ETarget({ ...base, ...changed }),
      /E2E target/iu,
    );
  }
});

test("the test runtime environment is allowlisted and never inherits external credentials", () => {
  const environment = buildBeliefReversalRuntimeEnvironment({
    postgrestUrl: "http://127.0.0.1:49154",
    serviceRoleJwt: "test-only.jwt.value",
    inheritedEnvironment: {
      ANTHROPIC_API_KEY: "must-not-leak",
      XTRACE_API_KEY: "must-not-leak",
      DATABASE_URL: "postgresql://remote.example.test/production",
      SUPABASE_URL: "https://remote.example.test",
      SUPABASE_SERVICE_ROLE_KEY: "must-not-leak",
      PATH: "/test/bin",
    },
  });
  assert.deepEqual(environment, {
    NODE_ENV: "test",
    PATH: "/test/bin",
    SUPABASE_URL: "http://127.0.0.1:49154",
    SUPABASE_SERVICE_ROLE_KEY: "test-only.jwt.value",
  });
});

test("fixture cleanup fails closed when an exact named Docker resource remains", async () => {
  const dockerPlan = buildBeliefReversalDockerPlan({
    databaseName: "vsee_belief_e2e_0123456789abcdef",
    resourceSuffix: "0123456789abcdef",
  });
  const calls: string[][] = [];
  const cleanup = createBeliefReversalInfrastructureCleanup({
    dockerPlan,
    environment: { PATH: "/test/bin" },
    runner(_command, args) {
      calls.push([...args]);
      if (args[0] === "ps") {
        return {
          status: 0,
          stdout: `${dockerPlan.postgrest.name}\n`,
          stderr: "",
        };
      }
      if (args[0] === "network" && args[1] === "ls") {
        return { status: 0, stdout: "", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  await assert.rejects(cleanup(), /cleanup left an exact named Docker resource/iu);
  await assert.rejects(cleanup(), /cleanup left an exact named Docker resource/iu);
  assert.deepEqual(calls.slice(0, 3), dockerPlan.cleanup);
  assert.equal(
    calls.filter((args) => args[0] === "rm").length,
    2,
    "both exact containers must be removed even when verification later fails",
  );
  assert.equal(
    calls.filter((args) => args[0] === "network" && args[1] === "rm").length,
    1,
  );
  assert.equal(calls.length, 6, "repeated cleanup must reuse the same result");
});

test("the service-role JWT is deterministic, test-only, and scoped to service_role", () => {
  const token = createServiceRoleJwt({
    secret: "vsee-task12-test-only-jwt-secret-32-bytes-minimum",
    issuedAtSeconds: 1_800_000_000,
  });
  const [encodedHeader, encodedPayload, signature] = token.split(".");
  assert.ok(encodedHeader && encodedPayload && signature);
  assert.deepEqual(
    JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8")),
    { alg: "HS256", typ: "JWT" },
  );
  assert.deepEqual(
    JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")),
    {
      aud: "authenticated",
      exp: 1_800_043_200,
      iat: 1_800_000_000,
      role: "service_role",
    },
  );
});

test("test-only provisioning applies every derived migration, verifies PostgREST identity, and cleans only named resources", async () => {
  const databaseName = "vsee_belief_e2e_0123456789abcdef";
  const dockerPlan = buildBeliefReversalDockerPlan({
    databaseName,
    resourceSuffix: "0123456789abcdef",
  });
  const migrationPlan = resolveMigrationPlan({
    filenames: ["0000_zero.sql", "0001_one.sql"],
    journal: { entries: [{ idx: 1, tag: "0001_one" }] },
    directory: "/fixture/drizzle",
  });
  const calls: Array<{
    command: string;
    args: readonly string[];
    environment?: Readonly<Record<string, string | undefined>>;
  }> = [];
  const infrastructure = await provisionBeliefReversalE2EInfrastructure({
    availability: { state: "eligible", dockerServerVersion: "29.4.1" },
    dockerPlan,
    migrationPlan,
    inheritedEnvironment: {
      PATH: "/test/bin",
      ANTHROPIC_API_KEY: "must-not-leak",
      SUPABASE_URL: "https://production.example.test",
    },
    issuedAtSeconds: 1_800_000_000,
    runner(command, args, options) {
      calls.push({ command, args: [...args], environment: options?.environment });
      if (command === "docker" && args[0] === "ps") {
        return { status: 0, stdout: "", stderr: "" };
      }
      if (command === "docker" && args[0] === "network" && args[1] === "ls") {
        return { status: 0, stdout: "", stderr: "" };
      }
      if (command === "docker" && args[0] === "port") {
        return {
          status: 0,
          stdout: args.at(-1) === "5432/tcp"
            ? "127.0.0.1:49153\n"
            : "127.0.0.1:49154\n",
          stderr: "",
        };
      }
      if (command === "docker" && args[0] === "exec") {
        return { status: 0, stdout: "PostgREST 12.2.3\n", stderr: "" };
      }
      if (
        command === "psql"
        && args.some((value) => value.includes("server_version_num"))
      ) {
        return { status: 0, stdout: `170006|${databaseName}\n`, stderr: "" };
      }
      return { status: 0, stdout: "ok\n", stderr: "" };
    },
    async fetchImpl(input, init) {
      assert.equal(
        input,
        "http://127.0.0.1:49154/rpc/__vsee_task12_database_identity",
      );
      assert.equal(init?.method, "POST");
      assert.match(String(new Headers(init?.headers).get("authorization")), /^Bearer /u);
      return new Response(JSON.stringify(databaseName), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    async delayImpl() {},
  });

  assert.equal(infrastructure.target.databaseName, databaseName);
  assert.equal(infrastructure.target.postgrestUrl, "http://127.0.0.1:49154");
  assert.equal(infrastructure.migrationTerminal.tag, "0001_one");
  assert.equal(infrastructure.environment.ANTHROPIC_API_KEY, undefined);
  assert.equal(
    infrastructure.environment.SUPABASE_URL,
    "http://127.0.0.1:49154",
  );
  assert.deepEqual(
    calls.filter(({ command, args }) => command === "psql" && args.includes("-f"))
      .map(({ args }) => args[args.indexOf("-f") + 1]),
    ["/fixture/drizzle/0000_zero.sql", "/fixture/drizzle/0001_one.sql"],
  );
  assert.ok(calls.filter(({ command }) => command === "psql").every(({ environment }) =>
    environment?.PGHOSTADDR === "127.0.0.1"
      && environment.PGPORT === "49153"
      && environment.PGDATABASE === databaseName
      && environment.ANTHROPIC_API_KEY === undefined
      && environment.SUPABASE_URL === undefined
  ));
  assert.ok(calls.filter(({ command }) => command === "docker").every(
    ({ environment }) =>
      environment?.PATH === "/test/bin"
      && environment.ANTHROPIC_API_KEY === undefined
      && environment.SUPABASE_URL === undefined,
  ));

  await infrastructure.cleanup();
  assert.deepEqual(
    calls.slice(-6).map(({ command, args }) => [command, ...args]),
    [
      ...dockerPlan.cleanup.map((args) => ["docker", ...args]),
      [
        "docker",
        "ps",
        "--all",
        "--filter",
        `name=^/${dockerPlan.postgrest.name}$`,
        "--format",
        "{{.Names}}",
      ],
      [
        "docker",
        "ps",
        "--all",
        "--filter",
        `name=^/${dockerPlan.postgres.name}$`,
        "--format",
        "{{.Names}}",
      ],
      [
        "docker",
        "network",
        "ls",
        "--filter",
        `name=^${dockerPlan.networkName}$`,
        "--format",
        "{{.Name}}",
      ],
    ],
  );
});

test("provisioning refuses a skipped preflight before creating Docker resources", async () => {
  let calls = 0;
  await assert.rejects(
    provisionBeliefReversalE2EInfrastructure({
      availability: { state: "skipped", reason: "no opt-in" },
      dockerPlan: buildBeliefReversalDockerPlan({
        databaseName: "vsee_belief_e2e_0123456789abcdef",
        resourceSuffix: "0123456789abcdef",
      }),
      migrationPlan: resolveMigrationPlan({
        filenames: ["0000_zero.sql"],
        journal: { entries: [{ idx: 0, tag: "0000_zero" }] },
        directory: "/fixture/drizzle",
      }),
      runner() {
        calls += 1;
        return { status: 0, stdout: "", stderr: "" };
      },
      async fetchImpl() {
        calls += 1;
        return new Response(null, { status: 500 });
      },
      issuedAtSeconds: 1_800_000_000,
    }),
    /preflight is not eligible/iu,
  );
  assert.equal(calls, 0);
});
