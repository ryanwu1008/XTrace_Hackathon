import {
  WritableSourceRefV2Schema,
  type WritableSourceRefV2,
} from "../contracts/source-evidence";

interface CanonicalPublicSource {
  id: string;
  title: string;
  canonicalUrl: string;
  publisher: string;
  eventAt: string | null;
  publishedAt: string | null;
  publicationTimestamp: string | null;
  retrievedAt: string;
  entityKeys: readonly string[];
  sourceClass:
    | "company_official"
    | "government_or_regulator"
    | "court_or_public_filing"
    | "customer_or_partner_official"
    | "investor_official"
    | "funding_publication"
    | "industry_publication"
    | "commercial_database"
    | "founder_social";
  sourceAuthority: "primary" | "secondary";
  evidenceRole: "trigger" | "corroborating" | "counterevidence";
  locator: string;
  verbatimExcerpt: string;
  normalizedStatement: string;
}

interface SelectedPublicSource extends CanonicalPublicSource {
  supportedClaimId: string;
}

type ResolvedScreeningSource = CanonicalPublicSource;
type CanonicalRevision = {
  id: string;
  sourceId: string;
  contentHash: string;
};

export function buildBeliefReversalSelectedPublicSourceRef(input: {
  manifest: { retrievalDate: string };
  source: SelectedPublicSource;
  revision: CanonicalRevision;
}): WritableSourceRefV2 {
  return buildCanonicalPublicSourceRef({
    source: input.source,
    revision: input.revision,
    evidenceId: input.source.supportedClaimId,
    providerId: "belief_reversal_snapshot_v1",
    retrievedAt: input.manifest.retrievalDate,
  });
}

export function buildBeliefReversalResearchPublicSourceRef(input: {
  source: ResolvedScreeningSource;
  revision: CanonicalRevision;
}): WritableSourceRefV2 {
  return buildCanonicalPublicSourceRef({
    source: input.source,
    revision: input.revision,
    evidenceId: researchEvidenceId(input.source.id),
    providerId: "belief_reversal_research_snapshot_v1",
    retrievedAt: input.source.retrievedAt,
  });
}

function buildCanonicalPublicSourceRef(input: {
  source: SelectedPublicSource | ResolvedScreeningSource;
  revision: CanonicalRevision;
  evidenceId: string;
  providerId: string;
  retrievedAt: string;
}): WritableSourceRefV2 {
  if (input.revision.sourceId !== input.source.id) {
    throw new Error(
      `Source Revision ${input.revision.id} does not belong to ${input.source.id}.`,
    );
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.revision.contentHash)) {
    throw new Error(
      `Source Revision ${input.revision.id} has no canonical SHA-256 content hash.`,
    );
  }
  const publishedAt = input.source.publicationTimestamp
    ?? input.source.publishedAt;
  return WritableSourceRefV2Schema.parse({
    schemaVersion: "source-ref-v2",
    adaptation: "canonical",
    id: input.evidenceId,
    provenance: "public_web",
    title: input.source.title,
    canonicalUrl: input.source.canonicalUrl,
    documentId: input.source.id,
    publisher: input.source.publisher,
    providerId: input.providerId,
    eventAt: input.source.eventAt,
    eventAtPrecision: input.source.eventAt === null ? null : "date",
    publishedAt,
    publishedAtPrecision: publishedAt === null
      ? null
      : input.source.publicationTimestamp === null
      ? "date"
      : "timestamp",
    retrievedAt: input.retrievedAt,
    retrievedAtPrecision: "date",
    updatedAt: null,
    updatedAtPrecision: null,
    entityKeys: [...input.source.entityKeys],
    sourceClass: input.source.sourceClass,
    sourceAuthority: input.source.sourceAuthority,
    evidenceRole: input.source.evidenceRole,
    sourceRevisionId: input.revision.id,
    locator: { kind: "web_text", selector: input.source.locator },
    contentFingerprint: input.revision.contentHash,
    text: {
      status: "verified_exact",
      verbatimExcerpt: input.source.verbatimExcerpt,
      normalizedStatement: input.source.normalizedStatement,
    },
  });
}

function researchEvidenceId(sourceId: string): string {
  if (!/^source_[a-z0-9_]+_v\d+$/u.test(sourceId)) {
    throw new Error(`Research source id ${sourceId} is not stable.`);
  }
  return sourceId.replace(/^source_/u, "research_evidence_");
}
