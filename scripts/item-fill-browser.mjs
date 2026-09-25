/** A template's root element fills the row it was rendered into.
 *
 * `.vlist-item` is a flex container, so whatever `item.template` returns is a
 * flex item, and flex items do not grow. A single-root template used to
 * shrink-wrap to its own content, which is why every integration ended up
 * writing `width: 100%` — and then, separately, discovering that `min-width: 0`
 * is what lets text inside it truncate.
 *
 * This has to run in a real browser: it is a layout fact, and happy-dom lays
 * nothing out, so a DOM-only assertion here would pass whatever the CSS said.
 *
 * Three things are checked, and the third is the one that protects the fix from
 * being widened later:
 *   1. a single-root template fills the item
 *   2. text inside it truncates instead of stretching the row
 *   3. a table's cells, which are several roots, keep the widths the plugin
 *      gave them — the rule is scoped to `:only-child` precisely so that
 *      growing a template's root can never redistribute someone's columns
 *
 * Build first. Uses scripts/browser-driver.mjs; VLIST_BROWSER_DRIVER overrides
 * it with another module exporting launchBrowser.
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";

const driver = process.env.VLIST_BROWSER_DRIVER ?? resolve(import.meta.dir, "browser-driver.mjs");
const { launchBrowser } = await import(resolve(driver));
const root = resolve(import.meta.dir, "..");

const LONG = "a deliberately long secondary line that must be allowed to truncate rather than stretch its row";

const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/vlist.css"><link rel="stylesheet" href="/vlist-table.css">
<style>
  body { margin: 0; font: 14px system-ui, sans-serif; }
  .host { width: 600px; height: 300px; }
  .row { display: flex; align-items: center; gap: 8px; padding: 0 12px; height: 100%; }
  .row b { flex: none; }
  .row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
<div id="plain" class="host"></div>
<div id="tabular" class="host"></div>
<script type="module">
  import { createVList, table } from "/index.js";
  const items = Array.from({ length: 50 }, (_, id) => ({ id, name: "Row " + id, note: ${JSON.stringify(LONG)} }));

  // The reported case: one root element returned by the template.
  createVList({ container: "#plain", items,
    item: { height: 48, template: i => '<div class="row"><b>' + i.name + '</b><span>' + i.note + '</span></div>' } });

  // Several roots per item: the table plugin owns these widths.
  createVList({ container: "#tabular", items, item: { height: 48, template: () => "" } },
    [table({ rowHeight: 48, columns: [
      { key: "name", label: "Name", width: 150 },
      { key: "note", label: "Note", width: 300 },
    ] })]);

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

console.log("item-fill fixture: " + server.url.href);

if (!process.argv.includes("--serve")) {
  let browser;
  try {
    browser = await launchBrowser();
    console.log(await browser.version());
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 800 });
    await page.goto(server.url.href);
    await page.waitForFunction(() => window.ready);
    // One settled frame: the first paint is scheduled on rAF.
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

    const measured = await page.evaluate(() => {
      const read = (selector) => {
        const item = document.querySelector(selector + " .vlist-item");
        const children = [...item.children];
        return {
          item: Math.round(item.getBoundingClientRect().width),
          children: children.map(c => Math.round(c.getBoundingClientRect().width)),
        };
      };
      const span = document.querySelector("#plain .row span");
      return {
        plain: read("#plain"),
        tabular: read("#tabular"),
        // scrollWidth beyond clientWidth is the text being clipped rather than
        // pushing the row wider, which is what min-width: 0 buys.
        truncated: span.scrollWidth > span.clientWidth + 1,
        rowWidth: Math.round(document.querySelector("#plain .row").getBoundingClientRect().width),
      };
    });

    assert.equal(measured.plain.children.length, 1, "the plain fixture must render one root per item");
    assert.equal(
      measured.plain.children[0],
      measured.plain.item,
      `a single-root template must fill its item: ${JSON.stringify(measured.plain)}`,
    );
    console.log("PASS a single-root template fills the item", JSON.stringify(measured.plain));

    assert(measured.truncated, `long text must truncate, not stretch the row: ${JSON.stringify(measured)}`);
    console.log("PASS text inside it truncates instead of stretching the row", JSON.stringify({ rowWidth: measured.rowWidth }));

    assert.equal(measured.tabular.children.length, 2, "the table fixture must render two cells");
    assert.deepEqual(
      measured.tabular.children,
      [150, 300],
      `table cells are several roots and must keep the plugin's widths: ${JSON.stringify(measured.tabular)}`,
    );
    console.log("PASS table cells keep their configured widths", JSON.stringify(measured.tabular));
  } finally {
    await browser?.close();
    server.stop(true);
  }
}
