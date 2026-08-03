import {
  type FinalizedChatTopic,
  FinalizedChatTopicSchema,
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
