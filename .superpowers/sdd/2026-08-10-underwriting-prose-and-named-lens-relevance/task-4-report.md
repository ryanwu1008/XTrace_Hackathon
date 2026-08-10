# Task 4 report — one-call advisory passage generation and independent grounding

## Status

Implemented and verified on `feat/backend-integration-checkpoint`. Advisory
framework execution now requests one judgment plus one complete five-segment
passage candidate in the same output attempt, persists the loader-owned
judgment independently, and grounds the passage against that saved judgment.
Invalid or foreign passage content is withheld without mutating an otherwise
valid judgment.

The provider never supplies authoritative relevance or
`selectionBasisEvidenceIds`. Passage grounding produces a strict,
selection-neutral candidate. Deterministic Task 3 placement alone injects the
critical-only selection basis after verifying that each selected critical ID is
represented in the grounded case/counter boundary and then recomputes the final
passage fingerprint.

No migration, UI, deployment, active-source enrichment, formal-decision,
valuation, or action mutation was added.

## Implementation

- Added strict provider schemas for the shared judgment shape, advisory
  counterevidence boundary, exact component/question focus, and all five
  plain-text passage segments. Core synthetic lens validation remains
  unchanged.
- Added the required advisory prompt constraints: VSee third-person voice,
  exact Card/source/partition refs, paraphrase-only public material, bounded
  posture, formal weight zero, and no decision, ceiling, veto, typed action,
  endorsement, impersonation, quotation, or hidden reasoning.
- Kept advisory execution to one output attempt. The existing metered transport
  retry remains bounded and separately reserved; core lenses retain their one
  repair attempt.
- Grounded the judgment first through the existing authoritative partition
  path. The passage is then independently checked for exact candidate/Card/
  component/version/question/taxonomy identity; source, claim, locator, and
  attribution scope; candidate-local support/counter partitions; saved
  unknown/limitation/request refs; stance/posture; plain-text safety; and the
  exact Unicode-whitespace word count (maximum 260).
- Added complete no-counter behavior: a saved empty counter partition requires
  `no_candidate_local_counterevidence` plus the exact saved evidence-request
  refs. A contrary Fact is never invented.
- Added a strict grounded selection-neutral candidate contract with loader-
  derived question text, actual word count, generator version, and grounding
  fingerprint. Framework application prose remains a typed inference segment;
  it is never persisted as a `Fact`.
- Extended cache records and execution fingerprints with the passage schema,
  generator, taxonomy version/digest, candidate, and validation result. Replay
  re-grounds cached candidates and rejects stale or mismatched passage
  contracts.
- Made the service taxonomy projection JSON-checkpoint-safe as a keyed record
  and extended strict stage replay to round-trip judgments, passage candidates,
  passage results, and taxonomy bindings. Task 3 priority accepts both its
  existing read-only Map fixtures and the service's durable keyed record.
- Amended Task 3 materialization so provider-visible passage evidence may cite
  both critical and context evidence while final
  `selectionBasisEvidenceIds` contains only the deterministic critical subset.
  Provider-injected selection metadata is rejected by the strict grounded
  candidate schema.

## TDD evidence

### Initial RED

```text
node --import tsx --test --test-concurrency=1 tests/unit/framework-lens.test.ts tests/unit/framework-grounding.test.ts tests/unit/named-lens-passage-grounding.test.ts
```

Exit 1: 14 passed / 3 failed. The new grounding suite failed to load with
`ERR_MODULE_NOT_FOUND`; the service did not expose passage candidates/results,
and cache records lacked the passage contract.

The amended deterministic finalizer was also exercised before production
changes:

```text
node --import tsx --test --test-concurrency=1 tests/unit/named-lens-relevance.test.ts
```

Exit 1: 3 passed / 13 failed because the old finalizer expected an already
materialized provider passage and could not consume a grounded
selection-neutral candidate.

Self-review added two more focused RED assertions: ordinary lowercase
`pass/watch` prose was falsely treated as a decision label, and uppercase
`We` escaped the first-person guard. The safety matcher was narrowed to typed
actions/formal labels and made case-insensitive for first-person voice.

### Final GREEN

Required Task 4 grounding command:

```text
node --import tsx --test --test-concurrency=1 tests/unit/framework-lens.test.ts tests/unit/framework-grounding.test.ts tests/unit/named-lens-passage-grounding.test.ts
```

Exit 0: 24 passed / 0 failed.

Required advisory/context command:

```text
node --import tsx --test --test-concurrency=1 tests/unit/framework-advisory.test.ts tests/unit/framework-context-runtime.test.ts
```

Exit 0: 15 passed / 0 failed. This includes JSON serialization plus strict
stage-replay round-trip of the complete service result.

Amended Task 2/3 contract and finalization command:

```text
node --import tsx --test --test-concurrency=1 tests/unit/named-lens-relevance.test.ts tests/unit/named-lens-finalization.test.ts tests/contracts/named-lens.test.ts
```

Exit 0: 29 passed / 0 failed.

Additional verification:

```text
npm run typecheck
npx eslint <all modified TypeScript files>
git diff --check
```

All three completed with exit 0 and no findings.

The repository-wide `npm test` was also run. It exits 1 on the branch's
existing Task 2/3 current-finalization fixture gap: multiple finalization,
seed, and report-route fixtures omit the now-required complete Named Lens
artifact/version tuple or carry stale advisory metadata. Task 4's focused
suites are green; wiring current passage/provider-attempt artifacts through
the terminal repository and updating those broad fixtures belongs to the
later persistence/orchestration tasks.

## Files changed

- `lib/claude/schemas.ts`
- `lib/contracts/named-lens.ts`
- `lib/underwriting/frameworks/claude-lens.ts`
- `lib/underwriting/frameworks/grounding.ts`
- `lib/underwriting/frameworks/passage-grounding.ts` (new)
- `lib/underwriting/frameworks/relevance.ts`
- `lib/underwriting/frameworks/schemas.ts`
- `lib/underwriting/frameworks/service.ts`
- `lib/underwriting/stage-replay.ts`
- `tests/unit/framework-lens.test.ts`
- `tests/unit/framework-grounding.test.ts`
- `tests/unit/framework-advisory.test.ts`
- `tests/unit/named-lens-passage-grounding.test.ts` (new)
- `tests/unit/named-lens-relevance.test.ts`
- `tests/integration/process-run-underwriting.test.ts` (service mock contract only)

## Self-review

- Verified foreign component, Card field, question, source, claim, locator,
  attribution, evidence, partition, unknown, request, stance, and posture
  inputs fail closed at the intended boundary.
- Verified a passage-only foreign evidence ID produces `withheld` while the
  authoritative applicable judgment remains unchanged.
- Verified model-authored selection metadata cannot expand the deterministic
  critical basis, including the case where grounded prose cites both critical
  and noncritical saved evidence.
- Verified author-order taxonomy domain lists are accepted only as the exact
  set and normalized to canonical UTF-8 order before persistence; no taxonomy
  code/domain may be added or removed.
- Verified core synthetic behavior and its support-plus-counter requirement are
  unchanged.
- Verified advisory output attempts remain one; transport attempts remain
  separately metered and bounded; cache replay cannot satisfy a changed
  passage/taxonomy contract.
- Verified no prompt or raw model response is stored in the cache.

## Concerns / future-task boundary

- No real provider response was observed in this task. The strict fixtures
  prove the contract and fail-closed behavior, not real-world prose quality.
- Later persistence/orchestration tasks must store provider attempts and carry
  these passage results into complete current Named Lens finalization; until
  then, the broad current-finalization fixtures described above remain red.

## Commit

Commit message: `feat: ground complete named lens passages`.

---

## Fix round 1/5 — Important review findings

### Status and implementation

Addressed all four Important findings without changing the one-call advisory
execution, independent judgment-first grounding, or selection-neutral passage
candidate architecture.

- Provider-declared `not_applicable` judgments now normalize immediately to a
  null passage candidate and null passage result. The first run and cache
  replay therefore expose the same semantic record, with no unavailable
  passage artifact attached to a non-applicable judgment. Provider failures
  that produce unavailable abstentions also replay with both passage fields
  exactly null.
- Replaced the narrow prose blacklist with bounded explicit safety grammar for
  formal decisions, ceilings, vetoes, all nine canonical typed action tokens
  and their humanized forms, VSee/fund/IC directives, named-person endorsement
  or hypothetical decision voice, first-person voice, and quotation marks.
  Ordinary lowercase `pass` and `watch` remain valid outside a bounded formal
  decision or directive context.
- Stage replay now receives the exact current passage schema, generator, and
  decision-taxonomy version/digest contract from the executor. Both grounded
  passage schemas require the exact current generator, and replay refuses a
  stale grounded generator or advisory taxonomy digest.
- Advisory cache replay now requires every applicable judgment to have both an
  exact candidate and a validation result, independently re-grounds the
  candidate, and compares the complete validation result. Non-applicable and
  unavailable advisory records require both fields to be null. Applicable
  outputs whose malformed passage cannot produce a strict candidate are not
  persisted as replayable cache records. Passage reason codes are a closed
  enum rather than arbitrary strings.

### Strict TDD evidence

Exact initial reproductions were run before the production changes:

```text
node --import tsx --test --test-concurrency=1 --test-name-pattern='stage replay requires|provider-declared non-applicable|cached applicable advisory passage mutations' tests/unit/framework-advisory.test.ts
```

Exit 1: 0 passed / 3 failed. Stage replay raised `Missing expected exception`
for a stale generator; the second provider-declared non-applicable run threw
`Framework lens cache record contains a mismatched advisory passage contract`;
and a cached applicable judgment with a null candidate plus an altered
withheld result raised `Missing expected rejection`.

```text
node --import tsx --test --test-concurrency=1 --test-name-pattern='withholds stance/posture' tests/unit/named-lens-passage-grounding.test.ts
```

Exit 1: 0 passed / 1 failed because `VSee should invest in this company.` was
validated instead of withheld. The same regression table also covers
`advance_diligence`, fund/IC directives, named endorsement/imitation, all nine
typed actions plus humanized equivalents, decision ceiling, veto, first-person
voice, and quotation.

After the fixes, the exact commands were rerun:

```text
framework advisory reproductions: exit 0, 3 passed / 0 failed
passage safety reproduction: exit 0, 1 passed / 0 failed
```

An unavailable-advisory replay assertion and separate malformed, missing,
mismatched, stale-fingerprint, and free-form-reason cache mutations were added
during self-review. The amended focused replay command completed with 4 passed
/ 0 failed, and the amended safety command completed with 1 passed / 0 failed.

### Verification

```text
node --import tsx --test --test-concurrency=1 tests/unit/framework-lens.test.ts tests/unit/framework-grounding.test.ts tests/unit/named-lens-passage-grounding.test.ts
```

Exit 0: 24 passed / 0 failed.

```text
node --import tsx --test --test-concurrency=1 tests/unit/framework-advisory.test.ts tests/unit/framework-context-runtime.test.ts
```

Exit 0: 18 passed / 0 failed.

```text
node --import tsx --test --test-concurrency=1 tests/unit/named-lens-relevance.test.ts tests/unit/named-lens-finalization.test.ts tests/contracts/named-lens.test.ts
```

Exit 0: 29 passed / 0 failed.

`npm run typecheck` and `git diff --check` completed with exit 0. Focused ESLint
completed with exit 0 and repeated three pre-existing unused checkpoint-binding
warnings in `orchestrator.ts`; linting the base-commit copy of that file emits
the same warnings.

### Self-review

- Rechecked that non-applicable normalization happens only after the strict
  judgment is independently grounded, and before passage parsing/grounding.
- Rechecked all reason codes emitted by passage grounding against the closed
  enum and separately mutated candidate shape, evidence partition, grounded
  fingerprint, withheld result, and reason code on replay.
- Rechecked that stage replay obtains the current contract at the executor
  boundary and never trusts a non-empty provider-owned generator string.
- Rechecked the action grammar against all authoritative action-policy kinds
  and human-readable forms, with positive ordinary lowercase `pass/watch`
  prose retained.
- Confirmed no formal decision, valuation, action, selection basis, migration,
  UI, research corpus, deployment, prompt-count, or raw-response persistence
  path changed.

### Remaining concern

The bounded prose grammar is deliberately explicit. A future canonical action
kind or newly authorized humanized action phrase must be added to this grammar
and its table-driven test in the same change.

### Independent review amendment

The required independent review found one further Important grammar gap:
recommendation/direction verb forms, generic lens endorsement, and named-person
belief voice were not covered. Exact tests for `VSee recommends buying this
company.`, `The IC directs an investment.`, `This lens endorses the
investment.`, and `Peter Thiel believes this company will win.` were added
before changing production code.

The focused safety command was RED with 0 passed / 1 failed (`validated`
instead of `withheld`), then GREEN with 1 passed / 0 failed after extending the
same bounded organization-directive, lens-endorsement, and named-person stance
grammar. No further Critical or Important finding remains from that review.

---

## Fix round 2/5 — reviewer findings before implementation

### Important 1 — prose safety still admits formal advice, metadata-named voice, and quote punctuation

A complete schema-valid passage can still be grounded as `validated` when its
text is `The recommendation is to invest.`, `Thiel believes this company will
win.`, or `The framework says ‘this company must win.’`. The remaining gaps
are an unsubjected formal-investment recommendation form, named-person belief
voice using only the surname represented by the exact authorized Card
metadata, and Unicode single quotation punctuation. The required correction
must be fail closed from exact authorized Card/named-person metadata and cover
quotation punctuation; it must not become an indefinitely growing phrase
blacklist or reject ordinary analytical lowercase `pass` and `watch`. Exact
full service-path regressions are required in addition to grounding-unit
coverage.

### Important 2 — withheld stage outcomes and checkpoint identity are not bound to the current contract

Stage replay currently checks schema/generator versions only inside a
`validated` grounded candidate. The replay payload has no persisted passage
contract of its own, so an applicable `withheld` candidate/result carries no
version to compare and a result produced under an old generator can replay.
The `framework_lenses` stage input fingerprint also omits the passage contract.
Every applicable passage outcome, validated or withheld, and the replay input
identity must be bound to the exact current passage schema, generator, decision
taxonomy version, and decision taxonomy digest. Missing, old, or one-field
mutated contracts must fail closed. Regressions must cover withheld replay plus
fingerprint/version/digest mutations.

### Non-blocking compatibility note

Making `NamedLensPassageSchema.generatorVersion` a current-version literal
will eventually require a version-dispatched legacy reader. This round must not
weaken current writes or replay. If a bounded reader is not needed by the
present stage/cache path, that compatibility work remains parked for the Task 8
legacy adapter.

### Round 2 root cause and implementation

- Passage safety was still classified only from global text patterns. It had
  no access to the exact `attribution.people` arrays already persisted on each
  authorized component Card, so a surname-only attributed voice could not be
  resolved. Grounding now derives full-name and surname aliases only from
  those loader-owned Card records and applies a bounded attributed-voice
  grammar. The existing full-name guard remains as a fail-closed defense for a
  foreign explicit full name.
- Formal recommendation detection now binds a formal governance noun to an
  investment/action term within the same bounded sentence span. Ordinary
  analytical lowercase `pass` and `watch` without that governance context
  remain valid.
- Quotation detection now covers Unicode double/open-single quotation
  punctuation and paired straight/curly single quotations without treating an
  ordinary in-word apostrophe as a quotation.
- Added one shared framework passage-contract module. The service result now
  persists the exact current schema/generator/taxonomy version and digest once
  for the complete stage result, so it binds validated and withheld outcomes
  alike. Strict stage replay requires that field and compares it to the
  executor-supplied current contract. Cache records continue to carry and
  independently re-ground their exact per-advisory passage contract.
- The framework-stage input fingerprint is now created by one helper that
  includes the passage contract. Missing contracts are rejected; mutating any
  one schema, generator, taxonomy-version, or taxonomy-digest field produces a
  distinct canonical checkpoint identity, and the current helper itself
  refuses every stale mutation. The source-grounded executor supplies only the
  frozen current contract.

### Round 2 strict TDD evidence

Before production changes, the exact grounding regression was RED:

```text
node --import tsx --test --test-concurrency=1 --test-name-pattern='withholds stance/posture' tests/unit/named-lens-passage-grounding.test.ts
```

Exit 1: 0 passed / 1 failed because the first new complete passage was
`validated` instead of `withheld`.

The full service-path and stage replay regressions were also RED:

```text
node --import tsx --test --test-concurrency=1 --test-name-pattern='stage replay requires|full advisory service path' tests/unit/framework-advisory.test.ts
```

Exit 1: 0 passed / 2 failed. The service result had no persisted
`passageContract`, and `The recommendation is to invest.` remained validated.
The same service test maps the exact Thiel-surname and Unicode-single-quote
examples to two other complete applicable advisory responses.

The new checkpoint-identity regression was RED with `ERR_MODULE_NOT_FOUND`
because the shared passage-contract/fingerprint boundary did not yet exist:

```text
node --import tsx --test --test-concurrency=1 tests/unit/framework-stage-passage-contract.test.ts
```

After the safety implementation, the grounding regression was GREEN (1/1).
The service-path test then passed all three withheld-result assertions and
stopped only at the still-missing stage contract, proving the two boundaries
independently. After the shared contract implementation, the stage/service
command was GREEN (2/2), and the checkpoint-contract command was GREEN (1/1).
Self-review then added current-helper rejection for all four stale contract
mutations; it was RED with `Missing expected exception` and GREEN after the
fingerprint boundary began parsing the exact current contract.

### Round 2 focused verification

```text
node --import tsx --test --test-concurrency=1 tests/unit/framework-lens.test.ts tests/unit/framework-grounding.test.ts tests/unit/named-lens-passage-grounding.test.ts tests/unit/framework-stage-passage-contract.test.ts
```

Exit 0: 25 passed / 0 failed.

```text
node --import tsx --test --test-concurrency=1 tests/unit/framework-advisory.test.ts tests/unit/framework-context-runtime.test.ts
```

Exit 0: 19 passed / 0 failed.

```text
node --import tsx --test --test-concurrency=1 tests/unit/named-lens-relevance.test.ts tests/unit/named-lens-finalization.test.ts tests/contracts/named-lens.test.ts
```

Exit 0: 29 passed / 0 failed. `npm run typecheck` and `git diff --check`
completed with exit 0. Focused ESLint completed with no errors and the same
three base-commit unused checkpoint-binding warnings in `orchestrator.ts`.

The existing broad integration test containing the durable checkpoint
assertion was updated to include the contract, but it remains red before
reaching that assertion because the branch's previously documented Task 2/3
finalization fixture still yields Candidate `failed` rather than `completed`.
The isolated stage-fingerprint test is the executable round-2 proof; no
controller workaround was added.

### Round 2 self-review and residual concern

- Confirmed the full service path keeps all three judgments applicable and
  their strict provider candidates selection-neutral while independently
  returning the intended action, voice, and quote withholding reason.
- Confirmed top-level stage contract validation runs for every result, including
  a payload containing applicable withheld results, rather than branching only
  on `validated`.
- Confirmed missing and all four one-field contract mutations fail replay, and
  all four corresponding mutations change the stage input fingerprint.
- Confirmed no provider attempt count, prompt, judgment partition, Task 3
  selection basis, decision, valuation, action, migration, UI, research corpus,
  or hidden-reasoning boundary changed.
- Self-review added a positive passage containing two ordinary curly possessive
  apostrophes plus lowercase `pass/watch`. It was initially RED because a
  paired-closing-apostrophe heuristic misclassified the span as a quotation;
  quotation detection was narrowed to real opening quote punctuation or paired
  straight quotes, and the exact test returned GREEN without weakening the
  Unicode `‘…’` rejection.
- The current generator literal remains intentionally strict for current
  writes/replay. Version-dispatched historical passage reading remains parked
  for the Task 8 legacy adapter rather than weakening this boundary.

### Round 2 independent review

An independent diff review against `30138c1` returned no Critical, Important,
or Minor findings. It independently reran the 44 directly affected framework,
grounding, advisory, replay-contract, and context tests plus typecheck and diff
validation, and confirmed the service-path safety cases, metadata surname
aliases, possessive-apostrophe positive case, withheld contract persistence,
stale/missing replay refusal, fingerprint refusal, one-call judgment-first
grounding, selection neutrality, Task 3 authority, and hidden-CoT boundary.

---

## Fix round 3/5 — reviewer finding before implementation

### Important — prose safety still depends on directional phrase forms and misclassifies ASCII possessives

The stage-contract finding is addressed. The remaining open Important is the
passage-safety classifier. Complete valid service responses can still ground
`Investing in this company is recommended.` and `Thiel’s view is that this
company will win.` as validated because the formal matcher assumes a
governance noun precedes the action and the metadata alias matcher assumes one
of a finite set of following verbs. Conversely, `The company's evidence may
pass while the customer's team may watch.` is incorrectly withheld as a quote
because two intra-word ASCII apostrophes are treated as a paired quotation.

The correction must be bounded and structural rather than another expanding
sentence blacklist:

- derive full, given, and surname aliases from exact authorized component Card
  `attribution.people` metadata and withhold any token-boundary occurrence in
  provider prose; headings already carry attribution, so the application prose
  does not need to repeat a person;
- classify advice sentence by sentence when a decision/recommendation/
  directive/endorsement term and an investment/deal/typed-action term coexist,
  independent of order, voice, or gerund form, while retaining analytical
  lowercase `pass/watch` without governance language;
- recognize only genuinely paired quote delimiters, including straight and
  curly double quotes, curly single quotes, and boundary-paired straight single
  quotes; never treat intra-word ASCII/curly possessives or contractions as
  quotations;
- prove all three reported examples through the exact full service path, derive
  additional alias cases from metadata rather than fixed Peter/Thiel strings,
  and keep one-call execution, selection neutrality, grounding, and current
  stage-contract authority unchanged.

### Round 3 implementation and TDD evidence

- Authorized-person safety now derives full, given, and surname aliases from
  the exact loader-owned `component.attribution.people` arrays. Any
  token-boundary occurrence in provider prose is withheld, independent of the
  surrounding verb or noun construction. The full service test includes the
  exact Thiel possessive reviewer case and an additional given name computed
  from a different Card's metadata rather than a fixed test string.
- Formal advice is classified by splitting each passage segment into sentences,
  normalizing typed-action separators, and requiring same-sentence coexistence
  of a bounded governance/advice vocabulary with an investment, Deal, or
  canonical typed-action vocabulary. Order, active/passive voice, and gerund
  form are irrelevant. The existing nine-action/humanized table now exercises
  the reversed `action … recommendation` permutation too.
- Quote safety now enumerates paired delimiter families: straight/curly double,
  guillemet, CJK, curly single, and boundary-paired straight single quotes.
  Apostrophes embedded in ASCII or curly possessive/contraction tokens are not
  delimiters.

Initial exact grounding command:

```text
node --import tsx --test --test-concurrency=1 --test-name-pattern='withholds stance/posture' tests/unit/named-lens-passage-grounding.test.ts
```

Exit 1: 0 passed / 1 failed because the exact ASCII two-possessive
`company's … customer's` sentence was withheld instead of validated.

Initial exact service command:

```text
node --import tsx --test --test-concurrency=1 --test-name-pattern='structurally classifies reverse advice' tests/unit/framework-advisory.test.ts
```

Exit 1: 0 passed / 1 failed because `Investing in this company is recommended.`
remained validated. The same complete service response matrix also includes
the exact `Thiel’s view …` case, the positive ASCII possessive case, a
metadata-derived given-name case, and a real boundary-paired `'quoted text'`
case.

After the structural implementation, both exact commands completed GREEN at
1 passed / 0 failed. Self-review preserved the established reason precedence:
explicit person/lens voice is classified before a formal-action overlap, while
`The IC should advance …` remains an action rather than a generic proper-name
voice match.

### Round 3 focused verification

```text
framework/grounding/stage contract: 25 passed / 0 failed
advisory/context: 20 passed / 0 failed
relevance/finalization/contracts: 29 passed / 0 failed
npm run typecheck: exit 0
focused ESLint: exit 0, no findings
git diff --check: exit 0
```

No provider count, prompt, judgment, selection-neutral candidate, Task 3
selection-basis authority, relevance, stage contract, decision, valuation,
action, persistence, controller, migration, UI, research corpus, or hidden-CoT
path changed.

---

## Fix round 4/5 — independent reviewer findings before implementation

### Important — action semantics are still limited to base forms

The round-3 independent review found that typed-action detection still depends
on the base form encoded in a regular expression. Complete passages containing
`Advancing internal diligence is recommended.`,
`Continuing internal monitoring is recommended.`, or
`Reopening internal diligence is recommended.` therefore remain validated.
The correction must derive bounded base/third-person/past/gerund variants from
the authoritative action taxonomy and its humanized leading verbs, recognize
the action at token/sentence level, and require same-sentence governance/advice
context rather than adding those three sentences as literals.

### Important — straight-single quote matching stops at an internal apostrophe

The same review found that the straight-single regular expression treats the
possessive apostrophe inside `'company's evidence is weak'` as the candidate
closing delimiter and never reaches the real boundary-paired closing quote.
The correction must use delimiter state: ASCII `'` opens or closes only at a
non-word boundary, while an apostrophe surrounded by word characters is
ignored inside the quoted span. Standalone ASCII/curly possessives remain
valid, but genuine paired quotes containing possessives or contractions are
withheld.

### Round 4 implementation and RED→GREEN evidence

Typed-action semantics are now derived at module initialization from every
option in the authoritative `BeliefActionKindSchema` plus the existing
`renderRecommendedNextMove` humanized text. The leading verb receives only
the bounded base/third-person/past/gerund variants needed by that closed
taxonomy, including silent-e removal and the `begin/begins/began/beginning`
irregular family. Canonical and humanized cores are tokenized and matched as
whole token sequences inside one sentence; the passage is withheld only when
the same sentence also contains the bounded advice/governance vocabulary.

The table-driven grounding test enumerates canonical and humanized forms for
all nine action kinds, asserts its kind list exactly equals the authoritative
schema options, and exercises advice-first plus action-first/reversed order.
Ordinary analytical `pass/watch` and two unquoted ASCII or curly possessives
remain validated.

Straight ASCII single quotation is now a small state scanner. A delimiter can
open only outside a word, word-internal apostrophes are ignored while scanning,
and a close is accepted only at a non-word boundary. Thus both
`'company's evidence is weak'` and `'this isn't durable'` are withheld, while
the existing `company's … customer's` non-quotation remains valid. The paired
curly and other quotation families remain explicit and unchanged.

Initial exact grounding command:

```text
node --import tsx --test --test-concurrency=1 --test-name-pattern='withholds stance/posture' tests/unit/named-lens-passage-grounding.test.ts
```

Exit 1: 0 passed / 1 failed because the true straight-single quotation
containing the internal possessive apostrophe was returned `validated`.

Initial exact full-service command:

```text
node --import tsx --test --test-concurrency=1 --test-name-pattern='structurally classifies reverse advice' tests/unit/framework-advisory.test.ts
```

Exit 1: 0 passed / 1 failed because
`Advancing internal diligence is recommended.` completed the full provider,
judgment, and passage-grounding path as `validated`.

After the structural implementation, both exact commands completed at
1 passed / 0 failed. The service matrix also includes the internal-apostrophe
quotation and the two-possessive positive case.

### Round 4 fresh focused verification

```text
framework/grounding/stage contract: 25 passed / 0 failed
advisory/context full service: 20 passed / 0 failed
relevance/finalization/contracts: 29 passed / 0 failed
npm run typecheck: exit 0
focused ESLint: exit 0, no findings
git diff --check: exit 0
```

No provider count, prompt, judgment, selection-neutral candidate, Task 3
selection authority, relevance, stage contract, decision, valuation, action,
persistence, controller, migration, UI, research corpus, or hidden-CoT path
changed in round 4.

### Round 4 independent review — open Important findings

The independent review returned no Critical or Minor findings, but two
Important boundary cases remain open, so round 4 was intentionally not
committed:

- The sentence splitter treats every period as a boundary. In
  `The recommendation for the U.S. market is advancing diligence.`, the
  abbreviation separates the advice term from the action semantic even though
  they are grammatically in the same sentence, allowing validation.
- Once a boundary apostrophe opens scanner state, a later plural-possessive
  apostrophe can be accepted as the close. In
  `The note uses 'tentative without a closing delimiter, while customers' evidence remains incomplete.`,
  no genuine paired quotation exists, but the passage is withheld as a quote.

The reviewer otherwise confirmed all nine action kinds, canonical/humanized
derivation, silent-e morphology, the `begin` special case, reversed-order
coverage, curly quote families, and no changes to one-call, selection, or
replay production paths. It independently reran the focused grounding test,
typecheck, and diff validation successfully.

---

## Fix round 5/5 — final bounded correction

### Root cause and converged design

The round-4 reviewer cases confirmed two mechanism-level errors rather than
missing phrases. Splitting on every period is not English sentence
segmentation: abbreviations such as `U.S.` and `U.K.` separate the advice noun
from an action in the same grammatical sentence. Stateful quote pairing is
also the wrong contract because the provider is forbidden to emit quotation
punctuation at all; waiting for a close both admits unmatched openers and
creates ambiguous cross-pairing with later possessives.

Round 5 replaces those mechanisms directly:

- `Intl.Segmenter("en", { granularity: "sentence" })` supplies formal English
  sentence boundaries. Same-sentence advice/action survives `U.S.`, `U.K.`,
  and decimal periods, while two real sentences remain independent.
- Quote safety is marker-level and fail-closed. Any double, guillemet, or CJK
  quotation marker is unsafe. Each straight/curly single marker is unsafe
  unless it is between two word characters (a contraction or possessive) or
  is an `s/S` plural-possessive suffix followed by a non-word. There is no
  pairing state, so unmatched openers fail immediately and a later
  `customers'` suffix cannot be mistaken for their close.
- The round-4 taxonomy-derived canonical/humanized action semantics and
  bounded base/third-person/past/gerund inflections remain unchanged, as do
  metadata alias withholding, one-call execution, selection neutrality, and
  the current stage contract.

### Round 5 RED→GREEN evidence

The exact grounding action command initially returned 0 passed / 1 failed:
`The recommendation for the U.S. market is advancing diligence.` was
`validated` because the period splitter separated its terms. The corresponding
`U.K.` and decimal cases were added to the same bounded regression table, with
a real two-sentence positive control.

The exact quote-marker grounding command initially returned 0 passed / 1
failed: `The framework says 'quoted but unclosed.` was `validated`. The same
test covers the prior reviewer sentence containing a later `customers'`,
unmatched curly single/double/guillemet/CJK openers, ASCII/curly word-internal
apostrophes, and ASCII/curly plural possessives.

The exact full-service command initially returned 0 passed / 1 failed on the
same `U.S.` passage. Its real Card matrix also carries the separate-sentence
positive control, plural-possessive positive control, and unmatched straight
single opener.

After the converged implementation, all three exact commands completed at
1 passed / 0 failed.

### Round 5 fresh focused verification

```text
framework/grounding/stage contract: 26 passed / 0 failed
advisory/context full service: 20 passed / 0 failed
relevance/finalization/contracts: 29 passed / 0 failed
npm run typecheck: exit 0
focused ESLint: exit 0, no findings
git diff --check: exit 0
```

The focused verification includes every round-4 taxonomy action form and all
round-5 segmentation/marker cases. No provider count, prompt, judgment,
selection, replay, relevance, stage-contract, decision, valuation, action,
persistence, controller, migration, UI, research-corpus, or hidden-CoT path
changed in round 5.

### Round 5 independent review and controller residual

The final independent review returned no Critical or Minor findings and
confirmed the required `U.S.`/`U.K.`/decimal segmentation, real-sentence
separation, all taxonomy-derived action inflections, straight/curly lexical
and plural possessive exemptions, unmatched-opener refusal, exact later-
`customers'` refusal, full-service grounding, and unchanged one-call,
selection, replay, and stage contracts.

It reported one remaining Important marker-inventory gap: the explicit Unicode
sets do not include every possible double/CJK/fullwidth quotation code point.
Examples include reversed double-low `⹂`, vertical CJK corner quotes
`﹁﹂﹃﹄`, halfwidth CJK corner quotes `｢｣`, and fullwidth
apostrophe `＇`. The first groups currently evade the unconditional-marker
check; fullwidth apostrophe would need to join the same contextual lexical/
plural-possessive policy as ASCII and curly single markers. This final 5/5
round does not expand scope again; the verified correction is committed with
this residual recorded for controller adjudication.
