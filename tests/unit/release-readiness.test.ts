import assert from "node:assert/strict";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const repositoryRoot = new URL("../../", import.meta.url);
const migrationLauncherSourcePath = new URL(
  "../../scripts/apply-production-migrations.zsh",
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
const evidenceInvariantsSourcePath = new URL(
  "../../scripts/sql/production-belief-reversal-evidence-data-invariants.sql",
  import.meta.url,
).pathname;
const catalogFingerprintsSourcePath = new URL(
  "../../scripts/production-catalog-fingerprints.zsh",
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

const productionMigrationFiles = [
  "0010_underwriting_references.sql",
  "0011_underwriting_runs.sql",
  "0012_source_grounded_underwriting.sql",
  "0013_confirmed_upload_ingest.sql",
  "0014_read_api_action_drafts.sql",
  "0015_framework_catalog_checkpoint.sql",
  "0016_confirmed_upload_source_evidence_bridge.sql",
  "0017_public_sandbox_test_generations.sql",
  "0018_pgcrypto_registry_schema_usage.sql",
  "0019_belief_reversal_evidence_context.sql",
];

test("the production migration launcher remains directly executable", async () => {
  const launcherMode = (await stat(migrationLauncherSourcePath)).mode;
  assert.equal(
    launcherMode & 0o111,
    0o111,
    "scripts/apply-production-migrations.zsh must remain executable",
  );
});

test("the audited PostgreSQL 17.6 Supabase profile is exact and stage-limited", () => {
  const result = spawnSync(
    "zsh",
    [
      "-c",
      `set -euo pipefail
source "$1"
stages=(prototype 0007 0008 0009 0010 0011 0012 0013 0014 0015 0016 0017 0018)
check_variant() {
  local variable_name="$1"
  local expected_variant="$2"
  local expected_stages="$3"
  local fingerprint="\${(P)variable_name}"
  local actual_variant
  actual_variant="$(vsee_catalog_variant "$fingerprint")"
  [[ "$actual_variant" == "$expected_variant" ]]
  for stage in "\${stages[@]}"; do
    local expected_match=false
    local actual_match=false
    [[ ",$expected_stages," == *",$stage,"* ]] && expected_match=true
    vsee_catalog_matches_stage "$stage" "$fingerprint" && actual_match=true
    [[ "$actual_match" == "$expected_match" ]]
  done
  print -r -- "$variable_name|$fingerprint|$actual_variant|$expected_stages"
}
check_variant VSEE_CATALOG_PG176_SUPABASE_PROTOTYPE prototype-supabase-pg17.6 prototype
check_variant VSEE_CATALOG_PG176_SUPABASE_0007 0007-supabase-pg17.6 0007
check_variant VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0007 bridged-0007-supabase-pg17.6 0007
check_variant VSEE_CATALOG_PG176_SUPABASE_0008 0008-supabase-pg17.6 0008
check_variant VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0008 bridged-0008-supabase-pg17.6 0008
check_variant VSEE_CATALOG_PG176_SUPABASE_0009 0009-current-lineage-supabase-pg17.6 0009,0010
check_variant VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0009 0009-bridged-lineage-supabase-pg17.6 0009,0010
check_variant VSEE_CATALOG_PG176_SUPABASE_0011 0011-current-lineage-supabase-pg17.6 0011
check_variant VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0011 0011-bridged-lineage-supabase-pg17.6 0011
check_variant VSEE_CATALOG_PG176_SUPABASE_0012 0012-current-lineage-supabase-pg17.6 0012
check_variant VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0012 0012-bridged-lineage-supabase-pg17.6 0012
check_variant VSEE_CATALOG_PG176_SUPABASE_0013 0013-current-lineage-supabase-pg17.6 0013,0014,0015
check_variant VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0013 0013-bridged-lineage-supabase-pg17.6 0013,0014,0015
check_variant VSEE_CATALOG_PG176_SUPABASE_0016 0016-current-lineage-supabase-pg17.6 0016
check_variant VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0016 0016-bridged-lineage-supabase-pg17.6 0016
check_variant VSEE_CATALOG_PG176_SUPABASE_0017 0017-current-lineage-supabase-pg17.6 0017,0018
check_variant VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0017 0017-bridged-lineage-supabase-pg17.6 0017,0018
check_variant VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_0009 0009-current-lineage-supabase-createrole-pg17.6 0009,0010
check_variant VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0009 0009-bridged-lineage-supabase-createrole-pg17.6 0009,0010
check_variant VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_0011 0011-current-lineage-supabase-createrole-pg17.6 0011
check_variant VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0011 0011-bridged-lineage-supabase-createrole-pg17.6 0011
check_variant VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_0012 0012-current-lineage-supabase-createrole-pg17.6 0012
check_variant VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0012 0012-bridged-lineage-supabase-createrole-pg17.6 0012
check_variant VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_0013 0013-current-lineage-supabase-createrole-pg17.6 0013,0014,0015
check_variant VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0013 0013-bridged-lineage-supabase-createrole-pg17.6 0013,0014,0015
check_variant VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_0016 0016-current-lineage-supabase-createrole-pg17.6 0016
check_variant VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0016 0016-bridged-lineage-supabase-createrole-pg17.6 0016
check_variant VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_0017 0017-current-lineage-supabase-createrole-pg17.6 0017,0018
check_variant VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0017 0017-bridged-lineage-supabase-createrole-pg17.6 0017,0018
if vsee_catalog_variant "sha256:0884bf536c6724bb90683cd7ab9da6e08cd6ec98fbc1b517e49fddf7b24151f4" >/dev/null; then
  print -- unexpected-create-variant
else
  print -- create-variant-refused
fi`,
      "vsee-fingerprint-audit",
      catalogFingerprintsSourcePath,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );

  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split("\n");
  assert.deepEqual(lines, [
    "VSEE_CATALOG_PG176_SUPABASE_PROTOTYPE|sha256:9d54dddfadf68c2a72e1247b182a1998940aadd9110816a63b6c9529835fb3e1|prototype-supabase-pg17.6|prototype",
    "VSEE_CATALOG_PG176_SUPABASE_0007|sha256:b2a5465d23e7109638270b72247040060b5f54f16f8846a9bca08a86ebc62f25|0007-supabase-pg17.6|0007",
    "VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0007|sha256:cc390fa7000e1e85d73c601ec5cef8fd0eb83a5d4ccbb11da3c9a94ebe9fa684|bridged-0007-supabase-pg17.6|0007",
    "VSEE_CATALOG_PG176_SUPABASE_0008|sha256:20b525eb134e2e8726e21f60a52e531d935b4c739824bcfd5f06421bfa696443|0008-supabase-pg17.6|0008",
    "VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0008|sha256:c63910c08ee882fee34c23d160438341d81f704d7a193e976e1d27b2255084c6|bridged-0008-supabase-pg17.6|0008",
    "VSEE_CATALOG_PG176_SUPABASE_0009|sha256:4803b01b5b526660faa0059071360c709209c83587edb5bd719c4b855dd2638b|0009-current-lineage-supabase-pg17.6|0009,0010",
    "VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0009|sha256:81fddccc188a6e8ee276be9edf39aa41c95309a252f7e37815946f1a2bcef3c1|0009-bridged-lineage-supabase-pg17.6|0009,0010",
    "VSEE_CATALOG_PG176_SUPABASE_0011|sha256:8e77cd04a9b1dd99d9ee3f2c6fdc26728d5bf0298656e1eae85880bce238efe8|0011-current-lineage-supabase-pg17.6|0011",
    "VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0011|sha256:70025e158b23b4763bf214d552e62dd2308d5df3d0e826281769605104c5500c|0011-bridged-lineage-supabase-pg17.6|0011",
    "VSEE_CATALOG_PG176_SUPABASE_0012|sha256:c6e3f7cadea15a856b6dc35d7d48c02e43eac29b9c70fa458d64fd1aaec08373|0012-current-lineage-supabase-pg17.6|0012",
    "VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0012|sha256:dd6e0a421ef0f7268250bcfaf2ce8ffacce436f9d80cdd432a7fc3282a8aadc2|0012-bridged-lineage-supabase-pg17.6|0012",
    "VSEE_CATALOG_PG176_SUPABASE_0013|sha256:0e678aa2e48b6844737ff6f634aad82a673d24e7fabee74c99fd9ced4b7dcb97|0013-current-lineage-supabase-pg17.6|0013,0014,0015",
    "VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0013|sha256:b6cab17c34755d2f4c05ec408cca8385b5047e293090d79fd789d64125e8fe97|0013-bridged-lineage-supabase-pg17.6|0013,0014,0015",
    "VSEE_CATALOG_PG176_SUPABASE_0016|sha256:3c8dc4ad0a220168d82cee65f26b2478c7584da7e3a28b9e4dfb35832ee196f1|0016-current-lineage-supabase-pg17.6|0016",
    "VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0016|sha256:11d6772d9972dc93958c1faa732fc1c5f814cf3e746558dd539cc11774f729a7|0016-bridged-lineage-supabase-pg17.6|0016",
    "VSEE_CATALOG_PG176_SUPABASE_0017|sha256:471ca93e9532dcde79d963cf8de7520fe1f0d4569e14a57a7830654483956daf|0017-current-lineage-supabase-pg17.6|0017,0018",
    "VSEE_CATALOG_PG176_SUPABASE_BRIDGED_0017|sha256:f7d0fb4869aff4c12b24a05cd5b637b684846182f20b4363bf83c816337bebbe|0017-bridged-lineage-supabase-pg17.6|0017,0018",
    "VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_0009|sha256:d72fcf58d6ac83fad33ff74fcc62dcd475ea1894bfcee99d5ac6f9ee82e4a81b|0009-current-lineage-supabase-createrole-pg17.6|0009,0010",
    "VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0009|sha256:15d4475110a5425162e246a0b33a547f33b8550d1e0327c92f67de9db8f1071e|0009-bridged-lineage-supabase-createrole-pg17.6|0009,0010",
    "VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_0011|sha256:cabc34dd16625eb8f12319b220aabc0e6ad07309592f31562faaab5ce869f842|0011-current-lineage-supabase-createrole-pg17.6|0011",
    "VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0011|sha256:cb889785eb64b9a44940c36aef4875938f2d2c4382cd0da3927919de3d43c9cf|0011-bridged-lineage-supabase-createrole-pg17.6|0011",
    "VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_0012|sha256:9b52be35bf23b6342b8fd55845617cb6cec8b436cc9963dbd1c2cce6e67686b4|0012-current-lineage-supabase-createrole-pg17.6|0012",
    "VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0012|sha256:9d782b4e6480f9b527b21d265a0b7d6d3d6df75f278bbadb1c4e383bcff92cd8|0012-bridged-lineage-supabase-createrole-pg17.6|0012",
    "VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_0013|sha256:d030330d3ffd1966da82a191e9336bc22a898e4eec4d9bc8ba0926ee58f2546b|0013-current-lineage-supabase-createrole-pg17.6|0013,0014,0015",
    "VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0013|sha256:8695f2cbfb93bcf9d9b5dc88597905e2f40c038fe57cc03fbf65b009b60bbc36|0013-bridged-lineage-supabase-createrole-pg17.6|0013,0014,0015",
    "VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_0016|sha256:c7cc3de50496a8b96eb69d3566a5aa00a44eb9458ba456c20a391fdeab2467b1|0016-current-lineage-supabase-createrole-pg17.6|0016",
    "VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0016|sha256:b61191ee0055b6b20a0401d6f18f2ccb71b6013fe9f84215eddc7c4f8d658c12|0016-bridged-lineage-supabase-createrole-pg17.6|0016",
    "VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_0017|sha256:71ad64d173081f801cbe205c246e86756127b37028c054bb1c1d2321ee752ede|0017-current-lineage-supabase-createrole-pg17.6|0017,0018",
    "VSEE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0017|sha256:1e96ca563d4e38886ec7b4059b09270c8a7b8125074ab563ce07a898c1641bd3|0017-bridged-lineage-supabase-createrole-pg17.6|0017,0018",
    "create-variant-refused",
  ]);
});

test("every reviewed catalog fingerprint is unique and stage-exclusive", () => {
  const result = spawnSync(
    "zsh",
    [
      "-c",
      `set -euo pipefail
source "$1"
stages=(prototype 0007 0008 0009 0010 0011 0012 0013 0014 0015 0016 0017 0018)
variable_names=("\${(@f)$(
  sed -nE 's/^readonly (VSEE_CATALOG_[A-Z0-9_]+)=.*/\\1/p' "$1"
)}")
for variable_name in "\${variable_names[@]}"; do
  fingerprint="\${(P)variable_name}"
  variant="$(vsee_catalog_variant "$fingerprint")"
  matches=()
  for stage in "\${stages[@]}"; do
    vsee_catalog_matches_stage "$stage" "$fingerprint" \
      && matches+=("$stage")
  done
  print -r -- "$variable_name|$fingerprint|$variant|\${(j:,:)matches}"
done`,
      "vsee-all-fingerprint-audit",
      catalogFingerprintsSourcePath,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );

  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split("\n");
  assert.equal(lines.length, 63);
  const seenFingerprints = new Set<string>();
  for (const line of lines) {
    const [variableName, fingerprint, variant, actualStages] = line.split("|");
    assert.match(fingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.notEqual(variant, "");
    assert.equal(seenFingerprints.has(fingerprint), false, variableName);
    seenFingerprints.add(fingerprint);

    const suffix = variableName.match(
      /_(0007|0008|0009|0011|0012|0013|0016|0017)$/,
    )?.[1];
    const expectedStages = variableName.endsWith("PROTOTYPE")
      ? "prototype"
      : suffix === "0009"
      ? "0009,0010"
      : suffix === "0013"
      ? "0013,0014,0015"
      : suffix === "0017"
      ? "0017,0018"
      : suffix;
    assert.equal(actualStages, expectedStages, variableName);
  }
});

test("the production ACL defect fingerprint is repair-only and never a valid migration stage", () => {
  const defectiveFingerprint =
    "sha256:a5e1729c32fbe1a99a0487ce7a11701e23d09dc4c201fece540967101565591c";
  const result = spawnSync(
    "zsh",
    [
      "-c",
      `set -euo pipefail
source "$1"
[[ "$VSEE_REPAIRABLE_CATALOG_PG176_SUPABASE_CREATEROLE_BRIDGED_0009_DEFAULT_FUNCTION_ACL" == "$2" ]]
[[ "$(vsee_repairable_catalog_variant "$2")" == "0009-bridged-lineage-supabase-createrole-pg17.6-default-function-acl" ]]
if vsee_catalog_variant "$2" >/dev/null; then exit 81; fi
for stage in prototype 0007 0008 0009 0010 0011 0012 0013 0014 0015 0016 0017 0018; do
  if vsee_catalog_matches_stage "$stage" "$2"; then exit 82; fi
done`,
      "vsee-repair-fingerprint-audit",
      catalogFingerprintsSourcePath,
      defectiveFingerprint,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );

  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

async function createMigrationRepositoryFixture(t: test.TestContext): Promise<{
  root: string;
  launcherPath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "vsee-migration-repository-"));
  const scriptsDirectory = join(root, "scripts");
  const scriptsSqlDirectory = join(scriptsDirectory, "sql");
  const drizzleDirectory = join(root, "drizzle");
  const launcherPath = join(scriptsDirectory, "apply-production-migrations.zsh");
  await mkdir(scriptsDirectory, { recursive: true });
  await mkdir(scriptsSqlDirectory, { recursive: true });
  await mkdir(drizzleDirectory, { recursive: true });
  await Promise.all(
    productionMigrationFiles.map((filename) =>
      writeFile(join(drizzleDirectory, filename), "-- fixture migration\n", "utf8")
    ),
  );
  await copyFile(migrationLauncherSourcePath, launcherPath);
  await copyFile(
    libpqServiceRendererSourcePath,
    join(scriptsDirectory, "render-private-libpq-service.mjs"),
  );
  await copyFile(
    catalogManifestSourcePath,
    join(scriptsSqlDirectory, "production-baseline-catalog-manifest.sql"),
  );
  await copyFile(
    catalogHasherSourcePath,
    join(scriptsDirectory, "hash-stdin-sha256.mjs"),
  );
  await copyFile(
    registryInvariantsSourcePath,
    join(scriptsSqlDirectory, "production-registry-data-invariants.sql"),
  );
  await copyFile(
    evidenceInvariantsSourcePath,
    join(
      scriptsSqlDirectory,
      "production-belief-reversal-evidence-data-invariants.sql",
    ),
  );
  const fixtureFingerprint = `sha256:${
    createHash("sha256").update("t").digest("hex")
  }`;
  await writeFile(
    join(scriptsDirectory, "production-catalog-fingerprints.zsh"),
    `#!/bin/zsh
readonly VSEE_CATALOG_PROTOTYPE="${fixtureFingerprint}"
readonly VSEE_CATALOG_0007="${fixtureFingerprint}"
readonly VSEE_CATALOG_BRIDGED_0007="${fixtureFingerprint}"
readonly VSEE_CATALOG_0008="${fixtureFingerprint}"
readonly VSEE_CATALOG_BRIDGED_0008="${fixtureFingerprint}"
readonly VSEE_CATALOG_0009="${fixtureFingerprint}"
readonly VSEE_CATALOG_BRIDGED_0009="${fixtureFingerprint}"
vsee_catalog_variant() { [[ "$1" == "${fixtureFingerprint}" ]] && print -- fixture; }
vsee_catalog_matches_stage() { [[ "$2" == "${fixtureFingerprint}" ]]; }
vsee_catalog_stage_is_reviewed() { return 0; }
`,
    "utf8",
  );
  await chmod(launcherPath, 0o755);
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return { root, launcherPath };
}

const migrationNames = [
  "0000_vsee_postgres.sql",
  "0001_remove_report_delivery.sql",
  "0002_durable_decision_lineage.sql",
  "0003_sanitize_report_next_steps.sql",
  "0004_company_analyses.sql",
  "0005_sample_decision_label.sql",
  "0006_reasoner_judgments.sql",
  "0007_uploaded_documents.sql",
  "0008_workspace_composite_identity.sql",
  "0009_source_revision_deal_registry.sql",
  "0010_underwriting_references.sql",
  "0011_underwriting_runs.sql",
  "0012_source_grounded_underwriting.sql",
  "0013_confirmed_upload_ingest.sql",
  "0014_read_api_action_drafts.sql",
  "0015_framework_catalog_checkpoint.sql",
  "0016_confirmed_upload_source_evidence_bridge.sql",
  "0017_public_sandbox_test_generations.sql",
  "0018_pgcrypto_registry_schema_usage.sql",
  "0019_belief_reversal_evidence_context.sql",
  "0020_belief_reversal_demo_seed.sql",
];

const migrationTestNames = [
  "tests/integration/report-next-step-migration.test.ts",
  "tests/integration/company-analyses-migration.test.ts",
  "tests/integration/production-baseline-bridge.test.ts",
  "tests/integration/workspace-composite-migration.test.ts",
  "tests/integration/schema-migrations.test.ts",
  "tests/integration/underwriting-reference-migration.test.ts",
  "tests/integration/upload-confirmation-migration.test.ts",
  "tests/integration/action-draft-migration.test.ts",
  "tests/integration/framework-catalog-checkpoint-migration.test.ts",
  "tests/integration/public-sandbox-reset-migration.test.ts",
  "tests/integration/pgcrypto-registry-schema-usage-migration.test.ts",
  "tests/integration/belief-reversal-evidence-context-migration.test.ts",
  "tests/integration/belief-reversal-demo-seed-migration.test.ts",
];

test("release migration verification is serial and includes every migration suite", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("package.json", repositoryRoot), "utf8"),
  ) as { scripts?: Record<string, string> };
  const command = packageJson.scripts?.["test:migrations"] ?? "";

  assert.match(command, /^REQUIRE_POSTGRES_MIGRATION_TESTS=1\s+/);
  assert.match(command, /--test-concurrency=1(?:\s|$)/);
  let previous = -1;
  for (const testName of migrationTestNames) {
    const position = command.indexOf(testName);
    assert.ok(position > previous, `${testName} must run once in release order`);
    assert.equal(
      command.split(testName).length - 1,
      1,
      `${testName} must occur exactly once`,
    );
    previous = position;
  }
});

test("release verification has a mandatory PostgreSQL 17.6 Supabase profile gate", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("package.json", repositoryRoot), "utf8"),
  ) as { scripts?: Record<string, string> };
  const command =
    packageJson.scripts?.["test:migrations:production-pg176"] ?? "";

  assert.match(
    command,
    /^REQUIRE_POSTGRES_MIGRATION_TESTS=1\s+REQUIRE_SUPABASE_PG176_MIGRATION_TESTS=1\s+/,
  );
  assert.match(command, /--test-concurrency=1(?:\s|$)/);
  assert.match(command, /--test-name-pattern=/);
  assert.equal(
    command.split("tests/integration/production-baseline-bridge.test.ts")
      .length - 1,
    1,
  );
  for (const testName of [
    "the PostgreSQL 17.6 Supabase prototype passes both guarded launchers through 0018",
    "a PostgreSQL 17.6 non-superuser CREATEROLE executor passes both guarded launchers through 0018",
    "the guarded bootstrap repairs the exact PostgreSQL 17.6 Supabase default-function ACL defect",
  ]) {
    assert.equal(command.split(testName).length - 1, 1, testName);
  }
});

test("the physical migration chain is contiguous from 0000 through 0020", async () => {
  const actual = (await readdir(new URL("drizzle/", repositoryRoot)))
    .filter((filename) => /^\d{4}_.+\.sql$/.test(filename))
    .sort();

  assert.deepEqual(actual, migrationNames);
});

test("journaled forward migrations preserve physical order and include 0010 through 0020", async () => {
  const journal = JSON.parse(
    await readFile(
      new URL("drizzle/meta/_journal.json", repositoryRoot),
      "utf8",
    ),
  ) as { entries: Array<{ idx: number; tag: string; when: number }> };
  const actualForwardEntries = journal.entries.map(({ tag }) => tag);
  const physicalTags = migrationNames.map((filename) =>
    filename.replace(/\.sql$/, "")
  );

  assert.deepEqual(
    actualForwardEntries.filter((tag) => /^(?:001[0-9]|0020)_/.test(tag)),
    physicalTags.slice(10),
  );
  let previousPhysicalPosition = -1;
  for (const tag of actualForwardEntries) {
    const physicalPosition = physicalTags.indexOf(tag);
    assert.ok(
      physicalPosition > previousPhysicalPosition,
      `${tag} must preserve physical migration order`,
    );
    previousPhysicalPosition = physicalPosition;
  }
  for (let index = 1; index < journal.entries.length; index += 1) {
    assert.ok(journal.entries[index]!.idx > journal.entries[index - 1]!.idx);
    assert.ok(
      journal.entries[index]!.when > journal.entries[index - 1]!.when,
    );
  }
});

test("production migration launcher inventories sentinels, applies from the first missing migration, and verifies each result", async (t) => {
  const { root, launcherPath } = await createMigrationRepositoryFixture(t);
  const fixtureDirectory = join(root, "bin");
  const tracePath = join(root, "trace.log");
  const appliedPath = join(root, "applied.log");
  const databaseUrl =
    "postgresql://fixture-user:do-not-print-this-database-url@db.example.test/postgres";
  await mkdir(fixtureDirectory, { recursive: true });
  await writeExecutable(
    join(fixtureDirectory, "security"),
    "#!/bin/sh\nprintf 'security %s\\n' \"$5\" >> \"$FAKE_TRACE\"\nprintf '%s' \"$FAKE_DATABASE_URL\"\n",
  );
  await writeExecutable(
    join(fixtureDirectory, "psql"),
    "#!/bin/sh\nargs=\"$*\"\ncase \"$args\" in *' -v ON_ERROR_STOP=1 '*) ;; *) exit 67;; esac\ncase \"$args\" in\n  *' -f '*)\n    file=\"\"\n    previous=\"\"\n    for argument in \"$@\"; do\n      if [ \"$previous\" = \"-f\" ]; then file=\"$argument\"; break; fi\n      previous=\"$argument\"\n    done\n    id=$(basename \"$file\" | cut -c1-4)\n    printf 'apply %s\\n' \"$id\" >> \"$FAKE_TRACE\"\n    printf '%s\\n' \"$id\" >> \"$FAKE_APPLIED\"\n    exit 0\n    ;;\nesac\nid=$(printf '%s\\n' \"$args\" | sed -n 's/.*vsee-sentinel: \\(00[0-9][0-9]\\).*/\\1/p')\nprintf 'query %s\\n' \"$id\" >> \"$FAKE_TRACE\"\nif [ \"$id\" = \"0009\" ] || [ \"$id\" -le \"$FAKE_INITIAL_COMPLETE\" ] || grep -qx \"$id\" \"$FAKE_APPLIED\" 2>/dev/null; then\n  printf 't\\n'\nelse\n  printf 'f\\n'\nfi\n",
  );

  const result = await runCommand("zsh", [launcherPath], {
    ...process.env,
    PATH: `${fixtureDirectory}:${process.env.PATH ?? ""}`,
    FAKE_TRACE: tracePath,
    FAKE_APPLIED: appliedPath,
    FAKE_DATABASE_URL: databaseUrl,
    FAKE_INITIAL_COMPLETE: "0011",
    USER: "fixture-user",
  });

  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(result.output, new RegExp(databaseUrl));
  const trace = (await readFile(tracePath, "utf8")).trim().split("\n");
  assert.deepEqual(trace.slice(0, 12), [
    "security vsee-supabase-db-url",
    "query 0009",
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
  ]);
  for (const id of ["0012", "0013", "0014", "0015", "0016", "0017", "0018", "0019"]) {
    const applyIndex = trace.indexOf(`apply ${id}`);
    assert.ok(applyIndex > 0, `${id} must be applied`);
    assert.equal(trace[applyIndex + 1], `query ${id}`, `${id} must be verified after apply`);
  }
});

test("production migration launcher keeps the Keychain URI out of psql argv and removes its private service file", async (t) => {
  const { root, launcherPath } = await createMigrationRepositoryFixture(t);
  const fixtureDirectory = join(root, "bin");
  const argvPath = join(root, "psql-argv.log");
  const serviceDetailsPath = join(root, "service-details.log");
  const databaseUrl =
    "postgresql://fixture-user:argv-secret-value@db.example.test:5432/postgres";
  await mkdir(fixtureDirectory, { recursive: true });
  await writeExecutable(
    join(fixtureDirectory, "security"),
    "#!/bin/sh\nprintf '%s' \"$FAKE_DATABASE_URL\"\n",
  );
  await writeExecutable(
    join(fixtureDirectory, "psql"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_PSQL_ARGV"
if [ -n "\${PGSERVICEFILE:-}" ] && [ ! -s "$FAKE_SERVICE_DETAILS" ]; then
  mode=$(stat -f '%Lp' "$PGSERVICEFILE" 2>/dev/null || stat -c '%a' "$PGSERVICEFILE" 2>/dev/null)
  pass_mode=$(stat -f '%Lp' "$PGPASSFILE" 2>/dev/null || stat -c '%a' "$PGPASSFILE" 2>/dev/null)
  printf 'path=%s\\nmode=%s\\npass_path=%s\\npass_mode=%s\\nservice=%s\\n' "$PGSERVICEFILE" "$mode" "$PGPASSFILE" "$pass_mode" "\${PGSERVICE:-}" > "$FAKE_SERVICE_DETAILS"
fi
printf 't\\n'
`,
  );

  const result = await runCommand("zsh", [launcherPath], {
    ...process.env,
    PATH: `${fixtureDirectory}:${process.env.PATH ?? ""}`,
    FAKE_DATABASE_URL: databaseUrl,
    FAKE_PSQL_ARGV: argvPath,
    FAKE_SERVICE_DETAILS: serviceDetailsPath,
    USER: "fixture-user",
  });

  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(result.output, new RegExp(databaseUrl));
  const argvLog = await readFile(argvPath, "utf8");
  assert.doesNotMatch(argvLog, /argv-secret-value/);
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

test("production launchers suppress inherited zsh tracing before reading the Keychain secret", async (t) => {
  const { root, launcherPath } = await createMigrationRepositoryFixture(t);
  const fixtureDirectory = join(root, "bin");
  const tracePath = join(root, "trace.log");
  const databaseUrl =
    "postgresql://fixture-user:must-not-appear-in-xtrace@db.example.test:5432/postgres";
  await mkdir(fixtureDirectory, { recursive: true });
  await writeExecutable(
    join(fixtureDirectory, "security"),
    "#!/bin/sh\nprintf '%s' \"$FAKE_DATABASE_URL\"\n",
  );
  await writeExecutable(
    join(fixtureDirectory, "psql"),
    "#!/bin/sh\nprintf 't\\n'\n",
  );

  const result = await runCommand("zsh", ["-x", launcherPath], {
    ...process.env,
    PATH: `${fixtureDirectory}:${process.env.PATH ?? ""}`,
    FAKE_DATABASE_URL: databaseUrl,
    FAKE_TRACE: tracePath,
    USER: "fixture-user",
  });

  assert.equal(result.exitCode, 0, result.output);
  assert.doesNotMatch(result.output, /must-not-appear-in-xtrace/);
  assert.doesNotMatch(result.output, /postgres(?:ql)?:\/\//);
});

test("private libpq renderer rejects a missing host, username, or database name", async (t) => {
  for (const scenario of [
    { name: "host", uri: "postgresql:///postgres" },
    { name: "username", uri: "postgresql://db.example.test/postgres" },
    { name: "database", uri: "postgresql://fixture-user@db.example.test/" },
  ]) {
    await t.test(scenario.name, async (subtest) => {
      const root = await mkdtemp(join(tmpdir(), "vsee-libpq-renderer-"));
      subtest.after(async () => {
        await rm(root, { recursive: true, force: true });
      });
      const servicePath = join(root, "pg_service.conf");
      const passwordPath = join(root, "pgpass");
      const result = spawnSync(
        process.execPath,
        [libpqServiceRendererSourcePath, servicePath, passwordPath],
        {
          input: scenario.uri,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      assert.notEqual(result.status, 0);
      assert.equal(existsSync(servicePath), false);
      assert.equal(existsSync(passwordPath), false);
    });
  }
});

test("production migration launcher rejects a later complete sentinel after a gap without applying migrations", async (t) => {
  const { root, launcherPath } = await createMigrationRepositoryFixture(t);
  const fixtureDirectory = join(root, "bin");
  const tracePath = join(root, "trace.log");
  const databaseUrl =
    "postgresql://fixture-user:do-not-print-this-database-url@db.example.test/postgres";
  await mkdir(fixtureDirectory, { recursive: true });
  await writeExecutable(
    join(fixtureDirectory, "security"),
    "#!/bin/sh\nprintf 'security %s\\n' \"$5\" >> \"$FAKE_TRACE\"\nprintf '%s' \"$FAKE_DATABASE_URL\"\n",
  );
  await writeExecutable(
    join(fixtureDirectory, "psql"),
    "#!/bin/sh\nargs=\"$*\"\ncase \"$args\" in *' -v ON_ERROR_STOP=1 '*) ;; *) exit 67;; esac\ncase \"$args\" in *' -f '*) printf 'apply unexpectedly\\n' >> \"$FAKE_TRACE\"; exit 88;; esac\nid=$(printf '%s\\n' \"$args\" | sed -n 's/.*vsee-sentinel: \\(00[0-9][0-9]\\).*/\\1/p')\nprintf 'query %s\\n' \"$id\" >> \"$FAKE_TRACE\"\nif [ \"$id\" = \"0009\" ] || [ \"$id\" = \"0010\" ] || [ \"$id\" = \"0012\" ]; then printf 't\\n'; else printf 'f\\n'; fi\n",
  );

  const result = await runCommand("zsh", [launcherPath], {
    ...process.env,
    PATH: `${fixtureDirectory}:${process.env.PATH ?? ""}`,
    FAKE_TRACE: tracePath,
    FAKE_DATABASE_URL: databaseUrl,
    USER: "fixture-user",
  });

  assert.notEqual(result.exitCode, 0);
  assert.match(result.output, /gap/i);
  assert.doesNotMatch(result.output, new RegExp(databaseUrl));
  assert.doesNotMatch(await readFile(tracePath, "utf8"), /apply unexpectedly/);
});

test("production migration launcher stops before a later file when an applied migration remains incomplete", async (t) => {
  const { root, launcherPath } = await createMigrationRepositoryFixture(t);
  const fixtureDirectory = join(root, "bin");
  const tracePath = join(root, "trace.log");
  await mkdir(fixtureDirectory, { recursive: true });
  await writeExecutable(
    join(fixtureDirectory, "security"),
    "#!/bin/sh\nprintf '%s' 'postgresql://fixture-user:fixture-password@db.example.test/postgres'\n",
  );
  await writeExecutable(
    join(fixtureDirectory, "psql"),
    "#!/bin/sh\nargs=\"$*\"\ncase \"$args\" in *' -v ON_ERROR_STOP=1 '*) ;; *) exit 67;; esac\ncase \"$args\" in *' -f '*) file=\"\"; previous=\"\"; for argument in \"$@\"; do if [ \"$previous\" = \"-f\" ]; then file=\"$argument\"; break; fi; previous=\"$argument\"; done; id=$(basename \"$file\" | cut -c1-4); printf 'apply %s\\n' \"$id\" >> \"$FAKE_TRACE\"; exit 0;; esac\nid=$(printf '%s\\n' \"$args\" | sed -n 's/.*vsee-sentinel: \\(00[0-9][0-9]\\).*/\\1/p')\nprintf 'query %s\\n' \"$id\" >> \"$FAKE_TRACE\"\nif [ \"$id\" = \"0009\" ] || [ \"$id\" = \"0010\" ] || [ \"$id\" = \"0011\" ]; then printf 't\\n'; else printf 'f\\n'; fi\n",
  );

  const result = await runCommand("zsh", [launcherPath], {
    ...process.env,
    PATH: `${fixtureDirectory}:${process.env.PATH ?? ""}`,
    FAKE_TRACE: tracePath,
    USER: "fixture-user",
  });

  assert.notEqual(result.exitCode, 0);
  assert.match(result.output, /0012 did not satisfy its sentinel/i);
  const trace = await readFile(tracePath, "utf8");
  assert.match(trace, /apply 0012/);
  assert.doesNotMatch(trace, /apply 0013/);
});

test("production migration launcher aborts before every apply when a sentinel query is not an exact boolean result", async (t) => {
  for (const scenario of ["failure", "empty", "whitespace", "noise"] as const) {
    await t.test(scenario, async (subtest) => {
      const { root, launcherPath } = await createMigrationRepositoryFixture(subtest);
      const fixtureDirectory = join(root, "bin");
      const tracePath = join(root, "trace.log");
      const databaseUrl =
        "postgresql://fixture-user:do-not-print-this-database-url@db.example.test/postgres";
      await mkdir(fixtureDirectory, { recursive: true });
      await writeExecutable(
        join(fixtureDirectory, "security"),
        "#!/bin/sh\nprintf '%s' \"$FAKE_DATABASE_URL\"\n",
      );
      await writeExecutable(
        join(fixtureDirectory, "psql"),
        "#!/bin/sh\nargs=\"$*\"\ncase \"$args\" in *' -v ON_ERROR_STOP=1 '*) ;; *) exit 67;; esac\ncase \"$args\" in *' -f '*) printf 'apply %s\\n' \"$*\" >> \"$FAKE_TRACE\"; exit 88;; esac\nid=$(printf '%s\\n' \"$args\" | sed -n 's/.*vsee-sentinel: \\(00[0-9][0-9]\\).*/\\1/p')\nprintf 'query %s\\n' \"$id\" >> \"$FAKE_TRACE\"\nif [ \"$id\" = \"0011\" ]; then\n  case \"$FAKE_BAD_RESPONSE\" in\n    failure) exit 76 ;;\n    empty) exit 0 ;;\n    whitespace) printf ' t ' ;;\n    noise) printf 't\\nnoise' ;;\n  esac\nfi\nif [ \"$id\" = \"0009\" ] || [ \"$id\" = \"0010\" ]; then printf 't\\n'; else printf 'f\\n'; fi\n",
      );

      const result = await runCommand("zsh", [launcherPath], {
        ...process.env,
        PATH: `${fixtureDirectory}:${process.env.PATH ?? ""}`,
        FAKE_TRACE: tracePath,
        FAKE_DATABASE_URL: databaseUrl,
        FAKE_BAD_RESPONSE: scenario,
        USER: "fixture-user",
      });

      assert.notEqual(result.exitCode, 0);
      assert.match(result.output, /could not verify migration sentinel: 0011/i);
      assert.doesNotMatch(result.output, new RegExp(databaseUrl));
      assert.doesNotMatch(await readFile(tracePath, "utf8"), /^apply /m);
    });
  }
});

test("production migration launcher scopes the 0015 framework catalog sentinel to candidate checkpoints", async (t) => {
  const { root, launcherPath } = await createMigrationRepositoryFixture(t);
  const fixtureDirectory = join(root, "bin");
  const queryPath = join(root, "0015-query.sql");
  await mkdir(fixtureDirectory, { recursive: true });
  await writeExecutable(
    join(fixtureDirectory, "security"),
    "#!/bin/sh\nprintf '%s' 'postgresql://fixture-user:fixture-password@db.example.test/postgres'\n",
  );
  await writeExecutable(
    join(fixtureDirectory, "psql"),
    "#!/bin/sh\nargs=\"$*\"\ncase \"$args\" in *' -v ON_ERROR_STOP=1 '*) ;; *) exit 67;; esac\ncase \"$args\" in *' -f '*) exit 88;; esac\nid=$(printf '%s\\n' \"$args\" | sed -n 's/.*vsee-sentinel: \\(00[0-9][0-9]\\).*/\\1/p')\nif [ \"$id\" = \"0015\" ]; then printf '%s' \"$args\" > \"$FAKE_0015_QUERY\"; fi\nprintf 't\\n'\n",
  );

  const result = await runCommand("zsh", [launcherPath], {
    ...process.env,
    PATH: `${fixtureDirectory}:${process.env.PATH ?? ""}`,
    FAKE_0015_QUERY: queryPath,
    USER: "fixture-user",
  });

  assert.equal(result.exitCode, 0);
  assert.match(
    await readFile(queryPath, "utf8"),
    /conrelid\s*=\s*to_regclass\('public\.candidate_checkpoints'\)/i,
  );
});
