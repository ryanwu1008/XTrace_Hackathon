import { isDeepStrictEqual } from "node:util";

import {
  CalculationSchema,
  EvidencePackSchema,
  type Calculation,
  type ClaimEdge,
  type EvidencePack,
} from "../../contracts/evidence";
import {
  CandidateRunSchema,
  FrameworkJudgmentSchema,
  type CandidateRun,
  type FrameworkJudgment,
} from "../../contracts/underwriting";
import { SYNTHETIC_FRAMEWORK_PACK } from "../../../seed/underwriting/framework-pack-v1";
import {
  ClaudeAdvisoryFrameworkJudgmentOutputSchema,
  ClaudeFrameworkLensOutputSchema,
  FrameworkCardSchema,
  isExperimentalAdvisoryFrameworkCard,
  type ClaudeAdvisoryFrameworkJudgmentOutput,
  type ClaudeFrameworkLensOutput,
  type FrameworkCard,
} from "./schemas";

const VALUATION_FRAMEWORK_CARD_ID =
  SYNTHETIC_FRAMEWORK_PACK.cards[7]!.id;

export function isValuationFrameworkCard(card: FrameworkCard): boolean {
  return card.id === VALUATION_FRAMEWORK_CARD_ID
    && card.title === "Valuation & Fund Return";
}

export function isExecutableFrameworkCard(card: FrameworkCard): boolean {
  const parsed = FrameworkCardSchema.parse(card);
  const approvedFixture = SYNTHETIC_FRAMEWORK_PACK.cards.find(
    (fixture) => fixture.id === parsed.id,
  );
  return parsed.synthetic
    && parsed.publicationStatus === "published"
    && parsed.attribution === "Product-owned synthetic fixture"
    && parsed.rightsStatus === "product_owned_synthetic"
    && parsed.formalDecisionWeight === "0"
    && approvedFixture !== undefined
    && isDeepStrictEqual(
      parsed,
      FrameworkCardSchema.parse(approvedFixture),
    );
}

export function groundFrameworkLensOutput(input: {
  candidate: CandidateRun;
  pack: EvidencePack;
  card: FrameworkCard;
  calculations: Calculation[];
  fingerprint: string;
  output:
    | ClaudeFrameworkLensOutput
    | ClaudeAdvisoryFrameworkJudgmentOutput;
}): FrameworkJudgment {
  const candidate = CandidateRunSchema.parse(input.candidate);
  const pack = EvidencePackSchema.parse(input.pack);
  const card = FrameworkCardSchema.parse(input.card);
  const calculations = input.calculations.map((item) =>
    CalculationSchema.parse(item)
  );
  const advisory = isExperimentalAdvisoryFrameworkCard(card);
  const advisoryOutput = advisory
    ? ClaudeAdvisoryFrameworkJudgmentOutputSchema.parse(input.output)
    : null;
  const output = advisoryOutput
    ?? ClaudeFrameworkLensOutputSchema.parse(input.output);
  const dependencies = new Map<string, ClaimEdge["dependencyType"]>();
  for (const fact of pack.facts) dependencies.set(fact.id, "fact");
  for (const assumption of pack.assumptions) {
    dependencies.set(assumption.id, "assumption");
  }
  if (isValuationFrameworkCard(card)) {
    for (const calculation of calculations) {
      dependencies.set(calculation.id, "calculation");
    }
  }

  const usedAndUnusedIds = [
    ...output.supportEvidenceItemIds,
    ...output.counterEvidenceItemIds,
    ...output.unusedEvidenceItemIds,
  ];
  if (
    new Set(usedAndUnusedIds).size !== usedAndUnusedIds.length
    || usedAndUnusedIds.some((id) => !dependencies.has(id))
    || usedAndUnusedIds.length !== dependencies.size
    || [...dependencies.keys()].some((id) => !usedAndUnusedIds.includes(id))
  ) {
    throw new Error(
      "Framework lens evidence IDs are outside the allowed immutable inputs or do not exactly partition them.",
    );
  }
  if (
    output.frameworkRuleRefs.length !== 1
    || output.frameworkRuleRefs[0] !== card.id
  ) {
    throw new Error(
      "Framework lens rule refs must resolve to the exact selected card.",
    );
  }
  assertStrongestClaimShape(
    output.supportEvidenceItemIds,
    output.strongestSupport,
    "support",
  );
  assertStrongestClaimShape(
    output.counterEvidenceItemIds,
    output.strongestCounterargument,
    "counterargument",
  );

  const judgmentId = createFrameworkJudgmentId(
    candidate.id,
    card.id,
    input.fingerprint,
  );
  const claimEdges: ClaimEdge[] = [
    ...output.supportEvidenceItemIds,
    ...output.counterEvidenceItemIds,
  ].map((dependencyItemId) => ({
    claimItemId: judgmentId,
    dependencyItemId,
    dependencyType: dependencies.get(dependencyItemId)!,
  }));
  claimEdges.push({
    claimItemId: judgmentId,
    dependencyItemId: card.id,
    dependencyType: "framework_ref",
  });
  claimEdges.sort((left, right) =>
    compareUtf8(left.dependencyItemId, right.dependencyItemId)
  );

  return FrameworkJudgmentSchema.parse({
    id: judgmentId,
    analysisType: "framework_judgment",
    frameworkCardId: card.id,
    frameworkVersion: card.version,
    applicability: output.applicability,
    conclusion: output.conclusion,
    supportEvidenceItemIds: sorted(output.supportEvidenceItemIds),
    counterEvidenceItemIds: sorted(output.counterEvidenceItemIds),
    unusedEvidenceItemIds: sorted(output.unusedEvidenceItemIds),
    strongestSupport: output.strongestSupport,
    strongestCounterargument: output.strongestCounterargument,
    unknowns: output.unknowns,
    limitations: uniqueSorted([
      ...card.limitations,
      ...output.limitations,
    ]),
    confidence: output.confidence,
    claimEdges,
    ...(advisory
      ? {
        frameworkMetadata: card.experimentalAdvisory,
        counterevidenceBoundary: advisoryOutput!.counterevidenceBoundary,
      }
      : {}),
    fingerprint: input.fingerprint,
  });
}

export function buildFrameworkAbstention(input: {
  candidate: CandidateRun;
  pack: EvidencePack;
  card: FrameworkCard;
  calculations: Calculation[];
  fingerprint: string;
  applicability: "not_applicable" | "unavailable";
  reason: string;
  retainAdvisoryMetadata?: boolean;
}): FrameworkJudgment {
  const candidate = CandidateRunSchema.parse(input.candidate);
  const pack = EvidencePackSchema.parse(input.pack);
  const card = FrameworkCardSchema.parse(input.card);
  const calculationIds = isValuationFrameworkCard(card)
    ? input.calculations.map((item) => CalculationSchema.parse(item).id)
    : [];
  const judgmentId = createFrameworkJudgmentId(
    candidate.id,
    card.id,
    input.fingerprint,
  );
  return FrameworkJudgmentSchema.parse({
    id: judgmentId,
    analysisType: "framework_judgment",
    frameworkCardId: card.id,
    frameworkVersion: card.version,
    applicability: input.applicability,
    conclusion: "abstain",
    supportEvidenceItemIds: [],
    counterEvidenceItemIds: [],
    unusedEvidenceItemIds: uniqueSorted([
      ...pack.facts.map(({ id }) => id),
      ...pack.assumptions.map(({ id }) => id),
      ...calculationIds,
    ]),
    strongestSupport: null,
    strongestCounterargument: null,
    unknowns: [input.reason],
    limitations: uniqueSorted([...card.limitations, input.reason]),
    confidence: {
      sourceReliability: "low",
      evidenceStrength: "low",
      evidenceCoverage: "low",
      applicability: "low",
      judgment: "low",
    },
    claimEdges: [{
      claimItemId: judgmentId,
      dependencyItemId: card.id,
      dependencyType: "framework_ref",
    }],
    ...(input.retainAdvisoryMetadata
      && isExperimentalAdvisoryFrameworkCard(card)
      ? { frameworkMetadata: card.experimentalAdvisory }
      : {}),
    fingerprint: input.fingerprint,
  });
}

export function createFrameworkJudgmentId(
  candidateId: string,
  cardId: string,
  fingerprint: string,
): string {
  return [
    "framework_judgment",
    candidateId,
    cardId,
    fingerprint.replace(/^sha256:/, ""),
  ].join(":");
}

function assertStrongestClaimShape(
  ids: string[],
  strongest: string | null,
  label: string,
): void {
  if ((ids.length === 0) !== (strongest === null)) {
    throw new Error(
      `Framework lens ${label} text must match its grounded evidence IDs.`,
    );
  }
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort(compareUtf8);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf8);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
