import assert from "node:assert/strict";
import test from "node:test";

import {
  assertDisposableDatabaseName,
  decideLoopbackPostgresTarget,
  makeDisposableDatabaseName,
  postgresMigrationSkipReason,
  requireLoopbackPostgres,
} from "../helpers/require-loopback-postgres";

test("PostgreSQL integration tests skip before a probe without the exact opt-in", () => {
  for (const value of [undefined, "", "0", "true", "yes", " 1"] as const) {
    assert.equal(
      postgresMigrationSkipReason({ REQUIRE_POSTGRES_MIGRATION_TESTS: value }),
      "PostgreSQL migration tests require explicit REQUIRE_POSTGRES_MIGRATION_TESTS=1 opt-in.",
    );
  }
  assert.equal(
    postgresMigrationSkipReason({ REQUIRE_POSTGRES_MIGRATION_TESTS: "1" }),
    null,
  );
});

test("loopback attestation accepts only one Unix socket, IPv4, or IPv6 row", () => {
  for (const output of ["<unix-socket>\n", "127.0.0.1\n", "::1\n"]) {
    const decision = decideLoopbackPostgresTarget({
      optIn: "1",
      probeStatus: 0,
      probeStdout: output,
    });
    assert.equal(decision.allowed, true);
  }
});

test("remote, blank, multirow, malformed, failed, and ambiguous probes fail closed", () => {
  const rejected = [
    { probeStatus: 0, probeStdout: "" },
    { probeStatus: 0, probeStdout: "10.0.0.4\n" },
    { probeStatus: 0, probeStdout: "localhost\n" },
    { probeStatus: 0, probeStdout: "127.0.0.1\n::1\n" },
    { probeStatus: 1, probeStdout: "127.0.0.1\n" },
  ];
  for (const probe of rejected) {
    assert.throws(
      () => decideLoopbackPostgresTarget({ optIn: "1", ...probe }),
      /verified loopback PostgreSQL target/i,
    );
  }
});

test("remote refusal is decided before a database creation callback can run", () => {
  let created = false;
  assert.throws(() => {
    const decision = decideLoopbackPostgresTarget({
      optIn: "1",
      probeStatus: 0,
      probeStdout: "203.0.113.9\n",
    });
    if (decision.allowed) created = true;
  }, /verified loopback PostgreSQL target/i);
  assert.equal(created, false);
});

test("disposable database names require the bounded branded prefix and random suffix", () => {
  const name = makeDisposableDatabaseName("evidence_context", "0123456789abcdef");
  assert.equal(name, "vsee_evidence_context_0123456789abcdef");
  assert.equal(assertDisposableDatabaseName(name), name);

  for (const invalid of [
    "postgres",
    "vsee_evidence_context",
    "vsee_evidence_context_short",
    "vsee_evidence_context_0123456789ABCDEf",
    "vsee_evidence_context_0123456789abcdef_extra",
    "vsee_../_0123456789abcdef",
  ]) {
    assert.throws(() => assertDisposableDatabaseName(invalid), /disposable database name/i);
  }
});

test("the runtime guard never invokes a command without the exact opt-in", () => {
  let calls = 0;
  const context = requireLoopbackPostgres({
    environment: {},
    runner() {
      calls += 1;
      throw new Error("runner must not be called");
    },
  });

  assert.deepEqual(context, {
    state: "skipped",
    reason: "PostgreSQL migration tests require explicit REQUIRE_POSTGRES_MIGRATION_TESTS=1 opt-in.",
  });
  assert.equal(calls, 0);
});

test("the runtime guard refuses a remote probe before checking privileges", () => {
  const commands: string[] = [];
  assert.throws(
    () => requireLoopbackPostgres({
      environment: { REQUIRE_POSTGRES_MIGRATION_TESTS: "1" },
      runner(command) {
        commands.push(command);
        return { status: 0, stdout: "203.0.113.9\n", stderr: "" };
      },
    }),
    /verified loopback PostgreSQL target/i,
  );
  assert.deepEqual(commands, ["psql"]);
});

test("the runtime guard exposes database commands only after loopback and privilege checks", () => {
  const commands: Array<{ command: string; args: readonly string[] }> = [];
  const context = requireLoopbackPostgres({
    environment: { REQUIRE_POSTGRES_MIGRATION_TESTS: "1" },
    runner(command, args) {
      commands.push({ command, args });
      if (commands.length === 1) {
        return { status: 0, stdout: "127.0.0.1\n", stderr: "" };
      }
      if (commands.length === 2) {
        return { status: 0, stdout: "true\n", stderr: "" };
      }
      return { status: 0, stdout: "ok\n", stderr: "" };
    },
  });

  assert.equal(context.state, "verified");
  if (context.state !== "verified") return;
  assert.equal(context.endpoint, "127.0.0.1");
  assert.deepEqual(commands[0]?.args.slice(0, 2), ["--no-password", "-d"]);
  assert.equal(commands[0]?.args[2], "postgres");
  assert.deepEqual(commands[1]?.args.slice(0, 3), ["--no-password", "-d", "postgres"]);
  const result = context.run("createdb", ["vsee_runtime_0123456789abcdef"]);
  assert.equal(result.stdout, "ok\n");
  assert.deepEqual(commands.map(({ command }) => command), ["psql", "psql", "createdb"]);
});
