import {beforeAll,afterAll,expect,test} from 'bun:test';
import {setupDOM,teardownDOM} from '../../helpers/dom';
import {carouselEntries,carouselEntry} from '../../helpers/carousel-entry';
beforeAll(()=>setupDOM());afterAll(()=>teardownDOM());
for(const [entry,create] of [carouselEntries[0]]) for(const direction of [1,-1]) for(const accumulated of [false,true]) {
 test(`${entry} ${direction>0?'next':'prev'} preserves ${accumulated?'multi-lap':'single-item'} pending target across a fold`,()=>{
  const f=carouselEntry(create);
  const navigate=f.list[direction>0?'next':'prev'] as (n:number,o:{behavior:string;duration:number})=>void;
  try {
   f.ctx.scrollTo(direction>0?89980:10020);
   const count=accumulated?24:1;
   if(accumulated){navigate(12,{behavior:'smooth',duration:64});navigate(12,{behavior:'smooth',duration:64});}
   else navigate(1,{behavior:'smooth',duration:64});
   f.advance();
   // Native smooth navigation may stay outside the threshold until input folds
   // it. Synthetic has already folded in its animation. Both retain intendedVi
   // until idle, so catch the animation target with a tiny wheel movement.
   f.wheel(direction);
   const foldedCount=entry==='native'?count%10:count;
   const start=50000+direction*foldedCount*100+direction;
   expect(f.list.getScrollPosition()).toBe(start);
   const positions:number[]=[];f.list.on('scroll',e=>positions.push(e.scrollPosition));
   navigate(1,{behavior:'smooth',duration:64});f.advance();
   const target=50000+direction*(foldedCount+1)*100;
   expect(f.list.getScrollPosition()).toBe(target);
   expect(positions.length).toBeGreaterThan(1);
   expect(positions.every(p=>p>=Math.min(start,target) && p<=Math.max(start,target))).toBe(true);
  } finally {f.destroy();}
 });
}
