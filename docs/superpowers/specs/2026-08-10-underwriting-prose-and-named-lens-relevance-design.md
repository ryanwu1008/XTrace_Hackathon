# Underwriting Prose and Named Lens Relevance Design

**Date:** 2026-08-10

**Status:** Approved direction; written-spec review required before implementation

**Scope:** New Deep Underwriting runs and their report presentation

**Extends and, where listed below, supersedes:**

- `2026-08-06-decision-first-ic-memo-redesign.md`
- `2026-08-07-memo-redesign-and-gate-repair-handoff.md`

### 0.1 Precedence and compatibility

For new runs only, this design supersedes the following narrower clauses:

- the presentation-only boundary in Sections 1 and 5.4 of the 2026-08-06
  design. Persisted selection, passage, provenance, and presentation-version
  records are now required;
- the rule that every lens in every prioritized disagreement must appear in the
  main memo. A grounded principal pair is preserved, while the remaining main
  positions follow the deterministic four-to-six selection policy below;
- the deferral of field-level framework provenance in Section 5.4 of the
  2026-08-06 design and Section 4 of the 2026-08-07 handoff. New passage
  segments bind to the exact public doctrine claim or Card field they
  paraphrase. This is source attribution, not hidden reasoning;
- any new-run rendering path that derives Section 06 directly from raw
  `FrameworkJudgment` order, catalog order, `AnalystPanelSynthesis`, or legacy
  Bull/Bear cards.

The formal decision, valuation, action taxonomy, Evidence Pack, evidence
classification, XTrace exact lineage, hard gates, draft-only controls,
production isolation, and immutable-report rules remain unchanged. This design
does not rewrite any finalized artifact. Read compatibility is versioned for:

1. the immutable legacy 23-analysis pinned report;
2. finalized 30-analysis reports created before this passage contract; and
3. new reports carrying the passage contract and presentation schema version.

## 1. Decision summary

Deep Underwriting will read like a professional investment memorandum rather
than a rendering of internal schemas. The seven numbered sections plus Appendix are
retained, but the main narrative will use direct, company-specific prose,
translate numbers into investment consequences, and move raw identifiers and
complete audit detail to the appendix.

The Named Lens section will show four to six decision-relevant public-framework
perspectives in the main memorandum. Every applicable, traceability-valid
perspective will have a complete third-person argument: selected perspectives
appear in the main memorandum and the remaining complete perspectives appear in
the appendix. They are not rendered as lists of `Reading`, `Support`,
`Counterargument`, `Unknown`, and `Conclusion` fields. Abstentions, unavailable
judgments, and withheld reasons remain auditable in the appendix without
fabricated prose.

Named people are never simulated. A visible passage is VSee's application of a
versioned framework distilled from public sources. It is not the person's view
of the company, carries formal decision weight zero, and does not expose or
claim to expose hidden chain of thought.

## 2. Why this change is necessary

The current report has three separate problems.

First, the prose exposes internal labels directly. Repeated headings such as
`Strongest Support`, `Most Important Unknown`, `Assessment`, and `Confidence`
make the report read like a completed form. Metrics often appear without the
business mechanism that connects them to the recommendation.

Second, the current selection is not a true relevance ranking. The research
loader filters component Cards by stage, business model, geography, and
security type. The provider can then mark an advisory judgment applicable or
not applicable. The presentation view model places every lens involved in a
persisted disagreement first, appends the remaining eligible lenses in catalog
order, and takes six. It does not explicitly test whether a lens uses the
evidence that changed the prior belief or affected the action, valuation, or
decision ceiling.

Third, the intended `namedLensReadings` view model is not the visible source of
the current Section 06. `underwriting-detail.tsx` still renders the older
`AnalystPanelSynthesis`, Bull/Bear lists, and disagreement cards. As a result,
traceability withholding and the six-passage selection are not authoritative in
the visible report.

## 3. Product goals

1. Put the requested decision and its decisive reasons on the first screen.
2. Make every main-body paragraph answer an investment question.
3. Explain what each material fact or assumption changes in the business,
   valuation, risk, or action.
4. Select four to six Named Lenses from persisted evidence and decision
   relevance, never from fame or a per-company allowlist.
5. Give every applicable, traceability-valid Named Lens a complete,
   source-grounded argument, with four to six selected for the main memo.
6. Preserve every fact/assumption/unknown/conflict distinction, citation,
   Source Revision, XTrace lineage edge, fingerprint, and decision ceiling.
7. Keep formal decision generation independent from advisory framework prose.
8. Preserve immutable legacy reports through an explicit read adapter.

## 4. Non-goals

- This design does not implement bilingual presentation or translation.
- It does not create new company facts, market events, financial values, or VC
  interactions.
- It does not make advisory frameworks formal decision factors.
- It does not publish, send, or automatically distribute action drafts.
- It does not rewrite the immutable 2026-08-01 23-analysis pinned report.
- It does not authorize production migrations, production seed, or production
  data access.
- It does not claim that deterministic fixture prose represents real model
  quality. A real-provider smoke test remains required in isolated Staging.

## 5. Retained report architecture

The existing section titles remain stable because they are part of the current
report and test contract:

1. Decision Request
2. What Changed
3. Company Position
4. Thesis Assessment
5. Financial and Valuation Status
6. Named Lens Readings
7. Recommendation and Next Steps

**Unnumbered Appendix**

The architecture is decision-first, not evidence-first. The appendix remains
the location for the full evidence ledger, raw identities, complete framework
records, calculation lineage, model/provider metadata, and synthetic/sample
labels. A permanent synthetic/sample label is not moved out of context: when a
sample prior decision or screening record affects a main-body claim, its exact
`Sample decision record` or `Sample research screening record` label appears
adjacent to that claim as well as in the appendix.

## 6. Main-memo prose contract

### 6.1 General paragraph rule

Each analytical paragraph follows this semantic order without printing the
labels:

`claim -> evidence -> mechanism -> investment consequence -> condition`

The prose must distinguish:

- a persisted fact from an analyst inference;
- a reported value from a scenario assumption;
- a forecast from a historical result;
- a framework opinion from the formal decision;
- an unknown from a zero or a negative result.

### 6.2 Style

The canonical English report uses active voice, concrete nouns and verbs, short
paragraphs, and varied sentence length. It avoids raw enum values, schema keys,
internal IDs, scope badges, repetitive triads, promotional adjectives, and
generic transitions.

The main narrative must not repeatedly use phrases such as:

- `the thesis remains intact`;
- `this is materially important`;
- `the evidence suggests` without naming the evidence and mechanism;
- `strongest support`, `most important unknown`, or `synthesized view` as
  visible field labels;
- `best-in-class`, `transformative`, `holistic`, `exponential`, or comparable
  unsupported promotion.

Internal typed values remain persisted. The renderer translates them into their
decision meaning. For example, `materially_impaired` may render as a sentence
explaining which revenue, trust, financing, or valuation path was impaired.

### 6.3 Numbers

Every decision-relevant number in the main memo states or resolves to:

- the value and unit;
- the date or measurement window;
- the denominator or comparison basis when needed;
- whether it is reported, calculated, or assumed;
- the investment consequence;
- an adjacent citation or lineage affordance.

Typed decimal values are translated for readers. For example, `0.75` becomes
`0.75x the base case (25% downside)`. The underlying typed value remains
unchanged.

### 6.4 Missing information

The main memo does not repeat `Unavailable` for every absent field. It states the
bounded decision consequence once, such as `Valuation cannot yet be supported`,
and names only the three to six inputs that actually limit the decision. The
complete missing-input matrix remains in the appendix.

An unavailable formal decision must still produce the strongest authorized
interim action, such as requesting diligence or pausing follow-on approval. The
interim action is never presented as an investment approval.

### 6.5 Sources and audit information

Readable source links appear next to the claims they support. Raw Source
Revision IDs, XTrace parent/child identities, fingerprints, provider metadata,
and full evidence partitions appear in the appendix. A link label must describe
the source; internal IDs are not used as link text in the main memo.

### 6.6 First-screen decision contract

Before the reader reaches supporting detail, the first visible report screen
must state:

- the formal decision or explicit decision ceiling;
- the exact IC authorization being requested;
- two or three decisive reasons, each bound to readable evidence;
- the primary tension or the fact that no grounded tension was established;
- the immediate status-aware next action.

The first screen cannot begin with the full Evidence Pack, internal identities,
raw framework records, or repeated missing-field rows.

### 6.7 Reading format and budget

The main memo is a single-column editorial document. Named Lens passages render
as continuous prose under modest subheads; they do not render as cards, grids,
schema-field tables, or repeated label/value blocks.

Each selected English passage targets 180–260 words. Section 06 has a hard
presentation budget of 1,600 English words, excluding source affordances and
the one section-level disclosure. Complete appendix-only passages are collapsed
by default so that audit completeness does not interrupt the main reading flow.
If the canonical content exceeds the presentation budget, the generator must
revise it within the same structured contract before finalization; the renderer
must not silently truncate a persisted argument.

## 7. Named Lens identity and safety contract

Section 06 states the following product identity once, visibly, before the
first passage:

> VSee application of a public-source framework; not the named person's opinion
> on this company; no endorsement; formal decision weight zero.

Each passage then uses natural third-person attribution such as:

- `The framework VSee distilled from Howard Marks's published work asks...`
- `Applied to this Evidence Pack, the framework indicates...`

The prose must not say:

- `[Person] believes Company X...`;
- `[Person] recommends investing...`;
- `I would invest...` in a simulated person's voice;
- that a passage reproduces private reasoning or hidden chain of thought;
- that the named person reviewed or endorsed the report.

The product presents an auditable rationale assembled from persisted framework
doctrine, evidence, counterevidence, unknowns, and limitations. It does not
present private model reasoning.

Prompts must never use `you are <Person>` or ask the provider to imitate a
person's voice. Public framework material is paraphrased unless a separately
verified `verbatimExcerpt` contract authorizes a quotation. A causal conclusion
drawn by applying a framework is classified as
`framework_application_inference`, never as a company Fact or the named
person's statement. Composite Packs follow their persisted attribution scope;
the renderer cannot collapse a multi-source Pack into a claim that one person
authored every component.

## 8. Named Lens relevance selection

### 8.1 No opaque relevance score

Selection uses persisted reason codes and deterministic priority tiers. It does
not expose or depend on a single model-generated `relevance score`. Every
selected lens must have a readable explanation of why it entered the main memo.

The versioned authorized catalog assigns each applicable decision question a
typed `decisionQuestionCode` and `evidenceDomainCode`; the provider cannot invent
either. V1 codes cover at least market structure, product differentiation,
customer adoption, founder/team execution, operating model, unit economics,
financing/valuation, governance, security, and portfolio risk. The selected
Card field supplies the code and the passage binds back to that field. This
makes “different decision question” deterministic without a company/person
allowlist or fuzzy model judgment.

### 8.2 Fail-closed eligibility gates

A Named Lens first enters consideration only when all judgment-level gates pass:

1. the judgment is `applicable` and does not abstain;
2. the composite Card ID, Card version, Pack ID, Pack version, and full
   authorization binding resolve to the exact authorized research catalog;
3. every persisted support and counterevidence ID belongs to this candidate's
   immutable Evidence Pack; no foreign workspace, Deal, Candidate, Pack, Card,
   or Source Revision is present;
4. the judgment includes grounded support; grounded counterevidence or the typed
   boundary `no_candidate_local_counterevidence`; at least one
   decision-relevant unknown; and a bounded conclusion;
5. judgment, catalog, Evidence Pack, generation, and context fingerprints match
   the finalized Underwriting run.

A provisionally selected Lens becomes renderable only when all passage-level
gates also pass:

1. every passage support ID is a member of the saved judgment's
   `supportEvidenceItemIds`, and every passage counterevidence ID is a member of
   its `counterEvidenceItemIds`;
2. the typed stance and conditional conclusion do not contradict the saved
   judgment;
3. the framework premise resolves to the exact component framework version,
   doctrine claim or Card field, public source, and attribution scope that
   authorized it;
4. unknowns and limitations resolve to the saved judgment or an explicit
   candidate-local evidence request;
5. the passage is not a duplicate under Section 8.5 and all passage
   fingerprints match.

Mixed valid and foreign evidence is a failure. The implementation must not
silently discard the foreign ID and render the remainder. A failed passage is
withheld; the renderer cannot replace it with generic prose.

V1 validates advisory Packs against the bundled, server-side authorized
research catalog checkpoint, because the current PostgreSQL `framework_cards`
registry is not a complete mirror of the twenty advisory Packs and components.
The run persists the catalog/corpus fingerprints, composite authorization
digest, application commit, and resolved component identities. Client input
cannot authorize a Pack. Moving this catalog into PostgreSQL would be a separate
registry project and is not implied by this design.

Judgment and passage grounding are separate. A foreign ID in the saved judgment
makes the judgment unavailable. A judgment that grounds cleanly can remain
valid when only its candidate passage contains a foreign ID; that passage is
`withheld`, with the exact foreign-reference reason. The valid judgment remains
auditable but no prose derived from the invalid passage renders.

### 8.3 Decision-critical evidence set

Selection derives a candidate-local `DecisionCriticalEvidenceRef[]` projection
at Underwriting finalization. Each typed record contains
`evidencePackItemId`, its Fact/Assumption classification, one or more
`originRefs: { kind, id }[]`, typed reason codes, and the exact resolution path.
The convenience `decisionCriticalEvidenceIds` set is derived only from those
Pack-item IDs; it never mixes raw Market Event, Source Revision, memory, gate,
calculation, or action IDs into one string namespace. Each external artifact
must first resolve through persisted exact lineage or claim edges to its
candidate-local Pack item. Calculations resolve recursively to their persisted
inputs. An explicit Assumption can participate, but it remains an Assumption
and is never relabeled as an accepted Fact.

The set is the union of Evidence Pack items that resolve from:

- the Market Events and Source Revisions that changed the prior belief;
- chronology, revisit-condition, counterevidence, and action-delta gate results;
- the prior decision or reconsideration condition being revised;
- formal decision fired rules and blocking evidence;
- scenario inputs and calculations that affect valuation or return.

If a required lineage edge cannot resolve, it cannot contribute to relevance.
The selection must not infer criticality from keyword similarity alone.
Advisory judgments and their generated prose cannot themselves enter the set;
otherwise a weight-zero lens could create a feedback loop that makes itself
relevant.

The current typed action records do not carry their own supporting-evidence
edges, so action identity alone is not a relevance input. Action-delta gate
evidence and formal-decision rule evidence can participate through their exact
Pack-item mappings. A future action-to-evidence edge may be admitted only by a
new policy version.

### 8.4 Priority tiers

After the gates pass, lenses are ordered in these tiers:

1. **Principal disagreement:** one source-grounded `supportive` and one
   source-grounded `negative` judgment that both touch decision-critical
   evidence and answer the same typed decision question. `mixed` is not treated
   as an opposing pole.
2. **Changed-belief relevance:** a lens that directly uses evidence responsible
   for the belief or action change.
3. **Decision or valuation relevance:** a lens that uses evidence referenced by
   the formal decision, decision ceiling, scenario model, valuation, or return
   case.
4. **Distinct material perspective:** a lens that adds a non-duplicative market,
   competitive, team, operational, governance, or risk implication supported by
   candidate-local evidence.
5. **Context only:** an otherwise applicable lens with no decision-critical
   evidence overlap. These judgments remain in the appendix and never enter the
   main memo.

The principal pair is selected from all eligible supportive/negative pairs that
share a `decisionQuestionCode`. Pair ordering uses, in order: the size of the
union of decision-critical Pack items actually used by the two judgments,
descending; the lower of the two persisted evidence-coverage ordinals,
descending; the size of the shared decision-critical set, descending; and
stable `packId`, `frameworkCardId`, and `judgmentId`, ascending. Persisted
coverage is ordered `high > medium > low`; it is not converted into an opaque
score.

Within every remaining tier, deterministic ordering uses:

1. number of distinct decision-critical evidence items used, descending;
2. evidence-coverage confidence, `high > medium > low`;
3. a lens that supplies a missing opposing stance before one that does not;
4. stable `packId`, `frameworkCardId`, and `judgmentId`, ascending.

No person's fame, popularity, or fixed position in the catalog is a relevance
factor.

### 8.5 Four-to-six main passages

The main section targets four passages and may expand to six only when an extra
candidate introduces a new typed `decisionQuestionCode`, supplies a missing
grounded stance for an already-selected decision question, or directly covers
a still-unrepresented decision-critical evidence domain.

- The principal disagreement pair is included when it passes the gates.
- The selection tries to preserve both supportive and negative views when both
  are grounded.
- Repetitive lenses are retained in the appendix, not repeated in the main memo.
- If fewer than four lenses pass, the report displays the smaller truthful set.
- The implementation never generates filler to reach four.
- If more than six lenses participate in disagreements, the principal pair and
  the next highest decision-relevance tiers are shown; the complete conflict
  set remains in the appendix.

Selection is a deterministic greedy pass over the priority order. A candidate
is compared with every already accepted passage. It is a duplicate when all
three of these typed values are equal: `decisionQuestionCode`, the canonical
set of `selectionBasisEvidenceIds`, and `advisoryPosture`. An equal normalized
narrative fingerprint after
person, company, and Pack names are removed also catches literal clones. The
higher-priority candidate survives; exact ties use the stable identities above.
The rejected candidate persists `duplicate_decision_rationale` and remains in
the appendix. No fuzzy semantic similarity or model-generated distinctiveness
score participates in this rule.

The working lifecycle is one-way:

`considered -> judgment_eligible -> provisional_priority -> passage_validated -> duplicate_eliminated -> finalized_disposition`

The provider may return a candidate passage in the same response as the
judgment, but parsing and grounding the judgment are independent from validating
the passage. Judgment fields and decision-critical evidence produce only a
provisional priority order. Every eligible candidate passage is then parsed,
grounded, and validated. Only after that validation may the duplicate signature,
normalized narrative fingerprint, final greedy placement, main positions, and
backfill run. No final selection disposition or selection fingerprint exists
before this step. It cannot change the formal decision, valuation, or action
artifacts.

At finalization each catalog candidate has exactly one mutually exclusive
disposition:

`context_inapplicable | ineligible | abstained | unavailable | withheld | selected_main | appendix_only`

Only `selected_main` has a unique position from one through six. Every other
disposition has no position and must carry the applicable typed reason. The
database and TypeScript contracts enforce both cardinality rules.

## 9. Persisted selection and passage contracts

### 9.1 Named Lens selection record

New runs persist one immutable consideration/selection record for every
authorized catalog candidate considered for this Underwriting job, including
context-inapplicable, ineligible, abstained, unavailable, withheld, selected,
and appendix-only outcomes. A missing provider judgment therefore remains an
auditable typed result rather than disappearing:

- workspace, Deal, Candidate Run, Underwriting job, and report identities;
- judgment, Card, Card version, Pack, and Pack version identities;
- component framework IDs and versions;
- catalog version, catalog fingerprint, corpus digest, authorization mode,
  composite authorization digest, and source catalog identity;
- lifecycle state from Section 8.5 and every gate result;
- selection position when selected;
- priority tier;
- typed selection and withholding reason codes;
- `decisionQuestionCode`, typed stance, and typed `advisoryPosture`;
- candidate-local `selectionBasisEvidenceIds` used to justify the tier;
- the full candidate-local critical evidence projection and its typed
  lineage/reason paths;
- policy version;
- Evidence Pack, context, catalog, generator, and selection fingerprints.

The immutable logical identity is
`(workspaceId, artifactSourceCandidateRunId, judgmentOrCatalogCandidateId, selectionPolicyVersion)`.
Repeated execution and alias replay reuse the canonical source Candidate Run;
aliases read through `artifact_source_candidate_run_id` and do not copy rows. An
existing logical identity with the same fingerprint is reused; the same identity
with different content fails closed.

### 9.2 Named Lens passage record

Every applicable, traceability-valid lens persists a structured passage record
containing these ordered segments:

- `premise`: framework premise, component framework ID/version, doctrine claim
  or Card-field reference, public source IDs, and attribution scope;
- `caseApplication`: company-specific application, causal investment
  implication, and company support evidence IDs;
- `countercase`: strongest counterargument and company counterevidence IDs, or
  the explicit `no_candidate_local_counterevidence` boundary with the evidence
  request needed to test it;
- `unknownBoundary`: critical unknown, limitation, and the evidence request that
  would resolve it;
- `conditionalConclusion`: typed stance, conditional advisory conclusion, and
  an `advisoryPosture` of `supports_further_diligence`, `urges_caution`, or
  `withholds_view`;
- `selectionBasisEvidenceIds`, `decisionQuestionCode`, and the segment-level
  citation bindings above;
- the section-level no-endorsement contract identity;
- generator version and immutable fingerprints.

These fields are an auditable rationale artifact, not hidden model reasoning.
The visible renderer combines them into continuous prose. The same complete
passage record renders in the main memo when selected and in the appendix when
not selected; the system does not generate a shorter second version.

The immutable passage identity is
`(workspaceId, artifactSourceCandidateRunId, judgmentId, passageSchemaVersion, generatorVersion)`.
The same fingerprint is reusable; different content under the same identity
fails closed. Abstained, unavailable, and withheld results have no publishable
passage body and always persist typed failure metadata.

`advisoryPosture` is deliberately separate from the formal action taxonomy. The
provider produces it before the independent formal decision exists. After the
formal decision and typed status-aware actions are persisted, a deterministic
projection may explain whether the advisory posture aligns with, cautions
against, or withholds judgment on that action. It cannot create or change an
action.

For priority tiers 1–3, `caseApplication` or `countercase` must cite at least one
exact member of `selectionBasisEvidenceIds`. Every decision-critical contrary
item used by the saved judgment must either appear in `countercase` or carry a
typed `non_material_to_this_lens` or `appendix_only_context` classification.
This prevents a passage from earning selection with one item and arguing from a
different, merely candidate-local item.

### 9.3 Report presentation identity

Every new finalized report persists a `presentationSchemaVersion` and exact
artifact fingerprint. The read path dispatches without heuristics:

- legacy pinned-23 adapter;
- pre-passage finalized-30 adapter;
- current passage-contract renderer.

All three are read-only projections over immutable artifacts. A missing or
unknown version fails visibly; it never guesses the current renderer and never
rewrites a finalized report.

`selectionPolicyVersion`, `passageSchemaVersion`, `generatorVersion`, and
`presentationSchemaVersion` participate in the Candidate fingerprint and
`CandidateVersionSnapshot`. A policy change cannot reuse an older artifact
merely because the legacy batch-selection field still carries the historical
`top-five-belief-revised-v1` name.

## 10. Passage writing contract

Each main Named Lens reading uses two to four natural paragraphs without
repeated field headings.

The first part explains the public framework's relevant premise and why that
premise matters to this company. It then applies one or two decisive pieces of
candidate-local evidence and explains the causal mechanism.

The second part confronts the strongest counterevidence and states which part of
the thesis it weakens. It names the unresolved question and the evidence that
would settle it. The final sentence gives a conditional advisory conclusion and
expresses whether the framework supports further diligence, urges caution, or
withholds a view. It does not select a formal action.

Each passage must:

- remain company-specific after removing the company and Pack names;
- preserve candidate-local Fact, Assumption, Unknown, and Conflict
  classifications rather than calling every input an accepted fact;
- avoid restating the complete company description;
- avoid repeating the same metric unless the framework draws a genuinely
  different implication from it;
- make its analytical difference visible through the premise and mechanism, not
  through a different adjective;
- stay subordinate to the formal decision.

## 11. Section-level synthesis and disagreement

Section 06 opens with two to four sentences that state:

- what the selected frameworks agree on;
- the principal disagreement;
- the evidence or assumption causing the split;
- how the split affects the IC action.

It closes with a disagreement paragraph that identifies the exact diligence
item that could resolve the split. Conclusions are never averaged.

The deterministic synthesis has five branches:

- zero renderable lenses: state that no source-grounded framework reading is
  available;
- one renderable lens: call it one advisory perspective, never panel agreement;
- multiple lenses with the same direction: state the bounded area of alignment
  and that no principal disagreement was established;
- multiple lenses with different emphasis but no grounded supportive/negative
  pair on the same decision question: describe different emphasis, not a
  disagreement;
- a grounded supportive/negative pair on the same decision question: describe
  that pair as the principal disagreement and name the deciding evidence.

The synthesis is a deterministic projection of persisted passage segments,
selection reasons, and evidence IDs. It cannot introduce a new factual or causal
claim. Its own citation bindings are persisted with the finalized presentation
artifact so Chat and the report use the same grounds.

## 12. Rendering architecture

For new reports, the server read model loads persisted selection records and
validated passage records. `article.namedLensReadings` is only their projection
and becomes the only source of main-body Named Lens prose. Client code cannot
reselect from raw `detail.judgments`. The old
`AnalystPanelSynthesis`, Bull/Bear cards, and raw disagreement cards cannot render
as a fallback.

The appendix retains the complete prose for applicable unselected lenses, plus
the complete framework records, source catalogs, evidence partitions,
abstentions, withheld reasons, confidence dimensions, and disagreement
identities.

The immutable 23-analysis pinned report and every finalized 30-analysis report
created before this contract remain readable through their named, versioned
adapters. The adapters may preserve historical labels and layout, but new runs
do not write either legacy representation.

Finalized Chat reads the same versioned passage artifact and selection reasons.
It may explain why a Lens was selected only by citing the saved reason codes and
`selectionBasisEvidenceIds`; it cannot reconstruct a new selection from raw
judgments or claim access to model reasoning.

## 13. Provider and fixture behavior

The implementation does not add a second model call merely to rewrite a saved
judgment. Each named advisory execution receives the exact Framework Card and
complete immutable Evidence Pack once. Its strict response contains the existing
judgment fields plus the structured passage fields from Section 9.2. Grounding
validation produces one immutable judgment plus either one validated linked
passage or typed passage-failure metadata from that response. Invalid body text
is not a finalized artifact. The provider never returns free-form HTML or
Markdown.

Finalization is a one-way DAG:

`Evidence Pack + valuation -> provider responses -> judgment parse/ground -> formal decision + typed actions -> critical-evidence projection -> judgment-only eligibility/tier/order -> passage parse/ground/validation for every eligible candidate -> duplicate elimination + final greedy placement/backfill -> atomic final dispositions/passages/report/Chat presentation`

Every context-applicable advisory receives one bounded call that returns its
judgment and candidate structured passage. The system grounds the judgment,
completes the independent formal decision and actions, derives critical
evidence, and computes only provisional judgment priority. It then validates
every eligible passage before it performs duplicate elimination, final greedy
placement, or backfill. Valid unselected passages become Appendix entries. An
invalid candidate passage is not stored as publishable body text; only its
immutable attempt identity, failure metadata, and typed reason persist. No
second prose generation is performed for main-memo versus appendix placement.
Selection, passages, and synthesis never flow back into the formal decision,
valuation, action inputs, or their fingerprints.

Advisory execution uses bounded concurrency, immutable per-lens attempt
identity, a per-lens timeout and output-token cap, retryable terminal states,
and persisted cost/latency telemetry. All automatic retries occur before the
Candidate is finalized. Attempts are append-only rows identified by logical
passage identity plus attempt number and fingerprint; a retry only reruns the
failed advisory stage. Final selection, validated passage, presentation, and
report artifacts are written once. If attempts are exhausted, failure of even
an Appendix-only required passage finalizes the Underwriting as `partial` with
explicit framework-coverage reasons; it does not erase a completed formal
decision or valuation artifact.

A terminal `partial` Candidate and its artifact graph are immutable and cannot
be reclaimed. A later user-authorized refresh creates a new canonical Candidate
Run and report identity with `rerunOfCandidateRunId` plus a refresh nonce; it is
not an exact-replay alias and it does not update the old rows. Ordinary exact
replay continues to alias the old canonical artifact, including its honest
partial status.

The deterministic E2E observer is a test fixture. It must produce structurally
complete, distinguishable fixture passages sufficient to test the contract, but
its style and conclusions are not evidence of real-provider quality.

Before release, an isolated Staging run must observe and manually review real
provider output for at least:

- one positive belief revision;
- one negative belief revision;
- one genuine framework disagreement;
- one abstention;
- one withheld traceability failure.

The adversarial traceability case uses an isolated test seam and cannot be
written into the canonical staging seed or finalized sample report.

## 14. Failure behavior

- Missing or foreign evidence: withhold the entire passage.
- Card/Pack/version mismatch: withhold the entire passage.
- Repetitive template output: withhold the repetitive set from the main memo.
- Provider failure: persist an unavailable terminal reason; do not synthesize a
  substitute opinion.
- Fewer than four valid lenses because the authorized catalog contains fewer
  genuinely applicable, grounded perspectives: complete the Underwriting with a
  visible `limited_framework_coverage` notice and show the truthful set.
- Fewer than four valid lenses because of provider, lineage, authorization, or
  passage-validation failure: preserve the formal result but set the
  Underwriting terminal state to `partial`, persist the exhausted-attempt
  reasons, and show only valid prose. `partial` does not turn the saved formal
  decision or valuation into `Unavailable`; any later retry uses the new
  canonical refresh contract in Section 13.
- No valid lenses: state that no source-grounded Named Lens reading is available
  and retain the audit result in the appendix.
- Passage conflicts with the formal decision: preserve the advisory disagreement
  and label its weight zero; never rewrite the formal decision.

## 15. Test and acceptance matrix

### Selection

- zero, one, four, six, seven, and twenty applicable judgments;
- context-inapplicable and provider-unavailable judgments never enter selection;
- context-only judgments never enter the main memo;
- direct changed-belief evidence outranks catalog order;
- the principal grounded opposing pair is preserved;
- fifth and sixth passages appear only under the exact expansion rules in
  Section 8.5;
- the greedy duplicate signature preserves the higher-priority representative
  and records `duplicate_decision_rationale` for the other;
- ranking changes presentation order only, never formal eligibility or decision;
- identical inputs replay the same selected identities and positions;
- equal inputs use the stable identity tie-break;
- fame and hard-coded company/person allowlists never affect selection.

### Traceability and safety

- every passage resolves exact Card, Card version, Pack, and Pack version;
- every cited evidence ID belongs to the candidate and to the corresponding
  support/counter partition of the saved judgment;
- every priority-tier 1–3 passage cites its exact selection-basis evidence;
- premise, case application, countercase, unknown boundary, and conclusion each
  expose their own typed provenance refs;
- one foreign ID among valid IDs withholds the passage;
- a foreign passage ID withholds only the passage after a clean judgment is
  preserved; a foreign judgment ID makes the judgment unavailable;
- cross-workspace and cross-Deal evidence withhold the passage;
- no passage can claim endorsement, first-person named-person speech, private
  reasoning, or hidden chain of thought;
- advisory prose cannot change formal decision fields;
- authoring-only review, rights, and open-issue metadata never enter the public
  report projection.

### Prose quality

- every passage persists premise, application, mechanism, countercase, unknown,
  and conditional conclusion;
- visible prose does not print the internal field labels as repeated headings;
- passages remain distinct after company and Pack names are removed;
- each selected passage and the complete section stay within the reading budget;
- a maintained golden sample and editorial rubric check decision-first order,
  concrete mechanism, countercase quality, professional tone, and absence of
  schema-reading prose;
- decision-relevant numbers include units and reader meaning;
- missing data is summarized, not repeated as seventeen `Unavailable` rows;
- synthetic/sample and draft-only labels remain permanent and appear adjacent
  to any main-body claim that relies on a sample record.

### UI and replay

- Section 06 renders only the new passage source for new runs;
- Section 06 renders single-column prose with no per-lens card or grid layout;
- the first screen contains the decision or ceiling, exact IC ask, two or three
  cited reasons, primary tension, and immediate next action;
- complete judgments remain accessible in the appendix;
- source links are clickable and descriptive;
- typography supports continuous memo reading on desktop and mobile;
- the immutable 23-analysis pinned report fingerprint and content remain
  unchanged;
- pre-contract finalized 30-analysis reports remain readable through their
  explicit adapter and are not rewritten;
- valid-under-four completes with `limited_framework_coverage`, while
  failure-under-four is immutable `partial` and a later retry creates a new
  canonical refresh Candidate Run;
- repeated replay creates no duplicate selection or passage artifacts.

### End-to-end

- a real scan creates the belief revision, Evidence Pack, Underwriting job,
  persisted judgments, relevance selection, complete passages, final report, and
  Chat projection;
- finalized Chat can answer why each lens was selected, what evidence it used,
  what would change it, and why it did not control the formal decision;
- alias replay reads canonical selection/passage rows without copying them;
- no production data is read, migrated, seeded, or modified during validation.

## 16. Rollout and compatibility

1. Add typed selection, passage, segment-provenance, disposition, and
   presentation-version contracts with immutable policy versions.
2. Add append-only artifact tables and repositories through migration `0027`,
   in an isolated database only. Tables use workspace plus canonical Candidate
   Run composite ownership, the existing Underwriting-owner RLS/ACL pattern,
   immutable triggers, unique identities from Section 9, and row-count and
   referential-integrity assertions. Update both Drizzle and in-memory/Supabase
   repository implementations.
3. Generate selection and passage artifacts during Underwriting finalization.
4. Expose them through the report read model and finalized Chat projection.
5. Replace the new-report Section 06 renderer; retain the legacy read adapter.
6. Run unit, integration, replay, migration, cold E2E, browser, and real-provider
   Staging acceptance.
7. Commit and deploy only to an isolated Staging target using a new Worker name,
   non-production Supabase, and the same Web/Worker commit.

Provider work never occurs inside a database transaction or row lock. Candidate
passages return through the existing framework-lens stage; the final repository
transaction inserts the validated presentation artifacts and asserts their
cardinality before the Candidate becomes terminal.

The rollout is version-gated. A pre-contract Worker cannot finalize a run under
the new presentation version, and a new Worker cannot label an in-flight legacy
run as passage-contract complete. Deployment therefore requires the migration
first, then a same-commit Web and scan Worker cutover against the isolated
database. The current `vsee-vc` Worker and its production Supabase secrets are
not a valid Staging target. A real-provider Staging run remains blocked until a
verified non-production Supabase URL/key/database, separate Cloudflare/Sites
target, and hosted scan Worker identity all exist and pass startup refusal
against production project identifiers.

Production remains blocked until its database, Worker, access mode, and migration
boundary receive separate authorization and review.

## 17. External writing references

The writing contract is informed by, but does not copy, these public materials:

- Bessemer Venture Partners, public Shopify investment memorandum:
  `https://www.bvp.com/memos/shopify`
- CFA Institute, *Equity Research Report Essentials*:
  `https://www.cfainstitute.org/sites/default/files/-/media/documents/support/research-challenge/challenge/rc-equity-research-report-essentials.pdf`
- CFA Institute, *How to Write a Great Research Report*:
  `https://rpc.cfainstitute.org/research/cfa-magazine/2010/how-to-write-a-great-research-report`
- McKinsey, *The equity story you need for the long-term investors you want*:
  `https://www.mckinsey.com/capabilities/strategy-and-corporate-finance/our-insights/the-equity-story-you-need-for-the-long-term-investors-you-want`
- Barbara Minto, Pyramid Principle and SCQ overview:
  `https://barbaraminto.com/`

## 18. Approved product decisions captured here

- Keep the current seven numbered sections plus Appendix.
- Rewrite the report in professional investment-memo prose.
- Place four to six most decision-relevant Named Lenses in the main memo.
- Give each selected lens a complete logical argument in continuous prose.
- Put other complete applicable perspectives in the appendix.
- Use third-person, public-source attribution; never simulate the named person.
- Rank by changed belief, decision consequence, evidence, and distinctiveness;
  never by fame.
- Keep provenance, hard gates, decision ceilings, draft-only controls, immutable
  replay, and production isolation unchanged.
