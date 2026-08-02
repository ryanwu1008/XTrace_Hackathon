import { ClaudeReasonedMatchesSchema } from "./schemas";
import type { ClaudeClient } from "./client";
import type { MatchingInput, ReasonedMatch } from "../matching/service";
import {
  serializeMatchingEvidence,
  stableEvidencePromptJson,
} from "../matching/prompt-evidence";

function evidencePrompt(input: MatchingInput) {
  const evidence = serializeMatchingEvidence(input);
  return stableEvidencePromptJson({
    deals: input.deals,
    events: evidence.marketEvents,
    memoryContexts: input.memoryContexts,
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
        "Sources with factEligible false are retrieval context only and cannot support output facts.",
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
