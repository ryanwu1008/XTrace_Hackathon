import { ClaudeChatAnswerSchema } from "../claude/schemas";
import {
  type EvidenceSourceRef,
} from "../contracts/domain";
import { parseSourceRefV2Read } from "../contracts/legacy-evidence-adapter";
import {
  assertConsistentCanonicalEvidenceUnits,
  sourceCanGroundOutputFact,
  uniqueByCanonicalId,
  type SourceRefV2,
} from "../contracts/source-evidence";

export interface ChatEvidence {
  text: string;
  sources: EvidenceSourceRef[];
}

export type ChatMemoryStatus = "disabled" | "available" | "unavailable";

export type MemoryRecallOutcome =
  | { status: "available"; evidence: ChatEvidence[] }
  | { status: "unavailable" };

export interface ChatAnswer {
  answer: string;
  citations: EvidenceSourceRef[];
  usedXTrace: boolean;
  memoryStatus: ChatMemoryStatus;
  insufficientEvidence: boolean;
}

interface GroundedChatDependencies {
  searchExistingData(input: {
    workspaceId: string;
    question: string;
  }): Promise<ChatEvidence[]>;
  recallMemory(input: {
    workspaceId: string;
    question: string;
  }): Promise<MemoryRecallOutcome>;
  complete(input: {
    system: string;
    prompt: string;
  }): Promise<string>;
}

export function createGroundedChatService(dependencies: GroundedChatDependencies) {
  return {
    async answer(input: {
      workspaceId: string;
      question: string;
      xtraceEnabled: boolean;
    }): Promise<ChatAnswer> {
      const rawLocalEvidence = await dependencies.searchExistingData(input);
      const recall = input.xtraceEnabled
        ? await dependencies.recallMemory(input)
        : { status: "disabled" as const };
      if (recall.status === "unavailable") {
        return {
          answer: "XTrace recall is currently unavailable, so the local-only answer was withheld to avoid presenting incomplete memory as complete.",
          citations: [],
          usedXTrace: false,
          memoryStatus: "unavailable",
          insufficientEvidence: true,
        };
      }
      const rawMemoryEvidence = recall.status === "available"
        ? recall.evidence
        : [];
      const rawSources = uniqueByCanonicalId(
        [...rawLocalEvidence, ...rawMemoryEvidence].flatMap((item) =>
          item.sources
        ),
        "chat evidence source",
      );
      assertConsistentCanonicalEvidenceUnits(
        rawSources.map(parseSourceRefV2Read),
      );
      const localEvidence = normalizeEvidence(rawLocalEvidence);
      const memoryEvidence = normalizeEvidence(rawMemoryEvidence);
      if (input.xtraceEnabled && memoryEvidence.length === 0) {
        return {
          answer: "XTrace recall is currently unavailable, so the local-only answer was withheld to avoid presenting incomplete memory as complete.",
          citations: [],
          usedXTrace: false,
          memoryStatus: "unavailable",
          insufficientEvidence: true,
        };
      }
      const memoryStatus: ChatMemoryStatus = recall.status;
      const evidence = [...localEvidence, ...memoryEvidence];
      if (evidence.length === 0) {
        return {
          answer: "The existing Deal memory and reports do not contain enough evidence to answer that question.",
          citations: [],
          usedXTrace: false,
          memoryStatus,
          insufficientEvidence: true,
        };
      }

      const sources = new Map<string, EvidenceSourceRef>();
      const evidenceTextBySource = new Map<string, string[]>();
      for (const item of evidence) {
        for (const source of item.sources) {
          sources.set(source.id, source);
          evidenceTextBySource.set(source.id, [
            ...(evidenceTextBySource.get(source.id) ?? []),
            item.text,
          ]);
        }
      }
      const text = await dependencies.complete({
        system: [
          "Answer only from supplied evidence.",
          "Return JSON with claims and insufficientEvidence.",
          "Every claim.text must be copied verbatim from at least one cited evidence item.",
          "Every claim.text must equal one complete evidence item, character for character; never take a substring or remove a qualifier or negation.",
          "Every claim.sourceIds value must identify evidence that exactly equals that text.",
          "Evidence marked normalized_non_quote is a normalized statement and must never be presented as a verbatim quotation.",
          "Only evidence marked exact_quote is eligible to be presented as a verbatim quotation.",
          "Do not infer, combine, or add facts that are not explicitly present.",
        ].join(" "),
        prompt: JSON.stringify({
          question: input.question,
          evidence: evidence.map((item, index) => ({
            index: index + 1,
            text: item.text,
            textStatus: item.textStatus,
            supportKind: item.supportKind,
            quoteEligible: item.supportKind === "exact_quote",
            sourceIds: item.sources.map((source) => source.id),
          })),
        }),
      });
      let parsed;
      try {
        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
        parsed = ClaudeChatAnswerSchema.parse(
          JSON.parse((fenced?.[1] ?? text).trim()),
        );
      } catch {
        return {
          answer: "The model response could not be verified against the available evidence.",
          citations: [],
          usedXTrace: memoryEvidence.length > 0,
          memoryStatus,
          insufficientEvidence: true,
        };
      }
      const supportedClaims = parsed.claims.filter((claim) =>
        claim.sourceIds.length > 0 &&
        claim.sourceIds.every((sourceId) => {
          if (!sources.has(sourceId)) return false;
          return (evidenceTextBySource.get(sourceId) ?? [])
            .some((evidenceText) => evidenceText === claim.text);
        })
      );
      const citationIds = [...new Set(
        supportedClaims.flatMap((claim) => claim.sourceIds),
      )];
      const citations = citationIds.flatMap((sourceId) => {
        const source = sources.get(sourceId);
        return source ? [source] : [];
      });
      if (!parsed.insufficientEvidence && supportedClaims.length === 0) {
        return {
          answer: "The available context did not provide a verifiable claim.",
          citations: [],
          usedXTrace: memoryEvidence.length > 0,
          memoryStatus,
          insufficientEvidence: true,
        };
      }
      return {
        answer: supportedClaims.map((claim) => claim.text).join(" "),
        citations,
        usedXTrace: memoryEvidence.length > 0,
        memoryStatus,
        insufficientEvidence: parsed.insufficientEvidence || supportedClaims.length === 0,
      };
    },
  };
}

interface GroundableChatEvidence extends ChatEvidence {
  textStatus: "verified_exact" | "normalized_only";
  supportKind: "exact_quote" | "normalized_non_quote";
  sources: [SourceRefV2];
}

function normalizeEvidence(evidence: ChatEvidence[]): GroundableChatEvidence[] {
  const normalized = evidence.flatMap((item) =>
    item.sources.flatMap((source): GroundableChatEvidence[] => {
      const parsed = parseSourceRefV2Read(source);
      if (!sourceCanGroundOutputFact(parsed)) return [];
      if (parsed.text.status === "verified_exact") {
        return [{
          text: parsed.text.verbatimExcerpt,
          textStatus: "verified_exact",
          supportKind: "exact_quote",
          sources: [parsed],
        }, ...(parsed.text.normalizedStatement === undefined
          ? []
          : [{
              text: parsed.text.normalizedStatement,
              textStatus: "verified_exact" as const,
              supportKind: "normalized_non_quote" as const,
              sources: [parsed] as [SourceRefV2],
            }])];
      }
      return [{
        text: parsed.text.normalizedStatement,
        textStatus: "normalized_only",
        supportKind: "normalized_non_quote",
        sources: [parsed],
      }];
    })
  );
  return [...new Map(normalized.map((item) => [
    `${item.sources[0].id}:${item.text}`,
    item,
  ])).values()];
}
