/** RTL cross-axis browser gate. Build first. Set VLIST_BROWSER_DRIVER to a module
 * exporting launchBrowser() for Chrome/Firefox, or use --serve for Safari WebDriver.
 * --serve prints the URL; call window.probe() after window.ready on each
 * ?dir=ltr|rtl&table=true|false page and compare cell/header positions and offsets.
 */
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pinPage} from './browser-page.mjs';
const root=resolve(import.meta.dir,'..');
const html=`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/vlist.css"><link rel="stylesheet" href="/vlist-table.css"><style>body{margin:30px}#host{width:360px;height:400px} .wide{width:800px}</style><div id="host"></div>
<script type="module">
const base='';
const {createVList}=await import(base+'/synthetic.js');const {table}=await import(base+'/index.js');
const q=new URLSearchParams(location.search),host=document.querySelector('#host');host.dir=q.get('dir')||'rtl';
const isTable=q.get('table')!=='false';
window.testList=createVList({container:host,items:Array.from({length:100},(_,id)=>({id,a:'A '+id,b:'B '+id,c:'C '+id})),item:{height:40,template:i=>'<div class="wide">'+i.a+'</div>'}},isTable?[table({rowHeight:40,columns:[{key:'a',label:'A',width:200},{key:'b',label:'B',width:250},{key:'c',label:'C',width:300}]})]:[]);
if(!isTable)document.querySelector('.vlist-content').style.width='800px';
window.sample=()=>{
 const v=document.querySelector('.vlist-viewport'),h=[...document.querySelectorAll('.vlist-table-header-cell')],b=[...document.querySelectorAll('.vlist-table-row')][0]?.querySelectorAll('.vlist-table-cell')||[];
 return {raw:v.scrollLeft,max:v.scrollWidth-v.clientWidth,logical:window.testList.getScrollPosition(),nativeY:v.scrollTop,dir:getComputedStyle(v).direction,headerTransform:document.querySelector('.vlist-table-header-scroll')?.style.transform,
 headers:h.map(c=>({text:c.textContent,left:c.getBoundingClientRect().left,right:c.getBoundingClientRect().right})),cells:[...b].map(c=>({text:c.textContent,left:c.getBoundingClientRect().left,right:c.getBoundingClientRect().right}))};
};
window.probe=async()=>{
 // Two frames, not 100ms. The header follows the body from the viewport's scroll
 // event, which the next frame dispatches; until then the cells have moved and
 // the header has not, by exactly the scroll delta. A timer can fire first on a
 // busy machine. Frame one lets a handler that defers to rAF write scrollLeft,
 // frame two dispatches that scroll before this callback runs.
 const frame=()=>new Promise(r=>requestAnimationFrame(()=>r()));const pause=async()=>{await frame();await frame();};const v=document.querySelector('.vlist-viewport'),results={};
 // scrollWidth can still be the client width on the first frames of a busy
 // machine. A zero here is unread layout, not a fixture without overflow.
 const start=performance.now();let initial;
 do { await frame(); initial=sample(); } while(initial.max<=0 && performance.now()-start<2000);
 if(initial.max<=0) throw new Error('cross-axis overflow did not settle');
 results.initial=initial;
 v.scrollLeft=-100;await pause();results.negative=sample();v.scrollLeft=100;await pause();results.positive=sample();v.scrollLeft=0;await pause();
 for(const key of ['ArrowLeft','ArrowLeft','ArrowRight','ArrowRight']){v.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));await pause();results[key+'-'+Object.keys(results).length]=sample();}
 v.scrollLeft=0;window.testList.scrollToIndex(0);await pause();v.dispatchEvent(new WheelEvent('wheel',{deltaX:host.dir==='rtl'?-40:40,deltaY:80,bubbles:true,cancelable:true}));await pause();results.diagonal=sample();return results;
};window.ready=true;
</script>
`;
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){
 const path=new URL(req.url).pathname;
 if(path==='/')return new Response(html,{headers:{'Content-Type':'text/html'}});
 if(['/synthetic.js','/index.js','/vlist.css','/vlist-table.css'].includes(path))return new Response(Bun.file(root+'/dist'+path));
 return new Response('',{status:404});
}});
console.log('RTL fixture: '+server.url.href);
if(!process.argv.includes('--serve')) {
 let browser;
 try {
  const driver=process.env.VLIST_BROWSER_DRIVER??resolve(import.meta.dir,'browser-driver.mjs');
  browser=await (await import(resolve(driver))).launchBrowser();console.log(await browser.version());
  for(const dir of ['ltr','rtl'])for(const table of [true,false]) {
   const page=await browser.newPage();await pinPage(page,{width:800,height:600});await page.goto(`${server.url}?dir=${dir}&table=${table}`);await page.waitForFunction(()=>window.ready);
   const result=await page.evaluate(()=>window.probe());
   const max=result.initial.max;assert(max>0,'fixture must have cross-axis overflow');
   for(const sample of Object.values(result)) {
    assert.equal(sample.nativeY,0);
    for(let i=0;i<sample.headers.length;i++)assert(Math.abs(sample.headers[i].left-sample.cells[i].left)<1,`${dir}: header column ${i} must align with body`);
   }
   assert.equal(result.negative.raw,dir==='rtl'?-100:0);assert.equal(result.positive.raw,dir==='rtl'?0:100);
   if(table) {
    const expected=dir==='rtl'?[200-max,-max,200-max,0]:[0,0,200,max];
    const keys=Object.keys(result).filter(key=>key.startsWith('Arrow'));
    keys.forEach((key,i)=>assert(Math.abs(result[key].raw-expected[i])<1,`${dir}: ${key}`));
   }
   assert.equal(result.diagonal.raw,dir==='rtl'?-40:40);assert.equal(result.diagonal.logical,80);
   console.log(`PASS ${dir}/${table?'table':'list'}: header geometry, keyboard edges, diagonal wheel, native Y=0`);
   await page.close();
  }
 } finally {await browser?.close();server.stop(true);}
}
