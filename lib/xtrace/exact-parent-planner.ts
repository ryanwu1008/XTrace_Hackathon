import { createHash } from "node:crypto";

import type {
  DealRegistry,
  ExactSourceMemoryBundle,
} from "../../db/repositories/deal-registry";
import type { SourceRegistry } from "../../db/repositories/source-registry";
import { canonicalEvidenceJson } from "../contracts/source-evidence";
import {
  SAMPLE_RESEARCH_SCREENING_RECORD_LABEL,
} from "../contracts/research-candidate";

export type ExactXTraceParentKind =
  | "legacy_source_revision"
  | "canonical_source_revision"
  | "sample_decision_record"
  | "sample_research_screening_record";

export interface ExactXTraceParentUnit extends ExactSourceMemoryBundle {
  parentKind: ExactXTraceParentKind;
  parentFingerprint: string;
  payloadFingerprint: string;
}

export function createExactParentPlanner(dependencies: {
  dealRegistry: Pick<
    DealRegistry,
    | "listForWorkspace"
    | "listActiveSourceAssignments"
    | "getExactSourceBundle"
  >;
  sourceRegistry: Pick<SourceRegistry, "getRevision">;
}) {
  return {
    async plan(workspaceId: string): Promise<ExactXTraceParentUnit[]> {
      const normalizedWorkspaceId = workspaceId.trim();
      if (!normalizedWorkspaceId) throw new Error("An XTrace workspace is required.");
      const [deals, ownerships] = await Promise.all([
        dependencies.dealRegistry.listForWorkspace(normalizedWorkspaceId),
        dependencies.dealRegistry.listActiveSourceAssignments(normalizedWorkspaceId),
      ]);
      const dealById = new Map(deals.map((deal) => [deal.id, deal]));
      const seen = new Set<string>();
      const units: ExactXTraceParentUnit[] = [];
      for (const ownership of ownerships) {
        if (ownership.workspaceId !== normalizedWorkspaceId) {
          throw new Error("An active XTrace parent crossed workspace authority.");
        }
        const deal = dealById.get(ownership.dealId);
        if (
          !deal
          || deal.workspaceId !== normalizedWorkspaceId
          || deal.analysisEligibleAt === null
          || !deal.activeSourceRevisionIds.includes(ownership.sourceRevisionId)
        ) {
          throw new Error("An XTrace parent is missing, inactive, or belongs to another Deal.");
        }
        const identity = JSON.stringify([
          ownership.workspaceId,
          ownership.dealId,
          ownership.sourceId,
          ownership.sourceRevisionId,
        ]);
        if (seen.has(identity)) throw new Error("An active XTrace parent is ambiguous.");
        seen.add(identity);
        const [exact, revision] = await Promise.all([
          dependencies.dealRegistry.getExactSourceBundle(ownership),
          dependencies.sourceRegistry.getRevision({
            workspaceId: normalizedWorkspaceId,
            revisionId: ownership.sourceRevisionId,
          }),
        ]);
        if (
          !exact
          || !revision
          || revision.workspaceId !== normalizedWorkspaceId
          || revision.sourceId !== ownership.sourceId
          || !/^(?:sha256:)?[0-9a-f]{64}$/.test(revision.contentHash)
        ) {
          throw new Error(
            `An XTrace parent has unresolved or inconsistent source lineage: ${ownership.dealId}/${ownership.sourceRevisionId}.`,
          );
        }
        units.push(createExactXTraceParentUnit(exact, revision));
      }
      return units;
    },
  };
}

export function createExactXTraceParentUnit(
  exact: ExactSourceMemoryBundle,
  revision: { workspaceId: string; sourceId: string; contentHash: string },
): ExactXTraceParentUnit {
  if (
    revision.workspaceId !== exact.workspaceId
    || revision.sourceId !== exact.sourceId
    || !/^(?:sha256:)?[0-9a-f]{64}$/.test(revision.contentHash)
  ) throw new Error("An XTrace parent has inconsistent source revision authority.");
  assertExactBundle(exact);
  const payload = canonicalEvidenceJson(exact.bundle);
  if (Buffer.byteLength(payload, "utf8") > 128_000) {
    throw new Error("An XTrace parent retrieval payload exceeds its bounded contract.");
  }
  return {
    ...structuredClone(exact),
    parentKind: classifyParent(exact),
    parentFingerprint: revision.contentHash.startsWith("sha256:")
      ? revision.contentHash
      : `sha256:${revision.contentHash}`,
    payloadFingerprint: `sha256:${createHash("sha256")
      .update(lengthFrame(["xtrace-parent-payload-v2", payload]), "utf8")
      .digest("hex")}`,
  };
}

function assertExactBundle(exact: ExactSourceMemoryBundle): void {
  const { bundle } = exact;
  if (bundle.dealId !== exact.dealId || bundle.facts.length + bundle.interactions.length === 0) {
    throw new Error("An XTrace parent payload does not match its Deal or is empty.");
  }
  for (const fact of bundle.facts) {
    if (fact.sources.length !== 1) {
      throw new Error("Each XTrace fact must resolve to exactly one parent.");
    }
    const source = fact.sources[0];
    if (source.documentId !== exact.sourceId) {
      throw new Error("An XTrace fact crossed its exact source parent.");
    }
    if ("sourceRevisionId" in source && source.sourceRevisionId !== exact.sourceRevisionId) {
      throw new Error("An XTrace fact crossed its exact source revision.");
    }
  }
  for (const interaction of bundle.interactions) {
    if (interaction.source) {
      if (
        interaction.source.documentId !== exact.sourceId
        || interaction.source.sourceRevisionId !== exact.sourceRevisionId
      ) {
        throw new Error("An XTrace interaction crossed its exact parent.");
      }
    }
  }
}

function classifyParent(exact: ExactSourceMemoryBundle): ExactXTraceParentKind {
  const sampleInteractions = exact.bundle.interactions.filter((interaction) =>
    interaction.source !== undefined
  );
  if (sampleInteractions.length > 0) {
    if (
      exact.bundle.facts.length !== 0
      || exact.bundle.interactions.length !== 1
      || sampleInteractions.length !== 1
    ) throw new Error("A Sample XTrace parent must own exactly one interaction.");
    const sample = sampleInteractions[0];
    if (
      sample.provenance !== "demo_fixture"
      || sample.label !== "Sample decision record"
      || !sample.actionPolicyVersion
      || !sample.interactionSchemaVersion
      || !sample.priorActions?.length
      || "expectedOutcome" in sample
      || "expectedOutcomes" in sample
    ) throw new Error("A Sample XTrace parent lost its permanent typed marker.");
    return "sample_decision_record";
  }
  const sampleResearchFacts = exact.bundle.facts.filter((fact) =>
    fact.text.startsWith(`${SAMPLE_RESEARCH_SCREENING_RECORD_LABEL}.`)
  );
  if (sampleResearchFacts.length > 0) {
    const fact = sampleResearchFacts[0]!;
    const source = fact.sources[0];
    if (
      exact.bundle.interactions.length !== 0
      || exact.bundle.facts.length !== 1
      || sampleResearchFacts.length !== 1
      || fact.sources.length !== 1
      || !("schemaVersion" in source)
      || source.provenance !== "source_document"
      || source.title !== SAMPLE_RESEARCH_SCREENING_RECORD_LABEL
      || source.sourceClass !== "internal_decision_record"
      || source.sourceAuthority !== "primary"
      || source.evidenceRole !== "context"
      || source.documentId !== exact.sourceId
      || source.sourceRevisionId !== exact.sourceRevisionId
      || !fact.text.includes(
        "Synthetic research-only context; no meeting or VC interaction occurred.",
      )
      || /expectedOutcome|expectedOutcomes/u.test(canonicalEvidenceJson(fact))
    ) {
      throw new Error(
        "A Sample research screening XTrace parent lost its permanent non-interaction marker.",
      );
    }
    return "sample_research_screening_record";
  }
  if (
    exact.bundle.interactions.length === 0
    && exact.bundle.facts.length > 0
    && exact.bundle.facts.every((fact) => fact.sources.every((source) =>
      "schemaVersion" in source
      && source.schemaVersion === "source-ref-v2"
      && source.provenance === "public_web"
    ))
  ) return "canonical_source_revision";
  return "legacy_source_revision";
}

function lengthFrame(values: readonly string[]): string {
  return values.map((value) => `${Buffer.byteLength(value, "utf8")}:${value}`).join("");
}
