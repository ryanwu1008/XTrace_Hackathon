import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import {
  BeliefActionSchema,
  BeliefChangeDirectionSchema,
  CanonicalDealStatusSchema,
} from "../../lib/contracts/domain";

import {
  CalculationSchema,
  ClaimEdgeSchema,
  EvidencePackSchema,
  type Calculation,
  type ClaimEdge,
  type EvidencePack,
} from "../../lib/contracts/evidence";
import {
  ActionDraftSchema,
  FrameworkAdvisoryMetadataSchema,
  CurrentFrameworkJudgmentSchema,
  DecisionResultSchema,
  FundPolicySnapshotSchema,
  FrameworkDisagreementSchema,
  FrameworkJudgmentSchema,
  LegacyFrameworkJudgmentSchema,
  parseActionDraftRead,
  ResolvedUnderwritingContextSchema,
  ScenarioModelSchema,
  ValuationEvaluationSchema,
  type ActionDraft,
  type ActionDraftV2,
  type DecisionResult,
  type FundPolicySnapshot,
  type FrameworkDisagreement,
  type FrameworkAdvisoryMetadata,
  type FrameworkJudgment,
  type ResolvedUnderwritingContext,
  type ScenarioModel,
  type ValuationEvaluation,
} from "../../lib/contracts/underwriting";
import {
  NAMED_LENS_PASSAGE_SCHEMA_VERSION,
  NAMED_LENS_SELECTION_POLICY_VERSION,
  DecisionCriticalEvidenceRefSchema,
  DecisionCriticalEvidenceProjectionSchema,
  NamedLensCatalogConsiderationSchema,
  NamedLensFinalizationDispositionSchema,
  NamedLensPassageSchema,
  NamedLensPresentationSchema,
  NamedLensProviderAttemptSchema,
  NamedLensProviderAttemptRefSchema,
  UNDERWRITING_PRESENTATION_SCHEMA_VERSION,
  type DecisionCriticalEvidenceProjection,
  type NamedLensCatalogConsideration,
  type NamedLensFinalizationDisposition,
  type NamedLensPassage,
  type NamedLensPresentation,
  type NamedLensProviderAttempt,
  type NamedLensProviderAttemptRef,
} from "../../lib/contracts/named-lens";
import {
  DECISION_TAXONOMY_DIGEST,
  DECISION_TAXONOMY_VERSION,
} from
  "../../lib/underwriting/frameworks/decision-taxonomy";
import {
  createDecisionCriticalEvidenceProjectionFingerprint,
  createNamedLensSemanticFingerprints,
  selectFirstScreenDecisionEvidenceIds,
} from
  "../../lib/underwriting/named-lens-presentation";
import {
  IntegrationTransportError,
  isRetryableTransportStatus,
} from "../../lib/api/errors";
import {
  actionsForDealStatusAndDirection,
  beliefActionListsEqual,
} from "../../lib/reports/action-policy";
import { CONTEXT_ROUTER_VERSION } from "../../lib/underwriting/router";
import { compareUtf8 } from "../../lib/format/canonical-order";
import {
  buildCandidateMissingEvidence,
} from "../../lib/underwriting/missing-evidence";
import {
  addDecimalStrings,
  divideDecimalStrings,
  multiplyDecimalStrings,
  subtractDecimalStrings,
} from "../../lib/underwriting/numbers";
import {
  applyFutureDilution,
  computeOwnership,
} from "../../lib/underwriting/valuation/ownership";
import { computeGrossReturns } from "../../lib/underwriting/valuation/returns";
import { SYNTHETIC_FRAMEWORK_PACK } from "../../seed/underwriting/framework-pack-v1";
import {
  collapseNamedLensAttemptEvents,
  createMemoryNamedLensArtifactsRepository,
  type MemoryNamedLensArtifactsRepository,
} from "./named-lens-artifacts";
import { createMemoryUnderwritingCandidateLeaseAuthority } from
  "./underwriting-candidate-lease-authority";

const IdSchema = z.string().min(1).refine(
  (value) => value.trim() === value,
  "IDs cannot have surrounding whitespace",
);
const FingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const CompanyAnalysisUnknownRefSchema = z.strictObject({
  fieldId: z.string().regex(/^semantic-field-[a-f0-9]{24}$/),
  label: z.string().min(1),
  externalLabel: z.string().min(1),
});

export const CandidateVersionSnapshotSchema = z.strictObject({
  fundPolicyId: IdSchema,
  dealStatus: CanonicalDealStatusSchema.optional(),
  beliefDirection: BeliefChangeDirectionSchema.optional(),
  canonicalActions: z.array(BeliefActionSchema).optional(),
  actionPolicyVersion: z.literal("belief-action-policy-v1").optional(),
  draftPolicyVersion: z.literal("status-safe-action-draft-v2").optional(),
  semanticContextAssumptionPolicyVersion:
    z.literal("belief-reversal-demo-context-v1").optional(),
  semanticContextMappingVersion:
    z.literal("belief-reversal-reviewed-context-mapping-v1").optional(),
  analysisMode: z.enum(["full", "core_only"]).optional(),
  contextVersion: z.string().min(1).optional(),
  geography: z.enum(["us", "global", "unavailable"]).optional(),
  benchmarkCompatibility: z.enum([
    "exact",
    "broad_compatible",
    "adjacent_only",
    "unavailable",
  ]).optional(),
  benchmarkPackId: IdSchema.nullable(),
  benchmarkEntryId: IdSchema.nullable(),
  benchmarkDefinitionFingerprint: FingerprintSchema.nullable(),
  frameworkPackId: IdSchema,
  frameworkPackDefinitionFingerprint: FingerprintSchema,
  routerVersion: z.string().min(1),
  criticalEvidenceProfileId: IdSchema,
  criticalEvidenceProfileDefinitionFingerprint: FingerprintSchema,
  valuationMethodPolicyId: IdSchema,
  valuationMethodPolicyDefinitionFingerprint: FingerprintSchema,
  decisionPolicyId: IdSchema,
  decisionPolicyDefinitionFingerprint: FingerprintSchema,
  referenceCatalogFingerprint: FingerprintSchema,
  frameworkCatalogVersion: z.string().min(1).optional(),
  frameworkCatalogFingerprint: FingerprintSchema.optional(),
  frameworkCorpusDigest: FingerprintSchema.optional(),
  formulaVersions: z.array(z.string().min(1)),
  providerModel: z.string().min(1),
  promptVersion: z.string().min(1),
  schemaVersion: z.string().min(1),
  settingsFingerprint: z.string().min(1),
  applicationCommit: z.string().min(1),
  companyAnalysisUnknowns: z.array(CompanyAnalysisUnknownRefSchema).optional(),
  namedLensSelectionPolicyVersion:
    z.literal(NAMED_LENS_SELECTION_POLICY_VERSION).optional(),
  namedLensPassageSchemaVersion:
    z.literal(NAMED_LENS_PASSAGE_SCHEMA_VERSION).optional(),
  namedLensGeneratorVersion: z.string().min(1).optional(),
  underwritingPresentationSchemaVersion:
    z.literal(UNDERWRITING_PRESENTATION_SCHEMA_VERSION).optional(),
  decisionTaxonomyVersion: z.literal(DECISION_TAXONOMY_VERSION).optional(),
  decisionTaxonomyDigest: FingerprintSchema.optional(),
  criticalEvidenceProjectionFingerprint: FingerprintSchema.optional(),
  finalDispositionsFingerprint: FingerprintSchema.optional(),
  presentationFingerprint: FingerprintSchema.optional(),
  refreshNonce: z.string().min(1).nullable().optional(),
}).superRefine((value, context) => {
  const benchmarkValues = [
    value.benchmarkPackId,
    value.benchmarkEntryId,
    value.benchmarkDefinitionFingerprint,
  ];
  if (
    benchmarkValues.some((item) => item === null)
      !== benchmarkValues.every((item) => item === null)
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Benchmark pack, entry, and definition fingerprint must be pinned together.",
    });
  }
  const frameworkCatalogValues = [
    value.frameworkCatalogVersion,
    value.frameworkCatalogFingerprint,
    value.frameworkCorpusDigest,
  ];
  if (
    frameworkCatalogValues.some((item) => item === undefined)
      !== frameworkCatalogValues.every((item) => item === undefined)
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Framework catalog version, fingerprint, and corpus digest must be pinned together.",
    });
  }
  const unknowns = value.companyAnalysisUnknowns;
  if (
    unknowns !== undefined
    && (
      new Set(unknowns.map(({ fieldId }) => fieldId)).size !== unknowns.length
      || unknowns.some(({ fieldId }, index) =>
        index > 0
        && compareUtf8(unknowns[index - 1]!.fieldId, fieldId) >= 0
      )
    )
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Company Analysis unknown references must be unique and UTF-8 sorted.",
    });
  }
  const namedLensVersions = [
    value.namedLensSelectionPolicyVersion,
    value.namedLensPassageSchemaVersion,
    value.namedLensGeneratorVersion,
    value.underwritingPresentationSchemaVersion,
    value.decisionTaxonomyVersion,
  ];
  if (
    namedLensVersions.some((item) => item === undefined)
      !== namedLensVersions.every((item) => item === undefined)
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Named Lens selection, passage, generator, presentation, and taxonomy versions must be pinned together.",
    });
  }
  const currentNamedLensIdentity = [
    value.decisionTaxonomyDigest,
    value.criticalEvidenceProjectionFingerprint,
    value.finalDispositionsFingerprint,
    value.presentationFingerprint,
    value.refreshNonce,
  ];
  if (
    currentNamedLensIdentity.some((item) => item !== undefined)
      !== currentNamedLensIdentity.every((item) => item !== undefined)
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Current Named Lens taxonomy, projection, disposition, presentation, and refresh identity must be pinned together.",
    });
  }
  if (
    currentNamedLensIdentity.some((item) => item !== undefined)
    && namedLensVersions.some((item) => item === undefined)
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Current Named Lens identity fingerprints require the complete version set.",
    });
  }
});

export type CandidateVersionSnapshot = z.infer<
  typeof CandidateVersionSnapshotSchema
>;

const REVIEWED_LEGACY_JUDGMENT_VERSION = {
  schemaVersion: "framework-judgment-v1",
  settingsFingerprint: "belief-reversal-task12-v1",
  applicationCommit: "task12-local-e2e",
} as const;

function omitSchemaShapeKeys<
  Shape extends Record<string, z.ZodType>,
  Key extends keyof Shape,
>(shape: Shape, keys: readonly Key[]): Omit<Shape, Key> {
  const result: Partial<Shape> = { ...shape };
  for (const key of keys) delete result[key];
  return result as Omit<Shape, Key>;
}

const ReviewedLegacyFrameworkAdvisoryMetadataSchema = z.strictObject(
  omitSchemaShapeKeys(FrameworkAdvisoryMetadataSchema.shape, [
    "decisionTaxonomyVersion",
    "decisionTaxonomyDigest",
    "decisionTaxonomyBindings",
  ]),
).superRefine((metadata, context) => {
  const componentIds = metadata.components.map(({ frameworkId }) =>
    frameworkId
  );
  if (
    componentIds.length !== metadata.componentCardIds.length
    || componentIds.some(
      (frameworkId, index) =>
        frameworkId !== metadata.componentCardIds[index],
    )
    || new Set(componentIds).size !== componentIds.length
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Legacy advisory component Card IDs must uniquely match component records",
    });
  }
  if (metadata.applicable !== (metadata.components.length > 0)) {
    context.addIssue({
      code: "custom",
      message:
        "Legacy advisory applicability must match whether components were selected",
    });
  }
  const sourceIds = metadata.sources.map(({ sourceId }) => sourceId);
  const sourceIdSet = new Set(sourceIds);
  if (
    sourceIdSet.size !== sourceIds.length
    || metadata.components.some((component) =>
      component.sourceRefs.some(({ sourceId }) => !sourceIdSet.has(sourceId))
    )
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Every legacy advisory component source reference must resolve uniquely",
    });
  }
  if (
    metadata.components.some((component) =>
      component.rights.status !== "public_source_paraphrase"
      || component.review.contentStatus !== "draft"
      || component.review.publicationStatus !== "unpublished"
      || component.decisionUtility.formalDecisionWeight !== 0
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Legacy advisory components must satisfy every eligibility gate",
    });
  }
});

const ReviewedLegacyPersistedFrameworkJudgmentSchema = z.strictObject({
  ...omitSchemaShapeKeys(LegacyFrameworkJudgmentSchema.shape, [
    "frameworkMetadata",
  ]),
  frameworkMetadata: ReviewedLegacyFrameworkAdvisoryMetadataSchema.optional(),
}).superRefine((judgment, context) => {
  if (judgment.claimEdges.some((edge) => edge.claimItemId !== judgment.id)) {
    context.addIssue({
      code: "custom",
      message: "Legacy framework claim edges must belong to the saved judgment",
    });
  }
});

interface PersistedFrameworkJudgmentVersionIdentity {
  schemaVersion: string;
  settingsFingerprint: string;
  applicationCommit: string;
  namedLensSelectionPolicyVersion?: unknown;
  namedLensPassageSchemaVersion?: unknown;
  namedLensGeneratorVersion?: unknown;
  underwritingPresentationSchemaVersion?: unknown;
  decisionTaxonomyVersion?: unknown;
  decisionTaxonomyDigest?: unknown;
  criticalEvidenceProjectionFingerprint?: unknown;
  finalDispositionsFingerprint?: unknown;
  presentationFingerprint?: unknown;
  refreshNonce?: unknown;
}

/**
 * Hydrates the finite reviewed pre-Named-Lens generation without rewriting its
 * immutable payload or pretending that it carried the current taxonomy.
 */
export function parsePersistedFrameworkJudgments(input: {
  judgments: readonly unknown[];
  versionSnapshot: PersistedFrameworkJudgmentVersionIdentity;
}): FrameworkJudgment[] {
  const version = input.versionSnapshot;
  const exactReviewedTuple =
    version.schemaVersion === REVIEWED_LEGACY_JUDGMENT_VERSION.schemaVersion
    && version.settingsFingerprint
      === REVIEWED_LEGACY_JUDGMENT_VERSION.settingsFingerprint
    && version.applicationCommit
      === REVIEWED_LEGACY_JUDGMENT_VERSION.applicationCommit;
  const hasAnyCurrentNamedLensMarker = [
    version.namedLensSelectionPolicyVersion,
    version.namedLensPassageSchemaVersion,
    version.namedLensGeneratorVersion,
    version.underwritingPresentationSchemaVersion,
    version.decisionTaxonomyVersion,
    version.decisionTaxonomyDigest,
    version.criticalEvidenceProjectionFingerprint,
    version.finalDispositionsFingerprint,
    version.presentationFingerprint,
  ].some((value) => value !== undefined);
  const hasCurrentRefreshIdentity = version.refreshNonce !== undefined
    && version.refreshNonce !== null;
  const hasCurrentMarker = hasAnyCurrentNamedLensMarker
    || hasCurrentRefreshIdentity;

  // The legacy branch returns the original parsed object shape. The cast only
  // widens the read-model type; it does not add current-only fields or write DB
  // state. Downstream legacy presentation code consumes the shared fields.
  if (exactReviewedTuple && !hasCurrentMarker) {
    return input.judgments.map((value) => {
      const parsed = ReviewedLegacyPersistedFrameworkJudgmentSchema.parse(
        value,
      );
      return parsed as FrameworkJudgment;
    });
  }
  return input.judgments.map((value) => {
    const current = CurrentFrameworkJudgmentSchema.safeParse(value);
    if (current.success) return current.data;
    if (
      hasCurrentMarker
      && typeof value === "object"
      && value !== null
      && !Array.isArray(value)
      && (value as Record<string, unknown>).frameworkMetadata === undefined
    ) {
      return LegacyFrameworkJudgmentSchema.parse(value);
    }
    throw current.error;
  });
}

export type CurrentCandidateVersionSnapshot = CandidateVersionSnapshot & {
  frameworkCatalogVersion: string;
  frameworkCatalogFingerprint: string;
  frameworkCorpusDigest: string;
  namedLensSelectionPolicyVersion: typeof NAMED_LENS_SELECTION_POLICY_VERSION;
  namedLensPassageSchemaVersion: typeof NAMED_LENS_PASSAGE_SCHEMA_VERSION;
  namedLensGeneratorVersion: string;
  underwritingPresentationSchemaVersion:
    typeof UNDERWRITING_PRESENTATION_SCHEMA_VERSION;
  decisionTaxonomyVersion: typeof DECISION_TAXONOMY_VERSION;
  decisionTaxonomyDigest: string;
  criticalEvidenceProjectionFingerprint: string;
  finalDispositionsFingerprint: string;
  presentationFingerprint: string;
  refreshNonce: string | null;
};

export interface CandidateFinalization {
  workerId: string;
  leaseToken: string;
  candidateRunId: string;
  candidateAnalysisFingerprint: string;
  evidencePackBuildInputFingerprint: string;
  evidencePack: EvidencePack;
  context: ResolvedUnderwritingContext;
  scenarioModel: ScenarioModel;
  calculations: Calculation[];
  calculationClaimEdges: ClaimEdge[];
  judgments: FrameworkJudgment[];
  disagreements: FrameworkDisagreement[];
  valuation: ValuationEvaluation;
  decision: DecisionResult;
  narrative: string;
  actionDrafts: ActionDraft[];
  versionSnapshot: CandidateVersionSnapshot;
  namedLensCatalogConsiderations?: NamedLensCatalogConsideration[];
  decisionCriticalEvidenceProjection?: DecisionCriticalEvidenceProjection;
  namedLensAttemptRefs?: NamedLensProviderAttemptRef[];
  namedLensDispositions?: NamedLensFinalizationDisposition[];
  namedLensPassages?: NamedLensPassage[];
  underwritingPresentationReportId?: string;
  namedLensPresentation?: NamedLensPresentation;
  terminalStatus?: "completed" | "partial";
  terminalReasonCodes?: string[];
}

export interface CurrentCandidateFinalization extends CandidateFinalization {
  versionSnapshot: CurrentCandidateVersionSnapshot;
  namedLensCatalogConsiderations: NamedLensCatalogConsideration[];
  decisionCriticalEvidenceProjection: DecisionCriticalEvidenceProjection;
  namedLensAttemptRefs: NamedLensProviderAttemptRef[];
  namedLensDispositions: NamedLensFinalizationDisposition[];
  namedLensPassages: NamedLensPassage[];
  underwritingPresentationReportId: string;
  namedLensPresentation: NamedLensPresentation;
  terminalStatus: "completed" | "partial";
  terminalReasonCodes: string[];
}

export interface CandidateArtifactBundle
  extends Omit<
    CandidateFinalization,
    | "workerId"
    | "leaseToken"
    | "candidateRunId"
    | "evidencePackBuildInputFingerprint"
  > {
  candidateRunId: string;
  sourceCandidateRunId: string;
  workspaceId: string;
  dealId: string;
  claimEdges: ClaimEdge[];
  namedLensProviderAttempts?: NamedLensProviderAttempt[];
}

export interface CurrentCandidateArtifactBundle
  extends CandidateArtifactBundle {
  versionSnapshot: CurrentCandidateVersionSnapshot;
  namedLensCatalogConsiderations: NamedLensCatalogConsideration[];
  decisionCriticalEvidenceProjection: DecisionCriticalEvidenceProjection;
  namedLensAttemptRefs: NamedLensProviderAttemptRef[];
  namedLensProviderAttempts: NamedLensProviderAttempt[];
  namedLensDispositions: NamedLensFinalizationDisposition[];
  namedLensPassages: NamedLensPassage[];
  underwritingPresentationReportId: string;
  namedLensPresentation: NamedLensPresentation;
  terminalStatus: "completed" | "partial";
  terminalReasonCodes: string[];
}

export interface ReusableCandidateArtifacts {
  candidateRunId: string;
  workspaceId: string;
  dealId: string;
  candidateAnalysisFingerprint: string;
  terminalStatus: "completed" | "partial";
  terminalReasonCodes: string[];
}

export interface ArtifactRowCounts {
  evidencePacks: number;
  contexts: number;
  scenarioModels: number;
  calculations: number;
  judgments: number;
  disagreements: number;
  valuations: number;
  decisions: number;
  narratives: number;
  actionDrafts: number;
  claimEdges: number;
  versionSnapshots: number;
  decisionCriticalEvidenceProjections: number;
  namedLensProviderAttemptEvents: number;
  namedLensDispositions: number;
  namedLensPassages: number;
  namedLensPassageSegments: number;
  underwritingPresentations: number;
}

export interface UnderwritingArtifactsRepository {
  findReusable(input: {
    workspaceId: string;
    candidateAnalysisFingerprint: string;
  }): Promise<ReusableCandidateArtifacts | null>;
  getByCandidateRunId(input: {
    workspaceId: string;
    candidateRunId: string;
  }): Promise<CandidateArtifactBundle | null>;
  listFinalizedForWorkspace(input: {
    workspaceId: string;
  }): Promise<CandidateArtifactBundle[]>;
  listActionDrafts(input: {
    workspaceId: string;
    candidateRunId: string;
  }): Promise<ActionDraft[]>;
  replaceActionDraftBody(input: {
    workspaceId: string;
    draftId: string;
    body: string;
  }): Promise<ActionDraft | null>;
}

export interface NamedLensProviderAttemptState {
  recordNamedLensProviderAttempt(attempt: NamedLensProviderAttempt): void;
  listNamedLensProviderAttempts(input: {
    workspaceId: string;
    artifactSourceCandidateRunId: string;
  }): NamedLensProviderAttempt[];
}

export interface MemoryUnderwritingArtifactsRepository
  extends UnderwritingArtifactsRepository, NamedLensProviderAttemptState {
  readonly namedLensArtifacts: MemoryNamedLensArtifactsRepository;
  prepareFinalization(input: {
    candidate: {
      id: string;
      workspaceId: string;
      dealId: string;
      fundPolicySnapshotId: string;
      fundPolicyValues?: FundPolicySnapshot["values"];
    };
    finalization: CandidateFinalization;
  }): CandidateArtifactBundle;
  commitPrepared(bundle: CandidateArtifactBundle): void;
  aliasCandidate(input: {
    workspaceId: string;
    candidateRunId: string;
    sourceCandidateRunId: string;
    dealId: string;
    candidateAnalysisFingerprint: string;
  }): void;
  inspect(): {
    bundles: CandidateArtifactBundle[];
    rowCounts: ArtifactRowCounts;
  };
}

export function createMemoryUnderwritingArtifactsRepository(options: {
  now?: () => Date;
  namedLensArtifacts?: MemoryNamedLensArtifactsRepository;
} = {}): MemoryUnderwritingArtifactsRepository {
  const now = options.now ?? (() => new Date());
  const bundles = new Map<string, CandidateArtifactBundle>();
  const reusable = new Map<string, ReusableCandidateArtifacts>();
  const aliases = new Map<string, {
    sourceCandidateRunId: string;
    terminalStatus: "completed" | "partial";
    terminalReasonCodes: string[];
  }>();
  const namedLensArtifacts = options.namedLensArtifacts
    ?? createMemoryNamedLensArtifactsRepository({
      candidateLeaseAuthority:
        createMemoryUnderwritingCandidateLeaseAuthority({ now }),
    });

  return {
    namedLensArtifacts,
    async findReusable(input) {
      const workspaceId = requiredText(input.workspaceId, "A workspace");
      const candidateAnalysisFingerprint = requiredText(
        input.candidateAnalysisFingerprint,
        "A candidate analysis fingerprint",
      );
      const value = reusable.get(
        identity(workspaceId, candidateAnalysisFingerprint),
      );
      return value ? structuredClone(value) : null;
    },

    async getByCandidateRunId(input) {
      const workspaceId = requiredText(input.workspaceId, "A workspace");
      const candidateRunId = requiredText(
        input.candidateRunId,
        "A candidate run",
      );
      const candidateKey = identity(workspaceId, candidateRunId);
      const alias = aliases.get(candidateKey);
      const artifactCandidateRunId = alias?.sourceCandidateRunId
        ?? candidateRunId;
      const value = bundles.get(identity(
        workspaceId,
        artifactCandidateRunId,
      ));
      if (!value) return null;
      const bundle = structuredClone(value);
      return alias
        ? {
          ...bundle,
          candidateRunId,
          sourceCandidateRunId: artifactCandidateRunId,
          terminalStatus: alias.terminalStatus,
          terminalReasonCodes: structuredClone(alias.terminalReasonCodes),
        }
        : {
          ...bundle,
          candidateRunId,
          sourceCandidateRunId: candidateRunId,
        };
    },

    async listFinalizedForWorkspace(input) {
      const workspaceId = requiredText(input.workspaceId, "A workspace");
      return [...bundles.values()]
        .filter((bundle) => bundle.workspaceId === workspaceId)
        .sort((left, right) =>
          left.candidateRunId.localeCompare(right.candidateRunId)
        )
        .map((bundle) => structuredClone(bundle));
    },

    async listActionDrafts(input) {
      const bundle = await this.getByCandidateRunId({
        workspaceId: input.workspaceId,
        candidateRunId: input.candidateRunId,
      });
      return bundle
        ? bundle.actionDrafts
          .map((draft) => structuredClone(draft))
          .sort((left, right) =>
            left.createdAt.localeCompare(right.createdAt)
            || left.id.localeCompare(right.id)
          )
        : [];
    },

    async replaceActionDraftBody(input) {
      const workspaceId = requiredText(input.workspaceId, "A workspace");
      const draftId = requiredText(input.draftId, "An action draft");
      const body = requiredBody(input.body);
      const matches = [...bundles.values()].flatMap((bundle) =>
        bundle.workspaceId === workspaceId
          ? bundle.actionDrafts.flatMap((draft, index) =>
            draft.id === draftId ? [{ bundle, draft, index }] : []
          )
          : []
      );
      if (matches.length === 0) return null;
      if (matches.length !== 1) {
        throw new Error(
          "Action draft identity is ambiguous inside the workspace.",
        );
      }
      const { bundle, draft, index } = matches[0];
      const readableDraft = parseActionDraftRead(draft);
      const updated = ActionDraftSchema.parse({
        ...readableDraft,
        body,
        updatedAt: now().toISOString(),
      });
      bundle.actionDrafts[index] = updated;
      return structuredClone(updated);
    },

    recordNamedLensProviderAttempt(value) {
      namedLensArtifacts.recordAttemptEvent(value);
    },

    listNamedLensProviderAttempts(input) {
      const workspaceId = requiredText(input.workspaceId, "A workspace");
      const candidateRunId = requiredText(
        input.artifactSourceCandidateRunId,
        "An artifact source candidate run",
      );
      return namedLensArtifacts.listAttemptsSync(workspaceId, candidateRunId);
    },

    prepareFinalization({ candidate, finalization }) {
      return prepareCandidateFinalization(candidate, finalization, {
        persistedNamedLensProviderAttempts:
          finalization.namedLensAttemptRefs === undefined
            ? undefined
            : this.listNamedLensProviderAttempts({
              workspaceId: candidate.workspaceId,
              artifactSourceCandidateRunId: candidate.id,
            }),
      });
    },

    commitPrepared(bundle) {
      const key = identity(bundle.workspaceId, bundle.candidateRunId);
      if (bundles.has(key)) {
        throw new Error("Candidate artifacts are immutable once finalized.");
      }
      const reuseKey = identity(
        bundle.workspaceId,
        bundle.candidateAnalysisFingerprint,
      );
      if (reusable.has(reuseKey)) {
        throw new Error(
          "This candidate analysis fingerprint is already finalized.",
        );
      }
      const saved = structuredClone(bundle);
      bundles.set(key, saved);
      reusable.set(reuseKey, {
        candidateRunId: saved.candidateRunId,
        workspaceId: saved.workspaceId,
        dealId: saved.dealId,
        candidateAnalysisFingerprint: saved.candidateAnalysisFingerprint,
        terminalStatus: saved.terminalStatus ?? "completed",
        terminalReasonCodes: structuredClone(saved.terminalReasonCodes ?? []),
      });
    },

    aliasCandidate(input) {
      const workspaceId = requiredText(input.workspaceId, "A workspace");
      const candidateRunId = requiredText(
        input.candidateRunId,
        "A candidate run",
      );
      const sourceCandidateRunId = requiredText(
        input.sourceCandidateRunId,
        "A source candidate run",
      );
      const candidateKey = identity(workspaceId, candidateRunId);
      const sourceKey = identity(workspaceId, sourceCandidateRunId);
      if (bundles.has(candidateKey) || aliases.has(candidateKey)) {
        throw new Error("Candidate artifacts are immutable once finalized.");
      }
      if (aliases.has(sourceKey)) {
        throw new Error("Reusable candidate aliases may resolve exactly one hop.");
      }
      const source = bundles.get(sourceKey);
      if (
        !source
        || !["completed", "partial"].includes(
          source.terminalStatus ?? "completed",
        )
        || source.dealId !== requiredText(input.dealId, "A Deal")
        || source.candidateAnalysisFingerprint
          !== requiredText(
            input.candidateAnalysisFingerprint,
            "A candidate analysis fingerprint",
          )
      ) {
        throw new Error(
          "Reusable candidate artifacts do not match the immutable rerun.",
        );
      }
      aliases.set(candidateKey, {
        sourceCandidateRunId,
        terminalStatus: source.terminalStatus ?? "completed",
        terminalReasonCodes: structuredClone(source.terminalReasonCodes ?? []),
      });
    },

    inspect() {
      const values = [...bundles.values()].map((bundle) =>
        structuredClone(bundle)
      );
      const rowCounts = values.reduce<ArtifactRowCounts>(
        (counts, bundle) => ({
          evidencePacks: counts.evidencePacks + 1,
          contexts: counts.contexts + 1,
          scenarioModels: counts.scenarioModels + 1,
          calculations: counts.calculations + bundle.calculations.length,
          judgments: counts.judgments + bundle.judgments.length,
          disagreements: counts.disagreements + bundle.disagreements.length,
          valuations: counts.valuations + 1,
          decisions: counts.decisions + 1,
          narratives: counts.narratives + 1,
          actionDrafts: counts.actionDrafts + bundle.actionDrafts.length,
          claimEdges: counts.claimEdges + bundle.claimEdges.length,
          versionSnapshots: counts.versionSnapshots + 1,
          decisionCriticalEvidenceProjections:
            counts.decisionCriticalEvidenceProjections
            + (bundle.decisionCriticalEvidenceProjection ? 1 : 0),
          namedLensProviderAttemptEvents: 0,
          namedLensDispositions: counts.namedLensDispositions
            + (bundle.namedLensDispositions?.length ?? 0),
          namedLensPassages: counts.namedLensPassages
            + (bundle.namedLensPassages?.length ?? 0),
          namedLensPassageSegments: counts.namedLensPassageSegments
            + ((bundle.namedLensPassages?.length ?? 0) * 5),
          underwritingPresentations: counts.underwritingPresentations
            + (bundle.namedLensPresentation ? 1 : 0),
        }),
        emptyRowCounts(),
      );
      rowCounts.namedLensProviderAttemptEvents =
        namedLensArtifacts.inspect().rawAttemptEvents.length;
      return {
        bundles: values,
        rowCounts,
      };
    },
  };
}

export function createSupabaseUnderwritingArtifactsRepository(options: {
  url: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}): UnderwritingArtifactsRepository {
  const base = `${options.url.replace(/\/$/, "")}/rest/v1`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = {
    apikey: options.serviceRoleKey,
    Authorization: `Bearer ${options.serviceRoleKey}`,
    "Content-Type": "application/json",
  };

  async function request(
    pathname: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${pathname}`, {
        ...init,
        headers,
        cache: "no-store",
        ...(init.body === undefined ? {} : { body: init.body }),
      });
    } catch {
      throw new IntegrationTransportError({ retryable: true });
    }
    if (!response.ok) {
      throw new IntegrationTransportError({
        retryable: isRetryableTransportStatus(response.status),
      });
    }
    const body = await response.text();
    return body.trim() ? JSON.parse(body) : null;
  }

  async function rows(
    table: string,
    workspaceId: string,
    candidateRunId: string,
    extra = "",
  ): Promise<Array<Record<string, unknown>>> {
    return await request(
      `/${table}?workspace_id=eq.${encodeURIComponent(workspaceId)}`
        + `&candidate_run_id=eq.${encodeURIComponent(candidateRunId)}`
        + extra,
    ) as Array<Record<string, unknown>>;
  }

  const repository: UnderwritingArtifactsRepository = {
    async findReusable(input) {
      const workspaceId = requiredText(input.workspaceId, "A workspace");
      const fingerprint = requiredText(
        input.candidateAnalysisFingerprint,
        "A candidate analysis fingerprint",
      );
      const query = new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        candidate_analysis_fingerprint: `eq.${fingerprint}`,
        status: "in.(completed,partial)",
        artifact_source_candidate_run_id: "is.null",
        select:
          "id,workspace_id,deal_id,status,unavailable_reason_codes,candidate_analysis_fingerprint",
        limit: "1",
      });
      const values = await request(`/candidate_runs?${query}`) as Array<
        Record<string, unknown>
      >;
      const value = values[0];
      return value
        ? {
          candidateRunId: String(value.id),
          workspaceId: String(value.workspace_id),
          dealId: String(value.deal_id),
          candidateAnalysisFingerprint: String(
            value.candidate_analysis_fingerprint,
          ),
          terminalStatus: value.status === "partial" ? "partial" : "completed",
          terminalReasonCodes: Array.isArray(value.unavailable_reason_codes)
            ? value.unavailable_reason_codes.map(String)
            : [],
        }
        : null;
    },

    async getByCandidateRunId(input) {
      const workspaceId = requiredText(input.workspaceId, "A workspace");
      const candidateRunId = requiredText(
        input.candidateRunId,
        "A candidate run",
      );
      const candidateQuery = new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        id: `eq.${candidateRunId}`,
        status: "in.(completed,partial)",
        select:
          "id,batch_id,workspace_id,deal_id,status,candidate_analysis_fingerprint,artifact_source_candidate_run_id,unavailable_reason_codes,rerun_of_id",
        limit: "2",
      });
      const candidates = await request(
        `/candidate_runs?${candidateQuery}`,
      ) as Array<Record<string, unknown>>;
      if (candidates.length === 0) return null;
      if (candidates.length !== 1) {
        throw new Error("Candidate artifact identity is ambiguous.");
      }
      const candidate = candidates[0]!;
      const artifactCandidateRunId =
        typeof candidate.artifact_source_candidate_run_id === "string"
          ? candidate.artifact_source_candidate_run_id
          : candidateRunId;
      let sourceCandidate = candidate;
      if (artifactCandidateRunId !== candidateRunId) {
        const sourceQuery = new URLSearchParams({
          workspace_id: `eq.${workspaceId}`,
          id: `eq.${artifactCandidateRunId}`,
          status: "in.(completed,partial)",
          select:
            "id,batch_id,workspace_id,deal_id,status,candidate_analysis_fingerprint,artifact_source_candidate_run_id,unavailable_reason_codes,rerun_of_id",
          limit: "2",
        });
        const sources = await request(
          `/candidate_runs?${sourceQuery}`,
        ) as Array<Record<string, unknown>>;
        if (sources.length !== 1) {
          throw new Error(
            "Candidate artifact alias requires exactly one canonical source.",
          );
        }
        sourceCandidate = sources[0]!;
        const aliasReasons = parseTerminalReasonCodes(candidate);
        const sourceReasons = parseTerminalReasonCodes(sourceCandidate);
        if (
          candidate.rerun_of_id !== artifactCandidateRunId
          || sourceCandidate.artifact_source_candidate_run_id !== null
          || sourceCandidate.workspace_id !== workspaceId
          || sourceCandidate.deal_id !== candidate.deal_id
          || sourceCandidate.candidate_analysis_fingerprint
            !== candidate.candidate_analysis_fingerprint
          || sourceCandidate.status !== candidate.status
          || !isDeepStrictEqual(sourceReasons, aliasReasons)
        ) {
          throw new Error(
            "Candidate artifact alias does not exactly match its canonical source.",
          );
        }
      }
      const batchQuery = new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        id: `eq.${String(sourceCandidate.batch_id)}`,
        select: "fund_policy_snapshot_id",
        limit: "2",
      });
      const batchRows = await request(
        `/underwriting_batches?${batchQuery}`,
      ) as Array<Record<string, unknown>>;
      if (batchRows.length !== 1) {
        throw new Error(
          "Completed candidate artifacts are missing their pinned Fund Policy.",
        );
      }

      const [
        evidenceRows,
        contextRows,
        scenarioRows,
        calculationRows,
        judgmentRows,
        disagreementRows,
        valuationRows,
        decisionRows,
        narrativeRows,
        draftRows,
        edgeRows,
        versionRows,
        criticalProjectionRows,
        namedLensAttemptEventRows,
        namedLensDispositionRows,
        namedLensPassageRows,
        namedLensSegmentRows,
        presentationRows,
      ] = await Promise.all([
        rows(
          "evidence_packs",
          workspaceId,
          artifactCandidateRunId,
          "&limit=1",
        ),
        rows(
          "candidate_context_snapshots",
          workspaceId,
          artifactCandidateRunId,
          "&limit=1",
        ),
        rows(
          "scenario_models",
          workspaceId,
          artifactCandidateRunId,
          "&limit=1",
        ),
        rows(
          "underwriting_calculations",
          workspaceId,
          artifactCandidateRunId,
          "&order=artifact_id.asc",
        ),
        rows(
          "framework_judgment_artifacts",
          workspaceId,
          artifactCandidateRunId,
          "&order=artifact_id.asc",
        ),
        rows(
          "framework_disagreement_artifacts",
          workspaceId,
          artifactCandidateRunId,
          "&order=artifact_id.asc",
        ),
        rows(
          "valuation_evaluations",
          workspaceId,
          artifactCandidateRunId,
          "&limit=1",
        ),
        rows(
          "final_syntheses",
          workspaceId,
          artifactCandidateRunId,
          "&limit=1",
        ),
        rows(
          "underwriting_narratives",
          workspaceId,
          artifactCandidateRunId,
          "&limit=1",
        ),
        rows(
          "action_drafts",
          workspaceId,
          artifactCandidateRunId,
          "&order=artifact_id.asc",
        ),
        rows(
          "underwriting_claim_edges",
          workspaceId,
          artifactCandidateRunId,
          "&order=claim_item_id.asc,dependency_type.asc,dependency_item_id.asc",
        ),
        rows(
          "candidate_version_snapshots",
          workspaceId,
          artifactCandidateRunId,
          "&limit=1",
        ),
        rows(
          "decision_critical_evidence_projections",
          workspaceId,
          artifactCandidateRunId,
          "&limit=2",
        ),
        rows(
          "named_lens_passage_attempt_events",
          workspaceId,
          artifactCandidateRunId,
          "&order=logical_passage_id.asc,attempt_no.asc,created_at.asc",
        ),
        rows(
          "named_lens_dispositions",
          workspaceId,
          artifactCandidateRunId,
          "&order=catalog_ordinal.asc",
        ),
        rows(
          "named_lens_passages",
          workspaceId,
          artifactCandidateRunId,
          "&order=judgment_id.asc",
        ),
        rows(
          "named_lens_passage_segments",
          workspaceId,
          artifactCandidateRunId,
          "&order=judgment_id.asc,segment_ordinal.asc",
        ),
        rows(
          "underwriting_presentations",
          workspaceId,
          artifactCandidateRunId,
          "&limit=2",
        ),
      ]);
      if (
        !evidenceRows[0]
        || !contextRows[0]
        || !scenarioRows[0]
        || !valuationRows[0]
        || !decisionRows[0]
        || !narrativeRows[0]
        || !versionRows[0]
      ) {
        throw new Error(
          "Completed candidate artifacts are incomplete or inconsistent.",
        );
      }
      const persistedEdges = edgeRows.map((row) =>
        ClaimEdgeSchema.parse({
          claimItemId: row.claim_item_id,
          dependencyItemId: row.dependency_item_id,
          dependencyType: row.dependency_type,
        })
      );
      const persistedCalculationIds = new Set(
        calculationRows.map((row) => String(row.artifact_id)),
      );
      const calculationClaimEdges = persistedEdges.filter((edge) =>
        edge.dependencyType === "calculation"
        && persistedCalculationIds.has(edge.claimItemId)
        && persistedCalculationIds.has(edge.dependencyItemId)
      );
      let fundPolicyValues: FundPolicySnapshot["values"] | undefined;
      if (calculationRows.length > 0) {
        const policyQuery = new URLSearchParams({
          workspace_id: `eq.${workspaceId}`,
          id: `eq.${String(batchRows[0].fund_policy_snapshot_id)}`,
          select: "values",
          limit: "2",
        });
        const policyRows = await request(
          `/fund_policy_versions?${policyQuery}`,
        ) as Array<Record<string, unknown>>;
        if (policyRows.length !== 1) {
          throw new Error(
            "Completed candidate artifacts are missing their exact pinned Fund Policy values.",
          );
        }
        fundPolicyValues = FundPolicySnapshotSchema.shape.values.parse(
          policyRows[0].values,
        );
      }
      const persistedVersionSnapshot = CandidateVersionSnapshotSchema.parse(
        versionRows[0].payload,
      );
      const namedLensVersions = [
        persistedVersionSnapshot.namedLensSelectionPolicyVersion,
        persistedVersionSnapshot.namedLensPassageSchemaVersion,
        persistedVersionSnapshot.namedLensGeneratorVersion,
        persistedVersionSnapshot.underwritingPresentationSchemaVersion,
        persistedVersionSnapshot.decisionTaxonomyVersion,
      ];
      const readableNamedLens = namedLensVersions.every(
        (value) => value !== undefined,
      );
      const anyNamedLensRows = [
        criticalProjectionRows,
        namedLensAttemptEventRows,
        namedLensDispositionRows,
        namedLensPassageRows,
        namedLensSegmentRows,
        presentationRows,
      ].some((values) => values.length > 0);
      let persistedNamedLensProviderAttempts:
        | NamedLensProviderAttempt[]
        | undefined;
      let currentNamedLensArtifacts: Partial<CandidateFinalization> = {};
      if (readableNamedLens) {
        if (
          criticalProjectionRows.length !== 1
          || presentationRows.length !== 1
        ) {
          throw new Error(
            "Current persisted Named Lens artifacts require one projection and one presentation.",
          );
        }
        const reconstructed = reconstructNamedLensPersistence({
          dispositionRows: namedLensDispositionRows,
          passageRows: namedLensPassageRows,
          segmentRows: namedLensSegmentRows,
        });
        persistedNamedLensProviderAttempts = collapseNamedLensAttemptEvents(
          namedLensAttemptEventRows.map((row) =>
            NamedLensProviderAttemptSchema.parse(row.payload)
          ),
        );
        const projection = DecisionCriticalEvidenceProjectionSchema.parse(
          criticalProjectionRows[0]!.payload,
        );
        const presentation = NamedLensPresentationSchema.parse(
          presentationRows[0]!.payload,
        );
        const terminalStatus = parsePersistedTerminalStatus(sourceCandidate);
        const persistedReasonCodes = parseTerminalReasonCodes(sourceCandidate);
        const applicable = reconstructed.catalogConsiderations.filter(
          ({ initialDisposition }) =>
            initialDisposition === "judgment_eligible",
        );
        const unavailableApplicable = applicable.filter(
          ({ judgmentOrCatalogCandidateId }) => {
            const disposition = reconstructed.dispositions.find((value) =>
              value.judgmentOrCatalogCandidateId
                === judgmentOrCatalogCandidateId
            );
            return disposition?.disposition !== "selected_main"
              && disposition?.disposition !== "appendix_only";
          },
        );
        const completedLimited = terminalStatus === "completed"
          && reconstructed.passages.length < 4
          && applicable.length < 4
          && reconstructed.passages.length === applicable.length
          && unavailableApplicable.length === 0;
        const expectedCompletedReasonCodes = completedLimited
          ? ["limited_framework_coverage"]
          : [];
        if (
          terminalStatus === "completed"
          && !isDeepStrictEqual(
            persistedReasonCodes,
            expectedCompletedReasonCodes,
          )
        ) {
          throw new Error(
            "Completed canonical candidate reason codes must exactly match its derived Framework coverage.",
          );
        }
        currentNamedLensArtifacts = {
          namedLensCatalogConsiderations:
            reconstructed.catalogConsiderations,
          decisionCriticalEvidenceProjection: projection,
          namedLensAttemptRefs: persistedNamedLensProviderAttempts.map(
            (attempt) => ({
              judgmentOrCatalogCandidateId:
                attempt.judgmentOrCatalogCandidateId,
              logicalPassageId: attempt.logicalPassageId,
              attemptNumber: attempt.attemptNumber,
              attemptFingerprint: attempt.attemptFingerprint,
            }),
          ),
          namedLensDispositions: reconstructed.dispositions,
          namedLensPassages: reconstructed.passages,
          underwritingPresentationReportId: requiredText(
            String(presentationRows[0]!.report_id),
            "An Underwriting presentation report",
          ),
          namedLensPresentation: presentation,
          terminalStatus,
          terminalReasonCodes: persistedReasonCodes,
        };
      } else if (anyNamedLensRows) {
        throw new Error(
          "Legacy persisted reads cannot contain current Named Lens rows.",
        );
      }
      const prepared = prepareCandidateFinalization(
        {
          id: artifactCandidateRunId,
          workspaceId,
          dealId: String(sourceCandidate.deal_id),
          fundPolicySnapshotId: String(
            batchRows[0].fund_policy_snapshot_id,
          ),
          fundPolicyValues,
        },
        {
          workerId: "persisted",
          leaseToken: "persisted",
          candidateRunId: artifactCandidateRunId,
          candidateAnalysisFingerprint: String(
            sourceCandidate.candidate_analysis_fingerprint,
          ),
          evidencePack: evidenceRows[0].payload as EvidencePack,
          context: contextRows[0].payload as ResolvedUnderwritingContext,
          scenarioModel: scenarioRows[0].payload as ScenarioModel,
          calculations: calculationRows.map((row) =>
            row.payload as Calculation
          ),
          calculationClaimEdges,
          judgments: judgmentRows.map((row) =>
            row.payload as FrameworkJudgment
          ),
          disagreements: disagreementRows.map((row) =>
            row.payload as FrameworkDisagreement
          ),
          valuation: valuationRows[0].payload as ValuationEvaluation,
          decision: decisionRows[0].payload as DecisionResult,
          narrative: String(narrativeRows[0].body),
          actionDrafts: draftRows.map((row) => row.payload as ActionDraft),
          versionSnapshot: persistedVersionSnapshot,
          ...currentNamedLensArtifacts,
        },
        {
          mode: "persisted_read",
          persistedNamedLensProviderAttempts,
        },
      );
      if (
        JSON.stringify(sortedClaimEdges(persistedEdges))
          !== JSON.stringify(sortedClaimEdges(prepared.claimEdges))
      ) {
        throw new Error(
          "Persisted candidate claim edges do not match artifact claims.",
        );
      }
      return {
        ...prepared,
        candidateRunId,
        sourceCandidateRunId: artifactCandidateRunId,
      };
    },
    async listFinalizedForWorkspace(input) {
      const workspaceId = requiredText(input.workspaceId, "A workspace");
      const query = new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        status: "in.(completed,partial)",
        artifact_source_candidate_run_id: "is.null",
        select: "id",
        order: "created_at.asc,id.asc",
      });
      const candidates = await request(`/candidate_runs?${query}`) as Array<
        Record<string, unknown>
      >;
      const values = await Promise.all(candidates.map((candidate) =>
        repository.getByCandidateRunId({
          workspaceId,
          candidateRunId: String(candidate.id),
        })
      ));
      return values.flatMap((value) => value ? [value] : []);
    },
    async listActionDrafts(input) {
      const bundle = await repository.getByCandidateRunId(input);
      return bundle
        ? bundle.actionDrafts
          .map((draft) => structuredClone(draft))
          .sort((left, right) =>
            left.createdAt.localeCompare(right.createdAt)
            || left.id.localeCompare(right.id)
          )
        : [];
    },
    async replaceActionDraftBody(input) {
      const workspaceId = requiredText(input.workspaceId, "A workspace");
      const draftId = requiredText(input.draftId, "An action draft");
      const body = requiredBody(input.body);
      const query = new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        artifact_id: `eq.${draftId}`,
        select: "payload",
        limit: "1",
      });
      const existingRows = await request(`/action_drafts?${query}`);
      if (!Array.isArray(existingRows) || !existingRows[0]) return null;
      const existingPayload = (existingRows[0] as Record<string, unknown>)
        .payload;
      const existing = parseActionDraftRead(existingPayload);
      ActionDraftSchema.parse({ ...existing, body });
      const value = await request("/rpc/replace_action_draft_body", {
        method: "POST",
        body: JSON.stringify({
          p_workspace_id: workspaceId,
          p_draft_id: draftId,
          p_body: body,
        }),
      }) as Record<string, unknown> | Record<string, unknown>[] | null;
      const row = Array.isArray(value) ? value[0] : value;
      return row ? parseActionDraftRead(row) : null;
    },
  };
  return repository;
}

export function prepareCandidateFinalization(
  candidate: {
    id: string;
    workspaceId: string;
    dealId: string;
    fundPolicySnapshotId: string;
    fundPolicyValues?: FundPolicySnapshot["values"];
  },
  input: Omit<CandidateFinalization, "evidencePackBuildInputFingerprint">,
  options: {
    mode?: "new_finalization" | "persisted_read";
    persistedNamedLensProviderAttempts?: NamedLensProviderAttempt[];
  } = {},
): CandidateArtifactBundle {
  const candidateRunId = requiredText(input.candidateRunId, "A candidate run");
  const workspaceId = requiredText(candidate.workspaceId, "A workspace");
  const dealId = requiredText(candidate.dealId, "A Deal");
  const isNewFinalization = options.mode !== "persisted_read";
  if (candidate.id !== candidateRunId) {
    throw new Error("Finalization candidate identity does not match.");
  }
  const evidencePack = EvidencePackSchema.parse(input.evidencePack);
  const context = ResolvedUnderwritingContextSchema.parse(input.context);
  const scenarioModel = ScenarioModelSchema.parse(input.scenarioModel);
  const calculations = input.calculations.map((value) =>
    CalculationSchema.parse(value)
  );
  const calculationClaimEdges = input.calculationClaimEdges.map((value) =>
    ClaimEdgeSchema.parse(value)
  );
  const versionSnapshot = CandidateVersionSnapshotSchema.parse(
    input.versionSnapshot,
  );
  const judgments = isNewFinalization
    ? input.judgments.map((value) =>
      FrameworkJudgmentSchema.parse(value)
    )
    : parsePersistedFrameworkJudgments({
      judgments: input.judgments,
      versionSnapshot,
    });
  const disagreements = input.disagreements.map((value) =>
    FrameworkDisagreementSchema.parse(value)
  );
  const valuation = ValuationEvaluationSchema.parse(input.valuation);
  const decision = DecisionResultSchema.parse(input.decision);
  const actionDrafts = input.actionDrafts.map((value) =>
    isNewFinalization
      ? ActionDraftSchema.parse(value)
      : parseActionDraftRead(value)
  );
  const namedLensCatalogConsiderations =
    input.namedLensCatalogConsiderations?.map((value) =>
      NamedLensCatalogConsiderationSchema.parse(value)
    );
  const decisionCriticalEvidenceProjection =
    input.decisionCriticalEvidenceProjection === undefined
      ? undefined
      : DecisionCriticalEvidenceProjectionSchema.parse(
        input.decisionCriticalEvidenceProjection,
      );
  const namedLensAttemptRefs = input.namedLensAttemptRefs?.map((value) =>
    NamedLensProviderAttemptRefSchema.parse(value)
  );
  const namedLensProviderAttempts = input.namedLensAttemptRefs === undefined
    ? undefined
    : (options.persistedNamedLensProviderAttempts ?? []).map((value) =>
      NamedLensProviderAttemptSchema.parse(value)
    );
  const namedLensDispositions = input.namedLensDispositions?.map((value) =>
    NamedLensFinalizationDispositionSchema.parse(value)
  );
  const namedLensPassages = input.namedLensPassages?.map((value) =>
    NamedLensPassageSchema.parse(value)
  );
  const namedLensPresentation = input.namedLensPresentation === undefined
    ? undefined
    : NamedLensPresentationSchema.parse(input.namedLensPresentation);
  const underwritingPresentationReportId =
    input.underwritingPresentationReportId;
  const terminalStatus = input.terminalStatus;
  const terminalReasonCodes = input.terminalReasonCodes;
  const namedLensArtifacts = [
    namedLensCatalogConsiderations,
    decisionCriticalEvidenceProjection,
    namedLensAttemptRefs,
    namedLensDispositions,
    namedLensPassages,
    underwritingPresentationReportId,
    namedLensPresentation,
    terminalStatus,
    terminalReasonCodes,
  ];
  const namedLensVersionValues = [
    versionSnapshot.namedLensSelectionPolicyVersion,
    versionSnapshot.namedLensPassageSchemaVersion,
    versionSnapshot.namedLensGeneratorVersion,
    versionSnapshot.underwritingPresentationSchemaVersion,
    versionSnapshot.decisionTaxonomyVersion,
  ];
  const namedLensIdentityValues = [
    versionSnapshot.decisionTaxonomyDigest,
    versionSnapshot.criticalEvidenceProjectionFingerprint,
    versionSnapshot.finalDispositionsFingerprint,
    versionSnapshot.presentationFingerprint,
    versionSnapshot.refreshNonce,
  ];
  const frameworkCatalogIdentityValues = [
    versionSnapshot.frameworkCatalogVersion,
    versionSnapshot.frameworkCatalogFingerprint,
    versionSnapshot.frameworkCorpusDigest,
  ];
  const hasAllNamedLensVersions = namedLensVersionValues.every(
    (value) => value !== undefined,
  );
  const hasCurrentNamedLensContract = hasAllNamedLensVersions
    && frameworkCatalogIdentityValues.every((value) => value !== undefined)
    && namedLensIdentityValues.every((value) => value !== undefined);
  const hasLegacyNamedLensV1Contract = !isNewFinalization
    && hasAllNamedLensVersions
    && (
      frameworkCatalogIdentityValues.every((value) => value === undefined)
      || frameworkCatalogIdentityValues.every((value) => value !== undefined)
    )
    && namedLensIdentityValues.every((value) => value === undefined)
    && namedLensArtifacts.every((value) => value !== undefined);
  const hasReadableNamedLensContract = hasCurrentNamedLensContract
    || hasLegacyNamedLensV1Contract;
  const hasLegacyNamedLensContract = namedLensVersionValues.every(
    (value) => value === undefined,
  ) && namedLensIdentityValues.every((value) => value === undefined)
    && namedLensArtifacts.every((value) => value === undefined);
  if (
    (isNewFinalization && !hasCurrentNamedLensContract)
    || (!hasReadableNamedLensContract && !hasLegacyNamedLensContract)
    || (hasReadableNamedLensContract
      && namedLensArtifacts.some((value) => value === undefined))
  ) {
    throw new Error(
      "Current Named Lens finalization requires all artifacts, versions, semantic fingerprints, and refresh identity.",
    );
  }
  if (hasReadableNamedLensContract) {
    judgments
      .filter(({ frameworkMetadata }) => frameworkMetadata !== undefined)
      .forEach((value) => CurrentFrameworkJudgmentSchema.parse(value));
    validateNamedLensFinalization({
      workspaceId,
      candidateRunId,
      catalogConsiderations: namedLensCatalogConsiderations!,
      decisionCriticalEvidenceProjection:
        decisionCriticalEvidenceProjection!,
      attemptRefs: namedLensAttemptRefs!,
      persistedAttempts: namedLensProviderAttempts!,
      dispositions: namedLensDispositions!,
      passages: namedLensPassages!,
      underwritingPresentationReportId:
        requiredText(
          underwritingPresentationReportId!,
          "An Underwriting presentation report",
        ),
      presentation: namedLensPresentation!,
      terminalStatus: terminalStatus!,
      terminalReasonCodes: terminalReasonCodes!,
      generatorVersion: versionSnapshot.namedLensGeneratorVersion!,
      evidencePack,
      judgments,
      decision,
    });
    if (hasCurrentNamedLensContract) {
      const {
        fingerprint: _presentationFingerprint,
        ...presentationWithoutFingerprint
      } = namedLensPresentation!;
      const semanticFingerprints = createNamedLensSemanticFingerprints({
        evidenceRefs: decisionCriticalEvidenceProjection!.evidenceRefs,
        dispositions: namedLensDispositions!,
        passages: namedLensPassages!,
        presentation: presentationWithoutFingerprint,
        formalJudgments: judgments,
      });
      const projectionFingerprint =
        createDecisionCriticalEvidenceProjectionFingerprint(
          decisionCriticalEvidenceProjection!.evidenceRefs,
          judgments,
        );
      if (
        versionSnapshot.decisionTaxonomyDigest
          !== DECISION_TAXONOMY_DIGEST
        || versionSnapshot.criticalEvidenceProjectionFingerprint
          !== projectionFingerprint
        || decisionCriticalEvidenceProjection!.fingerprint
          !== projectionFingerprint
        || versionSnapshot.finalDispositionsFingerprint
          !== semanticFingerprints.finalDispositionsFingerprint
        || versionSnapshot.presentationFingerprint
          !== namedLensPresentation!.fingerprint
        || versionSnapshot.presentationFingerprint
          !== semanticFingerprints.presentationFingerprint
      ) {
        throw new Error(
          "Current Named Lens version snapshot fingerprints must exactly match the finalized persistence graph.",
        );
      }
    }
  }
  const v2Drafts = actionDrafts.filter((draft): draft is ActionDraftV2 =>
    "schemaVersion" in draft && draft.schemaVersion === "action-draft-v2"
  );
  if (
    isNewFinalization
    && (
      context.analysisMode === undefined
      || actionDrafts.length === 0
      || v2Drafts.length !== actionDrafts.length
      || versionSnapshot.companyAnalysisUnknowns === undefined
    )
  ) {
    throw new Error(
      "New finalization requires the complete current status-safe artifact contract.",
    );
  }
  const usesCurrentContract = isNewFinalization
    || context.analysisMode !== undefined
    || v2Drafts.length > 0;
  if (usesCurrentContract) {
    const currentIdentity = {
      dealStatus: versionSnapshot.dealStatus,
      beliefDirection: versionSnapshot.beliefDirection,
      canonicalActions: versionSnapshot.canonicalActions,
      actionPolicyVersion: versionSnapshot.actionPolicyVersion,
      draftPolicyVersion: versionSnapshot.draftPolicyVersion,
      semanticContextAssumptionPolicyVersion:
        versionSnapshot.semanticContextAssumptionPolicyVersion,
      semanticContextMappingVersion:
        versionSnapshot.semanticContextMappingVersion,
      analysisMode: versionSnapshot.analysisMode,
      contextVersion: versionSnapshot.contextVersion,
      geography: versionSnapshot.geography,
      benchmarkCompatibility: versionSnapshot.benchmarkCompatibility,
    };
    if (
      Object.values(currentIdentity).some((value) => value === undefined)
      || context.analysisMode === undefined
      || v2Drafts.length !== actionDrafts.length
      || versionSnapshot.analysisMode !== context.analysisMode
      || versionSnapshot.contextVersion !== context.contextVersion
      || versionSnapshot.geography !== context.geography
      || versionSnapshot.benchmarkCompatibility
        !== context.benchmarkCompatibility
      || versionSnapshot.routerVersion !== CONTEXT_ROUTER_VERSION
    ) {
      throw new Error(
        "Current status-safe finalization requires complete belief, policy, and context identity.",
      );
    }
    const expectedActions = actionsForDealStatusAndDirection(
      versionSnapshot.dealStatus!,
      versionSnapshot.beliefDirection!,
    );
    const actionKinds = new Set(expectedActions.map(({ kind }) => kind));
    const expectedFormats = actionKinds.has("advance_diligence")
        || actionKinds.has("reopen_diligence")
      ? [
        "internal_memo",
        "founder_email",
        "founder_sms",
        "founder_linkedin",
        "diligence_request",
      ]
      : actionKinds.has("evaluate_follow_on")
      ? ["internal_memo", "founder_email", "diligence_request"]
      : ["internal_memo"];
    const actualFormats = v2Drafts.map(({ format }) => format);
    const expectedGenericMissingEvidence = buildCandidateMissingEvidence({
      criticalFieldIds: evidencePack.coverage.missingFieldIds,
    });
    const expectedMissingEvidence = [
      ...expectedGenericMissingEvidence,
      ...(versionSnapshot.companyAnalysisUnknowns ?? []).map((unknown) => ({
        ...unknown,
        reasonCode: "UNRESOLVED_COMPANY_OR_EVENT_UNKNOWN",
        mostLikelyDecisionImpact:
          "Resolving this company- or event-specific unknown may raise or lower the formal decision ceiling.",
      })),
    ].sort((left, right) => compareUtf8(left.fieldId, right.fieldId));
    const canonicalMissingEvidence = v2Drafts[0]?.missingEvidence ?? [];
    if (
      !beliefActionListsEqual(
        versionSnapshot.canonicalActions!,
        expectedActions,
      )
      || v2Drafts.some((draft) =>
        draft.dealStatus !== versionSnapshot.dealStatus
        || draft.beliefDirection !== versionSnapshot.beliefDirection
        || !beliefActionListsEqual(
          draft.actions,
          versionSnapshot.canonicalActions!,
        )
        || draft.actionPolicyVersion !== versionSnapshot.actionPolicyVersion
        || draft.draftPolicyVersion !== versionSnapshot.draftPolicyVersion
      )
      || actualFormats.length !== expectedFormats.length
      || expectedFormats.some((format) =>
        actualFormats.filter((actual) => actual === format).length !== 1
      )
      || !statusSafeMissingEvidenceMatches(
        canonicalMissingEvidence,
        expectedMissingEvidence,
      )
      || v2Drafts.some((draft) =>
        !isDeepStrictEqual(draft.missingEvidence, canonicalMissingEvidence)
      )
    ) {
      throw new Error(
        "Status-safe action drafts do not match the finalized belief identity.",
      );
    }
  }
  const narrative = requiredText(input.narrative, "A narrative");
  const candidateAnalysisFingerprint = requiredText(
    input.candidateAnalysisFingerprint,
    "A candidate analysis fingerprint",
  );

  if (
    evidencePack.workspaceId !== workspaceId
    || evidencePack.dealId !== dealId
    || scenarioModel.candidateRunId !== candidateRunId
    || actionDrafts.some((draft) =>
      draft.workspaceId !== workspaceId
      || draft.candidateRunId !== candidateRunId
    )
  ) {
    throw new Error(
      "Every finalized artifact must match the candidate workspace and identity.",
    );
  }
  if (
    context.criticalEvidenceProfileId
      !== versionSnapshot.criticalEvidenceProfileId
    || context.benchmarkPackId !== versionSnapshot.benchmarkPackId
    || context.valuationMethodPolicyId
      !== versionSnapshot.valuationMethodPolicyId
    || context.decisionPolicyId !== versionSnapshot.decisionPolicyId
    || context.frameworkPackId !== versionSnapshot.frameworkPackId
    || candidate.fundPolicySnapshotId !== versionSnapshot.fundPolicyId
  ) {
    throw new Error(
      "The candidate version snapshot must match the resolved context.",
    );
  }

  if (usesCurrentContract) {
    validateCurrentFrameworkJudgments({
      judgments,
      evidencePack,
      calculations,
    });
    validateValuationCalculationBinding({
      evidencePack,
      context,
      scenarioModel,
      valuation,
      calculations,
      calculationClaimEdges,
      formulaVersions: versionSnapshot.formulaVersions,
      fundPolicyValues: candidate.fundPolicyValues,
    });
    validatePartialUnderwritingTerminalSemantics({
      evidencePack,
      context,
      scenarioModel,
      calculations,
      calculationClaimEdges,
      judgments,
      disagreements,
      valuation,
      decision,
      actionDrafts,
      terminalStatus,
    });
  }

  assertUnique(calculations.map(({ id }) => id), "Calculation");
  assertUnique(judgments.map(({ id }) => id), "Framework judgment");
  assertUnique(disagreements.map(({ id }) => id), "Framework disagreement");
  assertUnique(actionDrafts.map(({ id }) => id), "Action draft");

  const calculationIds = new Set(calculations.map(({ id }) => id));
  if (
    valuation.calculationIds.some((id) => !calculationIds.has(id))
    || valuation.scenarios.some((scenario) =>
      scenario.calculationIds.some((id) => !calculationIds.has(id))
    )
  ) {
    throw new Error(
      "Valuation calculation references must resolve to saved calculations.",
    );
  }
  const judgmentIds = new Set(judgments.map(({ id }) => id));
  if (
    disagreements.some((value) =>
      !judgmentIds.has(value.leftJudgmentId)
      || !judgmentIds.has(value.rightJudgmentId)
    )
  ) {
    throw new Error(
      "Framework disagreements must reference saved judgments.",
    );
  }

  const evidenceIds = new Set([
    ...evidencePack.facts.map(({ id }) => id),
    ...evidencePack.assumptions.map(({ id }) => id),
  ]);
  const factIds = new Set(evidencePack.facts.map(({ id }) => id));
  const assumptionIds = new Set(
    evidencePack.assumptions.map(({ id }) => id),
  );
  const policyIds = new Set([
    versionSnapshot.fundPolicyId,
    versionSnapshot.criticalEvidenceProfileId,
    versionSnapshot.valuationMethodPolicyId,
    versionSnapshot.decisionPolicyId,
  ]);
  const benchmarkIds = new Set(
    versionSnapshot.benchmarkPackId
      ? [versionSnapshot.benchmarkPackId]
      : [],
  );
  const calculationPolicyIds = new Set([
    ...policyIds,
    "policy:initialCheckMax",
    "policy:acceptableFutureDilution",
    `policy:returnTargets.${context.stage}.grossMoic`,
    `policy:returnTargets.${context.stage}.horizonYears`,
  ]);
  const benchmarkAssumptions = new Map(
    evidencePack.assumptions
      .filter((assumption) =>
        assumption.provenanceOrigin === "benchmark"
        && assumption.inputRefIds.length === 1
        && assumption.inputRefIds[0] === versionSnapshot.benchmarkPackId
      )
      .map((assumption) => [assumption.id, assumption]),
  );
  const frameworkIds = new Set([
    versionSnapshot.frameworkPackId,
    ...judgments.map(({ frameworkCardId }) => frameworkCardId),
  ]);
  if (
    judgments.some((judgment) =>
      [
        ...judgment.supportEvidenceItemIds,
        ...judgment.counterEvidenceItemIds,
        ...judgment.unusedEvidenceItemIds,
      ].some((id) => !evidenceIds.has(id) && !calculationIds.has(id))
    )
    || decision.blockingEvidenceItemIds.some((id) => !evidenceIds.has(id))
  ) {
    throw new Error(
      "Judgment and decision evidence references must resolve to saved artifacts.",
    );
  }

  const claimEdges = [
    ...calculationClaimEdges,
    ...judgments.flatMap((judgment) => judgment.claimEdges),
    ...decision.claimEdges,
  ].map((edge) => ClaimEdgeSchema.parse(edge));
  assertUnique(
    claimEdges.map((edge) =>
      `${edge.claimItemId}\u0000${edge.dependencyType}\u0000${edge.dependencyItemId}`
    ),
    "Claim edge",
  );
  const dependencySets: Record<ClaimEdge["dependencyType"], Set<string>> = {
    fact: factIds,
    assumption: assumptionIds,
    calculation: calculationIds,
    framework_judgment: judgmentIds,
    policy_ref: policyIds,
    benchmark_ref: benchmarkIds,
    framework_ref: frameworkIds,
  };
  if (
    calculationClaimEdges.some((edge) =>
      edge.dependencyType !== "calculation"
      || !calculationIds.has(edge.claimItemId)
      || !calculationIds.has(edge.dependencyItemId)
    )
  ) {
    throw new Error(
      "Calculation claim edges must connect two saved calculations.",
    );
  }
  if (
    claimEdges.some((edge) =>
      !dependencySets[edge.dependencyType].has(edge.dependencyItemId)
    )
  ) {
    throw new Error(
      "Every typed claim dependency must resolve to a persisted artifact or version reference.",
    );
  }
  if (
    calculations.some((calculation) =>
      calculation.inputRefs.some((reference) => {
        const dependencies = reference.type === "fact"
          ? factIds
          : reference.type === "assumption"
          ? assumptionIds
          : reference.type === "policy"
          ? calculationPolicyIds
          : null;
        if (dependencies) return !dependencies.has(reference.itemId);
        const benchmarkAssumption = benchmarkAssumptions.get(reference.itemId);
        return !benchmarkAssumption
          || benchmarkAssumption.value !== reference.value;
      })
    )
  ) {
    throw new Error(
      "Every calculation input must resolve to persisted evidence or a version reference.",
    );
  }

  return {
    candidateRunId,
    sourceCandidateRunId: candidateRunId,
    workspaceId,
    dealId,
    candidateAnalysisFingerprint,
    evidencePack,
    context,
    scenarioModel,
    calculations,
    calculationClaimEdges,
    judgments,
    disagreements,
    valuation,
    decision,
    narrative,
    actionDrafts,
    versionSnapshot,
    ...(hasReadableNamedLensContract
      ? {
        namedLensAttemptRefs: namedLensAttemptRefs!,
        namedLensProviderAttempts: namedLensProviderAttempts!,
        namedLensCatalogConsiderations: namedLensCatalogConsiderations!,
        decisionCriticalEvidenceProjection:
          decisionCriticalEvidenceProjection!,
        namedLensDispositions: namedLensDispositions!,
        namedLensPassages: namedLensPassages!,
        underwritingPresentationReportId:
          underwritingPresentationReportId!,
        namedLensPresentation: namedLensPresentation!,
        terminalStatus: terminalStatus!,
        terminalReasonCodes: terminalReasonCodes!,
      }
      : {}),
    claimEdges,
  };
}

export function validateNamedLensFinalization(input: {
  workspaceId: string;
  candidateRunId: string;
  catalogConsiderations: NamedLensCatalogConsideration[];
  decisionCriticalEvidenceProjection: DecisionCriticalEvidenceProjection;
  attemptRefs: NamedLensProviderAttemptRef[];
  persistedAttempts: NamedLensProviderAttempt[];
  dispositions: NamedLensFinalizationDisposition[];
  passages: NamedLensPassage[];
  underwritingPresentationReportId: string;
  presentation: NamedLensPresentation;
  terminalStatus: "completed" | "partial";
  terminalReasonCodes: string[];
  generatorVersion: string;
  evidencePack: EvidencePack;
  judgments: FrameworkJudgment[];
  decision: DecisionResult;
}): void {
  const persistedAttempts = input.persistedAttempts.map((attempt) =>
    NamedLensProviderAttemptSchema.parse(attempt)
  );
  assertUnique(
    input.attemptRefs.map(({ logicalPassageId, attemptNumber }) =>
      `${logicalPassageId}\u0000${attemptNumber}`
    ),
    "Named Lens provider attempt reference",
  );
  assertUnique(
    persistedAttempts.map(({ logicalPassageId, attemptNumber }) =>
      `${logicalPassageId}\u0000${attemptNumber}`
    ),
    "Persisted Named Lens provider attempt",
  );
  assertUnique(
    input.catalogConsiderations.map(({ judgmentOrCatalogCandidateId }) =>
      judgmentOrCatalogCandidateId
    ),
    "Named Lens catalog consideration",
  );
  assertUnique(
    input.dispositions.map(({ judgmentOrCatalogCandidateId }) =>
      judgmentOrCatalogCandidateId
    ),
    "Named Lens disposition",
  );
  assertUnique(
    input.passages.map(({ judgmentId }) => judgmentId),
    "Named Lens passage",
  );
  assertUnique(
    input.passages.map(({ fingerprint }) => fingerprint),
    "Named Lens passage fingerprint",
  );
  const orderedPositions = input.dispositions
    .flatMap(({ selectedPosition }) =>
      selectedPosition === null ? [] : [selectedPosition]
    )
    .sort((left, right) => left - right);
  if (
    orderedPositions.some((position, index) => position !== index + 1)
  ) {
    throw new Error(
      "Selected Named Lens positions must be unique and contiguous from one.",
    );
  }
  if (
    orderedPositions.length > 6
  ) {
    throw new Error(
      "Named Lens finalization accepts at most six selected passages.",
    );
  }
  const authoritativeJudgments = input.judgments.filter((judgment) =>
    judgment.analysisType === "framework_judgment"
    && judgment.applicability === "applicable"
    && (
      judgment.conclusion === "supportive"
      || judgment.conclusion === "mixed"
      || judgment.conclusion === "negative"
    )
    && typeof judgment.frameworkMetadata === "object"
    && judgment.frameworkMetadata !== null
    && !Array.isArray(judgment.frameworkMetadata)
  );
  const judgmentEligibleConsiderations = input.catalogConsiderations.filter(
    ({ initialDisposition }) => initialDisposition === "judgment_eligible",
  );
  const matchesAuthoritativeJudgment = (
    consideration: NamedLensCatalogConsideration,
    judgment: FrameworkJudgment,
  ) => consideration.judgmentId === judgment.id
    && consideration.judgmentOrCatalogCandidateId === judgment.id
    && consideration.frameworkCardId === judgment.frameworkCardId
    && consideration.frameworkVersion === judgment.frameworkVersion;
  if (
    authoritativeJudgments.length !== judgmentEligibleConsiderations.length
    || authoritativeJudgments.some((judgment) =>
      !judgmentEligibleConsiderations.some((consideration) =>
        matchesAuthoritativeJudgment(consideration, judgment)
      )
    )
    || judgmentEligibleConsiderations.some((consideration) =>
      authoritativeJudgments.filter((judgment) =>
        matchesAuthoritativeJudgment(consideration, judgment)
      ).length !== 1
    )
  ) {
    throw new Error(
      "Every authoritative applicable advisory judgment requires exactly one matching judgment-eligible Named Lens catalog consideration.",
    );
  }
  const considerationIds = new Set(
    input.catalogConsiderations.map(({ judgmentOrCatalogCandidateId }) =>
      judgmentOrCatalogCandidateId
    ),
  );
  if (
    considerationIds.size !== input.dispositions.length
    || input.dispositions.some(({ judgmentOrCatalogCandidateId }) =>
      !considerationIds.has(judgmentOrCatalogCandidateId)
    )
    || input.catalogConsiderations.some((consideration) => {
      const disposition = input.dispositions.find((candidate) =>
        candidate.judgmentOrCatalogCandidateId
          === consideration.judgmentOrCatalogCandidateId
      );
      return !disposition
        || disposition.workspaceId !== consideration.workspaceId
        || disposition.artifactSourceCandidateRunId
          !== consideration.artifactSourceCandidateRunId
        || disposition.judgmentId !== consideration.judgmentId
        || disposition.frameworkCardId !== consideration.frameworkCardId
        || disposition.frameworkVersion !== consideration.frameworkVersion;
    })
  ) {
    throw new Error(
      "Every authorized Named Lens catalog consideration requires exactly one matching disposition.",
    );
  }
  const projection = input.decisionCriticalEvidenceProjection;
  if (
    projection.workspaceId !== input.workspaceId
    || projection.artifactSourceCandidateRunId !== input.candidateRunId
    || input.dispositions.some((disposition) =>
      disposition.decisionCriticalEvidenceProjectionId !== projection.id
      || disposition.decisionCriticalEvidenceProjectionFingerprint
        !== projection.fingerprint
    )
  ) {
    throw new Error(
      "Every Named Lens disposition must bind the authoritative decision-critical projection identity and fingerprint.",
    );
  }
  const attemptIdentity = (
    value: NamedLensProviderAttempt | NamedLensProviderAttemptRef,
  ) => `${value.judgmentOrCatalogCandidateId}\u0000${value.logicalPassageId}`
    + `\u0000${value.attemptNumber}\u0000${value.attemptFingerprint}`;
  const persistedAttemptIdentities = new Set(
    persistedAttempts.map(attemptIdentity),
  );
  const attemptRefIdentities = new Set(input.attemptRefs.map(attemptIdentity));
  const providerRequiredCandidates = new Set(
    input.catalogConsiderations
      .filter(({ initialDisposition }) =>
        initialDisposition === "judgment_eligible"
        || initialDisposition === "abstained"
        || initialDisposition === "unavailable"
      )
      .map(({ judgmentOrCatalogCandidateId }) =>
        judgmentOrCatalogCandidateId
      ),
  );
  if (
    persistedAttempts.some((attempt) =>
      attempt.workspaceId !== input.workspaceId
      || attempt.artifactSourceCandidateRunId !== input.candidateRunId
    )
    || persistedAttempts.some(({ status }) => status === "reserved")
    || persistedAttemptIdentities.size !== attemptRefIdentities.size
    || [...persistedAttemptIdentities].some((identity) =>
      !attemptRefIdentities.has(identity)
    )
    || [...attemptRefIdentities].some((identity) =>
      !persistedAttemptIdentities.has(identity)
    )
    || persistedAttempts.some(({ judgmentOrCatalogCandidateId }) =>
      !input.dispositions.some((disposition) =>
        disposition.judgmentOrCatalogCandidateId
          === judgmentOrCatalogCandidateId
      )
    )
    || [...providerRequiredCandidates].some((candidateId) =>
      !persistedAttempts.some(({ judgmentOrCatalogCandidateId }) =>
        judgmentOrCatalogCandidateId === candidateId
      )
    )
    || input.catalogConsiderations.some((consideration) =>
      consideration.initialDisposition === "abstained"
      && !persistedAttempts.some((attempt) =>
        attempt.judgmentOrCatalogCandidateId
          === consideration.judgmentOrCatalogCandidateId
        && attempt.status === "completed"
      )
    )
    || input.dispositions.some((disposition) =>
      disposition.passageFingerprint !== null
      && !persistedAttempts.some((attempt) =>
        attempt.judgmentOrCatalogCandidateId
          === disposition.judgmentOrCatalogCandidateId
        && attempt.status === "completed"
      )
    )
  ) {
    throw new Error(
      "Finalization requires candidate-local, settled persisted attempt rows covering every Named Lens provider execution and a completed attempt for each publishable passage.",
    );
  }
  const passageFingerprints = new Set(
    input.passages.map(({ fingerprint }) => fingerprint),
  );
  const dispositionPassageFingerprints = input.dispositions.flatMap(
    ({ passageFingerprint }) =>
      passageFingerprint === null ? [] : [passageFingerprint],
  );
  if (
    dispositionPassageFingerprints.length !== passageFingerprints.size
    || dispositionPassageFingerprints.some((fingerprint) =>
      !passageFingerprints.has(fingerprint)
    )
    || input.passages.some((passage) =>
      passage.workspaceId !== input.workspaceId
      || passage.artifactSourceCandidateRunId !== input.candidateRunId
      || passage.generatorVersion !== input.generatorVersion
    )
    || input.dispositions.some((disposition) =>
      disposition.workspaceId !== input.workspaceId
      || disposition.artifactSourceCandidateRunId !== input.candidateRunId
    )
    || input.presentation.workspaceId !== input.workspaceId
    || input.presentation.artifactSourceCandidateRunId !== input.candidateRunId
  ) {
    throw new Error(
      "Current Named Lens artifacts must form one complete candidate-local presentation.",
    );
  }
  const facts = new Set(input.evidencePack.facts.map(({ id }) => id));
  const assumptions = new Set(
    input.evidencePack.assumptions.map(({ id }) => id),
  );
  const evidenceIds = new Set([...facts, ...assumptions]);
  for (const evidence of projection.evidenceRefs) {
    DecisionCriticalEvidenceRefSchema.parse(evidence);
    const expectedClassification = facts.has(evidence.evidencePackItemId)
      ? "fact"
      : assumptions.has(evidence.evidencePackItemId)
      ? "assumption"
      : null;
    if (expectedClassification !== evidence.classification) {
      throw new Error(
        "Decision-critical projection classification must resolve to the saved Evidence Pack.",
      );
    }
  }
  const projectionEvidenceIds = new Set(
    projection.evidenceRefs.map(({ evidencePackItemId }) => evidencePackItemId),
  );
  const judgmentsById = new Map(
    input.judgments.map((judgment) => [judgment.id, judgment]),
  );
  const passagesByFingerprint = new Map(
    input.passages.map((passage) => [passage.fingerprint, passage]),
  );
  for (const disposition of input.dispositions) {
    const dispositionCriticalEvidenceIds = new Set(
      disposition.criticalEvidence.map(({ evidencePackItemId }) =>
        evidencePackItemId
      ),
    );
    for (const evidence of disposition.criticalEvidence) {
      const expectedClassification = facts.has(evidence.evidencePackItemId)
        ? "fact"
        : assumptions.has(evidence.evidencePackItemId)
        ? "assumption"
        : null;
      const projectedEvidence = projection.evidenceRefs.find((value) =>
        value.evidencePackItemId === evidence.evidencePackItemId
      );
      if (
        expectedClassification !== evidence.classification
        || !projectedEvidence
        || !isDeepStrictEqual(projectedEvidence, evidence)
      ) {
        throw new Error(
          "Decision-critical evidence must resolve exactly to the authoritative projection and saved Evidence Pack.",
        );
      }
    }
    if (
      disposition.selectionBasisEvidenceIds.some((id) =>
        !evidenceIds.has(id)
        || !projectionEvidenceIds.has(id)
        || !dispositionCriticalEvidenceIds.has(id)
      )
    ) {
      throw new Error(
        "Named Lens selection basis must resolve to the saved Evidence Pack.",
      );
    }
    const judgment = disposition.judgmentId === null
      ? null
      : judgmentsById.get(disposition.judgmentId);
    if (
      disposition.judgmentId !== null
      && (
        !judgment
        || disposition.judgmentOrCatalogCandidateId !== judgment.id
        || judgment.frameworkCardId !== disposition.frameworkCardId
        || judgment.frameworkVersion !== disposition.frameworkVersion
      )
    ) {
      throw new Error(
        "Named Lens disposition judgment identity must resolve exactly.",
      );
    }
    if (
      disposition.selectionBasisEvidenceIds.some((id) =>
        !judgment
        || ![
          ...judgment.supportEvidenceItemIds,
          ...judgment.counterEvidenceItemIds,
        ].includes(id)
      )
    ) {
      throw new Error(
        "Every Named Lens selection basis must resolve to its exact saved judgment evidence partition.",
      );
    }
    if (disposition.passageFingerprint === null) continue;
    const passage = passagesByFingerprint.get(disposition.passageFingerprint);
    const currentJudgment = judgment === null || judgment === undefined
      ? null
      : CurrentFrameworkJudgmentSchema.safeParse(judgment);
    if (
      !passage
      || !judgment
      || !currentJudgment?.success
      || disposition.judgmentOrCatalogCandidateId !== judgment.id
      || passage.judgmentId !== judgment.id
      || passage.frameworkCardId !== judgment.frameworkCardId
      || passage.frameworkVersion !== judgment.frameworkVersion
      || disposition.decisionQuestionCode !== passage.decisionQuestionCode
      || disposition.stance !== passage.conditionalConclusion.stance
      || disposition.advisoryPosture
        !== passage.conditionalConclusion.advisoryPosture
      || passage.conditionalConclusion.stance !== judgment.conclusion
      || !isDeepStrictEqual(
        passage.selectionBasisEvidenceIds,
        disposition.selectionBasisEvidenceIds,
      )
      || passage.caseApplication.evidenceItemIds.some((id) =>
        !evidenceIds.has(id)
      )
      || passage.caseApplication.evidenceItemIds.some((id) =>
        !judgment.supportEvidenceItemIds.includes(id)
      )
      || passage.countercase.evidenceItemIds.some((id) =>
        !evidenceIds.has(id)
      )
      || passage.countercase.evidenceItemIds.some((id) =>
        !judgment.counterEvidenceItemIds.includes(id)
      )
      || passage.selectionBasisEvidenceIds.some((id) =>
        !disposition.selectionBasisEvidenceIds.includes(id)
        || ![
          ...judgment.supportEvidenceItemIds,
          ...judgment.counterEvidenceItemIds,
        ].includes(id)
      )
      || passage.unknownBoundary.judgmentUnknownRefs.some((ref) =>
        !judgment.unknowns.includes(ref)
      )
      || passage.unknownBoundary.judgmentLimitationRefs.some((ref) =>
        !judgment.limitations.includes(ref)
      )
      || passage.countercase.boundaryKind
        !== currentJudgment.data.counterevidenceBoundary.kind
      || !isDeepStrictEqual(
        passage.countercase.evidenceRequestRefs,
        currentJudgment.data.counterevidenceBoundary.evidenceRequestRefs,
      )
    ) {
      throw new Error(
        "Named Lens passage segments must stay within the saved judgment partitions and identity.",
      );
    }
    if (
      !currentJudgment.data.frameworkMetadata
      || !frameworkPremiseResolvesExactly(
        passage.premise,
        currentJudgment.data.frameworkMetadata,
      )
    ) {
      throw new Error(
        "Named Lens premise must resolve to an exact advisory component Card field and public source claim.",
      );
    }
  }
  const selected = input.dispositions
    .filter((disposition) => disposition.disposition === "selected_main")
    .sort((left, right) => left.selectedPosition! - right.selectedPosition!);
  const selectedJudgmentIds = selected.map(({ judgmentId }) => judgmentId!);
  const selectedJudgmentIdSet = new Set(selectedJudgmentIds);
  const selectedPassages = selected.map(({ passageFingerprint }) =>
    passagesByFingerprint.get(passageFingerprint!)!
  );
  const selectedEvidenceIds = new Set(selected.flatMap((disposition) => [
    ...disposition.selectionBasisEvidenceIds,
    ...disposition.criticalEvidence.map(({ evidencePackItemId }) =>
      evidencePackItemId
    ),
  ]));
  const expectedFirstScreenEvidenceIds =
    selectFirstScreenDecisionEvidenceIds(projection.evidenceRefs);
  if (
    input.presentation.firstScreenProjectionRefs.decisionId
      !== input.decision.id
    || !isDeepStrictEqual(
      input.presentation.firstScreenProjectionRefs.selectedJudgmentIds,
      selectedJudgmentIds,
    )
    || !isDeepStrictEqual(
      input.presentation.firstScreenProjectionRefs.decisionEvidenceItemIds,
      expectedFirstScreenEvidenceIds,
    )
    || input.presentation.synthesis.judgmentIds.some((id) =>
      !selectedJudgmentIdSet.has(id)
    )
    || input.presentation.synthesis.evidenceItemIds.some((id) =>
      !evidenceIds.has(id) || !selectedEvidenceIds.has(id)
    )
  ) {
    throw new Error(
      "Named Lens presentation refs must resolve to the finalized decision, selections, and Evidence Pack.",
    );
  }
  const selectedPassagesByJudgment = new Map(
    selectedPassages.map((passage) => [passage.judgmentId, passage]),
  );
  for (const citation of input.presentation.segmentCitations) {
    const passage = selectedPassagesByJudgment.get(citation.judgmentId);
    const allowedEvidence = citation.segment === "case_application"
      ? passage?.caseApplication.evidenceItemIds ?? []
      : citation.segment === "countercase"
      ? passage?.countercase.evidenceItemIds ?? []
      : citation.segment === "synthesis"
      ? input.presentation.synthesis.evidenceItemIds
      : [];
    const allowedSources = citation.segment === "premise"
      ? passage?.premise.publicSourceIds ?? []
      : [];
    const allowedClaims = citation.segment === "premise"
      ? passage?.premise.claimIds ?? []
      : [];
    const allowedUnknowns = citation.segment === "unknown_boundary"
      ? passage?.unknownBoundary.judgmentUnknownRefs ?? []
      : [];
    const allowedLimitations = citation.segment === "unknown_boundary"
      ? passage?.unknownBoundary.judgmentLimitationRefs ?? []
      : [];
    const allowedEvidenceRequests = citation.segment === "unknown_boundary"
      ? passage?.unknownBoundary.evidenceRequestRefs ?? []
      : citation.segment === "countercase"
      ? passage?.countercase.evidenceRequestRefs ?? []
      : [];
    const allowedStances = citation.segment === "conditional_conclusion"
      ? [passage?.conditionalConclusion.stance]
      : [];
    const allowedAdvisoryPostures =
      citation.segment === "conditional_conclusion"
        ? [passage?.conditionalConclusion.advisoryPosture]
        : [];
    if (
      !passage
      || citation.evidenceItemIds.some((id) =>
        !allowedEvidence.includes(id)
      )
      || citation.publicSourceIds.some((id) => !allowedSources.includes(id))
      || citation.claimIds.some((id) => !allowedClaims.includes(id))
      || citation.judgmentUnknownRefs.some((ref) =>
        !allowedUnknowns.includes(ref)
      )
      || citation.judgmentLimitationRefs.some((ref) =>
        !allowedLimitations.includes(ref)
      )
      || citation.evidenceRequestRefs.some((ref) =>
        !allowedEvidenceRequests.includes(ref)
      )
      || citation.stanceRefs.some((ref) => !allowedStances.includes(ref))
      || citation.advisoryPostureRefs.some((ref) =>
        !allowedAdvisoryPostures.includes(ref)
      )
    ) {
      throw new Error(
        "Presentation segment citations must resolve to the selected persisted passage segment.",
      );
    }
  }
  const applicableConsiderations = input.catalogConsiderations.filter(
    ({ initialDisposition }) =>
      initialDisposition === "judgment_eligible",
  );
  const unavailableCandidates = input.dispositions.filter(({ disposition }) =>
    disposition === "unavailable" || disposition === "withheld"
  );
  const completedLimited = input.passages.length < 4
    && applicableConsiderations.length < 4
    && input.passages.length === applicableConsiderations.length
    && unavailableCandidates.length === 0;
  const projectionUnavailable =
    input.decisionCriticalEvidenceProjection.evidenceRefs.length === 0
    && isDeepStrictEqual(
      input.terminalReasonCodes,
      ["decision_critical_evidence_projection_unavailable"],
    )
    && applicableConsiderations.every((consideration) => {
      const disposition = input.dispositions.find(
        ({ judgmentOrCatalogCandidateId }) =>
          judgmentOrCatalogCandidateId
            === consideration.judgmentOrCatalogCandidateId,
      );
      return disposition?.disposition === "withheld"
        && isDeepStrictEqual(
          disposition.reasonCodes,
          ["DECISION_CRITICAL_EVIDENCE_PROJECTION_UNAVAILABLE"],
        );
    });
  if (
    new Set(input.terminalReasonCodes).size
      !== input.terminalReasonCodes.length
    || input.terminalReasonCodes.some((reasonCode, index) =>
      !reasonCode
      || (index > 0
        && compareUtf8(input.terminalReasonCodes[index - 1]!, reasonCode) >= 0)
    )
    || (input.terminalStatus === "completed"
      ? completedLimited
        ? !isDeepStrictEqual(
          input.terminalReasonCodes,
          ["limited_framework_coverage"],
        )
        : input.terminalReasonCodes.length !== 0
          || unavailableCandidates.length !== 0
          || (input.passages.length < 4
            && applicableConsiderations.length >= 4)
      : input.terminalReasonCodes.length === 0
        || (unavailableCandidates.length === 0 && !projectionUnavailable))
  ) {
    throw new Error(
      "Named Lens terminal status requires canonical explicit coverage reasons.",
    );
  }
}

export function reconstructNamedLensPersistence(input: {
  dispositionRows: Array<Record<string, unknown>>;
  passageRows: Array<Record<string, unknown>>;
  segmentRows: Array<Record<string, unknown>>;
}): {
  catalogConsiderations: NamedLensCatalogConsideration[];
  dispositions: NamedLensFinalizationDisposition[];
  passages: NamedLensPassage[];
} {
  const orderedDispositions = [...input.dispositionRows].sort(
    (left, right) => Number(left.catalog_ordinal) - Number(right.catalog_ordinal),
  );
  if (orderedDispositions.some((row, index) =>
    Number(row.catalog_ordinal) !== index + 1
  )) {
    throw new Error(
      "Named Lens disposition catalog ordinals must be contiguous from one.",
    );
  }
  const catalogConsiderations = orderedDispositions.map((row) =>
    NamedLensCatalogConsiderationSchema.parse(row.catalog_consideration)
  );
  const dispositions = orderedDispositions.map((row) =>
    NamedLensFinalizationDispositionSchema.parse(row.payload)
  );
  const segmentProperties = new Map<string, keyof NamedLensPassage>([
    ["premise", "premise"],
    ["case_application", "caseApplication"],
    ["countercase", "countercase"],
    ["unknown_boundary", "unknownBoundary"],
    ["conditional_conclusion", "conditionalConclusion"],
  ]);
  const passages = input.passageRows.map((row) => {
    const judgmentId = requiredText(String(row.judgment_id), "A judgment");
    const segments = input.segmentRows
      .filter((segment) => String(segment.judgment_id) === judgmentId)
      .sort((left, right) =>
        Number(left.segment_ordinal) - Number(right.segment_ordinal)
      );
    if (
      segments.length !== 5
      || segments.some((segment, index) =>
        Number(segment.segment_ordinal) !== index + 1
      )
      || new Set(segments.map((segment) => segment.segment_kind)).size !== 5
    ) {
      throw new Error(
        "Each persisted Named Lens passage requires exactly five ordered segment rows.",
      );
    }
    const payload = { ...(row.payload as Record<string, unknown>) };
    for (const property of segmentProperties.values()) delete payload[property];
    for (const segment of segments) {
      const property = segmentProperties.get(String(segment.segment_kind));
      if (!property) {
        throw new Error("A persisted Named Lens segment kind is invalid.");
      }
      payload[property] = segment.payload;
    }
    return NamedLensPassageSchema.parse(payload);
  });
  if (input.segmentRows.length !== passages.length * 5) {
    throw new Error("Named Lens segment rows include an orphaned passage segment.");
  }
  return { catalogConsiderations, dispositions, passages };
}

function frameworkPremiseResolvesExactly(
  premise: NamedLensPassage["premise"],
  metadata: FrameworkAdvisoryMetadata,
): boolean {
  if (!metadata.componentCardIds.includes(premise.componentFrameworkId)) {
    return false;
  }
  const component = metadata.components.find(({ frameworkId }) =>
    frameworkId === premise.componentFrameworkId
  );
  if (
    !component
    || component.version !== premise.componentVersion
    || typeof resolveCardField(component, premise.cardFieldRef) !== "string"
  ) {
    return false;
  }
  const sourceCatalogIds = new Set(
    metadata.sources.map(({ sourceId }) => sourceId),
  );
  return premise.publicSourceIds.every((sourceId) => {
    if (!sourceCatalogIds.has(sourceId)) return false;
    return component.sourceRefs.some((sourceRef) =>
      sourceRef.sourceId === sourceId
      && sourceRef.attributionScope === premise.attributionScope
      && isDeepStrictEqual(sourceRef.locator, premise.locator)
      && premise.claimIds.every((claimId) =>
        sourceRef.claimIds.includes(claimId)
      )
    );
  });
}

function resolveCardField(
  component: FrameworkAdvisoryMetadata["components"][number],
  cardFieldRef: string,
): unknown {
  if (!/^[A-Za-z][A-Za-z0-9]*(?:(?:\.[A-Za-z][A-Za-z0-9]*)|(?:\[\d+\]))*$/.test(
    cardFieldRef,
  )) {
    return undefined;
  }
  const path = cardFieldRef.match(/[A-Za-z][A-Za-z0-9]*|\d+/g) ?? [];
  let value: unknown = component;
  for (const key of path) {
    if (
      value === null
      || typeof value !== "object"
      || !Object.prototype.hasOwnProperty.call(value, key)
    ) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function statusSafeMissingEvidenceMatches(
  actual: ActionDraftV2["missingEvidence"],
  expected: ActionDraftV2["missingEvidence"],
): boolean {
  const actualIds = actual.map(({ fieldId }) => fieldId);
  if (
    new Set(actualIds).size !== actualIds.length
    || actualIds.some((fieldId, index) =>
      index > 0 && compareUtf8(actualIds[index - 1]!, fieldId) > 0
    )
  ) {
    return false;
  }
  return isDeepStrictEqual(actual, expected);
}

function validateCurrentFrameworkJudgments(input: {
  judgments: FrameworkJudgment[];
  evidencePack: EvidencePack;
  calculations: Calculation[];
}): void {
  const expectedVersions = new Map(
    SYNTHETIC_FRAMEWORK_PACK.cards.map(({ id, version }) => [id, version]),
  );
  const formalJudgments = input.judgments.filter(
    ({ frameworkMetadata }) => frameworkMetadata === undefined,
  );
  if (
    formalJudgments.length !== expectedVersions.size
    || [...expectedVersions].some(([frameworkCardId, version]) =>
      formalJudgments.filter((judgment) =>
        judgment.frameworkCardId === frameworkCardId
        && judgment.frameworkVersion === version
      ).length !== 1
    )
    || formalJudgments.some(({ frameworkCardId }) =>
      !expectedVersions.has(frameworkCardId)
    )
  ) {
    throw new Error(
      "New finalization requires exactly the authorized formal framework catalog.",
    );
  }

  const factDependencies = new Map(
    input.evidencePack.facts.map(({ id }) => [id, "fact" as const]),
  );
  const assumptionDependencies = new Map(
    input.evidencePack.assumptions.map(({ id }) => [
      id,
      "assumption" as const,
    ]),
  );
  const valuationFrameworkId = SYNTHETIC_FRAMEWORK_PACK.cards.find(
    ({ title }) => title === "Valuation & Fund Return",
  )?.id;
  for (const judgment of input.judgments) {
    const dependencies = new Map([
      ...factDependencies,
      ...assumptionDependencies,
      ...(judgment.frameworkCardId === valuationFrameworkId
        ? input.calculations.map(({ id }) => [id, "calculation" as const] as const)
        : []),
    ]);
    const partition = [
      ...judgment.supportEvidenceItemIds,
      ...judgment.counterEvidenceItemIds,
      ...judgment.unusedEvidenceItemIds,
    ];
    const exactPartition = partition.length === dependencies.size
      && new Set(partition).size === partition.length
      && partition.every((id) => dependencies.has(id));
    const abstained = judgment.applicability !== "applicable"
      || judgment.conclusion === "abstain";
    const validConclusionShape = abstained
      ? judgment.conclusion === "abstain"
        && judgment.supportEvidenceItemIds.length === 0
        && judgment.counterEvidenceItemIds.length === 0
        && judgment.strongestSupport === null
        && judgment.strongestCounterargument === null
        && Object.values(judgment.confidence).every((value) => value === "low")
      : judgment.conclusion !== "abstain"
        && judgment.supportEvidenceItemIds.length > 0
        && judgment.counterEvidenceItemIds.length > 0
        && judgment.strongestSupport !== null
        && judgment.strongestCounterargument !== null;
    const expectedEdges: ClaimEdge[] = [
      ...judgment.supportEvidenceItemIds,
      ...judgment.counterEvidenceItemIds,
    ].map((dependencyItemId) => ({
      claimItemId: judgment.id,
      dependencyItemId,
      dependencyType: dependencies.get(dependencyItemId)!,
    }));
    expectedEdges.push({
      claimItemId: judgment.id,
      dependencyItemId: judgment.frameworkCardId,
      dependencyType: "framework_ref",
    });
    if (
      !exactPartition
      || !validConclusionShape
      || !isDeepStrictEqual(
        sortedClaimEdges(judgment.claimEdges),
        sortedClaimEdges(expectedEdges),
      )
    ) {
      throw new Error(
        "Framework judgments must exactly partition and cite their authorized immutable inputs.",
      );
    }
  }
}

function validatePartialUnderwritingTerminalSemantics(input: {
  evidencePack: EvidencePack;
  context: ResolvedUnderwritingContext;
  scenarioModel: ScenarioModel;
  calculations: Calculation[];
  calculationClaimEdges: ClaimEdge[];
  judgments: FrameworkJudgment[];
  disagreements: FrameworkDisagreement[];
  valuation: ValuationEvaluation;
  decision: DecisionResult;
  actionDrafts: ActionDraft[];
  terminalStatus: "completed" | "partial" | undefined;
}): void {
  if (
    input.context.asOfDate !== input.evidencePack.asOfDate
    || input.scenarioModel.formulaPolicyVersion
      !== input.context.valuationMethodPolicyId
  ) {
    throw new Error(
      "Finalized context, Evidence Pack, and scenario policy identity must align.",
    );
  }

  const factIds = new Set(input.evidencePack.facts.map(({ id }) => id));
  const assumptionIds = new Set(
    input.evidencePack.assumptions.map(({ id }) => id),
  );
  if (
    input.scenarioModel.scenarios.some(({ inputs }) =>
      inputs.some((scenarioInput) =>
        scenarioInput.evidenceItemId !== null
          ? !factIds.has(scenarioInput.evidenceItemId)
          : scenarioInput.assumptionItemId !== null
          ? !assumptionIds.has(scenarioInput.assumptionItemId)
          : false
      )
    )
  ) {
    throw new Error(
      "Every available scenario input must resolve to persisted evidence.",
    );
  }

  const derivedValuationOutputs = [
    input.valuation.maximumAcceptablePreMoney,
    input.valuation.initialOwnership,
    input.valuation.postDilutionOwnership,
    input.valuation.grossMoic,
    input.valuation.grossIrr,
    input.valuation.pricingPremium,
    ...input.valuation.scenarios.map(({ valuation }) => valuation),
  ];
  if (
    (
      derivedValuationOutputs.some((value) => value !== null)
      && input.valuation.calculationIds.length === 0
    )
    || input.valuation.scenarios.some((scenario) =>
      scenario.valuation !== null && scenario.calculationIds.length === 0
    )
    || (
      input.valuation.currentAsk !== null
      && !input.evidencePack.facts.some((fact) =>
        fact.field === "reported_valuation"
        && fact.acceptedForGate
        && fact.value === input.valuation.currentAsk
      )
    )
  ) {
    throw new Error(
      "Valuation outputs require exact persisted Fact or Calculation lineage.",
    );
  }

  const hasUnavailableDecisionViolation =
    input.decision.companyQuality !== "unavailable"
    || input.decision.priceAttractiveness !== "unavailable"
    || input.decision.fundFit !== "unavailable"
    || input.decision.decision !== null
    || input.decision.decisionCeiling !== null
    || input.decision.hardVeto
    || input.decision.confidence !== "low";
  const requiresUnavailableDecision =
    !input.evidencePack.coverage.minimumModelInputsComplete
    || input.evidencePack.coverage.underwritingStatus === "unavailable"
    || (
      input.context.analysisMode === "core_only"
      && input.context.geography === "unavailable"
    );
  const formalDecisionMustBeAvailable =
    input.evidencePack.coverage.minimumModelInputsComplete
    && input.evidencePack.coverage.underwritingStatus !== "unavailable"
    && input.context.analysisMode === "full"
    && input.context.geography === "us";
  if (input.terminalStatus === "partial" && formalDecisionMustBeAvailable) {
    const scenarioPlaceholder = input.scenarioModel.scenarios.every(
      ({ inputs }) => inputs.every(({ value }) => value === null),
    );
    const valuationPlaceholder = input.valuation.status === "unavailable";
    const decisionPlaceholder = !hasUnavailableDecisionViolation;
    const formalJudgments = input.judgments.filter(
      ({ frameworkMetadata }) => frameworkMetadata === undefined,
    );
    const formalJudgmentPlaceholder = formalJudgments.length === 0
      || formalJudgments.every(({ applicability, conclusion }) =>
        applicability === "unavailable" && conclusion === "abstain"
      );
    if (
      decisionPlaceholder
      || (
        input.evidencePack.coverage.criticalEvidenceComplete
        && (
          scenarioPlaceholder
          || input.calculations.length === 0
          || valuationPlaceholder
          || formalJudgmentPlaceholder
          || input.actionDrafts.length === 0
        )
      )
    ) {
      throw new Error(
        "Named Lens partial finalization must preserve non-placeholder formal scenario, calculation, valuation, decision, framework, and draft artifacts.",
      );
    }
  }
  if (requiresUnavailableDecision && hasUnavailableDecisionViolation) {
    throw new Error(
      "Unavailable underwriting inputs require an unavailable low-confidence formal decision.",
    );
  }

  if (input.context.analysisMode !== "core_only") return;

  const exceedsCoreOnlyCeiling = [
    input.evidencePack.coverage.decisionCeiling,
    input.decision.decision,
    input.decision.decisionCeiling,
  ].some((label) => label === "Invest Candidate");
  if (exceedsCoreOnlyCeiling) {
    throw new Error(
      "Core-only finalization cannot exceed the Advance decision ceiling.",
    );
  }
  if (
    input.evidencePack.coverage.minimumModelInputsComplete
    && (
      input.evidencePack.coverage.decisionCeiling !== "Advance"
      || !input.evidencePack.coverage.reasonCodes.includes(
        "CORE_ONLY_ANALYSIS_CEILING",
      )
    )
  ) {
    throw new Error(
      "Complete Core-only coverage requires the typed Advance ceiling result.",
    );
  }

  if (input.context.geography !== "unavailable") return;

  const valuationScalarOutputs = [
    input.valuation.currentAsk,
    input.valuation.maximumAcceptablePreMoney,
    input.valuation.initialOwnership,
    input.valuation.postDilutionOwnership,
    input.valuation.grossMoic,
    input.valuation.grossIrr,
    input.valuation.pricingPremium,
  ];
  const hasUnavailableValuationViolation =
    input.valuation.status !== "unavailable"
    || input.calculations.length !== 0
    || input.calculationClaimEdges.length !== 0
    || input.valuation.calculationIds.length !== 0
    || input.valuation.blockerCodes.length === 0
    || valuationScalarOutputs.some((value) => value !== null)
    || input.valuation.scenarios.some((scenario) =>
      scenario.valuation !== null || scenario.calculationIds.length !== 0
    );
  const formalCoreJudgments = input.judgments.filter(
    (judgment) => judgment.frameworkMetadata === undefined,
  );
  const hasUnavailableFrameworkViolation =
    formalCoreJudgments.length === 0
    || formalCoreJudgments.some((judgment) =>
      judgment.applicability !== "unavailable"
      || judgment.conclusion !== "abstain"
    );
  if (
    hasUnavailableValuationViolation
    || hasUnavailableFrameworkViolation
  ) {
    throw new Error(
      "Unavailable-geography Core-only finalization requires one truthful unavailable terminal artifact set.",
    );
  }
}

function validateValuationCalculationBinding(input: {
  evidencePack: EvidencePack;
  context: ResolvedUnderwritingContext;
  scenarioModel: ScenarioModel;
  valuation: ValuationEvaluation;
  calculations: Calculation[];
  calculationClaimEdges: ClaimEdge[];
  formulaVersions: string[];
  fundPolicyValues?: FundPolicySnapshot["values"];
}): void {
  const canonicalFormulaVersions = [...new Set(input.calculations.map(
    ({ formulaId, formulaVersion }) => `${formulaId}@${formulaVersion}`,
  ))].sort();
  if (!isDeepStrictEqual(input.formulaVersions, canonicalFormulaVersions)) {
    throw new Error(
      "The finalized formula-version snapshot must exactly match saved calculations.",
    );
  }
  const calculationsById = new Map(
    input.calculations.map((calculation) => [calculation.id, calculation]),
  );
  try {
    for (const calculation of input.calculations) {
      const expectedOutput = expectedCalculationOutput({
        calculation,
        calculationsById,
        calculationClaimEdges: input.calculationClaimEdges,
        evidencePack: input.evidencePack,
        context: input.context,
        scenarioModel: input.scenarioModel,
        fundPolicyValues: input.fundPolicyValues,
      });
      if (
        calculation.status !== "completed"
        || calculation.formulaVersion !== "1"
        || calculation.output !== expectedOutput
      ) {
        throw new Error("calculation output mismatch");
      }
    }
  } catch {
    throw new Error(
      "Saved valuation calculations must satisfy the authorized deterministic formula graph.",
    );
  }
  const valuationCalculationIds = new Set(input.valuation.calculationIds);
  const hasOutput = (
    value: string | null,
    formulaId: string,
    outputField: string,
  ): boolean => value === null || input.calculations.some((calculation) =>
    valuationCalculationIds.has(calculation.id)
    && calculation.status === "completed"
    && calculation.formulaId === formulaId
    && calculation.formulaVersion === "1"
    && calculation.id.endsWith(`:${outputField}`)
    && calculation.output === value
  );
  if (
    input.valuation.scenarios.some((scenario) =>
      scenario.valuation !== null
      && (
        scenario.calculationIds.length !== 1
        || !input.calculations.some((calculation) =>
          calculation.id === scenario.calculationIds[0]
          && valuationCalculationIds.has(calculation.id)
          && calculation.status === "completed"
          && calculation.formulaId === "market_comps_v1"
          && calculation.formulaVersion === "1"
          && calculation.id.endsWith(`:${scenario.name}_valuation`)
          && calculation.output === scenario.valuation
        )
      )
    )
    || !hasOutput(
      input.valuation.maximumAcceptablePreMoney,
      "venture_return_method_v1",
      "maximum_acceptable_pre_money",
    )
    || !hasOutput(
      input.valuation.initialOwnership,
      "simple_pre_post_ownership_v1",
      "initial_ownership",
    )
    || !hasOutput(
      input.valuation.postDilutionOwnership,
      "future_dilution_v1",
      "post_dilution_ownership",
    )
    || !hasOutput(
      input.valuation.grossMoic,
      "gross_deal_moic_v1",
      "gross_moic",
    )
    || !hasOutput(
      input.valuation.grossIrr,
      "annualized_gross_irr_v1",
      "gross_irr",
    )
    || !hasOutput(
      input.valuation.pricingPremium,
      "market_comps_v1",
      "pricing_premium",
    )
  ) {
    throw new Error(
      "Every finalized valuation output must equal its authorized completed calculation.",
    );
  }
}

function expectedCalculationOutput(input: {
  calculation: Calculation;
  calculationsById: Map<string, Calculation>;
  calculationClaimEdges: ClaimEdge[];
  evidencePack: EvidencePack;
  context: ResolvedUnderwritingContext;
  scenarioModel: ScenarioModel;
  fundPolicyValues?: FundPolicySnapshot["values"];
}): string {
  const outputField = input.calculation.id.split(":").at(-1) ?? "";
  const expectedInputRefs = expectedCalculationInputRefs({
    formulaId: input.calculation.formulaId,
    outputField,
    evidencePack: input.evidencePack,
    context: input.context,
    scenarioModel: input.scenarioModel,
    fundPolicyValues: input.fundPolicyValues,
  });
  const expectedIdentity = expectedCalculationIdentity({
    formulaId: input.calculation.formulaId,
    outputField,
    evidencePack: input.evidencePack,
    context: input.context,
    fundPolicyValues: input.fundPolicyValues,
  });
  if (
    !isDeepStrictEqual(input.calculation.inputRefs, expectedInputRefs)
    || input.calculation.id !== expectedIdentity.id
    || input.calculation.unit !== expectedIdentity.unit
    || input.calculation.currency !== expectedIdentity.currency
    || input.calculation.period !== expectedIdentity.period
  ) {
    throw new Error("calculation identity or authoritative input mismatch");
  }
  const values = expectedInputRefs.map(({ value }) => value);
  const dependency = (...outputFields: string[]): Calculation[] => {
    const edges = input.calculationClaimEdges.filter((edge) =>
      edge.claimItemId === input.calculation.id
      && edge.dependencyType === "calculation"
    );
    if (edges.length !== outputFields.length) {
      throw new Error("calculation dependency count mismatch");
    }
    return outputFields.map((field) => {
      const matching = edges.filter(({ dependencyItemId }) =>
        dependencyItemId.endsWith(`:${field}`)
      );
      if (matching.length !== 1) {
        throw new Error("calculation dependency identity mismatch");
      }
      const value = input.calculationsById.get(matching[0]!.dependencyItemId);
      if (!value) throw new Error("calculation dependency is missing");
      return value;
    });
  };
  switch (`${input.calculation.formulaId}:${outputField}`) {
    case "market_comps_v1:bear_valuation":
    case "market_comps_v1:base_valuation":
    case "market_comps_v1:bull_valuation":
      if (values.length !== 3 || dependency().length !== 0) throw new Error();
      return multiplyDecimalStrings(values[0]!, values[2]!);
    case "market_comps_v1:pricing_premium":
      if (values.length !== 3 || dependency().length !== 0) throw new Error();
      return subtractDecimalStrings(
        divideDecimalStrings(values[0]!, values[1]!),
        "1",
      );
    case "venture_return_method_v1:exit_equity_value":
    case "venture_return_method_v1:required_exit_proceeds":
      if (values.length !== 2 || dependency().length !== 0) throw new Error();
      return multiplyDecimalStrings(values[0]!, values[1]!);
    case "venture_return_method_v1:required_post_dilution_ownership": {
      if (values.length !== 0) throw new Error();
      const [requiredExitProceeds, exitEquityValue] = dependency(
        "required_exit_proceeds",
        "exit_equity_value",
      );
      return divideDecimalStrings(
        requiredExitProceeds!.output,
        exitEquityValue!.output,
      );
    }
    case "venture_return_method_v1:required_initial_ownership": {
      if (values.length !== 1) throw new Error();
      const [requiredPostDilutionOwnership] = dependency(
        "required_post_dilution_ownership",
      );
      return divideDecimalStrings(
        requiredPostDilutionOwnership!.output,
        subtractDecimalStrings("1", values[0]!),
      );
    }
    case "venture_return_method_v1:maximum_acceptable_post_money": {
      if (values.length !== 1) throw new Error();
      const [requiredInitialOwnership] = dependency(
        "required_initial_ownership",
      );
      return divideDecimalStrings(
        values[0]!,
        requiredInitialOwnership!.output,
      );
    }
    case "venture_return_method_v1:maximum_acceptable_pre_money": {
      if (values.length !== 1) throw new Error();
      const [maximumAcceptablePostMoney] = dependency(
        "maximum_acceptable_post_money",
      );
      return subtractDecimalStrings(
        maximumAcceptablePostMoney!.output,
        values[0]!,
      );
    }
    case "simple_pre_post_ownership_v1:post_money":
      if (values.length !== 2 || dependency().length !== 0) throw new Error();
      return addDecimalStrings(values[0]!, values[1]!);
    case "simple_pre_post_ownership_v1:initial_ownership":
      if (values.length !== 2 || dependency().length !== 0) throw new Error();
      return computeOwnership({
        investment: values[0]!,
        preMoney: values[1]!,
      }).initialOwnership;
    case "future_dilution_v1:post_dilution_ownership": {
      if (values.length !== 1) throw new Error();
      const [initialOwnership] = dependency("initial_ownership");
      return applyFutureDilution(initialOwnership!.output, values[0]!);
    }
    case "gross_deal_moic_v1:exit_proceeds": {
      if (values.length !== 0) throw new Error();
      const [exitEquityValue, postDilutionOwnership] = dependency(
        "exit_equity_value",
        "post_dilution_ownership",
      );
      return multiplyDecimalStrings(
        exitEquityValue!.output,
        postDilutionOwnership!.output,
      );
    }
    case "gross_deal_moic_v1:gross_moic": {
      if (values.length !== 1) throw new Error();
      const [exitProceeds] = dependency("exit_proceeds");
      return divideDecimalStrings(exitProceeds!.output, values[0]!);
    }
    case "annualized_gross_irr_v1:gross_irr": {
      if (values.length !== 1) throw new Error();
      const [grossMoic] = dependency("gross_moic");
      return computeGrossReturns({
        invested: "1",
        proceeds: grossMoic!.output,
        holdingYears: values[0]!,
      }).irr;
    }
    default:
      throw new Error("unsupported valuation formula");
  }
}

type CalculationInputRef = Calculation["inputRefs"][number];

function expectedCalculationInputRefs(input: {
  formulaId: string;
  outputField: string;
  evidencePack: EvidencePack;
  context: ResolvedUnderwritingContext;
  scenarioModel: ScenarioModel;
  fundPolicyValues?: FundPolicySnapshot["values"];
}): CalculationInputRef[] {
  const exactFact = (field: string): CalculationInputRef => {
    const matches = input.evidencePack.facts.filter((fact) =>
      fact.field === field && fact.acceptedForGate
    );
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one accepted ${field} Fact.`);
    }
    return {
      itemId: matches[0]!.id,
      value: matches[0]!.value,
      type: "fact",
    };
  };
  const exactAssumption = (
    field: string,
    scenario: "bear" | "base" | "bull" | "all",
    provenanceOrigin: "benchmark" | "recommended_policy",
  ): CalculationInputRef => {
    const matches = input.evidencePack.assumptions.filter((assumption) =>
      assumption.field === field
      && assumption.scenario === scenario
      && assumption.provenanceOrigin === provenanceOrigin
      && (
        provenanceOrigin !== "benchmark"
        || (
          input.context.benchmarkPackId !== null
          && assumption.inputRefIds.length === 1
          && assumption.inputRefIds[0] === input.context.benchmarkPackId
        )
      )
    );
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one ${provenanceOrigin} ${scenario} ${field} Assumption.`,
      );
    }
    return {
      itemId: matches[0]!.id,
      value: matches[0]!.value,
      type: provenanceOrigin === "benchmark" ? "benchmark" : "assumption",
    };
  };
  const scenarioRef = (field: "arr_path" | "exit_multiple") => {
    const base = input.scenarioModel.scenarios.filter(
      ({ name }) => name === "base",
    );
    const matches = base.length === 1
      ? base[0]!.inputs.filter((candidate) => candidate.field === field)
      : [];
    if (matches.length !== 1 || matches[0]!.value === null) {
      throw new Error(`Expected one available base ${field} Scenario input.`);
    }
    const scenarioInput = matches[0]!;
    const referenceCount = Number(scenarioInput.evidenceItemId !== null)
      + Number(scenarioInput.assumptionItemId !== null);
    if (referenceCount !== 1) {
      throw new Error("Scenario formula input must have one evidence identity.");
    }
    if (scenarioInput.evidenceItemId !== null) {
      const facts = input.evidencePack.facts.filter((fact) =>
        fact.id === scenarioInput.evidenceItemId
        && fact.value === scenarioInput.value
      );
      if (facts.length !== 1) {
        throw new Error("Scenario Fact formula input is not authoritative.");
      }
      return {
        itemId: facts[0]!.id,
        value: facts[0]!.value,
        type: "fact" as const,
      };
    }
    const assumptions = input.evidencePack.assumptions.filter((assumption) =>
      assumption.id === scenarioInput.assumptionItemId
      && assumption.value === scenarioInput.value
    );
    if (assumptions.length !== 1) {
      throw new Error("Scenario Assumption formula input is not authoritative.");
    }
    return {
      itemId: assumptions[0]!.id,
      value: assumptions[0]!.value,
      type: "assumption" as const,
    };
  };
  const policyRef = (...path: string[]): CalculationInputRef => ({
    itemId: `policy:${path.join(".")}`,
    value: exactFundPolicyString(input.fundPolicyValues, path),
    type: "policy",
  });
  const benchmarkValue = () => exactAssumption(
    "compatible_benchmark_value",
    "all",
    "benchmark",
  );
  const benchmarkFreshness = () => exactAssumption(
    "compatible_benchmark_stale_after",
    "all",
    "benchmark",
  );

  switch (`${input.formulaId}:${input.outputField}`) {
    case "market_comps_v1:bear_valuation":
      return [
        benchmarkValue(),
        benchmarkFreshness(),
        exactAssumption("scenario_price_multiplier", "bear", "recommended_policy"),
      ];
    case "market_comps_v1:base_valuation":
      return [
        benchmarkValue(),
        benchmarkFreshness(),
        exactAssumption("scenario_price_multiplier", "base", "recommended_policy"),
      ];
    case "market_comps_v1:bull_valuation":
      return [
        benchmarkValue(),
        benchmarkFreshness(),
        exactAssumption("scenario_price_multiplier", "bull", "recommended_policy"),
      ];
    case "market_comps_v1:pricing_premium":
      return [exactFact("reported_valuation"), benchmarkValue(), benchmarkFreshness()];
    case "venture_return_method_v1:exit_equity_value":
      return [scenarioRef("arr_path"), scenarioRef("exit_multiple")];
    case "venture_return_method_v1:required_exit_proceeds":
      return [
        policyRef("initialCheckMax"),
        policyRef("returnTargets", input.context.stage, "grossMoic"),
      ];
    case "venture_return_method_v1:required_post_dilution_ownership":
    case "gross_deal_moic_v1:exit_proceeds":
      return [];
    case "venture_return_method_v1:required_initial_ownership":
    case "future_dilution_v1:post_dilution_ownership":
      return [policyRef("acceptableFutureDilution")];
    case "venture_return_method_v1:maximum_acceptable_post_money":
    case "venture_return_method_v1:maximum_acceptable_pre_money":
    case "gross_deal_moic_v1:gross_moic":
      return [policyRef("initialCheckMax")];
    case "simple_pre_post_ownership_v1:post_money":
    case "simple_pre_post_ownership_v1:initial_ownership":
      return [policyRef("initialCheckMax"), exactFact("reported_valuation")];
    case "annualized_gross_irr_v1:gross_irr":
      return [policyRef("returnTargets", input.context.stage, "horizonYears")];
    default:
      throw new Error("unsupported valuation formula input contract");
  }
}

function expectedCalculationIdentity(input: {
  formulaId: string;
  outputField: string;
  evidencePack: EvidencePack;
  context: ResolvedUnderwritingContext;
  fundPolicyValues?: FundPolicySnapshot["values"];
}): {
  id: string;
  unit: string;
  currency: string | null;
  period: string | null;
} {
  const key = `${input.formulaId}:${input.outputField}`;
  const id = `calculation:valuation:${input.evidencePack.id}:${key}`;
  const baseCurrency = () => exactFundPolicyString(
    input.fundPolicyValues,
    ["baseCurrency"],
  );
  if (/^market_comps_v1:(bear|base|bull)_valuation$/u.test(key)) {
    const benchmark = input.evidencePack.assumptions.filter((assumption) =>
      assumption.field === "compatible_benchmark_value"
      && assumption.provenanceOrigin === "benchmark"
      && assumption.inputRefIds.length === 1
      && assumption.inputRefIds[0] === input.context.benchmarkPackId
    );
    if (benchmark.length !== 1 || !/^[A-Z]{3}$/u.test(benchmark[0]!.unit ?? "")) {
      throw new Error("Market-comps currency is not authoritative.");
    }
    return {
      id,
      unit: "currency",
      currency: benchmark[0]!.unit,
      period: input.outputField.replace("_valuation", ""),
    };
  }
  switch (key) {
    case "market_comps_v1:pricing_premium":
      return { id, unit: "decimal", currency: null, period: null };
    case "venture_return_method_v1:exit_equity_value":
    case "venture_return_method_v1:required_exit_proceeds":
    case "venture_return_method_v1:maximum_acceptable_post_money":
    case "venture_return_method_v1:maximum_acceptable_pre_money":
    case "simple_pre_post_ownership_v1:post_money":
    case "gross_deal_moic_v1:exit_proceeds":
      return { id, unit: "currency", currency: baseCurrency(), period: null };
    case "venture_return_method_v1:required_post_dilution_ownership":
    case "venture_return_method_v1:required_initial_ownership":
    case "simple_pre_post_ownership_v1:initial_ownership":
    case "future_dilution_v1:post_dilution_ownership":
      return { id, unit: "decimal", currency: null, period: null };
    case "gross_deal_moic_v1:gross_moic":
      return { id, unit: "multiple", currency: null, period: null };
    case "annualized_gross_irr_v1:gross_irr":
      return {
        id,
        unit: "decimal",
        currency: null,
        period: exactFundPolicyString(input.fundPolicyValues, [
          "returnTargets",
          input.context.stage,
          "horizonYears",
        ]),
      };
    default:
      throw new Error("unsupported valuation calculation identity");
  }
}

function exactFundPolicyString(
  values: FundPolicySnapshot["values"] | undefined,
  path: readonly string[],
): string {
  let current: unknown = values;
  for (const segment of path) {
    if (
      current === null
      || typeof current !== "object"
      || Array.isArray(current)
      || !(segment in current)
    ) {
      throw new Error(`Pinned Fund Policy value ${path.join(".")} is missing.`);
    }
    current = (current as Record<string, unknown>)[segment];
  }
  if (typeof current !== "string") {
    throw new Error(`Pinned Fund Policy value ${path.join(".")} is not text.`);
  }
  return current;
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} identities must be unique.`);
  }
}

function sortedClaimEdges(edges: ClaimEdge[]): ClaimEdge[] {
  return [...edges].sort((left, right) =>
    `${left.claimItemId}\u0000${left.dependencyType}\u0000${left.dependencyItemId}`
      .localeCompare(
        `${right.claimItemId}\u0000${right.dependencyType}\u0000${right.dependencyItemId}`,
      )
  );
}

function emptyRowCounts(): ArtifactRowCounts {
  return {
    evidencePacks: 0,
    contexts: 0,
    scenarioModels: 0,
    calculations: 0,
    judgments: 0,
    disagreements: 0,
    valuations: 0,
    decisions: 0,
    narratives: 0,
    actionDrafts: 0,
    claimEdges: 0,
    versionSnapshots: 0,
    decisionCriticalEvidenceProjections: 0,
    namedLensProviderAttemptEvents: 0,
    namedLensDispositions: 0,
    namedLensPassages: 0,
    namedLensPassageSegments: 0,
    underwritingPresentations: 0,
  };
}

function identity(workspaceId: string, id: string): string {
  return `${workspaceId.length}:${workspaceId}${id.length}:${id}`;
}

function parseTerminalReasonCodes(
  candidate: Record<string, unknown>,
): string[] {
  return z.array(z.string().min(1)).parse(
    candidate.unavailable_reason_codes ?? [],
  );
}

function parsePersistedTerminalStatus(
  candidate: Record<string, unknown>,
): "completed" | "partial" {
  if (candidate.status !== "completed" && candidate.status !== "partial") {
    throw new Error(
      "Persisted candidate artifacts require a completed or partial source.",
    );
  }
  return candidate.status;
}

function requiredText(value: string, label: string): string {
  const normalized = value?.trim();
  if (!normalized || normalized !== value) {
    throw new Error(`${label} is required without surrounding whitespace.`);
  }
  return value;
}

function requiredBody(value: string): string {
  if (
    typeof value !== "string"
    || value.length > 100_000
    || value.trim().length === 0
  ) {
    throw new Error(
      "An action draft body must contain text and be at most 100000 characters.",
    );
  }
  return value;
}

let singleton: UnderwritingArtifactsRepository | undefined;

export function getUnderwritingArtifactsRepository():
  UnderwritingArtifactsRepository {
  if (singleton) return singleton;
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  singleton = url && serviceRoleKey
    ? createSupabaseUnderwritingArtifactsRepository({ url, serviceRoleKey })
    : createMemoryUnderwritingArtifactsRepository();
  return singleton;
}
