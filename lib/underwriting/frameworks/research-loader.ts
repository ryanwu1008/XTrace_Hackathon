import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  readdir,
  realpath,
} from "node:fs/promises";
import {
  basename,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

import {
  ResearchFrameworkContextSchema,
  type ResearchFrameworkContext,
} from "../../contracts/underwriting";
import {
  DecisionQuestionTaxonomyAuthoringSchema,
  FrameworkCardAuthoringSchema,
  FrameworkPackAuthoringSchema,
  ResearchSourceCatalogSchema,
  type FrameworkCardAuthoring,
  type FrameworkPackAuthoring,
  type ResearchSourceCatalog,
} from "./research-schemas";
import {
  DECISION_TAXONOMY_VERSION,
  decisionTaxonomyDigest,
  validateDecisionTaxonomyForCards,
  type DecisionTaxonomyBinding,
} from "./decision-taxonomy";
import {
  ExperimentalAdvisoryFrameworkCardSchema,
  type ExperimentalAdvisoryFrameworkCard,
  type FrameworkCard,
} from "./schemas";

type ResearchContext = Pick<
  ResearchFrameworkContext,
  "stage" | "businessModel" | "geography" | "securityType"
>;

export interface ResearchFrameworkCatalog {
  readonly version: typeof RESEARCH_FRAMEWORK_CATALOG_VERSION;
  readonly context: ResearchContext;
  readonly composites: readonly ExperimentalAdvisoryFrameworkCard[];
  readonly decisionTaxonomyVersion: typeof DECISION_TAXONOMY_VERSION;
  readonly decisionTaxonomyDigest: string;
  readonly decisionTaxonomyBindings: readonly DecisionTaxonomyBinding[];
  readonly stats: Readonly<{
    packCount: number;
    cardCount: number;
    sourceCount: number;
    eligibleCardCount: number;
    excludedCardCount: number;
  }>;
  readonly authorization: Readonly<{
    mode: "canonical_audited" | "validation_only";
    corpusDigest: string;
  }>;
  readonly fingerprint: string;
}

type ResearchFrameworkCatalogInput = {
  context: ResearchFrameworkContext;
  signal?: AbortSignal;
} & (
  | {
    researchRoot?: never;
    authorizationMode?: "canonical_audited";
  }
  | {
    researchRoot: string;
    authorizationMode: "validation_only";
  }
);

interface LoadedPack {
  manifest: FrameworkPackAuthoring;
  sourceCatalog: ResearchSourceCatalog;
  cards: FrameworkCardAuthoring[];
}

const MAX_RESEARCH_PACKS = 20;
export const RESEARCH_FRAMEWORK_CATALOG_VERSION =
  "research-framework-catalog-v2";
const CANONICAL_RESEARCH_ROOT = fileURLToPath(
  new URL("../../../research/framework-authoring", import.meta.url),
);
const EXPECTED_CANONICAL_STATS = {
  packCount: 20,
  cardCount: 199,
  sourceCount: 270,
  eligibleCardCount: 180,
  excludedCardCount: 19,
} as const;
const EXPECTED_CANONICAL_CORPUS_DIGEST =
  "sha256:a02b583381f386d824fdf7d92cb38960b80c9434d08492642198f72989cf40e8";
const NO_ENDORSEMENT_NOTICE =
  "This experimental product synthesis is not an endorsement by any named person or organization.";
const NO_PRIVATE_REASONING_NOTICE =
  "This synthesis uses only the retained public-source paraphrases and does not claim or reconstruct private reasoning or hidden chain of thought.";
const EXPERIMENTAL_ONLY_NOTICE =
  "This advisory lens has formal decision weight zero and cannot create or modify the deterministic investment decision.";
const ALLOWED_AUTHOR_SUPPORT_FILES = new Set([
  "atomic-claims.md",
  "review-notes.md",
  "source-inventory.md",
]);
const DECISION_TAXONOMY_FILE = "decision-question-taxonomy.v1.json";

const authorizedCatalogs = new WeakMap<
  ResearchFrameworkCatalog,
  ReadonlySet<ExperimentalAdvisoryFrameworkCard>
>();

export async function loadResearchFrameworkCatalog(
  input: ResearchFrameworkCatalogInput,
): Promise<ResearchFrameworkCatalog> {
  const allowedInputKeys = new Set([
    "context",
    "signal",
    "researchRoot",
    "authorizationMode",
  ]);
  if (Object.keys(input).some((key) => !allowedInputKeys.has(key))) {
    throw new Error(
      "Research Framework catalog resolution does not accept client-supplied authorization or taxonomy fields.",
    );
  }
  throwIfAborted(input.signal);
  const parsedContext = ResearchFrameworkContextSchema.parse(input.context);
  const context: ResearchContext = {
    stage: parsedContext.stage,
    businessModel: parsedContext.businessModel,
    geography: parsedContext.geography,
    securityType: parsedContext.securityType,
  };
  const validationOnly = input.authorizationMode === "validation_only";
  if (
    validationOnly !== (typeof input.researchRoot === "string")
  ) {
    throw new Error(
      "Custom research roots require explicit validation_only mode and can never authorize execution.",
    );
  }
  const researchRoot = validationOnly
    ? resolve(input.researchRoot)
    : CANONICAL_RESEARCH_ROOT;
  const rootStats = await lstat(researchRoot);
  throwIfAborted(input.signal);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error("Research root must be a real directory, not a symlink.");
  }
  const canonicalRoot = await realpath(researchRoot);
  throwIfAborted(input.signal);
  const decisionTaxonomyPath = join(canonicalRoot, DECISION_TAXONOMY_FILE);
  await assertRealFile(
    decisionTaxonomyPath,
    canonicalRoot,
    "Decision taxonomy",
  );
  const decisionTaxonomy = await readParsedJson(
    decisionTaxonomyPath,
    DecisionQuestionTaxonomyAuthoringSchema,
    "Decision taxonomy",
    input.signal,
  );
  const resolvedDecisionTaxonomyDigest = decisionTaxonomyDigest(
    decisionTaxonomy,
  );
  const authorsRoot = join(canonicalRoot, "authors");
  await assertRealDirectory(authorsRoot, canonicalRoot, "Authors root");
  throwIfAborted(input.signal);

  const authorEntries = await readdir(authorsRoot, { withFileTypes: true });
  throwIfAborted(input.signal);
  const authorNames = authorEntries
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => name)
    .sort(compareUtf8);
  if (
    authorNames.length === 0
    || authorNames.length > MAX_RESEARCH_PACKS
    || authorEntries.length !== authorNames.length
  ) {
    throw new Error(
      `Research root must contain between 1 and ${MAX_RESEARCH_PACKS} real author directories and no other entries.`,
    );
  }

  const loadedPacks: LoadedPack[] = [];
  for (const authorName of authorNames) {
    throwIfAborted(input.signal);
    const authorRoot = join(authorsRoot, authorName);
    await assertRealDirectory(authorRoot, authorsRoot, "Author directory");
    loadedPacks.push(
      await loadAuthorPack(authorRoot, canonicalRoot, input.signal),
    );
  }
  throwIfAborted(input.signal);
  loadedPacks.sort((left, right) =>
    compareUtf8(left.manifest.packId, right.manifest.packId)
  );
  validateGlobalIdentities(loadedPacks);
  const decisionTaxonomyBindings = validateDecisionTaxonomyForCards(
    loadedPacks.flatMap(({ cards }) => cards),
    decisionTaxonomy,
  );

  const composites = loadedPacks.map((pack) =>
    buildComposite(
      pack,
      context,
      decisionTaxonomyBindings,
      resolvedDecisionTaxonomyDigest,
    )
  );
  const cardCount = loadedPacks.reduce(
    (count, pack) => count + pack.cards.length,
    0,
  );
  const sourceCount = loadedPacks.reduce(
    (count, pack) => count + pack.sourceCatalog.sources.length,
    0,
  );
  const eligibleCardCount = loadedPacks.reduce(
    (count, pack) => count + pack.cards.filter(isAdvisoryEligible).length,
    0,
  );
  const stats = {
    packCount: loadedPacks.length,
    cardCount,
    sourceCount,
    eligibleCardCount,
    excludedCardCount: cardCount - eligibleCardCount,
  };
  const corpusDigest = sha256({
    kind: "audited-research-corpus-v1",
    packs: loadedPacks,
    decisionTaxonomy: {
      version: DECISION_TAXONOMY_VERSION,
      digest: resolvedDecisionTaxonomyDigest,
    },
  });
  if (
    !validationOnly
    && (
      canonicalJson(stats) !== canonicalJson(EXPECTED_CANONICAL_STATS)
      || corpusDigest !== EXPECTED_CANONICAL_CORPUS_DIGEST
    )
  ) {
    throw new Error(
      "Canonical research authorization requires the pinned 20/199/270 corpus, exact 180/19 eligibility split, and audited content digest.",
    );
  }
  const authorization = {
    mode: validationOnly
      ? "validation_only" as const
      : "canonical_audited" as const,
    corpusDigest,
  };
  const fingerprint = sha256({
    kind: RESEARCH_FRAMEWORK_CATALOG_VERSION,
    context,
    composites,
    decisionTaxonomyVersion: DECISION_TAXONOMY_VERSION,
    decisionTaxonomyDigest: resolvedDecisionTaxonomyDigest,
    decisionTaxonomyBindings,
    stats,
    authorization,
  });
  const catalog = deepFreeze({
    version: RESEARCH_FRAMEWORK_CATALOG_VERSION,
    context,
    composites,
    decisionTaxonomyVersion: DECISION_TAXONOMY_VERSION,
    decisionTaxonomyDigest: resolvedDecisionTaxonomyDigest,
    decisionTaxonomyBindings,
    stats,
    authorization,
    fingerprint,
  }) satisfies ResearchFrameworkCatalog;
  if (!validationOnly) {
    authorizedCatalogs.set(catalog, new Set(catalog.composites));
  }
  return catalog;
}

export function authorizedResearchComposites(
  catalog: ResearchFrameworkCatalog,
): readonly ExperimentalAdvisoryFrameworkCard[] {
  if (!authorizedCatalogs.has(catalog)) {
    throw new Error(
      "The supplied value is validation-only or is not an authorized research catalog from the canonical audited loader instance.",
    );
  }
  return catalog.composites;
}

export function isAuthorizedResearchComposite(
  catalog: ResearchFrameworkCatalog,
  card: FrameworkCard,
): card is ExperimentalAdvisoryFrameworkCard {
  return authorizedCatalogs.get(catalog)?.has(
    card as ExperimentalAdvisoryFrameworkCard,
  ) ?? false;
}

async function loadAuthorPack(
  authorRoot: string,
  canonicalRoot: string,
  signal?: AbortSignal,
): Promise<LoadedPack> {
  throwIfAborted(signal);
  const authorEntries = await readdir(authorRoot, { withFileTypes: true });
  throwIfAborted(signal);
  const manifestNames = authorEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".pack.json"))
    .map(({ name }) => name)
    .sort(compareUtf8);
  if (manifestNames.length !== 1) {
    throw new Error(
      `Author directory ${basename(authorRoot)} must contain exactly one Pack manifest.`,
    );
  }
  if (
    authorEntries.some((entry) => {
      if (entry.isSymbolicLink()) return true;
      if (entry.name === "cards") return !entry.isDirectory();
      if (
        entry.name === manifestNames[0]
        || entry.name === "sources.json"
        || ALLOWED_AUTHOR_SUPPORT_FILES.has(entry.name)
      ) {
        return !entry.isFile();
      }
      return true;
    })
  ) {
    throw new Error(
      `Author directory ${basename(authorRoot)} contains an unexpected or symbolic entry.`,
    );
  }

  const manifestPath = join(authorRoot, manifestNames[0]!);
  await assertRealFile(manifestPath, authorRoot, "Pack manifest");
  throwIfAborted(signal);
  const manifest = await readParsedJson(
    manifestPath,
    FrameworkPackAuthoringSchema,
    "Pack manifest",
    signal,
  );
  const sourcePath = safeChildPath(
    authorRoot,
    manifest.sourceCatalog,
    "source catalog path",
  );
  await assertRealFile(sourcePath, authorRoot, "Source catalog");
  throwIfAborted(signal);
  const sourceCatalog = await readParsedJson(
    sourcePath,
    ResearchSourceCatalogSchema,
    "Source catalog",
    signal,
  );
  assertUnique(
    sourceCatalog.sources.map(({ sourceId }) => sourceId),
    "Source identities must be unique inside each research pack.",
  );

  const cardsRoot = join(authorRoot, "cards");
  await assertRealDirectory(cardsRoot, authorRoot, "Cards directory");
  throwIfAborted(signal);
  const cardEntries = await readdir(cardsRoot, { withFileTypes: true });
  throwIfAborted(signal);
  if (
    cardEntries.some((entry) =>
      !entry.isFile()
      || entry.isSymbolicLink()
      || !entry.name.endsWith(".card.json")
    )
  ) {
    throw new Error(
      `Cards directory for ${manifest.packId} contains an unexpected or symbolic entry.`,
    );
  }
  const actualCardFiles = cardEntries
    .map(({ name }) => `cards/${name}`)
    .sort(compareUtf8);
  const declaredCardFiles = [...manifest.cardFiles].sort(compareUtf8);
  if (canonicalJson(actualCardFiles) !== canonicalJson(declaredCardFiles)) {
    throw new Error(
      `Pack manifest ${manifest.packId} must declare the exact Card file set.`,
    );
  }

  const cards: FrameworkCardAuthoring[] = [];
  for (const relativeCardPath of manifest.cardFiles) {
    throwIfAborted(signal);
    const cardPath = safeChildPath(
      authorRoot,
      relativeCardPath,
      "safe relative Card path",
    );
    await assertRealFile(cardPath, authorRoot, "Framework Card");
    cards.push(await readParsedJson(
      cardPath,
      FrameworkCardAuthoringSchema,
      "Framework Card",
      signal,
    ));
  }
  assertUnique(
    cards.map(({ frameworkId }) => frameworkId),
    "Framework Card identities must be unique inside each research pack.",
  );

  const sourceIds = new Set(
    sourceCatalog.sources.map(({ sourceId }) => sourceId),
  );
  for (const card of cards) {
    for (const sourceRef of card.sourceRefs) {
      if (!sourceIds.has(sourceRef.sourceId)) {
        throw new Error(
          `Framework Card ${card.frameworkId} source reference ${sourceRef.sourceId} does not resolve inside its audited pack.`,
        );
      }
    }
  }
  await assertResolvedInside(manifestPath, canonicalRoot, "Pack manifest");
  await assertResolvedInside(sourcePath, canonicalRoot, "Source catalog");
  throwIfAborted(signal);
  return { manifest, sourceCatalog, cards };
}

function buildComposite(
  pack: LoadedPack,
  context: ResearchContext,
  decisionTaxonomyBindings: readonly DecisionTaxonomyBinding[],
  decisionTaxonomyDigest: string,
): ExperimentalAdvisoryFrameworkCard {
  const components = pack.cards
    .filter(isAdvisoryEligible)
    .filter((card) => isContextApplicable(card, context))
    .sort((left, right) => compareUtf8(left.frameworkId, right.frameworkId));
  const componentCardIds = components.map(({ frameworkId }) => frameworkId);
  const componentDecisionTaxonomyBindings = decisionTaxonomyBindings.filter(
    (binding) => componentCardIds.includes(binding.frameworkId),
  );
  const referencedSourceIds = new Set(
    components.flatMap((card) =>
      card.sourceRefs.map(({ sourceId }) => sourceId)
    ),
  );
  const sources = pack.sourceCatalog.sources
    .filter(({ sourceId }) => referencedSourceIds.has(sourceId))
    .sort((left, right) => compareUtf8(left.sourceId, right.sourceId));
  const notices = {
    noEndorsement: NO_ENDORSEMENT_NOTICE,
    noPrivateReasoning: NO_PRIVATE_REASONING_NOTICE,
    experimentalOnly: EXPERIMENTAL_ONLY_NOTICE,
  };
  const authorizationDigest = sha256({
    kind: "experimental-advisory-composite-v1",
    pack: pack.manifest,
    sourceCatalogId: pack.sourceCatalog.catalogId,
    researchCutoff: pack.sourceCatalog.researchCutoff,
    context,
    components,
    decisionTaxonomyVersion: DECISION_TAXONOMY_VERSION,
    decisionTaxonomyDigest,
    decisionTaxonomyBindings: componentDecisionTaxonomyBindings,
    sources,
    notices,
  });
  const limitations = uniqueSorted([
    NO_ENDORSEMENT_NOTICE,
    NO_PRIVATE_REASONING_NOTICE,
    EXPERIMENTAL_ONLY_NOTICE,
    ...pack.manifest.review.openIssues,
    ...components.flatMap(
      ({ contraindications, decisionUtility, review, rights }) => [
        ...contraindications,
        ...decisionUtility.empiricalQualifications,
        ...review.openIssues,
        rights.notes,
      ],
    ),
  ].filter((value) => value.length > 0));
  const attributions = uniqueSorted(
    components.map(({ attribution }) => attribution.display),
  );

  return ExperimentalAdvisoryFrameworkCardSchema.parse({
    id: [
      "framework_advisory",
      pack.manifest.packId,
      authorizationDigest.slice("sha256:".length, "sha256:".length + 16),
    ].join(":"),
    version: pack.manifest.version,
    title: pack.manifest.name,
    synthetic: false,
    publicationStatus: "unpublished",
    attribution: [
      "Product synthesis of audited public-source paraphrases",
      attributions.length > 0 ? `: ${attributions.join("; ")}` : "",
    ].join(""),
    approvedNeutralParaphrase: pack.manifest.description,
    locator: `research://framework-authoring/packs/${pack.manifest.packId}`,
    limitations,
    rightsStatus: "public_source_paraphrase",
    formalDecisionWeight: "0",
    executionMode: "experimental_advisory",
    experimentalAdvisory: {
      packId: pack.manifest.packId,
      packName: pack.manifest.name,
      packVersion: pack.manifest.version,
      packDescription: pack.manifest.description,
      packReview: pack.manifest.review,
      sourceCatalogId: pack.sourceCatalog.catalogId,
      researchCutoff: pack.sourceCatalog.researchCutoff,
      context,
      applicable: components.length > 0,
      componentCardIds,
      components,
      decisionTaxonomyVersion: DECISION_TAXONOMY_VERSION,
      decisionTaxonomyDigest,
      decisionTaxonomyBindings: componentDecisionTaxonomyBindings,
      sources,
      notices,
      formalDecisionWeight: "0",
      authorizationDigest,
    },
  });
}

function isAdvisoryEligible(card: FrameworkCardAuthoring): boolean {
  return card.rights.status === "public_source_paraphrase"
    && card.review.contentStatus === "draft"
    && card.review.publicationStatus === "unpublished"
    && card.decisionUtility.formalDecisionWeight === 0;
}

function isContextApplicable(
  card: FrameworkCardAuthoring,
  context: ResearchContext,
): boolean {
  return card.applicability.stages.includes(context.stage)
    && card.applicability.businessModels.some((selector) =>
      businessModelMatches(selector, context.businessModel)
    )
    && card.applicability.geographies.some((selector) =>
      geographyMatches(selector, context.geography)
    )
    && card.applicability.securityTypes.some((selector) =>
      securityTypeMatches(selector, context.securityType)
    );
}

const BUSINESS_MODEL_ALIASES: Readonly<
  Record<ResearchContext["businessModel"], ReadonlySet<string>>
> = {
  b2b_saas: new Set([
    "b2b_saas",
    "enterprise",
    "enterprise_software",
    "saas",
    "software",
    "technology_product",
    "technology_service",
    "technology_startup",
    "venture_backed_startup",
    "venture_scale_business",
  ]),
  enterprise_ai: new Set([
    "enterprise",
    "enterprise_ai",
    "enterprise_software",
    "frontier_ai",
    "software",
    "technology_product",
    "technology_service",
    "technology_startup",
    "venture_backed_startup",
    "venture_scale_business",
  ]),
};

function businessModelMatches(
  selector: string,
  businessModel: ResearchContext["businessModel"],
): boolean {
  return selector === "all"
    || selector.startsWith("all_")
    || BUSINESS_MODEL_ALIASES[businessModel].has(selector);
}

function geographyMatches(
  selector: string,
  geography: ResearchContext["geography"],
): boolean {
  if (selector === "all" || selector.startsWith("all_")) return true;
  if (geography === "unavailable") return false;
  return geography === "us" && selector === "united_states";
}

function securityTypeMatches(
  selector: string,
  securityType: ResearchContext["securityType"],
): boolean {
  return selector === "all"
    || selector.startsWith("all_")
    || (
      securityType === "preferred"
      && ["preferred", "preferred_equity", "equity"].includes(selector)
    )
    || (
      securityType === "convertible"
      && [
        "convertible",
        "convertible_note",
        "safe",
      ].includes(selector)
    );
}

function validateGlobalIdentities(packs: readonly LoadedPack[]): void {
  assertUnique(
    packs.map(({ manifest }) => manifest.packId),
    "Research Pack identities must be globally unique.",
  );
  assertUnique(
    packs.flatMap(({ cards }) => cards.map(({ frameworkId }) => frameworkId)),
    "Framework Card identities must be globally unique.",
  );
  assertUnique(
    packs.flatMap(({ sourceCatalog }) =>
      sourceCatalog.sources.map(({ sourceId }) => sourceId)
    ),
    "Source identities must be globally unique.",
  );
  assertUnique(
    packs.map(({ sourceCatalog }) => sourceCatalog.catalogId),
    "Source catalog identities must be globally unique.",
  );
}

async function readParsedJson<T>(
  path: string,
  schema: { parse(value: unknown): T },
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  try {
    const raw = await readFile(path, {
      encoding: "utf8",
      signal,
    });
    throwIfAborted(signal);
    return schema.parse(JSON.parse(raw) as unknown);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} ${path} is invalid: ${detail}`, {
      cause: error,
    });
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Research Framework catalog loading was aborted.");
}

function safeChildPath(
  parent: string,
  child: string,
  label: string,
): string {
  if (
    isAbsolute(child)
    || child.includes("\\")
    || child.split("/").some((segment) =>
      segment.length === 0 || segment === "." || segment === ".."
    )
  ) {
    throw new Error(`${label} must be a safe relative path.`);
  }
  const resolved = resolve(parent, child);
  if (!isInside(parent, resolved)) {
    throw new Error(`${label} must remain inside its author directory.`);
  }
  return resolved;
}

async function assertRealFile(
  path: string,
  parent: string,
  label: string,
): Promise<void> {
  const stats = await lstat(path);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a real file, not a symlink.`);
  }
  await assertResolvedInside(path, parent, label);
}

async function assertRealDirectory(
  path: string,
  parent: string,
  label: string,
): Promise<void> {
  const stats = await lstat(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory, not a symlink.`);
  }
  await assertResolvedInside(path, parent, label);
}

async function assertResolvedInside(
  path: string,
  parent: string,
  label: string,
): Promise<void> {
  const [canonicalPath, canonicalParent] = await Promise.all([
    realpath(path),
    realpath(parent),
  ]);
  if (!isInside(canonicalParent, canonicalPath)) {
    throw new Error(`${label} resolves outside its authorized directory.`);
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel.length > 0
    && rel !== ".."
    && !rel.startsWith(`..${sep}`)
    && !isAbsolute(rel);
}

function assertUnique(values: readonly string[], message: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(message);
  }
}

function sha256(value: unknown): string {
  return `sha256:${
    createHash("sha256")
      .update(canonicalJson(value), "utf8")
      .digest("hex")
  }`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${
      Object.entries(value)
        .sort(([left], [right]) => compareUtf8(left, right))
        .map(([key, item]) =>
          `${JSON.stringify(key)}:${canonicalJson(item)}`
        )
        .join(",")
    }}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf8);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
