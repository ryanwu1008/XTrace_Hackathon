# Belief-Reversal Demo Company Integration Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to execute this plan task by task, with `superpowers:test-driven-development` for every behavior change and `superpowers:verification-before-completion` before claiming completion.

**Goal:** Integrate four event-first, real-company belief-reversal cases through the authoritative PostgreSQL/XTrace/matching/Top-5/underwriting/action/UI pipeline without inventing facts, weakening thresholds, mutating production, or changing the original 19-Deal corpus.

**Architecture:** Keep the original 14-document/19-Deal corpus unchanged. Add a separately versioned research package whose immutable public-source snapshots and permanently labeled synthetic decision records are seeded into the same authoritative registries. Separate exact quotations from normalized evidence, persist deterministic belief-change gates and action policy, bind every run to either live evidence or one immutable pinned snapshot, and carry exact lineage through CompanyAnalysis, underwriting, Reports, and scoped Chat.

**Tech stack:** TypeScript, Zod, Next.js, PostgreSQL/Supabase REST and RPCs, Drizzle migrations, XTrace, Anthropic matching/framework adapters, Node test runner, React rendered-HTML tests.

---

## Global Constraints

1. The sole product authority is `docs/superpowers/specs/2026-08-01-belief-reversal-demo-company-research-handoff.md` plus the user's five explicit contract additions from 2026-08-01.
2. Do not implement localization in this plan. The bilingual handoff remains paused and unapproved from Section 14 onward.
3. Do not write production data or run production migration/seed launchers. PostgreSQL verification uses disposable local databases only.
4. Preserve all user changes and the original 14-document/19-Deal manifest, readiness semantics, files, IDs, and presentation-only profile boundary.
5. Use public facts only when backed by exact URLs, dates, authority/role metadata, and immutable bounded source text. Company-reported metrics stay labeled as company-reported.
6. Every synthetic prior uses `provenance: "demo_fixture"` and `label: "Sample decision record"` in storage, APIs, Reports, Underwriting, and UI.
7. Never expose or claim hidden chain-of-thought. Persist auditable facts, assumptions, calculations, framework judgments, disagreements, deterministic gates, fired rules, and conclusions.
8. Live 14-day scan remains the default. Pinned replay is explicit, immutable, date-labeled, and cannot mix with live evidence.
9. Medium/high thresholds remain `>= 0.50` / `>= 0.78`; Top 5 is derived from real grounded scoring and deterministic tie-breaking.
10. Expected-outcome metadata is test/review-only and cannot be imported by the production reasoner or matching path.
11. External drafts are draft-only and may not expose internal ceiling, confidence, fired rules, advisory conflict, or portfolio-risk commentary. No sending/publishing path is added.
12. New tests must name a specific break, use hand-derived literal expectations, and exercise production behavior rather than source-text greps or mock existence.

## Verified Baseline and Explicit Differences

- Branch/HEAD at planning: `feat/backend-integration-checkpoint` / `85ede55`; working tree clean; branch ahead of remote by two documentation commits.
- Baseline suite: 960 passed, 2 listener tests failed only because the sandbox rejected `127.0.0.1`; the same two tests passed outside the sandbox.
- The overview flow diagram says `Evidence Pack → context`, but Section 12.5 and the actual orchestrator use `context_router → evidence_pack`. Follow the detailed section and executable contract; record this documentation discrepancy in QA.
- Canonical text/web facts currently do not project into durable Deal memory; canonical-only seeding would not reach XTrace/matching.
- The same `public_web` source can currently satisfy both event-side and prior-context gates. Event membership and Deal-memory lineage must become disjoint, explicit inputs.
- Four score dimensions disappear before CompanyAnalysis persistence.
- `excerpt` currently conflates exact source text, provider-normalized prose, and model inference.
- Chronology, revisit mapping, counterevidence, and action delta are neither typed nor persisted and do not gate Top 5.
- Market provenance and immutable pinned replay do not exist.
- Full action drafts do not receive Deal status or belief direction and leak internal content to founder-facing bodies.
- The UI omits the 17-field scenarios, full coverage/conflicts, pricing premium, score breakdown, hard gates, and durable Sample decision label.
- Company Brief source links can use source IDs where revision IDs are required.
- Missing reported valuation currently terminates the candidate before later explanatory stages. The new path must execute each stage and preserve explicit unavailable/abstention outputs, decision ceilings, and missing-evidence requests without fabricating values.

## Research Selection (as of 2026-08-01)

Pinned window: `2026-07-19T00:00:00-07:00` through `2026-08-01T23:59:59-07:00`; display label `Demo evidence snapshot as of 2026-08-01`.

| Company | Prior status | Direction | Required action delta | Selection rationale |
|---|---|---|---|---|
| Henry AI | `passed` | `positive` | reopen diligence | 2026-07-29 Series A plus named, company-reported enterprise adoption and workflow evidence |
| Smallest.ai | `watchlist` | `positive` | advance to technical/commercial diligence | 2026-07-31 Series A, named customers, and dated official production-surface changelog |
| Hush Security | `invested` | `positive` | evaluate follow-on and validate channel economics | 2026-07-21 agent-control incident plus 2026-07-28 Series A/strategic/channel evidence |
| Irregular | `invested` | `negative` | pause follow-on and begin portfolio-risk review | 2026-07-30 Anthropic incident report directly challenges evaluation-containment assurance |

Centralize remains in the ledger but is rejected from the final four because the 2026-07-29 announcement states total funding and does not establish the current round stage. Other accepted/rejected candidates and reasons remain auditable in the ledger.

## Pending Product Decision

One evidence-context UX choice must be resolved before Task 8: whether pinned snapshots are restricted to an explicit sandbox/demo control; whether Report-launched Chat stays scoped to that report/run while global Chat defaults to the latest completed run; and whether the global Market page remains live-only with pinned events visible only through a labeled snapshot view. No other task waits on this decision.

---

### Task 1: Versioned research-package contract and candidate ledger

**Files:**

- Create: `lib/belief-reversal/contracts.ts`
- Create: `lib/belief-reversal/manifest.ts`
- Create: `seed/belief-reversal/2026-08-01/manifest.json`
- Create: `seed/belief-reversal/2026-08-01/expected-outcomes.json`
- Create: `seed/belief-reversal/2026-08-01/candidate-ledger.md`
- Test: `tests/unit/belief-reversal-manifest.test.ts`

**Step 1: Write failing contract tests**

Cover exactly four selected companies outside the original 19; required status/direction matrix; stable unique IDs; source authority and evidence role; exact event/publication/retrieval dates; historical cutoff; prior-before-trigger chronology; required counterevidence; protected `demo_fixture`/`Sample decision record`; and complete accepted/rejected ledger identities. Assert that production manifest loading cannot import `expected-outcomes.json`.

**Step 2: Run the focused test and observe RED**

```bash
node --import tsx --test --test-concurrency=1 tests/unit/belief-reversal-manifest.test.ts
```

**Step 3: Implement strict Zod schemas and the data package**

For every source store `verbatimExcerpt`, `normalizedStatement`, claims supported, source class, source authority, evidence role, canonical URL, event/publication/retrieval dates, and immutable content fingerprint inputs. Keep excerpts bounded and facts/assumptions/calculations/inferences explicitly classified. Encode unavailable metrics as unavailable fields, never placeholder numbers.

**Step 4: Run the focused test and observe GREEN**

**Step 5: Commit**

```bash
git add lib/belief-reversal seed/belief-reversal tests/unit/belief-reversal-manifest.test.ts
git commit -m "feat(research): add belief reversal evidence packages"
```

### Task 2: Exact source-text and MarketEvent provenance v2 contracts

**Files:**

- Modify: `lib/contracts/domain.ts`
- Modify: `lib/market/types.ts`
- Modify: `lib/market/service.ts`
- Modify: `lib/market/providers.ts`
- Modify: `lib/market/dedupe.ts`
- Modify: `lib/matching/context.ts`
- Test: `tests/contracts/domain.test.ts`
- Test: `tests/unit/market-service.test.ts`

**Step 1: Write failing tests for unsafe quote/provenance behavior**

Prove that normalized-only text cannot be verified as a quotation; `model_inference` has no verbatim quotation; verified exact text requires a revision, locator, and content fingerprint; source summaries no longer fall into a verbatim field; and malformed event/source dates, authority, class, role, trigger source, or entity keys fail closed.

**Step 2: Run focused tests and observe RED**

```bash
node --import tsx --test --test-concurrency=1 tests/contracts/domain.test.ts tests/unit/market-service.test.ts
```

**Step 3: Implement v2 contracts with an explicit legacy read adapter**

Introduce separate `verbatimExcerpt` and `normalizedStatement`; quote verification status; `eventAt`, `publishedAt`, `retrievedAt`, `entityKeys`, source class, source authority, and evidence role. Primary/secondary authority and trigger/corroborating/counterevidence role remain orthogonal. New writers cannot emit ambiguous `excerpt`; legacy artifacts remain readable but are marked unverified.

**Step 4: Run focused tests and observe GREEN**

**Step 5: Commit**

### Task 3: Typed belief-change assessment, score breakdown, and action policy

**Files:**

- Create: `lib/matching/hard-gates.ts`
- Create: `lib/reports/action-policy.ts`
- Modify: `lib/contracts/domain.ts`
- Modify: `lib/matching/scoring.ts`
- Modify: `lib/reports/next-step-policy.ts`
- Test: `tests/contracts/domain.test.ts`
- Test: `tests/unit/matching.test.ts`
- Test: `tests/unit/report-next-step-policy.test.ts`

**Step 1: Write failing table-driven tests**

Cover chronology, exact revisit-condition index/text mapping, cited counterevidence, changed prior/proposed action, status × direction legality, confidence/score consistency, `allPassed` derivation, and every Deal status across positive/mixed/negative/none/unavailable. Explicitly prove passed-negative cannot reopen and invested-negative requires `pause_follow_on` plus `portfolio_risk_review`.

**Step 2: Run focused tests and observe RED**

**Step 3: Implement strict versioned contracts**

Add `BeliefChangeDirection`, action kind/scope/priority, four final score dimensions, and `BeliefRevisionGateResults`. The deterministic gate module—not the model—decides pass/fail. Preserve `recommendedNextMove` only as rendered compatibility text generated from typed actions.

**Step 4: Run focused tests and observe GREEN**

**Step 5: Commit**

### Task 4: Grounded matching, hard-gate enforcement, and one ranking policy

**Files:**

- Modify: `lib/matching/claude-reasoner.ts`
- Modify: `lib/matching/service.ts`
- Modify: `lib/matching/scoring.ts`
- Modify: `lib/reports/company-analysis.ts`
- Modify: `worker/process-run.ts`
- Modify: `lib/underwriting/orchestrator.ts`
- Test: `tests/unit/matching-reasoner.test.ts`
- Test: `tests/unit/matching.test.ts`
- Test: `tests/unit/company-analysis.test.ts`
- Test: `tests/integration/process-run-underwriting.test.ts`

**Step 1: Write failing regression tests**

Prove a normalized statement cannot satisfy exact grounding; a Deal background `public_web` source cannot count as a recent event source; event and prior-context sources are independently required; every gate failure blocks `belief_revised` and Top 5 despite a high raw score; expected-outcome metadata is absent from model input; and equal-score sets larger than five produce the same deterministic order in matching, report projection, and underwriting.

**Step 2: Run focused tests and observe RED**

**Step 3: Implement minimal grounded behavior**

Pass explicit event source membership and exact Deal/fixture lineage into matching; cap and persist all four final dimensions; compute gates after model output; derive direction and typed actions; classify semantic gate failures as `monitor`, unresolved lineage/system failures as `analysis_unavailable`, and no relevant evidence as `no_material_change`.

**Step 4: Run focused tests and observe GREEN**

**Step 5: Commit**

### Task 5: PostgreSQL persistence for assessments, public snapshots, and run evidence bindings

**Files:**

- Create: `drizzle/0019_belief_reversal_evidence_context.sql`
- Modify: `db/schema.ts`
- Modify: `db/client.ts`
- Modify: `db/repositories/intelligence.ts`
- Modify: `db/repositories/runs.ts`
- Create: `db/repositories/market-evidence-snapshots.ts`
- Modify: `lib/contracts/http.ts`
- Modify migration manifest/release/sentinel files that currently end at `0018`
- Test: `tests/integration/schema-migrations.test.ts`
- Create: `tests/integration/belief-reversal-evidence-context-migration.test.ts`
- Test: `tests/unit/intelligence-repository.test.ts`
- Test: `tests/unit/runs-repository.test.ts`

**Step 1: Write failing repository and disposable-PostgreSQL tests**

Cover persisted score/gates/direction/actions, immutable snapshot/event rows, authoritative length-framed fingerprinting, workspace isolation, live/pinned conditional checks, one binding per run, run-scoped event sets, payload reparsing, tamper rejection, direct-mutation ACLs, and active-run identity separation.

**Step 2: Run focused unit tests and observe RED**

**Step 3: Implement migration and repositories**

Add explicit analysis columns/JSON payloads plus `market_evidence_snapshots`, ordered snapshot events, run evidence bindings, and run market events. Keep `market_events` as the live catalog. The database/RPC computes immutable fingerprints; clients cannot assert their own digest.

**Step 4: Run unit tests and disposable migration gates**

```bash
npm run test:migrations
npm run test:migrations:production-pg176
```

Never use a nonlocal or production database URL.

**Step 5: Commit**

### Task 6: Authoritative canonical web/text Deal memory and versioned seed

**Files:**

- Modify: `lib/storage/service.ts`
- Modify: `db/repositories/deal-registry.ts`
- Modify: `db/repositories/evidence-packs.ts`
- Create: `scripts/seed-belief-reversal-demo.ts`
- Modify: `package.json`
- Test: `tests/unit/deal-registry.test.ts`
- Create: `tests/integration/seed-belief-reversal-demo.test.ts`

**Step 1: Write failing memory/Supabase-adapter tests**

Prove canonical ordinary web/text Facts project into Deal memory with exact revision/URL lineage; canonical-only writes are visible to XTrace/matching; wrong workspace/source/revision ownership fails; the seed is idempotent; the original corpus counts/readiness stay unchanged; synthetic labels cannot be altered; and any production/nonlocal target is refused before a write.

**Step 2: Run focused tests and observe RED**

**Step 3: Implement the separate seed**

Persist bounded JSON source snapshots to private object storage, immutable source revisions/checksums, workspace documents, Companies, Deals, assignments, canonical `source_evidence_items`, and sample interactions. Do not duplicate facts into legacy evidence merely to pass tests; generalize the authoritative durable read projection.

**Step 4: Run focused tests and observe GREEN**

**Step 5: Commit**

### Task 7: Exact-lineage XTrace ingestion and capacity-safe recall

**Files:**

- Modify: `scripts/seed-belief-reversal-demo.ts`
- Modify: `lib/xtrace/service.ts`
- Modify: `worker/recall-deal-contexts.ts`
- Modify: `worker/process-run.ts`
- Test: `tests/unit/xtrace-service.test.ts`
- Test: `tests/unit/recall-deal-contexts.test.ts`
- Test: `tests/integration/process-run.test.ts`

**Step 1: Write failing lineage/capacity tests**

Cover exact source-revision/source/fixture ingestion, idempotent reusable jobs, unresolved child/parent lineage failing only one Deal, no cross-Deal contamination, 23-Deal request-budget behavior, and event selection capacity without silently dropping every relevant event for a Deal.

**Step 2: Run focused tests and observe RED**

**Step 3: Implement a retryable exact-lineage ingest stage and bounded recall**

The seed prepares authoritative data; XTrace ingest is an explicit retryable step that records job/memory lineage. Tests use a faithful fake client; a real credential is used only for authorized local E2E.

**Step 4: Run focused tests and observe GREEN**

**Step 5: Commit**

### Task 8: Live/pinned runtime separation and evidence-scoped reports/Chat

**Depends on:** the pending evidence-context UX decision.

**Files:**

- Modify: `app/api/runs/route.ts`
- Modify: `worker/process-run.ts`
- Modify: `db/repositories/intelligence.ts`
- Modify: `lib/reports/public.ts`
- Modify: `lib/underwriting/fingerprints.ts`
- Modify: `lib/underwriting/read-model.ts`
- Modify: `app/api/search/route.ts`
- Modify: `app/api/chat/route.ts`
- Test: `tests/unit/runs-route.test.ts`
- Test: `tests/integration/process-run.test.ts`
- Test: `tests/integration/chat-route.test.ts`

**Step 1: Write failing mode-mixing and scope tests**

Pinned execution must never call a live provider or mutate the live catalog; live execution must never read a snapshot; context mismatch stops before matching; report/fingerprint/context are immutable; Chat cannot combine live and pinned artifacts; and all pinned outputs carry the exact snapshot label.

**Step 2: Run focused tests and observe RED**

**Step 3: Implement the discriminated run path**

Live uses the run's persisted anchor and providers. Pinned reads exactly one reviewed immutable snapshot. Bind the event set before matching, propagate evidence context through report and underwriting fingerprints, and require server-validated report/run scope for search and Chat.

**Step 4: Run focused tests and observe GREEN**

**Step 5: Commit**

### Task 9: Complete partial-underwriting semantics and status-safe drafts

**Files:**

- Modify: `lib/contracts/underwriting.ts`
- Modify: `lib/underwriting/orchestrator.ts`
- Modify: `lib/underwriting/action-drafts.ts`
- Modify: `db/repositories/underwriting-artifacts.ts`
- Modify: `lib/underwriting/read-model.ts`
- Test: `tests/contracts/underwriting.test.ts`
- Test: `tests/unit/action-drafts.test.ts`
- Test: `tests/integration/underwriting-finalization.test.ts`
- Test: `tests/integration/action-drafts-route.test.ts`

**Step 1: Write failing matrix and unavailable-stage tests**

Cover action draft v2 metadata; every status/direction combination; invested-negative internal-only output; protected internal content absent externally; PATCH body-only immutability; policy version fingerprinting; and a candidate with unknown valuation still producing a complete evidence/missing-data/abstention/ceiling/action terminal artifact without a fabricated valuation.

**Step 2: Run focused tests and observe RED**

**Step 3: Implement action draft v2 and stage-complete unavailable outputs**

Separate delivery channel from draft format/audience/action scope. Formal underwriting assessment and portfolio action remain distinct. Legacy v1 drafts are readable as `legacy_unclassified` and are never claimed status-safe.

**Step 4: Run focused tests and observe GREEN**

**Step 5: Commit**

### Task 10: Structured Company Brief, durable source links, and complete report UI

**Files:**

- Modify: `lib/reports/company-analysis.ts`
- Modify: `lib/deals/read-model.ts`
- Modify: `app/company-intelligence.tsx`
- Modify: `app/underwriting-detail.tsx`
- Modify: `app/underwriting-summary.tsx`
- Modify: `app/page.tsx`
- Modify: `app/source-revision-link.tsx`
- Test: `tests/unit/company-analysis.test.ts`
- Test: `tests/unit/ui-hardening.test.ts`
- Test: `tests/integration/product-deal-read-model.test.ts`
- Test: `tests/rendered-html.test.mjs`

**Step 1: Write failing rendered behavior tests**

Assert durable Sample decision labels; exact quote versus normalized/inference labels; full provenance dates/classes/roles; four score dimensions and threshold; four hard gates and failure reasons; structured identity/founder/stage/model/geography/security fields; all 3 × 17 scenario inputs; coverage, conflicts, pricing premium; formal decision versus portfolio action; live/pinned banner; correct source revision/public URL; and complete unavailable states.

**Step 2: Run focused tests and observe RED**

**Step 3: Implement the UI/read models**

Consume canonical structured evidence rather than regex rewrites. Preserve six existing Company Brief sections while adding the required source-backed fields. Keep UI copy English for this plan.

**Step 4: Run focused tests and observe GREEN**

**Step 5: Commit**

### Task 11: Finalized-artifact Chat answers for the demo questions

**Files:**

- Modify: `lib/underwriting/read-model.ts`
- Modify: `lib/chat/report-evidence.ts`
- Modify: `lib/chat/service.ts`
- Modify: `app/product-search-view-model.ts`
- Test: `tests/unit/report-chat-evidence.test.ts`
- Test: `tests/unit/report-app-origin.test.ts`
- Test: `tests/integration/chat-route.test.ts`

**Step 1: Write failing query tests**

Cover prior pass reason, evidence change, strongest counterargument, confidence dimensions, framework disagreement, valuation unavailable/assumption, missing evidence, and invested follow-on-versus-risk action. Answers must come only from finalized typed artifacts, retain exact source IDs, distinguish quotation/normalized/inference, and preserve the run evidence context.

**Step 2: Run focused tests and observe RED**

**Step 3: Extend finalized search projection and grounded presentation**

Do not browse, rerun analysis, update Deal status, or translate content.

**Step 4: Run focused tests and observe GREEN**

**Step 5: Commit**

### Task 12: PostgreSQL-backed local end-to-end fixture and run

**Files:**

- Create: `tests/integration/belief-reversal-demo-e2e.test.ts`
- Create: `docs/qa/2026-08-01-belief-reversal-demo-local-e2e.md`

**Step 1: Provision only a disposable local PostgreSQL/Supabase-compatible test target**

Confirm the host is loopback/local and record a production-data invariance check before and after. Never load production credentials.

**Step 2: Run migrations, original seed, reversal seed, XTrace fake/authorized local ingest, pinned run, matching, derived Top 5, and underwriting**

Assert all 23 Deals remain present; the four selected companies reach medium/high only if their real score and gates pass; any case that does not pass is replaced from the ledger rather than forced.

**Step 3: Verify replay idempotency**

Repeat seed and pinned run. Assert immutable fingerprints, reused reviewed judgments for unchanged evidence, no duplicate source/interaction/memory lineage, and unchanged ranking.

**Step 4: Save the concise QA record and commit**

### Task 13: Full automated verification

**Step 1: Run focused new suites**

**Step 2: Run required gates**

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:migrations
npm run test:migrations:production-pg176
```

If sandbox listener restrictions recur, rerun only the affected listener tests outside the sandbox and record both outputs. Do not describe a sandbox EPERM as a functional regression.

**Step 3: Inspect `git diff --check`, worktree status, production invariance, and original-corpus invariants**

**Step 4: Commit verification/QA documentation if changed**

### Task 14: Manual browser acceptance and screenshots

**Required skill:** `browser:control-in-app-browser`

**Files:**

- Update: `docs/qa/2026-08-01-belief-reversal-demo-local-e2e.md`
- Create user-facing screenshots under `outputs/` only if needed for handoff

**Step 1: Start the local durable app/worker against the disposable data target**

**Step 2: Inspect Deals, Sources, Market, Reports, Underwriting, drafts, and Chat at desktop and mobile widths**

Verify the three prior statuses, both invested directions, Sample decision labels, pinned banner, source links, complete scenario/coverage/conflict/premium rendering, named frameworks/disagreements, formal decision/portfolio action separation, and draft-only controls.

**Step 3: Run every demo question from Section 15 of the handoff**

**Step 4: Record screenshots, failures, fixes, and final pass/fail evidence**

### Task 15: Per-task reviews, whole-branch review, and completion handoff

**Required skills:** `superpowers:requesting-code-review`, `superpowers:verification-before-completion`, then `superpowers:finishing-a-development-branch`.

**Step 1: Complete the subagent-driven review loop after every task**

No task advances with open Critical/Important findings.

**Step 2: Dispatch a whole-branch review against the merge base**

Review all user requirements, deferred/parked ledger entries, production-write guards, migrations, source provenance, gate correctness, action safety, and UI completeness.

**Step 3: Apply one reviewed final fix wave if required and rerun affected/full gates**

**Step 4: Deliver**

Report selected/rejected companies, exact scores/gates, derived Top 5, underwriting terminal results, local E2E/UI evidence, production invariance, commits, and any remaining credential/deployment blocker. Do not deploy or seed public sandbox until review and explicit authorization.
