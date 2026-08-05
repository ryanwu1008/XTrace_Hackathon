# VSee / XTrace VC Decision Intelligence — Complete Project Continuation Handoff

**Date:** 2026-08-05

**Repository:** `XTrace_Hackathon`

**Working branch:** `feat/backend-integration-checkpoint`

**Validated implementation baseline before this handoff:** `0e943e5a36a9221a3560b84cf9b37637451dad41`

**Primary continuation remote requested by the product owner:** `https://github.com/ryanwu1008/XTrace_Hackathon.git`

**Status:** Company research and 30-Deal local product mainline implemented and locally accepted; production cutover and bilingual localization are not complete.

## 0. How to use this handoff

This is the consolidated continuation map for a new Agent. It records the
current product intent, implemented architecture, acceptance evidence, release
boundary, and remaining work. It does not rewrite immutable historical
artifacts or silently supersede a later explicit product-owner decision.

Read these documents completely before changing behavior:

1. `docs/superpowers/specs/2026-08-05-vsee-xtrace-complete-project-continuation-handoff.md`
2. `docs/superpowers/specs/2026-08-01-belief-reversal-demo-company-research-handoff.md`
3. `docs/superpowers/specs/2026-08-03-underwrite-all-belief-revisions-product-decision-addendum.md`
4. `docs/superpowers/specs/2026-08-01-bilingual-localization-continuation-handoff.md`
5. `docs/superpowers/specs/2026-08-04-editorial-ic-memo-report-design.md`
6. `docs/superpowers/specs/2026-08-04-underwriting-reading-order-and-source-actions-design.md`
7. `docs/superpowers/specs/2026-08-04-underwriting-context-assumptions-and-ic-ask-design.md`
8. `docs/qa/2026-08-03-current-30-cold-e2e-acceptance.md`
9. `docs/demo-runbook.md`
10. `docs/technical-debt/2026-07-29-end-to-end-deferred-hardening.md`

Precedence is:

1. the product owner's most recent explicit decision;
2. the no-Top-5 product-decision addendum;
3. the approved 2026-08-04 report-presentation designs;
4. the original company-research and localization handoffs;
5. older plans and fixtures only where they do not conflict.

Important semantic override: every earlier requirement that used **Top 5** as
an underwriting gate is obsolete for new runs. A legacy Top-5 field may remain
readable only through the explicit historical adapter for the immutable pinned
artifact.

The commit that contains this file is the handoff checkpoint. Resolve its exact
SHA after checkout with `git rev-parse HEAD`; do not replace that fact with the
baseline SHA above.

## 1. Product mission and bigger picture

VSee is a source-grounded VC Decision Intelligence application. Its central
question is not “Which startup is best?” It is:

> What changed in the market, which prior Deal belief or action does that new
> evidence affect, and what should the fund investigate or do differently now?

The system connects four kinds of authority:

- confirmed private or sample Deal memory;
- current, publicly verifiable market evidence;
- exact Source Revision and XTrace lineage;
- deterministic decision, valuation, and action policy.

Anthropic performs bounded evidence analysis. XTrace recalls long-term Deal
memory. Neither provider owns the formal investment decision. Typed gates,
persisted evidence, deterministic calculations, and explicit unavailable
states retain formal authority.

The product must never claim that a match proves a company improved. It
provides a cited and replayable reason to look again. It must distinguish:

- public Fact;
- verbatim public quotation;
- normalized statement;
- synthetic sample prior context;
- analysis Assumption;
- model Inference;
- Unknown;
- Conflict;
- Calculation;
- named public-framework perspective;
- formal deterministic decision or typed unavailability.

Do not expose, imply, or claim to expose hidden model chain of thought. Display
bounded conclusions, cited support, counterarguments, limitations, confidence,
and disagreements instead.

## 2. Authoritative end-to-end flow

The current new-run flow is:

```text
All 30 analysis-eligible Deals
  → public Market Scan
  → exact XTrace Deal Recall
  → evidence-to-Deal Matching
  → exactly 30 CompanyAnalyses
  → every admitted belief_revised analysis
  → one immutable Deep Underwriting job per belief revision
  → persisted terminal underwriting artifacts
  → status-aware draft-only actions
  → Reports and finalized report-scoped Chat
```

The visible `WAKE AGENT & SCAN MARKET` action must queue the real persistent
run. It must not merely reveal a pre-generated current report. The Web process
queues the run; a separate long-running Worker claims and executes it. The
button must fail closed if PostgreSQL or a fresh Worker heartbeat is missing.

The historical pinned replay is a separate path. It must not make live market
calls or mix pinned and live evidence.

## 3. Runtime architecture

### 3.1 Web

- Next.js-compatible App Router application built with vinext.
- The main application surface is in `app/`.
- Route handlers in `app/api/` call server-side repositories and services.
- Cloudflare/Sites deployment output is generated under `dist/`.
- `.openai/hosting.json` binds the existing Sites project. Do not create a
  duplicate production project.

### 3.2 Persistence

- Authoritative structured state is Supabase PostgreSQL, accessed server-side.
- Private source objects are stored in a private Supabase Storage bucket.
- Browser storage is not an authority for Deals, analyses, reports, memory, or
  translations.
- PostgreSQL migrations are in `drizzle/0000...0026`.
- The current local 30-Deal path requires terminal migration
  `0026_geography_agnostic_advisory`.
- The reviewed production terminal remains `0018_pgcrypto_registry_schema_usage`.
  Production migrations `0019` through `0026` are not authorized.

### 3.3 Worker

- The durable queue and all run/job state live in PostgreSQL.
- `npm run worker` starts the long-running queue Worker.
- `Dockerfile.worker` provides a vendor-neutral single-process Worker image.
- Worker heartbeat is a release gate for scan creation.
- Web and Worker must use the same commit, schema, database, evidence corpus,
  Anthropic model/configuration, XTrace configuration, and framework catalog.
- Sites hosts the Web application only; it does not provide the long-running
  Worker.

### 3.4 XTrace

- XTrace is the recall layer, not the citation authority.
- Every analysis-consumed memory must remain Deal-bound and workspace-bound.
- Current lineage requires exact public/source parents and exact Source
  Revision lineage.
- Cross-Deal and cross-workspace recall must fail closed.
- A provider result without locally verifiable parent lineage cannot support a
  belief revision.

### 3.5 Reasoning and deterministic authority

- Anthropic Messages API performs bounded classification, matching, and
  framework synthesis.
- Reasoner judgments are persisted and fingerprinted for replay.
- Deterministic gates decide admission to `belief_revised`.
- Deterministic financial calculations consume only accepted Fact or explicit
  Assumption inputs.
- Missing inputs remain unavailable; they are never synthesized into Fact.

### 3.6 Market sources

Supported source classes include official regulators and stable public sources,
including Federal Register, FDA, SEC, FTC, TechCrunch venture coverage,
configured official/publisher feeds, and optional authorized Crunchbase API.

The research method is event-first:

1. find a verifiable market event;
2. establish dates, source role, entities, and causal impact;
3. identify which existing Deal belief or action it can genuinely change;
4. run the same typed gates for every Deal.

Do not preselect a company and reverse-engineer a convenient article. The
default live window remains 14 days. A pinned replay may use a fixed historical
window, but its status and dates must be explicit.

## 4. Deployment modes and authorization boundaries

### `public_demo`

- anonymous;
- synthetic;
- read-only;
- no durable product underwriting or action-draft mutation;
- no private source exposure.

### `public_sandbox`

- anonymous public test sandbox;
- writable only within the configured demo workspace;
- must display the warning not to upload confidential or real customer data;
- requires server-side Supabase, Worker, model, memory, and storage services;
- must keep all communications as drafts.

### `product`

- authenticated through the trusted Sites identity header;
- exactly one server-resolved workspace membership;
- browser workspace selectors are never authorization input;
- all reads and writes must remain workspace-scoped.

Never put Supabase service-role, XTrace, Anthropic, signed-source, Sites bypass,
or deployment credentials in browser bundles, Git remotes, commits, handoff
documents, chat responses, or logs.

## 5. The authoritative company and Deal universe

Every current completed run has exactly:

- 30 Companies;
- 30 Deals;
- 30 analysis-eligible Deals;
- 30 CompanyAnalyses, one per eligible Deal.

The universe is:

- 19 original pitch-deck Deals;
- 4 reviewed belief-reversal companies: Henry AI, Smallest.ai, Hush Security,
  and Irregular;
- 7 additional screening companies: Centralize, ChipAgents, Sent, Cascade,
  Cordant, Empirical Security, and Freight Hero.

### Four reviewed belief-reversal cases

The versioned 2026-08-01 research package contains four public-event cases
chosen by the event-first workflow:

| Company | Sample prior status | Direction | Typed action change | Trigger event |
|---|---|---|---|---|
| Henry AI | `passed` | positive | `deprioritize → reopen_diligence` | 2026-07-29 company announcement of a $16.5m Series A |
| Smallest.ai | `watchlist` | positive | `continue_monitoring → advance_diligence` | 2026-07-31 company announcement of a $13m Series A |
| Hush Security | `invested` | positive | `continue_monitoring → evaluate_follow_on` | 2026-07-28 company announcement of a $30m Series A |
| Irregular | `invested` | negative | `evaluate_follow_on → pause_follow_on + portfolio_risk_review` | 2026-07-30 Anthropic incident disclosure |

Their prior fund context is permanently synthetic and labeled `Sample decision
record`. The financing and incident assertions are public-source claims with
their own provenance; they are not proof of customer quality or investment
merit. Hush's unverified channel economics remain diligence Unknowns, not a
second canonical action. Irregular's responsibility allocation and remediation
durability remain unresolved; the risk action does not manufacture a complete
new valuation.

### Seven screening Deals

Each of the seven must remain:

- Deal status: `screening`;
- research disposition: `qualified_not_selected`;
- analysis eligible: `true`;
- in Deal-bound XTrace memory: `true`;
- selected for underwriting: derived only from a future `belief_revised`
  outcome, never from the research disposition;
- permanently labeled `Sample research screening record`;
- explicitly `meetingOccurred=false` and `vcInteraction=false`.

The record is non-interaction prior context. It may record why a company was
qualified, why it was not selected for deeper research at the time, missing
evidence, and reconsideration conditions. It is not a historical Pass,
watchlist decision, investment, VC meeting, Founder conversation, or gate-
passing public Fact.

Do not hard-code any of the seven out of scan, recall, analysis, or future
underwriting. Stronger evidence may naturally pass the normal admission gates.

### Original sample decision records

The fixed pitch-deck corpus uses synthetic internal investment-state records.
They must permanently display `Sample decision record`. They may not be
presented as real VC interactions. Presentation-only sample deal profiles must
never enter matching, memory, or decision inputs.

## 6. Source and provenance contracts

Every decision-relevant source record must preserve, where applicable:

- source identity and stable canonical URL;
- Source Revision identity and fingerprint;
- event date;
- publication date;
- retrieval date;
- entity keys;
- source class and source role;
- workspace and Deal binding;
- original source text as retrieved, without translation replacing it;
- verbatim excerpt;
- normalized statement;
- evidence class;
- exact XTrace parent/child lineage;
- run-level acceptance binding and bounded selection diagnostics where the
  current contract provides them.

The current source contract does not yet persist an explicit source-language
field or a per-source rejection record with a reason. Those must not be
invented in presentation. Explicit language metadata and translation lifecycle
belong to the still-unimplemented localization design.

`verbatimExcerpt` and `normalizedStatement` are separate. A normalized sentence
cannot satisfy verbatim-quotation validation. A source snapshot link is labeled
as an archived snapshot; it must not masquerade as the original public article.

Facts, assumptions, unknowns, conflicts, and framework opinions remain
separate. An archived JSON Source Revision is not the original publication.

## 7. CompanyAnalysis / Belief Change Analysis contract

Every completed current run persists exactly one CompanyAnalysis for every
eligible Deal. This is the lightweight, auditable belief-change check, not the
full multi-framework underwriting report.

Every analysis outcome is exactly one of:

- `belief_revised`;
- `monitor`;
- `no_material_change`;
- `analysis_unavailable`.

The four counts must sum exactly to the eligible Deal count.

The persisted analysis includes at least:

- workspace, run, report, Deal, and Company identity;
- prior Deal status;
- prior investment or screening memory;
- matched MarketEvent IDs;
- exact Source Revision and XTrace lineage;
- event relevance;
- Deal relevance;
- prior-context strength;
- evidence quality;
- final score;
- Match Confidence;
- chronology result;
- revisit-condition mapping result;
- counterevidence result;
- action-delta result;
- typed belief direction;
- typed proposed actions;
- outcome;
- explicit failure or non-change reason;
- evidence-context fingerprints.

### Admission to `belief_revised`

Admission requires all of the following:

- Match Confidence is Medium or High;
- score meets the configured threshold;
- chronology passes;
- revisit-condition mapping passes;
- counterevidence handling passes;
- action delta passes;
- exact Source Revision/XTrace lineage is complete;
- the proposed typed action materially differs from the prior action;
- no provider or system failure occurred.

The hard gates are typed, persisted, and fail closed. High score alone cannot
override a failed gate.

Match Confidence uses the persisted weighted score:

- event relevance: 35%;
- Deal relevance: 30%;
- prior-context strength: 20%;
- evidence quality: 15%.

The current thresholds are High at `>= 0.78`, Medium at `>= 0.50` and `< 0.78`,
and Low below `0.50`. This is confidence that the cited evidence supports the
claimed belief/action change. It is not a startup-success probability,
investment probability, or model accuracy percentage.

### Status × direction action policy

The deterministic action policy is:

| Prior Deal status | Positive | Mixed | Negative | No change | Analysis unavailable |
|---|---|---|---|---|---|
| `screening`, `watchlist`, `evaluating` | `advance_diligence` | `continue_monitoring` | `deprioritize` | `no_new_action` | `review_analysis_failure` |
| `passed` | `reopen_diligence` | `continue_monitoring` | `deprioritize` | `no_new_action` | `review_analysis_failure` |
| `invested` | `evaluate_follow_on` | `continue_monitoring` | `pause_follow_on` + `portfolio_risk_review` | `no_new_action` | `review_analysis_failure` |

The stored proposed action list must exactly match this policy for the prior
status and direction. Presentation cannot omit the second invested-negative
action. All current actions remain internal decisions or drafts; no action is
automatically executed.

### Other outcomes

- `monitor`: relevant risk or signal exists, but current evidence does not
  justify a changed action.
- `no_material_change`: the Deal was scanned and recalled, but no accepted
  evidence materially changes its belief or action.
- `analysis_unavailable`: provider, lineage, or system failure prevents a safe
  conclusion. It must not manufacture a neutral or positive conclusion.

For all three non-belief-revised outcomes, do not run deep scenario modeling,
valuation, framework execution, formal decision, or founder-facing draft
generation.

## 8. Deep Underwriting and queue semantics

There is no Top-5 product concept for new runs.

Every and only `belief_revised` analysis creates exactly one immutable Deep
Underwriting candidate/job. Therefore:

```text
beliefRevisedCount === underwritingCandidateCount
```

This identity must hold from zero through all thirty revisions.

`priorityRank` is allowed only for execution order, UI order, and notification
order. It never changes eligibility. There is no sixth-place rejection,
rank cutoff, capacity cutoff, `selectedForTop5`, or
`not_selected_due_to_rank` for new runs.

Resource control uses:

- persisted priority queue;
- bounded concurrency;
- immutable job identity;
- retryable jobs;
- idempotent stage replay;
- per-stage timeouts;
- persisted cost/token usage and provider-attempt telemetry.

Persisted latency telemetry remains a required operational enhancement; do not
claim it is complete merely because stages have bounded timeouts.
- persisted `completed`, `partial`, or `failed` terminal states with reasons.

Each admitted job produces, as evidence permits:

- Evidence Pack;
- facts, assumptions, unknowns, and conflicts;
- Bear/Base/Bull scenario inputs;
- deterministic calculations;
- valuation, or precise typed unavailability;
- Investor Framework Perspectives;
- strongest support and strongest counterargument;
- limitations and disagreements;
- decision ceiling;
- formal decision, or precise typed unavailability;
- status-aware draft-only actions;
- finalized Chat projection.

The durable stage order is:

```text
evidence_pack
  → context_router
  → valuation
  → framework_catalog
  → framework_lenses
  → decision
  → narrative_drafts
  → finalization
```

The complete Bear/Base/Bull contract covers revenue path, ARR path, growth,
gross margin, contribution margin, operating expenses, burn, cash, runway,
future financing, future dilution, exit timing, exit method, exit multiple,
success conditions, failure conditions, and probability. A field is populated
only from accepted Fact or explicit Assumption; otherwise it retains its typed
unavailability reason.

Retry and replay must reuse the same immutable candidate/job identity and must
not duplicate analyses, jobs, XTrace memory, action drafts, or artifacts.

## 9. Investor Framework Perspectives

The product's primary analytical panel is built from distilled public works of
named investors and operators. These are product syntheses, not endorsements,
private conversations, replicas of a person's reasoning, or hidden chain of
thought.

Rules:

- each applicable framework executes and persists independently;
- each judgment keeps its public source catalog and version;
- each retains support, counterevidence, confidence dimensions, limitations,
  abstention/unavailability, and disagreements;
- opposing conclusions are not averaged away;
- named advisory perspectives have formal decision weight zero;
- deterministic product policy retains the formal decision.

The main memo shows a concise Investor Framework Synthesis:

- Panel Conclusion;
- Areas of Agreement;
- Principal Disagreement;
- Strongest Counterargument;
- IC Implication;
- compact issue table covering market/category, competitive power,
  team/execution, downside/risk, valuation/returns, and other applicable IC
  questions.

Complete individual records remain in the Audit Appendix. Do not restore the
old wall of analyst cards in the main reading flow.

## 10. Deep Underwriting report presentation

The approved presentation is a continuous editorial Investment Committee memo,
not a dashboard-card collection.

New current-run reading order:

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

Decision-relevant citations may appear beside the claim they support. The
complete evidence ledger, Source Revision inventory, raw identities,
fingerprints, versions, complete framework records, and 3-by-17 scenario matrix
belong after the narrative decision in the final evidence/audit sections.

### Typography and layout

- centered single-column narrative measure;
- principal body copy 16–18px with generous line height;
- serif titles and section hierarchy;
- monospaced small type only for audit metadata;
- readable desktop and mobile layouts with no horizontal overflow;
- synthesized views and diligence decision-use text receive the majority of
  table width;
- responsive tables stack rather than shrink principal text.

The readability scale applies across the full website, not only the memo.

### Modeling Assumptions

Do not call the section `Changed Assumptions` unless a future typed delta
contract proves the assumption changed because of new evidence.

Scenario price multipliers are modeling inputs:

- Bear `0.75× (−25%)`;
- Base `1.00× (Base)`;
- Bull `1.25× (+25%)`.

They are not confidence scores, probabilities, or Facts. A preferred-equity
input is a placeholder requiring confirmation. Raw units and references remain
in the Audit Appendix.

### `Unavailable`

`Unavailable` is a safe typed state, not corrupted text. The main memo maps it
to precise reader-facing language:

- Not publicly disclosed;
- Not independently verified;
- Cannot be calculated from current evidence;
- Not applicable;
- Provider or lineage unavailable.

Do not repeat 51 unavailable scenario cells in the main memo. State once why a
model cannot be supported, show what is available, list what is required before
valuation, explain what each missing input would unlock, and show the resulting
decision ceiling. The exact persisted matrix remains auditable.

### IC approval request

The visible `IC APPROVAL REQUEST` is derived from the complete typed-action
list, not from the first action only. For an invested-negative case such as
Irregular, it must show both:

- pause follow-on investment activity;
- begin an internal portfolio-risk review.

Scope, priority, and visibility are metadata. Approval does not send, publish,
or automatically execute any action.

## 11. Action drafts and Chat

### Action drafts

Supported presentation channels include Founder Email, SMS, LinkedIn,
Internal Memo, and diligence request where status policy permits. Every output
is a draft only.

Never implement automatic send, publish, post, or external delivery as part of
this workflow. Draft editing replaces only the latest body for the same durable
draft identity. The UI orders drafts by purpose, summarizes missing evidence
once, keeps full bodies collapsed by default, preserves paragraphs when
opened, and keeps raw policy metadata in an audit disclosure.

### Finalized Chat

Chat is scoped to one finalized report and its persisted evidence. It may:

- answer from the report, CompanyAnalysis, Evidence Pack, Underwriting,
  decisions, actions, and exact citations;
- explain the belief change, prior memory, gates, counterevidence, and typed
  action delta;
- identify whether the report is pinned or live.

Chat may not browse, recalculate underwriting, create new facts, create or send
actions, change Deal state, mutate XTrace, or mix another report's evidence.

## 12. Pinned replay and legacy compatibility

The 2026-08-01 pinned report is an immutable historical artifact with exactly
23 analyses. It is not the current registry. It must remain replayable with its
original:

- Deal universe;
- evidence window;
- Source Revision lineage;
- XTrace lineage;
- report and underwriting identities;
- fingerprints;
- historical rank fields.

The legacy read adapter may display an old rank as historical priority order.
New runs never write or depend on Top-5 eligibility.

Pinned run mode persists an anchor date, snapshot identity, and fingerprint.
Pinned and live evidence cannot be mixed. Reports and Chat must visibly label
the evidence mode and readable window. Exact timestamps stay available in the
audit details.

## 13. What is implemented and accepted

The following company-mainline capabilities are implemented in the current
branch and have local acceptance evidence:

- 30 Companies, 30 Deals, and 30 eligible Deals;
- active Source Revision snapshots and run-bound eligible universe;
- event-first market-evidence collection path;
- exact Deal-bound XTrace lineage;
- all 30 Deals participating in recall and matching;
- exactly one CompanyAnalysis per Deal per completed current run;
- typed belief outcomes and hard gates;
- deterministic priority ordering without a Top-5 eligibility cutoff;
- one immutable Underwriting job for every belief revision;
- completed/partial/failed Underwriting terminal state persistence;
- Evidence Pack, scenario, calculation/unavailability, framework, decision,
  action-draft, Report, and Chat projections;
- immutable legacy 23-analysis pinned replay;
- narrative-first editorial IC memo;
- readable site-wide typography;
- Evidence and Source Register after the formal IC narrative;
- real canonical source action separated from archived snapshot action;
- collapsed draft bodies and audit metadata;
- readable live/pinned evidence windows;
- readable Modeling Assumptions;
- complete multi-action IC approval request;
- local browser `WAKE AGENT & SCAN MARKET` path backed by a real persistent
  queue and Worker, not a pre-generated current report.

The canonical cold 30-Deal acceptance is recorded in
`docs/qa/2026-08-03-current-30-cold-e2e-acceptance.md`.

## 14. Local acceptance evidence

### Cold pipeline

The first full cold E2E passed against disposable loopback PostgreSQL 17.6 and
PostgREST:

- exactly 30 CompanyAnalyses;
- outcome distribution `4 / 6 / 20 / 0` for that controlled window;
- exactly four immutable Underwriting jobs;
- replay idempotency;
- immutable legacy report preservation;
- zero remote network attempts;
- terminal local migration `0026`.

The accepted post-seed snapshot recorded 80 source documents, 80 source
revisions, 79 workspace documents, 85 active source assignments, 19 legacy
evidence units, 62 canonical evidence units, 23 permanently labeled sample
interactions, seven permanently labeled sample research documents, seven
research candidates, 25 research source assignments, and one explicit research
evidence gap. Treat these as observed acceptance counts, not hard-coded product
constants; the authoritative invariants are the 30/30/30/30 Deal-analysis
cardinalities and exact lineage.

Outcome distributions are evidence-window dependent and must not be hard-coded.
The versioned 2026-08-01 package records `4 / 7 / 19 / 0`; later local browser
runs recorded `4 / 4 / 22 / 0`. All are acceptable when derived from their
persisted evidence windows and when the four counts sum to 30.

### Browser path

Browser acceptance clicked the visible scan control, observed queued/running
state, waited for the Worker, opened the newly persisted live report, inspected
all 30 analyses and four Underwriting results, opened Irregular's full memo,
and queried Finalized Chat.

The local fixture command is:

```bash
npm run demo:belief-reversal:browser
```

It uses disposable data and strict port binding. The local URL is normally
`http://127.0.0.1:3100/` while the fixture process remains alive. The URL and
Report IDs are ephemeral and are not deployment artifacts.

### Presentation acceptance

Recorded acceptance includes:

- full current report created from the visible scan action;
- 30 analyses and outcome totals;
- all belief revisions in Underwriting;
- narrative-first memo reading order;
- complete framework persistence with compact main synthesis;
- scenario matrix moved to audit;
- no repeated unavailable-field wall in the main memo;
- safe source and archived-snapshot actions;
- Final IC Position before evidence/audit appendices;
- Modeling Assumptions rendered as multiples and deltas;
- invested-negative approval request containing both actions;
- no Send or Publish controls;
- zero desktop/mobile horizontal overflow in recorded checks.

## 15. Current source-control status and GitHub handoff

The branch began this final handoff at `0e943e5`. The configured canonical
`origin` remote points at `CoKayne/XTrace_Hackathon` and is intentionally
preserved. In the latest explicit instruction, the product owner requested that
this continuation also be pushed to:

```text
https://github.com/ryanwu1008/XTrace_Hackathon.git
```

Use a separate named remote rather than silently replacing or deleting the
original remote. Push the exact feature branch without force. Verify the remote
branch resolves to the local HEAD after push.

Two final verification-test corrections were prepared with this handoff:

- the process-run polling test fixes its run-authority clock so the static
  2026-07-22 event cannot drift outside the 14-day test window after midnight;
- the Finalized Chat pinned-banner test now expects the approved readable date
  range rather than the replaced legacy label.

These are test-authority corrections. They do not loosen the production
publication-window gate or change persisted application behavior.

## 16. Production and Staging release status

### Existing public Sites project

The existing public Sites project is configured in `.openai/hosting.json` at:

```text
https://vsee-vc-intelligence.dream86625.chatgpt.site
```

Its project ID is `appgprj_6a63b033ea0481918530ccddd4830672`; access is public.
A read-only deployment-metadata audit on 2026-08-05 observed Sites version 12
at source commit
`8eda74488a6c8a08d9922e229274c4c41fb26f81` in `public_sandbox` mode. It is not
the accepted 30-Deal branch.

Keep three separate concepts explicit: the public URL, the application
deployment mode (`public_sandbox`), and the external Supabase infrastructure.
A public sandbox is not authenticated customer production, but in the observed
configuration it still uses the shared production Supabase infrastructure and
therefore retains production-grade change-control requirements.

`public_sandbox` is anonymous and writable within its configured demo
workspace. While it points at the production Supabase project, an incompatible
release could expose upload, scan, draft-edit, and controlled reset operations
to any visitor with the URL. Treat a deployment as a data-plane release, not a
visual-only page replacement.

### Blocking incompatibility

Do not describe the complete current feature set as production-deployed yet.
Two blockers remain:

1. The production Supabase schema is reviewed only through `0018`, while the
   current 30-Deal runtime requires `0019` through `0026`.
2. Sites hosts only the Web application; no approved long-running production
   Worker host is configured for the current commit.

Deploying only the new Web code would not migrate the external Supabase
database. It could expose current controls against missing tables, columns, or
RPCs and therefore degrade the public sandbox. It would also leave scan jobs
without an equivalent committed Worker. That is not an acceptable “complete
functionality” release.

### Production data prohibition

Until the product owner separately chooses and authorizes a production data
cutover:

- do not read or mutate production Deal/customer data for acceptance;
- do not run `db:seed` against production;
- do not run the belief-reversal seed against production;
- do not run `0019` or later against production;
- do not bypass the migration launcher's safe refusal;
- do not point a disposable local Worker at production;
- do not claim a green disposable migration refusal is production approval.

### Shortest safe release choices

Recommended path:

1. Provision an isolated non-production Supabase/PostgREST/Storage environment.
2. Apply the complete local chain `0000` through `0026` there.
3. Seed only the approved synthetic/sample data there.
4. Deploy the Web from the exact verified commit.
5. Deploy a long-running Worker from the same exact commit and configuration.
6. Verify health, then click the real scan action and complete the 30-Deal
   browser smoke.
7. Only after that result, decide whether the public URL should point at this
   sandbox or whether a separate production migration review is required.

Alternative production path:

1. complete catalog and security review for `0019`–`0026`;
2. obtain explicit production migration authorization;
3. schedule a quiet maintenance window and verified restorable backup;
4. deploy identical Web and Worker commits;
5. perform the complete public-sandbox smoke without confidential data.

Do not use code-only publication as a substitute for either path unless the
product owner explicitly accepts that the new data workflow may be unavailable.

If a future owner explicitly authorizes code-only publication despite that
limitation, the minimum auditable Sites sequence is: verify one exact SHA, push
that same SHA to GitHub and the Sites source repository, build, package, save
one Sites version, deploy it with the public-site deployment operation, poll to
a terminal status, and perform a read-only smoke. Do not seed or migrate during
that sequence. Roll back to version 12 / `8eda744...` on failure and, if needed,
restore `public_demo` read-only mode before exposing the site again.

### Previous private Staging attempt

A private Sites target was created earlier, but the provider's empty source
repository returned HTTP 500 during initial branch creation. No safe external
Staging URL or version was produced, and its project identity was not
persisted. There is currently no configured external Staging database,
Storage, Worker, or deployable Sites target. Files under `.runtime` with
staging-like names are disposable local browser-fixture configuration, not an
external environment. Production was correctly not used as a fallback.

## 17. Bilingual localization status

Localization is still in product-requirement confirmation. It has not been
implemented. There is no complete locale switch, translation cache, Chinese
report API, or Chinese Chat presentation in the current product. Do not claim
otherwise.

Already approved:

- English is default;
- UI toggle will be `EN | 中文`;
- Chinese locale is Traditional Chinese `zh-TW`;
- static UI uses typed English/Traditional-Chinese dictionaries;
- English remains the sole canonical analysis chain;
- Chinese is a presentation derivative;
- original sources retain their original language;
- Chinese cannot change IDs, numbers, dates, citations, calculations,
  confidence, valuation, framework disagreement, or formal decisions;
- dynamic artifacts translate on first request and cache;
- English content change invalidates stale Chinese cache;
- translation failure falls back to English with Retry;
- source quotations display original plus translation;
- Chat accepts either input language, answers in the UI language, and uses the
  same canonical evidence;
- Founder outreach drafts have an independent language selection;
- translations never create Fact, MarketEvent, Decision, or XTrace memory.

Still unconfirmed and must be handled in sequence:

1. present the complete Section 14 loading/security/usability proposal as one
   approval block;
2. after approval, present the Section 15 acceptance/test matrix;
3. after approval, present the Section 16 final scope/non-goals;
4. then ask one product-changing Section 17 question at a time, with a
   recommendation and trade-offs;
5. write a complete localization design;
6. obtain final design approval;
7. only then write the implementation plan and implement.

Section 17 includes Founder-draft default language, internal memo/diligence
request locale, historical Chat translation, preference storage and precedence,
excerpt versus full-source translation, Worker/synchronous/hybrid execution,
timeouts/retries/size/cost, stale cache retention, locale formatting, canonical
identity for the client-side Report Draft, and public-demo cache writes.

Before localization implementation, re-audit the final schemas for Reports,
Evidence Pack, Chat, Action Drafts, sources, and Underwriting. Translation must
not manufacture a report field that the company mainline does not persist.

## 18. Known limitations and deferred hardening

Do not call these complete merely because the main demo passes. The detailed
ledger remains in `docs/technical-debt/2026-07-29-end-to-end-deferred-hardening.md`.

High-priority themes include:

- full authoritative materialization immutability for source payloads;
- durable status-only confirmation receipts;
- further reduction of direct `service_role` mutation authority;
- atomic eligibility publication;
- single-snapshot bundle reads;
- non-null legacy Source Revision lineage;
- versioned Company/Deal identity corrections;
- reliable atomic CLI reset;
- remote XTrace cleanup semantics;
- stronger provider-derived lineage compatibility;
- named-framework licensing/source approval before real production use;
- production coverage beyond Seed/Series A B2B SaaS and Enterprise AI;
- mixed text/image evidence merging;
- legacy hosted-row compatibility;
- source-link and draft-save browser interaction hardening;
- concurrent create-or-reuse race hardening;
- dependency/security audit remediation.

Automatic scheduled scans, actual email/SMS/LinkedIn sending, and automated
publishing remain explicit non-goals of the current release.

## 19. Encountered issues and current disposition

This section distinguishes actual blockers, fixed defects, expected product
states, and unfinished features. A new Agent must not “fix” an expected safety
state by weakening its contract.

### 19.1 Active release blockers

| ID | Status | What was observed | Root cause / current meaning | Required next action |
|---|---|---|---|---|
| DEP-001 | Blocked | The current 30-Deal branch is not live at the public URL. | Public Sites metadata was still on version 12 / `8eda744...`; the current branch is newer. | Deploy only after the data and Worker blockers below are resolved. |
| DEP-002 | Blocked, safety gate | Current code needs migrations `0019`–`0026`, but production is reviewed only through `0018`. | The production launcher intentionally refuses at unreviewed `0019`. | Complete catalog/security review and obtain explicit production migration authority, or use an isolated non-production database on `0026`. |
| DEP-003 | Blocked | Sites cannot run the complete Scan workflow by itself. | Sites hosts Web, while `WAKE AGENT & SCAN MARKET` needs a same-SHA long-running Worker and fresh heartbeat. | Provision and deploy a persistent Worker host with the same schema, commit, and provider configuration. |
| DEP-004 | Blocked | No deployable external Staging environment exists. | There is no configured Staging Supabase/PostgREST/Storage or Worker. `.runtime` staging-like files are disposable local fixtures only. | Provision an isolated environment, apply `0000`–`0026`, seed approved sample data, deploy same-SHA Web and Worker, then smoke-test. |
| DEP-005 | Unresolved provider issue | A prior private Sites Staging attempt produced no URL. | Initial source-branch creation returned provider HTTP 500; project identity was not persisted. | Retry only through a supported, auditable target; do not fall back to production data. |
| DEP-006 | Unsafe shortcut | A code-only public Sites deploy is technically possible but would not provide complete functionality. | New Web routes could call missing production tables/RPCs and no current Worker would finish scans. | Do not publish code-only as “complete”; require explicit acceptance of degraded behavior before considering it. |
| DEP-007 | Operational risk | `public_sandbox` is anonymous and writable in the demo workspace. | Anyone with the URL can use permitted upload, scan, draft-edit, and reset paths. | Keep the public warning, use synthetic/non-confidential data only, and verify rate limits and reset scope before release. |

### 19.2 Runtime and UI issues encountered during acceptance

| ID | Status | User-visible symptom | Explanation / fix | What the next Agent must verify |
|---|---|---|---|---|
| RUN-001 | Expected fail-closed state | `A required service is unavailable` and Scan could not start. | PostgreSQL/Worker/provider health was missing; scan creation correctly requires a fresh Worker heartbeat. | Start the same-environment Worker, verify `/api/settings/health`, and never bypass the gate. |
| RUN-002 | Expected legacy behavior | Reports showed 23 companies after a 30-Deal run was expected. | The user had opened the immutable 2026-08-01 pinned 23-analysis replay, not a current live report. | Keep the 23 artifact immutable, label it pinned/historical, and show 30 only for completed current runs. |
| RUN-003 | Fixed locally; operational recurrence possible | `127.0.0.1:3100` stopped responding or a restart appeared on another port. | A stale local process occupied 3100 while another process fell back. The fixture now uses strict port binding and fails closed. | Stop stale project-local processes before restart; verify the announced URL is the process actually under test. |
| UI-001 | Fixed and locally accepted | Deep Underwriting appeared as dense cards, tiny type, run-together labels, or unreadable analyst blocks. | The report was rebuilt as a narrative-first editorial IC memo with readable site-wide typography. | Recheck desktop/mobile readability, section order, and zero material overflow after any UI change. |
| UI-002 | Fixed and locally accepted | `LIVE EVIDENCELive evidence...` and raw ISO timestamps ran together. | Presentation now separates status, readable date range, timezone, and event count; exact timestamps remain in audit. | Verify live, pinned, and legacy modes independently. |
| UI-003 | Fixed and locally accepted | `Changed Assumptions` showed raw values such as `0.75 decimal`. | The section is now Modeling Assumptions and renders `0.75×`, `1.00×`, and `1.25×` with readable deltas. | Do not imply these are Facts, confidence, probability, or evidence-driven changes. |
| UI-004 | Fixed and locally accepted | IC Decision Ask omitted part of an invested-negative action. | The IC approval request now renders the full typed action list, including pause follow-on and portfolio risk review. | Keep the request internal and non-executing; never render only the first action. |
| UI-005 | Fixed and locally accepted | Complete evidence cards appeared before the decision and source actions led to snapshots rather than original pages. | The narrative now closes with Final IC Position before the Evidence Register; public canonical URL and archived snapshot are separate actions. | Unsafe/absent canonical URLs must fail closed to archive-only behavior. |
| DATA-001 | Expected safety state, not a rendering bug | Many fields and formal decisions were `Unavailable`. | Private-company ARR, growth, margins, cash, burn, runway, financing terms, or verified remediation data were not publicly supported. The application correctly refused to invent them. | Preserve the typed reason, summarize it once in the main memo, and turn it into prioritized diligence. Do not replace it with estimates labeled Fact. |
| DATA-002 | Expected dynamic behavior | Outcome counts differed across accepted runs (`4/7/19/0`, `4/6/20/0`, `4/4/22/0`). | Different persisted live/pinned windows admitted different events. | Require totals to equal 30 and derive every outcome; never hard-code a distribution. |

### 19.3 Test, documentation, and local-environment issues

| ID | Status | Issue | Resolution / remaining action |
|---|---|---|---|
| QA-001 | Fixed | Two process-run tests used the wall clock with July 2026 fixtures and would fail as the 14-day window moved. | Both tests now inject the fixed run-authority clock `2026-07-24T12:00:00.000Z`; production window validation remains unchanged. |
| QA-002 | Fixed | Finalized Chat UI expected the replaced pinned label. | The test now expects the approved readable Jul 19–Aug 1, 2026 window while retaining the pinned status assertion. |
| DOC-001 | Fixed in this checkpoint | README and runbook described the local chain only through `0024`. | They now list and describe `0025` and `0026` while preserving production terminal `0018`. |
| ENV-001 | Local tooling only | Initial build/typecheck could not write Vite/TypeScript cache files under the managed sandbox. | They were rerun with write permission to the existing worktree and passed; this was not an application defect. |
| QA-003 | Still required before data-plane release | The normal test suite intentionally skips PostgreSQL/Docker opt-in tests. | Run the general migration gate, the PostgreSQL 17.6 safe-refusal gate, and the cold E2E on disposable infrastructure before a hosted data-plane release. |
| QA-004 | Known risk | Another future static-date test could accidentally use ambient time. | Any test that creates a live run around historical fixtures must inject the same authoritative clock; never weaken runtime chronology/window gates to make a test pass. |

### 19.4 Product work that is intentionally unfinished

| ID | Status | Missing capability | Continuation rule |
|---|---|---|---|
| LOC-001 | Not implemented | English/Traditional-Chinese locale switch, dictionaries, artifact translation, cache, Chinese Reports, and Chinese Chat presentation. | Resume the Section 14–17 approval sequence before writing code. |
| LOC-002 | Not implemented | Explicit source-language metadata and per-source translation lifecycle. | Preserve original text now; add typed language metadata only through the approved localization design. |
| OBS-001 | Partial | Cost/token/provider-attempt telemetry exists; a complete persisted latency telemetry contract is not proven. | Add only through a typed persisted design; do not overclaim current observability. |
| OPS-001 | Deliberately disabled | Scheduled scans and real Email/SMS/LinkedIn sending or publishing. | Keep draft-only and manual scan boundaries unless separately approved. |
| SEC-001 | Production hardening backlog | Several source authority, `service_role`, snapshot consistency, identity correction, and concurrency items remain in technical debt. | Complete every item marked Production gate before real customer/private-fund use. |
| COV-001 | Product limitation | Deepest deterministic valuation coverage is Seed/Series A B2B SaaS and Enterprise AI. | Return explicit unsupported/unavailable for other contexts until versioned policy, benchmark, and tests are added. |

### 19.5 Current verification snapshot

The 2026-08-05 checkpoint verification completed with:

- default suite: 1,635 tests; 1,564 passed; 0 failed; 71 explicit environment-
  gated skips;
- targeted process-run and Finalized Chat suite after final clock fixes: 17/17
  passed;
- TypeScript: zero errors;
- ESLint: zero errors and nine pre-existing unused-variable warnings;
- vinext five-environment release build: success;
- `git diff --check`: success.

These results do not substitute for the opt-in migration/cold-E2E gates before
a new external data-plane deployment.

## 20. Next-Agent execution order

### First 30 minutes

1. Read the ten documents listed in Section 0 completely.
2. Confirm branch, HEAD, remotes, and working tree.
3. Confirm the feature branch exists on the requested `ryanwu1008` remote and
   points to the reported handoff SHA.
4. Run `git diff --check`, typecheck, lint, test, and build before claiming the
   checkpoint is green.
5. Do not read secrets or production rows merely to inspect deployment.

### If continuing company-mainline release

1. Choose the isolated Staging path or obtain explicit production migration
   authority; do not silently choose code-only production publication.
2. Use terminal migration `0026` only on the isolated non-production database.
3. Deploy identical Web and Worker commits.
4. Verify the health endpoint before enabling Scan.
5. Click the visible scan action from an empty current-report state.
6. Verify 30 eligible Deals and exactly 30 CompanyAnalyses.
7. Verify outcome counts sum to 30.
8. Verify Underwriting Deal IDs exactly equal `belief_revised` Deal IDs.
9. Verify every job reaches completed/partial/failed with a reason.
10. Verify the seven screening labels and no synthetic-meeting claims.
11. Replay the immutable 23-analysis report separately.
12. Open at least one full Underwriting memo and test report-scoped Chat.

### If continuing localization

Resume at Section 14 confirmation. Do not write localization code first. After
the complete design is approved, implement against the final company-mainline
schemas and retain English as canonical authority.

## 21. Verification commands and interpretation

Normal release verification:

```bash
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

Migration verification on disposable PostgreSQL only:

```bash
npm run test:migrations
npm run test:migrations:production-pg176
```

The production-profile command must end with `SAFE_REFUSAL — production
forward migration remains blocked`. That means the guard worked. It does not
mean production `0019+` is approved.

Cold company-mainline E2E on disposable infrastructure:

```bash
npm run test:e2e:belief-reversal
```

Local browser fixture:

```bash
npm run demo:belief-reversal:browser
```

Never report tests as passing from memory. Record exact command, timestamp,
pass/fail/skip counts, build result, environment type, and whether production
access was zero.

## 22. Release acceptance checklist

A complete non-production 30-Deal release requires all of the following:

- [ ] exact verified Git SHA for Web and Worker;
- [ ] isolated PostgreSQL/PostgREST/Storage on terminal migration `0026`;
- [ ] no production data read, seed, migration, or mutation;
- [ ] Worker heartbeat healthy;
- [ ] `WAKE AGENT & SCAN MARKET` creates a new queued run;
- [ ] exactly 30 eligible Deal IDs bound to the run;
- [ ] exactly 30 CompanyAnalyses persisted;
- [ ] four outcome counts sum exactly to 30;
- [ ] every and only belief revision has one Underwriting job;
- [ ] no rank cutoff or Top-5 rejection semantics;
- [ ] every Underwriting job has a persisted terminal state;
- [ ] no non-belief-revised Deal has fake deep artifacts;
- [ ] all seven screening Deals stay screening and sample-labeled;
- [ ] no fake meeting or VC interaction appears;
- [ ] legacy 23-analysis pinned report remains immutable and replayable;
- [ ] Reports show readable evidence mode/window;
- [ ] full memo follows the approved reading order;
- [ ] source links and archived snapshots are distinct;
- [ ] missing evidence does not become invented financial data;
- [ ] action outputs remain draft-only;
- [ ] Finalized Chat stays report-scoped;
- [ ] desktop and mobile have no material overflow or illegible body text;
- [ ] replay creates no duplicates;
- [ ] all verification evidence is recorded in a QA document.

## 23. Explicit “do not” list

Do not:

- restore Top 5 as a new-run underwriting gate;
- hard-code Irregular, Henry AI, Hush Security, Smallest.ai, or any other name
  into admission;
- exclude the seven screening Deals by disposition;
- turn sample screening records into historical Passes or meetings;
- mix normalized statements with verbatim quotations;
- use XTrace recall text as citation authority without exact lineage;
- infer missing private-company metrics as Fact;
- expose or claim hidden chain of thought;
- allow rank to remove a belief revision from Underwriting;
- run Deep Underwriting for `monitor`, `no_material_change`, or
  `analysis_unavailable`;
- show repeated raw unavailable matrices in the main memo;
- put disconnected evidence before the narrative decision;
- add Send, Publish, or automatic execution controls;
- translate canonical evidence or decisions into a new authority;
- rewrite the immutable 23-analysis pinned report;
- run unreviewed production migrations;
- seed production;
- publish code-only Web and call it a complete E2E deployment;
- reveal credentials, bearer tokens, service keys, or signed capabilities.

## 24. Key code and documentation map

### Product and UI

- `app/page.tsx`
- `app/underwriting-detail.tsx`
- `app/underwriting-summary.tsx`
- `app/api/`
- `app/globals.css`
- `app/vsee.css`
- `app/underwriting-article-view-model.ts`
- `app/analyst-panel-view-model.ts`
- `app/action-draft-view-model.ts`

### Contracts and product services

- `lib/contracts/`
- `lib/contracts/domain.ts`
- `lib/contracts/source-evidence.ts`
- `lib/contracts/research-candidate.ts`
- `lib/belief-reversal/`
- `lib/deals/`
- `lib/matching/`
- `lib/market/`
- `lib/underwriting/`
- `lib/reports/`
- `lib/chat/`
- `lib/xtrace/`
- `lib/storage/`
- `lib/reports/action-policy.ts`
- `lib/matching/scoring.ts`
- `lib/matching/hard-gates.ts`
- `lib/matching/ranking.ts`
- `lib/underwriting/orchestrator.ts`

### Persistence and Worker

- `db/schema.ts`
- `db/client.ts`
- `db/repositories/`
- `drizzle/`
- `worker/process-run.ts`
- `worker/runner.ts`
- `Dockerfile.worker`

### Data and fixtures

- `seed/belief-reversal/2026-08-01/`
- `tests/helpers/`
- `lib/corpus/`
- `research/`
- `scripts/seed-demo.ts`
- `scripts/seed-belief-reversal-demo.ts`
- `scripts/run-belief-reversal-browser-fixture.ts`

### Verification

- `tests/integration/belief-reversal-demo-e2e.test.ts`
- `tests/integration/process-run.test.ts`
- `tests/integration/`
- `tests/unit/`
- `docs/qa/2026-08-03-current-30-cold-e2e-acceptance.md`

### Release operations

- `.openai/hosting.json`
- `.env.example`
- `README.md`
- `docs/demo-runbook.md`
- `scripts/run-worker-from-keychain.zsh`
- `scripts/apply-production-migrations.zsh`
- `scripts/production-catalog-fingerprints.zsh`

## 25. Definition of project completion

The company-mainline feature is functionally complete for the current local,
isolated 30-Deal demo when the exact verified commit passes cold E2E and browser
acceptance. It is not operationally complete for the public production URL
until a schema-compatible isolated or reviewed database, same-commit long-
running Worker, and full hosted browser smoke are complete.

The bilingual feature is not complete until the remaining product decisions,
final localization design approval, implementation, tests, authorized
deployment, and bilingual E2E acceptance are complete.

The long-term product vision is complete only when the same source-grounded,
workspace-isolated, replayable decision intelligence works for real authorized
fund data without synthetic interaction ambiguity, production migration gaps,
or provider-hosting gaps. Until then, keep every sample label, evidence class,
decision ceiling, draft-only boundary, and production-isolation rule visible.

## 26. Copyable continuation prompt for the next Agent

Copy the complete prompt below into the next task. Do not shorten the required
reading list or remove the deployment safety boundary.

```text
你現在要接續 VSee／XTrace VC Decision Intelligence Web App。請用繁體中文與我溝通；程式碼、資料契約與既有英文文件維持專案既有語言。

Repository：
/Users/wuyuhan/Documents/Codex/2026-07-21/referenced-chatgpt-conversation-this-is-untrusted/XTrace_Hackathon/.worktrees/backend-integration-checkpoint

工作分支：
feat/backend-integration-checkpoint

GitHub continuation target：
https://github.com/ryanwu1008/XTrace_Hackathon.git

第一步不要改程式。請完整閱讀下列文件，不要只讀摘要：

1. docs/superpowers/specs/2026-08-05-vsee-xtrace-complete-project-continuation-handoff.md
2. docs/superpowers/specs/2026-08-01-belief-reversal-demo-company-research-handoff.md
3. docs/superpowers/specs/2026-08-03-underwrite-all-belief-revisions-product-decision-addendum.md
4. docs/superpowers/specs/2026-08-01-bilingual-localization-continuation-handoff.md
5. docs/superpowers/specs/2026-08-04-editorial-ic-memo-report-design.md
6. docs/superpowers/specs/2026-08-04-underwriting-reading-order-and-source-actions-design.md
7. docs/superpowers/specs/2026-08-04-underwriting-context-assumptions-and-ic-ask-design.md
8. docs/qa/2026-08-03-current-30-cold-e2e-acceptance.md
9. docs/demo-runbook.md
10. docs/technical-debt/2026-07-29-end-to-end-deferred-hardening.md

閱讀後先核對 branch、HEAD、remotes、working tree、GitHub remote branch SHA、.openai/hosting.json 與目前 Sites deployment metadata。保留所有既有使用者修改，不可覆蓋或 reset 無關變更。請以包含 2026-08-05 complete-project handoff 的 commit 為接手 checkpoint；不要只相信聊天摘要。

權威產品流程是：

All 30 analysis-eligible Deals
→ Market Scan
→ exact Deal-bound XTrace recall
→ Matching
→ exactly 30 CompanyAnalyses
→ every admitted belief_revised CompanyAnalysis
→ exactly one immutable Deep Underwriting job per belief revision
→ completed/partial/failed terminal artifacts
→ Reports、draft-only actions、finalized report-scoped Chat

最新決定已移除 Top 5。新 run 不得使用 Top 5、rank cutoff、selectedForTop5、not selected due to rank 或固定五間容量作為 Underwriting eligibility。priorityRank 只決定 queue/UI/通知順序。每個且只有 belief_revised 都必須進入 Deep Underwriting；beliefRevisedCount 必須等於 underwritingCandidateCount，0–30 都成立。

Current contract：30 Companies、30 Deals、30 analysis-eligible Deals、每個 completed current run 恰好 30 CompanyAnalyses。四種 outcomes 為 belief_revised、monitor、no_material_change、analysis_unavailable，總和必須精確等於 30。High score 不能越過 chronology、revisit-condition mapping、counterevidence、action delta、exact lineage 或 provider/system failure gates。

七間 screening Deals 是 Centralize、ChipAgents、Sent、Cascade、Cordant、Empirical Security、Freight Hero。每間 status=screening、research disposition=qualified_not_selected、analysis eligible=true、Deal-bound XTrace memory=true，並永久標示 Sample research screening record。它們不是 Pass、Watchlist、Invested、meeting、VC interaction 或 formal decision。meetingOccurred=false、vcInteraction=false。不可依公司名稱或 disposition 排除；未來有更強證據時可自然 belief_revised。

四個 reviewed sample cases 是 Henry AI（passed-positive）、Smallest.ai（watchlist-positive）、Hush Security（invested-positive）、Irregular（invested-negative）。過往 fund context 永久是 Sample decision record，不可假裝真實 VC meeting。Irregular 的 canonical action 必須同時包含 pause_follow_on 與 portfolio_risk_review。

證據要求：verbatimExcerpt 與 normalizedStatement 分離；normalized text 不可通過逐字引用驗證。所有 decision-relevant facts 必須有 exact Source Revision 與 Deal/workspace-bound XTrace lineage。Facts、Assumptions、Unknowns、Conflicts、Calculations、framework opinions 與 model inference 必須分開。不要輸出或聲稱展示 hidden Chain of Thought，只能顯示有來源的結論、support、counterargument、limitations、disagreements 與 deterministic fired rules。

Deep Underwriting 的主畫面必須維持正式的單欄 editorial IC memo，而不是 card wall。閱讀順序是 Executive Conclusion、What Changed、Verified Company Snapshot、Investment Thesis Assessment、Investor Framework Synthesis、Investment Committee Debate、Financial Case、Valuation and Return Analysis、VSee IC Synthesis、Required Diligence、Status-aware Action Drafts、Final IC Position、Evidence and Source Register、Audit Appendix。主要內文 16–18px；Evidence Register 與 Audit 放最後；Named frameworks 是 public-source product synthesis、NO ENDORSEMENT、formal decision weight 0。

Unavailable 是 typed safety state，不是亂碼。若 ARR、growth、margin、cash、burn、runway、terms、remediation 等沒有可接受證據，不得捏造。主 memo 只摘要一次原因與 Required Before Valuation；完整 3×17 matrix 留在 Audit。Modeling Assumptions 顯示 0.75×（−25%）、1.00×（Base）、1.25×（+25%），不可叫 Changed Assumptions 或把它當 probability/confidence/Fact。

所有 Email、SMS、LinkedIn、Internal Memo、diligence request 都是 DRAFT ONLY。不可自動寄送、發布或執行。Finalized Chat 只讀同一 finalized report/run/Deal 的 persisted artifacts，不 browse、不重跑 Underwriting、不改 Deal、不建立新 Fact/Decision/Action/XTrace memory。

Immutable legacy boundary：2026-08-01 pinned report 永遠是 23 analyses 的歷史 artifact。必須保持原 universe、Source Revision/XTrace/report/underwriting fingerprints 與 replay。不要回頭改成 30。Current live/cold reports 才是 30 analyses。Pinned 與 live evidence 不得混用，Reports/Chat 必須明確標示 evidence mode 和可讀 date range。

目前本機公司主線已完成並通過完整 default suite、typecheck、lint、build、cold E2E 與 browser acceptance 的既有證據。2026-08-05 最後驗證是：1,635 tests / 1,564 pass / 0 fail / 71 explicit opt-in skips；targeted clock/Chat tests 17/17；TypeScript 0 errors；ESLint 0 errors（9 existing warnings）；build success；git diff --check clean。請先重新核對當前 commit，不可把這些歷史結果當成你修改後的結果。

你首先要處理的公司主線剩餘工作不是重新做 UI，而是安全發布阻塞：

1. 正式 Supabase schema 只批准到 0018，但 current 30-Deal runtime 依賴 0019–0026。Production launcher 必須在 0019 fail closed；不可 bypass、alias fingerprint、手動 SQL 或 seed production。
2. Sites 只 host Web，目前沒有已配置的 same-SHA 長駐 Worker host，因此完整 Wake & Scan 無法只靠 Web deployment 跑通。
3. 目前沒有外部 Staging Supabase/PostgREST/Storage/Worker/Sites 組合。先前 private Sites attempt 因 source branch HTTP 500，沒有 usable version/URL；.runtime staging files 只是本機 disposable fixture。
4. 現有 public URL 是 anonymous public_sandbox，最後觀察到舊 version 12 / 8eda744... 並連著 shared production Supabase。只部署 current Web code 可能呼叫不存在的 schema/RPC，不能稱完整功能，且可能破壞現有 public sandbox。

使用者已授權建立 private Staging，且最終希望完整功能進正式頁面；但沒有授權你修改 production data 或繞過 migration review。推薦最短安全路徑是 provision 隔離 Supabase/PostgREST/Storage，套 0000–0026，只 seed approved synthetic/sample data，部署同一 verified SHA 的 Web 與 persistent Worker，完成 health + real Wake & Scan + 30 analyses + Underwriting + Reports + Chat smoke，再決定 public URL cutover。若缺少建立隔離 data plane 或 Worker host 的權限／目標，只針對這個部署目標向使用者問一次；不要用 code-only production deploy 假裝完成。

請先完整閱讀 handoff Section 19 的 issue ledger。當中已區分 active blockers、已修復 UI/runtime 問題、expected safety states、日期敏感測試修正、未完成 localization 與 production hardening。不要把 expected 23 pinned report、Unavailable 或 health fail-closed 當成可刪除的 bug。

公司主線安全發布完成或被外部環境明確阻塞後，才接續雙語 workflow。雙語目前完全未實作，不可聲稱已有 i18n、locale switch、translation cache、中文 Report API 或中文 Chat。請從 localization handoff Section 14 開始，一次只問那一個完整區塊是否同意；之後依序 Section 15 test matrix、Section 16 scope/non-goals、Section 17 一次一題，最後寫 complete localization design 讓使用者批准，批准前不可寫 localization code。

每次提問只問一個真正會改變產品行為、資料權威、成本、安全或 UI 流程的主題，先提供推薦與取捨。可由程式、測試、文件確認的事先自行核對。持續用繁體中文提供短進度更新。

完成公司主線 hosted release 時必須交付：

- exact Git SHA、GitHub branch 與 remote verification；
- Web/Worker same-SHA proof；
- isolated or explicitly reviewed schema identity；
- health evidence；
- visible Wake & Scan creates a new queued run, not a pre-generated report；
- 30 eligible Deals、30 CompanyAnalyses、outcomes sum 30；
- Underwriting Deal IDs exactly equal belief_revised Deal IDs；
- every job terminal completed/partial/failed with reason；
- seven screening labels and no fake meetings；
- immutable pinned23 replay；
- one full editorial Underwriting memo；
- finalized report-scoped Chat；
- desktop/mobile browser acceptance；
- replay/idempotency proof；
- explicit production read/write/seed/migration count of zero unless separately authorized；
- updated QA/runbook/handoff and commit SHA。

禁止：force push、重寫 immutable reports、hard-code selected companies、invent public facts or financials、expose secrets/bypass tokens、read Keychain secrets for exploration、modify production data、run unreviewed production migrations、auto-send drafts、or claim hidden Chain of Thought。
```
