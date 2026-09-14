import { afterAll, beforeAll, expect, it, mock } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createVList } from "../../src/core/create";
import type { PluginContext, VListPlugin } from "../../src/core/types";
import { page } from "../../src/plugins/page/plugin";
import { grid } from "../../src/plugins/grid/plugin";
import { createContainer } from "../helpers/factory";

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

function setup() {
  const host = createContainer();
  let ctx!: PluginContext<{ id: number }>;
  const afterScroll = mock(() => {});
  const inspect: VListPlugin<{ id: number }> = {
    name: "inspect", priority: 100,
    setup(context) { ctx = context; },
    hooks: { onAfterScroll: afterScroll },
  };
  const scrollTo = window.scrollTo;
  window.scrollTo = mock(() => {});
  const list = createVList({ container: host,
    items: Array.from({ length: 1000 }, (_, id) => ({ id })),
    item: { height: 40, template: item => String(item.id) },
    scroll: { idleTimeout: 10 },
  }, [page(), grid({ columns: 2 }), inspect]);
  const rect = mock(() => ({ top: -200, left: 0, width: 400, height: 600,
    right: 400, bottom: 400, x: 0, y: -200, toJSON() {} } as DOMRect));
  ctx.dom.viewport.getBoundingClientRect = rect;
  return { ctx, list, rect, afterScroll, cleanup() { list.destroy(); host.remove(); window.scrollTo = scrollTo; } };
}

it("page + grid uses only the listener's rect read for rendering and scroll events", () => {
  const t = setup();
  try {
    let position = -1;
    t.list.on("scroll", event => { position = event.scrollPosition; });
    window.dispatchEvent(new Event("scroll"));
    expect(t.rect).toHaveBeenCalledTimes(1);
    expect(position).toBe(200);
    expect(t.list.getScrollPosition()).toBe(200);
    t.ctx.forceRender();
    t.ctx.onScrollIdle();
    expect(t.rect).toHaveBeenCalledTimes(1);
  } finally { t.cleanup(); }
});

it("page scroll writes are synchronously readable before a window scroll event", () => {
  const t = setup();
  try {
    t.ctx.scrollTo(480);
    expect(t.list.getScrollPosition()).toBe(480);
    t.ctx.scroll.setPixelEquivalent(640);
    expect(t.list.getScrollPosition()).toBe(640);
    t.list.scrollToIndex(40);
    expect(t.list.getScrollPosition()).toBe(800);
  } finally { t.cleanup(); }
});

it("page writes commit direction, frame and configured idle once, then dedupe window events", async () => {
  const t = setup();
  try {
    const frames = mock(() => {});
    const idle = mock(() => {});
    t.list.on("scroll", frames);
    t.list.on("scroll:idle", idle);
    t.ctx.scrollTo(200);
    expect(t.ctx.getState().prevScrollPosition).toBe(0);
    expect(t.ctx.getState().scrollDirection).toBe(1);
    expect(frames).toHaveBeenCalledTimes(1);
    expect(t.afterScroll).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("scroll"));
    expect(t.ctx.getState().prevScrollPosition).toBe(0);
    expect(frames).toHaveBeenCalledTimes(1);
    expect(t.afterScroll).toHaveBeenCalledTimes(1);
    await Bun.sleep(30);
    expect(t.ctx.getState().scrollDirection).toBe(0);
    expect(idle).toHaveBeenCalledTimes(1);
    t.ctx.scrollTo(100.25);
    expect(t.ctx.getState().prevScrollPosition).toBe(200);
    expect(t.ctx.getState().scrollDirection).toBe(-1);
  } finally { t.cleanup(); }
});

it("deprecated setScrollFns delegates to the external writer contract", () => {
  const t = setup();
  try {
    const getter = mock(() => { throw new Error("dead getter"); });
    const writer = mock((px: number) => t.ctx.commitScroll(px));
    t.ctx.setScrollFns(getter, writer);
    t.ctx.scrollTo(300);
    expect(writer).toHaveBeenCalledWith(300);
    expect(getter).not.toHaveBeenCalled();
    expect(t.list.getScrollPosition()).toBe(300);
  } finally { t.cleanup(); }
});

it("page smooth navigation renders once per animation frame", () => {
  const t = setup();
  const raf = globalThis.requestAnimationFrame;
  let frame!: FrameRequestCallback;
  globalThis.requestAnimationFrame = callback => { frame = callback; return 1; };
  try {
    t.ctx.smoothScrollTo(400, 100);
    frame(performance.now() + 200);
    expect(t.list.getScrollPosition()).toBe(400);
    expect(t.afterScroll).toHaveBeenCalledTimes(1);
  } finally { globalThis.requestAnimationFrame = raf; t.cleanup(); }
});
