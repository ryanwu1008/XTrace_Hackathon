"use client";

import { useEffect, useRef } from "react";

import type { CompanyAnalysis } from "../lib/contracts/domain";
import type { ReportEvidenceContext } from "../lib/contracts/evidence-context";
import type {
  CandidateUnderwritingDetail,
  PublicActionDraft,
} from "../lib/underwriting/read-model";
import { SourceRevisionLink } from "./source-revision-link";
import { formatTemporalForDisplay } from "../lib/format/temporal";
import { safeExternalHttpUrl } from "../lib/security/safe-url";
import {
  financialCalculationLineage,
  lineageForClaim,
  versionRows,
} from "./underwriting-view-model";
import { buildAnalystPanel } from "./analyst-panel-view-model";
import { buildUnderwritingArticleViewModel } from "./underwriting-article-view-model";
import {
  hasSampleResearchScreeningAuthority,
  SAMPLE_RESEARCH_SCREENING_BADGE,
} from "../lib/belief-reversal/sample-research-screening-authority";

/** @deprecated Import CandidateUnderwritingDetail from the read model. */
export type CandidateUnderwritingDetailDto = CandidateUnderwritingDetail;

export interface UnderwritingAnalysisContext {
  companyName: string;
  dealStatus: string;
  confidence: string;
  marketEvidence: {
    relationship: string;
    explanation: string;
    events: CompanyAnalysis["marketEvidence"]["events"];
  };
  implications: {
    positive: string[];
    negative: string[];
  };
  investmentMemory: Pick<
    CompanyAnalysis["investmentMemory"],
    "previousMeetingSummary" | "decisionReason" | "fixtureIds"
  >;
  sources: CompanyAnalysis["sources"];
  beliefAssessment?: Pick<
    NonNullable<CompanyAnalysis["beliefAssessment"]>,
    "direction" | "actions"
  >;
}

export function UnderwritingDetailDialog({
  open,
  companyName,
  analysis,
  detail,
  drafts,
  evidenceContext,
  canSaveDrafts,
  onClose,
  onEditDraft,
}: {
  open: boolean;
  companyName: string;
  analysis: UnderwritingAnalysisContext | null;
  detail: CandidateUnderwritingDetail | null;
  drafts: PublicActionDraft[];
  evidenceContext?: ReportEvidenceContext;
  canSaveDrafts: boolean;
  onClose(): void;
  onEditDraft(draft: PublicActionDraft): void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      className="vsee-underwriting-dialog"
      ref={dialogRef}
      aria-labelledby="underwriting-detail-title"
      onClose={onClose}
    >
      <div className="vsee-underwriting-dialog-card">
        <header>
          <div>
            <span className="vsee-eyebrow">AUDITABLE CANDIDATE DETAIL</span>
            <h2 id="underwriting-detail-title">{companyName}</h2>
          </div>
          <button onClick={onClose} aria-label="Close underwriting detail">
            ×
          </button>
        </header>
        {detail ? (
          <UnderwritingDetailPanel
            companyName={companyName}
            analysis={analysis}
            detail={detail}
            drafts={drafts}
            evidenceContext={evidenceContext}
            canSaveDrafts={canSaveDrafts}
            onEditDraft={onEditDraft}
          />
        ) : (
          <p className="vsee-underwriting-loading" role="status">
            Loading finalized underwriting artifacts…
          </p>
        )}
      </div>
    </dialog>
  );
}

export function UnderwritingDetailPanel({
  companyName,
  analysis,
  detail,
  drafts,
  evidenceContext,
  canSaveDrafts,
  onEditDraft,
}: {
  companyName: string;
  analysis: UnderwritingAnalysisContext | null;
  detail: CandidateUnderwritingDetail;
  drafts: PublicActionDraft[];
  evidenceContext?: ReportEvidenceContext;
  canSaveDrafts: boolean;
  onEditDraft(draft: PublicActionDraft): void;
}) {
  const acceptedAskFacts = detail.evidencePack.facts.filter((fact) =>
    fact.field === "reported_valuation"
    && fact.acceptedForGate
    && fact.value === detail.valuation.currentAsk
  );
  const factForAsk = acceptedAskFacts.length === 1
    ? acceptedAskFacts[0]
    : undefined;
  const capitalFlowFact = detail.evidencePack.facts.find((fact) =>
    /capital.*flow|funding.*flow/.test(fact.field)
  );
  const analystPanel = buildAnalystPanel(detail.judgments);
  const article = buildUnderwritingArticleViewModel({ analysis, detail });

  return (
    <div className="vsee-underwriting-detail">
      <EvidenceContextNotice context={evidenceContext} />
      <DetailSection number="01" title="Executive Investment Snapshot">
        <ExecutiveDecisionMemo analysis={analysis} detail={detail} />
        <Definition label="IC Decision Ask" value={article.decisionAsk} />
      </DetailSection>

      <DetailSection number="02" title="What Changed?">
        <div className="vsee-detail-meta">
          <span>14-DAY EVENT WINDOW</span>
          <b>{detail.evidencePack.asOfDate}</b>
          <span>{analysis?.confidence ?? "Persisted"} confidence</span>
        </div>
        {analysis?.marketEvidence.events.length ? (
          <div className="vsee-underwriting-events">
            {analysis.marketEvidence.events.map((event) => (
              <article key={event.id}>
                <span>{humanize(event.eventType)}</span>
                <h4>{event.title}</h4>
                <time>
                  {event.publishedAt
                    ? formatDate(event.publishedAt)
                    : "Publication date unknown"}
                </time>
                <footer>
                  {("schemaVersion" in event
                    ? event.sources.map((source) => source.id)
                    : event.sourceIds).map((sourceId) => {
                    const source = analysis.sources.find(
                      (candidate) => candidate.id === sourceId,
                    );
                    return source
                      ? <AnalysisSourceLink source={source} key={source.id} />
                      : <span key={sourceId}>{sourceId}</span>;
                  })}
                </footer>
              </article>
            ))}
          </div>
        ) : (
          <Unavailable copy="No finalized 14-day event is attached to this candidate." />
        )}
        <div className="vsee-capital-flow">
          <LineageValue
            label="Capital flow"
            value={capitalFlowFact?.value ?? null}
            display={capitalFlowFact
              ? `${capitalFlowFact.value}${
                  capitalFlowFact.unit ? ` ${capitalFlowFact.unit}` : ""
                }`
              : "Unavailable — no structured capital-flow Fact was persisted"}
            lineage={capitalFlowFact
              ? { kind: "Fact", itemId: capitalFlowFact.id }
              : null}
            detail={detail}
          />
        </div>
        <div className="vsee-then-now">
          <article>
            <span>THEN / PRIOR BELIEF</span>
            <p>{article.thenNow.then}</p>
          </article>
          <article>
            <span>NOW / NEW EVIDENCE</span>
            <p>{article.thenNow.now}</p>
          </article>
          <article>
            <span>BELIEF-CHANGE MECHANISM</span>
            <p>{article.thenNow.mechanism}</p>
          </article>
        </div>
        <h4>Evidence</h4>
        {detail.evidencePack.facts.length ? (
          <div className="vsee-evidence-ledger">
            {detail.evidencePack.facts.map((fact) => (
              <article key={fact.id}>
                <span>Fact</span>
                <strong>{humanize(fact.field)}</strong>
                <p>{fact.value}{fact.unit ? ` ${fact.unit}` : ""}</p>
                <small>
                  {humanize(fact.provenanceOrigin)} · {fact.assertionStatus}
                  {" · "}{fact.freshness} ·{" "}
                  {formatDate(
                    fact.publishedAt ?? fact.eventAt ?? fact.retrievedAt,
                  )}
                </small>
                <SourceRevisionLink revisionId={fact.sourceRevisionId} />
              </article>
            ))}
          </div>
        ) : (
          <Unavailable copy="No persisted Evidence Pack Facts are available." />
        )}
      </DetailSection>

      <DetailSection number="03" title="Verified Company Snapshot">
        <div className="vsee-snapshot-grid">
          <ListBlock
            title="Verified / gate-accepted facts"
            values={article.companySnapshot.verifiedFacts}
          />
          <ListBlock
            title="Reported or unverified facts"
            values={article.companySnapshot.unverifiedFacts}
          />
          <ListBlock
            title="Unknown / missing evidence"
            values={article.companySnapshot.unknownFieldIds}
          />
        </div>
        <p>
          This snapshot classifies persisted evidence; it does not upgrade a
          reported value into a verified fact.
        </p>
      </DetailSection>

      <DetailSection number="04" title="Company and Market Assessment">
        <p>{analysis?.marketEvidence.explanation ?? detail.narrative}</p>
        <div className="vsee-impact-grid">
          <ListBlock
            title="Positive mechanism"
            values={analysis?.implications.positive ?? []}
          />
          <ListBlock
            title="Negative mechanism"
            values={analysis?.implications.negative ?? []}
          />
          <ListBlock
            title="Horizon"
            values={["Unavailable — no impact horizon was persisted"]}
          />
        </div>
        <h4>Changed assumptions</h4>
        {detail.evidencePack.assumptions.length ? (
          <div className="vsee-assumption-list">
            {detail.evidencePack.assumptions.map((assumption) => (
              <article key={assumption.id}>
                <span>Assumption · {assumption.scenario}</span>
                <strong>{humanize(assumption.field)}</strong>
                <p>
                  {assumption.value}{assumption.unit
                    ? ` ${assumption.unit}`
                    : ""}
                </p>
                <small>{assumption.rationale}</small>
                <small>
                  Persisted input references ·{" "}
                  {assumption.inputRefIds.length
                    ? assumption.inputRefIds.join(" · ")
                    : "None"}
                </small>
              </article>
            ))}
          </div>
        ) : <Unavailable copy="No changed assumptions were persisted." />}
        <EvidenceCoveragePanel detail={detail} />
        <EvidenceConflictsPanel detail={detail} />
        <h4>Deal Memory · Then vs Now</h4>
        {!!analysis?.investmentMemory.fixtureIds.length && (
          <aside className="vsee-sample-decision-record" role="note">
            <strong>Sample decision record · synthetic demo history</strong>
            <p>
              The prior context and decision below are simulated product-demo
              records, not a real VC meeting or investment interaction.
            </p>
            <small>
              Fixture lineage · {analysis.investmentMemory.fixtureIds.join(" · ")}
            </small>
          </aside>
        )}
        {analysis && hasSampleResearchScreeningAuthority(analysis.sources) && (
          <aside className="vsee-sample-decision-record" role="note">
            <strong className="vsee-sample-research-screening-label">
              {SAMPLE_RESEARCH_SCREENING_BADGE}
            </strong>
            <p>
              This is synthetic research-screening context, not a meeting or
              VC interaction.
            </p>
          </aside>
        )}
        <dl className="vsee-affected-company">
          <div><dt>Identity</dt><dd>{companyName}</dd></div>
          <div>
            <dt>Status</dt>
            <dd>{analysis?.dealStatus ?? "Unavailable"}</dd>
          </div>
          <div>
            <dt>Prior context</dt>
            <dd>
              {analysis?.investmentMemory.previousMeetingSummary
                ?? "Unavailable"}
            </dd>
          </div>
          <div>
            <dt>Prior decision</dt>
            <dd>{analysis?.investmentMemory.decisionReason ?? "Unavailable"}</dd>
          </div>
          <div>
            <dt>Match</dt>
            <dd>{analysis?.marketEvidence.relationship ?? "Unavailable"}</dd>
          </div>
        </dl>
      </DetailSection>

      <DetailSection number="05" title="Named Analyst Panel">
        <AnalystPanelSynthesis detail={detail} panel={analystPanel} />
      </DetailSection>

      <DetailSection number="06" title="Investment Committee Debate">
        <div className="vsee-ic-debate">
          <ListBlock title="Bull Case" values={article.debate.bull} />
          <ListBlock title="Bear Case" values={article.debate.bear} />
          <ListBlock
            title="True Disagreement"
            values={article.debate.trueDisagreement}
          />
        </div>
        {article.debate.trueDisagreement.length ? (
          <section className="vsee-disagreements">
            <h4>
              Priority disagreements · {article.debate.trueDisagreement.length}
              {detail.disagreements.length > article.debate.trueDisagreement.length
                ? ` of ${detail.disagreements.length}`
                : ""}
            </h4>
            {detail.disagreements
              .filter(({ explanation }) =>
                article.debate.trueDisagreement.includes(explanation)
              )
              .slice(0, article.debate.trueDisagreement.length)
              .map((disagreement) => (
              <article key={disagreement.id}>
                <strong>{humanize(disagreement.topic)}</strong>
                <p>{disagreement.explanation}</p>
                <small>
                  {disagreement.leftJudgmentId} ↔{" "}
                  {disagreement.rightJudgmentId}
                </small>
                <details className="vsee-details">
                  <summary>Open disagreement evidence and lineage</summary>
                  {disagreement.evidenceItemIds.map((itemId) => (
                    <ItemLineage
                      itemId={itemId}
                      detail={detail}
                      key={itemId}
                    />
                  ))}
                </details>
              </article>
            ))}
            {detail.disagreements.length > article.debate.trueDisagreement.length && (
              <p>
                Remaining persisted pairwise conflicts stay available through
                the audit payload; they are not repeated in the main IC reading flow.
              </p>
            )}
          </section>
        ) : (
          <Unavailable copy="No framework disagreements were persisted." />
        )}
      </DetailSection>

      <DetailSection number="07" title="Bear / Base / Bull Scenarios">
        <ScenarioModelPanel detail={detail} />
      </DetailSection>

      <DetailSection number="08" title="Valuation and Return Analysis">
        <p className={`vsee-valuation-state ${detail.valuation.status}`}>
          {humanize(detail.valuation.status)}
          {detail.valuation.blockerCodes.length
            ? ` · ${detail.valuation.blockerCodes.join(" · ")}`
            : ""}
        </p>
        {detail.calculations.length ? (
          <div className="vsee-calculation-states">
            {detail.calculations.map((calculation) => (
              <article className={calculation.status} key={calculation.id}>
                <span>{humanize(calculation.status)}</span>
                <strong>{humanize(calculation.formulaId)}</strong>
                <small>
                  Formula {calculation.formulaVersion} · {calculation.id}
                </small>
                <ClaimTrace claimItemId={calculation.id} detail={detail} />
              </article>
            ))}
          </div>
        ) : (
          <Unavailable copy="No persisted calculations are available." />
        )}
        {detail.valuation.scenarios.length ? (
          <div className="vsee-scenario-grid">
            {detail.valuation.scenarios.map((scenario) => (
              <LineageValue
                key={scenario.name}
                label={humanize(scenario.name)}
                value={scenario.valuation}
                display={formatMoney(scenario.valuation)}
                lineage={scenario.calculationIds.length
                  ? {
                      kind: "Calculation",
                      itemId: scenario.calculationIds[0],
                    }
                  : null}
                detail={detail}
              />
            ))}
          </div>
        ) : (
          <Unavailable copy="No persisted valuation scenarios are available." />
        )}
        <div className="vsee-financial-grid">
          <LineageValue
            label="Ask"
            value={detail.valuation.currentAsk}
            display={formatMoney(detail.valuation.currentAsk)}
            lineage={factForAsk
              ? { kind: "Fact", itemId: factForAsk.id }
              : null}
            detail={detail}
          />
          <LineageValue
            label="Maximum acceptable pre-money"
            value={detail.valuation.maximumAcceptablePreMoney}
            display={formatMoney(detail.valuation.maximumAcceptablePreMoney)}
            lineage={financialCalculationLineage({
              field: "maximumAcceptablePreMoney",
              value: detail.valuation.maximumAcceptablePreMoney,
              calculations: detail.calculations,
              valuationCalculationIds: detail.valuation.calculationIds,
            })}
            detail={detail}
          />
          <LineageValue
            label="Initial ownership"
            value={detail.valuation.initialOwnership}
            display={formatPercent(detail.valuation.initialOwnership)}
            lineage={financialCalculationLineage({
              field: "initialOwnership",
              value: detail.valuation.initialOwnership,
              calculations: detail.calculations,
              valuationCalculationIds: detail.valuation.calculationIds,
            })}
            detail={detail}
          />
          <LineageValue
            label="Post-dilution ownership"
            value={detail.valuation.postDilutionOwnership}
            display={formatPercent(detail.valuation.postDilutionOwnership)}
            lineage={financialCalculationLineage({
              field: "postDilutionOwnership",
              value: detail.valuation.postDilutionOwnership,
              calculations: detail.calculations,
              valuationCalculationIds: detail.valuation.calculationIds,
            })}
            detail={detail}
          />
          <LineageValue
            label="Gross MOIC"
            value={detail.valuation.grossMoic}
            display={detail.valuation.grossMoic
              ? `${detail.valuation.grossMoic}×`
              : "Unavailable"}
            lineage={financialCalculationLineage({
              field: "grossMoic",
              value: detail.valuation.grossMoic,
              calculations: detail.calculations,
              valuationCalculationIds: detail.valuation.calculationIds,
            })}
            detail={detail}
          />
          <LineageValue
            label="Gross IRR"
            value={detail.valuation.grossIrr}
            display={formatPercent(detail.valuation.grossIrr)}
            lineage={financialCalculationLineage({
              field: "grossIrr",
              value: detail.valuation.grossIrr,
              calculations: detail.calculations,
              valuationCalculationIds: detail.valuation.calculationIds,
            })}
            detail={detail}
          />
          <LineageValue
            label="Pricing premium"
            value={detail.valuation.pricingPremium}
            display={formatPercent(detail.valuation.pricingPremium)}
            lineage={financialCalculationLineage({
              field: "pricingPremium",
              value: detail.valuation.pricingPremium,
              calculations: detail.calculations,
              valuationCalculationIds: detail.valuation.calculationIds,
            })}
            detail={detail}
          />
        </div>
      </DetailSection>

      <DetailSection number="09" title="VSee IC Synthesis">
        <div className="vsee-decision-dimensions">
          <Definition
            label="Company Quality"
            value={detail.decision.companyQuality}
          />
          <Definition
            label="Price Attractiveness"
            value={detail.decision.priceAttractiveness}
          />
          <Definition label="Fund Fit" value={detail.decision.fundFit} />
        </div>
        <div className="vsee-formal-decision">
          <span>FORMAL UNDERWRITING DECISION</span>
          <strong>{detail.decision.decision ?? "Unavailable"}</strong>
          <p>
            Advance authorizes continued diligence. Invest Candidate means
            policy gates support IC consideration. Neither is an investment
            approval; human final approval remains required.
          </p>
          <small>
            Ceiling · {detail.decision.decisionCeiling ?? "Unavailable"} ·{" "}
            {detail.decision.confidence} confidence
          </small>
          <ClaimTrace claimItemId={detail.decision.id} detail={detail} />
        </div>
        <StatusAwareActionPanel analysis={analysis} />
        <details className="vsee-details">
          <summary>Open decision trace</summary>
          {detail.decision.firedRules.length ? (
            <ul>
              {detail.decision.firedRules.map((rule) => (
                <li key={rule.ruleId}>
                  {rule.ruleId} · {rule.result} · ceiling{" "}
                  {rule.appliedCeiling ?? "none"} · veto{" "}
                  {rule.veto ? "yes" : "no"}
                </li>
              ))}
            </ul>
          ) : <p>No formal rule fired.</p>}
        </details>
      </DetailSection>

      <DetailSection number="10" title="Required Diligence">
        <div className="vsee-action-list">
          {detail.evidencePack.coverage.missingFieldIds.map((field) => (
            <article key={field}>
              <span>MISSING EVIDENCE</span>
              <strong>{humanize(field)}</strong>
              <p>
                Request a source-backed answer; it may raise or lower the
                current decision ceiling.
              </p>
            </article>
          ))}
          {[
            ["Meeting", "Review the sourced open questions with the team."],
            ["Reference", "Confirm customer and partner references."],
            ["Diligence", "Request exact round terms and operating metrics."],
            ["Model", "Refresh the Bear/Base/Bull model after evidence changes."],
            ["Monitoring", "Monitor the next market and company milestones."],
          ].map(([label, copy]) => (
            <article key={label}>
              <span>{label.toUpperCase()}</span>
              <p>{copy}</p>
            </article>
          ))}
        </div>
        <h4>Sources</h4>
        {detail.sourceRevisionIds.length ? (
          <div className="vsee-source-revisions">
            {detail.sourceRevisionIds.map((revisionId) => (
              <SourceRevisionLink
                revisionId={revisionId}
                key={revisionId}
              />
            ))}
          </div>
        ) : (
          <Unavailable copy="No Source Revision lineage was persisted." />
        )}
        <h4>Versions</h4>
        <dl className="vsee-version-grid">
          {versionRows(detail.versionSnapshot).map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </DetailSection>

      <DetailSection number="11" title="Status-aware Action Drafts">
        <p>
          These are persisted draft bodies only. Editing replaces the current
          body for the same draft identity.
        </p>
        {!canSaveDrafts && (
          <p className="vsee-readonly-note" role="status">
            Draft saving is disabled in this read-only public demo.
          </p>
        )}
        {drafts.length ? (
          <div className="vsee-action-draft-list">
            {drafts.map((draft) => (
              <article key={draft.id}>
                <b>DRAFT ONLY — NOT SENT OR PUBLISHED</b>
                <span>{humanize(draft.audienceType)} draft</span>
                <small>
                  {humanize(draft.safety)} · {humanize(draft.deliveryMode)}
                </small>
                {draft.schemaVersion === "action-draft-v2" ? (
                  <>
                    <small>
                      {humanize(draft.dealStatus ?? "unavailable")} ·{" "}
                      {humanize(draft.beliefDirection ?? "unavailable")}
                    </small>
                    <small>
                      {humanize(draft.format ?? "unavailable")} ·{" "}
                      {humanize(draft.channel)} ·{" "}
                      {humanize(draft.audienceType)}
                    </small>
                    <small>
                      Actions · {draft.actions.map((action) =>
                        `${humanize(action.kind)} (${humanize(action.scope)}, ${humanize(action.priority)})`
                      ).join(" · ")}
                    </small>
                    {draft.missingEvidence.length ? (
                      <dl>
                        {draft.missingEvidence.map((item) => (
                          <div key={`${draft.id}:${item.fieldId}`}>
                            <dt>{item.label} · {item.reasonCode}</dt>
                            <dd>{item.mostLikelyDecisionImpact}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <small>
                        No additional evidence request was persisted for this draft.
                      </small>
                    )}
                  </>
                ) : (
                  <small>
                    Legacy draft safety classification and status-aware action
                    metadata are unavailable.
                  </small>
                )}
                <p>{draft.body}</p>
                <small>
                  Current body updated {formatDate(draft.updatedAt)}
                </small>
                <button onClick={() => onEditDraft(draft)}>
                  EDIT CURRENT BODY
                </button>
              </article>
            ))}
          </div>
        ) : <Unavailable copy="No action draft was finalized." />}
      </DetailSection>

      <DetailSection number="12" title="Evidence Classification">
        <div className="vsee-evidence-classification">
          <Definition
            label="Facts"
            value={String(article.evidenceClassification.factCount)}
          />
          <Definition
            label="Assumptions"
            value={String(article.evidenceClassification.assumptionCount)}
          />
          <Definition
            label="Unknowns"
            value={String(article.evidenceClassification.unknownCount)}
          />
          <Definition
            label="Conflicts"
            value={String(article.evidenceClassification.conflictCount)}
          />
        </div>
        <p>
          Facts retain exact Source Revision lineage. Assumptions remain
          labeled inputs. Unknowns and conflicts constrain the decision
          ceiling and are never silently filled.
        </p>
      </DetailSection>

      <DetailSection number="13" title="Audit Appendix">
        <details className="vsee-details" open>
          <summary>Open exact report identity and evidence lineage</summary>
          <Definition label="CandidateRun" value={detail.candidateRunId} />
          <Definition label="Deal" value={detail.dealId} />
          <Definition
            label="Source Revisions"
            value={joinRaw(detail.sourceRevisionIds)}
          />
          <Definition
            label="Claim edges"
            value={String(detail.claimEdges.length)}
          />
        </details>
        <FrameworkAppendix detail={detail} />
      </DetailSection>

      <DetailSection number="14" title="Final IC Position">
        <div className="vsee-final-ic-position">
          <span>FORMAL RESULT</span>
          <strong>{article.finalPosition.decision}</strong>
          <p>
            Decision ceiling · {article.finalPosition.ceiling} · Confidence ·{" "}
            {humanize(article.finalPosition.confidence)}
          </p>
          <p>Next action · {humanize(article.finalPosition.nextAction)}</p>
          <small>
            Human IC approval remains required. No outreach, publication, or
            transaction is executed automatically.
          </small>
        </div>
      </DetailSection>
    </div>
  );
}

function ExecutiveDecisionMemo({
  analysis,
  detail,
}: {
  analysis: UnderwritingAnalysisContext | null;
  detail: CandidateUnderwritingDetail;
}) {
  const assessment = analysis?.beliefAssessment;
  const primaryAction = assessment?.actions[0];
  const missingEvidence = detail.evidencePack.coverage.missingFieldIds;

  return (
    <div className="vsee-executive-memo">
      <div className="vsee-executive-memo-lead">
        <div>
          <span>FORMAL RESULT</span>
          <strong>{detail.decision.decision ?? "Unavailable"}</strong>
        </div>
        <p>
          {analysis?.marketEvidence.explanation
            ?? "A concise source-grounded market-impact summary was not persisted; review the evidence and IC synthesis below."}
        </p>
      </div>
      <div className="vsee-executive-memo-grid">
        <article>
          <span>DECISION CEILING</span>
          <strong>{detail.decision.decisionCeiling ?? "Unavailable"}</strong>
          <small>
            Decision ceiling · {detail.decision.decisionCeiling ?? "Unavailable"}
          </small>
        </article>
        <article>
          <span>CONFIDENCE</span>
          <strong>{humanize(detail.decision.confidence)}</strong>
          <small>Persisted underwriting confidence</small>
        </article>
        <article>
          <span>BELIEF CHANGE</span>
          <strong>{assessment ? humanize(assessment.direction) : "Unavailable"}</strong>
          <small>
            Deal status · {analysis ? humanize(analysis.dealStatus) : "Unavailable"}
          </small>
        </article>
        <article>
          <span>RECOMMENDED NEXT MOVE</span>
          <strong>{primaryAction ? humanize(primaryAction.kind) : "Unavailable"}</strong>
          <small>
            {primaryAction
              ? `${humanize(primaryAction.scope)} · ${humanize(primaryAction.priority)} priority`
              : "No status-aware action was persisted"}
          </small>
        </article>
      </div>
      <div className="vsee-executive-memo-blockers">
        <span>CRITICAL MISSING EVIDENCE</span>
        <strong>
          Critical missing evidence · {missingEvidence.length
            ? missingEvidence.join(" · ")
            : "None persisted"}
        </strong>
        <small>
          Blocking conflicts · {detail.evidencePack.coverage.blockingConflictIds.length
            ? detail.evidencePack.coverage.blockingConflictIds.join(" · ")
            : "None persisted"}
        </small>
      </div>
    </div>
  );
}

function AnalystPanelSynthesis({
  detail,
  panel,
}: {
  detail: CandidateUnderwritingDetail;
  panel: ReturnType<typeof buildAnalystPanel>;
}) {
  return (
    <div className="vsee-analyst-panel-summary">
      <div className="vsee-analyst-panel-meta">
        <div>
          <span>ADVISORY PANEL</span>
          <strong>
            {countLabel(panel.activeJudgmentCount, "active judgment")}
            {" · "}{countLabel(
              panel.abstainedJudgmentCount,
              "abstained or unavailable",
              false,
            )}
          </strong>
        </div>
        <small>Public-source product synthesis · no endorsement</small>
      </div>
      <p>
        Named public-source frameworks are grouped by the IC question they
        illuminate. They remain advisory, independently persisted, and carry
        zero formal decision weight.
      </p>
      {panel.groups.length ? (
        <div className="vsee-analyst-issue-grid">
          {panel.groups.map((group) => (
            <article className="vsee-analyst-issue" key={group.id}>
              <header>
                <div>
                  <span>IC ISSUE</span>
                  <h4>{group.title}</h4>
                </div>
                <b>{group.judgmentIds.length} views</b>
              </header>
              <p>{group.description}</p>
              <Definition
                label="Analysts"
                value={group.participants.map(compactAnalystName).join(" · ")}
              />
              <Definition
                label="Judgment range"
                value={group.conclusions.map(humanize).join(" · ")}
              />
              <Definition
                label="Strongest support"
                value={group.strongestSupport[0] ?? "Unavailable"}
              />
              <Definition
                label="Strongest counterevidence"
                value={group.strongestCounterevidence[0] ?? "Unavailable"}
              />
              <Definition
                label="Highest-priority unknown"
                value={group.unknowns[0] ?? "Unavailable"}
              />
              <details className="vsee-details">
                <summary>Open all persisted issue inputs</summary>
                <Definition
                  label="Judgment IDs"
                  value={group.judgmentIds.join(" · ")}
                />
                <Definition
                  label="All support"
                  value={join(group.strongestSupport)}
                />
                <Definition
                  label="All counterevidence"
                  value={join(group.strongestCounterevidence)}
                />
                <Definition label="All unknowns" value={join(group.unknowns)} />
              </details>
            </article>
          ))}
        </div>
      ) : (
        <Unavailable copy="No active framework judgments are available for IC synthesis." />
      )}
      {!detail.judgments.length && (
        <Unavailable copy="No persisted framework judgments are available." />
      )}
    </div>
  );
}

function FrameworkAppendix({
  detail,
}: {
  detail: CandidateUnderwritingDetail;
}) {
  return (
    <details className="vsee-details vsee-framework-appendix">
      <summary>
        Complete Framework Appendix · {detail.judgments.length} persisted
        judgments
      </summary>
      <p>
        Complete Investor Framework Perspectives with the original per-framework
        conclusion, counterevidence, limitations, confidence dimensions, source
        catalog, version pins, and Evidence Pack lineage.
      </p>
      {detail.judgments.length ? (
        <div className="vsee-framework-list">
          {detail.judgments.map((judgment) => (
            <article key={judgment.id}>
              <header>
                <div>
                  <span>
                    {judgment.frameworkMetadata
                      ? `NAMED ADVISORY · ${judgment.frameworkMetadata.packName}`
                      : "CORE FRAMEWORK"}
                  </span>
                  <h4>{humanize(judgment.frameworkCardId)}</h4>
                </div>
                <b>{judgment.applicability} · {judgment.conclusion}</b>
              </header>
              {judgment.frameworkMetadata && (
                <>
                  <p className="vsee-zero-weight">
                    Advisory formal decision weight · 0
                  </p>
                  <AdvisoryFrameworkProvenance
                    judgmentCardId={judgment.frameworkCardId}
                    judgmentCardVersion={judgment.frameworkVersion}
                    metadata={judgment.frameworkMetadata}
                  />
                </>
              )}
              <Definition
                label="Support"
                value={judgment.strongestSupport ?? "Unavailable"}
              />
              <Definition
                label="Counterevidence"
                value={judgment.strongestCounterargument ?? "Unavailable"}
              />
              <Definition
                label="Supporting Evidence Pack IDs"
                value={join(judgment.supportEvidenceItemIds)}
              />
              <Definition
                label="Counterevidence Evidence Pack IDs"
                value={join(judgment.counterEvidenceItemIds)}
              />
              <Definition label="Unknowns" value={join(judgment.unknowns)} />
              <Definition
                label="Limitations"
                value={join(judgment.limitations)}
              />
              <Definition
                label="Confidence"
                value={[
                  `source ${judgment.confidence.sourceReliability}`,
                  `strength ${judgment.confidence.evidenceStrength}`,
                  `coverage ${judgment.confidence.evidenceCoverage}`,
                  `applicability ${judgment.confidence.applicability}`,
                  `judgment ${judgment.confidence.judgment}`,
                ].join(" · ")}
              />
              <ClaimTrace claimItemId={judgment.id} detail={detail} />
            </article>
          ))}
        </div>
      ) : (
        <Unavailable copy="No persisted framework judgments are available." />
      )}
    </details>
  );
}

function countLabel(count: number, label: string, plural = true): string {
  return `${count} ${label}${plural && count === 1 ? "" : plural ? "s" : ""}`;
}

function compactAnalystName(name: string): string {
  return name
    .replace(/\s+Public Frameworks\s+—\s+Research Draft$/i, "")
    .replace(/\s+Public Frameworks$/i, "");
}

function EvidenceContextNotice({
  context,
}: {
  context?: ReportEvidenceContext;
}) {
  if (!context || context.state === "legacy_unbound") {
    return (
      <aside className="vsee-evidence-context legacy" role="note">
        <strong>Evidence context unavailable</strong>
        <p>
          Legacy report was not bound to a live or pinned evidence frame.
        </p>
      </aside>
    );
  }
  const pinned = context.evidenceMode === "pinned";
  return (
    <aside
      className={`vsee-evidence-context ${context.evidenceMode}`}
      role="note"
    >
      <strong>{pinned ? "PINNED DEMO REPLAY" : "LIVE EVIDENCE"}</strong>
      <p>{context.displayLabel}</p>
      {pinned && (
        <p>
          Historical evidence snapshot—not current news. This underwriting
          artifact belongs to its immutable pinned report; run a current scan
          for the current Deal registry.
        </p>
      )}
      <small>
        14-day window · {formatDate(context.windowStartAt)} to{" "}
        {formatDate(context.windowEndAt)} · {context.windowTimezone} ·{" "}
        {context.eventCount} events
      </small>
    </aside>
  );
}

function EvidenceCoveragePanel({
  detail,
}: {
  detail: CandidateUnderwritingDetail;
}) {
  const coverage = detail.evidencePack.coverage;
  return (
    <section className="vsee-evidence-coverage">
      <h4>Evidence coverage</h4>
      <div className="vsee-decision-dimensions">
        <Definition
          label="Minimum model inputs complete"
          value={coverage.minimumModelInputsComplete ? "Yes" : "No"}
        />
        <Definition
          label="Critical evidence complete"
          value={coverage.criticalEvidenceComplete ? "Yes" : "No"}
        />
        <Definition
          label="Missing field IDs"
          value={joinRaw(coverage.missingFieldIds)}
        />
        <Definition
          label="Blocking conflict IDs"
          value={joinRaw(coverage.blockingConflictIds)}
        />
        <Definition
          label="Decision ceiling"
          value={coverage.decisionCeiling ?? "Unavailable"}
        />
        <Definition
          label="Underwriting Status"
          value={humanize(coverage.underwritingStatus)}
        />
        <Definition
          label="Reason codes"
          value={joinRaw(coverage.reasonCodes)}
        />
      </div>
    </section>
  );
}

function EvidenceConflictsPanel({
  detail,
}: {
  detail: CandidateUnderwritingDetail;
}) {
  return (
    <section className="vsee-evidence-conflicts">
      <h4>Evidence conflicts</h4>
      {detail.evidencePack.conflicts.length ? (
        detail.evidencePack.conflicts.map((conflict) => {
          const left = detail.evidencePack.facts.find((fact) =>
            fact.id === conflict.leftFactId
          );
          const right = detail.evidencePack.facts.find((fact) =>
            fact.id === conflict.rightFactId
          );
          return (
            <article key={conflict.id}>
              <header>
                <strong>{humanize(conflict.field)}</strong>
                <span>
                  {humanize(conflict.status)} ·{" "}
                  {conflict.material ? "Material" : "Immaterial"}
                </span>
              </header>
              <p>
                Left · {conflict.leftFactId} ·{" "}
                {left ? `${left.value}${left.unit ? ` ${left.unit}` : ""}` : "Fact unavailable"}
              </p>
              <p>
                Right · {conflict.rightFactId} ·{" "}
                {right ? `${right.value}${right.unit ? ` ${right.unit}` : ""}` : "Fact unavailable"}
              </p>
              <small>Materiality rule · {conflict.materialityRuleId}</small>
              {conflict.resolutionFactId && conflict.resolutionReason ? (
                <p>
                  Resolved by {conflict.resolutionFactId} ·{" "}
                  {conflict.resolutionReason}
                </p>
              ) : (
                <p>Resolution unavailable — conflict remains open</p>
              )}
            </article>
          );
        })
      ) : (
        <Unavailable copy="No persisted Evidence Pack conflicts are available." />
      )}
    </section>
  );
}

function ScenarioModelPanel({
  detail,
}: {
  detail: CandidateUnderwritingDetail;
}) {
  const model = detail.scenarioModel;
  return (
    <section className="vsee-scenario-model">
      <h4>Bear / Base / Bull scenario inputs</h4>
      <p>
        Formula policy · {model.formulaPolicyVersion}
        {" · "}Probability weighted · {model.probabilityWeighted ? "Yes" : "No"}
      </p>
      {model.scenarios.length ? (
        <div className="vsee-scenario-model-grid">
          {model.scenarios.map((scenario) => (
            <section key={scenario.name}>
              <h5>{humanize(scenario.name)}</h5>
              {scenario.inputs.map((input) => (
                <article
                  key={input.id}
                  data-scenario-input={`${scenario.name}:${input.field}`}
                  className={input.value === null ? "unavailable" : ""}
                >
                  <span>{humanize(input.field)}</span>
                  <strong>
                    {input.value === null
                      ? "Unavailable"
                      : `${input.value}${input.unit ? ` ${input.unit}` : ""}`}
                  </strong>
                  {input.evidenceItemId ? (
                    <>
                      <small>Fact · {input.evidenceItemId}</small>
                      <ItemLineage itemId={input.evidenceItemId} detail={detail} />
                    </>
                  ) : input.assumptionItemId ? (
                    <>
                      <small>Assumption · {input.assumptionItemId}</small>
                      <ItemLineage
                        itemId={input.assumptionItemId}
                        detail={detail}
                      />
                    </>
                  ) : (
                    <small>
                      {input.unavailableReason
                        ? humanize(input.unavailableReason)
                        : "Unavailable reason not persisted"}
                    </small>
                  )}
                </article>
              ))}
            </section>
          ))}
        </div>
      ) : (
        <Unavailable copy="No Bear/Base/Bull scenario model was persisted." />
      )}
    </section>
  );
}

function StatusAwareActionPanel({
  analysis,
}: {
  analysis: UnderwritingAnalysisContext | null;
}) {
  const assessment = analysis?.beliefAssessment;
  if (!assessment) {
    return (
      <section className="vsee-status-aware-actions">
        <h4>STATUS-AWARE DEAL ACTION</h4>
        <Unavailable copy="Belief-change direction and status-aware actions are unavailable." />
      </section>
    );
  }
  const portfolio = assessment.actions.some((action) =>
    action.scope === "portfolio"
  );
  return (
    <section className="vsee-status-aware-actions">
      <h4>
        {portfolio
          ? "STATUS-AWARE PORTFOLIO ACTION"
          : "STATUS-AWARE DEAL ACTION"}
      </h4>
      <p>{humanize(assessment.direction)} belief change</p>
      <small>Deal status · {humanize(analysis.dealStatus)}</small>
      <div className="vsee-action-list">
        {assessment.actions.map((action) => (
          <article key={`${action.kind}:${action.scope}`}>
            <strong>{humanize(action.kind)}</strong>
            <small>
              {humanize(action.scope)} · {humanize(action.priority)} priority ·{" "}
              {humanize(action.visibility)}
            </small>
          </article>
        ))}
      </div>
    </section>
  );
}

function DetailSection({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="vsee-underwriting-section"
      aria-labelledby={`underwriting-section-${number}`}
    >
      <header>
        <span>{number}</span>
        <h3 id={`underwriting-section-${number}`}>{title}</h3>
      </header>
      <div>{children}</div>
    </section>
  );
}

function AdvisoryFrameworkProvenance({
  judgmentCardId,
  judgmentCardVersion,
  metadata,
}: {
  judgmentCardId: string;
  judgmentCardVersion: string;
  metadata: NonNullable<
    CandidateUnderwritingDetail["judgments"][number]["frameworkMetadata"]
  >;
}) {
  return (
    <details className="vsee-details vsee-advisory-provenance">
      <summary>Open complete advisory provenance</summary>
      <div className="vsee-advisory-contract" role="note">
        <p>
          This experimental product synthesis is not an endorsement by any
          named person or organization.
        </p>
        <p>
          It uses only retained public-source paraphrases and does not claim
          or reconstruct private reasoning or hidden chain of thought.
        </p>
        <p>
          Every named advisory viewpoint remains independent, has formal
          decision weight zero, and cannot create or modify the deterministic
          investment decision.
        </p>
      </div>
      <dl>
        <dt>Pack identity</dt>
        <dd>{metadata.packId}</dd>
        <dt>Pack version</dt>
        <dd>{metadata.packVersion}</dd>
        <dt>Judgment card</dt>
        <dd>{judgmentCardId} · {judgmentCardVersion}</dd>
        <dt>Source catalog</dt>
        <dd>{metadata.sourceCatalogId}</dd>
        <dt>Research cutoff</dt>
        <dd>{formatDateOnly(metadata.researchCutoff)}</dd>
      </dl>
      <h5>Component cards</h5>
      <ul>
        {metadata.components.map((component) => (
          <li key={`${component.frameworkId}:${component.version}`}>
            <strong>
              {component.frameworkId} · {component.version} · {component.name}
            </strong>
            <small>{component.attribution.display}</small>
            <ul>
              {component.sourceRefs.map((reference) => (
                <li
                  key={[
                    reference.sourceId,
                    reference.locator.kind,
                    reference.locator.value,
                  ].join(":")}
                >
                  {reference.sourceId} · {humanize(reference.locator.kind)}
                  {" · "}{reference.locator.value}
                  {" · "}{reference.attributionScope.replaceAll("_", " ")}
                  {" · "}{reference.supportType}
                  {" · claims "}{reference.claimIds.join(" · ")}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <h5>Exact source lineage</h5>
      <ul>
        {metadata.sources.map((source) => {
          const href = safeExternalHttpUrl(source.url);
          return (
            <li key={source.sourceId}>
              {href
                ? (
                  <a href={href} target="_blank" rel="noreferrer">
                    {source.title} ↗
                  </a>
                )
                : <span>{source.title}</span>}
              <small>
                {source.sourceId} · {source.publisher} · {source.edition}
              </small>
              <small>
                {source.authorOrSpeaker.join(" · ")} · {source.sourceClass}
                {" · "}{source.sourceType} · {source.language}
              </small>
              <small>
                {source.attributionScope.replaceAll("_", " ")} ·{" "}
                {source.rightsStatus.replaceAll("_", " ")}
              </small>
              <small>
                Published {source.publishedAt ?? "Unavailable"} · event{" "}
                {source.eventAt ?? "Unavailable"} · accessed{" "}
                {source.accessedAt}
              </small>
              <small>{source.attributionNotes}</small>
              <small>
                Immutable revision · {source.immutableRevision.status} ·{" "}
                {source.immutableRevision.hashAlgorithm ?? "no hash algorithm"}
                {" · "}
                {source.immutableRevision.contentHash ?? "no content hash"}
                {source.immutableRevision.reviewedPdfPages?.length
                  ? ` · reviewed pages ${
                      source.immutableRevision.reviewedPdfPages.join(" · ")
                    }`
                  : ""}
                {source.immutableRevision.reviewedTimestampRanges?.length
                  ? ` · reviewed timestamps ${
                      source.immutableRevision.reviewedTimestampRanges.join(
                        " · ",
                      )
                    }`
                  : ""}
                {source.immutableRevision.videoId
                  ? ` · video ${source.immutableRevision.videoId}`
                  : ""}
              </small>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function LineageValue({
  label,
  value,
  display,
  lineage,
  detail,
}: {
  label: string;
  value: string | null;
  display: string;
  lineage: { kind: "Fact" | "Assumption" | "Calculation"; itemId: string }
    | null;
  detail: CandidateUnderwritingDetail;
}) {
  const effectiveLineage = value === null ? null : lineage;
  return (
    <article className={value === null ? "unavailable" : ""}>
      <span>{label}</span>
      <strong>{display}</strong>
      <b className={`vsee-lineage-badge ${
        effectiveLineage?.kind.toLocaleLowerCase() ?? "unsupported"
      }`}>
        {effectiveLineage?.kind ?? "Unsupported"}
      </b>
      {effectiveLineage && (
        <details className="vsee-details">
          <summary>Open value lineage</summary>
          <p>{effectiveLineage.kind} · {effectiveLineage.itemId}</p>
          <ItemLineage itemId={effectiveLineage.itemId} detail={detail} />
        </details>
      )}
    </article>
  );
}

function ClaimTrace({
  claimItemId,
  detail,
}: {
  claimItemId: string;
  detail: CandidateUnderwritingDetail;
}) {
  return (
    <details className="vsee-details">
      <summary>Open sourced rationale and lineage</summary>
      <ItemLineage itemId={claimItemId} detail={detail} />
    </details>
  );
}

function ItemLineage({
  itemId,
  detail,
}: {
  itemId: string;
  detail: CandidateUnderwritingDetail;
}) {
  const directFact = detail.evidencePack.facts.find(
    (fact) => fact.id === itemId,
  );
  const trace = lineageForClaim({
    claimItemId: itemId,
    facts: detail.evidencePack.facts,
    claimEdges: detail.claimEdges,
  });
  const revisions = directFact
    ? [directFact.sourceRevisionId]
    : trace.sourceRevisionIds;
  return (
    <div className="vsee-lineage-trace">
      <p>
        {trace.dependencyItemIds.length
          ? trace.dependencyItemIds.join(" → ")
          : itemId}
      </p>
      {revisions.map((revisionId) => (
        <SourceRevisionLink revisionId={revisionId} key={revisionId} />
      ))}
      {!revisions.length && (
        <span>Upstream policy or assumption; no Source Revision attached.</span>
      )}
    </div>
  );
}

function AnalysisSourceLink({
  source,
}: {
  source: UnderwritingAnalysisContext["sources"][number];
}) {
  const canonical = "schemaVersion" in source;
  const revisionId = source.sourceRevisionId ?? null;
  const label = source.publisher ?? source.title;
  const page = canonical
    ? source.locator?.kind === "document_page"
      ? source.locator.page
      : undefined
    : source.page;

  if (source.provenance === "public_web") {
    const href = safeExternalHttpUrl(
      canonical ? source.canonicalUrl ?? undefined : source.url,
    );
    return (
      <span className="vsee-analysis-source-links">
        {href ? (
          <a href={href} target="_blank" rel="noreferrer">
            {label} ↗
          </a>
        ) : <span>{source.title} · canonical URL unavailable</span>}
        {revisionId && (
          <SourceRevisionLink revisionId={revisionId} page={page} />
        )}
      </span>
    );
  }

  if (source.provenance === "source_document") {
    return revisionId ? (
      <span className="vsee-analysis-source-links">
        <span>{source.title}</span>
        <SourceRevisionLink revisionId={revisionId} page={page} />
      </span>
    ) : (
      <span>{source.title} · exact Source Revision unavailable</span>
    );
  }

  return (
    <span className="vsee-analysis-source-links">
      <span>{source.title}</span>
      {revisionId && (
        <SourceRevisionLink revisionId={revisionId} page={page} />
      )}
    </span>
  );
}

function Definition({ label, value }: { label: string; value: string }) {
  return <dl><dt>{label}</dt><dd>{value}</dd></dl>;
}

function ListBlock({ title, values }: { title: string; values: string[] }) {
  return (
    <section>
      <h4>{title}</h4>
      {values.length
        ? <ul>{values.map((value) => <li key={value}>{value}</li>)}</ul>
        : <p>Unavailable</p>}
    </section>
  );
}

function Unavailable({ copy }: { copy: string }) {
  return <p className="vsee-unavailable">{copy}</p>;
}

function formatMoney(value: string | null): string {
  if (value === null) return "Unavailable";
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(numeric)
    : value;
}

function formatPercent(value: string | null): string {
  if (value === null) return "Unavailable";
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? new Intl.NumberFormat("en-US", {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(numeric)
    : value;
}

export function formatDate(value: string): string {
  const options = {
    month: "short",
    day: "numeric",
    year: "numeric",
  } as const;
  return formatTemporalForDisplay({
    value,
    dateOnly: options,
    timestamp: options,
  });
}

function formatDateOnly(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function humanize(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function join(values: string[]): string {
  return values.length ? values.join(" · ") : "None recorded";
}

function joinRaw(values: string[]): string {
  return values.length ? values.join(" · ") : "None";
}
