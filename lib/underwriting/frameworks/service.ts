import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

import type {
  ClaudeClient,
  MeasuredClaudeCompletion,
} from "../../claude/client";
import {
  CalculationSchema,
  EvidencePackSchema,
  type Calculation,
  type ClaimEdge,
  type EvidencePack,
} from "../../contracts/evidence";
import {
  CandidateRunSchema,
  FrameworkJudgmentSchema,
  ResearchFrameworkContextSchema,
  ResolvedUnderwritingContextSchema,
  type CandidateRun,
  type FrameworkDisagreement,
  type FrameworkJudgment,
  type ResearchFrameworkContext,
  type ResolvedUnderwritingContext,
} from "../../contracts/underwriting";
import { SYNTHETIC_FRAMEWORK_PACK } from "../../../seed/underwriting/framework-pack-v1";
import { runClaudeFrameworkLens } from "./claude-lens";
import { buildFrameworkDisagreements } from "./disagreements";
import {
  buildFrameworkAbstention,
  createFrameworkJudgmentId,
  isExecutableFrameworkCard,
  isValuationFrameworkCard,
} from "./grounding";
import {
  authorizedResearchComposites,
  isAuthorizedResearchComposite,
  loadResearchFrameworkCatalog,
  RESEARCH_FRAMEWORK_CATALOG_VERSION,
  type ResearchFrameworkCatalog,
} from "./research-loader";
import {
  FrameworkCardSchema,
  isExperimentalAdvisoryFrameworkCard,
  type FrameworkCard,
} from "./schemas";

export interface FrameworkLensExecutionSettings {
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  settingsFingerprint: string;
  applicationCommit: string;
}

export interface FrameworkLensProviderMetadata
  extends FrameworkLensExecutionSettings {
  attempts: number;
  repaired: boolean;
}

export interface FrameworkLensCacheBinding {
  candidateId: string;
  candidateAnalysisFingerprint: string;
  evidencePackId: string;
  evidencePackVersion: number;
  contextId: string;
  contextVersion: string;
  frameworkCardId: string;
  frameworkVersion: string;
  authorizationMode:
    | "ordinary_framework_card"
    | "authorized_research_catalog";
  catalogFingerprint: string | null;
  corpusDigest: string | null;
  compositeAuthorizationDigest: string | null;
}

type FrameworkLensAuthorization =
  | {
    mode: "ordinary_framework_card";
    catalogFingerprint: null;
    corpusDigest: null;
    compositeAuthorizationDigest: null;
  }
  | {
    mode: "authorized_research_catalog";
    catalogFingerprint: string;
    corpusDigest: string;
    compositeAuthorizationDigest: string;
  }
  | {
    mode: "unauthorized_advisory_input";
    catalogFingerprint: null;
    corpusDigest: null;
    compositeAuthorizationDigest: null;
  };

export interface FrameworkLensCacheRecord {
  fingerprint: string;
  judgment: FrameworkJudgment;
  providerMetadata: FrameworkLensProviderMetadata;
  binding: FrameworkLensCacheBinding;
}

export interface FrameworkLensCache {
  find(fingerprint: string): Promise<FrameworkLensCacheRecord | null>;
  save(record: FrameworkLensCacheRecord): Promise<void>;
}

export interface MemoryFrameworkLensCache extends FrameworkLensCache {
  inspect(): FrameworkLensCacheRecord[];
}

const FrameworkLensExecutionSettingsSchema = z.strictObject({
  provider: z.string().min(1),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  schemaVersion: z.string().min(1),
  settingsFingerprint: z.string().min(1),
  applicationCommit: z.string().min(1),
});

const FrameworkLensProviderMetadataSchema =
  FrameworkLensExecutionSettingsSchema.extend({
    attempts: z.number().int().min(0).max(2),
    repaired: z.boolean(),
  });

const FrameworkLensCacheBindingSchema = z.strictObject({
  candidateId: z.string().min(1),
  candidateAnalysisFingerprint: z.string().min(1),
  evidencePackId: z.string().min(1),
  evidencePackVersion: z.number().int().positive(),
  contextId: z.string().min(1),
  contextVersion: z.string().min(1),
  frameworkCardId: z.string().min(1),
  frameworkVersion: z.string().min(1),
  authorizationMode: z.enum([
    "ordinary_framework_card",
    "authorized_research_catalog",
  ]),
  catalogFingerprint: z.string().min(1).nullable(),
  corpusDigest: z.string().min(1).nullable(),
  compositeAuthorizationDigest: z.string().min(1).nullable(),
});

const FrameworkLensCacheRecordSchema = z.strictObject({
  fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  judgment: FrameworkJudgmentSchema,
  providerMetadata: FrameworkLensProviderMetadataSchema,
  binding: FrameworkLensCacheBindingSchema,
});

export interface FrameworkLensService {
  runAll(input: {
    candidate: CandidateRun;
    pack: EvidencePack;
    context: ResolvedUnderwritingContext;
    calculations: Calculation[];
    signal?: AbortSignal;
    providerAttempt?: FrameworkProviderAttemptExecutor;
  }): Promise<{
    judgments: FrameworkJudgment[];
    disagreements: FrameworkDisagreement[];
  }>;
}

export interface ContextAwareFrameworkLensSelection {
  readonly catalogVersion: typeof RESEARCH_FRAMEWORK_CATALOG_VERSION;
  readonly catalogFingerprint: string;
  readonly corpusDigest: string;
  readonly catalog: ResearchFrameworkCatalog;
  readonly service: FrameworkLensService;
}

export interface ContextAwareFrameworkLensResolver {
  resolve(
    context: ResearchFrameworkContext,
    signal?: AbortSignal,
  ): Promise<ContextAwareFrameworkLensSelection>;
}

export interface FrameworkProviderAttemptExecutor {
  execute(input: {
    attemptFingerprint: string;
    outputTokenUnits: number;
    operation(): Promise<MeasuredClaudeCompletion>;
  }): Promise<MeasuredClaudeCompletion>;
}

export function createMemoryFrameworkLensCache(): MemoryFrameworkLensCache {
  const records = new Map<string, FrameworkLensCacheRecord>();
  return {
    async find(fingerprint) {
      const record = records.get(fingerprint);
      return record ? structuredClone(record) : null;
    },
    async save(record) {
      const parsed = FrameworkLensCacheRecordSchema.parse(record);
      const existing = records.get(parsed.fingerprint);
      if (existing && canonicalJson(existing) !== canonicalJson(parsed)) {
        throw new Error(
          "A Framework lens fingerprint is immutable and already differs.",
        );
      }
      records.set(parsed.fingerprint, structuredClone(parsed));
    },
    inspect() {
      return [...records.values()]
        .sort((left, right) =>
          compareUtf8(left.fingerprint, right.fingerprint)
        )
        .map((record) => structuredClone(record));
    },
  };
}

export function createContextAwareFrameworkLensResolver(
  options: Omit<
    Parameters<typeof createFrameworkLensService>[0],
    "advisoryCatalog"
  >,
): ContextAwareFrameworkLensResolver {
  const selections = new Map<
    string,
    {
      controller: AbortController;
      promise: Promise<ContextAwareFrameworkLensSelection>;
      waiters: Set<symbol>;
      settled: boolean;
    }
  >();

  return {
    resolve(rawContext, signal) {
      throwIfAborted(signal);
      const context = ResearchFrameworkContextSchema.parse(rawContext);
      const key = canonicalJson({
        catalogVersion: RESEARCH_FRAMEWORK_CATALOG_VERSION,
        stage: context.stage,
        businessModel: context.businessModel,
        geography: context.geography,
        securityType: context.securityType,
      });
      const existing = selections.get(key);
      if (existing) {
        return waitForSelection(existing, signal);
      }

      const controller = new AbortController();
      const pending = loadResearchFrameworkCatalog({
        context,
        signal: controller.signal,
      })
        .then((catalog) => Object.freeze({
          catalogVersion: RESEARCH_FRAMEWORK_CATALOG_VERSION,
          catalogFingerprint: catalog.fingerprint,
          corpusDigest: catalog.authorization.corpusDigest,
          catalog,
          service: createFrameworkLensService({
            ...options,
            advisoryCatalog: catalog,
          }),
        }));
      const entry = {
        controller,
        promise: pending,
        waiters: new Set<symbol>(),
        settled: false,
      };
      selections.set(key, entry);
      void pending.then(
        () => {
          entry.settled = true;
        },
        () => {
          entry.settled = true;
          if (selections.get(key) === entry) selections.delete(key);
        },
      );
      return waitForSelection(entry, signal);
    },
  };
}

function waitForSelection(
  entry: {
    controller: AbortController;
    promise: Promise<ContextAwareFrameworkLensSelection>;
    waiters: Set<symbol>;
    settled: boolean;
  },
  signal: AbortSignal | undefined,
): Promise<ContextAwareFrameworkLensSelection> {
  const waiter = Symbol("framework-catalog-waiter");
  entry.waiters.add(waiter);
  if (!signal) {
    const cleanup = () => entry.waiters.delete(waiter);
    void entry.promise.then(cleanup, cleanup);
    return entry.promise;
  }
  return new Promise((resolve, reject) => {
    let active = true;
    const finish = () => {
      if (!active) return false;
      active = false;
      entry.waiters.delete(waiter);
      signal.removeEventListener("abort", abort);
      return true;
    };
    const abort = () => {
      if (!finish()) return;
      if (!entry.settled && entry.waiters.size === 0) {
        entry.controller.abort(signal.reason);
      }
      reject(abortError(signal));
    };
    signal.addEventListener("abort", abort, { once: true });
    void entry.promise.then(
      (selection) => {
        if (finish()) resolve(selection);
      },
      (error: unknown) => {
        if (finish()) reject(error);
      },
    );
  });
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Framework catalog resolution was aborted.");
}

export function createFrameworkLensService(options: {
  client: ClaudeClient;
  execution: FrameworkLensExecutionSettings;
  cards?: readonly FrameworkCard[];
  advisoryCatalog?: ResearchFrameworkCatalog;
  concurrency?: number;
  cache?: FrameworkLensCache;
  isApplicable?: (
    card: FrameworkCard,
    input: {
      pack: EvidencePack;
      context: ResolvedUnderwritingContext;
      calculations: Calculation[];
    },
  ) => boolean;
}): FrameworkLensService {
  const ordinaryCards = (options.cards ?? SYNTHETIC_FRAMEWORK_PACK.cards)
    .map((card) => FrameworkCardSchema.parse(card));
  const advisoryCards = options.advisoryCatalog
    ? authorizedResearchComposites(options.advisoryCatalog)
    : [];
  const cards: readonly FrameworkCard[] = [
    ...ordinaryCards,
    ...advisoryCards,
  ];
  assertUniqueCardIds(cards);
  const concurrency = validateConcurrency(options.concurrency ?? 4);
  const cache = options.cache ?? createMemoryFrameworkLensCache();
  const execution = validateExecutionSettings(options.execution);
  const inFlightRecords = new Map<
    string,
    Promise<FrameworkLensCacheRecord>
  >();

  return {
    async runAll(rawInput) {
      throwIfAborted(rawInput.signal);
      const candidate = CandidateRunSchema.parse(rawInput.candidate);
      const pack = EvidencePackSchema.parse(rawInput.pack);
      const context = ResolvedUnderwritingContextSchema.parse(
        rawInput.context,
      );
      const calculations = rawInput.calculations.map((item) =>
        CalculationSchema.parse(item)
      );
      if (
        candidate.workspaceId !== pack.workspaceId
        || candidate.dealId !== pack.dealId
        || context.asOfDate !== pack.asOfDate
      ) {
        throw new Error(
          "Framework lenses require one matching Candidate, Evidence Pack, and context.",
        );
      }
      if (
        options.advisoryCatalog
        && !catalogMatchesContext(options.advisoryCatalog, context)
      ) {
        throw new Error(
          "The authorized research catalog was composed for a different immutable underwriting context.",
        );
      }

      const judgments = await stableConcurrentMap(
        cards,
        concurrency,
        async (card): Promise<FrameworkJudgment> => {
          throwIfAborted(rawInput.signal);
          const scopedCalculations = isValuationFrameworkCard(card)
            ? calculations
            : [];
          const authorizedAdvisory = options.advisoryCatalog
            ? isAuthorizedResearchComposite(options.advisoryCatalog, card)
            : false;
          const experimentalAdvisory =
            isExperimentalAdvisoryFrameworkCard(card);
          const authorization: FrameworkLensAuthorization =
            authorizedAdvisory && experimentalAdvisory
            ? {
              mode: "authorized_research_catalog" as const,
              catalogFingerprint: options.advisoryCatalog!.fingerprint,
              corpusDigest:
                options.advisoryCatalog!.authorization.corpusDigest,
              compositeAuthorizationDigest:
                card.experimentalAdvisory.authorizationDigest,
            }
            : experimentalAdvisory
            ? {
              mode: "unauthorized_advisory_input" as const,
              catalogFingerprint: null,
              corpusDigest: null,
              compositeAuthorizationDigest: null,
            }
            : {
              mode: "ordinary_framework_card" as const,
              catalogFingerprint: null,
              corpusDigest: null,
              compositeAuthorizationDigest: null,
            };
          const fingerprint = createFrameworkLensFingerprint({
            candidate,
            pack,
            context,
            card,
            calculations: scopedCalculations,
            execution,
            authorization,
          });
          if (experimentalAdvisory && !authorizedAdvisory) {
            return buildFrameworkAbstention({
              candidate,
              pack,
              card,
              calculations: scopedCalculations,
              fingerprint,
              applicability: "unavailable",
              reason:
                "Experimental advisory Card is not authorized by the exact loader catalog object.",
            });
          }
          const binding = createCacheBinding({
            candidate,
            pack,
            context,
            card,
            authorization,
          });
          const record = await coalesceFrameworkLensRecord({
            records: inFlightRecords,
            fingerprint,
            execute: async () => {
              const replayed = await cache.find(fingerprint);
              if (replayed) {
                return validateCacheReplay({
                  rawRecord: replayed,
                  fingerprint,
                  binding,
                  execution,
                  candidate,
                  pack,
                  card,
                  calculations: scopedCalculations,
                  authorizedAdvisory,
                });
              }

              let judgment: FrameworkJudgment;
              let attempts = 0;
              let repaired = false;
              if (
                !experimentalAdvisory
                &&
                context.analysisMode === "core_only"
                && context.geography === "unavailable"
              ) {
                judgment = buildFrameworkAbstention({
                  candidate,
                  pack,
                  card,
                  calculations: scopedCalculations,
                  fingerprint,
                  applicability: "unavailable",
                  reason:
                    "Core-only analysis: geography is unavailable, so this framework cannot be applied to an immutable supported context.",
                  retainAdvisoryMetadata: authorizedAdvisory,
                });
              } else if (experimentalAdvisory) {
                if (!card.experimentalAdvisory.applicable) {
                  judgment = buildFrameworkAbstention({
                    candidate,
                    pack,
                    card,
                    calculations: scopedCalculations,
                    fingerprint,
                    applicability: "not_applicable",
                    reason:
                      "No eligible component Card applies to this immutable underwriting context.",
                    retainAdvisoryMetadata: true,
                  });
                } else if (
                  options.isApplicable
                  && !options.isApplicable(card, {
                    pack,
                    context,
                    calculations,
                  })
                ) {
                  judgment = buildFrameworkAbstention({
                    candidate,
                    pack,
                    card,
                    calculations: scopedCalculations,
                    fingerprint,
                    applicability: "not_applicable",
                    reason:
                      "Framework Card is not applicable to this immutable context.",
                    retainAdvisoryMetadata: true,
                  });
                } else {
                  const result = await runClaudeFrameworkLens({
                    client: options.client,
                    candidate,
                    pack,
                    context,
                    calculations: scopedCalculations,
                    card,
                    fingerprint,
                    signal: rawInput.signal,
                    providerAttempt: rawInput.providerAttempt,
                  });
                  judgment = result.judgment;
                  attempts = result.attempts;
                  repaired = result.repaired;
                }
              } else if (
                context.frameworkPackId !== SYNTHETIC_FRAMEWORK_PACK.id
                || !isExecutableFrameworkCard(card)
              ) {
                judgment = buildFrameworkAbstention({
                  candidate,
                  pack,
                  card,
                  calculations: scopedCalculations,
                  fingerprint,
                  applicability: "unavailable",
                  reason:
                    "Framework Card is not an executable published product-owned synthetic fixture.",
                });
              } else if (
                options.isApplicable
                && !options.isApplicable(card, {
                  pack,
                  context,
                  calculations,
                })
              ) {
                judgment = buildFrameworkAbstention({
                  candidate,
                  pack,
                  card,
                  calculations: scopedCalculations,
                  fingerprint,
                  applicability: "not_applicable",
                  reason:
                    "Framework Card is not applicable to this immutable context.",
                });
              } else {
                const result = await runClaudeFrameworkLens({
                  client: options.client,
                  candidate,
                  pack,
                  context,
                  calculations: scopedCalculations,
                  card,
                  fingerprint,
                  signal: rawInput.signal,
                  providerAttempt: rawInput.providerAttempt,
                });
                judgment = result.judgment;
                attempts = result.attempts;
                repaired = result.repaired;
              }
              const freshRecord = FrameworkLensCacheRecordSchema.parse({
                fingerprint,
                judgment,
                binding,
                providerMetadata: {
                  ...execution,
                  attempts,
                  repaired,
                },
              });
              await cache.save(freshRecord);
              return freshRecord;
            },
          });
          return structuredClone(record.judgment);
        },
      );
      return {
        judgments,
        disagreements: buildFrameworkDisagreements({ judgments, cards }),
      };
    },
  };
}

function coalesceFrameworkLensRecord(input: {
  records: Map<string, Promise<FrameworkLensCacheRecord>>;
  fingerprint: string;
  execute: () => Promise<FrameworkLensCacheRecord>;
}): Promise<FrameworkLensCacheRecord> {
  const existing = input.records.get(input.fingerprint);
  if (existing) return existing;

  const pending = input.execute();
  input.records.set(input.fingerprint, pending);
  const cleanup = () => {
    if (input.records.get(input.fingerprint) === pending) {
      input.records.delete(input.fingerprint);
    }
  };
  void pending.then(cleanup, cleanup);
  return pending;
}

async function stableConcurrentMap<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(values[index]!, index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function validateConcurrency(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 20) {
    throw new Error(
      "Framework lens concurrency must be an integer between 1 and 20.",
    );
  }
  return value;
}

function assertUniqueCardIds(cards: readonly FrameworkCard[]): void {
  const ids = cards.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) {
    throw new Error(
      "Framework lens execution requires unique Framework Card IDs.",
    );
  }
}

function catalogMatchesContext(
  catalog: ResearchFrameworkCatalog,
  context: ResolvedUnderwritingContext,
): boolean {
  return catalog.context.stage === context.stage
    && catalog.context.businessModel === context.businessModel
    && catalog.context.geography === context.geography
    && catalog.context.securityType === context.securityType;
}

function createCacheBinding(input: {
  candidate: CandidateRun;
  pack: EvidencePack;
  context: ResolvedUnderwritingContext;
  card: FrameworkCard;
  authorization: FrameworkLensAuthorization;
}): FrameworkLensCacheBinding {
  if (input.authorization.mode === "unauthorized_advisory_input") {
    throw new Error(
      "Unauthorized experimental advisory inputs cannot create cache bindings.",
    );
  }
  return FrameworkLensCacheBindingSchema.parse({
    candidateId: input.candidate.id,
    candidateAnalysisFingerprint:
      input.candidate.candidateAnalysisFingerprint,
    evidencePackId: input.pack.id,
    evidencePackVersion: input.pack.version,
    contextId: input.context.id,
    contextVersion: input.context.contextVersion,
    frameworkCardId: input.card.id,
    frameworkVersion: input.card.version,
    authorizationMode: input.authorization.mode,
    catalogFingerprint: input.authorization.catalogFingerprint,
    corpusDigest: input.authorization.corpusDigest,
    compositeAuthorizationDigest:
      input.authorization.compositeAuthorizationDigest,
  });
}

function validateCacheReplay(input: {
  rawRecord: unknown;
  fingerprint: string;
  binding: FrameworkLensCacheBinding;
  execution: FrameworkLensExecutionSettings;
  candidate: CandidateRun;
  pack: EvidencePack;
  card: FrameworkCard;
  calculations: Calculation[];
  authorizedAdvisory: boolean;
}): FrameworkLensCacheRecord {
  const parsed = FrameworkLensCacheRecordSchema.safeParse(input.rawRecord);
  if (!parsed.success) {
    throw new Error(
      "Framework lens cache record is invalid and cannot be replayed.",
    );
  }
  const record = parsed.data;
  const { attempts, repaired, ...cachedExecution } =
    record.providerMetadata;
  const expectedJudgmentId = createFrameworkJudgmentId(
    input.candidate.id,
    input.card.id,
    input.fingerprint,
  );
  if (
    record.fingerprint !== input.fingerprint
    || record.judgment.fingerprint !== input.fingerprint
    || !isDeepStrictEqual(record.binding, input.binding)
    || !isDeepStrictEqual(cachedExecution, input.execution)
    || record.judgment.id !== expectedJudgmentId
    || record.judgment.frameworkCardId !== input.card.id
    || record.judgment.frameworkVersion !== input.card.version
  ) {
    throw new Error(
      "Framework lens cache record does not match the authorized execution request.",
    );
  }

  if (input.authorizedAdvisory) {
    if (
      !isExperimentalAdvisoryFrameworkCard(input.card)
      || !isDeepStrictEqual(
        record.judgment.frameworkMetadata,
        input.card.experimentalAdvisory,
      )
      || repaired
      || attempts > 1
    ) {
      throw new Error(
        "Framework lens cache record does not match the authorized advisory metadata.",
      );
    }
  } else if (
    record.judgment.frameworkMetadata !== undefined
    || repaired !== (attempts === 2)
  ) {
    throw new Error(
      "Framework lens cache record contains mismatched execution metadata.",
    );
  }

  const dependencies = new Map<
    string,
    "fact" | "assumption" | "calculation"
  >();
  for (const fact of input.pack.facts) dependencies.set(fact.id, "fact");
  for (const assumption of input.pack.assumptions) {
    dependencies.set(assumption.id, "assumption");
  }
  if (isValuationFrameworkCard(input.card)) {
    for (const calculation of input.calculations) {
      dependencies.set(calculation.id, "calculation");
    }
  }
  const evidenceIds = [
    ...record.judgment.supportEvidenceItemIds,
    ...record.judgment.counterEvidenceItemIds,
    ...record.judgment.unusedEvidenceItemIds,
  ];
  const exactPartition = evidenceIds.length === dependencies.size
    && new Set(evidenceIds).size === evidenceIds.length
    && evidenceIds.every((id) => dependencies.has(id))
    && [...dependencies.keys()].every((id) => evidenceIds.includes(id));
  const sortedEvidenceLists = [
    record.judgment.supportEvidenceItemIds,
    record.judgment.counterEvidenceItemIds,
    record.judgment.unusedEvidenceItemIds,
  ].every((ids) =>
    isDeepStrictEqual(ids, [...ids].sort(compareUtf8))
  );
  const expectedEdges: ClaimEdge[] = [
    ...record.judgment.supportEvidenceItemIds,
    ...record.judgment.counterEvidenceItemIds,
  ].map((dependencyItemId) => ({
    claimItemId: expectedJudgmentId,
    dependencyItemId,
    dependencyType: dependencies.get(dependencyItemId)!,
  }));
  expectedEdges.push({
    claimItemId: expectedJudgmentId,
    dependencyItemId: input.card.id,
    dependencyType: "framework_ref",
  });
  expectedEdges.sort((left, right) =>
    compareUtf8(left.dependencyItemId, right.dependencyItemId)
  );
  const abstained = record.judgment.applicability !== "applicable";
  const validConclusionShape = abstained
    ? record.judgment.conclusion === "abstain"
      && record.judgment.supportEvidenceItemIds.length === 0
      && record.judgment.counterEvidenceItemIds.length === 0
      && record.judgment.strongestSupport === null
      && record.judgment.strongestCounterargument === null
    : record.judgment.conclusion !== "abstain"
      && record.judgment.supportEvidenceItemIds.length > 0
      && record.judgment.counterEvidenceItemIds.length > 0
      && record.judgment.strongestSupport !== null
      && record.judgment.strongestCounterargument !== null;
  if (
    !exactPartition
    || !sortedEvidenceLists
    || !validConclusionShape
    || !isDeepStrictEqual(record.judgment.claimEdges, expectedEdges)
  ) {
    throw new Error(
      "Framework lens cache record is not grounded in the authorized immutable inputs.",
    );
  }
  return record;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Framework lens execution was aborted.");
}

function createFrameworkLensFingerprint(input: {
  candidate: CandidateRun;
  pack: EvidencePack;
  context: ResolvedUnderwritingContext;
  card: FrameworkCard;
  calculations: Calculation[];
  execution: FrameworkLensExecutionSettings;
  authorization: FrameworkLensAuthorization;
}): string {
  const canonical = canonicalJson({
    kind: "framework-lens-execution-v1",
    candidate: {
      id: input.candidate.id,
      candidateAnalysisFingerprint:
        input.candidate.candidateAnalysisFingerprint,
    },
    evidencePack: input.pack,
    card: input.card,
    context: input.context,
    calculations: input.calculations,
    authorization: input.authorization,
    provider: input.execution.provider,
    model: input.execution.model,
    promptVersion: input.execution.promptVersion,
    schemaVersion: input.execution.schemaVersion,
    settingsFingerprint: input.execution.settingsFingerprint,
    applicationCommit: input.execution.applicationCommit,
  });
  return `sha256:${
    createHash("sha256").update(canonical, "utf8").digest("hex")
  }`;
}

function validateExecutionSettings(
  input: FrameworkLensExecutionSettings,
): FrameworkLensExecutionSettings {
  const parsed = FrameworkLensExecutionSettingsSchema.parse(input);
  for (const [key, value] of Object.entries(parsed)) {
    if (value.trim() !== value) {
      throw new Error(
        `Framework lens execution ${key} must be non-empty without surrounding whitespace.`,
      );
    }
  }
  return parsed;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Framework fingerprints require finite numbers.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${
      Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort(compareUtf8)
        .map((key) =>
          `${JSON.stringify(key)}:${canonicalJson(record[key])}`
        )
        .join(",")
    }}`;
  }
  throw new Error(
    `Unsupported Framework fingerprint input: ${typeof value}.`,
  );
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
