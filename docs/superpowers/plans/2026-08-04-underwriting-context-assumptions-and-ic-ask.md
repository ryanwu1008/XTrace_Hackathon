# Underwriting Context, Modeling Assumptions, and IC Ask Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace three transport-like Underwriting UI fragments with readable, complete IC-report presentation while preserving every persisted contract.

**Architecture:** Add presentation projections only. Evidence-context formatting remains derived from the immutable report context, while modeling-assumption grouping and the IC approval request are derived from persisted Evidence Pack assumptions and the complete typed-action list.

**Tech Stack:** TypeScript, React server rendering, CSS, Node test runner, Vinext, local browser fixture.

## Global Constraints

- Do not change persisted reports, CompanyAnalyses, Evidence Packs, typed actions, formal decisions, or fingerprints.
- Do not read or modify production data.
- Exact timestamps, IDs, units, and input references remain available in audit detail.
- Action presentation must use all persisted typed actions and must not add execution, Send, or Publish controls.

---

### Task 1: Human-readable evidence context

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/company-intelligence.tsx`
- Modify: `app/vsee.css`
- Test: `tests/unit/evidence-context-label.test.ts`
- Test: `tests/unit/company-intelligence-ui-task10.test.tsx`

**Interfaces:**
- Consumes: immutable `ReportEvidenceContext` / `RunEvidenceContext`.
- Produces: readable outer label and structured report-local evidence-window block.

- [x] **Step 1: Write failing tests** expecting a timezone-aware readable date range, separate status/window elements, and no raw ISO label in primary presentation.

```ts
assert.equal(
  evidenceContextLabel(liveContext),
  "LIVE EVIDENCE · Jul 18, 2026 – Aug 1, 2026",
);
assert.match(reportHtml, /LIVE EVIDENCE[\s\S]*Evidence window/);
assert.match(reportHtml, /Jul 18, 2026 – Aug 1, 2026/);
assert.doesNotMatch(reportHtml, /2026-08-01T23:59:59\.999Z/);
```

- [x] **Step 2: Run focused tests** and confirm failure against the current concatenated presentation.
- [x] **Step 3: Implement the minimal formatting and CSS** while retaining exact context identity inside the existing disclosure.

```ts
export function formatEvidenceWindow(input: {
  windowStartAt: string;
  windowEndAt: string;
  windowTimezone: string;
}): string;
```

- [x] **Step 4: Run focused tests** and confirm the live, pinned, and legacy variants pass.

### Task 2: Modeling assumptions and complete IC approval request

**Files:**
- Modify: `app/underwriting-article-view-model.ts`
- Modify: `app/underwriting-detail.tsx`
- Modify: `app/vsee.css`
- Test: `tests/unit/underwriting-ui-task10.test.tsx`

**Interfaces:**
- Consumes: `EvidencePack.assumptions` and the complete `beliefAssessment.actions` array.
- Produces: grouped scenario-pricing presentation, readable remaining assumptions, a complete IC approval request, and an audit-only raw assumption inventory.

- [x] **Step 1: Write failing render tests** requiring `0.75× (−25%)`, `1.00× (Base)`, `1.25× (+25%)`, a confirmation-labeled preferred-equity placeholder, and no raw decimal unit in the main memo.

```ts
assert.match(mainMemo, /Modeling Assumptions/);
assert.match(mainMemo, /Bear[\s\S]*0\.75× \(−25%\)/);
assert.match(mainMemo, /Base[\s\S]*1\.00× \(Base\)/);
assert.match(mainMemo, /Bull[\s\S]*1\.25× \(\+25%\)/);
assert.match(mainMemo, /Preferred equity[\s\S]*Requires confirmation/);
assert.doesNotMatch(mainMemo, /Changed assumptions|0\.75 decimal|fund_policy:/i);
assert.match(auditAppendix, /Persisted assumption inventory[\s\S]*fund_policy:/);
```

- [x] **Step 2: Write a failing IC test** requiring both invested-negative action sentences plus portfolio/high/internal metadata.

```ts
assert.match(mainMemo, /IC APPROVAL REQUEST/);
assert.match(mainMemo, /Pause follow-on investment activity/);
assert.match(mainMemo, /Begin an internal portfolio-risk review/);
assert.match(mainMemo, /Portfolio scope[\s\S]*High priority[\s\S]*Internal only/);
```

- [x] **Step 3: Run focused tests** and confirm failures reflect the current raw presentation and single-action ask.
- [x] **Step 4: Implement minimal projections and editorial components** using the authoritative action-policy renderer; put raw assumption fields and references in a collapsed Audit Appendix inventory.

```ts
interface IcDecisionAskPresentation {
  summary: string;
  actionLines: string[];
  scopes: string[];
  priorities: string[];
  visibility: string[];
}

interface ModelingAssumptionsPresentation {
  scenarioPricing: Array<{
    scenario: "bear" | "base" | "bull";
    displayValue: string;
  }>;
  remaining: CandidateUnderwritingDetail["evidencePack"]["assumptions"];
}
```

- [x] **Step 5: Run focused tests** and confirm all required copy and audit boundaries pass.

### Task 3: Verification and local acceptance

**Files:**
- Modify: `docs/qa/2026-08-03-current-30-cold-e2e-acceptance.md`

**Interfaces:**
- Consumes: completed presentation changes.
- Produces: verified local report and one saved commit.

- [x] **Step 1: Run focused UI suites, TypeScript, lint, `git diff --check`, and release build.**
- [x] **Step 2: Reload the current 30-Deal report at `127.0.0.1:3100` and inspect the three corrected regions.**
- [x] **Step 3: Verify no horizontal overflow and that underlying counts, typed actions, and audit lineage are unchanged.**
- [x] **Step 4: Append exact acceptance evidence, commit authorized changes, and leave the local report open.**
