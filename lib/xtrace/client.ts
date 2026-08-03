export const XTRACE_API_BASE_URL = "https://api.production.xtrace.ai";

export type XTraceMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type XTraceIngestRequest = {
  messages: XTraceMessage[];
  user_id: string;
  conv_id: string;
  agent_id?: string;
  app_id?: string;
  group_ids?: string[];
  timestamp_format?: string;
  extract_artifacts?: boolean;
};

export type XTraceMemoryRef = {
  id: string;
  type: string;
  text: string;
};

export type XTraceJob = {
  status: "pending" | "running" | "succeeded" | "failed";
  id: string;
  result?: {
    memories_created?: XTraceMemoryRef[];
  } | null;
  error?: { code?: string; message?: string } | null;
};

export type XTraceSearchRequest = {
  query: string;
  user_id: string;
  app_id?: string;
  agent_id?: string;
  group_ids?: string[];
  mode: "retrieve";
  limit: number;
};

export type XTraceSearchResult = {
  id: string;
  type?: string;
  text: string;
  score: number;
  user_id?: string | null;
  conv_id?: string | null;
  app_id?: string | null;
  agent_id?: string | null;
  metadata?: Record<string, unknown>;
};

export type XTraceSearchResponse = {
  success?: true;
  object?: "search";
  mode?: "retrieve" | "compose";
  data: XTraceSearchResult[];
  context?: string;
  count?: number;
};

export function isAcceptedXTraceSearchResponse(
  response: XTraceSearchResponse,
): boolean {
  const envelope = response as { success?: unknown; object?: unknown; mode?: unknown };
  if (envelope.success !== undefined && envelope.success !== true) return false;
  return envelope.success === true
    || (envelope.object === "search"
      && (envelope.mode === "retrieve" || envelope.mode === "compose"));
}

export type XTraceClient = {
  ingest(input: XTraceIngestRequest, options?: { wait?: boolean }): Promise<XTraceJob>;
  getJob(jobId: string): Promise<XTraceJob>;
  search(input: XTraceSearchRequest): Promise<XTraceSearchResponse>;
  deleteMemory(memoryId: string): Promise<void>;
};

export class XTraceConfigurationError extends Error {
  readonly code = "XTRACE_NOT_CONFIGURED";

  constructor(message = "XTrace credentials are not configured") {
    super(message);
    this.name = "XTraceConfigurationError";
  }
}

export class XTraceHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "XTraceHttpError";
  }
}

type FetchLike = typeof fetch;

type XTraceEnvironment = Partial<Pick<
  NodeJS.ProcessEnv,
  | "XTRACE_API_KEY"
  | "XTRACE_ORG_ID"
  | "XTRACE_API_BASE_URL"
  | "XTRACE_DRY_RUN"
>>;

export function isXTraceConfigured(
  environment: XTraceEnvironment | NodeJS.ProcessEnv = process.env,
): boolean {
  const apiKey = environment.XTRACE_API_KEY?.trim();
  if (!apiKey) return false;
  return apiKey.startsWith("mmk_")
    || Boolean(environment.XTRACE_ORG_ID?.trim());
}

export function createXTraceClient(options: {
  apiKey: string;
  orgId?: string;
  baseUrl?: string;
  fetch?: FetchLike;
}): XTraceClient {
  const baseUrl = (options.baseUrl ?? XTRACE_API_BASE_URL).replace(/\/$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "VSee-VC-Deal-Intelligence/0.1",
  };
  if (options.apiKey.startsWith("mmk_")) {
    headers["x-api-key"] = options.apiKey;
  } else {
    headers.Authorization = `Bearer ${options.apiKey}`;
  }
  if (!options.apiKey.startsWith("mmk_") && options.orgId?.trim()) {
    headers["X-Org-Id"] = options.orgId.trim();
  }

  const request = async <T>(path: string, init: RequestInit): Promise<T> => {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: { ...headers, ...init.headers },
        signal: init.signal ?? AbortSignal.timeout(30_000),
      });
    } catch {
      throw new XTraceHttpError(0, true, "XTrace request could not be completed");
    }

    const payload = await response.json().catch(() => undefined) as unknown;
    if (!response.ok) {
      throw new XTraceHttpError(
        response.status,
        response.status === 429 || response.status >= 500,
        "XTrace request failed",
      );
    }
    return payload as T;
  };

  return {
    ingest: async (input, options) => normalizeJobResponse(await request<unknown>(
      `/v1/memories${waitQuery(options?.wait)}`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    )),
    getJob: async (jobId) => normalizeJobResponse(await request<unknown>(
      `/v1/memories/jobs/${encodeURIComponent(jobId)}`,
      { method: "GET" },
    )),
    search: async (input) => {
      const response = await request<unknown>("/v1/memories/search", {
        method: "POST",
        body: JSON.stringify(input),
      });
      return normalizeSearchResponse(response);
    },
    deleteMemory: async (memoryId) => {
      await request<unknown>(`/v1/memories/${encodeURIComponent(memoryId)}`, {
        method: "DELETE",
      });
    },
  };
}

function waitQuery(wait: boolean | undefined): string {
  return wait ? "?wait=true" : "";
}

export class XTraceLiveExecutionAuthorizationError extends Error {
  readonly code = "XTRACE_LIVE_EXECUTION_NOT_AUTHORIZED";

  constructor() {
    super("Live XTrace execution requires an explicit non-dry-run stage");
    this.name = "XTraceLiveExecutionAuthorizationError";
  }
}

export function getXTraceClient(
  authorization?: {
    stage: "explicit_ingest" | "explicit_recall";
    allowLive: true;
  },
  environment: XTraceEnvironment | NodeJS.ProcessEnv = process.env,
): XTraceClient {
  if (typeof window !== "undefined") {
    throw new XTraceConfigurationError("XTrace client may only be created on the server");
  }
  if (!authorization?.allowLive || environment.XTRACE_DRY_RUN === "1") {
    throw new XTraceLiveExecutionAuthorizationError();
  }
  if (!isXTraceConfigured(environment)) throw new XTraceConfigurationError();

  const apiKey = environment.XTRACE_API_KEY!.trim();
  return createXTraceClient({
    apiKey,
    orgId: apiKey.startsWith("mmk_")
      ? undefined
      : environment.XTRACE_ORG_ID?.trim(),
    baseUrl: environment.XTRACE_API_BASE_URL,
  });
}

function normalizeSearchResponse(response: unknown): XTraceSearchResponse {
  if (!isRecord(response) || !Array.isArray(response.data) || response.success === false) {
    throw new XTraceHttpError(200, false, "XTrace search response was invalid");
  }
  const legacyEnvelope = response.success === true;
  const documentedEnvelope =
    response.object === "search"
    && (response.mode === "retrieve" || response.mode === "compose")
    && (typeof response.context === "string" || response.context === null)
    && isRecord(response.stage_timings)
    && typeof response.context_selection_applied === "boolean";
  if (!legacyEnvelope && !documentedEnvelope) {
    throw new XTraceHttpError(200, false, "XTrace search response was invalid");
  }
  return {
    ...(legacyEnvelope ? { success: true as const } : {}),
    ...(documentedEnvelope
      ? {
          object: "search" as const,
          mode: response.mode as "retrieve" | "compose",
        }
      : {}),
    context: typeof response.context === "string" ? response.context : undefined,
    count: typeof response.count === "number" ? response.count : undefined,
    data: response.data.flatMap(normalizeSearchResult),
  };
}

function normalizeJobResponse(response: unknown): XTraceJob {
  if (!isRecord(response)) return invalidJobResponse();
  const allowedKeys = new Set(["id", "status", "result", "error"]);
  if (Object.keys(response).some((key) => !allowedKeys.has(key))) {
    return invalidJobResponse();
  }
  if (
    typeof response.id !== "string"
    || response.id.trim() === ""
    || !["pending", "running", "succeeded", "failed"].includes(
      String(response.status),
    )
  ) return invalidJobResponse();
  const status = response.status as XTraceJob["status"];
  let result: XTraceJob["result"];
  if (status === "succeeded") {
    if (
      !isRecord(response.result)
      || Object.keys(response.result).some((key) => key !== "memories_created")
      || !Array.isArray(response.result.memories_created)
    ) return invalidJobResponse();
    const memories = response.result.memories_created;
    if (!memories.every(isStrictMemoryRef)) return invalidJobResponse();
    result = { memories_created: memories };
  } else if (response.result !== undefined && response.result !== null) {
    return invalidJobResponse();
  }
  let error: XTraceJob["error"];
  if (status === "failed") {
    if (!isRecord(response.error)) return invalidJobResponse();
    const allowedErrorKeys = new Set(["code", "message"]);
    if (
      Object.keys(response.error).some((key) => !allowedErrorKeys.has(key))
      || (response.error.code !== undefined && typeof response.error.code !== "string")
      || (response.error.message !== undefined && typeof response.error.message !== "string")
    ) return invalidJobResponse();
    error = {
      ...(typeof response.error.code === "string" ? { code: response.error.code } : {}),
      ...(typeof response.error.message === "string"
        ? { message: response.error.message }
        : {}),
    };
  } else if (response.error !== undefined && response.error !== null) {
    return invalidJobResponse();
  }
  return { id: response.id, status, ...(result ? { result } : {}), ...(error ? { error } : {}) };
}

function isStrictMemoryRef(value: unknown): value is XTraceMemoryRef {
  return isRecord(value)
    && Object.keys(value).every((key) => ["id", "type", "text"].includes(key))
    && typeof value.id === "string"
    && value.id.trim() !== ""
    && typeof value.type === "string"
    && value.type.trim() !== ""
    && typeof value.text === "string";
}

function invalidJobResponse(): never {
  throw new XTraceHttpError(200, false, "XTrace job response was invalid");
}

function normalizeSearchResult(row: unknown): XTraceSearchResult[] {
  if (!isRecord(row)) return invalidSearchResult();
  const allowedKeys = new Set([
    "id", "type", "text", "score", "user_id", "conv_id", "app_id",
    "agent_id", "metadata",
  ]);
  if (
    Object.keys(row).some((key) => !allowedKeys.has(key))
    || typeof row.id !== "string"
    || row.id.trim() === ""
    || typeof row.text !== "string"
    || typeof row.score !== "number"
    || !Number.isFinite(row.score)
    || (row.type !== undefined && typeof row.type !== "string")
    || !isOptionalNullableString(row.user_id)
    || !isOptionalNullableString(row.conv_id)
    || !isOptionalNullableString(row.app_id)
    || !isOptionalNullableString(row.agent_id)
    || (row.metadata !== undefined && !isRecord(row.metadata))
  ) return invalidSearchResult();
  return [{
    id: row.id,
    text: row.text,
    type: typeof row.type === "string" ? row.type : undefined,
    score: row.score,
    user_id: typeof row.user_id === "string" ? row.user_id : null,
    conv_id: typeof row.conv_id === "string" ? row.conv_id : null,
    app_id: typeof row.app_id === "string" ? row.app_id : null,
    agent_id: typeof row.agent_id === "string" ? row.agent_id : null,
    metadata: isRecord(row.metadata) ? row.metadata : undefined,
  }];
}

function isOptionalNullableString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function invalidSearchResult(): never {
  throw new XTraceHttpError(200, false, "XTrace search response was invalid");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
