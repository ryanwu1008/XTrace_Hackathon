import type { UnderwritingAnalysisContext } from "./underwriting-detail";
import { buildUnderwritingArticleViewModel } from "./underwriting-article-view-model";
import type { VersionedCandidateUnderwritingDetail } from
  "../lib/underwriting/read-model";
import type { PublicActionDraft } from "../lib/underwriting/read-model";
import {
  DecisionCriticalEvidenceProjectionSchema,
  NamedLensPassageSchema,
} from "../lib/contracts/named-lens";
import {
  hasSampleResearchScreeningAuthority,
  SAMPLE_RESEARCH_SCREENING_BADGE,
} from "../lib/belief-reversal/sample-research-screening-authority";
import { SourceRevisionLink } from "./source-revision-link";
import { buildActionDraftSection } from "./action-draft-view-model";

type CurrentUnderwritingDetail = Extract<
  VersionedCandidateUnderwritingDetail,
  { presentationAdapter: { kind: "current" } }
>;

const SAMPLE_DECISION_RECORD_BADGE =
  "Sample decision record · synthetic demo history" as const;
const DETERMINISTIC_FIXTURE_OUTPUT_BADGE =
  "Deterministic fixture output · synthetic test generation" as const;
const DETERMINISTIC_FIXTURE_PROVIDER_MODELS = new Set([
  "deterministic-e2e-observer-v1",
  "synthetic-test",
]);

export function isCurrentUnderwritingDetail(
  detail: unknown,
): detail is CurrentUnderwritingDetail {
  return typeof detail === "object"
    && detail !== null
    && "presentationAdapter" in detail
    && typeof detail.presentationAdapter === "object"
    && detail.presentationAdapter !== null
    && "kind" in detail.presentationAdapter
    && detail.presentationAdapter.kind === "current";
}

export function PassageUnderwritingDetailPanel({
  companyName,
  analysis,
  detail,
  drafts,
  canSaveDrafts,
  onEditDraft,
}: {
  companyName: string;
  analysis: UnderwritingAnalysisContext | null;
  detail: CurrentUnderwritingDetail;
  drafts: PublicActionDraft[];
  canSaveDrafts: boolean;
  onEditDraft(draft: PublicActionDraft): void;
}) {
  const article = buildUnderwritingArticleViewModel({ analysis, detail });
  const actionDraftSection = buildActionDraftSection(drafts);
  const namedLens = article.persistedNamedLens;
  if (!namedLens) return null;
  const hasSampleResearchAuthority = Boolean(
    analysis && hasSampleResearchScreeningAuthority(analysis.sources),
  );
  const hasSampleDecisionAuthority = hasCanonicalSampleDecisionAuthority(
    analysis,
  );
  const syntheticDisclosureBadges = [
    ...(hasSampleDecisionAuthority ? [SAMPLE_DECISION_RECORD_BADGE] : []),
    ...(hasSampleResearchAuthority ? [SAMPLE_RESEARCH_SCREENING_BADGE] : []),
    ...(hasDeterministicFixtureOutput(detail)
      ? [DETERMINISTIC_FIXTURE_OUTPUT_BADGE]
      : []),
  ];
  const persistedFormalResult = detail.decision.decision
    ?? detail.decision.decisionCeiling;
  const formalResult = persistedFormalResult
    ? humanize(persistedFormalResult)
    : "Formal decision unavailable";
  const decisionEvidence = resolveFirstScreenDecisionEvidence({
    detail,
    namedLens,
  });
  const firstScreenTension = namedLens.synthesis.branch
      === "principal_disagreement"
    ? namedLens.synthesis.text
    : "No grounded tension was established among the selected public-source framework readings.";

  return (
    <main className="underwriting-memo" aria-label="Underwriting memorandum">
      <header className="underwriting-memo-masthead">
        <span>DEEP UNDERWRITING</span>
        <h1>{companyName}</h1>
        <p>
          {analysis?.dealStatus === "invested"
            ? "Portfolio Risk Re-underwriting Memorandum"
            : "Investment Re-underwriting Memorandum"}
        </p>
      </header>

      <MemoSection number="01" title="Decision Request">
        <div className="underwriting-decision-first">
          <h3>{formalResult}</h3>
          {!persistedFormalResult && (
            <p className="underwriting-decision-boundary">
              The saved evidence does not yet support a formal investment
              decision. The request below is limited to diligence and risk
              control while the missing underwriting inputs are collected.
            </p>
          )}
          <p>{article.decisionAsk.summary}</p>
          {article.decisionAsk.actionLines.length ? (
            <ol>
              {article.decisionAsk.actionLines.map((line) => <li key={line}>{line}</li>)}
            </ol>
          ) : (
            <p>Immediate next action: obtain the persisted missing inputs before reconsidering the formal decision.</p>
          )}
          <div className="underwriting-decision-reasons">
            {decisionEvidence.state === "resolved"
              ? decisionEvidence.reasons.map((item) => (
                <div className="underwriting-decision-reason" key={item.id}>
                  <p>
                    {item.label}: {item.value}{item.unit
                      ? ` ${item.unit}`
                      : ""}.
                  </p>
                  <p className="underwriting-decision-reason-sources">
                    {item.citations.map((citation) =>
                      citation.kind === "original_public_source"
                        ? (
                          <a
                            href={citation.url}
                            target="_blank"
                            rel="noreferrer"
                            key={`original:${citation.url}`}
                          >
                            View original source for {item.label} ↗
                          </a>
                        )
                        : citation.kind === "stored_source_revision"
                        ? (
                          <SourceRevisionLink
                            revisionId={citation.revisionId}
                            page={citation.page ?? undefined}
                            ariaLabel={`Open archived source for ${item.label}`}
                            key={`revision:${citation.revisionId}:${citation.page ?? ""}`}
                          >
                            Open archived source for {item.label} ↗
                          </SourceRevisionLink>
                        )
                        : (
                          <span
                            data-citation-kind="assumption_artifact"
                            key={`assumption:${citation.assumptionId}`}
                          >
                            Persisted assumption · {humanize(
                              citation.provenanceOrigin,
                            )}
                          </span>
                        )
                    )}
                  </p>
                </div>
              ))
              : decisionEvidence.state === "evidence_ceiling"
              ? (
                <p
                  className="underwriting-projection-unavailable"
                  data-evidence-state="decision-ceiling"
                  role="status"
                >
                  A formal investment decision is not supportable yet because
                  required underwriting evidence is incomplete. This is an
                  evidence ceiling, not a negative investment conclusion.
                </p>
              )
              : (
                <p
                  className="underwriting-projection-unavailable"
                  data-integrity-state="unavailable"
                  role="status"
                >
                  Decision evidence unavailable · persisted projection failed integrity checks.
                </p>
              )}
          </div>
          <p>{firstScreenTension}</p>
          <p className="underwriting-draft-notice">
            DRAFT ONLY · decision support; no message is sent or published.
            {syntheticDisclosureBadges.length > 0
              && ` · ${syntheticDisclosureBadges.join(" · ")}`}
          </p>
        </div>
      </MemoSection>

      <MemoSection number="02" title="What Changed">
        <p>{analysis?.marketEvidence.explanation ?? "No current market-change explanation was persisted with this candidate."}</p>
        <p>{article.thenNow.mechanism}</p>
      </MemoSection>

      <MemoSection number="03" title="Company Position">
        <EditorialList
          title="Accepted for this decision"
          values={article.companySnapshot.verifiedFacts.map(readerFact)}
          emptyText="No company fact met the report's decision-use standard."
        />
        <EditorialList
          title="Recorded but not accepted"
          values={article.companySnapshot.unverifiedFacts.map(readerFact)}
          emptyText="No additional unaccepted company fact was recorded."
        />
        <EditorialList
          title="Evidence still needed"
          values={article.companySnapshot.unknownFieldIds.map(
            evidenceFieldLabel,
          )}
          emptyText="No missing company field was recorded."
        />
      </MemoSection>

      <MemoSection number="04" title="Thesis Assessment">
        <p>{detail.narrative}</p>
        {namedLens.synthesis.text !== detail.narrative
            && namedLens.synthesis.text !== firstScreenTension && (
          <p>{namedLens.synthesis.text}</p>
        )}
      </MemoSection>

      <MemoSection number="05" title="Financial and Valuation Status">
        <p>{financialModelBoundary(article.financialCase)}</p>
        <EditorialList
          title="Required Before Valuation"
          values={article.financialCase.requiredBeforeValuation.map(({ requiredEvidence, decisionUse }) =>
            `${requiredEvidence} — ${decisionUse}`
          )}
        />
      </MemoSection>

      <MemoSection number="06" title="Named Lens Readings">
        <p className="underwriting-named-lens-disclosure">
          VSee application of a public-source framework; not the named
          person&apos;s opinion on this company; no endorsement; formal decision
          weight zero. Each reading remains independent, and conflicting
          conclusions are not reconciled.
        </p>
        {namedLens.selectedPassages.length ? namedLens.selectedPassages.map((selected) => (
          <Passage key={selected.passage.fingerprint} selected={selected} />
        )) : (
          <p>No selected advisory perspective was persisted for the main memorandum.</p>
        )}
      </MemoSection>

      <MemoSection number="07" title="Recommendation and Next Steps">
        <CurrentRecommendation
          article={article}
          actionDraftSection={actionDraftSection}
          canSaveDrafts={canSaveDrafts}
          onEditDraft={onEditDraft}
        />
      </MemoSection>

      <AuditAppendix
        detail={detail}
        syntheticDisclosureBadges={syntheticDisclosureBadges}
      />
    </main>
  );
}

function Passage({
  selected,
}: {
  selected: NonNullable<ReturnType<typeof buildUnderwritingArticleViewModel>["persistedNamedLens"]>["selectedPassages"][number];
}) {
  const parsedPassage = NamedLensPassageSchema.safeParse(selected.passage);
  if (!parsedPassage.success) return null;
  const passage = parsedPassage.data;
  const segments = [
    passage.premise.text,
    passage.caseApplication.text,
    passage.countercase.text,
    passage.unknownBoundary.text,
    passage.conditionalConclusion.text,
  ];
  if (!segments.every(isRenderablePassageText)) return null;
  const paragraphs = [
    `${segments[0]} ${segments[1]}`,
    segments[2],
    `${segments[3]} ${segments[4]}`,
  ];
  return (
    <article className="underwriting-passage">
      <h3>{selected.displayIdentity.displayName}</h3>
      <p className="underwriting-passage-attribution">
        {selected.displayIdentity.attributionDisplay}
      </p>
      {paragraphs.map((text, index) => <p key={`${passage.fingerprint}:${index}`}>{text}</p>)}
      <p className="underwriting-passage-sources">
        {selected.publicPremiseSources.map((source) => (
          <a href={source.url} target="_blank" rel="noreferrer" key={source.sourceId}>
            Source: {source.title} — {source.publisher} ↗
          </a>
        ))}
      </p>
    </article>
  );
}

function AuditAppendix({
  detail,
  syntheticDisclosureBadges,
}: {
  detail: CurrentUnderwritingDetail;
  syntheticDisclosureBadges: readonly string[];
}) {
  const namedLens = detail.namedLensPresentation;
  return (
    <details className="underwriting-audit-appendix">
      <summary>Audit Appendix</summary>
      <div>
        <h2>Audit Appendix</h2>
        <p>DRAFT ONLY. {syntheticDisclosureBadges.length > 0
          ? `${syntheticDisclosureBadges.join(" · ")}.`
          : "Persisted candidate artifacts only."}</p>
        <h3>Additional Named Lens perspectives</h3>
        {namedLens.appendixPassages.map((selected) => <Passage key={selected.passage.fingerprint} selected={selected} />)}
        {namedLens.withheldDispositions.length ? (
          <ul>{namedLens.withheldDispositions.map((disposition) => (
            <li key={disposition.fingerprint}>
              {disposition.disposition}: {disposition.reasonCodes.join(", ")}
            </li>
          ))}</ul>
        ) : <p>No abstained, unavailable, duplicate, withheld, or context-inapplicable perspective was persisted.</p>}

        <h3>Persisted framework judgments and dispositions</h3>
        <table>
          <thead><tr><th>Judgment</th><th>Applicability</th><th>Conclusion</th><th>Disposition reasons</th></tr></thead>
          <tbody>{detail.auditAppendix.judgments.map((judgment) => {
            const disposition = namedLens.dispositions.find(({ judgmentId }) =>
              judgmentId === judgment.id
            );
            return <tr key={judgment.id}>
              <td>{judgment.id} · {judgment.frameworkCardId} · {judgment.frameworkVersion}</td>
              <td>{judgment.applicability}</td>
              <td>{judgment.conclusion}</td>
              <td>{disposition
                ? `${disposition.disposition}: ${disposition.reasonCodes.join(", ")}`
                : "No Named Lens disposition persisted"}</td>
            </tr>;
          })}</tbody>
        </table>

        <h3>Complete Named Lens artifact records</h3>
        <AuditRecords label="Framework judgments" values={detail.auditAppendix.judgments} />
        <AuditRecords label="Version snapshot" values={[detail.versionSnapshot]} />
        <AuditRecords label="Named Lens presentation identities" values={[
          namedLensAuditIdentityRecord(namedLens),
        ]} />
        <AuditRecords label="Dispositions" values={namedLens.dispositions} />
        <AuditRecords label="Catalog considerations" values={detail.auditAppendix.catalogConsiderations} />
        <AuditRecords label="Provider attempts" values={detail.auditAppendix.providerAttempts} />
        <AuditRecords label="Provider attempt references" values={detail.auditAppendix.providerAttemptRefs} />

        <h3>Complete scenario input matrix</h3>
        <table>
          <thead><tr><th>Scenario</th><th>Input</th><th>Value</th><th>Reason</th></tr></thead>
          <tbody>{detail.scenarioModel.scenarios.flatMap(({ name, inputs }) => inputs.map((input) => (
            <tr key={input.id} data-scenario-input={input.id}>
              <td>{name}</td><td>{input.field}</td><td>{input.value ?? "Unavailable"}</td><td>{input.unavailableReason ?? "Persisted"}</td>
            </tr>
          )))}</tbody>
        </table>

        <h3>Evidence and XTrace lineage</h3>
        {detail.claimEdges.length ? (
          <ul>{detail.claimEdges.map((edge) => (
            <li key={`${edge.claimItemId}:${edge.dependencyItemId}`}>
              {edge.claimItemId} → {edge.dependencyType} → {edge.dependencyItemId}
            </li>
          ))}</ul>
        ) : <p>No persisted claim-edge lineage is available.</p>}

        <h3>Raw identities and versions</h3>
        <dl className="underwriting-audit-identities">
          <div><dt>Candidate run</dt><dd>{detail.candidateRunId}</dd></div>
          <div><dt>Source candidate run</dt><dd>{detail.sourceCandidateRunId}</dd></div>
          <div><dt>Presentation report</dt><dd>{namedLens.reportId}</dd></div>
          <div><dt>Presentation schema</dt><dd>{namedLens.schemaVersion}</dd></div>
          <div><dt>Presentation fingerprint</dt><dd>{namedLens.fingerprint}</dd></div>
          <div><dt>Renderer version</dt><dd>{namedLens.rendererVersion}</dd></div>
          <div><dt>Terminal status</dt><dd>{namedLens.terminalStatus}</dd></div>
          <div><dt>Terminal reasons</dt><dd>{namedLens.terminalReasonCodes.join(", ")}</dd></div>
          <div><dt>Provider model</dt><dd>{detail.versionSnapshot.providerModel}</dd></div>
          <div><dt>Provider attempt references</dt><dd>{detail.auditAppendix.providerAttemptRefs.map(({ attemptFingerprint }) => attemptFingerprint).join(", ") || "None"}</dd></div>
          <div><dt>Catalog considerations</dt><dd>{detail.auditAppendix.catalogConsiderations.map(({ fingerprint }) => fingerprint).join(", ") || "None"}</dd></div>
          <div><dt>Decision-critical evidence</dt><dd>{namedLens.decisionCriticalEvidenceProjection.evidenceRefs.map(({ evidencePackItemId, resolutionPath }) => `${evidencePackItemId} → ${resolutionPath.join(" → ")}`).join("; ") || "None"}</dd></div>
          <div><dt>Version identity</dt><dd>{Object.entries(namedLens.versionIdentity).map(([key, value]) => `${key}: ${value ?? "null"}`).join("; ")}</dd></div>
          <div><dt>Source revisions</dt><dd>{detail.sourceRevisionIds.join(", ")}</dd></div>
          <div><dt>Framework judgments</dt><dd>{detail.auditAppendix.judgments.map(({ id }) => id).join(", ")}</dd></div>
          <div><dt>Dispositions</dt><dd>{namedLens.dispositions.map(({ fingerprint }) => fingerprint).join(", ")}</dd></div>
        </dl>
      </div>
    </details>
  );
}

function AuditRecords({ label, values }: { label: string; values: unknown[] }) {
  return <section className="underwriting-audit-records">
    <h4>{label}</h4>
    {values.length ? values.map((value, index) => (
      <pre key={`${label}:${index}`}>{JSON.stringify(value, null, 2)}</pre>
    )) : <p>No persisted {label.toLowerCase()}.</p>}
  </section>;
}

function MemoSection({ number, title, children }: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  const id = `underwriting-section-${number}`;
  return <section className="underwriting-memo-section" aria-labelledby={id}>
    <header><span>{number}</span><h2 id={id}>{title}</h2></header>
    <div>{children}</div>
  </section>;
}

function EditorialList({
  title,
  values,
  emptyText = "No supported information was recorded.",
}: {
  title: string;
  values: string[];
  emptyText?: string;
}) {
  return <section className="underwriting-editorial-list">
    <h3>{title}</h3>
    {values.length
      ? <ul>{values.map((value) => <li key={value}>{value}</li>)}</ul>
      : <p>{emptyText}</p>}
  </section>;
}

function CurrentRecommendation({
  article,
  actionDraftSection,
  canSaveDrafts,
  onEditDraft,
}: {
  article: ReturnType<typeof buildUnderwritingArticleViewModel>;
  actionDraftSection: ReturnType<typeof buildActionDraftSection>;
  canSaveDrafts: boolean;
  onEditDraft(draft: PublicActionDraft): void;
}) {
  const draftEvidence = new Map(
    actionDraftSection.missingEvidence.map((item) => [item.fieldId, item]),
  );
  const diligence = new Map<string, {
    label: string;
    impact: string;
    unblocks: string | null;
    settlesDisagreement: boolean;
  }>();
  for (const item of article.diligence.items) {
    const draftItem = draftEvidence.get(item.fieldId);
    diligence.set(item.fieldId, {
      label: draftItem?.externalLabel || draftItem?.label
        || evidenceFieldLabel(item.fieldId),
      impact: draftItem?.mostLikelyDecisionImpact
        || "Resolving this gap may raise or lower the current decision ceiling.",
      unblocks: item.unblocks,
      settlesDisagreement: item.settlesDisagreement !== null,
    });
  }
  for (const item of actionDraftSection.missingEvidence) {
    if (diligence.has(item.fieldId)) continue;
    diligence.set(item.fieldId, {
      label: item.externalLabel || item.label || evidenceFieldLabel(item.fieldId),
      impact: item.mostLikelyDecisionImpact,
      unblocks: null,
      settlesDisagreement: false,
    });
  }
  const diligenceItems = [...diligence.values()];

  return <div className="underwriting-next-steps">
    <h3>Decision-relevant diligence</h3>
    <p>
      Collect the evidence that can change the decision boundary before asking
      the investment committee for a formal investment decision or supported
      valuation.
    </p>
    {actionDraftSection.conflictingFieldIds.length > 0 && (
      <p className="underwriting-diligence-warning" role="alert">
        Some persisted drafts describe the same evidence request differently.
        Review their audit records before using either version.
      </p>
    )}
    {diligenceItems.length ? (
      <ol className="underwriting-diligence-list">
        {diligenceItems.map((item) => <li key={item.label}>
          <strong>{item.label}</strong>
          <p>{item.impact}</p>
          {item.settlesDisagreement && (
            <p>This evidence would help resolve the principal framework disagreement.</p>
          )}
          {item.unblocks && <p>{item.unblocks}</p>}
        </li>)}
      </ol>
    ) : (
      <p>No additional decision-changing evidence request was persisted.</p>
    )}

    <h3>Action drafts</h3>
    <p className="underwriting-draft-notice">
      DRAFT ONLY — NOT SENT OR PUBLISHED. Opening or editing a draft does not
      deliver it.
    </p>
    {!canSaveDrafts && actionDraftSection.drafts.length > 0 && (
      <p className="underwriting-readonly-note" role="status">
        Draft editing is disabled in this read-only view.
      </p>
    )}
    {actionDraftSection.drafts.length ? (
      <div className="underwriting-action-drafts">
        {actionDraftSection.drafts.map(({ draft, title }) => (
          <details className="underwriting-action-draft" key={draft.id}>
            <summary aria-label={`Read full ${title} draft`}>
              Read {title} draft
            </summary>
            <div>
              <pre className="underwriting-action-draft-body">{draft.body}</pre>
              {canSaveDrafts && (
                <button
                  type="button"
                  aria-label={`Edit ${title} draft`}
                  onClick={() => onEditDraft(draft)}
                >
                  Edit draft
                </button>
              )}
            </div>
          </details>
        ))}
      </div>
    ) : (
      <p>No action draft was finalized for this recommendation.</p>
    )}
  </div>;
}

function financialModelBoundary(
  financialCase: ReturnType<typeof buildUnderwritingArticleViewModel>["financialCase"],
): string {
  if (financialCase.unavailableInputCount === 0) {
    return "The saved inputs support a complete Bear, Base, and Bull scenario model.";
  }
  if (financialCase.unavailableInputCount === financialCase.totalInputCount) {
    return `The saved evidence cannot support a Bear, Base, and Bull valuation model: all ${financialCase.totalInputCount} required inputs are missing.`;
  }
  return `${financialCase.unavailableInputCount} of ${financialCase.totalInputCount} inputs needed for the Bear, Base, and Bull valuation model are still missing.`;
}

function readerFact(value: string): string {
  return value.replace(/ · [^·]+$/u, "");
}

function evidenceFieldLabel(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized === "arr" || normalized === "arr_path") {
    return "Annual recurring revenue (ARR)";
  }
  if (normalized === "burn") return "Monthly cash burn";
  if (normalized === "runway") return "Cash runway";
  return humanize(value);
}

function isRenderablePassageText(value: string): boolean {
  return Boolean(value.trim() && !value.includes("\u0000"));
}

type DecisionEvidenceCitation = {
  kind: "original_public_source";
  url: string;
} | {
  kind: "stored_source_revision";
  revisionId: string;
  page: number | null;
} | {
  kind: "assumption_artifact";
  assumptionId: string;
  provenanceOrigin: string;
};

type ResolvedDecisionEvidence = {
  id: string;
  label: string;
  value: string;
  unit: string | null;
  citations: DecisionEvidenceCitation[];
};

type SelectedNamedLensPassage =
  CurrentUnderwritingDetail["namedLensPresentation"]["selectedPassages"][number];

function resolveFirstScreenDecisionEvidence({
  detail,
  namedLens,
}: {
  detail: CurrentUnderwritingDetail;
  namedLens: CurrentUnderwritingDetail["namedLensPresentation"];
}): {
  state: "resolved";
  reasons: ResolvedDecisionEvidence[];
} | {
  state: "evidence_ceiling";
} | {
  state: "unavailable";
} {
  const ids = namedLens.firstScreenProjectionRefs.decisionEvidenceItemIds;
  if (
    namedLens.firstScreenProjectionRefs.decisionId !== detail.decision.id
    || !DecisionCriticalEvidenceProjectionSchema.safeParse(
      namedLens.decisionCriticalEvidenceProjection,
    ).success
  ) return { state: "unavailable" };
  if (ids.length === 0) {
    return detail.decision.decision === null
        && detail.decision.decisionCeiling === null
        && !detail.evidencePack.coverage.criticalEvidenceComplete
      ? { state: "evidence_ceiling" }
      : { state: "unavailable" };
  }
  if (
    ids.length < 2
    || ids.length > 3
    || new Set(ids).size !== ids.length
  ) return { state: "unavailable" };

  const projectionRefs = new Map(
    namedLens.decisionCriticalEvidenceProjection.evidenceRefs.map((reference) =>
      [reference.evidencePackItemId, reference] as const
    ),
  );
  if (
    projectionRefs.size
      !== namedLens.decisionCriticalEvidenceProjection.evidenceRefs.length
  ) return { state: "unavailable" };

  const reasons: ResolvedDecisionEvidence[] = [];
  for (const id of ids) {
    const projectionRef = projectionRefs.get(id);
    const facts = detail.evidencePack.facts.filter((item) => item.id === id);
    const assumptions = detail.evidencePack.assumptions.filter((item) =>
      item.id === id
    );
    if (
      !projectionRef
      || facts.length + assumptions.length !== 1
      || (projectionRef.classification === "fact"
        ? facts.length !== 1
        : projectionRef.classification === "assumption"
        ? assumptions.length !== 1
        : true)
    ) return { state: "unavailable" };

    if (facts.length === 1) {
      const fact = facts[0]!;
      const citations = citationsForFact(detail, fact);
      if (!citations.length) return { state: "unavailable" };
      reasons.push({
        id,
        label: humanize(fact.field),
        value: fact.value,
        unit: fact.unit,
        citations,
      });
      continue;
    }

    const assumption = assumptions[0]!;
    const citations = citationsForAssumption({
      detail,
      assumption,
      projectionRef,
    });
    if (!citations.length) return { state: "unavailable" };
    reasons.push({
      id,
      label: humanize(assumption.field),
      value: assumption.value,
      unit: assumption.unit,
      citations,
    });
  }
  return { state: "resolved", reasons };
}

function citationsForFact(
  detail: CurrentUnderwritingDetail,
  fact: CurrentUnderwritingDetail["evidencePack"]["facts"][number],
): DecisionEvidenceCitation[] {
  if (!isPersistedSourceRevision(detail, fact.sourceRevisionId)) return [];
  return [
    ...(fact.sourceAction.kind === "original_public_source"
      ? [{
        kind: "original_public_source" as const,
        url: fact.sourceAction.url,
      }]
      : []),
    {
      kind: "stored_source_revision",
      revisionId: fact.sourceRevisionId,
      page: fact.sourceAction.kind === "stored_source_revision"
        ? fact.sourceAction.page
        : null,
    },
  ];
}

function citationsForAssumption({
  detail,
  assumption,
  projectionRef,
}: {
  detail: CurrentUnderwritingDetail;
  assumption: CurrentUnderwritingDetail["evidencePack"]["assumptions"][number];
  projectionRef: CurrentUnderwritingDetail["namedLensPresentation"]["decisionCriticalEvidenceProjection"]["evidenceRefs"][number];
}): DecisionEvidenceCitation[] {
  const citations = new Map<string, DecisionEvidenceCitation>([[
    `assumption:${assumption.id}`,
    {
      kind: "assumption_artifact",
      assumptionId: assumption.id,
      provenanceOrigin: assumption.provenanceOrigin,
    },
  ]]);
  const addRevision = (revisionId: string, page: number | null = null) => {
    if (isPersistedSourceRevision(detail, revisionId)) {
      citations.set(`revision:${revisionId}:${page ?? ""}`, {
        kind: "stored_source_revision",
        revisionId,
        page,
      });
    }
  };
  const addFactLineage = (itemId: string) => {
    const linkedFacts = detail.evidencePack.facts.filter((fact) =>
      fact.id === itemId
    );
    if (linkedFacts.length !== 1) return;
    for (const citation of citationsForFact(detail, linkedFacts[0]!)) {
      if (citation.kind === "assumption_artifact") continue;
      const key = citation.kind === "original_public_source"
        ? `original:${citation.url}`
        : `revision:${citation.revisionId}:${citation.page ?? ""}`;
      citations.set(key, citation);
    }
  };

  for (const origin of projectionRef.originRefs) {
    if (origin.kind === "source_revision") addRevision(origin.id);
    addFactLineage(origin.id);
  }
  for (const reference of [
    ...assumption.inputRefIds,
    ...projectionRef.resolutionPath,
  ]) {
    addRevision(reference);
    addFactLineage(reference);
  }
  return [...citations.values()];
}

function namedLensAuditIdentityRecord(
  namedLens: CurrentUnderwritingDetail["namedLensPresentation"],
) {
  const passageIdentity = (
    selected: SelectedNamedLensPassage,
  ) => ({
    selectedPosition: selected.selectedPosition,
    disposition: selected.disposition,
    displayIdentity: selected.displayIdentity,
    passage: {
      ...selected.passage,
      premise: withoutPassageText(selected.passage.premise),
      caseApplication: withoutPassageText(selected.passage.caseApplication),
      countercase: withoutPassageText(selected.passage.countercase),
      unknownBoundary: withoutPassageText(selected.passage.unknownBoundary),
      conditionalConclusion: withoutPassageText(
        selected.passage.conditionalConclusion,
      ),
    },
    segmentCitations: selected.segmentCitations,
    publicPremiseSources: selected.publicPremiseSources,
  });
  return {
    reportId: namedLens.reportId,
    schemaVersion: namedLens.schemaVersion,
    rendererVersion: namedLens.rendererVersion,
    fingerprint: namedLens.fingerprint,
    terminalStatus: namedLens.terminalStatus,
    terminalReasonCodes: namedLens.terminalReasonCodes,
    versionIdentity: namedLens.versionIdentity,
    decisionCriticalEvidenceProjection:
      namedLens.decisionCriticalEvidenceProjection,
    dispositions: namedLens.dispositions,
    selectedPassages: namedLens.selectedPassages.map(passageIdentity),
    appendixPassages: namedLens.appendixPassages.map(passageIdentity),
    withheldDispositions: namedLens.withheldDispositions,
    synthesis: namedLens.synthesis,
    segmentCitations: namedLens.segmentCitations,
    firstScreenProjectionRefs: namedLens.firstScreenProjectionRefs,
  };
}

function withoutPassageText<T extends { text: string }>(
  segment: T,
): Omit<T, "text"> {
  const { text, ...identity } = segment;
  void text;
  return identity;
}

function isPersistedSourceRevision(
  detail: CurrentUnderwritingDetail,
  revisionId: string,
): boolean {
  return detail.sourceRevisionIds.includes(revisionId)
    && detail.evidencePack.sourceRevisionIds.includes(revisionId);
}

function hasDeterministicFixtureOutput(
  detail: CurrentUnderwritingDetail,
): boolean {
  return DETERMINISTIC_FIXTURE_PROVIDER_MODELS.has(
    detail.versionSnapshot.providerModel,
  );
}

function hasCanonicalSampleDecisionAuthority(
  analysis: UnderwritingAnalysisContext | null,
): boolean {
  if (!analysis) return false;
  const fixtureIds = analysis.investmentMemory.fixtureIds;
  if (
    fixtureIds.length === 0
    || new Set(fixtureIds).size !== fixtureIds.length
  ) return false;

  const canonicalSampleIds = new Set(analysis.sources.flatMap((source) =>
    "schemaVersion" in source
      && source.adaptation === "canonical"
      && source.provenance === "demo_fixture"
      ? [source.id]
      : []
  ));
  return canonicalSampleIds.size === fixtureIds.length
    && fixtureIds.every((fixtureId) => canonicalSampleIds.has(fixtureId));
}

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
