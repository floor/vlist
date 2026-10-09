/** groups() + autosize(): rows measured in the data space, elements looked up
 * in the layout space (#363). Build first. VLIST_BROWSER_DRIVER supplies
 * launchBrowser (default Chromium). VLIST_GROUPS_AUTOSIZE_ROOT can serve a
 * scratch baseline build without changing this tree.
 *
 * Fixtures use NON-UNIFORM content heights: with uniform heights a misrouted
 * measurement stores the right number under the wrong key and nothing shows.
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";
const { launchBrowser } = await import(resolve(process.env.VLIST_BROWSER_DRIVER ?? resolve(import.meta.dir, "browser-driver.mjs")));
const { pinPage, settle } = await import(resolve(import.meta.dir, "browser-page.mjs"));
const root = process.env.VLIST_GROUPS_AUTOSIZE_ROOT ?? resolve(import.meta.dir, "..");

const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/vlist.css">
<style>body{margin:16px}#list{width:360px;height:320px}</style>
<div id="list"></div>
<script type="module">
import {createVList,groups,autosize} from '/index.js';
const params = new URLSearchParams(location.search);
const scenario = params.get('scenario');
// Non-uniform content heights: a header's measurement landing under a row is
// visible; four equal rows would hide half the bug.
const HEIGHTS = [60, 90, 120, 150];
const item = h => ({height: h});
const items = Array.from({length: 40}, (_, id) => ({id}));
const itemTemplate = scenario === 'scroll'
  ? (row) => \`<div style="height:\${60 + (row.id * 37) % 90}px">Item \${row.id}</div>\`
  : (row) => \`<div style="height:\${HEIGHTS[row.id % 4]}px">Item \${row.id}</div>\`;
const plugins = [autosize()];
if (scenario !== 'control') plugins.push(groups({
  getGroupForIndex: (i) => (i < (scenario === 'scroll' ? 20 : 2) ? 'A' : 'B'),
  header: {height: 30, template: (g) => g},
}));
window.list = createVList({
  container: '#list',
  items: scenario === 'scroll' ? items : items.slice(0, 4),
  item: {estimatedHeight: 40, template: itemTemplate},
  ariaLabel: 'Orders',
}, plugins);
// Row 20's visual position relative to the scroll top, read synchronously so
// a caller can capture it before ResizeObserver delivers the first batch.
// The vertical offset is the transform's LAST length: the core pipeline writes
// translateY(Npx) (src/core/pipeline.ts), but groups() positions rows itself
// as translate(0, Npx) (src/plugins/groups/plugin.ts), serialized by Chrome as
// translate(0px, Npx) — a translateY-only match reads neither, so the parse
// takes the form as it comes.
window.relOfRow = (dataIndex) => {
  const el = [...document.querySelectorAll('.vlist-content [data-index]')]
    .find((e) => !e.classList.contains('vlist-group-header') && e.querySelector('div')?.textContent === 'Item ' + dataIndex);
  if (!el) return null;
  const nums = el.style.transform.match(/-?\\d+(?:\\.\\d+)?/g) ?? [];
  const y = nums.length ? parseFloat(nums[nums.length - 1]) : NaN;
  return Number.isFinite(y) ? y - window.list.getScrollPosition() : null;
};
window.rowHeights = () => [...document.querySelectorAll('.vlist-content [data-index]')]
  .filter((e) => !e.classList.contains('vlist-group-header'))
  .map((e) => Math.round(e.getBoundingClientRect().height));
// Element rect vs the row's own content: a row the cache has measured renders
// at its content's height; a measurement stored under the wrong index allots a
// neighbour's. The fixture heights differ by >= 37px, so a wrong one is never
// within the check's 1px tolerance.
window.rowHeightPairs = () => [...document.querySelectorAll('.vlist-content [data-index]')]
  .filter((e) => !e.classList.contains('vlist-group-header'))
  .map((e) => ({
    el: Math.round(e.getBoundingClientRect().height),
    content: Math.round(e.querySelector('div')?.getBoundingClientRect().height ?? -1),
  }));
window.headerHeights = () => [...document.querySelectorAll('.vlist-content .vlist-group-header')]
  .map((e) => Math.round(e.getBoundingClientRect().height));
window.contentHeight = () => Math.round(document.querySelector('.vlist-content').getBoundingClientRect().height);
window.ready = true;
</script>`;

const server = Bun.serve({ port: 0, fetch(req) {
  const path = new URL(req.url).pathname;
  if (path === "/") return new Response(html, { headers: { "Content-Type": "text/html" } });
  if (["/index.js", "/vlist.css"].includes(path)) return new Response(Bun.file(`${root}/dist${path}`));
  return new Response("Not found", { status: 404 });
} });

const browser = await launchBrowser();
let checks = 0;
let failures = 0;
const check = (ok, label, detail) => {
  checks++;
  if (ok) console.log(`PASS ${label}`);
  else { failures++; console.error(`FAIL ${label}: ${detail}`); }
};

try {
  console.log(await browser.version());

  // ── Scenario: groups + autosize, non-uniform rows ────────────────────────
  {
    const page = await browser.newPage();
    await pinPage(page);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.stack ?? String(e)));
    try {
      await page.goto(`http://localhost:${server.port}/?scenario=grouped`);
      await page.waitForFunction(() => window.ready);
      await page.waitForFunction(() => window.list.getMeasuredCount() === 4, { timeout: 5000 });
      await settle(page);

      const rows = await page.evaluate(() => window.rowHeights());
      check(JSON.stringify(rows) === JSON.stringify([60, 90, 120, 150]),
        "grouped: every data row renders at its own measured height",
        `rows=${JSON.stringify(rows)}`);

      const headers = await page.evaluate(() => window.headerHeights());
      // The first group's inline header collapses to 0 under the sticky header
      // (same as its 0 in the cache total the content check below encodes);
      // every header must be either that collapsed 0 or its configured 30px —
      // never its own content height, which is what a bad measurement pins.
      check(headers.length > 0 && headers.every((h) => h === 0 || h === 30) && headers.includes(30),
        "grouped: headers keep their configured 30px (the first collapses under the sticky one)",
        `headers=${JSON.stringify(headers)}`);

      const content = await page.evaluate(() => window.contentHeight());
      // The first group's inline header collapses under the sticky header:
      // 0 + 60 + 90 + 30 + 120 + 150.
      check(content === 450, "grouped: content height is rows plus headers", `content=${content}`);

      // remeasure(index) re-measures the row at that DATA index: row 1's
      // content grows 90 -> 200 (a late-loading image).
      await page.evaluate(() => {
        const row = [...document.querySelectorAll('.vlist-content [data-index]')]
          .filter((e) => !e.classList.contains('vlist-group-header'))[1];
        row.querySelector('div').style.height = '200px';
        window.list.remeasure(1);
      });
      await page.waitForFunction(() => window.rowHeights()[1] === 200, { timeout: 5000 });
      await settle(page);
      const rowsAfter = await page.evaluate(() => window.rowHeights());
      check(JSON.stringify(rowsAfter) === JSON.stringify([60, 200, 120, 150]),
        "grouped: remeasure(1) re-measures row 1, not its layout neighbour",
        `rows=${JSON.stringify(rowsAfter)}`);
      const contentAfter = await page.evaluate(() => window.contentHeight());
      check(contentAfter === 560, "grouped: content height tracks the remeasure", `content=${contentAfter}`);

      check(errors.length === 0, "grouped: no pageerror", errors.join("\n"));
    } catch (error) {
      failures++; checks++;
      console.error(`FAIL grouped scenario: ${error.stack ?? error}`);
    } finally { await page.close(); }
  }

  // ── Scenario: a row above the viewport measured later must not shift the
  //    first visible row ────────────────────────────────────────────────────
  {
    const page = await browser.newPage();
    await pinPage(page);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.stack ?? String(e)));
    try {
      await page.goto(`http://localhost:${server.port}/?scenario=scroll`);
      await page.waitForFunction(() => window.ready);
      // Scroll and read row 20's position in the same task, before the first
      // ResizeObserver batch lands.
      const before = await page.evaluate(() => {
        window.list.scrollToIndex(20, "start");
        return { rel: window.relOfRow(20), scroll: window.list.getScrollPosition() };
      });
      assert(before.rel !== null, "row 20 rendered after scrollToIndex");
      // Wait for measurements to settle: the count stops growing.
      await page.waitForFunction(() => window.list.getMeasuredCount() >= 10, { timeout: 5000 });
      await settle(page, ".vlist-content", 3);
      const after = await page.evaluate(() => ({
        rel: window.relOfRow(20),
        scroll: window.list.getScrollPosition(),
        measured: window.list.getMeasuredCount(),
      }));
      check(after.rel !== null && Math.abs(after.rel - before.rel) <= 1,
        "scroll: the first visible row does not shift as rows above are measured",
        `rel ${before.rel} -> ${after.rel} (measured=${after.measured})`);
      check(after.scroll !== before.scroll,
        "scroll: the scroll position corrects by the measured deltas",
        `scroll ${before.scroll} -> ${after.scroll}`);
      // Geometry, not presence: every rendered row the cache has measured shows
      // its own content's height (el 40 = still the estimate). Adjacent fixture
      // heights differ by >= 37px, so a misrouted measurement is never within
      // the tolerance — a row allotted its neighbour's height fails here.
      const pairs = await page.evaluate(() => window.rowHeightPairs());
      const measuredRows = pairs.filter((p) => p.el !== 40);
      const wrong = measuredRows.filter((p) => Math.abs(p.el - p.content) > 1);
      check(measuredRows.length >= 5 && wrong.length === 0,
        "scroll: measured rows render at their own content height",
        `checked=${measuredRows.length} wrong=${JSON.stringify(wrong.slice(0, 4))}`);
      check(errors.length === 0, "scroll: no pageerror", errors.join("\n"));
    } catch (error) {
      failures++; checks++;
      console.error(`FAIL scroll scenario: ${error.stack ?? error}`);
    } finally { await page.close(); }
  }

  // ── Control: autosize() without groups() is unchanged ────────────────────
  {
    const page = await browser.newPage();
    await pinPage(page);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.stack ?? String(e)));
    try {
      await page.goto(`http://localhost:${server.port}/?scenario=control`);
      await page.waitForFunction(() => window.ready);
      await page.waitForFunction(() => window.list.getMeasuredCount() === 4, { timeout: 5000 });
      await settle(page);
      const rows = await page.evaluate(() => window.rowHeights());
      check(JSON.stringify(rows) === JSON.stringify([60, 90, 120, 150]),
        "control: plain list rows at their own measured heights",
        `rows=${JSON.stringify(rows)}`);
      const content = await page.evaluate(() => window.contentHeight());
      check(content === 420, "control: content height is the rows' sum", `content=${content}`);
      check(errors.length === 0, "control: no pageerror", errors.join("\n"));
    } catch (error) {
      failures++; checks++;
      console.error(`FAIL control scenario: ${error.stack ?? error}`);
    } finally { await page.close(); }
  }

  console.log(`SUMMARY checks=${checks} failures=${failures}`);
  assert.equal(failures, 0, `${failures} groups-autosize checks failed`);
  console.log("PASS groups() + autosize(): rows measured in one index space, scroll stable, control unchanged");
} finally { await browser.close(); server.stop(); }
