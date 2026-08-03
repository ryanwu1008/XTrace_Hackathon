# Task 7 — exact-lineage XTrace and capacity-safe recall

## Outcome

- Plans the accepted fixture as exactly 23 Deals and 60 immutable XTrace parent units: 19 legacy source revisions, 37 canonical source revisions, and 4 Sample decision records.
- Reserves a versioned ingest intent before any provider POST. The v2 state machine records submission, polling, success/failure, and terminal `submission_unknown`; ambiguous submission outcomes cannot be resent automatically.
- Persists direct parent-to-memory lineage and resolves recall only through the active exact parent. Conversation-ID recovery and stale/cross-Deal lineage are rejected.
- Binds recall cache and durable audit rows to the evidence-context fingerprint and active-parent fingerprint. Audit persistence failure blocks only the affected Deal.
- Runs all primary Deal searches before at most two global transient retries, so 23 Deals require at most 25 searches. Normal process-run performs no ingest-job listing or polling.
- Preserves one Market analysis slot for every relevant Deal up to the hard cap of 25; the 23-Deal fixture is not truncated to 20.
- Adds local migration `0021_exact_xtrace_lineage.sql`; the production migration launcher remains authorized only through `0019`.
- Live XTrace construction now requires an explicit live authorization stage; ordinary and dry-run paths fail closed.
- Exposes the accepted-fixture runtime boundary as `npm run xtrace:ingest -- <workspace-id>`, which composes the authoritative planner and v2 service. Confirmed uploads use the same exact-parent v2 path; corpus confirmation no longer auto-submits whole-bundle v1 jobs.
- Reconciles an expired submitter lease atomically to terminal `submission_unknown`. Memory and Supabase waiters are bounded, late attach/unknown writes require the matching unexpired lease, and a jobless submitting stage is reported as blocked.
- Compares recall authority atomically in PostgreSQL: resolution joins the Deal's current active-parent fingerprint, while audit insertion and run/Deal fingerprint validation share one statement snapshot.

## TDD evidence

The initial contract tests failed for the old behavior: process-run polled ingest jobs, Market selected 20 of 23, three transient Deal failures produced 26 calls, malformed provider envelopes were accepted, Supabase recovered by conversation ID, and cache reuse ignored changed parent/context fingerprints. Each was made green by the implementation above.

The review follow-up tests also failed against the prior checkpoint: the confirmed path called v1 instead of v2, a jobless `submitting` intent was reported as recorded, expired reservations remained waiting, memory waiters remained pending, and PostgreSQL accepted stale run/Deal fingerprints. The follow-up implementation makes each contract fail closed.

## Verification

- `npm run typecheck`: exit 0.
- XTrace service: 42/42 pass, exit 0 (0.79 s).
- Process-run and recall: 18/18 pass, exit 0 (14.65 s).
- Market, exact-parent planner, and explicit ingest stage: 46/46 pass, exit 0 (2.81 s).
- Release and loopback safety: 33/33 pass, exit 0 (14.72 s).
- Fresh PostgreSQL 17 local migration group through `0021`: 15/15 pass, exit 0; the direct `0021` static and database cases are 2/2 pass.
- Production-baseline regression on the same reused temporary cluster: 40 pass, 1 fail, 3 skip. The sole failure is pre-existing test-state contamination: a prior migration fixture left global role `anon` as `NOINHERIT`, while that legacy test assumes `INHERIT`. All launcher, catalog, drift, and lock cases passed; no production launcher code was changed.
- `git diff --check`: exit 0.

Review follow-up verification:

- Runtime, confirmed-source, lease, planner, and XTrace focused group: 62/62 pass, exit 0.
- Fresh PostgreSQL 17 direct `0021` test, including stale fingerprints and expired lease reconciliation: 2/2 pass, exit 0 (5.22 s).
- `npm run typecheck`: exit 0.

## Safety notes

- No production, remote, model, storage, or live XTrace request was executed.
- The only database used was a disposable local PostgreSQL 17 cluster bound to loopback/its private Unix socket.
- Provider response bodies and submitted query text are not persisted in durable submission-unknown errors.
