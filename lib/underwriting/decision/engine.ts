import {
  EvidenceCoverageResultSchema,
  EvidencePackSchema,
  type ClaimEdge,
} from "../../contracts/evidence";
import {
  DecisionResultSchema,
  FrameworkJudgmentSchema,
  FundPolicySnapshotSchema,
  ResolvedUnderwritingContextSchema,
  ValuationEvaluationSchema,
  type DecisionResult,
  type FrameworkJudgment,
} from "../../contracts/underwriting";
import {
  applyDecisionCeiling,
  decisionFromMatrix,
  evaluateDecisionRules,
  matrixRule,
  type DecisionEngineInput,
} from "./rules";
import { SYNTHETIC_FRAMEWORK_PACK } from "../../../seed/underwriting/framework-pack-v1";

const FORMAL_FRAMEWORK_VERSIONS = new Map(
  SYNTHETIC_FRAMEWORK_PACK.cards.map(({ id, version }) => [id, version]),
);

export interface DecisionEngine {
  decide(input: DecisionEngineInput): DecisionResult;
}

export function createDecisionEngine(): DecisionEngine {
  return {
    decide(rawInput) {
      const input = parseInput(rawInput);
      const evaluation = evaluateDecisionRules(input);
      const resultId = [
        "decision",
        input.pack.id,
        input.decisionPolicy.id,
        input.decisionPolicy.version,
      ].join(":");
      const blockingEvidenceItemIds = blockingEvidenceIds(
        input.pack,
        input.coverage,
      );

      if (
        !input.coverage.minimumModelInputsComplete
        || input.coverage.underwritingStatus === "unavailable"
        || (
          input.context.analysisMode === "core_only"
          && input.context.geography === "unavailable"
        )
      ) {
        return DecisionResultSchema.parse({
          id: resultId,
          analysisType: "final_synthesis",
          companyQuality: "unavailable",
          priceAttractiveness: "unavailable",
          fundFit: "unavailable",
          decision: null,
          decisionCeiling: null,
          hardVeto: false,
          firedRules: evaluation.firedRules,
          blockingEvidenceItemIds,
          claimEdges: claimEdges(input, evaluation, resultId),
          confidence: "low",
        });
      }

      const matrixDecision = decisionFromMatrix({
        companyQuality: evaluation.companyQuality,
        priceAttractiveness: evaluation.priceAttractiveness,
        fundFit: evaluation.fundFit,
        criticalEvidenceComplete: input.coverage.criticalEvidenceComplete,
        mandateMismatch: evaluation.mandateMismatch,
        hardVeto: evaluation.hardVeto,
        actionablePositiveSignal: evaluation.actionablePositiveSignal,
      });
      const decision = applyDecisionCeiling(
        matrixDecision,
        evaluation.decisionCeiling,
      );
      const firedRules = [
        ...evaluation.firedRules,
        matrixRule({
          policy: input.decisionPolicy,
          dimensions: evaluation,
          decision,
          hardVeto: evaluation.hardVeto,
        }),
      ];

      return DecisionResultSchema.parse({
        id: resultId,
        analysisType: "final_synthesis",
        companyQuality: evaluation.companyQuality,
        priceAttractiveness: evaluation.priceAttractiveness,
        fundFit: evaluation.fundFit,
        decision,
        decisionCeiling: evaluation.decisionCeiling,
        hardVeto: evaluation.hardVeto,
        firedRules,
        blockingEvidenceItemIds,
        claimEdges: claimEdges(input, evaluation, resultId),
        confidence: decisionConfidence(input, evaluation),
      });
    },
  };
}

function parseInput(input: DecisionEngineInput): DecisionEngineInput {
  const pack = EvidencePackSchema.parse(input.pack);
  const coverage = EvidenceCoverageResultSchema.parse(input.coverage);
  const judgments = selectFormalDecisionJudgments(input.judgments);
  const valuation = ValuationEvaluationSchema.parse(input.valuation);
  const fundPolicy = FundPolicySnapshotSchema.parse(input.fundPolicy);
  const context = ResolvedUnderwritingContextSchema.parse(input.context);
  if (JSON.stringify(pack.coverage) !== JSON.stringify(coverage)) {
    throw new Error(
      "Decision coverage must be the exact coverage saved on the Evidence Pack.",
    );
  }
  if (fundPolicy.workspaceId !== pack.workspaceId) {
    throw new Error(
      "Decision inputs must belong to the same trusted workspace.",
    );
  }
  if (context.asOfDate !== pack.asOfDate) {
    throw new Error(
      "Decision context and Evidence Pack must share the same as-of date.",
    );
  }
  if (context.decisionPolicyId !== input.decisionPolicy.id) {
    throw new Error(
      "Decision Policy must be the immutable policy selected by the context.",
    );
  }
  if (
    input.decisionPolicy.version.trim() === ""
    || input.decisionPolicy.matrixVersion !== "1"
  ) {
    throw new Error("Decision Policy version is unsupported.");
  }
  return {
    pack,
    coverage,
    judgments,
    valuation,
    fundPolicy,
    context,
    decisionPolicy: input.decisionPolicy,
  };
}

export function isFormalDecisionJudgment(
  judgment: FrameworkJudgment,
): boolean {
  return judgment.frameworkMetadata === undefined
    && FORMAL_FRAMEWORK_VERSIONS.get(judgment.frameworkCardId)
      === judgment.frameworkVersion;
}

export function selectFormalDecisionJudgments(
  judgments: readonly FrameworkJudgment[],
): FrameworkJudgment[] {
  return judgments
    .map((item) => FrameworkJudgmentSchema.parse(item))
    .filter(isFormalDecisionJudgment);
}

function claimEdges(
  input: DecisionEngineInput,
  evaluation: ReturnType<typeof evaluateDecisionRules>,
  resultId: string,
): ClaimEdge[] {
  const dependencies: Array<Omit<ClaimEdge, "claimItemId">> = [
    ...evaluation.firedRules.flatMap(({ inputRefs }) =>
      inputRefs.flatMap(dependencyFromTypedRef)
    ),
    ...blockingEvidenceIds(input.pack, input.coverage).map((id) => ({
      dependencyItemId: id,
      dependencyType: "fact" as const,
    })),
    {
      dependencyItemId: input.fundPolicy.id,
      dependencyType: "policy_ref" as const,
    },
    {
      dependencyItemId: input.decisionPolicy.id,
      dependencyType: "policy_ref" as const,
    },
  ];
  const unique = new Map(
    dependencies.map((dependency) => [
      `${dependency.dependencyType}:${dependency.dependencyItemId}`,
      dependency,
    ]),
  );
  return [...unique.values()]
    .sort((left, right) =>
      compareUtf8(
        `${left.dependencyType}:${left.dependencyItemId}`,
        `${right.dependencyType}:${right.dependencyItemId}`,
      )
    )
    .map((dependency) => ({
      claimItemId: resultId,
      ...dependency,
    }));
}

function dependencyFromTypedRef(
  reference: string,
): Array<Omit<ClaimEdge, "claimItemId">> {
  const separator = reference.indexOf(":");
  if (separator < 1) return [];
  const type = reference.slice(0, separator);
  const value = reference.slice(separator + 1);
  if (type === "policy_ref") {
    return [{
      dependencyItemId: value.split("#", 1)[0]!,
      dependencyType: "policy_ref",
    }];
  }
  if (type === "fact") {
    return [{ dependencyItemId: value, dependencyType: "fact" }];
  }
  if (type === "calculation") {
    return [{ dependencyItemId: value, dependencyType: "calculation" }];
  }
  if (type === "framework_judgment") {
    return [{
      dependencyItemId: value,
      dependencyType: "framework_judgment",
    }];
  }
  if (type === "benchmark_ref") {
    return [{ dependencyItemId: value, dependencyType: "benchmark_ref" }];
  }
  return [];
}

function blockingEvidenceIds(
  pack: DecisionEngineInput["pack"],
  coverage: DecisionEngineInput["coverage"],
): string[] {
  const blockingConflicts = new Set(coverage.blockingConflictIds);
  return uniqueSorted(
    pack.conflicts
      .filter(({ id }) => blockingConflicts.has(id))
      .flatMap(({ leftFactId, rightFactId }) => [
        leftFactId,
        rightFactId,
      ]),
  );
}

function decisionConfidence(
  input: DecisionEngineInput,
  evaluation: ReturnType<typeof evaluateDecisionRules>,
): DecisionResult["confidence"] {
  const dimensions = [
    evaluation.companyQuality,
    evaluation.priceAttractiveness,
    evaluation.fundFit,
  ];
  if (
    input.coverage.criticalEvidenceComplete
    && dimensions.every((dimension) => dimension !== "unavailable")
  ) {
    return "high";
  }
  if (dimensions.every((dimension) => dimension === "unavailable")) {
    return "low";
  }
  return "medium";
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf8);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
