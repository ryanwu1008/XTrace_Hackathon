import { createHash } from "node:crypto";

import { z } from "zod";

import {
  WritableSourceRefV2Schema,
  canonicalEvidenceJson,
} from "./source-evidence";
import { compareUtf8 } from "../format/canonical-order";

const IdSchema = z.string().min(1).refine(
  (value) => value.trim() === value,
  "IDs cannot have surrounding whitespace",
);
const NonEmptyTextSchema = z.string().min(1).refine(
  (value) => value.trim() === value && value.trim().length > 0,
  "Text cannot be blank or have surrounding whitespace",
);
const FingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const FieldPathSchema = z.string().regex(
  /^[A-Za-z_$][A-Za-z0-9_$]*(?:(?:\.[A-Za-z_$][A-Za-z0-9_$]*)|(?:\[\d+\]))*$/u,
  "Artifact field paths must be exact dot/index paths",
);

export const FinalizedChatTopicSchema = z.enum([
  "prior_reason",
  "belief_change",
  "strongest_counterargument",
  "match_confidence",
  "framework_disagreement",
  "valuation",
  "missing_evidence",
  "invested_action",
]);
export type FinalizedChatTopic = z.infer<typeof FinalizedChatTopicSchema>;

export const FinalizedChatTextClassSchema = z.enum([
  "exact_quote",
  "normalized_statement",
  "persisted_inference",
]);
export type FinalizedChatTextClass = z.infer<
  typeof FinalizedChatTextClassSchema
>;

export const FinalizedChatArtifactTypeSchema = z.enum([
  "company_analysis",
  "investment_memory",
  "sample_decision_record",
  "market_event",
  "belief_assessment",
  "match_assessment",
  "evidence_pack",
  "fact",
  "assumption",
  "calculation",
  "framework_judgment",
  "framework_disagreement",
  "scenario_model",
  "valuation_evaluation",
  "decision_result",
  "missing_evidence",
  "action_policy",
  "action_draft",
]);
export type FinalizedChatArtifactType = z.infer<
  typeof FinalizedChatArtifactTypeSchema
>;

export const FinalizedChatArtifactRefSchema = z.strictObject({
  artifactType: FinalizedChatArtifactTypeSchema,
  artifactId: IdSchema,
  fieldPath: FieldPathSchema,
});
export type FinalizedChatArtifactRef = z.infer<
  typeof FinalizedChatArtifactRefSchema
>;

const VerifiedExactSourceTextSchema = z.strictObject({
  status: z.literal("verified_exact"),
  verbatimExcerpt: NonEmptyTextSchema.refine(
    (value) => value.split(/\s+/u).length <= 25,
    "Exact excerpts cannot exceed 25 words",
  ),
  normalizedStatement: NonEmptyTextSchema.optional(),
}).superRefine((text, context) => {
  if (text.normalizedStatement === text.verbatimExcerpt) {
    context.addIssue({
      code: "custom",
      message: "Normalized text must remain distinct from verbatim text",
    });
  }
});

const NormalizedSourceTextSchema = z.strictObject({
  status: z.literal("normalized_only"),
  normalizedStatement: NonEmptyTextSchema,
});

export const FinalizedChatSourceRefSchema = z.strictObject({
  sourceId: IdSchema,
  documentId: IdSchema.nullable(),
  sourceRevisionId: IdSchema,
  contentFingerprint: FingerprintSchema,
  canonicalSource: WritableSourceRefV2Schema,
  text: z.union([
    VerifiedExactSourceTextSchema,
    NormalizedSourceTextSchema,
  ]),
}).superRefine((source, context) => {
  if (
    source.canonicalSource.id !== source.sourceId
    || source.canonicalSource.documentId !== source.documentId
    || source.canonicalSource.sourceRevisionId !== source.sourceRevisionId
    || source.canonicalSource.contentFingerprint !== source.contentFingerprint
    || canonicalEvidenceJson(source.canonicalSource.text)
      !== canonicalEvidenceJson(source.text)
  ) {
    context.addIssue({
      code: "custom",
      message: "Finalized Chat source tuple must equal its canonical source",
    });
  }
});
export type FinalizedChatSourceRef = z.infer<
  typeof FinalizedChatSourceRefSchema
>;

export const FinalizedChatIdentitySchema = z.strictObject({
  workspaceId: IdSchema,
  reportId: IdSchema,
  runId: IdSchema,
  dealId: IdSchema,
  candidateRunId: IdSchema,
});
export type FinalizedChatIdentity = z.infer<
  typeof FinalizedChatIdentitySchema
>;

const CurrentLiveFinalizedChatEvidenceFrameSchema = z.strictObject({
  state: z.literal("current"),
  evidenceMode: z.literal("live"),
  contextFingerprint: FingerprintSchema,
  eventSetFingerprint: FingerprintSchema,
  bindingFingerprint: FingerprintSchema,
  snapshotId: z.null(),
  snapshotFingerprint: z.null(),
});

const CurrentPinnedFinalizedChatEvidenceFrameSchema = z.strictObject({
  state: z.literal("current"),
  evidenceMode: z.literal("pinned"),
  contextFingerprint: FingerprintSchema,
  eventSetFingerprint: FingerprintSchema,
  bindingFingerprint: FingerprintSchema,
  snapshotId: IdSchema,
  snapshotFingerprint: FingerprintSchema,
});

const LegacyFinalizedChatEvidenceFrameSchema = z.strictObject({
  state: z.literal("legacy_unbound"),
});

export const FinalizedChatEvidenceFrameSchema = z.union([
  LegacyFinalizedChatEvidenceFrameSchema,
  CurrentLiveFinalizedChatEvidenceFrameSchema,
  CurrentPinnedFinalizedChatEvidenceFrameSchema,
]);
export type FinalizedChatEvidenceFrame = z.infer<
  typeof FinalizedChatEvidenceFrameSchema
>;

export const FinalizedChatClaimSchema = z.strictObject({
  claimId: z.string().regex(/^finalized_chat_claim_[0-9a-f]{64}$/u),
  claimFingerprint: FingerprintSchema,
  text: NonEmptyTextSchema,
  textClass: FinalizedChatTextClassSchema,
  artifactRefs: z.array(FinalizedChatArtifactRefSchema).min(1),
  sourceRefs: z.array(FinalizedChatSourceRefSchema),
}).superRefine((claim, context) => {
  const artifactKeys = claim.artifactRefs.map(canonicalEvidenceJson);
  if (new Set(artifactKeys).size !== artifactKeys.length) {
    context.addIssue({ code: "custom", message: "Artifact refs must be unique" });
  }
  const sourceKeys = claim.sourceRefs.map(canonicalEvidenceJson);
  if (new Set(sourceKeys).size !== sourceKeys.length) {
    context.addIssue({ code: "custom", message: "Source refs must be unique" });
  }
  const sourceIds = claim.sourceRefs.map(({ sourceId }) => sourceId);
  if (new Set(sourceIds).size !== sourceIds.length) {
    context.addIssue({
      code: "custom",
      message: "A source ID can resolve to only one exact revision",
    });
  }
  if (claim.textClass === "exact_quote") {
    const exactMatch = claim.sourceRefs.some((source) =>
      source.text.status === "verified_exact"
      && source.text.verbatimExcerpt === claim.text
    );
    if (!exactMatch) {
      context.addIssue({
        code: "custom",
        message: "Exact quotes require verbatim equality to an exact source revision",
      });
    }
  }
  if (claim.textClass === "normalized_statement") {
    const normalizedMatch = claim.sourceRefs.some((source) =>
      source.text.normalizedStatement === claim.text
    );
    if (!normalizedMatch) {
      context.addIssue({
        code: "custom",
        message: "Normalized statements require equality to saved normalized text",
      });
    }
  }
});
export type FinalizedChatClaim = z.infer<typeof FinalizedChatClaimSchema>;

export const FinalizedChatClaimIdentityInputSchema = z.strictObject({
  identity: FinalizedChatIdentitySchema,
  topic: FinalizedChatTopicSchema,
  artifactRefs: z.array(FinalizedChatArtifactRefSchema).min(1),
  textClass: FinalizedChatTextClassSchema,
  text: NonEmptyTextSchema,
});
export type FinalizedChatClaimIdentityInput = z.infer<
  typeof FinalizedChatClaimIdentityInputSchema
>;

function sortedArtifactRefs(
  refs: readonly FinalizedChatArtifactRef[],
): FinalizedChatArtifactRef[] {
  return [...refs].sort((left, right) =>
    compareUtf8(canonicalEvidenceJson(left), canonicalEvidenceJson(right))
  );
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(canonicalEvidenceJson(value), "utf8")
    .digest("hex")}`;
}

export function buildFinalizedChatClaimIdentity(
  raw: FinalizedChatClaimIdentityInput,
): { claimId: string; claimFingerprint: string } {
  const input = FinalizedChatClaimIdentityInputSchema.parse(raw);
  const claimFingerprint = sha256({
    identity: input.identity,
    topic: input.topic,
    artifactRefs: sortedArtifactRefs(input.artifactRefs),
    textClass: input.textClass,
    text: input.text,
  });
  return {
    claimId: `finalized_chat_claim_${claimFingerprint.slice("sha256:".length)}`,
    claimFingerprint,
  };
}

export function createFinalizedChatClaimId(
  input: FinalizedChatClaimIdentityInput,
): string {
  return buildFinalizedChatClaimIdentity(input).claimId;
}

export function createFinalizedChatClaimFingerprint(
  input: FinalizedChatClaimIdentityInput,
): string {
  return buildFinalizedChatClaimIdentity(input).claimFingerprint;
}

export function createFinalizedChatClaim(raw: {
  identity: FinalizedChatIdentity;
  topic: FinalizedChatTopic;
  text: string;
  textClass: FinalizedChatTextClass;
  artifactRefs: FinalizedChatArtifactRef[];
  sourceRefs: FinalizedChatSourceRef[];
}): FinalizedChatClaim {
  const stable = buildFinalizedChatClaimIdentity({
    identity: raw.identity,
    topic: raw.topic,
    artifactRefs: raw.artifactRefs,
    textClass: raw.textClass,
    text: raw.text,
  });
  return FinalizedChatClaimSchema.parse({
    ...stable,
    text: raw.text,
    textClass: raw.textClass,
    artifactRefs: raw.artifactRefs,
    sourceRefs: raw.sourceRefs,
  });
}

const FinalizedChatProjectionV1BaseSchema = z.strictObject({
  schemaVersion: z.literal("finalized-chat-projection-v1"),
  projectionFingerprint: FingerprintSchema,
  topic: FinalizedChatTopicSchema,
  identity: FinalizedChatIdentitySchema,
  evidenceFrame: FinalizedChatEvidenceFrameSchema,
  claims: z.array(FinalizedChatClaimSchema).min(1),
});

export const FinalizedChatProjectionV1Schema =
  FinalizedChatProjectionV1BaseSchema.superRefine((projection, context) => {
    const claimIds = projection.claims.map(({ claimId }) => claimId);
    if (new Set(claimIds).size !== claimIds.length) {
      context.addIssue({ code: "custom", message: "Claim IDs must be unique" });
    }
    for (const [index, claim] of projection.claims.entries()) {
      const expected = buildFinalizedChatClaimIdentity({
        identity: projection.identity,
        topic: projection.topic,
        artifactRefs: claim.artifactRefs,
        textClass: claim.textClass,
        text: claim.text,
      });
      if (
        claim.claimId !== expected.claimId
        || claim.claimFingerprint !== expected.claimFingerprint
      ) {
        context.addIssue({
          code: "custom",
          path: ["claims", index, "claimId"],
          message: "Claim identity does not match its finalized projection inputs",
        });
      }
    }
    const expectedFingerprint = buildFinalizedChatProjectionFingerprint({
      topic: projection.topic,
      identity: projection.identity,
      evidenceFrame: projection.evidenceFrame,
      claims: projection.claims,
    });
    if (projection.projectionFingerprint !== expectedFingerprint) {
      context.addIssue({
        code: "custom",
        path: ["projectionFingerprint"],
        message: "Projection fingerprint does not match its finalized content",
      });
    }
  });
export type FinalizedChatProjectionV1 = z.infer<
  typeof FinalizedChatProjectionV1Schema
>;
export const FinalizedChatProjectionSchema = FinalizedChatProjectionV1Schema;
export type FinalizedChatProjection = FinalizedChatProjectionV1;

export function buildFinalizedChatProjectionFingerprint(raw: {
  topic: FinalizedChatTopic;
  identity: FinalizedChatIdentity;
  evidenceFrame: FinalizedChatEvidenceFrame;
  claims: FinalizedChatClaim[];
}): string {
  return sha256({
    schemaVersion: "finalized-chat-projection-v1",
    topic: raw.topic,
    identity: raw.identity,
    evidenceFrame: raw.evidenceFrame,
    claims: raw.claims,
  });
}

export function createFinalizedChatProjection(raw: {
  topic: FinalizedChatTopic;
  identity: FinalizedChatIdentity;
  evidenceFrame: FinalizedChatEvidenceFrame;
  claims: FinalizedChatClaim[];
}): FinalizedChatProjectionV1 {
  return FinalizedChatProjectionV1Schema.parse({
    schemaVersion: "finalized-chat-projection-v1",
    projectionFingerprint: buildFinalizedChatProjectionFingerprint(raw),
    ...raw,
  });
}

export const FinalizedChatInsufficientReasonCodeSchema = z.enum([
  "unsupported_topic",
  "ambiguous_topic",
  "scope_unavailable",
  "scope_mismatch",
  "artifact_missing",
  "artifact_mismatch",
  "source_missing",
  "source_mismatch",
  "fixture_forbidden",
  "demo_fixture_forbidden",
  "scope_identity_mismatch",
  "source_lineage_incomplete",
  "finalized_artifact_missing",
  "not_invested",
  "finalized_evidence_unavailable",
]);
export type FinalizedChatInsufficientReasonCode = z.infer<
  typeof FinalizedChatInsufficientReasonCodeSchema
>;

export const FinalizedChatProjectionSuccessSchema = z.strictObject({
  status: z.literal("success"),
  projection: FinalizedChatProjectionV1Schema,
});

function validateOptionalScopeFrame(
  value: {
    identity: FinalizedChatIdentity | null;
    evidenceFrame: FinalizedChatEvidenceFrame | null;
  },
  context: z.RefinementCtx,
): void {
  if ((value.identity === null) !== (value.evidenceFrame === null)) {
    context.addIssue({
      code: "custom",
      message: "Finalized identity and evidence frame must be present together",
    });
  }
}

export const FinalizedChatProjectionInsufficientSchema = z.strictObject({
  status: z.literal("insufficient"),
  topic: FinalizedChatTopicSchema.nullable(),
  reasonCode: FinalizedChatInsufficientReasonCodeSchema,
  missingArtifactRefs: z.array(FinalizedChatArtifactRefSchema),
  identity: FinalizedChatIdentitySchema.nullable(),
  evidenceFrame: FinalizedChatEvidenceFrameSchema.nullable(),
}).superRefine(validateOptionalScopeFrame);

export const FinalizedChatProjectionBuildResultSchema = z.union([
  FinalizedChatProjectionSuccessSchema,
  FinalizedChatProjectionInsufficientSchema,
]);
export type FinalizedChatProjectionBuildResult = z.infer<
  typeof FinalizedChatProjectionBuildResultSchema
>;

export const FinalizedChatSuccessResponseSchema = z.strictObject({
  schemaVersion: z.literal("finalized-chat-response-v1"),
  status: z.literal("success"),
  topic: FinalizedChatTopicSchema,
  answer: NonEmptyTextSchema,
  citations: z.array(FinalizedChatSourceRefSchema),
  identity: FinalizedChatIdentitySchema,
  evidenceFrame: FinalizedChatEvidenceFrameSchema,
  projection: FinalizedChatProjectionV1Schema,
  insufficientEvidence: z.literal(false),
}).superRefine((response, context) => {
  if (
    response.topic !== response.projection.topic
    || canonicalEvidenceJson(response.identity)
      !== canonicalEvidenceJson(response.projection.identity)
    || canonicalEvidenceJson(response.evidenceFrame)
      !== canonicalEvidenceJson(response.projection.evidenceFrame)
  ) {
    context.addIssue({
      code: "custom",
      message: "Rendered response scope must equal the finalized projection scope",
    });
  }
  const expected = uniqueSourceRefs(
    response.projection.claims.flatMap(({ sourceRefs }) => sourceRefs),
  );
  if (
    canonicalEvidenceJson(response.citations)
    !== canonicalEvidenceJson(expected)
  ) {
    context.addIssue({
      code: "custom",
      path: ["citations"],
      message: "Rendered citations must exactly equal projection source revisions",
    });
  }
});
export type FinalizedChatSuccessResponse = z.infer<
  typeof FinalizedChatSuccessResponseSchema
>;

export const FinalizedChatInsufficientResponseSchema = z.strictObject({
  schemaVersion: z.literal("finalized-chat-response-v1"),
  status: z.literal("insufficient"),
  topic: FinalizedChatTopicSchema.nullable(),
  answer: NonEmptyTextSchema,
  citations: z.tuple([]),
  identity: FinalizedChatIdentitySchema.nullable(),
  evidenceFrame: FinalizedChatEvidenceFrameSchema.nullable(),
  insufficientEvidence: z.literal(true),
  reasonCode: FinalizedChatInsufficientReasonCodeSchema,
  missingArtifactRefs: z.array(FinalizedChatArtifactRefSchema),
}).superRefine(validateOptionalScopeFrame);
export type FinalizedChatInsufficientResponse = z.infer<
  typeof FinalizedChatInsufficientResponseSchema
>;

export const FinalizedChatResponseSchema = z.union([
  FinalizedChatSuccessResponseSchema,
  FinalizedChatInsufficientResponseSchema,
]);
export type FinalizedChatResponse = z.infer<typeof FinalizedChatResponseSchema>;

export function uniqueSourceRefs(
  refs: readonly FinalizedChatSourceRef[],
): FinalizedChatSourceRef[] {
  const byIdentity = new Map<string, FinalizedChatSourceRef>();
  for (const ref of refs) {
    const parsed = FinalizedChatSourceRefSchema.parse(ref);
    const key = canonicalEvidenceJson(parsed);
    byIdentity.set(key, parsed);
  }
  return [...byIdentity.values()];
}
