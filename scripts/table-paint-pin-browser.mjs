/** Table paint with scrollbar() and pinned columns (#514). Build first. Uses
 * scripts/browser-driver.mjs; VLIST_BROWSER_DRIVER overrides it with another
 * module exporting launchBrowser.
 *
 * Four checks, all read from a real Chromium:
 * 1. While the table scrolls natively there is one vertical bar, the
 *    browser's: scrollbar() renders no custom vertical track and leaves the
 *    viewport unstyled by it (#514). Where this engine gives a plain overflow
 *    box a vertical gutter, the table has that native gutter too.
 * 2. Columns that overflow still get a native horizontal bar. When the
 *    measured mode takes a column, the table's gutter matches a plain overflow
 *    box. When it does not, the table takes no column either.
 * 3. The pin separator does not break the focus ring. The boundary pixel and
 *    the pixel on either side are the ring at the top of the edge; the middle
 *    of the boundary is still the separator. Checked for a single left pin, a
 *    single right pin, and more than one pin on each side.
 * 4. A click that selects the row starts a colour transition on the row and on
 *    each pinned cell, left and right.
 *
 * `test:browser` runs this script, which is what the CI browser job runs.
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
  #rights { height: 160px; }
  .ref { width: 454px; height: 80px; overflow: scroll; }
  .ref i { display: block; width: 790px; height: 200px; }
</style>
<div id="left" class="host"></div>
<div id="both" class="host"></div>
<div id="rights" class="host"></div>
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
  rights: make("#rights", { modified: "right", kind: "right" }),
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
    customVertical: (() => {
      const track = document.querySelector(host + " .vlist-scrollbar:not(.vlist-scrollbar--horizontal)");
      if (!track || getComputedStyle(track).display === "none") return false;
      const box = track.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    })(),
    customClass: vp.classList.contains("vlist-viewport--custom-scrollbar"),
    edge: last ? getComputedStyle(last).getPropertyValue("--vlist-pin-edge").trim() : "",
  };
};
window.focusRow = (host) => {
  const root = document.querySelector(host + " .vlist");
  root.focus();
  return root.contains(document.activeElement);
};
const shadowColor = (el) => {
  const colors = [...getComputedStyle(el).boxShadow.matchAll(/rgba?\\([^)]+\\)/g)];
  return colors.length ? colors[colors.length - 1][0] : "";
};
window.boundaries = (host) => {
  const row = document.querySelector(host + " .vlist-table-row.vlist-item--focused");
  if (!row) return [];
  const rr = row.getBoundingClientRect();
  const ring = getComputedStyle(row).outlineColor;
  const top = Math.round(rr.top);
  const out = [];
  const left = row.querySelector(".vlist-table-cell--pin-left-last");
  if (left) {
    const pr = left.getBoundingClientRect();
    out.push({
      side: "left",
      x: Math.round(pr.right) - 1,
      top,
      mid: Math.round((pr.top + pr.bottom) / 2),
      ring,
      edge: shadowColor(left),
    });
  }
  const right = row.querySelector(".vlist-table-cell--pin-right-first");
  if (right) {
    const pr = right.getBoundingClientRect();
    out.push({
      side: "right",
      x: Math.round(pr.left),
      top,
      mid: Math.round((pr.top + pr.bottom) / 2),
      ring,
      edge: shadowColor(right),
    });
  }
  return out;
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
  await pinPage(page, { width: 760, height: 980 });
  await page.goto(server.url.href);
  await page.waitForFunction(() => window.ready);
  await settle(page);

  for (const host of ["#left", "#both"]) {
    const bars = await page.evaluate((host) => window.bars(host), host);
    assert.equal(bars.customVertical, false, host + ": no custom vertical track while the table scrolls natively");
    assert.equal(bars.customClass, false, host + ": the viewport is styled as without scrollbar()");
    assert.ok(bars.scrollWidth > bars.clientWidth, host + ": columns overflow (" + bars.scrollWidth + " > " + bars.clientWidth + ")");
    assert.notEqual(bars.scrollbarWidth, "none", host + ": the native scrollbars are not hidden");
    if (bars.refVerticalGutter > 0) {
      assert.equal(bars.verticalGutter, bars.refVerticalGutter, host + ": the native vertical bar is the only vertical bar");
      assert.ok(bars.horizontalGutter > 0, host + ": native horizontal gutter is present");
    } else {
      assert.equal(bars.verticalGutter, 0, host + ": measured scrollbars take no vertical column");
      assert.equal(bars.horizontalGutter, 0, host + ": measured scrollbars take no horizontal column");
    }
    pass(host + ": one vertical bar (native), native horizontal bar", bars);
  }

  for (const host of ["#left", "#both", "#rights"]) {
    const focused = await page.evaluate((host) => window.focusRow(host), host);
    assert.equal(focused, true, host + " takes focus");
    await page.keyboard.press("ArrowDown");
    await settle(page, host);
    const boundaries = await page.evaluate((host) => window.boundaries(host), host);
    assert.ok(boundaries.length > 0, host + " has a pin boundary");
    for (const edge of boundaries) {
      const px = await sample(page, [
        { name: "in", x: edge.x - 1, y: edge.top },
        { name: "boundary", x: edge.x, y: edge.top },
        { name: "out", x: edge.x + 1, y: edge.top },
        { name: "mid", x: edge.x, y: edge.mid },
      ]);
      const ring = rgb(edge.ring);
      const detail = JSON.stringify({ px, edge });
      assert.equal(px.boundary, ring, host + " " + edge.side + " boundary pixel is the ring: " + detail);
      assert.equal(px.in, ring, host + " " + edge.side + " inner neighbour is the ring: " + detail);
      assert.equal(px.out, ring, host + " " + edge.side + " outer neighbour is the ring: " + detail);
      assert.equal(px.mid, rgb(edge.edge), host + " " + edge.side + " separator remains at mid-edge: " + detail);
      pass(host + " " + edge.side + " ring is continuous through the pin edge", { px, ring, edge: edge.edge });
    }
  }

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
  assert.equal(passes, 7);
} finally {
  await browser?.close();
  server.stop(true);
}
