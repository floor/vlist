import {test, expect, beforeAll, afterAll, afterEach} from 'bun:test';
import {setupDOM,teardownDOM} from '../../helpers/dom';
import {createScrollbar,type Scrollbar} from '../../../src/plugins/scrollbar/scrollbar';
import {createSizeCache} from '../../../src/rendering/sizes';
beforeAll(setupDOM);afterAll(teardownDOM);
let sb: Scrollbar | undefined;
afterEach(()=>{sb?.destroy();sb=undefined;document.body.innerHTML='';});
function pointer(target: HTMLElement,type:string,x:number,y:number) {
 target.dispatchEvent(new PointerEvent(type,{pointerId:1,button:0,clientX:x,clientY:y,bubbles:true,cancelable:true}));
}
for(const isX of [false,true])test(`${isX?'horizontal':'vertical'}: 20M rows keep logical keyboard, pointer and thumb math`,()=>{
 const host=document.createElement('div'), viewport=document.createElement('div');host.append(viewport);document.body.append(host);
 for(const name of ['scrollTop','scrollLeft'])Object.defineProperty(viewport,name,{get:()=>0,set:()=>{throw new Error('native offset write');}});
 const cache=createSizeCache(50,20_000_000),positions:number[]=[];
 sb=createScrollbar(viewport,position=>{positions.push(position);sb!.updatePosition(position);},{platform:'windows',minThumbSize:15},'vlist',isX,host,()=>cache,host);
 sb.updateBounds(cache.getTotalSize(),500);
 const track=host.querySelector<HTMLElement>('.vlist-scrollbar')!,thumb=track.firstElementChild as HTMLElement;
 expect(thumb.style[isX?'width':'height']).toBe('15px');expect(track.getAttribute('aria-valuemax')).toBe('999999500');expect(track.getAttribute('aria-orientation')).toBe(isX?'horizontal':'vertical');
 track.focus();
 for(const [key,expected] of [[isX?'ArrowRight':'ArrowDown',50],[isX?'ArrowLeft':'ArrowUp',0],['PageDown',500],['PageUp',0],['End',999999500],['Home',0]] as const){
  track.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));expect(positions[positions.length-1]).toBe(expected);
 }
 let captured=false;thumb.setPointerCapture=()=>{captured=true;};thumb.hasPointerCapture=()=>captured;thumb.releasePointerCapture=()=>{captured=false;};
 pointer(thumb,'pointerdown',0,0);pointer(thumb,'pointermove',isX?481:0,isX?0:481);pointer(thumb,'pointerup',481,481);
 expect(positions[positions.length-1]).toBe(999999500);expect(track.getAttribute('aria-valuenow')).toBe('999999500');expect(track.getAttribute('aria-valuetext')).toBe('Row 19999991 of 20000000');expect(thumb.style.transform).toBe(`${isX?'translateX':'translateY'}(481px)`);
 sb.updatePosition(499999750);expect(thumb.style.transform).toBe(`${isX?'translateX':'translateY'}(240.5px)`);
});
for(const platform of ['macos','windows','android'] as const)test(`horizontal ${platform}: CSS mapping, overrides and refresh`,()=>{
 const host=document.createElement('div'),viewport=document.createElement('div');host.append(viewport);document.body.append(host);
 host.style.setProperty('scrollbar-width','thin');host.style.setProperty('scrollbar-color','red blue');
 sb=createScrollbar(viewport,()=>{},{platform,gutter:true,thumbColor:'green'},'vlist',true,host,undefined,host);sb.updateBounds(10000,500);
 const track=host.querySelector<HTMLElement>('.vlist-scrollbar')!;
 expect(host.style.getPropertyValue('--vlist-custom-scrollbar-width')).toBe('6px');expect(host.style.getPropertyValue('--vlist-custom-scrollbar-thumb-color')).toBe('green');expect(host.style.getPropertyValue('--vlist-custom-scrollbar-track-color')).toBe('blue');
 host.style.setProperty('scrollbar-width','none');sb.refresh();expect(track.style.display).toBe('none');expect(viewport.classList.contains('vlist-viewport--gutter')).toBe(false);
 host.style.setProperty('scrollbar-width','auto');sb.refresh();expect(track.style.display).toBe('');expect(viewport.classList.contains('vlist-viewport--gutter')).toBe(true);expect(host.style.getPropertyValue('--vlist-custom-scrollbar-width')).toBe(platform==='windows'?'14px':'6px');
});
