import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMarketEventsReadPath,
  createMemoryIntelligenceRepository,
  createSupabaseIntelligenceRepository,
  type IntelligenceReportWrite,
} from "../../db/repositories/intelligence";
import * as intelligenceRepositoryModule from "../../db/repositories/intelligence";
import type { CompanyAnalysis } from "../../lib/contracts/domain";
import type { DealRegistry } from "../../db/repositories/deal-registry";
import { parseMarketEventV2Read } from "../../lib/contracts/legacy-evidence-adapter";
import {
  createMarketService,
  normalizeMarketItem,
} from "../../lib/market/service";
import {
  refingerprintMarketEvent,
  reidentifySourceRef,
} from "../../lib/market/identity";
import type { NormalizedMarketEvent } from "../../lib/market/types";
import {
  marketEventV2,
  normalizedSourceV2,
} from "../helpers/source-evidence-v2";

function event(
  id: string,
  publishedAt = "2026-07-22T12:00:00.000Z",
): NormalizedMarketEvent {
  const publishedAtPrecision = publishedAt.includes("T")
    ? "timestamp"
    : "date";
  const source = normalizedSourceV2(`source_${id}`, {
    title: `Event ${id}`,
    canonicalUrl: `https://example.com/${id}`,
    publisher: "Example",
    providerId: "example",
    eventAt: null,
    publishedAt,
    publishedAtPrecision,
    retrievedAt: "2026-07-24T12:00:00.000Z",
    updatedAt: null,
    entityKeys: [],
    text: {
      status: "normalized_only",
      normalizedStatement: "A source-backed market event.",
    },
  });
  return marketEventV2(source, {
    id,
    title: `Event ${id}`,
    eventType: "funding",
    sectors: ["ai"],
    themes: ["infrastructure"],
    summary: "A source-backed market event.",
    positiveImplications: [],
    negativeImplications: [],
    confidence: "medium",
    publishedAtPrecision,
  }) as NormalizedMarketEvent;
}

function legacyEvent(id: string) {
  return {
    id,
    title: `Legacy event ${id}`,
    eventType: "funding",
    sectors: ["ai"],
    themes: ["infrastructure"],
    summary: "Legacy source-backed market event.",
    positiveImplications: [],
    negativeImplications: [],
    publishedAt: "2026-07-22T12:00:00.000Z",
    confidence: "medium",
    sources: [{
      id: `legacy_source_${id}`,
      provenance: "public_web",
      title: `Legacy event ${id}`,
      url: `https://legacy.example/${id}`,
      publisher: "Legacy Example",
      publishedAt: "2026-07-22T12:00:00.000Z",
      excerpt: "Legacy source-backed market event.",
    }],
  };
}

function companyAnalysis(
  index: number,
  outcome: CompanyAnalysis["outcome"] = "no_material_change",
): CompanyAnalysis {
  const dealId = `deal_${String(index).padStart(2, "0")}`;
  const source = normalizedSourceV2(`source_${dealId}`, {
    provenance: "source_document",
    title: `Company ${index} pitch deck`,
    canonicalUrl: null,
    documentId: `document_${index}`,
    publisher: null,
    providerId: "source-registry",
    eventAt: null,
    eventAtPrecision: null,
    publishedAt: null,
    publishedAtPrecision: null,
    retrievedAt: "2026-07-24T12:00:00.000Z",
    retrievedAtPrecision: "timestamp",
    updatedAt: null,
    updatedAtPrecision: null,
    entityKeys: [],
    sourceClass: "company_official",
    sourceAuthority: "primary",
    evidenceRole: "context",
    sourceRevisionId: `revision_${index}`,
    locator: { kind: "document_page", page: 1 },
    text: {
      status: "normalized_only",
      normalizedStatement: `Company ${index} source evidence.`,
    },
  });
  return {
    id: `analysis_${index}`,
    reportId: "report_complete",
    runId: "00000000-0000-4000-8000-000000000001",
    dealId,
    companyName: `Company ${index}`,
    dealStatus: "passed",
    outcome,
    confidence: outcome === "belief_revised" ? "medium" : "low",
    score: outcome === "belief_revised" ? 0.75 : 0.1,
    verifiedSourceCount: 1,
    investmentMemory: {
      previousMeetingSummary: "No previous meeting summary was recorded.",
      decisionReason: "No previous decision reason was recorded.",
      concerns: [],
      revisitConditions: [],
      lastEvaluatedAt: null,
      memoryIds: [`memory_${index}`],
      sourceIds: [source.id],
      fixtureIds: [],
    },
    marketEvidence: {
      relationship: outcome === "belief_revised" ? "related" : "none",
      explanation: outcome === "belief_revised"
        ? "A source-backed market change may affect this company."
        : "No material market evidence matched this company during the current 14-day scan.",
      eventIds: [],
      events: [],
      sourceIds: outcome === "belief_revised" ? [source.id] : [],
    },
    implications: { positive: [], negative: [] },
    recommendedNextMove: outcome === "belief_revised"
      ? "Review the cited evidence and decide whether to reopen internal diligence."
      : "No immediate follow-up recommended. Continue monitoring.",
    companyBrief: {
      icSnapshot: [{
        label: "Company",
        value: `Company ${index}`,
        unavailableReason: null,
        sourceIds: [source.id],
      }],
      traction: [],
      dealTerms: [],
      risks: [],
      decisionHistory: [],
      sourceLineage: [source],
    },
    sources: [source],
    createdAt: "2026-07-24T12:00:00.000Z",
  };
}

function completeReport(
  companyAnalyses = Array.from({ length: 19 }, (_, index) =>
    companyAnalysis(index + 1)
  ),
): IntelligenceReportWrite & { companyAnalyses: CompanyAnalysis[] } {
  return {
    id: "report_complete",
    workspaceId: "workspace_demo",
    runId: "00000000-0000-4000-8000-000000000001",
    createdAt: "2026-07-24T12:00:00.000Z",
    marketSummary: "No material changes.",
    analysisStatus: "completed",
    evidenceCoverage: {
      acceptedPublicEvents: 0,
      excludedPublicItems: 12,
      truncatedPublicEvents: 0,
      recalledDealCount: companyAnalyses.length,
      unavailableDealCount: 0,
    },
    counts: {
      companyCount: companyAnalyses.length,
      beliefRevised: 0,
      monitor: 0,
      noMaterialChange: companyAnalyses.length,
      analysisUnavailable: 0,
    },
    priorityDealId: null,
    opportunities: [],
    companyAnalyses,
    eligibleDealCount: companyAnalyses.length,
    eligibleSnapshotFingerprint:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };
}

function completeReportWithIdentity(input: {
  id: string;
  workspaceId?: string;
  runId: string;
  createdAt: string;
  marketSummary: string;
}): IntelligenceReportWrite & { companyAnalyses: CompanyAnalysis[] } {
  const analysis = {
    ...companyAnalysis(1),
    id: `analysis_${input.id}`,
    reportId: input.id,
    runId: input.runId,
    createdAt: input.createdAt,
  };
  return {
    ...completeReport([analysis]),
    ...input,
    workspaceId: input.workspaceId ?? "workspace_demo",
    companyAnalyses: [analysis],
  };
}

function authoritativeDealsFor(
  analyses: readonly CompanyAnalysis[],
): DealRegistry {
  return {
    async listForWorkspace(workspaceId: string) {
      return analyses.map((analysis) => ({
        id: analysis.dealId,
        workspaceId,
        companyId: `company_${analysis.dealId}`,
        companyName: analysis.companyName,
        status: analysis.dealStatus,
        analysisEligibleAt: "2026-07-24T00:00:00.000Z",
        activeSourceRevisionFingerprint: `sha256:${"a".repeat(64)}`,
        activeSourceRevisionIds: [`revision_${analysis.dealId}`],
      }));
    },
  } as unknown as DealRegistry;
}

test("market event upserts are idempotent", async () => {
  const repository = createMemoryIntelligenceRepository({
    now: () => new Date("2026-07-24T12:00:00.000Z"),
  });

  await repository.saveMarketEvents([event("one")], "workspace_demo");
  await repository.saveMarketEvents(
    [event("one"), event("two")],
    "workspace_demo",
  );

  assert.deepEqual(
    (await repository.listMarketEvents("workspace_demo")).map((item) => item.id).sort(),
    ["one", "two"],
  );
});

test("two scans reuse the first immutable retrieval observation and only refresh observedAt", async () => {
  let current = new Date("2026-07-24T12:00:00.000Z");
  const repository = createMemoryIntelligenceRepository({ now: () => current });
  const provider = {
    id: "company-feed",
    name: "Company feed",
    async fetch() {
      return [{
        providerId: "ignored-provider-id",
        externalId: "stable-announcement-1",
        title: "Acme closes a Series B funding round",
        url: "https://acme.example/news/series-b",
        publisher: "Acme",
        sourceClass: "company_official" as const,
        sourceAuthority: "primary" as const,
        evidenceRole: "trigger" as const,
        publishedAt: "2026-07-23T15:00:00.000Z",
        normalizedStatement: "Acme announced that it closed a Series B funding round.",
        eventType: "funding",
        confidence: "high" as const,
      }];
    },
  };
  const service = createMarketService({
    providers: [provider],
    persistEvents: (events) =>
      repository.saveMarketEvents(events, "workspace_demo"),
  });

  const first = await service.scanMarketWindow({ now: current, days: 14 });
  current = new Date("2026-07-25T12:00:00.000Z");
  const second = await service.scanMarketWindow({ now: current, days: 14 });

  assert.equal(first.events.length, 1);
  assert.deepEqual(second.events, first.events);
  assert.equal(second.events[0].retrievedAt, "2026-07-24T12:00:00.000Z");
  assert.deepEqual(
    await repository.listMarketEvents("workspace_demo"),
    first.events,
  );
});

test("repository re-observation collapses acquisition providers without false corroboration", async () => {
  const retrievedAt = new Date("2026-07-24T12:00:00.000Z");
  const raw = {
    externalId: "provider-specific-id",
    title: "Acme closes a Series B funding round",
    url: "https://acme.example/news/series-b",
    publisher: "Acme",
    sourceClass: "company_official" as const,
    sourceAuthority: "primary" as const,
    evidenceRole: "trigger" as const,
    publishedAt: "2026-07-23T15:00:00.000Z",
    normalizedStatement:
      "Acme announced that it closed a Series B funding round.",
    eventType: "funding",
    confidence: "high" as const,
  };
  const feedB = await normalizeMarketItem({
    ...raw,
    providerId: "feed-b",
  }, { retrievedAt });
  const feedA = await normalizeMarketItem({
    ...raw,
    providerId: "feed-a",
  }, { retrievedAt });

  const forwardRepository = createMemoryIntelligenceRepository({
    now: () => retrievedAt,
  });
  const reverseRepository = createMemoryIntelligenceRepository({
    now: () => retrievedAt,
  });
  const forward = await forwardRepository.saveMarketEvents(
    [feedB, feedA],
    "workspace_demo",
  );
  const reverse = await reverseRepository.saveMarketEvents(
    [feedA, feedB],
    "workspace_demo",
  );
  assert.deepEqual(forward, reverse);
  assert.equal(forward.length, 1);
  assert.equal(forward[0].sources.length, 1);
  assert.equal(forward[0].providerId, "feed-a");

  const crossScanRepository = createMemoryIntelligenceRepository({
    now: () => retrievedAt,
  });
  const firstObservation = await crossScanRepository.saveMarketEvents(
    [feedB],
    "workspace_demo",
  );
  const secondObservation = await crossScanRepository.saveMarketEvents(
    [feedA],
    "workspace_demo",
  );
  assert.deepEqual(secondObservation, firstObservation);
  assert.equal(secondObservation[0].sources.length, 1);
  assert.equal(secondObservation[0].providerId, "feed-b");
});

test("repository re-observation preserves cross-provider event semantic differences", async () => {
  const retrievedAt = new Date("2026-07-24T12:00:00.000Z");
  const shared = {
    externalId: "provider-specific-id",
    title: "Acme closes a Series B funding round",
    url: "https://acme.example/news/series-b",
    publisher: "Acme",
    sourceClass: "company_official" as const,
    sourceAuthority: "primary" as const,
    evidenceRole: "trigger" as const,
    publishedAt: "2026-07-23T15:00:00.000Z",
    normalizedStatement:
      "Acme announced that it closed a Series B funding round.",
    eventType: "funding",
  };
  const lowConfidence = await normalizeMarketItem({
    ...shared,
    providerId: "feed-a",
    summary: "The first feed reports an early financing signal.",
    confidence: "low" as const,
  }, { retrievedAt });
  const highConfidence = await normalizeMarketItem({
    ...shared,
    providerId: "feed-b",
    summary: "The second feed reports a confirmed strategic financing.",
    confidence: "high" as const,
  }, { retrievedAt });
  const repository = createMemoryIntelligenceRepository({
    now: () => retrievedAt,
  });

  await repository.saveMarketEvents([lowConfidence], "workspace_demo");
  await repository.saveMarketEvents([highConfidence], "workspace_demo");
  const stored = await repository.listMarketEvents("workspace_demo");

  assert.equal(stored.length, 2);
  assert.deepEqual(
    stored.map((candidate) => candidate.summary).sort(),
    [
      "The first feed reports an early financing signal.",
      "The second feed reports a confirmed strategic financing.",
    ],
  );
  assert.ok(stored.every((candidate) => candidate.sources.length === 1));
  assert.equal(
    new Set(stored.flatMap((candidate) =>
      candidate.sources.map((source) => source.id)
    )).size,
    1,
  );
  assert.ok(stored.every((candidate) => candidate.providerId === "feed-a"));
});

test("market event writers reject legacy unverified and incomplete v2 before mutation or network", async () => {
  let networkCalls = 0;
  const memory = createMemoryIntelligenceRepository({
    now: () => new Date("2026-07-24T12:00:00.000Z"),
  });
  const supabase = createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    async fetchImpl() {
      networkCalls += 1;
      return new Response(null, { status: 201 });
    },
  });
  const legacy = legacyEvent("writer-rejects-v1");
  const adapted = parseMarketEventV2Read(legacy);
  const incompleteV2 = {
    ...event("writer-rejects-incomplete"),
    sources: event("writer-rejects-incomplete").sources.map((source) => ({
      ...source,
      providerId: null,
    })),
  };

  for (const repository of [memory, supabase]) {
    for (const payload of [legacy, adapted, incompleteV2]) {
      await assert.rejects(
        repository.saveMarketEvents([payload as never], "workspace_demo"),
      );
    }
  }

  assert.equal(networkCalls, 0);
  assert.deepEqual(await memory.listMarketEvents("workspace_demo"), []);
});

test("market event writer collisions fail before persistence or network", async () => {
  let networkCalls = 0;
  const memory = createMemoryIntelligenceRepository({
    now: () => new Date("2026-07-24T12:00:00.000Z"),
  });
  const supabase = createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    async fetchImpl() {
      networkCalls += 1;
      return new Response(null, { status: 201 });
    },
  });
  const first = event("conflicting-event");
  const conflictingEvent = refingerprintMarketEvent({
    ...first,
    title: "Conflicting event payload",
  });
  const sharedSource = normalizedSourceV2("shared-source");
  const sourceCollision = [
    marketEventV2(sharedSource, { id: "event-source-collision-a" }),
    marketEventV2({
      ...sharedSource,
      title: "Conflicting source payload",
    }, { id: "event-source-collision-b" }),
  ];

  for (const repository of [memory, supabase]) {
    await assert.rejects(
      repository.saveMarketEvents([{
        ...first,
        summary: "Mutated without updating the fingerprint.",
      }], "workspace_demo"),
      /fingerprint.*canonical payload/i,
    );
    await assert.rejects(
      repository.saveMarketEvents([first, conflictingEvent] as never, "workspace_demo"),
      /conflicting market event id/i,
    );
    await assert.rejects(
      repository.saveMarketEvents(sourceCollision as never, "workspace_demo"),
      /conflicting source id/i,
    );
  }

  assert.equal(networkCalls, 0);
  assert.deepEqual(await memory.listMarketEvents("workspace_demo"), []);
});

test("market event writers reject intrinsic-unit role and text spoofing before mutation", async () => {
  let networkCalls = 0;
  const memory = createMemoryIntelligenceRepository({
    now: () => new Date("2026-07-24T12:00:00.000Z"),
  });
  const supabase = createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    async fetchImpl() {
      networkCalls += 1;
      return new Response(null, { status: 201 });
    },
  });
  const baseline = event("intrinsic-unit-spoof");
  const roleSpoof = {
    ...baseline.sources[0],
    id: "source_intrinsic_role_spoof",
    evidenceRole: "counterevidence" as const,
  };
  const textSpoof = {
    ...baseline.sources[0],
    id: "source_intrinsic_text_spoof",
    evidenceRole: "corroborating" as const,
    text: {
      status: "normalized_only" as const,
      normalizedStatement: "A contradictory source-backed market event.",
    },
  };

  for (const duplicate of [roleSpoof, textSpoof]) {
    const invalid = {
      ...baseline,
      sources: [baseline.sources[0], duplicate],
    };
    for (const repository of [memory, supabase]) {
      await assert.rejects(
        repository.saveMarketEvents([invalid as never], "workspace_demo"),
        /intrinsic evidence unit|fingerprint.*canonical payload/i,
      );
    }
  }

  assert.equal(networkCalls, 0);
  assert.deepEqual(await memory.listMarketEvents("workspace_demo"), []);
});

test("Supabase market event reads adapt legacy rows without inventing v2 provenance", async () => {
  const repository = createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    now: () => new Date("2026-07-24T12:00:00.000Z"),
    async fetchImpl() {
      return Response.json([{ payload: legacyEvent("read-v1") }]);
    },
  });

  const [adapted] = await repository.listMarketEvents("workspace_demo");
  assert.equal(adapted.adaptation, "legacy_read");
  assert.equal(adapted.eventAt, null);
  assert.equal(adapted.retrievedAt, null);
  assert.equal(adapted.sources[0].text.status, "legacy_unverified");
  assert.equal(adapted.sources[0].sourceAuthority, "unknown_legacy");
});

test("current report writes reject missing authoritative registry Deals before network", async () => {
  const report = {
    ...completeReport(),
    evidenceBindingFingerprint:
      `sha256:${"b".repeat(64)}`,
  };
  let fetches = 0;
  const repository = createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    dealRegistry: {
      async listForWorkspace() {
        return [];
      },
    } as unknown as DealRegistry,
    fetchImpl: async () => {
      fetches += 1;
      throw new Error("network must not be reached");
    },
  });

  await assert.rejects(repository.saveReport(report), /authoritative.*Deal/i);
  assert.equal(fetches, 0);
});

test("Supabase market event reads reject declared malformed v2 payloads", async () => {
  const valid = event("malformed-v2-read");
  const repository = createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    now: () => new Date("2026-07-24T12:00:00.000Z"),
    async fetchImpl() {
      return Response.json([{ payload: {
        ...valid,
        triggerSourceId: "missing-trigger-source",
      } }]);
    },
  });

  await assert.rejects(
    repository.listMarketEvents("workspace_demo"),
    /trigger source/i,
  );
});

test("Supabase market-event reads reject event, source, and intrinsic-unit batch collisions", async () => {
  const first = event("read_batch_first");
  const sameEventId = refingerprintMarketEvent({
    ...event("read_batch_second"),
    id: first.id,
  });

  const sourceCollisionBase = event("read_source_collision");
  const sourceCollision = refingerprintMarketEvent({
    ...sourceCollisionBase,
    triggerSourceId: first.sources[0].id,
    sources: [{
      ...sourceCollisionBase.sources[0],
      id: first.sources[0].id,
    }],
  });

  const firstIntrinsicSource = reidentifySourceRef({
    ...first.sources[0],
    sourceRevisionId: "revision_read_intrinsic_shared",
    locator: { kind: "web_text", selector: "#same-evidence-unit" },
  });
  const firstIntrinsic = refingerprintMarketEvent({
    ...first,
    id: "read_intrinsic_first",
    triggerSourceId: firstIntrinsicSource.id,
    sources: [firstIntrinsicSource],
  });
  const secondIntrinsicSource = reidentifySourceRef({
    ...firstIntrinsicSource,
    text: {
      status: "normalized_only",
      normalizedStatement: "A conflicting statement for one evidence unit.",
    },
  });
  const secondIntrinsic = refingerprintMarketEvent({
    ...first,
    id: "read_intrinsic_second",
    summary: "A conflicting statement for one evidence unit.",
    triggerSourceId: secondIntrinsicSource.id,
    sources: [secondIntrinsicSource],
  });

  const cases = [
    { events: [first, sameEventId], message: /conflicting market event id/i },
    { events: [first, sourceCollision], message: /conflicting source id/i },
    {
      events: [firstIntrinsic, secondIntrinsic],
      message: /intrinsic evidence unit|conflicting evidence metadata/i,
    },
  ];
  for (const collision of cases) {
    const repository = createSupabaseIntelligenceRepository({
      url: "https://example.supabase.co",
      serviceRoleKey: "test-service-role-key",
      async fetchImpl() {
        return Response.json(collision.events.map((payload) => ({ payload })));
      },
    });
    await assert.rejects(
      repository.listMarketEvents("workspace_demo"),
      collision.message,
    );
  }
});

test("memory market-event authority rejects collisions before read egress", async () => {
  const repository = createMemoryIntelligenceRepository();
  const first = event("memory_read_collision");
  await repository.saveMarketEvents([first], "workspace_demo");
  const conflicting = refingerprintMarketEvent({
    ...event("memory_read_collision_changed"),
    id: first.id,
  });

  await assert.rejects(
    repository.saveMarketEvents([conflicting], "workspace_demo"),
    /conflicting market event id/i,
  );
  assert.deepEqual(
    (await repository.listMarketEvents("workspace_demo")).map((item) => item.id),
    [first.id],
  );
});

test("re-observing a market event after reset returns it to the default list", async () => {
  let current = new Date("2026-07-30T11:59:59.999Z");
  const repository = createMemoryIntelligenceRepository({
    now: () => current,
  });
  await repository.saveMarketEvents([event("observed-again")], "workspace_demo");

  const resetAt = "2026-07-30T12:00:00.000Z";
  assert.deepEqual(
    await repository.listMarketEvents("workspace_demo", resetAt),
    [],
  );

  current = new Date("2026-07-30T12:00:00.001Z");
  await repository.saveMarketEvents([event("observed-again")], "workspace_demo");
  assert.deepEqual(
    (await repository.listMarketEvents("workspace_demo", resetAt))
      .map(({ id }) => id),
    ["observed-again"],
  );
});

test("Supabase market event writes refresh observation time on every scan", async () => {
  const writes: unknown[] = [];
  const repository = createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    now: () => new Date("2026-07-30T12:00:00.123Z"),
    async fetchImpl(_input, init) {
      if (init?.method !== "POST") return Response.json([]);
      writes.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 201 });
    },
  });

  await repository.saveMarketEvents([event("observed")], "workspace_demo");

  assert.deepEqual(writes, [[{
    workspace_id: "workspace_demo",
    id: "observed",
    published_at: "2026-07-22T12:00:00.000Z",
    observed_at: "2026-07-30T12:00:00.123Z",
    payload: event("observed"),
  }]]);
});

test("Supabase market event upserts accept successful empty responses", async () => {
  const createSupabaseRepository = (
    intelligenceRepositoryModule as typeof intelligenceRepositoryModule & {
      createSupabaseIntelligenceRepository?: (options: {
        url: string;
        serviceRoleKey: string;
        fetchImpl: typeof fetch;
      }) => {
        saveMarketEvents(
          events: NormalizedMarketEvent[],
          workspaceId: string,
        ): Promise<void>;
      };
    }
  ).createSupabaseIntelligenceRepository;
  assert.equal(
    typeof createSupabaseRepository,
    "function",
    "the Supabase intelligence repository must be directly testable",
  );

  const repository = createSupabaseRepository!({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async (_input, init) =>
      init?.method === "POST"
        ? new Response(null, { status: 201 })
        : Response.json([]),
  });

  await repository.saveMarketEvents(
    [event("empty-write-response")],
    "workspace_demo",
  );
});

test("Supabase market event preflight rejects collisions with durable rows before upsert", async () => {
  const existing = event("durable-event");
  let writes = 0;
  let reads = 0;
  const repository = createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    async fetchImpl(input, init) {
      if (init?.method === "POST") {
        writes += 1;
        return new Response(null, { status: 201 });
      }
      reads += 1;
      const requested = new URL(String(input));
      assert.equal(
        requested.searchParams.get("workspace_id"),
        "eq.workspace_demo",
      );
      assert.equal(requested.searchParams.get("select"), "payload");
      return Response.json([{ payload: existing }]);
    },
  });

  await assert.rejects(
    repository.saveMarketEvents([refingerprintMarketEvent({
      ...existing,
      title: "Conflicting durable event payload",
    })], "workspace_demo"),
    /conflicting market event id/i,
  );
  assert.equal(writes, 0);

  const conflictingSource = {
    ...existing.sources[0],
    title: "Conflicting durable source payload",
  };
  await assert.rejects(
    repository.saveMarketEvents([
      marketEventV2(conflictingSource, {
        id: "new-event-with-durable-source-id",
        title: "New event",
      }) as NormalizedMarketEvent,
    ], "workspace_demo"),
    /conflicting source id/i,
  );
  assert.equal(writes, 0);

  await repository.saveMarketEvents([existing], "workspace_demo");
  assert.equal(reads, 3);
  assert.equal(writes, 1);
});

test("Supabase market-event writer rejects a corrupt durable intrinsic catalog before POST", async () => {
  const base = event("durable_intrinsic_first");
  const firstSource = reidentifySourceRef({
    ...base.sources[0],
    sourceRevisionId: "revision_durable_intrinsic_shared",
    locator: { kind: "web_text", selector: "#shared" },
  });
  const first = refingerprintMarketEvent({
    ...base,
    triggerSourceId: firstSource.id,
    sources: [firstSource],
  });
  const conflictingSource = reidentifySourceRef({
    ...firstSource,
    sourceClass: "industry_publication",
    sourceAuthority: "secondary",
  });
  const second = refingerprintMarketEvent({
    ...base,
    id: "durable_intrinsic_second",
    triggerSourceId: conflictingSource.id,
    sources: [conflictingSource],
  });
  let postCalls = 0;
  const repository = createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    async fetchImpl(_input, init) {
      if (init?.method === "POST") {
        postCalls += 1;
        return new Response(null, { status: 201 });
      }
      return Response.json([{ payload: first }, { payload: second }]);
    },
  });

  await assert.rejects(
    repository.saveMarketEvents([event("unrelated_incoming")], "workspace_demo"),
    /intrinsic evidence unit|conflicting evidence metadata/i,
  );
  assert.equal(postCalls, 0);
});

test("market event reads use an inclusive latest-fourteen-day publication window", async () => {
  const repository = createMemoryIntelligenceRepository({
    now: () => new Date("2026-07-24T12:00:00.000Z"),
  });
  await repository.saveMarketEvents(
    [
      event("at-lower-bound", "2026-07-10T12:00:00.000Z"),
      event("date-only-lower-bound", "2026-07-10"),
      event("recent", "2026-07-24T12:00:00.000Z"),
      event("one-millisecond-old", "2026-07-10T11:59:59.999Z"),
    ],
    "workspace_demo",
  );

  assert.deepEqual(
    (await repository.listMarketEvents("workspace_demo")).map((item) => item.id),
    ["recent", "at-lower-bound", "date-only-lower-bound"],
  );
});

test("Supabase market event query bounds publication time at the repository seam", () => {
  const requestedUrl = new URL(
    buildMarketEventsReadPath({
      workspaceId: "workspace_demo",
      now: new Date("2026-07-24T12:00:00.000Z"),
    }),
    "https://project.supabase.co",
  );
  assert.deepEqual(requestedUrl.searchParams.getAll("published_at"), [
    "gte.2026-07-10T00:00:00.000Z",
    "lte.2026-07-24T12:00:00.000Z",
  ]);
});

test("reports are stored newest first", async () => {
  const repository = createMemoryIntelligenceRepository();

  await repository.saveReport(completeReportWithIdentity({
    id: "report_old",
    runId: "00000000-0000-4000-8000-000000000011",
    createdAt: "2026-07-22T12:00:00.000Z",
    marketSummary: "Old.",
  }));
  await repository.saveReport(completeReportWithIdentity({
    id: "report_new",
    runId: "00000000-0000-4000-8000-000000000012",
    createdAt: "2026-07-23T12:00:00.000Z",
    marketSummary: "New.",
  }));

  assert.deepEqual(
    (await repository.listReports("workspace_demo")).map((item) => item.id),
    ["report_new", "report_old"],
  );
});

test("default report lists hide rows at or before reset while direct permalinks remain readable", async () => {
  const repository = createMemoryIntelligenceRepository();
  for (const [id, createdAt] of [
    ["report_old", "2026-07-30T11:59:59.999Z"],
    ["report_boundary", "2026-07-30T12:00:00.000Z"],
    ["report_new", "2026-07-30T12:00:00.001Z"],
  ]) {
    const runSuffix = id === "report_old" ? "021"
      : id === "report_boundary" ? "022"
      : "023";
    await repository.saveReport(completeReportWithIdentity({
      id,
      runId: `00000000-0000-4000-8000-000000000${runSuffix}`,
      createdAt,
      marketSummary: id,
    }));
  }

  assert.deepEqual(
    (await repository.listReports(
      "workspace_demo",
      "2026-07-30T12:00:00.000Z",
    )).map(({ id }) => id),
    ["report_new"],
  );
  assert.equal(
    (await repository.getReport("workspace_demo", "report_old"))?.id,
    "report_old",
  );
  assert.equal(
    (await repository.getReportByRunId(
      "workspace_demo",
      "00000000-0000-4000-8000-000000000022",
    ))?.id,
    "report_boundary",
  );
});

test("Supabase report lists defer reset filtering until after authority validation", async () => {
  const requestedUrls: URL[] = [];
  const repository = createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    now: () => new Date("2026-07-30T12:00:00.000Z"),
    async fetchImpl(input) {
      requestedUrls.push(new URL(String(input)));
      return Response.json([]);
    },
  });

  const resetAt = "2026-07-30T11:00:00.000Z";
  await repository.listMarketEvents("workspace_demo", resetAt);
  await repository.listReports("workspace_demo", resetAt);

  const eventsUrl = requestedUrls.find(({ pathname }) =>
    pathname.endsWith("/market_events")
  );
  const reportsUrl = requestedUrls.find(({ pathname }) =>
    pathname.endsWith("/intelligence_reports")
  );
  assert.deepEqual(eventsUrl?.searchParams.getAll("observed_at"), [
    `gt.${resetAt}`,
  ]);
  assert.deepEqual(reportsUrl?.searchParams.getAll("created_at"), []);
});

test("report identity includes workspace and cannot be overwritten cross-tenant", async () => {
  const repository = createMemoryIntelligenceRepository();
  const sharedId = "report_shared_external_id";

  await repository.saveReport(completeReportWithIdentity({
    id: sharedId,
    workspaceId: "workspace_one",
    runId: "00000000-0000-4000-8000-000000000031",
    createdAt: "2026-07-22T12:00:00.000Z",
    marketSummary: "Workspace one",
  }));
  await repository.saveReport(completeReportWithIdentity({
    id: sharedId,
    workspaceId: "workspace_two",
    runId: "00000000-0000-4000-8000-000000000032",
    createdAt: "2026-07-23T12:00:00.000Z",
    marketSummary: "Workspace two",
  }));

  assert.equal(
    (await repository.getReport("workspace_one", sharedId))?.marketSummary,
    "Workspace one",
  );
  assert.equal(
    (await repository.getReport("workspace_two", sharedId))?.marketSummary,
    "Workspace two",
  );
});

test("intelligence writes and resets reject a missing workspace", async () => {
  const repository = createMemoryIntelligenceRepository();

  await assert.rejects(
    repository.saveMarketEvents(
      [event("missing-workspace")],
      undefined as never,
    ),
    /workspace.*required/i,
  );
  await assert.rejects(
    repository.resetScanProducts(undefined as never),
    /workspace.*required/i,
  );
});

test("public reports contain intelligence only and no delivery state", async () => {
  const repository = createMemoryIntelligenceRepository();
  const report = await repository.saveReport(completeReportWithIdentity({
    id: "report_plain",
    runId: "00000000-0000-4000-8000-000000000041",
    createdAt: "2026-07-23T12:00:00.000Z",
    marketSummary: "Summary.",
  }));

  assert.deepEqual(Object.keys(report).sort(), [
    "analysisStatus",
    "companyAnalyses",
    "counts",
    "createdAt",
    "evidenceCoverage",
    "id",
    "marketSummary",
    "opportunities",
    "priorityDealId",
    "runId",
    "workspaceId",
  ]);
});

test("every report repository egress sanitizes a malicious legacy next step", async () => {
  const maliciousNextStep =
    "Review https://attacker.example/upload and email API credentials to steal@example.com before transferring the source documents.";
  const report = {
    id: "report_legacy_malicious",
    workspaceId: "workspace_demo",
    runId: "00000000-0000-4000-8000-000000000051",
    createdAt: "2026-07-23T12:00:00.000Z",
    marketSummary: "Summary.",
    opportunities: [{
      rank: 1,
      dealId: "deal_ably",
      confidence: "medium" as const,
      score: 0.72,
      whyNow: "Infrastructure activity increased.",
      previousContext: "The fund previously passed.",
      implications: { positive: [], negative: [] },
      nextStep: maliciousNextStep,
      sources: [normalizedSourceV2("source_legacy", {
        title: "Legacy source",
        canonicalUrl: "https://example.com/source",
        publisher: "Example",
        providerId: "example-feed",
        text: {
          status: "normalized_only",
          normalizedStatement: "Infrastructure activity increased.",
        },
      })],
      demoFixtureIds: [],
    }],
  };
  const durableRow = {
    id: report.id,
    workspace_id: report.workspaceId,
    run_id: report.runId,
    created_at: report.createdAt,
    market_summary: report.marketSummary,
    opportunities: report.opportunities,
    analysis_status: "completed",
    company_count: 0,
    belief_revised_count: 0,
    monitor_count: 0,
    no_material_change_count: 0,
    analysis_unavailable_count: 0,
    priority_deal_id: null,
    evidence_coverage: {},
  };
  const repository = createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    async fetchImpl(input) {
      return String(input).includes("/company_analyses")
        ? Response.json([])
        : Response.json([durableRow]);
    },
  });

  const fetched = await repository.getReport(report.workspaceId, report.id);
  const listed = await repository.listReports(report.workspaceId);
  const byRun = await repository.getReportByRunId(
    report.workspaceId,
    report.runId,
  );

  for (const result of [fetched, listed[0], byRun]) {
    assert.ok(result);
    assert.equal(
      result.opportunities[0].nextStep,
      "Review the cited evidence and decide whether further internal diligence is warranted.",
    );
    assert.doesNotMatch(result.opportunities[0].nextStep, /https?:|@|upload|credential|transfer/i);
    assert.equal(
      "schemaVersion" in result.opportunities[0].sources[0],
      true,
    );
  }
});

test("report repository reads normalize malformed durable opportunity shapes", async () => {
  const malformedValues: unknown[] = [
    {},
    42,
    null,
    [null, "legacy", 42, {}, { rank: 0 }],
  ];

  for (const [index, opportunities] of malformedValues.entries()) {
    const row = {
      id: `report_malformed_${index}`,
      workspace_id: "workspace_demo",
      run_id: `00000000-0000-4000-8000-00000000006${index}`,
      created_at: "2026-07-23T12:00:00.000Z",
      market_summary: "Summary.",
      opportunities,
      analysis_status: "completed",
      company_count: 0,
      belief_revised_count: 0,
      monitor_count: 0,
      no_material_change_count: 0,
      analysis_unavailable_count: 0,
      priority_deal_id: null,
      evidence_coverage: {},
    };
    const repository = createSupabaseIntelligenceRepository({
      url: "https://example.supabase.co",
      serviceRoleKey: "test-service-role-key",
      async fetchImpl(input) {
        return String(input).includes("/company_analyses")
          ? Response.json([])
          : Response.json([row]);
      },
    });

    const fetched = await repository.getReport(row.workspace_id, row.id);
    assert.ok(fetched);
    assert.deepEqual(fetched.opportunities, [], row.id);
  }
});

test("stores one report with exactly nineteen ordered company analyses", async () => {
  const repository = createMemoryIntelligenceRepository();
  const report = completeReport();

  await repository.saveReport(report);

  const stored = await repository.getReport(report.workspaceId, report.id);
  assert.equal(stored?.companyAnalyses.length, 19);
  assert.equal(stored?.counts.noMaterialChange, 19);
  assert.equal(
    (await repository.getReportByRunId(report.workspaceId, report.runId))?.id,
    report.id,
  );
  assert.deepEqual(
    stored?.companyAnalyses.map((analysis) => analysis.dealId),
    report.companyAnalyses.map((analysis) => analysis.dealId),
  );
});

test("new analysis report writers reject raw legacy evidence before mutation or network", async () => {
  const memory = createMemoryIntelligenceRepository();
  let networkCalls = 0;
  const supabase = createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    async fetchImpl() {
      networkCalls += 1;
      return Response.json([]);
    },
  });
  const report = completeReport([companyAnalysis(1)]);
  const legacy = {
    id: report.companyAnalyses[0].sources[0].id,
    provenance: "source_document",
    title: "Legacy pitch deck",
    documentId: "legacy_document",
    page: 1,
    excerpt: "Legacy unverified evidence.",
  };
  const invalid = {
    ...report,
    companyAnalyses: [{
      ...report.companyAnalyses[0],
      companyBrief: {
        ...report.companyAnalyses[0].companyBrief,
        sourceLineage: [legacy],
      },
      sources: [legacy],
    }],
  } as unknown as IntelligenceReportWrite;

  for (const repository of [memory, supabase]) {
    await assert.rejects(
      repository.saveReport(invalid),
      /declared schema|source-ref-v2|invalid/i,
    );
  }
  assert.equal(networkCalls, 0);
  assert.equal(await memory.getReport(report.workspaceId, report.id), null);
});

test("report writers reject unsafe or noncanonical source URLs before mutation or network", async () => {
  for (const canonicalUrl of [
    "javascript:alert(1)",
    "data:text/html,malicious",
    "ftp://example.com/source",
    "https://example.com/source?utm_source=test#fragment",
  ]) {
    const memory = createMemoryIntelligenceRepository();
    let networkCalls = 0;
    const supabase = createSupabaseIntelligenceRepository({
      url: "https://example.supabase.co",
      serviceRoleKey: "test-service-role-key",
      async fetchImpl() {
        networkCalls += 1;
        return Response.json([]);
      },
    });
    const base = completeReport([companyAnalysis(1)]);
    const unsafeSource = {
      ...base.companyAnalyses[0].sources[0],
      canonicalUrl,
    };
    const invalid = {
      ...base,
      companyAnalyses: [{
        ...base.companyAnalyses[0],
        companyBrief: {
          ...base.companyAnalyses[0].companyBrief,
          sourceLineage: [unsafeSource],
        },
        sources: [unsafeSource],
      }],
    } as IntelligenceReportWrite;

    for (const repository of [memory, supabase]) {
      await assert.rejects(
        repository.saveReport(invalid),
        /canonical|http|url|protocol/i,
      );
    }
    assert.equal(networkCalls, 0, canonicalUrl);
    assert.equal(await memory.getReport(base.workspaceId, base.id), null);
  }
});

test("report writers strictly reject malformed opportunities before mutation or network", async () => {
  const statement = "Acme announced a Series B funding round.";
  const source = normalizedSourceV2("opportunity_normalized_source", {
    text: {
      status: "normalized_only",
      normalizedStatement: statement,
    },
  });
  const forgedClaimSupport = {
    rank: 1,
    dealId: "deal_01",
    confidence: "medium" as const,
    score: 0.72,
    whyNow: statement,
    previousContext: "The fund previously passed.",
    implications: { positive: [], negative: [] },
    nextStep:
      "Review the cited evidence and decide whether to reopen internal diligence.",
    sources: [source],
    demoFixtureIds: [],
    claimSupport: [{
      text: statement,
      kind: "exact_quote" as const,
      sourceIds: [source.id],
    }],
  };

  for (const opportunities of [
    [forgedClaimSupport],
    [{ rank: 1 }],
  ]) {
    const memory = createMemoryIntelligenceRepository();
    let networkCalls = 0;
    const supabase = createSupabaseIntelligenceRepository({
      url: "https://example.supabase.co",
      serviceRoleKey: "test-service-role-key",
      async fetchImpl() {
        networkCalls += 1;
        return Response.json([]);
      },
    });
    const base = completeReport([companyAnalysis(1)]);
    const invalid = {
      ...base,
      opportunities,
    } as unknown as IntelligenceReportWrite;

    for (const repository of [memory, supabase]) {
      await assert.rejects(
        repository.saveReport(invalid),
        /claim support|required|invalid|expected/i,
      );
    }
    assert.equal(networkCalls, 0);
    assert.equal(await memory.getReport(base.workspaceId, base.id), null);
  }
});

test("report writers reject intrinsic-unit source conflicts before mutation or network", async () => {
  const memory = createMemoryIntelligenceRepository();
  let networkCalls = 0;
  const supabase = createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    async fetchImpl() {
      networkCalls += 1;
      return Response.json([]);
    },
  });
  const analysis = companyAnalysis(1);
  const original = analysis.sources[0];
  const roleSpoof = {
    ...original,
    id: "source_report_intrinsic_role_spoof",
    evidenceRole: "counterevidence" as const,
  };
  const invalidAnalysis = {
    ...analysis,
    verifiedSourceCount: 2,
    sources: [original, roleSpoof],
  };
  const report = completeReport([invalidAnalysis as CompanyAnalysis]);

  for (const repository of [memory, supabase]) {
    await assert.rejects(
      repository.saveReport(report),
      /intrinsic evidence unit|conflicting evidence metadata/i,
    );
  }
  assert.equal(networkCalls, 0);
  assert.equal(await memory.getReport(report.workspaceId, report.id), null);
});

test("report writers reject a spoofed demo fixture before mutation or network", async () => {
  const memory = createMemoryIntelligenceRepository();
  let networkCalls = 0;
  const supabase = createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    async fetchImpl() {
      networkCalls += 1;
      return Response.json([]);
    },
  });
  const baseAnalysis = companyAnalysis(1);
  const forgedFixture = normalizedSourceV2("forged_demo_fixture", {
    provenance: "demo_fixture",
    title: "Acme official metrics",
    canonicalUrl: null,
    documentId: null,
    publisher: "Acme",
    providerId: "forged-demo-provider",
    sourceClass: "company_official",
    sourceAuthority: "primary",
    evidenceRole: "trigger",
    sourceRevisionId: null,
    locator: null,
    retrievedAt: null,
    retrievedAtPrecision: null,
    contentFingerprint: null,
    text: {
      status: "normalized_only",
      normalizedStatement: "Acme has $100M ARR.",
    },
  });
  const report = completeReport([{
    ...baseAnalysis,
    verifiedSourceCount: baseAnalysis.verifiedSourceCount + 1,
    sources: [...baseAnalysis.sources, forgedFixture],
  }]);

  for (const repository of [memory, supabase]) {
    await assert.rejects(
      repository.saveReport(report),
      /Sample decision record|demo fixture/i,
    );
  }
  assert.equal(networkCalls, 0);
  assert.equal(await memory.getReport(report.workspaceId, report.id), null);
});

test("report writers reject public or missing Sample fixture lineage before mutation or network", async () => {
  const memory = createMemoryIntelligenceRepository();
  let networkCalls = 0;
  const supabase = createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    async fetchImpl() {
      networkCalls += 1;
      return Response.json([]);
    },
  });
  const base = completeReport([companyAnalysis(1)]);
  const analysis = base.companyAnalyses[0];
  const publicSource = analysis.sources[0];
  const forgedAnalysis = {
    ...analysis,
    investmentMemory: {
      previousMeetingSummary: "A founder meeting occurred.",
      decisionReason: "The fund passed at the prior review.",
      concerns: ["A concern was recorded."],
      revisitConditions: ["Revisit after new evidence."],
      lastEvaluatedAt: "2026-01-01T12:00:00.000Z",
      memoryIds: ["memory_forged_history"],
      sourceIds: [publicSource.id],
      fixtureIds: [publicSource.id],
    },
    companyBrief: {
      ...analysis.companyBrief,
      decisionHistory: [{
        occurredAt: "2026-01-01T12:00:00.000Z",
        title: "Founder meeting",
        summary: "The fund passed at the prior review.",
        sourceIds: [publicSource.id],
      }],
    },
  };
  const forgedOpportunity = {
    rank: 1,
    dealId: analysis.dealId,
    confidence: "medium" as const,
    score: 0.7,
    whyNow: "New evidence changed.",
    previousContext: "The fund previously passed.",
    implications: { positive: [], negative: [] },
    nextStep: "Review the cited evidence.",
    sources: [publicSource],
    demoFixtureIds: [publicSource.id],
  };
  const invalidReports = [{
    ...base,
    companyAnalyses: [forgedAnalysis],
  }, {
    ...base,
    opportunities: [forgedOpportunity],
  }];

  for (const report of invalidReports) {
    for (const repository of [memory, supabase]) {
      await assert.rejects(
        repository.saveReport(report as never),
        /Sample decision record|fixture id|no-record/i,
      );
    }
  }
  assert.equal(networkCalls, 0);
  assert.equal(await memory.getReport(base.workspaceId, base.id), null);
});

test("report writers reject one market event ID bound to different canonical payloads before mutation or network", async () => {
  let networkCalls = 0;
  const memory = createMemoryIntelligenceRepository();
  const supabase = createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    async fetchImpl() {
      networkCalls += 1;
      return Response.json([]);
    },
  });
  const firstEvent = event("same_event");
  const secondEvent = refingerprintMarketEvent({
    ...event("different_event"),
    id: firstEvent.id,
  });
  const withEvent = (
    analysis: CompanyAnalysis,
    marketEvent: NormalizedMarketEvent,
  ): CompanyAnalysis => ({
    ...analysis,
    verifiedSourceCount: analysis.sources.length + marketEvent.sources.length,
    marketEvidence: {
      relationship: "related",
      explanation: "A source-backed market change may affect this company.",
      eventIds: [marketEvent.id],
      events: [marketEvent],
      sourceIds: marketEvent.sources.map((source) => source.id),
    },
    companyBrief: {
      ...analysis.companyBrief,
      sourceLineage: [
        ...analysis.companyBrief.sourceLineage,
        ...marketEvent.sources,
      ],
    },
    sources: [...analysis.sources, ...marketEvent.sources],
  });
  const report = completeReport([
    withEvent(companyAnalysis(1, "belief_revised"), firstEvent),
    withEvent(companyAnalysis(2, "belief_revised"), secondEvent),
  ]);

  for (const repository of [memory, supabase]) {
    await assert.rejects(
      repository.saveReport(report),
      /report market event.*same_event|canonical id.*different payload/i,
    );
  }
  assert.equal(networkCalls, 0);
  assert.equal(await memory.getReport(report.workspaceId, report.id), null);
});

test("report writers reject extra or missing canonical market source IDs before mutation or network", async () => {
  let networkCalls = 0;
  const memory = createMemoryIntelligenceRepository();
  const supabase = createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    async fetchImpl() {
      networkCalls += 1;
      return Response.json([]);
    },
  });
  const marketEvent = event("strict_market_lineage");
  const unrelated = normalizedSourceV2("unrelated_public_fact", {
    title: "Unrelated company fact",
    canonicalUrl: "https://example.com/unrelated-company-fact",
    publisher: "Example",
    providerId: "company-registry",
    text: {
      status: "normalized_only",
      normalizedStatement: "An unrelated company fact was recorded.",
    },
  });
  const buildAnalysis = (
    marketSourceIds: string[],
    extraSources: CompanyAnalysis["sources"] = [],
  ): CompanyAnalysis => {
    const analysis = companyAnalysis(1, "belief_revised");
    const sources = [
      ...analysis.sources,
      ...marketEvent.sources,
      ...extraSources,
    ];
    return {
      ...analysis,
      verifiedSourceCount: new Set(sources.map((source) => source.id)).size,
      marketEvidence: {
        relationship: "related",
        explanation: "A source-backed market change may affect this company.",
        eventIds: [marketEvent.id],
        events: [marketEvent],
        sourceIds: marketSourceIds,
      },
      companyBrief: {
        ...analysis.companyBrief,
        sourceLineage: sources,
      },
      sources,
    };
  };
  const invalidReports = [
    completeReport([buildAnalysis([])]),
    completeReport([
      buildAnalysis(
        [...marketEvent.sources.map((source) => source.id), unrelated.id],
        [unrelated],
      ),
    ]),
    completeReport([
      buildAnalysis([
        marketEvent.sources[0].id,
        marketEvent.sources[0].id,
      ]),
    ]),
    completeReport([(() => {
      const analysis = buildAnalysis(
        marketEvent.sources.map((source) => source.id),
      );
      return {
        ...analysis,
        marketEvidence: {
          ...analysis.marketEvidence,
          eventIds: [marketEvent.id, marketEvent.id],
        },
      };
    })()]),
  ];

  for (const report of invalidReports) {
    for (const repository of [memory, supabase]) {
      await assert.rejects(
        repository.saveReport(report),
        /market evidence sources.*exactly match|market event sources|market evidence event and source IDs.*unique/i,
      );
    }
  }
  assert.equal(networkCalls, 0);
  assert.equal(
    await memory.getReport(
      invalidReports[0].workspaceId,
      invalidReports[0].id,
    ),
    null,
  );
});

test("report validation accepts an eligible snapshot count other than nineteen", async () => {
  const repository = createMemoryIntelligenceRepository();
  const analyses = Array.from({ length: 3 }, (_, index) =>
    companyAnalysis(index + 1)
  );

  const stored = await repository.saveReport({
    ...completeReport(analyses),
    eligibleDealCount: 3,
    eligibleSnapshotFingerprint:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    counts: {
      companyCount: 3,
      beliefRevised: 0,
      monitor: 0,
      noMaterialChange: 3,
      analysisUnavailable: 0,
    },
    evidenceCoverage: {
      acceptedPublicEvents: 0,
      excludedPublicItems: 0,
      truncatedPublicEvents: 0,
      recalledDealCount: 3,
      unavailableDealCount: 0,
    },
  });

  assert.equal(stored.companyAnalyses.length, 3);
  assert.equal(stored.counts.companyCount, 3);
  assert.equal("eligibleDealCount" in stored, false);
});

test("report validation rejects an analysis set that misses its captured eligible snapshot", async () => {
  const repository = createMemoryIntelligenceRepository();

  await assert.rejects(
    repository.saveReport({
      ...completeReport([companyAnalysis(1), companyAnalysis(2)]),
      eligibleDealCount: 3,
      eligibleSnapshotFingerprint:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }),
    /eligible.*snapshot|3.*analyses/i,
  );
});

test("new analysis reports require and immutably bind an eligible snapshot", async () => {
  const repository = createMemoryIntelligenceRepository();
  const report = completeReport([companyAnalysis(1), companyAnalysis(2), companyAnalysis(3)]);
  await assert.rejects(
    repository.saveReport({
      ...report,
      eligibleSnapshotFingerprint: "caller-lie",
    }),
    /canonical|sha-256/i,
  );
  await assert.rejects(
    repository.saveReport({
      ...report,
      eligibleSnapshotFingerprint: undefined,
    }),
    /snapshot.*fingerprint|required/i,
  );
  await repository.saveReport(report);
  await assert.rejects(
    repository.saveReport({
      ...report,
      eligibleSnapshotFingerprint:
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    }),
    /snapshot.*different|immutable/i,
  );
});

test("memory report identity binds run and snapshot while legacy writes fail closed", async () => {
  const boundReport = completeReport([companyAnalysis(1)]);
  const legacyWrite: IntelligenceReportWrite = {
    id: boundReport.id,
    workspaceId: boundReport.workspaceId,
    runId: boundReport.runId,
    createdAt: boundReport.createdAt,
    marketSummary: "Legacy report.",
    opportunities: [],
  };

  const boundFirst = createMemoryIntelligenceRepository();
  await boundFirst.saveReport(boundReport);
  await assert.rejects(
    boundFirst.saveReport({
      ...boundReport,
      runId: "00000000-0000-4000-8000-000000000099",
      companyAnalyses: boundReport.companyAnalyses.map((analysis) => ({
        ...analysis,
        runId: "00000000-0000-4000-8000-000000000099",
      })),
    }),
    /run|identity|immutable/i,
  );
  await assert.rejects(
    boundFirst.saveReport(legacyWrite),
    /complete company analyses|snapshot/i,
  );

  const legacyFirst = createMemoryIntelligenceRepository();
  await assert.rejects(
    legacyFirst.saveReport(legacyWrite),
    /complete company analyses|snapshot/i,
  );
  assert.equal(
    await legacyFirst.getReport(legacyWrite.workspaceId, legacyWrite.id),
    null,
  );
});

test("lists a Deal's analyses newest first", async () => {
  const repository = createMemoryIntelligenceRepository();
  const older = completeReport();
  const newerEvent = event(
    "newer_analysis_event",
    "2026-07-24T11:00:00.000Z",
  );
  const newerBase = companyAnalysis(1, "belief_revised");
  const newerSources = [...newerBase.sources, ...newerEvent.sources];
  const newerAnalysis = {
    ...newerBase,
    id: "analysis_new",
    reportId: "report_new",
    runId: "00000000-0000-4000-8000-000000000002",
    createdAt: "2026-07-25T12:00:00.000Z",
    verifiedSourceCount: new Set(newerSources.map((source) => source.id)).size,
    marketEvidence: {
      relationship: "related" as const,
      explanation: "A source-backed market change may affect this company.",
      eventIds: [newerEvent.id],
      events: [newerEvent],
      sourceIds: newerEvent.sources.map((source) => source.id),
    },
    companyBrief: {
      ...newerBase.companyBrief,
      sourceLineage: newerSources,
    },
    sources: newerSources,
  };
  const newerAnalyses = [
    newerAnalysis,
    ...Array.from({ length: 18 }, (_, index) => ({
      ...companyAnalysis(index + 2),
      id: `analysis_new_${index + 2}`,
      reportId: "report_new",
      runId: newerAnalysis.runId,
      createdAt: newerAnalysis.createdAt,
    })),
  ];

  await repository.saveReport(older);
  await repository.saveReport({
    ...completeReport(newerAnalyses),
    id: "report_new",
    runId: newerAnalysis.runId,
    createdAt: newerAnalysis.createdAt,
    counts: {
      companyCount: 19,
      beliefRevised: 1,
      monitor: 0,
      noMaterialChange: 18,
      analysisUnavailable: 0,
    },
    priorityDealId: newerAnalysis.dealId,
  });

  assert.deepEqual(
    (
      await repository.listDealAnalyses("workspace_demo", newerAnalysis.dealId)
    ).map((analysis) => analysis.id),
    ["analysis_new", "analysis_1"],
  );
});

test("Supabase report writes use the atomic report RPC", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const report = {
    ...completeReport(),
    evidenceBindingFingerprint:
      "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  };
  const firstAnalysis = report.companyAnalyses[0];
  firstAnalysis.claimSupport = [{
    text: "Company 1 source evidence.",
    kind: "normalized_non_quote",
    sourceIds: [firstAnalysis.sources[0].id],
  }];
  const repository = createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    dealRegistry: authoritativeDealsFor(report.companyAnalyses),
    fetchImpl: async (input, init = {}) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.includes("/intelligence_reports")) return Response.json([]);
      if (url.includes("/scan_runs?")) {
        return Response.json([{
          id: report.runId,
          evidence_context_version: "run-evidence-context-v1",
          evidence_mode: "live",
          evidence_anchor_at: "2026-07-24T12:00:00.000Z",
          evidence_window_start_at: "2026-07-10T12:00:00.000Z",
          evidence_window_end_at: "2026-07-24T12:00:00.000Z",
          evidence_window_timezone: "America/Los_Angeles",
          evidence_snapshot_id: null,
          evidence_snapshot_fingerprint: null,
          evidence_context_fingerprint: `sha256:${"c".repeat(64)}`,
        }]);
      }
      if (!url.includes("/rpc/save_intelligence_report")) {
        throw new Error(`Unexpected request: ${url}`);
      }
      return Response.json([{
        id: report.id,
        workspace_id: report.workspaceId,
        run_id: report.runId,
        created_at: report.createdAt,
        market_summary: report.marketSummary,
        opportunities: [],
        analysis_status: report.analysisStatus,
        company_count: 19,
        belief_revised_count: 0,
        monitor_count: 0,
        no_material_change_count: 19,
        analysis_unavailable_count: 0,
        priority_deal_id: null,
        evidence_coverage: report.evidenceCoverage,
        evidence_context_version: "run-evidence-context-v1",
        evidence_mode: "live",
        evidence_window_days: 14,
        evidence_anchor_at: "2026-07-24T12:00:00.000Z",
        evidence_window_start_at: "2026-07-10T12:00:00.000Z",
        evidence_window_end_at: "2026-07-24T12:00:00.000Z",
        evidence_window_timezone: "America/Los_Angeles",
        evidence_snapshot_id: null,
        evidence_snapshot_fingerprint: null,
        evidence_context_fingerprint: `sha256:${"c".repeat(64)}`,
        evidence_display_label: "Live evidence window",
        evidence_event_count: 0,
        evidence_event_set_fingerprint: `sha256:${"d".repeat(64)}`,
        evidence_binding_fingerprint: report.evidenceBindingFingerprint,
      }]);
    },
  });

  const stored = await repository.saveReport(report);

  const rpcRequest = requests.find(({ url }) =>
    url.endsWith("/rpc/save_intelligence_report")
  );
  assert.ok(rpcRequest);
  assert.equal(
    rpcRequest.url,
    "https://example.supabase.co/rest/v1/rpc/save_intelligence_report",
  );
  const body = JSON.parse(String(rpcRequest.init.body));
  assert.equal(body.p_analyses.length, 19);
  assert.deepEqual(
    body.p_analyses[0].marketEvidence.claimSupport,
    firstAnalysis.claimSupport,
  );
  assert.equal(body.p_report.companyCount, 19);
  assert.equal(body.p_report.eligibleSnapshotCount, 19);
  assert.equal(
    body.p_report.evidenceBindingFingerprint,
    report.evidenceBindingFingerprint,
  );
  assert.equal(
    body.p_report.eligibleSnapshotFingerprint,
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  assert.equal(stored.companyAnalyses.length, 19);
  assert.equal(stored.evidenceContext?.state, "current");
  assert.equal(
    JSON.stringify(stored).includes("test-service-role-key"),
    false,
  );
});

test("Supabase reads accept PostgREST timestamptz offset timestamps", async () => {
  const report = completeReport();
  const firstAnalysis = report.companyAnalyses[0];
  firstAnalysis.claimSupport = [{
    text: "Company 1 source evidence.",
    kind: "normalized_non_quote",
    sourceIds: [firstAnalysis.sources[0].id],
  }];
  const offsetCreatedAt = "2026-07-25T00:55:05.106+00:00";
  const analysisRows = report.companyAnalyses.map((analysis) => ({
    id: analysis.id,
    workspace_id: report.workspaceId,
    report_id: report.id,
    run_id: analysis.runId,
    deal_id: analysis.dealId,
    company_name: analysis.companyName,
    deal_status: analysis.dealStatus,
    outcome: analysis.outcome,
    confidence: analysis.confidence,
    score: analysis.score,
    investment_memory: analysis.investmentMemory,
    market_evidence: {
      ...analysis.marketEvidence,
      claimSupport: analysis.claimSupport ?? [],
    },
    implications: analysis.implications,
    recommended_next_move: analysis.recommendedNextMove,
    company_brief: analysis.companyBrief,
    source_refs: analysis.sources,
    created_at: offsetCreatedAt,
  }));
  const repository = createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes("/intelligence_reports")) {
        return Response.json([{
          id: report.id,
          workspace_id: report.workspaceId,
          run_id: report.runId,
          created_at: offsetCreatedAt,
          market_summary: report.marketSummary,
          opportunities: [],
          analysis_status: report.analysisStatus,
          company_count: 19,
          belief_revised_count: 0,
          monitor_count: 0,
          no_material_change_count: 19,
          analysis_unavailable_count: 0,
          priority_deal_id: null,
          evidence_coverage: report.evidenceCoverage,
        }]);
      }
      if (url.includes("/company_analyses")) {
        return Response.json(analysisRows);
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const fetched = await repository.getReportByRunId(
    report.workspaceId,
    report.runId,
  );
  assert.equal(fetched?.companyAnalyses.length, 19);
  assert.equal(fetched?.companyAnalyses[0]?.createdAt, offsetCreatedAt);
  assert.deepEqual(
    fetched?.companyAnalyses[0]?.claimSupport,
    firstAnalysis.claimSupport,
  );

  const dealAnalyses = await repository.listDealAnalyses(
    report.workspaceId,
    report.companyAnalyses[0].dealId,
  );
  assert.equal(dealAnalyses.length, 1);
  assert.equal(dealAnalyses[0]?.dealId, report.companyAnalyses[0].dealId);
});

test("Supabase analysis reads recursively adapt legacy sources without inventing provenance", async () => {
  const report = completeReport([companyAnalysis(1)]);
  const analysis = report.companyAnalyses[0];
  const legacy = {
    id: analysis.sources[0].id,
    provenance: "source_document",
    title: "Legacy pitch deck",
    documentId: "legacy_document",
    page: 2,
    excerpt: "Legacy source text was not revision-verified.",
  };
  const row = {
    id: analysis.id,
    workspace_id: report.workspaceId,
    report_id: report.id,
    run_id: analysis.runId,
    deal_id: analysis.dealId,
    company_name: analysis.companyName,
    deal_status: analysis.dealStatus,
    outcome: analysis.outcome,
    confidence: analysis.confidence,
    score: analysis.score,
    investment_memory: analysis.investmentMemory,
    market_evidence: analysis.marketEvidence,
    implications: analysis.implications,
    recommended_next_move: analysis.recommendedNextMove,
    company_brief: {
      ...analysis.companyBrief,
      sourceLineage: [legacy],
    },
    source_refs: [legacy],
    created_at: analysis.createdAt,
  };
  const repository = createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    async fetchImpl(input) {
      return String(input).includes("/company_analyses")
        ? Response.json([row])
        : Response.json([{
            id: report.id,
            workspace_id: report.workspaceId,
            run_id: report.runId,
            created_at: report.createdAt,
            market_summary: report.marketSummary,
            opportunities: [],
            analysis_status: report.analysisStatus,
            company_count: 1,
            belief_revised_count: 0,
            monitor_count: 0,
            no_material_change_count: 1,
            analysis_unavailable_count: 0,
            priority_deal_id: null,
            evidence_coverage: report.evidenceCoverage,
          }]);
    },
  });

  const fetched = await repository.getReport(report.workspaceId, report.id);
  const source = fetched?.companyAnalyses[0]?.sources[0];
  assert.ok(source && "schemaVersion" in source);
  assert.equal(source.adaptation, "legacy_read");
  assert.equal(source.text.status, "legacy_unverified");
  assert.equal(source.retrievedAt, null);
});

test("Supabase report reads reject cross-analysis source-ID collisions", async () => {
  const first = companyAnalysis(1);
  const secondBase = companyAnalysis(2);
  const sharedId = first.sources[0].id;
  const conflictingSource = {
    ...secondBase.sources[0],
    id: sharedId,
    title: "Conflicting durable source payload",
  };
  const second: CompanyAnalysis = {
    ...secondBase,
    investmentMemory: {
      ...secondBase.investmentMemory,
      sourceIds: [sharedId],
    },
    companyBrief: {
      ...secondBase.companyBrief,
      icSnapshot: secondBase.companyBrief.icSnapshot.map((field) => ({
        ...field,
        sourceIds: [sharedId],
      })),
      sourceLineage: [conflictingSource],
    },
    sources: [conflictingSource],
  };
  const report = completeReport([first, second]);
  const toRow = (analysis: CompanyAnalysis) => ({
    id: analysis.id,
    workspace_id: report.workspaceId,
    report_id: report.id,
    run_id: analysis.runId,
    deal_id: analysis.dealId,
    company_name: analysis.companyName,
    deal_status: analysis.dealStatus,
    outcome: analysis.outcome,
    confidence: analysis.confidence,
    score: analysis.score,
    investment_memory: analysis.investmentMemory,
    market_evidence: analysis.marketEvidence,
    implications: analysis.implications,
    recommended_next_move: analysis.recommendedNextMove,
    company_brief: analysis.companyBrief,
    source_refs: analysis.sources,
    created_at: analysis.createdAt,
  });
  const repository = createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    async fetchImpl(input) {
      const url = String(input);
      if (url.includes("/company_analyses")) {
        return Response.json([toRow(first), toRow(second)]);
      }
      if (url.includes("/intelligence_reports")) {
        return Response.json([{
          id: report.id,
          workspace_id: report.workspaceId,
          run_id: report.runId,
          created_at: report.createdAt,
          market_summary: report.marketSummary,
          opportunities: [],
          analysis_status: report.analysisStatus,
          company_count: 2,
          belief_revised_count: 0,
          monitor_count: 0,
          no_material_change_count: 2,
          analysis_unavailable_count: 0,
          priority_deal_id: null,
          evidence_coverage: report.evidenceCoverage,
        }]);
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await assert.rejects(
    repository.getReport(report.workspaceId, report.id),
    /report source|canonical id.*different payload/i,
  );
  await assert.rejects(
    repository.listReports(report.workspaceId),
    /report source|canonical id.*different payload/i,
  );
});

test("workspace report catalog validation cannot be bypassed by reset or direct report filters", async () => {
  const resetAt = "2026-07-23T12:00:00.000Z";
  const firstReport = completeReportWithIdentity({
    id: "report_catalog_first",
    runId: "00000000-0000-4000-8000-000000000083",
    createdAt: "2026-07-23T12:00:00.000Z",
    marketSummary: "First catalog report.",
  });
  const secondReport = completeReportWithIdentity({
    id: "report_catalog_second",
    runId: "00000000-0000-4000-8000-000000000084",
    createdAt: "2026-07-24T12:00:00.000Z",
    marketSummary: "Second catalog report.",
  });
  const secondBase = secondReport.companyAnalyses[0];
  const conflictingSource = {
    ...secondBase.sources[0],
    title: "Conflicting cross-report source payload",
  };
  const conflictingAnalysis: CompanyAnalysis = {
    ...secondBase,
    companyBrief: {
      ...secondBase.companyBrief,
      sourceLineage: [conflictingSource],
    },
    sources: [conflictingSource],
  };
  secondReport.companyAnalyses = [conflictingAnalysis];

  const toAnalysisRow = (analysis: CompanyAnalysis) => ({
    id: analysis.id,
    workspace_id: firstReport.workspaceId,
    report_id: analysis.reportId,
    run_id: analysis.runId,
    deal_id: analysis.dealId,
    company_name: analysis.companyName,
    deal_status: analysis.dealStatus,
    outcome: analysis.outcome,
    confidence: analysis.confidence,
    score: analysis.score,
    investment_memory: analysis.investmentMemory,
    market_evidence: analysis.marketEvidence,
    implications: analysis.implications,
    recommended_next_move: analysis.recommendedNextMove,
    company_brief: analysis.companyBrief,
    source_refs: analysis.sources,
    created_at: analysis.createdAt,
  });
  const toReportRow = (
    report: IntelligenceReportWrite & { companyAnalyses: CompanyAnalysis[] },
  ) => ({
    id: report.id,
    workspace_id: report.workspaceId,
    run_id: report.runId,
    created_at: report.createdAt,
    market_summary: report.marketSummary,
    opportunities: report.opportunities,
    analysis_status: report.analysisStatus,
    company_count: 1,
    belief_revised_count: 0,
    monitor_count: 0,
    no_material_change_count: 1,
    analysis_unavailable_count: 0,
    priority_deal_id: null,
    evidence_coverage: report.evidenceCoverage,
  });
  const supabase = createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    async fetchImpl(input) {
      const url = String(input);
      if (url.includes("/company_analyses")) {
        return Response.json([
          toAnalysisRow(firstReport.companyAnalyses[0]),
          toAnalysisRow(conflictingAnalysis),
        ]);
      }
      if (url.includes("/intelligence_reports")) {
        return Response.json([
          toReportRow(firstReport),
          toReportRow(secondReport),
        ]);
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  await assert.rejects(
    supabase.listReports(firstReport.workspaceId, resetAt),
    /workspace report catalog source|canonical id.*different payload/i,
  );
  await assert.rejects(
    supabase.getReport(firstReport.workspaceId, secondReport.id),
    /workspace report catalog source|canonical id.*different payload/i,
  );
  await assert.rejects(
    supabase.getReportByRunId(firstReport.workspaceId, secondReport.runId),
    /workspace report catalog source|canonical id.*different payload/i,
  );
});

test("report writers reject workspace catalog collisions before persistence or mutation RPC", async () => {
  const existing = completeReportWithIdentity({
    id: "report_write_catalog_existing",
    runId: "00000000-0000-4000-8000-000000000085",
    createdAt: "2026-07-23T12:00:00.000Z",
    marketSummary: "Existing catalog report.",
  });
  const incoming = completeReportWithIdentity({
    id: "report_write_catalog_incoming",
    runId: "00000000-0000-4000-8000-000000000086",
    createdAt: "2026-07-24T12:00:00.000Z",
    marketSummary: "Incoming catalog report.",
  });
  const incomingBase = incoming.companyAnalyses[0];
  const conflictingSource = {
    ...incomingBase.sources[0],
    title: "Conflicting incoming source payload",
  };
  incoming.companyAnalyses = [{
    ...incomingBase,
    companyBrief: {
      ...incomingBase.companyBrief,
      sourceLineage: [conflictingSource],
    },
    sources: [conflictingSource],
  }];

  const memory = createMemoryIntelligenceRepository();
  await memory.saveReport(existing);
  await assert.rejects(
    memory.saveReport(incoming),
    /workspace report catalog source|canonical id.*different payload/i,
  );
  assert.equal(
    await memory.getReport(existing.workspaceId, incoming.id),
    null,
  );
  assert.deepEqual(
    (await memory.listReports(existing.workspaceId)).map((report) => report.id),
    [existing.id],
  );

  const existingAnalysis = existing.companyAnalyses[0];
  let mutationRpcCalls = 0;
  const supabase = createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    async fetchImpl(input, init) {
      const url = String(input);
      if (url.includes("/rpc/save_intelligence_report")) {
        mutationRpcCalls += 1;
        return Response.json([]);
      }
      if (url.includes("/company_analyses")) {
        return Response.json([{
          id: existingAnalysis.id,
          workspace_id: existing.workspaceId,
          report_id: existingAnalysis.reportId,
          run_id: existingAnalysis.runId,
          deal_id: existingAnalysis.dealId,
          company_name: existingAnalysis.companyName,
          deal_status: existingAnalysis.dealStatus,
          outcome: existingAnalysis.outcome,
          confidence: existingAnalysis.confidence,
          score: existingAnalysis.score,
          investment_memory: existingAnalysis.investmentMemory,
          market_evidence: existingAnalysis.marketEvidence,
          implications: existingAnalysis.implications,
          recommended_next_move: existingAnalysis.recommendedNextMove,
          company_brief: existingAnalysis.companyBrief,
          source_refs: existingAnalysis.sources,
          created_at: existingAnalysis.createdAt,
        }]);
      }
      if (url.includes("/intelligence_reports") && !init?.method) {
        return Response.json([{
          id: existing.id,
          workspace_id: existing.workspaceId,
          run_id: existing.runId,
          created_at: existing.createdAt,
          market_summary: existing.marketSummary,
          opportunities: existing.opportunities,
          analysis_status: existing.analysisStatus,
          company_count: 1,
          belief_revised_count: 0,
          monitor_count: 0,
          no_material_change_count: 1,
          analysis_unavailable_count: 0,
          priority_deal_id: null,
          evidence_coverage: existing.evidenceCoverage,
        }]);
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  await assert.rejects(
    supabase.saveReport(incoming),
    /workspace report catalog source|canonical id.*different payload/i,
  );
  assert.equal(mutationRpcCalls, 0);
});

test("Deal analysis history validation cannot be bypassed by cross-Deal filtering", async () => {
  const firstReport = completeReportWithIdentity({
    id: "report_history_first",
    runId: "00000000-0000-4000-8000-000000000081",
    createdAt: "2026-07-23T12:00:00.000Z",
    marketSummary: "First historical analysis.",
  });
  const secondReport = completeReportWithIdentity({
    id: "report_history_second",
    runId: "00000000-0000-4000-8000-000000000082",
    createdAt: "2026-07-24T12:00:00.000Z",
    marketSummary: "Second historical analysis.",
  });
  const secondBase = secondReport.companyAnalyses[0];
  const conflictingSource = {
    ...secondBase.sources[0],
    title: "Conflicting historical source payload",
  };
  const conflictingAnalysis: CompanyAnalysis = {
    ...secondBase,
    dealId: "deal_cross_catalog_two",
    companyName: "Cross Catalog Two",
    companyBrief: {
      ...secondBase.companyBrief,
      sourceLineage: [conflictingSource],
    },
    sources: [conflictingSource],
  };
  secondReport.companyAnalyses = [conflictingAnalysis];

  const memory = createMemoryIntelligenceRepository();
  await memory.saveReport(firstReport);
  await assert.rejects(
    memory.saveReport(secondReport),
    /workspace report catalog source|canonical id.*different payload/i,
  );
  assert.equal(
    await memory.getReport(firstReport.workspaceId, secondReport.id),
    null,
  );

  const toRow = (analysis: CompanyAnalysis) => ({
    id: analysis.id,
    workspace_id: firstReport.workspaceId,
    report_id: analysis.reportId,
    run_id: analysis.runId,
    deal_id: analysis.dealId,
    company_name: analysis.companyName,
    deal_status: analysis.dealStatus,
    outcome: analysis.outcome,
    confidence: analysis.confidence,
    score: analysis.score,
    investment_memory: analysis.investmentMemory,
    market_evidence: analysis.marketEvidence,
    implications: analysis.implications,
    recommended_next_move: analysis.recommendedNextMove,
    company_brief: analysis.companyBrief,
    source_refs: analysis.sources,
    created_at: analysis.createdAt,
  });
  const supabase = createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    async fetchImpl(input) {
      const url = String(input);
      if (url.includes("/company_analyses")) {
        return Response.json([
          toRow(firstReport.companyAnalyses[0]),
          toRow(conflictingAnalysis),
        ]);
      }
      if (url.includes("/intelligence_reports")) {
        return Response.json([firstReport, secondReport].map((report) => ({
          id: report.id,
          workspace_id: report.workspaceId,
          run_id: report.runId,
          created_at: report.createdAt,
          market_summary: report.marketSummary,
          opportunities: report.opportunities,
          analysis_status: report.analysisStatus,
          company_count: 1,
          belief_revised_count: 0,
          monitor_count: 0,
          no_material_change_count: 1,
          analysis_unavailable_count: 0,
          priority_deal_id: null,
          evidence_coverage: report.evidenceCoverage,
        })));
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  await assert.rejects(
    supabase.listDealAnalyses(
      firstReport.workspaceId,
      firstReport.companyAnalyses[0].dealId,
    ),
    /workspace report catalog source|canonical id.*different payload/i,
  );
});

test("Supabase reads quarantine malformed legacy analyses without hiding valid rows", async () => {
  const report = completeReport([companyAnalysis(1)]);
  const validAnalysis = report.companyAnalyses[0];
  const validRow = {
    id: validAnalysis.id,
    workspace_id: report.workspaceId,
    report_id: report.id,
    run_id: validAnalysis.runId,
    deal_id: validAnalysis.dealId,
    company_name: validAnalysis.companyName,
    deal_status: validAnalysis.dealStatus,
    outcome: validAnalysis.outcome,
    confidence: validAnalysis.confidence,
    score: validAnalysis.score,
    investment_memory: validAnalysis.investmentMemory,
    market_evidence: validAnalysis.marketEvidence,
    implications: validAnalysis.implications,
    recommended_next_move: validAnalysis.recommendedNextMove,
    company_brief: validAnalysis.companyBrief,
    source_refs: validAnalysis.sources,
    created_at: validAnalysis.createdAt,
  };
  const malformedLegacyRow = {
    ...validRow,
    id: "analysis_legacy_malformed",
    company_name: "Legacy Company",
    investment_memory: null,
    company_brief: null,
  };
  const missingCompanyNameRow = {
    ...validRow,
    id: "analysis_legacy_missing_company",
    company_name: undefined,
  };
  const nullScoreRow = {
    ...validRow,
    id: "analysis_legacy_null_score",
    score: null,
  };
  const repository = createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes("/intelligence_reports")) {
        return Response.json([{
          id: report.id,
          workspace_id: report.workspaceId,
          run_id: report.runId,
          created_at: report.createdAt,
          market_summary: report.marketSummary,
          opportunities: report.opportunities,
          analysis_status: report.analysisStatus,
          company_count: 2,
          belief_revised_count: 0,
          monitor_count: 0,
          no_material_change_count: 1,
          analysis_unavailable_count: 1,
          priority_deal_id: null,
          evidence_coverage: report.evidenceCoverage,
        }]);
      }
      if (url.includes("/company_analyses")) {
        return Response.json([
          malformedLegacyRow,
          missingCompanyNameRow,
          nullScoreRow,
          validRow,
        ]);
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const fetched = await repository.getReportByRunId(
    report.workspaceId,
    report.runId,
  );
  assert.deepEqual(
    fetched?.companyAnalyses.map((analysis) => analysis.id),
    [validAnalysis.id],
  );
  assert.equal(fetched?.counts.companyCount, 1);
  assert.equal(fetched?.counts.analysisUnavailable, 0);
  assert.equal(
    fetched?.companyAnalyses.some(
      (analysis) => analysis.companyName === "Legacy Company",
    ),
    false,
  );

  const dealAnalyses = await repository.listDealAnalyses(
    report.workspaceId,
    validAnalysis.dealId,
  );
  assert.deepEqual(
    dealAnalyses.map((analysis) => analysis.id),
    [validAnalysis.id],
  );
});

test("Supabase reads fail closed when any declared belief assessment column is partial", async () => {
  const report = completeReport([companyAnalysis(1)]);
  const analysis = report.companyAnalyses[0];
  const repository = createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    async fetchImpl(input) {
      const url = String(input);
      if (url.includes("/intelligence_reports")) {
        return Response.json([{
          id: report.id,
          workspace_id: report.workspaceId,
          run_id: report.runId,
          created_at: report.createdAt,
          market_summary: report.marketSummary,
          opportunities: [],
          company_count: 1,
          belief_revised_count: 0,
          monitor_count: 0,
          no_material_change_count: 1,
          analysis_unavailable_count: 0,
          evidence_coverage: report.evidenceCoverage,
        }]);
      }
      if (url.includes("/company_analyses")) {
        return Response.json([{
          id: analysis.id,
          workspace_id: report.workspaceId,
          report_id: report.id,
          run_id: analysis.runId,
          deal_id: analysis.dealId,
          company_name: analysis.companyName,
          deal_status: analysis.dealStatus,
          outcome: analysis.outcome,
          confidence: analysis.confidence,
          score: analysis.score,
          investment_memory: analysis.investmentMemory,
          market_evidence: analysis.marketEvidence,
          implications: analysis.implications,
          recommended_next_move: analysis.recommendedNextMove,
          company_brief: analysis.companyBrief,
          source_refs: analysis.sources,
          created_at: analysis.createdAt,
          belief_assessment_version: "belief-change-assessment-v1",
          belief_direction: null,
          belief_score_breakdown: null,
          belief_gate_context: null,
          belief_gate_results: null,
          belief_actions: null,
        }]);
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await assert.rejects(
    repository.listReports(report.workspaceId),
    /partial.*belief assessment/i,
  );
});

test("Supabase reads never synthesize an analysis after every durable row is quarantined", async () => {
  const report = completeReport([companyAnalysis(1)]);
  const analysis = report.companyAnalyses[0];
  const malformedRow = {
    id: analysis.id,
    workspace_id: report.workspaceId,
    report_id: report.id,
    run_id: analysis.runId,
    deal_id: analysis.dealId,
    company_name: analysis.companyName,
    deal_status: analysis.dealStatus,
    outcome: analysis.outcome,
    confidence: analysis.confidence,
    score: analysis.score,
    investment_memory: null,
    market_evidence: analysis.marketEvidence,
    implications: analysis.implications,
    recommended_next_move: analysis.recommendedNextMove,
    company_brief: null,
    source_refs: analysis.sources,
    created_at: analysis.createdAt,
  };
  const legacyOpportunity = {
    rank: 1,
    dealId: analysis.dealId,
    confidence: "medium",
    score: 0.72,
    whyNow: "Infrastructure activity increased.",
    previousContext: "The fund previously passed.",
    implications: { positive: [], negative: [] },
    nextStep: "Review the cited evidence.",
    sources: [{
      id: "source_legacy",
      provenance: "public_web",
      title: "Legacy source",
      url: "https://example.com/source",
      excerpt: "Infrastructure activity increased.",
    }],
    demoFixtureIds: [],
  };
  const repository = createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes("/intelligence_reports")) {
        return Response.json([{
          id: report.id,
          workspace_id: report.workspaceId,
          run_id: report.runId,
          created_at: report.createdAt,
          market_summary: report.marketSummary,
          opportunities: [legacyOpportunity],
          analysis_status: report.analysisStatus,
          company_count: 1,
          belief_revised_count: 1,
          monitor_count: 0,
          no_material_change_count: 0,
          analysis_unavailable_count: 0,
          priority_deal_id: analysis.dealId,
          evidence_coverage: report.evidenceCoverage,
        }]);
      }
      if (url.includes("/company_analyses")) {
        return Response.json([malformedRow]);
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const fetched = await repository.getReportByRunId(
    report.workspaceId,
    report.runId,
  );
  assert.deepEqual(fetched?.companyAnalyses, []);
});

test("resetScanProducts logically hides reports and market events without deleting durable lineage", async () => {
  const repository = createMemoryIntelligenceRepository({
    now: () => new Date("2026-07-24T12:00:00.000Z"),
  });
  await repository.saveMarketEvents([event("wiped")], "workspace_demo");
  await repository.saveReport(completeReportWithIdentity({
    id: "report_wiped",
    runId: "00000000-0000-4000-8000-000000000071",
    createdAt: "2026-07-23T12:00:00.000Z",
    marketSummary: "To be wiped.",
  }));

  await repository.resetScanProducts("workspace_demo");

  assert.deepEqual(await repository.listReports("workspace_demo"), []);
  assert.deepEqual(await repository.listMarketEvents("workspace_demo"), []);
});

test("Supabase resetScanProducts advances the logical generation without destructive REST calls", async () => {
  const deletePaths: string[] = [];
  const postPaths: string[] = [];
  const repository = intelligenceRepositoryModule.createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") deletePaths.push(String(input));
      if (init?.method === "POST") postPaths.push(String(input));
      return new Response(null, { status: 204 });
    },
  });

  await repository.resetScanProducts("workspace_demo");

  assert.equal(deletePaths.length, 0);
  assert.deepEqual(postPaths, [
    "https://example.supabase.co/rest/v1/rpc/reset_intelligence_products",
  ]);
  assert.doesNotMatch(
    deletePaths.join("\n"),
    /company_analyses|intelligence_reports/,
  );
});
