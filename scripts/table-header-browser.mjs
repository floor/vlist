/** Table header pointer gate (#340, #341). Build first. Uses
 * scripts/browser-driver.mjs; VLIST_BROWSER_DRIVER overrides it with another
 * module exporting launchBrowser.
 *
 * The issue was a real pointer: a button supplied as a column label was
 * unreachable because the shipped stylesheet disabled pointer events on the
 * header content wrapper. This gate drives a real mouse and a real touch tap at
 * the button's centre, checks elementFromPoint agrees, and then checks the
 * header's own interactions still work: a click on a sortable label sorts and
 * emits column:click before column:sort, and a drag on the resize handle still
 * resizes.
 */
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pinPage, settle} from './browser-page.mjs';
const root=resolve(import.meta.dir,'../dist');
const html=`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/vlist.css"><link rel="stylesheet" href="/vlist-table.css"><style>body{margin:20px}#host{width:420px;height:320px}</style><div id="host"></div>
<script type="module">
import {createVList} from '/index.js';import {table} from '/index.js';
const button=document.createElement('button');button.id='label-button';button.type='button';button.textContent='Menu';
window.buttonClicks=0;button.addEventListener('click',()=>{window.buttonClicks++;});
const list=createVList({container:'#host',items:Array.from({length:60},(_,id)=>({id,name:'Name '+id,value:'Value '+id})),item:{height:32,template:i=>'<span>'+i.name+'</span>'}},[table({rowHeight:32,columns:[{key:'name',label:button,width:200,sortable:true},{key:'value',label:'Value',width:260,sortable:true}]})]);
window.list=list;window.events=[];
list.on('column:click',e=>events.push({type:'click',key:e.key,index:e.index,eventType:e.event&&e.event.type,isMouse:e.event instanceof MouseEvent}));
list.on('column:sort',e=>events.push({type:'sort',key:e.key,index:e.index,direction:e.direction}));
list.on('column:resize',e=>events.push({type:'resize',key:e.key,index:e.index,previousWidth:e.previousWidth,width:e.width}));
window.pointOf=sel=>{const el=document.querySelector(sel);const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};};
window.hitAt=(x,y)=>{const el=document.elementFromPoint(x,y);return el?{tag:el.tagName,id:el.id,cls:String(el.className)}:null;};
window.headerInfo=()=>({contentPointerEvents:getComputedStyle(document.querySelector('.vlist-table-header-content')).pointerEvents,cellLefts:[...document.querySelectorAll('.vlist-table-header-cell')].map(c=>c.getBoundingClientRect().left)});
window.snapshot=()=>({buttonClicks,events:[...events],widths:list.getColumnWidths(),sort:list.getSort()});
window.ready=true;
</script>`;
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){
 const path=new URL(req.url).pathname;
 if(path==='/')return new Response(html,{headers:{'Content-Type':'text/html'}});
 if(['/index.js','/vlist.css','/vlist-table.css'].includes(path))return new Response(Bun.file(root+path));
 return new Response('',{status:404});
}});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let browser;
try {
 const driver=process.env.VLIST_BROWSER_DRIVER??resolve(import.meta.dir,'browser-driver.mjs');
 browser=await (await import(resolve(driver))).launchBrowser();console.log(await browser.version());
 const page=await browser.newPage();const cdp=await pinPage(page,{width:800,height:600,hasTouch:true});
 await page.goto(server.url.href);await page.waitForFunction(()=>window.ready);await settle(page);
 await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
 const touch=(type,p)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{id:1,x:p.x,y:p.y,radiusX:3,radiusY:3}]});
 const button=await page.evaluate(()=>pointOf('#label-button'));
 const handle=await page.evaluate(()=>pointOf('.vlist-table-header-resize'));
 const hitButton=await page.evaluate(p=>hitAt(p.x,p.y),button);
 const hitHandle=await page.evaluate(p=>hitAt(p.x,p.y),handle);
 assert.equal(hitButton&&hitButton.id,'label-button',`elementFromPoint at the label button centre is the button, got ${JSON.stringify(hitButton)}`);
 assert.equal(hitHandle&&hitHandle.cls.includes('vlist-table-header-resize'),true,`elementFromPoint at the resize handle centre is the handle, got ${JSON.stringify(hitHandle)}`);
 const info=await page.evaluate(()=>headerInfo());
 assert.notEqual(info.contentPointerEvents,'none','the content wrapper must not disable pointer events');
 console.log('PASS hit test: elementFromPoint at the label button centre is the button, at the handle centre is the handle',JSON.stringify({pointerEvents:info.contentPointerEvents}));

 await page.mouse.click(button.x,button.y);await wait(50);
 let state=await page.evaluate(()=>snapshot());
 assert.equal(state.buttonClicks,1,'a real pointer click reaches the supplied button');
 assert.equal(state.events.length,0,`a click on the supplied button emits neither column:click nor column:sort: ${JSON.stringify(state.events)}`);
 console.log('PASS pointer click reaches the supplied header button and emits no column event',JSON.stringify({buttonClicks:state.buttonClicks}));

 await touch('touchStart',button);await touch('touchEnd',button);await wait(50);
 state=await page.evaluate(()=>snapshot());
 assert.equal(state.buttonClicks,2,'a touch tap reaches the supplied button');
 assert.equal(state.events.length,0,`a tap on the supplied button emits neither column:click nor column:sort: ${JSON.stringify(state.events)}`);
 console.log('PASS touch tap reaches the supplied header button and emits no column event',JSON.stringify({buttonClicks:state.buttonClicks}));

 const label=await page.evaluate(()=>{const cells=[...document.querySelectorAll('.vlist-table-header-cell')];const r=cells[1].querySelector('.vlist-table-header-content').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});
 await page.mouse.click(label.x,label.y);await wait(50);
 state=await page.evaluate(()=>snapshot());
 assert.deepEqual(state.events.map(e=>e.type),['click','sort'],`a sortable header click emits column:click then column:sort: ${JSON.stringify(state.events)}`);
 assert.deepEqual(state.events[0],{type:'click',key:'value',index:1,eventType:'click',isMouse:true},'column:click carries the declared payload');
 assert.deepEqual(state.events[1],{type:'sort',key:'value',index:1,direction:'asc'},'column:sort carries the declared payload');
 assert.deepEqual(state.sort,{key:'value',direction:'asc'});
 console.log('PASS sortable header click emits column:click then column:sort',JSON.stringify(state.events));

 await page.mouse.move(handle.x,handle.y);await page.mouse.down();
 await page.mouse.move(handle.x+20,handle.y,{steps:3});await page.mouse.move(handle.x+40,handle.y,{steps:3});await page.mouse.up();
 await settle(page);await wait(50);
 state=await page.evaluate(()=>snapshot());
 const resize=state.events.filter(e=>e.type==='resize');
 assert(resize.length>0,'the resize drag emits column:resize');
 assert.equal(resize[resize.length-1].key,'name');
 assert(Math.abs(state.widths.name-240)<=2,`the drag resizes the column by 40px, width ${state.widths.name}`);
 assert(Math.abs(state.widths.value-260)<=2,`the other column keeps its width, width ${state.widths.value}`);
 assert(Math.abs(resize[resize.length-1].width-240)<=2,`column:resize reports the new width ${resize[resize.length-1].width}`);
 assert.deepEqual(state.sort,{key:'value',direction:'asc'},'resizing does not change the sort state');
 assert.equal(state.buttonClicks,2,'the resize drag does not reach the supplied button');
 const after=await page.evaluate(()=>headerInfo());
 const spread=after.cellLefts[1]-after.cellLefts[0];
 assert(Math.abs(spread-state.widths.name)<=2,`the header follows the resize: second cell starts ${spread}px after the first, width ${state.widths.name}`);
 console.log('PASS resize handle still resizes',JSON.stringify({widths:state.widths,events:resize}));

 // #348: a real click focuses the clicked cell (mousedown's default action on
 // its tabindex), so Enter and the arrows must act from that cell, not from
 // the cell the roving index was left on.
 const valueLabel=await page.evaluate(()=>{const cells=[...document.querySelectorAll('.vlist-table-header-cell')];const r=cells[1].querySelector('.vlist-table-header-content').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});
 await page.mouse.click(valueLabel.x,valueLabel.y);await wait(50);
 assert.equal(await page.evaluate(()=>document.activeElement&&document.activeElement.dataset.columnKey),'value','a real click focuses the clicked header cell');
 await page.keyboard.press('Enter');await wait(50);
 state=await page.evaluate(()=>snapshot());
 const lastSort=state.events[state.events.length-1];
 assert.equal(lastSort.type,'sort',`Enter after a click emits column:sort: ${JSON.stringify(state.events)}`);
 assert.equal(lastSort.key,'value',`Enter sorts the clicked column, not the roving cell: ${JSON.stringify(state.events)}`);
 assert.equal(lastSort.index,1,'column:sort reports the clicked column index');
 await page.keyboard.press('ArrowLeft');await wait(50);
 assert.equal(await page.evaluate(()=>document.activeElement&&document.activeElement.dataset.columnKey),'name','ArrowLeft moves to the neighbour of the clicked cell, not of the roving cell');
 console.log('PASS click moves the roving index: Enter and the arrows continue from the clicked header cell',JSON.stringify({lastSort}));

 console.log('SUMMARY',JSON.stringify({passes:6}));
 await page.close();
} finally {await browser?.close();server.stop(true);}
