import assert from "node:assert/strict";
import test from "node:test";

import {
  FinalizedChatArtifactRefSchema,
  FinalizedChatClaimSchema,
  FinalizedChatEvidenceFrameSchema,
  FinalizedChatProjectionBuildResultSchema,
  FinalizedChatProjectionV1Schema,
  FinalizedChatResponseSchema,
  FinalizedChatSourceRefSchema,
  createFinalizedChatClaimFingerprint,
  createFinalizedChatClaimId,
  createFinalizedChatClaim,
  createFinalizedChatProjection,
} from "../../lib/contracts/finalized-chat";
import { classifyFinalizedChatTopic } from "../../lib/chat/finalized-topic";
import { renderFinalizedChatProjection } from "../../lib/chat/finalized-renderer";
import {
  exactSourceV2,
  normalizedSourceV2,
} from "../helpers/source-evidence-v2";
import { WritableSourceRefV2Schema } from "../../lib/contracts/source-evidence";

const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;
const SHA_C = `sha256:${"c".repeat(64)}`;
const SHA_D = `sha256:${"d".repeat(64)}`;

const identity = {
  workspaceId: "workspace_demo",
  reportId: "report_demo",
  runId: "00000000-0000-4000-8000-000000000011",
  dealId: "deal_henry",
  candidateRunId: "candidate_henry",
} as const;

const liveFrame = {
  state: "current",
  evidenceMode: "live",
  contextFingerprint: SHA_A,
  eventSetFingerprint: SHA_B,
  bindingFingerprint: SHA_C,
  snapshotId: null,
  snapshotFingerprint: null,
} as const;

const normalizedCanonicalSource = WritableSourceRefV2Schema.parse(normalizedSourceV2(
  "fixture_henry_passed_v1",
  {
    provenance: "demo_fixture",
    title: "Sample decision record",
    canonicalUrl: null,
    documentId: "document_fixture_henry",
    publisher: null,
    providerId: "deal-registry",
    eventAt: "2026-06-01T12:00:00.000Z",
    eventAtPrecision: "timestamp",
    publishedAt: null,
    publishedAtPrecision: null,
    retrievedAt: "2026-08-01T20:00:00.000Z",
    retrievedAtPrecision: "timestamp",
    entityKeys: ["henry_ai"],
    sourceClass: "internal_decision_record",
    sourceAuthority: "primary",
    evidenceRole: "context",
    sourceRevisionId: "revision_fixture_henry_v1",
    contentFingerprint: SHA_D,
    text: {
      status: "normalized_only",
      normalizedStatement:
        "Sample decision record. The fund passed pending repeatable customer evidence.",
    },
  },
));

const exactCanonicalSource = WritableSourceRefV2Schema.parse(exactSourceV2("source_henry_event_v1", {
  documentId: "document_henry_event_v1",
  sourceRevisionId: "revision_henry_event_v1",
  contentFingerprint: SHA_C,
  text: {
    status: "verified_exact",
    verbatimExcerpt: "Henry announced a reviewed enterprise customer deployment.",
    normalizedStatement:
      "Henry reported a reviewed deployment with an enterprise customer.",
  },
}));

const normalizedSource = {
  sourceId: "fixture_henry_passed_v1",
  documentId: "document_fixture_henry",
  sourceRevisionId: "revision_fixture_henry_v1",
  contentFingerprint: SHA_D,
  canonicalSource: normalizedCanonicalSource,
  text: {
    status: "normalized_only",
    normalizedStatement:
      "Sample decision record. The fund passed pending repeatable customer evidence.",
  },
} as const;

const exactSource = {
  sourceId: "source_henry_event_v1",
  documentId: "document_henry_event_v1",
  sourceRevisionId: "revision_henry_event_v1",
  contentFingerprint: SHA_C,
  canonicalSource: exactCanonicalSource,
  text: {
    status: "verified_exact",
    verbatimExcerpt: "Henry announced a reviewed enterprise customer deployment.",
    normalizedStatement:
      "Henry reported a reviewed deployment with an enterprise customer.",
  },
} as const;

const memoryRef = {
  artifactType: "investment_memory",
  artifactId: "analysis_henry",
  fieldPath: "investmentMemory.decisionReason",
} as const;

test("strict finalized Chat schemas reject unknown topics, classes, artifacts, partial fingerprints, and empty refs", () => {
  const claim = createFinalizedChatClaim({
    identity,
    topic: "prior_reason",
    text: normalizedSource.text.normalizedStatement,
    textClass: "normalized_statement",
    artifactRefs: [memoryRef],
    sourceRefs: [normalizedSource],
  });
  const projection = createFinalizedChatProjection({
    topic: "prior_reason",
    identity,
    evidenceFrame: liveFrame,
    claims: [claim],
  });

  assert.equal(FinalizedChatProjectionV1Schema.safeParse({
    ...projection,
    topic: "made_up_topic",
  }).success, false);
  assert.equal(FinalizedChatClaimSchema.safeParse({
    ...claim,
    textClass: "summary",
  }).success, false);
  for (const expandedClass of ["assumption", "calculation", "unavailable"]) {
    assert.equal(FinalizedChatClaimSchema.safeParse({
      ...claim,
      textClass: expandedClass,
    }).success, false);
  }
  assert.equal(FinalizedChatArtifactRefSchema.safeParse({
    ...memoryRef,
    artifactType: "mutable_runtime_guess",
  }).success, false);
  assert.equal(FinalizedChatEvidenceFrameSchema.safeParse({
    ...liveFrame,
    contextFingerprint: "sha256:partial",
  }).success, false);
  assert.equal(FinalizedChatEvidenceFrameSchema.safeParse({
    ...liveFrame,
    bindingFingerprint: undefined,
  }).success, false);
  assert.equal(FinalizedChatClaimSchema.safeParse({
    ...claim,
    artifactRefs: [],
  }).success, false);
  assert.equal(FinalizedChatSourceRefSchema.safeParse({
    ...normalizedSource,
    sourceRevisionId: "",
  }).success, false);
  assert.equal(FinalizedChatSourceRefSchema.safeParse({
    ...normalizedSource,
    unexpected: true,
  }).success, false);
  assert.equal(FinalizedChatSourceRefSchema.safeParse({
    ...normalizedSource,
    canonicalSource: {
      ...normalizedCanonicalSource,
      evidenceRole: "trigger",
    },
  }).success, false);
});

test("current evidence frames are an exact live/pinned union and legacy is visibly unbound", () => {
  const pinned = {
    ...liveFrame,
    evidenceMode: "pinned",
    snapshotId: "belief_reversal_2026_08_01",
    snapshotFingerprint: SHA_D,
  } as const;

  assert.deepEqual(FinalizedChatEvidenceFrameSchema.parse(liveFrame), liveFrame);
  assert.deepEqual(FinalizedChatEvidenceFrameSchema.parse(pinned), pinned);
  assert.deepEqual(
    FinalizedChatEvidenceFrameSchema.parse({ state: "legacy_unbound" }),
    { state: "legacy_unbound" },
  );
  assert.equal(FinalizedChatEvidenceFrameSchema.safeParse({
    ...liveFrame,
    snapshotId: "forbidden_live_snapshot",
    snapshotFingerprint: SHA_D,
  }).success, false);
  assert.equal(FinalizedChatEvidenceFrameSchema.safeParse({
    ...pinned,
    snapshotFingerprint: null,
  }).success, false);
  assert.equal(FinalizedChatEvidenceFrameSchema.safeParse({
    state: "legacy_unbound",
    contextFingerprint: SHA_A,
  }).success, false);
});

test("the eight Section 15 questions each classify to exactly one finalized topic", () => {
  const cases = [
    ["Why did we originally pass on this company?", "prior_reason"],
    ["Which new evidence changed that belief?", "belief_change"],
    ["What is the strongest counterargument?", "strongest_counterargument"],
    ["Why is this match medium or high confidence?", "match_confidence"],
    [
      "Which investor frameworks disagree, and why?",
      "framework_disagreement",
    ],
    [
      "Is the current valuation attractive under Bear/Base/Bull?",
      "valuation",
    ],
    [
      "What evidence is still missing before IC consideration?",
      "missing_evidence",
    ],
    [
      "For the invested company, should we consider follow-on or begin risk action?",
      "invested_action",
    ],
  ] as const;

  for (const [question, topic] of cases) {
    assert.deepEqual(classifyFinalizedChatTopic(question), {
      status: "matched",
      topic,
    }, question);
  }
});

test("zero or multiple topic matches fail closed as typed insufficient classifications", () => {
  assert.deepEqual(
    classifyFinalizedChatTopic("Tell me everything about this company."),
    {
      status: "insufficient",
      reasonCode: "unsupported_topic",
      matchedTopics: [],
    },
  );
  assert.deepEqual(
    classifyFinalizedChatTopic(
      "Why did we originally pass, and is the valuation attractive?",
    ),
    {
      status: "insufficient",
      reasonCode: "ambiguous_topic",
      matchedTopics: ["prior_reason", "valuation"],
    },
  );
});

test("typed insufficient results never expose a partial finalized scope or citations", () => {
  const missingRef = {
    artifactType: "valuation_evaluation",
    artifactId: "valuation_henry",
    fieldPath: "status",
  } as const;
  const result = {
    status: "insufficient",
    topic: "valuation",
    reasonCode: "finalized_artifact_missing",
    missingArtifactRefs: [missingRef],
    identity,
    evidenceFrame: liveFrame,
  } as const;
  assert.deepEqual(
    FinalizedChatProjectionBuildResultSchema.parse(result),
    result,
  );
  assert.equal(FinalizedChatProjectionBuildResultSchema.safeParse({
    ...result,
    evidenceFrame: null,
  }).success, false);
  assert.equal(FinalizedChatProjectionBuildResultSchema.safeParse({
    ...result,
    identity: null,
  }).success, false);

  const response = {
    schemaVersion: "finalized-chat-response-v1",
    status: "insufficient",
    topic: "valuation",
    answer: "Insufficient finalized evidence for valuation.",
    citations: [],
    identity,
    evidenceFrame: liveFrame,
    insufficientEvidence: true,
    reasonCode: "finalized_artifact_missing",
    missingArtifactRefs: [missingRef],
  } as const;
  assert.deepEqual(FinalizedChatResponseSchema.parse(response), response);
  assert.equal(FinalizedChatResponseSchema.safeParse({
    ...response,
    citations: [normalizedSource],
  }).success, false);
  assert.equal(FinalizedChatResponseSchema.safeParse({
    ...response,
    identity: null,
  }).success, false);
});

test("claim identity and projection fingerprints are stable and bind exact text and field paths", () => {
  const input = {
    identity,
    topic: "prior_reason" as const,
    text: normalizedSource.text.normalizedStatement,
    textClass: "normalized_statement" as const,
    artifactRefs: [memoryRef],
    sourceRefs: [normalizedSource],
  };
  const first = createFinalizedChatClaim(input);
  const second = createFinalizedChatClaim(structuredClone(input));
  const identityInput = {
    identity: input.identity,
    topic: input.topic,
    artifactRefs: input.artifactRefs,
    textClass: input.textClass,
    text: input.text,
  };
  const changedText = createFinalizedChatClaim({
    ...input,
    text: "Sample decision record. A different persisted reason.",
    sourceRefs: [{
      ...normalizedSource,
      canonicalSource: {
        ...normalizedCanonicalSource,
        text: {
          status: "normalized_only" as const,
          normalizedStatement:
            "Sample decision record. A different persisted reason.",
        },
      },
      text: {
        status: "normalized_only" as const,
        normalizedStatement:
          "Sample decision record. A different persisted reason.",
      },
    }],
  });
  const changedPath = createFinalizedChatClaim({
    ...input,
    artifactRefs: [{ ...memoryRef, fieldPath: "investmentMemory.concerns[0]" }],
  });

  assert.equal(first.claimId, second.claimId);
  assert.equal(first.claimFingerprint, second.claimFingerprint);
  assert.equal(createFinalizedChatClaimId(identityInput), first.claimId);
  assert.equal(
    createFinalizedChatClaimFingerprint(identityInput),
    first.claimFingerprint,
  );
  assert.notEqual(first.claimId, changedText.claimId);
  assert.notEqual(first.claimFingerprint, changedPath.claimFingerprint);

  const projection = createFinalizedChatProjection({
    topic: "prior_reason",
    identity,
    evidenceFrame: liveFrame,
    claims: [first],
  });
  const replay = createFinalizedChatProjection({
    topic: "prior_reason",
    identity,
    evidenceFrame: structuredClone(liveFrame),
    claims: [structuredClone(first)],
  });
  assert.equal(projection.projectionFingerprint, replay.projectionFingerprint);
  assert.equal(FinalizedChatProjectionV1Schema.safeParse({
    ...projection,
    claims: [{ ...first, text: "tampered" }],
  }).success, false);
});

test("normalized statements can never validate or render as exact quotes", () => {
  assert.throws(() => createFinalizedChatClaim({
    identity,
    topic: "prior_reason",
    text: normalizedSource.text.normalizedStatement,
    textClass: "exact_quote",
    artifactRefs: [memoryRef],
    sourceRefs: [normalizedSource],
  }));
  assert.throws(() => createFinalizedChatClaim({
    identity,
    topic: "belief_change",
    text: exactSource.text.normalizedStatement,
    textClass: "exact_quote",
    artifactRefs: [{
      artifactType: "market_event",
      artifactId: "event_henry_v1",
      fieldPath: "sources[0].text.normalizedStatement",
    }],
    sourceRefs: [exactSource],
  }));

  const claim = createFinalizedChatClaim({
    identity,
    topic: "prior_reason",
    text: normalizedSource.text.normalizedStatement,
    textClass: "normalized_statement",
    artifactRefs: [memoryRef],
    sourceRefs: [normalizedSource],
  });
  const rendered = renderFinalizedChatProjection(createFinalizedChatProjection({
    topic: "prior_reason",
    identity,
    evidenceFrame: liveFrame,
    claims: [claim],
  }));

  assert.match(rendered.answer, /Normalized statement:/u);
  assert.doesNotMatch(
    rendered.answer,
    /“Sample decision record\. The fund passed[^”]+”/u,
  );
  assert.equal(rendered.insufficientEvidence, false);
  assert.deepEqual(rendered.citations, [normalizedSource]);
  assert.deepEqual(FinalizedChatResponseSchema.parse(rendered), rendered);
});

test("exact quotes require verbatim equality and an exact immutable revision", () => {
  const artifactRef = {
    artifactType: "market_event",
    artifactId: "event_henry_v1",
    fieldPath: "sources[0].text.verbatimExcerpt",
  } as const;
  const claim = createFinalizedChatClaim({
    identity,
    topic: "belief_change",
    text: exactSource.text.verbatimExcerpt,
    textClass: "exact_quote",
    artifactRefs: [artifactRef],
    sourceRefs: [exactSource],
  });
  const rendered = renderFinalizedChatProjection(createFinalizedChatProjection({
    topic: "belief_change",
    identity,
    evidenceFrame: liveFrame,
    claims: [claim],
  }));

  assert.match(
    rendered.answer,
    /Exact quote: “Henry announced a reviewed enterprise customer deployment\.”/u,
  );
  assert.throws(() => createFinalizedChatClaim({
    identity,
    topic: "belief_change",
    text: "Henry announced an unpersisted deployment.",
    textClass: "exact_quote",
    artifactRefs: [artifactRef],
    sourceRefs: [exactSource],
  }));
  assert.equal(FinalizedChatSourceRefSchema.safeParse({
    ...exactSource,
    sourceRevisionId: null,
  }).success, false);
  assert.equal(FinalizedChatSourceRefSchema.safeParse({
    ...exactSource,
    contentFingerprint: null,
  }).success, false);
});

test("Fact, Assumption, Calculation, and unavailable artifact distinctions remain persisted inference, never quotes", () => {
  const text = "Saved artifact distinctions remain visible without expanding text authority.";
  const claim = createFinalizedChatClaim({
    identity,
    topic: "valuation",
    text,
    textClass: "persisted_inference",
    artifactRefs: [{
      artifactType: "fact",
      artifactId: "fact_artifact",
      fieldPath: "value",
    }, {
      artifactType: "assumption",
      artifactId: "assumption_artifact",
      fieldPath: "value",
    }, {
      artifactType: "calculation",
      artifactId: "calculation_artifact",
      fieldPath: "output",
    }, {
      artifactType: "valuation_evaluation",
      artifactId: "valuation_artifact",
      fieldPath: "status",
    }],
    sourceRefs: [exactSource],
  });
  const rendered = renderFinalizedChatProjection(
    createFinalizedChatProjection({
      topic: "valuation",
      identity,
      evidenceFrame: liveFrame,
      claims: [claim],
    }),
  );

  assert.match(rendered.answer, new RegExp(`Persisted inference: ${text}`));
  assert.doesNotMatch(rendered.answer, new RegExp(`“${text}”`));
  assert.doesNotMatch(rendered.answer, new RegExp(`"${text}"`));
});
