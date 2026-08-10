import assert from "node:assert/strict";
import test from "node:test";

import type { CompanyAnalysis } from "../../lib/contracts/domain";
import type {
  Calculation,
  EvidencePack,
  Fact,
} from "../../lib/contracts/evidence";
import type {
  DecisionResult,
  FrameworkJudgment,
} from "../../lib/contracts/underwriting";
import type { CandidateGroundingSnapshot } from
  "../../lib/underwriting/candidate-grounding";
import { buildDecisionCriticalEvidenceProjection } from
  "../../lib/underwriting/frameworks/critical-evidence";

const at = "2026-07-29T10:00:00.000Z";

function fact(id: string, sourceRevisionId: string): Fact {
  return {
    id,
    analysisType: "fact",
    provenanceOrigin: "uploaded_document",
    field: id,
    value: "1",
    unit: null,
    currency: null,
    periodStart: null,
    periodEnd: null,
    publishedAt: null,
    eventAt: at,
    retrievedAt: at,
    sourceRevisionId,
    locator: { kind: "text_range", start: 0, end: 1, excerpt: "1" },
    sourceRole: "management",
    assertionStatus: "reported",
    verificationMethod: null,
    freshness: "current",
    acceptedForGate: true,
  };
}

function source(id: string, sourceRevisionId: string, evidenceRole: string) {
  return {
    schemaVersion: "source-ref-v2",
    adaptation: "canonical",
    id,
    provenance: id === "source_prior" ? "source_document" : "public_web",
    title: id,
    canonicalUrl: id === "source_prior" ? null : `https://example.com/${id}`,
    documentId: id === "source_prior" ? id : null,
    publisher: null,
    providerId: null,
    eventAt: at,
    eventAtPrecision: "timestamp",
    publishedAt: at,
    publishedAtPrecision: "timestamp",
    retrievedAt: at,
    retrievedAtPrecision: "timestamp",
    updatedAt: null,
    updatedAtPrecision: null,
    entityKeys: ["company.acme"],
    sourceClass: id === "source_prior"
      ? "internal_decision_record"
      : "company_official",
    sourceAuthority: "primary",
    evidenceRole,
    sourceRevisionId,
    locator: { kind: "line_range", startLine: 1, endLine: 1 },
    contentFingerprint: `sha256:${"a".repeat(64)}`,
    text: { status: "normalized_only", normalizedStatement: id },
  };
}

function fixture() {
  const facts = [
    fact("fact_trigger", "revision_trigger"),
    fact("fact_counter", "revision_counter"),
    fact("fact_prior", "revision_prior"),
    fact("fact_recursive", "revision_financial"),
  ];
  const pack = {
    id: "pack_1",
    version: 1,
    workspaceId: "workspace_1",
    dealId: "deal_1",
    asOfDate: "2026-07-29",
    sourceRevisionIds: [
      "revision_trigger",
      "revision_counter",
      "revision_prior",
      "revision_financial",
    ],
    facts,
    assumptions: [{
      id: "assumption_exit_multiple",
      analysisType: "assumption",
      provenanceOrigin: "benchmark",
      scenario: "base",
      field: "exit_multiple",
      value: "8",
      unit: "multiple",
      rationale: "Saved benchmark assumption.",
      inputRefIds: ["benchmark_1"],
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
    createdAt: at,
  } satisfies EvidencePack;
  const trigger = source("source_trigger", "revision_trigger", "trigger");
  const counter = source(
    "source_counter",
    "revision_counter",
    "counterevidence",
  );
  const prior = source("source_prior", "revision_prior", "context");
  const event = {
    schemaVersion: "market-event-v2",
    adaptation: "canonical",
    id: "event_trigger",
    triggerSourceId: "source_trigger",
    sources: [trigger, counter],
  };
  const analysis = {
    dealId: "deal_1",
    marketEvidence: {
      events: [event],
      eventIds: [event.id],
      sourceIds: ["source_trigger", "source_counter"],
    },
    investmentMemory: {
      memoryIds: ["memory_1"],
      sourceIds: ["source_prior"],
      fixtureIds: [],
    },
    currentRunAudit: {
      matchedMarketEventIds: [event.id],
    },
    beliefAssessment: {
      gateContext: {
        priorInteraction: {
          id: "source_prior",
          sourceIds: ["source_prior"],
        },
        triggerEvent: {
          id: event.id,
          sourceIds: ["source_trigger"],
        },
        sources: [trigger, counter, prior],
      },
      gates: {
        chronology: { passed: true },
        revisitConditionMapping: {
          passed: true,
          citedSourceIds: ["source_trigger"],
        },
        counterevidence: {
          passed: true,
          citedSourceIds: ["source_counter"],
        },
        actionDelta: { passed: true },
      },
      actions: [{ kind: "schedule_partner_meeting" }],
    },
  } as unknown as CompanyAnalysis;
  const grounding = {
    identityEvidence: {},
    sourceRevisionIds: pack.sourceRevisionIds,
    sourceRevisionSnapshots: pack.sourceRevisionIds.map((id) => ({
      id,
      workspaceId: "workspace_1",
      sourceId: id.replace("revision", "source"),
      revision: 1,
      contentHash: `hash:${id}`,
      objectKey: id,
      objectVersion: "1",
      contentType: "text/plain",
      extractorId: "plain_text_v1",
      extractorVersion: "1",
      extractedAt: at,
      supersedesRevisionId: null,
      createdAt: at,
    })),
    xtraceLineage: {
      memoryIds: ["memory_1"],
      sourceRevisionIds: ["revision_prior"],
      sourceIds: ["source_prior"],
      fixtureIds: [],
      capturedAt: at,
    },
  } as unknown as CandidateGroundingSnapshot;
  const calculations = [{
    id: "calculation_outer",
    analysisType: "calculation",
    formulaId: "returns",
    formulaVersion: "1",
    inputRefs: [],
    output: "8",
    unit: "multiple",
    currency: null,
    period: null,
    roundingPolicy: "half_even_display_only",
    computedAt: at,
    status: "completed",
  }, {
    id: "calculation_inner",
    analysisType: "calculation",
    formulaId: "exit_case",
    formulaVersion: "1",
    inputRefs: [{
      itemId: "assumption_exit_multiple",
      value: "8",
      type: "assumption",
    }, {
      itemId: "fact_recursive",
      value: "1",
      type: "fact",
    }],
    output: "8",
    unit: "multiple",
    currency: null,
    period: null,
    roundingPolicy: "half_even_display_only",
    computedAt: at,
    status: "completed",
  }] satisfies Calculation[];
  const decision = {
    id: "decision_1",
    firedRules: [{
      ruleId: "rule_1",
      inputRefs: ["calculation_outer", "fact_counter"],
      result: "pass",
      appliedCeiling: null,
      veto: false,
    }],
    blockingEvidenceItemIds: ["fact_trigger"],
    claimEdges: [],
  } as unknown as DecisionResult;
  return {
    analysis,
    pack,
    grounding,
    calculations,
    calculationClaimEdges: [{
      claimItemId: "calculation_outer",
      dependencyItemId: "calculation_inner",
      dependencyType: "calculation" as const,
    }],
    decision,
    judgments: [] as FrameworkJudgment[],
  };
}

test("resolves formal FrameworkJudgment decision refs through their exact evidence partitions", () => {
  const input = fixture();
  const judgmentId = "judgment_core_1";
  input.judgments = [{
    id: judgmentId,
    analysisType: "framework_judgment",
    frameworkCardId: "framework_card_synthetic_1_v1",
    frameworkVersion: "1",
    applicability: "applicable",
    conclusion: "supportive",
    supportEvidenceItemIds: ["fact_trigger"],
    counterEvidenceItemIds: ["fact_counter"],
    unusedEvidenceItemIds: [
      "assumption_exit_multiple",
      "fact_prior",
      "fact_recursive",
    ],
    strongestSupport: "The exact trigger supports the formal lens.",
    strongestCounterargument:
      "The exact counterevidence bounds the formal lens.",
    unknowns: [],
    limitations: [],
    confidence: {
      sourceReliability: "high",
      evidenceStrength: "high",
      evidenceCoverage: "medium",
      applicability: "high",
      judgment: "medium",
    },
    claimEdges: [{
      claimItemId: judgmentId,
      dependencyItemId: "fact_counter",
      dependencyType: "fact",
    }, {
      claimItemId: judgmentId,
      dependencyItemId: "fact_trigger",
      dependencyType: "fact",
    }],
    fingerprint: "formal-judgment-fingerprint",
  }];
  input.decision.firedRules = [{
    ruleId: "rule_framework_judgment",
    inputRefs: [`framework_judgment:${judgmentId}`],
    result: "pass",
    appliedCeiling: null,
    veto: false,
  }];
  input.decision.blockingEvidenceItemIds = [];

  const projection = buildDecisionCriticalEvidenceProjection(input);
  assert.deepEqual(
    projection.map(({ evidencePackItemId }) => evidencePackItemId),
    ["fact_counter", "fact_prior", "fact_trigger"],
  );
  for (const evidenceItemId of ["fact_counter", "fact_trigger"]) {
    assert.ok(projection.find((item) =>
      item.evidencePackItemId === evidenceItemId
    )?.originRefs.some(({ kind, id }) =>
      kind === "fired_rule" && id === "rule_framework_judgment"
    ));
  }
});

test("rejects an arbitrary no-metadata judgment as formal decision authority", () => {
  const input = fixture();
  const judgmentId = "judgment_unregistered_core";
  input.judgments = [{
    id: judgmentId,
    analysisType: "framework_judgment",
    frameworkCardId: "framework_card_unregistered",
    frameworkVersion: "1",
    applicability: "applicable",
    conclusion: "supportive",
    supportEvidenceItemIds: ["fact_trigger"],
    counterEvidenceItemIds: [],
    unusedEvidenceItemIds: [
      "assumption_exit_multiple",
      "fact_counter",
      "fact_prior",
      "fact_recursive",
    ],
    strongestSupport: "A forged unregistered card must not gain authority.",
    strongestCounterargument: null,
    unknowns: [],
    limitations: [],
    confidence: {
      sourceReliability: "high",
      evidenceStrength: "high",
      evidenceCoverage: "medium",
      applicability: "high",
      judgment: "medium",
    },
    claimEdges: [{
      claimItemId: judgmentId,
      dependencyItemId: "fact_trigger",
      dependencyType: "fact",
    }],
    fingerprint: "unregistered-judgment-fingerprint",
  }];
  input.decision.firedRules = [{
    ruleId: "rule_unregistered_judgment",
    inputRefs: [`framework_judgment:${judgmentId}`],
    result: "pass",
    appliedCeiling: null,
    veto: false,
  }];
  input.decision.blockingEvidenceItemIds = [];

  assert.throws(
    () => buildDecisionCriticalEvidenceProjection(input),
    /cannot resolve/i,
  );
});

test("validates an exact Evidence Pack authority root without projecting it as evidence", () => {
  const input = fixture();
  input.decision.firedRules = [{
    ruleId: "rule_pack_root",
    inputRefs: [`evidence_pack:${input.pack.id}`, "fact_counter"],
    result: "pass",
    appliedCeiling: null,
    veto: false,
  }];
  input.decision.blockingEvidenceItemIds = [];

  const projection = buildDecisionCriticalEvidenceProjection(input);
  assert.ok(projection.some(({ evidencePackItemId }) =>
    evidencePackItemId === "fact_counter"
  ));
  assert.equal(
    projection.some(({ evidencePackItemId }) =>
      evidencePackItemId === `evidence_pack:${input.pack.id}`
    ),
    false,
  );
});

test("fails closed for a foreign Evidence Pack authority root", () => {
  const input = fixture();
  input.decision.firedRules = [{
    ruleId: "rule_foreign_pack_root",
    inputRefs: ["evidence_pack:pack_foreign"],
    result: "pass",
    appliedCeiling: null,
    veto: false,
  }];
  input.decision.blockingEvidenceItemIds = [];

  assert.throws(
    () => buildDecisionCriticalEvidenceProjection(input),
    /cannot resolve|Evidence Pack/i,
  );
});

test("projects exact MarketEvent, gate, memory, decision, and recursive Calculation lineage", () => {
  const projection = buildDecisionCriticalEvidenceProjection(fixture());

  assert.deepEqual(
    projection.map(({ evidencePackItemId }) => evidencePackItemId),
    [
      "assumption_exit_multiple",
      "fact_counter",
      "fact_prior",
      "fact_recursive",
      "fact_trigger",
    ],
  );
  const prior = projection.find((item) =>
    item.evidencePackItemId === "fact_prior"
  );
  assert.ok(prior?.originRefs.some(({ kind, id }) =>
    kind === "xtrace_memory" && id === "memory_1"
  ));
  assert.ok(prior?.originRefs.some(({ kind, id }) =>
    kind === "prior_record" && id === "source_prior"
  ));
  assert.ok(projection.find((item) =>
    item.evidencePackItemId === "assumption_exit_multiple"
  )?.resolutionPath.includes("calculation_inner"));
  const calculationInput = projection.find((item) =>
    item.evidencePackItemId === "assumption_exit_multiple"
  );
  assert.ok(calculationInput?.originRefs.some(({ kind, id }) =>
    kind === "fired_rule" && id === "rule_1"
  ));
  assert.ok(calculationInput?.originRefs.some(({ kind, id }) =>
    kind === "calculation" && id === "calculation_inner"
  ));
});

test("resolves a raw candidate-local Calculation ID containing colons before typed-ref parsing", () => {
  const input = fixture();
  const outer = input.calculations.find(({ id }) => id === "calculation_outer")!;
  outer.id = "calculation:scope:outer";
  input.calculationClaimEdges[0]!.claimItemId = outer.id;
  input.decision.firedRules[0]!.inputRefs = [outer.id];
  input.decision.blockingEvidenceItemIds = [];

  const projection = buildDecisionCriticalEvidenceProjection(input);
  assert.ok(projection.some(({ evidencePackItemId }) =>
    evidencePackItemId === "assumption_exit_multiple"
  ));
  assert.ok(projection.some(({ evidencePackItemId }) =>
    evidencePackItemId === "fact_recursive"
  ));
});

test("rejects a mis-typed or missing Calculation claim-edge bridge", () => {
  const input = fixture();
  const outer = input.calculations.find(({ id }) => id === "calculation_outer")!;
  outer.inputRefs = [{
    itemId: "calculation_inner",
    value: "8",
    type: "assumption",
  }];
  input.calculationClaimEdges = [];

  assert.throws(
    () => buildDecisionCriticalEvidenceProjection(input),
    /cannot resolve/i,
  );
});

test("deduplicates repeated exact origins and is independent of typed action identity", () => {
  const first = fixture();
  const second = fixture();
  (second.analysis.beliefAssessment as { actions: unknown[] }).actions = [{
    kind: "deprioritize",
    displayName: "A famous investor",
  }];
  second.decision.blockingEvidenceItemIds.push("fact_trigger");

  assert.deepEqual(
    buildDecisionCriticalEvidenceProjection(first),
    buildDecisionCriticalEvidenceProjection(second),
  );
});

test("fails closed when an origin has no exact candidate-local Pack-item bridge", () => {
  const input = fixture();
  const event = input.analysis.marketEvidence.events[0] as {
    sources: Array<{ sourceRevisionId: string | null }>;
  };
  event.sources[0]!.sourceRevisionId = "revision_unresolved";

  assert.throws(
    () => buildDecisionCriticalEvidenceProjection(input),
    /cannot resolve to a candidate-local Evidence Pack item/i,
  );
});

test("rejects foreign workspace lineage and unresolved decision origins", () => {
  const foreign = fixture();
  foreign.grounding.sourceRevisionSnapshots[0]!.workspaceId = "workspace_2";
  assert.throws(
    () => buildDecisionCriticalEvidenceProjection(foreign),
    /candidate-local|workspace/i,
  );

  const unresolvedDecision = fixture();
  unresolvedDecision.decision.firedRules[0]!.inputRefs.push("judgment_foreign");
  assert.throws(
    () => buildDecisionCriticalEvidenceProjection(unresolvedDecision),
    /cannot resolve to a candidate-local Evidence Pack item/i,
  );
});

test("fails closed instead of inventing a Cartesian bridge for aggregate multi-memory XTrace lineage", () => {
  const input = fixture();
  input.grounding.xtraceLineage.memoryIds.push("memory_2");
  (input.analysis.investmentMemory.memoryIds as string[]).push("memory_2");

  assert.throws(
    () => buildDecisionCriticalEvidenceProjection(input),
    /XTrace|memory|cannot resolve|ambiguous/i,
  );
});

test("projects saved prior-memory source IDs even without a belief-assessment gate context", () => {
  const input = fixture();
  input.analysis.beliefAssessment = undefined;

  const prior = buildDecisionCriticalEvidenceProjection(input).find((item) =>
    item.evidencePackItemId === "fact_prior"
  );
  assert.ok(prior?.originRefs.some(({ kind, id }) =>
    kind === "prior_record" && id === "source_prior"
  ));
});

test("resolves canonical Sample fixture source IDs without adding a source prefix", () => {
  const input = fixture();
  const fixtureFact = fact("fact_fixture", "revision_fixture");
  input.pack.facts.push(fixtureFact);
  input.pack.sourceRevisionIds.push("revision_fixture");
  input.grounding.sourceRevisionIds.push("revision_fixture");
  input.grounding.sourceRevisionSnapshots.push({
    id: "revision_fixture",
    workspaceId: "workspace_1",
    sourceId: "source_fixture_1",
    revision: 1,
    contentHash: "hash:revision_fixture",
    objectKey: "revision_fixture",
    objectVersion: "1",
    contentType: "text/plain",
    extractorId: "plain_text_v1",
    extractorVersion: "1",
    extractedAt: at,
    supersedesRevisionId: null,
    createdAt: at,
  });
  (input.analysis.investmentMemory.sourceIds as string[]).push(
    "source_fixture_1",
  );
  (input.analysis.investmentMemory.fixtureIds as string[]).push(
    "source_fixture_1",
  );

  const projected = buildDecisionCriticalEvidenceProjection(input).find(
    ({ evidencePackItemId }) => evidencePackItemId === "fact_fixture",
  );
  assert.ok(projected?.originRefs.some(({ kind, id }) =>
    kind === "prior_record" && id === "source_fixture_1"
  ));
  assert.equal(
    projected?.resolutionPath.includes("source_source_fixture_1"),
    false,
  );
});

test("rejects malformed and double-prefixed persisted fixture source IDs", () => {
  for (const malformedId of ["fixture_1", "source_source_fixture_1"]) {
    const input = fixture();
    (input.analysis.investmentMemory.fixtureIds as string[]).push(malformedId);
    assert.throws(
      () => buildDecisionCriticalEvidenceProjection(input),
      /cannot resolve to a candidate-local Evidence Pack item/i,
      malformedId,
    );
  }
});
