# IC Underwriting Report Redesign

Date: 2026-08-03
Status: Approved for local implementation

## Decision

Deep Underwriting is a decision-first hybrid of a VC investment memo,
investment-banking financial analysis, consulting-style issue synthesis, and
VSee's belief-reversal audit trail. The primary reader is a VC Partner or
Investment Committee member.

The user approved **Approach B** for named analysts: every applicable named
public-source framework still executes and persists its complete independent
judgment, but the main report groups those judgments by IC issue. Complete
per-framework output remains available in an expandable Framework Appendix.

## Goals

- Make the Underwriting Queue readable at desktop and mobile widths.
- Put the decision, belief change, blocking evidence, and next action first.
- Present named analysts as a concise issue-based panel without reducing
  execution, provenance, disagreements, confidence dimensions, or Chat access.
- Keep financial analysis, scenarios, valuation, and return outputs explicit
  and fail closed when inputs are unavailable.
- Move IDs, exact lineage, and full analyst records into expandable audit
  surfaces instead of interleaving them through the primary narrative.

## Report architecture

1. **Executive Decision Memo**: formal result or explicit unavailable state,
   decision ceiling, belief direction, status-aware action, confidence, and
   critical missing evidence.
2. **Belief Change**: market evidence, prior memory, Then versus Now, causal
   impact, counterevidence, and unknowns.
3. **Company Underwriting**: verified company evidence, market, customer,
   competition, team, execution, and value-creation implications available in
   the persisted artifact.
4. **Analyst Panel Synthesis**: issue-based summaries for Market & Category,
   Competitive Power, Team & Execution, Downside & Risk, and Valuation &
   Returns. Each issue names its participating analysts, conclusions, strongest
   support, strongest dissent/counterevidence, and highest-priority unknown.
5. **Financial Case**: scenario model, calculations, valuation, sensitivities,
   ownership, MOIC, and IRR, or typed reasons why they are unavailable.
6. **VSee IC Synthesis**: deterministic decision, fired rules, ceiling,
   confidence, and status-aware actions. Named advisory weight remains zero.
7. **Diligence and Drafts**: prioritized evidence requests and draft-only
   communications.
8. **Audit Appendix**: complete named/core judgments, five confidence
   dimensions, exact framework provenance, disagreements, source revisions,
   versions, calculations, and fingerprints.

## Named analyst presentation contract

- No applicable judgment is deleted or excluded because of presentation space.
- `applicable` judgments with a non-`abstain` conclusion appear in issue
  synthesis.
- `not_applicable`, `unavailable`, and `abstain` judgments are counted and
  summarized, with their complete records retained in the appendix.
- Issue assignment is deterministic from audited pack/card identity and does
  not alter the judgment.
- Opposing conclusions remain visible; no average or invented consensus is
  produced.
- Main-report synthesis is presentation-only. It cannot change formal
  decisions, scores, valuation, evidence, or framework weights.
- Named output is always labeled as public-source product synthesis, not
  endorsement, private reasoning, or hidden chain of thought.

## Queue presentation

Each queue row presents, in order: compact priority number, company and Deal
identity, terminal underwriting status, formal decision or typed unavailable
state, and one detail action. Status counts use separate responsive cells.
Priority controls ordering only and never eligibility.

## Compatibility and safety

- Existing immutable pinned reports and stored artifacts are unchanged.
- The redesign consumes the existing public read model; it does not migrate or
  rewrite PostgreSQL data.
- Production is not read, seeded, migrated, or modified.
- Sample decision and sample research-screening labels remain permanent.
- Drafts remain draft-only and cannot be sent or published.

## Acceptance

- Queue counts and rows do not concatenate or force priority copy into narrow
  multi-line columns.
- The report opens with an executive decision snapshot.
- Named analyst main content is grouped by IC issue.
- Complete individual framework judgments and provenance remain accessible.
- Abstentions are summarized without being misrepresented as negative evidence.
- Disagreements and five confidence dimensions remain inspectable.
- Desktop and mobile layouts pass automated and browser acceptance tests.
- The live local report at `http://127.0.0.1:3100` renders the redesigned view
  from persisted artifacts.
