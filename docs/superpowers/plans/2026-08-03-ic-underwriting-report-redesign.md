# IC Underwriting Report Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a decision-first Deep Underwriting report with a readable queue and an issue-based Named Analyst Panel while retaining every persisted artifact and audit trail.

**Architecture:** Keep PostgreSQL and the public read model unchanged. Add a pure presentation view model that deterministically groups existing framework judgments by IC issue, then update the React report renderer and CSS to separate executive, synthesis, and audit layers.

**Tech Stack:** TypeScript, React server-compatible components, Zod-derived read models, CSS, Node test runner, vinext local app.

## Global Constraints

- Do not read or modify production data.
- Do not rewrite immutable pinned reports or artifact fingerprints.
- Named framework output retains formal decision weight zero.
- Do not expose or claim hidden chain of thought.
- Do not remove complete judgments, provenance, disagreements, or confidence dimensions.
- Drafts remain draft-only and cannot be sent or published.

---

### Task 1: Deterministic analyst panel synthesis

**Files:**
- Create: `app/analyst-panel-view-model.ts`
- Test: `tests/unit/analyst-panel-view-model.test.ts`

**Interfaces:**
- Consumes: `CandidateUnderwritingDetail["judgments"]`.
- Produces: `buildAnalystPanel(judgments): AnalystPanelViewModel` with issue groups, active/abstained counts, participant names, support, counterevidence, unknowns, and complete judgment membership.

- [x] **Step 1: Write failing tests** proving deterministic issue assignment, no judgment loss, separate abstention counts, and preserved opposing conclusions.
- [x] **Step 2: Run** `node --import tsx --test tests/unit/analyst-panel-view-model.test.ts` and verify RED because the module does not exist.
- [x] **Step 3: Implement** a pure typed classifier for the five approved IC issues and an uncategorized fallback that never drops a judgment.
- [x] **Step 4: Re-run the test** and verify GREEN.

### Task 2: Decision-first report and compact full appendix

**Files:**
- Modify: `app/underwriting-detail.tsx`
- Modify: `app/underwriting-summary.tsx`
- Test: `tests/unit/underwriting-ui-task10.test.tsx`
- Test: `tests/unit/ui-hardening.test.ts`

**Interfaces:**
- Consumes: `buildAnalystPanel` from Task 1 and the unchanged public underwriting read model.
- Produces: executive decision snapshot, issue-based Analyst Panel Summary, material disagreements, and expandable complete Framework Appendix.

- [x] **Step 1: Add failing renderer tests** for the executive snapshot, five issue headings, analyst participants, abstention summary, complete appendix, and permanent advisory safety labels.
- [x] **Step 2: Add failing queue tests** for separated status counts, compact priority markup, and explicit decision-unavailable copy.
- [x] **Step 3: Run the targeted tests** and verify RED against the legacy markup.
- [x] **Step 4: Implement minimal React markup** using the existing artifacts; do not add synthetic facts or change persisted decisions.
- [x] **Step 5: Run the targeted tests** and verify GREEN.

### Task 3: Responsive visual hierarchy and local acceptance

**Files:**
- Modify: `app/vsee.css`
- Test: `tests/unit/ui-hardening.test.ts`

**Interfaces:**
- Consumes: semantic class names from Task 2.
- Produces: responsive queue, executive snapshot, issue cards, disagreement cards, and appendix layout.

- [x] **Step 1: Add failing CSS assertions** for separate status-count cells, stable queue columns, issue-card grid, wrapping IDs, and mobile single-column behavior.
- [x] **Step 2: Run** `node --import tsx --test tests/unit/ui-hardening.test.ts` and verify RED.
- [x] **Step 3: Implement responsive CSS** with desktop grid and mobile stacking.
- [x] **Step 4: Run unit tests, typecheck, and diff checks** using `node --import tsx --test tests/unit/analyst-panel-view-model.test.ts tests/unit/underwriting-ui-task10.test.tsx tests/unit/ui-hardening.test.ts`, `npx tsc --noEmit --incremental false`, and `git diff --check`.
- [x] **Step 5: Browser acceptance** at `http://127.0.0.1:3100/?view=reports`: verify queue counts, row alignment, executive snapshot, issue synthesis, complete appendix, and mobile viewport.
- [ ] **Step 6: Commit** the approved local changes after smoke tests pass.

## Self-review

- Spec coverage: queue, executive layer, analyst synthesis, full appendix,
  disagreements, provenance, responsiveness, and production isolation are all
  mapped to tasks.
- Placeholder scan: no TBD, TODO, or deferred implementation steps remain.
- Type consistency: the only new cross-task interface is
  `buildAnalystPanel(judgments): AnalystPanelViewModel`.
