import assert from "node:assert/strict";
import test from "node:test";

import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";

import { deals, scanRunSteps } from "../../db/schema";
import {
  CandidateVersionSnapshotSchema,
} from "../../db/repositories/underwriting-artifacts";
import {
  CurrentFrameworkJudgmentSchema,
  FrameworkJudgmentReadSchema,
} from "../../lib/contracts/underwriting";

const dialect = new PgDialect();

function checks(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).checks.map((constraint) => ({
    name: constraint.name,
    definition: dialect.sqlToQuery(constraint.value).sql,
  }));
}

test("Deal status is declared only on Deals, never scan run steps", () => {
  assert.deepEqual(checks(scanRunSteps), []);
  assert.deepEqual(checks(deals), [{
    name: "deals_status_check",
    definition:
      `"deals"."status" in ('screening', 'watchlist', 'evaluating', 'passed', 'invested')`,
  }]);
});

const versionSnapshot = {
  fundPolicyId: "policy_1",
  benchmarkPackId: null,
  benchmarkEntryId: null,
  benchmarkDefinitionFingerprint: null,
  frameworkPackId: "framework_pack_1",
  frameworkPackDefinitionFingerprint: `sha256:${"1".repeat(64)}`,
  routerVersion: "context-router-v2",
  criticalEvidenceProfileId: "profile_1",
  criticalEvidenceProfileDefinitionFingerprint: `sha256:${"2".repeat(64)}`,
  valuationMethodPolicyId: "valuation_policy_1",
  valuationMethodPolicyDefinitionFingerprint: `sha256:${"3".repeat(64)}`,
  decisionPolicyId: "decision_policy_1",
  decisionPolicyDefinitionFingerprint: `sha256:${"4".repeat(64)}`,
  referenceCatalogFingerprint: `sha256:${"5".repeat(64)}`,
  formulaVersions: ["returns@1"],
  providerModel: "claude-test",
  promptVersion: "prompt-v1",
  schemaVersion: "schema-v1",
  settingsFingerprint: "settings_1",
  applicationCommit: "commit_1",
};

test("pins all five Named Lens version values together", () => {
  const current = {
    ...versionSnapshot,
    namedLensSelectionPolicyVersion: "named-lens-selection-v1",
    namedLensPassageSchemaVersion: "named-lens-passage-v1",
    namedLensGeneratorVersion: "named-lens-generator-v1",
    underwritingPresentationSchemaVersion: "decision-first-named-lens-v1",
    decisionTaxonomyVersion: "named-lens-decision-taxonomy-v1",
  };
  assert.deepEqual(CandidateVersionSnapshotSchema.parse(current), current);
  assert.deepEqual(
    CandidateVersionSnapshotSchema.parse(versionSnapshot),
    versionSnapshot,
  );
  assert.throws(() => CandidateVersionSnapshotSchema.parse({
    ...current,
    namedLensGeneratorVersion: undefined,
  }));
});

const legacyJudgment = {
  id: "judgment_1",
  analysisType: "framework_judgment",
  frameworkCardId: "card_1",
  frameworkVersion: "1",
  applicability: "applicable",
  conclusion: "mixed",
  supportEvidenceItemIds: ["fact_1"],
  counterEvidenceItemIds: ["fact_2"],
  unusedEvidenceItemIds: [],
  strongestSupport: "Support",
  strongestCounterargument: "Counter",
  unknowns: [],
  limitations: [],
  confidence: {
    sourceReliability: "high",
    evidenceStrength: "medium",
    evidenceCoverage: "medium",
    applicability: "high",
    judgment: "medium",
  },
  claimEdges: [],
  fingerprint: "sha256:legacy",
};

test("keeps legacy judgments in an explicit read branch and closes current boundaries", () => {
  assert.deepEqual(
    FrameworkJudgmentReadSchema.parse(legacyJudgment),
    legacyJudgment,
  );
  assert.throws(() => CurrentFrameworkJudgmentSchema.parse(legacyJudgment));
  assert.deepEqual(CurrentFrameworkJudgmentSchema.parse({
    ...legacyJudgment,
    counterevidenceBoundary: {
      kind: "grounded_counterevidence",
      evidenceRequestRefs: [],
    },
  }).counterEvidenceItemIds, ["fact_2"]);
  assert.throws(() => CurrentFrameworkJudgmentSchema.parse({
    ...legacyJudgment,
    counterEvidenceItemIds: [],
    counterevidenceBoundary: {
      kind: "no_candidate_local_counterevidence",
      evidenceRequestRefs: [],
    },
  }));
});
