/** Reproduction of selectNext / selectPrevious leaving the selected row
 * off-screen. This is not the track-list example; it is a minimal fixture
 * whose Next/Previous buttons (`#btn-select-next`, `#btn-select-previous`)
 * match that example's contract.
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

const html = `<!doctype html>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/vlist.css">
<style>
  body{margin:16px;font:14px sans-serif}
  #player{display:flex;gap:8px;margin-bottom:8px}
  #list{width:360px;height:400px;border:1px solid #ccc}
  .track{padding:8px 12px}
</style>
<div id="player">
  <button type="button" id="btn-select-previous">Previous</button>
  <button type="button" id="btn-select-next">Next</button>
  <span id="now-playing"></span>
</div>
<div id="list"></div>
<script type="module">
import { createVList, selection } from "/index.js";
const items = Array.from({ length: 200 }, (_, id) => ({ id, name: "Track " + (id + 1) }));
window.list = createVList({
  container: "#list",
  items,
  item: {
    height: 56,
    template: (item) => '<div class="track">' + item.name + "</div>",
  },
}, [selection({ mode: "single" })]);
const playing = document.getElementById("now-playing");
const updatePlaying = () => {
  const selected = list.getSelected();
  playing.textContent = selected.length ? selected.length + " track" : "";
};
document.getElementById("btn-select-next").addEventListener("click", () => {
  list.selectNext();
  updatePlaying();
});
document.getElementById("btn-select-previous").addEventListener("click", () => {
  list.selectPrevious();
  updatePlaying();
});
window.ready = true;
</script>`;

const server = Bun.serve({
  port: 0,
  fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/") return new Response(html, { headers: { "Content-Type": "text/html" } });
    if (path === "/index.js" || path === "/vlist.css") {
      return new Response(Bun.file(`${root}/dist${path}`));
    }
    return new Response("Not found", { status: 404 });
  },
});

const sample = () => ({
  selectedCount: window.list.getSelected().length,
  selectedId: window.list.getSelected()[0],
  scrollPosition: window.list.getScrollPosition(),
  nativeScrollTop: document.querySelector(".vlist-viewport")?.scrollTop ?? null,
  rendered: !!document.querySelector(".vlist-item--selected"),
  ...(() => {
    const selected = document.querySelector(".vlist-item--selected");
    const viewport = document.querySelector(".vlist-viewport");
    const sr = selected?.getBoundingClientRect();
    const vr = viewport?.getBoundingClientRect();
    const tol = 1;
    const fullyContained = !!(sr && vr
      && sr.top >= vr.top - tol
      && sr.bottom <= vr.bottom + tol);
    return {
      fullyContained,
      selectedTop: sr?.top ?? null,
      selectedBottom: sr?.bottom ?? null,
      viewportTop: vr?.top ?? null,
      viewportBottom: vr?.bottom ?? null,
    };
  })(),
});

const browser = await launchBrowser();
try {
  console.log(await browser.version());
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 700 });
  await page.goto(`http://localhost:${server.port}/`);
  await page.waitForFunction(() => window.ready);

  const clicks = 40;
  await page.evaluate((n) => {
    const btn = document.querySelector("#btn-select-next");
    for (let i = 0; i < n; i++) btn.click();
  }, clicks);

  const afterNext = await page.evaluate(sample);

  assert.equal(afterNext.selectedCount, 1, `expected one selected track, got ${JSON.stringify(afterNext)}`);
  assert.equal(afterNext.selectedId, clicks - 1, `expected track ${clicks - 1} after ${clicks} Next clicks`);
  assert(afterNext.scrollPosition > 0, `selectNext must reveal: scrollPosition=${afterNext.scrollPosition}`);
  assert(afterNext.rendered, "selected track must be in the DOM");
  assert(afterNext.fullyContained, `selected track must be fully inside the viewport: ${JSON.stringify(afterNext)}`);

  console.log("PASS #btn-select-next ×40 reveals the selected track", JSON.stringify(afterNext));

  await page.evaluate((n) => {
    const btn = document.querySelector("#btn-select-previous");
    for (let i = 0; i < n; i++) btn.click();
  }, clicks);

  const afterPrev = await page.evaluate(sample);

  assert.equal(afterPrev.selectedCount, 1, `expected one selected track after Previous, got ${JSON.stringify(afterPrev)}`);
  assert.equal(afterPrev.selectedId, 0, `expected track 0 after ${clicks} Previous clicks`);
  assert.equal(afterPrev.scrollPosition, 0, `selectPrevious back to start must restore scrollPosition, got ${afterPrev.scrollPosition}`);
  assert(afterPrev.rendered, "selected track must be in the DOM after Previous");
  assert(afterPrev.fullyContained, `selected track must be fully inside the viewport after Previous: ${JSON.stringify(afterPrev)}`);

  console.log("PASS #btn-select-previous ×40 returns to the start", JSON.stringify(afterPrev));
  await page.close();
} finally {
  await browser.close();
  server.stop();
}
