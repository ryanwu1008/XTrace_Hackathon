import type { UnderwritingAnalysisContext } from "./underwriting-detail";
import { buildUnderwritingArticleViewModel } from "./underwriting-article-view-model";
import type { VersionedCandidateUnderwritingDetail } from
  "../lib/underwriting/read-model";
import {
  hasSampleResearchScreeningAuthority,
  SAMPLE_RESEARCH_SCREENING_BADGE,
} from "../lib/belief-reversal/sample-research-screening-authority";

type CurrentUnderwritingDetail = Extract<
  VersionedCandidateUnderwritingDetail,
  { presentationAdapter: { kind: "current" } }
>;

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
}: {
  companyName: string;
  analysis: UnderwritingAnalysisContext | null;
  detail: CurrentUnderwritingDetail;
}) {
  const article = buildUnderwritingArticleViewModel({ analysis, detail });
  const namedLens = article.persistedNamedLens;
  if (!namedLens) return null;
  const hasSampleResearchAuthority = Boolean(
    analysis && hasSampleResearchScreeningAuthority(analysis.sources),
  );
  const isSynthetic = /synthetic|sample/i.test(detail.versionSnapshot.providerModel)
    || hasSampleResearchAuthority;
  const formalResult = detail.decision.decision
    ?? detail.decision.decisionCeiling
    ?? "Formal decision unavailable";
  const decisionEvidence = namedLens.decisionCriticalEvidenceProjection
    .evidenceRefs.map(({ evidencePackItemId }) =>
      detail.evidencePack.facts.find(({ id }) => id === evidencePackItemId)
    )
    .filter((fact): fact is typeof detail.evidencePack.facts[number] =>
      fact !== undefined
    );

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
          <p className="underwriting-status">
            Underwriting Status · {humanize(detail.evidencePack.coverage.underwritingStatus)}
          </p>
          <h3>{formalResult}</h3>
          <p>{article.decisionAsk.summary}</p>
          {article.decisionAsk.actionLines.length ? (
            <ol>
              {article.decisionAsk.actionLines.map((line) => <li key={line}>{line}</li>)}
            </ol>
          ) : (
            <p>Immediate next action: obtain the persisted missing inputs before reconsidering the formal decision.</p>
          )}
          <div className="underwriting-decision-reasons">
            {decisionEvidence.slice(0, 3).map((fact) => (
              <p key={fact.id}>
                {humanize(fact.field)}: {fact.value}{fact.unit ? ` ${fact.unit}` : ""}.
              </p>
            ))}
            {!decisionEvidence.length && (
              <p>No decision-critical evidence item was persisted for the first-screen summary.</p>
            )}
          </div>
          <p>
            {namedLens.synthesis.branch === "principal_disagreement"
              ? namedLens.synthesis.text
              : "No grounded tension was persisted in the selected Named Lens readings."}
          </p>
          <p className="underwriting-draft-notice">
            DRAFT ONLY · decision support; no message is sent or published.
            {isSynthetic && ` · ${SAMPLE_RESEARCH_SCREENING_BADGE}`}
          </p>
        </div>
      </MemoSection>

      <MemoSection number="02" title="What Changed">
        <p>{analysis?.marketEvidence.explanation ?? "No current market-change explanation was persisted with this candidate."}</p>
        <p>{article.thenNow.mechanism}</p>
      </MemoSection>

      <MemoSection number="03" title="Company Position">
        <EditorialList title="Accepted for this decision" values={article.companySnapshot.verifiedFacts} />
        <EditorialList title="Recorded but not accepted" values={article.companySnapshot.unverifiedFacts} />
        <EditorialList title="Not available at all" values={article.companySnapshot.unknownFieldIds} />
      </MemoSection>

      <MemoSection number="04" title="Thesis Assessment">
        <p>{detail.narrative}</p>
        <p>{namedLens.synthesis.text}</p>
      </MemoSection>

      <MemoSection number="05" title="Financial and Valuation Status">
        <p>
          Current modeling status: {article.financialCase.unavailableInputCount} of {article.financialCase.totalInputCount} required scenario inputs are unavailable.
        </p>
        <EditorialList
          title="Required Before Valuation"
          values={article.financialCase.requiredBeforeValuation.map(({ requiredEvidence, decisionUse }) =>
            `${requiredEvidence} — ${decisionUse}`
          )}
        />
      </MemoSection>

      <MemoSection number="06" title="Named Lens Readings">
        <p className="underwriting-named-lens-disclosure">
          Named Lens readings are advisory only and have formal decision weight zero.
        </p>
        {namedLens.selectedPassages.length ? namedLens.selectedPassages.map((selected) => (
          <Passage key={selected.passage.fingerprint} selected={selected} />
        )) : (
          <p>No selected advisory perspective was persisted for the main memorandum.</p>
        )}
      </MemoSection>

      <MemoSection number="07" title="Recommendation and Next Steps">
        <p>{article.finalPosition.nextAction === "Unavailable"
          ? "Immediate next action: obtain the missing inputs recorded in the audit appendix."
          : `Immediate next action: ${humanize(article.finalPosition.nextAction)}.`}</p>
        <p>Formal decision: {formalResult}. Confidence: {humanize(detail.decision.confidence)}.</p>
      </MemoSection>

      <AuditAppendix detail={detail} />
    </main>
  );
}

function Passage({
  selected,
}: {
  selected: NonNullable<ReturnType<typeof buildUnderwritingArticleViewModel>["persistedNamedLens"]>["selectedPassages"][number];
}) {
  const { passage } = selected;
  const segments = [
    passage.premise.text,
    passage.caseApplication.text,
    passage.countercase.text,
    passage.unknownBoundary.text,
    passage.conditionalConclusion.text,
  ].filter(isRenderablePassageText);
  return (
    <article className="underwriting-passage">
      <h3>{selected.displayIdentity.displayName}</h3>
      {segments.map((text, index) => <p key={`${passage.fingerprint}:${index}`}>{text}</p>)}
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

function AuditAppendix({ detail }: { detail: CurrentUnderwritingDetail }) {
  const namedLens = detail.namedLensPresentation;
  return (
    <details className="underwriting-audit-appendix">
      <summary>Audit Appendix</summary>
      <div>
        <h2>Audit Appendix</h2>
        <p>DRAFT ONLY. {isSyntheticProvider(detail) ? "SYNTHETIC / SAMPLE RESEARCH-ONLY." : "Persisted candidate artifacts only."}</p>
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
          <div><dt>Presentation fingerprint</dt><dd>{namedLens.fingerprint}</dd></div>
          <div><dt>Renderer version</dt><dd>{namedLens.rendererVersion}</dd></div>
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

function EditorialList({ title, values }: { title: string; values: string[] }) {
  return <section className="underwriting-editorial-list">
    <h3>{title}</h3>
    {values.length ? <ul>{values.map((value) => <li key={value}>{value}</li>)}</ul> : <p>Unavailable.</p>}
  </section>;
}

function isRenderablePassageText(value: string): boolean {
  return Boolean(value.trim() && !value.includes("\u0000"));
}

function isSyntheticProvider(detail: CurrentUnderwritingDetail): boolean {
  return /synthetic|sample/i.test(detail.versionSnapshot.providerModel);
}

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
