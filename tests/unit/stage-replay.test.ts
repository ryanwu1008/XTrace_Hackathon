import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCandidateGroundingSnapshot,
} from "../../lib/underwriting/stage-replay";

test("context-router replay preserves assumption and semantic availability evidence", () => {
  const snapshot = {
    identityEvidence: {
      asOfDate: "2026-08-01",
      companyIdentity: [{
        value: "company_irregular_v1",
        basis: "confirmed",
        evidenceItemId: "deal-confirmation:deal_irregular_v1",
      }],
      stage: [{
        value: "series_a",
        basis: "source_explicit",
        evidenceItemId: "semantic-stage",
      }],
      businessModel: [{
        value: "enterprise_ai",
        basis: "source_explicit",
        evidenceItemId: "semantic-business-model",
      }],
      geography: [{
        value: "unavailable",
        basis: "semantic_availability",
        evidenceItemId: "semantic-geography-unavailable",
      }],
      securityType: [{
        value: "preferred",
        basis: "assumption",
        evidenceItemId: "semantic-security-assumption",
      }],
    },
    sourceRevisionIds: [],
    sourceRevisionSnapshots: [],
    xtraceLineage: {
      memoryIds: [],
      sourceRevisionIds: [],
      sourceIds: [],
      fixtureIds: [],
      capturedAt: "2026-08-01T12:00:00.000Z",
    },
  };

  assert.deepEqual(parseCandidateGroundingSnapshot(snapshot), snapshot);
});
