# Task 9 report: terminal partial underwriting and status-safe drafts

## Outcome

Implemented a truthful terminal underwriting path for source-grounded Deals
whose current evidence is incomplete. Irregular now reaches a completed,
persisted core-only artifact set from the real belief-reversal seed corpus:
Series A / Enterprise AI reviewed context mappings, unavailable geography, no
benchmark, unavailable valuation with 3x17 scenario inputs, framework
abstentions without provider execution, null formal decision and ceiling, low
confidence, and exactly one invested-negative internal action memo.

## Status-safe ActionDraft v2

- Added a strict backwards-compatible v1/v2 union. V2 binds permanent
  `status_safe` / `draft_only` metadata, authoritative Deal status, belief
  direction, full canonical action metadata, typed missing evidence, exact
  format/channel/audience compatibility, policies, identity, body, and
  timestamps.
- Generation re-derives and validates actions from the authoritative belief
  assessment. The exact matrix emits five formats for advance/reopen, three for
  evaluate-follow-on, and an internal memo only for all other outcomes,
  including invested-negative pause-follow-on plus portfolio-risk review.
- External bodies are neutral evidence requests only. Generation and
  validation share one format-specific canonical grammar built from the exact
  persisted missing-evidence labels. An edited external body cannot bypass
  safety by avoiding a denylist; any non-canonical body fails closed. Each
  format requires its exact permanent draft-only marker in the header position.
- Body-only PATCH preserves the V2 envelope. The database-backed repository
  preflights the exact persisted payload before invoking its controlled RPC, so
  an unsafe edit cannot mutate storage. Safe edits preserve all metadata;
  legacy bodies remain readable and editable as legacy-unclassified drafts.
- Public rendering now recognizes V2 internal memos and strips private advisory
  authoring markers while preserving public advisory text and partner-authored
  material outside the generated appendix.

## Semantic grounding and context

- Added one shared semantic projector for grounding and Evidence Pack builds.
  Top-level public claim prose never becomes a Fact; reviewed semantic facts
  preserve exact source values, the preferred-security assumption preserves
  its policy and confirmation requirement, and unavailable/unknown/conflicting
  fields create no Fact.
- Exact semantic sources must resolve to the active source/revision tuple.
  Cross-revision or foreign lineage fails closed. Narrow reviewed mappings are
  versioned for Henry AI, Smallest AI, Hush Security, and Irregular. Mapping
  interpretations are routed as `derived`; unchanged exact source values remain
  `source_explicit`.
- Persisted context supports `full | core_only` and
  `us | global | unavailable`. Unavailable geography stays unavailable, never
  defaults to US/global, selects no benchmark, and forces explicit framework
  abstention.
- Every core-only analysis is capped at Advance even when otherwise complete,
  with persisted reason `CORE_ONLY_ANALYSIS_CEILING`. Geography-unavailable
  core-only analysis alone produces the stricter unavailable valuation and null
  decision/ceiling terminal result.

## Finalization and identity

- Missing valuation no longer causes an early candidate return after trusted
  grounding. The pipeline continues through Evidence Pack, scenario model,
  unavailable valuation, framework results, decision, narrative, safe drafts,
  and atomic finalization.
- Current finalization requires only V2 drafts, the exact complete draft format
  set, deterministic typed missing-evidence coverage, and a snapshot that binds
  status, direction, full actions, all policy versions, analysis mode, context
  version, geography, benchmark compatibility, and the current router version.
  Empty or legacy-only current draft sets and forged snapshot fields are
  rejected.
- Current new writes and legacy persisted reads are separate modes. Legacy V1
  rows remain readable, but a caller cannot downgrade a new finalization to the
  legacy contract. Supabase preflight loads exactly one running candidate, its
  aligned batch, and the pinned Fund Policy before the controlled finalization
  RPC; invalid payloads cause zero finalization writes.
- Finalization now validates chronology/context date parity, scenario policy
  and item lineage, coverage and Core-only ceilings, unavailable terminal
  semantics, the exact eight-card formal framework catalog and evidence
  partitions, framework claim edges, valuation-to-Fact lineage, exact formula
  identities, authoritative formula input roles and values, deterministic
  calculation outputs, and valuation-to-calculation bindings.
- Candidate, version, and batch identities include the belief state, semantic
  policy/mapping versions, context/router state, and the authoritative Task 8
  evidence frame so stale artifacts cannot replay across a changed authority.

## PostgreSQL finalization authority

- Added local-only forward migration `0022_task9_finalization_authority`; it is
  journaled and included in disposable migration tests, but deliberately absent
  from both production launchers.
- The service-role finalization RPC now applies the same current-V2,
  status-safe, context, scenario, terminal, framework, valuation, and formula
  gates before mutation. It preserves the immutable rerun-alias fast path.
- Disposable PostgreSQL tests exercise legacy downgrade, stale router,
  non-canonical external drafts, date/policy/scenario lineage, Core-only
  decision and valuation overreach, framework overclaiming, and synchronized
  calculation/input/output tampering. Rejected payloads leave artifact and
  candidate state unchanged.

## Verification

- Fresh Task 9 safety, grounding, terminal-artifact, routing, formula,
  decision, public-read, and migration-static group: 197 tests; 185 passed,
  0 failed, and 12 explicit local-PostgreSQL opt-in skips.
- Fresh disposable PostgreSQL 17 authority run: 2 of 2 passed, including all
  pre-mutation negatives, the valid current-V2 path, source-backed partial
  valuation, and immutable rerun reuse.
- The seeded Irregular end-to-end integration reaches one finalized truthful
  Core-only terminal artifact set without network or provider execution.
- `npm run typecheck`: passed.
- `npm run lint`: passed with zero errors (nine pre-existing unused-variable
  warnings in underwriting run/runtime lease destructuring).
- `git diff --check`: passed.

No sending, recipient persistence, publishing, provider execution, production
migration execution, deployment, localization, generic numeric prose
extraction, or production authorization was performed.
