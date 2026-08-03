import { ZodError } from "zod";
import type { ApiErrorCode } from "../contracts/http";
import { IntegrationTransportError } from "./errors";
import {
  ReportScopeMismatchError,
  ReportScopeNotFoundError,
} from "../reports/evidence-scope";

function privateNoStoreHeaders(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  result.set("cache-control", "private, no-store");
  return result;
}

export function jsonOk<T>(data: T, init: ResponseInit = {}) {
  return Response.json(
    { data },
    {
      status: 200,
      ...init,
      headers: privateNoStoreHeaders(init.headers),
    },
  );
}

export function jsonCreated<T>(data: T) {
  return Response.json(
    { data },
    { status: 201, headers: privateNoStoreHeaders() },
  );
}

export function jsonError(
  code: ApiErrorCode,
  message: string,
  status: number,
  retryable = false,
) {
  return Response.json(
    { error: { code, message, retryable } },
    { status, headers: privateNoStoreHeaders() },
  );
}

export function errorResponse(error: unknown) {
  if (error instanceof ZodError) {
    return jsonError("VALIDATION_ERROR", error.issues[0]?.message ?? "Invalid request", 400);
  }
  if (error instanceof ReportScopeNotFoundError) {
    return jsonError("NOT_FOUND", error.message, 404);
  }
  if (error instanceof ReportScopeMismatchError) {
    return jsonError("VALIDATION_ERROR", error.message, 400);
  }
  if (error instanceof Error && error.message === "UNAUTHENTICATED") {
    return jsonError("UNAUTHENTICATED", "Authentication required", 401);
  }
  if (error instanceof Error && error.message === "FORBIDDEN") {
    return jsonError("FORBIDDEN", "Access denied", 403);
  }
  if (error instanceof IntegrationTransportError && error.retryable) {
    console.error("Unavailable API integration", error);
    return jsonError("INTEGRATION_UNAVAILABLE", "A required service is unavailable", 503, true);
  }
  console.error("Unhandled API error", error);
  return jsonError("INTERNAL_ERROR", "Internal server error", 500);
}
