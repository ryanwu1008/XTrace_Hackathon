import assert from "node:assert/strict";
import test from "node:test";

import type { DealSemanticField } from "../../lib/contracts/domain";
import {
  buildCandidateMissingEvidence,
} from "../../lib/underwriting/missing-evidence";

const CHANNEL_UNKNOWN = {
  id: `semantic-field-${"a".repeat(24)}`,
  schemaVersion: "deal-semantic-field-v1",
  fieldId: "unknowns",
  classification: "unknown",
  reason:
    "Akamai and Kyndryl channel bookings, margins, and sell-through remain unavailable.",
  externalLabel: "Current partner bookings, margins, and sell-through",
} satisfies DealSemanticField;

const CUSTOMER_FACT = {
  id: `semantic-field-${"b".repeat(24)}`,
  schemaVersion: "deal-semantic-field-v1",
  fieldId: "customer_count",
  classification: "fact",
  availability: "available",
  value: "12",
  sourceIds: ["source_customer_count"],
} satisfies DealSemanticField;

test("merges generic blockers with typed company/event unknowns in stable order", () => {
  const forward = buildCandidateMissingEvidence({
    criticalFieldIds: ["runway", "arr", "runway"],
    structuredFields: [CUSTOMER_FACT, CHANNEL_UNKNOWN],
  });
  const reversed = buildCandidateMissingEvidence({
    criticalFieldIds: ["runway", "arr"].reverse(),
    structuredFields: [CHANNEL_UNKNOWN, CUSTOMER_FACT].reverse(),
  });

  assert.deepEqual(forward, [{
    fieldId: "arr",
    label: "arr",
    externalLabel: "arr",
    reasonCode: "MISSING_CRITICAL_EVIDENCE",
    mostLikelyDecisionImpact:
      "Providing accepted evidence may raise or lower the formal decision ceiling.",
  }, {
    fieldId: "runway",
    label: "runway",
    externalLabel: "runway",
    reasonCode: "MISSING_CRITICAL_EVIDENCE",
    mostLikelyDecisionImpact:
      "Providing accepted evidence may raise or lower the formal decision ceiling.",
  }, {
    fieldId: CHANNEL_UNKNOWN.id,
    label: CHANNEL_UNKNOWN.reason,
    externalLabel: CHANNEL_UNKNOWN.externalLabel,
    reasonCode: "UNRESOLVED_COMPANY_OR_EVENT_UNKNOWN",
    mostLikelyDecisionImpact:
      "Resolving this company- or event-specific unknown may raise or lower the formal decision ceiling.",
  }]);
  assert.deepEqual(reversed, forward);
});

test("fails closed when one persisted semantic ID has conflicting unknown text", () => {
  assert.throws(() => buildCandidateMissingEvidence({
    criticalFieldIds: [],
    structuredFields: [
      CHANNEL_UNKNOWN,
      { ...CHANNEL_UNKNOWN, reason: "A conflicting persisted unknown." },
    ],
  }), /conflicting missing-evidence payload.*semantic-field/u);
});
