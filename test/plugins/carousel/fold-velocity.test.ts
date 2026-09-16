import {afterAll,afterEach,beforeAll,expect,test} from "bun:test";
import {setupDOM,teardownDOM,useFakeTimers} from "../../helpers/dom";
import {capturePrototypeGeometry} from "../../helpers/geometry";
import {createVList} from "../../../src/core/create";
import {createVList as createSynthetic} from "../../../src/synthetic";
import {carousel} from "../../../src/plugins/carousel/plugin";
import type {CarouselMethods} from "../../../src/plugins/carousel/plugin";
import type {PluginContext} from "../../../src/core/types";
let geometry:ReturnType<typeof capturePrototypeGeometry>;
let nowDescriptor:PropertyDescriptor|undefined;let clock=0;
let raf:typeof requestAnimationFrame,caf:typeof cancelAnimationFrame;
const frames=new Map<number,FrameRequestCallback>();let nextFrame=0;
let cleanup:(()=>void)|undefined;
beforeAll(()=>{
 setupDOM();geometry=capturePrototypeGeometry();
 Object.defineProperty(HTMLElement.prototype,"clientHeight",{configurable:true,get:()=>500});
 Object.defineProperty(HTMLElement.prototype,"clientWidth",{configurable:true,get:()=>300});
 nowDescriptor=Object.getOwnPropertyDescriptor(performance,"now");Object.defineProperty(performance,"now",{configurable:true,value:()=>clock});
 raf=requestAnimationFrame;caf=cancelAnimationFrame;globalThis.requestAnimationFrame=fn=>{frames.set(++nextFrame,fn);return nextFrame;};globalThis.cancelAnimationFrame=id=>{frames.delete(id);};
});
afterEach(()=>{cleanup?.();cleanup=undefined;clock=0;frames.clear();});
afterAll(()=>{geometry.restore();if(nowDescriptor)Object.defineProperty(performance,"now",nowDescriptor);else Reflect.deleteProperty(performance,"now");globalThis.requestAnimationFrame=raf;globalThis.cancelAnimationFrame=caf;teardownDOM();});
afterAll(()=>geometry.assertRestored());
function fixture(create=createVList,snap=false){
 const host=document.createElement("div");document.body.append(host);let ctx!:PluginContext<{id:number}>;
 // `create` arrives as a value, so plugin methods are not inferred here.
 const list=create({container:host,items:Array.from({length:10},(_,id)=>({id})),item:{height:100,template:()=>""}},[carousel({variant:"free",snap,snapDuration:64}),{name:"inspect",setup(value){ctx=value;}}]) as ReturnType<typeof create> & CarouselMethods;
 const captured=new Set<number>();let pointerY=100000;let started=false;
 ctx.dom.viewport.hasPointerCapture=id=>captured.has(id);ctx.dom.viewport.setPointerCapture=id=>{captured.add(id);};ctx.dom.viewport.releasePointerCapture=id=>{captured.delete(id);};
 function pointer(type:string,time:number){const e=new PointerEvent(type,{pointerType:"touch",pointerId:1,isPrimary:true,bubbles:true,cancelable:true,clientY:pointerY});Object.defineProperty(e,"timeStamp",{value:time});ctx.dom.viewport.dispatchEvent(e);}
 const velocities:number[]=[],positions:number[]=[];
 list.on("velocity:change",(e:{velocity:number})=>velocities.push(e.velocity));list.on("scroll",(e:{scrollPosition:number})=>positions.push(e.scrollPosition));
 cleanup=()=>{list.destroy();host.remove();};
 return {list,ctx,velocities,positions,move(delta:number,native=false){clock+=16;if(native){if(create===createSynthetic){if(!started){pointer("pointerdown",clock-16);started=true;}pointerY-=delta;pointer("pointermove",clock);}else{ctx.dom.viewport.scrollTop+=delta;ctx.dom.viewport.dispatchEvent(new Event("scroll"));}}else ctx.dom.viewport.dispatchEvent(new WheelEvent("wheel",{deltaY:delta,cancelable:true}));}};
}
for(const [entry,create] of [["native",createVList],["synthetic",createSynthetic]] as const) for(const native of [false,true]) test(`${entry} carousel ${native?"drag":"wheel"}: fold does not spike public velocity`,()=>{
 const f=fixture(create);clock=200;f.ctx.scroll.to(89960);f.move(10,native);f.move(10,native);f.move(30,native);f.move(10,native);
 expect(f.list.getScrollPosition()).toBe(50020);
 expect(f.velocities.slice(-4)).toEqual([10/16,10/16,30/16,10/16]);
 expect(f.positions.slice(-2)).toEqual([50010,50020]);
});
for(const [entry,create] of [["native",createVList],["synthetic",createSynthetic]] as const) test(`${entry}: a fold landing on the last emitted position still emits a scroll event`,()=>{
 const f=fixture(create);clock=200;f.ctx.scroll.to(50000);f.positions.length=0;
 f.move(40000,true);
 expect(f.list.getScrollPosition()).toBe(50000);expect(f.positions).toEqual([50000]);
});

test("synthetic idle snap after a forward fold chooses the next item",()=>{
 const timers=useFakeTimers();const f=fixture(createSynthetic,true);const destroy=cleanup;cleanup=()=>{destroy?.();timers.restore();};
 clock=200;f.ctx.scroll.to(89980);f.move(40);
 expect(f.list.getScrollPosition()).toBe(50020);
 timers.tick(150);
 for(let i=0;i<=4;i++){const pending=[...frames.values()];frames.clear();for(const fn of pending)fn(clock);clock+=16;}
 expect(f.list.getScrollPosition()).toBe(50100);expect(f.list.getCarouselState().index).toBe(1);
});
