import { createVList as native } from '../../src/core/create';
import { createVList as synthetic } from '../../src/synthetic';
import { carousel } from '../../src/plugins/carousel/plugin';
import type { CarouselMethods, CarouselPluginConfig, CarouselState } from '../../src/plugins/carousel/plugin';
import type { PluginContext } from '../../src/core/types';
import { capturePrototypeGeometry } from './geometry';

export const carouselEntries = [['native', native], ['synthetic', synthetic]] as const;
/** Real entry fixture; restore every descriptor and frame callback on disposal. */
export function carouselEntry(create: typeof native, options: CarouselPluginConfig = {}, isX = false) {
 const geometry = capturePrototypeGeometry();
 Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable:true, get:()=>400 });
 Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable:true, get:()=>400 });
 const raf=globalThis.requestAnimationFrame, caf=globalThis.cancelAnimationFrame;
 const frames=new Map<number,FrameRequestCallback>();let next=0,time=performance.now();
 const nowDescriptor=Object.getOwnPropertyDescriptor(performance,"now");
 Object.defineProperty(performance,"now",{configurable:true,value:()=>time});
 globalThis.requestAnimationFrame=fn=>{frames.set(++next,fn);return next;};
 globalThis.cancelAnimationFrame=id=>{frames.delete(id);};
 const host=document.createElement('div');document.body.append(host);let ctx!:PluginContext<{id:number}>;
 // The entry factories are passed in as values, so the plugin methods are not
 // inferred here: name them explicitly for the fixture's callers.
 const list=create({container:host,orientation:isX?'horizontal':'vertical',items:Array.from({length:10},(_,id)=>({id})),item:{height:100,width:100,template:item=>String(item.id)}},[
  carousel({variant:'free',snap:false,snapDuration:64,...options}),{name:'inspect-carousel',setup(value){ctx=value;}},
 ]) as ReturnType<typeof create> & CarouselMethods;
 return {host,list,ctx,state:():CarouselState=>list.getCarouselState(),
  advance(){for(let i=0;i<12;i++){time+=16;const pending=[...frames.values()];frames.clear();for(const fn of pending)fn(time);}},
  wheel(delta:number){ctx.dom.viewport.dispatchEvent(new WheelEvent('wheel',{deltaX:isX?delta:0,deltaY:isX?0:delta,cancelable:true}));},
  destroy(){list.destroy();host.remove();frames.clear();globalThis.requestAnimationFrame=raf;globalThis.cancelAnimationFrame=caf;if(nowDescriptor)Object.defineProperty(performance,"now",nowDescriptor);else Reflect.deleteProperty(performance,"now");geometry.restore();geometry.assertRestored();},
 };
}
