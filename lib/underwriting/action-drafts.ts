import {
  ACTION_DRAFT_POLICY_VERSION,
  ActionDraftSchema,
  canonicalExternalActionDraftBodies,
  DecisionResultSchema,
  FrameworkDisagreementSchema,
  FrameworkJudgmentSchema,
  MissingEvidenceItemSchema,
  type ActionDraft,
  type DecisionResult,
  type FrameworkDisagreement,
  type FrameworkJudgment,
  type MissingEvidenceItem,
} from "../contracts/underwriting";
import type {
  BeliefAction,
  BeliefChangeDirection,
  DealStatus,
} from "../contracts/domain";
import {
  BELIEF_ACTION_POLICY_VERSION,
  actionsForDealStatusAndDirection,
  beliefActionListsEqual,
  parseBeliefActions,
  renderRecommendedNextMove,
} from "../reports/action-policy";
import {
  renderPublicAdvisoryConflicts,
  renderPublicAdvisoryDiligenceRequests,
  renderPublicAdvisoryOpinions,
} from "./public-advisory-rendering";

export interface ActionDraftGenerator {
  generate(input: {
    candidateRunId: string;
    decision: DecisionResult;
    missingEvidence: MissingEvidenceItem[];
    dealStatus: DealStatus;
    beliefDirection: BeliefChangeDirection;
    actions: BeliefAction[];
    recommendedNextSteps?: readonly string[];
    judgments?: FrameworkJudgment[];
    disagreements?: FrameworkDisagreement[];
  }): ActionDraft[];
}

export function createActionDraftGenerator(options: {
  workspaceId: string;
  now?: () => Date;
}): ActionDraftGenerator {
  const workspaceId = requireId(options.workspaceId, "workspaceId");
  const now = options.now ?? (() => new Date());
  return {
    generate(rawInput) {
      const candidateRunId = requireId(
        rawInput.candidateRunId,
        "candidateRunId",
      );
      const decision = DecisionResultSchema.parse(rawInput.decision);
      const missingEvidence = rawInput.missingEvidence.map((item) =>
        MissingEvidenceItemSchema.parse(item)
      );
      const actions = parseBeliefActions(rawInput.actions);
      const expectedActions = actionsForDealStatusAndDirection(
        rawInput.dealStatus,
        rawInput.beliefDirection,
      );
      if (!beliefActionListsEqual(actions, expectedActions)) {
        throw new TypeError(
          "Action draft actions do not match the authoritative status policy.",
        );
      }
      const judgments = (rawInput.judgments ?? []).map((judgment) =>
        FrameworkJudgmentSchema.parse(judgment)
      );
      const disagreements = (rawInput.disagreements ?? []).map(
        (disagreement) => FrameworkDisagreementSchema.parse(disagreement),
      );
      const timestamp = now().toISOString();
      const decisionLabel = decision.decision ?? "Unavailable";
      const missing = missingEvidenceText(missingEvidence);
      const statusAwareAction = renderRecommendedNextMove(actions);
      const common = [
        `Formal decision: ${decisionLabel}`,
        `Decision ceiling: ${decision.decisionCeiling ?? "Unavailable"}`,
        `Confidence: ${decision.confidence}`,
      ].join("\n");
      const advisoryDraftSections = judgments.some(
          ({ frameworkMetadata }) => frameworkMetadata !== undefined,
        )
        ? [
          "",
          "EXPERIMENTAL ADVISORY OPINIONS — DRAFT ONLY",
          renderPublicAdvisoryOpinions(judgments),
          "",
          "INDEPENDENT ADVISORY CONFLICTS",
          renderPublicAdvisoryConflicts(disagreements, judgments),
          "",
          "ADVISORY DILIGENCE REQUESTS",
          renderPublicAdvisoryDiligenceRequests(judgments),
        ]
        : [];
      const definitions = [
        {
          format: "internal_memo" as const,
          channel: "internal" as const,
          audienceType: "internal" as const,
          body: [
            "INTERNAL UNDERWRITING ACTION MEMO — DRAFT ONLY",
            "",
            "Formal underwriting result",
            common,
            `Company Quality: ${decision.companyQuality}`,
            `Price Attractiveness: ${decision.priceAttractiveness}`,
            `Fund Fit: ${decision.fundFit}`,
            "",
            "Status-aware action",
            statusAwareAction,
            "",
            "Blocking or missing evidence",
            missing,
            ...advisoryDraftSections,
          ].join("\n"),
        },
        {
          format: "founder_email" as const,
          channel: "email" as const,
          audienceType: "founder" as const,
          body: canonicalExternalActionDraftBodies({
            format: "founder_email",
            missingEvidence,
          })[0]!,
        },
        {
          format: "founder_sms" as const,
          channel: "sms" as const,
          audienceType: "founder" as const,
          body: canonicalExternalActionDraftBodies({
            format: "founder_sms",
            missingEvidence,
          })[0]!,
        },
        {
          format: "founder_linkedin" as const,
          channel: "linkedin" as const,
          audienceType: "founder" as const,
          body: canonicalExternalActionDraftBodies({
            format: "founder_linkedin",
            missingEvidence,
          })[0]!,
        },
        {
          format: "diligence_request" as const,
          channel: "email" as const,
          audienceType: "founder" as const,
          body: canonicalExternalActionDraftBodies({
            format: "diligence_request",
            missingEvidence,
          })[0]!,
        },
      ];

      const actionKinds = new Set(actions.map(({ kind }) => kind));
      const allowedFormats = actionKinds.has("advance_diligence")
          || actionKinds.has("reopen_diligence")
        ? new Set(definitions.map(({ format }) => format))
        : actionKinds.has("evaluate_follow_on")
        ? new Set(["internal_memo", "founder_email", "diligence_request"])
        : new Set(["internal_memo"]);

      return definitions.filter(({ format }) =>
        allowedFormats.has(format)
      ).map((definition) =>
        ActionDraftSchema.parse({
          schemaVersion: "action-draft-v2",
          safety: "status_safe",
          deliveryMode: "draft_only",
          draftPolicyVersion: ACTION_DRAFT_POLICY_VERSION,
          actionPolicyVersion: BELIEF_ACTION_POLICY_VERSION,
          id: [
            "action_draft",
            candidateRunId,
            definition.format,
          ].join(":"),
          workspaceId,
          candidateRunId,
          dealStatus: rawInput.dealStatus,
          beliefDirection: rawInput.beliefDirection,
          actions,
          missingEvidence,
          format: definition.format,
          channel: definition.channel,
          audienceType: definition.audienceType,
          body: definition.body,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
      );
    },
  };
}

function missingEvidenceText(items: MissingEvidenceItem[]): string {
  if (items.length === 0) {
    return "No missing evidence item was saved.";
  }
  return items.map((item) => [
    `- ${item.label}`,
    `  Reason: ${item.reasonCode}`,
    `  Likely decision impact: ${item.mostLikelyDecisionImpact}`,
  ].join("\n")).join("\n");
}

function requireId(value: string, label: string): string {
  if (value.trim() !== value || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty normalized ID.`);
  }
  return value;
}
