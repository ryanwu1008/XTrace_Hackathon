import type {
  BeliefAction,
  BeliefActionKind,
  BeliefActionPriority,
  BeliefActionScope,
  BeliefChangeDirection,
  DealStatus,
} from "../contracts/domain";

const ACTION_KINDS_BY_STATUS_AND_DIRECTION = {
  screening: {
    positive: ["advance_diligence"],
    mixed: ["continue_monitoring"],
    negative: ["deprioritize"],
    none: ["no_new_action"],
    unavailable: ["review_analysis_failure"],
  },
  watchlist: {
    positive: ["advance_diligence"],
    mixed: ["continue_monitoring"],
    negative: ["deprioritize"],
    none: ["no_new_action"],
    unavailable: ["review_analysis_failure"],
  },
  evaluating: {
    positive: ["advance_diligence"],
    mixed: ["continue_monitoring"],
    negative: ["deprioritize"],
    none: ["no_new_action"],
    unavailable: ["review_analysis_failure"],
  },
  passed: {
    positive: ["reopen_diligence"],
    mixed: ["continue_monitoring"],
    negative: ["deprioritize"],
    none: ["no_new_action"],
    unavailable: ["review_analysis_failure"],
  },
  invested: {
    positive: ["evaluate_follow_on"],
    mixed: ["continue_monitoring"],
    negative: ["pause_follow_on", "portfolio_risk_review"],
    none: ["no_new_action"],
    unavailable: ["review_analysis_failure"],
  },
} as const satisfies Record<
  DealStatus,
  Record<BeliefChangeDirection, readonly BeliefActionKind[]>
>;

const PORTFOLIO_ACTIONS = new Set<BeliefActionKind>([
  "evaluate_follow_on",
  "pause_follow_on",
  "portfolio_risk_review",
]);
const HIGH_PRIORITY_ACTIONS = new Set<BeliefActionKind>([
  "pause_follow_on",
  "portfolio_risk_review",
]);

const COMPATIBILITY_TEXT_BY_KIND = {
  advance_diligence:
    "Advance internal diligence based on the cited evidence.",
  continue_monitoring:
    "Continue internal monitoring based on the cited evidence.",
  deprioritize:
    "Deprioritize this Deal based on the cited evidence.",
  reopen_diligence:
    "Reopen internal diligence based on the cited evidence.",
  evaluate_follow_on:
    "Evaluate a follow-on investment based on the cited evidence.",
  pause_follow_on:
    "Pause follow-on investment activity based on the cited evidence.",
  portfolio_risk_review:
    "Begin an internal portfolio-risk review based on the cited evidence.",
  no_new_action:
    "No new internal action is recommended.",
  review_analysis_failure:
    "Review the analysis failure before relying on this company analysis.",
} as const satisfies Record<BeliefActionKind, string>;

export function metadataForBeliefActionKind(kind: BeliefActionKind): {
  scope: BeliefActionScope;
  priority: BeliefActionPriority;
  visibility: "internal_only";
} {
  const scope: BeliefActionScope = kind === "review_analysis_failure"
    ? "analysis"
    : PORTFOLIO_ACTIONS.has(kind)
    ? "portfolio"
    : "deal";
  return {
    scope,
    priority: HIGH_PRIORITY_ACTIONS.has(kind) ? "high" : "standard",
    visibility: "internal_only",
  };
}

function actionForKind(kind: BeliefActionKind): BeliefAction {
  return { kind, ...metadataForBeliefActionKind(kind) };
}

export function actionsForDealStatusAndDirection(
  status: DealStatus,
  direction: BeliefChangeDirection,
): BeliefAction[] {
  return ACTION_KINDS_BY_STATUS_AND_DIRECTION[status][direction].map(
    actionForKind,
  );
}

export function beliefActionListsEqual(
  left: readonly BeliefAction[],
  right: readonly BeliefAction[],
): boolean {
  return left.length === right.length && left.every((action, index) => {
    const other = right[index];
    return other !== undefined
      && action.kind === other.kind
      && action.scope === other.scope
      && action.priority === other.priority
      && action.visibility === other.visibility;
  });
}

export function renderRecommendedNextMove(
  actions: readonly BeliefAction[],
): string {
  return actions.map((action) => COMPATIBILITY_TEXT_BY_KIND[action.kind]).join(" ");
}
