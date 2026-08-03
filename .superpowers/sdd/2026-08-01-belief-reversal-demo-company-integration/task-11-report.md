# Task 11 report: finalized-artifact deterministic Chat

## Outcome

Completed the durable finalized-report Chat path for product and public sandbox
workspaces. Durable Chat now reads one exact terminal report/run/Deal and its
finalized CompanyAnalysis and underwriting artifacts. It does not construct or
call Claude, XTrace, Market search, browser, analysis, mutation, draft, or
translation paths. The read-only public demo retains its existing explicit
XTrace behavior.

## Strict projection and provenance

- Added the strict `FinalizedChatProjectionV1` contract with exactly eight
  supported topics, the three authoritative text classes (`exact_quote`,
  `normalized_statement`, and `persisted_inference`), stable claim/projection
  fingerprints, strict artifact refs, and exact source/document/revision/content
  fingerprint refs.
- Exact quotations require verbatim equality to a canonical verified revision.
  Normalized statements must equal saved normalized text and are never quoted.
  Facts, Assumptions, Calculations, unavailable values, and action states remain
  distinguishable through typed artifact refs while rendering only as persisted
  inference.
- Added deterministic projections for prior reason, belief change, strongest
  counterargument, match confidence, framework disagreement, valuation,
  missing evidence, and invested action. Missing required authority returns a
  typed insufficient result; there is no fallback to another report or runtime
  synthesis.
- Sandbox Sample authority requires the permanent `Sample decision record`
  label, canonical v2 provenance, exact revision/fingerprint identity, and exact
  canonical normalized equality to the finalized investment memory. Product
  mode rejects every demo fixture.
- Invested actions preserve the complete saved kind, scope, priority, and
  visibility metadata and remain separate from formal underwriting decisions.

## Exact scope and UI behavior

- Added an exact finalized-scope loader that validates workspace, report/run,
  evidence frame, Deal, terminal batch, scoped candidate membership, finalized
  artifact identity, and current/legacy generation. It uses only scoped
  `candidateRunIds` plus `getByCandidateRunId()` and never lists global finalized
  artifacts.
- Rerun aliases remain the exact report candidate identity while explicitly
  binding and validating the immutable source candidate and stable analysis
  fingerprint.
- Implicit Deal selection requires one exact company name, Deal ID, or explicit
  status phrase. Generic words such as `investment` and `evaluation` cannot
  silently choose a Deal.
- Durable requests omit and ignore `xtraceEnabled`. Report-launched Chat sends
  only exact report/run/Deal identifiers. The UI shows report, resolved company,
  and pinned/live/legacy evidence context, including an implicitly resolved
  company returned by the API.
- Chat transcripts reset when moving between reports, Deals, and global Chat.
  Late async responses are accepted only when the request scope still equals
  the visible scope, preventing cross-report citation leakage.
- Finalized citations render their exact Source Revision link. Main-navigation
  Chat clears report scope; read-only public-demo requests keep the XTrace
  toggle.

## Review fixes

Independent review identified and the implementation fixed seven authority or
scope issues: rerun aliases using the artifact source as the report identity,
an expanded text-class enum, Sample normalized text drifting from finalized
memory, invested actions omitting safety metadata, generic status-word scope
selection, cross-report transcript reuse, and missing resolved-company header
context. A final async-race review then found and fixed late Report A responses
appearing under Report B/global scope.

Final independent review reported zero Critical and zero Important findings.
Two non-blocking observations remain recorded for Task 15: add one complete
successful API route integration fixture from scope through render, and expand
some compound claim artifact refs so every displayed subfield has an inline
field-path ref rather than relying on the contract's minimum one-ref rule.

## Verification

- Focused finalized Chat, route, UI, Task 8 regression, and public-demo Chat
  group: 71 passed, 0 failed.
- Independent final review group: 51 passed, 0 failed.
- `npm run typecheck`: passed.
- `npm run lint`: passed with zero errors and nine pre-existing warnings in
  underwriting repository/orchestrator lease destructuring.
- `npm run build`: passed.
- `git diff --check`: passed.

No source was sent, published, translated, or treated as production data. No
production migration, seed, deployment, credential, provider call, or
production authorization was used.
