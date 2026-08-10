import { z } from "zod";

import {
  CalculationSchema,
  ClaimEdgeSchema,
  EvidencePackSchema,
  SourceRevisionSchema,
} from "../contracts/evidence";
import {
  NAMED_LENS_GENERATOR_VERSION,
  NAMED_LENS_PASSAGE_SCHEMA_VERSION,
} from "../contracts/named-lens";
import {
  DecisionResultSchema,
  FrameworkDisagreementSchema,
  FrameworkJudgmentSchema,
  parseActionDraftRead,
  ScenarioModelSchema,
  ValuationEvaluationSchema,
  XTraceLineageSnapshotSchema,
} from "../contracts/underwriting";
import type {
  CandidateGroundingSnapshot,
  GroundedEvidencePack,
} from "./candidate-grounding";
import type { ValuationArtifactSet } from "./valuation/contracts";
import {
  DECISION_TAXONOMY_DIGEST,
  DECISION_TAXONOMY_VERSION,
  DecisionTaxonomyBindingSchema,
} from "./frameworks/decision-taxonomy";
import {
  NamedLensPassageCandidateSchema,
} from "./frameworks/schemas";
import {
  NamedLensPassageValidationResultSchema,
} from "./frameworks/passage-grounding";

const IdSchema = z.string().min(1).refine(
  (value) => value.trim() === value,
  "IDs cannot have surrounding whitespace",
);
const FingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const RouterEvidenceValueSchema = z.strictObject({
  value: z.string().min(1),
  basis: z.enum([
    "confirmed",
    "source_explicit",
    "derived",
    "semantic_availability",
    "assumption",
  ]),
  evidenceItemId: IdSchema,
});
const CandidateIdentityEvidenceSchema = z.strictObject({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  companyIdentity: z.array(RouterEvidenceValueSchema),
  stage: z.array(RouterEvidenceValueSchema),
  businessModel: z.array(RouterEvidenceValueSchema),
  geography: z.array(RouterEvidenceValueSchema),
  securityType: z.array(RouterEvidenceValueSchema),
});
const ReferenceDefinitionSchema = z.strictObject({
  kind: z.enum([
    "critical_evidence_profile",
    "benchmark_definition",
    "valuation_method_policy",
    "decision_policy",
    "framework_pack",
  ]),
  id: IdSchema,
  version: IdSchema,
  parentId: IdSchema.optional(),
  definitionFingerprint: FingerprintSchema,
});
const SelectedBenchmarkSchema = z.strictObject({
  packId: IdSchema,
  entryId: IdSchema,
  version: IdSchema,
  value: z.string().min(1),
  currency: IdSchema,
  effectiveAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  staleAfter: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  definitionFingerprint: FingerprintSchema,
});
const CandidateGroundingSnapshotSchema = z.strictObject({
  identityEvidence: CandidateIdentityEvidenceSchema,
  sourceRevisionIds: z.array(IdSchema),
  sourceRevisionSnapshots: z.array(SourceRevisionSchema),
  xtraceLineage: XTraceLineageSnapshotSchema,
});
const GroundedEvidencePackSchema = z.strictObject({
  pack: EvidencePackSchema,
  buildInputFingerprint: FingerprintSchema,
  criticalEvidenceProfile: ReferenceDefinitionSchema,
  benchmark: SelectedBenchmarkSchema.nullable(),
});
const ValuationArtifactSetSchema = z.strictObject({
  evaluation: ValuationEvaluationSchema,
  scenarioModel: ScenarioModelSchema,
  calculations: z.array(CalculationSchema),
  calculationClaimEdges: z.array(ClaimEdgeSchema),
});
const FrameworkLensResultSchema = z.strictObject({
  judgments: z.array(FrameworkJudgmentSchema),
  disagreements: z.array(FrameworkDisagreementSchema),
  passageCandidates: z.array(z.strictObject({
    judgmentOrCatalogCandidateId: IdSchema,
    frameworkCardId: IdSchema,
    candidate: NamedLensPassageCandidateSchema,
  })),
  passageResults: z.array(NamedLensPassageValidationResultSchema),
  taxonomyByFrameworkId: z.record(
    IdSchema,
    DecisionTaxonomyBindingSchema,
  ),
});
export const FrameworkLensStageReplayContractSchema = z.strictObject({
  passageSchemaVersion: z.literal(NAMED_LENS_PASSAGE_SCHEMA_VERSION),
  generatorVersion: z.literal(NAMED_LENS_GENERATOR_VERSION),
  decisionTaxonomyVersion: z.literal(DECISION_TAXONOMY_VERSION),
  decisionTaxonomyDigest: z.literal(DECISION_TAXONOMY_DIGEST),
});
export type FrameworkLensStageReplayContract = z.infer<
  typeof FrameworkLensStageReplayContractSchema
>;
export const CURRENT_FRAMEWORK_LENS_STAGE_REPLAY_CONTRACT = Object.freeze({
  passageSchemaVersion: NAMED_LENS_PASSAGE_SCHEMA_VERSION,
  generatorVersion: NAMED_LENS_GENERATOR_VERSION,
  decisionTaxonomyVersion: DECISION_TAXONOMY_VERSION,
  decisionTaxonomyDigest: DECISION_TAXONOMY_DIGEST,
}) satisfies FrameworkLensStageReplayContract;
const FrameworkCatalogBindingSchema = z.strictObject({
  catalogVersion: IdSchema,
  catalogFingerprint: FingerprintSchema,
  corpusDigest: FingerprintSchema,
});
const NarrativeArtifactsSchema = z.strictObject({
  narrative: z.string().min(1),
  actionDrafts: z.array(z.unknown()),
});

export function parseCandidateGroundingSnapshot(
  value: unknown,
): CandidateGroundingSnapshot {
  return CandidateGroundingSnapshotSchema.parse(
    value,
  ) as CandidateGroundingSnapshot;
}

export function parseGroundedEvidencePack(
  value: unknown,
): GroundedEvidencePack {
  return GroundedEvidencePackSchema.parse(value) as GroundedEvidencePack;
}

export function parseValuationArtifactSet(
  value: unknown,
): ValuationArtifactSet {
  return ValuationArtifactSetSchema.parse(value) as ValuationArtifactSet;
}

export function parseFrameworkLensResult(
  value: unknown,
  expectedContract: FrameworkLensStageReplayContract,
): z.infer<typeof FrameworkLensResultSchema> {
  const contract = FrameworkLensStageReplayContractSchema.parse(
    expectedContract,
  );
  const parsed = FrameworkLensResultSchema.parse(value);
  const stalePassage = parsed.passageResults.some((result) =>
    result.status === "validated"
    && (
      result.groundedCandidate.schemaVersion
        !== contract.passageSchemaVersion
      || result.groundedCandidate.generatorVersion
        !== contract.generatorVersion
    )
  );
  const staleTaxonomy = parsed.judgments.some((judgment) =>
    judgment.frameworkMetadata !== undefined
    && (
      judgment.frameworkMetadata.decisionTaxonomyVersion
        !== contract.decisionTaxonomyVersion
      || judgment.frameworkMetadata.decisionTaxonomyDigest
        !== contract.decisionTaxonomyDigest
    )
  );
  if (stalePassage || staleTaxonomy) {
    throw new Error(
      "Framework lens stage replay does not match the current passage generation contract.",
    );
  }
  return parsed;
}

export function parseFrameworkCatalogBinding(value: unknown): {
  catalogVersion: string;
  catalogFingerprint: string;
  corpusDigest: string;
} {
  return FrameworkCatalogBindingSchema.parse(value);
}

export function parseDecisionResult(value: unknown) {
  return DecisionResultSchema.parse(value);
}

export function parseNarrativeArtifacts(value: unknown) {
  const parsed = NarrativeArtifactsSchema.parse(value);
  return {
    ...parsed,
    actionDrafts: parsed.actionDrafts.map(parseActionDraftRead),
  };
}
