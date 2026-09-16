import {beforeAll,afterAll,afterEach,expect,test} from 'bun:test';
import {setupDOM,teardownDOM,useFakeTimers} from '../../helpers/dom';
import {capturePrototypeGeometry} from '../../helpers/geometry';
import {createVList as native} from '../../../src/core/create';
import {createVList as synthetic} from '../../../src/synthetic';
import {sortable} from '../../../src/plugins/sortable/plugin';
import {selection} from '../../../src/plugins/selection/plugin';
import type {PluginContext} from '../../../src/core/types';
let dispose:(()=>void)|undefined;
beforeAll(()=>setupDOM());afterEach(()=>{dispose?.();dispose=undefined;});afterAll(()=>teardownDOM());
function fixture(create:typeof native,isX=false,handle=false,keyboard=false){
 const geometry=capturePrototypeGeometry();
 Object.defineProperty(HTMLElement.prototype,'clientWidth',{configurable:true,get:()=>400});
 Object.defineProperty(HTMLElement.prototype,'clientHeight',{configurable:true,get:()=>400});
 const raf=requestAnimationFrame,caf=cancelAnimationFrame,nowDescriptor=Object.getOwnPropertyDescriptor(performance,'now');
 const frames=new Map<number,FrameRequestCallback>();let id=0,clock=0;
 globalThis.requestAnimationFrame=fn=>{frames.set(++id,fn);return id;};globalThis.cancelAnimationFrame=id=>{frames.delete(id);};
 Object.defineProperty(performance,'now',{configurable:true,value:()=>clock});const timers=useFakeTimers();
 const host=document.createElement('div');document.body.append(host);let ctx!:PluginContext;let list:ReturnType<typeof native>|undefined;
 dispose=()=>{list?.destroy();timers.restore();host.remove();geometry.restore();geometry.assertRestored();globalThis.requestAnimationFrame=raf;globalThis.cancelAnimationFrame=caf;if(nowDescriptor)Object.defineProperty(performance,'now',nowDescriptor);else Reflect.deleteProperty(performance,'now');};
 list=create({container:host,orientation:isX?'horizontal':'vertical',items:Array.from({length:100},(_,id)=>({id})),item:{width:100,height:100,template:i=>'<span class="handle">Grip</span><span class="body">Item '+i.id+'</span>'}},[...(keyboard?[selection({mode:"single",focusOnClick:true})]:[]),sortable(handle?{handle:'.handle'}:{}),{name:'inspect',setup(c){ctx=c;}}]);
 ctx.dom.viewport.getBoundingClientRect=()=>new DOMRect(0,0,400,400);
 const ownCapture=new Set<number>();ctx.dom.content.hasPointerCapture=i=>ownCapture.has(i);ctx.dom.content.setPointerCapture=i=>{ownCapture.add(i);};ctx.dom.content.releasePointerCapture=i=>{ownCapture.delete(i);};
 const captures=new Set<number>();ctx.dom.viewport.hasPointerCapture=i=>captures.has(i);ctx.dom.viewport.setPointerCapture=i=>{captures.add(i);};ctx.dom.viewport.releasePointerCapture=i=>{captures.delete(i);};
 function advance(ms:number){for(let elapsed=0;elapsed<ms;elapsed+=16){const dt=Math.min(16,ms-elapsed);clock+=dt;timers.tick(dt);const pending=[...frames.values()];frames.clear();for(const fn of pending)fn(clock);}}
 list.scrollToIndex(10);advance(200);
 const item=host.querySelector<HTMLElement>('[data-index="12"]')!;item.getBoundingClientRect=()=>new DOMRect(isX?200:0,isX?0:200,isX?100:400,isX?400:100);
 const events:{name:string;data:any}[]=[];for(const name of ['sort:start','sort:move','sort:end','sort:cancel'] as const)list.on(name,e=>events.push({name,data:e}));
 function pointer(type:string,main=250,kind='touch',target:EventTarget|undefined=undefined,pointerId=1){const e=new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:kind,pointerId,isPrimary:pointerId===1,button:0,clientX:isX?main:50,clientY:isX?50:main});Object.defineProperty(e,'timeStamp',{value:clock});(target??(ownCapture.has(pointerId)?ctx.dom.content:item.querySelector(handle?'.handle':'.body')??ctx.dom.content)).dispatchEvent(e);return e;}
 return {list,ctx,item,host,events,pointer,advance,captures};
}
for(const [entry,create] of [['native',native],['synthetic',synthetic]] as const)for(const isX of [false,true]){
 const name=`${entry}/${isX?'x':'y'}`;
 test(`${name} keyboard reordering remains available`,()=>{
  const f=fixture(create,isX,false,true);(f.ctx.hooks.get('_focusById') as Function)(12);
  const key=(key:string)=>f.ctx.dom.root.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
  key(' ');expect((f.list.isSorting as ()=>boolean)()).toBe(true);key(isX?'ArrowRight':'ArrowDown');key(' ');
  expect((f.list.isSorting as ()=>boolean)()).toBe(false);expect(f.events.filter(e=>e.name==='sort:start')).toHaveLength(1);expect(f.events.filter(e=>e.name==='sort:end').map(e=>e.data)).toEqual([{fromIndex:12,toIndex:13}]);
 });
 test(`${name} mouse keeps threshold and horizontal drop has no double scroll offset`,()=>{
  const f=fixture(create,isX);f.pointer('pointerdown',250,'mouse');f.pointer('pointermove',252,'mouse');expect(f.events).toHaveLength(0);
  f.pointer('pointermove',370,'mouse');expect(f.events.filter(e=>e.name==='sort:start')).toHaveLength(1);f.pointer('pointerup',370,'mouse');f.advance(250);
  expect(f.events.find(e=>e.name==='sort:end')?.data.toIndex).toBe(13);
 });
 for(const kind of ['touch','pen'])test(`${name} ${kind} long press claims once without moving or flinging the list`,()=>{
  const f=fixture(create,isX);f.pointer('pointerdown',250,kind);f.advance(349);expect(f.events).toHaveLength(0);f.advance(1);expect(f.events.filter(e=>e.name==='sort:start')).toHaveLength(1);
  f.pointer('pointermove',320,kind);expect(f.list.getScrollPosition()).toBe(1000);expect(f.captures.size).toBe(0);f.pointer('pointerup',320,kind);f.advance(500);expect(f.list.getScrollPosition()).toBe(1000);
  expect(f.events.filter(e=>e.name==='sort:start')).toHaveLength(1);expect(f.events.filter(e=>e.name==='sort:end')).toHaveLength(1);
 });
 test(`${name} early move abandons the press`,()=>{const f=fixture(create,isX);f.pointer('pointerdown');f.pointer('pointermove',220);f.advance(400);expect(f.events).toHaveLength(0);if(entry==='synthetic')expect(f.list.getScrollPosition()).toBe(1030);f.pointer('pointerup',220);});
 test(`${name} handle claims at threshold without a delay`,()=>{const f=fixture(create,isX,true);f.pointer('pointerdown');f.pointer('pointermove',270);expect(f.events.filter(e=>e.name==='sort:start')).toHaveLength(1);expect(f.list.getScrollPosition()).toBe(1000);f.pointer('pointerup',270);f.advance(250);});
 test(`${name} outside handle does not arm`,()=>{const f=fixture(create,isX,true);const target=f.item.querySelector('.body')!;f.pointer('pointerdown',250,'touch',target);f.advance(400);f.pointer('pointermove',220,'touch',target);expect(f.events).toHaveLength(0);if(entry==='synthetic')expect(f.list.getScrollPosition()).toBe(1030);f.pointer('pointerup',220,'touch',target);});
 test(`${name} touch returns from edge auto-scroll and drops without needing another move`,()=>{
  const f=fixture(create,isX);f.pointer('pointerdown');f.advance(350);f.pointer('pointermove',430);f.advance(80);f.pointer('pointermove',435);f.advance(80);expect(f.list.getScrollPosition()).toBeGreaterThan(1000);
  f.pointer('pointermove',300);f.advance(32);const target=Math.floor((f.list.getScrollPosition()+300)/100);f.pointer('pointerup',300);f.advance(250);
  expect(f.events.filter(e=>e.name==='sort:end').map(e=>e.data.toIndex)).toEqual([target]);
 });
 for(const claimed of [false,true])test(`${name} second finger cancels ${claimed?'claimed':'pending'} press once`,()=>{
  const f=fixture(create,isX);f.pointer('pointerdown');if(claimed)f.advance(350);f.pointer('pointerdown',270,'touch',document.body,2);f.advance(500);
  expect(f.events.filter(e=>e.name==='sort:start')).toHaveLength(claimed?1:0);expect(f.events.filter(e=>e.name==='sort:cancel')).toHaveLength(claimed?1:0);
  f.pointer('pointerup',270,'touch',document.body,2);f.pointer('pointerup');
 });
 test(`${name} recycled original touch target still prevents panning and releases its listener`,()=>{
  const f=fixture(create,isX);const target=f.item.querySelector('.body')!;f.pointer('pointerdown',250,'touch',target);f.advance(350);target.remove();
  const move=new TouchEvent('touchmove',{bubbles:true,cancelable:true});target.dispatchEvent(move);expect(move.defaultPrevented).toBe(true);
  f.pointer('pointerup',250,'touch',f.ctx.dom.content);f.advance(250);
  const idleMove=new TouchEvent('touchmove',{bubbles:true,cancelable:true});target.dispatchEvent(idleMove);expect(idleMove.defaultPrevented).toBe(false);
 });
 test(`${name} claim blocks cross-axis touch panning, releases capture and allows a later click`,()=>{
  const f=fixture(create,isX);f.pointer('pointerdown');f.advance(350);
  const move=new TouchEvent('touchmove',{bubbles:true,cancelable:true});f.item.dispatchEvent(move);expect(move.defaultPrevented).toBe(true);
  f.pointer('pointermove',320);f.pointer('pointerup',320);f.advance(250);
  let clicks=0;f.host.addEventListener('click',()=>clicks++);f.pointer('pointerdown');f.pointer('pointerup');f.item.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));expect(clicks).toBe(1);
 });
 if(entry==='synthetic')test(`${name} auto-scroll origin changes do not animate the whole rendered list`,()=>{
  const f=fixture(create,isX);f.pointer('pointerdown');f.advance(350);f.pointer('pointermove',320);
  expect([...f.ctx.dom.content.children].some(el=>(el as HTMLElement).style.transition.includes('transform'))).toBe(true);
  f.ctx.scroll.to(1040);
  expect([...f.ctx.dom.content.children].every(el=>(el as HTMLElement).style.transition==='')).toBe(true);
  f.pointer('pointerup',320);
 });
 if(entry==='synthetic')test(`${name} a contact catches actual inertia and cannot arm a long press`,()=>{
  const f=fixture(create,isX);f.pointer('pointerdown');f.advance(16);f.pointer('pointermove',220);f.pointer('pointerup',220);f.advance(48);
  expect(f.list.getScrollPosition()).toBeGreaterThan(1030);const caught=f.list.getScrollPosition();f.pointer('pointerdown',220);f.advance(400);
  expect(f.list.getScrollPosition()).toBe(caught);expect(f.events).toHaveLength(0);f.pointer('pointerup',220);
 });
 test(`${name} press during smooth movement catches motion without arming a hold`,()=>{
  const f=fixture(create,isX);f.ctx.scroll.smoothTo(1500,500);f.advance(32);const pos=f.list.getScrollPosition();f.pointer('pointerdown');
  if(entry==='native')f.ctx.scroll.cancel(); // Native momentum is stopped by the browser's touch contact.
  f.advance(400);expect(f.events).toHaveLength(0);if(entry==='synthetic')expect(f.list.getScrollPosition()).toBe(pos);f.pointer('pointerup');
 });
 for(const claimed of [false,true])test(`${name} cancel ${claimed?'claimed':'pending'} press`,()=>{const f=fixture(create,isX);f.pointer('pointerdown');if(claimed)f.advance(350);f.pointer('pointercancel');f.advance(500);expect(f.events.filter(e=>e.name==='sort:start')).toHaveLength(claimed?1:0);expect(f.events.filter(e=>e.name==='sort:cancel')).toHaveLength(claimed?1:0);expect((f.list.isSorting as ()=>boolean)()).toBe(false);});
}
