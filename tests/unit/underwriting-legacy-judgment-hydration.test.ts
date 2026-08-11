import assert from "node:assert/strict";
import test from "node:test";

const reviewedLegacyVersion = {
  schemaVersion: "framework-judgment-v1",
  settingsFingerprint: "belief-reversal-task12-v1",
  applicationCommit: "task12-local-e2e",
} as const;

// Structurally exact 3b6c348 persisted shape. In particular, the immutable
// payload predates both the judgment counterevidence boundary and the advisory
// decision-taxonomy fields now required for newly finalized artifacts.
function reviewedLegacyJudgment(): Record<string, unknown> {
  const id =
    "framework_judgment:e4f326f7-0345-4502-b7f3-bb38bc000869:framework_advisory:metrick_yasuda_vc_finance_public_frameworks_v0_1:b5bd68298a4d4b38:fafcd6acbcc681c427e949765e39615e0df15edfcfde63b86e1ae71fc1b8a604";
  return {
    id,
    unknowns: [
      "Core-only analysis: geography is unavailable, so this framework cannot be applied to an immutable supported context.",
    ],
    claimEdges: [{
      claimItemId: id,
      dependencyType: "framework_ref",
      dependencyItemId:
        "framework_advisory:metrick_yasuda_vc_finance_public_frameworks_v0_1:b5bd68298a4d4b38",
    }],
    conclusion: "abstain",
    confidence: {
      judgment: "low",
      applicability: "low",
      evidenceCoverage: "low",
      evidenceStrength: "low",
      sourceReliability: "low",
    },
    fingerprint:
      "sha256:fafcd6acbcc681c427e949765e39615e0df15edfcfde63b86e1ae71fc1b8a604",
    limitations: [
      "Core-only analysis: geography is unavailable, so this framework cannot be applied to an immutable supported context.",
      "This advisory lens has formal decision weight zero and cannot create or modify the deterministic investment decision.",
    ],
    analysisType: "framework_judgment",
    applicability: "unavailable",
    frameworkCardId:
      "framework_advisory:metrick_yasuda_vc_finance_public_frameworks_v0_1:b5bd68298a4d4b38",
    frameworkVersion: "0.1.0",
    strongestSupport: null,
    frameworkMetadata: {
      packId: "metrick_yasuda_vc_finance_public_frameworks_v0_1",
      context: {
        stage: "series_a",
        geography: "unavailable",
        securityType: "preferred",
        businessModel: "enterprise_ai",
      },
      notices: {
        noEndorsement:
          "This experimental product synthesis is not an endorsement by any named person or organization.",
        experimentalOnly:
          "This advisory lens has formal decision weight zero and cannot create or modify the deterministic investment decision.",
        noPrivateReasoning:
          "This synthesis uses only the retained public-source paraphrases and does not claim or reconstruct private reasoning or hidden chain of thought.",
      },
      sources: [],
      packName:
        "Metrick / Yasuda Venture Capital Finance Public Frameworks — Research Draft",
      applicable: false,
      components: [],
      packReview: {
        openIssues: [
          "Complete content and rights review before seed conversion.",
        ],
        contentStatus: "draft",
        publicationStatus: "unpublished",
      },
      packVersion: "0.1.0",
      researchCutoff: "2026-07-28",
      packDescription:
        "Ten independently reviewable cards spanning VC risk and returns, total valuation, the VC Method, ownership and dilution, LP economics, preferred securities, multi-round waterfalls, and staged innovation finance.",
      sourceCatalogId:
        "metrick_yasuda_vc_finance_public_sources_v0_1",
      componentCardIds: [],
      authorizationDigest:
        "sha256:b5bd68298a4d4b38ce8509437521e1ab5f10ca2cede0e1cbf621e08a40f6aff4",
      formalDecisionWeight: "0",
    },
    unusedEvidenceItemIds: [
      "assumption:underwriting_context_series_a_enterprise_ai_v1:scenario_price_multiplier:base",
    ],
    counterEvidenceItemIds: [],
    supportEvidenceItemIds: [],
    strongestCounterargument: null,
  };
}

async function loadParser() {
  const repository = await import(
    "../../db/repositories/underwriting-artifacts"
  );
  return repository.parsePersistedFrameworkJudgments;
}

test("the underwriting artifact repository remains runtime importable", async () => {
  assert.equal(typeof await loadParser(), "function");
});

test("hydrates only the exact reviewed 3b6c348 legacy judgment tuple without rewriting payload semantics", async () => {
  const parsePersistedFrameworkJudgments = await loadParser();
  const persisted = reviewedLegacyJudgment();
  const before = structuredClone(persisted);

  const [hydrated] = parsePersistedFrameworkJudgments({
    judgments: [persisted],
    versionSnapshot: reviewedLegacyVersion,
  });

  assert.deepEqual(hydrated, before);
  assert.deepEqual(persisted, before);
  assert.equal("counterevidenceBoundary" in hydrated!, false);
  const metadata = hydrated!.frameworkMetadata as Record<string, unknown>;
  assert.equal("decisionTaxonomyVersion" in metadata, false);
  assert.equal("decisionTaxonomyDigest" in metadata, false);
  assert.equal("decisionTaxonomyBindings" in metadata, false);
});

test("a normalized null refresh nonce does not invent a current generation marker", async () => {
  const parsePersistedFrameworkJudgments = await loadParser();
  const persisted = reviewedLegacyJudgment();
  const [hydrated] = parsePersistedFrameworkJudgments({
    judgments: [persisted],
    versionSnapshot: {
      ...reviewedLegacyVersion,
      refreshNonce: null,
    },
  });

  assert.deepEqual(hydrated, persisted);
});

test("current persisted hydration permits only metadata-free core judgments on the legacy branch", async () => {
  const parsePersistedFrameworkJudgments = await loadParser();
  const { createCurrentNamedLensFinalizationFixture } = await import(
    "../helpers/current-named-lens-finalization"
  );
  const fixture = createCurrentNamedLensFinalizationFixture();

  const hydrated = parsePersistedFrameworkJudgments({
    judgments: fixture.finalization.judgments,
    versionSnapshot: fixture.finalization.versionSnapshot,
  });

  assert.deepEqual(hydrated, fixture.finalization.judgments);
  assert.ok(hydrated.some(({ frameworkMetadata }) =>
    frameworkMetadata === undefined
  ));
  assert.ok(hydrated.some(({ frameworkMetadata }) =>
    frameworkMetadata !== undefined
  ));
});

test("fails closed for wrong or mixed legacy judgment identities", async () => {
  const parsePersistedFrameworkJudgments = await loadParser();
  for (const [field, value] of [
    ["schemaVersion", "framework-judgment-v0"],
    ["settingsFingerprint", "unreviewed-settings"],
    ["applicationCommit", "unreviewed-commit"],
  ] as const) {
    assert.throws(() => parsePersistedFrameworkJudgments({
      judgments: [reviewedLegacyJudgment()],
      versionSnapshot: {
        ...reviewedLegacyVersion,
        [field]: value,
      },
    }));
  }

  assert.throws(() => parsePersistedFrameworkJudgments({
    judgments: [reviewedLegacyJudgment()],
    versionSnapshot: {
      ...reviewedLegacyVersion,
      namedLensSelectionPolicyVersion: "named-lens-selection-policy-v1",
    },
  }));
});
