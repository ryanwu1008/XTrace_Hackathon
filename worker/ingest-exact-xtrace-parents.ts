import type {
  ExactXTraceParentKind,
  ExactXTraceParentUnit,
} from "../lib/xtrace/exact-parent-planner";
import type { PersistedExactIngest } from "../lib/xtrace/service";

export interface ExactParentPlanner {
  plan(workspaceId: string): Promise<ExactXTraceParentUnit[]>;
}

export interface ExactParentIngestService {
  ingestExactParent(parent: ExactXTraceParentUnit): Promise<PersistedExactIngest>;
  pollExactIntent(input: {
    intentId: string;
    providerJobId: string;
  }): Promise<PersistedExactIngest>;
}

export type ExactParentIngestResult = {
  dealId: string;
  parentKind: ExactXTraceParentKind;
  sourceId: string;
  sourceRevisionId: string;
} & (
  | { outcome: "recorded"; ingest: PersistedExactIngest }
  | { outcome: "failed"; failureCode: string }
);

export async function runExactXTraceIngestStage(input: {
  workspaceId: string;
  planner: ExactParentPlanner;
  service: ExactParentIngestService;
}): Promise<{
  workspaceId: string;
  parentCount: number;
  results: ExactParentIngestResult[];
}> {
  const workspaceId = input.workspaceId.trim();
  if (!workspaceId) throw new Error("An XTrace workspace is required.");
  const parents = await input.planner.plan(workspaceId);
  const results: ExactParentIngestResult[] = [];
  for (const parent of parents) {
    const identity = {
      dealId: parent.dealId,
      parentKind: parent.parentKind,
      sourceId: parent.sourceId,
      sourceRevisionId: parent.sourceRevisionId,
    };
    try {
      let ingest = await input.service.ingestExactParent(parent);
      if (
        (ingest.state === "submitted" || ingest.state === "running")
        && ingest.providerJobId
      ) {
        ingest = await input.service.pollExactIntent({
          intentId: ingest.intentId,
          providerJobId: ingest.providerJobId,
        });
      }
      results.push({
        ...identity,
        outcome: "recorded",
        ingest,
      });
    } catch (error) {
      results.push({
        ...identity,
        outcome: "failed",
        failureCode: safeFailureCode(error),
      });
    }
  }
  return { workspaceId, parentCount: parents.length, results };
}

function safeFailureCode(error: unknown): string {
  if (
    error
    && typeof error === "object"
    && "code" in error
    && typeof error.code === "string"
    && /^[A-Z0-9_]{1,80}$/.test(error.code)
  ) return error.code;
  return "XTRACE_EXACT_INGEST_FAILED";
}
