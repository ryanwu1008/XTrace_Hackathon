# VSee public-sandbox operations runbook

The production Sites URL is a **public, no-login test sandbox** running
`VSEE_DEPLOYMENT_MODE=public_sandbox`. Do not upload confidential, personal,
customer, or production-sensitive data. Anyone with the URL can use the
sandbox workspace. `public_demo` remains the anonymous, synthetic, read-only
fallback mode; `product` remains a separately authenticated environment.

## Before the cutover

Use the exact reviewed commit for both the Sites build and the Worker. Keep the
Sites Web process and long-running Worker separate, but pointed at the same
Supabase workspace. Store credentials only in the deployer's macOS Keychain;
never paste a value into the shell, a runbook, chat, or a `.env` file.

To add or update the database connection, run this locally and enter the value
only at the Keychain prompt:

```bash
security add-generic-password -U -a "$USER" -s "vsee-supabase-db-url" -w
```

The Worker launcher obtains its other required values from Keychain services:
`vsee-supabase-url`, `vsee-supabase-service-role-key`,
`vsee-anthropic-api-key`, `vsee-xtrace-api-key`, and
`vsee-document-url-signing-secret`. `mmk_` XTrace keys do not require an
XTrace organization ID.

## Current migration decision

`SAFE_REFUSAL — production forward migration remains blocked`

The reviewed production terminal remains `0018`. Migration `0019` and the
local-only `0020`–`0026` chain have not received production catalog approval.
Task 13 reads no production credentials and runs no launcher against
production; its production-shaped launcher verification uses only disposable
PostgreSQL 17.6 fixtures.
Do not treat a green test command as approval to run `0019` or later against a
shared or production database.

## Required release migration gates

Before applying a reviewed commit to production, run both migration gates on
disposable databases:

```bash
npm run test:migrations
npm run test:migrations:production-pg176
```

The second command is mandatory and must connect to PostgreSQL `17.6` (server
version number `170006`). It executes exactly three production-shaped profiles:
Supabase superuser, non-superuser `CREATEROLE`, and repaired ACL. The command
must report three passing enclosing tests, zero failures, and zero skips. In
each profile the forward launcher itself must exit nonzero with the exact
unreviewed-`0019` refusal, while the test proves reviewed `0018` is complete,
`0019`–`0026` are absent, invariants are unchanged, and no transaction remains
open. It deliberately fails on another server version, a missing database, a
renamed/nonmatching test, or any run in which one of the three profiles does
not execute. This is a `SAFE_REFUSAL` gate, not a migration-success gate.

Use one disposable PostgreSQL cluster/container per migration job. These tests
exercise fixed cluster-global production role names and must not share a
cluster with another parallel job or a real environment.

## Production baseline maintenance window

The procedure below is **blocked at the forward-migration step** for this
checkpoint. It remains reference material for a future separately reviewed
maintenance approval; Task 13 did not perform these operations. Do not begin a
new production cutover while `0019` lacks a reviewed terminal fingerprint.

The production project may still have the early upload-extraction prototype
instead of the final `0007` table contract. Treat its baseline upgrade as an
exclusive maintenance operation. Do not run either migration launcher while a
Web request or Worker process can write to PostgreSQL.

1. Stop the Worker and the Web writers. Stop the foreground/container Worker,
   and disable the production Web deployment or route it to a read-only
   maintenance response. Confirm that a browser can no longer enqueue scans,
   upload files, confirm sources, reset the sandbox, change policy, or edit
   drafts.
2. Prove there are no active scan or upload leases. Run these read-only checks
   in the Supabase SQL editor. Both result sets must contain zero rows:

   ```sql
   select id, status, worker_id, lease_expires_at
   from public.scan_runs
   where status in ('queued', 'running')
      or lease_expires_at is not null;

   select id, status, worker_id, lease_expires_at
   from public.uploaded_documents
   where status in ('extracting', 'ingesting_memory')
      or lease_expires_at is not null;
   ```

   If either query returns a row, abort the maintenance attempt. Do not clear a
   lease or change a status by hand. Restore the matching reviewed application
   version, let its Worker finish or reclaim the work, then begin a new
   maintenance window and repeat both checks.
3. Create a restorable database snapshot after the quiet-state checks. Use the
   Supabase-managed backup/snapshot facility (or an independently verified
   PostgreSQL backup), record its identifier and timestamp, and confirm that
   the operator has permission to restore it. Do not proceed with an
   unverified or still-running backup.
4. With Web and Worker traffic still stopped, run the guarded baseline
   bootstrap from the exact reviewed commit:

   ```bash
   ./scripts/bootstrap-production-baseline.zsh
   ```

   The bootstrap never prints the database URL. Before changing anything it
   classifies the complete pre-`0008` boundary, `0008`, `0009`, and all later
   migration sentinels. It accepts only:

   - a complete current `0007` boundary; or
   - the exact known prototype `uploaded_documents` shape when no row has an
     active extraction lease/state and no row contains legacy extracted facts,
     memory IDs/text, company identity, Deal identity, or XTrace job identity.

   For that one safe prototype shape it adds the current extraction-preview
   contract while retaining every legacy column and row, then applies and
   verifies `0008` and `0009`. It refuses unknown, partial, unsafe, or gapped
   states. Do not bypass that refusal or apply the compatibility SQL manually.
5. **Stop.** The forward launcher is not authorized for a production run from
   this checkpoint. Do not run `./scripts/apply-production-migrations.zsh` on
   production, do not apply `0019` manually, and do not add or alias a catalog
   fingerprint. A future review must explicitly authorize the new terminal.
6. On disposable PostgreSQL 17.6 only, the expected forward result is a
   nonzero exit after reviewed `0018` with `Migration 0019 has no reviewed
   terminal catalog fingerprint; refusing mutation.` Verify `0019`, `0020`,
   `0021`, `0022`, `0023`, `0024`, `0025`, and `0026` remain absent. Never
   describe that outcome as production migrations passed, green, deployed, or
   authorized.
7. Resume the Web and the Worker only with the already-reviewed
   application/schema combination. A release that depends on `0019` or later
   remains blocked until the separate migration review is approved.

## Current company-mainline acceptance and release status

A completed current run must bind exactly 30 Companies, 30 Deals, and 30
analysis-eligible Deals, then persist exactly 30 CompanyAnalyses. The four
outcome counts must sum to 30 and are derived from the run's evidence window.
The versioned 2026-08-01 research package records `4 / 7 / 19 / 0`. For the
controlled 2026-08-03 cold live run, the retained 14-day authority yields
`4 / 6 / 20 / 0` because the Empirical Security item is outside the window.
Do not turn either distribution into a runtime shortcut.

Every and only `belief_revised` analysis must create one Deep Underwriting
queue entry. Deterministic score and stable Deal identity control priority
order only; rank and capacity do not remove an otherwise admitted candidate.
Every admitted candidate must reach an explicit completed, partial, or failed
terminal state.

Centralize, ChipAgents, Sent, Cascade, Cordant, Empirical Security, and Freight
Hero remain `screening` Deals labelled `Sample research screening record`.
Their screening records are typed prior context, not meetings, VC interactions,
historical Passes, or evidence that passes belief-change gates by itself.
Stronger evidence in a later run may naturally satisfy the normal gates and
upgrade a Deal without a name- or disposition-specific shortcut. The versioned
2026-08-01 research package records all seven as `monitor`. In the controlled
2026-08-03 14-day live run Empirical Security is `no_material_change` because
its evidence falls outside the window, while the other six remain `monitor`.

The historical 2026-08-01 pinned report remains bound to its immutable
23-analysis universe and original fingerprints. It is a legacy replay artifact,
not the current registry or current-run cardinality.

The first complete current-30 automated cold smoke passed on 2026-08-03
(`1/1`, `73.7s`) against disposable loopback PostgreSQL 17.6. It persisted 30
CompanyAnalyses with the derived `4 / 6 / 20 / 0` outcome distribution,
created exactly four Deep Underwriting jobs, replayed the immutable legacy
23-analysis report, and recorded zero remote network attempts. At this
checkpoint no smoke-verified commit has been created and no exact-SHA private
Preview/Staging handoff has occurred. The newly authorized private Staging
target must use only disposable/non-production data, credentials, providers,
database, and Worker resources; the configured public Sites target remains out
of scope.

Localization and bilingual implementation are paused until the company mainline
is complete and the final schema recheck has finished. This checkpoint does not
claim that either is complete or ready for release.

## Start the Worker

### Production-only operator procedure

This section is solely for an already authorized production/public-sandbox
operator procedure. It is not a current-30 cold-smoke or private-Staging
procedure. The current-30 cold smoke and any private Preview/Staging handoff
must not use the production XTrace endpoint, macOS Keychain credentials, or the
public Sites target. They must use test-only/non-production provider seams and
credentials, a disposable non-production database and Worker, and a separately
authorized non-production target.

Start one foreground Worker from the same reviewed commit:

```bash
./scripts/run-worker-from-keychain.zsh
```

It uses `public_sandbox`, the `workspace_demo` workspace, the production
XTrace API endpoint, and the configured public market feeds. It writes its
combined output only to `.runtime/worker.log`, which is ignored by Git. Stop
the foreground process before starting another Worker so workers do not contend
for the same queue.

## Health gate before Scan

Open the public Sites URL and confirm its health display shows all required
integrations ready: PostgreSQL, the Worker heartbeat, Anthropic, and XTrace
when the XTrace toggle is on. The **WAKE AGENT & SCAN MARKET** action must stay
disabled until that health gate passes. If the Worker is not healthy, inspect
`.runtime/worker.log`, correct the Keychain/configuration issue, restart the
single Worker, and wait for its heartbeat instead of bypassing the check.

## Public-sandbox test flow

1. Upload a non-confidential PDF or DOCX source.
2. Wait for Worker extraction, review the extracted evidence, and confirm the
   source-to-Deal assignment.
3. Enable XTrace when memory-backed recall is part of the test.
4. Run **WAKE AGENT & SCAN MARKET** after the health gate is green.
5. Review the generated report and its traceable evidence rather than treating
   the sandbox result as a customer investment decision.
6. Verify 30 Companies, 30 Deals, 30 eligible Deals, 30 analyses, and a total
   of 30 outcomes. For the controlled 2026-08-03 14-day cold live fixture, the
   expected evidence-derived outcome counts are `4 / 6 / 20 / 0`; other live
   anchor dates may derive a different distribution.
7. Verify that the Deep Underwriting Deal IDs equal the `belief_revised` Deal
   IDs exactly. Priority ordering may change execution order but not admission.
8. Verify the seven screening labels and confirm their prior records never
   claim a meeting, VC interaction, historical Pass, or automatic gate pass.
9. Replay the historical pinned report separately and confirm its immutable
   universe and fingerprints remain unchanged.

The report includes the market-scan result and company analyses; opening a
candidate exposes these named underwriting sections: **What happened?**,
**Changed assumptions**, **Which historical companies are affected?**, and
**Company underwriting**. The Company underwriting section identifies CORE
FRAMEWORK versus NAMED ADVISORY judgments, the advisory pack/version,
component cards, exact source lineage, supporting/counterevidence Evidence Pack
IDs, limitations, and independent disagreements. Named advisory viewpoints have
formal decision weight zero.

For the Hush Security invested-positive demo, keep the product action policy
unchanged: the canonical belief action is `evaluate_follow_on`. The research
action `validate_channel_economics` is represented by the exact saved
CompanyAnalysis unknown (“Akamai and Kyndryl channel bookings, margins, and
sell-through remain unavailable.”), its reviewed founder-safe label, and a
`diligence_request` draft. It is not a second canonical belief action.

## Reset test view

**RESET TEST VIEW** advances the sandbox generation marker. It clears the
current test view's scan-derived reports, analyses, runs, and observed market
events without deleting durable source material, confirmed uploads, XTrace
memory, or framework definitions. A browser refresh does not reset anything;
queued or running work is not a substitute for a clean reset, so wait for a
quiet Worker before starting a new test flow.

## Rollback

If the public-sandbox cutover fails, stop the Worker, restore the previously
saved Sites version, and change the Sites runtime mode back to
`VSEE_DEPLOYMENT_MODE=public_demo`. Verify the restored public site is the
anonymous synthetic read-only demo. **Do not roll back database migrations:**
only the separately reviewed production migrations through `0018` may be
assumed present. This checkpoint never applies `0019` or later to production.
