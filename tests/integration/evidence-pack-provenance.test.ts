import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryEvidencePacksRepository } from "../../db/repositories/evidence-packs";
import { createMemorySourceRegistry } from "../../db/repositories/source-registry";
import type { ResolvedUnderwritingContext } from "../../lib/contracts/underwriting";
import { createEvidencePackBuilder } from "../../lib/underwriting/evidence/builder";
import {
  createContextRouter,
  type CriticalEvidenceProfile,
} from "../../lib/underwriting/router";

const context: ResolvedUnderwritingContext = {
  id: "underwriting_context_seed_b2b_saas_v1",
  contextVersion: "1",
  stage: "seed",
  businessModel: "b2b_saas",
  geography: "us",
  securityType: "preferred",
  asOfDate: "2026-07-29",
  criticalEvidenceProfileId: "profile_1",
  benchmarkPackId: "benchmark_pack_synthetic_us_software_v1",
  benchmarkCompatibility: "exact",
  valuationMethodPolicyId: "valuation_method_1",
  decisionPolicyId: "decision_policy_1",
  frameworkPackId: "framework_pack_1",
};

const profile: CriticalEvidenceProfile = {
  id: "profile_1",
  version: "1",
  publicationStatus: "published",
  definitionFingerprint: `sha256:${"c".repeat(64)}`,
  fields: [{
    fieldId: "company_identity",
    critical: true,
    minimumModelInput: true,
    acceptedAssertionStatuses: ["reported"],
    acceptedFreshness: ["current"],
  }],
};

const referenceInputs = {
  fundPolicy: {
    id: "fund_policy:workspace_1:v1",
    workspaceId: "workspace_1",
    version: 1,
    source: "recommended_policy" as const,
    values: {
      scenarioPriceMultipliers: {
        bear: "0.75",
        base: "1",
        bull: "1.25",
      },
    },
    createdByUserId: null,
    createdAt: "2026-07-29T08:00:00.000Z",
  },
  benchmark: {
    packId: context.benchmarkPackId!,
    entryId: "benchmark_entry_synthetic_seed_valuation_v1",
    version: "1",
    value: "24000000",
    currency: "USD",
    effectiveAt: "2026-07-29",
    staleAfter: "2027-01-25",
    definitionFingerprint: `sha256:${"b".repeat(64)}`,
  },
};

async function fixture() {
  const sourceRegistry = createMemorySourceRegistry();
  const repository = createMemoryEvidencePacksRepository();
  await sourceRegistry.createInitialRevision({
    id: "revision_1",
    workspaceId: "workspace_1",
    sourceId: "source_1",
    contentHash: "sha256:exact-content-hash",
    objectKey: "private/deal_1/source_1.md",
    objectVersion: "object:v1",
    contentType: "text/markdown",
    extractorId: "plain_text_v1",
    extractorVersion: "1",
    extractedAt: "2026-07-29T09:00:00+00:00",
    createdAt: "2026-07-29T09:00:01+00:00",
  });
  await repository.putSourceEvidence([{
    id: "fact_company",
    workspaceId: "workspace_1",
    dealId: "deal_1",
    sourceId: "source_1",
    sourceRevisionId: "revision_1",
    provenanceOrigin: "uploaded_document",
    field: "Company identity",
    value: "company_1",
    unit: null,
    currency: null,
    periodStart: null,
    periodEnd: null,
    publishedAt: null,
    eventAt: null,
    retrievedAt: "2026-07-29T09:01:00.000Z",
    locator: {
      kind: "text_range",
      start: 11,
      end: 20,
      excerpt: "Company 1",
    },
    sourceRole: "management",
    assertionStatus: "reported",
    verificationMethod: null,
    freshness: "current",
    acceptedForGate: true,
  }]);
  return {
    sourceRegistry,
    repository,
    builder: createEvidencePackBuilder({
      repository,
      sourceRegistry,
      router: createContextRouter(),
      criticalEvidenceProfiles: [profile],
      now: () => new Date("2026-07-29T09:02:00.000Z"),
    }),
  };
}

test("persists the exact pack fingerprint and immutable source revision snapshots", async () => {
  const { builder, repository } = await fixture();
  const pack = await builder.build({
    workspaceId: "workspace_1",
    dealId: "deal_1",
    asOfDate: "2026-07-29",
    sourceRevisionIds: ["revision_1"],
    xtraceLineage: {
      memoryIds: ["memory_1"],
      sourceRevisionIds: ["revision_1"],
      sourceIds: ["source_1"],
      fixtureIds: [],
      capturedAt: "2026-07-29T09:01:30.000Z",
    },
    context,
    ...referenceInputs,
  });

  const saved = await repository.findByPackId({
    workspaceId: "workspace_1",
    packId: pack.id,
  });
  assert.ok(saved);
  assert.match(saved.inputFingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(saved.pack, pack);
  assert.deepEqual(saved.sourceRevisionSnapshots, [{
    id: "revision_1",
    workspaceId: "workspace_1",
    sourceId: "source_1",
    revision: 1,
    contentHash: "sha256:exact-content-hash",
    objectKey: "private/deal_1/source_1.md",
    objectVersion: "object:v1",
    contentType: "text/markdown",
    extractorId: "plain_text_v1",
    extractorVersion: "1",
    extractedAt: "2026-07-29T09:00:00.000Z",
    supersedesRevisionId: null,
    createdAt: "2026-07-29T09:00:01.000Z",
  }]);
  assert.deepEqual(saved.pack.facts[0]?.locator, {
    kind: "text_range",
    start: 11,
    end: 20,
    excerpt: "Company 1",
  });
});

test("rejects XTrace recalled-only text that cannot resolve to local source lineage", async () => {
  const { builder } = await fixture();

  await assert.rejects(
    builder.build({
      workspaceId: "workspace_1",
      dealId: "deal_1",
      asOfDate: "2026-07-29",
      sourceRevisionIds: ["revision_1"],
      xtraceLineage: {
        memoryIds: ["recalled_only_memory"],
        sourceRevisionIds: [],
        sourceIds: [],
        fixtureIds: [],
        capturedAt: "2026-07-29T09:01:30.000Z",
      },
      context,
      ...referenceInputs,
    }),
    /XTrace.*local source revision lineage/i,
  );
});

test("rejects XTrace lineage that names a source outside the exact revision snapshots", async () => {
  const { builder } = await fixture();

  await assert.rejects(
    builder.build({
      workspaceId: "workspace_1",
      dealId: "deal_1",
      asOfDate: "2026-07-29",
      sourceRevisionIds: ["revision_1"],
      xtraceLineage: {
        memoryIds: ["memory_1"],
        sourceRevisionIds: ["revision_1"],
        sourceIds: ["source_2"],
        fixtureIds: [],
        capturedAt: "2026-07-29T09:01:30.000Z",
      },
      context,
      ...referenceInputs,
    }),
    /XTrace.*source lineage/i,
  );
});

test("exact Sample decision lineage binds its revision through fixtureIds without becoming a factual source", async () => {
  const { builder, sourceRegistry } = await fixture();
  await sourceRegistry.createInitialRevision({
    id: "revision_sample",
    workspaceId: "workspace_1",
    sourceId: "source_fixture_1",
    contentHash: "sha256:sample-decision-record",
    objectKey: "private/deal_1/sample.json",
    objectVersion: "object:sample:v1",
    contentType: "application/json",
    extractorId: "sample_decision_v1",
    extractorVersion: "1",
    extractedAt: "2026-07-29T09:00:00.000Z",
    createdAt: "2026-07-29T09:00:01.000Z",
  });

  const pack = await builder.build({
    workspaceId: "workspace_1",
    dealId: "deal_1",
    asOfDate: "2026-07-29",
    sourceRevisionIds: ["revision_1", "revision_sample"],
    xtraceLineage: {
      memoryIds: ["memory_public", "memory_sample"],
      sourceRevisionIds: ["revision_1", "revision_sample"],
      sourceIds: ["source_1"],
      fixtureIds: ["fixture_1"],
      capturedAt: "2026-07-29T09:01:30.000Z",
    },
    context,
    ...referenceInputs,
  });

  assert.deepEqual(pack.sourceRevisionIds, ["revision_1", "revision_sample"]);
  assert.equal(pack.facts.some(({ sourceRevisionId }) =>
    sourceRevisionId === "revision_sample"
  ), false);
});
