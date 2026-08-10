# Task 5 Reviewer Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject a current Named Lens finalization that omits applicable advisory judgments from the submitted eligible catalog.

**Architecture:** Keep the round-1 forward catalog-to-judgment validation and add its inverse at the SQL finalization boundary. Every authoritative applicable advisory judgment must resolve to exactly one `judgment_eligible` catalog row with the same judgment ID, catalog Candidate ID, Card ID, and Card version; catalogs with genuinely zero through three such judgments remain valid.

**Tech Stack:** PostgreSQL 17.6 PL/pgSQL/JSONB, Node.js `node:test` with TypeScript/tsx, Docker `postgres:17.6`, and in-network-namespace `alpine/socat`.

## Global Constraints

- Use a new disposable PostgreSQL 17.6 cluster and namespace-sharing socat proxy for every RED, focused GREEN, and broad database gate.
- Preserve legacy Task 9 zero-row behavior and genuine zero-to-three applicable coverage.
- Do not change Task 6 memory/Supabase behavior, production launchers, or the SAFE_REFUSAL command.

---

### Task 1: Prove the omission exploit

**Files:**
- Modify: `tests/integration/underwriting-presentation-migration.test.ts`

**Interfaces:**
- Consumes: `currentPayload()`, `reserveAndSettleAttempts()`, and `finalize_or_reuse_candidate_underwriting(jsonb)`.
- Produces: one atomic rejection regression for omitted applicable judgments.

- [ ] Add an attack that keeps all four saved applicable advisory judgments, slices catalog, dispositions, attempts, passages, synthesis, citations, and first-screen selected IDs to two, settles only those two attempts, and submits `limited_framework_coverage`.
- [ ] Assert the finalization error names catalog/judgment/coverage authority and the sum of all inserted 0027 artifact tables remains zero.
- [ ] Run the focused test on a fresh cluster and record the expected accepted-exploit RED.

### Task 2: Add inverse catalog authority

**Files:**
- Modify: `drizzle/0027_named_lens_passages.sql`

**Interfaces:**
- Consumes: authoritative saved judgments and submitted catalog rows.
- Produces: bidirectional one-to-one equality for applicable advisory judgments and eligible catalog rows.

- [ ] For every saved object with `analysisType = framework_judgment`, `applicability = applicable`, conclusion in `supportive | mixed | negative`, and object `frameworkMetadata`, require exactly one catalog row whose initial disposition is `judgment_eligible` and whose judgment ID, catalog Candidate ID, Card ID, and Card version all equal the judgment.
- [ ] Keep the existing catalog-row-to-judgment check unchanged so both directions are enforced.
- [ ] Run the focused suite on a new cluster and require every test to pass.

### Task 3: Verify and hand off

**Files:**
- Modify: `.superpowers/sdd/2026-08-10-underwriting-prose-and-named-lens-relevance/task-5-report.md`
- Modify: `.superpowers/sdd/2026-08-10-underwriting-prose-and-named-lens-relevance/progress.md`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: immutable review-round commit and exact verification evidence.

- [ ] Run the four-file broad migration suite on a separate fresh cluster.
- [ ] Run typecheck, static/contract/release tests, SAFE_REFUSAL/launcher diff, `git diff --check`, container cleanup, and final diff review.
- [ ] Append exact RED/GREEN identities and counts to the Task 5 report and ledger.
- [ ] Commit the SQL, regression test, and this plan with `fix: require complete named lens catalog authority`.
