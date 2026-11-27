/** Dragging the thumb past the end of an autosized list (#106).
 *
 * The last rows are taller than the estimate. A drag that reaches the end
 * and keeps going measures them, and the list grows under the pointer.
 *
 * Native: once that growth settles, the viewport stays at its end
 * (`scrollTop` equals `scrollHeight - clientHeight`). Synthetic: the custom
 * thumb sits on the end of the track when the pointer is past it.
 *
 * The native launch leaves Chromium's scrollbars visible and turns overlay
 * scrollbars off, so the drag hits the browser's own thumb. Build first.
 * Uses scripts/browser-driver.mjs. The coordinator wires this script into
 * `test:browser` after merge; package.json is left untouched here.
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
import { createVList, autosize, scrollbar } from "/index.js";
const mode = new URLSearchParams(location.search).get("mode") || "native";
const items = Array.from({ length: 80 }, (_, i) => ({
  id: i,
  h: i >= 65 ? 110 : (i % 4 === 0 ? 72 : 36),
}));
const plugins = [autosize()];
if (mode === "synthetic") plugins.push(scrollbar({ autoHide: false }));
window.list = createVList({
  container: "#list",
  items,
  item: {
    estimatedHeight: 36,
    template: (row) => '<div style="height:' + row.h + 'px;box-sizing:border-box">row ' + row.id + '</div>',
  },
  scroll: { mode, idleTimeout: 150 },
}, plugins);
window.sample = () => {
  const host = document.querySelector(".vlist");
  const vp = host.querySelector(".vlist-viewport");
  const content = host.querySelector(".vlist-content");
  const track = host.querySelector(".vlist-scrollbar:not(.vlist-scrollbar--horizontal)");
  const thumb = track ? track.querySelector(".vlist-scrollbar__thumb") : null;
  const vpBox = vp.getBoundingClientRect();
  const trackBox = track ? track.getBoundingClientRect() : null;
  const thumbBox = thumb ? thumb.getBoundingClientRect() : null;
  const max = Math.max(0, vp.scrollHeight - vp.clientHeight);
  return {
    scrollTop: vp.scrollTop,
    max,
    content: content.style.height,
    valueMax: track ? Number(track.getAttribute("aria-valuemax")) : max,
    valueNow: track ? Number(track.getAttribute("aria-valuenow")) : vp.scrollTop,
    gutter: vp.offsetWidth - vp.clientWidth,
    vpTop: vpBox.top,
    vpBottom: vpBox.bottom,
    vpRight: vpBox.right,
    thumbTop: thumbBox && trackBox ? thumbBox.top - trackBox.top : null,
    thumbHeight: thumbBox ? thumbBox.height : null,
    trackHeight: trackBox ? trackBox.height : null,
    gap: thumbBox && trackBox ? trackBox.bottom - thumbBox.bottom : null,
    trackLeft: trackBox ? trackBox.left : null,
    trackWidth: trackBox ? trackBox.width : null,
    thumbCenter: thumbBox ? thumbBox.top + thumbBox.height / 2 : null,
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

async function dragPastEnd(page, mode) {
  await page.goto(`${server.url}?mode=${mode}`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => window.ready);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await sleep(200);
  const start = await page.evaluate(() => window.sample());
  const dragX = mode === "synthetic"
    ? start.trackLeft + start.trackWidth / 2
    : start.vpRight - Math.max(start.gutter, 8) / 2;
  const originY = mode === "synthetic" ? start.thumbCenter : start.vpTop + 12;
  const endY = start.vpBottom + 48;
  await page.mouse.move(dragX, originY);
  await page.mouse.down();
  const steps = 24;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(dragX, originY + (endY - originY) * (i / steps));
    await sleep(40);
  }
  await sleep(400);
  await page.mouse.up();
  let signature = "";
  let stable = 0;
  for (let i = 0; i < 24 && stable < 3; i++) {
    const next = await page.evaluate(() => {
      const sample = window.sample();
      return `${sample.content}|${sample.valueMax}|${sample.scrollTop}|${sample.gap}`;
    });
    stable = next === signature ? stable + 1 : 0;
    signature = next;
    await sleep(80);
  }
  return { start, end: await page.evaluate(() => window.sample()) };
}

try {
  console.log(await browser.version());
  for (const mode of ["native", "synthetic"]) {
    const page = await browser.newPage();
    await pinPage(page);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.stack ?? String(e)));
    try {
      const { start, end } = await dragPastEnd(page, mode);
      const detail = `start=${JSON.stringify(start)} end=${JSON.stringify(end)}`;
      const grew = mode === "native"
        ? parseFloat(end.content) > parseFloat(start.content) + 8
        : end.valueMax > start.valueMax + 8;
      check(errors.length === 0, `${mode}: no pageerror`, errors.join("\n"));
      check(grew, `${mode}: measuring the last rows grows the list`, detail);
      if (mode === "native") {
        check(
          end.max > 0 && Math.abs(end.scrollTop - end.max) <= 1,
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
      console.error(`FAIL ${mode} drag: ${error.stack ?? error}`);
    } finally {
      await page.close();
    }
  }
  console.log(`SUMMARY checks=${checks} failures=${failures}`);
  assert.equal(failures, 0, `${failures} autosize thumb-drag checks failed`);
  console.log("PASS autosize thumb drag stays at the grown end");
} finally {
  await browser.close();
  server.stop();
}
