# Belief-Reversal Demo Company Research and Integration Handoff

**Status:** Approved product requirements; implementation has not started  
**Superseded for underwriting selection:** The approved [2026-08-03 Underwrite All Belief Revisions product-decision addendum](2026-08-03-underwrite-all-belief-revisions-product-decision-addendum.md) overrides this document's Top-5, rank-cutoff, and fixed-capacity eligibility language. This handoff remains historical for its original research, provenance, and demo requirements.
**Date:** 2026-08-01  
**Audience:** The next Codex task or engineer taking over company research,
demo-data authoring, report-quality validation, and end-to-end integration  
**Repository:** `CoKayne/XTrace_Hackathon`  
**Working branch at handoff:** `feat/backend-integration-checkpoint`  
**Baseline before this documentation change:** `8eda744`  

## 1. Read this first

The task is not to pick attractive startups and then search for convenient
news. The selection direction is deliberately reversed:

1. collect recent, verifiable public evidence;
2. infer which investment beliefs or next actions that evidence could
   materially change;
3. identify real startups for which the causal link is defensible;
4. reconstruct an explicitly synthetic prior VC decision record;
5. admit only companies for which the new evidence changes the prior decision
   or next action at medium or high Match Confidence;
6. run the selected companies through the existing application from Deal
   memory to CompanyAnalysis, Top 5, underwriting, advisory viewpoints,
   valuation, final decision, action drafts, Reports UI, and Chat.

The goal is a reliable demo and report-quality evaluation, not a prewritten
marketing story. A company that cannot pass the evidence and lineage gates must
be replaced; the threshold must not be weakened.

## 2. Product mission and current system

VSee is a source-grounded VC decision-intelligence Web App. It connects:

- confirmed Deal sources and synthetic internal investment history;
- public market and company evidence from the latest 14 days;
- XTrace recall of long-term Deal and decision context;
- Anthropic for bounded matching and framework-level interpretation;
- deterministic valuation and decision rules for formal outputs;
- persisted reports and editable, draft-only next actions.

The current runtime flow is:

```text
Confirmed company source + Sample decision record
                         ↓
       Authoritative Deal Registry and source revisions
                         ↓
        XTrace ingest and lineage-checked Deal recall
                         ↓
         Latest-14-day public evidence collection
                         ↓
    Evidence-grounded Deal/event matching and confidence
                         ↓
      All-company analyses; medium/high belief revisions
                         ↓
                Ranked Top 5 candidates
                         ↓
 Evidence Pack → context → valuation → framework judgments
                         ↓
 Formal decision → report narrative → draft-only actions
                         ↓
                   Reports UI and Chat
```

Important system boundaries:

- XTrace is memory infrastructure, not citation authority. Recalled text must
  resolve to an exact local source revision or the analysis fails closed.
- Anthropic may extract and interpret evidence, but it does not have formal
  decision authority.
- Valuation calculations and `Pass / Watch / Advance / Invest Candidate` are
  produced by versioned deterministic code.
- Named investor/VC frameworks produce real, separately visible opinions,
  counterarguments, unknowns, limitations, and disagreements. They currently
  have formal decision weight zero.
- Search and Chat query already-persisted artifacts only. They do not browse,
  rerun underwriting, or mutate Deal status.
- Email, SMS, LinkedIn, internal memo, and diligence-request outputs are drafts
  only. The product must not send or publish anything.

Start with:

- [`README.md`](../../../README.md)
- [`docs/demo-runbook.md`](../../demo-runbook.md)
- [`docs/superpowers/specs/2026-07-28-source-grounded-vc-underwriting-design.md`](2026-07-28-source-grounded-vc-underwriting-design.md)
- [`docs/superpowers/specs/2026-07-29-experimental-advisory-framework-amendment.md`](2026-07-29-experimental-advisory-framework-amendment.md)
- [`docs/technical-debt/2026-07-29-end-to-end-deferred-hardening.md`](../../technical-debt/2026-07-29-end-to-end-deferred-hardening.md)

## 3. Exact objective

Research and integrate **3–5 real startups outside the existing 19-Deal
corpus**. Target four companies if evidence permits. Each selected company must
have:

1. a real identity, founder/company background, business description, funding
   information, and traction information supported by public sources;
2. an explicitly synthetic historical VC interaction and decision record;
3. a real, recent public event or evidence set that materially changes the
   synthetic prior belief or next action;
4. a medium- or high-confidence, claim-level-cited belief revision;
5. a full status-appropriate investment report;
6. a truthful underwriting result, including unavailable fields where public
   evidence is insufficient;
7. draft-only recommended actions suited to the Deal's existing status.

The selected cases must demonstrate the following three prior Deal states:

- `passed`: previously rejected;
- `watchlist`: previously observing;
- `invested`: already in the portfolio.

Positive and negative changes are both valid. The preferred four-case demo
matrix is:

| Case | Prior status | Required direction | Expected action change |
|---|---|---|---|
| A | `passed` | Positive | Reopen the Deal and begin fresh diligence |
| B | `watchlist` | Positive or negative | Advance into diligence or remove/deprioritize |
| C | `invested` | Positive | Consider follow-on, reserve allocation, or deeper support |
| D | `invested` | Negative | Stop/pause follow-on and begin portfolio-risk review |

If only three cases meet the evidence bar, retain one per required status and
do not invent a fourth. If five meet it, the fifth should preferably show a
negative `watchlist` change or a mixed-signal case. Never select more than five
for the automatic Top 5 demo path.

## 4. What counts as a belief change

A recent event is not enough by itself. A company is eligible only when the
event changes an important recorded assumption, decision reason, revisit
condition, or concrete next action.

Examples:

- The prior team passed because there were no paying enterprise customers.
  Official customer evidence now confirms production deployments. The action
  changes from `do not pursue` to `reopen diligence`.
- The company was on a watchlist pending commercial proof. New recurring
  revenue or renewal evidence resolves the checkpoint and supports advancing.
- The company was invested on the thesis that a regulatory pathway would
  remain open. A final rule materially restricts that pathway, so the action
  changes from potential follow-on to risk escalation.
- An invested company outperforms the original Base Case with cited customer,
  revenue, or product evidence, so the action changes to follow-on evaluation.

The following do **not** qualify:

- generic sector enthusiasm with no company exposure or causal mechanism;
- a product launch that does not address the prior concern;
- one unsupported social post or rumor;
- a funding headline with no verified company identity;
- an interesting update that leaves the next action unchanged;
- a synthetic current metric presented as if it were a real public fact.

The test is:

> If the investor knew this evidence today, would the recorded next action or
> resource allocation materially change?

If the answer is no, the company can appear in the market summary but must not
be admitted as a belief-revision demo case.

## 5. Confidence standard

Confidence measures how strongly cited evidence supports a change in the
fund's prior belief. It is **not** the probability that the startup will
succeed and is **not** an investment approval.

The existing Match Confidence calculation is:

| Dimension | Weight |
|---|---:|
| Event relevance | 35% |
| Deal relevance | 30% |
| Prior decision-context strength | 20% |
| Evidence quality | 15% |

Thresholds:

- `high`: score greater than or equal to `0.78`;
- `medium`: score greater than or equal to `0.50` and below `0.78`;
- `low`: score below `0.50`.

Only a `medium` or `high` match may become `belief_revised`, enter the Top 5,
and proceed to full underwriting. A low-confidence match remains visible as
`monitor`. No relevant evidence becomes `no_material_change`. Missing verified
memory or an analysis failure becomes `analysis_unavailable`.

In addition to the numeric threshold, every selected case must pass these hard
gates:

1. at least one accepted public source and one exact Deal-memory source exist;
2. company identity is unambiguous;
3. the recent trigger maps directly to the decision reason or revisit
   condition;
4. every displayed factual claim resolves to a source ID and bounded excerpt;
5. the synthetic prior interaction predates the recent trigger;
6. important counterevidence and unknowns are retained;
7. a concrete next action changes;
8. no model inference is promoted into a Fact.

Relevant implementation references:

- `lib/matching/scoring.ts`
- `lib/matching/service.ts`
- `lib/matching/claude-reasoner.ts`
- `lib/reports/company-analysis.ts`
- `lib/contracts/domain.ts`

## 6. Research workflow: event first, company second

The receiving agent must browse the current web because the evidence is
time-sensitive. Use exact dates and direct source links.

### Phase 1: Build a recent-event map

Search the latest 14 days first. Collect candidate events across:

- official company announcements and newsroom posts;
- government and regulator releases;
- court, agency, and public filing records;
- official customer or commercial-partner announcements;
- official investor and VC announcements;
- credible funding and venture publications;
- reputable industry publications and databases;
- official founder or company social posts only as secondary evidence unless
  independently corroborated.

For every event record:

- title;
- publisher;
- canonical URL;
- publication date and, if different, event date;
- retrieval date;
- affected sectors and themes;
- named company/entity keys;
- bounded evidence excerpt;
- positive and negative implications;
- initial Event Confidence;
- source class and whether it is primary or secondary.

Never cite a search-results page. Prefer primary sources, and use independent
sources to corroborate material claims.

### Phase 2: Infer possible belief reversals

For each event, describe the causal mechanism before choosing a company:

```text
Event
→ affected customer behavior / regulation / cost / distribution / technology
→ investment assumption changed
→ type of Deal likely affected
→ next action that could change
```

Produce both positive and negative hypotheses. Include disconfirming evidence
that would defeat the hypothesis.

### Phase 3: Find candidate companies

Search for startups exposed to the mechanism. A candidate must be outside the
existing 19 companies listed in `seed/manifest.json` and must have enough
public evidence to establish:

- exact company identity and official domain;
- founder/team identity where public;
- business model and customer;
- stage and geography;
- funding history or current round terms where public;
- real traction, customer usage, revenue, orders, deployments, regulatory
  status, or another industry-appropriate proof-of-use signal;
- the recent event's direct relevance;
- material risks and counterevidence.

Search broadly, but prefer final cases compatible with the current full
underwriting route:

- stage: `seed` or `series_a`;
- business model: `b2b_saas` or `enterprise_ai`;
- geography: `us` or `global`;
- security type: `preferred`.

Other companies may be used only if the implementation explicitly extends the
context router, evidence profiles, valuation policy, benchmarks, and tests. Do
not silently force a hardware, biotech, consumer, or later-stage company into a
SaaS model. Although the router contract describes a `core_only` path, the
current slice-one candidate executor treats an unresolved/unsupported context
as unavailable. Supporting a truthful `core_only` report therefore requires
explicit implementation and tests; it is not available merely by choosing a
different company.

Relevant references:

- `lib/underwriting/router.ts`
- `seed/underwriting/slice-one-contexts-v1.ts`
- `drizzle/0012_source_grounded_underwriting.sql`

### Phase 4: Reconstruct the prior decision

The prior VC/Founder meeting is synthetic demonstration content, not a claim
about a real meeting. Construct it only after the real company and reversal
mechanism are selected.

The prior decision must:

- use only facts that were publicly knowable as of its historical cutoff;
- have an `occurredAt` earlier than the new trigger;
- explain the status and decision reason;
- record specific partner concerns;
- record one or more measurable revisit conditions;
- make the future belief change testable;
- remain plausible without pretending that the actual company spoke to this
  VC fund.

Every synthetic record must permanently retain:

```text
provenance: demo_fixture
label: Sample decision record
```

Suggested structure:

```json
{
  "id": "fixture_<company>_<status>_v1",
  "dealId": "deal_<company>",
  "companyName": "Company",
  "occurredAt": "<historical ISO timestamp>",
  "provenance": "demo_fixture",
  "label": "Sample decision record",
  "status": "passed | watchlist | invested",
  "meetingSummary": "Sample internal note: ...",
  "decisionReason": "The sample team ...",
  "concerns": ["..."],
  "revisitConditions": ["..."]
}
```

### Phase 5: Run the reversal test

For every candidate, fill out:

| Field | Requirement |
|---|---|
| Prior belief | Exact, synthetic, and dated |
| Prior next action | What the team would have done before |
| Revisit condition | Observable condition recorded in advance |
| New evidence | Real, cited, and recent |
| Causal link | Why the evidence satisfies or contradicts the condition |
| Counterevidence | Strongest reason the belief may not change |
| New next action | Concrete and status-appropriate |
| Confidence | Four dimensions plus weighted result |

Reject a candidate if the causal link needs invented facts or if its score is
low. Do not tune the threshold or invent additional sources to preserve a
preferred company.

## 7. Evidence and provenance policy

The system must keep four concepts separate:

### 7.1 Real public facts

Examples include a financing announcement, customer deployment, regulator
decision, disclosed revenue, public valuation, or signed order. These require
real URLs, dates, bounded excerpts, and source lineage.

### 7.2 Synthetic internal memory

Founder/VC conversation, internal Partner concern, prior status, and revisit
condition are synthetic. They are allowed only because the feature being
demonstrated requires historical private context. They must always be visibly
labeled `Sample decision record`.

### 7.3 Model inference

The connection between public evidence and historical belief is an inference.
It must cite both sides, show counterevidence, carry confidence, and never be
stored as a public Fact.

### 7.4 Analysis assumptions

Market defaults and scenario values may fill a Bear/Base/Bull model only as
explicit assumptions. Defaults are not company facts. When critical company
data is missing, the report must say so and limit its decision accordingly.

Do not expose private hidden model chain-of-thought. The product should expose
an auditable rationale instead:

```text
Facts → assumptions → calculations → framework judgments
      → disagreements → fired decision rules → conclusion
```

## 8. Required research package per company

Each selected company needs a versioned package containing the following.

### 8.1 Identity manifest

- stable company, Deal, and source IDs;
- legal/brand name and official URL;
- founder/team identity with sources;
- stage, business model, geography, and security type;
- prior Deal status;
- historical cutoff and current evidence as-of date.

### 8.2 Public source catalog

Every source entry must contain:

- source ID;
- title and publisher;
- canonical URL;
- source type/class;
- publication, event, and access dates as available;
- a short exact excerpt or a clearly identified normalized evidence statement;
- the claims it supports;
- whether it is primary, corroborating, or counterevidence.

Keep quoted text short. Store only what is required to validate the claim and
retain the source URL/locator.

### 8.3 Source-backed company facts

At minimum, try to provide:

- `company_identity`;
- `stage`;
- `business_model`;
- `geography`;
- `security_type`;
- `reported_valuation`;
- `reported_valuation_basis`;
- `arr` or `revenue`;
- `customer_evidence`;
- `cash`, `burn`, and `runway` where genuinely available.

The current minimum inputs for a valuation-capable run are company identity,
reported valuation, and valuation basis. ARR, revenue, customer evidence,
cash, burn, and runway are critical for higher-confidence decisions. Do not
fabricate unavailable metrics. A report can remain useful with an `Advance`
ceiling and a clear missing-evidence list.

The current Company Brief renderer recognizes only narrow textual patterns for
ARR, customer/user counts, growth, round, raise, and valuation. Do not rewrite
or distort evidence to satisfy those patterns. Prefer extending the read model
to consume canonical structured evidence so the UI and Evidence Pack share the
same source-backed values.

### 8.4 Sample decision record

Include the exact synthetic record described in Section 6, with one or more
specific revisit conditions.

### 8.5 Recent event records

Each event must match the `MarketEvent` contract in
`lib/contracts/domain.ts`, including sectors, themes, implications, dates,
confidence, and at least one source.

### 8.6 Expected-outcome metadata

Expected outcomes exist for tests and review; they are not evidence supplied
to the model. Record:

- expected relationship: `satisfies`, `contradicts`, or mixed/related;
- expected direction: positive, negative, or mixed;
- expected old and new action;
- minimum acceptable Match Confidence;
- why the case qualifies;
- what evidence would invalidate it.

The production reasoner must still reach its own grounded conclusion from the
actual source catalog and memory. Do not insert the expected answer into a
public source excerpt.

## 9. Fourteen-day window and reproducible demo behavior

The live product scans the latest 14 days. Real events naturally age out.
Never alter a source's publication date to keep a case visible.

The implementation must support one of these truthful paths:

1. **Live validation:** research and run the cases while their trigger events
   remain within the current 14-day window; refresh the selected companies as
   evidence changes.
2. **Pinned demo replay:** persist an immutable evidence snapshot and explicit
   `snapshotAsOfDate`, and label the run `Demo evidence snapshot as of <date>`.
   The application replays the historical 14-day window without claiming it is
   today's news.

For repeatable QA, a pinned replay is recommended. Live Market Scan must remain
the default product behavior. A pinned replay must never silently appear as a
live current scan.

Claude judgment replay already fingerprints the evidence, prompt, and model.
After a real Anthropic run produces a reviewed, grounded result, an unchanged
evidence fingerprint may reuse the stored judgment for deterministic repeat
runs. New evidence must produce a new fingerprint and new judgment.

## 10. Status-specific analysis and actions

The report must not reuse the same next action under different status labels.

### 10.1 Previously passed

The report must answer:

- Why did the sample fund pass?
- Which exact concern or revisit condition changed?
- Does the evidence justify reopening or merely monitoring?
- What should be verified before a new Partner meeting or IC review?

Possible actions:

- founder re-engagement draft;
- fresh diligence checklist;
- internal second-look memo;
- request for current round terms and operating metrics.

### 10.2 Watchlist

The report must answer:

- Which milestone was the fund waiting for?
- Was it achieved, contradicted, or left unresolved?
- Should the company advance, remain watched, or be deprioritized?

Possible actions:

- status-update recommendation;
- milestone verification request;
- Partner review scheduling draft;
- remove/deprioritize rationale when evidence is negative.

### 10.3 Invested: positive

The report must answer:

- Which original portfolio thesis strengthened?
- Did performance exceed the original Bear/Base/Bull expectations?
- Is follow-on consideration justified at the current price?
- What reserve, concentration, dilution, and ownership questions remain?

Possible actions:

- follow-on evaluation memo;
- management update request;
- customer/reference checks;
- reserve-allocation and ownership analysis.

### 10.4 Invested: negative

The report must answer:

- Which original investment thesis weakened or broke?
- Is the issue temporary, company-specific, or structural?
- What evidence would reverse the negative update?
- Should the fund pause follow-on, increase monitoring, or begin risk action?

Possible actions:

- stop/pause follow-on recommendation;
- board or management question draft;
- customer-loss, runway, regulatory, or competitive-risk review;
- portfolio-risk escalation memo.

Formal underwriting labels remain `Pass / Watch / Advance / Invest Candidate`.
The status-aware portfolio action is a separate layer and must not falsely
describe an already-invested company as if it were a first-time Deal.

## 11. Required report output

The top-level narrative must answer the user's desired three questions:

1. **What happened?**
2. **What is the impact?**
3. **What can the investor do?**

Each selected company report must include:

1. Executive summary and updated recommendation.
2. Verified company and founder snapshot.
3. Clearly labeled Sample decision record.
4. Prior status, decision reason, concerns, and revisit conditions.
5. Recent event timeline with exact dates and sources.
6. `Then versus Now` comparison.
7. Explicit causal analysis of the belief change.
8. Positive effects, negative effects, counterevidence, and unknowns.
9. Current traction, funding, customer, and market evidence.
10. Market/capital-flow implications where evidence exists.
11. Valuation and terms compared with deterministic Bear/Base/Bull outputs.
12. Clear separation of Fact, Assumption, Calculation, and model inference.
13. Eight core framework judgments.
14. Every applicable approved named advisory viewpoint with its own sources,
    applicability, support, counterargument, unknowns, limitations, five
    confidence dimensions, and disagreements.
15. Company Quality, Price Attractiveness, and Fund Fit.
16. Fired rules, decision ceiling, formal decision, and Decision Confidence.
17. Status-specific recommended actions and missing-evidence requests.
18. Draft-only Email, SMS, LinkedIn, internal memo, and DD request where
    appropriate.
19. Complete source lineage and clickable source links.

The report must remain complete when data is missing. It should display
`Unavailable`, the reason, and the decision impact rather than inventing a
number. Market defaults can support scenarios but cannot masquerade as actual
company performance.

## 12. Integration requirements

### 12.1 Do not use presentation-only profiles as analysis input

`app/deal-profiles.ts` contains display-only sample values. Those values must
not enter Deal memory, XTrace, matching, Evidence Packs, valuation, or formal
decisions.

### 12.2 Preserve the original 19-Deal corpus

The existing files are defined in:

- `seed/manifest.json`
- `lib/corpus/manifest.ts`
- `lib/corpus/evidence.ts`
- `lib/corpus/fixtures.ts`
- `scripts/seed-demo.ts`

The new cases must not overwrite or relabel the original 19. Prefer a separate,
versioned reversal-demo manifest/seed package that converges into the same
authoritative Company, Deal, source-revision, source-evidence, and interaction
tables. If shared loaders are generalized, update the fixed-corpus tests and
documentation without erasing the distinction between original supplied
documents and new research cases.

The current manifest parser hard-validates 14 documents with role counts
9 deal / 4 market / 1 reference, and the import-confirmation copy still assumes
the original fixed input set. Do not append files without updating every
cardinality invariant and regression test. Runtime upload confirmation is not
an adequate replacement by itself because it creates no synthetic prior Deal
interaction.

The current run-readiness gate also requires the original supplied corpus to be
imported. A separate reversal-demo seed must coexist with that gate or replace
it only through an explicitly reviewed product change; it must not make the
existing import flow appear complete when required original sources are absent.

### 12.3 Use the authoritative registry path

New companies must be real Deal Registry entries with:

- Company and Deal identity;
- exact active source revisions;
- source-to-Deal assignments;
- source evidence items;
- a `Sample decision record` interaction;
- analysis eligibility;
- XTrace ingest job and exact lineage link.

Do not add an in-memory-only fallback. Web and Worker must see the same
PostgreSQL data.

Relevant implementation references:

- `db/repositories/deal-registry.ts`
- `db/repositories/source-registry.ts`
- `db/repositories/xtrace-lineage.ts`
- `db/repositories/evidence-packs.ts`
- `scripts/seed-demo.ts`
- `lib/xtrace/service.ts`

### 12.4 Feed the real matching path

Public evidence must become normalized `MarketEvent` records and go through:

- deduplication and 14-day filtering;
- grounded Claude matching;
- deterministic overlap validation;
- confidence scoring;
- CompanyAnalysis generation;
- Top 5 selection.

Do not directly insert a final CompanyAnalysis or finished report as a
substitute for the pipeline. Test fixtures may assert expected output, but the
demo run must execute the real path.

There is currently no deterministic public-evidence fixture/API. Live
CompanyAnalysis evidence comes from classified providers inside the 14-day
window. A pinned replay therefore requires a new explicit, immutable,
date-labelled evidence-snapshot path; a bundled baseline market report cannot
silently stand in for `public_web` evidence.

### 12.5 Execute the complete underwriting path

Selected medium/high `belief_revised` cases must run through:

```text
context_router
→ evidence_pack
→ valuation
→ framework_catalog
→ framework_lenses
→ decision
→ narrative_drafts
→ finalization
```

All eligible Deals retain CompanyAnalysis. Deals outside the Top 5 are saved as
`not_selected`, which is not a `Pass` decision.

Top 5 is derived, not assignable. The new cases are not allowed to bypass
ranking. If existing Deals legitimately outrank a proposed case, strengthen
the case with genuine missing evidence, replace it, or use a truthful isolated
snapshot/workspace for the report-quality demo. Never write a selected rank
directly.

### 12.6 Make full actions status-aware

The current high-level CompanyAnalysis next-step policy is status-aware, but
the full underwriting action-draft generator must also receive the Deal status
and belief-change direction. It must generate portfolio-specific language for
invested cases and must not reuse a generic first-time founder follow-up when
risk escalation is the supported action.

Relevant references:

- `lib/reports/next-step-policy.ts`
- `lib/underwriting/action-drafts.ts`
- `lib/underwriting/orchestrator.ts`

## 13. Suggested implementation sequence

1. Create a candidate-research ledger and screen broadly from current events.
2. Select only the 3–5 qualifying cases and record rejected candidates with
   reasons.
3. Complete each real public source catalog and source-backed fact set.
4. Author the clearly labeled synthetic decision records.
5. Create a separate versioned reversal-demo seed package.
6. Seed authoritative source revisions, Deal assignments, canonical
   `source_evidence_items`, and interactions idempotently. Cloning only the
   original legacy `source_evidence` fixture pattern is insufficient for full
   underwriting.
7. Ingest the exact bundles into XTrace and verify lineage.
8. Normalize and persist the recent public events or pinned demo snapshot.
9. Run real matching and inspect all four score dimensions.
10. Replace any low-confidence case instead of weakening the gate.
11. Run Top 5 selection and full underwriting.
12. Add status-aware action synthesis for passed, watchlist, invested-positive,
    and invested-negative cases.
13. Validate Reports, Deals, Market, Sources, Chat, source links, and drafts.
14. Run automated verification and a manual end-to-end demo.
15. Only after review, seed/deploy to the public sandbox and repeat smoke tests.

## 14. Required tests and acceptance criteria

### 14.1 Research acceptance

- 3–5 companies are real and outside the original 19.
- At least one `passed`, one `watchlist`, and one `invested` case exists.
- Prefer both an invested-positive and invested-negative case.
- Each case has at least one primary or authoritative source, or a documented
  reason why equivalent corroboration is sufficient.
- Every real claim has a source, date, and locator/excerpt.
- Every simulated VC interaction is labeled `Sample decision record`.
- No simulated interaction is presented as a real meeting.
- Each case has a real decision/action delta and medium/high Match Confidence.
- Counterevidence and data gaps are retained.

### 14.2 Data and lineage acceptance

- Seeding is idempotent.
- Every new source has an immutable revision and checksum/fingerprint.
- Every source assignment resolves to the same workspace, Deal, document, and
  revision.
- XTrace memory links resolve back to exact local source lineage.
- An unresolved XTrace child/parent ID fails only the affected Deal closed; it
  must not contaminate another Deal.
- Presentation-only sample profiles never appear in memory or Evidence Packs.

### 14.3 Matching acceptance

- All eligible Deals receive CompanyAnalysis.
- Each selected demo case is `belief_revised` with medium/high confidence.
- The report displays all four score dimensions and the final threshold.
- Low matches remain `monitor`; no evidence becomes `no_material_change`;
  failures become `analysis_unavailable`.
- The Top 5 contains only medium/high grounded revisions.
- Ranking after five is `not_selected`, never automatically `Pass`.
- Every `whyNow`, prior-context statement, and implication has valid lineage.

### 14.4 Underwriting acceptance

- Every selected candidate reaches a truthful terminal status.
- Missing minimum inputs produce `unavailable`, not invented outputs.
- Bear/Base/Bull contain exactly one of each scenario and preserve lineage.
- Current ask, modeled value, ownership, dilution, MOIC, and IRR appear only
  when supported by Fact/Assumption/Calculation lineage.
- All applicable core and named advisory judgments appear independently.
- Named advisory sources, versions, applicability, support, counterarguments,
  unknowns, limitations, confidence dimensions, and disagreements are visible.
- Named advisory formal decision weight remains zero.
- The formal decision shows the three dimensions, ceiling, confidence,
  blockers, and fired rules.

### 14.5 Status-action acceptance

- Passed case recommends reopen/monitor based on evidence.
- Watchlist case recommends advance/remain/deprioritize based on evidence.
- Invested-positive case can recommend follow-on evaluation.
- Invested-negative case can recommend pause/stop follow-on and risk review.
- Drafts are editable and copyable but never sent automatically.
- Founder-facing drafts never expose internal-only commentary unnecessarily.
- Internal memo retains the full decision and evidence requests.

### 14.6 UI and Chat acceptance

- Deals shows the correct prior status and Sample decision label.
- Market shows the trigger event with date, confidence, and source.
- Reports shows Then/Now, implications, decision, and actions.
- Underwriting detail exposes every required section and source trace.
- The UI exposes the full 17-field scenario model, Evidence Pack
  coverage/conflicts, and pricing premium when those artifacts exist; current
  partial rendering is a known gap to close for a "complete" report review.
- Source links resolve to the expected public URL or authorized revision.
- Chat answers only from finalized artifacts and cites the same sources.
- Existing 19 Deals and prior reports continue to work.

### 14.7 Automated verification

At minimum run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Run PostgreSQL-backed integration and migration gates when the implementation
changes persistence or migrations. Use disposable databases only:

```bash
npm run test:migrations
npm run test:migrations:production-pg176
```

Do not use production as a test database.

## 15. Demo walkthrough acceptance

The final manual demonstration should show:

1. the source and clearly labeled prior sample decision for each case;
2. a recent real market/company event;
3. the AI connecting the event to the exact historical concern;
4. medium/high confidence and its evidence basis;
5. all three prior statuses in one report set;
6. both positive and negative portfolio implications where selected;
7. full company underwriting with honest unavailable fields;
8. named advisory viewpoints and disagreements;
9. final decision plus status-aware action;
10. a draft Email/internal memo/DD request without sending it;
11. Chat answering a question from the finalized report and sources;
12. a repeat run returning the same judgment while evidence is unchanged.

Suggested demo questions:

- Why did we originally pass on this company?
- Which new evidence changed that belief?
- What is the strongest counterargument?
- Why is this match medium or high confidence?
- Which investor frameworks disagree, and why?
- Is the current valuation attractive under Bear/Base/Bull?
- What evidence is still missing before IC consideration?
- For the invested company, should we consider follow-on or begin risk action?

## 16. Explicit non-goals

This task does not authorize:

- inventing real traction, funding, customers, valuations, or Founder quotes;
- presenting simulated meetings as real;
- weakening confidence thresholds to force a Top 5;
- hardcoding a final report instead of running the pipeline;
- using hidden chain-of-thought as product output;
- promoting draft investor-framework research into formal decision authority;
- automatic Email, SMS, or LinkedIn sending/publishing;
- changing the original 19 companies into the new cases;
- silently extending underwriting to unsupported sectors/stages;
- deploying unreviewed database changes or mutating production during research;
- implementing the separate English/Traditional-Chinese localization feature,
  which is intentionally handed off in a different task.

## 17. Known constraints and risks

1. Public private-company metrics are often incomplete. Missing data must
   lower the decision ceiling rather than become synthetic Fact.
2. A trigger event expires from the live 14-day window. Use clearly labeled
   pinned replay for repeatable demos or refresh the research cases.
3. XTrace may return derived memory IDs that lack locally verifiable parent
   lineage. Preserve fail-closed behavior for the affected Deal.
4. The current deepest valuation context is Seed/Series A B2B SaaS and
   Enterprise AI. Other contexts require explicit implementation work.
5. Current named advisory framework research remains draft/unpublished and
   formally advisory, even though its individual opinions are executed and
   displayed.
6. Production environment hardening is tracked separately. Perform research
   and integration locally until the relevant production baseline is reviewed.
7. The full chain is visible only in durable `public_sandbox` or authenticated
   product mode. Read-only `public_demo` does not expose persisted underwriting
   artifacts or action drafts.
8. Expanding from 19 to 22–24 eligible Deals increases XTrace recall volume.
   Verify the actual API-key rate limit, bounded concurrency, retry behavior,
   and total run budget rather than relying on an old quota assumption.

## 18. Deliverables from the receiving task

The receiving task is complete only when it delivers:

1. a candidate ledger showing accepted and rejected companies with reasons;
2. 3–5 selected real-company research packages;
3. one clearly labeled synthetic prior decision record per company;
4. versioned, idempotent seed/integration data;
5. real public-event inputs or a clearly labeled pinned evidence snapshot;
6. status-aware report and action behavior;
7. automated tests and verification output;
8. a completed end-to-end local demo run;
9. screenshots or a concise QA record for all three status classes;
10. an explicit list of any remaining blocker before public-sandbox deployment.

## 19. New-task kickoff instruction

In the new Codex window, provide this instruction:

> Read `docs/superpowers/specs/2026-08-01-belief-reversal-demo-company-research-handoff.md` completely. Treat it as the authoritative product requirement and handoff for this task. First audit the current branch and confirm the working tree; then research recent events before selecting companies. Do not preselect startups, lower the confidence threshold, invent public facts, or modify production. Continue through research, integration, tests, local end-to-end validation, and a final QA report, stopping only for a genuinely product-changing ambiguity or a required external credential/authorization.
