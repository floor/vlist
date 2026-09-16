import { afterAll, beforeAll, expect, it } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createVList } from "../../src/native";
import type { PluginContext, VListPlugin } from "../../src/core/types";
import { createContainer } from "../helpers/factory";

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

function setup() {
  const host = createContainer();
  let ctx!: PluginContext<{ id: number }>;
  const inspect: VListPlugin<{ id: number }> = { name: "inspect", priority: 100, setup(c) { ctx = c; } };
  const list = createVList({ container: host, items: Array.from({ length: 100 }, (_, id) => ({ id })),
    item: { height: 40, template: item => String(item.id) }, scroll: { idleTimeout: 10 },
  }, [inspect]);
  ctx.getState().containerSize = 400;
  let native = 0;
  // Model the browser's scroll range; Happy DOM does not clamp native offsets.
  Object.defineProperty(ctx.dom.viewport, "scrollTop", { configurable: true,
    get: () => native, set: (value: number) => { native = Math.max(0, Math.min(3600, value)); },
  });
  return { ctx, list, cleanup() { list.destroy(); host.remove(); } };
}

it("native context, correction, adapter and public index writes commit synchronously", () => {
  const t = setup();
  try {
    t.ctx.scroll.to(480);
    expect(t.list.getScrollPosition()).toBe(480);
    t.ctx.scroll.shiftBy(40);
    expect(t.list.getScrollPosition()).toBe(520);
    t.ctx.scroll.setPixelEquivalent(640);
    expect(t.list.getScrollPosition()).toBe(640);
    t.list.scrollToIndex(20);
    expect(t.list.getScrollPosition()).toBe(800);
    expect(t.ctx.getState().scrollDirection).toBe(1);
    t.ctx.scroll.to(100);
    expect(t.ctx.getState().scrollDirection).toBe(-1);
    t.ctx.scroll.to(100.25);
    expect(t.list.getScrollPosition()).toBe(100.25);
  } finally { t.cleanup(); }
});

it("native writes commit the clamped value and dedupe DOM events without losing idle", async () => {
  const t = setup();
  const positions: number[] = [], idle: number[] = [];
  try {
    t.list.on("scroll", e => positions.push(e.scrollPosition));
    t.list.on("scroll:idle", e => idle.push(e.scrollPosition));
    t.ctx.scroll.to(99999);
    expect(t.list.getScrollPosition()).toBe(3600);
    expect(positions).toEqual([3600]);
    t.ctx.dom.viewport.dispatchEvent(new Event("scroll"));
    expect(positions).toEqual([3600]);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(idle).toEqual([3600]);
  } finally { t.cleanup(); }
});

for (const [from, target, direction] of [[100, 500, 1], [500, 100, -1]]) {
  it(`native smooth scrolling commits previous position and direction ${direction} on each tick`, () => {
    const t = setup();
    const raf = globalThis.requestAnimationFrame;
    let frame!: FrameRequestCallback;
    globalThis.requestAnimationFrame = callback => { frame = callback; return 1; };
    try {
      t.ctx.scroll.to(from!);
      t.ctx.scroll.smoothTo(target!, 100, x => x);
      frame(performance.now() + 40);
      expect(t.ctx.getState().prevScrollPosition).toBe(from!);
      expect(t.ctx.getState().scrollDirection).toBe(direction!);
      const middle = t.list.getScrollPosition();
      expect(middle).toBeGreaterThan(100);
      expect(middle).toBeLessThan(500);
      frame(performance.now() + 200);
      expect(t.ctx.getState().prevScrollPosition).toBe(middle);
      expect(t.ctx.getState().scrollDirection).toBe(direction!);
      expect(t.list.getScrollPosition()).toBe(target!);
    } finally { globalThis.requestAnimationFrame = raf; t.cleanup(); }
  });
}
