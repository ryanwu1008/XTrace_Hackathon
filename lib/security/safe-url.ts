import { z } from "zod";

import { compareUtf8 } from "../format/canonical-order";

const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
]);

/**
 * Return the one persisted representation accepted for public HTTP(S) URLs.
 * Credentials, fragments, tracking parameters, and non-deterministic query
 * ordering are removed so the URL can safely participate in evidence identity.
 */
export function canonicalizeHttpUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(`Unsupported source URL protocol: ${url.protocol}`);
  }

  url.hash = "";
  url.username = "";
  url.password = "";

  const retainedParameters = [...url.searchParams.entries()]
    .filter(([name]) => {
      const normalized = name.toLowerCase();
      return !normalized.startsWith("utm_")
        && !TRACKING_PARAMETERS.has(normalized);
    })
    .sort(([leftName, leftValue], [rightName, rightValue]) => (
      compareUtf8(leftName, rightName) || compareUtf8(leftValue, rightValue)
    ));

  url.search = "";
  for (const [name, parameterValue] of retainedParameters) {
    url.searchParams.append(name, parameterValue);
  }

  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString().replace(/\/$/, "");
}

export const CanonicalHttpUrlSchema = z.string().url().superRefine(
  (value, context) => {
    try {
      if (canonicalizeHttpUrl(value) !== value) {
        context.addIssue({
          code: "custom",
          message: "Source URL must use its canonical HTTP(S) form",
        });
      }
    } catch {
      context.addIssue({
        code: "custom",
        message: "Source URL must use the HTTP or HTTPS protocol",
      });
    }
  },
);

/** Resolve untrusted legacy external links without ever returning an active non-HTTP URL. */
export function safeExternalHttpUrl(
  value: string | null | undefined,
): string | undefined {
  if (!value) return undefined;
  try {
    return canonicalizeHttpUrl(value);
  } catch {
    return undefined;
  }
}
