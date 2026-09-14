import {test, expect, beforeAll, afterAll, afterEach} from 'bun:test';
import {setupDOM, teardownDOM} from '../../helpers/dom';
import {createScrollbar, type Scrollbar, type ScrollbarConfig} from '../../../src/plugins/scrollbar/scrollbar';
beforeAll(setupDOM); afterAll(teardownDOM);
let sb: Scrollbar | undefined;
afterEach(()=>{sb?.destroy();sb=undefined;document.body.innerHTML='';});
function make(config: ScrollbarConfig = {}, width = 'auto', color = 'auto') {
 const host=document.createElement('div'),viewport=document.createElement('div'); host.append(viewport);document.body.append(host);
 host.style.setProperty('scrollbar-width',width);host.style.setProperty('scrollbar-color',color);
 sb=createScrollbar(viewport,()=>{},config,'vlist',false,host,undefined,host);sb.updateBounds(10000,500);
 const track=host.querySelector<HTMLElement>('.vlist-scrollbar')!;
 return {host,viewport,track,variable:(name:string)=>host.style.getPropertyValue(`--vlist-custom-scrollbar-${name}`)};
}
for(const platform of ['macos','windows','android'] as const) test(`${platform} defaults and explicit visibility override`,()=>{
 const {variable}=make({platform});
 expect(variable('width')).toBe(platform==='windows'?'14px':'6px');
 expect(variable('radius')).toBe(platform==='windows'?'0px':'4px');
 expect(sb!.isVisible()).toBe(platform==='windows');
});
test('author standard properties override platform; explicit config overrides author CSS',()=>{
 const {variable,host,track}=make({platform:'windows'},'thin','rgb(10, 20, 30) rgb(40, 50, 60)');
 expect(variable('width')).toBe('6px'); expect(variable('thumb-color')).toBe('rgb(10, 20, 30)');expect(variable('track-color')).toBe('rgb(40, 50, 60)');
 host.style.setProperty('scrollbar-width','none'); sb!.refresh();expect(track.style.display).toBe('none');
 host.style.setProperty('scrollbar-width','auto');host.style.setProperty('scrollbar-color','auto');sb!.refresh();expect(track.style.display).toBe('');expect(variable('width')).toBe('14px');expect(variable('thumb-color')).toBe('');
 sb!.destroy();
 const override=make({platform:'macos',width:'auto',thumbColor:'red',trackColor:'blue',autoHide:false},'none','green yellow');
 expect(override.track.style.display).toBe('');expect(override.variable('width')).toBe('6px');expect(override.variable('thumb-color')).toBe('red');expect(override.variable('track-color')).toBe('blue');expect(sb!.isVisible()).toBe(true);
});
test('none disables track, hover zone and gutter; refresh restores them and logical attributes',()=>{
 const {host,viewport,track}=make({platform:'windows',gutter:true},'none');
 expect(track.style.display).toBe('none');expect(host.querySelector<HTMLElement>('.vlist-scrollbar__hover')!.style.display).toBe('none');expect(viewport.classList.contains('vlist-viewport--gutter')).toBe(false);
 sb!.updatePosition(500);sb!.show();expect(sb!.isVisible()).toBe(false);
 host.style.setProperty('scrollbar-width','thin');sb!.refresh();
 expect(track.style.display).toBe('');expect(viewport.classList.contains('vlist-viewport--gutter')).toBe(true);expect(track.getAttribute('aria-valuenow')).toBe('500');
});
test('platform detection is chosen once and explicit config wins',()=>{
 const original=Object.getOwnPropertyDescriptor(navigator,'platform');
 try {
  Object.defineProperty(navigator,'platform',{configurable:true,value:'Win32'});const {variable}=make();expect(variable('width')).toBe('14px');
  Object.defineProperty(navigator,'platform',{configurable:true,value:'MacIntel'});sb!.refresh();expect(variable('width')).toBe('14px');
  sb!.destroy();const mac=make();expect(mac.variable('width')).toBe('6px');
 } finally {if(original)Object.defineProperty(navigator,'platform',original);else delete (navigator as any).platform;}
});
test('userAgentData wins over legacy detection; explicit platform overrides both',()=>{
 const old=Object.getOwnPropertyDescriptor(navigator,'userAgentData');
 try {
  Object.defineProperty(navigator,'userAgentData',{configurable:true,value:{platform:'Android'}});
  const android=make();expect(android.variable('width')).toBe('6px');sb!.destroy();
  const windows=make({platform:'windows'});expect(windows.variable('width')).toBe('14px');
 } finally {if(old)Object.defineProperty(navigator,'userAgentData',old);else delete (navigator as any).userAgentData;}
});
test('CSS reads occur only at setup/refresh; explicit disable survives author CSS',()=>{
 const original=globalThis.getComputedStyle;let reads=0;
 globalThis.getComputedStyle=(...args)=>{reads++;return original(...args);};
 try {
  const {track}=make({platform:'windows',enabled:false},'thin');expect(reads).toBe(1);
  sb!.updatePosition(400);sb!.updateBounds(20000,600);sb!.show();expect(reads).toBe(1);
  sb!.refresh();expect(reads).toBe(2);expect(track.style.display).toBe('none');
 } finally {globalThis.getComputedStyle=original;}
});
