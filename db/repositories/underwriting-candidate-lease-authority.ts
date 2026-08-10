import {
  CandidateRunSchema,
  type CandidateRun,
} from "../../lib/contracts/underwriting";
import type { NamedLensCandidateLeaseAuthority } from
  "./named-lens-artifacts";

export interface MemoryCandidateLease {
  workerId: string;
  token: string;
  expiresAt: string;
}

export interface MemoryUnderwritingCandidateLeaseAuthority
  extends NamedLensCandidateLeaseAuthority {
  getCandidate(candidateRunId: string): CandidateRun | null;
  listCandidates(): CandidateRun[];
  saveCandidate(candidate: CandidateRun): void;
  getLease(candidateRunId: string): MemoryCandidateLease | null;
  saveLease(candidateRunId: string, lease: MemoryCandidateLease): void;
  deleteLease(candidateRunId: string): void;
}

export function createMemoryUnderwritingCandidateLeaseAuthority(options: {
  now?: () => Date;
} = {}): MemoryUnderwritingCandidateLeaseAuthority {
  const now = options.now ?? (() => new Date());
  const candidates = new Map<string, CandidateRun>();
  const leases = new Map<string, MemoryCandidateLease>();

  return {
    getCandidate(candidateRunId) {
      const candidate = candidates.get(candidateRunId);
      return candidate ? structuredClone(candidate) : null;
    },
    listCandidates() {
      return [...candidates.values()].map((candidate) =>
        structuredClone(candidate)
      );
    },
    saveCandidate(candidate) {
      const parsed = CandidateRunSchema.parse(candidate);
      candidates.set(parsed.id, structuredClone(parsed));
    },
    getLease(candidateRunId) {
      const lease = leases.get(candidateRunId);
      return lease ? structuredClone(lease) : null;
    },
    saveLease(candidateRunId, lease) {
      const expiresAt = requiredText(lease.expiresAt, "A lease expiry");
      const expiryMs = Date.parse(expiresAt);
      if (
        !Number.isFinite(expiryMs)
        || new Date(expiryMs).toISOString() !== expiresAt
      ) {
        throw new Error("A lease expiry must be a canonical ISO timestamp.");
      }
      leases.set(requiredText(candidateRunId, "A candidate run"), {
        workerId: requiredText(lease.workerId, "A worker"),
        token: requiredText(lease.token, "A lease token"),
        expiresAt,
      });
    },
    deleteLease(candidateRunId) {
      leases.delete(requiredText(candidateRunId, "A candidate run"));
    },
    assertActiveCanonicalCandidateLease(input) {
      const candidate = candidates.get(input.candidateRunId);
      const lease = leases.get(input.candidateRunId);
      const expiryMs = lease ? Date.parse(lease.expiresAt) : Number.NaN;
      if (
        !candidate
        || candidate.workspaceId !== input.workspaceId
        || candidate.status !== "running"
        || candidate.artifactSourceCandidateRunId != null
        || !lease
        || lease.workerId !== input.workerId
        || lease.token !== input.leaseToken
        || !Number.isFinite(expiryMs)
        || expiryMs <= now().getTime()
      ) {
        throw new Error(
          "Named Lens attempt requires the running canonical Candidate lease.",
        );
      }
    },
  };
}

export function isMemoryUnderwritingCandidateLeaseAuthority(
  value: NamedLensCandidateLeaseAuthority,
): value is MemoryUnderwritingCandidateLeaseAuthority {
  const candidate = value as Partial<MemoryUnderwritingCandidateLeaseAuthority>;
  return typeof candidate.getCandidate === "function"
    && typeof candidate.listCandidates === "function"
    && typeof candidate.saveCandidate === "function"
    && typeof candidate.getLease === "function"
    && typeof candidate.saveLease === "function"
    && typeof candidate.deleteLease === "function";
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}
