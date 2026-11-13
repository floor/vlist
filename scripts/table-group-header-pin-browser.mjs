/** Group header pinned to the visible viewport, and the native horizontal
 * scrollbar in table mode (#25 follow-up). Build first. Uses
 * scripts/browser-driver.mjs; VLIST_BROWSER_DRIVER overrides it with another
 * module exporting launchBrowser.
 *
 * The reporter's table overflowed its columns. Since 3.8.2 a group header's
 * content box spans the row's scroll width, so a count at the content's right
 * edge sat past the last visible column and never appeared. The row keeps the
 * scroll width — its background must cover every column — while the content is
 * as wide as the visible viewport (100cqw against the .vlist--table
 * .vlist-viewport size container) and sticky at its left edge. The same pass
 * checks the other half of the report: the table stylesheet re-enables the
 * native scrollbar system so the horizontal bar stays (only the vertical one is
 * replaced by the custom scrollbar), but the base stylesheet's
 * `scrollbar-width: none` overrode it in Chrome 121+. This gate reads the
 * cascade, and on a platform whose scrollbars take layout space, the bar.
 */
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pinPage, settle} from './browser-page.mjs';
const root=resolve(import.meta.dir,'../dist');
const html=`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/vlist.css"><link rel="stylesheet" href="/vlist-table.css"><style>body{margin:20px}.host{width:640px;height:360px}.gh{display:flex;justify-content:space-between;align-items:center;width:100%;padding:0 8px;box-sizing:border-box}.gh-count{color:#888}</style><div id="host" class="host"></div><div id="pin-host" class="host"></div><div id="gutter-host" class="host"></div><div id="sticky-host" class="host"></div>
<script type="module">
import {createVList,table,groups,scrollbar,columnPin,columnReorder} from '/index.js';
const cats=['Alpha','Beta','Gamma'];
const items=Array.from({length:45},(_,i)=>({id:i,name:'Item '+i,size:(i*37)+' B',modified:'Nov '+(i+1)+', 2026',kind:['Doc','Tool','Folder'][i%3],cat:cats[i%3]}));
const columns=[{key:'name',label:'Name',width:260},{key:'size',label:'Size',width:200},{key:'modified',label:'Modified',width:200},{key:'kind',label:'Kind',width:200}];
const headerTemplate=key=>'<div class="gh"><span class="gh-label">'+key+'</span><span class="gh-count">'+items.filter(i=>i.cat===key).length+' items</span></div>';
const makeGroups=(sticky=false)=>groups({sticky,getGroupForIndex:i=>items[i].cat,header:{height:28,template:headerTemplate}});
const makeList=(host,tablePlugin,scrollbarPlugin=scrollbar(),sticky=false)=>createVList({container:host,items,item:{height:32,template:i=>'<span>'+i.name+'</span>'}},[tablePlugin,makeGroups(sticky),scrollbarPlugin]);
window.list=makeList('#host',table({rowHeight:32,columns,features:[columnReorder()]}));
window.pinList=makeList('#pin-host',table({rowHeight:32,columns,features:[columnPin({pins:{name:'left'}})]}));
window.gutterList=makeList('#gutter-host',table({rowHeight:32,columns}),scrollbar({gutter:true}));
window.stickyList=makeList('#sticky-host',table({rowHeight:32,columns}),scrollbar(),true);
window.measure=()=>{
  const box=el=>{const r=el.getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),right:Math.round(r.right)};};
  const vp=document.querySelector('#host .vlist-viewport');
  const vr=vp.getBoundingClientRect();
  const headers=[...document.querySelectorAll('#host .vlist-table-group-header')]
    .map(row=>{const c=row.querySelector('.vlist-table-group-header-content');return{c,row};})
    .filter(o=>o.c&&o.c.getBoundingClientRect().height>0);
  const h=headers[0];
  const content=h&&h.c;
  const label=content&&content.querySelector('.gh-label');
  const count=content&&content.querySelector('.gh-count');
  const cb=content?box(content):null;
  const lb=label?box(label):null;
  const nb=count?box(count):null;
  const cs=content?getComputedStyle(content):null;
  const pseudo=content?getComputedStyle(vp,'::-webkit-scrollbar'):null;
  return{
    viewport:{...box(vp),clientWidth:vp.clientWidth,clientHeight:vp.clientHeight,offsetWidth:vp.offsetWidth,offsetHeight:vp.offsetHeight,scrollLeft:Math.round(vp.scrollLeft),scrollWidth:vp.scrollWidth},
    count:headers.length,
    content:cb,label:lb,countBox:nb,
    position:cs&&cs.position,
    width:cs&&cs.width,
    labelVisible:!!(lb&&lb.x>=Math.round(vr.x)-1&&lb.x+lb.w<=Math.round(vr.right)+1),
    countVisible:!!(nb&&nb.x>=Math.round(vr.x)-1&&nb.x+nb.w<=Math.round(vr.right)+1),
    countAfterLabel:!!(lb&&nb&&nb.x>lb.x+lb.w),
    scrollbarWidth:getComputedStyle(vp).scrollbarWidth,
    containerType:getComputedStyle(vp).containerType,
    pseudoDisplay:pseudo&&pseudo.display,
    pseudoWidth:pseudo&&pseudo.width,
  };
};
window.gutterInfo=()=>{
  const vp=document.querySelector('#gutter-host .vlist-viewport');
  const style=getComputedStyle(vp);
  const vr=vp.getBoundingClientRect();
  const row=[...document.querySelectorAll('#gutter-host .vlist-table-group-header')].find(r=>r.querySelector('.vlist-table-group-header-content').getBoundingClientRect().height>0);
  const content=row&&row.querySelector('.vlist-table-group-header-content');
  const count=content&&content.querySelector('.gh-count');
  const cr=content&&content.getBoundingClientRect();
  const nb=count&&count.getBoundingClientRect();
  const padding=parseFloat(style.paddingLeft)+parseFloat(style.paddingRight);
  return{
    clientWidth:vp.clientWidth,padding,containerType:style.containerType,
    contentWidth:cr&&Math.round(cr.width),contentLeft:cr&&Math.round(cr.x),
    contentBoxRight:Math.round(vr.right-padding),contentRight:cr&&Math.round(cr.right),
    countRight:nb&&Math.round(nb.right),
    countVisible:!!(nb&&nb.x>=vr.x-1&&nb.right<=vr.right-padding+1),
  };
};
window.pinInfo=()=>{
  const vp=document.querySelector('#pin-host .vlist-viewport');
  const vr=vp.getBoundingClientRect();
  const row=[...document.querySelectorAll('#pin-host .vlist-table-group-header')].find(r=>r.querySelector('.vlist-table-group-header-content').getBoundingClientRect().height>0);
  const content=row&&row.querySelector('.vlist-table-group-header-content');
  const count=content&&content.querySelector('.gh-count');
  const cb=content&&content.getBoundingClientRect();
  const nb=count&&count.getBoundingClientRect();
  const pinnedCells=[...document.querySelectorAll('#pin-host .vlist-table-cell--pin-left,#pin-host .vlist-table-cell--pin-right')].map(c=>Math.round(c.getBoundingClientRect().left));
  const hit=nb?document.elementFromPoint(nb.x+nb.width/2,nb.y+nb.height/2):null;
  return{
    viewportLeft:Math.round(vr.x),viewportRight:Math.round(vr.right),clientWidth:vp.clientWidth,scrollLeft:Math.round(vp.scrollLeft),
    contentLeft:cb&&Math.round(cb.x),contentWidth:cb&&Math.round(cb.width),
    countVisible:!!(nb&&nb.x>=vr.x-1&&nb.x+nb.width<=vr.right+1),
    countAfterLabel:!!(()=>{const l=content.querySelector('.gh-label').getBoundingClientRect();return nb&&nb.x>l.x+l.width;})(),
    pinnedCells,
    countHit:!!(hit&&hit.closest&&hit.closest('.gh-count')),
  };
};
window.stickyInfo=()=>{
  const holder=document.querySelector('#sticky-host .vlist-sticky-header');
  if(!holder)return{exists:false};
  const count=holder.querySelector('.gh-count');
  const hr=holder.getBoundingClientRect();
  const nb=count&&count.getBoundingClientRect();
  const vr=document.querySelector('#sticky-host .vlist-viewport').getBoundingClientRect();
  return{exists:true,holder:{x:Math.round(hr.x),w:Math.round(hr.width),right:Math.round(hr.right)},countRight:nb&&Math.round(nb.right),countVisible:!!(nb&&nb.left>=hr.left-1&&nb.right<=hr.right+1),viewportRight:Math.round(vr.right)};
};
window.setScroll=(sel,x)=>{const vp=document.querySelector(sel+' .vlist-viewport');vp.scrollLeft=x;vp.dispatchEvent(new Event('scroll'));};
window.resizeHost=(w)=>{document.querySelector('#host').style.width=w+'px';};
window.classicScrollbars=()=>{const d=document.createElement('div');d.style.cssText='width:60px;height:60px;overflow:scroll;position:absolute;top:-200px;left:0';document.body.appendChild(d);const classic=d.offsetHeight-d.clientHeight>0;d.remove();return classic;};
window.ready=true;
</script>`;
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){
 const path=new URL(req.url).pathname;
 if(path==='/')return new Response(html,{headers:{'Content-Type':'text/html'}});
 if(['/index.js','/vlist.css','/vlist-table.css'].includes(path))return new Response(Bun.file(root+path));
 return new Response('',{status:404});
}});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const within=(actual,expected,tolerance=1)=>Math.abs(actual-expected)<=tolerance;
let browser;
try {
 const driver=process.env.VLIST_BROWSER_DRIVER??resolve(import.meta.dir,'browser-driver.mjs');
 browser=await (await import(resolve(driver))).launchBrowser();console.log(await browser.version());
 const page=await browser.newPage();await pinPage(page,{width:800,height:600});
 await page.goto(server.url.href);await page.waitForFunction(()=>window.ready);await settle(page);await wait(100);

 // ── Pinned to the visible viewport at scrollLeft 0 ─────────────────
 let m=await page.evaluate(()=>measure());
 assert(m.count>0,'group headers rendered');
 assert.equal(m.position,'sticky',`content is position: ${m.position}, expected sticky`);
 assert.equal(m.containerType,'inline-size',`the table viewport is the size container 100cqw resolves against: container-type ${m.containerType}`);
 assert(within(m.content.w,m.viewport.clientWidth),`content ${m.content.w} spans the visible width ${m.viewport.clientWidth}`);
 assert(within(m.content.x,m.viewport.x),`content starts at the viewport's left edge: content ${m.content.x}, viewport ${m.viewport.x}`);
 assert(m.labelVisible&&m.countVisible,`label and count visible at scrollLeft 0: ${JSON.stringify({label:m.label,count:m.countBox,viewport:m.viewport})}`);
 assert(m.countAfterLabel,'the count stays after the label');
 assert(m.viewport.scrollWidth>m.viewport.clientWidth,'the columns overflow the viewport (the reporter’s setup)');
 console.log('PASS pinned at scrollLeft 0: content spans the visible viewport, label left, count right',JSON.stringify({content:m.content,label:m.label,count:m.countBox,viewport:{clientWidth:m.viewport.clientWidth,scrollWidth:m.viewport.scrollWidth}}));

 // ── Still pinned after scrolling right ─────────────────────────────
 await page.evaluate(()=>setScroll('#host',300));await settle(page);
 m=await page.evaluate(()=>measure());
 assert(m.viewport.scrollLeft>200,`scrolled right: scrollLeft ${m.viewport.scrollLeft}`);
 assert(within(m.content.x,m.viewport.x),`content stays at the viewport's left edge while scrolled: content ${m.content.x}, viewport ${m.viewport.x}`);
 assert(m.labelVisible&&m.countVisible,`label and count visible after scrolling: ${JSON.stringify({label:m.label,count:m.countBox,viewport:m.viewport})}`);
 console.log('PASS still pinned after scrolling right',JSON.stringify({scrollLeft:m.viewport.scrollLeft,contentLeft:m.content.x,viewportLeft:m.viewport.x}));

 // ── Pinning follows a container resize ─────────────────────────────
 await page.evaluate(()=>resizeHost(900));await settle(page);await wait(150);
 m=await page.evaluate(()=>measure());
 assert(within(m.content.w,m.viewport.clientWidth),`after the container grew: content ${m.content.w}, visible width ${m.viewport.clientWidth}`);
 assert(m.countVisible,'the count stays visible after the container resize');
 await page.evaluate(()=>resizeHost(640));await settle(page);await wait(150);
 console.log('PASS content width follows a container resize',JSON.stringify({from:638,to:m.viewport.clientWidth,content:m.content.w}));

 // ── Pinning follows a column resize (content keeps the visible width) ─
 await page.evaluate(()=>{list.resizeColumn('name',420);setScroll('#host',0);});await settle(page);await wait(100);
 m=await page.evaluate(()=>measure());
 assert(within(m.content.w,m.viewport.clientWidth),`after a column resize: content ${m.content.w}, visible width ${m.viewport.clientWidth}`);
 assert(m.countVisible,'the count stays visible after a column resize');
 await page.evaluate(()=>{list.resizeColumn('name',260);});await settle(page);await wait(100);
 console.log('PASS content width survives a column resize',JSON.stringify({content:m.content.w,clientWidth:m.viewport.clientWidth}));

 // ── Pinning survives a column reorder ──────────────────────────────
 await page.evaluate(()=>{list.moveColumn(0,1);setScroll('#host',0);});await settle(page);await wait(100);
 m=await page.evaluate(()=>measure());
 assert(within(m.content.w,m.viewport.clientWidth),`after a column reorder: content ${m.content.w}, visible width ${m.viewport.clientWidth}`);
 assert(m.labelVisible&&m.countVisible,'label and count stay visible after a column reorder');
 console.log('PASS content width survives a column reorder',JSON.stringify({order:await page.evaluate(()=>list.getColumnOrder()),content:m.content.w}));

 // ── Pinned columns sit in their rows, not over the group header ───
 await page.evaluate(()=>setScroll('#pin-host',280));await settle(page);await wait(100);
 const pin=await page.evaluate(()=>pinInfo());
 assert(within(pin.contentLeft,pin.viewportLeft),`pinned table: content at the viewport's left edge, content ${pin.contentLeft}, viewport ${pin.viewportLeft}`);
 assert(within(pin.contentWidth,pin.clientWidth),`pinned table: content ${pin.contentWidth} spans the visible width ${pin.clientWidth}`);
 assert(pin.countVisible&&pin.countAfterLabel,`pinned table: count visible after the label: ${JSON.stringify(pin)}`);
 assert(pin.countHit,`pinned table: the count receives the hit at its centre, not a pinned cell: ${JSON.stringify(pin)}`);
 console.log('PASS pinned columns do not cover the group header content',JSON.stringify(pin));

 // ── The content width is the content box, gutter padding excluded ──
 const gut=await page.evaluate(()=>gutterInfo());
 assert.equal(gut.containerType,'inline-size',`the gutter host's viewport is the size container: container-type ${gut.containerType}`);
 assert(gut.padding>0,`the gutter host reserves right padding for the custom scrollbar: ${gut.padding}`);
 assert(within(gut.contentWidth,gut.clientWidth-gut.padding),`content ${gut.contentWidth} spans the viewport content box ${gut.clientWidth-gut.padding} (clientWidth ${gut.clientWidth}, padding ${gut.padding})`);
 assert(within(gut.contentRight,gut.contentBoxRight),`content right ${gut.contentRight} ends at the content box edge ${gut.contentBoxRight}: it must not run under the custom scrollbar gutter`);
 assert(gut.countVisible,`the count stays visible inside the gutter host: ${JSON.stringify(gut)}`);
 console.log('PASS content width is the viewport content box, custom-scrollbar gutter excluded',JSON.stringify(gut));

 // ── The sticky group header's own count stays inside its container ──
 const st=await page.evaluate(()=>stickyInfo());
 assert(st.exists,'the sticky host renders a sticky group header');
 assert(st.countVisible,`sticky group header: the count stays inside the container: ${JSON.stringify(st)}`);
 console.log('PASS sticky group header keeps its count inside the container',JSON.stringify(st));

 // ── The native horizontal scrollbar is left enabled ────────────────
 assert.equal(m.scrollbarWidth,'auto',`the table viewport leaves the native scrollbar system enabled: scrollbar-width ${m.scrollbarWidth}`);
 assert.equal(m.pseudoDisplay,'block',`::-webkit-scrollbar is re-enabled: display ${m.pseudoDisplay}`);
 assert.equal(m.pseudoWidth,'0px',`the vertical bar is zero-width: ${m.pseudoWidth}`);
 const classic=await page.evaluate(()=>classicScrollbars());
 if(classic){
   assert(m.viewport.offsetHeight-m.viewport.clientHeight>0,`horizontal native scrollbar takes layout space: offsetHeight ${m.viewport.offsetHeight}, clientHeight ${m.viewport.clientHeight}`);
   assert.equal(m.viewport.offsetWidth-m.viewport.clientWidth,0,'the vertical native bar stays hidden');
   console.log('PASS native horizontal scrollbar present, vertical hidden',JSON.stringify({horizontal:m.viewport.offsetHeight-m.viewport.clientHeight,vertical:m.viewport.offsetWidth-m.viewport.clientWidth}));
 }else{
   console.log('SKIP native scrollbar layout space: this platform paints overlay scrollbars (a plain overflow box takes none either)');
 }
 console.log('SUMMARY',JSON.stringify({passes:9,classicScrollbars:classic}));
 await page.close();
} finally {await browser?.close();server.stop(true);}
