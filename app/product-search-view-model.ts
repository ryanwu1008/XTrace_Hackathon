import type {
  UnderwritingSearchResult,
} from "../lib/underwriting/read-model";

interface ProductSearchCitationBase {
  id: string;
  title: string;
  excerpt: string;
}

export type ProductSearchCitation = ProductSearchCitationBase & (
  | {
      provenance: "source_document";
      sourceRevisionId: string;
      url: string;
    }
  | {
      provenance: "underwriting_reference";
      sourceRevisionId?: undefined;
      url?: undefined;
    }
);

export function toProductSearchMessage(
  results: UnderwritingSearchResult[],
): {
  text: string;
  citations: ProductSearchCitation[];
} {
  const revisionIds = [...new Set(
    results.flatMap((result) => result.sourceRevisionIds),
  )].sort();
  const referenceKinds = new Map<
    string,
    "policy_ref" | "benchmark_ref" | "reference_ref"
  >();
  for (const result of results) {
    const typedReferences = new Map(
      result.claimEdges.flatMap((edge) =>
        edge.dependencyType === "policy_ref"
          || edge.dependencyType === "benchmark_ref"
          ? [[edge.dependencyItemId, edge.dependencyType] as const]
          : []
      ),
    );
    const artifactInputIds = new Set(
      result.claimEdges.flatMap((edge) =>
        edge.dependencyType === "fact"
          || edge.dependencyType === "assumption"
          || edge.dependencyType === "calculation"
          || edge.dependencyType === "framework_judgment"
          ? [edge.dependencyItemId]
          : []
      ),
    );
    for (const inputRefId of result.inputRefIds) {
      if (artifactInputIds.has(inputRefId)) continue;
      const nextKind = typedReferences.get(inputRefId) ?? "reference_ref";
      const currentKind = referenceKinds.get(inputRefId);
      if (currentKind === undefined || currentKind === "reference_ref") {
        referenceKinds.set(inputRefId, nextKind);
      }
    }
  }
  const referenceCitations = [...referenceKinds.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, kind]): ProductSearchCitation => ({
      id,
      provenance: "underwriting_reference",
      title: `${
        kind === "policy_ref"
          ? "Policy reference"
          : kind === "benchmark_ref"
          ? "Benchmark reference"
          : "Persisted reference"
      } · ${id}`,
      excerpt:
        "Exact immutable reference ID persisted with this underwriting assumption.",
    }));
  return {
    text: results.length
      ? results.map((result) =>
          `${result.analysisType}: ${result.text}`
        ).join("\n\n")
      : "No finalized persisted underwriting artifact matched this query.",
    citations: [
      ...revisionIds.map((sourceRevisionId): ProductSearchCitation => ({
        id: sourceRevisionId,
        provenance: "source_document",
        sourceRevisionId,
        title: `Source Revision ${sourceRevisionId}`,
        url: `/api/source-revisions/${
          encodeURIComponent(sourceRevisionId)
        }/access`,
        excerpt: "Finalized persisted underwriting source revision.",
      })),
      ...referenceCitations,
    ],
  };
}
