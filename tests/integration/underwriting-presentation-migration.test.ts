import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { ScenarioInputFieldSchema } from "../../lib/contracts/underwriting";
import { createActionDraftGenerator } from "../../lib/underwriting/action-drafts";
import { actionsForDealStatusAndDirection } from "../../lib/reports/action-policy";
import { SYNTHETIC_FRAMEWORK_PACK } from "../../seed/underwriting/framework-pack-v1";
import {
  makeDisposableDatabaseName,
  requireLoopbackPostgres,
  type VerifiedLoopbackPostgresContext,
} from "../helpers/require-loopback-postgres";

const migrationName = "0027_named_lens_passages.sql";
const migrationPath = fileURLToPath(new URL(
  `../../drizzle/${migrationName}`,
  import.meta.url,
));
const migrationDirectory = fileURLToPath(new URL(
  "../../drizzle/",
  import.meta.url,
));
const journalPath = fileURLToPath(new URL(
  "../../drizzle/meta/_journal.json",
  import.meta.url,
));
const postgres = requireLoopbackPostgres();
const postgresVersion = postgres.state === "verified"
  ? postgres.run("psql", [
    "--no-password",
    "-d",
    "postgres",
    "-Atqc",
    "show server_version_num",
  ])
  : null;
const postgres17SkipReason = postgres.state === "skipped"
  ? postgres.reason
  : postgresVersion?.status !== 0
      || Number(postgresVersion.stdout.trim()) < 170000
    ? "The full migration chain requires PostgreSQL 17 or newer."
    : false;

const NOW = "2026-08-03T12:00:00.000Z";
const BUILD_FINGERPRINT = sha("e");

function sha(digit: string): string {
  return `sha256:${digit.repeat(64)}`;
}

function indexedSha(index: number): string {
  return `sha256:${index.toString(16).padStart(64, "0")}`;
}

function sqlJson(value: unknown): string {
  return `$json$${JSON.stringify(value)}$json$::jsonb`;
}

function success(
  result: ReturnType<VerifiedLoopbackPostgresContext["run"]>,
  operation: string,
): string {
  assert.equal(result.status, 0, `${operation} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function runMigrations(
  context: VerifiedLoopbackPostgresContext,
  database: string,
): void {
  success(context.run("psql", [
    "--no-password",
    "-v",
    "ON_ERROR_STOP=1",
    "-d",
    database,
    "-c",
    "create extension if not exists pgcrypto",
  ]), "pgcrypto creation");
  success(context.run("psql", [
    "--no-password",
    "-v",
    "ON_ERROR_STOP=1",
    "-d",
    database,
    "-c",
    [
      "do $$ begin",
      "if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;",
      "if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;",
      "if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;",
      "end $$",
    ].join(" "),
  ]), "API roles");
  for (const migration of readdirSync(migrationDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort()) {
    success(context.run("psql", [
      "--no-password",
      "-v",
      "ON_ERROR_STOP=1",
      "-d",
      database,
      "-f",
      `${migrationDirectory}/${migration}`,
    ]), `migration ${migration}`);
  }
}

function psql(
  context: VerifiedLoopbackPostgresContext,
  database: string,
  sql: string,
  operation = "presentation assertion",
): string {
  return success(context.run("psql", [
    "--no-password",
    "-v",
    "ON_ERROR_STOP=1",
    "-d",
    database,
    "-At",
    "-c",
    sql,
  ]), operation);
}

function rejected(
  context: VerifiedLoopbackPostgresContext,
  database: string,
  sql: string,
  pattern: RegExp,
  operation: string,
): void {
  const result = context.run("psql", [
    "--no-password",
    "-v",
    "ON_ERROR_STOP=1",
    "-d",
    database,
    "-c",
    sql,
  ]);
  assert.notEqual(result.status, 0, `${operation} unexpectedly succeeded.`);
  assert.match(result.stderr, pattern, operation);
}

function basePayload(candidateRunId = "candidate_named_lens") {
  const actions = actionsForDealStatusAndDirection("screening", "positive");
  const missingEvidence = [{
    fieldId: "arr",
    label: "arr",
    externalLabel: "arr",
    reasonCode: "MISSING_CRITICAL_EVIDENCE",
    mostLikelyDecisionImpact:
      "Providing accepted evidence may raise or lower the formal decision ceiling.",
  }];
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
  const facts = [
    {
      id: "fact_counter",
      analysisType: "fact",
      provenanceOrigin: "management",
      field: "customer_counterevidence",
      value: "Retention remains unverified",
      unit: "text",
      currency: null,
      periodStart: null,
      periodEnd: null,
      publishedAt: null,
      eventAt: null,
      retrievedAt: NOW,
      sourceRevisionId: "revision_named_lens",
      locator: {
        kind: "text_range",
        start: 15,
        end: 35,
        excerpt: "Retention remains unverified",
      },
      sourceRole: "management",
      assertionStatus: "reported",
      verificationMethod: null,
      freshness: "current",
      acceptedForGate: true,
    },
    {
      id: "fact_support",
      analysisType: "fact",
      provenanceOrigin: "management",
      field: "customer_support",
      value: "Customers renewed",
      unit: "text",
      currency: null,
      periodStart: null,
      periodEnd: null,
      publishedAt: null,
      eventAt: null,
      retrievedAt: NOW,
      sourceRevisionId: "revision_named_lens",
      locator: {
        kind: "text_range",
        start: 0,
        end: 14,
        excerpt: "Customers renewed",
      },
      sourceRole: "management",
      assertionStatus: "reported",
      verificationMethod: null,
      freshness: "current",
      acceptedForGate: true,
    },
  ];
  const formalJudgments = SYNTHETIC_FRAMEWORK_PACK.cards.map((card, index) => ({
    id: `judgment_formal_${index + 1}`,
    analysisType: "framework_judgment",
    frameworkCardId: card.id,
    frameworkVersion: card.version,
    applicability: "unavailable",
    conclusion: "abstain",
    supportEvidenceItemIds: [],
    counterEvidenceItemIds: [],
    unusedEvidenceItemIds: ["fact_counter", "fact_support"],
    strongestSupport: null,
    strongestCounterargument: null,
    unknowns: ["Geography is unavailable."],
    limitations: [
      "Core-only analysis cannot establish framework applicability while geography is unavailable.",
    ],
    confidence: {
      sourceReliability: "low",
      evidenceStrength: "low",
      evidenceCoverage: "low",
      applicability: "low",
      judgment: "low",
    },
    claimEdges: [{
      claimItemId: `judgment_formal_${index + 1}`,
      dependencyItemId: card.id,
      dependencyType: "framework_ref",
    }],
    fingerprint: `framework-abstention-${index + 1}`,
  }));
  const advisoryJudgments = ["a", "b", "c", "d"].map((suffix) => ({
    id: `judgment_advisory_${suffix}`,
    analysisType: "framework_judgment",
    frameworkCardId: `research_composite_${suffix}`,
    frameworkVersion: "research-framework-v1",
    applicability: "applicable",
    conclusion: suffix === "b" || suffix === "d" ? "negative" : "supportive",
    supportEvidenceItemIds: ["fact_support"],
    counterEvidenceItemIds: ["fact_counter"],
    unusedEvidenceItemIds: [],
    strongestSupport: "Saved customer evidence supports the bounded reading.",
    strongestCounterargument: "Saved counterevidence limits the reading.",
    unknowns: [`Unknown ${suffix}`],
    limitations: [`Limitation ${suffix}`],
    confidence: {
      sourceReliability: "high",
      evidenceStrength: "high",
      evidenceCoverage: "high",
      applicability: "high",
      judgment: "high",
    },
    claimEdges: [
      {
        claimItemId: `judgment_advisory_${suffix}`,
        dependencyItemId: `research_composite_${suffix}`,
        dependencyType: "framework_ref",
      },
      {
        claimItemId: `judgment_advisory_${suffix}`,
        dependencyItemId: "fact_support",
        dependencyType: "fact",
      },
      {
        claimItemId: `judgment_advisory_${suffix}`,
        dependencyItemId: "fact_counter",
        dependencyType: "fact",
      },
    ],
    counterevidenceBoundary: {
      kind: "grounded_counterevidence",
      evidenceRequestRefs: [],
    },
    frameworkMetadata: {
      formalDecisionWeight: "0",
      componentCardIds: [`research_component_${suffix}`],
      components: [{
        frameworkId: `research_component_${suffix}`,
        version: "1",
        decisionQuestions: ["Is customer demand durable?"],
        sourceRefs: [{
          sourceId: `public_source_${suffix}`,
          claimIds: [`claim_${suffix}`],
          locator: { kind: "web_section", value: `Section ${suffix}` },
          attributionScope: "institution_doctrine",
        }],
      }],
      sources: [{ sourceId: `public_source_${suffix}` }],
    },
    fingerprint: `advisory-${suffix}`,
  }));
  const decision = {
    id: "decision_named_lens",
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
  const actionDrafts = createActionDraftGenerator({
    workspaceId: "workspace_named_lens",
    now: () => new Date(NOW),
  }).generate({
    candidateRunId,
    decision,
    missingEvidence,
    dealStatus: "screening",
    beliefDirection: "positive",
    actions,
    judgments: formalJudgments as never[],
    disagreements: [],
  });
  return {
    workerId: "worker_named_lens",
    leaseToken: "lease_named_lens",
    candidateRunId,
    candidateAnalysisFingerprint: sha("a"),
    evidencePackBuildInputFingerprint: BUILD_FINGERPRINT,
    evidencePack: {
      id: "evidence_pack_named_lens",
      version: 1,
      workspaceId: "workspace_named_lens",
      dealId: "deal_named_lens",
      asOfDate: "2026-08-03",
      sourceRevisionIds: ["revision_named_lens"],
      facts,
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
      id: "context_named_lens",
      contextVersion: "1",
      analysisMode: "core_only",
      stage: "seed",
      businessModel: "b2b_saas",
      geography: "unavailable",
      securityType: "preferred",
      asOfDate: "2026-08-03",
      criticalEvidenceProfileId: "critical_named_lens",
      benchmarkPackId: null,
      benchmarkCompatibility: "unavailable",
      valuationMethodPolicyId: "valuation_named_lens",
      decisionPolicyId: "decision_named_lens_policy",
      frameworkPackId: SYNTHETIC_FRAMEWORK_PACK.id,
    },
    scenarioModel: {
      id: "scenario_named_lens",
      candidateRunId,
      formulaPolicyVersion: "valuation_named_lens",
      scenarios: (["bear", "base", "bull"] as const).map((name) => ({
        name,
        inputs: scenarioInputs(name),
      })),
      probabilityWeighted: false,
    },
    calculations: [],
    calculationClaimEdges: [],
    judgments: [...formalJudgments, ...advisoryJudgments],
    disagreements: [],
    valuation: {
      id: "valuation_named_lens_result",
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
    actionDrafts,
    versionSnapshot: {
      fundPolicyId: "fund_policy:workspace_named_lens:v1",
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
      frameworkPackDefinitionFingerprint: sha("2"),
      routerVersion: "context-router-v2",
      criticalEvidenceProfileId: "critical_named_lens",
      criticalEvidenceProfileDefinitionFingerprint: sha("3"),
      valuationMethodPolicyId: "valuation_named_lens",
      valuationMethodPolicyDefinitionFingerprint: sha("4"),
      decisionPolicyId: "decision_named_lens_policy",
      decisionPolicyDefinitionFingerprint: sha("5"),
      referenceCatalogFingerprint: sha("6"),
      frameworkCatalogVersion: "research-framework-catalog-v2",
      frameworkCatalogFingerprint: sha("7"),
      frameworkCorpusDigest: sha("8"),
      formulaVersions: [],
      providerModel: "deterministic-migration-fixture",
      promptVersion: "underwriting-prompt-v2",
      schemaVersion: "underwriting-schema-v2",
      settingsFingerprint: sha("9"),
      applicationCommit: "task5-migration-test",
      companyAnalysisUnknowns: [],
      namedLensSelectionPolicyVersion: "named-lens-selection-v1",
      namedLensPassageSchemaVersion: "named-lens-passage-v1",
      namedLensGeneratorVersion: "named-lens-generator-v1",
      underwritingPresentationSchemaVersion: "decision-first-named-lens-v1",
      decisionTaxonomyVersion: "named-lens-decision-taxonomy-v1",
    },
  };
}

function currentPayload(candidateRunId = "candidate_named_lens") {
  const payload = basePayload(candidateRunId);
  const projection = {
    id: `decision_critical_projection_${candidateRunId}`,
    workspaceId: "workspace_named_lens",
    artifactSourceCandidateRunId: candidateRunId,
    evidenceRefs: [{
      evidencePackItemId: "fact_support",
      classification: "fact",
      originRefs: [{ kind: "fired_rule", id: "rule_customer_support" }],
      reasonCodes: ["FORMAL_DECISION_RULE_INPUT"],
      resolutionPath: ["fact_support", "rule_customer_support"],
    }],
    fingerprint: sha("c"),
  };
  const catalog = ["a", "b", "c", "d"].map((suffix, index) => ({
    workspaceId: "workspace_named_lens",
    artifactSourceCandidateRunId: candidateRunId,
    judgmentOrCatalogCandidateId: `judgment_advisory_${suffix}`,
    judgmentId: `judgment_advisory_${suffix}`,
    frameworkCardId: `research_composite_${suffix}`,
    frameworkVersion: "research-framework-v1",
    initialDisposition: "judgment_eligible",
    reasonCodes: ["JUDGMENT_ELIGIBLE"],
    fingerprint: sha(String(index + 5)),
  }));
  const passages = ["a", "b", "c", "d"].map((suffix, index) => ({
    schemaVersion: "named-lens-passage-v1",
    workspaceId: "workspace_named_lens",
    artifactSourceCandidateRunId: candidateRunId,
    judgmentId: `judgment_advisory_${suffix}`,
    frameworkCardId: `research_composite_${suffix}`,
    frameworkVersion: "research-framework-v1",
    decisionQuestionCode: "customer_adoption",
    evidenceDomainCodes: ["customer"],
    premise: {
      text: "The public framework tests whether demand is durable.",
      componentFrameworkId: `research_component_${suffix}`,
      componentVersion: "1",
      cardFieldRef: "decisionQuestions[0]",
      publicSourceIds: [`public_source_${suffix}`],
      claimIds: [`claim_${suffix}`],
      locator: { kind: "web_section", value: `Section ${suffix}` },
      attributionScope: "institution_doctrine",
    },
    caseApplication: {
      text: "Saved company evidence supports a bounded application.",
      evidenceItemIds: ["fact_support"],
    },
    countercase: {
      text: "Saved counterevidence limits the conclusion.",
      boundaryKind: "grounded_counterevidence",
      evidenceItemIds: ["fact_counter"],
      evidenceRequestRefs: [],
    },
    unknownBoundary: {
      text: "A saved unknown defines the diligence boundary.",
      judgmentUnknownRefs: [`Unknown ${suffix}`],
      judgmentLimitationRefs: [`Limitation ${suffix}`],
      evidenceRequestRefs: [],
    },
    conditionalConclusion: {
      text: "The view remains conditional on resolving the saved unknown.",
      stance: index % 2 === 0 ? "supportive" : "negative",
      advisoryPosture: index % 2 === 0
        ? "supports_further_diligence"
        : "urges_caution",
    },
    advisoryContract: {
      formalDecisionWeight: "0",
      noEndorsement: true,
      namedPersonImpersonation: false,
      hiddenChainOfThought: false,
    },
    selectionBasisEvidenceIds: ["fact_support"],
    wordCount: 45,
    generatorVersion: "named-lens-generator-v1",
    fingerprint: sha(String(index + 1)),
  }));
  const dispositions = passages.map((passage, index) => ({
    workspaceId: "workspace_named_lens",
    artifactSourceCandidateRunId: candidateRunId,
    judgmentOrCatalogCandidateId: passage.judgmentId,
    judgmentId: passage.judgmentId,
    frameworkCardId: passage.frameworkCardId,
    frameworkVersion: passage.frameworkVersion,
    disposition: "selected_main",
    selectedPosition: index + 1,
    priorityTier: "changed_belief",
    reasonCodes: ["CHANGED_BELIEF_EVIDENCE"],
    decisionQuestionCode: passage.decisionQuestionCode,
    stance: passage.conditionalConclusion.stance,
    advisoryPosture: passage.conditionalConclusion.advisoryPosture,
    selectionBasisEvidenceIds: passage.selectionBasisEvidenceIds,
    criticalEvidence: projection.evidenceRefs,
    decisionCriticalEvidenceProjectionId: projection.id,
    decisionCriticalEvidenceProjectionFingerprint: projection.fingerprint,
    selectionPolicyVersion: "named-lens-selection-v1",
    passageFingerprint: passage.fingerprint,
    fingerprint: sha(String(index + 5)),
  }));
  const attemptRefs = passages.map((passage, index) => ({
    judgmentOrCatalogCandidateId: passage.judgmentId,
    logicalPassageId:
      `${passage.judgmentId}@named-lens-passage-v1@named-lens-generator-v1`,
    attemptNumber: 1,
    attemptFingerprint: sha(String(index + 1)),
  }));
  return {
    ...payload,
    namedLensCatalogConsiderations: catalog,
    decisionCriticalEvidenceProjection: projection,
    namedLensAttemptRefs: attemptRefs,
    namedLensDispositions: dispositions,
    namedLensPassages: passages,
    underwritingPresentationReportId: "report_named_lens",
    namedLensPresentation: {
      schemaVersion: "decision-first-named-lens-v1",
      rendererVersion: "named-lens-renderer-v1",
      workspaceId: "workspace_named_lens",
      artifactSourceCandidateRunId: candidateRunId,
      synthesis: {
        branch: "principal_disagreement",
        text: "The selected readings disagree on customer adoption.",
        judgmentIds: passages.map(({ judgmentId }) => judgmentId),
        evidenceItemIds: ["fact_support"],
      },
      segmentCitations: passages.map((passage) => ({
        judgmentId: passage.judgmentId,
        segment: "case_application",
        evidenceItemIds: ["fact_support"],
        publicSourceIds: [],
        claimIds: [],
        judgmentUnknownRefs: [],
        judgmentLimitationRefs: [],
        evidenceRequestRefs: [],
        stanceRefs: [],
        advisoryPostureRefs: [],
      })),
      firstScreenProjectionRefs: {
        decisionId: "decision_named_lens",
        decisionEvidenceItemIds: [],
        selectedJudgmentIds: passages.map(({ judgmentId }) => judgmentId),
      },
      fingerprint: sha("f"),
    },
    terminalStatus: "completed",
    terminalReasonCodes: [],
  };
}

function forCandidate(
  source: ReturnType<typeof currentPayload>,
  input: {
    candidateRunId: string;
    workerId: string;
    leaseToken: string;
    fingerprint: string;
  },
) {
  const value = structuredClone(source);
  value.workerId = input.workerId;
  value.leaseToken = input.leaseToken;
  value.candidateRunId = input.candidateRunId;
  value.candidateAnalysisFingerprint = input.fingerprint;
  value.scenarioModel.candidateRunId = input.candidateRunId;
  value.actionDrafts = value.actionDrafts.map((draft) => ({
    ...draft,
    id: `${draft.id}:${input.candidateRunId}`,
    candidateRunId: input.candidateRunId,
  }));
  value.decisionCriticalEvidenceProjection.id =
    `decision_critical_projection_${input.candidateRunId}`;
  value.decisionCriticalEvidenceProjection.artifactSourceCandidateRunId =
    input.candidateRunId;
  value.namedLensCatalogConsiderations =
    value.namedLensCatalogConsiderations.map((item) => ({
      ...item,
      artifactSourceCandidateRunId: input.candidateRunId,
    }));
  value.namedLensDispositions = value.namedLensDispositions.map((item) => ({
    ...item,
    artifactSourceCandidateRunId: input.candidateRunId,
    decisionCriticalEvidenceProjectionId:
      value.decisionCriticalEvidenceProjection.id,
  }));
  value.namedLensPassages = value.namedLensPassages.map((item) => ({
    ...item,
    artifactSourceCandidateRunId: input.candidateRunId,
  }));
  value.namedLensPresentation.artifactSourceCandidateRunId =
    input.candidateRunId;
  return value;
}

function attemptPayloads(payload: ReturnType<typeof currentPayload>) {
  return payload.namedLensAttemptRefs.map((reference) => ({
    workerId: payload.workerId,
    leaseToken: payload.leaseToken,
    workspaceId: "workspace_named_lens",
    artifactSourceCandidateRunId: payload.candidateRunId,
    judgmentOrCatalogCandidateId: reference.judgmentOrCatalogCandidateId,
    logicalPassageId: reference.logicalPassageId,
    attemptNumber: reference.attemptNumber,
    attemptFingerprint: reference.attemptFingerprint,
  }));
}

function reserveAndSettleAttempts(
  context: VerifiedLoopbackPostgresContext,
  database: string,
  payload: ReturnType<typeof currentPayload>,
  settlement: "completed" | "failed" = "completed",
): void {
  for (const attempt of attemptPayloads(payload)) {
    psql(
      context,
      database,
      `set role service_role; select public.reserve_named_lens_passage_attempt(${sqlJson(attempt)})`,
      "reserve Named Lens passage attempt",
    );
    psql(
      context,
      database,
      `set role service_role; select public.settle_named_lens_passage_attempt(${sqlJson({
        ...attempt,
        status: settlement,
        telemetry: settlement === "completed"
          ? {
            inputTokens: 100,
            outputTokens: 50,
            costUsd: "0.01",
            latencyMs: 100,
          }
          : null,
        failureReason: settlement === "failed"
          ? {
            code: "budget_exhausted",
            detail: "The provider retry budget was exhausted.",
            retryable: false,
          }
          : null,
      })})`,
      "settle Named Lens passage attempt",
    );
  }
}

function fixtureSetup(
  context: VerifiedLoopbackPostgresContext,
  database: string,
): void {
  psql(context, database, [
    "insert into public.workspaces(id,name) values ('workspace_named_lens','Named Lens')",
    "insert into public.scan_runs(id,workspace_id,mode,status) values ('00000000-0000-4000-8000-000000000027','workspace_named_lens','structured','completed')",
    "select public.activate_fund_policy_version(jsonb_build_object('workspaceId','workspace_named_lens','actorId',null,'expectedActiveVersionId',null,'action','recommended'))",
    "insert into public.companies(id,workspace_id,name) values ('company_named_lens','workspace_named_lens','Named Lens Co')",
    "insert into public.deals(id,workspace_id,company_id,company_name,status) values ('deal_named_lens','workspace_named_lens','company_named_lens','Named Lens Co','screening')",
    "insert into public.intelligence_reports(id,workspace_id,run_id,market_summary,analysis_status) values ('report_named_lens','workspace_named_lens','00000000-0000-4000-8000-000000000027','Named Lens report','completed')",
    "insert into public.company_analyses(id,workspace_id,report_id,run_id,deal_id,company_name,deal_status,outcome,confidence,score,investment_memory,market_evidence,implications,recommended_next_move,company_brief,source_refs) values ('analysis_named_lens','workspace_named_lens','report_named_lens','00000000-0000-4000-8000-000000000027','deal_named_lens','Named Lens Co','screening','belief_revised','medium',1,'{}'::jsonb,'{}'::jsonb,'{\"positive\":[],\"negative\":[]}'::jsonb,'Advance diligence','{\"structuredFields\":[]}'::jsonb,'[]'::jsonb)",
    "insert into public.source_documents(id,filename,title,role,company_name,deal_id,checksum,byte_size,object_key) values ('source_named_lens','named-lens.md','Named Lens','deal_document','Named Lens Co','deal_named_lens','checksum',1,'private/named-lens.md')",
    `insert into public.source_revisions(id,workspace_id,source_id,revision,content_hash,object_key,object_version,content_type,extractor_id,extractor_version,extracted_at,created_at) values ('revision_named_lens','workspace_named_lens','source_named_lens',1,'${sha("d")}','private/named-lens.md','object:v1','text/markdown','plain_text_v1','1','${NOW}','${NOW}')`,
    `insert into public.underwriting_batches(id,workspace_id,scan_run_id,status,batch_input_fingerprint,fund_policy_snapshot_id,force_refresh) values ('batch_named_lens','workspace_named_lens','00000000-0000-4000-8000-000000000027','running','${sha("1")}','fund_policy:workspace_named_lens:v1',false)`,
    "insert into public.candidate_runs(id,batch_id,workspace_id,deal_id,status,candidate_analysis_fingerprint,worker_id,lease_token,lease_expires_at) values ('candidate_named_lens','batch_named_lens','workspace_named_lens','deal_named_lens','running','pending:candidate_named_lens','worker_named_lens','lease_named_lens',now()+interval '15 minutes')",
  ].join("; "), "presentation fixture setup");
  const payload = basePayload();
  psql(
    context,
    database,
    `set role service_role; select public.save_evidence_pack_build(${sqlJson({
      pack: payload.evidencePack,
      inputFingerprint: BUILD_FINGERPRINT,
      sourceRevisionSnapshots: [{
        id: "revision_named_lens",
        workspaceId: "workspace_named_lens",
        sourceId: "source_named_lens",
        revision: 1,
        contentHash: sha("d"),
        objectKey: "private/named-lens.md",
        objectVersion: "object:v1",
        contentType: "text/markdown",
        extractorId: "plain_text_v1",
        extractorVersion: "1",
        extractedAt: NOW,
        supersedesRevisionId: null,
        createdAt: NOW,
      }],
    })})`,
    "exact evidence build",
  );
}

function insertCandidate(
  context: VerifiedLoopbackPostgresContext,
  database: string,
  input: {
    batchId: string;
    candidateRunId: string;
    workerId: string;
    leaseToken: string;
    batchFingerprint: string;
    rerunOfId?: string;
    rerunOfBatchId?: string;
    refreshNonce?: string;
  },
): void {
  const refresh = input.refreshNonce === undefined
    ? "false,null,null"
    : `true,'${input.refreshNonce}','${input.rerunOfBatchId}'`;
  psql(context, database, [
    [
      "insert into public.underwriting_batches(id,workspace_id,scan_run_id,status,batch_input_fingerprint,fund_policy_snapshot_id,force_refresh,refresh_nonce,rerun_of_id)",
      `values ('${input.batchId}','workspace_named_lens','00000000-0000-4000-8000-000000000027','running','${input.batchFingerprint}','fund_policy:workspace_named_lens:v1',${refresh})`,
    ].join(" "),
    [
      "insert into public.candidate_runs(id,batch_id,workspace_id,deal_id,status,candidate_analysis_fingerprint,rerun_of_id,worker_id,lease_token,lease_expires_at)",
      `values ('${input.candidateRunId}','${input.batchId}','workspace_named_lens','deal_named_lens','running','pending:${input.candidateRunId}',${input.rerunOfId === undefined ? "null" : `'${input.rerunOfId}'`},'${input.workerId}','${input.leaseToken}',now()+interval '15 minutes')`,
    ].join(" "),
  ].join("; "), `candidate fixture ${input.candidateRunId}`);
}

test("0027 is the next local-only Named Lens presentation migration", () => {
  assert.equal(existsSync(migrationPath), true);
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: Array<{ idx: number; version: string; tag: string }>;
  };
  assert.deepEqual(journal.entries.at(-1), {
    idx: 27,
    version: "7",
    when: 1786356000000,
    tag: "0027_named_lens_passages",
    breakpoints: true,
  });
  const launcher = readFileSync(fileURLToPath(new URL(
    "../../scripts/apply-production-migrations.zsh",
    import.meta.url,
  )), "utf8");
  assert.doesNotMatch(launcher, /0027_named_lens_passages/u);
});

test(
  "0027 creates owner-controlled append-only presentation tables and attempt RPCs",
  { skip: postgres17SkipReason },
  () => {
    assert.equal(postgres.state, "verified");
    if (postgres.state !== "verified") return;
    const database = makeDisposableDatabaseName("named_lens_schema");
    success(postgres.run("createdb", [database]), "database creation");
    try {
      runMigrations(postgres, database);
      const tables = psql(postgres, database, [
        "select string_agg(tablename, ',' order by tablename)",
        "from pg_catalog.pg_tables",
        "where schemaname='public' and tablename = any(array[",
        "'decision_critical_evidence_projections',",
        "'named_lens_passage_attempt_events',",
        "'named_lens_dispositions','named_lens_passages',",
        "'named_lens_passage_segments','underwriting_presentations'])",
      ].join(" "));
      assert.equal(tables, [
        "decision_critical_evidence_projections",
        "named_lens_dispositions",
        "named_lens_passage_attempt_events",
        "named_lens_passage_segments",
        "named_lens_passages",
        "underwriting_presentations",
      ].join(","));
      assert.equal(psql(postgres, database, [
        "select count(*) from pg_catalog.pg_class table_class",
        "join pg_catalog.pg_roles owner on owner.oid=table_class.relowner",
        "where table_class.relnamespace='public'::regnamespace",
        "and table_class.relname = any(array[",
        "'decision_critical_evidence_projections',",
        "'named_lens_passage_attempt_events',",
        "'named_lens_dispositions','named_lens_passages',",
        "'named_lens_passage_segments','underwriting_presentations'])",
        "and owner.rolname='vsee_underwriting_owner'",
        "and table_class.relrowsecurity",
      ].join(" ")), "6");
      assert.equal(psql(postgres, database, [
        "select count(*) from pg_catalog.pg_trigger",
        "where tgrelid = any(array[",
        "'public.decision_critical_evidence_projections'::regclass,",
        "'public.named_lens_passage_attempt_events'::regclass,",
        "'public.named_lens_dispositions'::regclass,",
        "'public.named_lens_passages'::regclass,",
        "'public.named_lens_passage_segments'::regclass,",
        "'public.underwriting_presentations'::regclass])",
        "and not tgisinternal",
        "and pg_catalog.pg_get_triggerdef(oid) like '%reject_immutable_underwriting_artifact%'",
      ].join(" ")), "6");
      assert.equal(psql(postgres, database, [
        "select count(*) from pg_catalog.pg_trigger",
        "where tgrelid = any(array[",
        "'public.decision_critical_evidence_projections'::regclass,",
        "'public.named_lens_passage_attempt_events'::regclass,",
        "'public.named_lens_dispositions'::regclass,",
        "'public.named_lens_passages'::regclass,",
        "'public.named_lens_passage_segments'::regclass,",
        "'public.underwriting_presentations'::regclass])",
        "and not tgisinternal",
        "and pg_catalog.pg_get_triggerdef(oid) like '%assert_named_lens_candidate_owner_0027%'",
      ].join(" ")), "6");
      assert.equal(psql(postgres, database, [
        "select count(*) from pg_catalog.pg_constraint constraint_record",
        "where constraint_record.contype='f'",
        "and constraint_record.confrelid='public.candidate_runs'::regclass",
        "and constraint_record.conrelid = any(array[",
        "'public.decision_critical_evidence_projections'::regclass,",
        "'public.named_lens_passage_attempt_events'::regclass,",
        "'public.named_lens_dispositions'::regclass,",
        "'public.named_lens_passages'::regclass,",
        "'public.named_lens_passage_segments'::regclass,",
        "'public.underwriting_presentations'::regclass])",
        "and (select array_agg(attribute.attname::text order by key.ordinality)",
        "from unnest(constraint_record.conkey) with ordinality key(attnum,ordinality)",
        "join pg_catalog.pg_attribute attribute",
        "on attribute.attrelid=constraint_record.conrelid",
        "and attribute.attnum=key.attnum)",
        "= array['workspace_id','candidate_run_id','deal_id']",
      ].join(" ")), "6");
      for (const role of ["anon", "authenticated", "service_role"]) {
        assert.equal(psql(postgres, database, [
          "select count(*) from pg_catalog.pg_class",
          "where relnamespace='public'::regnamespace",
          "and relname = any(array[",
          "'decision_critical_evidence_projections',",
          "'named_lens_passage_attempt_events',",
          "'named_lens_dispositions','named_lens_passages',",
          "'named_lens_passage_segments','underwriting_presentations'])",
          `and (has_table_privilege('${role}',oid,'insert')`,
          `or has_table_privilege('${role}',oid,'update')`,
          `or has_table_privilege('${role}',oid,'delete')`,
          `or has_table_privilege('${role}',oid,'truncate'))`,
        ].join(" ")), "0");
        rejected(
          postgres,
          database,
          `set role ${role}; truncate public.named_lens_passages`,
          /permission denied/iu,
          `${role} direct artifact truncate`,
        );
      }
      assert.equal(psql(postgres, database, [
        "select count(*) from pg_catalog.pg_class",
        "where oid = any(array['public.intelligence_reports'::regclass,",
        "'public.company_analyses'::regclass])",
        "and (has_table_privilege('service_role',oid,'insert')",
        "or has_table_privilege('service_role',oid,'update')",
        "or has_table_privilege('service_role',oid,'delete'))",
      ].join(" ")), "0");
      assert.equal(psql(postgres, database, [
        "select count(*) from pg_catalog.pg_proc",
        "where oid = any(array[",
        "'public.reserve_named_lens_passage_attempt(jsonb)'::regprocedure,",
        "'public.settle_named_lens_passage_attempt(jsonb)'::regprocedure])",
        "and proowner='vsee_underwriting_owner'::regrole and prosecdef",
        "and has_function_privilege('service_role',oid,'execute')",
        "and not has_function_privilege('anon',oid,'execute')",
        "and not has_function_privilege('authenticated',oid,'execute')",
      ].join(" ")), "2");
      rejected(
        postgres,
        database,
        [
          "set role vsee_underwriting_owner",
          [
            "insert into public.decision_critical_evidence_projections(workspace_id,candidate_run_id,deal_id,projection_id,payload_fingerprint,payload)",
            `values ('workspace_foreign','candidate_foreign','deal_foreign','projection_foreign','${sha("0")}','{}'::jsonb)`,
          ].join(" "),
        ].join("; "),
        /running canonical Candidate owner/iu,
        "candidate-owner trigger",
      );
    } finally {
      postgres.run("dropdb", ["--if-exists", database]);
    }
  },
);

test(
  "0027 enforces append-only provider attempt lifecycle before finalization",
  { skip: postgres17SkipReason },
  () => {
    assert.equal(postgres.state, "verified");
    if (postgres.state !== "verified") return;
    const database = makeDisposableDatabaseName("named_lens_attempt_lifecycle");
    success(postgres.run("createdb", [database]), "database creation");
    try {
      runMigrations(postgres, database);
      fixtureSetup(postgres, database);
      const payload = currentPayload();
      const attempt = attemptPayloads(payload)[0]!;
      const terminal = {
        ...attempt,
        status: "completed",
        telemetry: {
          inputTokens: 1,
          outputTokens: 1,
          costUsd: "0",
          latencyMs: 1,
        },
        failureReason: null,
      };
      rejected(
        postgres,
        database,
        `set role service_role; select public.settle_named_lens_passage_attempt(${sqlJson(terminal)})`,
        /exact reserved attempt|reserve/iu,
        "settle before reserve",
      );
      rejected(
        postgres,
        database,
        `set role service_role; select public.reserve_named_lens_passage_attempt(${sqlJson({ ...attempt, attemptNumber: 2 })})`,
        /monotonic/iu,
        "non-monotonic reserve",
      );
      psql(
        postgres,
        database,
        `set role service_role; select public.reserve_named_lens_passage_attempt(${sqlJson(attempt)})`,
        "valid reserve",
      );
      rejected(
        postgres,
        database,
        `set role service_role; select public.settle_named_lens_passage_attempt(${sqlJson({ ...terminal, attemptFingerprint: sha("0") })})`,
        /exact reserved attempt fingerprint/iu,
        "settlement fingerprint mismatch",
      );
      psql(
        postgres,
        database,
        `set role service_role; select public.settle_named_lens_passage_attempt(${sqlJson(terminal)})`,
        "valid settlement",
      );
      rejected(
        postgres,
        database,
        `set role service_role; select public.settle_named_lens_passage_attempt(${sqlJson(terminal)})`,
        /already settled/iu,
        "duplicate terminal settlement",
      );
      rejected(
        postgres,
        database,
        `set role service_role; select public.reserve_named_lens_passage_attempt(${sqlJson(attempt)})`,
        /monotonic/iu,
        "duplicate reserve identity",
      );
    } finally {
      postgres.run("dropdb", ["--if-exists", database]);
    }
  },
);

test(
  "0027 rejects reviewer trust-boundary exploits before any artifact insert",
  { skip: postgres17SkipReason },
  () => {
    assert.equal(postgres.state, "verified");
    if (postgres.state !== "verified") return;
    const database = makeDisposableDatabaseName("named_lens_review_round1");
    success(postgres.run("createdb", [database]), "database creation");
    try {
      runMigrations(postgres, database);
      fixtureSetup(postgres, database);
      const attacks: Array<{
        name: string;
        prepare: (
          payload: ReturnType<typeof currentPayload>,
          context: VerifiedLoopbackPostgresContext,
          database: string,
        ) => void;
        error: RegExp;
      }> = [
        {
          name: "four applicable judgments forged into two-catalog limited coverage",
          prepare: (payload, context, targetDatabase) => {
            for (const index of [2, 3]) {
              payload.namedLensCatalogConsiderations[index]!
                .initialDisposition = "context_inapplicable";
              Object.assign(payload.namedLensDispositions[index]!, {
                disposition: "context_inapplicable",
                selectedPosition: null,
                priorityTier: null,
                passageFingerprint: null,
              });
            }
            payload.namedLensAttemptRefs = payload.namedLensAttemptRefs.slice(0, 2);
            payload.namedLensPassages = payload.namedLensPassages.slice(0, 2);
            payload.namedLensPresentation.synthesis.judgmentIds =
              payload.namedLensPresentation.synthesis.judgmentIds.slice(0, 2);
            payload.namedLensPresentation.segmentCitations =
              payload.namedLensPresentation.segmentCitations.slice(0, 2);
            payload.namedLensPresentation.firstScreenProjectionRefs
              .selectedJudgmentIds = payload.namedLensPresentation
                .firstScreenProjectionRefs.selectedJudgmentIds.slice(0, 2);
            (payload as any).terminalReasonCodes = [
              "limited_framework_coverage",
            ];
            reserveAndSettleAttempts(context, targetDatabase, payload);
          },
          error: /catalog|applicab|judgment|limited coverage/iu,
        },
        {
          name: "fabricated premise without saved Card and public-source grounding",
          prepare: (payload, context, targetDatabase) => {
            payload.namedLensPassages[0]!.premise = {
              text: "Fabricated premise with no saved public authority.",
            } as never;
            reserveAndSettleAttempts(context, targetDatabase, payload);
          },
          error: /premise|ground|component|source|claim/iu,
        },
        {
          name: "JSON-null current version and omitted candidate-local identity",
          prepare: (payload, context, targetDatabase) => {
            (payload.versionSnapshot as Record<string, unknown>)
              .namedLensGeneratorVersion = null;
            delete (payload.namedLensPassages[0] as Record<string, unknown>)
              .workspaceId;
            reserveAndSettleAttempts(context, targetDatabase, payload);
          },
          error: /version|current|candidate-local|identity|workspace/iu,
        },
        {
          name: "settled attempt outside the authorized catalog and disposition set",
          prepare: (payload, context, targetDatabase) => {
            reserveAndSettleAttempts(context, targetDatabase, payload);
            const foreign = {
              workerId: payload.workerId,
              leaseToken: payload.leaseToken,
              workspaceId: "workspace_named_lens",
              artifactSourceCandidateRunId: payload.candidateRunId,
              judgmentOrCatalogCandidateId: "foreign_catalog_candidate",
              logicalPassageId: "foreign_catalog_candidate@named-lens-passage-v1@named-lens-generator-v1",
              attemptNumber: 1,
              attemptFingerprint: sha("0"),
            };
            psql(
              context,
              targetDatabase,
              `set role service_role; select public.reserve_named_lens_passage_attempt(${sqlJson(foreign)})`,
              "reserve foreign Named Lens passage attempt",
            );
            psql(
              context,
              targetDatabase,
              `set role service_role; select public.settle_named_lens_passage_attempt(${sqlJson({
                ...foreign,
                status: "completed",
                telemetry: {
                  inputTokens: 1,
                  outputTokens: 1,
                  costUsd: "0",
                  latencyMs: 1,
                },
                failureReason: null,
              })})`,
              "settle foreign Named Lens passage attempt",
            );
            payload.namedLensAttemptRefs.push({
              judgmentOrCatalogCandidateId:
                foreign.judgmentOrCatalogCandidateId,
              logicalPassageId: foreign.logicalPassageId,
              attemptNumber: 1,
              attemptFingerprint: foreign.attemptFingerprint,
            });
          },
          error: /attempt|catalog|disposition|authorized/iu,
        },
      ];

      const groundedAttacks: Array<{
        name: string;
        mutate: (payload: ReturnType<typeof currentPayload>) => void;
        error: RegExp;
      }> = [
        {
          name: "foreign case-application evidence",
          mutate: (payload) => {
            payload.namedLensPassages[0]!.caseApplication.evidenceItemIds = [
              "foreign_fact",
            ];
          },
          error: /case|support|evidence|ground/iu,
        },
        {
          name: "foreign countercase evidence partition",
          mutate: (payload) => {
            payload.namedLensPassages[0]!.countercase.evidenceItemIds = [
              "fact_support",
            ];
          },
          error: /counter|partition|evidence|ground/iu,
        },
        {
          name: "foreign saved-judgment unknown",
          mutate: (payload) => {
            payload.namedLensPassages[0]!.unknownBoundary
              .judgmentUnknownRefs = ["Foreign unknown"];
          },
          error: /unknown|limitation|judgment|ground/iu,
        },
        {
          name: "passage conclusion contradicts saved judgment",
          mutate: (payload) => {
            payload.namedLensPassages[0]!.conditionalConclusion.stance =
              "negative";
          },
          error: /conclusion|stance|judgment|ground/iu,
        },
        {
          name: "selection basis lies outside the authoritative projection",
          mutate: (payload) => {
            payload.namedLensPassages[0]!.selectionBasisEvidenceIds = [
              "fact_counter",
            ];
            payload.namedLensDispositions[0]!.selectionBasisEvidenceIds = [
              "fact_counter",
            ];
          },
          error: /projection|selection basis|critical evidence/iu,
        },
        {
          name: "foreign first-screen selected judgment",
          mutate: (payload) => {
            payload.namedLensPresentation.firstScreenProjectionRefs
              .selectedJudgmentIds[0] = "judgment_foreign";
          },
          error: /presentation|selected|judgment|position/iu,
        },
        {
          name: "foreign synthesis evidence",
          mutate: (payload) => {
            payload.namedLensPresentation.synthesis.evidenceItemIds = [
              "fact_counter",
            ];
          },
          error: /presentation|synthesis|evidence|selection/iu,
        },
        {
          name: "foreign segment citation evidence",
          mutate: (payload) => {
            payload.namedLensPresentation.segmentCitations[0]!
              .evidenceItemIds = ["fact_counter"];
          },
          error: /citation|segment|case|evidence/iu,
        },
        {
          name: "fabricated premise public claim",
          mutate: (payload) => {
            payload.namedLensPassages[0]!.premise.claimIds = [
              "claim_foreign",
            ];
          },
          error: /premise|claim|source|component/iu,
        },
      ];
      for (const attack of groundedAttacks) {
        attacks.push({
          name: attack.name,
          prepare: (payload, context, targetDatabase) => {
            attack.mutate(payload);
            reserveAndSettleAttempts(context, targetDatabase, payload);
          },
          error: attack.error,
        });
      }

      const versionKeys = [
        "namedLensSelectionPolicyVersion",
        "namedLensPassageSchemaVersion",
        "namedLensGeneratorVersion",
        "underwritingPresentationSchemaVersion",
        "decisionTaxonomyVersion",
      ] as const;
      for (const versionKey of versionKeys) {
        for (const invalid of ["missing", "null", "wrong_type"] as const) {
          attacks.push({
            name: `${versionKey} ${invalid}`,
            prepare: (payload, context, targetDatabase) => {
              const snapshot = payload.versionSnapshot as Record<
                string,
                unknown
              >;
              if (invalid === "missing") delete snapshot[versionKey];
              else snapshot[versionKey] = invalid === "null" ? null : 27;
              reserveAndSettleAttempts(context, targetDatabase, payload);
            },
            error: /version|current Named Lens.*contract|all or none/iu,
          });
        }
      }

      const localIdentityObjects: Array<{
        name: string;
        resolve: (
          payload: ReturnType<typeof currentPayload>,
        ) => Record<string, unknown>;
      }> = [
        {
          name: "projection",
          resolve: (payload) => payload.decisionCriticalEvidenceProjection,
        },
        {
          name: "catalog",
          resolve: (payload) => payload.namedLensCatalogConsiderations[0]!,
        },
        {
          name: "disposition",
          resolve: (payload) => payload.namedLensDispositions[0]!,
        },
        {
          name: "passage",
          resolve: (payload) => payload.namedLensPassages[0]!,
        },
        {
          name: "presentation",
          resolve: (payload) => payload.namedLensPresentation,
        },
      ];
      for (const identityObject of localIdentityObjects) {
        for (const identityKey of [
          "workspaceId",
          "artifactSourceCandidateRunId",
        ] as const) {
          for (const invalid of ["missing", "null", "wrong"] as const) {
            attacks.push({
              name:
                `${identityObject.name} ${identityKey} ${invalid}`,
              prepare: (payload, context, targetDatabase) => {
                const target = identityObject.resolve(payload);
                if (invalid === "missing") delete target[identityKey];
                else if (invalid === "null") target[identityKey] = null;
                else target[identityKey] = `${identityKey}_foreign`;
                reserveAndSettleAttempts(context, targetDatabase, payload);
              },
              error: /candidate-local|identity|workspace|Candidate/iu,
            });
          }
        }
      }

      const failures: string[] = [];
      attacks.forEach((attack, index) => {
        const candidateRunId = `candidate_review_${index + 1}`;
        insertCandidate(postgres, database, {
          batchId: `batch_review_${index + 1}`,
          candidateRunId,
          workerId: `worker_review_${index + 1}`,
          leaseToken: `lease_review_${index + 1}`,
          batchFingerprint: indexedSha(index + 100),
        });
        const payload = forCandidate(currentPayload(), {
          candidateRunId,
          workerId: `worker_review_${index + 1}`,
          leaseToken: `lease_review_${index + 1}`,
          fingerprint: indexedSha(index + 200),
        });
        attack.prepare(payload, postgres, database);
        const result = postgres.run("psql", [
          "--no-password", "-v", "ON_ERROR_STOP=1", "-d", database,
          "-c", [
            "begin",
            "set role service_role",
            `select public.finalize_or_reuse_candidate_underwriting(${sqlJson(payload)})`,
            "rollback",
          ].join("; "),
        ]);
        if (result.status === 0 || !attack.error.test(result.stderr)) {
          failures.push(`${attack.name}: ${result.status === 0 ? "accepted" : result.stderr}`);
        }
      });
      assert.deepEqual(failures, []);
      assert.equal(psql(postgres, database, [
        "select",
        "(select count(*) from public.decision_critical_evidence_projections) +",
        "(select count(*) from public.named_lens_dispositions) +",
        "(select count(*) from public.named_lens_passages) +",
        "(select count(*) from public.named_lens_passage_segments) +",
        "(select count(*) from public.underwriting_presentations)",
      ].join(" ")), "0");
    } finally {
      postgres.run("dropdb", ["--if-exists", database]);
    }
  },
);

test(
  "0027 rejects incomplete or forged presentations atomically and finalizes the exact current artifact graph",
  { skip: postgres17SkipReason },
  () => {
    assert.equal(postgres.state, "verified");
    if (postgres.state !== "verified") return;
    const database = makeDisposableDatabaseName("named_lens_finalization");
    success(postgres.run("createdb", [database]), "database creation");
    try {
      runMigrations(postgres, database);
      fixtureSetup(postgres, database);
      const valid = currentPayload();
      reserveAndSettleAttempts(postgres, database, valid);
      const mutations: Array<{
        name: string;
        mutate: (payload: ReturnType<typeof currentPayload>) => void;
        error: RegExp;
      }> = [
        {
          name: "missing catalog disposition",
          mutate: (payload) => payload.namedLensDispositions.pop(),
          error: /authorized catalog consideration.*disposition|one disposition/iu,
        },
        {
          name: "duplicate catalog disposition",
          mutate: (payload) => {
            payload.namedLensDispositions[1] = structuredClone(
              payload.namedLensDispositions[0]!,
            );
          },
          error: /disposition.*unique|authorized catalog consideration/iu,
        },
        {
          name: "duplicate selected position",
          mutate: (payload) => {
            payload.namedLensDispositions[1]!.selectedPosition = 1;
          },
          error: /selected Named Lens positions must be unique and contiguous/iu,
        },
        {
          name: "gapped selected position",
          mutate: (payload) => {
            payload.namedLensDispositions[3]!.selectedPosition = 5;
          },
          error: /selected Named Lens positions must be unique and contiguous/iu,
        },
        {
          name: "position above six",
          mutate: (payload) => {
            payload.namedLensDispositions[3]!.selectedPosition = 7;
          },
          error: /selected Named Lens position|one through six/iu,
        },
        {
          name: "selected disposition without passage",
          mutate: (payload) => payload.namedLensPassages.pop(),
          error: /selected_main.*passage|publishable.*passage/iu,
        },
        {
          name: "passage without publishable disposition",
          mutate: (payload) => {
            Object.assign(payload.namedLensDispositions[3]!, {
              disposition: "withheld",
              selectedPosition: null,
              passageFingerprint: null,
            });
          },
          error: /passage.*disposition|publishable.*passage/iu,
        },
        {
          name: "cross-workspace passage",
          mutate: (payload) => {
            payload.namedLensPassages[0]!.workspaceId = "workspace_foreign";
          },
          error: /candidate-local|workspace.*identity/iu,
        },
        {
          name: "cross-report presentation",
          mutate: (payload) => {
            payload.underwritingPresentationReportId = "report_foreign";
          },
          error: /report.*identity|authoritative report/iu,
        },
        {
          name: "invalid segment set",
          mutate: (payload) => {
            delete (payload.namedLensPassages[0] as Record<string, unknown>)
              .unknownBoundary;
          },
          error: /five ordered grounded segments|segment/iu,
        },
        {
          name: "unsettled provider attempt",
          mutate: (payload) => {
            payload.namedLensAttemptRefs[0]!.attemptNumber = 2;
          },
          error: /settled.*attempt|provider attempt/iu,
        },
        {
          name: "passage fingerprint mismatch",
          mutate: (payload) => {
            payload.namedLensDispositions[0]!.passageFingerprint = sha("0");
          },
          error: /passage fingerprint|passage.*disposition/iu,
        },
        {
          name: "projection fingerprint mismatch",
          mutate: (payload) => {
            payload.namedLensDispositions[0]!
              .decisionCriticalEvidenceProjectionFingerprint = sha("0");
          },
          error: /projection.*fingerprint|decision-critical/iu,
        },
      ];
      for (const mutation of mutations) {
        const forged = structuredClone(valid);
        mutation.mutate(forged);
        rejected(
          postgres,
          database,
          `set role service_role; select public.finalize_or_reuse_candidate_underwriting(${sqlJson(forged)})`,
          mutation.error,
          mutation.name,
        );
        assert.equal(psql(postgres, database, [
          "select status || '|' ||",
          "(select count(*) from public.decision_critical_evidence_projections) || '|' ||",
          "(select count(*) from public.named_lens_dispositions) || '|' ||",
          "(select count(*) from public.named_lens_passages) || '|' ||",
          "(select count(*) from public.named_lens_passage_segments) || '|' ||",
          "(select count(*) from public.underwriting_presentations)",
          "from public.candidate_runs where id='candidate_named_lens'",
        ].join(" ")), "running|0|0|0|0|0", mutation.name);
      }

      psql(
        postgres,
        database,
        `set role service_role; select public.finalize_or_reuse_candidate_underwriting(${sqlJson(valid)})`,
        "valid current Named Lens finalization",
      );
      assert.equal(psql(postgres, database, [
        "select candidate.status || '|' ||",
        "(select count(*) from public.decision_critical_evidence_projections) || '|' ||",
        "(select count(*) from public.named_lens_dispositions) || '|' ||",
        "(select count(*) from public.named_lens_passages) || '|' ||",
        "(select count(*) from public.named_lens_passage_segments) || '|' ||",
        "(select count(*) from public.underwriting_presentations)",
        "from public.candidate_runs candidate where candidate.id='candidate_named_lens'",
      ].join(" ")), "completed|1|4|4|20|1");
      rejected(
        postgres,
        database,
        `set role service_role; select public.reserve_named_lens_passage_attempt(${sqlJson(attemptPayloads(valid)[0])})`,
        /running.*lease|attempt.*terminal|candidate.*running/iu,
        "late provider attempt",
      );
      rejected(
        postgres,
        database,
        `set role service_role; select public.settle_named_lens_passage_attempt(${sqlJson({
          ...attemptPayloads(valid)[0],
          status: "completed",
          telemetry: {
            inputTokens: 100,
            outputTokens: 50,
            costUsd: "0.01",
            latencyMs: 100,
          },
          failureReason: null,
        })})`,
        /running.*lease|attempt.*terminal|candidate.*running/iu,
        "late provider settlement",
      );
      rejected(
        postgres,
        database,
        "set role service_role; update public.named_lens_passages set deal_id='deal_named_lens' where candidate_run_id='candidate_named_lens'",
        /permission denied|immutable/iu,
        "direct artifact update",
      );
    } finally {
      postgres.run("dropdb", ["--if-exists", database]);
    }
  },
);

test(
  "0027 keeps exhausted partial artifacts canonical, aliases exact replay, and separates refresh",
  { skip: postgres17SkipReason },
  () => {
    assert.equal(postgres.state, "verified");
    if (postgres.state !== "verified") return;
    const database = makeDisposableDatabaseName("named_lens_partial_replay");
    success(postgres.run("createdb", [database]), "database creation");
    try {
      runMigrations(postgres, database);
      fixtureSetup(postgres, database);
      const source = currentPayload();
      const partial = structuredClone(source) as any;
      partial.candidateAnalysisFingerprint = sha("b");
      partial.namedLensDispositions = partial.namedLensDispositions.map(
        (disposition: any) => ({
          ...disposition,
          disposition: "withheld",
          selectedPosition: null,
          priorityTier: null,
          reasonCodes: ["PASSAGE_ATTEMPTS_EXHAUSTED"],
          passageFingerprint: null,
        }),
      );
      partial.namedLensPassages = [];
      partial.namedLensPresentation = {
        ...partial.namedLensPresentation,
        synthesis: {
          branch: "zero_available",
          text: "No validated Named Lens passage is available.",
          judgmentIds: [],
          evidenceItemIds: [],
        },
        segmentCitations: [],
        firstScreenProjectionRefs: {
          ...partial.namedLensPresentation.firstScreenProjectionRefs,
          selectedJudgmentIds: [],
        },
      };
      partial.terminalStatus = "partial";
      partial.terminalReasonCodes = ["named_lens_passage_attempts_exhausted"];
      reserveAndSettleAttempts(postgres, database, partial, "failed");
      psql(
        postgres,
        database,
        `set role service_role; select public.finalize_or_reuse_candidate_underwriting(${sqlJson(partial)})`,
        "exhausted partial finalization",
      );
      assert.equal(psql(postgres, database, [
        "select status || '|' || unavailable_reason_codes::text || '|' ||",
        "coalesce(artifact_source_candidate_run_id,'canonical')",
        "from public.candidate_runs where id='candidate_named_lens'",
      ].join(" ")), "partial|[\"named_lens_passage_attempts_exhausted\"]|canonical");

      insertCandidate(postgres, database, {
        batchId: "batch_partial_alias",
        candidateRunId: "candidate_partial_alias",
        workerId: "worker_partial_alias",
        leaseToken: "lease_partial_alias",
        batchFingerprint: sha("2"),
        rerunOfId: "candidate_named_lens",
      });
      const alias = JSON.parse(psql(
        postgres,
        database,
        `set role service_role; select public.finalize_or_reuse_candidate_underwriting(${sqlJson({
          workerId: "worker_partial_alias",
          leaseToken: "lease_partial_alias",
          candidateRunId: "candidate_partial_alias",
          candidateAnalysisFingerprint: partial.candidateAnalysisFingerprint,
        })})`,
        "partial exact replay alias",
      ).split("\n").at(-1) ?? "null") as Record<string, unknown>;
      assert.equal(alias.status, "partial");
      assert.equal(psql(postgres, database, [
        "select artifact_source_candidate_run_id || '|' || unavailable_reason_codes::text",
        "from public.candidate_runs where id='candidate_partial_alias'",
      ].join(" ")), "candidate_named_lens|[\"named_lens_passage_attempts_exhausted\"]");
      assert.equal(psql(postgres, database, [
        "select (select count(*) from public.named_lens_dispositions) || '|' ||",
        "(select count(*) from public.underwriting_presentations)",
      ].join(" ")), "4|1", "an alias must not copy presentation rows");

      insertCandidate(postgres, database, {
        batchId: "batch_named_lens_refresh",
        candidateRunId: "candidate_named_lens_refresh",
        workerId: "worker_named_lens_refresh",
        leaseToken: "lease_named_lens_refresh",
        batchFingerprint: sha("3"),
        rerunOfId: "candidate_named_lens",
        rerunOfBatchId: "batch_named_lens",
        refreshNonce: "task5-refresh",
      });
      const refresh = forCandidate(source, {
        candidateRunId: "candidate_named_lens_refresh",
        workerId: "worker_named_lens_refresh",
        leaseToken: "lease_named_lens_refresh",
        fingerprint: sha("c"),
      });
      reserveAndSettleAttempts(postgres, database, refresh);
      psql(
        postgres,
        database,
        `set role service_role; select public.finalize_or_reuse_candidate_underwriting(${sqlJson(refresh)})`,
        "refresh finalization",
      );
      assert.equal(psql(postgres, database, [
        "select status || '|' || coalesce(artifact_source_candidate_run_id,'canonical') || '|' || rerun_of_id",
        "from public.candidate_runs where id='candidate_named_lens_refresh'",
      ].join(" ")), "completed|canonical|candidate_named_lens");

      insertCandidate(postgres, database, {
        batchId: "batch_named_lens_collision",
        candidateRunId: "candidate_named_lens_collision",
        workerId: "worker_named_lens_collision",
        leaseToken: "lease_named_lens_collision",
        batchFingerprint: sha("4"),
      });
      const collision = forCandidate(source, {
        candidateRunId: "candidate_named_lens_collision",
        workerId: "worker_named_lens_collision",
        leaseToken: "lease_named_lens_collision",
        fingerprint: partial.candidateAnalysisFingerprint,
      });
      reserveAndSettleAttempts(postgres, database, collision);
      rejected(
        postgres,
        database,
        `set role service_role; select public.finalize_or_reuse_candidate_underwriting(${sqlJson(collision)})`,
        /candidate_runs_terminal_fingerprint_unique|duplicate key/iu,
        "completed/partial canonical fingerprint collision",
      );
      assert.equal(psql(postgres, database, [
        "select status || '|' ||",
        "(select count(*) from public.underwriting_presentations)",
        "from public.candidate_runs where id='candidate_named_lens_collision'",
      ].join(" ")), "running|2");
    } finally {
      postgres.run("dropdb", ["--if-exists", database]);
    }
  },
);
