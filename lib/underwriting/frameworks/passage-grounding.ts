import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  BeliefActionKindSchema,
  type BeliefActionKind,
} from "../../contracts/domain";
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
  metadataForBeliefActionKind,
  renderRecommendedNextMove,
} from "../../reports/action-policy";
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

export const NamedLensPassageReasonCodeSchema = z.enum([
  "foreign_passage_judgment",
  "foreign_passage_focus",
  "unsafe_passage_content",
  "invalid_passage_schema",
  "foreign_passage_source",
  "foreign_passage_evidence",
  "counterevidence_boundary_mismatch",
  "passage_partition_mismatch",
  "foreign_passage_unknown",
  "passage_stance_mismatch",
  "passage_posture_mismatch",
  "unsafe_passage_action",
  "unsafe_passage_voice",
  "unsafe_passage_quote",
  "passage_word_limit_exceeded",
]);

export type NamedLensPassageReasonCode = z.infer<
  typeof NamedLensPassageReasonCodeSchema
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
      reasonCode: NamedLensPassageReasonCodeSchema,
      authorizedFocus: AuthorizedNamedLensFocusSchema.nullable(),
    }),
  ],
);

export type NamedLensPassageValidationResult = z.infer<
  typeof NamedLensPassageValidationResultSchema
>;

const FORMAL_GOVERNANCE_PATTERN = /\b(?:formal[ _-]+decision|decision[ _-]+ceiling|hard[ _-]+veto|veto|invest[ _-]+candidate|(?:decision|recommendation|rating|label|outcome)(?:\s+(?:is|of|to))?\s+(?:pass|watch|advance))\b/iu;
const FORMAL_DECISION_LABEL_PATTERN = /\b(?:Pass|Watch|Advance|Invest Candidate)\b/u;
const FORMAL_ADVICE_TERM_PATTERN = /\b(?:decision|recommend(?:ation|ations|ed|ing|s)?|directive|directed|directing|directs|endorse(?:ment|ments|d|s)?|approval|approved|rating|label|outcome|ceiling|veto|prescrib(?:e|ed|es|ing)|next[ _-]+step)\b/iu;
const INVESTMENT_OR_DEAL_TERM_PATTERN = /\b(?:invest(?:ment|ments|ed|ing|s)?|deal|transaction|buy|buying|purchase|reject|pass|watch|advance)\b/iu;
const ORGANIZATION_DIRECTIVE_PATTERN = /\b(?:VSee|(?:the[ _-]+)?fund|(?:the[ _-]+)?IC|(?:the[ _-]+)?investment[ _-]+committee)\s+(?:(?:should|must|ought[ _-]+to|needs?[ _-]+to|will|is[ _-]+(?:directed|expected|recommended)[ _-]+to)\s+(?:invest|reject|pass|watch|advance|continue|deprioritize|reopen|evaluate|pause|begin|review)|(?:recommends?|directs?|endorses?|approves?)\s+(?:(?:an?|the)[ _-]+)?(?:investment|investing|buying|purchase|rejection))\b/iu;
const FIRST_PERSON_PATTERN = /\b(?:I|me|my|mine|myself|we|us|our|ours|ourselves)\b/iu;
const NON_SINGLE_QUOTATION_MARKER_PATTERN = /["“”„‟«»‹›「」『』〝〞〟＂]/u;
const SINGLE_QUOTATION_MARKERS = new Set(["'", "‘", "’", "‚", "‛"]);
const ENGLISH_SENTENCE_SEGMENTER = new Intl.Segmenter("en", {
  granularity: "sentence",
});
const NAMED_PERSON_STANCE_PATTERN = /\b(?!(?:The|This)\b)\p{Lu}[\p{L}'’.-]+(?:\s+\p{Lu}[\p{L}'’.-]+)+\s+(?:(?:would|should)\s+(?:invest|reject|pass|watch|advance)|endorses?|recommends?|rejects?|(?:supports?|opposes?)\s+(?:the\s+)?investment|believes?|thinks?|argues?|concludes?|maintains?|expects?|predicts?|says?)\b/u;
const LENS_ENDORSEMENT_PATTERN = /\b(?:this|the)[ _-]+(?:framework|lens|analysis|passage)\s+(?:endorses?|recommends?|approves?|rejects?|supports?|opposes?)\s+(?:(?:an?|the)\s+)?(?:investment|investing|buying|company)\b/iu;
const IMPERSONATION_PATTERN = /\b(?:endorsed|recommends?[ _-]+investing|would[ _-]+invest|private[ _-]+reasoning|hidden[ _-]+reasoning|chain[ _-]+of[ _-]+thought)\b/iu;

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
    reasonCode: NamedLensPassageReasonCode,
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
      FIRST_PERSON_PATTERN.test(text)
      || NAMED_PERSON_STANCE_PATTERN.test(text)
      || hasAuthorizedNamedPersonReference(text, card)
      || LENS_ENDORSEMENT_PATTERN.test(text)
      || IMPERSONATION_PATTERN.test(text)
    )
  ) {
    return withheld("unsafe_passage_voice", authorizedFocus);
  }
  if (
    texts.some((text) =>
      FORMAL_GOVERNANCE_PATTERN.test(text)
      || FORMAL_DECISION_LABEL_PATTERN.test(text)
      || hasFormalAdviceSentence(text)
      || ORGANIZATION_DIRECTIVE_PATTERN.test(text)
    )
  ) {
    return withheld("unsafe_passage_action", authorizedFocus);
  }
  if (texts.some(hasQuotationPunctuation)) {
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

function hasAuthorizedNamedPersonReference(
  text: string,
  card: ExperimentalAdvisoryFrameworkCard,
): boolean {
  const aliases = new Set<string>();
  for (const component of card.experimentalAdvisory.components) {
    for (const person of component.attribution.people) {
      const words = person.trim().split(/\s+/u).filter(Boolean);
      if (words.length === 0) continue;
      aliases.add(person.trim());
      const givenName = words[0]!;
      if (givenName.length >= 3) aliases.add(givenName);
      const surname = words.at(-1)!;
      if (surname.length >= 3) aliases.add(surname);
    }
  }
  if (aliases.size === 0) return false;
  const aliasPattern = [...aliases]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join("|");
  const namedPersonReference = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])(?:${aliasPattern})(?=$|[^\\p{L}\\p{N}])`,
    "iu",
  );
  return namedPersonReference.test(text);
}

function hasQuotationPunctuation(text: string): boolean {
  return NON_SINGLE_QUOTATION_MARKER_PATTERN.test(text)
    || hasUnsafeSingleQuotationMarker(text);
}

function hasFormalAdviceSentence(text: string): boolean {
  return [...ENGLISH_SENTENCE_SEGMENTER.segment(text)].some(({ segment }) => {
    return FORMAL_ADVICE_TERM_PATTERN.test(segment)
      && (
        INVESTMENT_OR_DEAL_TERM_PATTERN.test(segment)
        || hasTypedActionSemantic(segment)
      );
  });
}

const TYPED_ACTION_SEMANTIC_PHRASES = deriveTypedActionSemanticPhrases();

function deriveTypedActionSemanticPhrases(): readonly (readonly string[])[] {
  const phrases = new Map<string, readonly string[]>();
  const add = (phrase: string): void => {
    const tokens = semanticTokens(phrase);
    if (tokens.length > 0) phrases.set(tokens.join("\u0000"), tokens);
  };

  for (const kind of BeliefActionKindSchema.options) {
    const canonical = kind.replaceAll("_", " ");
    const humanized = humanizedActionCore(kind);
    add(canonical);
    add(humanized);

    if (kind === "no_new_action") continue;
    const humanizedTokens = semanticTokens(humanized);
    const baseVerb = humanizedTokens[0];
    if (!baseVerb) continue;
    for (const inflection of boundedVerbInflections(baseVerb)) {
      add([inflection, ...humanizedTokens.slice(1)].join(" "));
    }

    const canonicalTokens = semanticTokens(canonical);
    if (canonicalTokens[0] !== baseVerb) continue;
    for (const inflection of boundedVerbInflections(baseVerb)) {
      add([inflection, ...canonicalTokens.slice(1)].join(" "));
    }
  }
  return [...phrases.values()];
}

function humanizedActionCore(kind: BeliefActionKind): string {
  const rendered = renderRecommendedNextMove([{
    kind,
    ...metadataForBeliefActionKind(kind),
  }]);
  return rendered
    .replace(/\s+based on the cited evidence\.$/iu, "")
    .replace(/\s+before relying on this company analysis\.$/iu, "")
    .replace(/\s+is recommended\.$/iu, "")
    .replace(/\.$/u, "");
}

function boundedVerbInflections(base: string): readonly string[] {
  if (base === "begin") return ["begin", "begins", "began", "beginning"];
  if (base.endsWith("e")) {
    return [base, `${base}s`, `${base}d`, `${base.slice(0, -1)}ing`];
  }
  return [base, `${base}s`, `${base}ed`, `${base}ing`];
}

function hasTypedActionSemantic(sentence: string): boolean {
  const tokens = semanticTokens(sentence);
  return TYPED_ACTION_SEMANTIC_PHRASES.some((phrase) =>
    containsTokenSequence(tokens, phrase)
  );
}

function semanticTokens(value: string): string[] {
  return value.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? [];
}

function containsTokenSequence(
  tokens: readonly string[],
  phrase: readonly string[],
): boolean {
  if (phrase.length === 0 || phrase.length > tokens.length) return false;
  return tokens.some((_, start) =>
    start + phrase.length <= tokens.length
    && phrase.every((token, offset) => tokens[start + offset] === token)
  );
}

function hasUnsafeSingleQuotationMarker(text: string): boolean {
  const characters = [...text];
  for (let index = 0; index < characters.length; index += 1) {
    const marker = characters[index];
    if (!marker || !SINGLE_QUOTATION_MARKERS.has(marker)) continue;
    const previous = characters[index - 1];
    const next = characters[index + 1];
    if (isWordCharacter(previous) && isWordCharacter(next)) continue;
    if ((previous === "s" || previous === "S") && !isWordCharacter(next)) {
      continue;
    }
    return true;
  }
  return false;
}

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[\p{L}\p{N}]/u.test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
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
