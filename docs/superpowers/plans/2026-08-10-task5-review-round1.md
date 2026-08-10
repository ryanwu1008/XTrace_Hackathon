# Task 5 Reviewer Round 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the PostgreSQL 0027 finalization boundary reject fabricated catalog applicability, ungrounded passages/presentations, null or missing identity/version fields, orphan attempts, and unauthorized artifact lifecycle operations.

**Architecture:** Keep Task 2 TypeScript validation unchanged and harden the independent service-role SQL boundary in `assert_named_lens_presentation_finalization_0027`. Build JSON authority sets from the already-saved Evidence Pack and current judgments, use null-safe typed checks throughout, and validate every provider event/ref and presentation citation before the existing atomic inserts.

**Tech Stack:** PostgreSQL 17.6 PL/pgSQL/JSONB, Node.js test runner with TypeScript/tsx, Docker `postgres:17.6`, and in-network-namespace `alpine/socat` loopback proxy.

## Global Constraints

- Every database gate uses a newly created disposable PostgreSQL 17.6 container and new in-namespace `socat` proxy.
- Never use host/shared development, Staging, or production PostgreSQL.
- Preserve the legacy Task 9 adapter and its zero-0027-row assertion.
- Do not edit the production migration launcher or exact SAFE_REFUSAL script.
- Do not implement Task 6 memory/Supabase partial-alias behavior.
- Write and observe failing tests before changing `drizzle/0027_named_lens_passages.sql`.

---

### Task 1: Add SQL trust-boundary RED cases

**Files:**
- Modify: `tests/integration/underwriting-presentation-migration.test.ts`

**Interfaces:**
- Consumes: `currentPayload()`, `reserveAndSettleAttempts()`, and the service-role `finalize_or_reuse_candidate_underwriting(jsonb)` RPC.
- Produces: atomic rejection coverage for each reviewer exploit.

- [ ] Add a literal four-to-two mutation: retain four saved applicable advisory judgments, relabel two catalog rows/dispositions `context_inapplicable`, remove their passages/selection refs, and assert completed `limited_framework_coverage` is rejected with zero artifact rows.
- [ ] Add independent fabricated premise, foreign case evidence, foreign unknown/limitation, foreign selected judgment, foreign synthesis/segment citation, projection-membership, and conclusion stance/posture mutations.
- [ ] Add a table-driven five-version matrix covering omitted, JSON null, wrong type, and wrong value, plus omitted/null/wrong-type nested workspace/Candidate identity for projection, catalog, disposition, passage, and presentation.
- [ ] Add one extra reserved/settled foreign catalog attempt and exact attempt ref; assert finalization rejects it atomically.
- [ ] Add behavior checks for exact three-column Candidate FKs, candidate-owner insert trigger, direct TRUNCATE refusal for `anon`, `authenticated`, and `service_role`, settle-before-reserve, non-monotonic reserve, duplicate terminal settlement, reserve/settle fingerprint mismatch, and late reserve/settle.

### Task 2: Verify RED on fresh PostgreSQL 17.6

**Files:**
- Modify: `.superpowers/sdd/2026-08-10-underwriting-prose-and-named-lens-relevance/task-5-report.md`

**Interfaces:**
- Consumes: the Task 1 test matrix.
- Produces: reproducible proof that current 0027 accepts reviewer exploits or lacks the required constraints.

- [ ] Start a new `postgres:17.6` container with a published unused proxy port and a new `alpine/socat` container using `--network container:<pg-id>`.
- [ ] Run only `tests/integration/underwriting-presentation-migration.test.ts` with `REQUIRE_POSTGRES_MIGRATION_TESTS=1`.
- [ ] Confirm failures are the intended accepted-forgery/missing-guard failures, record container identities and counts in the report, then remove both containers.

### Task 3: Harden current/version/catalog identity authority

**Files:**
- Modify: `drizzle/0027_named_lens_passages.sql`

**Interfaces:**
- Consumes: saved `p_payload->'judgments'`, the five current version keys, catalog/disposition arrays, and Candidate-local function arguments.
- Produces: fail-closed typed current classification and exact saved-judgment catalog authority.

- [ ] Replace key-presence counting with five exact nonempty string values or zero keys; reject JSON null and non-string values.
- [ ] Replace required JSON identity `<>` checks with typed nonempty text checks and `IS DISTINCT FROM` comparisons.
- [ ] Require `judgment_eligible` catalog entries to have a non-null ID resolving exactly once to a current advisory judgment with the same ID/Card/version; require context-inapplicable/ineligible entries to have null judgment IDs and no matching applicable saved judgment.
- [ ] Keep catalog/disposition cardinality and UTF-8 order validation, but make every nested identity null-safe.

### Task 4: Deep-ground passages and presentations

**Files:**
- Modify: `drizzle/0027_named_lens_passages.sql`

**Interfaces:**
- Consumes: saved Evidence Pack facts/assumptions, projection evidence refs, saved advisory judgment partitions/metadata, passage segments, decision refs, selected dispositions, and presentation citations.
- Produces: database-authoritative segment and presentation validation before insertion.

- [ ] Resolve projection evidence ID/classification uniquely to saved facts/assumptions; require disposition selection basis and critical evidence to be within the projection and pack.
- [ ] Resolve passage case/counter evidence to the saved judgment support/counter partitions; resolve unknown/limitation refs and counterevidence request refs exactly; bind conclusion stance/posture and selection basis to the disposition/judgment.
- [ ] Resolve premise component ID/version/Card field/source/claim/locator/attribution against `frameworkMetadata.components` and `frameworkMetadata.sources`.
- [ ] Derive selected judgment order from contiguous positions and require exact first-screen selected IDs; resolve decision evidence, synthesis refs, and every segment citation only to the corresponding persisted passage segment.

### Task 5: Close attempt and ACL/lifecycle gaps

**Files:**
- Modify: `drizzle/0027_named_lens_passages.sql`
- Test: `tests/integration/underwriting-presentation-migration.test.ts`

**Interfaces:**
- Consumes: immutable attempt events, attempt refs, catalog/disposition identities, table ACLs, and candidate-owner triggers.
- Produces: exact authorized attempt coverage and fail-closed artifact lifecycle.

- [ ] Require each attempt ref and each persisted event pair to map to exactly one authorized catalog row and matching disposition.
- [ ] Preserve reserve-before-settle, monotonic numbering, exact fingerprint, one terminal event, running canonical lease, and late-terminal refusal.
- [ ] Explicitly revoke TRUNCATE along with all DML from exposed roles and validate six composite FK column sets and six owner triggers via catalog queries.

### Task 6: Fresh GREEN, regression, report, and commit

**Files:**
- Modify: `.superpowers/sdd/2026-08-10-underwriting-prose-and-named-lens-relevance/task-5-report.md`

**Interfaces:**
- Consumes: Tasks 3–5.
- Produces: verified Task 5 round-1 commit and handoff evidence.

- [ ] Run the focused suite on a new disposable PostgreSQL 17.6 cluster; remove it after the gate.
- [ ] Run the four-file broad Task 5 migration suite on another new disposable PostgreSQL 17.6 cluster; remove it after the gate.
- [ ] Run `npm run typecheck`, static/contract/release tests, `git diff --check`, production-launcher diff, container/process cleanup, and line-by-line self-review.
- [ ] Append RED/GREEN identities, exact counts, reviewer resolutions, and residual risks to the Task 5 report.
- [ ] Commit only this round’s scoped files with `fix: harden named lens finalization authority` and report the SHA.
