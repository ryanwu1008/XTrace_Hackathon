import type { ReportEvidenceContext } from "../contracts/evidence-context";
import { APPROVED_PINNED_DEMO_SNAPSHOT_ID } from
  "../contracts/evidence-context";
import type { FrameworkJudgment } from "../contracts/underwriting";
import type {
  DecisionCriticalEvidenceProjection,
  NamedLensCatalogConsideration,
  NamedLensFinalizationDisposition,
  NamedLensPassage,
  NamedLensPresentation,
} from "../contracts/named-lens";
import {
  createDecisionCriticalEvidenceProjectionFingerprint,
  createNamedLensSemanticFingerprints,
} from "./named-lens-presentation";

export const LEGACY_PINNED_23_PRESENTATION_SCHEMA_VERSION =
  "legacy-pinned-23-v1" as const;
export const LEGACY_PRE_PASSAGE_30_PRESENTATION_SCHEMA_VERSION =
  "legacy-pre-passage-30-v1" as const;
export const CURRENT_UNDERWRITING_PRESENTATION_SCHEMA_VERSION =
  "decision-first-named-lens-v1" as const;

export const LEGACY_PRE_PASSAGE_IDENTITIES = [{
  schemaVersion: "framework-judgment-v1",
  settingsFingerprint: "belief-reversal-task12-v1",
  applicationCommit: "task12-local-e2e",
}] as const;

export type UnderwritingPresentationAdapter =
  | {
    kind: "legacy_pinned_23";
    schemaVersion: typeof LEGACY_PINNED_23_PRESENTATION_SCHEMA_VERSION;
  }
  | {
    kind: "legacy_pre_passage_30";
    schemaVersion: typeof LEGACY_PRE_PASSAGE_30_PRESENTATION_SCHEMA_VERSION;
  }
  | {
    kind: "current";
    schemaVersion: typeof CURRENT_UNDERWRITING_PRESENTATION_SCHEMA_VERSION;
  };

export type UnderwritingPresentationIntegrityReason =
  | "identity_mismatch"
  | "unsupported_identity"
  | "mixed_generation"
  | "incomplete_current_identity"
  | "missing_current_presentation"
  | "cross_report_presentation"
  | "current_fingerprint_mismatch"
  | "current_artifact_ownership_mismatch";

export class UnderwritingPresentationIntegrityError extends Error {
  readonly reason: UnderwritingPresentationIntegrityReason;

  constructor(reason: UnderwritingPresentationIntegrityReason) {
    super("Underwriting presentation identity is unavailable or inconsistent.");
    this.name = "UnderwritingPresentationIntegrityError";
    this.reason = reason;
  }
}

interface CandidateVersionIdentity {
  schemaVersion: string;
  settingsFingerprint: string;
  applicationCommit: string;
  frameworkCatalogVersion?: string;
  frameworkCatalogFingerprint?: string;
  frameworkCorpusDigest?: string;
  namedLensSelectionPolicyVersion?: string;
  namedLensPassageSchemaVersion?: string;
  namedLensGeneratorVersion?: string;
  underwritingPresentationSchemaVersion?: string;
  decisionTaxonomyVersion?: string;
  decisionTaxonomyDigest?: string;
  criticalEvidenceProjectionFingerprint?: string;
  finalDispositionsFingerprint?: string;
  presentationFingerprint?: string;
  refreshNonce?: string | null;
}

export interface UnderwritingPresentationIdentityInput {
  report: {
    id: string;
    workspaceId: string;
    evidenceContext?: ReportEvidenceContext;
  };
  requestedDealId: string;
  candidate: {
    id: string;
    workspaceId: string;
    dealId: string;
    artifactSourceCandidateRunId?: string | null;
  };
  bundle: {
    candidateRunId: string;
    sourceCandidateRunId: string;
    workspaceId: string;
    dealId: string;
    versionSnapshot: CandidateVersionIdentity;
    judgments?: readonly FrameworkJudgment[];
    decisionCriticalEvidenceProjection?: DecisionCriticalEvidenceProjection;
    namedLensCatalogConsiderations?: NamedLensCatalogConsideration[];
    namedLensDispositions?: NamedLensFinalizationDisposition[];
    namedLensPassages?: NamedLensPassage[];
    underwritingPresentationReportId?: string;
    namedLensPresentation?: NamedLensPresentation;
  };
}

export function assertCurrentNamedLensPhysicalGraph(input: {
  dispositions: readonly NamedLensFinalizationDisposition[];
  passages: readonly NamedLensPassage[];
}): void {
  const passagesByFingerprint = new Map<string, NamedLensPassage>();
  const passageJudgmentIds = new Set<string>();
  for (const passage of input.passages) {
    if (
      passagesByFingerprint.has(passage.fingerprint)
      || passageJudgmentIds.has(passage.judgmentId)
    ) {
      throw integrity("current_artifact_ownership_mismatch");
    }
    passagesByFingerprint.set(passage.fingerprint, passage);
    passageJudgmentIds.add(passage.judgmentId);
  }

  const referencedPassages = new Set<string>();
  for (const disposition of input.dispositions) {
    const publishable = disposition.disposition === "selected_main"
      || disposition.disposition === "appendix_only";
    if (publishable !== (disposition.passageFingerprint !== null)) {
      throw integrity("current_artifact_ownership_mismatch");
    }
    if (disposition.passageFingerprint === null) continue;
    if (referencedPassages.has(disposition.passageFingerprint)) {
      throw integrity("current_artifact_ownership_mismatch");
    }
    const passage = passagesByFingerprint.get(disposition.passageFingerprint);
    const sameSelectionBasis = passage !== undefined
      && disposition.selectionBasisEvidenceIds.length
        === passage.selectionBasisEvidenceIds.length
      && disposition.selectionBasisEvidenceIds.every(
        (id, index) => id === passage.selectionBasisEvidenceIds[index],
      );
    if (
      !passage
      || disposition.judgmentId === null
      || passage.judgmentId !== disposition.judgmentId
      || passage.frameworkCardId !== disposition.frameworkCardId
      || passage.frameworkVersion !== disposition.frameworkVersion
      || passage.decisionQuestionCode !== disposition.decisionQuestionCode
      || passage.conditionalConclusion.stance !== disposition.stance
      || passage.conditionalConclusion.advisoryPosture
        !== disposition.advisoryPosture
      || !sameSelectionBasis
    ) {
      throw integrity("current_artifact_ownership_mismatch");
    }
    referencedPassages.add(disposition.passageFingerprint);
  }
  if (referencedPassages.size !== passagesByFingerprint.size) {
    throw integrity("current_artifact_ownership_mismatch");
  }
}

export function resolveUnderwritingPresentationAdapter(
  input: UnderwritingPresentationIdentityInput,
): UnderwritingPresentationAdapter {
  assertRequestedIdentity(input);

  const version = input.bundle.versionSnapshot;
  const approvedPinned = input.report.evidenceContext?.state === "current"
    && input.report.evidenceContext.evidenceMode === "pinned"
    && input.report.evidenceContext.snapshotId
      === APPROVED_PINNED_DEMO_SNAPSHOT_ID;
  const legacyPrePassage = LEGACY_PRE_PASSAGE_IDENTITIES.some((identity) =>
    version.schemaVersion === identity.schemaVersion
    && version.settingsFingerprint === identity.settingsFingerprint
    && version.applicationCommit === identity.applicationCommit
  );
  const hasCurrentIdentity = hasAnyCurrentIdentity(input);

  if (approvedPinned) {
    if (hasCurrentIdentity) throw integrity("mixed_generation");
    return {
      kind: "legacy_pinned_23",
      schemaVersion: LEGACY_PINNED_23_PRESENTATION_SCHEMA_VERSION,
    };
  }

  if (legacyPrePassage) {
    if (hasCurrentIdentity) throw integrity("mixed_generation");
    return {
      kind: "legacy_pre_passage_30",
      schemaVersion: LEGACY_PRE_PASSAGE_30_PRESENTATION_SCHEMA_VERSION,
    };
  }

  if (!hasCurrentIdentity) throw integrity("unsupported_identity");
  if (input.report.evidenceContext?.state !== "current") {
    throw integrity("mixed_generation");
  }
  assertCompleteCurrentIdentity(input);
  return {
    kind: "current",
    schemaVersion: CURRENT_UNDERWRITING_PRESENTATION_SCHEMA_VERSION,
  };
}

function assertRequestedIdentity(
  input: UnderwritingPresentationIdentityInput,
): void {
  const expectedSourceCandidateRunId =
    input.candidate.artifactSourceCandidateRunId ?? input.candidate.id;
  if (
    input.report.workspaceId !== input.candidate.workspaceId
    || input.report.workspaceId !== input.bundle.workspaceId
    || input.requestedDealId !== input.candidate.dealId
    || input.requestedDealId !== input.bundle.dealId
    || input.candidate.id !== input.bundle.candidateRunId
    || expectedSourceCandidateRunId !== input.bundle.sourceCandidateRunId
  ) {
    throw integrity("identity_mismatch");
  }
}

const CURRENT_VERSION_FIELDS = [
  "frameworkCatalogVersion",
  "frameworkCatalogFingerprint",
  "frameworkCorpusDigest",
  "namedLensSelectionPolicyVersion",
  "namedLensPassageSchemaVersion",
  "namedLensGeneratorVersion",
  "underwritingPresentationSchemaVersion",
  "decisionTaxonomyVersion",
  "decisionTaxonomyDigest",
  "criticalEvidenceProjectionFingerprint",
  "finalDispositionsFingerprint",
  "presentationFingerprint",
  "refreshNonce",
] as const;

const CURRENT_EXCLUSIVE_VERSION_FIELDS = [
  "namedLensSelectionPolicyVersion",
  "namedLensPassageSchemaVersion",
  "namedLensGeneratorVersion",
  "underwritingPresentationSchemaVersion",
  "decisionTaxonomyVersion",
  "decisionTaxonomyDigest",
  "criticalEvidenceProjectionFingerprint",
  "finalDispositionsFingerprint",
  "presentationFingerprint",
  "refreshNonce",
] as const;

function hasAnyCurrentIdentity(
  input: UnderwritingPresentationIdentityInput,
): boolean {
  const version = input.bundle.versionSnapshot;
  return CURRENT_EXCLUSIVE_VERSION_FIELDS.some((field) => field in version)
    || input.bundle.decisionCriticalEvidenceProjection !== undefined
    || input.bundle.namedLensCatalogConsiderations !== undefined
    || input.bundle.namedLensDispositions !== undefined
    || input.bundle.namedLensPassages !== undefined
    || input.bundle.underwritingPresentationReportId !== undefined
    || input.bundle.namedLensPresentation !== undefined;
}

function assertCompleteCurrentIdentity(
  input: UnderwritingPresentationIdentityInput,
): void {
  const version = input.bundle.versionSnapshot;
  if (
    CURRENT_VERSION_FIELDS.some((field) => !(field in version))
    || input.bundle.judgments === undefined
    || version.underwritingPresentationSchemaVersion
      !== CURRENT_UNDERWRITING_PRESENTATION_SCHEMA_VERSION
    || version.namedLensSelectionPolicyVersion !== "named-lens-selection-v1"
    || version.namedLensPassageSchemaVersion !== "named-lens-passage-v1"
    || version.decisionTaxonomyVersion
      !== "named-lens-decision-taxonomy-v1"
    || !version.namedLensGeneratorVersion
    || !version.frameworkCatalogVersion
    || !version.frameworkCatalogFingerprint
    || !version.frameworkCorpusDigest
    || !version.decisionTaxonomyDigest
    || !version.criticalEvidenceProjectionFingerprint
    || !version.finalDispositionsFingerprint
    || !version.presentationFingerprint
    || (
      typeof version.refreshNonce !== "string"
      && version.refreshNonce !== null
    )
  ) {
    throw integrity("incomplete_current_identity");
  }
  if (!input.bundle.namedLensPresentation) {
    throw integrity("missing_current_presentation");
  }
  if (!input.bundle.underwritingPresentationReportId) {
    throw integrity("incomplete_current_identity");
  }
  if (
    input.bundle.underwritingPresentationReportId !== input.report.id
  ) {
    throw integrity("cross_report_presentation");
  }
  const presentation = input.bundle.namedLensPresentation;
  if (
    presentation.schemaVersion
      !== CURRENT_UNDERWRITING_PRESENTATION_SCHEMA_VERSION
  ) {
    throw integrity("mixed_generation");
  }
  if (
    presentation.fingerprint !== version.presentationFingerprint
  ) {
    throw integrity("current_fingerprint_mismatch");
  }

  const projection = input.bundle.decisionCriticalEvidenceProjection;
  const dispositions = input.bundle.namedLensDispositions;
  const passages = input.bundle.namedLensPassages;
  if (!projection || !dispositions || !passages) {
    throw integrity("incomplete_current_identity");
  }
  assertCurrentNamedLensPhysicalGraph({ dispositions, passages });
  const recomputedProjectionFingerprint =
    createDecisionCriticalEvidenceProjectionFingerprint(
      projection.evidenceRefs,
      input.bundle.judgments,
    );
  const presentationPayload: Omit<typeof presentation, "fingerprint"> = {
    schemaVersion: presentation.schemaVersion,
    rendererVersion: presentation.rendererVersion,
    workspaceId: presentation.workspaceId,
    artifactSourceCandidateRunId: presentation.artifactSourceCandidateRunId,
    synthesis: presentation.synthesis,
    segmentCitations: presentation.segmentCitations,
    firstScreenProjectionRefs: presentation.firstScreenProjectionRefs,
  };
  const semanticFingerprints = createNamedLensSemanticFingerprints({
    evidenceRefs: projection.evidenceRefs,
    dispositions,
    passages,
    presentation: presentationPayload,
    formalJudgments: input.bundle.judgments,
  });
  if (
    projection.fingerprint !== recomputedProjectionFingerprint
    || version.criticalEvidenceProjectionFingerprint
      !== recomputedProjectionFingerprint
    || version.finalDispositionsFingerprint
      !== semanticFingerprints.finalDispositionsFingerprint
    || presentation.fingerprint
      !== semanticFingerprints.presentationFingerprint
  ) {
    throw integrity("current_fingerprint_mismatch");
  }

  const sourceCandidateRunId = input.bundle.sourceCandidateRunId;
  const ownedArtifacts: Array<{
    workspaceId: string;
    artifactSourceCandidateRunId: string;
  }> = [
    presentation,
    ...(input.bundle.decisionCriticalEvidenceProjection
      ? [input.bundle.decisionCriticalEvidenceProjection]
      : []),
    ...(input.bundle.namedLensCatalogConsiderations ?? []),
    ...(input.bundle.namedLensDispositions ?? []),
    ...(input.bundle.namedLensPassages ?? []),
  ];
  if (
    input.bundle.decisionCriticalEvidenceProjection === undefined
    || input.bundle.namedLensCatalogConsiderations === undefined
    || input.bundle.namedLensDispositions === undefined
    || input.bundle.namedLensPassages === undefined
  ) {
    throw integrity("incomplete_current_identity");
  }
  if (ownedArtifacts.some((artifact) =>
    artifact.workspaceId !== input.report.workspaceId
    || artifact.artifactSourceCandidateRunId !== sourceCandidateRunId
  )) {
    throw integrity("current_artifact_ownership_mismatch");
  }
}

function integrity(
  reason: UnderwritingPresentationIntegrityReason,
): UnderwritingPresentationIntegrityError {
  return new UnderwritingPresentationIntegrityError(reason);
}
