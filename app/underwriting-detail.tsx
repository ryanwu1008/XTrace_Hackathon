"use client";

import { useEffect, useRef } from "react";

import type { CompanyAnalysis } from "../lib/contracts/domain";
import type {
  PublicActionDraft,
  PublicCandidateVersionSnapshot,
} from "../lib/underwriting/read-model";
import { SourceRevisionLink } from "./source-revision-link";
import { formatTemporalForDisplay } from "../lib/format/temporal";
import { safeExternalHttpUrl } from "../lib/security/safe-url";
import {
  financialCalculationLineage,
  lineageForClaim,
  versionRows,
} from "./underwriting-view-model";

type EvidenceFactView = {
  id: string;
  field: string;
  value: string;
  unit: string | null;
  currency: string | null;
  publishedAt: string | null;
  eventAt: string | null;
  retrievedAt: string;
  sourceRevisionId: string;
  provenanceOrigin: string;
  sourceRole: string;
  assertionStatus: string;
  freshness: string;
  acceptedForGate: boolean;
};

type EvidenceAssumptionView = {
  id: string;
  field: string;
  value: string;
  unit: string | null;
  scenario: string;
  rationale: string;
  inputRefIds: string[];
  provenanceOrigin: string;
  sensitivity: string;
  requiresConfirmation: boolean;
};

type CalculationView = {
  id: string;
  formulaId: string;
  formulaVersion: string;
  inputRefs: Array<{ itemId: string; type: string }>;
  output: string;
  unit: string;
  currency: string | null;
  status: string;
};

type JudgmentView = {
  id: string;
  frameworkCardId: string;
  frameworkVersion: string;
  applicability: string;
  conclusion: string;
  strongestSupport: string | null;
  strongestCounterargument: string | null;
  supportEvidenceItemIds: string[];
  counterEvidenceItemIds: string[];
  unknowns: string[];
  limitations: string[];
  confidence: {
    sourceReliability: string;
    evidenceStrength: string;
    evidenceCoverage: string;
    applicability: string;
    judgment: string;
  };
  frameworkMetadata?: {
    packId: string;
    packName: string;
    packVersion: string;
    sourceCatalogId: string;
    researchCutoff: string;
    components: Array<{
      frameworkId: string;
      version: string;
      name: string;
      attribution: {
        display: string;
      };
      sourceRefs: Array<{
        sourceId: string;
        claimIds: string[];
        locator: {
          kind: string;
          value: string;
        };
        attributionScope: string;
        supportType: string;
      }>;
    }>;
    sources: Array<{
      sourceId: string;
      title: string;
      authorOrSpeaker: string[];
      publisher: string;
      sourceClass: string;
      sourceType: string;
      url: string;
      edition: string;
      publishedAt: string | null;
      eventAt: string | null;
      accessedAt: string;
      language: string;
      rightsStatus: string;
      attributionScope: string;
      attributionNotes: string;
      immutableRevision: {
        status: string;
        hashAlgorithm: string | null;
        contentHash: string | null;
        reviewedPdfPages?: number[];
        reviewedTimestampRanges?: string[];
        videoId?: string;
      };
    }>;
    formalDecisionWeight: string;
  };
};

type DecisionView = {
  id: string;
  companyQuality: string;
  priceAttractiveness: string;
  fundFit: string;
  decision: string | null;
  decisionCeiling: string | null;
  hardVeto: boolean;
  firedRules: Array<{
    ruleId: string;
    inputRefs: string[];
    result: string;
    appliedCeiling: string | null;
    veto: boolean;
  }>;
  blockingEvidenceItemIds: string[];
  confidence: string;
};

export interface CandidateUnderwritingDetailDto {
  candidateRunId: string;
  dealId: string;
  evidencePack: {
    asOfDate: string;
    sourceRevisionIds: string[];
    facts: EvidenceFactView[];
    assumptions: EvidenceAssumptionView[];
    conflicts: Array<{
      id: string;
      field: string;
      material: boolean;
      status: string;
    }>;
    coverage: {
      minimumModelInputsComplete: boolean;
      criticalEvidenceComplete: boolean;
      missingFieldIds: string[];
      blockingConflictIds: string[];
      decisionCeiling: string | null;
      underwritingStatus: string;
      reasonCodes: string[];
    };
  };
  context: {
    contextVersion: string;
    stage: string;
    businessModel: string;
    geography: string;
    securityType: string;
    asOfDate: string;
    benchmarkCompatibility: string;
  };
  calculations: CalculationView[];
  judgments: JudgmentView[];
  disagreements: Array<{
    id: string;
    leftJudgmentId: string;
    rightJudgmentId: string;
    topic: string;
    explanation: string;
    evidenceItemIds: string[];
  }>;
  valuation: {
    status: string;
    scenarios: Array<{
      name: string;
      valuation: string | null;
      calculationIds: string[];
    }>;
    currentAsk: string | null;
    maximumAcceptablePreMoney: string | null;
    initialOwnership: string | null;
    postDilutionOwnership: string | null;
    grossMoic: string | null;
    grossIrr: string | null;
    pricingPremium: string | null;
    calculationIds: string[];
    blockerCodes: string[];
  };
  decision: DecisionView;
  narrative: string;
  claimEdges: Array<{
    claimItemId: string;
    dependencyItemId: string;
    dependencyType:
      | "fact"
      | "assumption"
      | "calculation"
      | "framework_judgment"
      | "policy_ref"
      | "benchmark_ref"
      | "framework_ref";
  }>;
  sourceRevisionIds: string[];
  versionSnapshot: PublicCandidateVersionSnapshot;
}

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
  investmentMemory: {
    previousMeetingSummary: string;
    decisionReason: string;
  };
  sources: CompanyAnalysis["sources"];
}

export function UnderwritingDetailDialog({
  open,
  companyName,
  analysis,
  detail,
  drafts,
  canSaveDrafts,
  onClose,
  onEditDraft,
}: {
  open: boolean;
  companyName: string;
  analysis: UnderwritingAnalysisContext | null;
  detail: CandidateUnderwritingDetailDto | null;
  drafts: PublicActionDraft[];
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
  canSaveDrafts,
  onEditDraft,
}: {
  companyName: string;
  analysis: UnderwritingAnalysisContext | null;
  detail: CandidateUnderwritingDetailDto;
  drafts: PublicActionDraft[];
  canSaveDrafts: boolean;
  onEditDraft(draft: PublicActionDraft): void;
}) {
  const factForAsk = detail.evidencePack.facts.find((fact) =>
    /reported_valuation|current_ask|pre_money|post_money/.test(fact.field)
  );
  const capitalFlowFact = detail.evidencePack.facts.find((fact) =>
    /capital.*flow|funding.*flow/.test(fact.field)
  );

  return (
    <div className="vsee-underwriting-detail">
      <DetailSection number="01" title="What happened?">
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
        <h4>Evidence</h4>
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
      </DetailSection>

      <DetailSection number="02" title="What is the impact?">
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
      </DetailSection>

      <DetailSection
        number="03"
        title="Which historical companies are affected?"
      >
        <h4>Context</h4>
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

      <DetailSection number="04" title="Company underwriting">
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
        {!!detail.disagreements.length && (
          <section className="vsee-disagreements">
            <h4>Independent disagreements</h4>
            {detail.disagreements.map((disagreement) => (
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
          </section>
        )}
      </DetailSection>

      <DetailSection number="05" title="Valuation and fund return">
        <p className={`vsee-valuation-state ${detail.valuation.status}`}>
          {humanize(detail.valuation.status)}
          {detail.valuation.blockerCodes.length
            ? ` · ${detail.valuation.blockerCodes.join(" · ")}`
            : ""}
        </p>
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
        </div>
      </DetailSection>

      <DetailSection number="06" title="Final conclusion">
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
          <span>FORMAL DECISION</span>
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

      <DetailSection number="07" title="What can you do?">
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
        <div className="vsee-source-revisions">
          {detail.sourceRevisionIds.map((revisionId) => (
            <SourceRevisionLink
              revisionId={revisionId}
              key={revisionId}
            />
          ))}
        </div>
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

      <DetailSection number="08" title="Action drafts">
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
                <span>{humanize(draft.audienceType)} draft</span>
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
    </div>
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
  metadata: NonNullable<JudgmentView["frameworkMetadata"]>;
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
  detail: CandidateUnderwritingDetailDto;
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
  detail: CandidateUnderwritingDetailDto;
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
  detail: CandidateUnderwritingDetailDto;
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
  const page = "schemaVersion" in source
    && source.locator?.kind === "document_page"
    ? source.locator.page
    : !("schemaVersion" in source)
    ? source.page
    : undefined;
  const href = source.documentId
    ? `/api/documents/${encodeURIComponent(source.documentId)}/access${
        page ? `#page=${page}` : ""
      }`
    : safeExternalHttpUrl("schemaVersion" in source
      ? source.canonicalUrl ?? undefined
      : source.url);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer">
      {source.publisher ?? source.title} ↗
    </a>
  ) : <span>{source.title}</span>;
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
