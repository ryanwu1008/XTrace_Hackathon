import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
  createMemoryResearchCandidatesRepository,
} from "../../db/repositories/research-candidates";
import { loadBeliefReversalManifest } from "../../lib/belief-reversal/manifest";
import {
  createMemoryDemoDataStore,
  createMemoryPrivateObjectStorage,
} from "../../lib/storage/service";
import {
  assertBeliefReversalDurableSeedState,
  buildBeliefReversalProductConfirmation,
  createBeliefReversalE2EDataRuntime,
  seedAndVerifyBeliefReversalE2EData,
  type BeliefReversalDurableSeedState,
  type BeliefReversalE2EDataRuntime,
} from "../helpers/belief-reversal-e2e-data";
import type {
  BeliefReversalE2EInfrastructure,
} from "../helpers/belief-reversal-e2e-harness";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

test("the faithful confirmation input contains the exact 9 Deal and 4 Market product inputs", () => {
  const confirmation = buildBeliefReversalProductConfirmation();

  assert.deepEqual(confirmation.documentIds, [
    "doc_7bridges",
    "doc_100plus",
    "doc_1906",
    "doc_a_champs",
    "doc_ably",
    "doc_acin",
    "doc_acquco",
    "doc_ada_health",
    "doc_pitch_combined",
    "report_venture_outlook_2026",
    "report_ai_vc_trends_q1_2026",
    "report_robotics_physical_ai_q1_2026",
    "report_silicon_photonics_2024",
  ]);
  assert.equal(confirmation.dealConfirmations.length, 19);
  assert.equal(
    confirmation.documentIds.includes("reference_vc_brain"),
    false,
  );
});

test("the data phase uses production seed and confirmation code, then proves exact durable retry-safe state", async () => {
  const dataStore = createMemoryDemoDataStore();
  const objectStorage = createMemoryPrivateObjectStorage();
  const sourceRegistry = createMemorySourceRegistry();
  const dealRegistry = createMemoryDealRegistry({ sourceRegistry });
  const evidencePacks = createMemoryEvidencePacksRepository();
  const marketEvidenceSnapshots =
    createMemoryMarketEvidenceSnapshotsRepository({
      now: () => new Date("2026-08-01T12:00:00.000Z"),
    });
  const researchCandidates = createMemoryResearchCandidatesRepository();

  const runtime: BeliefReversalE2EDataRuntime = {
    workspaceId: "workspace_demo",
    dataStore,
    objectStorage,
    sourceRegistry,
    dealRegistry,
    evidencePacks,
    marketEvidenceSnapshots,
    researchCandidates,
    async readState() {
      const data = dataStore.inspect();
      const registry = dealRegistry.inspect();
      return {
        counts: {
          companies: data.companies.length,
          deals: registry.deals.length,
          analysisEligibleDeals: registry.deals.filter(
            (deal) => deal.analysisEligibleAt !== null,
          ).length,
          sourceDocuments: data.documents.length,
          sourceRevisions: sourceRegistry.inspect().revisions.length,
          workspaceDocuments: data.workspaceDocuments.length,
          activeAssignments: registry.assignments.filter(
            (assignment) => assignment.supersededAt === null,
          ).length,
          legacyEvidence: data.evidence.length,
          canonicalEvidence: evidencePacks.inspect().sourceEvidence.length,
          sampleInteractions: data.fixtures.length,
          sampleResearchScreeningDocuments: data.documents.filter(
            (document) => document.role === "sample_research_screening_record",
          ).length,
          researchCandidates: researchCandidates.inspect().candidates.length,
          researchSourceAssignments:
            researchCandidates.inspect().sourceBindings.length,
          researchEvidenceGaps:
            researchCandidates.inspect().evidenceGaps.length,
        },
        companyNames: data.companies.map(({ name }) => name).sort(),
        dealCompanyNames: registry.deals
          .map(({ companyName }) => companyName)
          .sort(),
        screeningDealCompanyNames: registry.deals
          .filter(({ status }) => status === "screening")
          .map(({ companyName }) => companyName)
          .sort(),
        sampleInteractions: data.fixtures.map((interaction) => ({
          id: interaction.id,
          documentId: interaction.documentId,
          sourceRevisionId: interaction.sourceRevisionId ?? null,
          dealId: interaction.dealId,
          companyName: interaction.companyName,
          occurredAt: interaction.occurredAt,
          provenance: interaction.provenance,
          label: interaction.label,
          status: interaction.status,
          decisionReason: interaction.decisionReason,
          concerns: [...interaction.concerns],
          revisitConditions: [...interaction.revisitConditions],
          meetingSummary: interaction.meetingSummary,
          priorActions: interaction.priorActions === undefined
            ? null
            : [...interaction.priorActions],
          actionPolicyVersion: interaction.actionPolicyVersion ?? null,
          interactionSchemaVersion:
            interaction.interactionSchemaVersion ?? null,
        })).sort((left, right) => left.id.localeCompare(right.id)),
      };
    },
  };

  const result = await seedAndVerifyBeliefReversalE2EData({
    runtime,
    corpusDirectory: path.join(workspaceRoot, "seed", "corpus"),
  });

  assert.deepEqual(result.originalSeed.created, {
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
  });
  assert.equal(result.confirmation.documentIds.length, 13);
  assert.deepEqual(result.readiness, {
    ready: true,
    confirmedCount: 13,
    requiredCount: 13,
    missingDocumentIds: [],
  });
  assert.deepEqual(result.firstReversalSeed.created, {
    privateObjects: 66,
    documents: 66,
    workspaceDocuments: 66,
    companies: 11,
    deals: 11,
    sourceRevisions: 66,
    assignments: 66,
    canonicalEvidence: 66,
    sampleInteractions: 4,
    researchCandidates: 7,
    researchSourceAssignments: 25,
    researchEvidenceGaps: 1,
  });
  assert.deepEqual(result.secondReversalSeed.created, {
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
  assert.deepEqual(result.finalState.counts, {
    companies: 30,
    deals: 30,
    analysisEligibleDeals: 30,
    sourceDocuments: 80,
    sourceRevisions: 80,
    workspaceDocuments: 79,
    activeAssignments: 85,
    legacyEvidence: 19,
    canonicalEvidence: 66,
    sampleInteractions: 23,
    sampleResearchScreeningDocuments: 7,
    researchCandidates: 7,
    researchSourceAssignments: 25,
    researchEvidenceGaps: 1,
  });
  assert.deepEqual(
    result.finalState.sampleInteractions,
    result.firstState.sampleInteractions,
    "the second reversal seed must not rewrite any Sample decision row",
  );
  assert.equal(objectStorage.inspect().length, 80);
});

test("durable state validation fails closed if a qualified-not-selected screening Deal is missing", () => {
  const state = validDurableState();
  state.screeningDealCompanyNames = state.screeningDealCompanyNames.filter(
    (name) => name !== "Centralize",
  );

  assert.throws(
    () => assertBeliefReversalDurableSeedState(state),
    /qualified-not-selected screening Deal Centralize.*missing/iu,
  );
});

test("durable state validation rejects rewritten typed actions on a new Sample row", () => {
  const state = validDurableState();
  const selectedId = loadBeliefReversalManifest()
    .selectedCases[0]!.priorDecision.id;
  const interaction = state.sampleInteractions.find(
    ({ id }) => id === selectedId,
  )!;
  interaction.priorActions = ["review_analysis_failure"];

  assert.throws(
    () => assertBeliefReversalDurableSeedState(state),
    /Sample decision row/iu,
  );
});

test("a provisioned runtime reads complete durable state through loopback PostgREST", async () => {
  const expected = validDurableState();
  const rowsByTable: Record<string, Record<string, unknown>[]> = {
    companies: expected.companyNames.map((name, index) => ({
      id: `company_${index}`,
      name,
    })),
    deals: expected.dealCompanyNames.map((companyName, index) => ({
      id: `deal_${index}`,
      company_name: companyName,
      status: expected.screeningDealCompanyNames.includes(companyName)
        ? "screening"
        : "passed",
      analysis_eligible_at: "2026-08-03T12:00:00.000Z",
    })),
    source_documents: [
      ...sequenceRows("source_document", 73).map((row) => ({
        ...row,
        role: "public_web_snapshot",
      })),
      ...sequenceRows("sample_research", 7).map((row) => ({
        ...row,
        role: "sample_research_screening_record",
      })),
    ],
    source_revisions: sequenceRows("source_revision", 80),
    workspace_documents: sequenceRows("workspace_document", 79),
    deal_source_assignments: sequenceRows("assignment", 85),
    source_evidence: sequenceRows("legacy_evidence", 19),
    source_evidence_items: sequenceRows("canonical_evidence", 66),
    deal_interactions: expected.sampleInteractions.map((interaction) => ({
      id: interaction.id,
      document_id: interaction.documentId,
      source_revision_id: interaction.sourceRevisionId,
      deal_id: interaction.dealId,
      company_name: interaction.companyName,
      occurred_at: interaction.occurredAt,
      provenance: interaction.provenance,
      label: interaction.label,
      status: interaction.status,
      decision_reason: interaction.decisionReason,
      concerns: interaction.concerns,
      revisit_conditions: interaction.revisitConditions,
      meeting_summary: interaction.meetingSummary,
      prior_actions: interaction.priorActions,
      action_policy_version: interaction.actionPolicyVersion,
      interaction_schema_version: interaction.interactionSchemaVersion,
    })),
    research_candidates: sequenceRows("research_candidate", 7).map(
      (row) => ({ candidate_id: row.id }),
    ),
    research_candidate_source_assignments: Array.from(
      { length: 25 },
      (_, index) => ({
        candidate_id: `research_candidate_${Math.floor(index / 4) + 1}`,
        source_revision_id: `research_source_revision_${index + 1}`,
      }),
    ),
    research_candidate_evidence_gaps: [{
      candidate_id: "research_candidate_1",
      gap_id: "research_gap_1",
    }],
  };
  const serviceRoleJwt = "task12-test-only.jwt.value";
  const postgrestUrl = "http://127.0.0.1:49154";
  const infrastructure: BeliefReversalE2EInfrastructure = {
    target: {
      databaseName: "vsee_belief_e2e_0123456789abcdef",
      postgresHost: "127.0.0.1",
      postgresVersion: "17.6",
      postgrestUrl,
      postgrestVersion: "12.2.3",
    },
    migrationTerminal: {
      index: 22,
      tag: "0022_terminal",
      filename: "0022_terminal.sql",
    },
    serviceRoleJwt,
    environment: {
      NODE_ENV: "test",
      SUPABASE_URL: postgrestUrl,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleJwt,
    },
    async cleanup() {},
  };
  const runtime = createBeliefReversalE2EDataRuntime({
    infrastructure,
    async fetchImpl(input) {
      const url = new URL(
        typeof input === "string" ? input : input.toString(),
      );
      const table = url.pathname.split("/").at(-1)!;
      const rows = rowsByTable[table];
      return rows
        ? Response.json(rows)
        : new Response("missing table", { status: 404 });
    },
  });

  const observed = await runtime.readState();
  assert.deepEqual(observed.counts, expected.counts);
  assertBeliefReversalDurableSeedState(observed);
});

test("the data runtime refuses a non-disposable database before creating repositories", () => {
  const serviceRoleJwt = "task12-test-only.jwt.value";
  const postgrestUrl = "http://127.0.0.1:49154";
  const infrastructure = {
    target: {
      databaseName: "production",
      postgresHost: "127.0.0.1",
      postgresVersion: "17.6",
      postgrestUrl,
      postgrestVersion: "12.2.3",
    },
    migrationTerminal: {
      index: 22,
      tag: "0022_terminal",
      filename: "0022_terminal.sql",
    },
    serviceRoleJwt,
    environment: {
      NODE_ENV: "test",
      SUPABASE_URL: postgrestUrl,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleJwt,
    },
    async cleanup() {},
  } as BeliefReversalE2EInfrastructure;

  assert.throws(
    () => createBeliefReversalE2EDataRuntime({ infrastructure }),
    /disposable loopback/iu,
  );
});

function validDurableState(): BeliefReversalDurableSeedState {
  const manifest = loadBeliefReversalManifest();
  const selected = manifest.selectedCases.map((item) =>
    item.profile.brandName.value
  );
  const selectedInteractions = manifest.selectedCases.map((item) => ({
    id: item.priorDecision.id,
    documentId: `source_${item.priorDecision.id}`,
    sourceRevisionId:
      `source_revision_source_${item.priorDecision.id}_1`,
    dealId: item.dealId,
    companyName: item.profile.brandName.value,
    occurredAt: item.priorDecision.occurredAt,
    provenance: "demo_fixture" as const,
    label: "Sample decision record" as const,
    status: item.priorDecision.status,
    decisionReason: item.priorDecision.decisionReason,
    concerns: [...item.priorDecision.concerns],
    revisitConditions: [...item.priorDecision.revisitConditions],
    meetingSummary: item.priorDecision.meetingSummary,
    priorActions: [item.priorDecision.priorAction],
    actionPolicyVersion: "belief-action-policy-v1",
    interactionSchemaVersion: "sample-decision-interaction-v1",
  }));
  const legacyNames = Array.from(
    { length: 19 },
    (_, index) => `Original Company ${String(index + 1).padStart(2, "0")}`,
  );
  const legacyInteractions = legacyNames.map((companyName, index) => ({
    id: `legacy_interaction_${index + 1}`,
    documentId: `legacy_document_${index + 1}`,
    sourceRevisionId: `legacy_revision_${index + 1}`,
    dealId: `legacy_deal_${index + 1}`,
    companyName,
    occurredAt: "2026-01-01T00:00:00.000Z",
    provenance: "demo_fixture",
    label: "Sample decision record",
    status: "passed" as const,
    decisionReason: "Legacy reason",
    concerns: ["Legacy concern"],
    revisitConditions: ["Legacy revisit condition"],
    meetingSummary: "Legacy meeting summary",
    priorActions: null,
    actionPolicyVersion: null,
    interactionSchemaVersion: null,
  }));
  const screeningNames = manifest.candidateLedger.flatMap((candidate) =>
    candidate.disposition === "qualified_not_selected"
      ? [candidate.companyIdentity.brandName]
      : []
  );
  return {
    counts: {
      companies: 30,
      deals: 30,
      analysisEligibleDeals: 30,
      sourceDocuments: 80,
      sourceRevisions: 80,
      workspaceDocuments: 79,
      activeAssignments: 85,
      legacyEvidence: 19,
      canonicalEvidence: 66,
      sampleInteractions: 23,
      sampleResearchScreeningDocuments: 7,
      researchCandidates: 7,
      researchSourceAssignments: 25,
      researchEvidenceGaps: 1,
    },
    companyNames: [...legacyNames, ...selected, ...screeningNames],
    dealCompanyNames: [...legacyNames, ...selected, ...screeningNames],
    screeningDealCompanyNames: screeningNames,
    sampleInteractions: [...legacyInteractions, ...selectedInteractions],
  };
}

function sequenceRows(prefix: string, length: number): Record<string, unknown>[] {
  return Array.from({ length }, (_, index) => ({
    id: `${prefix}_${index + 1}`,
  }));
}
