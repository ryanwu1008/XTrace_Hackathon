import { createHash } from "node:crypto";
import { z } from "zod";

import {
  IntegrationTransportError,
  isRetryableTransportStatus,
} from "../../lib/api/errors";
import { canonicalEvidenceJson } from "../../lib/contracts/source-evidence";

const SemanticFingerprintSchema = z.string().regex(
  /^reasoner-judgment-v3:sha256:[0-9a-f]{64}$/u,
);
const Sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);

export const ReasonerJudgmentWriteSchema = z.strictObject({
  fingerprint: SemanticFingerprintSchema,
  model: z.string().trim().min(1),
  payload: z.unknown(),
  evidenceContextFingerprint: Sha256Schema.nullable().optional().default(null),
  evidenceBindingFingerprint: Sha256Schema.nullable().optional().default(null),
}).superRefine((value, context) => {
  if ((value.evidenceContextFingerprint === null) !== (value.evidenceBindingFingerprint === null)) {
    context.addIssue({ code: "custom", message: "Reasoner evidence binding must be all-null or complete." });
  }
});
export type ReasonerJudgmentWrite = z.input<typeof ReasonerJudgmentWriteSchema>;

export type ReasonerJudgmentRecord = {
  state: "legacy_unbound";
  fingerprint: string;
  model: string;
  payload: unknown;
  evidenceContextFingerprint: null;
  evidenceBindingFingerprint: null;
  judgmentRecordFingerprint: null;
} | {
  state: "current";
  judgmentSchemaVersion: "reasoner-judgment-record-v1";
  fingerprint: string;
  model: string;
  payload: unknown;
  evidenceContextFingerprint: string | null;
  evidenceBindingFingerprint: string | null;
  judgmentRecordFingerprint: string;
};

export interface ReasonerJudgmentsRepository {
  find(fingerprint: string): Promise<ReasonerJudgmentRecord | null>;
  save(record: ReasonerJudgmentWrite): Promise<ReasonerJudgmentRecord>;
}

function lengthFramedFingerprint(values: readonly string[]): string {
  const hash = createHash("sha256");
  for (const value of values) {
    const bytes = Buffer.from(value, "utf8");
    hash.update(`${bytes.length}:`);
    hash.update(bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}

function makeCurrentRecord(input: z.output<typeof ReasonerJudgmentWriteSchema>): ReasonerJudgmentRecord {
  return {
    state: "current",
    judgmentSchemaVersion: "reasoner-judgment-record-v1",
    fingerprint: input.fingerprint,
    model: input.model,
    payload: structuredClone(input.payload),
    evidenceContextFingerprint: input.evidenceContextFingerprint,
    evidenceBindingFingerprint: input.evidenceBindingFingerprint,
    judgmentRecordFingerprint: lengthFramedFingerprint([
      "reasoner-judgment-record-v1",
      input.fingerprint,
      input.model,
      input.evidenceContextFingerprint ?? "",
      input.evidenceBindingFingerprint ?? "",
      canonicalEvidenceJson(input.payload),
    ]),
  };
}

function sameRecord(left: ReasonerJudgmentRecord, right: ReasonerJudgmentRecord): boolean {
  return left.fingerprint === right.fingerprint
    && left.model === right.model
    && canonicalEvidenceJson(left.payload) === canonicalEvidenceJson(right.payload)
    && left.evidenceContextFingerprint === right.evidenceContextFingerprint
    && left.evidenceBindingFingerprint === right.evidenceBindingFingerprint;
}

function rowValue(row: Record<string, unknown>, camel: string, snake: string): unknown {
  return row[camel] !== undefined ? row[camel] : row[snake];
}

function parseRow(input: unknown): ReasonerJudgmentRecord {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid reasoner judgment row.");
  }
  const row = input as Record<string, unknown>;
  if (row.state === "current") {
    const record = {
      state: "current" as const,
      judgmentSchemaVersion: row.judgmentSchemaVersion,
      fingerprint: row.fingerprint,
      model: row.model,
      payload: row.payload,
      evidenceContextFingerprint: row.evidenceContextFingerprint,
      evidenceBindingFingerprint: row.evidenceBindingFingerprint,
      judgmentRecordFingerprint: row.judgmentRecordFingerprint,
    };
    const parsedWrite = ReasonerJudgmentWriteSchema.parse({
      fingerprint: record.fingerprint,
      model: record.model,
      payload: record.payload,
      evidenceContextFingerprint: record.evidenceContextFingerprint,
      evidenceBindingFingerprint: record.evidenceBindingFingerprint,
    });
    if (record.judgmentSchemaVersion !== "reasoner-judgment-record-v1"
      || !Sha256Schema.safeParse(record.judgmentRecordFingerprint).success) {
      throw new Error("Partial or invalid current reasoner judgment row.");
    }
    return { ...record, ...parsedWrite } as ReasonerJudgmentRecord;
  }
  const schemaVersion = rowValue(row, "judgmentSchemaVersion", "judgment_schema_version") ?? null;
  const recordFingerprint = rowValue(row, "judgmentRecordFingerprint", "judgment_record_fingerprint") ?? null;
  const contextFingerprint = rowValue(row, "evidenceContextFingerprint", "evidence_context_fingerprint") ?? null;
  const bindingFingerprint = rowValue(row, "evidenceBindingFingerprint", "evidence_binding_fingerprint") ?? null;
  if (schemaVersion === null && recordFingerprint === null && contextFingerprint === null && bindingFingerprint === null) {
    const fingerprint = SemanticFingerprintSchema.parse(row.fingerprint);
    const model = z.string().min(1).parse(row.model);
    return {
      state: "legacy_unbound",
      fingerprint,
      model,
      payload: structuredClone(row.payload),
      evidenceContextFingerprint: null,
      evidenceBindingFingerprint: null,
      judgmentRecordFingerprint: null,
    };
  }
  if (schemaVersion !== "reasoner-judgment-record-v1" || recordFingerprint === null) {
    throw new Error("Partial current reasoner judgment row.");
  }
  const parsedWrite = ReasonerJudgmentWriteSchema.parse({
    fingerprint: row.fingerprint,
    model: row.model,
    payload: row.payload,
    evidenceContextFingerprint: contextFingerprint,
    evidenceBindingFingerprint: bindingFingerprint,
  });
  const expected = makeCurrentRecord(parsedWrite);
  if (expected.state !== "current" || expected.judgmentRecordFingerprint !== recordFingerprint) {
    throw new Error("Reasoner judgment record fingerprint mismatch.");
  }
  return expected;
}

export function createMemoryReasonerJudgmentsRepository(): ReasonerJudgmentsRepository {
  const rows = new Map<string, ReasonerJudgmentRecord>();
  return {
    async find(fingerprint) {
      SemanticFingerprintSchema.parse(fingerprint);
      const row = rows.get(fingerprint);
      return row ? structuredClone(row) : null;
    },
    async save(input) {
      const proposed = makeCurrentRecord(ReasonerJudgmentWriteSchema.parse(input));
      const existing = rows.get(proposed.fingerprint);
      if (existing) {
        if (!sameRecord(existing, proposed)) throw new Error("Reasoner judgment identity collision.");
        return structuredClone(existing);
      }
      rows.set(proposed.fingerprint, proposed);
      return structuredClone(proposed);
    },
  };
}

export function createSupabaseReasonerJudgmentsRepository(options: {
  url: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}): ReasonerJudgmentsRepository {
  const base = `${options.url.replace(/\/$/u, "")}/rest/v1`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = {
    apikey: options.serviceRoleKey,
    authorization: `Bearer ${options.serviceRoleKey}`,
    "content-type": "application/json",
  };
  async function request(path: string, init: RequestInit = {}) {
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
      throw new IntegrationTransportError({ retryable: isRetryableTransportStatus(response.status) });
    }
    const text = await response.text();
    return text.trim() ? JSON.parse(text) : null;
  }
  return {
    async find(fingerprint) {
      SemanticFingerprintSchema.parse(fingerprint);
      const rows = await request(
        `/reasoner_judgments?fingerprint=eq.${encodeURIComponent(fingerprint)}&limit=1`,
      ) as unknown[];
      return rows[0] ? parseRow(rows[0]) : null;
    },
    async save(input) {
      const parsed = ReasonerJudgmentWriteSchema.parse(input);
      const response = await request("/rpc/save_reasoner_judgment_immutable", {
        method: "POST",
        body: JSON.stringify({ p_request: parsed }),
      });
      const row = Array.isArray(response) ? response[0] : response;
      if (!row) throw new Error("Immutable reasoner judgment save returned no row.");
      return parseRow(row);
    },
  };
}

let singleton: ReasonerJudgmentsRepository | undefined;

export function getReasonerJudgmentsRepository(): ReasonerJudgmentsRepository {
  if (singleton) return singleton;
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  singleton = url && serviceRoleKey
    ? createSupabaseReasonerJudgmentsRepository({ url, serviceRoleKey })
    : createMemoryReasonerJudgmentsRepository();
  return singleton;
}
