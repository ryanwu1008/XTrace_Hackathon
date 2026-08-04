import assert from "node:assert/strict";
import test from "node:test";

import { buildActionDraftSection } from "../../app/action-draft-view-model";
import { actionsForDealStatusAndDirection } from "../../lib/reports/action-policy";
import type { PublicActionDraft } from "../../lib/underwriting/read-model";

function draft(input: {
  id: string;
  format: PublicActionDraft["format"];
  fieldId?: string;
  impact?: string;
}): PublicActionDraft {
  const fieldId = input.fieldId ?? "arr";
  return {
    id: input.id,
    candidateRunId: "candidate_1",
    schemaVersion: "action-draft-v2",
    safety: "status_safe",
    deliveryMode: "draft_only",
    draftPolicyVersion: "status-safe-action-draft-v2",
    actionPolicyVersion: "belief-action-policy-v1",
    dealStatus: "watchlist",
    beliefDirection: "positive",
    actions: actionsForDealStatusAndDirection("watchlist", "positive"),
    missingEvidence: [{
      fieldId,
      label: "Latest ARR",
      externalLabel: "Latest ARR",
      reasonCode: "MISSING_ARR",
      mostLikelyDecisionImpact:
        input.impact ?? "Could change the current decision ceiling.",
    }],
    format: input.format,
    channel: input.format === "founder_email" ? "email" : "internal",
    audienceType: input.format === "founder_email" ? "founder" : "internal",
    body: `Complete body for ${input.id}`,
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z",
  };
}

test("action-draft presentation orders formats and summarizes identical missing evidence once", () => {
  const founderEmail = draft({ id: "draft_email", format: "founder_email" });
  const internalMemo = draft({ id: "draft_internal", format: "internal_memo" });

  const presentation = buildActionDraftSection([founderEmail, internalMemo]);

  assert.deepEqual(
    presentation.drafts.map(({ title }) => title),
    ["Internal Underwriting Memo", "Founder Email"],
  );
  assert.equal(presentation.missingEvidence.length, 1);
  assert.equal(presentation.drafts[0]?.draft.body, internalMemo.body);
  assert.equal(presentation.drafts[1]?.draft.body, founderEmail.body);
});

test("action-draft presentation preserves the full approved order before legacy fallback", () => {
  const presentation = buildActionDraftSection([
    draft({ id: "legacy_b", format: null }),
    draft({ id: "draft_sms", format: "founder_sms" }),
    draft({ id: "draft_linkedin", format: "founder_linkedin" }),
    draft({ id: "draft_email", format: "founder_email" }),
    draft({ id: "draft_diligence", format: "diligence_request" }),
    draft({ id: "draft_internal", format: "internal_memo" }),
    draft({ id: "legacy_a", format: null }),
  ]);

  assert.deepEqual(
    presentation.drafts.map(({ draft, title }) => [draft.id, title]),
    [
      ["draft_internal", "Internal Underwriting Memo"],
      ["draft_diligence", "Diligence Request"],
      ["draft_email", "Founder Email"],
      ["draft_linkedin", "Founder LinkedIn"],
      ["draft_sms", "Founder SMS"],
      ["legacy_a", "Legacy Action Draft"],
      ["legacy_b", "Legacy Action Draft"],
    ],
  );
});

test("action-draft presentation fails closed without crashing on conflicting missing-evidence payloads", () => {
  const presentation = buildActionDraftSection([
      draft({
        id: "draft_internal",
        format: "internal_memo",
        impact: "Could raise the current decision ceiling.",
      }),
      draft({
        id: "draft_email",
        format: "founder_email",
        impact: "Could lower the current decision ceiling.",
      }),
  ]);

  assert.deepEqual(presentation.conflictingFieldIds, ["arr"]);
  assert.deepEqual(presentation.missingEvidence, []);
  assert.equal(presentation.drafts.length, 2);
});
