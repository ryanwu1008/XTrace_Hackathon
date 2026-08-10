import type { NamedLensCandidateLeaseAuthority } from
  "../../db/repositories/named-lens-artifacts";

/**
 * Low-level attempt-ledger tests deliberately isolate event semantics from the
 * Candidate lease lifecycle. Production compositions must inject the shared
 * authority owned by their underwriting-runs repository instead.
 */
export function createTestNamedLensCandidateLeaseAuthority():
  NamedLensCandidateLeaseAuthority {
  return {
    assertActiveCanonicalCandidateLease() {
      // Explicit test-only authority for ledger-focused fixtures.
    },
  };
}
