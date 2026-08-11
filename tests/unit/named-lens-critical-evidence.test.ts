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
    documentId: id,
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
  facts[2] = {
    ...facts[2]!,
    provenanceOrigin: "demo_fixture",
    field: "sample_decision_context",
    acceptedForGate: false,
  };
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

test("selects two or three deterministic first-screen refs from the exact projection instead of raw typed decision refs", async () => {
  const presentationModule = await import(
    "../../lib/underwriting/named-lens-presentation"
  ) as Record<string, unknown>;
  const select = presentationModule.selectFirstScreenDecisionEvidenceIds;
  assert.equal(
    typeof select,
    "function",
    "the first-screen selector must consume the resolved candidate-local projection",
  );
  if (typeof select !== "function") return;

  const evidenceRefs = [{
    evidencePackItemId: "fact_prior",
    classification: "fact",
    originRefs: [{ kind: "prior_record", id: "record_1" }],
    reasonCodes: ["BELIEF_CHANGE_PRIOR_RECORD"],
    resolutionPath: ["record_1", "fact_prior"],
  }, {
    evidencePackItemId: "fact_event",
    classification: "fact",
    originRefs: [{ kind: "market_event", id: "event_1" }],
    reasonCodes: ["BELIEF_CHANGE_MARKET_EVENT"],
    resolutionPath: ["event_1", "fact_event"],
  }, {
    evidencePackItemId: "fact_counter",
    classification: "fact",
    originRefs: [{ kind: "counterevidence_gate", id: "claim_counter" }],
    reasonCodes: ["BELIEF_CHANGE_COUNTEREVIDENCE_GATE"],
    resolutionPath: ["claim_counter", "fact_counter"],
  }, {
    evidencePackItemId: "fact_revisit",
    classification: "fact",
    originRefs: [{ kind: "revisit_gate", id: "claim_revisit" }],
    reasonCodes: ["BELIEF_CHANGE_REVISIT_GATE"],
    resolutionPath: ["claim_revisit", "fact_revisit"],
  }];

  assert.deepEqual(
    (select as (refs: unknown[]) => string[])(evidenceRefs),
    ["fact_counter", "fact_event", "fact_revisit"],
  );
});

test("first-screen selection prefers formal decision evidence and does not duplicate one Source Revision", async () => {
  const presentationModule = await import(
    "../../lib/underwriting/named-lens-presentation"
  ) as Record<string, unknown>;
  const select = presentationModule.selectFirstScreenDecisionEvidenceIds;
  assert.equal(typeof select, "function");
  if (typeof select !== "function") return;

  const evidenceRefs = [{
    evidencePackItemId: "fact_blocking",
    classification: "fact",
    originRefs: [{ kind: "blocking_evidence", id: "fact_blocking" }],
    reasonCodes: ["FORMAL_DECISION_BLOCKING_EVIDENCE"],
    resolutionPath: ["decision_1", "fact_blocking"],
  }, {
    evidencePackItemId: "fact_rule",
    classification: "fact",
    originRefs: [{ kind: "fired_rule", id: "rule_1" }],
    reasonCodes: ["FORMAL_DECISION_RULE_INPUT"],
    resolutionPath: ["rule_1", "fact_rule"],
  }, {
    evidencePackItemId: "claim_revisit",
    classification: "fact",
    originRefs: [{ kind: "revisit_gate", id: "claim_revisit" }, {
      kind: "source_revision",
      id: "revision_revisit",
    }],
    reasonCodes: ["BELIEF_CHANGE_REVISIT_GATE"],
    resolutionPath: ["claim_revisit", "revision_revisit"],
  }, {
    evidencePackItemId: "semantic_duplicate",
    classification: "fact",
    originRefs: [{ kind: "revisit_gate", id: "claim_revisit" }, {
      kind: "source_revision",
      id: "revision_revisit",
    }],
    reasonCodes: ["BELIEF_CHANGE_REVISIT_GATE"],
    resolutionPath: ["semantic_duplicate", "revision_revisit"],
  }, {
    evidencePackItemId: "fact_counter",
    classification: "fact",
    originRefs: [{ kind: "counterevidence_gate", id: "claim_counter" }],
    reasonCodes: ["BELIEF_CHANGE_COUNTEREVIDENCE_GATE"],
    resolutionPath: ["claim_counter", "fact_counter"],
  }];

  assert.deepEqual(
    (select as (refs: unknown[]) => string[])(evidenceRefs),
    ["claim_revisit", "fact_blocking", "fact_rule"],
  );
});

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
  assert.equal(prior?.classification, "fact");
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

test("resolves canonical claim SourceRefs through documentId and exact Source Revision while preserving claim origins", () => {
  const input = fixture();
  const event = input.analysis.marketEvidence.events[0] as {
    triggerSourceId: string;
    sources: Array<{ id: string; documentId: string | null }>;
  };
  event.triggerSourceId = "claim_trigger";
  event.sources[0]!.id = "claim_trigger";
  event.sources[0]!.documentId = "source_trigger";
  event.sources[1]!.id = "claim_counter";
  event.sources[1]!.documentId = "source_counter";
  input.analysis.marketEvidence.sourceIds = [
    "claim_trigger",
    "claim_counter",
  ];
  const assessment = input.analysis.beliefAssessment!;
  assessment.gateContext.triggerEvent.sourceIds = ["claim_trigger"];
  assessment.gateContext.sources = event.sources as typeof assessment.gateContext.sources;
  assessment.gateContext.sources.push(source(
    "source_prior",
    "revision_prior",
    "context",
  ) as typeof assessment.gateContext.sources[number]);
  assessment.gates.revisitConditionMapping.citedSourceIds = ["claim_trigger"];
  assessment.gates.counterevidence.citedSourceIds = ["claim_counter"];

  const projection = buildDecisionCriticalEvidenceProjection(input);
  const trigger = projection.find(({ evidencePackItemId }) =>
    evidencePackItemId === "fact_trigger"
  );
  const counter = projection.find(({ evidencePackItemId }) =>
    evidencePackItemId === "fact_counter"
  );
  assert.ok(trigger?.originRefs.some(({ kind, id }) =>
    kind === "chronology_gate" && id === "claim_trigger"
  ));
  assert.ok(trigger?.originRefs.some(({ kind, id }) =>
    kind === "revisit_gate" && id === "claim_trigger"
  ));
  assert.ok(counter?.originRefs.some(({ kind, id }) =>
    kind === "counterevidence_gate" && id === "claim_counter"
  ));
  assert.ok(trigger?.resolutionPath.includes("claim_trigger"));
  assert.ok(trigger?.resolutionPath.includes("source_trigger"));
  assert.ok(counter?.resolutionPath.includes("claim_counter"));
  assert.ok(counter?.resolutionPath.includes("source_counter"));
});

test("fails closed when canonical claim SourceRef authority crosses document, revision, workspace, or candidate boundaries", () => {
  const cases: Array<{
    label: string;
    mutate(input: ReturnType<typeof fixture>): void;
  }> = [{
    label: "missing documentId",
    mutate(input) {
      const event = input.analysis.marketEvidence.events[0] as {
        sources: Array<{ id: string; documentId: string | null }>;
      };
      event.sources[0]!.id = "claim_trigger";
      event.sources[0]!.documentId = null;
    },
  }, {
    label: "foreign documentId",
    mutate(input) {
      const event = input.analysis.marketEvidence.events[0] as {
        sources: Array<{ id: string; documentId: string | null }>;
      };
      event.sources[0]!.id = "claim_trigger";
      event.sources[0]!.documentId = "source_foreign";
    },
  }, {
    label: "mismatched exact revision",
    mutate(input) {
      const event = input.analysis.marketEvidence.events[0] as {
        sources: Array<{
          id: string;
          documentId: string | null;
          sourceRevisionId: string | null;
        }>;
      };
      event.sources[0]!.id = "claim_trigger";
      event.sources[0]!.documentId = "source_trigger";
      event.sources[0]!.sourceRevisionId = "revision_counter";
    },
  }, {
    label: "foreign workspace revision",
    mutate(input) {
      input.grounding.sourceRevisionSnapshots[0]!.workspaceId = "workspace_2";
    },
  }, {
    label: "foreign candidate Deal",
    mutate(input) {
      input.pack.dealId = "deal_foreign";
    },
  }];

  for (const { label, mutate } of cases) {
    const input = fixture();
    mutate(input);
    assert.throws(
      () => buildDecisionCriticalEvidenceProjection(input),
      /candidate-local|workspace|cannot resolve/i,
      label,
    );
  }
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

test("projects multi-memory XTrace lineage only through exact persisted parent bindings", () => {
  const input = fixture();
  input.grounding.xtraceLineage.memoryIds.push("memory_2");
  input.grounding.xtraceLineage.sourceRevisionIds.push("revision_trigger");
  input.grounding.xtraceLineage.sourceIds.push("source_trigger");
  input.grounding.xtraceLineage.parentBindings = [{
    kind: "source",
    memoryId: "memory_1",
    sourceRevisionId: "revision_prior",
    sourceId: "source_prior",
    fixtureId: null,
  }, {
    kind: "source",
    memoryId: "memory_2",
    sourceRevisionId: "revision_trigger",
    sourceId: "source_trigger",
    fixtureId: null,
  }];
  (input.analysis.investmentMemory.memoryIds as string[]).push("memory_2");
  (input.analysis.investmentMemory.sourceIds as string[]).push(
    "source_trigger",
  );

  const projection = buildDecisionCriticalEvidenceProjection(input);
  assert.ok(projection.find(({ evidencePackItemId }) =>
    evidencePackItemId === "fact_prior"
  )?.originRefs.some(({ kind, id }) =>
    kind === "xtrace_memory" && id === "memory_1"
  ));
  assert.ok(projection.find(({ evidencePackItemId }) =>
    evidencePackItemId === "fact_trigger"
  )?.originRefs.some(({ kind, id }) =>
    kind === "xtrace_memory" && id === "memory_2"
  ));
});

test("multi-memory XTrace parent bindings reject duplicate, foreign, and owner-mismatched tuples", () => {
  const mutations: Array<{
    label: string;
    mutate(bindings: Array<Record<string, unknown>>): void;
  }> = [{
    label: "duplicate memory",
    mutate(bindings) {
      bindings[1]!.memoryId = "memory_1";
    },
  }, {
    label: "foreign revision",
    mutate(bindings) {
      bindings[1]!.sourceRevisionId = "revision_foreign";
    },
  }, {
    label: "source owner mismatch",
    mutate(bindings) {
      bindings[1]!.sourceId = "source_counter";
    },
  }, {
    label: "source advertised as fixture",
    mutate(bindings) {
      bindings[1] = {
        kind: "fixture",
        memoryId: "memory_2",
        sourceRevisionId: "revision_trigger",
        sourceId: null,
        fixtureId: "fixture_foreign",
      };
    },
  }];
  for (const { label, mutate } of mutations) {
    const input = fixture();
    input.grounding.xtraceLineage.memoryIds.push("memory_2");
    input.grounding.xtraceLineage.sourceRevisionIds.push("revision_trigger");
    input.grounding.xtraceLineage.sourceIds.push("source_trigger");
    const bindings: Array<Record<string, unknown>> = [{
      kind: "source",
      memoryId: "memory_1",
      sourceRevisionId: "revision_prior",
      sourceId: "source_prior",
      fixtureId: null,
    }, {
      kind: "source",
      memoryId: "memory_2",
      sourceRevisionId: "revision_trigger",
      sourceId: "source_trigger",
      fixtureId: null,
    }];
    mutate(bindings);
    input.grounding.xtraceLineage.parentBindings = bindings as never;
    (input.analysis.investmentMemory.memoryIds as string[]).push("memory_2");
    (input.analysis.investmentMemory.sourceIds as string[]).push(
      "source_trigger",
    );
    assert.throws(
      () => buildDecisionCriticalEvidenceProjection(input),
      /XTrace|candidate-local|cannot resolve|ambiguous|binding/i,
      label,
    );
  }
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
  const fixtureFact = {
    ...fact("fixture_1", "revision_fixture"),
    provenanceOrigin: "demo_fixture" as const,
    field: "sample_decision_context",
    value: "Sample decision record. Synthetic prior decision context.",
    acceptedForGate: false,
    verificationMethod: "synthetic_sample_decision_record_v1",
  };
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
    "fixture_1",
  );
  (input.analysis.investmentMemory.fixtureIds as string[]).push(
    "fixture_1",
  );

  const projected = buildDecisionCriticalEvidenceProjection(input).find(
    ({ evidencePackItemId }) => evidencePackItemId === "fixture_1",
  );
  assert.ok(projected?.originRefs.some(({ kind, id }) =>
    kind === "prior_record" && id === "fixture_1"
  ));
  assert.ok(projected?.originRefs.some(({ kind, id }) =>
    kind === "source_revision" && id === "revision_fixture"
  ));
  assert.ok(projected?.resolutionPath.includes("source_fixture_1"));
  assert.equal(
    projected?.resolutionPath.includes("source_source_fixture_1"),
    false,
  );
});

test("Sample fixture prior-record resolution rejects a missing or non-synthetic candidate-local Fact", () => {
  const cases: Array<{
    label: string;
    mutate(input: ReturnType<typeof fixture>, sample: Fact): void;
  }> = [{
    label: "missing exact Fact",
    mutate(input) {
      input.pack.facts.pop();
    },
  }, {
    label: "public Fact impostor",
    mutate(_input, sample) {
      sample.provenanceOrigin = "public_source";
    },
  }, {
    label: "gate-eligible impostor",
    mutate(_input, sample) {
      sample.acceptedForGate = true;
    },
  }, {
    label: "wrong sample field",
    mutate(_input, sample) {
      sample.field = "public_claim";
    },
  }, {
    label: "foreign revision",
    mutate(_input, sample) {
      sample.sourceRevisionId = "revision_trigger";
    },
  }, {
    label: "foreign workspace",
    mutate(input) {
      input.grounding.sourceRevisionSnapshots.at(-1)!.workspaceId =
        "workspace_2";
    },
  }];

  for (const { label, mutate } of cases) {
    const input = fixture();
    const sample = {
      ...fact("fixture_1", "revision_fixture"),
      provenanceOrigin: "demo_fixture" as const,
      field: "sample_decision_context",
      value: "Sample decision record. Synthetic prior decision context.",
      acceptedForGate: false,
      verificationMethod: "synthetic_sample_decision_record_v1",
    };
    input.pack.facts.push(sample);
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
    (input.analysis.investmentMemory.sourceIds as string[]).push("fixture_1");
    (input.analysis.investmentMemory.fixtureIds as string[]).push("fixture_1");
    mutate(input, sample);
    assert.throws(
      () => buildDecisionCriticalEvidenceProjection(input),
      /cannot resolve to a candidate-local Evidence Pack item|candidate-local workspace/i,
      label,
    );
  }
});
