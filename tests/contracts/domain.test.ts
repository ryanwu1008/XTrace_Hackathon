import assert from "node:assert/strict";
import test from "node:test";

import {
  CompanyAnalysisSchema,
  DealStatusSchema,
  EvidenceFieldSchema,
  MarketEventSchema,
  OpportunityReportItemSchema,
  SourceRefSchema,
} from "../../lib/contracts/domain";
import {
  MarketEventV2Schema,
  SourceRefV2Schema,
  WritableMarketEventV2Schema,
  sourceCanGroundExactQuote,
  sourceCanGroundOutputFact,
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
    publishedAt: "2026-07-23T15:00:00.000Z",
    retrievedAt: "2026-07-24T12:00:00.000Z",
    updatedAt: null,
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
    publishedAt: "2026-07-23T15:00:00.000Z",
    retrievedAt: "2026-07-24T12:00:00.000Z",
    updatedAt: null,
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
    verifiedSourceCount: 1,
    investmentMemory: {
      previousMeetingSummary: "The team presented its logistics platform.",
      decisionReason: "The fund passed pending stronger enterprise adoption.",
      concerns: ["Enterprise adoption was not yet demonstrated."],
      revisitConditions: ["Revisit after measurable enterprise adoption."],
      lastEvaluatedAt: "2026-01-12T12:00:00.000Z",
      memoryIds: ["memory_1"],
      sourceIds: ["source_1"],
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
        sourceIds: ["source_1"],
      }],
      decisionHistory: [{
        occurredAt: "2026-01-12T12:00:00.000Z",
        title: "Initial review",
        summary: "The fund passed pending stronger enterprise adoption.",
        sourceIds: ["source_1"],
      }],
      sourceLineage: [source],
    },
    sources: [source],
    createdAt: "2026-07-24T12:00:00.000Z",
    ...overrides,
  };
}

test("normalizes the legacy interested status to watchlist", () => {
  assert.equal(DealStatusSchema.parse("interested"), "watchlist");
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
      undefined,
      `source version ${String(schemaVersion)}`,
    );
  }
  for (const schemaVersion of ["market-event-v3", null, 3]) {
    assert.throws(
      () => parseMarketEventV2Read({ ...legacyEvent, schemaVersion }),
      undefined,
      `event version ${String(schemaVersion)}`,
    );
  }
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

test("CompanyAnalysis parsing preserves complete v2 source and event provenance", () => {
  const source = persistedNormalizedSourceV2("source_persisted_v2");
  const event = persistedMarketEventV2(source);
  const fixture = companyAnalysisFixture({
    outcome: "belief_revised",
    confidence: "high",
    verifiedSourceCount: 1,
    investmentMemory: {
      previousMeetingSummary: "A prior review exists.",
      decisionReason: "The prior evidence was insufficient.",
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
      previousMeetingSummary: "A prior review exists.",
      decisionReason: "Prior evidence was insufficient.",
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
