import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("the fixed Irregular Deep Underwrite dialog embeds the semantic English report without generation controls", async () => {
  const reportModule = await import("../../app/fixed-deep-underwrite-report");
  const html = renderToStaticMarkup(createElement(
    reportModule.FixedDeepUnderwriteReport,
    { open: true, onClose() {} },
  ));

  assert.match(html, /role="dialog"/iu);
  assert.match(html, /Portfolio Risk Reunderwriting/iu);
  assert.match(html, /English semantic edition/iu);
  assert.match(html, /Synthetic financial inputs/iu);
  assert.match(html, /Not investment advice/iu);
  assert.match(
    html,
    /vsee-irregular-sample-underwriting-english-semantic-edition\.pdf#view=FitH/iu,
  );
  assert.match(html, /Open full report/iu);
  assert.match(html, /Download PDF/iu);
  assert.doesNotMatch(html, /generate|provider|model request/iu);
});

test("the fixed report dialog renders nothing while closed", async () => {
  const reportModule = await import("../../app/fixed-deep-underwrite-report");
  assert.equal(renderToStaticMarkup(createElement(
    reportModule.FixedDeepUnderwriteReport,
    { open: false, onClose() {} },
  )), "");
});
