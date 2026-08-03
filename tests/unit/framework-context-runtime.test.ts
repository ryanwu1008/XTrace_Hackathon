import assert from "node:assert/strict";
import test from "node:test";

import type {
  ResolvedUnderwritingContext,
} from "../../lib/contracts/underwriting";
import {
  RESEARCH_FRAMEWORK_CATALOG_VERSION,
} from "../../lib/underwriting/frameworks/research-loader";
import {
  createContextAwareFrameworkLensResolver,
} from "../../lib/underwriting/frameworks/service";

const context: ResolvedUnderwritingContext = {
  id: "underwriting_context_seed_b2b_saas_v1",
  contextVersion: "1",
  stage: "seed",
  businessModel: "b2b_saas",
  geography: "us",
  securityType: "preferred",
  asOfDate: "2026-07-29",
  criticalEvidenceProfileId: "critical_evidence_seed_b2b_saas_v1",
  benchmarkPackId: "benchmark_pack_synthetic_us_software_v1",
  benchmarkCompatibility: "exact",
  valuationMethodPolicyId: "valuation_method_seed_b2b_saas_v1",
  decisionPolicyId: "decision_policy_seed_b2b_saas_v1",
  frameworkPackId: "framework_pack_synthetic_universal_saas_ai_v1",
};

const execution = {
  provider: "anthropic",
  model: "test-model",
  promptVersion: "framework-lens-v1",
  schemaVersion: "framework-judgment-v1",
  settingsFingerprint: "balanced-underwriting-v1",
  applicationCommit: "framework-context-test",
};

test("caches the exact authorized catalog and service by immutable deal context and catalog version", async () => {
  const resolver = createContextAwareFrameworkLensResolver({
    execution,
    client: {
      async complete() {
        throw new Error("Context resolution must not invoke the provider.");
      },
    },
  });

  const [first, sameSelection] = await Promise.all([
    resolver.resolve(context),
    resolver.resolve({
      ...context,
      id: "same-selection-different-context-id",
      contextVersion: "2",
      asOfDate: "2026-07-30",
    }),
  ]);
  const differentSelections = await Promise.all([
    resolver.resolve({
      ...context,
      id: "underwriting_context_series_a_b2b_saas_v1",
      stage: "series_a",
    }),
    resolver.resolve({
      ...context,
      id: "underwriting_context_seed_enterprise_ai_v1",
      businessModel: "enterprise_ai",
    }),
    resolver.resolve({
      ...context,
      id: "underwriting_context_seed_b2b_saas_global_v1",
      analysisMode: "core_only",
      geography: "global",
      benchmarkPackId: null,
      benchmarkCompatibility: "unavailable",
    }),
  ]);

  assert.strictEqual(sameSelection, first);
  assert.strictEqual(sameSelection.catalog, first.catalog);
  assert.strictEqual(sameSelection.service, first.service);
  assert.equal(first.catalogVersion, RESEARCH_FRAMEWORK_CATALOG_VERSION);
  assert.equal(first.catalog.version, RESEARCH_FRAMEWORK_CATALOG_VERSION);
  assert.equal(first.catalog.fingerprint, first.catalogFingerprint);
  assert.equal(
    first.catalog.authorization.corpusDigest,
    first.corpusDigest,
  );
  assert.equal(new Set([first, ...differentSelections]).size, 4);
  assert.equal(
    new Set([first.catalog, ...differentSelections.map(({ catalog }) =>
      catalog
    )]).size,
    4,
  );
  assert.equal(
    new Set([first.service, ...differentSelections.map(({ service }) =>
      service
    )]).size,
    4,
  );
});

test("partitions exact catalog and service instances by research security type", async () => {
  const resolver = createContextAwareFrameworkLensResolver({
    execution,
    client: {
      async complete() {
        throw new Error("Context resolution must not invoke the provider.");
      },
    },
  });
  const preferred = await resolver.resolve(context);
  let convertible:
    | Awaited<ReturnType<typeof resolver.resolve>>
    | undefined;

  await assert.doesNotReject(async () => {
    convertible = await resolver.resolve({
      ...context,
      id: "underwriting_context_seed_b2b_saas_convertible_v1",
      securityType: "convertible",
    });
  });
  assert.ok(convertible);
  assert.equal(convertible.catalog.context.securityType, "convertible");
  assert.notStrictEqual(convertible, preferred);
  assert.notStrictEqual(convertible.catalog, preferred.catalog);
  assert.notStrictEqual(convertible.service, preferred.service);
  assert.notEqual(
    convertible.catalogFingerprint,
    preferred.catalogFingerprint,
  );
  const sameConvertible = await resolver.resolve({
    ...context,
    id: "same-convertible-selection-different-context-id",
    contextVersion: "2",
    asOfDate: "2026-07-30",
    securityType: "convertible",
  });
  assert.strictEqual(sameConvertible, convertible);
  assert.strictEqual(sameConvertible.catalog, convertible.catalog);
  assert.strictEqual(sameConvertible.service, convertible.service);
});

test("unavailable geography resolves and replays one catalog service whose cards explicitly abstain", async () => {
  let providerCalls = 0;
  const resolver = createContextAwareFrameworkLensResolver({
    execution,
    client: {
      async complete() {
        providerCalls += 1;
        return "{}";
      },
    },
  });
  const unavailableContext: ResolvedUnderwritingContext = {
    ...context,
    id: "underwriting_context_series_a_enterprise_ai_unavailable_v1",
    analysisMode: "core_only",
    stage: "series_a",
    businessModel: "enterprise_ai",
    geography: "unavailable",
    benchmarkPackId: null,
    benchmarkCompatibility: "unavailable",
  };

  const first = await resolver.resolve(unavailableContext);
  const replay = await resolver.resolve({
    ...unavailableContext,
    id: "same-unavailable-selection",
  });
  assert.strictEqual(replay, first);
  assert.equal(first.catalog.composites.every(({ experimentalAdvisory }) =>
    experimentalAdvisory.applicable === false
    && experimentalAdvisory.components.length === 0
    && experimentalAdvisory.componentCardIds.length === 0
  ), true);

  const result = await first.service.runAll({
    candidate: {
      id: "candidate_irregular",
      batchId: "batch_1",
      workspaceId: "workspace_1",
      dealId: "deal_irregular",
      status: "running",
      candidateAnalysisFingerprint: `sha256:${"a".repeat(64)}`,
      rerunOfId: null,
      createdAt: "2026-07-29T10:02:00.000Z",
      finalizedAt: null,
    },
    pack: {
      id: "evidence_pack_irregular",
      version: 1,
      workspaceId: "workspace_1",
      dealId: "deal_irregular",
      asOfDate: unavailableContext.asOfDate,
      sourceRevisionIds: ["revision_irregular"],
      facts: [],
      assumptions: [],
      conflicts: [],
      coverage: {
        minimumModelInputsComplete: false,
        criticalEvidenceComplete: false,
        missingFieldIds: ["reported_valuation"],
        blockingConflictIds: [],
        decisionCeiling: null,
        underwritingStatus: "unavailable",
        reasonCodes: ["MISSING_MINIMUM_MODEL_INPUTS"],
      },
      createdAt: "2026-07-29T10:01:00.000Z",
    },
    context: unavailableContext,
    calculations: [],
  });
  const serviceReplay = await first.service.runAll({
    candidate: {
      id: "candidate_irregular",
      batchId: "batch_1",
      workspaceId: "workspace_1",
      dealId: "deal_irregular",
      status: "running",
      candidateAnalysisFingerprint: `sha256:${"a".repeat(64)}`,
      rerunOfId: null,
      createdAt: "2026-07-29T10:02:00.000Z",
      finalizedAt: null,
    },
    pack: {
      id: "evidence_pack_irregular",
      version: 1,
      workspaceId: "workspace_1",
      dealId: "deal_irregular",
      asOfDate: unavailableContext.asOfDate,
      sourceRevisionIds: ["revision_irregular"],
      facts: [],
      assumptions: [],
      conflicts: [],
      coverage: {
        minimumModelInputsComplete: false,
        criticalEvidenceComplete: false,
        missingFieldIds: ["reported_valuation"],
        blockingConflictIds: [],
        decisionCeiling: null,
        underwritingStatus: "unavailable",
        reasonCodes: ["MISSING_MINIMUM_MODEL_INPUTS"],
      },
      createdAt: "2026-07-29T10:01:00.000Z",
    },
    context: unavailableContext,
    calculations: [],
  });

  assert.equal(providerCalls, 0);
  assert.deepEqual(serviceReplay, result);
  assert.ok(result.judgments.length > 0);
  assert.equal(result.judgments.every((judgment) =>
    judgment.applicability === "unavailable"
    && judgment.conclusion === "abstain"
    && judgment.limitations.some((limitation) =>
      /core-only.*geography.*unavailable/i.test(limitation)
    )
  ), true);
  assert.deepEqual(result.disagreements, []);
});

test("aborts an in-flight real catalog resolution before authorizing a service", async () => {
  const resolver = createContextAwareFrameworkLensResolver({
    execution,
    client: {
      async complete() {
        throw new Error("An aborted catalog must not invoke the provider.");
      },
    },
  });
  const controller = new AbortController();
  const cancellation = new Error("candidate framework stage timed out");
  const pending = resolver.resolve(context, controller.signal);
  controller.abort(cancellation);

  await assert.rejects(
    pending,
    (error) => error === cancellation,
  );
});

test("isolates one caller abort while a concurrent same-key catalog resolution completes", async () => {
  const resolver = createContextAwareFrameworkLensResolver({
    execution,
    client: {
      async complete() {
        throw new Error("Context resolution must not invoke the provider.");
      },
    },
  });
  const controller = new AbortController();
  const cancellation = new Error("one candidate framework stage timed out");
  const aborted = resolver.resolve(context, controller.signal);
  const survivor = resolver.resolve({
    ...context,
    id: "same-selection-live-candidate",
    contextVersion: "2",
    asOfDate: "2026-07-30",
  });
  controller.abort(cancellation);

  await assert.rejects(aborted, (error) => error === cancellation);
  const authorized = await survivor;
  const reused = await resolver.resolve(context);

  assert.strictEqual(reused, authorized);
  assert.strictEqual(reused.catalog, authorized.catalog);
  assert.strictEqual(reused.service, authorized.service);
});
