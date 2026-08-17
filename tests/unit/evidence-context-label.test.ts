import assert from "node:assert/strict";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import * as pageModule from "../../app/page";
import {
  PINNED_THIRTY_DEAL_SNAPSHOT_ID,
} from "../../lib/belief-reversal/pinned-thirty-deal-snapshot";
import type { RunEvidenceRequestV1 } from "../../lib/contracts/evidence-context";

const {
  canRunPinnedDemo,
  evidenceContextLabel,
  formatEvidenceWindow,
} = pageModule;

test("UI evidence labels present a readable evidence window for live, pinned replay, and legacy reports", () => {
  const current = {
    state: "current" as const,
    schemaVersion: "run-evidence-context-v1" as const,
    windowDays: 14 as const,
    anchorAt: "2026-08-02T06:59:59.999Z",
    windowStartAt: "2026-07-18T07:00:00.000Z",
    windowEndAt: "2026-08-02T06:59:59.999Z",
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
    formatEvidenceWindow({
      windowStartAt: "2026-07-19T07:00:00.000Z",
      windowEndAt: "2026-08-02T06:59:59.999Z",
      windowTimezone: "America/Los_Angeles",
    }),
    "Jul 19, 2026 – Aug 1, 2026",
  );
  assert.equal(
    formatEvidenceWindow({
      windowStartAt: "2026-03-08T08:00:00.000Z",
      windowEndAt: "2026-03-10T06:59:59.999Z",
      windowTimezone: "America/Los_Angeles",
    }),
    "Mar 8, 2026 – Mar 9, 2026",
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

test("the pinned demo button visibly anchors the 30-Deal replay and submits only its reviewed snapshot", () => {
  const buildRequest = (
    pageModule as typeof pageModule & {
      buildPinnedThirtyDealDemoEvidenceRequest?: () => RunEvidenceRequestV1;
    }
  ).buildPinnedThirtyDealDemoEvidenceRequest;
  const PinnedDemoButton = (
    pageModule as typeof pageModule & {
      PinnedThirtyDealDemoButton?: (props: {
        busy: boolean;
        disabled: boolean;
        onRun(request: RunEvidenceRequestV1): void;
      }) => ReactElement;
    }
  ).PinnedThirtyDealDemoButton;
  assert.ok(buildRequest);
  assert.ok(PinnedDemoButton);

  const expectedRequest = {
    schemaVersion: "run-evidence-request-v1" as const,
    evidenceMode: "pinned" as const,
    snapshotId: PINNED_THIRTY_DEAL_SNAPSHOT_ID,
  };
  const submitted: RunEvidenceRequestV1[] = [];
  const button = PinnedDemoButton({
    busy: false,
    disabled: false,
    onRun(request) {
      submitted.push(request);
    },
  });
  const buttonProps = button.props as { onClick?: () => void };
  assert.ok(buttonProps.onClick);
  buttonProps.onClick();

  assert.deepEqual(buildRequest(), expectedRequest);
  assert.deepEqual(submitted, [expectedRequest]);
  const html = renderToStaticMarkup(button);
  assert.match(html, /RUN DEEP UNDERWRITE DEMO/iu);
  assert.match(html, /IRREGULAR/iu);
  assert.match(html, /immutable evidence anchor/iu);
  assert.doesNotMatch(html, /TOP\s*5/iu);
});

test("private staging routes only the reviewed pinned run to the fixed Irregular Deep Underwrite report", () => {
  const shouldOpenFixedReport = (
    pageModule as typeof pageModule & {
      shouldOpenFixedDeepUnderwriteReport?: (
        deploymentMode: "product" | "public_demo" | "public_sandbox",
        request: RunEvidenceRequestV1,
      ) => boolean;
    }
  ).shouldOpenFixedDeepUnderwriteReport;
  assert.ok(shouldOpenFixedReport);

  const pinned = {
    schemaVersion: "run-evidence-request-v1" as const,
    evidenceMode: "pinned" as const,
    snapshotId: PINNED_THIRTY_DEAL_SNAPSHOT_ID,
  };
  const live = {
    schemaVersion: "run-evidence-request-v1" as const,
    evidenceMode: "live" as const,
  };

  assert.equal(shouldOpenFixedReport("public_sandbox", pinned), true);
  assert.equal(shouldOpenFixedReport("public_sandbox", live), false);
  assert.equal(shouldOpenFixedReport("public_sandbox", {
    ...pinned,
    snapshotId: "belief_reversal_unreviewed_snapshot",
  }), false);
  assert.equal(shouldOpenFixedReport("product", pinned), false);
  assert.equal(shouldOpenFixedReport("public_demo", pinned), false);
});

test("the private-staging pinned control is labeled as the immediate Irregular Deep Underwrite demo", () => {
  const PinnedDemoButton = (
    pageModule as typeof pageModule & {
      PinnedThirtyDealDemoButton?: (props: {
        busy: boolean;
        disabled: boolean;
        onRun(request: RunEvidenceRequestV1): void;
      }) => ReactElement;
    }
  ).PinnedThirtyDealDemoButton;
  assert.ok(PinnedDemoButton);

  const html = renderToStaticMarkup(PinnedDemoButton({
    busy: false,
    disabled: false,
    onRun() {},
  }));
  assert.match(html, /RUN DEEP UNDERWRITE DEMO/iu);
  assert.match(html, /IRREGULAR/iu);
  assert.match(html, /ENGLISH SEMANTIC EDITION/iu);
});
