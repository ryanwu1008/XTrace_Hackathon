import type { ChatEvidence } from "../chat/service";
import type { EvidenceSourceRef, SourceRef } from "../contracts/domain";
import { validateEvidenceSourceCatalog } from "../contracts/evidence-catalog";
import { DEMO_DEAL_EVIDENCE } from "../corpus/evidence";
import { DEMO_FIXTURES } from "../corpus/fixtures";
import { DEMO_MARKET_REPORT_EVIDENCE } from "../corpus/market-evidence";
import { interactionSourceV2 } from "../matching/context";
import { buildDemoViewModel } from "./view-model";

const STOP_WORDS = new Set([
  "about",
  "as",
  "company",
  "companies",
  "deal",
  "did",
  "do",
  "does",
  "for",
  "from",
  "happened",
  "have",
  "is",
  "it",
  "know",
  "mark",
  "marked",
  "relate",
  "related",
  "relates",
  "say",
  "show",
  "tell",
  "think",
  "the",
  "this",
  "was",
  "we",
  "what",
  "when",
  "which",
  "why",
  "with",
]);

export function evidenceQueryTokens(text: string) {
  return text.toLocaleLowerCase()
    .split(/[^\p{L}\p{N}+.-]+/u)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function documentSource(
  deal: ReturnType<typeof buildDemoViewModel>["deals"][number],
): SourceRef | null {
  const evidence = DEMO_DEAL_EVIDENCE.find((item) => item.dealId === deal.id);
  if (!evidence) return null;
  return {
    id: evidence.id,
    provenance: "source_document",
    title: deal.sourceTitle,
    documentId: deal.documentId,
    page: evidence.page,
    excerpt: evidence.excerpt,
  };
}

function fixtureSource(
  deal: ReturnType<typeof buildDemoViewModel>["deals"][number],
): EvidenceSourceRef | null {
  const fixture = DEMO_FIXTURES.find((candidate) =>
    candidate.dealId === deal.id
  );
  return fixture
    ? interactionSourceV2({ ...fixture, summary: fixture.meetingSummary })
    : null;
}

export function searchDemoEvidence(question: string): ChatEvidence[] {
  const queryTokens = evidenceQueryTokens(question);
  if (!queryTokens.length) return [];
  const model = buildDemoViewModel();
  const dealEvidence = model.deals.flatMap((deal) => {
    const source = documentSource(deal);
    if (!source) return [];
    const searchable = [
      deal.companyName,
      deal.status,
      deal.sourceTitle,
      source.excerpt,
      deal.fixture?.meetingSummary,
      deal.fixture?.decisionReason,
      ...(deal.fixture?.concerns ?? []),
      ...(deal.fixture?.revisitConditions ?? []),
    ].join(" ");
    const searchableTokens = new Set(evidenceQueryTokens(searchable));
    const matches = queryTokens.filter((token) => searchableTokens.has(token));
    if (matches.length !== queryTokens.length) return [];
    const companyTokens = new Set(evidenceQueryTokens(deal.companyName));
    const score = matches.length
      + queryTokens.filter((token) => companyTokens.has(token)).length * 100;

    const sources: EvidenceSourceRef[] = [source];
    const fixture = fixtureSource(deal);
    if (fixture) sources.push(fixture);
    const fixtureContext = deal.fixture
      ? [
          `Synthetic decision state: ${deal.status}.`,
          `Decision reason: ${deal.fixture.decisionReason}.`,
          deal.fixture.meetingSummary,
          `Concerns: ${deal.fixture.concerns.join(" ")}`,
          `Revisit conditions: ${deal.fixture.revisitConditions.join(" ")}`,
        ].join(" ")
      : "No synthetic VC decision record is attached to this Deal.";
    return [{
      score,
      text: `${deal.companyName} is associated with ${deal.sourceTitle}. ${fixtureContext}`,
      sources,
    }];
  });
  const reportEvidence = DEMO_MARKET_REPORT_EVIDENCE.flatMap((evidence) => {
    const searchableTokens = new Set(evidenceQueryTokens([
      evidence.fact,
      evidence.source.title,
      evidence.source.excerpt,
    ].join(" ")));
    const score = queryTokens.filter((token) => searchableTokens.has(token)).length;
    return score === queryTokens.length
      ? [{ score, text: evidence.fact, sources: [evidence.source] }]
      : [];
  });
  const candidates = [...dealEvidence, ...reportEvidence]
    .sort((left, right) => right.score - left.score);
  validateEvidenceSourceCatalog(
    candidates.flatMap((candidate) => candidate.sources),
    "demo search source",
  );
  return candidates
    .slice(0, 12)
    .map(({ text, sources }) => ({ text, sources }));
}
