import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { makeDisposableDatabaseName, requireLoopbackPostgres } from "../helpers/require-loopback-postgres";

import {
  createMemoryUnderwritingArtifactsRepository,
} from "../../db/repositories/underwriting-artifacts";
import {
  createMemoryEvidencePacksRepository,
  type EvidencePacksRepository,
} from "../../db/repositories/evidence-packs";
import {
  createMemoryUnderwritingRunsRepository,
  type CandidateFinalization,
} from "../../db/repositories/underwriting-runs";
import type { EvidencePack } from "../../lib/contracts/evidence";
import {
  ACTION_DRAFT_POLICY_VERSION,
  ScenarioInputFieldSchema,
  type FrameworkJudgment,
  type FundPolicySnapshot,
  type ResolvedUnderwritingContext,
} from "../../lib/contracts/underwriting";
import {
  BELIEF_ACTION_POLICY_VERSION,
  actionsForDealStatusAndDirection,
} from "../../lib/reports/action-policy";
import { CONTEXT_ROUTER_VERSION } from "../../lib/underwriting/router";
import { createValuationEngine } from "../../lib/underwriting/valuation/service";
import { SYNTHETIC_FRAMEWORK_PACK } from "../../seed/underwriting/framework-pack-v1";
import { withEmptyCurrentNamedLensArtifacts } from
  "../helpers/current-named-lens-finalization";

const migrationPath = fileURLToPath(
  new URL("../../drizzle/0011_underwriting_runs.sql", import.meta.url),
);
const groundingMigrationPath = fileURLToPath(
  new URL(
    "../../drizzle/0012_source_grounded_underwriting.sql",
    import.meta.url,
  ),
);
const schemaPath = fileURLToPath(
  new URL("../../db/schema.ts", import.meta.url),
);
const migrations = [
  "0000_vsee_postgres.sql",
  "0001_remove_report_delivery.sql",
  "0002_durable_decision_lineage.sql",
  "0003_sanitize_report_next_steps.sql",
  "0004_company_analyses.sql",
  "0005_sample_decision_label.sql",
  "0006_reasoner_judgments.sql",
  "0007_uploaded_documents.sql",
  "0008_workspace_composite_identity.sql",
  "0009_source_revision_deal_registry.sql",
  "0010_underwriting_references.sql",
  "0011_underwriting_runs.sql",
  "0012_source_grounded_underwriting.sql",
].map((filename) =>
  fileURLToPath(new URL(`../../drizzle/${filename}`, import.meta.url))
);
const postgresSafety = requireLoopbackPostgres();
const postgresAvailable = postgresSafety.state === "verified" ? postgresSafety.run(
  "psql",
  [
    "-d",
    "postgres",
    "-Atqc",
    "select (rolsuper or rolcreatedb)::text from pg_roles where rolname = current_user",
  ],
) : { status: null, stdout: "" };
const canCreateTemporaryDatabase =
  postgresSafety.state === "verified"
  && postgresAvailable.status === 0
  && postgresAvailable.stdout.trim() === "true"
  && postgresSafety.run("createdb", ["--version"]).status === 0
  && postgresSafety.run("dropdb", ["--version"]).status === 0;
const requirePostgres = postgresSafety.state === "verified";

function postgresExec(
  command: "psql" | "createdb" | "dropdb",
  args: readonly string[],
  options: { input?: string; encoding?: "utf8"; stdio?: unknown } = {},
): string {
  assert.equal(postgresSafety.state, "verified");
  if (postgresSafety.state !== "verified") throw new Error("unreachable");
  return postgresSafety.exec(command, args, {
    ...(options.input === undefined ? {} : { input: options.input }),
  });
}

function deterministicOptions() {
  let sequence = 0;
  return {
    now: () => new Date("2026-07-29T12:00:00.000Z"),
    idGenerator: (kind: "batch" | "candidate") =>
      `${kind}_${++sequence}`,
    leaseTokenGenerator: () => `lease_${++sequence}`,
  };
}

async function twoClaimedCandidates(options: {
  evidencePacks?: EvidencePacksRepository;
} = {}) {
  const artifacts = createMemoryUnderwritingArtifactsRepository();
  const evidencePacks = options.evidencePacks
    ?? createMemoryEvidencePacksRepository();
  const runs = createMemoryUnderwritingRunsRepository({
    ...deterministicOptions(),
    artifacts,
    evidencePacks,
  } as Parameters<typeof createMemoryUnderwritingRunsRepository>[0]);
  const batch = await runs.createOrReuseBatch({
    workspaceId: "workspace_1",
    scanRunId: "scan_1",
    batchInputFingerprint: `sha256:${"1".repeat(64)}`,
    fundPolicySnapshotId: "fund_policy_1",
    forceRefresh: false,
    refreshNonce: null,
    rerunOfId: null,
  });
  await runs.saveSelections({
    batchId: batch.id,
    selections: [
      {
        dealId: "deal_1",
        status: "selected",
        rank: 1,
        reason: "First",
      },
      {
        dealId: "deal_2",
        status: "selected",
        rank: 2,
        reason: "Second",
      },
    ],
  });
  await runs.createSelectedCandidates({
    batchId: batch.id,
    dealIds: ["deal_1", "deal_2"],
  });
  const first = await runs.claimNextCandidate({
    workerId: "worker_1",
    leaseSeconds: 60,
  });
  assert.ok(first);
  return { artifacts, evidencePacks, runs, batch, first };
}

const BUILD_INPUT_FINGERPRINT = `sha256:${"e".repeat(64)}`;

function guardedFinalization(input: {
  candidateRunId: string;
  dealId: string;
  workerId: string;
  leaseToken: string;
}): CandidateFinalization & {
  evidencePackBuildInputFingerprint: string;
} {
  return {
    ...finalization(input),
    evidencePackBuildInputFingerprint: BUILD_INPUT_FINGERPRINT,
  };
}

async function saveFinalizationBuild(
  evidencePacks: EvidencePacksRepository,
  payload: CandidateFinalization,
): Promise<void> {
  const revisionId = payload.evidencePack.sourceRevisionIds[0]!;
  await evidencePacks.saveExact({
    pack: payload.evidencePack,
    inputFingerprint: payload.evidencePackBuildInputFingerprint,
    sourceRevisionSnapshots: [{
      id: revisionId,
      workspaceId: payload.evidencePack.workspaceId,
      sourceId: `source_${payload.evidencePack.dealId}`,
      revision: 1,
      contentHash: `sha256:${"d".repeat(64)}`,
      objectKey: `private/${payload.evidencePack.dealId}.md`,
      objectVersion: "object:v1",
      contentType: "text/markdown",
      extractorId: "plain_text_v1",
      extractorVersion: "1",
      extractedAt: "2026-07-29T10:00:00.000Z",
      supersedesRevisionId: null,
      createdAt: "2026-07-29T10:05:00.000Z",
    }],
  });
}

function finalization(input: {
  candidateRunId: string;
  dealId: string;
  workerId: string;
  leaseToken: string;
  fundPolicyId?: string;
}): CandidateFinalization {
  const actions = actionsForDealStatusAndDirection("invested", "negative");
  const judgments = canonicalFrameworkAbstentions({
    prefix: input.dealId,
    factIds: [],
    assumptionIds: [],
    calculations: [],
  });
  const scenarioInputs = (scenario: "bear" | "base" | "bull") =>
    ScenarioInputFieldSchema.options.map((field) => ({
      id: `${scenario}_${field}`,
      scenario,
      field,
      value: null,
      unit: null,
      evidenceItemId: null,
      assumptionItemId: null,
      unavailableReason: `${field} is not available.`,
    }));
  return withEmptyCurrentNamedLensArtifacts({
    workerId: input.workerId,
    leaseToken: input.leaseToken,
    candidateRunId: input.candidateRunId,
    candidateAnalysisFingerprint: `sha256:${"a".repeat(64)}`,
    evidencePackBuildInputFingerprint: BUILD_INPUT_FINGERPRINT,
    evidencePack: {
      id: `evidence_pack_${input.dealId}`,
      version: 1,
      workspaceId: "workspace_1",
      dealId: input.dealId,
      asOfDate: "2026-07-29",
      sourceRevisionIds: ["revision_1"],
      facts: [],
      assumptions: [],
      conflicts: [],
      coverage: {
        minimumModelInputsComplete: false,
        criticalEvidenceComplete: false,
        missingFieldIds: ["arr"],
        blockingConflictIds: [],
        decisionCeiling: "Advance",
        underwritingStatus: "available",
        reasonCodes: ["ARR_NOT_REPORTED"],
      },
      createdAt: "2026-07-29T12:00:00.000Z",
    },
    context: {
      id: "context_1",
      contextVersion: "1",
      analysisMode: "full",
      stage: "seed",
      businessModel: "b2b_saas",
      geography: "us",
      securityType: "preferred",
      asOfDate: "2026-07-29",
      criticalEvidenceProfileId: "critical_1",
      benchmarkPackId: "benchmark_1",
      benchmarkCompatibility: "exact",
      valuationMethodPolicyId: "valuation_policy_1",
      decisionPolicyId: "decision_policy_1",
      frameworkPackId: SYNTHETIC_FRAMEWORK_PACK.id,
    },
    scenarioModel: {
      id: `scenario_model_${input.dealId}`,
      candidateRunId: input.candidateRunId,
      formulaPolicyVersion: "valuation_policy_1",
      scenarios: (["bear", "base", "bull"] as const).map((name) => ({
        name,
        inputs: scenarioInputs(name),
      })),
      probabilityWeighted: false,
    },
    calculations: [],
    calculationClaimEdges: [],
    judgments,
    disagreements: [],
    valuation: {
      id: `valuation_${input.dealId}`,
      status: "unavailable",
      scenarios: (["bear", "base", "bull"] as const).map((name) => ({
        name,
        valuation: null,
        calculationIds: [],
      })),
      currentAsk: null,
      maximumAcceptablePreMoney: null,
      initialOwnership: null,
      postDilutionOwnership: null,
      grossMoic: null,
      grossIrr: null,
      pricingPremium: null,
      calculationIds: [],
      blockerCodes: ["ARR_NOT_REPORTED"],
    },
    decision: {
      id: `decision_${input.dealId}`,
      analysisType: "final_synthesis",
      companyQuality: "unavailable",
      priceAttractiveness: "unavailable",
      fundFit: "unavailable",
      decision: null,
      decisionCeiling: null,
      hardVeto: false,
      firedRules: [],
      blockingEvidenceItemIds: [],
      claimEdges: [],
      confidence: "low",
    },
    narrative: "The company needs more evidence before an investment decision.",
    actionDrafts: [{
      schemaVersion: "action-draft-v2",
      safety: "status_safe",
      deliveryMode: "draft_only",
      draftPolicyVersion: ACTION_DRAFT_POLICY_VERSION,
      actionPolicyVersion: BELIEF_ACTION_POLICY_VERSION,
      id: `draft_${input.dealId}`,
      workspaceId: "workspace_1",
      candidateRunId: input.candidateRunId,
      dealStatus: "invested",
      beliefDirection: "negative",
      actions,
      missingEvidence: [{
        fieldId: "arr",
        label: "arr",
        externalLabel: "arr",
        reasonCode: "MISSING_CRITICAL_EVIDENCE",
        mostLikelyDecisionImpact:
          "Providing accepted evidence may raise or lower the formal decision ceiling.",
      }],
      format: "internal_memo",
      channel: "internal",
      audienceType: "internal",
      body: "INTERNAL UNDERWRITING ACTION MEMO — DRAFT ONLY\nPlease review missing ARR evidence.",
      createdAt: "2026-07-29T12:00:00.000Z",
      updatedAt: "2026-07-29T12:00:00.000Z",
    }],
    versionSnapshot: {
      fundPolicyId: input.fundPolicyId ?? "fund_policy_1",
      dealStatus: "invested",
      beliefDirection: "negative",
      canonicalActions: actions,
      actionPolicyVersion: BELIEF_ACTION_POLICY_VERSION,
      draftPolicyVersion: ACTION_DRAFT_POLICY_VERSION,
      semanticContextAssumptionPolicyVersion:
        "belief-reversal-demo-context-v1",
      semanticContextMappingVersion:
        "belief-reversal-reviewed-context-mapping-v1",
      analysisMode: "full",
      contextVersion: "1",
      geography: "us",
      benchmarkCompatibility: "exact",
      benchmarkPackId: "benchmark_1",
      benchmarkEntryId: "benchmark_entry_1",
      benchmarkDefinitionFingerprint: `sha256:${"1".repeat(64)}`,
      frameworkPackId: SYNTHETIC_FRAMEWORK_PACK.id,
      frameworkPackDefinitionFingerprint: `sha256:${"2".repeat(64)}`,
      routerVersion: CONTEXT_ROUTER_VERSION,
      criticalEvidenceProfileId: "critical_1",
      criticalEvidenceProfileDefinitionFingerprint:
        `sha256:${"3".repeat(64)}`,
      valuationMethodPolicyId: "valuation_policy_1",
      valuationMethodPolicyDefinitionFingerprint:
        `sha256:${"4".repeat(64)}`,
      decisionPolicyId: "decision_policy_1",
      decisionPolicyDefinitionFingerprint: `sha256:${"5".repeat(64)}`,
      referenceCatalogFingerprint: `sha256:${"6".repeat(64)}`,
      formulaVersions: [],
      providerModel: "claude-sonnet-4-5",
      promptVersion: "underwriting-prompt-v1",
      schemaVersion: "underwriting-schema-v1",
      settingsFingerprint: `sha256:${"b".repeat(64)}`,
      applicationCommit: "0002f6b",
      companyAnalysisUnknowns: [],
    },
  });
}

function canonicalFrameworkAbstentions(input: {
  prefix: string;
  factIds: string[];
  assumptionIds: string[];
  calculations: CandidateFinalization["calculations"];
}): FrameworkJudgment[] {
  const valuationFrameworkId = SYNTHETIC_FRAMEWORK_PACK.cards.find(
    ({ title }) => title === "Valuation & Fund Return",
  )!.id;
  return SYNTHETIC_FRAMEWORK_PACK.cards.map((card, index) => {
    const id = `judgment_${input.prefix}_${index + 1}`;
    return {
      id,
      analysisType: "framework_judgment",
      frameworkCardId: card.id,
      frameworkVersion: card.version,
      applicability: "unavailable",
      conclusion: "abstain",
      supportEvidenceItemIds: [],
      counterEvidenceItemIds: [],
      unusedEvidenceItemIds: [
        ...input.factIds,
        ...input.assumptionIds,
        ...(card.id === valuationFrameworkId
          ? input.calculations.map(({ id: calculationId }) => calculationId)
          : []),
      ].sort(),
      strongestSupport: null,
      strongestCounterargument: null,
      unknowns: ["Minimum evidence is unavailable."],
      limitations: ["The framework must abstain."],
      confidence: {
        sourceReliability: "low",
        evidenceStrength: "low",
        evidenceCoverage: "low",
        applicability: "low",
        judgment: "low",
      },
      claimEdges: [{
        claimItemId: id,
        dependencyItemId: card.id,
        dependencyType: "framework_ref",
      }],
      fingerprint: `unavailable-${input.prefix}-${index + 1}`,
    };
  });
}

function valuationEvidencePack(): EvidencePack {
  const fact = (
    id: string,
    field: string,
    value: string,
    unit: string | null,
    currency: string | null,
  ): EvidencePack["facts"][number] => ({
    id,
    analysisType: "fact",
    provenanceOrigin: "management",
    field,
    value,
    unit,
    currency,
    periodStart: null,
    periodEnd: null,
    publishedAt: null,
    eventAt: null,
    retrievedAt: "2026-07-29T10:00:00.000Z",
    sourceRevisionId: "revision_1",
    locator: {
      kind: "text_range",
      start: 0,
      end: 10,
      excerpt: `${field}: ${value}`,
    },
    sourceRole: "management",
    assertionStatus: "reported",
    verificationMethod: null,
    freshness: "current",
    acceptedForGate: true,
  });
  const assumption = (
    id: string,
    scenario: "bear" | "base" | "bull" | "all",
    field: string,
    value: string,
  ): EvidencePack["assumptions"][number] => ({
    id,
    analysisType: "assumption",
    provenanceOrigin: field.startsWith("compatible_benchmark_")
      ? "benchmark"
      : "recommended_policy",
    scenario,
    field,
    value,
    unit: field === "compatible_benchmark_value" || field === "arr_path"
      ? "USD"
      : field === "compatible_benchmark_stale_after"
        ? "date"
        : field === "scenario_price_multiplier"
          ? "decimal"
          : null,
    rationale: `Explicit ${field} input`,
    inputRefIds: field.startsWith("compatible_benchmark_")
      ? ["benchmark_pack_synthetic_us_software_v1"]
      : [],
    sensitivity: "medium",
    requiresConfirmation: false,
  });
  return {
    id: "pack_1",
    version: 1,
    workspaceId: "workspace_1",
    dealId: "deal_1",
    asOfDate: "2026-07-29",
    sourceRevisionIds: ["revision_1"],
    facts: [
      fact(
        "fact_current_ask",
        "reported_valuation",
        "18000000",
        "currency",
        "USD",
      ),
      fact(
        "fact_valuation_basis",
        "reported_valuation_basis",
        "pre_money",
        null,
        null,
      ),
    ],
    assumptions: [
      assumption(
        "benchmark_seed",
        "all",
        "compatible_benchmark_value",
        "20000000",
      ),
      assumption(
        "benchmark_stale_after",
        "all",
        "compatible_benchmark_stale_after",
        "2026-12-31",
      ),
      assumption(
        "multiplier_bear",
        "bear",
        "scenario_price_multiplier",
        "0.75",
      ),
      assumption(
        "multiplier_base",
        "base",
        "scenario_price_multiplier",
        "1",
      ),
      assumption(
        "multiplier_bull",
        "bull",
        "scenario_price_multiplier",
        "1.25",
      ),
      assumption("exit_arr_base", "base", "arr_path", "20000000"),
      assumption("exit_multiple_base", "base", "exit_multiple", "5"),
    ],
    conflicts: [],
    coverage: {
      minimumModelInputsComplete: true,
      criticalEvidenceComplete: false,
      missingFieldIds: [],
      blockingConflictIds: [],
      decisionCeiling: "Advance",
      underwritingStatus: "available",
      reasonCodes: [],
    },
    createdAt: "2026-07-29T10:05:00.000Z",
  };
}

function valuationContext(): ResolvedUnderwritingContext {
  return {
    id: "context_seed_saas_us",
    contextVersion: "1",
    analysisMode: "full",
    stage: "seed",
    businessModel: "b2b_saas",
    geography: "us",
    securityType: "preferred",
    asOfDate: "2026-07-29",
    criticalEvidenceProfileId: "critical_evidence_seed_b2b_saas_v1",
    benchmarkPackId: "benchmark_pack_synthetic_us_software_v1",
    benchmarkCompatibility: "exact",
    valuationMethodPolicyId: "valuation_method_seed_b2b_saas_v1",
    decisionPolicyId: "decision_policy_seed_b2b_saas_v1",
    frameworkPackId: "framework_pack_synthetic_universal_saas_ai_v1",
  };
}

function valuationFundPolicy(): FundPolicySnapshot {
  return {
    id: "fund_policy:workspace_1:v1",
    workspaceId: "workspace_1",
    version: 1,
    source: "recommended_policy",
    values: {
      baseCurrency: "USD",
      initialCheckMax: "8000000",
      acceptableFutureDilution: "0.50",
      scenarioPriceMultipliers: {
        bear: "0.75",
        base: "1",
        bull: "1.25",
      },
      returnTargets: {
        seed: {
          grossMoic: "5",
          grossIrr: "0.2228445449938519",
          horizonYears: "8",
        },
      },
      probabilityWeighted: false,
    },
    createdByUserId: null,
    createdAt: "2026-07-29T09:00:00.000Z",
  };
}

function realValuationFinalization(input: {
  workerId: string;
  leaseToken: string;
}): CandidateFinalization {
  const pack = valuationEvidencePack();
  const context = valuationContext();
  const policy = valuationFundPolicy();
  const detailed = createValuationEngine({
    now: () => new Date("2026-07-29T12:00:00.000Z"),
  }).evaluateDetailed({ pack, context, fundPolicy: policy });
  const base = finalization({
    candidateRunId: detailed.scenarioModel.candidateRunId,
    dealId: pack.dealId,
    workerId: input.workerId,
    leaseToken: input.leaseToken,
    fundPolicyId: policy.id,
  });
  const actionDrafts = structuredClone(base.actionDrafts);
  if ("missingEvidence" in actionDrafts[0]!) {
    actionDrafts[0].missingEvidence = [];
  }
  return {
    ...base,
    evidencePack: pack,
    context,
    scenarioModel: detailed.scenarioModel,
    calculations: detailed.calculations,
    calculationClaimEdges: detailed.calculationClaimEdges,
    judgments: canonicalFrameworkAbstentions({
      prefix: pack.dealId,
      factIds: pack.facts.map(({ id }) => id),
      assumptionIds: pack.assumptions.map(({ id }) => id),
      calculations: detailed.calculations,
    }),
    valuation: detailed.evaluation,
    actionDrafts,
    versionSnapshot: {
      ...base.versionSnapshot,
      fundPolicyId: policy.id,
      benchmarkPackId: context.benchmarkPackId,
      frameworkPackId: context.frameworkPackId,
      criticalEvidenceProfileId: context.criticalEvidenceProfileId,
      valuationMethodPolicyId: context.valuationMethodPolicyId,
      decisionPolicyId: context.decisionPolicyId,
      formulaVersions: [...new Set(detailed.calculations.map(
        ({ formulaId, formulaVersion }) => `${formulaId}@${formulaVersion}`,
      ))].sort(),
    },
  } as CandidateFinalization;
}

test("non-reuse finalization requires the exact immutable Evidence Pack build", async () => {
  const evidencePacks = createMemoryEvidencePacksRepository();
  const { artifacts, runs, first } = await twoClaimedCandidates({
    evidencePacks,
  });
  const payload = guardedFinalization({
    candidateRunId: first.candidate.id,
    dealId: first.candidate.dealId,
    workerId: "worker_1",
    leaseToken: first.leaseToken,
  });

  await assert.rejects(
    runs.finalizeCandidate(payload),
    /immutable Evidence Pack build/i,
  );
  assert.equal(artifacts.inspect().rowCounts.evidencePacks, 0);
  assert.equal(
    runs.inspect().candidates.find(({ id }) => id === first.candidate.id)
      ?.status,
    "running",
  );

  await saveFinalizationBuild(evidencePacks, payload);
  await assert.rejects(
    runs.finalizeCandidate({
      ...payload,
      evidencePackBuildInputFingerprint: `sha256:${"f".repeat(64)}`,
    }),
    /immutable Evidence Pack build/i,
  );
  await assert.rejects(
    runs.finalizeCandidate({
      ...payload,
      evidencePack: {
        ...payload.evidencePack,
        createdAt: "2026-07-29T12:00:01.000Z",
      },
    }),
    /immutable Evidence Pack build/i,
  );
  await assert.rejects(
    runs.finalizeCandidate({
      ...payload,
      evidencePack: {
        ...payload.evidencePack,
        id: "evidence_pack_wrong_key",
      },
    }),
    /immutable Evidence Pack build/i,
  );
  await assert.rejects(
    runs.finalizeCandidate({
      ...payload,
      evidencePack: {
        ...payload.evidencePack,
        workspaceId: "workspace_foreign",
      },
    }),
    /immutable Evidence Pack build/i,
  );
  await assert.rejects(
    runs.finalizeCandidate({
      ...payload,
      evidencePack: {
        ...payload.evidencePack,
        dealId: "deal_foreign",
      },
    }),
    /immutable Evidence Pack build/i,
  );

  const completed = await runs.finalizeCandidate(payload);
  assert.equal(completed.status, "completed");
  assert.equal(artifacts.inspect().rowCounts.evidencePacks, 1);
});

test("finalization preserves generic blockers while accepting typed company/event unknowns", async () => {
  const { artifacts, evidencePacks, runs, first } =
    await twoClaimedCandidates();
  const payload = guardedFinalization({
    candidateRunId: first.candidate.id,
    dealId: first.candidate.dealId,
    workerId: "worker_1",
    leaseToken: first.leaseToken,
  });
  const companySpecificUnknown = {
    fieldId: `semantic-field-${"a".repeat(24)}`,
    label:
      "Akamai and Kyndryl channel bookings, margins, and sell-through remain unavailable.",
    externalLabel: "Current partner bookings, margins, and sell-through",
    reasonCode: "UNRESOLVED_COMPANY_OR_EVENT_UNKNOWN",
    mostLikelyDecisionImpact:
      "Resolving this company- or event-specific unknown may raise or lower the formal decision ceiling.",
  };
  for (const draft of payload.actionDrafts) {
    if ("missingEvidence" in draft) {
      draft.missingEvidence.push(companySpecificUnknown);
    }
  }
  payload.versionSnapshot.companyAnalysisUnknowns = [{
    fieldId: companySpecificUnknown.fieldId,
    label: companySpecificUnknown.label,
    externalLabel: companySpecificUnknown.externalLabel,
  }];
  await saveFinalizationBuild(evidencePacks, payload);

  const forgedUnknown = structuredClone(payload);
  for (const draft of forgedUnknown.actionDrafts) {
    if ("missingEvidence" in draft) {
      const unknown = draft.missingEvidence.find(
        ({ reasonCode }) =>
          reasonCode === "UNRESOLVED_COMPANY_OR_EVENT_UNKNOWN",
      );
      assert.ok(unknown);
      unknown.fieldId = `semantic-field-${"b".repeat(24)}`;
    }
  }
  await assert.rejects(
    runs.finalizeCandidate(forgedUnknown),
    /status-safe action drafts/i,
  );

  const missingGeneric = structuredClone(payload);
  for (const draft of missingGeneric.actionDrafts) {
    if ("missingEvidence" in draft) {
      draft.missingEvidence = draft.missingEvidence.filter(
        ({ fieldId }) => fieldId !== "arr",
      );
    }
  }
  await assert.rejects(
    runs.finalizeCandidate(missingGeneric),
    /status-safe action drafts/i,
  );

  const completed = await runs.finalizeCandidate(payload);
  assert.equal(completed.status, "completed");
  const savedDraft = artifacts.inspect().bundles[0]?.actionDrafts[0];
  assert.ok(savedDraft && "missingEvidence" in savedDraft);
  assert.deepEqual(
    savedDraft.missingEvidence,
    [{
      fieldId: "arr",
      label: "arr",
      externalLabel: "arr",
      reasonCode: "MISSING_CRITICAL_EVIDENCE",
      mostLikelyDecisionImpact:
        "Providing accepted evidence may raise or lower the formal decision ceiling.",
    }, companySpecificUnknown],
  );
});

test("failed finalization leaves no partial artifacts and retains the active lease", async () => {
  const { artifacts, evidencePacks, runs, first } =
    await twoClaimedCandidates();
  const invalid = finalization({
    candidateRunId: first.candidate.id,
    dealId: first.candidate.dealId,
    workerId: "worker_1",
    leaseToken: first.leaseToken,
  });
  await saveFinalizationBuild(evidencePacks, invalid);
  invalid.actionDrafts[0].workspaceId = "workspace_foreign";

  await assert.rejects(runs.finalizeCandidate(invalid), /workspace|artifact/i);
  assert.deepEqual(artifacts.inspect().rowCounts, {
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
  });
  assert.equal(
    runs.inspect().candidates.find(({ id }) => id === first.candidate.id)
      ?.status,
    "running",
  );
});

test("finalization rejects claim edges whose typed dependency is not persisted", async () => {
  const { artifacts, evidencePacks, runs, first } =
    await twoClaimedCandidates();
  const invalid = finalization({
    candidateRunId: first.candidate.id,
    dealId: first.candidate.dealId,
    workerId: "worker_1",
    leaseToken: first.leaseToken,
  });
  await saveFinalizationBuild(evidencePacks, invalid);
  invalid.decision.claimEdges.push({
    claimItemId: invalid.decision.id,
    dependencyItemId: "foreign_fact",
    dependencyType: "fact",
  });

  await assert.rejects(
    runs.finalizeCandidate(invalid),
    /claim|dependency|resolve/i,
  );
  assert.equal(artifacts.inspect().rowCounts.claimEdges, 0);
  assert.equal(
    runs.inspect().candidates.find(({ id }) => id === first.candidate.id)
      ?.status,
    "running",
  );
});

test("one completed candidate and one failed candidate leave the batch partial", async () => {
  const { artifacts, evidencePacks, runs, batch, first } =
    await twoClaimedCandidates();
  const payload = finalization({
    candidateRunId: first.candidate.id,
    dealId: first.candidate.dealId,
    workerId: "worker_1",
    leaseToken: first.leaseToken,
  });
  await saveFinalizationBuild(evidencePacks, payload);
  const completed = await runs.finalizeCandidate(payload);
  const second = await runs.claimNextCandidate({
    workerId: "worker_2",
    leaseSeconds: 60,
  });
  assert.ok(second);
  await runs.markCandidateFailed({
    candidateRunId: second.candidate.id,
    publicReason: "The provider returned an unusable response.",
  });

  assert.equal(completed.status, "completed");
  let llmCalls = 0;
  let formulaCalls = 0;
  const reusable = await artifacts.findReusable({
    workspaceId: "workspace_1",
    candidateAnalysisFingerprint: completed.candidateAnalysisFingerprint,
  });
  if (!reusable) {
    llmCalls += 1;
    formulaCalls += 1;
  }
  assert.equal(reusable?.candidateRunId, completed.id);
  assert.deepEqual({ llmCalls, formulaCalls }, { llmCalls: 0, formulaCalls: 0 });
  assert.equal(
    await artifacts.findReusable({
      workspaceId: "workspace_foreign",
      candidateAnalysisFingerprint: completed.candidateAnalysisFingerprint,
    }),
    null,
  );
  assert.equal(
    runs.inspect().batches.find(({ id }) => id === batch.id)?.status,
    "partial",
  );
  assert.equal(artifacts.inspect().rowCounts.evidencePacks, 1);
  assert.equal(artifacts.inspect().rowCounts.actionDrafts, 1);
});

test("finalization rejects a foreign lease and stores exact immutable snapshots once", async () => {
  const { artifacts, evidencePacks, runs, first } =
    await twoClaimedCandidates();
  const payload = finalization({
    candidateRunId: first.candidate.id,
    dealId: first.candidate.dealId,
    workerId: "worker_1",
    leaseToken: first.leaseToken,
  });
  await saveFinalizationBuild(evidencePacks, payload);
  await assert.rejects(
    runs.finalizeCandidate({ ...payload, leaseToken: "foreign" }),
    /lease/i,
  );
  await runs.finalizeCandidate(payload);
  const stored = await artifacts.getByCandidateRunId({
    workspaceId: "workspace_1",
    candidateRunId: first.candidate.id,
  });

  assert.ok(stored);
  assert.deepEqual(stored.evidencePack, payload.evidencePack);
  assert.deepEqual(stored.context, payload.context);
  assert.deepEqual(stored.scenarioModel, payload.scenarioModel);
  assert.deepEqual(stored.valuation, payload.valuation);
  assert.deepEqual(stored.decision, payload.decision);
  assert.deepEqual(stored.versionSnapshot, payload.versionSnapshot);
  await assert.rejects(runs.finalizeCandidate(payload), /completed|lease/i);
  assert.equal(artifacts.inspect().rowCounts.evidencePacks, 1);
});

test("finalization preserves canonical framework abstentions without requiring formal decision edges", async () => {
  const { artifacts, evidencePacks, runs, first } =
    await twoClaimedCandidates();
  const payload = finalization({
    candidateRunId: first.candidate.id,
    dealId: first.candidate.dealId,
    workerId: "worker_1",
    leaseToken: first.leaseToken,
  });
  payload.judgments[3] = {
    ...payload.judgments[3]!,
    applicability: "not_applicable",
  };
  payload.narrative = [
    payload.narrative,
    "framework_card_synthetic_4_v1: not_applicable",
    "framework_card_synthetic_5_v1: unavailable",
  ].join("\n");

  await saveFinalizationBuild(evidencePacks, payload);
  await runs.finalizeCandidate(payload);
  const stored = await artifacts.getByCandidateRunId({
    workspaceId: "workspace_1",
    candidateRunId: first.candidate.id,
  });

  assert.ok(stored);
  assert.deepEqual(stored.judgments, payload.judgments);
  assert.equal(stored.narrative, payload.narrative);
  assert.equal(
    stored.decision.claimEdges.some(({ dependencyItemId }) =>
      payload.judgments.some(({ id }) => id === dependencyItemId)
    ),
    false,
  );
  assert.equal(artifacts.inspect().rowCounts.judgments, 8);
});

test("finalization persists the real valuation artifact graph without losing Task10 references", async () => {
  const artifacts = createMemoryUnderwritingArtifactsRepository();
  const evidencePacks = createMemoryEvidencePacksRepository();
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => new Date("2026-07-29T12:00:00.000Z"),
    idGenerator: (kind) =>
      kind === "batch" ? "batch_real" : "valuation:pack_1",
    leaseTokenGenerator: () => "lease_real",
    artifacts,
    evidencePacks,
  });
  const batch = await runs.createOrReuseBatch({
    workspaceId: "workspace_1",
    scanRunId: "scan_1",
    batchInputFingerprint: `sha256:${"c".repeat(64)}`,
    fundPolicySnapshotId: valuationFundPolicy().id,
    fundPolicyValues: valuationFundPolicy().values,
    forceRefresh: false,
    refreshNonce: null,
    rerunOfId: null,
  });
  await runs.saveSelections({
    batchId: batch.id,
    selections: [{
      dealId: "deal_1",
      status: "selected",
      rank: 1,
      reason: "Real valuation artifact fixture",
    }],
  });
  await runs.createSelectedCandidates({
    batchId: batch.id,
    dealIds: ["deal_1"],
  });
  const claimed = await runs.claimNextCandidate({
    workerId: "worker_real",
    leaseSeconds: 60,
  });
  assert.ok(claimed);
  const payload = realValuationFinalization({
    workerId: "worker_real",
    leaseToken: claimed.leaseToken,
  });

  await saveFinalizationBuild(evidencePacks, payload);
  const forged = structuredClone(payload);
  const forgedCalculation = forged.calculations.find(({ id }) =>
    id.endsWith(":bear_valuation")
  );
  const forgedScenario = forged.valuation.scenarios.find(
    ({ name }) => name === "bear",
  );
  assert.ok(forgedCalculation);
  assert.ok(forgedScenario);
  forgedCalculation.output = "999999999";
  forgedScenario.valuation = forgedCalculation.output;
  await assert.rejects(
    runs.finalizeCandidate(forged),
    /authorized deterministic formula graph/i,
  );
  const forgedInputValue = structuredClone(payload);
  const forgedInputCalculation = forgedInputValue.calculations.find(({ id }) =>
    id.endsWith(":bear_valuation")
  );
  const forgedInputScenario = forgedInputValue.valuation.scenarios.find(
    ({ name }) => name === "bear",
  );
  assert.ok(forgedInputCalculation);
  assert.ok(forgedInputScenario);
  forgedInputCalculation.inputRefs.at(-1)!.value = "50";
  forgedInputCalculation.output = "1000000000";
  forgedInputScenario.valuation = forgedInputCalculation.output;
  await assert.rejects(
    runs.finalizeCandidate(forgedInputValue),
    /authorized deterministic formula graph/i,
  );

  const substitutedInput = structuredClone(payload);
  const substitutedBear = substitutedInput.calculations.find(({ id }) =>
    id.endsWith(":bear_valuation")
  );
  const substitutedBull = substitutedInput.calculations.find(({ id }) =>
    id.endsWith(":bull_valuation")
  );
  const substitutedScenario = substitutedInput.valuation.scenarios.find(
    ({ name }) => name === "bear",
  );
  assert.ok(substitutedBear);
  assert.ok(substitutedBull);
  assert.ok(substitutedScenario);
  substitutedBear.inputRefs[substitutedBear.inputRefs.length - 1] =
    structuredClone(substitutedBull.inputRefs.at(-1)!);
  substitutedBear.output = substitutedBull.output;
  substitutedScenario.valuation = substitutedBear.output;
  await assert.rejects(
    runs.finalizeCandidate(substitutedInput),
    /authorized deterministic formula graph/i,
  );
  assert.equal(
    runs.inspect().candidates.find(({ id }) => id === claimed.candidate.id)
      ?.status,
    "running",
  );

  await runs.finalizeCandidate(payload);
  const stored = await artifacts.getByCandidateRunId({
    workspaceId: "workspace_1",
    candidateRunId: claimed.candidate.id,
  });
  assert.ok(stored);
  assert.deepEqual(
    stored.calculationClaimEdges,
    payload.calculationClaimEdges,
  );
  assert.ok(stored.calculationClaimEdges.some(
    ({ claimItemId, dependencyItemId }) =>
      claimItemId.endsWith(":gross_moic")
      && dependencyItemId.endsWith(":exit_proceeds"),
  ));
  assert.ok(stored.calculationClaimEdges.some(
    ({ claimItemId, dependencyItemId }) =>
      claimItemId.endsWith(":gross_irr")
      && dependencyItemId.endsWith(":gross_moic"),
  ));
});

test("0011 declares an atomic finalization RPC without calling legacy report persistence", () => {
  const migration = readFileSync(migrationPath, "utf8");
  assert.match(
    migration,
    /create or replace function public\.finalize_candidate_underwriting\(jsonb\)/i,
  );
  assert.match(migration, /underwriting_batches/i);
  assert.match(migration, /candidate_runs/i);
  assert.match(migration, /candidate_version_snapshots/i);
  assert.match(migration, /underwriting_claim_edges/i);
  assert.doesNotMatch(migration, /save_intelligence_report/i);
});

test("0012 declares target claims, immutable rerun aliases, and grounded evidence persistence", () => {
  const migration = readFileSync(groundingMigrationPath, "utf8");
  const schema = readFileSync(schemaPath, "utf8");
  assert.match(
    migration,
    /create or replace function public\.claim_underwriting_candidate\(/i,
  );
  assert.match(migration, /artifact_source_candidate_run_id/i);
  assert.match(
    migration,
    /create or replace function public\.finalize_or_reuse_candidate_underwriting\(/i,
  );
  assert.match(migration, /create table if not exists public\.source_evidence_items/i);
  assert.match(migration, /create table if not exists public\.evidence_pack_builds/i);
  assert.match(
    migration,
    /create trigger critical_evidence_profile_fields_immutable[\s\S]*reject_immutable_underwriting_reference/i,
  );
  assert.match(migration, /create or replace function public\.save_source_evidence_items/i);
  assert.match(migration, /create or replace function public\.save_evidence_pack_build/i);
  assert.match(
    migration,
    /Evidence Pack source snapshot differs from its immutable revision/i,
  );
  assert.match(
    migration,
    /Evidence Pack revision IDs and snapshots must be duplicate-free exact sets/i,
  );
  assert.match(
    migration,
    /build\.workspace_id = target\.workspace_id[\s\S]*build\.input_fingerprint = build_input_fingerprint[\s\S]*build\.pack_id = evidence_pack ->> 'id'[\s\S]*build\.pack_payload = evidence_pack/i,
  );
  assert.match(
    migration,
    /nullif\(btrim\(evidence_pack ->> 'dealId'\), ''\)\s+is distinct from target\.deal_id/i,
  );
  assert.match(
    migration,
    /coalesce\(v_deal_id, ''\) = ''/i,
  );
  assert.match(
    readFileSync(migrationPath, "utf8"),
    /nullif\(btrim\(evidence_pack ->> 'dealId'\), ''\)\s+is distinct from target\.deal_id/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.finalize_candidate_underwriting\(jsonb\)[\s\S]*from service_role/i,
  );
  assert.match(
    migration,
    /insert into public\.source_evidence_items[\s\S]*on conflict \(workspace_id, evidence_id\) do nothing[\s\S]*for key share/i,
  );
  assert.match(
    migration,
    /insert into public\.evidence_pack_builds[\s\S]*on conflict do nothing[\s\S]*for key share/i,
  );
  assert.match(schema, /source_evidence_items_payload_shape_check/i);
  assert.match(schema, /source_evidence_items_payload_identity_check/i);
  assert.match(schema, /evidence_pack_builds_input_fingerprint_check/i);
  assert.match(schema, /evidence_pack_builds_payload_shape_check/i);
  assert.match(schema, /evidence_pack_builds_snapshots_shape_check/i);
  assert.match(schema, /evidence_pack_builds_payload_identity_check/i);
  assert.match(
    schema,
    /btrim\(coalesce\([\s\S]*packPayload[\s\S]*->> 'dealId'[\s\S]*''\)\) <> ''/i,
  );
  assert.match(
    schema,
    /critical_evidence_profile_fields_assertion_statuses_shape_check/i,
  );
  assert.match(
    schema,
    /critical_evidence_profile_fields_freshness_shape_check/i,
  );
  for (
    const constraint of [
      "source_evidence_items_payload_shape_check",
      "source_evidence_items_payload_identity_check",
      "evidence_pack_builds_input_fingerprint_check",
      "evidence_pack_builds_payload_shape_check",
      "evidence_pack_builds_snapshots_shape_check",
      "evidence_pack_builds_payload_identity_check",
      "critical_evidence_profile_fields_assertion_statuses_shape_check",
      "critical_evidence_profile_fields_freshness_shape_check",
    ]
  ) {
    assert.match(
      migration,
      new RegExp(
        `drop constraint if exists\\s+${constraint}[\\s\\S]*`
          + `add constraint\\s+${constraint}`,
        "i",
      ),
    );
  }
});

test(
  "0012 guarded finalization rejects every unbound pack and denies the legacy runtime RPC",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    withTemporaryDatabase((database) => {
      setupSqlUnderwritingWorkspace(database);
      executeSql(database, `
        insert into public.underwriting_batches (
          id, workspace_id, scan_run_id, status,
          batch_input_fingerprint, fund_policy_snapshot_id,
          force_refresh, refresh_nonce, rerun_of_id
        ) values (
          'batch_guarded',
          'workspace_1',
          '00000000-0000-4000-8000-000000000801',
          'running',
          'sha256:${"9".repeat(64)}',
          'fund_policy:workspace_1:v1',
          false,
          null,
          null
        );
        insert into public.candidate_runs (
          id, batch_id, workspace_id, deal_id, status,
          candidate_analysis_fingerprint, worker_id, lease_token,
          lease_expires_at
        ) values (
          'candidate_guarded',
          'batch_guarded',
          'workspace_1',
          'deal_1',
          'running',
          'pending:candidate_guarded',
          'worker_guarded',
          'lease_guarded',
          now() + interval '5 minutes'
        );
      `);
      const payload = finalization({
        candidateRunId: "candidate_guarded",
        dealId: "deal_1",
        workerId: "worker_guarded",
        leaseToken: "lease_guarded",
        fundPolicyId: "fund_policy:workspace_1:v1",
      });

      assert.throws(
        () => executeSql(database, `
          set role service_role;
          select public.finalize_candidate_underwriting(
            ${sqlJson(payload)}
          );
        `),
        /permission denied for function finalize_candidate_underwriting/i,
      );
      assert.throws(
        () => executeSql(database, `
          set role service_role;
          select public.finalize_or_reuse_candidate_underwriting(
            ${sqlJson(payload)}
          );
        `),
        /immutable Evidence Pack build/i,
      );

      seedSqlSourceRevision(database);
      const missingDealPack = structuredClone(
        payload.evidencePack,
      ) as Record<string, unknown>;
      delete missingDealPack.dealId;
      const nullDealPack = {
        ...payload.evidencePack,
        dealId: null,
      };
      const missingDealFingerprint = `sha256:${"1".repeat(64)}`;
      const nullDealFingerprint = `sha256:${"2".repeat(64)}`;
      for (
        const invalidBuild of [
          {
            ...sqlFinalizationBuildPayload(payload),
            pack: missingDealPack,
            inputFingerprint: missingDealFingerprint,
          },
          {
            ...sqlFinalizationBuildPayload(payload),
            pack: nullDealPack,
            inputFingerprint: nullDealFingerprint,
          },
        ]
      ) {
        assert.throws(
          () => executeSql(database, `
            set role service_role;
            select public.save_evidence_pack_build(
              ${sqlJson(invalidBuild)}
            );
          `),
          /immutable Evidence Pack build/i,
        );
      }

      saveSqlFinalizationBuild(database, payload);
      executeSql(database, `
        alter table public.evidence_pack_builds
          drop constraint evidence_pack_builds_payload_identity_check;
        insert into public.evidence_pack_builds (
          workspace_id, input_fingerprint, pack_id, pack_payload,
          source_revision_snapshots
        ) values
        (
          'workspace_1',
          '${missingDealFingerprint}',
          'evidence_pack_missing_deal',
          ${sqlJson({
            ...missingDealPack,
            id: "evidence_pack_missing_deal",
          })},
          '[]'::jsonb
        ),
        (
          'workspace_1',
          '${nullDealFingerprint}',
          'evidence_pack_null_deal',
          ${sqlJson({
            ...nullDealPack,
            id: "evidence_pack_null_deal",
          })},
          '[]'::jsonb
        );
      `);
      const missingDealFinalization = {
        ...payload,
        evidencePackBuildInputFingerprint: missingDealFingerprint,
        evidencePack: {
          ...missingDealPack,
          id: "evidence_pack_missing_deal",
        },
      };
      const nullDealFinalization = {
        ...payload,
        evidencePackBuildInputFingerprint: nullDealFingerprint,
        evidencePack: {
          ...nullDealPack,
          id: "evidence_pack_null_deal",
        },
      };
      for (
        const invalid of [
          missingDealFinalization,
          nullDealFinalization,
        ]
      ) {
        assert.throws(
          () => executeSql(database, `
            set role service_role;
            select public.finalize_or_reuse_candidate_underwriting(
              ${sqlJson(invalid)}
            );
          `),
          /immutable Evidence Pack build|artifact identity/i,
        );
        assert.throws(
          () => executeSql(database, `
            select public.finalize_candidate_underwriting(
              ${sqlJson(invalid)}
            );
          `),
          /artifact identity/i,
        );
      }
      for (
        const invalid of [
          {
            ...payload,
            evidencePackBuildInputFingerprint:
              `sha256:${"f".repeat(64)}`,
          },
          {
            ...payload,
            evidencePack: {
              ...payload.evidencePack,
              createdAt: "2026-07-29T12:00:01.000Z",
            },
          },
          {
            ...payload,
            evidencePack: {
              ...payload.evidencePack,
              id: "evidence_pack_wrong_key",
            },
          },
          {
            ...payload,
            evidencePack: {
              ...payload.evidencePack,
              workspaceId: "workspace_foreign",
            },
          },
          {
            ...payload,
            evidencePack: {
              ...payload.evidencePack,
              dealId: "deal_foreign",
            },
          },
        ]
      ) {
        assert.throws(
          () => executeSql(database, `
            set role service_role;
            select public.finalize_or_reuse_candidate_underwriting(
              ${sqlJson(invalid)}
            );
          `),
          /immutable Evidence Pack build/i,
        );
      }

      executeSql(database, `
        set role service_role;
        select public.finalize_or_reuse_candidate_underwriting(
          ${sqlJson(payload)}
        );
      `);
      assert.equal(
        executeSql(database, `
          select status || '|' || candidate_analysis_fingerprint
          from public.candidate_runs
          where id = 'candidate_guarded';
        `),
        `completed|sha256:${"a".repeat(64)}`,
      );
    });
  },
);

test(
  "0012 target claim leaves older work untouched and atomically aliases a linked identical rerun",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    withTemporaryDatabase((database) => {
      setupSqlUnderwritingWorkspace(database);
      executeSql(database, `
        insert into public.underwriting_batches (
          id, workspace_id, scan_run_id, status,
          batch_input_fingerprint, fund_policy_snapshot_id,
          force_refresh, refresh_nonce, rerun_of_id
        ) values
        (
          'batch_original',
          'workspace_1',
          '00000000-0000-4000-8000-000000000801',
          'running',
          'sha256:${"7".repeat(64)}',
          'fund_policy:workspace_1:v1',
          false,
          null,
          null
        ),
        (
          'batch_refresh',
          'workspace_1',
          '00000000-0000-4000-8000-000000000801',
          'running',
          'sha256:${"7".repeat(64)}',
          'fund_policy:workspace_1:v1',
          true,
          'refresh_1',
          'batch_original'
        );
        insert into public.candidate_runs (
          id, batch_id, workspace_id, deal_id, status,
          candidate_analysis_fingerprint, rerun_of_id
        ) values
        (
          'candidate_older',
          'batch_original',
          'workspace_1',
          'deal_1',
          'queued',
          'pending:candidate_older',
          null
        ),
        (
          'candidate_refresh',
          'batch_refresh',
          'workspace_1',
          'deal_1',
          'queued',
          'pending:candidate_refresh',
          'candidate_older'
        );
      `);
      const originalClaim = JSON.parse(executeSql(database, `
        set role service_role;
        select public.claim_underwriting_candidate(
          'workspace_1', 'candidate_older', 'worker_original', 60
        );
      `)) as { leaseToken: string };
      const originalPayload = finalization({
        candidateRunId: "candidate_older",
        dealId: "deal_1",
        workerId: "worker_original",
        leaseToken: originalClaim.leaseToken,
        fundPolicyId: "fund_policy:workspace_1:v1",
      });
      seedSqlSourceRevision(database);
      saveSqlFinalizationBuild(database, originalPayload);
      executeSql(database, `
        set role service_role;
        select public.finalize_or_reuse_candidate_underwriting(
          ${sqlJson(originalPayload)}
        );
      `);

      const refreshClaim = JSON.parse(executeSql(database, `
        set role service_role;
        select public.claim_underwriting_candidate(
          'workspace_1', 'candidate_refresh', 'worker_refresh', 60
        );
      `)) as { leaseToken: string };
      const refreshPayload = finalization({
        candidateRunId: "candidate_refresh",
        dealId: "deal_1",
        workerId: "worker_refresh",
        leaseToken: refreshClaim.leaseToken,
        fundPolicyId: "fund_policy:workspace_1:v1",
      });
      executeSql(database, `
        set role service_role;
        select public.finalize_or_reuse_candidate_underwriting(
          ${sqlJson(refreshPayload)}
        );
      `);

      assert.equal(
        executeSql(database, `
          select status || '|' || artifact_source_candidate_run_id
            || '|' || candidate_analysis_fingerprint
          from public.candidate_runs
          where id = 'candidate_refresh';
        `),
        `completed|candidate_older|sha256:${"a".repeat(64)}`,
      );
      assert.equal(
        executeSql(database, `
          select
            (select count(*) from public.evidence_packs)
            || '|' ||
            (select count(*) from public.candidate_version_snapshots)
            || '|' ||
            (select count(*) from public.evidence_pack_builds);
        `),
        "1|1|1",
      );
      assert.equal(
        executeSql(database, `
          set role service_role;
          select public.claim_underwriting_candidate(
            'workspace_foreign', 'candidate_refresh', 'worker_foreign', 60
          ) is null;
        `),
        "t",
      );
    });
  },
);

test(
  "0012 persists exact source evidence and Evidence Pack build snapshots idempotently",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    withTemporaryDatabase((database) => {
      setupSqlUnderwritingWorkspace(database);
      executeSql(database, `
        insert into public.source_revisions (
          id, workspace_id, source_id, revision, content_hash,
          object_key, object_version, content_type,
          extractor_id, extractor_version, extracted_at,
          supersedes_revision_id, created_at
        ) values (
          'revision_grounded',
          'workspace_1',
          'source_grounded',
          1,
          'sha256:${"e".repeat(64)}',
          'private/source-grounded.md',
          'object:v1',
          'text/markdown',
          'plain_text_v1',
          '1',
          '2026-07-29T10:00:00.000Z',
          null,
          '2026-07-29T10:05:00.000Z'
        );
      `);
      const sourceEvidence = {
        id: "fact_grounded",
        workspaceId: "workspace_1",
        dealId: "deal_1",
        sourceRevisionId: "revision_grounded",
        field: "stage",
        value: "seed",
      };
      executeSql(database, `
        set role service_role;
        select public.save_source_evidence_items(
          ${sqlJson([sourceEvidence])}
        );
        select public.save_source_evidence_items(
          ${sqlJson([sourceEvidence])}
        );
      `);
      assert.throws(() =>
        executeSql(database, `
          set role service_role;
          select public.save_source_evidence_items(
            ${sqlJson([{ ...sourceEvidence, value: "series_a" }])}
          );
        `)
      );
      assert.throws(() =>
        executeSql(database, `
          insert into public.evidence_pack_builds (
            workspace_id, input_fingerprint, pack_id, pack_payload,
            source_revision_snapshots
          ) values (
            'workspace_1',
            'sha256:${"7".repeat(64)}',
            'missing_deal_pack',
            '{"workspaceId":"workspace_1","id":"missing_deal_pack"}'::jsonb,
            '[]'::jsonb
          );
        `)
      );
      assert.throws(() =>
        executeSql(database, `
          insert into public.evidence_pack_builds (
            workspace_id, input_fingerprint, pack_id, pack_payload,
            source_revision_snapshots
          ) values (
            'workspace_1',
            'sha256:${"8".repeat(64)}',
            'null_deal_pack',
            '{"workspaceId":"workspace_1","id":"null_deal_pack","dealId":null}'::jsonb,
            '[]'::jsonb
          );
        `)
      );

      const pack = {
        id: "pack_grounded",
        workspaceId: "workspace_1",
        dealId: "deal_1",
        sourceRevisionIds: ["revision_grounded"],
      };
      const snapshot = {
        id: "revision_grounded",
        workspaceId: "workspace_1",
        sourceId: "source_grounded",
        revision: 1,
        contentHash: `sha256:${"e".repeat(64)}`,
        objectKey: "private/source-grounded.md",
        objectVersion: "object:v1",
        contentType: "text/markdown",
        extractorId: "plain_text_v1",
        extractorVersion: "1",
        extractedAt: "2026-07-29T10:00:00.000Z",
        supersedesRevisionId: null,
        createdAt: "2026-07-29T10:05:00.000Z",
      };
      const build = {
        pack,
        inputFingerprint: `sha256:${"f".repeat(64)}`,
        sourceRevisionSnapshots: [snapshot],
      };
      executeSql(database, `
        set role service_role;
        select public.save_evidence_pack_build(${sqlJson(build)});
        select public.save_evidence_pack_build(${sqlJson(build)});
      `);
      assert.throws(() =>
        executeSql(database, `
          set role service_role;
          select public.save_evidence_pack_build(${sqlJson({
            pack: {
              ...pack,
              id: "pack_tampered_snapshot",
            },
            inputFingerprint: `sha256:${"1".repeat(64)}`,
            sourceRevisionSnapshots: [{
              ...snapshot,
              contentHash: `sha256:${"0".repeat(64)}`,
            }],
          })});
        `)
      );
      assert.throws(() =>
        executeSql(database, `
          set role service_role;
          select public.save_evidence_pack_build(${sqlJson({
            pack: {
              ...pack,
              id: "pack_duplicate_revisions",
              sourceRevisionIds: [
                "revision_grounded",
                "revision_grounded",
              ],
            },
            inputFingerprint: `sha256:${"2".repeat(64)}`,
            sourceRevisionSnapshots: [snapshot, snapshot],
          })});
        `)
      );
      assert.throws(() =>
        executeSql(database, `
          set role service_role;
          select public.save_evidence_pack_build(${sqlJson({
            pack: {
              ...pack,
              id: "pack_mismatched_revisions",
              sourceRevisionIds: [],
            },
            inputFingerprint: `sha256:${"3".repeat(64)}`,
            sourceRevisionSnapshots: [snapshot],
          })});
        `)
      );
      assert.throws(() =>
        executeSql(database, `
          set role service_role;
          select public.save_evidence_pack_build(${sqlJson({
            pack: {
              ...pack,
              id: "pack_omitted_snapshot",
            },
            inputFingerprint: `sha256:${"4".repeat(64)}`,
            sourceRevisionSnapshots: [],
          })});
        `)
      );

      assert.equal(
        executeSql(database, `
          select
            (select count(*) from public.source_evidence_items)
            || '|' ||
            (select count(*) from public.evidence_pack_builds)
            || '|' ||
            (select count(*) from public.critical_evidence_profile_fields
              where critical_evidence_profile_id =
                'critical_evidence_seed_b2b_saas_v1');
        `),
        "1|1|9",
      );
    });
  },
);

test(
  "0012 immutable evidence saves converge under simultaneous identical calls",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  async () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    await withTemporaryDatabaseAsync(async (database) => {
      setupSqlUnderwritingWorkspace(database);
      seedSqlSourceRevision(database, "revision_concurrent");
      executeSql(database, `
        create or replace function public.delay_immutable_insert()
        returns trigger
        language plpgsql
        as $$
        begin
          perform pg_sleep(0.2);
          return new;
        end;
        $$;
        create trigger delay_source_evidence_insert
        before insert on public.source_evidence_items
        for each row execute function public.delay_immutable_insert();
        create trigger delay_evidence_pack_build_insert
        before insert on public.evidence_pack_builds
        for each row execute function public.delay_immutable_insert();
      `);
      const sourceEvidence = {
        id: "fact_concurrent",
        workspaceId: "workspace_1",
        dealId: "deal_1",
        sourceRevisionId: "revision_concurrent",
        field: "stage",
        value: "seed",
      };
      const saveEvidenceSql = `
        set role service_role;
        select public.save_source_evidence_items(
          ${sqlJson([sourceEvidence])}
        );
      `;
      await Promise.all([
        executeSqlAsync(database, saveEvidenceSql),
        executeSqlAsync(database, saveEvidenceSql),
      ]);

      const pack = {
        id: "pack_concurrent",
        workspaceId: "workspace_1",
        dealId: "deal_1",
        sourceRevisionIds: ["revision_concurrent"],
      };
      const build = {
        pack,
        inputFingerprint: `sha256:${"8".repeat(64)}`,
        sourceRevisionSnapshots: [{
          id: "revision_concurrent",
          workspaceId: "workspace_1",
          sourceId: "source_deal_1",
          revision: 1,
          contentHash: `sha256:${"d".repeat(64)}`,
          objectKey: "private/deal_1.md",
          objectVersion: "object:v1",
          contentType: "text/markdown",
          extractorId: "plain_text_v1",
          extractorVersion: "1",
          extractedAt: "2026-07-29T10:00:00.000Z",
          supersedesRevisionId: null,
          createdAt: "2026-07-29T10:05:00.000Z",
        }],
      };
      const saveBuildSql = `
        set role service_role;
        select public.save_evidence_pack_build(${sqlJson(build)});
      `;
      const buildResults = await Promise.all([
        executeSqlAsync(database, saveBuildSql),
        executeSqlAsync(database, saveBuildSql),
      ]);

      assert.equal(buildResults[0], buildResults[1]);
      assert.equal(
        executeSql(database, `
          select
            (select count(*) from public.source_evidence_items)
            || '|' ||
            (select count(*) from public.evidence_pack_builds);
        `),
        "1|1",
      );
    });
  },
);

test(
  "0012 keeps published Critical Evidence child definitions immutable",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    withTemporaryDatabase((database) => {
      setupSqlUnderwritingWorkspace(database);
      assert.throws(
        () => executeSql(database, `
          update public.critical_evidence_profile_fields
          set critical = false
          where critical_evidence_profile_id =
            'critical_evidence_seed_b2b_saas_v1'
            and field_id = 'company_identity';
        `),
        /critical_evidence_profile_fields is immutable/i,
      );
    });
  },
);

test(
  "0012 reapplication replaces legacy checks with every tightened named constraint",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    withTemporaryDatabase((database) => {
      setupSqlUnderwritingWorkspace(database);
      executeSql(database, `
        alter table public.source_evidence_items
          drop constraint source_evidence_items_payload_shape_check;
        alter table public.source_evidence_items
          add constraint source_evidence_items_payload_shape_check
          check (true);
        alter table public.source_evidence_items
          drop constraint source_evidence_items_payload_identity_check;
        alter table public.source_evidence_items
          add constraint source_evidence_items_payload_identity_check
          check (true);
        alter table public.evidence_pack_builds
          drop constraint evidence_pack_builds_input_fingerprint_check;
        alter table public.evidence_pack_builds
          add constraint evidence_pack_builds_input_fingerprint_check
          check (true);
        alter table public.evidence_pack_builds
          drop constraint evidence_pack_builds_payload_shape_check;
        alter table public.evidence_pack_builds
          add constraint evidence_pack_builds_payload_shape_check
          check (true);
        alter table public.evidence_pack_builds
          drop constraint evidence_pack_builds_snapshots_shape_check;
        alter table public.evidence_pack_builds
          add constraint evidence_pack_builds_snapshots_shape_check
          check (true);
        alter table public.evidence_pack_builds
          drop constraint evidence_pack_builds_payload_identity_check;
        alter table public.evidence_pack_builds
          add constraint evidence_pack_builds_payload_identity_check
          check (true);
        alter table public.critical_evidence_profile_fields
          drop constraint
            critical_evidence_profile_fields_assertion_statuses_shape_check;
        alter table public.critical_evidence_profile_fields
          add constraint
            critical_evidence_profile_fields_assertion_statuses_shape_check
          check (true);
        alter table public.critical_evidence_profile_fields
          drop constraint
            critical_evidence_profile_fields_freshness_shape_check;
        alter table public.critical_evidence_profile_fields
          add constraint
            critical_evidence_profile_fields_freshness_shape_check
          check (true);
      `);

      applySql(database, groundingMigrationPath);
      assert.equal(
        executeSql(database, `
          select count(*)::text
          from pg_constraint
          where conname in (
            'source_evidence_items_payload_shape_check',
            'source_evidence_items_payload_identity_check',
            'evidence_pack_builds_input_fingerprint_check',
            'evidence_pack_builds_payload_shape_check',
            'evidence_pack_builds_snapshots_shape_check',
            'evidence_pack_builds_payload_identity_check',
            'critical_evidence_profile_fields_assertion_statuses_shape_check',
            'critical_evidence_profile_fields_freshness_shape_check'
          );
        `),
        "8",
      );
      assert.match(
        executeSql(database, `
          select pg_get_constraintdef(oid)
          from pg_constraint
          where conname =
            'critical_evidence_profile_fields_assertion_statuses_shape_check';
        `),
        /jsonb_array_length[\s\S]*jsonb_path_exists/i,
      );

      seedSqlSourceRevision(database);
      assert.throws(() =>
        executeSql(database, `
          insert into public.source_evidence_items (
            workspace_id, evidence_id, deal_id, source_revision_id, payload
          ) values (
            'workspace_1', 'bad_evidence', 'deal_1', 'revision_1', '{}'::jsonb
          );
        `)
      );
      assert.throws(() =>
        executeSql(database, `
          insert into public.evidence_pack_builds (
            workspace_id, input_fingerprint, pack_id, pack_payload,
            source_revision_snapshots
          ) values (
            'workspace_1', 'not-a-fingerprint', 'bad_pack',
            '{"workspaceId":"workspace_1","id":"bad_pack"}'::jsonb,
            '[]'::jsonb
          );
        `)
      );
      assert.throws(() =>
        executeSql(database, `
          insert into public.critical_evidence_profile_fields (
            critical_evidence_profile_id, field_id, critical,
            minimum_model_input, accepted_assertion_statuses,
            accepted_freshness
          ) values (
            'critical_evidence_seed_b2b_saas_v1',
            'bad_empty_array',
            true,
            false,
            '[]'::jsonb,
            '["current"]'::jsonb
          );
        `)
      );
      assert.throws(() =>
        executeSql(database, `
          insert into public.critical_evidence_profile_fields (
            critical_evidence_profile_id, field_id, critical,
            minimum_model_input, accepted_assertion_statuses,
            accepted_freshness
          ) values (
            'critical_evidence_seed_b2b_saas_v1',
            'bad_blank_array_value',
            true,
            false,
            '["reported"]'::jsonb,
            '["   "]'::jsonb
          );
        `)
      );
    });
  },
);

test(
  "0011 rolls back every artifact row when finalization fails after inserts begin",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    withTemporaryDatabase((database) => {
      executeSql(database, `
        do $$
        begin
          create role service_role nologin noinherit bypassrls;
        exception when duplicate_object then null;
        end;
        $$;
      `);
      for (const migration of migrations) applySql(database, migration);
      executeSql(database, `
        insert into public.workspaces (id, name)
        values ('workspace_1', 'Workspace 1');
        insert into public.scan_runs (
          id, workspace_id, mode, status
        ) values (
          '00000000-0000-4000-8000-000000000801',
          'workspace_1',
          'structured',
          'completed'
        );
        select public.activate_fund_policy_version(jsonb_build_object(
          'workspaceId', 'workspace_1',
          'actorId', null,
          'expectedActiveVersionId', null,
          'action', 'recommended'
        ));
        insert into public.companies (workspace_id, id, name)
        values ('workspace_1', 'company_1', 'Company 1');
        insert into public.deals (
          workspace_id, id, company_id, company_name, status
        ) values (
          'workspace_1', 'deal_1', 'company_1', 'Company 1', 'screening'
        );
        insert into public.underwriting_batches (
          id, workspace_id, scan_run_id, status,
          batch_input_fingerprint, fund_policy_snapshot_id,
          force_refresh, refresh_nonce, rerun_of_id
        ) values (
          'batch_1',
          'workspace_1',
          '00000000-0000-4000-8000-000000000801',
          'running',
          'sha256:${"1".repeat(64)}',
          'fund_policy:workspace_1:v1',
          false,
          null,
          null
        );
        insert into public.candidate_runs (
          id, batch_id, workspace_id, deal_id, status,
          candidate_analysis_fingerprint, worker_id, lease_token,
          lease_expires_at
        ) values (
          'candidate_db',
          'batch_1',
          'workspace_1',
          'deal_1',
          'running',
          'pending:candidate_db',
          'worker_db',
          'lease_db',
          now() + interval '5 minutes'
        );
      `);
      const payload = finalization({
        candidateRunId: "candidate_db",
        dealId: "deal_1",
        workerId: "worker_db",
        leaseToken: "lease_db",
        fundPolicyId: "fund_policy:workspace_1:v1",
      });
      payload.actionDrafts.push({ ...payload.actionDrafts[0] });
      assert.throws(() =>
        executeSql(database, `
          select public.finalize_candidate_underwriting(
            ${sqlJson(payload)}
          );
        `)
      );

      assert.equal(
        executeSql(database, `
          select
            (select count(*) from public.evidence_packs)
            || '|' ||
            (select count(*) from public.candidate_context_snapshots)
            || '|' ||
            (select count(*) from public.scenario_models)
            || '|' ||
            (select count(*) from public.valuation_evaluations)
            || '|' ||
            (select count(*) from public.final_syntheses)
            || '|' ||
            (select count(*) from public.action_drafts)
            || '|' ||
            (select count(*) from public.candidate_version_snapshots)
            || '|' ||
            (select status from public.candidate_runs
              where id = 'candidate_db');
        `),
        "0|0|0|0|0|0|0|running",
      );

      payload.actionDrafts.pop();
      payload.decision.claimEdges.push({
        claimItemId: payload.decision.id,
        dependencyItemId: "foreign_fact",
        dependencyType: "fact",
      });
      assert.throws(() =>
        executeSql(database, `
          select public.finalize_candidate_underwriting(${sqlJson(payload)});
        `)
      );
      assert.equal(
        executeSql(database, `
          select
            (select count(*) from public.evidence_packs)
            || '|' ||
            (select count(*) from public.underwriting_claim_edges)
            || '|' ||
            (select status from public.candidate_runs
              where id = 'candidate_db');
        `),
        "0|0|running",
      );
      payload.decision.claimEdges.pop();
      executeSql(database, `
        select public.finalize_candidate_underwriting(${sqlJson(payload)});
      `);
      assert.equal(
        executeSql(database, `
          select status || '|' || candidate_analysis_fingerprint
          from public.candidate_runs
          where id = 'candidate_db';
        `),
        `completed|sha256:${"a".repeat(64)}`,
      );
      assert.equal(
        executeSql(database, `
          select
            (select count(*) from public.evidence_packs)
            || '|' ||
            (select count(*) from public.action_drafts)
            || '|' ||
            (select count(*) from public.candidate_version_snapshots);
        `),
        "1|1|1",
      );
    });
  },
);

test(
  "0011 finalizes the real Task10 valuation artifact set with its complete calculation lineage",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    withTemporaryDatabase((database) => {
      setupSqlUnderwritingWorkspace(database);
      executeSql(database, `
        insert into public.underwriting_batches (
          id, workspace_id, scan_run_id, status,
          batch_input_fingerprint, fund_policy_snapshot_id,
          force_refresh, refresh_nonce, rerun_of_id
        ) values (
          'batch_real',
          'workspace_1',
          '00000000-0000-4000-8000-000000000801',
          'running',
          'sha256:${"c".repeat(64)}',
          'fund_policy:workspace_1:v1',
          false,
          null,
          null
        );
        insert into public.candidate_runs (
          id, batch_id, workspace_id, deal_id, status,
          candidate_analysis_fingerprint, worker_id, lease_token,
          lease_expires_at
        ) values (
          'valuation:pack_1',
          'batch_real',
          'workspace_1',
          'deal_1',
          'running',
          'pending:valuation:pack_1',
          'worker_db',
          'lease_db',
          now() + interval '5 minutes'
        );
      `);
      const payload = realValuationFinalization({
        workerId: "worker_db",
        leaseToken: "lease_db",
      });

      executeSql(database, `
        select public.finalize_candidate_underwriting(${sqlJson(payload)});
      `);
      assert.equal(
        executeSql(database, `
          select status from public.candidate_runs
          where id = 'valuation:pack_1';
        `),
        "completed",
      );
      assert.equal(
        executeSql(database, `
          select count(*)::text
          from public.underwriting_claim_edges
          where candidate_run_id = 'valuation:pack_1'
            and dependency_type = 'calculation';
        `),
        String(payload.calculationClaimEdges.length),
      );
    });
  },
);

test(
  "0011 completes a batch when persisted selections produce zero candidates",
  { skip: !canCreateTemporaryDatabase && !requirePostgres },
  () => {
    assert.equal(
      canCreateTemporaryDatabase,
      true,
      "PostgreSQL with temporary-database privileges is required.",
    );
    withTemporaryDatabase((database) => {
      setupSqlUnderwritingWorkspace(database);
      executeSql(database, `
        insert into public.underwriting_batches (
          id, workspace_id, scan_run_id, status,
          batch_input_fingerprint, fund_policy_snapshot_id,
          force_refresh, refresh_nonce, rerun_of_id
        ) values (
          'batch_empty',
          'workspace_1',
          '00000000-0000-4000-8000-000000000801',
          'queued',
          'sha256:${"d".repeat(64)}',
          'fund_policy:workspace_1:v1',
          false,
          null,
          null
        );
      `);
      executeSql(database, `
        set role service_role;
        select public.save_underwriting_selections(jsonb_build_object(
          'batchId', 'batch_empty',
          'selections', jsonb_build_array(jsonb_build_object(
            'dealId', 'deal_1',
            'status', 'selected',
            'rank', 6,
            'reason', 'Outside Top 5'
          ))
        ));
      `);

      assert.equal(
        executeSql(database, `
          select status
          from public.underwriting_batches
          where id = 'batch_empty';
        `),
        "completed",
      );
      assert.equal(
        executeSql(database, `
          select status || '|' || coalesce(rank::text, 'null')
          from public.underwriting_selections
          where batch_id = 'batch_empty' and deal_id = 'deal_1';
        `),
        "not_selected|null",
      );
    });
  },
);

function seedSqlSourceRevision(
  database: string,
  revisionId = "revision_1",
): void {
  executeSql(database, `
    insert into public.source_revisions (
      id, workspace_id, source_id, revision, content_hash,
      object_key, object_version, content_type,
      extractor_id, extractor_version, extracted_at,
      supersedes_revision_id, created_at
    ) values (
      '${revisionId}',
      'workspace_1',
      'source_deal_1',
      1,
      'sha256:${"d".repeat(64)}',
      'private/deal_1.md',
      'object:v1',
      'text/markdown',
      'plain_text_v1',
      '1',
      '2026-07-29T10:00:00.000Z',
      null,
      '2026-07-29T10:05:00.000Z'
    );
  `);
}

function saveSqlFinalizationBuild(
  database: string,
  payload: CandidateFinalization,
): void {
  const build = sqlFinalizationBuildPayload(payload);
  executeSql(database, `
    set role service_role;
    select public.save_evidence_pack_build(${sqlJson(build)});
  `);
}

function sqlFinalizationBuildPayload(
  payload: CandidateFinalization,
): Record<string, unknown> {
  const revisionId = payload.evidencePack.sourceRevisionIds[0]!;
  return {
    pack: payload.evidencePack,
    inputFingerprint: payload.evidencePackBuildInputFingerprint,
    sourceRevisionSnapshots: [{
      id: revisionId,
      workspaceId: payload.evidencePack.workspaceId,
      sourceId: "source_deal_1",
      revision: 1,
      contentHash: `sha256:${"d".repeat(64)}`,
      objectKey: "private/deal_1.md",
      objectVersion: "object:v1",
      contentType: "text/markdown",
      extractorId: "plain_text_v1",
      extractorVersion: "1",
      extractedAt: "2026-07-29T10:00:00.000Z",
      supersedesRevisionId: null,
      createdAt: "2026-07-29T10:05:00.000Z",
    }],
  };
}

function setupSqlUnderwritingWorkspace(database: string): void {
  executeSql(database, `
    do $$
    begin
      create role service_role nologin noinherit bypassrls;
    exception when duplicate_object then null;
    end;
    $$;
  `);
  for (const migration of migrations) applySql(database, migration);
  executeSql(database, `
    insert into public.workspaces (id, name)
    values ('workspace_1', 'Workspace 1');
    insert into public.scan_runs (
      id, workspace_id, mode, status
    ) values (
      '00000000-0000-4000-8000-000000000801',
      'workspace_1',
      'structured',
      'completed'
    );
    select public.activate_fund_policy_version(jsonb_build_object(
      'workspaceId', 'workspace_1',
      'actorId', null,
      'expectedActiveVersionId', null,
      'action', 'recommended'
    ));
    insert into public.companies (workspace_id, id, name)
    values ('workspace_1', 'company_1', 'Company 1');
    insert into public.deals (
      workspace_id, id, company_id, company_name, status
    ) values (
      'workspace_1', 'deal_1', 'company_1', 'Company 1', 'screening'
    );
  `);
}

function withTemporaryDatabase(run: (database: string) => void): void {
  const database = makeDisposableDatabaseName("underwriting_runs");
  postgresExec("createdb", [database], { stdio: "pipe" });
  try {
    run(database);
  } finally {
    postgresExec("dropdb", ["--if-exists", database], { stdio: "pipe" });
  }
}

async function withTemporaryDatabaseAsync(
  run: (database: string) => Promise<void>,
): Promise<void> {
  const database = makeDisposableDatabaseName("underwriting_async");
  postgresExec("createdb", [database], { stdio: "pipe" });
  try {
    await run(database);
  } finally {
    postgresExec("dropdb", ["--if-exists", database], { stdio: "pipe" });
  }
}

function applySql(database: string, path: string): void {
  postgresExec(
    "psql",
    ["-v", "ON_ERROR_STOP=1", "-d", database, "-f", path],
    { stdio: "pipe" },
  );
}

function executeSql(database: string, sql: string): string {
  return postgresExec(
    "psql",
    ["-q", "-v", "ON_ERROR_STOP=1", "-d", database, "-AtF", "|", "-c", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

function executeSqlAsync(database: string, sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    assert.equal(postgresSafety.state, "verified");
    if (postgresSafety.state !== "verified") throw new Error("unreachable");
    const child = postgresSafety.spawn(
      "psql",
      ["-q", "-v", "ON_ERROR_STOP=1", "-d", database, "-AtF", "|", "-c", sql],
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(stderr.trim() || `psql exited with status ${code}.`));
    });
  });
}

function sqlJson(value: unknown): string {
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
}
