import assert from "node:assert/strict";
import test from "node:test";

import {
  PublicEvidenceMemoryPayloadSchema,
  ResearchCandidateDispositionMemoryPairSchema,
  ResearchCandidateSchema,
  ResearchDispositionMemoryPayloadSchema,
  ResearchDispositionSchema,
  ResearchEvidenceGapSchema,
  SAMPLE_RESEARCH_SCREENING_RECORD_LABEL,
} from "../../lib/contracts/research-candidate";

const FINGERPRINT = `sha256:${"a".repeat(64)}`;

const workflowEligibility = {
  deal: true,
  xtrace: true,
  matching: true,
  companyAnalysis: true,
  deepUnderwritingAdmissionPolicy: {
    requiredOutcome: "belief_revised",
    allowedConfidence: ["medium", "high"],
    scoreThreshold: "configured_threshold_met",
    hardGates: "all_passed",
    lineage: "complete",
    failureState: "none",
    researchDispositionAffectsAdmission: false,
    admissionMode: "all_qualifying_deals",
    orderingRole: "priority_only",
  },
} as const;

const actionDelta = {
  classification: "research_only",
  nextStep: "continue_monitoring",
  summary: "Retain the company in research memory while stronger evidence is gathered.",
  createsFormalWorkflowArtifact: false,
} as const;

function candidate(): Record<string, unknown> {
  return {
    schemaVersion: "research-candidate-v1",
    id: "candidate_centralize_v1",
    workspaceId: "workspace_demo",
    companyId: "company_centralize_v1",
    stableDealId: "deal_centralize_v1",
    dealStatus: "screening",
    analysisEligible: true,
    entityKeys: ["centralize"],
    identityStatus: "resolved",
    disposition: "qualified_not_selected",
    qualificationRationale:
      "A dated financing event and exact company identity sources meet the research-screening bar.",
    notSelectedReason:
      "The evidence does not create as strong or distinct an action delta as the selected cases.",
    missingEvidence: ["Independent proof of production use."],
    counterevidenceAndLimits: [
      "The reported amount is a round amount and is not treated as total funding.",
    ],
    invalidatingEvidence: [
      "Independent evidence that the announced financing did not close.",
    ],
    upgradingEvidence: [
      "Independent production-customer evidence with measurable adoption.",
    ],
    reconsiderationConditions: [
      "Reconsider if independent production use creates a distinct action delta.",
    ],
    actionDelta,
    workflowEligibility,
    sampleResearchScreeningRecordId:
      "sample_research_screening_centralize_v1",
    evidenceContext: {
      mode: "pinned",
      scope: "research_only",
      formalReportEligible: false,
      researchSnapshotVersion: "research-evidence-snapshot-v1",
      snapshotId: "belief_reversal_research_2026_08_03_v1",
      snapshotAsOfDate: "2026-08-03",
      snapshotFingerprint: FINGERPRINT,
      anchorAt: "2026-08-03T13:34:43.000Z",
      windowStartAt: "2026-07-20T13:34:43.000Z",
      windowEndAt: "2026-08-03T13:34:43.000Z",
      windowTimezone: "America/Los_Angeles",
      displayLabel: "Demo evidence snapshot as of 2026-08-03",
    },
  };
}

function publicEvidence(): Record<string, unknown> {
  return {
    schemaVersion: "research-public-evidence-memory-v1",
    memoryKind: "public_evidence",
    workspaceId: "workspace_demo",
    candidateId: "candidate_centralize_v1",
    companyId: "company_centralize_v1",
    stableDealId: "deal_centralize_v1",
    entityKeys: ["centralize"],
    evidenceContext: {
      mode: "pinned",
      scope: "research_only",
      formalReportEligible: false,
      researchSnapshotVersion: "research-evidence-snapshot-v1",
      snapshotId: "belief_reversal_research_2026_08_03_v1",
      snapshotAsOfDate: "2026-08-03",
      snapshotFingerprint: FINGERPRINT,
      anchorAt: "2026-08-03T13:34:43.000Z",
      windowStartAt: "2026-07-20T13:34:43.000Z",
      windowEndAt: "2026-08-03T13:34:43.000Z",
      windowTimezone: "America/Los_Angeles",
      displayLabel: "Demo evidence snapshot as of 2026-08-03",
    },
    source: {
      sourceId: "source_centralize_axios_v1",
      sourceRevisionId: "revision_source_centralize_axios_v1",
      contentFingerprint: FINGERPRINT,
      title: "Axios Pro Rata",
      publisher: "Axios",
      canonicalUrl:
        "https://www.axios.com/newsletters/axios-pro-rata-160af1b9-9b3f-4cab-81e1-43f5984bbccb",
      sourceClass: "funding_publication",
      sourceAuthority: "secondary",
      evidenceRole: "trigger",
      entityKeys: ["centralize"],
      eventAt: "2026-07-29",
      publishedAt: "2026-07-29",
      publicationTimestamp: null,
      retrievedAt: "2026-08-01",
      locator: "Funding item",
      verbatimExcerpt: "Centralize raised $19 million, NEA led",
      normalizedStatement:
        "Axios reports that Centralize raised $19 million with NEA leading.",
    },
  };
}

function dispositionMemory(): Record<string, unknown> {
  const shared = structuredClone(candidate());
  const candidateId = shared.id;
  const id = shared.sampleResearchScreeningRecordId;
  delete shared.schemaVersion;
  delete shared.id;
  delete shared.identityStatus;
  delete shared.sampleResearchScreeningRecordId;
  return {
    schemaVersion: "research-disposition-memory-v1",
    memoryKind: "research_disposition",
    id,
    candidateId,
    provenance: "synthetic_research_record",
    recordKind: "research_screening_disposition",
    meetingOccurred: false,
    vcInteraction: false,
    label: SAMPLE_RESEARCH_SCREENING_RECORD_LABEL,
    recordedAt: "2026-08-03T13:34:43.000Z",
    ...shared,
  };
}

function evidenceGap(): Record<string, unknown> {
  return {
    schemaVersion: "research-evidence-gap-v1",
    id: "source_chipagents_reuters_gap_v1",
    workspaceId: "workspace_demo",
    candidateId: "candidate_chipagents_v1",
    companyId: "company_chipagents_v1",
    stableDealId: "deal_chipagents_v1",
    entityKeys: ["chipagents"],
    status: "unresolved",
    title: "Nvidia partner ChipAgents raises $60 million",
    publisher: "Reuters",
    surfacedUrl:
      "https://www.reuters.com/business/nvidia-partner-chipagents-raises-60-million-accelerate-chip-design-with-ai-2026-07-29",
    retrievedAt: "2026-08-01",
    reason: "The surfaced page was unavailable, so it is not used as evidence.",
    memoryEligible: false,
  };
}

test("research dispositions use a screening taxonomy and never a Deal status", () => {
  assert.deepEqual(
    ["selected", "qualified_not_selected", "insufficient_evidence", "rejected"]
      .map((value) => ResearchDispositionSchema.parse(value)),
    ["selected", "qualified_not_selected", "insufficient_evidence", "rejected"],
  );
  assert.equal(ResearchDispositionSchema.safeParse("passed").success, false);
  assert.equal(ResearchDispositionSchema.safeParse("watchlist").success, false);
  assert.equal(ResearchDispositionSchema.safeParse("invested").success, false);
});

test("a qualified screening Deal enters analysis and uses evidence quality—not research disposition—for underwriting admission", () => {
  const parsed = ResearchCandidateSchema.parse(candidate());
  assert.equal(parsed.disposition, "qualified_not_selected");
  assert.equal(parsed.stableDealId, "deal_centralize_v1");
  assert.equal(parsed.dealStatus, "screening");
  assert.equal(parsed.analysisEligible, true);
  assert.deepEqual(parsed.workflowEligibility, workflowEligibility);
  assert.equal("ranking" in parsed.workflowEligibility, false);
  assert.equal("formalSelectionCondition" in parsed.workflowEligibility, false);

  for (const forbidden of [
    ["dealId", "deal_centralize_v1"],
    ["status", "passed"],
    ["formalDecision", { recommendation: "invest" }],
    ["rank", 1],
    ["actionDraft", { body: "Send this" }],
  ] as const) {
    assert.equal(ResearchCandidateSchema.safeParse({
      ...candidate(),
      [forbidden[0]]: forbidden[1],
    }).success, false, String(forbidden[0]));
  }

  const eligible = structuredClone(candidate());
  (eligible.workflowEligibility as Record<string, unknown>).ranking = true;
  assert.equal(ResearchCandidateSchema.safeParse(eligible).success, false);

  const dispositionGate = structuredClone(candidate());
  const policy = (
    dispositionGate.workflowEligibility as Record<string, unknown>
  ).deepUnderwritingAdmissionPolicy as Record<string, unknown>;
  policy.researchDispositionAffectsAdmission = true;
  assert.equal(ResearchCandidateSchema.safeParse(dispositionGate).success, false);

  const passed = structuredClone(candidate());
  passed.dealStatus = "passed";
  assert.equal(ResearchCandidateSchema.safeParse(passed).success, false);

  const missingDeal = structuredClone(candidate());
  delete missingDeal.stableDealId;
  assert.equal(ResearchCandidateSchema.safeParse(missingDeal).success, false);
});

test("public facts and synthetic research dispositions are disjoint memory payloads", () => {
  const publicPayload = PublicEvidenceMemoryPayloadSchema.parse(publicEvidence());
  const dispositionPayload = ResearchDispositionMemoryPayloadSchema.parse(
    dispositionMemory(),
  );
  assert.equal(publicPayload.memoryKind, "public_evidence");
  assert.equal(dispositionPayload.memoryKind, "research_disposition");
  assert.equal(dispositionPayload.provenance, "synthetic_research_record");
  assert.equal(dispositionPayload.meetingOccurred, false);
  assert.equal(dispositionPayload.vcInteraction, false);

  assert.equal(PublicEvidenceMemoryPayloadSchema.safeParse({
    ...publicEvidence(),
    disposition: "qualified_not_selected",
  }).success, false);
  assert.equal(ResearchDispositionMemoryPayloadSchema.safeParse({
    ...dispositionMemory(),
    source: (publicEvidence().source as Record<string, unknown>),
  }).success, false);
});

test("research memory cannot be relabeled as formal pinned-report evidence", () => {
  const payload = publicEvidence();
  (payload.evidenceContext as Record<string, unknown>).scope = "formal_report";
  assert.equal(PublicEvidenceMemoryPayloadSchema.safeParse(payload).success, false);

  const promoted = candidate();
  (promoted.evidenceContext as Record<string, unknown>).formalReportEligible = true;
  assert.equal(ResearchCandidateSchema.safeParse(promoted).success, false);
});

test("research trigger timestamps include the exact rolling-window boundary but exclude one millisecond earlier", () => {
  const boundary = publicEvidence();
  const boundarySource = boundary.source as Record<string, unknown>;
  boundarySource.eventAt = "2026-07-20";
  boundarySource.publishedAt = "2026-07-20";
  boundarySource.publicationTimestamp = "2026-07-20T13:34:43.000Z";
  assert.equal(PublicEvidenceMemoryPayloadSchema.safeParse(boundary).success, true);

  const tooEarly = structuredClone(boundary);
  (tooEarly.source as Record<string, unknown>).publicationTimestamp =
    "2026-07-20T13:34:42.999Z";
  assert.equal(PublicEvidenceMemoryPayloadSchema.safeParse(tooEarly).success, false);
});

test("normalized screening text cannot replace or masquerade as a verbatim excerpt", () => {
  const missingVerbatim = publicEvidence();
  delete (missingVerbatim.source as Record<string, unknown>).verbatimExcerpt;
  assert.equal(
    PublicEvidenceMemoryPayloadSchema.safeParse(missingVerbatim).success,
    false,
  );

  const masquerading = publicEvidence();
  const source = masquerading.source as Record<string, unknown>;
  source.verbatimExcerpt = source.normalizedStatement;
  assert.equal(
    PublicEvidenceMemoryPayloadSchema.safeParse(masquerading).success,
    false,
  );
});

test("synthetic screening memory requires its permanent label and one-to-one candidate identity", () => {
  const missingLabel = dispositionMemory();
  delete missingLabel.label;
  assert.equal(
    ResearchDispositionMemoryPayloadSchema.safeParse(missingLabel).success,
    false,
  );
  assert.equal(ResearchDispositionMemoryPayloadSchema.safeParse({
    ...dispositionMemory(),
    label: "Research screening record",
  }).success, false);
  for (const forbidden of [
    ["provenance", "demo_fixture"],
    ["recordKind", "vc_meeting"],
    ["meetingOccurred", true],
    ["vcInteraction", true],
  ] as const) {
    assert.equal(ResearchDispositionMemoryPayloadSchema.safeParse({
      ...dispositionMemory(),
      [forbidden[0]]: forbidden[1],
    }).success, false, String(forbidden[0]));
  }

  assert.equal(ResearchCandidateDispositionMemoryPairSchema.safeParse({
    candidate: candidate(),
    dispositionMemory: dispositionMemory(),
  }).success, true);
  assert.equal(ResearchCandidateDispositionMemoryPairSchema.safeParse({
    candidate: candidate(),
    dispositionMemory: {
      ...dispositionMemory(),
      candidateId: "candidate_other_v1",
    },
  }).success, false);
});

test("entity keys must already be unique, normalized, and canonically sorted", () => {
  for (const entityKeys of [
    ["partner", "centralize"],
    ["centralize", "centralize"],
    ["Centralize"],
  ]) {
    assert.equal(ResearchCandidateSchema.safeParse({
      ...candidate(),
      entityKeys,
    }).success, false);
    assert.equal(PublicEvidenceMemoryPayloadSchema.safeParse({
      ...publicEvidence(),
      entityKeys,
    }).success, false);
  }
});

test("an unresolved research gap cannot claim a Source Revision or XTrace memory", () => {
  assert.equal(ResearchEvidenceGapSchema.safeParse(evidenceGap()).success, true);
  assert.equal(ResearchEvidenceGapSchema.safeParse({
    ...evidenceGap(),
    sourceRevisionId: "revision_reuters_v1",
  }).success, false);
  assert.equal(ResearchEvidenceGapSchema.safeParse({
    ...evidenceGap(),
    memoryEligible: true,
  }).success, false);
});
