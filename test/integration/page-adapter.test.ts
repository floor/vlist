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
  const inspect: VListPlugin<{ id: number }> = {
    name: "inspect", priority: 100,
    setup(context) { ctx = context; },
  };
  const scrollTo = window.scrollTo;
  window.scrollTo = mock(() => {});
  const list = createVList({ container: host,
    items: Array.from({ length: 1000 }, (_, id) => ({ id })),
    item: { height: 40, template: item => String(item.id) },
  }, [page(), grid({ columns: 2 }), inspect]);
  const rect = mock(() => ({ top: -200, left: 0, width: 400, height: 600,
    right: 400, bottom: 400, x: 0, y: -200, toJSON() {} } as DOMRect));
  ctx.dom.viewport.getBoundingClientRect = rect;
  return { ctx, list, rect, cleanup() { list.destroy(); host.remove(); window.scrollTo = scrollTo; } };
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
