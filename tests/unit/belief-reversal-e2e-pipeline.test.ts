import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { ClaudeCompleteInput } from "../../lib/claude/client";
import {
  ClaudeAdvisoryFrameworkJudgmentOutputSchema,
  ClaudeAdvisoryFrameworkLensOutputSchema,
} from "../../lib/claude/schemas";
import {
  authorizedResearchComposites,
  loadResearchFrameworkCatalog,
} from "../../lib/underwriting/frameworks/research-loader";
import { runClaudeFrameworkLens } from
  "../../lib/underwriting/frameworks/claude-lens";
import { prioritizeNamedLensJudgments } from
  "../../lib/underwriting/frameworks/relevance";

import {
  assertBeliefReversalReplayEvidenceIdentity,
  assertBeliefReversalReplayPersistence,
  assertCurrentBeliefReversalColdPass,
  assertInitialExactXTraceIngest,
  createBeliefReversalDeterministicProviders,
  readBeliefReversalIsolationPersistentCounts,
  readBeliefReversalReplayPersistentCounts,
} from "../helpers/belief-reversal-e2e-pipeline";
import type { ExactParentIngestResult } from
  "../../worker/ingest-exact-xtrace-parents";
import {
  PINNED_THIRTY_DEAL_SNAPSHOT_ID,
} from "../../lib/belief-reversal/pinned-thirty-deal-snapshot";

const SHA_A = `sha256:${"a".repeat(64)}`;

const NAMED_LENS_SUPPORT_VALUE =
  "Three enterprise customers expanded paid deployments after independent security reviews.";
const NAMED_LENS_COUNTER_VALUE =
  "Two pilots paused renewal while integration ownership remained unresolved.";

function englishWordCount(value: string): number {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

function semanticWords(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase("en-US").match(/[a-z0-9]+/gu) ?? []);
}

function exactIngestResults(reused: boolean): ExactParentIngestResult[] {
  return Array.from({ length: 85 }, (_, index) => ({
    dealId: `deal_${index}`,
    parentKind: "canonical_source_revision" as const,
    sourceId: `source_${index}`,
    sourceRevisionId: `revision_${index}`,
    outcome: "recorded" as const,
    ingest: {
      state: "succeeded",
      reused,
      memoryIds: [`memory_${index}`],
    },
  })) as ExactParentIngestResult[];
}

test("cross-version XTrace first-pass assertion distinguishes exact created and reused modes", () => {
  const created = exactIngestResults(false);
  const reused = exactIngestResults(true);

  assert.doesNotThrow(() =>
    assertInitialExactXTraceIngest(created, "created")
  );
  assert.doesNotThrow(() =>
    assertInitialExactXTraceIngest(reused, "reused")
  );
  assert.throws(() =>
    assertInitialExactXTraceIngest(reused, "created")
  );
  assert.throws(() =>
    assertInitialExactXTraceIngest(created, "reused")
  );
  assert.throws(() =>
    assertInitialExactXTraceIngest([
      ...reused.slice(0, 84),
      created[84]!,
    ], "reused")
  );
});

function exactParentPayload(input: {
  dealId: string;
  companyName: string;
  sourceRevisionId: string;
}) {
  return {
    schemaVersion: "xtrace-parent-v2",
    workspaceId: "workspace_e2e",
    dealId: input.dealId,
    parent: {
      kind: "canonical_source_revision",
      sourceId: `source_${input.dealId}`,
      sourceRevisionId: input.sourceRevisionId,
      fingerprint: SHA_A,
    },
    retrievalPayload: {
      dealId: input.dealId,
      companyName: input.companyName,
      status: "passed",
      facts: [],
      interactions: [],
    },
  };
}

test("deterministic E2E XTrace fake records exact parents and recalls only the queried Deal", async () => {
  const providers = createBeliefReversalDeterministicProviders();
  const henry = await providers.xtraceClient.ingest({
    messages: [{
      role: "user",
      content: JSON.stringify(exactParentPayload({
        dealId: "deal_henry_ai_v1",
        companyName: "Henry AI",
        sourceRevisionId: "revision_henry_v1",
      })),
    }],
    user_id: "workspace:workspace_e2e",
    conv_id: "deal:deal_henry_ai_v1:parent:revision_henry_v1",
  });
  await providers.xtraceClient.ingest({
    messages: [{
      role: "user",
      content: JSON.stringify(exactParentPayload({
        dealId: "deal_irregular_v1",
        companyName: "Irregular",
        sourceRevisionId: "revision_irregular_v1",
      })),
    }],
    user_id: "workspace:workspace_e2e",
    conv_id: "deal:deal_irregular_v1:parent:revision_irregular_v1",
  });

  assert.equal(henry.status, "succeeded");
  assert.equal(henry.result?.memories_created?.length, 1);
  const recalled = await providers.xtraceClient.search({
    query:
      "Henry AI · investment decision · workflow compression · Irregular is mentioned only as context",
    user_id: "workspace:workspace_e2e",
    app_id: "xtrace-e2e-isolated",
    mode: "retrieve",
    limit: 20,
  });
  assert.equal(recalled.success, true);
  assert.equal(recalled.data.length, 1);
  assert.match(recalled.data[0]!.text, /Henry AI/u);
  assert.equal(recalled.data[0]!.app_id, "xtrace-e2e-isolated");
  assert.equal(recalled.data[0]!.user_id, "workspace:workspace_e2e");
  assert.equal(
    recalled.data[0]!.conv_id,
    "deal:deal_henry_ai_v1:parent:revision_henry_v1",
  );
  assert.deepEqual(providers.inspect().xtrace, {
    ingestCalls: 2,
    searchCalls: 1,
    deleteCalls: 0,
    exactParentCount: 2,
    memoryCount: 2,
  });
});

test("deterministic E2E XTrace fake can prime already-persisted exact parents for a fresh Worker process", async () => {
  const providers = createBeliefReversalDeterministicProviders();
  providers.primeExactParents([{
    workspaceId: "workspace_e2e",
    dealId: "deal_henry_ai_v1",
    sourceId: "source_henry_v1",
    sourceRevisionId: "revision_henry_v1",
    bundle: {
      dealId: "deal_henry_ai_v1",
      companyName: "Henry AI",
      status: "passed",
      facts: [{
        text: "Henry public evidence.",
        sources: [{
          id: "source_henry_v1",
          title: "Henry source",
          provenance: "source_document",
          documentId: "source_henry_v1",
          excerpt: "Henry public evidence.",
        }],
      }],
      interactions: [],
    },
    parentKind: "legacy_source_revision",
    parentFingerprint: SHA_A,
    payloadFingerprint: SHA_A,
  }]);

  const recalled = await providers.xtraceClient.search({
    query: "Henry AI · investment decision",
    user_id: "workspace:workspace_e2e",
    mode: "retrieve",
    limit: 20,
  });

  assert.equal(recalled.data.length, 1);
  assert.match(recalled.data[0]!.text, /xtrace-parent-v2/u);
  assert.deepEqual(providers.inspect().xtrace, {
    ingestCalls: 0,
    searchCalls: 1,
    deleteCalls: 0,
    exactParentCount: 1,
    memoryCount: 1,
  });
});

test("deterministic matching fake returns observations and primitive scores but no downstream decision fields", async () => {
  const providers = createBeliefReversalDeterministicProviders();
  const response = JSON.parse(await providers.claudeClient.complete({
    system: "You are an evidence-constrained venture-capital research analyst.",
    messages: [{
      role: "user",
      content: JSON.stringify({
        task: "Rank credible Deal/event overlaps for human follow-up.",
        deals: [{
          id: "deal_henry_ai_v1",
          companyName: "Henry AI",
          status: "passed",
        }],
        marketEvents: [{
          id: "event_henry_series_a_v1",
          triggerSourceId: "claim_henry_series_a_v1",
          sources: [
            {
              id: "claim_henry_series_a_v1",
              sourceRevisionId: "source_revision_source_henry_series_a_v1_1",
              evidenceRole: "trigger",
              factEligible: true,
              normalizedStatement:
                "Henry announced a $16.5 million Series A led by FirstMark Capital.",
              verbatimExcerpt: null,
            },
            {
              id: "claim_henry_workflow_v1",
              evidenceRole: "corroborating",
              factEligible: true,
              normalizedStatement:
                "Henry reports that work estimated at 15 hours per deliverable now takes about 30 minutes of human review.",
              verbatimExcerpt: null,
            },
            {
              id: "claim_henry_terms_v1",
              evidenceRole: "counterevidence",
              factEligible: true,
              normalizedStatement:
                "Henry's terms warn that outputs may not always be accurate or complete.",
              verbatimExcerpt: null,
            },
          ],
        }],
        memoryContexts: [{
          dealId: "deal_henry_ai_v1",
          interactionCandidates: [{
            id: "fixture_henry_passed_v1",
            occurredAt: "2026-06-10T10:00:00-07:00",
            sourceIds: ["fixture_henry_passed_v1"],
            revisitConditions: [
              "A source-backed deployment result shows a substantial reduction in human work.",
            ],
            provenance: "demo_fixture",
            label: "Sample decision record",
          }],
        }],
        sources: [{
          id: "fixture_henry_passed_v1",
          evidenceRole: "context",
          factEligible: true,
          normalizedStatement:
            "Sample decision record. The sample decision required workflow compression.",
          verbatimExcerpt: null,
        }],
      }),
    }],
    maxTokens: 6_000,
  })) as Array<Record<string, unknown>>;

  assert.equal(response.length, 1);
  assert.equal(response[0]?.dealId, "deal_henry_ai_v1");
  assert.deepEqual(Object.keys(response[0] ?? {}).filter((key) =>
    ["direction", "rank", "actions", "decision", "confidence", "finalScore"]
      .includes(key)
  ), []);
  assert.deepEqual(response[0]?.scoreInputs, {
    eventRelevance: 0.9,
    dealRelevance: 0.9,
    priorContextStrength: 0.92,
    evidenceQuality: 0.94,
  });
});

test("deterministic matching fake follows the collected live event and trigger identities", async () => {
  const providers = createBeliefReversalDeterministicProviders();
  const request = {
    system: "You are an evidence-constrained venture-capital research analyst.",
    messages: [{
      role: "user",
      content: JSON.stringify({
        task: "Rank credible Deal/event overlaps for human follow-up.",
        deals: [{
          id: "deal_henry_ai_v1",
          companyName: "Henry AI",
          status: "passed",
        }],
        marketEvents: [{
          id: "event_live_collected_henry_v1",
          title: "Henry reports a $16.5 million Series A",
          triggerSourceId: "claim_henry_series_a_v1",
          entityKeys: ["henry_ai"],
          sources: [{
            id: "claim_henry_series_a_v1",
            sourceRevisionId: "source_revision_source_henry_series_a_v1_1",
            evidenceRole: "trigger",
            factEligible: true,
            normalizedStatement:
              "Henry announced a $16.5 million Series A led by FirstMark Capital.",
            verbatimExcerpt: null,
          }],
        }],
        memoryContexts: [{
          dealId: "deal_henry_ai_v1",
          interactionCandidates: [{
            id: "fixture_henry_passed_v1",
            occurredAt: "2026-06-10T10:00:00-07:00",
            sourceIds: ["fixture_henry_passed_v1"],
            revisitConditions: [
              "A source-backed deployment result shows a substantial reduction in human work.",
            ],
            provenance: "demo_fixture",
            label: "Sample decision record",
          }],
        }],
        sources: [{
          id: "fixture_henry_passed_v1",
          evidenceRole: "context",
          factEligible: true,
          normalizedStatement:
            "Sample decision record. The sample decision required workflow compression.",
          verbatimExcerpt: null,
        }, {
          id: "claim_henry_workflow_v1",
          evidenceRole: "corroborating",
          factEligible: true,
          normalizedStatement:
            "Henry reports that work estimated at 15 hours per deliverable now takes about 30 minutes of human review.",
          verbatimExcerpt: null,
        }, {
          id: "claim_henry_terms_v1",
          evidenceRole: "counterevidence",
          factEligible: true,
          normalizedStatement:
            "Henry's terms warn that outputs may not always be accurate or complete.",
          verbatimExcerpt: null,
        }],
      }),
    }],
    maxTokens: 6_000,
  } satisfies ClaudeCompleteInput;
  const response = JSON.parse(
    await providers.claudeClient.complete(request),
  ) as Array<Record<string, unknown>>;

  assert.equal(response.length, 1);
  assert.equal(response[0]?.selectedTriggerEventId, "event_live_collected_henry_v1");
  assert.deepEqual(
    response[0]?.revisitCitedSourceIds,
    ["claim_henry_series_a_v1"],
  );
  assert.ok(
    (response[0]?.citedSourceIds as string[])
      .includes("claim_henry_series_a_v1"),
  );

  const wrongLineage = JSON.parse(request.messages[0]!.content) as {
    marketEvents: Array<{ sources: Array<{ sourceRevisionId: string }> }>;
  };
  wrongLineage.marketEvents[0]!.sources[0]!.sourceRevisionId =
    "source_revision_wrong_henry_v1";
  await assert.rejects(
    providers.claudeClient.complete({
      ...request,
      messages: [{ role: "user", content: JSON.stringify(wrongLineage) }],
    }),
    /matching authority is missing for deal_henry_ai_v1/u,
  );
});

test("deterministic matching fake skips a reviewed Deal whose trigger aged out of the live event set", async () => {
  const providers = createBeliefReversalDeterministicProviders();
  const response = JSON.parse(await providers.claudeClient.complete({
    system: "You are an evidence-constrained venture-capital research analyst.",
    messages: [{
      role: "user",
      content: JSON.stringify({
        task: "Rank credible Deal/event overlaps for human follow-up.",
        deals: [{
          id: "deal_hush_security_v1",
          companyName: "Hush Security",
          status: "invested",
        }],
        marketEvents: [{
          id: "event_live_unrelated_centralize_v1",
          title: "Centralize reports a funding event",
          triggerSourceId: "research_evidence_centralize_axios_v1",
          entityKeys: ["centralize"],
          sources: [{
            id: "research_evidence_centralize_axios_v1",
            sourceRevisionId:
              "source_revision_source_centralize_axios_v1_1",
            evidenceRole: "trigger",
            factEligible: true,
            normalizedStatement: "Centralize reported a funding event.",
            verbatimExcerpt: null,
          }],
        }],
        memoryContexts: [{
          dealId: "deal_hush_security_v1",
          interactionCandidates: [{
            id: "fixture_hush_invested_v1",
            occurredAt: "2026-06-14T10:00:00-07:00",
            sourceIds: ["fixture_hush_invested_v1"],
            revisitConditions: [
              "Evidence of repeatable partner-led distribution and deployment.",
            ],
            provenance: "demo_fixture",
            label: "Sample decision record",
          }],
        }],
        sources: [],
      }),
    }],
    maxTokens: 6_000,
  })) as unknown[];

  assert.deepEqual(response, []);
});

test("deterministic framework fake partitions immutable inputs and never emits a formal decision", async () => {
  const providers = createBeliefReversalDeterministicProviders();
  const response = JSON.parse(await providers.claudeClient.complete({
    system: "You are one independent, evidence-grounded venture framework lens.",
    messages: [{
      role: "user",
      content: JSON.stringify({
        card: {
          id: "framework_gtm_unit_economics_v1",
          title: "GTM & Unit Economics",
        },
        evidencePack: {
          facts: [{ id: "fact_1" }, { id: "fact_2" }],
          assumptions: [{ id: "assumption_1" }],
        },
      }),
    }],
    maxTokens: 4_000,
  })) as Record<string, unknown>;

  assert.equal(response.applicability, "applicable");
  assert.equal(response.conclusion, "supportive");
  assert.deepEqual([
    ...(response.supportEvidenceItemIds as string[]),
    ...(response.counterEvidenceItemIds as string[]),
    ...(response.unusedEvidenceItemIds as string[]),
  ].sort(), ["assumption_1", "fact_1", "fact_2"]);
  assert.equal("decision" in response, false);
  assert.equal("action" in response, false);
  assert.equal("rank" in response, false);
});

test("deterministic E2E advisory responses emit a passage only for a current canonical focus", async () => {
  const providers = createBeliefReversalDeterministicProviders();
  const catalog = await loadResearchFrameworkCatalog({
    context: {
      id: "underwriting_context_seed_b2b_saas_v1",
      contextVersion: "1",
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
      frameworkPackId:
        "framework_pack_synthetic_universal_saas_ai_v1",
    },
  });
  const cards = authorizedResearchComposites(catalog)
    .filter(({ experimentalAdvisory }) =>
      experimentalAdvisory.applicable
      && experimentalAdvisory.components.some(({ sourceRefs }) =>
        sourceRefs.length > 0
      )
    );
  assert.ok(cards.length >= 2);

  const responses = await Promise.all(cards.map(async (card) => {
    const rawResponse = JSON.parse(
      await providers.claudeClient.complete({
        system:
          "You are one independent, evidence-grounded venture framework lens. The supplied Card is one experimental product synthesis.",
        messages: [{
          role: "user",
          content: JSON.stringify({
            card,
            evidencePack: {
              facts: [{
                id: "fact_customer_signal",
                field: "customer_evidence",
                value: NAMED_LENS_SUPPORT_VALUE,
              }, {
                id: "fact_risk_signal",
                field: "risk_evidence",
                value: NAMED_LENS_COUNTER_VALUE,
              }],
              assumptions: [{
                id: "assumption_scope",
                field: "scope",
                value: "Bounded fixture scope",
              }],
              coverage: { missingFieldIds: ["retention"] },
            },
          }),
        }],
        maxTokens: 4_000,
      }),
    ) as Record<string, unknown>;
    if (!("passage" in rawResponse)) {
      const abstention = ClaudeAdvisoryFrameworkJudgmentOutputSchema.parse(
        rawResponse,
      );
      assert.equal(abstention.applicability, "applicable");
      assert.equal(abstention.conclusion, "abstain");
      assert.deepEqual(abstention.supportEvidenceItemIds, []);
      assert.deepEqual(abstention.counterEvidenceItemIds, []);
      return null;
    }
    const response = ClaudeAdvisoryFrameworkLensOutputSchema.parse(
      rawResponse,
    );
    const component = card.experimentalAdvisory.components.find(
      ({ frameworkId }) =>
        frameworkId === response.passage.focus.componentFrameworkId,
    );
    assert.ok(component);
    const binding = card.experimentalAdvisory.decisionTaxonomyBindings.find(
      ({ frameworkId, cardFieldRef }) =>
        frameworkId === response.passage.focus.componentFrameworkId
        && cardFieldRef === response.passage.focus.cardFieldRef,
    );
    assert.ok(binding);
    assert.equal(
      response.passage.focus.decisionQuestionCode,
      binding.decisionQuestionCode,
    );
    assert.deepEqual(
      response.passage.focus.evidenceDomainCodes,
      [...binding.evidenceDomainCodes].sort(),
    );
    assert.deepEqual(response.passage.caseApplication.evidenceItemIds, [
      response.supportEvidenceItemIds[0],
    ]);
    assert.deepEqual(response.passage.countercase.evidenceItemIds, [
      response.counterEvidenceItemIds[0],
    ]);
    assert.deepEqual(
      response.passage.unknownBoundary.judgmentUnknownRefs,
      response.unknowns,
    );
    assert.deepEqual(
      response.passage.unknownBoundary.judgmentLimitationRefs,
      response.limitations,
    );
    const sourceRef = component.sourceRefs.find(({ sourceId }) =>
      response.passage.premise.publicSourceIds.includes(sourceId)
    );
    assert.ok(sourceRef);
    assert.deepEqual(response.passage.premise.claimIds, sourceRef.claimIds);
    assert.deepEqual(response.passage.premise.locator, sourceRef.locator);
    assert.equal(
      response.passage.premise.attributionScope,
      sourceRef.attributionScope,
    );
    const passageSegments = [
      response.passage.premise.text,
      response.passage.caseApplication.text,
      response.passage.countercase.text,
      response.passage.unknownBoundary.text,
      response.passage.conditionalConclusion.text,
    ];
    assert.ok(passageSegments.every((value) => value.trim().length > 0));
    const doctrineWords = semanticWords(component.neutralParaphrase);
    const premiseWords = semanticWords(response.passage.premise.text);
    const doctrineOverlap = [...doctrineWords]
      .filter((word) => premiseWords.has(word)).length / doctrineWords.size;
    assert.ok(
      doctrineOverlap >= 0.85,
      `${card.title} premise must apply the selected public doctrine`,
    );
    const questionWords = semanticWords(binding.questionText);
    const questionOverlap = [...questionWords]
      .filter((word) => premiseWords.has(word)).length / questionWords.size;
    assert.ok(
      questionOverlap >= 0.75,
      `${card.title} premise must preserve the selected Card question without unsafe governance language`,
    );
    assert.ok(
      response.passage.caseApplication.text.includes(
        NAMED_LENS_SUPPORT_VALUE.replace(/[.!?]+$/u, ""),
      ),
      `${card.title} must apply the actual candidate support value`,
    );
    assert.ok(
      response.passage.countercase.text.includes(
        NAMED_LENS_COUNTER_VALUE.replace(/[.!?]+$/u, ""),
      ),
      `${card.title} must apply the actual candidate counterevidence value`,
    );
    assert.match(response.passage.caseApplication.text, /because/iu);
    assert.match(response.passage.countercase.text, /because/iu);
    assert.doesNotMatch(
      [
        response.passage.caseApplication.text,
        response.passage.countercase.text,
      ].join(" "),
      /[.!?]\s+(?:supports|limits)\b/iu,
    );
    assert.match(response.passage.unknownBoundary.text, /evidence request/iu);
    assert.match(
      response.passage.unknownBoundary.text,
      /deterministic E2E fixture|not (?:an? )?observed production-model output/iu,
    );
    assert.match(
      response.passage.conditionalConclusion.text,
      /conditional|if /iu,
    );
    const wordCount = passageSegments.reduce(
      (total, value) => total + englishWordCount(value),
      0,
    );
    assert.ok(
      wordCount >= 180 && wordCount <= 260,
      `${card.title} passage has ${wordCount} words`,
    );
    assert.doesNotMatch(
      passageSegments.join(" "),
      /component [0-9]+|question [0-9]+|authorized [^.!?]* question|saved company evidence/iu,
    );
    return response;
  }));

  const passages = responses.filter((response) => response !== null);
  assert.ok(passages.length >= 2);
  assert.ok(responses.some((response) => response === null));
  assert.deepEqual(
    [...new Set(passages.map(({ conclusion }) => conclusion))].sort(),
    ["negative", "supportive"],
  );
  assert.equal(
    new Set(passages.map(({ passage }) => JSON.stringify([
      passage.premise.text,
      passage.caseApplication.text,
      passage.countercase.text,
      passage.unknownBoundary.text,
      passage.conditionalConclusion.text,
    ]))).size,
    passages.length,
  );

  const noDisplayValues = JSON.parse(
    await providers.claudeClient.complete({
      system:
        "You are one independent, evidence-grounded venture framework lens. The supplied Card is one experimental product synthesis.",
      messages: [{
        role: "user",
        content: JSON.stringify({
          card: cards[0],
          evidencePack: {
            facts: [{
              id: "fact_customer_signal",
              field: "customer_evidence",
            }, {
              id: "fact_risk_signal",
              field: "risk_evidence",
            }],
            assumptions: [],
            coverage: { missingFieldIds: ["retention"] },
          },
        }),
      }],
      maxTokens: 4_000,
    }),
  ) as Record<string, unknown>;
  const valueMissingAbstention =
    ClaudeAdvisoryFrameworkJudgmentOutputSchema.parse(noDisplayValues);
  assert.equal("passage" in noDisplayValues, false);
  assert.equal(valueMissingAbstention.conclusion, "abstain");
  assert.deepEqual(valueMissingAbstention.supportEvidenceItemIds, []);
  assert.deepEqual(valueMissingAbstention.counterEvidenceItemIds, []);
});

test("deterministic E2E advisory passages pass the real candidate-local grounding boundary", async () => {
  const providers = createBeliefReversalDeterministicProviders();
  const context = {
    id: "underwriting_context_seed_b2b_saas_v1",
    contextVersion: "1",
    analysisMode: "full" as const,
    stage: "seed" as const,
    businessModel: "b2b_saas" as const,
    geography: "us" as const,
    securityType: "preferred" as const,
    asOfDate: "2026-07-29",
    criticalEvidenceProfileId: "critical_evidence_seed_b2b_saas_v1",
    benchmarkPackId: "benchmark_pack_synthetic_us_software_v1",
    benchmarkCompatibility: "exact" as const,
    valuationMethodPolicyId: "valuation_method_seed_b2b_saas_v1",
    decisionPolicyId: "decision_policy_seed_b2b_saas_v1",
    frameworkPackId: "framework_pack_synthetic_universal_saas_ai_v1",
  };
  const catalog = await loadResearchFrameworkCatalog({ context });
  const cards = authorizedResearchComposites(catalog)
    .filter(({ experimentalAdvisory }) =>
      experimentalAdvisory.applicable
      && experimentalAdvisory.components.some(({ sourceRefs }) =>
        sourceRefs.length > 0
      )
    );
  const now = "2026-08-10T12:00:00.000Z";
  const fact = (id: string, field: string, value: string) => ({
    id,
    analysisType: "fact" as const,
    provenanceOrigin: "public_source" as const,
    field,
    value,
    unit: null,
    currency: null,
    periodStart: null,
    periodEnd: null,
    publishedAt: now,
    eventAt: null,
    retrievedAt: now,
    sourceRevisionId: `revision_${id}`,
    locator: {
      kind: "web_snapshot" as const,
      url: `https://example.test/${id}`,
      excerpt: `Persisted ${id} evidence.`,
    },
    sourceRole: "independent_third_party" as const,
    assertionStatus: "reported" as const,
    verificationMethod: null,
    freshness: "current" as const,
    acceptedForGate: true,
  });
  const pack = {
    id: "pack_deterministic_advisory",
    version: 1,
    workspaceId: "workspace_e2e",
    dealId: "deal_e2e",
    asOfDate: "2026-08-10",
    sourceRevisionIds: [
      "revision_fact_customer_signal",
      "revision_fact_risk_signal",
    ],
    facts: [
      fact(
        "fact_customer_signal",
        "customer_evidence",
        "Persisted customer signal",
      ),
      fact("fact_risk_signal", "risk_evidence", "Persisted risk signal"),
    ],
    assumptions: [],
    conflicts: [],
    coverage: {
      minimumModelInputsComplete: false,
      criticalEvidenceComplete: false,
      missingFieldIds: ["retention"],
      blockingConflictIds: [],
      decisionCeiling: null,
      underwritingStatus: "unavailable" as const,
      reasonCodes: ["MISSING_MINIMUM_MODEL_INPUTS"],
    },
    createdAt: now,
  };
  const candidate = {
    id: "candidate_deterministic_advisory",
    batchId: "batch_deterministic_advisory",
    workspaceId: "workspace_e2e",
    dealId: "deal_e2e",
    status: "running" as const,
    candidateAnalysisFingerprint: "candidate-analysis-fixture-v1",
    rerunOfId: null,
    createdAt: now,
    finalizedAt: null,
  };

  const results = await Promise.all(cards.map((card) =>
    runClaudeFrameworkLens({
      client: providers.claudeClient,
      candidate,
      pack,
      context,
      calculations: [],
      card,
      fingerprint: `deterministic-advisory:${card.id}`,
    })
  ));

  assert.ok(results.every(({ judgment }) =>
    judgment.applicability === "applicable"
  ));
  assert.ok(results.some(({ judgment }) => judgment.conclusion === "abstain"));
  assert.ok(results.some(({ passageValidationResult }) =>
    passageValidationResult?.status === "validated"
  ));
  assert.deepEqual(results.flatMap((result, index) =>
    result.judgment.conclusion === "abstain"
      ? result.passageCandidate === null
          && result.passageValidationResult === null
        ? []
        : [{
          cardId: cards[index]!.id,
          result: result.passageValidationResult,
        }]
      : result.passageValidationResult?.status === "validated"
      ? []
      : [{
        cardId: cards[index]!.id,
        result: result.passageValidationResult ?? null,
      }]
  ), []);
});

test("Hush and Henry E2E prose stays inside the production passage-safety boundary", async () => {
  const providers = createBeliefReversalDeterministicProviders();
  const context = {
    id: "underwriting_context_series_a_enterprise_ai_v1",
    contextVersion: "1",
    analysisMode: "core_only" as const,
    stage: "series_a" as const,
    businessModel: "enterprise_ai" as const,
    geography: "global" as const,
    securityType: "preferred" as const,
    asOfDate: "2026-08-01",
    criticalEvidenceProfileId:
      "critical_evidence_series_a_enterprise_ai_v1",
    benchmarkPackId: null,
    benchmarkCompatibility: "unavailable" as const,
    valuationMethodPolicyId:
      "valuation_method_series_a_enterprise_ai_v1",
    decisionPolicyId: "decision_policy_series_a_enterprise_ai_v1",
    frameworkPackId: "framework_pack_synthetic_universal_saas_ai_v1",
  };
  const catalog = await loadResearchFrameworkCatalog({ context });
  const cards = authorizedResearchComposites(catalog)
    .filter(({ experimentalAdvisory }) =>
      experimentalAdvisory.applicable
      && experimentalAdvisory.components.some(({ sourceRefs }) =>
        sourceRefs.length > 0
      )
    );
  const now = "2026-08-10T12:00:00.000Z";
  const scenarios = [{
    dealId: "deal_hush_security_v1",
    support:
      "Kyndryl reportedly deployed Hush internally and began reselling it",
    counter: "AI agent governance",
  }, {
    dealId: "deal_henry_ai_v1",
    support:
      "Company-reported reduction from 15 hours to about 30 minutes of human review per deliverable",
    counter:
      "Enterprise software that automates commercial-real-estate deal decks",
  }] as const;

  for (const scenario of scenarios) {
    const fact = (id: string, field: string, value: string) => ({
      id,
      analysisType: "fact" as const,
      provenanceOrigin: "public_source" as const,
      field,
      value,
      unit: null,
      currency: null,
      periodStart: null,
      periodEnd: null,
      publishedAt: now,
      eventAt: null,
      retrievedAt: now,
      sourceRevisionId: `revision_${scenario.dealId}_${id}`,
      locator: {
        kind: "web_snapshot" as const,
        url: `https://example.test/${scenario.dealId}/${id}`,
        excerpt: value,
      },
      sourceRole: "independent_third_party" as const,
      assertionStatus: "reported" as const,
      verificationMethod: null,
      freshness: "current" as const,
      acceptedForGate: true,
    });
    const pack = {
      id: `pack_${scenario.dealId}`,
      version: 1,
      workspaceId: "workspace_e2e",
      dealId: scenario.dealId,
      asOfDate: "2026-08-10",
      sourceRevisionIds: [
        `revision_${scenario.dealId}_fact_customer_signal`,
        `revision_${scenario.dealId}_fact_business_model`,
      ],
      facts: [
        fact("fact_customer_signal", "customer_evidence", scenario.support),
        fact("fact_business_model", "business_model", scenario.counter),
      ],
      assumptions: [],
      conflicts: [],
      coverage: {
        minimumModelInputsComplete: false,
        criticalEvidenceComplete: false,
        missingFieldIds: ["retention"],
        blockingConflictIds: [],
        decisionCeiling: null,
        underwritingStatus: "unavailable" as const,
        reasonCodes: ["MISSING_MINIMUM_MODEL_INPUTS"],
      },
      createdAt: now,
    };
    const candidate = {
      id: `candidate_${scenario.dealId}`,
      batchId: "batch_deterministic_passage_safety",
      workspaceId: "workspace_e2e",
      dealId: scenario.dealId,
      status: "running" as const,
      candidateAnalysisFingerprint: "candidate-analysis-fixture-v1",
      rerunOfId: null,
      createdAt: now,
      finalizedAt: null,
    };
    const results = await Promise.all(cards.map((card) =>
      runClaudeFrameworkLens({
        client: providers.claudeClient,
        candidate,
        pack,
        context,
        calculations: [],
        card,
        fingerprint: `deterministic-passage-safety:${scenario.dealId}:${card.id}`,
      })
    ));
    const unsafe = results.flatMap((result, index) =>
      result.passageValidationResult?.status === "withheld"
        && (
          result.passageValidationResult.reasonCode === "unsafe_passage_voice"
          || result.passageValidationResult.reasonCode === "unsafe_passage_action"
        )
        ? [{
          frameworkCardId: cards[index]!.id,
          reasonCode: result.passageValidationResult.reasonCode,
        }]
        : []
    );
    assert.deepEqual(unsafe, [], `${scenario.dealId} unsafe passages`);
  }
});

test("deterministic E2E abstains without a passage when the Hush and Irregular binding cannot satisfy the current canonical passage contract", async () => {
  const providers = createBeliefReversalDeterministicProviders();
  const cases = [{
    companyName: "Hush Security",
    context: {
      id: "underwriting_context_series_a_enterprise_ai_v1",
      contextVersion: "1" as const,
      analysisMode: "core_only" as const,
      stage: "series_a" as const,
      businessModel: "enterprise_ai" as const,
      geography: "global" as const,
      securityType: "preferred" as const,
      asOfDate: "2026-08-01",
      criticalEvidenceProfileId:
        "critical_evidence_series_a_enterprise_ai_v1",
      benchmarkPackId: null,
      benchmarkCompatibility: "unavailable" as const,
      valuationMethodPolicyId:
        "valuation_method_series_a_enterprise_ai_v1",
      decisionPolicyId: "decision_policy_series_a_enterprise_ai_v1",
      frameworkPackId:
        "framework_pack_synthetic_universal_saas_ai_v1",
    },
    packId: "expectations_investing_public_frameworks_v0_1",
    expectedFocus: {
      componentFrameworkId: "EI-08",
      cardFieldRef: "decisionQuestions[4]",
      evidenceDomainCodes: ["valuation", "portfolio_risk"],
    },
  }, {
    companyName: "Irregular",
    context: {
      id: "underwriting_context_series_a_enterprise_ai_v1",
      contextVersion: "1" as const,
      analysisMode: "core_only" as const,
      stage: "series_a" as const,
      businessModel: "enterprise_ai" as const,
      geography: "unavailable" as const,
      securityType: "preferred" as const,
      asOfDate: "2026-08-01",
      criticalEvidenceProfileId:
        "critical_evidence_series_a_enterprise_ai_v1",
      benchmarkPackId: null,
      benchmarkCompatibility: "unavailable" as const,
      valuationMethodPolicyId:
        "valuation_method_series_a_enterprise_ai_v1",
      decisionPolicyId: "decision_policy_series_a_enterprise_ai_v1",
      frameworkPackId:
        "framework_pack_synthetic_universal_saas_ai_v1",
    },
    packId: "hamilton_helmer_7_powers_public_frameworks_v0_1",
    expectedFocus: {
      componentFrameworkId: "H7P-08",
      cardFieldRef: "decisionQuestions[0]",
      evidenceDomainCodes: ["product", "operations"],
    },
  }] as const;
  const now = "2026-08-10T12:00:00.000Z";
  const pack = {
    id: "pack_exact_taxonomy_order",
    version: 1,
    workspaceId: "workspace_e2e",
    dealId: "deal_e2e",
    asOfDate: "2026-08-10",
    sourceRevisionIds: ["revision_fact_a", "revision_fact_b"],
    facts: [{
      id: "fact_a",
      analysisType: "fact" as const,
      provenanceOrigin: "public_source" as const,
      field: "customer_evidence",
      value: "Persisted customer signal",
      unit: null,
      currency: null,
      periodStart: null,
      periodEnd: null,
      publishedAt: now,
      eventAt: null,
      retrievedAt: now,
      sourceRevisionId: "revision_fact_a",
      locator: {
        kind: "web_snapshot" as const,
        url: "https://example.test/fact-a",
        excerpt: "Persisted customer evidence.",
      },
      sourceRole: "independent_third_party" as const,
      assertionStatus: "reported" as const,
      verificationMethod: null,
      freshness: "current" as const,
      acceptedForGate: true,
    }, {
      id: "fact_b",
      analysisType: "fact" as const,
      provenanceOrigin: "public_source" as const,
      field: "risk_evidence",
      value: "Persisted risk signal",
      unit: null,
      currency: null,
      periodStart: null,
      periodEnd: null,
      publishedAt: now,
      eventAt: null,
      retrievedAt: now,
      sourceRevisionId: "revision_fact_b",
      locator: {
        kind: "web_snapshot" as const,
        url: "https://example.test/fact-b",
        excerpt: "Persisted risk evidence.",
      },
      sourceRole: "independent_third_party" as const,
      assertionStatus: "reported" as const,
      verificationMethod: null,
      freshness: "current" as const,
      acceptedForGate: true,
    }],
    assumptions: [],
    conflicts: [],
    coverage: {
      minimumModelInputsComplete: false,
      criticalEvidenceComplete: false,
      missingFieldIds: ["retention"],
      blockingConflictIds: [],
      decisionCeiling: null,
      underwritingStatus: "unavailable" as const,
      reasonCodes: ["MISSING_MINIMUM_MODEL_INPUTS"],
    },
    createdAt: now,
  };
  const candidate = {
    id: "candidate_exact_taxonomy_order",
    batchId: "batch_exact_taxonomy_order",
    workspaceId: "workspace_e2e",
    dealId: "deal_e2e",
    status: "running" as const,
    candidateAnalysisFingerprint: "candidate-analysis-fixture-v1",
    rerunOfId: null,
    createdAt: now,
    finalizedAt: null,
  };

  for (const fixtureCase of cases) {
    const catalog = await loadResearchFrameworkCatalog({
      context: fixtureCase.context,
    });
    const card = authorizedResearchComposites(catalog).find(
      ({ experimentalAdvisory }) =>
        experimentalAdvisory.packId === fixtureCase.packId,
    );
    assert.ok(card, `${fixtureCase.companyName} advisory Card is missing`);
    const result = await runClaudeFrameworkLens({
      client: providers.claudeClient,
      candidate,
      pack,
      context: fixtureCase.context,
      calculations: [],
      card,
      fingerprint: `deterministic-exact-order:${fixtureCase.packId}`,
    });
    const selectedBinding = card.experimentalAdvisory
      .decisionTaxonomyBindings.find(({ frameworkId, cardFieldRef }) =>
        frameworkId === fixtureCase.expectedFocus.componentFrameworkId
        && cardFieldRef === fixtureCase.expectedFocus.cardFieldRef
      );
    assert.ok(selectedBinding);
    assert.deepEqual(
      selectedBinding.evidenceDomainCodes,
      fixtureCase.expectedFocus.evidenceDomainCodes,
    );
    assert.equal(result.judgment.applicability, "applicable");
    assert.equal(result.judgment.conclusion, "abstain");
    assert.equal(result.passageCandidate, null);
    assert.equal(result.passageValidationResult, null);

    const priorities = prioritizeNamedLensJudgments({
      judgments: [result.judgment],
      criticalEvidence: [],
      taxonomyByFrameworkId: { [card.id]: selectedBinding },
    });
    assert.deepEqual(
      priorities,
      [],
      `${fixtureCase.companyName} must retain a typed abstention without a fake passage`,
    );
  }
});

test("persistent replay count snapshot reads exact durable PostgREST row counts", async () => {
  const requested: Array<{ url: string; init: RequestInit }> = [];
  const counts = await readBeliefReversalReplayPersistentCounts({
    target: {
      databaseName: "vsee_e2e_task12_unit_0123456789abcdef",
      postgresVersion: "17.6",
      postgrestUrl: "http://127.0.0.1:43123/",
      postgrestVersion: "12.2.3",
      serviceRoleKey: "unit-service-role-key",
    },
    workspaceId: "workspace_e2e",
    fetchImpl: async (url, init = {}) => {
      requested.push({ url: String(url), init });
      const path = new URL(String(url)).pathname;
      const total = path.endsWith("/reasoner_judgments")
        ? 1
        : path.endsWith("/xtrace_ingest_intents_v2")
        ? 85
        : path.endsWith("/xtrace_memory_links_v2")
        ? 85
        : -1;
      return new Response("[]", {
        status: 206,
        headers: { "content-range": `0-0/${total}` },
      });
    },
  });

  assert.deepEqual(counts, {
    reasonerJudgments: 1,
    xtraceIngestIntents: 85,
    xtraceMemoryLinks: 85,
  });
  assert.equal(requested.length, 3);
  assert.ok(requested.every(({ init }) => init.method === "GET"));
  assert.ok(requested.every(({ init }) =>
    new Headers(init.headers).get("prefer") === "count=exact"
  ));
  assert.ok(requested.slice(1).every(({ url }) =>
    new URL(url).searchParams.get("workspace_id") === "eq.workspace_e2e"
  ));
});

test("persistent replay count snapshot fails closed without an exact PostgREST count", async () => {
  await assert.rejects(
    readBeliefReversalReplayPersistentCounts({
      target: {
        databaseName: "vsee_e2e_task12_unit_0123456789abcdef",
        postgresVersion: "17.6",
        postgrestUrl: "http://127.0.0.1:43123/",
        postgrestVersion: "12.2.3",
        serviceRoleKey: "unit-service-role-key",
      },
      workspaceId: "workspace_e2e",
      fetchImpl: async () => Response.json([]),
    }),
    /exact durable row count/u,
  );
});

test("live isolation probe re-reads run, step, lineage, source, sample, and rate-limit state", async () => {
  const totals = new Map([
    ["scan_runs", 2],
    ["scan_run_steps", 14],
    ["source_revisions", 80],
    ["deal_interactions", 23],
    ["reasoner_judgments", 1],
    ["xtrace_ingest_intents_v2", 85],
    ["xtrace_memory_links_v2", 85],
  ]);
  const counts = await readBeliefReversalIsolationPersistentCounts({
    target: {
      databaseName: "vsee_e2e_task12_unit_0123456789abcdef",
      postgresVersion: "17.6",
      postgrestUrl: "http://127.0.0.1:43123/",
      postgrestVersion: "12.2.3",
      serviceRoleKey: "unit-service-role-key",
    },
    workspaceId: "workspace_e2e",
    fetchImpl: async (request) => {
      const table = new URL(String(request)).pathname.split("/").at(-1)!;
      if (table === "public_request_limits") {
        return Response.json([{ request_count: 4 }, { request_count: 5 }]);
      }
      const total = totals.get(table);
      assert.notEqual(total, undefined);
      return new Response("[]", {
        status: 206,
        headers: { "content-range": `0-0/${total}` },
      });
    },
  });

  assert.deepEqual(counts, {
    scanRuns: 2,
    scanRunSteps: 14,
    sourceRevisions: 80,
    sampleInteractions: 23,
    reasonerJudgments: 1,
    xtraceIngestIntents: 85,
    xtraceMemoryLinks: 85,
    rateLimitRequests: 9,
  });
});

test("persistent replay delta rejects any new reasoner or exact-lineage row", () => {
  const first = {
    reasonerJudgments: 1,
    xtraceIngestIntents: 85,
    xtraceMemoryLinks: 85,
  };
  assert.deepEqual(assertBeliefReversalReplayPersistence(first, first), {
    before: first,
    after: first,
    delta: {
      reasonerJudgments: 0,
      xtraceIngestIntents: 0,
      xtraceMemoryLinks: 0,
    },
  });
  assert.throws(
    () => assertBeliefReversalReplayPersistence(first, {
      ...first,
      reasonerJudgments: 2,
    }),
    /reuse durable reasoner judgments/u,
  );
  assert.throws(
    () => assertBeliefReversalReplayPersistence(first, {
      ...first,
      xtraceMemoryLinks: 86,
    }),
    /reuse durable reasoner judgments/u,
  );
});

test("pinned replay requires shared evidence identity and authentic run-scoped bindings", () => {
  const workspaceId = "workspace_e2e";
  const firstRunId = "11111111-1111-4111-8111-111111111111";
  const replayRunId = "22222222-2222-4222-8222-222222222222";
  const bindingFingerprint = (runId: string) => {
    const hash = createHash("sha256");
    for (const frame of [
      "run-evidence-binding-v1",
      workspaceId,
      runId,
      `sha256:${"2".repeat(64)}`,
      `sha256:${"3".repeat(64)}`,
      "4",
    ]) {
      const bytes = Buffer.from(frame, "utf8");
      hash.update(`${bytes.length}:`);
      hash.update(bytes);
    }
    return `sha256:${hash.digest("hex")}`;
  };
  const reportEvidenceContext = {
    state: "current" as const,
    schemaVersion: "run-evidence-context-v1" as const,
    evidenceMode: "pinned" as const,
    windowDays: 14 as const,
    anchorAt: "2026-08-01T23:59:59.999Z",
    windowStartAt: "2026-07-19T00:00:00.000Z",
    windowEndAt: "2026-08-01T23:59:59.999Z",
    windowTimezone: "America/Los_Angeles",
    snapshotId: "belief_reversal_2026_08_01",
    snapshotFingerprint: `sha256:${"1".repeat(64)}`,
    contextFingerprint: `sha256:${"2".repeat(64)}`,
    displayLabel: "Demo evidence snapshot as of 2026-08-01",
    eventCount: 4,
    eventSetFingerprint: `sha256:${"3".repeat(64)}`,
    bindingFingerprint: bindingFingerprint(firstRunId),
  };
  const runEvidenceContext = {
    state: reportEvidenceContext.state,
    schemaVersion: reportEvidenceContext.schemaVersion,
    evidenceMode: reportEvidenceContext.evidenceMode,
    windowDays: reportEvidenceContext.windowDays,
    anchorAt: reportEvidenceContext.anchorAt,
    windowStartAt: reportEvidenceContext.windowStartAt,
    windowEndAt: reportEvidenceContext.windowEndAt,
    windowTimezone: reportEvidenceContext.windowTimezone,
    snapshotId: reportEvidenceContext.snapshotId,
    snapshotFingerprint: reportEvidenceContext.snapshotFingerprint,
    contextFingerprint: reportEvidenceContext.contextFingerprint,
  };
  const first = {
    run: { id: firstRunId, workspaceId, evidenceContext: runEvidenceContext },
    report: { evidenceContext: reportEvidenceContext },
  };
  const replay = structuredClone(first);
  replay.run.id = replayRunId;
  replay.report.evidenceContext.bindingFingerprint = bindingFingerprint(replayRunId);

  assert.doesNotThrow(() => assertBeliefReversalReplayEvidenceIdentity(
    first,
    replay,
  ));
  const changed = structuredClone(replay);
  changed.report.evidenceContext.bindingFingerprint =
    `sha256:${"5".repeat(64)}`;
  assert.throws(
    () => assertBeliefReversalReplayEvidenceIdentity(first, changed),
    /replay evidence identity/u,
  );

  const reportWindowChanged = structuredClone(replay);
  reportWindowChanged.report.evidenceContext.anchorAt =
    "2026-08-02T23:59:59.999Z";
  assert.throws(
    () => assertBeliefReversalReplayEvidenceIdentity(
      first,
      reportWindowChanged,
    ),
    /replay evidence identity/u,
  );
});

const CURRENT_SCREENING_DEALS = [
  "deal_centralize_v1",
  "deal_chipagents_v1",
  "deal_sent_v1",
  "deal_cascade_v1",
  "deal_cordant_v1",
  "deal_empirical_security_v1",
  "deal_freight_hero_v1",
] as const;

function currentColdPassFixture() {
  const workspaceId = "workspace_current_30";
  const runId = "33333333-3333-4333-8333-333333333333";
  const reportId = `report_${runId}`;
  const batchId = `batch_${runId}`;
  const beliefRevisedDeals = [
    "deal_henry_ai_v1",
    "deal_smallest_ai_v1",
    "deal_hush_security_v1",
    "deal_irregular_v1",
  ];
  const noChangeDeals = Array.from(
    { length: 19 },
    (_, index) => `deal_original_${index + 1}`,
  );
  const analysis = (
    dealId: string,
    outcome: "belief_revised" | "monitor" | "no_material_change",
    index: number,
  ) => ({
    id: `${reportId}:${dealId}`,
    reportId,
    runId,
    dealId,
    companyName: dealId,
    dealStatus: CURRENT_SCREENING_DEALS.includes(
        dealId as typeof CURRENT_SCREENING_DEALS[number]
      )
      ? "screening"
      : "watchlist",
    outcome,
    confidence: outcome === "belief_revised" ? "high" : "low",
    score: outcome === "belief_revised" ? 0.95 - index * 0.01 : 0.2,
    currentRunAudit: {
      schemaVersion: "company-analysis-current-run-audit-v1",
      workspaceId,
      companyId: `company_${dealId}`,
      stableDealId: dealId,
      priorDealStatus: CURRENT_SCREENING_DEALS.includes(
          dealId as typeof CURRENT_SCREENING_DEALS[number]
        )
        ? "screening"
        : "watchlist",
      analysisEligibleAt: "2026-08-03T12:00:00.000Z",
      dealUniverseId: `deal_universe_${runId}`,
      dealUniverseFingerprint: `sha256:${"a".repeat(64)}`,
      evidenceContextFingerprint: `sha256:${"b".repeat(64)}`,
      evidenceBindingFingerprint: `sha256:${"c".repeat(64)}`,
      priorMemory: {
        kind: CURRENT_SCREENING_DEALS.includes(
            dealId as typeof CURRENT_SCREENING_DEALS[number]
          )
          ? "screening"
          : "investment",
      },
      outcome,
    },
  });
  const companyAnalyses = [
    ...beliefRevisedDeals.map((dealId, index) =>
      analysis(dealId, "belief_revised", index)
    ),
    ...CURRENT_SCREENING_DEALS.map((dealId, index) =>
      analysis(dealId, "monitor", index)
    ),
    ...noChangeDeals.map((dealId, index) =>
      analysis(dealId, "no_material_change", index)
    ),
  ];
  const selections = beliefRevisedDeals.map((dealId, index) => ({
    batchId,
    dealId,
    status: "selected",
    rank: index + 1,
    reason: "Belief revision admitted to Deep Underwriting.",
  }));
  const candidates = beliefRevisedDeals.map((dealId) => ({
    id: `candidate_${dealId}`,
    workspaceId,
    batchId,
    dealId,
    status: "completed",
  }));
  return {
    report: {
      id: reportId,
      workspaceId,
      runId,
      counts: {
        companyCount: 30,
        beliefRevised: 4,
        monitor: 7,
        noMaterialChange: 19,
        analysisUnavailable: 0,
      },
      companyAnalyses,
      evidenceContext: {
        state: "current",
        evidenceMode: "live",
        contextFingerprint: `sha256:${"b".repeat(64)}`,
        bindingFingerprint: `sha256:${"c".repeat(64)}`,
      },
    },
    batch: { id: batchId, workspaceId, scanRunId: runId, status: "completed" },
    selections,
    candidates,
    artifacts: candidates.map((candidate) => ({
      candidateRunId: candidate.id,
      workspaceId,
      dealId: candidate.dealId,
    })),
  };
}

test("current cold pass proves 30 audited Deals, 4/7/19/0 outcomes, and every belief revision enters Deep Underwriting", () => {
  const fixture = currentColdPassFixture();

  assert.doesNotThrow(() => assertCurrentBeliefReversalColdPass(fixture, {
    beliefRevisionCapableDealIds: fixture.report.companyAnalyses
      .filter(({ outcome }) => outcome === "belief_revised")
      .map(({ dealId }) => dealId),
  }));
});

test("screening Deals may become belief revised outside the controlled four-event fixture", () => {
  const fixture = currentColdPassFixture();
  const screening = fixture.report.companyAnalyses.find(
    ({ dealId }) => dealId === "deal_centralize_v1",
  );
  assert.ok(screening);
  screening.outcome = "belief_revised";
  screening.confidence = "high";
  screening.score = 0.9;
  screening.currentRunAudit.outcome = "belief_revised";
  fixture.report.counts.beliefRevised = 5;
  fixture.report.counts.monitor = 6;
  fixture.selections.push({
    batchId: fixture.batch.id,
    dealId: screening.dealId,
    status: "selected",
    rank: 5,
    reason: "Belief revision admitted to Deep Underwriting.",
  });
  const candidate = {
    id: `candidate_${screening.dealId}`,
    workspaceId: fixture.report.workspaceId,
    batchId: fixture.batch.id,
    dealId: screening.dealId,
    status: "completed",
  };
  fixture.candidates.push(candidate);
  fixture.artifacts.push({
    candidateRunId: candidate.id,
    workspaceId: candidate.workspaceId,
    dealId: candidate.dealId,
  });

  assert.doesNotThrow(() => assertCurrentBeliefReversalColdPass(fixture));
  assert.throws(
    () => assertCurrentBeliefReversalColdPass(fixture, {
      beliefRevisionCapableDealIds: [
        "deal_henry_ai_v1",
        "deal_smallest_ai_v1",
        "deal_hush_security_v1",
        "deal_irregular_v1",
      ],
    }),
    /outside the reviewed case set/u,
  );
});

test("current 30-Deal acceptance permits only live evidence or the exact pinned-30 snapshot identity", () => {
  const pinnedThirty = currentColdPassFixture();
  const pinnedThirtyContext = pinnedThirty.report.evidenceContext as
    Record<string, unknown>;
  pinnedThirtyContext.evidenceMode = "pinned";
  pinnedThirtyContext.snapshotId = PINNED_THIRTY_DEAL_SNAPSHOT_ID;
  pinnedThirtyContext.snapshotFingerprint = `sha256:${"d".repeat(64)}`;
  assert.doesNotThrow(() => assertCurrentBeliefReversalColdPass(pinnedThirty));

  const unreviewedPinned = currentColdPassFixture();
  const unreviewedContext = unreviewedPinned.report.evidenceContext as
    Record<string, unknown>;
  unreviewedContext.evidenceMode = "pinned";
  unreviewedContext.snapshotId = "unreviewed_pinned_snapshot_v1";
  unreviewedContext.snapshotFingerprint = `sha256:${"e".repeat(64)}`;
  assert.throws(
    () => assertCurrentBeliefReversalColdPass(unreviewedPinned),
    /exact pinned-30 snapshot identity/u,
  );
});

test("current cold pass rejects a pre-generated 23-analysis report or rank-based underwriting truncation", () => {
  const fixture = currentColdPassFixture();
  fixture.report.companyAnalyses = fixture.report.companyAnalyses.slice(0, 23);
  assert.throws(
    () => assertCurrentBeliefReversalColdPass(fixture),
    /exactly 30 CompanyAnalyses/u,
  );

  const truncated = currentColdPassFixture();
  truncated.candidates = truncated.candidates.slice(0, 3);
  truncated.artifacts = truncated.artifacts.slice(0, 3);
  assert.throws(
    () => assertCurrentBeliefReversalColdPass(truncated),
    /every and only belief-revised Deal/u,
  );
});
