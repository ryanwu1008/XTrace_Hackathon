import assert from "node:assert/strict";
import test from "node:test";

import {
  createMemoryDataClient,
  createSupabaseDataClient,
} from "../../db/client";
import { createRunsRepository } from "../../db/repositories/runs";
import { marketEventV2, exactSourceV2 } from "../helpers/source-evidence-v2";
import { createMemoryMarketEvidenceSnapshotsRepository } from "../../db/repositories/market-evidence-snapshots";

test("claims a queued run once and persists completion", async () => {
  const client = createMemoryDataClient();
  const runs = createRunsRepository(client);
  const run = await runs.create({
    workspaceId: "demo",
    mode: "xtrace",
    windowDays: 14,
  });

  const claimed = await runs.claimNext("worker_1");
  assert.equal(claimed?.id, run.id);
  assert.equal(claimed?.status, "running");
  assert.equal(await runs.claimNext("worker_2"), null);

  const completed = await runs.finish({
    workspaceId: run.workspaceId,
    runId: run.id,
    status: "completed",
  });
  assert.equal(completed.status, "completed");
  assert.ok(completed.completedAt);
});

test("reuses an active run for the same workspace, mode, and window", async () => {
  const client = createMemoryDataClient();
  const runs = createRunsRepository(client);

  const first = await runs.create({
    workspaceId: "demo",
    mode: "structured",
    windowDays: 14,
  });
  const second = await runs.create({
    workspaceId: "demo",
    mode: "structured",
    windowDays: 14,
  });

  assert.equal(second.id, first.id);
  assert.equal(second.evidenceContext.state, "current");
  assert.equal(second.evidenceContext.state === "current" && second.evidenceContext.evidenceMode, "live");
});

test("different active evidence contexts fail with the typed single-run conflict", async () => {
  const now = new Date("2026-08-02T06:59:59.999Z");
  const snapshots = createMemoryMarketEvidenceSnapshotsRepository({ now: () => now });
  const source = exactSourceV2("source_pinned", {
    publishedAt: "2026-07-29T18:00:00.000Z",
    retrievedAt: "2026-08-01T12:00:00.000Z",
  });
  const snapshot = await snapshots.create({
    schemaVersion: "market-evidence-snapshot-v1",
    workspaceId: "demo",
    id: "snapshot_demo",
    snapshotAsOfDate: "2026-08-01",
    windowDays: 14,
    anchorAt: "2026-08-02T06:59:59.999Z",
    windowStartAt: "2026-07-19T07:00:00.000Z",
    windowEndAt: "2026-08-02T06:59:59.999Z",
    windowTimezone: "America/Los_Angeles",
    events: [marketEventV2(source) as Extract<ReturnType<typeof marketEventV2>, { adaptation: "canonical" }>],
  });
  const runs = createRunsRepository(createMemoryDataClient({
    now: () => now,
    getEvidenceSnapshot: (workspaceId, id) => snapshots.get(workspaceId, id),
  }));
  await runs.create({ workspaceId: "demo", mode: "xtrace", windowDays: 14 });

  await assert.rejects(
    runs.create({
      workspaceId: "demo",
      mode: "xtrace",
      windowDays: 14,
      evidenceRequest: {
        schemaVersion: "run-evidence-request-v1",
        evidenceMode: "pinned",
        snapshotId: snapshot.id,
      },
    }),
    (error: unknown) => error instanceof Error
      && error.message.includes("ACTIVE_RUN_EVIDENCE_CONTEXT_CONFLICT"),
  );
});

test("a terminal run permits a later pinned context while exact pinned retries reuse", async () => {
  const now = new Date("2026-08-02T06:59:59.999Z");
  const snapshots = createMemoryMarketEvidenceSnapshotsRepository({ now: () => now });
  const source = exactSourceV2("source_pinned_terminal", {
    publishedAt: "2026-07-29T18:00:00.000Z",
    retrievedAt: "2026-08-01T12:00:00.000Z",
  });
  const snapshot = await snapshots.create({
    schemaVersion: "market-evidence-snapshot-v1",
    workspaceId: "demo",
    id: "snapshot_terminal",
    snapshotAsOfDate: "2026-08-01",
    windowDays: 14,
    anchorAt: "2026-08-02T06:59:59.999Z",
    windowStartAt: "2026-07-19T07:00:00.000Z",
    windowEndAt: "2026-08-02T06:59:59.999Z",
    windowTimezone: "America/Los_Angeles",
    events: [marketEventV2(source) as Extract<ReturnType<typeof marketEventV2>, { adaptation: "canonical" }>],
  });
  const runs = createRunsRepository(createMemoryDataClient({
    now: () => now,
    getEvidenceSnapshot: (workspaceId, id) => snapshots.get(workspaceId, id),
  }));
  const live = await runs.create({ workspaceId: "demo", mode: "structured", windowDays: 14 });
  await runs.finish({ workspaceId: "demo", runId: live.id, status: "completed" });
  const request = {
    workspaceId: "demo",
    mode: "structured" as const,
    windowDays: 14 as const,
    evidenceRequest: {
      schemaVersion: "run-evidence-request-v1" as const,
      evidenceMode: "pinned" as const,
      snapshotId: snapshot.id,
    },
  };
  const pinned = await runs.create(request);
  assert.equal(pinned.evidenceContext.state, "current");
  assert.equal(pinned.evidenceContext.state === "current" && pinned.evidenceContext.snapshotId, snapshot.id);
  assert.equal((await runs.create(request)).id, pinned.id);
  const binding = await runs.bindPinnedMarketEvents("demo", pinned.id);
  assert.equal(binding.evidenceMode, "pinned");
  assert.deepEqual(binding.events.map(({ id }) => id), ["market_acme_series_b_1"]);
  assert.deepEqual(await runs.bindPinnedMarketEvents("demo", pinned.id), binding);
});

test("live binding accepts an explicit empty accepted set and rejects pinned/live API crossing", async () => {
  const runs = createRunsRepository(createMemoryDataClient({
    now: () => new Date("2026-08-02T06:59:59.999Z"),
  }));
  const live = await runs.create({ workspaceId: "demo", mode: "xtrace", windowDays: 14 });
  const binding = await runs.bindLiveMarketEvents("demo", live.id, []);
  assert.equal(binding.evidenceMode, "live");
  assert.equal(binding.eventCount, 0);
  assert.deepEqual(binding.events, []);
  await assert.rejects(runs.bindPinnedMarketEvents("demo", live.id), /pinned run/i);
});

test("records stage progress and partial-run warnings", async () => {
  const client = createMemoryDataClient();
  const runs = createRunsRepository(client);
  const run = await runs.create({
    workspaceId: "demo",
    mode: "xtrace",
    windowDays: 14,
  });

  await runs.updateStage({
    workspaceId: run.workspaceId,
    runId: run.id,
    stage: "collect_market",
    status: "running",
    warning: "One provider timed out",
  });

  const stored = await runs.get(run.workspaceId, run.id);
  assert.equal(stored?.currentStage, "collect_market");
  assert.equal(stored?.warningCount, 1);
  assert.deepEqual(stored?.warnings, ["One provider timed out"]);
});

test("reclaims a run after its worker lease expires", async () => {
  let current = new Date("2026-07-24T12:00:00.000Z");
  const client = createMemoryDataClient({
    now: () => current,
    leaseDurationMs: 60_000,
  });
  const runs = createRunsRepository(client);
  const queued = await runs.create({
    workspaceId: "demo",
    mode: "xtrace",
    windowDays: 14,
  });

  const firstClaim = await runs.claimNext("worker_1");
  assert.equal(firstClaim?.id, queued.id);
  assert.equal(firstClaim?.workerId, "worker_1");

  current = new Date("2026-07-24T12:01:01.000Z");
  const reclaimed = await runs.claimNext("worker_2");

  assert.equal(reclaimed?.id, queued.id);
  assert.equal(reclaimed?.workerId, "worker_2");
  assert.equal(reclaimed?.status, "running");
});

test("a reclaimed run rejects writes from its previous worker", async () => {
  let current = new Date("2026-07-24T12:00:00.000Z");
  const runs = createRunsRepository(createMemoryDataClient({
    now: () => current,
    leaseDurationMs: 60_000,
  }));
  const queued = await runs.create({
    workspaceId: "demo",
    mode: "structured",
    windowDays: 14,
  });
  await runs.claimNext("worker_old");
  current = new Date("2026-07-24T12:01:01.000Z");
  await runs.claimNext("worker_new");

  await assert.rejects(
    runs.updateStage({
      workspaceId: queued.workspaceId,
      runId: queued.id,
      workerId: "worker_old",
      stage: "report",
      status: "completed",
    }),
    /no longer owns/i,
  );
  await assert.rejects(
    runs.finish({
      workspaceId: queued.workspaceId,
      runId: queued.id,
      workerId: "worker_old",
      status: "completed",
    }),
    /no longer owns/i,
  );
});

test("run stage and finish mutations cannot cross workspace boundaries", async () => {
  const runs = createRunsRepository(createMemoryDataClient());
  const run = await runs.create({
    workspaceId: "workspace_one",
    mode: "structured",
    windowDays: 14,
  });

  await assert.rejects(
    runs.updateStage({
      workspaceId: "workspace_two",
      runId: run.id,
      stage: "report",
      status: "completed",
    }),
    /not found/i,
  );
  await assert.rejects(
    runs.finish({
      workspaceId: "workspace_two",
      runId: run.id,
      status: "completed",
    }),
    /not found/i,
  );

  assert.deepEqual(await runs.get("workspace_one", run.id), run);
});

test("the data client rejects cross-workspace stage parents and identity rewrites", async () => {
  const client = createMemoryDataClient();
  const run = await client.insertRun({
    workspaceId: "workspace_one",
    mode: "structured",
    windowDays: 14,
  });

  await assert.rejects(
    client.insertRunStage({
      workspaceId: "workspace_two",
      runId: run.id,
      stage: "report",
      status: "completed",
      warning: null,
      startedAt: "2026-07-28T12:00:00.000Z",
      completedAt: "2026-07-28T12:01:00.000Z",
    }),
    /not found/i,
  );
  await assert.rejects(
    client.updateRun(
      "workspace_one",
      run.id,
      { workspaceId: "workspace_two" } as never,
    ),
    /workspace.*identity/i,
  );
  assert.equal(
    (await client.getRun("workspace_one", run.id))?.workspaceId,
    "workspace_one",
  );
});

test("worker heartbeat reports freshness without treating stale workers as healthy", async () => {
  let current = new Date("2026-07-24T12:00:00.000Z");
  const runs = createRunsRepository(createMemoryDataClient({
    now: () => current,
  }));

  assert.equal(await runs.isWorkerHealthy(30_000), false);
  await runs.touchWorkerHeartbeat("worker_1");
  assert.equal(await runs.isWorkerHealthy(30_000), true);

  current = new Date("2026-07-24T12:00:31.000Z");
  assert.equal(await runs.isWorkerHealthy(30_000), false);
});

test("accepts successful empty Supabase heartbeat responses", async () => {
  const runs = createRunsRepository(createSupabaseDataClient({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async () => new Response(null, { status: 201 }),
  }));

  await runs.touchWorkerHeartbeat("worker_1");
});

test("Supabase run reads scope the database query by workspace and run id", async () => {
  let requestedUrl = "";
  const runs = createRunsRepository(createSupabaseDataClient({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    async fetchImpl(input) {
      requestedUrl = String(input);
      return Response.json([]);
    },
  }));

  assert.equal(await runs.get("workspace_one", "run_one"), null);
  const url = new URL(requestedUrl);
  assert.equal(url.searchParams.get("workspace_id"), "eq.workspace_one");
  assert.equal(url.searchParams.get("id"), "eq.run_one");
});

test("default run lists hide rows at or before reset without hiding direct lookups", async () => {
  let current = new Date("2026-07-30T11:59:59.999Z");
  const runs = createRunsRepository(createMemoryDataClient({
    now: () => current,
  }));
  const old = await runs.create({
    workspaceId: "workspace_one",
    mode: "structured",
    windowDays: 14,
  });
  await runs.finish({
    workspaceId: old.workspaceId,
    runId: old.id,
    status: "completed",
  });
  current = new Date("2026-07-30T12:00:00.000Z");
  const boundary = await runs.create({
    workspaceId: "workspace_one",
    mode: "structured",
    windowDays: 14,
  });
  await runs.finish({
    workspaceId: boundary.workspaceId,
    runId: boundary.id,
    status: "completed",
  });
  current = new Date("2026-07-30T12:00:00.001Z");
  const fresh = await runs.create({
    workspaceId: "workspace_one",
    mode: "structured",
    windowDays: 14,
  });

  assert.deepEqual(
    (await runs.list(
      "workspace_one",
      "2026-07-30T12:00:00.000Z",
    )).map(({ id }) => id),
    [fresh.id],
  );
  assert.equal((await runs.get("workspace_one", old.id))?.id, old.id);
  assert.equal(
    (await runs.get("workspace_one", boundary.id))?.id,
    boundary.id,
  );
});

test("Supabase run list filtering is workspace-scoped and strictly after reset", async () => {
  let requestedUrl = "";
  const runs = createRunsRepository(createSupabaseDataClient({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    async fetchImpl(input) {
      requestedUrl = String(input);
      return Response.json([]);
    },
  }));

  await runs.list("workspace_one", "2026-07-30T12:00:00.000Z");

  const url = new URL(requestedUrl);
  assert.equal(url.searchParams.get("workspace_id"), "eq.workspace_one");
  assert.deepEqual(url.searchParams.getAll("created_at"), [
    "gt.2026-07-30T12:00:00.000Z",
  ]);
});

test("Supabase run writes and stage inserts always carry the trusted workspace", async () => {
  const calls: Array<{ url: URL; method: string; body: unknown }> = [];
  const row = {
    id: "00000000-0000-4000-8000-000000000001",
    workspace_id: "workspace_one",
    mode: "structured",
    window_days: 14,
    status: "running",
    current_stage: null,
    warning_count: 0,
    warnings: [],
    worker_id: null,
    created_at: "2026-07-28T12:00:00.000Z",
    started_at: "2026-07-28T12:00:00.000Z",
    completed_at: null,
    lease_expires_at: null,
  };
  const runs = createRunsRepository(createSupabaseDataClient({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    async fetchImpl(input, init) {
      const url = new URL(String(input));
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (url.pathname.endsWith("/scan_run_steps")) {
        return Response.json([{
          id: "00000000-0000-4000-8000-000000000002",
          workspace_id: "workspace_one",
          run_id: row.id,
          stage: "report",
          status: "completed",
          warning: null,
          started_at: "2026-07-28T12:01:00.000Z",
          completed_at: "2026-07-28T12:01:01.000Z",
        }]);
      }
      return Response.json([{
        ...row,
        current_stage: init?.method === "PATCH" ? "report" : null,
      }]);
    },
  }));

  await runs.updateStage({
    workspaceId: "workspace_one",
    runId: row.id,
    stage: "report",
    status: "completed",
  });

  const runMutations = calls.filter(({ url, method }) =>
    url.pathname.endsWith("/scan_runs") && method === "PATCH"
  );
  assert.equal(runMutations.length, 1);
  assert.equal(
    runMutations[0].url.searchParams.get("workspace_id"),
    "eq.workspace_one",
  );
  const stageInsert = calls.find(({ url }) =>
    url.pathname.endsWith("/scan_run_steps")
  );
  assert.deepEqual(stageInsert?.body, {
    workspace_id: "workspace_one",
    run_id: row.id,
    stage: "report",
    status: "completed",
    warning: null,
    started_at: stageInsert
      ? (stageInsert.body as Record<string, unknown>).started_at
      : undefined,
    completed_at: stageInsert
      ? (stageInsert.body as Record<string, unknown>).completed_at
      : undefined,
  });
});
