import { compareUtf8 } from "../lib/format/canonical-order";
import type { PublicActionDraft } from "../lib/underwriting/read-model";

const FORMAT_PRIORITY: Readonly<Record<string, number>> = {
  internal_memo: 0,
  diligence_request: 1,
  founder_email: 2,
  founder_linkedin: 3,
  founder_sms: 4,
};

const FORMAT_TITLES: Readonly<Record<string, string>> = {
  internal_memo: "Internal Underwriting Memo",
  diligence_request: "Diligence Request",
  founder_email: "Founder Email",
  founder_linkedin: "Founder LinkedIn",
  founder_sms: "Founder SMS",
};

export interface ActionDraftPresentation {
  draft: PublicActionDraft;
  title: string;
}

export interface ActionDraftSectionPresentation {
  drafts: ActionDraftPresentation[];
  missingEvidence: PublicActionDraft["missingEvidence"];
  conflictingFieldIds: string[];
}

export function buildActionDraftSection(
  drafts: PublicActionDraft[],
): ActionDraftSectionPresentation {
  const missingEvidence = new Map<
    string,
    PublicActionDraft["missingEvidence"][number]
  >();
  const conflictingFieldIds = new Set<string>();
  for (const draft of drafts) {
    for (const item of draft.missingEvidence) {
      if (conflictingFieldIds.has(item.fieldId)) continue;
      const existing = missingEvidence.get(item.fieldId);
      if (existing && !sameMissingEvidence(existing, item)) {
        missingEvidence.delete(item.fieldId);
        conflictingFieldIds.add(item.fieldId);
        continue;
      }
      if (!existing) missingEvidence.set(item.fieldId, item);
    }
  }

  return {
    conflictingFieldIds: [...conflictingFieldIds].sort(compareUtf8),
    missingEvidence: [...missingEvidence.values()].sort((left, right) =>
      compareUtf8(left.fieldId, right.fieldId)
    ),
    drafts: [...drafts]
      .sort((left, right) =>
        (FORMAT_PRIORITY[left.format ?? ""] ?? Number.MAX_SAFE_INTEGER)
          - (FORMAT_PRIORITY[right.format ?? ""] ?? Number.MAX_SAFE_INTEGER)
        || compareUtf8(left.format ?? "", right.format ?? "")
        || compareUtf8(left.id, right.id)
      )
      .map((draft) => ({
        draft,
        title: FORMAT_TITLES[draft.format ?? ""] ?? "Legacy Action Draft",
      })),
  };
}

function sameMissingEvidence(
  left: PublicActionDraft["missingEvidence"][number],
  right: PublicActionDraft["missingEvidence"][number],
): boolean {
  return left.fieldId === right.fieldId
    && left.label === right.label
    && left.externalLabel === right.externalLabel
    && left.reasonCode === right.reasonCode
    && left.mostLikelyDecisionImpact === right.mostLikelyDecisionImpact;
}
