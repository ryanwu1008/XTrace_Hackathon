# Task 10 report: complete source-grounded report UI

## Outcome

Completed the durable Deal, Company Brief, Reports, underwriting-detail, and
draft presentation path without enabling production writes. The UI now renders
the persisted belief-reversal authority instead of inferring missing structure
from prose, keeps synthetic decision history permanently labeled, and exposes
truthful unavailable states whenever a finalized artifact is absent.

## Structured company and belief-reversal presentation

- Company Brief consumes persisted semantic fields for identity, founders,
  stage, business model, geography, security type, traction, and deal terms.
  It renders `fact`, `unavailable`, `conflicting`, `assumption`, and `unknown`
  as distinct states and requires every factual source ID to resolve to the
  canonical lineage.
- Durable product Deal list/detail/search/overview reads include the registry
  sample interaction with the fixed `Sample decision record` label. A foreign
  Deal memory bundle is rejected rather than projected under the wrong Deal.
- Reports expose the exact 35/30/20/15 score dimensions, Medium 50% and High
  78% thresholds, chronology, revisit-condition mapping, counterevidence, and
  action-delta gates, including persisted failure reasons.
- Pinned/live evidence identity is rendered inside each report and underwriting
  detail, including the immutable snapshot/context fingerprints and a clear
  historical-snapshot warning. Legacy reports explicitly state that the
  evidence frame is unavailable.

## Evidence text, provenance, and links

- Verified verbatim excerpts are rendered only as quotations. Normalized-only,
  legacy-unverified, and model-inference text is visibly non-quotation content.
- Event and source provenance includes event, publication, retrieval, and
  update dates with precision, provider, entity keys, source class, authority,
  evidence role, locator, fingerprint, trigger lineage, and exact Source
  Revision identity.
- Canonical public evidence exposes its safe public URL and, when present, its
  exact revision. Canonical source documents use only their exact
  `sourceRevisionId`; source, evidence, event, and document IDs are never
  promoted to revision identity. Document-page locators retain their page
  anchor through both static and signed revision navigation.
- Explicit legacy document identities retain the authorized legacy document
  route for compatibility. Product Chat citations now carry a typed
  `sourceRevisionId` rather than relying on a citation ID convention.

## Complete underwriting presentation

- The client uses one authoritative `CandidateUnderwritingDetail` read-model
  type; the duplicate hand-maintained DTO was removed.
- Underwriting displays the complete persisted 3 x 17 Bear/Base/Bull input
  model, formula and probability policy, Facts/Assumptions/unavailable lineage,
  Evidence Pack coverage, conflicts, pricing premium, calculations, framework
  judgments and disagreements, valuation blockers, and version pins.
- Formal underwriting decision and status-aware Deal/portfolio action are
  separate. Invested-negative pause-follow-on and portfolio-risk-review actions
  remain internal, and ActionDraft v2 shows its status, direction, format,
  channel, audience, actions, missing evidence, and permanent draft-only marker.
- Ask lineage is fail-closed: it is a Fact only when exactly one accepted
  `reported_valuation` Fact equals the persisted current ask. Unaccepted,
  mismatched, or ambiguous Facts render as unsupported.
- Every empty artifact area has an explicit unavailable state. No metric,
  valuation, action, source identity, or framework conclusion is fabricated.

## Review fixes

Independent review found and the implementation fixed the cross-surface forms
of four issues: document/source IDs incorrectly substituting for revision IDs,
synthetic history missing its permanent label, Ask pointing to the first
valuation-like Fact rather than the exact accepted Fact, and document-page
anchors being displayed but not applied. Negative rendered tests now cover each
failure mode across Reports, Company Brief, drafts, Chat, and underwriting.

Final independent review reported zero Critical and zero Important findings.
Five non-blocking presentation observations remain recorded for Task 15:
integer percentage rounding at the 78% boundary, chronology dates not shown
beside gate IDs, Evidence Facts not displaying source role/accepted-for-gate,
fired rules not listing each input reference inline, and Deal cards not showing
the sample interaction date. The persisted authority and lineage remain intact.

## Verification

- Focused Task 10 unit, integration, UI-hardening, route, upload, draft, and
  view-model group: 96 passed, 0 failed.
- Production rendered-HTML checks: 2 passed, 0 failed.
- `npm run typecheck`: passed.
- `npm run lint`: passed with zero errors and nine pre-existing warnings in
  underwriting repository/orchestrator lease destructuring.
- `npm run build`: passed.
- `git diff --check`: passed.

No source was sent, published, translated, or treated as production data. No
production migration, seed, deployment, credential, provider call, or
production authorization was used.
