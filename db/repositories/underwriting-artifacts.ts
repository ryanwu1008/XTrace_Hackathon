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
  CurrentFrameworkJudgmentSchema,
  DecisionResultSchema,
  FundPolicySnapshotSchema,
  FrameworkDisagreementSchema,
  FrameworkJudgmentSchema,
  parseActionDraftRead,
  ResolvedUnderwritingContextSchema,
  ScenarioModelSchema,
  ValuationEvaluationSchema,
  type ActionDraft,
  type ActionDraftV2,
  type DecisionResult,
  type FundPolicySnapshot,
  type FrameworkDisagreement,
  type FrameworkJudgment,
  type ResolvedUnderwritingContext,
  type ScenarioModel,
  type ValuationEvaluation,
} from "../../lib/contracts/underwriting";
import {
  NAMED_LENS_PASSAGE_SCHEMA_VERSION,
  NAMED_LENS_SELECTION_POLICY_VERSION,
  NamedLensDispositionSchema,
  NamedLensPassageSchema,
  NamedLensPresentationSchema,
  NamedLensProviderAttemptRefSchema,
  UNDERWRITING_PRESENTATION_SCHEMA_VERSION,
  type NamedLensDisposition,
  type NamedLensPassage,
  type NamedLensPresentation,
  type NamedLensProviderAttemptRef,
} from "../../lib/contracts/named-lens";
import { DECISION_TAXONOMY_VERSION } from
  "../../lib/underwriting/frameworks/decision-taxonomy";
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
});

export type CandidateVersionSnapshot = z.infer<
  typeof CandidateVersionSnapshotSchema
>;

export type CurrentCandidateVersionSnapshot = CandidateVersionSnapshot & {
  namedLensSelectionPolicyVersion: typeof NAMED_LENS_SELECTION_POLICY_VERSION;
  namedLensPassageSchemaVersion: typeof NAMED_LENS_PASSAGE_SCHEMA_VERSION;
  namedLensGeneratorVersion: string;
  underwritingPresentationSchemaVersion:
    typeof UNDERWRITING_PRESENTATION_SCHEMA_VERSION;
  decisionTaxonomyVersion: typeof DECISION_TAXONOMY_VERSION;
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
  namedLensAttemptRefs?: NamedLensProviderAttemptRef[];
  namedLensDispositions?: NamedLensDisposition[];
  namedLensPassages?: NamedLensPassage[];
  namedLensPresentation?: NamedLensPresentation;
  terminalStatus?: "completed" | "partial";
  terminalReasonCodes?: string[];
}

export interface CurrentCandidateFinalization extends CandidateFinalization {
  versionSnapshot: CurrentCandidateVersionSnapshot;
  namedLensAttemptRefs: NamedLensProviderAttemptRef[];
  namedLensDispositions: NamedLensDisposition[];
  namedLensPassages: NamedLensPassage[];
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
  workspaceId: string;
  dealId: string;
  claimEdges: ClaimEdge[];
}

export interface CurrentCandidateArtifactBundle
  extends CandidateArtifactBundle {
  versionSnapshot: CurrentCandidateVersionSnapshot;
  namedLensAttemptRefs: NamedLensProviderAttemptRef[];
  namedLensDispositions: NamedLensDisposition[];
  namedLensPassages: NamedLensPassage[];
  namedLensPresentation: NamedLensPresentation;
  terminalStatus: "completed" | "partial";
  terminalReasonCodes: string[];
}

export interface ReusableCandidateArtifacts {
  candidateRunId: string;
  workspaceId: string;
  dealId: string;
  candidateAnalysisFingerprint: string;
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

export interface MemoryUnderwritingArtifactsRepository
  extends UnderwritingArtifactsRepository {
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
} = {}): MemoryUnderwritingArtifactsRepository {
  const bundles = new Map<string, CandidateArtifactBundle>();
  const reusable = new Map<string, ReusableCandidateArtifacts>();
  const aliases = new Map<string, string>();
  const now = options.now ?? (() => new Date());

  return {
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
      const artifactCandidateRunId = aliases.get(candidateKey)
        ?? candidateRunId;
      const value = bundles.get(identity(
        workspaceId,
        artifactCandidateRunId,
      ));
      return value ? structuredClone(value) : null;
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

    prepareFinalization({ candidate, finalization }) {
      return prepareCandidateFinalization(candidate, finalization);
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
      if (bundles.has(candidateKey) || aliases.has(candidateKey)) {
        throw new Error("Candidate artifacts are immutable once finalized.");
      }
      const source = bundles.get(identity(workspaceId, sourceCandidateRunId));
      if (
        !source
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
      aliases.set(candidateKey, sourceCandidateRunId);
    },

    inspect() {
      const values = [...bundles.values()].map((bundle) =>
        structuredClone(bundle)
      );
      return {
        bundles: values,
        rowCounts: values.reduce<ArtifactRowCounts>(
          (counts, bundle) => ({
            evidencePacks: counts.evidencePacks + 1,
            contexts: counts.contexts + 1,
            scenarioModels: counts.scenarioModels + 1,
            calculations: counts.calculations + bundle.calculations.length,
            judgments: counts.judgments + bundle.judgments.length,
            disagreements:
              counts.disagreements + bundle.disagreements.length,
            valuations: counts.valuations + 1,
            decisions: counts.decisions + 1,
            narratives: counts.narratives + 1,
            actionDrafts: counts.actionDrafts + bundle.actionDrafts.length,
            claimEdges: counts.claimEdges + bundle.claimEdges.length,
            versionSnapshots: counts.versionSnapshots + 1,
          }),
          emptyRowCounts(),
        ),
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
        status: "eq.completed",
        artifact_source_candidate_run_id: "is.null",
        select:
          "id,workspace_id,deal_id,candidate_analysis_fingerprint",
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
        status: "eq.completed",
        select:
          "id,batch_id,workspace_id,deal_id,candidate_analysis_fingerprint,artifact_source_candidate_run_id",
        limit: "1",
      });
      const candidates = await request(
        `/candidate_runs?${candidateQuery}`,
      ) as Array<Record<string, unknown>>;
      const candidate = candidates[0];
      if (!candidate) return null;
      const artifactCandidateRunId =
        typeof candidate.artifact_source_candidate_run_id === "string"
          ? candidate.artifact_source_candidate_run_id
          : candidateRunId;
      const batchQuery = new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        id: `eq.${String(candidate.batch_id)}`,
        select: "fund_policy_snapshot_id",
        limit: "1",
      });
      const batchRows = await request(
        `/underwriting_batches?${batchQuery}`,
      ) as Array<Record<string, unknown>>;
      if (!batchRows[0]) {
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
      const prepared = prepareCandidateFinalization(
        {
          id: artifactCandidateRunId,
          workspaceId,
          dealId: String(candidate.deal_id),
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
            candidate.candidate_analysis_fingerprint,
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
          versionSnapshot:
            versionRows[0].payload as CandidateVersionSnapshot,
        },
        { mode: "persisted_read" },
      );
      if (
        JSON.stringify(sortedClaimEdges(persistedEdges))
          !== JSON.stringify(sortedClaimEdges(prepared.claimEdges))
      ) {
        throw new Error(
          "Persisted candidate claim edges do not match artifact claims.",
        );
      }
      return prepared;
    },
    async listFinalizedForWorkspace(input) {
      const workspaceId = requiredText(input.workspaceId, "A workspace");
      const query = new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        status: "eq.completed",
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
  options: { mode?: "new_finalization" | "persisted_read" } = {},
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
  const judgments = input.judgments.map((value) =>
    FrameworkJudgmentSchema.parse(value)
  );
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
  const versionSnapshot = CandidateVersionSnapshotSchema.parse(
    input.versionSnapshot,
  );
  const namedLensAttemptRefs = input.namedLensAttemptRefs?.map((value) =>
    NamedLensProviderAttemptRefSchema.parse(value)
  );
  const namedLensDispositions = input.namedLensDispositions?.map((value) =>
    NamedLensDispositionSchema.parse(value)
  );
  const namedLensPassages = input.namedLensPassages?.map((value) =>
    NamedLensPassageSchema.parse(value)
  );
  const namedLensPresentation = input.namedLensPresentation === undefined
    ? undefined
    : NamedLensPresentationSchema.parse(input.namedLensPresentation);
  const terminalStatus = input.terminalStatus;
  const terminalReasonCodes = input.terminalReasonCodes;
  const namedLensArtifacts = [
    namedLensAttemptRefs,
    namedLensDispositions,
    namedLensPassages,
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
  const hasCurrentNamedLensContract = namedLensVersionValues.every(
    (value) => value !== undefined,
  );
  const hasLegacyNamedLensContract = namedLensVersionValues.every(
    (value) => value === undefined,
  ) && namedLensArtifacts.every((value) => value === undefined);
  if (
    (isNewFinalization && !hasCurrentNamedLensContract)
    || (!hasCurrentNamedLensContract && !hasLegacyNamedLensContract)
    || (hasCurrentNamedLensContract
      && namedLensArtifacts.some((value) => value === undefined))
  ) {
    throw new Error(
      "Current Named Lens finalization requires all artifacts and all five pinned version values.",
    );
  }
  if (hasCurrentNamedLensContract) {
    judgments
      .filter(({ frameworkMetadata }) => frameworkMetadata !== undefined)
      .forEach((value) => CurrentFrameworkJudgmentSchema.parse(value));
    validateNamedLensFinalization({
      workspaceId,
      candidateRunId,
      attemptRefs: namedLensAttemptRefs!,
      dispositions: namedLensDispositions!,
      passages: namedLensPassages!,
      presentation: namedLensPresentation!,
      terminalStatus: terminalStatus!,
      terminalReasonCodes: terminalReasonCodes!,
      generatorVersion: versionSnapshot.namedLensGeneratorVersion!,
    });
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
    ...(hasCurrentNamedLensContract
      ? {
        namedLensAttemptRefs: namedLensAttemptRefs!,
        namedLensDispositions: namedLensDispositions!,
        namedLensPassages: namedLensPassages!,
        namedLensPresentation: namedLensPresentation!,
        terminalStatus: terminalStatus!,
        terminalReasonCodes: terminalReasonCodes!,
      }
      : {}),
    claimEdges,
  };
}

function validateNamedLensFinalization(input: {
  workspaceId: string;
  candidateRunId: string;
  attemptRefs: NamedLensProviderAttemptRef[];
  dispositions: NamedLensDisposition[];
  passages: NamedLensPassage[];
  presentation: NamedLensPresentation;
  terminalStatus: "completed" | "partial";
  terminalReasonCodes: string[];
  generatorVersion: string;
}): void {
  assertUnique(
    input.attemptRefs.map(({ logicalPassageId, attemptNumber }) =>
      `${logicalPassageId}\u0000${attemptNumber}`
    ),
    "Named Lens provider attempt reference",
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
  if (
    new Set(input.terminalReasonCodes).size
      !== input.terminalReasonCodes.length
    || input.terminalReasonCodes.some((reasonCode, index) =>
      !reasonCode
      || (index > 0
        && compareUtf8(input.terminalReasonCodes[index - 1]!, reasonCode) >= 0)
    )
    || (input.terminalStatus === "completed"
      ? input.terminalReasonCodes.length !== 0
      : input.terminalReasonCodes.length === 0)
  ) {
    throw new Error(
      "Named Lens terminal status requires canonical explicit coverage reasons.",
    );
  }
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
    const abstained = judgment.applicability !== "applicable";
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
  };
}

function identity(workspaceId: string, id: string): string {
  return `${workspaceId.length}:${workspaceId}${id.length}:${id}`;
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
