import assert from "node:assert/strict";
import test from "node:test";

import {
  canRunPinnedDemo,
  evidenceContextLabel,
  formatEvidenceWindow,
} from "../../app/page";

test("UI evidence labels present a readable evidence window for live, pinned replay, and legacy reports", () => {
  const current = {
    state: "current" as const,
    schemaVersion: "run-evidence-context-v1" as const,
    windowDays: 14 as const,
    anchorAt: "2026-08-01T23:59:59.999Z",
    windowStartAt: "2026-07-18T00:00:00.000Z",
    windowEndAt: "2026-08-01T23:59:59.999Z",
    windowTimezone: "America/Los_Angeles",
    contextFingerprint: `sha256:${"1".repeat(64)}`,
  };
  const liveContext = {
    ...current,
    evidenceMode: "live" as const,
    snapshotId: null,
    snapshotFingerprint: null,
  };
  assert.equal(
    formatEvidenceWindow(liveContext),
    "Jul 18, 2026 – Aug 1, 2026",
  );
  assert.equal(
    evidenceContextLabel(liveContext),
    "LIVE EVIDENCE · Jul 18, 2026 – Aug 1, 2026",
  );
  assert.equal(evidenceContextLabel({
    ...current,
    evidenceMode: "pinned",
    snapshotId: "belief_reversal_2026_08_01",
    snapshotFingerprint: `sha256:${"2".repeat(64)}`,
    displayLabel: "Demo evidence snapshot as of 2026-08-01",
    eventCount: 4,
    eventSetFingerprint: `sha256:${"3".repeat(64)}`,
    bindingFingerprint: `sha256:${"4".repeat(64)}`,
  }), "PINNED DEMO REPLAY · Jul 18, 2026 – Aug 1, 2026");
  assert.equal(
    evidenceContextLabel({ state: "legacy_unbound" }),
    "LEGACY REPORT · Evidence context unavailable",
  );
});

test("the pinned replay control is sandbox-only", () => {
  assert.equal(canRunPinnedDemo("public_sandbox"), true);
  assert.equal(canRunPinnedDemo("product"), false);
  assert.equal(canRunPinnedDemo("public_demo"), false);
});
