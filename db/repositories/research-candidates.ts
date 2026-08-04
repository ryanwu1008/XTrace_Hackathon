import { createHash } from "node:crypto";

import {
  PublicEvidenceMemoryPayloadSchema,
  ResearchCandidateDispositionMemoryPairSchema,
  ResearchEvidenceGapSchema,
  type PublicEvidenceMemoryPayload,
  type ResearchCandidate,
  type ResearchDispositionMemoryPayload,
  type ResearchEvidenceGap,
} from "../../lib/contracts/research-candidate";
import { canonicalEvidenceJson } from "../../lib/contracts/source-evidence";
import {
  IntegrationTransportError,
  isRetryableTransportStatus,
} from "../../lib/api/errors";

export interface ResearchCandidateSourceBinding {
  sourceId: string;
  sourceRevisionId: string;
  sourceRevisionFingerprint: string;
  payload: PublicEvidenceMemoryPayload | ResearchDispositionMemoryPayload;
}

export interface SaveResearchCandidateBundleInput {
  candidate: ResearchCandidate;
  dispositionMemory: ResearchDispositionMemoryPayload;
  activeParentFingerprint: string;
  sources: ResearchCandidateSourceBinding[];
  evidenceGap: ResearchEvidenceGap | null;
}

export interface ResearchCandidateSaveResult {
  created: {
    candidate: number;
    sourceAssignments: number;
    evidenceGaps: number;
  };
}

export interface ResearchCandidatesRepository {
  saveBundle(
    input: SaveResearchCandidateBundleInput,
  ): Promise<ResearchCandidateSaveResult>;
}

export interface MemoryResearchCandidatesRepository
  extends ResearchCandidatesRepository {
  inspect(): {
    candidates: ResearchCandidate[];
    sourceBindings: ResearchCandidateSourceBinding[];
    evidenceGaps: ResearchEvidenceGap[];
  };
}

export function createMemoryResearchCandidatesRepository():
  MemoryResearchCandidatesRepository {
  const candidates = new Map<string, ResearchCandidate>();
  const sourceBindings = new Map<string, ResearchCandidateSourceBinding>();
  const evidenceGaps = new Map<string, ResearchEvidenceGap>();
  return {
    async saveBundle(rawInput) {
      const input = validateBundle(rawInput);
      let candidateCreated = 0;
      let sourceAssignmentsCreated = 0;
      let evidenceGapsCreated = 0;
      candidateCreated += saveImmutable(
        candidates,
        identity(input.candidate.workspaceId, input.candidate.id),
        input.candidate,
        "Research candidate",
      );
      for (const binding of input.sources) {
        sourceAssignmentsCreated += saveImmutable(
          sourceBindings,
          identity(
            input.candidate.workspaceId,
            input.candidate.id,
            binding.sourceId,
            binding.sourceRevisionId,
          ),
          binding,
          "Research source binding",
        );
      }
      if (input.evidenceGap) {
        evidenceGapsCreated += saveImmutable(
          evidenceGaps,
          identity(
            input.candidate.workspaceId,
            input.candidate.id,
            input.evidenceGap.id,
          ),
          input.evidenceGap,
          "Research evidence gap",
        );
      }
      return {
        created: {
          candidate: candidateCreated,
          sourceAssignments: sourceAssignmentsCreated,
          evidenceGaps: evidenceGapsCreated,
        },
      };
    },
    inspect() {
      return {
        candidates: [...candidates.values()].map((value) =>
          structuredClone(value)
        ),
        sourceBindings: [...sourceBindings.values()].map((value) =>
          structuredClone(value)
        ),
        evidenceGaps: [...evidenceGaps.values()].map((value) =>
          structuredClone(value)
        ),
      };
    },
  };
}

export function createSupabaseResearchCandidatesRepository(options: {
  url: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}): ResearchCandidatesRepository {
  const base = `${options.url.replace(/\/$/u, "")}/rest/v1`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = {
    apikey: options.serviceRoleKey,
    authorization: `Bearer ${options.serviceRoleKey}`,
    "content-type": "application/json",
  };
  const request = async (
    pathname: string,
    init: RequestInit = {},
  ): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${pathname}`, {
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
    return text.trim() ? JSON.parse(text) : null;
  };
  const rpc = async (name: string, payload: unknown) => {
    const response = await request(`/rpc/${name}`, {
      method: "POST",
      body: JSON.stringify({ p_payload: payload }),
    });
    if (!response || typeof response !== "object") {
      throw new Error(`Research registry RPC ${name} returned no result.`);
    }
    return response as Record<string, unknown>;
  };
  const assignmentId = async (input: {
    workspaceId: string;
    dealId: string;
    sourceId: string;
    sourceRevisionId: string;
  }): Promise<string> => {
    const query = new URLSearchParams({
      workspace_id: `eq.${input.workspaceId}`,
      deal_id: `eq.${input.dealId}`,
      source_id: `eq.${input.sourceId}`,
      source_revision_id: `eq.${input.sourceRevisionId}`,
      superseded_at: "is.null",
      select: "id",
      limit: "2",
    });
    const rows = await request(`/deal_source_assignments?${query}`);
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw new Error(
        "Research source binding requires one exact active Deal assignment.",
      );
    }
    return requiredText((rows[0] as Record<string, unknown>).id, "assignment id");
  };
  return {
    async saveBundle(rawInput) {
      const input = validateBundle(rawInput);
      const context = input.candidate.evidenceContext;
      const candidatePayload = input.candidate;
      const candidateResult = await rpc("save_research_candidate_v1", {
        schemaVersion: "research-candidate-v1",
        workspaceId: input.candidate.workspaceId,
        candidateId: input.candidate.id,
        companyId: input.candidate.companyId,
        dealId: input.candidate.stableDealId,
        disposition: input.candidate.disposition,
        evidenceMode: context.mode,
        snapshotId: context.snapshotId,
        snapshotFingerprint: context.snapshotFingerprint,
        anchorAt: context.anchorAt,
        entityKeys: input.candidate.entityKeys,
        activeParentFingerprint: input.activeParentFingerprint,
        payload: candidatePayload,
        payloadFingerprint: payloadFingerprint(candidatePayload),
      });
      let sourceAssignmentsCreated = 0;
      for (const binding of input.sources) {
        const dealAssignmentId = await assignmentId({
          workspaceId: input.candidate.workspaceId,
          dealId: input.candidate.stableDealId,
          sourceId: binding.sourceId,
          sourceRevisionId: binding.sourceRevisionId,
        });
        const publicSource = binding.payload.memoryKind === "public_evidence"
          ? binding.payload.source
          : null;
        const isPublic = publicSource !== null;
        const result = await rpc(
          "save_research_candidate_source_assignment_v1",
          {
            schemaVersion: "research-candidate-source-assignment-v1",
            workspaceId: input.candidate.workspaceId,
            candidateId: input.candidate.id,
            dealId: input.candidate.stableDealId,
            dealAssignmentId,
            parentKind: isPublic ? "public_evidence" : "research_disposition",
            xtraceParentKind: isPublic
              ? "canonical_source_revision"
              : "sample_research_screening_record",
            claimClass: isPublic ? "fact" : "research_disposition",
            sourceId: binding.sourceId,
            sourceRevisionId: binding.sourceRevisionId,
            sourceRevisionFingerprint: binding.sourceRevisionFingerprint,
            sourceRole: isPublic
              ? "public_web_snapshot"
              : "sample_research_screening_record",
            sourceClass: publicSource?.sourceClass ?? "internal_decision_record",
            sourceAuthority: publicSource?.sourceAuthority ?? "primary",
            evidenceRole: publicSource?.evidenceRole ?? "context",
            canonicalUrl: publicSource?.canonicalUrl ?? null,
            eventAt: publicSource?.eventAt ?? null,
            eventAtPrecision: publicSource?.eventAt === null || !publicSource
              ? null
              : "date",
            publishedAt: publicSource?.publicationTimestamp
              ?? publicSource?.publishedAt
              ?? null,
            publishedAtPrecision: publicSource
              ? publicSource.publicationTimestamp === null
                ? publicSource.publishedAt === null ? null : "date"
                : "timestamp"
              : null,
            retrievedAt: publicSource?.retrievedAt
              ?? input.dispositionMemory.recordedAt,
            retrievedAtPrecision: publicSource ? "date" : "timestamp",
            snapshotId: context.snapshotId,
            snapshotFingerprint: context.snapshotFingerprint,
            anchorAt: context.anchorAt,
            entityKeys: input.candidate.entityKeys,
            activeParentFingerprint: input.activeParentFingerprint,
            payload: binding.payload,
            payloadFingerprint: payloadFingerprint(binding.payload),
          },
        );
        if (result.created === true) sourceAssignmentsCreated += 1;
      }
      let evidenceGapsCreated = 0;
      if (input.evidenceGap) {
        const result = await rpc("save_research_candidate_evidence_gap_v1", {
          schemaVersion: "research-candidate-evidence-gap-v1",
          workspaceId: input.candidate.workspaceId,
          candidateId: input.candidate.id,
          dealId: input.candidate.stableDealId,
          gapId: input.evidenceGap.id,
          gapKind: "unresolved_source",
          sourceLabel:
            `${input.evidenceGap.publisher}: ${input.evidenceGap.title}`,
          surfacedUrl: input.evidenceGap.surfacedUrl,
          reason: input.evidenceGap.reason,
          snapshotId: context.snapshotId,
          snapshotFingerprint: context.snapshotFingerprint,
          anchorAt: context.anchorAt,
          activeParentFingerprint: input.activeParentFingerprint,
          entityKeys: input.candidate.entityKeys,
          payload: input.evidenceGap,
          payloadFingerprint: payloadFingerprint(input.evidenceGap),
        });
        if (result.created === true) evidenceGapsCreated = 1;
      }
      return {
        created: {
          candidate: candidateResult.created === true ? 1 : 0,
          sourceAssignments: sourceAssignmentsCreated,
          evidenceGaps: evidenceGapsCreated,
        },
      };
    },
  };
}

function validateBundle(
  input: SaveResearchCandidateBundleInput,
): SaveResearchCandidateBundleInput {
  const pair = ResearchCandidateDispositionMemoryPairSchema.parse({
    candidate: input.candidate,
    dispositionMemory: input.dispositionMemory,
  });
  const sources = input.sources.map((binding) => {
    const payload = binding.payload.memoryKind === "public_evidence"
      ? PublicEvidenceMemoryPayloadSchema.parse(binding.payload)
      : pair.dispositionMemory;
    if (
      payload.workspaceId !== pair.candidate.workspaceId
      || payload.candidateId !== pair.candidate.id
      || payload.stableDealId !== pair.candidate.stableDealId
      || (payload.memoryKind === "public_evidence"
        && (
          payload.source.sourceId !== binding.sourceId
          || payload.source.sourceRevisionId !== binding.sourceRevisionId
          || payload.source.contentFingerprint
            !== binding.sourceRevisionFingerprint
        ))
      || (payload.memoryKind === "research_disposition"
        && payload.id !== pair.candidate.sampleResearchScreeningRecordId)
      || !/^sha256:[0-9a-f]{64}$/u.test(binding.sourceRevisionFingerprint)
    ) {
      throw new Error("Research source binding lost exact Deal lineage.");
    }
    return structuredClone({ ...binding, payload });
  });
  if (
    sources.length < 2
    || sources.filter(({ payload }) =>
      payload.memoryKind === "research_disposition"
    ).length !== 1
    || new Set(sources.map(({ sourceRevisionId }) => sourceRevisionId)).size
      !== sources.length
    || !/^sha256:[0-9a-f]{64}$/u.test(input.activeParentFingerprint)
  ) {
    throw new Error(
      "Research candidate requires unique exact public and screening parents.",
    );
  }
  const evidenceGap = input.evidenceGap
    ? ResearchEvidenceGapSchema.parse(input.evidenceGap)
    : null;
  if (
    evidenceGap
    && (
      evidenceGap.candidateId !== pair.candidate.id
      || evidenceGap.stableDealId !== pair.candidate.stableDealId
      || evidenceGap.memoryEligible
    )
  ) {
    throw new Error("Research evidence gap escaped candidate scope.");
  }
  return {
    candidate: pair.candidate,
    dispositionMemory: pair.dispositionMemory,
    activeParentFingerprint: input.activeParentFingerprint,
    sources,
    evidenceGap,
  };
}

function payloadFingerprint(payload: unknown): string {
  return `sha256:${createHash("sha256")
    .update(canonicalEvidenceJson(payload), "utf8")
    .digest("hex")}`;
}

function saveImmutable<T>(
  target: Map<string, T>,
  key: string,
  value: T,
  label: string,
): number {
  const existing = target.get(key);
  if (existing && canonicalEvidenceJson(existing) !== canonicalEvidenceJson(value)) {
    throw new Error(`${label} identity has different immutable content.`);
  }
  if (existing) return 0;
  target.set(key, structuredClone(value));
  return 1;
}

function identity(...values: string[]): string {
  return JSON.stringify(values);
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Research ${label} is required.`);
  }
  return value;
}

let singleton: ResearchCandidatesRepository | undefined;

export function getResearchCandidatesRepository():
  ResearchCandidatesRepository {
  if (singleton) return singleton;
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  singleton = url && serviceRoleKey
    ? createSupabaseResearchCandidatesRepository({ url, serviceRoleKey })
    : createMemoryResearchCandidatesRepository();
  return singleton;
}
