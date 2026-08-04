# Underwriting Context, Modeling Assumptions, and IC Ask Design

## Status

Approved through the user's 2026-08-04 selection of evidence-context option B
and request to correct the IC Decision Ask presentation. This is a
presentation-only correction; persisted evidence, actions, decisions, lineage,
and immutable report artifacts remain unchanged.

## Problems

1. The report-local evidence context has no layout contract, so its status and
   display label run together. Both outer and inner presentations expose a raw
   ISO timestamp instead of a readable evidence window.
2. `Changed assumptions` incorrectly labels every persisted modeling input as
   evidence-driven change. Scenario price multipliers render their storage unit
   (`decimal`) instead of investor-readable multiples and deltas.
3. `IC Decision Ask` concatenates the first typed action into transport-like
   prose. Invested-negative analyses therefore omit the required second action,
   `portfolio_risk_review`, from the visible approval request.

## Approved presentation

### Evidence context

- Keep the outer report-scope banner and its `ASK THIS REPORT` control.
- Keep a report-local context block so a standalone report retains its evidence
  identity.
- Render a distinct status label, `Evidence window`, and a human-readable date
  range using the persisted evidence timezone.
- Show timezone and accepted-event count as secondary metadata.
- Preserve exact timestamps, snapshot identity, and fingerprints inside the
  existing audit disclosure.

### Modeling assumptions

- Rename the main-flow section to `Modeling Assumptions`.
- Group Bear, Base, and Bull `scenario_price_multiplier` inputs into one
  comparison row.
- Render `0.75 decimal`, `1 decimal`, and `1.25 decimal` as `0.75× (−25%)`,
  `1.00× (Base)`, and `1.25× (+25%)`.
- Render other assumptions as readable modeling inputs. A `security_type` of
  `preferred` becomes `Preferred equity` and remains explicitly marked
  `Placeholder · Requires confirmation`.
- Move raw assumption IDs, units, rationales, and input references to a
  collapsed assumption inventory in the Audit Appendix.
- Do not claim an assumption changed because of new evidence unless a future
  typed delta contract explicitly records that change.

### IC approval request

- Replace the generic definition row with a dedicated `IC APPROVAL REQUEST`
  callout.
- Derive every action line from the complete persisted typed-action list using
  the authoritative action-policy renderer.
- For Irregular, show both pause-follow-on and portfolio-risk-review actions.
- Show scope, priority, and visibility as secondary badges. These metadata do
  not alter eligibility or execute an action.
- Keep all communications draft-only; the callout has no Send, Publish, or
  automatic-execution control.

## Acceptance

- No visible `LIVE EVIDENCELive evidence` concatenation or raw ISO timestamp in
  the primary report context.
- No visible `0.75 decimal`, `1 decimal`, or `1.25 decimal` in the main memo.
- Scenario pricing is a single readable Bear/Base/Bull comparison.
- `Changed assumptions` is absent from current-run Deep Underwriting.
- Invested-negative IC approval requests contain both canonical typed actions.
- Exact raw assumption lineage remains available in the Audit Appendix.
- Existing 30-Deal report data, pinned replay, Source Revision lineage, action
  policy, and production isolation remain unchanged.
