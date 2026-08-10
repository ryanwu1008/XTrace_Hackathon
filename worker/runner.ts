import { hostname } from "node:os";

import { getDataClient } from "../db/client";
import { getIntelligenceRepository } from "../db/repositories/intelligence";
import { getReasonerJudgmentsRepository } from "../db/repositories/reasoner-judgments";
import { getDealRegistry } from "../db/repositories/deal-registry";
import { getEvidencePacksRepository } from "../db/repositories/evidence-packs";
import { getSourceRegistry } from "../db/repositories/source-registry";
import {
  createMemoryUnderwritingCandidateLeaseAuthority,
  createMemoryUnderwritingRunsRepository,
  createSupabaseUnderwritingRunsRepository,
} from "../db/repositories/underwriting-runs";
import {
  createMemoryUnderwritingArtifactsRepository,
  type MemoryUnderwritingArtifactsRepository,
} from "../db/repositories/underwriting-artifacts";
import {
  createMemoryNamedLensArtifactsRepository,
  createSupabaseNamedLensArtifactsRepository,
  type NamedLensArtifactsRepository,
} from "../db/repositories/named-lens-artifacts";
import type { EvidencePacksRepository } from
  "../db/repositories/evidence-packs";
import {
  getUnderwritingReferencesRepository,
} from "../db/repositories/underwriting-references";
import { createRunsRepository } from "../db/repositories/runs";
import { getUploadedDocumentsRepository } from "../db/repositories/uploaded-documents";
import { createDefaultPrivateObjectStorage } from "../lib/storage/service";
import {
  extractUploadPreview,
  processClaimedUpload,
} from "./extract-upload";
import { getXTraceLineageRepository } from "../db/repositories/xtrace-lineage";
import { createClaudeClient } from "../lib/claude/client";
import { createClaudeMatchingReasoner } from "../lib/matching/claude-reasoner";
import {
  createContextAwareFrameworkLensResolver,
} from "../lib/underwriting/frameworks/service";
import {
  createSourceGroundedCandidateExecutor,
  createUnderwritingOrchestrator,
  UNDERWRITING_ADMISSION_POLICY_VERSION,
  UNDERWRITING_REFRESH_SEMANTICS_VERSION,
} from "../lib/underwriting/orchestrator";
import {
  createEvidencePackCandidateGrounding,
} from "../lib/underwriting/candidate-grounding";
import {
  createEvidencePackBuilder,
} from "../lib/underwriting/evidence/builder";
import { createContextRouter } from "../lib/underwriting/router";
import {
  SLICE_ONE_CONTEXTS,
  SYNTHETIC_US_SOFTWARE_BENCHMARK_PACK_ID,
} from "../seed/underwriting/slice-one-contexts-v1";
import {
  SYNTHETIC_FRAMEWORK_PACK,
} from "../seed/underwriting/framework-pack-v1";
import { DECISION_POLICY_V1 } from "../lib/underwriting/decision/rules";
import {
  DECISION_TAXONOMY_DIGEST,
  DECISION_TAXONOMY_VERSION,
} from "../lib/underwriting/frameworks/decision-taxonomy";
import {
  CURRENT_FRAMEWORK_LENS_PASSAGE_CONTRACT,
} from "../lib/underwriting/frameworks/passage-contract";
import {
  NAMED_LENS_GENERATOR_VERSION,
  NAMED_LENS_PASSAGE_SCHEMA_VERSION,
  NAMED_LENS_SELECTION_POLICY_VERSION,
  UNDERWRITING_PRESENTATION_SCHEMA_VERSION,
} from "../lib/contracts/named-lens";
import { ACTION_DRAFT_POLICY_VERSION } from
  "../lib/contracts/underwriting";
import { BELIEF_ACTION_POLICY_VERSION } from
  "../lib/reports/action-policy";
import {
  SEMANTIC_CONTEXT_ASSUMPTION_POLICY_VERSION,
  SEMANTIC_CONTEXT_MAPPING_VERSION,
} from "../lib/underwriting/evidence/semantic-projector";
import { CONTEXT_ROUTER_VERSION } from "../lib/underwriting/router";
import {
  DECISION_CRITICAL_EVIDENCE_PROJECTION_FINGERPRINT_VERSION,
  NAMED_LENS_FINAL_DISPOSITIONS_FINGERPRINT_VERSION,
  NAMED_LENS_PRESENTATION_FINGERPRINT_VERSION,
  NAMED_LENS_RENDERER_VERSION,
} from "../lib/underwriting/named-lens-presentation";
import { CURRENT_NAMED_LENS_PROVIDER_TIMEOUT_POLICY } from
  "../lib/underwriting/frameworks/timeout-policy";
import {
  createCanonicalFingerprint,
  createReferenceCatalogSnapshot,
} from "../lib/underwriting/fingerprints";
import { createProductInputGate } from "../lib/corpus/import-readiness";
import { readMarketProviderConfiguration } from "../lib/market/config";
import { createDefaultMarketProviders } from "../lib/market/providers";
import { createMarketService } from "../lib/market/service";
import {
  getXTraceClient,
  isXTraceConfigured,
} from "../lib/xtrace/client";
import { createXTraceService } from "../lib/xtrace/service";
import { createExactXTraceParentUnit } from "../lib/xtrace/exact-parent-planner";
import { createDefaultDemoDataStore } from "../lib/storage/service";
import {
  workerHealthFilePath,
  writeWorkerHealthMarker,
} from "./health";
import { processClaimedRun } from "./process-run";
import { processConfirmedSource } from "./ingest-confirmed-source";

const WORKER_ID = process.env.WORKER_ID?.trim()
  || `worker-${hostname()}-${process.pid}`;
const WORKER_HEALTH_FILE = workerHealthFilePath();
const POLL_INTERVAL_MS = 2_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
let queueCursor = 0;

const CURRENT_CANDIDATE_STAGE_DAG = [
  "context_router",
  "evidence_pack",
  "valuation",
  "framework_catalog",
  "framework_lenses",
  "decision",
  "named_lens_presentation",
  "narrative_drafts",
  "finalization",
] as const;

export interface WorkerCandidateExecutionConfiguration {
  providerModel: string;
  promptVersion: string;
  schemaVersion: string;
  settingsFingerprint: string;
  applicationCommit: string;
}

const INVALID_APPLICATION_COMMIT_IDENTITIES = new Set([
  "development",
  "local-development",
  "none",
  "null",
  "unknown",
  "unavailable",
]);

export function resolveWorkerApplicationCommit(
  environment: Record<string, string | undefined> = process.env,
): string {
  const applicationCommit = (
    environment.APPLICATION_COMMIT?.trim()
    || environment.RAILWAY_GIT_COMMIT_SHA?.trim()
  );
  if (
    !applicationCommit
    || INVALID_APPLICATION_COMMIT_IDENTITIES.has(applicationCommit.toLowerCase())
  ) {
    throw new Error(
      "Worker commit identity is unavailable or a shared placeholder; set APPLICATION_COMMIT explicitly before starting the Worker.",
    );
  }
  return applicationCommit;
}

export function createWorkerCandidateExecutionContract(
  input: WorkerCandidateExecutionConfiguration,
) {
  return {
    kind: "source-grounded-candidate-executor-v4",
    stageDag: CURRENT_CANDIDATE_STAGE_DAG,
    admissionPolicyVersion: UNDERWRITING_ADMISSION_POLICY_VERSION,
    refreshSemanticsVersion: UNDERWRITING_REFRESH_SEMANTICS_VERSION,
    contextRouterVersion: CONTEXT_ROUTER_VERSION,
    evidencePackBuilderVersion: "evidence_pack_builder_v2",
    decisionPolicyVersion: DECISION_POLICY_V1.version,
    beliefPolicies: {
      actionPolicyVersion: BELIEF_ACTION_POLICY_VERSION,
      draftPolicyVersion: ACTION_DRAFT_POLICY_VERSION,
      semanticContextAssumptionPolicyVersion:
        SEMANTIC_CONTEXT_ASSUMPTION_POLICY_VERSION,
      semanticContextMappingVersion: SEMANTIC_CONTEXT_MAPPING_VERSION,
    },
    frameworkLensPassageContract:
      CURRENT_FRAMEWORK_LENS_PASSAGE_CONTRACT,
    namedLens: {
      selectionPolicyVersion: NAMED_LENS_SELECTION_POLICY_VERSION,
      passageSchemaVersion: NAMED_LENS_PASSAGE_SCHEMA_VERSION,
      generatorVersion: NAMED_LENS_GENERATOR_VERSION,
      presentationSchemaVersion:
        UNDERWRITING_PRESENTATION_SCHEMA_VERSION,
      rendererVersion: NAMED_LENS_RENDERER_VERSION,
      decisionTaxonomyVersion: DECISION_TAXONOMY_VERSION,
      decisionTaxonomyDigest: DECISION_TAXONOMY_DIGEST,
      semanticFingerprintVersions: {
        criticalEvidenceProjection:
          DECISION_CRITICAL_EVIDENCE_PROJECTION_FINGERPRINT_VERSION,
        finalDispositions:
          NAMED_LENS_FINAL_DISPOSITIONS_FINGERPRINT_VERSION,
        presentation: NAMED_LENS_PRESENTATION_FINGERPRINT_VERSION,
      },
      advisoryProviderTimeoutPolicy:
        CURRENT_NAMED_LENS_PROVIDER_TIMEOUT_POLICY,
    },
    execution: input,
  } as const;
}

export function createWorkerCandidateExecutionFingerprint(
  input: WorkerCandidateExecutionConfiguration,
): string {
  return createCanonicalFingerprint(
    createWorkerCandidateExecutionContract(input),
  );
}

interface WorkerIterationDependencies {
  runNext?: () => Promise<boolean>;
  sleepImpl?: (milliseconds: number) => Promise<void>;
  onError?: (message: string) => void;
}

export async function runNextQueuedScan(): Promise<boolean> {
  const runs = createRunsRepository(getDataClient());
  await runs.touchWorkerHeartbeat(WORKER_ID);
  await writeWorkerHealthMarker(WORKER_HEALTH_FILE);
  const claimed = await runs.claimNext(WORKER_ID);
  if (!claimed) return false;

  const heartbeat = setInterval(() => {
    void Promise.all([
      runs.touchWorkerHeartbeat(WORKER_ID),
      runs.renewLease(claimed.workspaceId, claimed.id, WORKER_ID),
    ]).then(async ([, leaseRenewed]) => {
      if (!leaseRenewed) {
        throw new Error(`Worker no longer owns scan ${claimed.id}`);
      }
      await writeWorkerHealthMarker(WORKER_HEALTH_FILE);
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[${WORKER_ID}] heartbeat failed: ${message}`);
    });
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  try {
    const marketConfiguration = readMarketProviderConfiguration();
    const providers = createDefaultMarketProviders(
      marketConfiguration.options,
      marketConfiguration.runtime,
    );
    const intelligence = getIntelligenceRepository();
    const dealRegistry = getDealRegistry();
    const claude = createClaudeClient();
    const references = getUnderwritingReferencesRepository();
    const lineage = getXTraceLineageRepository();
    const evidenceRepository = getEvidencePacksRepository();
    const underwritingPersistence = createWorkerUnderwritingPersistence({
      evidencePacks: evidenceRepository,
      url: process.env.SUPABASE_URL,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    });
    const underwritingRuns = underwritingPersistence.runs;
    const sourceRegistry = getSourceRegistry();
    const router = createContextRouter();
    const criticalEvidenceProfiles = (
      await Promise.all(
        SLICE_ONE_CONTEXTS.map((context) =>
          references.getCriticalEvidenceProfile(
            context.criticalEvidenceProfileId,
          )
        ),
      )
    ).filter((profile) => profile !== null);
    const referenceAsOfDate = claimed.createdAt.slice(0, 10);
    const benchmarks = (
      await Promise.all(
        (["seed", "series_a"] as const).map((stage) =>
          references.getSelectedBenchmark({
            packId: SYNTHETIC_US_SOFTWARE_BENCHMARK_PACK_ID,
            stage,
            asOfDate: referenceAsOfDate,
          })
        ),
      )
    ).filter((benchmark) => benchmark !== null);
    const referenceCatalog = createReferenceCatalogSnapshot([
      ...criticalEvidenceProfiles.map((profile) => ({
        kind: "critical_evidence_profile" as const,
        id: profile.id,
        version: profile.version,
        definitionFingerprint: profile.definitionFingerprint,
      })),
      ...benchmarks.map((benchmark) => ({
        kind: "benchmark_definition" as const,
        id: benchmark.entryId,
        parentId: benchmark.packId,
        version: benchmark.version,
        definitionFingerprint: benchmark.definitionFingerprint,
      })),
      ...SLICE_ONE_CONTEXTS.map((context) => ({
        kind: "valuation_method_policy" as const,
        id: context.valuationMethodPolicyId,
        version: "1",
        definitionFingerprint: createCanonicalFingerprint({
          id: context.valuationMethodPolicyId,
          version: "1",
          stage: context.stage,
          businessModel: context.businessModel,
          methods: [
            "venture_method",
            "market_comps",
            "ownership_return",
          ],
        }),
      })),
      ...SLICE_ONE_CONTEXTS.map((context) => ({
        kind: "decision_policy" as const,
        id: context.decisionPolicyId,
        version: "1",
        definitionFingerprint: createCanonicalFingerprint({
          ...DECISION_POLICY_V1,
          id: context.decisionPolicyId,
        }),
      })),
      {
        kind: "framework_pack",
        id: SYNTHETIC_FRAMEWORK_PACK.id,
        version: SYNTHETIC_FRAMEWORK_PACK.version,
        definitionFingerprint:
          createCanonicalFingerprint(SYNTHETIC_FRAMEWORK_PACK),
      },
    ]);
    const grounding = createEvidencePackCandidateGrounding({
      repository: evidenceRepository,
      sourceRegistry,
      criticalEvidenceProfiles,
      builder: createEvidencePackBuilder({
        repository: evidenceRepository,
        sourceRegistry,
        router,
        criticalEvidenceProfiles,
      }),
      xtraceLineage: lineage,
      resolveBenchmark: (context) => context.benchmarkPackId
        ? references.getSelectedBenchmark({
            packId: context.benchmarkPackId,
            stage: context.stage,
            asOfDate: context.asOfDate,
          })
        : Promise.resolve(null),
    });
    const model = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";
    const frameworkExecution = {
      providerModel: model,
      promptVersion: "framework-lens-v1",
      schemaVersion: "framework-judgment-v1",
      settingsFingerprint: "balanced-underwriting-v1",
      applicationCommit: resolveWorkerApplicationCommit(),
    };
    const frameworkLenses = createContextAwareFrameworkLensResolver({
      client: claude,
      execution: {
        provider: "anthropic",
        model,
        promptVersion: frameworkExecution.promptVersion,
        schemaVersion: frameworkExecution.schemaVersion,
        settingsFingerprint: frameworkExecution.settingsFingerprint,
        applicationCommit: frameworkExecution.applicationCommit,
      },
    });
    const underwriting = createUnderwritingOrchestrator({
      runs: underwritingRuns,
      namedLensArtifacts: underwritingPersistence.namedLensArtifacts,
      activeFundPolicy: (workspaceId) =>
        references.activeFundPolicy(workspaceId),
      candidateExecutionFingerprint:
        createWorkerCandidateExecutionFingerprint(frameworkExecution),
      referenceCatalog,
      candidateExecutor: createSourceGroundedCandidateExecutor({
        grounding,
        resolveFrameworkLenses: (context, signal) =>
          frameworkLenses.resolve(context, signal),
        execution: {
          ...frameworkExecution,
        },
      }),
    });
    const xtraceService = isXTraceConfigured()
      ? createXTraceService(getXTraceClient({
          stage: "explicit_recall",
          allowLive: true,
        }), {
          workspaceId: claimed.workspaceId,
          lineageRepository: lineage,
        })
      : undefined;
    const xtrace = xtraceService
      ? {
          listOpenIngestJobs: (workspaceId: string) =>
            lineage.listOpenJobs(workspaceId),
          pollIngestJob: (
            jobId: string,
            options: { dealId: string },
          ) => xtraceService.pollIngestJob(jobId, options),
          recallDealContext: (
            input: Parameters<typeof xtraceService.recallDealContext>[0],
          ) => xtraceService.recallDealContext(input),
        }
      : undefined;
    await processClaimedRun(claimed, {
      runs,
      intelligence,
      dealRegistry,
      underwriting,
      importGate: createProductInputGate(createDefaultDemoDataStore()),
      market: createMarketService({ providers }),
      reasoner: createClaudeMatchingReasoner(claude, {
        judgments: getReasonerJudgmentsRepository(),
        refreshJudgments: process.env.REASONER_JUDGMENT_REFRESH === "1",
      }),
      xtrace,
    });
  } catch (error) {
    const current = await runs.get(claimed.workspaceId, claimed.id);
    if (current?.status === "running" && current.workerId === WORKER_ID) {
      await runs.finish({
        workspaceId: claimed.workspaceId,
        runId: claimed.id,
        status: "failed",
        workerId: WORKER_ID,
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${WORKER_ID}] scan ${claimed.id} failed: ${message}`);
  } finally {
    clearInterval(heartbeat);
    try {
      await runs.touchWorkerHeartbeat(WORKER_ID);
      await writeWorkerHealthMarker(WORKER_HEALTH_FILE);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[${WORKER_ID}] final heartbeat failed: ${message}`);
    }
  }
  return true;
}

export function createWorkerUnderwritingPersistence(input: {
  evidencePacks: EvidencePacksRepository;
  url?: string;
  serviceRoleKey?: string;
  fetchImpl?: typeof fetch;
}): {
  runs: ReturnType<typeof createMemoryUnderwritingRunsRepository>
    | ReturnType<typeof createSupabaseUnderwritingRunsRepository>;
  namedLensArtifacts: NamedLensArtifactsRepository;
  underwritingArtifacts: MemoryUnderwritingArtifactsRepository | null;
} {
  if (input.url && input.serviceRoleKey) {
    const namedLensArtifacts = createSupabaseNamedLensArtifactsRepository({
      url: input.url,
      serviceRoleKey: input.serviceRoleKey,
      fetchImpl: input.fetchImpl,
    });
    return {
      namedLensArtifacts,
      underwritingArtifacts: null,
      runs: createSupabaseUnderwritingRunsRepository({
        url: input.url,
        serviceRoleKey: input.serviceRoleKey,
        fetchImpl: input.fetchImpl,
        namedLensArtifacts,
      }),
    };
  }
  const candidateLeaseAuthority =
    createMemoryUnderwritingCandidateLeaseAuthority();
  const namedLensArtifacts = createMemoryNamedLensArtifactsRepository({
    candidateLeaseAuthority,
  });
  const underwritingArtifacts = createMemoryUnderwritingArtifactsRepository({
    namedLensArtifacts,
  });
  return {
    namedLensArtifacts,
    underwritingArtifacts,
    runs: createMemoryUnderwritingRunsRepository({
      evidencePacks: input.evidencePacks,
      artifacts: underwritingArtifacts,
      namedLensArtifacts,
      candidateLeaseAuthority,
    }),
  };
}

// Uploaded documents are staged here for explicit confirmation. They never
// join the fixed corpus or create a Deal/XTrace record during extraction.
export async function runNextQueuedUpload(): Promise<boolean> {
  const uploads = getUploadedDocumentsRepository();
  const claimed = await uploads.claimNext(WORKER_ID);
  if (!claimed) return false;
  const leaseHeartbeat = setInterval(() => {
    void uploads.renewLease({
      workspaceId: claimed.workspaceId,
      id: claimed.id,
      workerId: claimed.workerId,
      leaseToken: claimed.leaseToken,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[${WORKER_ID}] upload lease renewal failed: ${message}`);
    });
  }, 60_000);
  leaseHeartbeat.unref();

  try {
    const bytes = await createDefaultPrivateObjectStorage()
      .readPrivateObject(claimed.objectKey);
    if (!bytes) throw new Error("The uploaded file is no longer readable.");

    const claude = createClaudeClient();
    await processClaimedUpload(claimed, {
      extract: () => extractUploadPreview({
        record: claimed,
        bytes,
        client: claude,
      }),
      savePreview: (input) => uploads.savePreview(input),
    });
    console.log(
      `[${WORKER_ID}] extracted upload ${claimed.id} for confirmation`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const transitioned = await uploads.fail({
      workspaceId: claimed.workspaceId,
      id: claimed.id,
      workerId: claimed.workerId,
      leaseToken: claimed.leaseToken,
      reason: message,
    });
    if (!transitioned) console.error(`[${WORKER_ID}] upload ${claimed.id} claim was lost before failure transition`);
    console.error(`[${WORKER_ID}] upload ${claimed.id} failed: ${message}`);
  } finally {
    clearInterval(leaseHeartbeat);
  }
  return true;
}

export async function runNextConfirmedUpload(): Promise<boolean> {
  const uploads = getUploadedDocumentsRepository();
  const claimed = await uploads.claimNextConfirmed(WORKER_ID);
  if (!claimed) return false;
  const leaseHeartbeat = setInterval(() => {
    void uploads.renewLease({
      workspaceId: claimed.workspaceId,
      id: claimed.id,
      workerId: claimed.workerId,
      leaseToken: claimed.leaseToken,
    }).then((renewed) => {
      if (!renewed) {
        throw new Error(
          `Worker no longer owns confirmed upload ${claimed.id}`,
        );
      }
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[${WORKER_ID}] confirmed upload lease renewal failed: ${message}`,
      );
    });
  }, 60_000);
  leaseHeartbeat.unref();
  try {
    const deals = getDealRegistry();
    const sources = getSourceRegistry();
    const evidencePacks = getEvidencePacksRepository();
    const xtrace = isXTraceConfigured()
      ? createXTraceService(getXTraceClient({
        stage: "explicit_ingest",
        allowLive: true,
      }), {
        workspaceId: claimed.workspaceId,
        lineageRepository: getXTraceLineageRepository(),
      })
      : null;
    const result = await processConfirmedSource(claimed, {
      loadExactParent: async (upload) => {
        const identity = {
          workspaceId: upload.workspaceId,
          dealId: upload.dealId!,
          sourceId: upload.sourceId!,
          sourceRevisionId: upload.sourceRevisionId!,
        };
        const [exact, revision] = await Promise.all([
          deals.getExactSourceBundle(identity),
          sources.getRevision({
            workspaceId: upload.workspaceId,
            revisionId: upload.sourceRevisionId!,
          }),
        ]);
        return exact && revision
          ? createExactXTraceParentUnit(exact, revision)
          : null;
      },
      loadCanonicalEvidence: (upload) =>
        evidencePacks.listSourceEvidence({
          workspaceId: upload.workspaceId,
          dealId: upload.dealId!,
          sourceRevisionIds: [upload.sourceRevisionId!],
        }),
      ...(xtrace
        ? {
          ingestExactParent: xtrace.ingestExactParent,
          pollExactIntent: xtrace.pollExactIntent,
        }
        : {}),
      complete: (input) => uploads.completeConfirmed(input),
      fail: (input) => uploads.failConfirmed(input),
    });
    if (result.kind === "ready_without_xtrace_memory") {
      console.log(
        `[${WORKER_ID}] confirmed image upload ${claimed.id} is ready `
          + "from canonical evidence; no XTrace memory was created",
      );
    } else {
      console.log(
        `[${WORKER_ID}] ingested confirmed upload ${claimed.id}`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const current = await uploads.get({
      workspaceId: claimed.workspaceId,
      id: claimed.id,
    });
    if (current?.status === "ingesting_memory") {
      await uploads.failConfirmed({
        workspaceId: claimed.workspaceId,
        id: claimed.id,
        workerId: claimed.workerId,
        leaseToken: claimed.leaseToken,
        reason: "Memory ingestion failed. Retry is available.",
      });
    }
    console.error(
      `[${WORKER_ID}] confirmed upload ${claimed.id} failed: ${message}`,
    );
  } finally {
    clearInterval(leaseHeartbeat);
  }
  return true;
}

export async function runWorkerIteration(
  dependencies: WorkerIterationDependencies = {},
): Promise<void> {
  const runNext = dependencies.runNext
    ?? runNextFairQueue;
  const sleepImpl = dependencies.sleepImpl ?? sleep;
  try {
    const handled = await runNext();
    if (!handled) await sleepImpl(POLL_INTERVAL_MS);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const onError = dependencies.onError
      ?? ((detail: string) =>
        console.error(`[${WORKER_ID}] worker loop failed: ${detail}`));
    onError(message);
    await sleepImpl(POLL_INTERVAL_MS);
  }
}

export async function runNextFairQueue(
  handlers: Array<() => Promise<boolean>> = [
    runNextQueuedUpload,
    runNextConfirmedUpload,
    runNextQueuedScan,
  ],
): Promise<boolean> {
  for (let offset = 0; offset < handlers.length; offset += 1) {
    const index = (queueCursor + offset) % handlers.length;
    if (await handlers[index]()) {
      queueCursor = (index + 1) % handlers.length;
      return true;
    }
  }
  queueCursor = (queueCursor + 1) % handlers.length;
  return false;
}

async function main(): Promise<void> {
  console.log(`[${WORKER_ID}] VSee scan worker started`);
  for (;;) {
    await runWorkerIteration();
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
