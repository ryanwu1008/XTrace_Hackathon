import type { AuthorizedRequestContext } from "../auth/request-context";

type Environment = Record<string, string | undefined>;

interface RateLimitInput {
  scope: string;
  clientId: string;
  limit: number;
  windowMs: number;
  now?: () => number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface PersistentRateLimitOptions {
  environment?: Environment;
  fetchImpl?: typeof fetch;
  context?: AuthorizedRequestContext;
}

const requestWindows = new Map<string, number[]>();

export function clientIdentifier(request: Request): string {
  return request.headers.get("cf-connecting-ip")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown-client";
}

export function takePublicRequest(input: RateLimitInput): RateLimitResult {
  const now = input.now ?? Date.now;
  const current = now();
  const key = `${input.scope}:${input.clientId}`;
  const timestamps = requestWindows.get(key) ?? [];
  const active = timestamps.filter((timestamp) =>
    timestamp > current - input.windowMs
  );
  if (active.length >= input.limit) {
    requestWindows.set(key, active);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((active[0] + input.windowMs - current) / 1_000),
      ),
    };
  }
  active.push(current);
  requestWindows.set(key, active);
  return { allowed: true, retryAfterSeconds: 0 };
}

export async function rateLimitRequest(
  request: Request,
  scope: string,
  limit: number,
  windowMs = 60_000,
  options: PersistentRateLimitOptions = {},
): Promise<RateLimitResult> {
  const environment = options.environment ?? process.env;
  const clientId = rateLimitClientIdentifier(request, options.context);
  const url = environment.SUPABASE_URL;
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY;
  if (url && serviceRoleKey) {
    const clientHash = await digestClientIdentifier(clientId);
    let response: Response;
    try {
      response = await (options.fetchImpl ?? fetch)(
        `${url.replace(/\/$/, "")}/rest/v1/rpc/take_public_request`,
        {
          method: "POST",
          headers: {
            apikey: serviceRoleKey,
            authorization: `Bearer ${serviceRoleKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            p_scope: scope,
            p_client_hash: clientHash,
            p_limit: limit,
            p_window_seconds: Math.max(1, Math.ceil(windowMs / 1_000)),
          }),
          cache: "no-store",
        },
      );
    } catch {
      return { allowed: false, retryAfterSeconds: 60 };
    }
    if (!response.ok) {
      return { allowed: false, retryAfterSeconds: 60 };
    }
    const rows = await response.json() as Array<{
      allowed: boolean;
      retry_after_seconds: number;
    }>;
    return {
      allowed: Boolean(rows[0]?.allowed),
      retryAfterSeconds: Math.max(0, Number(rows[0]?.retry_after_seconds ?? 0)),
    };
  }
  if (environment.NODE_ENV === "production") {
    return { allowed: false, retryAfterSeconds: 60 };
  }
  return takePublicRequest({
    scope,
    clientId,
    limit,
    windowMs,
  });
}

export type RateLimitRequest = typeof rateLimitRequest;

export function requirePermission(
  context: AuthorizedRequestContext,
  permission: keyof AuthorizedRequestContext["permissions"],
): void {
  if (!context.permissions[permission]) throw new Error("FORBIDDEN");
}

function rateLimitClientIdentifier(
  request: Request,
  context: AuthorizedRequestContext | undefined,
): string {
  if (context?.mode === "product") {
    if (!context.principal) throw new Error("UNAUTHENTICATED");
    return JSON.stringify([
      "principal",
      context.principal.userId,
      "workspace",
      context.workspaceId,
    ]);
  }
  if (context?.mode === "public_sandbox") {
    return JSON.stringify([
      "public_sandbox",
      "workspace",
      context.workspaceId,
      "origin",
      clientIdentifier(request),
    ]);
  }
  return clientIdentifier(request);
}

async function digestClientIdentifier(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
