import {
  NamedLensProviderAttemptSchema,
  type NamedLensProviderAttempt,
} from "../../lib/contracts/named-lens";
import {
  IntegrationTransportError,
  isRetryableTransportStatus,
} from "../../lib/api/errors";
import { compareUtf8 } from "../../lib/format/canonical-order";

type AttemptIdentity = Pick<
  NamedLensProviderAttempt,
  | "workspaceId"
  | "artifactSourceCandidateRunId"
  | "judgmentOrCatalogCandidateId"
  | "logicalPassageId"
  | "attemptNumber"
  | "attemptFingerprint"
>;

export interface NamedLensProviderAttemptReservation extends AttemptIdentity {
  workerId: string;
  leaseToken: string;
}

export interface NamedLensProviderAttemptSettlement extends AttemptIdentity {
  workerId: string;
  leaseToken: string;
  status: "completed" | "failed" | "aborted";
  telemetry: NamedLensProviderAttempt["telemetry"];
  failureReason: NamedLensProviderAttempt["failureReason"];
}

export interface NamedLensArtifactsRepository {
  reserveAttempt(
    input: NamedLensProviderAttemptReservation,
  ): Promise<NamedLensProviderAttempt>;
  settleAttempt(
    input: NamedLensProviderAttemptSettlement,
  ): Promise<NamedLensProviderAttempt>;
  listAttempts(
    workspaceId: string,
    candidateRunId: string,
  ): Promise<NamedLensProviderAttempt[]>;
}

export interface MemoryNamedLensArtifactsRepository
  extends NamedLensArtifactsRepository {
  recordAttemptEvent(attempt: NamedLensProviderAttempt): void;
  listAttemptsSync(
    workspaceId: string,
    candidateRunId: string,
  ): NamedLensProviderAttempt[];
  inspect(): { rawAttemptEvents: NamedLensProviderAttempt[] };
}

export function createMemoryNamedLensArtifactsRepository():
  MemoryNamedLensArtifactsRepository {
  const rawEvents: NamedLensProviderAttempt[] = [];

  const recordAttemptEvent = (value: NamedLensProviderAttempt): void => {
    const attempt = NamedLensProviderAttemptSchema.parse(value);
    const matching = eventsFor(rawEvents, attempt);
    if (attempt.status === "reserved") {
      if (matching.length !== 0) {
        throw new Error("A duplicate Named Lens attempt reservation is forbidden.");
      }
      const priorReservations = rawEvents.filter((event) =>
        event.workspaceId === attempt.workspaceId
        && event.artifactSourceCandidateRunId
          === attempt.artifactSourceCandidateRunId
        && event.logicalPassageId === attempt.logicalPassageId
        && event.status === "reserved"
      );
      if (attempt.attemptNumber !== priorReservations.length + 1) {
        throw new Error("Named Lens attempt reservations must be monotonic.");
      }
    } else {
      const reservations = matching.filter(({ status }) => status === "reserved");
      const settlements = matching.filter(({ status }) => status !== "reserved");
      if (reservations.length !== 1) {
        throw new Error(
          "Named Lens settlement requires exactly one reserved attempt.",
        );
      }
      if (settlements.length !== 0) {
        throw new Error("The Named Lens provider attempt is already settled.");
      }
    }
    rawEvents.push(structuredClone(attempt));
  };
  const listAttemptsSync = (
    workspaceId: string,
    candidateRunId: string,
  ): NamedLensProviderAttempt[] => {
    requiredText(workspaceId, "A workspace");
    requiredText(candidateRunId, "A candidate run");
    return collapseNamedLensAttemptEvents(rawEvents.filter((event) =>
      event.workspaceId === workspaceId
      && event.artifactSourceCandidateRunId === candidateRunId
    ));
  };

  return {
    async reserveAttempt(input) {
      requiredText(input.workerId, "A worker");
      requiredText(input.leaseToken, "A lease token");
      const reserved = NamedLensProviderAttemptSchema.parse({
        ...attemptIdentity(input),
        status: "reserved",
        telemetry: null,
        failureReason: null,
      });
      recordAttemptEvent(reserved);
      return structuredClone(reserved);
    },

    async settleAttempt(input) {
      requiredText(input.workerId, "A worker");
      requiredText(input.leaseToken, "A lease token");
      const settled = NamedLensProviderAttemptSchema.parse({
        ...attemptIdentity(input),
        status: input.status,
        telemetry: input.telemetry,
        failureReason: input.failureReason,
      });
      recordAttemptEvent(settled);
      return structuredClone(settled);
    },

    async listAttempts(workspaceId, candidateRunId) {
      return listAttemptsSync(workspaceId, candidateRunId);
    },

    recordAttemptEvent,
    listAttemptsSync,

    inspect() {
      return { rawAttemptEvents: structuredClone(rawEvents) };
    },
  };
}

export function createSupabaseNamedLensArtifactsRepository(options: {
  url: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}): NamedLensArtifactsRepository {
  const base = `${options.url.replace(/\/$/, "")}/rest/v1`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = {
    apikey: options.serviceRoleKey,
    Authorization: `Bearer ${options.serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  const request = async (pathname: string, init: RequestInit = {}) => {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${pathname}`, {
        ...init,
        headers,
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
    const body = await response.text();
    return body.trim() ? JSON.parse(body) : null;
  };
  return {
    async reserveAttempt(input) {
      return NamedLensProviderAttemptSchema.parse(await request(
        "/rpc/reserve_named_lens_passage_attempt",
        { method: "POST", body: JSON.stringify({ p_payload: input }) },
      ));
    },
    async settleAttempt(input) {
      return NamedLensProviderAttemptSchema.parse(await request(
        "/rpc/settle_named_lens_passage_attempt",
        { method: "POST", body: JSON.stringify({ p_payload: input }) },
      ));
    },
    async listAttempts(workspaceId, candidateRunId) {
      requiredText(workspaceId, "A workspace");
      requiredText(candidateRunId, "A candidate run");
      const query = new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        candidate_run_id: `eq.${candidateRunId}`,
        select: "payload",
        order: "logical_passage_id.asc,attempt_no.asc,created_at.asc",
      });
      const rows = await request(
        `/named_lens_passage_attempt_events?${query}`,
      );
      if (!Array.isArray(rows)) {
        throw new Error("Named Lens attempt events returned an invalid result.");
      }
      return collapseNamedLensAttemptEvents(rows.map((row) =>
        NamedLensProviderAttemptSchema.parse(
          (row as Record<string, unknown>).payload,
        )
      ));
    },
  };
}

export function collapseNamedLensAttemptEvents(
  events: NamedLensProviderAttempt[],
): NamedLensProviderAttempt[] {
  const grouped = new Map<string, NamedLensProviderAttempt[]>();
  for (const event of events) {
    const key = logicalAttemptIdentity(event);
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }
  return [...grouped.values()].map((values) => {
    const reserved = values.filter(({ status }) => status === "reserved");
    const settled = values.filter(({ status }) => status !== "reserved");
    if (reserved.length !== 1 || settled.length > 1) {
      throw new Error("The raw Named Lens attempt event ledger is invalid.");
    }
    return structuredClone(settled[0] ?? reserved[0]!);
  }).sort((left, right) => compareUtf8(
    `${left.logicalPassageId}\u0000${left.attemptNumber}`,
    `${right.logicalPassageId}\u0000${right.attemptNumber}`,
  ));
}

function eventsFor(
  events: NamedLensProviderAttempt[],
  attempt: NamedLensProviderAttempt,
): NamedLensProviderAttempt[] {
  const key = logicalAttemptIdentity(attempt);
  return events.filter((event) => logicalAttemptIdentity(event) === key);
}

function attemptIdentity(input: AttemptIdentity): AttemptIdentity {
  return {
    workspaceId: requiredText(input.workspaceId, "A workspace"),
    artifactSourceCandidateRunId: requiredText(
      input.artifactSourceCandidateRunId,
      "An artifact source candidate run",
    ),
    judgmentOrCatalogCandidateId: requiredText(
      input.judgmentOrCatalogCandidateId,
      "A Named Lens catalog candidate",
    ),
    logicalPassageId: requiredText(
      input.logicalPassageId,
      "A logical passage",
    ),
    attemptNumber: input.attemptNumber,
    attemptFingerprint: requiredText(
      input.attemptFingerprint,
      "An attempt fingerprint",
    ),
  };
}

function logicalAttemptIdentity(input: AttemptIdentity): string {
  return [
    input.workspaceId,
    input.artifactSourceCandidateRunId,
    input.judgmentOrCatalogCandidateId,
    input.logicalPassageId,
    String(input.attemptNumber),
    input.attemptFingerprint,
  ].join("\u0000");
}

function requiredText(value: string, label: string): string {
  if (!value || value.trim() !== value) {
    throw new Error(`${label} is required without surrounding whitespace.`);
  }
  return value;
}
