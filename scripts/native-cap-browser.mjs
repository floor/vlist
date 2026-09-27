/** A native list past the element size limit still scrolls, in Chrome and Firefox.
 *
 * Browsers disagree about an element taller than they can lay out: Chrome
 * clamps it at 33,554,428 px, Firefox lays out nothing above 17,895,697 px and
 * the element collapses to 0. A native list of a million 48 px rows wrote
 * 48,000,000 px: in Firefox it had no scrollbar and could not scroll at all.
 * vlist caps the content at 16,000,000 px, so native input reaches the same
 * rows in both.
 *
 * Firefox runs when one is installed (FIREFOX_PATH, or the usual locations);
 * otherwise that half is skipped with a note. Build first.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

const driver = process.env.VLIST_BROWSER_DRIVER ?? resolve(import.meta.dir, "browser-driver.mjs");
const { launchBrowser } = await import(resolve(driver));
const root = resolve(import.meta.dir, "..");

const ROWS = 1_000_000;
const ROW = 48;

const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/vlist.css">
<style>body { margin: 0; } #host { width: 400px; height: 400px; }</style>
<div id="host"></div>
<script type="module">
  import { createVList } from "/index.js";
  window.list = createVList({
    container: "#host",
    items: Array.from({ length: ${ROWS} }, (_, id) => ({ id })),
    item: { height: ${ROW}, template: (r) => "Row " + r.id },
    scroll: { mode: "native" },
  });
  window.ready = true;
</script>`;

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/") return new Response(html, { headers: { "Content-Type": "text/html" } });
    if (["/index.js", "/synthetic-driver.js", "/vlist.css"].includes(path)) {
      return new Response(Bun.file(root + "/dist" + path), {
        headers: { "Content-Type": path.endsWith(".css") ? "text/css" : "text/javascript" },
      });
    }
    return new Response("", { status: 404 });
  },
});

const FIREFOX_PATHS = [
  process.env.FIREFOX_PATH,
  "/usr/bin/firefox",
  "/Applications/Firefox.app/Contents/MacOS/firefox",
];

async function check(name, browser) {
  const page = await browser.newPage();
  await page.goto(server.url.href);
  await page.waitForFunction(() => window.ready);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const result = await page.evaluate(() => {
    const viewport = document.querySelector(".vlist-viewport");
    const content = document.querySelector(".vlist-content");
    const laidOut = content.getBoundingClientRect().height;
    viewport.scrollTop = 1_000_000;
    return { laidOut, scrollTop: viewport.scrollTop, scrollHeight: viewport.scrollHeight };
  });
  await new Promise((r) => setTimeout(r, 200));
  const position = await page.evaluate(() => window.list.getScrollPosition());
  assert.ok(result.laidOut > 1_000_000, `${name}: content laid out at ${result.laidOut}px`);
  assert.equal(result.scrollTop, 1_000_000, `${name}: the viewport scrolls`);
  assert.equal(position, 1_000_000, `${name}: the list follows`);
  console.log(`PASS ${name}: native list past the limit scrolls ${JSON.stringify({ ...result, position })}`);
}

let failures = 0;
try {
  const chrome = await launchBrowser();
  try { await check("chrome", chrome); } catch (e) { failures++; console.log("FAIL " + e.message); } finally { await chrome.close(); }

  const firefoxPath = FIREFOX_PATHS.find((p) => p && existsSync(p));
  if (!firefoxPath) {
    console.log("SKIP firefox: not installed (set FIREFOX_PATH)");
  } else {
    const firefox = await puppeteer.launch({ browser: "firefox", headless: true, executablePath: firefoxPath });
    try { await check("firefox", firefox); } catch (e) { failures++; console.log("FAIL " + e.message); } finally { await firefox.close(); }
  }
} finally {
  server.stop();
}
console.log(`SUMMARY ${JSON.stringify({ failures })}`);
if (failures) process.exit(1);
