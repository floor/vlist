import {readFileSync} from 'node:fs';
import {createVList} from '../../../src/core/create';
import type {VListPlugin} from '../../../src/core/types';
import {groups} from '../../../src/plugins/groups/plugin';
import {grid} from '../../../src/plugins/grid/plugin';
import {page} from '../../../src/plugins/page/plugin';
import {table} from '../../../src/plugins/table/plugin';
import {scrollbar} from '../../../src/plugins/scrollbar/plugin';
import type {VListItem} from '../../../src/types';
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

test('numeric width and radius override stylesheet sizing, including zero radius',()=>{
 const style=document.createElement('style');style.textContent='div { --vlist-custom-scrollbar-width: 11px; --vlist-custom-scrollbar-radius: 7px; }';document.body.append(style);
 const config={platform:'windows',width:19,radius:0} as const;
 const {variable}=make(config);
 expect(variable('width')).toBe('19px');expect(variable('radius')).toBe('0px');
});

test('stylesheet sizing wins over platform defaults and refresh rereads changes',()=>{
 const style=document.createElement('style');document.body.append(style);
 style.textContent='div { --vlist-custom-scrollbar-width: 11px; --vlist-custom-scrollbar-radius: 7px; }';
 const {variable}=make({platform:'windows'});
 expect(variable('width')).toBe('11px');expect(variable('radius')).toBe('7px');
 style.textContent='div { --vlist-custom-scrollbar-width: 17px; --vlist-custom-scrollbar-radius: 3px; }';sb!.refresh();
 expect(variable('width')).toBe('17px');expect(variable('radius')).toBe('3px');
 style.remove();sb!.refresh();
 expect(variable('width')).toBe('14px');expect(variable('radius')).toBe('0px');
});

test('standalone inline sizing changes remain authored values across refreshes',()=>{
 const {host,variable}=make({platform:'macos'});
 host.style.setProperty('--vlist-custom-scrollbar-width','21px');host.style.setProperty('--vlist-custom-scrollbar-radius','2px');
 sb!.refresh();sb!.refresh();
 expect(variable('width')).toBe('21px');expect(variable('radius')).toBe('2px');
});


test('a disabled scrollbar reserves no column, and an enabled hidden track keeps it',()=>{
 const disabled=make({platform:'macos',enabled:false});
 expect(disabled.host.style.getPropertyValue('--vlist-track-column-width')).toBe('0px');
 expect(disabled.viewport.style.width).toBe('');
 sb!.destroy();
 const hidden=make({platform:'macos'});
 expect(hidden.viewport.style.width).toBe('');
 expect(hidden.host.style.getPropertyValue('--vlist-track-column-width')).toBe('');
 sb!.updateBounds(100,500);
 expect(hidden.track.style.visibility).toBe('hidden');
 expect(hidden.viewport.style.width).toBe('');
 expect(hidden.host.style.getPropertyValue('--vlist-track-column-width')).toBe('');
 hidden.host.style.setProperty('scrollbar-width','none');sb!.refresh();
 expect(hidden.host.style.getPropertyValue('--vlist-track-column-width')).toBe('0px');
 expect(hidden.viewport.style.width).toBe('');
 hidden.host.style.setProperty('scrollbar-width','auto');sb!.refresh();
 expect(hidden.host.style.getPropertyValue('--vlist-track-column-width')).toBe('');
 expect(hidden.viewport.style.width).toBe('');
});

test('a non-pixel track width stays on the stylesheet, not a measured px',()=>{
 const rem=make({platform:'macos',hoverZoneWidth:4});
 rem.host.style.setProperty('--vlist-custom-scrollbar-width','0.75rem');sb!.refresh();
 expect(rem.variable('width')).toBe('0.75rem');
 expect(rem.host.style.getPropertyValue('--vlist-track-column-width')).toBe('');
 expect(rem.host.style.getPropertyValue('--vlist-scrollbar-slot')).toBe('4px');
 expect(rem.track.style.width).toBe('');
 sb!.destroy();
 const em=make({platform:'macos',hoverZoneWidth:4});
 em.host.style.fontSize='20px';
 em.host.style.setProperty('--vlist-custom-scrollbar-width','0.8em');sb!.refresh();
 expect(em.variable('width')).toBe('0.8em');
 expect(em.host.style.getPropertyValue('--vlist-track-column-width')).toBe('');
 expect(em.track.style.width).toBe('');
});

test('a percentage track width is left as written when the list widens or is revealed',()=>{
 const hidden=make({platform:'macos'});
 hidden.host.style.display='none';
 hidden.host.style.setProperty('--vlist-custom-scrollbar-width','5%');sb!.refresh();
 expect(hidden.track.style.width).toBe('');
 expect(hidden.variable('width')).toBe('5%');
 hidden.host.style.display='';hidden.host.style.width='620px';sb!.refresh();
 expect(hidden.track.style.width).toBe('');
 expect(hidden.variable('width')).toBe('5%');
 expect(hidden.host.style.getPropertyValue('--vlist-track-column-width')).toBe('');
 sb!.destroy();
 const calc=make({platform:'macos'});
 calc.host.style.setProperty('--vlist-custom-scrollbar-width','calc(5% + 4px)');sb!.refresh();
 expect(calc.track.style.width).toBe('');
 expect(calc.variable('width')).toBe('calc(5% + 4px)');
 calc.host.style.width='420px';sb!.refresh();
 expect(calc.variable('width')).toBe('calc(5% + 4px)');
});

test('a title or header that moves without a viewport resize does not leave a rail offset',()=>{
 const host=document.createElement('div'),header=document.createElement('div'),viewport=document.createElement('div');
 header.style.height='24px';host.append(header,viewport);document.body.append(host);
 let top=61;
 Object.defineProperty(viewport,'offsetTop',{configurable:true,get:()=>top});
 sb=createScrollbar(viewport,()=>{},{platform:'macos'},'vlist',false,host,undefined,host);
 sb.updateBounds(10000,186);
 const rail=host.querySelector<HTMLElement>('.vlist-scrollbar-rail')!;
 expect(rail.style.top).toBe('');
 header.style.height='48px';top=85;sb!.refresh();sb.updateBounds(10000,186);
 expect(rail.style.top).toBe('');
 expect(viewport.parentElement).toBe(host);
 expect(rail.parentElement).toBe(host);
});

test('a sticky title is subtracted once when the rail has its own row',()=>{
 const style=document.createElement('style');
 style.textContent=readFileSync(new URL('../../../src/styles/vlist.css',import.meta.url),'utf8')
  +readFileSync(new URL('../../../src/styles/vlist-table.css',import.meta.url),'utf8')
  +readFileSync(new URL('../../../src/styles/vlist-grid.css',import.meta.url),'utf8');
 document.body.append(style);
 const items=Array.from({length:8},(_,i)=>({id:i}));
 const header={height:24,template:()=>'A'};
 const grouped=()=>groups({getGroupForIndex:()=>'A',header});
 const mount=(plugins: VListPlugin<VListItem>[])=>{
  const host=document.createElement('div');
  host.style.cssText='width:420px;height:240px';
  document.body.append(host);
  createVList<VListItem>({container:host,items,item:{height:28,template:(row)=>String(row.id)}},plugins);
  const vp=host.querySelector<HTMLElement>('.vlist-viewport')!;
  const css=getComputedStyle(vp);
  return {inline:vp.style.height,used:css.height,priority:css.getPropertyPriority('height')};
 };
 const once=(sample: {inline: string, used: string, priority: string})=>{
  // Groups still writes the block-flow formula. The rail's row already starts
  // below the title, so the used height is that row and the formula loses.
  expect(sample.inline).toBe('calc(100% - 24px)');
  expect(sample.used).toBe('100%');
  expect(sample.priority).toBe('important');
 };
 once(mount([grouped(),scrollbar()]));
 once(mount([grouped(),scrollbar({enabled:false})]));
 once(mount([table({rowHeight:28,columns:[{key:'name',label:'Name',width:200}]}),grouped(),scrollbar()]));
 once(mount([grid({columns:2}),grouped(),scrollbar()]));
 const bare=mount([grouped()]);
 expect(bare.used).toBe('calc(100% - 24px)');
 expect(bare.priority).toBe('');
 const paged=mount([page(),grouped(),scrollbar()]);
 expect(paged.used).toBe('auto');
 expect(paged.priority).toBe('important');
});

test('the rail shares the scrollport row',()=>{
 const css=readFileSync(new URL('../../../src/styles/vlist.css',import.meta.url),'utf8');
 expect(css).toContain('grid-template-columns:');
 expect(css).toContain('grid-row: scrollport');
 expect(css).toContain('height: 100% !important');
 expect(css).toContain('--vlist-track-column:');
 expect(css).not.toContain('container-type');
 expect(css).not.toContain('container-name');
 expect(css).not.toContain('cqw');
 expect(css).not.toContain('top: anchor(top)');
});

test('an unpinned page header is not capped by the rail column',()=>{
 const style=document.createElement('style');
 style.textContent=readFileSync(new URL('../../../src/styles/vlist-table.css',import.meta.url),'utf8');
 document.body.append(style);
 const root=document.createElement('div');
 root.className='vlist vlist--page vlist--table';
 root.style.width='420px';
 root.style.setProperty('--vlist-track-column-width','18px');
 const row=document.createElement('div');
 row.setAttribute('role','rowgroup');
 const wide=document.createElement('div');wide.style.width='790px';row.append(wide);
 const rail=document.createElement('div');rail.className='vlist-scrollbar-rail';
 root.append(row,rail);document.body.append(root);
 const open=(value:string)=>value===''||value==='none'||value==='auto';
 expect(open(getComputedStyle(row).maxWidth)).toBe(true);
 root.classList.add('vlist--table-pinned');
 expect(open(getComputedStyle(row).maxWidth)).toBe(false);
 root.className='vlist vlist--table';
 expect(open(getComputedStyle(row).maxWidth)).toBe(false);
 style.remove();
});

test('plugin supplies defaults with vlist.css and refreshScrollbar rereads the container',()=>{
 const style=document.createElement('style');
 style.textContent=readFileSync(new URL('../../../src/styles/vlist.css',import.meta.url),'utf8');
 document.body.append(style);
 const host=document.createElement('div');document.body.append(host);
 const list=createVList({container:host,items:[{id:1}],item:{height:40,template:()=>''}},[scrollbar({platform:'windows'})]);
 const variable=(name:string)=>list.element.style.getPropertyValue(`--vlist-custom-scrollbar-${name}`);
 try {
  expect(variable('width')).toBe('14px');expect(variable('radius')).toBe('0px');
  host.style.setProperty('--vlist-custom-scrollbar-width','23px');host.style.setProperty('--vlist-custom-scrollbar-radius','5px');
  (list.refreshScrollbar as () => void)();
  expect(variable('width')).toBe('23px');expect(variable('radius')).toBe('5px');
  host.style.removeProperty('--vlist-custom-scrollbar-width');host.style.removeProperty('--vlist-custom-scrollbar-radius');
  host.style.setProperty('scrollbar-width','thin');(list.refreshScrollbar as () => void)();
  expect(variable('width')).toBe('6px');expect(variable('radius')).toBe('0px');
 } finally { list.destroy(); }
});
