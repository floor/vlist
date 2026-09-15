import {beforeAll,afterAll,expect,test} from 'bun:test';
import {setupDOM,teardownDOM} from '../helpers/dom';
import {capturePrototypeGeometry} from '../helpers/geometry';
import {createVList as native} from '../../src/core/create';
import {createVList as synthetic} from '../../src/synthetic';
import {createStats} from '../../src/utils/stats';
let geometry:ReturnType<typeof capturePrototypeGeometry>,raf:typeof requestAnimationFrame,caf:typeof cancelAnimationFrame;
beforeAll(()=>{
 setupDOM();geometry=capturePrototypeGeometry();raf=requestAnimationFrame;caf=cancelAnimationFrame;
 for(const key of ['clientWidth','clientHeight'])Object.defineProperty(HTMLElement.prototype,key,{configurable:true,get:()=>480});
 globalThis.requestAnimationFrame=()=>0;globalThis.cancelAnimationFrame=()=>{};
});
afterAll(()=>{geometry.restore();geometry.assertRestored();globalThis.requestAnimationFrame=raf;globalThis.cancelAnimationFrame=caf;teardownDOM();});
for(const [entry,create,total] of [['native',native,1000],['synthetic',synthetic,1000000]] as const)for(const orientation of ['vertical','horizontal'] as const){
 test(`${entry}/${orientation}: stats use real offsets at start, middle and end`,()=>{
  const host=document.createElement('div');document.body.append(host);
  const items=Array.from({length:total},(_,id)=>({id}));
  const list=create({container:host,orientation,items,item:{height:48,width:48,template:i=>String(i.id)}});
  const stats=createStats({getScrollPosition:list.getScrollPosition,getTotal:()=>list.total,getItemSize:()=>48,getContainerSize:()=>480});
  try {
   const states=[];
   for(const index of [0,(total-10)/2,total-10]){list.scrollToIndex(index);const {itemCount,progress}=stats.getState();states.push({position:list.getScrollPosition(),itemCount,progress});}
   expect(states).toEqual([
    {position:0,itemCount:10,progress:10/total*100},
    {position:(total*48-480)/2,itemCount:total/2+5,progress:(total/2+5)/total*100},
    {position:total*48-480,itemCount:total,progress:100},
   ]);
  }finally{list.destroy();host.remove();}
 });
}
test('native browser-limited position is not expanded to the declared end',()=>{
 const position=16000000-480;
 const stats=createStats({getScrollPosition:()=>position,getTotal:()=>1000000,getItemSize:()=>48,getContainerSize:()=>480});
 expect(stats.getState().itemCount).toBe(333334);expect(stats.getState().progress).toBeCloseTo(33.3334,6);
});
test('elastic overscroll is bounded by real start and end geometry',()=>{
 let position=-480;const stats=createStats({getScrollPosition:()=>position,getTotal:()=>1000,getItemSize:()=>48,getContainerSize:()=>480});
 expect(stats.getState().itemCount).toBe(10);expect(stats.getState().progress).toBe(1);
 position=100000;expect(stats.getState().itemCount).toBe(1000);expect(stats.getState().progress).toBe(100);
});
