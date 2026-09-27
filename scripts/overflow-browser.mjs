/** overflow(): past the browser's element size limit, the last row is reachable (RFC-015, FLO-247).
 *
 * Chrome stops an element at 33,554,428 px. A native list of a million 40 px
 * rows is 40,000,000 px, so without the plugin its last rows cannot be
 * reached; that control is measured first, so the suite proves the limit is
 * real in the browser it runs in. With `overflow()` the same list hands its
 * input to the synthetic handler in place, and back when it shrinks.
 *
 * This has to run in a real browser: happy-dom caps nothing.
 *
 * Build first. Uses scripts/browser-driver.mjs; VLIST_BROWSER_DRIVER overrides
 * it with another module exporting launchBrowser.
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";

const driver = process.env.VLIST_BROWSER_DRIVER ?? resolve(import.meta.dir, "browser-driver.mjs");
const { launchBrowser } = await import(resolve(driver));
const root = resolve(import.meta.dir, "..");

const ROWS = 1_000_000;
const ROW = 40;

const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/vlist.css">
<style>body { margin: 0; font: 14px system-ui, sans-serif; } .host { width: 400px; height: 400px; }</style>
<div id="plain" class="host"></div>
<div id="handoff" class="host"></div>
<script type="module">
  import { createVList } from "/index.js";
  import { overflow } from "/overflow.js";
  const rows = n => Array.from({ length: n }, (_, id) => ({ id }));
  const item = { height: ${ROW}, template: r => "Row " + r.id };
  const make = (container, plugins) => {
    const list = createVList({ container, items: rows(100), item }, plugins);
    const modes = [];
    list.on("scroll:mode", e => modes.push(e.mode));
    return { list, modes, host: document.querySelector(container) };
  };
  window.fixtures = { plain: make("#plain", []), handoff: make("#handoff", [overflow()]) };
  window.rows = rows;
  window.ready = true;
</script>`;

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/") return new Response(html, { headers: { "Content-Type": "text/html" } });
    if (["/index.js", "/overflow.js", "/vlist.css"].includes(path)) {
      return new Response(Bun.file(root + "/dist" + path), {
        headers: { "Content-Type": path.endsWith(".css") ? "text/css" : "text/javascript" },
      });
    }
    return new Response("", { status: 404 });
  },
});

console.log("overflow fixture: " + server.url.href);

const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** The list's state, and the last row painted inside its viewport. */
const probe = (page, name) => page.evaluate((name) => {
  const { list, modes, host } = window.fixtures[name];
  const viewport = host.querySelector(".vlist-viewport");
  const content = host.querySelector(".vlist-content");
  const box = viewport.getBoundingClientRect();
  const inside = [...host.querySelectorAll("[data-index]")].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > box.top + 1 && r.top < box.bottom - 1;
  }).map((el) => Number(el.dataset.index));
  return {
    modes, position: list.getScrollPosition(), scrollTop: viewport.scrollTop, viewport: viewport.clientHeight,
    contentHeight: content.getBoundingClientRect().height,
    first: Math.min(...inside), last: Math.max(...inside),
  };
}, name);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, fn) => {
  try { fn(); console.log("PASS " + label); } catch (e) { failures++; console.log("FAIL " + label + "\n  " + e.message); }
};

if (!process.argv.includes("--serve")) {
  let browser;
  try {
    browser = await launchBrowser();
    console.log(await browser.version());
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 900 });
    await page.goto(server.url.href);
    await page.waitForFunction(() => window.ready);
    await settle(page);

    for (const name of ["plain", "handoff"]) {
      await page.evaluate((name, n) => {
        const { list } = window.fixtures[name];
        list.setItems(window.rows(n));
        list.scrollToIndex(n - 1, "end");
      }, name, ROWS);
      await settle(page);
    }
    await wait(300); // idle

    const plain = await probe(page, "plain");
    check("without overflow(), the browser caps the list short of its last row", () => {
      assert.ok(plain.last < ROWS - 1000, JSON.stringify(plain));
    });

    const handoff = await probe(page, "handoff");
    check("with overflow(), the list hands over and shows its last row", () => {
      assert.deepEqual(handoff.modes, ["synthetic"]);
      assert.equal(handoff.last, ROWS - 1, JSON.stringify(handoff));
      assert.equal(handoff.position, ROWS * ROW - handoff.viewport);
      assert.ok(handoff.contentHeight <= handoff.viewport, "synthetic content is the viewport's size");
    });

    const before = (await probe(page, "handoff")).position;
    await page.evaluate(() => window.fixtures.handoff.list.scrollToIndex(500_000));
    await wait(300);
    await page.mouse.move(200, 600); // over #handoff, the second 400 px host
    await page.mouse.wheel({ deltaY: 400 });
    await wait(300);
    const wheeled = await probe(page, "handoff");
    check("wheel input moves the synthetic list", () => {
      assert.notEqual(wheeled.position, before);
      assert.ok(wheeled.position > 500_000 * ROW, JSON.stringify(wheeled));
      assert.ok(wheeled.first >= 500_000 && wheeled.first < 500_020, JSON.stringify(wheeled));
    });

    await page.evaluate(() => {
      const { list } = window.fixtures.handoff;
      list.scrollToIndex(80);
    });
    await wait(300);
    await page.evaluate(() => window.fixtures.handoff.list.setItems(window.rows(200)));
    await settle(page);
    const back = await probe(page, "handoff");
    check("shrunk below the threshold, it takes native input back on the same row", () => {
      assert.deepEqual(back.modes, ["synthetic", "native"]);
      assert.equal(back.scrollTop, 80 * ROW, JSON.stringify(back));
      assert.equal(back.first, 80);
      assert.equal(back.contentHeight, 200 * ROW);
    });
  } finally {
    await browser?.close();
    server.stop();
  }
  console.log(`SUMMARY ${JSON.stringify({ failures })}`);
  if (failures) process.exit(1);
}
