import { createHash } from "node:crypto";

import { z } from "zod";

import manifest from "../../seed/belief-reversal/2026-08-10-pinned-30/manifest.json";
import {
  APPROVED_PINNED_DEMO_SNAPSHOT_ID,
  CreateMarketEvidenceSnapshotRequestV1Schema,
  type ParsedCreateMarketEvidenceSnapshotRequestV1,
} from "../contracts/evidence-context";
import {
  canonicalEvidenceJson,
  WritableMarketEventV2Schema,
  type WritableMarketEventV2,
} from "../contracts/source-evidence";
import { DealStatusSchema } from "../contracts/domain";
import { buildPreloadedDealMemoryBundles } from "../corpus/service";
import { DEMO_FIXTURES } from "../corpus/fixtures";
import { compareUtf8 } from "../format/canonical-order";
import { assertMarketEventFingerprint } from "../market/identity";
import { DEMO_DEAL_EVIDENCE } from "../corpus/evidence";
import { companyIdForDeal } from "../storage/service";
import {
  loadBeliefReversalManifest,
} from "./manifest";

export const PINNED_THIRTY_DEAL_PACKAGE_ID =
  "belief_reversal_pinned_30_2026_08_10_v1" as const;
export const PINNED_THIRTY_DEAL_SNAPSHOT_ID =
  "belief_reversal_pinned_30_2026_08_10_v1" as const;

const FingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const StableIdSchema = z.string().regex(
  /^[a-z0-9]+(?:_[a-z0-9]+)*_v\d+$/u,
);
const TimestampSchema = z.iso.datetime({ offset: true });
const DateSchema = z.iso.date();

const PinnedThirtyDealSnapshotPackageSchema = z.strictObject({
  schemaVersion: z.literal("belief-reversal-pinned-thirty-package-v1"),
  packageId: z.literal(PINNED_THIRTY_DEAL_PACKAGE_ID),
  version: z.string().regex(/^\d+\.\d+\.\d+$/u),
  usage: z.literal("test_and_review_only"),
  sourceResearchPackageId: z.literal("belief_reversal_2026_08_01"),
  legacySnapshot: z.strictObject({
    snapshotId: z.literal(APPROVED_PINNED_DEMO_SNAPSHOT_ID),
    expectedCompanyAnalysisCount: z.literal(23),
    mutationPolicy: z.literal("immutable_do_not_rewrite"),
  }),
  snapshot: z.strictObject({
    id: z.literal(PINNED_THIRTY_DEAL_SNAPSHOT_ID),
    evidenceMode: z.literal("pinned"),
    snapshotAsOfDate: DateSchema,
    windowDays: z.literal(14),
    anchorAt: TimestampSchema,
    windowStartAt: TimestampSchema,
    windowEndAt: TimestampSchema,
    windowTimezone: z.literal("America/Los_Angeles"),
    displayLabel: z.string().trim().min(1),
    eventSetFingerprint: FingerprintSchema,
  }),
  dealUniverse: z.strictObject({
    id: z.literal(
      "deal_universe_belief_reversal_pinned_30_2026_08_10_v1",
    ),
    members: z.array(z.strictObject({
      dealId: z.string().regex(/^deal_[a-z0-9_]+$/u),
      companyId: z.string().regex(/^company_[a-z0-9_]+$/u),
      status: DealStatusSchema,
      activeSourceRevisionFingerprint: FingerprintSchema,
    })).length(30),
    memberFingerprint: FingerprintSchema,
  }),
  runContract: z.strictObject({
    eligibleDealCount: z.literal(30),
    companyAnalysisCount: z.literal(30),
    dealUniversePolicy: z.literal("pinned_exact_member_snapshot"),
    underwritingAdmissionPolicy: z.literal("all_belief_revised"),
  }),
  formalEvents: z.array(z.strictObject({
    id: StableIdSchema,
    caseId: StableIdSchema,
    dealId: StableIdSchema,
    contentFingerprint: FingerprintSchema,
    authority: z.literal("public_evidence"),
  })).length(4),
  screeningDeals: z.array(z.strictObject({
    companyName: z.string().trim().min(1),
    dealId: StableIdSchema,
    dealStatus: z.literal("screening"),
    researchDisposition: z.literal("qualified_not_selected"),
    analysisEligible: z.literal(true),
    memoryScope: z.literal("research_only"),
    sampleLabel: z.literal("Sample research screening record"),
    historicalInteractionPolicy: z.literal("none"),
    formalDecisionAuthority: z.literal("not_gate_eligible"),
  })).length(7),
}).superRefine((pinned, context) => {
  if (pinned.snapshot.anchorAt !== pinned.snapshot.windowEndAt) {
    context.addIssue({
      code: "custom",
      message: "The pinned-30 anchor must equal its immutable window end.",
    });
  }
  if (
    pinned.snapshot.displayLabel
      !== `Demo evidence snapshot as of ${pinned.snapshot.snapshotAsOfDate}`
  ) {
    context.addIssue({
      code: "custom",
      message: "The pinned-30 display label must match its snapshot date.",
    });
  }
  if (String(pinned.snapshot.id) === pinned.legacySnapshot.snapshotId) {
    context.addIssue({
      code: "custom",
      message: "The pinned-30 snapshot cannot reuse the immutable legacy identity.",
    });
  }
  for (const [label, values] of [
    ["formal event", pinned.formalEvents.map(({ id }) => id)],
    ["screening Deal", pinned.screeningDeals.map(({ dealId }) => dealId)],
    ["Deal-universe member", pinned.dealUniverse.members.map(({ dealId }) =>
      dealId
    )],
  ] as const) {
    if (
      new Set(values).size !== values.length
      || values.some((value, index) =>
        index > 0 && compareUtf8(values[index - 1]!, value) >= 0
      )
    ) {
      context.addIssue({
        code: "custom",
        message: `The pinned-30 ${label} identities must be unique and sorted.`,
      });
    }
  }
  const companyNames = pinned.screeningDeals.map(({ companyName }) => companyName);
  if (
    new Set(companyNames).size !== companyNames.length
    || companyNames.some((name, index) =>
      index > 0 && compareUtf8(companyNames[index - 1]!, name) >= 0
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "The pinned-30 screening company names must be unique and sorted.",
    });
  }
});

type MutablePinnedThirtyDealSnapshotPackage = z.infer<
  typeof PinnedThirtyDealSnapshotPackageSchema
>;

export type PinnedThirtyDealSnapshotPackage = DeepReadonly<
  MutablePinnedThirtyDealSnapshotPackage
>;

type DeepReadonly<T> = T extends (...args: never[]) => unknown ? T
  : T extends readonly (infer U)[] ? readonly DeepReadonly<U>[]
    : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

const pinnedPackage = parsePinnedThirtyDealSnapshotPackage(manifest);

export function loadPinnedThirtyDealSnapshotPackage():
  PinnedThirtyDealSnapshotPackage {
  return pinnedPackage;
}

export function buildPinnedThirtyDealSnapshotRequest(input: {
  workspaceId: string;
  events: readonly WritableMarketEventV2[];
}): ParsedCreateMarketEvidenceSnapshotRequestV1 {
  const events = input.events.map((event) => {
    const parsed = WritableMarketEventV2Schema.parse(event);
    try {
      return assertMarketEventFingerprint(parsed);
    } catch {
      throw new Error(
        `Pinned-30 event identity ${parsed.id} has a fingerprint that does not match its canonical payload.`,
      );
    }
  });
  const expected = new Map(pinnedPackage.formalEvents.map((event) => [
    event.id,
    event.contentFingerprint,
  ]));
  if (
    events.length !== expected.size
    || new Set(events.map(({ id }) => id)).size !== expected.size
    || events.some(({ id }) => !expected.has(id))
  ) {
    throw new Error(
      "The pinned-30 package requires the exact four reviewed market events.",
    );
  }
  for (const event of events) {
    if (expected.get(event.id) !== event.contentFingerprint) {
      throw new Error(
        `Pinned-30 event identity ${event.id} does not match its reviewed fingerprint.`,
      );
    }
  }
  if (
    eventSetFingerprint(events)
      !== pinnedPackage.snapshot.eventSetFingerprint
  ) {
    throw new Error(
      "The pinned-30 event set does not match its reviewed package fingerprint.",
    );
  }
  return CreateMarketEvidenceSnapshotRequestV1Schema.parse({
    schemaVersion: "market-evidence-snapshot-v1",
    workspaceId: input.workspaceId,
    id: pinnedPackage.snapshot.id,
    snapshotAsOfDate: pinnedPackage.snapshot.snapshotAsOfDate,
    windowDays: pinnedPackage.snapshot.windowDays,
    anchorAt: pinnedPackage.snapshot.anchorAt,
    windowStartAt: pinnedPackage.snapshot.windowStartAt,
    windowEndAt: pinnedPackage.snapshot.windowEndAt,
    windowTimezone: pinnedPackage.snapshot.windowTimezone,
    events,
  });
}

export function assertPinnedThirtyDealUniverse(input: {
  snapshotId: string | null;
  deals: readonly {
    id: string;
    companyId: string;
    status: z.infer<typeof DealStatusSchema>;
    activeSourceRevisionFingerprint: string | null;
  }[];
}): void {
  if (input.snapshotId !== PINNED_THIRTY_DEAL_SNAPSHOT_ID) return;
  const members = input.deals.map((deal) => ({
    dealId: deal.id,
    companyId: deal.companyId,
    status: deal.status,
    activeSourceRevisionFingerprint:
      deal.activeSourceRevisionFingerprint ?? "",
  })).sort((left, right) => compareUtf8(left.dealId, right.dealId));
  if (
    new Set(members.map(({ dealId }) => dealId)).size !== members.length
    || canonicalEvidenceJson(members)
      !== canonicalEvidenceJson(pinnedPackage.dealUniverse.members)
    || dealUniverseMemberFingerprint({
      universeId: pinnedPackage.dealUniverse.id,
      members,
    }) !== pinnedPackage.dealUniverse.memberFingerprint
  ) {
    throw new Error(
      "The pinned-30 run requires its exact reviewed 30-Deal universe before binding.",
    );
  }
}

export function parsePinnedThirtyDealSnapshotPackage(
  input: unknown,
): PinnedThirtyDealSnapshotPackage {
  const pinned = PinnedThirtyDealSnapshotPackageSchema.parse(input);
  const source = loadBeliefReversalManifest();
  if (source.packageId !== pinned.sourceResearchPackageId) {
    throw new Error("The pinned-30 package lost its exact source package.");
  }
  if (
    source.researchIntegrationContract.analysisEligibleDealCount
      !== pinned.runContract.eligibleDealCount
    || source.researchIntegrationContract.completedScanCompanyAnalysisCount
      !== pinned.runContract.companyAnalysisCount
  ) {
    throw new Error("The pinned-30 run counts differ from the source package.");
  }
  const sourceDealUniverse = authoritativeDealUniverseMembers(source);
  if (
    sourceDealUniverse.length !== pinned.runContract.eligibleDealCount
    || new Set(sourceDealUniverse.map(({ dealId }) => dealId)).size
      !== sourceDealUniverse.length
    || canonicalEvidenceJson(sourceDealUniverse)
      !== canonicalEvidenceJson(pinned.dealUniverse.members)
  ) {
    throw new Error(
      "The pinned-30 exact 30-Deal universe differs from its authoritative sources.",
    );
  }
  if (
    dealUniverseMemberFingerprint({
      universeId: pinned.dealUniverse.id,
      members: pinned.dealUniverse.members,
    }) !== pinned.dealUniverse.memberFingerprint
  ) {
    throw new Error("The pinned-30 Deal-universe fingerprint is stale.");
  }
  const expectedTemporalContract = {
    snapshotAsOfDate: source.evidenceWindow.endAt.slice(0, 10),
    windowDays: 14,
    anchorAt: source.evidenceWindow.endAt,
    windowStartAt: source.evidenceWindow.startAt,
    windowEndAt: source.evidenceWindow.endAt,
    windowTimezone: source.evidenceWindow.timezone,
    displayLabel: source.evidenceWindow.displayLabel,
  };
  const actualTemporalContract = {
    snapshotAsOfDate: pinned.snapshot.snapshotAsOfDate,
    windowDays: pinned.snapshot.windowDays,
    anchorAt: pinned.snapshot.anchorAt,
    windowStartAt: pinned.snapshot.windowStartAt,
    windowEndAt: pinned.snapshot.windowEndAt,
    windowTimezone: pinned.snapshot.windowTimezone,
    displayLabel: pinned.snapshot.displayLabel,
  };
  const sourceStartDay = Date.parse(
    `${source.evidenceWindow.startAt.slice(0, 10)}T00:00:00.000Z`,
  );
  const sourceEndDay = Date.parse(
    `${source.evidenceWindow.endAt.slice(0, 10)}T00:00:00.000Z`,
  );
  const sourceCalendarDays =
    (sourceEndDay - sourceStartDay) / (24 * 60 * 60 * 1_000) + 1;
  if (
    sourceCalendarDays !== pinned.snapshot.windowDays
    || canonicalEvidenceJson(actualTemporalContract)
      !== canonicalEvidenceJson(expectedTemporalContract)
  ) {
    throw new Error(
      "The pinned-30 temporal contract differs from the authoritative 14-day evidence window.",
    );
  }
  const sourceEvents = source.selectedCases.flatMap((selectedCase) =>
    selectedCase.events.map((event) => ({
      id: event.id,
      caseId: selectedCase.id,
      dealId: selectedCase.dealId,
    }))
  ).sort((left, right) => compareUtf8(left.id, right.id));
  const pinnedEvents = pinned.formalEvents.map(({ id, caseId, dealId }) => ({
    id,
    caseId,
    dealId,
  }));
  if (JSON.stringify(sourceEvents) !== JSON.stringify(pinnedEvents)) {
    throw new Error("The pinned-30 formal event inventory differs from its source package.");
  }
  const sourceScreeningDeals = source.candidateLedger.flatMap((candidate) =>
    candidate.disposition === "qualified_not_selected"
      ? [{
          companyName: candidate.companyIdentity.brandName,
          dealId: candidate.stableDealId,
        }]
      : []
  ).sort((left, right) => compareUtf8(left.companyName, right.companyName));
  const pinnedScreeningDeals = pinned.screeningDeals.map(
    ({ companyName, dealId }) => ({ companyName, dealId }),
  );
  if (
    JSON.stringify(sourceScreeningDeals)
      !== JSON.stringify(pinnedScreeningDeals)
  ) {
    throw new Error(
      "The pinned-30 screening Deal inventory differs from its source package.",
    );
  }
  return deepFreeze(pinned);
}

function eventSetFingerprint(
  events: readonly WritableMarketEventV2[],
): string {
  const sortedEvents = [...events].sort((left, right) =>
    compareUtf8(left.id, right.id)
    || compareUtf8(canonicalEvidenceJson(left), canonicalEvidenceJson(right))
  );
  const hash = createHash("sha256");
  for (const frame of [
    "run-event-set-v1",
    ...sortedEvents.map(canonicalEvidenceJson),
  ]) {
    const bytes = Buffer.from(frame, "utf8");
    hash.update(String(bytes.length));
    hash.update(":");
    hash.update(bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}

function dealUniverseMemberFingerprint(input: {
  universeId: string;
  members: readonly {
    dealId: string;
    companyId: string;
    status: string;
    activeSourceRevisionFingerprint: string;
  }[];
}): string {
  const hash = createHash("sha256");
  for (const frame of [
    "pinned-deal-universe-members-v1",
    input.universeId,
    ...input.members.flatMap((member) => [
      member.dealId,
      member.companyId,
      member.status,
      member.activeSourceRevisionFingerprint,
    ]),
  ]) {
    const bytes = Buffer.from(frame, "utf8");
    hash.update(String(bytes.length));
    hash.update(":");
    hash.update(bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}

function authoritativeDealUniverseMembers(
  source: ReturnType<typeof loadBeliefReversalManifest>,
) {
  const revisionId = (sourceId: string) => `source_revision_${sourceId}_1`;
  const members = buildPreloadedDealMemoryBundles().map((bundle) => ({
    dealId: bundle.dealId,
    companyId: companyIdForDeal(bundle.dealId),
    status: bundle.status,
    activeSourceRevisionFingerprint: sourceRevisionSetFingerprint(
      [...DEMO_DEAL_EVIDENCE, ...DEMO_FIXTURES]
        .filter(({ dealId }) => dealId === bundle.dealId)
        .map(({ documentId }) => revisionId(documentId)),
    ),
  }));
  for (const selectedCase of source.selectedCases) {
    members.push({
      dealId: selectedCase.dealId,
      companyId: selectedCase.companyId,
      status: selectedCase.priorDecision.status,
      activeSourceRevisionFingerprint: sourceRevisionSetFingerprint([
        ...selectedCase.sources.map(({ id }) => revisionId(id)),
        revisionId(`source_${selectedCase.priorDecision.id}`),
      ]),
    });
  }
  for (const candidate of source.candidateLedger) {
    if (candidate.disposition !== "qualified_not_selected") continue;
    const resolvedSourceIds = source.screeningSources
      .filter((screeningSource) =>
        candidate.screeningSourceIds.includes(screeningSource.id)
        && screeningSource.status === "resolved"
      )
      .map(({ id }) => id);
    members.push({
      dealId: candidate.stableDealId,
      companyId: candidate.companyId,
      status: candidate.dealStatus,
      activeSourceRevisionFingerprint: sourceRevisionSetFingerprint([
        ...resolvedSourceIds.map(revisionId),
        revisionId(`source_${candidate.sampleResearchScreeningRecordId}`),
      ]),
    });
  }
  return members.sort((left, right) => compareUtf8(left.dealId, right.dealId));
}

function sourceRevisionSetFingerprint(revisionIds: readonly string[]): string {
  const uniqueRevisionIds = [...new Set(revisionIds)].sort(compareUtf8);
  const hash = createHash("sha256");
  for (const frame of ["source-revisions-v2", ...uniqueRevisionIds]) {
    const bytes = Buffer.from(frame, "utf8");
    hash.update(String(bytes.length));
    hash.update(":");
    hash.update(bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
