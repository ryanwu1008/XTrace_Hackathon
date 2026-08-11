import { z } from "zod";

import {
  DecisionTaxonomyDocumentSchema,
} from "./decision-taxonomy-contract";

const NonEmptyStringSchema = z.string().min(1);
const NonEmptyStringsSchema = z.array(NonEmptyStringSchema).min(1);
const UniqueStringsSchema = z.array(z.string()).superRefine(
  (values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({
        code: "custom",
        message: "String identities must be unique",
      });
    }
  },
);

export const DecisionQuestionTaxonomyAuthoringSchema =
  DecisionTaxonomyDocumentSchema;

export const ResearchSourceLocatorSchema = z.strictObject({
  kind: z.enum([
    "chapter_page",
    "pdf_page",
    "ebook_location",
    "video_timestamp",
    "web_section",
  ]),
  value: NonEmptyStringSchema,
});

export const ResearchSourceRefSchema = z.strictObject({
  sourceId: NonEmptyStringSchema,
  claimIds: NonEmptyStringsSchema,
  locator: ResearchSourceLocatorSchema,
  attributionScope: z.enum([
    "person_direct",
    "coauthored_work",
    "course_notes_derivative",
    "institution_doctrine",
    "revealed_behavior",
    "external_empirical",
  ]),
  supportType: z.enum([
    "primary",
    "corroborating",
    "qualification",
    "conflict",
    "counterexample",
  ]),
});

const ApplicabilitySchema = z.strictObject({
  stages: NonEmptyStringsSchema,
  businessModels: NonEmptyStringsSchema,
  sectors: NonEmptyStringsSchema,
  geographies: NonEmptyStringsSchema,
  securityTypes: NonEmptyStringsSchema,
});

const EvidenceRequirementSchema = z.strictObject({
  evidenceKey: z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/),
  description: NonEmptyStringSchema,
  necessity: z.enum(["required", "recommended", "optional"]),
  acceptableSources: NonEmptyStringsSchema,
  missingEffect: z.enum([
    "not_applicable",
    "insufficient_evidence",
    "lower_confidence",
    "no_effect",
  ]),
});

const AnchorScaleSchema = z.strictObject({
  low: NonEmptyStringSchema,
  medium: NonEmptyStringSchema,
  high: NonEmptyStringSchema,
});

const PackReviewSchema = z.strictObject({
  contentStatus: z.enum(["draft", "review_ready", "approved", "rejected"]),
  publicationStatus: z.enum(["unpublished", "published", "retired"]),
  openIssues: z.array(z.string()),
});

export const FrameworkPackAuthoringSchema = z.strictObject({
  schemaVersion: z.literal("framework-pack-authoring-v1"),
  packId: z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/),
  name: NonEmptyStringSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: NonEmptyStringSchema,
  cardFiles: z.array(
    z.string().regex(/^cards\/[a-z0-9-]+\.card\.json$/),
  ).min(1).superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({
        code: "custom",
        message: "Card file paths must be unique",
      });
    }
  }),
  sourceCatalog: z.literal("sources.json"),
  executionPolicy: z.strictObject({
    independentLensExecution: z.literal(true),
    preserveDisagreements: z.literal(true),
    hiddenChainOfThought: z.literal(false),
    formalDecisionFactorRule: z.literal(
      "Only cards with decisionUtility.status=validated_decision_factor may carry non-zero formal decision weight.",
    ),
  }),
  review: PackReviewSchema,
});

export const FrameworkCardAuthoringSchema = z.strictObject({
  schemaVersion: z.literal("framework-card-authoring-v1"),
  frameworkId: z.string().regex(
    /^[A-Z0-9]+-[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
  ),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: NonEmptyStringSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  positioning: z.strictObject({
    oneLineSummary: NonEmptyStringSchema,
    productLabel: NonEmptyStringSchema,
    notAClaimOf: NonEmptyStringsSchema,
  }),
  attribution: z.strictObject({
    display: NonEmptyStringSchema,
    scope: z.enum([
      "person_direct",
      "coauthored_work",
      "course_notes_derivative",
      "institution_doctrine",
      "revealed_behavior",
      "product_synthesis",
    ]),
    people: z.array(NonEmptyStringSchema),
    organizations: z.array(NonEmptyStringSchema),
    fidelityConfidence: z.enum(["low", "medium", "medium_high", "high"]),
  }),
  neutralParaphrase: NonEmptyStringSchema,
  claimTypes: z.array(z.enum([
    "direct_doctrine",
    "affiliated_doctrine",
    "revealed_behavior",
    "historical_description",
    "empirical_association",
    "normative_guidance",
    "contractual_convention",
    "product_inference",
    "empirical_qualification",
  ])).min(1).superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({
        code: "custom",
        message: "Claim types must be unique",
      });
    }
  }),
  sourceRefs: z.array(ResearchSourceRefSchema).min(1),
  applicability: ApplicabilitySchema,
  requiredConditions: NonEmptyStringsSchema,
  requiredEvidence: z.array(EvidenceRequirementSchema).min(1),
  decisionQuestions: NonEmptyStringsSchema,
  positiveSignals: NonEmptyStringsSchema,
  redFlags: NonEmptyStringsSchema,
  disconfirmingEvidence: NonEmptyStringsSchema,
  contraindications: NonEmptyStringsSchema,
  decisionMethod: z.strictObject({
    kind: z.enum([
      "qualitative_lens",
      "ordinal_anchors",
      "deterministic_rule",
      "hybrid",
    ]),
    instructions: NonEmptyStringsSchema,
    outputOrder: z.tuple([
      z.literal("evidence"),
      z.literal("applicable_rule"),
      z.literal("judgment"),
      z.literal("counterevidence"),
      z.literal("unknowns"),
      z.literal("conclusion"),
      z.literal("next_evidence_request"),
    ]),
    deterministicRule: z.union([
      z.null(),
      z.record(z.string(), z.unknown()),
    ]),
  }),
  confidenceAnchors: z.strictObject({
    sourceReliability: AnchorScaleSchema,
    evidenceStrength: AnchorScaleSchema,
    evidenceCoverage: AnchorScaleSchema,
    applicabilityConfidence: AnchorScaleSchema,
    judgmentConfidence: AnchorScaleSchema,
  }),
  overlapFrameworkIds: UniqueStringsSchema,
  conflictingFrameworkIds: UniqueStringsSchema,
  decisionUtility: z.strictObject({
    status: z.enum([
      "advisory",
      "candidate",
      "validated_decision_factor",
      "retired",
    ]),
    formalDecisionWeight: z.number().min(0).max(1),
    allowedUses: z.array(z.enum([
      "research_question",
      "watch_rationale",
      "advance_rationale",
      "invest_candidate_gate",
      "veto",
      "portfolio_policy",
    ])).superRefine((values, context) => {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          message: "Allowed uses must be unique",
        });
      }
    }),
    promotionRequirements: z.array(NonEmptyStringSchema),
    empiricalQualifications: z.array(NonEmptyStringSchema),
  }),
  rights: z.strictObject({
    status: z.enum([
      "pending_review",
      "public_source_paraphrase",
      "licensed",
      "public_domain",
      "restricted",
      "rejected",
    ]),
    displayMode: z.enum([
      "neutral_paraphrase_only",
      "short_quote_and_paraphrase",
      "internal_locator_only",
    ]),
    containsLongQuote: z.literal(false),
    notes: z.string(),
  }),
  review: z.strictObject({
    contentStatus: z.enum([
      "draft",
      "review_ready",
      "approved",
      "rejected",
    ]),
    publicationStatus: z.enum(["unpublished", "published", "retired"]),
    reviewer: z.string().nullable(),
    reviewedAt: z.iso.datetime({ offset: true }).nullable(),
    openIssues: z.array(z.string()),
  }),
  changeLog: z.array(z.strictObject({
    version: z.string(),
    date: z.iso.date(),
    summary: NonEmptyStringSchema,
  })).min(1),
});

export const ResearchSourceRecordSchema = z.strictObject({
  sourceId: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  authorOrSpeaker: NonEmptyStringsSchema,
  publisher: NonEmptyStringSchema,
  sourceClass: z.enum(["A1", "E1", "I1", "P1", "P2", "S1"]),
  sourceType: NonEmptyStringSchema,
  url: NonEmptyStringSchema,
  edition: NonEmptyStringSchema,
  publishedAt: z.string().nullable(),
  eventAt: z.string().nullable(),
  accessedAt: z.iso.date(),
  language: NonEmptyStringSchema,
  rightsStatus: NonEmptyStringSchema,
  attributionScope: z.enum([
    "affiliated_doctrine",
    "coauthored_work",
    "course_notes_derivative",
    "external_claim",
    "external_empirical",
    "institution_doctrine",
    "person_direct",
    "revealed_behavior",
  ]),
  attributionNotes: NonEmptyStringSchema,
  immutableRevision: z.strictObject({
    status: NonEmptyStringSchema,
    hashAlgorithm: z.string().nullable(),
    contentHash: z.string().nullable(),
    reviewedPdfPages: z.array(z.number().int().positive()).optional(),
    reviewedTimestampRanges: z.array(NonEmptyStringSchema).optional(),
    videoId: NonEmptyStringSchema.optional(),
  }),
});

export const ResearchSourceCatalogSchema = z.strictObject({
  schemaVersion: z.literal("framework-source-catalog-v1"),
  catalogId: NonEmptyStringSchema,
  subject: z.strictObject({
    people: z.array(NonEmptyStringSchema),
    organizations: z.array(NonEmptyStringSchema),
  }),
  researchCutoff: z.iso.date(),
  sources: z.array(ResearchSourceRecordSchema).min(1),
  excludedSources: z.array(z.strictObject({
    sourceId: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    reason: NonEmptyStringSchema,
  })).optional(),
});

export type FrameworkPackAuthoring = z.infer<
  typeof FrameworkPackAuthoringSchema
>;
export type FrameworkCardAuthoring = z.infer<
  typeof FrameworkCardAuthoringSchema
>;
export type ResearchSourceCatalog = z.infer<
  typeof ResearchSourceCatalogSchema
>;
export type ResearchSourceRecord = z.infer<
  typeof ResearchSourceRecordSchema
>;
