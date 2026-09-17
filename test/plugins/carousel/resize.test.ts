import {afterAll, beforeAll, beforeEach, expect, test as baseTest} from 'bun:test';
import {setupDOM, teardownDOM} from '../../helpers/dom';
import {createVList as createNative} from '../../../src/core/create';
import {createVList as createSynthetic} from '../../../src/synthetic';
import {carousel} from '../../../src/plugins/carousel/plugin';
import type {PluginContext} from '../../../src/core/types';
import type {CarouselMethods, CarouselState} from '../../../src/plugins/carousel/plugin';

/**
 * Serial: `width`/`height` are read through `HTMLElement.prototype` getters, and
 * the mocked ResizeObserver and rAF queue below each hold a single callback for
 * the whole process. Interleaving these tests under `bun test --concurrent`
 * would have one variant resize and frame another's list.
 */
const test = baseTest.serial;

let width=400, height=250;
let observer: ResizeObserverCallback;
let observed: Element;
let savedObserver: typeof ResizeObserver;
let savedRaf: typeof requestAnimationFrame, savedCancel: typeof cancelAnimationFrame;
let widthDescriptor: PropertyDescriptor | undefined, heightDescriptor: PropertyDescriptor | undefined;
const frames=new Map<number,FrameRequestCallback>();let next=0;
beforeAll(()=>{
 setupDOM();savedObserver=globalThis.ResizeObserver;savedRaf=globalThis.requestAnimationFrame;savedCancel=globalThis.cancelAnimationFrame;
 widthDescriptor=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'clientWidth');heightDescriptor=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'clientHeight');
 Object.defineProperty(HTMLElement.prototype,'clientWidth',{configurable:true,get:()=>width});
 Object.defineProperty(HTMLElement.prototype,'clientHeight',{configurable:true,get:()=>height});
 globalThis.ResizeObserver=class {constructor(callback:ResizeObserverCallback){observer=callback;}observe(target:Element){observed=target;}unobserve(){}disconnect(){}};
 globalThis.requestAnimationFrame=fn=>{frames.set(++next,fn);return next;};globalThis.cancelAnimationFrame=id=>{frames.delete(id);};
});
afterAll(()=>{
 globalThis.ResizeObserver=savedObserver;globalThis.requestAnimationFrame=savedRaf;globalThis.cancelAnimationFrame=savedCancel;
 if(widthDescriptor)Object.defineProperty(HTMLElement.prototype,'clientWidth',widthDescriptor);else delete (HTMLElement.prototype as any).clientWidth;
 if(heightDescriptor)Object.defineProperty(HTMLElement.prototype,'clientHeight',heightDescriptor);else delete (HTMLElement.prototype as any).clientHeight;
 teardownDOM();
});
beforeEach(()=>{width=400;height=250;frames.clear();});
function frame(){const pending=[...frames.values()];frames.clear();for(const fn of pending)fn(performance.now());}
function resize(w:number,h:number){width=w;height=h;observer([{target:observed,contentRect:{width,height}} as ResizeObserverEntry],{} as ResizeObserver);}

for(const [entry,createVList] of [['native',createNative],['synthetic',createSynthetic]] as const) for(const orientation of ['horizontal','vertical'] as const) for(const variant of ['full','hero','multi'] as const) {
 test(`${entry}/${orientation}/${variant}: main-axis resize updates slots, preserves focal index and still wraps`,async()=>{
  const isX=orientation==='horizontal';if(!isX){width=250;height=400;}
  const sizeProp=isX?'width':'height';
  const host=document.createElement('div');document.body.append(host);
  let ctx!:PluginContext<{id:number}>;
  const list=createVList({container:host,orientation,items:Array.from({length:10},(_,id)=>({id})),item:{width:200,height:200,template:()=>''}},[carousel({variant,initialIndex:3,peek:'20%'}),{name:'inspect',setup(value){ctx=value;}}]) as ReturnType<typeof createVList> & CarouselMethods;
  const state=():CarouselState=>list.getCarouselState();
  const focal=()=>[...host.querySelectorAll<HTMLElement>('[data-index]')].find(el=>el.style.getPropertyValue('--vlist-carousel-offset')==='0')!;
  try {
   frame();await Bun.sleep(1);
   expect(state().index).toBe(3);
   const initialWidth=variant==='full'?400:variant==='hero'?320:160;
   expect(focal().style[sizeProp]).toBe(`${initialWidth}px`);
   // Resize immediately after crossing the fold at real index 3.
   ctx.scroll.to(initialWidth*899);
   ctx.dom.viewport.dispatchEvent(new WheelEvent('wheel',{deltaX:isX?initialWidth*4:0,deltaY:isX?0:initialWidth*4,cancelable:true}));
   expect(state().index).toBe(3);
   const position=list.getScrollPosition(),transform=focal().style.transform;
   if(isX)resize(400,350);else resize(350,400);
   expect(focal().style[sizeProp]).toBe(`${initialWidth}px`);expect(focal().style.transform).toBe(transform);expect(list.getScrollPosition()).toBe(position);
   if(isX)resize(800,350);else resize(350,800);
   expect(focal().style[sizeProp]).toBe(`${initialWidth*2}px`);expect(state().index).toBe(3);
   expect(state().scrollPosition).toBe(initialWidth*2*3);
   list.scrollToIndex(9);list.next(1,{behavior:'auto'});
   expect(state().index).toBe(0);expect(focal().style[sizeProp]).toBe(`${initialWidth*2}px`);
   list.prev(1,{behavior:'auto'});
   expect(state().index).toBe(9);expect(focal().style[sizeProp]).toBe(`${initialWidth*2}px`);
  } finally {list.destroy();host.remove();frames.clear();}
 });
}
