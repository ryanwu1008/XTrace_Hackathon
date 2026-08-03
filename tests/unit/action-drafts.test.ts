import assert from "node:assert/strict";
import test from "node:test";

import {
  ActionDraftSchema,
  type DecisionResult,
  type FrameworkDisagreement,
  type FrameworkJudgment,
  type MissingEvidenceItem,
  type ResolvedUnderwritingContext,
} from "../../lib/contracts/underwriting";
import {
  createActionDraftGenerator,
} from "../../lib/underwriting/action-drafts";
import { toPublicActionDraft } from "../../lib/underwriting/read-model";
import {
  authorizedResearchComposites,
  loadResearchFrameworkCatalog,
} from "../../lib/underwriting/frameworks/research-loader";
import { SYNTHETIC_FRAMEWORK_PACK } from "../../seed/underwriting/framework-pack-v1";

const decision: DecisionResult = {
  id: "decision_1",
  analysisType: "final_synthesis",
  companyQuality: "pass",
  priceAttractiveness: "mixed",
  fundFit: "pass",
  decision: "Advance",
  decisionCeiling: "Advance",
  hardVeto: false,
  firedRules: [],
  blockingEvidenceItemIds: ["retention"],
  claimEdges: [],
  confidence: "medium",
};

const missingEvidence: MissingEvidenceItem[] = [{
  fieldId: "retention",
  label: "Current net revenue retention",
  reasonCode: "MISSING_CRITICAL_EVIDENCE",
  mostLikelyDecisionImpact: "Could change Price Attractiveness.",
}];

const generator = createActionDraftGenerator({
  workspaceId: "workspace_1",
  now: () => new Date("2026-07-29T12:00:00.000Z"),
});

const canonicalReopenAction = {
  kind: "reopen_diligence",
  scope: "deal",
  priority: "standard",
  visibility: "internal_only",
} as const;
const authoritativeDraftMetadata = {
  dealStatus: "passed" as const,
  beliefDirection: "positive" as const,
  actions: [canonicalReopenAction],
};

test("ActionDraft v2 requires permanent safety, policy, status, action, and delivery metadata", () => {
  const draft = {
    schemaVersion: "action-draft-v2",
    safety: "status_safe",
    deliveryMode: "draft_only",
    draftPolicyVersion: "status-safe-action-draft-v2",
    actionPolicyVersion: "belief-action-policy-v1",
    id: "action_draft:candidate_1:founder_email",
    workspaceId: "workspace_1",
    candidateRunId: "candidate_1",
    dealStatus: "passed",
    beliefDirection: "positive",
    actions: [canonicalReopenAction],
    missingEvidence,
    format: "founder_email",
    channel: "email",
    audienceType: "founder",
    body: [
      "DRAFT ONLY — NOT SENT",
      "Please share the following current evidence for review:",
      "- Current net revenue retention",
      "This draft is limited to evidence collection and neutral sharing instructions.",
    ].join("\n"),
    createdAt: "2026-07-29T12:00:00.000Z",
    updatedAt: "2026-07-29T12:00:00.000Z",
  };

  assert.deepEqual(ActionDraftSchema.parse(draft), draft);
  for (const mutation of [
    { schemaVersion: "action-draft-v1" },
    { safety: "legacy_unclassified" },
    { deliveryMode: "sendable" },
    { draftPolicyVersion: "unknown-draft-policy" },
    { actionPolicyVersion: "unknown-action-policy" },
    { dealStatus: "unknown" },
    { beliefDirection: "bullish" },
    { format: "internal_memo", channel: "email" },
    { body: "Please share current customer evidence for review." },
    { dealStatus: "invested" },
    {
      actions: [{
        kind: "deprioritize",
        scope: "deal",
        priority: "standard",
        visibility: "internal_only",
      }],
    },
    {
      dealStatus: "invested",
      beliefDirection: "negative",
      actions: [{
        kind: "pause_follow_on",
        scope: "portfolio",
        priority: "high",
        visibility: "internal_only",
      }, {
        kind: "portfolio_risk_review",
        scope: "portfolio",
        priority: "high",
        visibility: "internal_only",
      }],
      format: "founder_email",
      channel: "email",
      audienceType: "founder",
    },
  ]) {
    assert.throws(() => ActionDraftSchema.parse({ ...draft, ...mutation }));
  }
  for (const unsafeBody of [
    "DRAFT ONLY — NOT SENT\nWe passed on the company last year.",
    "DRAFT ONLY — NOT SENT\nOur view is now negative.",
    "DRAFT ONLY — NOT SENT\nYou remain on our watchlist.",
    "DRAFT ONLY — NOT SENT\nWe chose not to invest.",
    "DRAFT ONLY — NOT SENT\nWe are revisiting our prior decision.",
    [
      "DRAFT ONLY — NOT SENT",
      "Please share the following current evidence for review:",
      "- A caller-invented evidence label",
      "This draft is limited to evidence collection and neutral sharing instructions.",
    ].join("\n"),
  ]) {
    assert.throws(() => ActionDraftSchema.parse({
      ...draft,
      body: unsafeBody,
    }));
  }
});

test("legacy action drafts project as draft-only and never claim status-safe classification", () => {
  const legacy = ActionDraftSchema.parse({
    id: "legacy_draft_1",
    workspaceId: "workspace_1",
    candidateRunId: "candidate_1",
    channel: "email",
    audienceType: "founder",
    body: "Legacy saved body.",
    createdAt: "2026-07-29T12:00:00.000Z",
    updatedAt: "2026-07-29T12:00:00.000Z",
  });

  assert.deepEqual(toPublicActionDraft(legacy), {
    id: "legacy_draft_1",
    candidateRunId: "candidate_1",
    schemaVersion: "legacy-action-draft-v1",
    safety: "legacy_unclassified",
    deliveryMode: "draft_only",
    draftPolicyVersion: null,
    actionPolicyVersion: null,
    dealStatus: null,
    beliefDirection: null,
    actions: [],
    missingEvidence: [],
    format: null,
    channel: "email",
    audienceType: "founder",
    body: "Legacy saved body.",
    createdAt: "2026-07-29T12:00:00.000Z",
    updatedAt: "2026-07-29T12:00:00.000Z",
  });
});

test("status-safe draft generation follows the exact action matrix", () => {
  const cases = [{
    dealStatus: "passed",
    beliefDirection: "positive",
    actions: [canonicalReopenAction],
    formats: [
      "internal_memo",
      "founder_email",
      "founder_sms",
      "founder_linkedin",
      "diligence_request",
    ],
  }, {
    dealStatus: "invested",
    beliefDirection: "positive",
    actions: [{
      kind: "evaluate_follow_on",
      scope: "portfolio",
      priority: "standard",
      visibility: "internal_only",
    }],
    formats: ["internal_memo", "founder_email", "diligence_request"],
  }, {
    dealStatus: "evaluating",
    beliefDirection: "mixed",
    actions: [{
      kind: "continue_monitoring",
      scope: "deal",
      priority: "standard",
      visibility: "internal_only",
    }],
    formats: ["internal_memo"],
  }, {
    dealStatus: "invested",
    beliefDirection: "negative",
    actions: [{
      kind: "pause_follow_on",
      scope: "portfolio",
      priority: "high",
      visibility: "internal_only",
    }, {
      kind: "portfolio_risk_review",
      scope: "portfolio",
      priority: "high",
      visibility: "internal_only",
    }],
    formats: ["internal_memo"],
  }] as const;

  for (const item of cases) {
    const drafts = generator.generate({
      candidateRunId: "candidate_1",
      decision,
      missingEvidence,
      recommendedNextSteps: [],
      dealStatus: item.dealStatus,
      beliefDirection: item.beliefDirection,
      actions: item.actions,
    } as never);
    assert.deepEqual(
      drafts.map((draft) => (draft as { format?: string }).format),
      item.formats,
      `${item.dealStatus}/${item.beliefDirection}`,
    );
  }
});

test("external status-safe drafts contain only neutral evidence requests and no internal sentinel material", () => {
  const sentinel = "CALLER_INTERNAL_SENTINEL_DO_NOT_DISCLOSE";
  const drafts = generator.generate({
    candidateRunId: "candidate_1",
    decision,
    missingEvidence,
    recommendedNextSteps: [sentinel],
    dealStatus: "passed",
    beliefDirection: "positive",
    actions: [canonicalReopenAction],
  } as never);
  const external = drafts.filter((draft) =>
    (draft as { audienceType: string }).audienceType === "founder"
  );
  assert.equal(external.length, 4);
  for (const draft of external) {
    assert.match(draft.body, /draft only/i);
    assert.match(draft.body, /evidence/i);
    assert.doesNotMatch(
      draft.body,
      new RegExp([
        sentinel,
        "Formal decision",
        "Decision ceiling",
        "Confidence",
        "Advance",
        "company quality",
        "price attractiveness",
        "fund fit",
        "framework",
        "portfolio",
        "follow-on",
        "reopen",
        "passed",
        "positive",
      ].join("|"), "i"),
    );
  }
});

test("internal status-safe memo separates the formal result, authoritative action, and missing evidence", () => {
  const [memo] = generator.generate({
    candidateRunId: "candidate_1",
    decision,
    missingEvidence,
    recommendedNextSteps: ["CALLER_TEXT_MUST_NOT_SELECT_ACTION"],
    dealStatus: "passed",
    beliefDirection: "positive",
    actions: [canonicalReopenAction],
  } as never);

  assert.equal((memo as { format?: string }).format, "internal_memo");
  assert.match(memo.body, /formal underwriting result/i);
  assert.match(memo.body, /Advance/);
  assert.match(memo.body, /status-aware action/i);
  assert.match(memo.body, /reopen internal diligence/i);
  assert.match(memo.body, /Current net revenue retention/);
  assert.doesNotMatch(memo.body, /CALLER_TEXT_MUST_NOT_SELECT_ACTION/);
});

test("creates exactly five deterministic status-safe draft-only artifacts", () => {
  const input = {
    candidateRunId: "candidate_1",
    decision,
    missingEvidence,
    recommendedNextSteps: [
      "Request a current cohort-retention table.",
      "Schedule an internal pricing review.",
    ],
    ...authoritativeDraftMetadata,
  };
  const first = generator.generate(input);
  const second = generator.generate(input);

  assert.deepEqual(first, second);
  assert.deepEqual(first.map(({ channel }) => channel), [
    "internal",
    "email",
    "sms",
    "linkedin",
    "email",
  ]);
  assert.deepEqual(first.map(({ audienceType }) => audienceType), [
    "internal",
    "founder",
    "founder",
    "founder",
    "founder",
  ]);
  assert.equal(
    first.every((draft) => ActionDraftSchema.safeParse(draft).success),
    true,
  );
  assert.match(first[0]!.body, /Advance/);
  assert.match(first[4]!.body, /Current net revenue retention/);
});

test("never persists addressing, delivery, sending, or provider fields", () => {
  const drafts = generator.generate({
    candidateRunId: "candidate_1",
    decision,
    missingEvidence,
    recommendedNextSteps: ["Review the saved evidence."],
    ...authoritativeDraftMetadata,
  });
  const forbidden = new Set([
    "recipient",
    "recipients",
    "to",
    "handle",
    "deliveryState",
    "deliveryStatus",
    "send",
    "sendMethod",
    "provider",
    "providerId",
    "publishedAt",
    "sentAt",
  ]);

  for (const draft of drafts) {
    assert.deepEqual(Object.keys(draft).sort(), [
      "actionPolicyVersion",
      "actions",
      "audienceType",
      "beliefDirection",
      "body",
      "candidateRunId",
      "channel",
      "createdAt",
      "dealStatus",
      "deliveryMode",
      "draftPolicyVersion",
      "format",
      "id",
      "missingEvidence",
      "safety",
      "schemaVersion",
      "updatedAt",
      "workspaceId",
    ]);
    assert.equal(
      Object.keys(draft).some((key) => forbidden.has(key)),
      false,
    );
  }
});

test("keeps email, SMS, and LinkedIn bodies unchanged when advisory artifacts are supplied", async () => {
  const advisory = await persistedAdvisoryFixture();
  const baseInput = {
    candidateRunId: "candidate_1",
    decision,
    missingEvidence,
    recommendedNextSteps: ["Review the saved evidence."],
    ...authoritativeDraftMetadata,
  };
  const baseline = generator.generate(baseInput);
  const withAdvisory = generator.generate({
    ...baseInput,
    judgments: advisory.judgments,
    disagreements: advisory.disagreements,
  });

  assert.deepEqual(
    withAdvisory.filter(({ audienceType }) => audienceType === "founder")
      .map(({ body }) => body),
    baseline.filter(({ audienceType }) => audienceType === "founder")
      .map(({ body }) => body),
  );
});

test("renders authorized persisted advisory lineage and conflicts only in the internal memo", async () => {
  const advisory = await persistedAdvisoryFixture();
  const drafts = generator.generate({
    candidateRunId: "candidate_1",
    decision,
    missingEvidence,
    recommendedNextSteps: ["Review the saved evidence."],
    ...authoritativeDraftMetadata,
    judgments: advisory.judgments,
    disagreements: advisory.disagreements,
  });
  const internalMemo = drafts.find((draft) =>
    "format" in draft && draft.format === "internal_memo"
  );
  assert.ok(internalMemo);

  for (const draft of [internalMemo]) {
    assert.match(
      draft.body,
      /EXPERIMENTAL ADVISORY OPINIONS — DRAFT ONLY/,
    );
    assert.match(
      draft.body,
      /Peter Thiel Public Frameworks — Research Draft/,
    );
    assert.match(
      draft.body,
      /Pack ID: peter_thiel_public_frameworks_v0_1; version: 0\.1\.0/,
    );
    assert.match(
      draft.body,
      /Source catalog ID: peter_thiel_public_sources_v0_1; research cutoff: 2026-07-28/,
    );
    assert.match(
      draft.body,
      /Formal decision weight: 0 \(experimental advisory; not a published formal decision factor\)/,
    );
    assert.doesNotMatch(draft.body, /Product-synthesis notice:/);
    assert.doesNotMatch(draft.body, /No-endorsement notice:/);
    assert.doesNotMatch(draft.body, /No-private-reasoning notice:/);
    assert.doesNotMatch(
      draft.body,
      /Component qualifications and limitations:/,
    );
    assert.match(draft.body, /PT-01 @ 0\.1\.0 — Contrarian Truth \/ Secret/);
    assert.match(
      draft.body,
      /PT-P2-CS183-01 \| https:\/\/blakemasters\.tumblr\.com\/post\/20400301508\/cs183class1 \| web_section: Three questions and contrarian\/business question/,
    );
    assert.match(
      draft.body,
      /Advisory support: A differentiated wedge is supported by saved customer evidence\./,
    );
    assert.match(
      draft.body,
      /Advisory counterevidence: The cohort evidence may instead support the consensus explanation\./,
    );
    assert.match(
      draft.body,
      /Public limitations: Public-source synthesis cannot establish private investor reasoning\./,
    );
    assert.doesNotMatch(draft.body, /\n  Limitations:/);
    assert.match(
      draft.body,
      /Independent customer calls remain unknown\./,
    );
    assert.match(
      draft.body,
      /Public-source synthesis cannot establish private investor reasoning\./,
    );
    assert.match(draft.body, /INDEPENDENT ADVISORY CONFLICTS/);
    assert.match(
      draft.body,
      /Bill Gurley Public Frameworks — Research Draft[\s\S]*Peter Thiel Public Frameworks — Research Draft/,
    );
    assert.match(
      draft.body,
      /The named lenses preserve opposing conclusions without averaging them\./,
    );
  }
});

test("derives draft-only diligence requests from advisory unknowns, counterevidence, and limitations", async () => {
  const advisory = await persistedAdvisoryFixture();
  const drafts = generator.generate({
    candidateRunId: "candidate_1",
    decision,
    missingEvidence,
    recommendedNextSteps: ["Review the saved evidence."],
    ...authoritativeDraftMetadata,
    judgments: advisory.judgments,
    disagreements: advisory.disagreements,
  });
  const diligenceRequest = drafts.find((draft) =>
    "format" in draft && draft.format === "diligence_request"
  );
  assert.ok(diligenceRequest);

  assert.match(diligenceRequest.body, /DRAFT ONLY/);
  assert.doesNotMatch(diligenceRequest.body, /ADVISORY|Peter Thiel|framework/i);
});

let persistedAdvisoryPromise:
  | Promise<{
    judgments: FrameworkJudgment[];
    disagreements: FrameworkDisagreement[];
  }>
  | undefined;

function persistedAdvisoryFixture(): Promise<{
  judgments: FrameworkJudgment[];
  disagreements: FrameworkDisagreement[];
}> {
  persistedAdvisoryPromise ??= buildPersistedAdvisoryFixture();
  return persistedAdvisoryPromise;
}

async function buildPersistedAdvisoryFixture(): Promise<{
  judgments: FrameworkJudgment[];
  disagreements: FrameworkDisagreement[];
}> {
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
    frameworkPackId: SYNTHETIC_FRAMEWORK_PACK.id,
  };
  const catalog = await loadResearchFrameworkCatalog({ context });
  const cards = authorizedResearchComposites(catalog);
  const billGurley = cards.find(({ experimentalAdvisory }) =>
    experimentalAdvisory.packId === "bill_gurley_public_frameworks_v0_1"
  );
  const peterThiel = cards.find(({ experimentalAdvisory }) =>
    experimentalAdvisory.packId === "peter_thiel_public_frameworks_v0_1"
  );
  assert.ok(billGurley);
  assert.ok(peterThiel);

  const billGurleyJudgment: FrameworkJudgment = {
    ...experimentalJudgment({
      id: "judgment_bill_gurley_draft",
      frameworkCardId: billGurley.id,
      frameworkVersion: billGurley.version,
      conclusion: "negative",
      supportEvidenceItemIds: ["fact_retention_risk"],
      counterEvidenceItemIds: ["assumption_sales_efficiency"],
      strongestSupport:
        "Saved retention evidence identifies a material durability risk.",
      strongestCounterargument:
        "Sales efficiency could offset part of the retention concern.",
    }),
    frameworkMetadata: billGurley.experimentalAdvisory,
  };
  const peterThielJudgment: FrameworkJudgment = {
    ...experimentalJudgment({
      id: "judgment_peter_thiel_draft",
      frameworkCardId: peterThiel.id,
      frameworkVersion: peterThiel.version,
      conclusion: "supportive",
      supportEvidenceItemIds: ["fact_customer_wedge"],
      counterEvidenceItemIds: ["assumption_cohort_quality"],
      strongestSupport:
        "A differentiated wedge is supported by saved customer evidence.",
      strongestCounterargument:
        "The cohort evidence may instead support the consensus explanation.",
    }),
    unknowns: ["Independent customer calls remain unknown."],
    limitations: [
      "Public-source synthesis cannot establish private investor reasoning.",
    ],
    frameworkMetadata: peterThiel.experimentalAdvisory,
  };
  const disagreement: FrameworkDisagreement = {
    id: "disagreement_named_advisory_draft",
    leftJudgmentId: billGurleyJudgment.id,
    rightJudgmentId: peterThielJudgment.id,
    topic: "independent_framework_conflict",
    explanation:
      "The named lenses preserve opposing conclusions without averaging them.",
    evidenceItemIds: [
      "assumption_cohort_quality",
      "fact_customer_wedge",
      "fact_retention_risk",
    ],
  };
  return {
    judgments: [billGurleyJudgment, peterThielJudgment],
    disagreements: [disagreement],
  };
}

function experimentalJudgment(input: {
  id: string;
  frameworkCardId: string;
  frameworkVersion: string;
  conclusion: "supportive" | "negative";
  supportEvidenceItemIds: string[];
  counterEvidenceItemIds: string[];
  strongestSupport: string;
  strongestCounterargument: string;
}): FrameworkJudgment {
  return {
    id: input.id,
    analysisType: "framework_judgment",
    frameworkCardId: input.frameworkCardId,
    frameworkVersion: input.frameworkVersion,
    applicability: "applicable",
    conclusion: input.conclusion,
    supportEvidenceItemIds: input.supportEvidenceItemIds,
    counterEvidenceItemIds: input.counterEvidenceItemIds,
    unusedEvidenceItemIds: [],
    strongestSupport: input.strongestSupport,
    strongestCounterargument: input.strongestCounterargument,
    unknowns: ["One material advisory unknown remains."],
    limitations: ["One advisory limitation remains."],
    confidence: {
      sourceReliability: "medium",
      evidenceStrength: "medium",
      evidenceCoverage: "medium",
      applicability: "high",
      judgment: "medium",
    },
    claimEdges: [],
    fingerprint: `sha256:${input.id}`,
  };
}
