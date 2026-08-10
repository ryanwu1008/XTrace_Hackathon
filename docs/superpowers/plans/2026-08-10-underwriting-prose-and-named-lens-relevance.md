# Underwriting Prose and Named Lens Relevance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce versioned, source-grounded Named Lens arguments and a professional single-column Deep Underwriting memo, selecting four to six decision-relevant public frameworks without allowing advisory prose to control the formal decision.

**Architecture:** Keep the existing Evidence Pack, valuation, framework-lens, deterministic decision, and finalization stages. Extend the single advisory provider response with structured passage segments, independently ground judgment and passage, derive a candidate-local decision-critical evidence projection, then perform deterministic final placement only after all eligible passages validate. Persist append-only attempt, disposition, passage, and presentation artifacts atomically; new report and Chat projections read those artifacts, while immutable pinned-23 and pre-contract finalized-30 reports use explicit legacy adapters.

**Tech Stack:** TypeScript 5.9, Zod 4, Node test runner, React 19, Next/vinext, PostgreSQL 17.6, Drizzle ORM, Supabase REST/RPC, Cloudflare/Sites.

## Global Constraints

- New Underwriting uses seven numbered sections plus an unnumbered Appendix.
- Section 06 renders four to six selected passages, each targeting 180–260 English words; the section budget is 1,600 English words.
- Section 06 is single-column editorial prose; no per-lens cards, grids, raw schema labels, internal IDs, or repeated field headings.
- Named Lens passages use third-person public-source attribution, formal decision weight `0`, no endorsement, no impersonation, no hidden Chain of Thought claim, and no invented quotation.
- Selection is deterministic and evidence-derived; fame, catalog order, company/person allowlists, fuzzy similarity, and a model-generated relevance score are forbidden.
- Judgment grounding, passage grounding, formal decision, selection, and presentation remain one-way; passage prose cannot change valuation, formal decision, or typed actions.
- Automatic provider retries finish before Candidate finalization. A terminal `partial` Candidate is immutable; a later refresh is a new canonical Candidate Run, never an alias mutation.
- Facts, Assumptions, Unknowns, Conflicts, source revisions, XTrace lineage, calculations, and sample/synthetic labels remain distinct and auditable.
- Existing immutable pinned-23 and pre-contract finalized-30 artifacts are never rewritten.
- Production data, production migrations, the existing `vsee-vc` Worker, and production Supabase secrets are out of scope.
- Real-provider acceptance requires an isolated non-production Supabase, separate Web/Worker targets on the same commit, and startup refusal for production identifiers.
- The deterministic E2E observer is a fixture and cannot be used as evidence of real-provider prose quality.

---

## File structure

### New focused modules

- `lib/contracts/named-lens.ts` — typed passage segments, provenance, critical-evidence refs, final dispositions, presentation identity, and database payload contracts.
- `lib/underwriting/frameworks/decision-taxonomy.ts` — versioned server-side mapping from every authorized component framework to typed decision-question and evidence-domain codes.
- `lib/underwriting/frameworks/critical-evidence.ts` — fail-closed normalization from heterogeneous persisted origins to candidate-local Evidence Pack item refs.
- `lib/underwriting/frameworks/relevance.ts` — judgment-only priority, passage validation, duplicate elimination, final greedy placement, and synthesis branches.
- `lib/underwriting/frameworks/passage-grounding.ts` — segment-by-segment grounding against the exact saved judgment, Card component, public source, and Evidence Pack.
- `lib/underwriting/presentation-version.ts` — current renderer identity and explicit pinned-23/pre-contract-30 adapters.
- `research/framework-authoring/decision-question-taxonomy.v1.json` — audited complete mapping for all authorized framework component IDs.
- `drizzle/0027_named_lens_passages.sql` — append-only attempts/dispositions/passages/presentation artifacts and atomic finalization assertions.

### Existing integration points

- `lib/underwriting/frameworks/research-schemas.ts`, `research-loader.ts`, and `schemas.ts` — catalog authorization and composite metadata.
- `lib/claude/schemas.ts`, `lib/underwriting/frameworks/claude-lens.ts`, `grounding.ts`, and `service.ts` — one-call judgment plus passage generation.
- `lib/underwriting/orchestrator.ts`, `candidate-stage-runtime.ts`, and `fingerprints.ts` — one-way stage order, retry accounting, policy versions, and final payload.
- `lib/contracts/underwriting.ts`, `db/schema.ts`, `db/repositories/underwriting-artifacts.ts`, and `db/repositories/underwriting-runs.ts` — version snapshot, repository implementations, aliases, and atomic finalization.
- `lib/underwriting/read-model.ts`, report API routes, and `lib/chat/finalized-projection.ts` — versioned report/Chat projection.
- `app/underwriting-article-view-model.ts`, `app/underwriting-detail.tsx`, and `app/vsee.css` — first-screen decision contract and editorial rendering.
- `tests/helpers/belief-reversal-e2e-pipeline.ts` and related verifier/quality helpers — complete deterministic fixture artifacts and cold E2E assertions.

---

### Task 1: Authoritative decision-question taxonomy

**Files:**
- Create: `research/framework-authoring/decision-question-taxonomy.v1.json`
- Create: `lib/underwriting/frameworks/decision-taxonomy.ts`
- Modify: `lib/underwriting/frameworks/research-schemas.ts`
- Modify: `lib/underwriting/frameworks/research-loader.ts`
- Modify: `lib/contracts/underwriting.ts`
- Test: `tests/unit/research-framework-loader.test.ts`
- Test: `tests/unit/framework-context-runtime.test.ts`

**Interfaces:**
- Produces: `DecisionQuestionCode`, `EvidenceDomainCode`, `DecisionTaxonomyBinding`, `DECISION_TAXONOMY_VERSION`, and `resolveDecisionTaxonomy(frameworkId, cardFieldRef)`.
- Produces: `ResearchFrameworkCatalog.decisionTaxonomyVersion` and `.decisionTaxonomyDigest` included in catalog/composite authorization fingerprints.
- Consumed by: Tasks 2, 3, 5, and 6.

- [ ] **Step 1: Write contract tests for the closed taxonomy**

Add tests that require the exact V1 enums and prohibit an unrecognized code:

```ts
assert.deepEqual(DecisionQuestionCodeSchema.options, [
  "market_structure", "product_differentiation", "customer_adoption",
  "founder_team_execution", "operating_model", "unit_economics",
  "financing_valuation", "governance", "security", "portfolio_risk",
]);
assert.throws(() => DecisionQuestionCodeSchema.parse("famous_investor_view"));
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
node --import tsx --test --test-concurrency=1 tests/unit/research-framework-loader.test.ts tests/unit/framework-context-runtime.test.ts
```

Expected: FAIL because the schemas, mapping, and catalog digest do not exist.

- [ ] **Step 3: Add the typed taxonomy module**

Implement these exact public contracts:

```ts
export const DECISION_TAXONOMY_VERSION = "named-lens-decision-taxonomy-v1" as const;
export const DecisionQuestionCodeSchema = z.enum([
  "market_structure", "product_differentiation", "customer_adoption",
  "founder_team_execution", "operating_model", "unit_economics",
  "financing_valuation", "governance", "security", "portfolio_risk",
]);
export const EvidenceDomainCodeSchema = z.enum([
  "market", "product", "customer", "distribution", "team", "operations",
  "financial_performance", "unit_economics", "financing_terms", "valuation",
  "governance", "security", "regulatory", "portfolio_risk",
]);
export const DecisionTaxonomyBindingSchema = z.strictObject({
  frameworkId: z.string().min(1),
  cardFieldRef: z.string().regex(/^decisionQuestions\[[0-9]+\]$/),
  questionText: z.string().min(1),
  decisionQuestionCode: DecisionQuestionCodeSchema,
  evidenceDomainCodes: z.array(EvidenceDomainCodeSchema).min(1),
});
export function resolveDecisionTaxonomy(
  frameworkId: string,
  cardFieldRef: string,
): DecisionTaxonomyBinding;
```

Load the JSON through the same server-side bundled catalog boundary as the authoring Cards. Repeated framework IDs are expected because each Card has multiple questions. Reject duplicate `(frameworkId, cardFieldRef)` identities, unknown IDs, missing/extra question bindings, stale question text, and non-UTF-8-sorted rows.

- [ ] **Step 4: Populate and validate the complete mapping**

Create one explicit row for every decision question in every framework component loaded from the 199 authoring Card files. The current audited corpus contains 1,058 `decisionQuestions` entries (four to seven per Card); the test must derive this count from the Cards and compare identities rather than trusting a hard-coded count. The file shape is:

```json
{
  "schemaVersion": "named-lens-decision-taxonomy-v1",
  "bindings": [
    {
      "frameworkId": "FD-02",
      "cardFieldRef": "decisionQuestions[0]",
      "questionText": "What did the founders know and not know when they started?",
      "decisionQuestionCode": "founder_team_execution",
      "evidenceDomainCodes": ["team", "market"]
    }
  ]
}
```

The loader test must compare `(frameworkId, cardFieldRef, questionText)` with every exact Card question. An omitted, duplicated, shifted-index, stale-text, or invented row fails closed.

- [ ] **Step 5: Bind taxonomy to authorized catalog and composite metadata**

Add `decisionTaxonomyVersion`, `decisionTaxonomyDigest`, and resolved component bindings to `ResearchFrameworkCatalog` and `FrameworkAdvisoryMetadataSchema`. Include them in `authorizationDigest`, catalog fingerprint, and corpus checkpoint. Bump `RESEARCH_FRAMEWORK_CATALOG_VERSION` to `research-framework-catalog-v2`; update the expected canonical digest only from the fully validated canonical corpus.

- [ ] **Step 6: Add negative authorization tests**

Cover missing binding, extra binding, mismatched component, changed code without digest change, client-supplied binding, and old digest replay. Expected behavior is catalog resolution failure, never fallback to catalog order.

- [ ] **Step 7: Run Task 1 tests**

Run the focused command from Step 2 plus:

```bash
node --import tsx --test --test-concurrency=1 tests/unit/framework-advisory.test.ts tests/unit/framework-context-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add research/framework-authoring/decision-question-taxonomy.v1.json lib/underwriting/frameworks/decision-taxonomy.ts lib/underwriting/frameworks/research-schemas.ts lib/underwriting/frameworks/research-loader.ts lib/contracts/underwriting.ts tests/unit/research-framework-loader.test.ts tests/unit/framework-context-runtime.test.ts tests/unit/framework-advisory.test.ts
git commit -m "feat: authorize named lens decision taxonomy"
```

---

### Task 2: Named Lens artifact contracts

**Files:**
- Create: `lib/contracts/named-lens.ts`
- Modify: `lib/contracts/underwriting.ts`
- Modify: `db/repositories/underwriting-artifacts.ts`
- Test: `tests/contracts/named-lens.test.ts`
- Test: `tests/unit/schema-declarations.test.ts`

**Interfaces:**
- Consumes: Task 1 taxonomy types.
- Produces: `NamedLensPassage`, `NamedLensDisposition`, `NamedLensPresentation`, `DecisionCriticalEvidenceRef`, `NamedLensProviderAttempt`, and their schemas/version constants.
- Extends: `CandidateFinalization`, `CandidateArtifactBundle`, and `CandidateVersionSnapshot` with current Named Lens artifacts and versions.
- Consumed by: Tasks 3–9.

- [ ] **Step 1: Write strict contract tests**

Create fixtures for one selected passage, one appendix passage, one withheld disposition, one provider attempt, and one presentation. Assert unknown keys fail, `selected_main` alone has position `1..6`, body text is forbidden for withheld/unavailable results, and segment refs are required.

```ts
assert.equal(NamedLensDispositionSchema.parse(selected).selectedPosition, 1);
assert.throws(() => NamedLensDispositionSchema.parse({
  ...withheld,
  selectedPosition: 1,
}));
assert.throws(() => NamedLensPassageSchema.parse({
  ...passage,
  caseApplication: { ...passage.caseApplication, evidenceItemIds: [] },
}));
```

- [ ] **Step 2: Run the contract tests and verify failure**

```bash
node --import tsx --test --test-concurrency=1 tests/contracts/named-lens.test.ts tests/unit/schema-declarations.test.ts
```

Expected: FAIL because `lib/contracts/named-lens.ts` is absent.

- [ ] **Step 3: Implement version and enum schemas**

Use these exact versions and terminal enums:

```ts
export const NAMED_LENS_PASSAGE_SCHEMA_VERSION = "named-lens-passage-v1" as const;
export const NAMED_LENS_SELECTION_POLICY_VERSION = "named-lens-selection-v1" as const;
export const UNDERWRITING_PRESENTATION_SCHEMA_VERSION = "decision-first-named-lens-v1" as const;
export const NamedLensDispositionKindSchema = z.enum([
  "context_inapplicable", "ineligible", "abstained", "unavailable",
  "withheld", "selected_main", "appendix_only",
]);
export const AdvisoryPostureSchema = z.enum([
  "supports_further_diligence", "urges_caution", "withholds_view",
]);
export const NamedLensPriorityTierSchema = z.enum([
  "principal_disagreement", "changed_belief", "decision_or_valuation",
  "distinct_material", "context_only",
]);
```

- [ ] **Step 4: Implement typed critical-evidence and provenance schemas**

```ts
export const DecisionCriticalOriginRefSchema = z.strictObject({
  kind: z.enum([
    "market_event", "source_revision", "xtrace_memory", "prior_record",
    "chronology_gate", "revisit_gate", "counterevidence_gate",
    "action_delta_gate", "fired_rule", "blocking_evidence", "scenario_input",
    "calculation", "valuation_evaluation", "return_calculation",
  ]),
  id: z.string().min(1),
});
export const DecisionCriticalEvidenceRefSchema = z.strictObject({
  evidencePackItemId: z.string().min(1),
  classification: z.enum(["fact", "assumption"]),
  originRefs: z.array(DecisionCriticalOriginRefSchema).min(1),
  reasonCodes: z.array(z.string().min(1)).min(1),
  resolutionPath: z.array(z.string().min(1)).min(1),
});
```

Require unique, UTF-8-sorted evidence IDs and origin refs. Raw heterogeneous IDs never enter `selectionBasisEvidenceIds`.

- [ ] **Step 5: Implement segment-level passage schemas**

Persist plain text, never HTML/Markdown:

```ts
export const NamedLensPassageSchema = z.strictObject({
  schemaVersion: z.literal(NAMED_LENS_PASSAGE_SCHEMA_VERSION),
  workspaceId: z.string().min(1),
  artifactSourceCandidateRunId: z.string().min(1),
  judgmentId: z.string().min(1),
  frameworkCardId: z.string().min(1),
  frameworkVersion: z.string().min(1),
  decisionQuestionCode: DecisionQuestionCodeSchema,
  evidenceDomainCodes: z.array(EvidenceDomainCodeSchema).min(1),
  premise: FrameworkPremiseSegmentSchema,
  caseApplication: CompanyEvidenceSegmentSchema,
  countercase: CountercaseSegmentSchema,
  unknownBoundary: UnknownBoundarySegmentSchema,
  conditionalConclusion: ConditionalConclusionSegmentSchema,
  selectionBasisEvidenceIds: z.array(z.string().min(1)),
  wordCount: z.number().int().min(1).max(260),
  generatorVersion: z.string().min(1),
  fingerprint: Sha256Schema,
});
```

`FrameworkPremiseSegmentSchema` carries component ID/version, exact Card-field or doctrine-claim reference, public source IDs, claim IDs, locator, and attribution scope. Company segments carry judgment-partition evidence IDs. `unknownBoundary` carries persisted judgment unknown/limitation refs or explicit evidence-request refs. `conditionalConclusion` carries saved stance and `AdvisoryPosture`, never a formal action.

`CountercaseSegmentSchema` carries `boundaryKind: "grounded_counterevidence" | "no_candidate_local_counterevidence"`. The first form requires at least one saved counterevidence ID. The second requires an empty counterevidence-ID set plus at least one persisted evidence-request ref, so a complete paragraph may state the missing countercase without inventing one.

- [ ] **Step 6: Implement disposition, attempt, and presentation schemas**

Enforce immutable logical identities and final cardinality:

```ts
const selectedShape = (value: NamedLensDisposition) =>
  value.disposition === "selected_main"
    ? value.selectedPosition !== null && value.selectedPosition >= 1 && value.selectedPosition <= 6
    : value.selectedPosition === null;
```

`NamedLensProviderAttempt` includes logical passage ID, attempt number, attempt fingerprint, status, token/cost/latency telemetry, and typed failure reason. Attempts are persisted when provider attempts are reserved/settled, not delayed until Candidate finalization. `NamedLensPresentation` includes the five-branch synthesis, segment citations, first-screen projection refs, schema/renderer versions, and fingerprint.

- [ ] **Step 7: Extend finalization and version snapshots**

Add these required current-run fields while keeping persisted-read compatibility optional:

```ts
namedLensAttemptRefs: NamedLensProviderAttemptRef[];
namedLensDispositions: NamedLensDisposition[];
namedLensPassages: NamedLensPassage[];
namedLensPresentation: NamedLensPresentation;
terminalStatus: "completed" | "partial";
terminalReasonCodes: string[];
```

Add `namedLensSelectionPolicyVersion`, `namedLensPassageSchemaVersion`, `namedLensGeneratorVersion`, `underwritingPresentationSchemaVersion`, and `decisionTaxonomyVersion` to `CandidateVersionSnapshotSchema` as an all-or-none group. Include selection policy, passage schema, generator, and presentation versions in the Candidate fingerprint. New finalization requires all five; old persisted reads remain accepted by the legacy union. The finalizer verifies referenced attempt rows already exist and cover every provider execution; it does not insert their telemetry late.

Add a typed current-run `counterevidenceBoundary` to persisted advisory `FrameworkJudgment` values. `grounded_counterevidence` requires a non-empty counterevidence partition; `no_candidate_local_counterevidence` requires an empty counterevidence partition and a persisted evidence request. Legacy judgments without this field remain readable only through the legacy contract branch.

- [ ] **Step 8: Run Task 2 tests**

Run the command from Step 2 and:

```bash
npm run typecheck
```

Expected: contract tests PASS and TypeScript reports zero errors.

- [ ] **Step 9: Commit Task 2**

```bash
git add lib/contracts/named-lens.ts lib/contracts/underwriting.ts db/repositories/underwriting-artifacts.ts tests/contracts/named-lens.test.ts tests/unit/schema-declarations.test.ts
git commit -m "feat: define named lens artifact contracts"
```

---

### Task 3: Critical-evidence projection and deterministic relevance policy

**Files:**
- Create: `lib/underwriting/frameworks/critical-evidence.ts`
- Create: `lib/underwriting/frameworks/relevance.ts`
- Test: `tests/unit/named-lens-critical-evidence.test.ts`
- Test: `tests/unit/named-lens-relevance.test.ts`

**Interfaces:**
- Consumes: Task 1 taxonomy and Task 2 contracts.
- Produces: `buildDecisionCriticalEvidenceProjection(input)`, `prioritizeNamedLensJudgments(input)`, `finalizeNamedLensPlacement(input)`, and `buildNamedLensSynthesis(input)`.
- Consumed by: Tasks 5–9.

- [ ] **Step 1: Write fail-closed critical-evidence tests**

Cover exact mappings from matched MarketEvent source revisions, hard-gate source IDs, prior-memory source IDs, formal-decision `inputRefs`/`blockingEvidenceItemIds`, and recursive Calculation inputs into Fact/Assumption IDs. Include a negative test where an origin has no exact Pack-item bridge.

```ts
const projection = buildDecisionCriticalEvidenceProjection(input);
assert.deepEqual(projection.map((item) => item.evidencePackItemId), [
  "fact_trigger", "fact_counter", "assumption_exit_multiple",
]);
assert.throws(
  () => buildDecisionCriticalEvidenceProjection(unresolvedOrigin),
  /cannot resolve to a candidate-local Evidence Pack item/,
);
```

- [ ] **Step 2: Write deterministic selection tests**

Test 0, 1, 4, 5, 6, 7, and 20 eligible judgments; supportive/negative principal pair; `mixed` not acting as an opposing pole; context-only never selected; catalog order and names having no effect; exact duplicate signature; literal normalized clone; stable UTF-8 tie-break; foreign ID; and high-priority passage withheld followed by deterministic backfill.

```ts
assert.deepEqual(
  finalizeNamedLensPlacement(sevenValid).dispositions
    .filter((item) => item.disposition === "selected_main")
    .map((item) => [item.judgmentId, item.selectedPosition]),
  [["judgment_a", 1], ["judgment_b", 2], ["judgment_c", 3],
   ["judgment_d", 4], ["judgment_e", 5], ["judgment_f", 6]],
);
```

- [ ] **Step 3: Run the focused tests and verify failure**

```bash
node --import tsx --test --test-concurrency=1 tests/unit/named-lens-critical-evidence.test.ts tests/unit/named-lens-relevance.test.ts
```

Expected: FAIL because both modules are absent.

- [ ] **Step 4: Implement typed critical-evidence normalization**

Expose this exact input boundary:

```ts
export function buildDecisionCriticalEvidenceProjection(input: {
  analysis: CompanyAnalysis;
  pack: EvidencePack;
  grounding: CandidateGroundingSnapshot;
  calculations: Calculation[];
  decision: DecisionResult;
}): DecisionCriticalEvidenceRef[];
```

Use `grounding.sourceRevisionSnapshots` and `grounding.xtraceLineage` as the exact bridge. Resolve canonical MarketEvent sources to `sourceRevisionId`, then to Pack Facts; resolve prior/gate/XTrace sources through the same saved lineage; take decision blocking IDs directly only when they are Pack items; walk completed Calculation `inputRefs` recursively until they resolve to Fact/Assumption items. Persist origin kind/ID, reason code, and path. An unresolved or cross-candidate edge fails closed. Do not admit typed action identity or any advisory judgment as an origin. Sort and deduplicate canonically.

- [ ] **Step 5: Implement judgment-only provisional priority**

```ts
export function prioritizeNamedLensJudgments(input: {
  judgments: FrameworkJudgment[];
  criticalEvidence: DecisionCriticalEvidenceRef[];
  taxonomyByFrameworkId: ReadonlyMap<string, DecisionTaxonomyBinding>;
}): NamedLensProvisionalPriority[];
```

Apply judgment-level gates first. Select the principal pair from grounded `supportive`/`negative` judgments sharing `decisionQuestionCode`; order pairs by critical-union size descending, minimum coverage ordinal descending, shared-critical size descending, then stable IDs ascending. Order remaining tiers by critical evidence count, persisted coverage `high > medium > low`, missing opposing stance, then stable IDs. Emit typed reason codes and `selectionBasisEvidenceIds`; never inspect generated prose here.

- [ ] **Step 6: Implement passage-aware final placement**

```ts
export function finalizeNamedLensPlacement(input: {
  catalogCandidates: NamedLensCatalogCandidate[];
  provisionalPriority: NamedLensProvisionalPriority[];
  passageResults: NamedLensPassageValidationResult[];
  criticalEvidence: DecisionCriticalEvidenceRef[];
}): { dispositions: NamedLensDisposition[]; passages: NamedLensPassage[] };
```

Validate all eligible passage results before final placement. Greedily accept four; add a fifth/sixth only for a new `decisionQuestionCode`, missing grounded stance, or at least one unrepresented `evidenceDomainCode`. Treat equal `(decisionQuestionCode, canonical selectionBasisEvidenceIds, advisoryPosture)` or equal normalized prose fingerprint as duplicate. Preserve the higher-priority representative, store `duplicate_decision_rationale` for the other, and backfill withheld positions.

- [ ] **Step 7: Implement the five-branch deterministic synthesis**

Return exactly one of `zero_available`, `single_perspective`, `bounded_alignment`, `different_emphasis`, or `principal_disagreement`. The synthesis text may interpolate only persisted passage segment text and evidence IDs; it cannot add a Fact or causal assertion. Enforce total selected passage word count plus synthesis at or below 1,600 words.

- [ ] **Step 8: Run Task 3 tests**

Run the command from Step 3. Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add lib/underwriting/frameworks/critical-evidence.ts lib/underwriting/frameworks/relevance.ts tests/unit/named-lens-critical-evidence.test.ts tests/unit/named-lens-relevance.test.ts
git commit -m "feat: derive named lens relevance from decision evidence"
```

---

### Task 4: One-call advisory passage generation and independent grounding

**Files:**
- Modify: `lib/claude/schemas.ts`
- Modify: `lib/underwriting/frameworks/schemas.ts`
- Modify: `lib/underwriting/frameworks/claude-lens.ts`
- Modify: `lib/underwriting/frameworks/grounding.ts`
- Modify: `lib/underwriting/frameworks/service.ts`
- Create: `lib/underwriting/frameworks/passage-grounding.ts`
- Test: `tests/unit/framework-lens.test.ts`
- Test: `tests/unit/framework-grounding.test.ts`
- Create: `tests/unit/named-lens-passage-grounding.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 contracts and taxonomy.
- Produces: `ClaudeAdvisoryFrameworkLensOutput`, `NamedLensPassageCandidate`, `groundNamedLensPassage(input)`, and `NamedLensPassageValidationResult`.
- Extends: `ClaudeFrameworkLensResult` and `FrameworkLensService.runAll()` with passage candidates/results while preserving existing core synthetic lenses.
- Consumed by: Tasks 5–9.

- [ ] **Step 1: Write provider-schema and grounding failures first**

Cover: missing segment, Markdown/HTML body, premise Card-field mismatch, public-source claim mismatch, support ID not used by the judgment, counter ID from the support partition, mixed valid/foreign evidence, stance mismatch, invented formal action, first-person named-person voice, fake quotation, over-260 words, and missing `no_candidate_local_counterevidence` boundary.

```ts
assert.equal(
  groundNamedLensPassage(validInput).status,
  "validated",
);
assert.deepEqual(
  groundNamedLensPassage(foreignPassageInput),
  { status: "withheld", reasonCode: "foreign_passage_evidence" },
);
```

- [ ] **Step 2: Run the tests and verify failure**

```bash
node --import tsx --test --test-concurrency=1 tests/unit/framework-lens.test.ts tests/unit/framework-grounding.test.ts tests/unit/named-lens-passage-grounding.test.ts
```

Expected: FAIL because the advisory passage schema and grounding path do not exist.

- [ ] **Step 3: Add a strict advisory-output schema without weakening core lenses**

```ts
export const ClaudeAdvisoryFrameworkLensOutputSchema =
  ClaudeFrameworkLensOutputBaseSchema.extend({
    counterevidenceBoundary: CounterevidenceBoundarySchema,
    passage: NamedLensPassageCandidateSchema,
  }).strict().superRefine(validateAdvisoryFrameworkLensOutput);
```

Keep `ClaudeFrameworkLensOutputSchema` and its existing applicable-lens support-plus-counterevidence rule unchanged for core synthetic lenses. Factor only the shared strict object shape into `ClaudeFrameworkLensOutputBaseSchema`; the advisory validator accepts either a non-empty counterevidence partition with `grounded_counterevidence`, or an empty partition with `no_candidate_local_counterevidence` plus a persisted evidence-request ref in the passage. The candidate contains five plain-text segments and typed refs, including exact `(componentFrameworkId, componentVersion, cardFieldRef, decisionQuestionCode, evidenceDomainCodes)`. It does not contain HTML, Markdown, final actions, final decision labels, or a model-generated relevance score.

- [ ] **Step 4: Update the advisory prompt and single-call return**

Keep one provider call per advisory and parse the strict advisory schema. Add these instructions to `ADVISORY_SYSTEM_PROMPT`:

```ts
"Write VSee's third-person application of the supplied public framework; never imitate or speak as a named person."
"Return a bounded advisoryPosture only; do not output a formal decision, decision ceiling, veto, or typed action."
"Bind every passage segment to exact supplied Card fields, public-source refs, and judgment evidence partitions."
"Paraphrase public material; do not invent or output a quotation."
```

Return `{ judgment, passageCandidate, attempts, repaired }`. Non-advisory core lenses return `passageCandidate: null`. Advisory provider/transport retry still uses the existing stage budget and attempt executor.

- [ ] **Step 5: Ground judgment first and passage second**

Keep `groundFrameworkLensOutput()` authoritative for judgment partitions. Then call:

```ts
export function groundNamedLensPassage(input: {
  candidate: CandidateRun;
  pack: EvidencePack;
  card: ExperimentalAdvisoryFrameworkCard;
  judgment: FrameworkJudgment;
  candidatePassage: NamedLensPassageCandidate;
  generatorVersion: string;
}): NamedLensPassageValidationResult;
```

Verify exact component, question index/text/code, source/claim/locator/attribution scope, support/counter subset, unknown/limitation refs, stance, advisory posture, plain-text safety, and word count. A foreign ID in the judgment makes the judgment unavailable through the existing path; a foreign ID only in the passage returns `withheld` without changing the valid judgment.

- [ ] **Step 6: Add complete-countercase behavior**

Require at least one counterevidence ID when the saved judgment has counterevidence. If the saved advisory judgment legitimately has none, persist `counterevidenceBoundary: "no_candidate_local_counterevidence"` and require the passage to reference an exact saved evidence request; never invent a contrary Fact. Reject a boundary that disagrees with the saved partition.

- [ ] **Step 7: Update cache binding and fingerprints**

Include passage schema version, generator version, taxonomy version/digest, complete candidate passage, and validation status in `FrameworkLensCacheRecord`. A cached judgment without the matching passage contract cannot satisfy a new run.

- [ ] **Step 8: Run Task 4 tests**

Run the command from Step 2 and:

```bash
node --import tsx --test --test-concurrency=1 tests/unit/framework-advisory.test.ts tests/unit/framework-context-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 4**

```bash
git add lib/claude/schemas.ts lib/underwriting/frameworks/schemas.ts lib/underwriting/frameworks/claude-lens.ts lib/underwriting/frameworks/grounding.ts lib/underwriting/frameworks/service.ts lib/underwriting/frameworks/passage-grounding.ts tests/unit/framework-lens.test.ts tests/unit/framework-grounding.test.ts tests/unit/named-lens-passage-grounding.test.ts tests/unit/framework-advisory.test.ts tests/unit/framework-context-runtime.test.ts
git commit -m "feat: ground complete named lens passages"
```

---

### Task 5: PostgreSQL 0027 append-only presentation artifacts

**Files:**
- Create: `drizzle/0027_named_lens_passages.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `db/schema.ts`
- Modify: `package.json`
- Create: `tests/integration/underwriting-presentation-migration.test.ts`
- Modify: `tests/integration/schema-migrations.test.ts`
- Modify: `tests/integration/task9-finalization-authority-migration.test.ts`
- Modify: `tests/integration/underwriting-partial-terminal-migration.test.ts`
- Modify: `tests/unit/schema-declarations.test.ts`

**Interfaces:**
- Consumes: Task 2 database payload contracts.
- Produces: append-only artifact tables, provider-attempt reserve/settle RPCs, and versioned atomic finalization assertions.
- Consumed by: Tasks 6–10.

- [ ] **Step 1: Write migration tests before SQL**

Add a fresh-cluster integration suite asserting tables, composite FKs, ownership, RLS/ACL, immutable triggers, unique identities, and atomic rollback. Include negative payloads for missing/duplicate catalog dispositions, duplicate/gapped/>6 positions, selected-without-passage, passage-without-valid disposition, cross-workspace/deal/report identity, invalid segment order, late provider attempt, and fingerprint mismatch.

```ts
await assert.rejects(
  finalize({ ...valid, namedLensDispositions: duplicatePositions }),
  /selected Named Lens positions must be unique and contiguous/,
);
assert.equal(await countRows("named_lens_passages"), 0);
```

- [ ] **Step 2: Add partial-canonical replay tests**

Prove that exhausted passage attempts finalize the canonical Candidate as `partial`; exact replay aliases that immutable partial source without copying rows; refresh nonce creates a new canonical Candidate; and completed/partial canonical fingerprints cannot collide with different content.

- [ ] **Step 3: Run migration tests and verify failure**

Use the documented PostgreSQL 17.6 fresh-cluster helper with the in-namespace `socat` loopback proxy, then run:

```bash
REQUIRE_POSTGRES_MIGRATION_TESTS=1 node --import tsx --test --test-concurrency=1 tests/integration/underwriting-presentation-migration.test.ts tests/integration/schema-migrations.test.ts tests/integration/task9-finalization-authority-migration.test.ts tests/integration/underwriting-partial-terminal-migration.test.ts
```

Expected: FAIL because migration 0027 and the new finalization contract are absent. Never run this against a shared or production cluster.

- [ ] **Step 4: Declare six append-only tables in SQL and Drizzle**

Create:

```sql
decision_critical_evidence_projections
named_lens_passage_attempt_events
named_lens_dispositions
named_lens_passages
named_lens_passage_segments
underwriting_presentations
```

Every row carries `workspace_id` and canonical `candidate_run_id`; candidate-owned rows also carry `deal_id`, and `underwriting_presentations` carries `report_id`. Use composite workspace/candidate ownership, canonical-source-only checks, immutable update/delete triggers, UTF-8-stable ordinal/identity constraints, and JSON payload fingerprints. `underwriting_presentations` is the immutable company-level Deep Underwriting report artifact; do not update the shared scan-level `intelligence_reports` row from each Candidate transaction.

Extend the `candidate_checkpoints.stage` constraint and Drizzle schema with the deterministic `named_lens_presentation` stage; old persisted stage rows remain valid.

- [ ] **Step 5: Add append-only provider-attempt RPCs**

Create owner-guarded functions with service-role execute only:

```sql
reserve_named_lens_passage_attempt(p_payload jsonb) returns jsonb
settle_named_lens_passage_attempt(p_payload jsonb) returns jsonb
```

Both RPCs insert immutable events; neither updates an existing row. A reserve event is unique on `(workspace_id, candidate_run_id, logical_passage_id, attempt_no, 'reserved')`; settlement adds exactly one `completed | failed | aborted` event with the same fingerprint. Enforce monotonic attempt number, running lease ownership, reserve-before-settle, and settlement before Candidate finalization. Direct `INSERT/UPDATE/DELETE` remains denied to `anon`, `authenticated`, and `service_role`.

- [ ] **Step 6: Add versioned finalization assertion**

Add `assert_named_lens_presentation_finalization_0027(payload, workspace, candidate, deal)` and invoke it only when the all-or-none current presentation versions are present. It must verify:

```text
authorized catalog consideration count == disposition count
selected_main count between 0 and 6
selected positions == 1..selected_main_count
each selected_main/appendix_only disposition has exactly one validated passage
each passage has exactly five ordered grounded segments
all referenced provider attempts already exist and are settled
completed + limited_framework_coverage iff fewer than four passages exist solely because fewer than four catalog candidates were genuinely applicable
partial iff an otherwise applicable required judgment/passage is unavailable or withheld after exhausted provider, lineage, authorization, or validation attempts
```

Insert projection, dispositions, passages, segments, and company presentation in the same finalization transaction.

- [ ] **Step 7: Version alias/reuse behavior**

Extend canonical uniqueness and `finalize_or_reuse_candidate_underwriting` from completed-only to immutable `completed | partial`. Exact replay sets the alias status to the canonical source status and `artifact_source_candidate_run_id`; it inserts no artifact rows. A refresh Candidate with a new nonce/fingerprint stays canonical and keeps `rerun_of_id` only as provenance.

- [ ] **Step 8: Register migration and test script**

Append idx `27` and tag `0027_named_lens_passages` to `drizzle/meta/_journal.json`. Add `tests/integration/underwriting-presentation-migration.test.ts` to `test:migrations` without changing the exact production `SAFE_REFUSAL` gate.

- [ ] **Step 9: Run Task 5 gates**

Run the focused migration command from Step 3 in a new cluster. Then run:

```bash
npm run typecheck
```

Expected: all focused migration tests PASS and TypeScript reports zero errors.

- [ ] **Step 10: Commit Task 5**

```bash
git add drizzle/0027_named_lens_passages.sql drizzle/meta/_journal.json db/schema.ts package.json tests/integration/underwriting-presentation-migration.test.ts tests/integration/schema-migrations.test.ts tests/integration/task9-finalization-authority-migration.test.ts tests/integration/underwriting-partial-terminal-migration.test.ts tests/unit/schema-declarations.test.ts
git commit -m "feat: persist named lens presentation artifacts"
```

---

### Task 6: Repository, bundle, partial, and alias implementation

**Files:**
- Create: `db/repositories/named-lens-artifacts.ts`
- Modify: `db/repositories/underwriting-artifacts.ts`
- Modify: `db/repositories/underwriting-runs.ts`
- Modify: `lib/underwriting/candidate-stage-runtime.ts`
- Test: `tests/unit/underwriting-runs.test.ts`
- Test: `tests/unit/stage-replay.test.ts`
- Test: `tests/integration/underwriting-finalization.test.ts`
- Test: `tests/integration/process-run-underwriting.test.ts`

**Interfaces:**
- Consumes: Tasks 2 and 5 contracts/RPCs.
- Produces: `NamedLensArtifactsRepository`, complete `CandidateArtifactBundle`, current/legacy read support, and correct completed/partial canonical reuse.
- Consumed by: Tasks 7–10.

- [ ] **Step 1: Write memory/Supabase parity tests**

Test reserve/settle attempts, duplicate attempt rejection, get canonical artifacts through completed and partial aliases, row-count parity, same-identity/same-fingerprint reuse, same-identity/different-fingerprint failure, cross-workspace/deal rejection, refresh run separation, and immutable final disposition/passage/presentation reads.

```ts
const aliasBundle = await repository.getByCandidateRunId(alias.id);
assert.equal(aliasBundle.sourceCandidateRunId, partialCanonical.id);
assert.equal(aliasBundle.candidate.status, "partial");
assert.deepEqual(aliasBundle.namedLensPassages, canonicalBundle.namedLensPassages);
```

- [ ] **Step 2: Run repository tests and verify failure**

```bash
node --import tsx --test --test-concurrency=1 tests/unit/underwriting-runs.test.ts tests/unit/stage-replay.test.ts tests/integration/underwriting-finalization.test.ts tests/integration/process-run-underwriting.test.ts
```

Expected: FAIL because the repositories and bundle fields do not exist.

- [ ] **Step 3: Implement attempt persistence outside finalization**

```ts
export interface NamedLensArtifactsRepository {
  reserveAttempt(input: NamedLensProviderAttemptReservation): Promise<NamedLensProviderAttempt>;
  settleAttempt(input: NamedLensProviderAttemptSettlement): Promise<NamedLensProviderAttempt>;
  listAttempts(workspaceId: string, candidateRunId: string): Promise<NamedLensProviderAttempt[]>;
}
```

Implement memory and Supabase paths. Wire `CandidateStageRuntime.runProviderAttempt()` to reserve before provider I/O and settle completed/failed/aborted afterward. Never hold a SQL transaction or Candidate row lock during provider I/O.

- [ ] **Step 4: Extend artifact bundles and row-count checks**

Add critical projection, dispositions, validated passages/segments, presentation, and attempt refs to `CandidateArtifactBundle`, `ReusableCandidateArtifacts`, `ArtifactRowCounts`, `getByCandidateRunId`, `listFinalizedForWorkspace`, and Supabase selects. Alias reads resolve `artifact_source_candidate_run_id` once and never copy child rows.

- [ ] **Step 5: Make `prepareCandidateFinalization` the fail-closed boundary**

Validate exact workspace/Deal/report/Candidate ownership, catalog cardinality, all final dispositions, positions, passage/subset provenance, selection-basis evidence, five segments, presentation order, attempt coverage, versions, fingerprints, and decision independence. Preserve legacy persisted-read mode without requiring new fields.

- [ ] **Step 6: Honor desired terminal status**

Update both memory and Supabase `finalizeCandidate()` paths to accept only `terminalStatus: "completed" | "partial"`. Require explicit framework coverage reason codes for `partial`; prohibit `partial` from overwriting decision/valuation artifacts with unavailable placeholders. Update `statusForCandidateBatch()` to keep partial terminal semantics.

- [ ] **Step 7: Implement exact replay versus refresh**

Exact replay may reuse completed or partial canonical artifacts when all fingerprints and current versions match. A refresh nonce participates in Candidate identity/fingerprint, creates a new canonical Candidate Run, and records `rerunOfId` without setting `artifactSourceCandidateRunId`.

- [ ] **Step 8: Run Task 6 tests**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 9: Commit Task 6**

```bash
git add db/repositories/named-lens-artifacts.ts db/repositories/underwriting-artifacts.ts db/repositories/underwriting-runs.ts lib/underwriting/candidate-stage-runtime.ts tests/unit/underwriting-runs.test.ts tests/unit/stage-replay.test.ts tests/integration/underwriting-finalization.test.ts tests/integration/process-run-underwriting.test.ts
git commit -m "feat: finalize named lens artifacts atomically"
```

---

### Task 7: Orchestrator DAG, policy versions, and current-run finalization

**Files:**
- Modify: `lib/underwriting/orchestrator.ts`
- Modify: `lib/underwriting/candidate-stage-runtime.ts`
- Modify: `lib/underwriting/stage-replay.ts`
- Modify: `lib/underwriting/fingerprints.ts`
- Modify: `lib/contracts/underwriting.ts`
- Modify: `worker/runner.ts`
- Modify: `worker/process-run.ts`
- Test: `tests/unit/underwriting-fingerprints.test.ts`
- Test: `tests/unit/stage-replay.test.ts`
- Test: `tests/unit/worker-runner.test.ts`
- Test: `tests/unit/belief-reversal-cold-worker.test.ts`
- Test: `tests/integration/process-run-underwriting.test.ts`
- Test: `tests/integration/underwriting-finalization.test.ts`

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: the authoritative current-run payload and exact stage/fingerprint behavior.
- Consumed by: Tasks 8–10.

- [ ] **Step 1: Write stage-order and decision-independence tests**

Assert this exact order for new runs:

```text
evidence_pack -> context_router -> valuation -> framework_catalog -> framework_lenses
-> decision -> named_lens_presentation -> narrative_drafts -> finalization
```

Prove that changing passage prose, selected order, or advisory posture cannot change formal decision, valuation, canonical typed actions, or their fingerprints; changing selection/passage/generator/presentation versions must change Candidate fingerprint and prevent old artifact reuse.

- [ ] **Step 2: Write terminal-coverage tests**

Cover 0–3 genuinely applicable valid lenses => completed with `limited_framework_coverage`; provider/lineage/passage failure => immutable partial; four or more valid plus appendix completeness => completed; decision and valuation remain preserved in partial results.

- [ ] **Step 3: Run focused tests and verify failure**

```bash
node --import tsx --test --test-concurrency=1 tests/unit/underwriting-fingerprints.test.ts tests/unit/stage-replay.test.ts tests/integration/process-run-underwriting.test.ts tests/integration/underwriting-finalization.test.ts
```

Expected: FAIL because the new stage and versions are absent.

- [ ] **Step 4: Add the deterministic presentation stage**

Extend `CandidateCheckpointSchema`/runtime policies with `named_lens_presentation`. In `createSourceGroundedCandidateExecutor`, keep framework provider calls first, then persist the independent formal decision, then run one deterministic stage that calls:

```ts
const criticalEvidence = buildDecisionCriticalEvidenceProjection(...);
const provisionalPriority = prioritizeNamedLensJudgments(...);
const groundedPassages = validateEveryEligiblePassage(...);
const placement = finalizeNamedLensPlacement(...);
const presentation = buildNamedLensSynthesis(...);
```

No final disposition/fingerprint is created before all eligible passage validation finishes.

- [ ] **Step 5: Remove new-run Top-5 naming from fingerprints**

Keep historical replay adapters intact, but replace the new-run `top-five-belief-revised-v1` admission/selection label with:

```ts
const UNDERWRITING_ADMISSION_POLICY_VERSION = "all-belief-revisions-v1";
```

Use `NAMED_LENS_SELECTION_POLICY_VERSION` only for within-report Named Lens ordering; neither policy can limit how many belief-revised companies receive Underwriting.

- [ ] **Step 6: Pin all new versions and fingerprints**

Add selection policy, passage schema, generator, presentation, taxonomy version/digest, critical-evidence projection fingerprint, final dispositions fingerprint, and presentation fingerprint to `CandidateFingerprintInput`, `createCandidateAnalysisFingerprint`, and `CandidateVersionSnapshot`. Old current-run snapshots parse only through the explicit legacy adapter.

Propagate the same immutable versions through `worker/runner.ts` and `worker/process-run.ts` when the Worker constructs or resumes an Underwriting Candidate. Reject a checkpoint whose saved version set differs from the current executor instead of silently reusing pre-passage artifacts.

- [ ] **Step 7: Derive terminal result without losing formal artifacts**

Set `terminalStatus: "partial"` only for exhausted required provider/grounding/passage coverage failures; otherwise `completed`. Include typed public reason codes. Do not route passage failure through `unavailableExecution()`, because that would discard the completed formal decision/valuation.

- [ ] **Step 8: Run Task 7 tests**

Run the command from Step 3 plus:

```bash
node --import tsx --test --test-concurrency=1 tests/unit/worker-runner.test.ts tests/unit/belief-reversal-cold-worker.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 7**

```bash
git add lib/underwriting/orchestrator.ts lib/underwriting/candidate-stage-runtime.ts lib/underwriting/stage-replay.ts lib/underwriting/fingerprints.ts lib/contracts/underwriting.ts worker/runner.ts worker/process-run.ts tests/unit/underwriting-fingerprints.test.ts tests/unit/stage-replay.test.ts tests/unit/worker-runner.test.ts tests/unit/belief-reversal-cold-worker.test.ts tests/integration/process-run-underwriting.test.ts tests/integration/underwriting-finalization.test.ts
git commit -m "feat: orchestrate evidence-ranked named lens reports"
```

---

### Task 8: Versioned read model, report API, and Finalized Chat V2

**Files:**
- Create: `lib/underwriting/presentation-version.ts`
- Modify: `lib/underwriting/read-model.ts`
- Modify: `app/api/reports/[id]/underwriting/[dealId]/route.ts`
- Modify: `lib/contracts/finalized-chat.ts`
- Modify: `lib/chat/finalized-topic.ts`
- Modify: `lib/chat/finalized-scope.ts`
- Modify: `lib/chat/finalized-projection.ts`
- Modify: `lib/chat/finalized-renderer.ts`
- Modify: `app/api/chat/route.ts`
- Create: `tests/unit/underwriting-presentation-version.test.ts`
- Modify: `tests/integration/underwriting-report-route.test.ts`
- Modify: `tests/unit/finalized-chat-contract.test.ts`
- Modify: `tests/unit/finalized-chat-projection.test.ts`
- Modify: `tests/integration/finalized-chat-route.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 5, 6, and 7 persisted artifacts.
- Produces: explicit three-way report adapters, current `CandidateUnderwritingDetail.namedLensPresentation`, and immutable `FinalizedChatProjectionV2`.
- Consumed by: Tasks 9 and 10.

- [ ] **Step 1: Write explicit version-adapter tests**

Test exact persisted identities for `legacy-pinned-23-v1`, `legacy-pre-passage-30-v1`, and `decision-first-named-lens-v1`. Dispatch may use known historical schema/version identity, never company count, date, row absence, or catalog order. Null/unknown current identity must return a visible typed integrity error.

```ts
assert.equal(resolveUnderwritingPresentationAdapter(current).kind, "current");
assert.throws(
  () => resolveUnderwritingPresentationAdapter({ schemaVersion: "mystery" }),
  /Unsupported underwriting presentation version/,
);
```

- [ ] **Step 2: Write route and Chat V2 failures first**

Assert the current report route returns persisted main order/passages/dispositions/synthesis and never reselects from raw judgments. Assert Chat answers “why selected,” exact evidence, what changes the view, and zero formal weight from saved reasons/segments. A raw judgment change with unchanged persisted presentation must not change Chat output.

- [ ] **Step 3: Run focused tests and verify failure**

```bash
node --import tsx --test --test-concurrency=1 tests/unit/underwriting-presentation-version.test.ts tests/integration/underwriting-report-route.test.ts tests/unit/finalized-chat-contract.test.ts tests/unit/finalized-chat-projection.test.ts tests/integration/finalized-chat-route.test.ts
```

Expected: FAIL because the current adapter and Chat V2 do not exist.

- [ ] **Step 4: Implement explicit presentation adapters**

```ts
export type UnderwritingPresentationAdapter =
  | { kind: "legacy_pinned_23"; schemaVersion: "legacy-pinned-23-v1" }
  | { kind: "legacy_pre_passage_30"; schemaVersion: "legacy-pre-passage-30-v1" }
  | { kind: "current"; schemaVersion: "decision-first-named-lens-v1" };
```

Keep the existing pinned adapter unchanged. Map only the finite set of known pre-contract Candidate schema versions to `legacy-pre-passage-30-v1`; do not infer from missing fields. Current dispatch requires the persisted presentation row, matching version snapshot, and exact fingerprint.

- [ ] **Step 5: Project current details only from persisted artifacts**

Extend `CandidateUnderwritingDetail` with critical projection, final dispositions, ordered passages, synthesis, first-screen refs, coverage status, and version identity. Include `partial` canonical/alias reads. Exclude authoring-only pack review, rights notes, and open issues from the public projection. Keep raw judgments available only in the audit Appendix.

- [ ] **Step 6: Update the report detail route**

Resolve the report, Deal, Candidate, canonical source bundle, and presentation adapter as one identity. For current reports, missing/cross-report presentation rows return a bounded integrity error; the route never calls a client-side selector.

- [ ] **Step 7: Add Finalized Chat V2 as a discriminated union**

Preserve `FinalizedChatProjectionV1Schema`. Add V2 artifact types for Named Lens disposition, passage segment, critical evidence projection, and presentation. Classify framework application text as `framework_application_inference`. Build claims only from persisted segments, reason codes, and `selectionBasisEvidenceIds`; never expose authoring-only metadata, reconstruct selection, impersonate a named person, or claim hidden reasoning.

- [ ] **Step 8: Run Task 8 tests**

Run the command from Step 3. Expected: PASS.

- [ ] **Step 9: Commit Task 8**

```bash
git add lib/underwriting/presentation-version.ts lib/underwriting/read-model.ts app/api/reports/[id]/underwriting/[dealId]/route.ts lib/contracts/finalized-chat.ts lib/chat/finalized-topic.ts lib/chat/finalized-scope.ts lib/chat/finalized-projection.ts lib/chat/finalized-renderer.ts app/api/chat/route.ts tests/unit/underwriting-presentation-version.test.ts tests/integration/underwriting-report-route.test.ts tests/unit/finalized-chat-contract.test.ts tests/unit/finalized-chat-projection.test.ts tests/integration/finalized-chat-route.test.ts
git commit -m "feat: read versioned named lens reports and chat"
```

---

### Task 9: Decision-first editorial UI and audit Appendix

**Files:**
- Create: `app/underwriting-passage-detail.tsx`
- Create: `app/underwriting-memo.css`
- Modify: `app/layout.tsx`
- Modify: `app/underwriting-article-view-model.ts`
- Modify: `app/underwriting-detail.tsx`
- Modify: `app/underwriting-summary.tsx`
- Modify: `app/underwriting-view-model.ts`
- Modify: `app/vsee.css` only for legacy isolation/removal of current conflicting selectors
- Create: `tests/unit/underwriting-passage-ui.test.tsx`
- Modify: `tests/unit/underwriting-article-view-model.test.ts`
- Modify: `tests/unit/underwriting-ui-task10.test.tsx`

**Interfaces:**
- Consumes: Task 8 `CandidateUnderwritingDetail` and adapter identity.
- Produces: `PassageUnderwritingDetailPanel`, first-screen memo, single-column Section 06, and complete typed Appendix.
- Consumed by: Task 10 browser/cold E2E.

- [ ] **Step 1: Use the Sites building skill and write current-renderer tests first**

Before changing website code, read and follow `sites:sites-building`. Add render tests that require the seven stable section titles plus Appendix, the first-screen decision contract, single disclosure, saved passage order, descriptive links, adjacent sample label, and no current-run `AnalystPanelSynthesis`, cards, grids, raw IDs, or repeated schema headings.

```ts
assert.match(html, /Decision Request/);
assert.match(html, /Named Lens Readings/);
assert.doesNotMatch(html, /vsee-framework-synthesis-table/);
assert.equal((html.match(/formal decision weight zero/g) ?? []).length, 1);
```

- [ ] **Step 2: Add responsive/accessibility assertions**

Require semantic headings/articles, keyboard-operable source/Appendix controls, non-color status text, no horizontal-overflow class, body copy at least 16px, line height at least 1.55, and mobile single column. Preserve the six existing HTML section-heading test boundaries.

- [ ] **Step 3: Run focused UI tests and verify failure**

```bash
node --import tsx --test --test-concurrency=1 tests/unit/underwriting-passage-ui.test.tsx tests/unit/underwriting-article-view-model.test.ts tests/unit/underwriting-ui-task10.test.tsx
```

Expected: FAIL because the current renderer still uses raw judgment synthesis/table markup.

- [ ] **Step 4: Separate legacy and current renderers**

Keep the old body reachable only through `LegacyUnderwritingDetailPanel`. Dispatch `decision-first-named-lens-v1` to `PassageUnderwritingDetailPanel`. Remove the real NUL byte from `app/underwriting-article-view-model.ts`. Delete current-run calls to `buildNamedLensReadings(detail.judgments)` and `buildAnalystPanel`; do not retain a fallback that filters foreign IDs.

- [ ] **Step 5: Implement the first-screen decision request**

At 1280×720 before scrolling, show formal decision or ceiling, exact IC ask, two or three cited decisive reasons, primary tension/no-grounded-tension statement, immediate typed next action, Underwriting status, and adjacent permanent sample/synthetic label when prior sample memory is used. Evidence ledger and raw identities remain below the decision narrative.

- [ ] **Step 6: Implement continuous Named Lens prose**

Render the section disclosure once. For each persisted `selected_main` passage, render display name, natural two-to-four paragraph prose assembled from the five saved segments, adjacent descriptive source links, and no repeated `Premise/Support/Counterargument/Unknown/Conclusion` labels. Preserve 180–260 words per passage and total ≤1,600 without renderer truncation.

- [ ] **Step 7: Implement the audit Appendix**

Collapse Appendix-only passages by default. Include all complete unselected perspectives plus typed context-inapplicable, abstained, unavailable, duplicate, and withheld reasons; raw framework/evidence/Source Revision/XTrace identities; full missing-input matrix; provider/version/fingerprint metadata; and permanent draft/sample notices. Invalid passage body text never renders.

- [ ] **Step 8: Add isolated editorial CSS**

Load `underwriting-memo.css` after `vsee.css`. Use a readable max-width, single-column flow, 16–18px body copy, 1.6–1.75 line height, restrained 24–32px subsection headings, and spacing instead of boxes. At 390×844 retain one column, ≥16px copy, touch-sized controls, visible focus, and no horizontal overflow. Verify new wrappers do not break direct-child selectors.

- [ ] **Step 9: Run Task 9 tests**

Run the command from Step 3 and:

```bash
npm run typecheck
npm run lint
```

Expected: UI tests PASS, TypeScript zero errors, and no new ESLint errors.

- [ ] **Step 10: Commit Task 9**

```bash
git add app/underwriting-passage-detail.tsx app/underwriting-memo.css app/layout.tsx app/underwriting-article-view-model.ts app/underwriting-detail.tsx app/underwriting-summary.tsx app/underwriting-view-model.ts app/vsee.css tests/unit/underwriting-passage-ui.test.tsx tests/unit/underwriting-article-view-model.test.ts tests/unit/underwriting-ui-task10.test.tsx
git commit -m "feat: render decision-first underwriting prose"
```

---

### Task 10: Golden prose, cold E2E, browser acceptance, and isolated Staging

**Files:**
- Modify: `tests/helpers/belief-reversal-e2e-pipeline.ts`
- Modify: `tests/helpers/belief-reversal-e2e-verifier.ts`
- Modify: `tests/helpers/belief-reversal-quality-parity.ts`
- Modify: `tests/integration/belief-reversal-demo-e2e.test.ts`
- Create: `tests/fixtures/underwriting/irregular-named-lens-golden-v1.json`
- Create: `tests/fixtures/underwriting/irregular-named-lens-golden-v1.txt`
- Create: `tests/unit/underwriting-prose-golden.test.ts`
- Modify: `docs/demo-runbook.md`
- Create: `docs/qa/2026-08-10-underwriting-prose-named-lens-acceptance.md`

**Interfaces:**
- Consumes: Tasks 1–9 complete vertical slice.
- Produces: deterministic structural regression, current-30 end-to-end proof, legacy replay proof, browser acceptance, and real-provider Staging evidence.

- [ ] **Step 1: Write golden editorial assertions**

Create a full synthetic Irregular memorandum fixture with explicit assumptions and public-source bindings. Test seven numbered sections plus Appendix, decision-first order, 4–6 complete passages, 180–260 words each, total ≤1,600, causal mechanism, countercase, unknown/evidence request, conditional posture, descriptive citations, professional language, and absence of raw enums/IDs/repeated `Unavailable`/AI filler. The golden is an editorial regression artifact, not evidence of production model quality.

- [ ] **Step 2: Extend the deterministic observer**

Make `createBeliefReversalDeterministicProviders()` return structurally complete and deliberately distinguishable passage candidates in the same framework call. Bind exact component question/source/evidence refs and include supportive, negative, abstained, unavailable, duplicate, and withheld test cases. Keep provider identity `deterministic-e2e-observer-v1` and permanent fixture labeling.

- [ ] **Step 3: Extend current-30 cold E2E verification**

For every belief-revised company, assert one immutable Underwriting job, exact critical projection, all catalog dispositions, complete applicable passages or typed failures, selected order, current presentation identity, terminal completed/partial state, report route, and Finalized Chat access. Assert no Underwriting for monitor/no-material-change/unavailable CompanyAnalyses.

- [ ] **Step 4: Add replay and legacy assertions**

Run exact replay and assert zero duplicate attempts, dispositions, passages, segments, presentations, jobs, and Chat artifacts. Run refresh and assert a new canonical Candidate without mutating old artifacts. Replay immutable pinned-23 and a pre-contract finalized-30 report through their adapters and compare saved fingerprints/content byte-for-byte.

- [ ] **Step 5: Run focused golden/E2E tests**

```bash
node --import tsx --test --test-concurrency=1 tests/unit/underwriting-prose-golden.test.ts tests/unit/belief-reversal-e2e-pipeline.test.ts tests/unit/belief-reversal-e2e-verifier.test.ts
```

Then, on a fresh isolated PostgreSQL 17.6 cluster:

```bash
npm run test:e2e:belief-reversal
```

Expected: current Scan has exactly 30 eligible Deals and 30 CompanyAnalyses; every belief revision has one terminal Underwriting presentation; legacy artifacts remain unchanged.

- [ ] **Step 6: Run complete automated verification**

Run each command independently and record exact totals:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run verify:web-parser-boundary
npm run test:migrations
npm run test:migrations:production-pg176
git diff --check
```

The migration commands use separate fresh PostgreSQL 17.6 clusters and the required in-namespace `socat` proxy. The production-profile gate must print the exact `SAFE_REFUSAL — production forward migration remains blocked` string and must not apply 0019+ to production.

- [ ] **Step 7: Run browser fixture and manual acceptance**

Use `npm run demo:belief-reversal:browser`, then the `browser:control-in-app-browser` skill. Check 1280×720 and 390×844: first-screen decision contract before scrolling; single-column Section 06; readable 16px+ body; saved 4–6 order; one disclosure; real descriptive source links; complete collapsed Appendix; adjacent sample labels; keyboard focus; non-color status; no horizontal overflow. Open pinned-23, pre-contract-30, current completed, current partial, and unknown-version error views.

- [ ] **Step 8: Observe real provider output in isolated Staging**

Use `sites:sites-hosting` only after a verified non-production Supabase URL/key/database, separate Sites/Cloudflare Web target, and hosted scan Worker identity are configured on the same commit. Startup must reject production project identifiers. Review at least one positive revision, one negative revision, one genuine disagreement, one abstention, and one isolated adversarial withheld seam. Do not write the adversarial case into canonical seed/report data.

- [ ] **Step 9: Write QA evidence and update runbook**

Record commit, database/Worker identities without secrets, migration range, test totals, E2E run/report/Candidate IDs, fingerprints, screenshots, real-provider observations versus deterministic fixture results, known limitations, and explicit production non-access in `docs/qa/2026-08-10-underwriting-prose-named-lens-acceptance.md`.

- [ ] **Step 10: Commit Task 10**

```bash
git add tests/helpers/belief-reversal-e2e-pipeline.ts tests/helpers/belief-reversal-e2e-verifier.ts tests/helpers/belief-reversal-quality-parity.ts tests/integration/belief-reversal-demo-e2e.test.ts tests/fixtures/underwriting/irregular-named-lens-golden-v1.json tests/fixtures/underwriting/irregular-named-lens-golden-v1.txt tests/unit/underwriting-prose-golden.test.ts docs/demo-runbook.md docs/qa/2026-08-10-underwriting-prose-named-lens-acceptance.md
git commit -m "test: verify named lens underwriting end to end"
```

---

## Execution order and parallelism

Execute Tasks 1–2 first. Task 3 then establishes the pure deterministic policy. After Task 3, Task 4 provider work and Task 5 database work may proceed in parallel because they share only the committed contracts. Task 6 integrates repositories after Task 5. Task 7 requires Tasks 3, 4, and 6. Task 8 follows Task 7. Task 9 follows Task 8. Task 10 is the final integrated verification and isolated deployment gate.

Each task receives a fresh implementation subagent, followed by specification review and code-quality review. The primary Agent resolves overlaps, runs the task's focused tests, and commits only after review findings are closed.
