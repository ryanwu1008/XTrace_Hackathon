import { canonicalEvidenceJson } from "../contracts/source-evidence";
import {
  type FinalizedChatClaim,
  type FinalizedChatProjectionV1,
  type FinalizedChatProjectionV2,
  type FinalizedChatSuccessResponse,
  type FinalizedChatSuccessResponseV2,
  FinalizedChatProjectionV1Schema,
  FinalizedChatProjectionV2Schema,
  FinalizedChatSuccessResponseSchema,
  FinalizedChatSuccessResponseV2Schema,
  uniqueFinalizedChatCitationsV2,
  uniqueSourceRefs,
} from "../contracts/finalized-chat";

const TOPIC_LABELS = {
  prior_reason: "Prior decision reason",
  belief_change: "Belief change",
  strongest_counterargument: "Strongest counterargument",
  match_confidence: "Match confidence",
  framework_disagreement: "Framework disagreement",
  valuation: "Valuation",
  missing_evidence: "Missing evidence",
  invested_action: "Invested-company action",
} as const;

const TEXT_CLASS_LABELS = {
  exact_quote: "Exact quote",
  normalized_statement: "Normalized statement",
  persisted_inference: "Persisted inference",
} as const;

function renderClaim(
  claim: FinalizedChatClaim,
  citationIndexByRef: ReadonlyMap<string, number>,
): string {
  const text = claim.textClass === "exact_quote"
    ? `“${claim.text}”`
    : claim.text;
  const citationIndexes = claim.sourceRefs.map((source) =>
    citationIndexByRef.get(canonicalEvidenceJson(source))
  ).filter((value): value is number => value !== undefined);
  const citations = citationIndexes.length > 0
    ? ` ${citationIndexes.map((index) => `[${index}]`).join(" ")}`
    : "";
  return `${TEXT_CLASS_LABELS[claim.textClass]}: ${text}${citations}`;
}

export function renderFinalizedChatProjection(
  raw: FinalizedChatProjectionV1,
): FinalizedChatSuccessResponse {
  const projection = FinalizedChatProjectionV1Schema.parse(raw);
  const citations = uniqueSourceRefs(
    projection.claims.flatMap(({ sourceRefs }) => sourceRefs),
  );
  const citationIndexByRef = new Map(
    citations.map((source, index) => [canonicalEvidenceJson(source), index + 1]),
  );
  const answer = [
    TOPIC_LABELS[projection.topic],
    ...projection.claims.map((claim) =>
      renderClaim(claim, citationIndexByRef)
    ),
  ].join("\n");

  return FinalizedChatSuccessResponseSchema.parse({
    schemaVersion: "finalized-chat-response-v1",
    status: "success",
    topic: projection.topic,
    answer,
    citations,
    identity: projection.identity,
    evidenceFrame: projection.evidenceFrame,
    projection,
    insufficientEvidence: false,
  });
}

const TOPIC_LABELS_V2 = {
  named_lens_selection_reason: "Why this Named Lens appears",
  named_lens_exact_evidence: "Exact evidence used by this Named Lens",
  named_lens_view_change: "What would change this Named Lens view",
  named_lens_formal_weight: "Why formal-decision weight is zero",
} as const;

export function renderFinalizedChatProjectionV2(
  raw: FinalizedChatProjectionV2,
): FinalizedChatSuccessResponseV2 {
  const projection = FinalizedChatProjectionV2Schema.parse(raw);
  const citations = uniqueFinalizedChatCitationsV2(
    projection.claims.flatMap((claim) => [
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
  const answer = [
    `${TOPIC_LABELS_V2[projection.topic]} — ${projection.target.publicDisplayIdentity}`,
    "VSee application of a saved public-source framework; not the named person's opinion on this company and not an endorsement.",
    ...projection.claims.map(({ text }) => text),
  ].join("\n");

  return FinalizedChatSuccessResponseV2Schema.parse({
    schemaVersion: "finalized-chat-response-v2",
    status: "success",
    topic: projection.topic,
    target: projection.target,
    answer,
    citations,
    identity: projection.identity,
    evidenceFrame: projection.evidenceFrame,
    projection,
    insufficientEvidence: false,
  });
}
