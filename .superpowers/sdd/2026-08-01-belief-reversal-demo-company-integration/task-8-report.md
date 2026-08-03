# Task 8 report: live/pinned separation and evidence-scoped Reports/Chat

## Outcome

Implemented one current evidence runtime with disjoint `live` and `pinned`
branches. The approved sandbox replay uses immutable snapshot
`belief_reversal_2026_08_01`; product remains live-only and public demo remains
read-only. Matching, report persistence, underwriting, Search, Chat, and UI now
carry or resolve the authoritative evidence frame instead of consulting a
workspace-wide mixture.

## Runtime and API

- Run creation defaults an omitted request to typed live evidence. Product
  rejects pinned requests; public sandbox accepts only the approved snapshot;
  authorization happens before readiness and run creation.
- The local belief-reversal seed creates the reviewed four-event snapshot from
  manifest-selected canonical sources and source revisions. Re-seeding is
  idempotent and returns the same snapshot fingerprint.
- Worker execution rejects `legacy_unbound` runs. Live scans/classifies/writes
  the live catalog, while pinned binds the snapshot without provider,
  classification, or live-catalog calls. Both reload and verify workspace,
  run, window, context, snapshot, event count, event-set fingerprint, binding
  fingerprint, and canonical payload before downstream analysis.
- `memory_ingest_sync` remains skipped; Task 7 exact ingest is unchanged.
- Reports persist and publicly expose the exact binding-derived context. The
  Worker re-reads and validates that report before underwriting.

## Replay, underwriting, and read isolation

- Matching receives a typed evidence scope. Judgment identity binds canonical
  prompt evidence plus mode/context/event-set/snapshot. Current records persist
  context and binding identity; legacy judgments cannot replay. Identical
  pinned evidence may replay across run-specific binding fingerprints.
- Underwriting batch identity includes the typed evidence frame. Current
  run/report/frame mismatches stop before batch creation.
- The shared resolver implements `latest_terminal` and exact `report` scopes,
  requires terminal completed/partial runs, checks workspace/report/run and
  optional Deal membership, and restricts candidate artifacts to the resolved
  underwriting batch.
- Search rejects partial exact scope, returns typed 404 when no terminal scope
  exists, and searches only allowed candidate runs.
- Chat defaults to the latest terminal report, or uses an exact report/run
  scope. It derives event evidence only from that report's nested lineage and
  never reads the global Market catalog. Product filters fixtures; sandbox may
  retain canonical, permanently labeled Sample records. XTrace is one-Deal
  exact recall with run, evidence-context, and active-parent fingerprints.
- Public demo keeps its static read-only fallback. A product Chat with no
  terminal report returns insufficient evidence rather than using workspace-
  wide evidence.

## UI

- Runs and reports render the exact `LIVE EVIDENCE`, `PINNED DEMO REPLAY`, and
  `LEGACY REPORT` labels.
- Pinned reports display `Historical evidence snapshot—not current news.`
- `RUN PINNED DEMO REPLAY` is rendered only in public sandbox.
- `ASK THIS REPORT` carries exact report/run IDs; entering Chat from main
  navigation clears that scope.

## Verification

- `npm run typecheck`
- Focused Task 8 and related regression group: 76 passed, 0 failed.
- Separate scope/UI group: 5 passed, 0 failed.
- Covered request authorization/defaults, exact seed, live/pinned Worker split,
  report context, matching replay, underwriting fingerprint/alignment, shared
  resolver, no-global-catalog Chat, typed Search no-terminal behavior, and UI
  evidence labels.

No production migration execution, deployment, remote provider execution,
localization, or arbitrary snapshot administration was performed.

## Independent-review follow-up

- The UI's normal Chat path now always posts to `/api/chat`. Report-launched
  questions include the exact `reportId` and `runId` (plus `dealId` when a
  Deal-scoped launcher supplies it); public-demo questions use the same POST
  contract, and main navigation still clears report scope.
- Product alone removes `demo_fixture` evidence. Public sandbox retains only
  schema-valid canonical Sample decision records with the permanent exact
  marker and internal registry authority.
- Exact XTrace recall citations now resolve parent `sourceIds` through a
  `(documentId, sourceRevisionId)` index over the resolved report. This
  supports multiple in-report claim sources for one parent revision and rejects
  stale/mismatched revisions. Product fixture contexts remain rejected;
  sandbox Sample fixture contexts resolve only through the exact in-report ID.

## Second independent-review follow-up

- `ASK THIS REPORT` now chooses a Deal only from the report's authoritative
  CompanyAnalysis membership: a valid priority Deal wins, a single member is
  the only fallback, and an ambiguous or empty report sends no Deal. The route
  therefore cannot start Deal-scoped XTrace recall from an unrelated UI ID.
- Canonical Sample recall is bound to both the exact fixture ID and its real
  `sourceRevisionId`. Sandbox accepts only the canonical permanent Sample
  marker issued by `deal-registry`; product rejects Sample lineage.
- Source filtering is claim-level instead of record-level. Product keeps valid
  public evidence from a mixed public/Sample opportunity while removing the
  Sample source and Sample-derived previous context. Sandbox applies the same
  canonical Sample authority check to local report evidence as it does to
  recalled evidence.
- The Chat route accepts an injected XTrace lineage repository for scoped
  integration testing. Real POST tests now cover configured exact-parent recall
  for a mixed product report and for a canonical Sample revision in sandbox.
  The complete Chat route suite was updated to the current exact
  report/run/Deal contract, and network behavior is mocked without loopback
  listeners.

## Final verification after review fixes

- `npm run typecheck`: passed.
- Targeted ESLint over all changed production and test files: passed with zero
  findings.
- Chat/review/scope regression group: 40 passed, 0 failed.
- Broader Task 8 regression group: 163 passed, 0 failed.
- `git diff --check`: passed.
