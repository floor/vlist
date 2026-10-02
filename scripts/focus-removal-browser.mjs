/** Reproduction of #339 in a real browser: a focused cell descendant whose
 * row a programmatic scroll removes must not throw.
 *
 * Chromium fires focusout synchronously while the focused node is detached, so
 * this is the path the JSDOM tests cannot reach (happy-dom implements no focus
 * fixup). Page 1 is the reported reproduction (table + a11y({keyboard:false}));
 * page 2 keeps a11y's keyboard on to show that ArrowUp still moves from the
 * focus target the handoff left behind, as the a11y plugin documents.
 *
 * Build first. Uses scripts/browser-driver.mjs; VLIST_BROWSER_DRIVER overrides
 * it with another module exporting launchBrowser.
 *
 * The coordinator wires this script into `test:browser` after merge;
 * package.json is left untouched here.
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";

const driver = process.env.VLIST_BROWSER_DRIVER ?? resolve(import.meta.dir, "browser-driver.mjs");
const { launchBrowser } = await import(resolve(driver));
const root = resolve(import.meta.dir, "..");

const pageStyle = `<style>
  body{margin:16px;font:14px sans-serif}
  #list{width:480px;height:320px;border:1px solid #ccc}
</style>`;

/** table(...) + a11y: the reported configuration. The cell template returns a
 *  focusable span, so a cell descendant can hold DOM focus. */
const listHtml = (a11yConfig) => `<!doctype html>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/vlist.css">
<link rel="stylesheet" href="/vlist-table.css">
${pageStyle}
<div id="list"></div>
<script type="module">
import { createVList, table, a11y } from "/index.js";
const items = Array.from({ length: 50000 }, (_, id) => ({ id, value: "Row " + id }));
window.list = createVList({
  container: "#list",
  items,
  item: { height: 48, template: () => "" },
}, [
  table({
    rowHeight: 48,
    columns: [{ key: "value", label: "Value", width: 240, cell: (row) => {
      const span = document.createElement("span");
      span.tabIndex = 0;
      span.textContent = row.value;
      return span;
    } }],
  }),
  a11y(${a11yConfig}),
]);
window.ready = true;
</script>`;

const server = Bun.serve({
  port: 0,
  fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/") return new Response(listHtml("{ keyboard: false }"), { headers: { "Content-Type": "text/html" } });
    if (path === "/keyboard") return new Response(listHtml("{}"), { headers: { "Content-Type": "text/html" } });
    if (path === "/index.js" || path === "/vlist.css" || path === "/vlist-table.css") {
      return new Response(Bun.file(`${root}/dist${path}`));
    }
    return new Response("Not found", { status: 404 });
  },
});

/** Focus a cell descendant of the first rendered row, scroll its row away, and
 *  report where focus, the DOM and the list ended up. */
const scrollFocusedRowAway = () => {
  const span = document.querySelector(".vlist-content span");
  if (!span) throw new Error("no focusable cell rendered");
  span.focus();
  const focused = document.activeElement === span;
  window.list.scrollToIndex(49999, "center");
  const after = document.activeElement;
  return {
    focusedWasCell: focused,
    activeIsViewport: after === document.querySelector(".vlist-viewport"),
    activeIsContent: after === document.querySelector(".vlist-content"),
    activeTag: after ? after.tagName : null,
    activeClass: after ? after.className : null,
    // The focused span itself, not any span: the far rows render their own.
    focusedCellStillInDom: span.isConnected,
    farRowRendered: !!document.querySelector('[data-index="49999"]'),
    farRowText: (document.querySelector(".vlist-content").textContent ?? "").includes("Row 49999"),
    contentTabindex: document.querySelector(".vlist-content").getAttribute("tabindex"),
    activedescendant: document.querySelector(".vlist-content").getAttribute("aria-activedescendant"),
    scrollPosition: window.list.getScrollPosition(),
  };
};

const browser = await launchBrowser();
try {
  console.log(await browser.version());
  const errors = [];

  // ── Page 1: the reported reproduction ──────────────────────────────
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setViewport({ width: 900, height: 700 });
  await page.goto(`http://localhost:${server.port}/`);
  await page.waitForFunction(() => window.ready);

  const before = await page.evaluate(() => ({
    rendered: document.querySelectorAll(".vlist-item, .vlist-table-row").length,
    hasSpan: !!document.querySelector(".vlist-content span"),
  }));
  assert(before.hasSpan, `a focusable cell must be rendered before the scroll: ${JSON.stringify(before)}`);

  const afterScroll = await page.evaluate(scrollFocusedRowAway);
  assert(afterScroll.focusedWasCell, "the cell descendant must hold DOM focus before the scroll");
  assert(afterScroll.scrollPosition > 0, `scrollToIndex must move the list: ${JSON.stringify(afterScroll)}`);
  assert(afterScroll.farRowRendered, `the far row must be rendered: ${JSON.stringify(afterScroll)}`);
  assert(afterScroll.farRowText, `the far row's text must be rendered: ${JSON.stringify(afterScroll)}`);
  assert(!afterScroll.focusedCellStillInDom, `the focused row must be gone: ${JSON.stringify(afterScroll)}`);
  // Table mode: table() sets role=rowgroup on .vlist-content (priority 10,
  // before a11y's enableListbox at 55), so the content keeps no tabindex and
  // the viewport — which always carries tabindex="-1" — is the focus target.
  assert.equal(afterScroll.contentTabindex, null, `table mode must not make the content a listbox: ${JSON.stringify(afterScroll)}`);
  assert(afterScroll.activeIsViewport, `focus must be handed to .vlist-viewport, got ${JSON.stringify(afterScroll)}`);
  assert.equal(errors.length, 0, `scrollToIndex of a focused row must not throw: ${errors.join(" | ")}`);

  console.log("PASS table + a11y({keyboard:false}): focused cell scrolled away, focus on .vlist-viewport, no pageerror", JSON.stringify(afterScroll));
  await page.close();

  // ── Page 2: keyboard still works from the new focus target ─────────
  const keyboardPage = await browser.newPage();
  keyboardPage.on("pageerror", (e) => errors.push(String(e)));
  await keyboardPage.setViewport({ width: 900, height: 700 });
  await keyboardPage.goto(`http://localhost:${server.port}/keyboard`);
  await keyboardPage.waitForFunction(() => window.ready);

  const kbAfterScroll = await keyboardPage.evaluate(scrollFocusedRowAway);
  assert(kbAfterScroll.focusedWasCell, "the cell descendant must hold DOM focus before the scroll");
  assert(kbAfterScroll.activeIsViewport, `focus must be handed to .vlist-viewport, got ${JSON.stringify(kbAfterScroll)}`);
  assert.equal(errors.length, 0, `scrollToIndex of a focused row must not throw: ${errors.join(" | ")}`);

  // a11y's keydown handler is bound to the root, so it hears keys from the
  // viewport it was handed: the move sets aria-activedescendant, reveals the
  // item, and keeps DOM focus on the target, exactly as its docs describe.
  const beforeKey = await keyboardPage.evaluate(() => ({
    activedescendant: document.querySelector(".vlist-content").getAttribute("aria-activedescendant"),
    scrollPosition: window.list.getScrollPosition(),
  }));

  await keyboardPage.keyboard.press("ArrowDown");
  await keyboardPage.waitForFunction(
    (previous) => document.querySelector(".vlist-content").getAttribute("aria-activedescendant") !== previous,
    { timeout: 2000 },
    beforeKey.activedescendant,
  );

  const afterKey = await keyboardPage.evaluate(() => {
    const ad = document.querySelector(".vlist-content").getAttribute("aria-activedescendant");
    return {
      activedescendant: ad,
      // The table renderer gives each row id `${prefix}-item-${index}`, which
      // is the id a11y points aria-activedescendant at.
      describedRowInDom: ad !== null && document.getElementById(ad) !== null,
      scrollPosition: window.list.getScrollPosition(),
      activeIsViewport: document.activeElement === document.querySelector(".vlist-viewport"),
    };
  });

  assert(afterKey.activedescendant !== null, `ArrowDown must move from the focus target: ${JSON.stringify(afterKey)}`);
  assert(afterKey.describedRowInDom, `aria-activedescendant must name a rendered row: ${JSON.stringify(afterKey)}`);
  assert(afterKey.scrollPosition !== beforeKey.scrollPosition, `the move must reveal its item: ${JSON.stringify({ beforeKey, afterKey })}`);
  assert(afterKey.activeIsViewport, `a11y keeps DOM focus on its target and moves aria-activedescendant: ${JSON.stringify(afterKey)}`);

  await keyboardPage.keyboard.press("ArrowUp");
  await keyboardPage.keyboard.press("ArrowDown");
  assert.equal(errors.length, 0, `keyboard navigation after the handoff must not throw: ${errors.join(" | ")}`);

  console.log("PASS a11y keyboard: ArrowDown moves from the handed-off focus target, no pageerror", JSON.stringify(afterKey));
  await keyboardPage.close();

  assert.equal(errors.length, 0, `no pageerror expected across both pages: ${errors.join(" | ")}`);
  console.log("PASS focus-removal: no pageerror in the browser on either page");
} finally {
  await browser.close();
  server.stop();
}
