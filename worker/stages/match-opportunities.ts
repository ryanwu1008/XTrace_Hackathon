import type {
  MarketEventV2,
  SourceRefV2,
} from "../../lib/contracts/source-evidence";
import type {
  MatchingDeal,
  MatchingMemoryContext,
  MatchingReasoner,
} from "../../lib/matching/service";
import { createMatchingService } from "../../lib/matching/service";

export async function matchOpportunityStage(input: {
  deals: MatchingDeal[];
  events: MarketEventV2[];
  memoryContexts: MatchingMemoryContext[];
  sources: SourceRefV2[];
  reasoner: MatchingReasoner;
}) {
  return createMatchingService(input.reasoner).match(input);
}
