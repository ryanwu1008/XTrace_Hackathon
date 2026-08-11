import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  DealFactSchema,
  DealMemoryBundleSchema,
  DealStatusSchema,
  BeliefActionKindSchema,
  SampleDecisionStatusSchema,
  type DealMemoryBundle,
  type DealStatus,
} from "../../lib/contracts/domain";
import {
  IntegrationTransportError,
  isRetryableTransportStatus,
} from "../../lib/api/errors";
import type {
  SourceRegistry,
  SourceRevision,
} from "./source-registry";
import {
  createMemorySourceRegistry,
  getSourceRegistry,
} from "./source-registry";
import {
  structuredImageDealFact,
  type CanonicalStructuredImageEvidence,
} from "../../lib/uploads/structured-image-evidence";
import {
  assertConsistentCanonicalEvidenceUnits,
  SAMPLE_DECISION_RECORD_LABEL,
  WritableSourceRefV2Schema,
  sourceTextForRetrieval,
} from "../../lib/contracts/source-evidence";
import { metadataForBeliefActionKind } from "../../lib/reports/action-policy";
import { buildSampleDecisionSourceRef } from "../../lib/belief-reversal/sample-decision-source";
import { SAMPLE_RESEARCH_SCREENING_RECORD_LABEL } from "../../lib/contracts/research-candidate";

export interface RegisteredDeal {
  id: string;
  workspaceId: string;
  companyId: string;
  companyName: string;
  status: DealStatus;
  analysisEligibleAt: string | null;
  activeSourceRevisionFingerprint: string | null;
  activeSourceRevisionIds: string[];
}

export interface DealUniverseMemberV1 {
  ordinal: number;
  dealId: string;
  companyId: string;
  dealStatus: DealStatus;
  analysisEligibleAt: string;
}

export interface BindRunDealUniverseInputV1 {
  workspaceId: string;
  runId: string;
  universeId: string;
  mode: "live" | "pinned";
  anchorAt: string;
  evidenceSnapshotId: string | null;
  evidenceSnapshotFingerprint: string | null;
  members: DealUniverseMemberV1[];
}

export interface RunDealUniverseBindingV1
  extends BindRunDealUniverseInputV1 {
  schemaVersion: "run-deal-universe-binding-v1";
  universeFingerprint: string;
  dealCount: number;
}

export interface ConfirmSourceAssignmentInput {
  requestId: string;
  workspaceId: string;
  dealId: string;
  companyId: string;
  companyName: string;
  status: DealStatus;
  sourceRevisionId: string;
  assignedByUserId: string;
  reason: string;
  confirmedAt: string;
  memoryBundle?: DealMemoryBundle;
  memoryLineage?: DealMemoryLineage;
}

export interface DealMemoryOwnership {
  workspaceId: string;
  dealId: string;
  sourceId: string;
  sourceRevisionId: string;
}

export interface DealMemoryLineage {
  evidence: Record<string, DealMemoryOwnership>;
  interactions: Record<string, DealMemoryOwnership>;
}

export interface ExactSourceMemoryBundle extends DealMemoryOwnership {
  bundle: DealMemoryBundle;
}

export interface DealSourceAssignment {
  id: string;
  requestId: string;
  requestFingerprint: string;
  workspaceId: string;
  dealId: string;
  sourceId: string;
  sourceRevisionId: string;
  assignedByUserId: string;
  reason: string;
  createdAt: string;
  supersededAt: string | null;
}

export interface DealRegistry {
  bindRunDealUniverse(
    input: BindRunDealUniverseInputV1,
  ): Promise<RunDealUniverseBindingV1>;
  getRunDealUniverse(input: {
    workspaceId: string;
    runId: string;
  }): Promise<RunDealUniverseBindingV1 | null>;
  getAnalysisEligibleSnapshot(
    workspaceId: string,
  ): Promise<AnalysisEligibleSnapshot>;
  listAnalysisEligibleBundles(workspaceId: string): Promise<DealMemoryBundle[]>;
  getExactSourceBundle(input: DealMemoryOwnership): Promise<
    ExactSourceMemoryBundle | null
  >;
  findForWorkspace(input: {
    workspaceId: string;
    dealId: string;
  }): Promise<RegisteredDeal | null>;
  listForWorkspace(workspaceId: string): Promise<RegisteredDeal[]>;
  listActiveSourceAssignments(
    workspaceId: string,
  ): Promise<DealMemoryOwnership[]>;
  confirmSourceAssignment(
    input: ConfirmSourceAssignmentInput,
  ): Promise<{
    deal: RegisteredDeal;
    sourceRevision: SourceRevision;
    newlyEligible: boolean;
  }>;
}

export interface AnalysisEligibleSnapshot {
  count: number;
  dealIds: string[];
  fingerprint: string;
}

export interface MemoryDealRegistry extends DealRegistry {
  capturePromotionState(scope: MemoryDealPromotionScope): unknown;
  restorePromotionState(before: unknown, expected: unknown): void;
  withPromotionLock<T>(
    scope: { workspaceId: string; dealId: string },
    operation: (
      confirmSourceAssignment: DealRegistry["confirmSourceAssignment"],
    ) => Promise<T>,
  ): Promise<T>;
  usesSourceRegistry(registry: SourceRegistry): boolean;
  inspect(): {
    deals: RegisteredDeal[];
    assignments: DealSourceAssignment[];
    externalEffects: string[];
  };
}

export interface MemoryDealPromotionScope extends DealMemoryOwnership {
  companyId: string;
  requestId: string;
}

type InternalMemoryDealRegistry =
  & Omit<MemoryDealRegistry, "confirmSourceAssignment">
  & {
    confirmSourceAssignmentUnlocked:
      DealRegistry["confirmSourceAssignment"];
  };

function requiredText(value: string, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function requiredWorkspaceId(workspaceId: string): string {
  return requiredText(workspaceId, "A workspace");
}

function identity(workspaceId: string, externalId: string): string {
  return JSON.stringify([requiredWorkspaceId(workspaceId), externalId]);
}

function requiredIsoDateTime(value: string, label: string): string {
  const normalized = requiredText(value, label);
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new Error(`${label} must be an ISO date-time.`);
  }
  return new Date(normalized).toISOString();
}

function validateConfirmation(
  input: ConfirmSourceAssignmentInput,
): ConfirmSourceAssignmentInput {
  const candidate = {
    ...input,
    requestId: requiredText(input.requestId, "A confirmation request id"),
    workspaceId: requiredWorkspaceId(input.workspaceId),
    dealId: requiredText(input.dealId, "A Deal id"),
    companyId: requiredText(input.companyId, "A company id"),
    companyName: requiredText(input.companyName, "A company name"),
    status: DealStatusSchema.parse(input.status),
    sourceRevisionId: requiredText(
      input.sourceRevisionId,
      "A source revision id",
    ),
    assignedByUserId: requiredText(
      input.assignedByUserId,
      "An assigning user id",
    ),
    reason: requiredText(input.reason, "An assignment reason"),
    confirmedAt: requiredIsoDateTime(
      input.confirmedAt,
      "A confirmation time",
    ),
  };
  if (candidate.memoryBundle) {
    const memoryBundle = DealMemoryBundleSchema.parse(candidate.memoryBundle);
    if (
      memoryBundle.dealId !== candidate.dealId
      || memoryBundle.companyName !== candidate.companyName
      || memoryBundle.status !== candidate.status
    ) {
      throw new Error(
        "The Deal memory bundle must match the confirmed Deal identity.",
      );
    }
    candidate.memoryBundle = memoryBundle;
  }
  return candidate;
}

function validateMemoryOwnership(
  input: DealMemoryOwnership,
): DealMemoryOwnership {
  return {
    workspaceId: requiredWorkspaceId(input.workspaceId),
    dealId: requiredText(input.dealId, "A Deal id"),
    sourceId: requiredText(input.sourceId, "A source id"),
    sourceRevisionId: requiredText(
      input.sourceRevisionId,
      "A source revision id",
    ),
  };
}

function exactSourceIdentity(input: DealMemoryOwnership): string {
  return JSON.stringify([
    input.workspaceId,
    input.dealId,
    input.sourceId,
    input.sourceRevisionId,
  ]);
}

function exactSourceBundlesFromConfirmation(
  bundle: DealMemoryBundle,
  lineage: DealMemoryLineage,
): ExactSourceMemoryBundle[] {
  const grouped = new Map<string, {
    ownership: DealMemoryOwnership;
    facts: DealMemoryBundle["facts"];
    interactions: DealMemoryBundle["interactions"];
  }>();
  const groupFor = (ownership: DealMemoryOwnership) => {
    const normalized = validateMemoryOwnership(ownership);
    const key = exactSourceIdentity(normalized);
    const existing = grouped.get(key);
    if (existing) return existing;
    const created = {
      ownership: normalized,
      facts: [],
      interactions: [],
    };
    grouped.set(key, created);
    return created;
  };
  for (const fact of bundle.facts) {
    const sourcesByOwner = new Map<string, typeof fact.sources>();
    for (const source of fact.sources) {
      const ownership = lineage.evidence[source.id];
      if (!ownership) continue;
      const key = exactSourceIdentity(validateMemoryOwnership(ownership));
      const sources = sourcesByOwner.get(key) ?? [];
      sources.push(structuredClone(source));
      sourcesByOwner.set(key, sources);
    }
    for (const [key, sources] of sourcesByOwner) {
      const ownership = lineage.evidence[sources[0].id];
      const group = grouped.get(key) ?? groupFor(ownership);
      group.facts.push({ ...structuredClone(fact), sources });
    }
  }
  for (const interaction of bundle.interactions) {
    const ownership = lineage.interactions[interaction.id];
    if (ownership) {
      groupFor(ownership).interactions.push(structuredClone(interaction));
    }
  }
  return [...grouped.values()].map((group) => ({
    ...group.ownership,
    bundle: DealMemoryBundleSchema.parse({
      ...bundle,
      facts: group.facts,
      interactions: group.interactions,
    }),
  }));
}

export function sourceRevisionFingerprint(
  revisionIds: readonly string[],
): string {
  const sorted = [...new Set(revisionIds)].sort(compareUtf8);
  return sha256(lengthFrame(["source-revisions-v2", ...sorted]));
}

export function eligibleDealSnapshotFingerprint(
  deals: readonly RegisteredDeal[],
): string {
  const frames = deals
    .map((deal) => [
      deal.id,
      deal.status,
      deal.activeSourceRevisionFingerprint ?? "",
    ] as const)
    .sort((left, right) => compareUtf8(left[0], right[0]))
    .flatMap((pair) => pair);
  return sha256(lengthFrame(["eligible-deals-v2", ...frames]));
}

function validateDealUniverseInput(
  input: BindRunDealUniverseInputV1,
): BindRunDealUniverseInputV1 {
  const candidate = structuredClone(input);
  candidate.workspaceId = requiredWorkspaceId(candidate.workspaceId);
  candidate.runId = requiredText(candidate.runId, "A run id");
  candidate.universeId = requiredText(candidate.universeId, "A universe id");
  candidate.anchorAt = requiredIsoDateTime(candidate.anchorAt, "A universe anchor");
  if (candidate.mode !== "live" && candidate.mode !== "pinned") {
    throw new Error("A Deal universe requires a live or pinned mode.");
  }
  const pinned = candidate.mode === "pinned";
  if (
    pinned !== (candidate.evidenceSnapshotId !== null)
    || pinned !== (candidate.evidenceSnapshotFingerprint !== null)
    || (candidate.evidenceSnapshotFingerprint !== null
      && !/^sha256:[0-9a-f]{64}$/u.test(
        candidate.evidenceSnapshotFingerprint,
      ))
  ) {
    throw new Error("A Deal universe has an invalid evidence snapshot binding.");
  }
  if (candidate.members.length === 0) {
    throw new Error("A Deal universe requires at least one member.");
  }
  const dealIds = new Set<string>();
  for (const [index, member] of candidate.members.entries()) {
    if (
      member.ordinal !== index
      || !member.dealId.trim()
      || !member.companyId.trim()
      || !DealStatusSchema.safeParse(member.dealStatus).success
      || !Number.isFinite(Date.parse(member.analysisEligibleAt))
      || dealIds.has(member.dealId)
    ) {
      throw new Error("Deal-universe members are malformed or duplicated.");
    }
    dealIds.add(member.dealId);
  }
  return candidate;
}

function dealUniverseFingerprint(input: BindRunDealUniverseInputV1): string {
  return sha256(lengthFrame([
    "deal-universe-snapshot-v1",
    input.workspaceId,
    input.universeId,
    input.mode,
    input.anchorAt,
    input.evidenceSnapshotId ?? "",
    input.evidenceSnapshotFingerprint ?? "",
    ...input.members.flatMap((member) => [
      String(member.ordinal),
      member.dealId,
      member.companyId,
      member.dealStatus,
      member.analysisEligibleAt,
    ]),
  ]));
}

function canonicalDealUniverse(binding: RunDealUniverseBindingV1): string {
  return JSON.stringify(binding);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function lengthFrame(values: readonly string[]): string {
  return values.map((value) => `${Buffer.byteLength(value, "utf8")}:${value}`)
    .join("");
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function canonicalDealFactFromRow(input: {
  row: Record<string, unknown>;
  expectedWorkspaceId: string;
  expectedDealId: string;
  activeAssignments: ReadonlySet<string>;
  titleForSource(sourceId: string): string;
  roleForSource(sourceId: string): string | null;
  revisionForId(revisionId: string): {
    workspaceId: string;
    sourceId: string;
    contentHash: string;
  } | null;
}) {
  const payload = input.row.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(
      "Canonical image evidence payload does not preserve exact identity.",
    );
  }
  const item = payload as Record<string, unknown>;
  const rowIdentity = {
    workspaceId: String(input.row.workspace_id ?? ""),
    id: String(input.row.evidence_id ?? ""),
    dealId: String(input.row.deal_id ?? ""),
    sourceId: String(input.row.source_id ?? ""),
    sourceRevisionId: String(input.row.source_revision_id ?? ""),
  };
  if (
    rowIdentity.workspaceId !== input.expectedWorkspaceId
    || rowIdentity.dealId !== input.expectedDealId
    || String(item.workspaceId ?? "") !== rowIdentity.workspaceId
    || String(item.id ?? "") !== rowIdentity.id
    || String(item.dealId ?? "") !== rowIdentity.dealId
    || String(item.sourceId ?? "") !== rowIdentity.sourceId
    || String(item.sourceRevisionId ?? "") !== rowIdentity.sourceRevisionId
    || !input.activeAssignments.has(JSON.stringify([
      rowIdentity.sourceId,
      rowIdentity.sourceRevisionId,
    ]))
  ) {
    throw new Error(
      "Canonical image evidence does not preserve exact source identity.",
    );
  }
  if (item.sourceRef !== undefined) {
    const source = WritableSourceRefV2Schema.parse(item.sourceRef);
    const revision = input.revisionForId(rowIdentity.sourceRevisionId);
    const documentRole = input.roleForSource(rowIdentity.sourceId);
    const sourceLocator = source.locator;
    const commonIdentityHasDrift =
      source.id !== rowIdentity.id
      || source.documentId !== rowIdentity.sourceId
      || source.sourceRevisionId !== rowIdentity.sourceRevisionId
      || source.title !== input.titleForSource(rowIdentity.sourceId)
      || revision?.workspaceId !== rowIdentity.workspaceId
      || revision.sourceId !== rowIdentity.sourceId
      || revision.contentHash !== source.contentFingerprint
      || typeof item.value !== "string"
      || item.value.trim() === ""
      || sourceTextForRetrieval(source) !== item.value;
    const isCanonicalPublicWeb =
      source.provenance === "public_web"
      && documentRole === "public_web_snapshot";
    const isCanonicalSampleResearch =
      source.provenance === "source_document"
      && documentRole === "sample_research_screening_record"
      && source.title === SAMPLE_RESEARCH_SCREENING_RECORD_LABEL
      && source.documentId === `source_${source.id}`
      && source.canonicalUrl === null
      && source.publisher === "Internal Research Registry"
      && source.providerId === "belief-reversal-research-seed-v1"
      && source.eventAt !== null
      && source.eventAtPrecision === "timestamp"
      && source.publishedAt === null
      && source.publishedAtPrecision === null
      && source.retrievedAt === source.eventAt
      && source.retrievedAtPrecision === "timestamp"
      && source.sourceClass === "internal_decision_record"
      && source.sourceAuthority === "primary"
      && source.evidenceRole === "context"
      && sourceLocator?.kind === "json_pointer"
      && sourceLocator.pointer === "/record"
      && source.text.status === "normalized_only"
      && source.text.normalizedStatement.startsWith(
        `${SAMPLE_RESEARCH_SCREENING_RECORD_LABEL}. Synthetic research-only context; no meeting or VC interaction occurred.`,
      )
      && item.provenanceOrigin === "uploaded_document"
      && item.field === "research_disposition_context"
      && item.verificationMethod
        === "synthetic_research_screening_record_v1"
      && item.acceptedForGate === false;
    const isCanonicalSampleDecision =
      source.provenance === "demo_fixture"
      && documentRole === "sample_decision_record"
      && source.title === SAMPLE_DECISION_RECORD_LABEL
      && source.canonicalUrl === null
      && source.publisher === "Internal Deal Registry"
      && source.providerId === "deal-registry"
      && source.entityKeys.length === 0
      && source.sourceClass === "internal_decision_record"
      && source.sourceAuthority === "primary"
      && source.evidenceRole === "context"
      && sourceLocator?.kind === "json_pointer"
      && sourceLocator.pointer === "/priorDecision"
      && source.text.status === "normalized_only"
      && source.text.normalizedStatement.startsWith(
        `${SAMPLE_DECISION_RECORD_LABEL}. `,
      )
      && item.provenanceOrigin === "demo_fixture"
      && item.field === "sample_decision_context"
      && item.unit === null
      && item.currency === null
      && item.periodStart === null
      && item.periodEnd === null
      && item.publishedAt === null
      && item.eventAt === source.eventAt
      && item.retrievedAt === source.retrievedAt
      && item.sourceRole === "management"
      && item.assertionStatus === "reported"
      && item.verificationMethod === "synthetic_sample_decision_record_v1"
      && item.acceptedForGate === false;
    if (
      commonIdentityHasDrift
      || (
        !isCanonicalPublicWeb
        && !isCanonicalSampleResearch
        && !isCanonicalSampleDecision
      )
    ) {
      throw new Error(
        documentRole === "sample_research_screening_record"
          ? "Canonical Sample research screening evidence does not preserve its permanent non-interaction and non-gating identity."
          : documentRole === "sample_decision_record"
            ? "Canonical Sample decision evidence does not preserve its permanent synthetic and non-gating identity."
            : "Canonical public-web evidence does not preserve exact source identity and reviewed text.",
      );
    }
    return {
      text: item.value,
      sources: [source],
      ...(item.semanticFields === undefined
        ? {}
        : {
            semanticFields: DealFactSchema.shape.semanticFields.unwrap()
              .parse(item.semanticFields),
          }),
    };
  }
  const evidence: CanonicalStructuredImageEvidence = {
    ...rowIdentity,
    provenanceOrigin: String(item.provenanceOrigin ?? ""),
    field: String(item.field ?? ""),
    value: String(item.value ?? ""),
    unit: typeof item.unit === "string" ? item.unit : null,
    currency: typeof item.currency === "string" ? item.currency : null,
    locator: item.locator,
    acceptedForGate: item.acceptedForGate === true,
  };
  return structuredImageDealFact({
    evidence,
    title: input.titleForSource(evidence.sourceId),
  });
}

function dealInteractionFromRow(input: {
  row: Record<string, unknown>;
  expectedStatus: DealStatus;
  documentRole: string | null;
  revision: {
    workspaceId: string;
    sourceId: string;
    contentHash: string;
    extractedAt: string;
  } | null;
}) {
  const occurredAt = requiredIsoDateTime(
    String(input.row.occurred_at),
    "An interaction occurrence time",
  );
  const base = {
    id: String(input.row.id),
    occurredAt,
    summary: String(input.row.meeting_summary),
    decisionReason: String(input.row.decision_reason),
    concerns: input.row.concerns,
    revisitConditions: input.row.revisit_conditions,
    provenance: input.row.provenance,
    label: input.row.label,
  };
  const isVersioned = input.row.interaction_schema_version != null
    || input.row.action_policy_version != null
    || input.row.prior_actions != null;
  if (!isVersioned) return base;
  const documentId = String(input.row.document_id ?? "");
  const sourceRevisionId = String(input.row.source_revision_id ?? "");
  const priorKinds = Array.isArray(input.row.prior_actions)
    ? input.row.prior_actions
    : [];
  const status = SampleDecisionStatusSchema.safeParse(input.row.status);
  const concerns = input.row.concerns;
  const revisitConditions = input.row.revisit_conditions;
  if (
    input.documentRole !== "sample_decision_record"
    || !status.success
    || status.data !== input.expectedStatus
    || priorKinds.length === 0
    || !priorKinds.every((kind) => typeof kind === "string")
    || !Array.isArray(concerns)
    || !concerns.every((concern) => typeof concern === "string")
    || !Array.isArray(revisitConditions)
    || !revisitConditions.every((condition) => typeof condition === "string")
    || !String(input.row.action_policy_version ?? "").trim()
    || !String(input.row.interaction_schema_version ?? "").trim()
    || input.revision?.workspaceId !== String(input.row.workspace_id ?? "")
    || input.revision.sourceId !== documentId
    || !/^sha256:[0-9a-f]{64}$/u.test(input.revision.contentHash)
  ) {
    throw new Error(
      "Versioned Sample decision interaction does not preserve exact source ownership.",
    );
  }
  const priorActions = priorKinds.map((value) => {
    const kind = BeliefActionKindSchema.parse(value);
    return { kind, ...metadataForBeliefActionKind(kind) };
  });
  const actionPolicyVersion = String(input.row.action_policy_version);
  const interactionSchemaVersion = String(input.row.interaction_schema_version);
  return {
    ...base,
    priorActions,
    actionPolicyVersion,
    interactionSchemaVersion,
    source: buildSampleDecisionSourceRef({
      id: base.id,
      documentId,
      sourceRevisionId,
      contentFingerprint: input.revision.contentHash,
      occurredAt,
      retrievedAt: requiredIsoDateTime(
        input.revision.extractedAt,
        "A Sample decision retrieval time",
      ),
      summary: base.summary,
      decisionReason: base.decisionReason,
      concerns,
      revisitConditions,
    }),
  };
}

function confirmationFingerprint(
  input: ConfirmSourceAssignmentInput,
): string {
  return sha256(lengthFrame([
    "confirmation-request-v1",
    input.workspaceId,
    input.dealId,
    input.companyId,
    input.companyName,
    input.status,
    input.sourceRevisionId,
    input.assignedByUserId,
    input.reason,
    input.confirmedAt,
  ]));
}

function cloneDeal(deal: RegisteredDeal): RegisteredDeal {
  return structuredClone(deal);
}

export function createMemoryDealRegistry(options: {
  sourceRegistry?: SourceRegistry;
} = {}): MemoryDealRegistry {
  const sourceRegistry = options.sourceRegistry ?? createMemorySourceRegistry();
  const deals = new Map<string, RegisteredDeal>();
  const companies = new Map<string, { id: string; name: string }>();
  const bundles = new Map<string, DealMemoryBundle>();
  const bundleLineage = new Map<string, DealMemoryLineage>();
  const exactSourceBundles = new Map<string, ExactSourceMemoryBundle>();
  const assignments: DealSourceAssignment[] = [];
  const requestAssignments = new Map<string, DealSourceAssignment>();
  const externalEffects: string[] = [];
  const promotionLocks = new Map<string, Promise<void>>();
  const dealUniverses = new Map<string, RunDealUniverseBindingV1>();
  const runDealUniverses = new Map<string, RunDealUniverseBindingV1>();
  let assignmentSequence = 0;

  type PromotionState = {
    scope: MemoryDealPromotionScope;
    dealKey: string;
    companyKey: string;
    requestKey: string;
    exactBundleKey: string;
    deal: RegisteredDeal | null;
    company: { id: string; name: string } | null;
    bundle: DealMemoryBundle | null;
    lineage: DealMemoryLineage | null;
    exactBundle: ExactSourceMemoryBundle | null;
    assignments: DealSourceAssignment[];
    requestAssignmentId: string | null;
  };

  function capturePromotionState(
    rawScope: MemoryDealPromotionScope,
  ): PromotionState {
    const ownership = validateMemoryOwnership(rawScope);
    const scope = {
      ...ownership,
      companyId: requiredText(rawScope.companyId, "A company id"),
      requestId: requiredText(rawScope.requestId, "A request id"),
    };
    const dealKey = identity(scope.workspaceId, scope.dealId);
    const companyKey = identity(scope.workspaceId, scope.companyId);
    const requestKey = identity(scope.workspaceId, scope.requestId);
    const exactBundleKey = exactSourceIdentity(scope);
    return {
      scope,
      dealKey,
      companyKey,
      requestKey,
      exactBundleKey,
      deal: deals.has(dealKey) ? structuredClone(deals.get(dealKey)!) : null,
      company: companies.has(companyKey)
        ? structuredClone(companies.get(companyKey)!)
        : null,
      bundle: bundles.has(dealKey)
        ? structuredClone(bundles.get(dealKey)!)
        : null,
      lineage: bundleLineage.has(dealKey)
        ? structuredClone(bundleLineage.get(dealKey)!)
        : null,
      exactBundle: exactSourceBundles.has(exactBundleKey)
        ? structuredClone(exactSourceBundles.get(exactBundleKey)!)
        : null,
      assignments: assignments
        .filter((assignment) =>
          assignment.workspaceId === scope.workspaceId
          && assignment.dealId === scope.dealId
          && assignment.sourceId === scope.sourceId
        )
        .map((assignment) => structuredClone(assignment)),
      requestAssignmentId: requestAssignments.get(requestKey)?.id ?? null,
    };
  }

  function restorePromotionState(
    before: PromotionState,
    expected: PromotionState,
  ): void {
    if (
      before.dealKey !== expected.dealKey
      || before.companyKey !== expected.companyKey
      || before.requestKey !== expected.requestKey
      || before.exactBundleKey !== expected.exactBundleKey
    ) {
      throw new Error("Deal promotion states do not share an identity.");
    }

    restoreMapValue(bundles, before.dealKey, before.bundle, expected.bundle);
    restoreMapValue(
      bundleLineage,
      before.dealKey,
      before.lineage,
      expected.lineage,
    );
    restoreMapValue(
      exactSourceBundles,
      before.exactBundleKey,
      before.exactBundle,
      expected.exactBundle,
    );

    const beforeAssignments = new Map(
      before.assignments.map((assignment) => [assignment.id, assignment]),
    );
    const expectedAssignments = new Map(
      expected.assignments.map((assignment) => [assignment.id, assignment]),
    );
    for (const [assignmentId, expectedAssignment] of expectedAssignments) {
      const currentIndex = assignments.findIndex((assignment) =>
        assignment.id === assignmentId
      );
      if (currentIndex < 0) continue;
      const current = assignments[currentIndex];
      if (!isDeepStrictEqual(current, expectedAssignment)) continue;
      const original = beforeAssignments.get(assignmentId);
      if (original) {
        assignments[currentIndex] = structuredClone(original);
      } else {
        assignments.splice(currentIndex, 1);
      }
    }
    for (const [assignmentId, original] of beforeAssignments) {
      if (
        !expectedAssignments.has(assignmentId)
        && !assignments.some((assignment) => assignment.id === assignmentId)
      ) {
        assignments.push(structuredClone(original));
      }
    }

    const currentRequestAssignment =
      requestAssignments.get(before.requestKey) ?? null;
    if (
      (currentRequestAssignment?.id ?? null)
        === expected.requestAssignmentId
    ) {
      if (before.requestAssignmentId) {
        const original = assignments.find((assignment) =>
          assignment.id === before.requestAssignmentId
        );
        if (original) requestAssignments.set(before.requestKey, original);
      } else {
        requestAssignments.delete(before.requestKey);
      }
    }

    restoreMapValue(deals, before.dealKey, before.deal, expected.deal);
    const currentCompany = companies.get(before.companyKey) ?? null;
    if (isDeepStrictEqual(currentCompany, expected.company)) {
      if (before.company) {
        companies.set(before.companyKey, structuredClone(before.company));
      } else if (
        ![...deals.values()].some((deal) =>
          deal.workspaceId === before.scope.workspaceId
          && deal.companyId === before.scope.companyId
        )
      ) {
        companies.delete(before.companyKey);
      }
    }
  }

  function restoreMapValue<T>(
    target: Map<string, T>,
    key: string,
    before: T | null,
    expected: T | null,
  ): void {
    const current = target.get(key) ?? null;
    if (!isDeepStrictEqual(current, expected)) return;
    if (before) {
      target.set(key, structuredClone(before));
    } else {
      target.delete(key);
    }
  }

  async function findForWorkspace(input: {
    workspaceId: string;
    dealId: string;
  }): Promise<RegisteredDeal | null> {
    const workspaceId = requiredWorkspaceId(input.workspaceId);
    const dealId = requiredText(input.dealId, "A Deal id");
    const deal = deals.get(identity(workspaceId, dealId));
    return deal ? cloneDeal(deal) : null;
  }

  const repository: InternalMemoryDealRegistry = {
    capturePromotionState,

    restorePromotionState(rawBefore, rawExpected) {
      restorePromotionState(
        rawBefore as PromotionState,
        rawExpected as PromotionState,
      );
    },

    withPromotionLock(scope, operation) {
      const workspaceId = requiredWorkspaceId(scope.workspaceId);
      const dealId = requiredText(scope.dealId, "A Deal id");
      const key = identity(workspaceId, dealId);
      return withMemoryKeyLock(promotionLocks, key, async () => {
        let active = true;
        const startedConfirmations: Array<
          ReturnType<DealRegistry["confirmSourceAssignment"]>
        > = [];
        const confirmWithinLock: DealRegistry["confirmSourceAssignment"] =
          (rawInput) => {
            if (!active) {
              throw new Error("The Deal promotion lock is no longer active.");
            }
            const input = validateConfirmation(rawInput);
            if (
              input.workspaceId !== workspaceId
              || input.dealId !== dealId
            ) {
              throw new Error(
                "The locked Deal promotion cannot mutate another Deal.",
              );
            }
            const confirmation = confirmSourceAssignmentUnlocked(input);
            startedConfirmations.push(confirmation);
            return confirmation;
          };
        try {
          return await operation(confirmWithinLock);
        } finally {
          active = false;
          await Promise.allSettled(startedConfirmations);
        }
      });
    },

    usesSourceRegistry(registry) {
      return registry === sourceRegistry;
    },

    async bindRunDealUniverse(rawInput) {
      const input = validateDealUniverseInput(rawInput);
      const universeKey = identity(input.workspaceId, input.universeId);
      const runKey = identity(input.workspaceId, input.runId);
      const candidate: RunDealUniverseBindingV1 = {
        ...structuredClone(input),
        schemaVersion: "run-deal-universe-binding-v1",
        universeFingerprint: dealUniverseFingerprint(input),
        dealCount: input.members.length,
      };
      const existingUniverse = dealUniverses.get(universeKey);
      if (
        existingUniverse
        && canonicalDealUniverse(existingUniverse)
          !== canonicalDealUniverse(candidate)
      ) {
        throw new Error(
          "Deal-universe identity has different immutable content or fingerprint collision.",
        );
      }
      const existingRun = runDealUniverses.get(runKey);
      if (
        existingRun
        && canonicalDealUniverse(existingRun) !== canonicalDealUniverse(candidate)
      ) {
        throw new Error(
          "Run Deal-universe binding has different immutable content.",
        );
      }
      if (!existingUniverse) {
        for (const member of input.members) {
          const deal = deals.get(identity(input.workspaceId, member.dealId));
          if (
            !deal
            || deal.companyId !== member.companyId
            || deal.status !== member.dealStatus
            || deal.analysisEligibleAt !== member.analysisEligibleAt
          ) {
            throw new Error(
              "Deal-universe member is not one authoritative analysis-eligible Deal.",
            );
          }
        }
        dealUniverses.set(universeKey, structuredClone(candidate));
      }
      if (!existingRun) runDealUniverses.set(runKey, structuredClone(candidate));
      return structuredClone(existingRun ?? candidate);
    },

    async getRunDealUniverse(input) {
      return structuredClone(
        runDealUniverses.get(identity(input.workspaceId, input.runId)) ?? null,
      );
    },

    async getAnalysisEligibleSnapshot(workspaceId) {
      workspaceId = requiredWorkspaceId(workspaceId);
      const eligibleDeals = [...deals.values()]
        .filter((deal) =>
          deal.workspaceId === workspaceId
          && deal.analysisEligibleAt !== null
          && deal.activeSourceRevisionIds.length > 0
          && deal.activeSourceRevisionFingerprint
            === sourceRevisionFingerprint(deal.activeSourceRevisionIds)
        )
        .sort((left, right) => compareUtf8(left.id, right.id));
      return {
        count: eligibleDeals.length,
        dealIds: eligibleDeals.map((deal) => deal.id),
        fingerprint: eligibleDealSnapshotFingerprint(eligibleDeals),
      };
    },

    async listAnalysisEligibleBundles(workspaceId) {
      workspaceId = requiredWorkspaceId(workspaceId);
      return [...deals.values()]
        .filter((deal) =>
          deal.workspaceId === workspaceId
          && deal.analysisEligibleAt !== null
          && deal.activeSourceRevisionIds.length > 0
          && deal.activeSourceRevisionFingerprint
            === sourceRevisionFingerprint(deal.activeSourceRevisionIds)
        )
        .sort((left, right) =>
          compareUtf8(left.companyName, right.companyName)
          || compareUtf8(left.id, right.id)
        )
        .map((deal) => {
          const stored = bundles.get(identity(workspaceId, deal.id));
          const lineage = bundleLineage.get(identity(workspaceId, deal.id));
          if (stored && lineage) {
            const active = new Set(deal.activeSourceRevisionIds);
            const refs = [
              ...stored.facts.flatMap((fact) =>
                fact.sources.map((source) =>
                  [source.id, source.documentId] as const
                )
              ),
              ...stored.interactions.map((interaction) =>
                [interaction.id, undefined] as const
              ),
            ];
            for (const [id, sourceId] of refs) {
              const owner = lineage.evidence[id] ?? lineage.interactions[id];
              if (
                !owner
                || owner.workspaceId !== workspaceId
                || owner.dealId !== deal.id
                || (sourceId !== undefined && owner.sourceId !== sourceId)
                || !active.has(owner.sourceRevisionId)
              ) {
                throw new Error(
                  `Deal ${deal.id} evidence has foreign, inactive, or stale source revision ownership.`,
                );
              }
            }
          }
          return structuredClone(
            stored
              ? { ...stored, status: deal.status }
              : DealMemoryBundleSchema.parse({
                dealId: deal.id,
                companyName: deal.companyName,
                status: deal.status,
                facts: [],
                interactions: [],
              }),
          );
        });
    },

    async getExactSourceBundle(rawInput) {
      const input = validateMemoryOwnership(rawInput);
      const exact = exactSourceBundles.get(exactSourceIdentity(input));
      return exact ? structuredClone(exact) : null;
    },

    findForWorkspace,

    async listForWorkspace(workspaceId) {
      workspaceId = requiredWorkspaceId(workspaceId);
      return [...deals.values()]
        .filter((deal) => deal.workspaceId === workspaceId)
        .sort((left, right) =>
          compareUtf8(left.companyName, right.companyName)
          || compareUtf8(left.id, right.id)
        )
        .map(cloneDeal);
    },

    async listActiveSourceAssignments(workspaceId) {
      workspaceId = requiredWorkspaceId(workspaceId);
      const eligibleDealIds = new Set(
        [...deals.values()]
          .filter((deal) =>
            deal.workspaceId === workspaceId
            && deal.analysisEligibleAt !== null
            && deal.activeSourceRevisionFingerprint
              === sourceRevisionFingerprint(deal.activeSourceRevisionIds)
          )
          .map((deal) => deal.id),
      );
      return assignments
        .filter((assignment) =>
          assignment.workspaceId === workspaceId
          && assignment.supersededAt === null
          && eligibleDealIds.has(assignment.dealId)
        )
        .map(({ workspaceId: ownerWorkspaceId, dealId, sourceId, sourceRevisionId }) => ({
          workspaceId: ownerWorkspaceId,
          dealId,
          sourceId,
          sourceRevisionId,
        }))
        .sort((left, right) =>
          compareUtf8(left.dealId, right.dealId)
          || compareUtf8(left.sourceRevisionId, right.sourceRevisionId)
        );
    },

    async confirmSourceAssignmentUnlocked(rawInput) {
      const input = validateConfirmation(rawInput);
      const sourceRevision = await sourceRegistry.getRevision({
        workspaceId: input.workspaceId,
        revisionId: input.sourceRevisionId,
      });
      if (!sourceRevision) {
        throw new Error(
          "The source revision does not exist in this workspace.",
        );
      }
      if (
        input.memoryBundle
        && (
          input.memoryBundle.facts.length > 0
          || input.memoryBundle.interactions.length > 0
        )
        && !input.memoryLineage
      ) {
        throw new Error(
          "Source-backed Deal memory requires internal source revision lineage.",
        );
      }
      if (input.memoryBundle && input.memoryLineage) {
        const expectedEvidence = input.memoryBundle.facts.flatMap((fact) =>
          fact.sources.map((source) => [source.id, source.documentId] as const)
        );
        const expectedInteractions = input.memoryBundle.interactions.map(
          (interaction) => interaction.id,
        );
        for (const [id, sourceId] of expectedEvidence) {
          const owner = input.memoryLineage.evidence[id];
          if (!owner || owner.sourceId !== sourceId) {
            throw new Error(
              "Deal evidence is missing exact internal source identity.",
            );
          }
        }
        for (const id of expectedInteractions) {
          if (!input.memoryLineage.interactions[id]) {
            throw new Error(
              "Deal interaction is missing exact internal source identity.",
            );
          }
        }
        for (
          const owner of [
            ...Object.values(input.memoryLineage.evidence),
            ...Object.values(input.memoryLineage.interactions),
          ]
        ) {
          const revision = await sourceRegistry.getRevision({
            workspaceId: owner.workspaceId,
            revisionId: owner.sourceRevisionId,
          });
          if (
            owner.workspaceId !== input.workspaceId
            || owner.dealId !== input.dealId
            || !revision
            || revision.sourceId !== owner.sourceId
          ) {
            throw new Error(
              "Deal memory lineage references a foreign workspace, Deal, source, or revision.",
            );
          }
        }
      }
      const requestKey = identity(input.workspaceId, input.requestId);
      const requestFingerprint = confirmationFingerprint(input);
      const existingRequest = requestAssignments.get(requestKey);
      if (existingRequest) {
        if (existingRequest.requestFingerprint !== requestFingerprint) {
          throw new Error(
            "The confirmation request id was already used for a different Deal or source revision.",
          );
        }
        const existingDeal = deals.get(
          identity(input.workspaceId, input.dealId),
        );
        if (!existingDeal) {
          throw new Error("The confirmed Deal no longer exists.");
        }
        return {
          deal: cloneDeal(existingDeal),
          sourceRevision,
          newlyEligible: false,
        };
      }

      const companyKey = identity(input.workspaceId, input.companyId);
      const existingCompany = companies.get(companyKey);
      if (existingCompany && existingCompany.name !== input.companyName) {
        throw new Error(
          "The company id belongs to a different company in this workspace.",
        );
      }
      const dealKey = identity(input.workspaceId, input.dealId);
      const existingDeal = deals.get(dealKey);
      if (
        existingDeal
        && (
          existingDeal.companyId !== input.companyId
          || existingDeal.companyName !== input.companyName
        )
      ) {
        throw new Error(
          "The Deal belongs to a different company in this workspace.",
        );
      }

      const alreadyActive = assignments.find((assignment) =>
        assignment.workspaceId === input.workspaceId
        && assignment.dealId === input.dealId
        && assignment.sourceId === sourceRevision.sourceId
        && assignment.sourceRevisionId === sourceRevision.id
        && assignment.supersededAt === null
      );
      const wasEligible = existingDeal?.analysisEligibleAt !== null
        && existingDeal?.analysisEligibleAt !== undefined;
      if (!alreadyActive) {
        const backdatedSupersession = assignments.some((assignment) =>
          assignment.workspaceId === input.workspaceId
          && assignment.dealId === input.dealId
          && assignment.sourceId === sourceRevision.sourceId
          && assignment.supersededAt === null
          && Date.parse(input.confirmedAt) < Date.parse(assignment.createdAt)
        );
        if (backdatedSupersession) {
          throw new Error(
            "The confirmation time cannot backdate assignment supersession chronology.",
          );
        }
        for (const assignment of assignments) {
          if (
            assignment.workspaceId === input.workspaceId
            && assignment.dealId === input.dealId
            && assignment.sourceId === sourceRevision.sourceId
            && assignment.supersededAt === null
          ) {
            assignment.supersededAt = input.confirmedAt;
          }
        }
        assignmentSequence += 1;
        const assignment: DealSourceAssignment = {
          id: `deal_source_assignment_${assignmentSequence}`,
          requestId: input.requestId,
          requestFingerprint,
          workspaceId: input.workspaceId,
          dealId: input.dealId,
          sourceId: sourceRevision.sourceId,
          sourceRevisionId: sourceRevision.id,
          assignedByUserId: input.assignedByUserId,
          reason: input.reason,
          createdAt: input.confirmedAt,
          supersededAt: null,
        };
        assignments.push(assignment);
        requestAssignments.set(requestKey, assignment);
      } else {
        requestAssignments.set(requestKey, alreadyActive);
      }

      companies.set(companyKey, {
        id: input.companyId,
        name: input.companyName,
      });
      const activeSourceRevisionIds = assignments
        .filter((assignment) =>
          assignment.workspaceId === input.workspaceId
          && assignment.dealId === input.dealId
          && assignment.supersededAt === null
        )
        .map((assignment) => assignment.sourceRevisionId)
        .sort(compareUtf8);
      const deal: RegisteredDeal = {
        id: input.dealId,
        workspaceId: input.workspaceId,
        companyId: input.companyId,
        companyName: input.companyName,
        status: input.status,
        analysisEligibleAt: existingDeal?.analysisEligibleAt
          ?? input.confirmedAt,
        activeSourceRevisionFingerprint: sourceRevisionFingerprint(
          activeSourceRevisionIds,
        ),
        activeSourceRevisionIds,
      };
      deals.set(dealKey, deal);
      if (input.memoryBundle) {
        bundles.set(dealKey, structuredClone(input.memoryBundle));
        if (input.memoryLineage) {
          bundleLineage.set(dealKey, structuredClone(input.memoryLineage));
          for (
            const exact of exactSourceBundlesFromConfirmation(
              input.memoryBundle,
              input.memoryLineage,
            )
          ) {
            exactSourceBundles.set(exactSourceIdentity(exact), exact);
          }
        }
      } else if (!bundles.has(dealKey)) {
        bundles.set(dealKey, DealMemoryBundleSchema.parse({
          dealId: deal.id,
          companyName: deal.companyName,
          status: deal.status,
          facts: [],
          interactions: [],
        }));
      }
      const exactOwnership: DealMemoryOwnership = {
        workspaceId: input.workspaceId,
        dealId: input.dealId,
        sourceId: sourceRevision.sourceId,
        sourceRevisionId: sourceRevision.id,
      };
      const exactKey = exactSourceIdentity(exactOwnership);
      if (!exactSourceBundles.has(exactKey)) {
        exactSourceBundles.set(exactKey, {
          ...exactOwnership,
          bundle: DealMemoryBundleSchema.parse({
            dealId: deal.id,
            companyName: deal.companyName,
            status: deal.status,
            facts: [],
            interactions: [],
          }),
        });
      }
      return {
        deal: cloneDeal(deal),
        sourceRevision,
        newlyEligible: !wasEligible,
      };
    },

    inspect() {
      return {
        deals: [...deals.values()].map(cloneDeal),
        assignments: assignments.map((assignment) =>
          structuredClone(assignment)
        ),
        externalEffects: [...externalEffects],
      };
    },
  };
  const {
    confirmSourceAssignmentUnlocked,
    ...publicRepository
  } = repository;
  return {
    ...publicRepository,
    async confirmSourceAssignment(rawInput) {
      const input = validateConfirmation(rawInput);
      const key = identity(input.workspaceId, input.dealId);
      return withMemoryKeyLock(
        promotionLocks,
        key,
        () => confirmSourceAssignmentUnlocked(input),
      );
    },
  };
}

async function withMemoryKeyLock<T>(
  locks: Map<string, Promise<void>>,
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  locks.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (locks.get(key) === queued) locks.delete(key);
  }
}

function dealFromRow(
  row: Record<string, unknown>,
  activeSourceRevisionIds: string[],
): RegisteredDeal {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    companyId: String(row.company_id),
    companyName: String(row.company_name),
    status: DealStatusSchema.parse(row.status),
    analysisEligibleAt: row.analysis_eligible_at
      ? String(row.analysis_eligible_at)
      : null,
    activeSourceRevisionFingerprint: row.active_source_revision_fingerprint
      ? String(row.active_source_revision_fingerprint)
      : null,
    activeSourceRevisionIds: [...activeSourceRevisionIds].sort(compareUtf8),
  };
}

function sourceRevisionFromRpc(value: unknown): SourceRevision {
  if (!value || typeof value !== "object") {
    throw new Error("The confirmation RPC returned no source revision.");
  }
  const row = value as Record<string, unknown>;
  return {
    id: String(row.id),
    workspaceId: String(row.workspaceId),
    sourceId: String(row.sourceId),
    revision: Number(row.revision),
    contentHash: String(row.contentHash),
    objectKey: String(row.objectKey),
    objectVersion: String(row.objectVersion),
    contentType: String(row.contentType),
    extractorId: String(row.extractorId),
    extractorVersion: String(row.extractorVersion),
    extractedAt: String(row.extractedAt),
    supersedesRevisionId: row.supersedesRevisionId
      ? String(row.supersedesRevisionId)
      : null,
    createdAt: String(row.createdAt),
  };
}

function registeredDealFromRpc(value: unknown): RegisteredDeal {
  if (!value || typeof value !== "object") {
    throw new Error("The confirmation RPC returned no Deal.");
  }
  const row = value as Record<string, unknown>;
  return {
    id: String(row.id),
    workspaceId: String(row.workspaceId),
    companyId: String(row.companyId),
    companyName: String(row.companyName),
    status: DealStatusSchema.parse(row.status),
    analysisEligibleAt: row.analysisEligibleAt
      ? String(row.analysisEligibleAt)
      : null,
    activeSourceRevisionFingerprint: row.activeSourceRevisionFingerprint
      ? String(row.activeSourceRevisionFingerprint)
      : null,
    activeSourceRevisionIds: Array.isArray(row.activeSourceRevisionIds)
      ? row.activeSourceRevisionIds.map(String).sort(compareUtf8)
      : [],
  };
}

export function createSupabaseDealRegistry(options: {
  url: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}): DealRegistry {
  const base = `${options.url.replace(/\/$/, "")}/rest/v1`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = {
    apikey: options.serviceRoleKey,
    authorization: `Bearer ${options.serviceRoleKey}`,
    "content-type": "application/json",
  };
  async function request(
    pathname: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${pathname}`, {
        ...init,
        headers: { ...headers, ...(init.headers ?? {}) },
        cache: "no-store",
      });
    } catch {
      throw new IntegrationTransportError({ retryable: true });
    }
    if (!response.ok) {
      throw new IntegrationTransportError({
        retryable: isRetryableTransportStatus(response.status),
      });
    }
    if (response.status === 204) return null;
    const body = await response.text();
    return body.trim() ? JSON.parse(body) : null;
  }
  async function activeRevisionIds(
    workspaceId: string,
    dealIds: string[],
  ): Promise<Map<string, Array<{ revisionId: string; sourceId: string }>>> {
    const result = new Map<
      string,
      Array<{ revisionId: string; sourceId: string }>
    >();
    if (dealIds.length === 0) return result;
    const query = new URLSearchParams({
      workspace_id: `eq.${workspaceId}`,
      deal_id: `in.(${dealIds.map(encodeURIComponent).join(",")})`,
      superseded_at: "is.null",
      select: "deal_id,source_id,source_revision_id",
      order: "deal_id.asc,source_revision_id.asc",
    });
    const rows = await request(
      `/deal_source_assignments?${query}`,
    ) as Record<string, unknown>[];
    for (const row of rows) {
      const dealId = String(row.deal_id);
      const values = result.get(dealId) ?? [];
      values.push({
        sourceId: String(row.source_id),
        revisionId: String(row.source_revision_id),
      });
      result.set(dealId, values);
    }
    return result;
  }
  async function findForWorkspace(input: {
    workspaceId: string;
    dealId: string;
  }): Promise<RegisteredDeal | null> {
    const workspaceId = requiredWorkspaceId(input.workspaceId);
    const dealId = requiredText(input.dealId, "A Deal id");
    const query = new URLSearchParams({
      workspace_id: `eq.${workspaceId}`,
      id: `eq.${dealId}`,
      limit: "1",
    });
    const rows = await request(`/deals?${query}`) as Record<string, unknown>[];
    if (!rows[0]) return null;
    const revisions = await activeRevisionIds(workspaceId, [dealId]);
    return dealFromRow(
      rows[0],
      (revisions.get(dealId) ?? []).map((value) => value.revisionId),
    );
  }
  async function getRunDealUniverse(input: {
    workspaceId: string;
    runId: string;
  }): Promise<RunDealUniverseBindingV1 | null> {
    const workspaceId = requiredWorkspaceId(input.workspaceId);
    const runId = requiredText(input.runId, "A run id");
    const bindingQuery = new URLSearchParams({
      workspace_id: `eq.${workspaceId}`,
      run_id: `eq.${runId}`,
      select:
        "workspace_id,run_id,schema_version,universe_id,universe_fingerprint,deal_count",
    });
    const bindingRows = await request(
      `/run_deal_universe_bindings_v1?${bindingQuery}`,
    ) as Record<string, unknown>[];
    if (bindingRows.length === 0) return null;
    if (bindingRows.length !== 1) {
      throw new Error("Run Deal-universe binding is ambiguous.");
    }
    const binding = bindingRows[0]!;
    const universeId = String(binding.universe_id ?? "");
    const snapshotQuery = new URLSearchParams({
      workspace_id: `eq.${workspaceId}`,
      universe_id: `eq.${universeId}`,
      select:
        "workspace_id,universe_id,schema_version,mode,anchor_at,evidence_snapshot_id,evidence_snapshot_fingerprint,deal_count,universe_fingerprint",
    });
    const memberQuery = new URLSearchParams({
      workspace_id: `eq.${workspaceId}`,
      universe_id: `eq.${universeId}`,
      select:
        "ordinal,deal_id,company_id,deal_status,analysis_eligible_at,member_fingerprint",
      order: "ordinal.asc",
    });
    const [snapshotRows, memberRows] = await Promise.all([
      request(`/deal_universe_snapshots_v1?${snapshotQuery}`) as Promise<
        Record<string, unknown>[]
      >,
      request(`/deal_universe_snapshot_members_v1?${memberQuery}`) as Promise<
        Record<string, unknown>[]
      >,
    ]);
    if (snapshotRows.length !== 1) {
      throw new Error("Run Deal-universe snapshot did not resolve exactly once.");
    }
    const snapshot = snapshotRows[0]!;
    const parsedInput = validateDealUniverseInput({
      workspaceId,
      runId,
      universeId,
      mode: String(snapshot.mode) as "live" | "pinned",
      anchorAt: String(snapshot.anchor_at),
      evidenceSnapshotId: snapshot.evidence_snapshot_id === null
        ? null
        : String(snapshot.evidence_snapshot_id),
      evidenceSnapshotFingerprint:
        snapshot.evidence_snapshot_fingerprint === null
          ? null
          : String(snapshot.evidence_snapshot_fingerprint),
      members: memberRows.map((member) => ({
        ordinal: Number(member.ordinal),
        dealId: String(member.deal_id),
        companyId: String(member.company_id),
        dealStatus: DealStatusSchema.parse(member.deal_status),
        analysisEligibleAt: String(member.analysis_eligible_at),
      })),
    });
    const universeFingerprint = String(binding.universe_fingerprint ?? "");
    const dealCount = Number(binding.deal_count);
    if (
      binding.schema_version !== "run-deal-universe-binding-v1"
      || String(binding.workspace_id) !== workspaceId
      || String(binding.run_id) !== runId
      || snapshot.schema_version !== "deal-universe-snapshot-v1"
      || String(snapshot.workspace_id) !== workspaceId
      || String(snapshot.universe_id) !== universeId
      || snapshot.universe_fingerprint !== universeFingerprint
      || Number(snapshot.deal_count) !== dealCount
      || parsedInput.members.length !== dealCount
      || !/^sha256:[0-9a-f]{64}$/u.test(universeFingerprint)
    ) {
      throw new Error("Run Deal-universe authority did not reload exactly.");
    }
    return {
      ...parsedInput,
      schemaVersion: "run-deal-universe-binding-v1",
      universeFingerprint,
      dealCount,
    };
  }
  return {
    async bindRunDealUniverse(rawInput) {
      const input = validateDealUniverseInput(rawInput);
      const saved = await request(
        "/rpc/save_deal_universe_snapshot_v1",
        {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            p_payload: {
              schemaVersion: "deal-universe-snapshot-v1",
              workspaceId: input.workspaceId,
              universeId: input.universeId,
              mode: input.mode,
              anchorAt: input.anchorAt,
              evidenceSnapshotId: input.evidenceSnapshotId,
              evidenceSnapshotFingerprint: input.evidenceSnapshotFingerprint,
              members: input.members,
            },
          }),
        },
      ) as Record<string, unknown>;
      const universeFingerprint = String(saved.universeFingerprint ?? "");
      if (
        saved.universeId !== input.universeId
        || Number(saved.dealCount) !== input.members.length
        || !/^sha256:[0-9a-f]{64}$/u.test(universeFingerprint)
      ) {
        throw new Error("Deal-universe snapshot RPC returned invalid authority.");
      }
      const bound = await request(
        "/rpc/bind_run_deal_universe_v1",
        {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            p_payload: {
              schemaVersion: "run-deal-universe-binding-v1",
              workspaceId: input.workspaceId,
              runId: input.runId,
              universeId: input.universeId,
              universeFingerprint,
            },
          }),
        },
      ) as Record<string, unknown>;
      if (
        bound.runId !== input.runId
        || bound.universeId !== input.universeId
        || bound.universeFingerprint !== universeFingerprint
        || Number(bound.dealCount) !== input.members.length
      ) {
        throw new Error("Run Deal-universe binding RPC returned invalid authority.");
      }
      const reloaded = await getRunDealUniverse({
        workspaceId: input.workspaceId,
        runId: input.runId,
      });
      if (
        reloaded === null
        || reloaded.universeFingerprint !== universeFingerprint
        || canonicalDealUniverse(reloaded) !== canonicalDealUniverse({
          ...input,
          schemaVersion: "run-deal-universe-binding-v1",
          universeFingerprint,
          dealCount: input.members.length,
        })
      ) {
        throw new Error("Bound run Deal universe did not reload exactly.");
      }
      return reloaded;
    },

    getRunDealUniverse,

    async getAnalysisEligibleSnapshot(workspaceId) {
      workspaceId = requiredWorkspaceId(workspaceId);
      const value = await request(
        "/rpc/get_analysis_eligible_snapshot",
        {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ p_workspace_id: workspaceId }),
        },
      );
      if (!value || typeof value !== "object") {
        throw new Error(
          "The eligible Deal snapshot RPC returned no snapshot.",
        );
      }
      const snapshot = value as Record<string, unknown>;
      const count = Number(snapshot.count);
      const dealIds = Array.isArray(snapshot.dealIds)
        ? snapshot.dealIds.map(String)
        : [];
      const fingerprint = String(snapshot.fingerprint ?? "");
      if (
        !Number.isInteger(count)
        || count < 0
        || dealIds.length !== count
        || !/^sha256:[0-9a-f]{64}$/.test(fingerprint)
      ) {
        throw new Error(
          "The eligible Deal snapshot RPC returned an invalid snapshot.",
        );
      }
      return { count, dealIds, fingerprint };
    },

    async listAnalysisEligibleBundles(workspaceId) {
      workspaceId = requiredWorkspaceId(workspaceId);
      const dealQuery = new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        analysis_eligible_at: "not.is.null",
        order: "company_name.asc,id.asc",
      });
      const dealRows = await request(
        `/deals?${dealQuery}`,
      ) as Record<string, unknown>[];
      if (dealRows.length === 0) return [];
      const dealIds = dealRows.map((row) => String(row.id));
      const revisionMap = await activeRevisionIds(workspaceId, dealIds);
      for (const row of dealRows) {
        const dealId = String(row.id);
        const revisionIds = (revisionMap.get(dealId) ?? [])
          .map((value) => value.revisionId);
        if (
          revisionIds.length === 0
          || row.active_source_revision_fingerprint
            !== sourceRevisionFingerprint(revisionIds)
        ) {
          throw new Error(
            `Analysis-eligible Deal ${dealId} has a stale active source revision fingerprint.`,
          );
        }
      }
      const dealFilter = `in.(${dealIds.map(encodeURIComponent).join(",")})`;
      const evidenceQuery = new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        deal_id: dealFilter,
        analysis_quarantine_reason: "is.null",
        order: "deal_id.asc,id.asc",
        select:
          "id,workspace_id,deal_id,document_id,source_revision_id,provenance,page,fact,excerpt",
      });
      const interactionQuery = new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        deal_id: dealFilter,
        order: "deal_id.asc,occurred_at.asc,id.asc",
        select:
          "id,workspace_id,deal_id,document_id,source_revision_id,occurred_at,meeting_summary,decision_reason,concerns,revisit_conditions,provenance,label,status,prior_actions,action_policy_version,interaction_schema_version",
      });
      const canonicalEvidenceQuery = new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        deal_id: dealFilter,
        order: "deal_id.asc,evidence_id.asc",
        select:
          "workspace_id,evidence_id,deal_id,source_id,source_revision_id,payload",
      });
      const [evidenceRows, canonicalEvidenceRows, interactionRows] =
        await Promise.all([
        request(`/source_evidence?${evidenceQuery}`) as Promise<
          Record<string, unknown>[]
        >,
        request(`/source_evidence_items?${canonicalEvidenceQuery}`) as Promise<
          Record<string, unknown>[]
        >,
        request(`/deal_interactions?${interactionQuery}`) as Promise<
          Record<string, unknown>[]
        >,
      ]);
      const documentIds = [
        ...new Set(
          [
            ...evidenceRows.map((row) => String(row.document_id)),
            ...canonicalEvidenceRows.map((row) => String(row.source_id)),
            ...interactionRows.map((row) => String(row.document_id)),
          ],
        ),
      ];
      const documentRows = documentIds.length
        ? await request(
          `/source_documents?${
            new URLSearchParams({
              id: `in.(${documentIds.map(encodeURIComponent).join(",")})`,
              select: "id,title,role",
            })
          }`,
        ) as Record<string, unknown>[]
        : [];
      const documentTitles = new Map(
        documentRows.map((row) => [String(row.id), String(row.title)]),
      );
      const documentRoles = new Map(
        documentRows.map((row) => [String(row.id), String(row.role ?? "")]),
      );
      const activeRevisionIdList = [
        ...new Set([...revisionMap.values()].flatMap((items) =>
          items.map((item) => item.revisionId)
        )),
      ];
      const revisionRows = activeRevisionIdList.length === 0
        ? []
        : await request(`/source_revisions?${new URLSearchParams({
          workspace_id: `eq.${workspaceId}`,
          id: `in.(${activeRevisionIdList.map(encodeURIComponent).join(",")})`,
          select: "workspace_id,id,source_id,content_hash,extracted_at",
        })}`) as Record<string, unknown>[];
      const revisionsById = new Map(revisionRows.map((revision) => [
        String(revision.id),
        {
          workspaceId: String(revision.workspace_id),
          sourceId: String(revision.source_id),
          contentHash: String(revision.content_hash),
          extractedAt: String(revision.extracted_at ?? ""),
        },
      ]));

      return dealRows.map((row) => {
        const dealId = String(row.id);
        const activeAssignments = new Set(
          (revisionMap.get(dealId) ?? []).map((value) =>
            JSON.stringify([value.sourceId, value.revisionId])
          ),
        );
        if (activeAssignments.size === 0) {
          throw new Error(
            `Analysis-eligible Deal ${dealId} has no active source assignment.`,
          );
        }
        const dealEvidence = evidenceRows.filter((evidence) =>
          String(evidence.deal_id) === dealId
        );
        const dealInteractions = interactionRows.filter((interaction) =>
          String(interaction.deal_id) === dealId
        );
        const dealCanonicalEvidence = canonicalEvidenceRows.filter(
          (evidence) => String(evidence.deal_id) === dealId,
        );
        for (const ownedRow of [...dealEvidence, ...dealInteractions]) {
          if (
            String(ownedRow.workspace_id) !== workspaceId
            || String(ownedRow.deal_id) !== dealId
            || !activeAssignments.has(JSON.stringify([
              String(ownedRow.document_id),
              String(ownedRow.source_revision_id),
            ]))
          ) {
            throw new Error(
              `Deal ${dealId} evidence references a foreign, inactive, or stale source revision.`,
            );
          }
        }
        const canonicalImageFacts = dealCanonicalEvidence.flatMap((item) => {
          const fact = canonicalDealFactFromRow({
            row: item,
            expectedWorkspaceId: workspaceId,
            expectedDealId: dealId,
            activeAssignments,
            titleForSource: (sourceId) =>
              documentTitles.get(sourceId) ?? sourceId,
            roleForSource: (sourceId) => documentRoles.get(sourceId) ?? null,
            revisionForId: (revisionId) =>
              revisionsById.get(revisionId) ?? null,
          });
          return fact ? [fact] : [];
        });
        assertConsistentCanonicalEvidenceUnits(
          canonicalImageFacts.flatMap((fact) => fact.sources)
            .filter((source) => "schemaVersion" in source),
        );
        return DealMemoryBundleSchema.parse({
          dealId,
          companyName: row.company_name,
          status: row.status,
          facts: [
            ...dealEvidence.map((evidence) => ({
              text: evidence.fact,
              sources: [{
                id: evidence.id,
                provenance: evidence.provenance,
                title: documentTitles.get(String(evidence.document_id))
                  ?? String(evidence.document_id),
                documentId: evidence.document_id,
                page: Number(evidence.page),
                excerpt: evidence.excerpt,
              }],
            })),
            ...canonicalImageFacts,
          ],
          interactions: dealInteractions.map((interaction) =>
            dealInteractionFromRow({
              row: interaction,
              expectedStatus: DealStatusSchema.parse(row.status),
              documentRole: documentRoles.get(
                String(interaction.document_id),
              ) ?? null,
              revision: revisionsById.get(
                String(interaction.source_revision_id),
              ) ?? null,
            })
          ),
        });
      }).sort((left, right) =>
        compareUtf8(left.companyName, right.companyName)
        || compareUtf8(left.dealId, right.dealId)
      );
    },

    async getExactSourceBundle(rawInput) {
      const input = validateMemoryOwnership(rawInput);
      const assignmentQuery = new URLSearchParams({
        workspace_id: `eq.${input.workspaceId}`,
        deal_id: `eq.${input.dealId}`,
        source_id: `eq.${input.sourceId}`,
        source_revision_id: `eq.${input.sourceRevisionId}`,
        select: "source_revision_id",
        limit: "1",
      });
      const evidenceQuery = new URLSearchParams({
        workspace_id: `eq.${input.workspaceId}`,
        deal_id: `eq.${input.dealId}`,
        document_id: `eq.${input.sourceId}`,
        source_revision_id: `eq.${input.sourceRevisionId}`,
        analysis_quarantine_reason: "is.null",
        order: "id.asc",
        select:
          "id,workspace_id,deal_id,document_id,source_revision_id,provenance,page,fact,excerpt",
      });
      const canonicalEvidenceQuery = new URLSearchParams({
        workspace_id: `eq.${input.workspaceId}`,
        deal_id: `eq.${input.dealId}`,
        source_id: `eq.${input.sourceId}`,
        source_revision_id: `eq.${input.sourceRevisionId}`,
        order: "evidence_id.asc",
        select:
          "workspace_id,evidence_id,deal_id,source_id,source_revision_id,payload",
      });
      const interactionQuery = new URLSearchParams({
        workspace_id: `eq.${input.workspaceId}`,
        deal_id: `eq.${input.dealId}`,
        document_id: `eq.${input.sourceId}`,
        source_revision_id: `eq.${input.sourceRevisionId}`,
        order: "occurred_at.asc,id.asc",
        select:
          "id,workspace_id,deal_id,document_id,source_revision_id,occurred_at,meeting_summary,decision_reason,concerns,revisit_conditions,provenance,label,status,prior_actions,action_policy_version,interaction_schema_version",
      });
      const [
        deal,
        assignmentRows,
        evidenceRows,
        canonicalEvidenceRows,
        interactionRows,
        documentRows,
        revisionRows,
      ] =
        await Promise.all([
          findForWorkspace({
            workspaceId: input.workspaceId,
            dealId: input.dealId,
          }),
          request(`/deal_source_assignments?${assignmentQuery}`) as Promise<
            Record<string, unknown>[]
          >,
          request(`/source_evidence?${evidenceQuery}`) as Promise<
            Record<string, unknown>[]
          >,
          request(`/source_evidence_items?${canonicalEvidenceQuery}`) as Promise<
            Record<string, unknown>[]
          >,
          request(`/deal_interactions?${interactionQuery}`) as Promise<
            Record<string, unknown>[]
          >,
          request(`/source_documents?${
            new URLSearchParams({
              id: `eq.${input.sourceId}`,
              select: "id,title,role",
              limit: "1",
            })
          }`) as Promise<Record<string, unknown>[]>,
          request(`/source_revisions?${new URLSearchParams({
            workspace_id: `eq.${input.workspaceId}`,
            id: `eq.${input.sourceRevisionId}`,
            select: "workspace_id,id,source_id,content_hash,extracted_at",
            limit: "1",
          })}`) as Promise<Record<string, unknown>[]>,
        ]);
      if (!deal || assignmentRows.length !== 1) {
        return null;
      }
      for (const evidence of evidenceRows) {
        if (
          String(evidence.workspace_id) !== input.workspaceId
          || String(evidence.deal_id) !== input.dealId
          || String(evidence.document_id) !== input.sourceId
          || String(evidence.source_revision_id) !== input.sourceRevisionId
        ) {
          throw new Error(
            "Exact source evidence ownership does not match its query.",
          );
        }
      }
      const title = documentRows[0]
        ? String(documentRows[0].title)
        : input.sourceId;
      const activeAssignments = new Set([
        JSON.stringify([input.sourceId, input.sourceRevisionId]),
      ]);
      const canonicalImageFacts = canonicalEvidenceRows.flatMap((item) => {
        const fact = canonicalDealFactFromRow({
          row: item,
          expectedWorkspaceId: input.workspaceId,
          expectedDealId: input.dealId,
          activeAssignments,
          titleForSource: () => title,
          roleForSource: () => documentRows[0]
            ? String(documentRows[0].role ?? "")
            : null,
          revisionForId: () => revisionRows[0]
            ? {
                workspaceId: String(revisionRows[0].workspace_id),
                sourceId: String(revisionRows[0].source_id),
                contentHash: String(revisionRows[0].content_hash),
              }
            : null,
        });
        return fact ? [fact] : [];
      });
      assertConsistentCanonicalEvidenceUnits(
        canonicalImageFacts.flatMap((fact) => fact.sources)
          .filter((source) => "schemaVersion" in source),
      );
      return {
        ...input,
        bundle: DealMemoryBundleSchema.parse({
          dealId: deal.id,
          companyName: deal.companyName,
          status: deal.status,
          facts: [
            ...evidenceRows.map((evidence) => ({
              text: evidence.fact,
              sources: [{
                id: evidence.id,
                provenance: evidence.provenance,
                title,
                documentId: evidence.document_id,
                page: Number(evidence.page),
                excerpt: evidence.excerpt,
              }],
            })),
            ...canonicalImageFacts,
          ],
          interactions: interactionRows.map((interaction) =>
            dealInteractionFromRow({
              row: interaction,
              expectedStatus: deal.status,
              documentRole: documentRows[0]
                ? String(documentRows[0].role ?? "")
                : null,
              revision: revisionRows[0]
                ? {
                    workspaceId: String(revisionRows[0].workspace_id),
                    sourceId: String(revisionRows[0].source_id),
                    contentHash: String(revisionRows[0].content_hash),
                    extractedAt: String(revisionRows[0].extracted_at ?? ""),
                  }
                : null,
            })
          ),
        }),
      };
    },

    findForWorkspace,

    async listForWorkspace(workspaceId) {
      workspaceId = requiredWorkspaceId(workspaceId);
      const query = new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        order: "company_name.asc,id.asc",
      });
      const rows = await request(`/deals?${query}`) as Record<string, unknown>[];
      const revisions = await activeRevisionIds(
        workspaceId,
        rows.map((row) => String(row.id)),
      );
      return rows.map((row) => dealFromRow(
        row,
        (revisions.get(String(row.id)) ?? []).map((value) => value.revisionId),
      ));
    },

    async listActiveSourceAssignments(workspaceId) {
      workspaceId = requiredWorkspaceId(workspaceId);
      const deals = await this.listForWorkspace(workspaceId);
      const eligible = deals.filter((deal) =>
        deal.analysisEligibleAt !== null
        && deal.activeSourceRevisionFingerprint
          === sourceRevisionFingerprint(deal.activeSourceRevisionIds)
      );
      const revisions = await activeRevisionIds(
        workspaceId,
        eligible.map((deal) => deal.id),
      );
      return eligible.flatMap((deal) =>
        (revisions.get(deal.id) ?? []).map((revision) => ({
          workspaceId,
          dealId: deal.id,
          sourceId: revision.sourceId,
          sourceRevisionId: revision.revisionId,
        }))
      ).sort((left, right) =>
        compareUtf8(left.dealId, right.dealId)
        || compareUtf8(left.sourceRevisionId, right.sourceRevisionId)
      );
    },

    async confirmSourceAssignment(rawInput) {
      const input = validateConfirmation(rawInput);
      const response = await request("/rpc/confirm_source_assignment", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          p_assignment: {
            requestId: input.requestId,
            workspaceId: input.workspaceId,
            dealId: input.dealId,
            companyId: input.companyId,
            companyName: input.companyName,
            status: input.status,
            sourceRevisionId: input.sourceRevisionId,
            assignedByUserId: input.assignedByUserId,
            reason: input.reason,
            confirmedAt: input.confirmedAt,
          },
        }),
      }) as Record<string, unknown>;
      return {
        deal: registeredDealFromRpc(response.deal),
        sourceRevision: sourceRevisionFromRpc(response.sourceRevision),
        newlyEligible: Boolean(response.newlyEligible),
      };
    },
  };
}

let singleton: DealRegistry | undefined;

export function getDealRegistry(): DealRegistry {
  if (singleton) return singleton;
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  singleton = url && serviceRoleKey
    ? createSupabaseDealRegistry({ url, serviceRoleKey })
    : createMemoryDealRegistry({ sourceRegistry: getSourceRegistry() });
  return singleton;
}
