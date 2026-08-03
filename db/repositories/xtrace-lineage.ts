import { createHash, randomUUID } from "node:crypto";

import type { Provenance } from "../../lib/contracts/domain";
import type {
  ExactXTraceParentKind,
  ExactXTraceParentUnit,
} from "../../lib/xtrace/exact-parent-planner";
import {
  IntegrationTransportError,
  isRetryableTransportStatus,
} from "../../lib/api/errors";

export interface XTraceIngestLineage {
  jobId: string;
  workspaceId: string;
  dealId: string;
  sourceRevisionIds: string[];
  sourceIds: string[];
  fixtureIds: string[];
  bundleFingerprint: string;
  serializerVersion: string;
  provenance: Provenance;
  status: "pending" | "running" | "succeeded" | "failed";
  memoryIds: string[];
}

export interface XTraceMemoryLineage {
  memoryId: string;
  workspaceId: string;
  dealId: string;
  sourceRevisionIds: string[];
  sourceIds: string[];
  fixtureIds: string[];
  provenance: Provenance;
}

export type XTraceIngestStateV2 =
  | "reserved"
  | "submitting"
  | "submitted"
  | "running"
  | "succeeded"
  | "failed"
  | "submission_unknown";

export interface XTraceIngestIntentV2 {
  intentId: string;
  workspaceId: string;
  dealId: string;
  parentKind: ExactXTraceParentKind;
  sourceId: string;
  sourceRevisionId: string;
  parentFingerprint: string;
  payloadFingerprint: string;
  serializerVersion: string;
  state: XTraceIngestStateV2;
  stateHistory: XTraceIngestStateV2[];
  leaseToken: string | null;
  providerJobId: string | null;
  memoryIds: string[];
}

export interface XTraceRecallAuditV2 {
  workspaceId: string;
  runId: string;
  dealId: string;
  evidenceContextFingerprint: string;
  activeParentFingerprint: string;
  queryFingerprint: string;
  memoryIds: string[];
}

export interface XTraceLineageRepository {
  recordSubmission(input: Omit<
    XTraceIngestLineage,
    "memoryIds" | "sourceRevisionIds"
  > & { sourceRevisionIds?: string[] }): Promise<void>;
  recordCompletion(input: {
    workspaceId: string;
    jobId: string;
    status: XTraceIngestLineage["status"];
    memoryIds: string[];
  }): Promise<void>;
  listOpenJobs(workspaceId: string): Promise<XTraceIngestLineage[]>;
  findReusableIngest(input: {
    workspaceId: string;
    dealId: string;
    sourceRevisionIds?: string[];
    sourceIds: string[];
    fixtureIds: string[];
    bundleFingerprint: string;
    serializerVersion: string;
  }): Promise<XTraceIngestLineage | null>;
  resolve(input: {
    memoryId: string;
    workspaceId: string;
    convId?: string;
  }): Promise<XTraceMemoryLineage | null>;
  reserveExactIntent(input: {
    parent: ExactXTraceParentUnit;
    serializerVersion: string;
  }): Promise<{
    action: "submit" | "wait" | "reuse" | "blocked";
    intent: XTraceIngestIntentV2;
  }>;
  waitForExactIntent(intentId: string): Promise<XTraceIngestIntentV2>;
  attachExactJob(input: {
    intentId: string;
    leaseToken: string;
    providerJobId: string;
  }): Promise<XTraceIngestIntentV2>;
  markExactSubmissionUnknown(input: {
    intentId: string;
    leaseToken: string;
  }): Promise<XTraceIngestIntentV2>;
  advanceExactIntent(input: {
    intentId: string;
    providerJobId: string;
    state: "running" | "succeeded" | "failed";
    memoryIds: string[];
  }): Promise<XTraceIngestIntentV2>;
  resolveExact(input: {
    memoryId: string;
    workspaceId: string;
    dealId: string;
    activeParentFingerprint: string;
  }): Promise<XTraceMemoryLineage | null>;
  recordRecallAudit(input: XTraceRecallAuditV2): Promise<void>;
}

export function createMemoryXTraceLineageRepository(options: {
  isParentActive?: (input: {
    workspaceId: string;
    dealId: string;
    sourceId: string;
    sourceRevisionId: string;
    parentFingerprint: string;
    activeParentSetFingerprint: string;
  }) => boolean | Promise<boolean>;
  persistRecallAudit?: (input: XTraceRecallAuditV2) => void | Promise<void>;
} = {}): XTraceLineageRepository {
  const jobs = new Map<string, XTraceIngestLineage>();
  const memories = new Map<string, XTraceMemoryLineage>();
  const exactIntents = new Map<string, XTraceIngestIntentV2>();
  const exactIntentByParent = new Map<string, string>();
  const exactJobOwners = new Map<string, string>();
  const exactMemories = new Map<string, {
    memoryId: string;
    workspaceId: string;
    dealId: string;
    parentKind: ExactXTraceParentKind;
    sourceId: string;
    sourceRevisionId: string;
    parentFingerprint: string;
  }>();
  const exactWaiters = new Map<string, Array<(intent: XTraceIngestIntentV2) => void>>();
  const notify = (intent: XTraceIngestIntentV2) => {
    const waiters = exactWaiters.get(intent.intentId) ?? [];
    exactWaiters.delete(intent.intentId);
    for (const resolve of waiters) resolve(structuredClone(intent));
  };
  return {
    async recordSubmission(input) {
      const key = lineageKey(input.workspaceId, input.jobId);
      const existing = jobs.get(key);
      jobs.set(key, {
        ...structuredClone(input),
        sourceRevisionIds: structuredClone(input.sourceRevisionIds ?? []),
        memoryIds: existing?.memoryIds ?? [],
      });
    },
    async recordCompletion(input) {
      const jobKey = lineageKey(input.workspaceId, input.jobId);
      const job = jobs.get(jobKey);
      if (!job) throw new Error(`XTrace ingest job ${input.jobId} has no local lineage`);
      const next = {
        ...job,
        status: input.status,
        memoryIds: [...new Set(input.memoryIds)],
      };
      jobs.set(jobKey, next);
      for (const memoryId of next.memoryIds) {
        memories.set(lineageKey(input.workspaceId, memoryId), {
          memoryId,
          workspaceId: next.workspaceId,
          dealId: next.dealId,
          sourceRevisionIds: structuredClone(next.sourceRevisionIds),
          sourceIds: structuredClone(next.sourceIds),
          fixtureIds: structuredClone(next.fixtureIds),
          provenance: next.provenance,
        });
      }
    },
    async listOpenJobs(workspaceId) {
      return [...jobs.values()]
        .filter((job) =>
          job.workspaceId === workspaceId
          && (job.status === "pending" || job.status === "running")
        )
        .map((job) => structuredClone(job));
    },
    async findReusableIngest(input) {
      const job = [...jobs.values()].reverse().find((candidate) =>
        candidate.workspaceId === input.workspaceId
        && candidate.dealId === input.dealId
        && candidate.status !== "failed"
        && sameStringSet(
          candidate.sourceRevisionIds,
          input.sourceRevisionIds ?? [],
        )
        && sameStringSet(candidate.sourceIds, input.sourceIds)
        && sameStringSet(candidate.fixtureIds, input.fixtureIds)
        && candidate.bundleFingerprint === input.bundleFingerprint
        && candidate.serializerVersion === input.serializerVersion
      );
      return job ? structuredClone(job) : null;
    },
    async resolve(input) {
      const direct = memories.get(lineageKey(input.workspaceId, input.memoryId));
      return direct ? structuredClone(direct) : null;
    },
    async reserveExactIntent({ parent, serializerVersion }) {
      const parentKey = exactParentKey(parent, serializerVersion);
      const existingId = exactIntentByParent.get(parentKey);
      if (existingId) {
        const existing = exactIntents.get(existingId)!;
        if (existing.payloadFingerprint !== parent.payloadFingerprint) {
          throw new Error("The exact parent identity already has a different immutable payload.");
        }
        return {
          action: existing.state === "succeeded"
            ? "reuse"
            : existing.state === "submission_unknown" || existing.state === "failed"
            ? "blocked"
            : "wait",
          intent: structuredClone(existing),
        };
      }
      const intentId = exactIntentId(parent, serializerVersion);
      const intent: XTraceIngestIntentV2 = {
        intentId,
        workspaceId: parent.workspaceId,
        dealId: parent.dealId,
        parentKind: parent.parentKind,
        sourceId: parent.sourceId,
        sourceRevisionId: parent.sourceRevisionId,
        parentFingerprint: parent.parentFingerprint,
        payloadFingerprint: parent.payloadFingerprint,
        serializerVersion,
        state: "submitting",
        stateHistory: ["reserved", "submitting"],
        leaseToken: randomUUID(),
        providerJobId: null,
        memoryIds: [],
      };
      exactIntents.set(intentId, intent);
      exactIntentByParent.set(parentKey, intentId);
      return { action: "submit", intent: structuredClone(intent) };
    },
    async waitForExactIntent(intentId) {
      const current = exactIntents.get(intentId);
      if (!current) throw new Error("The exact XTrace intent does not exist.");
      if (current.state !== "submitting") return structuredClone(current);
      return new Promise<XTraceIngestIntentV2>((resolve) => {
        const waiters = exactWaiters.get(intentId) ?? [];
        waiters.push(resolve);
        exactWaiters.set(intentId, waiters);
      });
    },
    async attachExactJob(input) {
      const intent = requireExactIntent(exactIntents, input.intentId);
      if (intent.state !== "submitting" || intent.leaseToken !== input.leaseToken) {
        throw new Error("The exact XTrace submitter lease is not active.");
      }
      const jobKey = lineageKey(intent.workspaceId, input.providerJobId);
      const owner = exactJobOwners.get(jobKey);
      if (owner && owner !== intent.intentId) {
        throw new Error("The provider job is already attached to a different exact intent.");
      }
      exactJobOwners.set(jobKey, intent.intentId);
      intent.providerJobId = input.providerJobId;
      intent.state = "submitted";
      intent.stateHistory.push("submitted");
      intent.leaseToken = null;
      notify(intent);
      return structuredClone(intent);
    },
    async markExactSubmissionUnknown(input) {
      const intent = requireExactIntent(exactIntents, input.intentId);
      if (intent.state !== "submitting" || intent.leaseToken !== input.leaseToken) {
        throw new Error("The exact XTrace submitter lease is not active.");
      }
      intent.state = "submission_unknown";
      intent.stateHistory.push("submission_unknown");
      intent.leaseToken = null;
      notify(intent);
      return structuredClone(intent);
    },
    async advanceExactIntent(input) {
      const intent = requireExactIntent(exactIntents, input.intentId);
      if (intent.providerJobId !== input.providerJobId) {
        throw new Error("The provider job does not belong to this exact intent.");
      }
      if (
        !(
          (input.state === "running" && ["submitted", "running"].includes(intent.state))
          || (["succeeded", "failed"].includes(input.state)
            && ["submitted", "running"].includes(intent.state))
        )
      ) throw new Error("The exact XTrace state transition is invalid.");
      if (input.state === "succeeded") {
        for (const memoryId of input.memoryIds) {
          const key = lineageKey(intent.workspaceId, memoryId);
          const existing = exactMemories.get(key);
          if (
            existing
            && (
              existing.dealId !== intent.dealId
              || existing.sourceRevisionId !== intent.sourceRevisionId
              || existing.parentFingerprint !== intent.parentFingerprint
            )
          ) throw new Error("The provider memory child belongs to a different exact parent.");
        }
        for (const memoryId of [...new Set(input.memoryIds)]) {
          exactMemories.set(lineageKey(intent.workspaceId, memoryId), {
            memoryId,
            workspaceId: intent.workspaceId,
            dealId: intent.dealId,
            parentKind: intent.parentKind,
            sourceId: intent.sourceId,
            sourceRevisionId: intent.sourceRevisionId,
            parentFingerprint: intent.parentFingerprint,
          });
        }
      }
      intent.state = input.state;
      intent.stateHistory.push(input.state);
      intent.memoryIds = [...new Set(input.memoryIds)];
      notify(intent);
      return structuredClone(intent);
    },
    async resolveExact(input) {
      const link = exactMemories.get(lineageKey(input.workspaceId, input.memoryId));
      if (
        !link
        || link.dealId !== input.dealId
        || !/^sha256:[0-9a-f]{64}$/.test(input.activeParentFingerprint)
        || !options.isParentActive
        || !(await options.isParentActive({
          ...link,
          activeParentSetFingerprint: input.activeParentFingerprint,
        }))
      ) return null;
      return {
        memoryId: link.memoryId,
        workspaceId: link.workspaceId,
        dealId: link.dealId,
        sourceRevisionIds: [link.sourceRevisionId],
        sourceIds: link.parentKind === "sample_decision_record" ? [] : [link.sourceId],
        fixtureIds: link.parentKind === "sample_decision_record"
          ? [link.sourceId.replace(/^source_/, "")]
          : [],
        provenance: link.parentKind === "sample_decision_record"
          ? "demo_fixture"
          : link.parentKind === "canonical_source_revision"
          ? "public_web"
          : "source_document",
      };
    },
    async recordRecallAudit(input) {
      await options.persistRecallAudit?.(structuredClone(input));
    },
  };
}

export function createSupabaseXTraceLineageRepository(options: {
  url: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}): XTraceLineageRepository {
  const base = `${options.url.replace(/\/$/, "")}/rest/v1`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = {
    apikey: options.serviceRoleKey,
    authorization: `Bearer ${options.serviceRoleKey}`,
    "content-type": "application/json",
  };
  async function request(path: string, init: RequestInit = {}) {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        ...init,
        headers: { ...headers, ...(init.headers ?? {}) },
        cache: "no-store",
      });
    } catch {
      throw new IntegrationTransportError({ retryable: true });
    }
    if (!response.ok) {
      throw new IntegrationTransportError({
        retryable: isRetryableTransportStatus(response.status),
      });
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  function toLineage(row: Record<string, unknown>): XTraceMemoryLineage {
    return {
      memoryId: String(row.memory_id),
      workspaceId: String(row.workspace_id),
      dealId: String(row.deal_id),
      sourceRevisionIds: Array.isArray(row.source_revision_ids)
        ? row.source_revision_ids.map(String)
        : [],
      sourceIds: Array.isArray(row.source_ids) ? row.source_ids.map(String) : [],
      fixtureIds: Array.isArray(row.fixture_ids) ? row.fixture_ids.map(String) : [],
      provenance: row.provenance as Provenance,
    };
  }
  function toIngestLineage(row: Record<string, unknown>): XTraceIngestLineage {
    return {
      jobId: String(row.job_id),
      workspaceId: String(row.workspace_id),
      dealId: String(row.deal_id),
      sourceRevisionIds: Array.isArray(row.source_revision_ids)
        ? row.source_revision_ids.map(String)
        : [],
      sourceIds: Array.isArray(row.source_ids) ? row.source_ids.map(String) : [],
      fixtureIds: Array.isArray(row.fixture_ids) ? row.fixture_ids.map(String) : [],
      bundleFingerprint: String(row.bundle_fingerprint),
      serializerVersion: String(row.serializer_version),
      provenance: row.provenance as Provenance,
      status: row.status as XTraceIngestLineage["status"],
      memoryIds: Array.isArray(row.memory_ids) ? row.memory_ids.map(String) : [],
    };
  }
  function toExactIntent(row: Record<string, unknown>): XTraceIngestIntentV2 {
    const stateHistory = row.state_history ?? row.stateHistory;
    const memoryIds = row.memory_ids ?? row.memoryIds;
    return {
      intentId: String(row.intent_id ?? row.intentId),
      workspaceId: String(row.workspace_id ?? row.workspaceId),
      dealId: String(row.deal_id ?? row.dealId),
      parentKind: String(row.parent_kind ?? row.parentKind) as ExactXTraceParentKind,
      sourceId: String(row.source_id ?? row.sourceId),
      sourceRevisionId: String(row.source_revision_id ?? row.sourceRevisionId),
      parentFingerprint: String(row.parent_fingerprint ?? row.parentFingerprint),
      payloadFingerprint: String(row.payload_fingerprint ?? row.payloadFingerprint),
      serializerVersion: String(row.serializer_version ?? row.serializerVersion),
      state: String(row.state) as XTraceIngestStateV2,
      stateHistory: Array.isArray(stateHistory)
        ? stateHistory.map(String) as XTraceIngestStateV2[]
        : [],
      leaseToken: row.lease_token ?? row.leaseToken
        ? String(row.lease_token ?? row.leaseToken)
        : null,
      providerJobId: row.provider_job_id ?? row.providerJobId
        ? String(row.provider_job_id ?? row.providerJobId)
        : null,
      memoryIds: Array.isArray(memoryIds)
        ? memoryIds.map(String)
        : [],
    };
  }
  async function exactRpc(
    name: string,
    body: Record<string, unknown>,
  ): Promise<XTraceIngestIntentV2> {
    const value = await request(`/rpc/${name}`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(body),
    });
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("The exact XTrace lineage RPC returned no intent.");
    }
    return toExactIntent(value as Record<string, unknown>);
  }
  return {
    async recordSubmission(input) {
      await request("/xtrace_ingest_jobs?on_conflict=workspace_id,job_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          job_id: input.jobId,
          workspace_id: input.workspaceId,
          deal_id: input.dealId,
          source_revision_ids: input.sourceRevisionIds ?? [],
          source_ids: input.sourceIds,
          fixture_ids: input.fixtureIds,
          bundle_fingerprint: input.bundleFingerprint,
          serializer_version: input.serializerVersion,
          provenance: input.provenance,
          status: input.status,
          memory_ids: [],
        }),
      });
    },
    async recordCompletion(input) {
      const jobs = await request(
        `/xtrace_ingest_jobs?workspace_id=eq.${encodeURIComponent(input.workspaceId)}`
        + `&job_id=eq.${encodeURIComponent(input.jobId)}&limit=1`,
      ) as Record<string, unknown>[];
      const job = jobs[0];
      if (!job) throw new Error(`XTrace ingest job ${input.jobId} has no local lineage`);
      await request(
        `/xtrace_ingest_jobs?workspace_id=eq.${encodeURIComponent(input.workspaceId)}`
        + `&job_id=eq.${encodeURIComponent(input.jobId)}`,
        {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: input.status,
          memory_ids: input.memoryIds,
          updated_at: new Date().toISOString(),
        }),
        },
      );
      if (!input.memoryIds.length) return;
      await request("/xtrace_memory_links?on_conflict=workspace_id,memory_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(input.memoryIds.map((memoryId) => ({
          memory_id: memoryId,
          workspace_id: job.workspace_id,
          deal_id: job.deal_id,
          source_revision_ids: job.source_revision_ids,
          source_ids: job.source_ids,
          fixture_ids: job.fixture_ids,
          provenance: job.provenance,
        }))),
      });
    },
    async listOpenJobs(workspaceId) {
      const rows = await request(
        `/xtrace_ingest_jobs?workspace_id=eq.${encodeURIComponent(workspaceId)}&status=in.(pending,running)&order=created_at.asc`,
      ) as Record<string, unknown>[];
      return rows.map(toIngestLineage);
    },
    async findReusableIngest(input) {
      const rows = await request(
        `/xtrace_ingest_jobs?workspace_id=eq.${encodeURIComponent(input.workspaceId)}&deal_id=eq.${encodeURIComponent(input.dealId)}&bundle_fingerprint=eq.${encodeURIComponent(input.bundleFingerprint)}&serializer_version=eq.${encodeURIComponent(input.serializerVersion)}&status=in.(pending,running,succeeded)&order=created_at.desc`,
      ) as Record<string, unknown>[];
      const row = rows.find((candidate) =>
        sameStringSet(
          Array.isArray(candidate.source_revision_ids)
            ? candidate.source_revision_ids.map(String)
            : [],
          input.sourceRevisionIds ?? [],
        )
        && sameStringSet(
          Array.isArray(candidate.source_ids) ? candidate.source_ids.map(String) : [],
          input.sourceIds,
        )
        && sameStringSet(
          Array.isArray(candidate.fixture_ids) ? candidate.fixture_ids.map(String) : [],
          input.fixtureIds,
        )
        && String(candidate.bundle_fingerprint) === input.bundleFingerprint
        && String(candidate.serializer_version) === input.serializerVersion
      );
      return row ? toIngestLineage(row) : null;
    },
    async resolve(input) {
      const direct = await request(
        `/xtrace_memory_links?memory_id=eq.${encodeURIComponent(input.memoryId)}&workspace_id=eq.${encodeURIComponent(input.workspaceId)}&limit=1`,
      ) as Record<string, unknown>[];
      return direct[0] ? toLineage(direct[0]) : null;
    },
    async reserveExactIntent({ parent, serializerVersion }) {
      const value = await request("/rpc/reserve_xtrace_ingest_intent_v2", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          p_intent: {
            intentId: exactIntentId(parent, serializerVersion),
            workspaceId: parent.workspaceId,
            dealId: parent.dealId,
            parentKind: parent.parentKind,
            sourceId: parent.sourceId,
            sourceRevisionId: parent.sourceRevisionId,
            parentFingerprint: parent.parentFingerprint,
            payloadFingerprint: parent.payloadFingerprint,
            serializerVersion,
          },
        }),
      });
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("The exact XTrace reserve RPC returned no result.");
      }
      const result = value as Record<string, unknown>;
      return {
        action: String(result.action) as "submit" | "wait" | "reuse" | "blocked",
        intent: toExactIntent((result.intent ?? result) as Record<string, unknown>),
      };
    },
    async waitForExactIntent(intentId) {
      const rows = await request(
        `/xtrace_ingest_intents_v2?intent_id=eq.${encodeURIComponent(intentId)}&limit=1`,
      ) as Record<string, unknown>[];
      if (!rows[0]) throw new Error("The exact XTrace intent does not exist.");
      return toExactIntent(rows[0]);
    },
    async attachExactJob(input) {
      return exactRpc("attach_xtrace_ingest_job_v2", {
        p_intent_id: input.intentId,
        p_lease_token: input.leaseToken,
        p_provider_job_id: input.providerJobId,
      });
    },
    async markExactSubmissionUnknown(input) {
      return exactRpc("mark_xtrace_submission_unknown_v2", {
        p_intent_id: input.intentId,
        p_lease_token: input.leaseToken,
      });
    },
    async advanceExactIntent(input) {
      return exactRpc("advance_xtrace_ingest_intent_v2", {
        p_intent_id: input.intentId,
        p_provider_job_id: input.providerJobId,
        p_state: input.state,
        p_memory_ids: input.memoryIds,
      });
    },
    async resolveExact(input) {
      const value = await request("/rpc/resolve_xtrace_memory_v2", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          p_workspace_id: input.workspaceId,
          p_memory_id: input.memoryId,
          p_deal_id: input.dealId,
          p_active_parent_fingerprint: input.activeParentFingerprint,
        }),
      });
      if (!value) return null;
      const row = Array.isArray(value) ? value[0] : value;
      return row && typeof row === "object"
        ? toLineage(row as Record<string, unknown>)
        : null;
    },
    async recordRecallAudit(input) {
      await request("/rpc/record_xtrace_recall_audit_v2", {
        method: "POST",
        body: JSON.stringify({ p_audit: input }),
      });
    },
  };
}

function exactParentKey(
  parent: ExactXTraceParentUnit,
  serializerVersion: string,
): string {
  return JSON.stringify([
    parent.workspaceId,
    parent.dealId,
    parent.parentKind,
    parent.sourceId,
    parent.sourceRevisionId,
    parent.parentFingerprint,
    serializerVersion,
  ]);
}

function exactIntentId(
  parent: ExactXTraceParentUnit,
  serializerVersion: string,
): string {
  return `xtrace_intent_${createHash("sha256")
    .update(exactParentKey(parent, serializerVersion), "utf8")
    .digest("hex")}`;
}

function requireExactIntent(
  intents: Map<string, XTraceIngestIntentV2>,
  intentId: string,
): XTraceIngestIntentV2 {
  const intent = intents.get(intentId);
  if (!intent) throw new Error("The exact XTrace intent does not exist.");
  return intent;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const expected = new Set(right);
  return left.every((value) => expected.has(value));
}

function lineageKey(workspaceId: string, externalId: string): string {
  return JSON.stringify([workspaceId, externalId]);
}

let singleton: XTraceLineageRepository | undefined;

export function getXTraceLineageRepository(): XTraceLineageRepository {
  if (singleton) return singleton;
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  singleton = url && serviceRoleKey
    ? createSupabaseXTraceLineageRepository({ url, serviceRoleKey })
    : createMemoryXTraceLineageRepository();
  return singleton;
}
