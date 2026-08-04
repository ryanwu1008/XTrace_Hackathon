# VSee — VC Decision Intelligence

VSee is a source-grounded venture-underwriting Web App that connects confirmed
private Deal sources, recent public-market evidence, and previously reviewed
venture decisions. XTrace supplies long-term Deal-memory recall; Anthropic
performs bounded evidence analysis; deterministic policy and valuation code
retains formal decision authority.

The runtime has two explicit modes:

- `public_demo` is anonymous, synthetic, and read-only. It never exposes
  private sources or accepts mutations.
- `product` requires an OpenAI Sites-authenticated user and exactly one
  server-resolved workspace membership. Browser workspace selectors are never
  authorization input.

The product does not claim that a matched company has improved. It gives the
investor a cited, replayable reason to perform a second look.

## Product flow

1. Upload and explicitly confirm a source into an exact
   `(workspace, document, source revision, Deal)` lineage.
2. Extract source-backed Deal facts and persist the canonical evidence needed
   by the Evidence Pack. Missing structured facts remain explicitly
   unavailable.
3. Ingest the confirmed Deal revision into XTrace without treating recalled
   text as citation authority.
4. Manually queue a scan of public information published in the latest 14
   days.
5. The background Worker normalizes public evidence, recalls historical
   context, and persists one Belief Change Analysis for every Deal in the
   run-bound eligible universe.
6. Every analysis admitted as `belief_revised` enters Deep Underwriting.
   Deterministic score and stable Deal identity set queue priority only; rank
   and processing capacity never truncate admission. Each candidate runs
   through eight core checks plus up to twenty
   approved advisory frameworks. Each framework retains its own citations,
   judgment, and disagreements; advisory formal decision weight stays zero.
7. Persist a report, report-underwriting detail, and latest-only action drafts.
   Editing a draft replaces only its current body on the same immutable draft
   identity; no version history, send, publish, Email, SMS, or LinkedIn side
   effect exists.
8. Use Search and Chat to query only data already persisted in VSee. Neither
   browses, recalculates underwriting, creates actions, or mutates Deal state.

## Runtime architecture

- Web: Next.js-compatible App Router built with vinext
- Persistence: Supabase PostgreSQL REST API
- Private source files: private Supabase Storage bucket
- Background work: durable PostgreSQL queue plus `npm run worker`
- Memory: XTrace Memory Manager
- Reasoning: Anthropic Messages API
- Underwriting: immutable Evidence Packs, deterministic policy/valuation, eight
  core framework checks, and an audited context-selected advisory catalog
- Market sources: Federal Register, FDA, SEC, FTC, TechCrunch venture,
  configured official/stable RSS feeds, and optional authorized Crunchbase API

Process-local memory and bundled PDFs are test/public-demo fixtures only. They
are not shared between Web and Worker and are never a product-mode persistence
fallback.

## Fixed MVP corpus

The repository contains exactly:

- 9 supplied pitch-deck files
- 4 supplied market reports
- 1 reference-only VC Brain document

The nine pitch-deck files produce 19 of the Deal records. Eight files map
one-to-one to Deals. `Pitch-combined-InterTwin-AI.pdf` remains one private
source object but maps its 11 pages to 11 page-scoped Deals: InterTwin.ai,
UniKudo, Mirror, CouPro, IndieShow, HuMetric, Alpha Builders, INNFormNest,
SilverMemory, Kanesh, and Fellowtrip. Every fact, memory bundle, match, and
source link from that PDF must retain the correct page number.

The source PDFs are real supplied artifacts. The internal investment-state
records are sample data and permanently display:

> Sample decision record

Never remove or obscure that label.

The Deals view may additionally show fabricated traction and deal-term
figures for a company. That block permanently displays the label
`Sample deal profile`, is presentation-only, and never enters memory
bundles, XTrace, recall queries, or matching input (a regression test
pins this).

The fixed corpus is the demo's initial private knowledge base. It does not
replace the live market scan: every product manual run still collects public
evidence published in the latest 14 days.

### Current 30-Deal acceptance contract

The current registry contains exactly 30 Companies, 30 Deals, and 30
analysis-eligible Deals. A completed current run binds that immutable universe
and persists exactly 30 CompanyAnalyses. The four outcome counts
(`belief_revised`, `monitor`, `no_material_change`, and
`analysis_unavailable`) are evidence-window-dependent and must sum to 30. The
versioned 2026-08-01 research package records `4 / 7 / 19 / 0`; the controlled
2026-08-03 cold live run retains the 14-day authority and therefore expects
`4 / 6 / 20 / 0`, because the Empirical Security item falls outside that live
window. Neither distribution is a hard-coded runtime outcome.

The current universe consists of the 19 pitch-deck Deals, the four reviewed
belief-reversal fixture Deals (Henry AI, Smallest.ai, Hush Security, and
Irregular), and the seven screening Deals below.

The seven added screening Deals are Centralize, ChipAgents, Sent, Cascade,
Cordant, Empirical Security, and Freight Hero. Their
`Sample research screening record` is typed prior context, not a meeting, VC
interaction, historical Pass, or gate-passing source by itself. A later run may
naturally upgrade one of these Deals when stronger new evidence satisfies the
same chronology, reconsideration, counterevidence, action-delta, confidence,
and exact-lineage requirements used for every other Deal. The versioned
2026-08-01 research package records all seven as `monitor`; in the controlled
2026-08-03 live run Empirical Security is `no_material_change` because its item
is outside the 14-day window, while the other six remain `monitor`. Those
outcomes come from evidence and gates, never names or screening disposition.

Every and only `belief_revised` analysis creates one immutable Deep
Underwriting queue entry. Queue priority controls execution and display order;
there is no rank or capacity admission cutoff. The historical 2026-08-01
pinned report remains an immutable 23-analysis artifact with its original
universe and fingerprints; current runs never mutate or use it as their
universe.

The first complete current-30 automated cold smoke passed on 2026-08-03
(`1/1`, `73.7s`) against disposable loopback PostgreSQL 17.6. It verified 30
CompanyAnalyses, the derived `4 / 6 / 20 / 0` outcomes, four Deep Underwriting
jobs, immutable replay of the legacy 23-analysis report, and zero remote
network attempts. The smoke-verified commit and deployment of that exact SHA
to the authorized private non-production Staging target are still pending at
this checkpoint. Production data, credentials, migrations, providers, and
deployment targets remain outside this workflow.

## Setup

Requirements:

- Node.js 22.13 or newer
- a Supabase project and private Storage bucket
- a server-side `XTRACE_API_KEY` and Anthropic credentials
- optional authorized Crunchbase credentials

Copy `.env.example` to a local ignored environment file and configure the
server-only values. Do not expose service keys through `NEXT_PUBLIC_*`.

For a new **local or disposable test** database, apply every physical migration
below in this exact order. For an existing local test database, begin with its
first missing migration and continue without gaps. This physical list is not a
production authorization list:

1. [`drizzle/0000_vsee_postgres.sql`](drizzle/0000_vsee_postgres.sql)
2. [`drizzle/0001_remove_report_delivery.sql`](drizzle/0001_remove_report_delivery.sql)
3. [`drizzle/0002_durable_decision_lineage.sql`](drizzle/0002_durable_decision_lineage.sql)
4. [`drizzle/0003_sanitize_report_next_steps.sql`](drizzle/0003_sanitize_report_next_steps.sql)
5. [`drizzle/0004_company_analyses.sql`](drizzle/0004_company_analyses.sql)
6. [`drizzle/0005_sample_decision_label.sql`](drizzle/0005_sample_decision_label.sql)
7. [`drizzle/0006_reasoner_judgments.sql`](drizzle/0006_reasoner_judgments.sql)
8. [`drizzle/0007_uploaded_documents.sql`](drizzle/0007_uploaded_documents.sql)
9. [`drizzle/0008_workspace_composite_identity.sql`](drizzle/0008_workspace_composite_identity.sql)
10. [`drizzle/0009_source_revision_deal_registry.sql`](drizzle/0009_source_revision_deal_registry.sql)
11. [`drizzle/0010_underwriting_references.sql`](drizzle/0010_underwriting_references.sql)
12. [`drizzle/0011_underwriting_runs.sql`](drizzle/0011_underwriting_runs.sql)
13. [`drizzle/0012_source_grounded_underwriting.sql`](drizzle/0012_source_grounded_underwriting.sql)
14. [`drizzle/0013_confirmed_upload_ingest.sql`](drizzle/0013_confirmed_upload_ingest.sql)
15. [`drizzle/0014_read_api_action_drafts.sql`](drizzle/0014_read_api_action_drafts.sql)
16. [`drizzle/0015_framework_catalog_checkpoint.sql`](drizzle/0015_framework_catalog_checkpoint.sql)
17. [`drizzle/0016_confirmed_upload_source_evidence_bridge.sql`](drizzle/0016_confirmed_upload_source_evidence_bridge.sql)
18. [`drizzle/0017_public_sandbox_test_generations.sql`](drizzle/0017_public_sandbox_test_generations.sql)
19. [`drizzle/0018_pgcrypto_registry_schema_usage.sql`](drizzle/0018_pgcrypto_registry_schema_usage.sql)
20. [`drizzle/0019_belief_reversal_evidence_context.sql`](drizzle/0019_belief_reversal_evidence_context.sql)
21. [`drizzle/0020_belief_reversal_demo_seed.sql`](drizzle/0020_belief_reversal_demo_seed.sql)
22. [`drizzle/0021_exact_xtrace_lineage.sql`](drizzle/0021_exact_xtrace_lineage.sql)
23. [`drizzle/0022_task9_finalization_authority.sql`](drizzle/0022_task9_finalization_authority.sql)
24. [`drizzle/0023_pg17_market_event_validator.sql`](drizzle/0023_pg17_market_event_validator.sql)
25. [`drizzle/0024_research_candidate_xtrace.sql`](drizzle/0024_research_candidate_xtrace.sql)

`0008` introduces workspace-composite identities, `0009` adds immutable source
revisions, `0010`–`0012` add versioned underwriting references and artifacts,
`0013` promotes confirmed uploads atomically, `0014` adds controlled
latest-only draft replacement, and `0015` separates framework-catalog
checkpoint replay. `0016` upgrades already-applied `0013` databases with the
confirmed-upload source-evidence bridge, conservative legacy text-evidence
backfill, byte-checksum preservation, immutable image evidence locators, and
least-privilege upload/source-table grants. Legacy image summaries are not
promoted as quotations. `0017` adds the durable public-sandbox generation
marker and controlled reset boundary. `0018` repairs only the internal pgcrypto
schema dependency used by canonical fingerprints. `0019` adds immutable
market-evidence snapshots, run evidence bindings, persisted belief assessments,
report evidence lineage, and immutable reasoner judgments. Its production
launcher remains fail-closed until the exact reviewed PostgreSQL 17.6 catalog
fingerprints are generated; do not alias them to `0018`. `0020`–`0024` are
also local-only and have no production launcher authorization. `0023`
adds the PostgreSQL 17 compatibility checkpoint for the shared-entity
MarketEvent and belief gates, exact reasoner-judgment fingerprints, and the
guarded finalizer path without rewriting `0019` or changing production
authority. `0024` adds immutable old-23/current-30 Deal-universe bindings,
persists the seven `qualified_not_selected` screening dispositions without
excluding them from analysis, reuses the existing Deal-bound XTrace v2 lineage
for 18 public and seven permanently labelled sample research parents, and
prevents rank or processing capacity from truncating current-run underwriting
admission. The
bundled corpus loader
retains only exact
column-level immutable INSERT grants and uses conflict-ignore writes; canonical
runtime-upload evidence remains writable only through controlled RPCs. Do not
start Web or Worker against a partial chain.

The reviewed production boundary remains `0018`. Migration `0019` and every
later migration require a separate catalog review and explicit authorization.
Do not run the forward launcher against production from this checkpoint. The
Task 13 production-profile gate runs only against disposable PostgreSQL 17.6
fixtures and must end with:

`SAFE_REFUSAL — production forward migration remains blocked`

The launcher reaches reviewed `0018`, exits nonzero at unreviewed `0019`, and
prints `Migration 0019 has no reviewed terminal catalog fingerprint; refusing
mutation.` This verified refusal is not a production pass, migration approval,
or deployment. See [`docs/demo-runbook.md`](docs/demo-runbook.md) for the
blocked maintenance status. Never bypass the refusal.

```bash
npm install
npm run db:seed
```

CI and release verification must run both `npm run test:migrations` and
`npm run test:migrations:production-pg176`. The first command executes the
general PostgreSQL migration suites serially. The second is the mandatory
production-profile gate: it must run against a disposable PostgreSQL 17.6
server and execute exactly three profiles with zero skips—the Supabase-shaped
superuser, non-superuser `CREATEROLE`, and repaired-ACL paths. Each enclosing
test passes only when the launcher itself exits nonzero at unreviewed `0019`,
leaves `0019`–`0024` absent, and preserves the reviewed `0018` boundary and
invariants. The general migration gate applies the complete local `0000`–`0024`
chain. Neither gate authorizes production `0019` or later.

### Product authentication

Public demo needs no identity provider. Product mode accepts Sites-injected
`oai-authenticated-user-email` (and optional encoded full-name metadata) only
when the server environment explicitly contains:

```bash
VSEE_DEPLOYMENT_MODE=product
VSEE_TRUSTED_AUTH_PROVIDER=openai_sites
```

The server trims and lowercases the email, validates it, and derives the
membership user ID as `openai_sites:<sha256(normalized-email)>`. Provision
exactly one `workspace_members` row for that ID. The hash is stable and
non-secret; it is not an authentication credential. A missing, malformed, or
ambiguous identity/membership is rejected. Query parameters, request bodies,
cookies, `x-workspace-id`, and other browser-provided workspace values are
ignored for authorization.

Start the Web App and worker as separate processes:

```bash
npm run dev
npm run worker
```

The worker and Web App must receive the same Supabase, XTrace, Anthropic, and
market-source environment variables.

### Deterministic judgment replay

Claude Opus 4.8 exposes no sampling controls, so identical evidence would
otherwise produce slightly different scores on every scan. The worker stores
each matching judgment in `reasoner_judgments`, keyed by a fingerprint of the
full evidence input (deal bundles, selected market events, recalled memory,
source catalog, prompt, and model). While the evidence window is unchanged,
repeated scans replay the stored judgment and produce identical reports; new
evidence changes the fingerprint and triggers a fresh judgment. Set
`REASONER_JUDGMENT_REFRESH=1` on the worker to bypass replay and overwrite the
stored judgment.

### Production worker container

The repository includes a vendor-neutral, single-process Worker image. It does
not contain credentials and does not require a platform-specific runtime.

Build and start it with an ignored environment file:

```bash
docker build -f Dockerfile.worker -t vsee-worker .
docker run --rm --name vsee-worker --env-file .env.worker vsee-worker
```

The minimum production variables are `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, and `ANTHROPIC_API_KEY`. XTrace-mode scans also
require `XTRACE_API_KEY`; current `mmk_` keys do not require
`XTRACE_ORG_ID`. Market-feed variables remain optional according to the
features being demonstrated. Set a unique `WORKER_ID` when running more than
one replica; otherwise the runtime derives one from the container hostname and
process ID.

The process writes a non-secret liveness marker only after its PostgreSQL
heartbeat succeeds. Docker checks that marker every 30 seconds:

```bash
docker inspect --format '{{json .State.Health}}' vsee-worker
docker exec vsee-worker npm run worker:health
```

`WORKER_HEALTH_FILE` and `WORKER_HEALTH_MAX_AGE_MS` may be overridden, but the
default 60-second freshness budget should remain longer than the 15-second
worker heartbeat.

### Worker runbook

1. For a local or disposable development database, apply migrations `0000`
   through `0024` in order, then seed the corpus before starting the Worker.
   For production, use only its separately reviewed deployed boundary; this
   checkpoint does not authorize `0019` or later.
2. Start the Worker and wait for the container health status to become
   `healthy`.
3. Confirm `/api/settings/health` reports both `postgres: true` and
   `worker: true`.
4. In product mode, confirm each source and its exact revision lineage before
   queuing the manual 14-day scan. Queue only after both health checks pass.
5. Inspect `docker logs vsee-worker` when health becomes stale. Check database
   connectivity and the `worker_heartbeats` table before restarting.
6. Restarting is safe for queued work: PostgreSQL leases allow stale running
   jobs to be reclaimed. Use a unique `WORKER_ID` for every simultaneous
   replica.

Scan creation fails closed: if the Web process cannot verify a fresh Worker
heartbeat, `POST /api/runs` returns retryable HTTP 503 and does not enqueue a
job. This prevents a Web-only deployment from accumulating stranded scans.

## Security model

The browser never receives the Supabase service-role key, XTrace key,
Anthropic key, or private object-storage credentials. All database tables use
row-level security with no browser-facing policies; only server-side code
using the Supabase service role may read or mutate them. Source files stay in
a private bucket and are opened through short-lived signed URLs.

In `public_demo`, anonymous reads are restricted to data explicitly safe for
the demo workspace, including bundled preloaded PDFs and persisted
synthetic/demo reports. Uploads, private source URLs, run creation, reset,
policy changes, and action draft edits are rejected. In `product`, every route
requires the trusted principal and the one membership selected by the server.
Role capabilities still apply, and POST endpoints retain server-side rate
limits. Public access to the Web App is never public access to PostgreSQL or
Storage.

Private source links are minted only after an authenticated permission check.
The short-lived bearer capability is scoped to the exact workspace, source
revision, object version, permission, and expiry; it is not reusable for a
different source. Provider diagnostics, private framework source content,
credentials, and hidden reasoning are not public DTO fields.

## Market-source configuration

`MARKET_USER_AGENT` should identify the application and include a monitored
contact address. Extra feeds are JSON arrays:

```json
[
  {
    "id": "example-vc",
    "name": "Example VC announcements",
    "url": "https://example.com/feed.xml",
    "publisher": "Example VC",
    "eventType": "funding",
    "confidence": "medium"
  }
]
```

Set this JSON in `MARKET_OFFICIAL_FEEDS_JSON` or
`MARKET_PUBLISHER_FEEDS_JSON`. Crunchbase is registered only when an authorized
`CRUNCHBASE_API_KEY` is present.

## Verification

```bash
npm test
npm run test:migrations
npm run test:migrations:production-pg176
npm run typecheck
npm run lint
npm run build
```

The opt-in live XTrace test runs only when its test flag and credentials are
present. Unit tests never make live provider requests.

## Deployment note

The Web App and long-running queue worker are separate deployable processes.
A product Web deployment may enqueue jobs only after it verifies a fresh
Worker heartbeat; the public-demo Web cannot enqueue at all. A continuously
running `npm run worker` process is required to claim and finish product jobs.
Both product processes share state through Supabase PostgreSQL.

Deploy Web and Worker from the same committed source version after applying the
same schema. They must use the same bundled underwriting seed/reference data
and audited `research/framework-authoring` corpus, `ANTHROPIC_MODEL`, provider
configuration, XTrace configuration, and source-version code. Keep
`.openai/hosting.json` bound to the existing Sites project
`appgprj_6a63b033ea0481918530ccddd4830672`; do not create a second Site.
The validated Web `public_demo` may be deployed through that existing Sites
project. Sites does not provide the long-running product Worker: product-mode
manual scans require a separate Worker deployment whose health is confirmed
before a run is queued.

Known non-blocking limitations and production gates remain tracked in
[`docs/technical-debt/2026-07-29-end-to-end-deferred-hardening.md`](docs/technical-debt/2026-07-29-end-to-end-deferred-hardening.md).
