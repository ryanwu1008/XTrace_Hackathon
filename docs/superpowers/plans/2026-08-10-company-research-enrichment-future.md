# Company Research Enrichment Future Implementation Plan

> **For agentic workers:** This plan is deliberately DEFERRED. Do not execute it as part of the article-first Named Lens release. When the product owner starts this phase, use superpowers:brainstorming to confirm the external research provider and cost boundary, then use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Status:** Deferred until the Deep Underwriting article, Named Lens prose, report UI, and Demo acceptance are complete.

**Goal:** For every admitted `belief_revised` CompanyAnalysis, actively collect a bounded set of current public company sources, preserve immutable raw captures and exact provenance, create Deal-bound Source Revisions and XTrace lineage, and build Deep Underwriting from the enriched evidence instead of only the Deal's pre-existing revisions.

**Current verified gap:** The live one-click scan collects market events and identifies changed beliefs, but it does not perform company-centered research afterward. `worker/process-run.ts` creates Underwriting jobs immediately; `lib/underwriting/candidate-grounding.ts` then reads the Deal's existing `activeSourceRevisionIds`. It does not discover pages, capture content, create revisions, extract company evidence, or ingest new exact XTrace parents. The deterministic E2E fixture primes pre-existing sources and cannot prove this production behavior.

**Architecture:** Insert two candidate-owned stages before current context routing and Evidence Pack construction:

```text
company_enrichment -> exact_xtrace_ingest -> context_router -> evidence_pack
-> valuation -> framework_catalog -> framework_lenses -> decision
-> named_lens_presentation -> narrative_drafts -> finalization
```

Company research providers discover candidates but never create Facts directly. The capture service retrieves and fingerprints source bytes, the Source Registry creates or appends immutable revisions, a typed extractor produces Deal-bound evidence, exact XTrace ingests those saved parents, and only then may the Evidence Pack freeze the resulting lineage.

**Implementation prerequisite decision:** Before Task 2, approve one non-production research provider, its monthly cost ceiling, timeout, and per-company query/page limits. The recommended first evaluation is the existing Anthropic account's managed web-search capability if the target model and citation contract support the required raw capture and URLs; otherwise use a separately configured search provider behind the same interface. Verify current official provider documentation at implementation time.

## Global constraints

- Research is bounded by a versioned coverage plan; the product never claims to search the entire public internet.
- A URL, search result, provider summary, model inference, MarketEvent text, or XTrace recall is not a Fact or Source Revision.
- Every accepted public Fact resolves to captured source bytes, immutable Source Revision identity, exact locator, retrieval time, and Deal/workspace ownership.
- Original-language source text is preserved. Normalized statements and any future translation remain derivative and cannot pass exact-quote validation.
- Facts, Assumptions, Unknowns, Conflicts, and provider failures remain separate.
- No company research runs for `monitor`, `no_material_change`, or `analysis_unavailable` outcomes.
- Every `belief_revised` analysis receives exactly one immutable enrichment job identity; retries and exact replay do not duplicate jobs, revisions, XTrace parents, or evidence.
- Required provider, capture, extraction, registry, or XTrace failure stops downstream Underwriting fail-closed with a typed reason.
- Deterministic/loopback providers are fixture-only and cannot satisfy live or Staging acceptance.
- Production data, production secrets, the existing `vsee-vc` Worker, and production migrations remain prohibited until separately reviewed and authorized.

---

### Task 1: Typed research plan, capture, and coverage contracts

**Files:**
- Create: `lib/contracts/company-enrichment.ts`
- Create: `lib/company-research/contracts.ts`
- Test: `tests/contracts/company-enrichment.test.ts`

- [ ] Write failing strict-schema tests for `CompanyResearchPlanV1`, `CompanyResearchJob`, `CompanyResearchAttemptEvent`, `CapturedPublicSource`, `CapturedPublicSourceSnapshot`, `CompanyResearchCoverage`, `CompanyResearchDisposition`, `EnrichmentSourceRevisionBinding`, and `CompanyEnrichmentResult`.
- [ ] Require the bounded coverage domains `company_official`, `regulatory_filing`, `financing`, `product_customer`, `market_competition`, and `material_risk`.
- [ ] Require one exact `captured | not_applicable | unavailable` disposition per domain. `not_applicable` needs a typed rule; zero results and provider absence are `unavailable`.
- [ ] Require canonical HTTP(S) URL, source class/authority/role, retrieval timestamp, raw-body SHA-256, content type, original language, exact/normalized locator metadata, provider/version, discovery-query fingerprint, and workspace/Deal/Candidate ownership.
- [ ] Reject provider-supplied revision IDs, URL-only evidence, inferred uncaptured text, cross-tenant identity, unsafe redirects/schemes, duplicate canonical source identity, and fixture provider identity in live mode.
- [ ] Run the focused contract tests and commit.

---

### Task 2: Bounded discovery, capture, and normalization service

**Files:**
- Create: `lib/company-research/providers.ts`
- Create: `lib/company-research/service.ts`
- Create: `lib/company-research/normalization.ts`
- Test: `tests/unit/company-research-service.test.ts`

- [ ] Write failures for timeout, cancellation, malformed result, redirect to a private/non-HTTP target, oversized body, unsupported content type, duplicate URL, changed content, missing publication date, and partial provider success.
- [ ] Define `CompanyResearchDiscoveryProvider` and `PublicSourceCapturePort`; provider adapters return discovery candidates only.
- [ ] Resolve company identity from canonical Deal name/domain and persisted source evidence before constructing bounded domain queries.
- [ ] Capture source bytes server-side, enforce allowlisted size/type/time limits, canonicalize URL identity, and create an immutable observation fingerprint.
- [ ] Preserve verbatim source text separately from normalized extraction candidates. Never let normalization create quote eligibility.
- [ ] Emit complete typed coverage dispositions and attempt telemetry even when no source is accepted.
- [ ] Run tests against controlled local HTTP fixtures; no live network dependency in automated unit tests.

---

### Task 3: PostgreSQL 0029 append-only enrichment artifacts

**Files:**
- Create: `drizzle/0029_company_research_enrichment.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `db/schema.ts`
- Create: `db/repositories/company-research.ts`
- Create: `tests/integration/company-research-enrichment-migration.test.ts`
- Test: `tests/integration/company-research-enrichment.test.ts`

- [ ] On a fresh disposable PostgreSQL 17.6 cluster, write failing tests for ownership, RLS/ACL, immutable triggers, unique identities, reserve-before-settle events, atomic rollback, replay, and refresh.
- [ ] Add append-only `company_research_jobs`, `company_research_attempt_events`, `company_research_source_observations`, `company_research_coverage_dispositions`, and `company_research_revision_bindings`.
- [ ] Persist workspace, report, run, Candidate, Deal, plan/provider/version/fingerprint, bounded query, timestamps, outcome/failure code, source snapshot hash, and revision binding.
- [ ] Add owner-guarded service-role RPCs for job creation, attempt reservation/settlement, and atomic capture-to-revision binding. Direct DML stays denied.
- [ ] Extend checkpoint stages with `company_enrichment` and `exact_xtrace_ingest` while retaining every legacy stage value.
- [ ] Register migration index 29 without changing the production launcher safety refusal.

---

### Task 4: Source Revision, evidence extraction, and exact XTrace lineage

**Files:**
- Modify: `db/repositories/source-registry.ts`
- Modify: `db/repositories/deal-registry.ts`
- Modify: `db/repositories/evidence-packs.ts`
- Modify: `worker/ingest-confirmed-source.ts`
- Modify: `worker/run-exact-xtrace-ingest.ts`
- Create: `lib/company-research/source-binding.ts`
- Test: `tests/integration/company-research-source-binding.test.ts`

- [ ] Write failing tests for initial revision, same-byte replay, changed-byte append, supersession, conflicting publisher metadata, extractor failure rollback, foreign Deal/revision identity, and duplicate XTrace memory.
- [ ] In one owner-guarded transaction, create/append Source Revision, associate the active revision to the Deal, persist extracted evidence, and persist the enrichment binding.
- [ ] Re-read and verify the exact saved revision and content hash before XTrace submission.
- [ ] Create exact XTrace parent units only from saved revisions; persist intent/result identities and require success before candidate grounding.
- [ ] Reject any path that treats a search result, provider prose, or recalled XTrace text as captured source authority.

---

### Task 5: Candidate orchestration, fingerprints, replay, and terminal behavior

**Files:**
- Modify: `lib/contracts/underwriting.ts`
- Modify: `lib/underwriting/candidate-stage-runtime.ts`
- Modify: `lib/underwriting/orchestrator.ts`
- Modify: `lib/underwriting/candidate-grounding.ts`
- Modify: `lib/underwriting/evidence/builder.ts`
- Modify: `lib/underwriting/fingerprints.ts`
- Modify: `db/repositories/underwriting-runs.ts`
- Modify: `worker/runner.ts`
- Modify: `worker/process-run.ts`
- Test: `tests/unit/candidate-stage-runtime.test.ts`
- Test: `tests/integration/process-run-underwriting.test.ts`

- [ ] Write stage-order tests proving enrichment and exact XTrace complete before context routing/Evidence Pack/provider work.
- [ ] For every and only `belief_revised` analysis, create exactly one Candidate-owned enrichment job.
- [ ] Reload the post-enrichment Deal revision set and freeze it with exact XTrace lineage in the Evidence Pack fingerprint.
- [ ] Include plan/provider configuration, coverage, captures, revision set, extraction, XTrace intent/result, and stage versions in immutable Candidate identity.
- [ ] Exact replay reuses byte-identical terminal enrichment artifacts; refresh creates a new canonical Candidate and never mutates the old one.
- [ ] Provider/capture/extraction/registry/XTrace failure yields an explicit terminal `partial` or `unavailable` reason and cannot fall back to seed/fixture evidence.
- [ ] Stop swallowing whole-batch Underwriting errors; persist each Candidate's bounded failure while preserving the scan report.

---

### Task 6: API, report status, and operator visibility

**Files:**
- Modify: `lib/underwriting/read-model.ts`
- Modify: `app/api/reports/[id]/underwriting/[dealId]/route.ts`
- Modify: `app/underwriting-detail.tsx`
- Modify: `app/vsee.css`
- Test: `tests/integration/underwriting-report-route.test.ts`
- Test: `tests/unit/underwriting-detail.test.tsx`

- [ ] Expose bounded public statuses: research queued, collecting, source capture complete, XTrace ingesting, ready for Underwriting, partial, and unavailable.
- [ ] Show source-domain coverage and explicit failure reasons without provider secrets, internal queries, or raw storage keys.
- [ ] Completed memo citations open the exact captured Source Revision access route.
- [ ] An enrichment failure cannot render a fabricated or legacy memo as current.
- [ ] Keep full attempts, hashes, provider metadata, and lineage in the audit Appendix rather than the main memo.

---

### Task 7: Cold E2E, real-provider Staging, QA, and production hold

**Files:**
- Modify: `tests/helpers/belief-reversal-e2e-pipeline.ts`
- Modify: `tests/helpers/belief-reversal-e2e-verifier.ts`
- Modify: `tests/integration/belief-reversal-demo-e2e.test.ts`
- Modify: `docs/demo-runbook.md`
- Create: `docs/qa/company-research-enrichment-acceptance.md`

- [ ] Extend the deterministic fixture only for structural and failure-path coverage, with permanent fixture labels and assertions that it cannot satisfy live/Staging acceptance.
- [ ] Prove monitor/no-change/unavailable outcomes create zero enrichment jobs.
- [ ] Prove positive and negative belief revisions each complete discovery, capture, Source Revision, exact XTrace, Evidence Pack, Underwriting, report citation, and Chat scope.
- [ ] Prove timeouts, unsafe redirects, changed bodies, partial providers, XTrace failures, exact replay, refresh, and cross-workspace isolation.
- [ ] Run real provider acceptance only against isolated non-production Supabase and separate Web/Worker targets on the same commit; startup rejects production and fixture identities.
- [ ] Record source/revision/XTrace/Evidence Pack/Candidate fingerprints, screenshots, provider/cost/latency telemetry without secrets, and explicit production non-access.
- [ ] Do not apply migration 0029 or seed/enrichment writes to production before separate review and authorization.

---

## Future acceptance definition

This future phase is complete only when a user can press one Scan action and observe, for each changed belief, a durable transition from company research through exact citations to a terminal Deep Underwriting report. A pre-generated fixture, a MarketEvent URL, existing seed evidence, or a manually run XTrace backfill does not satisfy that requirement.
