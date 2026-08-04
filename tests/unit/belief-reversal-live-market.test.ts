import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createMarketService } from "../../lib/market/service";
import type { SourceRevision } from "../../db/repositories/source-registry";
import { loadBeliefReversalManifest } from "../../lib/belief-reversal/manifest";
import {
  uniqueByCanonicalId,
  WritableSourceRefV2Schema,
} from "../../lib/contracts/source-evidence";
import {
  buildBeliefReversalLiveMarketPackets,
  buildBeliefReversalLiveMarketSourceItems,
  createBeliefReversalRegistryGroundedLiveMarketService,
  createBeliefReversalLoopbackMarketProvider,
} from "../helpers/belief-reversal-live-market";

test("live market fixture derives all eleven current event-first items without a pinned snapshot identity", () => {
  const items = buildBeliefReversalLiveMarketSourceItems({
    retrievedAt: "2026-08-03T12:00:00.000Z",
  });

  assert.equal(items.length, 11);
  assert.deepEqual(
    items.map(({ entities }) => entities),
    [
      ["henry_ai"],
      ["smallest_ai"],
      ["hush_security", "irregular"],
      ["irregular"],
      ["centralize"],
      ["chipagents"],
      ["sent"],
      ["cascade"],
      ["cordant"],
      ["empirical_security"],
      ["freight_hero"],
    ],
  );
  assert.ok(items.every((item) => item.evidenceRole === "trigger"));
  assert.ok(items.every((item) => item.retrievedAt === "2026-08-03T12:00:00.000Z"));
  assert.ok(items.every((item) => !("snapshotId" in item)));
  assert.ok(items.every((item) => !("sourceRevisionId" in item)));
});

test("live market provider performs a loopback collection and production normalization", async () => {
  const requests: URL[] = [];
  const raw = buildBeliefReversalLiveMarketSourceItems({
    retrievedAt: "2026-08-03T12:00:00.000Z",
  });
  const provider = createBeliefReversalLoopbackMarketProvider({
    sourceUrl: "http://127.0.0.1:43123/__fixture/market",
    fetchImpl: async (request) => {
      requests.push(new URL(String(request)));
      return Response.json(raw);
    },
  });
  const service = createMarketService({ providers: [provider] });

  const result = await service.scanMarketWindow({
    days: 14,
    now: new Date("2026-08-03T12:00:00.000Z"),
    retrievedAt: new Date("2026-08-03T12:00:00.000Z"),
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.hostname, "127.0.0.1");
  assert.equal(requests[0]!.searchParams.get("to"), "2026-08-03T12:00:00.000Z");
  assert.equal(result.status, "completed");
  assert.equal(result.events.length, 11);
  assert.equal(result.providers[0]?.fetchedCount, 11);
  assert.equal(result.providers[0]?.acceptedCount, 11);
  assert.ok(result.events.every(({ sources }) =>
    sources.length === 1
    && sources[0]?.text.status === "normalized_only"
    && sources[0]?.sourceRevisionId === null
  ));
});

test("live market provider refuses non-loopback source endpoints", () => {
  assert.throws(
    () => createBeliefReversalLoopbackMarketProvider({
      sourceUrl: "https://production.example.test/market",
    }),
    /exact loopback URL/u,
  );
});

test("live packets permanently exclude the unresolved ChipAgents Reuters gap", () => {
  const packets = buildBeliefReversalLiveMarketPackets({
    collectedAt: "2026-08-03T12:00:00.000Z",
  });

  assert.equal(packets.length, 11);
  assert.ok(packets.every(({ sources }) =>
    sources.every(({ id }) => id !== "source_chipagents_reuters_gap_v1")
  ));
});

test("registry-grounded live scan accepts date-precision evidence on the first window day", async () => {
  const collectedAt = "2026-08-03T12:00:00.000Z";
  const packets = buildBeliefReversalLiveMarketPackets({ collectedAt });
  const revisions = new Map<string, SourceRevision>(packets.flatMap((packet) =>
    packet.sources.map((source) => {
      const snapshot = packet.sourceSnapshot.schemaVersion
          === "belief-reversal-public-source-snapshot-v1"
        ? {
          schemaVersion: packet.sourceSnapshot.schemaVersion,
          packageId: packet.packageId,
          caseId: packet.sourceSnapshot.caseId,
          source: canonicalSelectedSource(source),
        }
        : {
          schemaVersion: packet.sourceSnapshot.schemaVersion,
          packageId: packet.packageId,
          candidateId: packet.sourceSnapshot.candidateId,
          source,
        };
      const hash = canonicalHash(snapshot);
      return [`source_revision_${source.id}_1`, {
        id: `source_revision_${source.id}_1`,
        workspaceId: "workspace_demo",
        sourceId: source.id,
        revision: 1,
        contentHash: `sha256:${hash}`,
        objectKey: `fixture/${source.id}`,
        objectVersion: "fixture-v1",
        contentType: "application/json",
        extractorId: "belief_reversal_fixture",
        extractorVersion: "1",
        extractedAt: collectedAt,
        supersedesRevisionId: null,
        createdAt: collectedAt,
      }] as const;
    })
  ));
  const service = createBeliefReversalRegistryGroundedLiveMarketService({
    sourceUrl: "http://127.0.0.1:43123/__fixture/market",
    workspaceId: "workspace_demo",
    sourceRegistry: {
      async getRevision({ revisionId }) {
        return revisions.get(revisionId) ?? null;
      },
    },
    fetchImpl: async () => Response.json(packets),
  });

  const result = await service.scanMarketWindow({
    days: 14,
    now: new Date(collectedAt),
    retrievedAt: new Date(collectedAt),
  });

  assert.equal(result.status, "completed");
  assert.equal(result.events.length, 11);
  assert.ok(result.events.some(({ entityKeys }) =>
    entityKeys.includes("empirical_security")
  ));
  const authoritativeSources = packets.flatMap((packet) =>
    packet.sources.map((source) => expectedCanonicalSourceRef(
      packet,
      source,
      revisions.get(`source_revision_${source.id}_1`)!,
    ))
  );
  const liveSources = result.events.flatMap(({ sources }) => sources);
  assert.equal(
    uniqueByCanonicalId(
      [...authoritativeSources, ...liveSources],
      "registry-grounded live source",
    ).length,
    new Set(authoritativeSources.map(({ id }) => id)).size,
  );

  const laterCollectedAt = "2026-08-03T23:44:48.857Z";
  const laterPackets = buildBeliefReversalLiveMarketPackets({
    collectedAt: laterCollectedAt,
  });
  const laterService = createBeliefReversalRegistryGroundedLiveMarketService({
    sourceUrl: "http://127.0.0.1:43123/__fixture/market",
    workspaceId: "workspace_demo",
    sourceRegistry: {
      async getRevision({ revisionId }) {
        return revisions.get(revisionId) ?? null;
      },
    },
    fetchImpl: async () => Response.json(laterPackets),
  });
  const later = await laterService.scanMarketWindow({
    days: 14,
    now: new Date(laterCollectedAt),
    retrievedAt: new Date(laterCollectedAt),
  });
  assert.equal(later.events.length, 10);
  assert.equal(later.providers[0]?.rejectedCount, 1);
  assert.ok(later.events.every(({ entityKeys }) =>
    !entityKeys.includes("empirical_security")
  ));

  const nextUtcDayCollectedAt = "2026-08-04T06:00:00.000Z";
  const nextUtcDayPackets = buildBeliefReversalLiveMarketPackets({
    collectedAt: nextUtcDayCollectedAt,
  });
  const nextUtcDayService = createBeliefReversalRegistryGroundedLiveMarketService({
    sourceUrl: "http://127.0.0.1:43123/__fixture/market",
    workspaceId: "workspace_demo",
    sourceRegistry: {
      async getRevision({ revisionId }) {
        return revisions.get(revisionId) ?? null;
      },
    },
    fetchImpl: async () => Response.json(nextUtcDayPackets),
  });
  const nextUtcDay = await nextUtcDayService.scanMarketWindow({
    days: 14,
    now: new Date(nextUtcDayCollectedAt),
    retrievedAt: new Date(nextUtcDayCollectedAt),
  });
  assert.equal(nextUtcDay.status, "completed");
  assert.equal(nextUtcDay.events.length, 10);
  assert.equal(nextUtcDay.providers[0]?.rejectedCount, 1);

  const fullyExpiredAt = "2026-08-20T06:00:00.000Z";
  const fullyExpiredPackets = buildBeliefReversalLiveMarketPackets({
    collectedAt: fullyExpiredAt,
  });
  const fullyExpiredService = createBeliefReversalRegistryGroundedLiveMarketService({
    sourceUrl: "http://127.0.0.1:43123/__fixture/market",
    workspaceId: "workspace_demo",
    sourceRegistry: {
      async getRevision({ revisionId }) {
        return revisions.get(revisionId) ?? null;
      },
    },
    fetchImpl: async () => Response.json(fullyExpiredPackets),
  });
  const fullyExpired = await fullyExpiredService.scanMarketWindow({
    days: 14,
    now: new Date(fullyExpiredAt),
    retrievedAt: new Date(fullyExpiredAt),
  });
  assert.equal(fullyExpired.status, "completed");
  assert.equal(fullyExpired.events.length, 0);
  assert.equal(fullyExpired.providers[0]?.rejectedCount, 11);
});

test("registry-grounded live scan fails closed when packet payload drifts from the active Source Revision", async () => {
  const collectedAt = "2026-08-03T12:00:00.000Z";
  const packets = buildBeliefReversalLiveMarketPackets({ collectedAt });
  const cascade = packets.find(({ event }) =>
    event.entityKeys.includes("cascade")
  )!;
  const source = cascade.sources[0]!;
  const snapshot = {
    schemaVersion: cascade.sourceSnapshot.schemaVersion,
    packageId: cascade.packageId,
    candidateId: "candidate_cascade",
    source,
  };
  const revision: SourceRevision = {
    id: `source_revision_${source.id}_1`,
    workspaceId: "workspace_demo",
    sourceId: source.id,
    revision: 1,
    contentHash: `sha256:${canonicalHash(snapshot)}`,
    objectKey: `fixture/${source.id}`,
    objectVersion: "fixture-v1",
    contentType: "application/json",
    extractorId: "belief_reversal_fixture",
    extractorVersion: "1",
    extractedAt: collectedAt,
    supersedesRevisionId: null,
    createdAt: collectedAt,
  };
  const drifted = structuredClone(packets);
  const driftedCascade = drifted.find(({ event }) =>
    event.entityKeys.includes("cascade")
  )!;
  driftedCascade.sources[0] = {
    ...driftedCascade.sources[0]!,
    normalizedStatement:
      `${driftedCascade.sources[0]!.normalizedStatement} drift`,
  };
  const service = createBeliefReversalRegistryGroundedLiveMarketService({
    sourceUrl: "http://127.0.0.1:43123/__fixture/market",
    workspaceId: "workspace_demo",
    sourceRegistry: {
      async getRevision({ revisionId }) {
        return revisionId === revision.id ? revision : null;
      },
    },
    fetchImpl: async () => Response.json([driftedCascade]),
  });

  await assert.rejects(
    service.scanMarketWindow({
      days: 14,
      now: new Date(collectedAt),
      retrievedAt: new Date(collectedAt),
    }),
    /did not match its immutable Source Revision/u,
  );
});

test("registry-grounded live scan keeps future-dated packets fatal", async () => {
  const collectedAt = "2026-08-04T06:00:00.000Z";
  const packet = structuredClone(buildBeliefReversalLiveMarketPackets({
    collectedAt,
  })[0]!);
  packet.event.publishedAt = "2026-08-05";
  const service = createBeliefReversalRegistryGroundedLiveMarketService({
    sourceUrl: "http://127.0.0.1:43123/__fixture/market",
    workspaceId: "workspace_demo",
    sourceRegistry: { async getRevision() { return null; } },
    fetchImpl: async () => Response.json([packet]),
  });

  await assert.rejects(
    service.scanMarketWindow({
      days: 14,
      now: new Date(collectedAt),
      retrievedAt: new Date(collectedAt),
    }),
    /future-dated/u,
  );
});

function canonicalHash(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, canonical(child)]),
      );
    }
    return item;
  };
  return createHash("sha256")
    .update(`${JSON.stringify(canonical(value))}\n`, "utf8")
    .digest("hex");
}

function canonicalSelectedSource(
  source: ReturnType<typeof buildBeliefReversalLiveMarketPackets>[number]["sources"][number],
) {
  if (!("supportedClaimId" in source)) {
    throw new Error(`Expected a selected-case source, received ${source.id}.`);
  }
  return {
    id: source.id,
    title: source.title,
    publisher: source.publisher,
    canonicalUrl: source.canonicalUrl,
    sourceClass: source.sourceClass,
    sourceAuthority: source.sourceAuthority,
    evidenceRole: source.evidenceRole,
    entityKeys: [...source.entityKeys],
    eventAt: source.eventAt,
    publishedAt: source.publishedAt,
    publicationTimestamp: source.publicationTimestamp,
    retrievedAt: source.retrievedAt,
    locator: source.locator,
    verbatimExcerpt: source.verbatimExcerpt,
    normalizedStatement: source.normalizedStatement,
    supportedClaimId: source.supportedClaimId,
  };
}

function expectedCanonicalSourceRef(
  packet: ReturnType<typeof buildBeliefReversalLiveMarketPackets>[number],
  source: ReturnType<typeof buildBeliefReversalLiveMarketPackets>[number]["sources"][number],
  revision: SourceRevision,
) {
  const manifest = loadBeliefReversalManifest();
  const selected = "supportedClaimId" in source;
  const publishedAt = source.publicationTimestamp ?? source.publishedAt;
  return WritableSourceRefV2Schema.parse({
    schemaVersion: "source-ref-v2",
    adaptation: "canonical",
    id: selected
      ? source.supportedClaimId
      : source.id.replace(/^source_/u, "research_evidence_"),
    provenance: "public_web",
    title: source.title,
    canonicalUrl: source.canonicalUrl,
    documentId: source.id,
    publisher: source.publisher,
    providerId: selected
      ? "belief_reversal_snapshot_v1"
      : "belief_reversal_research_snapshot_v1",
    eventAt: source.eventAt,
    eventAtPrecision: source.eventAt === null ? null : "date",
    publishedAt,
    publishedAtPrecision: publishedAt === null
      ? null
      : source.publicationTimestamp === null
      ? "date"
      : "timestamp",
    retrievedAt: selected ? manifest.retrievalDate : source.retrievedAt,
    retrievedAtPrecision: "date",
    updatedAt: null,
    updatedAtPrecision: null,
    entityKeys: [...source.entityKeys],
    sourceClass: source.sourceClass,
    sourceAuthority: source.sourceAuthority,
    evidenceRole: source.evidenceRole,
    sourceRevisionId: revision.id,
    locator: { kind: "web_text", selector: source.locator },
    contentFingerprint: revision.contentHash,
    text: {
      status: "verified_exact",
      verbatimExcerpt: source.verbatimExcerpt,
      normalizedStatement: source.normalizedStatement,
    },
  });
}
