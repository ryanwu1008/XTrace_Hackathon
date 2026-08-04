# Historical 2026-08-01 Pinned Demo Local E2E QA Record

- Test date: `2026-08-03`
- Result: passed for the immutable legacy pinned fixture (`exit code 0`)
- Final verified commit: **pending final verified commit**
- Scope: local disposable integration environment and legacy pinned replay only

This is historical evidence for the immutable 2026-08-01 pinned report. It
does not describe the current registry, prove the current 30-Deal cold path, or
record a current-mainline smoke, commit, or Preview/Staging deployment. Those
steps remain pending and require a separate acceptance record.

## Test environment and production isolation

The end-to-end run used a disposable PostgreSQL/PostgREST stack bound to
loopback:

- PostgreSQL image: `postgres:17.6`
- PostgREST image: `postgrest/postgrest:v12.2.3`
- Terminal local migration: `0023`
- Network scope: `127.0.0.1` only

The run did not contact or modify production. Production remote calls,
production writes, and production credential reads were all `0`. The disposable
resources were cleaned up after the test.

## Legacy pinned fixture state

| Registry or artifact class | Verified count |
| --- | ---: |
| Pinned Companies | 23 |
| Pinned Deals | 23 |
| Pinned CompanyAnalyses | 23 |

The Reports, Evidence Pack, and Chat read-path verification resolved all `41`
distinct source revisions referenced by the finalized artifacts under test.

## Score-derived ranking

All four selected cases passed the required gates. The order below was produced
from the persisted scores; it was not assigned manually.

| Rank | Company | Historical status | Direction | Score | Match confidence |
| ---: | --- | --- | --- | ---: | --- |
| 1 | Irregular | `invested` | negative | 0.928 | high |
| 2 | Henry AI | `passed` | positive | 0.8125 | high |
| 3 | Hush Security | `invested` | positive | 0.713 | medium |
| 4 | Smallest.ai | `watchlist` | positive | 0.689 | medium |

## Pinned replay verification

The second pinned run reused the same pinned evidence identity without mixing in
live evidence:

- Snapshot ID and snapshot fingerprint were unchanged.
- Evidence-context and event-set fingerprints were unchanged.
- Rank, score, confidence, gate outcomes, belief direction, and status-aware
  actions remained semantically identical.
- The replay made `0` live market calls.
- Persisted matching-judgment growth was `0`.
- Persisted XTrace ingest-intent and memory-link growth was `0`.
- Source-revision and sample-interaction counts did not change during read
  verification.

Each replay run retained its own run ID. Consequently, its run-scoped evidence
binding fingerprint was independently recomputed and intentionally differed
between runs; both bindings authenticated the same pinned context and event set.
This is the expected rule and is not evidence drift.

Framework analysis is candidate-scoped, so the replay re-executed the same
bounded framework matrix for the new Candidate instead of reusing another
Candidate's judgment rows. The framework call count matched the first run, and
the normalized judgment and disagreement semantics were identical across both
runs.

## Reports and Chat verification

The finalized report remained pinned to the verified run and evidence snapshot.
Reports, underwriting artifacts, source references, action drafts, and Chat were
checked in the same report/run scope.

The test completed `9` finalized Chat queries. They covered all eight supported
topics exactly once, with `invested_action` exercised twice so both invested
directions were tested:

- prior reason
- belief change
- strongest counterargument
- match confidence
- framework disagreement
- valuation
- missing evidence
- invested action for Hush Security (positive)
- invested action for Irregular (negative)

The Hush Security research-action crosswalk and supplemental diligence request
were verified, as was Irregular's negative invested-company action. Chat source
references resolved to canonical source identities, and the isolation counters
remained unchanged after all nine queries.

## Evidence status

This document records only the verified legacy pinned local E2E result. It is
not evidence that the current fixture produced 30 analyses or its
evidence-window-dependent current outcomes, and it is not a production deployment record,
production migration approval, or authorization to seed production. The first
current-30 cold smoke, its exact verified commit, and its authorized
non-production Preview/Staging handoff have not occurred.
