import type { CandidateUnderwritingDetail } from "../lib/underwriting/read-model";

type Judgment = CandidateUnderwritingDetail["judgments"][number];

export type AnalystIssueId =
  | "market_and_category"
  | "competitive_power"
  | "team_and_execution"
  | "downside_and_risk"
  | "valuation_and_returns"
  | "cross_cutting";

export interface AnalystIssueGroup {
  id: AnalystIssueId;
  title: string;
  description: string;
  judgmentIds: string[];
  participants: string[];
  conclusions: Judgment["conclusion"][];
  strongestSupport: string[];
  strongestCounterevidence: string[];
  unknowns: string[];
  synthesizedView: string;
}

export interface AnalystPanelViewModel {
  /**
   * False when every issue group synthesizes to the same sentence once the
   * pack name is removed, which is what a shared generation template produces.
   * The renderer withholds the synthesis rather than repeating one sentence
   * under several headings.
   */
  synthesisDiscriminates: boolean;
  totalJudgmentCount: number;
  activeJudgmentCount: number;
  abstainedJudgmentCount: number;
  namedAnalystCount: number;
  coreLensCount: number;
  abstainedJudgmentIds: string[];
  groups: AnalystIssueGroup[];
}

const issues: ReadonlyArray<Pick<
  AnalystIssueGroup,
  "id" | "title" | "description"
>> = [
  {
    id: "market_and_category",
    title: "Market & Category",
    description: "Market timing, category definition, adoption, and customer alternatives.",
  },
  {
    id: "competitive_power",
    title: "Competitive Power",
    description: "Differentiation, defensibility, distribution, and durable value capture.",
  },
  {
    id: "team_and_execution",
    title: "Team & Execution",
    description: "Founder judgment, organization, operating cadence, and milestone delivery.",
  },
  {
    id: "downside_and_risk",
    title: "Downside & Risk",
    description: "Failure modes, counterevidence, risk controls, and kill criteria.",
  },
  {
    id: "valuation_and_returns",
    title: "Valuation & Returns",
    description: "Price, financing terms, scenarios, dilution, and fund-return potential.",
  },
  {
    id: "cross_cutting",
    title: "Cross-cutting Decision Lenses",
    description: "Applicable persisted lenses that span more than one IC issue.",
  },
];

export function buildAnalystPanel(
  judgments: CandidateUnderwritingDetail["judgments"],
): AnalystPanelViewModel {
  const active = judgments.filter((judgment) =>
    judgment.applicability === "applicable" && judgment.conclusion !== "abstain"
  );
  const abstained = judgments.filter((judgment) => !active.includes(judgment));

  const groups = issues.map((issue) => {
    const members = active.filter((judgment) => classifyIssue(judgment) === issue.id);
    const strongestSupport = unique(members.flatMap((judgment) =>
      useful(judgment.strongestSupport) ? [judgment.strongestSupport] : []
    ));
    const strongestCounterevidence = unique(members.flatMap((judgment) =>
      useful(judgment.strongestCounterargument)
        ? [judgment.strongestCounterargument]
        : []
    ));
    const unknowns = unique(members.flatMap((judgment) => judgment.unknowns));
    return {
      ...issue,
      judgmentIds: members.map(({ id }) => id),
      participants: unique(members.map(analystName)),
      conclusions: members.map(({ conclusion }) => conclusion),
      strongestSupport,
      strongestCounterevidence,
      unknowns,
      synthesizedView: editorialSynthesis({
        support: strongestSupport[0],
        counterevidence: strongestCounterevidence[0],
        unknown: unknowns[0],
      }),
    } satisfies AnalystIssueGroup;
  }).filter(({ judgmentIds }) => judgmentIds.length > 0);

  const synthesisSignatures = new Set(
    groups.map(({ synthesizedView, participants }) =>
      participants
        .reduce((view: string, name: string) => view.split(name).join(""), synthesizedView)
        .replace(/\s+/gu, " ")
        .trim()
        .toLowerCase()
    ),
  );

  return {
    synthesisDiscriminates: groups.length < 2
      || synthesisSignatures.size * 2 >= groups.length,
    totalJudgmentCount: judgments.length,
    activeJudgmentCount: active.length,
    abstainedJudgmentCount: abstained.length,
    namedAnalystCount: judgments.filter(({ frameworkMetadata }) =>
      Boolean(frameworkMetadata)
    ).length,
    coreLensCount: judgments.filter(({ frameworkMetadata }) =>
      !frameworkMetadata
    ).length,
    abstainedJudgmentIds: abstained.map(({ id }) => id),
    groups,
  };
}

function classifyIssue(judgment: Judgment): AnalystIssueId {
  const identity = [
    judgment.frameworkMetadata?.packId,
    judgment.frameworkMetadata?.packName,
    judgment.frameworkCardId,
  ].filter(Boolean).join(" ").toLowerCase().replaceAll("_", "-");

  if (matches(identity, [
    "damodaran",
    "mauboussin",
    "rappaport",
    "metrick",
    "yasuda",
    "venture-deals",
    "valuation",
    "finance",
    "fund-return",
  ])) return "valuation_and_returns";

  if (matches(identity, [
    "claire-hughes-johnson",
    "wasserman",
    "founder",
    "scaling-people",
    "team",
    "organization",
    "execution",
  ])) return "team_and_execution";

  if (matches(identity, [
    "howard-marks",
    "risk",
    "downside",
    "most-important-thing",
    "failure",
  ])) return "downside_and_risk";

  if (matches(identity, [
    "hamilton-helmer",
    "7-powers",
    "seven-powers",
    "competitive",
    "defensibility",
    "distribution",
    "moat",
    "bill-gurley",
  ])) return "competitive_power";

  if (matches(identity, [
    "peter-thiel",
    "sequoia",
    "april-dunford",
    "andrew-chen",
    "sebastian-mallaby",
    "market",
    "category",
    "positioning",
    "cold-start",
    "monopoly",
    "adoption",
  ])) return "market_and_category";

  return "cross_cutting";
}

function analystName(judgment: Judgment): string {
  return judgment.frameworkMetadata?.packName ?? judgment.frameworkCardId;
}

function matches(identity: string, candidates: string[]): boolean {
  return candidates.some((candidate) => identity.includes(candidate));
}

function useful(value: string | null): value is string {
  return Boolean(value && value.trim() && !/^unavailable\b/i.test(value));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function editorialSynthesis(input: {
  support?: string;
  counterevidence?: string;
  unknown?: string;
}): string {
  return [
    input.support ? sentence(input.support) : "No affirmative support was persisted.",
    input.counterevidence
      ? `Counterpoint: ${sentence(input.counterevidence)}`
      : "No material counterevidence was persisted.",
    input.unknown
      ? `Open question: ${sentence(input.unknown)}`
      : "No additional open question was persisted.",
  ].join(" ");
}

function sentence(value: string): string {
  const trimmed = value.trim();
  return /[.!?]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}
