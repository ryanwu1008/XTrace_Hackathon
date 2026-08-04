import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  createSupabaseDealRegistry,
  type DealRegistry,
} from "../../db/repositories/deal-registry";
import {
  createSupabaseEvidencePacksRepository,
  type EvidencePacksRepository,
} from "../../db/repositories/evidence-packs";
import {
  createSupabaseMarketEvidenceSnapshotsRepository,
  type MarketEvidenceSnapshotsRepository,
} from "../../db/repositories/market-evidence-snapshots";
import {
  createSupabaseSourceRegistry,
  type SourceRegistry,
} from "../../db/repositories/source-registry";
import {
  createSupabaseResearchCandidatesRepository,
  type ResearchCandidatesRepository,
} from "../../db/repositories/research-candidates";
import { loadBeliefReversalManifest } from "../../lib/belief-reversal/manifest";
import {
  DealStatusSchema,
  type DealStatus,
} from "../../lib/contracts/domain";
import {
  confirmImport,
  type ConfirmImportInput,
  type ConfirmImportResult,
} from "../../lib/corpus/service";
import { getProductInputReadiness } from "../../lib/corpus/import-readiness";
import {
  listDocumentDeals,
  listPreloadedDocuments,
} from "../../lib/corpus/manifest";
import {
  createCorpusPersistence,
  createMemoryPrivateObjectStorage,
  createPrivateDocumentAccess,
  createSupabaseDemoDataStore,
  type BeliefReversalSeedDataStore,
  type DemoDataStore,
  type PrivateObjectStorage,
} from "../../lib/storage/service";
import {
  runBeliefReversalDemoSeed,
  type BeliefReversalSeedResult,
} from "../../scripts/seed-belief-reversal-demo";
import { runDemoSeed, type DemoSeedResult } from "../../scripts/seed-demo";
import type {
  BeliefReversalE2EInfrastructure,
} from "./belief-reversal-e2e-harness";
import { assertDisposableDatabaseName } from "./require-loopback-postgres";

export const BELIEF_REVERSAL_E2E_WORKSPACE_ID = "workspace_demo" as const;

const EXPECTED_COUNTS = Object.freeze({
  companies: 30,
  deals: 30,
  analysisEligibleDeals: 30,
  sourceDocuments: 80,
  sourceRevisions: 80,
  workspaceDocuments: 79,
  activeAssignments: 85,
  legacyEvidence: 19,
  canonicalEvidence: 62,
  sampleInteractions: 23,
  sampleResearchScreeningDocuments: 7,
  researchCandidates: 7,
  researchSourceAssignments: 25,
  researchEvidenceGaps: 1,
});

const ZERO_REVERSAL_CREATED: BeliefReversalSeedResult["created"] = Object.freeze({
  privateObjects: 0,
  documents: 0,
  workspaceDocuments: 0,
  companies: 0,
  deals: 0,
  sourceRevisions: 0,
  assignments: 0,
  canonicalEvidence: 0,
  sampleInteractions: 0,
  researchCandidates: 0,
  researchSourceAssignments: 0,
  researchEvidenceGaps: 0,
});

export interface BeliefReversalDurableSampleInteraction {
  id: string;
  documentId: string;
  sourceRevisionId: string | null;
  dealId: string;
  companyName: string;
  occurredAt: string;
  provenance: string;
  label: string;
  status: DealStatus;
  decisionReason: string;
  concerns: string[];
  revisitConditions: string[];
  meetingSummary: string;
  priorActions: string[] | null;
  actionPolicyVersion: string | null;
  interactionSchemaVersion: string | null;
}

export interface BeliefReversalDurableSeedState {
  counts: {
    companies: number;
    deals: number;
    analysisEligibleDeals: number;
    sourceDocuments: number;
    sourceRevisions: number;
    workspaceDocuments: number;
    activeAssignments: number;
    legacyEvidence: number;
    canonicalEvidence: number;
    sampleInteractions: number;
    sampleResearchScreeningDocuments: number;
    researchCandidates: number;
    researchSourceAssignments: number;
    researchEvidenceGaps: number;
  };
  companyNames: string[];
  dealCompanyNames: string[];
  screeningDealCompanyNames: string[];
  sampleInteractions: BeliefReversalDurableSampleInteraction[];
}

export interface BeliefReversalE2EDataRuntime {
  workspaceId: typeof BELIEF_REVERSAL_E2E_WORKSPACE_ID;
  dataStore: DemoDataStore & BeliefReversalSeedDataStore;
  objectStorage: PrivateObjectStorage;
  sourceRegistry: SourceRegistry;
  dealRegistry: DealRegistry;
  evidencePacks: EvidencePacksRepository;
  marketEvidenceSnapshots: MarketEvidenceSnapshotsRepository;
  researchCandidates: ResearchCandidatesRepository;
  readState(): Promise<BeliefReversalDurableSeedState>;
}

export interface BeliefReversalE2EDataResult {
  runtime: BeliefReversalE2EDataRuntime;
  originalSeed: DemoSeedResult;
  confirmation: ConfirmImportResult;
  readiness: Awaited<ReturnType<typeof getProductInputReadiness>>;
  firstReversalSeed: BeliefReversalSeedResult;
  secondReversalSeed: BeliefReversalSeedResult;
  firstState: BeliefReversalDurableSeedState;
  finalState: BeliefReversalDurableSeedState;
}

export function buildBeliefReversalProductConfirmation(): ConfirmImportInput {
  const documents = listPreloadedDocuments().filter(
    (document) => document.role !== "reference",
  );
  const dealDocuments = documents.filter(
    (document) => document.role === "deal_document",
  );
  const marketDocuments = documents.filter(
    (document) => document.role === "market_report",
  );
  const dealConfirmations = dealDocuments.flatMap((document) =>
    listDocumentDeals(document).map((deal) => ({
      documentId: document.id,
      dealId: deal.dealId,
    }))
  );
  if (
    documents.length !== 13
    || dealDocuments.length !== 9
    || marketDocuments.length !== 4
    || dealConfirmations.length !== 19
  ) {
    throw new Error(
      "Belief-reversal E2E requires exactly 9 Deal and 4 Market product inputs with 19 Deal confirmations.",
    );
  }
  return {
    workspaceId: BELIEF_REVERSAL_E2E_WORKSPACE_ID,
    documentIds: documents.map((document) => document.id),
    dealConfirmations,
  };
}

export function createBeliefReversalE2EDataRuntime(input: {
  infrastructure: BeliefReversalE2EInfrastructure;
  fetchImpl?: typeof fetch;
}): BeliefReversalE2EDataRuntime {
  const url = input.infrastructure.target.postgrestUrl;
  const serviceRoleKey = input.infrastructure.serviceRoleJwt;
  assertProvisionedRuntimeIdentity(input.infrastructure);
  const fetchImpl = input.fetchImpl ?? fetch;
  const dataStore = createSupabaseDemoDataStore({
    url,
    serviceRoleKey,
    fetchImpl,
  });
  const sourceRegistry = createSupabaseSourceRegistry({
    url,
    serviceRoleKey,
    fetchImpl,
  });
  const dealRegistry = createSupabaseDealRegistry({
    url,
    serviceRoleKey,
    fetchImpl,
  });
  const evidencePacks = createSupabaseEvidencePacksRepository({
    url,
    serviceRoleKey,
    fetchImpl,
  });
  const marketEvidenceSnapshots =
    createSupabaseMarketEvidenceSnapshotsRepository({
      url,
      serviceRoleKey,
      fetchImpl,
    });
  const researchCandidates = createSupabaseResearchCandidatesRepository({
    url,
    serviceRoleKey,
    fetchImpl,
  });
  return {
    workspaceId: BELIEF_REVERSAL_E2E_WORKSPACE_ID,
    dataStore,
    objectStorage: createMemoryPrivateObjectStorage(),
    sourceRegistry,
    dealRegistry,
    evidencePacks,
    marketEvidenceSnapshots,
    researchCandidates,
    readState: () => readBeliefReversalDurableSeedState({
      postgrestUrl: url,
      serviceRoleKey,
      fetchImpl,
    }),
  };
}

export async function seedAndVerifyBeliefReversalE2EData(input: {
  runtime: BeliefReversalE2EDataRuntime;
  corpusDirectory?: string;
}): Promise<BeliefReversalE2EDataResult> {
  if (input.runtime.workspaceId !== BELIEF_REVERSAL_E2E_WORKSPACE_ID) {
    throw new Error("Belief-reversal E2E data runtime has the wrong workspace.");
  }
  const originalSeed = await runDemoSeed({
    dataStore: input.runtime.dataStore,
    objectStorage: input.runtime.objectStorage,
    sourceRegistry: input.runtime.sourceRegistry,
    dealRegistry: input.runtime.dealRegistry,
    corpusDirectory: input.corpusDirectory
      ?? path.join(process.cwd(), "seed", "corpus"),
  });
  assertExactObject(
    originalSeed.created,
    {
      workspaces: 1,
      users: 1,
      memberships: 1,
      documents: 14,
      workspaceDocuments: 0,
      privateObjects: 14,
      companies: 19,
      deals: 19,
      evidence: 19,
      fixtures: 19,
    },
    "original demo seed creation counts",
  );

  const confirmationInput = buildBeliefReversalProductConfirmation();
  const confirmation = await confirmImport(
    confirmationInput,
    createCorpusPersistence(
      input.runtime.dataStore,
      createPrivateDocumentAccess({
        signingSecret:
          "vsee-task12-test-only-document-signing-secret-0001",
      }),
    ),
  );
  if (
    confirmation.documentIds.length !== 13
    || confirmation.memoryBundles.length !== 19
    || !isDeepStrictEqual(
      confirmation.documentIds,
      confirmationInput.documentIds,
    )
  ) {
    throw new Error(
      "Belief-reversal E2E production confirmation did not retain all 13 exact product inputs.",
    );
  }
  const readiness = await getProductInputReadiness(
    input.runtime.dataStore,
    input.runtime.workspaceId,
  );
  assertExactObject(readiness, {
    ready: true,
    confirmedCount: 13,
    requiredCount: 13,
    missingDocumentIds: [],
  }, "product-input readiness");

  const seedDependencies = {
    dataStore: input.runtime.dataStore,
    objectStorage: input.runtime.objectStorage,
    sourceRegistry: input.runtime.sourceRegistry,
    dealRegistry: input.runtime.dealRegistry,
    evidencePacks: input.runtime.evidencePacks,
    marketEvidenceSnapshots: input.runtime.marketEvidenceSnapshots,
    researchCandidates: input.runtime.researchCandidates,
  };
  const firstReversalSeed = await runBeliefReversalDemoSeed(seedDependencies);
  assertExactObject(firstReversalSeed.created, {
    privateObjects: 66,
    documents: 66,
    workspaceDocuments: 66,
    companies: 11,
    deals: 11,
    sourceRevisions: 66,
    assignments: 66,
    canonicalEvidence: 62,
    sampleInteractions: 4,
    researchCandidates: 7,
    researchSourceAssignments: 25,
    researchEvidenceGaps: 1,
  }, "first reversal seed creation counts");
  const firstState = await input.runtime.readState();
  assertBeliefReversalDurableSeedState(firstState);

  const secondReversalSeed = await runBeliefReversalDemoSeed(seedDependencies);
  assertExactObject(
    secondReversalSeed.created,
    ZERO_REVERSAL_CREATED,
    "second reversal seed creation counts",
  );
  const finalState = await input.runtime.readState();
  assertBeliefReversalDurableSeedState(finalState);
  assertSelectedSampleRowsUnchanged(firstState, finalState);

  return {
    runtime: input.runtime,
    originalSeed,
    confirmation,
    readiness,
    firstReversalSeed,
    secondReversalSeed,
    firstState,
    finalState,
  };
}

export function assertBeliefReversalDurableSeedState(
  state: BeliefReversalDurableSeedState,
): void {
  assertExactObject(state.counts, EXPECTED_COUNTS, "durable seed counts");
  if (state.counts.legacyEvidence + state.counts.canonicalEvidence !== 81) {
    throw new Error(
      "Belief-reversal E2E requires exactly 81 evidence rows (19 legacy + 62 canonical).",
    );
  }
  if (
    state.companyNames.length !== state.counts.companies
    || state.dealCompanyNames.length !== state.counts.deals
    || state.sampleInteractions.length !== state.counts.sampleInteractions
  ) {
    throw new Error("Belief-reversal E2E durable readback is incomplete.");
  }

  const manifest = loadBeliefReversalManifest();
  const qualifiedNotSelected = manifest.candidateLedger.filter(
    (entry) => entry.disposition === "qualified_not_selected",
  );
  if (qualifiedNotSelected.length !== 7) {
    throw new Error(
      "Belief-reversal E2E requires exactly seven qualified-not-selected candidates.",
    );
  }
  for (const candidate of qualifiedNotSelected) {
    const name = candidate.companyIdentity.brandName;
    if (
      !state.companyNames.includes(name)
      || !state.dealCompanyNames.includes(name)
      || !state.screeningDealCompanyNames.includes(name)
    ) {
      throw new Error(
        `Belief-reversal E2E qualified-not-selected screening Deal ${name} is missing from the analysis-eligible registries.`,
      );
    }
  }

  for (const selectedCase of manifest.selectedCases) {
    const name = selectedCase.profile.brandName.value;
    if (
      !state.companyNames.includes(name)
      || !state.dealCompanyNames.includes(name)
    ) {
      throw new Error(
        `Belief-reversal E2E selected company ${name} is missing from registries.`,
      );
    }
    const matches = state.sampleInteractions.filter(
      (interaction) => interaction.id === selectedCase.priorDecision.id,
    );
    if (matches.length !== 1) {
      throw new Error(
        `Belief-reversal E2E requires one exact Sample decision row for ${name}.`,
      );
    }
    const interaction = matches[0]!;
    assertExactObject(interaction, {
      id: selectedCase.priorDecision.id,
      documentId: `source_${selectedCase.priorDecision.id}`,
      sourceRevisionId:
        `source_revision_source_${selectedCase.priorDecision.id}_1`,
      dealId: selectedCase.dealId,
      companyName: name,
      occurredAt: selectedCase.priorDecision.occurredAt,
      provenance: "demo_fixture",
      label: "Sample decision record",
      status: selectedCase.priorDecision.status,
      decisionReason: selectedCase.priorDecision.decisionReason,
      concerns: [...selectedCase.priorDecision.concerns],
      revisitConditions: [...selectedCase.priorDecision.revisitConditions],
      meetingSummary: selectedCase.priorDecision.meetingSummary,
      priorActions: [selectedCase.priorDecision.priorAction],
      actionPolicyVersion: "belief-action-policy-v1",
      interactionSchemaVersion: "sample-decision-interaction-v1",
    }, `Sample decision row for ${name}`, { normalizeOccurredAt: true });
  }
  if (state.sampleInteractions.some((interaction) =>
    interaction.provenance !== "demo_fixture"
    || interaction.label !== "Sample decision record"
  )) {
    throw new Error(
      "Belief-reversal E2E requires every interaction to remain a permanently labeled Sample decision record.",
    );
  }
}

async function readBeliefReversalDurableSeedState(input: {
  postgrestUrl: string;
  serviceRoleKey: string;
  fetchImpl: typeof fetch;
}): Promise<BeliefReversalDurableSeedState> {
  const scoped = {
    workspace_id: `eq.${BELIEF_REVERSAL_E2E_WORKSPACE_ID}`,
  };
  const [
    companies,
    deals,
    sourceDocuments,
    sourceRevisions,
    workspaceDocuments,
    activeAssignments,
    legacyEvidence,
    canonicalEvidence,
    interactions,
    researchCandidates,
    researchSourceAssignments,
    researchEvidenceGaps,
  ] = await Promise.all([
    postgrestRows(input, "companies", {
      ...scoped,
      select: "id,name",
      order: "id.asc",
    }),
    postgrestRows(input, "deals", {
      ...scoped,
      select: "id,company_name,status,analysis_eligible_at",
      order: "id.asc",
    }),
    postgrestRows(input, "source_documents", {
      select: "id,role",
      order: "id.asc",
    }),
    postgrestRows(input, "source_revisions", {
      ...scoped,
      select: "id",
      order: "id.asc",
    }),
    postgrestRows(input, "workspace_documents", {
      ...scoped,
      select: "document_id",
      order: "document_id.asc",
    }),
    postgrestRows(input, "deal_source_assignments", {
      ...scoped,
      superseded_at: "is.null",
      select: "id",
      order: "id.asc",
    }),
    postgrestRows(input, "source_evidence", {
      ...scoped,
      select: "id",
      order: "id.asc",
    }),
    postgrestRows(input, "source_evidence_items", {
      ...scoped,
      select: "evidence_id",
      order: "evidence_id.asc",
    }),
    postgrestRows(input, "deal_interactions", {
      ...scoped,
      select: [
        "id",
        "document_id",
        "source_revision_id",
        "deal_id",
        "company_name",
        "occurred_at",
        "provenance",
        "label",
        "status",
        "decision_reason",
        "concerns",
        "revisit_conditions",
        "meeting_summary",
        "prior_actions",
        "action_policy_version",
        "interaction_schema_version",
      ].join(","),
      order: "id.asc",
    }),
    postgrestRows(input, "research_candidates", {
      ...scoped,
      select: "candidate_id",
      order: "candidate_id.asc",
    }),
    postgrestRows(input, "research_candidate_source_assignments", {
      ...scoped,
      select: "candidate_id,source_revision_id",
      order: "candidate_id.asc,source_revision_id.asc",
    }),
    postgrestRows(input, "research_candidate_evidence_gaps", {
      ...scoped,
      select: "candidate_id,gap_id",
      order: "candidate_id.asc,gap_id.asc",
    }),
  ]);

  return {
    counts: {
      companies: companies.length,
      deals: deals.length,
      analysisEligibleDeals: deals.filter((row) =>
        row.analysis_eligible_at !== null
      ).length,
      sourceDocuments: sourceDocuments.length,
      sourceRevisions: sourceRevisions.length,
      workspaceDocuments: workspaceDocuments.length,
      activeAssignments: activeAssignments.length,
      legacyEvidence: legacyEvidence.length,
      canonicalEvidence: canonicalEvidence.length,
      sampleInteractions: interactions.length,
      sampleResearchScreeningDocuments: sourceDocuments.filter((row) =>
        row.role === "sample_research_screening_record"
      ).length,
      researchCandidates: researchCandidates.length,
      researchSourceAssignments: researchSourceAssignments.length,
      researchEvidenceGaps: researchEvidenceGaps.length,
    },
    companyNames: companies.map((row) => requiredString(row.name, "company name"))
      .sort(),
    dealCompanyNames: deals.map((row) =>
      requiredString(row.company_name, "Deal company name")
    ).sort(),
    screeningDealCompanyNames: deals.filter((row) => row.status === "screening")
      .map((row) => requiredString(row.company_name, "screening Deal company name"))
      .sort(),
    sampleInteractions: interactions.map(interactionFromRow)
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

async function postgrestRows(
  input: {
    postgrestUrl: string;
    serviceRoleKey: string;
    fetchImpl: typeof fetch;
  },
  table: string,
  query: Readonly<Record<string, string>>,
): Promise<Record<string, unknown>[]> {
  const url = new URL(
    `/rest/v1/${table}`,
    `${input.postgrestUrl.replace(/\/$/u, "")}/`,
  );
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  const response = await input.fetchImpl(url, {
    headers: {
      apikey: input.serviceRoleKey,
      authorization: `Bearer ${input.serviceRoleKey}`,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(
      `Belief-reversal E2E durable readback failed for ${table}.`,
    );
  }
  const value = await response.json() as unknown;
  if (!Array.isArray(value) || value.some((row) =>
    row === null || typeof row !== "object" || Array.isArray(row)
  )) {
    throw new Error(
      `Belief-reversal E2E durable readback was malformed for ${table}.`,
    );
  }
  return value as Record<string, unknown>[];
}

function interactionFromRow(
  row: Readonly<Record<string, unknown>>,
): BeliefReversalDurableSampleInteraction {
  return {
    id: requiredString(row.id, "interaction id"),
    documentId: requiredString(row.document_id, "interaction document id"),
    sourceRevisionId: nullableString(
      row.source_revision_id,
      "interaction source revision id",
    ),
    dealId: requiredString(row.deal_id, "interaction Deal id"),
    companyName: requiredString(row.company_name, "interaction company name"),
    occurredAt: requiredString(row.occurred_at, "interaction occurrence time"),
    provenance: requiredString(row.provenance, "interaction provenance"),
    label: requiredString(row.label, "interaction label"),
    status: DealStatusSchema.parse(row.status),
    decisionReason: requiredString(
      row.decision_reason,
      "interaction decision reason",
    ),
    concerns: stringArray(row.concerns, "interaction concerns"),
    revisitConditions: stringArray(
      row.revisit_conditions,
      "interaction revisit conditions",
    ),
    meetingSummary: requiredString(
      row.meeting_summary,
      "interaction meeting summary",
    ),
    priorActions: nullableStringArray(
      row.prior_actions,
      "interaction prior actions",
    ),
    actionPolicyVersion: nullableString(
      row.action_policy_version,
      "interaction action policy version",
    ),
    interactionSchemaVersion: nullableString(
      row.interaction_schema_version,
      "interaction schema version",
    ),
  };
}

function assertProvisionedRuntimeIdentity(
  infrastructure: BeliefReversalE2EInfrastructure,
): void {
  try {
    assertDisposableDatabaseName(infrastructure.target.databaseName);
    const parsed = new URL(infrastructure.target.postgrestUrl);
    if (
      infrastructure.target.postgresHost !== "127.0.0.1"
      || infrastructure.target.postgresVersion !== "17.6"
      || infrastructure.target.postgrestVersion !== "12.2.3"
      || parsed.protocol !== "http:"
      || parsed.hostname !== "127.0.0.1"
      || parsed.port.length === 0
      || parsed.pathname !== "/"
      || parsed.username.length > 0
      || parsed.password.length > 0
      || parsed.search.length > 0
      || parsed.hash.length > 0
      || infrastructure.environment.NODE_ENV !== "test"
      || infrastructure.environment.SUPABASE_URL
        !== infrastructure.target.postgrestUrl
      || infrastructure.environment.SUPABASE_SERVICE_ROLE_KEY
        !== infrastructure.serviceRoleJwt
      || infrastructure.serviceRoleJwt.trim().length === 0
    ) {
      throw new Error("invalid runtime identity");
    }
  } catch {
    throw new Error(
      "Belief-reversal E2E data runtime requires verified disposable loopback infrastructure.",
    );
  }
}

function assertSelectedSampleRowsUnchanged(
  first: BeliefReversalDurableSeedState,
  second: BeliefReversalDurableSeedState,
): void {
  const ids = new Set(
    loadBeliefReversalManifest().selectedCases.map(
      (selectedCase) => selectedCase.priorDecision.id,
    ),
  );
  const select = (state: BeliefReversalDurableSeedState) =>
    state.sampleInteractions.filter(({ id }) => ids.has(id));
  assertExactObject(
    select(second),
    select(first),
    "immutable Sample decision rows after retry",
    { normalizeOccurredAt: true },
  );
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Belief-reversal E2E ${label} is invalid.`);
  }
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return requiredString(value, label);
}

function stringArray(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value)
    || value.some((item) => typeof item !== "string")
  ) {
    throw new Error(`Belief-reversal E2E ${label} is invalid.`);
  }
  return value.map(String);
}

function nullableStringArray(value: unknown, label: string): string[] | null {
  return value === null ? null : stringArray(value, label);
}

function normalizedForComparison(
  value: unknown,
  options: { normalizeOccurredAt?: boolean },
): unknown {
  const cloned = structuredClone(value) as unknown;
  if (!options.normalizeOccurredAt) return cloned;
  const normalize = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) normalize(item);
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    const record = candidate as Record<string, unknown>;
    if (typeof record.occurredAt === "string") {
      record.occurredAt = new Date(record.occurredAt).toISOString();
    }
    for (const item of Object.values(record)) normalize(item);
  };
  normalize(cloned);
  return cloned;
}

function assertExactObject(
  actual: unknown,
  expected: unknown,
  label: string,
  options: { normalizeOccurredAt?: boolean } = {},
): void {
  const normalizedActual = normalizedForComparison(actual, options);
  const normalizedExpected = normalizedForComparison(expected, options);
  if (!isDeepStrictEqual(normalizedActual, normalizedExpected)) {
    throw new Error(`Belief-reversal E2E ${label} did not match exactly.`);
  }
}
