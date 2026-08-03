import {
  EvidencePackSchema,
  SourceRevisionSchema,
  type EvidenceLocator,
  type EvidencePack,
  type Fact,
  type SourceRevision,
} from "../../lib/contracts/evidence";
import {
  IntegrationTransportError,
  isRetryableTransportStatus,
} from "../../lib/api/errors";
import {
  WritableSourceRefV2Schema,
  sourceTextForRetrieval,
  type WritableSourceRefV2,
} from "../../lib/contracts/source-evidence";
import { DealFactSchema, type DealFact } from "../../lib/contracts/domain";

export interface SourceEvidenceInput {
  id: string;
  workspaceId: string;
  dealId: string;
  sourceId: string;
  sourceRevisionId: string;
  provenanceOrigin: Fact["provenanceOrigin"];
  field: string;
  value: string;
  unit: string | null;
  currency: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  publishedAt: string | null;
  eventAt: string | null;
  retrievedAt: string;
  locator: EvidenceLocator;
  sourceRole: Fact["sourceRole"];
  assertionStatus: Fact["assertionStatus"];
  verificationMethod: string | null;
  freshness: Fact["freshness"];
  acceptedForGate: boolean;
  sourceRef?: WritableSourceRefV2;
  semanticFields?: NonNullable<DealFact["semanticFields"]>;
}

export interface SavedEvidencePack {
  pack: EvidencePack;
  inputFingerprint: string;
  sourceRevisionSnapshots: SourceRevision[];
}

/**
 * Persistence seam for extraction output and immutable Evidence Pack results.
 * Task 8 owns the eventual atomic Candidate finalization adapter; Task 9 does
 * not assume a table or RPC name.
 */
export interface EvidencePacksRepository {
  putSourceEvidence(inputs: SourceEvidenceInput[]): Promise<void>;
  listSourceEvidence(input: {
    workspaceId: string;
    dealId: string;
    sourceRevisionIds: string[];
  }): Promise<SourceEvidenceInput[]>;
  findByInputFingerprint(input: {
    workspaceId: string;
    inputFingerprint: string;
  }): Promise<SavedEvidencePack | null>;
  findByPackId(input: {
    workspaceId: string;
    packId: string;
  }): Promise<SavedEvidencePack | null>;
  saveExact(input: SavedEvidencePack): Promise<SavedEvidencePack>;
}

export interface MemoryEvidencePacksRepository
  extends EvidencePacksRepository {
  capturePromotionState(input: {
    workspaceId: string;
    evidenceIds: string[];
  }): unknown;
  restorePromotionState(before: unknown, expected: unknown): void;
  removeSourceEvidence(input: {
    workspaceId: string;
    evidenceId: string;
  }): Promise<void>;
  inspect(): {
    sourceEvidence: SourceEvidenceInput[];
    savedPacks: SavedEvidencePack[];
  };
}

export function createMemoryEvidencePacksRepository():
  MemoryEvidencePacksRepository {
  const evidence = new Map<string, SourceEvidenceInput>();
  const packsByFingerprint = new Map<string, SavedEvidencePack>();
  const fingerprintsByPack = new Map<string, string>();

  return {
    capturePromotionState(input) {
      const keys = input.evidenceIds.map((evidenceId) =>
        identity(
          requiredText(input.workspaceId, "A workspace"),
          requiredText(evidenceId, "An evidence item"),
        )
      );
      return {
        keys,
        items: Object.fromEntries(keys.map((key) => [
          key,
          evidence.has(key) ? structuredClone(evidence.get(key)) : null,
        ])),
      };
    },

    restorePromotionState(rawBefore, rawExpected) {
      type PromotionState = {
        keys: string[];
        items: Record<string, SourceEvidenceInput | null>;
      };
      const before = rawBefore as PromotionState;
      const expected = rawExpected as PromotionState;
      if (canonicalJson(before.keys) !== canonicalJson(expected.keys)) {
        throw new Error("Evidence promotion states do not share an identity.");
      }
      for (const key of before.keys) {
        const current = evidence.get(key) ?? null;
        if (canonicalJson(current) !== canonicalJson(expected.items[key])) {
          continue;
        }
        const prior = before.items[key];
        if (prior) evidence.set(key, structuredClone(prior));
        else evidence.delete(key);
      }
    },

    async putSourceEvidence(inputs) {
      for (const rawInput of inputs) {
        const input = validateSourceEvidenceInput(rawInput);
        const key = identity(input.workspaceId, input.id);
        const existing = evidence.get(key);
        if (existing && canonicalJson(existing) !== canonicalJson(input)) {
          throw new Error(
            `Source evidence ${input.id} is immutable and already differs.`,
          );
        }
        evidence.set(key, structuredClone(input));
      }
    },

    async listSourceEvidence(input) {
      const workspaceId = requiredText(input.workspaceId, "A workspace");
      const dealId = requiredText(input.dealId, "A Deal");
      const revisionIds = new Set(input.sourceRevisionIds);
      return [...evidence.values()]
        .filter((candidate) =>
          candidate.workspaceId === workspaceId
          && candidate.dealId === dealId
          && revisionIds.has(candidate.sourceRevisionId)
        )
        .sort((left, right) => compareUtf8(left.id, right.id))
        .map((candidate) => structuredClone(candidate));
    },

    async findByInputFingerprint(input) {
      const record = packsByFingerprint.get(
        identity(
          requiredText(input.workspaceId, "A workspace"),
          requiredFingerprint(input.inputFingerprint),
        ),
      );
      return record ? structuredClone(record) : null;
    },

    async findByPackId(input) {
      const workspaceId = requiredText(input.workspaceId, "A workspace");
      const packId = requiredText(input.packId, "An Evidence Pack");
      const fingerprint = fingerprintsByPack.get(
        identity(workspaceId, packId),
      );
      if (!fingerprint) return null;
      const record = packsByFingerprint.get(
        identity(workspaceId, fingerprint),
      );
      return record ? structuredClone(record) : null;
    },

    async saveExact(rawInput) {
      const input = validateSavedEvidencePack(rawInput);
      const fingerprintKey = identity(
        input.pack.workspaceId,
        input.inputFingerprint,
      );
      const packKey = identity(input.pack.workspaceId, input.pack.id);
      const existingByFingerprint = packsByFingerprint.get(fingerprintKey);
      if (existingByFingerprint) {
        if (
          canonicalJson(existingByFingerprint) !== canonicalJson(input)
        ) {
          throw new Error(
            "An Evidence Pack input fingerprint is immutable and already differs.",
          );
        }
        return structuredClone(existingByFingerprint);
      }
      const existingFingerprint = fingerprintsByPack.get(packKey);
      if (
        existingFingerprint
        && existingFingerprint !== input.inputFingerprint
      ) {
        throw new Error(
          `Evidence Pack ${input.pack.id} is immutable and already differs.`,
        );
      }
      packsByFingerprint.set(fingerprintKey, structuredClone(input));
      fingerprintsByPack.set(packKey, input.inputFingerprint);
      return structuredClone(input);
    },

    async removeSourceEvidence(input) {
      evidence.delete(identity(
        requiredText(input.workspaceId, "A workspace"),
        requiredText(input.evidenceId, "An evidence item"),
      ));
    },

    inspect() {
      return {
        sourceEvidence: [...evidence.values()]
          .sort((left, right) => compareUtf8(left.id, right.id))
          .map((item) => structuredClone(item)),
        savedPacks: [...packsByFingerprint.values()]
          .sort((left, right) =>
            compareUtf8(left.inputFingerprint, right.inputFingerprint)
          )
          .map((item) => structuredClone(item)),
      };
    },
  };
}

export function createSupabaseEvidencePacksRepository(options: {
  url: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}): EvidencePacksRepository {
  const base = `${options.url.replace(/\/$/, "")}/rest/v1`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = {
    apikey: options.serviceRoleKey,
    authorization: `Bearer ${options.serviceRoleKey}`,
    "content-type": "application/json",
  };

  async function request(
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        ...init,
        headers: { ...headers, ...(init.headers ?? {}) },
        cache: "no-store",
      });
    } catch {
      throw new IntegrationTransportError({ retryable: true });
    }
    if (!response.ok) {
      throw new IntegrationTransportError({
        retryable: isRetryableTransportStatus(response.status),
      });
    }
    if (response.status === 204) return null;
    const body = await response.text();
    return body.trim() ? JSON.parse(body) : null;
  }

  function savedPack(row: Record<string, unknown>): SavedEvidencePack {
    return validateSavedEvidencePack({
      pack: row.pack_payload as EvidencePack,
      inputFingerprint: String(row.input_fingerprint),
      sourceRevisionSnapshots:
        row.source_revision_snapshots as SourceRevision[],
    });
  }

  return {
    async putSourceEvidence(inputs) {
      const validated = inputs.map(validateSourceEvidenceInput);
      await request("/rpc/save_source_evidence_items", {
        method: "POST",
        body: JSON.stringify({ p_items: validated }),
      });
    },

    async listSourceEvidence(input) {
      const workspaceId = requiredText(input.workspaceId, "A workspace");
      const dealId = requiredText(input.dealId, "A Deal");
      const sourceRevisionIds = [
        ...new Set(
          input.sourceRevisionIds.map((revisionId) =>
            requiredText(revisionId, "A source revision")
          ),
        ),
      ];
      if (sourceRevisionIds.length === 0) return [];
      const query = new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        deal_id: `eq.${dealId}`,
        source_revision_id:
          `in.(${sourceRevisionIds.map(encodePostgrestValue).join(",")})`,
        select: "payload",
        order: "evidence_id.asc",
      });
      const rows = await request(`/source_evidence_items?${query}`) as Array<
        Record<string, unknown>
      >;
      return rows.map((row) =>
        validateSourceEvidenceInput(row.payload as SourceEvidenceInput)
      );
    },

    async findByInputFingerprint(input) {
      const query = new URLSearchParams({
        workspace_id:
          `eq.${requiredText(input.workspaceId, "A workspace")}`,
        input_fingerprint: `eq.${requiredFingerprint(input.inputFingerprint)}`,
        select: "input_fingerprint,pack_payload,source_revision_snapshots",
        limit: "1",
      });
      const rows = await request(`/evidence_pack_builds?${query}`) as Array<
        Record<string, unknown>
      >;
      return rows[0] ? savedPack(rows[0]) : null;
    },

    async findByPackId(input) {
      const query = new URLSearchParams({
        workspace_id:
          `eq.${requiredText(input.workspaceId, "A workspace")}`,
        pack_id: `eq.${requiredText(input.packId, "An Evidence Pack")}`,
        select: "input_fingerprint,pack_payload,source_revision_snapshots",
        limit: "1",
      });
      const rows = await request(`/evidence_pack_builds?${query}`) as Array<
        Record<string, unknown>
      >;
      return rows[0] ? savedPack(rows[0]) : null;
    },

    async saveExact(input) {
      const validated = validateSavedEvidencePack(input);
      const value = await request("/rpc/save_evidence_pack_build", {
        method: "POST",
        body: JSON.stringify({ p_payload: validated }),
      }) as Record<string, unknown>;
      return savedPack(value);
    },
  };
}

let singleton: EvidencePacksRepository | undefined;

export function getEvidencePacksRepository(): EvidencePacksRepository {
  if (singleton) return singleton;
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  singleton = url && serviceRoleKey
    ? createSupabaseEvidencePacksRepository({ url, serviceRoleKey })
    : createMemoryEvidencePacksRepository();
  return singleton;
}

function validateSourceEvidenceInput(
  input: SourceEvidenceInput,
): SourceEvidenceInput {
  const candidate = structuredClone(input);
  for (const [label, value] of [
    ["An evidence id", candidate.id],
    ["A workspace", candidate.workspaceId],
    ["A Deal", candidate.dealId],
    ["A source", candidate.sourceId],
    ["A source revision", candidate.sourceRevisionId],
    ["An evidence field", candidate.field],
    ["An evidence value", candidate.value],
  ] as const) {
    requiredText(value, label);
  }
  if (candidate.sourceRef !== undefined) {
    const sourceRef = WritableSourceRefV2Schema.parse(candidate.sourceRef);
    if (
      sourceRef.id !== candidate.id
      || sourceRef.provenance !== "public_web"
      || sourceRef.documentId !== candidate.sourceId
      || sourceRef.sourceRevisionId !== candidate.sourceRevisionId
      || sourceTextForRetrieval(sourceRef) !== candidate.value
    ) {
      throw new Error(
        "Canonical public source evidence must preserve exact identity and reviewed text.",
      );
    }
    candidate.sourceRef = sourceRef;
  }
  if (candidate.semanticFields !== undefined) {
    candidate.semanticFields = DealFactSchema.shape.semanticFields.unwrap()
      .parse(candidate.semanticFields);
  }
  return candidate;
}

function validateSavedEvidencePack(
  input: SavedEvidencePack,
): SavedEvidencePack {
  const pack = EvidencePackSchema.parse(input.pack);
  const inputFingerprint = requiredFingerprint(input.inputFingerprint);
  const sourceRevisionSnapshots = input.sourceRevisionSnapshots.map(
    (revision) => {
      const parsed = SourceRevisionSchema.parse(revision);
      return SourceRevisionSchema.parse({
        ...parsed,
        extractedAt: new Date(parsed.extractedAt).toISOString(),
        createdAt: new Date(parsed.createdAt).toISOString(),
      });
    },
  );
  const revisionIds = sourceRevisionSnapshots.map(({ id }) => id);
  if (
    new Set(revisionIds).size !== revisionIds.length
    || pack.sourceRevisionIds.length !== revisionIds.length
    || pack.sourceRevisionIds.some((id) => !revisionIds.includes(id))
    || sourceRevisionSnapshots.some(
      ({ workspaceId }) => workspaceId !== pack.workspaceId,
    )
  ) {
    throw new Error(
      "Saved Evidence Pack source snapshots must exactly match its revisions and workspace.",
    );
  }
  return structuredClone({
    pack,
    inputFingerprint,
    sourceRevisionSnapshots,
  });
}

function requiredText(value: string, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function requiredFingerprint(value: string): string {
  const normalized = requiredText(value, "An input fingerprint");
  if (!/^sha256:[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("An Evidence Pack requires a canonical SHA-256 fingerprint.");
  }
  return normalized;
}

function identity(workspaceId: string, id: string): string {
  return JSON.stringify([workspaceId, id]);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function encodePostgrestValue(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortObject(value));
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareUtf8(left, right))
        .map(([key, item]) => [key, sortObject(item)]),
    );
  }
  return value;
}
