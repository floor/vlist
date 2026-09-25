import { test, expect, beforeAll, afterAll } from 'bun:test';
import { setupDOM, teardownDOM } from '../../helpers/dom';
import { createScrollbar, type Scrollbar } from '../../../src/plugins/scrollbar/scrollbar';
import { createSizeCache } from '../../../src/rendering/sizes';
import { createVList } from '../../../src/synthetic';
import { scrollbar } from '../../../src/plugins/scrollbar';
import { a11y } from '../../../src/plugins/a11y';

beforeAll(setupDOM); afterAll(teardownDOM);
// Every fixture is owned and disposed by the test that built it, so nothing is
// shared through module state and the file is safe under `bun test --concurrent`.
function fixture(isX = false) {
 const viewport = document.createElement('div'); document.body.append(viewport);
 const cache = createSizeCache((i: number) => i === 0 ? 20 : 40, 100);
 const writes: number[] = [];
 let sb: Scrollbar;
 sb = createScrollbar(viewport, value => { writes.push(value); sb.updatePosition(value); }, {autoHide: true, autoHideDelay: 5}, 'vlist', isX, undefined, () => cache);
 sb.updateBounds(cache.getTotalSize(), 200);
 const track = viewport.querySelector<HTMLElement>('.vlist-scrollbar')!;
 const dispose = () => { sb.destroy(); viewport.remove(); };
 return {viewport,cache,writes,track,thumb:track.firstElementChild as HTMLElement,sb,dispose};
}
function key(target: HTMLElement, key: string) {
 const event = new KeyboardEvent('keydown', {key,bubbles:true,cancelable:true}); target.dispatchEvent(event); return event;
}
function pointer(target: HTMLElement, type: string, id = 1, y = 10, pointerType = 'touch') {
 const event = new PointerEvent(type,{pointerId:id,pointerType,clientY:y,clientX:y,button:0,bubbles:true,cancelable:true,isPrimary:true}); target.dispatchEvent(event); return event;
}
test('scrollbar exposes logical values and cache-based rows, without redundant ARIA writes', () => {
 const {viewport,track,cache,sb,dispose} = fixture(); try {
 expect(track.getAttribute('role')).toBe('scrollbar'); expect(track.tabIndex).toBe(0);
 expect(viewport.id).not.toBe(''); expect(track.getAttribute('aria-controls')).toBe(viewport.id);
 expect(track.getAttribute('aria-orientation')).toBe('vertical');
 expect(track.getAttribute('aria-valuemin')).toBe('0'); expect(track.getAttribute('aria-valuemax')).toBe('3780');
 expect(track.getAttribute('aria-valuenow')).toBe('0'); expect(track.getAttribute('aria-valuetext')).toBe('Row 1 of 100');
 sb!.updatePosition(20); expect(track.getAttribute('aria-valuetext')).toBe('Row 2 of 100');
 const set = track.setAttribute.bind(track), writes: string[] = [];
 track.setAttribute = (name,value) => {writes.push(name); set(name,value);};
 sb!.updatePosition(20); expect(writes).toEqual([]);
 sb!.updatePosition(21); expect(writes).toEqual(['aria-valuenow']);
 cache.rebuild(50); sb!.updateBounds(cache.getTotalSize(),200);
 expect(track.getAttribute('aria-valuetext')).toBe('Row 2 of 50'); expect(track.getAttribute('aria-valuemax')).toBe('1780');
 sb!.updatePosition(9999); expect(track.getAttribute('aria-valuenow')).toBe('1780');
 cache.rebuild(0); sb!.updateBounds(0,200);
 expect(track.getAttribute('aria-valuenow')).toBe('0'); expect(track.getAttribute('aria-valuemax')).toBe('0'); expect(track.getAttribute('aria-valuetext')).toBe('Row 0 of 0');
 } finally { dispose(); }
});
// Serial: autoHide is keyed to `document.activeElement`, which is one per
// document — a concurrent test calling focus() would hide this scrollbar.
test.serial('every scrollbar key uses logical row sizes and focus stays visible until blur', async () => {
 const {track,writes,sb,dispose} = fixture(); try {
 key(track,'ArrowDown'); expect(writes).toEqual([]);
 track.focus();
 for(const [name,value] of [['ArrowDown',20],['ArrowDown',60],['ArrowUp',20],['PageDown',220],['PageUp',20],['End',3780],['Home',0]] as const) {
  expect(key(track,name).defaultPrevented).toBe(true); expect(writes[writes.length - 1]).toBe(value);
 }
 expect(key(track,'ArrowRight').defaultPrevented).toBe(false);
 await new Promise(r => setTimeout(r,15)); expect(sb.isVisible()).toBe(true);
 track.blur(); await new Promise(r => setTimeout(r,15)); expect(sb.isVisible()).toBe(false);
 } finally { dispose(); }
});
test('horizontal scrollbar exposes orientation and axis-appropriate arrow keys', () => {
 const {track,writes,dispose} = fixture(true); try { track.focus();
 expect(track.getAttribute('aria-orientation')).toBe('horizontal');
 key(track,'ArrowRight'); expect(writes[writes.length - 1]).toBe(20);
 key(track,'ArrowLeft'); expect(writes[writes.length - 1]).toBe(0);
 expect(key(track,'ArrowDown').defaultPrevented).toBe(false);
 } finally { dispose(); }
});
test('thumb pointer capture handles mouse, touch and pen, ignores other pointers and ends on cancellation', () => {
 const {thumb,track,writes,sb,dispose} = fixture(); try { const captured = new Set<number>();
 thumb.setPointerCapture = id => {captured.add(id);}; thumb.hasPointerCapture = id => captured.has(id); thumb.releasePointerCapture = id => {captured.delete(id);};
 for(const kind of ['mouse','touch','pen']) {
  pointer(thumb,'pointerdown',1,10,kind); expect(captured.has(1)).toBe(true);
  const before = writes.length; pointer(thumb,'pointermove',2,50,kind); expect(writes.length).toBe(before);
  pointer(thumb,'pointermove',1,50,kind); expect(writes.length).toBe(before+1);
  pointer(thumb,'pointercancel',1,50,kind); expect(captured.size).toBe(0);
  expect(track.classList.contains('vlist-scrollbar--dragging')).toBe(false);
  pointer(thumb,'pointermove',1,60,kind); expect(writes.length).toBe(before+1);
 }
 pointer(thumb,'pointerdown');
 pointer(thumb,'lostpointercapture');
 expect(track.classList.contains('vlist-scrollbar--dragging')).toBe(false);
 expect(captured.size).toBe(0);
 pointer(thumb,'pointerdown'); sb.destroy();
 expect(captured.size).toBe(0);
 const before=writes.length; pointer(thumb,'pointermove',1,100); expect(writes.length).toBe(before);
 } finally { dispose(); }
});
test('generated viewport ids are unique, preserve authored ids, and are cleaned up', () => {
 const {viewport,sb} = fixture(); const generated=viewport.id; sb.destroy(); expect(viewport.id).toBe('');
 viewport.id='authored'; const authored=createScrollbar(viewport,()=>{}); expect(viewport.querySelector('[role="scrollbar"]')!.getAttribute('aria-controls')).toBe('authored');
 authored.destroy(); expect(viewport.id).toBe('authored'); viewport.remove();
 const second=document.createElement('div'); document.body.append(second);
 const other=createScrollbar(second,()=>{}); expect(second.id).not.toBe(generated);
 other.destroy(); second.remove();
});
test('scrollbar keys do not change list selection; a11y list navigation still works', async () => {
 const host=document.createElement('div'); document.body.append(host);
 const list=createVList({container:host, items:Array.from({length:100},(_,i)=>({id:i})), item:{height:40,template:item=>String(item.id)}},[scrollbar(),a11y()]);
 try {
 let selections=0; list.on('selection:change',()=>{selections++;});
 const viewport=host.querySelector<HTMLElement>('.vlist-viewport')!, track=host.querySelector<HTMLElement>('.vlist-scrollbar')!;
 await Promise.resolve();
 track.focus(); key(track,'ArrowDown'); expect(list.getScrollPosition()).toBe(40);
 expect(host.querySelector('.vlist-content')!.getAttribute('aria-activedescendant')).toBeNull();
 viewport.focus(); key(viewport,'ArrowDown');
 expect(host.querySelector('.vlist-content')!.getAttribute('aria-activedescendant')).toBe('vlist-item-0');
 track.focus(); key(track,' '); key(track,'Enter'); expect(selections).toBe(0);
 viewport.focus(); key(viewport,' '); expect(selections).toBe(1);
 } finally { list.destroy(); host.remove(); }
});
