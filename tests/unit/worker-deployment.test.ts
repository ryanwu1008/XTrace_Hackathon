import assert from "node:assert/strict";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dockerfilePath = new URL("../../Dockerfile.worker", import.meta.url);
const packagePath = new URL("../../package.json", import.meta.url);
const packageLockPath = new URL("../../package-lock.json", import.meta.url);
const readmePath = new URL("../../README.md", import.meta.url);
const repositoryRootPath = new URL("../../", import.meta.url).pathname;
const workerLauncherSourcePath = new URL(
  "../../scripts/run-worker-from-keychain.zsh",
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

async function writeCleanGitFixture(directory: string): Promise<void> {
  await writeExecutable(
    join(directory, "git"),
    "#!/bin/sh\nif [ \"$1\" = \"status\" ]; then exit 0; fi\nif [ \"$1\" = \"rev-parse\" ] && [ \"$2\" = \"--verify\" ] && [ \"$3\" = \"HEAD\" ]; then printf '%s\\n' '0123456789abcdef0123456789abcdef01234567'; exit 0; fi\nexit 45\n",
  );
}

async function runtimeDirectoryState(path: string): Promise<
  | { exists: false }
  | { exists: true; inode: number; isDirectory: boolean; modifiedAt: number; size: number }
> {
  try {
    const state = await lstat(path);
    return {
      exists: true,
      inode: state.ino,
      isDirectory: state.isDirectory(),
      modifiedAt: state.mtimeMs,
      size: state.size,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { exists: false };
    }
    throw error;
  }
}

async function createWorkerRepositoryFixture(t: test.TestContext): Promise<{
  root: string;
  launcherPath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "vsee-worker-repository-"));
  const scriptsDirectory = join(root, "scripts");
  const launcherPath = join(scriptsDirectory, "run-worker-from-keychain.zsh");
  await mkdir(scriptsDirectory, { recursive: true });
  await writeFile(join(root, "package.json"), '{"private":true}\n', "utf8");
  await copyFile(workerLauncherSourcePath, launcherPath);
  await chmod(launcherPath, 0o755);
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return { root, launcherPath };
}

test("worker image has a non-root long-running command and health check", async () => {
  const dockerfile = await readFile(dockerfilePath, "utf8");

  assert.match(dockerfile, /^FROM node:22[\w.-]*-bookworm-slim/m);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /^HEALTHCHECK\b/m);
  assert.match(dockerfile, /npm",\s*"run",\s*"worker:health"/);
  assert.match(dockerfile, /^CMD \["npm",\s*"run",\s*"worker"\]$/m);
});

test("worker dependency lock supports a clean Node 22 container install", async (t) => {
  const dockerProbe = await runCommand("docker", ["version", "--format", "{{.Server.Version}}"], {
    ...process.env,
  }).catch(() => ({ exitCode: 127, output: "" }));
  if (dockerProbe.exitCode !== 0) {
    t.skip("Docker is unavailable");
    return;
  }

  const fixtureRoot = await mkdtemp(join(tmpdir(), "vsee-worker-lock-"));
  await Promise.all([
    copyFile(packagePath, join(fixtureRoot, "package.json")),
    copyFile(packageLockPath, join(fixtureRoot, "package-lock.json")),
  ]);
  t.after(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  const result = await runCommand(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${fixtureRoot}:/app`,
      "-w",
      "/app",
      "node:22.13-bookworm-slim",
      "npm",
      "ci",
      "--ignore-scripts",
    ],
    { ...process.env },
  );

  assert.equal(result.exitCode, 0, result.output);
});

test("worker build context includes every seed and research runtime import", async () => {
  const dockerfile = await readFile(dockerfilePath, "utf8");

  assert.match(
    dockerfile,
    /^COPY --chown=node:node seed\/underwriting \.\/seed\/underwriting$/m,
  );
  assert.match(
    dockerfile,
    /^COPY --chown=node:node seed\/belief-reversal \.\/seed\/belief-reversal$/m,
  );
  assert.match(
    dockerfile,
    /^COPY --chown=node:node research\/framework-authoring \.\/research\/framework-authoring$/m,
  );
});

test("worker scripts and production runbook stay documented", async () => {
  const [packageText, readme] = await Promise.all([
    readFile(packagePath, "utf8"),
    readFile(readmePath, "utf8"),
  ]);
  const packageJson = JSON.parse(packageText) as {
    scripts?: Record<string, string>;
  };

  assert.equal(packageJson.scripts?.worker, "tsx worker/runner.ts");
  assert.equal(
    packageJson.scripts?.["worker:health"],
    "node --import tsx worker/health.ts",
  );
  assert.match(readme, /docker build -f Dockerfile\.worker/i);
  assert.match(readme, /fail(?:s)? closed/i);
  assert.match(readme, /worker:health/i);
});

test("keychain worker launcher starts the worker with exact public-sandbox settings without exposing secrets or touching the real runtime", async (t) => {
  const { root, launcherPath } = await createWorkerRepositoryFixture(t);
  const fixtureDirectory = join(root, "bin");
  const tracePath = join(root, "trace.log");
  const environmentPath = join(root, "worker-environment.log");
  const realRuntimeDirectory = join(repositoryRootPath, ".runtime");
  const realRuntimeBefore = await runtimeDirectoryState(realRuntimeDirectory);
  const secrets = {
    "vsee-supabase-url": "fixture-supabase-url-secret",
    "vsee-supabase-service-role-key": "fixture-service-role-secret",
    "vsee-anthropic-api-key": "fixture-anthropic-secret",
    "vsee-xtrace-api-key": "fixture-xtrace-secret",
    "vsee-document-url-signing-secret": "fixture-document-signing-secret",
  } as const;
  await mkdir(fixtureDirectory, { recursive: true });
  await writeCleanGitFixture(fixtureDirectory);
  await writeExecutable(
    join(fixtureDirectory, "security"),
    "#!/bin/sh\nprintf 'security %s\\n' \"$5\" >> \"$FAKE_TRACE\"\ncase \"$5\" in\n  vsee-supabase-url) printf '%s' 'fixture-supabase-url-secret' ;;\n  vsee-supabase-service-role-key) printf '%s' 'fixture-service-role-secret' ;;\n  vsee-anthropic-api-key) printf '%s' 'fixture-anthropic-secret' ;;\n  vsee-xtrace-api-key) printf '%s' 'fixture-xtrace-secret' ;;\n  vsee-document-url-signing-secret) printf '%s' 'fixture-document-signing-secret' ;;\n  *) exit 44 ;;\nesac\n",
  );
  await writeExecutable(
    join(fixtureDirectory, "npm"),
    "#!/bin/sh\nprintf 'npm %s %s\\n' \"$1\" \"$2\" >> \"$FAKE_TRACE\"\n{\n  printf 'SUPABASE_URL=%s\\n' \"$SUPABASE_URL\"\n  printf 'SUPABASE_SERVICE_ROLE_KEY=%s\\n' \"$SUPABASE_SERVICE_ROLE_KEY\"\n  printf 'ANTHROPIC_API_KEY=%s\\n' \"$ANTHROPIC_API_KEY\"\n  printf 'XTRACE_API_KEY=%s\\n' \"$XTRACE_API_KEY\"\n  printf 'DOCUMENT_URL_SIGNING_SECRET=%s\\n' \"$DOCUMENT_URL_SIGNING_SECRET\"\n  printf 'APPLICATION_COMMIT=%s\\n' \"$APPLICATION_COMMIT\"\n  printf 'VSEE_DEPLOYMENT_MODE=%s\\n' \"$VSEE_DEPLOYMENT_MODE\"\n  printf 'DEMO_WORKSPACE_ID=%s\\n' \"$DEMO_WORKSPACE_ID\"\n  printf 'SUPABASE_STORAGE_BUCKET=%s\\n' \"$SUPABASE_STORAGE_BUCKET\"\n  printf 'ANTHROPIC_MODEL=%s\\n' \"$ANTHROPIC_MODEL\"\n  printf 'XTRACE_API_BASE_URL=%s\\n' \"$XTRACE_API_BASE_URL\"\n  printf 'XTRACE_APP_ID=%s\\n' \"$XTRACE_APP_ID\"\n  printf 'MARKET_USER_AGENT=%s\\n' \"$MARKET_USER_AGENT\"\n  printf 'MARKET_OFFICIAL_FEEDS_JSON=%s\\n' \"$MARKET_OFFICIAL_FEEDS_JSON\"\n  printf 'MARKET_PUBLISHER_FEEDS_JSON=%s\\n' \"$MARKET_PUBLISHER_FEEDS_JSON\"\n} > \"$FAKE_ENVIRONMENT\"\n",
  );

  const result = await runCommand("zsh", [launcherPath], {
    ...process.env,
    PATH: `${fixtureDirectory}:${process.env.PATH ?? ""}`,
    FAKE_TRACE: tracePath,
    FAKE_ENVIRONMENT: environmentPath,
    USER: "fixture-user",
  });

  assert.equal(result.exitCode, 0);
  for (const secretValue of Object.values(secrets)) {
    assert.doesNotMatch(result.output, new RegExp(secretValue));
    assert.doesNotMatch(await readFile(tracePath, "utf8"), new RegExp(secretValue));
  }
  assert.equal(
    await readFile(tracePath, "utf8"),
    [
      "security vsee-supabase-url",
      "security vsee-supabase-service-role-key",
      "security vsee-anthropic-api-key",
      "security vsee-xtrace-api-key",
      "security vsee-document-url-signing-secret",
      "npm run worker",
      "",
    ].join("\n"),
  );
  const environment = Object.fromEntries(
    (await readFile(environmentPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
  assert.deepEqual(environment, {
    SUPABASE_URL: secrets["vsee-supabase-url"],
    SUPABASE_SERVICE_ROLE_KEY: secrets["vsee-supabase-service-role-key"],
    ANTHROPIC_API_KEY: secrets["vsee-anthropic-api-key"],
    XTRACE_API_KEY: secrets["vsee-xtrace-api-key"],
    DOCUMENT_URL_SIGNING_SECRET: secrets["vsee-document-url-signing-secret"],
    APPLICATION_COMMIT: "0123456789abcdef0123456789abcdef01234567",
    VSEE_DEPLOYMENT_MODE: "public_sandbox",
    DEMO_WORKSPACE_ID: "workspace_demo",
    SUPABASE_STORAGE_BUCKET: "vsee-demo-sources",
    ANTHROPIC_MODEL: "claude-opus-4-8",
    XTRACE_API_BASE_URL: "https://api.production.xtrace.ai",
    XTRACE_APP_ID: "xtrace-vc-deal-intelligence-public-sandbox",
    MARKET_USER_AGENT: "VSee VC Intelligence public-sandbox",
    MARKET_OFFICIAL_FEEDS_JSON: '[{"id":"sequoia-official","name":"Sequoia Capital official insights","url":"https://www.sequoiacap.com/feed/","publisher":"Sequoia Capital","eventType":"funding","confidence":"medium"},{"id":"lsvp-official","name":"Lightspeed Venture Partners insights","url":"https://lsvp.com/feed/","publisher":"Lightspeed Venture Partners","eventType":"funding","confidence":"medium"}]',
    MARKET_PUBLISHER_FEEDS_JSON: '[{"id":"a16z-news","name":"a16z News","url":"https://www.a16z.news/feed","publisher":"Andreessen Horowitz","eventType":"trend","confidence":"medium"},{"id":"marijuana-moment","name":"Marijuana Moment policy news","url":"https://www.marijuanamoment.net/feed","publisher":"Marijuana Moment","eventType":"regulatory","confidence":"medium"},{"id":"fierce-healthcare","name":"Fierce Healthcare news","url":"https://www.fiercehealthcare.com/rss/xml","publisher":"Fierce Healthcare","eventType":"commercial","confidence":"medium"},{"id":"supply-chain-dive","name":"Supply Chain Dive news","url":"https://www.supplychaindive.com/feeds/news/","publisher":"Supply Chain Dive","eventType":"commercial","confidence":"medium"},{"id":"retail-dive","name":"Retail Dive news","url":"https://www.retaildive.com/feeds/news/","publisher":"Retail Dive","eventType":"commercial","confidence":"medium"}]',
  });
  assert.deepEqual(
    await runtimeDirectoryState(realRuntimeDirectory),
    realRuntimeBefore,
  );
  assert.match(await readFile(join(root, ".runtime", "worker.log"), "utf8"), /^$/);
});

test("keychain worker launcher fails closed before npm when a required secret is missing", async (t) => {
  const { root, launcherPath } = await createWorkerRepositoryFixture(t);
  const fixtureDirectory = join(root, "bin");
  const tracePath = join(root, "trace.log");
  await mkdir(fixtureDirectory, { recursive: true });
  await writeCleanGitFixture(fixtureDirectory);
  await writeExecutable(
    join(fixtureDirectory, "security"),
    "#!/bin/sh\nprintf 'security %s\\n' \"$5\" >> \"$FAKE_TRACE\"\nif [ \"$5\" = \"vsee-xtrace-api-key\" ]; then exit 44; fi\nprintf '%s' 'available-secret'\n",
  );
  await writeExecutable(
    join(fixtureDirectory, "npm"),
    "#!/bin/sh\nprintf 'npm started\\n' >> \"$FAKE_TRACE\"\n",
  );

  const result = await runCommand("zsh", [launcherPath], {
    ...process.env,
    PATH: `${fixtureDirectory}:${process.env.PATH ?? ""}`,
    FAKE_TRACE: tracePath,
    USER: "fixture-user",
  });

  assert.notEqual(result.exitCode, 0);
  assert.match(result.output, /vsee-xtrace-api-key/);
  assert.equal(
    await readFile(tracePath, "utf8"),
    [
      "security vsee-supabase-url",
      "security vsee-supabase-service-role-key",
      "security vsee-anthropic-api-key",
      "security vsee-xtrace-api-key",
      "",
    ].join("\n"),
  );
});

test("keychain worker launcher rejects a dirty worktree before secrets or npm", async (t) => {
  const { root, launcherPath } = await createWorkerRepositoryFixture(t);
  const fixtureDirectory = join(root, "bin");
  const tracePath = join(root, "trace.log");
  await mkdir(fixtureDirectory, { recursive: true });
  await writeFile(tracePath, "", "utf8");
  await writeExecutable(
    join(fixtureDirectory, "git"),
    "#!/bin/sh\nif [ \"$1\" = \"status\" ]; then printf '%s\\n' ' M worker/runner.ts'; exit 0; fi\nexit 45\n",
  );
  for (const command of ["security", "npm"]) {
    await writeExecutable(
      join(fixtureDirectory, command),
      `#!/bin/sh\nprintf '${command} started\\n' >> \"$FAKE_TRACE\"\n`,
    );
  }

  const result = await runCommand("zsh", [launcherPath], {
    ...process.env,
    PATH: `${fixtureDirectory}:${process.env.PATH ?? ""}`,
    FAKE_TRACE: tracePath,
    USER: "fixture-user",
  });

  assert.notEqual(result.exitCode, 0);
  assert.match(result.output, /dirty worktree/i);
  assert.equal(await readFile(tracePath, "utf8"), "");
});
