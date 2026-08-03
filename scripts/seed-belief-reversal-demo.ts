import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import {
  getDealRegistry,
  type DealMemoryLineage,
  type DealRegistry,
} from "../db/repositories/deal-registry";
import {
  getEvidencePacksRepository,
  type EvidencePacksRepository,
  type SourceEvidenceInput,
} from "../db/repositories/evidence-packs";
import {
  getSourceRegistry,
  type SourceRegistry,
} from "../db/repositories/source-registry";
import {
  getMarketEvidenceSnapshotsRepository,
  type MarketEvidenceSnapshotsRepository,
} from "../db/repositories/market-evidence-snapshots";
import { loadBeliefReversalManifest } from "../lib/belief-reversal/manifest";
import { buildSampleDecisionSourceRef } from "../lib/belief-reversal/sample-decision-source";
import type { BeliefReversalResearchPackage } from "../lib/belief-reversal/contracts";
import {
  DealMemoryBundleSchema,
  type BeliefActionKind,
  type DealFact,
  type DealMemoryBundle,
} from "../lib/contracts/domain";
import {
  APPROVED_PINNED_DEMO_SNAPSHOT_ID,
} from "../lib/contracts/evidence-context";
import {
  WritableSourceRefV2Schema,
  type WritableSourceRefV2,
  type WritableMarketEventV2,
} from "../lib/contracts/source-evidence";
import { refingerprintMarketEvent } from "../lib/market/identity";
import { metadataForBeliefActionKind } from "../lib/reports/action-policy";
import {
  createDefaultDemoDataStore,
  createDefaultPrivateObjectStorage,
  type BeliefReversalSeedDataStore,
  type ImmutableSourceDocumentRecord,
  type PrivateObjectStorage,
  type SampleDecisionInteractionRecord,
  type UpsertResult,
} from "../lib/storage/service";

const WORKSPACE_ID = "workspace_demo";
const ASSIGNED_BY_USER_ID = "user_demo";
const ACTION_POLICY_VERSION = "belief-action-policy-v1";
const INTERACTION_SCHEMA_VERSION = "sample-decision-interaction-v1";
const EXTRACTOR_ID = "reviewed-json-snapshot";
const EXTRACTOR_VERSION = "belief-reversal-source-v1";
const PROVIDER_ID = "belief_reversal_snapshot_v1";

export interface BeliefReversalSeedDependencies {
  dataStore: BeliefReversalSeedDataStore;
  objectStorage: PrivateObjectStorage;
  sourceRegistry: SourceRegistry;
  dealRegistry: DealRegistry;
  evidencePacks: EvidencePacksRepository;
  marketEvidenceSnapshots: MarketEvidenceSnapshotsRepository;
}

export interface BeliefReversalSeedResult {
  created: {
    privateObjects: number;
    documents: number;
    workspaceDocuments: number;
    companies: number;
    deals: number;
    sourceRevisions: number;
    assignments: number;
    canonicalEvidence: number;
    sampleInteractions: number;
  };
  totals: {
    acceptedCases: 4;
    publicSources: 37;
    sampleDecisionRecords: 4;
    sourceParents: 41;
  };
}

interface PlannedSource {
  document: ImmutableSourceDocumentRecord;
  revision: {
    id: string;
    workspaceId: string;
    sourceId: string;
    contentHash: string;
    objectKey: string;
    objectVersion: string;
    contentType: string;
    extractorId: string;
    extractorVersion: string;
    extractedAt: string;
    createdAt: string;
  };
  bytes: Uint8Array;
  dealId: string;
  companyId: string;
  companyName: string;
  status: "passed" | "watchlist" | "invested";
}

interface PlannedCase {
  company: { id: string; workspaceId: string; name: string };
  deal: {
    id: string;
    workspaceId: string;
    companyId: string;
    companyName: string;
    status: "passed" | "watchlist" | "invested";
  };
  sources: PlannedSource[];
  evidence: SourceEvidenceInput[];
  sampleInteraction: SampleDecisionInteractionRecord;
  memoryBundle: DealMemoryBundle;
  memoryLineage: DealMemoryLineage;
  marketEvents: WritableMarketEventV2[];
}

interface BeliefReversalSeedPlan {
  cases: PlannedCase[];
  sources: PlannedSource[];
}

export async function runBeliefReversalDemoSeed(
  dependencies: BeliefReversalSeedDependencies,
  options: { manifest?: BeliefReversalResearchPackage } = {},
): Promise<BeliefReversalSeedResult> {
  const plan = buildSeedPlan(options.manifest ?? loadBeliefReversalManifest());
  const created = emptyCreatedCounts();

  for (const source of plan.sources) {
    increment(
      created,
      "privateObjects",
      await dependencies.objectStorage.ensurePrivateObject({
        key: source.document.objectKey,
        bytes: source.bytes,
        contentType: "application/json",
      }),
    );
  }
  for (const source of plan.sources) {
    increment(
      created,
      "documents",
      await dependencies.dataStore.ensureImmutableSourceDocument(
        source.document,
      ),
    );
    increment(
      created,
      "workspaceDocuments",
      await dependencies.dataStore.ensureWorkspaceDocument({
        workspaceId: WORKSPACE_ID,
        documentId: source.document.id,
      }),
    );
    const priorRevision = await dependencies.sourceRegistry.getRevision({
      workspaceId: WORKSPACE_ID,
      revisionId: source.revision.id,
    });
    await dependencies.sourceRegistry.createInitialRevision(source.revision);
    if (priorRevision === null) created.sourceRevisions += 1;
  }

  for (const plannedCase of plan.cases) {
    increment(
      created,
      "companies",
      await dependencies.dataStore.ensureImmutableCompany(plannedCase.company),
    );
    increment(
      created,
      "deals",
      await dependencies.dataStore.ensureImmutableDeal(plannedCase.deal),
    );
  }

  for (const plannedCase of plan.cases) {
    for (const source of plannedCase.sources) {
      const before = await dependencies.dealRegistry.findForWorkspace({
        workspaceId: WORKSPACE_ID,
        dealId: plannedCase.deal.id,
      });
      const alreadyAssigned = before?.activeSourceRevisionIds.includes(
        source.revision.id,
      ) ?? false;
      await dependencies.dealRegistry.confirmSourceAssignment({
        requestId: `belief_reversal_assignment_${source.document.id}_v1`,
        workspaceId: WORKSPACE_ID,
        dealId: plannedCase.deal.id,
        companyId: plannedCase.company.id,
        companyName: plannedCase.company.name,
        status: plannedCase.deal.status,
        sourceRevisionId: source.revision.id,
        assignedByUserId: ASSIGNED_BY_USER_ID,
        reason: "Approved belief-reversal source snapshot.",
        confirmedAt: source.revision.createdAt,
        memoryBundle: plannedCase.memoryBundle,
        memoryLineage: plannedCase.memoryLineage,
      });
      if (!alreadyAssigned) created.assignments += 1;
    }
    const priorEvidence = await dependencies.evidencePacks.listSourceEvidence({
      workspaceId: WORKSPACE_ID,
      dealId: plannedCase.deal.id,
      sourceRevisionIds: plannedCase.sources.map((source) => source.revision.id),
    });
    const priorEvidenceIds = new Set(priorEvidence.map((item) => item.id));
    await dependencies.evidencePacks.putSourceEvidence(plannedCase.evidence);
    created.canonicalEvidence += plannedCase.evidence.filter(
      (item) => !priorEvidenceIds.has(item.id),
    ).length;
    increment(
      created,
      "sampleInteractions",
      await dependencies.dataStore.ensureSampleDecisionInteraction(
        plannedCase.sampleInteraction,
      ),
    );
  }

  await dependencies.marketEvidenceSnapshots.create({
    schemaVersion: "market-evidence-snapshot-v1",
    workspaceId: WORKSPACE_ID,
    id: APPROVED_PINNED_DEMO_SNAPSHOT_ID,
    snapshotAsOfDate: "2026-08-01",
    windowDays: 14,
    anchorAt: "2026-08-01T23:59:59.999-07:00",
    windowStartAt: "2026-07-18T00:00:00.000-07:00",
    windowEndAt: "2026-08-01T23:59:59.999-07:00",
    windowTimezone: "America/Los_Angeles",
    events: plan.cases.flatMap(({ marketEvents }) => marketEvents),
  });

  return {
    created,
    totals: {
      acceptedCases: 4,
      publicSources: 37,
      sampleDecisionRecords: 4,
      sourceParents: 41,
    },
  };
}

export async function runDefaultBeliefReversalDemoSeed(input: {
  environment?: Readonly<Record<string, string | undefined>>;
  createDependencies?: () => BeliefReversalSeedDependencies;
} = {}): Promise<BeliefReversalSeedResult> {
  const environment = input.environment ?? process.env;
  assertLocalSeedTarget(environment);
  const createDependencies = input.createDependencies ?? (() => ({
    dataStore: createDefaultDemoDataStore(),
    objectStorage: createDefaultPrivateObjectStorage(),
    sourceRegistry: getSourceRegistry(),
    dealRegistry: getDealRegistry(),
    evidencePacks: getEvidencePacksRepository(),
    marketEvidenceSnapshots: getMarketEvidenceSnapshotsRepository(),
  }));
  return runBeliefReversalDemoSeed(createDependencies());
}

export function assertLocalSeedTarget(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  if (environment.NODE_ENV === "production") {
    throw new Error("Belief-reversal demo seed refuses production.");
  }
  const urlValue = environment.SUPABASE_URL?.trim();
  const keyValue = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (Boolean(urlValue) !== Boolean(keyValue)) {
    throw new Error("Local Supabase URL and credentials must be configured together.");
  }
  if (!urlValue) return;
  let parsed: URL;
  try {
    parsed = new URL(urlValue);
  } catch {
    throw new Error("The local Supabase URL is malformed.");
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/gu, "");
  if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    throw new Error("Belief-reversal demo seed requires an exact loopback host.");
  }
}

function buildSeedPlan(
  manifest: BeliefReversalResearchPackage,
): BeliefReversalSeedPlan {
  const cases: PlannedCase[] = manifest.selectedCases.map((selectedCase) => {
    const companyName = selectedCase.profile.brandName.value;
    const status = selectedCase.priorDecision.status;
    const publicSources = selectedCase.sources.map((source) => {
      const snapshot = {
        schemaVersion: "belief-reversal-public-source-snapshot-v1",
        packageId: manifest.packageId,
        caseId: selectedCase.id,
        source: {
          id: source.id,
          title: source.title,
          publisher: source.publisher,
          canonicalUrl: source.canonicalUrl,
          sourceClass: source.sourceClass,
          sourceAuthority: source.sourceAuthority,
          evidenceRole: source.evidenceRole,
          eventAt: source.eventAt,
          publishedAt: source.publishedAt,
          publicationTimestamp: source.publicationTimestamp,
          retrievedAt: source.retrievedAt,
          locator: source.locator,
          verbatimExcerpt: source.verbatimExcerpt,
          normalizedStatement: source.normalizedStatement,
          supportedClaimId: source.supportedClaimId,
        },
      };
      return plannedSource({
        id: source.id,
        title: source.title,
        role: "public_web_snapshot",
        companyName,
        dealId: selectedCase.dealId,
        snapshot,
        extractedAt: `${manifest.retrievalDate}T00:00:00.000Z`,
        companyId: selectedCase.companyId,
        status,
      });
    });
    const sampleDocumentId = `source_${selectedCase.priorDecision.id}`;
    const sampleSource = plannedSource({
      id: sampleDocumentId,
      title: "Sample decision record",
      role: "sample_decision_record",
      companyName,
      dealId: selectedCase.dealId,
      snapshot: {
        schemaVersion: INTERACTION_SCHEMA_VERSION,
        packageId: manifest.packageId,
        caseId: selectedCase.id,
        priorDecision: selectedCase.priorDecision,
      },
      extractedAt: `${manifest.retrievalDate}T00:00:00.000Z`,
      companyId: selectedCase.companyId,
      status,
    });
    const sourceById = new Map(publicSources.map((source) => [
      source.document.id,
      source,
    ]));
    const sourceRefById = new Map(selectedCase.sources.map((researchSource) => {
      const source = sourceById.get(researchSource.id);
      if (!source) throw new Error(`Approved source ${researchSource.id} was not planned.`);
      return [researchSource.id, publicSourceRef(
        manifest,
        selectedCase.entityKeys,
        researchSource,
        source.revision.id,
        source.revision.contentHash,
      )] as const;
    }));
    const marketEvents = selectedCase.events.map((event) => {
      const sources = event.sourceIds.map((sourceId) => {
        const source = sourceRefById.get(sourceId);
        if (!source) throw new Error(`Event ${event.id} has an unplanned source.`);
        return source;
      });
      const trigger = sourceRefById.get(event.triggerSourceId);
      if (!trigger) throw new Error(`Event ${event.id} has an unplanned trigger source.`);
      return refingerprintMarketEvent({
        schemaVersion: "market-event-v2",
        adaptation: "canonical",
        id: event.id,
        title: event.title,
        eventType: event.eventType,
        sectors: [...event.sectors],
        themes: [...event.themes],
        summary: event.summary,
        positiveImplications: [...event.positiveImplications],
        negativeImplications: [...event.negativeImplications],
        eventAt: trigger.eventAt ?? trigger.publishedAt!,
        eventAtPrecision: trigger.eventAtPrecision
          ?? trigger.publishedAtPrecision!,
        publishedAt: trigger.publishedAt!,
        publishedAtPrecision: trigger.publishedAtPrecision!,
        retrievedAt: trigger.retrievedAt!,
        retrievedAtPrecision: trigger.retrievedAtPrecision!,
        updatedAt: trigger.updatedAt,
        updatedAtPrecision: trigger.updatedAtPrecision,
        confidence: event.confidence,
        canonicalUrl: trigger.canonicalUrl!,
        providerId: trigger.providerId!,
        contentFingerprint: `sha256:${"0".repeat(64)}`,
        entityKeys: [...selectedCase.entityKeys],
        triggerSourceId: trigger.id,
        sources,
      });
    });
    const semanticFieldsBySource = semanticFieldsForCase(selectedCase);
    const evidence = selectedCase.claims.map((claim): SourceEvidenceInput => {
      const researchSource = selectedCase.sources.find((source) =>
        source.id === claim.sourceId
      );
      const source = sourceById.get(claim.sourceId);
      if (!researchSource || !source) {
        throw new Error(`Claim ${claim.id} is missing its approved source.`);
      }
      const sourceRef = publicSourceRef(
        manifest,
        selectedCase.entityKeys,
        researchSource,
        source.revision.id,
        source.revision.contentHash,
      );
      const semanticFields = semanticFieldsBySource.get(researchSource.id)
        ?? [];
      return {
        id: claim.id,
        workspaceId: WORKSPACE_ID,
        dealId: selectedCase.dealId,
        sourceId: researchSource.id,
        sourceRevisionId: source.revision.id,
        provenanceOrigin: "public_source",
        field: "public_claim",
        value: claim.statement,
        unit: null,
        currency: null,
        periodStart: null,
        periodEnd: null,
        publishedAt: temporalTimestamp(
          researchSource.publicationTimestamp ?? researchSource.publishedAt,
        ),
        eventAt: temporalTimestamp(researchSource.eventAt),
        retrievedAt: temporalTimestamp(researchSource.retrievedAt)!,
        locator: {
          kind: "web_snapshot",
          url: researchSource.canonicalUrl,
          excerpt: researchSource.verbatimExcerpt,
        },
        sourceRole: researchSource.sourceAuthority === "primary"
          ? "first_party_filing"
          : "independent_third_party",
        assertionStatus: "reported",
        verificationMethod: "reviewed_public_snapshot_v1",
        freshness: "current",
        acceptedForGate: true,
        sourceRef,
        semanticFields,
      };
    });
    const sampleInteraction: SampleDecisionInteractionRecord = {
      id: selectedCase.priorDecision.id,
      workspaceId: WORKSPACE_ID,
      documentId: sampleDocumentId,
      sourceRevisionId: sampleSource.revision.id,
      dealId: selectedCase.dealId,
      companyName,
      occurredAt: selectedCase.priorDecision.occurredAt,
      provenance: "demo_fixture",
      label: "Sample decision record",
      status,
      decisionReason: selectedCase.priorDecision.decisionReason,
      concerns: [...selectedCase.priorDecision.concerns],
      revisitConditions: [...selectedCase.priorDecision.revisitConditions],
      meetingSummary: selectedCase.priorDecision.meetingSummary,
      priorActions: [selectedCase.priorDecision.priorAction],
      actionPolicyVersion: ACTION_POLICY_VERSION,
      interactionSchemaVersion: INTERACTION_SCHEMA_VERSION,
    };
    const memoryLineage: DealMemoryLineage = {
      evidence: Object.fromEntries(evidence.map((item) => [item.id, {
        workspaceId: WORKSPACE_ID,
        dealId: selectedCase.dealId,
        sourceId: item.sourceId,
        sourceRevisionId: item.sourceRevisionId,
      }])),
      interactions: {
        [sampleInteraction.id]: {
          workspaceId: WORKSPACE_ID,
          dealId: selectedCase.dealId,
          sourceId: sampleDocumentId,
          sourceRevisionId: sampleSource.revision.id,
        },
      },
    };
    const priorKind = selectedCase.priorDecision.priorAction as BeliefActionKind;
    const sampleSourceRef = buildSampleDecisionSourceRef({
      id: sampleInteraction.id,
      documentId: sampleDocumentId,
      sourceRevisionId: sampleSource.revision.id,
      contentFingerprint: sampleSource.revision.contentHash,
      occurredAt: selectedCase.priorDecision.occurredAt,
      retrievedAt: sampleSource.revision.extractedAt,
      summary: sampleInteraction.meetingSummary,
      decisionReason: sampleInteraction.decisionReason,
      concerns: sampleInteraction.concerns,
      revisitConditions: sampleInteraction.revisitConditions,
    });
    const memoryBundle = DealMemoryBundleSchema.parse({
      dealId: selectedCase.dealId,
      companyName,
      status,
      facts: evidence.map((item) => ({
        text: item.value,
        sources: [item.sourceRef!],
        semanticFields: item.semanticFields,
      })),
      interactions: [{
        id: sampleInteraction.id,
        occurredAt: new Date(sampleInteraction.occurredAt).toISOString(),
        summary: sampleInteraction.meetingSummary,
        decisionReason: sampleInteraction.decisionReason,
        concerns: sampleInteraction.concerns,
        revisitConditions: sampleInteraction.revisitConditions,
        priorActions: [{
          kind: priorKind,
          ...metadataForBeliefActionKind(priorKind),
        }],
        actionPolicyVersion: sampleInteraction.actionPolicyVersion,
        interactionSchemaVersion: sampleInteraction.interactionSchemaVersion,
        provenance: "demo_fixture",
        label: "Sample decision record",
        source: sampleSourceRef,
      }],
    });
    return {
      company: {
        id: selectedCase.companyId,
        workspaceId: WORKSPACE_ID,
        name: companyName,
      },
      deal: {
        id: selectedCase.dealId,
        workspaceId: WORKSPACE_ID,
        companyId: selectedCase.companyId,
        companyName,
        status,
      },
      sources: [...publicSources, sampleSource],
      evidence,
      sampleInteraction,
      memoryBundle,
      memoryLineage,
      marketEvents,
    };
  });
  const sources = cases.flatMap((item) => item.sources);
  if (
    cases.length !== 4
    || cases.flatMap((item) => item.evidence).length !== 37
    || sources.length !== 41
    || new Set(sources.map((source) => source.document.id)).size !== 41
  ) {
    throw new Error("The approved belief-reversal seed plan must remain 4/37/4.");
  }
  return { cases, sources };
}

function semanticFieldsForCase(
  selectedCase: BeliefReversalResearchPackage["selectedCases"][number],
): Map<string, NonNullable<DealFact["semanticFields"]>> {
  type Projection = NonNullable<DealFact["semanticFields"]>[number];
  const result = new Map<string, NonNullable<DealFact["semanticFields"]>>();
  const identity = (
    fieldId: Projection["fieldId"],
    classification: Projection["classification"],
    sourceKeys: readonly string[],
  ) => ({
    id: `semantic-field-${createHash("sha256").update(canonicalJsonBytes({
      dealId: selectedCase.dealId,
      fieldId,
      classification,
      sourceKeys: [...sourceKeys].sort(),
    })).digest("hex").slice(0, 24)}`,
    schemaVersion: "deal-semantic-field-v1" as const,
  });
  const add = (sourceId: string, projection: Projection): void => {
    const current = result.get(sourceId) ?? [];
    current.push(projection);
    result.set(sourceId, current);
  };
  const addFact = (
    fieldId: Projection["fieldId"],
    value: string,
    sourceIds: readonly string[],
    extras: { basis?: string; asOfDate?: string } = {},
  ): void => {
    add(sourceIds[0]!, {
      ...identity(fieldId, "fact", sourceIds),
      fieldId,
      classification: "fact",
      availability: "available",
      value,
      sourceIds: [...sourceIds],
      ...extras,
    });
  };
  const addUnavailable = (
    fieldId: Projection["fieldId"],
    reason: string,
    checkedSourceIds: readonly string[],
  ): void => {
    add(checkedSourceIds[0]!, {
      ...identity(fieldId, "unavailable", checkedSourceIds),
      fieldId,
      classification: "unavailable",
      availability: "unavailable",
      reason,
      checkedSourceIds: [...checkedSourceIds],
    });
  };

  addFact(
    "company_identity",
    selectedCase.profile.brandName.value,
    [selectedCase.profile.brandName.sourceId],
  );
  addFact(
    "official_domain",
    selectedCase.profile.officialDomain.value,
    [selectedCase.profile.officialDomain.sourceId],
  );
  addFact(
    "founders",
    selectedCase.profile.founders.map((founder) => founder.name).join(", "),
    [...new Set(selectedCase.profile.founders.map((founder) => founder.sourceId))],
  );
  for (const [fieldId, field] of [
    ["legal_name", selectedCase.profile.legalName],
    ["stage", selectedCase.profile.stage],
    ["business_model", selectedCase.profile.businessModel],
    ["geography", selectedCase.profile.geography],
  ] as const) {
    if (field.availability === "available") {
      addFact(fieldId, field.value, [field.sourceId]);
    } else {
      addUnavailable(fieldId, field.reason, field.checkedSourceIds);
    }
  }
  if (selectedCase.foundingDate.status === "available") {
    addFact(
      "founding_date",
      selectedCase.foundingDate.value,
      [selectedCase.foundingDate.sourceId],
    );
  } else if (selectedCase.foundingDate.status === "unavailable") {
    addUnavailable(
      "founding_date",
      selectedCase.foundingDate.reason,
      selectedCase.foundingDate.checkedSourceIds,
    );
  } else {
    add(selectedCase.foundingDate.observations[0]!.sourceId, {
      ...identity(
        "founding_date",
        "conflicting",
        selectedCase.foundingDate.observations.map(({ sourceId }) => sourceId),
      ),
      fieldId: "founding_date",
      classification: "conflicting",
      observations: selectedCase.foundingDate.observations.map(
        (observation) => ({ ...observation }),
      ),
    });
  }
  add(selectedCase.profile.brandName.sourceId, {
    ...identity(
      "security_type",
      "assumption",
      ["belief-reversal-demo-context-v1"],
    ),
    fieldId: "security_type",
    classification: "assumption",
    value: selectedCase.profile.securityType.value,
    basis: "assumption",
    requiresConfirmation: true,
    assumptionPolicyVersion: "belief-reversal-demo-context-v1",
    rationale: selectedCase.profile.securityType.rationale,
    sourceBoundary: selectedCase.profile.securityType.sourceBoundary,
  });

  const metricEntries = [
    ["reported_valuation", selectedCase.metrics.reportedValuation],
    ["customer_evidence", selectedCase.metrics.customerEvidence],
    ["cash", selectedCase.metrics.cash],
    ["burn", selectedCase.metrics.burn],
    ["runway", selectedCase.metrics.runway],
    ["retention", selectedCase.metrics.retention],
    ["customer_count", selectedCase.metrics.customerCount],
  ] as const;
  for (const [fieldId, metric] of metricEntries) {
    if (metric.availability === "available") {
      addFact(fieldId, metric.value, metric.sourceIds, {
        basis: metric.basis,
        asOfDate: metric.asOfDate,
      });
    } else {
      addUnavailable(fieldId, metric.reason, metric.checkedSourceIds);
    }
  }
  const arrOrRevenue = selectedCase.metrics.arrOrRevenue;
  if (arrOrRevenue.availability === "available") {
    addFact("revenue", arrOrRevenue.value, arrOrRevenue.sourceIds, {
      basis: arrOrRevenue.basis,
      asOfDate: arrOrRevenue.asOfDate,
    });
  } else {
    addUnavailable("arr", arrOrRevenue.reason, arrOrRevenue.checkedSourceIds);
    addUnavailable(
      "revenue",
      arrOrRevenue.reason,
      arrOrRevenue.checkedSourceIds,
    );
  }
  const valuationBasis = selectedCase.metrics.reportedValuationBasis;
  if (valuationBasis.availability === "available") {
    addFact(
      "reported_valuation_basis",
      valuationBasis.statement,
      valuationBasis.sourceIds,
      { basis: valuationBasis.basisType },
    );
  } else {
    addUnavailable(
      "reported_valuation_basis",
      valuationBasis.reason,
      valuationBasis.checkedSourceIds,
    );
  }
  for (const unknown of selectedCase.unknowns) {
    add(selectedCase.profile.brandName.sourceId, {
      ...identity("unknowns", "unknown", [
        `context-unknown:${createHash("sha256").update(unknown).digest("hex")}`,
      ]),
      fieldId: "unknowns",
      classification: "unknown",
      reason: unknown,
    });
  }
  return result;
}

function plannedSource(input: {
  id: string;
  title: string;
  role: "public_web_snapshot" | "sample_decision_record";
  companyName: string;
  dealId: string;
  snapshot: unknown;
  extractedAt: string;
  companyId: string;
  status: "passed" | "watchlist" | "invested";
}): PlannedSource {
  const bytes = canonicalJsonBytes(input.snapshot);
  const checksum = sha256(bytes);
  const objectKey =
    `private/belief-reversal/2026-08-01/${checksum}/${input.id}.json`;
  const document: ImmutableSourceDocumentRecord = {
    id: input.id,
    filename: `${input.id}.json`,
    title: input.title,
    role: input.role,
    companyName: input.companyName,
    dealId: input.dealId,
    checksum,
    byteSize: bytes.byteLength,
    objectKey,
  };
  return {
    document,
    revision: {
      id: `source_revision_${input.id}_1`,
      workspaceId: WORKSPACE_ID,
      sourceId: input.id,
      contentHash: checksum,
      objectKey,
      objectVersion: checksum,
      contentType: "application/json",
      extractorId: EXTRACTOR_ID,
      extractorVersion: EXTRACTOR_VERSION,
      extractedAt: input.extractedAt,
      createdAt: input.extractedAt,
    },
    bytes,
    dealId: input.dealId,
    companyId: input.companyId,
    companyName: input.companyName,
    status: input.status,
  };
}

function publicSourceRef(
  manifest: BeliefReversalResearchPackage,
  entityKeys: readonly string[],
  source: BeliefReversalResearchPackage["selectedCases"][number]["sources"][number],
  sourceRevisionId: string,
  contentFingerprint: string,
): WritableSourceRefV2 {
  const publishedAt = source.publicationTimestamp ?? source.publishedAt;
  return WritableSourceRefV2Schema.parse({
    schemaVersion: "source-ref-v2",
    adaptation: "canonical",
    id: source.supportedClaimId,
    provenance: "public_web",
    title: source.title,
    canonicalUrl: source.canonicalUrl,
    documentId: source.id,
    publisher: source.publisher,
    providerId: PROVIDER_ID,
    eventAt: source.eventAt,
    eventAtPrecision: source.eventAt === null ? null : "date",
    publishedAt,
    publishedAtPrecision: publishedAt === null
      ? null
      : source.publicationTimestamp === null
      ? "date"
      : "timestamp",
    retrievedAt: manifest.retrievalDate,
    retrievedAtPrecision: "date",
    updatedAt: null,
    updatedAtPrecision: null,
    entityKeys: [...entityKeys],
    sourceClass: source.sourceClass,
    sourceAuthority: source.sourceAuthority,
    evidenceRole: source.evidenceRole,
    sourceRevisionId,
    locator: { kind: "web_text", selector: source.locator },
    contentFingerprint,
    text: {
      status: "verified_exact",
      verbatimExcerpt: source.verbatimExcerpt,
      normalizedStatement: source.normalizedStatement,
    },
  });
}

function temporalTimestamp(value: string | null): string | null {
  if (value === null) return null;
  return /^\d{4}-\d{2}-\d{2}$/u.test(value)
    ? `${value}T00:00:00.000Z`
    : new Date(value).toISOString();
}

function canonicalJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(canonicalValue(value))}\n`);
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function emptyCreatedCounts(): BeliefReversalSeedResult["created"] {
  return {
    privateObjects: 0,
    documents: 0,
    workspaceDocuments: 0,
    companies: 0,
    deals: 0,
    sourceRevisions: 0,
    assignments: 0,
    canonicalEvidence: 0,
    sampleInteractions: 0,
  };
}

function increment(
  counts: BeliefReversalSeedResult["created"],
  key: keyof BeliefReversalSeedResult["created"],
  result: UpsertResult<unknown>,
): void {
  if (result.created) counts[key] += 1;
}

async function main(): Promise<void> {
  if (process.argv.length > 2) {
    throw new Error("The belief-reversal demo seed accepts no arguments.");
  }
  console.log(JSON.stringify(await runDefaultBeliefReversalDemoSeed()));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
