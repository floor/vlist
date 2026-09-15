import {afterAll,afterEach,beforeAll,expect,test} from "bun:test";
import {setupDOM,teardownDOM} from "../../helpers/dom";
import {capturePrototypeGeometry} from "../../helpers/geometry";
import {createVList} from "../../../src/core/create";
import {carousel} from "../../../src/plugins/carousel/plugin";
import type {PluginContext} from "../../../src/core/types";
let geometry:ReturnType<typeof capturePrototypeGeometry>;
let nowDescriptor:PropertyDescriptor|undefined;let clock=0;
let raf:typeof requestAnimationFrame,caf:typeof cancelAnimationFrame;
let cleanup:(()=>void)|undefined;
beforeAll(()=>{
 setupDOM();geometry=capturePrototypeGeometry();
 Object.defineProperty(HTMLElement.prototype,"clientHeight",{configurable:true,get:()=>500});
 Object.defineProperty(HTMLElement.prototype,"clientWidth",{configurable:true,get:()=>300});
 nowDescriptor=Object.getOwnPropertyDescriptor(performance,"now");Object.defineProperty(performance,"now",{configurable:true,value:()=>clock});
 raf=requestAnimationFrame;caf=cancelAnimationFrame;globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
});
afterEach(()=>{cleanup?.();cleanup=undefined;clock=0;});
afterAll(()=>{geometry.restore();if(nowDescriptor)Object.defineProperty(performance,"now",nowDescriptor);else Reflect.deleteProperty(performance,"now");globalThis.requestAnimationFrame=raf;globalThis.cancelAnimationFrame=caf;teardownDOM();});
afterAll(()=>geometry.assertRestored());
function fixture(){
 const host=document.createElement("div");document.body.append(host);let ctx!:PluginContext;
 const list=createVList({container:host,items:Array.from({length:10},(_,id)=>({id})),item:{height:100,template:()=>""}},[carousel({variant:"free",snap:false}),{name:"inspect",setup(value){ctx=value;}}]);
 const velocities:number[]=[],positions:number[]=[];
 list.on("velocity:change",e=>velocities.push(e.velocity));list.on("scroll",e=>positions.push(e.scrollPosition));
 cleanup=()=>{list.destroy();host.remove();};
 return {list,ctx,velocities,positions,move(delta:number,native=false){clock+=16;if(native){ctx.dom.viewport.scrollTop+=delta;ctx.dom.viewport.dispatchEvent(new Event("scroll"));}else ctx.dom.viewport.dispatchEvent(new WheelEvent("wheel",{deltaY:delta,cancelable:true}));}};
}
for(const native of [false,true]) test(`native carousel ${native?"drag":"wheel"}: fold does not spike public velocity`,()=>{
 const f=fixture();clock=200;f.ctx.scrollTo(89960);f.move(10,native);f.move(10,native);f.move(30,native);f.move(10,native);
 expect(f.list.getScrollPosition()).toBe(50020);
 expect(f.velocities.slice(-4)).toEqual([10/16,10/16,30/16,10/16]);
 expect(f.positions.slice(-2)).toEqual([50010,50020]);
});
test("a fold landing on the last emitted position still emits a scroll event",()=>{
 const f=fixture();clock=200;f.ctx.scrollTo(50000);f.positions.length=0;
 f.move(40000,true);
 expect(f.list.getScrollPosition()).toBe(50000);expect(f.positions).toEqual([50000]);
});
