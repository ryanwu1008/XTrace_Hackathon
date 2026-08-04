# Current 30-Deal Cold E2E Acceptance Record

- Status: **automated cold smoke and private local browser acceptance passed on 2026-08-03**
- Cold smoke result: **PASS — 1/1 test, 73.7 seconds**
- Smoke-verified company-mainline commit: **`3b6c34843a1e0c6854439641b0a2ca2467392a89`**
- Browser-fixture transport commits: **`d6f8c47737fb4740ca852b4798a7c84325a30950`**, **`df475eb99547cc7c3b5fbba3e5e10b06d4ae0f18`**
- Preview/Staging deployment: **private target created; provider source-branch initialization blocked publication**
- Production access or mutation authorized: **no**

This record captures the fresh cold-smoke evidence and a real browser
click-through of the current company mainline. The browser acceptance used a
disposable loopback database, the real persistent queue/Worker boundary, and a
private local preview. An externally reachable private Staging version could
not be published because the newly created Sites project's source repository
returned HTTP 500 during initial branch creation; no production target was used
as a fallback.

## Executed command and result

```text
npm run test:e2e:belief-reversal
```

- Result: `PASS` (`1 passed`, `0 failed`).
- Node test duration: `73.700043708s`.
- Main E2E body duration: `71.630830459s`.
- Database: disposable loopback PostgreSQL `17.6` with PostgREST `12.2.3`.
- Terminal migration: `0026_geography_agnostic_advisory`.
- The test cleaned up its disposable database after completion.

## Required isolated environment

The run must use disposable PostgreSQL 17.6, loopback/local controlled evidence
and provider fixtures, test-only XTrace/Anthropic seams, and non-production
credentials. It must read or mutate no production database, provider account,
credential store, migration state, or deployment target. Production remote
calls, writes, and credential reads must each be recorded as zero.

Do not use the production XTrace endpoint, macOS Keychain credentials, or the
public Sites target for this cold smoke or its private Preview/Staging handoff.
Use only test-only/non-production provider seams and credentials, a disposable
non-production database and Worker, and a separately authorized
non-production target.

Localization and bilingual implementation are paused until the company mainline
is complete and the final schema recheck has finished. They are outside this
acceptance record and must not be represented as completed or release-ready.

## Required cold path

1. Begin with no generated current report.
2. Exercise the same persistent queue contract used by the browser Scan action.
3. Prove that contract creates the queued run and that no report exists before
   the Worker claims it.
4. Have the fixture Worker claim that run and execute the production
   `processClaimedRun` boundary.
5. Collect controlled canonical evidence, recall Deal-bound prior context, run
   matching, persist analyses, and process every admitted underwriting job to
   an explicit terminal state.
6. Replay the same authority and prove idempotency without duplicate Deals,
   analyses, memories, jobs, or artifacts.

## Cardinality and outcome acceptance

The completed controlled fixture must prove all of the following:

- 30 Companies.
- 30 Deals.
- 30 analysis-eligible Deals in the immutable run-bound universe.
- Exactly 30 CompanyAnalyses with 30 unique stable Deal IDs.
- Outcome counts `4 / 6 / 20 / 0` for
  `belief_revised / monitor / no_material_change / analysis_unavailable`.
- The four outcome counts sum to 30.
- `beliefRevisedCount === underwritingCandidateCount === 4`.
- Every belief-revised Deal creates one and only one immutable Deep
  Underwriting queue entry.
- No `monitor`, `no_material_change`, or `analysis_unavailable` Deal creates
  framework, valuation, formal-decision, or action-draft artifacts.
- Priority rank controls execution/display order only and never truncates
  admission.

## Screening prior acceptance

Centralize, ChipAgents, Sent, Cascade, Cordant, Empirical Security, and Freight
Hero must remain `screening` Deals with the permanent external label
`Sample research screening record`. Their prior records must explicitly retain
`meetingOccurred=false` and `vcInteraction=false`. They are typed prior context,
not historical Passes, investment decisions, meetings, VC interactions, or
gate-passing evidence by themselves.

The product applies the same evidence and belief-change gates to these Deals as
to every other Deal. Stronger evidence in a later run may naturally satisfy
those gates and upgrade the outcome; the fixture uses no company-name,
screening-disposition, or rank shortcut. The fresh controlled result was:

- Centralize: `monitor`.
- ChipAgents: `monitor`.
- Sent: `monitor`.
- Cascade: `monitor`.
- Cordant: `monitor`.
- Empirical Security: `no_material_change` because its reviewed event falls
  outside the current authoritative 14-day window.
- Freight Hero: `monitor`.

None was represented as `passed`, `watchlist`, `invested`, a historical VC
meeting, or a formal investment decision.

## Legacy pinned isolation

The historical 2026-08-01 pinned report must remain an immutable 23-analysis
artifact. Its universe membership, evidence snapshot, Source Revision/XTrace
lineage, report identity, underwriting identity, and fingerprints must remain
unchanged before and after the current cold run and replay.

The passing run replayed and read the 23-analysis artifact successfully through
Reports and Finalized Chat. The exact reviewed window remained:

- Anchor/end: `2026-08-02T06:59:59.000Z`.
- Start: `2026-07-19T07:00:00.000Z`.
- Timezone: `America/Los_Angeles`.
- Label: `Demo evidence snapshot as of 2026-08-01`.

## Persisted seed and lineage evidence

The post-seed state contained:

- 30 Companies, 30 Deals, and 30 analysis-eligible Deals.
- 80 source documents and 80 source revisions.
- 79 workspace documents and 85 active source assignments.
- 19 legacy evidence units and 62 canonical evidence units.
- 23 permanently labelled sample interactions.
- 7 permanently labelled sample research screening documents.
- 7 research candidates, 25 research source assignments, and 1 explicit
  research evidence gap.

The current report contained exactly 30 analyses and exactly four immutable
Underwriting candidates/jobs/artifacts. Priority order was Irregular, Henry AI,
Hush Security, and Smallest AI; priority affected ordering only. Nine Finalized
Chat route queries completed and 50 exact Source Revisions resolved.

## Private local browser acceptance

The browser acceptance clicked the product's `WAKE AGENT & SCAN MARKET` action;
it did not open a pre-generated current report. The UI first showed a durable
queued/running state, the fixture Worker claimed the run, and the Reports page
then switched to a newly persisted `LIVE EVIDENCE` report.

- Private local preview: `http://127.0.0.1:3100/` (available only while the
  disposable acceptance fixture remains running on the test machine).
- Browser-created Report ID for the latest full article acceptance:
  `report_27e15106-ac31-47ac-a3b6-8ac986f7dae2`.
- Rendered coverage: 30 eligible Deals, 30 Belief Change Checks, 4 belief
  revisions, 6 monitor, 20 no material change, and 0 unavailable.
- Rendered queue: 4 completed Deep Underwriting results, with no Top-5 cutoff or
  rejected-by-rank semantics.
- The seven screening Deals retained their `screening` status and the permanent
  `Sample research screening record · synthetic, no meeting or VC interaction`
  label.
- Irregular's full Deep Underwriting opened from the new report and displayed
  exact Source Revisions, facts/assumptions/unknowns, hard gates, Investor
  Framework Perspectives, Bear/Base/Bull inputs, explicit unavailable
  valuation/calculations where evidence was insufficient, decision ceiling,
  and draft-only status-aware actions.
- The final browser run rendered the approved complete IC reading order:
  Executive Investment Snapshot, What Changed, Verified Company Snapshot,
  Company and Market Assessment, compact Named Analyst Panel, Investment
  Committee Debate, Bear/Base/Bull, Valuation and Return Analysis, VSee IC
  Synthesis, Required Diligence, draft-only actions, Evidence Classification,
  Audit Appendix, and Final IC Position.
- The compact option-B Named Analyst Panel retained 19 applicable persisted
  public-source product syntheses and 9 explicit abstentions/unavailable
  records. It permanently displayed `NO ENDORSEMENT` and zero formal decision
  weight. Main-body IC debate showed only 3 prioritized disagreements out of
  90 persisted pairwise conflicts; complete artifacts remain in the audit
  payload.
- Verified Company Snapshot rendered readable field/value/assertion rows and
  contained no raw `semantic-field-*` identifiers. Desktop acceptance at a
  1280-pixel viewport measured zero document or dialog horizontal overflow.
- A stale local fixture was found occupying port 3100 while a replacement
  silently fell back to 3102. The browser launcher now passes `--strictPort`
  and fails closed instead of announcing a URL backed by a different process.
- Finalized Chat answered `Which new evidence changed the belief for Irregular?`
  from the persisted artifact, returning the Sample decision context, three
  exact public-source quotations, negative belief direction, revisit mapping,
  and the typed action delta from `evaluate_follow_on` to `pause_follow_on` plus
  `portfolio_risk_review`.

The click-through exposed one presentation defect: a current screening monitor
had a persisted 62% score and typed audit gates but the Company Brief called it
a legacy analysis. The UI now reads `currentRunAudit` when no formal
`beliefAssessment` exists, displays the exact persisted score/gate reasons and
why Underwriting did not start, and reserves the legacy fallback for analyses
that have neither contract. The regression test was written failing first and
then passed after the fix.

## Report-quality parity evidence

The focused parity and UI suite passed 47/47 tests after the browser finding.
It compares the current 30-analysis report with the immutable 23-analysis
baseline across report structure, lineage, evidence classifications, scenario
coverage, calculations or typed unavailability, framework judgments,
disagreements, formal decisions or typed unavailability, action drafts, and
unbounded Underwriting admission. The release build also completed
successfully. This is semantic-quality parity: missing evidence remains visibly
unavailable instead of being replaced by invented numbers or conclusions.

## Isolation and replay evidence

- All network requests were constrained to `http://127.0.0.1`; remote network
  attempts were exactly zero.
- The pinned pass made zero live-market calls.
- Report, underwriting, action-draft, and Chat reads caused no provider or
  durable-data mutation except the nine expected loopback rate-limit records.
- Replaying the same pinned authority created zero additional reasoner
  judgments, XTrace ingest intents, or XTrace memory links.
- Replay created zero additional XTrace ingests, deletes, parents, memories,
  matching calls, or unexpected model calls. The run-scoped framework matrix
  executed again and preserved identical finalized framework semantics.
- No production endpoint, database, provider credential, migration state, or
  deployment target was read or modified.

## Release evidence gate

This record satisfies the automated cold-smoke and private local browser gates
for the authorized company-mainline changes. A new owner-only Sites project was
created for private Staging, but its empty source repository could not accept
even a minimal initial branch: the provider returned HTTP 500 and therefore no
version or safe external test URL exists yet. The production project, data,
credentials, and deployment were not read, modified, seeded, or used as a
fallback.
