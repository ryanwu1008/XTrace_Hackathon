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

function readAppCss(name: "underwriting-memo.css" | "vsee.css"): string {
  return readFileSync(new URL(`../../app/${name}`, import.meta.url), "utf8");
}

function cssAtRuleBlocks(css: string, atRule: string): string[] {
  const blocks: string[] = [];
  let cursor = 0;
  while (cursor < css.length) {
    const atRuleIndex = css.indexOf(`${atRule}{`, cursor);
    if (atRuleIndex < 0) break;
    const openingBrace = atRuleIndex + atRule.length;
    let depth = 0;
    let closingBrace = -1;
    for (let index = openingBrace; index < css.length; index += 1) {
      if (css[index] === "{") depth += 1;
      if (css[index] === "}") depth -= 1;
      if (depth === 0) {
        closingBrace = index;
        break;
      }
    }
    assert.ok(closingBrace > openingBrace, `${atRule} must have balanced braces`);
    blocks.push(css.slice(openingBrace + 1, closingBrace));
    cursor = closingBrace + 1;
  }
  return blocks;
}

test("current memo is a semantic single-column editorial reading experience", () => {
  const html = renderCurrentMemo();
  const css = readAppCss("underwriting-memo.css");

  assert.match(html, /<article[^>]*class="underwriting-passage"/);
  assert.match(html, /<h2[^>]*>Named Lens Readings<\/h2>/);
  assert.equal((html.match(/<section[^>]*class="underwriting-memo-section"/g) ?? []).length, 7);
  assert.match(html, /<a[^>]*href="https:\/\//);
  assert.match(html, /<details[^>]*class="underwriting-audit-appendix"/);
  assert.match(html, /<summary[^>]*>Audit Appendix/);
  assert.match(html, /DRAFT ONLY/);
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

test("rendered memo targets stay readable through the shell's 680px breakpoint", () => {
  const html = renderCurrentMemo();
  const memoCss = readAppCss("underwriting-memo.css");
  const shellCss = readAppCss("vsee.css");
  const memoTabletBlocks = cssAtRuleBlocks(
    memoCss,
    "@media(max-width:680px)",
  );
  const shellMobileBlocks = cssAtRuleBlocks(
    shellCss,
    "@media(max-width:680px)",
  );

  assert.match(html, /<main[^>]*class="underwriting-memo"/);
  assert.match(html, /<p/);
  assert.match(html, /<li/);
  assert.match(
    html,
    /class="underwriting-passage-sources"[\s\S]*?<a[^>]*href="https:\/\//,
  );
  assert.match(
    shellCss,
    /\.vsee-shell :where\(p,li\)\{[^}]*font-size:var\(--vsee-type-body\)!important/,
  );
  assert.ok(
    shellMobileBlocks.some((block) =>
      /\.vsee-shell\{--vsee-type-body:15px/.test(block)
    ),
    "the shell must expose the 15px cascade that this contract overrides",
  );
  assert.equal(memoTabletBlocks.length, 1);
  const memoTabletContract = memoTabletBlocks[0]!;
  assert.match(
    memoTabletContract,
    /\.vsee-shell \.underwriting-memo :where\(p,li\):not\(\.underwriting-status,\.underwriting-draft-notice\)\{[^}]*font-size:16px!important/,
  );
  assert.match(
    memoTabletContract,
    /\.underwriting-passage-sources a,\.underwriting-decision-reason-sources a\{[^}]*min-width:44px;[^}]*min-height:44px/,
  );
  assert.match(
    memoCss,
    /\.underwriting-draft-notice\{[^}]*font:[^;}]*12px[^;}]*!important/,
  );
});

test("current memo owns a reachable scroll region without hiding overflow", () => {
  const css = readAppCss("underwriting-memo.css");

  assert.match(
    css,
    /\.underwriting-memo\{[^}]*min-height:0;[^}]*max-height:100%;[^}]*overflow:auto/,
  );
  assert.doesNotMatch(
    css,
    /\.underwriting-memo\{[^}]*overflow(?:-x|-y)?:hidden/,
  );
});

test("underwriting detail entry and close controls have 44px interaction targets", () => {
  const css = readAppCss("vsee.css");

  assert.match(
    css,
    /\.vsee-underwriting-row>button\{[^}]*min-height:44px/,
  );
  assert.match(
    css,
    /\.vsee-underwriting-dialog-card>header button\{[^}]*width:44px;[^}]*height:44px/,
  );
});
