/** Native vertical thumb beside the custom one after a folder rebuild (#514).
 *
 * Live vlist.io file browser, Chromium 157, Scroll = Auto: the root folder fits
 * vertically, so the viewport's vertical gutter is 0. Double-clicking "scripts"
 * destroys that list, clears the container, and creates another table. The new
 * viewport keeps `.vlist-viewport--custom-scrollbar`, `scrollbar-width: auto`,
 * and `::-webkit-scrollbar` width 0 / height 16px. Once the rows overflow,
 * Chromium still allocates a native vertical gutter beside the custom thumb.
 *
 * Puppeteer's headless default `--hide-scrollbars` forces that gutter to 0, and
 * macOS overlay scrollbars do too, so neither can see the bar the report shows.
 * This launches without the hide flag and with classic scrollbars.
 *
 * Build first. Run this file alone. Library code only: table(), scrollbar(),
 * scroll.mode "auto", then the demo's destroy + clear + create.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { findChrome } from "./browser-driver.mjs";
import { pinPage, settle } from "./browser-page.mjs";

const root = resolve(import.meta.dir, "../dist");
const chromium = "/Applications/Chromium.app/Contents/MacOS/Chromium";

const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/vlist.css"><link rel="stylesheet" href="/vlist-table.css">
<style>
  body { margin: 8px; }
  #host, #fresh, #grouped { width: 420px; height: 240px; }
  #color-control { width: 180px; height: 80px; }
  .ref { width: 420px; height: 80px; overflow: scroll; }
  .ref i { display: block; width: 790px; height: 200px; }
</style>
<div id="host"></div>
<div id="fresh"></div>
<div id="grouped"></div>
<div id="color-control"></div>
<div class="ref"><i></i></div>
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
const mountIn = (container, n) => createVList({
  container,
  items: items(n),
  item: { height: 28, template: (row) => "<span>" + row.name + "</span>" },
  scroll: { mode: "auto" },
}, [
  table({ rowHeight: 28, headerHeight: 28, columns }),
  scrollbar(),
]);
const mount = (n) => mountIn("#host", n);
window.list = mount(6);
window.fresh = mountIn("#fresh", 40);
window.grouped = createVList({
  container: "#grouped",
  items: items(40),
  item: { height: 28, template: (row) => "<span>" + row.name + "</span>" },
  scroll: { mode: "auto" },
}, [
  table({ rowHeight: 28, headerHeight: 28, columns }),
  groups({
    getGroupForIndex: (index) => "G" + Math.floor(index / 10),
    header: { height: 28, template: (key) => key },
  }),
  scrollbar(),
]);
window.colorControl = createVList({
  container: "#color-control",
  items: items(4),
  item: { height: 18, template: (row) => row.name },
  scroll: { mode: "auto" },
}, [scrollbar()]);
window.openFolder = () => {
  window.list.destroy();
  document.getElementById("host").innerHTML = "";
  window.list = mount(40);
};
window.mountNested = () => {
  const cell = document.querySelector("#host .vlist-table-cell");
  const holder = document.createElement("div");
  holder.id = "nested";
  holder.style.cssText = "width:160px;height:70px";
  cell.appendChild(holder);
  createVList({
    container: holder,
    items: Array.from({ length: 20 }, (_, i) => ({ id: i })),
    item: { height: 18, template: (row) => "Nested " + row.id },
  }, [scrollbar()]);
};
window.measure = () => {
  const vp = document.querySelector("#host .vlist-viewport");
  const webkit = getComputedStyle(vp, "::-webkit-scrollbar");
  const thumb = document.querySelector("#host .vlist-scrollbar__thumb");
  const tr = thumb ? thumb.getBoundingClientRect() : null;
  const ref = document.querySelector(".ref");
  return {
    className: vp.className,
    scrollbarWidth: getComputedStyle(vp).scrollbarWidth,
    webkitWidth: webkit.width,
    webkitHeight: webkit.height,
    webkitDisplay: webkit.display,
    verticalGutter: vp.offsetWidth - vp.clientWidth,
    horizontalGutter: vp.offsetHeight - vp.clientHeight,
    refVerticalGutter: ref.offsetWidth - ref.clientWidth,
    scrollHeight: vp.scrollHeight,
    clientHeight: vp.clientHeight,
    scrollWidth: vp.scrollWidth,
    clientWidth: vp.clientWidth,
    thumb: tr ? { w: Math.round(tr.width), h: Math.round(tr.height) } : null,
    bars: document.querySelectorAll("#host .vlist-scrollbar").length,
    roots: document.querySelectorAll("#host .vlist").length,
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

let browser;
try {
  browser = await puppeteer.launch({
    headless: true,
    executablePath: existsSync(chromium) ? chromium : findChrome(),
    ignoreDefaultArgs: ["--hide-scrollbars"],
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-features=OverlayScrollbar"],
  });
  const child = browser.process();
  for (const stream of [child?.stdin, child?.stdout, child?.stderr]) stream?.unref?.();
  console.log(await browser.version());
  const page = await browser.newPage();
  const cdp = await pinPage(page, { width: 760, height: 1280 });
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page.goto(server.url.href);
  await page.waitForFunction(() => window.ready);
  await settle(page);

  const before = await page.evaluate(() => window.measure());
  console.log("before", JSON.stringify(before));
  assert.equal(before.roots, 1, "one list before the folder opens");
  assert.ok(before.scrollHeight <= before.clientHeight, "the first folder fits vertically");
  assert.equal(before.verticalGutter, 0, "no native vertical gutter while the folder fits");
  assert.ok(before.scrollWidth > before.clientWidth, "columns overflow, as in the file browser");

  await page.evaluate(() => window.openFolder());
  await settle(page);
  await page.evaluate(() => {
    document.querySelector("#host .vlist-viewport").scrollTop = 120;
  });
  await settle(page);

  const after = await page.evaluate(() => window.measure());
  console.log("after", JSON.stringify(after));
  assert.equal(after.roots, 1, "the rebuild left one list");
  assert.equal(after.bars, 1, "one custom scrollbar");
  assert.ok(after.className.split(" ").includes("vlist-viewport--custom-scrollbar"), after.className);
  assert.equal(after.scrollbarWidth, "auto", "table mode turns the scrollbar system back on");
  assert.equal(after.webkitWidth, "0px", "the vertical webkit thickness stays 0");
  assert.equal(after.webkitHeight, "16px", "the native horizontal bar stays");
  assert.ok(after.scrollHeight > after.clientHeight, "the opened folder overflows vertically");
  assert.ok(after.thumb && after.thumb.h > 0, "the custom thumb is showing: " + JSON.stringify(after.thumb));
  assert.ok(after.horizontalGutter > 0, "the native horizontal gutter stays");
  assert.ok(after.refVerticalGutter > 0, "classic scrollbars are on, so a plain box has a vertical gutter");
  assert.equal(
    after.verticalGutter,
    0,
    "native vertical gutter beside the custom thumb: " + JSON.stringify(after),
  );
  console.log("PASS one vertical thumb after the folder rebuild");

  const fresh = await page.evaluate(() => {
    const vp = document.querySelector("#fresh .vlist-viewport");
    const webkit = getComputedStyle(vp, "::-webkit-scrollbar");
    const thumb = document.querySelector("#fresh .vlist-scrollbar__thumb");
    const tr = thumb ? thumb.getBoundingClientRect() : null;
    return {
      verticalGutter: vp.offsetWidth - vp.clientWidth,
      horizontalGutter: vp.offsetHeight - vp.clientHeight,
      webkitWidth: webkit.width,
      webkitHeight: webkit.height,
      scrollHeight: vp.scrollHeight,
      clientHeight: vp.clientHeight,
      scrollWidth: vp.scrollWidth,
      clientWidth: vp.clientWidth,
      thumb: tr ? { w: Math.round(tr.width), h: Math.round(tr.height) } : null,
      bars: document.querySelectorAll("#fresh .vlist-scrollbar").length,
    };
  });
  console.log("fresh", JSON.stringify(fresh));
  assert.equal(fresh.bars, 1, "a fresh overflowing table has one custom scrollbar");
  assert.ok(fresh.scrollHeight > fresh.clientHeight, "a fresh table overflows vertically");
  assert.ok(fresh.scrollWidth > fresh.clientWidth, "a fresh table overflows horizontally");
  assert.equal(fresh.webkitWidth, "0px", "a fresh table keeps the vertical webkit thickness at 0");
  assert.equal(fresh.webkitHeight, "16px", "a fresh table keeps the native horizontal bar");
  assert.ok(fresh.thumb && fresh.thumb.h > 0, "a fresh table shows the custom thumb");
  assert.ok(fresh.horizontalGutter > 0, "a fresh table keeps the native horizontal gutter");
  assert.equal(fresh.verticalGutter, 0, "a fresh overflowing table has no native vertical gutter: " + JSON.stringify(fresh));
  console.log("PASS one vertical thumb on a fresh overflowing table");

  const readTop = () => page.evaluate(() => document.querySelector("#host .vlist-viewport").scrollTop);
  const arm = (top) => page.evaluate(async (top) => {
    const vp = document.querySelector("#host .vlist-viewport");
    vp.focus({ preventScroll: true });
    for (let i = 0; i < 20; i++) {
      vp.scrollTop = top;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      if (vp.scrollTop === top) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        if (vp.scrollTop === top) return;
      }
    }
  }, top);
  const untilMoved = async (from) => page.evaluate(async (from) => {
    const vp = document.querySelector("#host .vlist-viewport");
    for (let i = 0; i < 45; i++) {
      if (vp.scrollTop !== from) return vp.scrollTop;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return vp.scrollTop;
  }, from);
  const stableTop = () => page.evaluate(async () => {
    const vp = document.querySelector("#host .vlist-viewport");
    let last = -1;
    let same = 0;
    for (let i = 0; i < 90; i++) {
      const now = vp.scrollTop;
      same = now === last ? same + 1 : 0;
      last = now;
      if (same >= 5) return now;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return vp.scrollTop;
  });

  await arm(40);
  const swipeFrom = await readTop();
  const box = await page.evaluate(() => {
    const r = document.querySelector("#host .vlist-viewport").getBoundingClientRect();
    return { x: r.x + 40, y: r.y + 80 };
  });
  await page.touchscreen.touchStart(box.x, box.y);
  await page.touchscreen.touchMove(box.x, box.y - 50);
  await page.touchscreen.touchEnd();
  const swipeTo = await untilMoved(swipeFrom);
  assert.notEqual(swipeTo, swipeFrom, "a touch swipe moves scrollTop: " + swipeFrom);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await stableTop();
  console.log("PASS touch swipe", swipeFrom, "->", swipeTo);

  for (const key of ["ArrowDown", "PageDown", "End", "Space"]) {
    await arm(80);
    const from = await stableTop();
    await page.keyboard.press(key);
    const to = await stableTop();
    assert.ok(Math.abs(to - from) > 15, key + " moves scrollTop: " + from + " -> " + to);
    console.log("PASS", key, from, "->", to);
  }

  await arm(0);
  await settle(page);
  const token = await page.evaluate(() => {
    const vp = document.querySelector("#host .vlist-viewport");
    const vr = vp.getBoundingClientRect();
    const cell = [...vp.querySelectorAll(".vlist-table-cell")].filter((el) => {
      const text = el.textContent.trim();
      return text.startsWith("Item ") && el.getBoundingClientRect().top > vr.bottom + 40;
    }).at(-1);
    return cell ? cell.textContent.trim() : "";
  });
  assert.ok(token, "a mounted row sits below the viewport");
  const findFrom = await readTop();
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.down(mod);
  await page.keyboard.press("KeyF");
  await page.keyboard.up(mod);
  await page.keyboard.type(token);
  await page.keyboard.press("Enter");
  const findTo = await stableTop();
  assert.ok(findTo - findFrom > 15, "Find scrolls the mounted row into view: " + token + " " + findFrom + " -> " + findTo);
  await page.keyboard.press("Escape");
  console.log("PASS find", token, findFrom, "->", findTo);

  const consumer = await page.evaluate(() => {
    const vp = document.querySelector("#host .vlist-viewport");
    const previous = vp.style.overflowY;
    vp.style.overflowY = "scroll";
    const computed = getComputedStyle(vp).overflowY;
    vp.style.overflowY = previous;
    return computed;
  });
  assert.equal(consumer, "scroll", "a consumer overflowY stays scroll");
  console.log("PASS consumer overflowY");

  const nested = await page.evaluate(() => {
    window.mountNested();
    const vp = document.querySelector("#nested .vlist-viewport");
    const control = document.querySelector("#color-control .vlist-viewport");
    return {
      overflowY: getComputedStyle(vp).overflowY,
      root: vp.parentElement.className,
      scrollbarColor: getComputedStyle(vp).scrollbarColor,
      controlColor: getComputedStyle(control).scrollbarColor,
    };
  });
  assert.equal(nested.root, "vlist", "the nested list is a plain list: " + nested.root);
  assert.equal(nested.overflowY, "auto", "a plain list nested in a cell keeps overflow-y auto");
  assert.equal(nested.scrollbarColor, nested.controlColor, "a nested list keeps the plain scrollbar color");
  assert.notEqual(nested.scrollbarColor, "auto", "a nested list does not take the table scrollbar-color");
  console.log("PASS nested list", JSON.stringify(nested));

  const horizontalHit = async (selector) => {
    const box = await page.evaluate((selector) => {
      const vp = document.querySelector(selector + " .vlist-viewport");
      vp.scrollIntoView({ block: "center", inline: "nearest" });
      vp.scrollTop = 0;
      const rect = vp.getBoundingClientRect();
      const bar = vp.offsetHeight - vp.clientHeight;
      return { right: rect.right, top: rect.top, bottom: rect.bottom, bar, max: vp.scrollWidth - vp.clientWidth };
    }, selector);
    assert.ok(box.bar > 0, selector + " has a native horizontal bar");
    const x = box.right - 5;
    const y = box.bottom - box.bar / 2;
    await page.mouse.move(box.right - 8, box.top + 36);
    await settle(page);
    const hit = await page.evaluate((x, y) => {
      const el = document.elementFromPoint(x, y);
      return el ? String(el.className) : "";
    }, x, y);
    assert.equal(hit.includes("vlist-scrollbar"), false, selector + " horizontal bar is under " + hit);

    await page.evaluate((selector) => {
      const vp = document.querySelector(selector + " .vlist-viewport");
      vp.scrollTop = 0;
      vp.scrollLeft = 0;
    }, selector);
    const clickFrom = await page.evaluate((selector) => {
      const vp = document.querySelector(selector + " .vlist-viewport");
      return { left: vp.scrollLeft, top: vp.scrollTop };
    }, selector);
    await page.mouse.click(x, y);
    await settle(page);
    const clickTo = await page.evaluate((selector) => {
      const vp = document.querySelector(selector + " .vlist-viewport");
      return { left: vp.scrollLeft, top: vp.scrollTop };
    }, selector);
    assert.equal(clickTo.top, clickFrom.top, selector + " click keeps scrollTop " + JSON.stringify(clickTo));
    assert.ok(clickTo.left > clickFrom.left, selector + " click moves scrollLeft " + JSON.stringify(clickTo));

    await page.evaluate((selector) => {
      const vp = document.querySelector(selector + " .vlist-viewport");
      vp.scrollTop = 0;
      vp.scrollLeft = vp.scrollWidth;
    }, selector);
    const dragFrom = await page.evaluate((selector) => {
      const vp = document.querySelector(selector + " .vlist-viewport");
      return { left: vp.scrollLeft, top: vp.scrollTop };
    }, selector);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 60, y, { steps: 6 });
    await page.mouse.up();
    await settle(page);
    const dragTo = await page.evaluate((selector) => {
      const vp = document.querySelector(selector + " .vlist-viewport");
      return { left: vp.scrollLeft, top: vp.scrollTop };
    }, selector);
    assert.equal(dragTo.top, dragFrom.top, selector + " drag keeps scrollTop " + JSON.stringify(dragTo));
    assert.ok(dragTo.left < dragFrom.left - 15, selector + " drag moves scrollLeft " + JSON.stringify(dragFrom) + " -> " + JSON.stringify(dragTo));
    console.log("PASS horizontal hit", selector, JSON.stringify({ hit, clickTo, dragTo }));
  };
  await horizontalHit("#host");
  await horizontalHit("#grouped");
} finally {
  await browser?.close();
  server.stop(true);
}
