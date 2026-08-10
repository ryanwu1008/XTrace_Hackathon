import { z } from "zod";

export const NAMED_LENS_PROVIDER_TIMEOUT_POLICY_VERSION =
  "named-lens-provider-timeout-v1" as const;
export const DEFAULT_NAMED_LENS_PROVIDER_TIMEOUT_MS = 20_000;

export const NamedLensProviderTimeoutPolicySchema = z.strictObject({
  version: z.literal(NAMED_LENS_PROVIDER_TIMEOUT_POLICY_VERSION),
  timeoutMs: z.number().int().positive().max(300_000),
});

export type NamedLensProviderTimeoutPolicy = z.infer<
  typeof NamedLensProviderTimeoutPolicySchema
>;

export const CURRENT_NAMED_LENS_PROVIDER_TIMEOUT_POLICY = Object.freeze({
  version: NAMED_LENS_PROVIDER_TIMEOUT_POLICY_VERSION,
  timeoutMs: DEFAULT_NAMED_LENS_PROVIDER_TIMEOUT_MS,
}) satisfies NamedLensProviderTimeoutPolicy;

export function createNamedLensProviderTimeoutPolicy(
  timeoutMs = DEFAULT_NAMED_LENS_PROVIDER_TIMEOUT_MS,
): NamedLensProviderTimeoutPolicy {
  return Object.freeze(NamedLensProviderTimeoutPolicySchema.parse({
    version: NAMED_LENS_PROVIDER_TIMEOUT_POLICY_VERSION,
    timeoutMs,
  }));
}
