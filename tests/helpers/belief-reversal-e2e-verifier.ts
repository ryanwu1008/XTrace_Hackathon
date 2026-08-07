import { z } from "zod";
import { isDeepStrictEqual } from "node:util";

import type { CandidateArtifactBundle } from "../../db/repositories/underwriting-artifacts";
import type { SourceRevision } from "../../db/repositories/source-registry";
import { loadBeliefReversalManifest } from "../../lib/belief-reversal/manifest";
import {
  ActionDraftV2Schema,
} from "../../lib/contracts/underwriting";
import {
  BeliefActionSchema,
  CanonicalDealStatusSchema,
  CompanyAnalysisSchema,
  EvidenceSourceRefSchema,
  type BeliefChangeDirection,
  type CompanyAnalysis,
  type DealStatus,
} from "../../lib/contracts/domain";
import { SourceRevisionSchema } from "../../lib/contracts/evidence";
import {
  FinalizedChatSuccessResponseSchema,
  FinalizedChatTopicSchema,
  type FinalizedChatSuccessResponse,
  type FinalizedChatTopic,
} from "../../lib/contracts/finalized-chat";
import { CurrentReportEvidenceContextV1Schema } from "../../lib/contracts/evidence-context";
import {
  actionsForDealStatusAndDirection,
  beliefActionListsEqual,
} from "../../lib/reports/action-policy";
import { buildFinalizedChatProjection } from "../../lib/chat/finalized-projection";
import { renderFinalizedChatProjection } from "../../lib/chat/finalized-renderer";
import {
  toCandidateUnderwritingDetail,
  toPublicActionDraft,
} from "../../lib/underwriting/read-model";
import type {
  CurrentColdExpectedOutcomes,
} from "./belief-reversal-e2e-pipeline";

const FingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const IdSchema = z.string().trim().min(1);
const reviewedEvidenceWindow = loadBeliefReversalManifest().evidenceWindow;
const REVIEWED_PINNED_EVIDENCE_WINDOW = Object.freeze({
  anchorAt: new Date(reviewedEvidenceWindow.endAt).toISOString(),
  windowStartAt: new Date(reviewedEvidenceWindow.startAt).toISOString(),
  windowEndAt: new Date(reviewedEvidenceWindow.endAt).toISOString(),
  windowTimezone: reviewedEvidenceWindow.timezone,
  displayLabel: reviewedEvidenceWindow.displayLabel,
});

const RankingRowSchema = z.strictObject({
  rank: z.number().int().min(1).max(4),
  dealId: IdSchema,
  companyName: IdSchema,
  dealStatus: z.enum(["passed", "watchlist", "invested"]),
  direction: z.enum(["positive", "negative"]),
  score: z.number().min(0).max(1),
  confidence: z.enum(["medium", "high"]),
  allGatesPassed: z.literal(true),
});

const REVIEWED_CASES = {
  deal_henry_ai_v1: {
    companyName: "Henry AI",
    dealStatus: "passed",
    direction: "positive",
  },
  deal_smallest_ai_v1: {
    companyName: "Smallest.ai",
    dealStatus: "watchlist",
    direction: "positive",
  },
  deal_hush_security_v1: {
    companyName: "Hush Security",
    dealStatus: "invested",
    direction: "positive",
  },
  deal_irregular_v1: {
    companyName: "Irregular",
    dealStatus: "invested",
    direction: "negative",
  },
} as const;

const RESEARCH_ACTION_CROSSWALK = {
  validate_channel_economics: {
    dealId: "deal_hush_security_v1",
    canonicalBeliefActionKinds: ["evaluate_follow_on"],
    authoritativeUnknown: {
      label:
        "Akamai and Kyndryl channel bookings, margins, and sell-through remain unavailable.",
      externalLabel: "Current partner bookings, margins, and sell-through",
    },
    requiredDraftFormat: "diligence_request",
  },
} as const;

const ExpectedCountsSchema = z.strictObject({
  companies: z.literal(23),
  deals: z.literal(23),
  sourceDocuments: z.literal(55),
  sourceRevisions: z.literal(55),
  workspaceDocuments: z.literal(54),
  activeAssignments: z.literal(60),
  legacyEvidenceItems: z.literal(19),
  canonicalEvidenceItems: z.literal(37),
  sampleInteractions: z.literal(23),
  originalReadyInputs: z.literal(13),
  originalExpectedInputs: z.literal(13),
  qualifiedNotSelectedPresent: z.literal(0),
});

const RequiredTopicsSchema = z.array(FinalizedChatTopicSchema).length(8)
  .superRefine((topics, context) => {
    if (
      new Set(topics).size !== FinalizedChatTopicSchema.options.length
      || FinalizedChatTopicSchema.options.some((topic) => !topics.includes(topic))
    ) {
      context.addIssue({
        code: "custom",
        message: "QA Chat proof must cover every finalized Chat topic exactly once.",
      });
    }
  });

export const BeliefReversalQaRecordSchema = z.strictObject({
  schemaVersion: z.literal("belief-reversal-e2e-qa-v2"),
  recordedAt: z.string().datetime({ offset: true }),
  commitSha: z.string().regex(/^[0-9a-f]{7,40}$/u),
  infrastructure: z.strictObject({
    postgresImage: z.literal("postgres:17.6"),
    postgrestImage: z.literal("postgrest/postgrest:v12.2.3"),
    postgresHost: z.literal("127.0.0.1"),
    postgrestHost: z.literal("127.0.0.1"),
    postgresPort: z.number().int().min(1).max(65_535),
    postgrestPort: z.number().int().min(1).max(65_535),
    databaseName: z.string().regex(
      /^vsee_[a-z0-9_]{1,37}_[0-9a-f]{16}$/u,
    ).max(63),
    terminalMigration: z.string().regex(/^\d{4}_[a-z0-9][a-z0-9_]*$/u),
    migrationCount: z.number().int().positive(),
  }),
  counts: ExpectedCountsSchema,
  ranking: z.array(RankingRowSchema).length(4),
  terminalStates: z.array(z.strictObject({
    candidateRunId: IdSchema,
    status: z.enum(["completed", "partial"]),
    artifactState: z.literal("finalized"),
  })).length(4),
  replay: z.strictObject({
    snapshotIdentityEqual: z.literal(true),
    snapshotIdEqual: z.literal(true),
    snapshotFingerprintEqual: z.literal(true),
    contextFingerprintEqual: z.literal(true),
    eventSetFingerprintEqual: z.literal(true),
    bindingFingerprintDistinct: z.literal(true),
    scoreConfidenceGateActionRankEqual: z.literal(true),
    semanticOutcomeEqual: z.literal(true),
    newReasonerJudgments: z.literal(0),
    newXtraceMemories: z.literal(0),
    newXtraceLinks: z.literal(0),
    newSourceRevisions: z.literal(0),
    newSampleInteractions: z.literal(0),
  }),
  reports: z.strictObject({
    reportId: IdSchema,
    runId: z.string().uuid(),
    evidenceMode: z.literal("pinned"),
    snapshotId: z.literal("belief_reversal_2026_08_01"),
    snapshotFingerprint: FingerprintSchema,
    verifiedDealCount: z.literal(4),
    allSourcesResolved: z.literal(true),
  }),
  chat: z.strictObject({
    topics: RequiredTopicsSchema,
    hushInvestedActionVerified: z.literal(true),
    hushResearchActionCrosswalkVerified: z.literal(true),
    irregularInvestedActionVerified: z.literal(true),
    sameReportRunScope: z.literal(true),
    isolationCountersUnchanged: z.literal(true),
  }),
  productionIsolation: z.strictObject({
    nodeEnvironment: z.enum(["test", "development"]),
    loopbackOnly: z.literal(true),
    remoteCalls: z.literal(0),
    productionWrites: z.literal(0),
    productionCredentialsRead: z.literal(0),
  }),
  exitCode: z.literal(0),
}).superRefine((record, context) => {
  const ranked = [...record.ranking].sort((left, right) => left.rank - right.rank);
  if (
    new Set(ranked.map(({ rank }) => rank)).size !== 4
    || ranked.some(({ rank }, index) => rank !== index + 1)
  ) {
    context.addIssue({
      code: "custom",
      path: ["ranking"],
      message: "QA ranking must contain unique contiguous ranks 1 through 4.",
    });
  }
  if (new Set(ranked.map(({ dealId }) => dealId)).size !== 4) {
    context.addIssue({
      code: "custom",
      path: ["ranking"],
      message: "QA ranking must cover the exact four reviewed belief-reversal cases.",
    });
  }
  for (const row of ranked) {
    const expected = REVIEWED_CASES[row.dealId as keyof typeof REVIEWED_CASES];
    if (
      expected === undefined
      || row.companyName !== expected.companyName
      || row.dealStatus !== expected.dealStatus
      || row.direction !== expected.direction
    ) {
      context.addIssue({
        code: "custom",
        path: ["ranking"],
        message: "QA ranking must cover the exact four reviewed belief-reversal cases.",
      });
      break;
    }
  }
  for (let index = 1; index < ranked.length; index += 1) {
    const previous = ranked[index - 1]!;
    const current = ranked[index]!;
    const scoreOrderIsValid = previous.score > current.score
      || (
        previous.score === current.score
        && Buffer.compare(
            Buffer.from(previous.dealId, "utf8"),
            Buffer.from(current.dealId, "utf8"),
          ) <= 0
      );
    if (!scoreOrderIsValid) {
      context.addIssue({
        code: "custom",
        path: ["ranking"],
        message: "QA ranking must be derived from score with UTF-8 Deal-ID ties.",
      });
      break;
    }
  }
  if (
    new Set(record.terminalStates.map(({ candidateRunId }) => candidateRunId))
      .size !== 4
  ) {
    context.addIssue({
      code: "custom",
      path: ["terminalStates"],
      message: "QA terminal candidate identities must be unique.",
    });
  }
});

export type BeliefReversalQaRecord = z.infer<
  typeof BeliefReversalQaRecordSchema
>;

export function renderBeliefReversalQaRecord(input: unknown): string {
  return `${JSON.stringify(BeliefReversalQaRecordSchema.parse(input), null, 2)}\n`;
}

export const FINALIZED_CHAT_E2E_QUERIES = [{
  topic: "prior_reason",
  dealId: "deal_henry_ai_v1",
  question: "Why did we originally pass on Henry AI?",
}, {
  topic: "belief_change",
  dealId: "deal_henry_ai_v1",
  question: "Which new evidence changed the belief for Henry AI?",
}, {
  topic: "strongest_counterargument",
  dealId: "deal_irregular_v1",
  question: "What is the strongest counterargument for Irregular?",
}, {
  topic: "match_confidence",
  dealId: "deal_smallest_ai_v1",
  question: "Why is the match confidence medium or high for Smallest.ai?",
}, {
  topic: "framework_disagreement",
  dealId: "deal_hush_security_v1",
  question: "Where do the investor frameworks disagree for Hush Security?",
}, {
  topic: "valuation",
  dealId: "deal_irregular_v1",
  question: "What is the valuation for Irregular?",
}, {
  topic: "missing_evidence",
  dealId: "deal_hush_security_v1",
  question: "What evidence is still missing for Hush Security?",
}, {
  topic: "invested_action",
  dealId: "deal_hush_security_v1",
  question: "What should we do for this invested company, Hush Security?",
}, {
  topic: "invested_action",
  dealId: "deal_irregular_v1",
  question: "What should we do for this invested company, Irregular?",
}] as const satisfies readonly {
  topic: FinalizedChatTopic;
  dealId: keyof typeof REVIEWED_CASES;
  question: string;
}[];

export const BeliefReversalIsolationCountersSchema = z.strictObject({
  liveMarketCalls: z.number().int().nonnegative(),
  xtrace: z.strictObject({
    ingestCalls: z.number().int().nonnegative(),
    searchCalls: z.number().int().nonnegative(),
    deleteCalls: z.number().int().nonnegative(),
    exactParentCount: z.number().int().nonnegative(),
    memoryCount: z.number().int().nonnegative(),
  }),
  model: z.strictObject({
    matchingCalls: z.number().int().nonnegative(),
    frameworkCalls: z.number().int().nonnegative(),
    unexpectedCalls: z.number().int().nonnegative(),
  }),
  durable: z.strictObject({
    scanRuns: z.number().int().nonnegative(),
    scanRunSteps: z.number().int().nonnegative(),
    sourceRevisions: z.number().int().nonnegative(),
    sampleInteractions: z.number().int().nonnegative(),
    reasonerJudgments: z.number().int().nonnegative(),
    xtraceIngestIntents: z.number().int().nonnegative(),
    xtraceMemoryLinks: z.number().int().nonnegative(),
  }),
  route: z.strictObject({
    rateLimitCalls: z.number().int().nonnegative(),
    rateLimitDbRequests: z.number().int().nonnegative(),
    remoteNetworkAttempts: z.number().int().nonnegative(),
  }),
});
export type BeliefReversalIsolationCounters = z.infer<
  typeof BeliefReversalIsolationCountersSchema
>;

type MaybePromise<T> = T | Promise<T>;

export interface BeliefReversalReportsAndChatVerifierInput {
  workspaceId: string;
  reportId: string;
  runId: string;
  readReport(): Promise<unknown>;
  readUnderwritingDetail(input: {
    workspaceId: string;
    reportId: string;
    runId: string;
    dealId: string;
  }): Promise<unknown>;
  readArtifact(input: {
    workspaceId: string;
    candidateRunId: string;
  }): Promise<CandidateArtifactBundle | null>;
  readActionDrafts(input: {
    workspaceId: string;
    candidateRunId: string;
  }): Promise<unknown>;
  resolveSourceRevision(input: {
    workspaceId: string;
    sourceRevisionId: string;
  }): Promise<SourceRevision | null>;
  askFinalizedChat(input: {
    question: string;
    reportId: string;
    runId: string;
    dealId: string;
  }): Promise<unknown>;
  readIsolationCounters(): MaybePromise<BeliefReversalIsolationCounters>;
}

export interface BeliefReversalReportsAndChatVerification {
  ranking: Array<{
    dealId: keyof typeof REVIEWED_CASES;
    companyName: string;
    rank: number;
    score: number;
    confidence: "medium" | "high";
  }>;
  resolvedSourceRevisionIds: string[];
  chatTopics: FinalizedChatTopic[];
  chatQueryCount: number;
  hushInvestedActionVerified: true;
  hushResearchActionCrosswalkVerified: true;
  irregularInvestedActionVerified: true;
  isolationCountersUnchanged: true;
}

const SelectedAnalysisSchema = z.object({
  id: IdSchema,
  reportId: IdSchema,
  runId: z.string().uuid(),
  dealId: IdSchema,
  companyName: IdSchema,
  dealStatus: z.enum(["passed", "watchlist", "invested"]),
  outcome: z.literal("belief_revised"),
  confidence: z.enum(["medium", "high"]),
  score: z.number().min(0).max(1),
  investmentMemory: z.object({
    lastEvaluatedAt: z.string().datetime({ offset: true }),
    sourceIds: z.array(IdSchema).min(1),
    fixtureIds: z.array(IdSchema).length(1),
    priorActions: z.array(BeliefActionSchema).min(1),
  }),
  marketEvidence: z.object({
    eventIds: z.array(IdSchema).min(1),
    events: z.array(z.unknown()).min(1),
    sourceIds: z.array(IdSchema).min(1),
  }),
  beliefAssessment: z.object({
    schemaVersion: z.literal("belief-change-assessment-v1"),
    dealStatus: z.enum(["passed", "watchlist", "invested"]),
    direction: z.enum(["positive", "negative"]),
    scoreBreakdown: z.object({
      finalScore: z.number().min(0).max(1),
      confidence: z.enum(["medium", "high"]),
    }),
    gateContext: z.object({
      priorInteraction: z.object({
        id: IdSchema,
        occurredAt: z.string().datetime({ offset: true }),
        sourceIds: z.array(IdSchema).length(1),
        provenance: z.literal("demo_fixture"),
        label: z.literal("Sample decision record"),
      }),
      triggerEvent: z.object({
        id: IdSchema,
        eventAt: IdSchema,
        sourceIds: z.array(IdSchema).min(1),
      }),
      sources: z.array(z.unknown()).min(2),
    }),
    gates: z.object({
      chronology: z.object({
        priorInteractionId: IdSchema,
        priorInteractionAt: z.string().datetime({ offset: true }),
        triggerEventId: IdSchema,
        triggerEventAt: IdSchema,
        passed: z.literal(true),
        failureReason: z.null(),
      }),
      revisitConditionMapping: z.object({
        priorInteractionId: IdSchema,
        revisitConditionIndex: z.number().int().nonnegative(),
        revisitConditionText: IdSchema,
        triggerEventId: IdSchema,
        citedSourceIds: z.array(IdSchema).min(1),
        passed: z.literal(true),
        failureReason: z.null(),
      }),
      counterevidence: z.object({
        statement: IdSchema,
        citedSourceIds: z.array(IdSchema).min(1),
        passed: z.literal(true),
        failureReason: z.null(),
      }),
      actionDelta: z.object({
        priorActions: z.array(BeliefActionSchema).min(1),
        proposedActions: z.array(BeliefActionSchema).min(1),
        passed: z.literal(true),
        failureReason: z.null(),
      }),
      allPassed: z.literal(true),
    }),
    actions: z.array(BeliefActionSchema).min(1),
  }),
  companyBrief: z.object({
    decisionHistory: z.array(z.object({
      title: z.literal("Sample decision record"),
      sourceIds: z.array(IdSchema).length(1),
    })).length(1),
    structuredFields: z.array(z.unknown()).min(1),
  }),
  sources: z.array(z.unknown()).min(3),
});

type SelectedAnalysis = CompanyAnalysis & z.infer<typeof SelectedAnalysisSchema>;

const UnderwritingStatusCountsSchema = z.strictObject({
  queued: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  partial: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

const UnderwritingQueueRowSchema = z.strictObject({
  batchId: IdSchema,
  dealId: IdSchema,
  priorityRank: z.number().int().positive(),
  status: z.enum(["queued", "running", "completed", "partial", "failed"]),
  candidateRunId: IdSchema,
  reason: IdSchema.optional(),
  decision: z.enum(["Pass", "Watch", "Advance", "Invest Candidate"]).nullable(),
});

const LegacyPinnedPriorityOrderSchema = z.strictObject({
  adapter: z.literal("legacy-pinned-priority-order-v1"),
  snapshotId: z.literal("belief_reversal_2026_08_01"),
  entries: z.array(z.strictObject({
    batchId: IdSchema,
    dealId: IdSchema,
    historicalPriorityOrder: z.number().int().positive().nullable(),
    historicalAdmissionStatus: z.enum([
      "historically_admitted",
      "historically_not_admitted",
    ]),
    historicalReason: IdSchema,
  })).length(23),
});

const ReportSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  runId: z.string().uuid(),
  analysisStatus: z.literal("completed"),
  counts: z.object({
    companyCount: z.literal(23),
    beliefRevised: z.literal(4),
  }),
  companyAnalyses: z.array(z.unknown()).length(23),
  evidenceContext: CurrentReportEvidenceContextV1Schema,
  underwritingBatch: z.object({
    batchId: IdSchema,
    status: z.literal("completed"),
    queue: z.array(UnderwritingQueueRowSchema).length(4),
    underwritingStatusCounts: UnderwritingStatusCountsSchema,
    legacyPinnedPriorityOrder: LegacyPinnedPriorityOrderSchema,
  }),
});

const CurrentColdAnalysisSchema = z.object({
  dealId: IdSchema,
  companyName: IdSchema,
  dealStatus: CanonicalDealStatusSchema,
  outcome: z.enum([
    "belief_revised",
    "monitor",
    "no_material_change",
    "analysis_unavailable",
  ]),
  confidence: z.enum(["low", "medium", "high"]),
  score: z.number().min(0).max(1),
  currentRunAudit: z.object({
    schemaVersion: z.literal("company-analysis-current-run-audit-v1"),
    workspaceId: IdSchema,
    stableDealId: IdSchema,
    priorDealStatus: CanonicalDealStatusSchema,
    dealUniverseId: IdSchema,
    dealUniverseFingerprint: FingerprintSchema,
    evidenceContextFingerprint: FingerprintSchema,
    evidenceBindingFingerprint: FingerprintSchema,
    priorMemory: z.object({
      kind: z.enum(["investment", "screening"]),
    }),
    outcome: z.enum([
      "belief_revised",
      "monitor",
      "no_material_change",
      "analysis_unavailable",
    ]),
  }),
});

const CurrentColdReportSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  runId: z.string().uuid(),
  analysisStatus: z.literal("completed"),
  counts: z.object({
    companyCount: z.literal(30),
    beliefRevised: z.number().int().min(0).max(30),
    monitor: z.number().int().min(0).max(30),
    noMaterialChange: z.number().int().min(0).max(30),
    analysisUnavailable: z.number().int().min(0).max(30),
    eligibleDealCount: z.literal(30),
    companyAnalysisCount: z.literal(30),
    beliefRevisedCount: z.number().int().min(0).max(30),
    monitorCount: z.number().int().min(0).max(30),
    noMaterialChangeCount: z.number().int().min(0).max(30),
    analysisUnavailableCount: z.number().int().min(0).max(30),
    underwritingCandidateCount: z.number().int().min(0).max(30),
    underwritingQueuedCount: z.number().int().nonnegative(),
    underwritingRunningCount: z.number().int().nonnegative(),
    underwritingCompletedCount: z.number().int().nonnegative(),
    underwritingPartialCount: z.number().int().nonnegative(),
    underwritingFailedCount: z.number().int().nonnegative(),
  }),
  companyAnalyses: z.array(CurrentColdAnalysisSchema).length(30),
  evidenceContext: CurrentReportEvidenceContextV1Schema,
  underwritingBatch: z.object({
    batchId: IdSchema,
    status: z.literal("completed"),
    queue: z.array(UnderwritingQueueRowSchema).max(30),
    underwritingStatusCounts: UnderwritingStatusCountsSchema,
  }),
});

const CURRENT_SCREENING_DEALS = new Set([
  "deal_centralize_v1",
  "deal_chipagents_v1",
  "deal_sent_v1",
  "deal_cascade_v1",
  "deal_cordant_v1",
  "deal_empirical_security_v1",
  "deal_freight_hero_v1",
]);

export function verifyBeliefReversalCurrentColdReport(
  raw: unknown,
  expected?: CurrentColdExpectedOutcomes,
): {
  priorityOrder: Array<{ dealId: string; priorityRank: number }>;
  screeningMonitorCount: number;
  screeningNonRevisingCount: number;
} {
  const unwrapped = unwrapData(raw);
  const top = asVerifierRecord(unwrapped);
  const underwriting = asVerifierRecord(top?.underwritingBatch);
  if (underwriting && "legacyPinnedPriorityOrder" in underwriting) {
    fail("live current report exposed the legacy pinned priority adapter");
  }
  if (hasForbiddenTopFiveKey(unwrapped)) {
    fail("live current report exposed a removed Top-5 eligibility field");
  }
  if (
    !Array.isArray(top?.companyAnalyses)
    || top.companyAnalyses.length !== 30
  ) fail("current cold report must contain exactly 30 CompanyAnalyses");
  if (!Array.isArray(underwriting?.queue)) {
    fail("current cold queue must contain every and only belief revision");
  }
  const report = CurrentColdReportSchema.parse(unwrapped);
  if (
    report.evidenceContext.evidenceMode !== "live"
    || report.evidenceContext.snapshotId !== null
    || report.evidenceContext.snapshotFingerprint !== null
  ) fail("current cold report is not bound to live evidence");
  if (report.companyAnalyses.length !== 30) {
    fail("current cold report must contain exactly 30 CompanyAnalyses");
  }
  const analysisIds = new Set(report.companyAnalyses.map(({ dealId }) => dealId));
  if (analysisIds.size !== 30) fail("current cold report Deal analyses are duplicated");
  const outcomes = {
    belief_revised: report.companyAnalyses.filter(
      ({ outcome }) => outcome === "belief_revised",
    ).length,
    monitor: report.companyAnalyses.filter(({ outcome }) => outcome === "monitor")
      .length,
    no_material_change: report.companyAnalyses.filter(
      ({ outcome }) => outcome === "no_material_change",
    ).length,
    analysis_unavailable: report.companyAnalyses.filter(
      ({ outcome }) => outcome === "analysis_unavailable",
    ).length,
  };
  if (
    outcomes.belief_revised + outcomes.monitor + outcomes.no_material_change
      + outcomes.analysis_unavailable !== 30
    || report.counts.beliefRevised !== outcomes.belief_revised
    || report.counts.monitor !== outcomes.monitor
    || report.counts.noMaterialChange !== outcomes.no_material_change
    || report.counts.analysisUnavailable !== outcomes.analysis_unavailable
    || report.counts.beliefRevisedCount !== outcomes.belief_revised
    || report.counts.monitorCount !== outcomes.monitor
    || report.counts.noMaterialChangeCount !== outcomes.no_material_change
    || report.counts.analysisUnavailableCount !== outcomes.analysis_unavailable
    || report.counts.underwritingCandidateCount !== outcomes.belief_revised
  ) fail("current cold report outcome counts are not analysis-derived");
  if (expected) {
    const capable = new Set(expected.beliefRevisionCapableDealIds);
    const unexpected = report.companyAnalyses
      .filter(({ outcome, dealId }) =>
        outcome === "belief_revised" && !capable.has(dealId)
      )
      .map(({ dealId }) => dealId)
      .sort();
    if (unexpected.length > 0) {
      fail(
        `current cold report admitted belief revisions outside the reviewed case set: ${unexpected.join(",")}`,
      );
    }
  }
  const universes = new Set<string>();
  for (const analysis of report.companyAnalyses) {
    const audit = analysis.currentRunAudit;
    if (
      audit.workspaceId !== report.workspaceId
      || audit.stableDealId !== analysis.dealId
      || audit.priorDealStatus !== analysis.dealStatus
      || audit.outcome !== analysis.outcome
      || audit.evidenceContextFingerprint
        !== report.evidenceContext.contextFingerprint
      || audit.evidenceBindingFingerprint
        !== report.evidenceContext.bindingFingerprint
    ) fail(`current cold audit identity mismatch for ${analysis.dealId}`);
    universes.add(`${audit.dealUniverseId}\0${audit.dealUniverseFingerprint}`);
  }
  if (universes.size !== 1) fail("current cold report crossed Deal universes");
  const screening = report.companyAnalyses.filter(({ dealId }) =>
    CURRENT_SCREENING_DEALS.has(dealId)
  );
  if (
    screening.length !== 7
    || screening.some((analysis) =>
      analysis.dealStatus !== "screening"
      || analysis.currentRunAudit.priorMemory.kind !== "screening"
    )
  ) fail("current cold report did not preserve seven screening analyses");
  const revised = report.companyAnalyses
    .filter(({ outcome }) => outcome === "belief_revised")
    .sort((left, right) =>
      right.score - left.score || utf8Compare(left.dealId, right.dealId)
    );
  const queue = [...report.underwritingBatch.queue].sort(
    (left, right) => left.priorityRank - right.priorityRank,
  );
  if (
    queue.length !== revised.length
    || queue.some((entry, index) =>
      entry.batchId !== report.underwritingBatch.batchId
      || entry.priorityRank !== index + 1
      || entry.dealId !== revised[index]?.dealId
    )
  ) fail("current cold queue must contain every and only belief revision");
  const statusCounts = {
    queued: queue.filter(({ status }) => status === "queued").length,
    running: queue.filter(({ status }) => status === "running").length,
    completed: queue.filter(({ status }) => status === "completed").length,
    partial: queue.filter(({ status }) => status === "partial").length,
    failed: queue.filter(({ status }) => status === "failed").length,
  };
  if (
    !isDeepStrictEqual(
      statusCounts,
      report.underwritingBatch.underwritingStatusCounts,
    )
    || report.counts.underwritingQueuedCount !== statusCounts.queued
    || report.counts.underwritingRunningCount !== statusCounts.running
    || report.counts.underwritingCompletedCount !== statusCounts.completed
    || report.counts.underwritingPartialCount !== statusCounts.partial
    || report.counts.underwritingFailedCount !== statusCounts.failed
  ) fail("current cold underwriting status counts are not queue-derived");
  return {
    priorityOrder: queue.map(({ dealId, priorityRank }) => ({
      dealId,
      priorityRank,
    })),
    screeningMonitorCount: screening.filter(
      ({ outcome }) => outcome === "monitor",
    ).length,
    screeningNonRevisingCount: screening.filter(({ outcome }) =>
      outcome === "monitor" || outcome === "no_material_change"
    ).length,
  };
}

function asVerifierRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasForbiddenTopFiveKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenTopFiveKey);
  const record = asVerifierRecord(value);
  if (!record) return false;
  const forbidden = new Set([
    "selectedForTop5",
    "top5Selection",
    "not_selected_due_to_rank",
  ]);
  return Object.entries(record).some(([key, child]) =>
    forbidden.has(key) || hasForbiddenTopFiveKey(child)
  );
}

const ArtifactShapeSchema = z.object({
  candidateRunId: IdSchema,
  workspaceId: IdSchema,
  dealId: IdSchema,
  candidateAnalysisFingerprint: FingerprintSchema,
  evidencePack: z.object({
    id: IdSchema,
    workspaceId: IdSchema,
    dealId: IdSchema,
    sourceRevisionIds: z.array(IdSchema).min(1),
    facts: z.array(z.object({
      id: IdSchema,
      sourceRevisionId: IdSchema,
      sourceRole: IdSchema,
      acceptedForGate: z.boolean(),
    })).min(1),
    assumptions: z.array(z.unknown()),
    coverage: z.object({
      minimumModelInputsComplete: z.boolean(),
      underwritingStatus: z.enum(["available", "unavailable"]),
      missingFieldIds: z.array(IdSchema).min(1),
      decisionCeiling: z.enum(["Pass", "Watch", "Advance", "Invest Candidate"]).nullable(),
      reasonCodes: z.array(IdSchema),
    }),
  }),
  scenarioModel: z.object({
    id: IdSchema,
    candidateRunId: IdSchema,
    scenarios: z.array(z.object({ name: z.enum(["bear", "base", "bull"]) })).length(3),
  }),
  calculations: z.array(z.unknown()),
  judgments: z.array(z.object({
    id: IdSchema,
    applicability: z.enum(["applicable", "not_applicable", "unavailable"]),
    conclusion: z.enum(["supportive", "mixed", "negative", "abstain"]),
    strongestSupport: IdSchema.nullable(),
    strongestCounterargument: IdSchema.nullable(),
    unknowns: z.array(z.string()),
    limitations: z.array(IdSchema).min(1),
  })).min(2),
  disagreements: z.array(z.object({
    id: IdSchema,
    leftJudgmentId: IdSchema,
    rightJudgmentId: IdSchema,
    explanation: IdSchema,
  })),
  valuation: z.object({
    id: IdSchema,
    status: z.enum(["completed", "partial", "unavailable"]),
    scenarios: z.array(z.object({
      name: z.enum(["bear", "base", "bull"]),
      valuation: z.string().nullable(),
    })).length(3),
    currentAsk: z.string().nullable(),
    maximumAcceptablePreMoney: z.string().nullable(),
    initialOwnership: z.string().nullable(),
    postDilutionOwnership: z.string().nullable(),
    grossMoic: z.string().nullable(),
    grossIrr: z.string().nullable(),
    pricingPremium: z.string().nullable(),
    blockerCodes: z.array(IdSchema).min(1),
  }),
  decision: z.object({
    id: IdSchema,
    decision: z.enum(["Pass", "Watch", "Advance", "Invest Candidate"]).nullable(),
    decisionCeiling: z.enum(["Pass", "Watch", "Advance", "Invest Candidate"]).nullable(),
    firedRules: z.array(z.object({
      ruleId: IdSchema,
      inputRefs: z.array(IdSchema),
    })),
    confidence: z.enum(["low", "medium", "high"]),
  }),
  narrative: IdSchema,
  actionDrafts: z.array(z.unknown()).min(1),
  versionSnapshot: z.object({
    dealStatus: z.enum(["passed", "watchlist", "invested"]),
    beliefDirection: z.enum(["positive", "negative"]),
    canonicalActions: z.array(BeliefActionSchema).min(1),
    actionPolicyVersion: z.literal("belief-action-policy-v1"),
    draftPolicyVersion: z.literal("status-safe-action-draft-v2"),
    companyAnalysisUnknowns: z.array(z.strictObject({
      fieldId: z.string().regex(/^semantic-field-[a-f0-9]{24}$/u),
      label: IdSchema,
      externalLabel: IdSchema,
    })).min(1),
  }),
});

const ChatRouteShapeSchema = z.object({
  memoryStatus: z.literal("disabled"),
  usedXTrace: z.literal(false),
  scope: z.object({
    reportId: IdSchema,
    runId: z.string().uuid(),
    dealId: IdSchema,
    companyName: IdSchema,
    evidenceContext: CurrentReportEvidenceContextV1Schema,
  }),
});

function fail(detail: string): never {
  throw new Error(`Task 12 Reports/Chat verification failed: ${detail}`);
}

function unwrapData(value: unknown): unknown {
  if (
    typeof value === "object"
    && value !== null
    && "data" in value
    && !("id" in value)
  ) return (value as { data: unknown }).data;
  return value;
}

function exactReviewedCase(dealId: string) {
  const expected = REVIEWED_CASES[dealId as keyof typeof REVIEWED_CASES];
  if (!expected) fail(`unexpected selected Deal ${dealId}`);
  return expected;
}

function utf8Compare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function expectedDraftFormats(
  dealStatus: DealStatus,
  direction: BeliefChangeDirection,
): string[] {
  if (dealStatus === "invested" && direction === "negative") {
    return ["internal_memo"];
  }
  if (dealStatus === "invested") {
    return ["diligence_request", "founder_email", "internal_memo"];
  }
  return [
    "diligence_request",
    "founder_email",
    "founder_linkedin",
    "founder_sms",
    "internal_memo",
  ];
}

function validateSelectedAnalysis(
  raw: unknown,
  identity: { reportId: string; runId: string },
): SelectedAnalysis {
  const canonicalAnalysis = CompanyAnalysisSchema.parse(raw);
  const analysis = SelectedAnalysisSchema.parse(canonicalAnalysis);
  const expected = exactReviewedCase(analysis.dealId);
  if (
    analysis.reportId !== identity.reportId
    || analysis.runId !== identity.runId
    || analysis.companyName !== expected.companyName
    || analysis.dealStatus !== expected.dealStatus
    || analysis.beliefAssessment.dealStatus !== expected.dealStatus
    || analysis.beliefAssessment.direction !== expected.direction
    || analysis.score !== analysis.beliefAssessment.scoreBreakdown.finalScore
    || analysis.confidence !== analysis.beliefAssessment.scoreBreakdown.confidence
  ) fail(`Report belief assessment identity mismatch for ${analysis.dealId}`);

  const expectedActions = actionsForDealStatusAndDirection(
    analysis.dealStatus,
    analysis.beliefAssessment.direction,
  );
  if (
    !beliefActionListsEqual(analysis.beliefAssessment.actions, expectedActions)
    || !beliefActionListsEqual(
      analysis.beliefAssessment.gates.actionDelta.proposedActions,
      expectedActions,
    )
    || beliefActionListsEqual(
      analysis.beliefAssessment.gates.actionDelta.priorActions,
      expectedActions,
    )
  ) fail(`Report action delta is not authoritative for ${analysis.dealId}`);

  const gates = analysis.beliefAssessment.gates;
  const prior = analysis.beliefAssessment.gateContext.priorInteraction;
  const trigger = analysis.beliefAssessment.gateContext.triggerEvent;
  if (
    gates.chronology.priorInteractionId !== prior.id
    || gates.chronology.triggerEventId !== trigger.id
    || gates.revisitConditionMapping.priorInteractionId !== prior.id
    || gates.revisitConditionMapping.triggerEventId !== trigger.id
    || Date.parse(gates.chronology.priorInteractionAt)
      >= Date.parse(gates.chronology.triggerEventAt)
  ) fail(`Report chronology/revisit binding is invalid for ${analysis.dealId}`);

  const sources = analysis.sources.map((source) =>
    EvidenceSourceRefSchema.parse(source)
  );
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  if (sourceById.size !== sources.length) {
    fail(`Report source identities are duplicated for ${analysis.dealId}`);
  }
  const cited = [
    ...gates.revisitConditionMapping.citedSourceIds,
    ...gates.counterevidence.citedSourceIds,
    ...trigger.sourceIds,
  ];
  if (cited.some((sourceId) => !sourceById.has(sourceId))) {
    fail(`Report gate source does not resolve for ${analysis.dealId}`);
  }
  const sampleId = analysis.investmentMemory.fixtureIds[0]!;
  const sample = sourceById.get(sampleId);
  if (
    !sample
    || !("schemaVersion" in sample)
    || sample.provenance !== "demo_fixture"
    || sample.title !== "Sample decision record"
    || sample.sourceRevisionId === null
    || sample.contentFingerprint === null
    || sample.text.status !== "normalized_only"
    || !sample.text.normalizedStatement.startsWith("Sample decision record. ")
    || analysis.investmentMemory.sourceIds[0] !== sampleId
    || analysis.companyBrief.decisionHistory[0]?.sourceIds[0] !== sampleId
  ) fail(`Report Sample decision record is not permanent for ${analysis.dealId}`);
  const triggerSources = trigger.sourceIds.map((sourceId) => sourceById.get(sourceId)!);
  const eventTriggerSources = triggerSources.filter((source) =>
    "schemaVersion" in source && source.evidenceRole === "trigger"
  );
  if (eventTriggerSources.length !== 1 || triggerSources.some((source) =>
    !("schemaVersion" in source)
    || source.adaptation !== "canonical"
    || source.sourceRevisionId === null
    || source.contentFingerprint === null
    || (source.evidenceRole === "trigger"
      && (source.eventAt === null || source.publishedAt === null))
    || source.retrievedAt === null
    || source.entityKeys === undefined
    || source.sourceClass === undefined
    || source.evidenceRole === undefined
  )) fail(`Report MarketEvent provenance is incomplete for ${analysis.dealId}`);
  return canonicalAnalysis as SelectedAnalysis;
}

function validateArtifact(input: {
  raw: CandidateArtifactBundle;
  workspaceId: string;
  candidateRunId: string;
  analysis: SelectedAnalysis;
}): CandidateArtifactBundle {
  const artifact = ArtifactShapeSchema.parse(input.raw);
  const expected = exactReviewedCase(input.analysis.dealId);
  if (
    artifact.candidateRunId !== input.candidateRunId
    || artifact.workspaceId !== input.workspaceId
    || artifact.dealId !== input.analysis.dealId
    || artifact.evidencePack.workspaceId !== input.workspaceId
    || artifact.evidencePack.dealId !== input.analysis.dealId
    || artifact.scenarioModel.candidateRunId !== input.candidateRunId
    || artifact.versionSnapshot.dealStatus !== expected.dealStatus
    || artifact.versionSnapshot.beliefDirection !== expected.direction
  ) fail(`Underwriting artifact scope mismatch for ${input.analysis.dealId}`);

  const expectedActions = actionsForDealStatusAndDirection(
    input.analysis.dealStatus,
    input.analysis.beliefAssessment.direction,
  );
  if (!beliefActionListsEqual(
    artifact.versionSnapshot.canonicalActions,
    expectedActions,
  )) fail(`Underwriting action policy mismatch for ${input.analysis.dealId}`);

  const scenarioNames = artifact.scenarioModel.scenarios
    .map(({ name }) => name).sort();
  const valuationScenarioNames = artifact.valuation.scenarios
    .map(({ name }) => name).sort();
  if (
    !isDeepStrictEqual(scenarioNames, ["base", "bear", "bull"])
    || !isDeepStrictEqual(valuationScenarioNames, ["base", "bear", "bull"])
  ) fail(`Bear/Base/Bull is incomplete for ${input.analysis.dealId}`);
  const coverage = artifact.evidencePack.coverage;
  const unavailableCoverageValid =
    coverage.minimumModelInputsComplete === false
    && coverage.underwritingStatus === "unavailable"
    && coverage.decisionCeiling === null
    && coverage.reasonCodes.includes("MISSING_MINIMUM_MODEL_INPUTS")
    && !coverage.reasonCodes.includes("CORE_ONLY_ANALYSIS_CEILING");
  const coreOnlyAdvanceCoverageValid =
    coverage.minimumModelInputsComplete === true
    && coverage.underwritingStatus === "available"
    && coverage.decisionCeiling === "Advance"
    && coverage.reasonCodes.includes("MISSING_CRITICAL_EVIDENCE")
    && coverage.reasonCodes.includes("CORE_ONLY_ANALYSIS_CEILING")
    && !coverage.reasonCodes.includes("MISSING_MINIMUM_MODEL_INPUTS");
  if (!unavailableCoverageValid && !coreOnlyAdvanceCoverageValid) fail(
    `Evidence Pack does not preserve the explicit ${coverage.minimumModelInputsComplete ? "core-only Advance" : "unavailable"} decision ceiling for ${input.analysis.dealId}: ${JSON.stringify(coverage)}`,
  );
  if (
    artifact.valuation.status !== "unavailable"
    || artifact.valuation.scenarios.some(({ valuation }) => valuation !== null)
    || artifact.valuation.currentAsk !== null
    || artifact.valuation.maximumAcceptablePreMoney !== null
    || artifact.valuation.initialOwnership !== null
    || artifact.valuation.postDilutionOwnership !== null
    || artifact.valuation.grossMoic !== null
    || artifact.valuation.grossIrr !== null
    || artifact.valuation.pricingPremium !== null
    || artifact.decision.decision !== null
    || artifact.decision.decisionCeiling !== null
  ) fail(`Valuation availability changed for ${input.analysis.dealId}`);

  const revisionIds = new Set(artifact.evidencePack.sourceRevisionIds);
  if (
    revisionIds.size !== artifact.evidencePack.sourceRevisionIds.length
    || artifact.evidencePack.facts.some(({ sourceRevisionId }) =>
      !revisionIds.has(sourceRevisionId)
    )
  ) fail(`Evidence Pack source lineage is incomplete for ${input.analysis.dealId}`);
  const judgmentIds = new Set(artifact.judgments.map(({ id }) => id));
  if (artifact.judgments.some((judgment) =>
    (judgment.applicability === "applicable"
      && (judgment.strongestSupport === null
        || judgment.strongestCounterargument === null))
    || (judgment.applicability !== "applicable"
      && judgment.unknowns.length === 0)
  )) fail(`Framework opinion is incomplete for ${input.analysis.dealId}`);
  if (artifact.disagreements.some((disagreement) =>
    !judgmentIds.has(disagreement.leftJudgmentId)
    || !judgmentIds.has(disagreement.rightJudgmentId)
  )) fail(`Framework disagreement does not resolve for ${input.analysis.dealId}`);
  return input.raw;
}

function sortedById<T extends { id: string }>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => utf8Compare(left.id, right.id));
}

function validateDrafts(input: {
  raw: unknown;
  bundle: CandidateArtifactBundle;
  analysis: SelectedAnalysis;
}): void {
  const routeDrafts = z.array(z.unknown()).parse(unwrapData(input.raw));
  const expectedPublicDrafts = input.bundle.actionDrafts.map(toPublicActionDraft);
  if (!isDeepStrictEqual(
    sortedById(routeDrafts as Array<{ id: string }>),
    sortedById(expectedPublicDrafts),
  )) fail(`Action Draft DTO mismatch for ${input.analysis.dealId}`);

  const drafts = input.bundle.actionDrafts.map((draft) =>
    ActionDraftV2Schema.parse(draft)
  );
  if (drafts.some(({ missingEvidence }) => missingEvidence.length === 0)) {
    fail(`Action Draft missing-evidence bundle is empty for ${input.analysis.dealId}`);
  }
  const formats = drafts.map(({ format }) => format).sort();
  const expectedFormats = expectedDraftFormats(
    input.analysis.dealStatus,
    input.analysis.beliefAssessment.direction,
  );
  if (!isDeepStrictEqual(formats, expectedFormats)) {
    fail(`Status-aware draft matrix mismatch for ${input.analysis.dealId}`);
  }
  const unsafeFounderDetail = drafts.filter(({ audienceType }) =>
    audienceType === "founder"
  ).some(({ body }) =>
    /Formal decision:|Deal status:|Belief direction:|pause follow-on|portfolio-risk|reopen internal|advance internal|evaluate a follow-on/iu
      .test(body)
  );
  if (unsafeFounderDetail) {
    fail(`Founder draft leaked internal posture for ${input.analysis.dealId}`);
  }
  const structuredUnknowns = (input.analysis.companyBrief.structuredFields ?? [])
    .filter((field) => field.classification === "unknown")
    .map((field) => ({
      fieldId: field.id,
      label: field.reason,
      externalLabel: field.externalLabel,
    }))
    .sort((left, right) => utf8Compare(left.fieldId, right.fieldId));
  const snapshotUnknowns = [...(
    input.bundle.versionSnapshot.companyAnalysisUnknowns ?? []
  )].sort((left, right) => utf8Compare(left.fieldId, right.fieldId));
  if (!isDeepStrictEqual(snapshotUnknowns, structuredUnknowns)) {
    fail(
      `Finalized missing evidence is not bound to CompanyAnalysis unknowns for ${input.analysis.dealId}`,
    );
  }
  const expectedSemanticMissing = structuredUnknowns.map((unknown) => ({
    ...unknown,
    reasonCode: "UNRESOLVED_COMPANY_OR_EVENT_UNKNOWN" as const,
    mostLikelyDecisionImpact:
      "Resolving this company- or event-specific unknown may raise or lower the formal decision ceiling.",
  }));
  for (const draft of drafts) {
    const semanticMissing = draft.missingEvidence
      .filter(({ reasonCode }) =>
        reasonCode === "UNRESOLVED_COMPANY_OR_EVENT_UNKNOWN"
      )
      .sort((left, right) => utf8Compare(left.fieldId, right.fieldId));
    if (!isDeepStrictEqual(semanticMissing, expectedSemanticMissing)) {
      fail(
        `Action Draft unknown binding is not exact for ${input.analysis.dealId}`,
      );
    }
  }
  if (input.analysis.dealId === RESEARCH_ACTION_CROSSWALK
    .validate_channel_economics.dealId) {
    const crosswalk = RESEARCH_ACTION_CROSSWALK.validate_channel_economics;
    const kinds = input.analysis.beliefAssessment.actions.map(({ kind }) => kind);
    const exactUnknown = structuredUnknowns.length === 1
      && structuredUnknowns[0]!.label === crosswalk.authoritativeUnknown.label
      && structuredUnknowns[0]!.externalLabel
        === crosswalk.authoritativeUnknown.externalLabel;
    const diligence = drafts.find(({ format }) =>
      format === crosswalk.requiredDraftFormat
    );
    if (
      !isDeepStrictEqual(kinds, crosswalk.canonicalBeliefActionKinds)
      || !exactUnknown
      || diligence === undefined
      || !diligence.missingEvidence.some((missing) =>
        missing.fieldId === structuredUnknowns[0]!.fieldId
        && missing.label === crosswalk.authoritativeUnknown.label
        && missing.externalLabel === crosswalk.authoritativeUnknown.externalLabel
        && missing.reasonCode === "UNRESOLVED_COMPANY_OR_EVENT_UNKNOWN"
      )
    ) {
      fail(
        "Hush research action validate_channel_economics does not map to its authoritative unknown and diligence-request draft",
      );
    }
  }
}

interface RevisionExpectation {
  fingerprint: string | null;
  paths: string[];
}

function collectRevisionExpectations(
  value: unknown,
  label: string,
  target: Map<string, RevisionExpectation>,
  path = "$",
  visited = new Set<object>(),
): void {
  if (typeof value !== "object" || value === null) return;
  if (visited.has(value)) return;
  visited.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectRevisionExpectations(item, label, target, `${path}[${index}]`, visited)
    );
    return;
  }
  const record = value as Record<string, unknown>;
  const fingerprint = typeof record.contentFingerprint === "string"
    ? record.contentFingerprint
    : null;
  const add = (revisionId: string, revisionPath: string) => {
    const current = target.get(revisionId);
    if (
      current !== undefined
      && current.fingerprint !== null
      && fingerprint !== null
      && current.fingerprint !== fingerprint
    ) fail(
      `Source revision ${revisionId} has conflicting fingerprints (${current?.fingerprint} at ${current?.paths.join(", ")} versus ${fingerprint} at ${label}:${revisionPath})`,
    );
    target.set(revisionId, {
      fingerprint: current?.fingerprint ?? fingerprint,
      paths: [...(current?.paths ?? []), `${label}:${revisionPath}`],
    });
  };
  if (typeof record.sourceRevisionId === "string") {
    add(record.sourceRevisionId, `${path}.sourceRevisionId`);
  }
  if (Array.isArray(record.sourceRevisionIds)) {
    for (const [index, revisionId] of record.sourceRevisionIds.entries()) {
      if (typeof revisionId === "string") {
        add(revisionId, `${path}.sourceRevisionIds[${index}]`);
      }
    }
  }
  for (const [key, child] of Object.entries(record)) {
    collectRevisionExpectations(child, label, target, `${path}.${key}`, visited);
  }
}

function finalizedResponseFromRoute(raw: unknown): {
  route: z.infer<typeof ChatRouteShapeSchema>;
  response: FinalizedChatSuccessResponse;
} {
  const value = unwrapData(raw);
  const route = ChatRouteShapeSchema.parse(value);
  const record = value as Record<string, unknown>;
  const response = FinalizedChatSuccessResponseSchema.parse({
    schemaVersion: record.schemaVersion,
    status: record.status,
    topic: record.topic,
    answer: record.answer,
    citations: record.citations,
    identity: record.identity,
    evidenceFrame: record.evidenceFrame,
    projection: record.projection,
    insufficientEvidence: record.insufficientEvidence,
  });
  return { route, response };
}

function artifactIds(input: {
  analysis: SelectedAnalysis;
  bundle: CandidateArtifactBundle;
}): Set<string> {
  return new Set([
    input.analysis.id,
    ...input.analysis.sources.flatMap((source) => {
      const parsed = EvidenceSourceRefSchema.parse(source);
      return [parsed.id];
    }),
    ...input.analysis.marketEvidence.events.flatMap((event) =>
      typeof event === "object" && event !== null && "id" in event
        ? [String(event.id)]
        : []
    ),
    input.bundle.evidencePack.id,
    ...input.bundle.evidencePack.facts.map(({ id }) => id),
    ...input.bundle.evidencePack.assumptions.map(({ id }) => id),
    input.bundle.scenarioModel.id,
    ...input.bundle.calculations.map(({ id }) => id),
    ...input.bundle.judgments.map(({ id }) => id),
    ...input.bundle.disagreements.map(({ id }) => id),
    input.bundle.valuation.id,
    input.bundle.decision.id,
    ...input.bundle.actionDrafts.map(({ id }) => id),
    ...(input.bundle.versionSnapshot.actionPolicyVersion === undefined
      ? []
      : [input.bundle.versionSnapshot.actionPolicyVersion]),
    ...input.bundle.actionDrafts.flatMap((draft) =>
      "schemaVersion" in draft
        ? draft.missingEvidence.map(({ fieldId }) => `${draft.id}:${fieldId}`)
        : []
    ),
  ]);
}

export async function verifyBeliefReversalReportsAndChat(
  input: BeliefReversalReportsAndChatVerifierInput,
): Promise<BeliefReversalReportsAndChatVerification> {
  const before = BeliefReversalIsolationCountersSchema.parse(
    await input.readIsolationCounters(),
  );
  const report = ReportSchema.parse(unwrapData(await input.readReport()));
  if (
    report.id !== input.reportId
    || report.workspaceId !== input.workspaceId
    || report.runId !== input.runId
    || report.evidenceContext.evidenceMode !== "pinned"
    || report.evidenceContext.snapshotId !== "belief_reversal_2026_08_01"
    || report.evidenceContext.eventCount !== 4
  ) fail("Report is not the exact reviewed pinned report/run scope");
  if (
    report.evidenceContext.anchorAt !== REVIEWED_PINNED_EVIDENCE_WINDOW.anchorAt
    || report.evidenceContext.windowStartAt
      !== REVIEWED_PINNED_EVIDENCE_WINDOW.windowStartAt
    || report.evidenceContext.windowEndAt
      !== REVIEWED_PINNED_EVIDENCE_WINDOW.windowEndAt
    || report.evidenceContext.windowTimezone
      !== REVIEWED_PINNED_EVIDENCE_WINDOW.windowTimezone
    || report.evidenceContext.displayLabel
      !== REVIEWED_PINNED_EVIDENCE_WINDOW.displayLabel
    || report.evidenceContext.anchorAt !== report.evidenceContext.windowEndAt
  ) {
    fail(
      "Report is outside the exact reviewed pinned evidence window: "
        + `actual=${JSON.stringify({
          anchorAt: report.evidenceContext.anchorAt,
          windowStartAt: report.evidenceContext.windowStartAt,
          windowEndAt: report.evidenceContext.windowEndAt,
          windowTimezone: report.evidenceContext.windowTimezone,
          displayLabel: report.evidenceContext.displayLabel,
        })} expected=${JSON.stringify(REVIEWED_PINNED_EVIDENCE_WINDOW)}`,
    );
  }

  const selectedAnalyses = report.companyAnalyses.flatMap((analysis) => {
    if (
      typeof analysis !== "object"
      || analysis === null
      || !("dealId" in analysis)
      || !(String(analysis.dealId) in REVIEWED_CASES)
    ) return [];
    return [validateSelectedAnalysis(analysis, {
      reportId: input.reportId,
      runId: input.runId,
    })];
  });
  if (
    selectedAnalyses.length !== 4
    || new Set(selectedAnalyses.map(({ dealId }) => dealId)).size !== 4
  ) fail("Report does not contain the exact four reviewed cases");

  const rankedAnalyses = [...selectedAnalyses].sort((left, right) =>
    right.score - left.score || utf8Compare(left.dealId, right.dealId)
  );
  const selectedRows = report.underwritingBatch.queue;
  if (selectedRows.length !== 4) {
    fail("Pinned Deep Underwriting queue must contain four historical admissions");
  }
  const rowsByDeal = new Map(selectedRows.map((row) => [row.dealId, row]));
  const legacy = report.underwritingBatch.legacyPinnedPriorityOrder;
  const legacyByDeal = new Map(legacy.entries.map((entry) => [entry.dealId, entry]));
  if (
    legacy.entries.length !== 23
    || legacyByDeal.size !== 23
    || selectedRows.some((row) => {
      const historical = legacyByDeal.get(row.dealId);
      return !historical
        || historical.batchId !== report.underwritingBatch.batchId
        || historical.historicalAdmissionStatus !== "historically_admitted"
        || historical.historicalPriorityOrder !== row.priorityRank;
    })
  ) fail("Pinned legacy priority adapter does not preserve the 23-analysis artifact");
  const revisions = new Map<string, RevisionExpectation>();
  collectRevisionExpectations(report, "report", revisions);
  const bundlesByDeal = new Map<string, CandidateArtifactBundle>();
  const ranking: BeliefReversalReportsAndChatVerification["ranking"] = [];

  for (const [index, analysis] of rankedAnalyses.entries()) {
    const selection = rowsByDeal.get(analysis.dealId);
    if (
      !selection
      || selection.priorityRank !== index + 1
      || !["completed", "partial"].includes(selection.status)
    ) fail(`Underwriting priority order is not score-derived for ${analysis.dealId}`);
    const bundle = await input.readArtifact({
      workspaceId: input.workspaceId,
      candidateRunId: selection.candidateRunId,
    });
    if (!bundle) fail(`finalized artifact missing for ${analysis.dealId}`);
    const finalizedBundle = validateArtifact({
      raw: bundle,
      workspaceId: input.workspaceId,
      candidateRunId: selection.candidateRunId,
      analysis,
    });
    const detail = unwrapData(await input.readUnderwritingDetail({
      workspaceId: input.workspaceId,
      reportId: input.reportId,
      runId: input.runId,
      dealId: analysis.dealId,
    }));
    if (!isDeepStrictEqual(detail, toCandidateUnderwritingDetail(finalizedBundle))) {
      fail(`Underwriting DTO is not the public projection for ${analysis.dealId}`);
    }
    validateDrafts({
      raw: await input.readActionDrafts({
        workspaceId: input.workspaceId,
        candidateRunId: selection.candidateRunId,
      }),
      bundle: finalizedBundle,
      analysis,
    });
    collectRevisionExpectations(analysis, `report:${analysis.dealId}`, revisions);
    collectRevisionExpectations(finalizedBundle, `artifact:${analysis.dealId}`, revisions);
    collectRevisionExpectations(detail, `underwriting:${analysis.dealId}`, revisions);
    bundlesByDeal.set(analysis.dealId, finalizedBundle);
    ranking.push({
      dealId: analysis.dealId as keyof typeof REVIEWED_CASES,
      companyName: analysis.companyName,
      rank: index + 1,
      score: analysis.score,
      confidence: analysis.confidence,
    });
  }

  let hushInvestedActionVerified = false;
  let irregularInvestedActionVerified = false;
  const chatTopics = new Set<FinalizedChatTopic>();
  for (const query of FINALIZED_CHAT_E2E_QUERIES) {
    const analysis = selectedAnalyses.find(({ dealId }) => dealId === query.dealId)!;
    const selection = rowsByDeal.get(query.dealId)!;
    const bundle = bundlesByDeal.get(query.dealId)!;
    const { route, response } = finalizedResponseFromRoute(
      await input.askFinalizedChat({
        question: query.question,
        reportId: input.reportId,
        runId: input.runId,
        dealId: query.dealId,
      }),
    );
    if (
      response.topic !== query.topic
      || response.identity.workspaceId !== input.workspaceId
      || response.identity.reportId !== input.reportId
      || response.identity.runId !== input.runId
      || response.identity.dealId !== query.dealId
      || response.identity.candidateRunId !== selection.candidateRunId
      || route.scope.reportId !== input.reportId
      || route.scope.runId !== input.runId
      || route.scope.dealId !== query.dealId
      || route.scope.companyName !== analysis.companyName
      || !isDeepStrictEqual(route.scope.evidenceContext, report.evidenceContext)
      || response.evidenceFrame.state !== "current"
      || response.evidenceFrame.evidenceMode !== "pinned"
      || response.evidenceFrame.snapshotId !== report.evidenceContext.snapshotId
      || response.evidenceFrame.snapshotFingerprint
        !== report.evidenceContext.snapshotFingerprint
      || response.evidenceFrame.contextFingerprint
        !== report.evidenceContext.contextFingerprint
      || response.evidenceFrame.eventSetFingerprint
        !== report.evidenceContext.eventSetFingerprint
      || response.evidenceFrame.bindingFingerprint
        !== report.evidenceContext.bindingFingerprint
    ) fail(`Finalized Chat scope mismatch for ${query.topic}/${query.dealId}`);

    const expectedBuild = buildFinalizedChatProjection({
      topic: query.topic,
      requestMode: "public_sandbox",
      identity: {
        workspaceId: input.workspaceId,
        reportId: input.reportId,
        runId: input.runId,
        dealId: query.dealId,
        candidateRunId: selection.candidateRunId,
      },
      evidenceFrame: {
        state: "current",
        evidenceMode: "pinned",
        contextFingerprint: report.evidenceContext.contextFingerprint,
        eventSetFingerprint: report.evidenceContext.eventSetFingerprint,
        bindingFingerprint: report.evidenceContext.bindingFingerprint,
        snapshotId: report.evidenceContext.snapshotId,
        snapshotFingerprint: report.evidenceContext.snapshotFingerprint,
      },
      analysis,
      candidateBinding: {
        candidateRunId: selection.candidateRunId,
        rerunOfId: null,
        candidateAnalysisFingerprint: bundle.candidateAnalysisFingerprint,
      },
      bundle,
    });
    if (expectedBuild.status !== "success") {
      fail(
        `Independent canonical projection could not be built for ${query.topic}/${query.dealId}`,
      );
    }
    const expectedResponse = renderFinalizedChatProjection(
      expectedBuild.projection,
    );
    if (!isDeepStrictEqual(response, expectedResponse)) {
      fail(
        `Finalized Chat is not the canonical finalized projection for ${query.topic}/${query.dealId}`,
      );
    }
    const allowedArtifacts = artifactIds({ analysis, bundle });
    if (response.projection.claims.some(({ artifactRefs }) =>
      artifactRefs.some(({ artifactId }) => !allowedArtifacts.has(artifactId))
    )) fail(`Finalized Chat used an out-of-scope artifact for ${query.dealId}`);
    const scopedRevisionIds = new Set<string>();
    const scoped = new Map<string, RevisionExpectation>();
    collectRevisionExpectations(analysis, "chat-analysis", scoped);
    collectRevisionExpectations(bundle, "chat-bundle", scoped);
    scoped.forEach((_value, revisionId) => scopedRevisionIds.add(revisionId));
    if (response.citations.some(({ sourceRevisionId }) =>
      !scopedRevisionIds.has(sourceRevisionId)
    )) fail(`Finalized Chat source escaped Deal scope for ${query.dealId}`);
    collectRevisionExpectations(response, `chat:${query.topic}:${query.dealId}`, revisions);
    chatTopics.add(query.topic);
    if (query.topic === "invested_action") {
      const text = response.projection.claims.map(({ text }) => text).join("\n");
      if (query.dealId === "deal_hush_security_v1") {
        if (!/evaluate_follow_on/u.test(text)
          || /pause_follow_on|portfolio_risk_review/u.test(text)) {
          fail("Hush finalized Chat invested action is not positive-follow-on safe");
        }
        hushInvestedActionVerified = true;
      }
      if (query.dealId === "deal_irregular_v1") {
        if (!/pause_follow_on/u.test(text)
          || !/portfolio_risk_review/u.test(text)
          || /evaluate_follow_on/u.test(text)) {
          fail("Irregular finalized Chat invested action is not pause-and-risk-review safe");
        }
        irregularInvestedActionVerified = true;
      }
    }
  }
  if (
    chatTopics.size !== FinalizedChatTopicSchema.options.length
    || FinalizedChatTopicSchema.options.some((topic) => !chatTopics.has(topic))
    || !hushInvestedActionVerified
    || !irregularInvestedActionVerified
  ) fail("Finalized Chat coverage is incomplete");

  if (revisions.size === 0) fail("No source revision lineage was collected");
  const resolvedSourceRevisionIds = [...revisions.keys()].sort(utf8Compare);
  for (const sourceRevisionId of resolvedSourceRevisionIds) {
    const raw = await input.resolveSourceRevision({
      workspaceId: input.workspaceId,
      sourceRevisionId,
    });
    if (!raw) fail(`source revision ${sourceRevisionId} does not resolve`);
    const revision = SourceRevisionSchema.parse(raw);
    const expected = revisions.get(sourceRevisionId)!;
    if (
      revision.id !== sourceRevisionId
      || revision.workspaceId !== input.workspaceId
      || (expected.fingerprint !== null
        && revision.contentHash !== expected.fingerprint)
    ) fail(`source revision ${sourceRevisionId} resolved to a different identity`);
  }

  const after = BeliefReversalIsolationCountersSchema.parse(
    await input.readIsolationCounters(),
  );
  const expectedAfter: BeliefReversalIsolationCounters = {
    ...before,
    route: {
      ...before.route,
      rateLimitCalls:
        before.route.rateLimitCalls + FINALIZED_CHAT_E2E_QUERIES.length,
      rateLimitDbRequests:
        before.route.rateLimitDbRequests + FINALIZED_CHAT_E2E_QUERIES.length,
    },
  };
  if (
    before.route.remoteNetworkAttempts !== 0
    || !isDeepStrictEqual(after, expectedAfter)
  ) {
    fail(
      "live provider/database isolation changed outside the expected loopback rate-limit writes",
    );
  }
  return {
    ranking,
    resolvedSourceRevisionIds,
    chatTopics: [...chatTopics],
    chatQueryCount: FINALIZED_CHAT_E2E_QUERIES.length,
    hushInvestedActionVerified: true,
    hushResearchActionCrosswalkVerified: true,
    irregularInvestedActionVerified: true,
    isolationCountersUnchanged: true,
  };
}
