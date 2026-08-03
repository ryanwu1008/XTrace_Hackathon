import { createHash } from "node:crypto";

import type { XTraceLineageSnapshot } from "../contracts/underwriting";

export interface ImmutableFingerprintRef {
  id: string;
  fingerprint: string;
}

export interface VersionedRef {
  id: string;
  version: string;
}

export type UnderwritingReferenceKind =
  | "critical_evidence_profile"
  | "benchmark_definition"
  | "valuation_method_policy"
  | "decision_policy"
  | "framework_pack";

export interface ReferenceDefinitionRef extends VersionedRef {
  kind: UnderwritingReferenceKind;
  parentId?: string;
  definitionFingerprint: string;
}

export interface UnderwritingReferenceCatalogSnapshot {
  definitions: ReferenceDefinitionRef[];
  definitionFingerprint: string;
}

export interface BatchFingerprintInput {
  workspaceId: string;
  evidenceFrame: UnderwritingEvidenceFrameV1;
  window: {
    days: 14;
    startsAt: string;
    endsAt: string;
  };
  marketSnapshot: ImmutableFingerprintRef;
  eligibleDealRevisions: Array<{
    dealId: string;
    status: string;
    sourceRevisionIds: string[];
    fingerprint: string;
  }>;
  xtraceLineage: XTraceLineageSnapshot;
  selectedEvents: ImmutableFingerprintRef[];
  matching: {
    providerModel: string;
    promptVersion: string;
    schemaVersion: string;
    scoringPolicyVersion: string;
    selectionPolicyVersion: string;
    judgmentFingerprint: string;
  };
  fundPolicySnapshot: {
    id: string;
    version: number;
    fingerprint: string;
  };
  frameworkPack: VersionedRef;
  routerVersion: string;
  decisionPolicy: VersionedRef;
  referenceCatalog: UnderwritingReferenceCatalogSnapshot;
}

export interface UnderwritingEvidenceFrameV1 {
  schemaVersion: "underwriting-evidence-frame-v1";
  evidenceMode: "live" | "pinned";
  contextFingerprint: string;
  eventSetFingerprint: string;
  bindingFingerprint: string;
  snapshotFingerprint: string | null;
}

export interface CandidateFingerprintInput {
  workspaceId: string;
  batchInputFingerprint: string;
  dealRevision: {
    dealId: string;
    status: string;
    sourceRevisionIds: string[];
    fingerprint: string;
  };
  evidencePack: {
    id: string;
    version: number;
    sourceRevisionIds: string[];
    fingerprint: string;
  };
  evidenceSourceIds: string[];
  context: {
    id: string;
    contextVersion: string;
    criticalEvidenceProfileId: string;
    benchmarkPackId: string | null;
    valuationMethodPolicyId: string;
    frameworkPackId: string;
    decisionPolicyId: string;
  };
  criticalEvidenceProfile: ReferenceDefinitionRef;
  benchmark: ReferenceDefinitionRef | null;
  valuationMethodPolicy: ReferenceDefinitionRef;
  frameworkPack: ReferenceDefinitionRef;
  decisionPolicy: ReferenceDefinitionRef;
  referenceCatalogFingerprint: string;
  frameworkCatalog?: {
    version: string;
    fingerprint: string;
    corpusDigest: string;
  } | null;
  formulaVersions: string[];
  providerModel: string;
  promptVersion: string;
  schemaVersion: string;
  settingsFingerprint: string;
  applicationCommit: string;
}

export function createBatchInputFingerprint(
  input: BatchFingerprintInput,
): string {
  if (input.window.days !== 14) {
    throw new Error("Underwriting batch fingerprints require a 14-day window.");
  }
  return fingerprint({
    kind: "underwriting-batch-input-v1",
    workspaceId: required(input.workspaceId, "workspaceId"),
    evidenceFrame: normalizedEvidenceFrame(input.evidenceFrame),
    window: {
      days: input.window.days,
      startsAt: required(input.window.startsAt, "window.startsAt"),
      endsAt: required(input.window.endsAt, "window.endsAt"),
    },
    marketSnapshot: normalizedFingerprintRef(input.marketSnapshot),
    eligibleDealRevisions: input.eligibleDealRevisions
      .map((revision) => ({
        dealId: required(revision.dealId, "dealId"),
        status: required(revision.status, "deal status"),
        sourceRevisionIds: sortedUnique(revision.sourceRevisionIds),
        fingerprint: required(revision.fingerprint, "Deal fingerprint"),
      }))
      .sort((left, right) => compareUtf8(left.dealId, right.dealId)),
    xtraceLineage: {
      memoryIds: sortedUnique(input.xtraceLineage.memoryIds),
      sourceRevisionIds: sortedUnique(input.xtraceLineage.sourceRevisionIds),
      sourceIds: sortedUnique(input.xtraceLineage.sourceIds),
      fixtureIds: sortedUnique(input.xtraceLineage.fixtureIds),
      capturedAt: required(
        input.xtraceLineage.capturedAt,
        "XTrace capture time",
      ),
    },
    selectedEvents: input.selectedEvents
      .map(normalizedFingerprintRef)
      .sort((left, right) => compareUtf8(left.id, right.id)),
    matching: normalizedRecord(input.matching),
    fundPolicySnapshot: {
      id: required(input.fundPolicySnapshot.id, "Fund Policy id"),
      version: input.fundPolicySnapshot.version,
      fingerprint: required(
        input.fundPolicySnapshot.fingerprint,
        "Fund Policy fingerprint",
      ),
    },
    frameworkPack: normalizedVersionedRef(input.frameworkPack),
    routerVersion: required(input.routerVersion, "Router version"),
    decisionPolicy: normalizedVersionedRef(input.decisionPolicy),
    referenceCatalog: normalizedReferenceCatalog(input.referenceCatalog),
  });
}

function normalizedEvidenceFrame(
  value: BatchFingerprintInput["evidenceFrame"],
) {
  const pinned = value.evidenceMode === "pinned";
  if (!pinned && value.evidenceMode !== "live") {
    throw new Error("Unsupported underwriting evidence mode.");
  }
  if (pinned !== (value.snapshotFingerprint !== null)) {
    throw new Error("Underwriting evidence snapshot identity is incomplete.");
  }
  return {
    schemaVersion: value.schemaVersion,
    evidenceMode: value.evidenceMode,
    contextFingerprint: requiredFingerprint(
      value.contextFingerprint,
      "Evidence context fingerprint",
    ),
    eventSetFingerprint: requiredFingerprint(
      value.eventSetFingerprint,
      "Evidence event-set fingerprint",
    ),
    bindingFingerprint: requiredFingerprint(
      value.bindingFingerprint,
      "Evidence binding fingerprint",
    ),
    snapshotFingerprint: value.snapshotFingerprint === null
      ? null
      : requiredFingerprint(
          value.snapshotFingerprint,
          "Evidence snapshot fingerprint",
        ),
  };
}

export function createCandidateAnalysisFingerprint(
  input: CandidateFingerprintInput,
): string {
  return fingerprint({
    kind: "candidate-analysis-input-v1",
    workspaceId: required(input.workspaceId, "workspaceId"),
    batchInputFingerprint: required(
      input.batchInputFingerprint,
      "batchInputFingerprint",
    ),
    dealRevision: {
      dealId: required(input.dealRevision.dealId, "Deal id"),
      status: required(input.dealRevision.status, "Deal status"),
      sourceRevisionIds: sortedUnique(
        input.dealRevision.sourceRevisionIds,
      ),
      fingerprint: required(
        input.dealRevision.fingerprint,
        "Deal revision fingerprint",
      ),
    },
    evidencePack: {
      id: required(input.evidencePack.id, "Evidence Pack id"),
      version: input.evidencePack.version,
      sourceRevisionIds: sortedUnique(
        input.evidencePack.sourceRevisionIds,
      ),
      fingerprint: required(
        input.evidencePack.fingerprint,
        "Evidence Pack fingerprint",
      ),
    },
    evidenceSourceIds: sortedUnique(input.evidenceSourceIds),
    context: normalizedRecord(input.context),
    criticalEvidenceProfile: normalizedReferenceDefinitionRef(
      input.criticalEvidenceProfile,
    ),
    benchmark: input.benchmark
      ? normalizedReferenceDefinitionRef(input.benchmark)
      : null,
    valuationMethodPolicy: normalizedReferenceDefinitionRef(
      input.valuationMethodPolicy,
    ),
    frameworkPack: normalizedReferenceDefinitionRef(input.frameworkPack),
    decisionPolicy: normalizedReferenceDefinitionRef(input.decisionPolicy),
    referenceCatalogFingerprint: requiredFingerprint(
      input.referenceCatalogFingerprint,
      "Reference catalog fingerprint",
    ),
    frameworkCatalog: input.frameworkCatalog
      ? {
        version: required(
          input.frameworkCatalog.version,
          "Framework catalog version",
        ),
        fingerprint: requiredFingerprint(
          input.frameworkCatalog.fingerprint,
          "Framework catalog fingerprint",
        ),
        corpusDigest: requiredFingerprint(
          input.frameworkCatalog.corpusDigest,
          "Framework corpus digest",
        ),
      }
      : null,
    formulaVersions: sortedUnique(input.formulaVersions),
    providerModel: required(input.providerModel, "Provider model"),
    promptVersion: required(input.promptVersion, "Prompt version"),
    schemaVersion: required(input.schemaVersion, "Schema version"),
    settingsFingerprint: required(
      input.settingsFingerprint,
      "Settings fingerprint",
    ),
    applicationCommit: required(
      input.applicationCommit,
      "Application commit",
    ),
  });
}

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Fingerprint inputs cannot contain non-finite numbers.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort(compareUtf8);
    return `{${keys.map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")}}`;
  }
  throw new Error(`Unsupported fingerprint input type: ${typeof value}.`);
}

export function createCanonicalFingerprint(value: unknown): string {
  return `sha256:${
    createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")
  }`;
}

export function createReferenceCatalogSnapshot(
  definitions: ReferenceDefinitionRef[],
): UnderwritingReferenceCatalogSnapshot {
  const normalizedDefinitions = definitions
    .map(normalizedReferenceDefinitionRef)
    .sort((left, right) =>
      compareUtf8(
        `${left.kind}\u0000${left.id}\u0000${left.parentId ?? ""}`,
        `${right.kind}\u0000${right.id}\u0000${right.parentId ?? ""}`,
      )
    );
  const identities = normalizedDefinitions.map((definition) =>
    `${definition.kind}\u0000${definition.id}\u0000${
      definition.parentId ?? ""
    }`
  );
  if (new Set(identities).size !== identities.length) {
    throw new Error("Reference catalog definition identities must be unique.");
  }
  return {
    definitions: normalizedDefinitions,
    definitionFingerprint: createCanonicalFingerprint({
      kind: "underwriting-reference-catalog-v1",
      definitions: normalizedDefinitions,
    }),
  };
}

function fingerprint(value: unknown): string {
  return createCanonicalFingerprint(value);
}

function normalizedFingerprintRef(
  value: ImmutableFingerprintRef,
): ImmutableFingerprintRef {
  return {
    id: required(value.id, "Snapshot id"),
    fingerprint: required(value.fingerprint, "Snapshot fingerprint"),
  };
}

function normalizedVersionedRef(value: VersionedRef): VersionedRef {
  return {
    id: required(value.id, "Versioned reference id"),
    version: required(value.version, "Versioned reference version"),
  };
}

function normalizedReferenceDefinitionRef(
  value: ReferenceDefinitionRef,
): ReferenceDefinitionRef {
  return {
    kind: value.kind,
    id: required(value.id, "Reference definition id"),
    version: required(value.version, "Reference definition version"),
    ...(value.parentId === undefined
      ? {}
      : { parentId: required(value.parentId, "Reference parent id") }),
    definitionFingerprint: requiredFingerprint(
      value.definitionFingerprint,
      "Reference definition fingerprint",
    ),
  };
}

function normalizedReferenceCatalog(
  value: UnderwritingReferenceCatalogSnapshot,
): UnderwritingReferenceCatalogSnapshot {
  const normalized = createReferenceCatalogSnapshot(value.definitions);
  if (
    normalized.definitionFingerprint
      !== requiredFingerprint(
        value.definitionFingerprint,
        "Reference catalog fingerprint",
      )
  ) {
    throw new Error(
      "Reference catalog fingerprint must match its exact definitions.",
    );
  }
  return normalized;
}

function normalizedRecord<T extends Record<string, unknown>>(value: T): T {
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") required(item, key);
  }
  return { ...value };
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => required(value, "Set item")))]
    .sort(compareUtf8);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function required(value: string, label: string): string {
  if (!value || value.trim() !== value) {
    throw new Error(`${label} must be non-empty without surrounding whitespace.`);
  }
  return value;
}

function requiredFingerprint(value: string, label: string): string {
  const normalized = required(value, label);
  if (!/^sha256:[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${label} must be a canonical SHA-256 digest.`);
  }
  return normalized;
}
