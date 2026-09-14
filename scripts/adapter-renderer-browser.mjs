/** Renderer adapter browser gate. Build vlist first, then run with:
 * VLIST_SCRATCH_BENCH=/path/to/scratchpad/vlist-pr130/bench.html
 * VLIST_IO_DIR=/path/to/vlist.io-synthetic bun scripts/adapter-renderer-browser.mjs
 * Uses the review's scratchpad fixture and vlist.io's pointer-fling engine.
 */
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
const fixture=process.env.VLIST_SCRATCH_BENCH;
if(!fixture)throw new Error('Set VLIST_SCRATCH_BENCH to the review scratchpad bench.html');
const root=resolve(import.meta.dir,'..');
const site=resolve(process.env.VLIST_IO_DIR||root+'/../vlist.io-synthetic');
const {launchBrowser}=await import(site+'/scripts/debug/core.mjs');
const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
 const p=new URL(req.url).pathname;
 const path=p==='/'||p==='/bench'?fixture:p.startsWith('/dist/')?root+p:p.startsWith('/benchmarks/')?site+p:null;
 if(!path)return new Response('not found',{status:404});
 const file=Bun.file(path);return await file.exists()?new Response(file):new Response('not found',{status:404});
}});
const url=server.url.href;
let browser;
const output=[];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try {
 browser=await launchBrowser();
 console.log(await browser.version());
 for(const mode of ['bounded','synthetic'])for(const layout of ['list','grid','table','masonry']) {
  const page=await browser.newPage();await page.setViewport({width:430,height:932,hasTouch:true,isMobile:true});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(`${url}bench?mode=${mode}&layout=${layout}&n=1000000`);await page.waitForFunction(()=>window.__bench?.ready);
  await page.evaluate(()=>window.__bench.list.scrollToIndex(50000));await wait(200);
  const cdp=await page.createCDPSession();
  await page.evaluate(layout=>{
   const stride=layout==='grid'?128:layout==='masonry'?98:52,columns=layout==='grid'?4:layout==='masonry'?3:1;
   const sample=()=>{
    const row=document.querySelector('.vlist-content [data-index]');
    return {pos:window.__bench.position(),origin:row.getBoundingClientRect().top-Math.floor(Number(row.dataset.index)/columns)*stride};
   };
   let previous=sample();window.motion={logical:0,dom:0,missed:[]};window.recording=true;
   const tick=()=>{if(!window.recording)return;const s=sample(),d=s.pos-previous.pos,dy=s.origin-previous.origin;
    if(Math.abs(d)>1){window.motion.logical++;if(Math.abs(d+dy)<=1.1)window.motion.dom++;else window.motion.missed.push({d,dy});}
    previous=s;requestAnimationFrame(tick);
   };requestAnimationFrame(tick);
  },layout);
  for(let i=0;i<40;i++){await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:180,y:300,deltaX:0,deltaY:7});await wait(18);}
  await wait(150);const wheel=await page.evaluate(()=>{window.recording=false;return window.motion;});
  assert(wheel.logical>0);assert.equal(wheel.dom,wheel.logical,JSON.stringify({mode,layout,wheel}));assert.deepEqual(errors,[]);
  console.log('WHEEL',mode,layout,JSON.stringify(wheel));output.push({mode,layout,wheel});
  // Run the original scratchpad trusted-touch scenario on the three layouts.
  if(layout!=='list') {
   await page.evaluate(()=>window.__bench.start());
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:100,y:500,id:1}]});
   for(let s=1;s<=8;s++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:100,y:500-s*40,id:1}]});await wait(8);}
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait(1500);
   const fling=await page.evaluate(()=>window.__bench.stop());console.log('SCRATCHPAD',mode,layout,JSON.stringify(fling));output.push({mode,layout,fling});
  }
  if(mode==='synthetic'&&layout==='list') {
   const fling=await page.evaluate(async()=>{
    const {measurePointerFlingRun}=await import('/benchmarks/engine/scroll.js');
    const options={viewport:document.querySelector('.vlist-viewport'),content:document.querySelector('.vlist-content'),getPosition:()=>window.__bench.position(),itemHeight:52};
    await measurePointerFlingRun({...options,durationMs:1});
    const r=await measurePointerFlingRun({...options,durationMs:5000});return {logicalMovingFrames:r.logicalMovingFrames,domMovingFrames:r.domMovingFrames,frames:r.frameTimes.length,inertiaFrames:r.inertiaFrames,flings:r.distances.length};
   });assert(fling.logicalMovingFrames>0);assert.equal(fling.domMovingFrames,fling.logicalMovingFrames);console.log('POINTER_FLING',JSON.stringify(fling));output.push({fling});
  }
  await page.close();
 }
 if(process.env.VLIST_BROWSER_REPORT)await Bun.write(process.env.VLIST_BROWSER_REPORT,JSON.stringify(output,null,2));
}finally{await browser?.close();server.stop(true);}
