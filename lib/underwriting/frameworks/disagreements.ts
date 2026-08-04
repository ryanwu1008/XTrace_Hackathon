import { createHash } from "node:crypto";

import {
  FrameworkDisagreementSchema,
  FrameworkJudgmentSchema,
  type FrameworkDisagreement,
  type FrameworkJudgment,
} from "../../contracts/underwriting";
import {
  FrameworkCardSchema,
  isExperimentalAdvisoryFrameworkCard,
  type FrameworkCard,
} from "./schemas";

type DisagreementTopic = FrameworkDisagreement["topic"];

interface DisagreementRule {
  topic: DisagreementTopic;
  leftCardTitle: string;
  rightCardTitle: string;
}

const DISAGREEMENT_RULES: readonly DisagreementRule[] = [
  {
    topic: "growth_vs_revenue_quality",
    leftCardTitle: "GTM & Unit Economics",
    rightCardTitle: "Revenue Quality & Retention",
  },
  {
    topic: "fde_moat_vs_services_burden",
    leftCardTitle: "Durable Competitive Power",
    rightCardTitle: "GTM & Unit Economics",
  },
  {
    topic: "tam_vs_willingness_to_pay",
    leftCardTitle: "Market Size & Why Now",
    rightCardTitle: "Product-Market Fit & Customer Evidence",
  },
  {
    topic: "company_quality_vs_price",
    leftCardTitle: "Market Size & Why Now",
    rightCardTitle: "Valuation & Fund Return",
  },
  {
    topic: "contrarian_insight_vs_adoption",
    leftCardTitle: "Contrarian Market Structure",
    rightCardTitle: "Product-Market Fit & Customer Evidence",
  },
] as const;

export function buildFrameworkDisagreements(input: {
  judgments: readonly FrameworkJudgment[];
  cards: readonly FrameworkCard[];
}): FrameworkDisagreement[] {
  const cards = input.cards.map((card) => FrameworkCardSchema.parse(card));
  const judgments = input.judgments
    .map((judgment) => FrameworkJudgmentSchema.parse(judgment))
    .sort((left, right) => compareUtf8(left.id, right.id));
  const judgmentsById = new Map(
    judgments.map((judgment) => [judgment.id, judgment] as const),
  );
  const judgmentsByCardId = new Map<string, FrameworkJudgment[]>();

  for (const judgment of judgments) {
    const existing = judgmentsByCardId.get(judgment.frameworkCardId) ?? [];
    existing.push(judgment);
    judgmentsByCardId.set(judgment.frameworkCardId, existing);
  }

  const disagreements: FrameworkDisagreement[] = [];
  for (const rule of DISAGREEMENT_RULES) {
    const leftCard = findUniqueCard(cards, rule.leftCardTitle);
    const rightCard = findUniqueCard(cards, rule.rightCardTitle);
    if (!leftCard || !rightCard) continue;

    const leftJudgments = judgmentsByCardId.get(leftCard.id) ?? [];
    const rightJudgments = judgmentsByCardId.get(rightCard.id) ?? [];
    for (const left of leftJudgments) {
      for (const right of rightJudgments) {
        if (!areOpposingApplicableJudgments(left, right)) continue;

        const evidenceItemIds = uniqueSorted([
          ...left.supportEvidenceItemIds,
          ...left.counterEvidenceItemIds,
          ...right.supportEvidenceItemIds,
          ...right.counterEvidenceItemIds,
        ]);
        disagreements.push(FrameworkDisagreementSchema.parse({
          id: createDisagreementId(rule.topic, left.id, right.id),
          leftJudgmentId: left.id,
          rightJudgmentId: right.id,
          topic: rule.topic,
          explanation:
            `${leftCard.title} remains ${left.conclusion}, while `
            + `${rightCard.title} remains ${right.conclusion}; both grounded `
            + "judgments are preserved independently.",
          evidenceItemIds,
        }));
      }
    }
  }
  const advisoryCardsById = new Map(
    cards
      .filter(isExperimentalAdvisoryFrameworkCard)
      .map((card) => [card.id, card] as const),
  );
  const advisoryJudgments = judgments
    .filter((judgment) =>
      judgment.frameworkMetadata !== undefined
      && advisoryCardsById.has(judgment.frameworkCardId)
      && judgment.applicability === "applicable"
      && (
        judgment.conclusion === "supportive"
        || judgment.conclusion === "negative"
      )
    )
    .sort((left, right) =>
      compareUtf8(
        `${left.frameworkCardId}\u0000${left.id}`,
        `${right.frameworkCardId}\u0000${right.id}`,
      )
    );
  for (let leftIndex = 0; leftIndex < advisoryJudgments.length; leftIndex += 1) {
    const left = advisoryJudgments[leftIndex]!;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < advisoryJudgments.length;
      rightIndex += 1
    ) {
      const right = advisoryJudgments[rightIndex]!;
      if (
        left.frameworkCardId === right.frameworkCardId
        || !areOpposingApplicableJudgments(left, right)
      ) {
        continue;
      }
      const leftCard = advisoryCardsById.get(left.frameworkCardId)!;
      const rightCard = advisoryCardsById.get(right.frameworkCardId)!;
      const topic = "independent_framework_conflict";
      disagreements.push(FrameworkDisagreementSchema.parse({
        id: createDisagreementId(topic, left.id, right.id),
        leftJudgmentId: left.id,
        rightJudgmentId: right.id,
        topic,
        explanation:
          `${leftCard.title} remains ${left.conclusion}, while `
          + `${rightCard.title} remains ${right.conclusion}; both independent `
          + "named advisory judgments and their source-grounded reasoning are preserved without averaging.",
        evidenceItemIds: uniqueSorted([
          ...left.supportEvidenceItemIds,
          ...left.counterEvidenceItemIds,
          ...right.supportEvidenceItemIds,
          ...right.counterEvidenceItemIds,
        ]),
      }));
    }
  }

  return disagreements.sort((left, right) =>
    compareUtf8(
      disagreementSemanticOrderKey(left, judgmentsById),
      disagreementSemanticOrderKey(right, judgmentsById),
    )
  );
}

function disagreementSemanticOrderKey(
  disagreement: FrameworkDisagreement,
  judgmentsById: ReadonlyMap<string, FrameworkJudgment>,
): string {
  const left = judgmentsById.get(disagreement.leftJudgmentId);
  const right = judgmentsById.get(disagreement.rightJudgmentId);
  return [
    disagreement.topic,
    left?.frameworkCardId ?? disagreement.leftJudgmentId,
    right?.frameworkCardId ?? disagreement.rightJudgmentId,
    left?.conclusion ?? "",
    right?.conclusion ?? "",
  ].join("\u0000");
}

function findUniqueCard(
  cards: readonly FrameworkCard[],
  title: string,
): FrameworkCard | null {
  const matches = cards.filter((card) => card.title === title);
  return matches.length === 1 ? matches[0]! : null;
}

function areOpposingApplicableJudgments(
  left: FrameworkJudgment,
  right: FrameworkJudgment,
): boolean {
  return left.applicability === "applicable"
    && right.applicability === "applicable"
    && (
      (left.conclusion === "supportive" && right.conclusion === "negative")
      || (left.conclusion === "negative" && right.conclusion === "supportive")
    );
}

function createDisagreementId(
  topic: DisagreementTopic,
  leftJudgmentId: string,
  rightJudgmentId: string,
): string {
  const digest = createHash("sha256")
    .update(
      `${topic}\u0000${leftJudgmentId}\u0000${rightJudgmentId}`,
      "utf8",
    )
    .digest("hex");
  return `framework_disagreement_${digest.slice(0, 32)}`;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf8);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
