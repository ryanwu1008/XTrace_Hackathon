import { ClaudeReasonedMatchesSchema } from "./schemas";
import type { ClaudeClient } from "./client";
import type { MatchingInput, ReasonedMatch } from "../matching/service";
import {
  serializeMatchingPromptInput,
  stableEvidencePromptJson,
} from "../matching/prompt-evidence";

function evidencePrompt(input: MatchingInput) {
  const evidence = serializeMatchingPromptInput(input);
  return stableEvidencePromptJson({
    deals: evidence.deals,
    events: evidence.marketEvents,
    memoryContexts: evidence.memoryContexts,
    sources: evidence.sources,
  });
}

export function parseClaudeJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse((fenced?.[1] ?? text).trim()) as unknown;
}

export function createClaudeReasoner(client: ClaudeClient) {
  return {
    async reason(input: MatchingInput): Promise<ReasonedMatch[]> {
      const system = [
        "You are an evidence-grounded VC analyst.",
        "Use only the supplied evidence.",
        "Separate external facts from Demo fixture decision context.",
        "Every factual sentence must have source IDs in claimSourceIds.",
        "Use verbatimExcerpt only when quoteEligible is true.",
        "normalizedStatement is non-quote evidence and must never be represented as a direct quotation.",
        "Each claim must equal one complete eligible evidence unit, character for character. Never shorten an evidence unit or remove a qualifier or negation.",
        "Sources with factEligible false are retrieval context only and cannot support output facts.",
        "Return observations only. Never choose direction, status, actions, gates, outcome, rank, formal decision, or a recommended next move.",
        "Select one supplied accepted trigger event and one same-Deal Sample decision record with its exact revisit-condition index and text.",
        "Return JSON only. Return [] when evidence is insufficient.",
      ].join(" ");
      const prompt = `Assess which historical Deals deserve review.\n${evidencePrompt(input)}`;
      let text = await client.complete({
        system,
        messages: [{ role: "user", content: prompt }],
      });
      let parsed: unknown;
      try {
        parsed = parseClaudeJson(text);
        return ClaudeReasonedMatchesSchema.parse(parsed);
      } catch (error) {
        text = await client.complete({
          system,
          messages: [{
            role: "user",
            content: `${prompt}\nYour previous output failed validation: ${String(error)}. Return valid JSON only.`,
          }],
        });
        parsed = parseClaudeJson(text);
        return ClaudeReasonedMatchesSchema.parse(parsed);
      }
    },
  };
}
