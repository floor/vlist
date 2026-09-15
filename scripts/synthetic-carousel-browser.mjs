/** Build first. VLIST_BROWSER_DRIVER must export launchBrowser(). */
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
const {launchBrowser}=await import(resolve(process.env.VLIST_BROWSER_DRIVER));
const root=resolve(import.meta.dir,'../dist');
const html=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/vlist.css">
<style>body{margin:0}.vlist{border:0;border-radius:0}#list,#reference{width:400px;height:400px}#reference{position:absolute;left:-2000px;top:0}</style>
<div id="list"></div><div id="reference"></div><script type="module">
import {createVList as synthetic} from '/synthetic.js';import {createVList as native,carousel} from '/index.js';
const q=new URLSearchParams(location.search);window.isX=q.get('axis')==='horizontal';window.variant=q.get('variant');
window.step=variant==='full'?400:variant==='hero'?320:160;window.lap=step*10;
function make(id){let ctx;const list=(q.get('entry')==='native'?native:synthetic)({container:id,orientation:isX?'horizontal':'vertical',items:Array.from({length:10},(_,id)=>({id})),item:{height:200,width:200,template:item=>String(item.id)}},[carousel({variant,peek:'20%',snap:q.get('input')==='snap',snapDuration:180}),{name:'inspect',setup(c){ctx=c;}}]);return {list,ctx};}
window.main=make('#list');window.reference=make('#reference');
window.untilPosition=target=>new Promise((resolve,reject)=>{const start=performance.now();const check=()=>{if(Math.abs(main.list.getScrollPosition()-target)<0.001){requestAnimationFrame(resolve);return;}if(performance.now()-start>5000){reject(Error('animation did not reach '+target));return;}requestAnimationFrame(check);};check();});
function read(host){const vp=host.querySelector('.vlist-viewport'),vr=vp.getBoundingClientRect();return [...host.querySelectorAll('[data-index]')].filter(el=>getComputedStyle(el).display!=='none').map(el=>{const r=el.getBoundingClientRect();return {id:el.textContent,offset:isX?r.left-vr.left:r.top-vr.top,size:isX?r.width:r.height};}).sort((a,b)=>Number(a.id)-Number(b.id));}
window.begin=(gap)=>{main.ctx.scrollTo(90*lap-gap);window.startSampling();};
window.startSampling=()=>{window.trace=[];window.sample=()=>{const pos=main.list.getScrollPosition();reference.ctx.scrollTo(50*lap+((pos%lap)+lap)%lap);trace.push({pos,rows:read(document.querySelector('#list')),expected:read(document.querySelector('#reference')),native:main.ctx.dom.viewport[isX?'scrollLeft':'scrollTop']});window.frame=requestAnimationFrame(sample);};sample();};
window.finish=()=>{cancelAnimationFrame(frame);return trace;};window.ready=true;
</script>`;
const server=Bun.serve({port:0,fetch(req){const path=new URL(req.url).pathname;if(path==='/favicon.ico')return new Response(null,{status:404});return path==='/'?new Response(html,{headers:{'Content-Type':'text/html'}}):new Response(Bun.file(root+path));}});
const browser=await launchBrowser();const wait=ms=>new Promise(r=>setTimeout(r,ms));let largest=0,folds=0;
try {
 console.log(await browser.version());
 for(const axis of ['horizontal','vertical']) for(const variant of ['full','hero','multi']) for(const input of ['drag','fling','wheel','snap']) {
  const page=await browser.newPage();await page.setViewport({width:600,height:600,hasTouch:true});
  await page.goto(`http://localhost:${server.port}/?axis=${axis}&variant=${variant}&input=${input}`);await page.waitForFunction(()=>window.ready);
  const x=axis==='horizontal';await page.evaluate(gap=>window.begin(gap),input==='fling'?100:20);
  if(input==='wheel'){await page.mouse.move(200,200);await page.mouse.wheel({deltaX:x?40:0,deltaY:x?0:40});await wait(120);}
  else if(input==='snap'){await wait(450);} // Idle snap crosses the boundary from the seeded partial item.
  else {
   const cdp=await page.createCDPSession();await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
   const touch=async(type,d)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x:x?300-d:200,y:x?200:300-d,id:1,radiusX:3,radiusY:3}]});
   await touch('touchStart',0);await wait(20);
   for(const d of input==='drag'?[20,40,60,80]:[30,60]){await touch('touchMove',d);await wait(16);}
   if(input==='drag')await wait(120); // Release stale: no fling; the drag itself folds.
   await touch('touchEnd',0);await wait(input==='fling'?500:80);
  }
  const trace=await page.evaluate(()=>window.finish());let count=0,jump=0,error=0,moving=0;
  for(let i=0;i<trace.length;i++) {
   const current=trace[i];assert.equal(current.native,0);assert.equal(current.rows.length,current.expected.length);
   for(let j=0;j<current.rows.length;j++){const row=current.rows[j],ref=current.expected[j];assert.equal(row.id,ref.id);error=Math.max(error,Math.abs(row.offset-ref.offset),Math.abs(row.size-ref.size));}
   if(!i)continue;const prev=trace[i-1];if(current.pos!==prev.pos)moving++;
   if(current.pos<prev.pos-1000){count++;for(const row of current.rows){const old=prev.rows.find(r=>r.id===row.id);if(old)jump=Math.max(jump,Math.abs(row.offset-old.offset));}}
  }
  assert(moving>0,`${axis}/${variant}/${input} moves`);assert.equal(count,1,`${axis}/${variant}/${input} crosses one fold`);assert(error<=1,`rendered seam deviation ${error}px`);
  largest=Math.max(largest,jump);folds+=count;console.log('PASS',axis,variant,input,JSON.stringify({frames:trace.length,moving,folds:count,foldFrameDisplacement:jump,referenceDeviation:error}));await page.close();
 }

 for(const entry of ['native','synthetic']) for(const axis of ['horizontal','vertical']) for(const direction of [1,-1]) {
  const page=await browser.newPage();await page.setViewport({width:600,height:600});
  await page.goto(`http://localhost:${server.port}/?axis=${axis}&variant=full&entry=${entry}`);await page.waitForFunction(()=>window.ready);
  await page.evaluate(d=>{main.ctx.scrollTo((d>0?90:10)*lap-d*20);main.list[d>0?'next':'prev'](1,{behavior:'smooth',duration:180});},direction);
  await page.evaluate(({entry,d})=>untilPosition(entry==='native'?(d>0?360400:39600):200000+d*400),{entry,d:direction});
  const start=await page.evaluate(d=>{main.ctx.dom.viewport.dispatchEvent(new WheelEvent('wheel',{deltaX:isX?d:0,deltaY:isX?0:d,cancelable:true}));startSampling();const start=main.list.getScrollPosition();main.list[d>0?'next':'prev'](1,{behavior:'smooth',duration:180});return start;},direction);
  await page.evaluate(d=>untilPosition(200000+d*800),direction);const trace=await page.evaluate(()=>window.finish());const target=200000+direction*800;
  assert.equal(start,200000+direction*401);assert.equal(trace.at(-1).pos,target);
  assert(trace.every(f=>f.pos>=Math.min(start,target) && f.pos<=Math.max(start,target)),'repeated navigation stays within one item');
  for(const frame of trace)assert.deepEqual(frame.rows,frame.expected);
  console.log('PASS repeated navigation',entry,axis,direction>0?'next':'prev',JSON.stringify({frames:trace.length,start,target}));await page.close();
 }
 for(const axis of ['horizontal','vertical']) for(const variant of ['full','hero','multi']) {
  const page=await browser.newPage();const x=axis==='horizontal';await page.setViewport({width:600,height:600});
  await page.goto(`http://localhost:${server.port}/?axis=${axis}&variant=${variant}`);await page.waitForFunction(()=>window.ready);
  await page.evaluate(()=>{main.ctx.scrollTo(90*lap-step);main.ctx.dom.viewport.dispatchEvent(new WheelEvent('wheel',{deltaX:isX?4*step:0,deltaY:isX?0:4*step,cancelable:true}));});
  const read=()=>page.evaluate(()=>{const el=[...document.querySelectorAll('#list [data-index]')].find(el=>el.style.getPropertyValue('--vlist-carousel-offset')==='0');const r=el.getBoundingClientRect(),v=main.ctx.dom.viewport.getBoundingClientRect();return {size:isX?r.width:r.height,offset:isX?r.left-v.left:r.top-v.top,index:main.list.getCarouselState().index,pos:main.list.getCarouselState().scrollPosition};});
  const before=await read();assert.equal(before.index,3);
  await page.evaluate(()=>document.querySelector('#list').style[isX?'height':'width']='500px');await wait(100);assert.deepEqual(await read(),before);
  await page.evaluate(()=>document.querySelector('#list').style[isX?'width':'height']='800px');await wait(100);
  const after=await read();assert.equal(after.size,before.size*2);assert.equal(after.index,3);assert.equal(after.pos,before.pos*2);assert.equal(after.offset,0);
  await page.evaluate(()=>{main.list.scrollToIndex(9);main.list.next(1,{behavior:'auto'});});assert.equal((await read()).index,0);
  await page.evaluate(()=>main.list.prev(1,{behavior:'auto'}));assert.equal((await read()).index,9);
  console.log('PASS resize after fold',axis,variant,JSON.stringify({before,after}));await page.close();
 }
 console.log('SUMMARY',JSON.stringify({folds,largestFoldFrameDisplacement:largest}));
} finally {await browser.close();server.stop();}
