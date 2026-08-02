# English / Traditional-Chinese Localization Continuation Handoff

**Status:** Partial design approval; implementation is explicitly paused

**Date:** 2026-08-01

**Audience:** The next Codex task or engineer continuing localization design

**Repository:** `CoKayne/XTrace_Hackathon`

**Working branch at handoff:** `feat/backend-integration-checkpoint`
**Related company-research handoff:**
[`2026-08-01-belief-reversal-demo-company-research-handoff.md`](2026-08-01-belief-reversal-demo-company-research-handoff.md)

## 1. Read this first

This is a **separate localization handoff**. It is intentionally not merged
into the belief-reversal demo-company research specification.

The two tracks have different approval states:

- The company-research and integration track is ready to begin from its own
  handoff.
- The localization track is **not ready for implementation**. Product design
  rounds 1–5—architecture, UI behavior, coverage, translation lifecycle, and
  Confidence Methodology—were approved. Design round 6 was presented but not
  approved. Acceptance/testing and final scope/non-goals have not yet been
  presented or approved. The complete written localization design has also not
  received a final user review.

The receiving agent must preserve that distinction. It may work on the
approved company-research track immediately, but it must resume localization
clarification at Section 14 of this document before changing localization
code, database schema, tests, or production.

If the company-research track changes report, Evidence Pack, action, or UI
contracts first, localization must re-audit those final schemas before writing
artifact adapters or content hashes. Translation must not fabricate report
fields that the company integration has not implemented.

## 2. Product context

VSee is a source-grounded VC decision-intelligence Web App. Its current output
chain includes:

- confirmed Deal sources and long-term decision memory;
- recent market events and belief-change matching;
- CompanyAnalysis and ranked Top 5 opportunities;
- Bear/Base/Bull underwriting and deterministic valuation;
- named VC/investor framework opinions and disagreements;
- formal `Pass / Watch / Advance / Invest Candidate` decisions;
- internal reports, Chat answers, and draft-only next actions.

Localization is a presentation capability over these artifacts. It must not
create a second investment-analysis system or alter the canonical evidence and
decision chain.

## 3. Exact approval state

| Design area | State | Receiving-agent rule |
|---|---|---|
| Architecture and canonical-data policy | **Confirmed** | Treat as binding |
| Language entry point and Confidence UX | **Confirmed** | Treat as binding |
| Translation coverage and source handling | **Confirmed** | Treat as binding |
| Translation lifecycle, cache, Chat, and drafts | **Confirmed** | Treat as binding |
| Confidence Methodology content and placement | **Confirmed** | Treat as binding |
| Loading, errors, security, accessibility | **Proposed, not confirmed** | Present once and ask for approval |
| Acceptance and test matrix | **Not yet presented** | Propose next, then ask for approval |
| Final scope and explicit non-goals | **Not yet presented** | Propose next, then ask for approval |
| Complete written localization spec | **Not yet reviewed** | Write only after the above approvals |
| Localization implementation | **Not authorized yet** | Do not begin |

If a later user answer conflicts with this handoff, the later explicit answer
wins. Record that change in the final design instead of silently combining
incompatible rules.

The approval-state audit was reconstructed from the local Codex session at:

`/Users/wuyuhan/.codex/sessions/2026/07/21/rollout-2026-07-21T20-00-12-019f87c4-3e11-7e42-b72c-0e10817fa712.jsonl`

The relevant decisions occurred around 2026-08-02 03:44–03:54 UTC. This
handoff, not an older summary, records which proposal received a following
user approval and which proposal did not.

## 4. Confirmed design 1: canonical bilingual architecture

The approved approach is the hybrid bilingual architecture:

```text
Original-language Evidence + Deal Memory
                    ↓
    One English-default Canonical Analysis Chain
                    ↓
  Translation-specific Content Hash / Version
                    ↓
      Traditional-Chinese Presentation Cache
```

Binding rules:

1. There is one canonical investment-analysis version, whose generated report
   language is English by default. Original-language evidence remains canonical
   in its original language, including Chinese source excerpts.
2. Traditional Chinese is a faithful presentation derivative, not a new
   investment inference.
3. Switching language must not rerun Market Scan, matching, valuation,
   underwriting, framework analysis, or the formal decision engine.
4. Chinese presentation must not change:
   - company, Founder, Partner, or institution identity;
   - amounts, percentages, dates, valuations, or calculations;
   - formal decisions or Confidence values;
   - Deal, Fact, Claim, Source, report, run, or artifact IDs;
   - URLs, source order, citation relationships, or lineage;
   - individual framework conclusions or disagreements.
5. Human-readable labels may be translated, but canonical enum values remain
   unchanged. For example, the UI may show `投資候選案` while the stored value
   remains `Invest Candidate` under the current contract.
6. Framework disagreement must remain disagreement. Translation must never
   compress several opinions into a fabricated consensus.
7. Returning to English always displays the original canonical artifact.
8. A translation failure affects only Chinese presentation. It cannot change
   or invalidate the English report, scan, underwriting, decision, or draft.

## 5. Confirmed design 2: entry point and language preference

The site remains English by default.

The approved primary control is a persistent switch in the top-right corner of
the site:

```text
EN | 中文
```

Approved behavior:

- The first visit defaults to English.
- The choice is retained in the user's browser across refreshes and later
  visits.
- A future authenticated product may move this to a per-user cloud preference;
  that future migration is not part of the current approval.
- Static UI labels switch immediately.
- Dynamic content that lacks a Chinese cache enters a translation loading
  state instead of rerunning the analysis.
- Translation failure falls back to English and offers a retry action.

The behavior of browser persistence is approved, but the exact mechanism
(`localStorage`, cookie, or another browser-scoped mechanism) is not yet a
product decision. Current tests explicitly reject `localStorage` use on the
main page, so implementation must either update that test deliberately or use
another browser-scoped mechanism after the final design is approved.

## 6. Confirmed design 3: complete translation coverage

### 6.1 Static application UI

The following must support English and `zh-TW`:

- Overview;
- Deals;
- Sources;
- Fund Policy;
- Market;
- Reports;
- Chat;
- Settings;
- global navigation and headers;
- buttons, dialogs, forms, filters, status labels, and empty states;
- loading, error, and success messages;
- date and number presentation;
- accessibility labels.

Examples already accepted:

- `Wake Agent & Scan Market` → `啟動 Agent 並掃描市場`;
- `Belief Revised` → `投資信念已改變`;
- `No Material Change` → `沒有重大變化`;
- `Invested` → `已投資`.

Static UI text uses code-owned English and Traditional-Chinese dictionaries.
It does not call an LLM. TypeScript must detect missing or mismatched keys.

### 6.2 Generated application content

The following dynamic artifacts are in scope for faithful translation and
cache reuse:

- Market Summary;
- CompanyAnalysis;
- Then/Now comparisons;
- Why Now;
- positive and negative implications;
- Recommended Next Move;
- full underwriting reports;
- Bear/Base/Bull narratives;
- financial-model explanations;
- valuation comparisons;
- formal conclusion presentation;
- missing information, counterevidence, uncertainty, and limitations;
- every applicable VC/investor framework opinion;
- framework disagreements and abstentions;
- internal Report Draft;
- Chat presentation text;
- Confidence explanations.

### 6.3 Values that do not change

These values remain identical across languages:

- proper names;
- canonical identifiers;
- monetary values, percentages, valuation results, and financial calculations;
- source URLs and source order;
- dates as facts, even if their display format changes;
- formal decision and status enum values;
- Confidence enum values and numeric scores;
- evidence, claim, and source lineage.

## 7. Confirmed source and user-input policy

Original evidence must never be overwritten by a translation.

Binding rules:

- News, Pitch Decks, uploaded files, and Founder quotes retain their original
  content.
- In Chinese mode, cited evidence displays the original excerpt together with
  its Chinese translation.
- The original excerpt remains the citation and mechanical-grounding authority.
- The translated excerpt is presentation-only and cannot satisfy an exact
  source-text check.
- User-authored Fund Policy and notes remain in their original language inside
  editable fields.
- A report may show a translation of user-authored content, but the original
  must remain expandable and inspectable.
- A translation never becomes a new Fact, Claim, MarketEvent, Deal memory, or
  XTrace memory.
- Translation never replaces the original source revision or lineage.

The following is a technical constraint derived from the current code rather
than an additional user-approved product rule: several existing services verify
claims against exact source text. A future translated presentation must keep at
least these distinct values:

```text
canonicalClaimText
canonicalSourceExcerpt
translatedPresentationText
sourceIds
```

The translated text must never overwrite `canonicalClaimText` or the field
currently used as the exact source excerpt.

## 8. Confirmed translation lifecycle and cache

### 8.1 Static content

- Static UI translations are code-owned and version-controlled.
- English and `zh-TW` dictionaries have identical typed keys.
- Missing translation keys are not silently replaced by unrelated text.

### 8.2 Dynamic artifacts

Existing reports and future reports are both translated on demand the first
time their Chinese presentation is requested. Each artifact uses one canonical
inference chain with English-default generated narrative while preserving any
original-language evidence:

```text
English canonical artifact
        ↓
Canonical content fingerprint
        ↓
Matching zh-TW cache exists?
   ├─ Yes → display the validated cache
   └─ No  → translate structured fields → validate → persist → display
```

The translation service receives structured translatable fields rather than
an instruction to rewrite the whole report. The following are conceptual
adapter outputs; they are not claims that the current contracts contain literal
`bearCase`, `baseCase`, or `bullCase` text fields:

```text
whyNow
previousContext
positiveImplications
negativeImplications
bearCase
baseCase
bullCase
frameworkConclusions
frameworkDisagreements
finalConclusion
```

Non-translatable fields include:

```text
companyName
amounts
percentages
dates
decision
confidence
factIds
claimIds
sourceIds
URLs
```

Validation rejects the translated artifact if IDs, numbers, citation
relationships, required fields, or protected values differ from the English
canonical artifact.

### 8.3 Minimum cache record

Each cached translation must record at least:

- artifact type;
- canonical artifact ID;
- canonical version or content fingerprint;
- target locale `zh-TW`;
- translation status;
- translated structured content;
- creation and update timestamps;
- failure reason. Sanitizing provider details before browser display remains
  part of the unconfirmed Section 14 security proposal.

Concurrent requests for the same artifact, fingerprint, and locale must not
create duplicate translation work.

### 8.4 Invalidation

When the English canonical report, manually edited content, or action-draft
body changes:

- its fingerprint changes;
- the prior Chinese cache no longer qualifies as current;
- English remains available;
- the next Chinese request creates or retrieves a translation for the new
  fingerprint;
- stale Chinese conclusions must not be presented as current.

### 8.5 Model boundary

- Reuse the configured server-side Anthropic client.
- Do not hardcode a particular Anthropic model name inside localization.
- The translation prompt permits faithful translation only.

The following are security requirements derived from the repository's existing
untrusted-input model, not separately approved product choices:

- Treat uploaded text, public-source text, reports, and excerpts as untrusted
  data. Ignore instructions embedded inside artifact content.
- Require strict structured output and protected-field validation before any
  translated presentation becomes readable.

The approved model boundary continues:

- The model cannot add analysis, repair investment logic, improve a conclusion,
  remove uncertainty, or resolve framework disagreement.
- Translation errors do not block upstream product workflows.

## 9. Confirmed Chat behavior

- Chat still queries completed, canonical application artifacts only.
- Users may ask in English or Chinese regardless of the current interface
  language.
- English mode answers in English.
- Chinese mode answers in Traditional Chinese.
- Both modes use the same Facts, reports, sources, and XTrace memory.
- Switching language does not create a second investment memory.
- A Chinese answer must preserve the canonical claim and source IDs while
  carrying a separate translated presentation string.

Because current retrieval is primarily lexical, accepting a Chinese question
over English evidence requires a bounded query-language bridge or multilingual
retrieval step. The original user query must be retained; any translated or
normalized retrieval query is search metadata, not evidence and never a
citation. Retrieved canonical evidence remains subject to the existing
grounding rules before localized answer presentation.

Current Chat uses exact claim/evidence equality checks. Directly replacing an
English claim with Chinese text would break that guarantee. The implementation
design must therefore separate canonical answer claims from localized display
text rather than weakening exact-evidence validation.

Whether already-visible Chat history is retrospectively translated after a
locale switch remains unconfirmed; see Section 17.

## 10. Confirmed action-draft exception

Founder-facing Email, SMS, and LinkedIn draft language is independent from the
global site locale.

Approved rules:

- Founder Email, SMS, and LinkedIn drafts have their own
  `English / 繁體中文` selection. The original motivation was to keep Founder
  outreach independent from the investor's UI language.
- A user in the Chinese UI can still create English Founder outreach.
- Translating a draft does not change the audience, company, recommended
  action, or citations.
- Drafts remain copy-only and human-sent; the application does not send or
  publish them.
- After manual editing, only the latest body needs to be saved.
- The other language does not have to auto-synchronize after an edit.

The current handoff therefore does not require simultaneously persisted,
independently editable English and Chinese bodies for one draft. The single
latest selected/generated/edited body remains authoritative for that draft;
locale-tagged translation-cache content is a derivative, not a second editable
draft record.

The current body must carry explicit `bodyLocale` metadata and a content hash.
Editing and saving in another language makes that body and locale the new
single current version. Switching back does not resurrect an older superseded
body: it uses a valid translation derived from the current-body hash or creates
one. The translation itself remains presentation-only until the user saves it
as the current editable body.

The language behavior of internal memos and diligence-request artifacts, and
the default language for a newly created Founder-facing draft, have not yet
been approved. They must remain explicit open decisions.

## 11. Confirmed Confidence Methodology

The product must distinguish four different kinds of Confidence:

1. **Event Confidence** — reliability of a public event based on authority,
   directness, corroboration, and recency.
2. **Match Confidence** — strength of the connection between recent evidence
   and a historical belief, concern, or revisit condition.
3. **Decision Confidence** — completeness of evidence supporting the formal
   underwriting conclusion across Company Quality, Price Attractiveness, Fund
   Fit, and critical-evidence coverage.
4. **Framework Confidence** — separate source reliability, evidence strength,
   coverage, applicability, and judgment-confidence dimensions for each
   framework.

### 11.1 Match Confidence formula

| Dimension | Weight |
|---|---:|
| Event relevance | 35% |
| Deal relevance | 30% |
| Prior decision-context strength | 20% |
| Evidence quality | 15% |

Thresholds:

- High: `78%–100%`;
- Medium: `50%–77%`;
- Low: below `50%`.

Required general warning in both languages:

> Confidence describes the strength and completeness of the evidence
> supporting a specific judgment. It is not the probability that the company
> will succeed, and it is not an investment approval.

Required Match-specific wording:

> Confidence measures how strongly the cited evidence supports a change in the
> fund's prior belief. It is not the probability that the company will succeed,
> and it is not an investment approval.

Approved Chinese meaning:

> 信心表示特定判斷所依據之證據強度與完整程度。它不是公司成功的機率，也不代表投資已獲批准。

### 11.2 Placement

The explanation appears in:

- an `ⓘ` control beside every Confidence badge;
- an expandable `How confidence works` section on Reports;
- a Methodology section in Settings;
- an explicit `Decision Confidence` label beside the final underwriting
  conclusion.

The Confidence Methodology is manually maintained in both languages. It is not
translated ad hoc by the LLM.

### 11.3 Event, Decision, and Framework definitions

Event Confidence uses these approved meanings:

- High: direct primary or official evidence with strong attribution;
- Medium: credible, traceable evidence with some incomplete details;
- Low: indirect, weakly corroborated, or incomplete evidence.

Known implementation gap: current Market providers largely assign fixed
confidence values rather than calculating authority, directness,
corroboration, and recency. Before publishing this Methodology as current
product behavior, implementation and tests must align Event Confidence with
the approved definition or label the existing provider value more narrowly.

Decision Confidence uses these approved meanings:

- High: critical evidence is complete and Company Quality, Price
  Attractiveness, and Fund Fit are all assessable;
- Medium: coverage is partial but decision-relevant;
- Low: required decision evidence is largely unavailable.

Framework Confidence must show these five dimensions separately:

- source reliability;
- evidence strength;
- evidence coverage;
- framework applicability;
- judgment confidence.

They must not be averaged into a misleading single score.

### 11.4 Selection explanation

The site must explain:

```text
Recent event
    ↓
Verified connection to historical Deal memory
    ↓
Material effect on a prior belief or next action
    ↓
Medium / High Match Confidence
    ↓
Top 5 and full-underwriting eligibility
```

It must also explain:

- Low confidence → Monitor;
- no relevant evidence → No material change;
- missing verified memory or failed analysis → Analysis unavailable;
- medium/high belief revision → eligible for Top 5;
- not selected for Top 5 → not an automatic Pass.

## 12. Confirmed initial VC glossary

Use a versioned, consistent glossary. The accepted initial examples are:

| English | Traditional Chinese |
|---|---|
| Deal Flow | 案源流 |
| Follow-on | 追加投資 |
| Watchlist | 觀望名單 |
| Due Diligence | 盡職調查 |
| Investment Committee / IC | 投資委員會／IC |
| Invest Candidate | 投資候選案 |
| Founder-Market Fit | 創辦人與市場契合度 |

The first occurrence may show English and Chinese together. Subsequent uses
should remain consistent. Expanding the glossary is an implementation/design
task, but changing an accepted term is a product change that must be recorded.

## 13. Current repository reality

No product localization implementation currently exists.

### 13.1 UI

- `app/layout.tsx` fixes the root document language to `en`.
- `app/page.tsx` hardcodes English navigation, status labels, controls, errors,
  loading text, and notices.
- The header has Reset, XTrace, and Scan controls but no locale control.
- Current URL state reads report/view information, not a locale.
- Dates and money are formatted with English/`en-US` behavior.
- No i18n package, locale provider, typed dictionary, or locale state exists.

Primary UI surfaces with hardcoded English include:

- `app/page.tsx`;
- `app/company-intelligence.tsx`;
- `app/underwriting-summary.tsx`;
- `app/underwriting-detail.tsx`;
- `app/report-draft-dialog.tsx`;
- `app/action-draft-dialog.tsx`;
- `app/fund-policy.tsx`.

### 13.2 Persistence and HTTP contracts

- Workspace and session records do not store locale.
- Intelligence reports store one canonical report.
- Underwriting narrative and action-draft records store one body without
  locale/version metadata.
- Chat, run, report, underwriting, and action-draft endpoints do not accept or
  return locale.
- The application does not read `Accept-Language` or emit `Content-Language`.
- No translation-cache table, repository, job, API, or authorization rule
  exists.

Relevant files include:

- `db/schema.ts`;
- `lib/contracts/http.ts`;
- `lib/contracts/underwriting.ts`;
- `app/api/chat/route.ts`;
- `app/api/reports/route.ts`;
- `app/api/reports/[id]/underwriting/[dealId]/route.ts`;
- `app/api/action-drafts/route.ts`;
- `app/api/action-drafts/[id]/route.ts`.

### 13.3 Generated content

The following are English-default and not localization-controlled. Original
Chinese source text may still propagate through exact excerpts:

- Claude matching prompts and output contracts;
- CompanyAnalysis fallback and next-step strings;
- deterministic internal Report Draft;
- underwriting narrative;
- named-framework prompts and public advisory rendering;
- all action-draft templates;
- Chat fallback messages and answer presentation.

Translation must wrap canonical artifacts after generation; it must not add a
locale to the formal decision engine and cause two independent decisions.

### 13.4 Input-language capability is not localization

- Uploaded TXT can contain UTF-8 Chinese.
- PDF, DOCX, and image extraction can produce Unicode text.
- Image extraction explicitly transcribes rather than translates.
- Search tokenization accepts Unicode letters, but Chinese text without spaces
  is not reliably segmented.
- Market classification is primarily English-pattern based.

These facts do not mean Chinese search, Chinese market classification, or
Chinese report presentation is implemented.

### 13.5 Tests

Current tests assert English labels and narratives. No locale-switch,
translation-cache, Chinese report, or bilingual E2E tests exist. One UI
hardening test currently forbids `localStorage` on the main page; that test and
the chosen browser-preference mechanism must be reconciled explicitly.

## 14. Next confirmation 1: remaining loading, security, and usability rules

**Approval state: proposed but not yet confirmed.**

The previous task ended immediately after presenting a broader proposal. Some
items inside it had already been approved in earlier sections. Do **not** ask
the user to reconfirm these binding rules:

- static UI switching is immediate;
- original evidence displays original text plus Chinese translation;
- failure falls back to English and offers `Retry translation`;
- the failure notice includes `Chinese translation unavailable`;
- translation failure does not change analysis state;
- IDs, values, enums, decisions, citations, and lineage cannot change;
- the model cannot add new investment opinions.

Present only the unresolved items below and ask whether they are approved before
moving to Section 15.

### Unconfirmed loading behavior

- If a dynamic artifact has no Chinese cache, only that artifact's content
  region shows a translation loading state; the whole site remains usable.
- A dynamic artifact changes languages atomically so one report is not half
  English and half Chinese.

### Unconfirmed failure-detail handling

- Store a safe failure reason server-side without exposing API keys or
  sensitive provider errors to the browser.

### Security and authorization

- The Anthropic API key remains server-side.
- Translation has the same authorization boundary as the canonical artifact.
- A user who cannot access the English artifact cannot fetch its translation.
- Translation endpoints accept an authorized artifact ID and load canonical
  content server-side; they do not accept arbitrary server content supplied by
  the browser.
- Translation cache keys and reads preserve workspace/organization isolation.

### Accessibility and navigation

- The locale switch is keyboard operable and has an accessibility label.
- Language and Confidence states are not communicated by color alone.
- The locale entry point remains visible on desktop and mobile.
- Shared report URLs may carry `?lang=zh-TW`; without a locale parameter, use
  the retained browser preference and then the English default.
- Switching language preserves the current route, company, report, and visible
  context rather than navigating to Overview.

## 15. Next confirmation 2: proposed acceptance and test matrix

**Approval state: not yet presented or confirmed.**

After Section 14 is approved or revised, the receiving agent should present a
concise acceptance matrix based on the following recommended baseline.

### Static UI

- Every user-visible route and shared component renders in `en` and `zh-TW`.
- Typed dictionary key parity prevents missing production labels.
- No raw translation key appears in rendered UI.
- English remains the first-visit default.
- Browser preference persists across refresh and return visits.
- An explicit URL locale, if approved, takes precedence for that shared view.
- Locale switch preserves the current view and selected artifact.
- Root document language and accessibility labels match the visible locale.

### Canonical-artifact invariants

- Locale switching does not create a new scan, match, valuation, underwriting,
  framework judgment, formal decision, or XTrace memory.
- Protected IDs, numbers, dates, decisions, Confidence, source order, and
  lineage remain byte-for-byte or structurally identical as appropriate.
- Translated text cannot satisfy exact-source grounding.
- Framework disagreement, counterevidence, unknowns, and limitations remain
  present.

### Translation cache

- First Chinese request creates one translation for the canonical fingerprint.
- Subsequent requests reuse it.
- Concurrent requests do not duplicate work.
- Canonical changes invalidate eligibility of the old cache.
- Failed validation publishes no Chinese artifact.
- Provider failure returns English with a retry path.
- Cross-workspace reads fail.

### Reports and sources

- Market, CompanyAnalysis, underwriting, scenarios, valuation explanation,
  framework output, final conclusion, and internal Report Draft all support
  Chinese presentation.
- Every translated citation still resolves to the canonical source.
- Chinese source presentation shows original excerpt plus translation.
- Original files and user-authored editable fields remain unchanged.

### Chat

- English and Chinese questions work independently of UI locale.
- Response presentation follows the selected locale.
- Canonical claims and evidence equality remain intact.
- Chinese presentation carries the same source IDs.
- Insufficient-evidence and XTrace-unavailable states are localized without
  changing their semantics.

### Action drafts

- Draft language selection is independent of global locale.
- Both draft languages preserve audience, company, action, and citation data.
- Editing saves the latest body according to the approved single-body behavior.
- No locale path can send or publish a draft.

### Manual and production verification

- Test desktop and mobile entry points.
- Test refresh, a return visit, deep-linked reports, and an approved shared
  `?lang` link.
- Test cache miss, hit, invalidation, provider failure, retry, and unauthorized
  access.
- Review at least one complete report with Bear/Base/Bull, named-framework
  disagreement, citations, and draft actions in both languages.
- Run the full automated suite, typecheck, lint, build, migration tests when a
  cache schema is added, and post-deployment smoke tests.

The user may approve, remove, or revise this matrix. Do not treat this section
as binding until that happens.

## 16. Next confirmation 3: proposed final scope and explicit non-goals

**Approval state: not yet presented or confirmed.**

After the acceptance matrix is approved, present this recommended scope:

### Already binding and not subject to reapproval

- English canonical analysis with an on-demand Chinese presentation cache;
- code-owned bilingual static UI;
- original evidence is not overwritten;
- Chinese presentation does not rerun investment inference;
- calculations, decisions, Confidence, and lineage do not change;
- Chat presents the same canonical evidence in the selected language;
- Founder Email/SMS/LinkedIn drafts have an independent language choice;
- no automatic sending or publishing;
- browser-scoped preference in the current no-login product;
- no mandatory bidirectional synchronization after a manual draft edit;
- translations never become Facts or XTrace memories;
- bilingual Confidence Methodology and an initial VC glossary.

### Proposed release boundaries that still require approval

- Support only English and Traditional Chinese (`zh-TW`) in this release.
- Translate cited/extracted presentation fields but not entire source files.
- Keep Chinese-language market collection/classification outside this
  localization release.
- Keep SEO locale routing and a general translation-management product outside
  this release.

### Consequences of those proposed boundaries

- languages other than English and `zh-TW`;
- translating or rewriting entire uploaded PDF/DOCX/image files;
- silently broadening this feature into Chinese-language market collection,
  classification, or matching;
- SEO locale routing or a general-purpose translation-management product unless
  separately requested.

The user must explicitly approve or revise this scope before the receiving
agent writes the final localization design.

## 17. Remaining explicit decisions

These details are genuinely unconfirmed. Do not choose silently.

1. Default language for a newly created Founder-facing action draft.
2. Whether `internal_memo` and `diligence_request` follow the global UI locale
   or have the same independent language selector as Founder outreach.
3. Whether existing Chat history translates after a locale switch, or only new
   responses use the selected locale.
4. Exact browser-preference storage mechanism.
5. Exact precedence among `?lang`, browser preference, and English default if
   the proposed shared-link behavior is approved.
6. Whether original-plus-translation applies only to cited excerpts or to a
   full extracted source preview. Full-file translation is not yet approved.
7. Synchronous request, background Worker, or hybrid translation execution.
8. Timeout, retry count, maximum artifact size, and translation cost budget.
9. Whether stale translations are retained for audit or deleted after
   invalidation.
10. Exact locale-specific date, number, and currency formatting rules.
11. Whether Chinese market-source ingestion/classification is part of a later
    separate feature.
12. Identity for the currently client-side internal Report Draft: persist a
    canonical artifact ID, use `report ID + report-content hash + template
    version`, or make its translation explicitly ephemeral.
13. Public-demo cache behavior: precomputed translations, ephemeral
    translations, or a narrowly scoped server-owned cache write. The choice
    must not broaden ordinary `public_demo` mutation permissions.

The receiving agent should resolve these only when they materially affect the
approved design or implementation plan. Ask one product-changing question at a
time and provide a recommendation with trade-offs.

## 18. Required continuation protocol

The next task must proceed in this order:

1. Read this file completely.
2. Audit the current branch and confirm that localization is still absent.
3. If company research/integration has landed, re-audit its final report,
   source, Chat, action, and UI schemas before proposing localization adapters.
4. Present the unresolved portion of Section 14 exactly once and ask for
   approval or revision.
5. Present the Section 15 acceptance/test proposal and ask for approval.
6. Present the Section 16 scope/non-goal proposal and ask for approval.
7. Resolve only the Section 17 decisions that affect the accepted scope.
8. Write a complete localization design document in
   `docs/superpowers/specs/`.
9. Scan that design for placeholders, contradictions, ambiguity, and accidental
   changes to canonical evidence/decision authority.
10. Commit the design document and ask the user for final review.
11. Only after explicit design approval, create a detailed implementation plan
    and then execute it through implementation, testing, review, authorized
    deployment, and end-to-end acceptance without adding another product
    approval gate unless a new product-changing ambiguity appears.

Do not interpret the request to begin the company-research track as approval to
skip these localization gates.

## 19. Expected architecture boundaries after approval

This section gives the future implementer orientation without authorizing
implementation.

Suggested isolated components are:

1. **Locale presentation layer** — locale resolution, typed dictionaries,
   formatting, and route-preserving UI switch.
2. **Canonical translation contract** — protected fields, translatable fields,
   fingerprints, and structural validation.
3. **Translation cache service** — authorized lookup, deduplicated creation,
   invalidation, failure state, and retry.
4. **Artifact adapters** — Market/CompanyAnalysis, underwriting, frameworks,
   Report Draft, Chat, sources, and action drafts.
5. **Confidence and glossary content** — manually maintained bilingual
   methodology and terminology.

Each adapter must depend on a canonical artifact and produce presentation-only
content. No adapter may write to evidence, matching, valuation, decision, or
XTrace memory tables.

Any persistent translation store must follow the repository's hardened data
boundary: composite workspace identity, row-level authorization, owner-role
separation, revoked broad direct writes, and narrowly controlled RPC/service
operations. Do not grant general `anon`, `authenticated`, or `service_role`
mutation rights merely to make the public demo convenient.

Translation invalidation must use a new translation-specific canonical content
hash. Existing eligibility and candidate-analysis fingerprints do not cover all
translated content and do not change when a draft body is edited. Action drafts
therefore require a body hash or equivalent content version.

## 20. New-task kickoff instruction

The new task should receive both this localization handoff and the separate
company-research handoff. The company track may start immediately; localization
must resume from the next unconfirmed section.

The complete copyable prompt is supplied in the parent Codex response that
created this document.
