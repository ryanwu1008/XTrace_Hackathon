import {
  CandidateVersionSnapshotSchema,
  type CandidateArtifactBundle,
  type CandidateVersionSnapshot,
  type CurrentCandidateArtifactBundle,
  type UnderwritingArtifactsRepository,
} from "../../db/repositories/underwriting-artifacts";
import type {
  UnderwritingRunsRepository,
} from "../../db/repositories/underwriting-runs";
import type {
  ClaimEdge,
  Fact,
} from "../contracts/evidence";
import type {
  ActionDraft,
  ActionDraftV2,
  CandidateRun,
  FrameworkJudgment,
  LegacyPinnedUnderwritingSelection,
  MissingEvidenceItem,
  UnderwritingBatch,
  UnderwritingQueueEntry,
  UnderwritingQueueStatus,
} from "../contracts/underwriting";
import { UnderwritingQueueEntrySchema } from "../contracts/underwriting";
import { APPROVED_PINNED_DEMO_SNAPSHOT_ID } from "../contracts/evidence-context";
import { evidenceQueryTokens } from "../demo/search";
import { safeExternalHttpUrl } from "../security/safe-url";
import { buildUnderwritingNarrative } from "./narrative";
import {
  publicFrameworkLimitations,
  renderPublicAdvisorySections,
  sanitizeLegacyPublicActionDraftBody,
} from "./public-advisory-rendering";
import {
  assertCurrentNamedLensPhysicalGraph,
  UnderwritingPresentationIntegrityError,
  resolveUnderwritingPresentationAdapter,
  type UnderwritingPresentationAdapter,
  type UnderwritingPresentationIdentityInput,
} from "./presentation-version";

export interface DealUnderwritingQueueView extends UnderwritingQueueEntry {
  decision: CandidateArtifactBundle["decision"]["decision"];
}

export interface UnderwritingStatusCounts {
  queued: number;
  running: number;
  completed: number;
  partial: number;
  failed: number;
}

export interface LegacyPinnedUnderwritingPriorityEntry {
  batchId: string;
  dealId: string;
  historicalPriorityOrder: number | null;
  historicalAdmissionStatus:
    | "historically_admitted"
    | "historically_not_admitted";
  historicalReason: string;
}

export interface LegacyPinnedUnderwritingPriorityOrder {
  adapter: "legacy-pinned-priority-order-v1";
  snapshotId: typeof APPROVED_PINNED_DEMO_SNAPSHOT_ID;
  entries: LegacyPinnedUnderwritingPriorityEntry[];
}

export interface UnderwritingBatchSummary {
  batchId: string;
  status: UnderwritingBatch["status"];
  queue: DealUnderwritingQueueView[];
  underwritingStatusCounts: UnderwritingStatusCounts;
  legacyPinnedPriorityOrder?: LegacyPinnedUnderwritingPriorityOrder;
}

export interface PublicActionDraft {
  id: string;
  candidateRunId: string;
  schemaVersion: "action-draft-v2" | "legacy-action-draft-v1";
  safety: "status_safe" | "legacy_unclassified";
  deliveryMode: "draft_only";
  draftPolicyVersion: string | null;
  actionPolicyVersion: string | null;
  dealStatus: ActionDraftV2["dealStatus"] | null;
  beliefDirection: ActionDraftV2["beliefDirection"] | null;
  actions: ActionDraftV2["actions"];
  missingEvidence: MissingEvidenceItem[];
  format: ActionDraftV2["format"] | null;
  channel: ActionDraft["channel"];
  audienceType: ActionDraft["audienceType"];
  body: string;
  createdAt: string;
  updatedAt: string;
}

export const PublicCandidateVersionSnapshotSchema =
  CandidateVersionSnapshotSchema;
export type PublicCandidateVersionSnapshot = CandidateVersionSnapshot;

export interface UnderwritingSearchResult {
  itemId: string;
  candidateRunId: string;
  dealId: string;
  analysisType:
    | "fact"
    | "assumption"
    | "calculation"
    | "framework_judgment"
    | "final_synthesis";
  text: string;
  inputRefIds: string[];
  sourceRevisionIds: string[];
  claimEdges: ClaimEdge[];
}

function queueStatusForCandidate(
  status: CandidateRun["status"],
): UnderwritingQueueStatus {
  return status === "unavailable" ? "failed" : status;
}

function queueReason(input: {
  candidateStatus: CandidateRun["status"];
  persistedReason: string;
}): string | undefined {
  if (input.candidateStatus === "unavailable") {
    return `Deep Underwriting inputs were unavailable. ${input.persistedReason}`;
  }
  return input.candidateStatus === "partial"
      || input.candidateStatus === "failed"
    ? input.persistedReason
    : undefined;
}

export function adaptCurrentUnderwritingQueueEntries(input: {
  batchId: string;
  selections: readonly LegacyPinnedUnderwritingSelection[];
  candidates: readonly CandidateRun[];
}): UnderwritingQueueEntry[] {
  const candidatesByDeal = new Map<string, CandidateRun>();
  for (const candidate of input.candidates) {
    if (
      candidate.batchId !== input.batchId
      || candidatesByDeal.has(candidate.dealId)
    ) {
      throw new Error(
        "Underwriting queue candidate identity is duplicated or crosses its batch.",
      );
    }
    candidatesByDeal.set(candidate.dealId, candidate);
  }
  const admittedDeals = new Set(
    input.selections
      .filter(({ status }) => status === "selected")
      .map(({ dealId }) => dealId),
  );
  if (input.candidates.some(({ dealId }) => !admittedDeals.has(dealId))) {
    throw new Error(
      "An underwriting job cannot exist without an admitted belief revision.",
    );
  }

  return input.selections
    .flatMap((selection): UnderwritingQueueEntry[] => {
      if (selection.status !== "selected") return [];
      const candidate = candidatesByDeal.get(selection.dealId);
      if (!candidate || selection.rank === null) {
        throw new Error(
          "An admitted belief revision is missing its immutable underwriting job or priority order.",
        );
      }
      return [UnderwritingQueueEntrySchema.parse({
        batchId: input.batchId,
        dealId: selection.dealId,
        priorityRank: selection.rank,
        status: queueStatusForCandidate(candidate.status),
        candidateRunId: candidate.id,
        ...(queueReason({
          candidateStatus: candidate.status,
          persistedReason: selection.reason,
        })
          ? {
            reason: queueReason({
              candidateStatus: candidate.status,
              persistedReason: selection.reason,
            }),
          }
          : {}),
      })];
    })
    .sort((left, right) =>
      left.priorityRank - right.priorityRank
      || left.dealId.localeCompare(right.dealId)
    );
}

export function adaptLegacyPinnedUnderwritingSelections(input: {
  snapshotId: string;
  selections: readonly LegacyPinnedUnderwritingSelection[];
}): LegacyPinnedUnderwritingPriorityOrder {
  if (input.snapshotId !== APPROVED_PINNED_DEMO_SNAPSHOT_ID) {
    throw new Error(
      "The legacy underwriting priority adapter is restricted to the approved pinned report.",
    );
  }
  return {
    adapter: "legacy-pinned-priority-order-v1",
    snapshotId: APPROVED_PINNED_DEMO_SNAPSHOT_ID,
    entries: input.selections
      .map((selection) => ({
        batchId: selection.batchId,
        dealId: selection.dealId,
        historicalPriorityOrder: selection.rank,
        historicalAdmissionStatus: selection.status === "selected"
          ? "historically_admitted" as const
          : "historically_not_admitted" as const,
        historicalReason: selection.reason,
      }))
      .sort((left, right) =>
        (left.historicalPriorityOrder ?? Number.MAX_SAFE_INTEGER)
          - (right.historicalPriorityOrder ?? Number.MAX_SAFE_INTEGER)
        || left.dealId.localeCompare(right.dealId)
      ),
  };
}

export function underwritingStatusCounts(
  queue: readonly Pick<UnderwritingQueueEntry, "status">[],
): UnderwritingStatusCounts {
  return {
    queued: queue.filter(({ status }) => status === "queued").length,
    running: queue.filter(({ status }) => status === "running").length,
    completed: queue.filter(({ status }) => status === "completed").length,
    partial: queue.filter(({ status }) => status === "partial").length,
    failed: queue.filter(({ status }) => status === "failed").length,
  };
}

export async function buildUnderwritingBatchSummary(input: {
  workspaceId: string;
  scanRunId: string;
  runs: UnderwritingRunsRepository;
  artifacts: UnderwritingArtifactsRepository;
  legacyPinnedSnapshotId?: string | null;
}): Promise<UnderwritingBatchSummary | null> {
  const batch = await input.runs.getBatchByScanRunId({
    workspaceId: input.workspaceId,
    scanRunId: input.scanRunId,
  });
  if (!batch) return null;
  if (
    batch.workspaceId !== input.workspaceId
    || batch.scanRunId !== input.scanRunId
  ) {
    throw new Error(
      "Underwriting batch identity does not match the requested current report run.",
    );
  }
  const [selections, candidates] = await Promise.all([
    input.runs.listSelectionsForBatch({
      workspaceId: input.workspaceId,
      batchId: batch.id,
    }),
    input.runs.listCandidatesForBatch({
      workspaceId: input.workspaceId,
      batchId: batch.id,
    }),
  ]);
  const decisions = new Map<string, CandidateArtifactBundle["decision"]["decision"]>();
  await Promise.all(candidates.map(async (candidate) => {
    if (!["completed", "partial"].includes(candidate.status)) return;
    const bundle = await input.artifacts.getByCandidateRunId({
      workspaceId: input.workspaceId,
      candidateRunId: candidate.id,
    });
    if (bundle) decisions.set(candidate.id, bundle.decision.decision);
  }));
  const queueEntries = adaptCurrentUnderwritingQueueEntries({
    batchId: batch.id,
    selections,
    candidates,
  });
  const queue = queueEntries.map((entry): DealUnderwritingQueueView => ({
    ...entry,
    decision: decisions.get(entry.candidateRunId) ?? null,
  }));
  return {
    batchId: batch.id,
    status: batch.status,
    queue,
    underwritingStatusCounts: underwritingStatusCounts(queue),
    ...(input.legacyPinnedSnapshotId
      ? {
        legacyPinnedPriorityOrder: adaptLegacyPinnedUnderwritingSelections({
          snapshotId: input.legacyPinnedSnapshotId,
          selections,
        }),
      }
      : {}),
  };
}

export async function findCandidateForReportDeal(input: {
  workspaceId: string;
  scanRunId: string;
  dealId: string;
  runs: UnderwritingRunsRepository;
}): Promise<CandidateRun | null> {
  const batch = await input.runs.getBatchByScanRunId({
    workspaceId: input.workspaceId,
    scanRunId: input.scanRunId,
  });
  if (!batch) return null;
  const candidates = await input.runs.listCandidatesForBatch({
    workspaceId: input.workspaceId,
    batchId: batch.id,
  });
  const matches = candidates.filter((candidate) =>
    candidate.dealId === input.dealId
  );
  if (matches.length > 1) {
    throw new Error("A Deal has more than one underwriting job in the batch.");
  }
  return matches[0] ?? null;
}

export function toCandidateUnderwritingDetail(
  bundle: CandidateArtifactBundle,
) {
  return {
    ...candidateDetailBase(bundle),
    judgments: bundle.judgments.map(toPublicFrameworkJudgment),
    disagreements: structuredClone(bundle.disagreements),
    narrative: publicNarrativeForBundle(bundle),
  };
}

function candidateDetailBase(bundle: CandidateArtifactBundle) {
  return {
    candidateRunId: bundle.candidateRunId,
    dealId: bundle.dealId,
    evidencePack: {
      asOfDate: bundle.evidencePack.asOfDate,
      sourceRevisionIds: [...bundle.evidencePack.sourceRevisionIds],
      facts: bundle.evidencePack.facts.map((fact) => ({
        id: fact.id,
        field: fact.field,
        value: fact.value,
        unit: fact.unit,
        currency: fact.currency,
        publishedAt: fact.publishedAt,
        eventAt: fact.eventAt,
        retrievedAt: fact.retrievedAt,
        sourceRevisionId: fact.sourceRevisionId,
        sourceAction: publicFactSourceAction(fact),
        provenanceOrigin: fact.provenanceOrigin,
        sourceRole: fact.sourceRole,
        assertionStatus: fact.assertionStatus,
        freshness: fact.freshness,
        acceptedForGate: fact.acceptedForGate,
      })),
      assumptions: bundle.evidencePack.assumptions.map((assumption) => ({
        id: assumption.id,
        field: assumption.field,
        value: assumption.value,
        unit: assumption.unit,
        scenario: assumption.scenario,
        rationale: assumption.rationale,
        inputRefIds: [...assumption.inputRefIds],
        provenanceOrigin: assumption.provenanceOrigin,
        sensitivity: assumption.sensitivity,
        requiresConfirmation: assumption.requiresConfirmation,
      })),
      conflicts: structuredClone(bundle.evidencePack.conflicts),
      coverage: structuredClone(bundle.evidencePack.coverage),
    },
    context: {
      contextVersion: bundle.context.contextVersion,
      stage: bundle.context.stage,
      businessModel: bundle.context.businessModel,
      geography: bundle.context.geography,
      securityType: bundle.context.securityType,
      asOfDate: bundle.context.asOfDate,
      benchmarkCompatibility: bundle.context.benchmarkCompatibility,
    },
    scenarioModel: structuredClone(bundle.scenarioModel),
    calculations: bundle.calculations.map((calculation) => ({
      id: calculation.id,
      formulaId: calculation.formulaId,
      formulaVersion: calculation.formulaVersion,
      inputRefs: calculation.inputRefs.map((reference) => ({
        itemId: reference.itemId,
        type: reference.type,
      })),
      output: calculation.output,
      unit: calculation.unit,
      currency: calculation.currency,
      status: calculation.status,
    })),
    valuation: {
      status: bundle.valuation.status,
      scenarios: structuredClone(bundle.valuation.scenarios),
      currentAsk: bundle.valuation.currentAsk,
      maximumAcceptablePreMoney:
        bundle.valuation.maximumAcceptablePreMoney,
      initialOwnership: bundle.valuation.initialOwnership,
      postDilutionOwnership: bundle.valuation.postDilutionOwnership,
      grossMoic: bundle.valuation.grossMoic,
      grossIrr: bundle.valuation.grossIrr,
      pricingPremium: bundle.valuation.pricingPremium,
      calculationIds: [...bundle.valuation.calculationIds],
      blockerCodes: [...bundle.valuation.blockerCodes],
    },
    decision: {
      id: bundle.decision.id,
      companyQuality: bundle.decision.companyQuality,
      priceAttractiveness: bundle.decision.priceAttractiveness,
      fundFit: bundle.decision.fundFit,
      decision: bundle.decision.decision,
      decisionCeiling: bundle.decision.decisionCeiling,
      hardVeto: bundle.decision.hardVeto,
      firedRules: structuredClone(bundle.decision.firedRules),
      blockingEvidenceItemIds: [
        ...bundle.decision.blockingEvidenceItemIds,
      ],
      confidence: bundle.decision.confidence,
    },
    claimEdges: structuredClone(bundle.claimEdges),
    sourceRevisionIds: [...bundle.evidencePack.sourceRevisionIds],
    versionSnapshot: toPublicVersionSnapshot(bundle.versionSnapshot),
  };
}

export function toVersionedCandidateUnderwritingDetail(input: {
  bundle: CandidateArtifactBundle;
  adapter: UnderwritingPresentationAdapter;
}) {
  if (input.adapter.kind !== "current") {
    return {
      ...toCandidateUnderwritingDetail(input.bundle),
      presentationAdapter: input.adapter,
    };
  }
  const bundle = requireCurrentCandidateBundle(input.bundle);
  return {
    ...candidateDetailBase(bundle),
    sourceCandidateRunId: bundle.sourceCandidateRunId,
    presentationAdapter: input.adapter,
    judgments: [],
    disagreements: [],
    narrative: bundle.namedLensPresentation.synthesis.text,
    namedLensPresentation: currentNamedLensDetail(bundle),
    auditAppendix: {
      judgments: bundle.judgments.map(toCurrentAuditFrameworkJudgment),
      disagreements: structuredClone(bundle.disagreements),
      catalogConsiderations: structuredClone(
        bundle.namedLensCatalogConsiderations,
      ),
      providerAttemptRefs: structuredClone(bundle.namedLensAttemptRefs),
      providerAttempts: structuredClone(bundle.namedLensProviderAttempts),
    },
  };
}

export type VersionedCandidateUnderwritingDetail = ReturnType<
  typeof toVersionedCandidateUnderwritingDetail
>;

function requireCurrentCandidateBundle(
  bundle: CandidateArtifactBundle,
): CurrentCandidateArtifactBundle {
  if (
    bundle.decisionCriticalEvidenceProjection === undefined
    || bundle.namedLensCatalogConsiderations === undefined
    || bundle.namedLensAttemptRefs === undefined
    || bundle.namedLensProviderAttempts === undefined
    || bundle.namedLensDispositions === undefined
    || bundle.namedLensPassages === undefined
    || bundle.underwritingPresentationReportId === undefined
    || bundle.namedLensPresentation === undefined
    || bundle.terminalStatus === undefined
    || bundle.terminalReasonCodes === undefined
  ) {
    throw new UnderwritingPresentationIntegrityError(
      "incomplete_current_identity",
    );
  }
  return bundle as CurrentCandidateArtifactBundle;
}

function currentNamedLensDetail(bundle: CurrentCandidateArtifactBundle) {
  const passagesByFingerprint = indexCurrentNamedLensPassages(bundle);
  const selected = bundle.namedLensDispositions
    .filter(({ disposition }) => disposition === "selected_main")
    .sort((left, right) => left.selectedPosition! - right.selectedPosition!);
  const appendix = bundle.namedLensDispositions
    .filter(({ disposition }) => disposition === "appendix_only");
  const projectPassage = (
    disposition: CurrentCandidateArtifactBundle["namedLensDispositions"][number],
  ) => {
    const passage = exactPassageForDisposition({
      disposition,
      passagesByFingerprint,
    });
    const publicIdentity = publicNamedLensIdentity({ bundle, passage });
    return {
      selectedPosition: disposition.selectedPosition,
      disposition: structuredClone(disposition),
      displayIdentity: publicIdentity.displayIdentity,
      passage: structuredClone(passage),
      segmentCitations: bundle.namedLensPresentation.segmentCitations
        .filter(({ judgmentId }) => judgmentId === passage.judgmentId)
        .map((citation) => structuredClone(citation)),
      publicPremiseSources: publicIdentity.publicPremiseSources,
    };
  };

  return {
    reportId: bundle.underwritingPresentationReportId,
    schemaVersion: bundle.namedLensPresentation.schemaVersion,
    rendererVersion: bundle.namedLensPresentation.rendererVersion,
    fingerprint: bundle.namedLensPresentation.fingerprint,
    terminalStatus: bundle.terminalStatus,
    terminalReasonCodes: [...bundle.terminalReasonCodes],
    versionIdentity: {
      decisionTaxonomyVersion:
        bundle.versionSnapshot.decisionTaxonomyVersion,
      decisionTaxonomyDigest:
        bundle.versionSnapshot.decisionTaxonomyDigest,
      selectionPolicyVersion:
        bundle.versionSnapshot.namedLensSelectionPolicyVersion,
      passageSchemaVersion:
        bundle.versionSnapshot.namedLensPassageSchemaVersion,
      generatorVersion: bundle.versionSnapshot.namedLensGeneratorVersion,
      criticalEvidenceProjectionFingerprint:
        bundle.versionSnapshot.criticalEvidenceProjectionFingerprint,
      finalDispositionsFingerprint:
        bundle.versionSnapshot.finalDispositionsFingerprint,
      presentationFingerprint:
        bundle.versionSnapshot.presentationFingerprint,
      refreshNonce: bundle.versionSnapshot.refreshNonce,
    },
    decisionCriticalEvidenceProjection: structuredClone(
      bundle.decisionCriticalEvidenceProjection,
    ),
    dispositions: structuredClone(bundle.namedLensDispositions),
    selectedPassages: selected.map(projectPassage),
    appendixPassages: appendix.map(projectPassage),
    withheldDispositions: bundle.namedLensDispositions
      .filter(({ disposition }) =>
        disposition !== "selected_main" && disposition !== "appendix_only"
      )
      .map((disposition) => structuredClone(disposition)),
    synthesis: structuredClone(bundle.namedLensPresentation.synthesis),
    segmentCitations: structuredClone(
      bundle.namedLensPresentation.segmentCitations,
    ),
    firstScreenProjectionRefs: structuredClone(
      bundle.namedLensPresentation.firstScreenProjectionRefs,
    ),
  };
}

function indexCurrentNamedLensPassages(
  bundle: CurrentCandidateArtifactBundle,
) {
  assertCurrentNamedLensPhysicalGraph({
    dispositions: bundle.namedLensDispositions,
    passages: bundle.namedLensPassages,
  });
  const passagesByFingerprint = new Map<
    string,
    CurrentCandidateArtifactBundle["namedLensPassages"][number]
  >();
  for (const passage of bundle.namedLensPassages) {
    passagesByFingerprint.set(passage.fingerprint, passage);
  }
  return passagesByFingerprint;
}

function exactPassageForDisposition(input: {
  disposition:
    CurrentCandidateArtifactBundle["namedLensDispositions"][number];
  passagesByFingerprint: Map<
    string,
    CurrentCandidateArtifactBundle["namedLensPassages"][number]
  >;
}) {
  const { disposition } = input;
  const passage = disposition.passageFingerprint === null
    ? null
    : input.passagesByFingerprint.get(disposition.passageFingerprint);
  const sameSelectionBasis = passage !== null
    && passage !== undefined
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
    throw new UnderwritingPresentationIntegrityError(
      "current_artifact_ownership_mismatch",
    );
  }
  return passage;
}

function publicNamedLensIdentity(input: {
  bundle: CurrentCandidateArtifactBundle;
  passage: CurrentCandidateArtifactBundle["namedLensPassages"][number];
}) {
  const matchingJudgments = input.bundle.judgments.filter(({ id }) =>
    id === input.passage.judgmentId
  );
  const judgment = matchingJudgments[0];
  const matchingComponents = judgment?.frameworkMetadata?.components.filter(
    ({ frameworkId }) =>
      frameworkId === input.passage.premise.componentFrameworkId,
  ) ?? [];
  const component = matchingComponents[0];
  if (
    matchingJudgments.length !== 1
    || matchingComponents.length !== 1
    || !judgment?.frameworkMetadata
    || !component
  ) {
    throw new UnderwritingPresentationIntegrityError(
      "current_artifact_ownership_mismatch",
    );
  }
  const sources = input.passage.premise.publicSourceIds.map((sourceId) => {
    const matches = judgment.frameworkMetadata!.sources.filter((source) =>
      source.sourceId === sourceId
    );
    const source = matches[0];
    const url = source ? safeExternalHttpUrl(source.url) : null;
    if (matches.length !== 1 || !source || !url) {
      throw new UnderwritingPresentationIntegrityError(
        "current_artifact_ownership_mismatch",
      );
    }
    return {
      sourceId: source.sourceId,
      title: source.title,
      publisher: source.publisher,
      url,
    };
  });
  return {
    displayIdentity: {
      judgmentId: judgment.id,
      componentFrameworkId: component.frameworkId,
      displayName: component.name,
      attributionDisplay: component.attribution.display,
    },
    publicPremiseSources: sources,
  };
}

export type PublicFactSourceAction =
  | {
    kind: "original_public_source";
    url: string;
  }
  | {
    kind: "stored_source_revision";
    page: number | null;
  };

function publicFactSourceAction(fact: Fact): PublicFactSourceAction {
  if (
    fact.provenanceOrigin === "public_source"
    && fact.locator.kind === "web_snapshot"
  ) {
    const url = safeExternalHttpUrl(fact.locator.url);
    if (url) return { kind: "original_public_source", url };
  }
  return {
    kind: "stored_source_revision",
    page: fact.locator.kind === "pdf_page" ? fact.locator.page : null,
  };
}

export type CandidateUnderwritingDetail = ReturnType<
  typeof toCandidateUnderwritingDetail
>;

function toPublicFrameworkJudgment(
  judgment: CandidateArtifactBundle["judgments"][number],
) {
  return {
    id: judgment.id,
    frameworkCardId: judgment.frameworkCardId,
    frameworkVersion: judgment.frameworkVersion,
    applicability: judgment.applicability,
    conclusion: judgment.conclusion,
    strongestSupport: judgment.strongestSupport,
    strongestCounterargument: judgment.strongestCounterargument,
    supportEvidenceItemIds: [...judgment.supportEvidenceItemIds],
    counterEvidenceItemIds: [...judgment.counterEvidenceItemIds],
    unknowns: [...judgment.unknowns],
    limitations: publicFrameworkLimitations(judgment),
    confidence: {
      sourceReliability: judgment.confidence.sourceReliability,
      evidenceStrength: judgment.confidence.evidenceStrength,
      evidenceCoverage: judgment.confidence.evidenceCoverage,
      applicability: judgment.confidence.applicability,
      judgment: judgment.confidence.judgment,
    },
    ...(judgment.frameworkMetadata
      ? {
        frameworkMetadata: {
          packId: judgment.frameworkMetadata.packId,
          packName: judgment.frameworkMetadata.packName,
          packVersion: judgment.frameworkMetadata.packVersion,
          sourceCatalogId: judgment.frameworkMetadata.sourceCatalogId,
          researchCutoff: judgment.frameworkMetadata.researchCutoff,
          components: judgment.frameworkMetadata.components.map(
            (component) => ({
              frameworkId: component.frameworkId,
              version: component.version,
              name: component.name,
              attribution: {
                display: component.attribution.display,
              },
              sourceRefs: component.sourceRefs.map((reference) => ({
                sourceId: reference.sourceId,
                claimIds: [...reference.claimIds],
                locator: {
                  kind: reference.locator.kind,
                  value: reference.locator.value,
                },
                attributionScope: reference.attributionScope,
                supportType: reference.supportType,
              })),
            }),
          ),
          sources: judgment.frameworkMetadata.sources.map((source) => ({
            sourceId: source.sourceId,
            title: source.title,
            authorOrSpeaker: [...source.authorOrSpeaker],
            publisher: source.publisher,
            sourceClass: source.sourceClass,
            sourceType: source.sourceType,
            url: source.url,
            edition: source.edition,
            publishedAt: source.publishedAt,
            eventAt: source.eventAt,
            accessedAt: source.accessedAt,
            language: source.language,
            rightsStatus: source.rightsStatus,
            attributionScope: source.attributionScope,
            attributionNotes: source.attributionNotes,
            immutableRevision: {
              status: source.immutableRevision.status,
              hashAlgorithm: source.immutableRevision.hashAlgorithm,
              contentHash: source.immutableRevision.contentHash,
              ...(source.immutableRevision.reviewedPdfPages
                ? {
                  reviewedPdfPages: [
                    ...source.immutableRevision.reviewedPdfPages,
                  ],
                }
                : {}),
              ...(source.immutableRevision.reviewedTimestampRanges
                ? {
                  reviewedTimestampRanges: [
                    ...source.immutableRevision.reviewedTimestampRanges,
                  ],
                }
                : {}),
              ...(source.immutableRevision.videoId
                ? { videoId: source.immutableRevision.videoId }
                : {}),
            },
          })),
          formalDecisionWeight:
            judgment.frameworkMetadata.formalDecisionWeight,
        },
      }
      : {}),
  };
}

function toCurrentAuditFrameworkJudgment(
  judgment: CandidateArtifactBundle["judgments"][number],
) {
  return {
    id: judgment.id,
    frameworkCardId: judgment.frameworkCardId,
    frameworkVersion: judgment.frameworkVersion,
    applicability: judgment.applicability,
    conclusion: judgment.conclusion,
    strongestSupport: judgment.strongestSupport,
    strongestCounterargument: judgment.strongestCounterargument,
    supportEvidenceItemIds: [...judgment.supportEvidenceItemIds],
    counterEvidenceItemIds: [...judgment.counterEvidenceItemIds],
    unknowns: [...judgment.unknowns],
    limitations: publicFrameworkLimitations(judgment),
    confidence: structuredClone(judgment.confidence),
    ...(judgment.frameworkMetadata
      ? {
        frameworkMetadata: {
          packId: judgment.frameworkMetadata.packId,
          packName: judgment.frameworkMetadata.packName,
          packVersion: judgment.frameworkMetadata.packVersion,
          sourceCatalogId: judgment.frameworkMetadata.sourceCatalogId,
          researchCutoff: judgment.frameworkMetadata.researchCutoff,
          components: judgment.frameworkMetadata.components.map(
            (component) => ({
              frameworkId: component.frameworkId,
              version: component.version,
              name: component.name,
              attribution: {
                display: component.attribution.display,
              },
              sourceRefs: component.sourceRefs.map((reference) => ({
                sourceId: reference.sourceId,
                claimIds: [...reference.claimIds],
                locator: structuredClone(reference.locator),
                attributionScope: reference.attributionScope,
                supportType: reference.supportType,
              })),
            }),
          ),
          sources: judgment.frameworkMetadata.sources.flatMap((source) => {
            const url = safeExternalHttpUrl(source.url);
            return url
              ? [{
                sourceId: source.sourceId,
                title: source.title,
                authorOrSpeaker: [...source.authorOrSpeaker],
                publisher: source.publisher,
                sourceClass: source.sourceClass,
                sourceType: source.sourceType,
                url,
                edition: source.edition,
                publishedAt: source.publishedAt,
                eventAt: source.eventAt,
                accessedAt: source.accessedAt,
                language: source.language,
                attributionScope: source.attributionScope,
                immutableRevision: structuredClone(source.immutableRevision),
              }]
              : [];
          }),
          formalDecisionWeight:
            judgment.frameworkMetadata.formalDecisionWeight,
        },
      }
      : {}),
  };
}

function publicNarrativeForBundle(bundle: CandidateArtifactBundle): string {
  const formalNarrative = buildUnderwritingNarrative({
    facts: bundle.evidencePack.facts,
    assumptions: bundle.evidencePack.assumptions,
    calculations: bundle.calculations,
    judgments: bundle.judgments.map(withoutFrameworkAuthoring),
    disagreements: bundle.disagreements,
    decision: bundle.decision,
  });
  const advisorySections = renderPublicAdvisorySections({
    judgments: bundle.judgments,
    disagreements: bundle.disagreements,
  });
  return advisorySections.length === 0
    ? formalNarrative
    : `${formalNarrative}\n\n${advisorySections}`;
}

function withoutFrameworkAuthoring(
  judgment: CandidateArtifactBundle["judgments"][number],
): FrameworkJudgment {
  return {
    id: judgment.id,
    analysisType: judgment.analysisType,
    frameworkCardId: judgment.frameworkCardId,
    frameworkVersion: judgment.frameworkVersion,
    applicability: judgment.applicability,
    conclusion: judgment.conclusion,
    supportEvidenceItemIds: [...judgment.supportEvidenceItemIds],
    counterEvidenceItemIds: [...judgment.counterEvidenceItemIds],
    unusedEvidenceItemIds: [...judgment.unusedEvidenceItemIds],
    strongestSupport: judgment.strongestSupport,
    strongestCounterargument: judgment.strongestCounterargument,
    unknowns: [...judgment.unknowns],
    limitations: publicFrameworkLimitations(judgment),
    confidence: structuredClone(judgment.confidence),
    claimEdges: structuredClone(judgment.claimEdges),
    fingerprint: judgment.fingerprint,
  };
}

export function toPublicActionDraft(
  draft: ActionDraft,
): PublicActionDraft {
  const v2 = "schemaVersion" in draft ? draft : null;
  return {
    id: draft.id,
    candidateRunId: draft.candidateRunId,
    schemaVersion: v2?.schemaVersion ?? "legacy-action-draft-v1",
    safety: v2?.safety ?? "legacy_unclassified",
    deliveryMode: "draft_only",
    draftPolicyVersion: v2?.draftPolicyVersion ?? null,
    actionPolicyVersion: v2?.actionPolicyVersion ?? null,
    dealStatus: v2?.dealStatus ?? null,
    beliefDirection: v2?.beliefDirection ?? null,
    actions: v2 ? structuredClone(v2.actions) : [],
    missingEvidence: v2 ? structuredClone(v2.missingEvidence) : [],
    format: v2?.format ?? null,
    channel: draft.channel,
    audienceType: draft.audienceType,
    body: sanitizeLegacyPublicActionDraftBody({
      channel: draft.channel,
      format: v2?.format ?? null,
      body: draft.body,
    }),
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}

export async function searchPersistedUnderwriting(input: {
  workspaceId: string;
  query: string;
  artifacts: UnderwritingArtifactsRepository;
  report: UnderwritingPresentationIdentityInput["report"];
  candidateRunIds?: readonly string[];
}): Promise<UnderwritingSearchResult[]> {
  const tokens = evidenceQueryTokens(input.query);
  if (tokens.length === 0) return [];
  const bundles = await input.artifacts.listFinalizedForWorkspace({
    workspaceId: input.workspaceId,
  });
  const allowedCandidates = input.candidateRunIds === undefined
    ? null
    : new Set(input.candidateRunIds);
  return bundles
    .filter((bundle) =>
      allowedCandidates === null || allowedCandidates.has(bundle.candidateRunId)
    )
    .flatMap((bundle) => searchItemsForBundle({
      bundle,
      report: input.report,
    }))
    .filter((item) => {
      const searchable = new Set(evidenceQueryTokens(item.text));
      return tokens.every((token) => searchable.has(token));
    })
    .sort((left, right) =>
      left.dealId.localeCompare(right.dealId)
      || left.analysisType.localeCompare(right.analysisType)
      || left.itemId.localeCompare(right.itemId)
    )
    .slice(0, 50);
}

function searchItemsForBundle(input: {
  bundle: CandidateArtifactBundle;
  report: UnderwritingPresentationIdentityInput["report"];
}): UnderwritingSearchResult[] {
  const { bundle } = input;
  const adapter = resolveUnderwritingPresentationAdapter({
    report: input.report,
    requestedDealId: bundle.dealId,
    candidate: {
      id: bundle.candidateRunId,
      workspaceId: bundle.workspaceId,
      dealId: bundle.dealId,
      artifactSourceCandidateRunId:
        bundle.sourceCandidateRunId === bundle.candidateRunId
          ? null
          : bundle.sourceCandidateRunId,
    },
    bundle,
  });
  return adapter.kind === "current"
    ? currentSearchItemsForBundle(requireCurrentCandidateBundle(bundle))
    : legacySearchItemsForBundle(bundle);
}

function legacySearchItemsForBundle(
  bundle: CandidateArtifactBundle,
): UnderwritingSearchResult[] {
  const facts = new Map(bundle.evidencePack.facts.map((fact) => [fact.id, fact]));
  const edges = bundle.claimEdges;
  const common = {
    candidateRunId: bundle.candidateRunId,
    dealId: bundle.dealId,
  };
  return [
    ...bundle.evidencePack.facts.map((fact) => ({
      ...common,
      itemId: fact.id,
      analysisType: "fact" as const,
      text: `${fact.field}: ${fact.value}${fact.unit ? ` ${fact.unit}` : ""}`,
      inputRefIds: [],
      sourceRevisionIds: [fact.sourceRevisionId],
      claimEdges: [],
    })),
    ...bundle.evidencePack.assumptions.map((assumption) => {
      const lineage = assumptionSearchLineage({
        assumption,
        facts,
        bundle,
      });
      return {
        ...common,
        itemId: assumption.id,
        analysisType: "assumption" as const,
        text:
          `${assumption.field}: ${assumption.value}. ${assumption.rationale}`,
        inputRefIds: [...assumption.inputRefIds],
        sourceRevisionIds: lineage.sourceRevisionIds,
        claimEdges: lineage.claimEdges,
      };
    }),
    ...bundle.calculations.map((calculation) => {
      const itemEdges = edges.filter((edge) =>
        edge.claimItemId === calculation.id
      );
      return {
        ...common,
        itemId: calculation.id,
        analysisType: "calculation" as const,
        text:
          `${calculation.formulaId}: ${calculation.output} ${calculation.unit}`,
        inputRefIds: [],
        sourceRevisionIds: sourceRevisionIdsForClaim({
          claimItemId: calculation.id,
          facts,
          edges,
        }),
        claimEdges: structuredClone(itemEdges),
      };
    }),
    ...bundle.judgments.map((judgment) => ({
      ...common,
      itemId: judgment.id,
      analysisType: "framework_judgment" as const,
      text: [
        judgment.frameworkCardId,
        judgment.conclusion,
        judgment.strongestSupport,
        judgment.strongestCounterargument,
        ...judgment.unknowns,
        ...publicFrameworkLimitations(judgment),
      ].filter(Boolean).join(". "),
      inputRefIds: [],
      sourceRevisionIds: sourceRevisionIdsForClaim({
        claimItemId: judgment.id,
        facts,
        edges,
      }),
      claimEdges: structuredClone(judgment.claimEdges),
    })),
    {
      ...common,
      itemId: bundle.decision.id,
      analysisType: "final_synthesis" as const,
      text: [
        bundle.decision.decision,
        bundle.decision.companyQuality,
        bundle.decision.priceAttractiveness,
        bundle.decision.fundFit,
        renderPublicAdvisorySections({
          judgments: bundle.judgments,
          disagreements: bundle.disagreements,
        }),
      ].filter(Boolean).join(". "),
      inputRefIds: [],
      sourceRevisionIds: sourceRevisionIdsForClaim({
        claimItemId: bundle.decision.id,
        facts,
        edges,
      }),
      claimEdges: structuredClone(bundle.decision.claimEdges),
    },
  ];
}

function currentSearchItemsForBundle(
  bundle: CurrentCandidateArtifactBundle,
): UnderwritingSearchResult[] {
  const facts = new Map(bundle.evidencePack.facts.map((fact) => [fact.id, fact]));
  const assumptions = new Map(
    bundle.evidencePack.assumptions.map((assumption) => [
      assumption.id,
      assumption,
    ]),
  );
  const common = {
    candidateRunId: bundle.candidateRunId,
    dealId: bundle.dealId,
  };
  const projectionItems = bundle.decisionCriticalEvidenceProjection.evidenceRefs
    .map((reference): UnderwritingSearchResult => {
      if (reference.classification === "fact") {
        const fact = facts.get(reference.evidencePackItemId);
        if (!fact) {
          throw new UnderwritingPresentationIntegrityError(
            "current_artifact_ownership_mismatch",
          );
        }
        return {
          ...common,
          itemId: fact.id,
          analysisType: "fact",
          text: `${fact.field}: ${fact.value}${fact.unit ? ` ${fact.unit}` : ""}`,
          inputRefIds: [],
          sourceRevisionIds: [fact.sourceRevisionId],
          claimEdges: [],
        };
      }
      const assumption = assumptions.get(reference.evidencePackItemId);
      if (!assumption) {
        throw new UnderwritingPresentationIntegrityError(
          "current_artifact_ownership_mismatch",
        );
      }
      const lineage = assumptionSearchLineage({
        assumption,
        facts,
        bundle,
      });
      return {
        ...common,
        itemId: assumption.id,
        analysisType: "assumption",
        text:
          `${assumption.field}: ${assumption.value}. ${assumption.rationale}`,
        inputRefIds: [...assumption.inputRefIds],
        sourceRevisionIds: lineage.sourceRevisionIds,
        claimEdges: lineage.claimEdges,
      };
    });
  const passagesByFingerprint = indexCurrentNamedLensPassages(bundle);
  const passageItems = bundle.namedLensDispositions
    .filter(({ disposition }) =>
      disposition === "selected_main" || disposition === "appendix_only"
    )
    .map((disposition): UnderwritingSearchResult => {
      const passage = exactPassageForDisposition({
        disposition,
        passagesByFingerprint,
      });
      const citations = bundle.namedLensPresentation.segmentCitations.filter(
        ({ judgmentId }) => judgmentId === passage.judgmentId,
      );
      const evidenceItemIds = new Set(
        citations.flatMap(({ evidenceItemIds }) => evidenceItemIds),
      );
      return {
        ...common,
        itemId: passage.judgmentId,
        analysisType: "framework_judgment",
        text: [
          passage.premise.text,
          passage.caseApplication.text,
          passage.countercase.text,
          passage.unknownBoundary.text,
          passage.conditionalConclusion.text,
        ].join(" "),
        inputRefIds: [],
        sourceRevisionIds: sourceRevisionIdsForEvidenceItems({
          evidenceItemIds,
          facts,
          assumptions,
          bundle,
        }),
        claimEdges: bundle.claimEdges
          .filter((edge) =>
            edge.claimItemId === passage.judgmentId
            && evidenceItemIds.has(edge.dependencyItemId)
          )
          .map((edge) => structuredClone(edge)),
      };
    });
  const synthesis = bundle.namedLensPresentation.synthesis;
  const synthesisEvidenceIds = new Set(synthesis.evidenceItemIds);
  const synthesisDependencyIds = new Set([
    ...synthesis.evidenceItemIds,
    ...synthesis.judgmentIds,
  ]);
  const synthesisItem: UnderwritingSearchResult = {
    ...common,
    itemId: bundle.decision.id,
    analysisType: "final_synthesis",
    text: synthesis.text,
    inputRefIds: [],
    sourceRevisionIds: sourceRevisionIdsForEvidenceItems({
      evidenceItemIds: synthesisEvidenceIds,
      facts,
      assumptions,
      bundle,
    }),
    claimEdges: bundle.decision.claimEdges
      .filter(({ dependencyItemId }) =>
        synthesisDependencyIds.has(dependencyItemId)
      )
      .map((edge) => structuredClone(edge)),
  };
  return [...projectionItems, ...passageItems, synthesisItem];
}

function sourceRevisionIdsForEvidenceItems(input: {
  evidenceItemIds: ReadonlySet<string>;
  facts: Map<string, Fact>;
  assumptions: Map<
    string,
    CandidateArtifactBundle["evidencePack"]["assumptions"][number]
  >;
  bundle: CandidateArtifactBundle;
}): string[] {
  const revisionIds = new Set<string>();
  for (const evidenceItemId of input.evidenceItemIds) {
    const fact = input.facts.get(evidenceItemId);
    if (fact) {
      revisionIds.add(fact.sourceRevisionId);
      continue;
    }
    const assumption = input.assumptions.get(evidenceItemId);
    if (!assumption) continue;
    for (const revisionId of assumptionSearchLineage({
      assumption,
      facts: input.facts,
      bundle: input.bundle,
    }).sourceRevisionIds) {
      revisionIds.add(revisionId);
    }
  }
  return [...revisionIds].sort();
}

function assumptionSearchLineage(input: {
  assumption: CandidateArtifactBundle["evidencePack"]["assumptions"][number];
  facts: Map<string, Fact>;
  bundle: CandidateArtifactBundle;
}): {
  sourceRevisionIds: string[];
  claimEdges: ClaimEdge[];
} {
  const policyIds = new Set([
    input.bundle.versionSnapshot.fundPolicyId,
    input.bundle.versionSnapshot.criticalEvidenceProfileId,
    input.bundle.versionSnapshot.valuationMethodPolicyId,
    input.bundle.versionSnapshot.decisionPolicyId,
  ]);
  const benchmarkPackId = input.bundle.versionSnapshot.benchmarkPackId;
  const sourceRevisionIds = new Set<string>();
  const claimEdges: ClaimEdge[] = [];

  for (const inputRefId of input.assumption.inputRefIds) {
    const fact = input.facts.get(inputRefId);
    if (fact) {
      sourceRevisionIds.add(fact.sourceRevisionId);
      claimEdges.push({
        claimItemId: input.assumption.id,
        dependencyItemId: inputRefId,
        dependencyType: "fact",
      });
      continue;
    }
    if (policyIds.has(inputRefId)) {
      claimEdges.push({
        claimItemId: input.assumption.id,
        dependencyItemId: inputRefId,
        dependencyType: "policy_ref",
      });
      continue;
    }
    if (benchmarkPackId !== null && inputRefId === benchmarkPackId) {
      claimEdges.push({
        claimItemId: input.assumption.id,
        dependencyItemId: inputRefId,
        dependencyType: "benchmark_ref",
      });
    }
  }

  return {
    sourceRevisionIds: [...sourceRevisionIds].sort(),
    claimEdges,
  };
}

function sourceRevisionIdsForClaim(input: {
  claimItemId: string;
  facts: Map<string, Fact>;
  edges: ClaimEdge[];
}): string[] {
  const pending = [input.claimItemId];
  const visited = new Set<string>();
  const revisionIds = new Set<string>();
  while (pending.length > 0) {
    const claimItemId = pending.pop()!;
    if (visited.has(claimItemId)) continue;
    visited.add(claimItemId);
    const directFact = input.facts.get(claimItemId);
    if (directFact) revisionIds.add(directFact.sourceRevisionId);
    for (const edge of input.edges) {
      if (edge.claimItemId !== claimItemId) continue;
      const fact = input.facts.get(edge.dependencyItemId);
      if (fact) revisionIds.add(fact.sourceRevisionId);
      else pending.push(edge.dependencyItemId);
    }
  }
  return [...revisionIds].sort();
}

function toPublicVersionSnapshot(
  snapshot: CandidateVersionSnapshot,
): PublicCandidateVersionSnapshot {
  return PublicCandidateVersionSnapshotSchema.parse(structuredClone(snapshot));
}
