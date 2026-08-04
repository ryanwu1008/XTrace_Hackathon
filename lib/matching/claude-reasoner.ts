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
          "Every sentence in whyNow and previousContext, and every implication, must appear as a key in claimSourceIds.",
          "Use verbatimExcerpt only when quoteEligible is true. A normalizedStatement is a non-quote canonical description: it may ground a factual claim only when factEligible is true, and must never be presented or described as a direct quotation.",
          "Claims are validated mechanically: each claim must equal one complete eligible evidence unit, character for character—either the cited source's full verbatimExcerpt or its full normalizedStatement. Never shorten an evidence unit, remove a qualifier or negation, or merge two evidence strings into one sentence.",
          "Sources with factEligible false, including legacy_unverified and model_inference text, are retrieval context only and cannot support output claims.",
          "memoryContexts text is retrieval output, not quotable evidence: use it to decide which Deals are relevant, then locate eligible text in the sources catalog.",
          "Synthetic fixture records are internal demo context, never external company facts.",
          "Return observations only. Never choose direction, Deal status, actions, scope, priority, visibility, gate values, outcome, formal decision, rank, or a recommended next move.",
          "Select exactly one supplied trigger event and one supplied same-Deal typed prior-context candidate: either a Sample decision record or a Sample research screening record, plus the exact reconsideration-condition index and text.",
          "A Sample research screening record explicitly means no meeting and no VC interaction. Never describe it as a meeting, decision, pass, or investment; it may only establish the supplied research disposition, prior research next-step boundary, and reconsideration conditions.",
          "Provide a substantive counterevidence statement supported by canonical counterevidence-role source IDs.",
          "Report every credible Deal/event overlap you find, including uncertain ones; reflect uncertainty in scoreInputs rather than omitting the match. Downstream deterministic validation drops ungrounded claims, so coverage matters more than filtering here.",
          "Score each dimension honestly on its own merits, not uniformly low: when a public event directly addresses a Deal's sector, decision reason, or a recorded revisit condition (for example a reimbursement rule change for a remote patient monitoring company), eventRelevance and dealRelevance belong at 0.7 or higher; reserve scores below 0.4 for tangential links. Do not down-score a well-evidenced direct overlap merely to be cautious.",
          "Calibrate the other two dimensions the same way: when the recalled decision context explicitly records a revisit condition or concern that the public event directly addresses, priorContextStrength belongs at 0.6 or higher; when the cited public sources are primary official publications (government registers, regulator or agency releases, court filings), evidenceQuality belongs at 0.6 or higher. Reserve values below 0.4 for thin or secondary context.",
          "Return JSON only: an array matching the requested schema. Return [] only when no event plausibly relates to any Deal.",
        ].join(" ");
      const evidence = serializeMatchingPromptInput(input);
      const requestContent = stableEvidencePromptJson({
        task: "Rank credible Deal/event overlaps for human follow-up.",
        outputSchema: {
          dealId: "candidate Deal id",
          whyNow: "one or more evidence-backed sentences",
          previousContext: "prior local context, clearly identifying synthetic records",
          positiveImplications: ["bounded implications"],
          negativeImplications: ["bounded implications"],
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
          scoreInputsNote: "scoreInputs values are JSON numbers between 0 and 1, never strings",
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
      const fingerprint = `reasoner-judgment-v3:sha256:${
        createHash("sha256")
          .update(
            `reasoner-judgment-v3\n${model}\n${system}\n${requestContent}\n${stableEvidencePromptJson({
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
      let response = await client.complete({
        system,
        messages: [{
          role: "user",
          content: requestContent,
        }],
        maxTokens: 6_000,
      });
      let parsed;
      try {
        parsed = ClaudeReasonedMatchesSchema.parse(parseJson(response));
      } catch {
        response = await client.complete({
          system,
          messages: [{
            role: "user",
            content: [
              requestContent,
              "The previous response failed JSON/schema validation.",
              "Repair it once. Return only a complete JSON array matching outputSchema.",
              `Previous response: ${response.slice(0, 12_000)}`,
            ].join("\n"),
          }],
          maxTokens: 6_000,
        });
        parsed = ClaudeReasonedMatchesSchema.parse(parseJson(response));
      }
      const matches = normalizeMatches(parsed, input);
      if (options.judgments) {
        const stored = await options.judgments.save({
          fingerprint,
          model,
          payload: matches,
          evidenceContextFingerprint: scope.contextFingerprint,
          evidenceBindingFingerprint: scope.bindingFingerprint,
        });
        return normalizeMatches(
          ClaudeReasonedMatchesSchema.parse(stored.payload),
          input,
        );
      }
      return matches;
    },
  };
}

async function replayJudgment(
  judgments: ReasonerJudgmentsRepository,
  fingerprint: string,
  input: MatchingInput,
): Promise<ReasonedMatch[] | null> {
  const record = await judgments.find(fingerprint);
  if (!record) return null;
  if (
    record.state !== "current"
    || record.evidenceContextFingerprint
      !== input.evidenceScope!.contextFingerprint
    || (
      input.evidenceScope!.evidenceMode === "live"
      && record.evidenceBindingFingerprint
        !== input.evidenceScope!.bindingFingerprint
    )
  ) return null;
  return normalizeMatches(ClaudeReasonedMatchesSchema.parse(record.payload), input);
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

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced?.[1] ?? trimmed);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
