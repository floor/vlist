/** Table paint with scrollbar() and pinned columns (#514). Build first. Uses
 * scripts/browser-driver.mjs; VLIST_BROWSER_DRIVER overrides it with another
 * module exporting launchBrowser.
 *
 * Four checks, all read from a real Chromium:
 * 1. The custom vertical thumb is the only vertical thumb. The native vertical
 *    bar has no thickness (::-webkit-scrollbar width 0). Where this engine
 *    gives a plain overflow box a vertical gutter, the table's vertical gutter
 *    is 0.
 * 2. Columns that overflow still get a native horizontal bar (webkit height
 *    16px, and a horizontal gutter when the engine uses classic scrollbars).
 * 3. The last left pin's separator does not cover the focus ring: the top pixel
 *    of that edge is the ring, the middle pixel is still the separator.
 * 4. A click that selects the row starts a colour transition on the row and on
 *    each pinned cell, left and right.
 *
 * The coordinator wires this script into `test:browser` after merge;
 * package.json is left untouched here.
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pinPage, settle } from "./browser-page.mjs";

const root = resolve(import.meta.dir, "../dist");
const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/vlist.css"><link rel="stylesheet" href="/vlist-table.css">
<style>
  body { margin: 8px; }
  .host { width: 454px; height: 280px; margin-bottom: 12px; }
  .ref { width: 454px; height: 80px; overflow: scroll; }
  .ref i { display: block; width: 790px; height: 200px; }
</style>
<div id="left" class="host"></div>
<div id="both" class="host"></div>
<div class="ref"><i></i></div>
<script type="module">
import { createVList, table, columnPin, scrollbar, selection } from "/index.js";
const items = Array.from({ length: 40 }, (_, i) => ({
  id: i, name: "Item " + i, size: (i * 37) + " B", modified: "Nov " + (i + 1), kind: ["Doc", "Tool", "Folder"][i % 3],
}));
const columns = [
  { key: "name", label: "Name", width: 220 },
  { key: "size", label: "Size", width: 200 },
  { key: "modified", label: "Modified", width: 200 },
  { key: "kind", label: "Kind", width: 170 },
];
const make = (host, pins) => createVList({
  container: host,
  items,
  item: { height: 28, template: (i) => "<span>" + i.name + "</span>" },
}, [
  table({ rowHeight: 28, columns, features: [columnPin({ pins })] }),
  scrollbar(),
  selection({ mode: "single" }),
]);
window.lists = {
  left: make("#left", { name: "left", size: "left" }),
  both: make("#both", { name: "left", kind: "right" }),
};
window.bars = (host) => {
  const vp = document.querySelector(host + " .vlist-viewport");
  const webkit = getComputedStyle(vp, "::-webkit-scrollbar");
  const ref = document.querySelector(".ref");
  const last = document.querySelector(host + " .vlist-table-cell--pin-left-last");
  return {
    scrollWidth: vp.scrollWidth,
    clientWidth: vp.clientWidth,
    verticalGutter: vp.offsetWidth - vp.clientWidth,
    horizontalGutter: vp.offsetHeight - vp.clientHeight,
    refVerticalGutter: ref.offsetWidth - ref.clientWidth,
    scrollbarWidth: getComputedStyle(vp).scrollbarWidth,
    webkitWidth: webkit.width,
    webkitHeight: webkit.height,
    customVertical: !!document.querySelector(host + " .vlist-scrollbar:not(.vlist-scrollbar--horizontal)"),
    edge: last ? getComputedStyle(last).getPropertyValue("--vlist-pin-edge").trim() : "",
  };
};
window.focusRow = (host) => {
  const root = document.querySelector(host + " .vlist");
  root.focus();
  return root.contains(document.activeElement);
};
window.edgeGeometry = (host) => {
  const row = document.querySelector(host + " .vlist-table-row.vlist-item--focused");
  const pin = row && row.querySelector(".vlist-table-cell--pin-left-last");
  if (!pin) return null;
  const rr = row.getBoundingClientRect();
  const pr = pin.getBoundingClientRect();
  const edge = getComputedStyle(document.querySelector(host + " .vlist-table-header-cell--pin-left-last")).borderRightColor;
  return {
    ring: getComputedStyle(row).outlineColor,
    edge,
    x: Math.round(pr.right) - 1,
    top: Math.round(rr.top),
    mid: Math.round((pr.top + pr.bottom) / 2),
  };
};
window.paint = (host) => {
  const row = document.querySelector(host + " .vlist-table-row");
  const pins = [...row.querySelectorAll(".vlist-table-cell--pin-left, .vlist-table-cell--pin-right")];
  const running = (el) => el.getAnimations().filter((a) => a.playState === "running").map((a) => a.transitionProperty || a.animationName || "");
  return {
    row: running(row),
    pins: pins.map((el) => ({ cls: el.className, running: running(el) })),
  };
};
window.ready = true;
</script>`;

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/") return new Response(html, { headers: { "Content-Type": "text/html" } });
    if (["/index.js", "/vlist.css", "/vlist-table.css"].includes(path)) return new Response(Bun.file(root + path));
    return new Response("", { status: 404 });
  },
});

const sample = async (page, points) => {
  const b64 = await page.screenshot({ encoding: "base64" });
  return page.evaluate(async (b64, points) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const out = {};
    for (const p of points) {
      const d = ctx.getImageData(p.x, p.y, 1, 1).data;
      out[p.name] = "rgb(" + d[0] + ", " + d[1] + ", " + d[2] + ")";
    }
    return out;
  }, b64, points);
};

const rgb = (color) => {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return color;
  const [r, g, b] = m[1].split(",").map((n) => Math.round(Number(n)));
  return "rgb(" + r + ", " + g + ", " + b + ")";
};

let browser;
let passes = 0;
const pass = (msg, extra) => {
  passes++;
  console.log("PASS", msg, extra === undefined ? "" : JSON.stringify(extra));
};

try {
  const driver = process.env.VLIST_BROWSER_DRIVER ?? resolve(import.meta.dir, "browser-driver.mjs");
  browser = await (await import(resolve(driver))).launchBrowser();
  console.log(await browser.version());
  const page = await browser.newPage();
  await pinPage(page, { width: 760, height: 800 });
  await page.goto(server.url.href);
  await page.waitForFunction(() => window.ready);
  await settle(page);

  for (const host of ["#left", "#both"]) {
    const bars = await page.evaluate((host) => window.bars(host), host);
    assert.equal(bars.customVertical, true, host + ": scrollbar() mounted a vertical thumb");
    assert.ok(bars.scrollWidth > bars.clientWidth, host + ": columns overflow (" + bars.scrollWidth + " > " + bars.clientWidth + ")");
    assert.equal(bars.webkitWidth, "0px", host + ": native vertical thickness is 0 (" + bars.webkitWidth + ")");
    assert.equal(bars.webkitHeight, "16px", host + ": native horizontal bar is 16px (" + bars.webkitHeight + ")");
    assert.equal(bars.scrollbarWidth, "auto", host + ": Chromium re-enables the scrollbar system");
    if (bars.refVerticalGutter > 0) {
      assert.equal(bars.verticalGutter, 0, host + ": no native vertical gutter beside the custom thumb");
      assert.ok(bars.horizontalGutter > 0, host + ": native horizontal gutter is present");
    }
    pass(host + ": one vertical thumb, native horizontal bar", bars);
  }

  const focused = await page.evaluate(() => window.focusRow("#left"));
  assert.equal(focused, true, "the table takes focus");
  await page.keyboard.press("ArrowDown");
  await settle(page, "#left");
  const edge = await page.evaluate(() => window.edgeGeometry("#left"));
  assert.ok(edge, "a focused row has a last left-pinned cell");
  // The separator is the pixel just inside the border box. Its top is the ring;
  // its middle is still the separator, so the edge was not removed.
  const x = edge.x - 1;
  const px = await sample(page, [
    { name: "top", x, y: edge.top },
    { name: "mid", x, y: edge.mid },
  ]);
  assert.equal(px.top, rgb(edge.ring), "the ring paints above the pin separator at the top of the edge: " + JSON.stringify({ px, edge }));
  assert.equal(px.mid, rgb(edge.edge), "the separator still paints in the middle of that edge: " + JSON.stringify({ px, edge }));
  pass("focus ring above the last left pin's border", { px, ring: edge.ring, edge: edge.edge });

  const cell = await page.$("#both .vlist-table-row .vlist-table-cell--pin-right");
  assert.ok(cell, "a right-pinned cell to click");
  await cell.click();
  const paint = await page.evaluate(() => window.paint("#both"));
  assert.ok(paint.row.some((name) => name.includes("background-color")), "the row fades its background: " + JSON.stringify(paint));
  assert.ok(paint.pins.length >= 2, "left and right pins: " + JSON.stringify(paint));
  for (const pin of paint.pins) {
    assert.ok(
      pin.running.some((name) => name.includes("vlist-pin-tint") || name.includes("background")),
      "pinned cell fades with the row (" + pin.cls + "): " + JSON.stringify(paint),
    );
  }
  pass("click fades the row and both pinned cells", paint);

  console.log("SUMMARY", JSON.stringify({ passes }));
  assert.equal(passes, 4);
} finally {
  await browser?.close();
  server.stop(true);
}
