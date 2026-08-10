# Task 6 report — repository, bundle, partial, and alias implementation

## Status

Implemented and verified on `feat/backend-integration-checkpoint` from base
`75fa55178f8e530aace4cad93a133ee96b35a95b`. Task 6 only: no production,
Staging, shared database, migration application, hosting, deployment, or push.
Task 7 remains the owner of the presentation DAG, refresh-nonce propagation,
and Candidate-ID-independent fingerprint normalization.

## Implementation

- Added one explicit `NamedLensArtifactsRepository` with memory and Supabase
  reserve, settle, and list paths. Persistence keeps two immutable raw events;
  reads validate and collapse them to one logical attempt. Duplicate reserve,
  orphan settle, non-monotonic attempts, and a second terminal settlement fail
  closed.
- Forwarded Named Lens judgment/catalog identity, logical passage identity, and
  physical attempt number only for authorized advisory provider calls. Core
  framework calls never claim Named Lens persistence identity.
- Wired provider execution in the required order: validate running stage,
  reserve durable attempt, reserve the checkpoint ledger, then dispatch the
  provider. A checkpoint-reservation failure persists an aborted durable event
  before returning failure.
- Added timeout ownership for active attempts. Timeout/abort settles both
  durable and checkpoint ledgers once; late provider resolution or rejection
  cannot write a second terminal event.
- Extended measured completions and Named Lens telemetry to pass through exact
  versioned provider USD cost when present and otherwise persist an explicit
  `provider_cost_unavailable` state. Abstract cost units are never represented
  as dollars.
- Extended Candidate and artifact read contracts with requested Candidate
  identity, explicit canonical `sourceCandidateRunId`, terminal status/reasons,
  the decision-critical projection, attempt refs, catalog considerations,
  dispositions, reconstructed passages, and presentation.
- Implemented one-hop alias validation in memory and Supabase: same workspace,
  Deal, fingerprint, status, and reasons; canonical sources cannot themselves
  be aliases. Supabase reads use the source Candidate's batch and pinned Fund
  Policy while returning the requested Candidate identity.
- Reconstructed each passage from exactly five ordered segment rows and the
  catalog one-for-one from the exact consideration saved on each disposition.
  Raw segment rows remain persistence/audit authority rather than a second
  bundle shape.
- Made current finalization all-or-none and fail closed across ownership,
  catalog/disposition cardinality, projection binding, exact settled attempts,
  passage/judgment/evidence provenance, selected positions, presentation refs,
  current versions, and terminal coverage semantics. Explicit persisted-read
  mode continues to support immutable legacy bundles without current fields.
- Reuse now admits canonical `completed | partial` artifacts. Aliases inherit
  the source terminal state and create no child artifact rows. A Named Lens
  partial retains formal scenario/calculation/valuation/decision/framework/
  draft artifacts; full US evidence-complete finalization rejects placeholder
  substitution.
- Injected one shared Named Lens repository through worker, runs repository,
  artifact repository, orchestrator, and stage runtime. No singleton was added.

## TDD evidence

The initial nominal four-file run was intentionally red after current versions
were pinned:

```text
tests 81
pass 52
fail 20
skipped 9
```

The failures exposed incomplete current fixtures, missing shared repository
wiring, stale completed-only reuse expectations, incomplete row-count shapes,
and legacy/current read ambiguity. Focused RED cases also proved:

- an incomplete finalize RPC response was trusted instead of rereading target
  and source Candidates;
- a full US evidence-complete Named Lens partial accepted unavailable formal
  placeholders;
- a late provider rejection could overwrite an already aborted timeout;
- the real 8-core/20-advisory path initially failed attempt coverage because
  one authoritative catalog composite was context-inapplicable and required
  no provider attempt.

The final real-catalog fixture preserves all 20 catalog/disposition rows and
truthfully persists 19 logical attempts / 38 raw reserve-settle events.

## Final verification

```text
Task 6 seven-file cohort:
tests 118; pass 109; fail 0; skipped 9

Final eight-file cohort including Named Lens contracts:
tests 125; pass 116; fail 0; skipped 9

Nominal four-file cohort:
tests 81; pass 72; fail 0; skipped 9

Additional Task 6 unit cohort:
tests 37; pass 37; fail 0; skipped 0

0027 migration static gate:
tests 6; pass 1; fail 0; skipped 5 (explicit PostgreSQL opt-in)

npm run typecheck: exit 0
npm run lint: exit 0, zero warnings
git diff --check: exit 0
```

## Independent review round 3

The follow-up review found two additional fail-closed composition edges and
one missing same-size authority-substitution regression. All three were
reproduced RED and fixed before commit:

1. An explicitly supplied memory artifact repository could own a different
   Named Lens ledger from the one supplied to underwriting runs. Memory
   artifacts and runs now expose the selected repository identity, adopt the
   artifact-owned repository when it is the only supplied instance, and reject
   every split-ledger composition.
2. A malformed lease expiry parsed to `NaN`, which made the old `<= now`
   comparison fail open. The shared authority now requires a canonical ISO
   timestamp when saving a lease and rechecks a finite parsed expiry whenever
   the lease authorizes a write.
3. Equal-sized advisory catalogs can no longer substitute a different
   framework identity or version without a direct negative regression proving
   finalization rejects the mismatch.

The Candidate/lease store was moved into an instance-scoped repository module
so default artifacts-only memory compositions can share the same full
authority without a circular dependency or singleton.

Fresh final verification:

```text
Task 6 eight-file cohort:
tests 133; pass 124; fail 0; skipped 9

npm run typecheck: exit 0
npm run lint: exit 0, zero warnings
git diff --check: exit 0
```

The five PostgreSQL-backed skips in the static 0027 file and nine historical
integration skips in the nominal cohort require explicit database opt-in;
Task 5 already recorded fresh PostgreSQL 17.6 focused and broad GREEN gates.

## Nine controller decisions — self-review

1. Requested/source identity: implemented with explicit source identity and
   one-hop same-authority alias validation.
2. Raw/logical attempts: two immutable events, validated collapse, raw global
   row counts, and duplicate/orphan guards are covered.
3. Provider ordering: durable reserve precedes checkpoint reserve and provider
   I/O; checkpoint failure aborts durable state.
4. Timeout/abort: one terminal outcome wins; both late resolution and late
   rejection regressions are green.
5. Cost telemetry: exact versioned USD passes through; unknown cost is explicit
   and never fabricated from abstract units. Non-null USD without a non-null
   pricing version now fails contract validation.
6. Partial artifacts: formal artifacts remain authoritative; placeholder
   substitution is rejected at the full/US evidence-complete structural
   boundary, and an available formal decision may not be erased even when
   non-minimum critical evidence remains incomplete. Exact stage-output binding
   remains Task 7.
7. Replay/refresh: completed and partial canonical reuse is enabled; aliases
   inherit state and copy no children. No DAG, refresh nonce, or fingerprint
   normalization was added.
8. Passage reads: exactly five segment rows reconstruct the sole typed passage
   bundle shape; incomplete/orphan segments fail closed.
9. Catalog reads: catalog authority is reconstructed one-for-one from saved
   disposition considerations, never from prose or provider attempts.

## Scope and launcher audit

No production migration launcher, package script, hosting configuration,
deployment file, or SAFE_REFUSAL command changed. `worker/runner.ts` changed
only for the Task 6-required shared repository dependency composition.

## Review disposition

Controller review found two Important boundary gaps. Both received focused
RED-before-GREEN coverage and are addressed:

1. Non-null `costUsd` previously permitted a null/missing pricing version.
   The telemetry contract now requires both explicit pricing version and
   unavailable-reason fields, with mutually exclusive exact/unavailable state.
2. The formal-preservation guard was tied entirely to
   `criticalEvidenceComplete`. A full US Candidate with complete minimum model
   inputs but missing non-minimum critical evidence could therefore replace an
   otherwise available formal decision with an unavailable placeholder. The
   decision guard now applies independently; complete scenario/calculation/
   valuation/framework preservation remains conditional on complete critical
   evidence.

The remaining review candidate is explicitly Task 7-owned rather than a Task 6
repository fix: if exact reuse is discovered only after a target Candidate has
already executed provider calls, its immutable attempt audit rows cannot be
deleted when SQL aliases it. Task 7 must perform canonical reuse before
provider execution through its Candidate-ID-independent fingerprint and nonce
normalization. Task 6 deliberately preserves the immutable audit instead of
silently deleting it.

## Independent review round 2

The locked Task 6 review found two additional memory/Supabase parity gaps;
both were reproduced RED before implementation and fixed without changing
0027, any other migration, or Task 7 runtime behavior.

1. Current memory finalization could omit an applicable advisory judgment from
   the submitted catalog and relabel the result as limited coverage. The
   TypeScript boundary now mirrors 0027's authoritative set predicate and
   requires exact one-to-one judgment ID, catalog-candidate ID, framework Card
   ID, and framework version coverage. The three-catalog positive fixture now
   truly contains only three applicable advisory judgments; a four-judgment,
   three-catalog graph is rejected.
2. Memory attempt reserve/settle accepted any non-empty worker and lease token.
   Both writes now consult one explicitly injected, instance-scoped Candidate
   lease authority shared with memory underwriting runs. It verifies exact
   workspace and Candidate identity, running status, canonical ownership,
   worker, token, and non-expired lease before recording an event. The worker
   fallback constructs one authority, one Named Lens repository, and one
   artifact repository; low-level ledger tests use an explicit test-only
   authority, never a permissive production default.

Fresh post-fix verification:

```text
Task 6 eight-file cohort:
tests 129; pass 120; fail 0; skipped 9

Focused authoritative-catalog tests:
tests 2; pass 2; fail 0; skipped 0

Focused shared-authority and worker-composition tests:
tests 4; pass 4; fail 0; skipped 0

Real eight-core/twenty-advisory plus unknown-usage integration:
tests 2; pass 2; fail 0; skipped 0

npm run typecheck: exit 0
npm run lint: exit 0, zero warnings
git diff --check: exit 0
```
