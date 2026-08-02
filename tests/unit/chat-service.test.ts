import assert from "node:assert/strict";
import test from "node:test";

import { createGroundedChatService } from "../../lib/chat/service";
import {
  exactSourceV2,
  normalizedSourceV2,
  TEST_SHA256_A,
} from "../helpers/source-evidence-v2";

test("grounded Chat returns insufficient evidence without browsing", async () => {
  let modelCalled = false;
  const chat = createGroundedChatService({
    searchExistingData: async () => [],
    recallMemory: async () => ({ status: "available", evidence: [] }),
    complete: async () => {
      modelCalled = true;
      return "{}";
    },
  });

  const answer = await chat.answer({
    workspaceId: "demo",
    question: "What happened today to an unknown company?",
    xtraceEnabled: true,
  });

  assert.equal(answer.insufficientEvidence, true);
  assert.equal(answer.citations.length, 0);
  assert.equal(modelCalled, false);
});

test("grounded Chat fails closed on conflicting payloads for one source ID", async () => {
  let modelCalled = false;
  const chat = createGroundedChatService({
    searchExistingData: async () => [{
      text: "Source A text.",
      sources: [{
        id: "shared_source",
        provenance: "public_web",
        title: "Source A",
        url: "https://example.com/a",
        excerpt: "Source A text.",
      }],
    }, {
      text: "Source B text.",
      sources: [{
        id: "shared_source",
        provenance: "public_web",
        title: "Source B",
        url: "https://example.com/b",
        excerpt: "Source B text.",
      }],
    }],
    recallMemory: async () => ({ status: "available", evidence: [] }),
    complete: async () => {
      modelCalled = true;
      return "{}";
    },
  });

  await assert.rejects(
    chat.answer({
      workspaceId: "demo",
      question: "Which source is correct?",
      xtraceEnabled: false,
    }),
    /conflicting chat evidence source id/i,
  );
  assert.equal(modelCalled, false);
});

test("grounded Chat detects same-text source metadata collisions before normalization or model use", async () => {
  let modelCalled = false;
  const first = exactSourceV2("same_text_collision", {
    title: "First canonical source",
    canonicalUrl: "https://example.com/first",
    text: {
      status: "verified_exact",
      verbatimExcerpt: "The same verified evidence text.",
    },
  });
  const second = exactSourceV2("same_text_collision", {
    title: "Second canonical source",
    canonicalUrl: "https://example.com/second",
    text: {
      status: "verified_exact",
      verbatimExcerpt: "The same verified evidence text.",
    },
  });
  const chat = createGroundedChatService({
    searchExistingData: async () => [{
      text: "The same verified evidence text.",
      sources: [first],
    }, {
      text: "The same verified evidence text.",
      sources: [second],
    }],
    recallMemory: async () => ({ status: "available", evidence: [] }),
    complete: async () => {
      modelCalled = true;
      return "{}";
    },
  });

  await assert.rejects(
    chat.answer({
      workspaceId: "demo",
      question: "What does the evidence say?",
      xtraceEnabled: false,
    }),
    /conflicting chat evidence source id/i,
  );
  assert.equal(modelCalled, false);
});

test("grounded Chat rejects intrinsic-unit conflicts before model use", async () => {
  let modelCalled = false;
  const first = exactSourceV2("intrinsic_chat_source_a", {
    sourceRevisionId: "revision_shared_chat",
    locator: { kind: "web_text", selector: "#same" },
  });
  const roleSpoof = exactSourceV2("intrinsic_chat_source_b", {
    sourceRevisionId: "revision_shared_chat",
    locator: { kind: "web_text", selector: "#same" },
    evidenceRole: "counterevidence",
  });
  const chat = createGroundedChatService({
    searchExistingData: async () => [{
      text: first.text.status === "verified_exact"
        ? first.text.verbatimExcerpt
        : "",
      sources: [first, roleSpoof],
    }],
    recallMemory: async () => ({ status: "available", evidence: [] }),
    complete: async () => {
      modelCalled = true;
      return "{}";
    },
  });

  await assert.rejects(chat.answer({
    workspaceId: "demo",
    question: "What happened?",
    xtraceEnabled: false,
  }), /intrinsic evidence unit|conflicting evidence metadata/i);
  assert.equal(modelCalled, false);
});

test("grounded Chat excludes legacy and model-inference context from factual grounding", async () => {
  let modelCalled = false;
  const model = normalizedSourceV2("model_context", {
    provenance: "model_inference",
    canonicalUrl: null,
    documentId: null,
    publisher: null,
    providerId: "anthropic",
    sourceClass: "model_output",
    sourceAuthority: "not_applicable",
    evidenceRole: "context",
    sourceRevisionId: null,
    locator: null,
    text: {
      status: "model_inference",
      normalizedStatement: "The model inferred that Acme has $100M ARR.",
      model: {
        provider: "anthropic",
        model: "test-model",
        generatedAt: "2026-07-24T12:00:00.000Z",
        inputFingerprint: TEST_SHA256_A,
      },
    },
  });
  const chat = createGroundedChatService({
    searchExistingData: async () => [{
      text: "A legacy report says Acme has $100M ARR.",
      sources: [{
        id: "legacy_context",
        provenance: "public_web",
        title: "Legacy context",
        url: "https://example.com/legacy",
        excerpt: "A legacy report says Acme has $100M ARR.",
      }],
    }, {
      text: "The model inferred that Acme has $100M ARR.",
      sources: [model],
    }],
    recallMemory: async () => ({ status: "available", evidence: [] }),
    complete: async () => {
      modelCalled = true;
      return "{}";
    },
  });

  const answer = await chat.answer({
    workspaceId: "demo",
    question: "What is Acme ARR?",
    xtraceEnabled: false,
  });

  assert.equal(answer.insufficientEvidence, true);
  assert.deepEqual(answer.citations, []);
  assert.doesNotMatch(answer.answer, /\$100M/);
  assert.equal(modelCalled, false);
});

test("grounded Chat rejects a demo fixture that impersonates factual public evidence", async () => {
  let modelCalled = false;
  const forgedFixture = normalizedSourceV2("forged_demo_fixture", {
    provenance: "demo_fixture",
    title: "Acme official metrics",
    canonicalUrl: null,
    documentId: null,
    publisher: "Acme",
    providerId: "forged-demo-provider",
    sourceClass: "company_official",
    sourceAuthority: "primary",
    evidenceRole: "trigger",
    sourceRevisionId: null,
    locator: null,
    retrievedAt: null,
    retrievedAtPrecision: null,
    contentFingerprint: null,
    text: {
      status: "normalized_only",
      normalizedStatement: "Acme has $100M ARR.",
    },
  });
  const chat = createGroundedChatService({
    searchExistingData: async () => [{
      text: "Acme has $100M ARR.",
      sources: [forgedFixture],
    }],
    recallMemory: async () => ({ status: "available", evidence: [] }),
    complete: async () => {
      modelCalled = true;
      return "{}";
    },
  });

  await assert.rejects(
    chat.answer({
      workspaceId: "demo",
      question: "What is Acme ARR?",
      xtraceEnabled: false,
    }),
    /Sample decision record|demo fixture/i,
  );
  assert.equal(modelCalled, false);
});

test("grounded Chat rejects a Sample-label prefix bypass before model use", async () => {
  let modelCalled = false;
  const forgedFixture = normalizedSourceV2("forged_sample_label_boundary", {
    provenance: "demo_fixture",
    title: "Sample decision record",
    canonicalUrl: null,
    documentId: null,
    publisher: "Internal Deal Registry",
    providerId: "deal-registry",
    eventAt: null,
    eventAtPrecision: null,
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
        "Sample decision recordkeeping says the company has $100M ARR.",
    },
  });
  const chat = createGroundedChatService({
    searchExistingData: async () => [{
      text: "Sample decision recordkeeping says the company has $100M ARR.",
      sources: [forgedFixture],
    }],
    recallMemory: async () => ({ status: "available", evidence: [] }),
    complete: async () => {
      modelCalled = true;
      return "{}";
    },
  });

  await assert.rejects(
    chat.answer({
      workspaceId: "demo",
      question: "What is the company's ARR?",
      xtraceEnabled: false,
    }),
    /Sample decision record|demo fixture/i,
  );
  assert.equal(modelCalled, false);
});

test("grounded Chat preserves normalized evidence as non-quote prompt evidence", async () => {
  const statement = "Acme announced a Series B funding round.";
  const source = normalizedSourceV2("normalized_chat_source", {
    text: { status: "normalized_only", normalizedStatement: statement },
  });
  let prompt = "";
  let system = "";
  const chat = createGroundedChatService({
    searchExistingData: async () => [{ text: statement, sources: [source] }],
    recallMemory: async () => ({ status: "available", evidence: [] }),
    complete: async (input) => {
      prompt = input.prompt;
      system = input.system;
      return JSON.stringify({
        claims: [{ text: statement, sourceIds: [source.id] }],
        insufficientEvidence: false,
      });
    },
  });

  const answer = await chat.answer({
    workspaceId: "demo",
    question: "What did Acme announce?",
    xtraceEnabled: false,
  });
  const promptEvidence = JSON.parse(prompt).evidence[0];

  assert.equal(promptEvidence.textStatus, "normalized_only");
  assert.equal(promptEvidence.supportKind, "normalized_non_quote");
  assert.equal(promptEvidence.quoteEligible, false);
  assert.match(system, /complete evidence item/i);
  assert.match(system, /qualifier|negation/i);
  assert.equal(answer.insufficientEvidence, false);
  assert.equal(
    "schemaVersion" in answer.citations[0]
      ? answer.citations[0].text.status
      : undefined,
    "normalized_only",
  );
});

test("grounded Chat withholds a local-only answer when requested XTrace recall is unavailable", async () => {
  let modelCalled = false;
  const chat = createGroundedChatService({
    searchExistingData: async () => [{
      text: "Ably provides realtime infrastructure.",
      sources: [{
        id: "source_ably",
        provenance: "source_document",
        title: "Ably pitch deck",
        documentId: "doc_ably",
        excerpt: "Ably provides realtime infrastructure.",
      }],
    }],
    recallMemory: async () => ({
      status: "unavailable" as const,
    }),
    complete: async () => {
      modelCalled = true;
      return "{}";
    },
  });

  const answer = await chat.answer({
    workspaceId: "demo",
    question: "What does Ably provide?",
    xtraceEnabled: true,
  });

  assert.equal(answer.memoryStatus, "unavailable");
  assert.equal(answer.insufficientEvidence, true);
  assert.equal(answer.citations.length, 0);
  assert.match(answer.answer, /local-only answer.*withheld/i);
  assert.equal(modelCalled, false);
});

test("grounded Chat withholds a local-only answer when enabled XTrace recall resolves no evidence", async () => {
  let modelCalled = false;
  const chat = createGroundedChatService({
    searchExistingData: async () => [{
      text: "Ably provides realtime infrastructure.",
      sources: [{
        id: "source_ably",
        provenance: "source_document",
        title: "Ably pitch deck",
        documentId: "doc_ably",
        excerpt: "Ably provides realtime infrastructure.",
      }],
    }],
    recallMemory: async () => ({ status: "available" as const, evidence: [] }),
    complete: async () => {
      modelCalled = true;
      return "{}";
    },
  });

  const answer = await chat.answer({
    workspaceId: "demo",
    question: "What does Ably provide?",
    xtraceEnabled: true,
  });

  assert.equal(answer.memoryStatus, "unavailable");
  assert.equal(answer.insufficientEvidence, true);
  assert.deepEqual(answer.citations, []);
  assert.match(answer.answer, /local-only answer.*withheld/i);
  assert.equal(modelCalled, false);
});

test("grounded Chat rejects a fabricated claim even when it cites a real source", async () => {
  const source = {
    id: "source_ably",
    provenance: "source_document" as const,
    title: "Ably pitch deck",
    documentId: "doc_ably",
    excerpt: "Ably provides realtime infrastructure.",
  };
  const chat = createGroundedChatService({
    searchExistingData: async () => [{
      text: "Ably provides realtime infrastructure.",
      sources: [source],
    }],
    recallMemory: async () => ({ status: "available", evidence: [] }),
    complete: async () => JSON.stringify({
      claims: [{
        text: "Ably has $100M ARR and signed Acme yesterday.",
        sourceIds: ["source_ably"],
      }],
      insufficientEvidence: false,
    }),
  });

  const answer = await chat.answer({
    workspaceId: "demo",
    question: "What is Ably's ARR?",
    xtraceEnabled: false,
  });

  assert.equal(answer.insufficientEvidence, true);
  assert.equal(answer.citations.length, 0);
  assert.doesNotMatch(answer.answer, /\$100M/);
});

test("grounded Chat rejects a claim that strips negation from cited evidence", async () => {
  const source = {
    id: "source_7bridges",
    provenance: "source_document" as const,
    title: "7bridges pitch deck",
    documentId: "doc_7bridges",
    excerpt: "The source did not establish that 7bridges signed enterprise customers.",
  };
  const chat = createGroundedChatService({
    searchExistingData: async () => [{ text: source.excerpt, sources: [source] }],
    recallMemory: async () => ({ status: "available", evidence: [] }),
    complete: async () => JSON.stringify({
      claims: [{
        text: "7bridges signed enterprise customers.",
        sourceIds: [source.id],
      }],
      insufficientEvidence: false,
    }),
  });

  const answer = await chat.answer({
    workspaceId: "demo",
    question: "Did 7bridges sign enterprise customers?",
    xtraceEnabled: false,
  });

  assert.equal(answer.insufficientEvidence, true);
  assert.deepEqual(answer.citations, []);
  assert.doesNotMatch(answer.answer, /signed enterprise customers/i);
});

test("grounded Chat never treats recalled XTrace text as stronger than its source excerpt", async () => {
  const source = {
    id: "source_ably",
    provenance: "source_document" as const,
    title: "Ably pitch deck",
    documentId: "doc_ably",
    excerpt: "Ably provides realtime infrastructure.",
  };
  const chat = createGroundedChatService({
    searchExistingData: async () => [],
    recallMemory: async () => ({
      status: "available",
      evidence: [{
        text: "Ably has $100M ARR and signed Acme yesterday.",
        sources: [source],
      }],
    }),
    complete: async () => JSON.stringify({
      claims: [{
        text: "Ably has $100M ARR and signed Acme yesterday.",
        sourceIds: [source.id],
      }],
      insufficientEvidence: false,
    }),
  });

  const answer = await chat.answer({
    workspaceId: "demo",
    question: "What is Ably's ARR?",
    xtraceEnabled: true,
  });

  assert.equal(answer.insufficientEvidence, true);
  assert.equal(answer.citations.length, 0);
  assert.doesNotMatch(answer.answer, /\$100M/);
});

test("grounded Chat returns only exact evidence claims with deduplicated citations", async () => {
  const source = exactSourceV2("source_ably", {
    provenance: "source_document",
    title: "Ably pitch deck",
    canonicalUrl: null,
    documentId: "doc_ably",
    publisher: null,
    providerId: "deal-registry",
    sourceClass: "company_official",
    sourceAuthority: "primary",
    evidenceRole: "context",
    text: {
      status: "verified_exact",
      verbatimExcerpt: "Ably provides realtime infrastructure.",
      normalizedStatement:
        "Ably offers infrastructure for realtime communications.",
    },
  });
  let prompt = "";
  const chat = createGroundedChatService({
    searchExistingData: async () => [{
      text: "Ably provides realtime infrastructure.",
      sources: [source],
    }],
    recallMemory: async () => ({ status: "available", evidence: [] }),
    complete: async (input) => {
      prompt = input.prompt;
      return JSON.stringify({
        claims: [{
          text: "Ably provides realtime infrastructure.",
          sourceIds: ["source_ably"],
        }],
        insufficientEvidence: false,
      });
    },
  });

  const answer = await chat.answer({
    workspaceId: "demo",
    question: "What does Ably provide?",
    xtraceEnabled: false,
  });

  assert.equal(answer.answer, "Ably provides realtime infrastructure.");
  assert.equal(answer.citations.length, 1);
  assert.equal(answer.usedXTrace, false);
  assert.equal(answer.insufficientEvidence, false);
  const promptEvidence = JSON.parse(prompt).evidence as Array<{
    text: string;
    textStatus: string;
    supportKind: string;
    quoteEligible: boolean;
  }>;
  assert.deepEqual(
    promptEvidence.map((item) => ({
      text: item.text,
      textStatus: item.textStatus,
      supportKind: item.supportKind,
      quoteEligible: item.quoteEligible,
    })),
    [{
      text: "Ably provides realtime infrastructure.",
      textStatus: "verified_exact",
      supportKind: "exact_quote",
      quoteEligible: true,
    }, {
      text: "Ably offers infrastructure for realtime communications.",
      textStatus: "verified_exact",
      supportKind: "normalized_non_quote",
      quoteEligible: false,
    }],
  );
});
