# Underwrite All Belief Revisions — Authoritative Product-Decision Addendum

**Status:** Approved product decision, effective 2026-08-03.

**Precedence:** This addendum overrides every earlier company-research, belief-reversal, matching, report, prompt, plan, fixture, API, and UI requirement that used Top 5, rank cutoff, or a fixed underwriting capacity as an eligibility rule. All provenance, exact Source Revision/XTrace lineage, hard-gate, Medium/High confidence, score-threshold, draft-only, production-isolation, and non-fabrication requirements remain in force.

## Authoritative flow

`All analysis-eligible Deals → one CompanyAnalysis per Deal → every admitted belief_revised CompanyAnalysis → one Deep Underwriting job per belief revision`

- The current registry contains exactly 30 Companies, 30 Deals, and 30 analysis-eligible Deals.
- Every completed current Scan persists exactly 30 CompanyAnalyses.
- Every CompanyAnalysis outcome is exactly one of `belief_revised`, `monitor`, `no_material_change`, or `analysis_unavailable`; the four counts sum to the eligible Deal count.
- A `belief_revised` outcome requires Medium or High confidence, the existing score threshold, chronology passed, exact revisit-condition mapping passed, counterevidence passed, action delta passed, exact Source Revision/XTrace lineage, a proposed action materially different from the prior action, and no provider/system failure.
- Every and only `belief_revised` analysis creates an underwriting candidate/job. Therefore `beliefRevisedCount === underwritingCandidateCount` for cardinalities from 0 through 30.
- Score ordering and a deterministic stable-Deal-ID tie-break produce `priorityRank` only. Priority affects queue execution, UI order, and notification order; it never changes eligibility and never truncates candidates.
- `monitor`, `no_material_change`, and `analysis_unavailable` do not create underwriting jobs or framework, valuation, formal-decision, or draft artifacts.

## Deep Underwriting completeness

Every belief revision produces a terminal completed, partial, or failed underwriting job. A partial or failed job persists an explicit reason. Completed or partially available work preserves, as applicable:

- Evidence Pack with facts, assumptions, unknowns, conflicts, and exact citations;
- Bear/Base/Bull scenarios and complete typed inputs;
- calculations and valuation, or an explicit `Unavailable` result;
- named Investor Framework Perspectives, strongest support, strongest counterargument, limitations, and disagreements;
- decision ceiling and formal decision, or an explicit unavailable result;
- status-aware draft-only actions; and
- finalized report-scoped Chat projection.

## Resource control

Cost and latency are controlled with a persisted priority queue, bounded concurrency, retryable immutable jobs, idempotent stage replay, per-stage timeouts, and cost/latency telemetry. Rank or capacity may not permanently omit an eligible underwriting job.

Repeated execution reuses the same immutable candidate/job identity and must not duplicate CandidateRuns, XTrace memories, or underwriting artifacts.

## New-run product language

New schemas, APIs, reports, and UI use:

- `Belief Revisions`
- `Changed Beliefs`
- `Underwriting Queue`
- `Priority Order`
- `Underwriting Status`
- `Belief Change Analysis`
- `Deep Underwriting`
- `Investor Framework Perspectives`

New runs do not write or display Top-5 selection, selected-for-Top-5, rank rejection, rank cutoff, or `not_selected_due_to_rank` semantics.

## Legacy compatibility

The immutable 2026-08-01 23-analysis pinned Report, its Source Revision/XTrace/Report/Underwriting fingerprints, and its historical fields remain unchanged and replayable. An explicit legacy read adapter may expose old rank fields as historical priority order. New runs do not write or depend on the legacy Top-5 eligibility model.

## Required cardinality and negative coverage

- 30 eligible Deals create 30 CompanyAnalyses.
- 0, 1, 4, 5, 7, and 30 belief revisions create exactly 0, 1, 4, 5, 7, and 30 underwriting jobs.
- Priority ordering cannot change admission; ties remain deterministic.
- Every belief-revised candidate reaches a persisted completed/partial/failed state.
- Non-belief-revised outcomes create no fake underwriting.
- Retry/replay creates no duplicate jobs or artifacts.
- Finalized Chat can access every completed belief-revised underwriting artifact.
- New UI never treats sixth-or-later priority as rejected or not selected.
- Production data, credentials, migration targets, seeds, and providers are never read or modified during implementation or acceptance.
