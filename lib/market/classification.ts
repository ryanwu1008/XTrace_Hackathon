import { sourceTextForRetrieval } from "../contracts/source-evidence";
import { reidentifyMarketEvent } from "./identity";
import type { NormalizedMarketEvent } from "./types";

interface EvidenceRule {
  label: string;
  patterns: readonly RegExp[];
}

const SECTOR_RULES: readonly EvidenceRule[] = [
  {
    label: "artificial-intelligence",
    patterns: [/\bai\b/i, /\bartificial intelligence\b/i, /\bgenerative ai\b/i, /\blarge language model\b/i, /\bllm\b/i],
  },
  {
    label: "cybersecurity",
    patterns: [/\bcybersecurity\b/i, /\bcyber security\b/i, /\bransomware\b/i, /\bdata breach\b/i],
  },
  {
    label: "robotics",
    patterns: [/\brobot(?:ics|ic)?\b/i, /\bautonomous systems?\b/i, /\bphysical ai\b/i],
  },
  {
    label: "semiconductors",
    patterns: [/\bsemiconductors?\b/i, /\bchips?\b/i, /\bgpus?\b/i, /\bsilicon photonics\b/i],
  },
  {
    label: "healthcare",
    patterns: [/\bhealthcare\b/i, /\bmedical\b/i, /\bclinical\b/i, /\bdrug(?:s)?\b/i, /\bbiotech(?:nology)?\b/i],
  },
  {
    label: "financial-services",
    patterns: [/\bfintech\b/i, /\bbanking\b/i, /\bpayments?\b/i, /\bsecurities\b/i],
  },
  {
    label: "enterprise-software",
    patterns: [/\benterprise software\b/i, /\bsaas\b/i, /\bcloud software\b/i],
  },
  {
    label: "logistics",
    patterns: [/\blogistics\b/i, /\bfreight\b/i, /\bsupply chain\b/i],
  },
  {
    label: "energy",
    patterns: [/\benergy\b/i, /\boil\b/i, /\bnatural gas\b/i, /\bbatter(?:y|ies)\b/i],
  },
  {
    label: "manufacturing",
    patterns: [/\bmanufacturing\b/i, /\bfactor(?:y|ies)\b/i, /\bindustrial automation\b/i],
  },
  {
    label: "cannabis",
    patterns: [/\bcannabis\b/i, /\bmarijuana\b/i],
  },
];

const THEME_RULES: readonly EvidenceRule[] = [
  {
    label: "funding",
    patterns: [
      /\b(?:raises?|raised|raising|secures?|secured|closes?|closed)\b.{0,45}\b(?:funding|financing|capital|round)\b/i,
      /\b(?:seed|pre-seed|series [a-h])\s+(?:funding|financing|round)\b/i,
      /\bventure (?:funding|financing|investment|round)\b/i,
    ],
  },
  {
    label: "regulation",
    patterns: [
      /\b(?:adopts?|adopted|enacts?|enacted|issues?|issued)\b.{0,35}\b(?:final rule|regulation|regulatory requirements?|guidance|order)\b/i,
      /\b(?:final rule|new regulation|regulatory requirements?)\b.{0,55}\b(?:changes?|requires?|prohibits?|restricts?|expands?)\b/i,
      /\b(?:bans?|banned)\b.{0,55}\b(?:agreement|import|export|practice|product|sale|service|technology|transaction|use)\b/i,
      /\b(?:approves?|approved|authorizes?|authorized)\b.{0,55}\b(?:acquisition|application|drug|license|medical device|merger|rule|therapy|transaction|treatment)\b/i,
      /\b(?:imposes?|imposed|announces?|announced)\b.{0,35}\b(?:sanctions?|tariffs?)\b/i,
      /\b(?:enforcement action|antitrust lawsuit|regulatory settlement|export controls?|new tariffs?)\b/i,
    ],
  },
  {
    label: "technology",
    patterns: [
      /\b(?:launches?|launched|releases?|released|unveils?|unveiled|introduces?|introduced)\b.{0,55}\b(?:model|chip|gpu|platform|technology|robot|software|system)\b/i,
      /\b(?:technology|scientific|engineering)\s+breakthrough\b/i,
      /\bopen[- ]sources?\b.{0,45}\b(?:model|software|platform|technology)\b/i,
    ],
  },
  {
    label: "commercial-traction",
    patterns: [
      /\b(?:wins?|won|signs?|signed|receives?|received)\b.{0,45}\b(?:contract|purchase order|customer|deployment)\b/i,
      /\b(?:acquires?|acquired|acquisition|merger|strategic partnership)\b/i,
    ],
  },
  {
    label: "macroeconomic-change",
    patterns: [
      /\b(?:interest rates?|inflation|recession|war|armed conflict)\b.{0,55}\b(?:rises?|falls?|changes?|cuts?|increases?|decreases?|disrupts?)\b/i,
      /\b(?:oil prices?|supply chain|chip shortage|energy prices?)\b.{0,55}\b(?:rises?|falls?|changes?|disrupts?|tightens?|eases?)\b/i,
    ],
  },
];

function evidenceText(event: NormalizedMarketEvent): string {
  return [
    event.title,
    event.summary,
    ...event.sources.map(sourceTextForRetrieval),
  ].join(" ");
}

function matchingLabels(text: string, rules: readonly EvidenceRule[]): string[] {
  return rules
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(text)))
    .map((rule) => rule.label);
}

export function classifyMarketEventForAnalysis(
  event: NormalizedMarketEvent,
): NormalizedMarketEvent | null {
  const text = evidenceText(event);
  const themes = matchingLabels(text, THEME_RULES);
  if (themes.length === 0) return null;

  const sectors = matchingLabels(text, SECTOR_RULES);
  if (
    JSON.stringify(event.sectors) === JSON.stringify(sectors)
    && JSON.stringify(event.themes) === JSON.stringify(themes)
  ) {
    return event;
  }

  return reidentifyMarketEvent({
    ...event,
    sectors,
    themes,
  });
}
