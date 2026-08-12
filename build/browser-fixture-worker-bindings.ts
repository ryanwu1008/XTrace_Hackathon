const BROWSER_FIXTURE_SENTINEL =
  "BELIEF_REVERSAL_BROWSER_FIXTURE_RUNTIME" as const;

const BROWSER_FIXTURE_WORKER_BINDING_NAMES = [
  "BELIEF_REVERSAL_BROWSER_FIXTURE_RUNTIME",
  "PUBLIC_APP_URL",
  "VSEE_DEPLOYMENT_MODE",
  "DEMO_WORKSPACE_ID",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_STORAGE_BUCKET",
  "DOCUMENT_URL_SIGNING_SECRET",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_API_KEY",
  "XTRACE_API_KEY",
  "XTRACE_APP_ID",
  "XTRACE_DRY_RUN",
  "MARKET_USER_AGENT",
  "MARKET_OFFICIAL_FEEDS_JSON",
  "MARKET_PUBLISHER_FEEDS_JSON",
] as const;

type BrowserFixtureWorkerBindingName =
  (typeof BROWSER_FIXTURE_WORKER_BINDING_NAMES)[number];

export type BeliefReversalBrowserFixtureWorkerBindings = Readonly<
  Record<BrowserFixtureWorkerBindingName, string>
>;

/**
 * Cloudflare's Vite runtime receives Worker bindings from its config, not the
 * Node process that launches `vinext dev`. Copy only the disposable fixture's
 * explicit allowlist, and only when the fixture-owned sentinel is present.
 */
export function resolveBeliefReversalBrowserFixtureWorkerBindings(
  environment: Readonly<Record<string, string | undefined>>,
): BeliefReversalBrowserFixtureWorkerBindings | undefined {
  if (environment[BROWSER_FIXTURE_SENTINEL] !== "1") return undefined;

  const entries = BROWSER_FIXTURE_WORKER_BINDING_NAMES.map((name) => {
    const value = environment[name]?.trim();
    if (!value) {
      throw new Error(`Browser fixture Worker binding ${name} is required.`);
    }
    return [name, value] as const;
  });
  const bindings = Object.fromEntries(entries) as Record<
    BrowserFixtureWorkerBindingName,
    string
  >;
  if (bindings.VSEE_DEPLOYMENT_MODE !== "public_sandbox") {
    throw new Error("Browser fixture Worker bindings require public_sandbox mode.");
  }
  for (const name of ["PUBLIC_APP_URL", "SUPABASE_URL"] as const) {
    const url = new URL(bindings[name]);
    if (
      url.protocol !== "http:"
      || url.hostname !== "127.0.0.1"
      || !url.port
      || url.pathname !== "/"
      || url.search
      || url.hash
    ) {
      throw new Error(`Browser fixture Worker binding ${name} must be loopback.`);
    }
  }
  if (
    !bindings.ANTHROPIC_API_KEY.startsWith("belief-reversal-test-only-")
    || !bindings.XTRACE_API_KEY.startsWith("mmk_test_only_")
    || !bindings.XTRACE_APP_ID.startsWith("xtrace-belief-reversal-browser-")
    || bindings.XTRACE_DRY_RUN !== "1"
  ) {
    throw new Error("Browser fixture Worker provider bindings are not test-only.");
  }
  return Object.freeze(bindings);
}
