# Decision-First IC Memo Redesign

**Date:** 2026-08-06

**Status:** Proposed. Awaiting product-owner approval. No implementation authorized yet.

**Selected shape:** Seven sections plus one appendix, written as a continuous
investor-readable memorandum, with named public-source lenses carrying the
analytical weight of the document.

This revision replaces the earlier unapproved draft in this same file. That draft
covered the seven-section skeleton only; the product owner has since selected a
prose contract and a lens-led section 6, both specified below.

## 1. Precedence

On approval this supersedes, for new current-run Deep Underwriting presentation only:

- `2026-08-04-editorial-ic-memo-report-design.md` — its fourteen-area hierarchy;
- `2026-08-04-underwriting-reading-order-and-source-actions-design.md` — its
  fourteen-item reading order;
- Section 10 of `2026-08-05-vsee-xtrace-complete-project-continuation-handoff.md`;
- the handoff Section 22 checklist item requiring the previous order.

All evidence-safety, source-action, draft-only, and production-isolation rules in
those documents remain in force and are restated in Section 8.

`docs/qa/2026-08-03-current-30-cold-e2e-acceptance.md` is a historical record. It
is not rewritten. A new acceptance record is required after implementation.

## 2. Problem

Measured against one live artifact (Irregular, 25,844 rendered characters):

- Sections 01, 09, and 12 each restate the same formal result, ceiling,
  confidence, and next action.
- Section 08 renders ten consecutive `Unavailable / Unsupported` rows and nothing
  else.
- Section 05 renders the same synthesized sentence for six IC questions, varying
  only the framework name and stance; section 06 repeats four of them.
- The trigger sentence appears six times; the revenue counterargument roughly
  eight.
- Section 03 is titled `Verified / gate-accepted facts` while every persisted row
  is classified `reported`.
- Method and limitations arrive in section 07, long after the reader first meets
  `Unavailable` in section 01.

A second problem sits underneath the layout and is documented in Section 7.

## 3. Structure

Seven numbered sections and one appendix.

1. **Decision Request** — the only place the formal outcome appears. States what
   approval is being asked for, what the analysis can and cannot conclude, and
   why. Renders the complete typed action list from the authoritative action
   policy; an invested-negative analysis shows both `pause_follow_on` and
   `portfolio_risk_review`.
2. **What Changed** — prior belief, trigger event with date and canonical source,
   causal mechanism, strongest counterevidence, and the admission checks
   expressed as what each one verified.
3. **Company Position** — narrative company description from accepted evidence,
   with each value's evidence standing stated in ordinary language. The heading
   must not claim verification for values that are reported.
4. **Thesis Assessment** — which parts of the original thesis survive, which
   broke, and the decision implication.
5. **Financial and Valuation Status** — states once that a model cannot be
   supported, what is available, what is required before valuation, and what each
   missing input would unlock.
6. **Named Lens Readings** — the analytical centre of the memorandum. Specified in
   Section 5 below.
7. **Recommendation and Next Steps** — actions and diligence, ordered by the rule
   in Section 6 below.

**Appendix** — expandable. Complete Fact register with separate canonical-source
and archived-snapshot actions, Source Revision inventory, complete framework
records, the full scenario input matrix with each typed unavailable reason, the
persisted assumption inventory, contract versions, fingerprints, and lineage.

### Mapping from the current fourteen sections

| Current | Destination |
|---|---|
| 01 Executive Conclusion | 1 Decision Request |
| 02 What Changed? | 2 What Changed |
| 03 Verified Company Snapshot | 3 Company Position |
| 04 Investment Thesis Assessment | 4 Thesis Assessment |
| 05 Investor Framework Synthesis | 6 Named Lens Readings |
| 06 Investment Committee Debate | 6 Named Lens Readings |
| 07 Financial Case | 5 Financial and Valuation Status |
| 08 Valuation and Return Analysis | 5 merged; matrix to appendix |
| 09 VSee IC Synthesis | 1 merged |
| 10 Required Diligence | 7 Recommendation and Next Steps |
| 11 Status-aware Action Drafts | 7 Recommendation and Next Steps |
| 12 Final IC Position | 1 merged |
| 13 Evidence and Source Register | Appendix |
| 14 Audit Appendix | Appendix |

## 4. Prose contract

The memorandum is written for an investment professional, not for a system
operator. Persisted field values are the source of the text, never the text.

### 4.1 Field values are translated, not printed

A sentence that only reads out stored values must be replaced by what those
values mean for the decision.

| Do not render | Render instead |
|---|---|
| `decision ceiling: Unavailable`, `confidence: Low` | what the analysis can and cannot conclude, and why |
| `scope: portfolio · priority: high · visibility: internal_only` | one sentence describing the nature of the action |
| `4 hard gates passed` | what each check actually verified |
| four weighted sub-scores listed as labels | one sentence naming the dimensions that scored high |
| `attribution.scope`, `fidelityConfidence`, source IDs | a natural clause identifying the source, with the identifier carried by the citation control |
| `evidence classification: reported` on every row | one statement that these came from public reporting and none is independently verified |
| framework counts as a label list | how many could take a position, how the split fell, and what the split means |

### 4.2 No repeated per-item scaffolding

A section must not apply the same three headings to every item. Each lens reading
in Section 6 is continuous prose. Boundary statements derived from a card's
`notAClaimOf` appear as the closing thought of the passage, not under a fixed
heading.

### 4.3 Terms are explained where they first appear

Domain vocabulary is explained inline at first use, in the same sentence or the
one following. A separate glossary is not acceptable; it reads as an appendix and
is not encountered at the point of confusion.

This applies at minimum to: ARR, burn, runway, pro-rata, dilution, preferred
equity, MOIC, IRR, pre-money, contribution margin, and the Bear/Base/Bull
construction.

### 4.4 Numbers survive; labels do not

Figures a partner would act on — the match strength, the split of positions, the
count of unsupported model inputs, a reported valuation — are retained. Enum
labels, status strings, scope badges, and internal identifiers are not.

## 5. Named Lens Readings

### 5.1 Framing

The section opens by stating once that these are analytical frameworks distilled
from the named investors' published work, that they are not those individuals'
opinions on the company, that they run independently, that conflicting
conclusions are not reconciled, and that they do not participate in the formal
decision.

### 5.2 Selection

Render a small number of lenses chosen for decision relevance, not the complete
panel. Selection must be derived, never hand-picked per company:

- every lens participating in a prioritized disagreement is included;
- remaining slots are filled by applicability and evidence coverage;
- the target is four to six passages.

The complete set of persisted judgments stays in the appendix.

### 5.3 Passage contract

Each passage is continuous prose that establishes, in this order and without
headings:

1. what the framework holds, in the lens's own analytical terms;
2. what it therefore asks of this company;
3. its reading of this company's actual evidence, naming the specific evidence it
   relies on;
4. the condition or limit attached to that reading, derived from the card's red
   flags, disconfirming evidence, or `notAClaimOf`.

### 5.4 Traceability (hard requirement)

A lens passage may render only when it resolves to both:

- the card it is attributed to, by `frameworkCardId` and `frameworkVersion`, which
  must exist in the loaded framework catalog; and
- at least one persisted evidence item ID the judgment actually used, taken from
  `supportEvidenceItemIds` or `counterEvidenceItemIds`, each of which must exist
  in this candidate's Evidence Pack.

A passage failing either check is withheld. This is the control that prevents a
statement with no evidence binding from reaching the reader, and prevents a
statement being attributed to a card the catalog does not contain.

Field-level attribution — recording which card field each statement derives from
— is deliberately **not** required here, because the persisted
`FrameworkJudgment` contract does not carry it. Adding it would change the
judgment contract and the generator, and is out of scope for this
presentation-only design. It remains available as a later strengthening.

### 5.5 Disagreement passage

The section closes by explaining what the panel actually disagrees about — not
that it disagrees. For each prioritized disagreement, state the axis of the
dispute and what evidence would settle it. Positions are preserved, never
averaged.

## 6. Diligence ordering (hard requirement)

Section 7 does not render a fixed checklist. The order is derived, and the rule is
conditional so that it degrades safely on undifferentiated data.

**Discrimination test.** Collect the `unknowns` of every judgment participating in
a prioritized disagreement. They discriminate when they are not all identical
across those judgments.

**When they discriminate** the ordering basis is `prioritized_disagreement`:

1. missing evidence named in the unknowns of a disagreeing judgment, which would
   settle that disagreement;
2. missing evidence that would unblock a currently blocked calculation, ordered by
   its persisted requirement priority;
3. remaining diligence items in their existing deterministic order.

**When they do not discriminate** the ordering basis is `calculation_unblock`, and
group 1 is skipped entirely. The memo must not manufacture a disagreement-driven
order from data that cannot support one.

Every item in groups 1 and 2 states what it unblocks. Items that unblock nothing
carry no such claim. Deduplicated missing-evidence requests are summarized once at
section level.

The rule requires no data change to improve: if generation later produces
differentiated unknowns, the basis switches to `prioritized_disagreement`
automatically.

## 7. What this design cannot deliver by presentation alone

Measured on the same artifact, all nineteen applicable judgments classified the
same single fact as their support and the same single fact as their counter; the
remaining eleven evidence items were used by none of them. All nineteen share one
`strongestCounterargument` string, and the nineteen `strongestSupport` strings
differ only by the framework name they open with.

The stances are genuinely differentiated — ten supportive, nine negative, nine
abstaining — but the reasoning is not.

That measurement was taken from a local fixture whose model is the deterministic
stub `deterministic-e2e-observer-v1`, not from the production generator. The
production path in `lib/underwriting/frameworks/claude-lens.ts` sends the entire
Framework Card — including `decisionQuestions`, `redFlags`, `positiveSignals`,
`disconfirmingEvidence`, `notAClaimOf`, `decisionMethod`, and `confidenceAnchors`
— together with the Evidence Pack, and instructs the lens to partition every Fact
and Assumption ID into support, counter, or unused.

The differentiated material is therefore already supplied to the real generator.
Real output has never been observed, because the public deployment has no Worker
and the local fixture stubs the model.

Therefore:

- All seven sections and the appendix are implemented against current contracts.
  No synthesis change is assumed.
- Section 6 renders per-lens passages, and the Section 5.4 traceability rule is
  the control that decides whether each passage may appear. If real output is
  differentiated, passages render. If a sentence cannot resolve to both a card
  field and the evidence item IDs the judgment used, that sentence is withheld.
- Withholding is the designed failure mode. The renderer must never substitute a
  template, a paraphrase of another lens, or generic prose for a passage that
  fails traceability.

If observation of real output later shows the generator itself produces
undifferentiated judgments, changing synthesis generation becomes a separate
product change with its own evidence and non-fabrication requirements, specified
and approved separately. This design does not depend on that outcome.

## 8. Invariants that do not change

- Presentation only. No persisted artifact, Evidence Pack, decision, action
  draft, fingerprint, or XTrace lineage changes.
- Named frameworks remain product syntheses of public work, carry no endorsement,
  and retain formal decision weight zero. All cards remain draft and unpublished;
  cards in `pending_review` do not execute.
- No passage attributes a statement about this company to a real person.
- `Unavailable` remains a typed safety state — relocated and explained, never
  hidden, never replaced by an estimate.
- Facts, assumptions, unknowns, conflicts, calculations, framework opinions, and
  model inference remain distinguishable.
- `verbatimExcerpt` and `normalizedStatement` remain separate.
- Decision-relevant Facts keep exact Source Revision and Deal-bound XTrace
  lineage. Canonical public source and archived snapshot remain distinct actions,
  failing closed to archive-only when a canonical URL is unsafe or absent.
- `Sample decision record` and `Sample research screening record` labels remain
  permanent, with `meetingOccurred=false` and `vcInteraction=false`.
- All communications remain drafts; no send, publish, or delivery control.
- Hidden chain of thought is never exposed or claimed.
- The 2026-08-01 pinned report remains an immutable 23-analysis artifact.
- Current runs keep 30 eligible Deals and 30 CompanyAnalyses; outcomes sum to 30;
  `beliefRevisedCount === underwritingCandidateCount`.
- Evidence mode and readable window stay visible; exact timestamps stay in audit.
- Readable typography site-wide; no horizontal overflow on desktop or mobile.
- Production is not read, seeded, migrated, or modified.

## 9. Acceptance criteria

- Seven numbered sections and one appendix render.
- The formal outcome and typed action list appear exactly once in the reading
  flow.
- No `Unavailable / Unsupported` grid appears in the reading flow.
- No section heading claims verification for values classified as reported.
- No enum label, scope badge, status string, or internal identifier appears in
  body prose.
- No section applies repeated per-item headings.
- Each listed term is explained at first use.
- Every rendered lens sentence resolves to a card field and to evidence item IDs.
- Lens selection is derived from prioritized disagreements and applicability.
- Diligence order follows Section 6 and names what each leading item unblocks.
- An invested-negative approval request renders both typed actions.
- Draft bodies stay collapsed, preserve paragraphs, and expose no send control.
- Every current information area resolves to a destination in the Section 3 map.
- Desktop and mobile show no material overflow or illegible body text.
- Scan and report flow, underwriting artifacts, pinned replay, and production
  isolation unchanged.
- Renderer, view-model, route, CSS, type, lint, build, and browser acceptance
  pass; a new QA record is written.

## 10. Implementation impact

Presentation layer:

- `app/underwriting-detail.tsx` — section composition and ordering;
- `app/underwriting-article-view-model.ts` — projection shape, lens selection,
  diligence ordering, traceability enforcement;
- `app/vsee.css` — section rules;
- tests asserting the previous fourteen-item order are updated deliberately, not
  deleted.

No change to `lib/`, `db/`, `drizzle/`, `worker/`, or any persisted contract.

Section 6's per-lens passages additionally depend on the separate synthesis
change described in Section 7.

## 11. Non-goals

- Restoring a dashboard card wall.
- Removing any persisted artifact, evidence class, or audit capability.
- Changing decision policy, action policy, or confidence thresholds.
- Granting named frameworks any formal decision weight.
- Rewriting the immutable pinned report.
- Specifying the synthesis generation change, which Section 7 defers.
