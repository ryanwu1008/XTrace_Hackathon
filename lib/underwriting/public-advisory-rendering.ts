import type {
  ActionDraft,
  FrameworkAdvisoryMetadata,
  FrameworkDisagreement,
  FrameworkJudgment,
} from "../contracts/underwriting";

type AdvisoryJudgment = FrameworkJudgment & {
  frameworkMetadata: FrameworkAdvisoryMetadata;
};

const LEGACY_ACTION_DRAFT_HEADERS: Partial<
  Record<ActionDraft["channel"], string>
> = {
  internal_memo: "INTERNAL UNDERWRITING ACTION MEMO",
  dd_request: "DUE DILIGENCE REQUEST DRAFT",
};
const LEGACY_ADVISORY_OPINIONS_HEADING =
  "EXPERIMENTAL ADVISORY OPINIONS — DRAFT ONLY";
const LEGACY_ADVISORY_CONFLICTS_HEADING =
  "INDEPENDENT ADVISORY CONFLICTS";
const LEGACY_ADVISORY_DILIGENCE_HEADING =
  "ADVISORY DILIGENCE REQUESTS";
const LEGACY_PRIVATE_OPINION_LINE_PREFIXES = [
  "  Product-synthesis notice:",
  "  No-endorsement notice:",
  "  No-private-reasoning notice:",
  "  Limitations:",
] as const;
const PRIVATE_COMPONENT_BLOCK_HEADING =
  "  Component qualifications and limitations:";
const LEGACY_GENERATED_DILIGENCE_LINE_PREFIXES = [
  "- Resolve advisory unknown [",
  "- Test advisory counterevidence [",
  "- Address advisory limitation [",
] as const;
const LEGACY_PRIVATE_DILIGENCE_LINE_PREFIX =
  "- Address advisory limitation [";

export function renderPublicAdvisoryOpinions(
  judgments: FrameworkJudgment[],
): string {
  const advisoryJudgments = judgments.filter(isAdvisoryJudgment);
  return advisoryJudgments.length === 0
    ? "Unavailable"
    : advisoryJudgments.map(renderPublicAdvisoryJudgment).join("\n");
}

export function renderPublicAdvisoryConflicts(
  disagreements: FrameworkDisagreement[],
  judgments: FrameworkJudgment[],
): string {
  const judgmentsById = new Map(
    judgments.filter(isAdvisoryJudgment).map((judgment) => [
      judgment.id,
      judgment,
    ]),
  );
  const conflicts = disagreements.flatMap((disagreement) => {
    if (disagreement.topic !== "independent_framework_conflict") return [];
    const left = judgmentsById.get(disagreement.leftJudgmentId);
    const right = judgmentsById.get(disagreement.rightJudgmentId);
    if (!left || !right) return [];
    return [[
      `- ${namedConclusion(left)} versus ${namedConclusion(right)}`,
      `  Explanation: ${disagreement.explanation}`,
      `  Evidence: ${inlineList(disagreement.evidenceItemIds)}`,
    ].join("\n")];
  });
  return conflicts.length === 0 ? "Unavailable" : conflicts.join("\n");
}

export function renderPublicAdvisoryDiligenceRequests(
  judgments: FrameworkJudgment[],
): string {
  const requests = judgments.filter(isAdvisoryJudgment).flatMap((judgment) => {
    const packName = judgment.frameworkMetadata.packName;
    const limitations = publicFrameworkLimitations(judgment);
    return [
      ...judgment.unknowns.map(
        (unknown) =>
          `- Resolve advisory unknown [${packName}]: ${unknown}`,
      ),
      ...(judgment.strongestCounterargument
        ? [
          [
            `- Test advisory counterevidence [${packName}]:`,
            judgment.strongestCounterargument,
            `(evidence IDs: ${inlineList(judgment.counterEvidenceItemIds)})`,
          ].join(" "),
        ]
        : judgment.counterEvidenceItemIds.length > 0
        ? [
          `- Test advisory counterevidence [${packName}] (evidence IDs: ${
            inlineList(judgment.counterEvidenceItemIds)
          })`,
        ]
        : []),
      ...limitations.map(
        (limitation) =>
          `- Address public advisory limitation [${packName}]: ${limitation}`,
      ),
    ];
  });
  return requests.length === 0 ? "None" : requests.join("\n");
}

export function renderPublicAdvisorySections(input: {
  judgments: FrameworkJudgment[];
  disagreements: FrameworkDisagreement[];
}): string {
  if (!input.judgments.some(isAdvisoryJudgment)) return "";
  return [
    "PUBLIC NAMED ADVISORY VIEWPOINTS",
    renderPublicAdvisoryOpinions(input.judgments),
    "",
    "PUBLIC ADVISORY CONFLICTS",
    renderPublicAdvisoryConflicts(input.disagreements, input.judgments),
    "",
    "PUBLIC ADVISORY DILIGENCE REQUESTS",
    renderPublicAdvisoryDiligenceRequests(input.judgments),
  ].join("\n");
}

/**
 * Removes authoring-owned fields only from the exact advisory appendix emitted
 * by the legacy deterministic internal-memo and diligence-request renderers.
 * Other channels, bodies without the complete legacy delimiter sequence, and
 * user-authored text outside that appendix are retained verbatim.
 */
export function sanitizeLegacyPublicActionDraftBody(input: {
  channel: ActionDraft["channel"];
  format?: string | null;
  body: string;
}): string {
  const effectiveChannel = input.format === "internal_memo"
    ? "internal_memo"
    : input.format === "diligence_request"
    ? "dd_request"
    : input.channel;
  const expectedHeader = LEGACY_ACTION_DRAFT_HEADERS[effectiveChannel];
  if (!expectedHeader) return input.body;

  const lines = input.body.split("\n");
  if (
    lines[0] !== expectedHeader
    && lines[0] !== `${expectedHeader} — DRAFT ONLY`
  ) return input.body;

  const opinionsHeadingIndex = lines.indexOf(
    LEGACY_ADVISORY_OPINIONS_HEADING,
    1,
  );
  const conflictsHeadingIndex = lines.indexOf(
    LEGACY_ADVISORY_CONFLICTS_HEADING,
    opinionsHeadingIndex + 1,
  );
  const diligenceHeadingIndex = lines.indexOf(
    LEGACY_ADVISORY_DILIGENCE_HEADING,
    conflictsHeadingIndex + 1,
  );
  if (
    opinionsHeadingIndex < 1
    || conflictsHeadingIndex <= opinionsHeadingIndex
    || diligenceHeadingIndex <= conflictsHeadingIndex
  ) {
    return input.body;
  }

  const publicOpinionLines = sanitizeLegacyOpinionSpan(
    lines.slice(opinionsHeadingIndex + 1, conflictsHeadingIndex),
  );
  const diligenceLines = lines.slice(diligenceHeadingIndex + 1);
  let generatedDiligenceEnd = 0;
  while (
    generatedDiligenceEnd < diligenceLines.length
    && isLegacyGeneratedDiligenceLine(
      diligenceLines[generatedDiligenceEnd],
    )
  ) {
    generatedDiligenceEnd += 1;
  }
  const publicGeneratedDiligenceLines = diligenceLines
    .slice(0, generatedDiligenceEnd)
    .flatMap(publicLegacyDiligenceLine);

  return [
    ...lines.slice(0, opinionsHeadingIndex + 1),
    ...publicOpinionLines,
    ...lines.slice(conflictsHeadingIndex, diligenceHeadingIndex + 1),
    ...publicGeneratedDiligenceLines,
    ...diligenceLines.slice(generatedDiligenceEnd),
  ].join("\n");
}

function sanitizeLegacyOpinionSpan(lines: string[]): string[] {
  const retained: string[] = [];
  let droppingPrivateComponentBlock = false;
  let pendingBlankLine = false;

  for (const line of lines) {
    if (line === PRIVATE_COMPONENT_BLOCK_HEADING) {
      droppingPrivateComponentBlock = true;
      pendingBlankLine = false;
      continue;
    }
    if (droppingPrivateComponentBlock) {
      if (line.length === 0) {
        pendingBlankLine = true;
        continue;
      }
      if (/^\s/.test(line)) continue;
      droppingPrivateComponentBlock = false;
      if (pendingBlankLine) retained.push("");
      pendingBlankLine = false;
    }
    if (
      LEGACY_PRIVATE_OPINION_LINE_PREFIXES.some((prefix) =>
        line.startsWith(prefix)
      )
    ) {
      if (line.startsWith("  Limitations:")) {
        const publicValues = line.slice("  Limitations:".length)
          .split(";")
          .map((value) => value.trim())
          .filter((value) => value.length > 0 && !/^private\b/i.test(value));
        if (publicValues.length > 0) {
          retained.push(`  Public limitations: ${publicValues.join("; ")}`);
        }
      }
      continue;
    }
    retained.push(line);
  }
  return retained;
}

function publicLegacyDiligenceLine(line: string): string[] {
  if (!line.startsWith(LEGACY_PRIVATE_DILIGENCE_LINE_PREFIX)) return [line];
  const value = line.slice(line.indexOf(":") + 1).trim();
  return /^private\b/i.test(value)
    ? []
    : [line.replace(
      LEGACY_PRIVATE_DILIGENCE_LINE_PREFIX,
      "- Address public advisory limitation [",
    )];
}

function isLegacyGeneratedDiligenceLine(line: string): boolean {
  return line === "None"
    || LEGACY_GENERATED_DILIGENCE_LINE_PREFIXES.some((prefix) =>
      line.startsWith(prefix)
    );
}

export function publicFrameworkLimitations(
  judgment: FrameworkJudgment,
): string[] {
  if (!judgment.frameworkMetadata) return [...judgment.limitations];
  const privateValues = privateAuthoringLimitationValues(
    judgment.frameworkMetadata,
  );
  return judgment.limitations.filter((value) => !privateValues.has(value));
}

function renderPublicAdvisoryJudgment(
  judgment: AdvisoryJudgment,
): string {
  const metadata = judgment.frameworkMetadata;
  const limitations = publicFrameworkLimitations(judgment);
  return [
    `- Pack: ${metadata.packName}`,
    `  Pack ID: ${metadata.packId}; version: ${metadata.packVersion}`,
    `  Source catalog ID: ${metadata.sourceCatalogId}; research cutoff: ${metadata.researchCutoff}`,
    `  Attribution: ${componentAttributions(metadata)}`,
    "  Formal decision weight: 0 (experimental advisory; not a published formal decision factor)",
    `  Applicability: ${judgment.applicability}; advisory conclusion: ${judgment.conclusion}`,
    `  Advisory support: ${judgment.strongestSupport ?? "Unavailable"}`,
    `  Advisory counterevidence: ${
      judgment.strongestCounterargument ?? "Unavailable"
    }`,
    `  Supporting Evidence Pack IDs: ${
      inlineList(judgment.supportEvidenceItemIds)
    }`,
    `  Counterevidence Evidence Pack IDs: ${
      inlineList(judgment.counterEvidenceItemIds)
    }`,
    `  Unknowns: ${inlineList(judgment.unknowns)}`,
    `  Public limitations: ${inlineList(limitations)}`,
    "  Component Cards:",
    indentLines(renderComponentCards(metadata), 4),
    "  Exact source lineage:",
    indentLines(renderSourceLineage(metadata), 4),
  ].join("\n");
}

function privateAuthoringLimitationValues(
  metadata: FrameworkAdvisoryMetadata,
): Set<string> {
  return new Set([
    metadata.notices.noEndorsement,
    metadata.notices.noPrivateReasoning,
    metadata.notices.experimentalOnly,
    ...metadata.packReview.openIssues,
    ...metadata.components.flatMap((component) => [
      ...component.contraindications,
      ...component.decisionUtility.empiricalQualifications,
      ...component.review.openIssues,
      component.rights.notes,
    ]),
  ].filter((value) => value.length > 0));
}

function renderComponentCards(metadata: FrameworkAdvisoryMetadata): string {
  return metadata.components.length === 0
    ? "Unavailable"
    : metadata.components.map((component) => [
      `- ${component.frameworkId} @ ${component.version} — ${component.name}`,
      `  Attribution: ${component.attribution.display}`,
    ].join("\n")).join("\n");
}

function renderSourceLineage(metadata: FrameworkAdvisoryMetadata): string {
  const sourcesById = new Map(
    metadata.sources.map((source) => [source.sourceId, source]),
  );
  const lines = metadata.components.flatMap((component) =>
    component.sourceRefs.map((sourceRef) => {
      const source = sourcesById.get(sourceRef.sourceId);
      return [
        `- ${sourceRef.sourceId} | ${source?.url ?? "Unavailable"} |`,
        `${sourceRef.locator.kind}: ${sourceRef.locator.value}`,
        `| component ${component.frameworkId} @ ${component.version}`,
        `| claims: ${inlineList(sourceRef.claimIds)}`,
        `| support: ${sourceRef.supportType}`,
        `| attribution scope: ${sourceRef.attributionScope}`,
        `| title: ${source?.title ?? "Unavailable"}`,
        `| publisher: ${source?.publisher ?? "Unavailable"}`,
        `| edition: ${source?.edition ?? "Unavailable"}`,
        `| immutable revision: ${
          source
            ? [
              source.immutableRevision.status,
              source.immutableRevision.hashAlgorithm ?? "no hash algorithm",
              source.immutableRevision.contentHash ?? "no content hash",
            ].join(" / ")
            : "Unavailable"
        }`,
      ].join(" ");
    })
  );
  return lines.length === 0 ? "Unavailable" : lines.join("\n");
}

function componentAttributions(
  metadata: FrameworkAdvisoryMetadata,
): string {
  const attributions = [
    ...new Set(
      metadata.components.map(({ attribution }) => attribution.display),
    ),
  ];
  return attributions.length === 0 ? "Unavailable" : attributions.join("; ");
}

function namedConclusion(judgment: AdvisoryJudgment): string {
  return [
    judgment.frameworkMetadata.packName,
    `(judgment ${judgment.id}; ${judgment.conclusion})`,
  ].join(" ");
}

function isAdvisoryJudgment(
  judgment: FrameworkJudgment,
): judgment is AdvisoryJudgment {
  return judgment.frameworkMetadata !== undefined;
}

function indentLines(value: string, spaces: number): string {
  const indentation = " ".repeat(spaces);
  return value.split("\n").map((line) => `${indentation}${line}`).join("\n");
}

function inlineList(values: string[]): string {
  return values.length === 0 ? "None" : values.join("; ");
}
