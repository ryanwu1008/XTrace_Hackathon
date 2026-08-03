import assert from "node:assert/strict";
import test from "node:test";

import {
  createMemoryUnderwritingReferencesRepository,
  createSupabaseUnderwritingReferencesRepository,
} from "../../db/repositories/underwriting-references";
import { BALANCED_POLICY_VALUES } from "../../seed/underwriting/balanced-policy-v1";
import {
  SYNTHETIC_FRAMEWORK_PACK_ID,
} from "../../seed/underwriting/framework-pack-v1";

test("a new workspace receives an immutable Balanced recommended policy", async () => {
  const repository = createMemoryUnderwritingReferencesRepository({
    now: () => new Date("2026-07-29T18:00:00.000Z"),
  });

  const first = await repository.activeFundPolicy("workspace_one");
  assert.equal(first.version, 1);
  assert.equal(first.source, "recommended_policy");
  assert.deepEqual(first.values, BALANCED_POLICY_VALUES);

  first.values.riskPreference = "mutated";
  const reread = await repository.activeFundPolicy("workspace_one");
  assert.equal(reread.values.riskPreference, "balanced");
});

test("custom policy, recommended overwrite diff, and restore each append a version", async () => {
  const repository = createMemoryUnderwritingReferencesRepository({
    now: () => new Date("2026-07-29T18:00:00.000Z"),
  });
  const balanced = await repository.activeFundPolicy("workspace_one");
  const customValues = structuredClone(BALANCED_POLICY_VALUES);
  customValues.riskPreference = "conservative";
  customValues.initialCheckMax = "5000000";

  const custom = await repository.saveCustomPolicy({
    workspaceId: "workspace_one",
    actorId: "user_owner",
    expectedActiveVersionId: balanced.id,
    values: customValues,
  });
  assert.equal(custom.version, 2);
  assert.equal(custom.source, "user_custom");

  const reapplied = await repository.applyBalancedDefaults({
    workspaceId: "workspace_one",
    actorId: "user_owner",
    expectedActiveVersionId: custom.id,
  });
  assert.equal(reapplied.snapshot.version, 3);
  assert.deepEqual(reapplied.overwrittenDiff, [
    {
      field: "initialCheckMax",
      previousValue: "5000000",
      recommendedValue: "8000000",
      source: "recommended_policy",
    },
    {
      field: "riskPreference",
      previousValue: "conservative",
      recommendedValue: "balanced",
      source: "recommended_policy",
    },
  ]);

  const restored = await repository.restorePolicyVersion({
    workspaceId: "workspace_one",
    actorId: "user_owner",
    versionId: custom.id,
  });
  assert.equal(restored.version, 4);
  assert.equal(restored.source, "user_custom");
  assert.deepEqual(restored.values, customValues);
  assert.deepEqual(
    (await repository.listFundPolicyVersions("workspace_one")).map(
      (snapshot) => snapshot.version,
    ),
    [4, 3, 2, 1],
  );
});

test("four Slice-1 profiles resolve US and Global requests without borrowing a benchmark", async () => {
  const repository = createMemoryUnderwritingReferencesRepository();

  const seedSaas = await repository.resolveContext({
    stage: "seed",
    businessModel: "b2b_saas",
    geography: "us",
    securityType: "preferred",
    asOfDate: "2026-07-29",
  });
  const seriesAi = await repository.resolveContext({
    stage: "series_a",
    businessModel: "enterprise_ai",
    geography: "global",
    securityType: "preferred",
    asOfDate: "2026-07-29",
  });
  const irregular = await repository.resolveContext({
    stage: "series_a",
    businessModel: "enterprise_ai",
    geography: "unavailable",
    securityType: "preferred",
    asOfDate: "2026-07-29",
  });

  assert.equal(seedSaas.kind, "resolved");
  assert.equal(seriesAi.kind, "resolved");
  assert.equal(irregular.kind, "resolved");
  if (
    seedSaas.kind !== "resolved"
    || seriesAi.kind !== "resolved"
    || irregular.kind !== "resolved"
  ) {
    assert.fail("Supported Slice-1 contexts must resolve");
  }
  assert.notEqual(
    seedSaas.value.criticalEvidenceProfileId,
    seriesAi.value.criticalEvidenceProfileId,
  );
  assert.equal(seedSaas.value.benchmarkCompatibility, "exact");
  assert.equal(seriesAi.value.benchmarkCompatibility, "unavailable");
  assert.equal(seriesAi.value.benchmarkPackId, null);
  assert.deepEqual({
    analysisMode: irregular.value.analysisMode,
    geography: irregular.value.geography,
    benchmarkPackId: irregular.value.benchmarkPackId,
    benchmarkCompatibility: irregular.value.benchmarkCompatibility,
  }, {
    analysisMode: "core_only",
    geography: "unavailable",
    benchmarkPackId: null,
    benchmarkCompatibility: "unavailable",
  });
  assert.equal(seedSaas.value.frameworkPackId, SYNTHETIC_FRAMEWORK_PACK_ID);

  const unsupported = await repository.resolveContext({
    stage: "pre_seed",
    businessModel: "marketplace",
    geography: "us",
    securityType: "safe",
    asOfDate: "2026-07-29",
  } as never);
  assert.deepEqual(unsupported, {
    kind: "unsupported",
    reason:
      "Vertical Slice 1 supports only Seed or Series A B2B SaaS or Enterprise AI preferred-equity contexts.",
  });
});

test("resolves the exact published Critical Evidence and stage benchmark payloads", async () => {
  const repository = createMemoryUnderwritingReferencesRepository();
  const resolved = await repository.resolveContext({
    stage: "series_a",
    businessModel: "b2b_saas",
    geography: "us",
    securityType: "preferred",
    asOfDate: "2026-07-29",
  });
  assert.equal(resolved.kind, "resolved");
  if (resolved.kind !== "resolved") assert.fail("Context must resolve");

  const profile = await repository.getCriticalEvidenceProfile(
    resolved.value.criticalEvidenceProfileId,
  );
  const benchmark = await repository.getSelectedBenchmark({
    packId: resolved.value.benchmarkPackId!,
    stage: resolved.value.stage,
    asOfDate: resolved.value.asOfDate,
  });

  assert.equal(profile?.publicationStatus, "published");
  assert.match(profile?.definitionFingerprint ?? "", /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    profile?.fields.find(({ fieldId }) => fieldId === "company_identity")
      ?.minimumModelInput,
    true,
  );
  assert.equal(benchmark?.packId, "benchmark_pack_synthetic_us_software_v1");
  assert.equal(benchmark?.value, "80000000");
  assert.equal(benchmark?.currency, "USD");
  assert.equal(benchmark?.staleAfter, "2027-01-25");
  assert.match(
    benchmark?.definitionFingerprint ?? "",
    /^sha256:[0-9a-f]{64}$/,
  );
});

test("2030 benchmark lookup fails closed in memory and Supabase", async () => {
  const memory = createMemoryUnderwritingReferencesRepository();
  assert.equal(await memory.getSelectedBenchmark({
    packId: "benchmark_pack_synthetic_us_software_v1",
    stage: "seed",
    asOfDate: "2030-01-01",
  }), null);

  const requestedUrls: string[] = [];
  const supabase = createSupabaseUnderwritingReferencesRepository({
    url: "https://database.example.test",
    serviceRoleKey: "secret",
    fetchImpl: async (request) => {
      const url = String(request);
      requestedUrls.push(url);
      if (url.includes("/benchmark_packs?")) {
        return Response.json([{
          id: "benchmark_pack_synthetic_us_software_v1",
          version: "1",
          publication_status: "published",
          retrieval_date: "2026-07-29",
          stale_after_days: 180,
        }]);
      }
      if (url.includes("/benchmark_entries?")) {
        return Response.json([{
          id: "benchmark_seed_reported_valuation_v1",
          version: "1",
          value: "24000000",
          currency: "USD",
          effective_at: "2026-07-29",
        }]);
      }
      throw new Error(`Unexpected URL ${url}`);
    },
  });

  assert.equal(await supabase.getSelectedBenchmark({
    packId: "benchmark_pack_synthetic_us_software_v1",
    stage: "seed",
    asOfDate: "2030-01-01",
  }), null);
  assert.equal(
    requestedUrls.some((url) => url.includes("/benchmark_entries?")),
    false,
    "a stale pack must fail closed before an entry can be selected",
  );
});

test("Supabase benchmark selection filters out entries newer than its as-of date", async () => {
  const requestedUrls: string[] = [];
  const repository = createSupabaseUnderwritingReferencesRepository({
    url: "https://database.example.test",
    serviceRoleKey: "secret",
    fetchImpl: async (request) => {
      const url = String(request);
      requestedUrls.push(url);
      if (url.includes("/benchmark_packs?")) {
        return Response.json([{
          id: "benchmark_pack_synthetic_us_software_v1",
          version: "1",
          publication_status: "published",
          retrieval_date: "2026-07-29",
          stale_after_days: 180,
        }]);
      }
      return Response.json([{
        id: "benchmark_entry_synthetic_seed_valuation_v1",
        value: "24000000",
        currency: "USD",
        effective_at: "2026-07-29",
      }]);
    },
  });

  const benchmark = await repository.getSelectedBenchmark({
    packId: "benchmark_pack_synthetic_us_software_v1",
    stage: "seed",
    asOfDate: "2026-08-01",
  });

  assert.ok(benchmark);
  assert.equal(benchmark.effectiveAt, "2026-07-29");
  assert.ok(requestedUrls.some((url) =>
    url.includes("effective_at=lte.2026-08-01")
  ));
});

test("Supabase reads immutable structured Critical Evidence fields from the profile child table", async () => {
  const requestedUrls: string[] = [];
  const repository = createSupabaseUnderwritingReferencesRepository({
    url: "https://database.example.test",
    serviceRoleKey: "secret",
    fetchImpl: async (request) => {
      const url = String(request);
      requestedUrls.push(url);
      if (url.includes("/critical_evidence_profiles?")) {
        return Response.json([{
          id: "critical_evidence_seed_b2b_saas_v1",
          version: "1",
          publication_status: "published",
          required_fields: ["legacy_coarse_label"],
        }]);
      }
      if (url.includes("/critical_evidence_profile_fields?")) {
        return Response.json([{
          field_id: "company_identity",
          critical: true,
          minimum_model_input: true,
          accepted_assertion_statuses: [
            "reported",
            "corroborated",
            "verified",
          ],
          accepted_freshness: ["current"],
        }]);
      }
      throw new Error(`Unexpected URL ${url}`);
    },
  });

  const profile = await repository.getCriticalEvidenceProfile(
    "critical_evidence_seed_b2b_saas_v1",
  );

  assert.equal(profile?.id, "critical_evidence_seed_b2b_saas_v1");
  assert.equal(profile?.version, "1");
  assert.equal(profile?.publicationStatus, "published");
  assert.deepEqual(profile?.fields, [{
    fieldId: "company_identity",
    critical: true,
    minimumModelInput: true,
    acceptedAssertionStatuses: [
      "reported",
      "corroborated",
      "verified",
    ],
    acceptedFreshness: ["current"],
  }]);
  assert.match(profile?.definitionFingerprint ?? "", /^sha256:[0-9a-f]{64}$/);
  assert.ok(requestedUrls.some((url) =>
    url.includes("/critical_evidence_profile_fields?")
  ));
});

test("the executable pack contains only published product-owned synthetic fixtures", async () => {
  const repository = createMemoryUnderwritingReferencesRepository();
  const pack = await repository.getFrameworkPack(SYNTHETIC_FRAMEWORK_PACK_ID);

  assert.ok(pack);
  assert.equal(pack.synthetic, true);
  assert.equal(pack.publicationStatus, "published");
  assert.equal(pack.cards.length, 8);
  assert.equal(
    pack.cards.every((card) =>
      card.synthetic
      && card.publicationStatus === "published"
      && card.attribution === "Product-owned synthetic fixture"
      && card.formalDecisionWeight === "0"
    ),
    true,
  );
  assert.doesNotMatch(
    JSON.stringify(pack),
    /Peter Thiel|Sequoia|Hamilton Helmer|Bessemer|Damodaran|privateBody|objectKey/i,
  );
});

test("the Supabase repository appends policy versions only through the controlled RPC", async () => {
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  const repository = createSupabaseUnderwritingReferencesRepository({
    url: "https://database.example.test",
    serviceRoleKey: "secret",
    fetchImpl: async (input, init = {}) => {
      const url = String(input);
      const method = init.method ?? "GET";
      const body = typeof init.body === "string"
        ? JSON.parse(init.body)
        : null;
      requests.push({ url, method, body });
      if (url.includes("/rpc/activate_fund_policy_version")) {
        return Response.json({
          id: "fund_policy:workspace_one:v2",
          workspaceId: "workspace_one",
          version: 2,
          source: "user_custom",
          values: body.p_request.values,
          createdByUserId: "user_owner",
          createdAt: "2026-07-29T18:00:00.000Z",
        });
      }
      return Response.json([]);
    },
  });

  await repository.saveCustomPolicy({
    workspaceId: "workspace_one",
    actorId: "user_owner",
    expectedActiveVersionId: "fund_policy:workspace_one:v1",
    values: BALANCED_POLICY_VALUES,
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.method, "POST");
  assert.match(requests[0]?.url ?? "", /rpc\/activate_fund_policy_version$/);
  assert.deepEqual(requests[0]?.body, {
    p_request: {
      workspaceId: "workspace_one",
      actorId: "user_owner",
      expectedActiveVersionId: "fund_policy:workspace_one:v1",
      action: "custom",
      values: BALANCED_POLICY_VALUES,
    },
  });
});

test("the Supabase public framework projection excludes non-published cards and private source fields", async () => {
  const repository = createSupabaseUnderwritingReferencesRepository({
    url: "https://database.example.test",
    serviceRoleKey: "secret",
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes("/framework_packs?")) {
        return Response.json([{
          id: SYNTHETIC_FRAMEWORK_PACK_ID,
          version: "1",
          title: "Synthetic pack",
          synthetic: true,
          publication_status: "published",
        }]);
      }
      return Response.json([
        {
          position: 1,
          framework_cards: {
            id: "published_card",
            version: "1",
            title: "Published",
            synthetic: true,
            publication_status: "published",
            attribution: "Product-owned synthetic fixture",
            approved_neutral_paraphrase: "Safe public summary.",
            locator: "synthetic://framework/1",
            limitations: ["Synthetic."],
            rights_status: "product_owned_synthetic",
            formal_decision_weight: "0",
            private_body: "must never leave the platform boundary",
          },
        },
        {
          position: 2,
          framework_cards: {
            id: "draft_card",
            version: "1",
            title: "Draft",
            synthetic: true,
            publication_status: "draft",
            attribution: "Product-owned synthetic fixture",
            approved_neutral_paraphrase: "Not executable.",
            locator: "synthetic://framework/2",
            limitations: [],
            rights_status: "product_owned_synthetic",
            formal_decision_weight: "0",
          },
        },
      ]);
    },
  });

  const pack = await repository.getFrameworkPack(
    SYNTHETIC_FRAMEWORK_PACK_ID,
  );
  assert.ok(pack);
  assert.deepEqual(pack.cards.map((card) => card.id), ["published_card"]);
  assert.doesNotMatch(JSON.stringify(pack), /private_body|platform boundary/i);
});

test("Supabase context resolution stays pinned to the same v1 profile as memory when v2 exists", async () => {
  let requestedUrl = "";
  const input = {
    stage: "seed" as const,
    businessModel: "b2b_saas" as const,
    geography: "us" as const,
    securityType: "preferred" as const,
    asOfDate: "2026-07-29",
  };
  const repository = createSupabaseUnderwritingReferencesRepository({
    url: "https://database.example.test",
    serviceRoleKey: "secret",
    fetchImpl: async (request) => {
      requestedUrl = String(request);
      return Response.json([
        {
          id: "underwriting_context_seed_b2b_saas_v2",
          context_version: "2",
          stage: "seed",
          business_model: "b2b_saas",
          critical_evidence_profile_id: "critical_evidence_seed_b2b_saas_v2",
          us_benchmark_pack_id: "benchmark_pack_synthetic_us_software_v2",
          us_benchmark_compatibility: "broad_compatible",
          global_benchmark_compatibility: "unavailable",
          valuation_method_policy_id: "valuation_method_seed_b2b_saas_v2",
          decision_policy_id: "decision_policy_seed_b2b_saas_v2",
          framework_pack_id: "framework_pack_synthetic_universal_saas_ai_v2",
          publication_status: "published",
        },
        {
          id: "underwriting_context_seed_b2b_saas_v1",
          context_version: "1",
          stage: "seed",
          business_model: "b2b_saas",
          critical_evidence_profile_id: "critical_evidence_seed_b2b_saas_v1",
          us_benchmark_pack_id: "benchmark_pack_synthetic_us_software_v1",
          us_benchmark_compatibility: "exact",
          global_benchmark_compatibility: "unavailable",
          valuation_method_policy_id: "valuation_method_seed_b2b_saas_v1",
          decision_policy_id: "decision_policy_seed_b2b_saas_v1",
          framework_pack_id: SYNTHETIC_FRAMEWORK_PACK_ID,
          publication_status: "published",
        },
      ]);
    },
  });

  const [supabase, memory] = await Promise.all([
    repository.resolveContext(input),
    createMemoryUnderwritingReferencesRepository().resolveContext(input),
  ]);

  assert.deepEqual(supabase, memory);
  assert.match(
    requestedUrl,
    /id=eq\.underwriting_context_seed_b2b_saas_v1/,
  );
  assert.match(requestedUrl, /context_version=eq\.1/);
});

test("Supabase and memory preserve unavailable geography as Core-only with no benchmark", async () => {
  const requests: string[] = [];
  const input = {
    stage: "series_a" as const,
    businessModel: "enterprise_ai" as const,
    geography: "unavailable" as const,
    securityType: "preferred" as const,
    asOfDate: "2026-08-01",
  };
  const repository = createSupabaseUnderwritingReferencesRepository({
    url: "https://database.example.test",
    serviceRoleKey: "secret",
    fetchImpl: async (request) => {
      requests.push(String(request));
      return Response.json([{
        id: "underwriting_context_series_a_enterprise_ai_v1",
        context_version: "1",
        stage: "series_a",
        business_model: "enterprise_ai",
        critical_evidence_profile_id:
          "critical_evidence_series_a_enterprise_ai_v1",
        us_benchmark_pack_id: "benchmark_pack_synthetic_us_software_v1",
        us_benchmark_compatibility: "exact",
        global_benchmark_compatibility: "unavailable",
        valuation_method_policy_id:
          "valuation_method_series_a_enterprise_ai_v1",
        decision_policy_id: "decision_policy_series_a_enterprise_ai_v1",
        framework_pack_id: SYNTHETIC_FRAMEWORK_PACK_ID,
        publication_status: "published",
      }]);
    },
  });

  const [supabase, memory] = await Promise.all([
    repository.resolveContext(input),
    createMemoryUnderwritingReferencesRepository().resolveContext(input),
  ]);

  assert.deepEqual(supabase, memory);
  assert.equal(requests.length, 1);
  assert.equal(supabase.kind, "resolved");
  if (supabase.kind !== "resolved") assert.fail("Context must resolve");
  assert.deepEqual({
    analysisMode: supabase.value.analysisMode,
    geography: supabase.value.geography,
    benchmarkPackId: supabase.value.benchmarkPackId,
    benchmarkCompatibility: supabase.value.benchmarkCompatibility,
  }, {
    analysisMode: "core_only",
    geography: "unavailable",
    benchmarkPackId: null,
    benchmarkCompatibility: "unavailable",
  });
});
