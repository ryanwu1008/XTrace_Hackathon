# Belief-reversal company mainline — Task 5 restart checkpoint

> Operational recovery record only. This file does not replace product
> authority. The authoritative requirements remain
> `2026-08-01-belief-reversal-demo-company-research-handoff.md` and
> `2026-08-01-belief-reversal-demo-company-integration.md`, as amended by the
> product owner's 2026-08-02 instruction to prioritize a working normal
> vertical slice and defer exhaustive edge-case hardening.

## Repository checkpoint

- Repository/worktree:
  `/Users/wuyuhan/Documents/Codex/2026-07-21/referenced-chatgpt-conversation-this-is-untrusted/XTrace_Hackathon/.worktrees/backend-integration-checkpoint`
- Branch: `feat/backend-integration-checkpoint`
- Restart HEAD before this handoff commit:
  `5be51538abb7271de8e55f8559baaa521d3a2933`
- Task 5 commits:
  - `8da2d03b00e4318642a38a250182093b077780bb` — initial durable evidence context;
  - `79442a420285dedddf1a79becc17f9b1d96e8319` — normal persistence and fail-closed repair;
  - `5be51538abb7271de8e55f8559baaa521d3a2933` — delayed-claim live-window fix.
- The branch was 20 commits ahead of its tracking ref immediately before this
  handoff. Nothing was pushed as part of Task 5.

## Task 5 functional result

The normal current-live path is complete for the functional checkpoint:

1. PostgreSQL fixes the run's 14-day evidence context and active-run identity.
2. A delayed Worker uses persisted `anchorAt` for provider/publication
   windowing and records actual observation time separately as `retrievedAt`.
3. The Worker classifies and selects canonical MarketEvent v2 payloads, seals
   the exact set (including an explicit empty set), reloads it, and verifies
   mode, context fingerprint, count, order, and complete payload equality.
4. The binding fingerprint is passed into report persistence.
5. Every report read resolves its run authority. An all-null report is legacy
   only when its linked run is genuinely all-null legacy.
6. A current run cannot use the legacy report path; the renamed legacy RPC is
   not executable by `service_role`.
7. The SQL finalizer follows `beliefGateContext.triggerEvent.id`.

Fast functional review initially found the delayed-claim anchor drift above.
It was fixed in `5be5153`; focused re-review reported no remaining stop-ship
findings and returned `Ready for functional checkpoint: Yes`.

## Verification saved at the checkpoint

- Worker/repository/runs focused suite: 85/85 passed.
- Delayed-claim process-run suite: 10/10 passed.
- Market service suite: 42/42 passed.
- Reviewer-focused delayed/live-binding cases: 4/4 passed.
- Fresh disposable PostgreSQL 17.10, migrations `0000`–`0019`, semantic smoke:
  7/7 passed.
- Typecheck: exit 0.
- Build: exit 0.
- `git diff --check`: exit 0.
- Fast functional re-review: approved, no normal-path stop-ship finding.

No production endpoint/database, persistent local application database,
XTrace service, external model, seed registry, or localization behavior was
read from or modified. Production stage `0019` remains fail closed.

## Deliberately deferred hardening

Do not describe these items as complete:

- exhaustive PostgreSQL mutation matrices for every hard gate, status ×
  direction × action combination, Top-5 tie/cap case, and finalizer spoof or
  TOCTOU variation;
- two fresh official PostgreSQL 17.6 Supabase-shaped profiles and new reviewed
  manifest hashes;
- true Supabase and reviewed bridged-prototype execution evidence;
- production `0019` allowlist approval and exhaustive migration-script wiring;
- pinned Worker replay runtime;
- localization, which remains paused until the company mainline is complete.

These are a hardening backlog, not authorization to weaken the typed product
contracts or to modify production before review.

## Research and Task 6 inputs already approved

- Selected companies/status scenarios:
  - Henry AI — `passed` positive — reopen diligence;
  - Smallest.ai — `watchlist` positive — advance diligence;
  - Hush Security — `invested` positive — evaluate follow-on;
  - Irregular — `invested` negative — ordered actions
    `[pause_follow_on, portfolio_risk_review]`.
- Seven `qualified_not_selected` ledger-only companies: Centralize,
  ChipAgents, Sent, Cascade, Cordant, Empirical Security, and Freight Hero.
- Planned Task 6 corpus: 37 public sources plus four permanently labeled
  synthetic `Sample decision record` parents.
- Expected Task 6 post-seed totals (must be re-audited against the landed Task
  5 schema before implementation): 23 Deals, 55 revisions, and 60 active
  assignments.
- Likely contiguous migration: `0020`, adding source-document roles for
  `public_web_snapshot` / `sample_decision_record`, interaction/action policy
  version fields, `prior_actions`, and an immutable Sample write path.

## Resume order

1. Verify branch and handoff commit, then confirm `git status --short` and
   `git stash list` are empty.
2. Re-audit the approved Task 6 brief against the final Task 5 schema and
   implement the non-production canonical registry/seed path first.
3. Continue Tasks 7–15 with a working end-to-end vertical slice as the primary
   priority; defer non-blocking edge cases into the hardening ledger.
4. Before Task 7 submission recovery behavior is implemented, resolve the
   remaining product choice: if an XTrace POST may have succeeded but the
   process crashed before storing the job ID, the current recommendation is
   `submission_unknown`, no automatic resend, and manual reconciliation.
5. Before Task 8, resolve the evidence-context UX choices recorded in the
   integration plan (pinned replay control, report-scoped versus global Chat,
   and live-only versus snapshot Market views).
6. Do not begin localization requirements/implementation until the company
   mainline is complete, per the product owner's instruction.

Ten numbered company-mainline tasks remain after this checkpoint: Tasks 6–15.

## Ignored SDD artifact integrity

The `.superpowers/sdd` directory is intentionally ignored and therefore is
not protected by Git. It remained on disk at restart preparation time. The
tracked content above contains the recovery-critical state; these SHA-256
values allow the detailed ignored artifacts to be checked after restart:

```text
c9e79ff29c001a83e27a8fd722470efdda46426f228fcf5ce1c5376b5f68bee2  progress.md
9be7608a361843a6b768c85c5aed90f5d6356d1ec1fa880160fb229ee1726f47  ledger.md
f57b8753e00d7b369451a01c6dc70539654a445dca07b71927872a6bf9364aa5  task-5-brief.md
91fdcc07a95427c2d9c02e785382e5b8643bb03f9f1e6e4e412c9108f747d079  task-5-report.md
bcd8eba2cd5a8395280e0c09eaf0cfeea918317d0d21862085df11ec948dbd5a  task-5-functional-review.md
9dae961c313029df905d32ce3988890e28a16b012dd6ac6210428025dc9ada30  task-6-brief.md
082f81485f469812b3765e81190992af6c49f9e7632121b11c8a8bcc133a0ac7  task-7-brief.md
```

At restart preparation time, the tracked worktree and stash were empty. No
Task 5 Docker container/volume matched the project names, and the two remaining
`/private/tmp/vsee-task5-*` directories (a stale non-responsive PostgreSQL
socket/lock and typecheck scratch directory) were explicitly removed.
