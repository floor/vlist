/** Real native-scroll bounds and in-flight remeasurement targets. Build first.
 * VLIST_REMEASURE_ROOT selects another build; VLIST_REMEASURE_CAPTURES saves
 * the before/after views for review. No screenshots are written by default.
 */
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { launchBrowser } from "./browser-driver.mjs";
import { pinPage } from "./browser-page.mjs";

const root = process.env.VLIST_REMEASURE_ROOT ?? resolve(import.meta.dir, "..");
const captures = process.env.VLIST_REMEASURE_CAPTURES;
const modes = process.env.VLIST_REMEASURE_MODES?.split(",");
if (captures) await mkdir(captures, { recursive: true });
const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/vlist.css"><link rel="stylesheet" href="/vlist-table.css">
<style>body{font:16px system-ui;margin:24px}#host{width:480px;height:360px;border:1px solid #777}h1{font-size:20px}#result{white-space:pre-wrap}</style>
<h1>Remeasurement scroll checks</h1><p id="scenario"></p><div id="host"></div><pre id="result"></pre>
<script type="module">
import {createVList,table,groups,autosize} from '/index.js';
const mode = new URLSearchParams(location.search).get('mode');
const horizontal = mode === 'autosize-horizontal';
const measured = mode.startsWith('autosize');
const heights = [];
const size = i => heights[i] ?? 40;
const plugins = [];
if (mode.includes('table')) plugins.push(table({columns:[{key:'name',label:'Name',width:440}],rowHeight:size,headerHeight:24}));
if (mode.includes('groups')) plugins.push(groups({getGroupForIndex:i=>i<50?'A':'B',header:{height:20,template:key=>key}}));
if (measured) plugins.push(autosize());
window.list = createVList({container:'#host',orientation:horizontal?'horizontal':'vertical',items:Array.from({length:100},(_,id)=>({id,name:'Row '+id})),item: measured
  ? {estimatedHeight:40,estimatedWidth:40,template:item=>'<div style="height:40px;width:40px">'+item.id+'</div>'}
  : {height:size,template:item=>item.name}},plugins);
window.heights = heights;
window.horizontal = horizontal;
window.viewport = document.querySelector('.vlist-viewport');
window.row = id => document.querySelector('.vlist-content [data-id="'+id+'"]');
window.position = id => {
  const row = window.row(id).getBoundingClientRect();
  const view = viewport.getBoundingClientRect();
  return horizontal ? row.left-view.left : row.top-view.top;
};
document.querySelector('#scenario').textContent=mode;
window.ready=true;
</script>`;
const server = Bun.serve({ port: 0, fetch(req) {
  const path = new URL(req.url).pathname;
  if (path === "/") return new Response(html, { headers: { "Content-Type": "text/html" } });
  if (["/index.js", "/vlist.css", "/vlist-table.css"].includes(path)) return new Response(Bun.file(`${root}/dist${path}`));
  return new Response("Not found", { status: 404 });
} });
let browser;
let failures = 0;
let checks = 0;
const settle = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  browser = await launchBrowser();
  let page;
  const open = async mode => {
    await page?.close();
    page = await browser.newPage();
    page.on("pageerror", error => console.error(`PAGE ERROR: ${error.message}`));
    await pinPage(page, { width: 720, height: 620 });
    console.log(`OPEN ${mode}`);
    await page.goto(`http://localhost:${server.port}/?mode=${mode}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.ready);
    await settle(150);
  };
  const report = async (name, actual, expected) => {
    checks++;
    const pass = Math.abs(actual - expected) < 1;
    if (!pass) failures++;
    const line = `${pass ? "PASS" : "FAIL"} ${name}: actual=${actual.toFixed(2)} expected=${expected.toFixed(2)}`;
    console.log(line);
    await page.evaluate(line => { document.querySelector("#result").textContent += line + "\n"; }, line);
  };
  const capture = async name => {
    if (captures) await page.screenshot({ path: resolve(captures, `${name}.png`) });
  };
  for (const mode of ["core", "table", "groups", "table-groups"]) {
    if (modes && !modes.includes(mode)) continue;
    await open(mode);
    const before = await page.evaluate(() => {
      list.scrollToIndex(99, "end");
      const rect = viewport.getBoundingClientRect();
      const anchor = [...document.querySelectorAll('.vlist-content [data-id]')].find(el => el.getBoundingClientRect().top >= rect.top + 40);
      const id = anchor.getAttribute("data-id");
      return { id, position: position(id), scroll: list.getScrollPosition() };
    });
    await capture(`${mode}-end-before`);
    const after = await page.evaluate(id => {
      heights[0] = 140;
      list.remeasureItem(0);
      return { position: position(id), scroll: list.getScrollPosition() };
    }, before.id);
    await report(`${mode} end anchor`, after.position, before.position);
    await report(`${mode} end scroll`, after.scroll, before.scroll + 100);
    await capture(`${mode}-end-after`);

    await open(mode);
    await page.evaluate(() => list.scrollToIndex(50, {behavior:"smooth",duration:600,easing:t=>t}));
    await settle(200);
    await page.evaluate(() => { heights[0] = 140; list.remeasureItem(0); });
    await settle(700);
    await report(`${mode} smooth target`, await page.evaluate(() => position(50)), 0);
    await capture(`${mode}-smooth-after`);
  }
  for (const mode of ["autosize-vertical", "autosize-horizontal"]) {
    if (modes && !modes.includes(mode)) continue;
    await open(mode);
    await page.evaluate(() => {
      const max = horizontal ? viewport.scrollWidth-viewport.clientWidth : viewport.scrollHeight-viewport.clientHeight;
      viewport[horizontal?'scrollLeft':'scrollTop'] = max-10;
    });
    await settle(200);
    const before = await page.evaluate(() => {
      const start = list.getScrollPosition();
      const index = Math.floor(start/40)-1;
      return {start,index,anchor:index+2,position:position(index+2)};
    });
    await capture(`${mode}-before`);
    await page.evaluate(index => {
      row(index).firstElementChild.style[horizontal?'width':'height'] = '140px';
      list.remeasureItem(index);
    }, before.index);
    await settle(200);
    await report(`${mode} anchor`, await page.evaluate(id => position(id), before.anchor), before.position);
    await report(`${mode} scroll`, await page.evaluate(() => list.getScrollPosition()), before.start + 100);
    await capture(`${mode}-after`);
  }
  console.log(`${checks - failures}/${checks} remeasurement browser checks passed; ${failures} failed`);
} finally {
  await browser?.close();
  server.stop(true);
}
process.exitCode = failures ? 1 : 0;
