/** Build first. Uses scripts/browser-driver.mjs; VLIST_BROWSER_DRIVER overrides
 * it with another module exporting launchBrowser. */
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
const {launchBrowser}=await import(resolve(process.env.VLIST_BROWSER_DRIVER??resolve(import.meta.dir,'browser-driver.mjs')));
const root=resolve(import.meta.dir,'../dist');
const html=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/vlist.css"><style>body{margin:0}#list{width:400px;height:400px}.handle{display:inline-block;padding:16px}.vlist-item{background:#ddd}</style><div id="list"></div><script type="module">
import {createVList as native,sortable} from '/index.js';import {createVList as synthetic} from '/synthetic.js';
const q=new URLSearchParams(location.search);window.isX=q.get('axis')==='horizontal';window.hasHandle=q.get('handle')==='1';
window.list=(q.get('entry')==='native'?native:synthetic)({container:'#list',orientation:isX?'horizontal':'vertical',items:Array.from({length:200},(_,id)=>({id})),item:{width:100,height:100,template:i=>'<span class="handle">Grip</span><span class="body">Item '+i.id+'</span>'}},[sortable(hasHandle?{handle:'.handle'}:{})]);
window.events=[];window.dropIndex=12;window.minShift=12;window.maxShift=12;for(const name of ['sort:start','sort:move','sort:end','sort:cancel'])list.on(name,e=>{events.push({name,...e});if(name==='sort:move'){dropIndex=e.currentIndex;minShift=Math.min(minShift,dropIndex);maxShift=Math.max(maxShift,dropIndex);}});
window.pointers=[];document.addEventListener("pointermove",e=>pointers.push({x:e.clientX,y:e.clientY,target:e.target.tagName}),true);window.cancels=0;document.addEventListener('pointercancel',()=>cancels++,true);window.clicks=0;document.querySelector('#list').addEventListener('click',()=>clicks++);
list.scrollToIndex(10);
window.trace=[];window.sample=()=>{const vp=document.querySelector('.vlist-viewport'),vr=vp.getBoundingClientRect(),pos=list.getScrollPosition(),sorting=list.isSorting();let error=0,count=0;
for(const el of document.querySelectorAll('#list [data-index]')){const i=Number(el.dataset.index);if(i===12 || !sorting)continue;const r=el.getBoundingClientRect();let shift=0;if(dropIndex>12 && i>12 && i<=dropIndex)shift=-100;if(dropIndex<12 && i>=dropIndex && i<12)shift=100;
// During CSS shift interpolation only the unaffected rows give a strict anchor.
if(i>=minShift && i<=maxShift)continue;count++;error=Math.max(error,Math.abs((isX?r.left-vr.left:r.top-vr.top)-(i*100-pos)));}
trace.push({pos,sorting,error,count,native:vp[isX?'scrollLeft':'scrollTop']});window.frame=requestAnimationFrame(sample);};sample();window.ready=true;
</script>`;
const server=Bun.serve({port:0,fetch(req){const path=new URL(req.url).pathname;if(path==='/favicon.ico')return new Response(null,{status:404});return path==='/'?new Response(html,{headers:{'Content-Type':'text/html'}}):new Response(Bun.file(root+path));}});
const browser=await launchBrowser();const wait=ms=>new Promise(r=>setTimeout(r,ms));let passes=0;
async function open(entry,axis,handle){const page=await browser.newPage();await page.setViewport({width:600,height:600,hasTouch:true});await page.goto(`http://localhost:${server.port}/?entry=${entry}&axis=${axis}&handle=${+handle}`);await page.waitForFunction(()=>window.ready);await wait(220);const cdp=await page.createCDPSession();await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});return {page,cdp};}
async function point(page,outside=false){return page.$eval(`[data-index="12"] .${outside?'body':'handle'}`,el=>{const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});}
async function result(page){return page.evaluate(()=>({position:list.getScrollPosition(),sorting:list.isSorting(),events:events.map(e=>({name:e.name,index:e.index,fromIndex:e.fromIndex,toIndex:e.toIndex})),cancels,trace:[...trace],clicks,pointers:[...pointers]}));}
try{
 console.log(await browser.version());
 for(const entry of ['native','synthetic'])for(const axis of ['vertical','horizontal'])for(const handle of [false,true])for(const input of ['touch','mouse'])for(const edge of [false,true]){
  const {page,cdp}=await open(entry,axis,handle);const start=await point(page);const x=axis==='horizontal';
  const touch=(type,p)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{id:1,x:p.x,y:p.y,radiusX:3,radiusY:3}]});
  if(input==='touch'){await touch('touchStart',start);if(!handle)await wait(380);}else{await page.mouse.move(start.x,start.y);await page.mouse.down();}
  const dest={x:x?(edge?430:340):start.x,y:x?start.y:(edge?430:340)};
  for(let step=1;step<=6;step++){const p={x:start.x+(dest.x-start.x)*step/6,y:start.y+(dest.y-start.y)*step/6};if(input==='touch')await touch('touchMove',p);else await page.mouse.move(p.x,p.y);await wait(20);}
  await wait(edge?180:40);const during=await result(page);assert.equal(during.events.filter(e=>e.name==='sort:start').length,1);assert.equal(during.cancels,0);
  if(edge)assert(during.position>1000,`${entry}/${axis}/${input} edge scroll advances`);else assert.equal(during.position,1000);
  const claimed=during.trace.filter(f=>f.sorting);assert(claimed.length>0);assert(claimed.every(f=>f.count>0),'each claimed frame has rendered anchors');assert(claimed.every(f=>f.error<=1),'rendered anchor matches logical position');if(!edge)assert(claimed.every(f=>f.pos===1000),'claimed drag does not scroll list');if(entry==='synthetic')assert(claimed.every(f=>f.native===0));
  if(edge){for(const main of [300]){const p={x:x?main:start.x,y:x?start.y:main};if(input==='touch')await touch('touchMove',p);else await page.mouse.move(p.x,p.y);await wait(40);}}
  if(input==='touch')await touch('touchEnd',dest);else await page.mouse.up();await wait(300);const after=await result(page);assert.equal(after.sorting,false);assert.equal(after.events.filter(e=>e.name==='sort:end').length,1,JSON.stringify({position:after.position,events:after.events,cancels:after.cancels,pointers:after.pointers}));assert.equal(after.events.filter(e=>e.name==='sort:cancel').length,0);await wait(200);assert.equal((await result(page)).position,after.position,'no fling after drop');
  if(input==='touch'){
   const tap=await page.evaluate(()=>{const i=Math.floor(list.getScrollPosition()/100)+1;const el=document.querySelector('[data-index="'+i+'"] .handle');const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});
   const clicks=(await result(page)).clicks;await touch('touchStart',tap);await touch('touchEnd',tap);await wait(40);assert.equal((await result(page)).clicks,clicks+1,'plain tap after drop is not swallowed');
  }
  console.log('PASS drag',entry,axis,handle?'handle':'free',input,edge?'edge':'inside',JSON.stringify({position:after.position,frames:claimed.length,maxAnchorError:Math.max(...claimed.map(f=>f.error)),events:after.events}));passes++;await page.close();
 }
 for(const entry of ['native','synthetic'])for(const axis of ['vertical','horizontal'])for(const handle of [false,true]){
  const {page,cdp}=await open(entry,axis,handle);const start=await point(page,handle);const x=axis==='horizontal';
  const touch=(type,d)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{id:1,x:start.x-(x?d:0),y:start.y-(x?0:d),radiusX:3,radiusY:3}]});
  await touch('touchStart',0);for(const d of [15,35,60,90]){await touch('touchMove',d);await wait(20);}await touch('touchEnd',90);await wait(400);const after=await result(page);assert.equal(after.events.length,0);assert(after.position>1000);
  console.log('PASS quick flick',entry,axis,handle?'outside handle':'free',after.position);passes++;await page.close();
 }
 for(const entry of ['native','synthetic'])for(const axis of ['vertical','horizontal'])for(const handle of [false,true]){
  const {page,cdp}=await open(entry,axis,handle);const start=await point(page);const x=axis==='horizontal';
  const touch=(type,d)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{id:1,x:start.x+(x?0:d),y:start.y+(x?d:0),radiusX:3,radiusY:3}]});
  await touch('touchStart',0);if(!handle)await wait(380);for(const d of [10,30,60,90]){await touch('touchMove',d);await wait(20);}await touch('touchEnd',90);await wait(300);const after=await result(page);assert.equal(after.events.filter(e=>e.name==='sort:start').length,1);assert.equal(after.cancels,0);assert.equal(after.position,1000);
  console.log('PASS cross-axis claim',entry,axis,handle?'handle':'free');passes++;await page.close();
 }
 for(const entry of ['native','synthetic'])for(const axis of ['vertical','horizontal']){
  const {page,cdp}=await open(entry,axis,false);const start=await point(page);const first={id:1,x:start.x,y:start.y,radiusX:3,radiusY:3},second={id:2,x:start.x+50,y:start.y+30,radiusX:3,radiusY:3};
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[first]});await wait(380);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[first,second]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[first]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait(300);
  const cancelled=await result(page);assert.equal(cancelled.events.filter(e=>e.name==='sort:start').length,1);assert.equal(cancelled.events.filter(e=>e.name==='sort:cancel').length,1);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[first]});await wait(380);
  const moved={...first,x:first.x+(axis==='horizontal'?70:0),y:first.y+(axis==='vertical'?70:0)};
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[moved]});await wait(40);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait(300);
  const recovered=await result(page);assert.equal(recovered.events.filter(e=>e.name==='sort:start').length,2);assert.equal(recovered.events.filter(e=>e.name==='sort:end').length,1);
  console.log('PASS multitouch recovery',entry,axis);passes++;await page.close();
 }
 console.log('SUMMARY',JSON.stringify({passes}));
}finally{await browser.close();server.stop();}
