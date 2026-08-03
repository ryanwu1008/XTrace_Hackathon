import type { DealMemoryBundle } from "../../lib/contracts/domain";
import { getXTraceClient } from "../../lib/xtrace/client";
import { createXTraceService, type PersistedIngest } from "../../lib/xtrace/service";

type IngestMemoryService = Pick<ReturnType<typeof createXTraceService>, "ingestDealMemory" | "pollIngestJob">;

export async function ingestMemoryStage(
  bundle: DealMemoryBundle,
  options: {
    workspaceId: string;
    service?: IngestMemoryService;
  },
): Promise<PersistedIngest> {
  const service = options.service ?? createXTraceService(getXTraceClient({
    stage: "explicit_ingest",
    allowLive: true,
  }), {
    workspaceId: options.workspaceId,
  });
  const submitted = await service.ingestDealMemory(bundle);
  if (submitted.status !== "pending" && submitted.status !== "running") return submitted;

  return service.pollIngestJob(submitted.jobId, { dealId: bundle.dealId });
}
