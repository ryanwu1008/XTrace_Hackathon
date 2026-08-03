import { z } from "zod";

import { DealStatusSchema, RunStatusSchema } from "./domain";
import {
  CurrentRunEvidenceContextV1Schema,
  LegacyUnboundEvidenceContextSchema,
  RunEvidenceRequestV1Schema,
} from "./evidence-context";

export const ConfirmUploadSchema = z.strictObject({
  companyName: z.string().trim().min(1).max(160),
  assignment: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("existing_deal"),
      dealId: z.string().min(1),
    }),
    z.strictObject({
      kind: z.literal("new_deal"),
      dealStatus: DealStatusSchema,
    }),
  ]),
});

export const CreateRunRequestSchema = z.strictObject({
  xtraceEnabled: z.boolean().default(true),
  evidenceRequest: RunEvidenceRequestV1Schema.default({
    schemaVersion: "run-evidence-request-v1",
    evidenceMode: "live",
  }),
});

export const RunSummarySchema = z.object({
  id: z.string().min(1),
  status: RunStatusSchema,
  mode: z.enum(["xtrace", "structured"]),
  windowDays: z.literal(14),
  createdAt: z.string().datetime(),
  currentStage: z.string().nullable(),
  warningCount: z.number().int().nonnegative(),
  evidenceContext: z.union([
    LegacyUnboundEvidenceContextSchema,
    CurrentRunEvidenceContextV1Schema,
  ]),
});

export const ChatRequestSchema = z.object({
  question: z.string().trim().min(2).max(2_000),
  xtraceEnabled: z.boolean().default(true),
  reportId: z.string().trim().min(1).optional(),
  runId: z.string().trim().min(1).optional(),
  dealId: z.string().trim().min(1).optional(),
}).superRefine((value, refinement) => {
  if ((value.reportId === undefined) !== (value.runId === undefined)) {
    refinement.addIssue({ code: "custom", message: "reportId and runId must be supplied together." });
  }
  if (value.dealId !== undefined && value.reportId === undefined) {
    refinement.addIssue({ code: "custom", message: "dealId requires an explicit report scope." });
  }
});

export const ReplaceActionDraftBodySchema = z.strictObject({
  body: z.string().max(100_000).refine(
    (body) => body.trim().length > 0,
    "Action draft body cannot be blank",
  ),
});

export const ApiErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "INTEGRATION_UNAVAILABLE",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "INTERNAL_ERROR",
]);

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean(),
  }),
});

export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;
export type RunSummary = z.infer<typeof RunSummarySchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type ConfirmUpload = z.infer<typeof ConfirmUploadSchema>;
export type ReplaceActionDraftBody = z.infer<
  typeof ReplaceActionDraftBodySchema
>;
