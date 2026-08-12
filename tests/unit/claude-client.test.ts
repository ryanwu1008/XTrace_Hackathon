import assert from "node:assert/strict";
import test from "node:test";

import { IntegrationTransportError } from "../../lib/api/errors";
import { createClaudeClient } from "../../lib/claude/client";

test("Claude client defaults to Opus 4.8", async () => {
  const previousModel = process.env.ANTHROPIC_MODEL;
  delete process.env.ANTHROPIC_MODEL;
  let requestBody: Record<string, unknown> | undefined;

  try {
    const client = createClaudeClient({
      apiKey: "test-key",
      fetchImpl: async (_url, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({
          content: [{ type: "text", text: "[]" }],
        });
      },
    });

    await client.complete({
      system: "Return JSON.",
      messages: [{ role: "user", content: "Test" }],
    });

    assert.equal(requestBody?.model, "claude-opus-4-8");
    assert.equal("temperature" in (requestBody ?? {}), false);
  } finally {
    if (previousModel === undefined) delete process.env.ANTHROPIC_MODEL;
    else process.env.ANTHROPIC_MODEL = previousModel;
  }
});

test("Claude client retries once on retryable provider errors", async () => {
  let calls = 0;
  const client = createClaudeClient({
    apiKey: "test-key",
    backoffMs: 1,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("overloaded", { status: 529 });
      }
      return Response.json({ content: [{ type: "text", text: "ok" }] });
    },
  });

  const text = await client.complete({
    system: "Return JSON.",
    messages: [{ role: "user", content: "Test" }],
  });

  assert.equal(text, "ok");
  assert.equal(calls, 2, "a 5xx response must be retried exactly once");
});

test("Claude client does not retry non-retryable request errors", async () => {
  let calls = 0;
  const client = createClaudeClient({
    apiKey: "test-key",
    backoffMs: 1,
    fetchImpl: async () => {
      calls += 1;
      return new Response("bad request", { status: 400 });
    },
  });

  await assert.rejects(
    client.complete({
      system: "Return JSON.",
      messages: [{ role: "user", content: "Test" }],
    }),
    (error: unknown) => error instanceof IntegrationTransportError && !error.retryable,
  );
  assert.equal(calls, 1, "a 400 must not be retried");
});

test("Claude client preserves the provider status needed for safe failure classification", async () => {
  for (const status of [401, 403, 429, 503]) {
    const client = createClaudeClient({
      apiKey: "test-key",
      backoffMs: 0,
      fetchImpl: async () => new Response("provider error", { status }),
    });

    await assert.rejects(
      client.complete({
        system: "Return JSON.",
        messages: [{ role: "user", content: "Test" }],
      }),
      (error: unknown) =>
        error instanceof IntegrationTransportError
        && error.status === status,
      `HTTP ${status} must remain available as safe structured metadata`,
    );
  }
});

test("Claude client retries once when the request itself fails", async () => {
  let calls = 0;
  const client = createClaudeClient({
    apiKey: "test-key",
    backoffMs: 1,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new Error("socket hang up");
      return Response.json({ content: [{ type: "text", text: "ok" }] });
    },
  });

  assert.equal(await client.complete({
    system: "Return JSON.",
    messages: [{ role: "user", content: "Test" }],
  }), "ok");
  assert.equal(calls, 2);
});

test("Claude client rejects a response stopped by its max token limit", async () => {
  const client = createClaudeClient({
    apiKey: "test-key",
    fetchImpl: async () => Response.json({
      stop_reason: "max_tokens",
      content: [{ type: "text", text: "partial visible text" }],
    }),
  });

  await assert.rejects(
    client.complete({
      system: "Transcribe.",
      messages: [{ role: "user", content: "Test" }],
    }),
    /max token limit/,
  );
});

test("Claude client forwards caller cancellation and never retries an aborted request", async () => {
  const controller = new AbortController();
  let calls = 0;
  const providerSignals: AbortSignal[] = [];
  const client = createClaudeClient({
    apiKey: "test-key",
    backoffMs: 1,
    fetchImpl: async (_url, init) => {
      calls += 1;
      const providerSignal = init?.signal as AbortSignal;
      providerSignals.push(providerSignal);
      return await new Promise<Response>((_resolve, reject) => {
        providerSignal.addEventListener(
          "abort",
          () => reject(providerSignal.reason),
          { once: true },
        );
      });
    },
  });

  const completion = client.complete({
    system: "Return JSON.",
    messages: [{ role: "user", content: "Test" }],
    signal: controller.signal,
  });
  controller.abort(new Error("candidate stage expired"));

  await assert.rejects(completion, /candidate stage expired/i);
  assert.equal(providerSignals[0]?.aborted, true);
  assert.equal(calls, 1);
});

test("Claude client exposes exact provider token usage in single-attempt metered mode", async () => {
  let calls = 0;
  const client = createClaudeClient({
    apiKey: "test-key",
    fetchImpl: async () => {
      calls += 1;
      return Response.json({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "{\"ok\":true}" }],
        usage: {
          input_tokens: 321,
          output_tokens: 45,
          cache_creation_input_tokens: 6,
          cache_read_input_tokens: 7,
        },
      });
    },
  }) as ReturnType<typeof createClaudeClient> & {
    completeMeasured(input: {
      system: string;
      messages: Array<{ role: "user"; content: string }>;
      maxTokens: number;
      maxTransportAttempts: 1;
    }): Promise<{
      text: string;
      stopReason: string | null;
      usage: {
        inputTokens: number;
        outputTokens: number;
        cacheCreationInputTokens: number;
        cacheReadInputTokens: number;
      };
    }>;
  };

  const completion = await client.completeMeasured({
    system: "Return JSON.",
    messages: [{ role: "user", content: "Test" }],
    maxTokens: 4_000,
    maxTransportAttempts: 1,
  });

  assert.equal(calls, 1);
  assert.deepEqual(completion, {
    text: "{\"ok\":true}",
    stopReason: "end_turn",
    usage: {
      inputTokens: 321,
      outputTokens: 45,
      cacheCreationInputTokens: 6,
      cacheReadInputTokens: 7,
    },
  });
});
