/** One vertical thumb on a table with overlay scrollbars.
 *
 * The viewport's scrollbar-color makes Chromium ignore a zero-width
 * ::-webkit-scrollbar, so the platform paints its overlay thumb on top of the
 * custom one. Where the custom track is kept, the table viewport uses
 * scrollbar-color: auto and the platform vertical thumb is not painted.
 * Build first. Run this file alone.
 */
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { findChrome } from "./browser-driver.mjs";
import { pinPage, settle } from "./browser-page.mjs";

const root = resolve(import.meta.dir, "../dist");
const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/vlist.css"><link rel="stylesheet" href="/vlist-table.css">
<style>
  body { margin: 8px; background: #0f172a; }
  #host, #fresh, #grouped, #bordered { width: 420px; height: 240px; }
  #bordered .vlist-viewport { border: 2px solid #94a3b8; }
</style>
<div id="host"></div>
<div id="fresh"></div>
<div id="grouped"></div>
<div id="bordered"></div>
<script type="module">
import { createVList, table, scrollbar, groups } from "/index.js";
const columns = [
  { key: "name", label: "Name", width: 220 },
  { key: "size", label: "Size", width: 200 },
  { key: "modified", label: "Modified", width: 200 },
  { key: "kind", label: "Kind", width: 170 },
];
const items = (n) => Array.from({ length: n }, (_, i) => ({
  id: i, name: "Item " + i, size: (i * 37) + " B", modified: "Nov " + (i + 1), kind: "File",
}));
const mountIn = (container, n, grouped) => createVList({
  container,
  items: items(n),
  item: { height: 28, template: (row) => "<span>" + row.name + "</span>" },
  scroll: { mode: "auto" },
}, [
  table({ rowHeight: 28, headerHeight: 28, columns }),
  ...(grouped ? [groups({
    getGroupForIndex: (index) => "G" + Math.floor(index / 10),
    header: { height: 28, template: (key) => key },
  })] : []),
  scrollbar(),
]);
window.list = mountIn("#host", 6, false);
window.fresh = mountIn("#fresh", 40, false);
window.grouped = mountIn("#grouped", 40, true);
window.bordered = mountIn("#bordered", 40, false);
window.openFolder = () => {
  window.list.destroy();
  document.getElementById("host").innerHTML = "";
  window.list = mountIn("#host", 40, false);
};
window.bars = (selector) => {
  const root = document.querySelector(selector);
  const vp = root.querySelector(".vlist-viewport");
  const track = root.querySelector(".vlist-scrollbar:not(.vlist-scrollbar--horizontal)");
  const thumb = track ? track.querySelector(".vlist-scrollbar__thumb") : null;
  const shown = (el) => {
    if (!el) return false;
    const css = getComputedStyle(el);
    if (css.display === "none" || css.visibility === "hidden") return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  const css = getComputedStyle(vp);
  const pseudo = getComputedStyle(vp, "::-webkit-scrollbar");
  const borders = (parseFloat(css.borderLeftWidth) || 0) + (parseFloat(css.borderRightWidth) || 0);
  const thumbBox = thumb ? thumb.getBoundingClientRect() : null;
  const vpBox = vp.getBoundingClientRect();
  return {
    custom: shown(track),
    gutter: vp.offsetWidth - vp.clientWidth - borders,
    scrollbarColor: css.scrollbarColor,
    pseudoWidth: pseudo.width,
    pseudoHeight: pseudo.height,
    scrollHeight: vp.scrollHeight,
    clientHeight: vp.clientHeight,
    className: vp.className,
    clip: { x: vpBox.right - 14, y: vpBox.top, width: 14, height: vpBox.height },
    thumbSpan: thumbBox ? { top: thumbBox.top - vpBox.top, bottom: thumbBox.bottom - vpBox.top } : null,
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
    if (["/index.js", "/vlist.css", "/vlist-table.css"].includes(path)) {
      return new Response(Bun.file(root + path));
    }
    return new Response("", { status: 404 });
  },
});

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
};

const decodePng = (bytes) => {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let p = 8;
  let width = 0;
  let height = 0;
  let color = 6;
  const parts = [];
  while (p + 8 <= u.length) {
    const len = (u[p] << 24) | (u[p + 1] << 16) | (u[p + 2] << 8) | u[p + 3];
    const type = String.fromCharCode(u[p + 4], u[p + 5], u[p + 6], u[p + 7]);
    const data = u.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      width = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
      height = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7];
      color = data[9];
    } else if (type === "IDAT") parts.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  const bpp = color === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(parts.map((part) => Buffer.from(part))));
  const stride = width * bpp;
  const out = new Uint8Array(height * stride);
  let i = 0;
  let o = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[i++];
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? out[o - bpp] : 0;
      const up = y > 0 ? out[o - stride] : 0;
      const ul = y > 0 && x >= bpp ? out[o - stride - bpp] : 0;
      const v = raw[i++];
      if (filter === 1) out[o] = (v + left) & 255;
      else if (filter === 2) out[o] = (v + up) & 255;
      else if (filter === 3) out[o] = (v + ((left + up) >> 1)) & 255;
      else if (filter === 4) out[o] = (v + paeth(left, up, ul)) & 255;
      else out[o] = v;
      o++;
    }
  }
  return { width, height, bpp, data: out };
};

const lightRunsOutsideThumb = (png, thumb) => {
  const img = decodePng(png);
  const x = Math.max(0, img.width - 5);
  let run = 0;
  let runs = 0;
  const top = thumb ? thumb.top - 2 : -1;
  const bottom = thumb ? thumb.bottom + 2 : -1;
  for (let y = 4; y < img.height - 20; y++) {
    const i = (y * img.width + x) * img.bpp;
    const r = img.data[i];
    const g = img.data[i + 1];
    const b = img.data[i + 2];
    const light = r + g + b > 280 && Math.abs(r - g) < 40 && Math.abs(g - b) < 40;
    const inThumb = y >= top && y <= bottom;
    if (light && !inThumb) {
      run += 1;
      if (run === 14) runs += 1;
    } else run = 0;
  }
  return runs;
};

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push({ ok: true, name });
    console.log("PASS", name);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    results.push({ ok: false, name, message });
    console.log("FAIL", name);
    console.log("  " + message.split("\n")[0]);
  }
};

const browser = await puppeteer.launch({
  headless: true,
  executablePath: findChrome(),
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-features=OverlayScrollbar"],
});
const child = browser.process();
for (const stream of [child?.stdin, child?.stdout, child?.stderr]) stream?.unref?.();
console.log("overlay", await browser.version());

try {
  const page = await browser.newPage();
  await pinPage(page, { width: 760, height: 1100 });
  await page.goto(server.url.href);
  await page.waitForFunction(() => window.ready);
  await settle(page);
  await page.evaluate(() => window.openFolder());
  await settle(page);

  for (const selector of ["#host", "#fresh", "#grouped", "#bordered"]) {
    await check("overlay " + selector + " keeps one custom thumb and no platform vertical bar", async () => {
      await page.evaluate((selector) => {
        const vp = document.querySelector(selector + " .vlist-viewport");
        vp.scrollTop = 80;
        document.querySelector(selector).scrollIntoView({ block: "center", inline: "nearest" });
      }, selector);
      await settle(page);
      const sample = await page.evaluate((selector) => window.bars(selector), selector);
      console.log(selector, JSON.stringify(sample));
      assert.ok(sample.scrollHeight > sample.clientHeight, selector + " overflows " + JSON.stringify(sample));
      assert.equal(sample.custom, true, selector + " shows the custom thumb " + JSON.stringify(sample));
      assert.ok(sample.gutter < 2, selector + " has no native column " + JSON.stringify(sample));
      assert.equal(sample.scrollbarColor, "auto", selector + " lets the webkit width apply " + JSON.stringify(sample));
      assert.equal(sample.pseudoWidth, "0px", selector + " hides the platform vertical bar " + JSON.stringify(sample));
      const png = await page.screenshot({ clip: sample.clip, captureBeyondViewport: false });
      const extra = lightRunsOutsideThumb(png, sample.thumbSpan);
      assert.equal(extra, 0, selector + " paints no second thumb at the right edge " + JSON.stringify(sample));
    });
  }
} finally {
  await browser.close();
  server.stop(true);
}

const failed = results.filter((item) => !item.ok);
console.log("SUMMARY", JSON.stringify({ pass: results.length - failed.length, fail: failed.length }));
if (failed.length) process.exit(1);
