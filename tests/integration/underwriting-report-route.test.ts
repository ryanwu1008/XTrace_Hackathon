import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { GET as getReport } from "../../app/api/reports/[id]/route";
import { GET as getUnderwriting } from "../../app/api/reports/[id]/underwriting/[dealId]/route";
import { GET as listActionDrafts } from "../../app/api/action-drafts/route";
import { GET as search } from "../../app/api/search/route";
import { ReportsView } from "../../app/page";
import {
  type CandidateUnderwritingDetailDto,
  UnderwritingDetailPanel,
} from "../../app/underwriting-detail";
import {
  createMemoryIntelligenceRepository,
} from "../../db/repositories/intelligence";
import {
  createMemoryUnderwritingArtifactsRepository,
  type CandidateArtifactBundle,
} from "../../db/repositories/underwriting-artifacts";
import {
  createMemoryUnderwritingRunsRepository,
} from "../../db/repositories/underwriting-runs";
import type { RouteDependencies } from "../../lib/api/route-dependencies";
import type { ClaudeClient, ClaudeCompleteInput } from "../../lib/claude/client";
import type { CandidateRun } from "../../lib/contracts/underwriting";
import {
  createActionDraftGenerator,
} from "../../lib/underwriting/action-drafts";
import {
  createContextAwareFrameworkLensResolver,
} from "../../lib/underwriting/frameworks/service";
import {
  buildUnderwritingNarrative,
} from "../../lib/underwriting/narrative";
import { canonicalIntelligenceReportFixture } from "../helpers/canonical-intelligence-report";

const WORKSPACE_ID = "workspace_read_api";
const REPORT_ID = "report_read_api";
const RUN_ID = "run_read_api";
const PUBLIC_JUDGMENT_LIMITATION = "Management-reported evidence.";
const PRIVATE_LIMITATION_MARKERS = [
  "Private no-endorsement authoring notice.",
  "Private reasoning notice.",
  "Private experimental notice.",
  "Private pack review issue.",
  "Private contraindication.",
  "Private qualification.",
  "Private card review issue.",
  "Private rights note.",
] as const;

function productDependencies(
  overrides: Partial<RouteDependencies> = {},
): RouteDependencies {
  return {
    async resolveRequestContext() {
      return {
        mode: "product",
        principal: {
          userId: "user_read_api",
          email: "reader@example.test",
        },
        workspaceId: WORKSPACE_ID,
        role: "associate",
        permissions: {
          readWorkspace: true,
          readPrivateSources: true,
          mutateSources: false,
          managePolicy: false,
          administerFrameworks: false,
        },
      };
    },
    ...overrides,
  };
}

function sandboxDependencies(
  overrides: Partial<RouteDependencies> = {},
): RouteDependencies {
  return {
    async resolveRequestContext() {
      return {
        mode: "public_sandbox",
        principal: {
          userId: "system:public-sandbox",
          email: "public-sandbox@invalid.local",
        },
        workspaceId: WORKSPACE_ID,
        role: "sandbox",
        permissions: {
          readWorkspace: true,
          readPrivateSources: true,
          mutateSources: true,
          managePolicy: true,
          administerFrameworks: false,
        },
      };
    },
    ...overrides,
  };
}

function params(id: string, dealId?: string) {
  return {
    params: Promise.resolve({
      id,
      ...(dealId ? { dealId } : {}),
    }),
  };
}

function finalizedBundle(input: {
  candidateRunId: string;
  workspaceId?: string;
  dealId?: string;
}): CandidateArtifactBundle {
  const workspaceId = input.workspaceId ?? WORKSPACE_ID;
  const dealId = input.dealId ?? "deal_selected";
  const sourceRevisionId = "revision_searchable";
  const factId = "fact_searchable";
  const assumptionId = "assumption_searchable";
  const calculationId = "calculation_searchable";
  const judgmentId = "judgment_searchable";
  const decisionId = "decision_searchable";
  const bundle = {
    candidateRunId: input.candidateRunId,
    workspaceId,
    dealId,
    candidateAnalysisFingerprint: `sha256:${"a".repeat(64)}`,
    evidencePack: {
      id: "pack_searchable",
      version: 1,
      workspaceId,
      dealId,
      asOfDate: "2026-07-29",
      sourceRevisionIds: [sourceRevisionId],
      facts: [{
        id: factId,
        analysisType: "fact",
        provenanceOrigin: "uploaded_document",
        field: "annual_recurring_revenue",
        value: "$2.4m carrier revenue",
        unit: "USD",
        currency: "USD",
        periodStart: null,
        periodEnd: null,
        publishedAt: null,
        eventAt: null,
        retrievedAt: "2026-07-29T12:00:00.000Z",
        sourceRevisionId,
        locator: {
          kind: "text_range",
          start: 0,
          end: 20,
          excerpt: "Carrier revenue is $2.4m.",
        },
        sourceRole: "management",
        assertionStatus: "reported",
        verificationMethod: null,
        freshness: "current",
        acceptedForGate: true,
      }],
      assumptions: [{
        id: assumptionId,
        analysisType: "assumption",
        provenanceOrigin: "recommended_policy",
        scenario: "base",
        field: "exit_multiple",
        value: "8",
        unit: "multiple",
        rationale: "Pinned policy assumption",
        inputRefIds: ["fund_policy_1"],
        sensitivity: "high",
        requiresConfirmation: false,
      }],
      conflicts: [],
      coverage: {
        minimumModelInputsComplete: true,
        criticalEvidenceComplete: true,
        missingFieldIds: [],
        blockingConflictIds: [],
        decisionCeiling: "Invest Candidate",
        underwritingStatus: "available",
        reasonCodes: [],
      },
      createdAt: "2026-07-29T12:00:00.000Z",
    },
    context: {
      id: "context_searchable",
      contextVersion: "1",
      stage: "seed",
      businessModel: "b2b_saas",
      geography: "us",
      securityType: "preferred",
      asOfDate: "2026-07-29",
      criticalEvidenceProfileId: "critical_profile_1",
      benchmarkPackId: "benchmark_1",
      benchmarkCompatibility: "exact",
      valuationMethodPolicyId: "valuation_policy_1",
      decisionPolicyId: "decision_policy_1",
      frameworkPackId: "framework_pack_1",
    },
    scenarioModel: {
      id: "scenario_searchable",
      candidateRunId: input.candidateRunId,
      formulaPolicyVersion: "valuation_policy_1",
      scenarios: [],
      probabilityWeighted: false,
    },
    calculations: [{
      id: calculationId,
      analysisType: "calculation",
      formulaId: "formula_searchable",
      formulaVersion: "1",
      inputRefs: [{
        itemId: factId,
        value: "2400000",
        type: "fact",
      }],
      output: "19200000",
      unit: "money",
      currency: "USD",
      period: null,
      roundingPolicy: "half_even_display_only",
      computedAt: "2026-07-29T12:00:00.000Z",
      status: "completed",
    }],
    calculationClaimEdges: [],
    judgments: [{
      id: judgmentId,
      analysisType: "framework_judgment",
      frameworkCardId: "framework_searchable",
      frameworkVersion: "1",
      applicability: "applicable",
      conclusion: "supportive",
      supportEvidenceItemIds: [factId],
      counterEvidenceItemIds: [],
      unusedEvidenceItemIds: [],
      strongestSupport: "Carrier revenue supports early demand.",
      strongestCounterargument: null,
      unknowns: [],
      limitations: [
        PUBLIC_JUDGMENT_LIMITATION,
        ...PRIVATE_LIMITATION_MARKERS,
      ],
      confidence: {
        sourceReliability: "medium",
        evidenceStrength: "medium",
        evidenceCoverage: "medium",
        applicability: "high",
        judgment: "medium",
      },
      claimEdges: [{
        claimItemId: judgmentId,
        dependencyItemId: factId,
        dependencyType: "fact",
      }],
      frameworkMetadata: {
        packId: "public_advisory_pack",
        packName: "Public advisory pack",
        packVersion: "1.2.3",
        packDescription: "Private unpublished pack description.",
        packReview: {
          contentStatus: "draft",
          publicationStatus: "unpublished",
          openIssues: ["Private pack review issue."],
        },
        sourceCatalogId: "public_advisory_sources",
        researchCutoff: "2026-06-30",
        context: {
          stage: "seed",
          businessModel: "b2b_saas",
          geography: "us",
          securityType: "preferred",
        },
        applicable: true,
        componentCardIds: ["PT-01"],
        components: [{
          schemaVersion: "framework-card-authoring-v1",
          frameworkId: "PT-01",
          slug: "contrarian-monopoly",
          name: "Contrarian Monopoly Lens",
          version: "1.4.0",
          positioning: {
            oneLineSummary: "Private positioning.",
            productLabel: "Private product label.",
            notAClaimOf: ["Private disclaimer."],
          },
          attribution: {
            display: "Based on public works",
            scope: "person_direct",
            people: ["Public Investor"],
            organizations: [],
            fidelityConfidence: "high",
          },
          neutralParaphrase: "Private authoring body.",
          claimTypes: ["direct_doctrine"],
          sourceRefs: [{
            sourceId: "source_public_1",
            claimIds: ["claim_public_1"],
            locator: {
              kind: "chapter_page",
              value: "Chapter 3, p. 25",
            },
            attributionScope: "person_direct",
            supportType: "primary",
          }],
          applicability: {
            stages: ["seed"],
            businessModels: ["b2b_saas"],
            sectors: ["software"],
            geographies: ["us"],
            securityTypes: ["preferred"],
          },
          requiredConditions: ["Private required condition."],
          requiredEvidence: [{
            evidenceKey: "private_evidence",
            description: "Private required evidence.",
            necessity: "required",
            acceptableSources: ["Private source class."],
            missingEffect: "insufficient_evidence",
          }],
          decisionQuestions: ["Private decision question?"],
          positiveSignals: ["Private positive signal."],
          redFlags: ["Private red flag."],
          disconfirmingEvidence: ["Private disconfirming evidence."],
          contraindications: ["Private contraindication."],
          decisionMethod: {
            kind: "qualitative_lens",
            instructions: ["Private authoring instruction."],
            outputOrder: [
              "evidence",
              "applicable_rule",
              "judgment",
              "counterevidence",
              "unknowns",
              "conclusion",
              "next_evidence_request",
            ],
            deterministicRule: null,
          },
          confidenceAnchors: {
            sourceReliability: {
              low: "Private low.",
              medium: "Private medium.",
              high: "Private high.",
            },
            evidenceStrength: {
              low: "Private low.",
              medium: "Private medium.",
              high: "Private high.",
            },
            evidenceCoverage: {
              low: "Private low.",
              medium: "Private medium.",
              high: "Private high.",
            },
            applicabilityConfidence: {
              low: "Private low.",
              medium: "Private medium.",
              high: "Private high.",
            },
            judgmentConfidence: {
              low: "Private low.",
              medium: "Private medium.",
              high: "Private high.",
            },
          },
          overlapFrameworkIds: [],
          conflictingFrameworkIds: [],
          decisionUtility: {
            status: "advisory",
            formalDecisionWeight: 0,
            allowedUses: ["research_question"],
            promotionRequirements: ["Private promotion requirement."],
            empiricalQualifications: ["Private qualification."],
          },
          rights: {
            status: "public_source_paraphrase",
            displayMode: "neutral_paraphrase_only",
            containsLongQuote: false,
            notes: "Private rights note.",
          },
          review: {
            contentStatus: "draft",
            publicationStatus: "unpublished",
            reviewer: null,
            reviewedAt: null,
            openIssues: ["Private card review issue."],
          },
          changeLog: [{
            version: "1.4.0",
            date: "2026-06-30",
            summary: "Private change summary.",
          }],
        }],
        sources: [{
          sourceId: "source_public_1",
          title: "Public source title",
          authorOrSpeaker: ["Public Investor"],
          publisher: "Public Publisher",
          sourceClass: "A1",
          sourceType: "book",
          url: "https://example.test/public-source",
          edition: "First edition",
          publishedAt: "2014-09-16",
          eventAt: null,
          accessedAt: "2026-06-30",
          language: "English",
          rightsStatus: "public_source_paraphrase",
          attributionScope: "person_direct",
          attributionNotes: "Public-source attribution.",
          immutableRevision: {
            status: "verified",
            hashAlgorithm: "sha256",
            contentHash: "sha256:public-source",
            reviewedPdfPages: [25],
          },
        }],
        notices: {
          noEndorsement: "Private no-endorsement authoring notice.",
          noPrivateReasoning: "Private reasoning notice.",
          experimentalOnly: "Private experimental notice.",
        },
        formalDecisionWeight: "0",
        authorizationDigest: `sha256:${"9".repeat(64)}`,
      },
      fingerprint: `sha256:${"b".repeat(64)}`,
    }],
    disagreements: [],
    valuation: {
      id: "valuation_searchable",
      status: "completed",
      scenarios: [
        { name: "bear", valuation: "12000000", calculationIds: [calculationId] },
        { name: "base", valuation: "19200000", calculationIds: [calculationId] },
        { name: "bull", valuation: "28000000", calculationIds: [calculationId] },
      ],
      currentAsk: "18000000",
      maximumAcceptablePreMoney: "19200000",
      initialOwnership: "0.12",
      postDilutionOwnership: "0.09",
      grossMoic: "4",
      grossIrr: "0.32",
      pricingPremium: "-0.0625",
      calculationIds: [calculationId],
      blockerCodes: [],
    },
    decision: {
      id: decisionId,
      analysisType: "final_synthesis",
      companyQuality: "pass",
      priceAttractiveness: "pass",
      fundFit: "pass",
      decision: "Advance",
      decisionCeiling: "Invest Candidate",
      hardVeto: false,
      firedRules: [],
      blockingEvidenceItemIds: [],
      claimEdges: [{
        claimItemId: decisionId,
        dependencyItemId: judgmentId,
        dependencyType: "framework_judgment",
      }],
      confidence: "medium",
    },
    narrative: "Carrier revenue supports advancing source-grounded diligence.",
    actionDrafts: [],
    versionSnapshot: {
      fundPolicyId: "fund_policy_1",
      benchmarkPackId: "benchmark_1",
      benchmarkEntryId: "benchmark_entry_1",
      benchmarkDefinitionFingerprint: `sha256:${"1".repeat(64)}`,
      frameworkPackId: "framework_pack_1",
      frameworkPackDefinitionFingerprint: `sha256:${"2".repeat(64)}`,
      routerVersion: "router-v1",
      criticalEvidenceProfileId: "critical_profile_1",
      criticalEvidenceProfileDefinitionFingerprint:
        `sha256:${"3".repeat(64)}`,
      valuationMethodPolicyId: "valuation_policy_1",
      valuationMethodPolicyDefinitionFingerprint:
        `sha256:${"4".repeat(64)}`,
      decisionPolicyId: "decision_policy_1",
      decisionPolicyDefinitionFingerprint: `sha256:${"5".repeat(64)}`,
      referenceCatalogFingerprint: `sha256:${"6".repeat(64)}`,
      formulaVersions: ["formula-v1"],
      providerModel: "private-provider-model",
      promptVersion: "private-prompt-version",
      schemaVersion: "schema-v1",
      settingsFingerprint: "private-settings-fingerprint",
      applicationCommit: "private-application-commit",
    },
    claimEdges: [
      {
        claimItemId: judgmentId,
        dependencyItemId: factId,
        dependencyType: "fact",
      },
      {
        claimItemId: decisionId,
        dependencyItemId: judgmentId,
        dependencyType: "framework_judgment",
      },
    ],
  } as CandidateArtifactBundle;
  bundle.narrative = buildUnderwritingNarrative({
    facts: bundle.evidencePack.facts,
    assumptions: bundle.evidencePack.assumptions,
    calculations: bundle.calculations,
    judgments: bundle.judgments,
    disagreements: bundle.disagreements,
    decision: bundle.decision,
  });
  bundle.actionDrafts = createActionDraftGenerator({
    workspaceId,
    now: () => new Date("2026-07-29T12:00:00.000Z"),
  }).generate({
    candidateRunId: input.candidateRunId,
    decision: bundle.decision,
    missingEvidence: [{
      fieldId: "net_retention",
      label: "Net retention",
      reasonCode: "MISSING_CRITICAL_EVIDENCE",
      mostLikelyDecisionImpact: "May change the current decision ceiling.",
    }],
    dealStatus: "passed",
    beliefDirection: "positive",
    actions: [{
      kind: "reopen_diligence",
      scope: "deal",
      priority: "standard",
      visibility: "internal_only",
    }],
    judgments: bundle.judgments,
    disagreements: bundle.disagreements,
  });
  return bundle;
}

async function readRepositories(options: {
  prepareBundle?: (
    bundle: CandidateArtifactBundle,
    candidate: CandidateRun,
  ) => Promise<CandidateArtifactBundle>;
} = {}) {
  let sequence = 0;
  const artifacts = createMemoryUnderwritingArtifactsRepository();
  const runs = createMemoryUnderwritingRunsRepository({
    idGenerator(kind) {
      sequence += 1;
      return `${kind}_read_${sequence}`;
    },
    artifacts,
  });
  const intelligence = createMemoryIntelligenceRepository();
  await intelligence.saveReport(canonicalIntelligenceReportFixture({
    id: REPORT_ID,
    workspaceId: WORKSPACE_ID,
    runId: RUN_ID,
    createdAt: "2026-07-29T12:00:00.000Z",
    marketSummary: "Persisted market summary",
  }));
  const scanRun = {
    id: RUN_ID,
    workspaceId: WORKSPACE_ID,
    mode: "structured" as const,
    windowDays: 14 as const,
    status: "completed" as const,
    currentStage: "report",
    warningCount: 0,
    warnings: [],
    workerId: null,
    createdAt: "2026-07-29T11:00:00.000Z",
    startedAt: "2026-07-29T11:00:00.000Z",
    completedAt: "2026-07-29T12:00:00.000Z",
    leaseExpiresAt: null,
    evidenceContext: { state: "legacy_unbound" as const },
  };
  const scanRuns = {
    async get(workspaceId: string, runId: string) {
      return workspaceId === WORKSPACE_ID && runId === RUN_ID
        ? structuredClone(scanRun)
        : null;
    },
    async list(workspaceId: string) {
      return workspaceId === WORKSPACE_ID
        ? [structuredClone(scanRun)]
        : [];
    },
  } as unknown as RouteDependencies["runs"];
  const batch = await runs.createOrReuseBatch({
    workspaceId: WORKSPACE_ID,
    scanRunId: RUN_ID,
    batchInputFingerprint: `sha256:${"7".repeat(64)}`,
    fundPolicySnapshotId: "fund_policy_1",
    forceRefresh: false,
    refreshNonce: null,
    rerunOfId: null,
  });
  await runs.saveSelections({
    batchId: batch.id,
    selections: [
      {
        dealId: "deal_selected",
        status: "selected",
        rank: 1,
        reason: "Top-ranked persisted match",
      },
      {
        dealId: "deal_not_selected",
        status: "not_selected",
        rank: null,
        reason: "Outside the Top 5",
      },
    ],
  });
  const [candidate] = await runs.createSelectedCandidates({
    batchId: batch.id,
    dealIds: ["deal_selected"],
  });
  const prepared = finalizedBundle({
    candidateRunId: candidate.id,
  });
  artifacts.commitPrepared(
    options.prepareBundle
      ? await options.prepareBundle(prepared, candidate)
      : prepared,
  );
  return { artifacts, runs, intelligence, scanRuns, batch, candidate };
}

test("public sandbox renders the complete persisted canonical named-advisory report", async () => {
  const resolver = createContextAwareFrameworkLensResolver({
    cards: [],
    client: deterministicAdvisoryClient(),
    execution: {
      provider: "anthropic",
      model: "deterministic-public-sandbox-test",
      promptVersion: "framework-lens-v1",
      schemaVersion: "framework-judgment-v1",
      settingsFingerprint: `sha256:${"d".repeat(64)}`,
      applicationCommit: "task-6-acceptance",
    },
  });
  let persistedBundle: CandidateArtifactBundle | undefined;
  const repositories = await readRepositories({
    async prepareBundle(bundle, candidate) {
      const selection = await resolver.resolve(bundle.context);
      assert.deepEqual(selection.catalog.stats, {
        packCount: 20,
        cardCount: 199,
        sourceCount: 270,
        eligibleCardCount: 180,
        excludedCardCount: 19,
      });
      const advisory = await selection.service.runAll({
        candidate,
        pack: bundle.evidencePack,
        context: bundle.context,
        calculations: bundle.calculations,
      });
      const evidenceItemIds = new Set([
        ...bundle.evidencePack.facts.map(({ id }) => id),
        ...bundle.evidencePack.assumptions.map(({ id }) => id),
      ]);
      const applicableNamed = advisory.judgments.filter(
        ({ applicability, frameworkMetadata }) =>
          applicability === "applicable" && frameworkMetadata !== undefined,
      );
      assert.equal(applicableNamed.length, 19);
      assert.equal(
        applicableNamed.every((judgment) =>
          [
            ...judgment.supportEvidenceItemIds,
            ...judgment.counterEvidenceItemIds,
          ].every((itemId) => evidenceItemIds.has(itemId))
        ),
        true,
      );
      assert.equal(
        advisory.judgments.every(
          ({ frameworkMetadata }) =>
            frameworkMetadata?.formalDecisionWeight === "0",
        ),
        true,
      );
      const coreJudgment = structuredClone(bundle.judgments[0]!);
      delete coreJudgment.frameworkMetadata;
      coreJudgment.limitations = [PUBLIC_JUDGMENT_LIMITATION];
      persistedBundle = {
        ...bundle,
        judgments: [coreJudgment, ...advisory.judgments],
        disagreements: advisory.disagreements,
        claimEdges: [
          ...bundle.claimEdges,
          ...advisory.judgments.flatMap(({ claimEdges }) => claimEdges),
        ],
        versionSnapshot: {
          ...bundle.versionSnapshot,
          frameworkCatalogVersion: selection.catalogVersion,
          frameworkCatalogFingerprint: selection.catalogFingerprint,
          frameworkCorpusDigest: selection.corpusDigest,
        },
      };
      return persistedBundle;
    },
  });
  assert.ok(persistedBundle);

  const response = await getUnderwriting(
    new Request(
      `https://vsee.test/api/reports/${REPORT_ID}/underwriting/deal_selected`,
    ),
    params(REPORT_ID, "deal_selected") as {
      params: Promise<{ id: string; dealId: string }>;
    },
    sandboxDependencies({
      intelligence: repositories.intelligence,
      underwritingRuns: repositories.runs,
      underwritingArtifacts: repositories.artifacts,
    }),
  );
  assert.equal(response.status, 200);
  const detail = (await response.json() as {
    data: CandidateUnderwritingDetailDto & {
      judgments: Array<
        CandidateUnderwritingDetailDto["judgments"][number] & {
          supportEvidenceItemIds?: string[];
          counterEvidenceItemIds?: string[];
        }
      >;
    };
  }).data;
  const html = renderToStaticMarkup(createElement(UnderwritingDetailPanel, {
    companyName: "Canonical Sandbox Company",
    analysis: null,
    detail,
    drafts: [],
    canSaveDrafts: true,
    onEditDraft() {},
  }));
  const reportHtml = renderToStaticMarkup(createElement(ReportsView, {
    reports: [sandboxReportUiFixture()],
    deals: [],
    onDraft() {},
    focusedReportId: REPORT_ID,
    deploymentMode: "public_sandbox",
    canSaveActionDrafts: true,
  }));

  assert.match(
    reportHtml,
    /Loading persisted candidate states/,
    "public sandbox ReportsView must enter the durable underwriting UI",
  );
  assert.doesNotMatch(reportHtml, /synthetic and read-only/);
  const peter = detail.judgments.find(
    ({ frameworkMetadata }) =>
      frameworkMetadata?.packId === "peter_thiel_public_frameworks_v0_1",
  );
  assert.ok(peter);
  assert.ok(peter.frameworkMetadata);
  assert.deepEqual(peter.supportEvidenceItemIds, ["fact_searchable"]);
  assert.deepEqual(
    peter.counterEvidenceItemIds,
    ["assumption_searchable"],
  );
  assert.equal(detail.decision.decision, persistedBundle.decision.decision);
  assert.match(html, /NAMED ADVISORY/);
  assert.match(html, /Support/);
  assert.match(html, /Counterevidence/);
  assert.match(html, /Unknowns/);
  assert.match(html, /Limitations/);
  assert.match(html, /Independent disagreements/);
  assert.match(html, /Exact source lineage/);
  assert.match(html, /Supporting Evidence Pack IDs/);
  assert.match(html, /Counterevidence Evidence Pack IDs/);
  assert.match(html, /fact_searchable/);
  assert.match(html, /assumption_searchable/);
  assert.match(
    html,
    /Confidence<\/dt><dd>source medium · strength medium · coverage medium · applicability high · judgment medium/,
  );
  assert.match(
    html,
    new RegExp(escapeRegExp(peter.frameworkMetadata.sources[0]!.url)),
  );
  assert.match(
    html,
    new RegExp(
      escapeRegExp(
        peter.frameworkMetadata.components[0]!.sourceRefs[0]!.locator.value,
      ),
    ),
  );
  assert.match(html, /not an endorsement/i);
  assert.match(html, /private reasoning|hidden chain of thought/i);
  const namedJudgments = detail.judgments.filter(
    ({ frameworkMetadata }) => frameworkMetadata !== undefined,
  );
  assert.equal(namedJudgments.length, 20);
  assert.equal(
    html.match(/NAMED ADVISORY ·/g)?.length,
    namedJudgments.length,
  );
  const evidenceItemIds = new Set([
    ...detail.evidencePack.facts.map(({ id }) => id),
    ...detail.evidencePack.assumptions.map(({ id }) => id),
  ]);
  for (const judgment of namedJudgments) {
    assert.ok(judgment.frameworkMetadata);
    assert.equal(judgment.frameworkMetadata.formalDecisionWeight, "0");
    if (judgment.applicability === "applicable") {
      assert.ok(judgment.supportEvidenceItemIds?.length);
      assert.ok(judgment.counterEvidenceItemIds?.length);
      for (const itemId of [
        ...judgment.supportEvidenceItemIds,
        ...judgment.counterEvidenceItemIds,
      ]) {
        assert.equal(evidenceItemIds.has(itemId), true);
        assert.match(html, new RegExp(escapeRegExp(itemId)));
      }
    }
    const sourcesById = new Map(
      judgment.frameworkMetadata.sources.map((source) => [
        source.sourceId,
        source,
      ]),
    );
    for (const component of judgment.frameworkMetadata.components) {
      for (const sourceRef of component.sourceRefs) {
        const source = sourcesById.get(sourceRef.sourceId);
        assert.ok(source);
        assert.ok(
          html.includes(encodeHtml(source.url)),
          `missing rendered public URL ${source.url}`,
        );
        assert.match(
          html,
          new RegExp(escapeRegExp(encodeHtml(sourceRef.locator.value))),
        );
      }
    }
  }
  for (const privateMarker of PRIVATE_LIMITATION_MARKERS) {
    assert.doesNotMatch(html, new RegExp(escapeRegExp(privateMarker)));
  }
});

test("report detail attaches an explicit persisted underwriting batch summary", async () => {
  const repositories = await readRepositories();
  const response = await getReport(
    new Request(`https://vsee.test/api/reports/${REPORT_ID}`),
    params(REPORT_ID),
    productDependencies({
      intelligence: repositories.intelligence,
      underwritingRuns: repositories.runs,
      underwritingArtifacts: repositories.artifacts,
    }),
  );

  assert.equal(response.status, 200);
  const payload = await response.json() as {
    data: {
      underwritingBatch: {
        batchId: string;
        selections: Array<Record<string, unknown>>;
      };
    };
  };
  assert.equal(payload.data.underwritingBatch.batchId, repositories.batch.id);
  assert.deepEqual(payload.data.underwritingBatch.selections, [
    {
      dealId: "deal_selected",
      underwritingStatus: "queued",
      rank: 1,
      candidateRunId: repositories.candidate.id,
      decision: null,
    },
    {
      dealId: "deal_not_selected",
      underwritingStatus: "not_selected",
      rank: null,
      candidateRunId: null,
      decision: null,
    },
  ]);
});

test("public demo report detail never reads persisted underwriting state", async () => {
  const intelligence = createMemoryIntelligenceRepository();
  await intelligence.saveReport(canonicalIntelligenceReportFixture({
    id: "report_demo",
    workspaceId: "workspace_demo",
    runId: "run_demo",
    createdAt: "2026-07-29T12:00:00.000Z",
    marketSummary: "Synthetic demo report",
  }));
  const runs = createMemoryUnderwritingRunsRepository();
  runs.getBatchByScanRunId = async () => {
    throw new Error("Demo mode reached persisted underwriting");
  };
  const response = await getReport(
    new Request("https://vsee.test/api/reports/report_demo"),
    params("report_demo"),
    {
      async resolveRequestContext() {
        return {
          mode: "public_demo",
          principal: null,
          workspaceId: "workspace_demo",
          role: "demo",
          permissions: {
            readWorkspace: true,
            readPrivateSources: false,
            mutateSources: false,
            managePolicy: false,
            administerFrameworks: false,
          },
        };
      },
      intelligence,
      underwritingRuns: runs,
    },
  );

  assert.equal(response.status, 200);
  const payload = await response.json() as {
    data: Record<string, unknown>;
  };
  assert.equal("underwritingBatch" in payload.data, false);
});

test("candidate detail returns exact persisted replay lineage", async () => {
  const repositories = await readRepositories();
  const response = await getUnderwriting(
    new Request(
      `https://vsee.test/api/reports/${REPORT_ID}/underwriting/deal_selected`,
    ),
    params(REPORT_ID, "deal_selected") as {
      params: Promise<{ id: string; dealId: string }>;
    },
    productDependencies({
      intelligence: repositories.intelligence,
      underwritingRuns: repositories.runs,
      underwritingArtifacts: repositories.artifacts,
    }),
  );

  assert.equal(response.status, 200);
  const payload = await response.json() as {
    data: Record<string, unknown> & {
      sourceRevisionIds: string[];
      versionSnapshot: Record<string, unknown>;
    };
  };
  assert.deepEqual(payload.data.sourceRevisionIds, ["revision_searchable"]);
  assert.equal(payload.data.dealId, "deal_selected");
  assert.equal(
    payload.data.versionSnapshot.providerModel,
    "private-provider-model",
  );
  assert.equal(
    payload.data.versionSnapshot.promptVersion,
    "private-prompt-version",
  );
  assert.equal(
    payload.data.versionSnapshot.settingsFingerprint,
    "private-settings-fingerprint",
  );
  assert.equal(
    payload.data.versionSnapshot.applicationCommit,
    "private-application-commit",
  );
});

test("candidate detail allowlists public advisory provenance without unpublished authoring bodies", async () => {
  const repositories = await readRepositories();
  const response = await getUnderwriting(
    new Request(
      `https://vsee.test/api/reports/${REPORT_ID}/underwriting/deal_selected`,
    ),
    params(REPORT_ID, "deal_selected") as {
      params: Promise<{ id: string; dealId: string }>;
    },
    productDependencies({
      intelligence: repositories.intelligence,
      underwritingRuns: repositories.runs,
      underwritingArtifacts: repositories.artifacts,
    }),
  );

  assert.equal(response.status, 200);
  const payload = await response.json() as {
    data: {
      judgments: Array<Record<string, unknown> & {
        frameworkMetadata?: Record<string, unknown> & {
          components: Array<Record<string, unknown>>;
          sources: Array<Record<string, unknown>>;
        };
      }>;
    };
  };
  const judgment = payload.data.judgments[0];
  const metadata = judgment.frameworkMetadata;
  assert.ok(metadata);
  assert.equal(metadata.packId, "public_advisory_pack");
  assert.equal(metadata.packVersion, "1.2.3");
  assert.equal(metadata.sourceCatalogId, "public_advisory_sources");
  assert.equal(metadata.researchCutoff, "2026-06-30");
  assert.deepEqual(metadata.components, [{
    frameworkId: "PT-01",
    version: "1.4.0",
    name: "Contrarian Monopoly Lens",
    attribution: {
      display: "Based on public works",
    },
    sourceRefs: [{
      sourceId: "source_public_1",
      claimIds: ["claim_public_1"],
      locator: {
        kind: "chapter_page",
        value: "Chapter 3, p. 25",
      },
      attributionScope: "person_direct",
      supportType: "primary",
    }],
  }]);
  assert.deepEqual(metadata.sources, [{
    sourceId: "source_public_1",
    title: "Public source title",
    authorOrSpeaker: ["Public Investor"],
    publisher: "Public Publisher",
    sourceClass: "A1",
    sourceType: "book",
    url: "https://example.test/public-source",
    edition: "First edition",
    publishedAt: "2014-09-16",
    eventAt: null,
    accessedAt: "2026-06-30",
    language: "English",
    rightsStatus: "public_source_paraphrase",
    attributionScope: "person_direct",
    attributionNotes: "Public-source attribution.",
    immutableRevision: {
      status: "verified",
      hashAlgorithm: "sha256",
      contentHash: "sha256:public-source",
      reviewedPdfPages: [25],
    },
  }]);
  for (const privateField of [
    "packDescription",
    "packReview",
    "context",
    "applicable",
    "notices",
    "authorizationDigest",
  ]) {
    assert.equal(privateField in metadata, false);
  }
  for (const privateField of [
    "neutralParaphrase",
    "requiredConditions",
    "requiredEvidence",
    "decisionQuestions",
    "decisionMethod",
    "review",
    "rights",
    "decisionUtility",
  ]) {
    assert.equal(privateField in metadata.components[0], false);
  }
  for (const privateField of [
    "analysisType",
    "unusedEvidenceItemIds",
    "claimEdges",
    "fingerprint",
  ]) {
    assert.equal(privateField in judgment, false);
  }
  const serialized = JSON.stringify(payload.data);
  for (const privateMarker of [
    "Private unpublished pack description.",
    ...PRIVATE_LIMITATION_MARKERS,
    "Private authoring instruction.",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(privateMarker));
  }
  assert.match(serialized, /Public advisory pack/);
  assert.match(serialized, /PT-01/);
  assert.match(serialized, /https:\/\/example\.test\/public-source/);
  assert.match(serialized, new RegExp(PUBLIC_JUDGMENT_LIMITATION));
});

test("search and action-draft reads rebuild public advisory text without persisted private markers", async () => {
  const repositories = await readRepositories();
  for (const privateMarker of PRIVATE_LIMITATION_MARKERS) {
    const privateSearch = await search(
      new Request(
        `https://vsee.test/api/search?q=${encodeURIComponent(privateMarker)}`,
      ),
      undefined,
      productDependencies({
        intelligence: repositories.intelligence,
        runs: repositories.scanRuns,
        underwritingRuns: repositories.runs,
        underwritingArtifacts: repositories.artifacts,
      }),
    );
    assert.equal(privateSearch.status, 200);
    assert.deepEqual(
      (await privateSearch.json() as {
        data: { results: unknown[] };
      }).data.results,
      [],
    );
  }

  const publicSearch = await search(
    new Request(
      "https://vsee.test/api/search?q=Public%20advisory%20pack",
    ),
    undefined,
    productDependencies({
      intelligence: repositories.intelligence,
      runs: repositories.scanRuns,
      underwritingRuns: repositories.runs,
      underwritingArtifacts: repositories.artifacts,
    }),
  );
  const publicResults = (await publicSearch.json() as {
    data: { results: Array<{ analysisType: string; text: string }> };
  }).data.results;
  assert.equal(publicResults.length, 1);
  assert.equal(publicResults[0].analysisType, "final_synthesis");
  assert.match(publicResults[0].text, /Public advisory pack/);
  assert.match(publicResults[0].text, /PT-01/);
  assert.match(
    publicResults[0].text,
    /https:\/\/example\.test\/public-source/,
  );
  const publicLimitationSearch = await search(
    new Request(
      `https://vsee.test/api/search?q=${
        encodeURIComponent(PUBLIC_JUDGMENT_LIMITATION)
      }`,
    ),
    undefined,
    productDependencies({
      intelligence: repositories.intelligence,
      runs: repositories.scanRuns,
      underwritingRuns: repositories.runs,
      underwritingArtifacts: repositories.artifacts,
    }),
  );
  const publicLimitationResults =
    (await publicLimitationSearch.json() as {
      data: { results: Array<{ text: string }> };
    }).data.results;
  assert.ok(publicLimitationResults.length > 0);
  assert.equal(
    publicLimitationResults.every(({ text }) =>
      text.includes(PUBLIC_JUDGMENT_LIMITATION)
    ),
    true,
  );

  const persistedDrafts = await repositories.artifacts.listActionDrafts({
    workspaceId: WORKSPACE_ID,
    candidateRunId: repositories.candidate.id,
  });
  const persistedMemo = persistedDrafts.find((draft) =>
    "format" in draft && draft.format === "internal_memo"
  );
  assert.ok(persistedMemo);
  const editedConclusion =
    "advisory conclusion: mixed after partner review";
  assert.match(persistedMemo.body, /advisory conclusion: supportive/);
  assert.match(
    persistedMemo.body,
    new RegExp(PUBLIC_JUDGMENT_LIMITATION),
  );
  for (const privateMarker of PRIVATE_LIMITATION_MARKERS) {
    assert.doesNotMatch(persistedMemo.body, new RegExp(privateMarker));
  }
  const currentDraftResponse = await listActionDrafts(
    new Request(
      `https://vsee.test/api/action-drafts?candidateRunId=${
        repositories.candidate.id
      }`,
    ),
    undefined,
    productDependencies({
      intelligence: repositories.intelligence,
      runs: repositories.scanRuns,
      underwritingRuns: repositories.runs,
      underwritingArtifacts: repositories.artifacts,
    }),
  );
  const currentMemo =
    (await currentDraftResponse.json() as {
      data: Array<{ channel: string; format: string | null; body: string }>;
    }).data.find(({ format }) => format === "internal_memo");
  assert.ok(currentMemo);
  assert.match(currentMemo.body, new RegExp(PUBLIC_JUDGMENT_LIMITATION));
  for (const privateMarker of PRIVATE_LIMITATION_MARKERS) {
    assert.doesNotMatch(currentMemo.body, new RegExp(privateMarker));
  }

  const legacyBodyWithoutLimitationLines = persistedMemo.body
    .split("\n")
    .filter((line) =>
      !line.startsWith("  Limitations:")
      && !line.startsWith("  Public limitations:")
      && !line.startsWith("- Address advisory limitation [")
      && !line.startsWith("- Address public advisory limitation [")
    )
    .join("\n");
  const legacyEditedBody = legacyBodyWithoutLimitationLines
    .replace(
      "  Applicability: applicable; advisory conclusion: supportive",
      [
        "  Product-synthesis notice: Private experimental notice.",
        "  No-endorsement notice: Private no-endorsement authoring notice.",
        "  No-private-reasoning notice: Private reasoning notice.",
        `  Applicability: applicable; ${editedConclusion}`,
      ].join("\n"),
    )
    .replace(
      "  Component Cards:",
      [
        `  Limitations: ${
          [PUBLIC_JUDGMENT_LIMITATION, ...PRIVATE_LIMITATION_MARKERS].join(
            "; ",
          )
        }`,
        "  Component Cards:",
      ].join("\n"),
    )
    .replace(
      "\nINDEPENDENT ADVISORY CONFLICTS",
      [
        "  Component qualifications and limitations:",
        "    - PT-01: Private contraindication.",
        "    - PT-01: Private qualification.",
        "    - PT-01: Private card review issue.",
        "    - PT-01: Private rights note.",
        "",
        "INDEPENDENT ADVISORY CONFLICTS",
      ].join("\n"),
    )
    .replace(
      "ADVISORY DILIGENCE REQUESTS\n",
      [
        "ADVISORY DILIGENCE REQUESTS",
        ...[PUBLIC_JUDGMENT_LIMITATION, ...PRIVATE_LIMITATION_MARKERS].map(
          (limitation) =>
            `- Address advisory limitation [Public advisory pack]: ${limitation}`,
        ),
        "",
      ].join("\n"),
    );
  await repositories.artifacts.replaceActionDraftBody({
    workspaceId: WORKSPACE_ID,
    draftId: persistedMemo.id,
    body: legacyEditedBody,
  });

  const draftResponse = await listActionDrafts(
    new Request(
      `https://vsee.test/api/action-drafts?candidateRunId=${
        repositories.candidate.id
      }`,
    ),
    undefined,
    productDependencies({
      intelligence: repositories.intelligence,
      runs: repositories.scanRuns,
      underwritingRuns: repositories.runs,
      underwritingArtifacts: repositories.artifacts,
    }),
  );
  assert.equal(draftResponse.status, 200);
  const drafts = (await draftResponse.json() as {
    data: Array<{ channel: string; format: string | null; body: string }>;
  }).data;
  const internalMemo = drafts.find(({ format }) =>
    format === "internal_memo"
  );
  assert.ok(internalMemo);
  assert.match(
    internalMemo.body,
    /Reopen internal diligence based on the cited evidence\./,
  );
  assert.match(internalMemo.body, new RegExp(editedConclusion));
  assert.match(internalMemo.body, /Public advisory pack/);
  assert.match(internalMemo.body, /PT-01/);
  assert.match(
    internalMemo.body,
    /https:\/\/example\.test\/public-source/,
  );
  assert.match(
    internalMemo.body,
    new RegExp(PUBLIC_JUDGMENT_LIMITATION),
  );
  for (const privateMarker of PRIVATE_LIMITATION_MARKERS) {
    assert.doesNotMatch(internalMemo.body, new RegExp(privateMarker));
  }
});

test("search reads finalized persisted analysis items only and retains citations", async () => {
  const repositories = await readRepositories();
  const response = await search(
    new Request("https://vsee.test/api/search?q=2.4m%20carrier%20revenue"),
    undefined,
    productDependencies({
      intelligence: repositories.intelligence,
      runs: repositories.scanRuns,
      underwritingRuns: repositories.runs,
      underwritingArtifacts: repositories.artifacts,
    }),
  );

  assert.equal(response.status, 200);
  const payload = await response.json() as {
    data: {
      results: Array<{
        itemId: string;
        analysisType: string;
        sourceRevisionIds: string[];
      }>;
    };
  };
  assert.deepEqual(payload.data.results.map((result) => result.itemId), [
    "fact_searchable",
  ]);
  assert.equal(payload.data.results[0].analysisType, "fact");
  assert.deepEqual(
    payload.data.results[0].sourceRevisionIds,
    ["revision_searchable"],
  );
});

test("assumption search preserves the exact persisted policy reference lineage", async () => {
  const repositories = await readRepositories();
  const response = await search(
    new Request(
      "https://vsee.test/api/search?q=exit%20multiple%20pinned%20policy%20assumption",
    ),
    undefined,
    productDependencies({
      intelligence: repositories.intelligence,
      runs: repositories.scanRuns,
      underwritingRuns: repositories.runs,
      underwritingArtifacts: repositories.artifacts,
    }),
  );

  assert.equal(response.status, 200);
  const payload = await response.json() as {
    data: {
      results: Array<{
        itemId: string;
        analysisType: string;
        inputRefIds: string[];
        sourceRevisionIds: string[];
        claimEdges: Array<{
          claimItemId: string;
          dependencyItemId: string;
          dependencyType: string;
        }>;
      }>;
    };
  };
  assert.deepEqual(payload.data.results, [{
    itemId: "assumption_searchable",
    candidateRunId: repositories.candidate.id,
    dealId: "deal_selected",
    analysisType: "assumption",
    text: "exit_multiple: 8. Pinned policy assumption",
    inputRefIds: ["fund_policy_1"],
    sourceRevisionIds: [],
    claimEdges: [{
      claimItemId: "assumption_searchable",
      dependencyItemId: "fund_policy_1",
      dependencyType: "policy_ref",
    }],
  }]);
});

test("new persisted-underwriting reads cannot cross organization scope", async () => {
  const repositories = await readRepositories();
  const foreign = productDependencies({
    async resolveRequestContext() {
      return {
        mode: "product",
        principal: { userId: "user_foreign", email: "foreign@example.test" },
        workspaceId: "workspace_foreign",
        role: "associate",
        permissions: {
          readWorkspace: true,
          readPrivateSources: true,
          mutateSources: false,
          managePolicy: false,
          administerFrameworks: false,
        },
      };
    },
    intelligence: repositories.intelligence,
    runs: repositories.scanRuns,
    underwritingRuns: repositories.runs,
    underwritingArtifacts: repositories.artifacts,
  });
  const detail = await getUnderwriting(
    new Request(
      `https://vsee.test/api/reports/${REPORT_ID}/underwriting/deal_selected`,
    ),
    params(REPORT_ID, "deal_selected") as {
      params: Promise<{ id: string; dealId: string }>;
    },
    foreign,
  );
  const searchResponse = await search(
    new Request("https://vsee.test/api/search?q=carrier"),
    undefined,
    foreign,
  );
  assert.equal(detail.status, 404);
  assert.equal(searchResponse.status, 404);
  assert.match(JSON.stringify(await searchResponse.json()), /not.found/i);
});

test("public demo cannot query product underwriting search", async () => {
  const response = await search(
    new Request("https://vsee.test/api/search?q=carrier"),
    undefined,
    {
      async resolveRequestContext() {
        return {
          mode: "public_demo",
          principal: null,
          workspaceId: "workspace_demo",
          role: "demo",
          permissions: {
            readWorkspace: true,
            readPrivateSources: false,
            mutateSources: false,
            managePolicy: false,
            administerFrameworks: false,
          },
        };
      },
    },
  );
  assert.equal(response.status, 403);
});

function deterministicAdvisoryClient(): ClaudeClient {
  return {
    async complete(request) {
      const payload = frameworkPromptPayload(request);
      const factId = payload.evidencePack.facts[0]?.id;
      const assumptionId = payload.evidencePack.assumptions[0]?.id;
      assert.ok(factId);
      assert.ok(assumptionId);
      const peterThiel =
        payload.card.experimentalAdvisory?.packId
          === "peter_thiel_public_frameworks_v0_1";
      return JSON.stringify({
        applicability: "applicable",
        conclusion: peterThiel ? "supportive" : "negative",
        supportEvidenceItemIds: [factId],
        counterEvidenceItemIds: [assumptionId],
        unusedEvidenceItemIds: [],
        strongestSupport:
          "The retained Fact supports this bounded independent viewpoint.",
        strongestCounterargument:
          "The retained Assumption is explicit counterevidence.",
        unknowns: ["Independent customer confirmation remains outstanding."],
        limitations: [
          "This public advisory viewpoint cannot create or modify the formal decision.",
        ],
        confidence: {
          sourceReliability: "medium",
          evidenceStrength: "medium",
          evidenceCoverage: "medium",
          applicability: "high",
          judgment: "medium",
        },
        frameworkRuleRefs: [payload.card.id],
      });
    },
  };
}

function frameworkPromptPayload(request: ClaudeCompleteInput): {
  card: {
    id: string;
    experimentalAdvisory?: {
      packId: string;
    };
  };
  evidencePack: {
    facts: Array<{ id: string }>;
    assumptions: Array<{ id: string }>;
  };
} {
  const content = request.messages[0]?.content;
  if (typeof content !== "string") {
    throw new Error("Framework prompt must be text-only.");
  }
  const parsed = JSON.parse(content) as {
    card?: {
      id: string;
      experimentalAdvisory?: {
        packId: string;
      };
    };
    evidencePack?: {
      facts: Array<{ id: string }>;
      assumptions: Array<{ id: string }>;
    };
    originalRequest?: {
      card: {
        id: string;
        experimentalAdvisory?: {
          packId: string;
        };
      };
      evidencePack: {
        facts: Array<{ id: string }>;
        assumptions: Array<{ id: string }>;
      };
    };
  };
  const payload = parsed.originalRequest ?? parsed;
  if (!payload.card || !payload.evidencePack) {
    throw new Error("Framework prompt is missing its immutable inputs.");
  }
  return {
    card: payload.card,
    evidencePack: payload.evidencePack,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function encodeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll(">", "&gt;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

function sandboxReportUiFixture() {
  return {
    id: REPORT_ID,
    workspaceId: WORKSPACE_ID,
    runId: RUN_ID,
    createdAt: "2026-07-29T12:00:00.000Z",
    marketSummary: "Persisted public sandbox report.",
    opportunities: [],
    analysisStatus: "completed" as const,
    evidenceCoverage: {
      acceptedPublicEvents: 1,
      excludedPublicItems: 0,
      truncatedPublicEvents: 0,
      recalledDealCount: 1,
      unavailableDealCount: 0,
    },
    counts: {
      companyCount: 1,
      beliefRevised: 0,
      monitor: 1,
      noMaterialChange: 0,
      analysisUnavailable: 0,
    },
    priorityDealId: null,
    companyAnalyses: [{
      id: "analysis_sandbox_ui",
      reportId: REPORT_ID,
      runId: "11111111-1111-4111-8111-111111111111",
      dealId: "deal_selected",
      companyName: "Canonical Sandbox Company",
      dealStatus: "screening" as const,
      outcome: "monitor" as const,
      confidence: "medium" as const,
      score: 0.5,
      verifiedSourceCount: 1,
      investmentMemory: {
        previousMeetingSummary: "Persisted meeting summary.",
        decisionReason: "Persisted decision reason.",
        concerns: [],
        revisitConditions: [],
        lastEvaluatedAt: null,
        memoryIds: [],
        sourceIds: ["source_sandbox_ui"],
        fixtureIds: [],
      },
      marketEvidence: {
        relationship: "related" as const,
        explanation: "Persisted source-grounded evidence.",
        eventIds: [],
        events: [],
        sourceIds: ["source_sandbox_ui"],
      },
      implications: {
        positive: [],
        negative: [],
      },
      recommendedNextMove: "Review the persisted evidence.",
      companyBrief: {
        icSnapshot: [],
        traction: [],
        dealTerms: [],
        risks: [],
        decisionHistory: [],
        sourceLineage: [],
      },
      sources: [{
        id: "source_sandbox_ui",
        provenance: "source_document" as const,
        title: "Persisted sandbox source",
        documentId: "document_sandbox_ui",
        page: 1,
        excerpt: "Persisted source-grounded evidence.",
      }],
      createdAt: "2026-07-29T12:00:00.000Z",
    }],
  };
}
