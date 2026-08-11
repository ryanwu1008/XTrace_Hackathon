import assert from "node:assert/strict";
import test from "node:test";

import {
  sourceRevisionFingerprint,
  type RegisteredDeal,
} from "../../db/repositories/deal-registry";
import {
  createMemoryEvidencePacksRepository,
} from "../../db/repositories/evidence-packs";
import {
  createMemorySourceRegistry,
} from "../../db/repositories/source-registry";
import type { XTraceMemoryLineage } from "../../db/repositories/xtrace-lineage";
import type { CompanyAnalysis } from "../../lib/contracts/domain";
import type { CandidateRun } from "../../lib/contracts/underwriting";
import {
  createEvidencePackCandidateGrounding,
} from "../../lib/underwriting/candidate-grounding";

const candidate: CandidateRun = {
  id: "candidate_1",
  batchId: "batch_1",
  workspaceId: "workspace_1",
  dealId: "deal_1",
  status: "running",
  candidateAnalysisFingerprint: `sha256:${"a".repeat(64)}`,
  rerunOfId: null,
  createdAt: "2026-07-29T12:00:00.000Z",
  finalizedAt: null,
};

const analysis: CompanyAnalysis = {
  id: "analysis_1",
  reportId: "report_1",
  runId: "run_1",
  dealId: "deal_1",
  companyName: "Acme",
  dealStatus: "evaluating",
  outcome: "belief_revised",
  confidence: "high",
  score: 0.9,
  verifiedSourceCount: 1,
  investmentMemory: {
    previousMeetingSummary: "Acme was previously reviewed.",
    decisionReason: "More evidence was required.",
    concerns: [],
    revisitConditions: ["Revisit with confirmed evidence."],
    lastEvaluatedAt: "2026-01-01T00:00:00.000Z",
    memoryIds: ["memory_1"],
    sourceIds: ["source_document_1"],
    fixtureIds: [],
  },
  marketEvidence: {
    relationship: "related",
    explanation: "A relevant event was observed.",
    eventIds: ["event_1"],
    events: [{
      id: "event_1",
      title: "Acme update",
      eventType: "funding",
      publishedAt: "2026-07-28T00:00:00.000Z",
      sourceIds: ["market_source_1"],
    }],
    sourceIds: ["market_source_1"],
  },
  implications: {
    positive: ["The update warrants review."],
    negative: [],
  },
  recommendedNextMove: "Review the confirmed evidence.",
  companyBrief: {
    icSnapshot: [],
    traction: [],
    dealTerms: [],
    risks: [],
    decisionHistory: [],
    sourceLineage: [{
      id: "source_document_1",
      provenance: "source_document",
      title: "Acme memo",
      documentId: "source_document_1",
      excerpt: "Acme was previously reviewed.",
    }],
  },
  sources: [{
    id: "source_document_1",
    provenance: "source_document",
    title: "Acme memo",
    documentId: "source_document_1",
    excerpt: "Acme was previously reviewed.",
  }, {
    id: "market_source_1",
    provenance: "public_web",
    title: "Acme update",
    url: "https://example.com/acme",
    publishedAt: "2026-07-28T00:00:00.000Z",
    excerpt: "A relevant event was observed.",
  }],
  createdAt: "2026-07-29T12:00:00.000Z",
};

async function groundingFor(
  lineage: XTraceMemoryLineage,
  evidenceSourceId = "source_document_1",
  options: {
    revisionSourceId?: string;
    exact?: boolean;
    onExactResolve?: (input: {
      memoryId: string;
      workspaceId: string;
      dealId: string;
      activeParentFingerprint: string;
    }) => void;
  } = {},
) {
  const revisionSourceId = options.revisionSourceId ?? "source_document_1";
  const sourceRegistry = createMemorySourceRegistry();
  await sourceRegistry.createInitialRevision({
    id: "revision_1",
    workspaceId: "workspace_1",
    sourceId: revisionSourceId,
    contentHash: "hash-1",
    objectKey: "private/acme.md",
    objectVersion: "object:v1",
    contentType: "text/markdown",
    extractorId: "plain_text_v1",
    extractorVersion: "1",
    extractedAt: "2026-07-29T10:00:00.000Z",
    createdAt: "2026-07-29T10:00:01.000Z",
  });
  const repository = createMemoryEvidencePacksRepository();
  await repository.putSourceEvidence([{
    id: "evidence_1",
    workspaceId: "workspace_1",
    dealId: "deal_1",
    sourceId: evidenceSourceId,
    sourceRevisionId: "revision_1",
    provenanceOrigin: "uploaded_document",
    field: "unstructured_source_fact",
    value: "Acme was previously reviewed.",
    unit: null,
    currency: null,
    periodStart: null,
    periodEnd: null,
    publishedAt: null,
    eventAt: null,
    retrievedAt: "2026-07-29T10:00:00.000Z",
    locator: {
      kind: "text_range",
      start: 0,
      end: 29,
      excerpt: "Acme was previously reviewed.",
    },
    sourceRole: "management",
    assertionStatus: "reported",
    verificationMethod: null,
    freshness: "current",
    acceptedForGate: false,
  }]);
  const activeSourceRevisionIds = ["revision_1"];
  const deal: RegisteredDeal = {
    id: "deal_1",
    workspaceId: "workspace_1",
    companyId: "company_1",
    companyName: "Acme",
    status: "evaluating",
    analysisEligibleAt: "2026-07-29T10:01:00.000Z",
    activeSourceRevisionIds,
    activeSourceRevisionFingerprint:
      sourceRevisionFingerprint(activeSourceRevisionIds),
  };
  const grounding = createEvidencePackCandidateGrounding({
    repository,
    sourceRegistry,
    builder: {
      async build() {
        throw new Error("This lineage test does not build an Evidence Pack.");
      },
    },
    criticalEvidenceProfiles: [],
    xtraceLineage: options.exact
      ? {
          async resolve() {
            throw new Error(
              "Exact XTrace grounding must not downgrade to legacy lineage.",
            );
          },
          async resolveExact(input) {
            options.onExactResolve?.(input);
            return structuredClone(lineage);
          },
        }
      : {
          async resolve() {
            return structuredClone(lineage);
          },
        },
    async resolveBenchmark() {
      return null;
    },
  });
  return { grounding, deal };
}

test("explicit XTrace revisions validate sourceIds as document IDs", async () => {
  const { grounding, deal } = await groundingFor({
    memoryId: "memory_1",
    workspaceId: "workspace_1",
    dealId: "deal_1",
    sourceRevisionIds: ["revision_1"],
    sourceIds: ["source_document_1"],
    fixtureIds: [],
    provenance: "source_document",
  });

  const snapshot = await grounding.load({
    candidate,
    analysis,
    deal,
    signal: new AbortController().signal,
  });

  assert.deepEqual(snapshot.xtraceLineage, {
    memoryIds: ["memory_1"],
    sourceRevisionIds: ["revision_1"],
    sourceIds: ["source_document_1"],
    fixtureIds: [],
    capturedAt: "2026-07-29T12:00:00.000Z",
  });
});

test("current candidate grounding resolves exact XTrace children against the active parent set", async () => {
  let resolvedInput: {
    memoryId: string;
    workspaceId: string;
    dealId: string;
    activeParentFingerprint: string;
  } | undefined;
  const { grounding, deal } = await groundingFor({
    memoryId: "memory_1",
    workspaceId: "workspace_1",
    dealId: "deal_1",
    sourceRevisionIds: ["revision_1"],
    sourceIds: ["source_document_1"],
    fixtureIds: [],
    provenance: "source_document",
  }, "source_document_1", {
    exact: true,
    onExactResolve(input) {
      resolvedInput = input;
    },
  });

  const snapshot = await grounding.load({
    candidate,
    analysis,
    deal,
    signal: new AbortController().signal,
  });

  assert.deepEqual(resolvedInput, {
    memoryId: "memory_1",
    workspaceId: "workspace_1",
    dealId: "deal_1",
    activeParentFingerprint: deal.activeSourceRevisionFingerprint,
  });
  assert.deepEqual(snapshot.xtraceLineage.sourceRevisionIds, ["revision_1"]);
  assert.deepEqual(snapshot.xtraceLineage.parentBindings, [{
    kind: "source",
    memoryId: "memory_1",
    sourceRevisionId: "revision_1",
    sourceId: "source_document_1",
    fixtureId: null,
  }]);
});

test("exact Sample decision children retain fixture lineage without impersonating a source document", async () => {
  const { grounding, deal } = await groundingFor({
    memoryId: "memory_1",
    workspaceId: "workspace_1",
    dealId: "deal_1",
    sourceRevisionIds: ["revision_1"],
    sourceIds: [],
    fixtureIds: ["fixture_1"],
    provenance: "demo_fixture",
  }, "source_fixture_1", {
    revisionSourceId: "source_fixture_1",
    exact: true,
  });

  const snapshot = await grounding.load({
    candidate,
    analysis,
    deal,
    signal: new AbortController().signal,
  });

  assert.deepEqual(snapshot.xtraceLineage, {
    memoryIds: ["memory_1"],
    sourceRevisionIds: ["revision_1"],
    sourceIds: [],
    fixtureIds: ["fixture_1"],
    parentBindings: [{
      kind: "fixture",
      memoryId: "memory_1",
      sourceRevisionId: "revision_1",
      sourceId: null,
      fixtureId: "fixture_1",
    }],
    capturedAt: "2026-07-29T12:00:00.000Z",
  });
});

test("exact Sample decision children fail closed when fixture identity drifts from the immutable parent", async () => {
  const { grounding, deal } = await groundingFor({
    memoryId: "memory_1",
    workspaceId: "workspace_1",
    dealId: "deal_1",
    sourceRevisionIds: ["revision_1"],
    sourceIds: [],
    fixtureIds: ["fixture_foreign"],
    provenance: "demo_fixture",
  }, "source_fixture_1", {
    revisionSourceId: "source_fixture_1",
    exact: true,
  });

  await assert.rejects(grounding.load({
    candidate,
    analysis,
    deal,
    signal: new AbortController().signal,
  }), (error: unknown) => {
    assert.equal(
      "reasonCodes" in (error as object)
        && (error as { reasonCodes: string[] }).reasonCodes.includes(
          "XTRACE_FIXTURE_LINEAGE_MISMATCH",
        ),
      true,
    );
    return true;
  });
});

test("candidate grounding rejects a canonical source/revision tuple mismatch", async () => {
  const { grounding, deal } = await groundingFor({
    memoryId: "memory_1",
    workspaceId: "workspace_1",
    dealId: "deal_1",
    sourceRevisionIds: ["revision_1"],
    sourceIds: ["source_document_1"],
    fixtureIds: [],
    provenance: "source_document",
  }, "source_foreign");

  await assert.rejects(grounding.load({
    candidate,
    analysis,
    deal,
    signal: new AbortController().signal,
  }), (error: unknown) => {
    assert.equal(
      "reasonCodes" in (error as object)
        && (error as { reasonCodes: string[] }).reasonCodes.includes(
          "SOURCE_EVIDENCE_LINEAGE_MISMATCH",
        ),
      true,
    );
    return true;
  });
});

test("legacy empty-revision lineage may still resolve sourceIds as evidence IDs", async () => {
  const { grounding, deal } = await groundingFor({
    memoryId: "memory_1",
    workspaceId: "workspace_1",
    dealId: "deal_1",
    sourceRevisionIds: [],
    sourceIds: ["evidence_1"],
    fixtureIds: [],
    provenance: "source_document",
  });

  const snapshot = await grounding.load({
    candidate,
    analysis,
    deal,
    signal: new AbortController().signal,
  });

  assert.deepEqual(snapshot.xtraceLineage.sourceRevisionIds, ["revision_1"]);
  assert.deepEqual(snapshot.xtraceLineage.sourceIds, ["source_document_1"]);
});

test("explicit revision lineage never reinterprets sourceIds as evidence IDs", async () => {
  const { grounding, deal } = await groundingFor({
    memoryId: "memory_1",
    workspaceId: "workspace_1",
    dealId: "deal_1",
    sourceRevisionIds: ["revision_1"],
    sourceIds: ["evidence_1"],
    fixtureIds: [],
    provenance: "source_document",
  });

  await assert.rejects(grounding.load({
    candidate,
    analysis,
    deal,
    signal: new AbortController().signal,
  }), (error: unknown) => {
    assert.equal(
      "reasonCodes" in (error as object)
        && (error as { reasonCodes: string[] }).reasonCodes.includes(
          "XTRACE_SOURCE_LINEAGE_MISMATCH",
        ),
      true,
    );
    return true;
  });
});
