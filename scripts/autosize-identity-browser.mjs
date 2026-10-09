/** autosize() stale measurement prevention: rows must render at their own content height
 * across setItems reorder, search filter mode, and under groups().
 *
 * Verifies that measurements are keyed by item identity (or invalidated),
 * preventing stale heights from previous occupants at the same position.
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";
const { launchBrowser } = await import(resolve(process.env.VLIST_BROWSER_DRIVER ?? resolve(import.meta.dir, "browser-driver.mjs")));
const { pinPage, settle } = await import(resolve(import.meta.dir, "browser-page.mjs"));
const root = process.env.VLIST_AUTOSIZE_IDENTITY_ROOT ?? resolve(import.meta.dir, "..");

const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/vlist.css">
<style>body{margin:16px}#list{width:360px;height:400px}</style>
<div id="list"></div>
<script type="module">
import {createVList,groups,autosize,search} from '/index.js';
const params = new URLSearchParams(location.search);
const scenario = params.get('scenario');

const HEIGHTS = {
  I0: 60,
  I1: 90,
  I2: 120,
  I3: 150,
};

const initialItems = [
  { id: 'I0', name: 'Item 0', text: 'Alpha' },
  { id: 'I1', name: 'Item 1', text: 'Special Beta' },
  { id: 'I2', name: 'Item 2', text: 'Gamma' },
  { id: 'I3', name: 'Item 3', text: 'Special Delta' },
];

const itemTemplate = (row) => \`<div style="height:\${HEIGHTS[row.id]}px">Item \${row.id} (\${HEIGHTS[row.id]}px)</div>\`;

const plugins = [autosize()];
if (scenario === 'search') {
  plugins.push(search({ filter: true }));
} else if (scenario === 'groups') {
  plugins.push(groups({
    getGroupForIndex: (i) => (i < 2 ? 'A' : 'B'),
    header: { height: 30, template: (g) => g },
  }));
}

window.initialItems = initialItems;
window.list = createVList({
  container: '#list',
  items: initialItems,
  item: { estimatedHeight: 40, template: itemTemplate },
  ariaLabel: 'Autosize Stale Test',
}, plugins);

window.rowHeightPairs = () => [...document.querySelectorAll('.vlist-content [data-index]')]
  .filter((e) => !e.classList.contains('vlist-group-header'))
  .map((e) => ({
    id: e.getAttribute('data-id'),
    el: Math.round(e.getBoundingClientRect().height),
    content: Math.round(e.querySelector('div')?.getBoundingClientRect().height ?? -1),
  }));

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

  // ── Scenario 1: plain list setItems reorder ──────────────────────────────
  {
    const page = await browser.newPage();
    await pinPage(page);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.stack ?? String(e)));
    try {
      await page.goto(`http://localhost:${server.port}/?scenario=plain`);
      await page.waitForFunction(() => window.ready);
      await page.waitForFunction(() => window.list.getMeasuredCount() === 4, { timeout: 5000 });
      await settle(page);

      const initialPairs = await page.evaluate(() => window.rowHeightPairs());
      check(
        initialPairs.length === 4 && initialPairs.every((p) => p.content > 0 && Math.abs(p.el - p.content) <= 1),
        "plain: initial rows measured at content heights",
        `pairs=${JSON.stringify(initialPairs)}`
      );

      // Reorder items: [I3, I2, I1, I0]
      await page.evaluate(() => {
        const items = window.initialItems;
        window.list.setItems([items[3], items[2], items[1], items[0]]);
      });
      await settle(page, null, 5);

      const reorderedPairs = await page.evaluate(() => window.rowHeightPairs());
      const reorderExpected = [150, 120, 90, 60];
      const reorderActual = reorderedPairs.map((p) => p.el);
      const reorderMatch = JSON.stringify(reorderActual) === JSON.stringify(reorderExpected) &&
        reorderedPairs.every((p) => p.content > 0 && Math.abs(p.el - p.content) <= 1);

      check(
        reorderMatch,
        "plain: setItems reorder renders each row at its own content height",
        `actual=${JSON.stringify(reorderActual)}, expected=${JSON.stringify(reorderExpected)}, pairs=${JSON.stringify(reorderedPairs)}`
      );

      check(errors.length === 0, "plain: no pageerror", errors.join("\n"));
    } catch (error) {
      failures++; checks++;
      console.error(`FAIL plain scenario: ${error.stack ?? error}`);
    } finally { await page.close(); }
  }

  // ── Scenario 2: search() filter mode in and out ──────────────────────────
  {
    const page = await browser.newPage();
    await pinPage(page);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.stack ?? String(e)));
    try {
      await page.goto(`http://localhost:${server.port}/?scenario=search`);
      await page.waitForFunction(() => window.ready);
      await page.waitForFunction(() => window.list.getMeasuredCount() === 4, { timeout: 5000 });
      await settle(page);

      // Filter to "Special": matches I1 (90px) and I3 (150px)
      await page.evaluate(() => {
        window.list.setQuery("Special");
      });
      await settle(page, null, 5);

      const filteredPairs = await page.evaluate(() => window.rowHeightPairs());
      const filteredExpected = [90, 150];
      const filteredActual = filteredPairs.map((p) => p.el);
      const filteredMatch = JSON.stringify(filteredActual) === JSON.stringify(filteredExpected) &&
        filteredPairs.every((p) => p.content > 0 && Math.abs(p.el - p.content) <= 1);

      check(
        filteredMatch,
        "search: filter mode renders matching rows at their own content heights",
        `actual=${JSON.stringify(filteredActual)}, expected=${JSON.stringify(filteredExpected)}, pairs=${JSON.stringify(filteredPairs)}`
      );

      // Clear filter: back to [I0, I1, I2, I3]
      await page.evaluate(() => {
        window.list.setQuery("");
      });
      await settle(page, null, 5);

      const unfilteredPairs = await page.evaluate(() => window.rowHeightPairs());
      const unfilteredExpected = [60, 90, 120, 150];
      const unfilteredActual = unfilteredPairs.map((p) => p.el);
      const unfilteredMatch = JSON.stringify(unfilteredActual) === JSON.stringify(unfilteredExpected) &&
        unfilteredPairs.every((p) => p.content > 0 && Math.abs(p.el - p.content) <= 1);

      check(
        unfilteredMatch,
        "search: clearing filter restores all rows at their own content heights",
        `actual=${JSON.stringify(unfilteredActual)}, expected=${JSON.stringify(unfilteredExpected)}, pairs=${JSON.stringify(unfilteredPairs)}`
      );

      check(errors.length === 0, "search: no pageerror", errors.join("\n"));
    } catch (error) {
      failures++; checks++;
      console.error(`FAIL search scenario: ${error.stack ?? error}`);
    } finally { await page.close(); }
  }

  // ── Scenario 3: under groups() ───────────────────────────────────────────
  {
    const page = await browser.newPage();
    await pinPage(page);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.stack ?? String(e)));
    try {
      await page.goto(`http://localhost:${server.port}/?scenario=groups`);
      await page.waitForFunction(() => window.ready);
      await page.waitForFunction(() => window.list.getMeasuredCount() === 4, { timeout: 5000 });
      await settle(page);

      const initialPairs = await page.evaluate(() => window.rowHeightPairs());
      check(
        initialPairs.length === 4 && initialPairs.every((p) => p.content > 0 && Math.abs(p.el - p.content) <= 1),
        "groups: initial rows measured at content heights",
        `pairs=${JSON.stringify(initialPairs)}`
      );

      // Reorder items under groups: [I3, I2, I1, I0]
      await page.evaluate(() => {
        const items = window.initialItems;
        window.list.setItems([items[3], items[2], items[1], items[0]]);
      });
      await settle(page, null, 5);

      const reorderedPairs = await page.evaluate(() => window.rowHeightPairs());
      const reorderExpected = [150, 120, 90, 60];
      const reorderActual = reorderedPairs.map((p) => p.el);
      const reorderMatch = JSON.stringify(reorderActual) === JSON.stringify(reorderExpected) &&
        reorderedPairs.every((p) => p.content > 0 && Math.abs(p.el - p.content) <= 1);

      check(
        reorderMatch,
        "groups: setItems reorder renders each row at its own content height",
        `actual=${JSON.stringify(reorderActual)}, expected=${JSON.stringify(reorderExpected)}, pairs=${JSON.stringify(reorderedPairs)}`
      );

      check(errors.length === 0, "groups: no pageerror", errors.join("\n"));
    } catch (error) {
      failures++; checks++;
      console.error(`FAIL groups scenario: ${error.stack ?? error}`);
    } finally { await page.close(); }
  }

} finally {
  await browser.close();
  server.stop(true);
}

console.log(`${checks} checks, ${failures} failures`);
process.exit(failures > 0 ? 1 : 0);
