import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Decimal from "decimal.js";

import type { CandidateFinalization } from "../../db/repositories/underwriting-artifacts";
import { ScenarioInputFieldSchema } from "../../lib/contracts/underwriting";
import { createActionDraftGenerator } from "../../lib/underwriting/action-drafts";
import { actionsForDealStatusAndDirection } from "../../lib/reports/action-policy";
import { SYNTHETIC_FRAMEWORK_PACK } from "../../seed/underwriting/framework-pack-v1";
import {
  makeDisposableDatabaseName,
  requireLoopbackPostgres,
  type VerifiedLoopbackPostgresContext,
} from "../helpers/require-loopback-postgres";

const migrationName = "0022_task9_finalization_authority.sql";
const migrationPath = fileURLToPath(new URL(
  `../../drizzle/${migrationName}`,
  import.meta.url,
));
const journalPath = fileURLToPath(new URL(
  "../../drizzle/meta/_journal.json",
  import.meta.url,
));
const postgres = requireLoopbackPostgres();
const NOW = "2026-08-03T12:00:00.000Z";
const BUILD_FINGERPRINT = `sha256:${"e".repeat(64)}`;
const MARKET_BUILD_FINGERPRINT = `sha256:${"f".repeat(64)}`;

function success(
  result: ReturnType<VerifiedLoopbackPostgresContext["run"]>,
  operation: string,
): string {
  assert.equal(result.status, 0, `${operation} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function sqlJson(value: unknown): string {
  return `$json$${JSON.stringify(value)}$json$::jsonb`;
}

function currentPayload(): CandidateFinalization {
  const candidateRunId = "candidate_authority";
  const missingEvidence = [{
    fieldId: "arr",
    label: "arr",
    externalLabel: "arr",
    reasonCode: "MISSING_CRITICAL_EVIDENCE",
    mostLikelyDecisionImpact:
      "Providing accepted evidence may raise or lower the formal decision ceiling.",
  }];
  const actions = actionsForDealStatusAndDirection("screening", "positive");
  const scenarioInputs = (scenario: "bear" | "base" | "bull") =>
    ScenarioInputFieldSchema.options.map((field) => ({
      id: `${scenario}_${field}`,
      scenario,
      field,
      value: null,
      unit: null,
      evidenceItemId: null,
      assumptionItemId: null,
      unavailableReason: `${field} is unavailable.`,
    }));
  const judgments = SYNTHETIC_FRAMEWORK_PACK.cards.map((card, index) => ({
    id: `judgment_${index + 1}`,
    analysisType: "framework_judgment" as const,
    frameworkCardId: card.id,
    frameworkVersion: card.version,
    applicability: "unavailable" as const,
    conclusion: "abstain" as const,
    supportEvidenceItemIds: [],
    counterEvidenceItemIds: [],
    unusedEvidenceItemIds: ["fact_reported_valuation"],
    strongestSupport: null,
    strongestCounterargument: null,
    unknowns: ["Geography is unavailable."],
    limitations: [
      "Core-only analysis cannot establish framework applicability while geography is unavailable.",
    ],
    confidence: {
      sourceReliability: "low" as const,
      evidenceStrength: "low" as const,
      evidenceCoverage: "low" as const,
      applicability: "low" as const,
      judgment: "low" as const,
    },
    claimEdges: [{
      claimItemId: `judgment_${index + 1}`,
      dependencyItemId: card.id,
      dependencyType: "framework_ref" as const,
    }],
    fingerprint: `framework-abstention-${index + 1}`,
  }));
  const decision = {
    id: "decision_authority",
    analysisType: "final_synthesis" as const,
    companyQuality: "unavailable" as const,
    priceAttractiveness: "unavailable" as const,
    fundFit: "unavailable" as const,
    decision: null,
    decisionCeiling: null,
    hardVeto: false,
    firedRules: [],
    blockingEvidenceItemIds: [],
    claimEdges: [],
    confidence: "low" as const,
  };
  return {
    workerId: "worker_authority",
    leaseToken: "lease_authority",
    candidateRunId,
    candidateAnalysisFingerprint: `sha256:${"a".repeat(64)}`,
    evidencePackBuildInputFingerprint: BUILD_FINGERPRINT,
    evidencePack: {
      id: "evidence_pack_authority",
      version: 1,
      workspaceId: "workspace_authority",
      dealId: "deal_authority",
      asOfDate: "2026-08-03",
      sourceRevisionIds: ["revision_authority"],
      facts: [{
        id: "fact_reported_valuation",
        analysisType: "fact",
        provenanceOrigin: "management",
        field: "reported_valuation",
        value: "100",
        unit: "currency",
        currency: "USD",
        periodStart: null,
        periodEnd: null,
        publishedAt: null,
        eventAt: null,
        retrievedAt: NOW,
        sourceRevisionId: "revision_authority",
        locator: {
          kind: "text_range",
          start: 0,
          end: 3,
          excerpt: "Valuation: 100",
        },
        sourceRole: "management",
        assertionStatus: "reported",
        verificationMethod: null,
        freshness: "current",
        acceptedForGate: true,
      }],
      assumptions: [],
      conflicts: [],
      coverage: {
        minimumModelInputsComplete: false,
        criticalEvidenceComplete: false,
        missingFieldIds: ["arr"],
        blockingConflictIds: [],
        decisionCeiling: null,
        underwritingStatus: "unavailable",
        reasonCodes: ["ARR_NOT_REPORTED"],
      },
      createdAt: NOW,
    },
    context: {
      id: "context_authority",
      contextVersion: "1",
      analysisMode: "core_only",
      stage: "seed",
      businessModel: "b2b_saas",
      geography: "unavailable",
      securityType: "preferred",
      asOfDate: "2026-08-03",
      criticalEvidenceProfileId: "critical_authority",
      benchmarkPackId: null,
      benchmarkCompatibility: "unavailable",
      valuationMethodPolicyId: "valuation_authority",
      decisionPolicyId: "decision_authority_policy",
      frameworkPackId: SYNTHETIC_FRAMEWORK_PACK.id,
    },
    scenarioModel: {
      id: "scenario_authority",
      candidateRunId,
      formulaPolicyVersion: "valuation_authority",
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
      id: "valuation_authority_result",
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
    decision,
    narrative: "Current source-grounded terminal underwriting artifact.",
    actionDrafts: createActionDraftGenerator({
      workspaceId: "workspace_authority",
      now: () => new Date(NOW),
    }).generate({
      candidateRunId,
      decision,
      missingEvidence,
      dealStatus: "screening",
      beliefDirection: "positive",
      actions,
      judgments,
      disagreements: [],
    }),
    versionSnapshot: {
      fundPolicyId: "fund_policy:workspace_authority:v1",
      dealStatus: "screening",
      beliefDirection: "positive",
      canonicalActions: actions,
      actionPolicyVersion: "belief-action-policy-v1",
      draftPolicyVersion: "status-safe-action-draft-v2",
      semanticContextAssumptionPolicyVersion:
        "belief-reversal-demo-context-v1",
      semanticContextMappingVersion:
        "belief-reversal-reviewed-context-mapping-v1",
      analysisMode: "core_only",
      contextVersion: "1",
      geography: "unavailable",
      benchmarkCompatibility: "unavailable",
      benchmarkPackId: null,
      benchmarkEntryId: null,
      benchmarkDefinitionFingerprint: null,
      frameworkPackId: SYNTHETIC_FRAMEWORK_PACK.id,
      frameworkPackDefinitionFingerprint: `sha256:${"2".repeat(64)}`,
      routerVersion: "context-router-v2",
      criticalEvidenceProfileId: "critical_authority",
      criticalEvidenceProfileDefinitionFingerprint: `sha256:${"3".repeat(64)}`,
      valuationMethodPolicyId: "valuation_authority",
      valuationMethodPolicyDefinitionFingerprint: `sha256:${"4".repeat(64)}`,
      decisionPolicyId: "decision_authority_policy",
      decisionPolicyDefinitionFingerprint: `sha256:${"5".repeat(64)}`,
      referenceCatalogFingerprint: `sha256:${"6".repeat(64)}`,
      formulaVersions: [],
      providerModel: "none",
      promptVersion: "underwriting-prompt-v2",
      schemaVersion: "underwriting-schema-v2",
      settingsFingerprint: `sha256:${"7".repeat(64)}`,
      applicationCommit: "task9-test",
      companyAnalysisUnknowns: [],
    },
  };
}

test("0022 is the contiguous local-only Task 9 authority migration", () => {
  assert.equal(existsSync(migrationPath), true);
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  assert.deepEqual(
    journal.entries.find((entry) =>
      entry.tag === "0022_task9_finalization_authority"
    ),
    {
    idx: 22,
    version: "7",
    when: 1785924000000,
    tag: "0022_task9_finalization_authority",
    breakpoints: true,
    },
  );
  const launcher = readFileSync(fileURLToPath(new URL(
    "../../scripts/apply-production-migrations.zsh",
    import.meta.url,
  )), "utf8");
  assert.match(launcher, /through 0019/u);
  assert.doesNotMatch(launcher, /0022_task9_finalization_authority/u);
});

test(
  "0022 rejects forged current V2 terminal payloads before mutation and preserves exact rerun reuse",
  { skip: postgres.state === "skipped" ? postgres.reason : false },
  () => {
    assert.equal(postgres.state, "verified");
    if (postgres.state !== "verified") return;
    const database = makeDisposableDatabaseName("task9_authority");
    success(postgres.run("createdb", [database]), "database creation");
    try {
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", "create extension if not exists pgcrypto",
      ]), "pgcrypto creation");
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", [
          "do $$ begin",
          "if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;",
          "if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;",
          "if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;",
          "end $$",
        ].join(" "),
      ]), "API roles");
      const directory = fileURLToPath(new URL("../../drizzle/", import.meta.url));
      const migrations = readdirSync(directory)
        .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
        .sort();
      for (const migration of migrations) {
        success(postgres.run("psql", [
          "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
          "-f", fileURLToPath(new URL(`../../drizzle/${migration}`, import.meta.url)),
        ]), `migration ${migration.slice(0, 4)}`);
      }
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", [
          "insert into public.workspaces(id,name) values ('workspace_authority','Authority')",
          "insert into public.scan_runs(id,workspace_id,mode,status) values ('00000000-0000-4000-8000-000000000022','workspace_authority','structured','completed')",
          "select public.activate_fund_policy_version(jsonb_build_object('workspaceId','workspace_authority','actorId',null,'expectedActiveVersionId',null,'action','recommended'))",
          "insert into public.companies(id,workspace_id,name) values ('company_authority','workspace_authority','Authority Co')",
          "insert into public.deals(id,workspace_id,company_id,company_name,status) values ('deal_authority','workspace_authority','company_authority','Authority Co','screening')",
          "insert into public.intelligence_reports(id,workspace_id,run_id,market_summary,analysis_status) values ('report_authority','workspace_authority','00000000-0000-4000-8000-000000000022','Authority completed intelligence report','completed')",
          "insert into public.company_analyses(id,workspace_id,report_id,run_id,deal_id,company_name,deal_status,outcome,confidence,score,investment_memory,market_evidence,implications,recommended_next_move,company_brief,source_refs) values ('analysis_authority','workspace_authority','report_authority','00000000-0000-4000-8000-000000000022','deal_authority','Authority Co','screening','belief_revised','medium',1,'{}'::jsonb,'{}'::jsonb,'{\"positive\":[],\"negative\":[]}'::jsonb,'Advance diligence','{\"structuredFields\":[]}'::jsonb,'[]'::jsonb)",
          `insert into public.source_documents(id,filename,title,role,company_name,deal_id,checksum,byte_size,object_key) values ('source_authority','authority.md','Authority','deal_document','Authority Co','deal_authority','checksum',1,'private/authority.md')`,
          `insert into public.source_revisions(id,workspace_id,source_id,revision,content_hash,object_key,object_version,content_type,extractor_id,extractor_version,extracted_at,created_at) values ('revision_authority','workspace_authority','source_authority',1,'sha256:${"d".repeat(64)}','private/authority.md','object:v1','text/markdown','plain_text_v1','1','${NOW}','${NOW}')`,
          `insert into public.underwriting_batches(id,workspace_id,scan_run_id,status,batch_input_fingerprint,fund_policy_snapshot_id,force_refresh) values ('batch_authority','workspace_authority','00000000-0000-4000-8000-000000000022','running','sha256:${"1".repeat(64)}','fund_policy:workspace_authority:v1',false)`,
          "insert into public.candidate_runs(id,batch_id,workspace_id,deal_id,status,candidate_analysis_fingerprint,worker_id,lease_token,lease_expires_at) values ('candidate_authority','batch_authority','workspace_authority','deal_authority','running','pending:candidate_authority','worker_authority','lease_authority',now()+interval '5 minutes')",
        ].join("; "),
      ]), "authority fixture setup");
      const payload = currentPayload();
      const build = {
        pack: payload.evidencePack,
        inputFingerprint: BUILD_FINGERPRINT,
        sourceRevisionSnapshots: [{
          id: "revision_authority",
          workspaceId: "workspace_authority",
          sourceId: "source_authority",
          revision: 1,
          contentHash: `sha256:${"d".repeat(64)}`,
          objectKey: "private/authority.md",
          objectVersion: "object:v1",
          contentType: "text/markdown",
          extractorId: "plain_text_v1",
          extractorVersion: "1",
          extractedAt: NOW,
          supersedesRevisionId: null,
          createdAt: NOW,
        }],
      };
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", `set role service_role; select public.save_evidence_pack_build(${sqlJson(build)})`,
      ]), "exact evidence build");

      const market = structuredClone(payload);
      market.evidencePackBuildInputFingerprint = MARKET_BUILD_FINGERPRINT;
      market.evidencePack.id = "evidence_pack_authority_market";
      market.evidencePack.assumptions = [
        {
          id: "assumption_benchmark_value",
          analysisType: "assumption",
          provenanceOrigin: "benchmark",
          scenario: "all",
          field: "compatible_benchmark_value",
          value: "100",
          unit: "USD",
          rationale: "Pinned benchmark value.",
          inputRefIds: ["benchmark_market"],
          sensitivity: "high",
          requiresConfirmation: false,
        },
        {
          id: "assumption_benchmark_stale",
          analysisType: "assumption",
          provenanceOrigin: "benchmark",
          scenario: "all",
          field: "compatible_benchmark_stale_after",
          value: "2027-01-01",
          unit: "date",
          rationale: "Pinned benchmark expiry.",
          inputRefIds: ["benchmark_market"],
          sensitivity: "high",
          requiresConfirmation: false,
        },
        ...(["bear", "base", "bull"] as const).map((scenario, index) => ({
          id: `assumption_multiplier_${scenario}`,
          analysisType: "assumption" as const,
          provenanceOrigin: "recommended_policy" as const,
          scenario,
          field: "scenario_price_multiplier",
          value: ["0.5", "1", "2"][index]!,
          unit: "decimal",
          rationale: `Pinned ${scenario} multiplier.`,
          inputRefIds: ["fund_policy:workspace_authority:v1"],
          sensitivity: "high" as const,
          requiresConfirmation: false,
        })),
      ];
      Object.assign(market.context, {
        analysisMode: "full",
        geography: "us",
        benchmarkPackId: "benchmark_market",
        benchmarkCompatibility: "exact",
      });
      Object.assign(market.versionSnapshot, {
        analysisMode: "full",
        geography: "us",
        benchmarkCompatibility: "exact",
        benchmarkPackId: "benchmark_market",
        benchmarkEntryId: "benchmark_entry_market",
        benchmarkDefinitionFingerprint: `sha256:${"8".repeat(64)}`,
        formulaVersions: ["market_comps_v1@1"],
      });
      const marketCalculationId =
        "calculation:valuation:evidence_pack_authority_market:market_comps_v1:bear_valuation";
      market.calculations = [{
        id: marketCalculationId,
        analysisType: "calculation",
        formulaId: "market_comps_v1",
        formulaVersion: "1",
        inputRefs: [
          {
            itemId: "assumption_benchmark_value",
            value: "100",
            type: "benchmark",
          },
          {
            itemId: "assumption_benchmark_stale",
            value: "2027-01-01",
            type: "benchmark",
          },
          {
            itemId: "assumption_multiplier_bear",
            value: "0.5",
            type: "assumption",
          },
        ],
        output: "50",
        unit: "currency",
        currency: "USD",
        period: "bear",
        roundingPolicy: "half_even_display_only",
        computedAt: NOW,
        status: "completed",
      }];
      market.valuation.status = "partial";
      market.valuation.calculationIds = [marketCalculationId];
      market.valuation.scenarios[0] = {
        name: "bear",
        valuation: "50",
        calculationIds: [marketCalculationId],
      };
      const marketEvidenceIds = [
        "fact_reported_valuation",
        ...market.evidencePack.assumptions.map(({ id }) => id),
      ].sort();
      market.judgments = market.judgments.map((judgment) => ({
        ...judgment,
        unusedEvidenceItemIds: judgment.frameworkCardId
            === "framework_card_synthetic_8_v1"
          ? [...marketEvidenceIds, marketCalculationId].sort()
          : marketEvidenceIds,
      }));
      const marketBuild = {
        ...build,
        pack: market.evidencePack,
        inputFingerprint: MARKET_BUILD_FINGERPRINT,
      };
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", `set role service_role; select public.save_evidence_pack_build(${sqlJson(marketBuild)})`,
      ]), "market evidence build");

      const downgrade = structuredClone(payload) as unknown as {
        context: Record<string, unknown>;
        versionSnapshot: Record<string, unknown>;
        actionDrafts: unknown[];
      } & Record<string, unknown>;
      delete downgrade.context.analysisMode;
      for (const key of [
        "dealStatus", "beliefDirection", "canonicalActions",
        "actionPolicyVersion", "draftPolicyVersion",
        "semanticContextAssumptionPolicyVersion", "semanticContextMappingVersion",
        "analysisMode", "contextVersion", "geography", "benchmarkCompatibility",
      ]) delete downgrade.versionSnapshot[key];
      downgrade.actionDrafts = [];
      const unsafeExternal = structuredClone(payload);
      unsafeExternal.actionDrafts.find((draft) =>
        "format" in draft && draft.format === "founder_email"
      )!.body = "DRAFT ONLY — NOT SENT\nWe passed on the company last year.";
      const badScenarioLineage = structuredClone(payload);
      Object.assign(badScenarioLineage.scenarioModel.scenarios[0]!.inputs[0]!, {
        value: "1",
        unit: "x",
        evidenceItemId: "fact_forged",
        assumptionItemId: null,
        unavailableReason: null,
      });
      const numericUnavailable = structuredClone(payload);
      Object.assign(numericUnavailable.valuation, {
        status: "completed",
        currentAsk: "999999999",
        grossMoic: "100",
      });
      numericUnavailable.valuation.scenarios[0]!.valuation = "999999999";
      const supportiveUnavailable = structuredClone(payload);
      Object.assign(supportiveUnavailable.judgments[0]!, {
        applicability: "applicable",
        conclusion: "supportive",
        strongestSupport: "Forged support.",
      });
      const forgedCalculationOutput = structuredClone(payload);
      forgedCalculationOutput.calculations = [{
        id: "calculation:valuation:evidence_pack_authority:simple_pre_post_ownership_v1:post_money",
        analysisType: "calculation",
        formulaId: "simple_pre_post_ownership_v1",
        formulaVersion: "1",
        inputRefs: [
          {
            itemId: "fact_reported_valuation",
            value: "100",
            type: "fact",
          },
          {
            itemId: "policy:initialCheckMax",
            value: "8000000",
            type: "policy",
          },
        ],
        output: "999999999",
        unit: "currency",
        currency: "USD",
        period: null,
        roundingPolicy: "half_even_display_only",
        computedAt: NOW,
        status: "completed",
      }];
      forgedCalculationOutput.valuation.status = "partial";
      forgedCalculationOutput.valuation.calculationIds = [
        "calculation:valuation:evidence_pack_authority:simple_pre_post_ownership_v1:post_money",
      ];
      forgedCalculationOutput.valuation.scenarios[0] = {
        name: "bear",
        valuation: "999999999",
        calculationIds: [
          "calculation:valuation:evidence_pack_authority:simple_pre_post_ownership_v1:post_money",
        ],
      };
      forgedCalculationOutput.versionSnapshot.formulaVersions = [
        "simple_pre_post_ownership_v1@1",
      ];
      const forgedMarketValue = structuredClone(market);
      forgedMarketValue.calculations[0]!.inputRefs[2]!.value = "0.6";
      forgedMarketValue.calculations[0]!.output = "60";
      forgedMarketValue.valuation.scenarios[0]!.valuation = "60";
      const forgedMarketScenario = structuredClone(market);
      forgedMarketScenario.calculations[0]!.inputRefs[2] = {
        itemId: "assumption_multiplier_bull",
        value: "2",
        type: "assumption",
      };
      forgedMarketScenario.calculations[0]!.output = "200";
      forgedMarketScenario.valuation.scenarios[0]!.valuation = "200";
      const forgedPolicyValue = structuredClone(market);
      const forgedOwnershipId =
        "calculation:valuation:evidence_pack_authority_market:simple_pre_post_ownership_v1:initial_ownership";
      const preciseDecimal = Decimal.clone({ precision: 40 });
      const forgedOwnership = new preciseDecimal("9000000")
        .dividedBy("9000100").toFixed();
      forgedPolicyValue.calculations = [{
        id: forgedOwnershipId,
        analysisType: "calculation",
        formulaId: "simple_pre_post_ownership_v1",
        formulaVersion: "1",
        inputRefs: [
          {
            itemId: "policy:initialCheckMax",
            value: "9000000",
            type: "policy",
          },
          {
            itemId: "fact_reported_valuation",
            value: "100",
            type: "fact",
          },
        ],
        output: forgedOwnership,
        unit: "decimal",
        currency: null,
        period: null,
        roundingPolicy: "half_even_display_only",
        computedAt: NOW,
        status: "completed",
      }];
      forgedPolicyValue.valuation.scenarios = forgedPolicyValue.valuation.scenarios
        .map((scenario) => ({
          ...scenario,
          valuation: null,
          calculationIds: [],
        }));
      forgedPolicyValue.valuation.calculationIds = [forgedOwnershipId];
      forgedPolicyValue.valuation.initialOwnership = forgedOwnership;
      forgedPolicyValue.versionSnapshot.formulaVersions = [
        "simple_pre_post_ownership_v1@1",
      ];
      forgedPolicyValue.judgments = forgedPolicyValue.judgments.map(
        (judgment) => ({
          ...judgment,
          unusedEvidenceItemIds: judgment.frameworkCardId
              === "framework_card_synthetic_8_v1"
            ? [...marketEvidenceIds, forgedOwnershipId].sort()
            : marketEvidenceIds,
        }),
      );
      const forgedFullFramework = structuredClone(market);
      forgedFullFramework.judgments[0]!.unusedEvidenceItemIds.pop();
      const pricing = structuredClone(market);
      const pricingId =
        "calculation:valuation:evidence_pack_authority_market:market_comps_v1:pricing_premium";
      pricing.calculations = [{
        id: pricingId,
        analysisType: "calculation",
        formulaId: "market_comps_v1",
        formulaVersion: "1",
        inputRefs: [
          {
            itemId: "fact_reported_valuation",
            value: "100",
            type: "fact",
          },
          {
            itemId: "assumption_benchmark_value",
            value: "100",
            type: "benchmark",
          },
          {
            itemId: "assumption_benchmark_stale",
            value: "2027-01-01",
            type: "benchmark",
          },
        ],
        output: "0",
        unit: "decimal",
        currency: null,
        period: null,
        roundingPolicy: "half_even_display_only",
        computedAt: NOW,
        status: "completed",
      }];
      pricing.valuation.scenarios = pricing.valuation.scenarios.map(
        (scenario) => ({
          ...scenario,
          valuation: null,
          calculationIds: [],
        }),
      );
      pricing.valuation.calculationIds = [pricingId];
      pricing.valuation.pricingPremium = "0";
      pricing.judgments = pricing.judgments.map((judgment) => ({
        ...judgment,
        unusedEvidenceItemIds: judgment.frameworkCardId
            === "framework_card_synthetic_8_v1"
          ? [...marketEvidenceIds, pricingId].sort()
          : marketEvidenceIds,
      }));
      const forgedPricingRoles = structuredClone(pricing);
      const benchmarkValueRef = forgedPricingRoles.calculations[0]!.inputRefs[1]!;
      forgedPricingRoles.calculations[0]!.inputRefs[1] =
        forgedPricingRoles.calculations[0]!.inputRefs[2]!;
      forgedPricingRoles.calculations[0]!.inputRefs[2] = benchmarkValueRef;
      const forgedScenarioAmbiguity = structuredClone(market);
      forgedScenarioAmbiguity.valuation.scenarios[0]!.calculationIds.push(
        marketCalculationId,
      );
      const forgedValuationDangling = structuredClone(market);
      forgedValuationDangling.valuation.calculationIds.push(
        "calculation:valuation:evidence_pack_authority_market:market_comps_v1:missing",
      );
      const forgedAdvisory = structuredClone(market);
      forgedAdvisory.judgments.push({
        id: "judgment_advisory",
        analysisType: "framework_judgment",
        frameworkCardId: "framework_card_advisory",
        frameworkVersion: "1",
        applicability: "unavailable",
        conclusion: "abstain",
        supportEvidenceItemIds: [],
        counterEvidenceItemIds: [],
        unusedEvidenceItemIds: marketEvidenceIds.slice(1),
        strongestSupport: null,
        strongestCounterargument: null,
        unknowns: ["Advisory applicability is unavailable."],
        limitations: ["Advisory evidence remains incomplete."],
        confidence: {
          sourceReliability: "low",
          evidenceStrength: "low",
          evidenceCoverage: "low",
          applicability: "low",
          judgment: "low",
        },
        claimEdges: [{
          claimItemId: "judgment_advisory",
          dependencyItemId: "framework_card_advisory",
          dependencyType: "framework_ref",
        }],
        frameworkMetadata: {},
        fingerprint: "advisory_fingerprint",
      } as unknown as CandidateFinalization["judgments"][number]);
      const forgedDisagreement = structuredClone(market);
      forgedDisagreement.disagreements = [{
        id: "disagreement_forged",
        leftJudgmentId: "judgment_1",
        rightJudgmentId: "judgment_missing",
        topic: "company_quality_vs_price",
        explanation: "Forged unresolved disagreement.",
        evidenceItemIds: ["fact_reported_valuation"],
      }];
      const forged = [
        downgrade,
        { ...payload, versionSnapshot: { ...payload.versionSnapshot, routerVersion: "context-router-v1" } },
        unsafeExternal,
        { ...payload, context: { ...payload.context, asOfDate: "2026-08-02" } },
        { ...payload, scenarioModel: { ...payload.scenarioModel, formulaPolicyVersion: "valuation_forged" } },
        badScenarioLineage,
        { ...payload, decision: { ...payload.decision, decision: "Invest Candidate", decisionCeiling: "Invest Candidate", confidence: "high" } },
        numericUnavailable,
        supportiveUnavailable,
        forgedCalculationOutput,
        forgedMarketValue,
        forgedMarketScenario,
        forgedPolicyValue,
        forgedFullFramework,
        forgedPricingRoles,
        forgedScenarioAmbiguity,
        forgedValuationDangling,
        forgedAdvisory,
        forgedDisagreement,
      ];
      for (const candidate of forged) {
        const rejected = postgres.run("psql", [
          "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
          "-c", `set role service_role; select public.finalize_or_reuse_candidate_underwriting(${sqlJson(candidate)})`,
        ]);
        assert.notEqual(rejected.status, 0, "forged Task 9 payload unexpectedly finalized");
        assert.match(
          rejected.stderr,
          candidate === forgedCalculationOutput
            ? /Task 9 authorized Calculation output failed recomputation|Task 9 ownership Calculation inputs are invalid/iu
            : candidate === forgedMarketValue
            ? /Task 9 Calculation Assumption input value is not authoritative/iu
            : candidate === forgedMarketScenario
            ? /Task 9 market scenario Calculation input order is invalid/iu
            : candidate === forgedPolicyValue
            ? /Calculation input .* does not resolve/iu
            : candidate === forgedFullFramework
            ? /Task 9 formal framework evidence partition is invalid/iu
            : candidate === forgedPricingRoles
            ? /Task 9 pricing-premium Calculation input order is invalid/iu
            : candidate === forgedScenarioAmbiguity
            ? /Task 9 valuation scenario matrix is ambiguous/iu
            : candidate === forgedValuationDangling
            ? /Task 9 valuation Calculation reference is dangling/iu
            : candidate === forgedAdvisory
            ? /Task 9 formal framework evidence partition is invalid/iu
            : candidate === forgedDisagreement
            ? /Task 9 framework disagreement shape or lineage is invalid/iu
            : /Task 9|current V2|lineage|terminal|status-safe/iu,
        );
        assert.equal(success(postgres.run("psql", [
          "--no-password", "-At", "-d", database,
          "-c", "select status || '|' || (select count(*) from public.evidence_packs) from public.candidate_runs where id='candidate_authority'",
        ]), "post-rejection mutation check").split("\n").at(-1), "running|0");
      }

      const partial = structuredClone(payload);
      partial.workerId = "worker_partial";
      partial.leaseToken = "lease_partial";
      partial.candidateRunId = "candidate_partial";
      partial.candidateAnalysisFingerprint = `sha256:${"b".repeat(64)}`;
      Object.assign(partial.context, {
        analysisMode: "full",
        geography: "us",
        benchmarkPackId: "benchmark_partial",
        benchmarkCompatibility: "exact",
      });
      Object.assign(partial.versionSnapshot, {
        analysisMode: "full",
        geography: "us",
        benchmarkCompatibility: "exact",
        benchmarkPackId: "benchmark_partial",
        benchmarkEntryId: "benchmark_entry_partial",
        benchmarkDefinitionFingerprint: `sha256:${"8".repeat(64)}`,
        formulaVersions: [],
      });
      partial.scenarioModel.candidateRunId = "candidate_partial";
      partial.valuation.status = "partial";
      partial.valuation.currentAsk = "100";
      partial.actionDrafts = partial.actionDrafts.map((draft) => ({
        ...draft,
        id: draft.id.replace("candidate_authority", "candidate_partial"),
        candidateRunId: "candidate_partial",
      }));
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", `insert into public.underwriting_batches(id,workspace_id,scan_run_id,status,batch_input_fingerprint,fund_policy_snapshot_id,force_refresh) values ('batch_partial','workspace_authority','00000000-0000-4000-8000-000000000022','running','sha256:${"9".repeat(64)}','fund_policy:workspace_authority:v1',false); insert into public.candidate_runs(id,batch_id,workspace_id,deal_id,status,candidate_analysis_fingerprint,worker_id,lease_token,lease_expires_at) values ('candidate_partial','batch_partial','workspace_authority','deal_authority','running','pending:partial','worker_partial','lease_partial',now()+interval '5 minutes')`,
      ]), "partial terminal fixture");
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", `set role service_role; select public.finalize_or_reuse_candidate_underwriting(${sqlJson(partial)})`,
      ]), "lineage-backed partial valuation with unavailable decision");

      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", `set role service_role; select public.finalize_or_reuse_candidate_underwriting(${sqlJson(payload)})`,
      ]), "valid current V2 finalization");
      success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
        "-c", `insert into public.underwriting_batches(id,workspace_id,scan_run_id,status,batch_input_fingerprint,fund_policy_snapshot_id,force_refresh,refresh_nonce,rerun_of_id) values ('batch_authority_rerun','workspace_authority','00000000-0000-4000-8000-000000000022','running','sha256:${"1".repeat(64)}','fund_policy:workspace_authority:v1',true,'task9-rerun','batch_authority'); insert into public.candidate_runs(id,batch_id,workspace_id,deal_id,status,candidate_analysis_fingerprint,rerun_of_id,worker_id,lease_token,lease_expires_at) values ('candidate_authority_rerun','batch_authority_rerun','workspace_authority','deal_authority','running','pending:rerun','candidate_authority','worker_rerun','lease_rerun',now()+interval '5 minutes')`,
      ]), "rerun fixture");
      const reused = JSON.parse(success(postgres.run("psql", [
        "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
        "-c", `set role service_role; select public.finalize_or_reuse_candidate_underwriting(${sqlJson({
          workerId: "worker_rerun",
          leaseToken: "lease_rerun",
          candidateRunId: "candidate_authority_rerun",
          candidateAnalysisFingerprint: payload.candidateAnalysisFingerprint,
        })})`,
      ]), "immutable rerun reuse").split("\n").at(-1) ?? "null") as Record<string, unknown>;
      assert.equal(reused.status, "completed");
      assert.equal(success(postgres.run("psql", [
        "--no-password", "-At", "-d", database,
        "-c", "select artifact_source_candidate_run_id from public.candidate_runs where id='candidate_authority_rerun'",
      ]), "rerun alias").split("\n").at(-1), "candidate_authority");
      assert.equal(success(postgres.run("psql", [
        "--no-password", "-At", "-d", database,
        "-c", [
          "select",
          "(select count(*) from public.decision_critical_evidence_projections) +",
          "(select count(*) from public.named_lens_passage_attempt_events) +",
          "(select count(*) from public.named_lens_dispositions) +",
          "(select count(*) from public.named_lens_passages) +",
          "(select count(*) from public.named_lens_passage_segments) +",
          "(select count(*) from public.underwriting_presentations)",
        ].join(" "),
      ]), "legacy Task 9 Named Lens row isolation").split("\n").at(-1), "0");
    } finally {
      success(postgres.run("dropdb", ["--if-exists", database]), "database cleanup");
    }
  },
);
