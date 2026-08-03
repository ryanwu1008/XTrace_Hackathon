import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const bootstrapSourcePath = new URL(
  "../../scripts/bootstrap-production-baseline.zsh",
  import.meta.url,
).pathname;
const libpqServiceRendererSourcePath = new URL(
  "../../scripts/render-private-libpq-service.mjs",
  import.meta.url,
).pathname;
const catalogManifestSourcePath = new URL(
  "../../scripts/sql/production-baseline-catalog-manifest.sql",
  import.meta.url,
).pathname;
const catalogHasherSourcePath = new URL(
  "../../scripts/hash-stdin-sha256.mjs",
  import.meta.url,
).pathname;
const registryInvariantsSourcePath = new URL(
  "../../scripts/sql/production-registry-data-invariants.sql",
  import.meta.url,
).pathname;

type CommandResult = { exitCode: number | null; output: string };

async function runCommand(
  command: string,
  arguments_: string[],
  environment: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { env: environment });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, output }));
  });
}

async function writeExecutable(path: string, contents: string): Promise<void> {
  await writeFile(path, contents, "utf8");
  await chmod(path, 0o755);
}

async function createFixture(t: test.TestContext): Promise<{
  root: string;
  bootstrapPath: string;
  fixtureBin: string;
  tracePath: string;
  appliedPath: string;
}> {
  assert.equal(
    existsSync(bootstrapSourcePath),
    true,
    "the guarded production baseline bootstrap must exist",
  );
  const root = await mkdtemp(join(tmpdir(), "vsee-baseline-bootstrap-"));
  const scriptsDirectory = join(root, "scripts");
  const sqlDirectory = join(scriptsDirectory, "sql");
  const drizzleDirectory = join(root, "drizzle");
  const fixtureBin = join(root, "bin");
  const bootstrapPath = join(scriptsDirectory, "bootstrap-production-baseline.zsh");
  const tracePath = join(root, "trace.log");
  const appliedPath = join(root, "applied.log");
  await mkdir(sqlDirectory, { recursive: true });
  await mkdir(drizzleDirectory, { recursive: true });
  await mkdir(fixtureBin, { recursive: true });
  await copyFile(bootstrapSourcePath, bootstrapPath);
  await copyFile(
    libpqServiceRendererSourcePath,
    join(scriptsDirectory, "render-private-libpq-service.mjs"),
  );
  await copyFile(
    catalogManifestSourcePath,
    join(sqlDirectory, "production-baseline-catalog-manifest.sql"),
  );
  await copyFile(
    catalogHasherSourcePath,
    join(scriptsDirectory, "hash-stdin-sha256.mjs"),
  );
  await copyFile(
    registryInvariantsSourcePath,
    join(sqlDirectory, "production-registry-data-invariants.sql"),
  );
  const fingerprint = (value: string): string =>
    `sha256:${createHash("sha256").update(value).digest("hex")}`;
  const prototypeFingerprint = fingerprint("prototype");
  const current0007Fingerprint = fingerprint("0007");
  const bridged0007Fingerprint = fingerprint("bridged-0007");
  const current0008Fingerprint = fingerprint("0008");
  const current0009Fingerprint = fingerprint("0009");
  const repairable0009Fingerprint = fingerprint("repairable-0009-acl");
  await writeFile(
    join(scriptsDirectory, "production-catalog-fingerprints.zsh"),
    `#!/bin/zsh
readonly VSEE_CATALOG_PROTOTYPE="${prototypeFingerprint}"
readonly VSEE_CATALOG_0007="${current0007Fingerprint}"
readonly VSEE_CATALOG_BRIDGED_0007="${bridged0007Fingerprint}"
readonly VSEE_CATALOG_0008="${current0008Fingerprint}"
readonly VSEE_CATALOG_BRIDGED_0008="${current0008Fingerprint}"
readonly VSEE_CATALOG_0009="${current0009Fingerprint}"
readonly VSEE_CATALOG_BRIDGED_0009="${current0009Fingerprint}"
readonly VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0009="${current0009Fingerprint}"
readonly VSEE_REPAIRABLE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0009_DEFAULT_FUNCTION_ACL="${repairable0009Fingerprint}"
vsee_catalog_variant() {
  case "$1" in
    "${prototypeFingerprint}") print -- prototype ;;
    "${current0007Fingerprint}") print -- 0007 ;;
    "${bridged0007Fingerprint}") print -- bridged-0007 ;;
    "${current0008Fingerprint}") print -- 0008 ;;
    "${current0009Fingerprint}") print -- 0009-current-lineage ;;
    *) return 1 ;;
  esac
}
vsee_catalog_matches_stage() {
  case "$1:$2" in
    prototype:${prototypeFingerprint}|0007:${current0007Fingerprint}|0007:${bridged0007Fingerprint}|0008:${current0008Fingerprint}|0009:${current0009Fingerprint}) return 0 ;;
    *) return 1 ;;
  esac
}
vsee_repairable_catalog_variant() {
  case "$1" in
    "${repairable0009Fingerprint}") print -- 0009-bridged-lineage-supabase-createrole-pg17.6-default-function-acl ;;
    *) return 1 ;;
  esac
}
`,
    "utf8",
  );
  await chmod(bootstrapPath, 0o755);
  await writeFile(
    join(sqlDirectory, "upgrade-prototype-uploaded-documents-to-0007.sql"),
    "-- bridge fixture\n",
    "utf8",
  );
  await writeFile(
    join(drizzleDirectory, "0008_workspace_composite_identity.sql"),
    "-- 0008 fixture\n",
    "utf8",
  );
  await writeFile(
    join(drizzleDirectory, "0009_source_revision_deal_registry.sql"),
    "-- 0009 fixture\n",
    "utf8",
  );
  await writeFile(
    join(sqlDirectory, "repair-0009-default-function-acl.sql"),
    "-- repair fixture\n",
    "utf8",
  );
  await writeExecutable(
    join(fixtureBin, "security"),
    "#!/bin/sh\nprintf 'security %s\\n' \"$5\" >> \"$FAKE_TRACE\"\nprintf '%s' \"$FAKE_DATABASE_URL\"\n",
  );
  await writeExecutable(
    join(fixtureBin, "psql"),
    `#!/bin/sh
args="$*"
case "$args" in *' -v ON_ERROR_STOP=1 '*) ;; *) exit 67;; esac
case "$args" in
  *'vsee-production-catalog-manifest'*)
    catalog_state="$FAKE_CATALOG_STATE"
    if grep -qx 'repair-0009-default-function-acl' "$FAKE_APPLIED" 2>/dev/null; then
      catalog_state="$FAKE_REPAIR_RESULT_CATALOG"
    elif grep -qx '0009' "$FAKE_APPLIED" 2>/dev/null; then
      catalog_state='0009'
    elif grep -qx '0008' "$FAKE_APPLIED" 2>/dev/null; then
      catalog_state='0008'
    elif grep -qx '0007' "$FAKE_APPLIED" 2>/dev/null; then
      catalog_state='bridged-0007'
    fi
    printf '%s\n' "$catalog_state"
    exit 0
    ;;
  *'vsee-registry-data-invariants'*)
    printf '%s\n' "$FAKE_REGISTRY_EXACT"
    exit 0
    ;;
esac
case "$args" in
  *' -f '*)
    file=""
    previous=""
    for argument in "$@"; do
      if [ "$previous" = "-f" ]; then file="$argument"; break; fi
      previous="$argument"
    done
    case "$(basename "$file")" in
      upgrade-prototype-*) id="0007" ;;
      repair-0009-default-function-acl.sql) id="repair-0009-default-function-acl" ;;
      *) id=$(basename "$file" | cut -c1-4) ;;
    esac
    printf 'apply %s\\n' "$id" >> "$FAKE_TRACE"
    printf '%s\\n' "$id" >> "$FAKE_APPLIED"
    exit 0
    ;;
esac
baseline_id=$(printf '%s\\n' "$args" | sed -n 's/.*vsee-baseline-state: \\(000[789]\\).*/\\1/p')
sentinel_id=$(printf '%s\\n' "$args" | sed -n 's/.*vsee-sentinel: \\(001[0-9]\\).*/\\1/p')
if [ -n "$baseline_id" ]; then
  printf 'state %s\\n' "$baseline_id" >> "$FAKE_TRACE"
  if [ "$baseline_id" = "0009" ] \
    && grep -qx 'repair-0009-default-function-acl' "$FAKE_APPLIED" 2>/dev/null; then
    printf 'complete\\n'
  elif grep -qx "$baseline_id" "$FAKE_APPLIED" 2>/dev/null; then
    if [ "$baseline_id" = "0007" ]; then
      printf 'bridged_safe\\n'
    else
      printf 'complete\\n'
    fi
  else
    case "$baseline_id" in
      0007) printf '%s\\n' "$FAKE_0007_STATE" ;;
      0008) printf '%s\\n' "$FAKE_0008_STATE" ;;
      0009) printf '%s\\n' "$FAKE_0009_STATE" ;;
    esac
  fi
  exit 0
fi
case "$args" in
  *'vsee-baseline-quiescence'*)
    printf 'quiet\\n' >> "$FAKE_TRACE"
    printf '%s\\n' "$FAKE_QUIET"
    exit 0
    ;;
  *'vsee-registry-backfill'*)
    printf 't\\n'
    exit 0
    ;;
esac
if [ -n "$sentinel_id" ]; then
  printf 'query %s\\n' "$sentinel_id" >> "$FAKE_TRACE"
  case ",$FAKE_FORWARD_COMPLETE," in
    *",$sentinel_id,"*) printf 't\\n' ;;
    *) printf 'f\\n' ;;
  esac
  exit 0
fi
exit 69
`,
  );
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    bootstrapPath,
    fixtureBin,
    tracePath,
    appliedPath,
  };
}

function fixtureEnvironment(
  fixture: {
    fixtureBin: string;
    tracePath: string;
    appliedPath: string;
  },
  overrides: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${fixture.fixtureBin}:${process.env.PATH ?? ""}`,
    FAKE_TRACE: fixture.tracePath,
    FAKE_APPLIED: fixture.appliedPath,
    FAKE_DATABASE_URL:
      "postgresql://fixture-user:do-not-print-this-baseline-url@db.example.test/postgres",
    FAKE_CATALOG_STATE: "0009",
    FAKE_0007_STATE: "complete",
    FAKE_0008_STATE: "complete",
    FAKE_0009_STATE: "complete",
    FAKE_FORWARD_COMPLETE: "",
    FAKE_QUIET: "t",
    FAKE_REGISTRY_EXACT: "t",
    FAKE_REPAIR_RESULT_CATALOG: "0009",
    USER: "fixture-user",
    ...overrides,
  };
}

test("baseline bootstrap inventories first, bridges the safe prototype, then applies and verifies 0008 and 0009", async (t) => {
  const fixture = await createFixture(t);
  const secretUrl =
    "postgresql://fixture-user:do-not-print-this-baseline-url@db.example.test/postgres";
  const result = await runCommand(
    "zsh",
    [fixture.bootstrapPath],
    fixtureEnvironment(fixture, {
      FAKE_DATABASE_URL: secretUrl,
      FAKE_CATALOG_STATE: "prototype",
      FAKE_0007_STATE: "prototype_safe",
      FAKE_0008_STATE: "absent",
      FAKE_0009_STATE: "absent",
    }),
  );

  assert.equal(result.exitCode, 0, result.output);
  assert.doesNotMatch(result.output, new RegExp(secretUrl));
  assert.deepEqual(
    (await readFile(fixture.tracePath, "utf8"))
      .trim()
      .split("\n"),
    [
      "security vsee-supabase-db-url",
      "query 0010",
      "query 0011",
      "query 0012",
      "query 0013",
      "query 0014",
      "query 0015",
      "query 0016",
      "query 0017",
      "query 0018",
      "query 0019",
      "state 0007",
      "quiet",
      "apply 0007",
      "state 0007",
      "state 0007",
      "quiet",
      "apply 0008",
      "quiet",
      "apply 0009",
    ],
  );
});

test("baseline bootstrap refuses mutation while scans or upload leases are active", async (t) => {
  const fixture = await createFixture(t);
  const result = await runCommand(
    "zsh",
    [fixture.bootstrapPath],
    fixtureEnvironment(fixture, {
      FAKE_0007_STATE: "complete",
      FAKE_CATALOG_STATE: "0007",
      FAKE_0008_STATE: "absent",
      FAKE_0009_STATE: "absent",
      FAKE_QUIET: "f",
    }),
  );

  assert.notEqual(result.exitCode, 0);
  assert.match(result.output, /active scans|upload leases|maintenance/i);
  const trace = await readFile(fixture.tracePath, "utf8");
  assert.match(trace, /^quiet$/m);
  assert.doesNotMatch(trace, /^apply /m);
});

test("baseline bootstrap keeps the Keychain URI out of psql argv and removes its private service file", async (t) => {
  const fixture = await createFixture(t);
  const argvPath = join(fixture.root, "psql-argv.log");
  const serviceDetailsPath = join(fixture.root, "service-details.log");
  const databaseUrl =
    "postgresql://fixture-user:baseline-argv-secret@db.example.test:5432/postgres";
  const originalPsqlPath = join(fixture.fixtureBin, "psql");
  await writeExecutable(
    originalPsqlPath,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_PSQL_ARGV"
if [ -n "\${PGSERVICEFILE:-}" ] && [ ! -s "$FAKE_SERVICE_DETAILS" ]; then
  mode=$(stat -f '%Lp' "$PGSERVICEFILE" 2>/dev/null || stat -c '%a' "$PGSERVICEFILE" 2>/dev/null)
  pass_mode=$(stat -f '%Lp' "$PGPASSFILE" 2>/dev/null || stat -c '%a' "$PGPASSFILE" 2>/dev/null)
  printf 'path=%s\\nmode=%s\\npass_path=%s\\npass_mode=%s\\nservice=%s\\n' "$PGSERVICEFILE" "$mode" "$PGPASSFILE" "$pass_mode" "\${PGSERVICE:-}" > "$FAKE_SERVICE_DETAILS"
fi
args="$*"
case "$args" in
  *'vsee-production-catalog-manifest'*) printf '0009\\n'; exit 0 ;;
  *'vsee-registry-data-invariants'*) printf 't\\n'; exit 0 ;;
esac
baseline_id=$(printf '%s\\n' "$args" | sed -n 's/.*vsee-baseline-state: \\(000[789]\\).*/\\1/p')
sentinel_id=$(printf '%s\\n' "$args" | sed -n 's/.*vsee-sentinel: \\(001[0-9]\\).*/\\1/p')
if [ -n "$baseline_id" ]; then printf 'complete\\n'; exit 0; fi
if [ -n "$sentinel_id" ]; then printf 'f\\n'; exit 0; fi
case "$args" in
  *'vsee-registry-backfill'*) printf 't\\n'; exit 0 ;;
esac
exit 69
`,
  );

  const result = await runCommand(
    "zsh",
    [fixture.bootstrapPath],
    fixtureEnvironment(fixture, {
      FAKE_DATABASE_URL: databaseUrl,
      FAKE_PSQL_ARGV: argvPath,
      FAKE_SERVICE_DETAILS: serviceDetailsPath,
    }),
  );

  assert.equal(result.exitCode, 0, result.output);
  assert.doesNotMatch(result.output, new RegExp(databaseUrl));
  const argvLog = await readFile(argvPath, "utf8");
  assert.doesNotMatch(argvLog, /baseline-argv-secret/);
  assert.doesNotMatch(argvLog, /postgres(?:ql)?:\/\//);
  const serviceDetails = await readFile(serviceDetailsPath, "utf8");
  assert.match(serviceDetails, /^path=.+$/m);
  assert.match(serviceDetails, /^mode=600$/m);
  assert.match(serviceDetails, /^pass_path=.+$/m);
  assert.match(serviceDetails, /^pass_mode=600$/m);
  assert.match(serviceDetails, /^service=vsee-production$/m);
  const serviceFilePath = serviceDetails.match(/^path=(.+)$/m)?.[1];
  const passwordFilePath = serviceDetails.match(/^pass_path=(.+)$/m)?.[1];
  assert.ok(serviceFilePath);
  assert.ok(passwordFilePath);
  await assert.rejects(readFile(serviceFilePath, "utf8"));
  await assert.rejects(readFile(passwordFilePath, "utf8"));
});

test("baseline bootstrap refuses unsafe prototype payload and active-state drift before applying anything", async (t) => {
  for (const state of ["prototype_unsafe", "partial"] as const) {
    await t.test(state, async (subtest) => {
      const fixture = await createFixture(subtest);
      const result = await runCommand(
        "zsh",
        [fixture.bootstrapPath],
        fixtureEnvironment(fixture, {
          FAKE_0007_STATE: state,
          FAKE_CATALOG_STATE: state === "prototype_unsafe" ? "prototype" : "unknown",
          FAKE_0008_STATE: "absent",
          FAKE_0009_STATE: "absent",
        }),
      );

      assert.notEqual(result.exitCode, 0);
      assert.match(result.output, /0007|prototype|partial|unsafe|catalog|reviewed/i);
      const trace = await readFile(fixture.tracePath, "utf8");
      assert.doesNotMatch(trace, /^apply /m);
    });
  }
});

test("baseline bootstrap refuses unreviewed catalogs or forward migrations before applying anything", async (t) => {
  const scenarios = [
    { catalog: "unknown", forward: "" },
    { catalog: "0007", forward: "0010" },
  ];
  for (const scenario of scenarios) {
    await t.test(JSON.stringify(scenario), async (subtest) => {
      const fixture = await createFixture(subtest);
      const result = await runCommand(
        "zsh",
        [fixture.bootstrapPath],
        fixtureEnvironment(fixture, {
          FAKE_CATALOG_STATE: scenario.catalog,
          FAKE_FORWARD_COMPLETE: scenario.forward,
        }),
      );

      assert.notEqual(result.exitCode, 0);
      assert.match(result.output, /catalog|reviewed|forward|migration/i);
      const trace = await readFile(fixture.tracePath, "utf8");
      assert.doesNotMatch(trace, /^apply /m);
    });
  }
});

test("baseline bootstrap is a no-op when the complete 0009 boundary already exists", async (t) => {
  const fixture = await createFixture(t);
  const result = await runCommand(
    "zsh",
    [fixture.bootstrapPath],
    fixtureEnvironment(fixture),
  );

  assert.equal(result.exitCode, 0);
  const trace = await readFile(fixture.tracePath, "utf8");
  assert.doesNotMatch(trace, /^apply /m);
  assert.match(result.output, /0009.*reviewed catalog.*data invariants/i);
});

test("baseline bootstrap repairs only the exact reviewed 0009 default-function ACL defect", async (t) => {
  const fixture = await createFixture(t);
  const result = await runCommand(
    "zsh",
    [fixture.bootstrapPath],
    fixtureEnvironment(fixture, {
      FAKE_CATALOG_STATE: "repairable-0009-acl",
      FAKE_0009_STATE: "partial",
    }),
  );

  assert.equal(result.exitCode, 0, result.output);
  assert.deepEqual(
    (await readFile(fixture.tracePath, "utf8")).trim().split("\n"),
    [
      "security vsee-supabase-db-url",
      "query 0010",
      "query 0011",
      "query 0012",
      "query 0013",
      "query 0014",
      "query 0015",
      "query 0016",
      "query 0017",
      "query 0018",
      "query 0019",
      "state 0009",
      "quiet",
      "apply repair-0009-default-function-acl",
      "state 0009",
    ],
  );
  assert.match(result.output, /default-function ACL repair.*reviewed/i);
});

test("baseline bootstrap refuses the reviewed ACL repair unless data is exact and writers are quiescent", async (t) => {
  const scenarios = [
    {
      name: "registry invariant drift",
      environment: { FAKE_REGISTRY_EXACT: "f" },
      output: /registry|invariant|data/i,
    },
    {
      name: "active writer lease",
      environment: { FAKE_QUIET: "f" },
      output: /active scans|upload leases|maintenance/i,
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async (subtest) => {
      const fixture = await createFixture(subtest);
      const result = await runCommand(
        "zsh",
        [fixture.bootstrapPath],
        fixtureEnvironment(fixture, {
          FAKE_CATALOG_STATE: "repairable-0009-acl",
          FAKE_0009_STATE: "partial",
          ...scenario.environment,
        }),
      );

      assert.notEqual(result.exitCode, 0);
      assert.match(result.output, scenario.output);
      const trace = await readFile(fixture.tracePath, "utf8");
      assert.match(trace, /^state 0009$/m);
      assert.doesNotMatch(trace, /^apply /m);
    });
  }
});

test("baseline bootstrap fails closed when the ACL repair does not reach the one reviewed postcondition", async (t) => {
  const fixture = await createFixture(t);
  const result = await runCommand(
    "zsh",
    [fixture.bootstrapPath],
    fixtureEnvironment(fixture, {
      FAKE_CATALOG_STATE: "repairable-0009-acl",
      FAKE_0009_STATE: "partial",
      FAKE_REPAIR_RESULT_CATALOG: "unreviewed-repair-result",
    }),
  );

  assert.notEqual(result.exitCode, 0);
  assert.match(result.output, /repair|postcondition|catalog|reviewed/i);
  assert.match(
    await readFile(fixture.tracePath, "utf8"),
    /^apply repair-0009-default-function-acl$/m,
  );
});
