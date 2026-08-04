import type { Calculation, ClaimEdge } from "../lib/contracts/evidence";
import type {
  DealUnderwritingQueueView,
  PublicCandidateVersionSnapshot,
} from "../lib/underwriting/read-model";
import { LEGACY_IMAGE_QUARANTINE_NOTICE } from "../lib/uploads/quarantine";

export type FinancialValuationField =
  | "maximumAcceptablePreMoney"
  | "initialOwnership"
  | "postDilutionOwnership"
  | "grossMoic"
  | "grossIrr"
  | "pricingPremium";

const FINANCIAL_CALCULATION_IDENTITY: Record<
  FinancialValuationField,
  { formulaId: string; outputField: string }
> = {
  maximumAcceptablePreMoney: {
    formulaId: "venture_return_method_v1",
    outputField: "maximum_acceptable_pre_money",
  },
  initialOwnership: {
    formulaId: "simple_pre_post_ownership_v1",
    outputField: "initial_ownership",
  },
  postDilutionOwnership: {
    formulaId: "future_dilution_v1",
    outputField: "post_dilution_ownership",
  },
  grossMoic: {
    formulaId: "gross_deal_moic_v1",
    outputField: "gross_moic",
  },
  grossIrr: {
    formulaId: "annualized_gross_irr_v1",
    outputField: "gross_irr",
  },
  pricingPremium: {
    formulaId: "market_comps_v1",
    outputField: "pricing_premium",
  },
};

export function orderUnderwritingQueue(
  queue: DealUnderwritingQueueView[],
): DealUnderwritingQueueView[] {
  return [...queue].sort((left, right) =>
    left.priorityRank - right.priorityRank
    || left.dealId.localeCompare(right.dealId)
  );
}

export function describeUploadState(input: {
  status:
    | "queued"
    | "extracting"
    | "awaiting_confirmation"
    | "confirmed"
    | "ingesting_memory"
    | "ready"
    | "failed";
  failure: string | null;
  memoryNotice?: string | null;
}): {
  label: string;
  tone: "neutral" | "active" | "warning" | "success" | "error";
  description: string;
  retryable: boolean;
} {
  if (
    input.status === "failed"
    && input.failure === LEGACY_IMAGE_QUARANTINE_NOTICE
  ) {
    return {
      label: "Legacy image quarantined",
      tone: "warning",
      description: input.failure,
      retryable: false,
    };
  }
  if (input.status === "confirmed" && input.failure) {
    return {
      label: "Retryable memory failure",
      tone: "warning",
      description: input.failure,
      retryable: true,
    };
  }
  if (input.status === "ready" && input.memoryNotice) {
    return {
      label: "Ready · structured evidence only",
      tone: "warning",
      description: input.memoryNotice,
      retryable: false,
    };
  }
  const states = {
    queued: {
      label: "Queued for extraction",
      tone: "active" as const,
      description: "The background worker has not claimed this upload yet.",
      retryable: false,
    },
    extracting: {
      label: "Extracting preview",
      tone: "active" as const,
      description: "The background worker is producing a reviewable preview.",
      retryable: false,
    },
    awaiting_confirmation: {
      label: "Needs confirmation",
      tone: "warning" as const,
      description:
        "Confirm company identity and Deal ownership before promotion.",
      retryable: false,
    },
    confirmed: {
      label: "Confirmed for promotion",
      tone: "active" as const,
      description: "Identity is confirmed and memory promotion is queued.",
      retryable: false,
    },
    ingesting_memory: {
      label: "Promoting confirmed source",
      tone: "active" as const,
      description: "The confirmed source is entering durable Deal memory.",
      retryable: false,
    },
    ready: {
      label: "Ready",
      tone: "success" as const,
      description: "The Deal and Source Revision are durable.",
      retryable: false,
    },
    failed: {
      label: "Terminal extraction failure",
      tone: "error" as const,
      description: input.failure ?? "Document processing failed.",
      retryable: false,
    },
  };
  return states[input.status];
}

export function lineageForClaim(input: {
  claimItemId: string;
  facts: Array<{ id: string; sourceRevisionId: string }>;
  claimEdges: ClaimEdge[];
}): {
  dependencyItemIds: string[];
  sourceRevisionIds: string[];
} {
  const factRevisionById = new Map(
    input.facts.map((fact) => [fact.id, fact.sourceRevisionId]),
  );
  const pending = [input.claimItemId];
  const visited = new Set<string>(pending);
  const dependencyItemIds: string[] = [];
  const sourceRevisionIds = new Set<string>();

  while (pending.length > 0) {
    const claimItemId = pending.shift()!;
    for (const edge of input.claimEdges) {
      if (
        edge.claimItemId !== claimItemId
        || visited.has(edge.dependencyItemId)
      ) continue;
      visited.add(edge.dependencyItemId);
      dependencyItemIds.push(edge.dependencyItemId);
      const revisionId = factRevisionById.get(edge.dependencyItemId);
      if (revisionId) sourceRevisionIds.add(revisionId);
      else pending.push(edge.dependencyItemId);
    }
  }

  return {
    dependencyItemIds,
    sourceRevisionIds: [...sourceRevisionIds].sort(),
  };
}

export function financialCalculationLineage(input: {
  field: FinancialValuationField;
  value: string | null;
  calculations: Array<Pick<Calculation, "id" | "formulaId" | "output">>;
  valuationCalculationIds: string[];
}): { kind: "Calculation"; itemId: string } | null {
  if (input.value === null) return null;
  const identity = FINANCIAL_CALCULATION_IDENTITY[input.field];
  const valuationCalculationIds = new Set(input.valuationCalculationIds);
  const expectedIdSuffix =
    `:${identity.formulaId}:${identity.outputField}`;
  const matches = input.calculations.filter((calculation) =>
    valuationCalculationIds.has(calculation.id)
    && calculation.formulaId === identity.formulaId
    && calculation.id.endsWith(expectedIdSuffix)
    && calculation.output === input.value
  );
  return matches.length === 1
    ? { kind: "Calculation", itemId: matches[0].id }
    : null;
}

export function versionRows(
  snapshot: PublicCandidateVersionSnapshot,
): Array<{ label: string; value: string }> {
  return [
    { label: "Policy", value: snapshot.fundPolicyId },
    {
      label: "Benchmark",
      value: snapshot.benchmarkPackId && snapshot.benchmarkEntryId
        ? withFingerprint(
          `${snapshot.benchmarkPackId} · ${snapshot.benchmarkEntryId}`,
          snapshot.benchmarkDefinitionFingerprint,
        )
        : "Unavailable — no compatible benchmark was pinned",
    },
    {
      label: "Framework",
      value: withFingerprint(
        snapshot.frameworkPackId,
        snapshot.frameworkPackDefinitionFingerprint,
      ),
    },
    {
      label: "Underwriting reference catalog",
      value: snapshot.referenceCatalogFingerprint,
    },
    {
      label: "Framework catalog version",
      value: snapshot.frameworkCatalogVersion
        ?? "Unavailable — legacy snapshot did not pin a framework catalog",
    },
    {
      label: "Framework catalog fingerprint",
      value: snapshot.frameworkCatalogFingerprint
        ?? "Unavailable — legacy snapshot did not pin a framework catalog",
    },
    {
      label: "Framework corpus digest",
      value: snapshot.frameworkCorpusDigest
        ?? "Unavailable — legacy snapshot did not pin a framework corpus",
    },
    { label: "Router", value: snapshot.routerVersion },
    {
      label: "Critical Evidence",
      value: withFingerprint(
        snapshot.criticalEvidenceProfileId,
        snapshot.criticalEvidenceProfileDefinitionFingerprint,
      ),
    },
    {
      label: "Valuation Method",
      value: withFingerprint(
        snapshot.valuationMethodPolicyId,
        snapshot.valuationMethodPolicyDefinitionFingerprint,
      ),
    },
    {
      label: "Decision",
      value: withFingerprint(
        snapshot.decisionPolicyId,
        snapshot.decisionPolicyDefinitionFingerprint,
      ),
    },
    {
      label: "Formula",
      value: snapshot.formulaVersions.length
        ? snapshot.formulaVersions.join(" · ")
        : "Unavailable",
    },
    { label: "Model", value: snapshot.providerModel },
    { label: "Prompt", value: snapshot.promptVersion },
    { label: "Schema", value: snapshot.schemaVersion },
    { label: "Settings", value: snapshot.settingsFingerprint },
    { label: "Application commit", value: snapshot.applicationCommit },
  ];
}

function withFingerprint(
  id: string,
  fingerprint: string | null,
): string {
  return fingerprint ? `${id} · ${fingerprint}` : id;
}
