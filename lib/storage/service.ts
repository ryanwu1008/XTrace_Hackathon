import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  IntegrationTransportError,
  isRetryableTransportStatus,
} from "../api/errors";
import type { DemoDealEvidence } from "../corpus/evidence";
import type { DemoFixture } from "../corpus/fixtures";
import {
  getPreloadedDeal,
  listPreloadedDocuments,
  type PreloadedDocument,
} from "../corpus/manifest";
import type { CorpusPersistence } from "../corpus/service";

export interface UpsertResult<T> {
  value: T;
  created: boolean;
}

export interface DemoWorkspaceRecord {
  id: string;
  name: string;
}

export interface DemoUserRecord {
  id: string;
  email: string;
  displayName: string;
}

export interface DemoMembershipRecord {
  workspaceId: string;
  userId: string;
  role: "owner";
}

export interface StoredCorpusDocument extends PreloadedDocument {
  objectKey: string;
}

export type SourceDocumentRole = PreloadedDocument["role"]
  | "public_web_snapshot"
  | "sample_decision_record";

export interface ImmutableSourceDocumentRecord {
  id: string;
  filename: string;
  title: string;
  role: SourceDocumentRole;
  companyName: string | null;
  dealId: string | null;
  checksum: string;
  byteSize: number;
  objectKey: string;
}

export interface WorkspaceDocumentRecord {
  workspaceId: string;
  documentId: string;
}

export interface DemoCompanyRecord {
  id: string;
  workspaceId: string;
  name: string;
}

export interface DemoDealRecord {
  id: string;
  workspaceId: string;
  companyId: string;
  companyName: string;
}

export interface ImmutableBeliefReversalDealRecord extends DemoDealRecord {
  status: "passed" | "watchlist" | "invested";
}

export interface StoredEvidenceRecord extends DemoDealEvidence {
  workspaceId: string;
  sourceRevisionId?: string;
}

export interface StoredFixtureRecord extends DemoFixture {
  workspaceId: string;
  sourceRevisionId?: string;
  priorActions?: string[];
  actionPolicyVersion?: string;
  interactionSchemaVersion?: string;
}

export interface SampleDecisionInteractionRecord
  extends Omit<StoredFixtureRecord, "sourceRevisionId"> {
  sourceRevisionId: string;
  priorActions: string[];
  actionPolicyVersion: string;
  interactionSchemaVersion: string;
}

export interface BeliefReversalSeedDataStore {
  ensureWorkspaceDocument(
    input: WorkspaceDocumentRecord,
  ): Promise<UpsertResult<WorkspaceDocumentRecord>>;
  ensureImmutableSourceDocument(
    input: ImmutableSourceDocumentRecord,
  ): Promise<UpsertResult<ImmutableSourceDocumentRecord>>;
  ensureImmutableCompany(
    input: DemoCompanyRecord,
  ): Promise<UpsertResult<DemoCompanyRecord>>;
  ensureImmutableDeal(
    input: ImmutableBeliefReversalDealRecord,
  ): Promise<UpsertResult<ImmutableBeliefReversalDealRecord>>;
  ensureSampleDecisionInteraction(
    input: SampleDecisionInteractionRecord,
  ): Promise<UpsertResult<SampleDecisionInteractionRecord>>;
}

export interface DemoDataStore {
  ensureWorkspace(input: DemoWorkspaceRecord): Promise<UpsertResult<DemoWorkspaceRecord>>;
  ensureUser(input: DemoUserRecord): Promise<UpsertResult<DemoUserRecord>>;
  ensureMembership(input: DemoMembershipRecord): Promise<UpsertResult<DemoMembershipRecord>>;
  ensureDocument(input: StoredCorpusDocument): Promise<UpsertResult<StoredCorpusDocument>>;
  ensureWorkspaceDocument(input: WorkspaceDocumentRecord): Promise<UpsertResult<WorkspaceDocumentRecord>>;
  listWorkspaceDocumentIds(workspaceId: string): Promise<string[]>;
  ensureCompany(input: DemoCompanyRecord): Promise<UpsertResult<DemoCompanyRecord>>;
  ensureDeal(input: DemoDealRecord): Promise<UpsertResult<DemoDealRecord>>;
  ensureEvidence(input: StoredEvidenceRecord): Promise<UpsertResult<StoredEvidenceRecord>>;
  ensureFixture(input: StoredFixtureRecord): Promise<UpsertResult<StoredFixtureRecord>>;
  resetDemoData(
    workspaceId: string,
    options?: { includeHistory?: boolean },
  ): Promise<void>;
}

export interface DemoDataSnapshot {
  workspaces: DemoWorkspaceRecord[];
  users: DemoUserRecord[];
  memberships: DemoMembershipRecord[];
  documents: ImmutableSourceDocumentRecord[];
  workspaceDocuments: WorkspaceDocumentRecord[];
  companies: DemoCompanyRecord[];
  deals: DemoDealRecord[];
  evidence: StoredEvidenceRecord[];
  fixtures: StoredFixtureRecord[];
}

export interface MemoryDemoDataStore
  extends DemoDataStore, BeliefReversalSeedDataStore {
  inspect(): DemoDataSnapshot;
}

export interface PrivateObjectInput {
  key: string;
  bytes: Uint8Array;
  contentType: string;
}

export interface PrivateObjectStorage {
  ensurePrivateObject(input: PrivateObjectInput): Promise<UpsertResult<{ key: string }>>;
  readPrivateObject(key: string): Promise<Uint8Array | null>;
}

export interface MemoryPrivateObjectStorage extends PrivateObjectStorage {
  inspect(): Array<{ key: string; byteSize: number; contentType: string }>;
}

export interface PrivateSourceCapability {
  workspaceId: string;
  sourceRevisionId: string;
  objectVersion: string;
  expiresAtEpochSeconds: number;
  permission: "read";
}

export interface PrivateDocumentAccess {
  createPrivateReadUrl(input: {
    capability: PrivateSourceCapability;
    expiresInSeconds: number;
  }): Promise<string>;
  authorizePrivateRead(request: Request): Promise<PrivateSourceCapability>;
}

const MAX_PRIVATE_READ_TTL_SECONDS = 10 * 60;
const DEFAULT_STORAGE_BUCKET = "vsee-demo-sources";
const DEFAULT_ROUTE_PREFIX = "/api/documents";
const DEVELOPMENT_SIGNING_SECRET = "xtrace-development-document-read-secret";

export function createMemoryDemoDataStore(): MemoryDemoDataStore {
  const workspaces = new Map<string, DemoWorkspaceRecord>();
  const users = new Map<string, DemoUserRecord>();
  const memberships = new Map<string, DemoMembershipRecord>();
  const documents = new Map<string, ImmutableSourceDocumentRecord>();
  const workspaceDocuments = new Map<string, WorkspaceDocumentRecord>();
  const companies = new Map<string, DemoCompanyRecord>();
  const deals = new Map<string, DemoDealRecord>();
  const evidence = new Map<string, StoredEvidenceRecord>();
  const fixtures = new Map<string, StoredFixtureRecord>();

  return {
    ensureWorkspace: (input) => ensureMemory(workspaces, input.id, input),
    ensureUser: (input) => ensureMemory(users, input.id, input),
    ensureMembership: (input) => ensureMemory(
      memberships,
      workspaceExternalId(input.workspaceId, input.userId),
      input,
    ),
    ensureDocument: async (input) => {
      const existing = documents.get(input.checksum);
      if (existing && existing.id !== input.id) {
        throw new Error(`Corpus checksum ${input.checksum} is already assigned to ${existing.id}.`);
      }
      const stored: ImmutableSourceDocumentRecord = {
        id: input.id,
        filename: input.filename,
        title: input.title,
        role: input.role,
        companyName: input.company ?? null,
        dealId: input.dealId ?? null,
        checksum: input.checksum,
        byteSize: input.byteSize,
        objectKey: input.objectKey,
      };
      const result = await ensureMemory(documents, input.checksum, stored);
      return { value: structuredClone(input), created: result.created };
    },
    ensureImmutableSourceDocument: async (input) => {
      const existingChecksum = documents.get(input.checksum);
      if (existingChecksum && existingChecksum.id !== input.id) {
        throw new Error(
          `Source checksum ${input.checksum} is already assigned to ${existingChecksum.id}.`,
        );
      }
      const existing = [...documents.values()].find((document) =>
        document.id === input.id
      );
      if (existing && canonicalJson(existing) !== canonicalJson(input)) {
        throw new Error(
          `Source document ${input.id} is immutable and already differs.`,
        );
      }
      return ensureImmutableMemory(documents, input.checksum, input);
    },
    ensureWorkspaceDocument: (input) => ensureMemory(
      workspaceDocuments,
      workspaceExternalId(input.workspaceId, input.documentId),
      input,
    ),
    async listWorkspaceDocumentIds(workspaceId) {
      return [...workspaceDocuments.values()]
        .filter((record) => record.workspaceId === workspaceId)
        .map((record) => record.documentId)
        .sort();
    },
    ensureCompany: (input) => ensureMemory(
      companies,
      workspaceExternalId(input.workspaceId, input.id),
      input,
    ),
    ensureImmutableCompany: (input) => ensureImmutableMemory(
      companies,
      workspaceExternalId(input.workspaceId, input.id),
      input,
    ),
    ensureDeal: (input) => ensureMemory(
      deals,
      workspaceExternalId(input.workspaceId, input.id),
      input,
    ),
    async ensureImmutableDeal(input) {
      const result = await ensureImmutableMemory(
        deals,
        workspaceExternalId(input.workspaceId, input.id),
        input,
      );
      return {
        value: structuredClone(input),
        created: result.created,
      };
    },
    ensureEvidence: (input) => ensureMemory(
      evidence,
      workspaceExternalId(input.workspaceId, input.id),
      input,
    ),
    ensureFixture: (input) => ensureMemory(
      fixtures,
      workspaceExternalId(input.workspaceId, input.id),
      input,
    ),
    async ensureSampleDecisionInteraction(input) {
      const result = await ensureImmutableMemory(
        fixtures,
        workspaceExternalId(input.workspaceId, input.id),
        input,
      );
      return {
        value: structuredClone(input),
        created: result.created,
      };
    },
    async resetDemoData(workspaceId) {
      const target = requiredWorkspaceId(workspaceId);
      deleteWorkspaceRows(memberships, target);
      deleteWorkspaceRows(workspaceDocuments, target);
      deleteWorkspaceRows(companies, target);
      deleteWorkspaceRows(deals, target);
      deleteWorkspaceRows(evidence, target);
      deleteWorkspaceRows(fixtures, target);
    },
    inspect() {
      return {
        workspaces: cloneValues(workspaces),
        users: cloneValues(users),
        memberships: cloneValues(memberships),
        documents: cloneValues(documents),
        workspaceDocuments: cloneValues(workspaceDocuments),
        companies: cloneValues(companies),
        deals: cloneValues(deals),
        evidence: cloneValues(evidence),
        fixtures: cloneValues(fixtures),
      };
    },
  };
}

export function createMemoryPrivateObjectStorage(): MemoryPrivateObjectStorage {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  return {
    async ensurePrivateObject(input) {
      const existing = objects.get(input.key);
      if (existing) {
        if (!equalBytes(existing.bytes, input.bytes)) {
          throw new Error(`Private object ${input.key} already exists with different bytes.`);
        }
        return { value: { key: input.key }, created: false };
      }
      objects.set(input.key, {
        bytes: new Uint8Array(input.bytes),
        contentType: input.contentType,
      });
      return { value: { key: input.key }, created: true };
    },
    async readPrivateObject(key) {
      const object = objects.get(key);
      return object ? new Uint8Array(object.bytes) : null;
    },
    inspect() {
      return [...objects.entries()]
        .map(([key, object]) => ({
          key,
          byteSize: object.bytes.byteLength,
          contentType: object.contentType,
        }))
        .sort((left, right) => left.key.localeCompare(right.key));
    },
  };
}

export function createBundledPrivateObjectStorage(options: {
  corpusDirectory?: string;
} = {}): PrivateObjectStorage {
  const corpusDirectory = options.corpusDirectory ?? path.join(process.cwd(), "seed", "corpus");

  return {
    async ensurePrivateObject(input) {
      const document = documentForObjectKey(input.key);
      if (!document) throw new Error(`Unknown private corpus object: ${input.key}`);
      const bytes = new Uint8Array(await readFile(path.join(corpusDirectory, document.filename)));
      if (!equalBytes(bytes, input.bytes)) {
        throw new Error(`Bundled corpus object ${document.filename} does not match its seed bytes.`);
      }
      return { value: { key: input.key }, created: false };
    },
    async readPrivateObject(key) {
      const document = documentForObjectKey(key);
      if (!document) return null;
      try {
        return new Uint8Array(await readFile(path.join(corpusDirectory, document.filename)));
      } catch {
        return null;
      }
    },
  };
}

export function createPrivateDocumentAccess(options: {
  signingSecret: string;
  now?: () => number;
  routePrefix?: string;
}): PrivateDocumentAccess {
  if (options.signingSecret.length < 32) {
    throw new Error("Document URL signing secret must be at least 32 characters.");
  }
  const now = options.now ?? Date.now;
  const routePrefix = normalizeRoutePrefix(options.routePrefix ?? DEFAULT_ROUTE_PREFIX);
  const key = globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(options.signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

  return {
    async createPrivateReadUrl({ capability, expiresInSeconds }) {
      assertPrivateSourceCapability(capability);
      if (
        !Number.isInteger(expiresInSeconds)
        || expiresInSeconds < 1
        || expiresInSeconds > MAX_PRIVATE_READ_TTL_SECONDS
      ) {
        throw new Error(`Private document URLs may expire in at most ${MAX_PRIVATE_READ_TTL_SECONDS} seconds.`);
      }
      const currentSeconds = Math.floor(now() / 1_000);
      if (
        capability.expiresAtEpochSeconds <= currentSeconds
        || capability.expiresAtEpochSeconds > currentSeconds + expiresInSeconds
      ) {
        throw new Error("Private source capability expiry is outside the requested lifetime.");
      }
      const encodedCapability = encodePrivateSourceCapability(capability);
      const signature = await signReadCapability(key, encodedCapability);
      const query = new URLSearchParams({
        capability: encodedCapability,
        signature,
      });
      return `${routePrefix}/${encodeURIComponent(capability.sourceRevisionId)}?${query}`;
    },
    async authorizePrivateRead(request) {
      const url = new URL(request.url);
      const prefix = `${routePrefix}/`;
      if (!url.pathname.startsWith(prefix)) {
        throw new Error("Invalid private document route.");
      }
      const encodedDocumentId = url.pathname.slice(prefix.length);
      if (!encodedDocumentId || encodedDocumentId.includes("/")) {
        throw new Error("Invalid private document id.");
      }
      const documentId = decodeURIComponent(encodedDocumentId);
      const encodedCapability = url.searchParams.get("capability");
      const signature = url.searchParams.get("signature");
      if (!encodedCapability || !signature) {
        throw new Error("Private document read capability is missing.");
      }
      const valid = await verifyReadCapability(key, encodedCapability, signature);
      if (!valid) {
        throw new Error("Private document read capability is invalid.");
      }
      const capability = decodePrivateSourceCapability(encodedCapability);
      if (capability.sourceRevisionId !== documentId) {
        throw new Error("Private document read capability is invalid.");
      }
      const currentSeconds = Math.floor(now() / 1_000);
      if (capability.expiresAtEpochSeconds <= currentSeconds) {
        throw new Error("Private document read capability has expired.");
      }
      if (
        capability.expiresAtEpochSeconds
          > currentSeconds + MAX_PRIVATE_READ_TTL_SECONDS
      ) {
        throw new Error("Private document read capability exceeds 600 seconds.");
      }
      return capability;
    },
  };
}

export function createSupabasePrivateObjectStorage(options: {
  url: string;
  serviceRoleKey: string;
  bucket?: string;
  fetchImpl?: typeof fetch;
}): PrivateObjectStorage {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = `${options.url.replace(/\/$/, "")}/storage/v1/object`;
  const bucket = options.bucket ?? DEFAULT_STORAGE_BUCKET;
  const headers = {
    apikey: options.serviceRoleKey,
    authorization: `Bearer ${options.serviceRoleKey}`,
  };

  return {
    async ensurePrivateObject(input) {
      const objectUrl = `${base}/${encodeObjectPath(`${bucket}/${input.key}`)}`;
      const existing = await storageFetch(fetchImpl, objectUrl, {
        headers,
        cache: "no-store",
      });
      if (existing.ok) {
        const existingBytes = new Uint8Array(await existing.arrayBuffer());
        if (!equalBytes(existingBytes, input.bytes)) {
          throw new Error(
            `Private object ${input.key} already exists with different bytes.`,
          );
        }
        return { value: { key: input.key }, created: false };
      }
      if (!(await isStorageObjectMissing(existing))) {
        throw await storageHttpError("check", existing);
      }
      const response = await storageFetch(fetchImpl, objectUrl, {
        method: "POST",
        headers: {
          ...headers,
          "content-type": input.contentType,
          "x-upsert": "false",
        },
        body: toArrayBuffer(input.bytes),
        cache: "no-store",
      });
      if (!response.ok) throw await storageHttpError("upload", response);
      return { value: { key: input.key }, created: true };
    },
    async readPrivateObject(key) {
      const response = await storageFetch(fetchImpl, `${base}/${encodeObjectPath(`${bucket}/${key}`)}`, {
        headers,
        cache: "no-store",
      });
      if (await isStorageObjectMissing(response)) return null;
      if (!response.ok) throw await storageHttpError("read", response);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

export function createSupabaseDemoDataStore(options: {
  url: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}): DemoDataStore & BeliefReversalSeedDataStore {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = `${options.url.replace(/\/$/, "")}/rest/v1`;
  const headers = {
    apikey: options.serviceRoleKey,
    authorization: `Bearer ${options.serviceRoleKey}`,
    "content-type": "application/json",
  };

  async function request(pathname: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${pathname}`, {
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
    return body ? JSON.parse(body) : null;
  }

  async function upsert<T>(
    table: string,
    conflictColumns: string[],
    match: Record<string, string>,
    row: Record<string, unknown>,
    value: T,
  ): Promise<UpsertResult<T>> {
    const lookup = new URLSearchParams({ select: conflictColumns.join(","), limit: "1" });
    for (const [column, columnValue] of Object.entries(match)) {
      lookup.set(column, `eq.${columnValue}`);
    }
    const existing = await request(`/${table}?${lookup}`) as unknown[];
    const query = new URLSearchParams({ on_conflict: conflictColumns.join(",") });
    await request(`/${table}?${query}`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(row),
    });
    return { value: structuredClone(value), created: existing.length === 0 };
  }

  async function insertImmutable<T>(
    table: string,
    conflictColumns: string[],
    match: Record<string, string>,
    row: Record<string, unknown>,
    value: T,
  ): Promise<UpsertResult<T>> {
    const lookup = new URLSearchParams({
      select: conflictColumns.join(","),
      limit: "1",
    });
    for (const [column, columnValue] of Object.entries(match)) {
      lookup.set(column, `eq.${columnValue}`);
    }
    const existing = await request(`/${table}?${lookup}`) as unknown[];
    const query = new URLSearchParams({
      on_conflict: conflictColumns.join(","),
    });
    await request(`/${table}?${query}`, {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(row),
    });
    return { value: structuredClone(value), created: existing.length === 0 };
  }

  async function insertExactImmutable<T>(
    table: string,
    conflictColumns: string[],
    match: Record<string, string>,
    row: Record<string, unknown>,
    value: T,
  ): Promise<UpsertResult<T>> {
    const lookup = new URLSearchParams({
      select: Object.keys(row).join(","),
      limit: "1",
    });
    for (const [column, columnValue] of Object.entries(match)) {
      lookup.set(column, `eq.${columnValue}`);
    }
    const existing = await request(`/${table}?${lookup}`) as Array<
      Record<string, unknown>
    >;
    if (existing[0]) {
      const observed = Object.fromEntries(
        Object.keys(row).map((key) => [key, existing[0]![key]]),
      );
      if (canonicalJson(observed) !== canonicalJson(row)) {
        throw new Error(
          `Immutable ${table} identity already contains different data.`,
        );
      }
      return { value: structuredClone(value), created: false };
    }
    const query = new URLSearchParams({
      on_conflict: conflictColumns.join(","),
    });
    await request(`/${table}?${query}`, {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(row),
    });
    return { value: structuredClone(value), created: true };
  }

  return {
    ensureWorkspace: (input) => upsert(
      "workspaces",
      ["id"],
      { id: input.id },
      { id: input.id, name: input.name },
      input,
    ),
    ensureUser: (input) => upsert(
      "users",
      ["id"],
      { id: input.id },
      { id: input.id, email: input.email, display_name: input.displayName },
      input,
    ),
    ensureMembership: (input) => upsert(
      "workspace_members",
      ["workspace_id", "user_id"],
      { workspace_id: input.workspaceId, user_id: input.userId },
      { workspace_id: input.workspaceId, user_id: input.userId, role: input.role },
      input,
    ),
    ensureDocument: (input) => insertImmutable(
      "source_documents",
      ["id"],
      { id: input.id },
      toDocumentRow(input),
      input,
    ),
    ensureImmutableSourceDocument: (input) => insertExactImmutable(
      "source_documents",
      ["id"],
      { id: input.id },
      toImmutableSourceDocumentRow(input),
      input,
    ),
    ensureWorkspaceDocument: (input) => insertImmutable(
      "workspace_documents",
      ["workspace_id", "document_id"],
      { workspace_id: input.workspaceId, document_id: input.documentId },
      { workspace_id: input.workspaceId, document_id: input.documentId },
      input,
    ),
    async listWorkspaceDocumentIds(workspaceId) {
      const query = new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        select: "document_id",
      });
      const rows = await request(`/workspace_documents?${query}`) as Array<{
        document_id: string;
      }>;
      return rows.map((row) => String(row.document_id)).sort();
    },
    ensureCompany: (input) => upsert(
      "companies",
      ["workspace_id", "id"],
      { workspace_id: input.workspaceId, id: input.id },
      { id: input.id, workspace_id: input.workspaceId, name: input.name },
      input,
    ),
    ensureImmutableCompany: (input) => insertExactImmutable(
      "companies",
      ["workspace_id", "id"],
      { workspace_id: input.workspaceId, id: input.id },
      { id: input.id, workspace_id: input.workspaceId, name: input.name },
      input,
    ),
    ensureDeal: (input) => upsert(
      "deals",
      ["workspace_id", "id"],
      { workspace_id: input.workspaceId, id: input.id },
      {
        id: input.id,
        workspace_id: input.workspaceId,
        company_id: input.companyId,
        company_name: input.companyName,
      },
      input,
    ),
    ensureImmutableDeal: (input) => insertExactImmutable(
      "deals",
      ["workspace_id", "id"],
      { workspace_id: input.workspaceId, id: input.id },
      {
        id: input.id,
        workspace_id: input.workspaceId,
        company_id: input.companyId,
        company_name: input.companyName,
        status: input.status,
      },
      input,
    ),
    ensureEvidence: (input) => insertImmutable(
      "source_evidence",
      ["workspace_id", "id"],
      { workspace_id: input.workspaceId, id: input.id },
      {
        id: input.id,
        workspace_id: input.workspaceId,
        document_id: input.documentId,
        source_revision_id: input.sourceRevisionId,
        deal_id: input.dealId,
        company_name: input.companyName,
        provenance: input.provenance,
        page: input.page,
        fact: input.fact,
        excerpt: input.excerpt,
      },
      input,
    ),
    ensureFixture: (input) => upsert(
      "deal_interactions",
      ["workspace_id", "id"],
      { workspace_id: input.workspaceId, id: input.id },
      {
        id: input.id,
        workspace_id: input.workspaceId,
        document_id: input.documentId,
        source_revision_id: input.sourceRevisionId,
        deal_id: input.dealId,
        company_name: input.companyName,
        occurred_at: input.occurredAt,
        provenance: input.provenance,
        label: input.label,
        status: input.status,
        decision_reason: input.decisionReason,
        concerns: input.concerns,
        revisit_conditions: input.revisitConditions,
        meeting_summary: input.meetingSummary,
      },
      input,
    ),
    async ensureSampleDecisionInteraction(input) {
      const response = await request(
        "/rpc/save_sample_decision_interaction",
        {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ p_interaction: input }),
        },
      ) as Record<string, unknown>;
      return {
        value: structuredClone(input),
        created: response.created === true,
      };
    },
    async resetDemoData(workspaceId, resetOptions = {}) {
      const target = requiredWorkspaceId(workspaceId);
      const workspaceFilter = `eq.${target}`;
      const deletions: Array<[table: string, column: string, filter: string]> = [
        ["xtrace_memory_links", "workspace_id", workspaceFilter],
        ["xtrace_ingest_jobs", "workspace_id", workspaceFilter],
        ["market_events", "workspace_id", workspaceFilter],
        ["deal_interactions", "workspace_id", workspaceFilter],
        ["source_evidence", "workspace_id", workspaceFilter],
        ["workspace_documents", "workspace_id", workspaceFilter],
        ["deals", "workspace_id", workspaceFilter],
        ["companies", "workspace_id", workspaceFilter],
        ["workspace_members", "workspace_id", workspaceFilter],
      ];
      if (resetOptions.includeHistory) {
        deletions.unshift(
          ["company_analyses", "workspace_id", workspaceFilter],
          ["intelligence_reports", "workspace_id", workspaceFilter],
          ["scan_runs", "workspace_id", workspaceFilter],
        );
      }
      for (const [table, column, filter] of deletions) {
        const query = new URLSearchParams({ [column]: filter });
        await request(`/${table}?${query}`, { method: "DELETE" });
      }
    },
  };
}

export function createCorpusPersistence(
  dataStore: DemoDataStore,
  documentAccess: PrivateDocumentAccess,
): CorpusPersistence {
  return {
    async ensureWorkspaceDocument(input) {
      await dataStore.ensureWorkspaceDocument(input);
      return { documentId: input.documentId };
    },
    async ensureDeal(input) {
      if (!getPreloadedDeal(input.dealId)) {
        throw new Error(`Unknown preloaded Deal: ${input.dealId}`);
      }
      const companyId = companyIdForDeal(input.dealId);
      await dataStore.ensureCompany({
        id: companyId,
        workspaceId: input.workspaceId,
        name: input.companyName,
      });
      await dataStore.ensureDeal({
        id: input.dealId,
        workspaceId: input.workspaceId,
        companyId,
        companyName: input.companyName,
      });
      return { dealId: input.dealId };
    },
    async ensureFixture({ workspaceId, fixture }) {
      await dataStore.ensureFixture({ workspaceId, ...fixture });
      return { fixtureId: fixture.id };
    },
    createPrivateReadUrl: (input) => documentAccess.createPrivateReadUrl(input),
  };
}

export function createDefaultPrivateDocumentAccess(): PrivateDocumentAccess {
  const configuredSecret = process.env.DOCUMENT_URL_SIGNING_SECRET;
  if (!configuredSecret && process.env.NODE_ENV === "production") {
    throw new Error("DOCUMENT_URL_SIGNING_SECRET is required in production.");
  }
  return createPrivateDocumentAccess({
    signingSecret: configuredSecret ?? DEVELOPMENT_SIGNING_SECRET,
  });
}

export function createDefaultPrivateObjectStorage(): PrivateObjectStorage {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if ((!url || !serviceRoleKey) && process.env.NODE_ENV === "production") {
    throw new Error("Supabase private object storage is required in production.");
  }
  return url && serviceRoleKey
    ? createSupabasePrivateObjectStorage({
      url,
      serviceRoleKey,
      bucket: process.env.SUPABASE_STORAGE_BUCKET,
    })
    : createBundledPrivateObjectStorage();
}

export function createDefaultDemoDataStore():
  DemoDataStore & BeliefReversalSeedDataStore {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && serviceRoleKey) {
    return createSupabaseDemoDataStore({ url, serviceRoleKey });
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Supabase PostgreSQL is required in production.");
  }
  return defaultMemoryDemoDataStore;
}

export function privateObjectKey(document: PreloadedDocument): string {
  return `private/demo-corpus/${document.checksum}/${document.filename}`;
}

export function companyIdForDocument(document: PreloadedDocument): string {
  if (document.role !== "deal_document") {
    throw new Error(`Document ${document.id} is not a Deal document.`);
  }
  if (!document.dealId) {
    throw new Error(`Document ${document.id} contains multiple Deals; provide a Deal id.`);
  }
  return companyIdForDeal(document.dealId);
}

export function companyIdForDeal(dealId: string): string {
  return `company_${dealId.replace(/^deal_/, "")}`;
}

async function ensureMemory<T>(
  target: Map<string, T>,
  key: string,
  input: T,
): Promise<UpsertResult<T>> {
  const created = !target.has(key);
  target.set(key, structuredClone(input));
  return { value: structuredClone(input), created };
}

async function ensureImmutableMemory<T>(
  target: Map<string, T>,
  key: string,
  input: T,
): Promise<UpsertResult<T>> {
  const existing = target.get(key);
  if (existing !== undefined) {
    if (canonicalJson(existing) !== canonicalJson(input)) {
      throw new Error("An immutable seed identity already contains different data.");
    }
    return { value: structuredClone(existing), created: false };
  }
  target.set(key, structuredClone(input));
  return { value: structuredClone(input), created: true };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function workspaceExternalId(workspaceId: string, externalId: string): string {
  return JSON.stringify([requiredWorkspaceId(workspaceId), externalId]);
}

function requiredWorkspaceId(workspaceId: string): string {
  const normalized = workspaceId?.trim();
  if (!normalized) throw new Error("A workspace is required.");
  return normalized;
}

function deleteWorkspaceRows<T extends { workspaceId: string }>(
  rows: Map<string, T>,
  workspaceId: string,
): void {
  for (const [key, row] of rows) {
    if (row.workspaceId === workspaceId) rows.delete(key);
  }
}

function cloneValues<T>(values: Map<string, T>): T[] {
  return [...values.values()].map((value) => structuredClone(value));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

const defaultMemoryDemoDataStore = createMemoryDemoDataStore();

function documentForObjectKey(key: string): PreloadedDocument | undefined {
  return listPreloadedDocuments().find((document) => privateObjectKey(document) === key);
}

function normalizeRoutePrefix(value: string): string {
  const normalized = value.startsWith("/") ? value : `/${value}`;
  return normalized.replace(/\/+$/, "");
}

async function signReadCapability(
  key: Promise<CryptoKey>,
  encodedCapability: string,
): Promise<string> {
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    await key,
    new TextEncoder().encode(encodedCapability),
  );
  return toBase64Url(new Uint8Array(signature));
}

async function verifyReadCapability(
  key: Promise<CryptoKey>,
  encodedCapability: string,
  signature: string,
): Promise<boolean> {
  let decoded: Uint8Array;
  try {
    decoded = fromBase64Url(signature);
  } catch {
    return false;
  }
  return globalThis.crypto.subtle.verify(
    "HMAC",
    await key,
    toArrayBuffer(decoded),
    new TextEncoder().encode(encodedCapability),
  );
}

function encodePrivateSourceCapability(
  capability: PrivateSourceCapability,
): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(capability)));
}

function decodePrivateSourceCapability(
  encoded: string,
): PrivateSourceCapability {
  let candidate: unknown;
  try {
    candidate = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded)));
  } catch {
    throw new Error("Private document read capability is invalid.");
  }
  assertPrivateSourceCapability(candidate);
  return candidate;
}

function assertPrivateSourceCapability(
  candidate: unknown,
): asserts candidate is PrivateSourceCapability {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("Private document read capability is invalid.");
  }
  const value = candidate as Record<string, unknown>;
  if (
    Object.keys(value).sort().join(",")
      !== "expiresAtEpochSeconds,objectVersion,permission,sourceRevisionId,workspaceId"
    || typeof value.workspaceId !== "string"
    || !value.workspaceId.trim()
    || typeof value.sourceRevisionId !== "string"
    || !value.sourceRevisionId.trim()
    || typeof value.objectVersion !== "string"
    || !value.objectVersion.trim()
    || !Number.isInteger(value.expiresAtEpochSeconds)
    || value.permission !== "read"
  ) {
    throw new Error("Private document read capability is invalid.");
  }
}

function toBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid base64url value.");
  }
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(`${normalized}${padding}`);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeObjectPath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

async function isStorageObjectMissing(response: Response): Promise<boolean> {
  if (response.status === 404) return true;
  if (response.status !== 400) return false;
  try {
    const body = await response.clone().json() as Record<string, unknown>;
    return Number(body.statusCode) === 404 && body.error === "not_found";
  } catch {
    return false;
  }
}

async function storageFetch(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetchImpl(input, init);
  } catch {
    throw new IntegrationTransportError({ retryable: true });
  }
}

async function storageHttpError(_operation: string, response: Response): Promise<IntegrationTransportError> {
  return new IntegrationTransportError({
    retryable: isRetryableTransportStatus(response.status),
  });
}

function toDocumentRow(input: StoredCorpusDocument): Record<string, unknown> {
  return {
    id: input.id,
    filename: input.filename,
    title: input.title,
    role: input.role,
    company_name: input.company,
    deal_id: input.dealId,
    checksum: input.checksum,
    byte_size: input.byteSize,
    object_key: input.objectKey,
  };
}

function toImmutableSourceDocumentRow(
  input: ImmutableSourceDocumentRecord,
): Record<string, unknown> {
  return {
    id: input.id,
    filename: input.filename,
    title: input.title,
    role: input.role,
    company_name: input.companyName,
    deal_id: input.dealId,
    checksum: input.checksum,
    byte_size: input.byteSize,
    object_key: input.objectKey,
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
