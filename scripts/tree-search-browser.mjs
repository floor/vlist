/** Public-API regression probes for tree anchors/focus and search data/layouts.
 * Build first. VLIST_TREE_SEARCH_ROOT selects a published baseline export;
 * VLIST_TREE_SEARCH_CASES selects comma-separated cases, one fresh browser each.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pinPage } from "./browser-page.mjs";
const { launchBrowser } = await import(resolve(process.env.VLIST_BROWSER_DRIVER ?? resolve(import.meta.dir, "browser-driver.mjs")));
const root = process.env.VLIST_TREE_SEARCH_ROOT ?? resolve(import.meta.dir, "..");
const captures = process.env.VLIST_TREE_SEARCH_CAPTURES;
const cases = process.env.VLIST_TREE_SEARCH_CASES?.split(",") ?? [
  ...["vertical", "horizontal"].flatMap(axis => ["expand", "collapse"].map(action => `anchor-${axis}-${action}`)),
  ...["standalone", "selection", "a11y"].flatMap(owner => ["expand", "collapse", "expandAll", "collapseAll", "siblings"].map(action => `focus-${owner}-${action}`)),
  ...["filter", "navigate"].flatMap(mode => ["replace", "append", "remove"].map(action => `mutate-${mode}-${action}`)),
  ...["groups", "table", "table-groups"].flatMap(layout => ["filter", "navigate"].map(mode => `layout-${layout}-${mode}`)),
  "keys-groups", "keys-table-groups",
];
const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/vlist.css"><link rel="stylesheet" href="/vlist-table.css"><link rel="stylesheet" href="/vlist-tree.css">
<style>body{margin:24px;font:16px system-ui;color:#172434;background:#f8fafc}#list{width:480px;height:320px;border:1px solid #94a3b8;background:white}pre{max-width:850px;white-space:pre-wrap}h1{font-size:22px}</style>
<h1 id="title"></h1><div id="list"></div><pre id="result">Running…</pre>
<script type="module">
import {createVList,tree,selection,a11y,search,groups,table} from '/index.js';
const name = new URLSearchParams(location.search).get('case');
document.querySelector('#title').textContent = name;
const treeRows = () => Array.from({length:60},(_,i)=>({id:'root-'+i,name:'Root '+i,children:[0,1].map(j=>({id:'child-'+i+'-'+j,name:'Child '+i+'.'+j,children:[]}))}));
const press = key => document.querySelector('.vlist-content').dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
const frames = async () => {for(let i=0;i<2;i++) await new Promise(requestAnimationFrame);};
const row = id => document.querySelector('[data-id="'+id+'"]');
const screen = (id,horizontal=false) => {const r=row(id)?.getBoundingClientRect();const v=document.querySelector('.vlist-viewport').getBoundingClientRect();return r?(horizontal?r.left-v.left:r.top-v.top):null;};
const inside = id => {const r=row(id)?.getBoundingClientRect();const v=document.querySelector('.vlist-viewport').getBoundingClientRect();return !!r&&r.top>=v.top-1&&r.bottom<=v.bottom+1;};
window.run = async () => {
 const failures=[];const details={case:name};const check=(ok,label)=>{if(!ok) failures.push(label);};
 if(name.startsWith('anchor-')||name.startsWith('focus-')) {
  const anchor=name.startsWith('anchor-');const parts=name.split('-');const owner=anchor?'standalone':parts[1];const action=parts[2];const horizontal=anchor&&parts[1]==='horizontal';
  window.list=createVList({container:'#list',items:treeRows(),orientation:horizontal?'horizontal':'vertical',item:{height:40,width:40,template:item=>item.name}},[tree(),...(owner==='standalone'?[]:[owner==='selection'?selection():a11y()])]);
  await frames();
  if(anchor) {
   if(action==='collapse') list.expand('root-0');
   list.scrollToIndex(list.getIndexById('root-20'));await frames();
   const before=screen('root-20',horizontal);list[action]('root-0');await frames();
   details.before=before;details.after=screen('root-20',horizontal);details.scroll=list.getScrollPosition();
   check(before!==null&&Math.abs(details.after-before)<1,'visible node moved');
  } else {
   if(action==='collapse') list.expand('root-0');
   if(action==='collapseAll') list.expandAll();
   const content=document.querySelector('.vlist-content');content.focus();press('Home');press('End');
   if(action==='siblings') press('*');else if(action.endsWith('All')) list[action]();else list[action]('root-0');
   list.scrollToIndex(list.getIndexById('root-59'));await frames();
   const focused=document.querySelector('.vlist-item--focused');details.focus=focused?.dataset.id??null;details.active=content.getAttribute('aria-activedescendant');
   check(details.focus==='root-59','focus changed identity');check(!!focused&&details.active===focused.id,'active descendant and ring differ');
  }
 } else if(name.startsWith('mutate-')) {
  const [,mode,action]=name.split('-');
  window.list=createVList({container:'#list',items:[{id:1,name:'match first'},{id:2,name:'other'},{id:3,name:'match last'}],item:{height:40,template:item=>item.name}},[search({mode,position:'none',field:'name'})]);
  const events=[];list.on('search:match',event=>events.push({index:event.index,id:event.item?.id}));list.setQuery('match');
  if(action==='replace') list.setItems([{id:4,name:'new other'},{id:5,name:'match replacement'}]);
  if(action==='append') list.appendItems([{id:4,name:'match appended'}]);
  if(action==='remove') list.removeItem(1);
  await frames();
  const expected=action==='append'?[0,2,3]:[1];details.matches=list.getMatches();
  check(JSON.stringify(details.matches)===JSON.stringify(expected),'stale match indices');
  if(mode==='filter') {details.ids=Array.from({length:list.total},(_,i)=>list.getItemAt(i)?.id);check(JSON.stringify(details.ids)===JSON.stringify(action==='replace'?[5]:action==='append'?[1,3,4]:[3]),'stale filtered items');}
  else {list.nextMatch();if(action==='append')list.nextMatch();details.event=events[events.length-1];check(details.event?.id===(action==='replace'?5:action==='append'?4:3),'navigation selected wrong item');}
 } else {
  const keys=name.startsWith('keys-');const mode=keys?'filter':name.endsWith('-filter')?'filter':'navigate';
  const layout=name.slice(keys?5:7,keys?undefined:-(mode.length+1));const plugins=[];
  if(layout.includes('table'))plugins.push(table({columns:[{key:'name',label:'Name',width:300}],rowHeight:40,headerHeight:20}));
  if(layout.includes('groups'))plugins.push(groups({getGroupForIndex:(_i,item)=>item?.group??'?',header:{height:40,template:key=>'match header '+key}}));
  plugins.push(search({mode,position:'none',field:'name'}));
  const items=keys?[{id:1,name:'pear one',group:'A'},{id:2,name:'pear two',group:'A'},{id:3,name:'plum one',group:'B'},{id:4,name:'plum two',group:'B'}]:Array.from({length:100},(_,i)=>({id:i+1,name:i===70||i===90?'match '+i:'other '+i,group:'G'+Math.floor(i/2)}));
  window.list=createVList({container:'#list',items,item:{height:40,template:item=>item.name}},plugins);
  const events=[];list.on('search:match',event=>events.push({index:event.index,id:event.item?.id}));await frames();
  if(keys) {list.setQuery('pear');list.setQuery('plum');await frames();details.header=document.querySelector('.vlist-sticky-header')?.textContent;check(details.header?.includes('B'),'group keys were not refreshed');}
  else {
   list.setQuery('match');await frames();details.matches=list.getMatches();check(JSON.stringify(details.matches)==='[70,90]','headers entered matches');
   if(mode==='filter') {details.ids=[list.getItemAt(0)?.id,list.getItemAt(1)?.id];check(JSON.stringify(details.ids)==='[71,91]'&&!!row(71)&&!!row(91),'filtered data and rendered rows differ');}
   else {details.visible=inside(71);details.event=events[0];check(details.visible,'current match outside viewport');check(details.event?.index===70&&details.event?.id===71,'match event has wrong item');list.nextMatch();await frames();check(inside(91),'next match outside viewport');}
  }
 }
 details.failures=failures;document.querySelector('#result').textContent=JSON.stringify(details,null,2);document.querySelector('#result').style.color=failures.length?'#b91c1c':'#166534';return details;
};
window.ready=true;
</script>`;
const server = Bun.serve({ port: 0, fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === "/") return new Response(html, { headers: { "Content-Type": "text/html" } });
  if (["/index.js", "/vlist.css", "/vlist-table.css", "/vlist-tree.css"].includes(path)) return new Response(Bun.file(`${root}/dist${path}`));
  return new Response("Not found", { status: 404 });
} });
let failures = 0;
try {
  if (captures) await mkdir(captures, { recursive: true });
  for (const name of cases) {
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await pinPage(page);
      const errors = [];
      page.on("pageerror", error => errors.push(error.stack ?? String(error)));
      await page.goto(`http://localhost:${server.port}/?case=${name}`);
      await page.waitForFunction(() => window.ready);
      const result = await page.evaluate(() => window.run());
      if (captures) await page.screenshot({ path: resolve(captures, `${name}.png`), fullPage: true });
      console.log(`${result.failures.length || errors.length ? "FAIL" : "PASS"} ${name} ${JSON.stringify({ ...result, errors })}`);
      if (result.failures.length || errors.length) failures++;
    } catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack ?? error}`); }
    finally { await browser.close(); }
  }
  console.log(`RESULT ${cases.length - failures} PASS / ${failures} FAIL`);
  assert.equal(failures, 0, `${failures} tree/search scenarios failed`);
} finally { server.stop(); }
