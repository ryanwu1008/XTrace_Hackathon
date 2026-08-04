# 30-Deal Belief Change Scan and Cold E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the immutable 23-Deal pinned demonstration while making every current completed Scan process 30 analysis-eligible Deals into exactly 30 auditable CompanyAnalyses, admit every qualifying belief revision to Deep Underwriting without a rank cutoff, and prove the complete browser-triggered cold path.

**Architecture:** A run owns an immutable Deal-universe binding. The historical 2026-08-01 pinned run remains bound to its exact 23 Deals and fingerprints; a new live/cold run snapshots the current 30 eligible Deals. All 30 produce a lightweight `CompanyAnalysis`; every `belief_revised` analysis with Medium/High confidence, the existing score threshold, exact lineage, no provider/system failure, and every persisted hard gate passing receives one immutable underwriting job. Deterministic score/tie-break ordering controls queue priority only and never eligibility.

**Tech Stack:** Next.js/React, TypeScript, Zod, PostgreSQL 17.6, Drizzle SQL migrations, Vitest, Playwright/in-app browser, XTrace adapter, Anthropic-compatible deterministic local fixtures.

## Global Constraints

- The final current registry is exactly 30 Companies, 30 Deals, and 30 analysis-eligible Deals.
- The seven added Deals are Centralize, ChipAgents, Sent, Cascade, Cordant, Empirical Security, and Freight Hero.
- Every added Deal has status `screening`, research disposition `qualified_not_selected`, `analysisEligibleAt` set, active Source Revisions, an active source fingerprint, Deal-bound canonical evidence, and Deal-bound exact-parent XTrace lineage.
- Every added Deal permanently displays `Sample research screening record`; the record has `meetingOccurred=false` and `vcInteraction=false` and may not represent a historical Pass, investment decision, or real VC interaction.
- Every completed current Scan has exactly one CompanyAnalysis per bound eligible Deal. Its four outcome counts (`belief_revised`, `monitor`, `no_material_change`, `analysis_unavailable`) sum exactly to the Deal-universe count.
- `CompanyAnalysis` is the internal contract name. Product copy is `Belief Change Check` or `Belief Change Analysis`; complete multi-stage work is `Deep Underwriting`; multi-analyst output is `Investor Framework Perspectives`.
- `belief_revised` admission requires Medium/High Match Confidence, the existing score threshold, chronology/revisit-condition/counterevidence/action-delta gates passing, exact Source Revision/XTrace lineage, a proposed action different from the prior action, and no provider/system failure.
- Every admitted `belief_revised` analysis receives Deep Underwriting. Deterministic score and Deal-ID tie-breaks produce `priorityRank` for queue/UI/notification order only; they may not truncate eligibility, hard-code the original four, or exclude `qualified_not_selected` Deals.
- Frameworks, 17-field scenarios, Bear/Base/Bull, valuation or explicit `Unavailable`, MOIC/IRR calculations where supported, disagreements, decision ceilings, formal decisions or explicit unavailable states, action drafts, and finalized Chat execute for every `belief_revised` analysis. `monitor`, `no_material_change`, and `analysis_unavailable` create none of those artifacts.
- `beliefRevisedCount` equals `underwritingCandidateCount` for every completed current run, including cardinalities 0, 1, 4, 5, 7, and 30. Every candidate persists a completed/partial/failed terminal state with an explicit reason where applicable.
- Resource control uses a persisted priority queue, bounded concurrency, retryable jobs, immutable job identity, idempotent stage replay, per-stage timeout, and cost/latency telemetry; it never drops a candidate because of rank or capacity.
- The existing 2026-08-01 23-analysis pinned Report and its fingerprints are immutable and replayable. New live/cold runs use a separate 30-Deal universe and may not mutate or contaminate the pinned artifact.
- Legacy pinned Top-5/rank fields remain readable only through an explicit legacy adapter and may be presented as historical priority order. New runs never write or depend on Top-5 eligibility semantics.
- Verbatim excerpts and normalized statements are separate. Facts, assumptions, calculations, framework opinions, and inferences remain typed and source-distinguishable. Never claim hidden Chain of Thought.
- Founder Email, SMS, LinkedIn, internal memo, and diligence requests remain drafts only.
- Use only disposable local PostgreSQL, local fixture providers, and test data. Do not read or modify production, deploy, push, or use production provider credentials.
- Repeated seed, ingest, replay, and underwriting orchestration are idempotent and do not duplicate Deals, analyses, XTrace memories, or artifacts.
- Localization remains paused until the company mainline is complete and its final schemas are rechecked.
- As soon as the first complete 30-Deal cold flow passes the necessary smoke suite, commit all authorized company-mainline changes and deploy that exact SHA to an authorized Preview/Staging target backed only by non-production data. Continue comprehensive QA after deployment; do not wait for edge-case closure before the first staging handoff.

---

### Task 1: Typed 30-Deal research and analysis contracts

**Files:**
- Create: `docs/superpowers/specs/2026-08-03-underwrite-all-belief-revisions-product-decision-addendum.md`
- Modify: `lib/contracts/research-candidate.ts`
- Modify: `lib/belief-reversal/contracts.ts`
- Modify: `lib/contracts/domain.ts`
- Modify: `seed/belief-reversal/2026-08-01/manifest.json`
- Test: `tests/contracts/research-candidate.test.ts`
- Test: `tests/unit/belief-reversal-manifest.test.ts`
- Test: `tests/unit/company-analysis.test.ts`

**Interfaces:**
- Produces seven stable `dealId` values, `status: "screening"`, `researchDisposition: "qualified_not_selected"`, `analysisEligible: true`, typed evidence gaps, reconsideration conditions, and a non-fictional screening record.
- Produces `CompanyAnalysisOutcome = "belief_revised" | "monitor" | "no_material_change" | "analysis_unavailable"` and preserves typed direction/actions/gates/lineage/fingerprints.
- Removes new-run `selectedForTop5`, `top5Selection`, rank-cutoff, and capacity-gate semantics while retaining a typed `priorityRank` that cannot affect eligibility.

- [ ] **Step 1: Add failing contract tests.** Assert the exact seven names and stable Deal IDs; reject `passed`, `watchlist`, `invested`, formal decisions, `meetingOccurred=true`, `vcInteraction=true`, normalized text in `verbatimExcerpt`, and missing active Source Revision identity.
- [ ] **Step 2: Run RED.** Run `npx vitest run tests/contracts/research-candidate.test.ts tests/unit/belief-reversal-manifest.test.ts tests/unit/company-analysis.test.ts`; expected failures name the missing Deal and outcome contracts.
- [ ] **Step 3: Implement the minimal schemas and manifest projection.** Keep `verbatimExcerpt` and `normalizedStatement` distinct and require the literal external label `Sample research screening record`.
- [ ] **Step 4: Run GREEN.** Re-run the same command and require zero failures.

### Task 2: PostgreSQL Deal universe, seven Deals, and Deal-bound exact lineage

**Files:**
- Create: `drizzle/0024_research_candidate_xtrace.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `lib/storage/service.ts`
- Modify: `db/repositories/deal-registry.ts`
- Modify: `db/repositories/xtrace-lineage.ts`
- Modify: `scripts/seed-belief-reversal-demo.ts`
- Test: `tests/integration/belief-reversal-demo-seed-migration.test.ts`
- Test: `tests/integration/seed-belief-reversal-demo.test.ts`
- Test: `tests/integration/xtrace-lineage-v2-migration.test.ts`
- Test: `tests/integration/workspace-composite-migration.test.ts`

**Interfaces:**
- Produces immutable `deal_universe_snapshots_v1` membership/binding that can represent the old exact 23 universe and the current exact 30 universe.
- Extends existing Deal v2 exact-parent lineage with `sample_research_screening_record`; it does not create a parallel research-memory graph.
- The reviewed source set adds 18 resolved public Source Revisions and seven screening-record parents; one unresolved Reuters item remains a typed gap without revision/memory. Actual E2E counts, not a hard-coded estimate, are authoritative.

- [ ] **Step 1: Add failing disposable-PostgreSQL tests.** Prove identity-without-Deal is excluded; current eligible snapshot is exact30; all seven are screening/eligible; old pinned membership remains exact23; cross-workspace membership and source recall fail closed; repeated seed has zero deltas.
- [ ] **Step 2: Run RED on PostgreSQL 17.6.** Run `REQUIRE_POSTGRES_MIGRATION_TESTS=1 npm run test:postgres -- tests/integration/belief-reversal-demo-seed-migration.test.ts tests/integration/seed-belief-reversal-demo.test.ts tests/integration/xtrace-lineage-v2-migration.test.ts tests/integration/workspace-composite-migration.test.ts` against the disposable database; expected failures identify the missing seven Deals/universe binding.
- [ ] **Step 3: Implement migration, repository methods, and idempotent seed.** Make every parent reference an exact active Source Revision and its owning Deal; reject immutable drift, cross-Deal/workspace recall, unresolved source ingestion, and duplicate ID/different content.
- [ ] **Step 4: Run GREEN and repeat the seed/ingest.** Require exact30 eligible Deals and no duplicate rows, parents, or children on the second pass.

### Task 3: Run-bound scan and exactly one CompanyAnalysis per Deal

**Files:**
- Modify: `worker/process-run.ts`
- Modify: `db/repositories/intelligence.ts`
- Modify: `lib/reports/company-analysis.ts`
- Modify: `lib/reports/public.ts`
- Modify: `lib/underwriting/fingerprints.ts`
- Test: `tests/integration/process-run-underwriting.test.ts`
- Test: `tests/unit/company-analysis.test.ts`
- Test: `tests/unit/intelligence-repository.test.ts`

**Interfaces:**
- Consumes the immutable universe bound to the claimed run, never the mutable current registry after claim.
- Persists one analysis keyed by `(workspaceId, runId, dealId)` with workspace/run/report/Deal/Company identity, prior status/memory, considered and matched event IDs, XTrace and Source Revision lineage, relevance dimensions, score, confidence, four typed gates, direction/actions/outcome, explicit non-change/failure/no-underwriting reasons, and context fingerprints.
- Provider/lineage failure produces `analysis_unavailable`; no relevant material change produces `no_material_change`; insufficient action change produces `monitor`; Medium/High plus all gates produces `belief_revised`.

- [ ] **Step 1: Add failing behavior tests.** Cover exact30 analyses, sum-of-outcomes30, no-event `no_material_change`, risk-only `monitor`, lineage failure `analysis_unavailable`, passing candidate `belief_revised`, and duplicate analysis rejection/replay reuse.
- [ ] **Step 2: Run RED.** Run `npx vitest run tests/integration/process-run-underwriting.test.ts tests/unit/company-analysis.test.ts tests/unit/intelligence-repository.test.ts` and verify failures come from missing run-bound/current30 behavior.
- [ ] **Step 3: Implement deterministic lightweight projections.** All branches must retain considered events and recall results; unavailable inputs must not be converted into a fake conclusion.
- [ ] **Step 4: Run GREEN.** Re-run the focused suite with zero failures.

### Task 4: Belief-revision admission, priority queue, and Deep Underwriting isolation

**Files:**
- Modify: `lib/matching/hard-gates.ts`
- Modify: `lib/matching/ranking.ts`
- Modify: `lib/underwriting/orchestrator.ts`
- Modify: `lib/underwriting/candidate-grounding.ts`
- Modify: `db/repositories/underwriting-artifacts.ts`
- Test: `tests/integration/process-run-underwriting.test.ts`
- Test: `tests/integration/underwriting-finalization.test.ts`
- Test: `tests/unit/candidate-grounding-lineage.test.ts`

**Interfaces:**
- Admission input is all 30 persisted CompanyAnalyses; eligibility is outcome/confidence/existing score threshold/all gates/exact lineage/action delta/no provider failure. Sort is final score descending then stable Deal ID ascending and assigns `priorityRank` without truncation.
- `Sample research screening record` is valid typed prior context without pretending a meeting. Its initial evidence may fail chronology/revisit/action gates, but later evidence can naturally pass.
- Underwriting candidate Deal IDs equal all `belief_revised` Deal IDs exactly; `beliefRevisedCount === underwritingCandidateCount`. Each candidate has one immutable job identity and a persisted completed/partial/failed terminal result.

- [ ] **Step 1: Add failing tests.** Prove high score + failed gate is excluded; 0/1/4/5/7/30 belief revisions create exactly 0/1/4/5/7/30 jobs; priority ordering and equal-score tie-breaks are deterministic but do not alter admission; and every non-belief-revised Deal has zero framework/valuation/decision/draft artifacts.
- [ ] **Step 2: Run RED.** Run `npx vitest run tests/integration/process-run-underwriting.test.ts tests/integration/underwriting-finalization.test.ts tests/unit/candidate-grounding-lineage.test.ts`.
- [ ] **Step 3: Implement admission, persisted priority queue, and stage guards.** Remove `MAX_AUTOMATIC_CANDIDATES`, rank-based `not_selected`, and every name/disposition/status-specific shortcut while retaining status-aware action policy after admission.
- [ ] **Step 4: Run GREEN and replay.** Confirm repeated orchestration reuses terminal artifacts and creates no duplicates.

### Task 5: Report, Chat, and UI projections

**Files:**
- Modify: `lib/reports/public.ts`
- Modify: `app/company-intelligence.tsx`
- Modify: `app/underwriting-summary.tsx`
- Modify: `app/underwriting-detail.tsx`
- Modify: `app/page.tsx`
- Modify: `app/api/chat/route.ts`
- Test: `tests/unit/company-intelligence-ui-task10.test.tsx`
- Test: `tests/unit/underwriting-ui-task10.test.tsx`
- Test: `tests/integration/underwriting-report-route.test.ts`
- Test: `tests/integration/chat-route.test.ts`

**Interfaces:**
- Report exposes `eligibleDealCount`, `companyAnalysisCount`, all four dynamic outcome counts, `underwritingCandidateCount`, and underwriting queued/running/completed/partial/failed counts; the four outcomes sum to the universe and candidate count equals belief-revised count.
- UI uses `Belief Revisions`, `Changed Beliefs`, `Underwriting Queue`, `Priority Order`, `Underwriting Status`, `Belief Change Analysis`, `Deep Underwriting`, and `Investor Framework Perspectives`. New runs never display Top 5, rank rejection, or selection-cutoff language.
- Chat stays report/run/Deal scoped and cites the same finalized evidence; every terminal belief-revised underwriting artifact is addressable, while non-belief-revised Deals never receive invented underwriting.

- [ ] **Step 1: Add failing route/component tests.** Cover exact30 current counts, exact23 pinned counts, outcome sum, belief-revised/candidate equality, all underwriting status counts, seven screening labels, no formal Pass copy, no Top-5/rank-cutoff copy in new runs, and no draft/framework links for non-belief-revised analyses.
- [ ] **Step 2: Run RED.** Run the four focused test files and verify the new count/copy assertions fail for the intended missing behavior.
- [ ] **Step 3: Implement the public projections and accessible UI.** Preserve keyboard/mobile/non-color status behavior and existing report routes.
- [ ] **Step 4: Run GREEN.** Require all focused tests to pass.

### Task 6: True click-to-Worker cold Scan and semantic quality parity

**Files:**
- Modify: `tests/helpers/belief-reversal-e2e-pipeline.ts`
- Modify: `tests/helpers/belief-reversal-live-market.ts`
- Modify: `scripts/run-belief-reversal-cold-worker.ts`
- Modify: `scripts/run-belief-reversal-browser-fixture.ts`
- Modify: `tests/helpers/belief-reversal-quality-parity.ts`
- Test: `tests/unit/belief-reversal-e2e-pipeline.test.ts`
- Test: `tests/unit/belief-reversal-live-market.test.ts`
- Test: `tests/unit/belief-reversal-cold-worker.test.ts`
- Test: `tests/unit/belief-reversal-browser-fixture.test.ts`
- Test: `tests/unit/belief-reversal-quality-parity.test.ts`
- Test: `tests/integration/belief-reversal-demo-e2e.test.ts`

**Interfaces:**
- Browser POST queues the run; the fixture Worker calls the real `claimNext` and production `processClaimedRun`; a controlled local HTTP source supplies canonical packets that must hash-match active Source Revisions.
- The new report has exactly30 complete lightweight analyses. The shared23 projections and every belief-revised underwriting have the same semantic completeness as the reviewed pinned artifact except legitimate run IDs/timestamps/live labels/fingerprints. Seven new Deals retain complete auditable lightweight checks.

- [ ] **Step 1: Add failing cold-path and quality tests.** Prove no report exists before click, the click creates the queued run, Worker claims it, controlled sources are collected, all30 are recalled/matched/analyzed, all and only belief revisions are underwritten without truncation, and every required report section/citation/Chat answer is present.
- [ ] **Step 2: Run RED.** Run the six unit files plus the focused integration E2E; reject a pre-generated-only path, a 23-analysis live report, source-hash drift, quality loss, any rank cutoff, underwriting on a non-belief-revised Deal, or a missing belief-revised job.
- [ ] **Step 3: Implement the minimal fixture plumbing through production boundaries.** Fixture credentials are test literals and never inherit production values; local URLs and disposable DB are fail-closed requirements.
- [ ] **Step 4: Run GREEN and replay.** Execute a second identical run/replay and prove no duplicate analyses, memories, or underwriting artifacts and no mutation of the pinned report.

### Task 7: First complete smoke, immediate commit, and Preview/Staging handoff

**Files:**
- Modify: `docs/qa/` smoke evidence files
- Modify: `docs/demo-runbook.md`
- Modify: `README.md`

**Interfaces:**
- Produces the first user-testable non-production deployment from the exact smoke-verified commit, plus a human-readable smoke record and production-isolation statement.

- [ ] **Step 1: Run the necessary smoke suite.** Require focused contract/ranking/repository/route tests, TypeScript compile, deployment build, and one disposable PostgreSQL 17.6 cold browser flow from click through 30 analyses and all belief-revised terminal jobs.
- [ ] **Step 2: Verify smoke cardinalities and production isolation.** Record exact30 Companies/Deals/eligible/analyses, outcome sum30, `beliefRevisedCount === underwritingCandidateCount`, every candidate terminal, pinned23 unchanged, and only loopback/disposable/test-provider resources used.
- [ ] **Step 3: Commit immediately after smoke passes.** Stage every authorized company-mainline change, preserve unrelated user work, create one descriptive commit, and report its SHA before deployment.
- [ ] **Step 4: Deploy the exact commit to the authorized Preview/Staging target.** Use the existing target when supplied, or a separately approved private Staging target; configure only non-production PostgreSQL/Worker/provider values. Do not migrate, seed, read, or modify production data.
- [ ] **Step 5: Verify the staging URL and hand it to the user.** Confirm health, page load, and a safe non-production smoke path, then provide the exact URL so user testing can begin while Task 8 continues.

### Task 8: Post-deployment comprehensive QA, review, and follow-up release

**Files:**
- Review all files changed by this plan and the pre-existing company-mainline WIP; preserve unrelated user changes.
- Modify: `docs/qa/` comprehensive acceptance evidence

**Interfaces:**
- Produces review-clean follow-up fixes, full automated/browser evidence, and a refreshed Staging deployment from an exact commit when fixes changed the smoke release.

- [ ] **Step 1: Run the full unit/integration suite, both disposable migration gates, typecheck, lint, build, replay/idempotency, 0/1/4/5/7/30 admission matrix, `git diff --check`, desktop/mobile browser acceptance, and finalized Chat coverage.** Record fresh passed/failed/skipped totals and exact cardinalities.
- [ ] **Step 2: Run spec-compliance and code-quality review.** Treat every Critical/Important finding as blocking until fixed and re-reviewed.
- [ ] **Step 3: Re-run the verification commands affected by review fixes.** Fresh outputs, not prior reports, support completion claims.
- [ ] **Step 4: Inspect final provenance.** Ensure no secret, production credential, hidden-CoT claim, fake VC interaction, accidental pinned artifact rewrite, or production data access is present.
- [ ] **Step 5: Commit and redeploy follow-up fixes when needed.** Report the new SHA and refreshed Staging URL; do not migrate, seed, read, or modify production.
