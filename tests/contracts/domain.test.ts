import assert from "node:assert/strict";
import test from "node:test";

import {
  BeliefChangeAssessmentV1Schema,
  BeliefRevisionGateResultsSchema,
  CompanyAnalysisSchema,
  DealMemoryBundleSchema,
  DealStatusSchema,
  EvidenceFieldSchema,
  MarketEventSchema,
  OpportunityReportItemSchema,
  parseCompanyAnalysisRead,
  SourceRefSchema,
  type BeliefAction,
} from "../../lib/contracts/domain";
import { renderRecommendedNextMove } from "../../lib/reports/action-policy";
import {
  MarketEventV2Schema,
  SourceRefV2Schema,
  WritableMarketEventV2Schema,
  WritableSourceRefV2Schema,
  sourceClaimSupportKind,
  sourceCanGroundExactQuote,
  sourceCanGroundOutputFact,
  type SourceRefV2,
} from "../../lib/contracts/source-evidence";
import {
  adaptLegacySourceRef,
  parseMarketEventV2Read,
  parseSourceRefV2Read,
} from "../../lib/contracts/legacy-evidence-adapter";
import { ConfirmUploadSchema } from "../../lib/contracts/http";
import {
  marketEventV2 as persistedMarketEventV2,
  normalizedSourceV2 as persistedNormalizedSourceV2,
} from "../helpers/source-evidence-v2";

const SHA256_A = `sha256:${"a".repeat(64)}`;
const SHA256_B = `sha256:${"b".repeat(64)}`;

function exactSourceV2(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "source-ref-v2",
    adaptation: "canonical",
    id: "source_exact_1",
    provenance: "public_web",
    title: "Acme funding announcement",
    canonicalUrl: "https://acme.example/news/series-b",
    documentId: null,
    publisher: "Acme",
    providerId: "company-feed",
    eventAt: "2026-07-23T14:30:00.000Z",
    eventAtPrecision: "timestamp",
    publishedAt: "2026-07-23T15:00:00.000Z",
    publishedAtPrecision: "timestamp",
    retrievedAt: "2026-07-24T12:00:00.000Z",
    retrievedAtPrecision: "timestamp",
    updatedAt: null,
    updatedAtPrecision: null,
    entityKeys: ["acme"],
    sourceClass: "company_official",
    sourceAuthority: "primary",
    evidenceRole: "trigger",
    sourceRevisionId: "revision_acme_series_b_1",
    locator: {
      kind: "web_text",
      selector: "main article p:nth-of-type(2)",
    },
    contentFingerprint: SHA256_A,
    text: {
      status: "verified_exact",
      verbatimExcerpt: "Acme closed a Series B funding round.",
      normalizedStatement: "Acme completed its Series B financing.",
    },
    ...overrides,
  };
}

function marketEventV2(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "market-event-v2",
    adaptation: "canonical",
    id: "market_acme_series_b_1",
    title: "Acme closes Series B funding round",
    eventType: "funding",
    sectors: ["healthcare"],
    themes: ["growth"],
    summary: "Acme announced a Series B funding round.",
    positiveImplications: [],
    negativeImplications: [],
    eventAt: "2026-07-23T14:30:00.000Z",
    eventAtPrecision: "timestamp",
    publishedAt: "2026-07-23T15:00:00.000Z",
    publishedAtPrecision: "timestamp",
    retrievedAt: "2026-07-24T12:00:00.000Z",
    retrievedAtPrecision: "timestamp",
    updatedAt: null,
    updatedAtPrecision: null,
    confidence: "high",
    canonicalUrl: "https://acme.example/news/series-b",
    providerId: "company-feed",
    contentFingerprint: SHA256_B,
    entityKeys: ["acme"],
    triggerSourceId: "source_exact_1",
    sources: [exactSourceV2()],
    ...overrides,
  };
}

function companyAnalysisFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const source = {
    id: "source_1",
    provenance: "source_document",
    title: "7bridges pitch deck",
    documentId: "document_1",
    page: 1,
    excerpt: "7bridges provides logistics orchestration software.",
  };
  const sampleDecisionRecord = {
    schemaVersion: "source-ref-v2",
    adaptation: "canonical",
    id: "interaction_1",
    provenance: "demo_fixture",
    title: "Sample decision record",
    canonicalUrl: null,
    documentId: null,
    publisher: "Internal Deal Registry",
    providerId: "deal-registry",
    eventAt: "2026-01-12T12:00:00.000Z",
    eventAtPrecision: "timestamp",
    publishedAt: null,
    publishedAtPrecision: null,
    retrievedAt: null,
    retrievedAtPrecision: null,
    updatedAt: null,
    updatedAtPrecision: null,
    entityKeys: [],
    sourceClass: "internal_decision_record",
    sourceAuthority: "primary",
    evidenceRole: "context",
    sourceRevisionId: null,
    locator: null,
    contentFingerprint: null,
    text: {
      status: "normalized_only",
      normalizedStatement:
        "Sample decision record. The fund passed pending stronger enterprise adoption.",
    },
  };

  return {
    id: "analysis_1",
    reportId: "report_1",
    runId: "00000000-0000-4000-8000-000000000001",
    dealId: "deal_7bridges",
    companyName: "7bridges",
    dealStatus: "passed",
    outcome: "no_material_change",
    confidence: "low",
    score: 0.21,
    verifiedSourceCount: 2,
    investmentMemory: {
      previousMeetingSummary: "The team presented its logistics platform.",
      decisionReason: "The fund passed pending stronger enterprise adoption.",
      concerns: ["Enterprise adoption was not yet demonstrated."],
      revisitConditions: ["Revisit after measurable enterprise adoption."],
      lastEvaluatedAt: "2026-01-12T12:00:00.000Z",
      memoryIds: ["memory_1"],
      sourceIds: ["interaction_1"],
      fixtureIds: ["interaction_1"],
    },
    marketEvidence: {
      relationship: "none",
      explanation:
        "No material market evidence matched this company during the current 14-day scan.",
      eventIds: [],
      events: [],
      sourceIds: [],
    },
    implications: {
      positive: [],
      negative: [],
    },
    recommendedNextMove:
      "No immediate follow-up recommended. Continue monitoring.",
    companyBrief: {
      icSnapshot: [{
        label: "Company",
        value: "7bridges",
        unavailableReason: null,
        sourceIds: ["source_1"],
      }],
      traction: [{
        label: "ARR",
        value: null,
        unavailableReason: "Not available in current evidence",
        sourceIds: [],
      }],
      dealTerms: [{
        label: "Round",
        value: null,
        unavailableReason: "Not available in current evidence",
        sourceIds: [],
      }],
      risks: [{
        severity: "medium",
        title: "Enterprise adoption",
        detail: "Enterprise adoption was not yet demonstrated.",
        nextQuestion: "Has enterprise adoption materially improved?",
        sourceIds: ["interaction_1"],
      }],
      decisionHistory: [{
        occurredAt: "2026-01-12T12:00:00.000Z",
        title: "Initial review",
        summary: "The fund passed pending stronger enterprise adoption.",
        sourceIds: ["interaction_1"],
      }],
      sourceLineage: [source, sampleDecisionRecord],
    },
    sources: [source, sampleDecisionRecord],
    createdAt: "2026-07-24T12:00:00.000Z",
    ...overrides,
  };
}

function action(
  kind:
    | "advance_diligence"
    | "continue_monitoring"
    | "deprioritize"
    | "reopen_diligence"
    | "evaluate_follow_on"
    | "pause_follow_on"
    | "portfolio_risk_review"
    | "no_new_action"
      | "review_analysis_failure",
): BeliefAction {
  const scope = kind === "review_analysis_failure"
    ? "analysis"
    : [
        "evaluate_follow_on",
        "pause_follow_on",
        "portfolio_risk_review",
      ].includes(kind)
    ? "portfolio"
    : "deal";
  const priority = ["pause_follow_on", "portfolio_risk_review"].includes(kind)
    ? "high"
    : "standard";
  return { kind, scope, priority, visibility: "internal_only" };
}

function beliefAssessmentFixture(overrides: Record<string, unknown> = {}) {
  const counterevidenceStatement =
    "The public evidence does not yet establish durable customer retention.";
  const triggerSource = exactSourceV2({
    id: "trigger_source_1",
    eventAt: "2026-07-23T12:00:00.000Z",
    text: {
      status: "verified_exact",
      verbatimExcerpt: "Acme reported measurable enterprise adoption.",
    },
  });
  const counterSource = exactSourceV2({
    id: "counter_source_1",
    evidenceRole: "counterevidence",
    sourceRevisionId: "revision_acme_counterevidence_1",
    locator: {
      kind: "web_text",
      selector: "main article p:nth-of-type(3)",
    },
    contentFingerprint: SHA256_B,
    text: {
      status: "verified_exact",
      verbatimExcerpt: counterevidenceStatement,
    },
  });
  const sampleDecisionSource = (
    companyAnalysisFixture().sources as unknown[]
  )[1] as SourceRefV2;
  return {
    schemaVersion: "belief-change-assessment-v1",
    dealStatus: "passed",
    direction: "positive",
    scoreBreakdown: {
      eventRelevance: 0.8,
      dealRelevance: 0.8,
      priorContextStrength: 0.8,
      evidenceQuality: 0.8,
      finalScore: 0.8,
      confidence: "high",
    },
    gateContext: {
      priorInteraction: {
        id: "interaction_1",
        occurredAt: "2026-01-12T12:00:00.000Z",
        sourceIds: ["interaction_1"],
        revisitConditions: [
          "Revisit after measurable enterprise adoption.",
        ],
        priorActions: [action("no_new_action")],
        provenance: "demo_fixture",
        label: "Sample decision record",
      },
      triggerEvent: {
        id: "event_1",
        eventAt: "2026-07-23T12:00:00.000Z",
        sourceIds: ["trigger_source_1"],
      },
      sources: [triggerSource, counterSource, sampleDecisionSource],
    },
    gates: {
      chronology: {
        priorInteractionId: "interaction_1",
        priorInteractionAt: "2026-01-12T12:00:00.000Z",
        triggerEventId: "event_1",
        triggerEventAt: "2026-07-23T12:00:00.000Z",
        passed: true,
        failureReason: null,
      },
      revisitConditionMapping: {
        priorInteractionId: "interaction_1",
        revisitConditionIndex: 0,
        revisitConditionText: "Revisit after measurable enterprise adoption.",
        triggerEventId: "event_1",
        citedSourceIds: ["trigger_source_1"],
        passed: true,
        failureReason: null,
      },
      counterevidence: {
        statement: counterevidenceStatement,
        citedSourceIds: ["counter_source_1"],
        passed: true,
        failureReason: null,
      },
      actionDelta: {
        priorActions: [action("no_new_action")],
        proposedActions: [action("reopen_diligence")],
        passed: true,
        failureReason: null,
      },
      allPassed: true,
    },
    actions: [action("reopen_diligence")],
    ...overrides,
  };
}

function versionedCompanyAnalysisFixture(
  beliefAssessment = beliefAssessmentFixture(),
  overrides: Record<string, unknown> = {},
) {
  const legacy = companyAnalysisFixture();
  const context = beliefAssessment.gateContext as {
    sources: SourceRefV2[];
    triggerEvent: { eventAt: string };
  };
  const [triggerSource] = context.sources;
  const event = persistedMarketEventV2(triggerSource!, {
    id: "event_1",
    eventAt: context.triggerEvent.eventAt,
    eventAtPrecision: "timestamp",
  });
  const sources = [...new Map([
    ...(legacy.sources as SourceRefV2[]),
    ...context.sources,
  ].map((source) => [source.id, source])).values()];
  return companyAnalysisFixture({
    outcome: "belief_revised",
    confidence: "high",
    score: 0.8,
    verifiedSourceCount: sources.length,
    investmentMemory: {
      ...(legacy.investmentMemory as Record<string, unknown>),
      priorActions: (
        beliefAssessment.gateContext as {
          priorInteraction: { priorActions: BeliefAction[] };
        }
      ).priorInteraction.priorActions,
    },
    beliefAssessment,
    marketEvidence: {
      relationship: "satisfies",
      explanation: "The trigger changed the selected prior revisit condition.",
      eventIds: [event.id],
      events: [event],
      sourceIds: [triggerSource!.id],
    },
    recommendedNextMove: renderRecommendedNextMove(
      beliefAssessment.actions as ReturnType<typeof action>[],
    ),
    sources,
    ...overrides,
  });
}

test("normalizes the legacy interested status to watchlist", () => {
  assert.equal(DealStatusSchema.parse("interested"), "watchlist");
});

test("legacy CompanyAnalysis keeps interested readable without a v1 assessment", () => {
  const parsed = CompanyAnalysisSchema.parse(companyAnalysisFixture({
    dealStatus: "interested",
  }));

  assert.equal(parsed.dealStatus, "watchlist");
  assert.equal(parsed.beliefAssessment, undefined);
});

test("keeps the legacy SourceRef contract unchanged", () => {
  const sourceRef = {
    id: "source_1",
    provenance: "source_document",
    title: "Pitch deck",
    documentId: "document_1",
    page: 1,
    excerpt: "Source-grounded evidence.",
  };

  assert.deepEqual(SourceRefSchema.parse(sourceRef), sourceRef);
  assert.throws(() => SourceRefSchema.parse({
    ...sourceRef,
    provenance: "uploaded_document",
  }));
});

test("only verified exact text can pass exact quote validation", () => {
  const exact = SourceRefV2Schema.parse(exactSourceV2());
  const normalized = SourceRefV2Schema.parse(exactSourceV2({
    id: "source_normalized_1",
    sourceRevisionId: null,
    locator: null,
    text: {
      status: "normalized_only",
      normalizedStatement: "Acme completed its Series B financing.",
    },
  }));
  const model = SourceRefV2Schema.parse(exactSourceV2({
    id: "source_model_1",
    provenance: "model_inference",
    sourceClass: "model_output",
    sourceAuthority: "not_applicable",
    evidenceRole: "context",
    sourceRevisionId: null,
    locator: null,
    text: {
      status: "model_inference",
      normalizedStatement: "The financing may improve market confidence.",
      model: {
        provider: "anthropic",
        model: "claude-opus-4-8",
        generatedAt: "2026-07-24T12:00:00.000Z",
        inputFingerprint: SHA256_A,
      },
    },
  }));
  const legacy = adaptLegacySourceRef({
    id: "legacy_source_1",
    provenance: "public_web",
    title: "Legacy article",
    url: "https://legacy.example/article",
    excerpt: "Legacy text was never verified against an immutable revision.",
  });

  assert.equal(sourceCanGroundExactQuote(exact), true);
  assert.equal(sourceCanGroundExactQuote(normalized), false);
  assert.equal(sourceCanGroundExactQuote(model), false);
  assert.equal(sourceCanGroundExactQuote(legacy), false);
  assert.equal(sourceCanGroundOutputFact(normalized), true);
  assert.equal(sourceCanGroundOutputFact(model), false);
  assert.equal(sourceCanGroundOutputFact(legacy), false);
});

test("verified exact parsing preserves every verbatim whitespace character", () => {
  const verbatimExcerpt =
    "\n  Acme closed a Series B funding round.  \n";
  const parsed = WritableSourceRefV2Schema.parse(exactSourceV2({
    text: {
      status: "verified_exact",
      verbatimExcerpt,
      normalizedStatement: "Acme completed its Series B financing.",
    },
  }));

  assert.equal(parsed.text.status, "verified_exact");
  assert.equal(parsed.text.verbatimExcerpt, verbatimExcerpt);
  assert.equal(
    sourceClaimSupportKind(parsed, verbatimExcerpt),
    "exact_quote",
  );
  assert.equal(
    sourceClaimSupportKind(
      parsed,
      "Acme closed a Series B funding round.",
    ),
    null,
  );
  assert.equal(WritableSourceRefV2Schema.safeParse(exactSourceV2({
    text: {
      status: "verified_exact",
      verbatimExcerpt: " \n\t ",
    },
  })).success, false);
});

test("canonical source text enforces exact-word and normalized-character bounds", () => {
  const twentyFiveWords = Array.from(
    { length: 25 },
    (_, index) => `word${index + 1}`,
  ).join(" ");
  const twentySixWords = `${twentyFiveWords} overflow`;
  assert.equal(WritableSourceRefV2Schema.safeParse(exactSourceV2({
    text: { status: "verified_exact", verbatimExcerpt: twentyFiveWords },
  })).success, true);
  assert.equal(WritableSourceRefV2Schema.safeParse(exactSourceV2({
    text: { status: "verified_exact", verbatimExcerpt: twentySixWords },
  })).success, false);

  assert.equal(WritableSourceRefV2Schema.safeParse(exactSourceV2({
    id: "source_normalized_bound",
    sourceRevisionId: null,
    locator: null,
    text: { status: "normalized_only", normalizedStatement: "a".repeat(2_000) },
  })).success, true);
  assert.equal(WritableSourceRefV2Schema.safeParse(exactSourceV2({
    id: "source_normalized_overflow",
    sourceRevisionId: null,
    locator: null,
    text: { status: "normalized_only", normalizedStatement: "a".repeat(2_001) },
  })).success, false);
});

test("canonical demo fixtures are permanently labeled normalized Sample decision records", () => {
  const sampleDecisionRecord = exactSourceV2({
    id: "fixture_sample_decision_record",
    provenance: "demo_fixture",
    title: "Sample decision record",
    canonicalUrl: null,
    documentId: null,
    publisher: "Internal Deal Registry",
    providerId: "deal-registry",
    eventAt: "2026-07-01T16:00:00.000Z",
    eventAtPrecision: "timestamp",
    publishedAt: null,
    publishedAtPrecision: null,
    retrievedAt: null,
    retrievedAtPrecision: null,
    entityKeys: [],
    sourceClass: "internal_decision_record",
    sourceAuthority: "primary",
    evidenceRole: "context",
    sourceRevisionId: null,
    locator: null,
    contentFingerprint: null,
    text: {
      status: "normalized_only",
      normalizedStatement:
        "Sample decision record. The synthetic team previously passed.",
    },
  });
  assert.equal(
    WritableSourceRefV2Schema.safeParse(sampleDecisionRecord).success,
    true,
  );

  const invalidCases = [{
    ...sampleDecisionRecord,
    title: "Founder meeting",
  }, {
    ...sampleDecisionRecord,
    sourceClass: "company_official",
  }, {
    ...sampleDecisionRecord,
    sourceAuthority: "secondary",
  }, {
    ...sampleDecisionRecord,
    evidenceRole: "trigger",
  }, {
    ...sampleDecisionRecord,
    text: {
      status: "normalized_only",
      normalizedStatement: "The synthetic team previously passed.",
    },
  }, {
    ...sampleDecisionRecord,
    text: {
      status: "normalized_only",
      normalizedStatement:
        "Sample decision recordkeeping says this is a real founder meeting.",
    },
  }, {
    ...sampleDecisionRecord,
    sourceRevisionId: "revision_sample_decision_record",
    locator: { kind: "document_page", page: 1 },
    retrievedAt: "2026-07-24T12:00:00.000Z",
    retrievedAtPrecision: "timestamp",
    contentFingerprint: SHA256_A,
    text: {
      status: "verified_exact",
      verbatimExcerpt: "The synthetic team previously passed.",
      normalizedStatement:
        "Sample decision record. The synthetic team previously passed.",
    },
  }];
  for (const [index, candidate] of invalidCases.entries()) {
    assert.equal(
      WritableSourceRefV2Schema.safeParse(candidate).success,
      false,
      `invalid Sample decision record case ${index + 1}`,
    );
  }
});

test("verified exact evidence requires revision locator retrieval and fingerprint", () => {
  for (const field of [
    "sourceRevisionId",
    "locator",
    "retrievedAt",
    "contentFingerprint",
  ]) {
    assert.equal(
      SourceRefV2Schema.safeParse(exactSourceV2({ [field]: null })).success,
      false,
      field,
    );
  }
  assert.equal(
    SourceRefV2Schema.safeParse(exactSourceV2({
      text: {
        status: "verified_exact",
        verbatimExcerpt: "The same statement.",
        normalizedStatement: "The same statement.",
      },
    })).success,
    false,
    "normalized text cannot masquerade as a verbatim quotation",
  );
});

test("temporal precision preserves date-only evidence without inventing midnight", () => {
  const sameDayDateSource = exactSourceV2({
    retrievedAt: "2026-07-23",
    retrievedAtPrecision: "date",
  });
  const sameDayDateEvent = marketEventV2({
    retrievedAt: "2026-07-23",
    retrievedAtPrecision: "date",
    sources: [sameDayDateSource],
  });
  const parsed = MarketEventV2Schema.parse(sameDayDateEvent);

  assert.equal(parsed.retrievedAt, "2026-07-23");
  assert.equal(parsed.retrievedAtPrecision, "date");
  assert.equal(
    MarketEventV2Schema.safeParse(marketEventV2({
      retrievedAt: "2026-07-23",
      retrievedAtPrecision: "timestamp",
      sources: [sameDayDateSource],
    })).success,
    false,
  );

  const priorDaySource = exactSourceV2({
    retrievedAt: "2026-07-22",
    retrievedAtPrecision: "date",
  });
  assert.equal(
    MarketEventV2Schema.safeParse(marketEventV2({
      retrievedAt: "2026-07-22",
      retrievedAtPrecision: "date",
      sources: [priorDaySource],
    })).success,
    false,
    "a retrieval date whose full possible interval precedes publication must fail",
  );

  const newerUpdateSource = exactSourceV2({
    updatedAt: "2026-07-25",
    updatedAtPrecision: "date",
  });
  assert.equal(
    MarketEventV2Schema.safeParse(marketEventV2({
      updatedAt: "2026-07-25",
      updatedAtPrecision: "date",
      sources: [newerUpdateSource],
    })).success,
    false,
    "an update definitely newer than retrieval must fail",
  );
});

test("temporal provenance rejects updates that are definitely later than retrieval", () => {
  const source = exactSourceV2({
    retrievedAt: "2026-07-24T12:00:00.000Z",
    retrievedAtPrecision: "timestamp",
    updatedAt: "2026-07-24T12:00:00.001Z",
    updatedAtPrecision: "timestamp",
  });
  assert.equal(SourceRefV2Schema.safeParse(source).success, false);
  assert.equal(
    MarketEventV2Schema.safeParse(marketEventV2({
      retrievedAt: "2026-07-24T12:00:00.000Z",
      retrievedAtPrecision: "timestamp",
      updatedAt: "2026-07-24T12:00:00.001Z",
      updatedAtPrecision: "timestamp",
      sources: [source],
    })).success,
    false,
  );
});

test("legacy excerpt adapts to unverified normalized text and cannot be written", () => {
  const adapted = adaptLegacySourceRef({
    id: "legacy_source_1",
    provenance: "public_web",
    title: "Legacy article",
    url: "https://legacy.example/article",
    excerpt: "Legacy text was never verified against an immutable revision.",
  });

  assert.equal(adapted.adaptation, "legacy_read");
  assert.equal(adapted.text.status, "legacy_unverified");
  assert.equal(
    adapted.text.normalizedStatement,
    "Legacy text was never verified against an immutable revision.",
  );
  assert.equal("verbatimExcerpt" in adapted.text, false);
  assert.equal(adapted.sourceClass, "unknown_legacy");
  assert.equal(adapted.sourceAuthority, "unknown_legacy");
  assert.equal(adapted.evidenceRole, "unknown_legacy");
  assert.equal(
    WritableMarketEventV2Schema.safeParse(marketEventV2({
      triggerSourceId: adapted.id,
      sources: [adapted],
    })).success,
    false,
  );
});

test("model inference cannot impersonate primary or secondary source authority", () => {
  for (const sourceAuthority of ["primary", "secondary"]) {
    assert.equal(SourceRefV2Schema.safeParse(exactSourceV2({
      provenance: "model_inference",
      sourceClass: "model_output",
      sourceAuthority,
      evidenceRole: "context",
      sourceRevisionId: null,
      locator: null,
      text: {
        status: "model_inference",
        normalizedStatement: "The financing may improve market confidence.",
        model: {
          provider: "anthropic",
          model: "claude-opus-4-8",
          generatedAt: "2026-07-24T12:00:00.000Z",
          inputFingerprint: SHA256_A,
        },
      },
    })).success, false, sourceAuthority);
  }
});

test("fact-eligible public and document sources require complete retrieval lineage", () => {
  const publicWithoutRetrieval = exactSourceV2({
    sourceRevisionId: null,
    locator: null,
    retrievedAt: null,
    retrievedAtPrecision: null,
    text: {
      status: "normalized_only",
      normalizedStatement: "Acme completed its Series B financing.",
    },
  });
  assert.equal(
    SourceRefV2Schema.safeParse(publicWithoutRetrieval).success,
    false,
  );
  assert.equal(
    sourceCanGroundOutputFact(publicWithoutRetrieval as SourceRefV2),
    false,
  );

  const documentWithoutLineage = exactSourceV2({
    provenance: "source_document",
    canonicalUrl: null,
    documentId: null,
    publisher: null,
    providerId: "source-registry",
    sourceRevisionId: null,
    locator: null,
    retrievedAt: null,
    retrievedAtPrecision: null,
    contentFingerprint: null,
    evidenceRole: "context",
    text: {
      status: "normalized_only",
      normalizedStatement: "Acme completed its Series B financing.",
    },
  });
  assert.equal(
    SourceRefV2Schema.safeParse(documentWithoutLineage).success,
    false,
  );
  assert.equal(
    sourceCanGroundOutputFact(documentWithoutLineage as SourceRefV2),
    false,
  );
});

test("canonical source URLs require canonical HTTP or HTTPS form", () => {
  for (const canonicalUrl of [
    "javascript:alert(1)",
    "data:text/html,malicious",
    "ftp://example.com/source",
    "https://acme.example/news/series-b?utm_source=test#fragment",
  ]) {
    assert.equal(
      WritableSourceRefV2Schema.safeParse(exactSourceV2({ canonicalUrl }))
        .success,
      false,
      canonicalUrl,
    );
  }
});

test("market event v2 fails closed on malformed provenance and trigger lineage", () => {
  assert.equal(MarketEventV2Schema.safeParse(marketEventV2()).success, true);
  assert.equal(MarketEventV2Schema.safeParse(marketEventV2({
    entityKeys: [],
    sources: [exactSourceV2({ entityKeys: [] })],
  })).success, true, "unknown entity keys remain an explicit empty set");

  const invalidCases = [
    marketEventV2({ publishedAt: "2026-99-99" }),
    marketEventV2({ entityKeys: ["Acme Incorporated"] }),
    marketEventV2({ sources: [exactSourceV2({ sourceClass: "blog" })] }),
    marketEventV2({ sources: [exactSourceV2({ sourceAuthority: "official" })] }),
    marketEventV2({ sources: [exactSourceV2({ evidenceRole: "citation" })] }),
    marketEventV2({ sources: [exactSourceV2({ publisher: null })] }),
    marketEventV2({ sources: [exactSourceV2({ providerId: null })] }),
    marketEventV2({ sources: [exactSourceV2({ contentFingerprint: null })] }),
    marketEventV2({
      sources: [
        exactSourceV2(),
        exactSourceV2({ id: "source_second_trigger" }),
      ],
    }),
    marketEventV2({
      sources: [exactSourceV2({
        sourceClass: "internal_decision_record",
      })],
    }),
    marketEventV2({
      sources: [exactSourceV2({ provenance: "source_document" })],
    }),
    marketEventV2({
      sources: [exactSourceV2({ provenance: "demo_fixture" })],
    }),
    marketEventV2({
      sources: [
        exactSourceV2(),
        exactSourceV2({
          id: "source_synthetic_context",
          provenance: "demo_fixture",
          sourceClass: "internal_decision_record",
          evidenceRole: "context",
        }),
      ],
    }),
    marketEventV2({ triggerSourceId: "missing_source" }),
    marketEventV2({
      publishedAt: "2026-07-23T16:00:00.000Z",
    }),
    marketEventV2({
      canonicalUrl: "https://other.example/event",
    }),
    marketEventV2({
      updatedAt: "2026-07-23T16:00:00.000Z",
    }),
    marketEventV2({
      entityKeys: [],
    }),
  ];
  for (const [index, candidate] of invalidCases.entries()) {
    assert.equal(
      MarketEventV2Schema.safeParse(candidate).success,
      false,
      `invalid case ${index + 1}`,
    );
  }
});

test("market event entity keys exactly equal all embedded source entity keys", () => {
  const trigger = exactSourceV2();
  const corroborating = exactSourceV2({
    id: "source_partner_corroborating",
    title: "Partner corroboration",
    canonicalUrl: "https://partner.example/announcement",
    entityKeys: ["partner"],
    evidenceRole: "corroborating",
    sourceRevisionId: "revision_partner_corroborating",
    text: {
      status: "verified_exact",
      verbatimExcerpt: "Partner confirmed the deployment.",
      normalizedStatement: "The partner confirmed the deployment.",
    },
  });
  const counterevidence = exactSourceV2({
    id: "source_risk_counterevidence",
    title: "Risk disclosure",
    canonicalUrl: "https://risk.example/disclosure",
    entityKeys: ["risk_entity"],
    evidenceRole: "counterevidence",
    sourceRevisionId: "revision_risk_counterevidence",
    text: {
      status: "verified_exact",
      verbatimExcerpt: "Deployment timing remains uncertain.",
      normalizedStatement: "The deployment schedule remains uncertain.",
    },
  });
  const complete = marketEventV2({
    entityKeys: ["acme", "partner", "risk_entity"],
    sources: [trigger, corroborating, counterevidence],
  });

  assert.equal(MarketEventV2Schema.safeParse(complete).success, true);
  assert.equal(MarketEventV2Schema.safeParse({
    ...complete,
    entityKeys: [...complete.entityKeys as string[], "injected_company"],
  }).success, false);
  assert.equal(MarketEventV2Schema.safeParse({
    ...complete,
    entityKeys: ["acme", "partner"],
  }).success, false);
});

test("market events reject duplicate intrinsic units and evidence-role spoofing", () => {
  const trigger = exactSourceV2();
  const roleSpoof = {
    ...trigger,
    id: "source_exact_role_spoof",
    evidenceRole: "counterevidence",
  };
  const textSpoof = {
    ...trigger,
    id: "source_exact_text_spoof",
    evidenceRole: "corroborating",
    text: {
      status: "verified_exact",
      verbatimExcerpt: "Acme did not close a Series B funding round.",
      normalizedStatement: "Acme did not complete its Series B financing.",
    },
  };

  for (const duplicate of [roleSpoof, textSpoof]) {
    assert.equal(WritableMarketEventV2Schema.safeParse(marketEventV2({
      sources: [trigger, duplicate],
    })).success, false);
  }
});

test("declared malformed v2 evidence cannot downgrade through the legacy adapter", () => {
  assert.throws(() => parseSourceRefV2Read({
    ...exactSourceV2(),
    publisher: null,
    excerpt: "A legacy-shaped escape hatch must not be accepted.",
  }));
  assert.throws(() => parseMarketEventV2Read({
    ...marketEventV2(),
    triggerSourceId: "missing_source",
  }));
});

test("canonical market-event reads reject a stale payload fingerprint", () => {
  const source = persistedNormalizedSourceV2("source_stale_read");
  const event = persistedMarketEventV2(source);
  assert.equal(parseMarketEventV2Read(event).id, event.id);
  assert.throws(
    () => parseMarketEventV2Read({
      ...event,
      summary: "The canonical payload was changed without a new digest.",
    }),
    /fingerprint.*canonical payload/i,
  );
});

test("any declared evidence schema version disables the legacy adapter", () => {
  const legacySource = {
    id: "legacy_source_versioned",
    provenance: "public_web",
    title: "Legacy-shaped source",
    excerpt: "A versioned payload must not be stripped into legacy evidence.",
  };
  const legacyEvent = {
    id: "legacy_event_versioned",
    title: "Legacy-shaped event",
    eventType: "announcement",
    sectors: [],
    themes: [],
    summary: "A versioned payload must fail closed.",
    positiveImplications: [],
    negativeImplications: [],
    publishedAt: "2026-07-23T15:00:00.000Z",
    confidence: "medium",
    sources: [legacySource],
  };

  for (const schemaVersion of ["source-ref-v3", null, 3]) {
    assert.throws(
      () => parseSourceRefV2Read({ ...legacySource, schemaVersion }),
      `source version ${String(schemaVersion)}`,
    );
  }
  for (const schemaVersion of ["market-event-v3", null, 3]) {
    assert.throws(
      () => parseMarketEventV2Read({ ...legacyEvent, schemaVersion }),
      `event version ${String(schemaVersion)}`,
    );
  }
});

test("Deal facts preserve canonical v2 and reject malformed declared v2", () => {
  const source = exactSourceV2();
  const bundle = {
    dealId: "deal_acme",
    companyName: "Acme",
    status: "passed",
    facts: [{
      text: "Acme completed its Series B financing.",
      sources: [source],
    }],
    interactions: [],
  };

  const parsed = DealMemoryBundleSchema.parse(bundle);
  assert.deepEqual(parsed.facts[0].sources[0], source);
  assert.equal(DealMemoryBundleSchema.safeParse({
    ...bundle,
    facts: [{
      ...bundle.facts[0],
      sources: [{ ...source, providerId: null }],
    }],
  }).success, false);
});

test("Sample decision records can carry canonical typed prior actions while legacy records remain readable", () => {
  const interaction = {
    id: "interaction_prior_action_1",
    occurredAt: "2026-01-12T12:00:00.000Z",
    summary: "The sample team reviewed the company.",
    decisionReason: "The milestone had not yet been met.",
    concerns: ["Enterprise adoption remained unproven."],
    revisitConditions: ["Revisit after measurable enterprise adoption."],
    provenance: "demo_fixture",
    label: "Sample decision record",
  };
  const bundle = {
    dealId: "deal_acme",
    companyName: "Acme",
    status: "passed",
    facts: [],
    interactions: [interaction],
  };

  assert.equal(DealMemoryBundleSchema.safeParse(bundle).success, true);
  const parsed = DealMemoryBundleSchema.parse({
    ...bundle,
    interactions: [{
      ...interaction,
      priorActions: [action("no_new_action")],
    }],
  });
  assert.deepEqual(parsed.interactions[0].priorActions, [action("no_new_action")]);
  assert.equal(DealMemoryBundleSchema.safeParse({
    ...bundle,
    interactions: [{
      ...interaction,
      priorActions: [{ ...action("no_new_action"), visibility: "external" }],
    }],
  }).success, false);
});

test("legacy market event reads preserve unknown dates without inventing provenance", () => {
  const adapted = parseMarketEventV2Read({
    id: "legacy_event_1",
    title: "Legacy market event",
    eventType: "announcement",
    sectors: [],
    themes: [],
    summary: "A legacy market event.",
    positiveImplications: [],
    negativeImplications: [],
    publishedAt: "2026-07-23T15:00:00.000Z",
    confidence: "medium",
    sources: [{
      id: "legacy_source_1",
      provenance: "public_web",
      title: "Legacy article",
      excerpt: "Legacy evidence.",
    }],
  });

  assert.equal(adapted.adaptation, "legacy_read");
  assert.equal(adapted.eventAt, null);
  assert.equal(adapted.retrievedAt, null);
  assert.equal(adapted.updatedAt, null);
  assert.equal(adapted.triggerSourceId, null);
  assert.equal(adapted.sources[0].text.status, "legacy_unverified");
});

test("legacy normalized event reads preserve only validated known metadata", () => {
  const adapted = parseMarketEventV2Read({
    id: "legacy_event_2",
    title: "Legacy normalized event",
    eventType: "announcement",
    sectors: [],
    themes: [],
    summary: "A legacy normalized market event.",
    positiveImplications: [],
    negativeImplications: [],
    publishedAt: "2026-07-23T15:00:00.000Z",
    confidence: "medium",
    sources: [{
      id: "legacy_source_2",
      provenance: "public_web",
      title: "Legacy article",
      excerpt: "Legacy evidence.",
    }],
    canonicalUrl: "https://legacy.example/article",
    retrievedAt: "2026-07-24T12:00:00.000Z",
    updatedAt: "2026-07-23T16:00:00.000Z",
    providerId: "legacy-provider",
    entityKeys: ["legacy_entity"],
    contentChecksum: "c".repeat(64),
  });

  assert.equal(adapted.canonicalUrl, "https://legacy.example/article");
  assert.equal(adapted.retrievedAt, "2026-07-24T12:00:00.000Z");
  assert.equal(adapted.updatedAt, "2026-07-23T16:00:00.000Z");
  assert.equal(adapted.providerId, "legacy-provider");
  assert.deepEqual(adapted.entityKeys, ["legacy_entity"]);
  assert.equal(adapted.contentFingerprint, `sha256:${"c".repeat(64)}`);
});

test("legacy event reads reject impossible known chronology and duplicate entity keys", () => {
  const legacy = {
    id: "legacy_event_invalid_metadata",
    title: "Legacy normalized event",
    eventType: "announcement",
    sectors: [],
    themes: [],
    summary: "A legacy normalized market event.",
    positiveImplications: [],
    negativeImplications: [],
    publishedAt: "2026-07-23T15:00:00.000Z",
    confidence: "medium",
    sources: [{
      id: "legacy_source_invalid_metadata",
      provenance: "public_web",
      title: "Legacy article",
      excerpt: "Legacy evidence.",
    }],
    canonicalUrl: "https://legacy.example/article",
    providerId: "legacy-provider",
  };

  assert.throws(() => parseMarketEventV2Read({
    ...legacy,
    retrievedAt: "2026-07-23T14:59:59.999Z",
  }), /retrieved before publication/i);
  assert.throws(() => parseMarketEventV2Read({
    ...legacy,
    retrievedAt: "2026-07-24T12:00:00.000Z",
    updatedAt: "2026-07-24T12:00:00.001Z",
  }), /update newer than retrieval/i);
  assert.throws(() => parseMarketEventV2Read({
    ...legacy,
    entityKeys: ["legacy_entity", "legacy_entity"],
  }), /entity keys must be unique/i);
});

test("legacy event reads reject duplicate source identities before projection", () => {
  assert.throws(() => parseMarketEventV2Read({
    id: "legacy_event_source_collision",
    title: "Legacy normalized event",
    eventType: "announcement",
    sectors: [],
    themes: [],
    summary: "A legacy normalized market event.",
    positiveImplications: [],
    negativeImplications: [],
    publishedAt: "2026-07-23T15:00:00.000Z",
    confidence: "medium",
    sources: [{
      id: "legacy_source_collision",
      provenance: "public_web",
      title: "First legacy article",
      url: "https://legacy.example/first",
      excerpt: "First legacy evidence.",
    }, {
      id: "legacy_source_collision",
      provenance: "public_web",
      title: "Second legacy article",
      url: "https://legacy.example/second",
      excerpt: "Conflicting legacy evidence.",
    }],
  }), /source ids must be unique|conflicting source id/i);
});

test("rejects a client-supplied workspace in upload confirmation", () => {
  const confirmation = {
    companyName: "Acme",
    assignment: {
      kind: "existing_deal",
      dealId: "deal_1",
    },
  };

  assert.deepEqual(ConfirmUploadSchema.parse(confirmation), confirmation);
  assert.throws(() => ConfirmUploadSchema.parse({
    ...confirmation,
    workspaceId: "forged",
  }));
});

test("validates exact new-deal upload assignment", () => {
  const confirmation = {
    companyName: "  Acme  ",
    assignment: {
      kind: "new_deal",
      dealStatus: "screening",
    },
  };

  assert.deepEqual(ConfirmUploadSchema.parse(confirmation), {
    ...confirmation,
    companyName: "Acme",
  });
  assert.throws(() => ConfirmUploadSchema.parse({
    companyName: "Acme",
    assignment: {
      kind: "new_deal",
      dealStatus: "unknown",
    },
  }));
});

test("rejects a public market event without evidence", () => {
  assert.throws(() => MarketEventSchema.parse({
    id: "event_1",
    title: "New market event",
    eventType: "funding",
    sectors: ["ai"],
    themes: ["inference"],
    summary: "Capital moved.",
    positiveImplications: [],
    negativeImplications: [],
    publishedAt: "2026-07-23T12:00:00.000Z",
    confidence: "medium",
    sources: [],
  }));
});

test("rejects low-confidence opportunity reports", () => {
  assert.throws(() => OpportunityReportItemSchema.parse({
    rank: 1,
    dealId: "deal_1",
    confidence: "low",
    score: 0.4,
    whyNow: "A market changed.",
    previousContext: "The Deal was reviewed.",
    implications: { positive: [], negative: [] },
    nextStep: "Review the evidence.",
    sources: [{
      id: "source_1",
      provenance: "public_web",
      title: "Example",
      url: "https://example.com",
      excerpt: "Evidence.",
    }],
    demoFixtureIds: [],
  }));
});

test("claim support cannot label normalized evidence as an exact quote", () => {
  const source = persistedNormalizedSourceV2("source_normalized_support");
  const claim = source.text.status === "normalized_only"
    ? source.text.normalizedStatement
    : "unreachable";
  assert.equal(OpportunityReportItemSchema.safeParse({
    rank: 1,
    dealId: "deal_acme",
    confidence: "medium",
    score: 0.7,
    whyNow: claim,
    previousContext: "A prior review exists.",
    implications: { positive: [], negative: [] },
    nextStep: "Review the evidence.",
    sources: [source],
    demoFixtureIds: [],
    claimSupport: [{
      text: claim,
      kind: "exact_quote",
      sourceIds: [source.id],
    }],
  }).success, false);
});

test("claim support requires a complete evidence unit and cannot strip negation", () => {
  const strippedClaim = "Acme signed enterprise customers.";
  const negativeStatement =
    "The source did not establish that Acme signed enterprise customers.";
  const exact = exactSourceV2({
    id: "source_negative_exact",
    text: {
      status: "verified_exact",
      verbatimExcerpt: negativeStatement,
    },
  });
  const normalized = persistedNormalizedSourceV2(
    "source_negative_normalized",
    {
      text: {
        status: "normalized_only",
        normalizedStatement: negativeStatement,
      },
    },
  );
  const opportunity = (
    source: typeof exact | typeof normalized,
    text: string,
    kind: "exact_quote" | "normalized_non_quote",
  ) => ({
    rank: 1,
    dealId: "deal_acme",
    confidence: "medium",
    score: 0.7,
    whyNow: text,
    previousContext: "A prior review exists.",
    implications: { positive: [], negative: [] },
    nextStep: "Review the evidence.",
    sources: [source],
    demoFixtureIds: [],
    claimSupport: [{ text, kind, sourceIds: [source.id] }],
  });

  assert.equal(
    OpportunityReportItemSchema.safeParse(
      opportunity(exact, strippedClaim, "exact_quote"),
    ).success,
    false,
  );
  assert.equal(
    OpportunityReportItemSchema.safeParse(
      opportunity(normalized, strippedClaim, "normalized_non_quote"),
    ).success,
    false,
  );
  assert.equal(
    OpportunityReportItemSchema.safeParse(
      opportunity(exact, negativeStatement, "exact_quote"),
    ).success,
    true,
  );
  assert.equal(
    OpportunityReportItemSchema.safeParse(
      opportunity(normalized, negativeStatement, "normalized_non_quote"),
    ).success,
    true,
  );
});

test("accepts a source-grounded no-change company analysis", () => {
  const parsed = CompanyAnalysisSchema.parse(companyAnalysisFixture());

  assert.equal(parsed.companyName, "7bridges");
  assert.equal(parsed.outcome, "no_material_change");
  assert.equal(parsed.companyBrief.traction[0].value, null);
  assert.equal(
    parsed.companyBrief.traction[0].unavailableReason,
    "Not available in current evidence",
  );
});

test("CompanyAnalysis history cannot impersonate a Sample record with public or missing lineage", () => {
  const publicSource = persistedNormalizedSourceV2("public_history_impostor");
  const base = companyAnalysisFixture();
  const historicalMemory = {
    previousMeetingSummary: "A founder meeting occurred.",
    decisionReason: "The fund passed at the prior review.",
    concerns: ["A concern was recorded."],
    revisitConditions: ["Revisit after new evidence."],
    lastEvaluatedAt: "2026-01-12T12:00:00.000Z",
    memoryIds: ["memory_impostor"],
    sourceIds: [publicSource.id],
    fixtureIds: [publicSource.id],
  };
  const publicImpostor = {
    ...base,
    verifiedSourceCount: 1,
    investmentMemory: historicalMemory,
    companyBrief: {
      ...(base.companyBrief as Record<string, unknown>),
      decisionHistory: [{
        occurredAt: "2026-01-12T12:00:00.000Z",
        title: "Founder meeting",
        summary: "The fund passed at the prior review.",
        sourceIds: [publicSource.id],
      }],
      sourceLineage: [publicSource],
    },
    sources: [publicSource],
  };
  assert.equal(CompanyAnalysisSchema.safeParse(publicImpostor).success, false);

  assert.equal(CompanyAnalysisSchema.safeParse({
    ...publicImpostor,
    investmentMemory: {
      ...historicalMemory,
      sourceIds: [],
      fixtureIds: [],
    },
    companyBrief: {
      ...(publicImpostor.companyBrief as Record<string, unknown>),
      decisionHistory: [],
      sourceLineage: [publicSource],
    },
  }).success, false);

  assert.equal(CompanyAnalysisSchema.safeParse({
    ...base,
    investmentMemory: {
      previousMeetingSummary: "No previous meeting summary was recorded.",
      decisionReason: "No previous decision reason was recorded.",
      concerns: [],
      revisitConditions: [],
      lastEvaluatedAt: null,
      memoryIds: ["memory_omitted_fixture"],
      sourceIds: ["source_1"],
      fixtureIds: [],
    },
    companyBrief: {
      ...(base.companyBrief as Record<string, unknown>),
      decisionHistory: [],
    },
  }).success, false, "an unlinked Sample source cannot hide in analysis lineage");
});

test("Opportunity fixture IDs exactly resolve to canonical Sample decision records", () => {
  const publicSource = persistedNormalizedSourceV2("opportunity_public_source");
  const sampleSource = exactSourceV2({
    id: "opportunity_sample_source",
    provenance: "demo_fixture",
    title: "Sample decision record",
    canonicalUrl: null,
    documentId: null,
    publisher: "Internal Deal Registry",
    providerId: "deal-registry",
    eventAt: "2026-01-12T12:00:00.000Z",
    eventAtPrecision: "timestamp",
    publishedAt: null,
    publishedAtPrecision: null,
    retrievedAt: null,
    retrievedAtPrecision: null,
    updatedAt: null,
    updatedAtPrecision: null,
    entityKeys: [],
    sourceClass: "internal_decision_record",
    sourceAuthority: "primary",
    evidenceRole: "context",
    sourceRevisionId: null,
    locator: null,
    contentFingerprint: null,
    text: {
      status: "normalized_only",
      normalizedStatement: "Sample decision record. The fund previously passed.",
    },
  });
  const opportunity = {
    rank: 1,
    dealId: "deal_acme",
    confidence: "medium",
    score: 0.7,
    whyNow: "New evidence changed.",
    previousContext: "The fund previously passed.",
    implications: { positive: [], negative: [] },
    nextStep: "Review the evidence.",
    sources: [publicSource, sampleSource],
    demoFixtureIds: [sampleSource.id],
  };
  assert.equal(OpportunityReportItemSchema.safeParse(opportunity).success, true);
  for (const invalid of [{
    ...opportunity,
    demoFixtureIds: [publicSource.id],
  }, {
    ...opportunity,
    demoFixtureIds: [],
  }, {
    ...opportunity,
    demoFixtureIds: [sampleSource.id, sampleSource.id],
  }, {
    ...opportunity,
    sources: [publicSource],
    demoFixtureIds: ["missing_sample_record"],
  }]) {
    assert.equal(OpportunityReportItemSchema.safeParse(invalid).success, false);
  }
});

test("CompanyAnalysis parsing preserves complete v2 source and event provenance", () => {
  const source = persistedNormalizedSourceV2("source_persisted_v2");
  const event = persistedMarketEventV2(source);
  const fixture = companyAnalysisFixture({
    outcome: "belief_revised",
    confidence: "high",
    verifiedSourceCount: 1,
    investmentMemory: {
      previousMeetingSummary: "No previous meeting summary was recorded.",
      decisionReason: "No previous decision reason was recorded.",
      concerns: [],
      revisitConditions: [],
      lastEvaluatedAt: null,
      memoryIds: [],
      sourceIds: [],
      fixtureIds: [],
    },
    marketEvidence: {
      relationship: "satisfies",
      explanation: "New normalized evidence changed the next review action.",
      eventIds: [event.id],
      events: [event],
      sourceIds: [source.id],
    },
    companyBrief: {
      icSnapshot: [],
      traction: [],
      dealTerms: [],
      risks: [],
      decisionHistory: [],
      sourceLineage: [source],
    },
    sources: [source],
  });

  const parsed = CompanyAnalysisSchema.parse(fixture);
  const parsedSource = parsed.sources[0];
  assert.equal("schemaVersion" in parsedSource, true);
  assert.equal(
    "text" in parsedSource ? parsedSource.text.status : undefined,
    "normalized_only",
  );
  const parsedEvent = parsed.marketEvidence.events[0];
  assert.equal("schemaVersion" in parsedEvent, true);
  assert.equal(
    "retrievedAt" in parsedEvent ? parsedEvent.retrievedAt : undefined,
    "2026-07-24T12:00:00.000Z",
  );
  assert.deepEqual(
    "entityKeys" in parsedEvent ? parsedEvent.entityKeys : undefined,
    ["acme"],
  );
});

test("canonical CompanyAnalysis market source IDs exactly equal embedded event source IDs", () => {
  const eventSource = persistedNormalizedSourceV2("source_market_event");
  const unrelatedSource = persistedNormalizedSourceV2("source_unrelated_fact");
  const event = persistedMarketEventV2(eventSource);
  const fixture = (marketSourceIds: string[], sources = [eventSource]) =>
    companyAnalysisFixture({
      outcome: "belief_revised",
      confidence: "high",
      verifiedSourceCount: sources.length,
      investmentMemory: {
        previousMeetingSummary: "No previous meeting summary was recorded.",
        decisionReason: "No previous decision reason was recorded.",
        concerns: [],
        revisitConditions: [],
        lastEvaluatedAt: null,
        memoryIds: [],
        sourceIds: [],
        fixtureIds: [],
      },
      marketEvidence: {
        relationship: "satisfies",
        explanation: "New normalized evidence changed the next review action.",
        eventIds: [event.id],
        events: [event],
        sourceIds: marketSourceIds,
      },
      companyBrief: {
        icSnapshot: [],
        traction: [],
        dealTerms: [],
        risks: [],
        decisionHistory: [],
        sourceLineage: sources,
      },
      sources,
    });

  assert.equal(
    CompanyAnalysisSchema.safeParse(fixture([eventSource.id])).success,
    true,
  );
  assert.equal(
    CompanyAnalysisSchema.safeParse(fixture([], [eventSource])).success,
    false,
    "missing embedded event lineage must fail closed",
  );
  assert.equal(
    CompanyAnalysisSchema.safeParse(
      fixture(
        [eventSource.id, unrelatedSource.id],
        [eventSource, unrelatedSource],
      ),
    ).success,
    false,
    "unrelated extra lineage must fail closed",
  );
  assert.equal(
    CompanyAnalysisSchema.safeParse(
      fixture([eventSource.id, eventSource.id]),
    ).success,
    false,
    "duplicate canonical market source IDs must fail closed",
  );
  const duplicateEventIdsBase = fixture([eventSource.id]);
  const duplicateEventIds = {
    ...duplicateEventIdsBase,
    marketEvidence: {
      ...(duplicateEventIdsBase.marketEvidence as Record<string, unknown>),
      eventIds: [event.id, event.id],
    },
  };
  assert.equal(
    CompanyAnalysisSchema.safeParse(duplicateEventIds).success,
    false,
    "duplicate canonical market event IDs must fail closed",
  );
});

test("CompanyAnalysis rejects conflicting nested payloads for one source ID", () => {
  const source = persistedNormalizedSourceV2("source_collision_v2");
  const event = persistedMarketEventV2(source);
  const conflicting = { ...source, title: "Conflicting top-level source" };
  const fixture = companyAnalysisFixture({
    outcome: "belief_revised",
    confidence: "high",
    verifiedSourceCount: 1,
    investmentMemory: {
      previousMeetingSummary: "No previous meeting summary was recorded.",
      decisionReason: "No previous decision reason was recorded.",
      concerns: [],
      revisitConditions: [],
      lastEvaluatedAt: null,
      memoryIds: [],
      sourceIds: [],
      fixtureIds: [],
    },
    marketEvidence: {
      relationship: "satisfies",
      explanation: "New evidence changed the next action.",
      eventIds: [event.id],
      events: [event],
      sourceIds: [source.id],
    },
    companyBrief: {
      icSnapshot: [],
      traction: [],
      dealTerms: [],
      risks: [],
      decisionHistory: [],
      sourceLineage: [conflicting],
    },
    sources: [conflicting],
  });

  assert.equal(CompanyAnalysisSchema.safeParse(fixture).success, false);
});

test("CompanyAnalysis claim support rejects legacy and model-only evidence", () => {
  const legacyFixture = companyAnalysisFixture({
    claimSupport: [{
      text: "7bridges provides logistics orchestration software.",
      kind: "normalized_non_quote",
      sourceIds: ["source_1"],
    }],
  });
  assert.equal(CompanyAnalysisSchema.safeParse(legacyFixture).success, false);

  const model = exactSourceV2({
    id: "source_1",
    provenance: "model_inference",
    sourceClass: "model_output",
    sourceAuthority: "not_applicable",
    evidenceRole: "context",
    sourceRevisionId: null,
    locator: null,
    text: {
      status: "model_inference",
      normalizedStatement:
        "7bridges provides logistics orchestration software.",
      model: {
        provider: "anthropic",
        model: "claude-vision-test",
        generatedAt: "2026-07-24T12:00:00.000Z",
        inputFingerprint: SHA256_A,
      },
    },
  });
  const modelFixture = companyAnalysisFixture({
    companyBrief: {
      ...(companyAnalysisFixture().companyBrief as Record<string, unknown>),
      sourceLineage: [model],
    },
    sources: [model],
    claimSupport: [{
      text: "7bridges provides logistics orchestration software.",
      kind: "normalized_non_quote",
      sourceIds: [model.id],
    }],
  });
  assert.equal(CompanyAnalysisSchema.safeParse(modelFixture).success, false);
});

test("report boundaries reject declared malformed v2 instead of downgrading to legacy", () => {
  const malformedSource = {
    ...persistedNormalizedSourceV2("malformed_v2_source"),
    publisher: null,
    excerpt: "A legacy-shaped escape hatch.",
  };
  assert.throws(() => OpportunityReportItemSchema.parse({
    rank: 1,
    dealId: "deal_1",
    confidence: "high",
    score: 0.9,
    whyNow: "New evidence.",
    previousContext: "Prior evidence.",
    implications: { positive: [], negative: [] },
    nextStep: "Review.",
    sources: [malformedSource],
    demoFixtureIds: [],
  }));

  const validSource = persistedNormalizedSourceV2("valid_v2_source");
  const malformedEvent = {
    ...persistedMarketEventV2(validSource),
    triggerSourceId: "missing_source",
    sourceIds: [validSource.id],
  };
  const fixture = companyAnalysisFixture({
    outcome: "belief_revised",
    confidence: "high",
    verifiedSourceCount: 1,
    investmentMemory: {
      previousMeetingSummary: "No previous meeting summary was recorded.",
      decisionReason: "No previous decision reason was recorded.",
      concerns: [],
      revisitConditions: [],
      lastEvaluatedAt: null,
      memoryIds: [],
      sourceIds: [],
      fixtureIds: [],
    },
    marketEvidence: {
      relationship: "satisfies",
      explanation: "Evidence changed.",
      eventIds: [malformedEvent.id],
      events: [malformedEvent],
      sourceIds: [validSource.id],
    },
    companyBrief: {
      icSnapshot: [],
      traction: [],
      dealTerms: [],
      risks: [],
      decisionHistory: [],
      sourceLineage: [validSource],
    },
    sources: [validSource],
  });
  assert.throws(() => CompanyAnalysisSchema.parse(fixture));
});

test("rejects a displayed evidence value without source ids", () => {
  const fixture = companyAnalysisFixture();
  const companyBrief = fixture.companyBrief as Record<string, unknown>;

  assert.throws(() => CompanyAnalysisSchema.parse({
    ...fixture,
    companyBrief: {
      ...companyBrief,
      traction: [{
        label: "ARR",
        value: "$2.4M",
        unavailableReason: null,
        sourceIds: [],
      }],
    },
  }));
});

test("rejects unavailable evidence fields that also contain a value", () => {
  assert.throws(() => EvidenceFieldSchema.parse({
    label: "ARR",
    value: "$2.4M",
    unavailableReason: "Not available in current evidence",
    sourceIds: ["source_1"],
  }));
});

test("rejects a belief revision with low confidence", () => {
  assert.throws(() => CompanyAnalysisSchema.parse(companyAnalysisFixture({
    outcome: "belief_revised",
    confidence: "low",
  })));
});

test("rejects market evidence that cites a source outside the analysis lineage", () => {
  assert.throws(() => CompanyAnalysisSchema.parse(companyAnalysisFixture({
    outcome: "monitor",
    marketEvidence: {
      relationship: "related",
      explanation: "A related market event was detected.",
      eventIds: ["event_1"],
      events: [{
        id: "event_1",
        title: "Logistics software funding increased",
        eventType: "funding",
        publishedAt: "2026-07-23T12:00:00.000Z",
        sourceIds: ["unknown_source"],
      }],
      sourceIds: ["unknown_source"],
    },
  })));
});

test("accepts one complete strict versioned belief assessment", () => {
  const assessment = beliefAssessmentFixture();

  assert.deepEqual(BeliefChangeAssessmentV1Schema.parse(assessment), assessment);
});

test("declared v1 recomputes every hard gate from authoritative context", () => {
  type MutableAssessment = {
    gates: {
      chronology: Record<string, unknown>;
      revisitConditionMapping: Record<string, unknown>;
      counterevidence: Record<string, unknown>;
      actionDelta: Record<string, unknown>;
    };
  };
  const cases: Array<[string, (assessment: MutableAssessment) => void]> = [
    ["fabricated interaction", (assessment) => {
      assessment.gates.chronology.priorInteractionId = "interaction_fabricated";
    }],
    ["fabricated revisit index", (assessment) => {
      assessment.gates.revisitConditionMapping.revisitConditionIndex = 1;
      assessment.gates.revisitConditionMapping.revisitConditionText =
        "Revisit after a plausible but unrecorded milestone.";
    }],
    ["fabricated revisit text", (assessment) => {
      assessment.gates.revisitConditionMapping.revisitConditionText =
        "Revisit after a different enterprise milestone.";
    }],
    ["fabricated trigger event", (assessment) => {
      assessment.gates.revisitConditionMapping.triggerEventId = "event_fabricated";
    }],
    ["citation outside trigger membership", (assessment) => {
      assessment.gates.revisitConditionMapping.citedSourceIds = [
        "counter_source_1",
      ];
    }],
    ["unsupported counter statement", (assessment) => {
      assessment.gates.counterevidence.statement =
        "A fabricated source claim says customer retention is fully durable.";
    }],
    ["counter citation without claim support", (assessment) => {
      assessment.gates.counterevidence.citedSourceIds = ["trigger_source_1"];
    }],
    ["fabricated prior actions", (assessment) => {
      assessment.gates.actionDelta.priorActions = [action("continue_monitoring")];
    }],
  ];

  for (const [name, mutate] of cases) {
    const assessment = structuredClone(
      beliefAssessmentFixture(),
    ) as unknown as MutableAssessment;
    mutate(assessment);
    assert.equal(
      BeliefChangeAssessmentV1Schema.safeParse(assessment).success,
      false,
      name,
    );
  }
});

test("declared v1 binds its selected prior interaction to Sample source lineage", () => {
  const assessment = structuredClone(
    beliefAssessmentFixture(),
  ) as unknown as {
    gateContext: { priorInteraction: { sourceIds: string[] } };
  };
  assessment.gateContext.priorInteraction.sourceIds = ["trigger_source_1"];

  assert.equal(
    BeliefChangeAssessmentV1Schema.safeParse(assessment).success,
    false,
  );
});

test("declared v1 rejects supporting counterevidence cited under the wrong role", () => {
  const assessment = structuredClone(
    beliefAssessmentFixture(),
  );
  const mutable = assessment as unknown as {
    gateContext: { sources: Array<{ id: string; evidenceRole: string }> };
  };
  const counterSource = mutable.gateContext.sources.find(
    (source) => source.id === "counter_source_1",
  );
  assert.ok(counterSource);
  counterSource.evidenceRole = "trigger";

  assert.equal(
    BeliefChangeAssessmentV1Schema.safeParse(assessment).success,
    false,
  );
});

test("rejects incomplete or extensible declared belief assessment v1 payloads", () => {
  const complete = beliefAssessmentFixture();
  const missingGates: Record<string, unknown> = { ...complete };
  delete missingGates.gates;

  assert.equal(
    BeliefChangeAssessmentV1Schema.safeParse(missingGates).success,
    false,
  );
  assert.equal(
    BeliefChangeAssessmentV1Schema.safeParse({ ...complete, modelNote: "trust me" })
      .success,
    false,
  );
});

test("declared belief assessment v1 rejects the legacy interested status alias", () => {
  const base = beliefAssessmentFixture();
  const gates = base.gates as Record<string, unknown>;
  const actionDelta = gates.actionDelta as Record<string, unknown>;
  const proposedActions = [action("advance_diligence")];
  assert.equal(BeliefChangeAssessmentV1Schema.safeParse({
    ...base,
    dealStatus: "interested",
    gates: {
      ...gates,
      actionDelta: { ...actionDelta, proposedActions },
    },
    actions: proposedActions,
  }).success, false);
});

test("rejects persisted score and confidence values inconsistent with all four dimensions", () => {
  const scoreBreakdown = beliefAssessmentFixture().scoreBreakdown as Record<
    string,
    unknown
  >;
  const cases = [
    {
      name: "wrong final score",
      scoreBreakdown: { ...scoreBreakdown, finalScore: 0.79 },
    },
    {
      name: "wrong confidence",
      scoreBreakdown: { ...scoreBreakdown, confidence: "medium" },
    },
  ];

  for (const { name, scoreBreakdown: invalid } of cases) {
    assert.equal(
      BeliefChangeAssessmentV1Schema.safeParse(
        beliefAssessmentFixture({ scoreBreakdown: invalid }),
      ).success,
      false,
      name,
    );
  }
});

test("rejects persisted allPassed values inconsistent with named hard gates", () => {
  const gates = beliefAssessmentFixture().gates as Record<string, unknown>;
  const chronology = gates.chronology as Record<string, unknown>;

  assert.equal(BeliefRevisionGateResultsSchema.safeParse({
    ...gates,
    chronology: {
      ...chronology,
      priorInteractionAt: "2026-07-23T12:00:00.000Z",
      passed: false,
      failureReason: "The prior interaction did not predate the trigger event.",
    },
    allPassed: true,
  }).success, false);
});

test("rejects an unbounded hard-gate failure reason", () => {
  const gates = beliefAssessmentFixture().gates as Record<string, unknown>;
  const chronology = gates.chronology as Record<string, unknown>;

  assert.equal(BeliefRevisionGateResultsSchema.safeParse({
    ...gates,
    chronology: {
      ...chronology,
      priorInteractionAt: "2026-07-23T12:00:00.000Z",
      passed: false,
      failureReason: "x".repeat(501),
    },
    allPassed: false,
  }).success, false);
});

test("rejects noncanonical action metadata and an action list illegal for status and direction", () => {
  const assessment = beliefAssessmentFixture();
  const badMetadata = {
    ...action("reopen_diligence"),
    scope: "portfolio",
  };

  assert.equal(BeliefChangeAssessmentV1Schema.safeParse({
    ...assessment,
    actions: [badMetadata],
  }).success, false);
  assert.equal(BeliefChangeAssessmentV1Schema.safeParse({
    ...assessment,
    actions: [action("deprioritize")],
  }).success, false);
});

test("new CompanyAnalysis payloads reject arbitrary compatibility text and cross-field score drift", () => {
  const beliefAssessment = beliefAssessmentFixture();
  const valid = versionedCompanyAnalysisFixture(beliefAssessment);

  assert.equal(CompanyAnalysisSchema.safeParse(valid).success, true);
  assert.equal(CompanyAnalysisSchema.safeParse({
    ...valid,
    recommendedNextMove: "Model-selected founder outreach prose.",
  }).success, false);
  assert.equal(CompanyAnalysisSchema.safeParse({
    ...valid,
    score: 0.81,
  }).success, false);
});

test("CompanyAnalysis re-resolves v1 gate context through canonical outer lineage", () => {
  const valid = versionedCompanyAnalysisFixture();
  assert.equal(CompanyAnalysisSchema.safeParse(valid).success, true);

  const missingContextSource = structuredClone(valid) as unknown as {
    sources: Array<{ id: string }>;
    verifiedSourceCount: number;
  };
  missingContextSource.sources = missingContextSource.sources.filter(
    (source: { id: string }) => source.id !== "counter_source_1",
  );
  missingContextSource.verifiedSourceCount = missingContextSource.sources.length;
  assert.equal(
    CompanyAnalysisSchema.safeParse(missingContextSource).success,
    false,
  );

  const driftedMemory = structuredClone(valid) as unknown as {
    investmentMemory: { revisitConditions: string[] };
  };
  driftedMemory.investmentMemory.revisitConditions = [
    "Revisit after an unrelated milestone.",
  ];
  assert.equal(CompanyAnalysisSchema.safeParse(driftedMemory).success, false);
});

test("CompanyAnalysis rejects forged prior actions behind authentic Sample lineage", () => {
  const beliefAssessment = structuredClone(beliefAssessmentFixture());
  const mutable = beliefAssessment as unknown as {
    gateContext: { priorInteraction: { priorActions: BeliefAction[] } };
    gates: { actionDelta: { priorActions: BeliefAction[] } };
  };
  const forgedPriorActions = [action("continue_monitoring")];
  mutable.gateContext.priorInteraction.priorActions = forgedPriorActions;
  mutable.gates.actionDelta.priorActions = forgedPriorActions;
  assert.equal(
    BeliefChangeAssessmentV1Schema.safeParse(beliefAssessment).success,
    true,
    "the forged self-consistent assessment demonstrates why outer rebinding is required",
  );

  const analysis = versionedCompanyAnalysisFixture(beliefAssessment);
  const outerMemory = analysis.investmentMemory as Record<string, unknown>;
  outerMemory.priorActions = [action("no_new_action")];
  assert.equal(CompanyAnalysisSchema.safeParse(analysis).success, false);
});

test("CompanyAnalysis declared v1 rejects a raw legacy interested outer status", () => {
  const assessment = beliefAssessmentFixture();
  const invalid = versionedCompanyAnalysisFixture(assessment, {
    dealStatus: "interested",
  });

  assert.equal(BeliefChangeAssessmentV1Schema.safeParse(assessment).success, true);
  assert.equal(CompanyAnalysisSchema.safeParse(invalid).success, false);
});

test("none and unavailable directions can never declare a belief revision", () => {
  for (const direction of ["none", "unavailable"] as const) {
    const kind = direction === "none"
      ? "no_new_action"
      : "review_analysis_failure";
    const proposedActions = [action(kind)];
    const base = beliefAssessmentFixture({ direction, actions: proposedActions });
    const baseGates = base.gates as Record<string, unknown>;
    const actionDelta = baseGates.actionDelta as Record<string, unknown>;
    const gateContext = base.gateContext as unknown as {
      priorInteraction: Record<string, unknown>;
    };
    const beliefAssessment = {
      ...base,
      gateContext: {
        ...gateContext,
        priorInteraction: {
          ...gateContext.priorInteraction,
          priorActions: [action("continue_monitoring")],
        },
      },
      gates: {
        ...baseGates,
        actionDelta: {
          ...actionDelta,
          priorActions: [action("continue_monitoring")],
          proposedActions,
        },
      },
    };
    const analysis = companyAnalysisFixture({
      outcome: "belief_revised",
      confidence: "high",
      score: 0.8,
      beliefAssessment,
      recommendedNextMove: renderRecommendedNextMove(proposedActions),
    });

    assert.equal(
      BeliefChangeAssessmentV1Schema.safeParse(beliefAssessment).success,
      true,
      `${direction} assessment fixture must be independently valid`,
    );
    assert.equal(CompanyAnalysisSchema.safeParse(analysis).success, false, direction);
  }
});

test("persisted CompanyAnalysis reads add a safe external label without weakening canonical writes", () => {
  const legacy = companyAnalysisFixture();
  const companyBrief = legacy.companyBrief as Record<string, unknown>;
  companyBrief.structuredFields = [{
    id: `semantic-field-${"a".repeat(24)}`,
    schemaVersion: "deal-semantic-field-v1",
    fieldId: "unknowns",
    classification: "unknown",
    reason:
      "Internal concern: founder reference quality did not pass our prior review.",
  }];

  assert.equal(
    CompanyAnalysisSchema.safeParse(legacy).success,
    false,
    "new canonical writes must not omit externalLabel",
  );
  const parsed = parseCompanyAnalysisRead(legacy);
  const parsedBrief = parsed.companyBrief as {
    structuredFields: Array<Record<string, unknown>>;
  };
  assert.deepEqual(parsedBrief.structuredFields[0], {
    ...(companyBrief.structuredFields as Array<Record<string, unknown>>)[0],
    externalLabel: "Current company evidence for review",
  });
  assert.equal(
    String(parsedBrief.structuredFields[0]?.externalLabel).includes(
      "did not pass",
    ),
    false,
  );
  assert.equal(CompanyAnalysisSchema.safeParse(parsed).success, true);
});
