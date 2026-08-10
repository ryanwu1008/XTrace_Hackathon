import {
  IntegrationTransportError,
  isRetryableTransportStatus,
} from "../api/errors";

export type ClaudeContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
        data: string;
      };
    };

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string | ClaudeContentBlock[];
}

export interface ClaudeCompleteInput {
  system: string;
  messages: ClaudeMessage[];
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ClaudeTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface MeasuredClaudeCompletion {
  text: string;
  stopReason: string | null;
  usage: ClaudeTokenUsage;
  costUsd?: { amount: string; pricingVersion: string };
}

export interface ClaudeClient {
  complete(input: ClaudeCompleteInput): Promise<string>;
  completeMeasured?(
    input: ClaudeCompleteInput & {
      maxTokens: number;
      maxTransportAttempts: 1;
    },
  ): Promise<MeasuredClaudeCompletion>;
}

export class ClaudeCompletionTruncatedError extends Error {
  readonly code = "CLAUDE_MAX_TOKENS";
  readonly usage: ClaudeTokenUsage;

  constructor(message: string, usage: ClaudeTokenUsage = emptyUsage()) {
    super(message);
    this.name = "ClaudeCompletionTruncatedError";
    this.usage = usage;
  }
}

export function createClaudeClient(options: {
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  backoffMs?: number;
} = {}): ClaudeClient {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  const model = options.model ?? process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";
  const fetchImpl = options.fetchImpl ?? fetch;
  const backoffMs = options.backoffMs ?? 2_000;

  async function completeMeasured(
    input: ClaudeCompleteInput,
    maxTransportAttempts: number,
  ): Promise<MeasuredClaudeCompletion> {
    if (!apiKey) {
      throw new Error("Anthropic is not configured");
    }
    let response: Response | undefined;
    for (
      let attempt = 0;
      attempt < maxTransportAttempts;
      attempt += 1
    ) {
        throwIfAborted(input.signal);
        if (attempt > 0) {
          await abortableDelay(backoffMs, input.signal);
        }
        const requestSignal = input.signal
          ? AbortSignal.any([
              input.signal,
              AbortSignal.timeout(90_000),
            ])
          : AbortSignal.timeout(90_000);
        try {
          response = await fetchImpl("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model,
              max_tokens: input.maxTokens ?? 3_000,
              system: input.system,
              messages: input.messages,
            }),
            signal: requestSignal,
          });
        } catch {
          if (input.signal?.aborted) {
            throw abortError(input.signal);
          }
          response = undefined;
          continue;
        }
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable) break;
    }
    if (!response) {
      throw new IntegrationTransportError({ retryable: true });
    }
    if (!response.ok) {
      throw new IntegrationTransportError({
        retryable: isRetryableTransportStatus(response.status),
      });
    }
    const body = await response.json() as {
      stop_reason?: string;
      content?: Array<{ type: string; text?: string }>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    };
    const usage = parseUsage(body.usage);
    if (body.stop_reason === "max_tokens") {
      throw new ClaudeCompletionTruncatedError(
        "Anthropic completion reached the max token limit.",
        usage,
      );
    }
    const text = body.content?.find((block) => block.type === "text")?.text;
    if (!text) throw new Error("Anthropic returned no text content");
    return {
      text,
      stopReason: body.stop_reason ?? null,
      usage,
    };
  }

  return {
    async complete(input) {
      return (await completeMeasured(input, 2)).text;
    },
    completeMeasured(input) {
      return completeMeasured(input, input.maxTransportAttempts);
    },
  };
}

function parseUsage(
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  } | undefined,
): ClaudeTokenUsage {
  return {
    inputTokens: tokenCount(usage?.input_tokens),
    outputTokens: tokenCount(usage?.output_tokens),
    cacheCreationInputTokens:
      tokenCount(usage?.cache_creation_input_tokens),
    cacheReadInputTokens: tokenCount(usage?.cache_read_input_tokens),
  };
}

function tokenCount(value: number | undefined): number {
  return Number.isInteger(value) && value! >= 0 ? value! : 0;
}

function emptyUsage(): ClaudeTokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Anthropic completion was aborted.");
}

async function abortableDelay(
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  if (!signal) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const complete = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const timeout = setTimeout(complete, delayMs);
    const abort = () => {
      clearTimeout(timeout);
      reject(abortError(signal));
    };
    signal.addEventListener("abort", abort, { once: true });
    timeout.unref?.();
  });
}
