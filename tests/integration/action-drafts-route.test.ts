import assert from "node:assert/strict";
import test from "node:test";

import { saveActionDraftBody } from "../../app/action-draft-dialog";
import { GET as listDrafts } from "../../app/api/action-drafts/route";
import { PATCH as updateDraft } from "../../app/api/action-drafts/[id]/route";
import {
  createMemoryUnderwritingArtifactsRepository,
  createSupabaseUnderwritingArtifactsRepository,
  type CandidateArtifactBundle,
  type UnderwritingArtifactsRepository,
} from "../../db/repositories/underwriting-artifacts";
import type { RouteDependencies } from "../../lib/api/route-dependencies";
import type { PublicActionDraft } from "../../lib/underwriting/read-model";
import { actionsForDealStatusAndDirection } from "../../lib/reports/action-policy";

const WORKSPACE_ID = "workspace_drafts";
const CANDIDATE_RUN_ID = "candidate_drafts";
const DRAFT_ID = "draft_email";
const LEGACY_MEMO_ID = "draft_legacy_memo";
const LEGACY_MEMO_BODY = [
  "INTERNAL UNDERWRITING ACTION MEMO",
  "  Limitations: Partner-authored preface must survive.",
  "",
  "EXPERIMENTAL ADVISORY OPINIONS — DRAFT ONLY",
  "- Pack: Legacy public advisory pack",
  "  Applicability: applicable; advisory conclusion: supportive",
  "  Product-synthesis notice: Private generated notice.",
  "  Limitations: Private generated limitation.",
  "  Component qualifications and limitations:",
  "    - PT-01: Private generated review issue.",
  "",
  "INDEPENDENT ADVISORY CONFLICTS",
  "Unavailable",
  "",
  "ADVISORY DILIGENCE REQUESTS",
  "- Address advisory limitation [Legacy pack]: Private generated limitation.",
  "- Resolve advisory unknown [Legacy pack]: Public generated question.",
  "",
  "  Limitations: Partner-authored appendix must survive.",
  "- Address advisory limitation [Partner note]: Partner-authored follow-up must survive.",
].join("\n");
const ORDINARY_EMAIL_WITH_MATCHING_LINES = [
  "Subject: Partner-authored limitations",
  "  Limitations: Keep this email line.",
  "- Address advisory limitation [Partner note]: Keep this email request.",
].join("\n");
const LEGACY_PUBLIC_METADATA = {
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
} as const;

function productDependencies(
  artifacts: UnderwritingArtifactsRepository,
  workspaceId = WORKSPACE_ID,
): RouteDependencies {
  return {
    async resolveRequestContext() {
      return {
        mode: "product",
        principal: { userId: "user_drafts", email: "user@example.test" },
        workspaceId,
        role: "associate",
        permissions: {
          readWorkspace: true,
          readPrivateSources: true,
          mutateSources: false,
          managePolicy: false,
          administerFrameworks: false,
        },
      };
    },
    underwritingArtifacts: artifacts,
  };
}

function seedDraftRepository() {
  const artifacts = createMemoryUnderwritingArtifactsRepository({
    now: () => new Date("2026-07-29T13:00:00.000Z"),
  });
  artifacts.commitPrepared({
    candidateRunId: CANDIDATE_RUN_ID,
    workspaceId: WORKSPACE_ID,
    dealId: "deal_drafts",
    candidateAnalysisFingerprint: `sha256:${"d".repeat(64)}`,
    actionDrafts: [{
      id: DRAFT_ID,
      workspaceId: WORKSPACE_ID,
      candidateRunId: CANDIDATE_RUN_ID,
      channel: "email",
      audienceType: "founder",
      body: "Original source-grounded body.",
      createdAt: "2026-07-29T12:00:00.000Z",
      updatedAt: "2026-07-29T12:00:00.000Z",
    }],
  } as unknown as CandidateArtifactBundle);
  return artifacts;
}

function seedLegacyDraftRepository() {
  const artifacts = createMemoryUnderwritingArtifactsRepository({
    now: () => new Date("2026-07-29T13:00:00.000Z"),
  });
  artifacts.commitPrepared({
    candidateRunId: CANDIDATE_RUN_ID,
    workspaceId: WORKSPACE_ID,
    dealId: "deal_drafts",
    candidateAnalysisFingerprint: `sha256:${"e".repeat(64)}`,
    actionDrafts: [
      {
        id: LEGACY_MEMO_ID,
        workspaceId: WORKSPACE_ID,
        candidateRunId: CANDIDATE_RUN_ID,
        channel: "internal_memo",
        audienceType: "internal",
        body: LEGACY_MEMO_BODY,
        createdAt: "2026-07-29T12:00:00.000Z",
        updatedAt: "2026-07-29T12:00:00.000Z",
      },
      {
        id: DRAFT_ID,
        workspaceId: WORKSPACE_ID,
        candidateRunId: CANDIDATE_RUN_ID,
        channel: "email",
        audienceType: "founder",
        body: ORDINARY_EMAIL_WITH_MATCHING_LINES,
        createdAt: "2026-07-29T12:00:00.000Z",
        updatedAt: "2026-07-29T12:00:00.000Z",
      },
    ],
  } as unknown as CandidateArtifactBundle);
  return artifacts;
}

function seedStatusSafeExternalDraftRepository() {
  const artifacts = createMemoryUnderwritingArtifactsRepository({
    now: () => new Date("2026-07-29T13:00:00.000Z"),
  });
  artifacts.commitPrepared({
    candidateRunId: CANDIDATE_RUN_ID,
    workspaceId: WORKSPACE_ID,
    dealId: "deal_drafts",
    candidateAnalysisFingerprint: `sha256:${"f".repeat(64)}`,
    actionDrafts: [{
      schemaVersion: "action-draft-v2",
      safety: "status_safe",
      deliveryMode: "draft_only",
      draftPolicyVersion: "status-safe-action-draft-v2",
      actionPolicyVersion: "belief-action-policy-v1",
      id: DRAFT_ID,
      workspaceId: WORKSPACE_ID,
      candidateRunId: CANDIDATE_RUN_ID,
      dealStatus: "passed",
      beliefDirection: "positive",
      actions: actionsForDealStatusAndDirection("passed", "positive"),
      missingEvidence: [{
        fieldId: "customer_evidence",
        label: "current customer references",
        reasonCode: "MISSING_CRITICAL_EVIDENCE",
        mostLikelyDecisionImpact:
          "Providing accepted evidence may raise or lower the formal decision ceiling.",
      }],
      format: "founder_email",
      channel: "email",
      audienceType: "founder",
      body: [
        "Subject: Draft evidence follow-up",
        "",
        "DRAFT ONLY — NOT SENT",
        "Please share the following current evidence for review:",
        "- current customer references",
        "This draft is limited to evidence collection and neutral sharing instructions.",
      ].join("\n"),
      createdAt: "2026-07-29T12:00:00.000Z",
      updatedAt: "2026-07-29T12:00:00.000Z",
    }],
  } as unknown as CandidateArtifactBundle);
  return artifacts;
}

test("action draft list is candidate- and organization-scoped", async () => {
  const artifacts = seedDraftRepository();
  const response = await listDrafts(
    new Request(
      `https://vsee.test/api/action-drafts?candidateRunId=${CANDIDATE_RUN_ID}`,
    ),
    undefined,
    productDependencies(artifacts),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(
    (await response.json() as { data: unknown[] }).data,
    [{
      id: DRAFT_ID,
      candidateRunId: CANDIDATE_RUN_ID,
      ...LEGACY_PUBLIC_METADATA,
      channel: "email",
      audienceType: "founder",
      body: "Original source-grounded body.",
      createdAt: "2026-07-29T12:00:00.000Z",
      updatedAt: "2026-07-29T12:00:00.000Z",
    }],
  );

  const foreign = await listDrafts(
    new Request(
      `https://vsee.test/api/action-drafts?candidateRunId=${CANDIDATE_RUN_ID}`,
    ),
    undefined,
    productDependencies(artifacts, "workspace_foreign"),
  );
  assert.deepEqual((await foreign.json() as { data: unknown[] }).data, []);
});

test("PATCH replaces only the current draft body on the same identity", async () => {
  const artifacts = seedDraftRepository();
  const response = await updateDraft(
    new Request(`https://vsee.test/api/action-drafts/${DRAFT_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "Revised source-grounded body." }),
    }),
    { params: Promise.resolve({ id: DRAFT_ID }) },
    productDependencies(artifacts),
  );

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json() as { data: unknown }).data, {
    id: DRAFT_ID,
    candidateRunId: CANDIDATE_RUN_ID,
    ...LEGACY_PUBLIC_METADATA,
    channel: "email",
    audienceType: "founder",
    body: "Revised source-grounded body.",
    createdAt: "2026-07-29T12:00:00.000Z",
    updatedAt: "2026-07-29T13:00:00.000Z",
  });
  const [persisted] = await artifacts.listActionDrafts({
    workspaceId: WORKSPACE_ID,
    candidateRunId: CANDIDATE_RUN_ID,
  });
  assert.deepEqual(persisted, {
    id: DRAFT_ID,
    workspaceId: WORKSPACE_ID,
    candidateRunId: CANDIDATE_RUN_ID,
    channel: "email",
    audienceType: "founder",
    body: "Revised source-grounded body.",
    createdAt: "2026-07-29T12:00:00.000Z",
    updatedAt: "2026-07-29T13:00:00.000Z",
  });
  assert.equal(
    (await artifacts.listActionDrafts({
      workspaceId: WORKSPACE_ID,
      candidateRunId: CANDIDATE_RUN_ID,
    })).length,
    1,
  );
});

test("status-safe external PATCH rejects internal posture without mutation and preserves metadata on a safe edit", async () => {
  const artifacts = seedStatusSafeExternalDraftRepository();
  const before = (await artifacts.listActionDrafts({
    workspaceId: WORKSPACE_ID,
    candidateRunId: CANDIDATE_RUN_ID,
  }))[0];
  assert.ok("schemaVersion" in before);
  const unsafe = await updateDraft(
    new Request(`https://vsee.test/api/action-drafts/${DRAFT_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: "DRAFT ONLY\nDeal status: passed\nBelief direction: positive\nFormal decision: Advance\nReopen internal diligence based on the cited evidence.",
      }),
    }),
    { params: Promise.resolve({ id: DRAFT_ID }) },
    productDependencies(artifacts),
  );
  assert.equal(unsafe.status, 400);
  assert.deepEqual((await artifacts.listActionDrafts({
    workspaceId: WORKSPACE_ID,
    candidateRunId: CANDIDATE_RUN_ID,
  }))[0], before);
  for (const body of [
    "This is not DRAFT ONLY — NOT SENT\nPlease share current customer evidence.",
    "Please share current customer evidence.\n\nDRAFT ONLY — NOT SENT",
    "DRAFT ONLY — NOT SENT\nWe previously passed on the company, but our belief has turned positive.",
    "DRAFT ONLY — NOT SENT\nWe passed on the company last year.",
    "DRAFT ONLY — NOT SENT\nOur view is now negative.",
    "DRAFT ONLY — NOT SENT\nYou remain on our watchlist.",
    "DRAFT ONLY — NOT SENT\nWe chose not to invest.",
    "DRAFT ONLY — NOT SENT\nWe are revisiting our prior decision.",
  ]) {
    const invalidMarker = await updateDraft(
      new Request(`https://vsee.test/api/action-drafts/${DRAFT_ID}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      }),
      { params: Promise.resolve({ id: DRAFT_ID }) },
      productDependencies(artifacts),
    );
    assert.equal(invalidMarker.status, 400);
  }
  assert.deepEqual((await artifacts.listActionDrafts({
    workspaceId: WORKSPACE_ID,
    candidateRunId: CANDIDATE_RUN_ID,
  }))[0], before);

  const safeBody = [
    "DRAFT ONLY — NOT SENT",
    "Please share the following current evidence for review:",
    "- current customer references",
    "This draft is limited to evidence collection and neutral sharing instructions.",
  ].join("\n");
  const safe = await updateDraft(
    new Request(`https://vsee.test/api/action-drafts/${DRAFT_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: safeBody }),
    }),
    { params: Promise.resolve({ id: DRAFT_ID }) },
    productDependencies(artifacts),
  );
  assert.equal(safe.status, 200);
  const persisted = (await artifacts.listActionDrafts({
    workspaceId: WORKSPACE_ID,
    candidateRunId: CANDIDATE_RUN_ID,
  }))[0];
  assert.ok("schemaVersion" in persisted);
  assert.equal(persisted.body, safeBody);
  assert.equal(persisted.dealStatus, before.dealStatus);
  assert.equal(persisted.beliefDirection, before.beliefDirection);
  assert.deepEqual(persisted.actions, before.actions);
  assert.equal(persisted.safety, "status_safe");
});

test("PATCH returns 404 when PostgreSQL refuses an unavailable candidate draft", async () => {
  const artifacts = createSupabaseUnderwritingArtifactsRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "service-role",
    fetchImpl: async () => Response.json(null),
  });
  assert.equal(await artifacts.replaceActionDraftBody({
    workspaceId: WORKSPACE_ID,
    draftId: DRAFT_ID,
    body: "Unsafe quarantined edit",
  }), null);

  const response = await updateDraft(
    new Request(`https://vsee.test/api/action-drafts/${DRAFT_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "Unsafe quarantined edit" }),
    }),
    { params: Promise.resolve({ id: DRAFT_ID }) },
    productDependencies(artifacts),
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: {
      code: "NOT_FOUND",
      message: "Action draft was not found",
      retryable: false,
    },
  });
});

test("GET and PATCH sanitize only the exact legacy generated advisory spans", async () => {
  const artifacts = seedLegacyDraftRepository();
  const readPublicDrafts = async () => {
    const response = await listDrafts(
      new Request(
        `https://vsee.test/api/action-drafts?candidateRunId=${CANDIDATE_RUN_ID}`,
      ),
      undefined,
      productDependencies(artifacts),
    );
    assert.equal(response.status, 200);
    return (await response.json() as {
      data: PublicActionDraft[];
    }).data;
  };

  const initialDrafts = await readPublicDrafts();
  const initialMemo = initialDrafts.find(({ id }) => id === LEGACY_MEMO_ID);
  const initialEmail = initialDrafts.find(({ id }) => id === DRAFT_ID);
  assert.ok(initialMemo);
  assert.ok(initialEmail);
  assert.equal(initialEmail.body, ORDINARY_EMAIL_WITH_MATCHING_LINES);
  assert.match(initialMemo.body, /Partner-authored preface must survive/);
  assert.match(initialMemo.body, /Partner-authored appendix must survive/);
  assert.match(initialMemo.body, /Partner-authored follow-up must survive/);
  assert.match(initialMemo.body, /Public generated question/);
  assert.doesNotMatch(initialMemo.body, /Private generated notice/);
  assert.doesNotMatch(initialMemo.body, /Private generated limitation/);
  assert.doesNotMatch(initialMemo.body, /Private generated review issue/);

  const revisedBody = LEGACY_MEMO_BODY.replace(
    "advisory conclusion: supportive",
    "advisory conclusion: mixed after partner edit",
  );
  const patchResponse = await updateDraft(
    new Request(`https://vsee.test/api/action-drafts/${LEGACY_MEMO_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: revisedBody }),
    }),
    { params: Promise.resolve({ id: LEGACY_MEMO_ID }) },
    productDependencies(artifacts),
  );
  assert.equal(patchResponse.status, 200);
  const patched = (await patchResponse.json() as {
    data: PublicActionDraft;
  }).data;
  assert.match(patched.body, /mixed after partner edit/);
  assert.match(patched.body, /Partner-authored preface must survive/);
  assert.match(patched.body, /Partner-authored appendix must survive/);
  assert.match(patched.body, /Partner-authored follow-up must survive/);
  assert.doesNotMatch(patched.body, /Private generated limitation/);

  const persisted = (await artifacts.listActionDrafts({
    workspaceId: WORKSPACE_ID,
    candidateRunId: CANDIDATE_RUN_ID,
  })).find(({ id }) => id === LEGACY_MEMO_ID);
  assert.equal(persisted?.body, revisedBody);

  const rereadMemo = (await readPublicDrafts()).find(({ id }) =>
    id === LEGACY_MEMO_ID
  );
  assert.ok(rereadMemo);
  assert.equal(rereadMemo.body, patched.body);
});

test("the draft Save interaction PATCHes the current identity and persists only its body", async () => {
  const artifacts = seedDraftRepository();
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const updated = await saveActionDraftBody({
    draftId: DRAFT_ID,
    body: "Saved through the editor interaction.",
    request: async (url, init) => {
      requestedUrl = url;
      requestedInit = init;
      const response = await updateDraft(
        new Request(`https://vsee.test${url}`, {
          ...init,
          headers: { "content-type": "application/json" },
        }),
        { params: Promise.resolve({ id: DRAFT_ID }) },
        productDependencies(artifacts),
      );
      assert.equal(response.status, 200);
      return (await response.json() as { data: PublicActionDraft }).data;
    },
  });

  assert.equal(requestedUrl, `/api/action-drafts/${DRAFT_ID}`);
  assert.equal(requestedInit?.method, "PATCH");
  assert.deepEqual(JSON.parse(String(requestedInit?.body)), {
    body: "Saved through the editor interaction.",
  });
  assert.deepEqual(updated, {
    id: DRAFT_ID,
    candidateRunId: CANDIDATE_RUN_ID,
    ...LEGACY_PUBLIC_METADATA,
    channel: "email",
    audienceType: "founder",
    body: "Saved through the editor interaction.",
    createdAt: "2026-07-29T12:00:00.000Z",
    updatedAt: "2026-07-29T13:00:00.000Z",
  });
  const [persisted] = await artifacts.listActionDrafts({
    workspaceId: WORKSPACE_ID,
    candidateRunId: CANDIDATE_RUN_ID,
  });
  assert.equal(persisted.id, DRAFT_ID);
  assert.equal(persisted.channel, "email");
  assert.equal(persisted.audienceType, "founder");
  assert.equal(persisted.body, "Saved through the editor interaction.");
});

test("PATCH rejects attempts to replace audience, channel, association, or lineage", async () => {
  const artifacts = seedDraftRepository();
  const response = await updateDraft(
    new Request(`https://vsee.test/api/action-drafts/${DRAFT_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: "Attempted rewrite",
        channel: "linkedin",
        audienceType: "customer",
        candidateRunId: "candidate_other",
        sourceRevisionIds: ["revision_other"],
      }),
    }),
    { params: Promise.resolve({ id: DRAFT_ID }) },
    productDependencies(artifacts),
  );
  assert.equal(response.status, 400);
  assert.equal(
    (await artifacts.listActionDrafts({
      workspaceId: WORKSPACE_ID,
      candidateRunId: CANDIDATE_RUN_ID,
    }))[0].body,
    "Original source-grounded body.",
  );
});

test("public demo is read-only and cannot PATCH a draft", async () => {
  const artifacts = seedDraftRepository();
  const response = await updateDraft(
    new Request(`https://vsee.test/api/action-drafts/${DRAFT_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "Demo mutation" }),
    }),
    { params: Promise.resolve({ id: DRAFT_ID }) },
    {
      async resolveRequestContext() {
        return {
          mode: "public_demo",
          principal: null,
          workspaceId: "workspace_demo",
          role: "demo",
          permissions: {
            readWorkspace: true,
            readPrivateSources: false,
            mutateSources: false,
            managePolicy: false,
            administerFrameworks: false,
          },
        };
      },
      underwritingArtifacts: artifacts,
    },
  );
  assert.equal(response.status, 403);
});

test("PostgreSQL draft replacement uses the controlled RPC and no direct table PATCH", async () => {
  const requests: Array<{ url: URL; init: RequestInit }> = [];
  const repository = createSupabaseUnderwritingArtifactsRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "service-role",
    fetchImpl: async (input, init = {}) => {
      requests.push({ url: new URL(String(input)), init });
      if (new URL(String(input)).pathname.endsWith("/action_drafts")) {
        return Response.json([{ payload: {
          id: DRAFT_ID,
          workspaceId: WORKSPACE_ID,
          candidateRunId: CANDIDATE_RUN_ID,
          channel: "email",
          audienceType: "founder",
          body: "Original body",
          createdAt: "2026-07-29T12:00:00.000Z",
          updatedAt: "2026-07-29T12:00:00.000Z",
        } }]);
      }
      return Response.json([{
        id: DRAFT_ID,
        workspaceId: WORKSPACE_ID,
        candidateRunId: CANDIDATE_RUN_ID,
        channel: "email",
        audienceType: "founder",
        body: "Controlled body",
        createdAt: "2026-07-29T12:00:00.000Z",
        updatedAt: "2026-07-29T13:00:00.000Z",
      }]);
    },
  });

  await repository.replaceActionDraftBody({
    workspaceId: WORKSPACE_ID,
    draftId: DRAFT_ID,
    body: "Controlled body",
  });
  assert.equal(requests.length, 2);
  assert.equal(
    requests[1].url.pathname,
    "/rest/v1/rpc/replace_action_draft_body",
  );
  assert.equal(requests[1].init.method, "POST");
  assert.deepEqual(JSON.parse(String(requests[1].init.body)), {
    p_workspace_id: WORKSPACE_ID,
    p_draft_id: DRAFT_ID,
    p_body: "Controlled body",
  });
  assert.equal(
    requests.some(({ url, init }) =>
      url.pathname.endsWith("/action_drafts") && init.method === "PATCH"
    ),
    false,
  );
});

test("PostgreSQL preflight blocks an unsafe v2 external edit before RPC and permits a safe edit", async () => {
  const requests: Array<{ url: URL; init: RequestInit }> = [];
  const actions = actionsForDealStatusAndDirection("passed", "positive");
  const existing = {
    schemaVersion: "action-draft-v2",
    safety: "status_safe",
    deliveryMode: "draft_only",
    draftPolicyVersion: "status-safe-action-draft-v2",
    actionPolicyVersion: "belief-action-policy-v1",
    id: DRAFT_ID,
    workspaceId: WORKSPACE_ID,
    candidateRunId: CANDIDATE_RUN_ID,
    dealStatus: "passed",
    beliefDirection: "positive",
    actions,
    missingEvidence: [{
      fieldId: "customer_evidence",
      label: "current customer references",
      reasonCode: "MISSING_CRITICAL_EVIDENCE",
      mostLikelyDecisionImpact:
        "Providing accepted evidence may raise or lower the formal decision ceiling.",
    }],
    format: "founder_email",
    channel: "email",
    audienceType: "founder",
    body: [
      "Subject: Draft evidence follow-up",
      "",
      "DRAFT ONLY — NOT SENT",
      "Please share the following current evidence for review:",
      "- current customer references",
      "This draft is limited to evidence collection and neutral sharing instructions.",
    ].join("\n"),
    createdAt: "2026-07-29T12:00:00.000Z",
    updatedAt: "2026-07-29T12:00:00.000Z",
  } as const;
  const repository = createSupabaseUnderwritingArtifactsRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "service-role",
    fetchImpl: async (input, init = {}) => {
      const url = new URL(String(input));
      requests.push({ url, init });
      if (url.pathname.endsWith("/action_drafts")) {
        return Response.json([{ payload: existing }]);
      }
      return Response.json([{ ...existing, body: [
        "DRAFT ONLY — NOT SENT",
        "Please share the following current evidence for review:",
        "- current customer references",
        "This draft is limited to evidence collection and neutral sharing instructions.",
      ].join("\n") }]);
    },
  });

  for (const body of [
    "DRAFT ONLY — NOT SENT\nConfidence: high\nFired rule: decision.matrix.v1\nPortfolio follow-on risk review.",
    "DRAFT ONLY — NOT SENT\nWe passed on the company last year.",
    "DRAFT ONLY — NOT SENT\nOur view is now negative.",
    "DRAFT ONLY — NOT SENT\nYou remain on our watchlist.",
    "DRAFT ONLY — NOT SENT\nWe chose not to invest.",
    "DRAFT ONLY — NOT SENT\nWe are revisiting our prior decision.",
  ]) {
    requests.length = 0;
    await assert.rejects(repository.replaceActionDraftBody({
      workspaceId: WORKSPACE_ID,
      draftId: DRAFT_ID,
      body,
    }), /external|status-safe|neutral evidence/i);
    assert.equal(requests.length, 1);
    assert.equal(requests.some(({ url }) =>
      url.pathname.endsWith("/rpc/replace_action_draft_body")
    ), false);
  }

  requests.length = 0;
  const safeBody = [
    "DRAFT ONLY — NOT SENT",
    "Please share the following current evidence for review:",
    "- current customer references",
    "This draft is limited to evidence collection and neutral sharing instructions.",
  ].join("\n");
  const safe = await repository.replaceActionDraftBody({
    workspaceId: WORKSPACE_ID,
    draftId: DRAFT_ID,
    body: safeBody,
  });
  assert.ok(safe && "schemaVersion" in safe);
  assert.equal(safe.safety, "status_safe");
  assert.deepEqual(safe.actions, actions);
  assert.equal(requests.filter(({ url }) =>
    url.pathname.endsWith("/rpc/replace_action_draft_body")
  ).length, 1);
});

test("PostgreSQL finalized-artifact reads require completed non-alias candidates", async () => {
  let requestedUrl = "";
  const repository = createSupabaseUnderwritingArtifactsRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "service-role",
    fetchImpl: async (input) => {
      requestedUrl = String(input);
      return Response.json([]);
    },
  });

  assert.deepEqual(await repository.listFinalizedForWorkspace({
    workspaceId: WORKSPACE_ID,
  }), []);
  const query = new URL(requestedUrl).searchParams;
  assert.equal(query.get("workspace_id"), `eq.${WORKSPACE_ID}`);
  assert.equal(query.get("status"), "eq.completed");
  assert.equal(
    query.get("artifact_source_candidate_run_id"),
    "is.null",
  );

  assert.equal(await repository.getByCandidateRunId({
    workspaceId: WORKSPACE_ID,
    candidateRunId: CANDIDATE_RUN_ID,
  }), null);
  const directQuery = new URL(requestedUrl).searchParams;
  assert.equal(directQuery.get("workspace_id"), `eq.${WORKSPACE_ID}`);
  assert.equal(directQuery.get("id"), `eq.${CANDIDATE_RUN_ID}`);
  assert.equal(directQuery.get("status"), "eq.completed");
});
