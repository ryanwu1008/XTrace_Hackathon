import assert from "node:assert/strict";
import test from "node:test";

import {
  createFinalizedChatClaimV2,
  createFinalizedChatProjectionV2,
  FinalizedChatResponseSchema,
} from "../../lib/contracts/finalized-chat";
import { renderFinalizedChatProjectionV2 } from
  "../../lib/chat/finalized-renderer";

const SHA = (digit: string) => `sha256:${digit.repeat(64)}`;
const identity = {
  workspaceId: "workspace_current",
  reportId: "report_current",
  runId: "run_current",
  dealId: "deal_current",
  candidateRunId: "candidate_alias",
} as const;
const evidenceFrame = { state: "legacy_unbound" } as const;
const presentationIdentity = {
  adapterSchemaVersion: "decision-first-named-lens-v1",
  sourceCandidateRunId: "candidate_current",
  presentationReportId: "report_current",
  presentationSchemaVersion: "decision-first-named-lens-v1",
  presentationFingerprint: SHA("1"),
  criticalEvidenceProjectionFingerprint: SHA("2"),
  finalDispositionsFingerprint: SHA("3"),
} as const;
const target = {
  judgmentId: "judgment_howard_marks",
  frameworkCardId: "framework_advisory:marks:abc",
  componentFrameworkId: "HM-01",
  publicDisplayIdentity: "Howard Marks",
  displayName: "Risk Control Through Market Cycles",
  attributionDisplay: "Howard Marks",
} as const;

test("renders V2 as VSee's persisted application, not a named-person opinion or hidden reasoning", () => {
  const claim = createFinalizedChatClaimV2({
    identity,
    topic: "named_lens_formal_weight",
    target,
    text:
      "The saved advisory contract assigns this Named Lens formal-decision weight 0.",
    textClass: "persisted_artifact_text",
    artifactRefs: [{
      artifactType: "named_lens_passage_segment",
      artifactId: "passage_howard_marks",
      fieldPath: "advisoryContract.formalDecisionWeight",
    }],
    sourceRefs: [],
  });
  const projection = createFinalizedChatProjectionV2({
    topic: "named_lens_formal_weight",
    identity,
    evidenceFrame,
    presentationIdentity,
    target,
    claims: [claim],
  });

  const response = renderFinalizedChatProjectionV2(projection);

  assert.equal(response.schemaVersion, "finalized-chat-response-v2");
  assert.match(
    response.answer,
    /VSee application of a saved public-source framework/u,
  );
  assert.match(response.answer, /formal-decision weight 0/u);
  assert.doesNotMatch(response.answer, /Howard Marks (?:believes|recommends)/iu);
  assert.doesNotMatch(response.answer, /chain of thought|private reasoning/iu);
  assert.deepEqual(response.citations, [{
    kind: "artifact",
    artifactRef: claim.artifactRefs[0],
  }]);
  assert.deepEqual(FinalizedChatResponseSchema.parse(response), response);
});

test("renders saved framework-premise provenance as artifact citations, never Source Revision citations", () => {
  const fieldPaths = [
    "premise.text",
    "premise.componentFrameworkId",
    "premise.componentVersion",
    "premise.cardFieldRef",
    "premise.publicSourceIds",
    "premise.claimIds",
    "premise.locator",
    "premise.attributionScope",
  ] as const;
  const claim = createFinalizedChatClaimV2({
    identity,
    topic: "named_lens_exact_evidence",
    target,
    text: "The saved framework asks whether downside risk is bounded.",
    textClass: "persisted_artifact_text",
    artifactRefs: fieldPaths.map((fieldPath) => ({
      artifactType: "named_lens_passage_segment" as const,
      artifactId: "passage_howard_marks",
      fieldPath,
    })),
    sourceRefs: [],
  });
  const response = renderFinalizedChatProjectionV2(
    createFinalizedChatProjectionV2({
      topic: "named_lens_exact_evidence",
      identity,
      evidenceFrame,
      presentationIdentity,
      target,
      claims: [claim],
    }),
  );

  assert.equal(response.citations.length, fieldPaths.length);
  assert.ok(response.citations.every(({ kind }) => kind === "artifact"));
  assert.ok(response.citations.every((citation) =>
    citation.kind !== "source_revision"
  ));
});
