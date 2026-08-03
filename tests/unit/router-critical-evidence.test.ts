import assert from "node:assert/strict";
import test from "node:test";

import type { EvidencePack, Fact } from "../../lib/contracts/evidence";
import type { ResolvedUnderwritingContext } from "../../lib/contracts/underwriting";
import {
  createContextRouter,
  type CandidateIdentityEvidence,
  type CriticalEvidenceProfile,
} from "../../lib/underwriting/router";

function claim(
  value: string,
  basis: "confirmed" | "source_explicit" | "derived" = "source_explicit",
) {
  return { value, basis, evidenceItemId: `evidence:${basis}:${value}` };
}

function identity(
  overrides: Partial<CandidateIdentityEvidence> = {},
): CandidateIdentityEvidence {
  return {
    asOfDate: "2026-07-29",
    companyIdentity: [claim("company_1", "confirmed")],
    stage: [claim("seed")],
    businessModel: [claim("b2b_saas")],
    geography: [claim("us")],
    securityType: [claim("preferred")],
    ...overrides,
  };
}

function fact(field: string, overrides: Partial<Fact> = {}): Fact {
  return {
    id: `fact:${field}`,
    analysisType: "fact",
    provenanceOrigin: "uploaded_document",
    field,
    value: field === "company_identity" ? "company_1" : "24000000",
    unit: field === "company_identity" ? null : "currency",
    currency: field === "company_identity" ? null : "USD",
    periodStart: null,
    periodEnd: null,
    publishedAt: null,
    eventAt: null,
    retrievedAt: "2026-07-29T10:00:00.000Z",
    sourceRevisionId: "revision_1",
    locator: {
      kind: "text_range",
      start: 0,
      end: 10,
      excerpt: "Evidence.",
    },
    sourceRole: "management",
    assertionStatus: "reported",
    verificationMethod: null,
    freshness: "current",
    acceptedForGate: true,
    ...overrides,
  };
}

function pack(facts: Fact[]): EvidencePack {
  return {
    id: "pack_1",
    version: 1,
    workspaceId: "workspace_1",
    dealId: "deal_1",
    asOfDate: "2026-07-29",
    sourceRevisionIds: ["revision_1"],
    facts,
    assumptions: [],
    conflicts: [],
    coverage: {
      minimumModelInputsComplete: true,
      criticalEvidenceComplete: true,
      missingFieldIds: [],
      blockingConflictIds: [],
      decisionCeiling: "Invest Candidate",
      underwritingStatus: "available",
      reasonCodes: [],
    },
    createdAt: "2026-07-29T10:00:01.000Z",
  };
}

const profile: CriticalEvidenceProfile = {
  id: "critical_evidence_seed_b2b_saas_v1",
  version: "1",
  publicationStatus: "published",
  definitionFingerprint: `sha256:${"c".repeat(64)}`,
  fields: [
    {
      fieldId: "company_identity",
      critical: true,
      minimumModelInput: true,
      acceptedAssertionStatuses: ["reported", "corroborated", "verified"],
      acceptedFreshness: ["current", "unknown"],
    },
    {
      fieldId: "reported_valuation",
      critical: true,
      minimumModelInput: false,
      acceptedAssertionStatuses: ["reported", "corroborated", "verified"],
      acceptedFreshness: ["current"],
    },
  ],
};

const fullCoverageContext: ResolvedUnderwritingContext = {
  id: "underwriting_context_seed_b2b_saas_v1",
  contextVersion: "1",
  analysisMode: "full",
  stage: "seed",
  businessModel: "b2b_saas",
  geography: "us",
  securityType: "preferred",
  asOfDate: "2026-07-29",
  criticalEvidenceProfileId: profile.id,
  benchmarkPackId: "benchmark_pack_synthetic_us_software_v1",
  benchmarkCompatibility: "exact",
  valuationMethodPolicyId: "valuation_method_seed_b2b_saas_v1",
  decisionPolicyId: "decision_policy_seed_b2b_saas_v1",
  frameworkPackId: "framework_pack_synthetic_universal_saas_ai_v1",
};

test("router precedence is confirmed, source-explicit, then derived", () => {
  const router = createContextRouter();
  const result = router.resolve(identity({
    stage: [
      claim("series_a", "derived"),
      claim("seed", "confirmed"),
      claim("series_a", "source_explicit"),
    ],
  }));

  assert.equal(result.kind, "resolved");
  if (result.kind !== "resolved") assert.fail("Expected a resolved context");
  assert.equal(result.context?.stage, "seed");
  assert.equal(result.analysisMode, "full");
});

test("a reviewed preferred-security assumption resolves core-only and never a full Invest Candidate ceiling", () => {
  const router = createContextRouter();
  const result = router.resolve(identity({
    securityType: [{
      value: "preferred",
      basis: "assumption" as never,
      evidenceItemId: "semantic-field-security-assumption",
    }],
  }));

  assert.equal(result.kind, "resolved");
  if (result.kind !== "resolved") assert.fail("Expected a resolved context");
  assert.equal(result.analysisMode, "core_only");
  assert.equal(result.decisionCeiling, "Advance");
  assert.equal(result.context?.securityType, "preferred");
});

test("an explicitly unavailable geography persists core-only without a benchmark", () => {
  const router = createContextRouter();
  const result = router.resolve(identity({
    geography: [claim("unavailable")],
    securityType: [{
      value: "preferred",
      basis: "assumption",
      evidenceItemId: "semantic-field-security-assumption",
    }],
  }));

  assert.equal(result.kind, "resolved");
  if (result.kind !== "resolved") assert.fail("Expected a resolved context");
  assert.equal(result.analysisMode, "core_only");
  assert.equal(result.decisionCeiling, "Advance");
  assert.deepEqual(result.context && {
    analysisMode: result.context.analysisMode,
    geography: result.context.geography,
    benchmarkPackId: result.context.benchmarkPackId,
    benchmarkCompatibility: result.context.benchmarkCompatibility,
  }, {
    analysisMode: "core_only",
    geography: "unavailable",
    benchmarkPackId: null,
    benchmarkCompatibility: "unavailable",
  });
});

test("equal winning claims preserve all evidence IDs independent of input order", () => {
  const router = createContextRouter();
  const stageA = {
    value: " Seed ",
    basis: "source_explicit" as const,
    evidenceItemId: "stage:a",
  };
  const stageB = {
    value: "seed",
    basis: "source_explicit" as const,
    evidenceItemId: "stage:b",
  };
  const first = router.resolve(identity({
    stage: [stageA, stageB, stageA],
  }));
  const second = router.resolve(identity({
    stage: [stageB, stageA, stageA],
  }));

  assert.deepEqual(first, second);
  assert.equal(first.kind, "resolved");
  if (first.kind !== "resolved") assert.fail("Expected a resolved context");
  assert.deepEqual(first.evidenceItemIds, [
    "evidence:confirmed:company_1",
    "evidence:source_explicit:b2b_saas",
    "evidence:source_explicit:preferred",
    "evidence:source_explicit:us",
    "stage:a",
    "stage:b",
  ]);
});

test("conflicting primary context values require confirmation instead of nearest-cohort routing", () => {
  const router = createContextRouter();
  const result = router.resolve(identity({
    stage: [claim("seed"), claim("series_a")],
  }));

  assert.deepEqual(result, {
    kind: "needs_confirmation",
    fields: ["stage"],
  });
});

test("missing company identity is unavailable and unsupported context is Core-only", () => {
  const router = createContextRouter();
  assert.deepEqual(router.resolve(identity({ companyIdentity: [] })), {
    kind: "unavailable",
    reasonCodes: ["COMPANY_IDENTITY_MISSING"],
  });

  const unsupported = router.resolve(identity({
    businessModel: [claim("marketplace")],
  }));
  assert.equal(unsupported.kind, "resolved");
  if (unsupported.kind !== "resolved") {
    assert.fail("Unsupported contexts should retain Core-only analysis");
  }
  assert.equal(unsupported.analysisMode, "core_only");
  assert.equal(unsupported.decisionCeiling, "Advance");
  assert.equal(unsupported.context, null);
});

test("full routing requires published matching critical and valuation dependencies", () => {
  const selectedContext = {
    id: "underwriting_context_seed_b2b_saas_review_v1",
    contextVersion: "1" as const,
    stage: "seed" as const,
    businessModel: "b2b_saas" as const,
    criticalEvidenceProfileId: "critical_profile_review_v1",
    usBenchmarkPackId: "benchmark_pack_review_v1",
    usBenchmarkCompatibility: "exact" as const,
    valuationMethodPolicyId: "valuation_policy_review_v1",
    decisionPolicyId: "decision_policy_review_v1",
    frameworkPackId: "framework_pack_review_v1",
  };
  const publishedCritical = {
    id: selectedContext.criticalEvidenceProfileId,
    stage: "seed" as const,
    businessModel: "b2b_saas" as const,
    publicationStatus: "published" as const,
  };
  const publishedValuation = {
    id: selectedContext.valuationMethodPolicyId,
    stage: "seed" as const,
    businessModel: "b2b_saas" as const,
    publicationStatus: "published" as const,
  };

  const withoutAvailability = createContextRouter({
    contexts: [{
      ...selectedContext,
      criticalEvidenceProfileId: "critical_evidence_seed_b2b_saas_v1",
      valuationMethodPolicyId: "valuation_method_seed_b2b_saas_v1",
    }],
  }).resolve(identity());
  assert.equal(withoutAvailability.kind, "resolved");
  if (withoutAvailability.kind !== "resolved") {
    assert.fail("Expected resolved routing");
  }
  assert.equal(withoutAvailability.analysisMode, "core_only");
  assert.equal(withoutAvailability.decisionCeiling, "Advance");

  for (const referenceAvailability of [
    {
      criticalEvidenceProfiles: [],
      valuationMethodPolicies: [publishedValuation],
    },
    {
      criticalEvidenceProfiles: [publishedCritical],
      valuationMethodPolicies: [{
        ...publishedValuation,
        publicationStatus: "draft" as const,
      }],
    },
    {
      criticalEvidenceProfiles: [publishedCritical],
      valuationMethodPolicies: [{
        ...publishedValuation,
        stage: "series_a" as const,
      }],
    },
  ]) {
    const result = createContextRouter({
      contexts: [selectedContext],
      referenceAvailability,
    }).resolve(identity());
    assert.equal(result.kind, "resolved");
    if (result.kind !== "resolved") assert.fail("Expected resolved routing");
    assert.equal(result.context?.id, selectedContext.id);
    assert.equal(result.analysisMode, "core_only");
    assert.equal(result.decisionCeiling, "Advance");
  }

  const supported = createContextRouter({
    contexts: [selectedContext],
    referenceAvailability: {
      criticalEvidenceProfiles: [publishedCritical],
      valuationMethodPolicies: [publishedValuation],
    },
  }).resolve(identity());
  assert.equal(supported.kind, "resolved");
  if (supported.kind !== "resolved") assert.fail("Expected resolved routing");
  assert.equal(supported.analysisMode, "full");
  assert.equal(supported.decisionCeiling, "Invest Candidate");
});

test("coverage makes identity absence unavailable and round-price absence Advance-only", () => {
  const router = createContextRouter();
  const noIdentity = router.evaluateCoverage({
    pack: pack([fact("reported_valuation")]),
    profile,
    context: fullCoverageContext,
  });
  const noRoundPrice = router.evaluateCoverage({
    pack: pack([fact("company_identity")]),
    profile,
    context: fullCoverageContext,
  });

  assert.deepEqual(
    {
      minimumModelInputsComplete: noIdentity.minimumModelInputsComplete,
      underwritingStatus: noIdentity.underwritingStatus,
      decisionCeiling: noIdentity.decisionCeiling,
      missing: noIdentity.missingFieldIds,
    },
    {
      minimumModelInputsComplete: false,
      underwritingStatus: "unavailable",
      decisionCeiling: null,
      missing: ["company_identity"],
    },
  );
  assert.deepEqual(
    {
      minimumModelInputsComplete: noRoundPrice.minimumModelInputsComplete,
      criticalEvidenceComplete: noRoundPrice.criticalEvidenceComplete,
      underwritingStatus: noRoundPrice.underwritingStatus,
      decisionCeiling: noRoundPrice.decisionCeiling,
      missing: noRoundPrice.missingFieldIds,
    },
    {
      minimumModelInputsComplete: true,
      criticalEvidenceComplete: false,
      underwritingStatus: "available",
      decisionCeiling: "Advance",
      missing: ["reported_valuation"],
    },
  );
});

test("otherwise-complete US core-only coverage persists an explained Advance ceiling", () => {
  const coverage = createContextRouter().evaluateCoverage({
    pack: pack([fact("company_identity"), fact("reported_valuation")]),
    profile,
    context: { ...fullCoverageContext, analysisMode: "core_only" },
  });
  assert.equal(coverage.minimumModelInputsComplete, true);
  assert.equal(coverage.criticalEvidenceComplete, true);
  assert.equal(coverage.decisionCeiling, "Advance");
  assert.ok(coverage.reasonCodes.includes("CORE_ONLY_ANALYSIS_CEILING"));
});

test("only critical material open conflicts become coverage blockers", () => {
  const router = createContextRouter();
  const candidate = pack([
    fact("company_identity"),
    fact("reported_valuation"),
    fact("arr", { id: "fact:arr:left", value: "1000000" }),
    fact("arr", {
      id: "fact:arr:right",
      sourceRevisionId: "revision_2",
      value: "2000000",
    }),
  ]);
  candidate.sourceRevisionIds.push("revision_2");
  candidate.conflicts = [
    {
      id: "conflict:arr",
      field: "arr",
      leftFactId: "fact:arr:left",
      rightFactId: "fact:arr:right",
      materialityRuleId: "arr_materiality_v1",
      material: true,
      status: "open",
      resolutionFactId: null,
      resolutionReason: null,
    },
  ];
  const arrProfile: CriticalEvidenceProfile = {
    ...profile,
    fields: [
      ...profile.fields,
      {
        fieldId: "arr",
        critical: true,
        minimumModelInput: false,
        acceptedAssertionStatuses: ["reported", "verified"],
        acceptedFreshness: ["current"],
      },
    ],
  };

  const coverage = router.evaluateCoverage({
    pack: candidate,
    profile: arrProfile,
    context: fullCoverageContext,
  });
  assert.deepEqual(coverage.blockingConflictIds, ["conflict:arr"]);
  assert.equal(coverage.decisionCeiling, "Advance");
});
