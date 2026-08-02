import type {
  EvidenceRoleV2,
  MarketEventV2,
  SourceAuthorityV2,
  SourceClassV2,
  WritableMarketEventV2,
} from "../contracts/source-evidence";

export type MarketConfidence = MarketEventV2["confidence"];

export interface MarketFetchWindow {
  from: Date;
  to: Date;
}

export interface RawSourceItem {
  providerId: string;
  externalId?: string;
  title: string;
  url: string;
  publisher: string;
  sourceClass: Exclude<SourceClassV2, "unknown_legacy" | "model_output" | "internal_decision_record">;
  sourceAuthority: Extract<SourceAuthorityV2, "primary" | "secondary">;
  evidenceRole: Exclude<EvidenceRoleV2, "unknown_legacy">;
  eventAt?: string;
  publishedAt?: string;
  retrievedAt?: string;
  updatedAt?: string;
  summary?: string;
  normalizedStatement?: string;
  eventType?: string;
  entities?: string[];
  sectors?: string[];
  themes?: string[];
  positiveImplications?: string[];
  negativeImplications?: string[];
  confidence?: MarketConfidence;
}

export interface MarketProvider {
  id: string;
  name: string;
  fetch(window: MarketFetchWindow): Promise<RawSourceItem[]>;
}

export type NormalizedMarketEvent = WritableMarketEventV2;

export interface MarketProviderReport {
  providerId: string;
  providerName: string;
  fetchedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  error?: string;
  lastSuccessAt?: string;
}

export interface MarketScanResult {
  status: "completed" | "partial" | "failed";
  window: {
    from: string;
    to: string;
    days: number;
  };
  events: NormalizedMarketEvent[];
  providers: MarketProviderReport[];
}

export interface MarketScanOptions {
  days?: number;
  now?: Date;
}

export type PersistMarketEvents = (
  events: NormalizedMarketEvent[],
) => Promise<void> | void;
