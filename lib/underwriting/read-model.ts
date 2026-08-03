import {
  CandidateVersionSnapshotSchema,
  type CandidateArtifactBundle,
  type CandidateVersionSnapshot,
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
  CandidateRun,
  FrameworkJudgment,
  UnderwritingBatch,
} from "../contracts/underwriting";
import { evidenceQueryTokens } from "../demo/search";
import { buildUnderwritingNarrative } from "./narrative";
import {
  publicFrameworkLimitations,
  renderPublicAdvisorySections,
  sanitizeLegacyPublicActionDraftBody,
} from "./public-advisory-rendering";

export type DealUnderwritingStatus =
  | "not_selected"
  | CandidateRun["status"];

export interface DealUnderwritingSelectionView {
  dealId: string;
  underwritingStatus: DealUnderwritingStatus;
  rank: number | null;
  candidateRunId: string | null;
  decision: CandidateArtifactBundle["decision"]["decision"];
}

export interface UnderwritingBatchSummary {
  batchId: string;
  status: UnderwritingBatch["status"];
  selections: DealUnderwritingSelectionView[];
}

export interface PublicActionDraft {
  id: string;
  candidateRunId: string;
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

export async function buildUnderwritingBatchSummary(input: {
  workspaceId: string;
  scanRunId: string;
  runs: UnderwritingRunsRepository;
  artifacts: UnderwritingArtifactsRepository;
}): Promise<UnderwritingBatchSummary | null> {
  const batch = await input.runs.getBatchByScanRunId({
    workspaceId: input.workspaceId,
    scanRunId: input.scanRunId,
  });
  if (!batch) return null;
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
  const candidatesByDeal = new Map(
    candidates.map((candidate) => [candidate.dealId, candidate]),
  );
  const decisions = new Map<string, CandidateArtifactBundle["decision"]["decision"]>();
  await Promise.all(candidates.map(async (candidate) => {
    if (!["completed", "partial"].includes(candidate.status)) return;
    const bundle = await input.artifacts.getByCandidateRunId({
      workspaceId: input.workspaceId,
      candidateRunId: candidate.id,
    });
    if (bundle) decisions.set(candidate.id, bundle.decision.decision);
  }));
  return {
    batchId: batch.id,
    status: batch.status,
    selections: selections.map((selection) => {
      if (selection.status === "not_selected") {
        return {
          dealId: selection.dealId,
          underwritingStatus: "not_selected" as const,
          rank: null,
          candidateRunId: null,
          decision: null,
        };
      }
      const candidate = candidatesByDeal.get(selection.dealId);
      return {
        dealId: selection.dealId,
        underwritingStatus: candidate?.status ?? "queued",
        rank: selection.rank,
        candidateRunId: candidate?.id ?? null,
        decision: candidate ? decisions.get(candidate.id) ?? null : null,
      };
    }),
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
  const [selection, candidates] = await Promise.all([
    input.runs.listSelectionsForBatch({
      workspaceId: input.workspaceId,
      batchId: batch.id,
    }).then((values) =>
      values.find((value) =>
        value.dealId === input.dealId && value.status === "selected"
      )
    ),
    input.runs.listCandidatesForBatch({
      workspaceId: input.workspaceId,
      batchId: batch.id,
    }),
  ]);
  if (!selection) return null;
  return candidates.find((candidate) =>
    candidate.dealId === input.dealId
  ) ?? null;
}

export function toCandidateUnderwritingDetail(
  bundle: CandidateArtifactBundle,
) {
  return {
    candidateRunId: bundle.candidateRunId,
    dealId: bundle.dealId,
    evidencePack: structuredClone(bundle.evidencePack),
    context: structuredClone(bundle.context),
    scenarioModel: structuredClone(bundle.scenarioModel),
    calculations: structuredClone(bundle.calculations),
    judgments: bundle.judgments.map(toPublicFrameworkJudgment),
    disagreements: structuredClone(bundle.disagreements),
    valuation: structuredClone(bundle.valuation),
    decision: structuredClone(bundle.decision),
    narrative: publicNarrativeForBundle(bundle),
    claimEdges: structuredClone(bundle.claimEdges),
    sourceRevisionIds: [...bundle.evidencePack.sourceRevisionIds],
    versionSnapshot: toPublicVersionSnapshot(bundle.versionSnapshot),
  };
}

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
  return {
    id: draft.id,
    candidateRunId: draft.candidateRunId,
    channel: draft.channel,
    audienceType: draft.audienceType,
    body: sanitizeLegacyPublicActionDraftBody({
      channel: draft.channel,
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
    .flatMap(searchItemsForBundle)
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

function searchItemsForBundle(
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
