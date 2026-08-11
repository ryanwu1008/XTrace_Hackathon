import type {
  SourceEvidenceInput,
} from "../../../db/repositories/evidence-packs";
import {
  AssumptionSchema,
  FactSchema,
  type Assumption,
  type Fact,
} from "../../contracts/evidence";
import { normalizeSourceEvidence } from "./normalization";

export const SEMANTIC_CONTEXT_ASSUMPTION_POLICY_VERSION =
  "belief-reversal-demo-context-v1" as const;
export const SEMANTIC_CONTEXT_MAPPING_VERSION =
  "belief-reversal-reviewed-context-mapping-v1" as const;

const REVIEWED_CONTEXTS = {
  henry_ai: {
    stage: {
      sourceId: "source_henry_series_a_v1",
      semanticValue: "Series A",
      canonicalValue: "series_a",
    },
    business_model: {
      sourceId: "source_henry_yc_product_v1",
      semanticValue:
        "Enterprise software that automates commercial-real-estate deal decks.",
      canonicalValue: "b2b_saas",
    },
    geography: {
      sourceId: "source_henry_yc_location_v1",
      semanticValue: "New York City, United States",
      canonicalValue: "us",
    },
  },
  smallest_ai: {
    stage: {
      sourceId: "source_smallest_official_series_a_v1",
      semanticValue: "Series A",
      canonicalValue: "series_a",
    },
    business_model: {
      sourceId: "source_smallest_product_v1",
      semanticValue: "Next-generation voice AI.",
      canonicalValue: "enterprise_ai",
    },
    geography: {
      sourceId: "source_smallest_address_v1",
      semanticValue:
        "Company-published address in San Francisco, California, United States",
      canonicalValue: "us",
    },
  },
  hush_security: {
    stage: {
      sourceId: "source_hush_series_a_v1",
      semanticValue: "Series A",
      canonicalValue: "series_a",
    },
    business_model: {
      sourceId: "source_hush_product_v1",
      semanticValue: "AI agent governance.",
      canonicalValue: "enterprise_ai",
    },
    geography: {
      sourceId: "source_hush_geography_v1",
      semanticValue: "Tel Aviv, Israel",
      canonicalValue: "global",
    },
  },
  irregular: {
    stage: {
      sourceId: "source_irregular_wsgr_stage_v1",
      semanticValue: "Seed and Series A",
      canonicalValue: "series_a",
    },
    business_model: {
      sourceId: "source_irregular_official_background_v1",
      semanticValue: "Frontier AI security evaluation and research.",
      canonicalValue: "enterprise_ai",
    },
    geography: {
      sourceId: "source_irregular_official_background_v1",
      semanticValue: null,
      canonicalValue: "unavailable",
    },
  },
} as const;

type ReviewedContextKey = keyof typeof REVIEWED_CONTEXTS;

export class SemanticEvidenceProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SemanticEvidenceProjectionError";
  }
}

export function projectUnderwritingEvidence(
  sourceEvidence: readonly SourceEvidenceInput[],
): {
  facts: Fact[];
  assumptions: Assumption[];
  unavailableFields: Array<{ fieldId: string; evidenceItemId: string }>;
  contextValues: Array<{
    fieldId: "stage" | "business_model" | "geography";
    value: string;
    evidenceItemId: string;
  }>;
} {
  const evidenceById = new Map<string, SourceEvidenceInput>();
  for (const evidence of sourceEvidence) {
    evidenceById.set(evidence.id, evidence);
    if (!evidenceById.has(evidence.sourceId)) {
      evidenceById.set(evidence.sourceId, evidence);
    }
  }
  const facts: Fact[] = [];
  const assumptions: Assumption[] = [];
  const unavailableFields: Array<{
    fieldId: string;
    evidenceItemId: string;
  }> = [];
  const contextValues: Array<{
    fieldId: "stage" | "business_model" | "geography";
    value: string;
    evidenceItemId: string;
  }> = [];
  const semanticPayloadById = new Map<string, string>();

  for (const evidence of sourceEvidence) {
    if (evidence.field !== "public_claim") {
      facts.push(normalizeSourceEvidence(evidence));
      continue;
    }
    const publicClaimBridge = projectAcceptedPublicClaimBridge(evidence);
    if (publicClaimBridge) facts.push(publicClaimBridge);
    if (!evidence.sourceRef) {
      throw new SemanticEvidenceProjectionError(
        `Public claim ${evidence.id} is missing canonical source lineage.`,
      );
    }
    const reviewedContext = evidence.semanticFields?.length
      ? reviewedContextFor(evidence)
      : null;
    for (const semantic of evidence.semanticFields ?? []) {
      const payload = JSON.stringify(semantic);
      const existing = semanticPayloadById.get(semantic.id);
      if (existing !== undefined) {
        if (existing !== payload) {
          throw new SemanticEvidenceProjectionError(
            `Semantic evidence ${semantic.id} has conflicting payloads.`,
          );
        }
        continue;
      }
      semanticPayloadById.set(semantic.id, payload);
      assertSemanticSources({ semantic, evidenceById });
      if (semantic.classification === "fact") {
        if (
          semantic.sourceIds[0] !== evidence.id
          && semantic.sourceIds[0] !== evidence.sourceId
        ) {
          throw new SemanticEvidenceProjectionError(
            `Semantic fact ${semantic.id} is not bound to its owning claim source.`,
          );
        }
        facts.push(FactSchema.parse({
          id: semantic.id,
          analysisType: "fact",
          provenanceOrigin: evidence.provenanceOrigin,
          field: semantic.fieldId,
          value: semantic.value,
          unit: null,
          currency: null,
          periodStart: null,
          periodEnd: null,
          publishedAt: evidence.publishedAt,
          eventAt: evidence.eventAt,
          retrievedAt: evidence.retrievedAt,
          sourceRevisionId: evidence.sourceRevisionId,
          locator: evidence.locator,
          sourceRole: evidence.sourceRole,
          assertionStatus: evidence.assertionStatus,
          verificationMethod: evidence.verificationMethod,
          freshness: evidence.freshness,
          acceptedForGate: evidence.acceptedForGate,
        }));
        if (
          reviewedContext
          && isContextField(semantic.fieldId)
        ) {
          const mapping = reviewedContext[semantic.fieldId];
          if (
            evidence.sourceId !== mapping.sourceId
            || semantic.value !== mapping.semanticValue
          ) {
            throw new SemanticEvidenceProjectionError(
              `Semantic context ${semantic.id} does not match the exact reviewed source and value.`,
            );
          }
          contextValues.push({
            fieldId: semantic.fieldId,
            value: mapping.canonicalValue,
            evidenceItemId: semantic.id,
          });
        }
      } else if (semantic.classification === "assumption") {
        if (
          semantic.fieldId !== "security_type"
          || semantic.value !== "preferred"
          || semantic.assumptionPolicyVersion
            !== SEMANTIC_CONTEXT_ASSUMPTION_POLICY_VERSION
          || !semantic.requiresConfirmation
        ) {
          throw new SemanticEvidenceProjectionError(
            `Semantic assumption ${semantic.id} is outside the reviewed context policy.`,
          );
        }
        assumptions.push(AssumptionSchema.parse({
          id: semantic.id,
          analysisType: "assumption",
          provenanceOrigin: "recommended_policy",
          scenario: "all",
          field: semantic.fieldId,
          value: semantic.value,
          unit: null,
          rationale:
            `${semantic.assumptionPolicyVersion}: ${semantic.rationale}`,
          inputRefIds: [evidence.id],
          sensitivity: "high",
          requiresConfirmation: true,
        }));
      } else if (semantic.classification === "unavailable") {
        unavailableFields.push({
          fieldId: semantic.fieldId,
          evidenceItemId: semantic.id,
        });
        if (semantic.fieldId === "geography" && reviewedContext) {
          const mapping = reviewedContext.geography;
          if (
            mapping.semanticValue !== null
            || evidence.sourceId !== mapping.sourceId
          ) {
            throw new SemanticEvidenceProjectionError(
              `Semantic context ${semantic.id} does not match the exact reviewed unavailable source.`,
            );
          }
          contextValues.push({
            fieldId: "geography",
            value: mapping.canonicalValue,
            evidenceItemId: semantic.id,
          });
        }
      }
    }
  }

  return { facts, assumptions, unavailableFields, contextValues };
}

function projectAcceptedPublicClaimBridge(
  evidence: SourceEvidenceInput,
): Fact | null {
  if (!evidence.acceptedForGate) return null;
  const source = evidence.sourceRef;
  if (!source || source.provenance !== "public_web") return null;
  const normalizedStatement = source.text.status === "verified_exact"
    ? source.text.normalizedStatement
    : source.text.status === "normalized_only"
    ? source.text.normalizedStatement
    : null;
  if (
    evidence.provenanceOrigin !== "public_source"
    || source.id !== evidence.id
    || source.documentId !== evidence.sourceId
    || source.sourceRevisionId !== evidence.sourceRevisionId
    || !normalizedStatement
    || normalizedStatement !== evidence.value
    || (source.text.status === "verified_exact"
      && normalizedStatement === source.text.verbatimExcerpt)
  ) {
    throw new SemanticEvidenceProjectionError(
      `Accepted public claim ${evidence.id} does not preserve exact normalized source and revision lineage.`,
    );
  }
  return normalizeSourceEvidence({
    ...evidence,
    value: normalizedStatement,
  });
}

function reviewedContextFor(
  evidence: SourceEvidenceInput,
): (typeof REVIEWED_CONTEXTS)[ReviewedContextKey] {
  const ref = evidence.sourceRef!;
  const matchingKeys = ref.entityKeys.filter(
    (key): key is ReviewedContextKey => key in REVIEWED_CONTEXTS,
  );
  if (
    ref.providerId !== "belief_reversal_snapshot_v1"
    || matchingKeys.length !== 1
  ) {
    throw new SemanticEvidenceProjectionError(
      `Semantic evidence ${evidence.id} is outside the reviewed context mapping.`,
    );
  }
  return REVIEWED_CONTEXTS[matchingKeys[0]];
}

function isContextField(
  fieldId: string,
): fieldId is "stage" | "business_model" | "geography" {
  return fieldId === "stage"
    || fieldId === "business_model"
    || fieldId === "geography";
}

function assertSemanticSources(input: {
  semantic: NonNullable<SourceEvidenceInput["semanticFields"]>[number];
  evidenceById: ReadonlyMap<string, SourceEvidenceInput>;
}): void {
  const sourceIds = input.semantic.classification === "fact"
    ? input.semantic.sourceIds
    : input.semantic.classification === "unavailable"
    ? input.semantic.checkedSourceIds
    : input.semantic.classification === "conflicting"
    ? input.semantic.observations.map(({ sourceId }) => sourceId)
    : [];
  for (const sourceId of sourceIds) {
    const source = input.evidenceById.get(sourceId);
    const ref = source?.sourceRef;
    if (
      !source
      || source.field !== "public_claim"
      || !ref
      || ref.id !== source.id
      || ref.documentId !== source.sourceId
      || ref.sourceRevisionId !== source.sourceRevisionId
    ) {
      throw new SemanticEvidenceProjectionError(
        `Semantic source ${sourceId} does not resolve to exact active claim lineage.`,
      );
    }
  }
}
