import assert from "node:assert/strict";
import test from "node:test";

import type { FrameworkJudgment } from "../../lib/contracts/underwriting";
import type {
  DecisionCriticalEvidenceRef,
  GroundedNamedLensPassageCandidate,
  NamedLensDisposition,
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
        version: "1.0.0",
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
  const rawText = input.text ?? `Persisted analysis for ${priority.judgmentId}.`;
  const text = [
    rawText,
    ...Array.from(
      { length: Math.max(0, 36 - englishWords(rawText)) },
      () => "context",
    ),
  ].join(" ");
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
      componentFrameworkId: priority.componentFrameworkId,
      componentVersion: priority.componentVersion,
      cardFieldRef: priority.cardFieldRef,
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
    wordCount: input.wordCount ?? 180,
    generatorVersion: "named-lens-generator-v1",
    fingerprint: sha(input.fingerprintDigit ?? "a"),
  };
}

function synthesisDispositions(
  passages: readonly NamedLensPassage[],
  selectedJudgmentIds: readonly string[] = passages.map(({ judgmentId }) =>
    judgmentId
  ),
  reasonByJudgmentId: ReadonlyMap<string, string> = new Map(),
): NamedLensDisposition[] {
  const selectedPositionById = new Map(
    selectedJudgmentIds.map((judgmentId, index) => [judgmentId, index + 1]),
  );
  return passages.map((item) => {
    const selectedPosition = selectedPositionById.get(item.judgmentId) ?? null;
    const criticalEvidence = item.selectionBasisEvidenceIds.map((id) =>
      critical(id)
    );
    return {
      workspaceId: item.workspaceId,
      artifactSourceCandidateRunId: item.artifactSourceCandidateRunId,
      judgmentOrCatalogCandidateId: item.judgmentId,
      judgmentId: item.judgmentId,
      frameworkCardId: item.frameworkCardId,
      frameworkVersion: item.frameworkVersion,
      disposition: selectedPosition === null ? "appendix_only" : "selected_main",
      selectedPosition,
      priorityTier: item.selectionBasisEvidenceIds.length > 0
        ? "changed_belief"
        : "context_only",
      reasonCodes: [reasonByJudgmentId.get(item.judgmentId) ?? (
        selectedPosition === null ? "APPENDIX_ONLY" : "CHANGED_BELIEF_EVIDENCE"
      )],
      decisionQuestionCode: item.decisionQuestionCode,
      stance: item.conditionalConclusion.stance,
      advisoryPosture: item.conditionalConclusion.advisoryPosture,
      selectionBasisEvidenceIds: item.selectionBasisEvidenceIds,
      criticalEvidence,
      selectionPolicyVersion: "named-lens-selection-v1",
      passageFingerprint: item.fingerprint,
      fingerprint: sha("e"),
    };
  });
}

function synthesisInput(
  passages: NamedLensPassage[],
  selectedJudgmentIds?: readonly string[],
  reasonByJudgmentId?: ReadonlyMap<string, string>,
) {
  return {
    passages,
    dispositions: synthesisDispositions(
      passages,
      selectedJudgmentIds,
      reasonByJudgmentId,
    ),
  };
}

function englishWords(text: string): number {
  return text.trim().split(/\s+/u).filter(Boolean).length;
}

function words(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, index) => `${prefix}${index}`).join(" ");
}

function passageWithSegmentCounts(
  base: NamedLensPassage,
  counts: readonly [number, number, number, number, number],
): NamedLensPassage {
  return {
    ...base,
    premise: { ...base.premise, text: words("premise", counts[0]) },
    caseApplication: {
      ...base.caseApplication,
      text: words("application", counts[1]),
    },
    countercase: {
      ...base.countercase,
      text: words("countercase", counts[2]),
    },
    unknownBoundary: {
      ...base.unknownBoundary,
      text: words("unknown", counts[3]),
    },
    conditionalConclusion: {
      ...base.conditionalConclusion,
      text: words("conclusion", counts[4]),
    },
    wordCount: counts.reduce((total, count) => total + count, 0),
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
  return priorities.map((priority, index) => {
    const finalPassage = passageFor(priority, index);
    const selectionNeutral = {
      schemaVersion: finalPassage.schemaVersion,
      workspaceId: finalPassage.workspaceId,
      artifactSourceCandidateRunId:
        finalPassage.artifactSourceCandidateRunId,
      judgmentId: finalPassage.judgmentId,
      frameworkCardId: finalPassage.frameworkCardId,
      frameworkVersion: finalPassage.frameworkVersion,
      premise: finalPassage.premise,
      caseApplication: finalPassage.caseApplication,
      countercase: finalPassage.countercase,
      unknownBoundary: finalPassage.unknownBoundary,
      conditionalConclusion: finalPassage.conditionalConclusion,
      advisoryContract: finalPassage.advisoryContract,
      wordCount: finalPassage.wordCount,
      generatorVersion: finalPassage.generatorVersion,
    };
    return {
      judgmentOrCatalogCandidateId: priority.judgmentId,
      status: "validated",
      authorizedFocus: {
        compositeFrameworkCardId: priority.frameworkCardId,
        componentVersion: priority.componentVersion,
        binding: {
          frameworkId: priority.componentFrameworkId,
          cardFieldRef: priority.cardFieldRef,
          questionText: priority.questionText,
          decisionQuestionCode: priority.decisionQuestionCode,
          evidenceDomainCodes: priority.evidenceDomainCodes,
        },
      },
      groundedCandidate: {
        ...selectionNeutral,
        focus: {
          componentFrameworkId: priority.componentFrameworkId,
          componentVersion: priority.componentVersion,
          cardFieldRef: priority.cardFieldRef,
          questionText: priority.questionText,
          decisionQuestionCode: priority.decisionQuestionCode,
          evidenceDomainCodes: priority.evidenceDomainCodes,
        },
        groundingFingerprint: sha(String(((index + 4) % 9) + 1)),
      } satisfies GroundedNamedLensPassageCandidate,
    };
  });
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

test("injects only deterministic critical selection basis after grounding", () => {
  const judgments = [judgment({
    id: "judgment_basis",
    evidenceIds: ["fact_critical", "fact_context"],
  })];
  const criticalEvidence = [critical("fact_critical")];
  const priorities = prioritizeNamedLensJudgments({
    judgments,
    criticalEvidence,
    taxonomyByFrameworkId: taxonomy(judgments),
  });
  const results = validated(priorities);
  assert.equal(results[0]?.status, "validated");
  if (results[0]?.status !== "validated") return;
  results[0].groundedCandidate.caseApplication.evidenceItemIds = [
    "fact_context",
    "fact_critical",
  ].sort();

  const finalized = finalizeNamedLensPlacement({
    catalogCandidates: catalog(priorities),
    provisionalPriority: priorities,
    passageResults: results,
    criticalEvidence,
  });
  assert.deepEqual(finalized.passages[0]?.caseApplication.evidenceItemIds, [
    "fact_context",
    "fact_critical",
  ].sort());
  assert.deepEqual(
    finalized.passages[0]?.selectionBasisEvidenceIds,
    ["fact_critical"],
  );

  const modelAuthored = structuredClone(results);
  if (modelAuthored[0]?.status === "validated") {
    Object.assign(modelAuthored[0].groundedCandidate, {
      selectionBasisEvidenceIds: ["fact_context"],
    });
  }
  assert.throws(
    () => finalizeNamedLensPlacement({
      catalogCandidates: catalog(priorities),
      provisionalPriority: priorities,
      passageResults: modelAuthored,
      criticalEvidence,
    }),
    /unrecognized|selection basis|strict/i,
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
          authorizedFocus: null,
        }
      : validated([priority], () =>
        passage(priority, { fingerprintDigit: String(index) })
      )[0]!
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
  assert.equal(buildNamedLensSynthesis(synthesisInput([])).branch, "zero_available");
  assert.equal(buildNamedLensSynthesis(synthesisInput(passages.slice(0, 1))).branch, "single_perspective");
  const aligned: NamedLensPassage[] = passages.slice(0, 2).map((item) => ({
      ...item,
      decisionQuestionCode: "market_structure" as const,
      conditionalConclusion: { ...item.conditionalConclusion, stance: "supportive" as const },
    }));
  assert.equal(
    buildNamedLensSynthesis(synthesisInput(aligned)).branch,
    "bounded_alignment",
  );
  const differentEmphasis: NamedLensPassage[] = [{
      ...passages[0]!,
      decisionQuestionCode: "market_structure" as const,
      conditionalConclusion: { ...passages[0]!.conditionalConclusion, stance: "supportive" as const },
    }, {
      ...passages[1]!,
      decisionQuestionCode: "customer_adoption" as const,
      conditionalConclusion: { ...passages[1]!.conditionalConclusion, stance: "negative" as const },
    }];
  assert.equal(
    buildNamedLensSynthesis(synthesisInput(differentEmphasis)).branch,
    "different_emphasis",
  );
  const disagreement: NamedLensPassage[] = [{
      ...passages[0]!,
      decisionQuestionCode: "customer_adoption" as const,
      conditionalConclusion: { ...passages[0]!.conditionalConclusion, stance: "supportive" as const },
    }, {
      ...passages[1]!,
      decisionQuestionCode: "customer_adoption" as const,
      conditionalConclusion: { ...passages[1]!.conditionalConclusion, stance: "negative" as const },
    }];
  assert.equal(
    buildNamedLensSynthesis(synthesisInput(disagreement)).branch,
    "principal_disagreement",
  );
});

test("keeps structured evidence identities out of reader-facing synthesis prose", () => {
  const base = scenario(2);
  const passages = base.provisionalPriority.map((priority, index) => ({
    ...passage(priority, { fingerprintDigit: String(index + 1) }),
    decisionQuestionCode: "customer_adoption" as const,
    selectionBasisEvidenceIds: [`semantic-field-${index + 1}`],
    conditionalConclusion: {
      ...passage(priority, { fingerprintDigit: String(index + 1) })
        .conditionalConclusion,
      stance: index === 0 ? "supportive" as const : "negative" as const,
    },
  }));
  const synthesis = buildNamedLensSynthesis(synthesisInput(passages));

  assert.equal(synthesis.branch, "principal_disagreement");
  assert.deepEqual(synthesis.evidenceItemIds, [
    "semantic-field-1",
    "semantic-field-2",
  ]);
  assert.doesNotMatch(
    synthesis.text,
    /semantic-field|evidence ids?|persisted conditional conclusions/i,
  );
  assert.match(synthesis.text, /materially different conclusions/i);
});

test("enforces the 1,600-word selected-passage plus synthesis budget", () => {
  const input = scenario(6);
  const passages = input.provisionalPriority.map((priority, index) => {
    const base = passage(priority, { fingerprintDigit: String(index + 1) });
    return passageWithSegmentCounts(
      {
        ...base,
        conditionalConclusion: {
          ...base.conditionalConclusion,
          stance: "supportive",
        },
      },
      index < 2 ? [60, 60, 60, 60, 20] : [65, 65, 64, 65, 1],
    );
  });
  assert.throws(
    () => buildNamedLensSynthesis(synthesisInput(passages)),
    /1,600|1600|word budget/i,
  );
});

test("derives synthesis only from selected_main and ignores matched Appendix disagreement, evidence, and budget", () => {
  const input = scenario(3);
  const selected = passage(input.provisionalPriority[0]!, {
    fingerprintDigit: "1",
  });
  const appendixNegative = passage(input.provisionalPriority[1]!, {
    basis: input.provisionalPriority[1]!.selectionBasisEvidenceIds,
    question: selected.decisionQuestionCode,
    fingerprintDigit: "2",
  });
  const cappedAppendix = passageWithSegmentCounts(
    passage(input.provisionalPriority[2]!, { fingerprintDigit: "3" }),
    [65, 65, 64, 65, 1],
  );
  const passages = [selected, appendixNegative, cappedAppendix];
  const synthesis = buildNamedLensSynthesis(synthesisInput(
    passages,
    [selected.judgmentId],
    new Map([
      [appendixNegative.judgmentId, "DUPLICATE_DECISION_RATIONALE"],
      [cappedAppendix.judgmentId, "MAIN_PLACEMENT_CAP_OR_DIVERSITY_RULE"],
    ]),
  ));

  assert.equal(synthesis.branch, "single_perspective");
  assert.deepEqual(synthesis.judgmentIds, [selected.judgmentId]);
  assert.deepEqual(synthesis.evidenceItemIds, selected.selectionBasisEvidenceIds);
});

test("rejects missing, extra, duplicate, and mismatched disposition-passage membership", () => {
  const input = scenario(2);
  const first = passage(input.provisionalPriority[0]!, { fingerprintDigit: "1" });
  const second = passage(input.provisionalPriority[1]!, { fingerprintDigit: "2" });
  const selectedDisposition = synthesisDispositions([first])[0]!;

  assert.throws(
    () => buildNamedLensSynthesis({
      passages: [],
      dispositions: [selectedDisposition],
    }),
    /missing|membership/i,
  );
  assert.throws(
    () => buildNamedLensSynthesis({ passages: [first], dispositions: [] }),
    /extra|membership/i,
  );
  assert.throws(
    () => buildNamedLensSynthesis({
      passages: [first, first],
      dispositions: [selectedDisposition],
    }),
    /duplicate|membership/i,
  );
  assert.throws(
    () => buildNamedLensSynthesis({
      passages: [first, second],
      dispositions: [
        selectedDisposition,
        {
          ...synthesisDispositions([second], [])[0]!,
          passageFingerprint: sha("9"),
        },
      ],
    }),
    /mismatch|membership|fingerprint/i,
  );
});

test("rejects understated and overstated persisted passage word counts", () => {
  const input = scenario(1);
  const exact = passageWithSegmentCounts(
    passage(input.provisionalPriority[0]!, { fingerprintDigit: "1" }),
    [50, 50, 50, 50, 50],
  );
  for (const wordCount of [1, 251]) {
    const malformed = { ...exact, wordCount };
    assert.throws(
      () => buildNamedLensSynthesis(synthesisInput([malformed])),
      /180|persisted passage word count|exact(?:ly)?(?: equal)? word count|exactly equal the five persisted passage segments/i,
    );
  }
});

test("accepts the exact 1,600-word selected-passage and synthesis boundary", () => {
  const input = scenario(6);
  const passages = input.provisionalPriority.map((priority, index) => {
    const base = passage(priority, { fingerprintDigit: String(index + 1) });
    const supportive = {
      ...base,
      conditionalConclusion: {
        ...base.conditionalConclusion,
        stance: "supportive" as const,
      },
    };
    return passageWithSegmentCounts(
      supportive,
      index === 0
        ? [62, 62, 61, 61, 14]
        : index === 1
        ? [62, 62, 61, 60, 15]
        : [65, 65, 64, 65, 1],
    );
  });

  const synthesis = buildNamedLensSynthesis(synthesisInput(passages));
  assert.equal(synthesis.branch, "bounded_alignment");
  assert.equal(
    passages.reduce((total, item) => total + item.wordCount, 0)
      + englishWords(synthesis.text),
    1_600,
  );
});
