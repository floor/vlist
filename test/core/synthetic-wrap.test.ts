import {afterAll, afterEach, beforeAll, expect, test} from "bun:test";
import {setupDOM, teardownDOM, useFakeTimers} from "../helpers/dom";
import {createEngineState} from "../../src/core/state";
import {createSizeCache} from "../../src/core/sizes";
import {createSyntheticScrollHandler} from "../../src/synthetic/handler";

let savedRaf: typeof requestAnimationFrame, savedCancel: typeof cancelAnimationFrame;
const frames = new Map<number, FrameRequestCallback>(); let id = 0;
let cleanup: (() => void) | undefined;
beforeAll(() => {
  setupDOM(); savedRaf = requestAnimationFrame; savedCancel = cancelAnimationFrame;
  globalThis.requestAnimationFrame = fn => {frames.set(++id, fn); return id;};
  globalThis.cancelAnimationFrame = key => {frames.delete(key);};
});
afterEach(() => {cleanup?.(); cleanup = undefined; frames.clear();});
afterAll(() => {globalThis.requestAnimationFrame=savedRaf;globalThis.cancelAnimationFrame=savedCancel;teardownDOM();});
function frame(time: number) {const callbacks=[...frames.values()];frames.clear();for(const fn of callbacks)fn(time);}
function fixture(wrap = true, isX = false) {
  const root=document.createElement("div"),viewport=document.createElement("div"),content=document.createElement("div");
  root.append(viewport);viewport.append(content);document.body.append(root);
  const captured = new Set<number>();
  viewport.hasPointerCapture = id=>captured.has(id);viewport.setPointerCapture=id=>{captured.add(id);};viewport.releasePointerCapture=id=>{captured.delete(id);};
  Object.defineProperty(viewport,isX?"scrollLeft":"scrollTop",{get:()=>0,set:()=>{throw Error("native main-axis write");}});
  const state=createEngineState(20);state.containerSize=500;state.crossSize=300;state.totalItems=2020;
  const sizeCache=createSizeCache(50,2020);
  const samples: {position:number;previous:number;direction:number}[]=[];
  const timers=useFakeTimers();let idle=0;
  const handler=createSyntheticScrollHandler({state,viewport,content,isX,sizeCache,wheelEnabled:true,idleTimeout:150,mainAxisPadding:0,
    ...(wrap?{wrap:{lapSize:()=>1000,itemsPerLap:()=>20,home:()=>50000,thresholdLaps:40}}:{}),
    onFrame(){samples.push({position:state.scrollPosition,previous:state.prevScrollPosition,direction:state.scrollDirection});},onIdle(){idle++;},
  });
  handler.attach();handler.refresh(101000);samples.length=0;
  cleanup=()=>{handler.detach();timers.restore();root.remove();};
  function pointer(type:string,main:number,time:number) {
    const e=new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:"touch",pointerId:1,isPrimary:true,clientX:isX?main:10,clientY:isX?10:main});
    Object.defineProperty(e,"timeStamp",{value:time});(type==="pointerup"?window:viewport).dispatchEvent(e);
  }
  return {handler,state,samples,pointer,timers,get idle(){return idle;}};
}
for (const isX of [false,true]) {
  test(`wrap ${isX?"x":"y"}: drag crosses a fold once and continues in the same direction`,()=>{
    const f=fixture(true,isX);f.handler.setLogical(89980);f.samples.length=0;
    f.pointer("pointerdown",200,0);f.pointer("pointermove",160,16);
    expect(f.samples).toEqual([{position:50020,previous:49980,direction:1}]);
    f.pointer("pointermove",140,32);
    expect(f.state.scrollPosition).toBe(50040);expect(f.state.scrollDirection).toBe(1);expect(f.samples).toHaveLength(2);
  });
}
test("reverse drag keeps negative direction across the lower fold",()=>{
  const f=fixture();f.handler.setLogical(10020);f.samples.length=0;
  f.pointer("pointerdown",100,0);f.pointer("pointermove",140,16);
  expect(f.samples).toEqual([{position:49980,previous:50020,direction:-1}]);
  f.pointer("pointermove",160,32);expect(f.state.scrollPosition).toBe(49960);
});
test("inertia survives a fold and renders only once per frame",()=>{
  const f=fixture();f.handler.setLogical(89930);
  f.pointer("pointerdown",200,0);f.pointer("pointermove",160,16);f.pointer("pointerup",160,16);
  f.samples.length=0;frame(0);frame(16);frame(32);
  expect(f.state.scrollPosition).toBeGreaterThan(50000);expect(f.state.scrollPosition).toBeLessThan(50100);
  expect(f.samples).toHaveLength(2);expect(f.state.scrollDirection).toBe(1);
  const position=f.state.scrollPosition;frame(48);expect(f.state.scrollPosition).toBeGreaterThan(position);
  expect(frames.size).toBe(1);
});
test("smooth target and animation origin shift together across a fold",()=>{
  const f=fixture();f.handler.setLogical(89980);let complete=0;f.samples.length=0;
  f.handler.smoothScrollTo(90080,64,undefined,t=>t,()=>complete++);
  frame(0);frame(16);
  expect(f.samples).toEqual([{position:50005,previous:49980,direction:1}]);
  frame(32);expect(f.state.scrollPosition).toBe(50030);
  frame(48);frame(64);expect(f.state.scrollPosition).toBe(50080);expect(complete).toBe(1);
  expect(f.samples).toHaveLength(4);f.timers.tick(150);expect(f.idle).toBe(1);
});
test("without wrap, the same range never folds and clamps at the edge",()=>{
  const f=fixture(false);f.handler.setLogical(89980);
  f.pointer("pointerdown",200,0);f.pointer("pointermove",160,16);
  expect(f.state.scrollPosition).toBe(90020);expect(f.state.scrollDirection).toBe(1);
  f.handler.setLogical(200000);expect(f.state.scrollPosition).toBe(100500);
});

test("jump folding back to the current position commits exactly once",()=>{
 const f=fixture();f.handler.setLogical(50000);f.samples.length=0;
 f.handler.setLogical(90000);
 expect(f.samples).toEqual([{position:50000,previous:10000,direction:1}]);
});
