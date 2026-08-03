import type { UploadedDocumentsRepository } from "../../db/repositories/uploaded-documents";
import type { SourceRegistry } from "../../db/repositories/source-registry";
import type { DealRegistry } from "../../db/repositories/deal-registry";
import type {
  EvidencePacksRepository,
} from "../../db/repositories/evidence-packs";
import type {
  UnderwritingReferencesRepository,
} from "../../db/repositories/underwriting-references";
import type {
  UnderwritingRunsRepository,
} from "../../db/repositories/underwriting-runs";
import type {
  UnderwritingArtifactsRepository,
} from "../../db/repositories/underwriting-artifacts";
import type {
  IntelligenceRepository,
} from "../../db/repositories/intelligence";
import type { createRunsRepository } from "../../db/repositories/runs";
import type { XTraceLineageRepository } from "../../db/repositories/xtrace-lineage";
import {
  resolveRequestContext,
  type AuthorizedRequestContext,
} from "../auth/request-context";
import type {
  PrivateDocumentAccess,
  PrivateObjectStorage,
} from "../storage/service";

export interface RouteDependencies {
  resolveRequestContext?: (
    request: Request,
  ) => Promise<AuthorizedRequestContext>;
  uploadedDocuments?: UploadedDocumentsRepository;
  sourceRegistry?: SourceRegistry;
  dealRegistry?: DealRegistry;
  evidencePacks?: EvidencePacksRepository;
  documentAccess?: PrivateDocumentAccess;
  privateObjectStorage?: PrivateObjectStorage;
  underwritingReferences?: UnderwritingReferencesRepository;
  underwritingRuns?: UnderwritingRunsRepository;
  underwritingArtifacts?: UnderwritingArtifactsRepository;
  intelligence?: IntelligenceRepository;
  runs?: ReturnType<typeof createRunsRepository>;
  xtraceLineage?: XTraceLineageRepository;
  now?: () => number;
}

export function resolveRouteRequestContext(
  request: Request,
  dependencies: RouteDependencies,
): Promise<AuthorizedRequestContext> {
  return (
    dependencies.resolveRequestContext ?? resolveRequestContext
  )(request);
}
