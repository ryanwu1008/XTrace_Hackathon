import {
  OpportunityReportItemSchema,
  type BeliefAction,
  type DealStatus,
  type OpportunityReportItem,
} from "../contracts/domain";
import { renderRecommendedNextMove } from "./action-policy";

export const SAFE_REPORT_NEXT_STEP_FALLBACK =
  "Review the cited evidence and decide whether further internal diligence is warranted.";
export const SAFE_MONITOR_NEXT_STEP =
  "No immediate follow-up recommended. Continue monitoring.";
export const SAFE_UNAVAILABLE_NEXT_STEP =
  "Review system activity before relying on this company analysis.";

const NEXT_STEP_BY_STATUS = {
  screening:
    "Review the cited evidence and decide whether to continue internal screening.",
  watchlist:
    "Review the cited evidence and decide whether to update the watchlist status.",
  evaluating:
    "Review the cited evidence and decide whether to update ongoing internal diligence.",
  passed:
    "Review the cited evidence and decide whether to reopen internal diligence.",
  invested:
    "Review the cited evidence and decide whether to update portfolio monitoring.",
} satisfies Record<DealStatus, string>;

const SAFE_REPORT_NEXT_STEPS = new Set<string>([
  ...Object.values(NEXT_STEP_BY_STATUS),
  SAFE_REPORT_NEXT_STEP_FALLBACK,
]);

export function nextStepForDealStatus(status: DealStatus): string {
  return NEXT_STEP_BY_STATUS[status];
}

export function sanitizeReportNextStep(value: string): string {
  return SAFE_REPORT_NEXT_STEPS.has(value)
    ? value
    : SAFE_REPORT_NEXT_STEP_FALLBACK;
}

export function sanitizeCompanyAnalysisNextStep(input: {
  outcome: "belief_revised" | "monitor" | "no_material_change" | "analysis_unavailable";
  value: string;
  actions?: readonly BeliefAction[];
}): string {
  if (input.actions) {
    return renderRecommendedNextMove(input.actions);
  }
  if (input.outcome === "belief_revised") {
    return sanitizeReportNextStep(input.value);
  }
  if (input.outcome === "analysis_unavailable") {
    return SAFE_UNAVAILABLE_NEXT_STEP;
  }
  return SAFE_MONITOR_NEXT_STEP;
}

export function sanitizeReportOpportunities(
  opportunities: unknown,
): OpportunityReportItem[] {
  if (!Array.isArray(opportunities)) return [];
  return opportunities.flatMap((value) => {
    const parsed = OpportunityReportItemSchema.safeParse(value);
    return parsed.success
      ? [{
          ...parsed.data,
          nextStep: sanitizeReportNextStep(parsed.data.nextStep),
        }]
      : [];
  });
}
