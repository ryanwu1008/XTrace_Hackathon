# Full IC Underwriting Article and Live 30-Deal Report Plan

> **Status:** Approved continuation of the user-selected compact named-analyst option B and the attached 13-section sample underwriting prototype.

## Goal

Deliver a source-grounded Deep Underwriting reading experience that follows the approved 13-section IC article, while preserving the immutable 23-analysis pinned replay and proving that a newly triggered current scan creates and opens a distinct 30-analysis report.

## Non-negotiable contracts

- The 2026-08-01 pinned report remains immutable at 23 analyses.
- A current full scan uses all 30 analysis-eligible Deals and persists exactly 30 CompanyAnalyses.
- Every `belief_revised` analysis enters Deep Underwriting; priority changes order only.
- Facts, assumptions, unknowns, conflicts, calculations, framework judgments, formal decisions, and provenance remain visibly distinct.
- Missing evidence stays `Unavailable`; presentation code may not invent facts, amounts, probabilities, conclusions, or sources.
- Named framework judgments are public-source product syntheses, not endorsements, have formal decision weight zero, and expose no hidden chain of thought.
- Action outputs remain drafts only.
- No production reads, writes, seeds, migrations, or deployment.

## Task 1 — Correct named-framework applicability for unavailable geography

1. Add a loader regression test proving that a framework Card whose geography selector is `all` remains context-applicable when the Deal geography is unavailable.
2. Add a negative regression test proving that a geography-specific Card remains excluded when geography is unavailable.
3. Replace the blanket `core_only + geography unavailable` framework abstention with the audited Card's own four-dimensional applicability result.
4. Preserve core-only valuation and deterministic decision ceilings.
5. Run the focused loader, framework-lens, valuation, and decision tests.

## Task 2 — Define the source-safe IC article presentation contract

1. Add a pure underwriting article view-model which projects only persisted report artifacts and CompanyAnalysis context.
2. Represent the approved reading order:
   1. Executive Investment Snapshot and IC Decision Ask
   2. What Changed?
   3. Verified Company Snapshot
   4. Company and Market Assessment
   5. Named Analyst Panel
   6. Investment Committee Debate
   7. Bear / Base / Bull Scenarios
   8. Valuation and Return Analysis
   9. VSee IC Synthesis
   10. Required Diligence
   11. Status-aware Action Drafts
   12. Evidence Classification
   13. Audit Appendix
   14. Final IC Position
3. Derive Bull, Bear, and disagreement content only from persisted framework support, counterarguments, implications, and disagreement records.
4. Keep complete IDs, versions, provenance, and lineage in an expandable audit appendix instead of the continuous reading flow.
5. Add negative tests for unavailable evidence and unsupported values.

## Task 3 — Render the complete underwriting article

1. Refactor the Deep Underwriting detail into the approved section order and labels.
2. Keep the first screen decision-first: formal result, ceiling, confidence, changed belief, next action, and critical missing evidence.
3. Add a verified/unverified company snapshot and a readable Then → Now belief mechanism.
4. Present the compact option-B Named Analyst Panel grouped by IC issue, with complete per-framework records in the appendix.
5. Add explicit Bull, Bear, and true-disagreement blocks; show `Unavailable` rather than generic filler when the persisted artifact has no position.
6. Separate scenario operations from valuation/return conclusions.
7. Move evidence classification, exact Source Revisions, versions, claim edges, and framework provenance into the Audit Appendix.
8. Preserve permanent sample/synthetic and draft-only labels.
9. Add desktop and mobile layout regression coverage.

## Task 4 — Make historical 23 versus current 30 unambiguous

1. Add clear historical copy to pinned reports explaining that 23 is the immutable historical universe and that a current scan uses the current 30-Deal registry.
2. Do not rewrite the pinned report or its fingerprints.
3. Trigger a new scan from the actual UI and wait for the resulting 30-analysis report.
4. Verify that the focused URL references the new report rather than the pinned replay.

## Task 5 — Full verification and handoff

1. Run focused unit tests, full typecheck, and production build.
2. Run the controlled local 30-Deal cold E2E pipeline and required smoke checks.
3. In the browser, click `WAKE AGENT & SCAN MARKET`, verify 30 analyses and outcome-count equality, then open Irregular Deep Underwriting.
4. Verify all approved article sections, applicable named analysts, unavailable fields, exact provenance links, sample labels, draft-only labels, and responsive layout.
5. Commit all authorized company-mainline changes and report the commit SHA.
6. Leave `http://127.0.0.1:3100` open on the exact new 30-analysis report for user review.
