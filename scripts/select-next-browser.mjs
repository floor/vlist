/** Reproduction of selectNext / selectPrevious leaving the selected row
 * off-screen. This is not the track-list example; it is a minimal fixture
 * whose Next/Previous buttons (`#btn-select-next`, `#btn-select-previous`)
 * match that example's contract.
 *
 * Covers the plain list and the carousel path: selected bounds inside the
 * viewport, aria-activedescendant identity, lap-relative movement (same
 * virtual cycle — `pos > home * 0.5` does not prove that), and clamping
 * at an end.
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

const playerChrome = `<div id="player">
  <button type="button" id="btn-select-previous">Previous</button>
  <button type="button" id="btn-select-next">Next</button>
  <span id="now-playing"></span>
</div>
<div id="list"></div>`;

const pageStyle = `<style>
  body{margin:16px;font:14px sans-serif}
  #player{display:flex;gap:8px;margin-bottom:8px}
  #list{width:360px;height:400px;border:1px solid #ccc}
  .track{padding:8px 12px}
</style>`;

const wireButtons = `const playing = document.getElementById("now-playing");
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
window.ready = true;`;

const listHtml = `<!doctype html>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/vlist.css">
${pageStyle}
${playerChrome}
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
${wireButtons}
</script>`;

const carouselHtml = `<!doctype html>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/vlist.css">
<link rel="stylesheet" href="/vlist-carousel.css">
${pageStyle}
${playerChrome}
<script type="module">
import { createVList, selection, carousel } from "/index.js";
const items = Array.from({ length: 20 }, (_, id) => ({ id, name: "Track " + (id + 1) }));
window.list = createVList({
  container: "#list",
  items,
  item: {
    height: 56,
    template: (item) => '<div class="track">' + item.name + "</div>",
  },
}, [carousel(), selection({ mode: "single" })]);
${wireButtons}
</script>`;

const server = Bun.serve({
  port: 0,
  fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/") return new Response(listHtml, { headers: { "Content-Type": "text/html" } });
    if (path === "/carousel") return new Response(carouselHtml, { headers: { "Content-Type": "text/html" } });
    if (path === "/index.js" || path === "/vlist.css" || path === "/vlist-carousel.css") {
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
  aria: document.querySelector(".vlist-content")?.getAttribute("aria-activedescendant") ?? null,
  selectedDomId: document.querySelector(".vlist-item--selected")?.id ?? null,
  carouselIndex: typeof window.list.getCarouselState === "function"
    ? window.list.getCarouselState().index
    : null,
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

const sameLap = (home, pos, step, count) => {
  const lap = step * count;
  return Number.isFinite(lap) && lap > 0
    && Math.floor(home / lap) === Math.floor(pos / lap);
};

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

  const carouselPage = await browser.newPage();
  await carouselPage.setViewport({ width: 900, height: 700 });
  await carouselPage.goto(`http://localhost:${server.port}/carousel`);
  await carouselPage.waitForFunction(() => window.ready);

  const itemCount = 20;
  const home = await carouselPage.evaluate(() => window.list.getScrollPosition());
  // The home lap is one lap in: past the margin lap, so a size-cache offset of the
  // logical index (which would land in that margin lap, near 0) is told apart from it.
  assert(home > 1_000, `carousel must seed the home lap, one lap in, home=${home}`);

  await carouselPage.evaluate(() => {
    window.carouselChanges = [];
    window.list.on("carousel:change", (payload) => {
      window.carouselChanges.push({
        index: payload.index,
        scrollPosition: payload.scrollPosition,
      });
    });
  });

  // No focus yet: the first Next moves from −1 to item 0, which is already
  // home, so the lap must not move.
  await carouselPage.evaluate(() => document.querySelector("#btn-select-next").click());
  const afterFirst = await carouselPage.evaluate(sample);
  assert.equal(afterFirst.selectedCount, 1, `expected one selected track, got ${JSON.stringify(afterFirst)}`);
  assert.equal(afterFirst.selectedId, 0, `first Next selects item 0, got ${JSON.stringify(afterFirst)}`);
  assert.equal(afterFirst.carouselIndex, 0, `first Next must keep carousel index 0, got ${JSON.stringify(afterFirst)}`);
  assert(Math.abs(afterFirst.scrollPosition - home) < 1, `first Next must not move: item 0 is already home, got ${JSON.stringify({ home, afterFirst })}`);
  assert(afterFirst.rendered, "item 0 must be in the DOM");
  assert(afterFirst.fullyContained, `item 0 must be fully inside the viewport: ${JSON.stringify(afterFirst)}`);
  assert.equal(afterFirst.aria, afterFirst.selectedDomId, `aria-activedescendant must be the selected element's id: ${JSON.stringify(afterFirst)}`);

  // Second Next: one step inside the current lap.
  await carouselPage.evaluate(() => document.querySelector("#btn-select-next").click());
  const afterSecond = await carouselPage.evaluate(sample);
  const step = afterSecond.scrollPosition - home;
  assert(step > 0, `second Next must advance within the lap: ${JSON.stringify({ home, afterSecond })}`);
  assert(sameLap(home, afterSecond.scrollPosition, step, itemCount), `second Next left the seeded lap: ${JSON.stringify({ home, step, afterSecond })}`);
  assert.equal(afterSecond.selectedId, 1, `second Next selects item 1, got ${JSON.stringify(afterSecond)}`);
  assert.equal(afterSecond.carouselIndex, 1, `carousel index must follow the second Next, got ${JSON.stringify(afterSecond)}`);
  assert(afterSecond.rendered, "selected carousel track must be in the DOM");
  assert(afterSecond.fullyContained, `selected carousel track must be fully inside the viewport: ${JSON.stringify(afterSecond)}`);
  assert.equal(afterSecond.aria, afterSecond.selectedDomId, `aria-activedescendant must match the selected node: ${JSON.stringify(afterSecond)}`);

  console.log("PASS carousel Next ×2: first selects 0 in place, second advances one step in the lap", JSON.stringify({ home, step, afterSecond }));

  await carouselPage.evaluate(() => document.querySelector("#btn-select-previous").click());
  const back = await carouselPage.evaluate(sample);
  assert.equal(back.selectedId, 0, `Previous returns to item 0, got ${JSON.stringify(back)}`);
  assert.equal(back.carouselIndex, 0);
  assert(sameLap(home, back.scrollPosition, step, itemCount), `selectPrevious back to start must stay in the current lap: ${JSON.stringify({ home, step, back })}`);
  assert(Math.abs(back.scrollPosition - home) < 1, `selectPrevious back to start must restore the seeded position, got ${JSON.stringify({ home, back })}`);
  assert(back.fullyContained, `track 0 must be fully inside the viewport: ${JSON.stringify(back)}`);
  assert.equal(back.aria, back.selectedDomId);

  console.log("PASS carousel #btn-select-previous returns to item 0 in the current lap", JSON.stringify(back));

  const changesBeforeClamp = await carouselPage.evaluate(() => window.carouselChanges.length);
  await carouselPage.evaluate(() => document.querySelector("#btn-select-previous").click());
  const clamped = await carouselPage.evaluate(sample);
  assert.equal(clamped.selectedId, 0, `Previous at the start must clamp, got ${JSON.stringify(clamped)}`);
  assert.equal(clamped.carouselIndex, 0);
  assert(Math.abs(clamped.scrollPosition - home) < 1, `clamped Previous must not move, got ${JSON.stringify({ home, clamped })}`);
  const changesAfterClamp = await carouselPage.evaluate(() => window.carouselChanges.length);
  assert.equal(changesAfterClamp, changesBeforeClamp, "clamped Previous must not emit carousel:change");
  assert(clamped.fullyContained, `clamped track must stay fully inside the viewport: ${JSON.stringify(clamped)}`);
  assert.equal(clamped.aria, clamped.selectedDomId);

  console.log("PASS carousel #btn-select-previous clamps at the start", JSON.stringify(clamped));

  await carouselPage.evaluate(() => {
    const btn = document.querySelector("#btn-select-next");
    for (let i = 0; i < 9; i++) btn.click();
  });
  const afterNine = await carouselPage.evaluate(sample);
  assert.equal(afterNine.selectedCount, 1, `expected one selected track, got ${JSON.stringify(afterNine)}`);
  assert.equal(afterNine.selectedId, 9, `expected track 9 after nine Next clicks from item 0, got ${JSON.stringify(afterNine)}`);
  assert.equal(afterNine.carouselIndex, 9, `carousel index must follow selectNext, got ${JSON.stringify(afterNine)}`);
  assert(afterNine.rendered, "selected carousel track must be in the DOM");
  assert(afterNine.fullyContained, `selected carousel track must be fully inside the viewport: ${JSON.stringify(afterNine)}`);
  assert.equal(afterNine.aria, afterNine.selectedDomId, `aria-activedescendant must match the selected node: ${JSON.stringify(afterNine)}`);
  assert(sameLap(home, afterNine.scrollPosition, step, itemCount), `nine Next clicks must stay in the current lap, not merely pos > home * 0.5: ${JSON.stringify({ home, step, afterNine })}`);
  assert.equal(Math.round((afterNine.scrollPosition - home) / step), 9, `lap-relative movement must be 9 steps, got ${JSON.stringify({ home, step, afterNine })}`);

  console.log("PASS carousel #btn-select-next ×9 from item 0 stays in the current lap", JSON.stringify({ home, step, afterNine }));

  await carouselPage.evaluate(() => {
    const btn = document.querySelector("#btn-select-next");
    for (let i = 0; i < 20; i++) btn.click();
  });
  const atEnd = await carouselPage.evaluate(sample);
  assert.equal(atEnd.selectedId, 19, `expected last track after overshooting Next, got ${JSON.stringify(atEnd)}`);
  assert.equal(atEnd.carouselIndex, 19);
  assert(sameLap(home, atEnd.scrollPosition, step, itemCount), `clamping must not leave the current lap: ${JSON.stringify({ home, step, atEnd })}`);
  const endPos = atEnd.scrollPosition;
  const changesBeforeEnd = await carouselPage.evaluate(() => window.carouselChanges.length);

  await carouselPage.evaluate(() => document.querySelector("#btn-select-next").click());
  const clampedEnd = await carouselPage.evaluate(sample);
  assert.equal(clampedEnd.selectedId, 19, `Next at the end must clamp, got ${JSON.stringify(clampedEnd)}`);
  assert.equal(clampedEnd.carouselIndex, 19);
  assert.equal(clampedEnd.scrollPosition, endPos, `clamped Next must not move the lap, got ${JSON.stringify({ endPos, clampedEnd })}`);
  assert.equal(
    await carouselPage.evaluate(() => window.carouselChanges.length),
    changesBeforeEnd,
    "clamped Next must not emit carousel:change",
  );
  assert(clampedEnd.fullyContained, `clamped track must stay fully inside the viewport: ${JSON.stringify(clampedEnd)}`);
  assert.equal(clampedEnd.aria, clampedEnd.selectedDomId);

  console.log("PASS carousel #btn-select-next clamps at the end", JSON.stringify(clampedEnd));
  await carouselPage.close();
} finally {
  await browser.close();
  server.stop();
}
