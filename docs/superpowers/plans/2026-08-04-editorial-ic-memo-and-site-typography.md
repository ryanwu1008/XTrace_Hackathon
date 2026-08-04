# Editorial IC Memo and Site Typography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the card-heavy Deep Underwriting detail with a readable single-column IC memorandum, consolidate missing financial inputs into a diligence table, and raise typography across the complete VSee website.

**Architecture:** Keep PostgreSQL, CompanyAnalysis, underwriting artifacts, report fingerprints, and APIs unchanged. Extend the pure article presentation view model to derive editorial analyst rows and grouped valuation diligence from persisted artifacts, render those projections in the existing React detail component, and apply a documented responsive typography scale in CSS.

**Tech Stack:** TypeScript, React, Node test runner, CSS, vinext, local in-app browser acceptance.

## Global Constraints

- Do not read or modify production data.
- Do not rewrite immutable pinned reports or artifact fingerprints.
- Do not invent financial inputs, facts, probabilities, calculations, framework conclusions, or sources.
- Named public-source framework synthesis retains formal decision weight zero and no-endorsement labeling.
- Complete scenario inputs, framework records, provenance, lineage, versions, and fingerprints remain available in the Audit Appendix.
- Drafts remain draft-only and cannot be sent or published.
- Principal body copy is at least 15–16px; small mono text is reserved for audit metadata.

---

### Task 1: Typed editorial financial and framework projection

**Files:**
- Modify: `app/underwriting-article-view-model.ts`
- Modify: `app/analyst-panel-view-model.ts`
- Create: `tests/unit/underwriting-article-view-model.test.ts`
- Modify: `tests/unit/analyst-panel-view-model.test.ts`

**Interfaces:**
- Consumes: `CandidateUnderwritingDetail`, `UnderwritingAnalysisContext`, and persisted analyst issue groups.
- Produces: `financialCase.status`, `financialCase.availableEvidence`, `financialCase.requiredBeforeValuation`, and analyst issue rows with one source-safe `synthesizedView` each.

- [ ] **Step 1: Write a failing article-view-model test** with a literal scenario fixture containing 51 unavailable cells and assert that the projection returns one `not_supportable` status plus grouped diligence rows such as `Current ARR and growth`, `Cash, burn, and runway`, and `Exit assumptions and comparable set`.
- [ ] **Step 2: Write a failing analyst test** proving that a row synthesizes persisted strongest support, strongest counterevidence, and highest-priority unknown without dropping judgment IDs or opposing conclusions.
- [ ] **Step 3: Run** `node --import tsx --test tests/unit/underwriting-article-view-model.test.ts tests/unit/analyst-panel-view-model.test.ts` and verify RED because the new projection fields do not exist.
- [ ] **Step 4: Implement the minimal pure projections** using a fixed field-to-diligence catalog and existing persisted judgment text. Map missing data to `not_publicly_disclosed`, `not_independently_verified`, `cannot_calculate`, `not_applicable`, or `provider_or_lineage_unavailable`; never create model values.
- [ ] **Step 5: Re-run the focused tests** and verify GREEN.

### Task 2: Single-column editorial IC memorandum renderer

**Files:**
- Modify: `app/underwriting-detail.tsx`
- Modify: `tests/unit/underwriting-ui-task10.test.tsx`
- Modify: `tests/unit/ui-hardening.test.ts`

**Interfaces:**
- Consumes: the editorial projections from Task 1 and the unchanged public underwriting detail read model.
- Produces: one continuous memorandum, editorial framework table, one financial-status explanation, readable diligence table, and expandable complete audit matrices.

- [ ] **Step 1: Add failing renderer assertions** for `Portfolio Risk Re-underwriting Memorandum`, `Panel Conclusion`, `Areas of Agreement`, `Principal Disagreement`, `IC Implication`, the three-column framework table, `Current modeling status`, and `Required Before Valuation`.
- [ ] **Step 2: Add a failing negative assertion** proving that the main memorandum does not render 51 repeated `Unavailable` scenario rows and that the exact 3-by-17 matrix remains inside `Complete scenario input matrix` in the Audit Appendix.
- [ ] **Step 3: Run** `node --import tsx --test tests/unit/underwriting-ui-task10.test.tsx tests/unit/ui-hardening.test.ts` and verify RED against the card renderer.
- [ ] **Step 4: Replace issue cards with editorial prose and a semantic table.** The synthesized-view column receives the substantive persisted support/counterevidence/unknown text; analyst names and judgment range remain secondary.
- [ ] **Step 5: Replace the main scenario matrix with one typed model-status paragraph, currently available evidence, and a Priority / Required Evidence / Decision Use table.** Move the unchanged complete matrix into a closed Audit Appendix detail.
- [ ] **Step 6: Retain permanent sample labels, exact source links, draft-only copy, non-endorsement, formal weight zero, and final deterministic decision authority.**
- [ ] **Step 7: Re-run the renderer tests** and verify GREEN.

### Task 3: Editorial report layout and site-wide readable typography

**Files:**
- Modify: `app/vsee.css`
- Modify: `tests/unit/ui-hardening.test.ts`

**Interfaces:**
- Consumes: existing VSee semantic classes and new memo/table classes from Task 2.
- Produces: a centered single-column report, responsive tables, and a site-wide readable type scale.

- [ ] **Step 1: Record failing browser measurements** from the current local UI showing principal page copy below 15px, navigation/control labels below 11px, and the scenario content lacking a readable layout.
- [ ] **Step 2: Add CSS tokens and consumer rules** so primary narrative is 16–18px, general page and card copy is at least 15–16px, controls/navigation are at least 11–12px, and only audit metadata is 10–11px mono.
- [ ] **Step 3: Style the underwriting detail as a centered document.** Remove the left chapter rail and per-paragraph boxes, use whitespace and horizontal rules, give Synthesized View the largest table column, and use 15–16px cells with at least 1.55 line height.
- [ ] **Step 4: Add responsive stacked layouts** for framework synthesis and Required Before Valuation without shrinking body text.
- [ ] **Step 5: Run** `node --import tsx --test tests/unit/ui-hardening.test.ts`, `npx tsc --noEmit --incremental false`, and `git diff --check`.

### Task 4: Build, local browser acceptance, and commit

**Files:**
- Modify: `docs/qa/2026-08-03-current-30-cold-e2e-acceptance.md`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: verified local 30-analysis report and durable QA evidence.

- [ ] **Step 1: Run focused tests** for article projection, analyst projection, report rendering, UI hardening, report routes, and browser fixture port safety.
- [ ] **Step 2: Run** `npm run build` and verify exit 0.
- [ ] **Step 3: Reload the existing local report** at `http://127.0.0.1:3100`, open Irregular Deep Underwriting, and verify 30 analyses, 14 information areas, readable full-site typography, one missing-model summary, editorial analyst synthesis, full audit payload, and zero horizontal overflow.
- [ ] **Step 4: Measure representative computed styles** at desktop and mobile: primary narrative at least 15px, navigation/controls at least 11px, Synthesized View at least 15px with readable line height, and responsive tables stacked without clipping.
- [ ] **Step 5: Update the QA record** with exact report ID, counts, measured styles, viewport results, and test commands.
- [ ] **Step 6: Commit all authorized implementation and QA changes** and report the commit SHA. Do not push or touch production.

## Self-review

- Spec coverage: editorial memo, analyst synthesis, missing-evidence consolidation, complete audit preservation, site-wide typography, responsiveness, safety labels, production isolation, and browser acceptance are mapped to tasks.
- Placeholder scan: every implementation step is concrete and complete.
- Type consistency: Task 2 consumes only the projections defined in Task 1; Task 3 consumes the semantic classes emitted by Task 2.
