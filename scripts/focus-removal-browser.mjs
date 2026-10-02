/** Focused-row removal (#339), adapted from the archived browser reproduction.
 * Build first. VLIST_BROWSER_DRIVER supplies launchBrowser (default Chromium).
 * VLIST_FOCUS_ROOT can serve a scratch baseline build without changing this tree.
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";
const { launchBrowser } = await import(resolve(process.env.VLIST_BROWSER_DRIVER ?? resolve(import.meta.dir, "browser-driver.mjs")));
const root = process.env.VLIST_FOCUS_ROOT ?? resolve(import.meta.dir, "..");
const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/vlist.css"><link rel="stylesheet" href="/vlist-table.css">
<style>body{margin:16px}#list{width:480px;height:320px}</style>
<button id="outside">Outside</button><div id="list"></div>
<script type="module">
import {createVList,table,grid,groups,tree,masonry,a11y,selection} from '/index.js';
const params = new URLSearchParams(location.search);
const layout = params.get('layout');
const cell = row => { const el=document.createElement('span'); el.tabIndex=0; el.textContent='Row '+row.id; return el; };
const plugins=[];
if(layout==='table') plugins.push(table({rowHeight:48,columns:[{key:'value',label:'Value',width:240,cell}]}));
if(layout==='grid') plugins.push(grid({columns:3}));
if(layout==='groups') plugins.push(groups({getGroupForIndex:i=>'G'+Math.floor(i/1000),header:{height:30,template:g=>g}}));
if(layout==='tree') plugins.push(tree({label:'value'}));
if(layout==='masonry') plugins.push(masonry({columns:3,gap:8}));
plugins.push((params.get('owner')==='selection'?selection:a11y)({keyboard:params.get('keyboard')!=='false'}));
window.passes=0;
plugins.push({name:'pass-counter',hooks:{onCommit(){window.passes++;}}});
window.list=createVList({container:'#list',items:Array.from({length:50000},(_,id)=>({id,value:'Row '+id})),item:{height:48,template:cell}},plugins);
window.scrollAway=()=>{window.list.scrollToIndex(layout==='masonry'?49900:49999,'center'); if(layout==='masonry') window.list.scrollToIndex(49999,'center');};
window.ready=true;
</script>`;
const server = Bun.serve({ port: 0, fetch(req) {
  const path = new URL(req.url).pathname;
  if (path === "/") return new Response(html, { headers: { "Content-Type": "text/html" } });
  if (["/index.js", "/vlist.css", "/vlist-table.css"].includes(path)) return new Response(Bun.file(`${root}/dist${path}`));
  return new Response("Not found", { status: 404 });
} });
const browser = await launchBrowser();
let failures = 0;
try {
  console.log(await browser.version());
  for (const owner of ["a11y", "selection"]) for (const layout of ["table", "plain", "grid", "groups", "tree", "masonry"]) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", e => { errors.push(e.stack ?? String(e)); console.error(e.stack ?? String(e)); });
    try {
      await page.goto(`http://localhost:${server.port}/?layout=${layout}&owner=${owner}`);
      await page.waitForFunction(() => window.ready);
      const result = await page.evaluate(async () => {
        const content = document.querySelector('.vlist-content');
        const target = content.hasAttribute('tabindex') ? content : document.querySelector('.vlist-viewport');
        target.focus();
        target.dispatchEvent(new KeyboardEvent('keydown', {key:'Home',bubbles:true}));
        if (new URLSearchParams(location.search).get('layout')==='groups') target.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown',bubbles:true}));
        const id = content.getAttribute('aria-activedescendant');
        const row = document.getElementById(id);
        const from = Number(row.dataset.index);
        const span = row.querySelector('span[tabindex]');
        span.focus();
        const focusedWasCell = document.activeElement === span;
        let thrown = null;
        try { window.scrollAway(); } catch (error) { thrown = error.stack ?? String(error); }
        const synchronous = window.passes;
        await new Promise(requestAnimationFrame);
        return { thrown, from, focusedWasCell, recovered:document.activeElement===target,
          target:target.className, farRowRendered:content.textContent.includes('Row 49999'),
          removed:!span.isConnected, extraPasses:window.passes-synchronous };
      });
      if (result.thrown) console.error(result.thrown);
      assert.equal(result.thrown, null, `${owner}/${layout}: removal threw`);
      assert(result.focusedWasCell && result.recovered && result.removed && result.farRowRendered, JSON.stringify(result));
      assert(result.extraPasses <= 1, JSON.stringify(result));
      await page.keyboard.press("ArrowDown");
      const next = await page.evaluate(() => {
        const content=document.querySelector('.vlist-content');
        const row=document.getElementById(content.getAttribute('aria-activedescendant'));
        return row ? Number(row.dataset.index) : null;
      });
      assert.equal(next, result.from + (layout === "grid" || layout === "masonry" ? 3 : 1), `${owner}/${layout}: ArrowDown resumes the focused row`);
      for (const sameTask of [false, true]) {
        const control = await page.evaluate(async sameTask => {
          const content=document.querySelector('.vlist-content');
          const outside=document.querySelector('#outside');
          if (sameTask) content.querySelector('span[tabindex]').focus(); else outside.focus();
          window.scrollAway();
          if (sameTask) outside.focus();
          const synchronous=window.passes;
          await new Promise(requestAnimationFrame);
          return {outside:document.activeElement===outside,extraPasses:window.passes-synchronous};
        }, sameTask);
        assert(control.outside && control.extraPasses === 0, `${owner}/${layout}: no focus theft (${sameTask}): ${JSON.stringify(control)}`);
        await page.evaluate(() => window.list.scrollToIndex(0));
      }
      assert.equal(errors.length, 0, errors.join('\n'));
      console.log(`PASS ${owner}/${layout} ${JSON.stringify({...result,next})}; outside/same-task controls: 0 deferred passes`);
    } catch (error) { failures++; console.error(`FAIL ${owner}/${layout}: ${error.stack ?? error}`); }
    finally { await page.close(); }
  }
  // The original reported configuration leaves keyboard navigation to its caller.
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.stack ?? String(e)));
  try {
    await page.goto(`http://localhost:${server.port}/?layout=table&owner=a11y&keyboard=false`);
    await page.waitForFunction(() => window.ready);
    const recovered = await page.evaluate(async () => {
      document.querySelector('.vlist-content span').focus();
      window.list.scrollToIndex(49999, 'center');
      await new Promise(requestAnimationFrame);
      return document.activeElement===document.querySelector('.vlist-viewport');
    });
    assert(recovered && errors.length===0, errors.join('\n'));
    console.log('PASS original table + a11y({keyboard:false}): viewport focus, no pageerror');
  } catch (error) { failures++; console.error(error.stack ?? String(error)); }
  finally { await page.close(); }
  assert.equal(failures, 0, `${failures} focus-removal scenarios failed`);
  console.log('PASS focus-removal: all layouts, both owners, keyboard and no-theft controls');
} finally { await browser.close(); server.stop(); }
