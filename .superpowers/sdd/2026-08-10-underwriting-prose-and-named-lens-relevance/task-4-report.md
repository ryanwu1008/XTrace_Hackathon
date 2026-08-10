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
