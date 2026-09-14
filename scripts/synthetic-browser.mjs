/** Chrome integration probes. Build first, then set VLIST_BROWSER_DRIVER to a
 * module exporting launchBrowser() (e.g. vlist.io/scripts/debug/core.mjs). */
import assert from "node:assert/strict";
import { resolve } from "node:path";
const driver = process.env.VLIST_BROWSER_DRIVER;
if (!driver) throw new Error("Set VLIST_BROWSER_DRIVER to the Chrome launchBrowser module");
const { launchBrowser } = await import(resolve(driver));
const root = resolve(import.meta.dir, "..");
const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/vlist.css"><link rel="stylesheet" href="/vlist-table.css">
<style>body{margin:20px}#list{width:360px;height:360px}a,button,input{margin:5px}</style>
<div id="list"></div><div id="tail">Tail</div>
<script type="module">
import {createVList} from '/synthetic.js';
import {table,groups,a11y,selection,scrollbar,snapshots,autosize,transition} from '/index.js';
const q=new URLSearchParams(location.search), axis=q.get('axis')||'y', plugin=q.get('plugin');
const items=Array.from({length:10000},(_,id)=>({id,name:'Row '+id}));
const template=item=>'<span>'+item.name+'</span><a href="#tail">Test link</a><input type="button" value="Button">';
const plugins=plugin==='table'?[table({rowHeight:50,columns:[{key:'name',label:'Name',width:400,cell:template},{key:'id',label:'ID',width:400}]})]:
 plugin==='groups'?[groups({getGroupForIndex:i=>String(Math.floor(i/10)),headerHeight:30,headerTemplate:g=>g})]:
 plugin==='autosize'?[autosize()]:plugin==='transition'?[transition()]:plugin==='a11y'?[a11y()]:plugin==='selection'?[selection()]:plugin==='snapshots'?[snapshots(),scrollbar()]:[];
window.list=createVList({container:'#list',orientation:axis==='x'?'horizontal':'vertical',items,item:plugin==='autosize'?{estimatedHeight:50,template:item=>'<div style="height:50px">'+template(item)+'</div>'}:{height:50,width:180,template},scroll:{mode:'synthetic'}},plugins);
window.clicks=0;document.querySelector('.vlist-content').addEventListener('click',()=>window.clicks++);
window.ready=true;
</script>`;
const server = Bun.serve({ port: 0, fetch(req) {
  const path = new URL(req.url).pathname;
  if (path === "/") return new Response(html, { headers: { "Content-Type": "text/html" } });
  if (["/synthetic.js", "/index.js", "/vlist.css", "/vlist-table.css"].includes(path)) return new Response(Bun.file(`${root}/dist${path}`));
  return new Response("Not found", { status: 404 });
} });
const browser = await launchBrowser();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const errors = [];
try {
  console.log(await browser.version());
  const rtlPage = await browser.newPage();
  await rtlPage.goto(`http://localhost:${server.port}/`);
  await rtlPage.waitForFunction(() => window.ready);
  const rtl = await rtlPage.evaluate(async () => {
    const {createVList} = await import('/synthetic.js');
    const parent = document.createElement('div'); parent.style.direction = 'rtl'; document.body.append(parent);
    const container = document.createElement('div'); container.id = 'rtl-probe'; container.style.cssText = 'width:300px;height:300px'; parent.append(container);
    const results = { direction: getComputedStyle(container).direction, rejected: [], allowed: [] };
    try {
      for (const target of [container, '#rtl-probe']) {
        try { const list=createVList({container:target,orientation:'horizontal',items:[{id:1}],item:{width:50,template:()=>''},scroll:{mode:'synthetic'}});list.destroy();results.rejected.push(false); }
        catch(error) { results.rejected.push(error.message.includes('RTL horizontal lists') && container.children.length===0); }
      }
      for(const [mode,orientation] of [['synthetic','vertical'],['native','horizontal'],['bounded','horizontal']]) {
        const list=createVList({container,orientation,items:[{id:1}],item:{height:50,width:50,template:()=>''},scroll:{mode}});
        results.allowed.push(mode);list.destroy();
      }
      return results;
    } finally { parent.remove(); }
  });
  assert.deepEqual(rtl,{direction:'rtl',rejected:[true,true],allowed:['synthetic','native','bounded']});
  console.log('PASS inherited RTL: horizontal synthetic rejects before DOM creation; vertical/native/bounded allowed');
  await rtlPage.close();
  for (const axis of ["y", "x"]) for (const plugin of (axis === "y" ? ["", "table", "groups", "a11y", "selection", "snapshots", "autosize", "transition"] : [""])) {
    const page = await browser.newPage();
    page.on("pageerror", e => errors.push(String(e)));
    await page.setViewport({ width: 430, height: 932, hasTouch: true, isMobile: true });
    await page.goto(`http://localhost:${server.port}/?axis=${axis}&plugin=${plugin}`);
    await page.waitForFunction(() => window.ready);
    const cdp = await page.createCDPSession();
    const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
    const read = () => page.evaluate(() => window.list.getScrollPosition());
    await page.evaluate(() => window.list.scrollToIndex(500, "start"));
    const focus = await page.evaluate(axis => {
      const viewport = document.querySelector('.vlist-viewport'), stage = document.querySelector('.vlist-content');
      const r=viewport.getBoundingClientRect();
      const link=[...stage.querySelectorAll('a')].find(a=>axis==='y'?a.getBoundingClientRect().top>r.bottom:a.getBoundingClientRect().left>r.right);
      if(!link)throw new Error('No off-viewport link');
      // Shrink synchronously, before ResizeObserver can update logical extent.
      viewport.style[axis==='y'?'height':'width']=(axis==='y'?viewport.clientHeight-40:viewport.clientWidth-40)+'px';
      link.focus();
      return { overflow:getComputedStyle(stage).overflow, stage:axis==='y'?stage.scrollTop:stage.scrollLeft, viewport:axis==='y'?viewport.scrollTop:viewport.scrollLeft };
    },axis);
    assert.deepEqual(focus,{overflow:'clip',stage:0,viewport:0},`${axis}/${plugin}: focus clipping`);
    await page.evaluate(()=>{document.activeElement.blur();window.list.scrollToIndex(0)});
    const point=await page.evaluate(()=>{
      const v=document.querySelector('.vlist-viewport').getBoundingClientRect();
      const link=[...document.querySelectorAll('.vlist-content a')].find(a=>{const r=a.getBoundingClientRect();return r.top>v.top+65&&r.bottom<v.bottom&&r.left>v.left&&r.right<v.right});
      if(!link)throw new Error('No visible link');const r=link.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,id:1};
    });
    const start=await read();
    await touch('touchStart',[point]);
    for(let step=1;step<=5;step++){
      await touch('touchMove',[{...point,x:point.x-(axis==='x'?step*10:0),y:point.y-(axis==='y'?step*10:0)}]);await wait(16);
    }
    await touch('touchEnd',[]);await wait(80);
    assert((await read())>start,`${axis}/${plugin}: real link drag`);
    assert.equal(await page.evaluate(()=>window.clicks),0);
    assert(!page.url().includes('#tail'));
    // Cancel through the existing API and verify the exact final row.
    await page.evaluate(()=>window.list.scrollToIndex(9999,'end'));
    const end=await page.evaluate(axis=>{
      const v=document.querySelector('.vlist-viewport'),s=document.querySelector('.vlist-content');
      const last=s.querySelector('[data-index="9999"]');
      const r=last?.getBoundingClientRect(),box=v.getBoundingClientRect();
      return {main:axis==='y'?v.scrollTop:v.scrollLeft,extent:axis==='y'?v.scrollHeight:v.scrollWidth,size:axis==='y'?v.clientHeight:v.clientWidth,covered:!!r&&(axis==='y'?Math.abs(r.bottom-box.bottom)<2:Math.abs(r.right-box.right)<2)};
    },axis);
    assert.equal(end.main,0);assert.equal(end.extent,end.size);
    if(plugin!=='groups')assert(end.covered,`${axis}/${plugin}: exact final item geometry`);
    if(plugin==='transition'){
      const animations = await page.evaluate(()=>{
        window.list.scrollToIndex(500);
        window.list.insertItem({id:10001,name:'Inserted'},502);
        return [...document.querySelectorAll('.vlist-content [data-index]')].flatMap(el=>el.getAnimations().map(a=>({
          last:a.effect.getKeyframes().slice(-1)[0].transform, expected:el.style.transform
        }))).filter(a=>!a.last.includes('scale'));
      });
      assert(animations.length>0,'transition creates sibling animations');
      for(const a of animations)assert.equal(a.last,a.expected,'transition ends at stage-relative row coordinate');
      await wait(260);
    }
    if(plugin==='table'){
      await page.evaluate(()=>{const v=document.querySelector('.vlist-viewport');v.dispatchEvent(new WheelEvent('wheel',{deltaX:30,deltaY:-60,bubbles:true,cancelable:true}));});await wait(50);
      const cross = await page.$eval('.vlist-viewport',el=>el.scrollLeft);
      assert(cross>0,'table diagonal wheel preserves cross component');
      assert.equal(await page.$eval('.vlist-table-header-scroll',el=>el.style.transform),`translateX(${-cross}px)`,'table header sync');
      const logical = await read();
      const origin = await page.$eval('.vlist-viewport',el=>{const r=el.getBoundingClientRect();return{x:r.x+260,y:r.y+180,id:3}});
      await touch('touchStart',[origin]);
      for(let step=1;step<=6;step++) { await touch('touchMove',[{...origin,x:origin.x-step*10}]);await wait(16); }
      await touch('touchEnd',[]);await wait(100);
      assert.equal(await read(),logical,'table cross-axis touch does not move the logical axis');
      // Read both values in one turn: native momentum can advance between CDP calls.
      const after = await page.evaluate(() => ({
        offset: document.querySelector('.vlist-viewport').scrollLeft,
        transform: document.querySelector('.vlist-table-header-scroll').style.transform,
      }));
      assert(after.offset>cross,'table real native cross-axis touch');
      assert.equal(after.transform,`translateX(${-after.offset}px)`,'table header follows native touch');
    }
    console.log(`PASS ${axis}/${plugin||'base'}: focus clipping, real link drag, logical navigation, viewport extent`);
    await page.close();
  }
  assert.deepEqual(errors,[]);
} finally { await browser.close();server.stop(true); }
