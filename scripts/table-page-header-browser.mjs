/** Table page() header gate. Build first. Uses scripts/browser-driver.mjs;
 * VLIST_BROWSER_DRIVER overrides it with another module exporting launchBrowser.
 *
 * With page(), an unpinned table wider than its container makes the document
 * the horizontal scrollport: the body rows extend to the full column width,
 * while the header used to stay as wide as the root container. Scrolling the
 * window then showed body columns past the container's edge with no header
 * above them. This gate measures real layout in a real browser: a 1400 px
 * table in an 800 px container, the window scrolled 220 px, in both directions.
 * It checks that every header cell sits over its body column, that the header
 * rowgroup covers every body column, and that elementFromPoint over each
 * visible body column lands inside that column's header cell.
 *
 * It also checks the unpin edge: with a pinned column, a scrolled page table
 * moves the scroll into the viewport; unpinning the last column moves it back
 * to the window. The header must follow, with no stale translateX left behind.
 */
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pinPage, settle} from './browser-page.mjs';
const root=resolve(import.meta.dir,'../dist');
const html=`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/vlist.css"><link rel="stylesheet" href="/vlist-table.css"><style>html,body{margin:0}#host{width:800px}</style><div id="host"></div>
<script type="module">
import {createVList,page,table,columnPin} from '/index.js';
const q=new URLSearchParams(location.search);
document.documentElement.dir=q.get('dir')==='rtl'?'rtl':'ltr';
const wide=[{key:'name',label:'Name',width:400},{key:'a',label:'A',width:400},{key:'b',label:'B',width:300},{key:'c',label:'C',width:300}];
const narrow=[{key:'name',label:'Name',width:300},{key:'a',label:'A',width:300}];
const columns=q.get('narrow')==='1'?narrow:wide;
const items=Array.from({length:80},(_,id)=>({id,name:'Name '+id,a:'A '+id,b:'B '+id,c:'C '+id}));
const features=q.get('pin')==='1'?[columnPin({pins:{name:'left'}})]:[];
const list=createVList({container:'#host',items,item:{height:40,template:i=>'<span>'+i.name+'</span>'}},[table({rowHeight:40,columns,features,...(q.get('narrow')==='1'?{fillWidth:false}:{})}),page()]);
window.list=list;
const box=el=>{const r=el.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
window.probe=()=>{
 const header=document.querySelector('.vlist-table-header');
 const scroll=document.querySelector('.vlist-table-header-scroll');
 const cells=[...document.querySelectorAll('.vlist-table-header-cell')];
 const row=document.querySelector('.vlist-table-row');
 return {
  dir:getComputedStyle(document.documentElement).direction,
  scrollX:window.scrollX,
  innerWidth:window.innerWidth,
  pageMode:!!document.querySelector('.vlist--page'),
  pinned:!!document.querySelector('.vlist--table-pinned'),
  viewportScrollLeft:document.querySelector('.vlist-viewport').scrollLeft,
  rootClientWidth:document.querySelector('.vlist-viewport').parentElement.clientWidth,
  transform:scroll?scroll.style.transform:'',
  header:box(header),
  group:box(header.parentElement),
  headerScroll:box(scroll),
  cells:cells.map(c=>({key:c.dataset.columnKey,...box(c)})),
  bodies:row?[...row.querySelectorAll('.vlist-table-cell')].map(c=>box(c)):[],
 };
};
window.hit=(x,y)=>{const el=document.elementFromPoint(x,y);const cell=el&&el.closest?el.closest('.vlist-table-header-cell'):null;return{tag:el?el.tagName:null,key:cell?cell.dataset.columnKey:null};};
window.scrollWindow=x=>window.scrollTo(x,0);
window.scrollViewport=x=>{document.querySelector('.vlist-viewport').scrollLeft=x;};
window.ready=true;
</script>`;
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){
 const path=new URL(req.url).pathname;
 if(path==='/')return new Response(html,{headers:{'Content-Type':'text/html'}});
 if(['/index.js','/vlist.css','/vlist-table.css'].includes(path))return new Response(Bun.file(root+path));
 return new Response('',{status:404});
}});
const near=(a,b)=>Math.abs(a-b)<=1;
const transformX=value=>{const match=/translateX\((-?[\d.]+)px\)/.exec(value);return match?Number(match[1]):0;};
let browser;
try {
 const driver=process.env.VLIST_BROWSER_DRIVER??resolve(import.meta.dir,'browser-driver.mjs');
 browser=await (await import(resolve(driver))).launchBrowser();console.log(await browser.version());
 const open=async query=>{
  const page=await browser.newPage();
  await pinPage(page,{width:800,height:600});
  await page.goto(server.url.href+'?'+query);
  await page.waitForFunction(()=>window.ready);
  await settle(page);
  return page;
 };

 // A wide unpinned page table: the document scrolls, the header must follow.
 for(const dir of ['ltr','rtl']){
  const page=await open('dir='+dir);
  const wanted=dir==='rtl'?-220:220;
  await page.evaluate(x=>window.scrollWindow(x),wanted);
  await settle(page);
  const probe=await page.evaluate(()=>window.probe());
  assert.equal(probe.pageMode,true,`${dir}: page() mode is mounted`);
  assert.equal(probe.pinned,false,`${dir}: the fixture has no pinned column`);
  assert(near(probe.scrollX,wanted),`${dir}: the fixture scrolls the document horizontally: window.scrollX is ${probe.scrollX}, wanted ${wanted}`);
  assert.equal(probe.cells.length,4,`${dir}: all 4 header cells are built, got ${probe.cells.length}`);
  assert.equal(probe.bodies.length,4,`${dir}: all 4 body columns are rendered, got ${probe.bodies.length}`);
  probe.cells.forEach((cell,i)=>assert(near(cell.left,probe.bodies[i].left),`${dir}: header cell ${i} (${cell.key}) must sit over its body column: header left ${cell.left}, body left ${probe.bodies[i].left}`));
  const bodyLeft=Math.min(...probe.bodies.map(b=>b.left));
  const bodyRight=Math.max(...probe.bodies.map(b=>b.right));
  assert(probe.group.left<=bodyLeft+1,`${dir}: the header spans the table: header rowgroup left ${probe.group.left} is right of the first body column left ${bodyLeft}`);
  assert(probe.group.right>=bodyRight-1,`${dir}: the header spans the table: header rowgroup right ${probe.group.right} ends before the last body column right ${bodyRight}`);
  const samples=[];
  const maxX=probe.innerWidth-2;
  probe.bodies.forEach((b,i)=>{
   const left=Math.max(0,b.left),right=Math.min(maxX,b.right);
   if(right-left<4)return;
   for(const t of [0.25,0.5,0.75])samples.push({i,x:left+(right-left)*t});
  });
  const y=(probe.header.top+probe.header.bottom)/2;
  for(const sample of samples){
   const hit=await page.evaluate(([x,y])=>window.hit(x,y),[sample.x,y]);
   assert.equal(hit.key,probe.cells[sample.i].key,`${dir}: the header is over visible body column ${sample.i} (${probe.cells[sample.i].key}) at x=${sample.x.toFixed(1)}: elementFromPoint found ${JSON.stringify(hit)}`);
  }
  console.log(`PASS ${dir}: wide page table, header over every column after scrolling the window ${wanted}px`,JSON.stringify({scrollX:probe.scrollX,group:{left:probe.group.left,right:probe.group.right},body:{left:bodyLeft,right:bodyRight},samples:samples.length}));
  await page.close();
 }

 // Unpin the last column while scrolled: the scroll returns to the window and
 // the header must not keep the viewport's translateX.
 {
  const page=await open('dir=ltr&pin=1');
  let probe=await page.evaluate(()=>window.probe());
  assert.equal(probe.pinned,true,'LTR unpin: the fixture starts with a pinned column');
  await page.evaluate(()=>window.scrollViewport(120));
  await settle(page);
  probe=await page.evaluate(()=>window.probe());
  assert.equal(probe.viewportScrollLeft,120,`LTR unpin: the pinned page table scrolls its viewport, scrollLeft is ${probe.viewportScrollLeft}`);
  assert(near(probe.transform.indexOf('translateX')>=0?transformX(probe.transform):0,-120),`LTR unpin: the pinned header follows the viewport, transform ${JSON.stringify(probe.transform)}`);
  probe.cells.forEach((cell,i)=>assert(near(cell.left,probe.bodies[i].left),`LTR unpin: while pinned, header cell ${i} (${cell.key}) sits over its body column: header left ${cell.left}, body left ${probe.bodies[i].left}`));
  await page.evaluate(()=>window.list.setColumnPin('name',null));
  await settle(page);
  probe=await page.evaluate(()=>window.probe());
  assert.equal(probe.pinned,false,'LTR unpin: unpinning the last column leaves pinned mode');
  assert(near(probe.scrollX,120),`LTR unpin: the scroll moves back to the document, window.scrollX is ${probe.scrollX}, wanted 120`);
  assert.equal(probe.viewportScrollLeft,0,`LTR unpin: the viewport scroll is cleared, scrollLeft is ${probe.viewportScrollLeft}`);
  assert(near(transformX(probe.transform),0),`LTR unpin: the header keeps a stale translateX after unpinning: transform ${JSON.stringify(probe.transform)}`);
  probe.cells.forEach((cell,i)=>assert(near(cell.left,probe.bodies[i].left),`LTR unpin: after unpinning, header cell ${i} (${cell.key}) must sit over its body column: header left ${cell.left}, body left ${probe.bodies[i].left}`));
  console.log('PASS LTR unpin: the header follows the scroll back to the document',JSON.stringify({scrollX:probe.scrollX,viewportScrollLeft:probe.viewportScrollLeft,transform:probe.transform}));
  await page.close();
 }

 // A narrow page table keeps a full-width header: width: max-content alone
 // would shrink the rowgroup to the columns, min-width: 100% prevents it.
 {
  const page=await open('dir=ltr&narrow=1');
  const probe=await page.evaluate(()=>window.probe());
  assert(near(probe.group.width,probe.rootClientWidth),`LTR narrow: the header rowgroup spans the container: width ${probe.group.width}, root content width ${probe.rootClientWidth}`);
  probe.cells.forEach((cell,i)=>assert(near(cell.left,probe.bodies[i].left),`LTR narrow: header cell ${i} (${cell.key}) sits over its body column: header left ${cell.left}, body left ${probe.bodies[i].left}`));
  console.log('PASS LTR narrow: a page table narrower than its container keeps a full-width header',JSON.stringify({groupWidth:probe.group.width,cells:probe.cells.length}));
  await page.close();
 }

 console.log('SUMMARY',JSON.stringify({passes:4}));
} finally {await browser?.close();server.stop(true);}
