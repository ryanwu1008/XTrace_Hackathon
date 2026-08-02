import type {
  BeliefAction,
  BeliefActionKind,
  BeliefActionPriority,
  BeliefActionScope,
  BeliefChangeDirection,
  DealStatus,
} from "../contracts/domain";

export const BELIEF_ACTION_POLICY_VERSION = "belief-action-policy-v1" as const;

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

const VALID_STATUSES = new Set(Object.keys(ACTION_KINDS_BY_STATUS_AND_DIRECTION));
const VALID_DIRECTIONS = new Set([
  "positive",
  "mixed",
  "negative",
  "none",
  "unavailable",
]);
const VALID_ACTION_KINDS = new Set(Object.keys(COMPATIBILITY_TEXT_BY_KIND));

function invalidActionPolicyInput(detail: string): TypeError {
  return new TypeError(`Invalid belief action policy input: ${detail}`);
}

function requireActionKind(value: unknown): BeliefActionKind {
  if (typeof value !== "string" || !VALID_ACTION_KINDS.has(value)) {
    throw invalidActionPolicyInput("unknown action kind");
  }
  return value as BeliefActionKind;
}

export function metadataForBeliefActionKind(kind: BeliefActionKind): {
  scope: BeliefActionScope;
  priority: BeliefActionPriority;
  visibility: "internal_only";
} {
  kind = requireActionKind(kind);
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
  if (typeof status !== "string" || !VALID_STATUSES.has(status)) {
    throw invalidActionPolicyInput("unknown Deal status");
  }
  if (typeof direction !== "string" || !VALID_DIRECTIONS.has(direction)) {
    throw invalidActionPolicyInput("unknown belief direction");
  }
  return ACTION_KINDS_BY_STATUS_AND_DIRECTION[status][direction].map(
    actionForKind,
  );
}

export function parseBeliefActions(value: unknown): BeliefAction[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw invalidActionPolicyInput("actions must be a nonempty array");
  }
  return value.map((candidate) => {
    if (typeof candidate !== "object" || candidate === null) {
      throw invalidActionPolicyInput("each action must be an object");
    }
    const record = candidate as Record<string, unknown>;
    const kind = requireActionKind(record.kind);
    const expected = metadataForBeliefActionKind(kind);
    const keys = Object.keys(record);
    if (
      keys.length !== 4
      || !keys.every((key) =>
        key === "kind"
        || key === "scope"
        || key === "priority"
        || key === "visibility"
      )
      || record.scope !== expected.scope
      || record.priority !== expected.priority
      || record.visibility !== expected.visibility
    ) {
      throw invalidActionPolicyInput("action metadata is not canonical");
    }
    return { kind, ...expected };
  });
}

export function beliefActionListsEqual(
  left: readonly BeliefAction[],
  right: readonly BeliefAction[],
): boolean {
  left = parseBeliefActions(left);
  right = parseBeliefActions(right);
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
  return parseBeliefActions(actions)
    .map((action) => COMPATIBILITY_TEXT_BY_KIND[action.kind])
    .join(" ");
}
