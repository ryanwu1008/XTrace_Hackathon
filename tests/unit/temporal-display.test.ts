import assert from "node:assert/strict";
import test from "node:test";

import {
  formatReportDate,
  sourceHref,
} from "../../app/company-intelligence";
import { shortDate } from "../../app/page";
import { formatDate } from "../../app/underwriting-detail";

test("date-only evidence stays on its calendar day without an invented time in every UI path", () => {
  const previousTimeZone = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";

  try {
    const reportDate = formatReportDate("2026-07-23");
    const compactDate = shortDate("2026-07-23");
    const underwritingDate = formatDate("2026-07-23");

    assert.equal(reportDate, "Jul 23, 2026");
    assert.equal(compactDate, "Jul 23");
    assert.equal(underwritingDate, "Jul 23, 2026");
    for (const formatted of [reportDate, compactDate, underwritingDate]) {
      assert.doesNotMatch(formatted, /\d{1,2}:\d{2}/);
    }
  } finally {
    if (previousTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimeZone;
  }
});

test("timestamp UI paths retain their existing time display", () => {
  const previousTimeZone = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";

  try {
    const timestamp = "2026-07-24T00:34:00.000Z";
    assert.match(formatReportDate(timestamp), /Jul 23, 2026.*05:34 PM/);
    assert.match(shortDate(timestamp), /Jul 23.*05:34 PM/);
    assert.equal(formatDate(timestamp), "Jul 23, 2026");
  } finally {
    if (previousTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimeZone;
  }
});

test("legacy evidence UI links fail closed outside HTTP and HTTPS", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,malicious",
    "ftp://example.com/source",
  ]) {
    assert.equal(sourceHref({
      id: `unsafe_${url.slice(0, 3)}`,
      provenance: "public_web",
      title: "Unsafe legacy source",
      url,
      excerpt: "Legacy evidence.",
    }), undefined);
  }
  assert.equal(sourceHref({
    id: "safe_https",
    provenance: "public_web",
    title: "Safe legacy source",
    url: "https://example.com/source",
    excerpt: "Legacy evidence.",
  }), "https://example.com/source");
});
