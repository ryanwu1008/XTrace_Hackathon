import assert from "node:assert/strict";
import test from "node:test";

import {
  createMemoryDealRegistry,
} from "../../db/repositories/deal-registry";
import {
  createMemoryEvidencePacksRepository,
} from "../../db/repositories/evidence-packs";
import {
  createMemoryMarketEvidenceSnapshotsRepository,
} from "../../db/repositories/market-evidence-snapshots";
import {
  createMemorySourceRegistry,
} from "../../db/repositories/source-registry";
import {
  APPROVED_PINNED_DEMO_SNAPSHOT_ID,
  CreateMarketEvidenceSnapshotRequestV1Schema,
} from "../../lib/contracts/evidence-context";
import {
  loadBeliefReversalManifest,
} from "../../lib/belief-reversal/manifest";
import {
  assertPinnedThirtyDealUniverse,
  buildPinnedThirtyDealSnapshotRequest,
  loadPinnedThirtyDealSnapshotPackage,
  parsePinnedThirtyDealSnapshotPackage,
  PINNED_THIRTY_DEAL_PACKAGE_ID,
  PINNED_THIRTY_DEAL_SNAPSHOT_ID,
} from "../../lib/belief-reversal/pinned-thirty-deal-snapshot";
import {
  createMemoryDemoDataStore,
  createMemoryPrivateObjectStorage,
} from "../../lib/storage/service";
import { backfillPreloadedSourceRegistry } from "../../scripts/backfill-source-registry";
import { runBeliefReversalDemoSeed } from "../../scripts/seed-belief-reversal-demo";

const EXPECTED_EVENT_IDENTITIES = [
  [
    "event_henry_series_a_v1",
    "sha256:a5ce7f17355dc8b9473329796231567b55e93c55b8fe64c93b97448a2c9eee70",
  ],
  [
    "event_hush_series_a_v1",
    "sha256:6e66908e1d5a423a47fcc0f2a6200c66551b65770a2f8c3b2ead52c985281013",
  ],
  [
    "event_irregular_incidents_v1",
    "sha256:b5ff42d399d42c99d1c339bf88c22e1ddc6954839bba5482e3bc489709e844b4",
  ],
  [
    "event_smallest_series_a_v1",
    "sha256:b271b4c22365103443e74387034c1ab70b269e4bcc1cf075966eac751dc3499c",
  ],
] as const;

const EXPECTED_SCREENING_DEALS = [
  ["Cascade", "deal_cascade_v1"],
  ["Centralize", "deal_centralize_v1"],
  ["ChipAgents", "deal_chipagents_v1"],
  ["Cordant", "deal_cordant_v1"],
  ["Empirical Security", "deal_empirical_security_v1"],
  ["Freight Hero", "deal_freight_hero_v1"],
  ["Sent", "deal_sent_v1"],
] as const;

const EXPECTED_EVENT_SET_FINGERPRINT =
  "sha256:f7f4f25fea16aa5eccd7e78263c880959482b884cff07e84f238fe45724b82b9";

const EXPECTED_DEAL_UNIVERSE_ID =
  "deal_universe_belief_reversal_pinned_30_2026_08_10_v1";
const EXPECTED_DEAL_UNIVERSE_FINGERPRINT =
  "sha256:cd230039d61edae2785a03efc9384663a4133fe5cc73438e5ee1f7184a3d9536";
const EXPECTED_DEAL_UNIVERSE_MEMBERS = [
  "deal_100plus",
  "deal_1906",
  "deal_7bridges",
  "deal_a_champs",
  "deal_ably",
  "deal_acin",
  "deal_acquco",
  "deal_ada_health",
  "deal_alpha_builders",
  "deal_cascade_v1",
  "deal_centralize_v1",
  "deal_chipagents_v1",
  "deal_cordant_v1",
  "deal_coupro",
  "deal_empirical_security_v1",
  "deal_fellowtrip",
  "deal_freight_hero_v1",
  "deal_henry_ai_v1",
  "deal_humetric",
  "deal_hush_security_v1",
  "deal_indieshow",
  "deal_innformnest",
  "deal_intertwin_ai",
  "deal_irregular_v1",
  "deal_kanesh",
  "deal_mirror",
  "deal_sent_v1",
  "deal_silvermemory",
  "deal_smallest_ai_v1",
  "deal_unikudo",
] as const;

type MutablePinnedPackage = {
  snapshot: {
    snapshotAsOfDate: string;
    windowDays: number;
    anchorAt: string;
    windowStartAt: string;
    windowEndAt: string;
    windowTimezone: string;
    displayLabel: string;
  };
};

function mutablePinnedPackage(): MutablePinnedPackage {
  return structuredClone(
    loadPinnedThirtyDealSnapshotPackage(),
  ) as MutablePinnedPackage;
}

function mutableExactDealUniversePackage() {
  return structuredClone(
    loadPinnedThirtyDealSnapshotPackage(),
  ) as unknown as {
    dealUniverse: {
      members: Array<{
        dealId: string;
        companyId: string;
        status: string;
        activeSourceRevisionFingerprint: string;
      }>;
      memberFingerprint: string;
    };
  };
}

function parsePinnedPackageForNegativeTest(input: unknown): unknown {
  return parsePinnedThirtyDealSnapshotPackage(input);
}

async function seedLegacySnapshot(options: { now?: () => Date } = {}) {
  const sourceRegistry = createMemorySourceRegistry();
  const snapshots = createMemoryMarketEvidenceSnapshotsRepository(options);
  await runBeliefReversalDemoSeed({
    dataStore: createMemoryDemoDataStore(),
    objectStorage: createMemoryPrivateObjectStorage(),
    sourceRegistry,
    dealRegistry: createMemoryDealRegistry({ sourceRegistry }),
    evidencePacks: createMemoryEvidencePacksRepository(),
    marketEvidenceSnapshots: snapshots,
  });
  const legacy = await snapshots.get(
    "workspace_demo",
    APPROVED_PINNED_DEMO_SNAPSHOT_ID,
  );
  assert.ok(legacy);
  return { snapshots, legacy };
}

async function seedExactThirtyDealUniverse() {
  const sourceRegistry = createMemorySourceRegistry();
  const dealRegistry = createMemoryDealRegistry({ sourceRegistry });
  await backfillPreloadedSourceRegistry({
    workspaceId: "workspace_demo",
    assignedByUserId: "user_demo",
    sourceRegistry,
    dealRegistry,
  });
  await runBeliefReversalDemoSeed({
    dataStore: createMemoryDemoDataStore(),
    objectStorage: createMemoryPrivateObjectStorage(),
    sourceRegistry,
    dealRegistry,
    evidencePacks: createMemoryEvidencePacksRepository(),
    marketEvidenceSnapshots:
      createMemoryMarketEvidenceSnapshotsRepository(),
  });
  return (await dealRegistry.listForWorkspace("workspace_demo"))
    .filter(({ analysisEligibleAt }) => analysisEligibleAt !== null);
}

test("the pinned-30 package has a new immutable identity and an exact 30-analysis contract", () => {
  const sourcePackage = loadBeliefReversalManifest();
  const pinned = loadPinnedThirtyDealSnapshotPackage();

  assert.equal(pinned.packageId, PINNED_THIRTY_DEAL_PACKAGE_ID);
  assert.equal(pinned.sourceResearchPackageId, sourcePackage.packageId);
  assert.equal(pinned.legacySnapshot.snapshotId, APPROVED_PINNED_DEMO_SNAPSHOT_ID);
  assert.equal(pinned.legacySnapshot.expectedCompanyAnalysisCount, 23);
  assert.equal(pinned.legacySnapshot.mutationPolicy, "immutable_do_not_rewrite");
  assert.equal(pinned.snapshot.id, PINNED_THIRTY_DEAL_SNAPSHOT_ID);
  assert.notEqual(pinned.snapshot.id, APPROVED_PINNED_DEMO_SNAPSHOT_ID);
  assert.equal(pinned.snapshot.evidenceMode, "pinned");
  assert.equal(pinned.snapshot.windowDays, 14);
  assert.equal(pinned.snapshot.anchorAt, pinned.snapshot.windowEndAt);
  assert.equal(
    pinned.snapshot.eventSetFingerprint,
    EXPECTED_EVENT_SET_FINGERPRINT,
  );
  assert.equal(pinned.runContract.eligibleDealCount, 30);
  assert.equal(pinned.runContract.companyAnalysisCount, 30);
  assert.equal(
    pinned.runContract.dealUniversePolicy,
    "pinned_exact_member_snapshot",
  );
  assert.equal(
    pinned.runContract.underwritingAdmissionPolicy,
    "all_belief_revised",
  );
  assert.deepEqual(
    pinned.formalEvents.map(({ id, contentFingerprint }) => [
      id,
      contentFingerprint,
    ]),
    EXPECTED_EVENT_IDENTITIES,
  );
  assert.ok(Object.isFrozen(pinned));
  assert.ok(Object.isFrozen(pinned.formalEvents));
  assert.ok(Object.isFrozen(pinned.screeningDeals[0]));
});

test("the pinned-30 package persists the exact authoritative Deal-member universe", () => {
  const pinned = loadPinnedThirtyDealSnapshotPackage() as unknown as {
    dealUniverse?: {
      id: string;
      members: readonly {
        dealId: string;
        companyId: string;
        status: string;
        activeSourceRevisionFingerprint: string;
      }[];
      memberFingerprint: string;
    };
  };

  assert.ok(pinned.dealUniverse);
  assert.equal(pinned.dealUniverse.id, EXPECTED_DEAL_UNIVERSE_ID);
  assert.deepEqual(
    pinned.dealUniverse.members.map(({ dealId }) => dealId),
    EXPECTED_DEAL_UNIVERSE_MEMBERS,
  );
  assert.equal(pinned.dealUniverse.members.length, 30);
  assert.ok(pinned.dealUniverse.members.every((member) =>
    member.companyId.length > 0
    && member.status.length > 0
    && /^sha256:[0-9a-f]{64}$/u.test(
      member.activeSourceRevisionFingerprint,
    )
  ));
  assert.equal(
    pinned.dealUniverse.memberFingerprint,
    EXPECTED_DEAL_UNIVERSE_FINGERPRINT,
  );
});

test("the pinned-30 package rejects a swapped Deal member even when the count and fingerprint are self-consistent", () => {
  const input = mutableExactDealUniversePackage();
  input.dealUniverse.members[0]!.dealId = "deal_intruder_v1";
  input.dealUniverse.members.sort((left, right) =>
    left.dealId.localeCompare(right.dealId)
  );
  input.dealUniverse.memberFingerprint =
    "sha256:535fb96f46c91d724702de9bddcbc3fe025390b6abc95fb7911ecbaed00a372b";

  assert.throws(
    () => parsePinnedPackageForNegativeTest(input),
    /exact 30-Deal universe differs from its authoritative sources/iu,
  );
});

test("the pinned-30 package rejects a stale member fingerprint for the exact Deal set", () => {
  const input = mutableExactDealUniversePackage();
  input.dealUniverse.memberFingerprint = `sha256:${"0".repeat(64)}`;

  assert.throws(
    () => parsePinnedPackageForNegativeTest(input),
    /pinned-30 Deal-universe fingerprint is stale/iu,
  );
});

test("the pinned-30 package rejects a same-ID Source Revision drift with a self-consistent universe fingerprint", () => {
  const input = mutableExactDealUniversePackage();
  input.dealUniverse.members[0]!.activeSourceRevisionFingerprint =
    `sha256:${"f".repeat(64)}`;
  input.dealUniverse.memberFingerprint =
    "sha256:f57a8d942d1be3bc93a59a13a7ede8d8e8e7a68a6297045aa78501c8c6a490c1";

  assert.throws(
    () => parsePinnedPackageForNegativeTest(input),
    /exact 30-Deal universe differs from its authoritative sources/iu,
  );
});

test("the pinned-30 package rejects a same-ID status drift with a self-consistent universe fingerprint", () => {
  const input = mutableExactDealUniversePackage();
  input.dealUniverse.members[0]!.status = "watchlist";
  input.dealUniverse.memberFingerprint =
    "sha256:68e0cceb02b71402c4f023bad1c2e7dd002e22c30a92e2ca9ca66fea462c06ea";

  assert.throws(
    () => parsePinnedPackageForNegativeTest(input),
    /exact 30-Deal universe differs from its authoritative sources/iu,
  );
});

test("the pinned-30 Worker gate rejects same-ID Source Revision or status drift before binding", async () => {
  const deals = await seedExactThirtyDealUniverse();
  const assertExactUniverse = assertPinnedThirtyDealUniverse as unknown as
    (input: { snapshotId: string | null; deals: typeof deals }) => void;

  assert.doesNotThrow(() => assertExactUniverse({
    snapshotId: PINNED_THIRTY_DEAL_SNAPSHOT_ID,
    deals: [...deals].reverse(),
  }));
  const revisionDrift = structuredClone(deals);
  revisionDrift[0]!.activeSourceRevisionFingerprint =
    `sha256:${"f".repeat(64)}`;
  assert.throws(
    () => assertExactUniverse({
      snapshotId: PINNED_THIRTY_DEAL_SNAPSHOT_ID,
      deals: revisionDrift,
    }),
    /exact reviewed 30-Deal universe before binding/iu,
  );
  const statusDrift = structuredClone(deals);
  statusDrift[0]!.status = "watchlist";
  assert.throws(
    () => assertExactUniverse({
      snapshotId: PINNED_THIRTY_DEAL_SNAPSHOT_ID,
      deals: statusDrift,
    }),
    /exact reviewed 30-Deal universe before binding/iu,
  );
  assert.doesNotThrow(() => assertExactUniverse({
    snapshotId: null,
    deals: revisionDrift,
  }));
  assert.doesNotThrow(() => assertExactUniverse({
    snapshotId: APPROVED_PINNED_DEMO_SNAPSHOT_ID,
    deals: statusDrift,
  }));
});

test("the loader rejects date, window, or label drift from the authoritative 14-day source window", () => {
  const mutations: Array<{
    label: string;
    mutate: (input: MutablePinnedPackage) => void;
    error: RegExp;
  }> = [
    {
      label: "window start",
      mutate: (input) => {
        input.snapshot.windowStartAt = "2026-07-19T00:00:01-07:00";
      },
      error: /authoritative 14-day evidence window/iu,
    },
    {
      label: "window end and anchor",
      mutate: (input) => {
        input.snapshot.anchorAt = "2026-08-01T23:59:58-07:00";
        input.snapshot.windowEndAt = "2026-08-01T23:59:58-07:00";
      },
      error: /authoritative 14-day evidence window/iu,
    },
    {
      label: "snapshot date and matching label",
      mutate: (input) => {
        input.snapshot.snapshotAsOfDate = "2026-07-31";
        input.snapshot.displayLabel =
          "Demo evidence snapshot as of 2026-07-31";
      },
      error: /authoritative 14-day evidence window/iu,
    },
    {
      label: "display label",
      mutate: (input) => {
        input.snapshot.displayLabel =
          "Demo evidence snapshot as of 2026-08-01 (changed)";
      },
      error: /display label/iu,
    },
    {
      label: "window timezone",
      mutate: (input) => {
        input.snapshot.windowTimezone = "UTC";
      },
      error: /America\/Los_Angeles/iu,
    },
    {
      label: "window length",
      mutate: (input) => {
        input.snapshot.windowDays = 13;
      },
      error: /expected 14/iu,
    },
  ];

  for (const mutation of mutations) {
    const input = mutablePinnedPackage();
    mutation.mutate(input);
    assert.throws(
      () => parsePinnedPackageForNegativeTest(input),
      mutation.error,
      mutation.label,
    );
  }
});

test("all seven added Deals remain analysis-eligible research-only screening records", () => {
  const pinned = loadPinnedThirtyDealSnapshotPackage();

  assert.deepEqual(
    pinned.screeningDeals.map(({ companyName, dealId }) => [companyName, dealId]),
    EXPECTED_SCREENING_DEALS,
  );
  for (const screening of pinned.screeningDeals) {
    assert.equal(screening.dealStatus, "screening");
    assert.equal(screening.researchDisposition, "qualified_not_selected");
    assert.equal(screening.analysisEligible, true);
    assert.equal(screening.memoryScope, "research_only");
    assert.equal(screening.sampleLabel, "Sample research screening record");
    assert.equal(screening.historicalInteractionPolicy, "none");
    assert.equal(screening.formalDecisionAuthority, "not_gate_eligible");
    assert.equal("priorDecision" in screening, false);
    assert.equal("meetingSummary" in screening, false);
  }
});

test("the loader binds only the four exact source-package events into the new snapshot", async () => {
  const { legacy } = await seedLegacySnapshot();
  const request = buildPinnedThirtyDealSnapshotRequest({
    workspaceId: "workspace_demo",
    events: [...legacy.events].reverse(),
  });
  const secondWorkspaceRequest = buildPinnedThirtyDealSnapshotRequest({
    workspaceId: "workspace_review",
    events: legacy.events,
  });

  assert.equal(request.id, PINNED_THIRTY_DEAL_SNAPSHOT_ID);
  assert.notEqual(request.id, legacy.id);
  assert.equal(request.windowDays, 14);
  assert.equal(request.anchorAt, request.windowEndAt);
  assert.equal(secondWorkspaceRequest.workspaceId, "workspace_review");
  assert.deepEqual(secondWorkspaceRequest.events, request.events);
  assert.deepEqual(
    request.events.map(({ id, contentFingerprint }) => [id, contentFingerprint]),
    EXPECTED_EVENT_IDENTITIES,
  );
  assert.equal(
    CreateMarketEvidenceSnapshotRequestV1Schema.safeParse(request).success,
    true,
  );

  assert.throws(
    () => buildPinnedThirtyDealSnapshotRequest({
      workspaceId: "workspace_demo",
      events: legacy.events.slice(1),
    }),
    /exact four reviewed market events/iu,
  );
  assert.throws(
    () => buildPinnedThirtyDealSnapshotRequest({
      workspaceId: "workspace_demo",
      events: legacy.events.map((event, index) => index === 0
        ? {
            ...event,
            contentFingerprint: `sha256:${"f".repeat(64)}`,
          }
        : event),
    }),
    /event identity.*fingerprint/iu,
  );

  assert.throws(
    () => buildPinnedThirtyDealSnapshotRequest({
      workspaceId: "workspace_demo",
      events: legacy.events.map((event, index) => index === 0
        ? {
            ...event,
            summary: `${event.summary} Tampered after review.`,
          }
        : event),
    }),
    /canonical payload/iu,
  );
});

test("the new snapshot uses its own anchor indefinitely and coexists idempotently with pinned-23", async () => {
  const { snapshots, legacy } = await seedLegacySnapshot({
    now: () => new Date("2036-08-10T00:00:00.000Z"),
  });
  const legacyBefore = structuredClone(legacy);
  const request = buildPinnedThirtyDealSnapshotRequest({
    workspaceId: "workspace_demo",
    events: legacy.events,
  });

  const first = await snapshots.create(request);
  const replay = await snapshots.create(request);
  const readBack = await snapshots.get(
    "workspace_demo",
    PINNED_THIRTY_DEAL_SNAPSHOT_ID,
  );
  const legacyAfter = await snapshots.get(
    "workspace_demo",
    APPROVED_PINNED_DEMO_SNAPSHOT_ID,
  );

  assert.equal(first.id, PINNED_THIRTY_DEAL_SNAPSHOT_ID);
  assert.equal(first.anchorAt, first.windowEndAt);
  assert.equal(first.createdAt, "2036-08-10T00:00:00.000Z");
  assert.deepEqual(replay, first);
  assert.deepEqual(readBack, first);
  assert.equal(readBack?.eventCount, 4);
  assert.equal(readBack?.events.length, 4);
  assert.equal(new Set(readBack?.events.map(({ id }) => id)).size, 4);
  assert.deepEqual(readBack?.events, request.events);
  assert.notEqual(first.snapshotFingerprint, legacy.snapshotFingerprint);
  assert.deepEqual(legacyAfter, legacyBefore);
});
