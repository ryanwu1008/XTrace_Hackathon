import assert from "node:assert/strict";
import test from "node:test";

import type { FrameworkJudgment } from "../../lib/contracts/underwriting";
import type {
  DecisionCriticalEvidenceRef,
  NamedLensPassage,
} from "../../lib/contracts/named-lens";
import type {
  DecisionQuestionCode,
  DecisionTaxonomyBinding,
  EvidenceDomainCode,
} from "../../lib/underwriting/frameworks/decision-taxonomy";
import {
  buildNamedLensSynthesis,
  finalizeNamedLensPlacement,
  prioritizeNamedLensJudgments,
  type NamedLensCatalogCandidate,
  type NamedLensPassageValidationResult,
  type NamedLensProvisionalPriority,
} from "../../lib/underwriting/frameworks/relevance";

const sha = (digit: string) => `sha256:${digit.repeat(64)}`;
const questions: readonly DecisionQuestionCode[] = [
  "market_structure",
  "product_differentiation",
  "customer_adoption",
  "founder_team_execution",
  "operating_model",
  "unit_economics",
  "financing_valuation",
] as const;
const domains: readonly EvidenceDomainCode[] = [
  "market",
  "product",
  "customer",
  "team",
  "operations",
  "unit_economics",
  "valuation",
] as const;

function critical(id: string, changedBelief = true): DecisionCriticalEvidenceRef {
  return {
    evidencePackItemId: id,
    classification: "fact",
    originRefs: [{
      kind: changedBelief ? "market_event" : "fired_rule",
      id: changedBelief ? `event_${id}` : `rule_${id}`,
    }],
    reasonCodes: [
      changedBelief
        ? "BELIEF_CHANGE_MARKET_EVENT"
        : "FORMAL_DECISION_RULE_INPUT",
    ],
    resolutionPath: [changedBelief ? `event_${id}` : `rule_${id}`, id],
  };
}

function judgment(input: {
  id: string;
  frameworkId?: string;
  stance?: "supportive" | "mixed" | "negative" | "abstain";
  evidenceIds?: string[];
  coverage?: "high" | "medium" | "low";
  applicability?: "applicable" | "not_applicable" | "unavailable";
  packName?: string;
}): FrameworkJudgment {
  const frameworkId = input.frameworkId ?? `framework_${input.id}`;
  const evidenceIds = input.evidenceIds ?? [`fact_${input.id}`];
  return {
    id: input.id,
    analysisType: "framework_judgment",
    frameworkCardId: frameworkId,
    frameworkVersion: "1",
    applicability: input.applicability ?? "applicable",
    conclusion: input.stance ?? "supportive",
    supportEvidenceItemIds: evidenceIds,
    counterEvidenceItemIds: [],
    unusedEvidenceItemIds: [],
    strongestSupport: "Saved support.",
    strongestCounterargument: "Saved countercase.",
    unknowns: ["Saved unknown."],
    limitations: ["Saved limitation."],
    confidence: {
      sourceReliability: "high",
      evidenceStrength: "high",
      evidenceCoverage: input.coverage ?? "high",
      applicability: "high",
      judgment: "high",
    },
    claimEdges: evidenceIds.map((dependencyItemId) => ({
      claimItemId: input.id,
      dependencyItemId,
      dependencyType: "fact" as const,
    })),
    frameworkMetadata: {
      packId: `pack_${input.id}`,
      packName: input.packName ?? `Pack ${input.id}`,
    },
    fingerprint: `fingerprint_${input.id}`,
  } as unknown as FrameworkJudgment;
}

function taxonomy(
  judgments: readonly FrameworkJudgment[],
  questionForIndex: (index: number) => DecisionQuestionCode =
    (index) => questions[index % questions.length]!,
): ReadonlyMap<string, DecisionTaxonomyBinding> {
  return new Map(judgments.map((item, index) => {
    const componentFrameworkId = `component_${item.frameworkCardId}`;
    const binding = {
      frameworkId: componentFrameworkId,
      cardFieldRef: "decisionQuestions[0]",
      questionText: `Question ${index}`,
      decisionQuestionCode: questionForIndex(index),
      evidenceDomainCodes: [domains[index % domains.length]!],
    } satisfies DecisionTaxonomyBinding;
    Object.assign(item.frameworkMetadata!, {
      componentCardIds: [componentFrameworkId],
      components: [{
        frameworkId: componentFrameworkId,
        decisionQuestions: [binding.questionText],
      }],
      decisionTaxonomyBindings: [binding],
    });
    return [item.frameworkCardId, binding];
  }));
}

function passage(
  priority: NamedLensProvisionalPriority,
  input: {
    text?: string;
    basis?: string[];
    posture?: "supports_further_diligence" | "urges_caution" | "withholds_view";
    question?: DecisionQuestionCode;
    domains?: EvidenceDomainCode[];
    wordCount?: number;
    fingerprintDigit?: string;
  } = {},
): NamedLensPassage {
  const basis = input.basis ?? priority.selectionBasisEvidenceIds;
  const text = input.text ?? `Persisted analysis for ${priority.judgmentId}.`;
  return {
    schemaVersion: "named-lens-passage-v1",
    workspaceId: "workspace_1",
    artifactSourceCandidateRunId: "candidate_1",
    judgmentId: priority.judgmentId,
    frameworkCardId: priority.frameworkCardId,
    frameworkVersion: priority.frameworkVersion,
    decisionQuestionCode: input.question ?? priority.decisionQuestionCode,
    evidenceDomainCodes: input.domains ?? priority.evidenceDomainCodes,
    premise: {
      text,
      componentFrameworkId: priority.frameworkCardId,
      componentVersion: priority.frameworkVersion,
      cardFieldRef: "decisionQuestions[0]",
      publicSourceIds: [`public_${priority.judgmentId}`],
      claimIds: [`claim_${priority.judgmentId}`],
      locator: { kind: "web_section", value: "https://example.com/framework#premise" },
      attributionScope: "coauthored_work",
    },
    caseApplication: {
      text,
      evidenceItemIds: basis.length > 0 ? basis : [`context_${priority.judgmentId}`],
    },
    countercase: {
      text,
      boundaryKind: "no_candidate_local_counterevidence",
      evidenceItemIds: [],
      evidenceRequestRefs: [`request_${priority.judgmentId}`],
    },
    unknownBoundary: {
      text,
      judgmentUnknownRefs: ["Saved unknown."],
      judgmentLimitationRefs: [],
      evidenceRequestRefs: [],
    },
    conditionalConclusion: {
      text,
      stance: priority.stance,
      advisoryPosture: input.posture ?? (
        priority.stance === "negative"
          ? "urges_caution"
          : priority.stance === "mixed"
          ? "withholds_view"
          : "supports_further_diligence"
      ),
    },
    advisoryContract: {
      formalDecisionWeight: "0",
      noEndorsement: true,
      namedPersonImpersonation: false,
      hiddenChainOfThought: false,
    },
    selectionBasisEvidenceIds: basis,
    wordCount: input.wordCount ?? 35,
    generatorVersion: "named-lens-generator-v1",
    fingerprint: sha(input.fingerprintDigit ?? "a"),
  };
}

function catalog(
  priorities: readonly NamedLensProvisionalPriority[],
): NamedLensCatalogCandidate[] {
  return priorities.map((priority) => ({
    workspaceId: "workspace_1",
    artifactSourceCandidateRunId: "candidate_1",
    judgmentOrCatalogCandidateId: priority.judgmentId,
    judgmentId: priority.judgmentId,
    frameworkCardId: priority.frameworkCardId,
    frameworkVersion: priority.frameworkVersion,
    initialDisposition: "judgment_eligible",
    reasonCodes: ["JUDGMENT_ELIGIBLE"],
  }));
}

function validated(
  priorities: readonly NamedLensProvisionalPriority[],
  passageFor = (priority: NamedLensProvisionalPriority, index: number) =>
    passage(priority, { fingerprintDigit: String((index % 9) + 1) }),
): NamedLensPassageValidationResult[] {
  return priorities.map((priority, index) => ({
    judgmentOrCatalogCandidateId: priority.judgmentId,
    status: "validated",
    passage: passageFor(priority, index),
  }));
}

function scenario(count: number) {
  const judgments = Array.from({ length: count }, (_, index) => judgment({
    id: `judgment_${String.fromCharCode(97 + index)}`,
    stance: index % 2 === 0 ? "supportive" : "negative",
  }));
  const criticalEvidence = judgments.map((item) => critical(`fact_${item.id}`));
  const priorities = prioritizeNamedLensJudgments({
    judgments,
    criticalEvidence,
    taxonomyByFrameworkId: taxonomy(judgments),
  });
  return {
    catalogCandidates: catalog(priorities),
    provisionalPriority: priorities,
    passageResults: validated(priorities),
    criticalEvidence,
  };
}

test("truthfully selects zero, one, four, five, or six from 0/1/4/5/6/7/20 eligible judgments", () => {
  for (const [eligible, expected] of [
    [0, 0], [1, 1], [4, 4], [5, 5], [6, 6], [7, 6], [20, 6],
  ] as const) {
    const final = finalizeNamedLensPlacement(scenario(eligible));
    assert.equal(
      final.dispositions.filter(({ disposition }) =>
        disposition === "selected_main"
      ).length,
      expected,
      `${eligible} eligible judgments`,
    );
  }
});

test("selects the best supportive/negative principal pair and never treats mixed as an opposing pole", () => {
  const judgments = [
    judgment({ id: "judgment_support", stance: "supportive", evidenceIds: ["fact_a", "fact_shared"] }),
    judgment({ id: "judgment_negative", stance: "negative", evidenceIds: ["fact_b", "fact_shared"] }),
    judgment({ id: "judgment_mixed", stance: "mixed", evidenceIds: ["fact_a", "fact_b", "fact_shared"] }),
    judgment({ id: "judgment_other_negative", stance: "negative", evidenceIds: ["fact_b"], coverage: "low" }),
  ];
  const priorities = prioritizeNamedLensJudgments({
    judgments,
    criticalEvidence: [critical("fact_a"), critical("fact_b"), critical("fact_shared")],
    taxonomyByFrameworkId: taxonomy(judgments, () => "customer_adoption"),
  });

  assert.deepEqual(
    priorities.slice(0, 2).map(({ judgmentId, priorityTier }) => [judgmentId, priorityTier]),
    [
      ["judgment_negative", "principal_disagreement"],
      ["judgment_support", "principal_disagreement"],
    ],
  );
  assert.notEqual(
    priorities.find(({ judgmentId }) => judgmentId === "judgment_mixed")?.priorityTier,
    "principal_disagreement",
  );
});

test("keeps context-only judgments out of the main memo", () => {
  const judgments = [
    judgment({ id: "judgment_relevant", evidenceIds: ["fact_critical"] }),
    judgment({ id: "judgment_context", evidenceIds: ["fact_context"] }),
  ];
  const criticalEvidence = [critical("fact_critical")];
  const priorities = prioritizeNamedLensJudgments({
    judgments,
    criticalEvidence,
    taxonomyByFrameworkId: taxonomy(judgments),
  });
  const final = finalizeNamedLensPlacement({
    catalogCandidates: catalog(priorities),
    provisionalPriority: priorities,
    passageResults: validated(priorities),
    criticalEvidence,
  });

  assert.equal(
    priorities.find(({ judgmentId }) => judgmentId === "judgment_context")?.priorityTier,
    "context_only",
  );
  assert.equal(
    final.dispositions.find(({ judgmentId }) => judgmentId === "judgment_context")?.disposition,
    "appendix_only",
  );
});

test("makes absent, duplicated, foreign, or stale component-question bindings ineligible", () => {
  const judgments = [
    judgment({ id: "judgment_valid", evidenceIds: ["fact_valid"] }),
    judgment({ id: "judgment_stale", evidenceIds: ["fact_stale"] }),
    judgment({ id: "judgment_duplicate", evidenceIds: ["fact_duplicate"] }),
    judgment({ id: "judgment_absent", evidenceIds: ["fact_absent"] }),
  ];
  const taxonomyByFrameworkId = new Map(taxonomy(judgments));
  const stale = taxonomyByFrameworkId.get(judgments[1]!.frameworkCardId)!;
  taxonomyByFrameworkId.set(judgments[1]!.frameworkCardId, {
    ...stale,
    decisionQuestionCode: "security",
  });
  const duplicate = judgments[2]!.frameworkMetadata!.decisionTaxonomyBindings[0]!;
  judgments[2]!.frameworkMetadata!.decisionTaxonomyBindings.push({ ...duplicate });
  taxonomyByFrameworkId.delete(judgments[3]!.frameworkCardId);

  const priorities = prioritizeNamedLensJudgments({
    judgments,
    criticalEvidence: judgments.map((item) => critical(`fact_${item.id.replace("judgment_", "")}`)),
    taxonomyByFrameworkId,
  });

  assert.deepEqual(priorities.map(({ judgmentId }) => judgmentId), ["judgment_valid"]);
});

test("ignores catalog order and human names while using stable UTF-8 identity ties", () => {
  const judgments = [
    judgment({ id: "judgment_ä", evidenceIds: ["fact_shared"], packName: "Famous Person" }),
    judgment({ id: "judgment_z", evidenceIds: ["fact_shared"], packName: "Unknown Person" }),
  ];
  const input = {
    judgments,
    criticalEvidence: [critical("fact_shared")],
    taxonomyByFrameworkId: taxonomy(judgments, () => "market_structure"),
  };
  const first = prioritizeNamedLensJudgments(input);
  const renamedAndReordered = prioritizeNamedLensJudgments({
    ...input,
    judgments: [
      { ...judgments[1]!, frameworkMetadata: { ...judgments[1]!.frameworkMetadata!, packName: "Celebrity" } },
      { ...judgments[0]!, frameworkMetadata: { ...judgments[0]!.frameworkMetadata!, packName: "Anonymous" } },
    ] as FrameworkJudgment[],
  });

  assert.deepEqual(first.map(({ judgmentId }) => judgmentId), ["judgment_z", "judgment_ä"]);
  assert.deepEqual(
    renamedAndReordered.map(({ judgmentId }) => judgmentId),
    first.map(({ judgmentId }) => judgmentId),
  );
});

test("eliminates an exact typed duplicate and preserves the higher priority representative", () => {
  const input = scenario(5);
  const [first, second] = input.provisionalPriority;
  assert.ok(first && second);
  second.decisionQuestionCode = first.decisionQuestionCode;
  second.evidenceDomainCodes = [...first.evidenceDomainCodes];
  second.selectionBasisEvidenceIds = [...first.selectionBasisEvidenceIds];
  second.criticalEvidence = [...first.criticalEvidence];
  input.passageResults = validated(input.provisionalPriority, (priority, index) =>
    passage(priority, index === 1 ? {
      posture: first.stance === "negative" ? "urges_caution" : "supports_further_diligence",
      text: "Distinct prose but the same typed decision signature.",
      fingerprintDigit: "8",
    } : { fingerprintDigit: String((index % 7) + 1) })
  );
  const final = finalizeNamedLensPlacement(input);
  const duplicate = final.dispositions.find(({ judgmentId }) =>
    judgmentId === second.judgmentId
  );

  assert.equal(duplicate?.disposition, "appendix_only");
  assert.ok(duplicate?.reasonCodes.includes("DUPLICATE_DECISION_RATIONALE"));
  assert.equal(
    final.dispositions.find(({ judgmentId }) => judgmentId === first.judgmentId)?.disposition,
    "selected_main",
  );
});

test("eliminates literal normalized prose clones even when their typed signatures differ", () => {
  const input = scenario(5);
  input.passageResults = validated(input.provisionalPriority, (priority, index) =>
    passage(priority, {
      text: index === 0
        ? "The Saved View, remains conditional."
        : index === 1
        ? "  the saved view remains CONDITIONAL  "
        : `Distinct persisted view ${index}.`,
      fingerprintDigit: String((index % 9) + 1),
    })
  );
  const final = finalizeNamedLensPlacement(input);
  assert.ok(final.dispositions.some(({ reasonCodes }) =>
    reasonCodes.includes("DUPLICATE_DECISION_RATIONALE")
  ));
});

test("rejects foreign selection-basis IDs instead of silently trimming them", () => {
  const input = scenario(4);
  input.passageResults = validated(input.provisionalPriority, (priority, index) =>
    passage(priority, index === 0
      ? { basis: ["fact_foreign", ...priority.selectionBasisEvidenceIds] }
      : {})
  );
  assert.throws(
    () => finalizeNamedLensPlacement(input),
    /candidate-local decision-critical|foreign/i,
  );
});

test("withholds a failed high-priority passage and deterministically backfills later valid passages", () => {
  const input = scenario(7);
  const withheld = input.provisionalPriority[0]!;
  input.passageResults = input.provisionalPriority.map((priority, index) =>
    index === 0
      ? {
          judgmentOrCatalogCandidateId: priority.judgmentId,
          status: "withheld" as const,
          reasonCode: "foreign_passage_evidence",
        }
      : {
          judgmentOrCatalogCandidateId: priority.judgmentId,
          status: "validated" as const,
          passage: passage(priority, { fingerprintDigit: String(index) }),
        }
  );
  const final = finalizeNamedLensPlacement(input);

  assert.equal(
    final.dispositions.find(({ judgmentId }) => judgmentId === withheld.judgmentId)?.disposition,
    "withheld",
  );
  assert.equal(
    final.dispositions.filter(({ disposition }) => disposition === "selected_main").length,
    6,
  );
});

test("assigns contiguous deterministic positions and canonical backfill order", () => {
  const final = finalizeNamedLensPlacement(scenario(7));
  assert.deepEqual(
    final.dispositions
      .filter((item) => item.disposition === "selected_main")
      .map((item) => [item.judgmentId, item.selectedPosition]),
    [
      ["judgment_a", 1], ["judgment_b", 2], ["judgment_c", 3],
      ["judgment_d", 4], ["judgment_e", 5], ["judgment_f", 6],
    ],
  );
});

test("builds exactly the five deterministic synthesis branches", () => {
  const base = scenario(3);
  const passages = base.provisionalPriority.map((priority, index) =>
    passage(priority, { fingerprintDigit: String(index + 1) })
  );
  assert.equal(buildNamedLensSynthesis({ passages: [] }).branch, "zero_available");
  assert.equal(buildNamedLensSynthesis({ passages: passages.slice(0, 1) }).branch, "single_perspective");
  assert.equal(buildNamedLensSynthesis({
    passages: passages.slice(0, 2).map((item) => ({
      ...item,
      decisionQuestionCode: "market_structure",
      conditionalConclusion: { ...item.conditionalConclusion, stance: "supportive" as const },
    })),
  }).branch, "bounded_alignment");
  assert.equal(buildNamedLensSynthesis({
    passages: [{
      ...passages[0]!,
      decisionQuestionCode: "market_structure",
      conditionalConclusion: { ...passages[0]!.conditionalConclusion, stance: "supportive" },
    }, {
      ...passages[1]!,
      decisionQuestionCode: "customer_adoption",
      conditionalConclusion: { ...passages[1]!.conditionalConclusion, stance: "negative" },
    }],
  }).branch, "different_emphasis");
  assert.equal(buildNamedLensSynthesis({
    passages: [{
      ...passages[0]!,
      decisionQuestionCode: "customer_adoption",
      conditionalConclusion: { ...passages[0]!.conditionalConclusion, stance: "supportive" },
    }, {
      ...passages[1]!,
      decisionQuestionCode: "customer_adoption",
      conditionalConclusion: { ...passages[1]!.conditionalConclusion, stance: "negative" },
    }],
  }).branch, "principal_disagreement");
});

test("enforces the 1,600-word selected-passage plus synthesis budget", () => {
  const input = scenario(6);
  const persistedLongConclusion = Array.from(
    { length: 55 },
    (_, index) => `persisted${index}`,
  ).join(" ");
  const passages = input.provisionalPriority.map((priority, index) =>
    passage(priority, {
      text: persistedLongConclusion,
      wordCount: 260,
      fingerprintDigit: String(index + 1),
    })
  );
  assert.throws(
    () => buildNamedLensSynthesis({ passages }),
    /1,600|1600|word budget/i,
  );
});
