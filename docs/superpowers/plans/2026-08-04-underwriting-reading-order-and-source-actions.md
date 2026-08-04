# Underwriting Reading Order and Source Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Deep Underwriting read as a coherent IC memo, expose real original-source links, and keep complete evidence and draft audit material at the end.

**Architecture:** Preserve every persisted underwriting and Action Draft contract. Add only presentation projections: derive a minimal public source-action object from the persisted Fact locator without exposing raw excerpts or inventing URLs, and build a deterministic Action Draft section view model. Recompose the existing React memo and CSS around those projections.

**Tech Stack:** TypeScript, React server/static rendering tests, Node test runner, Vinext, PostgreSQL-backed local browser fixture.

## Global Constraints

- Production data must not be read, migrated, seeded, or modified.
- Pinned reports and their fingerprints remain immutable.
- Exact Source Revision and XTrace lineage remain visible and unchanged.
- Original URLs come only from persisted canonical locators and pass the existing safe-URL policy.
- Action Draft bodies remain byte-for-byte durable and draft-only; no Send or Publish action is added.

---

### Task 1: Preserve Fact Locators and Render Honest Source Actions

**Files:**
- Modify: `lib/underwriting/read-model.ts`
- Modify: `app/underwriting-detail.tsx`
- Test: `tests/unit/underwriting-view-model.test.ts`
- Test: `tests/unit/underwriting-ui-task10.test.tsx`

**Interfaces:**
- Consumes: persisted `Fact.locator` and `Fact.sourceRevisionId`.
- Produces: `CandidateUnderwritingDetail.evidencePack.facts[].sourceAction` and an underwriting source-action renderer.

- [x] **Step 1: Write failing tests** proving `toCandidateUnderwritingDetail()` derives a safe public source action, a public Fact primary link is its exact safe canonical URL, and its secondary action is labeled `Open archived evidence snapshot`.
- [x] **Step 2: Run the focused tests** and verify failure because the UI previously rendered only Source Revision access links.
- [x] **Step 3: Add a minimal `sourceAction` projection** and render original/source-revision actions without exposing raw locator excerpts or inventing URLs for documents or internal records.
- [x] **Step 4: Run focused tests** and verify public, non-public web, unsafe-URL, and page-anchor cases pass.

### Task 2: Build the Action Draft Presentation Projection

**Files:**
- Create: `app/action-draft-view-model.ts`
- Modify: `app/underwriting-detail.tsx`
- Modify: `app/vsee.css`
- Test: `tests/unit/action-draft-view-model.test.ts`
- Test: `tests/unit/underwriting-ui-task10.test.tsx`

**Interfaces:**
- Consumes: `PublicActionDraft[]`.
- Produces: `buildActionDraftSection(drafts)` with deterministic ordered drafts and section-level deduplicated missing evidence.

- [x] **Step 1: Write failing pure tests** for internal-memo-first order, deterministic fallback order, single evidence summary across five drafts, fail-closed conflicting `fieldId` payloads, legacy fallback, and unchanged full-body bytes.
- [x] **Step 2: Run tests** and verify failure because the presentation projection does not exist.
- [x] **Step 3: Implement the minimal pure projection** using only typed metadata; never parse editable body text.
- [x] **Step 4: Write failing render assertions** that missing evidence appears once, each body lives in a closed `Read full draft` disclosure, audit metadata is secondary, and Edit controls remain without Send/Publish.
- [x] **Step 5: Replace the transport-field dump** with a section summary, compact draft rows, `pre-wrap` body disclosure, and audit disclosure.
- [x] **Step 6: Run pure and UI tests** and verify all pass.

### Task 3: Recompose the Memo Reading Order

**Files:**
- Modify: `app/underwriting-detail.tsx`
- Modify: `app/vsee.css`
- Test: `tests/unit/underwriting-ui-task10.test.tsx`
- Test: `tests/unit/ui-hardening.test.ts`

**Interfaces:**
- Consumes: existing memo sections and source-action renderer.
- Produces: the 14-section narrative-first memo defined in the design.

- [x] **Step 1: Update the reading-order test** so `Final IC Position` precedes `Evidence and Source Register`, which precedes `Audit Appendix`.
- [x] **Step 2: Extend the appendix-boundary test** so the complete Fact register, Source Revision inventory, and version grid cannot occur before the evidence/register boundary.
- [x] **Step 3: Run the tests** and verify they fail against the existing layout.
- [x] **Step 4: Move the complete Fact ledger** out of `What Changed?`; keep inline event citations and material value lineage.
- [x] **Step 5: Remove Source Revision/version inventories** from Required Diligence and place them in the final audit section.
- [x] **Step 6: Move Final IC Position to section 12**, create section 13 `Evidence and Source Register`, and keep Audit Appendix as section 14.
- [x] **Step 7: Restyle the register as a compact editorial table/list**, not an early two-column card wall; keep mobile stacking and readable type.
- [x] **Step 8: Run UI and CSS tests** and verify the new hierarchy, accessibility, and responsive contracts pass.

### Task 4: Verification, Local Acceptance, and Commit

**Files:**
- Modify: `docs/qa/2026-08-03-current-30-cold-e2e-acceptance.md`

**Interfaces:**
- Consumes: completed UI implementation.
- Produces: verified local report and one company-mainline commit.

- [x] **Step 1: Run focused view-model/UI suites**, TypeScript, `git diff --check`, and production build.
- [x] **Step 2: Reload the existing isolated 30-Deal report on `127.0.0.1:3100`** and open Irregular Deep Underwriting.
- [x] **Step 3: Verify in the browser** that the narrative order is correct, original public links and archived snapshots are distinct, Action Draft full bodies are collapsed and paragraph-preserving, and desktop/mobile have no horizontal overflow.
- [x] **Step 4: Append exact acceptance evidence** to the QA record.
- [x] **Step 5: Run the relevant regression suite**, commit all authorized changes, and leave the local report open for review.
