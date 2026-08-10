import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  EvidencePackSchema,
  type EvidencePack,
} from "../../contracts/evidence";
import {
  CandidateRunSchema,
  FrameworkJudgmentSchema,
  type CandidateRun,
  type FrameworkJudgment,
} from "../../contracts/underwriting";
import {
  GroundedNamedLensPassageCandidateSchema,
} from "../../contracts/named-lens";
import { createCanonicalFingerprint } from "../fingerprints";
import {
  DecisionTaxonomyBindingSchema,
} from "./decision-taxonomy";
import {
  ExperimentalAdvisoryFrameworkCardSchema,
  NamedLensPassageCandidateSchema,
  type ExperimentalAdvisoryFrameworkCard,
  type NamedLensPassageCandidate,
} from "./schemas";

export const AuthorizedNamedLensFocusSchema = z.strictObject({
  compositeFrameworkCardId: z.string().min(1),
  componentVersion: z.string().min(1),
  binding: DecisionTaxonomyBindingSchema,
});

export type AuthorizedNamedLensFocus = z.infer<
  typeof AuthorizedNamedLensFocusSchema
>;

export const NamedLensPassageValidationResultSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      judgmentOrCatalogCandidateId: z.string().min(1),
      status: z.literal("validated"),
      authorizedFocus: AuthorizedNamedLensFocusSchema,
      groundedCandidate: GroundedNamedLensPassageCandidateSchema,
    }),
    z.strictObject({
      judgmentOrCatalogCandidateId: z.string().min(1),
      status: z.enum(["withheld", "unavailable"]),
      reasonCode: z.string().min(1),
      authorizedFocus: AuthorizedNamedLensFocusSchema.nullable(),
    }),
  ],
);

export type NamedLensPassageValidationResult = z.infer<
  typeof NamedLensPassageValidationResultSchema
>;

const FORMAL_ACTION_PATTERN = /\b(?:formal decision|decision ceiling|veto|invest candidate|advance diligence|continue monitoring|deprioritize|reopen diligence|evaluate follow on|pause follow on|portfolio risk review|no new action|review analysis failure|(?:decision|recommendation|rating|label|outcome)(?:\s+(?:is|of|to))?\s+(?:pass|watch|advance))\b/iu;
const FORMAL_DECISION_LABEL_PATTERN = /\b(?:Pass|Watch|Advance|Invest Candidate)\b/u;
const FIRST_PERSON_PATTERN = /\b(?:I|me|my|mine|myself|we|us|our|ours|ourselves)\b/iu;
const QUOTATION_PATTERN = /["“”]/u;
const IMPERSONATION_PATTERN = /\b(?:endorses?|endorsed|recommends? investing|would invest|private reasoning|hidden reasoning|chain of thought)\b/iu;

export function groundNamedLensPassage(input: {
  candidate: CandidateRun;
  pack: EvidencePack;
  card: ExperimentalAdvisoryFrameworkCard;
  judgment: FrameworkJudgment;
  candidatePassage: unknown;
  generatorVersion: string;
}): NamedLensPassageValidationResult {
  const candidate = CandidateRunSchema.parse(input.candidate);
  const pack = EvidencePackSchema.parse(input.pack);
  const card = ExperimentalAdvisoryFrameworkCardSchema.parse(input.card);
  const judgment = FrameworkJudgmentSchema.parse(input.judgment);
  const resultId = judgment.id;
  const withheld = (
    reasonCode: string,
    authorizedFocus: AuthorizedNamedLensFocus | null,
  ): NamedLensPassageValidationResult => ({
    judgmentOrCatalogCandidateId: resultId,
    status: "withheld",
    reasonCode,
    authorizedFocus,
  });

  if (
    candidate.workspaceId !== pack.workspaceId
    || candidate.dealId !== pack.dealId
    || judgment.frameworkCardId !== card.id
    || judgment.frameworkVersion !== card.version
    || judgment.applicability !== "applicable"
    || judgment.conclusion === "abstain"
    || !isDeepStrictEqual(
      judgment.frameworkMetadata,
      card.experimentalAdvisory,
    )
  ) {
    return {
      judgmentOrCatalogCandidateId: resultId,
      status: "unavailable",
      reasonCode: "foreign_passage_judgment",
      authorizedFocus: null,
    };
  }

  const authorizedFocus = authorizeFocus(input.candidatePassage, card);
  if (!authorizedFocus) return withheld("foreign_passage_focus", null);

  const parsedCandidate = NamedLensPassageCandidateSchema.safeParse(
    input.candidatePassage,
  );
  if (!parsedCandidate.success) {
    const unsafe = parsedCandidate.error.issues.some(({ message }) =>
      /plain text/i.test(message)
    );
    return withheld(
      unsafe ? "unsafe_passage_content" : "invalid_passage_schema",
      authorizedFocus,
    );
  }
  const passage = parsedCandidate.data;
  if (!focusMatchesAuthorization(passage, authorizedFocus)) {
    return withheld("foreign_passage_focus", null);
  }

  if (!premiseIsAuthorized(passage, card)) {
    return withheld("foreign_passage_source", authorizedFocus);
  }

  const packIds = new Set([
    ...pack.facts.map(({ id }) => id),
    ...pack.assumptions.map(({ id }) => id),
  ]);
  const passageEvidenceIds = [
    ...passage.caseApplication.evidenceItemIds,
    ...passage.countercase.evidenceItemIds,
  ];
  if (passageEvidenceIds.some((id) => !packIds.has(id))) {
    return withheld("foreign_passage_evidence", authorizedFocus);
  }
  if (!counterevidenceBoundaryMatches(judgment, passage)) {
    return withheld(
      "counterevidence_boundary_mismatch",
      authorizedFocus,
    );
  }
  const supportIds = new Set(judgment.supportEvidenceItemIds);
  const counterIds = new Set(judgment.counterEvidenceItemIds);
  if (
    passage.caseApplication.evidenceItemIds.some((id) => !supportIds.has(id))
    || passage.countercase.evidenceItemIds.some((id) => !counterIds.has(id))
  ) {
    return withheld("passage_partition_mismatch", authorizedFocus);
  }

  const unknownSet = new Set(judgment.unknowns);
  const limitationSet = new Set(judgment.limitations);
  const savedRequestRefs = new Set(
    "counterevidenceBoundary" in judgment
      ? judgment.counterevidenceBoundary.evidenceRequestRefs
      : [],
  );
  if (
    passage.unknownBoundary.judgmentUnknownRefs.some(
      (value) => !unknownSet.has(value),
    )
    || passage.unknownBoundary.judgmentLimitationRefs.some(
      (value) => !limitationSet.has(value),
    )
    || passage.unknownBoundary.evidenceRequestRefs.some(
      (value) => !savedRequestRefs.has(value),
    )
  ) {
    return withheld("foreign_passage_unknown", authorizedFocus);
  }

  if (passage.conditionalConclusion.stance !== judgment.conclusion) {
    return withheld("passage_stance_mismatch", authorizedFocus);
  }
  if (
    passage.conditionalConclusion.advisoryPosture
      !== postureForStance(judgment.conclusion)
  ) {
    return withheld("passage_posture_mismatch", authorizedFocus);
  }

  const texts = passageTexts(passage);
  if (
    texts.some((text) =>
      FORMAL_ACTION_PATTERN.test(text)
      || FORMAL_DECISION_LABEL_PATTERN.test(text)
    )
  ) {
    return withheld("unsafe_passage_action", authorizedFocus);
  }
  if (
    texts.some((text) =>
      FIRST_PERSON_PATTERN.test(text) || IMPERSONATION_PATTERN.test(text)
    )
  ) {
    return withheld("unsafe_passage_voice", authorizedFocus);
  }
  if (texts.some((text) => QUOTATION_PATTERN.test(text))) {
    return withheld("unsafe_passage_quote", authorizedFocus);
  }

  const wordCount = texts.reduce(
    (total, text) => total + englishWordCount(text),
    0,
  );
  if (wordCount > 260) {
    return withheld("passage_word_limit_exceeded", authorizedFocus);
  }

  const groundedValue = {
    schemaVersion: "named-lens-passage-v1" as const,
    workspaceId: candidate.workspaceId,
    artifactSourceCandidateRunId: candidate.id,
    judgmentId: judgment.id,
    frameworkCardId: judgment.frameworkCardId,
    frameworkVersion: judgment.frameworkVersion,
    focus: {
      componentFrameworkId:
        authorizedFocus.binding.frameworkId,
      componentVersion: authorizedFocus.componentVersion,
      cardFieldRef: authorizedFocus.binding.cardFieldRef,
      questionText: authorizedFocus.binding.questionText,
      decisionQuestionCode:
        authorizedFocus.binding.decisionQuestionCode,
      evidenceDomainCodes:
        authorizedFocus.binding.evidenceDomainCodes,
    },
    premise: passage.premise,
    caseApplication: passage.caseApplication,
    countercase: passage.countercase,
    unknownBoundary: passage.unknownBoundary,
    conditionalConclusion: passage.conditionalConclusion,
    advisoryContract: passage.advisoryContract,
    wordCount,
    generatorVersion: requiredVersion(input.generatorVersion),
  };
  const groundedCandidate = GroundedNamedLensPassageCandidateSchema.parse({
    ...groundedValue,
    groundingFingerprint: createCanonicalFingerprint({
      kind: "grounded-named-lens-passage-candidate-v1",
      ...groundedValue,
    }),
  });
  return {
    judgmentOrCatalogCandidateId: resultId,
    status: "validated",
    authorizedFocus,
    groundedCandidate,
  };
}

function authorizeFocus(
  rawPassage: unknown,
  card: ExperimentalAdvisoryFrameworkCard,
): AuthorizedNamedLensFocus | null {
  const focus = NamedLensPassageCandidateSchema.shape.focus.safeParse(
    rawPassage && typeof rawPassage === "object"
      ? (rawPassage as { focus?: unknown }).focus
      : undefined,
  );
  if (!focus.success) return null;
  const metadata = card.experimentalAdvisory;
  const components = metadata.components.filter(
    ({ frameworkId }) => frameworkId === focus.data.componentFrameworkId,
  );
  const componentIds = metadata.componentCardIds.filter(
    (frameworkId) => frameworkId === focus.data.componentFrameworkId,
  );
  const bindings = metadata.decisionTaxonomyBindings.filter((binding) =>
    binding.frameworkId === focus.data.componentFrameworkId
    && binding.cardFieldRef === focus.data.cardFieldRef
    && binding.decisionQuestionCode === focus.data.decisionQuestionCode
    && sameStringSet(
      binding.evidenceDomainCodes,
      focus.data.evidenceDomainCodes,
    )
  );
  if (
    components.length !== 1
    || componentIds.length !== 1
    || bindings.length !== 1
    || components[0]!.version !== focus.data.componentVersion
  ) return null;
  const questionIndex = questionIndexFor(focus.data.cardFieldRef);
  if (
    questionIndex === null
    || components[0]!.decisionQuestions[questionIndex]
      !== bindings[0]!.questionText
  ) return null;
  return AuthorizedNamedLensFocusSchema.parse({
    compositeFrameworkCardId: card.id,
    componentVersion: components[0]!.version,
    binding: {
      ...bindings[0],
      evidenceDomainCodes: focus.data.evidenceDomainCodes,
    },
  });
}

function focusMatchesAuthorization(
  passage: NamedLensPassageCandidate,
  authorized: AuthorizedNamedLensFocus,
): boolean {
  return passage.focus.componentFrameworkId === authorized.binding.frameworkId
    && passage.focus.componentVersion === authorized.componentVersion
    && passage.focus.cardFieldRef === authorized.binding.cardFieldRef
    && passage.focus.decisionQuestionCode
      === authorized.binding.decisionQuestionCode
    && sameStrings(
      passage.focus.evidenceDomainCodes,
      authorized.binding.evidenceDomainCodes,
    );
}

function premiseIsAuthorized(
  passage: NamedLensPassageCandidate,
  card: ExperimentalAdvisoryFrameworkCard,
): boolean {
  const component = card.experimentalAdvisory.components.find(
    ({ frameworkId }) =>
      frameworkId === passage.focus.componentFrameworkId,
  );
  if (!component) return false;
  const citedRefs = passage.premise.publicSourceIds.map((sourceId) =>
    component.sourceRefs.find((sourceRef) => sourceRef.sourceId === sourceId)
  );
  const sourceIds = new Set(
    card.experimentalAdvisory.sources.map(({ sourceId }) => sourceId),
  );
  if (
    citedRefs.some((sourceRef) => sourceRef === undefined)
    || passage.premise.publicSourceIds.some((sourceId) => !sourceIds.has(sourceId))
  ) return false;
  const exactRefs = citedRefs.filter((value) => value !== undefined);
  const allowedClaims = new Set(exactRefs.flatMap(({ claimIds }) => claimIds));
  return passage.premise.claimIds.every((claimId) =>
    allowedClaims.has(claimId)
  )
    && exactRefs.every((sourceRef) =>
      isDeepStrictEqual(sourceRef.locator, passage.premise.locator)
      && sourceRef.attributionScope === passage.premise.attributionScope
    );
}

function counterevidenceBoundaryMatches(
  judgment: FrameworkJudgment,
  passage: NamedLensPassageCandidate,
): boolean {
  if (!("counterevidenceBoundary" in judgment)) return false;
  const boundary = judgment.counterevidenceBoundary;
  const grounded = judgment.counterEvidenceItemIds.length > 0;
  return grounded
    ? boundary.kind === "grounded_counterevidence"
      && boundary.evidenceRequestRefs.length === 0
      && passage.countercase.boundaryKind === "grounded_counterevidence"
      && passage.countercase.evidenceItemIds.length > 0
      && passage.countercase.evidenceRequestRefs.length === 0
    : boundary.kind === "no_candidate_local_counterevidence"
      && boundary.evidenceRequestRefs.length > 0
      && passage.countercase.boundaryKind
        === "no_candidate_local_counterevidence"
      && passage.countercase.evidenceItemIds.length === 0
      && sameStrings(
        passage.countercase.evidenceRequestRefs,
        boundary.evidenceRequestRefs,
      );
}

function postureForStance(
  stance: FrameworkJudgment["conclusion"],
): NamedLensPassageCandidate["conditionalConclusion"]["advisoryPosture"] {
  switch (stance) {
    case "supportive": return "supports_further_diligence";
    case "negative": return "urges_caution";
    case "mixed":
    case "abstain": return "withholds_view";
  }
}

function passageTexts(passage: NamedLensPassageCandidate): string[] {
  return [
    passage.premise.text,
    passage.caseApplication.text,
    passage.countercase.text,
    passage.unknownBoundary.text,
    passage.conditionalConclusion.text,
  ];
}

/** English words are non-empty tokens separated by Unicode whitespace. */
function englishWordCount(value: string): number {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

function questionIndexFor(cardFieldRef: string): number | null {
  const match = /^decisionQuestions\[([0-9]+)\]$/u.exec(cardFieldRef);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isSafeInteger(index) ? index : null;
}

function requiredVersion(value: string): string {
  if (value.trim() !== value || value.length === 0) {
    throw new Error(
      "Named Lens generator version must be non-empty without surrounding whitespace.",
    );
  }
  return value;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length
    && new Set(left).size === left.length
    && new Set(right).size === right.length
    && left.every((value) => right.includes(value));
}
