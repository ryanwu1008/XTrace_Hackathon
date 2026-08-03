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

## Required release migration gates

Before applying a reviewed commit to production, run both migration gates on
disposable databases:

```bash
npm run test:migrations
npm run test:migrations:production-pg176
```

The second command is mandatory and must connect to PostgreSQL `17.6` (server
version number `170006`). It executes both complete guarded-launcher E2Es: the
Supabase-shaped superuser profile and the real non-superuser `CREATEROLE`
executor profile. The command must report exactly two passing tests, zero
failures, and zero skips. It deliberately fails on PostgreSQL 17.10, a missing
database, a renamed/nonmatching test, or any run in which one of the two E2Es
does not execute. The general `test:migrations` suite may also be run on
PostgreSQL 17.10 for compatibility coverage, but that does not replace the
17.6 production-profile gate.

Use one disposable PostgreSQL cluster/container per migration job. These tests
exercise fixed cluster-global production role names and must not share a
cluster with another parallel job or a real environment.

## Production baseline maintenance window

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
5. In the same no-traffic maintenance window, run the forward launcher:

   ```bash
   ./scripts/apply-production-migrations.zsh
   ```

   The forward launcher also never prints the database URL. It requires the
   complete `0009` boundary, inventories the `0010`–`0019` sentinels before
   changing anything, refuses any gap, applies only from the first missing
   migration in order, and re-verifies every sentinel. Resolve a failed
   sentinel or gap before retrying; do not skip a file or run a later migration
   manually.
6. Verify `0019` before restoring traffic. The forward launcher must report
   that every production sentinel through `0019` is complete. `0018` repairs
   only the internal pgcrypto schema dependency used by canonical fingerprints.
   Rerun it once
   after the first successful pass and require the same all-complete result
   with no migration applied. Repeat the two quiet-state SQL checks above; both
   must still return zero rows.
7. Resume the Web and the Worker only after all verification succeeds. Start
   one Worker first, wait for its fresh PostgreSQL heartbeat, restore the Web
   deployment/traffic, and then complete the health gate below. Retain the
   database snapshot until the post-cutover smoke test is complete.

## Start the Worker

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

The report includes the market-scan result and company analyses; opening a
candidate exposes these named underwriting sections: **What happened?**,
**Changed assumptions**, **Which historical companies are affected?**, and
**Company underwriting**. The Company underwriting section identifies CORE
FRAMEWORK versus NAMED ADVISORY judgments, the advisory pack/version,
component cards, exact source lineage, supporting/counterevidence Evidence Pack
IDs, limitations, and independent disagreements. Named advisory viewpoints have
formal decision weight zero.

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
the `0010`–`0019` forward migrations remain applied during a Sites rollback.
