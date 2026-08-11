import type { CandidateArtifactBundle } from "../../db/repositories/underwriting-artifacts";
import {
  type BeliefAction,
  type CompanyAnalysis,
  type EvidenceSourceRef,
} from "../contracts/domain";
import type { Fact } from "../contracts/evidence";
import {
  type ActionDraftV2,
  type FrameworkJudgment,
} from "../contracts/underwriting";
import {
  FinalizedChatProjectionBuildResultSchema,
  FinalizedChatProjectionBuildResultV2Schema,
  FinalizedChatProjectionV1Schema,
  FinalizedChatNamedLensTargetSchema,
  FinalizedChatSourceRefSchema,
  createFinalizedChatClaim,
  createFinalizedChatClaimV2,
  createFinalizedChatProjection,
  createFinalizedChatProjectionV2,
  type FinalizedChatArtifactRef,
  type FinalizedChatEvidenceFrame,
  type FinalizedChatIdentity,
  type FinalizedChatInsufficientReasonCode,
  type FinalizedChatProjectionBuildResult,
  type FinalizedChatProjectionBuildResultV2,
  type FinalizedChatNamedLensTarget,
  type FinalizedChatPresentationIdentityV2,
  type FinalizedChatSourceRef,
  type FinalizedChatTextClass,
  type FinalizedChatTopic,
  type FinalizedChatTopicV2,
} from "../contracts/finalized-chat";
import {
  DecisionCriticalEvidenceProjectionSchema,
  NamedLensFinalizationDispositionSchema,
  NamedLensPassageSchema,
  NamedLensPresentationSchema,
  type DecisionCriticalEvidenceProjection,
  type NamedLensFinalizationDisposition,
  type NamedLensPassage,
  type NamedLensPresentation,
} from "../contracts/named-lens";
import {
  actionsForDealStatusAndDirection,
  beliefActionListsEqual,
} from "../reports/action-policy";
import { renderSampleDecisionStatement } from "../belief-reversal/sample-decision-source";

export type FinalizedChatRequestMode = "product" | "public_sandbox";

export interface FinalizedChatCandidateBinding {
  candidateRunId: string;
  rerunOfId: string | null;
  artifactSourceCandidateRunId?: string | null;
  candidateAnalysisFingerprint: string;
}

export interface BuildFinalizedChatProjectionInput {
  topic: FinalizedChatTopic;
  requestMode: FinalizedChatRequestMode;
  identity: FinalizedChatIdentity;
  evidenceFrame: FinalizedChatEvidenceFrame;
  analysis: CompanyAnalysis;
  candidateBinding: FinalizedChatCandidateBinding;
  bundle?: CandidateArtifactBundle | null;
}

class ProjectionFailure extends Error {
  constructor(
    readonly reasonCode: FinalizedChatInsufficientReasonCode,
    readonly refs: FinalizedChatArtifactRef[],
  ) {
    super(reasonCode);
  }
}

interface ProjectionContext extends BuildFinalizedChatProjectionInput {
  bundle: CandidateArtifactBundle | null;
  sourceById: Map<string, EvidenceSourceRef>;
}

interface ClaimInput {
  text: string;
  textClass: FinalizedChatTextClass;
  artifactRefs: FinalizedChatArtifactRef[];
  sourceRefs?: FinalizedChatSourceRef[];
}

export function buildFinalizedChatProjection(
  input: BuildFinalizedChatProjectionInput,
): FinalizedChatProjectionBuildResult {
  const bundle = input.bundle ?? null;
  const context: ProjectionContext = {
    ...input,
    bundle,
    sourceById: new Map(input.analysis.sources.map((source) => [source.id, source])),
  };

  try {
    assertExactScope(context);
    const claims = claimsForTopic(context);
    const projection = createFinalizedChatProjection({
      topic: context.topic,
      identity: context.identity,
      evidenceFrame: context.evidenceFrame,
      claims: claims.map((claim) => createFinalizedChatClaim({
        identity: context.identity,
        topic: context.topic,
        text: claim.text,
        textClass: claim.textClass,
        artifactRefs: uniqueArtifactRefs(claim.artifactRefs),
        sourceRefs: uniqueSourceRefs(claim.sourceRefs ?? []),
      })),
    });
    return FinalizedChatProjectionBuildResultSchema.parse({
      status: "success",
      projection: FinalizedChatProjectionV1Schema.parse(projection),
    });
  } catch (error) {
    const failure = error instanceof ProjectionFailure
      ? error
      : new ProjectionFailure("artifact_mismatch", [
        analysisRef(context, "id"),
      ]);
    return insufficient(context, failure.reasonCode, failure.refs);
  }
}

export interface FinalizedChatV2EvidenceItem {
  evidencePackItemId: string;
  classification: "fact" | "assumption";
  sourceRef: FinalizedChatSourceRef | null;
}

export interface BuildFinalizedChatProjectionV2Input {
  topic: FinalizedChatTopicV2;
  requestedLensDisplayIdentity: string;
  identity: FinalizedChatIdentity;
  evidenceFrame: FinalizedChatEvidenceFrame;
  presentationIdentity: FinalizedChatPresentationIdentityV2;
  decisionCriticalEvidenceProjection: DecisionCriticalEvidenceProjection;
  dispositions: NamedLensFinalizationDisposition[];
  passages: NamedLensPassage[];
  presentation: NamedLensPresentation;
  lensDisplayIdentities: FinalizedChatNamedLensTarget[];
  evidenceItems: FinalizedChatV2EvidenceItem[];
}

class ProjectionFailureV2 extends Error {
  constructor(
    readonly reasonCode:
      | "lens_target_missing"
      | "lens_target_ambiguous"
      | "lens_artifact_unavailable"
      | "presentation_integrity"
      | "source_lineage_incomplete",
    readonly refs: FinalizedChatArtifactRefV2[],
  ) {
    super(reasonCode);
  }
}

type FinalizedChatArtifactRefV2 = Parameters<
  typeof createFinalizedChatClaimV2
>[0]["artifactRefs"][number];

interface ParsedFinalizedChatProjectionV2Input
  extends BuildFinalizedChatProjectionV2Input {
  decisionCriticalEvidenceProjection: DecisionCriticalEvidenceProjection;
  dispositions: NamedLensFinalizationDisposition[];
  passages: NamedLensPassage[];
  presentation: NamedLensPresentation;
  lensDisplayIdentities: FinalizedChatNamedLensTarget[];
  evidenceItems: FinalizedChatV2EvidenceItem[];
}

interface NamedLensProjectionContextV2 {
  input: ParsedFinalizedChatProjectionV2Input;
  target: FinalizedChatNamedLensTarget;
  disposition: NamedLensFinalizationDisposition;
  passage: NamedLensPassage | null;
  evidenceById: Map<string, FinalizedChatV2EvidenceItem>;
}

export type FinalizedChatNamedLensTargetResolution =
  | { status: "matched"; target: FinalizedChatNamedLensTarget }
  | {
    status: "insufficient";
    reasonCode: "lens_target_missing" | "lens_target_ambiguous";
    matchedTargets: FinalizedChatNamedLensTarget[];
  };

export function resolveFinalizedChatNamedLensTarget(input: {
  requestedLensDisplayIdentity: string;
  lensDisplayIdentities: readonly FinalizedChatNamedLensTarget[];
}): FinalizedChatNamedLensTargetResolution {
  const requested = normalizeDisplayIdentity(
    input.requestedLensDisplayIdentity,
  );
  const matchedTargets = input.lensDisplayIdentities
    .map((target) => FinalizedChatNamedLensTargetSchema.parse(target))
    .filter((target) =>
      normalizeDisplayIdentity(target.publicDisplayIdentity) === requested
    );
  if (matchedTargets.length === 1) {
    return { status: "matched", target: matchedTargets[0]! };
  }
  return {
    status: "insufficient",
    reasonCode: matchedTargets.length === 0
      ? "lens_target_missing"
      : "lens_target_ambiguous",
    matchedTargets,
  };
}

export function resolveFinalizedChatNamedLensTargetFromQuestion(input: {
  question: string;
  lensDisplayIdentities: readonly FinalizedChatNamedLensTarget[];
}): FinalizedChatNamedLensTargetResolution {
  const normalizedQuestion = normalizeDisplayIdentity(input.question);
  const matchedTargets = input.lensDisplayIdentities
    .map((target) => FinalizedChatNamedLensTargetSchema.parse(target))
    .filter((target) =>
      containsCompleteDisplayIdentity(
        normalizedQuestion,
        normalizeDisplayIdentity(target.publicDisplayIdentity),
      )
    );
  if (matchedTargets.length === 1) {
    return { status: "matched", target: matchedTargets[0]! };
  }
  return {
    status: "insufficient",
    reasonCode: matchedTargets.length === 0
      ? "lens_target_missing"
      : "lens_target_ambiguous",
    matchedTargets,
  };
}

export function buildFinalizedChatProjectionV2(
  raw: BuildFinalizedChatProjectionV2Input,
): FinalizedChatProjectionBuildResultV2 {
  let parsed: ParsedFinalizedChatProjectionV2Input | null = null;
  try {
    parsed = parseFinalizedChatProjectionV2Input(raw);
    assertFinalizedChatPresentationIdentityV2(parsed);
    const targetResolution = resolveFinalizedChatNamedLensTarget({
      requestedLensDisplayIdentity: parsed.requestedLensDisplayIdentity,
      lensDisplayIdentities: parsed.lensDisplayIdentities,
    });
    if (targetResolution.status === "insufficient") {
      throw new ProjectionFailureV2(targetResolution.reasonCode, [{
        artifactType: "underwriting_presentation",
        artifactId: parsed.presentation.fingerprint,
        fieldPath: "firstScreenProjectionRefs",
      }]);
    }
    const context = contextForFinalizedNamedLensV2(
      parsed,
      targetResolution.target,
    );
    const claims = claimsForFinalizedNamedLensTopicV2(context).map((claim) =>
      createFinalizedChatClaimV2({
        identity: parsed!.identity,
        topic: parsed!.topic,
        target: context.target,
        text: claim.text,
        textClass: claim.textClass,
        artifactRefs: uniqueArtifactRefsV2(claim.artifactRefs),
        sourceRefs: uniqueSourceRefs(claim.sourceRefs),
      })
    );
    return FinalizedChatProjectionBuildResultV2Schema.parse({
      status: "success",
      projection: createFinalizedChatProjectionV2({
        topic: parsed.topic,
        identity: parsed.identity,
        evidenceFrame: parsed.evidenceFrame,
        presentationIdentity: parsed.presentationIdentity,
        target: context.target,
        claims,
      }),
    });
  } catch (error) {
    const failure = error instanceof ProjectionFailureV2
      ? error
      : new ProjectionFailureV2("presentation_integrity", [{
        artifactType: "underwriting_presentation",
        artifactId: raw.presentation?.fingerprint ?? raw.identity.candidateRunId,
        fieldPath: "synthesis",
      }]);
    return FinalizedChatProjectionBuildResultV2Schema.parse({
      status: "insufficient",
      topic: raw.topic,
      requestedLensDisplayIdentity:
        raw.requestedLensDisplayIdentity.trim() || null,
      reasonCode: failure.reasonCode,
      missingArtifactRefs: uniqueArtifactRefsV2(failure.refs),
      identity: raw.identity,
      evidenceFrame: raw.evidenceFrame,
    });
  }
}

interface ClaimInputV2 {
  text: string;
  textClass: "persisted_artifact_text" | "framework_application_inference";
  artifactRefs: FinalizedChatArtifactRefV2[];
  sourceRefs: FinalizedChatSourceRef[];
}

function parseFinalizedChatProjectionV2Input(
  input: BuildFinalizedChatProjectionV2Input,
): ParsedFinalizedChatProjectionV2Input {
  const evidenceItems = input.evidenceItems.map((item) => {
    const evidencePackItemId = item.evidencePackItemId.trim();
    if (!evidencePackItemId) throw new Error("Blank Evidence Pack item ID");
    const sourceRef = item.sourceRef === null
      ? null
      : FinalizedChatSourceRefSchema.parse(item.sourceRef);
    if (
      (item.classification === "fact") !== (sourceRef !== null)
      || (item.classification === "assumption") !== (sourceRef === null)
    ) {
      throw new Error("Fact and Assumption citations require distinct authority");
    }
    return {
      evidencePackItemId,
      classification: item.classification,
      sourceRef,
    };
  });
  if (
    new Set(evidenceItems.map(({ evidencePackItemId }) => evidencePackItemId))
      .size !== evidenceItems.length
  ) {
    throw new Error("Evidence Pack item citations must be unique");
  }
  return {
    ...input,
    decisionCriticalEvidenceProjection:
      DecisionCriticalEvidenceProjectionSchema.parse(
        input.decisionCriticalEvidenceProjection,
      ),
    dispositions: input.dispositions.map((disposition) =>
      NamedLensFinalizationDispositionSchema.parse(disposition)
    ),
    passages: input.passages.map((passage) =>
      NamedLensPassageSchema.parse(passage)
    ),
    presentation: NamedLensPresentationSchema.parse(input.presentation),
    lensDisplayIdentities: input.lensDisplayIdentities.map((target) =>
      FinalizedChatNamedLensTargetSchema.parse(target)
    ),
    evidenceItems,
  };
}

function assertFinalizedChatPresentationIdentityV2(
  input: ParsedFinalizedChatProjectionV2Input,
): void {
  const sourceCandidateRunId = input.presentationIdentity.sourceCandidateRunId;
  if (
    input.presentationIdentity.presentationReportId !== input.identity.reportId
    || input.presentationIdentity.presentationSchemaVersion
      !== input.presentation.schemaVersion
    || input.presentationIdentity.presentationFingerprint
      !== input.presentation.fingerprint
    || input.presentationIdentity.criticalEvidenceProjectionFingerprint
      !== input.decisionCriticalEvidenceProjection.fingerprint
    || input.presentation.workspaceId !== input.identity.workspaceId
    || input.decisionCriticalEvidenceProjection.workspaceId
      !== input.identity.workspaceId
    || input.presentation.artifactSourceCandidateRunId !== sourceCandidateRunId
    || input.decisionCriticalEvidenceProjection.artifactSourceCandidateRunId
      !== sourceCandidateRunId
    || input.dispositions.some((disposition) =>
      disposition.workspaceId !== input.identity.workspaceId
      || disposition.artifactSourceCandidateRunId !== sourceCandidateRunId
      || disposition.decisionCriticalEvidenceProjectionFingerprint
        !== input.decisionCriticalEvidenceProjection.fingerprint
    )
    || input.passages.some((passage) =>
      passage.workspaceId !== input.identity.workspaceId
      || passage.artifactSourceCandidateRunId !== sourceCandidateRunId
    )
  ) {
    throw new ProjectionFailureV2("presentation_integrity", [{
      artifactType: "underwriting_presentation",
      artifactId: input.presentation.fingerprint,
      fieldPath: "synthesis",
    }]);
  }
}

function contextForFinalizedNamedLensV2(
  input: ParsedFinalizedChatProjectionV2Input,
  target: FinalizedChatNamedLensTarget,
): NamedLensProjectionContextV2 {
  const dispositions = input.dispositions.filter((disposition) =>
    disposition.judgmentId === target.judgmentId
    && disposition.frameworkCardId === target.frameworkCardId
  );
  if (dispositions.length !== 1) {
    throw new ProjectionFailureV2("presentation_integrity", [{
      artifactType: "named_lens_disposition",
      artifactId: target.judgmentId,
      fieldPath: "disposition",
    }]);
  }
  const disposition = dispositions[0]!;
  const passages = input.passages.filter((passage) =>
    passage.judgmentId === target.judgmentId
    && passage.frameworkCardId === target.frameworkCardId
    && passage.premise.componentFrameworkId === target.componentFrameworkId
  );
  const publishable = disposition.disposition === "selected_main"
    || disposition.disposition === "appendix_only";
  if (
    (publishable && passages.length !== 1)
    || (!publishable && passages.length !== 0)
    || (
      passages.length === 1
      && passages[0]!.fingerprint !== disposition.passageFingerprint
    )
  ) {
    throw new ProjectionFailureV2("presentation_integrity", [{
      artifactType: "named_lens_passage_segment",
      artifactId: target.judgmentId,
      fieldPath: "premise.text",
    }]);
  }
  return {
    input,
    target,
    disposition,
    passage: passages[0] ?? null,
    evidenceById: new Map(
      input.evidenceItems.map((item) => [item.evidencePackItemId, item]),
    ),
  };
}

function claimsForFinalizedNamedLensTopicV2(
  context: NamedLensProjectionContextV2,
): ClaimInputV2[] {
  switch (context.input.topic) {
    case "named_lens_selection_reason":
      return namedLensSelectionReasonClaims(context);
    case "named_lens_exact_evidence":
      return namedLensExactEvidenceClaims(context);
    case "named_lens_view_change":
      return namedLensViewChangeClaims(context);
    case "named_lens_formal_weight":
      return namedLensFormalWeightClaims(context);
  }
}

function namedLensSelectionReasonClaims(
  context: NamedLensProjectionContextV2,
): ClaimInputV2[] {
  const { disposition } = context;
  const placement = disposition.disposition === "selected_main"
    ? `The main memo includes this perspective at position ${disposition.selectedPosition}.`
    : disposition.disposition === "appendix_only"
    ? "The report retains this complete perspective in its audit Appendix rather than the main reading flow."
    : "The report does not publish a passage for this perspective.";
  const reasonText = naturalNamedLensReasonText(disposition.reasonCodes);
  const basisItems = disposition.selectionBasisEvidenceIds.map((itemId) =>
    context.evidenceById.get(itemId)
  ).filter((item): item is FinalizedChatV2EvidenceItem => item !== undefined);
  const factCount = basisItems.filter(({ classification }) =>
    classification === "fact"
  ).length;
  const assumptionCount = basisItems.length - factCount;
  const evidenceSummary = basisItems.length > 0
    ? [
      `Its selection basis contains ${factCount} saved ${factCount === 1 ? "Fact" : "Facts"}`,
      assumptionCount > 0
        ? ` and ${assumptionCount} explicit ${assumptionCount === 1 ? "Assumption" : "Assumptions"}`
        : "",
      ".",
    ].join("")
    : disposition.disposition === "appendix_only"
      ? disposition.priorityTier === "context_only"
        ? "It is preserved as background context in the audit Appendix rather than the main reading flow; no separate company-evidence selection basis was recorded."
        : "It remains a publishable Appendix perspective without a separate company-evidence selection basis."
      : "No company evidence was saved as a selection basis because the report does not publish a passage for this perspective.";
  const text = [
    placement,
    ...reasonText,
    evidenceSummary,
  ].join(" ");
  const evidence = evidenceCitationsV2(
    context,
    disposition.selectionBasisEvidenceIds,
  );
  return [{
    text,
    textClass: "framework_application_inference",
    artifactRefs: [{
      artifactType: "named_lens_disposition",
      artifactId: disposition.judgmentOrCatalogCandidateId,
      fieldPath: "disposition",
    }, ...(disposition.disposition === "selected_main"
      ? [{
        artifactType: "named_lens_disposition" as const,
        artifactId: disposition.judgmentOrCatalogCandidateId,
        fieldPath: "selectedPosition" as const,
      }]
      : []), {
      artifactType: "named_lens_disposition",
      artifactId: disposition.judgmentOrCatalogCandidateId,
      fieldPath: "reasonCodes",
    }, {
      artifactType: "named_lens_disposition",
      artifactId: disposition.judgmentOrCatalogCandidateId,
      fieldPath: "selectionBasisEvidenceIds",
    }, ...evidence.artifactRefs],
    sourceRefs: evidence.sourceRefs,
  }];
}

function naturalNamedLensReasonText(reasonCodes: readonly string[]): string[] {
  const messages = reasonCodes.map((reasonCode) => {
    switch (reasonCode) {
      case "CHANGED_BELIEF_EVIDENCE":
        return "This perspective directly examines the new evidence that changed the fund's prior view.";
      case "PRINCIPAL_DISAGREEMENT":
        return "It represents one side of the report's principal, evidence-grounded investment tension.";
      case "DECISION_OR_VALUATION":
        return "It tests evidence that is material to the formal decision or valuation boundary.";
      case "DISTINCT_MATERIAL":
        return "It adds a distinct, decision-relevant question that the other published perspectives do not cover.";
      case "PASSAGE_GROUNDING_FAILED":
        return "Its proposed passage did not satisfy the saved grounding requirements, so the report withholds the body.";
      case "PASSAGE_NOT_GENERATED":
        return "A complete source-grounded passage is not available, so the report leaves the body unpublished.";
      case "PROVIDER_UNAVAILABLE":
      case "PROVIDER_FAILED":
      case "PROVIDER_TIMEOUT":
        return "A complete source-grounded passage was unavailable, so the report withholds the body.";
      case "ABSTAINED":
        return "The framework did not reach a supported view on the available evidence.";
      case "CONTEXT_INAPPLICABLE":
      case "INELIGIBLE":
        return "The framework did not apply to this company's saved underwriting context.";
      default:
        return "The audit record preserves an additional typed selection condition without expanding it into unsupported prose.";
    }
  });
  return [...new Set(messages)];
}

function requireNamedLensPassageV2(
  context: NamedLensProjectionContextV2,
): NamedLensPassage {
  if (!context.passage) {
    throw new ProjectionFailureV2("lens_artifact_unavailable", [{
      artifactType: "named_lens_passage_segment",
      artifactId: context.target.judgmentId,
      fieldPath: "premise.text",
    }]);
  }
  return context.passage;
}

function namedLensExactEvidenceClaims(
  context: NamedLensProjectionContextV2,
): ClaimInputV2[] {
  const passage = requireNamedLensPassageV2(context);
  const caseEvidence = evidenceCitationsV2(
    context,
    passage.caseApplication.evidenceItemIds,
  );
  const counterEvidence = evidenceCitationsV2(
    context,
    passage.countercase.evidenceItemIds,
  );
  return [{
    text: passage.premise.text,
    textClass: "persisted_artifact_text",
    artifactRefs: [
      "premise.text",
      "premise.componentFrameworkId",
      "premise.componentVersion",
      "premise.cardFieldRef",
      "premise.publicSourceIds",
      "premise.claimIds",
      "premise.locator",
      "premise.attributionScope",
    ].map((fieldPath) => ({
      artifactType: "named_lens_passage_segment" as const,
      artifactId: passage.fingerprint,
      fieldPath,
    })),
    sourceRefs: [],
  }, {
    text: passage.caseApplication.text,
    textClass: "framework_application_inference",
    artifactRefs: [{
      artifactType: "named_lens_passage_segment",
      artifactId: passage.fingerprint,
      fieldPath: "caseApplication.text",
    }, {
      artifactType: "named_lens_passage_segment",
      artifactId: passage.fingerprint,
      fieldPath: "caseApplication.evidenceItemIds",
    }, ...caseEvidence.artifactRefs],
    sourceRefs: caseEvidence.sourceRefs,
  }, {
    text: passage.countercase.text,
    textClass: "framework_application_inference",
    artifactRefs: [{
      artifactType: "named_lens_passage_segment",
      artifactId: passage.fingerprint,
      fieldPath: "countercase.text",
    }, {
      artifactType: "named_lens_passage_segment",
      artifactId: passage.fingerprint,
      fieldPath: "countercase.evidenceItemIds",
    }, {
      artifactType: "named_lens_passage_segment",
      artifactId: passage.fingerprint,
      fieldPath: "countercase.evidenceRequestRefs",
    }, ...counterEvidence.artifactRefs],
    sourceRefs: counterEvidence.sourceRefs,
  }];
}

function namedLensViewChangeClaims(
  context: NamedLensProjectionContextV2,
): ClaimInputV2[] {
  const passage = requireNamedLensPassageV2(context);
  const counterEvidence = evidenceCitationsV2(
    context,
    passage.countercase.evidenceItemIds,
  );
  return [{
    text: passage.countercase.text,
    textClass: "framework_application_inference",
    artifactRefs: [{
      artifactType: "named_lens_passage_segment",
      artifactId: passage.fingerprint,
      fieldPath: "countercase.text",
    }, {
      artifactType: "named_lens_passage_segment",
      artifactId: passage.fingerprint,
      fieldPath: "countercase.evidenceItemIds",
    }, {
      artifactType: "named_lens_passage_segment",
      artifactId: passage.fingerprint,
      fieldPath: "countercase.evidenceRequestRefs",
    }, ...counterEvidence.artifactRefs],
    sourceRefs: counterEvidence.sourceRefs,
  }, {
    text: passage.unknownBoundary.text,
    textClass: "framework_application_inference",
    artifactRefs: [{
      artifactType: "named_lens_passage_segment",
      artifactId: passage.fingerprint,
      fieldPath: "unknownBoundary.text",
    }, {
      artifactType: "named_lens_passage_segment",
      artifactId: passage.fingerprint,
      fieldPath: "unknownBoundary.judgmentUnknownRefs",
    }, {
      artifactType: "named_lens_passage_segment",
      artifactId: passage.fingerprint,
      fieldPath: "unknownBoundary.judgmentLimitationRefs",
    }, {
      artifactType: "named_lens_passage_segment",
      artifactId: passage.fingerprint,
      fieldPath: "unknownBoundary.evidenceRequestRefs",
    }],
    sourceRefs: [],
  }, {
    text: passage.conditionalConclusion.text,
    textClass: "framework_application_inference",
    artifactRefs: [{
      artifactType: "named_lens_passage_segment",
      artifactId: passage.fingerprint,
      fieldPath: "conditionalConclusion.text",
    }],
    sourceRefs: [],
  }];
}

function namedLensFormalWeightClaims(
  context: NamedLensProjectionContextV2,
): ClaimInputV2[] {
  const passage = requireNamedLensPassageV2(context);
  if (passage.advisoryContract.formalDecisionWeight !== "0") {
    throw new ProjectionFailureV2("presentation_integrity", [{
      artifactType: "named_lens_passage_segment",
      artifactId: passage.fingerprint,
      fieldPath: "advisoryContract.formalDecisionWeight",
    }]);
  }
  return [{
    text:
      "The saved advisory contract assigns this Named Lens formal-decision weight 0. Its persisted passage can guide diligence, but it cannot change the formal decision result.",
    textClass: "persisted_artifact_text",
    artifactRefs: [{
      artifactType: "named_lens_passage_segment",
      artifactId: passage.fingerprint,
      fieldPath: "advisoryContract.formalDecisionWeight",
    }],
    sourceRefs: [],
  }];
}

function evidenceCitationsV2(
  context: NamedLensProjectionContextV2,
  evidenceItemIds: readonly string[],
): {
  artifactRefs: FinalizedChatArtifactRefV2[];
  sourceRefs: FinalizedChatSourceRef[];
} {
  const artifactRefs: FinalizedChatArtifactRefV2[] = [];
  const sourceRefs: FinalizedChatSourceRef[] = [];
  for (const evidenceItemId of [...new Set(evidenceItemIds)]) {
    const item = context.evidenceById.get(evidenceItemId);
    if (!item) {
      throw new ProjectionFailureV2("source_lineage_incomplete", [{
        artifactType: "decision_critical_evidence_projection",
        artifactId: context.input.decisionCriticalEvidenceProjection.id,
        fieldPath: "evidenceRefs",
      }]);
    }
    artifactRefs.push({
      artifactType: item.classification === "fact"
        ? "evidence_pack_fact"
        : "evidence_pack_assumption",
      artifactId: evidenceItemId,
      fieldPath: "value",
    });
    if (item.sourceRef) sourceRefs.push(item.sourceRef);
  }
  return {
    artifactRefs: uniqueArtifactRefsV2(artifactRefs),
    sourceRefs: uniqueSourceRefs(sourceRefs),
  };
}

function uniqueArtifactRefsV2(
  refs: readonly FinalizedChatArtifactRefV2[],
): FinalizedChatArtifactRefV2[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = canonicalArtifactRefV2(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((ref) => structuredClone(ref));
}

function canonicalArtifactRefV2(ref: FinalizedChatArtifactRefV2): string {
  return `${ref.artifactType}\u0000${ref.artifactId}\u0000${ref.fieldPath}`;
}

function normalizeDisplayIdentity(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function containsCompleteDisplayIdentity(
  normalizedQuestion: string,
  normalizedIdentity: string,
): boolean {
  if (!normalizedIdentity) return false;
  const escaped = normalizedIdentity.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`,
    "u",
  ).test(normalizedQuestion);
}

function assertExactScope(context: ProjectionContext): void {
  const { analysis, bundle, candidateBinding, identity } = context;
  if (
    analysis.reportId !== identity.reportId
    || analysis.runId !== identity.runId
      || analysis.dealId !== identity.dealId
      || candidateBinding.candidateRunId !== identity.candidateRunId
  ) {
    fail("scope_identity_mismatch", [analysisRef(context, "reportId")]);
  }
  if (
    bundle !== null
    && (
      bundle.workspaceId !== identity.workspaceId
      || bundle.dealId !== identity.dealId
      || bundle.candidateRunId !== candidateBinding.candidateRunId
      || bundle.sourceCandidateRunId !== (
        candidateBinding.artifactSourceCandidateRunId
          ?? candidateBinding.candidateRunId
      )
      || bundle.candidateAnalysisFingerprint
        !== candidateBinding.candidateAnalysisFingerprint
      || bundle.evidencePack.workspaceId !== identity.workspaceId
      || bundle.evidencePack.dealId !== identity.dealId
    )
  ) {
    fail("scope_identity_mismatch", [bundleRef(context, "identity")]);
  }
  const hasDemoFixture = analysis.investmentMemory.fixtureIds.length > 0
    || analysis.sources.some((source) => source.provenance === "demo_fixture");
  if (hasDemoFixture && context.requestMode === "product") {
    fail("demo_fixture_forbidden", [
      analysisRef(context, "investmentMemory.fixtureIds"),
    ]);
  }
  if (hasDemoFixture) exactSampleSource(context);
}

function claimsForTopic(context: ProjectionContext): ClaimInput[] {
  switch (context.topic) {
    case "prior_reason":
      return priorReasonClaims(context);
    case "belief_change":
      return beliefChangeClaims(context);
    case "strongest_counterargument":
      return counterargumentClaims(context);
    case "match_confidence":
      return matchConfidenceClaims(context);
    case "framework_disagreement":
      return frameworkDisagreementClaims(context);
    case "valuation":
      return valuationClaims(context);
    case "missing_evidence":
      return missingEvidenceClaims(context);
    case "invested_action":
      return investedActionClaims(context);
  }
}

function priorReasonClaims(context: ProjectionContext): ClaimInput[] {
  const sample = exactSampleSource(context);
  return [{
    text: sample.text.normalizedStatement,
    textClass: "normalized_statement",
    artifactRefs: [
      analysisRef(context, "investmentMemory.decisionReason"),
      {
        artifactType: "sample_decision_record",
        artifactId: sample.sourceId,
        fieldPath: "text.normalizedStatement",
      },
    ],
    sourceRefs: [sample],
  }];
}

function beliefChangeClaims(context: ProjectionContext): ClaimInput[] {
  const assessment = requireAssessment(context);
  const sample = exactSampleSource(context);
  const mappingSources = exactSources(
    context,
    assessment.gates.revisitConditionMapping.citedSourceIds,
  );
  const triggerSources = exactSources(
    context,
    assessment.gateContext.triggerEvent.sourceIds,
  );
  const triggerEvent = context.analysis.marketEvidence.events.find(
    ({ id }) => id === assessment.gateContext.triggerEvent.id,
  );
  if (!triggerEvent || !("schemaVersion" in triggerEvent)) {
    fail("source_lineage_incomplete", [{
      artifactType: "market_event",
      artifactId: assessment.gateContext.triggerEvent.id,
      fieldPath: "sources",
    }]);
  }
  const priorKinds = assessment.gates.actionDelta.priorActions.map(({ kind }) => kind);
  const proposedKinds = assessment.gates.actionDelta.proposedActions.map(({ kind }) => kind);
  const summary = [
    `Belief direction: ${assessment.direction}.`,
    `Revisit mapping: ${assessment.gates.revisitConditionMapping.revisitConditionText}.`,
    `Trigger event: ${assessment.gateContext.triggerEvent.id}.`,
    `Action delta: [${priorKinds.join(", ")}] -> [${proposedKinds.join(", ")}].`,
  ].join(" ");
  const sourceClaims = triggerSources.map((source): ClaimInput => {
    const index = triggerEvent.sources.findIndex((candidate) =>
      candidate.id === source.sourceId
      && candidate.sourceRevisionId === source.sourceRevisionId
      && candidate.contentFingerprint === source.contentFingerprint
    );
    if (index < 0) {
      fail("source_lineage_incomplete", [{
        artifactType: "market_event",
        artifactId: triggerEvent.id,
        fieldPath: "sources",
      }]);
    }
    if (source.text.status === "verified_exact") {
      return {
        text: source.text.verbatimExcerpt,
        textClass: "exact_quote",
        artifactRefs: [{
          artifactType: "market_event",
          artifactId: assessment.gateContext.triggerEvent.id,
          fieldPath: `sources[${index}].text.verbatimExcerpt`,
        }],
        sourceRefs: [source],
      };
    }
    return {
      text: source.text.normalizedStatement,
      textClass: "normalized_statement",
      artifactRefs: [{
        artifactType: "market_event",
        artifactId: assessment.gateContext.triggerEvent.id,
        fieldPath: `sources[${index}].text.normalizedStatement`,
      }],
      sourceRefs: [source],
    };
  });
  return [{
    text: sample.text.normalizedStatement,
    textClass: "normalized_statement",
    artifactRefs: [{
      artifactType: "sample_decision_record",
      artifactId: sample.sourceId,
      fieldPath: "text.normalizedStatement",
    }],
    sourceRefs: [sample],
  }, ...sourceClaims, {
    text: summary,
    textClass: "persisted_inference",
    artifactRefs: [
      analysisRef(context, "beliefAssessment.direction"),
      {
        artifactType: "belief_assessment",
        artifactId: context.analysis.id,
        fieldPath: "gates.revisitConditionMapping",
      },
      {
        artifactType: "belief_assessment",
        artifactId: context.analysis.id,
        fieldPath: "gates.actionDelta",
      },
    ],
    sourceRefs: [sample, ...mappingSources, ...triggerSources],
  }];
}

function counterargumentClaims(context: ProjectionContext): ClaimInput[] {
  const assessment = requireAssessment(context);
  const gate = assessment.gates.counterevidence;
  if (!gate.statement.trim() || gate.citedSourceIds.length === 0) {
    fail("finalized_artifact_missing", [{
      artifactType: "belief_assessment",
      artifactId: context.analysis.id,
      fieldPath: "gates.counterevidence",
    }]);
  }
  const sourceRefs = exactSources(context, gate.citedSourceIds);
  let textClass: FinalizedChatTextClass = "persisted_inference";
  if (sourceRefs.every((source) =>
    source.text.status === "verified_exact"
    && source.text.verbatimExcerpt === gate.statement
  )) {
    textClass = "exact_quote";
  } else if (sourceRefs.every((source) =>
    source.text.status === "normalized_only"
    && source.text.normalizedStatement === gate.statement
  )) {
    textClass = "normalized_statement";
  }
  return [{
    text: gate.statement,
    textClass,
    artifactRefs: [{
      artifactType: "belief_assessment",
      artifactId: context.analysis.id,
      fieldPath: "gates.counterevidence.statement",
    }],
    sourceRefs,
  }];
}

function matchConfidenceClaims(context: ProjectionContext): ClaimInput[] {
  const assessment = requireAssessment(context);
  const score = assessment.scoreBreakdown;
  const gates = assessment.gates;
  const namedGates = [
    ["chronology", gates.chronology],
    ["revisitConditionMapping", gates.revisitConditionMapping],
    ["counterevidence", gates.counterevidence],
    ["actionDelta", gates.actionDelta],
  ] as const;
  const failures = namedGates.flatMap(([name, gate]) =>
    gate.failureReason === null ? [] : [`${name}=${gate.failureReason}`]
  );
  const text = [
    `Match confidence: ${score.confidence}; final score=${score.finalScore}.`,
    "Thresholds: medium>=0.5; high>=0.78.",
    `Dimensions: eventRelevance=${score.eventRelevance} (weight 0.35); dealRelevance=${score.dealRelevance} (weight 0.30); priorContextStrength=${score.priorContextStrength} (weight 0.20); evidenceQuality=${score.evidenceQuality} (weight 0.15).`,
    `Hard gates: ${namedGates.map(([name, gate]) =>
      `${name}=${gate.passed ? "passed" : "failed"}`
    ).join("; ")}; allPassed=${gates.allPassed}.`,
    `Failures: ${failures.length === 0 ? "none" : failures.join("; ")}.`,
  ].join(" ");
  return [{
    text,
    textClass: "persisted_inference",
    artifactRefs: [{
      artifactType: "match_assessment",
      artifactId: context.analysis.id,
      fieldPath: "beliefAssessment.scoreBreakdown",
    }],
  }];
}

function frameworkDisagreementClaims(context: ProjectionContext): ClaimInput[] {
  const bundle = requireBundle(context, "framework_disagreement");
  if (bundle.disagreements.length === 0) {
    fail("finalized_artifact_missing", [{
      artifactType: "framework_disagreement",
      artifactId: bundle.candidateRunId,
      fieldPath: "disagreements",
    }]);
  }
  const claims: ClaimInput[] = [];
  const judgmentIds = new Set<string>();
  for (const disagreement of bundle.disagreements) {
    const left = exactJudgment(bundle, disagreement.leftJudgmentId);
    const right = exactJudgment(bundle, disagreement.rightJudgmentId);
    for (const judgment of [left, right]) {
      if (judgmentIds.has(judgment.id)) continue;
      judgmentIds.add(judgment.id);
      claims.push(frameworkJudgmentClaim(context, bundle, judgment));
    }
    claims.push({
      text: disagreement.explanation,
      textClass: "persisted_inference",
      artifactRefs: [{
        artifactType: "framework_disagreement",
        artifactId: disagreement.id,
        fieldPath: "explanation",
      }, {
        artifactType: "framework_judgment",
        artifactId: left.id,
        fieldPath: "conclusion",
      }, {
        artifactType: "framework_judgment",
        artifactId: right.id,
        fieldPath: "conclusion",
      }],
      sourceRefs: evidenceSourcesForItemIds(
        context,
        bundle,
        disagreement.evidenceItemIds,
      ),
    });
  }
  return claims;
}

function frameworkJudgmentClaim(
  context: ProjectionContext,
  bundle: CandidateArtifactBundle,
  judgment: FrameworkJudgment,
): ClaimInput {
  const text = [
    `Framework ${judgment.frameworkCardId}@${judgment.frameworkVersion}: ${judgment.conclusion}.`,
    `Strongest support: ${judgment.strongestSupport ?? "Unavailable"}.`,
    `Strongest counterargument: ${judgment.strongestCounterargument ?? "Unavailable"}.`,
  ].join(" ");
  return {
    text,
    textClass: "persisted_inference",
    artifactRefs: [{
      artifactType: "framework_judgment",
      artifactId: judgment.id,
      fieldPath: "conclusion",
    }],
    sourceRefs: evidenceSourcesForItemIds(context, bundle, [
      ...judgment.supportEvidenceItemIds,
      ...judgment.counterEvidenceItemIds,
    ]),
  };
}

function valuationClaims(context: ProjectionContext): ClaimInput[] {
  const bundle = requireBundle(context, "valuation");
  const valuation = bundle.valuation;
  const availableValues = valuation.scenarios.flatMap(({ valuation }) =>
    valuation === null ? [] : [valuation]
  );
  if (valuation.status === "unavailable" || availableValues.length === 0) {
    return [{
      text: `Valuation: Unavailable. Blockers: ${
        valuation.blockerCodes.join(", ") || "No saved blocker code"
      }.`,
      textClass: "persisted_inference",
      artifactRefs: [{
        artifactType: "valuation_evaluation",
        artifactId: valuation.id,
        fieldPath: "status",
      }],
    }];
  }
  const scenarioText = valuation.scenarios.map((scenario) =>
    `${capitalize(scenario.name)}=${scenario.valuation ?? "Unavailable"}`
  ).join("; ");
  const text = [
    `Valuation status=${valuation.status}. ${scenarioText}.`,
    `Current ask=${valuation.currentAsk ?? "Unavailable"}.`,
    `Maximum acceptable pre-money=${valuation.maximumAcceptablePreMoney ?? "Unavailable"}.`,
    `Initial ownership=${valuation.initialOwnership ?? "Unavailable"}; post-dilution ownership=${valuation.postDilutionOwnership ?? "Unavailable"}.`,
    `Gross MOIC=${valuation.grossMoic ?? "Unavailable"}; gross IRR=${valuation.grossIrr ?? "Unavailable"}.`,
    `Pricing premium=${valuation.pricingPremium ?? "Unavailable"}.`,
  ].join(" ");
  const calculations = valuation.calculationIds.map((calculationId) => {
    const calculation = bundle.calculations.find(({ id }) => id === calculationId);
    if (!calculation) {
      fail("source_lineage_incomplete", [{
        artifactType: "calculation",
        artifactId: calculationId,
        fieldPath: "id",
      }]);
    }
    return calculation;
  });
  return [{
    text,
    textClass: "persisted_inference",
    artifactRefs: [{
      artifactType: "valuation_evaluation",
      artifactId: valuation.id,
      fieldPath: "scenarios",
    }, ...calculations.map((calculation) => ({
      artifactType: "calculation" as const,
      artifactId: calculation.id,
      fieldPath: "output",
    }))],
    sourceRefs: evidenceSourcesForItemIds(
      context,
      bundle,
      calculations.flatMap((calculation) =>
        calculation.inputRefs.map(({ itemId }) => itemId)
      ),
    ),
  }];
}

function missingEvidenceClaims(context: ProjectionContext): ClaimInput[] {
  const bundle = requireBundle(context, "missing_evidence");
  const coverage = bundle.evidencePack.coverage;
  const claims: ClaimInput[] = [{
    text: [
      `Evidence coverage status=${coverage.underwritingStatus}.`,
      `Missing fields: ${coverage.missingFieldIds.join(", ") || "none"}.`,
      `Blocking conflicts: ${coverage.blockingConflictIds.join(", ") || "none"}.`,
      `Decision ceiling: ${coverage.decisionCeiling ?? "Unavailable"}.`,
      `Reason codes: ${coverage.reasonCodes.join(", ") || "none"}.`,
    ].join(" "),
    textClass: "persisted_inference",
    artifactRefs: [{
      artifactType: "evidence_pack",
      artifactId: bundle.evidencePack.id,
      fieldPath: "coverage",
    }],
  }];

  const v2Drafts = bundle.actionDrafts.filter(
    (draft): draft is ActionDraftV2 => "schemaVersion" in draft,
  );
  const savedMissingFieldIds = new Set(v2Drafts.flatMap((draft) =>
    draft.missingEvidence.map(({ fieldId }) => fieldId)
  ));
  if (coverage.missingFieldIds.some((fieldId) =>
    !savedMissingFieldIds.has(fieldId)
  )) {
    fail("finalized_artifact_missing", [{
      artifactType: "missing_evidence",
      artifactId: bundle.evidencePack.id,
      fieldPath: "coverage.missingFieldIds",
    }]);
  }
  const seenMissing = new Set<string>();
  for (const draft of v2Drafts) {
    for (const missing of draft.missingEvidence) {
      const key = [
        missing.fieldId,
        missing.label,
        missing.reasonCode,
        missing.mostLikelyDecisionImpact,
      ].join("\u0000");
      if (seenMissing.has(key)) continue;
      seenMissing.add(key);
      claims.push({
        text: `Missing evidence ${missing.label}: ${missing.reasonCode}. ${missing.mostLikelyDecisionImpact}`,
        textClass: "persisted_inference",
        artifactRefs: [{
          artifactType: "missing_evidence",
          artifactId: `${draft.id}:${missing.fieldId}`,
          fieldPath: "label",
        }, {
          artifactType: "action_draft",
          artifactId: draft.id,
          fieldPath: "missingEvidence",
        }],
      });
    }
  }

  for (const conflictId of coverage.blockingConflictIds) {
    const conflict = bundle.evidencePack.conflicts.find(({ id }) => id === conflictId);
    if (!conflict) {
      fail("source_lineage_incomplete", [{
        artifactType: "evidence_pack",
        artifactId: bundle.evidencePack.id,
        fieldPath: "coverage.blockingConflictIds",
      }]);
    }
    const facts = [conflict.leftFactId, conflict.rightFactId].map((factId) =>
      requireFact(bundle, factId)
    );
    claims.push({
      text: `Fact conflict ${conflict.field}: ${facts.map((fact) =>
        `${fact.id}=${fact.value}`
      ).join(" versus ")}.`,
      textClass: "persisted_inference",
      artifactRefs: facts.map((fact) => ({
        artifactType: "fact" as const,
        artifactId: fact.id,
        fieldPath: "value",
      })),
      sourceRefs: facts.map((fact) => sourceForFact(context, fact)),
    });
  }

  for (const assumption of bundle.evidencePack.assumptions) {
    claims.push({
      text: `Assumption ${assumption.field}=${assumption.value} (${assumption.scenario}): ${assumption.rationale}`,
      textClass: "persisted_inference",
      artifactRefs: [{
        artifactType: "assumption",
        artifactId: assumption.id,
        fieldPath: "value",
      }],
    });
  }
  for (const calculation of bundle.calculations) {
    claims.push({
      text: `Calculation ${calculation.formulaId}@${calculation.formulaVersion}: output=${calculation.output} ${calculation.unit}; status=${calculation.status}.`,
      textClass: "persisted_inference",
      artifactRefs: [{
        artifactType: "calculation",
        artifactId: calculation.id,
        fieldPath: "output",
      }],
      sourceRefs: evidenceSourcesForItemIds(
        context,
        bundle,
        calculation.inputRefs.map(({ itemId }) => itemId),
      ),
    });
  }
  return claims;
}

function investedActionClaims(context: ProjectionContext): ClaimInput[] {
  if (context.analysis.dealStatus !== "invested") {
    fail("not_invested", [analysisRef(context, "dealStatus")]);
  }
  const assessment = requireAssessment(context);
  const bundle = requireBundle(context, "invested_action");
  const expectedActions = actionsForDealStatusAndDirection(
    "invested",
    assessment.direction,
  );
  const snapshot = bundle.versionSnapshot;
  const v2Drafts = bundle.actionDrafts.filter(
    (draft): draft is ActionDraftV2 => "schemaVersion" in draft,
  );
  if (
    !beliefActionListsEqual(assessment.actions, expectedActions)
    || snapshot.dealStatus !== "invested"
    || snapshot.beliefDirection !== assessment.direction
    || snapshot.actionPolicyVersion !== "belief-action-policy-v1"
    || snapshot.canonicalActions === undefined
    || !beliefActionListsEqual(snapshot.canonicalActions, expectedActions)
    || v2Drafts.length === 0
    || v2Drafts.some((draft) =>
      draft.dealStatus !== "invested"
      || draft.beliefDirection !== assessment.direction
      || !beliefActionListsEqual(draft.actions, expectedActions)
    )
  ) {
    fail("artifact_mismatch", [{
      artifactType: "action_policy",
      artifactId: snapshot.actionPolicyVersion ?? "missing_action_policy",
      fieldPath: "canonicalActions",
    }]);
  }
  const actionText = `Typed invested action (separate from formal underwriting): ${
    renderActionKinds(expectedActions)
  }.`;
  const decisionText = bundle.decision.decision === null
    ? "Formal underwriting decision: Unavailable."
    : `Formal underwriting decision: ${bundle.decision.decision}.`;
  return [{
    text: actionText,
    textClass: "persisted_inference",
    artifactRefs: [{
      artifactType: "belief_assessment",
      artifactId: context.analysis.id,
      fieldPath: "actions",
    }, {
      artifactType: "action_policy",
      artifactId: snapshot.actionPolicyVersion,
      fieldPath: "canonicalActions",
    }, ...v2Drafts.map((draft) => ({
      artifactType: "action_draft" as const,
      artifactId: draft.id,
      fieldPath: "actions",
    }))],
  }, {
    text: decisionText,
    textClass: "persisted_inference",
    artifactRefs: [{
      artifactType: "decision_result",
      artifactId: bundle.decision.id,
      fieldPath: "decision",
    }],
  }];
}

function exactSampleSource(context: ProjectionContext): FinalizedChatSourceRef & {
  text: { status: "normalized_only"; normalizedStatement: string };
} {
  const fixtures = context.analysis.investmentMemory.fixtureIds;
  if (fixtures.length === 0) {
    fail("finalized_artifact_missing", [analysisRef(context, "investmentMemory.fixtureIds")]);
  }
  if (context.requestMode !== "public_sandbox") {
    fail("demo_fixture_forbidden", [analysisRef(context, "investmentMemory.fixtureIds")]);
  }
  if (
    fixtures.length !== 1
    || !context.analysis.investmentMemory.sourceIds.includes(fixtures[0])
  ) {
    fail("source_lineage_incomplete", [analysisRef(context, "investmentMemory")]);
  }
  const source = context.sourceById.get(fixtures[0]);
  const expectedStatement = renderSampleDecisionStatement({
    summary: context.analysis.investmentMemory.previousMeetingSummary,
    decisionReason: context.analysis.investmentMemory.decisionReason,
    concerns: context.analysis.investmentMemory.concerns,
    revisitConditions: context.analysis.investmentMemory.revisitConditions,
  });
  if (
    source === undefined
    || !("schemaVersion" in source)
    || source.adaptation !== "canonical"
    || source.provenance !== "demo_fixture"
    || source.title !== "Sample decision record"
    || source.providerId !== "deal-registry"
    || source.sourceClass !== "internal_decision_record"
    || source.sourceAuthority !== "primary"
    || source.evidenceRole !== "context"
    || source.documentId === null
    || source.sourceRevisionId === null
    || source.contentFingerprint === null
    || source.text.status !== "normalized_only"
    || source.text.normalizedStatement !== expectedStatement
    || source.eventAt !== context.analysis.investmentMemory.lastEvaluatedAt
    || !context.analysis.companyBrief.sourceLineage.some((candidate) =>
      candidate.id === source.id
      && "schemaVersion" in candidate
      && candidate.sourceRevisionId === source.sourceRevisionId
      && candidate.contentFingerprint === source.contentFingerprint
    )
    || (
      context.analysis.beliefAssessment !== undefined
      && !context.analysis.beliefAssessment.gateContext.sources.some((candidate) =>
        candidate.id === source.id
        && candidate.sourceRevisionId === source.sourceRevisionId
        && candidate.contentFingerprint === source.contentFingerprint
      )
    )
  ) {
    fail("source_lineage_incomplete", [analysisRef(context, "investmentMemory.fixtureIds")]);
  }
  return toFinalizedSourceRef(source) as FinalizedChatSourceRef & {
    text: { status: "normalized_only"; normalizedStatement: string };
  };
}

function exactSources(
  context: ProjectionContext,
  sourceIds: readonly string[],
): FinalizedChatSourceRef[] {
  if (sourceIds.length === 0 || new Set(sourceIds).size !== sourceIds.length) {
    fail("source_lineage_incomplete", [analysisRef(context, "sources")]);
  }
  return sourceIds.map((sourceId) => {
    const source = context.sourceById.get(sourceId);
    if (!source) {
      fail("source_lineage_incomplete", [analysisRef(context, "sources")]);
    }
    return toFinalizedSourceRef(source);
  });
}

function toFinalizedSourceRef(source: EvidenceSourceRef): FinalizedChatSourceRef {
  if (
    !("schemaVersion" in source)
    || source.adaptation !== "canonical"
    || source.sourceRevisionId === null
    || source.contentFingerprint === null
    || (
      source.text.status !== "verified_exact"
      && source.text.status !== "normalized_only"
    )
  ) {
    fail("source_lineage_incomplete", [{
      artifactType: "company_analysis",
      artifactId: source.id,
      fieldPath: "sourceRevisionId",
    }]);
  }
  return {
    sourceId: source.id,
    documentId: source.documentId,
    sourceRevisionId: source.sourceRevisionId,
    contentFingerprint: source.contentFingerprint,
    canonicalSource: structuredClone(source),
    text: structuredClone(source.text),
  };
}

function sourceForFact(
  context: ProjectionContext,
  fact: Fact,
): FinalizedChatSourceRef {
  const matches = context.analysis.sources.filter((source) =>
    "schemaVersion" in source
    && source.sourceRevisionId === fact.sourceRevisionId
  );
  if (matches.length !== 1) {
    fail("source_lineage_incomplete", [{
      artifactType: "fact",
      artifactId: fact.id,
      fieldPath: "sourceRevisionId",
    }]);
  }
  return toFinalizedSourceRef(matches[0]);
}

function evidenceSourcesForItemIds(
  context: ProjectionContext,
  bundle: CandidateArtifactBundle,
  itemIds: readonly string[],
): FinalizedChatSourceRef[] {
  const refs: FinalizedChatSourceRef[] = [];
  for (const itemId of [...new Set(itemIds)]) {
    const fact = bundle.evidencePack.facts.find(({ id }) => id === itemId);
    if (fact) {
      refs.push(sourceForFact(context, fact));
      continue;
    }
    if (bundle.evidencePack.assumptions.some(({ id }) => id === itemId)) {
      continue;
    }
    const calculation = bundle.calculations.find(({ id }) => id === itemId);
    if (calculation) {
      refs.push(...evidenceSourcesForItemIds(
        context,
        bundle,
        calculation.inputRefs.map(({ itemId: inputId }) => inputId),
      ));
      continue;
    }
    fail("source_lineage_incomplete", [{
      artifactType: "evidence_pack",
      artifactId: bundle.evidencePack.id,
      fieldPath: "facts",
    }]);
  }
  return uniqueSourceRefs(refs);
}

function requireFact(
  bundle: CandidateArtifactBundle,
  factId: string,
): Fact {
  const fact = bundle.evidencePack.facts.find(({ id }) => id === factId);
  if (!fact) {
    fail("source_lineage_incomplete", [{
      artifactType: "evidence_pack",
      artifactId: bundle.evidencePack.id,
      fieldPath: "facts",
    }]);
  }
  return fact;
}

function exactJudgment(
  bundle: CandidateArtifactBundle,
  judgmentId: string,
): FrameworkJudgment {
  const matches = bundle.judgments.filter(({ id }) => id === judgmentId);
  if (matches.length !== 1) {
    fail("source_lineage_incomplete", [{
      artifactType: "framework_judgment",
      artifactId: judgmentId,
      fieldPath: "id",
    }]);
  }
  return matches[0];
}

function requireAssessment(context: ProjectionContext) {
  if (!context.analysis.beliefAssessment) {
    fail("finalized_artifact_missing", [{
      artifactType: "belief_assessment",
      artifactId: context.analysis.id,
      fieldPath: "beliefAssessment",
    }]);
  }
  return context.analysis.beliefAssessment;
}

function requireBundle(
  context: ProjectionContext,
  fieldPath: string,
): CandidateArtifactBundle {
  if (!context.bundle) {
    fail("finalized_artifact_missing", [{
      artifactType: "evidence_pack",
      artifactId: context.identity.candidateRunId,
      fieldPath,
    }]);
  }
  return context.bundle;
}

function analysisRef(
  context: Pick<ProjectionContext, "analysis">,
  fieldPath: string,
): FinalizedChatArtifactRef {
  return {
    artifactType: "company_analysis",
    artifactId: context.analysis.id,
    fieldPath,
  };
}

function bundleRef(
  context: Pick<ProjectionContext, "bundle" | "identity">,
  fieldPath: string,
): FinalizedChatArtifactRef {
  return {
    artifactType: "evidence_pack",
    artifactId: context.bundle?.evidencePack.id
      ?? context.identity.candidateRunId,
    fieldPath,
  };
}

function insufficient(
  context: ProjectionContext,
  reasonCode: FinalizedChatInsufficientReasonCode,
  refs: FinalizedChatArtifactRef[],
): FinalizedChatProjectionBuildResult {
  return FinalizedChatProjectionBuildResultSchema.parse({
    status: "insufficient",
    topic: context.topic,
    reasonCode,
    missingArtifactRefs: uniqueArtifactRefs(
      refs.length > 0 ? refs : [analysisRef(context, "id")],
    ),
    identity: structuredClone(context.identity),
    evidenceFrame: structuredClone(context.evidenceFrame),
  });
}

function fail(
  reasonCode: FinalizedChatInsufficientReasonCode,
  refs: FinalizedChatArtifactRef[],
): never {
  throw new ProjectionFailure(reasonCode, refs);
}

function uniqueArtifactRefs(
  refs: readonly FinalizedChatArtifactRef[],
): FinalizedChatArtifactRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.artifactType}\u0000${ref.artifactId}\u0000${ref.fieldPath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((ref) => structuredClone(ref));
}

function uniqueSourceRefs(
  refs: readonly FinalizedChatSourceRef[],
): FinalizedChatSourceRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.sourceId}\u0000${ref.sourceRevisionId}\u0000${ref.contentFingerprint}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((ref) => structuredClone(ref));
}

function renderActionKinds(actions: readonly BeliefAction[]): string {
  return actions.map(({ kind, scope, priority, visibility }) =>
    `${kind}{scope=${scope}, priority=${priority}, visibility=${visibility}}`
  ).join(", ");
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
