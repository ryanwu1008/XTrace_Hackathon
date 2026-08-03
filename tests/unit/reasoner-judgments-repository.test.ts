import assert from "node:assert/strict";
import test from "node:test";

import {
  createMemoryReasonerJudgmentsRepository,
  createSupabaseReasonerJudgmentsRepository,
} from "../../db/repositories/reasoner-judgments";

const input = {
  fingerprint: `reasoner-judgment-v3:sha256:${"a".repeat(64)}`,
  model: "claude-opus-4-8",
  payload: [{ dealId: "deal_a" }],
};

test("memory reasoner judgments return exact immutable retries and reject changed records", async () => {
  const repository = createMemoryReasonerJudgmentsRepository();
  const first = await repository.save(input);
  const retry = await repository.save(structuredClone(input));
  assert.deepEqual(retry, first);
  assert.equal(first.state, "current");
  assert.match(first.state === "current" ? first.judgmentRecordFingerprint : "", /^sha256:[0-9a-f]{64}$/);

  await assert.rejects(repository.save({ ...input, model: "different-model" }), /judgment.*collision/i);
  await assert.rejects(repository.save({ ...input, payload: [{ dealId: "deal_b" }] }), /judgment.*collision/i);
  assert.deepEqual(await repository.find(input.fingerprint), first);
});

test("Supabase reasoner writes use the immutable RPC and never a table upsert", async () => {
  const calls: Array<{ path: string; body: unknown }> = [];
  const current = {
    state: "current",
    judgmentSchemaVersion: "reasoner-judgment-record-v1",
    ...input,
    evidenceContextFingerprint: null,
    evidenceBindingFingerprint: null,
    judgmentRecordFingerprint: `sha256:${"b".repeat(64)}`,
  };
  const repository = createSupabaseReasonerJudgmentsRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-key",
    async fetchImpl(raw, init) {
      calls.push({ path: new URL(String(raw)).pathname, body: init?.body ? JSON.parse(String(init.body)) : null });
      return Response.json([current]);
    },
  });
  assert.deepEqual(await repository.save(input), current);
  assert.deepEqual(calls, [{
    path: "/rest/v1/rpc/save_reasoner_judgment_immutable",
    body: { p_request: {
      ...input,
      evidenceContextFingerprint: null,
      evidenceBindingFingerprint: null,
    } },
  }]);
});

test("legacy rows remain explicitly unbound while partial current rows fail closed", async () => {
  const rows: unknown[] = [{
    fingerprint: input.fingerprint,
    model: input.model,
    payload: input.payload,
    judgment_schema_version: null,
    judgment_record_fingerprint: null,
    evidence_context_fingerprint: null,
    evidence_binding_fingerprint: null,
  }];
  const repository = createSupabaseReasonerJudgmentsRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-key",
    async fetchImpl() { return Response.json(rows); },
  });
  assert.equal((await repository.find(input.fingerprint))?.state, "legacy_unbound");
  rows[0] = { ...(rows[0] as object), judgment_schema_version: "reasoner-judgment-record-v1" };
  await assert.rejects(repository.find(input.fingerprint), /partial.*judgment/i);
});
