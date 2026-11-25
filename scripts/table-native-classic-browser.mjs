/** One vertical bar on a table with classic scrollbars (#514).
 *
 * Classic scrollbars take a column, so the native vertical bar and the custom
 * track are two thumbs. Where the platform uses a classic bar, the table keeps
 * that native bar and does not render the custom vertical track. Overlay
 * scrollbars keep the custom thumb rendered, as on 3.8.10.
 *
 * The classic launch leaves Chromium's scrollbars visible and turns overlay
 * scrollbars off. The overlay launch is headless Chromium's default. Build
 * first. Run this file alone.
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { findChrome } from "./browser-driver.mjs";
import { pinPage, settle } from "./browser-page.mjs";

const root = resolve(import.meta.dir, "../dist");
const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/vlist.css"><link rel="stylesheet" href="/vlist-table.css">
<style>
  body { margin: 8px; }
  #host, #fresh, #grouped, #synthetic, #grid, #bordered, #nest, #page { width: 420px; height: 240px; }
  #bordered .vlist-viewport { border: 2px solid #94a3b8; }
</style>
<div id="host"></div>
<div id="fresh"></div>
<div id="grouped"></div>
<div id="bordered"></div>
<div id="synthetic"></div>
<div id="grid"></div>
<div id="nest"></div>
<div id="page"></div>
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
window.synthetic = createVList({
  container: "#synthetic",
  items: items(40),
  item: { height: 28, template: (row) => "<span>" + row.name + "</span>" },
  scroll: { mode: "synthetic" },
}, [
  table({ rowHeight: 28, headerHeight: 28, columns }),
  scrollbar(),
]);
window.grid = createVList({
  container: "#grid",
  items: items(40),
  item: { height: 28, template: (row) => "<span>" + row.name + "</span>" },
  scroll: { mode: "auto" },
}, [
  { name: "grid-role", priority: 10, setup(ctx) { ctx.dom.root.setAttribute("role", "grid"); } },
  scrollbar(),
]);
window.nest = mountIn("#nest", 40, false);
const slot = document.createElement("div");
slot.id = "inner";
slot.style.cssText = "width:200px;height:90px";
document.querySelector("#nest .vlist-content").append(slot);
window.innerList = createVList({
  container: "#inner",
  items: items(30),
  item: { height: 28, template: (row) => "<span>" + row.name + "</span>" },
  scroll: { mode: "auto" },
}, [scrollbar()]);
window.paged = createVList({
  container: "#page",
  items: items(40),
  item: { height: 28, template: (row) => "<span>" + row.name + "</span>" },
  scroll: { mode: "auto" },
}, [
  page(),
  table({
    rowHeight: 28,
    headerHeight: 28,
    columns,
    features: [columnPin({ pins: { name: "left" } })],
  }),
  scrollbar(),
]);
window.openFolder = () => {
  window.list.destroy();
  document.getElementById("host").innerHTML = "";
  window.list = mountIn("#host", 40, false);
};
window.bars = (selector) => {
  const host = document.querySelector(selector);
  const root = host.classList.contains("vlist") ? host : host.querySelector(":scope > .vlist");
  const vp = root.querySelector(":scope > .vlist-viewport");
  const track = root.querySelector(":scope > .vlist-scrollbar:not(.vlist-scrollbar--horizontal)");
  const thumb = track ? track.querySelector(".vlist-scrollbar__thumb") : null;
  const shown = (el) => {
    if (!el) return false;
    const css = getComputedStyle(el);
    if (css.display === "none" || css.visibility === "hidden") return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  const css = getComputedStyle(vp);
  const borders = (parseFloat(css.borderLeftWidth) || 0) + (parseFloat(css.borderRightWidth) || 0);
  const probe = document.createElement("div");
  probe.style.scrollbarColor = "var(--vlist-scrollbar-thumb-color) var(--vlist-scrollbar-track-color)";
  root.append(probe);
  const theme = getComputedStyle(probe).scrollbarColor;
  probe.remove();
  const gutter = vp.offsetWidth - vp.clientWidth;
  return {
    native: gutter > 0,
    custom: shown(track),
    gutter,
    column: gutter - borders,
    scrollbarColor: css.scrollbarColor,
    theme,
    thumb: thumb ? Math.round(thumb.getBoundingClientRect().height) : 0,
    scrollHeight: vp.scrollHeight,
    clientHeight: vp.clientHeight,
    scrollWidth: vp.scrollWidth,
    clientWidth: vp.clientWidth,
    className: vp.className,
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
    if (["/index.js", "/synthetic-driver.js", "/vlist.css", "/vlist-table.css"].includes(path)) {
      return new Response(Bun.file(root + path));
    }
    return new Response("", { status: 404 });
  },
});

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

const launch = (classic) => puppeteer.launch({
  headless: true,
  executablePath: findChrome(),
  ignoreDefaultArgs: classic ? ["--hide-scrollbars"] : undefined,
  args: classic
    ? ["--no-sandbox", "--disable-dev-shm-usage", "--disable-features=OverlayScrollbar"]
    : ["--no-sandbox", "--disable-dev-shm-usage"],
});

const oneBar = (sample, label) => {
  assert.ok(sample.scrollHeight > sample.clientHeight, label + " overflows vertically " + JSON.stringify(sample));
  assert.ok(sample.scrollWidth > sample.clientWidth, label + " overflows horizontally " + JSON.stringify(sample));
  const visible = Number(sample.native) + Number(sample.custom);
  assert.equal(visible, 1, label + " has one vertical bar " + JSON.stringify(sample));
};

async function exercise(classic) {
  const label = classic ? "classic" : "overlay";
  const browser = await launch(classic);
  const child = browser.process();
  for (const stream of [child?.stdin, child?.stdout, child?.stderr]) stream?.unref?.();
  console.log(label, await browser.version());
  try {
    const page = await browser.newPage();
    await pinPage(page, { width: 760, height: 1500 });
    await page.goto(server.url.href);
    await page.waitForFunction(() => window.ready);
    await settle(page);

    if (classic) {
      await page.evaluate(() => window.openFolder());
      await settle(page);
      await page.evaluate(() => {
        document.querySelector("#host .vlist-viewport").scrollTop = 80;
      });
      await settle(page);
      const rebuilt = await page.evaluate(() => window.bars("#host"));
      console.log(label, "rebuilt", JSON.stringify(rebuilt));
      await check(label + " one vertical bar after the folder rebuild", async () => oneBar(rebuilt, "rebuilt"));

      const fresh = await page.evaluate(() => window.bars("#fresh"));
      console.log(label, "fresh", JSON.stringify(fresh));
      await check(label + " one vertical bar on a fresh table", async () => oneBar(fresh, "fresh"));

      const grouped = await page.evaluate(() => window.bars("#grouped"));
      console.log(label, "grouped", JSON.stringify(grouped));
      await check(label + " one vertical bar on a grouped table", async () => oneBar(grouped, "grouped"));

      for (const selector of ["#host", "#fresh", "#grouped", "#bordered"]) {
        await check(label + " " + selector + " keeps a 15px native column and the theme scrollbar color", async () => {
          const sample = await page.evaluate((selector) => window.bars(selector), selector);
          console.log(label, "theme", selector, JSON.stringify(sample));
          assert.equal(sample.column, 15, selector + " native gutter is 15 " + JSON.stringify(sample));
          assert.equal(sample.scrollbarColor, sample.theme, selector + " scrollbar-color is the theme pair " + JSON.stringify(sample));
          assert.equal(sample.custom, false, selector + " hides the custom thumb " + JSON.stringify(sample));
        });
      }

      const synthetic = await page.evaluate(() => window.bars("#synthetic"));
      console.log(label, "synthetic", JSON.stringify(synthetic));
      await check(label + " synthetic table keeps the custom thumb", async () => {
        await page.waitForFunction(() => {
          const vp = document.querySelector("#synthetic .vlist-viewport");
          return vp !== null && vp.style.overflowY === "hidden";
        });
        const settled = await page.evaluate(() => window.bars("#synthetic"));
        console.log(label, "synthetic settled", JSON.stringify(settled));
        assert.equal(settled.native, false, "synthetic has no native gutter " + JSON.stringify(settled));
        assert.equal(settled.custom, true, "synthetic keeps the custom thumb " + JSON.stringify(settled));
        assert.notEqual(settled.scrollbarColor, "auto", "synthetic keeps its scrollbar color " + JSON.stringify(settled));
        assert.equal(settled.scrollbarColor, settled.theme, "synthetic scrollbar-color is the theme pair " + JSON.stringify(settled));
      });

      const inner = await page.evaluate(() => window.bars("#inner"));
      console.log(label, "inner", JSON.stringify(inner));
      await check(label + " a nested plain list keeps its own gutter and the theme scrollbar color", async () => {
        assert.equal(inner.column, 15, "nested gutter is 15 " + JSON.stringify(inner));
        assert.notEqual(inner.scrollbarColor, "auto", "nested color is not auto " + JSON.stringify(inner));
        assert.equal(inner.scrollbarColor, inner.theme, "nested scrollbar-color is the theme pair " + JSON.stringify(inner));
      });
      const nest = await page.evaluate(() => window.bars("#nest"));
      console.log(label, "nest", JSON.stringify(nest));
      await check(label + " the table around that nested list keeps its native column and the theme color", async () => {
        assert.equal(nest.column, 15, "outer gutter is 15 " + JSON.stringify(nest));
        assert.equal(nest.custom, false, "outer hides the custom thumb " + JSON.stringify(nest));
        assert.equal(nest.scrollbarColor, nest.theme, "outer scrollbar-color is the theme pair " + JSON.stringify(nest));
      });

      const paged = await page.evaluate(() => window.bars("#page"));
      console.log(label, "page", JSON.stringify(paged));
      await check(label + " a pinned page table keeps the theme scrollbar color", async () => {
        assert.notEqual(paged.scrollbarColor, "auto", "page color is not auto " + JSON.stringify(paged));
        assert.equal(paged.scrollbarColor, paged.theme, "page scrollbar-color is the theme pair " + JSON.stringify(paged));
      });

      const grid = await page.evaluate(() => window.bars("#grid"));
      console.log(label, "grid", JSON.stringify(grid));
      await check(label + " a grid that is not a table keeps the custom thumb", async () => {
        assert.equal(grid.custom, true, "grid keeps the custom thumb " + JSON.stringify(grid));
      });

      const endOfBar = async (selector) => {
        await page.evaluate((selector) => {
          const vp = document.querySelector(selector + " .vlist-viewport");
          vp.scrollLeft = 180;
          vp.scrollTop = 0;
          document.querySelector(selector).scrollIntoView({ block: "center", inline: "nearest" });
        }, selector);
        await settle(page);
        return page.evaluate((selector) => {
          const vp = document.querySelector(selector + " .vlist-viewport");
          const rect = vp.getBoundingClientRect();
          const css = getComputedStyle(vp);
          const borderTop = parseFloat(css.borderTopWidth) || 0;
          const borderBottom = parseFloat(css.borderBottomWidth) || 0;
          const bar = Math.max(0, (vp.offsetHeight - vp.clientHeight) - borderTop - borderBottom);
          const x = rect.left + vp.clientLeft + vp.clientWidth - 24;
          const y = rect.bottom - borderBottom - Math.max(bar, 8) / 2;
          const hit = document.elementFromPoint(x, y);
          return { x, y, bar, hit: hit ? String(hit.className) : "", left: vp.scrollLeft, top: vp.scrollTop };
        }, selector);
      };
      const readScroll = (selector) => page.evaluate((selector) => {
        const vp = document.querySelector(selector + " .vlist-viewport");
        return { left: vp.scrollLeft, top: vp.scrollTop };
      }, selector);

      for (const selector of ["#host", "#grouped"]) {
        await check(label + " " + selector + " right-end click and drag move only scrollLeft", async () => {
          const point = await endOfBar(selector);
          assert.ok(point.bar > 0, selector + " paints a horizontal bar " + JSON.stringify(point));
          await page.mouse.click(point.x, point.y);
          await settle(page);
          const clicked = await readScroll(selector);
          assert.equal(clicked.top, point.top, selector + " right-end click keeps scrollTop " + JSON.stringify({ point, clicked }));
          assert.notEqual(clicked.left, point.left, selector + " right-end click changes scrollLeft " + JSON.stringify({ point, clicked }));

          await page.evaluate((selector) => {
            const vp = document.querySelector(selector + " .vlist-viewport");
            vp.scrollLeft = vp.scrollWidth;
            vp.scrollTop = 0;
          }, selector);
          await settle(page);
          const start = await page.evaluate((selector, y) => {
            const vp = document.querySelector(selector + " .vlist-viewport");
            const rect = vp.getBoundingClientRect();
            return { x: rect.left + vp.clientLeft + vp.clientWidth - 24, y, left: vp.scrollLeft, top: vp.scrollTop };
          }, selector, point.y);
          await page.mouse.move(start.x, start.y);
          await page.mouse.down();
          await page.mouse.move(start.x - 60, start.y, { steps: 6 });
          await page.mouse.up();
          await settle(page);
          const dragged = await readScroll(selector);
          assert.equal(dragged.top, start.top, selector + " right-end drag keeps scrollTop " + JSON.stringify({ start, dragged }));
          assert.notEqual(dragged.left, start.left, selector + " right-end drag changes scrollLeft " + JSON.stringify({ start, dragged }));
        });
      }

      await check(label + " touch, keys and Find scroll the table", async () => {
        await page.evaluate(() => {
          document.querySelector("#host").scrollIntoView({ block: "center", inline: "nearest" });
        });
        await settle(page);
        const readTop = () => page.evaluate(() => document.querySelector("#host .vlist-viewport").scrollTop);
        const arm = (top) => page.evaluate(async (top) => {
          const vp = document.querySelector("#host .vlist-viewport");
          vp.focus({ preventScroll: true });
          for (let i = 0; i < 20; i++) {
            vp.scrollTop = top;
            await new Promise((resolve) => requestAnimationFrame(resolve));
            if (vp.scrollTop === top) return;
          }
        }, top);
        const untilMoved = (from) => page.evaluate(async (from) => {
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
        assert.notEqual(swipeTo, swipeFrom, "a touch swipe moves scrollTop: " + swipeFrom + " -> " + swipeTo);
        await stableTop();
        for (const key of ["ArrowDown", "PageDown", "End", "Space"]) {
          await arm(80);
          const from = await stableTop();
          await page.keyboard.press(key);
          const to = await stableTop();
          assert.ok(Math.abs(to - from) > 15, key + " moves scrollTop: " + from + " -> " + to);
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
      });
    } else {
      await page.evaluate(() => {
        document.querySelector("#fresh .vlist-viewport").scrollTop = 80;
      });
      await settle(page);
      const fresh = await page.evaluate(() => window.bars("#fresh"));
      console.log(label, "fresh", JSON.stringify(fresh));
      await check(label + " custom thumb is rendered", async () => {
        assert.equal(fresh.custom, true, "overlay scrollbars keep the custom track " + JSON.stringify(fresh));
        assert.ok(fresh.thumb > 0, "overlay scrollbars show the custom thumb " + JSON.stringify(fresh));
        assert.ok(fresh.className.includes("vlist-viewport--custom-scrollbar"), fresh.className);
      });
    }
  } finally {
    await browser.close();
  }
}

try {
  await exercise(true);
  await exercise(false);
} finally {
  const failed = results.filter((row) => !row.ok);
  console.log("SUMMARY", JSON.stringify({ pass: results.length - failed.length, fail: failed.length }));
  server.stop(true);
  if (failed.length > 0) process.exitCode = 1;
}
