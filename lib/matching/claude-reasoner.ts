import { createHash } from "node:crypto";

import type { ReasonerJudgmentsRepository } from "../../db/repositories/reasoner-judgments";
import type { ClaudeClient } from "../claude/client";
import {
  ClaudeReasonedMatchesSchema,
  type ClaudeReasonedMatch,
} from "../claude/schemas";
import type {
  MatchingInput,
  MatchingReasoner,
  ReasonedMatch,
} from "./service";
import {
  serializeMatchingPromptInput,
  stableEvidencePromptJson,
} from "./prompt-evidence";
import {
  classifyMatchingProviderFailure,
  MatchingFailure,
} from "./failure";
import {
  buildReasonedMatchRepairConstraint,
  partitionReasonedMatchAuthority,
  reasonedMatchSatisfiesRepairConstraint,
  reasonedMatchesHaveExactAuthority,
  type ReasonedMatchRepairConstraint,
} from "./response-authority";

// The immutable database RPC accepts this storage envelope. The v4 contract
// domain below changes replay identity without requiring a schema migration.
const JUDGMENT_STORAGE_PREFIX = "reasoner-judgment-v3:sha256:";
const JUDGMENT_CONTRACT_DOMAIN = "reasoner-judgment-v4";

export type ClaudeMatchingReasonerOptions = {
  // Persisted judgment replay. Opus 4.8 exposes no sampling controls, so the
  // only way to keep repeated scans deterministic is to store the judgment for
  // a given evidence fingerprint and replay it while the evidence is unchanged.
  judgments?: ReasonerJudgmentsRepository;
  // When true, skip replay and overwrite the stored judgment (re-roll mode).
  refreshJudgments?: boolean;
};

export function createClaudeMatchingReasoner(
  client: ClaudeClient,
  options: ClaudeMatchingReasonerOptions = {},
): MatchingReasoner {
  return {
    async reason(input: MatchingInput): Promise<ReasonedMatch[]> {
      if (!input.events.length || !input.deals.length) return [];
      if (options.judgments && options.refreshJudgments) {
        throw new Error("IMMUTABLE_JUDGMENT_REFRESH_REQUIRES_REVISION");
      }
      const system = [
          "You are an evidence-constrained venture-capital research analyst.",
          "Find overlaps between recent public market events and previously reviewed Deals.",
          "Do not invent company progress, revenue, customers, fundraising, or current status.",
          "Use only the supplied memory context and source catalog.",
          "The complete whyNow string, complete previousContext string, and each complete implication string must each appear as its own exact key in claimSourceIds.",
          "Use verbatimExcerpt only when quoteEligible is true. A normalizedStatement is a non-quote canonical description: it may ground a factual claim only when factEligible is true, and must never be presented or described as a direct quotation.",
          "Claims are validated mechanically: each claim must equal one complete eligible evidence unit, character for character—either the cited source's full verbatimExcerpt or its full normalizedStatement. Never shorten an evidence unit, remove a qualifier or negation, or merge two evidence strings into one sentence.",
          "Sources with factEligible false, including legacy_unverified and model_inference text, are retrieval context only and cannot support output claims.",
          "memoryContexts text is retrieval output, not quotable evidence: use it to decide which Deals are relevant, then locate eligible text in the sources catalog.",
          "Synthetic fixture records are internal demo context, never external company facts.",
          "Return observations only. Never choose direction, Deal status, actions, scope, priority, visibility, gate values, outcome, formal decision, rank, or a recommended next move.",
          "Select exactly one supplied trigger event and one supplied same-Deal typed prior-context candidate: either a Sample decision record or a Sample research screening record, plus the exact reconsideration-condition index and text.",
          "A Sample research screening record explicitly means no meeting and no VC interaction. Never describe it as a meeting, decision, pass, or investment; it may only establish the supplied research disposition, prior research next-step boundary, and reconsideration conditions.",
          "Provide a substantive counterevidence statement supported by canonical counterevidence-role source IDs.",
          "citedSourceIds must equal the unique union of every source ID used by claimSourceIds, revisitCitedSourceIds, and counterevidence.citedSourceIds—no omissions and no extras.",
          "Each implication must equal one complete eligible canonical evidence unit from a trigger or corroborating source; counterevidence-role sources belong only in counterevidence.",
          "Classify each supported implication by observation polarity: positive means the evidence supports the recorded reconsideration condition, while negative means it weakens it or increases the recorded risk. This is not the formal belief direction; the downstream deterministic policy derives direction, actions, gates, outcome, and any formal decision.",
          "Do not list both positive and negative implications merely for balance. Include both only when independently grounded canonical evidence establishes genuinely opposing observation polarity.",
          "Report every credible Deal/event overlap you find, including uncertain ones; reflect uncertainty in scoreInputs rather than omitting the match. Downstream deterministic validation drops ungrounded claims, so coverage matters more than filtering here.",
          "Return at most one observation per Deal. When multiple events overlap one Deal, select the single strongest evidence-grounded trigger event; never emit duplicate Deal rows.",
          "Score each dimension honestly on its own merits, not uniformly low: when a public event directly addresses a Deal's sector, decision reason, or a recorded revisit condition (for example a reimbursement rule change for a remote patient monitoring company), eventRelevance and dealRelevance belong at 0.7 or higher; reserve scores below 0.4 for tangential links. Do not down-score a well-evidenced direct overlap merely to be cautious.",
          "Calibrate the other two dimensions the same way: when the recalled decision context explicitly records a revisit condition or concern that the public event directly addresses, priorContextStrength belongs at 0.6 or higher; when the cited public sources are primary official publications (government registers, regulator or agency releases, court filings), evidenceQuality belongs at 0.6 or higher. Reserve values below 0.4 for thin or secondary context.",
          "Return JSON only: an array matching the requested schema. Return [] only when no event plausibly relates to any Deal.",
        ].join(" ");
      const evidence = serializeMatchingPromptInput(input);
      const requestContent = stableEvidencePromptJson({
        task: "Rank credible Deal/event overlaps for human follow-up.",
        outputSchema: {
          dealId: "candidate Deal id",
          whyNow: "one complete eligible public evidence unit",
          previousContext: "one complete eligible same-Deal prior-context evidence unit, clearly identifying synthetic records",
          positiveImplications: ["each item is one complete eligible canonical evidence unit"],
          negativeImplications: ["each item is one complete eligible canonical evidence unit"],
          selectedTriggerEventId: "one supplied accepted event ID",
          selectedPriorInteractionId: "one same-Deal typed prior-context authority ID",
          revisitConditionIndex: 0,
          revisitConditionText: "exact selected revisit-condition text",
          revisitCitedSourceIds: ["selected event source IDs only"],
          counterevidence: {
            statement: "complete supported counterevidence statement",
            citedSourceIds: ["canonical counterevidence-role source IDs"],
          },
          citedSourceIds: ["valid source IDs only"],
          scoreInputs: {
            eventRelevance: 0.55,
            dealRelevance: 0.55,
            priorContextStrength: 0.55,
            evidenceQuality: 0.55,
          },
          claimSourceIds: {
            "complete claim equal to one eligible verbatim or normalized evidence unit": ["valid source IDs"],
          },
        },
        deals: evidence.deals,
        marketEvents: evidence.marketEvents,
        memoryContexts: evidence.memoryContexts,
        sources: evidence.sources,
      });
      const model = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";
      const scope = requireCurrentEvidenceScope(input);
      const fingerprint = `${JUDGMENT_STORAGE_PREFIX}${
        createHash("sha256")
          .update(
            `${JUDGMENT_CONTRACT_DOMAIN}\n${model}\n${system}\n${requestContent}\n${stableEvidencePromptJson({
              schemaVersion: scope.schemaVersion,
              evidenceMode: scope.evidenceMode,
              contextFingerprint: scope.contextFingerprint,
              eventSetFingerprint: scope.eventSetFingerprint,
              snapshotFingerprint: scope.snapshotFingerprint,
            })}`,
            "utf8",
          )
          .digest("hex")
      }`;
      if (options.judgments && !options.refreshJudgments) {
        const replayed = await replayJudgment(
          options.judgments,
          fingerprint,
          input,
        );
        if (replayed) return replayed;
      }
      let response = await completeMatching(client, {
        system,
        messages: [{
          role: "user",
          content: requestContent,
        }],
        maxTokens: 12_000,
      });
      let parsed: ClaudeReasonedMatch[];
      let validBeforeRepair: ClaudeReasonedMatch[] = [];
      let invalidDealIds: string[] | null = null;
      let repairConstraints = new Map<string, ReasonedMatchRepairConstraint>();
      try {
        parsed = parseCompleteMatches(parseJson(response));
        const partition = partitionReasonedMatchAuthority(parsed, input);
        if (partition.invalid.length || partition.duplicateDealIds.length) {
          const constraints = partition.invalid.map((match) => [
            match.dealId,
            buildReasonedMatchRepairConstraint(match, input),
          ] as const);
          const canRepairOnlyInvalidRows = partition.duplicateDealIds.length === 0
            && constraints.every(([, constraint]) => constraint !== null)
            && new Set(constraints.map(([dealId]) => dealId)).size
              === constraints.length;
          if (canRepairOnlyInvalidRows) {
            validBeforeRepair = partition.valid as ClaudeReasonedMatch[];
            repairConstraints = new Map(
              constraints as Array<readonly [string, ReasonedMatchRepairConstraint]>,
            );
            invalidDealIds = [...repairConstraints.keys()];
          }
          throw new Error("Matching response failed exact authority validation.");
        }
      } catch {
        response = await completeMatching(client, {
          system,
          messages: [{
            role: "user",
            content: [
              requestContent,
              "A previous response failed JSON, schema, or semantic claim-key validation; its content is intentionally not supplied.",
              "Regenerate the complete response from scratch using only the supplied source catalog and other evidence above.",
              ...(invalidDealIds
                ? [
                    `Return repaired rows only for these Deal IDs: ${stableEvidencePromptJson(invalidDealIds)}.`,
                    "Do not return or alter any other Deal row; already valid rows are retained by the application.",
                    `Preserve these reviewed selection, citation, score, and polarity-count constraints exactly: ${stableEvidencePromptJson(invalidDealIds.map((dealId) => repairConstraints.get(dealId)))}.`,
                  ]
                : []),
              "Replace whyNow, previousContext, and every implication with complete eligible canonical evidence units from the source catalog; do not merely add claimSourceIds keys to paraphrases.",
              "Repeat each complete output field as its own exact claimSourceIds key with its valid source IDs. Return only one complete JSON array matching outputSchema.",
              "Make citedSourceIds the exact unique union of claim, revisit, and counterevidence source IDs.",
            ].join("\n"),
          }],
          maxTokens: 12_000,
        });
        try {
          const repaired = parseCompleteMatches(parseJson(response));
          const expectedRepairDealIds = invalidDealIds;
          if (
            expectedRepairDealIds
            && (
              repaired.length !== expectedRepairDealIds.length
              || repaired.some(({ dealId }) =>
                !expectedRepairDealIds.includes(dealId)
              )
              || repaired.some((match) => {
                const constraint = repairConstraints.get(match.dealId);
                return !constraint
                  || !reasonedMatchSatisfiesRepairConstraint(match, constraint);
              })
            )
          ) {
            throw new Error("Matching repair changed the validated Deal set.");
          }
          parsed = [...validBeforeRepair, ...repaired];
          if (!reasonedMatchesHaveExactAuthority(parsed, input)) {
            throw new Error("Matching repair failed exact authority validation.");
          }
        } catch {
          throw new MatchingFailure({
            code: "MATCHING_RESPONSE_INVALID",
            phase: "response_validation",
          });
        }
      }
      const matches = normalizeMatches(parsed, input);
      if (!reasonedMatchesHaveExactAuthority(matches, input)) {
        throw new MatchingFailure({
          code: "MATCHING_RESPONSE_INVALID",
          phase: "response_validation",
        });
      }
      if (options.judgments) {
        const stored = await options.judgments.save({
          fingerprint,
          model,
          payload: matches,
          evidenceContextFingerprint: scope.contextFingerprint,
          evidenceBindingFingerprint: scope.bindingFingerprint,
        });
        try {
          assertCurrentJudgmentIdentity(stored, {
            fingerprint,
            model,
            contextFingerprint: scope.contextFingerprint,
            bindingFingerprint: scope.bindingFingerprint,
          });
          const storedMatches = normalizeMatches(
            parseCompleteMatches(stored.payload),
            input,
          );
          if (!reasonedMatchesHaveExactAuthority(storedMatches, input)) {
            throw new Error("Stored matching judgment failed exact authority.");
          }
          return storedMatches;
        } catch {
          throw new MatchingFailure({
            code: "MATCHING_RESPONSE_INVALID",
            phase: "response_validation",
          });
        }
      }
      return matches;
    },
  };
}

async function completeMatching(
  client: ClaudeClient,
  input: Parameters<ClaudeClient["complete"]>[0],
): Promise<string> {
  try {
    return await client.complete(input);
  } catch (error) {
    throw classifyMatchingProviderFailure(error);
  }
}

async function replayJudgment(
  judgments: ReasonerJudgmentsRepository,
  fingerprint: string,
  input: MatchingInput,
): Promise<ReasonedMatch[] | null> {
  const record = await judgments.find(fingerprint);
  if (!record) return null;
  if (record.state !== "current") return null;
  try {
    assertCurrentJudgmentIdentity(record, {
      fingerprint,
      model: process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8",
      contextFingerprint: input.evidenceScope!.contextFingerprint,
      bindingFingerprint: input.evidenceScope!.evidenceMode === "live"
        ? input.evidenceScope!.bindingFingerprint
        : null,
    });
    const matches = normalizeMatches(
      parseCompleteMatches(record.payload),
      input,
    );
    if (!reasonedMatchesHaveExactAuthority(matches, input)) {
      throw new Error("Replayed matching judgment failed exact authority.");
    }
    return matches;
  } catch {
    throw new MatchingFailure({
      code: "MATCHING_RESPONSE_INVALID",
      phase: "response_validation",
    });
  }
}

function assertCurrentJudgmentIdentity(
  record: Awaited<ReturnType<ReasonerJudgmentsRepository["find"]>>,
  expected: {
    fingerprint: string;
    model: string;
    contextFingerprint: string;
    bindingFingerprint: string | null;
  },
): void {
  if (
    !record
    || record.state !== "current"
    || record.fingerprint !== expected.fingerprint
    || record.model !== expected.model
    || record.evidenceContextFingerprint !== expected.contextFingerprint
    || (
      expected.bindingFingerprint !== null
      && record.evidenceBindingFingerprint !== expected.bindingFingerprint
    )
  ) throw new Error("Reasoner judgment identity mismatch.");
}

function requireCurrentEvidenceScope(
  input: MatchingInput,
): NonNullable<MatchingInput["evidenceScope"]> {
  const scope = input.evidenceScope;
  const sha256 = /^sha256:[0-9a-f]{64}$/u;
  if (
    scope?.schemaVersion !== "matching-evidence-scope-v1"
    || !["live", "pinned"].includes(scope.evidenceMode)
    || !sha256.test(scope.contextFingerprint)
    || !sha256.test(scope.eventSetFingerprint)
    || !sha256.test(scope.bindingFingerprint)
    || (scope.snapshotFingerprint !== null
      && !sha256.test(scope.snapshotFingerprint))
    || (scope.evidenceMode === "live") !== (scope.snapshotFingerprint === null)
  ) throw new Error("Matching requires a complete current evidence scope.");
  return scope!;
}

function normalizeMatches(
  parsed: ClaudeReasonedMatch[],
  input: MatchingInput,
): ReasonedMatch[] {
  const allowedDeals = new Set(input.deals.map((deal) => deal.id));
  return parsed
    .filter((match) => allowedDeals.has(match.dealId))
    .map((match) => ({
      ...match,
      citedSourceIds: unique(match.citedSourceIds),
      revisitCitedSourceIds: unique(match.revisitCitedSourceIds),
      counterevidence: {
        ...match.counterevidence,
        citedSourceIds: unique(match.counterevidence.citedSourceIds),
      },
      claimSourceIds: Object.fromEntries(
        Object.entries(match.claimSourceIds).map(([claim, sourceIds]) => [
          claim,
          unique(sourceIds),
        ]),
      ),
    }));
}

function parseCompleteMatches(input: unknown): ClaudeReasonedMatch[] {
  const matches = ClaudeReasonedMatchesSchema.parse(input);
  if (matches.some((match) => {
    const exactClaimKeys = new Set(Object.keys(match.claimSourceIds));
    return [
      match.whyNow,
      match.previousContext,
      ...match.positiveImplications,
      ...match.negativeImplications,
    ].some((claim) => !exactClaimKeys.has(claim));
  })) {
    throw new Error("Matching response omitted required exact claim keys.");
  }
  return matches;
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced?.[1] ?? trimmed);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
