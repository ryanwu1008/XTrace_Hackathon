import { isDeepStrictEqual } from "node:util";

import type {
  EvidencePacksRepository,
  SourceEvidenceInput,
} from "../../db/repositories/evidence-packs";
import {
  sourceRevisionFingerprint,
  type RegisteredDeal,
} from "../../db/repositories/deal-registry";
import type {
  SourceRegistry,
  SourceRevision,
} from "../../db/repositories/source-registry";
import type {
  XTraceLineageRepository,
} from "../../db/repositories/xtrace-lineage";
import type { CompanyAnalysis } from "../contracts/domain";
import {
  SourceRevisionSchema,
  type EvidencePack,
} from "../contracts/evidence";
import type {
  CandidateRun,
  FundPolicySnapshot,
  ResolvedUnderwritingContext,
  XTraceLineageSnapshot,
  XTraceParentBinding,
} from "../contracts/underwriting";
import {
  type EvidencePackBuilder,
  type SelectedBenchmarkInput,
} from "./evidence/builder";
import {
  projectUnderwritingEvidence,
  SemanticEvidenceProjectionError,
} from "./evidence/semantic-projector";
import type {
  CandidateIdentityEvidence,
  CriticalEvidenceProfile,
  RouterEvidenceValue,
} from "./router";
import type {
  ReferenceDefinitionRef,
} from "./fingerprints";

export interface CandidateGroundingSnapshot {
  identityEvidence: CandidateIdentityEvidence;
  sourceRevisionIds: string[];
  sourceRevisionSnapshots: SourceRevision[];
  xtraceLineage: XTraceLineageSnapshot;
}

export interface GroundedEvidencePack {
  pack: EvidencePack;
  buildInputFingerprint: string;
  criticalEvidenceProfile: ReferenceDefinitionRef;
  benchmark: SelectedBenchmarkInput | null;
}

export interface CandidateGroundingPort {
  load(input: {
    candidate: CandidateRun;
    analysis: CompanyAnalysis;
    deal: RegisteredDeal;
    signal: AbortSignal;
  }): Promise<CandidateGroundingSnapshot>;
  buildEvidencePack(input: {
    candidate: CandidateRun;
    analysis: CompanyAnalysis;
    deal: RegisteredDeal;
    context: ResolvedUnderwritingContext;
    fundPolicy: FundPolicySnapshot;
    snapshot: CandidateGroundingSnapshot;
    signal: AbortSignal;
  }): Promise<GroundedEvidencePack>;
}

type CandidateXTraceLineageRepository =
  & Pick<XTraceLineageRepository, "resolve">
  & Partial<Pick<XTraceLineageRepository, "resolveExact">>;

export function createEvidencePackCandidateGrounding(options: {
  repository: EvidencePacksRepository;
  sourceRegistry: SourceRegistry;
  builder: EvidencePackBuilder;
  criticalEvidenceProfiles: CriticalEvidenceProfile[];
  xtraceLineage?: CandidateXTraceLineageRepository;
  resolveBenchmark(
    context: ResolvedUnderwritingContext,
  ): Promise<SelectedBenchmarkInput | null>;
}): CandidateGroundingPort {
  const criticalEvidenceProfiles = new Map(
    options.criticalEvidenceProfiles.map((profile) => [profile.id, profile]),
  );

  return {
    async load({ candidate, analysis, deal, signal }) {
      throwIfAborted(signal);
      assertCandidateIdentity({ candidate, analysis, deal });
      const sourceRevisionIds = uniqueSorted(deal.activeSourceRevisionIds);
      if (
        sourceRevisionIds.length === 0
        || deal.activeSourceRevisionFingerprint
          !== sourceRevisionFingerprint(sourceRevisionIds)
      ) {
        throw new CandidateGroundingUnavailableError([
          "ACTIVE_SOURCE_REVISION_SET_INVALID",
        ]);
      }
      const sourceRevisionSnapshots: SourceRevision[] = [];
      for (const revisionId of sourceRevisionIds) {
        const revision = await options.sourceRegistry.getRevision({
          workspaceId: candidate.workspaceId,
          revisionId,
        });
        if (!revision) {
          throw new CandidateGroundingUnavailableError([
            "ACTIVE_SOURCE_REVISION_UNAVAILABLE",
          ]);
        }
        sourceRevisionSnapshots.push(canonicalSourceRevision(revision));
      }
      const sourceEvidence = await options.repository.listSourceEvidence({
        workspaceId: candidate.workspaceId,
        dealId: candidate.dealId,
        sourceRevisionIds,
      });
      const sourceIdsByRevision = new Map(
        sourceRevisionSnapshots.map(({ id, sourceId }) => [id, sourceId]),
      );
      if (sourceEvidence.some((evidence) =>
        evidence.workspaceId !== candidate.workspaceId
        || evidence.dealId !== candidate.dealId
        || sourceIdsByRevision.get(evidence.sourceRevisionId)
          !== evidence.sourceId
      )) {
        throw new CandidateGroundingUnavailableError([
          "SOURCE_EVIDENCE_LINEAGE_MISMATCH",
        ]);
      }
      throwIfAborted(signal);
      let identityEvidence: CandidateIdentityEvidence;
      try {
        identityEvidence = candidateIdentityEvidence({
          analysis,
          deal,
          sourceEvidence,
        });
      } catch (error) {
        if (error instanceof SemanticEvidenceProjectionError) {
          throw new CandidateGroundingUnavailableError([
            "SEMANTIC_EVIDENCE_LINEAGE_MISMATCH",
          ]);
        }
        throw error;
      }
      const xtraceLineage = await resolveXTraceLineage({
        analysis,
        deal,
        sourceEvidence,
        sourceRevisionSnapshots,
        repository: options.xtraceLineage,
        capturedAt: analysis.createdAt,
      });
      return {
        identityEvidence,
        sourceRevisionIds,
        sourceRevisionSnapshots: [...sourceRevisionSnapshots]
          .sort((left, right) => compareUtf8(left.id, right.id)),
        xtraceLineage,
      };
    },

    async buildEvidencePack(input) {
      throwIfAborted(input.signal);
      const criticalEvidenceProfile = criticalEvidenceProfiles.get(
        input.context.criticalEvidenceProfileId,
      );
      if (
        !criticalEvidenceProfile
        || criticalEvidenceProfile.publicationStatus !== "published"
      ) {
        throw new CandidateGroundingUnavailableError([
          "CRITICAL_EVIDENCE_PROFILE_UNAVAILABLE",
        ]);
      }
      const benchmark = await options.resolveBenchmark(input.context);
      throwIfAborted(input.signal);
      if (
        input.context.benchmarkPackId
        && ["exact", "broad_compatible"].includes(
          input.context.benchmarkCompatibility,
        )
        && !benchmark
      ) {
        throw new CandidateGroundingUnavailableError([
          "SELECTED_BENCHMARK_UNAVAILABLE",
        ]);
      }
      const pack = await options.builder.build({
        workspaceId: input.candidate.workspaceId,
        dealId: input.candidate.dealId,
        asOfDate: input.context.asOfDate,
        sourceRevisionIds: input.snapshot.sourceRevisionIds,
        xtraceLineage: input.snapshot.xtraceLineage,
        context: input.context,
        fundPolicy: input.fundPolicy,
        benchmark,
      });
      const savedBuild = await options.repository.findByPackId({
        workspaceId: input.candidate.workspaceId,
        packId: pack.id,
      });
      if (
        !savedBuild
        || !isDeepStrictEqual(savedBuild.pack, pack)
      ) {
        throw new CandidateGroundingUnavailableError([
          "EVIDENCE_PACK_BUILD_UNAVAILABLE",
        ]);
      }
      return {
        pack,
        buildInputFingerprint: savedBuild.inputFingerprint,
        criticalEvidenceProfile: {
          kind: "critical_evidence_profile",
          id: criticalEvidenceProfile.id,
          version: criticalEvidenceProfile.version,
          definitionFingerprint:
            criticalEvidenceProfile.definitionFingerprint,
        },
        benchmark,
      };
    },
  };
}

export class CandidateGroundingUnavailableError extends Error {
  readonly reasonCodes: string[];

  constructor(reasonCodes: string[]) {
    super("Candidate source grounding is unavailable.");
    this.name = "CandidateGroundingUnavailableError";
    this.reasonCodes = uniqueSorted(reasonCodes);
  }
}

function candidateIdentityEvidence(input: {
  analysis: CompanyAnalysis;
  deal: RegisteredDeal;
  sourceEvidence: SourceEvidenceInput[];
}): CandidateIdentityEvidence {
  const values = new Map<string, RouterEvidenceValue[]>();
  const projected = projectUnderwritingEvidence(input.sourceEvidence);
  const contextValuesByEvidenceId = new Map(
    projected.contextValues.map((value) => [value.evidenceItemId, value]),
  );
  for (const fact of projected.facts) {
    if (
      !fact.acceptedForGate
      || fact.assertionStatus === "disputed"
      || fact.freshness === "stale"
    ) {
      continue;
    }
    const value = (
      contextValuesByEvidenceId.get(fact.id)?.value ?? fact.value
    ).trim().toLowerCase();
    const item: RouterEvidenceValue = {
      value,
      basis: contextValuesByEvidenceId.has(fact.id)
        ? "derived"
        : "source_explicit",
      evidenceItemId: fact.id,
    };
    const existing = values.get(fact.field) ?? [];
    existing.push(item);
    values.set(fact.field, existing);
  }
  for (const assumption of projected.assumptions) {
    if (assumption.field !== "security_type") continue;
    const existing = values.get(assumption.field) ?? [];
    existing.push({
      value: assumption.value,
      basis: "assumption",
      evidenceItemId: assumption.id,
    });
    values.set(assumption.field, existing);
  }
  for (const unavailable of projected.unavailableFields) {
    if (unavailable.fieldId !== "geography") continue;
    const contextValue = contextValuesByEvidenceId.get(
      unavailable.evidenceItemId,
    );
    if (!contextValue) continue;
    const existing = values.get(unavailable.fieldId) ?? [];
    existing.push({
      value: contextValue.value,
      basis: "semantic_availability",
      evidenceItemId: unavailable.evidenceItemId,
    });
    values.set(unavailable.fieldId, existing);
  }
  const explicitCompany = values.get("company_identity") ?? [];
  const confirmedCompany: RouterEvidenceValue = {
    value: input.deal.companyId,
    basis: "confirmed",
    evidenceItemId: `deal-confirmation:${input.deal.id}`,
  };
  if (
    explicitCompany.some(({ value }) =>
      !sameCompanyIdentity(value, input.deal)
    )
  ) {
    throw new CandidateGroundingUnavailableError([
      "COMPANY_IDENTITY_CONFLICT",
    ]);
  }
  return {
    asOfDate: input.analysis.createdAt.slice(0, 10),
    companyIdentity: [confirmedCompany, ...explicitCompany],
    stage: values.get("stage") ?? [],
    businessModel: values.get("business_model") ?? [],
    geography: values.get("geography") ?? [],
    securityType: values.get("security_type") ?? [],
  };
}

async function resolveXTraceLineage(input: {
  analysis: CompanyAnalysis;
  deal: RegisteredDeal;
  sourceEvidence: SourceEvidenceInput[];
  sourceRevisionSnapshots: SourceRevision[];
  repository?: CandidateXTraceLineageRepository;
  capturedAt: string;
}): Promise<XTraceLineageSnapshot> {
  const memoryIds = uniqueSorted(input.analysis.investmentMemory.memoryIds);
  if (memoryIds.length === 0) {
    return {
      memoryIds: [],
      sourceRevisionIds: [],
      sourceIds: [],
      fixtureIds: [],
      capturedAt: input.capturedAt,
    };
  }
  if (!input.repository) {
    throw new CandidateGroundingUnavailableError([
      "XTRACE_LINEAGE_UNAVAILABLE",
    ]);
  }
  const evidenceById = new Map(
    input.sourceEvidence.map((evidence) => [evidence.id, evidence]),
  );
  const revisionsById = new Map(
    input.sourceRevisionSnapshots.map((revision) => [revision.id, revision]),
  );
  const sourceRevisionIds = new Set<string>();
  const sourceIds = new Set<string>();
  const fixtureIds = new Set<string>();
  const parentBindings: XTraceParentBinding[] = [];
  for (const memoryId of memoryIds) {
    const usesExactLineage = input.repository.resolveExact !== undefined;
    const lineage = usesExactLineage
      ? await input.repository.resolveExact!({
          memoryId,
          workspaceId: input.deal.workspaceId,
          dealId: input.deal.id,
          activeParentFingerprint:
            input.deal.activeSourceRevisionFingerprint!,
        })
      : await input.repository.resolve({
          memoryId,
          workspaceId: input.deal.workspaceId,
          convId: `deal:${input.deal.id}`,
        });
    if (
      !lineage
      || lineage.memoryId !== memoryId
      || lineage.workspaceId !== input.deal.workspaceId
      || lineage.dealId !== input.deal.id
    ) {
      throw new CandidateGroundingUnavailableError([
        "XTRACE_LINEAGE_UNRESOLVED",
      ]);
    }
    if (lineage.sourceRevisionIds.length > 0) {
      if (usesExactLineage && lineage.sourceRevisionIds.length !== 1) {
        throw new CandidateGroundingUnavailableError([
          "XTRACE_SOURCE_LINEAGE_MISMATCH",
        ]);
      }
      const exactRevisions = lineage.sourceRevisionIds.map((revisionId) =>
        revisionsById.get(revisionId)
      );
      if (exactRevisions.some((revision) => !revision)) {
        throw new CandidateGroundingUnavailableError([
          "XTRACE_SOURCE_LINEAGE_MISMATCH",
        ]);
      }
      const exactSourceIds = uniqueSorted(
        exactRevisions.map((revision) => revision!.sourceId),
      );
      if (usesExactLineage && lineage.provenance === "demo_fixture") {
        const exactFixtureIds = exactSourceIds.map(sampleFixtureIdForSource);
        if (
          lineage.sourceIds.length > 0
          || lineage.fixtureIds.length !== 1
          || !sameStringSet(exactFixtureIds, lineage.fixtureIds)
        ) {
          throw new CandidateGroundingUnavailableError([
            "XTRACE_FIXTURE_LINEAGE_MISMATCH",
          ]);
        }
        parentBindings.push({
          kind: "fixture",
          memoryId,
          sourceRevisionId: exactRevisions[0]!.id,
          sourceId: null,
          fixtureId: lineage.fixtureIds[0]!,
        });
      } else if (
        !sameStringSet(exactSourceIds, lineage.sourceIds)
        || (usesExactLineage && (
          lineage.sourceIds.length !== 1
          || lineage.fixtureIds.length !== 0
        ))
      ) {
        throw new CandidateGroundingUnavailableError([
          "XTRACE_SOURCE_LINEAGE_MISMATCH",
        ]);
      } else if (usesExactLineage) {
        parentBindings.push({
          kind: "source",
          memoryId,
          sourceRevisionId: exactRevisions[0]!.id,
          sourceId: exactRevisions[0]!.sourceId,
          fixtureId: null,
        });
      }
      for (const revision of exactRevisions) {
        sourceRevisionIds.add(revision!.id);
        if (!(usesExactLineage && lineage.provenance === "demo_fixture")) {
          sourceIds.add(revision!.sourceId);
        }
      }
    } else {
      for (const evidenceId of lineage.sourceIds) {
        const evidence = evidenceById.get(evidenceId);
        const revision = evidence
          ? revisionsById.get(evidence.sourceRevisionId)
          : undefined;
        if (
          !evidence
          || !revision
          || evidence.sourceId !== revision.sourceId
        ) {
          throw new CandidateGroundingUnavailableError([
            "XTRACE_SOURCE_LINEAGE_MISMATCH",
          ]);
        }
        sourceRevisionIds.add(revision.id);
        sourceIds.add(revision.sourceId);
      }
    }
    for (const fixtureId of lineage.fixtureIds) fixtureIds.add(fixtureId);
  }
  if (sourceRevisionIds.size === 0) {
    throw new CandidateGroundingUnavailableError([
      "XTRACE_SOURCE_LINEAGE_MISSING",
    ]);
  }
  return {
    memoryIds,
    sourceRevisionIds: uniqueSorted([...sourceRevisionIds]),
    sourceIds: uniqueSorted([...sourceIds]),
    fixtureIds: uniqueSorted([...fixtureIds]),
    ...(parentBindings.length === 0
      ? {}
      : {
          parentBindings: [...parentBindings].sort((left, right) =>
            compareUtf8(left.memoryId, right.memoryId)
            || compareUtf8(left.sourceRevisionId, right.sourceRevisionId)
            || compareUtf8(left.kind, right.kind)
          ),
        }),
    capturedAt: input.capturedAt,
  };
}

function sampleFixtureIdForSource(sourceId: string): string {
  if (!sourceId.startsWith("source_") || sourceId.length <= "source_".length) {
    throw new CandidateGroundingUnavailableError([
      "XTRACE_FIXTURE_LINEAGE_MISMATCH",
    ]);
  }
  return sourceId.slice("source_".length);
}

function assertCandidateIdentity(input: {
  candidate: CandidateRun;
  analysis: CompanyAnalysis;
  deal: RegisteredDeal;
}): void {
  if (
    input.candidate.workspaceId !== input.deal.workspaceId
    || input.candidate.dealId !== input.deal.id
    || input.analysis.dealId !== input.deal.id
    || input.analysis.companyName !== input.deal.companyName
  ) {
    throw new CandidateGroundingUnavailableError([
      "CANDIDATE_IDENTITY_MISMATCH",
    ]);
  }
}

function sameCompanyIdentity(value: string, deal: RegisteredDeal): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === deal.companyId.toLowerCase()
    || normalized === deal.companyName.toLowerCase();
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Candidate grounding was cancelled.");
  }
}

function canonicalSourceRevision(
  revision: SourceRevision,
): SourceRevision {
  const parsed = SourceRevisionSchema.parse(revision);
  return SourceRevisionSchema.parse({
    ...parsed,
    extractedAt: new Date(parsed.extractedAt).toISOString(),
    createdAt: new Date(parsed.createdAt).toISOString(),
  });
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf8);
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const normalizedLeft = uniqueSorted(left);
  const normalizedRight = uniqueSorted(right);
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) =>
      value === normalizedRight[index]
    );
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
