import { z } from "zod";

import {
  CalculationSchema,
  ClaimEdgeSchema,
  EvidencePackSchema,
  SourceRevisionSchema,
} from "../contracts/evidence";
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
): z.infer<typeof FrameworkLensResultSchema> {
  return FrameworkLensResultSchema.parse(value);
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
