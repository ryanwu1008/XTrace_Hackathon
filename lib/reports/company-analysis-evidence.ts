import {
  CompanyAnalysisSchema,
  type CompanyAnalysis,
} from "../contracts/domain";
import { assertMarketEventFingerprint } from "../market/identity";

/** Parse a report artifact and verify every canonical embedded event digest. */
export function parseCompanyAnalysisEvidence(
  value: unknown,
): CompanyAnalysis {
  const analysis = CompanyAnalysisSchema.parse(value);
  for (const event of analysis.marketEvidence.events) {
    if ("schemaVersion" in event && event.adaptation === "canonical") {
      assertMarketEventFingerprint(event);
    }
  }
  return analysis;
}

export function safeParseCompanyAnalysisEvidence(
  value: unknown,
): CompanyAnalysis | null {
  try {
    return parseCompanyAnalysisEvidence(value);
  } catch {
    return null;
  }
}
