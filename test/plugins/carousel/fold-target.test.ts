import {beforeAll,afterAll,expect,test} from 'bun:test';
import {setupDOM,teardownDOM} from '../../helpers/dom';
import {carouselEntries,carouselEntry} from '../../helpers/carousel-entry';
beforeAll(()=>setupDOM());afterAll(()=>teardownDOM());
for(const [entry,create] of carouselEntries) for(const direction of [1,-1]) for(const accumulated of [false,true]) {
 test(`${entry} ${direction>0?'next':'prev'} preserves ${accumulated?'multi-lap':'single-item'} pending target across a fold`,()=>{
  const f=carouselEntry(create);
  const navigate=f.list[direction>0?'next':'prev'] as (n:number,o:{behavior:string;duration:number})=>void;
  try {
   f.ctx.scroll.to(direction>0?1980:20);
   const count=accumulated?24:1;
   if(accumulated){navigate(12,{behavior:'smooth',duration:64});navigate(12,{behavior:'smooth',duration:64});}
   else navigate(1,{behavior:'smooth',duration:64});
   f.advance();
   // Both entries fold the running animation; extra laps collapse and the
   // logical item is what intendedVi retains. A tiny wheel catches that target.
   f.wheel(direction);
   const foldedCount=count%10;
   const start=1000+direction*foldedCount*100+direction;
   expect(f.list.getScrollPosition()).toBe(start);
   const positions:number[]=[];f.list.on('scroll',(e:{scrollPosition:number})=>positions.push(e.scrollPosition));
   navigate(1,{behavior:'smooth',duration:64});f.advance();
   const target=1000+direction*(foldedCount+1)*100;
   expect(f.list.getScrollPosition()).toBe(target);
   expect(positions.length).toBeGreaterThan(1);
   expect(positions.every(p=>p>=Math.min(start,target) && p<=Math.max(start,target))).toBe(true);
  } finally {f.destroy();}
 });
}

function paintOffsets(host:HTMLElement): {id:string|null;offset:number}[] {
 return [...host.querySelectorAll<HTMLElement>('[data-index]')].filter(el=>el.style.display!=='none').map(el=>{
  const t=el.style.transform.match(/translate[XY]\(([-\d.]+)px\)/);
  return {id:el.textContent,offset:t?parseFloat(t[1]!):NaN};
 });
}

for(const [entry,create] of carouselEntries) for(const isX of [false,true]) {
 test(`${entry}/${isX?'horizontal':'vertical'} snap from last to first folds without a lap-sized paint jump`,()=>{
  const f=carouselEntry(create,{variant:'full',snap:true,snapDuration:64},isX);
  try {
   f.list.scrollToIndex(9);
   const next=f.list.next as (n:number,o:{behavior:string;duration:number})=>void;
   next(1,{behavior:'smooth',duration:64});
   let prev=paintOffsets(f.host);
   let jump=0;
   for(let i=0;i<8;i++){
    f.step(1);
    const rows=paintOffsets(f.host);
    for(const row of rows){
     const old=prev.find(r=>r.id===row.id);
     if(old) jump=Math.max(jump,Math.abs(row.offset-old.offset));
    }
    prev=rows;
   }
   expect(f.state().index).toBe(0);
   expect(jump).toBeLessThan(200);
  } finally {f.destroy();}
 });
 test(`${entry}/${isX?'horizontal':'vertical'} 12 arrow presses land on item 2 without a lap-sized paint jump`,()=>{
  const f=carouselEntry(create,{variant:'full',snap:true,snapDuration:64},isX);
  try {
   f.list.scrollToIndex(0);
   const key=isX?'ArrowRight':'ArrowDown';
   let prev=paintOffsets(f.host);
   let jump=0;
   for(let i=0;i<12;i++){
    f.ctx.dom.content.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
    f.step(4); // ~64ms between presses
    const rows=paintOffsets(f.host);
    for(const row of rows){
     const old=prev.find(r=>r.id===row.id);
     if(old) jump=Math.max(jump,Math.abs(row.offset-old.offset));
    }
    prev=rows;
   }
   expect(f.state().index).toBe(2);
   expect(jump).toBeLessThan(200);
  } finally {f.destroy();}
 });
}
