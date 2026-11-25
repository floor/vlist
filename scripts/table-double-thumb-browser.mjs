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
  #b-case, #b-pin, #b-rtl, #b-synth { width: 420px; height: 240px; }
  #b-page { width: 420px; height: auto; }
  #b-case .vlist-viewport { border-top: 3px solid #111; }
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
<div id="b-case"></div>
<div id="b-pin"></div>
<div id="b-rtl" dir="rtl"></div>
<div id="b-page"></div>
<div id="b-synth"></div>
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
const bList = (container, plugins) => createVList({
  container,
  items: items(80),
  item: { height: 28, template: (row) => "<span>" + row.name + "</span>" },
  scroll: { mode: "auto" },
}, plugins);
window.bCase = bList("#b-case", [
  table({ rowHeight: 28, headerHeight: 28, columns }),
  scrollbar(),
]);
window.bPin = bList("#b-pin", [
  table({
    rowHeight: 28, headerHeight: 28, columns,
    features: [columnPin({ pins: { kind: "right" } })],
  }),
  scrollbar(),
]);
window.bRtl = bList("#b-rtl", [
  table({
    rowHeight: 28, headerHeight: 28, columns,
    features: [columnPin({ pins: { name: "left" } })],
  }),
  scrollbar(),
]);
window.bPage = bList("#b-page", [
  page({ scrollPadding: { bottom: 80 } }),
  table({
    rowHeight: 28, headerHeight: 28, columns, fillWidth: false,
    features: [columnPin()],
  }),
  scrollbar(),
]);
window.bSynthMode = null;
window.bSynth = createVList({
  container: "#b-synth",
  items: items(80),
  item: { height: 28, template: (row) => "Row " + row.id },
  scroll: { mode: "synthetic" },
}, [scrollbar()]);
window.bSynth.on("scroll:mode", (event) => { window.bSynthMode = event.mode; });
window.bRows = (which, n) => window[which].setItems(items(n));
window.bLayout = (id) => {
  const root = document.querySelector(id);
  const vp = root.querySelector(".vlist-viewport");
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  };
  const headers = [...root.querySelectorAll(".vlist-table-header-cell")];
  const row = root.querySelector(".vlist-table-row");
  const cells = row ? [...row.querySelectorAll(".vlist-table-cell")] : [];
  const track = root.querySelector(".vlist-scrollbar:not(.vlist-scrollbar--horizontal)");
  const hover = root.querySelector(".vlist-scrollbar__hover:not(.vlist-scrollbar__hover--horizontal)");
  const header = root.querySelector(".vlist-table-header");
  return {
    clientWidth: vp.clientWidth,
    header: headers.map(box),
    body: cells.map(box),
    track: track ? box(track) : null,
    hover: hover ? box(hover) : null,
    headerBottom: header ? header.getBoundingClientRect().bottom : 0,
    vp: box(vp),
    scrollLeft: vp.scrollLeft,
    scrollTop: vp.scrollTop,
  };
};
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
    if (["/index.js", "/synthetic-driver.js", "/vlist.css", "/vlist-table.css"].includes(path)) {
      return new Response(Bun.file(root + path));
    }
    return new Response("", { status: 404 });
  },
});

let browser;
const results = [];
const log = console.log.bind(console);
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

  let groupFailed = false;
  for (const key of ["equal", "ok", "notEqual"]) {
    const orig = assert[key].bind(assert);
    assert[key] = (...args) => {
      try {
        orig(...args);
      } catch (error) {
        groupFailed = true;
        const message = String(error.message).split("\n")[0];
        results.push({ ok: false, message });
        log("FAIL", message);
      }
    };
  }
  console.log = (...args) => {
    if (typeof args[0] === "string" && args[0].startsWith("PASS")) {
      const name = args.map(String).join(" ");
      if (groupFailed) {
        results.push({ ok: false, message: name });
        log("FAIL group", name);
        groupFailed = false;
        return;
      }
      results.push({ ok: true, message: name });
    }
    log(...args);
  };
  const part = async (name, fn) => {
    groupFailed = false;
    try {
      await fn();
      console.log("PASS " + name);
    } catch (error) {
      groupFailed = false;
      const message = name + ": " + (error && error.message ? error.message : error);
      results.push({ ok: false, message });
      log("FAIL", message);
    }
  };

  // Option B: the track and its hover zone occupy a column beside the
  // scrollport, and that column stays while the track is hidden. These
  // checks state that layout. They run at the case-5 fixture, DPR 1.25.
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 900,
    height: 1600,
    deviceScaleFactor: 1.25,
    mobile: false,
  });
  await settle(page);

  const aligned = (layout, label) => {
    const count = Math.min(layout.header.length, layout.body.length);
    assert.ok(count > 0, label + " mounts header and body columns");
    for (let i = 0; i < count; i++) {
      assert.ok(
        Math.abs(layout.header[i].left - layout.body[i].left) <= 1,
        label + " column " + i + " left edges line up",
      );
      assert.ok(
        Math.abs(layout.header[i].right - layout.body[i].right) <= 1,
        label + " column " + i + " right edges line up",
      );
    }
  };
  const beside = (layout, side, label) => {
    assert.ok(layout.track && layout.hover, label + " mounts a track and a hover zone");
    assert.ok(layout.track.top >= layout.headerBottom - 1, label + " rail starts below the header");
    if (side === "right") {
      assert.ok(layout.track.left >= layout.vp.right - 1, label + " track is beside the scrollport");
      assert.ok(layout.hover.left >= layout.vp.right - 1, label + " hover zone is beside the scrollport");
    } else {
      assert.ok(layout.track.right <= layout.vp.left + 1, label + " RTL track is on the inline-end side");
      assert.ok(layout.hover.right <= layout.vp.left + 1, label + " RTL hover zone is on the inline-end side");
    }
  };

  await part("B right-end click and drag change only scrollLeft", async () => {
    await page.evaluate(() => {
      const vp = document.querySelector("#b-case .vlist-viewport");
      vp.scrollLeft = 180;
      vp.scrollTop = 0;
      document.querySelector("#b-case").scrollIntoView({ block: "center", inline: "nearest" });
    });
    await settle(page);
    const point = await page.evaluate(() => {
      const vp = document.querySelector("#b-case .vlist-viewport");
      const rect = vp.getBoundingClientRect();
      const css = getComputedStyle(vp);
      const borderTop = parseFloat(css.borderTopWidth) || 0;
      const borderBottom = parseFloat(css.borderBottomWidth) || 0;
      const bar = Math.max(0, (vp.offsetHeight - vp.clientHeight) - borderTop - borderBottom);
      const y = rect.bottom - borderBottom - Math.max(bar, 8) / 2;
      const hit = document.elementFromPoint(rect.right - 1, y);
      return {
        x: rect.right - 1,
        y,
        bar,
        borderTop,
        hit: hit ? String(hit.className) : "",
        left: vp.scrollLeft,
        top: vp.scrollTop,
      };
    });
    assert.ok(point.bar > 0, "B: the case-5 fixture paints a horizontal bar " + JSON.stringify(point));
    await page.mouse.click(point.x, point.y);
    await settle(page);
    const clicked = await page.evaluate(() => {
      const vp = document.querySelector("#b-case .vlist-viewport");
      return { left: vp.scrollLeft, top: vp.scrollTop };
    });
    assert.equal(clicked.top, point.top, "B: right-end click keeps scrollTop " + JSON.stringify({ point, clicked }));
    assert.notEqual(clicked.left, point.left, "B: right-end click changes scrollLeft " + JSON.stringify({ point, clicked }));

    await page.evaluate(() => {
      const vp = document.querySelector("#b-case .vlist-viewport");
      vp.scrollLeft = vp.scrollWidth;
      vp.scrollTop = 0;
    });
    await settle(page);
    const start = await page.evaluate((y) => {
      const vp = document.querySelector("#b-case .vlist-viewport");
      const rect = vp.getBoundingClientRect();
      return { x: rect.right - 1, y, left: vp.scrollLeft, top: vp.scrollTop };
    }, point.y);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x - 60, start.y, { steps: 6 });
    await page.mouse.up();
    await settle(page);
    const dragged = await page.evaluate(() => {
      const vp = document.querySelector("#b-case .vlist-viewport");
      return { left: vp.scrollLeft, top: vp.scrollTop };
    });
    assert.equal(dragged.top, start.top, "B: right-end drag keeps scrollTop " + JSON.stringify({ start, dragged }));
    assert.notEqual(dragged.left, start.left, "B: right-end drag changes scrollLeft " + JSON.stringify({ start, dragged }));
  });

  await part("B header and body edges with the track shown and hidden", async () => {
    await page.evaluate(() => document.querySelector("#b-case").scrollIntoView({ block: "center" }));
    await settle(page);
    const shown = await page.evaluate(() => window.bLayout("#b-case"));
    aligned(shown, "B shown");
    beside(shown, "right", "B shown");
    await page.evaluate(() => window.bRows("bCase", 4));
    await settle(page);
    const hidden = await page.evaluate(() => window.bLayout("#b-case"));
    assert.equal(
      hidden.clientWidth,
      shown.clientWidth,
      "B: scrollport width stays stable when the track hides " + shown.clientWidth + " -> " + hidden.clientWidth,
    );
    aligned(hidden, "B hidden");
    beside(hidden, "right", "B hidden");
    await page.evaluate(() => window.bRows("bCase", 80));
    await settle(page);
  });

  await part("B pinned columns keep their edges", async () => {
    await page.evaluate(() => document.querySelector("#b-pin").scrollIntoView({ block: "center" }));
    await settle(page);
    const shown = await page.evaluate(() => window.bLayout("#b-pin"));
    aligned(shown, "B pin");
    beside(shown, "right", "B pin");
    const pin = await page.evaluate(() => {
      const header = document.querySelector("#b-pin .vlist-table-header-cell--pin-right");
      const body = document.querySelector("#b-pin .vlist-table-cell--pin-right");
      const hr = header.getBoundingClientRect();
      const br = body.getBoundingClientRect();
      return { left: Math.abs(hr.left - br.left), right: Math.abs(hr.right - br.right) };
    });
    assert.ok(pin.left <= 1 && pin.right <= 1, "B: pinned header and body edges line up " + JSON.stringify(pin));
    await page.evaluate(() => window.bRows("bPin", 4));
    await settle(page);
    const hidden = await page.evaluate(() => window.bLayout("#b-pin"));
    assert.equal(hidden.clientWidth, shown.clientWidth, "B: pinned scrollport width stays stable when the track hides");
    aligned(hidden, "B pin hidden");
    await page.evaluate(() => window.bRows("bPin", 80));
    await settle(page);
  });

  await part("B RTL keeps the rail on the inline-end side", async () => {
    await page.evaluate(() => {
      const vp = document.querySelector("#b-rtl .vlist-viewport");
      vp.scrollLeft = -80;
      document.querySelector("#b-rtl").scrollIntoView({ block: "center" });
    });
    await settle(page);
    const rtl = await page.evaluate(() => window.bLayout("#b-rtl"));
    assert.ok(rtl.scrollLeft < 0, "B: RTL scrollLeft is negative " + rtl.scrollLeft);
    aligned(rtl, "B rtl");
    beside(rtl, "left", "B rtl");
    const pin = await page.evaluate(() => {
      const header = document.querySelector("#b-rtl .vlist-table-header-cell--pin-left");
      const body = document.querySelector("#b-rtl .vlist-table-cell--pin-left");
      const hr = header.getBoundingClientRect();
      const br = body.getBoundingClientRect();
      return { left: Math.abs(hr.left - br.left), right: Math.abs(hr.right - br.right) };
    });
    assert.ok(pin.left <= 1 && pin.right <= 1, "B: RTL pinned edges line up " + JSON.stringify(pin));
  });

  await part("B page() keeps the document as the vertical scroller", async () => {
    const plain = await page.evaluate(() => {
      const root = document.querySelector("#b-page .vlist");
      const vp = root.querySelector(".vlist-viewport");
      vp.scrollTop = 240;
      return {
        page: root.classList.contains("vlist--page"),
        overflowY: getComputedStyle(vp).overflowY,
        viewportTop: vp.scrollTop,
      };
    });
    assert.equal(plain.page, true, "B: the page list is in page mode");
    assert.equal(plain.overflowY, "visible", "B: an unpinned page list does not scroll its viewport vertically");
    assert.equal(plain.viewportTop, 0, "B: vertical scroll stays on the document");
    await page.evaluate(() => window.bPage.setColumnPin("name", "left"));
    await settle(page);
    const pinned = await page.evaluate(() => {
      const vp = document.querySelector("#b-page .vlist-viewport");
      vp.scrollTop = 240;
      return {
        overflowY: getComputedStyle(vp).overflowY,
        viewportTop: vp.scrollTop,
      };
    });
    assert.equal(pinned.viewportTop, 0, "B: a pinned page table keeps vertical scroll on the document " + JSON.stringify(pinned));
  });

  await part("B synthetic drag covers the logical range", async () => {
    await page.waitForFunction(() => window.bSynthMode === "synthetic", { timeout: 8000 });
    await page.evaluate(() => document.querySelector("#b-synth").scrollIntoView({ block: "center" }));
    await settle(page);
    const range = await page.evaluate(() => {
      window.bSynth.scrollToIndex(79);
      const max = window.bSynth.getScrollPosition();
      window.bSynth.scrollToIndex(0);
      const content = document.querySelector("#b-synth .vlist-content");
      const track = document.querySelector("#b-synth .vlist-scrollbar");
      return { max, outside: track && content ? !content.contains(track) : false };
    });
    assert.equal(range.outside, true, "B: the synthetic rail is outside the translated rows");
    assert.ok(range.max > 200, "B: the synthetic list has a logical range " + range.max);
    await settle(page);
    const thumb = await page.evaluate(() => {
      const track = document.querySelector("#b-synth .vlist-scrollbar");
      const node = track.querySelector(".vlist-scrollbar__thumb");
      const tr = node.getBoundingClientRect();
      const kr = track.getBoundingClientRect();
      return { x: tr.left + tr.width / 2, y: tr.top + Math.max(tr.height, 4) / 2, bottom: kr.bottom - 2, h: tr.height };
    });
    assert.ok(thumb.h > 0, "B: the synthetic thumb has a drag length " + JSON.stringify(thumb));
    await page.mouse.move(thumb.x, thumb.y);
    await settle(page);
    await page.mouse.down();
    await page.mouse.move(thumb.x, thumb.bottom, { steps: 8 });
    await page.mouse.up();
    await settle(page);
    const pos = await page.evaluate(() => window.bSynth.getScrollPosition());
    assert.ok(pos >= range.max * 0.85, "B: dragging the thumb covers the logical range " + pos + " of " + range.max);
  });

  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 760,
    height: 1280,
    deviceScaleFactor: 1,
    mobile: false,
  });
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

  await page.evaluate(() => {
    document.querySelector("#host").scrollIntoView({ block: "center", inline: "nearest" });
  });
  await settle(page);
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
  const clickRail = async (selector, y, column) => {
    await place(selector);
    const box = await readEnds(selector);
    const x = column ? box.right + 6 : box.right - 9;
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
  const borderClick = await clickRail("#bordered", (box) => box.edge - 8, true);
  assert.ok(borderClick.hit.includes("vlist-scrollbar"), "bordered lower rail is " + borderClick.hit);
  assert.ok(borderClick.after.top > borderClick.before.top + 15, "bordered lower rail pages " + JSON.stringify(borderClick));
  console.log("PASS bordered rail", JSON.stringify({ hit: borderClick.hit, top: [borderClick.before.top, borderClick.after.top] }));

  const checkEnds = async (selector, expectBar) => {
    await place(selector);
    const box = await readEnds(selector);
    if (expectBar) {
      assert.ok(box.bar > 0, selector + " gains a horizontal bar " + JSON.stringify(box));
    } else {
      assert.equal(box.bar, 0, selector + " loses the horizontal bar " + JSON.stringify(box));
      assert.equal(box.bottom, "", selector + " clears the inset " + box.bottom);
      assert.equal(box.hoverBottom, "", selector + " clears the hover inset");
    }
    const barY = (next) => next.edge - (expectBar ? next.bar / 2 : 5);
    const railY = (next) => next.edge - next.bar - (expectBar ? 6 : 12);
    const barClick = await clickRail(selector, barY, !expectBar);
    const railClick = await clickRail(selector, railY, true);
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
    const barLeft = rect.left + vp.clientLeft;
    const barRight = barLeft + vp.clientWidth;
    const sharesX = (left, right) => left < barRight - 0.5 && right > barLeft + 0.5;
    return {
      thick, bottom, gap,
      barLeft, barRight,
      trackShares: sharesX(track.left, track.right),
      hoverShares: sharesX(hover.left, hover.right),
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
  assert.equal(bottomBorder.trackShares, false, "track shares no x with the horizontal bar " + JSON.stringify(bottomBorder));
  assert.equal(bottomBorder.hoverShares, false, "hover zone shares no x with the horizontal bar " + JSON.stringify(bottomBorder));
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
} catch (error) {
  const message = "uncaught: " + (error && error.stack ? error.stack : error);
  results.push({ ok: false, message });
  log("FAIL", message);
} finally {
  const failed = results.filter((row) => !row.ok).length;
  const passed = results.filter((row) => row.ok).length;
  log("SUMMARY", JSON.stringify({ pass: passed, fail: failed }));
  await browser?.close();
  server.stop(true);
  if (failed > 0) process.exitCode = 1;
}
