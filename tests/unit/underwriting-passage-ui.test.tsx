import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { UnderwritingDetailPanel } from "../../app/underwriting-detail";
import { toVersionedCandidateUnderwritingDetail } from
  "../../lib/underwriting/read-model";
import { createCurrentNamedLensFinalizationFixture } from
  "../helpers/current-named-lens-finalization";

function renderCurrentMemo(): string {
  const fixture = createCurrentNamedLensFinalizationFixture();
  const finalization = fixture.finalization;
  const detail = toVersionedCandidateUnderwritingDetail({
    bundle: {
      ...finalization,
      sourceCandidateRunId: finalization.candidateRunId,
      workspaceId: finalization.evidencePack.workspaceId,
      dealId: finalization.evidencePack.dealId,
      claimEdges: [],
      namedLensProviderAttempts: fixture.persistedAttempts,
    },
    adapter: {
      kind: "current",
      schemaVersion: "decision-first-named-lens-v1",
    },
  });
  return renderToStaticMarkup(<UnderwritingDetailPanel
    companyName="Current Lens Co"
    analysis={null}
    detail={detail}
    drafts={[]}
    canSaveDrafts={false}
    onEditDraft={() => {}}
  />);
}

test("current memo is a semantic single-column editorial reading experience", () => {
  const html = renderCurrentMemo();
  const css = readFileSync(
    new URL("../../app/underwriting-memo.css", import.meta.url),
    "utf8",
  );

  assert.match(html, /<article[^>]*class="underwriting-passage"/);
  assert.match(html, /<h2[^>]*>Named Lens Readings<\/h2>/);
  assert.equal((html.match(/<section[^>]*class="underwriting-memo-section"/g) ?? []).length, 7);
  assert.match(html, /<a[^>]*href="https:\/\//);
  assert.match(html, /<details[^>]*class="underwriting-audit-appendix"/);
  assert.match(html, /<summary[^>]*>Audit Appendix/);
  assert.match(html, /DRAFT ONLY/);
  assert.match(html, /SAMPLE|SYNTHETIC/);
  assert.doesNotMatch(html, /<table[^>]*class="vsee-framework-synthesis-table"/);
  assert.match(css, /font-size:17px;line-height:1\.68/);
  assert.match(css, /@media\(max-width:600px\)[\s\S]*font-size:16px/);
  assert.match(
    css,
    /\.underwriting-audit-identities dt\{[^}]*font:700 16px/,
  );
  assert.match(
    css,
    /\.underwriting-audit-identities dd\{[^}]*font:400 16px/,
  );
  assert.match(
    css,
    /\.underwriting-audit-records pre\{[^}]*font:400 16px/,
  );
  assert.match(
    css,
    /@media\(max-width:600px\)[\s\S]*\.underwriting-audit-appendix table\{[^}]*table-layout:fixed;min-width:0;font-size:16px/,
  );
  assert.match(
    css,
    /\.underwriting-audit-appendix th,\.underwriting-audit-appendix td\{[^}]*overflow-wrap:anywhere/,
  );
  assert.match(css, /:focus-visible/);
  assert.doesNotMatch(css, /grid-template-columns:[^;]*(?:2fr|repeat\(2)/);
  assert.doesNotMatch(
    css,
    /\.underwriting-audit-(?:appendix|identities|records)[^{}]*\{[^}]*font(?:-size)?:[^;}]*(?:1[0-5])px/,
  );
});
