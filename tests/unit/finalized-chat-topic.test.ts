import assert from "node:assert/strict";
import test from "node:test";

import { classifyFinalizedChatTopicV2 } from
  "../../lib/chat/finalized-topic";

test("classifies each persisted Named Lens question without widening the V1 topic set", () => {
  const cases = [
    [
      "Why was the Howard Marks lens selected?",
      "named_lens_selection_reason",
    ],
    [
      "Which exact evidence did the Howard Marks lens use?",
      "named_lens_exact_evidence",
    ],
    [
      "What would change the Howard Marks lens's view?",
      "named_lens_view_change",
    ],
    [
      "Why does the Howard Marks lens have zero formal-decision weight?",
      "named_lens_formal_weight",
    ],
  ] as const;

  for (const [question, topic] of cases) {
    assert.deepEqual(classifyFinalizedChatTopicV2(question), {
      status: "matched",
      topic,
    });
  }
});

test("V2 topic classification fails closed for unsupported or mixed questions", () => {
  assert.deepEqual(
    classifyFinalizedChatTopicV2("Tell me everything about this lens."),
    {
      status: "insufficient",
      reasonCode: "unsupported_topic",
      matchedTopics: [],
    },
  );
  assert.deepEqual(
    classifyFinalizedChatTopicV2(
      "Why was this lens selected and what would change its view?",
    ),
    {
      status: "insufficient",
      reasonCode: "ambiguous_topic",
      matchedTopics: [
        "named_lens_selection_reason",
        "named_lens_view_change",
      ],
    },
  );
});
