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

export const FinalizedChatTopicV2Schema = z.enum([
  "named_lens_selection_reason",
  "named_lens_exact_evidence",
  "named_lens_view_change",
  "named_lens_formal_weight",
]);
export type FinalizedChatTopicV2 = z.infer<
  typeof FinalizedChatTopicV2Schema
>;

export const FinalizedChatTextClassV2Schema = z.enum([
  "persisted_artifact_text",
  "framework_application_inference",
]);
export type FinalizedChatTextClassV2 = z.infer<
  typeof FinalizedChatTextClassV2Schema
>;

export const FinalizedChatArtifactTypeV2Schema = z.enum([
  "named_lens_disposition",
  "named_lens_passage_segment",
  "decision_critical_evidence_projection",
  "underwriting_presentation",
  "evidence_pack_fact",
  "evidence_pack_assumption",
]);
export type FinalizedChatArtifactTypeV2 = z.infer<
  typeof FinalizedChatArtifactTypeV2Schema
>;

const V2_ARTIFACT_FIELD_PATHS: Readonly<
  Record<FinalizedChatArtifactTypeV2, RegExp>
> = {
  named_lens_disposition:
    /^(?:disposition|reasonCodes|priorityTier|selectedPosition|selectionBasisEvidenceIds)$/u,
  named_lens_passage_segment:
    /^(?:premise\.(?:text|componentFrameworkId|componentVersion|cardFieldRef|publicSourceIds|claimIds|locator|attributionScope)|caseApplication\.(?:text|evidenceItemIds)|countercase\.(?:text|evidenceItemIds|evidenceRequestRefs)|unknownBoundary\.(?:text|judgmentUnknownRefs|judgmentLimitationRefs|evidenceRequestRefs)|conditionalConclusion\.text|advisoryContract\.formalDecisionWeight|selectionBasisEvidenceIds)$/u,
  decision_critical_evidence_projection:
    /^evidenceRefs(?:\[\d+\](?:\.(?:evidencePackItemId|classification|originRefs|reasonCodes|resolutionPath))?)?$/u,
  underwriting_presentation:
    /^(?:synthesis(?:\.text)?|segmentCitations|firstScreenProjectionRefs)$/u,
  evidence_pack_fact: /^value$/u,
  evidence_pack_assumption: /^value$/u,
};

export const FinalizedChatArtifactRefV2Schema = z.strictObject({
  artifactType: FinalizedChatArtifactTypeV2Schema,
  artifactId: IdSchema,
  fieldPath: FieldPathSchema,
}).superRefine((ref, context) => {
  if (!V2_ARTIFACT_FIELD_PATHS[ref.artifactType].test(ref.fieldPath)) {
    context.addIssue({
      code: "custom",
      path: ["fieldPath"],
      message:
        "Finalized Chat V2 references only reviewed persisted presentation fields",
    });
  }
});
export type FinalizedChatArtifactRefV2 = z.infer<
  typeof FinalizedChatArtifactRefV2Schema
>;

export const FinalizedChatNamedLensTargetSchema = z.strictObject({
  judgmentId: IdSchema,
  frameworkCardId: IdSchema,
  componentFrameworkId: IdSchema,
  publicDisplayIdentity: NonEmptyTextSchema,
  displayName: NonEmptyTextSchema,
  attributionDisplay: NonEmptyTextSchema,
});
export type FinalizedChatNamedLensTarget = z.infer<
  typeof FinalizedChatNamedLensTargetSchema
>;

export const FinalizedChatPresentationIdentityV2Schema = z.strictObject({
  adapterSchemaVersion: z.literal("decision-first-named-lens-v1"),
  sourceCandidateRunId: IdSchema,
  presentationReportId: IdSchema,
  presentationSchemaVersion: z.literal("decision-first-named-lens-v1"),
  presentationFingerprint: FingerprintSchema,
  criticalEvidenceProjectionFingerprint: FingerprintSchema,
  finalDispositionsFingerprint: FingerprintSchema,
});
export type FinalizedChatPresentationIdentityV2 = z.infer<
  typeof FinalizedChatPresentationIdentityV2Schema
>;

export const FinalizedChatClaimV2Schema = z.strictObject({
  claimId: z.string().regex(/^finalized_chat_v2_claim_[0-9a-f]{64}$/u),
  claimFingerprint: FingerprintSchema,
  text: NonEmptyTextSchema,
  textClass: FinalizedChatTextClassV2Schema,
  target: FinalizedChatNamedLensTargetSchema,
  artifactRefs: z.array(FinalizedChatArtifactRefV2Schema).min(1),
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
  const escapedIdentity = claim.target.publicDisplayIdentity.replace(
    /[.*+?^${}()|[\]\\]/gu,
    "\\$&",
  );
  if (
    new RegExp(`${escapedIdentity}[^.\\n]*(?:believes|recommends|would invest)`, "iu")
      .test(claim.text)
    || /\b(?:I would invest|hidden chain of thought|private reasoning)\b/iu
      .test(claim.text)
  ) {
    context.addIssue({
      code: "custom",
      path: ["text"],
      message:
        "Named Lens text cannot impersonate a person or claim hidden reasoning",
    });
  }
});
export type FinalizedChatClaimV2 = z.infer<
  typeof FinalizedChatClaimV2Schema
>;

export const FinalizedChatClaimIdentityInputV2Schema = z.strictObject({
  identity: FinalizedChatIdentitySchema,
  topic: FinalizedChatTopicV2Schema,
  target: FinalizedChatNamedLensTargetSchema,
  artifactRefs: z.array(FinalizedChatArtifactRefV2Schema).min(1),
  sourceRefs: z.array(FinalizedChatSourceRefSchema),
  textClass: FinalizedChatTextClassV2Schema,
  text: NonEmptyTextSchema,
});
export type FinalizedChatClaimIdentityInputV2 = z.infer<
  typeof FinalizedChatClaimIdentityInputV2Schema
>;

function sortedArtifactRefsV2(
  refs: readonly FinalizedChatArtifactRefV2[],
): FinalizedChatArtifactRefV2[] {
  return [...refs].sort((left, right) =>
    compareUtf8(canonicalEvidenceJson(left), canonicalEvidenceJson(right))
  );
}

export function buildFinalizedChatClaimIdentityV2(
  raw: FinalizedChatClaimIdentityInputV2,
): { claimId: string; claimFingerprint: string } {
  const input = FinalizedChatClaimIdentityInputV2Schema.parse(raw);
  const claimFingerprint = sha256({
    schemaVersion: "finalized-chat-claim-v2",
    identity: input.identity,
    topic: input.topic,
    target: input.target,
    artifactRefs: sortedArtifactRefsV2(input.artifactRefs),
    sourceRefs: uniqueSourceRefs(input.sourceRefs),
    textClass: input.textClass,
    text: input.text,
  });
  return {
    claimId:
      `finalized_chat_v2_claim_${claimFingerprint.slice("sha256:".length)}`,
    claimFingerprint,
  };
}

export function createFinalizedChatClaimV2(
  raw: FinalizedChatClaimIdentityInputV2,
): FinalizedChatClaimV2 {
  return FinalizedChatClaimV2Schema.parse({
    ...buildFinalizedChatClaimIdentityV2(raw),
    text: raw.text,
    textClass: raw.textClass,
    target: raw.target,
    artifactRefs: raw.artifactRefs,
    sourceRefs: raw.sourceRefs,
  });
}

const FinalizedChatProjectionV2BaseSchema = z.strictObject({
  schemaVersion: z.literal("finalized-chat-projection-v2"),
  projectionFingerprint: FingerprintSchema,
  topic: FinalizedChatTopicV2Schema,
  identity: FinalizedChatIdentitySchema,
  evidenceFrame: FinalizedChatEvidenceFrameSchema,
  presentationIdentity: FinalizedChatPresentationIdentityV2Schema,
  target: FinalizedChatNamedLensTargetSchema,
  claims: z.array(FinalizedChatClaimV2Schema).min(1),
});

export const FinalizedChatProjectionV2Schema =
  FinalizedChatProjectionV2BaseSchema.superRefine((projection, context) => {
    if (
      projection.presentationIdentity.presentationReportId
        !== projection.identity.reportId
    ) {
      context.addIssue({
        code: "custom",
        path: ["presentationIdentity", "presentationReportId"],
        message: "Finalized Chat V2 presentation must belong to the requested Report",
      });
    }
    const claimIds = projection.claims.map(({ claimId }) => claimId);
    if (new Set(claimIds).size !== claimIds.length) {
      context.addIssue({ code: "custom", message: "Claim IDs must be unique" });
    }
    for (const [index, claim] of projection.claims.entries()) {
      const expected = buildFinalizedChatClaimIdentityV2({
        identity: projection.identity,
        topic: projection.topic,
        target: projection.target,
        artifactRefs: claim.artifactRefs,
        sourceRefs: claim.sourceRefs,
        textClass: claim.textClass,
        text: claim.text,
      });
      if (
        canonicalEvidenceJson(claim.target)
          !== canonicalEvidenceJson(projection.target)
        || claim.claimId !== expected.claimId
        || claim.claimFingerprint !== expected.claimFingerprint
      ) {
        context.addIssue({
          code: "custom",
          path: ["claims", index, "claimId"],
          message: "V2 claim identity must match its persisted projection inputs",
        });
      }
    }
    const expectedFingerprint = buildFinalizedChatProjectionV2Fingerprint({
      topic: projection.topic,
      identity: projection.identity,
      evidenceFrame: projection.evidenceFrame,
      presentationIdentity: projection.presentationIdentity,
      target: projection.target,
      claims: projection.claims,
    });
    if (projection.projectionFingerprint !== expectedFingerprint) {
      context.addIssue({
        code: "custom",
        path: ["projectionFingerprint"],
        message: "V2 projection fingerprint does not match its finalized content",
      });
    }
  });
export type FinalizedChatProjectionV2 = z.infer<
  typeof FinalizedChatProjectionV2Schema
>;

export function buildFinalizedChatProjectionV2Fingerprint(raw: {
  topic: FinalizedChatTopicV2;
  identity: FinalizedChatIdentity;
  evidenceFrame: FinalizedChatEvidenceFrame;
  presentationIdentity: FinalizedChatPresentationIdentityV2;
  target: FinalizedChatNamedLensTarget;
  claims: FinalizedChatClaimV2[];
}): string {
  return sha256({
    schemaVersion: "finalized-chat-projection-v2",
    topic: raw.topic,
    identity: raw.identity,
    evidenceFrame: raw.evidenceFrame,
    presentationIdentity: raw.presentationIdentity,
    target: raw.target,
    claims: raw.claims,
  });
}

export function createFinalizedChatProjectionV2(raw: {
  topic: FinalizedChatTopicV2;
  identity: FinalizedChatIdentity;
  evidenceFrame: FinalizedChatEvidenceFrame;
  presentationIdentity: FinalizedChatPresentationIdentityV2;
  target: FinalizedChatNamedLensTarget;
  claims: FinalizedChatClaimV2[];
}): FinalizedChatProjectionV2 {
  return FinalizedChatProjectionV2Schema.parse({
    schemaVersion: "finalized-chat-projection-v2",
    projectionFingerprint: buildFinalizedChatProjectionV2Fingerprint(raw),
    ...raw,
  });
}

export const FinalizedChatProjectionSchema = z.union([
  FinalizedChatProjectionV1Schema,
  FinalizedChatProjectionV2Schema,
]);
export type FinalizedChatProjection = z.infer<
  typeof FinalizedChatProjectionSchema
>;

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

export const FinalizedChatCitationV2Schema = z.union([
  z.strictObject({
    kind: z.literal("source_revision"),
    sourceRef: FinalizedChatSourceRefSchema,
  }),
  z.strictObject({
    kind: z.literal("artifact"),
    artifactRef: FinalizedChatArtifactRefV2Schema,
  }),
]);
export type FinalizedChatCitationV2 = z.infer<
  typeof FinalizedChatCitationV2Schema
>;

export const FinalizedChatInsufficientReasonCodeV2Schema = z.enum([
  "unsupported_topic",
  "ambiguous_topic",
  "lens_target_missing",
  "lens_target_ambiguous",
  "lens_artifact_unavailable",
  "presentation_integrity",
  "source_lineage_incomplete",
]);
export type FinalizedChatInsufficientReasonCodeV2 = z.infer<
  typeof FinalizedChatInsufficientReasonCodeV2Schema
>;

export const FinalizedChatProjectionSuccessV2Schema = z.strictObject({
  status: z.literal("success"),
  projection: FinalizedChatProjectionV2Schema,
});

export const FinalizedChatProjectionInsufficientV2Schema = z.strictObject({
  status: z.literal("insufficient"),
  topic: FinalizedChatTopicV2Schema.nullable(),
  requestedLensDisplayIdentity: NonEmptyTextSchema.nullable(),
  reasonCode: FinalizedChatInsufficientReasonCodeV2Schema,
  missingArtifactRefs: z.array(FinalizedChatArtifactRefV2Schema),
  identity: FinalizedChatIdentitySchema,
  evidenceFrame: FinalizedChatEvidenceFrameSchema,
});

export const FinalizedChatProjectionBuildResultV2Schema = z.union([
  FinalizedChatProjectionSuccessV2Schema,
  FinalizedChatProjectionInsufficientV2Schema,
]);
export type FinalizedChatProjectionBuildResultV2 = z.infer<
  typeof FinalizedChatProjectionBuildResultV2Schema
>;

export function uniqueFinalizedChatCitationsV2(
  refs: readonly FinalizedChatCitationV2[],
): FinalizedChatCitationV2[] {
  const byIdentity = new Map<string, FinalizedChatCitationV2>();
  for (const ref of refs) {
    const parsed = FinalizedChatCitationV2Schema.parse(ref);
    byIdentity.set(canonicalEvidenceJson(parsed), parsed);
  }
  return [...byIdentity.values()];
}

export const FinalizedChatSuccessResponseV2Schema = z.strictObject({
  schemaVersion: z.literal("finalized-chat-response-v2"),
  status: z.literal("success"),
  topic: FinalizedChatTopicV2Schema,
  target: FinalizedChatNamedLensTargetSchema,
  answer: NonEmptyTextSchema,
  citations: z.array(FinalizedChatCitationV2Schema),
  identity: FinalizedChatIdentitySchema,
  evidenceFrame: FinalizedChatEvidenceFrameSchema,
  projection: FinalizedChatProjectionV2Schema,
  insufficientEvidence: z.literal(false),
}).superRefine((response, context) => {
  if (
    response.topic !== response.projection.topic
    || canonicalEvidenceJson(response.target)
      !== canonicalEvidenceJson(response.projection.target)
    || canonicalEvidenceJson(response.identity)
      !== canonicalEvidenceJson(response.projection.identity)
    || canonicalEvidenceJson(response.evidenceFrame)
      !== canonicalEvidenceJson(response.projection.evidenceFrame)
  ) {
    context.addIssue({
      code: "custom",
      message: "Rendered V2 response scope must equal its persisted projection scope",
    });
  }
  const expected = uniqueFinalizedChatCitationsV2(
    response.projection.claims.flatMap((claim) => [
      ...claim.sourceRefs.map((sourceRef) => ({
        kind: "source_revision" as const,
        sourceRef,
      })),
      ...claim.artifactRefs.map((artifactRef) => ({
        kind: "artifact" as const,
        artifactRef,
      })),
    ]),
  );
  if (canonicalEvidenceJson(response.citations) !== canonicalEvidenceJson(expected)) {
    context.addIssue({
      code: "custom",
      path: ["citations"],
      message: "Rendered V2 citations must exactly equal projection references",
    });
  }
});
export type FinalizedChatSuccessResponseV2 = z.infer<
  typeof FinalizedChatSuccessResponseV2Schema
>;

export const FinalizedChatInsufficientResponseV2Schema = z.strictObject({
  schemaVersion: z.literal("finalized-chat-response-v2"),
  status: z.literal("insufficient"),
  topic: FinalizedChatTopicV2Schema.nullable(),
  requestedLensDisplayIdentity: NonEmptyTextSchema.nullable(),
  answer: NonEmptyTextSchema,
  citations: z.tuple([]),
  identity: FinalizedChatIdentitySchema,
  evidenceFrame: FinalizedChatEvidenceFrameSchema,
  insufficientEvidence: z.literal(true),
  reasonCode: FinalizedChatInsufficientReasonCodeV2Schema,
  missingArtifactRefs: z.array(FinalizedChatArtifactRefV2Schema),
});
export type FinalizedChatInsufficientResponseV2 = z.infer<
  typeof FinalizedChatInsufficientResponseV2Schema
>;

export const FinalizedChatResponseV2Schema = z.union([
  FinalizedChatSuccessResponseV2Schema,
  FinalizedChatInsufficientResponseV2Schema,
]);
export type FinalizedChatResponseV2 = z.infer<
  typeof FinalizedChatResponseV2Schema
>;

export const FinalizedChatResponseSchema = z.union([
  FinalizedChatSuccessResponseSchema,
  FinalizedChatInsufficientResponseSchema,
  FinalizedChatSuccessResponseV2Schema,
  FinalizedChatInsufficientResponseV2Schema,
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
