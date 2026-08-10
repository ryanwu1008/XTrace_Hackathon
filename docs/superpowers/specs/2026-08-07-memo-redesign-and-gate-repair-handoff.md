# Memo Redesign and Gate Repair — Continuation Handoff

**Date:** 2026-08-07

**Repository:** `XTrace_Hackathon`

**Working branch:** `feat/backend-integration-checkpoint`

**This checkpoint:** `92729bcff20ff6c366f9e884c73a3a40d2086949`

**Inherited from:** `8b059f006d06c69450c19d1fcc5daff0d681d392`
(the 2026-08-05 complete-project continuation handoff)

**Push state:** the `ryanwu1008` remote is still at `8b059f00`. **The five commits
below are local only.**

## 0. How to use this document

This is an increment on top of
`2026-08-05-vsee-xtrace-complete-project-continuation-handoff.md`. Everything in
that document still applies except where Section 4 below records a correction.
Read it first, then this.

Precedence is unchanged: the product owner's most recent explicit decision wins,
then the no-Top-5 addendum, then the approved presentation designs.

## 1. What this session changed

Six commits, 24 files.

| Commit | Subject |
|---|---|
| `b1ced5a` | repair three date- and isolation-fragile assertions |
| `2113ccd` | stop one heartbeat failure from tearing down the environment |
| `ab34677` | rebuild the memo as seven decision-first sections |
| `a86a9a2` | derive cold-acceptance outcomes from the run's evidence window |
| `92729bc` | close two gaps the browser pass exposed |
| `78b6cdb` | this document |

Product code touched: `lib/api/errors.ts`, `db/client.ts`,
`scripts/run-belief-reversal-cold-worker.ts`, `app/underwriting-detail.tsx`,
`app/underwriting-article-view-model.ts`, `app/analyst-panel-view-model.ts`,
`app/vsee.css`. No change to `lib/contracts/`, `db/repositories/`, `drizzle/`,
`worker/`, or any persisted contract. No migration was added.

## 2. Product decisions taken this session

Each was an explicit product-owner choice.

1. **Fix the release gates before pursuing hosting.** The three opt-in gates the
   runbook requires had never actually been executed; two were red.
2. **Report structure: Option A.** A seven-section investment-committee
   memorandum plus one appendix, replacing the fourteen-section reading order.
   Design: `2026-08-06-decision-first-ic-memo-redesign.md`.
3. **Named investor lenses carry the analysis.** Their distilled doctrine and
   sources appear in the narrative, not only as a panel of scores.
4. **Prose contract.** Persisted field values are translated into what they mean
   for the decision; enum labels, scope badges, and internal identifiers do not
   appear in body prose; repeated per-item headings are not used; domain terms
   are explained where they first appear.
5. **Traceability level: card plus evidence.** A lens passage renders only when
   its card resolves to the pack it claims and it cites evidence this candidate
   holds. Field-level attribution was explicitly deferred because the persisted
   judgment contract does not carry it.
6. **Uniformity is withheld, never templated.** When lenses argue the same thing
   the passages are withheld rather than repeated.
7. **Diligence order is conditional.** Lead with evidence that settles a
   prioritized disagreement when the disagreeing lenses' unknowns discriminate;
   otherwise fall back to calculation order and make no disagreement claim.
8. **Gate 3 expectations are derived, not pinned.**
9. **Evidence-window expiry is solved with a new pinned snapshot, not a longer
   live window.** A 30-day window would need a new migration on a chain already
   blocked at `0019`, and would only postpone the problem to late August.
10. **Worker resilience is product code worth fixing**, not a fixture quirk.

## 3. The three release gates

All three now pass. Before this session, two did not.

**Gate 1 — `npm run test:migrations`: 104/104.** Two failures were repaired. The
0019 sentinel test applied every migration while asserting the chain was 22
files, so it broke when `0022` landed; its sibling already bounds the chain at
`0021` and that filter was applied here too. The
`production-baseline-bridge` hostile fixture relied on `anon` inheriting
`service_role`, but `anon` is cluster-global and another migration test file
creates it `NOINHERIT` first; since PostgreSQL 16 the membership default follows
the member role, so the grant is now pinned explicitly.

**Gate 2 — `npm run test:migrations:production-pg176`: 3/3** with the exact
`SAFE_REFUSAL — production forward migration remains blocked`. Unchanged
behavior; this is the first recorded execution.

**Gate 3 — `npm run test:e2e:belief-reversal`: 1/1.** See Section 5.

### Running the gates locally

The gate helper verifies the target with
`select coalesce(host(inet_server_addr()), '<unix-socket>')`, so a Docker
container with a published port fails the check: PostgreSQL reports the bridge
address. Run a socat proxy inside the database container's own network namespace
so PostgreSQL sees a loopback connection:

```bash
docker run -d --name pg -e POSTGRES_PASSWORD=... -p 127.0.0.1:54993:15432 postgres:17.6
docker run -d --network container:pg alpine/socat TCP-LISTEN:15432,fork,reuseaddr TCP:127.0.0.1:5432
```

Then export `PGHOST=127.0.0.1 PGPORT=54993 PGUSER=postgres PGPASSWORD=... PGDATABASE=postgres`.

A default Homebrew PostgreSQL will not work: migration `0009` reads
`pg_auth_members.inherit_option`, which exists only from PostgreSQL 16.

TD-DB-002 is real. `npm run test:migrations` runs all seventeen files against one
cluster, and node's test runner orders files alphabetically, so files that create
cluster-global roles run before the ones that depend on their attributes. Use a
fresh cluster per gate run.

## 4. Corrections to earlier beliefs

A new agent will otherwise repeat these.

**The local fixture stubs the model.** The judgments in a browser-fixture or cold
E2E artifact come from `deterministic-e2e-observer-v1`, a stub in
`tests/helpers/belief-reversal-e2e-pipeline.ts`. They are not production output.
An earlier reading of this session concluded that framework synthesis fills a
shared template; that conclusion was drawn from stub output and does not
establish anything about the real generator.

**The production generator already sends the differentiated material.**
`lib/underwriting/frameworks/claude-lens.ts` sends the entire Framework Card —
`decisionQuestions`, `redFlags`, `positiveSignals`, `disconfirmingEvidence`,
`notAClaimOf`, `decisionMethod`, `confidenceAnchors` — with the Evidence Pack,
and instructs the lens to partition every Fact and Assumption into support,
counter, or unused. **Real output has never been observed**, because the public
deployment has no Worker and the fixture stubs the model.

**The persisted judgment has no field-level attribution.**
`FrameworkJudgmentSchema` carries `frameworkCardId`, `frameworkVersion`, the three
evidence partitions, `strongestSupport`, `strongestCounterargument`, `unknowns`,
`limitations`, `confidence`, and `claimEdges`. There is no record of which card
field a statement came from.

**Advisory card identity.** `frameworkCardId` is
`framework_advisory:<packId>:<hash>`, and the middle segment equals
`frameworkMetadata.packId` — verified across all 20 advisory judgments in one
artifact. The read model exposes `frameworkMetadata.components[]`; there is no
`componentCardIds` field, and component counts range from 0 to 10, so component
matching is not a usable catalog check.

**Measured uniformity in the fixture artifact.** All 19 applicable judgments
classified the same single fact as support and the same single fact as counter;
the other eleven evidence items were used by none. All 19 shared one
`strongestCounterargument`. Stances did differ: 10 supportive, 9 negative, 9
abstaining. The six IC issue groups reduce to two synthesized signatures that
differ by one word — 420 identical characters, "supportive" versus "cautious".

**Disagreement records do not discriminate here.** All three prioritized
disagreements cite the same two `semantic-field-*` evidence items, and every
judgment's `unknowns` names the same four missing fields.

### 4.1 A CSS pattern that silently drops styling

Seven `vsee-*` classes are used in `app/underwriting-detail.tsx` but defined in no
stylesheet. Three of them broke visible styling, because the section-label rule
is a **direct-child selector**, `.vsee-underwriting-section > div > h4`. Wrapping
a heading in an extra `<section>` escapes it, and with no rule for the wrapper
class the heading fell back to the browser default — serif, sentence case, in a
memorandum where every other label is uppercase monospace. Fixed for
`vsee-evidence-coverage`, `vsee-evidence-conflicts`, and
`vsee-status-aware-actions`.

Still undefined, and believed harmless because their children are styled by other
rules: `vsee-advisory-contract`, `vsee-advisory-provenance`,
`vsee-analysis-source-links`, `vsee-sample-decision-record`, plus three added
this session — `vsee-executive-memo-reading`, `vsee-ic-approval-nature`,
`vsee-valuation-audit-grid`. Their rendering was checked in the browser. Before
adding another wrapper, check whether it sits between a direct-child selector and
its target.

## 5. Gate 3: what was pinned and what replaced it

The cold E2E pinned `4/6/20/0` and a screening monitor count of 6. Both depend on
which fixture events still fall inside the 14-day window, so both expired: the
same fixture now yields `4/4/22/0` with 4 screening monitors. The 2026-08-05
handoff already required deriving every outcome and never hard-coding a
distribution.

Replacements, both window-independent:

- a belief revision may only come from the four reviewed cases, and **no
  screening Deal may be admitted as one** — that second check did not exist
  before;
- all seven screening Deals land outside `belief_revised`, replacing the count of
  how many are specifically `monitor`.

`CurrentColdExpectedOutcomes` changed shape. Consumers updated:
`belief-reversal-e2e-pipeline.ts`, `belief-reversal-e2e-verifier.ts`,
`belief-reversal-demo-e2e.test.ts`, and two unit fixtures.

## 6. Worker resilience

The cold Worker awaited `touchWorkerHeartbeat` at the top of its loop with no
guard, so one failure threw out of the loop, ended the process, and the fixture
then removed the web, proxy, and database containers. The interval heartbeat
inside the claimed-run branch was already guarded; the loop-top call was not.

Two independent runs died at exactly 3600 seconds, matching the fixture JWT
lifetime. After raising that lifetime a run died at exactly 12 hours. The token
is minted once and never renewed, so **raising the lifetime moves the wall, it
does not remove it.**

Now: a bounded run of consecutive heartbeat failures is tolerated, then the
Worker fails closed. `IntegrationTransportError` carries the HTTP status and puts
it in the message; diagnosing the above required comparing timestamps across runs
because the log only ever said `Integration transport failure`.

**Still open:** the fixture token is not renewed, so a session still ends at the
lifetime boundary.

## 7. Memo redesign as built

Seven sections plus an appendix, verified in the browser against a live report
created from the visible scan control:

```
01 Decision Request · 02 What Changed · 03 Company Position ·
04 Thesis Assessment · 05 Financial and Valuation Status ·
06 Named Lens Readings · 07 Recommendation and Next Steps · A Appendix
```

Merged section names are kept as sub-headings. This matters beyond navigation:
six existing tests slice the rendered HTML by section heading to scope their
assertions.

Three rules are derived from persisted data, in
`app/underwriting-article-view-model.ts` and `app/analyst-panel-view-model.ts`:

- **traceability** — a passage renders only when its card resolves to the pack it
  claims and it cites evidence in this candidate's Evidence Pack;
- **uniformity** — passages are withheld when the distinct argument signatures,
  taken after removing the pack name, do not reach half the passages. Exact
  equality was too weak: it missed six groups that differed by one word;
- **diligence order** — leads with evidence that settles a prioritized
  disagreement when the disagreeing lenses' unknowns discriminate, and otherwise
  falls back to calculation order without claiming a disagreement basis.

Each rule fails by withholding. **The renderer must never substitute a template,
another lens's prose, or generic filler for a withheld passage.** Each rule
upgrades on its own if generation later differentiates; none needs a data change.

Prose: the decision, ceiling, confidence, and belief direction are stated once,
in sentences; scope, priority, and visibility badges became one sentence; the
snapshot headings no longer claim verification for values classified `reported`;
`ARR`, `burn`, `cash`, `runway`, `pro-rata`, and related terms are explained
where they first appear.

## 8. Verification at this checkpoint

- default suite: 1,644 tests, 1,573 passed, 0 failed, 71 environment-gated skips;
- TypeScript: 0 errors;
- ESLint: 0 errors, 9 pre-existing warnings;
- `npm run build`: success;
- `git diff --check`: clean;
- Gate 1 104/104, Gate 2 3/3 with the exact refusal string, Gate 3 1/1;
- browser: a live report created from `WAKE AGENT & SCAN MARKET` with 30
  analyses, outcomes `4/4/22/0` summing to 30, 4 underwriting candidates, seven
  sections in order, `FORMAL RESULT` appearing once, zero document and dialog
  horizontal overflow.

Ten tests were updated deliberately as the presentation changed; none was
deleted. Six of them slice HTML by section heading, one had a premise that the
new structure invalidates — it bounded the drafts block with `Final IC Position`,
which now sits earlier in section 1.

No production endpoint, database, migration target, seed target, or credential
was read or modified.

## 9. Open work

**Pinned 30-Deal snapshot.** The approach is chosen and not started. Pinned
snapshots freeze their window at their own anchor, which is why the 2026-08-01
report still replays. `create_market_evidence_snapshot` and
`bind_pinned_run_market_events` exist in `0019`, so no migration is needed, but
that RPC also validates `windowDays = 14`. Two things are unverified: whether a
new pinned run binds the current 30-Deal universe, and where the new package
should live — the 2026-08-01 package must not be overwritten. **This is the first
work in this line that writes new persisted data.**

**QA record.** Not written. It should follow the pinned-snapshot work so the
evidence is complete.

**Trigger-event expiry.** The four reviewed events are dated 2026-07-28 to 07-31.
Under a 14-day live window they age out between 2026-08-11 and 08-14, after which
a live scan produces zero belief revisions. The pinned snapshot is the agreed
answer.

**Three `Unsupported` badges** remain in section 5, one per Bear/Base/Bull
scenario card. The ten-row grid is gone; these three were judged an honest signal
rather than a wall. Revisit if the product owner disagrees.

**Field-level attribution** remains available as a later strengthening of the
traceability rule. It would change the judgment contract and the generator.

**Synthesis generation** may need changing, but only if observation of real
output shows the generator itself produces undifferentiated judgments. That
observation has not been made.

**Deployment** is where the 2026-08-05 handoff left it. The blocker is an
isolated Supabase on migrations `0000`–`0026`; production remains reviewed only
through `0018`. See Section 9.1 for what was learned about the targets.

### 9.1 Deployment reconnaissance

Read-only probes only. No deployment was performed and no production data was
read or modified.

**The public Sites URL still serves the old build.** `/api/settings/health`
reports `public_sandbox` with `worker: false`, and the asset namespace resolves to
`8eda7448`. This confirms DEP-001 and DEP-003 rather than changing them: the Web
is live, no Worker is attached, so the scan path cannot complete there.

**Correction to the 2026-08-05 handoff, Section 16.** That document states the
private Staging Sites project identity "was not persisted". It was. Commit
`beb6fa0` on the detached worktree at `/private/tmp/vsee-private-staging-3b6c348`
sets `.openai/hosting.json` to project `appgprj_6a714b15f3488191998e357436151354`.
Whether that project is still usable was not tested.

**Cloudflare is authenticated and already configured — which is the hazard.**
`wrangler.jsonc` names the worker `vsee-vc`, matching the stale URL recorded in
TD-OPS-003, and that worker already holds secrets including
`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `DOCUMENT_URL_SIGNING_SECRET`,
and the market feeds. Its health shows `postgres: true` with the confirmed corpus,
so **those secrets point at the production Supabase.** Running `npx vinext deploy`
without changing them would put code that needs `0019`–`0026` in front of a
database reviewed only through `0018`, in a writable anonymous mode. Deploy to a
new worker name instead, or change the secrets first.

**A Staging Supabase project was started and abandoned.** Keychain entries
`vsee-staging-supabase-url`, `vsee-staging-supabase-service-role-key`, and
`vsee-staging-supabase-db-url` exist. **They are known bad**: the stored
service-role key was truncated to two JWT segments, and the database URL contains
an unescaped `@` in the password so the host fails to parse. The REST endpoint
returned 401 and Storage returned `Invalid Compact JWS`. The project reference is
`gvkhitbljkrnzjzxtyua`; whether the project still exists was not rechecked. Treat
these entries as unverified and re-derive them before use. They are distinct from
the production entries, which have no `staging` in their names and must not be
overwritten.

## 10. Do not

- push with `--force`, or rewrite the immutable 23-analysis pinned report;
- treat fixture judgments as evidence about the production generator;
- substitute a template for a withheld lens passage;
- restore a pinned outcome distribution or any other window-dependent constant;
- run `npm run test:migrations` against a shared cluster;
- run `0019` or later against production, seed production, or bypass the
  launcher's refusal;
- add Send, Publish, or automatic delivery controls;
- claim to display hidden chain of thought.
