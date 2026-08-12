# VSee private-Staging and future production operations runbook

## Current environment boundary

The current deployed application is an **owner-only private Staging** target,
not production and not a public no-login sandbox:

- Sites project: `appgprj_6a714b15f3488191998e357436151354`.
- Live Sites version: `6`, built from executable source commit
  `db83351a165f707c8b7435b34af31d443047bd20`.
- URL:
  `https://vsee-xtrace-staging-20260803-3b6c348.dream86625.chatgpt.site`.
- Access: custom owner-only access; no external viewers or groups.
- Data plane: isolated Staging Supabase project `gvkhitbljkrnzjzxtyua` on
  PostgreSQL 17.6, with 30 Companies, 30 Deals, and 30 analysis-eligible Deals.
- XTrace app namespace:
  `xtrace-vc-deal-intelligence-staging-gvkhitbljkrnzjzxtyua-v3`, with 85
  succeeded ingest intents covering all 30 Deals and 165 memory links. `v3`
  identifies the app-namespace generation; the serialized parent contract
  remains `xtrace-parent-v2`.
- Worker: the verified local foreground Worker is stopped while the valid
  staging-only Anthropic key is absent. It must restart from the exact
  version-6 source before a real-provider Scan. It is not a durable hosted
  Worker.

The application runtime uses `VSEE_DEPLOYMENT_MODE=public_sandbox`, but the
hosting access boundary remains private and owner-only. Do not describe this
target as production. Do not upload confidential, personal, customer, or
production-sensitive data.

The Anthropic credential currently configured in the Staging runtime has
returned HTTP 401 `authentication_error`. Presence in runtime configuration is
not proof that a provider credential is valid. Replace it only through the
Staging-specific Keychain service `vsee-staging-anthropic-api-key`, then restart
the foreground Worker before attempting the real-provider acceptance flow
below. That Keychain item is not yet present at this checkpoint. Never
substitute a generic or production credential.

## Future production cutover prerequisites

The procedure in this section is production-only reference material and is not
authorization to cut over. Use the exact reviewed commit for both the Sites
build and the Worker. Keep the Sites Web process and long-running Worker
separate, but pointed at the same authorized Supabase workspace. Store
credentials only in the deployer's macOS Keychain; never paste a value into the
shell, a runbook, chat, or a `.env` file.

To add or update the database connection, run this locally and enter the value
only at the Keychain prompt:

```bash
security add-generic-password -U -a "$USER" -s "vsee-supabase-db-url" -w
```

The production Worker launcher obtains its other required values from Keychain
services: `vsee-supabase-url`, `vsee-supabase-service-role-key`,
`vsee-anthropic-api-key`, `vsee-xtrace-api-key`, and
`vsee-document-url-signing-secret`. `mmk_` XTrace keys do not require an
XTrace organization ID. These unprefixed services and
`scripts/run-worker-from-keychain.zsh` are production-only and must never be
used to start private Staging.

## Current migration decision

`SAFE_REFUSAL — production forward migration remains blocked`

The reviewed production terminal remains `0018`. Migration `0019` and the
isolated-environment `0020`–`0030` chain have not received production catalog
approval.
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
`0019`–`0030` are absent, invariants are unchanged, and no transaction remains
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
   `0021`, `0022`, `0023`, `0024`, `0025`, `0026`, `0027`, `0028`, `0029`, and
   `0030` remain absent. Never
   describe that outcome as production migrations passed, green, deployed, or
   authorized.
7. Resume the Web and the Worker only with the already-reviewed
   application/schema combination. A release that depends on `0019` or later
   remains blocked until the separate migration review is approved.

## Current company-mainline acceptance and release status

A completed run must bind exactly 30 Companies, 30 Deals, and 30
analysis-eligible Deals, then persist exactly 30 CompanyAnalyses. The four
outcome counts must sum to 30 and must be derived from that run's evidence,
reasoner judgments, and hard gates. No particular belief-revision count is a
Staging acceptance constant.

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

The distinct pinned-30 review package is
`belief_reversal_pinned_30_2026_08_10_v1`. It uses its own immutable 30-member
Deal universe, four-event evidence set, and run/report identities; it never
rewrites or expands the legacy 23-analysis artifact.

### Historical deterministic fixture checkpoint

On 2026-08-11, `npm run test:e2e:belief-reversal` passed against a fresh
disposable PostgreSQL 17.6 database at terminal migration
`0028_named_lens_authority_repair`. The final pinned run
`060e66e6-9254-45d5-954c-ebe0e2a4a61d` and current cold run
`fda8d8bd-f7fc-4680-9cbe-b13d57bccb15` each passed their exact 30-Deal /
30-analysis backend gates. The pinned fixture admitted and completed four Deep
Underwriting candidates in deterministic priority order: Irregular, Henry AI,
Hush Security, and Smallest.ai. Thirteen finalized Reports/Chat verifier
queries completed for the pinned fixture report.

That historical checkpoint used `deterministic-e2e-observer-v1`, a permanently identified
test stub rather than the production model provider. It proves the contracts,
persistence, and complete artifact path only. Browser acceptance subsequently
passed for both buttons, automatic terminal-report refresh, the decision-first
detail, Reports/Chat, exact source access, keyboard/mobile behavior, overflow,
and console cleanliness. The final full suite passed 1,946 tests with zero
failures; TypeScript, build, parser-boundary, 112 fresh PostgreSQL 17.6
migration tests, the separate 3-profile production safe-refusal gate, and
independent review also passed. These counts belong to the terminal-`0028`
fixture checkpoint and are not evidence that the real provider or the current
`0030` working tree passed the same flow.

### Current private-Staging infrastructure checkpoint

The private Sites version, isolated Staging database, 30/30/30 registry,
historical same-source Worker heartbeat, and XTrace v3 app-namespace ingest
described at the top of this runbook have been verified. That Worker is now
intentionally stopped until the staging-only Anthropic key passes validation.
The Staging schema also satisfies
the terminal-`0030_xtrace_recall_audit_authority` owner, empty-search-path,
extension-digest, and public-schema-ACL invariants. Because the Staging database
does not expose an application migration-journal table, describe this as an
invariant match, not as journal proof that every migration was applied.

The real Anthropic E2E has **not passed**. The existing Staging run
`cf52d17a-d4e0-47ae-b247-6569f954d79f` ended partial: matching failed, one
XTrace recall failed, all 30 CompanyAnalyses were `analysis_unavailable`, and
its report remained incomplete. Staging currently has zero persisted
`reasoner_judgments`. The executable application tree introduced at commit
`c7dd8248206de1fa8f15fd79a7f66f04c9cc6f5c` contains the fallback and safe
matching-failure telemetry and is included in deployed source `db83351`, but
no completed same-source Scan has yet proved real Claude matching, validator
repair, belief revisions, Deep Underwriting, Named Lens output, finalized
Report/Chat, or hosted browser behavior.

Production was not read or modified and remains reviewed only through `0018`.
The complete checkpoint record is
`docs/qa/2026-08-10-pinned-30-underwriting-acceptance.md`.

Localization and bilingual implementation are paused until the company mainline
is complete and the final schema recheck has finished. This checkpoint does not
claim that either is complete or ready for release.

## Start the Worker

### Private-Staging procedure

Private Staging must use only the `vsee-staging-*` Keychain services, the
isolated Staging Supabase project, the Staging XTrace app namespace, and the
same reviewed commit as the deployed Sites version. Never start it through
`scripts/run-worker-from-keychain.zsh`, which reads production-only unprefixed
services.

The Anthropic value must come from `vsee-staging-anthropic-api-key`. Before a
real Scan, verify provider authentication with a safe credential check that
does not log the key, prompt, raw response, or hidden reasoning. A configured
secret that returns 401 or 403 is not healthy. Stop the existing foreground
Worker before replacing the credential or starting another process, then wait
for the new same-commit heartbeat. The present local foreground Worker is
suitable for supervised testing only; it is not a persistent deployment.

### Production-only operator procedure

This section is solely for an already authorized production/public-sandbox
operator procedure. It is not a private-Staging procedure. Private Staging must
not use the production XTrace endpoint, unprefixed macOS Keychain credentials,
or a public production Sites target.

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

Open the private Staging Sites URL and confirm its health display shows the
isolated PostgreSQL data plane, the same-commit Worker heartbeat, and XTrace
ready when the XTrace toggle is on. Separately prove Anthropic authentication:
the current health display can prove that a secret is configured but cannot
prove that the credential is accepted by Anthropic. A 401/403 response fails
the gate even if the UI says the integration is present.

The **WAKE AGENT & SCAN MARKET** action must stay disabled until every gate
passes. If the Worker is not healthy, inspect `.runtime/worker.log`, correct the
Staging-specific Keychain/configuration issue, restart the single foreground
Worker, and wait for its heartbeat instead of bypassing the check.

## Private-Staging real-provider acceptance

The private Staging release is not accepted until one same-commit run proves
all of the following without production access:

1. The browser queues a pinned or current Scan through the normal one-click
   action and automatically follows the persisted run to its terminal report.
2. The run binds the immutable 30-Deal universe and attempts Deal-scoped XTrace
   recall for every eligible Deal without cross-workspace or cross-Deal recall.
3. Real matching produces persisted, schema-valid reasoner judgments; provider
   authentication, rate-limit, network, truncation, and schema-repair failures
   remain typed and save no prompt, raw response, key, or hidden reasoning.
4. Exactly 30 CompanyAnalyses are persisted, and the four outcome counts sum to
   30. Their distribution is derived; no fixture count is an expected real-run
   constant.
5. Every and only `belief_revised` CompanyAnalysis creates one immutable Deep
   Underwriting job. Priority affects execution order only.
6. Every admitted job reaches an explicit completed, partial, or failed
   terminal state, with no silent loss or rank cutoff.
7. Completed work renders the finalized Report and Chat projections, including
   exact public-source/XTrace lineage and honest unavailable states.
8. Hosted-browser acceptance covers both Scan actions, terminal refresh,
   report/detail navigation, exact-source access, keyboard/mobile layout,
   overflow, and console cleanliness.

The deterministic fixture checkpoint is useful regression evidence, but it
does not satisfy this real-provider list.

## Private-Staging demo flow

1. Upload a non-confidential PDF or DOCX source.
2. Wait for Worker extraction, review the extracted evidence, and confirm the
   source-to-Deal assignment.
3. Enable XTrace when memory-backed recall is part of the test.
4. Run **WAKE AGENT & SCAN MARKET** after the health gate is green.
5. Review the generated report and its traceable evidence rather than treating
   the sandbox result as a customer investment decision.
6. Verify 30 Companies, 30 Deals, 30 eligible Deals, 30 analyses, and a total
   of 30 outcomes. Do not require the historical fixture's outcome distribution
   from a real-provider run.
7. Verify that the Deep Underwriting Deal IDs equal the `belief_revised` Deal
   IDs exactly. Priority ordering may change execution order but not admission.
8. Verify the seven screening labels and confirm their prior records never
   claim a meeting, VC interaction, historical Pass, or automatic gate pass.
9. Run the current pinned Demo replay and verify that it uses snapshot
   `belief_reversal_pinned_30_2026_08_10_v1`, exactly 30 eligible Deals, and
   exactly 30 analyses. This is the current review package, not the legacy
   23-analysis artifact.
10. Verify the historical 23-analysis artifact separately through its legacy
    read/replay adapter and confirm its universe and fingerprints remain
    unchanged. Never recreate it by invoking the current pinned replay action.

The report includes the market-scan result and CompanyAnalyses. Opening an
underwritten candidate exposes these current sections, in order:

1. **Decision Request**
2. **What Changed**
3. **Company Position**
4. **Thesis Assessment**
5. **Financial and Valuation Status**
6. **Named Lens Readings**
7. **Recommendation and Next Steps**
8. **Appendix**

Named Lens Readings identify their advisory pack/version, exact source lineage,
supporting and counterevidence Evidence Pack IDs, limitations, and independent
disagreements. Named advisory viewpoints have formal decision weight zero.

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

### Private Staging

If private Staging fails, stop the local foreground Worker and restore only a
previously saved Sites version known to be compatible with the isolated Staging
schema. Never repoint Staging to production data, XTrace namespaces, or
credentials. Do not manually roll back Staging migration `0030` or mutate its
authority objects; restore a compatible application version or rebuild an
isolated Staging data plane through the reviewed migration path.

### Future production

If a separately authorized future production public-sandbox cutover fails,
stop its Worker, restore the previously saved Sites version, and change its
runtime mode back to `VSEE_DEPLOYMENT_MODE=public_demo`. Verify the restored
public site is the anonymous synthetic read-only demo. **Do not roll back
database migrations:** only the separately reviewed production migrations
through `0018` may currently be assumed present. This checkpoint never applies
`0019` through `0030` to production.
