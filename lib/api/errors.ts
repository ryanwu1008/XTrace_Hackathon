export class IntegrationTransportError extends Error {
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(input: { retryable: boolean; status?: number }) {
    // The status is part of the message because this error is frequently the
    // only record left in a Worker log, and "transport failure" alone does not
    // distinguish an expired credential from an unreachable gateway.
    super(
      input.status === undefined
        ? "Integration transport failure"
        : `Integration transport failure (HTTP ${input.status})`,
    );
    this.name = "IntegrationTransportError";
    this.retryable = input.retryable;
    this.status = input.status ?? null;
  }
}

export function isRetryableTransportStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
