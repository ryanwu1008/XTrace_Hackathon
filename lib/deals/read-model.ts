import type {
  DealRegistry,
  RegisteredDeal,
} from "../../db/repositories/deal-registry";
import type {
  IntelligenceRepository,
} from "../../db/repositories/intelligence";
import type {
  UploadedDocumentsRepository,
} from "../../db/repositories/uploaded-documents";
import type { DealMemoryBundle } from "../contracts/domain";

export interface ProductDealSampleDecisionRecord {
  id: string;
  label: "Sample decision record";
  provenance: "demo_fixture";
  meetingSummary: string;
  decisionReason: string;
  concerns: string[];
  revisitConditions: string[];
}

export interface ProductDealView {
  id: string;
  companyName: string;
  status: RegisteredDeal["status"];
  documentId: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceRevisionIds: string[];
  sourceCount: number;
  sourceLinks: Array<{
    sourceRevisionId: string;
    sourceUrl: string;
  }>;
  fixture?: ProductDealSampleDecisionRecord;
}

export function toProductDealView(
  deal: RegisteredDeal,
  memoryBundle?: DealMemoryBundle | null,
): ProductDealView {
  if (
    memoryBundle
    && (
      memoryBundle.dealId !== deal.id
      || memoryBundle.companyName !== deal.companyName
      || memoryBundle.status !== deal.status
    )
  ) {
    throw new Error("The memory bundle must match its registry Deal identity.");
  }
  const sourceRevisionIds = [...deal.activeSourceRevisionIds];
  const sourceLinks = sourceRevisionIds.map((sourceRevisionId) => ({
    sourceRevisionId,
    sourceUrl:
      `/api/source-revisions/${encodeURIComponent(sourceRevisionId)}/access`,
  }));
  const primary = sourceLinks[0] ?? null;
  const interaction = memoryBundle
    ? [...memoryBundle.interactions].sort((left, right) =>
      right.occurredAt.localeCompare(left.occurredAt)
    )[0]
    : undefined;
  return {
    id: deal.id,
    companyName: deal.companyName,
    status: deal.status,
    documentId: primary?.sourceRevisionId ?? "",
    sourceTitle: sourceRevisionIds.length === 1
      ? "1 confirmed source"
      : `${sourceRevisionIds.length} confirmed sources`,
    sourceUrl: primary?.sourceUrl ?? "",
    sourceRevisionIds,
    sourceCount: sourceRevisionIds.length,
    sourceLinks,
    ...(interaction
      ? {
          fixture: {
            id: interaction.id,
            label: interaction.label,
            provenance: interaction.provenance,
            meetingSummary: interaction.summary,
            decisionReason: interaction.decisionReason,
            concerns: [...interaction.concerns],
            revisitConditions: [...interaction.revisitConditions],
          },
        }
      : {}),
  };
}

export async function listProductDeals(input: {
  workspaceId: string;
  query: string;
  status: string;
  deals: DealRegistry;
}): Promise<ProductDealView[]> {
  const query = input.query.toLocaleLowerCase();
  const [registeredDeals, memoryBundles] = await Promise.all([
    input.deals.listForWorkspace(input.workspaceId),
    input.deals.listAnalysisEligibleBundles(input.workspaceId),
  ]);
  const memoryByDeal = new Map(memoryBundles.map((bundle) => [
    bundle.dealId,
    bundle,
  ]));
  return registeredDeals
    .map((deal) => toProductDealView(deal, memoryByDeal.get(deal.id)))
    .filter((deal) => {
      if (input.status && deal.status !== input.status) return false;
      if (!query) return true;
      return [
        deal.id,
        deal.companyName,
        deal.status,
        ...deal.sourceRevisionIds,
        deal.fixture?.meetingSummary,
        deal.fixture?.decisionReason,
        ...(deal.fixture?.concerns ?? []),
        ...(deal.fixture?.revisitConditions ?? []),
      ].join(" ").toLocaleLowerCase().includes(query);
    });
}

export async function findProductDeal(input: {
  workspaceId: string;
  dealId: string;
  deals: DealRegistry;
}): Promise<ProductDealView | null> {
  const [deal, memoryBundles] = await Promise.all([
    input.deals.findForWorkspace({
      workspaceId: input.workspaceId,
      dealId: input.dealId,
    }),
    input.deals.listAnalysisEligibleBundles(input.workspaceId),
  ]);
  if (!deal) return null;
  return toProductDealView(
    deal,
    memoryBundles.find((bundle) => bundle.dealId === deal.id),
  );
}

export async function buildProductOverview(input: {
  workspaceId: string;
  deals: DealRegistry;
  intelligence: IntelligenceRepository;
  uploads: UploadedDocumentsRepository;
  now: () => number;
}) {
  const [publicDeals, reports, uploads] = await Promise.all([
    listProductDeals({
      workspaceId: input.workspaceId,
      query: "",
      status: "",
      deals: input.deals,
    }),
    input.intelligence.listReports(input.workspaceId),
    input.uploads.list(input.workspaceId),
  ]);
  return {
    generatedAt: new Date(input.now()).toISOString(),
    windowDays: 14 as const,
    stats: {
      deals: publicDeals.length,
      marketReports: reports.length,
      referenceDocuments: 0,
      fixtureDeals: publicDeals.filter((deal) => deal.fixture !== undefined)
        .length,
      activeSourceRevisions: publicDeals.reduce(
        (count, deal) => count + deal.sourceCount,
        0,
      ),
      uploads: uploads.length,
    },
    deals: publicDeals,
    documents: [],
  };
}
