import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { GET as readActionDraftsRoute } from "../../app/api/action-drafts/route";
import { POST as askChatRoute } from "../../app/api/chat/route";
import { GET as readReportRoute } from "../../app/api/reports/[id]/route";
import {
  GET as readUnderwritingRoute,
} from "../../app/api/reports/[id]/underwriting/[dealId]/route";
import { createSupabaseDataClient } from "../../db/client";
import {
  createSupabaseIntelligenceRepository,
} from "../../db/repositories/intelligence";
import {
  createSupabaseUnderwritingArtifactsRepository,
} from "../../db/repositories/underwriting-artifacts";
import {
  createSupabaseUnderwritingRunsRepository,
} from "../../db/repositories/underwriting-runs";
import { createRunsRepository } from "../../db/repositories/runs";
import type { RouteDependencies } from "../../lib/api/route-dependencies";
import { rateLimitRequest } from "../../lib/api/safety";
import {
  buildBeliefReversalDockerPlan,
  createStandalonePostgrestRepositoryFetch,
  discoverMigrationPlan,
  probeBeliefReversalE2EAvailability,
  provisionBeliefReversalE2EInfrastructure,
  runHarnessCommand,
} from "../helpers/belief-reversal-e2e-harness";
import {
  createBeliefReversalE2EDataRuntime,
  seedAndVerifyBeliefReversalE2EData,
} from "../helpers/belief-reversal-e2e-data";
import {
  createBeliefReversalProcessRuntime,
  readBeliefReversalIsolationPersistentCounts,
  runBeliefReversalCurrentColdPass,
  runBeliefReversalPinnedPipeline,
} from "../helpers/belief-reversal-e2e-pipeline";
import {
  verifyBeliefReversalCurrentColdReport,
  verifyBeliefReversalReportsAndChat,
} from "../helpers/belief-reversal-e2e-verifier";
import {
  buildBeliefReversalLiveMarketPackets,
  createBeliefReversalRegistryGroundedLiveMarketService,
} from "../helpers/belief-reversal-live-market";
import { makeDisposableDatabaseName } from "../helpers/require-loopback-postgres";

const availability = probeBeliefReversalE2EAvailability({
  environment: process.env,
  runner: runHarnessCommand,
});

// Which of the four reviewed cases actually revises depends on whether its
// trigger event still falls inside the run's 14-day window, so the acceptance
// pins the admissible set rather than a distribution that expires.
const BELIEF_REVISION_CAPABLE = {
  beliefRevisionCapableDealIds: [
    "deal_henry_ai_v1",
    "deal_hush_security_v1",
    "deal_irregular_v1",
    "deal_smallest_ai_v1",
  ],
} as const;

const diagnosticLoopbackFetch: typeof fetch = async (request, init) => {
  const response = await fetch(request, init);
  if (!response.ok) {
    const url = new URL(
      typeof request === "string"
        ? request
        : request instanceof URL
        ? request.href
        : request.url,
    );
    const payload = await response.clone().json().catch(() => null) as
      | { code?: unknown; message?: unknown }
      | null;
    console.error(
      `[task12-loopback] ${init?.method ?? "GET"} ${url.pathname} -> ${response.status}`
        + ` code=${typeof payload?.code === "string" ? payload.code : "unknown"}`
        + ` message=${typeof payload?.message === "string" ? payload.message : "unavailable"}`,
    );
  }
  return response;
};

async function readSuccessfulRoute(
  label: string,
  responsePromise: Promise<Response>,
): Promise<unknown> {
  const response = await responsePromise;
  const payload = await response.json() as unknown;
  assert.equal(
    response.status,
    200,
    `${label} failed: ${JSON.stringify(payload)}`,
  );
  return payload;
}

test(
  "belief-reversal mainline runs the reviewed pinned and live 30-Deal paths on disposable loopback PostgreSQL",
  { skip: availability.state === "skipped" ? availability.reason : false },
  async (context) => {
    assert.equal(availability.state, "eligible");
    if (availability.state !== "eligible") return;

    const databaseName = makeDisposableDatabaseName("belief_e2e");
    const resourceSuffix = databaseName.slice(-16);
    const migrationPlan = discoverMigrationPlan({
      directory: fileURLToPath(new URL("../../drizzle/", import.meta.url)),
      journalPath: fileURLToPath(
        new URL("../../drizzle/meta/_journal.json", import.meta.url),
      ),
    });
    const infrastructure = await provisionBeliefReversalE2EInfrastructure({
      availability,
      dockerPlan: buildBeliefReversalDockerPlan({
        databaseName,
        resourceSuffix,
      }),
      migrationPlan,
      issuedAtSeconds: Math.floor(Date.now() / 1_000),
    });
    try {
      assert.equal(infrastructure.target.databaseName, databaseName);
      assert.equal(infrastructure.target.postgresHost, "127.0.0.1");
      assert.equal(infrastructure.target.postgresVersion, "17.6");
      assert.equal(infrastructure.target.postgrestVersion, "12.2.3");
      assert.equal(
        infrastructure.migrationTerminal.tag,
        migrationPlan.terminal.tag,
      );
      let remoteNetworkAttempts = 0;
      const trackedLoopbackFetch: typeof fetch = async (request, init) => {
        const url = new URL(
          typeof request === "string"
            ? request
            : request instanceof URL
            ? request.href
            : request.url,
        );
        if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
          remoteNetworkAttempts += 1;
          throw new Error(`Task-12 E2E blocked a remote request to ${url.origin}.`);
        }
        return diagnosticLoopbackFetch(request, init);
      };
      const repositoryFetch = createStandalonePostgrestRepositoryFetch({
        postgrestUrl: infrastructure.target.postgrestUrl,
        fetchImpl: trackedLoopbackFetch,
      });
      const dataRuntime = createBeliefReversalE2EDataRuntime({
        infrastructure,
        fetchImpl: repositoryFetch,
      });
      const seeded = await seedAndVerifyBeliefReversalE2EData({
        runtime: dataRuntime,
        corpusDirectory: fileURLToPath(
          new URL("../../seed/corpus/", import.meta.url),
        ),
      });
      const pinnedSnapshot = await dataRuntime.marketEvidenceSnapshots.get(
        dataRuntime.workspaceId,
        "belief_reversal_2026_08_01",
      );
      assert.ok(pinnedSnapshot);
      assert.deepEqual({
        snapshotAsOfDate: pinnedSnapshot.snapshotAsOfDate,
        anchorAt: new Date(pinnedSnapshot.anchorAt).toISOString(),
        windowStartAt: new Date(pinnedSnapshot.windowStartAt).toISOString(),
        windowEndAt: new Date(pinnedSnapshot.windowEndAt).toISOString(),
        windowTimezone: pinnedSnapshot.windowTimezone,
        displayLabel: pinnedSnapshot.displayLabel,
      }, {
        snapshotAsOfDate: "2026-08-01",
        anchorAt: "2026-08-02T06:59:59.000Z",
        windowStartAt: "2026-07-19T07:00:00.000Z",
        windowEndAt: "2026-08-02T06:59:59.000Z",
        windowTimezone: "America/Los_Angeles",
        displayLabel: "Demo evidence snapshot as of 2026-08-01",
      });
      assert.equal(
        Date.parse(pinnedSnapshot.anchorAt),
        Date.parse(pinnedSnapshot.windowEndAt),
      );
      const pipelineTarget = {
        databaseName,
        postgresVersion: infrastructure.target.postgresVersion,
        postgrestUrl: infrastructure.target.postgrestUrl,
        postgrestVersion: infrastructure.target.postgrestVersion,
        serviceRoleKey: infrastructure.serviceRoleJwt,
      };
      const pipeline = await runBeliefReversalPinnedPipeline({
        target: pipelineTarget,
        workspaceId: dataRuntime.workspaceId,
        dataStore: dataRuntime.dataStore,
        fetchImpl: repositoryFetch,
        now: () => new Date("2026-08-03T12:00:00.000Z"),
        expectedCurrentOutcomes: BELIEF_REVISION_CAPABLE,
      });
      const currentMarket = createBeliefReversalRegistryGroundedLiveMarketService({
        sourceUrl: "http://127.0.0.1:43123/__fixture/market",
        sourceRegistry: dataRuntime.sourceRegistry,
        workspaceId: dataRuntime.workspaceId,
        fetchImpl: async (request) => {
          const url = new URL(String(request));
          assert.equal(url.protocol, "http:");
          assert.equal(url.hostname, "127.0.0.1");
          assert.equal(url.pathname, "/__fixture/market");
          const collectedAt = url.searchParams.get("to");
          assert.ok(collectedAt);
          return Response.json(buildBeliefReversalLiveMarketPackets({
            collectedAt,
          }));
        },
      });
      const currentRuntime = await createBeliefReversalProcessRuntime({
        target: pipelineTarget,
        workspaceId: dataRuntime.workspaceId,
        dataStore: dataRuntime.dataStore,
        market: currentMarket,
        fetchImpl: repositoryFetch,
        now: () => new Date("2026-08-03T12:00:00.000Z"),
      });
      const currentPipeline = await runBeliefReversalCurrentColdPass({
        target: pipelineTarget,
        workspaceId: dataRuntime.workspaceId,
        runtime: currentRuntime,
        fetchImpl: repositoryFetch,
        expectedCurrentOutcomes: BELIEF_REVISION_CAPABLE,
      });
      const common = {
        url: infrastructure.target.postgrestUrl,
        serviceRoleKey: infrastructure.serviceRoleJwt,
        fetchImpl: repositoryFetch,
      };
      const intelligence = createSupabaseIntelligenceRepository({
        ...common,
        now: () => new Date("2026-08-03T12:00:00.000Z"),
        dealRegistry: dataRuntime.dealRegistry,
      });
      const underwritingRuns = createSupabaseUnderwritingRunsRepository(common);
      const underwritingArtifacts =
        createSupabaseUnderwritingArtifactsRepository(common);
      const runs = createRunsRepository(createSupabaseDataClient(common));
      let loopbackRateLimitCalls = 0;
      const routeDependencies: RouteDependencies = {
        async resolveRequestContext() {
          return {
            mode: "public_sandbox",
            principal: {
              userId: "system:belief-reversal-task12-e2e",
              email: "belief-reversal-task12-e2e@invalid.local",
            },
            workspaceId: dataRuntime.workspaceId,
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
        intelligence,
        runs,
        underwritingRuns,
        underwritingArtifacts,
        sourceRegistry: dataRuntime.sourceRegistry,
        async rateLimitRequest(request, scope, limit, windowMs, options) {
          loopbackRateLimitCalls += 1;
          const rateLimitUrl = new URL(
            infrastructure.environment.SUPABASE_URL,
          );
          assert.equal(rateLimitUrl.protocol, "http:");
          assert.equal(rateLimitUrl.hostname, "127.0.0.1");
          assert.equal(rateLimitUrl.origin, infrastructure.target.postgrestUrl);
          return rateLimitRequest(request, scope, limit, windowMs, {
            ...options,
            environment: infrastructure.environment,
            fetchImpl: repositoryFetch,
          });
        },
      };
      const reportId = pipeline.first.report.id;
      const runId = pipeline.first.run.id;
      const currentReportId = currentPipeline.report.id;
      const currentReportVerification = verifyBeliefReversalCurrentColdReport(
        await readSuccessfulRoute(
          "Current 30-Deal Report read route",
          readReportRoute(
            new Request(`https://vsee.test/api/reports/${currentReportId}`),
            { params: Promise.resolve({ id: currentReportId }) },
            routeDependencies,
          ),
        ),
        BELIEF_REVISION_CAPABLE,
      );
      const isolationCounters = async () => {
        const provider = pipeline.readProviderInspection();
        const persistent = await readBeliefReversalIsolationPersistentCounts({
          target: {
            databaseName,
            postgresVersion: infrastructure.target.postgresVersion,
            postgrestUrl: infrastructure.target.postgrestUrl,
            postgrestVersion: infrastructure.target.postgrestVersion,
            serviceRoleKey: infrastructure.serviceRoleJwt,
          },
          workspaceId: dataRuntime.workspaceId,
          fetchImpl: repositoryFetch,
        });
        return {
          liveMarketCalls: pipeline.readLiveMarketCalls(),
          xtrace: provider.xtrace,
          model: provider.claude,
          durable: {
            scanRuns: persistent.scanRuns,
            scanRunSteps: persistent.scanRunSteps,
            sourceRevisions: persistent.sourceRevisions,
            sampleInteractions: persistent.sampleInteractions,
            reasonerJudgments: persistent.reasonerJudgments,
            xtraceIngestIntents: persistent.xtraceIngestIntents,
            xtraceMemoryLinks: persistent.xtraceMemoryLinks,
          },
          route: {
            rateLimitCalls: loopbackRateLimitCalls,
            rateLimitDbRequests: persistent.rateLimitRequests,
            remoteNetworkAttempts,
          },
        };
      };
      let finalizedChatRequestIndex = 0;
      const verified = await verifyBeliefReversalReportsAndChat({
        workspaceId: dataRuntime.workspaceId,
        reportId,
        runId,
        readReport: () => readSuccessfulRoute(
          "Report read route",
          readReportRoute(
            new Request(`https://vsee.test/api/reports/${reportId}`),
            { params: Promise.resolve({ id: reportId }) },
            routeDependencies,
          ),
        ),
        readUnderwritingDetail: ({ reportId: requestedReportId, dealId }) =>
          readSuccessfulRoute(
            `Underwriting read route for ${dealId}`,
            readUnderwritingRoute(
              new Request(
                `https://vsee.test/api/reports/${requestedReportId}/underwriting/${dealId}`,
              ),
              {
                params: Promise.resolve({
                  id: requestedReportId,
                  dealId,
                }),
              },
              routeDependencies,
            ),
          ),
        readArtifact: (request) =>
          underwritingArtifacts.getByCandidateRunId(request),
        readActionDrafts: ({ candidateRunId }) => readSuccessfulRoute(
          `Action Draft read route for ${candidateRunId}`,
          readActionDraftsRoute(
            new Request(
              `https://vsee.test/api/action-drafts?candidateRunId=${candidateRunId}`,
            ),
            undefined,
            routeDependencies,
          ),
        ),
        resolveSourceRevision: ({ workspaceId, sourceRevisionId }) =>
          dataRuntime.sourceRegistry.getRevision({
            workspaceId,
            revisionId: sourceRevisionId,
          }),
        askFinalizedChat: ({ question, ...scope }) => readSuccessfulRoute(
          `Finalized Chat route for ${scope.dealId}`,
          askChatRoute(new Request("https://vsee.test/api/chat", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-forwarded-for":
                `198.51.100.${100 + finalizedChatRequestIndex++}`,
            },
            body: JSON.stringify({ question, ...scope }),
          }), undefined, routeDependencies),
        ),
        readIsolationCounters: isolationCounters,
      });

      assert.deepEqual(seeded.finalState.counts, {
        companies: 30,
        deals: 30,
        analysisEligibleDeals: 30,
        sourceDocuments: 80,
        sourceRevisions: 80,
        workspaceDocuments: 79,
        activeAssignments: 85,
        legacyEvidence: 19,
        canonicalEvidence: 66,
        sampleInteractions: 23,
        sampleResearchScreeningDocuments: 7,
        researchCandidates: 7,
        researchSourceAssignments: 25,
        researchEvidenceGaps: 1,
      });
      assert.deepEqual(
        pipeline.first.cases.map((item) => ({
          rank: item.rank,
          dealId: item.dealId,
          direction: item.direction,
          actions: item.actions,
          terminal: item.candidateStatus,
        })),
        pipeline.replay.cases.map((item) => ({
          rank: item.rank,
          dealId: item.dealId,
          direction: item.direction,
          actions: item.actions,
          terminal: item.candidateStatus,
        })),
      );
      assert.equal(pipeline.first.cases.length, 4);
      assert.equal(pipeline.first.report.companyAnalyses.length, 30);
      assert.equal(currentPipeline.report.companyAnalyses.length, 30);
      assert.equal(
        currentPipeline.cases.length,
        currentPipeline.report.counts.beliefRevised,
      );
      assert.equal(
        currentPipeline.candidates.length,
        currentPipeline.report.counts.beliefRevised,
      );
      assert.equal(currentReportVerification.screeningNonRevisingCount, 7);
      assert.equal(
        currentReportVerification.priorityOrder.length,
        currentPipeline.report.counts.beliefRevised,
      );
      assert.equal(pipeline.first.cases.every(({ gates }) =>
        gates.allPassed
      ), true);
      assert.equal(pipeline.liveMarketCalls, 0);
      assert.deepEqual(pipeline.replayDeltas.delta, {
        reasonerJudgments: 0,
        xtraceIngestIntents: 0,
        xtraceMemoryLinks: 0,
      });
      const replayProviderDelta = {
        ingestCalls:
          pipeline.providersAfterReplay.xtrace.ingestCalls
          - pipeline.providersAfterFirst.xtrace.ingestCalls,
        deleteCalls:
          pipeline.providersAfterReplay.xtrace.deleteCalls
          - pipeline.providersAfterFirst.xtrace.deleteCalls,
        exactParentCount:
          pipeline.providersAfterReplay.xtrace.exactParentCount
          - pipeline.providersAfterFirst.xtrace.exactParentCount,
        memoryCount:
          pipeline.providersAfterReplay.xtrace.memoryCount
          - pipeline.providersAfterFirst.xtrace.memoryCount,
        matchingCalls:
          pipeline.providersAfterReplay.claude.matchingCalls
          - pipeline.providersAfterFirst.claude.matchingCalls,
        frameworkCalls:
          pipeline.providersAfterReplay.claude.frameworkCalls
          - pipeline.providersAfterFirst.claude.frameworkCalls,
        unexpectedCalls:
          pipeline.providersAfterReplay.claude.unexpectedCalls
          - pipeline.providersAfterFirst.claude.unexpectedCalls,
      };
      const {
        frameworkCalls: replayFrameworkCalls,
        ...reusedProviderDelta
      } = replayProviderDelta;
      assert.deepEqual(reusedProviderDelta, {
        ingestCalls: 0,
        deleteCalls: 0,
        exactParentCount: 0,
        memoryCount: 0,
        matchingCalls: 0,
        unexpectedCalls: 0,
      });
      assert.ok(pipeline.providersAfterFirst.claude.frameworkCalls > 0);
      assert.equal(
        replayFrameworkCalls,
        pipeline.providersAfterFirst.claude.frameworkCalls,
        "A new run-scoped Candidate must execute the same bounded framework matrix.",
      );
      const compareText = (left: string, right: string) =>
        Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
      const frameworkSemantics = (
        artifacts: typeof pipeline.first.artifacts,
      ) => artifacts.map((artifact) => {
        const cardByJudgmentId = new Map(artifact.judgments.map((judgment) => [
          judgment.id,
          judgment.frameworkCardId,
        ]));
        const judgments = artifact.judgments.map((judgment) => ({
          analysisType: judgment.analysisType,
          frameworkCardId: judgment.frameworkCardId,
          frameworkVersion: judgment.frameworkVersion,
          applicability: judgment.applicability,
          conclusion: judgment.conclusion,
          supportEvidenceItemIds: judgment.supportEvidenceItemIds,
          counterEvidenceItemIds: judgment.counterEvidenceItemIds,
          unusedEvidenceItemIds: judgment.unusedEvidenceItemIds,
          strongestSupport: judgment.strongestSupport,
          strongestCounterargument: judgment.strongestCounterargument,
          unknowns: judgment.unknowns,
          limitations: judgment.limitations,
          confidence: judgment.confidence,
          claimDependencies: judgment.claimEdges.map((edge) => ({
            dependencyItemId: edge.dependencyItemId,
            dependencyType: edge.dependencyType,
          })).sort((left, right) => compareText(
            `${left.dependencyItemId}\0${left.dependencyType}`,
            `${right.dependencyItemId}\0${right.dependencyType}`,
          )),
          frameworkMetadata: judgment.frameworkMetadata ?? null,
        })).sort((left, right) => compareText(
          `${left.frameworkCardId}\0${left.frameworkVersion}`,
          `${right.frameworkCardId}\0${right.frameworkVersion}`,
        ));
        const disagreements = artifact.disagreements.map((disagreement) => {
          const leftFrameworkCardId =
            cardByJudgmentId.get(disagreement.leftJudgmentId);
          const rightFrameworkCardId =
            cardByJudgmentId.get(disagreement.rightJudgmentId);
          if (!leftFrameworkCardId || !rightFrameworkCardId) {
            throw new Error(
              `Pinned replay disagreement does not resolve to framework Cards for ${artifact.dealId}.`,
            );
          }
          return {
            leftFrameworkCardId,
            rightFrameworkCardId,
            topic: disagreement.topic,
            explanation: disagreement.explanation,
            evidenceItemIds: disagreement.evidenceItemIds,
          };
        }).sort((left, right) => compareText(
          `${left.topic}\0${left.leftFrameworkCardId}\0${left.rightFrameworkCardId}`,
          `${right.topic}\0${right.leftFrameworkCardId}\0${right.rightFrameworkCardId}`,
        ));
        return {
          dealId: artifact.dealId,
          judgments,
          disagreements,
        };
      }).sort((left, right) => compareText(left.dealId, right.dealId));
      assert.deepEqual(
        frameworkSemantics(pipeline.replay.artifacts),
        frameworkSemantics(pipeline.first.artifacts),
        "Pinned replay changed finalized framework judgment semantics.",
      );
      assert.deepEqual(
        verified.ranking.map(({ rank, dealId, score, confidence }) => ({
          rank,
          dealId,
          score,
          confidence,
        })),
        pipeline.first.cases.map(({ rank, dealId, score, confidence }) => ({
          rank,
          dealId,
          score,
          confidence,
        })),
      );
      assert.equal(verified.chatQueryCount, 13);
      assert.equal(verified.namedLensChatTopics.length, 4);
      assert.equal(verified.namedLensChatDealIds.length, 4);
      assert.equal(verified.namedLensChatPairCount, 4);
      assert.equal(loopbackRateLimitCalls, verified.chatQueryCount);
      assert.equal(verified.hushInvestedActionVerified, true);
      assert.equal(verified.hushResearchActionCrosswalkVerified, true);
      assert.equal(verified.irregularInvestedActionVerified, true);
      assert.equal(verified.isolationCountersUnchanged, true);
      const stateAfterReadVerification = await dataRuntime.readState();
      assert.equal(
        stateAfterReadVerification.counts.sourceRevisions,
        seeded.finalState.counts.sourceRevisions,
      );
      assert.equal(
        stateAfterReadVerification.counts.sampleInteractions,
        seeded.finalState.counts.sampleInteractions,
      );
      context.diagnostic(
        `disposable database=${databaseName} terminal=${migrationPlan.terminal.tag} pinnedRun=${runId} pinnedReport=${reportId} currentRun=${currentPipeline.run.id} currentReport=${currentReportId} candidateIds=${JSON.stringify(pipeline.first.candidates.map(({ id, dealId, status }) => ({ id, dealId, status })))} counts=${JSON.stringify(seeded.finalState.counts)} ranking=${JSON.stringify(pipeline.first.cases.map(({ rank, dealId, score, confidence }) => ({ rank, dealId, score, confidence })))} chatQueries=${verified.chatQueryCount} resolvedSourceRevisions=${verified.resolvedSourceRevisionIds.length}`,
      );
    } finally {
      await infrastructure.cleanup();
    }
  },
);
