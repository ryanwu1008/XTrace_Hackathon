import assert from "node:assert/strict";
import test from "node:test";

import { GET } from "../../app/api/search/route";
import type { RouteDependencies } from "../../lib/api/route-dependencies";

test("Search returns typed not-found when no terminal report scope exists", async () => {
  const dependencies = {
    resolveRequestContext: async () => ({
      mode: "product" as const,
      workspaceId: "workspace_1",
      principal: { userId: "user_1", email: "user@example.test" },
      role: "member" as const,
      permissions: {
        readWorkspace: true as const,
        readPrivateSources: true,
        mutateSources: true,
        managePolicy: false,
        administerFrameworks: false,
      },
    }),
    intelligence: {
      listReports: async () => [],
      getReport: async () => null,
    },
    runs: {
      list: async () => [],
      get: async () => null,
    },
  } as unknown as RouteDependencies;

  const response = await GET(
    new Request("https://vsee.test/api/search?q=market"),
    undefined,
    dependencies,
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: {
      code: "NOT_FOUND",
      message: "No terminal run-backed report scope was found.",
      retryable: false,
    },
  });
});
