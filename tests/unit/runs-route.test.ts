import assert from "node:assert/strict";
import test from "node:test";

import "../helpers/public-demo";
import {
  GET as listRuns,
  POST as createRun,
} from "../../app/api/runs/route";
import { createMemoryDataClient } from "../../db/client";
import { createRunsRepository } from "../../db/repositories/runs";
import type { RouteDependencies } from "../../lib/api/route-dependencies";
import {
  PINNED_THIRTY_DEAL_SNAPSHOT_ID,
} from "../../lib/belief-reversal/pinned-thirty-deal-snapshot";
import { CreateRunRequestSchema } from "../../lib/contracts/http";

const productPartner: RouteDependencies = {
  async resolveRequestContext() {
    return {
      mode: "product",
      principal: {
        userId: "user_runs_route",
        email: "runs-route@example.test",
      },
      workspaceId: "workspace_demo",
      role: "partner",
      permissions: {
        readWorkspace: true,
        readPrivateSources: true,
        mutateSources: true,
        managePolicy: false,
        administerFrameworks: false,
      },
    };
  },
};

const publicSandbox: RouteDependencies = {
  async resolveRequestContext() {
    return {
      mode: "public_sandbox",
      principal: { userId: "system:public-sandbox", email: "sandbox@invalid.local" },
      workspaceId: "workspace_demo",
      role: "sandbox",
      permissions: {
        readWorkspace: true,
        readPrivateSources: true,
        mutateSources: true,
        managePolicy: true,
        administerFrameworks: false,
      },
    };
  },
};

interface DownstreamCalls {
  rateLimit: number;
  workerHealth: number;
  create: number;
}

function rejectingPinnedDependencies(
  context: RouteDependencies,
): { dependencies: RouteDependencies; calls: DownstreamCalls } {
  const calls: DownstreamCalls = {
    rateLimit: 0,
    workerHealth: 0,
    create: 0,
  };
  const baseRuns = createRunsRepository(createMemoryDataClient());
  return {
    calls,
    dependencies: {
      ...context,
      async rateLimitRequest() {
        calls.rateLimit += 1;
        throw new Error("REJECTED_PINNED_REQUEST_REACHED_RATE_LIMIT");
      },
      runs: {
        ...baseRuns,
        async isWorkerHealthy() {
          calls.workerHealth += 1;
          throw new Error("REJECTED_PINNED_REQUEST_REACHED_WORKER_HEALTH");
        },
        async create() {
          calls.create += 1;
          throw new Error("REJECTED_PINNED_REQUEST_REACHED_RUN_CREATE");
        },
      },
    },
  };
}

function readinessDependencies(
  context: RouteDependencies,
): { dependencies: RouteDependencies; calls: DownstreamCalls } {
  const calls: DownstreamCalls = {
    rateLimit: 0,
    workerHealth: 0,
    create: 0,
  };
  const baseRuns = createRunsRepository(createMemoryDataClient());
  return {
    calls,
    dependencies: {
      ...context,
      async rateLimitRequest() {
        calls.rateLimit += 1;
        return { allowed: true, retryAfterSeconds: 0 };
      },
      runs: {
        ...baseRuns,
        async isWorkerHealthy() {
          calls.workerHealth += 1;
          return false;
        },
        async create(input) {
          calls.create += 1;
          return baseRuns.create(input);
        },
      },
    },
  };
}

test("omitted run evidence request defaults to the typed live request", () => {
  assert.deepEqual(CreateRunRequestSchema.parse({ xtraceEnabled: false }), {
    xtraceEnabled: false,
    evidenceRequest: {
      schemaVersion: "run-evidence-request-v1",
      evidenceMode: "live",
    },
  });
});

test("product rejects the exact pinned-30 identity before downstream work", async () => {
  const guarded = rejectingPinnedDependencies(productPartner);
  const response = await createRun(new Request("http://localhost/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      xtraceEnabled: false,
      evidenceRequest: {
        schemaVersion: "run-evidence-request-v1",
        evidenceMode: "pinned",
        snapshotId: PINNED_THIRTY_DEAL_SNAPSHOT_ID,
      },
    }),
  }), undefined, guarded.dependencies);

  assert.equal(response.status, 403);
  assert.deepEqual(guarded.calls, {
    rateLimit: 0,
    workerHealth: 0,
    create: 0,
  });
});

test("public sandbox rejects every unapproved pinned snapshot before readiness", async () => {
  const guarded = rejectingPinnedDependencies(publicSandbox);
  const response = await createRun(new Request("http://localhost/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      xtraceEnabled: false,
      evidenceRequest: {
        schemaVersion: "run-evidence-request-v1",
        evidenceMode: "pinned",
        snapshotId: "arbitrary_snapshot",
      },
    }),
  }), undefined, guarded.dependencies);

  assert.equal(response.status, 403);
  assert.deepEqual(guarded.calls, {
    rateLimit: 0,
    workerHealth: 0,
    create: 0,
  });
});

test("public sandbox rejects the historical pinned-23 identity before readiness or run creation", async () => {
  const guarded = rejectingPinnedDependencies(publicSandbox);
  const response = await createRun(new Request("http://localhost/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      xtraceEnabled: false,
      evidenceRequest: {
        schemaVersion: "run-evidence-request-v1",
        evidenceMode: "pinned",
        snapshotId: "belief_reversal_2026_08_01",
      },
    }),
  }), undefined, guarded.dependencies);

  assert.equal(response.status, 403);
  assert.deepEqual(guarded.calls, {
    rateLimit: 0,
    workerHealth: 0,
    create: 0,
  });
});

test("public sandbox admits only the pinned-30 identity to readiness checks", async () => {
  const guarded = readinessDependencies(publicSandbox);
  const response = await createRun(new Request("http://localhost/api/runs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `pinned-30-${crypto.randomUUID()}`,
    },
    body: JSON.stringify({
      xtraceEnabled: false,
      evidenceRequest: {
        schemaVersion: "run-evidence-request-v1",
        evidenceMode: "pinned",
        snapshotId: PINNED_THIRTY_DEAL_SNAPSHOT_ID,
      },
    }),
  }), undefined, guarded.dependencies);
  const body = await response.json() as {
    error?: { code?: string; message?: string };
  };

  assert.equal(response.status, 503);
  assert.equal(body.error?.code, "INTEGRATION_UNAVAILABLE");
  assert.match(body.error?.message ?? "", /worker/iu);
  assert.deepEqual(guarded.calls, {
    rateLimit: 1,
    workerHealth: 1,
    create: 0,
  });
});

test("scan creation fails closed when no worker heartbeat is ready", async () => {
  const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const previousSupabaseUrl = process.env.SUPABASE_URL;
  const previousSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    const response = await createRun(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": `test-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ xtraceEnabled: false }),
      }),
      undefined,
      productPartner,
    );
    const body = await response.json() as {
      error?: { code: string; message: string; retryable: boolean };
    };

    assert.equal(response.status, 503);
    assert.equal(body.error?.code, "INTEGRATION_UNAVAILABLE");
    assert.equal(body.error?.retryable, true);
    assert.match(body.error?.message ?? "", /worker/i);

    const queued = await listRuns(
      new Request("http://localhost/api/runs"),
    );
    const queuedBody = await queued.json() as { data: unknown[] };
    assert.deepEqual(queuedBody.data, []);
  } finally {
    if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
    if (previousSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousSupabaseUrl;
    if (previousSupabaseKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousSupabaseKey;
  }
});
