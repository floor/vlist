/** Dragging the thumb past the end of an autosized list (#106).
 *
 * The last rows are taller than the estimate. A drag that reaches the end
 * and keeps going measures them, and the list grows under the pointer.
 * The drag has to grab the thumb: scroll moves with the pointer, and it
 * does not move on the press alone. After that, once the growth settles,
 * a native list stays at `scrollTop === scrollHeight - clientHeight` and
 * a synthetic thumb sits on the end of the track.
 *
 * A measurement that merely leaves the list on the height published so far
 * is not that drag. Appending items, scrollToIndex, and restoring a
 * snapshot must stay where that call put them, in a vertical list, a
 * horizontal list, a synthetic list, and a page list.
 *
 * The native launch leaves Chromium's scrollbars visible and turns overlay
 * scrollbars off, so the drag hits the browser's own thumb. Build first.
 * Uses scripts/browser-driver.mjs. `test:browser` runs this script.
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { findChrome } from "./browser-driver.mjs";
import { pinPage } from "./browser-page.mjs";

const root = resolve(import.meta.dir, "..");
const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/vlist.css">
<style>
  body { margin: 16px; }
  #list { width: 420px; height: 240px; }
</style>
<div id="list"></div>
<script type="module">
import { createVList, autosize, scrollbar, snapshots, page } from "/index.js";
const q = new URLSearchParams(location.search);
const kind = q.get("kind") || "native";
const horizontal = q.get("axis") === "x";
const jump = q.get("fixture") === "jump";
const items = jump
  ? Array.from({ length: 100 }, (_, i) => ({ id: i, h: i === 17 ? 4000 : 40 }))
  : Array.from({ length: 80 }, (_, i) => ({ id: i, h: i >= 65 ? 110 : (i % 4 === 0 ? 72 : 36) }));
const plugins = [autosize()];
if (kind === "synthetic") plugins.push(scrollbar({ autoHide: false }));
if (kind === "page") plugins.unshift(page());
if (jump) plugins.push(snapshots());
const mode = kind === "synthetic" ? "synthetic" : "native";
window.list = createVList({
  container: "#list",
  items,
  orientation: horizontal ? "horizontal" : "vertical",
  item: horizontal
    ? { estimatedWidth: jump ? 40 : 36, template: (row) => '<div style="width:' + row.h + 'px;height:100%;box-sizing:border-box">row ' + row.id + '</div>' }
    : { estimatedHeight: jump ? 40 : 36, template: (row) => '<div style="height:' + row.h + 'px;box-sizing:border-box">row ' + row.id + '</div>' },
  scroll: { mode, idleTimeout: 150 },
}, plugins);
window.sample = () => {
  const host = document.querySelector(".vlist");
  const vp = host.querySelector(".vlist-viewport");
  const content = host.querySelector(".vlist-content");
  const pageList = host.classList.contains("vlist--page");
  const x = host.classList.contains("vlist--horizontal");
  const track = host.querySelector(x ? ".vlist-scrollbar--horizontal" : ".vlist-scrollbar:not(.vlist-scrollbar--horizontal)");
  const thumb = track ? track.querySelector(".vlist-scrollbar__thumb") : null;
  const vpBox = vp.getBoundingClientRect();
  const trackBox = track ? track.getBoundingClientRect() : null;
  const thumbBox = thumb ? thumb.getBoundingClientRect() : null;
  const nativeMax = Math.max(0, x ? vp.scrollWidth - vp.clientWidth : vp.scrollHeight - vp.clientHeight);
  const raw = content.style[x ? "width" : "height"];
  const view = pageList
    ? (x ? window.innerWidth : window.innerHeight)
    : (x ? vp.clientWidth : vp.clientHeight);
  const max = raw.endsWith("px")
    ? Math.max(0, parseFloat(raw) - view)
    : (track ? Number(track.getAttribute("aria-valuemax")) : nativeMax);
  return {
    pos: window.list.getScrollPosition(),
    scrollTop: x ? vp.scrollLeft : vp.scrollTop,
    max,
    nativeMax,
    content: raw,
    valueMax: track ? Number(track.getAttribute("aria-valuemax")) : max,
    valueNow: track ? Number(track.getAttribute("aria-valuenow")) : (x ? vp.scrollLeft : vp.scrollTop),
    gutter: x ? vp.offsetHeight - vp.clientHeight : vp.offsetWidth - vp.clientWidth,
    vpStart: x ? vpBox.left : vpBox.top,
    vpEnd: x ? vpBox.right : vpBox.bottom,
    cross: x ? vpBox.bottom : vpBox.right,
    thumbStart: thumbBox && trackBox ? (x ? thumbBox.left - trackBox.left : thumbBox.top - trackBox.top) : null,
    thumbSize: thumbBox ? (x ? thumbBox.width : thumbBox.height) : null,
    trackSize: trackBox ? (x ? trackBox.width : trackBox.height) : null,
    gap: thumbBox && trackBox ? (x ? trackBox.right - thumbBox.right : trackBox.bottom - thumbBox.bottom) : null,
    trackCross: trackBox ? (x ? trackBox.top : trackBox.left) : null,
    trackThickness: trackBox ? (x ? trackBox.height : trackBox.width) : null,
    thumbCenter: thumbBox ? (x ? thumbBox.left + thumbBox.width / 2 : thumbBox.top + thumbBox.height / 2) : null,
  };
};
window.runIndex = () => { window.list.scrollToIndex(18); return window.sample(); };
window.runAppend = () => {
  window.list.scrollToIndex(18);
  window.list.appendItems([{ id: 500, h: 300 }, { id: 501, h: 300 }]);
  return window.sample();
};
window.runRestore = async () => {
  window.list.scrollToIndex(20);
  const snap = window.list.getScrollSnapshot();
  window.list.scrollToIndex(0);
  await window.list.restoreScroll(snap, false);
  return window.sample();
};
window.ready = true;
</script>`;

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/") return new Response(html, { headers: { "Content-Type": "text/html" } });
    if (["/index.js", "/synthetic-driver.js", "/vlist.css"].includes(path)) {
      return new Response(Bun.file(`${root}/dist${path}`));
    }
    return new Response("Not found", { status: 404 });
  },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await puppeteer.launch({
  headless: true,
  executablePath: findChrome(),
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-features=OverlayScrollbar"],
});
const child = browser.process();
for (const stream of [child?.stdin, child?.stdout, child?.stderr]) stream?.unref?.();

let checks = 0;
let failures = 0;
const check = (ok, label, detail) => {
  checks++;
  if (ok) console.log(`PASS ${label}`);
  else { failures++; console.error(`FAIL ${label}: ${detail}`); }
};

async function open(page, query, viewport) {
  await pinPage(page, viewport);
  await page.goto(`${server.url}?${query}`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => window.ready);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await sleep(200);
}

function along(sample, delta) {
  const x = sample.gutter > 0 ? sample.cross - sample.gutter / 2 : sample.cross - 4;
  return { cross: x, along: sample.vpStart + delta };
}

async function dragPastEnd(page, kind) {
  await open(page, `kind=${kind}&fixture=drag`);
  const start = await page.evaluate(() => window.sample());
  let origin = kind === "synthetic"
    ? { cross: start.trackCross + start.trackThickness / 2, along: start.thumbCenter }
    : along(start, 12);
  let grabbed = null;
  const candidates = kind === "synthetic"
    ? [origin]
    : [4, 8, 12, 16, 20, 24, 28, 32, 40, (start.gutter || 8) + 10].map((dy) => along(start, dy));
  for (const point of candidates) {
    if (kind !== "synthetic") {
      await page.evaluate(() => window.list.scrollToIndex(0));
      await sleep(60);
    }
    const before = await page.evaluate(() => window.sample().pos);
    await page.mouse.move(point.cross, point.along);
    await page.mouse.down();
    await sleep(30);
    const afterDown = await page.evaluate(() => window.sample().pos);
    const step = kind === "synthetic" ? 36 : 30;
    await page.mouse.move(point.cross, point.along + step);
    await sleep(40);
    const afterMove = await page.evaluate(() => window.sample().pos);
    const pressed = afterDown - before;
    const dragged = afterMove - afterDown;
    if (pressed < 20 && dragged > 40) {
      grabbed = { before, afterDown, afterMove, point };
      origin = point;
      break;
    }
    await page.mouse.up();
  }
  if (!grabbed) {
    return { start, end: await page.evaluate(() => window.sample()), grabbed: null };
  }
  const endAlong = start.vpEnd + 48;
  const steps = 24;
  for (let i = 1; i <= steps; i++) {
    const y = origin.along + (endAlong - origin.along) * (i / steps);
    await page.mouse.move(origin.cross, y);
    await sleep(40);
  }
  await sleep(400);
  await page.mouse.up();
  let signature = "";
  let stable = 0;
  for (let i = 0; i < 24 && stable < 3; i++) {
    const next = await page.evaluate(() => {
      const sample = window.sample();
      return `${sample.content}|${sample.valueMax}|${sample.pos}|${sample.gap}`;
    });
    stable = next === signature ? stable + 1 : 0;
    signature = next;
    await sleep(80);
  }
  return { start, end: await page.evaluate(() => window.sample()), grabbed };
}

const layouts = [
  { name: "vertical", kind: "native", axis: "y" },
  { name: "horizontal", kind: "native", axis: "x" },
  { name: "synthetic", kind: "synthetic", axis: "y" },
  { name: "page", kind: "page", axis: "y" },
];

try {
  console.log(await browser.version());
  for (const kind of ["native", "synthetic"]) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.stack ?? String(e)));
    try {
      const { start, end, grabbed } = await dragPastEnd(page, kind);
      const detail = `grabbed=${JSON.stringify(grabbed)} start=${JSON.stringify(start)} end=${JSON.stringify(end)}`;
      check(errors.length === 0, `${kind}: no pageerror`, errors.join("\n"));
      check(!!grabbed, `${kind}: the thumb was grabbed and scroll moved with the pointer`, detail);
      const grew = kind === "native"
        ? parseFloat(end.content) > parseFloat(start.content) + 8
        : end.valueMax > start.valueMax + 8;
      check(grew, `${kind}: measuring the last rows grows the list`, detail);
      if (kind === "native") {
        check(
          end.nativeMax > 0 && Math.abs(end.scrollTop - end.nativeMax) <= 1,
          "native: after the drag, scrollTop stays at the grown end",
          detail,
        );
      } else {
        check(
          end.gap != null && end.gap <= 4,
          "synthetic: the thumb reaches the track end when the pointer goes past it",
          detail,
        );
      }
    } catch (error) {
      failures++;
      checks++;
      console.error(`FAIL ${kind} drag: ${error.stack ?? error}`);
    } finally {
      await page.close();
    }
  }

  for (const layout of layouts) {
    for (const op of ["runIndex", "runAppend", "runRestore"]) {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.stack ?? String(e)));
      try {
        const viewport = layout.kind === "page" ? { height: 420 } : undefined;
        await open(page, `kind=${layout.kind}&axis=${layout.axis}&fixture=jump`, viewport);
        const before = await page.evaluate((name) => window[name](), op);
        await sleep(500);
        const after = await page.evaluate(() => window.sample());
        const detail = `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`;
        check(errors.length === 0, `${layout.name} ${op}: no pageerror`, errors.join("\n"));
        check(
          after.max > after.pos + 8,
          `${layout.name} ${op}: the list does not jump to the new end`,
          detail,
        );
      } catch (error) {
        failures++;
        checks++;
        console.error(`FAIL ${layout.name} ${op}: ${error.stack ?? error}`);
      } finally {
        await page.close();
      }
    }
  }

  console.log(`SUMMARY checks=${checks} failures=${failures}`);
  assert.equal(failures, 0, `${failures} autosize thumb-drag checks failed`);
  console.log("PASS autosize thumb drag stays at the grown end");
} finally {
  await browser.close();
  server.stop();
}
