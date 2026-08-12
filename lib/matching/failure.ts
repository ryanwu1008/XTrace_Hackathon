import { IntegrationTransportError } from "../api/errors";
import { ClaudeCompletionTruncatedError } from "../claude/client";

export type MatchingFailureCode =
  | "MATCHING_PROVIDER_AUTH_FAILED"
  | "MATCHING_PROVIDER_RATE_LIMITED"
  | "MATCHING_PROVIDER_UNAVAILABLE"
  | "MATCHING_PROVIDER_REQUEST_REJECTED"
  | "MATCHING_RESPONSE_INVALID"
  | "MATCHING_RESPONSE_TRUNCATED"
  | "MATCHING_UNAVAILABLE";

export type MatchingFailurePhase =
  | "provider_request"
  | "provider_response"
  | "response_validation"
  | "matching";

export class MatchingFailure extends Error {
  readonly code: MatchingFailureCode;
  readonly phase: MatchingFailurePhase;

  constructor(input: {
    code: MatchingFailureCode;
    phase: MatchingFailurePhase;
  }) {
    super(`${input.code} (${input.phase})`);
    this.name = "MatchingFailure";
    this.code = input.code;
    this.phase = input.phase;
  }
}

export function classifyMatchingProviderFailure(error: unknown): MatchingFailure {
  if (error instanceof MatchingFailure) return error;
  if (error instanceof ClaudeCompletionTruncatedError) {
    return new MatchingFailure({
      code: "MATCHING_RESPONSE_TRUNCATED",
      phase: "provider_response",
    });
  }
  if (error instanceof IntegrationTransportError) {
    if (error.status === 401 || error.status === 403) {
      return new MatchingFailure({
        code: "MATCHING_PROVIDER_AUTH_FAILED",
        phase: "provider_request",
      });
    }
    if (error.status === 429) {
      return new MatchingFailure({
        code: "MATCHING_PROVIDER_RATE_LIMITED",
        phase: "provider_request",
      });
    }
    if (
      error.status === null
      || error.status >= 500
      || error.retryable
    ) {
      return new MatchingFailure({
        code: "MATCHING_PROVIDER_UNAVAILABLE",
        phase: "provider_request",
      });
    }
    return new MatchingFailure({
      code: "MATCHING_PROVIDER_REQUEST_REJECTED",
      phase: "provider_request",
    });
  }
  return new MatchingFailure({
    code: "MATCHING_PROVIDER_UNAVAILABLE",
    phase: "provider_request",
  });
}

export function safeMatchingFailureDiagnostic(error: unknown): {
  code: MatchingFailureCode;
  phase: MatchingFailurePhase;
} {
  return error instanceof MatchingFailure
    ? { code: error.code, phase: error.phase }
    : { code: "MATCHING_UNAVAILABLE", phase: "matching" };
}
