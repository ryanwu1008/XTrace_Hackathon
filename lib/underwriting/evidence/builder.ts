import { createHash } from "node:crypto";

import type {
  EvidencePacksRepository,
  SavedEvidencePack,
  SourceEvidenceInput,
} from "../../../db/repositories/evidence-packs";
import type {
  SourceRegistry,
} from "../../../db/repositories/source-registry";
import {
  EvidencePackSchema,
  type Assumption,
  type EvidencePack,
  type Fact,
  type SourceRevision,
} from "../../contracts/evidence";
import type {
  FundPolicySnapshot,
  ResolvedUnderwritingContext,
  XTraceLineageSnapshot,
} from "../../contracts/underwriting";
import {
  buildEvidenceConflicts,
  DEFAULT_MATERIALITY_RULES,
  type MaterialityRule,
} from "./conflicts";
import { projectUnderwritingEvidence } from "./semantic-projector";
import type {
  ContextRouter,
  CriticalEvidenceProfile,
} from "../router";

const EVIDENCE_PACK_VERSION = 1;
const BUILDER_VERSION = "evidence_pack_builder_v2";

export interface SelectedBenchmarkInput {
  packId: string;
  entryId: string;
  version: string;
  value: string;
  currency: string;
  effectiveAt: string;
  staleAfter: string;
  definitionFingerprint: string;
}

export interface EvidencePackBuilder {
  build(input: {
    workspaceId: string;
    dealId: string;
    asOfDate: string;
    sourceRevisionIds: string[];
    xtraceLineage: XTraceLineageSnapshot;
    context: ResolvedUnderwritingContext;
    fundPolicy: FundPolicySnapshot;
    benchmark: SelectedBenchmarkInput | null;
  }): Promise<EvidencePack>;
}

export function createEvidencePackBuilder(options: {
  repository: EvidencePacksRepository;
  sourceRegistry: SourceRegistry;
  router: ContextRouter;
  criticalEvidenceProfiles: CriticalEvidenceProfile[];
  materialityRules?: MaterialityRule[];
  now?: () => Date;
}): EvidencePackBuilder {
  const now = options.now ?? (() => new Date());
  const materialityRules =
    options.materialityRules ?? DEFAULT_MATERIALITY_RULES;
  const profiles = new Map(
    options.criticalEvidenceProfiles.map((profile) => [profile.id, profile]),
  );

  return {
    async build(input) {
      assertContextDate(input.context, input.asOfDate);
      const profile = profiles.get(input.context.criticalEvidenceProfileId);
      if (!profile) {
        throw new Error(
          `Critical evidence profile ${input.context.criticalEvidenceProfileId} is unavailable.`,
        );
      }
      const sourceRevisionIds = uniqueSorted(input.sourceRevisionIds);
      const sourceRevisionSnapshots = await resolveSourceRevisions({
        sourceRegistry: options.sourceRegistry,
        workspaceId: input.workspaceId,
        sourceRevisionIds,
      });
      validateXTraceLineage({
        xtraceLineage: input.xtraceLineage,
        sourceRevisionIds,
        sourceRevisionSnapshots,
      });
      const sourceEvidence = await options.repository.listSourceEvidence({
        workspaceId: input.workspaceId,
        dealId: input.dealId,
        sourceRevisionIds,
      });
      validateEvidenceOwnership({
        sourceEvidence,
        workspaceId: input.workspaceId,
        dealId: input.dealId,
        sourceRevisionIds,
        sourceRevisionSnapshots,
      });
      const projected = projectUnderwritingEvidence(sourceEvidence);
      const facts = projected.facts
        .sort((left, right) => compareUtf8(left.id, right.id));
      const conflicts = buildEvidenceConflicts(
        facts,
        materialityRules,
      ).sort((left, right) => compareUtf8(left.id, right.id));
      const assumptions = buildAssumptions({
        workspaceId: input.workspaceId,
        context: input.context,
        facts,
        conflicts,
        fundPolicy: input.fundPolicy,
        benchmark: input.benchmark,
      }).concat(projected.assumptions)
        .sort((left, right) => compareUtf8(left.id, right.id));
      const inputFingerprint = createEvidencePackInputFingerprint({
        workspaceId: input.workspaceId,
        dealId: input.dealId,
        asOfDate: input.asOfDate,
        sourceRevisionSnapshots,
        xtraceLineage: input.xtraceLineage,
        context: input.context,
        fundPolicy: input.fundPolicy,
        benchmark: input.benchmark,
        profile,
        materialityRules,
        facts,
        assumptions,
        conflicts,
      });
      const existing = await options.repository.findByInputFingerprint({
        workspaceId: input.workspaceId,
        inputFingerprint,
      });
      if (existing) return existing.pack;

      const packId = `evidence_pack:${inputFingerprint.slice("sha256:".length)}`;
      const createdAt = now().toISOString();
      const provisional: EvidencePack = {
        id: packId,
        version: EVIDENCE_PACK_VERSION,
        workspaceId: input.workspaceId,
        dealId: input.dealId,
        asOfDate: input.asOfDate,
        sourceRevisionIds,
        facts,
        assumptions,
        conflicts,
        coverage: {
          minimumModelInputsComplete: false,
          criticalEvidenceComplete: false,
          missingFieldIds: [],
          blockingConflictIds: [],
          decisionCeiling: null,
          underwritingStatus: "unavailable",
          reasonCodes: [],
        },
        createdAt,
      };
      const pack = EvidencePackSchema.parse({
        ...provisional,
        coverage: options.router.evaluateCoverage({
          pack: provisional,
          profile,
          context: input.context,
        }),
      });
      const saved: SavedEvidencePack = await options.repository.saveExact({
        pack,
        inputFingerprint,
        sourceRevisionSnapshots,
      });
      return saved.pack;
    },
  };
}

export function createEvidencePackInputFingerprint(input: {
  workspaceId: string;
  dealId: string;
  asOfDate: string;
  sourceRevisionSnapshots: SourceRevision[];
  xtraceLineage: XTraceLineageSnapshot;
  context: ResolvedUnderwritingContext;
  fundPolicy: FundPolicySnapshot;
  benchmark: SelectedBenchmarkInput | null;
  profile: CriticalEvidenceProfile;
  materialityRules: MaterialityRule[];
  facts: Fact[];
  assumptions: Assumption[];
  conflicts: EvidencePack["conflicts"];
}): string {
  const canonical = canonicalJson({
    version: BUILDER_VERSION,
    workspaceId: input.workspaceId,
    dealId: input.dealId,
    asOfDate: input.asOfDate,
    sourceRevisionSnapshots: sortById(input.sourceRevisionSnapshots),
    xtraceLineage: {
      ...input.xtraceLineage,
      memoryIds: uniqueSorted(input.xtraceLineage.memoryIds),
      sourceRevisionIds: uniqueSorted(
        input.xtraceLineage.sourceRevisionIds,
      ),
      sourceIds: uniqueSorted(input.xtraceLineage.sourceIds),
      fixtureIds: uniqueSorted(input.xtraceLineage.fixtureIds),
    },
    context: input.context,
    fundPolicy: input.fundPolicy,
    benchmark: input.benchmark,
    profile: input.profile,
    materialityRules: sortById(input.materialityRules),
    facts: sortById(input.facts),
    assumptions: sortById(input.assumptions),
    conflicts: sortById(input.conflicts),
  });
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

async function resolveSourceRevisions(input: {
  sourceRegistry: SourceRegistry;
  workspaceId: string;
  sourceRevisionIds: string[];
}): Promise<SourceRevision[]> {
  const revisions: SourceRevision[] = [];
  for (const revisionId of input.sourceRevisionIds) {
    const revision = await input.sourceRegistry.getRevision({
      workspaceId: input.workspaceId,
      revisionId,
    });
    if (!revision) {
      throw new Error(
        `Source revision ${revisionId} is unavailable in this workspace.`,
      );
    }
    revisions.push(revision);
  }
  return sortById(revisions);
}

function validateXTraceLineage(input: {
  xtraceLineage: XTraceLineageSnapshot;
  sourceRevisionIds: string[];
  sourceRevisionSnapshots: SourceRevision[];
}): void {
  const lineage = input.xtraceLineage;
  if (lineage.memoryIds.length === 0) {
    if (
      lineage.sourceRevisionIds.length > 0
      || lineage.sourceIds.length > 0
      || lineage.fixtureIds.length > 0
    ) {
      throw new Error(
        "XTrace lineage without recalled memories cannot name source lineage.",
      );
    }
    return;
  }
  if (lineage.sourceRevisionIds.length === 0) {
    throw new Error(
      "XTrace recalled text requires exact local source revision lineage.",
    );
  }
  const packRevisionIds = new Set(input.sourceRevisionIds);
  if (
    lineage.sourceRevisionIds.some((id) => !packRevisionIds.has(id))
  ) {
    throw new Error(
      "XTrace local source revision lineage is outside this Evidence Pack.",
    );
  }
  const lineageRevisionIds = new Set(lineage.sourceRevisionIds);
  const expectedSourceIds = uniqueSorted(
    input.sourceRevisionSnapshots
      .filter(({ id }) => lineageRevisionIds.has(id))
      .map(({ sourceId }) => sourceId),
  );
  if (!sameStringSet(expectedSourceIds, uniqueSorted(lineage.sourceIds))) {
    throw new Error(
      "XTrace source lineage does not match the exact local source revisions.",
    );
  }
}

function validateEvidenceOwnership(input: {
  sourceEvidence: SourceEvidenceInput[];
  workspaceId: string;
  dealId: string;
  sourceRevisionIds: string[];
  sourceRevisionSnapshots: SourceRevision[];
}): void {
  const revisionIds = new Set(input.sourceRevisionIds);
  const sourceIdsByRevision = new Map(
    input.sourceRevisionSnapshots.map(({ id, sourceId }) => [id, sourceId]),
  );
  for (const evidence of input.sourceEvidence) {
    if (
      evidence.workspaceId !== input.workspaceId
      || evidence.dealId !== input.dealId
      || !revisionIds.has(evidence.sourceRevisionId)
      || sourceIdsByRevision.get(evidence.sourceRevisionId)
        !== evidence.sourceId
    ) {
      throw new Error(
        `Evidence ${evidence.id} has a document/source and revision tuple outside the requested Deal lineage.`,
      );
    }
  }
}

function buildAssumptions(input: {
  workspaceId: string;
  context: ResolvedUnderwritingContext;
  facts: Fact[];
  conflicts: EvidencePack["conflicts"];
  fundPolicy: FundPolicySnapshot;
  benchmark: SelectedBenchmarkInput | null;
}): Assumption[] {
  const assumptions: Assumption[] = [];
  if (
    input.context.benchmarkPackId
    && ["exact", "broad_compatible"].includes(
      input.context.benchmarkCompatibility,
    )
  ) {
    const benchmark = input.benchmark;
    if (
      !benchmark
      || benchmark.packId !== input.context.benchmarkPackId
      || !requiredText(benchmark.entryId, "A benchmark entry")
      || !requiredText(benchmark.version, "A benchmark version")
      || benchmark.currency !== "USD"
      || !isIsoDate(benchmark.effectiveAt)
      || !isIsoDate(benchmark.staleAfter)
      || benchmark.effectiveAt > input.context.asOfDate
      || benchmark.staleAfter < input.context.asOfDate
      || !/^sha256:[0-9a-f]{64}$/.test(
        benchmark.definitionFingerprint,
      )
    ) {
      throw new Error(
        "The selected benchmark must exactly match the resolved context and be valid as-of the Evidence Pack date; future or stale benchmarks are unavailable.",
      );
    }
    assumptions.push(
      {
        id: `assumption:${input.context.id}:compatible_benchmark_value`,
        analysisType: "assumption",
        provenanceOrigin: "benchmark",
        scenario: "all",
        field: "compatible_benchmark_value",
        value: requiredText(benchmark.value, "A benchmark value"),
        unit: benchmark.currency,
        rationale:
          "Published Slice-1 benchmark value selected by the resolved context.",
        inputRefIds: [input.context.benchmarkPackId],
        sensitivity: "high",
        requiresConfirmation: false,
      },
      {
        id:
          `assumption:${input.context.id}:compatible_benchmark_stale_after`,
        analysisType: "assumption",
        provenanceOrigin: "benchmark",
        scenario: "all",
        field: "compatible_benchmark_stale_after",
        value: benchmark.staleAfter,
        unit: "date",
        rationale:
          "Expiry date published with the immutable Slice-1 benchmark pack.",
        inputRefIds: [input.context.benchmarkPackId],
        sensitivity: "high",
        requiresConfirmation: false,
      },
    );
  }

  if (input.fundPolicy.workspaceId !== input.workspaceId) {
    throw new Error("The pinned Fund Policy is outside this workspace.");
  }
  const multipliers = policyScenarioMultipliers(input.fundPolicy);
  for (const scenario of ["bear", "base", "bull"] as const) {
    assumptions.push({
      id: `assumption:${input.context.id}:scenario_price_multiplier:${scenario}`,
      analysisType: "assumption",
      provenanceOrigin: input.fundPolicy.source,
      scenario,
      field: "scenario_price_multiplier",
      value: multipliers[scenario],
      unit: "decimal",
      rationale:
        "Scenario multiplier from the pinned immutable Fund Policy snapshot.",
      inputRefIds: [input.fundPolicy.id],
      sensitivity: "high",
      requiresConfirmation: false,
    });
  }

  const criticalOpenFields = new Set(
    input.conflicts
      .filter(({ material, status }) => material && status === "open")
      .map(({ field }) => field),
  );
  for (
    const [factField, assumptionField] of [
      ["arr", "arr_path"],
      ["revenue", "revenue_path"],
    ] as const
  ) {
    const candidates = input.facts.filter((fact) =>
      fact.field === factField
      && fact.acceptedForGate
      && fact.currency !== null
      && !criticalOpenFields.has(factField)
    );
    if (candidates.length !== 1) continue;
    const fact = candidates[0]!;
    for (const scenario of ["bear", "base", "bull"] as const) {
      assumptions.push({
        id: `assumption:${input.context.id}:${assumptionField}:${scenario}`,
        analysisType: "assumption",
        provenanceOrigin: "recommended_policy",
        scenario,
        field: assumptionField,
        value: fact.value,
        unit: fact.currency,
        rationale:
          `Directional ${scenario} scenario anchored to the only accepted ${factField} Fact; no unsupported growth extrapolation applied.`,
        inputRefIds: [fact.id],
        sensitivity: "high",
        requiresConfirmation: true,
      });
    }
  }
  return assumptions;
}

function policyScenarioMultipliers(
  policy: FundPolicySnapshot,
): Record<"bear" | "base" | "bull", string> {
  const value = policy.values.scenarioPriceMultipliers;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      "The pinned Fund Policy is missing scenario price multipliers.",
    );
  }
  return Object.fromEntries(
    (["bear", "base", "bull"] as const).map((scenario) => {
      const multiplier = (value as Record<string, unknown>)[scenario];
      if (typeof multiplier !== "string" || !multiplier.trim()) {
        throw new Error(
          `The pinned Fund Policy is missing the ${scenario} multiplier.`,
        );
      }
      return [scenario, multiplier];
    }),
  ) as Record<"bear" | "base" | "bull", string>;
}

function requiredText(value: string, label: string): string {
  if (!value || value.trim() !== value) {
    throw new Error(`${label} is required without surrounding whitespace.`);
  }
  return value;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}

function assertContextDate(
  context: ResolvedUnderwritingContext,
  asOfDate: string,
): void {
  if (context.asOfDate !== asOfDate) {
    throw new Error(
      "Evidence Pack as-of date must match the immutable underwriting context.",
    );
  }
}

function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf8);
}

function sortById<T extends { id: string }>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => compareUtf8(left.id, right.id));
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortObject(value));
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareUtf8(left, right))
        .map(([key, item]) => [key, sortObject(item)]),
    );
  }
  return value;
}
