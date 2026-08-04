# Underwriting Reading Order and Source Actions Design

## Status

Approved by the user's 2026-08-04 direction to prioritize a coherent reading sequence, keep directly relevant evidence beside the claim it supports, and move disconnected evidence, metadata, and audit information to the end.

## Problem

The current memo interrupts `What Changed?` with the complete Evidence Pack fact ledger. `Required Diligence` also mixes diligence actions with Source Revision IDs and version pins. Action Drafts expose transport metadata, repeated evidence gaps, and an unformatted full body at the same visual level. Public-source fact cards label an archived JSON Source Revision snapshot as if it were the original source.

## Reading order

New current-run memos use this order:

1. Executive Conclusion
2. What Changed?
3. Verified Company Snapshot
4. Investment Thesis Assessment
5. Investor Framework Synthesis
6. Investment Committee Debate
7. Financial Case
8. Valuation and Return Analysis
9. VSee IC Synthesis
10. Required Diligence
11. Status-aware Action Drafts
12. Final IC Position
13. Evidence and Source Register
14. Audit Appendix

The main memo must close with a formal IC position before entering evidence registers or audit detail.

## Evidence hierarchy

- Keep the original public source and essential citation next to a market event or material claim.
- Remove the complete Fact ledger from `What Changed?`.
- Render the complete Fact ledger once in `Evidence and Source Register`.
- For a `web_snapshot` Fact, the primary link is its persisted canonical URL and is labeled `View original source`.
- The exact Source Revision remains a distinct secondary action labeled `Open archived evidence snapshot`; it must not imply that the JSON snapshot is the original article.
- For stored documents, preserve the exact revision and PDF page semantics. Do not invent an external URL.
- Move the Source Revision inventory, version pins, scenario matrix, framework appendix, claim-edge counts, and raw identities into the final audit section.
- Keep inline `LineageValue` and `ClaimTrace` disclosures where they explain a decision-relevant value.

## Action Draft presentation

- Preserve the existing durable Action Draft contract, API payload, body bytes, edit behavior, and draft-only safety rules.
- Add a presentation-only projection that orders drafts as: internal memo, diligence request, founder email, founder LinkedIn, founder SMS, followed by deterministic fallback ordering.
- Deduplicate missing-evidence requests across drafts by `fieldId` and show them once at section level.
- Each draft row shows its readable purpose, channel/audience, primary typed action, draft-only status, and updated date.
- Put the complete body in a closed `Read full draft` disclosure and preserve whitespace with a readable text measure.
- Put policy IDs and raw safety metadata in a secondary `Audit metadata` disclosure.
- Keep Edit controls. Never add Send, Publish, or automatic delivery controls.

## Compatibility and authority

- Do not change persisted reports, underwriting artifacts, formal decisions, XTrace lineage, or production data.
- Existing pinned reports remain readable through the same data contracts.
- Public DTO projection exposes only a minimal typed source action derived from
  the persisted Fact locator. It may include a safe canonical public URL or a
  stored-revision page number, but never private excerpts, image regions, or
  other raw locator payload.
- Unsafe or absent canonical URLs fail closed to the archived snapshot action only.

## Acceptance

- The main memo contains no complete Fact ledger, Source Revision inventory, or version grid before the evidence/register boundary.
- Final IC Position precedes both the Evidence and Source Register and Audit Appendix.
- Public Fact primary links resolve to persisted canonical URLs; archive actions are explicitly labeled snapshots.
- Missing evidence is summarized once across all Action Drafts.
- Full draft bodies are collapsed by default and preserve paragraphs when opened.
- The 30-Deal scan/report flow, Underwriting artifacts, legacy pinned replay, and draft-only safeguards remain unchanged.
