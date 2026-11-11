/** Table rowAttributes() gate: real Chromium, real row pooling.
 *
 * The feature writes classes and attributes the table renderer does not know
 * about: the renderer rewrites `className` wholesale on a state change and
 * recycles pooled row elements across items without clearing unknown
 * attributes. A DOM-only test can miss both — happy-dom never lays out, so the
 * scroll and pool behaviour here is the real one.
 *
 * Checked:
 *   1. mounted rows carry the record's class and attributes beside the built-ins
 *   2. a pooled element re-acquired for another item carries that item's
 *      record and nothing from the item it showed before
 *   3. a selection flip rewrites the row's classes and the user class survives
 *
 * Build first. Uses scripts/browser-driver.mjs; VLIST_BROWSER_DRIVER overrides
 * it with another module exporting launchBrowser.
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";

const driver = process.env.VLIST_BROWSER_DRIVER ?? resolve(import.meta.dir, "browser-driver.mjs");
const { launchBrowser } = await import(resolve(driver));
const root = resolve(import.meta.dir, "..");

const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/vlist.css"><link rel="stylesheet" href="/vlist-table.css">
<style>body{margin:0}.host{width:420px;height:320px}</style>
<div id="host" class="host"></div>
<script type="module">
  import { createVList, table, rowAttributes, selection } from "/index.js";
  const items = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, name: "Row " + (i + 1), value: "V" + (i + 1) }));
  window.list = createVList(
    { container: "#host", items, item: { height: 32, template: i => i.name } },
    [
      table({
        rowHeight: 32,
        headerHeight: 32,
        fillWidth: false,
        columns: [
          { key: "name", label: "Name", width: 200 },
          { key: "value", label: "Value", width: 200 },
        ],
        features: [
          rowAttributes(item => Number(item.id) <= 60
            ? { class: "row-low", attrs: { "data-tier": "low", "data-owner": String(item.id) } }
            : { class: "row-high", attrs: { "data-tier": "high" } }),
        ],
      }),
      selection(),
    ],
  );
  window.viewport = document.querySelector(".vlist-viewport");
  window.rowAt = i => document.querySelector('.vlist-table-row[data-index="' + i + '"]');
  window.visible = () => [...document.querySelectorAll('.vlist-table-row[role="row"]')].map(el => ({
    index: Number(el.dataset.index),
    id: Number(el.dataset.id),
    tier: el.getAttribute("data-tier"),
    owner: el.getAttribute("data-owner"),
    low: el.classList.contains("row-low"),
    high: el.classList.contains("row-high"),
    selected: el.classList.contains("vlist-item--selected"),
  }));
  window.ready = true;
</script>`;

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/") return new Response(html, { headers: { "Content-Type": "text/html" } });
    if (["/index.js", "/vlist.css", "/vlist-table.css"].includes(path)) {
      return new Response(Bun.file(root + "/dist" + path), {
        headers: { "Content-Type": path.endsWith(".css") ? "text/css" : "text/javascript" },
      });
    }
    return new Response("", { status: 404 });
  },
});

console.log("table-row-attributes fixture: " + server.url.href);

if (!process.argv.includes("--serve")) {
  let browser;
  try {
    browser = await launchBrowser();
    console.log(await browser.version());
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 800 });
    await page.goto(server.url.href);
    await page.waitForFunction(() => window.ready);
    const frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await frame();

    let rows = await page.evaluate(() => visible());
    assert(rows.length > 0, "the table must render rows");
    for (const row of rows) {
      if (row.id <= 60) {
        assert.equal(row.tier, "low", `row ${row.id} carries its record: ${JSON.stringify(row)}`);
        assert.equal(row.owner, String(row.id), `row ${row.id} carries its owner attribute: ${JSON.stringify(row)}`);
        assert.equal(row.low, true, `row ${row.id} carries row-low: ${JSON.stringify(row)}`);
      } else {
        assert.equal(row.tier, "high", `row ${row.id} carries its record: ${JSON.stringify(row)}`);
        assert.equal(row.owner, null, `row ${row.id} has no low-tier attribute: ${JSON.stringify(row)}`);
        assert.equal(row.high, true, `row ${row.id} carries row-high: ${JSON.stringify(row)}`);
      }
    }
    console.log("PASS mounted rows carry the record's class and attributes", JSON.stringify(rows.slice(0, 2)));

    // Pool timing: the first scroll releases the initial window after mounting
    // the new rows; the second re-acquires those elements for another window.
    await page.evaluate(() => { window.first = rowAt(0); viewport.scrollTop = 1200; viewport.dispatchEvent(new Event("scroll")); });
    await frame();
    await page.evaluate(() => { viewport.scrollTop = 2400; viewport.dispatchEvent(new Event("scroll")); });
    await frame();

    const reused = await page.evaluate(() => ({
      connected: window.first.isConnected,
      index: Number(window.first.dataset.index),
    }));
    assert(reused.connected, "the captured first row is re-acquired by a later window");
    assert.notEqual(reused.index, 0, "the captured row now shows another layout index");

    rows = await page.evaluate(() => visible());
    assert(rows.length > 0, "rows are rendered after scrolling");
    for (const row of rows) {
      const expected = row.id <= 60 ? "low" : "high";
      assert.equal(row.tier, expected, `row ${row.id} carries its own record, not the previous item's: ${JSON.stringify(row)}`);
      assert.equal(row.high, expected === "high", `row ${row.id} class matches its record: ${JSON.stringify(row)}`);
      assert.equal(row.low, expected === "low", `row ${row.id} carries no stale class: ${JSON.stringify(row)}`);
      assert.equal(row.owner, expected === "low" ? String(row.id) : null, `row ${row.id} carries no stale attribute: ${JSON.stringify(row)}`);
    }
    console.log("PASS a re-acquired pooled row drops the previous item's class and attributes", JSON.stringify({ reused, rows: rows.slice(0, 2) }));

    const target = rows[0].id;
    await page.evaluate(id => list.select(id), target);
    await frame();
    const selected = await page.evaluate(id => visible().find(row => row.id === id), target);
    assert(selected, `the selected row is still rendered: ${target}`);
    assert.equal(selected.selected, true, `the selection class is present: ${JSON.stringify(selected)}`);
    assert.equal(selected.tier, "high", `the selected row keeps its attributes: ${JSON.stringify(selected)}`);
    assert.equal(selected.high, true, `the selected row keeps its user class: ${JSON.stringify(selected)}`);
    console.log("PASS a selection flip keeps the user class and its attributes", JSON.stringify(selected));
  } finally {
    await browser?.close();
    server.stop(true);
  }
}
