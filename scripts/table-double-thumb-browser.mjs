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
  body { padding-bottom: 320px; }
  #host, #fresh, #grouped, #bordered { width: 420px; height: 240px; }
  #color-control { width: 180px; height: 80px; }
  #page-resize, #page-pin { width: 420px; height: auto; }
  #bottom-border, #forced, #fraction { width: 420px; height: 240px; }
  #bordered .vlist-viewport { box-sizing: border-box; border-top: 12px solid #111; }
  #bottom-border .vlist-viewport { box-sizing: border-box; border-bottom: 12px solid #111; }
  .ref { width: 420px; height: 80px; overflow: scroll; }
  .ref i { display: block; width: 790px; height: 200px; }
</style>
<div id="host"></div>
<div id="fresh"></div>
<div id="grouped"></div>
<div id="color-control"></div>
<div id="bordered"></div>
<div id="page-resize"></div>
<div id="page-pin"></div>
<div id="bottom-border"></div>
<div id="forced"></div>
<div id="fraction"></div>
<div id="footer" style="height:280px">footer</div>
<div class="ref"><i></i></div>
<script type="module">
import { createVList, table, scrollbar, groups, page, columnPin } from "/index.js";
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
window.bordered = createVList({
  container: "#bordered",
  items: items(40),
  item: { height: 28, template: (row) => row.name },
  scroll: { mode: "auto" },
}, [scrollbar()]);
const narrow = [
  { key: "name", label: "Name", width: 90 },
  { key: "size", label: "Size", width: 90 },
  { key: "modified", label: "Modified", width: 90 },
  { key: "kind", label: "Kind", width: 90 },
];
const pageItems = items(80);
const pageTable = (container, cols, pins) => createVList({
  container,
  items: pageItems,
  item: { height: 28, template: (row) => "<span>" + row.name + "</span>" },
  scroll: { mode: "auto" },
}, [
  page({ scrollPadding: { bottom: 400 } }),
  table({
    rowHeight: 28,
    headerHeight: 28,
    columns: cols,
    fillWidth: false,
    features: [columnPin(pins ? { pins } : undefined)],
  }),
  scrollbar(),
]);
window.pageResize = pageTable("#page-resize", narrow, { name: "left" });
window.pagePin = pageTable("#page-pin", columns);
window.bottomBorder = mountIn("#bottom-border", 40);
window.forced = createVList({
  container: "#forced",
  items: items(40),
  item: { height: 28, template: (row) => row.name },
  scroll: { mode: "auto" },
}, [
  table({ rowHeight: 28, headerHeight: 28, columns: narrow, fillWidth: false }),
  scrollbar(),
]);
window.fraction = mountIn("#fraction", 40);
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

  const readEnds = (selector) => page.evaluate((selector) => {
    const vp = document.querySelector(selector + " .vlist-viewport");
    const track = document.querySelector(selector + " .vlist-scrollbar");
    const hover = document.querySelector(selector + " .vlist-scrollbar__hover");
    const css = getComputedStyle(vp);
    const border = (parseFloat(css.borderTopWidth) || 0) + (parseFloat(css.borderBottomWidth) || 0);
    const gap = vp.offsetHeight - vp.clientHeight;
    const rect = vp.getBoundingClientRect();
    return {
      bar: vp.scrollWidth > vp.clientWidth ? Math.max(0, Math.round(gap - border)) : 0,
      bottom: track.style.bottom,
      hoverBottom: hover.style.bottom,
      right: rect.right,
      edge: rect.bottom,
      left: vp.scrollLeft,
      top: vp.scrollTop,
      y: window.scrollY,
    };
  }, selector);
  const place = async (selector) => {
    await page.evaluate((selector) => {
      const vp = document.querySelector(selector + " .vlist-viewport");
      vp.scrollLeft = 0;
      document.querySelector(selector + " .vlist").scrollIntoView({ block: "end", inline: "nearest" });
    }, selector);
    await settle(page);
  };
  const hitAt = (x, y) => page.evaluate((x, y) => {
    const el = document.elementFromPoint(x, y);
    return el ? String(el.className) : "";
  }, x, y);
  const clickRail = async (selector, y) => {
    await place(selector);
    const box = await readEnds(selector);
    const x = box.right - 9;
    const hit = await hitAt(x, y(box));
    const before = await readEnds(selector);
    await page.mouse.click(x, y(box));
    await settle(page);
    const after = await readEnds(selector);
    return { hit, before, after };
  };

  await place("#bordered");
  const bordered = await readEnds("#bordered");
  assert.equal(bordered.bar, 0, "a top border is not a horizontal bar: " + JSON.stringify(bordered));
  assert.equal(bordered.bottom, "", "a bordered list keeps the track inset clear");
  assert.equal(bordered.hoverBottom, "", "a bordered list keeps the hover inset clear");
  const borderClick = await clickRail("#bordered", (box) => box.edge - 8);
  assert.ok(borderClick.hit.includes("vlist-scrollbar"), "bordered lower rail is " + borderClick.hit);
  assert.ok(borderClick.after.top > borderClick.before.top + 15, "bordered lower rail pages " + JSON.stringify(borderClick));
  console.log("PASS bordered rail", JSON.stringify({ hit: borderClick.hit, top: [borderClick.before.top, borderClick.after.top] }));

  const checkEnds = async (selector, expectBar) => {
    await place(selector);
    const box = await readEnds(selector);
    if (expectBar) {
      assert.ok(box.bar > 0, selector + " gains a horizontal bar " + JSON.stringify(box));
      assert.ok(box.bottom.includes(String(box.bar) + "px"), selector + " inset follows the bar " + box.bottom);
    } else {
      assert.equal(box.bar, 0, selector + " loses the horizontal bar " + JSON.stringify(box));
      assert.equal(box.bottom, "", selector + " clears the inset " + box.bottom);
      assert.equal(box.hoverBottom, "", selector + " clears the hover inset");
    }
    const barY = (next) => next.edge - (expectBar ? next.bar / 2 : 5);
    const railY = (next) => next.edge - next.bar - (expectBar ? 6 : 12);
    const barClick = await clickRail(selector, barY);
    const railClick = await clickRail(selector, railY);
    if (expectBar) {
      assert.equal(barClick.hit.includes("vlist-scrollbar"), false, selector + " right end is under " + barClick.hit);
      assert.ok(barClick.after.left > barClick.before.left, selector + " right end moves scrollLeft " + JSON.stringify(barClick));
      assert.equal(barClick.after.y, barClick.before.y, selector + " right end keeps the page " + JSON.stringify(barClick));
      assert.ok(railClick.hit.includes("vlist-scrollbar"), selector + " bottom rail is " + railClick.hit);
    } else {
      assert.ok(barClick.hit.includes("vlist-scrollbar"), selector + " right end misses the track " + barClick.hit);
      assert.ok(railClick.hit.includes("vlist-scrollbar"), selector + " bottom rail misses the track " + railClick.hit);
    }
    console.log("PASS ends", selector, expectBar ? "bar" : "clear", JSON.stringify({
      bar: box.bar,
      barHit: barClick.hit,
      railHit: railClick.hit,
    }));
  };

  await checkEnds("#page-resize", false);
  await page.evaluate(() => window.pageResize.resizeColumn("kind", 400));
  await settle(page);
  await checkEnds("#page-resize", true);
  await page.evaluate(() => window.pageResize.resizeColumn("kind", 90));
  await settle(page);
  await checkEnds("#page-resize", false);

  await checkEnds("#page-pin", false);
  await page.evaluate(() => window.pagePin.setColumnPin("name", "left"));
  await settle(page);
  await checkEnds("#page-pin", true);
  await page.evaluate(() => window.pagePin.setColumnPin("name", null));
  await settle(page);
  await checkEnds("#page-pin", false);

  const show = async (selector) => {
    await page.evaluate((selector) => {
      document.querySelector(selector).scrollIntoView({ block: "center", inline: "nearest" });
    }, selector);
    await settle(page);
  };

  await show("#bottom-border");
  const bottomBorder = await page.evaluate(() => {
    const vp = document.querySelector("#bottom-border .vlist-viewport");
    vp.scrollLeft = 180;
    vp.scrollTop = 0;
    const css = getComputedStyle(vp);
    const top = parseFloat(css.borderTopWidth) || 0;
    const bottom = parseFloat(css.borderBottomWidth) || 0;
    const gap = vp.offsetHeight - vp.clientHeight;
    const thick = gap - top - bottom;
    const rect = vp.getBoundingClientRect();
    const track = document.querySelector("#bottom-border .vlist-scrollbar").getBoundingClientRect();
    const hover = document.querySelector("#bottom-border .vlist-scrollbar__hover").getBoundingClientRect();
    return {
      thick, bottom, gap,
      barTop: rect.bottom - bottom - thick,
      trackBottom: track.bottom,
      hoverBottom: hover.bottom,
      x: rect.right - 8,
      y: rect.bottom - bottom - thick / 2,
      left: vp.scrollLeft,
      topScroll: vp.scrollTop,
    };
  });
  assert.ok(bottomBorder.thick > 8, "bottom border leaves a horizontal bar " + JSON.stringify(bottomBorder));
  await page.mouse.click(bottomBorder.x, bottomBorder.y);
  await settle(page);
  const bottomMoved = await page.evaluate(() => {
    const vp = document.querySelector("#bottom-border .vlist-viewport");
    return { left: vp.scrollLeft, top: vp.scrollTop };
  });
  assert.ok(bottomMoved.left > bottomBorder.left, "bottom border right end moves scrollLeft " + JSON.stringify(bottomMoved));
  assert.equal(bottomMoved.top, bottomBorder.topScroll, "bottom border right end keeps scrollTop " + JSON.stringify(bottomMoved));
  assert.ok(bottomBorder.trackBottom <= bottomBorder.barTop + 0.5, "track ends above the bar " + JSON.stringify(bottomBorder));
  assert.ok(bottomBorder.hoverBottom <= bottomBorder.barTop + 0.5, "hover ends above the bar " + JSON.stringify(bottomBorder));
  console.log("PASS bottom border", JSON.stringify({ ...bottomBorder, moved: bottomMoved }));

  await page.evaluate(() => {
    document.querySelector("#forced .vlist-viewport").style.overflowX = "scroll";
  });
  await settle(page);
  await show("#forced");
  const forced = await page.evaluate(() => {
    const vp = document.querySelector("#forced .vlist-viewport");
    vp.scrollTop = 0;
    const rect = vp.getBoundingClientRect();
    const gap = vp.offsetHeight - vp.clientHeight;
    return {
      gap,
      scrollWidth: vp.scrollWidth,
      clientWidth: vp.clientWidth,
      bottom: document.querySelector("#forced .vlist-scrollbar").style.bottom,
      hoverBottom: document.querySelector("#forced .vlist-scrollbar__hover").style.bottom,
      x: rect.right - 8,
      y: rect.bottom - gap / 2,
      top: vp.scrollTop,
    };
  });
  assert.equal(forced.scrollWidth, forced.clientWidth, "forced bar has no horizontal overflow " + JSON.stringify(forced));
  assert.ok(forced.gap > 8, "overflow-x scroll reserves a horizontal strip " + JSON.stringify(forced));
  assert.notEqual(forced.bottom, "", "forced strip gets a track inset");
  assert.notEqual(forced.hoverBottom, "", "forced strip gets a hover inset");
  await page.mouse.click(forced.x, forced.y);
  await settle(page);
  const forcedTop = await page.evaluate(() => document.querySelector("#forced .vlist-viewport").scrollTop);
  assert.equal(forcedTop, forced.top, "forced strip click keeps scrollTop " + forcedTop);
  console.log("PASS forced bar", JSON.stringify({ ...forced, top: forcedTop }));

  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 760,
    height: 1280,
    deviceScaleFactor: 1.25,
    mobile: false,
  });
  const fraction = await page.evaluate(() => {
    const vp = document.querySelector("#fraction .vlist-viewport");
    vp.style.overflowX = "hidden";
    vp.style.zoom = "1.3";
    const samples = [];
    for (const width of [1.4, 1.6]) {
      vp.style.borderTop = width + "px solid #111";
      vp.style.borderBottom = width + "px solid #111";
      window.fraction.refreshScrollbar();
      const css = getComputedStyle(vp);
      const top = parseFloat(css.borderTopWidth) || 0;
      const bottom = parseFloat(css.borderBottomWidth) || 0;
      const gap = vp.offsetHeight - vp.clientHeight;
      samples.push({
        width, top, bottom, gap,
        remainder: gap - top - bottom,
        overflowX: css.overflowX,
        bottomStyle: document.querySelector("#fraction .vlist-scrollbar").style.bottom,
        hoverBottom: document.querySelector("#fraction .vlist-scrollbar__hover").style.bottom,
      });
    }
    return samples;
  });
  const subpixel = fraction.filter((sample) => sample.remainder > 0 && sample.remainder < 1);
  assert.ok(subpixel.length > 0, "zoom 1.3 leaves a sub-pixel border gap " + JSON.stringify(fraction));
  for (const sample of subpixel) {
    assert.equal(sample.overflowX, "hidden", "fraction case hides the horizontal axis");
    assert.equal(sample.bottomStyle, "", "a sub-pixel remainder is not an inset " + JSON.stringify(sample));
    assert.equal(sample.hoverBottom, "", "a sub-pixel remainder does not lift the hover zone " + JSON.stringify(sample));
  }
  console.log("PASS fractional gap", JSON.stringify(fraction));
} finally {
  await browser?.close();
  server.stop(true);
}
