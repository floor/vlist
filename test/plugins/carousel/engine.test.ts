/**
 * Carousel layout engine — geometric continuity.
 *
 * Issue 023: the visible "chop just before the final position" was an 8px
 * (== gap) discontinuity in every item's on-screen offset at the focal-boundary
 * flip. The old gap term `s + (s > 0 ? gap : 0)` kept the full gap until the
 * exiting item's size hit exactly 0, then dropped it instantly. The fix fades
 * the gap with the item's size (`gapFor`). These tests sweep the scroll position
 * across a focal-boundary flip and assert every visible item moves continuously
 * (no single-step jump anywhere near the gap size).
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createLayoutEngine } from "../../../src/plugins/carousel/engine";

/**
 * Replicate the carousel plugin's per-frame layout resolution so the test
 * measures the same on-screen offset the user sees (updateItemLayout):
 *   focalVi = floor(pos / stepSize)
 *   frac    = pos / stepSize - focalVi
 *   anchor  = pos + getAnchorOffset(focalVi, frac)
 *   onScreen(vi) = getItemLayout(vi, focalVi, frac, anchor).offset - pos
 */
function onScreenLeft(
  engine: ReturnType<typeof createLayoutEngine>,
  pos: number,
  vi: number,
): number {
  const focalVi = Math.floor(pos / engine.stepSize);
  const frac = pos / engine.stepSize - focalVi;
  const anchor = pos + engine.getAnchorOffset(focalVi, frac);
  return engine.getItemLayout(vi, focalVi, frac, anchor).offset - pos;
}

/** Max single-step jump of a tracked item's on-screen left edge over a sweep. */
function maxJump(
  engine: ReturnType<typeof createLayoutEngine>,
  fromPos: number,
  toPos: number,
  step: number,
  vi: number,
): number {
  let prev = onScreenLeft(engine, fromPos, vi);
  let max = 0;
  for (let pos = fromPos + step; pos <= toPos; pos += step) {
    const cur = onScreenLeft(engine, pos, vi);
    max = Math.max(max, Math.abs(cur - prev));
    prev = cur;
  }
  return max;
}

describe("carousel engine — gap continuity across focal-boundary flip", () => {
  it("hero-center: every visible item's on-screen offset is continuous through a flip", () => {
    const gap = 8;
    const engine = createLayoutEngine({
      slots: [0.15, 0.7, 0.15],
      focalSlot: 1,
      containerSize: 692,
      gap,
    });

    // Sweep across one full step boundary at 1px resolution. The flip happens
    // at pos = N * stepSize where focalVi increments and an adjacent item's
    // size crosses 0. Centre the sweep on a boundary deep in the middle cycle.
    const boundary = 50 * engine.stepSize;
    const from = boundary - engine.stepSize;
    const to = boundary + engine.stepSize;

    // Track every item that can be visible in the 3-slot window around focal.
    for (let rel = -3; rel <= 3; rel++) {
      const vi = 50 + rel;
      const jump = maxJump(engine, from, to, 1, vi);
      // Smooth motion ~= 1px/step. The old binary gap injected an 8px jump.
      // Allow generous slack (3px) for size-interpolation curvature while
      // still failing hard on any gap-sized discontinuity.
      expect(jump).toBeLessThan(3);
    }
  });

  it("hero (focalSlot 0): on-screen offsets continuous through a flip with gap", () => {
    const gap = 12;
    const engine = createLayoutEngine({
      slots: [0.8, 0.2],
      focalSlot: 0,
      containerSize: 800,
      gap,
    });

    const boundary = 50 * engine.stepSize;
    const from = boundary - engine.stepSize;
    const to = boundary + engine.stepSize;

    for (let rel = -1; rel <= 2; rel++) {
      const vi = 50 + rel;
      const jump = maxJump(engine, from, to, 1, vi);
      expect(jump).toBeLessThan(3);
    }
  });

  it("rest layout is unchanged by the gap taper (visible items >= gap at rest)", () => {
    const gap = 8;
    const engine = createLayoutEngine({
      slots: [0.15, 0.7, 0.15],
      focalSlot: 1,
      containerSize: 692,
      gap,
    });

    // At rest (frac = 0) the gap taper is a no-op: every visible slot width is
    // >= gap, so gapFor returns the full gap. Focal sits one peek + one gap in.
    const restPos = 50 * engine.stepSize;
    const focalLeft = onScreenLeft(engine, restPos, 50);
    const peek = engine.slotWidths[0]!;
    expect(focalLeft).toBeCloseTo(peek + gap, 5);
  });
});


// Check the real plugin's rendered geometry on both input entries as well as
// the pure engine sweeps above. Folded and home-cycle layouts must coincide.
import {setupDOM,teardownDOM} from '../../helpers/dom';
import {carouselEntries,carouselEntry} from '../../helpers/carousel-entry';
describe('entry fold geometry',()=>{
 beforeAll(()=>setupDOM());afterAll(()=>teardownDOM());
 for(const [entry,create] of carouselEntries) for(const isX of [false,true]) for(const variant of ['full','hero','multi'] as const) {
  it(`${entry}/${isX?'horizontal':'vertical'}/${variant} preserves rendered offsets through fold`,()=>{
   const f=carouselEntry(create,{variant,peek:'20%'},isX);
   const step=variant==='full'?400:variant==='hero'?320:160;
   const read=()=>[...f.host.querySelectorAll<HTMLElement>('[data-index]')].filter(el=>el.style.display!=='none').map(el=>({
    id:el.textContent,size:el.style[isX?'width':'height'],offset:parseFloat(el.style.transform.match(/\(([-\d.]+)/)![1]!)-(isX?f.ctx.dom.viewport.scrollLeft:f.ctx.dom.viewport.scrollTop),
   })).sort((a,b)=>Number(a.id)-Number(b.id));
   try {
    f.ctx.scroll.to(500*step+20);const expected=read();
    f.ctx.scroll.to(900*step-20);f.wheel(40);
    expect(f.list.getScrollPosition()).toBe(500*step+20);expect(read()).toEqual(expected);
   } finally {f.destroy();}
  });
 }
});
