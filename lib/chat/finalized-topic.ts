import {
  type FinalizedChatTopic,
  type FinalizedChatTopicV2,
  FinalizedChatTopicSchema,
  FinalizedChatTopicV2Schema,
} from "../contracts/finalized-chat";

export type FinalizedChatTopicClassification =
  | { status: "matched"; topic: FinalizedChatTopic }
  | {
    status: "insufficient";
    reasonCode: "unsupported_topic" | "ambiguous_topic";
    matchedTopics: FinalizedChatTopic[];
  };

const TOPIC_PATTERNS: Readonly<Record<FinalizedChatTopic, RegExp[]>> = {
  prior_reason: [
    /\bwhy\b[^?]*\b(?:originally\s+)?pass(?:ed)?\b/iu,
    /\b(?:prior|previous|original)\s+(?:decision\s+)?reason\b/iu,
    /\bsample\s+fund\s+pass(?:ed)?\b/iu,
  ],
  belief_change: [
    /\b(?:which|what)\s+(?:new\s+)?evidence\b[^?]*\bchang(?:e|ed|es|ing)\b/iu,
    /\bchang(?:e|ed|es|ing)\b[^?]*\b(?:that|the|our|prior)\s+belief\b/iu,
    /\bbelief\s+change\b/iu,
  ],
  strongest_counterargument: [
    /\bstrongest\s+counterargument\b/iu,
    /\bmain\s+counterargument\b/iu,
  ],
  match_confidence: [
    /\bmatch\b[^?]*\b(?:medium|high)\b[^?]*\bconfidence\b/iu,
    /\b(?:why|what)\b[^?]*\bmatch\s+confidence\b/iu,
    /\bconfidence\b[^?]*\bmatch\b/iu,
  ],
  framework_disagreement: [
    /\b(?:investor\s+)?frameworks?\b[^?]*\bdisagree(?:ment)?\b/iu,
    /\bdisagree(?:ment)?\b[^?]*\bframeworks?\b/iu,
  ],
  valuation: [
    /\bvaluation\b/iu,
    /\bbear\s*\/\s*base\s*\/\s*bull\b/iu,
  ],
  missing_evidence: [
    /\b(?:evidence|data)\b[^?]*\b(?:still\s+)?missing\b/iu,
    /\bmissing\s+(?:evidence|data)\b/iu,
  ],
  invested_action: [
    /\binvested\s+company\b/iu,
    /\bfollow[- ]on\b[^?]*\b(?:risk|action)\b/iu,
    /\b(?:pause|begin)\b[^?]*\bportfolio[- ]risk\b/iu,
  ],
};

export function classifyFinalizedChatTopic(
  question: string,
): FinalizedChatTopicClassification {
  const normalized = question.normalize("NFKC").trim();
  const matchedTopics = FinalizedChatTopicSchema.options.filter((topic) =>
    TOPIC_PATTERNS[topic].some((pattern) => pattern.test(normalized))
  );
  if (matchedTopics.length === 1) {
    return { status: "matched", topic: matchedTopics[0] };
  }
  return {
    status: "insufficient",
    reasonCode: matchedTopics.length === 0
      ? "unsupported_topic"
      : "ambiguous_topic",
    matchedTopics,
  };
}

export type FinalizedChatTopicClassificationV2 =
  | { status: "matched"; topic: FinalizedChatTopicV2 }
  | {
    status: "insufficient";
    reasonCode: "unsupported_topic" | "ambiguous_topic";
    matchedTopics: FinalizedChatTopicV2[];
  };

const TOPIC_PATTERNS_V2: Readonly<
  Record<FinalizedChatTopicV2, RegExp[]>
> = {
  named_lens_selection_reason: [
    /\bwhy\b[^?]*\blens\b[^?]*\bselect(?:ed|ion)\b/iu,
    /\bwhy\b[^?]*\bselect(?:ed|ion)\b[^?]*\blens\b/iu,
  ],
  named_lens_exact_evidence: [
    /\b(?:which|what)\b[^?]*\bexact\s+evidence\b[^?]*\blens\b/iu,
    /\blens\b[^?]*\bexact\s+evidence\b/iu,
    /\b(?:which|what)\b[^?]*\bevidence\b[^?]*\blens\b[^?]*\buse(?:d)?\b/iu,
  ],
  named_lens_view_change: [
    /\bwhat\b[^?]*\bchang(?:e|ed|es)\b[^?]*\blens\b[^?]*\bview\b/iu,
    /\blens\b[^?]*\bview\b[^?]*\bchang(?:e|ed|es)\b/iu,
    /\bwhat\s+would\s+change\s+(?:this|its|the)\s+view\b/iu,
  ],
  named_lens_formal_weight: [
    /\bwhy\b[^?]*\blens\b[^?]*\b(?:zero|0)\b[^?]*\bformal(?:-decision|\s+decision)?\s+weight\b/iu,
    /\bformal(?:-decision|\s+decision)?\s+weight\b[^?]*\b(?:zero|0)\b/iu,
  ],
};

export function classifyFinalizedChatTopicV2(
  question: string,
): FinalizedChatTopicClassificationV2 {
  const normalized = question.normalize("NFKC").trim();
  const matchedTopics = FinalizedChatTopicV2Schema.options.filter((topic) =>
    TOPIC_PATTERNS_V2[topic].some((pattern) => pattern.test(normalized))
  );
  if (matchedTopics.length === 1) {
    return { status: "matched", topic: matchedTopics[0] };
  }
  return {
    status: "insufficient",
    reasonCode: matchedTopics.length === 0
      ? "unsupported_topic"
      : "ambiguous_topic",
    matchedTopics,
  };
}
