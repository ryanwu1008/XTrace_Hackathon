# Editorial IC Memo Underwriting Report Design

Date: 2026-08-04
Status: Approved for implementation

## Product decision

Deep Underwriting will render as a single-column editorial Investment
Committee memorandum rather than a collection of dashboard cards. The main
reader is a VC Partner or Investment Committee member who needs to understand
the changed belief, evidence, debate, financial limits, and requested action in
one continuous reading flow.

The complete persisted artifact remains available, but technical identifiers,
full scenario input matrices, individual framework records, versions,
fingerprints, and exact lineage move to an expandable Audit Appendix.

## Reading hierarchy

The main memorandum follows this order:

1. Company, memorandum type, as-of date, Deal status, belief direction,
   confidence, and IC action requested.
2. Executive Conclusion.
3. What Changed: prior belief, new evidence, causal implication, and strongest
   counterevidence.
4. Verified Company Snapshot.
5. Investment Thesis Assessment: what remains supportable, what weakened, and
   the decision implication.
6. Investor Framework Synthesis.
7. Financial Case and modeling status.
8. Required Diligence.
9. Final IC Position.
10. Expandable Evidence and Audit Appendix.

The main memorandum is not a second artifact and does not alter PostgreSQL
authority. It is a presentation projection of the finalized CompanyAnalysis,
Evidence Pack, underwriting artifacts, public framework judgments, and action
drafts.

## Editorial layout

- Use a centered single-column document with a readable line length of roughly
  70–90 characters for narrative content.
- Remove the permanent left chapter rail and card grid from the underwriting
  memorandum.
- Separate sections with whitespace, restrained rules, and document headings.
- Use tables only for genuinely comparative information: company snapshot,
  framework synthesis, modeling inputs available, and diligence requirements.
- Avoid boxes around every paragraph. Status treatments may use a restrained
  rule, tint, or label when they materially aid interpretation.
- Keep the current dark VSee visual identity, but prioritize document reading
  over dashboard density.

## Typography

- Company title: 38–46px serif, regular weight.
- Memorandum descriptor and section headings: 24–32px serif or equivalent
  display face, regular to medium weight.
- Executive conclusion: 18–20px with 1.6–1.75 line height and medium visual
  emphasis.
- Main narrative: 16–18px with at least 1.65 line height and a weight that
  remains readable on dark backgrounds.
- Table values: 15–16px; labels and column headings: 11–12px semibold.
- Small monospaced type is reserved for evidence IDs, fingerprints, versions,
  provenance, and audit metadata. It must not be used for principal analysis.
- Important decisions, risks, limitations, and requested actions receive
  semibold emphasis or a larger serif treatment; whole paragraphs must not be
  bolded.

## Site-wide typography

The readability correction applies to the complete VSee website, not only the
Deep Underwriting dialog.

- Page introductions, report narratives, company briefs, event summaries,
  Deal context, Chat answers, Settings explanations, and other principal body
  copy use a minimum 15–16px size and at least 1.55 line height.
- Primary page explanations and long-form report prose use 16–18px.
- Navigation labels, buttons, filters, table headings, status labels, and
  operational controls use at least 11–12px with sufficient weight and
  contrast.
- Company and report titles retain the serif hierarchy and increase where the
  current scale does not provide a clear reading entry point.
- Audit-only IDs, hashes, version pins, timestamps, and source metadata may use
  10–11px monospaced type. They must not determine the size of adjacent
  analytical content.
- Mobile layouts preserve the readable scale rather than shrinking body text;
  layout stacking and wrapping handle the reduced width.
- Increasing font size must not cause clipped controls, horizontal page
  overflow, truncated navigation, or collapsed report tables.

## Investor Framework Synthesis

The main report will not render one card per analyst or one card per IC issue.
It will present:

1. A short Panel Conclusion.
2. Areas of Agreement.
3. Principal Disagreement.
4. Strongest Counterargument.
5. IC Implication.
6. A compact issue table for Market and Category, Competitive Power, Team and
   Execution, Downside and Risk, and Valuation and Returns.

The table has three principal columns:

- IC Question;
- Representative Framework Lenses;
- Synthesized View.

`Synthesized View` receives the majority of available width and uses normal
body typography, generous line height, and paragraph spacing. It must not be a
narrow column containing dense prose. At responsive widths, each row becomes a
stacked editorial item with the synthesized view below the question and lens
names.

Every applicable public-source framework judgment continues to execute and
persist. No opposing conclusion is averaged away. Complete individual records,
confidence dimensions, limitations, source catalog provenance, and judgment
IDs remain in the Audit Appendix. Named frameworks remain product syntheses of
public works, not endorsements, private reasoning, or hidden chain of thought,
and retain formal decision weight zero.

## Missing evidence and `Unavailable`

`Unavailable` remains a typed data state but is not repeated throughout the
main memorandum. Presentation copy maps it to one of these precise reader-facing
states:

- `Not publicly disclosed`;
- `Not independently verified`;
- `Cannot be calculated from current evidence`;
- `Not applicable`;
- `Provider or lineage unavailable` when a system failure actually occurred.

When Bear/Base/Bull inputs are insufficient, the main Financial Case states
once that a complete model cannot be supported by verified evidence. It then
shows:

- information currently available;
- the material inputs required before valuation;
- the decisions those inputs would enable;
- the resulting decision ceiling.

The main report must not render three repeated 17-field lists. The complete
3-by-17 scenario matrix and each persisted unavailable reason stay inspectable
in the Audit Appendix.

## Required Before Valuation

The diligence table contains:

- Priority;
- Required Evidence;
- Decision Use.

The evidence and decision-use columns receive substantially more width than the
priority column. Cells use 15–16px text, comfortable vertical padding, and
1.55–1.7 line height. On narrow screens, every row becomes a stacked item with
explicit labels. Long prose must not be squeezed into a narrow column.

## Evidence and decision safety

- Facts, assumptions, inferences, unknowns, conflicts, calculations, and
  framework perspectives remain visibly distinct.
- The memo cannot invent ARR, growth, margins, burn, cash, runway, financing
  terms, probabilities, exit assumptions, valuation, MOIC, IRR, or conclusions.
- A supported portfolio-risk action may be shown even when a new valuation or
  investment conclusion cannot be calculated.
- Sample decision records and Sample research screening records retain their
  permanent synthetic labels.
- Founder-facing and internal outputs remain drafts only.
- The 23-analysis pinned historical report remains immutable and replayable.
- Current runs continue to use 30 analysis-eligible Deals and 30
  CompanyAnalyses.
- Production is not read, seeded, migrated, or modified.

## Acceptance criteria

- The main report reads as a continuous professional IC memo, not a dashboard
  card collection.
- Main narrative text is visually readable at desktop and mobile widths.
- The complete site uses the approved readable typography scale; principal UI
  copy is no longer rendered at 6–11px.
- `Synthesized View` is not squeezed and remains easy to scan.
- `Required Before Valuation` has readable column proportions and responsive
  stacked behavior.
- Repeated `Unavailable` rows do not appear in the main memorandum.
- Financial insufficiency is summarized once and converted into prioritized
  diligence requirements.
- All fourteen current information areas remain represented between the main
  memo and Audit Appendix without changing persisted artifacts.
- Full framework records, scenario inputs, provenance, lineage, calculations,
  versions, and fingerprints remain inspectable in the Audit Appendix.
- Exact source links, sample labels, draft-only safety, and named-framework
  non-endorsement remain visible.
- Automated renderer, view-model, responsive CSS, type, build, and local
  browser acceptance tests pass.
