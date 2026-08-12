# Pinned 30-Deal Underwriting Acceptance Record

- Status: **historical deterministic-fixture acceptance passed at terminal
  migration `0028`; current staging continuation is documented separately
  below and has not passed a real Anthropic E2E**
- Historical verification date: **2026-08-11**
- Command: `npm run test:e2e:belief-reversal`
- Database: **fresh disposable PostgreSQL 17.6**
- Historical terminal migration: **`0028_named_lens_authority_repair`**
- Current migration authority: **terminal `0030`**
- Production access or mutation: **none**

The historical portion of this record covers the first successful backend E2E
execution of the distinct 30-Deal pinned package and the current-run path on a
fresh database at terminal migration `0028`. It proves the persisted queue and
Worker path through Deal recall, matching, 30 CompanyAnalyses, belief-revision
admission, Deep Underwriting, finalized Report projection, and finalized Chat
verification under the deterministic fixture provider. It is not evidence
that the real Anthropic provider path has completed successfully. The dated
staging continuation at the end records the newer terminal-`0030` authority,
deployment, and remaining real-provider blocker.

## Isolated test authority

The test used only disposable loopback infrastructure and the permanently
identified deterministic fixture provider `deterministic-e2e-observer-v1`.
That provider is an E2E stub, not the production Named Lens generator. Its
prose and framework behavior therefore prove application contracts and
persistence, but cannot be used as evidence of production-provider output
quality.

No production database, credential, provider, deployment target, or migration
state was read or modified. In particular, this acceptance does not authorize
applying `0019` through `0030` to production.

## Pinned-30 package and persisted identities

The new package is separate from the immutable 23-analysis artifact:

- Package and snapshot ID:
  `belief_reversal_pinned_30_2026_08_10_v1`.
- Usage: `test_and_review_only`.
- Evidence mode: `pinned`.
- Anchor/window end: `2026-08-01T23:59:59-07:00`.
- Window start: `2026-07-19T00:00:00-07:00`.
- Window timezone: `America/Los_Angeles`.
- Reviewed formal events: 4.
- Deal-universe ID:
  `deal_universe_belief_reversal_pinned_30_2026_08_10_v1`.
- Deal-universe member fingerprint:
  `sha256:cd230039d61edae2785a03efc9384663a4133fe5cc73438e5ee1f7184a3d9536`.
- Event-set fingerprint:
  `sha256:f7f4f25fea16aa5eccd7e78263c880959482b884cff07e84f238fe45724b82b9`.

The first passing execution persisted these authoritative run/report identities:

| Mode | Run ID | Report ID |
| --- | --- | --- |
| Pinned 30-Deal replay | `b9ec23e0-923b-4911-b873-893c063b3059` | `report_b9ec23e0-923b-4911-b873-893c063b3059` |
| Current cold Scan | `a4200cce-7616-4e6f-8cb9-029d97b7a5e7` | `report_a4200cce-7616-4e6f-8cb9-029d97b7a5e7` |

## Required path and cardinalities

The backend E2E began from a fresh database, used the same persisted run/Worker
boundary as the Scan action, and verified the complete backend sequence:

```text
Scan request
→ immutable 30-Deal universe
→ public MarketEvent binding
→ Deal-bound XTrace recall
→ matching
→ 30 CompanyAnalyses
→ belief revisions
→ one Deep Underwriting job per admitted revision
→ terminal underwriting artifacts
→ finalized Report and Chat projections
```

The accepted cardinalities were exact:

- 30 Companies.
- 30 Deals.
- 30 analysis-eligible Deals.
- 30 persisted CompanyAnalyses for the completed run.
- 4 admitted belief revisions.
- 4 Deep Underwriting candidates/jobs.
- 4 completed terminal candidates; 0 were truncated by rank.
- 13 finalized Reports/Chat verifier queries in total for the pinned report.

The 13 Chat queries are the total query count for the pinned finalized
Reports/Chat verifier. They are not a per-run count.

## Persisted priority order

Priority determines queue and display order only. It does not determine
Underwriting eligibility. The passing pinned execution persisted:

| Priority | Deal | Score | Confidence | Candidate run ID |
| ---: | --- | ---: | --- | --- |
| 1 | Irregular | 0.928 | high | `0b6b49b7-342e-4e0b-9095-c37670171ffa` |
| 2 | Henry AI | 0.8125 | high | `b6cc743f-1074-47f0-95b8-707754011605` |
| 3 | Hush Security | 0.713 | medium | `1dd9343e-25d1-442d-972a-4be86a910164` |
| 4 | Smallest.ai | 0.689 | medium | `cb30022b-dd49-4eb6-a064-12738769fa03` |

The diagnostic output did not emit current-run candidate identities, so this
record intentionally does not invent or infer them.

## Legacy pinned-23 immutability proof

The legacy compatibility baseline remains the separately generated artifact at
commit `3b6c34843a1e0c6854439641b0a2ca2467392a89`:

- Legacy run: `630a55ba-45e5-4694-ac18-0295a05a1d32`.
- Legacy report: `report_630a55ba-45e5-4694-ac18-0295a05a1d32`.
- 23 CompanyAnalyses, 4 Underwriting candidates, 9 finalized Chat checks, and
  50 exact Source Revisions.
- 69 legacy-owned tables and 2,518 rows compared.
- Exact legacy-owned row hash before and after:
  `sha256:a5bef5979ab7bac136fe5a439eefb557804edcabc4e9f15100473a2cf42d6f57`.
- Semantic fingerprint before and after:
  `sha256:ad1b4e254a5c31e9f4dc740d3970df4a3acb22e474aa9b20116dd96cddc739f3`.

Both hashes remained byte-for-byte equal before and after the cross-version
read/replay verification. The new pinned-30 package has its own snapshot and
Deal-universe identities and does not rewrite, extend, or relabel this legacy
artifact.

## Browser acceptance

The final browser pass used a second isolated fixture database,
`vsee_belief_browser_101b20b988938ba2`, at terminal migration `0028`. It
started from pinned report
`report_6c2aef4a-5ea4-4ee9-8b2d-a8a1c8481250` and exercised the same public
sandbox buttons a reviewer uses:

1. **WAKE AGENT & SCAN MARKET** queued a durable current run and automatically
   switched, without a manual reload, to
   `report_1861eb63-92aa-4b34-84d5-e2950d110d72`. The terminal report showed
   30 eligible Deals, 30 Belief Change Checks, `3 / 3 / 24 / 0` outcomes, six
   accepted public events, 30 recalled Deal memories, and three terminal Deep
   Underwriting results.
2. **RUN PINNED 30-DEAL DEMO · AUG 1, 2026** then automatically switched to
   `report_313dde2b-20e6-4be2-b90b-9efd4949e33e`. The terminal report showed
   30 eligible Deals, 30 checks, `4 / 0 / 26 / 0` outcomes, four accepted
   events, 30 recalled memories, and four terminal Deep Underwriting results.
3. The Irregular detail rendered the seven decision-first sections plus the
   collapsed Audit Appendix, six complete independent Named Lens readings,
   no Top-5 semantics, and no Send or Publish control.
4. `What changed for Irregular?` returned the exact pinned company/run scope
   with four Exact Source Revision links. The exact April Dunford display
   identity question returned its saved selection basis, two Exact Source
   Revision links, and six explicitly non-external persisted-artifact
   references. No network model call was used.
5. The Exact Source Revision access route returned an authorized, expiring
   document capability. The browser report itself also exposed the canonical
   public URL and the exact archived revision route.
6. At 1440×900 and 390×844, the root, dialog, and memorandum had no horizontal
   overflow. Mobile body text measured 16px with a 25.92px line height. Native
   Escape/cancel closed the controlled detail dialog exactly once.
7. After the final browser marker, captured console errors were empty.

This browser fixture also uses `deterministic-e2e-observer-v1`; it does not
claim production-provider prose quality.

## Historical terminal-0028 release-gate verification

The final working tree passed all local release gates after the browser fixes
and the final review repairs:

- `npm test`: 1,946 tests; 1,868 passed; 0 failed; 78 expected skips.
- TypeScript: 0 errors.
- ESLint: 0 errors and 9 pre-existing warnings.
- Production Web build: passed.
- Web parser boundary: 1/1 passed.
- Fresh PostgreSQL 17.6 migration suite: 112/112 passed, including the SQL
  recomputation of Named Lens passage length at 179/180/260/261 boundaries,
  persisted-count mismatch, and ECMAScript-compatible Unicode whitespace.
- A separate fresh PostgreSQL 17.6 production-shaped gate: 3/3 passed and
  emitted exactly
  `SAFE_REFUSAL — production forward migration remains blocked`.
- `git diff --check`: clean.
- Final independent code review: no remaining Critical or Important issue.

The final fresh-database one-click E2E passed in 104.5 seconds at terminal
migration `0028_named_lens_authority_repair`:

| Mode | Run ID | Report ID |
| --- | --- | --- |
| Pinned 30-Deal replay | `060e66e6-9254-45d5-954c-ebe0e2a4a61d` | `report_060e66e6-9254-45d5-954c-ebe0e2a4a61d` |
| Current cold Scan | `fda8d8bd-f7fc-4680-9cbe-b13d57bccb15` | `report_fda8d8bd-f7fc-4680-9cbe-b13d57bccb15` |

It again persisted exactly 30 Companies, 30 Deals, 30 analysis-eligible
Deals, 30 CompanyAnalyses, four pinned belief revisions, four terminal Deep
Underwriting jobs, 75 resolved Source Revisions, and 13 finalized Chat
queries. All four admitted candidates completed; no priority cutoff exists.

## Current staging continuation — 2026-08-12

This continuation replaces only the obsolete predeployment status formerly
recorded at the end of this document. It does not rewrite the historical
terminal-`0028` fixture results, identities, or fingerprints recorded in the
preceding sections.

### Current source and isolated release gates

- Verified HEAD:
  `c7dd8248206de1fa8f15fd79a7f66f04c9cc6f5c`.
- Current migration authority: terminal `0030`.
- Fresh PostgreSQL 17.6 migration suite: **114/114 passed**.
- Separate fresh PostgreSQL 17.6 production-shaped safety gate: **3/3 passed**
  and emitted exactly once:
  `SAFE_REFUSAL — production forward migration remains blocked`.
- Fresh deterministic-provider one-click E2E: **1/1 passed**.
- `npm test`: **1,979 total; 1,898 passed; 0 failed; 81 expected skips**.
- TypeScript: **0 errors**.
- ESLint: **0 errors and 9 pre-existing warnings**.
- Production Web build: **passed**.

These fresh-database gates remain deterministic application-contract tests.
They do not convert fixture-generated prose into evidence about the real
Anthropic provider.

### Private staging topology

- Private owner-only Sites project:
  `appgprj_6a714b15f3488191998e357436151354`.
- Deployed Sites version: **version 5**, at
  <https://vsee-xtrace-staging-20260803-3b6c348.dream86625.chatgpt.site>.
- Isolated staging Supabase project ref: `gvkhitbljkrnzjzxtyua`.
- Persisted staging registry: **30 Companies / 30 Deals / 30
  analysis-eligible Deals**.
- XTrace staging app namespace:
  `xtrace-vc-deal-intelligence-staging-gvkhitbljkrnzjzxtyua-v3`.
- XTrace staging ingest: **85 succeeded intents / 165 Deal-memory links / all
  30 Deals covered**.
- The `v3` suffix identifies the isolated staging app namespace. It does not
  change the persisted parent serializer, which remains `xtrace-parent-v2`.
- A local foreground Worker running the same `c7dd8248206d` source revision
  has published a current heartbeat against the isolated staging data plane.

### Real-provider E2E status

The real Anthropic E2E is **not passed**. The previously configured Anthropic
credential returned HTTP `401 authentication_error`. The staging diagnostic
run identified by the `cf52` prefix therefore reached all 30 persisted
CompanyAnalyses but ended partial with **30 `analysis_unavailable` outcomes
and 0 reasoner judgments**. That run is diagnostic evidence of fail-closed
behavior, not an accepted underwriting result.

Consequently, the `c7dd8248206d` one-click staging path still awaits a valid,
staging-only, standard Anthropic API key before it can prove:

```text
one-click Scan
→ 30 CompanyAnalyses
→ real-provider belief revisions
→ one Deep Underwriting job per admitted revision
→ finalized Reports and Chat projections
```

Production application data was not read, production was not modified, and
production migrations `0019` through `0030` remain forbidden. The private
staging deployment, isolated Supabase project, XTrace namespace, and local
same-SHA Worker must not be interpreted as authorization to use or migrate the
production data plane.
